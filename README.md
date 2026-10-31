# bili-whalemate · 大肥鱼

把大肥鱼的人设、回复能力、B 站活动、官方 QQ 推送、表情图库和设置迁移到另一台电脑的 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)。这是基于 dsh-remembers 和 dsh-bili-whale 的社区组合包，不是 DeepSeek 或腾讯官方产品。

当前源码包含[评论漏回修复与验证说明](docs/comment-delivery-fix.md)：明确未发送的评论会保存草稿并在冷却后恢复，通知按平台游标正确翻页。`main` 分支包含下述最新功能；下面的一句话安装仍下载已发布的 v1.0.0 完整包。源码更新不会覆盖该 Release，使用新功能需要用更新后的源码和已校验图库重新安装。

## 一句话安装

把这句话发给另一台电脑上的开发助手：

> 请安装 https://github.com/XiaoyeCodes/bili-whalemate 的 v1.0.0 完整插件包，按照 README 运行 bootstrap.ps1，使用我现有的 DeepSeek Harness profile；保留本机密钥和账号配置，安装自检后告诉我去哪里填写账号。

Windows PowerShell 也可以直接执行：

```powershell
& ([scriptblock]::Create((Invoke-WebRequest -UseBasicParsing 'https://raw.githubusercontent.com/XiaoyeCodes/bili-whalemate/v1.0.0/bootstrap.ps1').Content))
```

需要 Node.js 24.9+、Python 3.11+（含 venv），以及可用的 `dsh` 命令。桌面版可以先在设置里安装 `dsh` 命令；安装前完全退出 Harness。引导脚本下载约 300 MB 的完整资源包并校验 SHA-256，安装依赖、初始化干净数据、安装固定版本官方 QQ 插件，最后通过原生 `dsh plugin add` 注册组合包。默认选择已有的 desktop profile，否则使用 web。源码运行方式可在 Harness 仓库目录执行该命令，或给下载的 `install.ps1` 传入 `-HarnessSource <源码目录>`。

