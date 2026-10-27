"""One isolated, tool-free Hermes turn. NAJD owns provider access and lifecycle."""
from pathlib import Path
import contextlib
import json
import os
import sys
import threading

PROTOCOL = sys.stdout
if len(sys.argv) >= 3:
    # Activated sealed core: payload-owned interpreter, site-packages and source snapshot.
    import site
    _CORE = Path(sys.argv[1]).resolve()
    _RECEIPT = json.loads((_CORE / "najd-core.json").read_text(encoding="utf-8"))
    if _RECEIPT.get("sourceRevision") != sys.argv[2]:
        raise SystemExit(1)
    site.addsitedir(str(_CORE / _RECEIPT["sitePackages"]))
    SOURCE = _CORE / _RECEIPT.get("source", "hermes-agent")
else:
    SOURCE = Path(__file__).resolve().parent.parent / "third_party/hermes-agent"
sys.path.insert(0, str(SOURCE))


def emit(config, sequence, kind, **payload):
    frame = {"version": 1, "instanceId": config["instanceId"], "taskId": config["taskId"],
             "sequence": sequence, "type": kind, **payload}
    PROTOCOL.write(json.dumps(frame, ensure_ascii=True) + "\n")
    PROTOCOL.flush()


def main():
    if sys.version_info[:3] != (3, 14, 7):
        raise RuntimeError("Unsupported Python")
    # Upstream loads a checkout .env during import. Never borrow such credentials.
    if (SOURCE / ".env").exists():
        raise RuntimeError("Checkout environment must remain absent")
    raw = sys.stdin.buffer.readline(1024 * 1024 + 1)
    if len(raw) > 1024 * 1024:
        raise ValueError("Oversized configuration")
    config = json.loads(raw)
    if not isinstance(config["text"], str) or not 0 < len(config["text"]) <= 4000:
        raise ValueError("Invalid task")
    # The owner keeps stdin open. Its loss revokes this tool-free worker immediately.
    def owner_watch():
        os.read(sys.stdin.fileno(), 1)
        os._exit(1)

    threading.Thread(target=owner_watch, daemon=True).start()
    with contextlib.redirect_stdout(sys.stderr):
        import hermes_cli.env_loader
        hermes_cli.env_loader.load_hermes_dotenv = lambda *args, **kwargs: []
        from run_agent import AIAgent

        agent = AIAgent(base_url=config["baseUrl"], api_key=config["token"], provider="custom",
                        api_mode="chat_completions", model=config["model"], max_iterations=1,
                        enabled_toolsets=[], quiet_mode=True, save_trajectories=False,
                        skip_context_files=True, skip_memory=True, skip_background_review=True,
                        session_id=config["taskId"], cwd=config["cwd"], run_budget_seconds=110,
                        fallback_model=None, checkpoints_enabled=False, max_tokens=1024)
        if agent.tools or agent.valid_tool_names:
            raise RuntimeError("Unexpected executable tools")
        emit(config, 1, "ready", runtimeVersion="3.14.7")
        try:
            result = agent.run_conversation(config["text"], task_id=config["taskId"],
                                            system_message="You are NAJD AGENT's Hermes planning engine. Answer the user's request as text. You have no tools and cannot perform device actions.")
        finally:
            agent.close()
        output = result.get("final_response")
        if not isinstance(output, str) or not output.strip() or len(output) > 20000:
            raise RuntimeError("Invalid Hermes response")
        emit(config, 2, "completed", output=output)


if __name__ == "__main__":
    try:
        main()
    except Exception:
        # Never forward upstream exception strings, prompts, headers or credentials.
        sys.exit(1)
