"""Independent expression draws and verification of the text submitted to Bilibili."""
import copy
import json
import random
import time
import unittest
from unittest.mock import Mock
from bili_runtime import BiliRuntime
from bili_automation import DEFAULT_AUTOMATION
from expression_style import sample_text_style, apply_text_style


class ExpressionStyleTest(unittest.TestCase):
    def test_seeded_sampling_matches_saved_rates(self):
        rng = random.Random(42).random
        counts = {'kaomoji': 0, 'emoji': 0}
        both = 0
        for _ in range(100000):
            plan = sample_text_style({'textStyleEnabled': True, 'kaomojiRate': .15, 'emojiRate': .4}, rng)
            for key in counts:
                counts[key] += int(plan[key])
            both += int(plan['kaomoji'] and plan['emoji'])
        self.assertLess(abs(counts['kaomoji'] - 15000), 500)
        self.assertLess(abs(counts['emoji'] - 40000), 600)
        self.assertLess(abs(both - 6000), 500)
        print(json.dumps({'samples': 100000, **counts, 'both': both}))

    def test_boundary_rates_and_protected_material(self):
        for rate in (0, 1):
            plan = sample_text_style({'textStyleEnabled': True, 'kaomojiRate': rate, 'emojiRate': rate})
            self.assertEqual(apply_text_style('晚安 😊 (￣▽￣)', plan), '晚安 (´-ω-`) 🌙' if rate else '晚安')
        text = '解释 `😊` 和 `(￣▽￣)`，链接 https://example.test/😊 ，原话“😊 (￣▽￣)”'
        self.assertEqual(apply_text_style(text, {'kaomoji': False, 'emoji': False}), text)
        self.assertEqual(apply_text_style('自带 😊', None), '自带 😊')
        self.assertEqual(apply_text_style('嗯 (๑>m<๑)', {'kaomoji': False, 'emoji': False}), '嗯')
        self.assertEqual(apply_text_style('😊', {'kaomoji': False, 'emoji': False}), '嗯。')

    def test_bili_generated_expression_is_in_the_actual_send_and_readback(self):
        handler, model = Mock(), Mock()
        handler._bili_tools_cfg.return_value = {'dm': True}
        handler._load_bili_whale.return_value = {'owner': {'mid': '123'}}
        runtime = BiliRuntime(lambda: handler, lambda: model, lambda: {'identity': '小鱼'}, '.', '.',
                             style=lambda: {'textStyleEnabled': True, 'kaomojiRate': 1, 'emojiRate': 1})
        runtime.helper_command = Mock(return_value={'self': '555', 'messages': []})
        model.chat.return_value = '晚安'
        reply = runtime.draft_dm({'key': 'one', 'ts': time.time(), 'text': '晚安'}, copy.deepcopy(DEFAULT_AUTOMATION))
        self.assertEqual(reply, '晚安 (´-ω-`) 🌙')
        runtime.command = Mock(side_effect=[{'ok': True}, {'ok': True}])
        runtime._wait_write = Mock()
        runtime.helper_command.return_value = {'self': '555', 'messages': [{'sender': '555', 'text': reply, 'ts': time.time()}]}
        result = runtime.send_dm({'key': 'one'}, reply, copy.deepcopy(DEFAULT_AUTOMATION))
        args = runtime.command.call_args.args[0]
        self.assertEqual(args[args.index('--msg') + 1], reply)
        self.assertTrue(result['replyVerified'])

    def test_bili_submission_without_matching_readback_is_not_success(self):
        handler = Mock()
        handler._bili_tools_cfg.return_value = {'dm': True}
        runtime = BiliRuntime(lambda: handler, Mock(), lambda: {}, '.', '.')
        runtime.command = Mock(side_effect=[{'ok': True}, {'ok': True}])
        runtime._wait_write = Mock()
        runtime.helper_command = Mock(return_value={'self': '555', 'messages': []})
        result = runtime.send_dm({'key': 'one'}, '晚安 🌙', copy.deepcopy(DEFAULT_AUTOMATION))
        self.assertEqual(result['status'], 'unknown')
