"""Life-post generation, schedules and publication guarantees without real social writes."""
import copy
import datetime as dt
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import Mock, patch
from bili_automation import BiliAutomation, AutomationLedger, DEFAULT_AUTOMATION, validate_config
from bili_life import LifePosts, validate_post
from bili_runtime import BiliRuntime
from life_context import SHANGHAI


NOW = dt.datetime(2026, 10, 28, 10, tzinfo=SHANGHAI).timestamp()


class LifeTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(); self.addCleanup(self.temp.cleanup)
        self.cfg = copy.deepcopy(DEFAULT_AUTOMATION)
        self.cfg['enabled'] = self.cfg['managed'] = self.cfg['features']['dynamic'] = True
        self.cfg['daily']['dynamic'] = {'min': 2, 'max': 2}
        self.ledger = AutomationLedger(Path(self.temp.name) / 'actions.db'); self.addCleanup(self.ledger.close)
        self.backend = Mock()
        self.draft = {'text': '忽然想知道，鱼把烦恼吐成泡泡以后，海会不会变轻一点。', 'theme': 'fishlife', 'meme_file': None}
        self.backend.draft_dynamic.return_value = self.draft
        self.backend.publish_dynamic.return_value = {'status': 'success', 'text': self.draft['text'], 'url': 'https://t.bilibili.com/123'}
        self.auto = BiliAutomation(self.ledger, self.backend, lambda: self.cfg, lambda: True)

    def test_schedule_is_spaced_durable_and_does_not_change_on_refresh(self):
        schedule = self.auto._dynamic_schedule(self.cfg, NOW)
        self.assertEqual(schedule, self.auto._dynamic_schedule(self.cfg, NOW + 5))
        slots = schedule['slots']
        self.assertEqual(len(slots), 2)
        self.assertGreaterEqual(slots[1] - slots[0], self.cfg['lifePosts']['minGapMinutes'] * 60)
        other = AutomationLedger(self.ledger.conn.execute('pragma database_list').fetchone()[2]); self.addCleanup(other.close)
        restored = BiliAutomation(other, self.backend, lambda: self.cfg, lambda: True)
        self.assertEqual(schedule, restored._dynamic_schedule(self.cfg, NOW + 10))

    def test_preview_does_not_publish_reserve_or_schedule(self):
        self.auto._dynamic(self.cfg, NOW, True, True)
        self.backend.publish_dynamic.assert_not_called()
        self.assertEqual(sum(self.ledger.counts('2026-10-28')['dynamic'].values()), 0)
        self.assertIsNone(self.ledger.meta('dynamic_schedule'))
        self.assertFalse(self.ledger.meta('dynamic_preview')['published'])

    def test_manual_publication_counts_once_and_minimum_gap_applies(self):
        self.auto._dynamic(self.cfg, NOW, False, True)
        self.auto._dynamic(self.cfg, NOW + 1, False, True)
        self.backend.publish_dynamic.assert_called_once()
        self.assertEqual(self.ledger.counts('2026-10-28')['dynamic']['success'], 1)

    def test_failed_generation_consumes_a_slot_without_automatic_retry(self):
        self.backend.draft_dynamic.side_effect = ValueError('empty draft')
        self.auto._dynamic(self.cfg, NOW, False, True)
        self.assertEqual(self.ledger.counts('2026-10-28')['dynamic']['failed'], 1)
        self.backend.publish_dynamic.assert_not_called()
        self.auto._dynamic(self.cfg, NOW + 1, False, True)
        self.backend.draft_dynamic.assert_called_once()

    def test_unknown_post_is_retained_and_daily_limit_is_not_bypassed(self):
        self.cfg['daily']['dynamic'] = {'min': 1, 'max': 1}
        self.backend.publish_dynamic.return_value = {'status': 'unknown', 'text': self.draft['text'], 'error': 'readback pending'}
        self.auto._dynamic(self.cfg, NOW, False, True)
        self.auto._dynamic(self.cfg, NOW + 4 * 3600, False, True)
        self.backend.publish_dynamic.assert_called_once()
        self.assertEqual(self.ledger.remaining('2026-10-28', 'dynamic', self.cfg), 0)
        self.assertEqual(self.ledger.dynamic_history()[0]['text'], self.draft['text'])

    def test_disabling_during_generation_stops_the_write(self):
        def disabled(*args):
            self.cfg['features']['dynamic'] = False
            return self.draft
        self.backend.draft_dynamic.side_effect = disabled
        self.auto._dynamic(self.cfg, NOW, False, True)
        self.backend.publish_dynamic.assert_not_called()

    def test_future_slots_and_outside_hours_do_not_generate(self):
        schedule = self.auto._dynamic_schedule(self.cfg, NOW)
        self.auto._dynamic(self.cfg, NOW, False, False)
        self.auto._dynamic(self.cfg, NOW - 8 * 3600, False, True)
        self.backend.draft_dynamic.assert_not_called()

    def test_dynamic_only_manual_run_never_runs_video_or_private_polling(self):
        self.auto.run_lock.acquire()
        self.auto._run_owned('dynamic', True, True, NOW)
        self.backend.feed.assert_not_called(); self.backend.dm_peek.assert_not_called(); self.backend.notifications.assert_not_called()

    def test_dynamic_limits_and_settings_are_validated(self):
        for value in ({'daily': {'dynamic': {'min': 3, 'max': 2}}}, {'daily': {'dynamic': {'min': 1, 'max': 21}}}, {'lifePosts': {'allowMemes': 'yes'}}):
            with self.assertRaises(ValueError): validate_config(value)


