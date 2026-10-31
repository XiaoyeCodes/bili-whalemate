# 本机设置与完整表情包迁移

v1.1.0 保存了 2026-11-01 本机批准导出的非敏感设置。新电脑安装后，可恢复同一套功能参数和提示词。

包含：

- 三张完整人物卡、原有人设、QQ/B 站当前人物卡选择。
- 完整碎碎念写作提示词、主题、发布时间、字数和频率。
- B 站浏览偏好、每日任务数量、抽签概率、私信/评论轮询、写操作额度。
- 主动消息提示词、动作选项、勿扰时段、记忆服务模型及非敏感参数。
- QQ 私聊/群聊提示词、图片识别提示词及识图参数。
- 444 张原始表情包、分类、文字说明、关键词，以及图库、颜文字和 emoji 概率。

不包含 API Key、QQ AppId/AppSecret、B 站 Cookie/登录账号、主人 UID、监听/绑定账号或群号、桥接令牌和配对码。聊天记录、私人画像、自动学习的自我认知、日记和发送历史也不会被打包。每台电脑独立生成桥接密钥。

## 新电脑恢复

推荐下载 [v1.1.0 完整包](https://github.com/XiaoyeCodes/bili-whalemate/releases/tag/v1.1.0)，按 README 安装。也可以：

```powershell
git clone https://github.com/XiaoyeCodes/bili-whalemate.git
Set-Location bili-whalemate
./install.ps1
```

已有源码执行 `git pull` 后，再运行 `./install.ps1`。缺少图库时，安装器自动从同版本 Release 下载，校验压缩包 SHA-256 和所有图片的大小与 SHA-256。素材保留在 Release 中，代码仓库包含目录、说明和哈希。

安装完成后填写模型 Key，并重新登录 B 站、填写主人/监听账号、配置和绑定 QQ。功能设置和提示词无需重新抄写。已经有配置的目标电脑会保留已有值、人物卡选择、登录和聊天数据；重复安装仅补充缺失项，不用默认快照覆盖本机修改。

## 后续更新配置快照

在安装了服务依赖的 Python 环境中执行：

```powershell
python scripts/export_settings.py --home "$env:USERPROFILE/.dsh" --profile web
python scripts/audit_public.py
```

导出器只选择允许公开的字段，数据库只读，完整提示词原样保存。公开前仍需检查提示词是否包含自行填写的私密内容。图库文件经 manifest 校验；运行时计数与使用记录不导出。

「时间、私信与推荐设置」默认收起。计划日期、下次浏览、实际检查间隔与两个单轮操作按钮都在同一个折叠区内，随其一起显示和隐藏。
