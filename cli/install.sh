#!/bin/sh
# TrackBox CLI installer for macOS and Linux.
# curl -fsSL https://raw.githubusercontent.com/weiduhezi/trackbox-ai/main/cli/install.sh | sh

set -eu

command -v node >/dev/null 2>&1 || {
  printf 'error: Node.js 20 or newer is required\n' >&2
  exit 1
}

NODE_BIN="$(command -v node)"
NODE_MAJOR="$(node -p "process.versions.node.split('.')[0]" 2>/dev/null || printf '0')"
if [ "${NODE_MAJOR}" -lt 20 ] 2>/dev/null; then
  printf 'error: Node.js 20 or newer is required (found %s)\n' "$(node -v 2>/dev/null || printf 'unknown')" >&2
  exit 1
fi

PREFIX="${HOME}/.local"
BIN_DIR="${PREFIX}/bin"
LIB_DIR="${PREFIX}/lib/trackbox"
mkdir -p "$BIN_DIR" "$LIB_DIR"

SOURCE_DIR=""
case "$0" in
  */*) SOURCE_DIR=$(CDPATH= cd -- "$(dirname "$0")" 2>/dev/null && pwd || true) ;;
esac

if [ -n "$SOURCE_DIR" ] && [ -f "${SOURCE_DIR}/bin/trackbox.mjs" ]; then
  cp "${SOURCE_DIR}/bin/trackbox.mjs" "${LIB_DIR}/trackbox.mjs"
else
  curl -fsSL --proto '=https' --tlsv1.2 \
    -o "${LIB_DIR}/trackbox.mjs" \
    "https://raw.githubusercontent.com/weiduhezi/trackbox-ai/main/cli/bin/trackbox.mjs"
fi

cat > "${BIN_DIR}/trackbox" <<EOF
#!/bin/sh
if [ -x "${NODE_BIN}" ]; then
  exec "${NODE_BIN}" "\${HOME}/.local/lib/trackbox/trackbox.mjs" "\$@"
fi
exec node "\${HOME}/.local/lib/trackbox/trackbox.mjs" "\$@"
EOF
chmod 0755 "${BIN_DIR}/trackbox" "${LIB_DIR}/trackbox.mjs"

printf 'Installed trackbox to %s\n' "${BIN_DIR}/trackbox"
case ":${PATH}:" in
  *":${BIN_DIR}:"*) ;;
  *)
    printf '\n%s is not on PATH. Add it:\n\n' "$BIN_DIR"
    printf '  echo '\''export PATH="%s:$PATH"'\'' >> ~/.zshrc\n' "$BIN_DIR"
    printf '  export PATH="%s:$PATH"\n' "$BIN_DIR"
    ;;
esac

printf '\nNext:\n'
printf '  trackbox login\n'
printf '  trackbox login --scope "canvas:read canvas:write canvas:run"  # enable generation\n'
printf '\nDesktop MCP config (absolute paths for Cursor / Claude Desktop):\n'
printf '{\n  "mcpServers": {\n    "trackbox": {\n      "command": "%s",\n      "args": ["%s/trackbox.mjs", "mcp"]\n    }\n  }\n}\n' "$NODE_BIN" "$LIB_DIR"
