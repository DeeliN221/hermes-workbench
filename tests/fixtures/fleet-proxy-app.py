"""Local-only integration harness using the same authenticated plugin router."""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "dashboard"))
from fastapi import FastAPI
from sidecar_app import TrustedProxyGate
import plugin_api

app = FastAPI()
app.include_router(plugin_api.router, prefix="/api/plugins/workbench")
app.add_middleware(TrustedProxyGate)
