# Files root recovery evidence

The Files page now recovers a native `/api/files` 403 for the managed root
through `/api/plugins/workbench/managed-files`. The request is accepted only
when the fallback reports the same path as `root`/`locked_root`; `/etc`,
`../outside`, and child paths remain forbidden. The stale red banner is removed
after recovery, and the upload/create controls stay enabled.

## Screenshots

| viewport | theme | file |
| --- | --- | --- |
| 390 x 844 | light | `mobile-390-light-files-root-recovered.png` |
| 390 x 844 | dark | `mobile-390-dark-files-root-recovered.png` |
| 1440 x 900 | light | `desktop-light-files-root-recovered.png` |
| 1440 x 900 | dark | `desktop-dark-files-root-recovered.png` |

## Reproduction

```sh
XDG_CONFIG_HOME="$PWD/.config-empty" pnpm build
CHROMIUM_EXECUTABLE_PATH=/path/to/chrome-headless-shell \
  node tests/browser/files-root-recovery.mjs
pnpm typecheck
pnpm test
pnpm test:python -- tests/test_managed_files_listing.py
```

The screenshots use the repository's deterministic mock host. They verify the
recovery path, skipped external symlink, forbidden paths, banner cleanup, and
enabled upload/create controls; they are not a capture of the production NAS
instance. No daily instance was switched or deployed.
