# Fixed NAJD health probe for the sealed agent core: imports only, no network, processes or secrets.
from pathlib import Path
import sys, json, site, socket, subprocess
root = Path(sys.argv[1]).resolve()
receipt = json.loads((root / "najd-core.json").read_text(encoding="utf-8"))
assert receipt["format"] == "najd-agent-core-v1"
assert receipt["sourceRevision"] == sys.argv[2]
assert sys.version_info[:3] == (3, 14, 7)
assert Path(sys.executable).resolve().is_relative_to(root)
source = root / receipt.get("source", "hermes-agent")
assert not (source / ".env").exists()
def blocked(*args, **kwargs):
    raise RuntimeError("Health imports must not access network or spawn programs")
socket.socket.connect = blocked
socket.create_connection = blocked
class BlockedProcess(subprocess.Popen):
    def __init__(self, *args, **kwargs):
        blocked()
subprocess.Popen = BlockedProcess
site.addsitedir(str(root / receipt["sitePackages"]))
sys.path.insert(0, str(source))
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
