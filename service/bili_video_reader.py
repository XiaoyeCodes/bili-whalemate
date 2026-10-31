"""Run the pinned Agent Reach Bilibili channel with an isolated copy of the saved login.

The parent reserves shared traffic budget before launching this read-only worker.
Credentials arrive on stdin, never in argv, output or the Agent Reach global home.
"""
from __future__ import annotations

import importlib.metadata
import json
import os
from pathlib import Path
import re
import sys

REACH_REF = '14c213405669414492bda0f8d52cc6531d062c45'


def run_reader(request):
    bvid = request.get('bvid', '')
    if not isinstance(bvid, str) or not re.fullmatch(r'BV[0-9A-Za-z]{10}', bvid):
        return {'ok': False, 'errorCode': 'BAD_INPUT'}
    credentials = request.get('credentials') or {}
    if not credentials.get('sessdata'):
        return {'ok': False, 'errorCode': 'NEED_LOGIN'}
    home = Path(os.environ['CMEM_VIDEO_READER_HOME']).absolute()
    home.mkdir(parents=True, exist_ok=True)
    os.environ.update(HOME=str(home), USERPROFILE=str(home))
    os.environ['PATH'] = str(Path(sys.executable).parent) + os.pathsep + os.environ.get('PATH', '')
    from agent_reach.runtime import state, sessions
    from agent_reach.runtime.result import ReachError
    from agent_reach.channels import bilibili

    # This channel already has an explicitly supplied login; disable source discovery.
    state.mutate(lambda data: data.setdefault('session_reuse', {}).update({'bilibili': {'source': 'manual'}}))
    session_home = sessions.session_dir('bili-cli')
    os.environ.update(HOME=str(session_home), USERPROFILE=str(session_home))
    from bilibili_api import Credential
    from bili_cli.auth import save_credential
    save_credential(Credential(**{key: str(credentials.get(key) or '')
        for key in ('sessdata', 'bili_jct', 'buvid3')}))
    os.environ.update(HOME=str(home), USERPROFILE=str(home))

    captured = {}
    original = bilibili._bili_json

    def observe(args, timeout):
        value = original(args, timeout)
        captured.update(value)
        return value

    # Observe the upstream CLI payload to retain its timestamps; extraction and
    # error classification still execute the original GitHub channel unchanged.
    bilibili._bili_json = observe
    error = None
    try:
        bilibili.BilibiliChannel()._cli_subtitle(target=bvid, timeout=22)
    except ReachError as exc:
        error = exc.code
    finally:
        bilibili._bili_json = original
    video = captured.get('video') or {}
    subtitle = captured.get('subtitle') or {}
    return {'ok': bool(video), 'video': {key: video.get(key) for key in ('title', 'description', 'duration')},
        'items': subtitle.get('items') or [], 'available': subtitle.get('available') is True,
        'errorCode': error, 'backend': 'agent-reach/bilibili/bili-cli',
        'backendVersion': importlib.metadata.version('agent-reach'), 'backendRef': REACH_REF,
        'nativeVersion': importlib.metadata.version('bilibili-cli')}


if __name__ == '__main__':
    try:
        value = run_reader(json.load(sys.stdin))
    except ImportError:
        value = {'ok': False, 'errorCode': 'NEED_SETUP'}
    except Exception:
        # Upstream exceptions may contain signed CDN URLs or local private paths.
        value = {'ok': False, 'errorCode': 'UPSTREAM_BROKEN'}
    print(json.dumps(value, ensure_ascii=False))
