# TrackBox AI

TrackBox 的命令行工具（[`cli`](cli)）与智能体技能目录（[`skills`](skills)），提供统一的生产接入标识：`trackbox`。

| 安装标识 | 展示名 | 连接地址 | 版本 |
| --- | --- | --- | --- |
| `trackbox` | TrackBox | `http://mcp.trackbox.top/mcp` | `1.0.0` |

接入方式是原生 HTTP Remote MCP（OAuth 2.1 + PKCE）：不预置 client ID、回调地址或凭据，客户端按服务端 OAuth 元数据完成注册与登录。

## 安装

本仓库公开可读，无需 GitHub 授权，本机 Git 或终端能正常访问 GitHub 即可。

### 1. 安装 CLI（[`cli/`](cli)）

Windows（PowerShell）：

```powershell
irm https://raw.githubusercontent.com/weiduhezi/trackbox-ai/main/cli/install.ps1 | iex
```

macOS / Linux：

```bash
curl -fsSL https://raw.githubusercontent.com/weiduhezi/trackbox-ai/main/cli/install.sh | sh
```

装完在终端执行 `trackbox login` 完成 TrackBox OAuth 浏览器授权即可使用。每位使用者用自己的 TrackBox 身份完成授权。

### 2. 安装随包 Skills（[`skills/`](skills)）

```bash
npx skills add weiduhezi/trackbox-ai
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

画布读写与生成依赖 TrackBox Remote MCP，需先完成授权；纯撰写提示词不会触发画布扣费。

## 更新

```bash
# 更新 Skills
npx skills add weiduhezi/trackbox-ai

# 更新 CLI（重新执行安装脚本覆盖即可）
curl -fsSL https://raw.githubusercontent.com/weiduhezi/trackbox-ai/main/cli/install.sh | sh
```

更新后新建任务或运行 `trackbox doctor` 验证。未授权时连接地址返回 `401` 并给出 `WWW-Authenticate: Bearer`，两个 OAuth well-known 端点返回 `200`，这是预期状态。

## 许可

本仓库采用 MIT 许可证发布，详见 [`cli/LICENSE`](cli/LICENSE)。
