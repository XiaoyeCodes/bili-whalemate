"""Installation privacy, preservation and integrity regression tests."""
import copy
from contextlib import closing
import hashlib
import json
from pathlib import Path
import sqlite3
import sys
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "scripts"))
import setup


class SetupTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.bundle, self.home = self.root / "bundle", self.root / "home"
        self.gallery = self.bundle / "gallery"
        self.gallery.mkdir(parents=True)
        (self.gallery / "hello.png").write_bytes(b"fixture-image-bytes")
        for name in ("persona.json", "proactive.json", "bili.json", "bili_tools.json", "bili-whale.config.json", "meme-packs.json", "environment.json", "state-settings.json"):
            setup.save(self.bundle / "seed" / name, setup.load(ROOT / "seed" / name))
        self.row = {"file": "hello.png", "emotion": "happy", "caption": "你好", "keywords": "自动回复禁用", "pack": "dafeiyu"}
        setup.save(self.bundle / "seed/gallery.json", [self.row])
        setup.save(self.bundle / "seed/gallery-manifest.json", [{"file": "hello.png", "bytes": 19, "sha256": hashlib.sha256(b"fixture-image-bytes").hexdigest()}])
        self.patch = patch.object(setup, "ROOT", self.bundle)
        self.patch.start(); self.addCleanup(self.patch.stop)

    def install(self, home=None):
        return setup.setup(home or self.home, "web", "python", "node", self.gallery, 18080, 13081)

    def test_clean_install_has_persona_gallery_and_no_private_history(self):
        self.assertTrue(self.install()["ok"])
        with closing(sqlite3.connect(self.home / "remembers-data/memories.db")) as db:
            for table in ("memory", "profiles", "notes", "diary", "affinity", "meme_seen", "activity_log"):
                self.assertEqual(db.execute(f"select count(*) from {table}").fetchone()[0], 0, table)
            row = db.execute("select constitution,identity,user_profile,self_model from persona").fetchone()
            self.assertIn("大肥鱼", row[0]); self.assertIn("大肥鱼", row[1])
            self.assertEqual(row[2:], ("", ""))
            self.assertEqual(db.execute("select used_count,keywords from meme").fetchone(), (0, "自动回复禁用"))
        self.assertEqual(setup.load(self.home / "bili-whale.config.json")["owner"], {"mid": "", "name": ""})
        self.assertNotIn("llm_key", setup.load(self.home / "remembers-data/config.json"))
        bridge = setup.load(self.home / "remembers-service/official-qq-bridge.json")
        self.assertEqual(bridge["serviceEndpoint"], "http://127.0.0.1:18080")
        self.assertEqual(bridge["memeDir"], str(self.home / "media/whalemate"))

    def test_reinstall_preserves_keys_accounts_history_and_changed_preferences(self):
        self.install()
        data = self.home / "remembers-data"
        setup.save(data / "config.json", {"llm_key": "fixture-key", "llm_model": "local-model", "extract": False})
        cfg = setup.load(self.home / "bili-whale.config.json")
        cfg["owner"] = {"mid": "123", "name": "本机主人"}; cfg["automation"]["enabled"] = False
        setup.save(self.home / "bili-whale.config.json", cfg)
        path = self.home / "remembers-service/official-qq-bridge.json"
        bridge = setup.load(path); bridge["ownerOpenId"] = "fixture-open-id"; setup.save(path, bridge)
        with closing(sqlite3.connect(data / "memories.db")) as db:
            db.execute("update persona set constitution='',identity='local persona'")
            db.execute("update meme set caption='local caption',used_count=7")
            db.commit()
        self.install()
        self.assertEqual(setup.load(data / "config.json")["llm_key"], "fixture-key")
        self.assertFalse(setup.load(data / "config.json")["extract"])
        self.assertEqual(setup.load(path), bridge)
        self.assertEqual(setup.load(self.home / "bili-whale.config.json")["owner"]["mid"], "123")
        with closing(sqlite3.connect(data / "memories.db")) as db:
            self.assertEqual(db.execute("select constitution,identity from persona").fetchone(), ("", "local persona"))
            self.assertEqual(db.execute("select caption,used_count from meme").fetchone(), ("local caption", 7))
            self.assertEqual(db.execute("select count(*) from meme").fetchone()[0], 1)

    def test_each_installation_receives_a_distinct_private_bridge_token(self):
        self.install(); other = self.root / "other"; self.install(other)
        first = setup.load(self.home / "remembers-service/official-qq-bridge.json")
        second = setup.load(other / "remembers-service/official-qq-bridge.json")
        self.assertNotEqual(first["token"], second["token"])
        self.assertEqual(first["ownerOpenId"], ""); self.assertGreaterEqual(len(first["token"]), 32)

    def test_corrupt_gallery_stops_before_creating_target_data(self):
        (self.gallery / "hello.png").write_bytes(b"corrupt")
        with self.assertRaisesRegex(ValueError, "integrity"):
            self.install()
        self.assertFalse(self.home.exists())

    def test_filename_traversal_and_windows_drive_paths_are_rejected(self):
        for value in ("../outside.png", "..\\outside.png", "C:outside.png", "/outside.png", "..", ""):
            with self.subTest(value=value), self.assertRaises(ValueError):
                setup.checked_name(value)

    def test_manifest_catalogue_mismatch_stops_before_writing(self):
        setup.save(self.bundle / "seed/gallery.json", [])
        with self.assertRaisesRegex(ValueError, "differ"):
            self.install()
        self.assertFalse(self.home.exists())

    def test_another_profile_cannot_replace_the_existing_service_owner(self):
        self.install()
        with self.assertRaisesRegex(ValueError, "another profile"):
            setup.setup(self.home, "other", "python", "node", self.gallery)
        self.assertEqual(setup.load(self.home / "whalemate/runtime.json")["profile"], "web")

    def test_yaml_credentials_and_javascript_expressions_survive(self):
        profile = self.home / "profiles/web/cordis.patch.yml"
        profile.parent.mkdir(parents=True)
        profile.write_text("- id: im-qqbot\n  config:\n    appSecret: fixture-secret\n    provider: !!js ctx.example.value\n    sendFile:\n      extraRoots: [existing]\n", encoding="utf-8")
        self.install(); self.install()
        import yaml
        content = profile.read_text(encoding="utf-8")
        self.assertIn("fixture-secret", content); self.assertIn("!!js", content)
        self.assertIn("ctx.example.value", content); self.assertIn("existing", content)
        self.assertEqual(content.count(str(self.home / "media/whalemate")), 1)


if __name__ == "__main__":
    unittest.main()
