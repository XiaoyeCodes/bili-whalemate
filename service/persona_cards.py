"""Store reusable persona prompts and independently selected channel cards."""
import json
import time
import uuid


def legacy_prompt(data):
    """Keep the previous persona readable as an editable card."""
    raw = str(data.get("identity") or "").strip()
    try:
        identity = json.loads(raw) if raw else {}
    except ValueError:
        identity = {}
    if not isinstance(identity, dict):
        identity = {}
    fields = (("name", "名字"), ("self_call", "自称"), ("user_call", "称呼用户"),
              ("personality", "脾气"), ("speaking", "说话方式"), ("free", "其他设定"))
    lines = [f"{label}：{identity[key]}" for key, label in fields if identity.get(key)]
    disabled = set(str(identity.get("taboo_off") or "").splitlines())
    taboos = [line for line in str(identity.get("taboo") or "").splitlines() if line.strip() and line.strip() not in disabled]
    if taboos:
        lines.append("不能做的事：\n" + "\n".join(taboos))
    if identity.get("ai_flavor_on") is not False and identity.get("ai_flavor"):
        lines.append("说话风格：" + str(identity["ai_flavor"]))
    if identity.get("self_call_in_speech") is not True:
        lines.append("日常说话使用‘我’作为自称。")
    if identity.get("think_cn"):
        lines.append("思考用中文。")
    if identity.get("think_ds"):
        lines.append("思考时先拆开关键点，再简洁地得出结论。")
    identity_text = "\n".join(lines)
    if not identity_text:
        identity_text = raw
    return "\n\n".join(x for x in (identity_text, str(data.get("constitution") or "").strip(),
                                     str(data.get("self_image") or "").strip()) if x) or "请在这里填写人物设定。"


def initialize(conn, old):
    """Create the previous persona card only for an uninitialized library."""
    with conn:
        if conn.execute("SELECT 1 FROM persona_card LIMIT 1").fetchone():
            return
        now = time.time()
        conn.execute("INSERT INTO persona_card VALUES (?, ?, ?, ?, ?)", ("legacy", "原有人设", legacy_prompt(old), now, now))
        conn.executemany("INSERT INTO persona_channel VALUES (?, ?)", [("qq", "legacy"), ("bili", "legacy")])


def read(conn):
    cards = [dict(row) for row in conn.execute("SELECT id,name,prompt,created_at,updated_at FROM persona_card ORDER BY created_at,id")]
    active = {row["channel"]: row["card_id"] for row in conn.execute("SELECT channel,card_id FROM persona_channel")}
    if set(active) != {"qq", "bili"} or any(value not in {card["id"] for card in cards} for value in active.values()):
        raise ValueError("人物卡渠道配置不完整")
    return {"ok": True, "cards": cards, "active": active}


def change(conn, body):
    """Apply one card or channel change atomically."""
    if not isinstance(body, dict):
        raise ValueError("请求格式不正确")
    action = body.get("action")
    changed_id = None
    with conn:
        if action in ("create", "update"):
            name, prompt = body.get("name"), body.get("prompt")
            if not isinstance(name, str) or not name.strip() or len(name) > 80:
                raise ValueError("人物卡名称需要 1 到 80 个字")
            if not isinstance(prompt, str) or not prompt.strip() or len(prompt) > 30000:
                raise ValueError("人物提示词需要 1 到 30000 个字符")
            if action == "create":
                card_id = uuid.uuid4().hex
                now = time.time()
                conn.execute("INSERT INTO persona_card VALUES (?, ?, ?, ?, ?)", (card_id, name.strip(), prompt, now, now))
            else:
                card_id = body.get("id")
                result = conn.execute("UPDATE persona_card SET name=?,prompt=?,updated_at=? WHERE id=?",
                                      (name.strip(), prompt, time.time(), card_id))
                if result.rowcount != 1:
                    raise ValueError("人物卡不存在")
            changed_id = card_id
        elif action == "select":
            channel, card_id = body.get("channel"), body.get("id")
            if channel not in ("qq", "bili") or not isinstance(card_id, str):
                raise ValueError("渠道或人物卡无效")
            if not conn.execute("SELECT 1 FROM persona_card WHERE id=?", (card_id,)).fetchone():
                raise ValueError("人物卡不存在")
            conn.execute("UPDATE persona_channel SET card_id=? WHERE channel=?", (card_id, channel))
        elif action == "delete":
            card_id = body.get("id")
            if conn.execute("SELECT 1 FROM persona_channel WHERE card_id=?", (card_id,)).fetchone():
                raise ValueError("这张卡正在使用，请先为相关渠道选择其他人物卡")
            if conn.execute("DELETE FROM persona_card WHERE id=?", (card_id,)).rowcount != 1:
                raise ValueError("人物卡不存在")
        else:
            raise ValueError("不支持的人物卡操作")
    return {**read(conn), **({"changed_id": changed_id} if changed_id else {})}
