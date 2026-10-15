"""Load an optional, installation-local authoritative development policy."""
import json
import os
from pathlib import Path


def load_policy(required=False):
    explicit = os.environ.get("HERMES_WORKBENCH_DEV_POLICY")
    config_home = Path(os.environ.get("XDG_CONFIG_HOME") or Path.home() / ".config")
    path = Path(explicit).expanduser() if explicit else config_home / "hermes-workbench/development.json"
    if not path.is_file():
        if required or explicit or path.is_symlink():
            raise SystemExit("Development policy is missing; configure HERMES_WORKBENCH_DEV_POLICY")
        return None
    try:
        policy = json.loads(path.read_text())
        for key in ("source", "target"):
            if not isinstance(policy.get(key), str) or not Path(policy[key]).is_absolute():
                raise ValueError("source and target must be absolute paths")
    except (OSError, ValueError, TypeError, AttributeError) as error:
        raise SystemExit("Invalid development policy: " + str(error)) from error
    return policy
