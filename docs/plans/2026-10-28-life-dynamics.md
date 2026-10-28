# Whalemate Life Dynamics Implementation Plan

**Goal:** Automatically publish 1–3 configurable daily Bilibili text dynamics in the shared character voice, grounded in Shanghai time/weather and Chinese holiday/workday facts.

**Architecture:** Extend the existing Bilibili controller and durable ledger with one dynamic kind. A local context helper caches Shanghai weather and uses the maintained chinesecalendar dataset. A small life-post helper generates private-data-free drafts and verifies existing CLI publications; no second timer or QQ gateway is added.

**Tech stack:** Python, SQLite, the existing ESM Bilibili CLI, existing React settings UI, Open-Meteo, chinesecalendar.

1. Add context tests for Shanghai midnight, statutory holidays, compensating workdays, unsupported years, fresh weather and unavailable/stale weather. Implement the context helper and bounded cache; share Shanghai weather with the memory state.
2. Add dynamic configuration and persistent schedule/accounting tests. Reuse the controller lock; previews never publish or consume quotas. Failures consume their generation slot; uncertain writes never repeat. Enforce per-day limits and minimum spacing across restarts.
3. Generate short character posts using only public persona, mood and public activity summaries. Rotate enabled themes, ground weather/holiday claims, reject private paths/IDs/links and duplicate posts. Reuse CLI publication guards and verify author/content through readback.
4. Extend the Bilibili settings with dynamic controls, preview and status. Check saving/reloading, validation, dark/light themes and narrow layouts.
5. Run focused regression tests and live weather/model checks. Enable the user's chosen 1–3 daily automatic setting after installation verification; if a live publication is made, use a normal character post and account it in today's existing ledger. Preserve credentials and existing quotas.
