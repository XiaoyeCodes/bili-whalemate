"""Read the existing meme catalogue and prepare one selected file for Bilibili."""
import hashlib
import math
import os
import random
from pathlib import Path
from PIL import Image


class BiliGallery:
    """Keep selection inside the shared catalogue; transport copies never modify originals."""
    def __init__(self, reader, mark_used, media_dir, cache_dir, ranker=None):
        self.reader, self.mark_used = reader, mark_used
        self.media_dir, self.cache_dir = Path(media_dir).resolve(), Path(cache_dir).resolve()
        self.ranker = ranker

    def _path(self, filename):
        if not isinstance(filename, str) or Path(filename).name != filename or "/" in filename or "\\" in filename:
            raise ValueError("图库文件名无效")
        path = (self.media_dir / filename).resolve()
        if not path.is_relative_to(self.media_dir):
            raise ValueError("图片不能位于图库目录之外")
        return path

    def offer(self, rate, query=""):
        rate = float(rate)
        if not math.isfinite(rate) or not 0 <= rate <= 1:
            raise ValueError("共享表情包概率必须在 0 到 1 之间")
        if rate == 0 or (rate < 1 and random.random() >= rate):
            return []
        rows = self.ranker(query) if self.ranker else self.reader()
        rows = [row for row in rows if "自动回复禁用" not in row.get("keywords", "") and self._path(row["file"]).is_file()]
        return [{key: row.get(key, "") for key in ("file", "emotion", "caption", "keywords")}
                for row in (rows[:8] if self.ranker else random.sample(rows, min(8, len(rows))))]

    def selected(self, filename, offered):
        if filename in (None, ""):
            return None
        if filename not in {row["file"] for row in offered}:
            raise ValueError("模型选择的图片不在本次提供的图库候选中")
        self._path(filename)
        return filename

    def prepare(self, filename):
        if filename not in {row["file"] for row in self.reader()}:
            raise ValueError("图片不属于共享图库")
        path = self._path(filename)
        data = path.read_bytes()
        if not 0 < len(data) <= 10 * 1024 * 1024:
            raise ValueError("图库图片为空或超过 10 MiB 传输限制")
        with Image.open(path) as image:
            if image.format not in ("PNG", "JPEG", "GIF", "WEBP"):
                raise ValueError("不支持该图库图片格式")
            width, height = image.size
            if width <= 0 or height <= 0 or width * height > 25_000_000:
                raise ValueError("图库图片尺寸超过传输限制")
            if image.format == "WEBP":
                self.cache_dir.mkdir(parents=True, exist_ok=True)
                converted = self.cache_dir / (hashlib.sha256(data).hexdigest() + ".png")
                if not converted.exists():
                    temporary = converted.with_suffix(".tmp")
                    image.convert("RGBA").save(temporary, format="PNG")
                    os.replace(temporary, converted)
                path = converted
        return {"file": filename, "path": str(path), "width": width, "height": height}

    def mark(self, filename):
        self.mark_used(filename)
