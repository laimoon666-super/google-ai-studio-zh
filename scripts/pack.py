#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Google AI Studio 汉化助手 · 生产打包脚本（跨平台，zip 内路径统一使用 /）

用法：
    python scripts/pack.py            # 读取 manifest.json 的版本号
    python scripts/pack.py 1.0.1      # 指定版本号

产物：dist/google-ai-studio-zh-<version>.zip
"""
import json
import os
import sys
import zipfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DIST = os.path.join(ROOT, 'dist')

INCLUDE = ['manifest.json', 'README.md', 'LICENSE', 'CHANGELOG.md', 'icons', 'src', 'screenshots']
EXCLUDE_DIRS = {'dist', 'recon', 'docs', 'scripts', 'fixtures', 'node_modules', '.git', '__pycache__'}
EXCLUDE_FILES = {'CONTRACT.md', '.gitignore', '.DS_Store', 'Thumbs.db'}


def read_version():
    with open(os.path.join(ROOT, 'manifest.json'), 'r', encoding='utf-8') as f:
        return json.load(f)['version']


def collect():
    files = []
    for item in INCLUDE:
        path = os.path.join(ROOT, item)
        if os.path.isfile(path):
            files.append(item)
        elif os.path.isdir(path):
            for base, dirs, names in os.walk(path):
                dirs[:] = [d for d in dirs if d not in EXCLUDE_DIRS]
                for name in names:
                    if name in EXCLUDE_FILES:
                        continue
                    full = os.path.join(base, name)
                    rel = os.path.relpath(full, ROOT).replace(os.sep, '/')
                    files.append(rel)
        else:
            raise SystemExit('缺少必需文件/目录：' + item)
    return sorted(files)


def main():
    version = sys.argv[1] if len(sys.argv) > 1 else read_version()
    os.makedirs(DIST, exist_ok=True)
    out = os.path.join(DIST, 'google-ai-studio-zh-%s.zip' % version)

    files = collect()
    with zipfile.ZipFile(out, 'w', zipfile.ZIP_DEFLATED, compresslevel=9) as z:
        for rel in files:
            z.write(os.path.join(ROOT, rel), rel)

    size = os.path.getsize(out)
    print('打包完成：%s' % out)
    print('版本：%s  文件数：%d  大小：%.1f KB' % (version, len(files), size / 1024.0))
    for rel in files:
        print('  - %s' % rel)
    return 0


if __name__ == '__main__':
    sys.exit(main())
