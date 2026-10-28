"""Persona cards retain old settings and isolate the selected channel prompts."""
import sqlite3
import unittest

import persona_cards
from bili_runtime import BiliRuntime


class PersonaCardsTest(unittest.TestCase):
    def setUp(self):
        self.db = sqlite3.connect(":memory:")
        self.db.row_factory = sqlite3.Row
        self.db.execute("PRAGMA foreign_keys=ON")
        self.db.executescript("""
            CREATE TABLE persona_card(id TEXT PRIMARY KEY,name TEXT NOT NULL,prompt TEXT NOT NULL,created_at REAL NOT NULL,updated_at REAL NOT NULL);
            CREATE TABLE persona_channel(channel TEXT PRIMARY KEY,card_id TEXT NOT NULL REFERENCES persona_card(id) ON DELETE RESTRICT);
        """)
        self.old = {"identity": '{"personality":"旧脾气","free":"旧自由设定"}', "constitution": "旧身份", "self_image": "旧形象"}
        persona_cards.initialize(self.db, self.old)

    def tearDown(self):
        self.db.close()

    def test_migrates_once_and_retains_old_fields(self):
        first = persona_cards.read(self.db)
        self.assertEqual(first["active"], {"qq": "legacy", "bili": "legacy"})
        self.assertIn("旧脾气", first["cards"][0]["prompt"])
        self.assertIn("旧身份", first["cards"][0]["prompt"])
        persona_cards.initialize(self.db, {"constitution": "new"})
        self.assertEqual(persona_cards.read(self.db), first)

    def test_create_edit_select_and_delete_are_channel_specific(self):
        new = persona_cards.change(self.db, {"action": "create", "name": "鲸汐", "prompt": "第一行\n第二行 {{test}}"})
        card_id = new["changed_id"]
        persona_cards.change(self.db, {"action": "select", "channel": "qq", "id": card_id})
        current = persona_cards.read(self.db)
        self.assertEqual(current["active"], {"qq": card_id, "bili": "legacy"})
        self.assertEqual(current["cards"][1]["prompt"], "第一行\n第二行 {{test}}")
        with self.assertRaisesRegex(ValueError, "正在使用"):
            persona_cards.change(self.db, {"action": "delete", "id": card_id})
        persona_cards.change(self.db, {"action": "update", "id": card_id, "name": "鲸汐二", "prompt": "新设定"})
        persona_cards.change(self.db, {"action": "select", "channel": "qq", "id": "legacy"})
        persona_cards.change(self.db, {"action": "delete", "id": card_id})
        self.assertEqual(len(persona_cards.read(self.db)["cards"]), 1)

    def test_invalid_writes_do_not_change_the_library(self):
        before = persona_cards.read(self.db)
        for body in ({"action": "select", "channel": "qq", "id": "missing"},
                     {"action": "create", "name": " ", "prompt": "x"},
                     {"action": "create", "name": "x", "prompt": " "},
                     {"action": "update", "id": "missing", "name": "x", "prompt": "y"}):
            with self.assertRaises(ValueError):
                persona_cards.change(self.db, body)
            self.assertEqual(persona_cards.read(self.db), before)

    def test_bili_uses_only_selected_card_and_owner_profile_is_private(self):
        result = persona_cards.change(self.db, {"action": "create", "name": "鲸汐", "prompt": "鲸汐的完整设定"})
        persona_cards.change(self.db, {"action": "select", "channel": "bili", "id": result["changed_id"]})
        data = {**self.old, "user_profile": "私人画像", "persona_cards": persona_cards.read(self.db)}
        runtime = BiliRuntime(lambda: None, lambda: None, lambda: data, ".", ".")
        public = runtime.persona_prompt()
        self.assertEqual(public, "鲸汐的完整设定")
        self.assertEqual(runtime.persona_prompt(private=True), "鲸汐的完整设定\n\n私人画像")
        self.assertNotIn("旧脾气", public)


if __name__ == "__main__":
    unittest.main()
