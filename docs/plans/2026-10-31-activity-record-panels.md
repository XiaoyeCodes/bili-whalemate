# Activity records and recovered errors implementation plan

**Goal:** Keep the automatic activity panel compact, clear resolved errors promptly and collect error details in one collapsible record panel.

**Architecture:** Reuse native details/summary controls for browsing, execution and error records. Persist channel error transitions in the existing SQLite metadata, supplement them with action failure/uncertain receipts, and resolve known read-budget errors from local counters without making additional platform requests.

**Tech Stack:** Existing React client bundle, Python unittest, SQLite metadata and isolated Playwright settings fixture.

1. Add regression tests for durable error activation/recovery, read-budget window recovery and successful comment polling.
2. Add backend browsing/error record projections and condition-specific recovery checks; preserve failed/uncertain delivery receipts.
3. Move browsing previews into a closed browsing panel; put a closed error panel immediately after execution records and route task/settings failures there.
4. Verify expansion, collapse, empty states, recovery updates and layout with the browser fixture; run focused Python tests.
5. Back up and install the verified files, resume the service, and inspect real record APIs and served client assets without sending test messages.
