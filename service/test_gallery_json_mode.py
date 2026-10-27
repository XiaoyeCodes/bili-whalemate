"""Gallery object responses keep existing list-oriented memory extraction unchanged."""
import io
import json
import unittest
from unittest.mock import patch
from llm import LLM


class JsonModeTest(unittest.TestCase):
    def test_object_mode_is_opt_in_and_existing_list_responses_stay_supported(self):
        model = LLM("https://example.test", "fixture", "fixture")
        def response(content):
            return io.BytesIO(json.dumps({"choices": [{"message": {"content": content}}]}).encode())
        with patch("urllib.request.urlopen", side_effect=[response('{"text":"hello","meme_file":null}'), response('[]')]) as call:
            self.assertEqual(model.chat_json("Return JSON", "hello", object_only=True)["text"], "hello")
            self.assertEqual(model.chat_json("Return JSON", "facts"), [])
        payloads = [json.loads(entry.args[0].data) for entry in call.call_args_list]
        self.assertEqual(payloads[0]["response_format"], {"type": "json_object"})
        self.assertNotIn("response_format", payloads[1])


if __name__ == "__main__":
    unittest.main()
