# Multiple public actions per video implementation plan

**Goal:** Allow recommendation, independent comment and interaction to be sampled independently for one browsed video, selecting at least one eligible action.

**Architecture:** Add validated per-action percentage settings with defaults of 50%. Keep daily limits and content eligibility. If all draws miss, choose one eligible action weighted by remaining quota. Execute selected actions sequentially in random order, rechecking configuration and stopping on unknown outcomes or account restrictions. Deduplicate by action kind and video across the existing history window; retain all ledger rows and counts.

**Validation:** Focused Python ledger/controller regressions cover multiple selected actions, independent probabilities, fallback, no eligible action, disabled features, quota limits, per-kind deduplication, partial failure and cancellation. Browser fixtures verify percentage settings save and validation. Tests use fake publication adapters only.

1. Write and run failing controller and ledger tests.
2. Add `actionProbability` settings, independent selection, per-kind deduplication and safe sequential publication in `service/bili_automation.py`.
3. Add the three percentage inputs and current behavior descriptions to `client.js`; update plugin READMEs.
4. Run focused Python and offline browser checks. Pause the existing Bilibili switch, drain accepted work, restart the memory service, and restore the saved switch without changing current targets or counts.
