"""Read-only staging preflight tests; no dependency installation or source edits."""
from pathlib import Path
import importlib.util
import tempfile
import unittest

ROOT = Path(__file__).resolve().parent.parent
spec = importlib.util.spec_from_file_location("stage_agent_core", ROOT / "scripts/stage-agent-core.py")
builder = importlib.util.module_from_spec(spec)
spec.loader.exec_module(builder)


class StagePreflight(unittest.TestCase):
    def setUp(self):
        base = ROOT / ".runtimes/runtime-packs"
        base.mkdir(parents=True, exist_ok=True)
        self.temporary = tempfile.TemporaryDirectory(prefix="najd-preflight-", dir=base)
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name).resolve()

    def test_fresh_owned_destination(self):
        destination = self.root / "fresh"
        self.assertEqual(builder.validate_output(str(destination)), destination)
        self.assertFalse(destination.exists())

    def test_existing_work_is_preserved(self):
        marker = self.root / "work.txt"
        marker.write_text("preserve", encoding="utf-8")
        with self.assertRaises(FileExistsError):
            builder.validate_output(str(self.root))
        self.assertEqual(marker.read_text(encoding="utf-8"), "preserve")

    def test_outside_and_store_root_are_rejected(self):
        for destination in (ROOT / "outside-stage", ROOT / ".runtimes/runtime-packs"):
            with self.subTest(destination=destination), self.assertRaises(ValueError):
                builder.validate_output(str(destination))

    def test_alias_path_is_rejected(self):
        with self.assertRaises(ValueError):
            builder.validate_output(str(self.root / "nested/../fresh"))


if __name__ == "__main__":
    unittest.main()
