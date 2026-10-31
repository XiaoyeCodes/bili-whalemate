"""Read the current account's local Bilibili request budget counters."""
import datetime as dt
import hashlib
import json
import math
import os
from pathlib import Path
import time


SHANGHAI = dt.timezone(dt.timedelta(hours=8))


def write_usage(home=None, now=None, limits=None, *, kind='write'):
    """Read Beijing clock-hour/day counters and effective limits without changing traffic state.

    Window ends and asOf are Unix seconds. Each write request consumes one unit;
    querying expired counters reports zero without modifying the request journal.
    """
    directory = Path(home or os.environ.get("USERPROFILE") or os.environ.get("HOME") or ".") / ".bili-ai"
    with (directory / "credentials.json").open(encoding="utf-8-sig") as stream:
        credentials = json.load(stream)
    session = str(credentials.get("sessdata") or "").strip("\"' \t\r\n")
    if not session:
        raise ValueError("未找到 B 站登录凭据")
    account = hashlib.sha256(session.split(";", 1)[0].encode()).hexdigest()
    try:
        with (directory / "traffic-state.json").open(encoding="utf-8") as stream:
            state = json.load(stream)
    except FileNotFoundError:
        state = {}
    if not isinstance(state, dict):
        raise ValueError("写操作计数数据无效")
    accounts = state.get("accounts", {})
    if not isinstance(accounts, dict):
        raise ValueError("写操作计数数据无效")
    record = accounts.get(account, {})
    if not isinstance(record, dict):
        raise ValueError("写操作计数数据无效")
    timestamp = time.time() if now is None else now
    local = dt.datetime.fromtimestamp(timestamp, SHANGHAI)
    hour_start = math.floor(timestamp / 3600) * 3600
    if kind not in ('write', 'read'):
        raise ValueError('未知的请求计数类型')
    day = record.get(kind + 'Day', 0)
    hour = record.get(kind + 'Hour', 0)
    hour_at = record.get("hourAt", 0)
    if any(type(value) is not int or value < 0 for value in (day, hour, hour_at)):
        raise ValueError("写操作计数数据无效")
    daily = day if record.get("date") == local.date().isoformat() else 0
    hourly = hour if hour_at and math.floor(hour_at / 3600000) * 3600 == hour_start else 0
    limits = limits or {}
    def limit(key, default):
        value = limits.get(key, default)
        return math.floor(value) if type(value) in (int, float) and math.isfinite(value) and value >= 1 else default
    daily_limit, hourly_limit = limit(kind + 'Daily', 3000 if kind == 'read' else 30), limit(kind + 'Hourly', 600 if kind == 'read' else 12)
    return {"daily": daily, "hourly": hourly, "dailyLimit": daily_limit, "hourlyLimit": hourly_limit,
            "dailyRemaining": max(0, daily_limit - daily), "hourlyRemaining": max(0, hourly_limit - hourly),
            "hourStartedAt": hour_start, "hourResetsAt": hour_start + 3600,
            "dailyResetsAt": (local.replace(hour=0, minute=0, second=0, microsecond=0) + dt.timedelta(days=1)).timestamp(),
            "asOf": timestamp}


def read_usage(home=None, now=None, limits=None):
    """Read current account read counters with the same calendar windows as the request guard."""
    return write_usage(home, now, limits, kind='read')
