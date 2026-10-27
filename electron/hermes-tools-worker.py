"""NAJD bridge to selected original Hermes tools inside the activated sealed core.

NAJD's main process owns the model, approvals and lifecycle. This worker only
executes an allowlisted upstream tool per request and returns bounded results.
Protocol: one JSON object per line on stdin {"id", "tool", "args"}; replies
{"id", "ok", "result"|"error"} per line on stdout. Closing stdin ends the worker.
"""
import contextlib
import json
import os
import site
import sys
from pathlib import Path

ALLOWED = {"web_search", "web_extract"}
MAX_RESULT = 12000
PROTOCOL = sys.stdout


def reply(payload):
    PROTOCOL.write(json.dumps(payload, ensure_ascii=True) + "\n")
    PROTOCOL.flush()


def main():
    root = Path(sys.argv[1]).resolve()
    receipt = json.loads((root / "najd-core.json").read_text(encoding="utf-8"))
    if receipt.get("format") != "najd-agent-core-v1" or sys.argv[2] != receipt.get("sourceRevision"):
        raise RuntimeError("Unexpected core")
    site.addsitedir(str(root / receipt["sitePackages"]))
    sys.path.insert(0, str(root / receipt.get("source", "hermes-agent")))
    with contextlib.redirect_stdout(sys.stderr):
        # Never load dotenv files, accounts or a standalone profile's secrets.
        import hermes_cli.env_loader
        hermes_cli.env_loader.load_hermes_dotenv = lambda *args, **kwargs: []
        import model_tools
        definitions = model_tools.get_tool_definitions(enabled_toolsets=["web"], quiet_mode=True)
        from tools.registry import registry
    available = sorted(ALLOWED & {item["function"]["name"] for item in definitions})
    reply({"id": 0, "ok": True, "result": {"ready": True, "tools": available}})
    for line in sys.stdin:
        if len(line) > 65536:
            reply({"id": None, "ok": False, "error": "INVALID_INPUT"})
            continue
        try:
            request = json.loads(line)
            identifier, tool, args = request["id"], request["tool"], request["args"]
            if tool not in available or not isinstance(args, dict):
                reply({"id": identifier, "ok": False, "error": "UNSUPPORTED_TOOL"})
                continue
        except Exception:
            reply({"id": None, "ok": False, "error": "INVALID_INPUT"})
            continue
        try:
            with contextlib.redirect_stdout(sys.stderr):
                result = registry.dispatch(tool, args)
            text = result if isinstance(result, str) else json.dumps(result, ensure_ascii=False, default=str)
            reply({"id": identifier, "ok": True, "result": text[:MAX_RESULT], "truncated": len(text) > MAX_RESULT})
        except Exception:
            # Upstream exception text may contain URLs/headers; return a stable code only.
            reply({"id": identifier, "ok": False, "error": "TOOL_FAILED"})


if __name__ == "__main__":
    try:
        main()
    except Exception:
        sys.exit(1)
