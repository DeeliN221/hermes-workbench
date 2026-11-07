"""Behavioral acceptance for isolated files/config/archive/PTY services."""

from __future__ import annotations

import asyncio
import io
import json
import os
import re
import sys
import time
import zipfile
from pathlib import Path

import pytest
from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).parents[1]))
from dashboard.standalone_services import (
    StandaloneServices,
    create_services_router,
    create_extra_router,
    build_runtime_context,
)

import base64
import struct
import zlib


def png_chunk(kind, value):
    return (
        struct.pack(">I", len(value))
        + kind
        + value
        + struct.pack(">I", zlib.crc32(kind + value) & 0xFFFFFFFF)
    )


PNG = (
    b"\x89PNG\r\n\x1a\n"
    + png_chunk(b"IHDR", struct.pack(">IIBBBBB", 1, 1, 8, 6, 0, 0, 0))
    + png_chunk(b"IDAT", zlib.compress(b"\x00\x00\x00\x00\xff"))
    + png_chunk(b"IEND", b"")
)

API = "/api/plugins/workbench"


@pytest.fixture
def env(tmp_path):
    workspace = tmp_path / "workspace"
    workspace.mkdir()
    storage = tmp_path / "isolated"
    context = {
        "user_id": "alice",
        "profile_id": "default",
        "project_id": "project",
        "workspace": str(workspace),
    }

    async def resolver(request):
        if request.headers.get("x-user") == "unauthorized":
            raise HTTPException(401, "Unauthorized")
        return {
            **context,
            "user_id": request.headers.get("x-user", "alice"),
            "profile_id": request.headers.get("x-profile", "default"),
            "project_id": request.headers.get("x-project", "project"),
        }

    services = StandaloneServices(resolver, storage)
    services.bind_session(
        context,
        {
            "id": "session1",
            "runtime": "dsh",
            "profile_id": "default",
            "project_id": "project",
        },
    )
    app = FastAPI()
    app.include_router(services.router(), prefix=API)
    app.include_router(services.extra_router())
    with TestClient(app) as client:
        yield services, client, context, workspace, storage


def test_factory_contract_and_sync_context(tmp_path):
    def resolve(request):
        return {
            "user_id": "u",
            "profile_id": "actual",
            "project_id": "p",
            "workspace": str(tmp_path),
        }

    router = create_services_router(resolve, tmp_path / "state")
    app = FastAPI()
    app.include_router(router, prefix=API)
    app.include_router(create_extra_router(services=router.services))
    with TestClient(app) as client:
        assert client.get(API + "/workspace").json()["workspace"]["path"] == str(
            tmp_path
        )
        assert client.get(API + "/workspace?profile=default").status_code == 403
        assert client.get("/api/profiles/sessions").json()["sessions"] == []


def test_file_edit_conflict_create_and_isolation(env):
    services, client, c, root, _ = env
    (root / "notes.txt").write_text("original")
    row = client.get(API + "/file?path=notes.txt").json()
    assert row["content"] == "original"
    changed = client.put(
        API + "/file?path=notes.txt",
        json={"content": "changed", "version": row["version"]},
    )
    assert changed.status_code == 200, changed.text
    assert (
        client.put(
            API + "/file?path=notes.txt",
            json={"content": "lost", "version": row["version"]},
        ).status_code
        == 409
    )
    assert (root / "notes.txt").read_text() == "changed"
    assert (
        client.put(
            API + "/file?path=new.txt", json={"content": "new", "mode": "create"}
        ).status_code
        == 200
    )
    assert (
        client.put(
            API + "/file?path=new.txt", json={"content": "replace", "mode": "create"}
        ).status_code
        == 409
    )
    assert (
        client.put(API + "/file?path=new.txt", json={"content": "replace"}).status_code
        == 409
    )
    assert client.get(API + "/workspace?project=other").status_code == 403
    assert (
        client.get(API + "/workspace", headers={"x-user": "unauthorized"}).status_code
        == 401
    )
    assert (
        client.put(
            API + "/file?path=new.txt",
            json={"content": "replace", "user_id": "mallory"},
        ).status_code
        == 403
    )


