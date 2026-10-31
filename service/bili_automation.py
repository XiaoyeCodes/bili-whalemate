"""One Bilibili activity controller with persistent random daily targets and receipts."""
from __future__ import annotations

import copy
import datetime as dt
import json
import random
import sqlite3
import threading
import time
import uuid
from pathlib import Path
from life_context import LIFE_DEFAULTS, validate_life

KINDS = ("browse", "recommend", "comment", "interact", "dmReply", "strangerReply", "ownerReply", "dynamic")
ALL_KINDS = KINDS + ("strangerNotice",)
PUBLIC_KINDS = ("recommend", "comment", "interact")
SHANGHAI = dt.timezone(dt.timedelta(hours=8), "Asia/Shanghai")
SCHEMA_VERSION = 5
LIMIT_REPLY_TEXT = "token快要用完啦，我的主人不让我回答啦"
DEFAULT_AUTOMATION = {
    "managed": False, "enabled": False,
    "features": {**{kind: True for kind in KINDS}, "strangerReply": False, "ownerReply": False, "dynamic": False},
    "daily": {"browse": {"min": 6, "max": 10}, "recommend": {"min": 1, "max": 2},
              "comment": {"min": 0, "max": 2}, "interact": {"min": 0, "max": 1}, "dynamic": {"min": 1, "max": 3}},
    "actionProbability": {"recommend": 50, "comment": 50, "interact": 50},
    "lifePosts": LIFE_DEFAULTS,
    "dmDailyMax": 20, "dmPollSeconds": 60, "dmRequireMention": False, "dmAllDay": True, "maxDmAttempts": 3,
    "strangerDailyMax": 5, "strangerPollSeconds": 60, "strangerAllDay": True, "strangerBatchSize": 3,
    "replyThinkingEnabled": False,
    "ownerCommentDailyMax": 20,
    "maxCommentSendAttempts": 3,
    "pictureVerifySeconds": 45, "pictureVerifyPollSeconds": 5,
    "startHour": 8, "endHour": 23, "minGapMinutes": 10, "maxGapMinutes": 30,
    "minInterestingScore": 13, "notifyQq": True,
    "requestTimeoutSeconds": 90, "writeWaitSeconds": 180, "contentMaxChars": 10000, "historyDays": 7, "retryDelayMinutes": 15,
}


def validate_config(value: dict | None) -> dict:
    """Merge and validate saved/wire configuration without silently accepting bad ranges."""
    if value is None:
        value = {}
    if not isinstance(value, dict) or set(value) - set(DEFAULT_AUTOMATION) - {'maxDraftChars'}:
        raise ValueError("B 站自动活动配置包含未知字段或不是对象")
    cfg = copy.deepcopy(DEFAULT_AUTOMATION)
    for key, item in value.items():
        if key == 'maxDraftChars':
            continue  # Accept saved legacy settings without imposing a draft length cap.
        if key == "features":
            if not isinstance(item, dict) or set(item) - set(KINDS):
                raise ValueError("B 站功能开关包含未知字段")
            cfg[key].update(item)
        elif key == "actionProbability":
            if not isinstance(item, dict) or set(item) - set(PUBLIC_KINDS):
                raise ValueError("公开活动概率包含未知项目")
            if any(type(chance) is not int or not 1 <= chance <= 100 for chance in item.values()):
                raise ValueError("公开活动抽签概率须填写 1～100 的整数；关闭活动请使用对应开关")
            cfg[key].update(item)
        elif key == "lifePosts":
            cfg[key] = validate_life(item)
        elif key == "daily":
            if not isinstance(item, dict) or set(item) - set(PUBLIC_KINDS + ("browse", "dynamic")):
                raise ValueError("每日数量配置包含未知项目")
            for kind, limits in item.items():
                if not isinstance(limits, dict) or set(limits) != {"min", "max"}:
                    raise ValueError("每日数量必须同时填写最小值和最大值")
                cfg[key][kind] = dict(limits)
        else:
            cfg[key] = item
    for key in ("managed", "enabled", "dmRequireMention", "dmAllDay", "notifyQq", "replyThinkingEnabled"):
        if type(cfg[key]) is not bool:
            raise ValueError(f"{key} 必须是开关")
    if type(cfg["strangerAllDay"]) is not bool:
        raise ValueError("strangerAllDay 必须是开关")
    if any(type(v) is not bool for v in cfg["features"].values()):
        raise ValueError("功能开关必须为布尔值")
    for kind, limits in cfg["daily"].items():
        if any(type(v) is not int for v in limits.values()) or not 0 <= limits["min"] <= limits["max"] <= 500:
            raise ValueError(f"{kind} 每日数量须满足 0 ≤ 最小值 ≤ 最大值 ≤ 500")
        if kind == 'dynamic' and limits['max'] > 20:
            raise ValueError('碎碎念每天最多 20 条')
    bounds = {"dmDailyMax": (0, 500), "dmPollSeconds": (15, 3600), "startHour": (0, 23), "endHour": (1, 24),
              "strangerDailyMax": (0, 500), "strangerPollSeconds": (15, 3600),
              "ownerCommentDailyMax": (0, 500),
              "maxCommentSendAttempts": (1, 10),
              "pictureVerifySeconds": (0, 180), "pictureVerifyPollSeconds": (1, 30),
              "strangerBatchSize": (1, 20),
              "minGapMinutes": (1, 1440), "maxGapMinutes": (1, 1440), "minInterestingScore": (0, 20),
              "requestTimeoutSeconds": (10, 300), "contentMaxChars": (500, 30000),
              "writeWaitSeconds": (0, 600), "maxDmAttempts": (1, 10), "historyDays": (1, 365), "retryDelayMinutes": (1, 1440)}
    for key, (low, high) in bounds.items():
        if type(cfg[key]) is not int or not low <= cfg[key] <= high:
            label = {"dmPollSeconds": "私信检查间隔（秒）", "dmDailyMax": "私信每天最多回复数",
                     "strangerPollSeconds": "评论通知检查间隔（秒）", "strangerDailyMax": "陌生人每天最多 AI 回复数",
                     "ownerCommentDailyMax": "主人评论每天最多回复数", "strangerBatchSize": "每轮最多处理陌生人消息",
                     "startHour": "开始时刻", "endHour": "结束时刻", "minGapMinutes": "浏览最小间隔（分钟）",
                     "maxGapMinutes": "浏览最大间隔（分钟）", "minInterestingScore": "值得推荐的最低评分"}.get(key, key)
            raise ValueError(f"{label}须填写 {low}～{high} 的整数")
    if cfg["startHour"] >= cfg["endHour"]:
        raise ValueError("开始时间须早于结束时间")
    if cfg["minGapMinutes"] > cfg["maxGapMinutes"]:
        raise ValueError("最小间隔不能大于最大间隔")
    return cfg


