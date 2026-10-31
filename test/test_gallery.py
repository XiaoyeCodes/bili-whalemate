"""Verify gallery recovery and fail closed on corrupt release assets."""
import hashlib
from io import BytesIO
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch
import zipfile

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "scripts"))
import fetch_gallery
import setup


class GalleryTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.content = b"fixture-image"
        setup.save(self.root / "package.json", {"version": "1.1.0"})
        setup.save(self.root / "seed/gallery.json", [{"file": "hello.png"}])
        setup.save(self.root / "seed/gallery-manifest.json", [{"file": "hello.png", "bytes": len(self.content), "sha256": hashlib.sha256(self.content).hexdigest()}])
        for module in (setup, fetch_gallery):
            mocked = patch.object(module, "ROOT", self.root)
            mocked.start(); self.addCleanup(mocked.stop)

    def release(self, image=None, corrupt_checksum=False):
        buf = BytesIO()
        with zipfile.ZipFile(buf, "w") as archive:
            archive.writestr("bili-whalemate/gallery/hello.png", self.content if image is None else image)
            archive.writestr("../unapproved.txt", "must never extract")
        content = buf.getvalue()
        digest = '0' * 64 if corrupt_checksum else hashlib.sha256(content).hexdigest()
        return lambda url, **kwargs: BytesIO((digest + "  bili-whalemate-v1.1.0.zip\n").encode() if url.endswith("SHA256SUMS") else content)

    def test_complete_gallery_requires_no_network(self):
        (self.root / "gallery").mkdir()
        (self.root / "gallery/hello.png").write_bytes(self.content)
        with patch.object(fetch_gallery, "urlopen", side_effect=AssertionError("no download")):
            self.assertEqual(fetch_gallery.fetch_gallery(), 1)

    def test_missing_gallery_restores_only_verified_manifest_entries(self):
        with patch.object(fetch_gallery, "urlopen", side_effect=self.release()):
            self.assertEqual(fetch_gallery.fetch_gallery(), 1)
        self.assertEqual((self.root / "gallery/hello.png").read_bytes(), self.content)
        self.assertEqual(list((self.root / "gallery").iterdir()), [self.root / "gallery/hello.png"])
        self.assertFalse((self.root / "unapproved.txt").exists())

    def test_corrupt_archive_is_rejected_before_installing(self):
        with patch.object(fetch_gallery, "urlopen", side_effect=self.release(corrupt_checksum=True)):
            with self.assertRaisesRegex(ValueError, "archive checksum"):
                fetch_gallery.fetch_gallery()
        self.assertFalse((self.root / "gallery").exists())

    def test_corrupt_image_is_rejected_even_with_valid_archive_checksum(self):
        with patch.object(fetch_gallery, "urlopen", side_effect=self.release(image=b'x' * len(self.content))):
            with self.assertRaisesRegex(ValueError, "entry checksum"):
                fetch_gallery.fetch_gallery()
        self.assertFalse((self.root / "gallery").exists())
