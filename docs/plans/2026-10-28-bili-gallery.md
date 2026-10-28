# Bilibili gallery delivery implementation plan

**Goal:** Deliver the existing QQ gallery in Bilibili comments, comment replies and owner DMs using the shared memeRate setting, and enable owner comment mentions without duplicating the inbox runner.

**Architecture:** The existing Python controller retains admission, daily quotas and deduplication. A gallery adapter reads the existing meme catalogue and selects a bounded candidate list after one probability draw. The existing LLM response chooses a validated filename without extra model calls. A narrow Node upload helper reuses the current credentials and traffic guard; the original comment and DM commands accept validated uploaded-picture metadata. Text and image outcomes are verified separately, and uncertain writes are never resent.

**Tech stack:** Python SQLite/HTTP/unittest, Pillow for image metadata and WebP transport conversion, existing Node Bilibili commands and node:test, existing React settings.

**Verified platform constraint and user decision:** Bilibili rejects image attachments in child comments with code -400, “子评论不能带图”. The user chose text-only child replies. Owner and stranger mentions, child replies and proactive thread interactions skip images and image links. Root comments and owner DMs retain gallery delivery. The temporary link probe was deleted after this decision. Bilibili also reuses the concurrently updated scene-ranking helper and excludes images marked 自动回复禁用.

### Task 1: Gallery preparation and upload

- Create `service/bili_gallery.py` and `service/test_bili_gallery.py`; test shared rates 0/1, catalogue-only filenames, traversal/symlink rejection, format conversion and selected-file validation.
- Add Pillow to `service/requirements.txt` and install it in the existing service venv.
- Create `tools/lib/gallery-picture.mjs` in dsh-bili-whale and a narrow `tools/bili-gallery-upload.mjs` wrapper in dsh-remembers. Cache successful uploads by account and file bytes; validate CDN metadata and retain the existing traffic guard.
- Test metadata parsing, cache scope, dry runs and upload failures with fake transport.

### Task 2: Existing transports

- Extend dsh-bili-whale `tools/commands/comment.mjs` with optional validated picture metadata, and `tools/commands/dm.mjs` with owner-only type-2 picture messages. Keep existing gates and dry/go behavior.
- Extend `tools/bili-owner-history.mjs` to return comment pictures and normalized image DM contents for verification. No second credential file or notification listener.

### Task 3: Draft and orchestration integration

- Update `service/bili_runtime.py` so each LLM draft may choose one offered gallery filename, public drafts still exclude private owner context, and shared style settings remain live. Upload only after admission and dry validation; verify both comment text and expected picture URL.
- For owner DMs, acknowledge verified text even when the subsequent image fails, retain the media warning, and never retry already sent text. Exhaustion notices skip gallery and LLM access.
- Add `ownerReply` and `ownerCommentDailyMax` in `service/bili_automation.py`; reuse the existing inbox polling and durable incoming receipts. Test all recipient classes, owner caps, stranger caps and fixed notices.

### Task 4: UI, installation and acceptance

- Update `client.js`, README files and live settings with owner comment reply controls and gallery channel details; preserve all existing rates and limits.
- Run focused Python and Node tests, syntax/diff checks, and browser settings checks.
- Perform limited real upload, top-level image comment, threaded image reply and owner image DM tests with public/conversation readback. Test owner and stranger orchestration with controlled account-role fixtures where a natural incoming event is unavailable. Record exact external limitations rather than counting an API acknowledgement as public success.
- Restart the affected service only after its worker is idle, verify settings/receipts persist, and save a local source backup and verification report.

Protocol references: the existing dynamic image uploader; `https://github.com/inorilzy/bilibili-api/blob/main/bilibili_api/comment.py` and `session.py` (historical upstream source). Actual platform results own live acceptance.
