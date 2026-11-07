"""Native archive projection; provenance never grants native session ownership."""

from __future__ import annotations

from .core import fail

ROLES = ("user", "assistant", "system", "tool", "developer")
LINEAGE = (
    "parent_session_id",
    "parent_thread_id",
    "parent_id",
    "forked_from_id",
    "forked_from",
    "resume_from",
    "root_session_id",
    "compression",
    "compression_count",
    "compressed_from",
    "compressed_from_session_id",
    "end_reason",
    "lineage",
)
TIMESTAMPS = ("timestamp", "created_at", "started_at", "updated_at", "ended_at")


def project_transcript(original, source):
    if isinstance(original, dict):
        records = original.get(
            "messages",
            [original] if original.get("type") or original.get("role") else None,
        )
        metadata = original.get("session", original)
        if not isinstance(metadata, dict):
            fail(422, "Transcript session metadata must be an object")
    else:
        records, metadata = original, {}
    if (
        not isinstance(records, list)
        or not records
        or len(records) > 50000
        or any(not isinstance(r, dict) or not r for r in records)
    ):
        fail(422, "Transcript requires nonempty message records")

    metadata_records = []
    canonical, fallback, ordinary = [], [], []

    def message(record, index, payload, role=None, content_key=None):
        role = role or payload.get("role")
        if role not in ROLES:
            fail(422, "Transcript message has an unsupported role")
        key = content_key or ("content" if "content" in payload else "text")
        content = payload.get(key)
        # Hermes tool calls can legitimately have null content; retain their
        # tool_calls alongside an empty display rather than inventing text.
        if content is None and (payload.get("tool_calls") or role == "tool"):
            content = ""
        if not isinstance(content, (str, list)) or (
            isinstance(content, list)
            and any(
                not isinstance(v, dict)
                or not isinstance(v.get("type"), str)
                or (
                    v.get("type") in ("input_text", "output_text", "text")
                    and not isinstance(v.get("text"), str)
                )
                for v in content
            )
        ):
            fail(422, "Transcript message content must be text or content blocks")
        return {
            **payload,
            "id": str(payload.get("id") or f"record-{index}"),
            "role": role,
            "content": content,
            "timestamp": record.get(
                "timestamp", payload.get("timestamp", payload.get("created_at"))
            ),
            "record_index": index,
            "original_record": record,
        }

    for index, record in enumerate(records):
        kind = record.get("type")
        payload = record.get("payload", record)
        if "type" in record and not isinstance(kind, str):
            fail(422, "Transcript record type must be text")
        if "payload" in record and not isinstance(payload, dict):
            fail(422, "Transcript record payload must be an object")
        if "type" in payload and not isinstance(payload["type"], str):
            fail(422, "Transcript payload type must be text")
        if (
            source == "codex"
            and kind
            in (
                "session_meta",
                "compacted",
                "compression",
                "session_update",
                "response_item",
                "event_msg",
            )
            and "payload" not in record
        ):
            fail(422, "Codex native records require a payload object")
        if source == "codex" and kind == "session_meta":
            if not isinstance(payload.get("id"), str) or not payload["id"]:
                fail(422, "Codex session metadata requires an original id")
            if metadata.get("id") and metadata["id"] != payload["id"]:
                fail(422, "Transcript contains conflicting native session ids")
            metadata = payload
            metadata_records.append({"record_index": index, "original_record": record})
        elif source == "codex" and kind in (
            "compacted",
            "compression",
            "session_update",
        ):
            metadata_records.append({"record_index": index, "original_record": record})
        elif source == "codex" and kind == "response_item":
            if not isinstance(payload.get("type"), str):
                fail(422, "Codex response item requires a type")
            if payload.get("type") == "message":
                canonical.append(message(record, index, payload))
            # function_call, function_call_output, reasoning, etc. remain raw.
        elif source == "codex" and kind == "event_msg":
            role = {"user_message": "user", "agent_message": "assistant"}.get(
                payload.get("type")
            )
            if role:
                fallback.append(message(record, index, payload, role, "message"))
        elif payload.get("role") is not None:
            ordinary.append(message(record, index, payload))

    messages = (canonical or fallback or ordinary) if source == "codex" else ordinary
    if not messages:
        fail(422, "No supported transcript messages found")
    timestamps = {k: metadata[k] for k in TIMESTAMPS if k in metadata}
    lineage = {k: metadata[k] for k in LINEAGE if k in metadata}
    # Preserve envelope fields too, e.g. Hermes exports wrapping session data.
    if isinstance(original, dict):
        lineage = {**{k: original[k] for k in LINEAGE if k in original}, **lineage}
        timestamps = {
            **{k: original[k] for k in TIMESTAMPS if k in original},
            **timestamps,
        }
    source_id = metadata.get("id", metadata.get("session_id", ""))
    if not isinstance(source_id, (str, int)) or isinstance(source_id, bool):
        fail(422, "Native source id must be a string or integer")
    return (
        records,
        messages,
        {
            "source_id": str(source_id),
            "source_metadata": {k: v for k, v in metadata.items() if k != "messages"},
            "source_metadata_records": metadata_records,
            "source_lineage": lineage,
            "source_lineage_records": [
                {
                    "record_index": item["record_index"],
                    "fields": {
                        k: v
                        for k, v in item["original_record"]["payload"].items()
                        if k in LINEAGE
                    },
                }
                for item in metadata_records
                if any(k in item["original_record"]["payload"] for k in LINEAGE)
            ],
            "source_timestamps": timestamps,
            "created_at": timestamps.get(
                "created_at",
                timestamps.get(
                    "started_at",
                    timestamps.get("timestamp", records[0].get("timestamp")),
                ),
            ),
        },
    )
