#!/usr/bin/env node
/**
 * 端到端验收脚本（无需安装扩展、不影响用户浏览器）
 * ------------------------------------------------------------------
 * 两层验证：
 *   A. 静态校验：manifest 结构、content_scripts 引用的文件是否存在、
 *      图标尺寸、popup/options 页面、所有 JS 语法（node --check）。
 *   B. 运行校验：用 headless Chrome 打开 fixtures/preview.html。
 *      该页面按 manifest 中的顺序同源加载真实的词典/引擎/启动器脚本，
 *      复刻 AI Studio 的 DOM 结构（含 Material 图标、Angular 重渲染、
 *      动态插入节点、shadow DOM、代码块、聊天输出），页面自检探针把
 *      最终 DOM 状态写进 #aiz-probe，再由本脚本断言。
 *
 * 用法：
 *   node scripts/e2e-test.mjs
 * 前置条件：项目根目录已经在 8899 端口起了静态服务器，例如
 *   python -m http.server 8899 --bind 127.0.0.1
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import http from 'node:http';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CHROME = process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 8899;
const FIXTURE = `http://127.0.0.1:${PORT}/fixtures/preview.html`;

const log = (msg) => console.log(msg);
const rel = (p) => path.relative(ROOT, p).replace(/\\/g, '/');

function checkServer() {
  return new Promise((resolve) => {
    const req = http.get(FIXTURE, (res) => {
      res.resume();
      resolve(res.statusCode === 200);
    });
    req.on('error', () => resolve(false));
    req.setTimeout(3000, () => { req.destroy(); resolve(false); });
  });
}

/* ---------------- A. 静态校验 ---------------- */

