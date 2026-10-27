"""Prepare the pinned Hermes core through its own package manager, never raw pip."""
from pathlib import Path
import json
import os
import subprocess
import sys

ROOT = Path(__file__).resolve().parent.parent
SOURCE = ROOT / "third_party/hermes-agent"
RUNTIME = ROOT / ".runtimes/hermes"
sys.path.insert(0, str(SOURCE))

if "--worker" not in sys.argv:
    from pm.runtime import runtime_command

    command = runtime_command(Path(__file__), ["--worker"], cache=RUNTIME / "uv-cache")
    sys.exit(subprocess.run(command, stdin=subprocess.DEVNULL).returncode)

import pm

pm.prepare_tools(["uv", "python"], out=RUNTIME / "tools", target="win32-x64")
destination = RUNTIME / "core-venv"
record = RUNTIME / "prepared.json"
identity = {"sourceRevision": "c70332f88886932337619a1e57029bd885c28b9d", "extras": []}
if destination.exists():
    if not record.is_file() or json.loads(record.read_text()) != identity:
        raise RuntimeError("Existing unverified environment preserved")
else:
    pm.build_environment(source=SOURCE, out=destination, env=dict(os.environ),
                         cache=RUNTIME / "uv-cache", explicit=True, frozen=True)
    record.write_text(json.dumps(identity, indent=2) + "\n", encoding="utf-8")
print("Hermes core environment prepared through pinned PM", flush=True)
