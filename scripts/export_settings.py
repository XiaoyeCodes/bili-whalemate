"""Export approved prompts/settings only; never copy accounts or runtime history."""
import argparse
from contextlib import closing
import json
import os
from pathlib import Path
import sqlite3
import subprocess
import sys

from setup import ROOT, load, save

sys.path.insert(0, str(ROOT / "service"))
from bili_automation import validate_config

SERVICE_DEFAULTS = {
    "llm_base": "https://api.deepseek.com/v1", "llm_model": "deepseek-flash", "llm_timeout": 60,
    "embed_base": "", "embed_model": "", "embed_timeout": 20, "embed_batch": 16,
    "extract": True, "extract_max_facts": 6, "extract_neighbors": 5,
    "surprisal_threshold": 0.35, "emotion_threshold": 0.2,
    "diary_enabled": True, "evolve_enabled": True, "episode_enabled": True,
}
PROFILE_FIELDS = {
    "dsh-remembers": {k: True for k in (
        "recallTopK", "recallMinChars", "injectProfile", "captureRaw", "captureMinChars", "extract",
        "skipSubagentSessions", "timeoutMs", "logRequests", "personaEnabled", "personaOrder", "personaMaxChars",
        "personaRefreshMs", "personaAllowWrite", "episodeEnabled", "episodeEveryTurns", "episodeMaxMinutes", "memeMatchTimeoutMs")},
    "im-qqbot": {
        "preset": True, "directPrompt": True, "groupPrompt": True, "requireMention": True,
        "access": {"c2cMode": True, "groupMode": True},
        "vision": {k: True for k in ("enabled", "defaultPrompt", "maxBytes", "maxTokens", "model", "provider", "timeoutMs")},
        "media": {"enabled": True},
    },
    "llm-deepseek": {"retryPolicy": {"mode": True, "maxRetries": True}},
}
BILI_FIELDS = {
    "persona": {k: True for k in ("ownerTitle", "selfClaim", "name")},
    "preferences": {"like": [True], "dislike": [True]},
    "night": {k: True for k in ("skipChance", "maxVideos", "minGapMin")},
    "quota": {"shareDaily": True}, "share": {"minScore": True, "enabled": True},
    "risk": {"writeDaily": True, "writeHourly": True},
}
PROACTIVE_FIELDS = {k: True for k in (
    "enabled", "startHour", "endHour", "minGapMinutes", "maxGapMinutes", "silentRatio", "talkEnabled",
    "minChatBeforeWake", "wakePreset", "wakeActionCount", "autoScheduleEnabled", "autoSchedulePrompt",
    "autoShareEnabled", "autoSharePrompt", "biliBrowseEnabled", "biliMinGapMinutes", "biliMaxGapMinutes",
    "biliBrowseLimit", "biliBrowsePerDay", "biliShareToOwner", "biliShareToGroup", "biliComment",
    "biliMentionOwner", "textStyleEnabled", "kaomojiRate", "memeRate", "emojiRate")}
PROACTIVE_FIELDS.update({k: [{"text": True, "enabled": True}] for k in ("silentActions", "talkActions")})


def select(value, fields):
    """Unknown keys are omitted; an approved scalar cannot hide a nested object."""
    if isinstance(fields, dict):
        if not isinstance(value, dict):
            raise ValueError("Expected a settings object")
        return {k: select(value[k], schema) for k, schema in fields.items() if k in value}
    if isinstance(fields, list):
        if not isinstance(value, list):
            raise ValueError("Expected a settings list")
        return [select(item, fields[0]) for item in value]
    if not isinstance(value, (str, int, float, bool, type(None))):
        raise ValueError("Expected a scalar setting")
    return value


def profile_snapshot(path):
    import yaml
    tree = yaml.compose(path.read_text(encoding="utf-8-sig"))
    if tree is None:
        return {}
    if not isinstance(tree, yaml.SequenceNode):
        raise ValueError("Profile must be a YAML sequence")
    result = {}
    def visit(rows):
        for row in rows:
            if not isinstance(row, yaml.MappingNode):
                continue
            fields = {k.value: v for k, v in row.value}
            if "insert" in fields and isinstance(fields["insert"], yaml.SequenceNode):
                visit(fields["insert"].value)
            plugin = getattr(fields.get("id"), "value", "")
            config = fields.get("config")
            if plugin not in PROFILE_FIELDS or not isinstance(config, yaml.MappingNode):
                continue
            # Only approved nodes are deserialized; computed/secret sibling nodes are never evaluated.
            def approved(node, schema):
                if isinstance(schema, dict):
                    if not isinstance(node, yaml.MappingNode):
                        raise ValueError("Computed profile settings cannot be exported")
                    return {k.value: approved(v, schema[k.value]) for k, v in node.value if k.value in schema}
                return select(yaml.safe_load(yaml.serialize(node)), True)
            result[plugin] = approved(config, PROFILE_FIELDS[plugin])
    visit(tree.value)
    return result


