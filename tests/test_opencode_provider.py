import io
import json
import sys
import urllib.error
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).parents[1] / 'dashboard'))
import opencode_provider as provider

FIXTURES = Path(__file__).parent / 'fixtures'


@pytest.fixture(autouse=True)
def reset_model_cache():
    provider._CACHE = (0.0, ())
    yield


def test_normalize_models_dedupes_and_prefixes():
    payload = json.loads((FIXTURES / 'opencode-models.json').read_text())
    models = provider._normalize_models(payload)
    assert [m['id'] for m in models] == ['opencode-go/kimi-k3', 'opencode-go/o3-mini']
    assert models[0]['displayName'] == 'kimi-k3'
    assert models[0]['supportedReasoningEfforts'] == []
    assert models[0]['isDefault'] is False


def test_normalize_models_rejects_non_array_data():
    assert provider._normalize_models({'data': {'id': 'x'}}) == []
    assert provider._normalize_models({'models': []}) == []


def test_normalize_models_maps_mime_modalities():
    payload = {
        'data': [{
            'id': 'vision-model',
            'modalities': {'input': ['text', 'image/png', 'audio/wav']},
        }]
    }
    model = provider._normalize_models(payload)[0]
    assert model['inputModalities'] == ['text', 'image', 'audio']


def test_model_options_unauthenticated_when_no_creds(monkeypatch):
    monkeypatch.setattr(provider, '_auth_headers', lambda: {})
    option = provider.model_options()
    assert option.slug == 'opencode-go'
    assert option.authenticated is False
    assert option.models == []


def test_model_options_lists_models(monkeypatch, tmp_path):
    path = tmp_path / 'auth.json'
    path.write_text(json.dumps({'token': 'SECRET'}))
    path.chmod(0o600)
    monkeypatch.setenv('WORKBENCH_OPENCODE_AUTH_FILE', str(path))

    class Opener:
        def open(self, req, timeout):
            assert req.get_header('Authorization') == 'Bearer SECRET'
            assert req.get_header('User-agent') == 'Hermes-Workbench/1.0'
            assert req.get_header('Accept') == 'application/json'
            assert req.full_url == provider.MODELS_URL
            return io.BytesIO((FIXTURES / 'opencode-models.json').read_bytes())

    monkeypatch.setattr(provider.urllib.request, 'build_opener', lambda *args: Opener())
    option = provider.model_options()
    assert option.authenticated is True
    assert option.models == ['opencode-go/kimi-k3', 'opencode-go/o3-mini']


def test_model_options_401(monkeypatch, tmp_path):
    path = tmp_path / 'auth.json'
    path.write_text(json.dumps({'token': 'SECRET'}))
    path.chmod(0o600)
    monkeypatch.setenv('WORKBENCH_OPENCODE_AUTH_FILE', str(path))

    class Opener:
        def open(self, req, timeout):
            raise urllib.error.HTTPError(req.full_url, 401, 'Unauthorized', {}, io.BytesIO(b'SECRET'))

    monkeypatch.setattr(provider.urllib.request, 'build_opener', lambda *args: Opener())
    with pytest.raises(Exception) as excinfo:
        provider.model_options()
    assert '401' in str(excinfo.value) or 'rejected' in str(excinfo.value)


def test_model_catalog_graceful_on_error(monkeypatch, tmp_path):
    path = tmp_path / 'auth.json'
    path.write_text(json.dumps({'token': 'SECRET'}))
    path.chmod(0o600)
    monkeypatch.setenv('WORKBENCH_OPENCODE_AUTH_FILE', str(path))

    class Opener:
        def open(self, req, timeout):
            raise urllib.error.URLError('offline')

    monkeypatch.setattr(provider.urllib.request, 'build_opener', lambda *args: Opener())
    catalog = provider.model_catalog()
    assert catalog == {'data': []}


def test_no_secret_leakage(monkeypatch, tmp_path, capsys, caplog):
    path = tmp_path / 'auth.json'
    path.write_text(json.dumps({'token': 'SECRET'}))
    path.chmod(0o600)
    monkeypatch.setenv('WORKBENCH_OPENCODE_AUTH_FILE', str(path))

    class Opener:
        def open(self, req, timeout):
            raise urllib.error.HTTPError(req.full_url, 500, 'SECRET', {}, io.BytesIO(b'SECRET'))

    monkeypatch.setattr(provider.urllib.request, 'build_opener', lambda *args: Opener())
    with pytest.raises(Exception):
        provider.model_options()
    captured = capsys.readouterr()
    assert 'SECRET' not in captured.out and 'SECRET' not in captured.err
    assert 'SECRET' not in caplog.text
