"""Build a fresh, isolated NAJD core payload through pinned upstream PM APIs.

Publisher-only. No standalone application profile or developer venv is copied.
"""
from pathlib import Path
import argparse
import hashlib
import importlib.metadata
import json
import os
import subprocess
import sys

ROOT = Path(__file__).resolve().parent.parent
SOURCE = ROOT / "third_party/hermes-agent"
REVISION = "c70332f88886932337619a1e57029bd885c28b9d"


def validate_output(value: str) -> Path:
    base = (ROOT / ".runtimes/runtime-packs").resolve()
    output = Path(value).absolute()
    if output == base or not output.resolve().is_relative_to(base) or output != output.resolve():
        raise ValueError("Output must be a fresh directory beneath NAJD runtime-packs")
    if output.exists() or output.is_symlink():
        raise FileExistsError("Existing output is preserved; choose a fresh directory")
    return output


OVERRIDES = ROOT / "scripts/agent-core-overrides.txt"


def apply_overrides(tools: Path, facts, get_package, environment: Path) -> list:
    """Replace exact advisory-affected wheels without touching the upstream checkout or lock."""
    uv = get_package("uv").binary(tools / facts.get("uv")["entry"], "win32-x64")
    target = environment / "Scripts/python.exe"
    if uv is None or not uv.resolve().is_relative_to(tools.parent) or not target.exists():
        raise RuntimeError("Payload-owned uv/interpreter missing for overrides")
    subprocess.run([str(uv), "pip", "install", "--python", str(target), "--no-deps", "--require-hashes",
                    "--only-binary", ":all:", "--reinstall", "-r", str(OVERRIDES)], check=True, env=dict(os.environ))
    applied = []
    for line in OVERRIDES.read_text(encoding="utf-8").splitlines():
        if line.strip() and not line.startswith("#"):
            name, version = line.split()[0].split("==")
            applied.append({"name": name, "version": version, "reason": "public advisories fixed upstream; see agent-core-overrides.txt"})
    # Redistribution exclusions are recorded in core-notice-sources.json with their evidence.
    exclusions = json.loads((ROOT / "scripts/core-notice-sources.json").read_text(encoding="utf-8"))["excluded"]
    for row in exclusions:
        subprocess.run([str(uv), "pip", "uninstall", "--python", str(target), row["package"]], check=True, env=dict(os.environ))
        applied.append({"name": row["package"], "version": None, "reason": "excluded: " + row["reason"]})
    return applied


