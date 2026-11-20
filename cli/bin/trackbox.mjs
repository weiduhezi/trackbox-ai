#!/usr/bin/env node
/**
 * TrackBox CLI。
 * 登录走产品站已有的 OAuth 2.1 + PKCE（/register、/authorize、/token），
 * 连接证明与工具调用走同一来源的 MCP（/mcp）。
 */

import { createHash, randomBytes } from 'node:crypto';
import { createServer } from 'node:http';
import { execFile } from 'node:child_process';
import { chmodSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, extname, join } from 'node:path';
import * as readline from 'node:readline';
import { pathToFileURL } from 'node:url';

export const VERSION = '1.0.0';
export const DEFAULT_ORIGIN = 'https://mcp.trackbox.top';
export const DEFAULT_SCOPE = 'canvas:read canvas:write canvas:run';
const REFRESH_BUFFER_MS = 60_000;
const LOGIN_TIMEOUT_MS = 3 * 60_000;

export const credentialsFile = (home = homedir()) =>
  join(home, '.trackbox', 'cli-credentials.json');

export const normalizeOrigin = (value) => {
  const raw = (value || '').trim() || process.env.TRACKBOX_URL?.trim() || DEFAULT_ORIGIN;
  const withProtocol = /^https?:\/\//i.test(raw) ? raw : `http://${raw}`;
  return new URL(withProtocol).origin;
};

export const resolveCliArgv = (argv = process.argv, procEnv = process.env) => {
  const rawJson = procEnv?.TRACKBOX_CLI_ARGS_JSON;
  if (typeof rawJson === 'string' && rawJson.trim()) {
    try {
      const parsed = JSON.parse(rawJson);
      if (Array.isArray(parsed)) {
        return [argv[0] || 'node', argv[1] || 'trackbox', ...parsed.map((item) => String(item))];
      }
    } catch {
      // 解析失败时回退原始 argv
    }
  }
  return argv;
};

export const parseArgs = (argv) => {
  const args = argv.slice(2);
  const options = {
    url: '',
    scope: '',
    project: '',
    board: '',
    title: '',
    mime: '',
    json: false,
    positionals: [],
  };

  if (args.length === 0 || args[0] === '--help' || args[0] === '-h') {
    return { command: 'help', options };
  }
  if (args[0] === '--version' || args[0] === '-v') {
    return { command: 'version', options };
  }
  if (args[0].startsWith('-')) {
    throw new Error(`未知参数 '${args[0]}'`);
  }

  const command = args[0];
  for (let i = 1; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === '--json') {
      options.json = true;
      continue;
    }
    if (arg === '--url') {
      const value = args[i + 1];
      if (!value) throw new Error('--url 需要一个地址');
      options.url = value;
      i += 1;
      continue;
    }
    if (arg.startsWith('--url=')) {
      options.url = arg.slice('--url='.length);
      continue;
    }
    if (arg === '--scope') {
      const value = args[i + 1];
      if (!value) throw new Error('--scope 需要一个范围');
      options.scope = value;
      i += 1;
      continue;
    }
    if (arg.startsWith('--scope=')) {
      options.scope = arg.slice('--scope='.length);
      continue;
    }
    if (arg === '--project') {
      const value = args[i + 1];
      if (!value) throw new Error('--project 需要一个画布项目 ID');
      options.project = value;
      i += 1;
      continue;
    }
    if (arg.startsWith('--project=')) {
      options.project = arg.slice('--project='.length);
      continue;
    }
    if (arg === '--board') {
      const value = args[i + 1];
      if (!value) throw new Error('--board 需要一个子画板 ID');
      options.board = value;
      i += 1;
      continue;
    }
    if (arg.startsWith('--board=')) {
      options.board = arg.slice('--board='.length);
      continue;
    }
    if (arg === '--title') {
      const value = args[i + 1];
      if (!value) throw new Error('--title 需要一个节点标题');
      options.title = value;
      i += 1;
      continue;
    }
    if (arg.startsWith('--title=')) {
      options.title = arg.slice('--title='.length);
      continue;
    }
    if (arg === '--mime') {
      const value = args[i + 1];
      if (!value) throw new Error('--mime 需要一个 MIME 类型');
      options.mime = value;
      i += 1;
      continue;
    }
    if (arg.startsWith('--mime=')) {
      options.mime = arg.slice('--mime='.length);
      continue;
    }
    if (arg === '--help' || arg === '-h') {
      return { command: 'help', options };
    }
    if (arg.startsWith('-')) {
      throw new Error(`未知参数 '${arg}'`);
    }
    options.positionals.push(arg);
  }

  return { command, options };
};

