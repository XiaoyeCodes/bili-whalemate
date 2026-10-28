"""Short JSON replies expose per-request failures without retrying or revealing content."""
import io
import json
import unittest
from unittest.mock import patch
from llm import LLM, LLMRequestFailure


def response(text, finish='stop'):
    return io.BytesIO(json.dumps({'choices': [{'finish_reason': finish, 'message': {'content': text, 'reasoning_content': 'private reasoning'}}]}).encode())


class ReplyFailureTest(unittest.TestCase):
    def test_whitespace_is_a_structured_single_attempt_failure(self):
        model = LLM('https://api.deepseek.com/v1', 'fixture', 'deepseek-flash')
        with patch('urllib.request.urlopen', return_value=response('   ')) as network:
            with self.assertRaises(LLMRequestFailure) as raised:
                model.chat_json('Return JSON', 'hello', object_only=True, thinking=False, strict=True)
        self.assertEqual(raised.exception.code, 'EMPTY_CONTENT')
        self.assertIn('stop', str(raised.exception))
        self.assertNotIn('private reasoning', str(raised.exception))
        network.assert_called_once()
        self.assertEqual(model.health()['failures'], 1)
        self.assertIn('EMPTY_CONTENT', model.health()['last_error'])

    def test_short_deepseek_reply_explicitly_disables_thinking(self):
        model = LLM('https://api.deepseek.com/v1', 'fixture', 'deepseek-flash')
        with patch('urllib.request.urlopen', return_value=response('{"text":"你好","meme_file":null}')) as network:
            value = model.chat_json('Return JSON', 'hello', object_only=True, thinking=False, strict=True)
        self.assertEqual(value['text'], '你好')
        payload = json.loads(network.call_args.args[0].data)
        self.assertEqual(payload['thinking'], {'type': 'disabled'})
        self.assertEqual(payload['response_format'], {'type': 'json_object'})

    def test_compatible_other_providers_receive_no_deepseek_only_field(self):
        model = LLM('https://example.test/v1', 'fixture', 'model')
        with patch('urllib.request.urlopen', return_value=response('{"text":"hello"}')) as network:
            model.chat_json('Return JSON', 'hello', object_only=True, thinking=False, strict=True)
        self.assertNotIn('thinking', json.loads(network.call_args.args[0].data))

    def test_token_limit_is_not_accepted_as_a_complete_reply(self):
        model = LLM('https://example.test', 'fixture', 'model')
        with patch('urllib.request.urlopen', return_value=response('{"text":"partial"}', 'length')):
            with self.assertRaises(LLMRequestFailure) as raised:
                model.chat_json('Return JSON', 'hello', object_only=True, strict=True)
        self.assertEqual(raised.exception.code, 'TRUNCATED_RESPONSE')

    def test_invalid_json_and_non_object_json_are_distinct(self):
        for content, code in [('plain reply', 'INVALID_JSON'), ('[]', 'INVALID_JSON_OBJECT')]:
            model = LLM('https://example.test', 'fixture', 'model')
            with self.subTest(code=code), patch('urllib.request.urlopen', return_value=response(content)):
                with self.assertRaises(LLMRequestFailure) as raised:
                    model.chat_json('Return JSON', 'hello', object_only=True, strict=True)
                self.assertEqual(raised.exception.code, code)

    def test_existing_optional_and_list_calls_keep_their_return_values(self):
        model = LLM('https://example.test', 'fixture', 'model')
        with patch('urllib.request.urlopen', side_effect=[response(' '), response('[]')]):
            self.assertIsNone(model.chat_json('Return JSON', 'hello'))
            self.assertEqual(model.chat_json('Return JSON', 'hello'), [])
        self.assertIsNone(model.health()['last_error'])


if __name__ == '__main__':
    unittest.main()
