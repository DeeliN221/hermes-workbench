"""Local stdlib MCP fixture; no network, files, or credentials."""
import json
import os
import sys

for line in sys.stdin:
    request = json.loads(line)
    method = request.get('method')
    if 'id' not in request:
        continue
    if method == 'initialize':
        result = {'protocolVersion': request['params']['protocolVersion'], 'capabilities': {'tools': {}},
                  'serverInfo': {'name': 'workbench-local-fixture', 'version': '1.0'}}
    elif method == 'tools/list':
        result = {'tools': [{'name': 'scope_marker', 'description': 'Returns the current profile MCP marker.',
                             'inputSchema': {'type': 'object', 'properties': {}, 'additionalProperties': False}}]}
    elif method == 'tools/call':
        result = {'content': [{'type': 'text', 'text': os.environ.get('PROBE_MARKER', 'fixture-marker')}], 'isError': False}
    elif method == 'ping':
        result = {}
    else:
        print(json.dumps({'jsonrpc': '2.0', 'id': request['id'], 'error': {'code': -32601, 'message': 'Unknown method'}}), flush=True)
        continue
    print(json.dumps({'jsonrpc': '2.0', 'id': request['id'], 'result': result}), flush=True)