export const createPkcePair = () => {
  const verifier = randomBytes(32).toString('base64url');
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  return { verifier, challenge };
};

export const buildAuthorizeUrl = ({ origin, clientId, redirectUri, scope, state, challenge }) => {
  const url = new URL('/authorize', origin);
  url.searchParams.set('client_id', clientId);
  url.searchParams.set('redirect_uri', redirectUri);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', scope);
  url.searchParams.set('state', state);
  url.searchParams.set('code_challenge', challenge);
  url.searchParams.set('code_challenge_method', 'S256');
  url.searchParams.set('mcp_oauth_client', 'trackbox-ai');
  return url;
};

export const shouldRefresh = (expiresAt, now = Date.now()) =>
  typeof expiresAt === 'number' && expiresAt > 0 && now >= expiresAt - REFRESH_BUFFER_MS;

export const readCredentials = (file) => {
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8'));
    if (!parsed || typeof parsed.accessToken !== 'string' || !parsed.accessToken) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
};

export const writeCredentials = (file, data) => {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`, { mode: 0o600 });
  try {
    chmodSync(file, 0o600);
  } catch {
    // Windows 上权限位不一定能收紧，文件仍只写在用户目录。
  }
};

export const extractErrorText = (rawText, fallback = '工具执行失败') => {
  if (typeof rawText !== 'string' || !rawText.trim()) return fallback;
  const trimmed = rawText.trim();
  try {
    const body = JSON.parse(trimmed);
    if (body && typeof body === 'object') {
      if (typeof body.error_description === 'string' && body.error_description.trim()) {
        return body.error_description.trim();
      }
      if (typeof body.error === 'string' && body.error.trim()) {
        return body.error.trim();
      }
      if (
        body.error
        && typeof body.error === 'object'
        && typeof body.error.message === 'string'
        && body.error.message.trim()
      ) {
        return body.error.message.trim();
      }
      if (typeof body.message === 'string' && body.message.trim()) {
        return body.message.trim();
      }
      if (Array.isArray(body.message) && body.message.length > 0) {
        return body.message.map((item) => String(item)).join('; ');
      }
    }
  } catch {
    return trimmed;
  }
  return trimmed;
};

export const formatCliError = (error) => {
  const raw = error instanceof Error ? error.message : String(error ?? '');
  if (raw === 'fetch failed') {
    return '无法连接服务端，请检查网络连接或使用 --url 指定产品站地址';
  }
  return extractErrorText(raw, '执行失败');
};

export const readProjects = (rpc) => {
  if (!rpc || typeof rpc !== 'object') {
    throw new Error('MCP 返回了无法识别的内容');
  }
  if (rpc.error?.message) {
    throw new Error(extractErrorText(rpc.error.message, rpc.error.message));
  }
  if (rpc.result?.isError) {
    throw new Error(extractErrorText(rpc.result?.content?.[0]?.text, '读取画布项目失败'));
  }
  const structured = rpc.result?.structuredContent;
  if (Array.isArray(structured?.projects)) {
    return structured.projects;
  }
  const text = rpc.result?.content?.[0]?.text;
  if (typeof text === 'string' && text.trim()) {
    const parsed = JSON.parse(text);
    if (parsed?.error) {
      throw new Error(extractErrorText(text, String(parsed.error)));
    }
    return Array.isArray(parsed?.projects) ? parsed.projects : [];
  }
  return [];
};

export const formatAccount = ({ origin, scope, serverName, serverVersion, projects }) => {
  const lines = [
    '已连接 TrackBox',
    `服务: ${serverName} ${serverVersion}`,
    `地址: ${origin}`,
    `范围: ${scope || '未记录'}`,
    '画布项目:',
  ];
  if (projects.length === 0) {
    lines.push('（没有可见项目）');
    return lines.join('\n');
  }
  for (const project of projects) {
    lines.push(`- ${project.name}  ${project.project_id}`);
  }
  return lines.join('\n');
};

export const formatTools = (tools) => {
  if (!Array.isArray(tools) || tools.length === 0) {
    return '（没有可用工具）';
  }
  return tools
    .map((tool) => `- ${tool.name}: ${tool.description || ''}`)
    .join('\n');
};

const UPLOAD_EXTENSION_MIME_MAP = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mov': 'video/quicktime',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
};

const SUPPORTED_UPLOAD_MIMES = new Set(Object.values(UPLOAD_EXTENSION_MIME_MAP));

/** 按显式声明或文件扩展名推断画布上传允许的 MIME 类型 */
export const inferUploadMimeType = (filePath, explicitMime = '') => {
  const cleanedExplicit = String(explicitMime || '').split(';')[0].trim().toLowerCase();
  const normalizedExplicit =
    cleanedExplicit === 'image/jpg'
      ? 'image/jpeg'
      : cleanedExplicit === 'audio/mp3'
        ? 'audio/mpeg'
        : cleanedExplicit;
  if (normalizedExplicit) {
    if (!SUPPORTED_UPLOAD_MIMES.has(normalizedExplicit)) {
      throw new Error(`画布上传仅支持图片、视频或音频格式（当前: ${normalizedExplicit}）`);
    }
    return normalizedExplicit;
  }
  const ext = extname(String(filePath || '')).toLowerCase();
  const inferred = UPLOAD_EXTENSION_MIME_MAP[ext];
  if (!inferred) {
    throw new Error(
      `画布上传仅支持图片、视频或音频文件（jpg/png/webp/gif/svg/mp4/webm/mov/mp3/wav/ogg）`,
    );
  }
  return inferred;
};

const usage = () => `TrackBox CLI ${VERSION}

  trackbox login                                    浏览器授权并保存凭证（默认含读写与生成范围）
  trackbox account                                  确认已连接，并列出可见画布项目
  trackbox tools                                    列出当前账号可调用的 TrackBox 工具
  trackbox call <tool> [json_args]                  调用指定工具（默认参数 {}）
  trackbox upload <file...> --project <id> [opts]   直传单个或多个参考图/视频/音频并落入画布上传节点
  trackbox mcp                                      以标准 MCP stdio 模式运行
  trackbox logout                                   吊销令牌并删除本地凭证
  trackbox doctor                                   检查产品站 OAuth 端点是否可达
  trackbox version

  trackbox login --url https://mcp.trackbox.top
  trackbox login --scope "canvas:read canvas:write"
  trackbox account --json
  trackbox tools --json
  trackbox upload ./product.png --project <project_id> --title "产品主图" --json
  trackbox upload ./role1.png ./role2.jpg ./motion.mp4 --project <project_id> --json
  trackbox call list_canvas_projects '{"limit":5}'
`;

const readErrorMessage = async (response) => {
  const text = await response.text();
  if (!text.trim()) return `HTTP ${response.status}`;
  return extractErrorText(text, `HTTP ${response.status}`);
};

/**
 * 不用 cmd start。start 会再经一层 cmd 解析，引号挡不住 &，
 * 浏览器只剩 client_id。rundll32 直接把整段 URL 交给系统打开。
 */
export const browserOpenCommand = (url, platform = process.platform) => {
  if (platform === 'win32') {
    return {
      file: 'rundll32',
      args: ['url.dll,FileProtocolHandler', url],
      options: {},
    };
  }
  if (platform === 'darwin') {
    return { file: 'open', args: [url], options: {} };
  }
  return { file: 'xdg-open', args: [url], options: {} };
};

const openBrowser = (url) => {
  if (process.env.TRACKBOX_NO_OPEN_BROWSER === '1') return;
  const command = browserOpenCommand(url);
  execFile(command.file, command.args, command.options);
};

const postJson = async (url, body, headers = {}) => {
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      ...headers,
    },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    throw new Error(await readErrorMessage(response));
  }
  const text = await response.text();
  return text.trim() ? JSON.parse(text) : {};
};

/** 本地回调端口先监听，再拿真实 redirect_uri 去注册，避免授权码回来时对不上。 */
const waitForAuthorizationCode = ({ origin, scope }) =>
  new Promise((resolve, reject) => {
    let settled = false;
    const { verifier, challenge } = createPkcePair();
    const state = randomBytes(16).toString('base64url');
    let clientId = '';

    const fail = (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      server.close();
      reject(error instanceof Error ? error : new Error(String(error)));
    };
    const succeed = (value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      server.close();
      resolve({ ...value, verifier, clientId });
    };

    const server = createServer((req, res) => {
      try {
        const reqUrl = new URL(req.url ?? '/', 'http://127.0.0.1');
        if (reqUrl.pathname !== '/oauth/callback') {
          res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
          res.end('Not Found');
          return;
        }
        const returnedState = reqUrl.searchParams.get('state');
        const error = reqUrl.searchParams.get('error');
        const code = reqUrl.searchParams.get('code');
        if (returnedState !== state) {
          res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
          res.end('state 不匹配，请回到终端重试。');
          fail(new Error('OAuth state 不匹配'));
          return;
        }
        if (error || !code) {
          res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
          res.end('授权已取消，可以关闭此页面。');
          fail(new Error(error || '未收到授权码'));
          return;
        }
        const address = server.address();
        const port = typeof address === 'object' && address ? address.port : 0;
        const redirectUri = `http://127.0.0.1:${port}/oauth/callback`;
        res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('TrackBox CLI 已连接，请回到终端。', () => {
          succeed({ code, redirectUri });
        });
      } catch (error) {
        fail(error);
      }
    });

    const timer = setTimeout(() => fail(new Error('等待浏览器授权超时')), LOGIN_TIMEOUT_MS);
    server.on('error', fail);

    server.listen(0, '127.0.0.1', () => {
      void (async () => {
        try {
          const address = server.address();
          const port = typeof address === 'object' && address ? address.port : 0;
          const redirectUri = `http://127.0.0.1:${port}/oauth/callback`;
          const registered = await postJson(`${origin}/register`, {
            client_name: 'trackbox-ai',
            redirect_uris: [redirectUri],
            grant_types: ['authorization_code', 'refresh_token'],
            response_types: ['code'],
            token_endpoint_auth_method: 'none',
            scope,
          });
          clientId = typeof registered.client_id === 'string' ? registered.client_id : '';
          if (!clientId) {
            throw new Error('注册客户端没有返回 client_id');
          }
          const authorizeUrl = buildAuthorizeUrl({
            origin,
            clientId,
            redirectUri,
            scope,
            state,
            challenge,
          });
          process.stderr.write(`请在浏览器完成授权:\n${authorizeUrl.toString()}\n`);
          openBrowser(authorizeUrl.toString());
        } catch (error) {
          fail(error);
        }
      })();
    });
  });