@pytest.mark.parametrize(
    "path",
    [
        "../outside",
        "/etc/passwd",
        ".env",
        ".env.local",
        ".ssh/id_rsa",
        "auth.json",
        "credentials.json",
        "my-token.txt",
        "api_key.json",
        "a\\b",
        "secrets/a",
        "config.yaml",
    ],
)
def test_sensitive_and_traversal_reads_denied(env, path):
    _, client, _, _, _ = env
    response = client.get(API + "/file", params={"path": path})
    assert response.status_code in (403, 422)


def test_symlink_binary_size_and_asset_rules(env, tmp_path):
    _, client, _, root, _ = env
    outside = tmp_path / "outside"
    outside.mkdir()
    (outside / "note").write_text("outside")
    (root / "linked").symlink_to(outside, target_is_directory=True)
    (root / "leaf").symlink_to(outside / "note")
    for path in ("linked/note", "leaf"):
        assert client.get(API + "/file", params={"path": path}).status_code in (
            403,
            422,
        )
        assert client.put(
            API + "/file",
            params={"path": path},
            json={"mode": "create", "content": "oops"},
        ).status_code in (403, 422)
    assert (outside / "note").read_text() == "outside"
    assert "linked" not in [
        r["name"] for r in client.get(API + "/files").json()["entries"]
    ]
    (root / "big.txt").write_bytes(b"x" * (2 * 1024 * 1024 + 1))
    assert client.get(API + "/file?path=big.txt").status_code == 413
    (root / "binary.txt").write_bytes(b"\x00binary")
    assert client.get(API + "/file?path=binary.txt").status_code == 415
    (root / "attack.svg").write_text('<svg onload="alert(1)"/>')
    assert client.get(API + "/asset?path=attack.svg").status_code == 415
    (root / "picture.png").write_bytes(PNG)
    response = client.get(API + "/asset?path=picture.png")
    assert (
        response.status_code == 200 and response.headers["content-type"] == "image/png"
    )
    assert "sandbox" in response.headers["content-security-policy"]


def test_attachment_upload_scoping_restart_and_runtime_references(env):
    services, client, c, _, storage = env
    url = API + "/attachments?session_id=session1"
    response = client.post(url, files={"file": ("picture.png", PNG, "image/png")})
    assert response.status_code == 200, response.text
    card = response.json()["attachment"]
    assert card["mimeType"] == "image/png" and "path" not in card
    assert client.get(card["src"]).content == PNG
    assert client.get(card["src"], headers={"x-user": "bob"}).status_code == 404
    assert client.get(card["src"], headers={"x-profile": "other"}).status_code == 403
    assert client.get(card["src"], headers={"x-project": "other"}).status_code == 404
    assert (
        client.post(
            API + "/attachments?session_id=unknown", files={"file": ("x", b"x")}
        ).status_code
        == 404
    )
    restarted = StandaloneServices(services.resolver, storage)
    inputs = asyncio.run(
        restarted.attachments.resolve_inputs(c, "session1", [card["id"]])
    )
    assert inputs[0]["type"] == "image"
    assert base64.b64decode(inputs[0]["data"]) == PNG
    assert inputs[0]["media_type"] == "image/png" and "path" not in inputs[0]
    assert client.get(url).json()["attachments"][0]["id"] == card["id"]
    assert (
        client.post(
            url, files={"file": ("url", b"https://example.invalid")}
        ).status_code
        == 200
    )


def test_folder_attachment_path_validation_and_contents(env):
    services, client, c, _, _ = env
    url = API + "/attachments/folder?session_id=session1"
    files = [("files", ("a", b"one")), ("files", ("b", b"two"))]
    bad = client.post(url, data={"paths": json.dumps(["a", "../b"])}, files=files)
    assert bad.status_code == 403
    response = client.post(
        url,
        data={"paths": json.dumps(["folder/a", "folder/b"]), "name": "bundle"},
        files=files,
    )
    assert response.status_code == 200, response.text
    card = response.json()["attachment"]
    assert card["fileCount"] == 2
    inputs = asyncio.run(
        services.attachments.resolve_inputs(c, "session1", [card["id"]])
    )
    assert (Path(inputs[0]["path"]) / "folder/b").read_bytes() == b"two"


