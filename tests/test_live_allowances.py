import asyncio
import io
import json
import os
import sys
import urllib.error
from pathlib import Path
from unittest.mock import AsyncMock

import pytest
sys.path.insert(0, str(Path(__file__).parents[1] / 'dashboard'))
import live_allowances as live

FIXTURES = Path(__file__).parent / 'fixtures/allowances'


def test_gemini_real_tsv_and_partial():
    text = (FIXTURES / 'gemini-usage.tsv').read_text()
    windows = live.parse_gemini(text)
    assert [(w['minutes'], w['remainingPercent']) for w in windows] == [(10080, 85), (300, 100)]
    assert windows[0]['resetsAt'] == '2026-11-05T04:15:48+00:00'
    assert live.parse_gemini(text.replace('Weekly Limit Remaining', 'Week Limit Remaining')) == windows
    assert len(live.parse_gemini(text.splitlines()[0])) == 1
    assert live.parse_gemini('\n'.join(text.splitlines()[2:])) == []
    for value in ('NaN%', '101%', '-1%', '20'):
        assert live.parse_gemini(f'Gemini Models\tWeekly Limit Remaining\t{value}\t2030-01-01T00:00:00Z') == []


def test_opencode_contract_and_partial():
    payload = json.loads((FIXTURES / 'opencode-usage.json').read_text())
    windows = live.parse_opencode(payload)
    assert [w['remainingPercent'] for w in windows] == [75, 40, 0]
    assert [w['label'] for w in windows] == ['Rolling window', 'Weekly window', 'Monthly window']
    del payload['usage']['weekly']
    assert len(live.parse_opencode(payload)) == 2
    for value in (True, '5', -1, 101, float('nan')):
        assert live.parse_opencode({'usage': {'rolling': {'percent': value}}}) == []
    assert live.parse_opencode(json.loads((FIXTURES / 'opencode-401.json').read_text())) == []
    assert live.reset_time('invalid') is None
    assert live.reset_time('2030-01-01') is None


@pytest.mark.parametrize('output,code,status', [(b'', 0, 'empty'), (b'Please log in SECRET', 0, 'login_required'),
    (b'SECRET', 1, 'login_required'), (b'bad output SECRET', 0, 'invalid')])
def test_gemini_errors(monkeypatch, output, code, status):
    proc = type('Process', (), {'returncode': code, 'communicate': AsyncMock(return_value=(output, None))})()
    spawn = AsyncMock(return_value=proc)
    monkeypatch.setattr(asyncio, 'create_subprocess_exec', spawn)
    value = asyncio.run(live.gemini())
    assert value['status'] == status
    assert value['updatedAt'] is None and 'SECRET' not in str(value)
    assert spawn.call_args.args == ('agy', '-p', '/usage')


def test_missing_command(monkeypatch):
    monkeypatch.setattr(asyncio, 'create_subprocess_exec', AsyncMock(side_effect=FileNotFoundError()))
    assert asyncio.run(live.gemini())['status'] == 'command_missing'


def test_real_child_timeout_and_cancellation(monkeypatch, tmp_path):
    executable = tmp_path / 'agy'
    executable.write_text('#!/bin/sh\nsleep 60\n')
    executable.chmod(0o700)
    monkeypatch.setenv('PATH', str(tmp_path) + ':' + os.environ['PATH'])
    monkeypatch.setattr(live, 'GEMINI_TIMEOUT', .05)
    assert asyncio.run(live.gemini())['status'] == 'timeout'
    async def cancel():
        task = asyncio.create_task(live.gemini())
        await asyncio.sleep(.01)
        task.cancel()
        with pytest.raises(asyncio.CancelledError):
            await task
    asyncio.run(cancel())


