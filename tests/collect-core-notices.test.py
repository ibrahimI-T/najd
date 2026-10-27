"""Offline checksum and inert archive-reading checks for notice collection."""
from pathlib import Path
import gzip
import hashlib
import importlib.util
import io
import tarfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parent.parent
spec = importlib.util.spec_from_file_location("collect_core_notices", ROOT / "scripts/collect-core-notices.py")
collector = importlib.util.module_from_spec(spec)
spec.loader.exec_module(collector)


class NoticeTests(unittest.TestCase):
    def test_only_regular_original_notices_are_read_without_extracting(self):
        buffer = io.BytesIO()
        with tarfile.open(fileobj=buffer, mode="w") as archive:
            for name in ("source/LICENSE", "../../NOTICE.txt", "source/setup.py"):
                item = tarfile.TarInfo(name); item.size = 3
                archive.addfile(item, io.BytesIO(b"MIT"))
            link = tarfile.TarInfo("source/COPYING"); link.type = tarfile.SYMTYPE; link.linkname = "C:/private"
            archive.addfile(link)
        result = collector.notice_texts(gzip.compress(buffer.getvalue()))
        self.assertEqual([row[0] for row in result], ["source/LICENSE", "../../NOTICE.txt"])
        self.assertTrue(all(row[1] == b"MIT" for row in result))

    def test_malformed_archive_fails(self):
        with self.assertRaises((OSError, EOFError, tarfile.TarError)):
            collector.notice_texts(b"invalid")

    def test_untrusted_source_host_and_oversized_download_fail_before_network(self):
        with patch.object(collector.urllib.request, "urlopen") as request:
            for source in ({"url": "https://other.example/code.tar.gz", "size": 1},
                           {"url": "https://files.pythonhosted.org/code.tar.gz", "size": 40 * 1024 * 1024}):
                with self.assertRaises(ValueError):
                    collector.fetch_source(source)
            request.assert_not_called()

    def test_source_hash_and_exact_size_are_required(self):
        class Response(io.BytesIO):
            url = "https://files.pythonhosted.org/code.tar.gz"
        source = {"url": Response.url, "size": 3, "sha256": hashlib.sha256(b"MIT").hexdigest()}
        with patch.object(collector.urllib.request, "urlopen", return_value=Response(b"MIT")):
            self.assertEqual(collector.fetch_source(source), b"MIT")
        with patch.object(collector.urllib.request, "urlopen", return_value=Response(b"BAD")), self.assertRaises(ValueError):
            collector.fetch_source(source)


if __name__ == "__main__":
    unittest.main()
