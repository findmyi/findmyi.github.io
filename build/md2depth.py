"""把新版乾坤 Markdown 转成 premium-content.mjs 需要的 depth HTML。

规则：
  ## 标题        → <h3 id="...">
  > 引用块       → <blockquote>（爻辞 + 象传，保留原文格式）
  **加粗**       → <strong>
  普通段落       → <p>
  ---            → <hr>
  | 表格 |       → 保留为 <table>（逃生清单用得到）
"""
import re, io, sys, json, os
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

def md_inline(s):
    s = (s.replace('&', '&amp;').replace('<', '&lt;').replace('>', '&gt;'))
    s = re.sub(r'\*\*(.+?)\*\*', r'<strong>\1</strong>', s)
    return s

def slug(s, i):
    s = re.sub(r'[^\w\u4e00-\u9fff]+', '-', s).strip('-').lower()
    return 'p-' + (s[:24] if s else str(i))

def convert(md):
    out = []
    lines = md.split('\n')
    i = 0
    sec_no = 0
    while i < len(lines):
        ln = lines[i]
        s = ln.strip()

        # 引用块
        if s.startswith('>'):
            buf = []
            while i < len(lines) and lines[i].strip().startswith('>'):
                buf.append(lines[i].strip().lstrip('>').strip())
                i += 1
            body = '<br>'.join(md_inline(x) for x in buf if x)
            out.append('<blockquote class="pw-quote">' + body + '</blockquote>')
            continue

        # 标题
        if s.startswith('## '):
            sec_no += 1
            title = s[3:].strip()
            out.append('<h3 id="' + slug(title, sec_no) + '">' + md_inline(title) + '</h3>')
            i += 1
            continue
        if s.startswith('# '):
            i += 1
            continue

        # 分隔线
        if s == '---':
            i += 1
            continue

        # 表格
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

        # 空行
        if not s:
            i += 1
            continue

        # 普通段落
        out.append('<p>' + md_inline(s) + '</p>')
        i += 1

    return '\n'.join(out)


RESULT = {}
for hid, path in [('qian', r'D:\zhouyi-site\content\新版-乾卦.md'),
                  ('kun',  r'D:\zhouyi-site\content\新版-坤卦.md')]:
    md = open(path, encoding='utf-8').read()
    # 标题行 # xxx 不输出（manifest 里已有标题）
    html = convert(md)
    RESULT[hid] = html
    # 存成独立文件供人工检视
    out = r'D:\zhouyi-site\build\_depth-' + hid + '.html'
    open(out, 'w', encoding='utf-8').write(html)
    han = len(re.findall(r'[\u4e00-\u9fff]', html))
    print(hid + ': ' + str(len(html)) + ' 字符 HTML / ' + str(han) + ' 汉字')
    print('   → ' + out)

json.dump(RESULT, open(r'D:\zhouyi-site\build\_depth.json', 'w', encoding='utf-8'),
          ensure_ascii=False)
print()
print('已存 build/_depth.json')
