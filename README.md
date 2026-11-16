# TrackBox CLI

用浏览器授权连接 TrackBox，不经过 npm。安装脚本把单个 `trackbox.mjs` 放到本机，命令本身只依赖已经安装的 Node.js。

```sh
trackbox login
trackbox account
```

`login` 走产品站现成的 OAuth 2.1 + PKCE。同意之后，凭证写在 `~/.trackbox/cli-credentials.json`。`account` 用这张令牌调用 `/mcp`，列出当前账号可见的画布项目。默认范围是 `canvas:read canvas:write`，不包含会扣费的 `canvas:run`。

## 安装

Windows：

```powershell
powershell -ExecutionPolicy Bypass -File .\install.ps1
```

仓库公开之后也可以：

```powershell
irm https://raw.githubusercontent.com/weiduhezi/trackbox-cli/main/install.ps1 | iex
```

macOS / Linux：

```sh
sh install.sh
```

开发环境默认连 `http://localhost:3000`。换地址：

```sh
trackbox login --url https://your-trackbox-host
```

## 命令

```sh
trackbox doctor
trackbox login
trackbox account
trackbox account --json
trackbox logout
```

## 卸载

Windows 删除 `%LOCALAPPDATA%\Programs\trackbox`，并从用户 PATH 去掉这一项，再删除 `%USERPROFILE%\.trackbox`。

macOS / Linux：

```sh
rm ~/.local/bin/trackbox
rm -rf ~/.local/lib/trackbox ~/.trackbox
```