def stage(output: Path) -> None:
    if sys.platform != "win32" or sys.version_info[:3] != (3, 14, 7):
        raise RuntimeError("Publisher proof requires the pinned native Python 3.14")
    revision = subprocess.check_output(["git", "-C", str(SOURCE), "rev-parse", "HEAD"], text=True).strip()
    if revision != REVISION:
        raise RuntimeError("Upstream source pin differs")
    # Resolve and sanitize before importing upstream's package manager.
    home = output.parent / (output.name + "-build-home")
    if home.exists():
        raise FileExistsError("Existing build home is preserved")
    home.mkdir(parents=True)
    temporary = home / "temp"
    temporary.mkdir()
    git = subprocess.check_output(["where.exe", "git"], text=True).splitlines()[0]
    preserved = {key: os.environ[key] for key in ("SystemRoot", "WINDIR", "SystemDrive", "ComSpec", "PATHEXT", "PROCESSOR_ARCHITECTURE", "NUMBER_OF_PROCESSORS") if key in os.environ}
    os.environ.clear()
    os.environ.update(preserved)
    os.environ.update({
        "PATH": str(Path(git).parent) + os.pathsep + str(Path(os.environ["SystemRoot"]) / "System32"),
        "HOME": str(home), "USERPROFILE": str(home), "APPDATA": str(home / "AppData/Roaming"),
        "LOCALAPPDATA": str(home / "AppData/Local"), "TEMP": str(temporary), "TMP": str(temporary),
        "HERMES_HOME": str(home / "profile"), "HERMES_RUNTIME_DIR": str(ROOT / ".runtimes/hermes/tools"),
        "UV_CACHE_DIR": str(ROOT / ".runtimes/hermes/uv-cache"), "PYTHONUTF8": "1", "PYTHONDONTWRITEBYTECODE": "1",
    })
    sys.path.insert(0, str(SOURCE))
    import pm
    from pm.runtime import runtime_python
    from pm.lock import Facts
    from pm.registry import get_package
    from scripts.bundles.payload import INERT_SNAPSHOT_DIRS, snapshot, relativize_links
    from scripts.bundles.native import stage_pm_runtime
    from scripts.bundles.bytecode import bake_bytecode
    from scripts.build.agent import assemble
    from scripts.build.inputs import AgentInputs

    print("Preparing the build home's independent pinned PM runtime", flush=True)
    runtime_python(bootstrap=True, cache=ROOT / ".runtimes/hermes/uv-cache")
    output.mkdir(parents=True)
    repo = output / "hermes-agent"
    print("Snapshotting exact upstream revision", flush=True)
    snapshot(SOURCE, REVISION, repo, exclude=INERT_SNAPSHOT_DIRS)
    print("Copying PM-verified pinned Python and uv into the payload", flush=True)
    tools = output / "tools"
    pm.stage_tools(["python", "uv"], source_store=ROOT / ".runtimes/hermes/tools", out=tools, target="win32-x64")
    facts = Facts(tools / "facts.json")
    python_fact = facts.get("python")
    python = get_package("python").binary(tools / python_fact["entry"], "win32-x64")
    if python is None or not python.resolve().is_relative_to(output):
        raise RuntimeError("Missing payload-owned interpreter")
    print("Building sealed frozen core dependencies (optional extras remain separate)", flush=True)
    environment = output / "venv"
    pm.build_environment(source=repo, out=environment, python=python,
                         cache=ROOT / ".runtimes/hermes/uv-cache", env=dict(os.environ),
                         frozen=True, sealed=True, explicit=True, all_extras=False)
    print("Applying reviewed hash-pinned security overrides", flush=True)
    overrides = apply_overrides(tools, facts, get_package, environment)
    print("Preparing the independently locked PM runtime", flush=True)
    stage_pm_runtime(output, python, repo, cache=ROOT / ".runtimes/hermes/uv-cache")
    site = environment / "Lib/site-packages"
    inputs = AgentInputs(project=repo / "pyproject.toml", code=repo, repo="hermes-agent", placement="contained",
                         target="win32-x64", python=python, site_packages=site, environment=environment,
                         tools=tools, pm_runtime=output / "pm-runtime", ref=REVISION)
    print("Assembling original relocatable launch and dependency contracts", flush=True)
    assembled = assemble(inputs, output)
    relativize_links(output)
    # Absolute editable source pointers have already been pruned by sealed PM build.
    # Build-only local direct_url metadata is not a dependency or a redistributable path.
    for marker in output.glob("**/*.dist-info/direct_url.json"):
        value = json.loads(marker.read_text(encoding="utf-8"))
        if str(value.get("url", "")).startswith("file:"):
            marker.unlink()
    baked = bake_bytecode(output, python)
    inventory = []
    for distribution in importlib.metadata.distributions(path=[str(site)]):
        inventory.append({"name": distribution.metadata["Name"], "version": distribution.version,
                          "license": distribution.metadata.get("License-Expression") or distribution.metadata.get("License"),
                          "licenseFiles": [str(name) for name in (distribution.files or []) if "license" in str(name).lower() or "notice" in str(name).lower()]})
    receipt = {"format": "najd-agent-core-v1", "sourceRevision": REVISION, "extras": [],
               "sourceLockSha256": hashlib.sha256((repo / "uv.lock").read_bytes()).hexdigest(),
               "python": assembled["runtime"]["storePython"], "sitePackages": assembled["runtime"]["sitePackages"],
               "packages": sorted(inventory, key=lambda row: str(row["name"]).lower()), "bakedModules": baked["modules"],
               "securityOverrides": overrides}
    (output / "najd-core.json").write_text(json.dumps(receipt, indent=2) + "\n", encoding="utf-8")
    print(f"Prepared isolated NAJD core: {len(inventory)} distributions, {baked['modules']} baked modules. Relocation/audit/notice gates remain.", flush=True)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", required=True)
    parser.add_argument("--validate-only", action="store_true")
    args = parser.parse_args()
    output = validate_output(args.output)
    if args.validate_only:
        print("Fresh publisher output accepted")
    else:
        stage(output)


if __name__ == "__main__":
    main()
