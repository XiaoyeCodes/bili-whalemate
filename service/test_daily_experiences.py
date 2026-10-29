"""Daily record selection and private chat reduction without remote writes."""
import copy
import datetime as dt
import json
import sqlite3
import tempfile
import unittest
from pathlib import Path
from unittest.mock import Mock, patch
from daily_experiences import collect
from life_context import LIFE_DEFAULTS, SHANGHAI
from bili_runtime import BiliRuntime
from bili_life import LifePosts
from bili_automation import DEFAULT_AUTOMATION

NOW = dt.datetime(2026, 10, 29, 12, tzinfo=SHANGHAI).timestamp()


class DailyTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        handler = Mock()
        handler._bili_tools_cfg.return_value = {'dm': True}
        self.model = Mock()
        self.runtime = BiliRuntime(lambda: handler, lambda: self.model, lambda: {}, self.root, self.root)
        self.runtime.owner_id = Mock(return_value='123')
        self.runtime.helper_command = Mock(return_value={'owner': '123', 'self': '456', 'messages': [
            {'ts': NOW - 1, 'type': 1, 'sender': '123', 'text': 'owner-private'},
            {'ts': NOW + 1, 'type': 1, 'sender': '123', 'text': 'future'},
            {'ts': NOW - 1, 'type': 1, 'sender': '999', 'text': 'stranger-private'}]})

    def test_only_confirmed_today_records_and_identified_owner_enter_sources(self):
        with sqlite3.connect(self.root / 'bili-automation.sqlite3') as db:
            db.execute('CREATE TABLE actions(kind,status,ended,result)')
            db.executemany('INSERT INTO actions VALUES(?,?,?,?)', [
                ('browse', 'success', NOW - 1, '{"title":"今日视频"}'),
                ('comment', 'unknown', NOW - 1, '{"text":"未确认评论"}'),
                ('browse', 'success', NOW - 86400, '{"title":"昨日视频"}'),
                ('strangerReply', 'success', NOW - 2, '{"text":"已回复","incomingText":"别人的问题"}')])
        db.close()
        result = collect(self.runtime, NOW, LIFE_DEFAULTS)
        self.assertEqual(len(result['activities']), 2)
        self.assertEqual(result['ownerChats'], 'owner-private')
        self.assertNotIn('昨日', json.dumps(result, ensure_ascii=False))
        self.assertNotIn('未确认', json.dumps(result, ensure_ascii=False))

    def test_owner_mismatch_and_missing_sources_do_not_become_experiences(self):
        self.runtime.helper_command.return_value['owner'] = '999'
        result = collect(self.runtime, NOW, LIFE_DEFAULTS)
        self.assertEqual(result['ownerChats'], '')
        self.assertEqual(result['activities'], [])
        self.assertTrue(result['unavailable'])

    def test_qq_selects_only_bound_owner_session_and_today(self):
        (self.root / 'remembers-service').mkdir()
        (self.root / 'remembers-service' / 'official-qq-bridge.json').write_text('{"port":3081,"token":"fixture"}', encoding='utf-8')
        with sqlite3.connect(self.root / 'memories.db') as db:
            db.execute('CREATE TABLE memory(text,tags,tier,ts)')
            db.executemany('INSERT INTO memory VALUES(?,?,?,?)', [
                ('owner-qq', '["session:owner-session"]', 'L0', NOW - 1),
                ('stranger-qq', '["session:other"]', 'L0', NOW - 1),
                ('yesterday', '["session:owner-session"]', 'L0', NOW - 86400)])
        db.close()
        import io
        opener = Mock()
        opener.open.return_value = io.BytesIO(b'{"ownerSessionId":"owner-session"}')
        with patch('daily_experiences.request.build_opener', return_value=opener):
            result = collect(self.runtime, NOW, LIFE_DEFAULTS)
        self.assertIn('owner-qq', result['ownerChats'])
        self.assertNotIn('stranger-qq', result['ownerChats'])
        self.assertNotIn('yesterday', result['ownerChats'])

    def test_private_summary_allows_enumerated_values_only(self):
        self.model.chat_json.return_value = {'topics': ['技术讨论', '主人密码是private'], 'feelings': ['安心', 'secret']}
        result = LifePosts(self.runtime).chat_impressions('secret', DEFAULT_AUTOMATION)
        self.assertEqual(result, {'available': True, 'topics': ['技术讨论'], 'feelings': ['安心']})

    def test_saved_prompt_all_themes_and_today_material_reach_draft_without_private_text(self):
        cfg = copy.deepcopy(DEFAULT_AUTOMATION)
        cfg['lifePosts']['prompt'] = '按我写的格式写今天的日记，允许多段。'
        self.runtime.daily_experiences = Mock(return_value={'activities': [{'title': '今天的视频'}], 'ownerChats': 'secret-chat', 'unavailable': []})
        self.runtime.state = lambda: {}
        self.model.chat_json.side_effect = [ {'topics': ['轻松玩笑'], 'feelings': ['开心']},
            {'text': '今天看到了有趣的东西，聊天也很开心。', 'theme': 'daily', 'meme_file': None}]
        context = Mock()
        context.snapshot.return_value = {'weather': {'available': True}, 'mealTime': '', 'calendar': {}}
        result = LifePosts(self.runtime, context).draft(cfg, NOW, [])
        supplied = json.loads(self.model.chat_json.call_args.args[1])
        self.assertEqual(supplied['writingPreferences'], cfg['lifePosts']['prompt'])
        self.assertEqual(set(supplied['availableThemes']), set(cfg['lifePosts']['themes']))
        self.assertNotIn('secret-chat', self.model.chat_json.call_args.args[1])
        self.assertIn('今天的视频', self.model.chat_json.call_args.args[1])
        self.assertEqual(result['experienceSources']['activities'], 1)
        self.assertNotIn('secret-chat', json.dumps(result))

    def test_chat_summary_failure_still_generates_using_public_records(self):
        self.model.chat_json.side_effect = ValueError('offline')
        self.assertEqual(LifePosts(self.runtime).chat_impressions('private', DEFAULT_AUTOMATION), {'available': False})


if __name__ == '__main__':
    unittest.main()
