"""Shanghai date, statutory workdays and bounded, keyless weather context for public posts."""
import datetime as dt
import json
import math
import os
from pathlib import Path
import threading
import urllib.parse
import urllib.request
import uuid
import chinese_calendar

SHANGHAI = dt.timezone(dt.timedelta(hours=8), 'Asia/Shanghai')
THEMES = {'fishlife': '鱼生思考', 'philosophy': '哲学碎想', 'world': '对世界的好奇',
          'daily': '日常感慨', 'food': '饿了想吃饭', 'weather': '上海天气', 'holiday': '假期心情'}
LIFE_DEFAULTS = {'startHour': 8, 'endHour': 23, 'minGapMinutes': 180, 'maxChars': 260,
    'maxTokens': 1024, 'experienceMaxItems': 24, 'chatMaxChars': 6000, 'verifySeconds': 45, 'verifyPollSeconds': 5, 'weatherTimeoutSeconds': 10, 'weatherCacheMinutes': 30,
    'weatherMaxAgeMinutes': 120, 'recentPosts': 8, 'duplicateSimilarity': 0.9,
    'themes': list(THEMES), 'prompt': '围绕选中的主题，用当前人物卡的口吻写一到三句自然的日常动态，不写工作汇报。', 'allowMemes': True}
HOLIDAYS = {'New Year\'s Day': '元旦', 'Spring Festival': '春节', 'Tomb-sweeping Day': '清明节',
    'Labour Day': '劳动节', 'Dragon Boat Festival': '端午节', 'Mid-autumn Festival': '中秋节',
    'National Day': '国庆节', 'Anti-Fascist 70th Day': '纪念日'}
WMO = {0: '晴', 1: '大部晴朗', 2: '局部多云', 3: '阴', 45: '雾', 48: '冻雾',
    51: '小毛毛雨', 53: '毛毛雨', 55: '较强毛毛雨', 56: '冻毛毛雨', 57: '冻毛毛雨',
    61: '小雨', 63: '中雨', 65: '大雨', 66: '冻雨', 67: '较强冻雨',
    71: '小雪', 73: '中雪', 75: '大雪', 77: '雪粒', 80: '小阵雨', 81: '阵雨',
    82: '强阵雨', 85: '阵雪', 86: '强阵雪', 95: '雷雨', 96: '雷雨伴冰雹', 99: '强雷雨伴冰雹'}


def validate_life(value):
    """Validate saved settings before any model or network operation."""
    if not isinstance(value, dict) or set(value) - set(LIFE_DEFAULTS):
        raise ValueError('碎碎念设置包含未知字段或不是对象')
    cfg = {**LIFE_DEFAULTS, **value}
    bounds = {'startHour': (0, 23), 'endHour': (1, 24), 'minGapMinutes': (10, 1440),
        'maxChars': (40, 2000), 'maxTokens': (300, 4096), 'verifySeconds': (0, 180), 'verifyPollSeconds': (1, 30), 'weatherTimeoutSeconds': (3, 30),
        'weatherCacheMinutes': (5, 180), 'weatherMaxAgeMinutes': (30, 360), 'recentPosts': (1, 30)}
    bounds.update(experienceMaxItems=(1, 100), chatMaxChars=(500, 20000))
    for key, (low, high) in bounds.items():
        if type(cfg[key]) is not int or not low <= cfg[key] <= high:
            raise ValueError(f'碎碎念 {key} 必须是 {low}–{high} 的整数')
    if cfg['startHour'] >= cfg['endHour'] or cfg['weatherCacheMinutes'] > cfg['weatherMaxAgeMinutes']:
        raise ValueError('碎碎念时段或天气缓存时长无效')
    themes = cfg['themes']
    if not isinstance(themes, list) or not themes or any(not isinstance(t, str) or t not in THEMES for t in themes) or len(set(themes)) != len(themes):
        raise ValueError('碎碎念至少选择一个有效主题，且不能重复')
    if not isinstance(cfg['prompt'], str) or len(cfg['prompt']) > 4000:
        raise ValueError('碎碎念补充偏好最多 4000 字')
    if type(cfg['allowMemes']) is not bool:
        raise ValueError('碎碎念表情包开关必须为布尔值')
    if type(cfg['duplicateSimilarity']) not in (int, float) or not math.isfinite(cfg['duplicateSimilarity']) or not 0.5 <= cfg['duplicateSimilarity'] <= 1:
        raise ValueError('碎碎念重复相似度必须在 0.5–1 之间')
    cfg['themes'] = list(themes)
    return cfg


