"""Process-local demonstration data; never contacts Fleet or writes a database."""

from copy import deepcopy
from datetime import datetime, timezone
from threading import RLock
from uuid import uuid4
from urllib.parse import urlsplit, parse_qs
from fastapi import HTTPException

_lock = RLock()
_now = datetime.now(timezone.utc).isoformat()
_tasks = {
    "demo-review": dict(
        id="demo-review",
        title="Review the sample report",
        status="review",
        revision=1,
        created_at=_now,
        risk="R2",
        priority="P1",
        verify_mode="human",
        repo="sample/workbench",
        machine="demo",
        spec_json={"summary": "Demonstration only; no worker or backend is connected."},
        acceptance=[{"label": "Report checks pass", "checked": True}],
    ),
    "demo-decision": dict(
        id="demo-decision",
        title="Choose a sample rollout",
        status="blocked",
        revision=1,
        created_at=_now,
        risk="R2",
        priority="P2",
        verify_mode="human",
        acceptance=[],
        spec_json={},
        decision={
            "id": "demo-choice",
            "question": "Which rollout should proceed?",
            "options": [
                {
                    "id": "a",
                    "label": "Gradual rollout",
                    "impact": "Lower risk, more time",
                    "recommended": True,
                },
                {"id": "b", "label": "All at once", "impact": "Faster, wider impact"},
            ],
        },
    ),
}
_artifacts = [
    {
        "id": "demo-report",
        "task_id": "demo-review",
        "kind": "report",
        "name": "demo-report.txt",
        "size": 25,
        "content_type": "text/plain",
    }
]


def request(method, path, body=None, revision=None, binary=False):
    with _lock:
        return deepcopy(_request(method, path, body or {}, revision))


def _request(method, path, body, revision):
    url = urlsplit(path)
    parts = url.path.split("/")
    if parts == ["artifacts", "demo-report", "download"]:
        return b"Demonstration checks pass\n"
    if parts == ["tasks"]:
        if method == "GET":
            status = parse_qs(url.query).get("status", [None])[0]
            return {
                "tasks": [
                    t for t in _tasks.values() if not status or t["status"] == status
                ]
            }
        task = dict(
            id="demo-" + uuid4().hex[:12],
            title=body["title"],
            status="triage",
            revision=1,
            created_at=datetime.now(timezone.utc).isoformat(),
            risk="R1",
            priority="P2",
            acceptance=[],
            spec_json={},
            repo="",
            machine="",
            verify_mode="auto",
        )
        _tasks[task["id"]] = task
        return {"task": task}
    if len(parts) < 2 or parts[1] not in _tasks:
        raise HTTPException(404, "Demo task not found; refresh")
    task = _tasks[parts[1]]
    if method == "GET":
        return {
            "task": task,
            "artifacts": [a for a in _artifacts if a["task_id"] == task["id"]],
            "decision": task.get("decision"),
        }
    if revision != task["revision"]:
        raise HTTPException(409, "Task changed elsewhere; reload and retry")
    if method == "PATCH":
        task.update(body)
    else:
        action = parts[2]
        if action == "decide":
            task.pop("decision", None)
            task["status"] = "ready"
        else:
            task["status"] = dict(
                dispatch="ready",
                archive="archived",
                restore="triage",
                approve="done",
                request_changes="running",
            ).get(action, body.get("status"))
    if task["status"] == "done":
        task["verified_by"] = "human" if task.get("verify_mode") == "human" else "agent"
    task["revision"] += 1
    return {"task": task}
