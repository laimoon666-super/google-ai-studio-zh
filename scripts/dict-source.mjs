#!/usr/bin/env node
/**
 * 一次性迁移脚本：给 4 个词典分卷注册"来源卷"元数据
 * ----------------------------------------------------------------
 * 目标：让每个 key 都能溯源到它来自哪个分卷（common/playground/build/manage），
 * 供设置页「词典管理 → 分卷」列在真实扩展环境里显示（配合 AIZ_GET_SNAPSHOT）。
 *
 * 迁移方式：
 *   Object.assign(D, { ... })            → const PART = { ... };
 *   (文件尾)                              Object.assign(D, PART);
 *                                         Object.keys(PART).forEach(k => { if(!(k in S)) S[k]='xxx'; });
 *
 * 幂等：文件里已出现 __AIZ_DICT_SOURCE__ 就跳过。
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FILES = [
  ['src/dict/_common.js', 'common'],
  ['src/dict/playground.js', 'playground'],
  ['src/dict/build.js', 'build'],
  ['src/dict/manage.js', 'manage']
];

let changed = 0;

for (const [rel, volume] of FILES) {
  const abs = path.join(ROOT, rel);
  if (!existsSync(abs)) {
    console.error('缺少文件：' + rel);
    process.exitCode = 1;
    continue;
  }
  const src = readFileSync(abs, 'utf8');

  if (src.includes('__AIZ_DICT_SOURCE__')) {
    console.log('跳过（已迁移）：' + rel);
    continue;
  }

  if (!src.includes('Object.assign(D, {')) {
    console.error('未找到 Object.assign(D, { 结构：' + rel);
    process.exitCode = 1;
    continue;
  }

  // 1) 插入 source 注册器，并把 Object.assign(D, { 改成 const PART = {
  let out = src.replace(
    /Object\.assign\(D, \{/,
    'const S = (window.__AIZ_DICT_SOURCE__ = window.__AIZ_DICT_SOURCE__ || {});\n\n  const PART = {'
  );

  // 2) 文件尾部：`  });\n})();` → 关闭 PART + Object.assign + 来源注册
  const tail = /\n\s*\}\);\n\}\)\(\);\s*$/;
  if (!tail.test(out)) {
    console.error('文件尾部结构异常，跳过：' + rel);
    process.exitCode = 1;
    continue;
  }
  out = out.replace(
    tail,
    '\n  };\n' +
    '  Object.assign(D, PART);\n' +
    "  Object.keys(PART).forEach(function (key) {\n" +
    "    if (!(key in S)) S[key] = '" + volume + "';\n" +
    '  });\n' +
    '})();'
  );

  writeFileSync(abs, out, 'utf8');
  console.log('已迁移：' + rel + ' → 分卷 "' + volume + '"');
  changed += 1;
}

console.log(changed === 0 ? '没有文件需要迁移' : `迁移完成：${changed} 个文件`);
