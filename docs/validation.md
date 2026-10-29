# Validation

## Settings readback, 2026-10-29

The Bilibili settings browser fixture now adds backend defaults and reverses object key order after saving. The UI accepts matching submitted values, keeps array order significant and reports the exact path when a submitted value actually differs. The same browser flow deliberately changes the returned daily write limit and checks that saving remains visibly incomplete. `node test/bili-settings.browser.mjs <Harness workspace>` and `node test/test_client.mjs` passed. A previously uncertain standalone comment remained absent within the existing bounded public readback, so its receipt was retained as unknown and no additional comment was sent.

## Nested mentions, 2026-10-29

The nested-mention follow-up passed 145 Bilibili Python tests and 5 focused Node tests for exact floor lookup and author checks. After extending signed-resource URL filtering to protocol-relative URLs, the 29 comment tests passed again. Read-only live inspection confirmed that an `at` notification reported a zero root for a nested comment, while the comment record identified a different root floor. The corrected author preflight passed; a single previously unsent owner reply was recovered and publicly read back. The local diagnostic confirmed that the actual draft received separate root/current comment text and available subtitle/danmaku material. Video frames and comment pictures were not analyzed.

## Comment recovery follow-up, 2026-10-29

The merged source passed 84 Node tests (`node --test test/*.test.mjs vendor/bili-whale/tests/*.test.mjs` with `WHALEMATE_TEST_PYTHON` configured), 192 Python service tests with `-X utf8`, and 8 setup tests. The comment retry regression covers persisted drafts, restart, midnight, exhausted AI quota, fixed notices, feature changes, owner changes and unknown delivery. On the running installation, the previously unsent owner comment was recovered once and publicly read back; this is separate from the isolated tests and did not send test messages to strangers. See [delivery behavior](comment-delivery-fix.md).

The complete 444-image archive was built locally and audited; the existing GitHub Release was not replaced. Package inspection checks that the expression policy, service, vendored transport and QQ bridge files are included and that Python caches and private runtime files are excluded. An obsolete live probe tied to a personal UID was removed from distributed source. Python's older standalone memory test fixtures emit unclosed-database resource warnings; assertions pass, and this result does not claim the fixtures are warning-free.

`node test/test_client.mjs` also passed after updating its old single-section fixture to the current six settings sections and the Web meme projection. It checks the portable module ID, settings registration, initial loading view and projection cleanup; it does not replace a visual browser test.

## Source update, 2026-10-29

The following checks ran against the updated portable checkout on Windows. They use fake model/network responses, temporary account directories or isolated browser fixtures; no live social messages were sent. The published v1.0.0 ZIP was not rebuilt or replaced.

| Check | Result |
|---|---|
| `python -m unittest discover -s service -p 'test_*.py'` | 192 passed, including multi-action draws and fallback selection, per-kind deduplication, structured delivery failures, calendar budgets, persona cards and expression delivery |
| `python -m unittest discover -s test -p test_setup.py` | 8 passed, including preserved credentials and custom service/gallery paths in the QQ bridge |
| `node --test test/*.test.mjs vendor/bili-whale/tests/*.test.mjs` with `WHALEMATE_TEST_PYTHON` set | 80 passed; the subsequently added adapter tests passed separately as described below |
| `node --test test/qq-adapter-install.test.mjs test/bili-gallery-upload.test.mjs test/bili-history-helper.test.mjs` | 9 passed after portable path adjustments; the two new adapter cases verify custom profiles, shared hardlink isolation, repeat installation and refusal of unsupported QQ versions |
| `node test/bili-settings.browser.mjs <Harness source>` | Passed: invalid numbers block writes and focus the field; valid probabilities persist; budget counters refresh and reset at the hour; technical details stay collapsed |
| `node test/persona-cards.browser.mjs <Harness source>` | Passed: card creation, editing and independent QQ/Bilibili selection |
| `npm pack --dry-run --json` | All new runtime helpers included; nested npm exclusions keep Python caches and temporary test databases out of the package |
| `python scripts/audit_public.py` and a separate local-private-value comparison | 191 source files passed; no loaded local credential values matched |

The seeded expression tests sample 100,000 replies and cover both probability endpoints. Service tests pass with SQLite ResourceWarnings from existing test connections; these warnings are not delivery failures. Installation with real accounts, a new complete Release ZIP, macOS/Linux and the packaged Desktop executable were not revalidated for this source update.

## v1.0.0 release

Validation ran on Windows with Node.js 24.13, Python 3.13 and DeepSeek Harness source version 0.2.1-rc.3. The running personal installation was left in place. Installation tests used a separate DSH_HOME with a Chinese directory name, an unbound official QQ plugin, a blank OS-user home for Bilibili credentials, and separate web/service/bridge ports. No publisher account credentials or private conversation database were copied into the test installation.

| Check | Result |
|---|---|
| `python -m unittest discover -s test -p test_setup.py` | 8 tests passed: clean seeds, empty history, credential preservation, independent bridge secrets, corrupted image rejection, filename rejection, manifest consistency, profile ownership and YAML expression preservation |
| `python -m unittest discover -s service -p 'test_bili*.py'` | 78 passed: random daily targets, persisted budgets, owner/stranger replies, text-only child comments, private image delivery, verification and non-retry behavior |
| `python -m unittest discover -s service -p test_meme_matching.py` | 10 passed: contextual matching and disabled assets |
| `python -m unittest test_official_qq_scheduler test_windows_connections test_gallery_json_mode` from service | 11 passed: QQ scheduling, connection/settings paths, QR dependency and JSON mode |
| `node --test test/*.test.mjs` with WHALEMATE_TEST_PYTHON set | 20 passed: shared probabilities, image metadata, upload caching, bridge pairing/admission/resume and real subprocess ownership |
| Real `install.ps1` into a separate profile | Python environment, 444 verified assets, fresh data, official QQ 0.5.2 adapter and native Whalemate bundle installed; dump-config succeeded |
| `test/install.browser.mjs` | Gallery/persona visible; Bilibili settings saved and survived reload; official QQ binding page opened; zero uncaught browser errors |
| Owned process shutdown | Stopping the isolated Harness also stopped its service and released both test ports; original personal web and service listeners remained running |
| Public data audit | Source and all gallery binaries scanned for credential patterns and the publisher's locally loaded private values; seed fields allow only approved persona, settings and catalogue data |

These are 107 Python tests, 20 Node tests and one browser acceptance flow. The fixed stranger-limit message, text-only nested replies and partial-send failure paths are covered without live social writes. Per-file gallery SHA-256 checks cover all 444 resources. Tests do not measure long-run probability distributions; they verify that configured probabilities reach the decision code, including the 0%/100% endpoints.

The package deliberately contains no usable API key, Bilibili login or QQ binding. Cross-machine live delivery requires the target computer's local login and key entry; this release test does not claim to have sent a QQ/Bilibili message from a second physical computer. The official QQ package may log a binding-panel retry before Harness has mounted a session surface; its settings binding page remains available. macOS/Linux and the packaged Desktop executable were not exercised.

Public audit commands are `python scripts/audit_public.py` and `python scripts/audit_public.py --archive dist/bili-whalemate-v1.0.0.zip`. The separate comparison against local private values is intentionally kept outside the published repository so the forbidden values themselves are not distributed.
