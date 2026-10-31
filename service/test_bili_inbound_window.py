"""Activation boundaries never replay old inbound content or uncertain writes."""
import copy
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import Mock

from bili_automation import AutomationLedger, BiliAutomation, DEFAULT_AUTOMATION, day_at
from bili_runtime import BiliRuntime


class InboundWindowTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.ledger = AutomationLedger(Path(self.tmp.name, 'ledger.db'))
        self.addCleanup(self.ledger.close)
        self.now = 1793418000.5
        self.cfg = copy.deepcopy(DEFAULT_AUTOMATION)
        self.cfg.update(managed=True, enabled=True)
        self.cfg['features'].update(ownerReply=True, strangerReply=True)
        self.backend = Mock()
        self.backend.owner_id.return_value = '123'
        self.backend.dm_peek.return_value = None
        self.backend.notifications.return_value = []
        self.backend.draft_dm.return_value = 'reply'
        self.backend.send_dm.return_value = {'status': 'success'}
        self.backend.notification_context.side_effect = lambda item, cfg: {
            'parent_rpid': item['rpid'], 'actorUid': item['mid'],
            'aid': item['oid'], 'root': item['rpid'], 'text': 'hello'}
        self.backend.reply_notification.return_value = {'status': 'success'}
        self.enabled = True
        self.controller = BiliAutomation(self.ledger, self.backend, lambda: self.cfg,
                                         lambda: self.enabled, started_at=self.now)

    def run_once(self, kind):
        self.controller.run_lock.acquire()
        self.controller._run_owned(kind, False, True, self.now + 10)

    def message(self, key, ts):
        return {'key': key, 'ts': ts, 'text': key}

    def pending(self, rows):
        return {**rows[-1], 'mid': '123', 'receipt': 'receipt', 'messages': rows,
                'text': '\n'.join(row['text'] for row in rows)}

    def test_startup_skips_old_pending_dm_without_generating_or_sending(self):
        self.backend.dm_peek.return_value = self.pending([self.message('old', self.now - 1)])
        self.run_once('dmReply')
        self.backend.dm_ack.assert_called_once()
        self.backend.draft_dm.assert_not_called()
        self.backend.send_dm.assert_not_called()

    def test_mixed_dm_batch_only_replies_to_post_activation_messages(self):
        self.backend.dm_peek.return_value = self.pending([
            self.message('old', self.now - 1), self.message('new', self.now + 1)])
        self.run_once('dmReply')
        sent = self.backend.send_dm.call_args.args[0]
        self.assertEqual(sent['text'], 'new')
        self.assertEqual([row['key'] for row in sent['messages']], ['new'])
        self.backend.dm_ack.assert_called_once()

    def test_startup_skips_old_at_and_comment_notifications_but_accepts_new(self):
        self.backend.notifications.return_value = [
            {'business': 1, 'oid': '10', 'rpid': str(i), 'mid': actor, 'time': when}
            for i, actor, when in [(1, '123', self.now - 1), (2, '999', self.now - 1),
                                  (3, '123', self.now + 1), (4, '999', self.now + 1)]]
        self.controller._strangers(self.cfg, self.now + 10)
        self.assertEqual(self.backend.reply_notification.call_count, 2)
        parents = {call.args[0]['parent_rpid'] for call in self.backend.reply_notification.call_args_list}
        self.assertEqual(parents, {'3', '4'})

    def test_reenable_updates_cutoff_but_normal_settings_save_does_not(self):
        self.controller.refresh_inbound_window(self.now + 1)
        self.assertEqual(self.backend.inbound_after, self.now)
        self.cfg['enabled'] = False
        self.controller.refresh_inbound_window(self.now + 2)
        self.cfg['enabled'] = True
        self.controller.refresh_inbound_window(self.now + 3)
        self.assertEqual(self.backend.inbound_after, self.now + 3)
        self.cfg['features']['ownerReply'] = False
        self.controller.refresh_inbound_window(self.now + 4)
        self.cfg['features']['ownerReply'] = True
        self.controller.refresh_inbound_window(self.now + 5)
        self.assertEqual(self.controller.inbound_after['ownerReply'], self.now + 5)
        self.assertEqual(self.backend.inbound_after, self.now + 3)

    def test_disabled_during_drafting_never_sends(self):
        self.backend.dm_peek.return_value = self.pending([self.message('new', self.now + 1)])
        def disable(*args):
            self.cfg['enabled'] = False
            return 'reply'
        self.backend.draft_dm.side_effect = disable
        self.run_once('dmReply')
        self.backend.send_dm.assert_not_called()

    def test_old_retry_payload_is_archived_and_unknown_delivery_stays_unknown(self):
        payload = {'key': '1:10:20', 'context': {'parent_rpid': '20', 'is_owner': False}, 'reply': 'old'}
        with self.ledger.conn:
            for aid, status in [('retry', 'failed'), ('uncertain', 'unknown')]:
                self.ledger.conn.execute(
                    'INSERT INTO actions(id,day,kind,target,status,started,result) VALUES(?,?,?,?,?,?,?)',
                    (aid, day_at(self.now), 'strangerReply', aid, status, self.now - 10,
                     json.dumps({'retryPayload': payload, 'retryAt': self.now - 1,
                                 'submission': 'not-sent', 'reason': 'cooldown'})))
        self.controller._retry_comments(self.cfg, self.now + 10, None)
        rows = {row['id']: dict(row) for row in self.ledger.conn.execute('SELECT * FROM actions')}
        self.assertNotIn('retryPayload', json.loads(rows['retry']['result']))
        self.assertEqual(rows['uncertain']['status'], 'unknown')
        self.backend.reply_notification.assert_not_called()

    def test_runtime_forwards_activation_boundary_to_dm_cli(self):
        runtime = object.__new__(BiliRuntime)
        runtime.inbound_after = self.now
        runtime.command = Mock(return_value={'ok': False, 'stdout': '{"hit":false}', 'combined': ''})
        self.assertIsNone(runtime.dm_peek(self.cfg))
        self.assertEqual(runtime.command.call_args.args[0][-2:], ['--after', str(self.now)])

    def test_dm_disabled_during_cooldown_never_starts_the_send_cli(self):
        runtime = object.__new__(BiliRuntime)
        runtime.inbound_windows = {'dmReply': self.now}
        runtime.raw_config = lambda: {'automation': self.cfg}
        runtime.handler = Mock()
        runtime.handler.return_value._bili_enabled.return_value = True
        runtime._tool_allowed = Mock()
        runtime.command = Mock(return_value={'ok': True})
        runtime._wait_write = lambda *args: self.cfg.update(enabled=False)
        result = runtime.send_dm(self.pending([self.message('new', self.now + 1)]), 'reply', self.cfg)
        self.assertEqual(result['submission'], 'not-sent')
        self.assertEqual(runtime.command.call_count, 1)
        self.assertIn('--dry', runtime.command.call_args.args[0])


if __name__ == '__main__':
    unittest.main()
