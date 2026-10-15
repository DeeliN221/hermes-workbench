"""Verify date-tag release installation, catalog selection, ordering and recovery."""

import io
import json
from pathlib import Path
import sys
import tarfile

import pytest

sys.path.insert(0, str(Path(__file__).parents[1] / 'dashboard'))
from release_runtime import ReleaseStore, write_json
import workbench_version_manager as versions
from test_release_runtime import release


def package_release(path, version, prefix=None):
    """Build the actual archive layout used by published date-tag releases."""
    output = io.BytesIO()
    with tarfile.open(fileobj=output, mode='w:gz') as archive:
        archive.add(path, arcname=prefix or 'hermes-workbench-' + version)
    return output.getvalue()


@pytest.mark.parametrize('version', ['20260927-1', '20260927-12'])
def test_date_release_stages_activates_and_recovers_previous_version(tmp_path, version):
    """Retain rollback capability when an interrupted update uses date-style versions."""
    source = release(ReleaseStore(tmp_path / 'source'), version)
    store = ReleaseStore(tmp_path / 'target')
    release(store, '0.8.2')
    store.activate('0.8.2')
    store.stage(package_release(source, version), version)
    store.activate(version)
    assert store.active() == version
    write_json(store.job, {'phase': 'activating', 'previous': '0.8.2', 'version': version})
    store.recover()
    assert store.active() == '0.8.2'
    assert store.status()['phase'] == 'failed'


@pytest.mark.parametrize('prefix', ['hermes-workbench-v20260927-1', 'hermes-workbench-20260927-1'])
def test_date_archive_accepts_both_published_prefixes(tmp_path, prefix):
    """Install the new v-prefixed archives and retain legacy date releases."""
    version = '20260927-1'
    source = release(ReleaseStore(tmp_path / 'source'), version)
    store = ReleaseStore(tmp_path / 'target')
    store.stage(package_release(source, version, prefix), version)
    store.validate(version)


def test_date_archive_rejects_mixed_roots(tmp_path):
    """Two allowed root spellings cannot be mixed within one archive."""
    output = io.BytesIO()
    with tarfile.open(fileobj=output, mode='w:gz') as archive:
        for name in ['hermes-workbench-v20261015-1/one', 'hermes-workbench-20261015-1/two']:
            item = tarfile.TarInfo(name)
            item.size = 1
            archive.addfile(item, io.BytesIO(b'x'))
    with pytest.raises(ValueError, match='Unexpected release root'):
        ReleaseStore(tmp_path).stage(output.getvalue(), '20261015-1')


@pytest.mark.parametrize('version', ['20260927-0', '20260927-01', '../20260927-1'])
def test_invalid_date_release_names_are_rejected(tmp_path, version):
    """Reject invalid counters and path escapes before creating release directories."""
    store = ReleaseStore(tmp_path)
    with pytest.raises(ValueError):
        store.target(version)


@pytest.mark.parametrize('uptime', [30.0, 1000.0])
def test_date_catalog_checks_assets_and_keeps_semver_support(monkeypatch, uptime):
    """Only advertise installable releases and use their actual published tag URLs."""
    payload = [
        {'tag_name': '20260927-2', 'assets': [{'name': 'hermes-workbench-20260927-2.tar.gz'}, {'name': 'SHA256SUMS'}]},
        {'tag_name': 'v0.8.2', 'assets': [{'name': 'hermes-workbench-v0.8.2.tar.gz'}, {'name': 'SHA256SUMS'}]},
        {'tag_name': 'v20261015-1', 'assets': [{'name': 'hermes-workbench-v20261015-1.tar.gz'}, {'name': 'SHA256SUMS'}]},
        {'tag_name': '20260928-1', 'assets': [{'name': 'hermes-workbench-20260928-1.tar.gz'}]},
    ]
    monkeypatch.setattr(versions, '_catalog', (0, []))
    monkeypatch.setattr(versions.time, 'monotonic', lambda: uptime)
    monkeypatch.setattr(versions, '_read_url', lambda url, limit: json.dumps(payload).encode())
    rows = versions._github_releases()
    assert {row['version'] for row in rows} == {'20260927-2', '0.8.2', '20261015-1'}
    assert next(row for row in rows if row['version'] == '20261015-1')['url'].endswith('/tag/v20261015-1')
    assert next(row for row in rows if row['version'] == '20260927-2')['url'].endswith('/tag/20260927-2')
    assert next(row for row in rows if row['version'] == '0.8.2')['url'].endswith('/tag/v0.8.2')
    # A successful fetch should remain cached, including on a newly booted host.
    monkeypatch.setattr(versions, '_read_url', lambda *_: pytest.fail('cache was ignored'))
    assert versions._github_releases() == rows


def test_date_releases_sort_by_day_and_numeric_counter():
    """Present newer date releases first without sorting counters lexicographically."""
    values = ['20260927-2', '0.8.2', '20260927-10', '20260928-1']
    assert sorted(values, key=versions._version_key, reverse=True) == [
        '20260928-1', '20260927-10', '20260927-2', '0.8.2',
    ]


@pytest.mark.parametrize('tag', ['20260927-1', 'v20260927-1'])
def test_date_download_uses_published_tag_and_checksum(monkeypatch, tmp_path, tag):
    """Fetch a date-tag package through the catalog and verify its checksum before staging."""
    import hashlib
    version = '20260927-1'
    source = release(ReleaseStore(tmp_path / 'source'), version)
    data = package_release(source, version, 'hermes-workbench-' + tag)
    store = ReleaseStore(tmp_path / 'target')
    monkeypatch.setenv('WORKBENCH_RELEASE_HOME', str(store.root))
    monkeypatch.setattr(versions, '_github_releases', lambda: [{'version': version, 'tag': tag}])
    urls = []

    def fetch(url, limit):
        """Serve fixture bytes while recording the published download URLs."""
        urls.append(url)
        if url.endswith('SHA256SUMS'):
            return f'{hashlib.sha256(data).hexdigest()}  hermes-workbench-{tag}.tar.gz\n'.encode()
        return data

    monkeypatch.setattr(versions, '_read_url', fetch)
    versions._download_release(version)
    store.validate(version)
    assert all('/download/' + tag + '/' in url for url in urls)
    assert urls[-1].endswith('/hermes-workbench-' + tag + '.tar.gz')