const toStoredCredentials = ({ origin, clientId, token }) => ({
  origin,
  mcpUrl: `${origin}/mcp`,
  clientId,
  accessToken: token.access_token,
  refreshToken: token.refresh_token,
  expiresAt: typeof token.expires_in === 'number'
    ? Date.now() + token.expires_in * 1000
    : undefined,
  scope: token.scope,
});

const login = async ({ origin, scope, file }) => {
  const granted = await waitForAuthorizationCode({ origin, scope });
  const token = await postJson(`${origin}/token`, {
    grant_type: 'authorization_code',
    code: granted.code,
    redirect_uri: granted.redirectUri,
    client_id: granted.clientId,
    code_verifier: granted.verifier,
  });
  if (!token.access_token) {
    throw new Error('换取访问令牌失败');
  }
  const stored = toStoredCredentials({ origin, clientId: granted.clientId, token });
  writeCredentials(file, stored);
  process.stdout.write(`已登录 ${origin}\n凭证: ${file}\n`);
};

const refreshCredentials = async (stored, file) => {
  if (!stored.refreshToken) {
    throw new Error('访问令牌已过期，请重新执行 trackbox login');
  }
  const token = await postJson(`${stored.origin}/token`, {
    grant_type: 'refresh_token',
    refresh_token: stored.refreshToken,
    client_id: stored.clientId,
  });
  if (!token.access_token) {
    throw new Error('刷新访问令牌失败，请重新执行 trackbox login');
  }
  const next = toStoredCredentials({
    origin: stored.origin,
    clientId: stored.clientId,
    token,
  });
  writeCredentials(file, next);
  return next;
};

