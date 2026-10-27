"""Publisher smoke: relocate the sealed core, then import it without host packages."""
from pathlib import Path
import argparse
import json
import os
import shutil
import stat
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parent.parent
PIN = "c70332f88886932337619a1e57029bd885c28b9d"
CHILD = r'''
from pathlib import Path
import sys, json, site, socket, subprocess
root = Path(sys.argv[1]).resolve()
receipt = json.loads((root / "najd-core.json").read_text(encoding="utf-8"))
assert receipt["format"] == "najd-agent-core-v1"
assert receipt["sourceRevision"] == sys.argv[2]
assert sys.version_info[:3] == (3, 14, 7)
assert Path(sys.executable).resolve().is_relative_to(root)
assert not (root / "hermes-agent/.env").exists()
def blocked(*args, **kwargs):
    raise RuntimeError("Health imports must not access network or spawn programs")
socket.socket.connect = blocked
socket.create_connection = blocked
class BlockedProcess(subprocess.Popen):
    def __init__(self, *args, **kwargs):
        blocked()
subprocess.Popen = BlockedProcess
site.addsitedir(str(root / receipt["sitePackages"]))
sys.path.insert(0, str(root / "hermes-agent"))
# A health probe never loads dotenv, account integrations or external secrets.
import hermes_cli.env_loader
hermes_cli.env_loader.load_hermes_dotenv = lambda *args, **kwargs: []
import run_agent, openai, pydantic
assert callable(run_agent.AIAgent)
for module in (run_agent, openai, pydantic):
    assert Path(module.__file__).resolve().is_relative_to(root), module.__name__
for value in sys.path:
    assert value and Path(value).resolve().is_relative_to(root), value
assert not any(key.endswith(("_API_KEY", "_TOKEN", "_SECRET")) for key in __import__("os").environ)
print(json.dumps({"python": "3.14.7", "modules": ["run_agent.AIAgent", "openai", "pydantic"], "isolated": True}))
'''


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--payload", required=True)
    args = parser.parse_args()
    payload = Path(args.payload).resolve()
    base = (ROOT / ".runtimes/runtime-packs").resolve()
    if not payload.is_relative_to(base) or payload == base:
        raise ValueError("Only a generated NAJD runtime payload may be copied")
    receipt = json.loads((payload / "najd-core.json").read_text(encoding="utf-8"))
    if receipt.get("sourceRevision") != PIN:
        raise ValueError("Unexpected source revision")
    # Refuse links so copy/cleanup cannot escape either owned tree.
    for current, directories, files in os.walk(payload, followlinks=False):
        for name in directories + files:
            item = Path(current) / name
            if item.is_symlink() or item.is_junction():
                raise ValueError("Payload links require an explicit packaging decision")
    temporary = Path(tempfile.mkdtemp(prefix="najd-core-portable-")).resolve()
    try:
        relocated = temporary / "payload"
        print("Copying generated payload to an unrelated temporary location", flush=True)
        shutil.copytree(payload, relocated)
        home = temporary / "state"
        home.mkdir()
        env = {key: os.environ[key] for key in ("SystemRoot", "WINDIR", "SystemDrive", "ComSpec", "PATHEXT") if key in os.environ}
        env.update({"PATH": str(Path(env["SystemRoot"]) / "System32"),
                    "HOME": str(home), "USERPROFILE": str(home), "APPDATA": str(home / "Roaming"),
                    "LOCALAPPDATA": str(home / "Local"), "TEMP": str(home), "TMP": str(home),
                    "HERMES_HOME": str(home / "profile"), "HERMES_RUNTIME_DIR": str(relocated / "tools")})
        interpreter = (relocated / receipt["python"]).resolve()
        if not interpreter.is_relative_to(relocated):
            raise ValueError("Interpreter escapes payload")
        result = subprocess.run([str(interpreter), "-I", "-S", "-B", "-c", CHILD, str(relocated), PIN],
                                cwd=home, env=env, capture_output=True, text=True, timeout=90)
        if result.returncode:
            raise RuntimeError(result.stderr[-12000:])
        proof = json.loads(result.stdout.strip().splitlines()[-1])
        assert proof["isolated"] is True
        print("PASS: relocated payload-owned Python imports actual AIAgent, OpenAI and Pydantic offline; all import paths are inside the relocated payload. No model request or tools executed.")
    finally:
        if temporary.parent != Path(tempfile.gettempdir()).resolve() or not temporary.name.startswith("najd-core-portable-"):
            raise RuntimeError("Unsafe cleanup")
        def remove_readonly(function, filename, error):
            target = Path(filename)
            if not target.resolve().is_relative_to(temporary) or target.is_symlink() or target.is_junction():
                raise error
            target.chmod(stat.S_IWRITE | stat.S_IREAD)
            function(filename)
        shutil.rmtree(temporary, onexc=remove_readonly)


if __name__ == "__main__":
    main()