class DraftAndTransportTest(unittest.TestCase):
    def setUp(self):
        self.cfg = copy.deepcopy(DEFAULT_AUTOMATION)
        self.cfg['lifePosts']['verifySeconds'] = 0
        self.cfg['lifePosts']['themes'] = ['fishlife']
        self.model = Mock()
        self.handler = Mock(); self.handler._bili_tools_cfg.return_value = {'dynamic-image': True}
        self.runtime = BiliRuntime(lambda: self.handler, lambda: self.model,
            lambda: {'constitution': '大肥鱼的公开设定', 'user_profile': 'private-owner-secret'}, '.', '.',
            state=lambda: {'mood': 'happy', 'diary': 'private-diary-secret'})
        self.context = Mock()
        self.context.snapshot.return_value = {'date': '2026-10-28', 'time': '10:00', 'city': '上海', 'mealTime': '',
            'calendar': {'available': True, 'isHoliday': False, 'name': '工作日'}, 'weather': {'available': True, 'description': '晴', 'temperatureC': 20}}
        self.life = LifePosts(self.runtime, self.context)
        self.text = '忽然想知道，鱼把烦恼吐成泡泡以后，海会不会变轻一点。'

    def test_public_draft_uses_one_model_call_and_excludes_private_state(self):
        self.model.chat_json.return_value = {'text': self.text, 'meme_file': None}
        result = self.life.draft(self.cfg, NOW, [])
        self.assertEqual(result['text'], self.text)
        self.model.chat_json.assert_called_once()
        request = ' '.join(self.model.chat_json.call_args.args)
        self.assertNotIn('private-owner-secret', request); self.assertNotIn('private-diary-secret', request)
        self.assertNotIn('用大肥鱼自己的口吻', request)
        self.assertIn('人物身份和性格以当前人物卡为准', request)
        self.assertFalse(self.model.chat_json.call_args.kwargs['thinking'])

    def test_weather_only_theme_skips_when_real_weather_is_unavailable(self):
        self.cfg['lifePosts']['themes'] = ['weather']
        self.context.snapshot.return_value['weather'] = {'available': False}
        with self.assertRaisesRegex(ValueError, '天气'): self.life.draft(self.cfg, NOW, [])
        self.model.chat_json.assert_not_called()

    def test_duplicate_links_ids_and_paths_are_rejected(self):
        for text in (self.text, 'https://example.test', '@主人 快来看', '账号 123456789', 'C:/Users/private/key'):
            with self.assertRaises(ValueError): validate_post(text, self.cfg, [{'text': self.text}])

    def test_meme_switch_uses_shared_gallery_and_can_disable_it(self):
        self.runtime.gallery = Mock(); self.runtime.gallery.offer.return_value = [{'file': 'food.png'}]
        self.runtime.gallery.selected.side_effect = lambda value, offered: value
        self.model.chat_json.return_value = {'text': self.text, 'meme_file': 'food.png'}
        self.assertEqual(self.life.draft(self.cfg, NOW, [])['meme_file'], 'food.png')
        self.runtime.gallery.offer.assert_called_once()
        self.cfg['lifePosts']['allowMemes'] = False
        self.runtime.gallery.offer.reset_mock(); self.model.chat_json.return_value = {'text': self.text, 'meme_file': None}
        self.life.draft(self.cfg, NOW, [])
        self.runtime.gallery.offer.assert_not_called()

    def prepare_transport(self):
        self.runtime.command = Mock(side_effect=[{'ok': True}, {'ok': True, 'combined': 'dyn_id=456'}])
        self.runtime._wait_write = Mock()
        self.runtime.helper_command = Mock(return_value={'found': True, 'text': self.text, 'pictures': []})

    def test_post_is_success_only_after_author_and_text_readback(self):
        self.prepare_transport()
        result = self.runtime.publish_dynamic({'text': self.text}, self.cfg)
        self.assertTrue(result['verified']); self.assertEqual(result['status'], 'success')
        self.runtime.helper_command.assert_called_once_with(['verify-dynamic', '456'], self.cfg)

    def test_delayed_public_body_is_read_again_without_publishing_again(self):
        self.prepare_transport(); self.cfg['lifePosts']['verifySeconds'] = 45
        self.runtime.helper_command.side_effect = [{'found': True, 'text': '', 'pictures': []},
            {'found': True, 'text': self.text, 'pictures': []}]
        with patch('bili_runtime.time.sleep') as sleep:
            result = self.runtime.publish_dynamic({'text': self.text}, self.cfg)
        self.assertEqual(result['status'], 'success'); self.assertEqual(self.runtime.command.call_count, 2)
        self.assertEqual(self.runtime.helper_command.call_count, 2); sleep.assert_called_once()

    def test_readback_failure_never_dispatches_again(self):
        self.prepare_transport(); self.runtime.helper_command.side_effect = ValueError('offline')
        result = self.runtime.publish_dynamic({'text': self.text}, self.cfg)
        self.assertEqual(result['status'], 'unknown'); self.assertEqual(self.runtime.command.call_count, 2)
        self.assertEqual(result['id'], '456')
        self.assertEqual(result['url'], 'https://t.bilibili.com/456')

    def test_unconfirmed_image_is_unknown_without_marking_gallery_used(self):
        self.prepare_transport()
        self.runtime._upload_meme = Mock(return_value={'image_url': 'https://i0.hdslb.com/bfs/new_dyn/test.png'})
        self.runtime._mark_meme = Mock()
        result = self.runtime.publish_dynamic({'text': self.text, 'meme_file': 'food.png'}, self.cfg)
        self.assertEqual(result['status'], 'unknown'); self.runtime._mark_meme.assert_not_called()

    def test_upload_failure_can_send_only_text_with_an_explicit_warning(self):
        self.prepare_transport(); self.runtime._upload_meme = Mock(side_effect=ValueError('unavailable'))
        result = self.runtime.publish_dynamic({'text': self.text, 'meme_file': 'food.png'}, self.cfg)
        self.assertEqual(result['status'], 'success'); self.assertIn('只发表文字', result['mediaWarning'])

    def test_verified_image_marks_only_the_actually_published_gallery_file(self):
        self.prepare_transport()
        picture = {'image_url': 'https://i0.hdslb.com/bfs/new_dyn/test.png'}
        self.runtime._upload_meme = Mock(return_value=picture)
        self.runtime._mark_meme = Mock()
        self.runtime.helper_command.return_value['pictures'] = [picture['image_url'].replace('https://', 'http://')]
        result = self.runtime.publish_dynamic({'text': self.text, 'meme_file': 'food.png'}, self.cfg)
        self.assertEqual(result['status'], 'success'); self.assertTrue(result['pictureVerified'])
        self.assertEqual(result['meme_file'], 'food.png')
        self.runtime._mark_meme.assert_called_once_with('food.png', result)


if __name__ == '__main__':
    unittest.main()