def day_at(now: float) -> str:
    """Use the user's Shanghai date even when the process host uses another timezone."""
    return dt.datetime.fromtimestamp(now, SHANGHAI).date().isoformat()


class AutomationLedger:
    """Own daily targets and atomic activity reservations in a separate local database."""
    def __init__(self, path):
        Path(path).parent.mkdir(parents=True, exist_ok=True)
        self.lock = threading.RLock()
        self.conn = sqlite3.connect(str(path), check_same_thread=False)
        self.conn.row_factory = sqlite3.Row
        self.closed = False
        if self.conn.execute("PRAGMA user_version").fetchone()[0] > SCHEMA_VERSION:
            raise ValueError("自动活动数据库版本较新，请使用对应版本的服务")
        with self.conn:
            self.conn.executescript("""
                CREATE TABLE IF NOT EXISTS plans(day TEXT PRIMARY KEY, targets TEXT NOT NULL);
                CREATE TABLE IF NOT EXISTS actions(
                  id TEXT PRIMARY KEY, day TEXT NOT NULL, kind TEXT NOT NULL, target TEXT NOT NULL,
                  status TEXT NOT NULL, started REAL NOT NULL, ended REAL, result TEXT, error TEXT,
                  UNIQUE(day,kind,target));
                CREATE INDEX IF NOT EXISTS actions_day ON actions(day,kind,status);
                CREATE TABLE IF NOT EXISTS meta(key TEXT PRIMARY KEY,value TEXT NOT NULL);
                CREATE TABLE IF NOT EXISTS videos(bvid TEXT PRIMARY KEY,payload TEXT NOT NULL,status TEXT NOT NULL);
                CREATE TABLE IF NOT EXISTS incoming(key TEXT PRIMARY KEY,actor TEXT NOT NULL,received REAL NOT NULL,status TEXT NOT NULL,error TEXT);
            """)
            self.conn.execute("UPDATE actions SET status='unknown',error='进程在结果确认前退出，需核查后再执行' WHERE status='running'")
            self.conn.execute("UPDATE incoming SET status='unknown',error='进程在处理完成前退出，未自动重试' WHERE status='running'")
            if "attempts" not in {row[1] for row in self.conn.execute("PRAGMA table_info(actions)")}:
                self.conn.execute("ALTER TABLE actions ADD COLUMN attempts INTEGER NOT NULL DEFAULT 1")
            self.conn.execute(f"PRAGMA user_version={SCHEMA_VERSION}")

    def close(self):
        with self.lock:
            if not self.closed:
                self.conn.close()
                self.closed = True

    def plan(self, day, cfg):
        with self.lock, self.conn:
            row = self.conn.execute("SELECT targets FROM plans WHERE day=?", (day,)).fetchone()
            targets = json.loads(row[0]) if row else {}
            for kind, limits in cfg["daily"].items():
                if kind not in targets or not limits["min"] <= targets[kind] <= limits["max"]:
                    targets[kind] = random.randint(limits["min"], limits["max"])
            targets["dmReply"] = cfg["dmDailyMax"]
            targets["strangerReply"] = cfg["strangerDailyMax"]
            targets["ownerReply"] = cfg["ownerCommentDailyMax"]
            self.conn.execute("INSERT INTO plans VALUES(?,?) ON CONFLICT(day) DO UPDATE SET targets=excluded.targets",
                              (day, json.dumps(targets)))
            return targets

    def counts(self, day):
        with self.lock:
            out = {kind: {state: 0 for state in ("running", "success", "failed", "unknown")} for kind in ALL_KINDS}
            for row in self.conn.execute("SELECT kind,status,COUNT(*) n FROM actions WHERE day=? GROUP BY kind,status", (day,)):
                out[row["kind"]][row["status"]] = row["n"]
            return out

    def remaining(self, day, kind, cfg):
        with self.lock:
            if not cfg["enabled"] or not cfg["features"][kind]:
                return 0
            target = self.plan(day, cfg)[kind]
            counts = self.counts(day)[kind]
            consumed = sum(counts.values()) if kind in ("strangerReply", "ownerReply", "dynamic") else sum(counts[s] for s in ("success", "running", "unknown"))
            return max(0, target - consumed)

    def reserve(self, day, kind, target, cfg, now):
        with self.lock, self.conn:
            if self.remaining(day, kind, cfg) <= 0:
                return None
            previous = self.conn.execute("SELECT * FROM actions WHERE day=? AND kind=? AND target=?", (day, kind, target)).fetchone()
            if previous and kind == "dmReply" and previous["status"] == "failed":
                result = json.loads(previous["result"] or "{}")
                if now < result.get("retryAt", 0):
                    return None
                if previous["attempts"] >= cfg["maxDmAttempts"] or now - previous["started"] < cfg["retryDelayMinutes"] * 60:
                    return None
                self.conn.execute("UPDATE actions SET status='running',started=?,ended=NULL,error=NULL,attempts=attempts+1 WHERE id=?", (now, previous["id"]))
                return previous["id"]
            if kind in PUBLIC_KINDS:
                prior = self.conn.execute("SELECT 1 FROM actions WHERE target=? AND kind=? "
                    "AND status IN ('running','success','unknown') AND started>=?", (target, kind, now - cfg["historyDays"] * 86400)).fetchone()
                if prior:
                    return None
            action_id = str(uuid.uuid4())
            try:
                self.conn.execute("INSERT INTO actions(id,day,kind,target,status,started) VALUES(?,?,?,?,'running',?)",
                                  (action_id, day, kind, target, now))
            except sqlite3.IntegrityError:
                return None
            return action_id

    def finish(self, action_id, status, result=None, error=None):
        if status not in ("success", "failed", "unknown"):
            raise ValueError("Invalid action outcome")
        with self.lock, self.conn:
            self.conn.execute("UPDATE actions SET status=?,ended=?,result=?,error=? WHERE id=?",
                (status, time.time(), json.dumps(result or {}, ensure_ascii=False), error, action_id))

    def meta(self, key, default=None):
        with self.lock:
            row = self.conn.execute("SELECT value FROM meta WHERE key=?", (key,)).fetchone()
            return json.loads(row[0]) if row else default

    def set_meta(self, key, value):
        with self.lock, self.conn:
            self.conn.execute("INSERT INTO meta VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
                              (key, json.dumps(value, ensure_ascii=False)))

    def enqueue(self, videos):
        with self.lock, self.conn:
            for video in videos:
                self.conn.execute("INSERT OR IGNORE INTO videos VALUES(?,?,'new')", (video["bvid"], json.dumps(video, ensure_ascii=False)))

    def next_video(self):
        with self.lock:
            row = self.conn.execute("SELECT payload FROM videos WHERE status='new' ORDER BY rowid LIMIT 1").fetchone()
            return json.loads(row[0]) if row else None

    def video_done(self, bvid, payload, status):
        with self.lock, self.conn:
            self.conn.execute("UPDATE videos SET payload=?,status=? WHERE bvid=?", (json.dumps(payload, ensure_ascii=False), status, bvid))

    def events(self, limit=20):
        with self.lock:
            rows = self.conn.execute("SELECT * FROM actions ORDER BY started DESC,rowid DESC LIMIT ?", (limit,)).fetchall()
            return [{**dict(row), "result": json.loads(row["result"] or "{}")} for row in rows]

    def dynamic_history(self, limit=8):
        """Only this character's public or uncertain dynamic texts enter future draft context."""
        with self.lock:
            rows = self.conn.execute("SELECT result FROM actions WHERE kind='dynamic' AND status IN ('success','unknown') ORDER BY started DESC,rowid DESC LIMIT ?", (limit,)).fetchall()
            return [result for row in rows if (result := json.loads(row['result'] or '{}')).get('text')]

    def previous(self, kind, target):
        with self.lock:
            row = self.conn.execute("SELECT * FROM actions WHERE kind=? AND target=? ORDER BY started DESC LIMIT 1", (kind, target)).fetchone()
            return dict(row) if row else None

    def release_dm_budget_wait(self, now, retry_delay, max_attempts):
        """Release only a known unsent budget rejection whose retry is still scheduled."""
        with self.lock, self.conn:
            row = self.conn.execute("SELECT * FROM actions WHERE kind='dmReply' ORDER BY started DESC LIMIT 1").fetchone()
            if not row or row['status'] != 'failed' or row['attempts'] >= max_attempts or now - row['started'] < retry_delay:
                return False
            result = json.loads(row['result'] or '{}')
            scheduled = self.meta('next_dm_at', 0)
            if (result.get('submission') != 'not-sent' or result.get('reason') != 'write-budget'
                    or not result.get('retryAt') or scheduled != result['retryAt'] or scheduled <= now):
                return False
            result['retryAt'] = now
            self.conn.execute("UPDATE actions SET result=? WHERE id=?", (json.dumps(result, ensure_ascii=False), row['id']))
            self.conn.execute("INSERT INTO meta VALUES('next_dm_at',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value", (json.dumps(now),))
            self.conn.execute("INSERT INTO meta VALUES('dm_error','null') ON CONFLICT(key) DO UPDATE SET value=excluded.value")
            return True

    def incoming_seen(self, key):
        with self.lock:
            return self.conn.execute("SELECT 1 FROM incoming WHERE key=?", (key,)).fetchone() is not None

    def pending_comment_retries(self, now, cfg):
        """Return saved drafts only after a definite unsent, temporary transport failure."""
        with self.lock:
            rows = self.conn.execute("SELECT * FROM actions WHERE kind IN ('ownerReply','strangerReply','strangerNotice') AND status='failed' ORDER BY started,rowid").fetchall()
            pending = []
            for row in rows:
                result = json.loads(row['result'] or '{}')
                if (result.get('submission') == 'not-sent'
                        and result.get('reason') in ('cooldown', 'write-budget', 'platform-pause')
                        and result.get('retryPayload') and result.get('retryAt', float('inf')) <= now
                        and row['attempts'] < cfg['maxCommentSendAttempts']
                        and row['started'] >= now - cfg['historyDays'] * 86400):
                    pending.append({**dict(row), 'result': result})
            return pending

    def claim_comment_retry(self, action):
        """Reuse the charged generation slot; a restart during delivery leaves it unknown."""
        with self.lock, self.conn:
            return self.conn.execute("UPDATE actions SET status='running',ended=NULL,error=NULL,attempts=attempts+1 WHERE id=? AND status='failed' AND attempts=?",
                (action['id'], action['attempts'])).rowcount == 1

    def remember_incoming(self, key, actor, now, status="running", error=None):
        with self.lock, self.conn:
            self.conn.execute("INSERT OR IGNORE INTO incoming VALUES(?,?,?,?,?)", (key, actor, now, status, error))

    def finish_incoming(self, key, status, error=None):
        with self.lock, self.conn:
            self.conn.execute("UPDATE incoming SET status=?,error=? WHERE key=?", (status, error, key))

    def reserve_notice(self, day, actor, now):
        with self.lock, self.conn:
            action = str(uuid.uuid4())
            try:
                self.conn.execute("INSERT INTO actions(id,day,kind,target,status,started) VALUES(?,?,'strangerNotice',?,'running',?)", (action, day, actor, now))
            except sqlite3.IntegrityError:
                return None
            return action

    def replied_parent(self, parent):
        with self.lock:
            for row in self.conn.execute("SELECT result FROM actions WHERE kind IN ('interact','strangerReply','strangerNotice','ownerReply') AND status IN ('success','unknown')"):
                if str(json.loads(row[0] or "{}").get("parent_rpid") or "") == str(parent):
                    return True
            return False


