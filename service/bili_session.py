"""Credential-specific login verification and budget-aware background polling."""
import hashlib
import json
import math
import os
import tempfile
import threading
import time
from pathlib import Path

_credential_lock = threading.RLock()


def _atomic_json(path, value):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = None
    try:
        with tempfile.NamedTemporaryFile(mode='w', encoding='utf8', dir=path.parent, delete=False) as stream:
            temporary = stream.name
            os.chmod(temporary, 0o600)
            json.dump(value, stream, ensure_ascii=False, indent=2)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, path)
    finally:
        if temporary is not None and os.path.exists(temporary):
            os.unlink(temporary)


def save_credentials(path, credentials):
    """Replace a complete cookie set atomically, retaining a synchronized private backup."""
    if not isinstance(credentials, dict) or not str(credentials.get('sessdata') or '').strip():
        raise ValueError('登录凭据缺少 SESSDATA')
    with _credential_lock:
        _atomic_json(str(path) + '.bak', credentials)
        _atomic_json(path, credentials)


class SessionStatus:
    """Persist verification evidence without treating transport failures as session expiry."""
    def __init__(self, path, *, now=time.time):
        self.path = Path(path)
        self.cache_path = self.path.with_name('login-status.json')
        self.now = now
        self.lock = threading.RLock()

    @staticmethod
    def _public(record):
        state = record['state']
        reasons = {
            'read-budget': '本地读取额度暂不可用，登录凭据仍已保存，无需重新扫码。',
            'platform-pause': 'B 站请求暂时限流，登录凭据仍已保存，请等待恢复。',
            'manual': '账号需要完成登录或安全验证，请查看平台提示。',
        }
        warning = reasons.get(record.get('reason'), '暂时无法验证登录，凭据仍已保存，稍后自动重试。') if state == 'unavailable' else None
        return {'logged_in': record.get('authenticated'), 'login_state': state,
                'login_required': state in ('missing', 'invalid', 'expired'),
                'login_warning': warning, 'last_verified_at': record.get('verified_at'),
                'next_verify_at': record.get('next_check')}

    def status(self, verify):
        with self.lock:
            try:
                raw = self.path.read_bytes()
                credentials = json.loads(raw.decode('utf-8-sig'))
                if not isinstance(credentials, dict) or not credentials.get('sessdata'):
                    return self._public({'state': 'invalid', 'authenticated': False})
            except FileNotFoundError:
                return self._public({'state': 'missing', 'authenticated': False})
            except (OSError, ValueError):
                return self._public({'state': 'invalid', 'authenticated': False})
            fingerprint = hashlib.sha256(raw).hexdigest()
            previous = {}
            try:
                candidate = json.loads(self.cache_path.read_text(encoding='utf8'))
                next_check = candidate.get('next_check')
                if (candidate.get('fingerprint') == fingerprint
                        and candidate.get('state') in ('authenticated', 'expired', 'unavailable')
                        and type(next_check) in (int, float) and math.isfinite(next_check)):
                    previous = candidate
            except (OSError, ValueError, AttributeError):
                pass
            now = self.now()
            if previous.get('next_check', 0) > now:
                return self._public(previous)
            try:
                result = verify()
            except (OSError, ValueError, TimeoutError):
                result = {'state': 'unavailable'}
            if not isinstance(result, dict) or result.get('state') not in ('authenticated', 'expired', 'unavailable'):
                result = {'state': 'unavailable'}
            if self.path.read_bytes() != raw:
                return self._public({'state': 'unavailable', 'authenticated': None})
            record = {'fingerprint': fingerprint, 'state': result['state'],
                      'authenticated': previous.get('authenticated'), 'verified_at': previous.get('verified_at'),
                      'next_check': now + 600}
            if result['state'] == 'authenticated':
                record.update(authenticated=True, verified_at=now)
            elif result['state'] == 'expired':
                record.update(authenticated=False)
            else:
                record['reason'] = result.get('reason')
                retry_at = result.get('retryAt', 0)
                if type(retry_at) not in (int, float) or not math.isfinite(retry_at):
                    retry_at = 0
                record['next_check'] = max(now + 60, retry_at / 1000)
                if previous.get('state') == 'expired':
                    record['state'] = 'expired'
            _atomic_json(self.cache_path, record)
            return self._public(record)


def polling_intervals(cfg, risk):
    """Reserve one third of read capacity for verification, video work and pagination."""
    desired = {key: cfg[key] for key in ('dmPollSeconds', 'strangerPollSeconds')}
    features = cfg['features']
    rate = (1 / desired['dmPollSeconds'] if features.get('dmReply') else 0)
    rate += (4 / desired['strangerPollSeconds'] if features.get('strangerReply') or features.get('ownerReply') else 0)
    def budget(key, default):
        value = risk.get(key, default)
        return value if type(value) in (int, float) and math.isfinite(value) and value > 0 else default
    capacity = min(budget('readDaily', 3000) / 86400, budget('readHourly', 600) / 3600) * 2 / 3
    scale = max(1, rate / capacity)
    return {key: math.ceil(value * scale) for key, value in desired.items()}
