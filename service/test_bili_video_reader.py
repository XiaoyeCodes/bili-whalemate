"""The video tool respects its checkbox and preserves structured subtitle evidence."""
import json
import unittest
from unittest.mock import Mock

import server


class VideoReaderTest(unittest.TestCase):
    def handler(self, enabled=True):
        value = object.__new__(server.Handler)
        value._bili_tools_cfg = lambda: {'web-video-reader': enabled}
        value._body = lambda: {'url': 'BV1QosZ62Eb5'}
        value._json = lambda code, data: setattr(value, 'response', (code, data))
        value._run_bili = Mock()
        return value

    def test_default_tool_list_advertises_a_read_only_reader(self):
        self.assertIn('web-video-reader', server.Handler.BILI_TOOL_DEFAULTS)
        self.assertNotIn('web-video-reader', server.Handler.BILI_WRITE_TOOLS)

    def test_disabled_reader_never_runs_the_cli(self):
        handler = self.handler(False)
        handler._bili_read_video()
        self.assertEqual(handler.response[0], 403)
        handler._run_bili.assert_not_called()

    def test_subtitles_are_not_truncated_to_the_generic_cli_output_tail(self):
        handler = self.handler()
        payload = {'ok': True, 'coverage': 'subtitles', 'transcript': '第一句\n' + '字幕正文' * 2000,
                   'evidence': {'subtitles': True, 'danmaku': False}}
        handler._run_bili.return_value = {'ok': True, 'stdout': json.dumps(payload, ensure_ascii=False)}
        handler._bili_read_video()
        self.assertEqual(handler.response, (200, payload))
        self.assertGreater(handler._run_bili.call_args.kwargs['output_limit'], 3000)

    def test_metadata_only_stays_explicit_in_the_model_result(self):
        handler = self.handler()
        payload = {'ok': True, 'coverage': 'metadata_only', 'title': 'metadata', 'transcript': ''}
        handler._run_bili.return_value = {'ok': True, 'stdout': json.dumps(payload)}
        handler._bili_read_video()
        self.assertEqual(handler.response[1]['coverage'], 'metadata_only')

    def test_generic_bili_run_uses_the_same_structured_reader(self):
        handler = self.handler()
        handler._body = lambda: {'command': 'web-video-reader', 'args': ['BV1QosZ62Eb5']}
        handler._run_bili.return_value = {'stdout': '{"ok":true,"coverage":"metadata_only"}'}
        handler._bili_run()
        self.assertEqual(handler.response[1]['coverage'], 'metadata_only')


if __name__ == '__main__':
    unittest.main()
