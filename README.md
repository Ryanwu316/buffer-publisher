# Buffer Publisher Skill

[![Tests](https://github.com/Ryanwu316/buffer-publisher/actions/workflows/test.yml/badge.svg)](https://github.com/Ryanwu316/buffer-publisher/actions/workflows/test.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

用自然语言准备 Buffer 社媒草稿、排期并核验结果的 Agent Skill，附带零第三方依赖的 Node.js 工具。

An agent skill for drafting, scheduling, and verifying Buffer posts, with a dependency-free Node.js CLI.

它把“内容写好了”落实到可核对的帖子状态：检查账号、文案、时间和图片数量；本地图片先存草稿、上传图片，再排期。适合已经使用 Buffer、希望在 Agent 对话中完成日常发布的人。

## 功能与边界

| 功能 | 实现方式 |
| --- | --- |
| 查询组织与社媒渠道 | Buffer GraphQL，只读 |
| 创建草稿、加入队列、指定时间排期 | CLI，创建后自动回读核验 |
| 检查已有帖子 | 渠道、状态、时间、媒体数量 |
| 发布前预览 | `--dry-run`，无需密钥、不发请求 |
| 本地图片 | Agent 操作 Buffer 网页上传，CLI 回读；CLI 本身不上传文件 |

加入队列可能触发临近的发布时间。请先用草稿演练。这个项目是 Skill 和 CLI，不是 MCP 服务；也不保证帖子最终被社交平台接收。Buffer 的套餐、渠道和平台限制仍适用。

## 安装

需要 **Node.js 20 或更新版本**、Git、一个能加载本地 Skill 和执行脚本的 Agent 客户端。使用本地图片流程还需要客户端支持浏览器操作，以及已登录的 Buffer 网页。

macOS / Linux：

```sh
git clone https://github.com/Ryanwu316/buffer-publisher.git ~/.codex/skills/buffer-publisher
cd ~/.codex/skills/buffer-publisher
node scripts/buffer_publish.mjs --help
```

Windows PowerShell：

```powershell
git clone https://github.com/Ryanwu316/buffer-publisher.git "$env:USERPROFILE/.codex/skills/buffer-publisher"
Set-Location "$env:USERPROFILE/.codex/skills/buffer-publisher"
node scripts/buffer_publish.mjs --help
```

已有同名目录时先检查内容，不要覆盖自己的配置。重启或重新加载客户端使其发现 Skill；其他客户端请将整个目录放入其支持的 Skill 目录。普通网页聊天不能仅靠输入 Skill 名称读取本机文件。

## 配置 Buffer

在 [Buffer API 设置](https://publish.buffer.com/settings/api) 获取个人 API Key。此工具用于操作者自己的 Buffer 账号，不代管其他用户的授权。

推荐通过客户端的私密环境变量设置 `BUFFER_API_KEY`。也可以在**仓库外**创建私有文件，内容为 `BUFFER_API_KEY=你的实际密钥`，然后仅设置其路径：

```sh
export BUFFER_API_KEY_FILE="$HOME/.config/buffer-publisher/key.env"
```

Windows PowerShell：

```powershell
$env:BUFFER_API_KEY_FILE = "$env:USERPROFILE/.config/buffer-publisher/key.env"
```

macOS / Linux 可对已创建的密钥文件执行 `chmod 600`。不要把密钥发进聊天、写入帖子 JSON 或提交到 Git。兼容的旧位置为 `~/.codex/secrets/buffer-publisher.env`；环境变量 `BUFFER_API_KEY` 优先。`.env.example` 只是格式示例，工具不会自动读取仓库中的 `.env`。

## 先试预览，不连接账号

以下命令在仓库根目录执行：

```sh
node scripts/buffer_publish.mjs draft --json-file examples/draft.json --dry-run
```

输出示例：

```json
{
  "ok": true,
  "dryRun": true,
  "inputs": [{
    "assets": [],
    "channelId": "REPLACE_WITH_YOUR_CHANNEL_ID",
    "mode": "addToQueue",
    "schedulingType": "automatic",
    "text": "Hello from Buffer Publisher. This is a draft example.",
    "saveToDraft": true
  }]
}
```

预览验证本地输入，并不表示 Buffer 已经创建或接受帖子。

## 在 Agent 里使用

```text
使用 $buffer-publisher 查询我有哪些 Buffer 渠道。
```

```text
使用 $buffer-publisher，给我选定的 LinkedIn 渠道创建草稿。
文案：这里放我已经确认的正文。
图片：使用我提供的本地图片。上传后核对图片和正文，先保持草稿状态。
```

```text
把刚才核对过的草稿排到 2026 年 11 月 1 日上午 10 点，时区 Asia/Singapore。
完成后核对渠道、时间和图片，并告诉我帖子 ID。
```

请替换示例日期。Skill 不会将“帮我写文案”当成公开发布授权。

## 直接使用 CLI

```sh
# 只读查询真实渠道 ID
node scripts/buffer_publish.mjs list

# 替换 CHANNEL_ID 后创建真实草稿
node scripts/buffer_publish.mjs draft --channel-id CHANNEL_ID --text "Hello from Buffer Publisher"

# 先预览指定时间的排期；替换渠道和未来时间
node scripts/buffer_publish.mjs schedule --channel-id CHANNEL_ID --text "Scheduled example" --due-at "2099-01-01T10:00:00+08:00" --dry-run

# 读取 / 核验真实帖子
node scripts/buffer_publish.mjs get --post-id POST_ID
node scripts/buffer_publish.mjs verify --post-id POST_ID --expected-channel-id CHANNEL_ID --expected-status scheduled --min-assets 1
```

`draft`、`queue`、`schedule` 去掉 `--dry-run` 后会写入 Buffer。`queue` 加入现有队列；`schedule` 使用指定未来时间，要求 `Z` 或明确时区偏移，并自动转为 UTC。`get --post-ids ID1,ID2` 可读取多个帖子。

多行文案和多渠道示例见 [examples/draft.json](examples/draft.json)。排期 JSON 在同一结构中增加 `dueAt`；媒体增加 `assets: [{"image": {"url": "https://example.com/your-image.png"}}]`，URL 必须能由 Buffer 公网访问。CLI 不验证文件内容或平台规格，仍需检查网页预览。

## 出错时

- `ok: false` 和非零退出码表示未完成，查看 `issues`、`stage`、已返回的 `postId` 与 `skippedChannelIds`。
- 多渠道创建遇到第一处错误即停止；已成功的帖子保留。先查看 Buffer 和已知 ID，再决定是否重试，避免重复发布。
- 网络超时或缺少创建结果不代表没有创建成功。工具不自动重试写入，也不自动删除已创建帖子。
- `assetCount: 0` 表示回读没有媒体。需要图片的帖子应保留草稿，完成上传后再排期。
- HTTP 401 检查密钥；429 检查配额。具体限额以 Buffer 当前账号与官方说明为准。

## 开发与反馈

```sh
npm test
```

测试使用 Node 内置测试框架和模拟 API，不需要密钥，也不会创建真实帖子。CI 在 Linux、Windows、macOS 上测试 Node 20、22、24。

欢迎通过 [Issues](https://github.com/Ryanwu316/buffer-publisher/issues) 提交使用反馈：客户端、系统、使用的功能、观察到的结果和希望改进的地方即可。请勿提供 API Key、真实账号 ID、私人帖子或未脱敏截图。成功试用也可以留下反馈，帮助后续改进。

## 官方参考

- [快速开始](https://developers.buffer.com/guides/getting-started.html)
- [认证](https://developers.buffer.com/guides/authentication.html)
- [草稿](https://developers.buffer.com/examples/create-draft-post.html)
- [图片帖](https://developers.buffer.com/examples/create-image-post.html)

本项目独立维护，与 Buffer 无隶属关系。MIT License，见 [LICENSE](LICENSE)。
