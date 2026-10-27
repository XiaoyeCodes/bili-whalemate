"""Activity orchestration with fake platform responses; never publishes to Bilibili."""
import copy
import tempfile
import unittest
from pathlib import Path
from unittest.mock import Mock

from bili_automation import AutomationLedger, BiliAutomation, DEFAULT_AUTOMATION, day_at


class ControllerTest(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.ledger = AutomationLedger(Path(self.directory.name, "ledger.db"))
        self.addCleanup(self.ledger.close)
        self.cfg = copy.deepcopy(DEFAULT_AUTOMATION)
        self.cfg.update(managed=True, enabled=True)
        self.cfg["daily"] = {kind: {"min": 3, "max": 3} for kind in self.cfg["daily"]}
        self.backend = Mock()
        self.backend.owner_id.return_value = "123"
        self.backend.dm_peek.return_value = None
        self.backend.feed.return_value = [{"bvid": "BVfake", "title": "猫咪", "url": "https://example.test/video"}]
        self.backend.read_video.return_value = {"bvid": "BVfake", "title": "猫咪"}
        self.backend.draft_video.return_value = {"score": 18, "summary": "猫咪搞笑", "recommend": "快来看", "comment": "可爱", "interact": {"text": "同感"}}
        self.backend.publish.return_value = {"status": "success", "url": "https://example.test/comment", "text": "喵"}
        self.controller = BiliAutomation(self.ledger, self.backend, lambda: self.cfg, lambda: True)
        self.now = 1793109600

    def run_once(self, kind, dry=False):
        self.controller.run_lock.acquire()
        self.controller._run_owned(kind, dry, True, self.now)

    def test_recommendation_reuses_material_and_notifies_only_after_success(self):
        self.run_once("recommend")
        self.assertEqual(self.backend.publish.call_args.args[0], "recommend")
        self.backend.notify.assert_called_once()
        counts = self.ledger.counts(day_at(self.now))
        self.assertEqual(counts["browse"]["success"], 1)
        self.assertEqual(counts["recommend"]["success"], 1)

    def test_comment_and_interaction_are_distinct_categories(self):
        for kind in ("comment", "interact"):
            with self.subTest(kind=kind):
                self.ledger.enqueue([{ "bvid": "BV" + kind, "title": "猫咪", "url": "url" }])
                self.run_once(kind)
                self.assertEqual(self.backend.publish.call_args.args[0], kind)
        self.backend.notify.assert_not_called()

    def test_preview_never_publishes_or_consumes_quota(self):
        self.run_once("recommend", dry=True)
        self.backend.publish.assert_not_called()
        self.assertEqual(self.ledger.counts(day_at(self.now))["browse"]["success"], 0)
        self.assertEqual(self.ledger.meta("last_preview")["video"]["bvid"], "BVfake")

    def test_feature_disabled_is_enforced_before_publication(self):
        self.cfg["features"]["comment"] = False
        self.run_once("comment")
        self.backend.publish.assert_not_called()

    def test_model_failure_does_not_publish_or_consume_success(self):
        self.backend.draft_video.side_effect = ValueError("invalid JSON")
        self.run_once("recommend")
        self.backend.publish.assert_not_called()
        self.assertIn("invalid JSON", self.ledger.meta("last_error"))
        self.assertEqual(self.ledger.counts(day_at(self.now))["browse"]["failed"], 1)

    def test_unknown_write_is_counted_and_never_resent(self):
        self.backend.publish.return_value = {"status": "unknown", "error": "not visible"}
        self.run_once("recommend")
        self.assertEqual(self.ledger.counts(day_at(self.now))["recommend"]["unknown"], 1)
        self.backend.notify.assert_not_called()
        self.run_once("recommend")
        self.assertEqual(self.backend.publish.call_count, 1)

    def test_dm_only_handles_owner_and_acknowledges_verified_success(self):
        message = {"mid": "123", "key": "message-key", "text": "@大肥鱼 晚上好", "receipt": "receipt"}
        self.backend.dm_peek.return_value = message
        self.backend.send_dm.return_value = {"status": "success", "replyVerified": True}
        self.backend.draft_dm.return_value = "晚上好"
        self.run_once("dmReply")
        self.backend.dm_ack.assert_called_once_with(message, self.cfg)
        self.assertEqual(self.ledger.counts(day_at(self.now))["dmReply"]["success"], 1)
        self.run_once("dmReply")
        self.assertEqual(self.backend.send_dm.call_count, 1)

    def test_dm_stranger_is_never_replied_to(self):
        self.backend.dm_peek.return_value = {"mid": "stranger", "key": "a", "text": "hello"}
        self.run_once("dmReply")
        self.backend.send_dm.assert_not_called()
        self.assertIn("不是配置的主人", self.ledger.meta("dm_error"))

    def test_dm_unknown_delivery_retains_cursor_and_prevents_repeat(self):
        self.backend.dm_peek.return_value = {"mid": "123", "key": "one", "text": "hello", "receipt": "r"}
        self.backend.draft_dm.return_value = "hello"
        self.backend.send_dm.return_value = {"status": "unknown", "error": "lost response"}
        self.run_once("dmReply")
        self.run_once("dmReply")
        self.backend.dm_ack.assert_not_called()
        self.assertEqual(self.backend.send_dm.call_count, 1)

    def test_dm_mention_filter_does_not_generate_unrequested_reply(self):
        self.cfg["dmRequireMention"] = True
        message = {"mid": "123", "key": "one", "text": "hello", "receipt": "r"}
        self.backend.dm_peek.return_value = message
        self.backend.is_mention.return_value = False
        self.run_once("dmReply")
        self.backend.draft_dm.assert_not_called()
        self.backend.dm_ack.assert_called_once()

    def test_idle_dm_poll_does_not_erase_video_failure_diagnostics(self):
        self.ledger.set_meta("last_error", "video read failed")
        self.run_once("dmReply")
        self.assertEqual(self.ledger.meta("last_error"), "video read failed")

    def test_recommendation_score_threshold_does_not_disable_relevant_comment(self):
        self.backend.draft_video.return_value["score"] = 8
        self.run_once("comment")
        self.assertEqual(self.backend.publish.call_args.args[0], "comment")


if __name__ == "__main__":
    unittest.main()
