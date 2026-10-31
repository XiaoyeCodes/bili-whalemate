"""Resolved diagnostics disappear from active errors while their history stays inspectable."""
import copy
import tempfile
import unittest
from pathlib import Path
from unittest.mock import Mock, patch

from bili_automation import AutomationLedger, BiliAutomation, DEFAULT_AUTOMATION


class ActivityRecordsTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.path = Path(self.tmp.name, 'ledger.db')
        self.ledger = AutomationLedger(self.path)
        self.addCleanup(self.ledger.close)
        self.cfg = copy.deepcopy(DEFAULT_AUTOMATION)
        self.cfg.update(enabled=True, managed=True)
        self.backend = Mock()
        self.backend.notifications.return_value = []
        self.backend.owner_id.return_value = '123'

    def test_repeated_error_is_one_record_and_recovery_is_persistent(self):
        self.ledger.set_meta('dm_error', 'temporary network failure')
        self.ledger.set_meta('dm_error', 'temporary network failure')
        records = self.ledger.error_records()
        self.assertEqual(len(records), 1)
        self.assertEqual(records[0]['occurrences'], 2)
        self.assertEqual(records[0]['status'], 'active')
        self.ledger.set_meta('dm_error', None)
        self.assertEqual(self.ledger.error_records()[0]['status'], 'resolved')
        self.ledger.close()
        self.ledger = AutomationLedger(self.path)
        self.addCleanup(self.ledger.close)
        self.assertEqual(self.ledger.error_records()[0]['status'], 'resolved')

    def test_resolving_one_channel_does_not_clear_another(self):
        self.ledger.set_meta('dm_error', 'dm failure')
        self.ledger.set_meta('stranger_error', 'comment failure')
        self.ledger.set_meta('dm_error', None)
        active = [row for row in self.ledger.error_records() if row['status'] == 'active']
        self.assertEqual([row['message'] for row in active], ['comment failure'])

    def test_status_reconciles_only_confirmed_recovered_causes(self):
        self.ledger.set_meta('last_error', '已达到本地读取预算，请等待预算窗口恢复')
        self.ledger.set_meta('dm_error', 'unrelated dm failure')
        controller = BiliAutomation(self.ledger, self.backend, lambda: self.cfg, lambda: True,
                                    recovery=lambda errors, now: ['last_error'])
        state = controller.status()
        self.assertIsNone(state['lastError'])
        self.assertEqual(state['dmError'], 'unrelated dm failure')
        old = next(row for row in state['errorRecords'] if row['source'] == 'last_error')
        self.assertEqual(old['status'], 'resolved')

    def test_unknown_delivery_is_kept_for_review_without_reclassifying_the_action(self):
        self.cfg['daily']['comment'] = {'min': 1, 'max': 1}
        action = self.ledger.reserve('2026-10-31', 'comment', 'BVunknown', self.cfg, 100)
        self.ledger.finish(action, 'unknown', error='delivery not confirmed')
        records = self.ledger.error_records()
        self.assertEqual(records[0]['status'], 'review')
        self.assertEqual(self.ledger.previous('comment', 'BVunknown')['status'], 'unknown')

    def test_successful_empty_comment_poll_clears_an_earlier_polling_failure(self):
        controller = BiliAutomation(self.ledger, self.backend, lambda: self.cfg, lambda: True)
        self.backend.notifications.side_effect = ValueError('notification network failure')
        controller._strangers(self.cfg, 100)
        self.assertEqual(self.ledger.meta('stranger_error'), 'notification network failure')
        self.backend.notifications.side_effect = None
        controller._strangers(self.cfg, 101)
        self.assertIsNone(self.ledger.meta('stranger_error'))
        self.assertEqual(self.ledger.error_records()[0]['status'], 'resolved')

    def test_browse_records_include_successful_history_without_private_diagnostics(self):
        action = self.ledger.reserve('2026-10-31', 'browse', 'BVrecord', self.cfg, 100)
        self.ledger.finish(action, 'success', {'title': 'test video', 'url': 'https://example.test', 'summary': 'summary'})
        records = self.ledger.browse_records()
        self.assertEqual(records[0]['result']['title'], 'test video')
        self.assertNotIn('error', records[0])

    def test_runtime_checks_current_budget_before_dismissing_a_budget_error(self):
        from bili_runtime import BiliRuntime
        runtime = object.__new__(BiliRuntime)
        runtime.raw_config = lambda: {}
        errors = {'last_error': '已达到本地读取预算，请等待预算窗口恢复', 'dm_error': 'unrelated failure'}
        with patch('bili_write_usage.read_usage', return_value={'dailyRemaining': 0, 'hourlyRemaining': 20}):
            self.assertEqual(runtime.recovered_errors(errors, 100), [])
        with patch('bili_write_usage.read_usage', return_value={'dailyRemaining': 100, 'hourlyRemaining': 20}):
            self.assertEqual(runtime.recovered_errors(errors, 101), ['last_error'])

    def test_polling_success_does_not_clear_an_unrelated_reply_failure(self):
        controller = BiliAutomation(self.ledger, self.backend, lambda: self.cfg, lambda: True)
        self.ledger.set_meta('stranger_error', 'delivery not confirmed')
        self.ledger.set_meta('stranger_error_phase', 'reply')
        controller._strangers(self.cfg, 100)
        self.assertEqual(self.ledger.meta('stranger_error'), 'delivery not confirmed')

    def test_removed_local_length_cap_is_resolved_without_requesting_the_platform(self):
        from bili_runtime import BiliRuntime
        runtime = object.__new__(BiliRuntime)
        self.assertEqual(runtime.recovered_errors({'stranger_error': '回复加入文字表情后超过字数上限，本次未发送'}, 100), ['stranger_error'])


if __name__ == '__main__':
    unittest.main()