def calendar_context(now):
    """Statutory holidays and compensating workdays take precedence over weekday guesses."""
    local = dt.datetime.fromtimestamp(now, SHANGHAI)
    day = local.date()
    try:
        holiday, name = chinese_calendar.get_holiday_detail(day)
        return {'available': True, 'isHoliday': holiday, 'isWorkday': not holiday,
            'name': HOLIDAYS.get(name, name) if name else ('周末' if holiday else '工作日'),
            'compensatingWorkday': not holiday and bool(name), 'source': 'chinesecalendar'}
    except NotImplementedError:
        return {'available': False, 'isHoliday': None, 'isWorkday': None, 'name': '',
            'source': 'chinesecalendar', 'warning': '该年份法定节假日数据未更新，不能据此断言放假或调休'}


class ShanghaiContext:
    """Cache only Shanghai observations; expired or previous-day weather never becomes current fact."""
    def __init__(self, data_dir, opener=urllib.request.urlopen):
        self.cache = Path(data_dir) / 'shanghai-weather.json'
        self.opener = opener
        self.lock = threading.RLock()

    def _fresh(self, value, now, max_age):
        if not isinstance(value, dict) or value.get('city') != '上海' or not value.get('available'):
            return False
        stamp = value.get('observedAt')
        temperature, code = value.get('temperatureC'), value.get('code')
        return type(temperature) in (int, float) and math.isfinite(temperature) and -100 < temperature < 100 and type(code) is int and value.get('description') == WMO.get(code, '天气类型未知') and value.get('source') == 'Open-Meteo' and type(stamp) in (int, float) and math.isfinite(stamp) and -900 <= now - stamp <= max_age and dt.datetime.fromtimestamp(stamp, SHANGHAI).date() == dt.datetime.fromtimestamp(now, SHANGHAI).date()

    def weather(self, now, config=None):
        cfg = validate_life(config or {})
        with self.lock:
            cached = None
            try:
                cached = json.loads(self.cache.read_text(encoding='utf-8'))
            except FileNotFoundError:
                pass
            except (ValueError, OSError):
                cached = None  # Untrusted cache is discarded; only a new validated observation may replace it.
            if self._fresh(cached, now, cfg['weatherCacheMinutes'] * 60):
                return cached
            try:
                query = urllib.parse.urlencode({'latitude': 31.2304, 'longitude': 121.4737,
                    'current': 'temperature_2m,weather_code', 'timezone': 'Asia/Shanghai',
                    'forecast_days': 1, 'timeformat': 'unixtime'})
                req = urllib.request.Request('https://api.open-meteo.com/v1/forecast?' + query,
                    headers={'User-Agent': 'Whalemate/1.0 Shanghai weather'})
                with self.opener(req, timeout=cfg['weatherTimeoutSeconds']) as response:
                    data = json.loads(response.read(1 << 20))
                current = data.get('current') or {}
                temperature, stamp, code = current.get('temperature_2m'), current.get('time'), current.get('weather_code')
                if data.get('timezone') != 'Asia/Shanghai' or data.get('current_units', {}).get('temperature_2m') != '°C' or type(temperature) not in (int, float) or not math.isfinite(temperature) or not -100 < temperature < 100 or type(code) is not int:
                    raise ValueError('上海天气接口的数据无效')
                value = {'available': True, 'city': '上海', 'source': 'Open-Meteo', 'observedAt': stamp,
                    'fetchedAt': now, 'temperatureC': temperature, 'code': code, 'description': WMO.get(code, '天气类型未知')}
                if not self._fresh(value, now, cfg['weatherMaxAgeMinutes'] * 60):
                    raise ValueError('天气观测不是上海当天的新鲜数据')
                self.cache.parent.mkdir(parents=True, exist_ok=True)
                temp = self.cache.with_name(self.cache.name + '.' + uuid.uuid4().hex + '.tmp')
                try:
                    temp.write_text(json.dumps(value, ensure_ascii=False), encoding='utf-8')
                    os.replace(temp, self.cache)
                finally:
                    temp.unlink(missing_ok=True)
                return value
            except Exception as error:
                if self._fresh(cached, now, cfg['weatherMaxAgeMinutes'] * 60):
                    return {**cached, 'stale': True, 'warning': '天气接口暂时不可用，使用当日近期缓存'}
                return {'available': False, 'city': '上海', 'source': 'Open-Meteo',
                    'warning': '上海天气暂时无法获取，本条不描述实况天气', 'errorType': type(error).__name__}

    def snapshot(self, now, config=None):
        local = dt.datetime.fromtimestamp(now, SHANGHAI)
        hour = local.hour
        meal = '早餐时段' if 7 <= hour < 10 else '午饭时段' if 11 <= hour < 14 else '晚饭时段' if 17 <= hour < 20 else ''
        return {'city': '上海', 'date': local.date().isoformat(), 'time': local.strftime('%H:%M'),
            'weekday': '星期' + '一二三四五六日'[local.weekday()], 'season': ['冬', '春', '夏', '秋'][(local.month % 12) // 3],
            'mealTime': meal, 'calendar': calendar_context(now), 'weather': self.weather(now, config)}
