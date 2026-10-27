"""Shared gallery selection and transport preparation without remote writes."""
import tempfile
import unittest
from pathlib import Path
from unittest.mock import Mock, patch
from PIL import Image
from bili_gallery import BiliGallery


class GalleryTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name, "memes")
        self.root.mkdir()
        Image.new("RGBA", (16, 12), (10, 20, 30, 255)).save(self.root / "开心.webp")
        Image.new("RGB", (16, 12), "blue").save(self.root / "hello.png")
        self.rows = [{"file": "开心.webp", "emotion": "happy", "caption": "开心", "keywords": "开心"},
                     {"file": "hello.png", "emotion": "daily", "caption": "你好", "keywords": "招呼"}]
        self.reader, self.used = Mock(return_value=self.rows), Mock()
        self.gallery = BiliGallery(self.reader, self.used, self.root, Path(self.temp.name, "cache"))

    def test_zero_rate_does_not_read_catalogue_or_prepare_an_image(self):
        self.assertEqual(self.gallery.offer(0), [])
        self.reader.assert_not_called()

    def test_shared_probability_gate_has_deterministic_endpoints(self):
        self.assertEqual(len(self.gallery.offer(1)), 2)
        with patch("bili_gallery.random.random", return_value=0.8):
            self.assertEqual(self.gallery.offer(0.2), [])
        with patch("bili_gallery.random.random", return_value=0.1):
            self.assertEqual(len(self.gallery.offer(0.2)), 2)

    def test_webp_is_converted_to_a_stable_png_without_changing_gallery(self):
        result = self.gallery.prepare("开心.webp")
        self.assertEqual(result["file"], "开心.webp")
        self.assertEqual(Path(result["path"]).suffix, ".png")
        with Image.open(result["path"]) as image:
            self.assertEqual(image.size, (16, 12))
        self.assertTrue((self.root / "开心.webp").is_file())
        self.assertEqual(result, self.gallery.prepare("开心.webp"))

    def test_model_can_only_select_an_offered_file(self):
        offered = self.gallery.offer(1)
        self.assertEqual(self.gallery.selected("hello.png", offered), "hello.png")
        for bad in ("../hello.png", "C:/secrets.png", "invented.png"):
            with self.subTest(bad=bad), self.assertRaises(ValueError):
                self.gallery.selected(bad, offered)
        self.assertIsNone(self.gallery.selected(None, offered))

    def test_manual_preparation_requires_membership_in_the_shared_catalogue(self):
        Image.new("RGB", (1, 1)).save(self.root / "not-in-catalogue.png")
        for bad in ("../hello.png", "not-in-catalogue.png"):
            with self.subTest(bad=bad), self.assertRaises(ValueError):
                self.gallery.prepare(bad)

    def test_usage_is_marked_only_when_explicitly_confirmed(self):
        self.gallery.prepare("hello.png")
        self.used.assert_not_called()
        self.gallery.mark("hello.png")
        self.used.assert_called_once_with("hello.png")

    def test_scene_ranker_and_disabled_keywords_match_shared_gallery_policy(self):
        self.rows[0]["keywords"] += " 自动回复禁用"
        self.gallery.ranker = Mock(return_value=self.rows)
        offered = self.gallery.offer(1, query="打招呼")
        self.gallery.ranker.assert_called_once_with("打招呼")
        self.assertEqual([row["file"] for row in offered], ["hello.png"])


if __name__ == "__main__":
    unittest.main()