const ensureFreshCredentials = async (file) => {
  const stored = readCredentials(file);
  if (!stored) {
    throw new Error('尚未登录。先执行 trackbox login');
  }
  if (!shouldRefresh(stored.expiresAt)) return stored;
  return refreshCredentials(stored, file);
};

const callMcp = async (stored, method, params, id) => {
  const response = await fetch(stored.mcpUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
      Authorization: `Bearer ${stored.accessToken}`,
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id,
      method,
      params,
    }),
  });
  if (response.status === 401) {
    throw Object.assign(new Error('访问令牌被拒绝'), { status: 401 });
  }
  if (!response.ok) {
    throw new Error(await readErrorMessage(response));
  }
  const text = await response.text();
  return text.trim() ? JSON.parse(text) : {};
};

const withAutoRefreshMcp = async (file, fn) => {
  let stored = await ensureFreshCredentials(file);
  try {
    return { stored, data: await fn(stored) };
  } catch (error) {
    if (error?.status !== 401) throw error;
    stored = await refreshCredentials(stored, file);
    return { stored, data: await fn(stored) };
  }
};

const account = async ({ file, json }) => {
  const { stored, data: result } = await withAutoRefreshMcp(file, async (current) => {
    const initialized = await callMcp(current, 'initialize', {
      protocolVersion: '2025-03-26',
      capabilities: {},
      clientInfo: { name: 'trackbox-ai', version: VERSION },
    }, 1);
    const listed = await callMcp(current, 'tools/call', {
      name: 'list_canvas_projects',
      arguments: { limit: 20 },
    }, 2);
    return { initialized, listed };
  });

  const serverInfo = result.initialized?.result?.serverInfo ?? {};
  const projects = readProjects(result.listed);
  const payload = {
    origin: stored.origin,
    scope: stored.scope,
    server: {
      name: serverInfo.name ?? 'trackbox',
      version: serverInfo.version ?? '',
    },
    projects,
  };
  if (json) {
    process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
    return;
  }
  process.stdout.write(`${formatAccount({
    origin: payload.origin,
    scope: payload.scope,
    serverName: payload.server.name,
    serverVersion: payload.server.version,
    projects,
  })}\n`);
};