def test_memory_mcp_selection_and_restart_profile_scope(env):
    _, client, c, _, storage = env
    memory = client.get(API + "/memory").json()
    response = client.put(
        API + "/memory",
        json={"files": {"MEMORY.md": "remember this"}, "version": memory["version"]},
    )
    assert response.status_code == 200
    assert (
        client.put(
            API + "/memory", json={"files": {"USER.md": "lost"}, "version": 0}
        ).status_code
        == 409
    )
    assert (
        client.put(
            API + "/memory", json={"files": {"../../x": "bad"}, "version": 1}
        ).status_code
        == 422
    )
    assert (
        client.get(API + "/memory", headers={"x-user": "bob"}).json()["files"][
            "MEMORY.md"
        ]
        == ""
    )
    assert (
        client.get(API + "/memory", headers={"x-profile": "other"}).json()["files"][
            "MEMORY.md"
        ]
        == ""
    )
    mcp = {
        "mcpServers": {
            "local": {
                "command": "example-server",
                "args": [],
                "env": {"EXAMPLE": "backend-only"},
            }
        }
    }
    response = client.put(API + "/mcp", json=mcp)
    assert response.status_code == 200 and "backend-only" not in response.text
    assert response.json()["executed"] is False
    assert (
        client.put(
            API + "/runtime-context",
            json={"memory": ["MEMORY.md"], "skills": [], "mcp": ["local"]},
        ).status_code
        == 200
    )
    selected = build_runtime_context(c, storage)
    assert selected["memory"] == {"MEMORY.md": "remember this"}
    assert selected["mcpServers"]["local"]["env"]["EXAMPLE"] == "backend-only"
    assert "backend-only" not in client.get(API + "/mcp").text


@pytest.mark.parametrize(
    "config",
    [
        {"plugins": [{"name": "x"}]},
        {"mcpServers": {"x": {"command": "x", "url": "https://example.test"}}},
        {"mcpServers": {"x": {"url": "file:///etc/passwd"}}},
        {"mcpServers": {"x": {"command": "x", "args": "bad"}}},
        {"mcpServers": {"x": {"command": "x", "plugin": "unknown"}}},
        {"mcpServers": {"x": {"command": "x", "env": {"A": 1}}}},
        {"mcpServers": {"x": {"url": "https://user:password@example.test"}}},
    ],
)
def test_invalid_mcp_is_rejected_without_changes(env, config):
    _, client, _, _, _ = env
    assert client.put(API + "/mcp", json=config).status_code == 422
    assert client.get(API + "/mcp").json()["config"] == {"mcpServers": {}}


def make_skill(client, name="example"):
    response = client.post(
        API + "/skills/files/skill",
        json={"skill": name, "content": "# Example\nDo useful work."},
    )
    assert response.status_code == 200, response.text


def test_skill_editor_move_copy_download_and_archive(env):
    services, client, c, _, _ = env
    make_skill(client)
    url = API + "/skills/files"
    entry = client.get(url + "/file?skill=example&path=SKILL.md").json()
    assert (
        client.put(
            url + "/text",
            json={
                "profile": "default",
                "skill": "example",
                "path": "SKILL.md",
                "content": "# Changed",
                "mode": "replace",
                "version": entry["version"],
            },
        ).status_code
        == 200
    )
    assert (
        client.put(
            url + "/text",
            json={
                "skill": "example",
                "path": "SKILL.md",
                "content": "lost",
                "mode": "replace",
                "version": entry["version"],
            },
        ).status_code
        == 409
    )
    assert (
        client.post(
            url + "/mkdir", json={"skill": "example", "path": "references"}
        ).status_code
        == 200
    )
    assert (
        client.post(
            url + "/upload",
            data={"skill": "example", "path": "references/note.txt"},
            files={"file": ("note.txt", b"content")},
        ).status_code
        == 200
    )
    assert (
        client.post(
            url + "/copy",
            json={
                "skill": "example",
                "source": "references/note.txt",
                "destination": "copy.txt",
            },
        ).status_code
        == 200
    )
    assert (
        client.post(
            url + "/move",
            json={"skill": "example", "source": "copy.txt", "destination": "moved.txt"},
        ).status_code
        == 200
    )
    assert (
        client.get(url + "/download?skill=example&path=moved.txt").content == b"content"
    )
    archive = client.get(url + "/archive?skill=example")
    assert archive.status_code == 200
    assert (
        zipfile.ZipFile(io.BytesIO(archive.content)).read("references/note.txt")
        == b"content"
    )
    assert (
        client.post(
            url + "/archive",
            data={"skill": "imported", "mode": "create"},
            files={"file": ("a.zip", archive.content)},
        ).status_code
        == 200
    )
    assert (
        client.put(
            API + "/runtime-context",
            json={"memory": [], "skills": ["imported"], "mcp": []},
        ).status_code
        == 200
    )
    assert services.build_runtime_context(c)["skills"][0]["content"] == "# Changed"
    assert (
        client.request(
            "DELETE", url + "/node", json={"skill": "example", "path": "moved.txt"}
        ).status_code
        == 200
    )
    assert client.get(url + "/file?skill=example&path=moved.txt").status_code == 404
    assert client.get(url, headers={"x-profile": "other"}).json()["skills"] == []


