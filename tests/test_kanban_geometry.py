import sys
import json
import subprocess
from pathlib import Path
from fastapi import FastAPI
from fastapi.testclient import TestClient
sys.path.insert(0, str(Path(__file__).parents[1] / 'dashboard'))
import plugin_api as api


def test_geometry_api_restart_isolation_validation_and_corruption(tmp_path, monkeypatch):
    monkeypatch.setattr(api, '_workspace_root', lambda: tmp_path)
    app = FastAPI()
    app.include_router(api.router, prefix='/api/plugins/workbench')
    url = '/api/plugins/workbench/kanban-geometry'
    value = dict(x=.1, y=.2, width=.6, height=.7)
    with TestClient(app) as client:
        assert client.get(url).json() == {'geometry': None}
        assert client.put(url, json=value).status_code == 200
        for bad in [dict(value, x=-1), dict(value, width=2), dict(value, x='0.1'), dict(value, height=True)]:
            assert client.put(url, json=bad).status_code == 422
        assert client.get(url + '?profile=writer').json() == {'geometry': None}
        assert client.put(url + '?profile=../escape', json=value).status_code == 422
        assert client.get(url, headers={'remote-user': 'spoofed'}).json()['geometry'] == value
    with TestClient(app) as restarted:
        assert restarted.get(url).json()['geometry'] == value
    restarted = subprocess.run([sys.executable, '-c', """
import sys, json
from pathlib import Path
sys.path.insert(0, str(Path.cwd() / 'dashboard'))
import plugin_api as api
api._workspace_root = lambda: Path(sys.argv[1])
print(json.dumps(api._kanban_geometry('instance-owner', 'default')))
""", str(tmp_path)], cwd=Path(__file__).parents[1], capture_output=True, text=True, check=True)
    assert json.loads(restarted.stdout)['geometry'] == value
    assert api._kanban_geometry('other', 'default')['geometry'] is None
    db = api._open_organization_db()
    for payload in ['broken', '{"x":0.9,"y":0,"width":0.8,"height":0.8}']:
        db.execute('UPDATE kanban_geometry SET payload=?', (payload,))
        db.commit()
        assert api._kanban_geometry('instance-owner', 'default')['geometry'] is None
    db.close()
