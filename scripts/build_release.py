"""Build a complete release archive from audited source and verified gallery assets."""
import hashlib
import json
from pathlib import Path
import subprocess
import zipfile
from audit_public import ROOT, audit_entries, repository_entries, seed_privacy
from setup import verify_gallery


def main():
    seed_privacy()
    entries = list(repository_entries())
    audit_entries(entries)
    verify_gallery(ROOT / "gallery")
    manifest = json.loads((ROOT / "seed/gallery-manifest.json").read_text(encoding="utf-8"))
    entries.extend(("gallery/" + row["file"], (ROOT / "gallery" / row["file"]).read_bytes()) for row in manifest)
    audit_entries(entries)
    version = json.loads((ROOT / "package.json").read_text(encoding="utf-8"))["version"]
    dist = ROOT / "dist"
    dist.mkdir(exist_ok=True)
    path = dist / f"bili-whalemate-v{version}.zip"
    with zipfile.ZipFile(path, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=6) as archive:
        for name, data in sorted(entries):
            archive.writestr("bili-whalemate/" + name, data)
    digest = hashlib.sha256(path.read_bytes()).hexdigest()
    (dist / "SHA256SUMS").write_text(f"{digest}  {path.name}\n", encoding="ascii")
    print(json.dumps({"archive": str(path), "sha256": digest, "files": len(entries), "bytes": path.stat().st_size}))


if __name__ == "__main__":
    main()
