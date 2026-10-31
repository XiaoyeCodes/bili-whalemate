"""Temporary API failures never erase or invalidate a saved platform session."""
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import Mock, patch, MagicMock
from types import SimpleNamespace

from bili_session import SessionStatus, save_credentials, polling_intervals


class SessionStatusTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.path = Path(self.tmp.name, 'credentials.json')
        self.credentials = {'sessdata': 'fixture-session', 'bili_jct': 'fixture-csrf', 'buvid3': ''}
        self.path.write_text(json.dumps(self.credentials), encoding='utf8')
        self.now = 1000
        self.status = SessionStatus(self.path, now=lambda: self.now)

    def test_cached_success_avoids_duplicate_verification_requests(self):
        verify = Mock(return_value={'state': 'authenticated'})
        self.assertTrue(self.status.status(verify)['logged_in'])
        self.assertTrue(self.status.status(verify)['logged_in'])
        verify.assert_called_once()

    def test_budget_or_network_failure_keeps_verified_login_and_credentials(self):
        self.status.status(lambda: {'state': 'authenticated'})
        before = self.path.read_bytes()
        self.now += 601
        result = self.status.status(lambda: {'state': 'unavailable', 'reason': 'read-budget', 'retryAt': 5000000})
        self.assertTrue(result['logged_in'])
        self.assertEqual(result['login_state'], 'unavailable')
        self.assertFalse(result['login_required'])
        self.assertEqual(self.path.read_bytes(), before)
        restarted = SessionStatus(self.path, now=lambda: self.now)
        verify = Mock()
        self.assertTrue(restarted.status(verify)['logged_in'])
        verify.assert_not_called()

    def test_explicit_expiry_requires_login_and_new_cookie_is_checked_independently(self):
        result = self.status.status(lambda: {'state': 'expired'})
        self.assertTrue(result['login_required'])
        self.assertFalse(result['logged_in'])
        save_credentials(self.path, {**self.credentials, 'sessdata': 'replacement-fixture'})
        result = self.status.status(lambda: {'state': 'authenticated'})
        self.assertTrue(result['logged_in'])

    def test_unknown_first_verification_does_not_claim_logout_or_expose_secrets(self):
        result = self.status.status(lambda: {'state': 'unavailable', 'reason': 'network'})
        self.assertIsNone(result['logged_in'])
        self.assertFalse(result['login_required'])
        self.assertNotIn('fixture', json.dumps(result))

    def test_atomic_save_retains_renewal_metadata_without_exporting_it(self):
        credentials = {**self.credentials, 'refresh_token': 'private-renewal-fixture', 'expires_at': 9999999}
        save_credentials(self.path, credentials)
        self.assertEqual(json.loads(self.path.read_text()), credentials)
        self.assertEqual(json.loads(Path(str(self.path) + '.bak').read_text()), credentials)
        result = self.status.status(lambda: {'state': 'authenticated'})
        self.assertNotIn('private-renewal-fixture', json.dumps(result))

    def test_failed_replacement_preserves_existing_credential_file(self):
        before = self.path.read_bytes()
        with patch('bili_session.os.replace', side_effect=PermissionError('fixture')):
            with self.assertRaises(PermissionError):
                save_credentials(self.path, {**self.credentials, 'sessdata': 'replacement-fixture'})
        self.assertEqual(self.path.read_bytes(), before)

    def test_default_polls_fit_the_read_budget_with_room_for_foreground_work(self):
        cfg = {'dmPollSeconds': 15, 'strangerPollSeconds': 15,
               'features': {'dmReply': True, 'strangerReply': True, 'ownerReply': True}}
        intervals = polling_intervals(cfg, {})
        self.assertLessEqual(86400 / intervals['dmPollSeconds'] + 4 * 86400 / intervals['strangerPollSeconds'], 2000)
        self.assertGreater(intervals['dmPollSeconds'], 15)
        self.assertEqual(polling_intervals(cfg, {'readDaily': 100000, 'readHourly': 10000})['dmPollSeconds'], 15)

    def test_settings_route_preserves_login_when_budget_verification_is_unavailable(self):
        import server
        handler = object.__new__(server.Handler)
        handler.BILI_CFG = str(Path(self.tmp.name, 'bili.json'))
        handler._load_bili_whale = lambda: {}
        handler._run_bili = Mock(return_value={'stdout': '{"state":"authenticated"}'})
        with patch.object(server, 'bili_session_status', self.status):
            self.assertTrue(handler._bili_status()['logged_in'])
            self.now += 601
            handler._run_bili.return_value = {'stdout': '{"state":"unavailable","reason":"read-budget"}'}
            result = handler._bili_status()
        self.assertTrue(result['logged_in'])
        self.assertFalse(result['login_required'])

    def test_qr_route_stores_returned_renewal_metadata_without_returning_it(self):
        import server
        jar = [SimpleNamespace(name='SESSDATA', value='qr-fixture-session', expires=9999999),
               SimpleNamespace(name='bili_jct', value='qr-fixture-csrf', expires=None)]
        opener = MagicMock()
        opener.open.return_value.__enter__.return_value.read.return_value = json.dumps(
            {'data': {'code': 0, 'refresh_token': 'private-refresh-fixture'}}).encode()
        handler = object.__new__(server.Handler)
        handler._run_bili = Mock(return_value={'ok': True, 'stdout': 'verified'})
        with patch.object(server, 'USER_HOME', self.tmp.name), patch('http.cookiejar.CookieJar', return_value=jar), patch('urllib.request.build_opener', return_value=opener):
            response = handler._bili_qr_poll('qr-fixture-key')
        saved = json.loads(Path(self.tmp.name, '.bili-ai/credentials.json').read_text())
        self.assertEqual(saved['refresh_token'], 'private-refresh-fixture')
        self.assertEqual(saved['expires_at'], 9999999)
        self.assertNotIn('private-refresh-fixture', json.dumps(response))


if __name__ == '__main__':
    unittest.main()
