"""Draft selection, public image verification and partial private delivery guarantees."""
import copy
import time
import unittest
from unittest.mock import Mock
from bili_automation import DEFAULT_AUTOMATION, LIMIT_REPLY_TEXT
from bili_runtime import BiliRuntime


class GalleryRuntimeTest(unittest.TestCase):
    def setUp(self):
        self.cfg = copy.deepcopy(DEFAULT_AUTOMATION)
        self.cfg["pictureVerifySeconds"] = 0
        self.handler = Mock()
        self.handler._bili_tools_cfg.return_value = {"comment": True, "dm": True}
        self.handler._load_bili_whale.return_value = {"owner": {"mid": "123", "name": "主人"}}
        self.model, self.gallery = Mock(), Mock()
        self.gallery.offer.return_value = [{"file": "hello.png", "caption": "你好"}]
        self.gallery.selected.side_effect = lambda value, offered: value if value in (None, "hello.png") else (_ for _ in ()).throw(ValueError("not offered"))
        self.runtime = BiliRuntime(lambda: self.handler, lambda: self.model,
            lambda: {"identity": "大肥鱼", "user_profile": "private-owner-data"}, ".", ".", style=lambda: {"memeRate": 0.2}, gallery=self.gallery)
        self.picture = {"image_url": "https://i0.hdslb.com/bfs/new_dyn/hello.png", "image_width": 1, "image_height": 1, "img_size": 1, "imageType": "png"}
        self.material = {"bvid": "BV1JKDbBzETH", "aid": "111", "title": "猫咪", "root": "100", "parent_rpid": "200"}

    def test_owner_dm_chooses_a_real_candidate_with_one_model_call(self):
        self.model.chat_json.return_value = {"text": "你好呀", "meme_file": "hello.png"}
        self.runtime.helper_command = Mock(return_value={"messages": []})
        draft = self.runtime.draft_dm({"text": "你好"}, self.cfg)
        self.assertEqual(draft["meme_file"], "hello.png")
        self.model.chat_json.assert_called_once()
        self.assertFalse(self.model.chat_json.call_args.kwargs["thinking"])
        self.assertTrue(self.model.chat_json.call_args.kwargs["strict"])
        self.gallery.offer.assert_called_once_with(0.2, query="  你好 ")

    def test_stranger_thread_draft_does_not_offer_gallery_images(self):
        self.model.chat_json.side_effect = [{'needs_video': False}, {"text": "你好呀", "meme_file": None}]
        draft = self.runtime.draft_stranger({"text": "你好"}, self.cfg)
        self.assertIsNone(draft["meme_file"])
        self.gallery.offer.assert_not_called()
        self.assertNotIn("private-owner-data", self.model.chat_json.call_args.args[0])

    def test_reply_thinking_can_be_enabled_by_saved_configuration(self):
        self.cfg["replyThinkingEnabled"] = True
        self.model.chat_json.side_effect = [{'needs_video': False}, {"text": "你好", "meme_file": None}]
        self.runtime.draft_stranger({"text": "你好"}, self.cfg)
        self.assertTrue(self.model.chat_json.call_args.kwargs["thinking"])

    def test_empty_reply_failure_stops_before_any_bilibili_write(self):
        from llm import LLMRequestFailure
        self.model.chat_json.side_effect = LLMRequestFailure("EMPTY_CONTENT", "模型返回空白回复")
        self.runtime.command = Mock()
        with self.assertRaisesRegex(LLMRequestFailure, "空白"):
            self.runtime.draft_stranger({"text": "你好"}, self.cfg)
        self.model.chat_json.assert_called_once()
        self.runtime.command.assert_not_called()

    def test_thread_publisher_ignores_a_supplied_image_and_sends_no_image_link(self):
        self.runtime.command = Mock(side_effect=[{"ok": True}, {"ok": True, "combined": "rpid=456"}])
        self.runtime._wait_write = Mock()
        self.runtime._upload_meme = Mock()
        self.runtime.helper_command = Mock(return_value={"found": True})
        result = self.runtime.reply_notification(self.material, {"text": "你好", "meme_file": "hello.png"}, self.cfg)
        self.assertEqual(result["text"], "你好")
        self.runtime._upload_meme.assert_not_called()
        self.assertNotIn("--picture-data", self.runtime.command.call_args.args[0])
        self.assertNotIn("https://", result["text"])

    def test_owner_reply_removes_redundant_owner_mentions_before_publication(self):
        self.runtime.publish = Mock(return_value={"status": "success"})
        self.runtime.reply_notification({**self.material, "is_owner": True, "actorName": "主人"}, {"text": "@老大 你好", "meme_file": None}, self.cfg)
        self.assertEqual(self.runtime.publish.call_args.args[2]["ownerReply"], "老大 你好")

    def test_invented_filename_prevents_dispatch(self):
        self.model.chat_json.side_effect = [{'needs_video': False}, {"text": "你好", "meme_file": "../../other.png"}]
        with self.assertRaises(ValueError):
            self.runtime.draft_stranger({}, self.cfg)
        self.gallery.prepare.assert_not_called()

    def test_image_comment_requires_the_expected_picture_in_public_readback(self):
        self.runtime.command = Mock(side_effect=[{"ok": True}, {"ok": True, "combined": "rpid=456"}])
        self.runtime._upload_meme = Mock(return_value=self.picture)
        self.runtime._wait_write = Mock()
        self.runtime.helper_command = Mock(return_value={"found": True, "pictures": [{"url": self.picture["image_url"]}]})
        result = self.runtime.publish("comment", self.material, {"comment": "可爱", "meme_file": "hello.png"}, self.cfg)
        self.assertTrue(result["pictureVerified"])
        self.assertIn("--picture-data", self.runtime.command.call_args.args[0])
        self.gallery.mark.assert_called_once_with("hello.png")

    def test_visible_text_without_its_picture_is_unknown_and_does_not_mark_usage(self):
        self.runtime.command = Mock(side_effect=[{"ok": True}, {"ok": True, "combined": "rpid=456"}])
        self.runtime._upload_meme = Mock(return_value=self.picture)
        self.runtime._wait_write = Mock()
        self.runtime.helper_command = Mock(return_value={"found": True, "pictures": []})
        result = self.runtime.publish("comment", self.material, {"comment": "可爱", "meme_file": "hello.png"}, self.cfg)
        self.assertEqual(result["status"], "unknown")
        self.gallery.mark.assert_not_called()

    def test_upload_failure_can_send_text_without_claiming_a_picture_was_delivered(self):
        self.runtime.command = Mock(side_effect=[{"ok": True}, {"ok": True, "combined": "rpid=456"}])
        self.runtime._upload_meme = Mock(side_effect=ValueError("upload receipt unknown"))
        self.runtime._wait_write = Mock()
        self.runtime.helper_command = Mock(return_value={"found": True})
        result = self.runtime.publish("comment", self.material, {"comment": "可爱", "meme_file": "hello.png"}, self.cfg)
        self.assertEqual(result["status"], "success")
        self.assertNotIn("pictureVerified", result)
        self.assertIn("本条只发送文字", result["mediaWarning"])
        self.gallery.mark.assert_not_called()

    def test_image_readback_waits_without_submitting_a_second_comment(self):
        self.cfg["pictureVerifySeconds"] = 10
        self.runtime.command = Mock(side_effect=[{"ok": True}, {"ok": True, "combined": "rpid=456"}])
        self.runtime._upload_meme = Mock(return_value=self.picture)
        self.runtime._wait_write = Mock()
        self.runtime.helper_command = Mock(side_effect=[{"found": False}, {"found": True, "pictures": [{"url": self.picture["image_url"]}]}])
        from unittest.mock import patch
        with patch("bili_runtime.time.sleep"):
            result = self.runtime.publish("comment", self.material, {"comment": "可爱", "meme_file": "hello.png"}, self.cfg)
        self.assertTrue(result["pictureVerified"])
        self.assertEqual(self.runtime.command.call_count, 2)

    def test_private_image_failure_preserves_verified_text_and_does_not_resend_it(self):
        self.runtime.command = Mock(side_effect=[{"ok": True}, {"ok": True}])
        self.runtime._upload_meme = Mock(return_value=self.picture)
        self.runtime._wait_write = Mock()
        self.runtime.helper_command = Mock(return_value={"self": "555", "messages": [{"sender": "555", "text": "你好", "ts": time.time()}]})
        self.runtime._send_dm_picture = Mock(return_value={"status": "unknown", "error": "unconfirmed"})
        result = self.runtime.send_dm({"key": "one"}, {"text": "你好", "meme_file": "hello.png"}, self.cfg)
        self.assertEqual(result["status"], "success")
        self.assertEqual(result["media"]["status"], "unknown")
        self.assertIn("不重复发送正文", result["mediaWarning"])
        self.assertEqual(self.runtime.command.call_count, 2)
        self.gallery.mark.assert_not_called()

    def test_fixed_exhaustion_notice_never_reads_gallery_or_calls_model(self):
        self.runtime.command = Mock(side_effect=[{"ok": True}, {"ok": True, "combined": "rpid=456"}])
        self.runtime._wait_write = Mock()
        self.runtime.helper_command = Mock(return_value={"found": True})
        result = self.runtime.reply_notification(self.material, LIMIT_REPLY_TEXT, self.cfg)
        self.assertEqual(result["text"], LIMIT_REPLY_TEXT)
        self.gallery.offer.assert_not_called()
        self.gallery.prepare.assert_not_called()
        self.model.chat_json.assert_not_called()


if __name__ == "__main__":
    unittest.main()
