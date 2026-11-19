# TrackBox AI

TrackBox 的命令行工具（[`cli`](cli)）与智能体技能目录（[`skills`](skills)），提供统一的生产接入标识：`trackbox`。

| 安装标识 | 展示名 | 连接方式 | 版本 |
| --- | --- | --- | --- |
| `trackbox` | TrackBox | 本机 `trackbox mcp`（跟随 `trackbox login` 保存的产品站） | `1.0.0` |

接入走已登录的 TrackBox CLI，不在插件里预置 client ID、回调地址或凭证。默认产品站是 `https://mcp.trackbox.top`，也可以用 `trackbox login --url <产品站>` 切换到测试或本地环境。

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

装完在终端执行 `trackbox login` 完成 TrackBox OAuth 浏览器授权即可使用。每位使用者用自己的 TrackBox 身份完成授权。默认范围是 `canvas:read canvas:write canvas:run`（生成任务强制经过 `run_node` 询价与 `confirm_canvas_run` 二次确认后才扣费）。若只需读写画布、不允许触发生成：

```bash
trackbox login --scope "canvas:read canvas:write"
```

### 2. 安装随包 Skills（[`skills/`](skills)）

```bash
npx skills add weiduhezi/trackbox-ai
```

### 3. Claude Code 插件

仓库根目录的 `.claude-plugin/marketplace.json` 把市场定义为 `trackbox`，插件名也是 `trackbox`。在 Claude Code 会话里执行：

```text
/plugin marketplace add weiduhezi/trackbox-ai
/plugin install trackbox@trackbox
```

插件通过本机 `trackbox mcp` 连接，所以要先完成 CLI 安装和 `trackbox login`。

## 命令

`trackbox` 有 9 个命令。终端执行 `trackbox --help` 可查看同样的说明。

| 命令 | 作用 |
| --- | --- |
| `trackbox login` | 打开浏览器授权，把凭证保存在本机（默认含 `canvas:read canvas:write canvas:run`） |
| `trackbox account` | 确认已连接，并列出可见的画布项目 |
| `trackbox tools` | 列出当前账号能调用的画布工具 |
| `trackbox call <工具名> [json]` | 调用某一个工具 |
| `trackbox upload <本地文件...> --project <项目ID>` | 直传单个或多个参考图/视频/音频（支持多图及图+视频混合）并原子落入画布独立 `upload` 节点，返回 `node_keys` 供 `reference_nodes` 连线 |
| `trackbox mcp` | 以标准 MCP 的 stdio 模式运行，给 Cursor、Claude 接 |
| `trackbox logout` | 吊销令牌并删除本机凭证 |
| `trackbox doctor` | 检查产品站的授权、换票、注册地址是否可达 |
| `trackbox version` | 显示版本 |

常用参数：

```bash
trackbox login
trackbox login --url https://mcp.test.trackbox.top
trackbox login --scope "canvas:read canvas:write"
trackbox account --json
trackbox tools --json
trackbox upload ./product.png --project <project_id> --title "产品主图" --json
trackbox upload ./role1.png ./scene2.jpg ./motion.mp4 --project <project_id> --json
trackbox call list_canvas_projects "{\"limit\":5}"
```

`trackbox login` 不带 `--url` 时默认连线上 `https://mcp.trackbox.top`。`trackbox tools` 列出来的是画布工具，通用调用走 `trackbox call`，本机参考文件上画布可直接走 `trackbox upload`。

## 随包 Skills

| Skill | 展示名 | 用途 |
| --- | --- | --- |
| `trackbox-creative-cli` | TrackBox 画布工具规程 | 选/建画布项目、上传参考图落板连线、建待运行图片/视频/音频节点、两段式确认运行与资产入库 |
| `trackbox-creative-production` | TrackBox 视觉创意生产 | 风格探索 → 情绪板 → 品牌定位 → 商品组图 / 广告测试批次 → 成片精修的完整制作链路 |
| `trackbox-seedance-prompt-zh` | Seedance 2.0 视频提示词（中文） | 面向 Seedance 多模态视频模型的 `@引用` 语法、运镜复刻、音乐卡点、电商广告与短剧分镜 |
| `trackbox-seedance-prompt-en` | Seedance 2.0 Video Prompting | Seedance 多模态视频模型的英文分镜、运镜与音画同步提示词工程 |
| `trackbox-kling-3-prompting` | Kling 3.0 导演提示词 | 文生视频、图生视频、首尾帧过渡与多镜头序列的电影级导演提示词 |
| `trackbox-nano-banana-prompting` | Nano Banana 图像提示词 | 角色一致性、商品棚拍与多参考图合成的结构化生图提示词 |
| `trackbox-gpt-image-prompting` | GPT Image 视觉与排版提示词 | 海报文字排版、UI 概念图、风格化插画与局部编辑提示词 |

画布读写与生成依赖已登录的 `trackbox mcp`。纯撰写提示词不会触发画布扣费。

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
