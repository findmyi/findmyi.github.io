"""关键安全检查：付费正文是否会随站点发布出去。

背景：有调研指出一个致命风险 —— 如果付费内容在客户端可获取，
那么挂什么收款码都没用，等于一个免费公开的下载站。

本脚本回答三个问题：
  1. 付费正文（depth）里独有的句子，有没有出现在【发布目录】里？
  2. manifest 里的 sample/teaser 是不是【有意公开】的那部分？
  3. 整个发布目录（index.html / assets / articles / data）能不能拼出付费正文？
"""
import json, re, io, sys
from pathlib import Path

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

ROOT = Path(r'D:\zhouyi-site')
DIST = ['index.html', 'assets', 'articles', 'data']

# ---- 收集发布目录的全部文本 ----
pub = []
for item in DIST:
    p = ROOT / item
    if p.is_file():
        pub.append((item, p.read_text(encoding='utf-8', errors='ignore')))
    elif p.is_dir():
        for f in p.rglob('*'):
            if f.is_file() and f.suffix in ('.html', '.js', '.css', '.json'):
                pub.append((str(f.relative_to(ROOT)), f.read_text(encoding='utf-8', errors='ignore')))

total_chars = sum(len(t) for _, t in pub)
print('发布目录文件数: ' + str(len(pub)) + '，总字符 ' + str(total_chars))
print()

# ---- 载入付费正文 ----
prem = (ROOT / 'content' / 'premium-v3.mjs').read_text(encoding='utf-8')
print('付费正文源文件: ' + str(len(prem)) + ' 字符')
print()

# ---- 从 depth 里抽「独有句子」 ----
# premium-v3.mjs 结构：  id: ` ...html... `,
depth_blocks = re.findall(r'^  ([a-z0-9_]+): `\n(.*?)\n  `,', prem, re.S | re.M)
print('解析出 ' + str(len(depth_blocks)) + ' 篇 depth')
print()

pub_all = '\n'.join(t for _, t in pub)

def sentences(html):
    txt = re.sub(r'<[^>]+>', '', html)
    return [s.strip() for s in re.split(r'[。；\n]', txt) if len(s.strip()) > 18]

# sample / teaser 是有意公开的，先收集起来
man = json.loads((ROOT / 'data' / 'manifest.json').read_text(encoding='utf-8'))
public_intent = []
for cid, card in (man.get('meta', {}).get('premium', {}).get('cards', {}) or {}).items():
    if card.get('teaser'):
        public_intent.append(card['teaser'])
    s = card.get('sample') or {}
    for k in ('quote', 'body', 'fade'):
        if s.get(k):
            public_intent.append(s[k])
intent_blob = '\n'.join(public_intent)
print('有意公开的 teaser+sample: ' + str(len(public_intent)) + ' 段')
print()

# ---- 找出「只在 depth 里、不在有意公开部分里」的句子，看是否泄漏 ----
leaks = []
scanned = 0
for hid, html in depth_blocks:
    for s in sentences(html):
        if s in intent_blob:
            continue                    # 有意公开
        scanned += 1
        if s in pub_all:
            where = [name for name, t in pub if s in t]
            leaks.append((hid, s[:44], where))

print('扫描 depth 独有句子: ' + str(scanned) + ' 条')
print()
if leaks:
    print('❌ 发现泄漏 ' + str(len(leaks)) + ' 处：')
    for hid, s, where in leaks[:25]:
        print('   ' + hid + ': 「' + s + '…」 → ' + ', '.join(where))
else:
    print('✅ 零泄漏：付费正文的独有句子，没有任何一条出现在发布目录里')
