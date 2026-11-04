import importlib.util
import json
from pathlib import Path

import pytest

ROOT = Path(__file__).parents[1]
spec = importlib.util.spec_from_file_location('configure_opencode_go', ROOT / 'scripts/configure-opencode-go.py')
helper = importlib.util.module_from_spec(spec)
spec.loader.exec_module(helper)


def test_merge_preserves_gpt_deepseek_and_default(tmp_path):
    config = tmp_path / 'config.json'
    original = {'defaultProvider': 'openai', 'providers': {
        'openai': {'adapter': 'openai-responses'},
        'deepseek': {'adapter': 'openai-chat', 'apiKey': '${DEEPSEEK_API_KEY}'},
    }, 'disabledModels': ['old-model']}
    config.write_text(json.dumps(original))
    assert helper.merge_provider_config(config) == 'added'
    merged = json.loads(config.read_text())
    go = merged['providers'].pop('opencode-go')
    assert merged == original
    assert go['apiKey'] == '${OPENCODE_GO_API_KEY}'
    assert go['baseUrl'] == 'https://opencode.ai/zen/go/v1'
    assert go['adapter'] == 'openai-chat'
    assert config.stat().st_mode & 0o777 == 0o600
    saved = config.read_bytes()
    assert helper.merge_provider_config(config).startswith('present')
    assert config.read_bytes() == saved


def test_missing_home_dry_run_and_existing_custom_go(tmp_path):
    config = tmp_path / 'new' / 'config.json'
    assert helper.merge_provider_config(config, dry_run=True) == 'dry-run'
    assert not config.exists()
    assert helper.merge_provider_config(config) == 'added'
    config.write_text('{"providers":{"opencode-go":{"custom":true}}}')
    original = config.read_bytes()
    assert helper.merge_provider_config(config).startswith('present')
    assert config.read_bytes() == original


@pytest.mark.parametrize('content', ['[]', '{"providers":[]}', 'not valid JSON'])
def test_invalid_config_is_not_overwritten(tmp_path, content):
    config = tmp_path / 'config.json'
    config.write_text(content)
    with pytest.raises(ValueError):
        helper.merge_provider_config(config)
    assert config.read_text() == content


def test_symlinks_and_directories_are_rejected(tmp_path):
    target = tmp_path / 'target'
    target.write_text('{}')
    config = tmp_path / 'config.json'
    config.symlink_to(target)
    with pytest.raises(ValueError):
        helper.merge_provider_config(config)
    assert target.read_text() == '{}'
    config.unlink()
    config.mkdir()
    with pytest.raises(ValueError):
        helper.merge_provider_config(config)


def test_main_never_prints_config_or_environment(tmp_path, capsys, monkeypatch):
    monkeypatch.setenv('OPENCODE_GO_API_KEY', 'fake-sensitive-test-value')
    assert helper.main(['--opencodex-home', str(tmp_path)]) == 0
    assert 'fake-sensitive-test-value' not in (tmp_path / 'config.json').read_text()
    (tmp_path / 'config.json').write_text('fake-sensitive-test-value')
    assert helper.main(['--opencodex-home', str(tmp_path)]) == 1
    captured = capsys.readouterr()
    assert 'fake-sensitive-test-value' not in captured.out + captured.err
