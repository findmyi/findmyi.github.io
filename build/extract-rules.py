"""抽取 64 卦 × 6 爻 = 384 条铁律 + 384 个处境。

这是零风险的一步：不改任何内容，只把已有素材里最值钱的部分拎出来。

输出 build/_ironrules.md（给人看的表）+ build/_ironrules.json（给程序用的）

用途：
  · 首页「转动的球」上放什么 → 用「处境」
  · 用户认领后拿到的「一句话」 → 用「铁律」
"""
import re, json, io, sys
from pathlib import Path

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

V3 = Path(r'D:\zhouyi-site\content\v3')
MANIFEST = Path(r'D:\zhouyi-site\data\manifest.json')

man = json.loads(MANIFEST.read_text(encoding='utf-8'))
by_n = {a['n']: a for a in man['articles']}

rows = []
for fp in sorted(V3.glob('*.md')):
    m = re.match(r'^(\d+)-(.+)\.md$', fp.name)
    if not m:
        continue
    n, gua = int(m.group(1)), m.group(2)
    text = fp.read_text(encoding='utf-8')

    # 按 ## 小节切
    parts = re.split(r'^##\s+', text, flags=re.M)[1:]
    for p in parts:
        lines = p.split('\n')
        title = lines[0].strip()
        if not re.match(r'^[初上]?[九六]', title):
            continue

        body = '\n'.join(lines[1:])

        # 爻位
        pos = re.match(r'^([初上]?[九六][一二三四五]?)', title)
        pos = pos.group(1) if pos else ''

        # 判词（标题里 —— 后面的部分）
        verdict = ''
        vm = re.search(r'——\s*(.+)$', title)
        if vm:
            verdict = vm.group(1).strip()

        # 爻辞（标题里 · 到 —— 之间）
        yao = ''
        ym = re.match(r'^[初上]?[九六][一二三四五]?\s*·\s*(.+?)\s*——', title)
        if ym:
            yao = ym.group(1).strip()

        # 处境：跳过引用块（爻辞/象传），取其后第一个合格的加粗段
        # 先把引用块整段挖掉，再找加粗
        body_nq = re.sub(r'^>.*$', '', body, flags=re.M)   # 去引用行
        situ = ''
        for m2 in re.finditer(r'\*\*([^*]{10,220})\*\*', body_nq):
            cand = m2.group(1).strip()
            if cand.startswith(('铁律', '什么情况', '象曰')):
                continue
            if re.match(r'^[初上]?[九六][一二三四五]?[：:]', cand):
                continue          # 爻辞
            situ = cand
            break

        # 铁律
        rule = ''
        rm = re.search(r'\*\*铁律[：:]\s*\*\*\s*(.+?)(?:\n\n|\n\*\*)', body, re.S)
        if not rule:
            rm = re.search(r'\*\*铁律[：:]([^*]+)\*\*', body, re.S)
        if rm:
            rule = re.sub(r'\*\*', '', rm.group(1)).strip()
        if not rule:
            rm = re.search(r'\*\*铁律[：:]\*\*\s*(.+)', body)
            if rm:
                rule = rm.group(1).strip()

        # 例外
        exc = ''
        em = re.search(r'\*\*什么情况[^*]*[：:]\s*\*\*\s*(.+?)(?:\n\n|$)', body, re.S)
        if em:
            exc = re.sub(r'\*\*', '', em.group(1)).strip()[:200]

        if situ or rule:
            rows.append({
                'n': n, 'gua': gua, 'pos': pos, 'verdict': verdict,
                'yao': yao, 'situ': situ, 'rule': rule, 'exc': exc,
            })

json.dump(rows, open(r'D:\zhouyi-site\build\_ironrules.json', 'w', encoding='utf-8'),
          ensure_ascii=False, indent=1)

# 统计
with_rule = [r for r in rows if r['rule']]
with_situ = [r for r in rows if r['situ']]
print('抽到 ' + str(len(rows)) + ' 条（目标 384）')
print('  有处境: ' + str(len(with_situ)))
print('  有铁律: ' + str(len(with_rule)))
print()

# 生成人类可读表
out = ['# 六十四卦 · 384 条铁律与处境', '',
       '> 从 content/v3 的 64 篇付费解读里抽出。',
       '> 「处境」= 这一爻讲的是什么状态（放首页的球上）',
       '> 「铁律」= 这种状态下该干什么（用户认领后拿到的第一句话）', '']

cur = None
for r in rows:
    if r['n'] != cur:
        cur = r['n']
        out += ['', '---', '', '## ' + str(r['n']) + '. ' + r['gua'], '']
    out.append('### ' + r['pos'] + ' · ' + (r['verdict'] or r['yao']))
    if r['yao']:
        out.append('')
        out.append('> ' + r['pos'] + '：' + r['yao'])
    if r['situ']:
        out += ['', '**处境**：' + r['situ']]
    if r['rule']:
        out += ['', '**铁律**：' + r['rule']]
    out.append('')

Path(r'D:\zhouyi-site\build\_ironrules.md').write_text('\n'.join(out), encoding='utf-8')
print('已写 build/_ironrules.md 与 _ironrules.json')
