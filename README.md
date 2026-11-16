# TrackBox Marketplace & CLI

TrackBox 的智能体插件、随包 Skills 与命令行工具（CLI）仓库，提供统一的生产接入标识：`trackbox`。

| 安装标识 | 展示名 | 连接地址 | 版本 |
| --- | --- | --- | --- |
| `trackbox` | TrackBox | `http://mcp.trackbox.top/mcp` | `1.0.0` |

接入方式是原生 HTTP Remote MCP（OAuth 2.1 + PKCE）：插件与 CLI 不预置 client ID、回调地址或静态凭据，客户端按服务端 OAuth 元数据（`/.well-known/oauth-authorization-server`）动态完成客户端注册与浏览器登录授权。

## 安装

本仓库公开可读，无需 GitHub 授权，本机 Git / 终端能正常访问 GitHub 即可。

### 1. 安装插件与随包 Skills

**Cursor / Kimi / 通用智能体（Skills CLI）：**

```bash
npx skills add weiduhezi/trackbox-cli
```

**Claude Code：**

```bash
/plugin marketplace add weiduhezi/trackbox-cli
/plugin install trackbox@trackbox
```

**Codex：**

```bash
codex plugin marketplace add https://github.com/weiduhezi/trackbox-cli.git --ref main
codex plugin add trackbox@trackbox        # 生产：http://mcp.trackbox.top/mcp
```

装完重新加载插件或新建任务，在 MCP 连接管理里对 `trackbox` 完成 TrackBox OAuth 登录即可使用。每位使用者用自己的 TrackBox 身份完成授权。

### 2. 安装 TrackBox CLI

安装脚本把单个 `trackbox.mjs` 放到本机用户目录，不经过 npm，命令本身只依赖本机已安装的 Node.js（>= 20）。

**Windows（PowerShell）：**

```powershell
irm https://raw.githubusercontent.com/weiduhezi/trackbox-cli/main/install.ps1 | iex
```

**macOS / Linux：**

```bash
curl -fsSL https://raw.githubusercontent.com/weiduhezi/trackbox-cli/main/install.sh | sh
```

安装后在终端执行登录：

```bash
trackbox login
```

## 随包 Skills

| Skill | 展示名 | 用途 |
| --- | --- | --- |
| `trackbox-creative-cli` | TrackBox 画布工具规程 | 查画布节点、建待运行图片/视频/音频节点、改参数、两段式确认运行与资产入库 |
| `trackbox-creative-production` | TrackBox 视觉创意生产 | 风格探索 → 情绪板 → 品牌定位 → 商品组图 / 广告测试批次 → 成片精修的完整制作链路 |
| `trackbox-seedance-prompt-zh` | Seedance 2.0 视频提示词（中文） | 面向 Seedance 多模态视频模型的 `@引用` 语法、运镜复刻、音乐卡点、电商广告与短剧分镜 |
| `trackbox-seedance-prompt-en` | Seedance 2.0 Video Prompting | Seedance 多模态视频模型的英文分镜、运镜与音画同步提示词工程 |
| `trackbox-kling-3-prompting` | Kling 3.0 导演提示词 | 文生视频、图生视频、首尾帧过渡与多镜头序列的电影级导演提示词 |
| `trackbox-nano-banana-prompting` | Nano Banana 图像提示词 | 角色一致性、商品棚拍与多参考图合成的结构化生图提示词 |
| `trackbox-gpt-image-prompting` | GPT Image 视觉与排版提示词 | 海报文字排版、UI 概念图、风格化插画与局部编辑提示词 |

画布读写与生成需要 TrackBox Remote MCP，需先完成登录授权；纯撰写提示词可直接使用随包 Skills。默认授权范围是 `canvas:read canvas:write`，涉及扣费的节点运行强制走两段确认（`run_node` 预估确认 → `confirm_canvas_run` 入队生成）。

## CLI 命令

```bash
trackbox doctor                                    # 检查服务端 OAuth 元数据是否可达
trackbox login                                     # 浏览器授权并保存凭证到 ~/.trackbox/cli-credentials.json
trackbox account                                   # 确认已连接，并列出当前账号可见的画布项目
trackbox tools                                     # 列出当前令牌可调用的 MCP 工具
trackbox call list_canvas_projects '{"limit":5}'   # 直接调用指定 MCP 工具
trackbox mcp                                       # 以标准 MCP stdio 桥接模式运行
trackbox logout                                    # 吊销令牌并删除本地凭证
```

开发环境默认连接 `http://localhost:3000`，可通过 `--url` 指定目标站点：

```bash
trackbox login --url https://your-trackbox-host
```

## 更新

```bash
npx skills add weiduhezi/trackbox-cli
# Codex 插件更新：
codex plugin marketplace upgrade trackbox
codex plugin add trackbox@trackbox
```

更新后新建任务验证。未授权时连接地址 `http://mcp.trackbox.top/mcp` 返回 `401` 并给出 `WWW-Authenticate: Bearer`，两个 OAuth well-known 端点返回 `200`，这是预期状态。

## 许可

本仓库采用 [MIT](LICENSE) 许可证发布。
