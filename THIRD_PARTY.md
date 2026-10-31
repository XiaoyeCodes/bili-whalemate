# Third-party components

The companion implementation derives from [derkinL/dsh-remembers](https://github.com/derkinL/dsh-remembers), MIT; its notice is retained in `LICENSE`. Local extensions add channel-specific persona cards, shared expression settings, scene matching, Bilibili automation, owner/stranger replies, optional daily-life posts and official QQ scheduling.

The vendored Bilibili CLI derives from [Alterssss/dsh-bili-whale](https://github.com/Alterssss/dsh-bili-whale), MIT; its notice is retained in `vendor/bili-whale/LICENSE`. Only CLI modules are shipped; its independent Cordis controller is not activated. Local changes include structured failure receipts, commands running in their caller-owned process, batched private messages, image-backed dynamics and Beijing clock-hour/day request budgets.

The `web-video-reader` backend installs [Panniantong/Agent-Reach](https://github.com/Panniantong/Agent-Reach), MIT, at commit `14c213405669414492bda0f8d52cc6531d062c45` (1.6.0), and its tested `bilibili-cli` backend at 0.6.2. These dependencies are installed separately with the service; their source is not vendored. The adapter invokes the upstream Bilibili subtitle channel with an isolated copy of the existing login and retains subtitle timestamps.

[tencent-connect/dsh-qqbot](https://github.com/tencent-connect/dsh-qqbot), MIT, is installed separately at version 0.5.2. Its source is not redistributed. `install-official-qq-bridge.mjs` applies a checked, backed-up local adapter to that version. The adapter is a community addition.

The gallery is a separately distributed user-provided collection of character stickers. The software MIT license does not grant ownership of the underlying character artwork. Existing embedded copyright text is retained; seeds keep per-image captions and pack names. Compressed pixels and animation frames are unchanged by metadata sanitization.
