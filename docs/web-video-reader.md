# 视频字幕阅读

`web-video-reader` 是可单独关闭的只读 B 站工具，默认开启。模型可调用 `bili_read_video({"url":"BV号或B站视频链接"})`；`bili_run` 的同名命令使用相同权限和结构化结果。关闭设置页的复选框会同时禁用两个入口。

用户提供的技能压缩包仅包含 `SKILL.md` 和 `references/reading.md` 两份说明，没有读取引擎。原说明要求调用其宿主的 `read_web` 工具，本包保留证据规则并适配为 Harness 的 `bili_read_video`。随包发布 `skills/` 并向 Harness 注册技能。

按用户要求，以 [Agent Reach GitHub main 的已核对提交](https://github.com/Panniantong/Agent-Reach/blob/14c213405669414492bda0f8d52cc6531d062c45/agent_reach/channels/bilibili.py)为正式后端：Agent Reach 1.6.0、bilibili-cli 0.6.2。依赖固定在 `service/requirements-video-reader.txt`，由安装器随服务依赖安装；调用真实上游 Bilibili channel，不在失败后切回另一套读取实现。返回 `backendVersion`、`backendRef` 和 `nativeVersion` 供核对。

后端复制已保存的当前账号登录到服务数据目录下独立的 `video-reader/` 会话，使用上游凭据写入函数，不读取浏览器、不主动扫码、不修改其他项目的 Agent Reach 登录。启动原生后端前预留 12 次共享读取预算，覆盖其视频信息、分 P、播放器和签名请求；按预留量保守计费，平台限流和登录失败进入现有保护，不自动重试。它不读弹幕、热评或画面，也不做音频识别或画面文字识别。当前上游没有返回所选轨道的 AI/人工类型，标记为 `captionType=unspecified`，不猜测。

| 返回值 | 可据此做什么 |
|---|---|
| `coverage=subtitles` | 根据实际返回的字幕概括讲述内容，`segments` 保留起止秒数 |
| `coverage=metadata_only` | 只说明标题和简介，明确未取得字幕，不能假称看完视频 |
| `coverage=unavailable`、`ok=false` | 报告读取失败，不把错误信息当视频正文 |
| `truncated=true` | 只概括返回的部分，不能补造剩余内容 |

支持 BV 号、完整视频链接，以及解析到受支持视频地址的 `b23.tv` 短链接。只接受 B 站视频地址，短链不携带登录 cookie。与当前上游一致，字幕通道只读第一分 P，其他分 P 明确报不支持，不悄悄读错。字幕选择与下载由上游执行；仅向模型返回经过筛选的标题、简介、字幕、时间戳和版本，不暴露登录 cookie 或带临时签名的字幕地址。

字幕最多返回 32,000 字符、2,000 段，超出时保留开头并标明截断。这个读取结果上限与发评论、私信的文字长度无关。完整结构化结果通过专用服务端点返回，避免通用 CLI 输出末尾截取丢失字幕开头。

离线测试覆盖真实上游通道接线、字幕与简介分离、无字幕、不支持的分 P、长字幕截断、短链验证、外部地址拒绝、预算不足和平台保护、工具开关和技能注册。实测及模型调用记录保存在本机诊断目录，不随代码发布，不发送测试私信或评论。
