#!/usr/bin/env node
/**
 * TrackBox CLI。
 * 登录走产品站已有的 OAuth 2.1 + PKCE（/register、/authorize、/token），
 * 连接证明与工具调用走同一来源的 MCP（/mcp）。
 */

import { createHash, randomBytes } from 'node:crypto';
import { createServer } from 'node:http';
import { execFile } from 'node:child_process';
import { chmodSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import * as readline from 'node:readline';
import { pathToFileURL } from 'node:url';

export const VERSION = '0.1.0';
export const DEFAULT_ORIGIN = 'http://localhost:3000';
export const DEFAULT_SCOPE = 'canvas:read canvas:write';
const REFRESH_BUFFER_MS = 60_000;
const LOGIN_TIMEOUT_MS = 3 * 60_000;

export const credentialsFile = (home = homedir()) =>
  join(home, '.trackbox', 'cli-credentials.json');

export const normalizeOrigin = (value) => {
  const raw = (value || '').trim() || process.env.TRACKBOX_URL?.trim() || DEFAULT_ORIGIN;
  const withProtocol = /^https?:\/\//i.test(raw) ? raw : `http://${raw}`;
  return new URL(withProtocol).origin;
};

export const parseArgs = (argv) => {
  const args = argv.slice(2);
  const options = { url: '', scope: '', json: false, positionals: [] };

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
  url.searchParams.set('mcp_oauth_client', 'trackbox-cli');
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

export const readProjects = (rpc) => {
  if (!rpc || typeof rpc !== 'object') {
    throw new Error('MCP 返回了无法识别的内容');
  }
  if (rpc.error?.message) {
    throw new Error(rpc.error.message);
  }
  const structured = rpc.result?.structuredContent;
  if (Array.isArray(structured?.projects)) {
    return structured.projects;
  }
  const text = rpc.result?.content?.[0]?.text;
  if (typeof text === 'string' && text.trim()) {
    const parsed = JSON.parse(text);
    if (parsed?.error) {
      throw new Error(String(parsed.error));
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

const usage = () => `TrackBox CLI ${VERSION}

  trackbox login                      浏览器授权并保存凭证
  trackbox account                    确认已连接，并列出可见画布项目
  trackbox tools                      列出当前账号可调用的 TrackBox 工具
  trackbox call <tool> [json_args]    调用指定工具（默认参数 {}）
  trackbox mcp                        以标准 MCP stdio 模式运行
  trackbox logout                     吊销令牌并删除本地凭证
  trackbox doctor                     检查产品站 OAuth 端点是否可达
  trackbox version

  trackbox login --url http://localhost:3000
  trackbox login --scope "canvas:read canvas:write"
  trackbox account --json
  trackbox tools --json
  trackbox call list_canvas_projects '{"limit":5}'
`;

const readErrorMessage = async (response) => {
  const text = await response.text();
  if (!text.trim()) return `HTTP ${response.status}`;
  try {
    const body = JSON.parse(text);
    if (typeof body.error_description === 'string' && body.error_description) {
      return body.error_description;
    }
    if (typeof body.message === 'string' && body.message) return body.message;
    if (typeof body.error === 'string' && body.error) return body.error;
  } catch {
    return text.trim();
  }
  return text.trim();
};

const openBrowser = (url) => {
  if (process.platform === 'win32') {
    execFile('cmd', ['/c', 'start', '', url]);
    return;
  }
  if (process.platform === 'darwin') {
    execFile('open', [url]);
    return;
  }
  execFile('xdg-open', [url]);
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
            client_name: 'trackbox-cli',
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
      clientInfo: { name: 'trackbox-cli', version: VERSION },
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
  const { data: rpc } = await withAutoRefreshMcp(file, (current) =>
    callMcp(current, 'tools/call', { name: toolName, arguments: parsedArgs }, 1),
  );
  if (rpc.error?.message) {
    throw new Error(rpc.error.message);
  }
  if (rpc.result?.isError) {
    const errText = rpc.result?.content?.[0]?.text || '工具执行失败';
    throw new Error(errText);
  }
  const output = rpc.result?.structuredContent ?? rpc.result;
  if (json) {
    process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
    return;
  }
  const text = rpc.result?.content?.[0]?.text;
  process.stdout.write(`${typeof text === 'string' ? text : JSON.stringify(output, null, 2)}\n`);
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

    try {
      const { data: reply } = await withAutoRefreshMcp(file, async (current) => {
        const response = await fetch(current.mcpUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json',
            Authorization: `Bearer ${current.accessToken}`,
          },
          body: trimmed,
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
  const home = env.home || homedir();
  const file = env.credentialsFile || credentialsFile(home);
  const { command, options } = parseArgs(argv);
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
    process.stderr.write(`error: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