const listTools = async ({ file, json }) => {
  const { data: rpc } = await withAutoRefreshMcp(file, (current) =>
    callMcp(current, 'tools/list', {}, 1),
  );
  if (rpc.error?.message) {
    throw new Error(rpc.error.message);
  }
  const tools = Array.isArray(rpc.result?.tools) ? rpc.result.tools : [];
  if (json) {
    process.stdout.write(`${JSON.stringify({ tools }, null, 2)}\n`);
    return;
  }
  process.stdout.write(`${formatTools(tools)}\n`);
};

const CLI_BLIND_POSITION_TOOLS = new Set([
  'create_image_node',
  'create_video_node',
  'create_audio_node',
  'create_text_node',
  'create_image_processing_node',
  'create_video_processing_node',
  'update_image_node',
  'update_video_node',
  'update_audio_node',
  'update_text_node',
  'update_image_processing_node',
  'update_video_processing_node',
  'create_upload_node',
]);

/**
 * 校验并清洗 CLI 工具调用参数：
 * - 确保参数为普通 JSON 对象（拦截数组、null、原始值）
 * - 创建/更新/上传画布节点时自动检测并剥离盲猜像素坐标 position，统一交由服务端自动避让排布
 */
export const sanitizeCliToolArgs = (toolName, args) => {
  if (!args || typeof args !== 'object' || Array.isArray(args)) {
    throw new Error('工具参数必须是合法 JSON 对象');
  }
  const trimmedName = String(toolName || '').trim();
  if (!CLI_BLIND_POSITION_TOOLS.has(trimmedName)) {
    return args;
  }
  const next = { ...args };
  delete next.position;
  delete next.basePosition;
  delete next.base_position;
  if (Array.isArray(next.files)) {
    next.files = next.files.map((item) => {
      if (!item || typeof item !== 'object' || Array.isArray(item) || !('position' in item)) {
        return item;
      }
      const cloned = { ...item };
      delete cloned.position;
      return cloned;
    });
  }
  return next;
};

const callToolCommand = async ({ file, toolName, rawArgs, json }) => {
  if (!toolName) {
    throw new Error('请指定工具名，例如: trackbox call list_canvas_projects');
  }
  let parsedArgs = {};
  if (rawArgs) {
    try {
      parsedArgs = JSON.parse(rawArgs);
    } catch {
      throw new Error('工具参数必须是合法 JSON 对象');
    }
  }
  const sanitizedArgs = sanitizeCliToolArgs(toolName, parsedArgs);
  const { data: rpc } = await withAutoRefreshMcp(file, (current) =>
    callMcp(current, 'tools/call', { name: toolName, arguments: sanitizedArgs }, 1),
  );
  if (rpc.error?.message) {
    throw new Error(extractErrorText(rpc.error.message, rpc.error.message));
  }
  if (rpc.result?.isError) {
    throw new Error(extractErrorText(rpc.result?.content?.[0]?.text, '工具执行失败'));
  }
  const output = rpc.result?.structuredContent ?? rpc.result;
  if (json) {
    process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
    return;
  }
  const text = rpc.result?.content?.[0]?.text;
  process.stdout.write(`${typeof text === 'string' ? text : JSON.stringify(output, null, 2)}\n`);
};

