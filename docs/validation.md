# v1.0.0 validation

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
