#!/usr/bin/env node
/**
 * 词典体检 & 覆盖率审计（开发工具，不随扩展发布）
 * ---------------------------------------------------------------
 * 1. 载入所有词典分卷与动态规则
 * 2. 结构体检：中文 key、空译文、跨分卷冲突、译文未翻译、key 像图标名
 * 3. 覆盖率：用 recon/ 下的真实勘察文本反查词典，统计覆盖率与漏译候选
 *
 * 用法：node scripts/dict-audit.mjs [--top 40]
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TOP = Number(process.argv.includes('--top') ? process.argv[process.argv.indexOf('--top') + 1] : 40);

const DICT_FILES = ['_common.js', 'playground.js', 'build.js', 'manage.js'];
const dicts = {};
let patterns = [];

function loadScript(rel) {
  const abs = path.join(ROOT, rel);
  if (!existsSync(abs)) return null;
  const sandbox = { window: {}, RegExp, String, Object, Array, JSON, console };
  vm.runInNewContext(readFileSync(abs, 'utf8'), sandbox, { filename: rel });
  return sandbox.window;
}

for (const f of DICT_FILES) {
  const win = loadScript(`src/dict/${f}`);
  dicts[f] = win && win.__AIZ_DICT__ ? win.__AIZ_DICT__ : {};
}
const patWin = loadScript('src/core/patterns.js');
patterns = (patWin && patWin.__AIZ_PATTERNS__) || [];

const norm = (s) => String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
const hasCJK = (s) => /[\u4e00-\u9fff]/.test(s);
const hasLetter = (s) => /[A-Za-z]/.test(s);

/* ---------------- 结构体检 ---------------- */

console.log('========== 一、词典结构体检 ==========');
let total = 0;
for (const [f, d] of Object.entries(dicts)) {
  const n = Object.keys(d).length;
  total += n;
  console.log(`${f.padEnd(16)} ${String(n).padStart(4)} 条`);
}
console.log(`分卷条数合计 ${total} 条，动态规则 ${patterns.length} 条`);
const mergedKeys = new Set();
for (const d of Object.values(dicts)) Object.keys(d).forEach((k) => mergedKeys.add(k));
console.log(`去重后内置词条：${mergedKeys.size} 条\n`);

const issues = [];
for (const [f, d] of Object.entries(dicts)) {
  for (const [k, v] of Object.entries(d)) {
    if (hasCJK(k)) issues.push(`[中文 key] ${f}: ${k}`);
    if (typeof v !== 'string' || !v.trim()) issues.push(`[空译文] ${f}: ${k}`);
    if (typeof v === 'string' && v === k) issues.push(`[译文与原文相同] ${f}: ${k}`);
    if (typeof v === 'string' && !hasCJK(v) && /^[A-Za-z0-9 ,.'"()&/+-]+$/.test(v) && v.split(/\s+/).length > 2) {
      issues.push(`[疑似未翻译] ${f}: ${k} -> ${v}`);
    }
    if (/^gemini[-_ ]?\d/i.test(k)) issues.push(`[疑似模型名] ${f}: ${k}`);
  }
}

// 跨分卷同 key 不同译
const seen = new Map();
for (const [f, d] of Object.entries(dicts)) {
  for (const [k, v] of Object.entries(d)) {
    if (seen.has(k) && seen.get(k).v !== v) {
      issues.push(`[跨分卷冲突] "${k}"：${seen.get(k).f}="${seen.get(k).v}" vs ${f}="${v}"`);
    } else if (!seen.has(k)) seen.set(k, { f, v });
  }
}

console.log(`结构问题 ${issues.length} 条`);
issues.slice(0, 40).forEach((s) => console.log('  ' + s));
if (issues.length > 40) console.log(`  … 其余 ${issues.length - 40} 条略`);

/* ---------------- 覆盖率 ---------------- */

function collectStrings(obj, out) {
  if (obj == null) return;
  if (typeof obj === 'string') { out.push(obj); return; }
  if (Array.isArray(obj)) { obj.forEach((v) => collectStrings(v, out)); return; }
  if (typeof obj === 'object') Object.values(obj).forEach((v) => collectStrings(v, out));
}

const reconDir = path.join(ROOT, 'recon');
const corpus = new Set();
for (const f of readdirSync(reconDir)) {
  if (!f.endsWith('.json') || f.startsWith('e2e')) continue;
  try {
    const j = JSON.parse(readFileSync(path.join(reconDir, f), 'utf8'));
    const arr = [];
    collectStrings(j, arr);
    arr.forEach((s) => {
      const t = norm(s);
      if (t.length >= 2 && t.length <= 200 && hasLetter(t) && !hasCJK(t)) corpus.add(t);
    });
  } catch {
    /* 忽略坏文件 */
  }
}

const exactLower = new Set();
for (const d of Object.values(dicts)) for (const k of Object.keys(d)) exactLower.add(norm(k).toLowerCase());

function covered(t) {
  const k = norm(t);
  if (exactLower.has(k.toLowerCase())) return true;
  for (const p of patterns) {
    try {
      if (p.re.test(k)) return true;
    } catch { /* ignore */ }
  }
  return false;
}

const coveredList = [];
const uncovered = [];
for (const t of corpus) (covered(t) ? coveredList : uncovered).push(t);

// 从漏译候选里剔除明显不是 UI 的内容
const ignoreRe = [
  /^(https?:|www\.|mailto:)/i,
  /@/,
  /^\d[\d,.]*\s*(ms|s|kb|mb|gb|px)?$/i,
  /^[a-z][a-z0-9_]{0,30}$/, // 图标连字/代码标识符
  /^[A-Z][A-Z0-9_]{2,}$/,   // 常量
  /^[0-9a-f]{6,}$/i,
  /\.(js|ts|json|py|html|css|md|txt|png|jpg|svg|zip)$/i
];
const isContentLike = (t) =>
  t.length > 160 ||
  /[.!?]\s+[A-Z]/.test(t) && t.length > 100 ||
  ignoreRe.some((re) => re.test(t));

const gap = uncovered
  .filter((t) => !isContentLike(t))
  .sort((a, b) => a.length - b.length || (a < b ? -1 : 1));

console.log('\n========== 二、真实文案覆盖率 ==========');
console.log(`勘察文本去重后：${corpus.size} 条`);
console.log(
  `已覆盖：${coveredList.length} 条（${((coveredList.length / Math.max(1, corpus.size)) * 100).toFixed(1)}%）`
);
console.log(`未覆盖：${uncovered.length} 条，其中疑似 UI 漏译 ${gap.length} 条`);
console.log(`\n漏译候选 TOP ${TOP}（按长度排序，越短越像按钮/标签）：`);
gap.slice(0, TOP).forEach((t, i) => console.log(`${String(i + 1).padStart(3)}. [${t.length}] ${t}`));

/* ---------------- 词典 key 是否真实存在 ---------------- */
const corpusLower = new Set([...corpus].map((s) => s.toLowerCase()));
const missingKeys = [];
for (const [f, d] of Object.entries(dicts)) {
  for (const k of Object.keys(d)) {
    const nk = norm(k).toLowerCase();
    if (!corpusLower.has(nk)) missingKeys.push(`${f}: ${k}`);
  }
}
console.log(`\n========== 三、词典 key 未在勘察数据中出现（可能是猜测/拼写不一致）==========`);
console.log(`${missingKeys.length} 条`);
missingKeys.slice(0, 30).forEach((s) => console.log('  ' + s));
if (missingKeys.length > 30) console.log(`  … 其余 ${missingKeys.length - 30} 条略`);
