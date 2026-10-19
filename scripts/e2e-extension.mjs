#!/usr/bin/env node
/**
 * 真实扩展加载验收（非无头 Chrome + CDP）
 * ------------------------------------------------------------------
 * 验证的是「打包后的扩展本身」：manifest 是否合法、Service Worker 是否启动、
 * content script 是否注入、图标/弹窗资源是否可加载。
 *
 * 做法：
 *   1. 复制扩展到临时目录，把 matches 改成 http://127.0.0.1:8899/*（仅测试用）
 *   2. 用临时用户目录、离屏窗口启动独立的 Chrome，--load-extension 加载扩展
 *   3. 打开 fixtures/ext-fixture.html（不含内联脚本，只能靠扩展翻译）
 *   4. 通过 CDP 读取页面自检探针并断言
 *
 * 用法：node scripts/e2e-extension.mjs
 * 前置：项目根目录 8899 端口有静态服务器
 */
import { spawn } from 'node:child_process';
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import http from 'node:http';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CHROME = process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 8899;

const log = (m) => console.log(m);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function request(method, url, timeout = 3000) {
  return new Promise((resolve, reject) => {
    const req = http.request(url, { method }, (res) => {
      let body = '';
      res.on('data', (d) => (body += d));
      res.on('end', () => resolve({ status: res.statusCode, body }));
    });
    req.on('error', reject);
    req.setTimeout(timeout, () => req.destroy(new Error('timeout')));
    req.end();
  });
}

function get(url, timeout = 3000) {
  return request('GET', url, timeout);
}

function prepare() {
  const ext = mkdtempSync(path.join(tmpdir(), 'aiz-ext-real-'));
  const ignore = new Set(['recon', 'docs', 'dist', 'node_modules', '.git', 'fixtures', 'scripts']);
  cpSync(ROOT, ext, {
    recursive: true,
    filter: (src) => {
      const rel = path.relative(ROOT, src);
      if (!rel) return true;
      return !ignore.has(rel.split(path.sep)[0]);
    }
  });

  const manifestPath = path.join(ext, 'manifest.json');
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  const cs = manifest.content_scripts[0];
  cs.matches = [`http://127.0.0.1:${PORT}/*`];
  cs.js = cs.js.filter((f) => existsSync(path.join(ext, f)));
  cs.css = (cs.css || []).filter((f) => existsSync(path.join(ext, f)));
  manifest.host_permissions = [`http://127.0.0.1:${PORT}/*`];
  if (manifest.action && manifest.action.default_popup && !existsSync(path.join(ext, manifest.action.default_popup))) {
    delete manifest.action.default_popup;
  }
  if (manifest.options_ui && !existsSync(path.join(ext, manifest.options_ui.page))) {
    delete manifest.options_ui;
  }
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf8');

  // 生成不含内联脚本的 fixture（只能靠扩展翻译）
  const src = readFileSync(path.join(ROOT, 'fixtures', 'preview.html'), 'utf8');
  const stripped = src.replace(
    /<!-- 与 manifest\.json[\s\S]*?<script src="\.\.\/src\/core\/boot\.js"><\/script>/,
    '<!-- 该文件用于真实扩展验收：故意不内联脚本，只有 content script 能翻译 -->'
  );
  mkdirSync(path.join(ROOT, 'recon'), { recursive: true });
  const fixtureRel = 'recon/ext-fixture.html';
  writeFileSync(path.join(ROOT, fixtureRel), stripped, 'utf8');
  return { ext, fixtureUrl: `http://127.0.0.1:${PORT}/${fixtureRel}` };
}

async function waitForPort(profile, timeout = 20000) {
  const file = path.join(profile, 'DevToolsActivePort');
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (existsSync(file)) {
      const txt = readFileSync(file, 'utf8').trim().split(/\r?\n/);
      if (txt[0]) return Number(txt[0]);
    }
    await sleep(200);
  }
  throw new Error('等待 DevToolsActivePort 超时');
}

function cdp(wsUrl) {
  const ws = new WebSocket(wsUrl);
  let nextId = 0;
  const pending = new Map();
  ws.addEventListener('message', (ev) => {
    let msg;
    try { msg = JSON.parse(ev.data); } catch { return; }
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      msg.error ? reject(new Error(JSON.stringify(msg.error))) : resolve(msg.result);
    }
  });
  const ready = new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve, { once: true });
    ws.addEventListener('error', () => reject(new Error('CDP WebSocket 连接失败')), { once: true });
  });
  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const id = ++nextId;
      pending.set(id, { resolve, reject });
      ws.send(JSON.stringify({ id, method, params }));
    });
  return { ws, ready, send, close: () => ws.close() };
}

