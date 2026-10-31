"""Restore missing gallery assets from the matching public release, with hash checks."""
import hashlib
import json
from pathlib import Path
import shutil
import tempfile
from urllib.request import urlopen
import zipfile

from setup import ROOT, checked_name, load, verify_gallery


def fetch_gallery():
    target = ROOT / "gallery"
    try:
        return len(verify_gallery(target))
    except ValueError:
        pass
    version = load(ROOT / "package.json")["version"]
    asset = f"bili-whalemate-v{version}.zip"
    base = f"https://github.com/XiaoyeCodes/bili-whalemate/releases/download/v{version}"
    checksums = urlopen(base + "/SHA256SUMS", timeout=60).read().decode("ascii")
    expected = next((line.split()[0] for line in checksums.splitlines() if line.endswith("  " + asset)), "")
    if len(expected) != 64 or any(c not in "0123456789abcdef" for c in expected):
        raise ValueError("Release gallery checksum is missing or invalid")
    with tempfile.TemporaryDirectory(prefix="whalemate-gallery-") as temp:
        path = Path(temp) / asset
        print(f"Downloading gallery from v{version}…", flush=True)
        with urlopen(base + "/" + asset, timeout=120) as response, path.open("wb") as out:
            shutil.copyfileobj(response, out)
        with path.open("rb") as source:
            if hashlib.file_digest(source, "sha256").hexdigest() != expected:
                raise ValueError("Gallery archive checksum mismatch")
        staged = Path(temp) / "gallery"
        staged.mkdir()
        with zipfile.ZipFile(path) as archive:
            for row in load(ROOT / "seed/gallery-manifest.json"):
                name = checked_name(row["file"])
                info = archive.getinfo("bili-whalemate/gallery/" + name)
                if info.file_size != row["bytes"]:
                    raise ValueError("Gallery entry size mismatch")
                content = archive.read(info)
                if hashlib.sha256(content).hexdigest() != row["sha256"]:
                    raise ValueError("Gallery entry checksum mismatch")
                (staged / name).write_bytes(content)
        verify_gallery(staged)
        target.mkdir(exist_ok=True)
        for file in staged.iterdir():
            shutil.copy2(file, target / file.name)
    return len(verify_gallery(target))


if __name__ == "__main__":
    print(json.dumps({"ok": True, "galleryCount": fetch_gallery()}))
