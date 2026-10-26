/**
 * 从某阶段里挑出最像用户的 3 条处境
 *
 * 选法：把该阶段的 64 条按「判词冲击力」排一下 ——
 * 判词短的更有力，太长的人记不住。
 * 再均匀取 3 条，避免全是同一个卦。
 */

const { ofStage } = require('./situations');

function pickThree(stageCode) {
  const list = ofStage(stageCode).slice();

  // 判词 8-16 字的优先（太长记不住，太短没味道）
  list.sort((a, b) => {
    const da = Math.abs((a.v || '').length - 12);
    const db = Math.abs((b.v || '').length - 12);
    return da - db;
  });

  const picked = [];
  const usedGua = new Set();

  for (const it of list) {
    if (picked.length >= 3) break;
    // 尽量不同卦
    if (usedGua.has(it.g)) continue;
    usedGua.add(it.g);
    picked.push(it);
  }

  // 不够三条就放宽限制
  for (const it of list) {
    if (picked.length >= 3) break;
    if (!picked.includes(it)) picked.push(it);
  }

  return picked;
}

module.exports = { pickThree };