def test_zip_slip_and_failed_replace_preserve_skill(env):
    _, client, _, _, _ = env
    make_skill(client)
    stream = io.BytesIO()
    with zipfile.ZipFile(stream, "w") as archive:
        archive.writestr("SKILL.md", "replacement")
        archive.writestr("../outside", "attack")
    response = client.post(
        API + "/skills/files/archive",
        data={"skill": "example", "mode": "replace"},
        files={"file": ("a.zip", stream.getvalue())},
    )
    assert response.status_code == 403
    assert (
        client.get(API + "/skills/files/file?skill=example&path=SKILL.md")
        .json()["content"]
        .startswith("# Example")
    )


def test_readonly_archive_import_search_preserves_original_and_selects_context(env):
    services, client, c, root, storage = env
    original = {
        "id": "legacy-id",
        "created_at": "2021-02-03T04:05:06Z",
        "messages": [
            {
                "id": "u1",
                "role": "user",
                "content": "old question",
                "timestamp": "2021-02-03",
            },
            {"id": "a1", "role": "assistant", "content": "archived answer"},
        ],
    }
    path = root / "fixture.json"
    path.write_text(json.dumps(original))
    before = path.read_bytes()
    request = {"path": "fixture.json", "source": "hermes", "title": "Chosen fixture"}
    row = client.post(API + "/archives/import", json=request).json()["session"]
    assert (
        row["source_id"] == "legacy-id"
        and row["runtime"] == "archive"
        and row["resumable"] is False
    )
    assert client.post(API + "/archives/import", json=request).json()["session"] == row
    assert path.read_bytes() == before
    aid = row["id"]
    assert (
        client.get("/api/sessions/search?q=archived").json()["results"][0]["id"] == aid
    )
    assert client.get("/api/profiles/sessions").json()["total"] == 1
    exported = client.get(f"/api/sessions/{aid}/export").json()
    assert exported["original_document"] == original
    assert exported["records"] == original["messages"]
    assert (
        client.get(f"/api/sessions/{aid}/messages?limit=1&order=latest").json()[
            "messages"
        ][0]["content"]
        == "archived answer"
    )
    selected = client.post(
        API + f"/archives/{aid}/context", json={"indexes": [1]}
    ).json()["context"]
    assert selected["messages"] == [
        {"role": "assistant", "content": "archived answer", "source_message_id": "a1"}
    ]
    assert (
        client.post(
            API + f"/archives/{aid}/context", json={"indexes": [-1]}
        ).status_code
        == 422
    )
    assert (
        client.get(f"/api/sessions/{aid}/export", headers={"x-user": "bob"}).status_code
        == 404
    )
    assert (
        client.get(
            f"/api/sessions/{aid}/export", headers={"x-project": "other"}
        ).status_code
        == 404
    )
    restarted = StandaloneServices(services.resolver, storage)
    assert restarted.archives.get(c, aid)["original_document"] == original


def test_codex_jsonl_archive_and_explicit_allowed_roots(env, tmp_path):
    services, client, c, root, _ = env
    record = {
        "type": "response_item",
        "timestamp": "2024-01-01T01:02:03Z",
        "payload": {
            "type": "message",
            "id": "source-id",
            "role": "user",
            "content": [{"type": "input_text", "text": "fixture"}],
        },
    }
    (root / "codex.jsonl").write_text(json.dumps(record) + "\n")
    response = client.post(
        API + "/archives/import", json={"path": "codex.jsonl", "source": "codex"}
    )
    assert response.status_code == 200, response.text
    aid = response.json()["session"]["id"]
    assert services.archives.get(c, aid)["messages"][0]["original_record"] == record
    other = tmp_path / "chosen"
    other.mkdir()
    (other / "fixture.json").write_text(json.dumps([record]))
    assert (
        client.post(
            API + "/archives/import",
            json={"path": str(other / "fixture.json"), "source": "codex"},
        ).status_code
        == 403
    )
    allowed = {**c, "import_roots": [str(other)]}
    assert services.archives.import_path(allowed, str(other / "fixture.json"), "codex")[
        "source_hash"
    ]


