"""Version catalog resilience and terminal Codex thread state handling."""

import http.client
import importlib.util
import json
from pathlib import Path
import sys
import time

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient


ROOT = Path(__file__).parents[1]
sys.path.insert(0, str(ROOT / 'dashboard'))
SPEC = importlib.util.spec_from_file_location(
    'workbench_version_manager', ROOT / 'dashboard/workbench_version_manager.py'
)
assert SPEC and SPEC.loader
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)

REMOTE_RELEASES = [
    {
        'tag_name': 'v20261104-1',
        'draft': False,
        'prerelease': False,
        'body': 'First release of the day',
        'published_at': '2026-11-03T22:40:20Z',
        'assets': [
            {'name': 'hermes-workbench-v20261104-1.tar.gz'},
            {'name': 'SHA256SUMS'},
        ],
    },
    {
        'tag_name': 'v20261104-2',
        'draft': False,
        'prerelease': False,
        'body': 'Second release of the day',
        'published_at': '2026-11-04T12:27:58Z',
        'assets': [
            {'name': 'hermes-workbench-v20261104-2.tar.gz'},
            {'name': 'SHA256SUMS'},
        ],
    },
]


@pytest.fixture(autouse=True)
def isolated_version_catalog(tmp_path, monkeypatch):
    """Keep catalog, local releases and the disk cache inside tmp_path."""

    monkeypatch.setattr(MODULE, 'RELEASES', tmp_path / 'plugin-releases')
    manifest = tmp_path / 'manifest.json'
    manifest.write_text(json.dumps({'version': '20261104-2'}))
    monkeypatch.setattr(MODULE, 'MANIFEST', manifest)
    monkeypatch.setenv('HERMES_WORKBENCH_RELEASE_CATALOG_CACHE', str(tmp_path / 'release-catalog.json'))
    monkeypatch.setattr(MODULE, '_sleep', lambda _delay: None)
    monkeypatch.setattr(MODULE, '_catalog', (0.0, [], None))
    _install_local_version(tmp_path, '20261104-2')
    return tmp_path


def _install_local_version(root: Path, version: str) -> None:
    target = root / 'plugin-releases' / version
    target.mkdir(parents=True, exist_ok=True)
    (target / 'workbench.js').write_text('// local')
    (target / 'workbench.css').write_text('/* local */')


def _client() -> TestClient:
    app = FastAPI()
    app.include_router(MODULE.create_router(), prefix='/api/plugins/workbench')
    return TestClient(app)


def _reader(payload):
    body = json.dumps(payload).encode()

    def read(url, limit, progress=None):
        return body

    return read


def _versions() -> dict:
    response = _client().get('/api/plugins/workbench/versions')
    assert response.status_code == 200
    return response.json()


def _by_version(data: dict) -> dict:
    return {row['version']: row for row in data['versions']}


def test_normal_catalog_contains_remote_and_local_versions(monkeypatch):
    """A healthy GitHub response lists yesterday's first release next to local."""

    monkeypatch.setattr(MODULE, '_read_url', _reader(REMOTE_RELEASES))
    data = _versions()
    versions = _by_version(data)

    assert data['warning'] is None
    assert data['active'] == '20261104-2'
    assert {'20261104-1', '20261104-2'} <= versions.keys()
    assert versions['20261104-1']['ready'] is False
    assert versions['20261104-2']['ready'] is True
    assert versions['20261104-2']['source'] == 'github'


@pytest.mark.parametrize(
    'failure',
    [
        http.client.IncompleteRead(b'{"partial":'),
        TimeoutError('release catalog timed out'),
        json.JSONDecodeError('unterminated release catalog', '{"partial":', 0),
    ],
)
def test_remote_failures_return_stale_catalog_with_warning(isolated_version_catalog, monkeypatch, failure):
    """IncompleteRead, timeouts and malformed JSON never turn /versions into a 500."""

    monkeypatch.setattr(MODULE, '_read_url', _reader(REMOTE_RELEASES))
    assert _versions()['warning'] is None
    cache = isolated_version_catalog / 'release-catalog.json'
    assert cache.is_file()

    # Expire the in-memory snapshot so the test exercises the disk fallback.
    monkeypatch.setattr(MODULE, '_catalog', (0.0, [], None))

    def fail(*_args, **_kwargs):
        raise failure

    monkeypatch.setattr(MODULE, '_read_url', fail)
    data = _versions()
    versions = _by_version(data)

    assert 'temporarily unavailable' in data['warning']
    assert data['active'] == '20261104-2'
    assert {'20261104-1', '20261104-2'} <= versions.keys()
    assert versions['20261104-2']['ready'] is True


def test_memory_catalog_is_used_when_refresh_fails(monkeypatch):
    """The last successful in-memory catalog remains available without disk."""

    monkeypatch.setenv('HERMES_WORKBENCH_RELEASE_CATALOG_CACHE', '')
    monkeypatch.setattr(MODULE, '_read_url', _reader(REMOTE_RELEASES))
    assert _versions()['warning'] is None
    stale = MODULE._catalog[1]
    monkeypatch.setattr(MODULE, '_catalog', (time.monotonic() - MODULE._CATALOG_TTL - 1, stale, None))

    def fail(*_args, **_kwargs):
        raise http.client.IncompleteRead(b'')

    monkeypatch.setattr(MODULE, '_read_url', fail)
    data = _versions()

    assert 'temporarily unavailable' in data['warning']
    assert {'20261104-1', '20261104-2'} <= _by_version(data).keys()


def test_read_url_retries_incomplete_read(monkeypatch):
    """Transport-level IncompleteRead is retried before the catalog gives up."""

    body = b'{"ok": true}'
    attempts = []

    class Response:
        headers = {'Content-Length': str(len(body))}

        def __init__(self):
            self._sent = False

        def read(self, _size):
            if self._sent:
                return b''
            self._sent = True
            return body

        def __enter__(self):
            return self

        def __exit__(self, *_exc):
            return False

    def urlopen(_request, timeout):
        assert timeout == 20
        attempts.append(1)
        if len(attempts) == 1:
            raise http.client.IncompleteRead(b'')
        return Response()

    monkeypatch.setattr(MODULE.urllib.request, 'urlopen', urlopen)
    assert MODULE._read_url('https://api.github.com/repos/x/y/releases', 1024) == body
    assert len(attempts) == 2


def test_terminal_thread_states_do_not_block_updates():
    """Completed, unloaded, and system-error threads have no active turn."""

    for status in ('idle', 'notLoaded', 'systemError'):
        assert MODULE._thread_blocks_update({'status': {'type': status}}) is False


def test_active_and_unknown_thread_states_remain_safe():
    """An active or unrecognized state must prevent a restart."""

    for thread in (
        {'status': {'type': 'active'}},
        {'status': {'type': 'futureState'}},
        {'status': None},
        {},
    ):
        assert MODULE._thread_blocks_update(thread) is True
