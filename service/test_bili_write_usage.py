"""Local write-budget usage and window expiry."""
import datetime as dt
import hashlib
import json
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from bili_write_usage import write_usage


class WriteUsageTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.home = Path(self.tmp.name)
        self.directory = self.home / ".bili-ai"
        self.directory.mkdir()
        (self.directory / "credentials.json").write_text(json.dumps({"sessdata": " secret "}), encoding="utf-8")
        self.zone = dt.timezone(dt.timedelta(hours=8))
        self.now = dt.datetime(2026, 10, 28, 12, 30, tzinfo=self.zone).timestamp()
        self.account = hashlib.sha256(b"secret").hexdigest()

    def state(self, record):
        (self.directory / "traffic-state.json").write_text(json.dumps({"accounts": {self.account: record}}), encoding="utf-8")

    def test_current_account_and_expiry(self):
        self.state({"date": "2026-10-28", "writeDay": 31, "writeHour": 4, "hourAt": int((self.now - 300) * 1000)})
        result = write_usage(self.home, self.now, {"writeDaily": 60, "writeHourly": 50})
        self.assertEqual((result["daily"], result["hourly"]), (31, 4))
        self.assertEqual((result["dailyRemaining"], result["hourlyRemaining"]), (29, 46))
        self.assertEqual(result["hourStartedAt"], self.now - 1800)
        self.assertEqual(result["hourResetsAt"], self.now + 1800)
        self.assertEqual(result["asOf"], self.now)
        self.assertEqual(write_usage(self.home, self.now + 3600)["hourly"], 0)
        tomorrow = dt.datetime(2026, 10, 29, 0, 0, tzinfo=self.zone).timestamp()
        self.assertEqual(result["dailyResetsAt"], tomorrow)
        result = write_usage(self.home, tomorrow)
        self.assertEqual((result["daily"], result["hourly"]), (0, 0))

    def test_hour_changes_at_the_clock_boundary_without_mutating_counters(self):
        self.state({"date": "2026-10-28", "writeDay": 31, "writeHour": 12, "hourAt": int(self.now * 1000)})
        path = self.directory / "traffic-state.json"
        before = path.read_bytes()
        self.assertEqual(write_usage(self.home, self.now + 1799.999)["hourly"], 12)
        result = write_usage(self.home, self.now + 1800)
        self.assertEqual(result["hourly"], 0)
        self.assertEqual(result["hourlyRemaining"], 12)
        self.assertEqual(result["daily"], 31)
        self.assertEqual(result["dailyRemaining"], 0)
        self.assertEqual(path.read_bytes(), before)

    def test_counts_are_scoped_to_the_logged_in_account(self):
        self.state({"date": "2026-10-28", "writeDay": 31, "writeHour": 4, "hourAt": int(self.now * 1000)})
        (self.directory / "credentials.json").write_text(json.dumps({"sessdata": "another-account"}), encoding="utf-8")
        result = write_usage(self.home, self.now)
        self.assertEqual((result["daily"], result["hourly"]), (0, 0))

    def test_pending_writes_can_resume_after_the_hour_but_not_past_the_daily_cap(self):
        from bili_runtime import BiliRuntime
        risk = {"writeDaily": 60, "writeHourly": 50}
        runtime = BiliRuntime(lambda: SimpleNamespace(_load_bili_whale=lambda: {"risk": risk}),
                              None, None, self.home, self.home)
        self.state({"date": "2026-10-28", "writeDay": 31, "writeHour": 50, "hourAt": int(self.now * 1000)})
        with patch.dict("os.environ", {"USERPROFILE": str(self.home)}):
            self.assertFalse(runtime.write_budget_available(self.now + 1799.999))
            self.assertTrue(runtime.write_budget_available(self.now + 1800))
            risk["writeDaily"] = 30
            self.assertFalse(runtime.write_budget_available(self.now + 1800))

    def test_missing_state_and_invalid_state(self):
        result = write_usage(self.home, self.now)
        self.assertEqual((result["daily"], result["hourly"]), (0, 0))
        self.state({"date": "2026-10-28", "writeDay": "bad"})
        with self.assertRaises(ValueError):
            write_usage(self.home, self.now)
        (self.directory / "traffic-state.json").write_text("{", encoding="utf-8")
        with self.assertRaises(ValueError):
            write_usage(self.home, self.now)

    def test_missing_credentials_do_not_report_zero(self):
        (self.directory / "credentials.json").unlink()
        with self.assertRaises(FileNotFoundError):
            write_usage(self.home, self.now)
