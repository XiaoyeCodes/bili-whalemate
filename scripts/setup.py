"""Seed approved settings and stickers; preserve all target-machine account data."""
import argparse
import copy
import hashlib
import json
import os
from pathlib import Path
import re
import secrets
import shutil
import sys
import time

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "service"))


def load(path):
    return json.loads(Path(path).read_text(encoding="utf-8-sig"))


def save(path, value):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    temp = path.with_suffix(path.suffix + ".tmp")
    temp.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    temp.chmod(0o600)
    os.replace(temp, path)


def defaults(seed, current):
    """Add only absent dictionary keys; existing false, zero and empty values survive."""
    if not isinstance(seed, dict) or not isinstance(current, dict):
        return copy.deepcopy(current)
    result = copy.deepcopy(seed)
    for key, value in current.items():
        result[key] = defaults(seed[key], value) if key in seed else copy.deepcopy(value)
    return result


def checked_name(name):
    if not isinstance(name, str) or not name or Path(name).name != name or "/" in name or "\\" in name or ":" in name or name in (".", ".."):
        raise ValueError("Invalid gallery filename")
    return name


def verify_gallery(source):
    manifest = load(ROOT / "seed/gallery-manifest.json")
    catalogue = load(ROOT / "seed/gallery.json")
    if len({r['file'] for r in manifest}) != len(manifest) or {r['file'] for r in manifest} != {r['file'] for r in catalogue}:
        raise ValueError("Gallery manifest and catalogue differ")
    for row in manifest:
        path = Path(source) / checked_name(row["file"])
        if path.is_symlink() or not path.is_file() or path.stat().st_size != row["bytes"] or hashlib.sha256(path.read_bytes()).hexdigest() != row["sha256"]:
            raise ValueError("Gallery integrity check failed: " + row["file"])
    return catalogue


def profile_settings(home, profile, media):
    """Edit YAML nodes so existing credentials and !!js expressions retain their values."""
    import yaml
    from yaml.nodes import ScalarNode, MappingNode, SequenceNode
    path = home / "profiles" / profile / "cordis.patch.yml"
    original = path.read_text(encoding="utf-8-sig") if path.exists() else "[]\n"
    tree = yaml.compose(original)
    if tree is None:
        tree = SequenceNode("tag:yaml.org,2002:seq", [])
    if not isinstance(tree, SequenceNode):
        raise ValueError("Profile patch must be a YAML sequence")
    def field(node, key):
        return next((v for k, v in node.value if k.value == key), None) if isinstance(node, MappingNode) else None
    def put(node, key, value):
        for i, (k, _) in enumerate(node.value):
            if k.value == key:
                node.value[i] = (k, value)
                return
        node.value.append((ScalarNode("tag:yaml.org,2002:str", key), value))
    rows = list(tree.value)
    for row in tree.value:
        inserted = field(row, "insert")
        if isinstance(inserted, SequenceNode):
            rows.extend(inserted.value)
    def merge_missing(current, seed):
        for key, value in seed.value:
            existing = field(current, key.value)
            if existing is None:
                current.value.append((key, value))
            elif isinstance(existing, MappingNode) and isinstance(value, MappingNode):
                merge_missing(existing, value)
    for plugin, settings in load(ROOT / "seed/profile-settings.json").items():
        row = next((row for row in rows if getattr(field(row, "id"), "value", None) == plugin), None)
        if row is None:
            row = yaml.compose(yaml.safe_dump({"id": plugin, "config": {}}, allow_unicode=True))
            if plugin == "im-qqbot":
                put(row, "config", yaml.compose("appId: __FROM_ENV__\nappSecret: __FROM_ENV__\n"))
            tree.value.append(row)
            rows.append(row)
        config_node = field(row, "config")
        if config_node is None:
            config_node = MappingNode("tag:yaml.org,2002:map", [])
            put(row, "config", config_node)
        if not isinstance(config_node, MappingNode):
            raise ValueError("Profile configuration is computed; cannot add settings defaults")
        merge_missing(config_node, yaml.compose(yaml.safe_dump(settings, allow_unicode=True)))
    qq = next((row for row in rows if getattr(field(row, "id"), "value", None) == "im-qqbot"), None)
    if qq is None:
        qq = yaml.compose("id: im-qqbot\nconfig:\n  appId: __FROM_ENV__\n  appSecret: __FROM_ENV__\n  preset: standard\n  directPrompt: ''\n  groupPrompt: ''\n  requireMention: true\n  access:\n    c2cMode: open\n    groupMode: disabled\n")
        tree.value.append(qq)
    config = field(qq, "config")
    if config is None:
        config = MappingNode("tag:yaml.org,2002:map", [])
        put(qq, "config", config)
    if not isinstance(config, MappingNode):
        raise ValueError("QQ configuration is computed; add the gallery sendFile path manually before installation")
    send = field(config, "sendFile")
    if send is None:
        send = yaml.compose("restrictPaths: true\nextraRoots: []\n")
        put(config, "sendFile", send)
    if not isinstance(send, MappingNode):
        raise ValueError("QQ sendFile configuration must be a YAML mapping")
    extra = field(send, "extraRoots")
    if extra is None:
        extra = SequenceNode("tag:yaml.org,2002:seq", [])
        put(send, "extraRoots", extra)
    if not isinstance(extra, SequenceNode):
        raise ValueError("QQ sendFile.extraRoots must be a YAML list")
    if str(media) not in [r.value for r in extra.value]:
        extra.value.append(ScalarNode("tag:yaml.org,2002:str", str(media)))
    result = yaml.serialize(tree, allow_unicode=True)
    if result != original:
        path.parent.mkdir(parents=True, exist_ok=True)
        backup = path.with_name("cordis.patch.before-whalemate.yml")
        if path.exists() and not backup.exists():
            shutil.copy2(path, backup)
        temp = path.with_suffix(".tmp")
        temp.write_text(result, encoding="utf-8")
        os.replace(temp, path)


