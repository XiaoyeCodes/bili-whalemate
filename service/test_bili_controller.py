"""Activity orchestration with fake platform responses; never publishes to Bilibili."""
import copy
import tempfile
import unittest
from pathlib import Path
from unittest.mock import Mock, patch

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

    def test_one_browsed_video_can_execute_all_three_public_actions(self):
        with patch("bili_automation.random.random", return_value=0):
            self.run_once(None)
        self.assertEqual({call.args[0] for call in self.backend.publish.call_args_list}, {"recommend", "comment", "interact"})
        counts = self.ledger.counts(day_at(self.now))
        self.assertEqual(counts["browse"]["success"], 1)
        for kind in ("recommend", "comment", "interact"):
            self.assertEqual(counts[kind]["success"], 1)
        self.backend.notify.assert_called_once()

    def test_public_actions_use_independent_saved_probabilities(self):
        self.cfg["actionProbability"] = {"recommend": 25, "comment": 50, "interact": 75}
        with patch("bili_automation.random.random", return_value=0.6):
            self.run_once(None)
        self.assertEqual([call.args[0] for call in self.backend.publish.call_args_list], ["interact"])

    def test_all_missed_draws_still_choose_one_eligible_action(self):
        with patch("bili_automation.random.random", return_value=0.99), patch("bili_automation.random.choices", return_value=["comment"]):
            self.run_once(None)
        self.backend.publish.assert_called_once()
        self.assertEqual(self.backend.publish.call_args.args[0], "comment")

    def test_one_draw_can_select_exactly_two_public_actions(self):
        with patch("bili_automation.random.random", side_effect=[0, 0.99, 0]):
            self.run_once(None)
        self.assertEqual({call.args[0] for call in self.backend.publish.call_args_list}, {"recommend", "interact"})

    def test_unknown_second_action_retains_first_success_and_stops_the_third(self):
        self.backend.publish.side_effect = [{"status": "success"}, {"status": "unknown", "error": "response lost"}]
        with patch("bili_automation.random.random", return_value=0), patch("bili_automation.random.shuffle"):
            self.run_once(None)
        self.assertEqual(self.backend.publish.call_count, 2)
        counts = self.ledger.counts(day_at(self.now))
        self.assertEqual(counts["recommend"]["success"], 1)
        self.assertEqual(counts["comment"]["unknown"], 1)
        self.assertEqual(sum(counts["interact"].values()), 0)

    def test_recommendation_rechecks_a_changed_score_threshold_before_sending(self):
        def publish(*args):
            self.cfg["minInterestingScore"] = 19
            return {"status": "success"}
        self.backend.publish.side_effect = publish
        order = {"comment": 0, "recommend": 1, "interact": 2}
        with patch("bili_automation.random.random", return_value=0), patch("bili_automation.random.shuffle", side_effect=lambda items: items.sort(key=order.get)):
            self.run_once(None)
        self.assertEqual([call.args[0] for call in self.backend.publish.call_args_list], ["comment", "interact"])

    def test_fallback_never_selects_disabled_exhausted_or_low_score_actions(self):
        self.cfg["features"]["comment"] = False
        self.cfg["daily"]["interact"] = {"min": 0, "max": 0}
        self.backend.draft_video.return_value["score"] = 8
        with patch("bili_automation.random.random", return_value=0.99):
            self.run_once(None)
        self.backend.publish.assert_not_called()

    def test_no_usable_drafts_do_not_force_an_unrelated_comment(self):
        self.backend.draft_video.return_value.update(recommend="", comment="", interact=None)
        self.run_once(None)
        self.backend.publish.assert_not_called()

    def test_unknown_first_public_action_stops_other_selected_actions(self):
        self.backend.publish.return_value = {"status": "unknown", "error": "response lost"}
        with patch("bili_automation.random.random", return_value=0):
            self.run_once(None)
        self.backend.publish.assert_called_once()
        self.backend.notify.assert_not_called()

    def test_platform_protection_stops_remaining_public_actions(self):
        self.backend.publish.return_value = {"status": "failed", "blocked": True, "error": "需要验证码"}
        with patch("bili_automation.random.random", return_value=0):
            self.run_once(None)
        self.backend.publish.assert_called_once()
        self.assertEqual(self.ledger.meta("blocked"), "需要验证码")

    def test_definite_failure_does_not_hide_successful_sibling_actions_or_its_error(self):
        self.backend.publish.side_effect = lambda kind, *args: ({"status": "failed", "error": "recommendation rejected"}
            if kind == "recommend" else {"status": "success"})
        with patch("bili_automation.random.random", return_value=0):
            self.run_once(None)
        self.assertEqual(self.backend.publish.call_count, 3)
        counts = self.ledger.counts(day_at(self.now))
        self.assertEqual(counts["comment"]["success"], 1)
        self.assertEqual(counts["interact"]["success"], 1)
        self.assertIn("recommendation rejected", self.ledger.meta("last_error"))

    def test_disabling_automation_between_actions_stops_later_publication(self):
        def publish(*args):
            self.cfg["enabled"] = False
            return {"status": "success"}
        self.backend.publish.side_effect = publish
        with patch("bili_automation.random.random", return_value=0):
            self.run_once(None)
        self.backend.publish.assert_called_once()

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

    def test_dm_batch_is_one_reply_and_is_acknowledged_only_after_verified_success(self):
        batch = [{"key": "one", "ts": 100, "text": "第一条"}, {"key": "two", "ts": 101, "text": "第二条"}]
        message = {"mid": "123", "key": "two", "ts": 101, "text": "第一条\n第二条", "receipt": "batch-r", "messages": batch}
        self.backend.dm_peek.return_value = message
        self.backend.draft_dm.return_value = '统一回复'
        self.backend.send_dm.return_value = {"status": "failed", "submission": "not-sent", "error": "尚未发送"}
        self.run_once('dmReply')
        self.backend.dm_ack.assert_not_called()
        self.now += self.cfg['retryDelayMinutes'] * 60 + 1
        self.backend.send_dm.return_value = {"status": "success", "replyVerified": True}
        self.run_once('dmReply')
        self.backend.dm_ack.assert_called_once_with(message, self.cfg)
        self.assertEqual(self.ledger.counts(day_at(self.now))['dmReply']['success'], 1)
        self.run_once('dmReply')
        self.assertEqual(self.backend.send_dm.call_count, 2)

    def test_dm_unknown_delivery_retains_cursor_and_prevents_repeat(self):
        self.backend.dm_peek.return_value = {"mid": "123", "key": "one", "text": "hello", "receipt": "r"}
        self.backend.draft_dm.return_value = "hello"
        self.backend.send_dm.return_value = {"status": "unknown", "error": "lost response"}
        self.run_once("dmReply")
        self.run_once("dmReply")
        self.backend.dm_ack.assert_not_called()
        self.assertEqual(self.backend.send_dm.call_count, 1)

    def test_budget_rejection_defers_polling_without_acknowledging_the_message(self):
        self.backend.dm_peek.return_value = {"mid": "123", "key": "budget", "text": "hello", "receipt": "r"}
        self.backend.draft_dm.return_value = "hello"
        self.backend.send_dm.return_value = {"status": "failed", "submission": "not-sent", "retryAt": self.now + 3600, "error": "等待额度恢复"}
        self.run_once("dmReply")
        self.assertEqual(self.ledger.meta("next_dm_at"), self.now + 3600)
        self.backend.dm_ack.assert_not_called()
        self.run_once("dmReply")
        self.assertEqual(self.backend.draft_dm.call_count, 1)

    def test_dm_budget_wait_rechecks_capacity_and_retries_only_unsent(self):
        self.cfg['features'] = {kind: kind == 'dmReply' for kind in self.cfg['features']}
        self.backend.dm_peek.return_value = {"mid": "123", "key": "budget", "text": "hello", "receipt": "r"}
        self.backend.draft_dm.return_value = "hello"
        self.backend.send_dm.return_value = {"status": "failed", "submission": "not-sent", "reason": "write-budget", "retryAt": self.now + 3600, "error": "等待额度恢复"}
        self.run_once('dmReply')
        self.backend.write_budget_available.return_value = False
        self.controller.tick(self.now + 1000)
        self.assertEqual(self.backend.send_dm.call_count, 1)
        self.backend.write_budget_available.return_value = True
        self.backend.send_dm.return_value = {"status": "success", "replyVerified": True}
        self.controller.tick(self.now + 1001)
        self.assertEqual(self.backend.send_dm.call_count, 2)
        self.backend.dm_ack.assert_called_once()

    def test_budget_wait_does_not_release_unknown_or_other_failures(self):
        for status, result in [("unknown", {"submission": "not-sent", "reason": "write-budget", "retryAt": self.now + 3600}),
                               ("failed", {"submission": "not-sent", "reason": "cooldown", "retryAt": self.now + 3600})]:
            with self.subTest(status=status):
                ledger = AutomationLedger(Path(self.directory.name, status + result['reason'] + '.db'))
                action = ledger.reserve(day_at(self.now), 'dmReply', 'x', self.cfg, self.now)
                ledger.finish(action, status, result)
                ledger.set_meta('next_dm_at', self.now + 3600)
                self.assertFalse(ledger.release_dm_budget_wait(self.now + 1000, 900, 3))
                self.assertEqual(ledger.meta('next_dm_at'), self.now + 3600)
                ledger.close()

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
