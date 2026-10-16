"""把 content/v2 的 62 篇 + 乾坤新版，转成付费墙需要的 depth HTML。

输出 content/premium-v3.mjs：
  export const PREMIUM_V3 = {
    qian: '<h3>…</h3><p>…</p>',
    kun:  '…',
    zhun: '…',
    ...
  }

键名用 manifest 的 id（build.mjs 按 h.id 查表）。
md → html 的规则见 md2depth.py，此处复用同一套。
"""
import re, os, json, io, sys
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

V2 = r'D:\zhouyi-site\content\v3'
OUT = r'D:\zhouyi-site\content\premium-v3.mjs'
MANIFEST = r'D:\zhouyi-site\data\manifest.json'

man = json.load(open(MANIFEST, encoding='utf-8'))
by_n = {a['n']: a for a in man['articles']}


def md_inline(s):
    s = s.replace('&', '&amp;').replace('<', '&lt;').replace('>', '&gt;')
    s = re.sub(r'\*\*(.+?)\*\*', r'<strong>\1</strong>', s)
    return s


def slug(s, i):
    s = re.sub(r'[^\w\u4e00-\u9fff]+', '-', s).strip('-').lower()
    return 'p-' + (s[:24] if s else str(i))


def convert(md):
    out, lines, i, sec = [], md.split('\n'), 0, 0
    while i < len(lines):
        s = lines[i].strip()

        if s.startswith('>'):
            buf = []
            while i < len(lines) and lines[i].strip().startswith('>'):
                buf.append(lines[i].strip().lstrip('>').strip())
                i += 1
            body = '<br>'.join(md_inline(x) for x in buf if x)
            out.append('<blockquote class="pw-quote">' + body + '</blockquote>')
            continue

        if s.startswith('## '):
            sec += 1
            out.append('<h3 id="' + slug(s[3:], sec) + '">' + md_inline(s[3:]) + '</h3>')
            i += 1
            continue
        if s.startswith('# '):
            i += 1
            continue
        if s == '---':
            i += 1
            continue

        if s.startswith('|'):
            rows = []
            while i < len(lines) and lines[i].strip().startswith('|'):
                rows.append(lines[i].strip())
                i += 1
            html = ['<table class="pw-table">']
            for ri, r in enumerate(rows):
                cells = [c.strip() for c in r.strip('|').split('|')]
                if all(re.fullmatch(r':?-{2,}:?', c or '-') for c in cells):
                    continue
                tag = 'th' if ri == 0 else 'td'
                html.append('<tr>' + ''.join(
                    '<' + tag + '>' + md_inline(c) + '</' + tag + '>' for c in cells) + '</tr>')
            html.append('</table>')
            out.append('\n'.join(html))
            continue

        if not s:
            i += 1
            continue

        out.append('<p>' + md_inline(s) + '</p>')
        i += 1
    return '\n'.join(out)


data = {}
stats = []

# --- 全部 64 卦统一从 v3 取（乾坤也已在 v3 里：01-乾.md / 02-坤.md）---
missing = []
for name in sorted(os.listdir(V2)):
    m = re.match(r'^(\d+)-(.+)\.md$', name)
    if not m:
        continue
    n = int(m.group(1))
    a = by_n.get(n)
    if not a:
        missing.append(name + ' (manifest 无第 ' + str(n) + ' 卦)')
        continue
    md = open(os.path.join(V2, name), encoding='utf-8').read()
    html = convert(md)
    data[a['id']] = html
    stats.append((n, a['name'], len(re.findall(r'[\u4e00-\u9fff]', html))))

# --- 输出 mjs ---
parts = [
    '/* 付费正文 · v2（六爻逐爻解读）',
    ' * 本文件由 build/md2premium.py 从 content/ 的 markdown 生成，请勿手改。',
    ' * 这些内容【不会】进静态产物 —— build.mjs 只读它做校验，不写进 articles/。',
    ' */',
    'export const PREMIUM_V3 = {',
]
for k, v in data.items():
    esc = v.replace('\\', '\\\\').replace('`', '\\`').replace('${', '\\${')
    parts.append('  ' + k + ': `')
    parts.append(esc)
    parts.append('  `,')
parts.append('};')
parts.append('')
parts.append('export const PREMIUM_V3_IDS = ' + json.dumps(list(data.keys()), ensure_ascii=False) + ';')
parts.append('')

open(OUT, 'w', encoding='utf-8').write('\n'.join(parts))

print('生成 ' + OUT)
print('共 ' + str(len(data)) + ' 篇')
print()
tot = 0
for n, nm, han in sorted(stats):
    tot += han
    print('  ' + str(n).rjust(2) + ' ' + nm.ljust(5) + str(han).rjust(5) + ' 汉字')
print()
print('合计 ' + str(tot) + ' 汉字')
if missing:
    print()
    print('跳过：')
    for x in missing:
        print('  ' + x)


