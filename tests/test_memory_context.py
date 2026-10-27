import os
import tempfile
import unittest
from pathlib import Path

import sys
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "dashboard"))
from memory_context import build_codex_memory_instructions


class MemoryContextContract(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.old_home = os.environ.get("HERMES_HOME")
        os.environ["HERMES_HOME"] = str(self.root)
        base_topics = self.root / "memories" / "topics"
        base_topics.mkdir(parents=True)
        (base_topics / "frontend.md").write_text(
            "# Frontend delivery\nUse the deployed bundle.\n\nSensitive detail that should be read on demand.\n",
            encoding="utf-8",
        )

    def tearDown(self):
        if self.old_home is None:
            os.environ.pop("HERMES_HOME", None)
        else:
            os.environ["HERMES_HOME"] = self.old_home
        self.temp.cleanup()

    def make_profile(self, name: str, marker: str) -> Path:
        home = self.root / "profiles" / name
        (home / "memories" / "topics").mkdir(parents=True)
        (home / "memories" / "role-skills" / "hermes-health-router").mkdir(parents=True)
        (home / "memories" / "role-skills" / "exam-planning").mkdir(parents=True)
        (home / "profile.yaml").write_text(
            f"description: {marker} role\n", encoding="utf-8"
        )
        (home / "SOUL.md").write_text(f"# SOUL {marker}\nRole boundary: {marker}.\n", encoding="utf-8")
        (home / "memories" / "USER.md").write_text(
            f"# USER {marker}\nIdentity: {marker} user.\n", encoding="utf-8"
        )
        (home / "memories" / "MEMORY.md").write_text(
            f"# MEMORY {marker}\nDurable fact: {marker} memory.\n", encoding="utf-8"
        )
        (home / "memories" / "topics" / "sources.md").write_text(
            f"# Sources {marker}\nPoint to {marker} source.\n\nTOPIC BODY {marker} should stay on demand.\n",
            encoding="utf-8",
        )
        (home / "memories" / "role-skills" / "hermes-health-router" / "SKILL.md").write_text(
            "---\nname: hermes-health-router\ndescription: Route health work.\n---\n# Router\n",
            encoding="utf-8",
        )
        (home / "memories" / "role-skills" / "exam-planning" / "SKILL.md").write_text(
            "---\nname: exam-planning\ndescription: Plan an exam.\n---\n# Exam\n",
            encoding="utf-8",
        )
        (home / "skills" / "pre-coding-router").mkdir(parents=True)
        (home / "skills" / "pre-coding-router" / "SKILL.md").write_text(
            "---\nname: pre-coding-router\ndescription: baseline.\n---\n",
            encoding="utf-8",
        )
        return home

    def test_default_index_lists_topics_without_inlining_topic_content(self):
        instructions = build_codex_memory_instructions()
        self.assertIn(str(self.root / "memories" / "topics" / "frontend.md"), instructions)
        self.assertIn("Do not read every topic at startup", instructions)
        self.assertNotIn("Sensitive detail that should be read on demand", instructions)

    def test_named_profile_inlines_identity_user_and_durable_memory(self):
        home = self.make_profile("health-advisor", "HEALTH")
        instructions = build_codex_memory_instructions("health-advisor")
        self.assertIn("You are running the Hermes profile `health-advisor`", instructions)
        self.assertIn("HEALTH role", instructions)
        self.assertIn("Role boundary: HEALTH", instructions)
        self.assertIn("Identity: HEALTH user", instructions)
        self.assertIn("Durable fact: HEALTH memory", instructions)
        router = str(home / "memories" / "role-skills" / "hermes-health-router" / "SKILL.md")
        leaf = str(home / "memories" / "role-skills" / "exam-planning" / "SKILL.md")
        self.assertIn(router, instructions)
        self.assertLess(instructions.index(router), instructions.index(leaf))
        self.assertIn(leaf, instructions)
        self.assertNotIn("pre-coding-router", instructions)

    def test_named_profile_keeps_topics_on_demand(self):
        home = self.make_profile("health-advisor", "HEALTH")
        instructions = build_codex_memory_instructions("health-advisor")
        self.assertIn(str(home / "memories" / "topics" / "sources.md"), instructions)
        self.assertNotIn("TOPIC BODY HEALTH should stay on demand", instructions)

    def test_profiles_do_not_leak_into_each_other(self):
        self.make_profile("health-advisor", "HEALTH")
        self.make_profile("career-coach", "CAREER")
        health = build_codex_memory_instructions("health-advisor")
        career = build_codex_memory_instructions("career-coach")
        self.assertNotIn("CAREER", health)
        self.assertNotIn("HEALTH", career)

    def test_missing_or_invalid_profile_falls_back_to_base_memory(self):
        missing = build_codex_memory_instructions("missing")
        invalid = build_codex_memory_instructions("../health-advisor")
        self.assertIn("Persistent Hermes memory is available", missing)
        self.assertIn("Profile context unavailable for `missing`", missing)
        self.assertIn("Profile context unavailable for `../health-advisor`", invalid)


if __name__ == "__main__":
    unittest.main()
