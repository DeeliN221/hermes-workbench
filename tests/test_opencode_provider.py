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


def test_default_models_url_is_the_official_catalog():
    assert provider.MODELS_URL == 'https://opencode.ai/inference/go/v1/models'


@pytest.mark.parametrize('variable', ['OPENCODE_API_KEY', 'OPENCODE_GO_API_KEY'])
def test_auth_headers_accepts_environment_without_file(monkeypatch, variable):
    monkeypatch.delenv('WORKBENCH_OPENCODE_AUTH_FILE', raising=False)
    monkeypatch.setenv('XDG_DATA_HOME', '/nonexistent-opencode-home')
    monkeypatch.delenv('OPENCODE_API_KEY', raising=False)
    monkeypatch.delenv('OPENCODE_GO_API_KEY', raising=False)
    assert provider._auth_headers() == {}
    monkeypatch.setenv(variable, 'oc_sk_env-key')
    assert provider._auth_headers() == {'Authorization': 'Bearer oc_sk_env-key'}


def test_auth_headers_rejects_multiline_environment_key(monkeypatch):
    monkeypatch.delenv('OPENCODE_GO_API_KEY', raising=False)
    monkeypatch.setenv('OPENCODE_API_KEY', 'oc_sk_bad\nX-Injected: 1')
    monkeypatch.setattr(provider.live_allowances, 'opencode_headers', lambda: {})
    assert provider._auth_headers() == {}


def test_normalize_models_uses_official_schema_fields():
    payload = {'data': [{
        'id': 'qwen3.8-max', 'name': 'Qwen3.8 Max', 'description': 'Qwen flagship',
        'capabilities': {'reasoning': {'supported': True, 'effort': ['low', 'high', 'max']}},
        'limit': {'context': 262144, 'output': 131072},
        'modalities': {'input': ['text', 'image/png']},
    }]}
    model = provider._normalize_models(payload)[0]
    assert model['id'] == 'opencode-go/qwen3.8-max'
    assert model['displayName'] == 'Qwen3.8 Max'
    assert model['description'] == 'Qwen flagship'
    assert [e['reasoningEffort'] for e in model['supportedReasoningEfforts']] == ['low', 'high', 'max']
    assert model['defaultReasoningEffort'] == 'low'
    assert model['contextWindow'] == 262144
    assert model['inputModalities'] == ['text', 'image']


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
            assert req.get_header('Authorization') is None
            assert req.get_header('Cookie') is None
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
