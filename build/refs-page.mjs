/**
 * 参考书目页数据构建
 * 把 build/refs.mjs 的原始数据整理成可直接渲染的结构
 */
import { REFS, REF_CATS, CORPUS_TOTAL, CORPORA } from './refs.mjs';

/* 书名清洗（渲染前的最后一道） */
function tidyTitle(t) {
  let s = t;

  // 1. 书名号内的长说明保留，但括号里的长注释整段砍掉
  s = s.replace(/【[^】]{20,}】/g, '');

  // 2. 去掉「(作者/译者/丛书说明)」这类括号（含逗号、etc、数字的）
  s = s.replace(/\s*\([^()]*(?:[，,][^()]*|etc\.?|z-library)[^()]*\)/gi, '');
  // 去掉残留的单层括号长注释（>8 字）
  s = s.replace(/\s*\(([^()]{9,})\)\s*/g, ' ');
  // 去掉纯英文/拼音括号
  s = s.replace(/\s*\([A-Za-z0-9 ,.\-·]{2,}\)\s*/g, ' ');

  // 3. 去掉破折号后的超长副标题
  s = s.replace(/^(.{2,30}?)[—–]{1,2}(.{24,})$/, '$1');

  // 4. 去掉结尾的 _作者 / (全N册) / （全三册）
  s = s.replace(/\s*[（(]全\s*[一二三四五六七八九十\d]+\s*[册卷][）)]/g, '');
  s = s.replace(/[_\-][\u4e00-\u9fa5A-Za-z]{2,6}$/, '');

  // 5. 去重：书名里重复出现作者名
  s = s.replace(/\s*\(([^()]{2,10})\)\s*\(?\1?\)?/g, ' ');

  s = s.replace(/\s{2,}/g, ' ').replace(/[\s,，、·]+$/, '').trim();

  // 6. 兜底：书名超过 26 字时，截到第一个括号/破折号之前
  if (s.length > 26) {
    const cut = s.search(/[（(【—–]/);
    if (cut >= 4) s = s.slice(0, cut).trim();
  }
  // 7. 仍超长则硬截
  if (s.length > 32) s = s.slice(0, 30).trim() + '…';

  return s || t;
}

/* 作者清洗 */
function tidyAuthor(a) {
  if (!a) return '';
  let s = a.replace(/著|译注|译|注译|主编|校释|撰/g, '').trim();
  s = s.replace(/^\[.*?\]/, '').trim();
  if (/佚名|^$/.test(s)) return '';
  return s.split(/[，,、]/)[0].trim().slice(0, 14);
}

const ORDER = ['yijing', 'yishu', 'chunqiu', 'shiliao', 'history'];

export const REF_SECTIONS = ORDER
  .filter((k) => REFS.some((r) => r.cat === k))
  .map((k) => ({
    key: k,
    ...REF_CATS[k],
    items: REFS.filter((r) => r.cat === k).map((r) => ({
      title: tidyTitle(r.title),
      author: tidyAuthor(r.author),
      format: r.format,
      volumes: r.volumes || 0,
      size: r.size || 0,
    })),
  }));

export const REF_STATS = {
  total: REFS.length,
  volumes: REFS.reduce((s, r) => s + (r.volumes || 0), 0),
  corpus: CORPUS_TOTAL,
  sections: REF_SECTIONS.length,
};

export { CORPORA };
