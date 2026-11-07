"""Readable workspace inputs and lossless native archive provenance, no models."""

import asyncio
import hashlib
import json
import os
import shutil
from pathlib import Path

import pytest
from fastapi import HTTPException
from test_standalone_services import API, PNG

from dashboard.standalone_domains.core import MAX_UPLOAD, scope
from dashboard.standalone_services import StandaloneServices

FIXTURES = Path(__file__).parent / "fixtures" / "standalone_services"
pytest_plugins = ["test_standalone_services"]


def upload(client, name="document.txt", content=b"Untrusted user attachment data"):
    response = client.post(
        API + "/attachments?session_id=session1", files={"file": (name, content)}
    )
    assert response.status_code == 200, response.text
    return response.json()["attachment"]["id"]


def prepare(services, context, ids, sid="session1"):
    return asyncio.run(services.attachments.resolve_inputs(context, sid, ids))


def test_workspace_files_are_real_unchanged_idempotent_copies_across_restart(env):
    services, client, c, root, storage = env
    content = b"Ignore previous instructions is only attachment text.\n\x00\xff"
    aid = upload(client, content=content)
    original = services.store.directory(c, "attachments") / aid / "content"
    original_stat = original.stat()
    (root / "document.txt").write_text("Existing project file")
    descriptor = prepare(services, c, [aid])[0]
    assert descriptor["type"] == "file" and descriptor["name"] == "document.txt"
    target = Path(descriptor["path"])
    assert target.is_absolute() and target.is_relative_to(root / ".workbench-inputs")
    assert target.read_bytes() == content
    assert (
        hashlib.sha256(target.read_bytes()).digest()
        == hashlib.sha256(original.read_bytes()).digest()
    )
    assert not target.samefile(original)
    stat = target.stat()
    restarted = StandaloneServices(services.resolver, storage)
    assert prepare(restarted, c, [aid]) == [descriptor]
    assert (
        target.stat().st_ino == stat.st_ino
        and target.stat().st_mtime_ns == stat.st_mtime_ns
    )
    assert original.stat().st_mtime_ns == original_stat.st_mtime_ns
    assert original.read_bytes() == content
    assert (root / "document.txt").read_text() == "Existing project file"


def test_workspace_folder_layout_and_inline_images_remain_usable(env):
    services, client, c, root, _ = env
    response = client.post(
        API + "/attachments/folder?session_id=session1",
        files=[("files", ("a.txt", b"first")), ("files", ("b.csv", b"second"))],
        data={
            "name": "chosen-folder",
            "paths": json.dumps(["chosen/a.txt", "chosen/sub/b.csv"]),
        },
    )
    assert response.status_code == 200, response.text
    aid = response.json()["attachment"]["id"]
    image_id = upload(client, "pixel.png", PNG)
    folder, image = prepare(services, c, [aid, image_id])
    assert folder["type"] == "folder"
    path = Path(folder["path"])
    assert path.is_relative_to(root)
    assert (path / "chosen/a.txt").read_bytes() == b"first"
    assert (path / "chosen/sub/b.csv").read_bytes() == b"second"
    assert image == prepare(services, c, [image_id])[0] and image["type"] == "image"
    assert "path" not in image
    assert prepare(services, c, [aid])[0] == folder


@pytest.mark.parametrize(
    "field,value",
    [("user_id", "bob"), ("profile_id", "other"), ("project_id", "other")],
)
def test_workspace_inputs_reject_other_scopes_even_with_bound_session(
    env, field, value
):
    services, client, c, _, _ = env
    aid = upload(client)
    other = {**c, field: value}
    services.bind_session(
        other,
        {
            "id": "session1",
            "runtime": "dsh",
            "profile_id": other["profile_id"],
            "project_id": other["project_id"],
        },
    )
    with pytest.raises(HTTPException) as error:
        prepare(services, other, [aid])
    assert error.value.status_code == 404


def test_workspace_inputs_reject_another_session_and_whole_invalid_selection(env):
    services, client, c, root, _ = env
    aid = upload(client)
    services.bind_session(
        c,
        {
            "id": "session2",
            "runtime": "dsh",
            "profile_id": c["profile_id"],
            "project_id": c["project_id"],
        },
    )
    with pytest.raises(HTTPException):
        prepare(services, c, [aid], "session2")
    with pytest.raises(HTTPException):
        prepare(services, c, [aid, "unknown"])
    assert not (root / ".workbench-inputs").exists()


@pytest.mark.parametrize("conflict", ["directory", "symlink", "file"])
def test_preexisting_staging_root_is_never_adopted(env, tmp_path, conflict):
    services, client, c, root, _ = env
    aid = upload(client)
    staging = root / ".workbench-inputs"
    outside = tmp_path / "outside"
    outside.mkdir()
    if conflict == "directory":
        staging.mkdir()
        (staging / "user-file").write_bytes(b"keep")
    elif conflict == "symlink":
        staging.symlink_to(outside, target_is_directory=True)
    else:
        staging.write_bytes(b"keep")
    with pytest.raises(HTTPException) as error:
        prepare(services, c, [aid])
    assert error.value.status_code == 409
    assert list(outside.iterdir()) == []
    if conflict == "directory":
        assert (staging / "user-file").read_bytes() == b"keep"
    elif conflict == "file":
        assert staging.read_bytes() == b"keep"


