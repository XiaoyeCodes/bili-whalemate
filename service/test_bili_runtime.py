"""Validate Bilibili drafts and wire routing without platform writes."""
import copy
import unittest
from unittest.mock import Mock

from bili_automation import DEFAULT_AUTOMATION
from bili_runtime import BiliRuntime


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

    def test_text_style_settings_are_shared_by_public_and_private_prompts(self):
        self.runtime.style = lambda: {"textStyleEnabled": True, "kaomojiRate": 0.5, "emojiRate": 0}
        for private in (False, True):
            prompt = self.runtime.persona_prompt(private=private)
            self.assertIn("颜文字：大约 50%", prompt)
            self.assertIn("emoji：这次不要使用", prompt)
            self.assertIn("图库配图仅从本轮提供的候选中选择", prompt)

    def test_text_style_off_does_not_force_a_frequency(self):
        self.runtime.style = lambda: {"textStyleEnabled": False, "kaomojiRate": 1}
        self.assertNotIn("颜文字：", self.runtime.persona_prompt())

    def test_one_hundred_percent_requests_both_text_expressions_in_this_reply(self):
        self.runtime.style = lambda: {"textStyleEnabled": True, "kaomojiRate": 1, "emojiRate": 1}
        prompt = self.runtime.persona_prompt()
        self.assertIn("本条回复请在句尾带一个符合语境的颜文字", prompt)
        self.assertIn("本条回复请在句尾带一个符合语境的emoji", prompt)

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
        message = {"mid": "123", "text": "晚上好", "key": "test-key"}
        self.assertEqual(self.runtime.draft_dm(message, self.cfg), "晚上好，主人")
        self.assertIn("owner-private-profile", self.model.chat.call_args.args[0])

    def test_pre_dispatch_cooldown_is_definitely_not_a_submitted_write(self):
        result = self.runtime._failure({"combined": "code: 'BILI_TRAFFIC_PAUSED', cooldownMs: 64061"}, submitted=True)
        self.assertEqual(result["status"], "failed")
        self.assertIn("未提交", result["error"])

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
