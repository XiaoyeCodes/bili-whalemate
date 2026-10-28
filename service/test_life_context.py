"""Shanghai dates, holiday facts and bounded weather cache behavior."""
import datetime as dt
import io
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import Mock
from life_context import ShanghaiContext, SHANGHAI, calendar_context, validate_life


def stamp(text):
    return dt.datetime.fromisoformat(text).replace(tzinfo=SHANGHAI).timestamp()


class ContextTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(); self.addCleanup(self.temp.cleanup)
        self.now = stamp('2026-10-28T12:00:00')
        self.body = {'timezone': 'Asia/Shanghai', 'current_units': {'temperature_2m': '°C'},
            'current': {'time': self.now, 'temperature_2m': 19.5, 'weather_code': 61}}
        self.open = Mock(side_effect=lambda *a, **kw: io.BytesIO(json.dumps(self.body).encode()))
        self.context = ShanghaiContext(self.temp.name, self.open)

    def test_shanghai_midnight_is_independent_of_host_timezone(self):
        utc = dt.datetime(2026, 10, 27, 16, 1, tzinfo=dt.timezone.utc).timestamp()
        self.body['current']['time'] = utc
        result = self.context.snapshot(utc)
        self.assertEqual((result['date'], result['time'], result['weekday']), ('2026-10-28', '00:01', '星期三'))

    def test_statutory_holiday_and_compensating_saturday(self):
        holiday = calendar_context(stamp('2026-10-01T12:00:00'))
        working = calendar_context(stamp('2026-10-10T12:00:00'))
        self.assertTrue(holiday['isHoliday']); self.assertEqual(holiday['name'], '国庆节')
        self.assertFalse(working['isHoliday']); self.assertTrue(working['isWorkday']); self.assertTrue(working['compensatingWorkday'])

    def test_unsupported_year_is_unknown_instead_of_guessing_a_holiday(self):
        result = calendar_context(stamp('2099-10-01T12:00:00'))
        self.assertFalse(result['available']); self.assertIsNone(result['isHoliday'])

    def test_fresh_weather_is_cached_and_uses_fixed_shanghai_coordinates(self):
        first = self.context.weather(self.now)
        second = self.context.weather(self.now + 30)
        self.assertEqual(first, second); self.open.assert_called_once()
        self.assertEqual(first['description'], '小雨')
        url = self.open.call_args.args[0].full_url
        self.assertIn('latitude=31.2304', url); self.assertIn('longitude=121.4737', url); self.assertIn('Asia%2FShanghai', url)

    def test_same_day_recent_cache_is_marked_when_refresh_fails(self):
        self.context.weather(self.now)
        self.open.side_effect = OSError('offline')
        value = self.context.weather(self.now + 3600)
        self.assertTrue(value['available']); self.assertTrue(value['stale'])

    def test_previous_day_or_expired_weather_never_becomes_current(self):
        self.context.weather(self.now)
        self.open.side_effect = OSError('offline')
        self.assertFalse(self.context.weather(self.now + 3 * 3600)['available'])
        self.assertFalse(self.context.weather(self.now + 24 * 3600)['available'])

    def test_wrong_location_units_and_malformed_temperature_are_rejected(self):
        for change in ({'timezone': 'Asia/Tokyo'}, {'current_units': {'temperature_2m': '°F'}},
                       {'current': {'time': self.now, 'temperature_2m': 'warm', 'weather_code': 61}}):
            with self.subTest(change=change):
                body = {**self.body, **change}
                context = ShanghaiContext(Path(self.temp.name) / str(len(json.dumps(change))), Mock(return_value=io.BytesIO(json.dumps(body).encode())))
                self.assertFalse(context.weather(self.now)['available'])

    def test_invalid_settings_are_rejected_at_save(self):
        for item in ({'themes': []}, {'themes': [{}]}, {'themes': ['unknown']}, {'allowMemes': 1},
                     {'startHour': 23, 'endHour': 8}, {'minGapMinutes': 0}, {'prompt': 'a' * 4001}, {'extra': True}):
            with self.subTest(item=item), self.assertRaises(ValueError):
                validate_life(item)
