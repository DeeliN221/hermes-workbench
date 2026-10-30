"""The codex-runtime status route must answer from cache, never from GitHub."""

import json
import sys
import tempfile
import time
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "dashboard"))
import codex_update_manager as cum  # noqa: E402


class StatusContract(unittest.TestCase):
    """Health probes read cached metadata; only the updater touches the network."""

    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.state_file = Path(self.temp.name) / "version.json"
        patchers = [
            patch.object(cum, "STATE_FILE", self.state_file),
            patch.object(cum.CodexUpdateManager, "is_busy", return_value=False),
        ]
        for patcher in patchers:
            patcher.start()
            self.addCleanup(patcher.stop)
        self.addCleanup(self.temp.cleanup)
        self.manager = cum.CodexUpdateManager()

    def write_state(self, **payload):
        """Seed version.json exactly as a previous release check would."""

        self.state_file.write_text(json.dumps(payload), encoding="utf-8")

    def probe(self, package="1.0.0", running="1.0.0"):
        """Call status() with local version probes stubbed and GitHub forbidden."""

        with patch.object(
            cum.CodexUpdateManager, "_latest_release", side_effect=AssertionError("status must not call GitHub")
        ), patch.object(cum, "_installed_version", return_value=package), patch.object(
            cum, "_running_codex", return_value=(str(cum.CODEX_BINARY), running)
        ):
            started = time.monotonic()
            payload = self.manager.status()
        return payload, time.monotonic() - started

    def test_probe_answers_from_cache_when_release_check_is_stale(self):
        self.write_state(last_checked_at="2026-01-01T00:00:00Z", latest_version="1.2.0")
        payload, elapsed = self.probe()
        self.assertLess(elapsed, 1.0)
        self.assertEqual(payload["latest_version"], "1.2.0")
        self.assertTrue(payload["version_check_stale"])
        self.assertTrue(payload["update_available"])
        self.assertFalse(payload["runtime_mismatch"])

    def test_probe_without_cached_release_reports_pending_check(self):
        payload, _ = self.probe()
        self.assertIsNone(payload["latest_version"])
        self.assertFalse(payload["update_available"])
        self.assertTrue(payload["version_check_stale"])

    def test_versions_are_cached_between_probes(self):
        calls = []

        def installed(binary=cum.CODEX_BINARY):
            calls.append(binary)
            return "1.0.0"

        with patch.object(
            cum.CodexUpdateManager, "_latest_release", side_effect=AssertionError("status must not call GitHub")
        ), patch.object(cum, "_installed_version", side_effect=installed), patch.object(
            cum, "_running_codex", return_value=(str(cum.CODEX_BINARY), "1.0.0")
        ):
            self.manager.status()
            self.manager.status()
        self.assertEqual(len(calls), 1)

    def test_stalled_version_probe_degrades_instead_of_hanging(self):
        def stall(binary=cum.CODEX_BINARY):
            time.sleep(0.5)
            return "1.0.0"

        with patch.object(cum, "LOCAL_DEADLINE", 0.05), patch.object(
            cum, "_installed_version", side_effect=stall
        ), patch.object(cum, "_running_codex", return_value=(str(cum.CODEX_BINARY), "1.0.0")):
            started = time.monotonic()
            payload = self.manager.status()
            elapsed = time.monotonic() - started
        self.assertLess(elapsed, 0.4)
        self.assertEqual(payload["package_version"], "unknown")
        self.assertFalse(payload["update_available"])

    def test_refresh_writes_release_metadata_to_state(self):
        release = {"version": "1.3.0", "url": "", "digest": ""}
        with patch.object(cum.CodexUpdateManager, "_latest_release", return_value=release):
            payload = self.manager.status(refresh=True)
        state = json.loads(self.state_file.read_text(encoding="utf-8"))
        self.assertEqual(state["latest_version"], "1.3.0")
        self.assertIsNotNone(state["last_checked_at"])
        self.assertEqual(payload["latest_version"], "1.3.0")
        self.assertFalse(payload["version_check_stale"])

    def test_refresh_release_stops_waiting_at_its_deadline(self):
        with patch.object(cum.CodexUpdateManager, "_latest_release", side_effect=lambda: time.sleep(0.5)):
            started = time.monotonic()
            with self.assertRaises(TimeoutError):
                self.manager.refresh_release(deadline=0.05)
            self.assertLess(time.monotonic() - started, 0.4)

    def test_release_check_has_a_hard_deadline(self):
        def slow():
            time.sleep(0.5)
            return {"version": "1.3.0"}

        started = time.monotonic()
        with self.assertRaises(TimeoutError):
            cum._run_with_deadline(slow, 0.05, "release-check")
        self.assertLess(time.monotonic() - started, 0.4)


if __name__ == "__main__":
    unittest.main()

