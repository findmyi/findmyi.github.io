"""hexref —— 按卦取注疏原文。

给 62 卦批量写作用的取材工具。用法：

    python hexref.py 屯              # 列出屯卦可查的所有书目
    python hexref.py 屯 --top 3      # 取前 3 本，各输出前 1500 字
    python hexref.py 屯 --book 周易正義   # 从指定书取全文

数据来自 build/_hex-index.json（已建立 64/64 卦到 19 部书的索引）。
"""
import os, sys, json, io, argparse, glob

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

INDEX = r'D:\zhouyi-site\build\_hex-index.json'
MANIFEST = r'D:\zhouyi-site\data\manifest.json'


def load():
    idx = json.load(open(INDEX, encoding='utf-8'))
    hexes = json.load(open(MANIFEST, encoding='utf-8'))['articles']
    by_name = {}
    for h in hexes:
        by_name[h['name']] = h['id']
        by_name[h['id']] = h['id']
    return idx, by_name


def read(fp, limit=None):
    try:
        t = open(fp, encoding='utf-8', errors='ignore').read()
    except Exception:
        return ''
    # 去掉维基文库的来源标注行
    lines = [l for l in t.split('\n') if not l.startswith(('来源：', '《', '===='))]
    t = '\n'.join(lines)
    return t[:limit] if limit else t


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('hex', help='卦名或 id，如 屯 / zhun')
    ap.add_argument('--top', type=int, default=0, help='取前 N 本')
    ap.add_argument('--book', default='', help='指定书名，取全文')
    ap.add_argument('--limit', type=int, default=1800, help='每本截取字数')
    args = ap.parse_args()

    idx, by_name = load()
    hid = by_name.get(args.hex)
    if not hid:
        print('未找到卦：' + args.hex)
        return
    entries = idx.get(hid, [])
    if not entries:
        print('该卦无索引条目')
        return

    # 按 score 降序（文件名命中优先）
    for e in entries:
        e.setdefault('score', 4 if e.get('level') == 'primary' else 2)
    entries.sort(key=lambda e: (-e['score'], e['kb']))

    if not args.book:
        print('【' + args.hex + '】共 ' + str(len(entries)) + ' 处可查：')
        print()
        for e in entries:
            mark = '★' if e['score'] >= 4 else ('☆' if e['score'] >= 3 else '·')
            print('  ' + mark + ' ' + e['dyn'] + '/' + e['book'].ljust(22)
                  + ' ' + e['base'].ljust(14) + ' ' + str(e['kb']).rjust(4) + ' KB')
        print()
        print('用 --top N 取前 N 本正文，或 --book 书名 取指定书')
        return

    picked = [e for e in entries if args.book in e['book']] if args.book else entries[:args.top]
    if not picked:
        print('未匹配到书：' + args.book)
        return

    for e in picked:
        print('=' * 70)
        print(e['dyn'] + ' / ' + e['book'] + ' / ' + e['base'])
        print('=' * 70)
        print(read(e['file'], args.limit))
        print()


if __name__ == '__main__':
    main()
