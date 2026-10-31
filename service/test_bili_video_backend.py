import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from bili_video_reader import run_reader


class VideoBackendTest(unittest.TestCase):
    def test_invalid_target_and_missing_saved_login_do_not_start_upstream(self):
        self.assertEqual(run_reader({'bvid': 'http://127.0.0.1'})['errorCode'], 'BAD_INPUT')
        self.assertEqual(run_reader({'bvid': 'BV1vCxj6MEP3'})['errorCode'], 'NEED_LOGIN')

    def run_fixture(self, subtitle):
        from agent_reach.channels import bilibili
        from agent_reach.runtime import state, sessions
        from bili_cli import auth
        with tempfile.TemporaryDirectory() as home, patch.dict(os.environ, {'CMEM_VIDEO_READER_HOME': home}), \
                patch.object(state, 'mutate'), patch.object(state, 'load', return_value={'session_reuse': {'bilibili': {'source': 'manual'}}}), \
                patch.object(bilibili, 'sessions_root', return_value=Path(home)), \
                patch.object(sessions, 'session_dir', return_value=Path(home)), patch.object(auth, 'save_credential') as save, \
                patch.object(bilibili, '_bili_json', return_value={'video': {'title': 'fixture', 'description': '简介', 'duration': 10}, 'subtitle': subtitle}):
            saved = Path(home) / 'bili-cli/.bilibili-cli/credential.json'
            saved.parent.mkdir(parents=True); saved.write_text('{}')
            result = run_reader({'bvid': 'BV1vCxj6MEP3', 'credentials': {'sessdata': 'fixture'}})
            save.assert_called_once()
            return result

    def test_real_upstream_channel_is_used_and_timestamps_are_preserved(self):
        items = [{'from': 0.0, 'to': 2.0, 'content': '实际字幕'}]
        result = self.run_fixture({'available': True, 'items': items})
        self.assertTrue(result['ok']); self.assertEqual(result['items'], items)
        self.assertEqual(result['backendVersion'], '1.6.0')
        self.assertEqual(result['nativeVersion'], '0.6.2')

    def test_upstream_no_caption_keeps_metadata_and_its_failure_code(self):
        result = self.run_fixture({'available': False, 'items': []})
        self.assertTrue(result['ok']); self.assertFalse(result['available'])
        self.assertEqual(result['video']['title'], 'fixture')
        self.assertEqual(result['errorCode'], 'NOT_FOUND')


if __name__ == '__main__':
    unittest.main()
