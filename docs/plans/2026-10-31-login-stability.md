# Login stability implementation plan

**Goal:** Preserve the saved login across transient verification failures and keep unattended polling within the configured request budget.

**Architecture:** A credential-specific session status cache distinguishes authenticated, expired and temporarily unavailable verification. Only an explicit platform authentication failure requests another login. Atomic credential writes preserve QR renewal metadata; polling intervals reserve request capacity for foreground work.

**Tech Stack:** Python unittest, Node.js node:test, existing guarded Bilibili requests and browser settings fixtures.

1. Reproduce budget exhaustion, network failure and explicit invalid-session responses with offline tests.
2. Add safe structured session verification, cached status and atomic credential storage; retain refresh metadata returned by future QR logins without exposing it to the UI.
3. Calculate effective background polling intervals from saved intervals and read budgets; show the effective intervals and distinguish temporary verification trouble in settings.
4. Run focused tests and public-file audit, back up the installed files, deploy without replacing the current credentials, then verify the real saved login and request counters.

The change does not reset request budgets, recover revoked platform sessions, or replay messages predating service activation.
