import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import test from 'node:test';
import {
  browserOpenCommand,
  buildAuthorizeUrl,
  createPkcePair,
  formatAccount,
  formatTools,
  parseArgs,
  readCredentials,
  buildImageGenerationProjectGate,
  imageGenerationProjectGate,
  readProjects,
  readToolProjectId,
  shouldRefresh,
  writeCredentials,
} from '../bin/trackbox.mjs';

test('parseArgs 读取登录地址和范围', () => {
  const parsed = parseArgs([
    'node',
    'trackbox',
    'login',
    '--url',
    'http://localhost:3000',
    '--scope',
    'canvas:read',
  ]);
  assert.equal(parsed.command, 'login');
  assert.equal(parsed.options.url, 'http://localhost:3000');
  assert.equal(parsed.options.scope, 'canvas:read');
});

test('parseArgs 支持 call 命令位置参数', () => {
  const parsed = parseArgs([
    'node',
    'trackbox',
    'call',
    'list_canvas_projects',
    '{"limit":5}',
    '--json',
  ]);
  assert.equal(parsed.command, 'call');
  assert.deepEqual(parsed.options.positionals, ['list_canvas_projects', '{"limit":5}']);
  assert.equal(parsed.options.json, true);
});

test('PKCE S256 challenge 由 verifier 算出', () => {
  const { verifier, challenge } = createPkcePair();
  const expected = createHash('sha256').update(verifier).digest('base64url');
  assert.equal(challenge, expected);
  assert.ok(verifier.length >= 43);
});

test('Windows 打开授权页不经过 cmd，整段 URL 作为单独参数', () => {
  const url = 'http://localhost:3000/authorize?client_id=tbx_client_demo&redirect_uri=http%3A%2F%2F127.0.0.1%3A34902%2Foauth%2Fcallback&response_type=code';
  const command = browserOpenCommand(url, 'win32');
  assert.equal(command.file, 'rundll32');
  assert.equal(command.args[1], url);
  assert.equal(command.args[1].includes('&redirect_uri='), true);
});

test('授权地址带上 PKCE 和回跳', () => {
  const url = buildAuthorizeUrl({
    origin: 'http://localhost:3000',
    clientId: 'tbx_client_demo',
    redirectUri: 'http://127.0.0.1:9/oauth/callback',
    scope: 'canvas:read',
    state: 'state-1',
    challenge: 'challenge-1',
  });
  assert.equal(url.origin, 'http://localhost:3000');
  assert.equal(url.pathname, '/authorize');
  assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
  assert.equal(url.searchParams.get('redirect_uri'), 'http://127.0.0.1:9/oauth/callback');
  assert.equal(url.searchParams.get('client_id'), 'tbx_client_demo');
});

test('凭证写入后再读出', () => {
  const dir = mkdtempSync(join(tmpdir(), 'trackbox-ai-'));
  const file = join(dir, 'cli-credentials.json');
  try {
    writeCredentials(file, {
      origin: 'http://localhost:3000',
      accessToken: 'tbx_test',
      refreshToken: 'tbx_rt_test',
    });
    const loaded = readCredentials(file);
    assert.equal(loaded.accessToken, 'tbx_test');
    assert.equal(readCredentials(join(dir, 'missing.json')), null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('临近过期才刷新', () => {
  const now = 1_000_000;
  assert.equal(shouldRefresh(now + 30_000, now), true);
  assert.equal(shouldRefresh(now + 120_000, now), false);
  assert.equal(shouldRefresh(undefined, now), false);
});

test('从 MCP 工具结果取出项目列表与格式化工具列表', () => {
  const projects = readProjects({
    result: {
      structuredContent: {
        projects: [{ project_id: 'p1', name: '演示' }],
      },
    },
  });
  assert.equal(projects[0].name, '演示');
  assert.match(formatAccount({
    origin: 'http://localhost:3000',
    scope: 'canvas:read',
    serverName: 'trackbox-trackai-canvas-mcp',
    serverVersion: '1.0.0',
    projects,
  }), /已连接 TrackBox/);
  assert.match(
    formatTools([{ name: 'list_canvas_projects', description: '列出画布项目' }]),
    /list_canvas_projects/,
  );
});

test('工具错误不会被当成空项目', () => {
  assert.throws(
    () => readProjects({
      result: {
        content: [{ type: 'text', text: JSON.stringify({ error: '缺少权限' }) }],
        isError: true,
      },
    }),
    /缺少权限/,
  );
});

test('生成图片未选定项目时停下来，不代选', () => {
  assert.equal(readToolProjectId({ project_id: ' p1 ' }), 'p1');
  assert.equal(readToolProjectId({ prompt: 'a cat' }), '');
  assert.equal(imageGenerationProjectGate({
    method: 'tools/call',
    params: { name: 'create_image_node', arguments: { title: '海报' } },
  })?.toolName, 'create_image_node');
  assert.equal(imageGenerationProjectGate({
    method: 'tools/call',
    params: { name: 'run_node', arguments: { projectId: 'p1', node_key: 'n1' } },
  }), null);
  assert.equal(imageGenerationProjectGate({
    method: 'tools/call',
    params: { name: 'list_canvas_projects', arguments: {} },
  }), null);

  const empty = buildImageGenerationProjectGate([]);
  assert.equal(empty.code, 'NO_CANVAS_PROJECT');
  assert.equal(empty.projects.length, 0);

  const selection = buildImageGenerationProjectGate([
    { project_id: 'p1', name: '广告片' },
    { project_id: 'p2', name: '短片' },
  ]);
  assert.equal(selection.code, 'PROJECT_SELECTION_REQUIRED');
  assert.deepEqual(selection.projects, [
    { project_id: 'p1', name: '广告片' },
    { project_id: 'p2', name: '短片' },
  ]);
});
