"""Daily Bilibili automation plans and durable action accounting."""
import copy
import tempfile
import unittest
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from bili_automation import AutomationLedger, DEFAULT_AUTOMATION, validate_config


class AutomationLedgerTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.path = Path(self.tmp.name, "automation.sqlite3")
        self.ledger = AutomationLedger(self.path)
        self.addCleanup(self.ledger.close)
        self.cfg = copy.deepcopy(DEFAULT_AUTOMATION)
        self.cfg["enabled"] = True

    def test_plan_is_within_bounds_and_stable_across_reads_and_restart(self):
        plan = self.ledger.plan("2026-10-27", self.cfg)
        for kind, interval in self.cfg["daily"].items():
            self.assertLessEqual(interval["min"], plan[kind])
            self.assertLessEqual(plan[kind], interval["max"])
        self.assertEqual(plan, self.ledger.plan("2026-10-27", self.cfg))
        other = AutomationLedger(self.path)
        self.addCleanup(other.close)
        self.assertEqual(plan, other.plan("2026-10-27", self.cfg))

    def test_invalid_ranges_and_types_are_rejected(self):
        for change in ({"daily": {"browse": {"min": 5, "max": 2}}}, {"dmPollSeconds": 0},
                       {"features": {"comment": "true"}}, {"enabled": 1}, {"replyThinkingEnabled": 1}, {"unrecognized": True}):
            with self.subTest(change=change), self.assertRaises(ValueError):
                validate_config(change)

    def test_zero_limits_and_disabled_features_never_admit_writes(self):
        self.cfg["daily"]["comment"] = {"min": 0, "max": 0}
        self.assertIsNone(self.ledger.reserve("2026-10-27", "comment", "BVzero", self.cfg, 1))
        self.cfg["features"]["recommend"] = False
        self.assertIsNone(self.ledger.reserve("2026-10-27", "recommend", "BVdisabled", self.cfg, 1))

    def test_concurrent_admission_cannot_exceed_daily_target(self):
        self.cfg["daily"]["comment"] = {"min": 2, "max": 2}
        with ThreadPoolExecutor(max_workers=8) as pool:
            results = list(pool.map(lambda i: self.ledger.reserve("2026-10-27", "comment", f"BV{i}", self.cfg, 1), range(20)))
        self.assertEqual(sum(value is not None for value in results), 2)

    def test_success_failure_and_unknown_have_distinct_quota_semantics(self):
        self.cfg["daily"]["comment"] = {"min": 2, "max": 2}
        first = self.ledger.reserve("2026-10-27", "comment", "BVfirst", self.cfg, 1)
        self.ledger.finish(first, "failed", error="platform rejected")
        second = self.ledger.reserve("2026-10-27", "comment", "BVsecond", self.cfg, 2)
        self.ledger.finish(second, "success", result={"rpid": "123"})
        third = self.ledger.reserve("2026-10-27", "comment", "BVthird", self.cfg, 3)
        self.ledger.finish(third, "unknown", error="connection dropped after request")
        self.assertIsNone(self.ledger.reserve("2026-10-27", "comment", "BVfourth", self.cfg, 4))
        counts = self.ledger.counts("2026-10-27")
        self.assertEqual(counts["comment"]["success"], 1)
        self.assertEqual(counts["comment"]["unknown"], 1)

    def test_different_public_action_kinds_can_use_the_same_video(self):
        self.cfg["daily"]["recommend"] = {"min": 2, "max": 2}
        self.cfg["daily"]["interact"] = {"min": 2, "max": 2}
        first = self.ledger.reserve("2026-10-27", "recommend", "BVsame", self.cfg, 100)
        self.ledger.finish(first, "success")
        self.assertIsNotNone(self.ledger.reserve("2026-10-27", "interact", "BVsame", self.cfg, 101))
        self.assertIsNone(self.ledger.reserve("2026-10-28", "recommend", "BVsame", self.cfg, 102))

    def test_probability_settings_merge_defaults_and_reject_invalid_values(self):
        cfg = validate_config({"actionProbability": {"comment": 75}})
        self.assertEqual(cfg["actionProbability"], {"recommend": 50, "comment": 75, "interact": 50})
        for value in (0, 101, 0.5, True, "50"):
            with self.subTest(value=value), self.assertRaises(ValueError):
                validate_config({"actionProbability": {"comment": value}})
        with self.assertRaises(ValueError):
            validate_config({"actionProbability": {"dmReply": 50}})

    def test_new_day_gets_new_quota_without_erasing_prior_success(self):
        self.cfg["daily"]["comment"] = {"min": 1, "max": 1}
        first = self.ledger.reserve("2026-10-27", "comment", "BVfirst", self.cfg, 100)
        self.ledger.finish(first, "success")
        self.assertIsNotNone(self.ledger.reserve("2026-10-28", "comment", "BVnext", self.cfg, 86401))
        self.assertEqual(self.ledger.counts("2026-10-27")["comment"]["success"], 1)

    def test_pending_action_after_restart_becomes_unknown_and_cannot_repeat(self):
        first = self.ledger.reserve("2026-10-27", "recommend", "BVpending", self.cfg, 100)
        self.assertIsNotNone(first)
        self.ledger.close()
        restored = AutomationLedger(self.path)
        self.addCleanup(restored.close)
        self.assertEqual(restored.counts("2026-10-27")["recommend"]["unknown"], 1)
        self.assertIsNone(restored.reserve("2026-10-27", "recommend", "BVpending", self.cfg, 101))

    def test_range_changes_do_not_reset_success_counts(self):
        self.cfg["daily"]["comment"] = {"min": 2, "max": 2}
        action = self.ledger.reserve("2026-10-27", "comment", "BVfirst", self.cfg, 100)
        self.ledger.finish(action, "success")
        self.cfg["daily"]["comment"] = {"min": 0, "max": 0}
        self.assertEqual(self.ledger.plan("2026-10-27", self.cfg)["comment"], 0)
        self.assertEqual(self.ledger.counts("2026-10-27")["comment"]["success"], 1)

    def test_only_definite_dm_failures_retry_after_backoff_with_bounded_attempts(self):
        self.cfg["retryDelayMinutes"] = 1
        self.cfg["maxDmAttempts"] = 2
        first = self.ledger.reserve("2026-10-27", "dmReply", "message", self.cfg, 100)
        self.ledger.finish(first, "failed", error="preflight rejected")
        self.assertIsNone(self.ledger.reserve("2026-10-27", "dmReply", "message", self.cfg, 110))
        self.assertEqual(self.ledger.reserve("2026-10-27", "dmReply", "message", self.cfg, 161), first)
        self.ledger.finish(first, "failed", error="preflight rejected")
        self.assertIsNone(self.ledger.reserve("2026-10-27", "dmReply", "message", self.cfg, 222))

    def test_unknown_dm_delivery_is_not_retried_even_after_backoff(self):
        action = self.ledger.reserve("2026-10-27", "dmReply", "message", self.cfg, 100)
        self.ledger.finish(action, "unknown", error="response lost")
        self.assertIsNone(self.ledger.reserve("2026-10-27", "dmReply", "message", self.cfg, 99999))

    def test_deferred_dm_waits_until_the_reported_budget_reset(self):
        action = self.ledger.reserve("2026-10-27", "dmReply", "message", self.cfg, 100)
        self.ledger.finish(action, "failed", result={"retryAt": 10000, "submission": "not-sent"})
        self.assertIsNone(self.ledger.reserve("2026-10-27", "dmReply", "message", self.cfg, 2000))
        self.assertEqual(self.ledger.reserve("2026-10-27", "dmReply", "message", self.cfg, 10001), action)


if __name__ == "__main__":
    unittest.main()
