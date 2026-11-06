"""Exclusive workspace copies of untrusted attachments, never tool instructions."""

from __future__ import annotations

import os
import stat
from pathlib import Path

from .core import MAX_UPLOAD, digest, fail, scope
from .files import Tree, parts


def directory_identity(tree, path):
    with tree.parent(path) as (parent, name):
        fd = os.open(name, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=parent)
        try:
            info = os.fstat(fd)
            return [info.st_dev, info.st_ino]
        finally:
            os.close(fd)


def owned_directory(store, tree, path):
    """Only adopt a directory created by this storage instance, including restart."""
    key = digest(str(tree.root).encode() + b"\0" + path.encode())
    with store.transaction() as db:
        saved = store.get("registry", "attachment_directories", key, None, db)
        if saved is None:
            # Exclusive: even a pre-existing empty directory conflicts.
            tree.mkdir(path)
            saved = directory_identity(tree, path)
            store.put("registry", "attachment_directories", key, saved, db)
        elif saved != directory_identity(tree, path):
            fail(409, "Attachment staging directory was replaced")


def stage_attachment(store, context, session_id, row, files):
    """Copy already bounded bytes; return a bridge descriptor within trusted cwd.

    The host must resolve context.workspace to this session's actual cwd. All
    operations walk from that root with no-follow descriptors. A failed partial
    preparation is deliberately a conflict on retry, never permission to adopt
    unknown files. Successful preparations survive restarts and verify hashes.
    """
    tree = Tree(context["workspace"], forbidden=(store.root,))
    base = ".workbench-inputs"
    session = (
        base + "/session_" + digest((scope(context) + ":" + session_id).encode())[:40]
    )
    destination = session + "/" + row["id"]
    manifest = {path: digest(data) for path, data in files.items()}
    for path in files:
        parts(destination + "/" + path)
    owned_directory(store, tree, base)
    owned_directory(store, tree, session)
    key = digest((session_id + ":" + row["id"]).encode())
    expected = {
        "destination": destination,
        "workspace": digest(context["workspace"].encode()),
        "files": manifest,
    }
    with store.transaction() as db:
        saved = store.get(scope(context), "attachment_staging", key, None, db)
        if saved is not None:
            if any(saved.get(k) != v for k, v in expected.items()):
                fail(409, "Attachment staging source or workspace changed")
            if saved["directory"] != directory_identity(tree, destination):
                fail(409, "Attachment staging destination was replaced")
        else:
            tree.mkdir(destination)
            directories = set()
            for path, data in files.items():
                components = path.split("/")
                for index in range(1, len(components)):
                    directory = destination + "/" + "/".join(components[:index])
                    if directory not in directories:
                        tree.mkdir(directory)
                        directories.add(directory)
                # Never use replacement/rename: an unexpected destination must fail.
                with tree.parent(destination + "/" + path) as (parent, name):
                    try:
                        fd = os.open(
                            name,
                            os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW,
                            0o600,
                            dir_fd=parent,
                        )
                    except FileExistsError:
                        fail(409, "Attachment staging file already exists")
                    with os.fdopen(fd, "wb") as stream:
                        stream.write(data)
                        stream.flush()
                        os.fsync(stream.fileno())
                    os.fsync(parent)
            saved = {**expected, "directory": directory_identity(tree, destination)}
        for path, expected_hash in manifest.items():
            relative = destination + "/" + path
            with tree.parent(relative) as (parent, name):
                info = os.stat(name, dir_fd=parent, follow_symlinks=False)
                if not stat.S_ISREG(info.st_mode) or info.st_nlink != 1:
                    fail(409, "Attachment staging requires an independent regular copy")
            if digest(tree.read(relative, MAX_UPLOAD)) != expected_hash:
                fail(409, "Attachment staging content changed")
        # Validate the directory tree too: extra files, links and empty directories
        # could otherwise become unintended model input for folder descriptors.
        expected_nodes = set(manifest)
        for path in manifest:
            values = path.split("/")
            expected_nodes.update("/".join(values[:i]) for i in range(1, len(values)))

        def verify(raw, prefix=""):
            with tree.parent(raw) as (parent, name):
                fd = os.open(
                    name, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=parent
                )
                try:
                    names = os.listdir(fd)
                    if len(names) > 1000:
                        fail(409, "Attachment staging has unexpected entries")
                    for child in names:
                        path = prefix + child
                        info = os.stat(child, dir_fd=fd, follow_symlinks=False)
                        if path not in expected_nodes or stat.S_ISLNK(info.st_mode):
                            fail(409, "Attachment staging has unexpected entries")
                        if stat.S_ISDIR(info.st_mode):
                            verify(raw + "/" + child, path + "/")
                finally:
                    os.close(fd)

        verify(destination)
        store.put(scope(context), "attachment_staging", key, saved, db)
    folder = row["kind"] == "folder"
    return {
        "type": "folder" if folder else "file",
        "path": str(
            Path(context["workspace"]) / destination / ("" if folder else "content")
        ),
        "name": row["name"],
        **({"mimeType": row["mimeType"]} if not folder else {}),
    }
