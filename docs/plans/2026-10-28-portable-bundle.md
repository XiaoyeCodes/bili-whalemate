# Portable Whalemate Implementation Plan

**Goal:** Reproduce the configured Whalemate behavior, persona, prompts and gallery in another DeepSeek Harness installation without exporting accounts, credentials or conversations.

**Architecture:** One native Harness bundle owns the existing remembers UI and Bilibili controller. A Windows bootstrap installs Python dependencies, seeds a fresh database, installs the pinned official QQ plugin and applies its scheduler adapter. Gallery binaries travel in the versioned release archive; the repository contains their catalogue and SHA-256 manifest.

**Tech stack:** ESM JavaScript, Python 3.11+, PowerShell, Harness profile bundles, SQLite and GitHub Releases.

1. Export explicitly allowed source modules and settings. Review persona fields, remove learned user records, reset usage counters and leave account references empty. Scan copied source and metadata for secrets, personal identifiers and private endpoints.
2. Implement `scripts/setup.py` for validated, idempotent seeds and per-install bridge credentials. Add an owned subprocess lifecycle in `index.mjs` and a supported `dsh plugin add` installer in `install.ps1`. Keep existing configuration and credentials on repeat installation.
3. Add install tests for clean data, gallery integrity, key preservation, account isolation, invalid filenames and repeat installation. Run existing behavior tests, then install the real bundle and official QQ adapter into an isolated Harness home and boot a supported web profile.
4. Document installation, sensitive fields requiring local entry, behavior and limitations. Generate a full release archive and checksum, scan its entire contents, publish source plus release and verify remote hashes. Never publish raw SQLite, logs, transcripts, sessions, incoming media or account binding files.
