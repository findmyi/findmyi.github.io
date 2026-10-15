"""hexref2 —— 修掉 score KeyError 的取材工具。用法同 hexref.py。"""
import sys, json, io, argparse

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
    lines = [l for l in t.split('\n') if not l.startswith(('来源：', '《', '===='))]
    t = '\n'.join(lines)
    return t[:limit] if limit else t


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('hex')
    ap.add_argument('--top', type=int, default=0)
    ap.add_argument('--book', default='')
    ap.add_argument('--limit', type=int, default=1800)
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
    entries = sorted(entries, key=lambda e: (-len(e['base']), e['kb']))

    if not args.book:
        print('【' + args.hex + '】共 ' + str(len(entries)) + ' 处可查：')
        for e in entries:
            print('  ' + e['dyn'] + '/' + e['book'].ljust(22) + ' ' + e['base'].ljust(14)
                  + ' ' + str(e['kb']).rjust(4) + ' KB')
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
