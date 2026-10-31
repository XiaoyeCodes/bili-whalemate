# Portable Settings Implementation Plan

**Goal:** Restore the current local prompts and behavior on a fresh installation while excluding API keys, login credentials and monitored account identities.

**Architecture:** Export explicit settings fields into audited JSON seeds. Reuse the installer to initialize an empty target and preserve existing credentials, persona edits and account bindings on repeat installs. Ship the verified source and matching gallery archive as a new version.

**Tech Stack:** Python, SQLite read-only snapshots, PyYAML nodes, Node.js, Playwright and Git.

1. Finish and visually verify the native time/settings collapse behavior in `client.js`; apply the same change to the installed client.
2. Add `scripts/export_settings.py` with explicit allowlists for persona cards, service settings, Bilibili preferences/automation and QQ prompt/vision settings. Export current approved settings into `seed/`; never copy databases, histories or credentials.
3. Extend `scripts/setup.py` to initialize channel-selected persona cards and nonsecret profile defaults on empty targets, preserving existing values on reinstall. Add focused privacy/preservation tests in `test/test_setup.py` and export tests.
4. Extend `scripts/audit_public.py` to reject unapproved seed fields and bound accounts. Compare exported settings with the local source without printing secrets.
5. Update version/install instructions, run service and Node regression tests and an isolated fresh setup. Build and inspect the complete gallery release.
6. Commit the reviewed changes, push to the default branch without force, publish the matching release and verify remote source and asset hashes.