class BiliAutomation:
    """Serialize DM polling and video activities; all public writes consume ledger reservations."""
    def __init__(self, ledger, backend, config, enabled, *, started_at=None, polling=None):
        self.ledger, self.backend = ledger, backend
        self.config, self.enabled = config, enabled
        self.polling = polling
        self.run_lock = threading.Lock()
        self.stopping = threading.Event()
        self.worker = None
        self.inbound_lock = threading.RLock()
        self.inbound_after = None if started_at is None else {
            kind: started_at for kind in ('dmReply', 'strangerReply', 'ownerReply')}
        self.inbound_active = {}
        if self.inbound_after is not None:
            self._save_inbound_window()
            self.inbound_active = self._inbound_switches()

    def _inbound_switches(self):
        cfg = validate_config(self.config())
        active = cfg['managed'] and cfg['enabled'] and self.enabled()
        return {kind: bool(active and cfg['features'][kind]) for kind in self.inbound_after}

    def _save_inbound_window(self):
        self.backend.inbound_after = self.inbound_after['dmReply']
        self.backend.inbound_windows = dict(self.inbound_after)
        self.ledger.set_meta('inbound_after', self.inbound_after)
        for kind, key in [('strangerReply', 'stranger_baseline'), ('ownerReply', 'owner_comment_baseline')]:
            self.ledger.set_meta(key, max(self.ledger.meta(key, 0), self.inbound_after[kind]))

    def refresh_inbound_window(self, now=None):
        """Advance only newly enabled inboxes; ordinary settings saves retain their boundary."""
        if self.inbound_after is None:
            return
        with self.inbound_lock:
            active = self._inbound_switches()
            changed = [kind for kind in active if active[kind] and not self.inbound_active.get(kind, False)]
            if changed:
                cutoff = time.time() if now is None else now
                for kind in changed:
                    self.inbound_after[kind] = cutoff
                self._save_inbound_window()
                for kind, key in [('dmReply', 'next_dm_at'), ('strangerReply', 'next_stranger_at'), ('ownerReply', 'next_stranger_at')]:
                    if kind in changed:
                        self.ledger.set_meta(key, cutoff)
            self.inbound_active = active

    def status(self):
        cfg = validate_config(self.config())
        now = time.time()
        return {"config": cfg, "day": day_at(now), "targets": self.ledger.plan(day_at(now), cfg),
                "counts": self.ledger.counts(day_at(now)), "busy": self.run_lock.locked(), "biliEnabled": self.enabled(),
                "nextBrowseAt": self.ledger.meta("next_browse_at"), "lastError": self.ledger.meta("last_error"),
                "dmError": self.ledger.meta("dm_error"), "blocked": self.ledger.meta("blocked"),
                "strangerError": self.ledger.meta("stranger_error"), "limitReplyText": LIMIT_REPLY_TEXT,
                "dynamicError": self.ledger.meta("dynamic_error"), "dynamicSchedule": self.ledger.meta("dynamic_schedule"),
                "lastDynamicPreview": self.ledger.meta("dynamic_preview"),
                "receivedAfter": self.inbound_after,
                "effectivePolling": self.polling(cfg) if self.polling else {
                    key: cfg[key] for key in ('dmPollSeconds', 'strangerPollSeconds')},
                "lastPreview": self.ledger.meta("last_preview"), "events": self.ledger.events()}

    def launch(self, kind=None, dry_run=False):
        if kind is not None and kind not in KINDS:
            raise ValueError("未知的 B 站活动类型")
        if not self.run_lock.acquire(blocking=False):
            return False
        self.worker = threading.Thread(target=self._run_owned, args=(kind, dry_run, True, time.time()), daemon=True,
                                       name="bili-automation-once")
        self.worker.start()
        return True

    def stop(self):
        self.stopping.set()
        if self.worker and self.worker is not threading.current_thread():
            self.worker.join()

    def tick(self, now=None):
        self.refresh_inbound_window(now)
        cfg = validate_config(self.config())
        if not cfg["managed"] or not cfg["enabled"] or not self.enabled() or self.stopping.is_set():
            return
        if not self.run_lock.acquire(blocking=False):
            return
        self._run_owned(None, False, False, now or time.time())

    def _run_owned(self, kind, dry_run, manual, now):
        try:
            self.refresh_inbound_window(now)
            cfg = validate_config(self.config())
            intervals = self.polling(cfg) if self.polling else cfg
            if not dry_run and (not cfg["enabled"] or not self.enabled()):
                raise ValueError("B 站或自动活动总开关尚未启用")
            if self.ledger.meta("blocked") and not dry_run:
                return
            hour = dt.datetime.fromtimestamp(now, SHANGHAI).hour
            in_window = cfg["startHour"] <= hour < cfg["endHour"]
            if kind in (None, "dmReply") and cfg["features"]["dmReply"] and (in_window or cfg["dmAllDay"]):
                if not manual and now < self.ledger.meta("next_dm_at", 0):
                    try:
                        if self.backend.write_budget_available(now):
                            self.ledger.release_dm_budget_wait(now, cfg["retryDelayMinutes"] * 60, cfg["maxDmAttempts"])
                    except (OSError, ValueError, TypeError, AttributeError):
                        pass  # Keep the original retry time if usage cannot be read.
                if manual or now >= self.ledger.meta("next_dm_at", 0):
                    if not dry_run:
                        self.ledger.set_meta("next_dm_at", now + intervals["dmPollSeconds"])
                    self._dm(cfg, now, dry_run)
            if kind == "dmReply" or self.stopping.is_set() or self.ledger.meta("blocked"):
                return
            if kind in (None, "strangerReply", "ownerReply") and (cfg["features"]["strangerReply"] or cfg["features"]["ownerReply"]) and (in_window or cfg["strangerAllDay"]):
                if manual or now >= self.ledger.meta("next_stranger_at", 0):
                    if not dry_run:
                        self.ledger.set_meta("next_stranger_at", now + intervals["strangerPollSeconds"])
                        self._strangers(cfg, now, kind)
            if kind in ("strangerReply", "ownerReply") or self.stopping.is_set() or self.ledger.meta('blocked'):
                return
            if kind == 'dynamic' or (kind is None and not dry_run and cfg['features']['dynamic']):
                self._dynamic(cfg, now, dry_run, manual)
            if kind == 'dynamic' or self.stopping.is_set() or self.ledger.meta('blocked'):
                return
            if not manual and (not in_window or now < self.ledger.meta("next_browse_at", 0)):
                return
            if not cfg["features"]["browse"] and not dry_run:
                return
            if not dry_run:
                self.ledger.set_meta("next_browse_at", now + random.randint(cfg["minGapMinutes"], cfg["maxGapMinutes"]) * 60)
            self._video(cfg, now, kind, dry_run)
        except Exception as error:
            self.ledger.set_meta("last_error", str(error))
        finally:
            self.run_lock.release()

    def _dm(self, cfg, now, dry_run):
        try:
            if dry_run:
                self.ledger.set_meta("last_preview", {"kind": "dmReply", "result": self.backend.dm_diagnostics(cfg)})
                return
            owner = self.backend.owner_id()
            if self.ledger.meta("dm_baseline_owner") != owner:
                if self.inbound_after is None:
                    self.backend.dm_baseline(cfg)
                self.ledger.set_meta("dm_baseline_owner", owner)
            message = self.backend.dm_peek(cfg)
            if not message:
                self.ledger.set_meta("dm_error", None)
                return
            if str(message.get("mid")) != owner:
                raise ValueError("私信发送人不是配置的主人，已停止处理")
            cutoff = self.inbound_after['dmReply'] if self.inbound_after is not None else None
            if cutoff is not None:
                rows = [row for row in message.get('messages', [message]) if row['ts'] > cutoff]
                if not rows:
                    self.backend.dm_ack(message, cfg)
                    self.ledger.set_meta('dm_error', None)
                    return
                message = {**message, 'messages': rows, 'text': '\n'.join(row['text'] for row in rows),
                           'key': rows[-1]['key'], 'ts': rows[-1]['ts']}
            if cfg["dmRequireMention"] and not self.backend.is_mention(message["text"]):
                self.backend.dm_ack(message, cfg)
                return
            previous = self.ledger.previous("dmReply", message["key"])
            if previous and previous["status"] == "success":
                self.backend.dm_ack(message, cfg)
                return
            if previous and previous["status"] == "unknown":
                raise ValueError("该私信上次发送结果不明，已暂停重发，请先核查")
            if previous and previous["status"] == "failed" and previous["attempts"] >= cfg["maxDmAttempts"]:
                self.backend.dm_ack(message, cfg)
                raise ValueError("该私信多次回复失败，原文仍保留在 B 站会话；已继续接收后续消息")
            day = day_at(now)
            action = self.ledger.reserve(day, "dmReply", message["key"], cfg, now)
            if not action:
                return
            try:
                reply = self.backend.draft_dm(message, cfg)
            except Exception as error:
                self.ledger.finish(action, "failed", error=str(error))
                raise
            try:
                fresh = validate_config(self.config())
                self.refresh_inbound_window()
                if (not fresh['enabled'] or not fresh['features']['dmReply'] or not self.enabled()
                        or self.stopping.is_set()
                        or (cutoff is not None and cutoff != self.inbound_after['dmReply'])):
                    self.ledger.finish(action, 'failed', error='接收窗口或功能开关已改变，本条未发送')
                    return
                result = self.backend.send_dm(message, reply, fresh)
            except Exception as error:
                result = {"status": "unknown", "error": "私信请求结果不明：" + str(error)}
            self.ledger.finish(action, result["status"], result=result, error=result.get("error"))
            if result.get("retryAt") and result.get("submission") == "not-sent":
                self.ledger.set_meta("next_dm_at", max(now + cfg["dmPollSeconds"], result["retryAt"]))
            if result["status"] == "success":
                self.backend.dm_ack(message, cfg)
                self.ledger.set_meta("dm_error", result.get("mediaWarning"))
                if result.get("media", {}).get("blocked"):
                    self.ledger.set_meta("blocked", result["media"]["error"])
            else:
                raise ValueError(result.get("error") or "私信发送结果未确认")
        except Exception as error:
            self.ledger.set_meta("dm_error", str(error))

    def _dynamic_schedule(self, cfg, now):
        settings = cfg['lifePosts']
        local = dt.datetime.fromtimestamp(now, SHANGHAI)
        day = local.date().isoformat()
        target = self.ledger.plan(day, cfg)['dynamic']
        fingerprint = [day, target, settings['startHour'], settings['endHour'], settings['minGapMinutes']]
        schedule = self.ledger.meta('dynamic_schedule')
        if schedule and schedule.get('fingerprint') == fingerprint:
            return schedule
        spent = sum(self.ledger.counts(day)['dynamic'].values())
        gap = settings['minGapMinutes'] * 60
        start = max(now, local.replace(hour=settings['startHour'], minute=0, second=0, microsecond=0).timestamp(),
            self.ledger.meta('last_dynamic_attempt', 0) + gap)
        end = local.replace(hour=0, minute=0, second=0, microsecond=0).timestamp() + settings['endHour'] * 3600 - 1
        count = min(max(0, target - spent), max(0, int((end - start) // gap) + 1)) if start <= end else 0
        room = end - start - max(0, count - 1) * gap
        points = sorted(random.uniform(0, max(0, room)) for _ in range(count))
        slots = [None] * spent + [start + i * gap + point for i, point in enumerate(points)]
        schedule = {'day': day, 'fingerprint': fingerprint, 'slots': slots, 'target': target,
            'note': '剩余发表时段不足，不会为了凑数量密集发布' if spent + count < target else ''}
        self.ledger.set_meta('dynamic_schedule', schedule)
        return schedule

    def _dynamic(self, cfg, now, dry_run, manual):
        action = None
        draft = None
        submitting = False
        try:
            recent = self.ledger.dynamic_history(cfg['lifePosts']['recentPosts'])
            if dry_run:
                draft = self.backend.draft_dynamic(cfg, now, recent)
                self.ledger.set_meta('dynamic_preview', {**draft, 'at': now, 'published': False})
                self.ledger.set_meta('dynamic_error', None)
                return
            if not cfg['features']['dynamic']:
                raise ValueError('鱼鱼碎碎念尚未启用，请先保存设置')
            local = dt.datetime.fromtimestamp(now, SHANGHAI)
            settings = cfg['lifePosts']
            if not settings['startHour'] <= local.hour < settings['endHour']:
                if manual:
                    raise ValueError('当前不在碎碎念发表时段，预览不受时段限制')
                return
            if self.ledger.remaining(day_at(now), 'dynamic', cfg) <= 0:
                if manual:
                    raise ValueError('今天的碎碎念尝试次数已达到随机目标')
                return
            if now < self.ledger.meta('last_dynamic_attempt', 0) + settings['minGapMinutes'] * 60:
                if manual:
                    raise ValueError('碎碎念最短发表间隔尚未结束')
                return
            schedule = self._dynamic_schedule(cfg, now)
            spent = sum(self.ledger.counts(day_at(now))['dynamic'].values())
            due = schedule['slots'][spent] if spent < len(schedule['slots']) else None
            if not manual and (due is None or now < due):
                return
            action = self.ledger.reserve(day_at(now), 'dynamic', f'life:{day_at(now)}:{spent + 1}', cfg, now)
            if not action:
                return
            self.ledger.set_meta('last_dynamic_attempt', now)
            draft = self.backend.draft_dynamic(cfg, now, recent)
            fresh = validate_config(self.config())
            if self.stopping.is_set() or not self.enabled() or not fresh['enabled'] or not fresh['features']['dynamic']:
                raise ValueError('发送前碎碎念已关闭，本次未发布')
            from bili_life import validate_post
            validate_post(draft['text'], fresh, self.ledger.dynamic_history(fresh['lifePosts']['recentPosts']))
            submitting = True
            result = self.backend.publish_dynamic(draft, fresh)
            self.ledger.finish(action, result['status'], result={**draft, **result, 'meme_file': result.get('meme_file')}, error=result.get('error'))
            self.ledger.set_meta('dynamic_error', result.get('error'))
            if result.get('blocked'):
                self.ledger.set_meta('blocked', result['error'])
        except Exception as error:
            if action:
                self.ledger.finish(action, 'unknown' if submitting else 'failed', result=draft, error=str(error))
            self.ledger.set_meta('dynamic_error', str(error))

    def _video(self, cfg, now, requested, dry_run):
        day = day_at(now)
        if not dry_run and self.ledger.remaining(day, "browse", cfg) <= 0:
            return
        video = self.ledger.next_video()
        if not video:
            self.ledger.enqueue(self.backend.feed(cfg))
            video = self.ledger.next_video()
        if not video:
            raise ValueError("本轮没有新的候选视频")
        browse = None if dry_run else self.ledger.reserve(day, "browse", video["bvid"], cfg, now)
        if not dry_run and not browse:
            return
        try:
            material = self.backend.read_video(video, cfg)
            material["desired_actions"] = [requested] if requested in PUBLIC_KINDS else [kind for kind in PUBLIC_KINDS if self.ledger.remaining(day, kind, cfg) > 0]
            draft = self.backend.draft_video(material, cfg)
            self.ledger.set_meta("last_error", None)
        except Exception as error:
            if browse:
                self.ledger.finish(browse, "failed", error=str(error))
                self.ledger.video_done(video["bvid"], video, "failed")
            raise
        if dry_run:
            self.ledger.set_meta("last_preview", {"kind": requested or "browse", "video": video, "draft": draft})
            self.ledger.set_meta("last_error", None)
            return
        self.ledger.finish(browse, "success", {"title": video["title"], "url": video["url"], "summary": draft.get("summary", "")})
        self.ledger.video_done(video["bvid"], video, "read")
        choices = [kind for kind in PUBLIC_KINDS if self.ledger.remaining(day, kind, cfg) > 0]
        if requested in PUBLIC_KINDS:
            choices = [requested] if requested in choices else []
        if requested == "browse":
            choices = []
        if not choices:
            return
        if draft.get("score", 0) < cfg["minInterestingScore"] and "recommend" in choices:
            choices.remove("recommend")
            if not choices:
                self.ledger.set_meta("last_error", "视频评分未达到推荐阈值，本次只计浏览")
                return
        choices = [kind for kind in choices if draft.get(kind)]
        if not choices:
            self.ledger.set_meta("last_error", "没有足够依据生成相关评论，本次只计浏览")
            return
        selected = [requested] if requested in PUBLIC_KINDS else [
            kind for kind in choices if random.random() * 100 < cfg["actionProbability"][kind]]
        if not selected:
            selected = random.choices(choices, weights=[self.ledger.remaining(day, kind, cfg) for kind in choices])
        random.shuffle(selected)
        errors = []
        for kind in selected:
            fresh = validate_config(self.config())
            if self.stopping.is_set() or not self.enabled() or not fresh["enabled"]:
                break
            if kind == "recommend" and draft["score"] < fresh["minInterestingScore"]:
                continue
            action = self.ledger.reserve(day, kind, video["bvid"], fresh, time.time())
            if not action:
                continue
            try:
                result = self.backend.publish(kind, material, draft, fresh)
                self.ledger.finish(action, result["status"], result=result, error=result.get("error"))
                if result["status"] != "success":
                    errors.append(result.get("error") or "发布结果未确认")
                    if result.get("blocked"):
                        self.ledger.set_meta("blocked", result["error"])
                    if result["status"] == "unknown" or result.get("blocked") or result.get("reason") in ("write-budget", "read-budget", "platform-pause"):
                        break
                else:
                    self.ledger.video_done(video["bvid"], video, "done")
                    if result.get("mediaWarning"):
                        errors.append(result["mediaWarning"])
                    if fresh["notifyQq"] and kind == "recommend":
                        try:
                            self.backend.notify(result, fresh)
                        except Exception as error:
                            errors.append("B 站已发布，但 QQ 通知失败：" + str(error))
            except Exception as error:
                message = "请求结果不明，请核查后再执行：" + str(error)
                self.ledger.finish(action, "unknown", error=message)
                errors.append(message)
                break
        self.ledger.set_meta("last_error", "；".join(errors) if errors else None)

    @staticmethod
    def notification_key(item):
        return f"{item['business']}:{item['oid']}:{item['rpid']}"

    def _strangers(self, cfg, now, requested=None):
        try:
            processed = self._retry_comments(cfg, now, requested)
            if processed >= cfg['strangerBatchSize'] or self.ledger.meta('blocked'):
                return
            items = self.backend.notifications(cfg)
            if not self.ledger.meta("stranger_baseline"):
                for item in items:
                    self.ledger.remember_incoming(self.notification_key(item), item["mid"], now, "baseline")
                self.ledger.set_meta("stranger_baseline", now)
                return
            if cfg["features"]["ownerReply"] and not self.ledger.meta("owner_comment_baseline"):
                self.ledger.set_meta("owner_comment_baseline", now)
            for item in items:
                key = self.notification_key(item)
                if self.ledger.incoming_seen(key):
                    continue
                is_owner = str(item['mid']) == self.backend.owner_id()
                category = 'ownerReply' if is_owner else 'strangerReply'
                if self.inbound_after is not None and item['time'] <= self.inbound_after[category]:
                    self.ledger.remember_incoming(key, item['mid'], now, 'before-activation')
                    continue
                if item["time"] < self.ledger.meta("stranger_baseline"):
                    self.ledger.remember_incoming(key, item["mid"], now, "historical")
                    continue
                is_owner = str(item["mid"]) == self.backend.owner_id()
                category = "ownerReply" if is_owner else "strangerReply"
                if requested and requested != category:
                    continue
                if not cfg["features"][category] or (is_owner and item["time"] < self.ledger.meta("owner_comment_baseline", now)):
                    self.ledger.remember_incoming(key, item["mid"], now, "disabled-or-baseline")
                    continue
                if self.ledger.replied_parent(item["rpid"]):
                    self.ledger.remember_incoming(key, item["mid"], now, "already-replied")
                    continue
                if processed >= cfg["strangerBatchSize"] or self.stopping.is_set():
                    break
                self.ledger.remember_incoming(key, item["mid"], now)
                action = None
                submitting = False
                try:
                    processed += 1
                    context = self.backend.notification_context(item, cfg)
                    context["is_owner"] = is_owner
                    context['receivedAt'] = item['time']
                    day = day_at(now)
                    if self.ledger.remaining(day, category, cfg) > 0:
                        action = self.ledger.reserve(day, category, key, cfg, now)
                        if not action:
                            self.ledger.finish_incoming(key, "skipped")
                            continue
                        text = self.backend.draft_owner_comment(context, cfg) if is_owner else self.backend.draft_stranger(context, cfg)
                    else:
                        if is_owner:
                            self.ledger.finish_incoming(key, "owner-quota-exhausted")
                            continue
                        action = self.ledger.reserve_notice(day, str(item["mid"]), now)
                        if not action:
                            self.ledger.finish_incoming(key, "notice-already-sent")
                            continue
                        text = LIMIT_REPLY_TEXT
                    fresh = validate_config(self.config())
                    self.refresh_inbound_window()
                    if self.inbound_after is not None and item['time'] <= self.inbound_after[category]:
                        self.ledger.finish(action, 'failed', error='接收窗口已改变，本条未发送')
                        self.ledger.finish_incoming(key, 'before-activation')
                        continue
                    if self.stopping.is_set() or not self.enabled() or not fresh["enabled"] or not fresh["features"][category]:
                        self.ledger.finish(action, "failed", error="发送前功能已关闭，本次未提交")
                        self.ledger.finish_incoming(key, "cancelled")
                        return
                    submitting = True
                    result = self.backend.reply_notification(context, text, fresh)
                    result = self._comment_receipt(result, key, context, text, 1, fresh['maxCommentSendAttempts'])
                    self.ledger.finish(action, result["status"], result=result, error=result.get("error"))
                    self.ledger.finish_incoming(key, result["status"], result.get("error"))
                    if result["status"] != "success":
                        self.ledger.set_meta("stranger_error", result.get("error") or "陌生人回复结果尚未确认")
                        if result.get("blocked"):
                            self.ledger.set_meta("blocked", result["error"])
                        return
                    self.ledger.set_meta("stranger_error", result.get("mediaWarning"))
                except Exception as error:
                    state = "unknown" if submitting else "failed"
                    if action:
                        self.ledger.finish(action, state, result={"parent_rpid": item["rpid"]}, error=str(error))
                    self.ledger.finish_incoming(key, state, str(error))
                    self.ledger.set_meta("stranger_error", str(error))
        except Exception as error:
            self.ledger.set_meta("stranger_error", str(error))

    @staticmethod
    def _comment_receipt(result, key, context, reply, attempts, maximum):
        """Keep an unsent draft durable without treating rejected or uncertain writes as retryable."""
        result = {**result, 'parent_rpid': context['parent_rpid']}
        if (result['status'] == 'failed' and result.get('submission') == 'not-sent'
                and result.get('reason') in ('cooldown', 'write-budget', 'platform-pause')
                and result.get('retryAt')):
            if attempts < maximum:
                result['retryPayload'] = {'key': key, 'context': context, 'reply': reply}
            else:
                result.pop('retryAt', None)
                result['error'] = '评论发送尝试已达上限，本条未发送，不再自动重试'
        return result

    def _retry_comments(self, cfg, now, requested):
        processed = 0
        for action in self.ledger.pending_comment_retries(now, cfg):
            payload = action['result']['retryPayload']
            context, reply, key = payload['context'], payload['reply'], payload['key']
            category = 'ownerReply' if context.get('is_owner') else 'strangerReply'
            if (self.inbound_after is not None
                    and context.get('receivedAt', action['started']) <= self.inbound_after[category]):
                result = {key: value for key, value in action['result'].items()
                          if key not in ('retryPayload', 'retryAt')}
                result['skippedBeforeActivation'] = self.inbound_after[category]
                self.ledger.finish(action['id'], 'failed', result, '服务开启前的评论草稿已跳过，不再补发')
                self.ledger.finish_incoming(key, 'before-activation')
                continue
            fresh = validate_config(self.config())
            if self.stopping.is_set() or not self.enabled() or not fresh['enabled']:
                break
            if (requested and requested != category) or not fresh['features'][category]:
                continue
            if processed >= fresh['strangerBatchSize']:
                break
            if not self.ledger.claim_comment_retry(action):
                continue
            processed += 1
            submitting = False
            try:
                is_owner = context['actorUid'] == self.backend.owner_id()
                if is_owner != bool(context.get('is_owner')):
                    raise ValueError('主人配置已改变，旧评论草稿未发送')
                self.backend.notification_context({'oid': context['aid'], 'rpid': context['parent_rpid'],
                    'root': context['root'], 'mid': context['actorUid']}, fresh)
                fresh = validate_config(self.config())
                self.refresh_inbound_window()
                if (self.inbound_after is not None
                        and context.get('receivedAt', action['started']) <= self.inbound_after[category]):
                    raise ValueError('接收窗口已改变，旧评论草稿未发送')
                if self.stopping.is_set() or not self.enabled() or not fresh['enabled'] or not fresh['features'][category]:
                    raise ValueError('重试前功能已关闭，旧评论草稿未发送')
                submitting = True
                result = self.backend.reply_notification(context, reply, fresh)
                result = self._comment_receipt(result, key, context, reply, action['attempts'] + 1, fresh['maxCommentSendAttempts'])
            except Exception as error:
                result = {'status': 'unknown' if submitting else 'failed', 'parent_rpid': context['parent_rpid'], 'error': str(error)}
            self.ledger.finish(action['id'], result['status'], result, result.get('error'))
            self.ledger.finish_incoming(key, result['status'], result.get('error'))
            self.ledger.set_meta('stranger_error', result.get('error'))
            if result.get('blocked'):
                self.ledger.set_meta('blocked', result['error'])
                break
        return processed
