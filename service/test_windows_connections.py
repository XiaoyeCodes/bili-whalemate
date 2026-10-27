"""Regression checks for local Windows login and QQ configuration."""
import base64
import http.cookiejar
import io
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
import server


class ConnectionsTest(unittest.TestCase):
    def handler(self):
        handler = object.__new__(server.Handler)
        handler._json = lambda code, value: setattr(handler, "result", (code, value))
        return handler

    def test_qq_config_uses_native_instance_without_linux_profile(self):
        with tempfile.TemporaryDirectory() as tmp, patch.object(server, "QQ_DATA_DIR", tmp):
            Path(tmp, "config.json").write_text(json.dumps({"adminQq": 12345678}), encoding="utf-8")
            handler = self.handler()
            handler._get_qq_config()
            status, result = handler.result
            self.assertEqual(status, 200)
            self.assertEqual(result["path"], str(Path(tmp, "config.json")))
            self.assertTrue(result["native"])
            self.assertEqual(handler._qq_admin_users(), {"12345678"})

    def test_unconfigured_qq_console_remains_readable(self):
        with tempfile.TemporaryDirectory() as tmp, patch.object(server, "QQ_DATA_DIR", tmp):
            handler = self.handler()
            handler._get_qq_config()
            self.assertEqual(handler.result[0], 200)
            self.assertFalse(handler.result[1]["configured"])
            self.assertEqual(handler._qq_admin_users(), set())

    def test_qrcode_is_an_actual_svg(self):
        payload = {"data": {"url": "https://example.test/login", "qrcode_key": "test-qr"}}
        with patch("urllib.request.urlopen", return_value=io.BytesIO(json.dumps(payload).encode())):
            result = self.handler()._bili_qr()
        self.assertTrue(result["ok"])
        svg = base64.b64decode(result["svg"].split(",", 1)[1])
        self.assertIn(b"<svg", svg)
        self.assertEqual(result["key"], "test-qr")

    def test_pending_qr_does_not_create_credentials(self):
        with tempfile.TemporaryDirectory() as tmp, patch.object(server, "USER_HOME", tmp):
            opener = unittest.mock.Mock()
            opener.open.return_value = io.BytesIO(b'{"data":{"code":86101}}')
            with patch("urllib.request.build_opener", return_value=opener):
                result = self.handler()._bili_qr_poll("test-qr")
            self.assertFalse(result["saved"])
            self.assertFalse(Path(tmp, ".bili-ai", "credentials.json").exists())

    def test_confirmed_login_saves_under_windows_user_home_and_verifies(self):
        with tempfile.TemporaryDirectory() as tmp, patch.object(server, "USER_HOME", tmp):
            jar = http.cookiejar.CookieJar()
            for name in ("SESSDATA", "bili_jct"):
                jar.set_cookie(http.cookiejar.Cookie(0, name, "test-value", None, False,
                    ".bilibili.com", True, True, "/", True, False, None, True, None, None, {}))
            opener = unittest.mock.Mock()
            opener.open.return_value = io.BytesIO(b'{"data":{"code":0}}')
            handler = self.handler()
            handler._run_bili = unittest.mock.Mock(return_value={"ok": True, "stdout": "verified"})
            with patch("http.cookiejar.CookieJar", return_value=jar), patch("urllib.request.build_opener", return_value=opener):
                result = handler._bili_qr_poll("test-qr")
            path = Path(tmp, ".bili-ai", "credentials.json")
            self.assertTrue(result["saved"])
            self.assertTrue(result["verify_ok"])
            self.assertEqual(json.loads(path.read_text(encoding="utf-8"))["sessdata"], "test-value")
            handler._run_bili.assert_called_once_with(["session"], timeout=40)

    def test_qq_login_redirect_stays_local_and_is_not_cacheable(self):
        with tempfile.TemporaryDirectory() as tmp, patch.object(server, "DSH_ROOT", tmp):
            path = Path(tmp, "sources", "NapCat", "napcat", "config", "webui.json")
            path.parent.mkdir(parents=True)
            path.write_text(json.dumps({"port": 6099, "token": "test-token"}), encoding="utf-8")
            handler = self.handler()
            headers = {}
            handler.send_response = lambda code: setattr(handler, "response_code", code)
            handler.send_header = lambda name, value: headers.update({name: value})
            handler.end_headers = lambda: None
            handler._qq_login_redirect()
            self.assertEqual(handler.response_code, 302)
            self.assertEqual(headers["Location"], "http://127.0.0.1:6099/webui?token=test-token")
            self.assertEqual(headers["Cache-Control"], "no-store")


if __name__ == "__main__":
    unittest.main()
