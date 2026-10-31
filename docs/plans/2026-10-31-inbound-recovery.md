# Fresh inbound messages and state recovery implementation plan

**Goal:** Restore DM and comment processing without replaying content received before service activation or retrying uncertain deliveries.

**Architecture:** The memory service records an activation timestamp for each inbound feature. The DM CLI filters persisted and fetched messages against that timestamp; the controller filters comment notifications and queued retries. Existing successful and unknown delivery records remain intact. State writes retain a synchronized backup.

**Tech Stack:** Python unittest, SQLite, Node.js node:test, existing Bilibili request guard.

1. Back up the live SQLite database, state files and configuration; pause automatic activities.
2. Add regression tests for startup, reactivation, mixed old/new DM batches, old comment retries and uncertain delivery retention.
3. Implement feature activation cutoffs, durable DM state backup and recovery.
4. Run focused controller/runtime and real CLI fixture tests; install the verified files into the existing service.
5. Restore old request fingerprints from available backups and successful delivery receipts; retain unknown operations and all ledger outcomes. Archive obsolete unsent drafts, repair the DM cursor and resume with the new activation boundary.
6. Verify authenticated read access and service status, with no synthetic live DM or comment sent.
