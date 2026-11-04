"""Screenshots must fail before browser launch for stale sources or served bytes."""
import hashlib
import importlib.util
import io
import json
from pathlib import Path
from unittest.mock import patch
import pytest

spec = importlib.util.spec_from_file_location('guard', Path(__file__).parents[1]/'scripts/verify-local-runtime.py')
guard = importlib.util.module_from_spec(spec)
spec.loader.exec_module(guard)

@pytest.mark.parametrize('fault', ['commit', 'source', 'disk', 'process', 'http', None])
def test_runtime_guard(tmp_path, fault):
    assets = {'index.js': hashlib.sha256(b'js').hexdigest(), 'style.css': hashlib.sha256(b'css').hexdigest()}
    record = {'git_commit': 'head', 'source_sha256': 'source', 'assets': assets}
    runtime = {**record, 'started_at': '2026-11-04T00:00:00Z'}
    if fault == 'commit': record['git_commit'] = 'old'
    if fault == 'source': record['source_sha256'] = 'old'
    if fault == 'process': runtime['git_commit'] = 'old'
    dist = tmp_path/'dashboard/dist'
    dist.mkdir(parents=True)
    (dist/'build-provenance.json').write_text(json.dumps(record))
    def response(url, **kwargs):
        if url.endswith('/version'): data = json.dumps(runtime).encode()
        elif url.endswith('/health'): data = b'{"status":"ok"}'
        elif url.endswith('/capabilities'): data = b'{"codexChat":true}'
        elif url.endswith('.js'): data = b'old' if fault == 'http' else b'js'
        else: data = b'css'
        return io.BytesIO(data)
    with patch.object(guard, 'ROOT', tmp_path), patch.object(guard.subprocess, 'check_output', return_value='head'), patch.object(guard.provenance, 'source_digest', return_value='source'), patch.object(guard.provenance, 'asset_hashes', return_value={} if fault == 'disk' else assets), patch.object(guard, 'urlopen', side_effect=response):
        if fault:
            with pytest.raises(AssertionError): guard.verify()
        else:
            assert guard.verify()['git_commit'] == 'head'
