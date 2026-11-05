"""Local-only integration harness using the same authenticated plugin router."""

import sys
import atexit
from tempfile import TemporaryDirectory
from types import SimpleNamespace
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "dashboard"))
from fastapi import FastAPI
from sidecar_app import TrustedProxyGate
import plugin_api
from codex_bridge import BridgeStore

app = FastAPI()
# Task metadata alone is no longer authorization to navigate. Seed actual
# identity-scoped mappings for the fixture's source/execution navigation tests.
_session_home = TemporaryDirectory(prefix="fleet-proxy-sessions-")
_store = BridgeStore(Path(_session_home.name) / "bridge.db")
for _profile in ("default", "writer"):
    _store.upsert_session("preview", _profile, {
        "session_id": "codex-preview", "thread_id": "native-preview",
        "workspace_id": "default", "workspace_path": _session_home.name,
        "execution_node_id": "dev-box",
    })
app.state.codex_bridge = SimpleNamespace(store=_store)
atexit.register(_store.close)
app.include_router(plugin_api.router, prefix="/api/plugins/workbench")
app.add_middleware(TrustedProxyGate)