def test_private_config_and_existing_auth(monkeypatch, tmp_path):
    path = tmp_path / 'private.json'
    path.write_text(json.dumps({'token': 'SECRET'}))
    path.chmod(0o600)
    monkeypatch.setenv('WORKBENCH_OPENCODE_AUTH_FILE', str(path))
    assert live.opencode_headers() == {'Authorization': 'Bearer SECRET'}
    path.chmod(0o644)
    assert live.opencode_sync()['status'] == 'configuration_error'
    assert 'SECRET' not in str(live.opencode_sync())
    monkeypatch.delenv('WORKBENCH_OPENCODE_AUTH_FILE')
    monkeypatch.setenv('XDG_DATA_HOME', str(tmp_path))
    assert live.opencode_sync()['status'] == 'login_required'
    path = tmp_path / 'opencode/auth.json'
    path.parent.mkdir()
    path.write_text(json.dumps({'opencode': {'type': 'api', 'key': 'SECRET'}}))
    path.chmod(0o600)
    assert live.opencode_headers() == {'Authorization': 'Bearer SECRET'}


@pytest.mark.parametrize('failure,status', [(401, 'login_required'), (403, 'subscription_required'), (500, 'error'),
                                          ('timeout', 'timeout'), ('empty', 'empty'), ('invalid', 'error'), ('ok', 'available')])
def test_opencode_transport(monkeypatch, failure, status):
    monkeypatch.setattr(live, 'opencode_headers', lambda: {'Authorization': 'Bearer SECRET'})
    class Opener:
        def open(self, req, timeout):
            assert req.full_url == live.OPENCODE_URL and timeout == 8
            assert req.get_header('Authorization') == 'Bearer SECRET'
            if isinstance(failure, int):
                raise urllib.error.HTTPError(req.full_url, failure, 'SECRET', {}, io.BytesIO(b'SECRET'))
            if failure == 'timeout':
                raise TimeoutError('SECRET')
            return io.BytesIO(b'' if failure == 'empty' else b'SECRET' if failure == 'invalid' else (FIXTURES / 'opencode-usage.json').read_bytes())
    monkeypatch.setattr(live.urllib.request, 'build_opener', lambda *args: Opener())
    value = asyncio.run(live.opencode())
    assert value['status'] == status
    assert 'SECRET' not in str(value)
    assert live.NoRedirect().redirect_request(None, None, 302, '', {}, 'https://other.test') is None


def test_existing_preset_dispatch_and_source(monkeypatch):
    from quota_dashboard import QuotaDashboard
    from subscription_entries import defaults
    monkeypatch.setattr(live, 'gemini', AsyncMock(return_value=live.result('gemini', 'available', 'Gemini only', live.parse_gemini((FIXTURES / 'gemini-usage.tsv').read_text()))))
    monkeypatch.setattr(live, 'opencode', AsyncMock(return_value=live.result('opencode', 'login_required', live.SETUP)))
    result = asyncio.run(QuotaDashboard().read('alice', 'default', entries=defaults()))
    assert result['providers'][1]['status'] == 'available'
    assert result['providers'][1]['source'].endswith('Gemini Models')
    assert result['providers'][0]['status'] == 'login_required'


def test_cookie_config_and_symlinks_are_private(monkeypatch, tmp_path):
    path = tmp_path / 'auth.json'
    path.write_text(json.dumps({'cookie': 'session=SECRET'}))
    path.chmod(0o600)
    monkeypatch.setenv('WORKBENCH_OPENCODE_AUTH_FILE', str(path))
    assert live.opencode_headers() == {'Cookie': 'session=SECRET'}
    link = tmp_path / 'link.json'
    link.symlink_to(path)
    monkeypatch.setenv('WORKBENCH_OPENCODE_AUTH_FILE', str(link))
    assert live.opencode_sync()['status'] == 'configuration_error'
    monkeypatch.setenv('WORKBENCH_OPENCODE_AUTH_FILE', str(path))
    path.write_text(json.dumps({'token': 'SECRET\r\nInjected: value'}))
    assert live.opencode_sync()['status'] == 'configuration_error'
    assert 'SECRET' not in str(live.opencode_sync())


def test_gemini_command_success(monkeypatch):
    proc = type('Process', (), {'returncode': 0, 'communicate': AsyncMock(return_value=((FIXTURES / 'gemini-usage.tsv').read_bytes(), None))})()
    monkeypatch.setattr(asyncio, 'create_subprocess_exec', AsyncMock(return_value=proc))
    value = asyncio.run(live.gemini())
    assert value['status'] == 'available'
    assert value['updatedAt'] == value['checkedAt']
    assert len(value['windows']) == 2
