# Bilibili automation implementation plan

**Goal:** Extend the existing Bilibili settings with owner DM replies, autonomous browsing, contextual recommendations, independent comments, and threaded interactions under persistent randomized daily limits.

**Architecture:** Keep dsh-remembers as the only active Bilibili integration. Reuse dsh-bili-whale credentials, selectors, content readers, DM cursor/ack and write commands. A Python controller owns a separate SQLite action ledger and daily random plans; the existing scheduler delegates its Bilibili slot to it. Drafts use the existing memory-service LLM and persona. Public drafts receive no owner private profile or chat history. Existing QQ notification routing stays available.

**Tech stack:** Python standard library SQLite/HTTP/threading, existing Node Bilibili CLI, existing React settings, unittest and Playwright.

## Task 1: Daily plans and action ledger

- Create `service/bili_automation.py` with validated config, Shanghai dates, one persisted random plan per day, atomic reservations, success/failure/unknown states, and per-video/per-parent deduplication.
- Create `service/test_bili_automation.py`; verify min/max, zero, disabled categories, restart/config changes, concurrency, failures, and unknown outcomes before integrating remote writes.

## Task 2: Reuse existing Bilibili operations

- Create `service/bili_runtime.py` to adapt the current feed, video-content/comments, comment/dm and DM peek/ack commands.
- Add a narrow Node history reader for owner-only DM verification using the existing dm-history library; no second credential file or platform listener.
- Draft contextual recommendations/comments/replies through the current persona and LLM, validate selected parent ids, and verify published comments. Keep private user context out of public comments.
- Verify mocked selection, distinct comment/interaction routing, mention identity, pending DM acknowledgement and duplicate protection.

## Task 3: Scheduler and HTTP integration

- Update `service/server.py` with automation config/status/run routes and runtime initialization. Batch preference and automation updates together.
- Update `service/scheduler.py` to delegate Bilibili work to the single controller, including when its master switch is off; do not fall back to the old runner.
- Ensure disabled features, existing tool toggles and top-level Bilibili enablement are respected. Keep HTTP outcomes and uncertain remote writes visible.

## Task 4: Existing Bilibili settings UI

- Update `client.js` with feature switches, daily min/max ranges, active hours/intervals, owner DM behavior, today's targets/counts, recent results and a one-round action.
- Retain the current preferences, login, tools, UID and global persona behavior. Verify save/reload/restart and dark/light/mobile layouts.

## Task 5: Validation and installation

- Back up local sources and configuration. Run existing focused tests plus controller/runtime tests and syntax checks.
- Run real read/draft checks and a small number of verified public writes using the currently authorized accounts. Verify DM through an existing owner session when available; clearly record any externally blocked step without inventing success.
- Restart only the affected services, verify no duplicate Bilibili runner, update local READMEs and save an inspectable test report.

## Phase 2 (started after phase 1 acceptance)

Phase 1 passed its focused tests, browser checks, restart checks and limited real writes before this phase started; one platform-accepted but unreadable comment remains explicitly unknown and is never retried. Add opt-in replies to strangers who @ or reply to the bot in video comments. Expose a daily AI generation cap, including failed attempts. Once the cap is reached, respond with the exact fixed text `token快要用完啦，我的主人不让我回答啦` without accessing the LLM. Deduplicate incoming comments across both inboxes, establish an initial baseline and send exhaustion notices at most once per person per Shanghai day. Verify with fake platform/model tests and a limited real-account role simulation using a separate test ledger; leave the production owner identity unchanged.
