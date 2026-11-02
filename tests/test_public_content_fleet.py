"""The mandated server default must not weaken the browser privacy boundary."""
import importlib.util
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("public_content", ROOT / "scripts/check-public-content.py")
check = importlib.util.module_from_spec(spec)
spec.loader.exec_module(check)


def test_only_exact_server_default_is_allowed():
    default = next(line for line in (ROOT / "dashboard/fleetd_client.py").read_text().splitlines() if line.startswith("DEFAULT_URL ="))
    assert list(check.findings(default, allowed_fleet_default=True)) == []
    assert list(check.findings(default))  # Browser bundles never get the exception.
    assert list(check.findings(" " + default, allowed_fleet_default=True))
    assert list(check.findings(default.replace("18787", "18788"), allowed_fleet_default=True))
