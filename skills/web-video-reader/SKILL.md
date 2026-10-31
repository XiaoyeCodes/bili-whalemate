---
name: web-video-reader
description: 用户发来 B 站视频链接或 BV 号并希望了解内容时，读取实际字幕，区分字幕与标题简介，再给出有依据的摘要。
---

# B 站视频阅读

1. 阅读 `references/reading.md` 中的证据规则。
2. 调用 `bili_read_video({"url":"视频链接或BV号"})`。也可调用 `bili_run`，command 为 `web-video-reader`，args 为只含链接或 BV 号的数组。
3. 只根据工具实际返回的字幕总结。视频只有标题和简介时，说明尚未取得字幕。
4. 用当前 Agent 的语言风格给出简短概括，需要时列出关键内容，并附来源链接。
5. 工具失败时说明原因，请用户提供正文或字幕，不编造内容。

这是所提供 `web-video-reader` 技能的 DeepSeek Harness / 鲸鱼娘适配版。原技能依赖的 `read_web` 视频通道由 `bili_read_video` 实现，模型无需运行本地脚本。权限由 B 站工具中的 `web-video-reader` 复选框控制；关闭后两个调用入口均不可读取。此适配只接受 B 站链接，不提供通用网页读取能力。

按 coverage 和 evidence 区分实际字幕与标题简介；`truncated=true` 时只取得部分字幕。自动字幕可能有识别误差，不等于看过画面。不得将简介、观众弹幕、热评或错误消息当成视频原话。读取失败时说明原因，不补造内容。

若用户需要原话和时间点，逐字复制单个 `segments.text` 及其对应的 `from`，不改写字幕、不拼接多个片段后冒充原话；自己的概括与原话分开表述。
