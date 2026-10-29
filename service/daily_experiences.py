"""Read today's confirmed activities and explicitly identified owner chats."""
import datetime as dt
import json
import sqlite3
from contextlib import closing
from urllib import request
from life_context import SHANGHAI


def collect(runtime, now, settings):
    """Bound reads to Shanghai today, omit ambiguous chats, and report unavailable sources."""
    start = dt.datetime.fromtimestamp(now, SHANGHAI).replace(hour=0, minute=0, second=0, microsecond=0).timestamp()
    limit = settings['experienceMaxItems']
    result = {'date': dt.datetime.fromtimestamp(now, SHANGHAI).date().isoformat(), 'activities': [], 'ownerChats': [], 'unavailable': []}
    path = runtime.data_dir / 'bili-automation.sqlite3'
    try:
        with closing(sqlite3.connect(f'{path.resolve().as_uri()}?mode=ro', uri=True)) as db:
            rows = db.execute("SELECT kind,ended,result FROM actions WHERE status='success' AND ended>=? AND ended<=? AND kind IN ('browse','recommend','comment','interact','ownerReply','strangerReply') ORDER BY ended DESC LIMIT ?", (start, now, limit)).fetchall()
        for kind, stamp, raw in reversed(rows):
            data = json.loads(raw)
            result['activities'].append({'kind': kind, 'time': dt.datetime.fromtimestamp(stamp, SHANGHAI).strftime('%H:%M'),
                **{key: str(data[key])[:1000] for key in ('title', 'summary', 'text', 'incomingText', 'threadText') if data.get(key)}})
    except (OSError, ValueError, sqlite3.Error):
        result['unavailable'].append('B站活动账本暂不可读')
    try:
        if runtime.handler()._bili_tools_cfg().get('dm', False):
            history = runtime.helper_command(['dm-history'], {'requestTimeoutSeconds': 30})
            if str(history.get('owner')) != runtime.owner_id():
                raise ValueError('私信主人不匹配')
            result['ownerChats'] += [str(row['text'])[:1000] for row in history['messages']
                if start <= row['ts'] <= now and row.get('type') == 1 and str(row.get('sender')) in (str(history['self']), runtime.owner_id())][-limit:]
    except Exception:
        result['unavailable'].append('B站主人聊天暂不可读')
    try:
        bridge = json.loads((runtime.root / 'remembers-service' / 'official-qq-bridge.json').read_text(encoding='utf-8'))
        req = request.Request(f"http://127.0.0.1:{int(bridge['port'])}/status", headers={'Authorization': 'Bearer ' + bridge['token']})
        with request.build_opener(request.ProxyHandler({})).open(req, timeout=3) as response:
            sid = json.load(response).get('ownerSessionId')
        if sid:
            path = runtime.data_dir / 'memories.db'
            with closing(sqlite3.connect(f'{path.resolve().as_uri()}?mode=ro', uri=True)) as db:
                rows = db.execute("SELECT text,tags FROM memory WHERE tier='L0' AND ts>=? AND ts<=? ORDER BY ts DESC LIMIT ?", (start, now, limit * 10)).fetchall()
            result['ownerChats'] += [text[:1000] for text, tags in reversed(rows) if 'session:' + sid in json.loads(tags or '[]')][-limit:]
        else:
            result['unavailable'].append('QQ主人当前会话暂无可识别记录')
    except Exception:
        result['unavailable'].append('QQ主人聊天暂不可读')
    result['ownerChats'] = '\n'.join(result['ownerChats'])[:settings['chatMaxChars']]
    return result
