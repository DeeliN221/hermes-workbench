"""Exercise calendar boundaries, manual releases and collision-free date counters."""
from datetime import datetime
import importlib.util
import json
from pathlib import Path
import subprocess
import sys

import pytest

ROOT = Path(__file__).parents[1]
spec = importlib.util.spec_from_file_location('release_plan', ROOT / 'scripts/plan-release.py')
planner = importlib.util.module_from_spec(spec)
spec.loader.exec_module(planner)


def stamp(value):
    return datetime.fromisoformat(value).timestamp()


def test_utc8_previous_calendar_day_and_exclusive_midnight():
    # At 23:00 UTC, UTC+08:00 is already 07:00 on October 15.
    now = datetime.fromisoformat('2026-10-14T23:00:00+00:00')
    for value in ['2026-10-14T00:00:00+08:00', '2026-10-14T23:59:59+08:00']:
        result = planner.plan('schedule', now, [stamp(value)], [])
        assert result['tag'] == 'v20261015-1'
    for value in ['2026-10-13T23:59:59+08:00', '2026-10-15T00:00:00+08:00']:
        assert planner.plan('schedule', now, [stamp(value)], [])['publish'] == 'false'
    assert planner.plan('schedule', now, [], [])['publish'] == 'false'


def test_manual_release_without_changes_increments_numeric_counter():
    now = datetime.fromisoformat('2026-10-15T07:00:00+08:00')
    tags = ['v20261015-2', 'v20261015-10', '20261015-11', 'v20261014-99', 'v0.12.0', 'v20261015-01']
    assert planner.plan('workflow_dispatch', now, [], tags)['tag'] == 'v20261015-12'
    assert planner.plan('workflow_dispatch', now, [], ['v20261014-99'])['tag'] == 'v20261015-1'


def test_leap_day_and_year_boundary():
    for today, yesterday in [('2028-03-01', '2028-02-29'), ('2027-01-01', '2026-12-31')]:
        now = datetime.fromisoformat(today + 'T07:00:00+08:00')
        assert planner.plan('schedule', now, [stamp(yesterday + 'T12:00:00+08:00')], [])['publish'] == 'true'


def test_unrecognized_event_is_rejected():
    with pytest.raises(ValueError):
        planner.plan('push', datetime.now(planner.ZONE), [], [])


@pytest.mark.parametrize('version,valid', [
    ('20261015-1', True), ('20261015-12', True), ('20280229-1', True),
    ('20260229-1', False), ('20261301-1', False), ('20261015-0', False),
    ('20261015-01', False), ('v20261015-1', False), ('0.12.0', True), ('1.0.0-rc.1', True),
])
def test_version_cli_accepts_real_dates_and_retains_semver(tmp_path, version, valid):
    scripts = tmp_path / 'scripts'
    scripts.mkdir()
    (scripts / 'version.py').write_bytes((ROOT / 'scripts/version.py').read_bytes())
    (tmp_path / 'dashboard').mkdir()
    for path in ['package.json', 'dashboard/manifest.json']:
        (tmp_path / path).write_text(json.dumps({'version': '0.12.0'}))
    result = subprocess.run([sys.executable, str(scripts / 'version.py'), version], capture_output=True)
    assert (result.returncode == 0) == valid
    if valid:
        for path in ['package.json', 'dashboard/manifest.json']:
            assert json.loads((tmp_path / path).read_text())['version'] == version
        subprocess.run([sys.executable, str(scripts / 'version.py'), '--check'], check=True)
