"""Audit distributable files and seeds without reading any local credentials."""
import argparse
import json
from pathlib import Path
import re
import subprocess
import zipfile

ROOT = Path(__file__).resolve().parent.parent
FORBIDDEN_NAMES = {"credentials.json", "runtime.json", "official-qq-bridge.json", ".env", "user_profile.json"}
PATTERNS = [
    re.compile(rb"(?:sk-|github_pat_|gh[pousr]_)[A-Za-z0-9_-]{16,}"),
    re.compile(rb"https?://[^\s/]+:[^\s/@]+@"),
    re.compile(rb"-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----"),
]


def audit_entries(entries):
    count, errors = 0, []
    for name, data in entries:
        count += 1
        path = Path(name)
        if path.is_absolute() or ".." in path.parts:
            errors.append(name + ": unsafe archive path")
        if path.name in FORBIDDEN_NAMES or path.suffix.lower() in (".db", ".sqlite3", ".log", ".jsonl", ".pyc") or any(p in (".git", "node_modules", "__pycache__", "sessions") for p in path.parts):
            errors.append(name + ": excluded private/runtime file")
        if any(pattern.search(data) for pattern in PATTERNS):
            errors.append(name + ": possible credential")
    if errors:
        raise ValueError("\n".join(errors))
    return count


def repository_entries():
    files = subprocess.check_output(["git", "ls-files", "--cached", "--others", "--exclude-standard", "-z"], cwd=ROOT).decode().split("\0")
    return ((name, (ROOT / name).read_bytes()) for name in sorted(set(filter(None, files))) if (ROOT / name).is_file())


def seed_privacy():
    load = lambda name: json.loads((ROOT / "seed" / name).read_text(encoding="utf-8-sig"))
    assert set(load("persona.json")) == {"constitution", "self_image", "identity"}, "Unexpected persona fields"
    assert load("bili-whale.config.json")["owner"] == {"mid": "", "name": ""}, "Owner identity was exported"
    assert not any(any(s in k.lower() for s in ("key", "token", "secret")) for k in load("environment.json")), "Secret environment field exported"
    assert all(set(row) == {"file", "caption", "emotion", "keywords", "pack"} for row in load("gallery.json")), "Unexpected gallery fields"


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--archive", type=Path)
    args = parser.parse_args()
    seed_privacy()
    if args.archive:
        with zipfile.ZipFile(args.archive) as archive:
            count = audit_entries((i.filename, archive.read(i)) for i in archive.infolist() if not i.is_dir())
    else:
        count = audit_entries(repository_entries())
    print(json.dumps({"ok": True, "filesScanned": count, "privateSeedFields": "excluded"}))


if __name__ == "__main__":
    main()