const invokeMcpToolStructured = async (file, toolName, args, id = 1) => {
  const { data: rpc } = await withAutoRefreshMcp(file, (current) =>
    callMcp(current, 'tools/call', { name: toolName, arguments: args }, id),
  );
  if (rpc.error?.message) {
    throw new Error(extractErrorText(rpc.error.message, rpc.error.message));
  }
  if (rpc.result?.isError) {
    throw new Error(extractErrorText(rpc.result?.content?.[0]?.text, '工具执行失败'));
  }
  if (rpc.result?.structuredContent && typeof rpc.result.structuredContent === 'object') {
    return rpc.result.structuredContent;
  }
  const text = rpc.result?.content?.[0]?.text;
  return typeof text === 'string' && text.trim() ? JSON.parse(text) : rpc.result;
};

const MAX_CLI_BATCH_UPLOAD_FILES = 20;
const UPLOAD_PUT_CONCURRENCY = 4;

const mapUploadConcurrency = async (items, concurrency, worker) => {
  const results = new Array(items.length);
  let nextIdx = 0;
  const runWorker = async () => {
    while (true) {
      const idx = nextIdx;
      nextIdx += 1;
      if (idx >= items.length) return;
      results[idx] = await worker(items[idx], idx);
    }
  };
  const size = Math.min(Math.max(1, concurrency), items.length);
  await Promise.all(Array.from({ length: size }, () => runWorker()));
  return results;
};

const readAndValidateLocalMedia = (rawPath, explicitMime = '') => {
  const trimmedPath = String(rawPath || '').trim();
  if (!trimmedPath) {
    throw new Error('请提供本地文件路径，例如: trackbox upload ./product.jpg --project <project_id>');
  }

  let stat;
  try {
    stat = statSync(trimmedPath);
  } catch {
    throw new Error(`找不到本地文件: ${trimmedPath}`);
  }
  if (!stat.isFile()) {
    throw new Error(`路径不是普通文件: ${trimmedPath}`);
  }
  if (stat.size <= 0) {
    throw new Error(`本地文件为空: ${trimmedPath}`);
  }

  const fileName = basename(trimmedPath);
  const mimeType = inferUploadMimeType(trimmedPath, explicitMime);
  const fileBuffer = readFileSync(trimmedPath);
  return { filePath: trimmedPath, fileName, mimeType, fileBuffer };
};

const putSingleBufferToPresignedUrl = async (preparedItem, fallbackMime, fileBuffer, fetchImpl) => {
  const putHeaders =
    preparedItem.headers && typeof preparedItem.headers === 'object'
      ? preparedItem.headers
      : { 'Content-Type': preparedItem.mime_type || fallbackMime };
  const putRes = await fetchImpl(preparedItem.upload_url, {
    method: 'PUT',
    headers: putHeaders,
    body: fileBuffer,
  });
  if (!putRes.ok) {
    const errBody = typeof putRes.text === 'function' ? await putRes.text() : '';
    throw new Error(
      `直传文件到存储失败（HTTP ${putRes.status}）${errBody ? `: ${errBody.slice(0, 200)}` : ''}`,
    );
  }
};

/**
 * 本地单个参考素材一键直传并创建画布 upload 节点
 */
export const uploadLocalCanvasFile = async ({
  filePath,
  projectId = '',
  boardId = '',
  title = '',
  explicitMime = '',
  callTool,
  fetchImpl = fetch,
}) => {
  const localFile = readAndValidateLocalMedia(filePath, explicitMime);

  const prepareArgs = {
    ...(projectId.trim() ? { project_id: projectId.trim() } : {}),
    ...(boardId.trim() ? { board_id: boardId.trim() } : {}),
    file_name: localFile.fileName,
    mime_type: localFile.mimeType,
    file_size: localFile.fileBuffer.byteLength,
  };
  const prepared = await callTool('prepare_canvas_upload', prepareArgs);
  if (prepared?.needs_project || !prepared?.upload_url) {
    return prepared;
  }

  await putSingleBufferToPresignedUrl(
    prepared,
    localFile.mimeType,
    localFile.fileBuffer,
    fetchImpl,
  );

  return callTool('create_upload_node', {
    project_id: prepared.project_id || projectId.trim(),
    ...(prepared.board_id || boardId.trim()
      ? { board_id: prepared.board_id || boardId.trim() }
      : {}),
    ...(title.trim() ? { title: title.trim() } : {}),
    object_name: prepared.object_name,
    file_name: prepared.file_name || localFile.fileName,
    mime_type: prepared.mime_type || localFile.mimeType,
    file_size: prepared.file_size || localFile.fileBuffer.byteLength,
    mode: prepared.mode || 'direct',
  });
};

