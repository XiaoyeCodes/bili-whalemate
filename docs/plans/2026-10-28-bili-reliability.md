# Bilibili save and delivery reliability implementation plan

**Goal:** Reject invalid settings at the owning field and distinguish requests stopped before dispatch from unknown delivery, preserving duplicate-send protection.

**Architecture:** The CLI emits a structured failure receipt; the Python adapter consumes it before truncating diagnostics. The existing ledger retains failed/unknown states and honors explicit retry times. Browser number inputs use native validation before any save request.

**Validation:** Use isolated traffic guards and fake transports, controller ledgers in temporary directories, and the registered settings component with a fake service. No test sends a live message or changes platform limits.

1. Add regression tests for local budget rejection, ambiguous duplicate operations, lost responses, and structured subprocess errors in `dsh-bili-whale/tests/traffic.test.mjs` and `tests/command-result.test.mjs`.
2. Add structured failure output at `tools/lib/run-command.mjs`; preserve CLI arguments and existing command exit behavior. Attach submission state and retry time in `tools/lib/traffic.mjs`.
3. Parse the receipt in `service/server.py` before truncation, map it in `service/bili_runtime.py`, and honor retry times in `service/bili_automation.py`. Add runtime/controller regressions.
4. Validate Bilibili numeric inputs before save in `client.js`; show localized field names, retain draft values, and move long diagnostics into expandable details. Test empty, fractional, out-of-range, and valid input without touching the live account.
5. Document failure and retry behavior in the plugin README. Back up and correct only the existing ledger row whose stored trace proves rejection during pre-dispatch admission; retain the original diagnostic. Preserve all genuine unknown outcomes.
6. Run focused Node and Python checks, load the updated service and client, and verify health and saved settings. Do not invoke a live publish/send command for validation.
