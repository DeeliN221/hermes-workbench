"""Loopback-only browser fixture: real persistence, fictional provider values."""
import sys
from pathlib import Path
from tempfile import TemporaryDirectory
from types import SimpleNamespace

from fastapi import FastAPI
sys.path.insert(0, str(Path(__file__).parents[1] / 'dashboard'))
from quota_dashboard import create_router
from subscription_entries import SubscriptionStore

state = TemporaryDirectory(prefix='workbench-subscription-browser-')
async def quota(*args):
    return {'rateLimits': {'limitId': 'codex', 'primary': {
        'usedPercent': 25, 'windowDurationMins': 300, 'resetsAt': 1893456000}}}
app = FastAPI()
app.include_router(create_router(SimpleNamespace(read_quota=quota), SubscriptionStore(Path(state.name) / 'subscriptions.db')),
                   prefix='/api/plugins/workbench')