def test_unauthorized_websocket_is_denied_before_accept(env):
    _, client, _, _, _ = env
    with pytest.raises(Exception) as exc:
        with client.websocket_connect(
            API + "/shell", headers={"x-user": "unauthorized"}
        ):
            pass
    assert getattr(exc.value, "code", None) == 4401
    with pytest.raises(Exception) as exc:
        with client.websocket_connect(API + "/shell?profile=other"):
            pass
    assert getattr(exc.value, "code", None) == 4403


@pytest.mark.skipif(os.name != "posix", reason="PTY requires POSIX")
def test_actual_pty_workspace_resize_environment_and_cleanup(env):
    services, client, _, root, _ = env
    if sys.platform != "darwin":
        # Exercise generic PTY plumbing with an explicitly injected test host.
        # Production must still refuse platforms without a filesystem sandbox.
        services.runtime = {"shell_command": lambda context, home: ["/bin/sh"]}
    child_pid = None
    with client.websocket_connect(API + "/shell") as ws:
        ws.send_text(json.dumps({"type": "resize", "cols": 101, "rows": 37}))
        ws.send_text("printf '\\nPID=%s\\n' $$; pwd; stty size; printf 'DONE_PTY\\n'\n")
        output = ""
        for _ in range(50):
            output += ws.receive_text()
            if "37 101" in output and str(root) in output:
                break
        assert str(root) in output and "37 101" in output
        import re

        match = re.search(r"PID=(\d+)", output)
        assert match, output
        child_pid = int(match[1])
    for _ in range(30):
        try:
            os.kill(child_pid, 0)
        except ProcessLookupError:
            break
        time.sleep(0.02)
    else:
        pytest.fail("PTY shell survived websocket disconnect")


def test_shell_without_supported_sandbox_fails_before_accept(env, monkeypatch):
    from dashboard.standalone_domains import files

    _, client, _, _, _ = env
    monkeypatch.setattr(sys, "platform", "unsupported-test-platform")
    with pytest.raises(HTTPException) as direct:
        files.sandbox_shell("/workspace", "/private-home", "/private-state")
    assert direct.value.status_code == 503
    with pytest.raises(Exception) as connection:
        with client.websocket_connect(API + "/shell"):
            pass
    assert getattr(connection.value, "code", None) == 4503


def test_internal_storage_is_not_readable_through_workspace_api(tmp_path):
    c = {
        "user_id": "u",
        "profile_id": "p",
        "project_id": "x",
        "workspace": str(tmp_path),
    }
    s = StandaloneServices(lambda _: c, tmp_path / "isolated")
    app = FastAPI()
    app.include_router(s.router(), prefix=API)
    with TestClient(app) as client:
        assert (
            client.get(API + "/file?path=isolated/services.sqlite3").status_code == 403
        )
        assert "isolated" not in [
            r["name"] for r in client.get(API + "/files").json()["entries"]
        ]
        assert (
            client.post(
                API + "/archives/import",
                json={"path": "isolated/services.sqlite3", "source": "codex"},
            ).status_code
            == 403
        )


