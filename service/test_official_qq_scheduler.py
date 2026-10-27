"""Official QQ dispatch and Bilibili mention tests without external writes."""
import datetime
import io
import json
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock, patch

import scheduler
import server


class OfficialSchedulerTest(unittest.TestCase):
    def test_failed_dispatch_does_not_consume_daily_browse_quota(self):
        with tempfile.TemporaryDirectory() as directory:
            instance = scheduler.Scheduler(None, directory)
            instance._proactive_cfg = lambda: {"biliBrowsePerDay": 3}
            instance._inject = Mock(return_value=False)
            state = {"date": "2026-10-27", "bili_count": 1, "bili_interval": 60, "bili_last": 1}
            before = dict(state)
            fixed = Mock(wraps=datetime.datetime)
            fixed.now.return_value = datetime.datetime(2026, 10, 27, 12)
            with patch.object(scheduler.datetime, "datetime", fixed):
                self.assertFalse(instance._tick_bili(state, 1000))
                self.assertEqual(state, before)
                self.assertEqual(instance._inject.call_args.kwargs["request_id"], "bili:2026-10-27:2")
                instance._inject.return_value = True
                self.assertTrue(instance._tick_bili(state, 1000))
            self.assertEqual(state["bili_count"], 2)

    def test_dispatch_uses_loopback_official_bridge_with_authentication(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory, "bridge.json")
            path.write_text(json.dumps({"port": 3081, "token": "test-token"}), encoding="utf-8")
            opener = Mock()
            opener.open.return_value = io.BytesIO(b'{"ok":true,"accepted":true,"job":{"requestId":"one"}}')
            with patch.dict(scheduler.os.environ, {"CMEM_QQ_BRIDGE_CONFIG": str(path)}), patch.object(scheduler.request, "build_opener", return_value=opener):
                self.assertTrue(scheduler.Scheduler(None, directory)._inject("browse", request_id="one"))
            request = opener.open.call_args.args[0]
            self.assertEqual(request.full_url, "http://127.0.0.1:3081/wake")
            self.assertEqual(request.get_header("Authorization"), "Bearer test-token")
            self.assertEqual(json.loads(request.data)["requestId"], "one")

    def test_mention_is_added_from_saved_owner_in_dry_run(self):
        handler = object.__new__(server.Handler)
        handler._body = lambda: {"bvid": "BVtest", "message": "这个猫咪合集好有意思", "mention_owner": True, "dry": True}
        handler._load_bili_whale = lambda: {"owner": {"mid": "123456", "name": "主人"}}
        handler._run_bili = Mock(side_effect=[{"stdout": "aid(oid): 123456"}, {"ok": True, "stdout": "dry"}])
        handler._json = lambda status, result: setattr(handler, "result", (status, result))
        handler._post_bili_comment()
        args = handler._run_bili.call_args.args[0]
        self.assertEqual(args[args.index("--message") + 1], "@主人 这个猫咪合集好有意思")
        self.assertIn("--dry", args)
        self.assertTrue(handler.result[1]["mention_owner"])

    def test_preference_feed_retains_video_id_and_url(self):
        handler = object.__new__(server.Handler)
        handler._run_bili = lambda *args, **kwargs: {"ok": True, "stdout": "1. BV1TEST123456 30s 弹幕 10 播放100 萌宠日常 @猫咪"}
        handler.BILI_CFG = "not-a-real-file"
        store = SimpleNamespace(browsed_list=lambda limit: [], browsed_add=Mock(), log_activity=Mock())
        with patch.object(server, "store", store, create=True):
            result = handler._bili_feed()
        self.assertEqual(result["items"][0]["bvid"], "BV1TEST123456")
        self.assertEqual(result["items"][0]["title"], "萌宠日常")
        self.assertEqual(result["items"][0]["url"], "https://www.bilibili.com/video/BV1TEST123456")


if __name__ == "__main__":
    unittest.main()