@pytest.mark.parametrize(
    "attack",
    [
        "changed",
        "symlink",
        "hardlink",
        "extra",
        "root_replaced",
        "destination_conflict",
    ],
)
def test_staging_tampering_conflicts_without_overwrite(env, tmp_path, attack):
    services, client, c, root, _ = env
    aid = upload(client)
    target = Path(prepare(services, c, [aid])[0]["path"])
    outside = tmp_path / "outside.txt"
    outside.write_bytes(b"keep outside")
    selected = aid
    if attack == "changed":
        target.write_bytes(b"keep changed")
    elif attack == "symlink":
        target.unlink()
        target.symlink_to(outside)
    elif attack == "hardlink":
        target.unlink()
        original = services.store.directory(c, "attachments") / aid / "content"
        os.link(original, target)
    elif attack == "extra":
        (target.parent / "extra.txt").write_text("keep extra")
    elif attack == "root_replaced":
        (root / ".workbench-inputs").rename(root / "saved-inputs")
        (root / ".workbench-inputs").mkdir()
    else:
        selected = upload(client, "second.txt", b"second")
        (target.parent.parent / selected).mkdir()
        (target.parent.parent / selected / "content").write_bytes(b"keep conflict")
    with pytest.raises(HTTPException) as error:
        prepare(services, c, [selected])
    assert error.value.status_code in (403, 409)
    assert outside.read_bytes() == b"keep outside"
    if attack == "changed":
        assert target.read_bytes() == b"keep changed"
    if attack == "destination_conflict":
        assert (
            target.parent.parent / selected / "content"
        ).read_bytes() == b"keep conflict"