async function evaluate(session, expression) {
  const res = await session.send('Runtime.evaluate', {
    expression,
    returnByValue: true,
    awaitPromise: true
  });
  if (res.exceptionDetails) throw new Error(res.exceptionDetails.text || 'JS 执行异常');
  return res.result.value;
}

async function main() {
  if (!existsSync(CHROME)) {
    log(`找不到 Chrome：${CHROME}`);
    process.exit(2);
  }
  try {
    await get(`http://127.0.0.1:${PORT}/manifest.json`);
  } catch {
    log(`静态服务器未运行。请先执行：python -m http.server ${PORT} --bind 127.0.0.1`);
    process.exit(2);
  }

  const { ext, fixtureUrl } = prepare();
  const profile = mkdtempSync(path.join(tmpdir(), 'aiz-chrome-'));
  log(`临时扩展目录：${ext}`);
  log(`启动独立 Chrome（离屏窗口 + 临时用户目录）…`);

  const args = [
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-background-networking',
    '--disable-sync',
    '--disable-features=Translate',
    '--lang=en-US',
    '--window-size=1280,900',
    '--window-position=-32000,-32000',
    `--user-data-dir=${profile}`,
    `--disable-extensions-except=${ext}`,
    `--load-extension=${ext}`,
    '--remote-debugging-port=0',
    fixtureUrl
  ];

  const child = spawn(CHROME, args, { stdio: ['ignore', 'pipe', 'pipe'] });
  let chromeStderr = '';
  child.stderr.on('data', (d) => { chromeStderr += d.toString(); });

  let exitCode = 0;
  const cleanup = () => {
    try { child.kill(); } catch { /* ignore */ }
    try { rmSync(ext, { recursive: true, force: true }); } catch { /* ignore */ }
    try { rmSync(profile, { recursive: true, force: true }); } catch { /* ignore */ }
  };

  try {
    const port = await waitForPort(profile);
    log(`CDP 端口：${port}`);

    // 列出 targets：service_worker 存在说明扩展真的被加载了
    let targets = [];
    for (let i = 0; i < 25; i++) {
      const { body } = await get(`http://127.0.0.1:${port}/json/list`);
      targets = JSON.parse(body);
      if (targets.some((t) => t.type === 'service_worker' && t.url.endsWith('/src/background.js'))) break;
      await sleep(400);
    }
    log('当前 targets：' + targets.map((t) => `${t.type}:${String(t.url).slice(0, 90)}`).join('\n              '));
    const sw = targets.find((t) => t.type === 'service_worker' && t.url.includes('chrome-extension://') && t.url.endsWith('/src/background.js'));
    const extId = sw ? sw.url.split('/')[2] : null;
    log(sw ? `Service Worker 已启动：${sw.url}` : 'WARN 没有发现扩展 Service Worker（--load-extension 可能被浏览器策略禁用）');

    const page = targets.find((t) => t.type === 'page' && t.url.includes('ext-fixture.html'));
    if (!page) throw new Error('没有找到测试页面 target');

    const session = cdp(page.webSocketDebuggerUrl);
    await session.ready;
    await session.send('Runtime.enable');
    await session.send('Page.enable');

    // 等页面探针写出结果（探针在页面 3s 后写入）
    let probeText = '';
    for (let i = 0; i < 40; i++) {
      probeText = await evaluate(
        session,
        `(() => { const el = document.getElementById('aiz-probe'); return el ? el.textContent.trim() : ''; })()`
      );
      if (probeText && probeText.startsWith('{')) break;
      await sleep(500);
    }

    let probe = null;
    try { probe = JSON.parse(probeText); } catch { /* ignore */ }

    const rows = [];
    const add = (key, ok, note, got) => rows.push({ key, ok, note, got });

    add('extensionLoaded', !!sw, '扩展 Service Worker 已启动', !!sw);
    add('extId', !!extId, '拿到扩展 ID', extId);
    add('ready', probe && probe.ready === true, 'content script 注入并启动', probe && probe.ready);
    add('navPlayground', probe && probe.navPlayground === '对话实验室', '侧边栏翻译', probe && probe.navPlayground);
    add('placeholder', probe && probe.placeholder === '开始输入提示词，看看我们的模型能做什么', 'placeholder 翻译', probe && probe.placeholder);
    add('dynamic', probe && probe.headline === '与 Gemini 4 Argon 对话', '动态规则', probe && probe.headline);
    add('rerendered', probe && probe.rerendered === '对话实验室', 'Angular 重渲染重译', probe && probe.rerendered);
    add('codeSafe', probe && probe.code === 'Playground', '代码块不翻译', probe && probe.code);
    add('chatSafe', probe && probe.chatText === 'History', '聊天输出不翻译', probe && probe.chatText);
    add('markers', probe && Number(probe.markers) > 8, '译文标记数 > 8', probe && probe.markers);

    // 扩展自己的页面能否打开（popup / options）
    if (extId) {
      for (const [name, pagePath] of [['popup', 'src/popup/popup.html'], ['options', 'src/options/options.html']]) {
        const url = `chrome-extension://${extId}/${pagePath}`;
        try {
          const created = await request('PUT', `http://127.0.0.1:${port}/json/new?${encodeURIComponent(url)}`, 8000);
          const info = JSON.parse(created.body);
          if (info.webSocketDebuggerUrl) {
            const s2 = cdp(info.webSocketDebuggerUrl);
            await s2.ready;
            await sleep(900);
            const title = await evaluate(s2, 'document.title');
            const errors = await evaluate(s2, 'window.__uiErrors || []');
            add(`${name}Page`, !!title, `${name} 页面可打开（${title || '无标题'}）`, title);

            const profile = await evaluate(
              s2,
              `(async () => JSON.stringify({
                dict: Object.keys(window.__AIZ_DICT__ || {}).length,
                patterns: (window.__AIZ_PATTERNS__ || []).length,
                sections: document.querySelectorAll('section').length,
                hasStorage: !!(window.chrome && chrome.storage && chrome.storage.local),
                settings: await new Promise((res) => chrome.storage.local.get(['aiz.settings'], (r) => res(r['aiz.settings'] || null)))
              }))()`
            ).then((t) => JSON.parse(t)).catch(() => ({}));

            if (name === 'options') {
              add('optionsDict', Number(profile.dict) > 800, `options 加载内置词典（${profile.dict} 条去重词条）`, profile.dict);
              add('optionsPatterns', Number(profile.patterns) > 50, `options 加载动态规则（${profile.patterns} 条）`, profile.patterns);
              add('optionsSections', Number(profile.sections) === 7, `options 七个分区（${profile.sections} 个 section）`, profile.sections);
              add('optionsStorage', profile.hasStorage === true, 'options 处于真实扩展存储环境', profile.hasStorage);
            } else {
              add('popupStorage', profile.hasStorage === true, 'popup 处于真实扩展存储环境', profile.hasStorage);
              add('popupSettings', !!(profile.settings && profile.settings.enabled === true), 'popup 读到默认设置（enabled=true）', profile.settings);
            }

            if (Array.isArray(errors) && errors.length) add(`${name}Errors`, false, `${name} 控制台错误`, errors.slice(0, 3));
            s2.close();
          } else {
            add(`${name}Page`, false, `${name} 页面创建失败`, info);
          }
        } catch (e) {
          add(`${name}Page`, false, `${name} 页面打开异常`, String(e).slice(0, 160));
        }
      }
    }

    // 截图留证
    try {
      const shot = await session.send('Page.captureScreenshot', { format: 'png' });
      mkdirSync(path.join(ROOT, 'recon'), { recursive: true });
      writeFileSync(path.join(ROOT, 'recon', 'ext-screenshot.png'), Buffer.from(shot.data, 'base64'));
      log('截图已保存：recon/ext-screenshot.png');
    } catch (e) {
      log('截图失败：' + e.message);
    }

    session.close();

    log('\n======== 真实扩展验收 ========');
    for (const r of rows) {
      log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.key.padEnd(14)} ${r.note}`);
      if (!r.ok) log('      实际：' + JSON.stringify(r.got));
    }
    const failed = rows.filter((r) => !r.ok).length;
    log('------------------------------');
    log(failed === 0 ? `全部 ${rows.length} 项通过 ✅` : `${failed} / ${rows.length} 项失败 ❌`);

    mkdirSync(path.join(ROOT, 'recon'), { recursive: true });
    writeFileSync(
      path.join(ROOT, 'recon', 'e2e-extension-result.json'),
      JSON.stringify({ at: new Date().toISOString(), extId, failed, rows, probe }, null, 2),
      'utf8'
    );

    if (!sw) {
      log('\n提示：当前 Chrome 构建可能已经禁用 --load-extension（Chrome 137+ 的品牌版策略），');
      log('这不影响用户通过 chrome://extensions → 加载已解压的扩展程序 手动安装。');
      log('本次仍验证了页面级翻译（若 ready 为 true，说明内联脚本兜底生效，见 fixtures/preview.html）。');
    }

    exitCode = failed === 0 ? 0 : 1;
  } catch (e) {
    log('验收异常：' + (e && e.message ? e.message : e));
    if (chromeStderr) log('Chrome stderr（截取）：\n' + chromeStderr.slice(-1500));
    exitCode = 3;
  } finally {
    cleanup();
  }

  process.exit(exitCode);
}

main();
