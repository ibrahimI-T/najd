"""Recover original notices from checksum-pinned exact-version source archives.

Reads an audit report and writes a separate fresh publisher evidence directory.
Never extracts archive paths, executes code or modifies a staged core.
"""
from pathlib import Path, PurePosixPath
import argparse
import gzip
import hashlib
import io
import json
import tarfile
import urllib.parse
import urllib.request

ROOT = Path(__file__).resolve().parent.parent


def notice_texts(compressed):
    # Bound decompressed data before tar parsing, including gzip bombs.
    with gzip.GzipFile(fileobj=io.BytesIO(compressed)) as stream:
        data = stream.read(64 * 1024 * 1024 + 1)
    if len(data) > 64 * 1024 * 1024:
        raise ValueError("Oversized source archive")
    notices = []
    with tarfile.open(fileobj=io.BytesIO(data), mode="r:") as archive:
        for item in archive:
            filename = PurePosixPath(item.name).name.lower()
            if not item.isfile() or filename.split(".")[0] not in ("license", "licence", "copying", "notice"):
                continue
            if not 0 < item.size <= 512 * 1024 or len(notices) >= 32:
                raise ValueError("Oversized notice inventory")
            content = archive.extractfile(item).read(512 * 1024 + 1)
            content.decode("utf-8")
            notices.append((item.name, content))
    return notices


def fetch_source(item):
    url = urllib.parse.urlsplit(item["url"])
    if url.scheme != "https" or url.netloc != "files.pythonhosted.org" or url.query or url.fragment:
        raise ValueError("Unexpected source host")
    if not 0 < item["size"] <= 32 * 1024 * 1024:
        raise ValueError("Oversized download")
    with urllib.request.urlopen(item["url"], timeout=25) as response:
        if urllib.parse.urlsplit(response.url).netloc != "files.pythonhosted.org":
            raise ValueError("Unexpected source redirect")
        data = response.read(item["size"] + 1)
    if len(data) != item["size"] or hashlib.sha256(data).hexdigest() != item["sha256"]:
        raise ValueError("Source archive identity mismatch")
    return data


SUPPLEMENTS = ROOT / "scripts/core-notice-sources.json"


def fetch_supplement(item):
    url = urllib.parse.urlsplit(item["url"])
    parts = url.path.split("/")
    # Only an immutable commit path on GitHub's raw host is accepted.
    if url.scheme != "https" or url.netloc != "raw.githubusercontent.com" or url.query or len(parts) < 5 or len(parts[3]) != 40:
        raise ValueError("Unexpected supplemental notice source")
    with urllib.request.urlopen(item["url"], timeout=25) as response:
        if urllib.parse.urlsplit(response.url).netloc != "raw.githubusercontent.com":
            raise ValueError("Unexpected supplemental redirect")
        data = response.read(item["size"] + 1)
    if len(data) != item["size"] or hashlib.sha256(data).hexdigest() != item["sha256"]:
        raise ValueError("Supplemental notice identity mismatch")
    return data


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--audit", required=True)
    parser.add_argument("--output", required=True)
    args = parser.parse_args()
    base = (ROOT / ".runtimes").resolve()
    report, output = Path(args.audit).resolve(), Path(args.output).absolute()
    if not report.is_relative_to(base) or output != output.resolve() or not output.is_relative_to(base) or output == base or output.exists():
        raise ValueError("Expected ignored audit and fresh owned output")
    audit = json.loads(report.read_text(encoding="utf-8"))
    if audit.get("format") != "najd-core-audit-v1" or audit.get("complete") is not True:
        raise ValueError("Complete exact-version audit required")
    supplements = json.loads(SUPPLEMENTS.read_text(encoding="utf-8"))
    excluded = {(row["package"], row["version"]) for row in supplements["excluded"]}
    output.mkdir()
    inventory = []
    for row in audit["packages"]:
        if row["noticeFiles"] or (row["name"], row["version"]) in excluded:
            continue
        candidates = [item for item in row["sourceArchives"] if item["url"].endswith(".tar.gz")]
        if len(candidates) != 1:
            raise ValueError("Expected one pinned source archive")
        source = candidates[0]
        notices = notice_texts(fetch_source(source))
        if not notices:
            for item in supplements["sources"]:
                if row["name"] in item["packages"] and row["version"] == item["version"]:
                    notices = [(item["url"], fetch_supplement(item))]
                    source = {**source, "supplementalEvidence": item["evidence"]}
        records = []
        for index, (original_path, text) in enumerate(notices):
            # Never use remote archive paths or package names as disk paths.
            filename = f"notice-{len(inventory):03}-{index:02}.txt"
            with (output / filename).open("xb") as stream:
                stream.write(text)
            records.append({"originalPath": original_path, "file": filename, "sha256": hashlib.sha256(text).hexdigest()})
        inventory.append({"name": row["name"], "version": row["version"], "source": source, "notices": records})
    with (output / "inventory.json").open("x", encoding="utf-8") as stream:
        json.dump({"format": "najd-recovered-notices-v1", "packages": inventory}, stream, indent=2)
    missing = [row["name"] for row in inventory if not row["notices"]]
    print(f"Source notices recovered for {len(inventory) - len(missing)}/{len(inventory)} packages.")
    if missing:
        print("Still missing: " + ", ".join(missing))
        raise SystemExit(2)


if __name__ == "__main__":
    main()
