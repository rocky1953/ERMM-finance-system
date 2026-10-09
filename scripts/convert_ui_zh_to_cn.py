# -*- coding: utf-8 -*-
"""
將前端界面文案（pages/*.js、index.html、app.js）中的繁體中文轉為簡體。
不處理 i18n.js（保留三語塊，僅改預設語言）。
"""
import os
import re
from zhconv import convert

TARGETS = [
    'public/index.html',
    'public/js/app.js',
]
# 加入 pages 目錄所有 .js
pages_dir = 'public/js/pages'
for f in os.listdir(pages_dir):
    if f.endswith('.js'):
        TARGETS.append(os.path.join(pages_dir, f))

total_changed = 0
for path in TARGETS:
    with open(path, 'r', encoding='utf-8') as f:
        original = f.read()
    converted = convert(original, 'zh-cn')
    if converted != original:
        with open(path, 'w', encoding='utf-8') as f:
            f.write(converted)
        # 計算差異行數
        diff = sum(1 for a, b in zip(original.splitlines(), converted.splitlines()) if a != b)
        print(f"[已轉換] {path}  ({diff} 行有變動)")
        total_changed += 1
    else:
        print(f"[無變動] {path}")

print(f"\n完成：共處理 {len(TARGETS)} 個檔案，{total_changed} 個有變動")
