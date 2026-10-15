/**
 * 六十四卦数据集（权威核心数据）
 * 字段说明：
 *   n      序号 1-64（通行本《周易》上下经次序）
 *   id     英文标识（用于路由 #/p/{id}）
 *   name   卦名（如「乾」）
 *   full   全称（如「乾为天」）
 *   symbol Unicode 卦象符号（䷀ 等）
 *   binary 六爻二进制，自下而上（1=阳 0=阴），用于推演与显示
 *   upper  上卦（外卦）
 *   lower  下卦（内卦）
 *   group  所属分组 key
 *   gua    卦辞（《周易》原文）
 *   tuan   彖传
 *   xiang  大象传
 *   yao    六爻爻辞（自初至上）
 *   yaoXiang 六爻小象传
 *   read   白话解读（现代汉语）
 *   use    处世应用（现代场景化建议）
 *   keywords 关键词数组
 */

// 八卦基础
export const BAGUA = {
  qian: { name: '乾', nature: '天', symbol: '☰', binary: [1, 1, 1], attr: '健' },
  dui:  { name: '兑', nature: '泽', symbol: '☱', binary: [1, 1, 0], attr: '悦' },
  li:   { name: '离', nature: '火', symbol: '☲', binary: [1, 0, 1], attr: '丽' },
  zhen: { name: '震', nature: '雷', symbol: '☳', binary: [1, 0, 0], attr: '动' },
  xun:  { name: '巽', nature: '风', symbol: '☴', binary: [0, 1, 1], attr: '入' },
  kan:  { name: '坎', nature: '水', symbol: '☵', binary: [0, 1, 0], attr: '陷' },
  gen:  { name: '艮', nature: '山', symbol: '☶', binary: [0, 0, 1], attr: '止' },
  kun:  { name: '坤', nature: '地', symbol: '☷', binary: [0, 0, 0], attr: '顺' },
};

export const GROUPS = [
  { key: 'uppper', no: 1, name: '上经·乾坤', sub: '天地之始，万物之基', range: [1, 30] },
  { key: 'lower', no: 2, name: '下经·咸恒', sub: '人伦之始，世事之变', range: [31, 64] },
];