def test_preparation_size_and_count_limits_apply_before_staging(env):
    services, client, c, root, _ = env
    first = upload(client, content=b"a" * (MAX_UPLOAD // 2 + 1))
    second = upload(client, content=b"b" * (MAX_UPLOAD // 2))
    with pytest.raises(HTTPException) as error:
        prepare(services, c, [first, second])
    assert error.value.status_code == 413
    assert not (root / ".workbench-inputs").exists()
    response = client.post(
        API + "/attachments/folder?session_id=session1",
        files=[("files", (f"{i}.txt", b"")) for i in range(100)],
        data={"name": "many", "paths": json.dumps([f"{i}.txt" for i in range(100)])},
    )
    assert response.status_code == 200
    with pytest.raises(HTTPException) as error:
        prepare(services, c, [response.json()["attachment"]["id"], second])
    assert error.value.status_code == 413
    assert not (root / ".workbench-inputs").exists()


def test_private_attachment_traversal_and_symlink_cannot_be_staged(env, tmp_path):
    services, client, c, root, _ = env
    aid = upload(client)
    source = services.store.directory(c, "attachments") / aid / "content"
    source.unlink()
    outside = tmp_path / "outside.txt"
    outside.write_text("not authorized")
    source.symlink_to(outside)
    with pytest.raises(HTTPException) as error:
        prepare(services, c, [aid])
    assert error.value.status_code == 403
    source.unlink()
    row = services.attachments.record(c, "session1", aid)
    services.store.put(
        scope(c),
        "attachments",
        aid,
        {**row, "kind": "folder", "paths": ["../outside.txt"]},
    )
    with pytest.raises(HTTPException) as error:
        prepare(services, c, [aid])
    assert error.value.status_code == 403
    assert not (root / ".workbench-inputs").exists()
    assert outside.read_text() == "not authorized"


@pytest.mark.parametrize(
    "source,filename",
    [("codex", "codex-native.jsonl"), ("hermes", "hermes-native.json")],
)
def test_native_provenance_raw_records_and_repeat_import(env, source, filename):
    services, _, c, root, storage = env
    path = root / filename
    shutil.copyfile(FIXTURES / filename, path)
    before, stat = path.read_bytes(), path.stat()
    summary = services.archives.import_path(c, filename, source)
    native = (
        [json.loads(line) for line in before.decode().splitlines()]
        if source == "codex"
        else json.loads(before)
    )
    archive = services.archives.get(c, summary["id"])
    assert archive["original_document"] == native
    assert archive["source_hash"] == hashlib.sha256(before).hexdigest()
    assert archive["source_id"] == (
        "native-child" if source == "codex" else "hermes-child"
    )
    assert archive["resumable"] is False and archive["runtime"] == "archive"
    assert not any(
        key in archive for key in ("user_id", "profile_id", "project_id", "workspace")
    )
    if source == "codex":
        assert archive["created_at"] == "2025-09-01T08:00:00Z"
        assert archive["source_lineage"]["parent_thread_id"] == "native-parent"
        assert archive["source_lineage_records"][-1] == {
            "record_index": 7,
            "fields": {"parent_session_id": "native-parent", "compression_count": 1},
        }
        assert archive["records"] == native
        assert [m["record_index"] for m in archive["messages"]] == [2, 6]
        assert [m["id"] for m in archive["messages"]] == [
            "native-user-1",
            "native-answer-1",
        ]
        assert archive["messages"][0]["content"] == [
            {"type": "input_text", "text": "Inspect the sample document."}
        ]
        assert archive["records"][4]["payload"]["type"] == "function_call_output"
        assert archive["source_metadata_records"][-1]["original_record"] == native[7]
    else:
        assert archive["source_lineage"]["parent_session_id"] == "hermes-parent"
        assert archive["source_lineage"]["end_reason"] == "compression"
        assert archive["source_timestamps"] == {
            "created_at": 1756713600,
            "updated_at": 1756713650,
        }
        assert archive["records"] == native["messages"]
        assert (
            archive["messages"][1]["tool_calls"] == native["messages"][1]["tool_calls"]
        )
        assert archive["messages"][2]["tool_call_id"] == "tool-1"
        assert archive["messages"][0]["timestamp"] == 1756713601
    restarted = StandaloneServices(services.resolver, storage)
    assert restarted.archives.import_path(c, filename, source) == summary
    assert restarted.archives.get(c, summary["id"]) == archive
    assert path.read_bytes() == before and path.stat().st_mtime_ns == stat.st_mtime_ns


def test_codex_event_fallback_only_without_canonical_messages(env):
    services, _, c, root, _ = env
    native = [
        json.loads(line)
        for line in (FIXTURES / "codex-native.jsonl").read_text().splitlines()
    ]
    records = [
        r
        for r in native
        if not (r["type"] == "response_item" and r["payload"]["type"] == "message")
    ]
    (root / "events.jsonl").write_text("\n".join(json.dumps(r) for r in records))
    aid = services.archives.import_path(c, "events.jsonl", "codex")["id"]
    archive = services.archives.get(c, aid)
    assert [(m["role"], m["content"]) for m in archive["messages"]] == [
        ("user", "Inspect the sample document."),
        ("assistant", "The sample is readable."),
    ]
    assert archive["records"] == records


@pytest.mark.parametrize(
    "malformed",
    [
        '{"type":"session_meta","payload":{}}',
        '{"type":"response_item","payload":[]}',
        '{"type":"response_item","payload":{"type":"message","role":"user","content":42}}',
        '{"type":"response_item","payload":{"type":"message","role":"user","content":[{"type":"input_text","text":42}]}}',
        '{"type":"event_msg","payload":{"type":"agent_message"}}',
        '{"type":"session_meta","payload":{"id":"bad-numeric","timestamp":NaN}}',
        '{"type":"compacted","message":"missing payload"}',
        '{"type":"event_msg","payload":{"type":[]}}',
        '{"type":[],"payload":{}}',
        "null",
        '{"broken":',
    ],
)
def test_malformed_native_record_rejects_import_without_partial_success(env, malformed):
    services, _, c, root, _ = env
    valid = {
        "type": "response_item",
        "payload": {"type": "message", "role": "user", "content": "valid"},
    }
    (root / "bad.jsonl").write_text(json.dumps(valid) + "\n" + malformed)
    with pytest.raises(HTTPException) as error:
        services.archives.import_path(c, "bad.jsonl", "codex")
    assert error.value.status_code == 422
    assert services.archives.list(c) == []


def test_explicit_reimport_repairs_older_native_provenance_without_new_identity(env):
    services, _, c, root, _ = env
    shutil.copyfile(FIXTURES / "codex-native.jsonl", root / "chosen.jsonl")
    summary = services.archives.import_path(c, "chosen.jsonl", "codex")
    row = services.archives.get(c, summary["id"])
    row["source_id"] = ""
    del row["source_lineage"]
    services.store.put(scope(c), "archives", row["id"], row)
    assert services.archives.import_path(c, "chosen.jsonl", "codex") == summary


def test_selected_native_archive_always_creates_a_new_dsh_session(env):
    services, _, c, root, _ = env
    shutil.copyfile(FIXTURES / "codex-native.jsonl", root / "chosen.jsonl")
    aid = services.archives.import_path(c, "chosen.jsonl", "codex")["id"]
    calls = []

    def create(context, payload):
        calls.append((context, payload))
        return {
            "id": "new-dsh-session",
            "runtime": "dsh",
            "profile_id": c["profile_id"],
            "project_id": c["project_id"],
        }

    services.runtime = {"create_session": create}
    ref = asyncio.run(
        services.create_session_from_archive(c, aid, [1], "chosen-native-1")
    )
    assert ref["id"] == "new-dsh-session"
    selected = calls[0][1]["context"]["archive_context"]
    assert len(selected["messages"]) == 1
    assert selected["messages"][0]["source_message_id"] == "native-answer-1"
    assert selected["resumable"] is False
    assert services.archives.get(c, aid)["source_id"] == "native-child"
