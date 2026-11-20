import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import {
  DEFAULT_SCOPE,
  browserOpenCommand,
  buildAuthorizeUrl,
  createPkcePair,
  extractErrorText,
  formatAccount,
  formatCliError,
  formatTools,
  inferUploadMimeType,
  parseArgs,
  readCredentials,
  readProjects,
  resolveCliArgv,
  sanitizeCliToolArgs,
  shouldRefresh,
  uploadLocalCanvasFile,
  uploadLocalCanvasFiles,
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

test('CLI 工具报错提取可读文案，不再原样打印 JSON 字符串', () => {
  const raw = JSON.stringify({ error: '节点不存在: fake-key', status: 404 });
  assert.equal(extractErrorText(raw), '节点不存在: fake-key');
  assert.equal(formatCliError(new Error(raw)), '节点不存在: fake-key');
  assert.equal(
    extractErrorText(JSON.stringify({ message: ['标题不能为空', '提示词不能为空'] })),
    '标题不能为空; 提示词不能为空',
  );
  assert.match(formatCliError(new Error('fetch failed')), /--url/);
});

test('安装脚本检查 Node 20+ 并在结尾打印绝对路径 MCP 配置', () => {
  const testDir = dirname(fileURLToPath(import.meta.url));
  const shContent = readFileSync(join(testDir, '..', 'install.sh'), 'utf8');
  const ps1Content = readFileSync(join(testDir, '..', 'install.ps1'), 'utf8');

  assert.match(shContent, /Node\.js 20 or newer is required/);
  assert.match(shContent, /"mcpServers"/);
  assert.match(shContent, /canvas:run/);

  assert.match(ps1Content, /Node\.js 20 or newer is required/);
  assert.match(ps1Content, /"mcpServers"/);
  assert.match(ps1Content, /canvas:run/);
  assert.match(ps1Content, /TRACKBOX_CLI_ARGS_JSON/);
});

test('Windows PowerShell 包装器参数数组可无损还原双引号 JSON 参数', () => {
  const argv = resolveCliArgv(
    ['node', 'trackbox'],
    {
      TRACKBOX_CLI_ARGS_JSON: JSON.stringify(['call', 'list_models', '{"modality":"image"}']),
    },
  );
  const parsed = parseArgs(argv);
  assert.equal(parsed.command, 'call');
  assert.deepEqual(parsed.options.positionals, ['list_models', '{"modality":"image"}']);
});

test('Claude Code 与 Cursor 插件清单结构合法且字段严格对齐', () => {
  const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
  const marketplace = JSON.parse(
    readFileSync(join(repoRoot, '.claude-plugin', 'marketplace.json'), 'utf8'),
  );
  const claudePlugin = JSON.parse(
    readFileSync(join(repoRoot, '.claude-plugin', 'plugin.json'), 'utf8'),
  );
  const cursorPlugin = JSON.parse(
    readFileSync(join(repoRoot, '.cursor-plugin', 'plugin.json'), 'utf8'),
  );
  const mcpJson = JSON.parse(readFileSync(join(repoRoot, '.mcp.json'), 'utf8'));

  assert.equal(marketplace.name, 'trackbox');
  assert.equal(marketplace.plugins[0].name, 'trackbox');
  assert.equal(claudePlugin.name, 'trackbox');
  assert.equal('displayName' in claudePlugin, false);
  assert.equal(cursorPlugin.displayName, 'TrackBox');
  assert.equal(cursorPlugin.skills, './skills/');
  assert.equal(cursorPlugin.mcpServers, './.mcp.json');
  assert.deepEqual(mcpJson.mcpServers.trackbox, { command: 'trackbox', args: ['mcp'] });
});

test('DEFAULT_SCOPE 默认包含 canvas:run，开箱即可发起两段确认生成', () => {
  assert.equal(DEFAULT_SCOPE, 'canvas:read canvas:write canvas:run');
});

test('parseArgs 支持 upload 命令的 --project / --board / --title 参数', () => {
  const parsed = parseArgs([
    'node',
    'trackbox',
    'upload',
    './hero-product.png',
    '--project',
    'proj_demo',
    '--board=board_main',
    '--title',
    '产品主图参考',
    '--json',
  ]);
  assert.equal(parsed.command, 'upload');
  assert.deepEqual(parsed.options.positionals, ['./hero-product.png']);
  assert.equal(parsed.options.project, 'proj_demo');
  assert.equal(parsed.options.board, 'board_main');
  assert.equal(parsed.options.title, '产品主图参考');
  assert.equal(parsed.options.json, true);
});

test('inferUploadMimeType 按文件扩展名推断常见画布媒体类型并拦截不支持后缀', () => {
  assert.equal(inferUploadMimeType('C:\\tmp\\bottle.JPG'), 'image/jpeg');
  assert.equal(inferUploadMimeType('/tmp/pack.png'), 'image/png');
  assert.equal(inferUploadMimeType('/tmp/demo.mp4'), 'video/mp4');
  assert.equal(inferUploadMimeType('/tmp/bgm.mp3'), 'audio/mpeg');
  assert.throws(() => inferUploadMimeType('/tmp/archive.zip'), /仅支持图片、视频或音频/);
});

test('uploadLocalCanvasFile 串联 prepare_canvas_upload -> PUT 二进制 -> create_upload_node 返回 node_key', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'trackbox-upload-'));
  const imgFile = join(dir, 'product.png');
  const rawBytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const { writeFileSync: writeTmp } = await import('node:fs');
  writeTmp(imgFile, rawBytes);

  const toolCalls = [];
  let putRequest = null;

  try {
    const result = await uploadLocalCanvasFile({
      filePath: imgFile,
      projectId: 'proj_a',
      boardId: 'board_default',
      title: '产品参考图',
      callTool: async (name, args) => {
        toolCalls.push({ name, args });
        if (name === 'prepare_canvas_upload') {
          return {
            ok: true,
            project_id: 'proj_a',
            board_id: 'board_default',
            file_name: 'product.png',
            mime_type: 'image/png',
            file_size: rawBytes.length,
            upload_url: 'https://storage.example.com/presigned-put',
            object_name: 'tenant_a/proj_a/product.png',
            mode: 'direct',
            headers: { 'Content-Type': 'image/png' },
          };
        }
        if (name === 'create_upload_node') {
          return {
            ok: true,
            applied: true,
            project_id: 'proj_a',
            board_id: 'board_default',
            node_key: 'upload-att_product_1',
            type: 'image',
            title: '产品参考图',
            artifact_url: '/api/images/ai-chat-files/tenant_a/proj_a/product.png',
          };
        }
        throw new Error(`unexpected tool: ${name}`);
      },
      fetchImpl: async (url, init) => {
        putRequest = { url, init };
        return { ok: true, status: 200, text: async () => '' };
      },
    });

    assert.equal(result.node_key, 'upload-att_product_1');
    assert.equal(toolCalls.length, 2);
    assert.equal(toolCalls[0].name, 'prepare_canvas_upload');
    assert.deepEqual(toolCalls[0].args, {
      project_id: 'proj_a',
      board_id: 'board_default',
      file_name: 'product.png',
      mime_type: 'image/png',
      file_size: rawBytes.length,
    });
    assert.equal(putRequest.url, 'https://storage.example.com/presigned-put');
    assert.equal(putRequest.init.method, 'PUT');
    assert.deepEqual(putRequest.init.headers, { 'Content-Type': 'image/png' });
    assert.equal(Buffer.compare(Buffer.from(putRequest.init.body), rawBytes), 0);
    assert.equal(toolCalls[1].name, 'create_upload_node');
    assert.deepEqual(toolCalls[1].args, {
      project_id: 'proj_a',
      board_id: 'board_default',
      title: '产品参考图',
      object_name: 'tenant_a/proj_a/product.png',
      file_name: 'product.png',
      mime_type: 'image/png',
      file_size: rawBytes.length,
      mode: 'direct',
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('trackbox-creative-cli SKILL 覆盖建项目、参考图上传落板与 reference_nodes 连线规程', () => {
  const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
  const skillText = readFileSync(
    join(repoRoot, 'skills', 'trackbox-creative-cli', 'SKILL.md'),
    'utf8',
  );
  assert.match(skillText, /create_ai_project/);
  assert.match(skillText, /prepare_canvas_upload/);
  assert.match(skillText, /create_upload_node/);
  assert.match(skillText, /trackbox upload/);
  assert.match(skillText, /reference_nodes/);
  assert.equal(skillText.includes('音频节点会失败'), false);
  assert.equal(skillText.includes('告诉用户先在 TrackBox 创建一个画布项目'), false);
  assert.match(skillText, /node_keys/);
  assert.match(skillText, /video_generation_type/);
  assert.match(skillText, /不要传 `position`/);
  assert.match(skillText, /create_text_node/);
  assert.match(skillText, /create_video_processing_node/);
  assert.match(skillText, /create_image_processing_node/);
  assert.match(skillText, /connect_nodes/);
  assert.match(skillText, /image-processing/);
  assert.match(skillText, /video-processing/);
});

test('sanitizeCliToolArgs 检测并剥离 CLI 建点/改点/上传节点中的盲猜 position 且拦截非对象参数', () => {
  assert.deepEqual(
    sanitizeCliToolArgs('create_text_node', {
      project_id: 'proj_a',
      text: '开场',
      position: { x: 0, y: 0 },
    }),
    {
      project_id: 'proj_a',
      text: '开场',
    },
  );

  assert.deepEqual(
    sanitizeCliToolArgs('create_video_node', {
      project_id: 'proj_a',
      title: '太阳轮和履带驱动',
      prompt: '机械齿轮带动履带',
      position: { x: 0, y: 0 },
      basePosition: { x: 80, y: 80 },
    }),
    {
      project_id: 'proj_a',
      title: '太阳轮和履带驱动',
      prompt: '机械齿轮带动履带',
    },
  );

  assert.deepEqual(
    sanitizeCliToolArgs('create_upload_node', {
      project_id: 'proj_a',
      position: { x: 100, y: 100 },
      files: [
        { object_name: 'a.png', file_name: 'a.png', mime_type: 'image/png', file_size: 10, position: { x: 10, y: 20 } },
      ],
    }),
    {
      project_id: 'proj_a',
      files: [
        { object_name: 'a.png', file_name: 'a.png', mime_type: 'image/png', file_size: 10 },
      ],
    },
  );

  assert.throws(() => sanitizeCliToolArgs('create_video_node', ['not-an-object']), /JSON 对象/);
  assert.throws(() => sanitizeCliToolArgs('create_video_node', null), /JSON 对象/);
});

test('uploadLocalCanvasFiles 支持多张参考图与视频混合一次批量预签名、并发 PUT 与单次原子落板', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'trackbox-batch-upload-'));
  const img1 = join(dir, 'role1.png');
  const img2 = join(dir, 'scene2.jpg');
  const vid1 = join(dir, 'motion.mp4');
  const { writeFileSync: writeTmp } = await import('node:fs');
  writeTmp(img1, Buffer.from([1, 2, 3, 4]));
  writeTmp(img2, Buffer.from([5, 6, 7, 8, 9]));
  writeTmp(vid1, Buffer.from([10, 11, 12, 13, 14, 15]));

  const toolCalls = [];
  const putUrls = [];

  try {
    const parsed = parseArgs([
      'node',
      'trackbox',
      'upload',
      img1,
      img2,
      vid1,
      '--project',
      'proj_mix',
      '--json',
    ]);
    assert.deepEqual(parsed.options.positionals, [img1, img2, vid1]);

    const result = await uploadLocalCanvasFiles({
      filePaths: parsed.options.positionals,
      projectId: 'proj_mix',
      boardId: 'board_mix',
      title: '参考组',
      callTool: async (name, args) => {
        toolCalls.push({ name, args });
        if (name === 'prepare_canvas_upload') {
          return {
            ok: true,
            project_id: 'proj_mix',
            board_id: 'board_mix',
            count: 3,
            items: [
              {
                index: 0,
                file_name: 'role1.png',
                mime_type: 'image/png',
                file_size: 4,
                upload_url: 'https://storage.example.com/put/role1.png',
                object_name: 't/proj_mix/role1.png',
                mode: 'direct',
                headers: { 'Content-Type': 'image/png' },
              },
              {
                index: 1,
                file_name: 'scene2.jpg',
                mime_type: 'image/jpeg',
                file_size: 5,
                upload_url: 'https://storage.example.com/put/scene2.jpg',
                object_name: 't/proj_mix/scene2.jpg',
                mode: 'direct',
                headers: { 'Content-Type': 'image/jpeg' },
              },
              {
                index: 2,
                file_name: 'motion.mp4',
                mime_type: 'video/mp4',
                file_size: 6,
                upload_url: 'https://storage.example.com/put/motion.mp4',
                object_name: 't/proj_mix/motion.mp4',
                mode: 'direct',
                headers: { 'Content-Type': 'video/mp4' },
              },
            ],
          };
        }
        if (name === 'create_upload_node') {
          return {
            ok: true,
            applied: true,
            project_id: 'proj_mix',
            board_id: 'board_mix',
            count: 3,
            node_key: 'upload-att_1',
            node_keys: ['upload-att_1', 'upload-att_2', 'upload-att_3'],
          };
        }
        throw new Error(`unexpected tool: ${name}`);
      },
      fetchImpl: async (url) => {
        putUrls.push(url);
        return { ok: true, status: 200, text: async () => '' };
      },
    });

    assert.deepEqual(result.node_keys, ['upload-att_1', 'upload-att_2', 'upload-att_3']);
    assert.equal(toolCalls.length, 2);
    assert.equal(toolCalls[0].name, 'prepare_canvas_upload');
    assert.deepEqual(toolCalls[0].args, {
      project_id: 'proj_mix',
      board_id: 'board_mix',
      files: [
        { file_name: 'role1.png', mime_type: 'image/png', file_size: 4 },
        { file_name: 'scene2.jpg', mime_type: 'image/jpeg', file_size: 5 },
        { file_name: 'motion.mp4', mime_type: 'video/mp4', file_size: 6 },
      ],
    });
    assert.equal(putUrls.length, 3);
    assert.equal(toolCalls[1].name, 'create_upload_node');
    assert.deepEqual(toolCalls[1].args, {
      project_id: 'proj_mix',
      board_id: 'board_mix',
      files: [
        {
          title: '参考组 1',
          object_name: 't/proj_mix/role1.png',
          file_name: 'role1.png',
          mime_type: 'image/png',
          file_size: 4,
          mode: 'direct',
        },
        {
          title: '参考组 2',
          object_name: 't/proj_mix/scene2.jpg',
          file_name: 'scene2.jpg',
          mime_type: 'image/jpeg',
          file_size: 5,
          mode: 'direct',
        },
        {
          title: '参考组 3',
          object_name: 't/proj_mix/motion.mp4',
          file_name: 'motion.mp4',
          mime_type: 'video/mp4',
          file_size: 6,
          mode: 'direct',
        },
      ],
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
