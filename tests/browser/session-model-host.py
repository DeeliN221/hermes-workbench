"""Local browser fixture: real Workbench host/API/storage, neutral runtime fixture."""
import argparse
import importlib.util
import socket
import threading
from pathlib import Path
import sys

import uvicorn
from fastapi.responses import FileResponse, JSONResponse

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
from dashboard.standalone_app import create_app

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--state', type=Path, required=True)
parser.add_argument('--port', type=int, required=True)
parser.add_argument('--assets', type=Path)
args = parser.parse_args()
spec = importlib.util.spec_from_file_location('model_protocol_fixture', ROOT / 'tests/standalone_protocol_fixture.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
runtime = module.create_fixture()
runtime.state.model_catalog = {'models': [
    {'id': ident, 'name': name, 'provider': 'fixture-provider', 'is_default': ident == 'model-alpha',
     'reasoning': {'efforts': [] if ident == 'model-gamma' else [{'id': 'low'}, {'id': 'high'}]}}
    for ident, name in [('model-alpha', 'Model Alpha'), ('model-beta', 'Model Beta'), ('model-gamma', 'Model Gamma')]
], 'default': {'model': 'model-alpha', 'provider': 'fixture-provider'}}
control = {'fail': False, 'writes': 0}

@runtime.middleware('http')
async def model_failure(request, call_next):
    if request.method == 'POST' and request.url.path.endswith('/model'):
        control['writes'] += 1
        if control['fail']:
            return JSONResponse({'detail': 'Fixture model service unavailable'}, status_code=503)
    return await call_next(request)

with socket.socket() as reservation:
    reservation.bind(('127.0.0.1', 0))
    runtime_port = reservation.getsockname()[1]
runtime_server = uvicorn.Server(uvicorn.Config(runtime, host='127.0.0.1', port=runtime_port, log_level='warning'))
threading.Thread(target=runtime_server.run, daemon=True).start()
app = create_app(home=args.state / 'host', workspace_root=args.state / 'workspaces', runtime_url=f'http://127.0.0.1:{runtime_port}',
                 services_module=module.create_services_fixture())

@app.middleware('http')
async def fixture_controls(request, call_next):
    if request.url.path == '/__fixture/control':
        if request.method == 'POST':
            control.update(await request.json())
        return JSONResponse(control)
    if args.assets and not request.url.path.startswith('/api/'):
        path = (args.assets / request.url.path.lstrip('/')).resolve()
        if not path.is_relative_to(args.assets.resolve()):
            return JSONResponse({}, status_code=404)
        return FileResponse(path if path.is_file() else args.assets / 'standalone.html')
    return await call_next(request)

uvicorn.run(app, host='127.0.0.1', port=args.port, log_level='warning')
