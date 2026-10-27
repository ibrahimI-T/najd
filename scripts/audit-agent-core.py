"""Audit generated core distributions against exact-version public PyPI metadata.

Writes a separate report; never installs packages or modifies the immutable payload.
The PyPI vulnerability feed is evidence, not an exhaustive security certification.
"""
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor
import argparse
import datetime
import hashlib
import importlib.metadata
import json
import urllib.parse
import urllib.request

ROOT = Path(__file__).resolve().parent.parent


def fetch_metadata(name, version):
    url = "https://pypi.org/pypi/{}/{}/json".format(urllib.parse.quote(name, safe=""), urllib.parse.quote(version, safe=""))
    request = urllib.request.Request(url, headers={"User-Agent": "NAJD-publisher-audit/1"})
    with urllib.request.urlopen(request, timeout=20) as response:
        if not response.url.startswith("https://pypi.org/"):
            raise ValueError("Unexpected metadata host")
        data = response.read(4 * 1024 * 1024 + 1)
        if len(data) > 4 * 1024 * 1024:
            raise ValueError("Oversized metadata")
    result = json.loads(data)
    normalize = lambda value: str(value).lower().replace("_", "-").replace(".", "-")
    if normalize(result["info"]["name"]) != normalize(name) or result["info"]["version"] != version:
        raise ValueError("Metadata identity mismatch")
    return result, hashlib.sha256(data).hexdigest()


def audit(row):
    try:
        metadata, digest = fetch_metadata(row["name"], row["version"])
        return {**row, "checked": True, "metadataSha256": digest,
                "vulnerabilities": [item for item in metadata.get("vulnerabilities", []) if not item.get("withdrawn")],
                "yankedFiles": sum(bool(item.get("yanked")) for item in metadata.get("urls", [])),
                "sourceArchives": [{"url": item["url"], "sha256": item["digests"]["sha256"], "size": item["size"]}
                                   for item in metadata.get("urls", []) if item.get("packagetype") == "sdist"]}
    except Exception as error:
        # No headers, environment or arbitrary remote response bodies in reports.
        return {**row, "checked": False, "error": type(error).__name__}


def inventory(payload):
    packages = []
    for environment in ("venv", "pm-runtime"):
        site = payload / environment / "Lib/site-packages"
        if not site.is_dir():
            raise ValueError("Missing sealed environment")
        for distribution in importlib.metadata.distributions(path=[str(site)]):
            notices = []
            for item in distribution.files or []:
                if not any(term in str(item).lower() for term in ("license", "notice", "copying")):
                    continue
                filename = Path(distribution.locate_file(item)).resolve()
                if filename.is_relative_to(payload) and filename.is_file():
                    notices.append({"path": filename.relative_to(payload).as_posix(),
                                    "sha256": hashlib.sha256(filename.read_bytes()).hexdigest()})
            packages.append({"environment": environment, "name": distribution.metadata["Name"],
                             "version": distribution.version, "noticeFiles": notices})
    return sorted(packages, key=lambda row: (row["name"].lower(), row["environment"]))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--payload", required=True)
    parser.add_argument("--report", required=True)
    args = parser.parse_args()
    base = (ROOT / ".runtimes/runtime-packs").resolve()
    payload, report = Path(args.payload).resolve(), Path(args.report).resolve()
    if payload == base or not payload.is_relative_to(base) or not (payload / "najd-core.json").is_file():
        raise ValueError("Expected generated NAJD core")
    if not report.is_relative_to((ROOT / ".runtimes").resolve()) or report.is_relative_to(payload) or report.exists():
        raise ValueError("Report must be a fresh separate ignored file")
    packages = inventory(payload)
    # The source snapshot has placeholder version 0.0.0, not a published PyPI
    # dependency. Record its pinned source separately; do not query an unrelated
    # package with the same name or claim that its code has a PyPI audit.
    source = json.loads((payload / "najd-core.json").read_text(encoding="utf-8"))
    if hashlib.sha256((payload / "hermes-agent/uv.lock").read_bytes()).hexdigest() != source["sourceLockSha256"]:
        raise ValueError("Source lock differs from staging receipt")
    first_party = [row for row in packages if row["name"].lower() == "hermes-agent" and row["version"] == "0.0.0"]
    packages = [row for row in packages if row not in first_party]
    with ThreadPoolExecutor(max_workers=4) as pool:
        results = list(pool.map(audit, packages))
    missing = [f'{row["environment"]}:{row["name"]}' for row in results if not row["noticeFiles"]]
    findings = sum(len(row.get("vulnerabilities", [])) for row in results)
    complete = all(row["checked"] for row in results)
    data = {"format": "najd-core-audit-v1", "checkedAt": datetime.datetime.now(datetime.timezone.utc).isoformat(),
            "source": "https://pypi.org", "complete": complete, "missingNotices": missing,
            "vulnerabilityRecords": findings, "packages": results,
            "sourceSnapshot": {"revision": source["sourceRevision"], "lockSha256": source["sourceLockSha256"],
                               "notAuditedByPyPI": first_party}}
    with report.open("x", encoding="utf-8") as stream:
        json.dump(data, stream, indent=2)
        stream.write("\n")
    print(f"Exact-version PyPI checks: {sum(row['checked'] for row in results)}/{len(results)}; vulnerability records: {findings}; missing packaged notices: {len(missing)}.")
    print("Report saved separately; this does not establish complete redistribution or security acceptance.")
    if not complete or findings or missing:
        raise SystemExit(2)


if __name__ == "__main__":
    main()
