"""Development policy discovery must preserve source and target restrictions."""
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location('development_policy', ROOT / 'scripts/development_policy.py')
POLICY = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(POLICY)


class DevelopmentPolicyTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.config = Path(self.directory.name)
        self.environment = dict(os.environ, XDG_CONFIG_HOME=str(self.config))
        self.environment.pop('HERMES_WORKBENCH_DEV_POLICY', None)

    def write_policy(self, source=ROOT):
        path = self.config / 'hermes-workbench/development.json'
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps({'source': str(source), 'target': str(self.config / 'plugin')}))
        return path

    def run_script(self, script, *arguments):
        return subprocess.run([sys.executable, str(ROOT / 'scripts' / script), *arguments],
                              env=self.environment, capture_output=True, text=True)

    def test_optional_policy_and_required_deploy(self):
        with patch.dict(os.environ, self.environment, clear=True):
            self.assertIsNone(POLICY.load_policy())
            with self.assertRaises(SystemExit):
                POLICY.load_policy(required=True)
        self.assertEqual(self.run_script('check-dev-source.py').returncode, 0)
        self.assertIn('policy is missing', self.run_script('deploy-dev.py').stderr)

    def test_explicit_missing_policy_fails_closed(self):
        self.environment['HERMES_WORKBENCH_DEV_POLICY'] = str(self.config / 'missing.json')
        self.assertNotEqual(self.run_script('check-dev-source.py').returncode, 0)

    def test_source_and_publish_target_restrictions(self):
        self.write_policy()
        self.assertEqual(self.run_script('check-dev-source.py').returncode, 0)
        result = self.run_script('publish-dev.py', str(ROOT / 'dashboard'),
                                 '--target', str(self.config / 'other-plugin'))
        self.assertIn('Publish rejected', result.stderr)
        self.assertFalse((self.config / 'other-plugin').exists())
        self.write_policy(self.config / 'authoritative-checkout')
        self.assertIn('Build rejected', self.run_script('check-dev-source.py').stderr)
        self.assertIn('Deploy rejected', self.run_script('deploy-dev.py').stderr)

    def test_invalid_policy_fails_closed(self):
        path = self.write_policy()
        for content in ('{}', '[]', '{"source":"relative", "target":"/plugin"}', 'invalid'):
            path.write_text(content)
            self.assertIn('Invalid development policy', self.run_script('check-dev-source.py').stderr)

    def test_explicit_policy_overrides_default(self):
        self.write_policy(self.config / 'other-checkout')
        explicit = self.config / 'explicit.json'
        explicit.write_text(json.dumps({'source': str(ROOT), 'target': str(self.config / 'plugin')}))
        self.environment['HERMES_WORKBENCH_DEV_POLICY'] = str(explicit)
        self.assertEqual(self.run_script('check-dev-source.py').returncode, 0)

    def test_broken_policy_symlink_fails_closed(self):
        path = self.config / 'hermes-workbench/development.json'
        path.parent.mkdir(parents=True)
        path.symlink_to(self.config / 'missing.json')
        self.assertNotEqual(self.run_script('check-dev-source.py').returncode, 0)

    def test_manual_mode_blocks_both_publish_entries_before_writes(self):
        path = self.write_policy()
        policy = json.loads(path.read_text())
        policy['mode'] = 'manual-release'
        path.write_text(json.dumps(policy))
        for script, args in [('deploy-dev.py', ()), ('publish-dev.py', (str(ROOT / 'dashboard'),))]:
            result = self.run_script(script, *args)
            self.assertNotEqual(result.returncode, 0)
            self.assertIn('manual-release mode', result.stderr)
        self.assertFalse((self.config / 'plugin').exists())
        self.assertIn('linked feature worktree', self.run_script('check-dev-source.py').stderr)

    def test_unknown_mode_fails_closed(self):
        path = self.write_policy()
        policy = json.loads(path.read_text())
        policy['mode'] = 'manual-releas'
        path.write_text(json.dumps(policy))
        self.assertIn('Invalid development policy', self.run_script('deploy-dev.py').stderr)

    def test_linked_worktree_is_allowed_but_independent_clone_is_not(self):
        repo = self.config / 'repo'
        subprocess.run(['git', 'init', '-q', str(repo)], check=True)
        subprocess.run(['git', '-C', str(repo), '-c', 'user.name=Test', '-c', 'user.email=test@example.com',
                        'commit', '--allow-empty', '-qm', 'initial'], check=True)
        linked = self.config / 'linked'
        subprocess.run(['git', '-C', str(repo), 'worktree', 'add', '-q', '--detach', str(linked)], check=True)
        clone = self.config / 'clone'
        subprocess.run(['git', 'clone', '-q', str(repo), str(clone)], check=True)
        policy = {'source': str(repo), 'mode': 'manual-release'}
        self.assertFalse(POLICY.allowed_build_source(repo, policy))
        self.assertTrue(POLICY.allowed_build_source(linked, policy))
        self.assertFalse(POLICY.allowed_build_source(clone, policy))
        policy['mode'] = 'development'
        self.assertFalse(POLICY.allowed_build_source(linked, policy))


if __name__ == '__main__':
    unittest.main()
