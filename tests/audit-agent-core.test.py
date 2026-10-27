"""Offline tests for bounded public dependency audit reporting."""
from pathlib import Path
import importlib.util
import json
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parent.parent
spec = importlib.util.spec_from_file_location("audit_agent_core", ROOT / "scripts/audit-agent-core.py")
audit = importlib.util.module_from_spec(spec)
spec.loader.exec_module(audit)


class Response:
    url = "https://pypi.org/pypi/example/1.0.0/json"

    def __init__(self, data):
        self.data = data

    def __enter__(self):
        return self

    def __exit__(self, *args):
        pass

    def read(self, bound):
        return self.data[:bound]


class AuditTests(unittest.TestCase):
    def test_exact_metadata_and_hash(self):
        response = Response(json.dumps({"info": {"name": "example", "version": "1.0.0"}}).encode())
        with patch.object(audit.urllib.request, "urlopen", return_value=response):
            value, digest = audit.fetch_metadata("example", "1.0.0")
        self.assertEqual(value["info"]["version"], "1.0.0")
        self.assertEqual(len(digest), 64)

    def test_wrong_identity_host_and_oversize_are_rejected(self):
        wrong = Response(b'{"info":{"name":"other","version":"1.0.0"}}')
        host = Response(b"{}"); host.url = "https://untrusted.example/"
        for response in (wrong, host, Response(b"x" * (4 * 1024 * 1024 + 1))):
            with patch.object(audit.urllib.request, "urlopen", return_value=response), self.assertRaises(ValueError):
                audit.fetch_metadata("example", "1.0.0")

    def test_failure_is_visible_without_response_text(self):
        with patch.object(audit, "fetch_metadata", side_effect=RuntimeError("private remote response")):
            result = audit.audit({"name": "example", "version": "1.0.0"})
        self.assertFalse(result["checked"])
        self.assertEqual(result["error"], "RuntimeError")
        self.assertNotIn("private", json.dumps(result))

    def test_withdrawn_records_do_not_block_but_active_findings_remain(self):
        data = {"vulnerabilities": [{"id": "withdrawn", "withdrawn": "2026-01-01"}, {"id": "active"}], "urls": []}
        with patch.object(audit, "fetch_metadata", return_value=(data, "hash")):
            result = audit.audit({"name": "example", "version": "1.0.0"})
        self.assertTrue(result["checked"])
        self.assertEqual(result["vulnerabilities"], [{"id": "active"}])


if __name__ == "__main__":
    unittest.main()