/**
 * 本地单个或多个参考素材（多张图片、图+视频+音频混合）批量直传并一次性落入画布独立 upload 节点：
 * - 单文件自动走单文件契约保持完全向后兼容
 * - 多文件走 prepare_canvas_upload({ files }) -> 并发 PUT -> create_upload_node({ files })，单次原子返回 node_keys
 */
export const uploadLocalCanvasFiles = async ({
  filePaths,
  projectId = '',
  boardId = '',
  title = '',
  explicitMime = '',
  callTool,
  fetchImpl = fetch,
}) => {
  const normalizedPaths = Array.isArray(filePaths)
    ? filePaths.map((p) => String(p || '').trim()).filter(Boolean)
    : [];
  if (normalizedPaths.length === 0) {
    throw new Error(
      '请提供至少一个本地文件路径，例如: trackbox upload ./role.png ./motion.mp4 --project <project_id>',
    );
  }
  if (normalizedPaths.length > MAX_CLI_BATCH_UPLOAD_FILES) {
    throw new Error(`单次最多同时上传 ${MAX_CLI_BATCH_UPLOAD_FILES} 个参考文件`);
  }

  if (normalizedPaths.length === 1) {
    return uploadLocalCanvasFile({
      filePath: normalizedPaths[0],
      projectId,
      boardId,
      title,
      explicitMime,
      callTool,
      fetchImpl,
    });
  }

  // 多文件时若未对单个文件指定后缀则由各自扩展名推断，避免把同一个 --mime 强套给图+视频混传
  const localFiles = normalizedPaths.map((fp) => readAndValidateLocalMedia(fp, explicitMime));

  const prepared = await callTool('prepare_canvas_upload', {
    ...(projectId.trim() ? { project_id: projectId.trim() } : {}),
    ...(boardId.trim() ? { board_id: boardId.trim() } : {}),
    files: localFiles.map((item) => ({
      file_name: item.fileName,
      mime_type: item.mimeType,
      file_size: item.fileBuffer.byteLength,
    })),
  });
  if (prepared?.needs_project || !Array.isArray(prepared?.items)) {
    return prepared;
  }
  if (prepared.items.length !== localFiles.length) {
    throw new Error(
      `预签名返回文件数量（${prepared.items.length}）与请求数量（${localFiles.length}）不一致`,
    );
  }

  await mapUploadConcurrency(
    localFiles,
    UPLOAD_PUT_CONCURRENCY,
    async (localFile, index) => {
      const preparedItem = prepared.items[index];
      if (!preparedItem?.upload_url) {
        throw new Error(`第 ${index + 1} 个文件未返回 upload_url`);
      }
      await putSingleBufferToPresignedUrl(
        preparedItem,
        localFile.mimeType,
        localFile.fileBuffer,
        fetchImpl,
      );
    },
  );

  const trimmedTitle = title.trim();
  return callTool('create_upload_node', {
    project_id: prepared.project_id || projectId.trim(),
    ...(prepared.board_id || boardId.trim()
      ? { board_id: prepared.board_id || boardId.trim() }
      : {}),
    files: localFiles.map((localFile, index) => {
      const preparedItem = prepared.items[index];
      return {
        ...(trimmedTitle ? { title: `${trimmedTitle} ${index + 1}` } : {}),
        object_name: preparedItem.object_name,
        file_name: preparedItem.file_name || localFile.fileName,
        mime_type: preparedItem.mime_type || localFile.mimeType,
        file_size: preparedItem.file_size || localFile.fileBuffer.byteLength,
        mode: preparedItem.mode || 'direct',
      };
    }),
  });
};

const uploadCommand = async ({ file, filePaths, projectId, boardId, title, explicitMime, json }) => {
  const result = await uploadLocalCanvasFiles({
    filePaths,
    projectId,
    boardId,
    title,
    explicitMime,
    callTool: (toolName, args) => invokeMcpToolStructured(file, toolName, args),
  });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (!json && result?.needs_project && typeof result.message === 'string') {
    process.stderr.write(`${result.message}\n`);
  }
};

