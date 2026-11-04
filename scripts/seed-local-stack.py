#!/usr/bin/env python3
"""Synthetic records in genuine stores. No external database reads, no workers."""
import json
import os
from pathlib import Path
import sys
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parent.parent
STATE = ROOT/'.local-stack'
home = STATE/'hermes'
assert Path(os.environ['HERMES_HOME']).resolve() == home.resolve()
if '--fleet' in sys.argv:
    def api(path, value=None):
        request = Request('http://127.0.0.1:19452/api/v1'+path,
            data=json.dumps(value).encode() if value is not None else None,
            headers={'Authorization': 'Bearer local-acceptance', 'Content-Type': 'application/json'})
        with urlopen(request, timeout=5) as response:
            return json.load(response)
    marker = STATE/'fleet-seeded.json'
    if not marker.exists():
        tasks = [api('/tasks', {'title': title, 'kind': 'code', 'risk': 'R1',
            'spec_json': '合成验收数据；无真实用户信息；禁止派遣。', 'acceptance': '检查中文换行与卡片布局',
            'repo': 'https://example.invalid/acceptance/demo.git'}) for title in [
            '验收：长中文任务标题在桌面和手机屏幕上均可阅读且不会遮挡按钮', '验收：附件预览与基础资料检查']]
        marker.write_text(json.dumps(tasks, ensure_ascii=False, indent=2))
    print('Local fleetd: synthetic tasks seeded; no worker registered')
    sys.exit()

sys.path.insert(0, str(ROOT/'dashboard'))
from codex_bridge import BridgeStore
from hermes_state import SessionDB
store = BridgeStore(STATE/'codex.sqlite3')
for profile in ['default', 'writer', 'empty']:
    folder = home if profile == 'default' else home/'profiles'/profile
    folder.mkdir(parents=True, exist_ok=True)
    if profile != 'default':
        (folder/'config.yaml').write_text('model:\n  default: acceptance-offline\n')
    history = SessionDB(folder/'state.db')
    if profile == 'empty':
        history.close()
        continue
    workspace = STATE/'workspace'/profile
    workspace.mkdir(parents=True, exist_ok=True)
    (workspace/'验收附件.txt').write_text('公开合成资料。\n中文附件，编号 ACCEPTANCE-001。\n')
    groups = store.groups('acceptance', profile)
    group = groups[0] if groups else store.create_group('acceptance', profile, profile, str(workspace), '中文演示项目与超长标题换行验收')
    for n, title in enumerate(['验收：长中文会话标题用于检查真实布局中的换行截断以及手机端可读性', '验收：附件与项目资料整理']):
        sid = f'acceptance-{profile}-{n}'
        if not history.get_session(sid):
            history.create_session(sid, 'cli')
            history.set_session_title(sid, title)
            history.append_message(sid, 'user', '请检查合成附件：验收附件.txt')
            history.append_message(sid, 'assistant', '这是脱敏验收记录，没有真实用户历史。')
        history.end_session(sid, 'completed')
        history.set_session_title(sid, title)
        store.upsert_session('acceptance', profile, {'session_id': sid, 'thread_id': sid,
            'workspace_id': profile, 'workspace_path': str(workspace), 'title': title, 'title_source': 'user'})
        store.update_organization('acceptance', profile, sid, {'groupId': group['id']})
    history.close()
store.close()
print('Seeded default/writer/empty, projects, local session mappings and text attachments')