无法访问 raw.githubusercontent.com 时，从 [v1.0.0 Release](https://github.com/XiaoyeCodes/bili-whalemate/releases/tag/v1.0.0) 下载 ZIP 和 SHA256SUMS，校验并解压，在 `bili-whalemate` 目录执行 `./install.ps1`。仅 `git clone` 或在插件管理器添加 GitHub URL **不含图库二进制，也不会创建 Python 环境**，请使用完整安装器。

手动指定目录、profile 或端口：

```powershell
./install.ps1 -Profile web -DshHome 'D:\WhalemateData' -ServicePort 8080 -BridgePort 3081
```

更改端口后，在「记忆服务 API 设置」同步修改服务地址。重复安装保留本机密钥、绑定、人设修改和已有记忆，仅补充缺少的默认字段与图库条目。已启用独立 dsh-remembers/dsh-bili-whale 的 profile 会提示先处理重复插件，不自动叠加第二套监听器。

## 首次启动

1. 重启 Harness。服务随插件启动，退出或卸载插件时关闭；不创建系统开机启动任务。Web 使用 `dsh web`，桌面版正常打开应用。
2. 在「模型」配置本机 DeepSeek key；在「记忆服务 API 设置」配置服务使用的模型 key。若两处都调用模型，需要分别配置，插件不复制另一台电脑的 key。
3. 在「B 站」扫码登录，填写要被 @ 的主人 UID（纯数字）与昵称。自动活动开关和每日范围已迁移，需要完成账号与模型配置后才能正常执行。
4. 在「QQ 机器人」用手机 QQ 完成官方扫码绑定。读取本机 `$DSH_HOME/remembers-service/official-qq-bridge.json` 的 `pairingCode`，从主人 QQ 向机器人发送 `绑定自动浏览 <pairingCode>`，完成主动推送的主人绑定。该文件的 token、OpenID 和验证码都是本机私密数据。

自定义 `DSH_HOME` 时，今后启动也必须使用同一个环境变量。默认是用户目录的 `.dsh`。B 站凭据沿用每系统用户的 `~/.bili-ai/credentials.json`，安装器不读取、不覆盖它；同一系统账号下的多个 profile 共用这个 B 站登录账号。QQ 的机器人绑定保存在目标 profile，主动推送的主人绑定保存在本机桥接配置。

## 能力与默认设置

碎碎念可结合保存的完整写作提示词、勾选主题、当天视频与评论互动，以及主人聊天的话题和感受，生成日记式动态。聊天原文不进入公开动态生成输入。详见[当天经历与碎碎念](docs/daily-experiences.md)。

| 功能 | 保存的设置 |
|---|---|
| 人设与话术 | 保留已有设定；支持多张人物卡，QQ 和 B 站可分别选择，也可选择同一张 |
| 刷视频 | 每天随机 6–10 条；08:00–23:00，间隔随机 10–30 分钟 |
| 推荐主人 | 每天随机 1–2 次；根据内容写推荐语、评论区 @ 主人，并推送官方 QQ |
| 独立评论 / 评论互动 | 每天随机 0–2 / 0–1 次，分别可开关 |
| 每轮公开活动 | 推荐、独立评论、评论互动各自抽签，默认各 50%；符合条件时执行 1–3 种 |
| 碎碎念动态 | 默认关闭；可设置主题、时段、每日范围和图库配图，天气与节假日使用单独核实的数据 |
| 主人私信 / 评论 @ | 每天最多 20 / 20 次 |
| 评论发送恢复 | 明确未提交的冷却、预算等待到期后重试；复用草稿，默认最多 3 次发送尝试；结果不明不重发 |
| 陌生人 @ 或回复 | 每天最多 5 次 AI 回复；超限固定文本不调用模型，同一陌生人每天最多一次超限提示 |
| 表情与图库 | 444 张及分包、描述、关键词、情绪、禁用标记；表情包 / 颜文字 / emoji 各 20% |
| 图片发送 | QQ、B 站私信、B 站顶层独立评论和推荐；楼中楼只发文字 |
| 记忆能力 | 新电脑重新积累、检索与整理；使用干净数据库，勿扰时间 23:00–08:00 |

每日数量是随机目标，仍受登录、互关、接口限制、内容质量和发布结果影响，不保证硬凑满。每轮对已启用、有剩余额度且满足内容条件的公开活动分别抽签；全未命中时补选一种，随机排列执行。待核查、接口暂停或额度耗尽会中止后续发送，没有合适活动时只浏览。

颜文字和 emoji 按设置独立抽样，QQ/B 站开启控制后正文由宿主处理，关闭后沿用人物卡。表情包概率决定是否尝试匹配，匹配不合适时可以不发，并非每五条必发一张。公开陌生人互动不注入私人聊天原文；匹配失败不会随机补图。主人连续私信按消息顺序合并处理，发送结果不明时保留待核查记录，避免自动重复发送。

写入额度页展示当前账号的实际用量与已保存上限；小时额度在北京时间整点恢复，每日额度在北京时间零点恢复，详见[升级说明](docs/hourly-budget-upgrade.md)。保存前会定位无效数字字段，错误摘要与技术详情分别显示。

超限提示为 `token快要用完啦，我的主人不让我回答啦`，不调用 LLM。正常理解视频、聊天、生成评论和图片匹配仍可能消耗本机模型 token。所有开关、数量、时段、概率、图库和人设都能在设置页修改；不启用旧鲸鱼插件的独立人设、轮询或 OneBot/NapCat。

## 隐私与本机文件

发布的是代码、可迁移配置、提示词、图库和干净数据库的种子。**不含** B 站 UID/昵称/cookie、模型 key、QQ 个人信息/AppID/AppSecret/OpenID、绑定 token、聊天记录、个人画像、历史记忆/日记、历史评论和通知日志。图库使用次数清零。图片元数据清理后保留画面、动画与方向，没有上传本机 SQLite 整库。

| 路径（相对 DSH_HOME） | 用途 |
|---|---|
| `remembers-data/` | 本机模型配置、记忆库、图库索引和活动设置 |
| `media/whalemate/` | 已校验的图库 |
| `whalemate/runtime.json`、`whalemate/venv/` | 本机路径、端口和 Python 依赖 |
| `whalemate/service.log` | 本机诊断日志，禁止上传 |
| `remembers-service/official-qq-bridge.json` | 本机生成的推送凭据与主人绑定 |

关闭应用后可执行 `dsh plugin --profile <名称> remove bili-whalemate` 停用本插件，保留本机数据。官方 QQ 适配器支持固定版本 0.5.2，逐项核对源码并备份入口；替换文件时断开 pnpm 共享硬链接。升级官方插件后需重新验收，不对未知源码自动打补丁。

## 验证与开发

私信和评论回复仅处理本次服务或功能开启后收到的新消息，重启不补发旧消息；恢复与备份规则见[接收起点说明](docs/inbound-activation.md)。

登录验证会区分真实失效与临时请求失败；后台按读取预算安排检查，见[登录保持与轮询说明](docs/login-stability.md)。

回复不设置本地固定字数上限，见[回复长度说明](docs/reply-length.md)。

Windows 已使用独立 DSH_HOME、空白账号目录、不同端口进行安装和 Web 启动检查。测试不使用发布者账号发消息；目标电脑需重新登录后验证它自己的实际投递。见[验证记录](docs/validation.md)。

```powershell
node --test test/*.test.mjs
node --test vendor/bili-whale/tests/*.test.mjs
python -m unittest discover -s test -p test_setup.py
python -m unittest discover -s service -p 'test_*.py'
python scripts/audit_public.py
python scripts/build_release.py
```

Python 测试需先安装 `service/requirements.txt`；Node 的服务生命周期测试使用 `WHALEMATE_TEST_PYTHON` 指定安装了这些依赖的解释器。离线设置页验收可运行 `node test/bili-settings.browser.mjs <Harness源码目录>` 和 `node test/persona-cards.browser.mjs <Harness源码目录>`，使用 Harness 的 Playwright 依赖和内置假服务，不访问实际账号。构建 Release 需在本地 `gallery/` 放入 manifest 对应资源；Git 不重复保存 300 MB 二进制。每张图的哈希在 `seed/gallery-manifest.json`，安装前完整校验，损坏则停止。

安装器和端到端验收目前覆盖 **Windows**；macOS/Linux 未验收。验证的 Harness 源码版本为 0.2.1-rc.3；desktop profile 由同一安装器处理，但本次没有在另一台电脑或打包桌面应用上实测。依赖与素材见 [THIRD_PARTY.md](THIRD_PARTY.md)。
