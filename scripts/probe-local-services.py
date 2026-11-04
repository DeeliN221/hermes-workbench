#!/usr/bin/env python3
"""Probe real local services, including authenticated app-server initialization."""
import asyncio
import json
from pathlib import Path
from urllib.request import urlopen
import websockets
ROOT = Path(__file__).resolve().parent.parent
async def main():
    for url in ['http://127.0.0.1:9119/api/dashboard/plugins', 'http://127.0.0.1:9451/health', 'http://127.0.0.1:19452/healthz']:
        with urlopen(url, timeout=5) as response:
            assert response.status == 200
    token = (ROOT/'.local-stack/codex-home/ws-token').read_text().strip()
    async with websockets.connect('ws://127.0.0.1:9450', additional_headers={'Authorization': 'Bearer '+token}, open_timeout=5) as ws:
        await ws.send(json.dumps({'id': 1, 'method': 'initialize', 'params': {'clientInfo': {'name': 'workbench-acceptance', 'version': '1.0'}}}))
        response = json.loads(await asyncio.wait_for(ws.recv(), 5))
        assert response.get('id') == 1 and 'result' in response, response
        print(json.dumps({'services_healthy': True, 'codex_initialize': response['result']}, indent=2))
asyncio.run(main())
