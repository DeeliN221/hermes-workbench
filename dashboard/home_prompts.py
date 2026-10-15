"""Bounded, read-only homepage summaries without exporting tool transcripts."""
from __future__ import annotations
from contextlib import closing
import json
import re
import sqlite3
from fastapi import HTTPException
from skill_files import _profile_home


def visible_request(content):
    if not isinstance(content, str):
        return ''
    if content.startswith('\0json:'):
        try:
            parts = json.loads(content[6:])
            content = '\n'.join(part if isinstance(part, str) else str(part.get('text', '')) if part.get('type') == 'text' else '[Hermes media omitted]' if re.search('image|file|media', str(part.get('type', ''))) else '' for part in parts if isinstance(part, (dict, str))) if isinstance(parts, list) else ''
        except ValueError:
            return '[Invalid structured Hermes content]'
    value = content.strip()
    while True:
        before = value
        value = re.sub(r'^# AGENTS\.md instructions(?:\s+for\b[^\n]*)?\s*\n+\s*<INSTRUCTIONS>[\s\S]*?</INSTRUCTIONS>\s*', '', value, flags=re.I).strip()
        for tag in ['environment_context', 'system-reminder', 'codex_internal_context']:
            value = re.sub(r'^<' + tag + r'(?:\s[^>]*)?>[\s\S]*?</' + tag + r'>\s*', '', value, flags=re.I).strip()
            value = re.sub(r'\s*<' + tag + r'(?:\s[^>]*)?>[\s\S]*?</' + tag + r'>\s*$', '', value, flags=re.I).strip()
        if value == before:
            return value


def session_prompts(profile, session_id):
    _, home = _profile_home(profile)
    path = home / 'state.db'
    if not path.is_file() or path.is_symlink():
        raise HTTPException(404, 'Session database unavailable')
    with closing(sqlite3.connect(path.as_uri() + '?mode=ro', uri=True, timeout=2)) as connection:
        connection.row_factory = sqlite3.Row
        connection.execute('BEGIN')
        current = connection.execute('SELECT id,parent_session_id,source,model_config,end_reason FROM sessions WHERE id=?', (session_id,)).fetchone()
        if current is None:
            raise HTTPException(404, 'Session not found')
        lineage = [current['id']]
        while current['parent_session_id'] and current['parent_session_id'] not in lineage:
            try:
                config = json.loads(current['model_config'] or '{}')
            except (ValueError, TypeError):
                config = {}
            if current['source'] == 'tool' or isinstance(config, dict) and (config.get('_delegate_from') or config.get('_branched_from')):
                break
            parent = connection.execute('SELECT id,parent_session_id,source,model_config,end_reason FROM sessions WHERE id=?', (current['parent_session_id'],)).fetchone()
            if parent is None or parent['end_reason'] != 'compression':
                break
            lineage.insert(0, parent['id'])
            current = parent
            if len(lineage) > 100:
                raise HTTPException(422, 'Compression lineage exceeds summary limit')
        def edge(ids, direction):
            for sid in ids:
                # Indexed session/id scan; never transfer assistant or tool output.
                for row in connection.execute(f"SELECT content FROM messages WHERE session_id=? AND role='user' AND active=1 ORDER BY id {direction}", (sid,)):
                    value = visible_request(row[0])
                    if value:
                        return value[:2000]
            return ''
        return {'first': edge(lineage, 'ASC'), 'latest': edge(reversed(lineage), 'DESC')}