def snapshot(home, profile, env=None):
    home = Path(home).resolve()
    env = os.environ if env is None else env
    data = home / "remembers-data"
    bili = load(home / "bili-whale.config.json")
    clean_bili = select(bili, BILI_FIELDS)
    clean_bili["owner"] = {"mid": "", "name": ""}
    clean_bili["automation"] = validate_config(bili.get("automation"))
    config = load(data / "config.json") if (data / "config.json").exists() else {}
    profile_settings = profile_snapshot(home / "profiles" / profile / "cordis.patch.yml")
    # Resolve actual plugin defaults with the same code as Harness. Emit only approved values.
    program = "import fs from 'node:fs'; import {resolveConfig} from " + json.dumps((ROOT / "config.mjs").as_uri()) + "; const x=JSON.parse(fs.readFileSync(0,'utf8')); const c=resolveConfig(x.input,x.env); console.log(JSON.stringify(Object.fromEntries(x.fields.map(k=>[k,c[k]]))));"
    plugin_env = {k: v for k, v in env.items() if k.startswith('CMEM_') and not any(s in k for s in ('KEY', 'TOKEN', 'SUBJECT'))}
    profile_settings["dsh-remembers"] = json.loads(subprocess.check_output(
        ["node", "--input-type=module", "-e", program], input=json.dumps({"input": profile_settings.get("dsh-remembers", {}), "env": plugin_env, "fields": list(PROFILE_FIELDS["dsh-remembers"])}), text=True, encoding="utf-8"))
    service = {}
    for key, fallback in SERVICE_DEFAULTS.items():
        value = config.get(key, env.get("CMEM_" + key.upper(), fallback))
        service[key] = str(value).lower() in ("1", "true", "yes", "on") if isinstance(fallback, bool) else type(fallback)(value)
    with closing(sqlite3.connect((data / "memories.db").as_uri() + "?mode=ro", uri=True)) as db:
        db.row_factory = sqlite3.Row
        db.execute("BEGIN")
        persona = dict(db.execute("SELECT constitution,self_image,identity FROM persona WHERE id=1").fetchone())
        cards = [dict(row) for row in db.execute("SELECT id,name,prompt FROM persona_card ORDER BY created_at,id")]
        active = dict(db.execute("SELECT channel,card_id FROM persona_channel WHERE channel IN ('qq','bili')"))
        if not cards or set(active) != {"qq", "bili"} or any(v not in {c['id'] for c in cards} for v in active.values()):
            raise ValueError("Persona card selections are incomplete")
        quiet = dict(db.execute("SELECT dnd_start,dnd_end FROM state WHERE id=1").fetchone())
        gallery = [dict(row) for row in db.execute("SELECT file,emotion,caption,keywords,pack FROM meme ORDER BY id")]
    return {
        "persona.json": persona, "persona-cards.json": {"cards": cards, "active": active},
        "state-settings.json": quiet, "gallery.json": gallery,
        "meme-packs.json": select(load(data / "meme-packs.json"), [{"id": True, "name": True}]),
        "bili-whale.config.json": clean_bili,
        "proactive.json": select(load(data / "proactive.json"), PROACTIVE_FIELDS),
        "bili.json": select(load(data / "bili.json"), {"enabled": True}),
        "bili_tools.json": select(load(data / "bili_tools.json"), {k: True for k in ("comment", "dynamic-image", "edit-dynamic", "dm", "web-video-reader")}),
        "service-settings.json": service,
        "profile-settings.json": profile_settings,
        "environment.json": {"CMEM_" + k.upper(): str(int(service[k])) if isinstance(service[k], bool) else str(service[k])
                             for k in ("llm_base", "llm_model", "llm_timeout", "extract")},
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--home", type=Path, default=Path(os.environ.get("DSH_HOME", Path.home() / ".dsh")))
    parser.add_argument("--profile", default="web")
    parser.add_argument("--output", type=Path, default=ROOT / "seed")
    args = parser.parse_args()
    settings = snapshot(args.home, args.profile)
    for name, value in settings.items():
        save(args.output / name, value)
    print(json.dumps({"ok": True, "settingsFiles": len(settings), "personaCards": len(settings["persona-cards.json"]["cards"]), "accountsExcluded": True}))


if __name__ == "__main__":
    main()