@pytest.mark.skipif(
    sys.platform != "darwin", reason="macOS seatbelt sandbox acceptance"
)
def test_actual_shell_cannot_read_other_workspace_or_symlink(env, tmp_path):
    _, client, _, root, _ = env
    outside = tmp_path / "other-project.txt"
    outside.write_text("OUTSIDE_SCOPE_SENTINEL")
    (root / "link-out").symlink_to(outside)
    (root / ".env").write_text("SYNTHETIC_ENV_SENTINEL")
    (root / ".ENV").write_text("SYNTHETIC_UPPER_SENTINEL")
    (root / "secrets").mkdir()
    (root / "secrets" / "note.txt").write_text("SYNTHETIC_NESTED_SENTINEL")
    (root / "allowed.txt").write_text("INSIDE_SCOPE_SENTINEL")
    with client.websocket_connect(API + "/shell") as ws:
        ws.send_text(
            f"cat '{outside}'; cat link-out; cat .env; cat .ENV; cat secrets/note.txt; cat allowed.txt; printf '\\nFINISHED_SCOPE_TEST\\n'\n"
        )
        output = ""
        for _ in range(50):
            output += ws.receive_text()
            if "\r\nFINISHED_SCOPE_TEST\r\n" in output:
                break
        assert "INSIDE_SCOPE_SENTINEL" in output
        assert (
            "OUTSIDE_SCOPE_SENTINEL" not in output
            and "SYNTHETIC_ENV_SENTINEL" not in output
        )
        assert (
            "SYNTHETIC_UPPER_SENTINEL" not in output
            and "SYNTHETIC_NESTED_SENTINEL" not in output
        )


def test_directory_skill_copy_and_top_level_config_aliases(env):
    _, client, _, _, _ = env
    make_skill(client)
    assert (
        client.post(
            API + "/skills/files/mkdir", json={"skill": "example", "path": "refs"}
        ).status_code
        == 200
    )
    assert (
        client.put(
            API + "/skills/files/text",
            json={
                "skill": "example",
                "path": "refs/a.md",
                "content": "Reference",
                "mode": "create",
            },
        ).status_code
        == 200
    )
    assert (
        client.post(
            API + "/skills/files/copy",
            json={"skill": "example", "source": "refs", "destination": "refs-copy"},
        ).status_code
        == 200
    )
    assert (
        client.get(API + "/skills/files/file?skill=example&path=refs-copy/a.md").json()[
            "content"
        ]
        == "Reference"
    )
    assert client.get("/api/memory").json() == client.get(API + "/memory").json()
    assert client.get("/api/mcp").json() == client.get(API + "/mcp").json()


def test_invalid_attachment_shapes_fail_cleanly(env):
    services, client, c, _, _ = env
    with pytest.raises(HTTPException) as exc:
        asyncio.run(services.attachments.resolve_inputs(c, "session1", [[]]))
    assert exc.value.status_code == 422
    response = client.post(
        API + "/attachments/folder?session_id=session1",
        data={"paths": "[[]]"},
        files=[("files", ("x", b"x"))],
    )
    assert response.status_code == 422


def test_multipart_wire_limit_applies_to_chunked_requests_before_disk_spooling(env):
    _, client, _, _, _ = env
    boundary = "isolated-upload-boundary"

    def chunks():
        yield f'--{boundary}\r\nContent-Disposition: form-data; name="file"; filename="big.bin"\r\nContent-Type: application/octet-stream\r\n\r\n'.encode()
        for _ in range(22):
            yield b"x" * (1024 * 1024)
        yield f"\r\n--{boundary}--\r\n".encode()

    response = client.post(
        API + "/attachments?session_id=session1",
        content=chunks(),
        headers={"Content-Type": f"multipart/form-data; boundary={boundary}"},
    )
    assert response.status_code == 413
    assert (
        client.get(API + "/attachments?session_id=session1").json()["attachments"] == []
    )


def test_concurrent_editors_do_not_lose_updates(env):
    _, client, _, root, _ = env
    from concurrent.futures import ThreadPoolExecutor

    (root / "shared.txt").write_text("original")
    version = client.get(API + "/file?path=shared.txt").json()["version"]

    def edit(content):
        return client.put(
            API + "/file?path=shared.txt", json={"content": content, "version": version}
        ).status_code

    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(edit, ["first editor", "second editor"]))
    assert sorted(results) == [200, 409]
    assert (root / "shared.txt").read_text() in ("first editor", "second editor")


@pytest.mark.skipif(sys.platform != "darwin", reason="macOS PTY process cleanup")
def test_disconnect_terminates_background_shell_descendants(env):
    _, client, _, _, _ = env
    import re

    with client.websocket_connect(API + "/shell") as ws:
        ws.send_text(
            '/bin/sh -c \'trap "" HUP; printf "CHILD_READY=%s\\n" $$; exec sleep 60\' &\n'
        )
        output = ""
        for _ in range(50):
            output += ws.receive_text()
            match = re.search(r"CHILD_READY=(\d+)", output)
            if match:
                break
        assert match, output
        pid = int(match[1])
        time.sleep(0.05)
        os.kill(pid, 0)
    for _ in range(50):
        try:
            os.kill(pid, 0)
        except ProcessLookupError:
            break
        time.sleep(0.02)
    else:
        pytest.fail("Background PTY child survived disconnect")


