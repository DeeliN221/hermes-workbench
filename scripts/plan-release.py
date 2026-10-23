#!/usr/bin/env python3
"""Plan a UTC+08:00 calendar release without mutating Git or publishing anything."""
import argparse
from datetime import datetime, timedelta, timezone
import json
import os
from pathlib import Path
import re
import subprocess

ZONE = timezone(timedelta(hours=8))


def plan(event, now, commits, tags):
    """Scheduled runs need yesterday's main commits; manual runs always allocate."""
    if event not in ('schedule', 'workflow_dispatch'):
        raise ValueError('Only scheduled and manual releases are supported')
    local = now.astimezone(ZONE)
    end = local.replace(hour=0, minute=0, second=0, microsecond=0)
    start = end - timedelta(days=1)
    if event == 'schedule' and not any(start.timestamp() <= stamp < end.timestamp() for stamp in commits):
        return {'publish': 'false', 'reason': f'No main commits on {start.date()} (UTC+08:00)'}
    day = local.strftime('%Y%m%d')
    pattern = re.compile(rf'v?{day}-([1-9][0-9]*)$')
    counters = [int(match[1]) for tag in tags if (match := pattern.fullmatch(tag))]
    version = f'{day}-{max(counters, default=0) + 1}'
    return {'publish': 'true', 'version': version, 'tag': f'v{version}',
            'reason': 'Manual release' if event == 'workflow_dispatch' else f'Main changed on {start.date()} (UTC+08:00)'}


def previous_published_tag(releases):
    """Return the newest published stable release tag for release-note comparison."""
    published = [
        row for row in releases
        if row.get('tag_name') and not row.get('draft') and not row.get('prerelease')
    ]
    if not published:
        return ''
    newest = max(published, key=lambda row: row.get('published_at') or row.get('created_at') or '')
    return newest['tag_name']


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--event', default=os.environ.get('GITHUB_EVENT_NAME'))
    parser.add_argument('--releases', type=Path, required=True)
    args = parser.parse_args()
    def git(*arguments):
        return subprocess.check_output(['git', *arguments], text=True).splitlines()
    releases = json.loads(args.releases.read_text())
    tags = git('tag', '--list')
    # Include drafts as well as tags, so an interrupted upload never reuses a number.
    tags += [row['tag_name'] for row in releases]
    commits = [int(stamp) for stamp in git('log', '--first-parent', '--format=%ct', 'origin/main')]
    result = plan(args.event, datetime.now(ZONE), commits, tags)
    if result['publish'] == 'true':
        result['previous_tag'] = previous_published_tag(releases)
    if output := os.environ.get('GITHUB_OUTPUT'):
        with open(output, 'a') as stream:
            stream.write(''.join(f'{key}={value}\n' for key, value in result.items()))
    if summary := os.environ.get('GITHUB_STEP_SUMMARY'):
        with open(summary, 'a') as stream:
            stream.write(result['reason'] + '\n\n' + result.get('tag', 'Release skipped') + '\n')
    print(json.dumps(result))


if __name__ == '__main__':
    main()
