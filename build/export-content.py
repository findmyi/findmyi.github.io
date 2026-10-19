"""把 64 篇付费正文导出成 Cloudflare KV 的批量导入格式。

输入：content/premium-v3.mjs（构建期生成，含全部 depth）
输出：worker/content-kv.json —— 每行一条 {"key":..., "value":...}

用法：
  python build/export-content.py
  wrangler kv bulk put --binding=KEYS worker/content-kv.json

⚠️ 这个文件包含全部付费正文，【不要】提交到 git，【不要】放进发布目录。
   已在 .gitignore 里排除。
"""
import json, re, io, sys
from pathlib import Path

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

ROOT = Path(r'D:\zhouyi-site')
SRC = ROOT / 'content' / 'premium-v3.mjs'
OUT = ROOT / 'worker' / 'content-kv.json'

src = SRC.read_text(encoding='utf-8')

# premium-v3.mjs 形如：
#   export const PREMIUM_V3 = {
#     qian: `
#   <p>…</p>
#     `,
# 用状态机解析，避免正则贪婪
blocks = {}
cur = None
buf = []
for line in src.split('\n'):
    m = re.match(r'^  ([a-z0-9_]+): `\s*$', line)
    if m:
        cur = m.group(1)
        buf = []
        continue
    if cur is not None:
        if line == '  `,':
            blocks[cur] = '\n'.join(buf)
            cur = None
            buf = []
            continue
        buf.append(line)

print('解析出 ' + str(len(blocks)) + ' 篇正文')
if not blocks:
    print('❌ 解析失败，检查 premium-v3.mjs 的格式')
    sys.exit(1)

# 转成 KV bulk 格式
# ⚠️ wrangler kv bulk put 要求的是【JSON 数组】，不是 NDJSON（一行一条）。
rows = []
total = 0
for hid, html in blocks.items():
    html = html.strip()
    total += len(html)
    rows.append({'key': 'content:' + hid, 'value': html})

OUT.write_text(json.dumps(rows, ensure_ascii=False, indent=0), encoding='utf-8')

print('写出 ' + str(OUT))
print('  ' + str(len(rows)) + ' 条，合计 ' + f'{total:,}' + ' 字符')
print('  文件大小 ' + f'{OUT.stat().st_size / 1024 / 1024:.2f}' + ' MB')
print('  格式：JSON 数组（wrangler bulk put 要求）')
print()
print('下一步：')
print('  cd D:\\zhouyi-site\\worker')
print('  wrangler kv bulk put --binding=KEYS content-kv.json --remote')
