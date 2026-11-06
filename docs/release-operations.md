# Preparing a managed release

Download the published archive and its checksum from the same GitHub Release.
Pin the expected version and source commit. Each instance has its own
`HERMES_WORKBENCH_RUNTIME_UID` and `HERMES_WORKBENCH_RUNTIME_GID`; never reuse
another instance's numeric identity.

The preparation tool drops root before importing runtime code or opening shared
state. It refuses update state owned by another identity, verifies the published
archive, and stages the immutable package. It never changes the active version,
writes an update job, or restarts services. Existing build and browser validation
can be reused when the published archive is unchanged.

Run the tool in the target container with its configured runtime environment:

```sh
docker exec -i "$CONTAINER" python3 -c "$(cat scripts/prepare-managed-release.py)" \
  --version "$VERSION" --sha256 "$SHA256" --source-commit "$SOURCE_COMMIT" \
  < "$ARCHIVE"
```

For an already prepared package the tool revalidates the cached files and
ownership checks without rewriting update state. A permission failure requires
an administrator to repair the specific state file, preserving its private
permissions; do not make it world-readable.

Activate through the existing Workbench version updater only after other active
sessions have finished. Keep its busy-task and write-admission checks. Never
write `update.json` or queue a supervisor job from an operator script, and never
switch or restart the runtime hosting an active recovery conversation. If no
safe window is available, report the prepared version and leave activation
pending; do not install a delayed activation process.
