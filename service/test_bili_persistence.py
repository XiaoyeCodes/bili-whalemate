"""B 站设置的批量提交、并发合并和文件写入失败回归测试。"""
import json
import tempfile
import time
import unittest
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from unittest.mock import patch

import server


class BiliPersistenceTest(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.path = Path(self.directory.name, "bili.json")
        self.path.write_text('{"existing": true}\n', encoding="utf-8")

    def handler(self, body=None):
        handler = object.__new__(server.Handler)
        handler.BILI_WHALE_CFG = str(self.path)
        handler._body = lambda: body
        handler._json = lambda status, value: setattr(handler, "result", (status, value))
        return handler

    def test_batch_is_readable_by_a_new_handler_and_preserves_other_settings(self):
        changes = [
            {"path": ["preferences", "like"], "value": ["萌宠", "人工智能", "大肥鱼"]},
            {"path": ["preferences", "dislike"], "value": ["恐怖"]},
            {"path": ["owner"], "value": {"mid": "123456", "name": "主人"}},
        ]
        handler = self.handler({"updates": changes})
        handler._set_bili_cfg()
        self.assertEqual(handler.result[0], 200)
        cfg = self.handler()._load_bili_whale()
        self.assertTrue(cfg["existing"])
        for change in changes:
            value = cfg
            for key in change["path"]:
                value = value[key]
            self.assertEqual(value, change["value"])

    def test_concurrent_legacy_field_requests_keep_every_field(self):
        original = server.Handler._load_bili_whale

        def slow_load(handler):
            value = original(handler)
            time.sleep(0.01)
            return value

        def save(index):
            handler = self.handler({"path": ["fields", str(index)], "value": index})
            handler._set_bili_cfg()
            self.assertEqual(handler.result[0], 200)

        with patch.object(server.Handler, "_load_bili_whale", slow_load):
            with ThreadPoolExecutor(max_workers=8) as pool:
                list(pool.map(save, range(24)))
        self.assertEqual(self.handler()._load_bili_whale()["fields"], {str(i): i for i in range(24)})

    def test_invalid_batch_keeps_all_original_bytes(self):
        before = self.path.read_bytes()
        handler = self.handler()
        with self.assertRaises(ValueError):
            handler._update_bili_whale([
                {"path": ["preferences", "like"], "value": ["萌宠"]},
                {"path": [], "value": "invalid"},
            ])
        self.assertEqual(self.path.read_bytes(), before)

    def test_replace_failure_keeps_original_config_and_removes_temporary_file(self):
        before = self.path.read_bytes()
        with patch.object(server.os, "replace", side_effect=PermissionError("test failure")):
            with self.assertRaises(PermissionError):
                self.handler()._update_bili_whale([{"path": ["new"], "value": True}])
        self.assertEqual(self.path.read_bytes(), before)
        self.assertEqual(list(self.path.parent.iterdir()), [self.path])

    def test_corrupt_json_is_reported_without_overwriting_it(self):
        self.path.write_text('{"unfinished":', encoding="utf-8")
        before = self.path.read_bytes()
        with self.assertRaises(ValueError):
            self.handler()._update_bili_whale([{"path": ["new"], "value": True}])
        self.assertEqual(self.path.read_bytes(), before)


if __name__ == "__main__":
    unittest.main()
