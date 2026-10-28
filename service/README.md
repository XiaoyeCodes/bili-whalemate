# Whalemate 记忆与活动服务

服务由组合包的 `runtime.mjs` 启动，通过 `runner.py` 管理监听端口和退出。完整安装步骤见[根目录 README](../README.md)，不需要额外部署一份服务或设置系统启动任务。

## 依赖与数据

Python 3.11+，依赖见 `requirements.txt`：numpy 用于检索，PyYAML 用于配置，qrcode/Pillow 用于二维码和图片处理，chinesecalendar 用于法定节假日。安装器创建独立 venv，不要求 Docker。

SQLite 保存记忆、人格、画像、图库和状态。自动活动使用单独的持久化操作账本，记录每日目标、正在发送、成功、失败和待核查的结果。模型或网络失败时不会把未确认发送记为成功；发送结果不明的操作需要核查后才能继续。

便携启动器设置 `CMEM_DATA_DIR`、`CMEM_MEME_DIR`、`CMEM_BILI_DIR`、`CMEM_NODE_BIN`、`CMEM_DSH_PROFILE` 和端口。B 站工具默认来自组合包的 `vendor/bili-whale`。密钥、账号、QQ 配对信息和聊天数据仅保存在目标电脑，不属于发布种子。

## 人格与人物卡

人物卡存于 `persona_card`，渠道选择存于 `persona_channel`。首次读取时从已有的宪法、形象和身份生成“原有人设”卡，保留旧数据。QQ 和 B 站独立选择人物卡；正在使用的卡不能删除。

QQ/B 站使用所选卡的原始提示文本，画像与工具指令按场景另外提供。公开的陌生人回复不注入主人的私人画像或聊天原文。旧人格字段继续用于迁移及其他会话；AI 更新自我认知不会覆盖已经独立编辑的卡。

B 站主人私信的历史上下文可通过数据目录中的 `bili-dm-context.json` 设置起点；早于该起点的历史不再进入回复草稿，当前待回复的消息仍会处理。该设置不修改平台聊天记录、私信接收游标或长期记忆。文件损坏时停止生成，避免重新带入旧历史。

## 主要 HTTP 接口

| 接口 | 用途 |
|---|---|
| `GET /health`、`GET /stats` | 实例健康、检索能力和记忆统计 |
| `GET /profile`、`POST /search` | 人格与记忆检索 |
| `POST /ingest`、`POST /forget/{id}` | 写入或删除记忆 |
| `POST /consolidate`、`POST /episode` | 去重与事件摘要 |
| `GET/POST /persona`、`POST /persona/self` | 旧人格字段；AI 仅可写自我认知 |
| `GET/POST /persona/cards` | 人物卡与渠道选择 |
| `GET/POST /proactive` | 主动消息和共享表达概率 |
| `GET/POST /bili/automation` | 自动活动配置与执行状态 |

完整路径和验证规则由 `server.py` 定义。设置页保存失败会保留表单并显示错误；未知字段、无效范围和损坏的持久化数据会拒绝继续处理。

## 自动活动

调度器按配置时段和随机间隔浏览。推荐、独立评论、评论互动各自按保存的概率抽签，全未命中时从符合条件的项目中补选一种。每项执行前检查开关、剩余额度和内容条件；同类活动按视频去重，待核查结果和平台暂停会停止后续发送。

主人私信及评论通知按配置周期检查，有新消息才处理。连续私信按顺序合并，处理完成后确认接收游标。碎碎念动态默认关闭，可在设置中配置主题、每日范围、时段及配图；天气过期或节假日数据不可用时，不据此编造当前事实。

小时请求额度按北京时间整点恢复，每日额度按北京时间零点恢复。查询用量不会清空计数；见[小时额度升级说明](../docs/hourly-budget-upgrade.md)。

## 本地验证

```powershell
python -m pip install -r service/requirements.txt
python -m unittest discover -s service -p 'test_*.py'
```

单元测试使用临时数据库、假模型或假网络。`bili_*_live_test.py` 是需要单独配置的真实账号探针，不属于默认测试；运行前需阅读各脚本的执行条件。当前验证范围见[验证记录](../docs/validation.md)。
