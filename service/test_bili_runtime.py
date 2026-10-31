"""Validate Bilibili drafts and wire routing without platform writes."""
import copy
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import Mock, patch
from types import SimpleNamespace
import json

from bili_automation import DEFAULT_AUTOMATION, validate_config
from bili_runtime import BiliRuntime, parse_cli_failure


class RuntimeTest(unittest.TestCase):
    def setUp(self):
        self.cfg = copy.deepcopy(DEFAULT_AUTOMATION)
        self.handler = Mock()
        self.handler._bili_tools_cfg.return_value = {"feed": True, "video-content": True, "comments": True, "comment": True, "dm": True}
        self.handler._load_bili_whale.return_value = {"owner": {"mid": "123", "name": "主人"}}
        self.model = Mock()
        self.runtime = BiliRuntime(lambda: self.handler, lambda: self.model,
            lambda: {"identity": "你是大肥鱼", "constitution": "自然说话", "user_profile": "owner-private-profile"}, ".", ".")
        self.material = {"bvid": "BV1JKDbBzETH", "aid": "111", "title": "猫咪", "content": "猫咪合集",
                         "comments": [{"rpid": "100", "mid": "999", "text": "都是猫才", "replies": 1}]}
        self.draft = {"score": 18, "reason": "猫咪行为有趣而且切合主人的偏好", "summary": "猫咪合集",
                      "recommend": "快来看看", "comment": "这群猫好可爱", "interact": {"parent_rpid": "100", "text": "猫才这个说法太贴切了"}}

    def test_public_draft_does_not_include_owner_private_profile(self):
        self.model.chat_json.return_value = self.draft
        result = self.runtime.draft_video(self.material, self.cfg)
        self.assertNotIn("owner-private-profile", self.model.chat_json.call_args.args[0])
        self.assertEqual(result["interact"]["parent_rpid"], "100")

    def test_comment_expression_can_cross_the_old_180_character_boundary(self):
        self.runtime._comment_needs_video = Mock(return_value=False)
        self.runtime.style_text = lambda text: text + ' (´-ω-`) 🌙'
        self.model.chat.return_value = '字' * 180
        result = self.runtime.draft_owner_comment({'text': '你好'}, self.cfg)
        self.assertEqual(result, '字' * 180 + ' (´-ω-`) 🌙')
        self.assertNotIn('最多180字', self.model.chat.call_args.args[0])

    def test_dm_reply_is_not_rejected_at_the_old_260_or_280_character_limits(self):
        self.runtime.helper_command = Mock(return_value={'self': '555', 'messages': []})
        self.model.chat.return_value = '详细回应。' * 100
        result = self.runtime.draft_dm({'key': 'new', 'ts': 102, 'text': '展开说说'}, self.cfg)
        self.assertEqual(result, self.model.chat.return_value)
        self.assertNotIn('最多260字', self.model.chat.call_args.args[0])

    def test_public_drafts_keep_full_text_and_expressions_without_a_local_word_cap(self):
        text = '完整观点。' * 100
        self.model.chat_json.return_value = {**self.draft, 'comment': text,
            'interact': {'parent_rpid': '100', 'text': text}}
        self.runtime.style_text = lambda value: value + ' 🌙'
        result = self.runtime.draft_video(self.material, self.cfg)
        self.assertEqual(result['comment'], text + ' 🌙')
        self.assertEqual(result['interact']['text'], text + ' 🌙')

    def test_legacy_draft_length_setting_is_accepted_and_removed_from_resolved_config(self):
        cfg = validate_config({'maxDraftChars': 180})
        self.assertNotIn('maxDraftChars', cfg)

    def test_text_style_settings_are_shared_by_public_and_private_prompts(self):
        self.runtime.style = lambda: {"textStyleEnabled": True, "kaomojiRate": 0.5, "emojiRate": 0}
        for private in (False, True):
            prompt = self.runtime.persona_prompt(private=private)
            self.assertIn("颜文字和 emoji 由宿主", prompt)
            self.assertIn("每条回复独立抽签", prompt)
            self.assertIn("图库配图仅从本轮提供的候选中选择", prompt)

    def test_text_style_off_does_not_force_a_frequency(self):
        self.runtime.style = lambda: {"textStyleEnabled": False, "kaomojiRate": 1}
        self.assertNotIn("颜文字：", self.runtime.persona_prompt())

    def test_one_hundred_percent_requests_both_text_expressions_in_this_reply(self):
        self.runtime.style = lambda: {"textStyleEnabled": True, "kaomojiRate": 1, "emojiRate": 1}
        prompt = self.runtime.persona_prompt()
        self.assertIn("颜文字和 emoji 由宿主", prompt)
        self.assertIn("正文不要主动添加语气表情", prompt)

    def test_model_cannot_invent_an_interaction_target(self):
        self.model.chat_json.return_value = {**self.draft, "interact": {"parent_rpid": "not-in-thread", "text": "hello"}}
        self.assertIsNone(self.runtime.draft_video(self.material, self.cfg)["interact"])

    def test_invalid_model_json_prevents_drafting(self):
        self.model.chat_json.return_value = {"score": "18"}
        with self.assertRaises(ValueError):
            self.runtime.draft_video(self.material, self.cfg)

    def test_recommendation_uses_real_owner_and_verifies_mention(self):
        self.runtime.command = Mock(side_effect=[{"ok": True}, {"ok": True, "combined": "已发布 rpid=456"}])
        self.runtime.helper_command = Mock(return_value={"found": True, "mentions": ["123"]})
        result = self.runtime.publish("recommend", self.material, self.draft, self.cfg)
        args = self.runtime.command.call_args_list[1].args[0]
        self.assertEqual(args[args.index("--message") + 1], "@主人 快来看看")
        self.assertIn("--share", args)
        self.assertIn("--auto", args)
        self.assertEqual(result["status"], "success")

    def test_interaction_posts_to_selected_parent_without_mentioning_owner(self):
        self.runtime.command = Mock(side_effect=[{"ok": True}, {"ok": True, "combined": "已发布 rpid=789"}])
        self.runtime.helper_command = Mock(return_value={"found": True, "mentions": []})
        result = self.runtime.publish("interact", self.material, self.draft, self.cfg)
        args = self.runtime.command.call_args_list[1].args[0]
        self.assertEqual(args[args.index("--parent") + 1], "100")
        self.assertNotIn("@主人", args[args.index("--message") + 1])
        self.assertEqual(result["status"], "success")

    def test_missing_public_readback_is_unknown_instead_of_success(self):
        self.runtime.command = Mock(side_effect=[{"ok": True}, {"ok": True, "combined": "已发布 rpid=456"}])
        self.runtime.helper_command = Mock(return_value={"found": False})
        self.assertEqual(self.runtime.publish("comment", self.material, self.draft, self.cfg)["status"], "unknown")

    def test_disabled_tool_fails_before_submitting_any_request(self):
        self.handler._bili_tools_cfg.return_value = {"comment": False}
        self.runtime.command = Mock()
        result = self.runtime.publish("comment", self.material, self.draft, self.cfg)
        self.assertEqual(result["status"], "failed")
        self.runtime.command.assert_not_called()

    def test_dm_reply_uses_owner_private_context_and_checks_outgoing_history(self):
        self.runtime.helper_command = Mock(return_value={"self": "555", "messages": []})
        self.model.chat.return_value = "晚上好，主人"
        message = {"mid": "123", "text": "晚上好", "key": "test-key", "ts": 102}
        self.assertEqual(self.runtime.draft_dm(message, self.cfg), "晚上好，主人")
        self.assertIn("owner-private-profile", self.model.chat.call_args.args[0])

    def test_dm_context_reset_filters_old_history_but_preserves_current_message(self):
        with tempfile.TemporaryDirectory() as directory:
            self.runtime.data_dir = Path(directory)
            rows = [{"ts": 99, "key": "old", "sender": "123", "text": "旧消息"},
                    {"ts": 100, "key": "same-old", "sender": "555", "text": "旧回复"},
                    {"ts": 100, "key": "same-new", "sender": "123", "text": "同秒新消息"},
                    {"ts": 101, "key": "new", "sender": "123", "text": "新消息"}]
            self.runtime.helper_command = Mock(return_value={"self": "555", "messages": rows})
            self.model.chat.return_value = "好的"
            path = Path(directory) / "bili-dm-context.json"
            path.write_text(json.dumps({"version": 1, "owner": "123", "timestamp": 100, "excludedKeys": ["same-old"]}), encoding="utf-8")
            self.runtime.draft_dm({"text": "当前私信", "key": "current", "ts": 102}, self.cfg)
            context = json.loads(self.model.chat.call_args.args[1])
            self.assertEqual([item["text"] for item in context["recent"]], ["同秒新消息", "新消息"])
            self.assertEqual(context["message"], "当前私信")
            path.write_text(json.dumps({"version": 1, "owner": "123", "timestamp": 100, "excludedKeys": [], "excludeEqual": True}), encoding="utf-8")
            self.runtime.draft_dm({"text": "当前私信", "key": "current", "ts": 102}, self.cfg)
            self.assertEqual([item["text"] for item in json.loads(self.model.chat.call_args.args[1])["recent"]], ["新消息"])
            path.write_text("broken", encoding="utf-8")
            with self.assertRaises(ValueError):
                self.runtime.draft_dm({"text": "当前私信", "key": "current", "ts": 102}, self.cfg)

    def test_dm_single_reply_cannot_see_the_next_unacknowledged_question(self):
        rows = [{"ts": 100, "key": "old", "sender": "555", "text": "旧回复"},
                {"ts": 101, "key": "first", "sender": "123", "text": "表情包可爱"},
                {"ts": 101, "key": "second", "sender": "123", "text": "你爸爸是谁"}]
        self.runtime.helper_command = Mock(return_value={"self": "555", "messages": rows})
        self.model.chat.return_value = "喜欢就好"
        self.runtime.draft_dm({"text": "表情包可爱", "key": "first", "ts": 101}, self.cfg)
        context = json.loads(self.model.chat.call_args.args[1])
        self.assertEqual(context['recent'], [{"from": "你", "text": "旧回复"}])
        self.assertNotIn('你爸爸是谁', self.model.chat.call_args.args[1])

    def test_dm_batch_drafts_once_without_later_arrivals_or_duplicate_current_context(self):
        batch = [{"ts": 101, "key": "first", "text": "表情包可爱"},
                 {"ts": 101, "key": "second", "text": "你爸爸是谁"}]
        rows = [{"ts": 100, "key": "old", "sender": "555", "text": "旧回复"},
                *[{**row, "sender": "123"} for row in batch],
                {"ts": 102, "key": "third", "sender": "123", "text": "之后的新问题"}]
        self.runtime.helper_command = Mock(return_value={"self": "555", "messages": rows})
        self.model.chat.return_value = "统一回复"
        self.runtime.draft_dm({"text": "表情包可爱\n你爸爸是谁", "key": "second", "ts": 101, "messages": batch}, self.cfg)
        context = json.loads(self.model.chat.call_args.args[1])
        self.assertEqual(context['recent'], [{"from": "你", "text": "旧回复"}])
        self.assertEqual(context['message'], '表情包可爱\n你爸爸是谁')
        self.assertNotIn('之后的新问题', self.model.chat.call_args.args[1])
        self.assertEqual(self.model.chat.call_count, 1)

    def test_dm_history_missing_anchor_excludes_equal_second_and_later_messages(self):
        rows = [{"ts": 100, "key": "old"}, {"ts": 101, "key": "other"}, {"ts": 102, "key": "later"}]
        self.assertEqual(self.runtime._dm_history_before(rows, {"ts": 101, "key": "missing"}), [rows[0]])

    def test_dm_peek_validates_batch_without_advancing_the_delivery_cursor(self):
        batch = [{"ts": 101, "key": "first", "text": "第一条"}, {"ts": 101, "key": "second", "text": "第二条"}]
        message = {"mid": "123", "text": "第一条\n第二条", "key": "second", "ts": 101, "receipt": "r", "messages": batch}
        self.runtime.command = Mock(return_value={"ok": True, "stdout": json.dumps(message)})
        self.assertEqual(self.runtime.dm_peek(self.cfg), message)
        self.assertEqual(self.runtime.command.call_args.args[0], ['dm-await', '--peek', '--batch', '--json'])
        for invalid in ({**message, 'ts': 102}, {**message, 'text': '不完整'}, {**message, 'messages': []}):
            self.runtime.command.return_value = {"ok": True, "stdout": json.dumps(invalid)}
            with self.assertRaises(ValueError):
                self.runtime.dm_peek(self.cfg)

    def test_pre_dispatch_cooldown_is_definitely_not_a_submitted_write(self):
        result = self.runtime._failure({"combined": "code: 'BILI_TRAFFIC_PAUSED', cooldownMs: 64061"}, submitted=True)
        self.assertEqual(result["status"], "failed")
        self.assertIn("未提交", result["error"])

    def test_structured_budget_failure_is_unsent_and_retains_retry_time(self):
        result = self.runtime._failure({"combined": "truncated diagnostic", "failure": {
            "code": "BILI_TRAFFIC_PAUSED", "reason": "write-budget", "submission": "not-sent",
            "message": "本地写入额度已用完", "retryAt": 1793193600000}}, submitted=True)
        self.assertEqual(result["status"], "failed")
        self.assertEqual(result["retryAt"], 1793193600)
        self.assertEqual(result["submission"], "not-sent")
        self.assertNotIn("truncated diagnostic", result["error"])

    def test_duplicate_failure_never_becomes_safe_to_resend(self):
        result = self.runtime._failure({"combined": "", "failure": {
            "code": "BILI_TRAFFIC_PAUSED", "reason": "duplicate", "submission": "unknown",
            "message": "同一操作已提交"}}, submitted=True)
        self.assertEqual(result["status"], "unknown")

    def test_cli_receipt_is_read_before_stderr_is_truncated(self):
        from server import Handler
        failure = {"code": "BILI_TRAFFIC_PAUSED", "reason": "write-budget", "submission": "not-sent", "message": "等待本地额度恢复"}
        stderr = "BILI_FAILURE_JSON=" + json.dumps(failure) + "\n" + "diagnostic\n" * 1000
        handler = object.__new__(Handler)
        with patch("subprocess.run", return_value=SimpleNamespace(returncode=1, stdout="", stderr=stderr)):
            result = handler._run_bili(["dm", "--dry"])
        self.assertEqual(result["failure"], failure)
        self.assertLessEqual(len(result["stderr"]), 1500)

    def test_invalid_cli_receipts_do_not_claim_a_safe_retry(self):
        for value in ({"submission": "not-sent"}, {"code": "x", "reason": "x", "message": "x", "submission": "not-sent", "retryAt": True}):
            self.assertIsNone(parse_cli_failure("BILI_FAILURE_JSON=" + json.dumps(value)))

    def test_failed_preflight_does_not_wait_or_submit(self):
        self.runtime.command = Mock(return_value={"ok": False, "combined": "invalid input"})
        self.runtime.helper_command = Mock()
        self.assertEqual(self.runtime.publish("comment", self.material, self.draft, self.cfg)["status"], "failed")
        self.assertEqual(self.runtime.command.call_count, 1)
        self.runtime.helper_command.assert_not_called()

    def test_independent_comment_cannot_bypass_recommendation_quota_with_mentions(self):
        self.runtime.command = Mock()
        draft = {**self.draft, "comment": "@主人 快来看"}
        self.assertEqual(self.runtime.publish("comment", self.material, draft, self.cfg)["status"], "failed")
        self.runtime.command.assert_not_called()


if __name__ == "__main__":
    unittest.main()