def test_inline_image_scope_formats_and_message_limits(env):
    services, client, c, _, _ = env
    url = API + "/attachments?session_id=session1"
    ids = []
    for index in range(5):
        response = client.post(
            url, files={"file": (f"image{index}.png", PNG, "image/png")}
        )
        assert response.status_code == 200
        ids.append(response.json()["attachment"]["id"])
    images = asyncio.run(services.attachments.resolve_inputs(c, "session1", ids[:4]))
    assert len(images) == 4 and all(
        base64.b64decode(image["data"]) == PNG for image in images
    )
    with pytest.raises(HTTPException) as exc:
        asyncio.run(services.attachments.resolve_inputs(c, "session1", ids))
    assert exc.value.status_code == 413
    services.bind_session(
        c,
        {
            "id": "session2",
            "runtime": "dsh",
            "profile_id": c["profile_id"],
            "project_id": c["project_id"],
        },
    )
    with pytest.raises(HTTPException) as exc:
        asyncio.run(services.attachments.resolve_inputs(c, "session2", ids[:1]))
    assert exc.value.status_code == 404
    for name, content, mime in [
        ("x.svg", b"<svg/>", "image/svg+xml"),
        ("x.png", b"not an image", "image/png"),
        ("x.png", b"\x89PNG\r\n\x1a\npretend", "image/png"),
    ]:
        assert (
            client.post(url, files={"file": (name, content, mime)}).status_code == 415
        )
    assert (
        client.post(
            url,
            files={"file": ("large.png", PNG + b"x" * (8 * 1024 * 1024), "image/png")},
        ).status_code
        == 413
    )
    large = (
        PNG[:-12]
        + png_chunk(b"tEXt", b"padding\x00" + b"x" * (6 * 1024 * 1024))
        + PNG[-12:]
    )
    large_ids = [
        client.post(url, files={"file": (f"large{i}.png", large, "image/png")}).json()[
            "attachment"
        ]["id"]
        for i in range(3)
    ]
    with pytest.raises(HTTPException) as exc:
        asyncio.run(services.attachments.resolve_inputs(c, "session1", large_ids))
    assert exc.value.status_code == 413


def test_sse_mcp_is_rejected_to_match_runtime(env):
    _, client, _, _, _ = env
    response = client.put(
        API + "/mcp",
        json={
            "mcpServers": {
                "unsupported": {
                    "transport": "sse",
                    "url": "https://example.invalid/mcp",
                }
            }
        },
    )
    assert response.status_code == 422


@pytest.mark.skipif(
    sys.platform != "darwin", reason="macOS developer terminal acceptance"
)
def test_pty_developer_tools_remain_usable(env):
    _, client, _, root, _ = env
    import subprocess

    subprocess.run(
        ["/usr/bin/git", "init", "-q", str(root)],
        check=True,
        env={"PATH": "/usr/bin:/bin"},
    )
    with client.websocket_connect(API + "/shell") as ws:
        ws.send_text(
            "pwd; echo DEVELOPER_ECHO; git status --porcelain; echo GIT_STATUS=$?; command -v node; node --version; command -v python3; python3 --version; printf '\\nDEVELOPER_CHECK_DONE\\n'\n"
        )
        output = ""
        for _ in range(100):
            output += ws.receive_text()
            if "\r\nDEVELOPER_CHECK_DONE\r\n" in output:
                break
        assert str(root) in output and "\r\nDEVELOPER_ECHO\r\n" in output
        assert "\r\nGIT_STATUS=0\r\n" in output, output
        assert "Python 3." in output, output
        assert re.search(r"\r\nv\d+\.", output), output


def test_unavailable_terminal_sandbox_fails_closed(env, monkeypatch):
    _, client, _, _, _ = env
    import dashboard.standalone_domains.files as files

    def unavailable(*args):
        raise HTTPException(503, "OS sandbox unavailable")

    monkeypatch.setattr(files, "sandbox_shell", unavailable)
    with pytest.raises(Exception) as exc:
        with client.websocket_connect(API + "/shell"):
            pass
    assert getattr(exc.value, "code", None) == 4503
