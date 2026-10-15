"""Load an optional, installation-local authoritative development policy."""
import json
import os
import subprocess
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
        if policy.get("mode", "development") not in ("development", "manual-release"):
            raise ValueError("mode must be development or manual-release")
    except (OSError, ValueError, TypeError, AttributeError) as error:
        raise SystemExit("Invalid development policy: " + str(error)) from error
    return policy


def require_development_publish(policy):
    """Release-managed installations must never be overwritten by local builds."""
    if policy and policy.get("mode") == "manual-release":
        raise SystemExit("Publish rejected: manual-release mode; build and test in a worktree, "
                         "then let the user select a published release. Running files were not changed.")


def allowed_build_source(root, policy):
    canonical = Path(policy["source"]).resolve()
    root = Path(root).resolve()
    if root == canonical:
        return policy.get("mode") != "manual-release"
    if policy.get("mode") != "manual-release":
        return False
    # Linked worktrees share one repository; unrelated clones and recovery copies do not.
    def git_common(path):
        return subprocess.check_output(
            ["git", "-C", str(path), "rev-parse", "--path-format=absolute", "--git-common-dir"],
            text=True, stderr=subprocess.DEVNULL).strip()
    try:
        if git_common(root) != git_common(canonical):
            return False
        listed = subprocess.check_output(["git", "-C", str(canonical), "worktree", "list", "--porcelain"],
                                         text=True, stderr=subprocess.DEVNULL)
        return str(root) in [line[9:] for line in listed.splitlines() if line.startswith("worktree ")]
    except (OSError, subprocess.CalledProcessError):
        return False