const runMcpStdio = async ({ file }) => {
  const rl = readline.createInterface({
    input: process.stdin,
    terminal: false,
  });

  for await (const line of rl) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let parsed;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      continue;
    }

    let outboundBody = trimmed;
    if (
      parsed?.method === 'tools/call'
      && typeof parsed?.params?.name === 'string'
      && parsed?.params?.arguments
      && typeof parsed.params.arguments === 'object'
      && !Array.isArray(parsed.params.arguments)
      && CLI_BLIND_POSITION_TOOLS.has(parsed.params.name.trim())
    ) {
      outboundBody = JSON.stringify({
        ...parsed,
        params: {
          ...parsed.params,
          arguments: sanitizeCliToolArgs(parsed.params.name, parsed.params.arguments),
        },
      });
    }

    try {
      const { data: reply } = await withAutoRefreshMcp(file, async (current) => {
        const response = await fetch(current.mcpUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json',
            Authorization: `Bearer ${current.accessToken}`,
          },
          body: outboundBody,
        });
        if (response.status === 401) {
          throw Object.assign(new Error('访问令牌被拒绝'), { status: 401 });
        }
        if (response.status === 202 || response.status === 204) {
          return null;
        }
        const text = await response.text();
        return text.trim() || null;
      });
      if (reply) {
        process.stdout.write(`${reply}\n`);
      }
    } catch (error) {
      if (parsed?.id !== undefined) {
        process.stdout.write(`${JSON.stringify({
          jsonrpc: '2.0',
          id: parsed.id ?? null,
          error: {
            code: -32000,
            message: error instanceof Error ? error.message : String(error),
          },
        })}\n`);
      }
    }
  }
};

const logout = async (file) => {
  const stored = readCredentials(file);
  if (stored?.accessToken && stored.origin) {
    try {
      await postJson(`${stored.origin}/revoke`, { token: stored.accessToken });
    } catch (error) {
      process.stderr.write(`远端吊销失败，仍会删除本地凭证: ${error.message}\n`);
    }
  }
  rmSync(file, { force: true });
  process.stdout.write('已退出\n');
};

const doctor = async (origin) => {
  const response = await fetch(`${origin}/.well-known/oauth-authorization-server`, {
    headers: { Accept: 'application/json' },
  });
  if (!response.ok) {
    throw new Error(`OAuth 元数据不可达 (${response.status})`);
  }
  const metadata = await response.json();
  process.stdout.write([
    `产品站: ${origin}`,
    `授权: ${metadata.authorization_endpoint}`,
    `换票: ${metadata.token_endpoint}`,
    `注册: ${metadata.registration_endpoint}`,
    '下一步: trackbox login',
  ].join('\n') + '\n');
};

export const run = async (argv, env = {}) => {
  const effectiveArgv = resolveCliArgv(argv, env.procEnv ?? process.env);
  delete process.env.TRACKBOX_CLI_ARGS_JSON;
  const home = env.home || homedir();
  const file = env.credentialsFile || credentialsFile(home);
  const { command, options } = parseArgs(effectiveArgv);
  const origin = normalizeOrigin(options.url || env.url || '');
  const scope = options.scope.trim() || DEFAULT_SCOPE;

  if (command === 'help') {
    process.stdout.write(`${usage()}\n`);
    return;
  }
  if (command === 'version') {
    process.stdout.write(`${VERSION}\n`);
    return;
  }
  if (command === 'doctor') {
    await doctor(origin);
    return;
  }
  if (command === 'login') {
    await login({ origin, scope, file });
    return;
  }
  if (command === 'account') {
    await account({ file, json: options.json });
    return;
  }
  if (command === 'tools') {
    await listTools({ file, json: options.json });
    return;
  }
  if (command === 'call') {
    await callToolCommand({
      file,
      toolName: options.positionals[0],
      rawArgs: options.positionals[1],
      json: options.json,
    });
    return;
  }
  if (command === 'upload') {
    await uploadCommand({
      file,
      filePaths: options.positionals,
      projectId: options.project,
      boardId: options.board,
      title: options.title,
      explicitMime: options.mime,
      json: options.json,
    });
    return;
  }
  if (command === 'mcp') {
    await runMcpStdio({ file });
    return;
  }
  if (command === 'logout') {
    await logout(file);
    return;
  }
  throw new Error(`未知命令 '${command}'。执行 trackbox --help 查看用法`);
};

const isDirectRun = process.argv[1]
  && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isDirectRun) {
  run(process.argv).catch((error) => {
    process.stderr.write(`error: ${formatCliError(error)}\n`);
    process.exitCode = 1;
  });
}
