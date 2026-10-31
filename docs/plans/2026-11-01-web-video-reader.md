# Bilibili subtitle reader integration plan

**Goal:** Install the supplied reading skill, expose it as an enabled read-only Bilibili tool, and verify real subtitle reading through the whale's registered tool.

**Architecture:** The reviewed ZIP supplies instructions only. Bundle adapted instructions and register the skill with Harness. Following the user's clarification, use the reviewed latest GitHub Agent Reach channel (1.6.0, fixed commit) and its tested bili-cli 0.6.2 backend. Reuse the saved login in an isolated native session and reserve shared read budget before launch. Return explicit subtitle or metadata-only coverage through a typed tool, bili_run and the settings checkbox.

**Tech Stack:** Node.js, Python service routing, existing Cordis skill/tool registries and offline fixtures.

1. Audit both supplied Markdown files; record that no executable engine or new credentials are included.
2. Add a strict Bilibili URL/BV parser, timestamped caption reader, metadata-only fallback and safe result-size handling; test without platform writes.
3. Register the bundled skill, typed agent tool and checkbox; preserve the permission gate and expose structured coverage instead of the previous tail-only CLI output.
4. Run focused tests, install the reviewed files and test a real recent video. Inspect the transcript source and have the configured whale model call the registered read-only tool and summarize only its returned evidence.
5. Report the tested video, actual subtitle source and limitations. Never claim that metadata, comments or danmaku are spoken video content, and do not send a test social message.
