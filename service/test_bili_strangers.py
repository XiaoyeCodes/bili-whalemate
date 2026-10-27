"""Inbound comment quotas and fixed replies without platform or model calls."""
import copy
import tempfile
import unittest
from pathlib import Path
from unittest.mock import Mock

from bili_automation import AutomationLedger, BiliAutomation, DEFAULT_AUTOMATION, LIMIT_REPLY_TEXT, day_at, validate_config
from bili_runtime import BiliRuntime


class StrangerTest(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.path = Path(self.directory.name, "ledger.db")
        self.ledger = AutomationLedger(self.path)
        self.addCleanup(self.ledger.close)
        self.cfg = copy.deepcopy(DEFAULT_AUTOMATION)
        self.cfg.update(managed=True, enabled=True, strangerDailyMax=1)
        self.cfg["features"]["strangerReply"] = True
        self.backend = Mock()
        self.backend.owner_id.return_value = "123"
        self.backend.notifications.return_value = []
        self.backend.notification_context.side_effect = lambda item, cfg: {"parent_rpid": item["rpid"], "text": "你好"}
        self.backend.draft_stranger.return_value = "你好呀"
        self.backend.reply_notification.side_effect = lambda ctx, text, cfg: {"status": "success", "parent_rpid": ctx["parent_rpid"], "text": text}
        self.enabled = True
        self.controller = BiliAutomation(self.ledger, self.backend, lambda: self.cfg, lambda: self.enabled)
        self.now = 1793109600
        self.ledger.set_meta("stranger_baseline", self.now - 10)

    def item(self, rpid="100", actor="999", kind="reply"):
        return {"business": 1, "oid": "111", "rpid": rpid, "mid": actor, "kind": kind, "time": self.now}

    def run_once(self, items, kind="strangerReply"):
        self.backend.notifications.return_value = items
        self.controller.run_lock.acquire()
        self.controller._run_owned(kind, False, True, self.now)

    def test_owner_comment_reply_has_its_own_quota_and_public_context(self):
        self.cfg["features"]["ownerReply"] = True
        self.cfg["ownerCommentDailyMax"] = 1
        self.ledger.set_meta("owner_comment_baseline", self.now - 10)
        self.backend.draft_owner_comment.return_value = {"text": "老大来看", "meme_file": "hello.png"}
        self.run_once([self.item(actor="123"), self.item("101", "123")], kind="ownerReply")
        self.backend.draft_owner_comment.assert_called_once()
        self.backend.draft_stranger.assert_not_called()
        self.assertTrue(self.backend.reply_notification.call_args.args[0]["is_owner"])
        self.assertEqual(self.ledger.counts(day_at(self.now))["ownerReply"]["success"], 1)
        self.assertEqual(self.ledger.counts(day_at(self.now))["strangerNotice"]["success"], 0)

    def test_first_owner_enable_does_not_reply_to_existing_mentions(self):
        self.cfg["features"]["ownerReply"] = True
        old = self.item(actor="123")
        old["time"] -= 1
        self.run_once([old], kind="ownerReply")
        self.backend.draft_owner_comment.assert_not_called()

    def test_new_mentions_and_replies_share_one_ai_cap(self):
        self.run_once([self.item(), self.item("101", "998", "at")])
        self.assertEqual(self.backend.draft_stranger.call_count, 1)
        self.assertEqual(self.backend.reply_notification.call_count, 2)
        self.assertEqual(self.backend.reply_notification.call_args.args[1], LIMIT_REPLY_TEXT)
        counts = self.ledger.counts(day_at(self.now))
        self.assertEqual(counts["strangerReply"]["success"], 1)
        self.assertEqual(counts["strangerNotice"]["success"], 1)

    def test_zero_cap_never_drafts_and_notifies_each_actor_once_per_day(self):
        self.cfg["strangerDailyMax"] = 0
        self.backend.draft_stranger.side_effect = AssertionError("LLM must not run")
        self.run_once([self.item(), self.item("101"), self.item("102", "998")])
        self.run_once([self.item(), self.item("103")])
        self.backend.draft_stranger.assert_not_called()
        self.assertEqual(self.backend.reply_notification.call_count, 2)
        for call in self.backend.reply_notification.call_args_list:
            self.assertEqual(call.args[1], "token快要用完啦，我的主人不让我回答啦")

    def test_failed_generation_still_consumes_ai_budget(self):
        self.backend.draft_stranger.side_effect = ValueError("model unavailable")
        self.run_once([self.item(), self.item("101", "998")])
        self.assertEqual(self.backend.draft_stranger.call_count, 1)
        self.assertEqual(self.backend.reply_notification.call_args.args[1], LIMIT_REPLY_TEXT)
        self.assertEqual(self.ledger.counts(day_at(self.now))["strangerReply"]["failed"], 1)

    def test_same_incoming_comment_in_two_inboxes_is_only_replied_once(self):
        self.run_once([self.item(), self.item(kind="at")])
        self.run_once([self.item()])
        self.backend.reply_notification.assert_called_once()

    def test_first_enable_and_old_late_arrivals_only_establish_baseline(self):
        self.ledger.set_meta("stranger_baseline", None)
        self.run_once([self.item()])
        self.backend.draft_stranger.assert_not_called()
        old = self.item("102")
        old["time"] -= 30
        self.run_once([old])
        self.backend.reply_notification.assert_not_called()

    def test_owner_messages_are_not_treated_as_strangers(self):
        self.run_once([self.item(actor="123")])
        self.backend.notification_context.assert_not_called()
        self.backend.draft_stranger.assert_not_called()

    def test_disabled_feature_master_or_bili_switch_blocks_fixed_notice_too(self):
        self.cfg["strangerDailyMax"] = 0
        self.cfg["features"]["strangerReply"] = False
        self.run_once([self.item()])
        self.cfg["features"]["strangerReply"] = True
        self.cfg["enabled"] = False
        self.run_once([self.item()])
        self.cfg["enabled"] = True
        self.enabled = False
        self.run_once([self.item()])
        self.backend.reply_notification.assert_not_called()

    def test_send_exception_is_unknown_and_never_retried(self):
        self.backend.reply_notification.side_effect = TimeoutError("connection lost")
        self.run_once([self.item()])
        self.run_once([self.item()])
        self.backend.reply_notification.assert_called_once()
        self.assertEqual(self.ledger.counts(day_at(self.now))["strangerReply"]["unknown"], 1)

    def test_unverified_context_does_not_generate_or_send(self):
        self.backend.notification_context.side_effect = ValueError("actor mismatch")
        self.run_once([self.item()])
        self.backend.draft_stranger.assert_not_called()
        self.backend.reply_notification.assert_not_called()
        self.assertIn("actor mismatch", self.controller.status()["strangerError"])

    def test_batch_limit_defers_messages_without_marking_them_processed(self):
        self.cfg["strangerBatchSize"] = 1
        self.run_once([self.item(), self.item("101", "998")])
        self.assertFalse(self.ledger.incoming_seen(self.controller.notification_key(self.item("101", "998"))))
        self.run_once([self.item("101", "998")])
        self.assertEqual(self.backend.reply_notification.call_count, 2)

    def test_quota_and_receipts_persist_across_restart_and_reset_next_day(self):
        self.run_once([self.item()])
        self.ledger.close()
        self.ledger = AutomationLedger(self.path)
        self.addCleanup(self.ledger.close)
        self.controller.ledger = self.ledger
        self.run_once([self.item(), self.item("101", "998")])
        self.assertEqual(self.backend.draft_stranger.call_count, 1)
        self.now += 86400
        self.run_once([self.item("102", "998")])
        self.assertEqual(self.backend.draft_stranger.call_count, 2)

    def test_turning_off_while_drafting_prevents_dispatch(self):
        def draft(ctx, cfg):
            self.cfg["features"]["strangerReply"] = False
            return "hello"
        self.backend.draft_stranger.side_effect = draft
        self.run_once([self.item()])
        self.backend.reply_notification.assert_not_called()


class StrangerRuntimeTest(unittest.TestCase):
    def setUp(self):
        self.cfg = copy.deepcopy(DEFAULT_AUTOMATION)
        self.handler = Mock()
        self.handler._bili_tools_cfg.return_value = {"comment": True}
        self.model = Mock()
        self.runtime = BiliRuntime(lambda: self.handler, lambda: self.model,
            lambda: {"identity": "大肥鱼", "user_profile": "secret-owner-profile"}, ".", ".")

    def test_nested_reply_keeps_root_and_parent_distinct_and_fixed_text_skips_llm(self):
        self.runtime.command = Mock(side_effect=[{"ok": True}, {"ok": True, "combined": "rpid=789"}])
        self.runtime.helper_command = Mock(return_value={"found": True})
        context = {"aid": "111", "bvid": "BV1JKDbBzETH", "title": "猫咪", "root": "100", "parent_rpid": "200"}
        result = self.runtime.reply_notification(context, LIMIT_REPLY_TEXT, self.cfg)
        args = self.runtime.command.call_args.args[0]
        self.assertEqual(args[args.index("--root") + 1], "100")
        self.assertEqual(args[args.index("--parent") + 1], "200")
        self.assertIn("--conversation-reply", args)
        self.assertNotIn("--once-per-person", args)
        self.runtime.helper_command.assert_called_with(["verify-comment", "111", "BV1JKDbBzETH", "100", "789"], self.cfg)
        self.assertEqual(result["status"], "success")
        self.model.chat.assert_not_called()
        self.model.chat_json.assert_not_called()

    def test_stranger_draft_uses_public_persona_and_does_not_expose_owner_profile(self):
        self.model.chat.return_value = "你好呀"
        self.assertEqual(self.runtime.draft_stranger({"text": "你好"}, self.cfg), "你好呀")
        self.assertNotIn("secret-owner-profile", self.model.chat.call_args.args[0])
        self.assertIn("对方不是主人", self.model.chat.call_args.args[0])

    def test_notifications_ignore_self_nonvideo_and_invalid_ids(self):
        row = {"business": 1, "kind": "reply", "oid": "111", "rpid": "222", "mid": "999", "root": "0", "time": 1}
        self.runtime.helper_command = Mock(return_value={"self": "555", "items": [row, {**row, "mid": "555"}, {**row, "business": 11}, {**row, "rpid": "bad"}]})
        items = self.runtime.notifications(self.cfg)
        self.assertEqual(len(items), 1)
        self.assertEqual(items[0]["root"], "222")

    def test_invalid_cap_rejected_without_silent_coercion(self):
        for value in (-1, 1.5, True, 501):
            with self.subTest(value=value), self.assertRaises(ValueError):
                validate_config({"strangerDailyMax": value})


if __name__ == "__main__":
    unittest.main()