def setup(home, profile, python, node, gallery, port=8080, bridge_port=3081):
    if not re.fullmatch(r"[A-Za-z0-9_-]+", profile) or not 1024 <= port <= 65535 or not 1024 <= bridge_port <= 65535 or port == bridge_port:
        raise ValueError("Invalid profile name or service ports")
    runtime_path = home / "whalemate/runtime.json"
    if runtime_path.exists() and load(runtime_path).get("profile") != profile:
        raise ValueError("Whalemate already belongs to another profile in this DSH_HOME; use a separate DSH_HOME")
    catalogue = verify_gallery(gallery)  # Verify everything before changing target data.
    from memory_core import MemoryStore
    data, media = home / "remembers-data", home / "media/whalemate"
    data.mkdir(parents=True, exist_ok=True)
    media.mkdir(parents=True, exist_ok=True)
    store = MemoryStore(data / "memories.db")
    try:
        persona = load(ROOT / "seed/persona.json")
        current = store.get_persona()
        # Existing persona choices survive reinstallation, including an intentionally empty field.
        marker = home / "whalemate/seeded.json"
        if not marker.exists() and not any(current.get(k) for k in ("constitution", "identity", "self_image", "self_model")):
            store.set_persona(**persona)
            quiet = load(ROOT / "seed/state-settings.json")
            store.conn.execute("UPDATE state SET dnd_start=?,dnd_end=? WHERE id=1", (quiet["dnd_start"], quiet["dnd_end"]))
        with store.conn:
            if not store.conn.execute("SELECT 1 FROM persona_card LIMIT 1").fetchone():
                library = load(ROOT / "seed/persona-cards.json")
                now = time.time()
                for index, card in enumerate(library["cards"]):
                    store.conn.execute("INSERT INTO persona_card VALUES(?,?,?,?,?)", (card["id"], card["name"], card["prompt"], now + index / 1000, now))
                store.conn.executemany("INSERT INTO persona_channel VALUES(?,?)", library["active"].items())
            for row in catalogue:
                dest = media / row["file"]
                if not dest.exists():
                    shutil.copy2(Path(gallery) / row["file"], dest)
                store.conn.execute("INSERT OR IGNORE INTO meme(file,emotion,caption,keywords,pack) VALUES(?,?,?,?,?)",
                    tuple(row[k] for k in ("file", "emotion", "caption", "keywords", "pack")))
    finally:
        store.conn.close()
    for name in ("proactive.json", "bili.json", "bili_tools.json"):
        target = data / name
        seed = load(ROOT / "seed" / name)
        save(target, defaults(seed, load(target)) if target.exists() else seed)
    packs_path = data / "meme-packs.json"
    packs = load(packs_path) if packs_path.exists() else []
    packs.extend(p for p in load(ROOT / "seed/meme-packs.json") if p["id"] not in {r["id"] for r in packs})
    save(packs_path, packs)
    target = home / "bili-whale.config.json"
    save(target, defaults(load(ROOT / "seed/bili-whale.config.json"), load(target)) if target.exists() else load(ROOT / "seed/bili-whale.config.json"))
    target = data / "config.json"
    env = load(ROOT / "seed/environment.json")
    config_seed = {k.removeprefix("CMEM_").lower(): v for k,v in env.items() if k not in ("CMEM_MEME_MATCH_TIMEOUT_MS",)}
    config_seed.update(load(ROOT / "seed/service-settings.json"))
    save(target, defaults(config_seed, load(target)) if target.exists() else config_seed)
    bridge = home / "remembers-service/official-qq-bridge.json"
    if not bridge.exists():
        save(bridge, {"port": bridge_port, "token": secrets.token_urlsafe(48), "pairingCode": secrets.token_hex(4),
            "ownerOpenId": "", "maxMessageChars": 10000, "jobTimeoutMs": 180000, "maxHistoryEntries": 200,
            "journalPath": str(data / "qq-automation-events.jsonl")})
    bridge_config = load(bridge)
    save(bridge, {**bridge_config, "serviceEndpoint": f"http://127.0.0.1:{port}", "memeDir": str(media)})
    runtime = home / "whalemate/runtime.json"
    current_runtime = load(runtime) if runtime.exists() else {}
    # Explicit setup arguments select paths/ports; secrets live in separate files and are untouched.
    save(runtime, {**current_runtime, "python": str(python), "node": str(node), "profile": profile, "port": port, "startupTimeoutMs": 30000})
    profile_settings(home, profile, media)
    save(home / "whalemate/seeded.json", {"version": "1.1.0", "galleryCount": len(catalogue)})
    return {"ok": True, "galleryCount": len(catalogue), "profile": profile, "port": port, "needsLocalAccounts": True}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--home", type=Path, required=True)
    parser.add_argument("--profile", required=True)
    parser.add_argument("--python", required=True)
    parser.add_argument("--node", required=True)
    parser.add_argument("--gallery", type=Path, default=ROOT / "gallery")
    parser.add_argument("--port", type=int, default=8080)
    parser.add_argument("--bridge-port", type=int, default=3081)
    args = parser.parse_args()
    print(json.dumps(setup(args.home.resolve(), args.profile, args.python, args.node, args.gallery, args.port, args.bridge_port)))
