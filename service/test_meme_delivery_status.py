"""Delivery reports retain only the latest channel result and preserve send restrictions."""
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
from types import SimpleNamespace
import server


class DeliveryStatusTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.patch = patch.object(server, "DATA_DIR", self.temp.name)
        self.patch.start(); self.addCleanup(self.patch.stop)
        self.controller = patch.object(server, "bili_automation", None)
        self.controller.start(); self.addCleanup(self.controller.stop)
        self.handler = object.__new__(server.Handler)
        self.handler._json = lambda status, value: setattr(self, "response", (status, value))

    def test_reports_keep_only_the_latest_result_without_chat_text(self):
        for reason in ("已配表情包", "没有适合当前回复的图片"):
            self.handler._body = lambda: {"channel": "web", "status": "skipped", "reason": reason, "user": "private chat"}
            self.handler._set_meme_delivery_status()
        self.handler._get_meme_delivery_status()
        self.assertEqual(self.response[1]["web"]["reason"], reason)
        self.assertNotIn("private chat", Path(self.temp.name, "meme-delivery-status.json").read_text(encoding="utf-8"))

    def test_invalid_channel_status_and_reason_do_not_create_a_report(self):
        for body in ({"channel": "other", "status": "sent", "reason": "x"},
                     {"channel": "web", "status": "other", "reason": "x"},
                     {"channel": "web", "status": "sent", "reason": []}):
            self.handler._body = lambda: body
            with self.assertRaises(ValueError): self.handler._set_meme_delivery_status()
        self.assertFalse(Path(self.temp.name, "meme-delivery-status.json").exists())

    def test_bilibili_budget_error_is_visible_without_changing_the_controller(self):
        controller = SimpleNamespace(status=lambda: {"dmError": "今日额度已用完，零点后重试"})
        with patch.object(server, "bili_automation", controller):
            self.handler._get_meme_delivery_status()
        self.assertEqual(self.response[1]["bili"], {"status": "failed", "reason": "今日额度已用完，零点后重试"})
