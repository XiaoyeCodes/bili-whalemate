"""Automatic stickers require scene relevance and a valid contextual decision."""

import json
import unittest
from types import SimpleNamespace
from unittest.mock import Mock

from meme_matching import rank_candidates, select_for_reply


def sticker(number, caption, keywords, emotion="daily", used=0):
    return {"id": number, "file": f"{number}.webp", "caption": caption,
            "keywords": keywords, "emotion": emotion, "used_count": used}


class MemeMatchingTest(unittest.TestCase):
    def setUp(self):
        self.sleep = sticker(1, "鲸鱼娘抱着鲸鱼玩偶睡觉", "晚安 睡觉 休息", used=50)
        self.food = sticker(2, "鲸鱼娘抱着饭碗", "吃饭 干饭", used=0)
        self.comfort = sticker(3, "先别呜呜，大肥鱼来了", "安慰 抱抱 陪伴", "happy")
        self.mockery = sticker(4, "你才傻！！！", "嘲讽 骂人 自动回复禁用", "angry")
        self.rows = [self.sleep, self.food, self.comfort, self.mockery]

    def test_topic_beats_low_usage_and_shared_emotion(self):
        results = rank_candidates(self.rows, "准备睡觉 晚安", "daily")
        self.assertEqual([x["file"] for x in results], ["1.webp"])

    def test_sentence_and_multiple_scene_words_are_searchable(self):
        self.assertEqual(rank_candidates(self.rows, "我现在准备睡觉了")[0]["file"], "1.webp")
        self.assertEqual(rank_candidates(self.rows, "安慰 抱抱")[0]["file"], "3.webp")

    def test_unrelated_empty_generic_and_emotion_queries_do_not_fall_back(self):
        for query in ("", "开心", "happy", "蓝色大肥鱼 鲸鱼娘", "量子纠缠退相干"):
            self.assertEqual(rank_candidates(self.rows, query), [], query)

    def test_emotion_filter_does_not_expand_to_other_emotions(self):
        self.assertEqual(rank_candidates(self.rows, "晚安", "angry"), [])
        with self.assertRaises(ValueError):
            rank_candidates(self.rows, "晚安", "invalid")

    def test_general_reactions_reach_the_reviewer_without_literal_topic_overlap(self):
        question = sticker(8, "歪头冒出小问号", "疑惑 问号 不明白")
        self.assertEqual(rank_candidates([question], "这是张 vv；没跟上，是名字还是缩写？"), [])
        expanded = rank_candidates([question, self.mockery], "这是张 vv；没跟上，是名字还是缩写？", include_general=True)
        self.assertEqual([item["file"] for item in expanded], [question["file"]])

    def test_general_reactions_do_not_displace_all_topic_matches_or_admit_disabled_images(self):
        question = sticker(8, "歪头冒出小问号", "疑惑 问号 不明白")
        question["keywords"] += " 自动回复禁用"
        smile = sticker(9, "微笑点头", "微笑 点头")
        expanded = rank_candidates(self.rows + [question, smile], "晚安 睡觉", include_general=True)
        self.assertEqual(expanded[0]["file"], self.sleep["file"])
        self.assertIn(smile["file"], [item["file"] for item in expanded])
        self.assertNotIn(question["file"], [item["file"] for item in expanded])

    def test_manual_images_never_enter_automatic_candidates(self):
        self.assertEqual(rank_candidates(self.rows, "你才傻 嘲讽", "angry"), [])

    def test_order_is_stable_for_equal_scene_matches(self):
        second = sticker(5, self.sleep["caption"], self.sleep["keywords"], used=50)
        first = rank_candidates([second, self.sleep], "晚安")
        again = rank_candidates([self.sleep, second], "晚安")
        self.assertEqual([x["file"] for x in first], [x["file"] for x in again])

    def model(self, decision, enabled=True):
        return SimpleNamespace(enabled=enabled, chat_json=Mock(return_value=decision))

    def test_reviewer_can_decline_all_keyword_matches(self):
        model = self.model({"file": None, "reason": "用户在严肃求助，不适合用玩笑表情。"})
        result = select_for_reply(model, self.rows[:2], "睡觉", "用户因工作失误很难过，需要认真安慰")
        self.assertEqual(result["memes"], [])
        payload = json.loads(model.chat_json.call_args.args[1])
        self.assertIn("认真安慰", payload["当前问题与拟回复"])

    def test_reviewer_can_only_select_a_provided_file(self):
        model = self.model({"file": "1.webp", "reason": "用户道晚安，睡觉图吻合。"})
        result = select_for_reply(model, self.rows[:2], "晚安", "用户：晚安；拟回复：好梦")
        self.assertEqual([x["file"] for x in result["memes"]], ["1.webp"])
        self.assertIn("晚安", result["memes"][0]["match_reason"])
        invalid = self.model({"file": "unseen.webp", "reason": "这张适合"})
        self.assertFalse(select_for_reply(invalid, self.rows, "晚安", "晚安")["ok"])

    def test_full_probability_allows_a_contextual_general_reaction_without_forcing_unsafe_choices(self):
        model = self.model({"file": "1.webp", "reason": "普通回复可用温和的通用反应图"})
        result = select_for_reply(model, self.rows, "聊会天", "用户想聊天，回复表示愿意陪聊", prefer_image=True)
        self.assertEqual(result["memes"][0]["file"], "1.webp")
        self.assertIn("通用反应图", model.chat_json.call_args.args[0])
        self.assertEqual(model.chat_json.call_args.kwargs, {"max_tokens": 800, "object_only": True, "thinking": False})

    def test_missing_context_no_candidates_unavailable_or_malformed_never_send(self):
        for query, context, candidates in (("", "晚安", self.rows), ("晚安", "", self.rows), ("晚安", "晚安", [])):
            model = self.model(None)
            self.assertEqual(select_for_reply(model, candidates, query, context)["memes"], [])
            model.chat_json.assert_not_called()
        for model in (self.model(None, False), self.model(None), self.model([]), self.model({"file": "1.webp"})):
            result = select_for_reply(model, self.rows, "晚安", "晚安")
            self.assertFalse(result["ok"])
            self.assertEqual(result["memes"], [])

    def test_http_handler_passes_current_context_and_rejects_invalid_fields(self):
        import server
        from unittest.mock import patch
        handler = object.__new__(server.Handler)
        handler._json = lambda status, value: setattr(handler, "result", (status, value))
        handler._body = lambda: {"q": "晚安 睡觉", "context": "用户说晚安，我回复好梦", "emotion": "daily"}
        handler._load_proactive = lambda: {"memeRate": 1}
        model = self.model({"file": "1.webp", "reason": "睡觉与道晚安相符"})
        store = SimpleNamespace(meme_candidates=Mock(return_value=[self.sleep]))
        with patch.object(server, "store", store, create=True), patch.object(server, "llm", model, create=True):
            handler._match_meme()
        self.assertEqual(handler.result[0], 200)
        self.assertEqual(handler.result[1]["memes"][0]["file"], "1.webp")
        store.meme_candidates.assert_called_once_with("晚安 睡觉", "daily", include_general=True)
        for body in ([], {"q": ["晚安"]}, {"context": {"text": "晚安"}}, {"emotion": 12}):
            handler._body = lambda body=body: body
            with self.assertRaises(ValueError):
                handler._match_meme()


if __name__ == "__main__":
    unittest.main()