function staticCheck() {
  const errors = [];
  const warnings = [];
  const manifestPath = path.join(ROOT, 'manifest.json');
  let manifest;

  try {
    manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  } catch (e) {
    console.error('manifest.json 解析失败：', e.message);
    return { errors: ['manifest 解析失败'], warnings };
  }

  if (manifest.manifest_version !== 3) errors.push('manifest_version 必须是 3');
  if (!manifest.name) errors.push('缺少 name');
  if (!/^\d+\.\d+\.\d+$/.test(manifest.version || '')) errors.push('version 格式不合法');

  const cs = (manifest.content_scripts || [])[0];
  if (!cs) {
    errors.push('缺少 content_scripts');
  } else {
    const order = cs.js || [];
    ['src/dict/_common.js', 'src/core/patterns.js', 'src/core/engine.js', 'src/core/boot.js'].forEach((f) => {
      if (!order.includes(f)) errors.push(`content_scripts.js 缺少 ${f}`);
    });
    if (order.indexOf('src/core/engine.js') > order.indexOf('src/core/boot.js')) {
      errors.push('engine.js 必须排在 boot.js 之前');
    }
    if (order.some((f) => f.includes('dict/playground') || f.includes('dict/build') || f.includes('dict/manage'))) {
      order.forEach((f) => {
        if (!existsSync(path.join(ROOT, f))) errors.push(`content_scripts 引用了不存在的文件：${f}`);
      });
    }
    (cs.css || []).forEach((f) => {
      if (!existsSync(path.join(ROOT, f))) errors.push(`content_scripts.css 引用了不存在的文件：${f}`);
    });
    if (!(cs.matches || []).every((m) => typeof m === 'string' && m.includes('aistudio.google.com'))) {
      warnings.push('content_scripts.matches 没有覆盖 aistudio.google.com');
    }
  }

  Object.entries(manifest.icons || {}).forEach(([size, f]) => {
    const p = path.join(ROOT, f);
    if (!existsSync(p)) {
      errors.push(`图标缺失：${f}`);
      return;
    }
    const buf = readFileSync(p);
    if (buf.length < 100) errors.push(`图标疑似损坏：${f}`);
    if (size === '128' && buf.length < 500) warnings.push('128 图标体积偏小，可能过于简单');
  });

  if (manifest.action && manifest.action.default_popup && !existsSync(path.join(ROOT, manifest.action.default_popup))) {
    errors.push(`popup 页面缺失：${manifest.action.default_popup}`);
  }
  if (manifest.options_ui && !existsSync(path.join(ROOT, manifest.options_ui.page))) {
    errors.push(`options 页面缺失：${manifest.options_ui.page}`);
  }
  if (!manifest.commands || !manifest.commands['toggle-localization']) {
    warnings.push('缺少 Alt+Shift+H 快捷键命令');
  }

  const jsFiles = [
    'src/background.js',
    ...(cs ? cs.js || [] : []),
    'src/popup/popup.js',
    'src/options/options.js',
    'src/ui/mock.js'
  ].filter((f, i, arr) => arr.indexOf(f) === i && existsSync(path.join(ROOT, f)));

  for (const f of jsFiles) {
    const res = spawnSync(process.execPath, ['--check', path.join(ROOT, f)], { encoding: 'utf8' });
    if (res.status !== 0) errors.push(`语法错误：${f}\n${(res.stderr || '').trim().split('\n').slice(0, 4).join('\n')}`);
  }

  // 词典规模
  const dictStats = {};
  ['src/dict/_common.js', 'src/dict/playground.js', 'src/dict/build.js', 'src/dict/manage.js'].forEach((f) => {
    const p = path.join(ROOT, f);
    if (!existsSync(p)) {
      dictStats[f] = null;
      return;
    }
    const code = readFileSync(p, 'utf8');
    dictStats[f] = (code.match(/^\s*"[^"]+"\s*:/gm) || []).length;
  });
  const total = Object.values(dictStats).reduce((a, b) => a + (b || 0), 0);
  if (total < 150) warnings.push(`词典总条数偏少：${total}`);

  return { errors, warnings, manifest, dictStats, total };
}

/* ---------------- B. 运行校验 ---------------- */

function decodeEntities(str) {
  return str
    .replace(/&quot;/g, '"')
    .replace(/&#0*39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

function runFixture() {
  const profile = mkdtempSync(path.join(tmpdir(), 'aiz-profile-'));
  const args = [
    '--headless=new',
    '--disable-gpu',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-background-networking',
    '--disable-sync',
    '--disable-features=Translate',
    '--lang=en-US',
    `--user-data-dir=${profile}`,
    '--virtual-time-budget=9000',
    '--dump-dom',
    FIXTURE
  ];

  const started = Date.now();
  const res = spawnSync(CHROME, args, { encoding: 'utf8', timeout: 90000, maxBuffer: 64 * 1024 * 1024 });
  const html = res.stdout || '';
  log(`headless Chrome 退出码 ${res.status}，耗时 ${((Date.now() - started) / 1000).toFixed(1)}s`);
  rmSync(profile, { recursive: true, force: true });

  if (res.error) return { html, error: res.error.message, stderr: res.stderr };
  return { html, stderr: res.stderr };
}

async function main() {
  log('======== A. 静态校验 ========');
  const stat = staticCheck();
  stat.errors.forEach((e) => log(`ERROR  ${e}`));
  stat.warnings.forEach((w) => log(`WARN   ${w}`));
  log(stat.errors.length === 0 ? '静态校验通过 ✅' : `静态校验失败：${stat.errors.length} 项 ❌`);
  if (stat.dictStats) {
    log('词典分卷条数：' + Object.entries(stat.dictStats).map(([k, v]) => `${path.basename(k)}=${v === null ? '缺失' : v}`).join('  '));
    log(`词典总条数：${stat.total}`);
  }

  log('\n======== B. 运行校验（headless Chrome）========');
  if (!existsSync(CHROME)) {
    log(`找不到 Chrome：${CHROME}`);
    process.exit(2);
  }
  if (!(await checkServer())) {
    log(`本地静态服务器没有运行：${FIXTURE}`);
    log(`请先在本项目根目录执行：python -m http.server ${PORT} --bind 127.0.0.1`);
    process.exit(2);
  }

  const { html, error, stderr } = runFixture();
  const m = html.match(/<pre id="aiz-probe">([\s\S]*?)<\/pre>/);
  if (!m) {
    log('没有拿到页面自检探针。');
    log('---- stderr（截取）----');
    log((stderr || error || '').slice(-2500));
    log('---- stdout 片段 ----');
    log(html.slice(-1500));
    process.exit(4);
  }

  let probe;
  try {
    probe = JSON.parse(decodeEntities(m[1]));
  } catch (e) {
    log('探针 JSON 解析失败：' + e.message);
    process.exit(5);
  }

  const expected = [
    ['ready', true, '启动器已注入'],
    ['version', '1.0.0', '版本标记'],
    ['navPlayground', '对话实验室', '侧边栏 Playground'],
    ['navHistory', '历史记录', '侧边栏 History'],
    ['collapseAria', '收起导航菜单', 'aria-label 翻译'],
    ['headline', '与 Gemini 4 Argon 对话', '动态标题正则'],
    ['subtitle', '提问、推理、构建。输入提示词，或从应用广场中选择应用进行改写。', '长句副标题'],
    ['runTitle', '运行设置', 'title 属性翻译'],
    ['runAria', '运行设置', 'aria-label 属性翻译'],
    ['unlock', '解锁 Gemini 4 Argon', 'Unlock 前缀正则'],
    ['placeholder', '开始输入提示词，看看我们的模型能做什么', 'textarea placeholder'],
    ['enterAria', '输入提示词', 'textarea aria-label'],
    ['toolsAria', '打开工具菜单', '工具按钮 aria-label'],
    ['selectValue', '中', 'mat-select 选中值'],
    ['tokens', '1,024 个 Token', 'Token 计数正则'],
    ['pricing', '全部上下文长度 · 输入：$2.00 / 输出：$10.00（优惠至 November 30, 2026）', '模型定价行（函数式正则）'],
    ['account', 'Google 账号：moon999 lai (laimoon666@gmail.com)', '账号正则（保留变量）'],
    ['ago', '3 分钟前', '相对时间正则'],
    ['rerendered', '对话实验室', 'Angular 改回英文后自动重译'],
    ['injected', '获取代码', '动态插入节点自动翻译'],
    ['injectedAria', '获取代码', '动态节点 aria-label'],
    ['shadowText', '高级设置', 'Shadow DOM 内部翻译'],
    ['title', '对话实验室 - Google AI Studio', '浏览器标签标题']
  ];

  const untouched = [
    ['keptNotranslate', 'Run settings', '.notranslate 区域'],
    ['icon', 'settings', 'Material 图标（类名）'],
    ['icon2', 'settings', 'Material 图标（字体判断）'],
    ['code', 'Playground', 'pre/code 不翻译'],
    ['chatText', 'History', 'ms-chat-turn 模型输出'],
    ['markdown', 'Playground', '.markdown-body 不翻译']
  ];

  const rows = [];
  for (const [key, want, note] of expected) rows.push({ ok: probe[key] === want, key, note, want, got: probe[key] });
  for (const [key, want, note] of untouched) rows.push({ ok: probe[key] === want, key, note, want, got: probe[key] });
  rows.push({ ok: Number(probe.markers) > 8, key: 'markers', note: '译文标记数量（>8）', want: '>8', got: probe.markers });

  const failed = rows.filter((r) => !r.ok).length;
  log('\n---------------- 断言明细 ----------------');
  for (const r of rows) {
    log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.key.padEnd(14)} ${r.note}`);
    if (!r.ok) log(`      期望：${JSON.stringify(r.want)}\n      实际：${JSON.stringify(r.got)}`);
  }

  const allOk = failed === 0 && stat.errors.length === 0;
  log('------------------------------------------');
  log(allOk ? `全部 ${rows.length} 项通过 ✅` : `运行校验失败 ${failed} 项 ❌`);

  mkdirSync(path.join(ROOT, 'recon'), { recursive: true });
  writeFileSync(
    path.join(ROOT, 'recon', 'e2e-result.json'),
    JSON.stringify({ at: new Date().toISOString(), staticErrors: stat.errors, staticWarnings: stat.warnings, failed, rows, probe }, null, 2),
    'utf8'
  );
  log('明细已写入 recon/e2e-result.json');

  process.exit(allOk ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(10);
});
