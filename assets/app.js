/* ==========================================================================
   周易六十四卦 · 应用逻辑
   三视图 hash 路由：#/ 封面 · #/toc 目录 · #/p/{id} 正文
   --------------------------------------------------------------------------
   付费墙 / 授权（本文件内的 Entitlement 门面）：
     依赖 assets/license.js（离线校验）与 assets/payment.js（购买链接）。
     两者都必须在 app.js 之前加载。
   ========================================================================== */
(function () {
  'use strict';

  /* ---------- 工具 ---------- */
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => (
      { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
    ));
  }

  /* ---------- 状态 ---------- */
  const coverView = $('#coverView');
  const tocView = $('#tocView');
  const articleView = $('#articleView');
  const topbar = $('#topbar');
  const standaloneView = $('#standaloneView');   // 处境索引等独立视图
  const articleTocEl = $('#artToc');

  let M = null;                 // manifest
  const cache = {};             // 正文片段缓存
  let searchData = null;
  let currentId = null;
  let readProgressEl = $('#readProgress');
  let tocSpy = null;

  const LS = {
    get(k, d) { try { return JSON.parse(localStorage.getItem('zhouyi.' + k)) ?? d; } catch { return d; } },
    set(k, v) { try { localStorage.setItem('zhouyi.' + k, JSON.stringify(v)); } catch {} },
  };

  /* ==========================================================================
     Entitlement —— 权益层
     --------------------------------------------------------------------------
     职责：回答一个问题 —— 「这篇文章现在能不能看完整版？」
     真相来源：data/manifest.json 里每篇的 tier 字段。
     登记来源：localStorage（由 License 模块管理）。

     优雅降级（很重要）：
       · manifest 没有 meta.premium 或某篇没有 tier → 该篇视为免费
       · license.js / payment.js 没加载 → 视为免费，绝不把读者挡在门外
       这条规则保证：任何配置缺失都不会让站点变成一堵墙。
     ========================================================================== */
  const Entitlement = {
    /** 底层依赖是否就绪 */
    get ready() {
      return typeof window.License !== 'undefined';
    },

    /** 已激活的等级列表 */
    tiers() {
      return this.ready ? window.License.activeTiers() : [];
    },

    /** 付费功能是否被 manifest 启用 */
    get enabled() {
      return !!(M && M.meta && M.meta.premium && M.meta.premium.enabled);
    },

    /** 取某篇的 tier（'free' | 'premium'）。无信息一律 free。 */
    tierOf(articleId) {
      if (!M) return 'free';
      const a = (M.articles || []).find((x) => x.id === articleId)
        || (M.front || []).find((x) => x.id === articleId);
      return (a && a.tier) || 'free';
    },

    /** 这篇文章是否需要付费 */
    needsPaywall(articleId) {
      if (!this.enabled) return false;
      return this.tierOf(articleId) === 'premium';
    },

    /**
     * 核心 API：这篇是否已解锁（免费文章恒为 true）。
     * @param {string} articleId
     * @returns {boolean}
     */
    isUnlocked(articleId) {
      if (!this.needsPaywall(articleId)) return true;   // 免费内容
      if (!this.ready) return false;
      const tiers = this.tiers();
      if (!tiers.length) return false;
      return window.License.tiersCover(tiers, articleId);
    },

    /**
     * 核心 API：用授权码解锁。
     *
     * 如果加载了 license-server.js（一码一机），走服务端；
     * 否则退回本地校验。服务端不可用时自动降级 —— 绝不锁死已购用户。
     *
     * @param {string} key 用户输入的授权码
     * @returns {Promise<{ok:boolean, tier?:string, label?:string, reason?:string, covers?:boolean}>}
     */
    async unlock(key) {
      if (!this.ready) {
        return { ok: false, reason: '授权模块未加载，请刷新页面后重试。' };
      }
      const res = window.LicenseServer
        ? await window.LicenseServer.activate(key)
        : window.License.activate(key);
      if (!res.ok) return res;
      // 告诉调用方这个码是否覆盖当前文章（用于「已解锁但不是这篇」的提示）
      res.covers = this.isUnlocked(currentId);
      return res;
    },

    /** 撤销本机全部授权 */
    reset() {
      if (this.ready) window.License.clear();
    },

    /** 认证信息文案（给「已解锁」条用） */
    label() {
      const tiers = this.tiers();
      if (!tiers.length) return '';
      return tiers
        .map((t) => (window.License.TIERS[t] || {}).label || t)
        .join(' · ');
    },
  };

  // 暴露到全局，便于调试与后续扩展（也供 Worker 版升级时复用）
  window.Entitlement = Entitlement;


  /* ---------- 资源加载 ---------- */
  async function getJSON(url) {
    const r = await fetch(url, { cache: 'no-cache' });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return r.json();
  }
  async function getText(url) {
    const r = await fetch(url, { cache: 'no-cache' });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return r.text();
  }
  async function article(id) {
    if (cache[id] != null) return cache[id];
    cache[id] = await getText(`articles/${id}.html`);
    return cache[id];
  }

  const byId = (id) =>
    (M.front || []).find((a) => a.id === id) || M.articles.find((a) => a.id === id);
  const byN = (n) => M.articles.find((a) => a.n === n);
  const isFront = (a) => !!a.isFront;
  const frontList = () => M.front || [];

  /* ---------- Toast ---------- */
  let toastTimer = null;
  function toast(msg) {
    const el = $('#toast');
    el.textContent = msg;
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.hidden = true; }, 1900);
  }

  /* ---------- 封面渲染 ---------- */
  /* ==========================================================================
     首屏右侧
     --------------------------------------------------------------------------
     用户是「求助者」，不是「读者」。
     所以右侧不放内容预告，也不只放一张样例卡 ——
     直接把「要做什么」摆出来：一个问题 + 一个按钮 + 结果长什么样。

     结构：
       你现在，在哪个阶段？          ← 问题
       384 条处境，12 道题，三分钟。   ← 门槛说明
       [ 开始测一测 ]                ← 主按钮
       或者直接看六个阶段 →           ← 次要出路
       ─────────────
       你在哪 / 该做什么 / 什么情况下不适用   ← 结果样例，三卡
     ========================================================================== */
  const HERO_SAMPLE = {
    situ: '你看上一个机会，判断它肯定能成。可你心里清楚，这个行业的水深你没趟过。',
    rule: '在投入第一笔实质成本之前，先找一个在这个圈子里待满三年的人，问他一句最怕什么。',
    exc: '如果这件事亏到底也只损失一笔你能承受的学费，不伤你的根基，那就去闯。',
  };

  function renderHeroSample() {
    const host = $('#heroSample');
    if (!host) return;
    const s = HERO_SAMPLE;
    host.innerHTML = [
      '<div class="hs-inner">',
      '  <h2 class="hs-q">你现在，在哪个阶段？</h2>',
      '  <p class="hs-lede">384 条处境，来自六十四卦的每一爻。<br>12 道题，三分钟。</p>',
      '  <a class="hs-main" href="#/quiz">开始测一测</a>',
      '  <a class="hs-alt" href="#/s">或者直接看六个阶段 →</a>',
      '  <div class="hs-rule"></div>',
      '  <div class="hs-cards">',
      '    <div class="hs-card">',
      '      <span>你在哪</span>',
      '      <p>' + esc(s.situ) + '</p>',
      '    </div>',
      '    <div class="hs-card is-do">',
      '      <span>该做什么</span>',
      '      <p>' + esc(s.rule) + '</p>',
      '    </div>',
      '    <div class="hs-card is-exc">',
      '      <span>什么情况下不适用</span>',
      '      <p>' + esc(s.exc) + '</p>',
      '    </div>',
      '  </div>',
      '</div>',
    ].join('\n');
  }

  function renderCover() {
    const total = M.meta.total;

    // 顶栏计数
    $('#tocCount').textContent = total;

    // 滚动字幕：卦名序列（可点击，直接进那一卦）
    const track = $('#marqueeTrack');
    const items = M.articles.map((a) =>
      `<a href="#/p/${esc(a.id)}" title="第 ${a.n} 卦 · ${esc(a.full)}">${esc(a.name)}　${esc(a.full)}</a>`
    );
    track.innerHTML = items.concat(items).join('');

    // 统计
    const totalYao = M.articles.reduce((s, a) => s + (a.yaoCount || 0), 0);
    $('#heroStats').innerHTML = [
      `${total} 卦`,
      `${totalYao} 爻`,
      '上经三十 · 下经三十四',
      '卦辞 · 彖传 · 象传 · 爻辞',
    ].map((t) => `<span>${esc(t)}</span>`).join('');

    // 「继续阅读」入口已移除 —— 首屏同时有两个 CTA 就够了，
    // 第三个入口只会稀释注意力。

    // 阅读路径（贴近前置篇的真实入口）
    /* 首页入口：前 6 个是「你在哪个阶段」，最后给完全没接触过的人。
       阶段 = 六爻，是《周易》本来的结构，不是猜出来的分类。 */
    const paths = [
      { glyph: '①', tt: '还没起来', sub: '你说的话没人听，做的事没人跟', to: '#/s/P1' },
      { glyph: '②', tt: '刚被看见', sub: '有人开始注意你，但还不稳', to: '#/s/P2' },
      { glyph: '③', tt: '最难的中段', sub: '上面要交代，下面要带，两头受气', to: '#/s/P3' },
      { glyph: '④', tt: '在关口上', sub: '离核心很近了，要不要迈那一步', to: '#/s/P4' },
      { glyph: '⑤', tt: '到顶了', sub: '位置最高，责任最重，反而睡不好', to: '#/s/P5' },
      { glyph: '⑥', tt: '该收了', sub: '已经过顶，感觉在往下走', to: '#/s/P6' },
      { glyph: '◆', tt: '我完全没接触过《周易》', sub: '从卷首三篇开始，约 11 分钟', to: '#/p/preface' },
    ];
    $('#readingPaths').innerHTML = paths.map((p) => `
      <a class="path-card" href="${p.to}">
        <span class="pc-glyph" aria-hidden="true">${p.glyph}</span>
        <div class="pc-tt">${esc(p.tt)}</div>
        <div class="pc-sub">${esc(p.sub)}</div>
      </a>`).join('');

    // 方圆图（首页）
    renderDisc();

    // 精选：前置必读 3 篇（这是「体」）
    const fl = frontList();
    const mustRead = ['preface', 'basics-64', 'method-divination']
      .map((id) => fl.find((x) => x.id === id)).filter(Boolean);
    const pickGrid = $('#pickGrid');
    if (mustRead.length) {
      pickGrid.innerHTML = mustRead.map((a) => `
        <a class="pick pick-front" href="#/p/${a.id}">
          <div class="pick-top">
            <span class="pick-glyph" aria-hidden="true">◆</span>
            <div>
              <div class="pick-name">${esc(a.short || a.name)}</div>
              <div class="pick-full">${esc(a.groupName)}</div>
            </div>
          </div>
          <p class="pick-quote">${esc(a.title || '')}</p>
          <p class="pick-read">${esc(a.excerpt || '')}</p>
          <div class="pick-foot">${esc((a.keywords || []).join(' · '))}</div>
        </a>`).join('');
    }

    // 上下经 + 前置分组卡片
    $('#fileGrid').innerHTML = M.meta.groups.map((g) => {
      const isFrontGroup = !!g.isFront;
      const cnt = isFrontGroup
        ? fl.filter((a) => a.group === g.key).length
        : M.articles.filter((a) => a.group === g.key).length;
      return `
      <a class="file-card${isFrontGroup ? ' fc-front' : ''}" href="#/toc/${g.key}">
        <span class="fc-no">${String(g.no).padStart(2, '0')}</span>
        <div class="fc-tt">${esc(g.name)}</div>
        <div class="fc-sub">${esc(g.sub)}</div>
        <div class="fc-meta">${cnt} ${isFrontGroup ? '篇 · 阅读基础' : `卦 · 第 ${g.range[0]}–${g.range[1]} 卦`}</div>
      </a>`;
    }).join('');
  }

  /* ---------- 心跳图（横向 · 左为初爻，右为上爻） ----------
   * 把六爻的阴阳画成一条折线：
   *   横轴 = 爻位，自左至右为 初→二→三→四→五→上
   *   纵轴 = 阴阳，阳爻走高（上），阴爻走低（下）
   *
   * 于是：
   *   乾（全阳）→ 一条贴顶的直线
   *   坤（全阴）→ 一条贴底的直线
   *   既济（阳阴交替）→ 明显的高低锯齿
   *   泰（下三阳上三阴）→ 左半高、右半低
   *   否（下三阴上三阳）→ 左半低、右半高
   */
  function pulseSVG(binary, cls) {
    if (!Array.isArray(binary) || binary.length !== 6) return '';
    const W = 86, H = 24;
    const padX = 5, padY = 4;
    const stepX = (W - padX * 2) / 5;
    const hi = padY;                 // 阳爻的 y（上）
    const lo = H - padY;             // 阴爻的 y（下）

    // 自左至右：index 0（初爻）在最左
    const pts = binary.map((b, i) => ({
      x: padX + i * stepX,
      y: b ? hi : lo,
    }));

    // 平滑连接（横向为主，按 x 的中点做控制点）
    let d = `M ${pts[0].x.toFixed(1)} ${pts[0].y.toFixed(1)}`;
    for (let i = 1; i < pts.length; i++) {
      const p = pts[i - 1], c = pts[i];
      const mx = (p.x + c.x) / 2;
      d += ` C ${mx.toFixed(1)} ${p.y.toFixed(1)}, ${mx.toFixed(1)} ${c.y.toFixed(1)}, ${c.x.toFixed(1)} ${c.y.toFixed(1)}`;
    }

    const dots = pts
      .map((p) => `<circle class="pl-dot" cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="1.9" />`)
      .join('');

    return `<svg class="${cls || 'tocv-pulse'}" viewBox="0 0 ${W} ${H}" aria-hidden="true">
      <path class="pl-line" d="${d}" />
      ${dots}
    </svg>`;
  }

  /* ---------- 目录 · 竹简（方案 07：心电图作主视觉） ----------
   * 8 列 × 8 行 = 64 片，每片一卦。
   * 每片结构：序号 → 卦名竖排 → 心电图（主视觉）→ 卦象 + 全称
   * 心电图横向：左 = 初爻，右 = 上爻；阳爻走高、阴爻走低。
   */
  function renderSlips() {
    const wrap = $('#slipsWrap');
    if (!wrap) return;

    wrap.innerHTML = M.articles.map((h) => `
      <a class="slip" href="#/p/${h.id}" title="${esc(h.name)}卦 · ${esc(h.full)}">
        <span class="slip-no">${String(h.n).padStart(2, '0')}</span>
        <span class="slip-body"><span class="slip-text">${esc(h.name)}</span></span>
        <span class="slip-plot">${pulseSVG(h.binary, 'slip-pulse')}</span>
        <span class="slip-foot">
          <span class="slip-glyph">${h.symbol}</span>
          <span class="slip-full">${esc(h.full)}</span>
        </span>
      </a>`).join('');
  }
  /* ---------- 首页 · 先天六十四卦图（方阵 / 圆图 双视图） ----------
   * 圆图：位置由 manifest.meta.circleIndex 给出（0 = 正上乾，顺时针）
   * 方阵：按圆图序排成 8×8，每行一宫 —— 朱熹《易學啟蒙》方圆并置
   * 右侧：悬停卦的卦象、六爻、卦辞
   */
  /* 八宫顺序：乾坤震巽坎离艮兑（每行一宫，本宫卦在该行首位） */
  const PALACE_NAMES = ['乾', '坤', '震', '巽', '坎', '离', '艮', '兑'];
  const PALACE_COLORS = ['#a8322a', '#3f6f7a', '#4f7a4a', '#8a7a3f',
                         '#4a5a8a', '#b5651d', '#7a4a7a', '#6f5a4a'];

  /* 行内上卦次序：前四宫用先天正序，后四宫用反序 —— 与先天横图一致 */
  const UPPER_ORDER = ['乾', '兑', '离', '震', '巽', '坎', '艮', '坤'];
  const UPPER_ORDER_REV = UPPER_ORDER.slice().reverse();

  /* 圆图序排列的六十四卦 */
  function circleOrdered() {
    const CIR = (M.meta && M.meta.circleIndex) || {};
    return M.articles.slice().sort((a, b) => (CIR[a.id] ?? 99) - (CIR[b.id] ?? 99));
  }

  /* 按八宫（下卦）分组的 8×8 矩阵。
     每行以该宫的本宫卦为首（乾宫行首为乾、坤宫行首为坤）。 */
  function matrixRows() {
    const ord = circleOrdered();
    return PALACE_NAMES.map((g) => {
      const i = ord.findIndex((h) => h.lower === g);
      const start = Math.floor(i / 8) * 8;
      const row = ord.slice(start, start + 8);
      const seq = ['巽', '坎', '艮', '坤'].indexOf(g) >= 0 ? UPPER_ORDER_REV : UPPER_ORDER;
      return row.slice().sort((a, b) => seq.indexOf(a.upper) - seq.indexOf(b.upper));
    });
  }

  /* 爻线（bin[0] = 初爻，画在最下） */
  function yaoSVG(bin, cx, cy, w, gap, th, color) {
    let s = '';
    bin.forEach((v, k) => {
      const y = cy + (2.5 - k) * gap;
      if (v) {
        s += `<rect x="${(cx - w / 2).toFixed(1)}" y="${y.toFixed(1)}" width="${w}" height="${th}" rx="0.6" fill="${color}"/>`;
      } else {
        const h = (w - gap * 0.7) / 2;
        s += `<rect x="${(cx - w / 2).toFixed(1)}" y="${y.toFixed(1)}" width="${h.toFixed(1)}" height="${th}" rx="0.6" fill="${color}"/>`;
        s += `<rect x="${(cx + gap * 0.35).toFixed(1)}" y="${y.toFixed(1)}" width="${h.toFixed(1)}" height="${th}" rx="0.6" fill="${color}"/>`;
      }
    });
    return s;
  }

  /* ---------- 方阵视图（首页默认） ---------- */
  /* ---------- 方阵几何：预设 ----------
   * 用 URL 参数切换，形如  ?mx=C / ?mx=C2 / ?mx=C3
   * 目的：在【真实首页比例】下对比，而不是脱离页面的测试页。
   *
   * gapX = 左右间距（疏）
   * gapY = 上下间距（密）—— 行与行贴紧一些，八行更成一体
   */
  const MATRIX_PRESETS = {
    // A · 原始（格子 128×96）
    A: { cw: 128, ch: 96, gapX: 8, gapY: 8, padL: 46, padR: 4, top: 6,
         palaceFont: 21, nameFont: 15, fullFont: 10,
         yaoW: 52, yaoGap: 7.2, yaoTh: 4, yaoCy: 34,
         nameDy: -24, fullDy: -10 },
    // C · 左右 19 / 上下 19（原来上下同宽）
    C: { cw: 118.9, ch: 86, gapX: 19, gapY: 19, padL: 42, padR: 4, top: 6,
         palaceFont: 19, nameFont: 13.5, fullFont: 9,
         yaoW: 43, yaoGap: 6, yaoTh: 3.4, yaoCy: 31,
         nameDy: -21, fullDy: -8 },
    // C2 · 左右 22 / 上下 10（上下明显收紧）
    C2: { cw: 116.2, ch: 88, gapX: 22, gapY: 10, padL: 42, padR: 4, top: 6,
          palaceFont: 19, nameFont: 13.5, fullFont: 9,
          yaoW: 43, yaoGap: 6.1, yaoTh: 3.5, yaoCy: 32,
          nameDy: -21, fullDy: -8 },
    // C3 · 左右 25 / 上下 6（上下最紧，行距贴合成块）
    C3: { cw: 113.6, ch: 90, gapX: 25, gapY: 6, padL: 42, padR: 4, top: 6,
          palaceFont: 19, nameFont: 13.5, fullFont: 9,
          yaoW: 43, yaoGap: 6.2, yaoTh: 3.5, yaoCy: 33,
          nameDy: -22, fullDy: -8 },
  };

  function currentPreset() {
    // 参数可能出现在 search（?mx=C2）或 hash（#/toc?mx=C2）里，两者都读
    const src = `${location.search || ''}&${location.hash || ''}`;
    const m = /[?&]mx=(A|C2|C3|C)\b/i.exec(src);
    return (m && MATRIX_PRESETS[m[1].toUpperCase()]) || MATRIX_PRESETS.C2;
  }

  function renderMatrix(host, onPick) {
    const g = currentPreset();
    const { cw, ch, padL, padR, top, gapX, gapY } = g;
    const rows = matrixRows();
    const S = padL + cw * 8 + gapX * 7 + padR;
    const H = top * 2 + ch * 8 + gapY * 7;

    let s = `<svg class="mx-svg" viewBox="0 0 ${S} ${H}" preserveAspectRatio="xMidYMid meet">`;

    for (let r = 0; r < 8; r++) {
      const gy = top + r * (ch + gapY) + ch / 2;
      s += `<text x="${padL - 13}" y="${gy}" text-anchor="end" dominant-baseline="middle"
              style="font-size:${g.palaceFont}px;font-family:var(--serif);font-weight:700;fill:${PALACE_COLORS[r]}">${PALACE_NAMES[r]}</text>`;

      for (let c = 0; c < 8; c++) {
        const h = rows[r][c];
        if (!h) continue;
        const x = padL + c * (cw + gapX), y = top + r * (ch + gapY);
        const col = PALACE_COLORS[r];
        s += `<g class="mx-cell" data-id="${h.id}">
          <rect x="${x + 2}" y="${y + 2}" width="${cw - 4}" height="${ch - 4}" rx="6"
                fill="${col}" opacity=".07"/>
          <rect x="${x + 2}" y="${y + 2}" width="${cw - 4}" height="${ch - 4}" rx="6"
                fill="none" stroke="${col}" stroke-width="1" opacity=".38"/>
          ${yaoSVG(h.binary, x + cw / 2, y + g.yaoCy, g.yaoW, g.yaoGap, g.yaoTh, 'var(--ink-2)')}
          <text x="${x + cw / 2}" y="${y + ch + g.nameDy}" text-anchor="middle"
                style="font-size:${g.nameFont}px;font-family:var(--serif);font-weight:600;fill:var(--ink)">${esc(h.name)}</text>
          <text x="${x + cw / 2}" y="${y + ch + g.fullDy}" text-anchor="middle"
                style="font-size:${g.fullFont}px;font-family:var(--serif);fill:var(--ink-4)">${esc(h.full)}</text>
        </g>`;
      }
    }
    s += '</svg>';

    host.innerHTML = `<div class="mx-wrap">${s}</div>`;
    host.querySelectorAll('.mx-cell').forEach((el) => {
      el.addEventListener('mouseenter', () => {
        const h = M.articles.find((x) => x.id === el.dataset.id);
        if (h) onPick(h);
      });
    });
  }

  /* ---------- 右侧详情栏 ---------- */
  const yaoCache = {};
  async function loadYao(h) {
    if (yaoCache[h.id]) return yaoCache[h.id];
    try {
      const html = await getText(`articles/${h.id}.html`);
      const doc = new DOMParser().parseFromString(html, 'text/html');
      const list = Array.from(doc.querySelectorAll('.yao-list li')).map((li) => {
        const c = li.cloneNode(true);
        const x = c.querySelector('.yao-xiang');
        if (x) x.remove();
        return c.textContent.trim();
      });
      yaoCache[h.id] = list;
      return list;
    } catch { return null; }
  }

  function sideHTML(h, yaoItems) {
    const pos = ['初', '二', '三', '四', '五', '上'];
    const yao = (h.binary || []).map((b, i) => {
      const sym = b ? '&#8212;' : '--';
      const txt = (yaoItems && yaoItems[i]) || `${pos[i]}${b ? '九' : '六'}`;
      return `<li class="ds-line">
        <span class="dl-sym">${sym}</span>
        <span class="dl-txt">${esc(txt)}</span>
      </li>`;
    }).join('');

    // 六爻之下的史事引流块：数据来自 manifest.meta.hexStory
    // 文案故意在关键处用「……」断掉，引人点进完整阅读。
    // 没配故事的卦整块不出现，不会留下空壳。
    const st = (M.meta && M.meta.hexStory && M.meta.hexStory[h.id]) || null;
    const story = st ? `
      <div class="ds-story">
        <div class="dst-head">
          <span class="dst-who">${esc(st.who)}</span>
          <span class="dst-era">${esc(st.era)}</span>
        </div>
        <p class="dst-text">${esc(st.text)}</p>
        <a class="dst-go" href="#/p/${h.id}">
          <span>完整阅读</span>
          <svg viewBox="0 0 20 20" width="13" height="13" aria-hidden="true">
            <circle cx="10" cy="10" r="8.4" fill="none" stroke="currentColor" stroke-width="1.6"/>
            <path d="M8.5 6.6 L12.3 10 L8.5 13.4" fill="none" stroke="currentColor"
                  stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
        </a>
      </div>` : '';

    return `
      <div class="ds-head">
        <span class="ds-sym">${h.symbol}</span>
        <div class="ds-hd-txt">
          <div class="ds-no">第 ${h.n} 卦</div>
          <div class="ds-name">${esc(h.name)}卦</div>
          <div class="ds-full">${esc(h.full)}</div>
          <div class="ds-tri"><span>上卦 · ${esc(h.upper)}</span><span>下卦 · ${esc(h.lower)}</span></div>
        </div>
      </div>
      <div class="ds-sec-tt">卦辞</div>
      <p class="ds-gua">${esc(h.gua || h.quote || '')}</p>
      <div class="ds-sec-tt">六爻</div>
      <ul class="ds-yao">${yao}</ul>
      ${story}`;
  }

  /* ---------- 视图装配 ---------- */
  function renderDisc() {
    const host = $('#discWrap');
    if (!host) return;
    const ord = circleOrdered();
    if (!ord.length) return;

    let current = ord[0];     // 默认乾卦
    let seq = 0;

    host.innerHTML = `
      <div class="disc-layout">
        <div class="disc-stage-host" id="discStage"></div>
        <aside class="disc-side" id="discSide"></aside>
      </div>`;

    const stage = $('#discStage');
    const side = $('#discSide');

    async function show(h) {
      current = h;
      const my = ++seq;
      side.innerHTML = sideHTML(h, yaoCache[h.id] || null);
      const items = await loadYao(h);
      if (my === seq && items) side.innerHTML = sideHTML(h, items);
    }

    function draw() {
      stage.className = 'disc-stage-host is-square';
      renderMatrix(stage, show);
      show(current);
    }

    draw();
  }

  /* ---------- 目录渲染 ---------- */
  function renderToc() {
    $('#tocCount').textContent = M.meta.total;
    const ft = M.meta.frontTotal || 0;
    $('.tocv-title').textContent = `先读前置 ${ft} 篇，再览六十四卦`;

    // 大目录序号用中文数字（一 二 三 …）
    const CN_NUM = ['一', '二', '三', '四', '五', '六', '七', '八', '九', '十'];

    $('#tocViewBody').innerHTML = M.meta.groups.map((g, gi) => {
      const isFrontGroup = !!g.isFront;
      const list = isFrontGroup
        ? (M.front || []).filter((a) => a.group === g.key)
        : M.articles.filter((a) => a.group === g.key);
      const unit = isFrontGroup ? '篇' : '卦';

      // 横条卡片：小目录序号保持 01 02 03
      // 六十四卦顺序 = 数字 + 卦象 + 卦名 + 全称
      const body = `<div class="tocv-list${isFrontGroup ? ' is-front' : ''}">
          ${list.map((a) => isFrontGroup
            ? `<a class="tocv-item" href="#/p/${a.id}">
                 <span class="tocv-no">${String(a.seq || a.n).padStart(2, '0')}</span>
                 <span class="tocv-glyph" aria-hidden="true">◆</span>
                 <span class="tocv-name">${esc(a.short || a.name)}</span>
                 <span class="tocv-meta">约 ${a.mins} 分钟</span>
               </a>`
            : `<a class="tocv-item" href="#/p/${a.id}" title="${esc(a.name)}卦 · ${esc(a.full)}">
                 <span class="tocv-no">${String(a.n).padStart(2, '0')}</span>
                 <span class="tocv-glyph" aria-hidden="true">${a.symbol}</span>
                 <span class="tocv-name">${esc(a.name)}</span>
                 <span class="tocv-full">${esc(a.full)}</span>
                 ${pulseSVG(a.binary, 'tocv-pulse')}
               </a>`).join('')}
        </div>`;

      return `
      <section class="tocv-group${isFrontGroup ? ' toc-front' : ''}" id="group-${g.key}">
        <div class="tocv-ghead">
          <span class="tocv-gno">${CN_NUM[gi] || (gi + 1)}</span>
          <span class="tocv-gname">${esc(g.name)}</span>
          <span class="tocv-gsub">${esc(g.sub)}</span>
          <span class="tocv-gcnt">${list.length} ${unit}</span>
        </div>
        ${body}
      </section>`;
    }).join('');
  }

  /* ---------- 正文渲染 ---------- */
  async function showArticle(a, sec) {
    currentId = a.id;
    LS.set('last', a.id);

    const front = isFront(a);

    $('#crumb').innerHTML =
      `<a href="#/">封面</a><span class="sep">/</span>` +
      `<a href="#/toc">目录</a><span class="sep">/</span>` +
      `<span>${esc(front ? a.name : a.name + '卦')}</span>`;

    $('#artTitle').textContent = front
      ? a.title || a.name
      : `${a.name}卦 · ${a.full}`;

    $('#artMeta').innerHTML = [
      front ? '前置篇' : `第 ${a.n} 卦`,
      a.groupName,
      !front && a.yaoCount ? `${a.yaoCount} 爻` : '',
      `约 ${a.mins} 分钟`,
    ].filter(Boolean).map((t) => `<span>${esc(t)}</span>`).join('');

    const body = $('#artBody');
    body.innerHTML = '<p class="load-state">正在载入…</p>';

    let html = '';
    try {
      html = await article(a.id);
    } catch (e) {
      body.innerHTML = '<p class="load-state">这一卦暂时没有加载成功，请检查网络后重试。</p>' +
        '<button class="pill-btn" id="articleRetry">重新加载</button>';
      $('#articleRetry').onclick = () => showArticle(a, sec);
      return;
    }

    body.innerHTML = html;

    // 头部：卦象（六十四卦）或前置篇标识
    const head = document.createElement('div');
    if (front) {
      head.className = 'hex-head front-head';
      head.innerHTML = `
        <div class="front-mark" aria-hidden="true">◆</div>
        <div class="hex-info">
          <div class="hex-num">${esc(a.groupName)}</div>
          <h2 class="hex-name">${esc(a.name)}</h2>
          <div class="hex-full">${esc(a.groupSub || '')}</div>
          <div class="hex-tri"><span>阅读基础</span><span>约 ${a.mins} 分钟</span></div>
        </div>`;
    } else {
      head.className = 'hex-head';
      head.innerHTML = `
        <div class="hex-symbol" aria-hidden="true">${a.symbol}</div>
        <div class="hex-info">
          <div class="hex-num">HEXAGRAM ${String(a.n).padStart(2, '0')}</div>
          <h2 class="hex-name">${esc(a.name)}卦</h2>
          <div class="hex-full">${esc(a.full)}</div>
          <div class="hex-tri">
            <span>上卦 · ${esc(a.upper)}</span>
            <span>下卦 · ${esc(a.lower)}</span>
            <span>${esc(a.groupName)}</span>
          </div>
        </div>`;
    }
    body.insertBefore(head, body.firstChild);

    renderPaywall(a);
    buildToc();
    buildNav(a);
    renderPetPanel(a.id);
    window.scrollTo({ top: 0, behavior: 'auto' });

    if (sec) {
      const target = document.getElementById(sec);
      if (target) requestAnimationFrame(() => target.scrollIntoView({ behavior: 'smooth', block: 'start' }));
    }
  }

  /* ==========================================================================
     付费墙渲染
     --------------------------------------------------------------------------
     设计立场：
       · 不做硬拦截。免费部分（原文/彖传/象传/六爻/白话/应用）全部照常读完，
         付费卡出现在正文之后。读者此时已经拿到价值，付费是「继续」而非「勒索」。
       · 不写免责声明、不写「关于本站」、不标学术依据 —— 用户要的是内容，
         不是作者的自我辩解。只留三条对买家有用的：买断制、交付什么、后续修订。
       · 两条解锁路径并列：买（跳转平台）或已有码（输入框）。
       · 两条解锁路径并列：买（跳转平台）或已有码（输入框）。
     ========================================================================== */

  /** 取这篇的付费卡数据（来自 manifest.meta.premium.cards） */
  function premiumCard(id) {
    const P = M && M.meta && M.meta.premium;
    if (!P || !P.cards) return null;
    return P.cards[id] || null;
  }

  /** 渲染购买渠道按钮 */
  function buyButtonsHtml() {
    if (typeof window.Payment === 'undefined') return '';
    const channels = window.Payment.channels();
    if (!channels.length) {
      return '<div class="pw-msg">购买渠道尚未开放，请稍后再来，或直接联系我们。</div>';
    }
    return channels.map((c, i) => {
      const primary = i === 0 && !c.isManual;
      const glyph = c.isManual ? '✉' : '↗';
      const ext = c.isManual ? '' : ' target="_blank" rel="noopener noreferrer"';
      return '<a class="pw-buy-btn' + (primary ? '' : ' is-secondary') +
        '" href="' + esc(c.url) + '"' + ext + '>' +
        '<span class="pw-buy-glyph" aria-hidden="true">' + glyph + '</span>' +
        '<span class="pw-buy-main">' +
          '<span class="pw-buy-name">' + esc(c.name) + '购买</span>' +
          '<span class="pw-buy-desc">' + esc(c.desc) + '</span>' +
        '</span>' +
        (c.fee ? '<span class="pw-buy-fee">费率 ' + esc(c.fee) + '</span>' : '') +
      '</a>';
    }).join('');
  }

  /**
   * 渲染定价档位卡。
   * 写法原则：不写功能，写「他会拿到什么」；并明确列出「不包含什么」——
   * 后者反而增加信任（用户知道你不会糊弄他）。
   */
  function tiersHtml() {
    if (typeof window.Payment === 'undefined') return '';
    const tiers = window.Payment.tiers();
    if (!tiers.length) return '';

    const cards = tiers.map((t) => {
      const items = (t.items || []).map(([title, desc]) =>
        '<li><b>' + esc(title) + '</b>' + (desc ? '<span>' + esc(desc) + '</span>' : '') + '</li>'
      ).join('');

      const ex = (t.excludes && t.excludes.length)
        ? '<div class="pw-tier-ex">' +
            '<div class="pw-tier-ex-tt">不包含</div><ul>' +
            t.excludes.map((x) => '<li>' + esc(x) + '</li>').join('') +
          '</ul></div>'
        : '';

      return [
        '<div class="pw-tier' + (t.featured ? ' is-featured' : '') + '" data-tier="' + esc(t.id) + '">',
        t.featured ? '  <div class="pw-tier-flag">最常选</div>' : '',
        '  <div class="pw-tier-name">' + esc(t.name) + '</div>',
        '  <div class="pw-tier-price"><small>￥</small>' + esc(String(t.price)) + '</div>',
        '  <div class="pw-tier-tag">' + esc(t.tagline || '') + '</div>',
        '  <ul class="pw-tier-items">' + items + '</ul>',
        '  ' + ex,
        t.note ? '  <div class="pw-tier-note">' + esc(t.note) + '</div>' : '',
        // 站内直接购买：点它就走 下单 → 支付 → 自动解锁
        '  <button type="button" class="pw-tier-buy" data-buy="' + esc(t.id) + '">',
        '    立即购买 · ￥' + esc(String(t.price)),
        '  </button>',
        '</div>',
      ].join('\n');
    }).join('\n');

    return '<div class="pw-sec-tt">怎么买 · 两档，都是终身买断</div>' +
           '<div class="pw-tiers">' + cards + '</div>' +
           '<div class="pw-pay-modal" id="pwPayModal" hidden>' +
           '  <div class="pw-pay-box">' +
           '    <button type="button" class="pw-pay-close" id="pwPayClose" aria-label="关闭">×</button>' +
           '    <div class="pw-pay-body" id="pwPayBody"></div>' +
           '  </div>' +
           '</div>';
  }

  /* ==========================================================================
     站内购买流程
     --------------------------------------------------------------------------
     点「立即购买」→ Worker 建订单 → 展示支付 → 轮询状态 → 付款成功自动解锁。

     用户不需要输码、不需要加微信。
     授权码在付款成功时由 Worker 生成，前端拿到后自动绑定本机。
     ========================================================================== */

  let payPollTimer = null;

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  /** 把 Worker 返回的相对路径拼成绝对地址 */
  function absPayUrl(u) {
    if (!u) return '';
    if (/^https?:\/\//i.test(u)) return u;
    const w = (typeof window.Payment !== 'undefined') ? window.Payment.workerUrl() : '';
    if (!w) return u;
    try { return new URL(w).origin + u; } catch { return u; }
  }

  function closePayModal() {
    const m = document.getElementById('pwPayModal');
    if (m) { m.hidden = true; m.classList.remove('on'); }
    if (payPollTimer) { clearInterval(payPollTimer); payPollTimer = null; }
  }

  function showPayModal(html) {
    const m = document.getElementById('pwPayModal');
    const b = document.getElementById('pwPayBody');
    if (!m || !b) return;
    b.innerHTML = html;
    m.hidden = false;
    requestAnimationFrame(() => m.classList.add('on'));
  }

  /** 把一段文本渲染成二维码（用本地 qrcode-generator，不依赖外网） */
  function renderQrInto(el, text, size) {
    if (!el || !text) return;
    const px = size || 190;
    try {
      if (typeof qrcode === 'undefined') {
        el.innerHTML = '<span style="font-size:11px;color:#9a938a">二维码组件未加载</span>';
        return;
      }
      const qr = qrcode(0, 'M');
      qr.addData(text);
      qr.make();
      el.innerHTML = qr.createImgTag(6, 8);
      const img = el.querySelector('img');
      if (img) {
        img.style.width = px + 'px';
        img.style.height = px + 'px';
        img.style.display = 'block';
        img.alt = '支付二维码';
      }
    } catch (e) {
      el.innerHTML = '<span style="font-size:11px;color:#a8322a">二维码生成失败</span>';
    }
  }

  /** 点「立即购买」 */
  async function startBuy(tierId) {
    const w = (typeof window.Payment !== 'undefined') ? window.Payment.workerUrl() : '';
    if (!w) {
      toast('购买通道还没配置（assets/payment.js 的 workerUrl 为空）');
      return;
    }

    // 必须先登录 —— 否则付款记录没有身份锚点，换设备就找不回来
    if (window.AuthUI && !window.AuthUI.isLoggedIn()) {
      toast('请先登录，这样你换设备也能看');
      window.AuthUI.open('login');
      return;
    }

    const tier = (window.Payment.tiers() || []).find((t) => t.id === tierId);
    showPayModal('<div class="pw-pay-loading">正在创建订单…</div>');

    let d;
    try {
      const r = await fetch(w, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          action: 'buy',
          tier: tierId,
          session: window.AuthUI ? window.AuthUI.session() : '',
        }),
      });
      d = await r.json();
    } catch {
      showPayModal('<div class="pw-pay-err">网络不通，无法创建订单。请稍后重试。</div>');
      return;
    }

    if (!d || !d.ok) {
      if (d && d.reason === 'need-login') {
        closePayModal();
        window.AuthUI.open('login');
        return;
      }
      showPayModal('<div class="pw-pay-err">下单失败：' +
        esc((d && d.reason) || '未知原因') + '</div>');
      return;
    }

    openPayFlow(d, tier);
  }

  /**
   * 显示支付弹层并开始轮询。内容购买和积分购买共用这一套。
   * @param {object} d     下单接口返回（outTradeNo / amount / payUrl / qrText…）
   * @param {object} tier  档位信息（只用来显示名字）
   */
  function openPayFlow(d, tier) {
    const yuan = (d.amount / 100).toFixed(0);
    const payUrl = absPayUrl(d.payUrl);
    const qr = (window.Payment && window.Payment.payQr) ? window.Payment.payQr() : {};
    const note = (window.Payment && window.Payment.payNote) ? window.Payment.payNote() : '';
    const hasQr = !!(qr.wechat || qr.alipay);

    // 个人收款码模式：显示二维码 + 「我已完成付款」
    // 支付商模式：显示支付商二维码或跳转按钮
    const qrBlock = hasQr
      ? [
        '<div class="pw-qr-tabs">',
        qr.wechat ? '<button type="button" class="pw-qr-tab is-on" data-qr="wechat">微信</button>' : '',
        qr.alipay ? '<button type="button" class="pw-qr-tab' + (qr.wechat ? '' : ' is-on') + '" data-qr="alipay">支付宝</button>' : '',
        '</div>',
        '<div class="pw-qr-show">',
        qr.wechat ? '<img class="pw-qr-img" data-qr-img="wechat" alt="微信收款码" src="' + esc(qr.wechat) + '">' : '',
        qr.alipay ? '<img class="pw-qr-img' + (qr.wechat ? ' is-off' : '') + '" data-qr-img="alipay" alt="支付宝收款码" src="' + esc(qr.alipay) + '">' : '',
        '</div>',
        '<div class="pw-qr-amt">应付 <b>￥' + esc(yuan) + '</b></div>',
        '<div class="pw-qr-ordno">订单号 <code id="pwOrdNo">' + esc(d.outTradeNo) + '</code></div>',
        '<button type="button" class="pw-qr-copy" id="pwCopyNo">复制订单号</button>',
        note ? '<div class="pw-pay-tip">' + esc(note) + '</div>' : '',
        '<button type="button" class="pw-qr-done" id="pwClaimPaid">我已完成付款</button>',
      ].join('')
      : '';

    showPayModal([
      '<div class="pw-pay-tt">' + esc((tier && tier.name) || '终身买断') + '</div>',
      '<div class="pw-pay-amt"><small>￥</small>' + esc(yuan) + '</div>',
      qrBlock,
      // 支付宝当面付返回的是二维码【内容】（字符串），不是图片，需要前端渲染
      d.qrText
        ? '<div class="pw-pay-qr" id="pwDynQr"></div>' +
          '<div class="pw-pay-tip">打开支付宝扫描上方二维码付款</div>'
        : '',
      !hasQr && d.qrCode
        ? '<div class="pw-pay-qr"><img alt="支付二维码" src="' + esc(d.qrCode) + '"></div>' +
          '<div class="pw-pay-tip">用微信或支付宝扫码支付</div>'
        : '',
      !hasQr && !d.qrText && payUrl
        ? '<a class="pw-pay-go" href="' + esc(payUrl) + '" target="_blank" rel="noopener">去支付 ￥' + esc(yuan) + ' →</a>'
        : '',
      '<div class="pw-pay-status" id="pwPayStatus">' +
        (hasQr ? '付款后点上面的按钮，我们会尽快为你开通。' : '等待支付…（付款后本页会自动解锁）') +
      '</div>',
      hasQr ? '' : '<div class="pw-pay-orderno">订单号 ' + esc(d.outTradeNo) + '</div>',
    ].join(''));

    // 动态二维码（支付宝当面付）
    if (d.qrText) {
      const holder = document.getElementById('pwDynQr');
      if (holder) renderQrInto(holder, d.qrText, 200);
    }

    // 微信 / 支付宝 切换
    if (hasQr) {
      $$('[data-qr]').forEach((btn) => {
        btn.onclick = () => {
          $$('[data-qr]').forEach((b) => b.classList.toggle('is-on', b === btn));
          $$('[data-qr-img]').forEach((img) => {
            img.classList.toggle('is-off', img.dataset.qrImg !== btn.dataset.qr);
          });
        };
      });

      const copyBtn = document.getElementById('pwCopyNo');
      if (copyBtn) {
        copyBtn.onclick = async () => {
          try {
            await navigator.clipboard.writeText(d.outTradeNo);
            copyBtn.textContent = '已复制 ✓';
            setTimeout(() => { copyBtn.textContent = '复制订单号'; }, 1800);
          } catch {
            copyBtn.textContent = '复制失败，请手抄';
          }
        };
      }

      const claimBtn = document.getElementById('pwClaimPaid');
      if (claimBtn) {
        claimBtn.onclick = async () => {
          claimBtn.disabled = true;
          claimBtn.textContent = '正在提交…';
          const st = document.getElementById('pwPayStatus');
          try {
            const r = await fetch(w, {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ action: 'claim-paid', outTradeNo: d.outTradeNo }),
            });
            const res = await r.json();
            if (res.ok) {
              claimBtn.textContent = '已提交，等待确认';
              if (st) st.textContent = '我们已收到你的付款通知，核对到账后会自动解锁（通常几分钟内）。这个页面可以留着，也可以先关掉。';
            } else {
              claimBtn.disabled = false;
              claimBtn.textContent = '我已完成付款';
              if (st) st.textContent = '提交失败：' + (res.reason || '未知原因') + '，请稍后重试。';
            }
          } catch {
            claimBtn.disabled = false;
            claimBtn.textContent = '我已完成付款';
            if (st) st.textContent = '网络不通，请稍后重试。';
          }
        };
      }
    }

    pollOrder(d.outTradeNo);
  }

  /** 轮询订单状态，付了钱就自动解锁 */
  function pollOrder(outTradeNo) {
    const w = (typeof window.Payment !== 'undefined') ? window.Payment.workerUrl() : '';
    if (!w) return;

    if (payPollTimer) clearInterval(payPollTimer);
    let tries = 0;

    payPollTimer = setInterval(async () => {
      tries++;
      if (tries > 240) {          // 12 分钟
        clearInterval(payPollTimer); payPollTimer = null;
        const s = document.getElementById('pwPayStatus');
        if (s) s.textContent = '等待超时。如果你已经付款，请联系我们并附上订单号。';
        return;
      }

      try {
        const r = await fetch(w, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ action: 'order', outTradeNo }),
        });
        const d = await r.json();
        if (!d || !d.ok) return;

        const s = document.getElementById('pwPayStatus');
        if (d.status === 'paid' && d.key) {
          clearInterval(payPollTimer); payPollTimer = null;
          if (s) s.textContent = '✓ 支付成功，正在解锁…';

          // 刷新账号状态（等级已经记到邮箱名下）
          if (window.AuthUI) await window.AuthUI.me(true);
          await sleep(600);
          closePayModal();
          toast('支付成功，已解锁');
          const art = byId(currentId);
          if (art) showArticle(art);
        } else if (d.status === 'claimed') {
          const s2 = document.getElementById('pwPayStatus');
          if (s2) s2.textContent = '付款通知已收到，正在核对到账（通常几分钟内）。';
        } else if (d.status === 'failed') {
          clearInterval(payPollTimer); payPollTimer = null;
          if (s) s.textContent = '订单已失败，请重新下单。';
        }
      } catch {
        /* 网络抖动，继续轮询 */
      }
    }, 3000);
  }

  /** 绑定购买按钮 + 关闭弹层 */
  function bindBuyButtons() {
    $$('[data-buy]').forEach((el) => {
      if (el.dataset.bound === '1') return;
      el.dataset.bound = '1';
      el.addEventListener('click', (e) => {
        e.preventDefault();
        startBuy(el.dataset.buy);
      });
    });

    const close = document.getElementById('pwPayClose');
    if (close && close.dataset.bound !== '1') {
      close.dataset.bound = '1';
      close.addEventListener('click', closePayModal);
    }
    const modal = document.getElementById('pwPayModal');
    if (modal && modal.dataset.bound !== '1') {
      modal.dataset.bound = '1';
      modal.addEventListener('click', (e) => {
        if (e.target === modal) closePayModal();
      });
    }
  }

  /** 构建付费卡 DOM（未解锁时） */
  function paywallHtml(id) {
    const card = premiumCard(id);
    const tier = (card && card.tier) || 'PREM';
    const pcfg = (typeof window.Payment !== 'undefined') ? window.Payment.config : {};
    const sample = card && card.sample;

    const sampleHtml = sample
      ? '<div class="pw-sample">' +
          '<div class="pw-sample-tt">样 例 · 付费章节节选</div>' +
          '<p class="pw-sample-quote">' + esc(sample.quote) + '</p>' +
          '<p class="pw-sample-body">' + esc(sample.body) + '</p>' +
          '<p class="pw-sample-fade">' + esc(sample.fade) + '</p>' +
        '</div>'
      : '';

    const anchorHtml = pcfg.priceAnchor
      ? '<div class="pw-price-anchor">' + esc(pcfg.priceAnchor) + '</div>'
      : '';

    return [
      '<section class="paywall" id="paywall" data-tier="' + esc(tier) + '">',
      '  <div class="pw-head">',
      '    <span class="pw-eyebrow">PREMIUM · 深度解读</span>',
      '    <h2 class="pw-title">以上的白话与爻辞是免费的。<br>下面是把它用起来的部分。</h2>',
      '    <p class="pw-sub">',
      '      免费部分回答「这一卦说了什么」；付费章节回答「我现在该怎么做」。',
      '      逐爻拆解你所处的阶段、史书中的真实印证，以及一套可自测的判断方法。',
      '    </p>',
      anchorHtml,
      '  </div>',
      '  <div class="pw-body">',
      '    ' + tiersHtml(),
      '    ' + sampleHtml,
      '    <div class="pw-buy">' + buyButtonsHtml() + '</div>',
      // 授权码入口已移除：现在用账号（Google 登录）识别买家，
      // 换设备登录即可恢复，不需要输码。
      '    <div class="pw-trust">',
      '      <div class="pw-trust-grid">',
      '        <div class="pw-trust-item is-yes">',
      '          <b>一次买断</b>',
      '          不自动续费，不收集手机号，不发营销信息。',
      '        </div>',
      '        <div class="pw-trust-item is-yes">',
      '          <b>买到的是什么</b>',
      '          一份能读完的文本。不是课程，不是社群。',
      '        </div>',
      '        <div class="pw-trust-item is-yes">',
      '          <b>后续修订免费</b>',
      '          内容持续校订，已购的版本更新不再收费。',
      '        </div>',
      '      </div>',
      '    </div>',
      '  </div>',
      '</section>',
    ].join('\n');
  }

  /**
   * 已解锁状态。
   * 注意：付费正文（depth）在构建期就【没有】写进静态产物，
   * 所以静态版本这里只能展示样例 + 说明。接入 Cloudflare Worker
   * （见 assets/paywall-worker.example.js）后，此处改为 fetch 正文即可。
   */
  /**
   * 已解锁状态。
   *
   * 付费正文【不在】静态产物里 —— 它存在服务端（Cloudflare Worker + KV），
   * 验码之后才下发。所以这里先渲染骨架，再异步把正文取回来填进去。
   *
   * 未配置 workerUrl 时（纯静态部署）显示提示，不会静默失败。
   */
  function unlockedHtml(id) {
    const card = premiumCard(id);
    const sample = card && card.sample;
    const hasWorker = typeof window.Payment !== 'undefined' && !!window.Payment.workerUrl();
    return [
      '<section class="pw-gated-body" id="s-premium-full">',
      '  <h2 id="p-full">深度解读</h2>',
      '  <div id="pwContent" data-article="' + esc(id) + '">',
      hasWorker
        ? '    <p class="load-state">正在取回正文…</p>'
        : '    <p class="load-state">付费正文由服务端下发，本站当前未配置服务端地址' +
          '（assets/payment.js 的 workerUrl 为空）。</p>',
      '  </div>',
      sample ? '  <div class="pw-sample">' +
        '<div class="pw-sample-tt">样 例 · 章节节选</div>' +
        '<p class="pw-sample-quote">' + esc(sample.quote) + '</p>' +
        '<p class="pw-sample-body">' + esc(sample.body) + '</p>' +
        '</div>' : '',
      '</section>',
      '<div class="pw-unlocked-bar">',
      '  <span class="pw-ub-mark">✓</span>',
      '  <span>已解锁 · ' + esc(Entitlement.label() || '已授权') + '</span>',
      '  <button type="button" id="pwReset">在本机清除授权</button>',
      '</div>',
    ].join('\n');
  }

  /**
   * 从服务端取回付费正文并渲染。
   * 失败时给出明确的下一步（而不是空白）。
   */
  async function loadPremiumContent(id) {
    const host = document.getElementById('pwContent');
    if (!host || host.dataset.loaded === '1') return;

    const url = (typeof window.Payment !== 'undefined') ? window.Payment.workerUrl() : '';
    const key = (window.License.all() || [])[0] || '';
    const sess = (window.AuthUI && window.AuthUI.session()) || '';

    const fail = (msg) => {
      host.innerHTML = '<p class="load-state is-error">' + esc(msg) + '</p>';
    };

    if (!url) return;                       // 未配置服务端，骨架里已有提示
    // 登录了就可以取（不依赖本机有没有码）；没登录才需要码
    if (!sess && !key) {
      return fail('请先登录后再阅读。登录一次，90 天内不用重复登录。');
    }

    try {
      const ctl = new AbortController();
      const timer = setTimeout(() => ctl.abort(), 12000);

      const r = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          action: 'unlock',
          key,
          session: sess,
          device: window.LicenseServer ? window.LicenseServer.deviceId() : '',
          ids: [id],
        }),
        signal: ctl.signal,
      });
      clearTimeout(timer);

      if (!r.ok) return fail('服务端返回 ' + r.status + '，请稍后重试。');
      const data = await r.json();

      if (!data.ok) {
        const MSG = {
          'not-purchased': '这个账号还没购买。购买后任何设备登录都能看。',
          'need-login-or-key': '请先登录。',
          used: '这台设备上的旧授权已绑定别处，请改用账号登录。',
          revoked: '这份授权已停用，如有疑问请联系我们。',
          notfound: '服务端没有这条记录，请用账号登录。',
          invalid: '授权无效，请用账号登录。',
        };
        return fail(MSG[data.reason] || '取回正文失败：' + (data.reason || '未知原因'));
      }

      const html = (data.contents || {})[id];
      if (!html) return fail('当前授权等级不包含这一篇。');

      host.innerHTML = html;
      host.dataset.loaded = '1';
    } catch {
      fail('取回正文超时或网络不通。检查网络后刷新页面即可，无需重新付费。');
    }
  }

  /**
   * 给正文装配付费墙。必须在 body.innerHTML = html 之后调用。
   * @param {object} a 文章对象
   */
  function renderPaywall(a) {
    const host = $('#artBody');
    if (!host) return;

    // 非付费文章：什么都不做（优雅降级 —— manifest 无 tier 信息时全站免费）
    if (!Entitlement.needsPaywall(a.id)) return;

    // 未解锁时，构建期写入的 teaser 由完整付费卡代替
    const gate = host.querySelector('.pw-gated');
    if (gate) gate.remove();

    // 已解锁的判定：登录且买过（主）或 本机有有效授权码（辅）
    const bought = !!(window.AuthUI && window.AuthUI.anyTier());
    const unlocked = bought || Entitlement.isUnlocked(a.id);
    const wrap = document.createElement('div');
    wrap.innerHTML = unlocked ? unlockedHtml(a.id) : paywallHtml(a.id);
    while (wrap.firstChild) host.appendChild(wrap.firstChild);

    if (unlocked) {
      const reset = $('#pwReset');
      if (reset) {
        reset.onclick = () => {
          Entitlement.reset();
          toast('已在本机清除授权');
          const art = byId(a.id);
          if (art) showArticle(art);
        };
      }
      // 付费正文不在静态产物里 —— 异步从服务端取
      loadPremiumContent(a.id);
      return;
    }

    bindPaywallForm(a);
    bindBuyButtons();
  }

  /** 绑定解锁表单 */
  function bindPaywallForm(a) {
    const form = $('#pwForm');
    const input = $('#pwInput');
    const msg = $('#pwMsg');
    if (!form || !input) return;

    // 输入时自动按 4 位分组，降低抄错概率
    input.addEventListener('input', () => {
      const raw = input.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 16);
      const groups = [];
      for (let i = 0; i < raw.length; i += 4) groups.push(raw.slice(i, i + 4));
      input.value = groups.join('-');
      input.classList.remove('is-error');
      if (msg) { msg.textContent = ''; msg.className = 'pw-msg'; }
    });

    form.addEventListener('submit', async (e) => {
      e.preventDefault();

      // 一码一机模式下要打服务端，所以是异步的；期间禁用按钮防重复提交
      const btn = form.querySelector('.pw-submit');
      if (btn) { btn.disabled = true; btn.dataset.text = btn.textContent; btn.textContent = '校验中…'; }
      if (msg) { msg.className = 'pw-msg'; msg.textContent = ''; }

      let res;
      try {
        res = await Entitlement.unlock(input.value);
      } catch {
        res = { ok: false, reason: '校验服务暂时不可用，请稍后重试。' };
      } finally {
        if (btn) { btn.disabled = false; btn.textContent = btn.dataset.text || '解锁'; }
      }

      if (!res.ok) {
        input.classList.add('is-error');
        if (msg) {
          msg.className = 'pw-msg is-error';
          msg.textContent = res.reason || '解锁失败，请检查授权码。';
        }
        return;
      }

      // 码有效但不覆盖这篇（例如乾坤专享码去开别的卦）
      if (!res.covers) {
        if (msg) {
          msg.className = 'pw-msg is-error';
          msg.textContent = '授权已生效（' + res.label + '），但该等级不包含本卦。请使用「全站通行」授权码。';
        }
        return;
      }

      if (msg) {
        msg.className = 'pw-msg is-ok';
        msg.textContent = '解锁成功 · ' + res.label;
      }
      toast('已解锁，正在载入…');
      setTimeout(() => {
        const art = byId(a.id);
        if (art) showArticle(art);
      }, 700);
    });
  }

  function buildToc() {
    const heads = $$('#artBody h2');
    const toc = $('#artToc');
    const mToc = $('#mobileToc');

    if (!heads.length) {
      toc.innerHTML = '';
      mToc.hidden = true;
      return;
    }

    const items = heads.map((h, i) => {
      if (!h.id) h.id = 'sec-' + i;
      return { id: h.id, text: h.textContent.trim() };
    });

    toc.innerHTML = '<div class="toc-tt">本页</div>' +
      items.map((it) => `<a href="#${it.id}" data-t="${it.id}">${esc(it.text)}</a>`).join('');

    toc.querySelectorAll('a').forEach((link) => {
      link.onclick = (e) => {
        e.preventDefault();
        const t = document.getElementById(link.dataset.t);
        if (t) t.scrollIntoView({ behavior: 'smooth', block: 'start' });
      };
    });

    $('#mobileTocLinks').innerHTML = items.map((it) =>
      `<a href="#${it.id}">${esc(it.text)}</a>`).join('');
    mToc.hidden = false;

    // 滚动高亮
    if (tocSpy) tocSpy.disconnect();
    const links = toc.querySelectorAll('a');
    tocSpy = new IntersectionObserver((entries) => {
      entries.forEach((en) => {
        if (en.isIntersecting) {
          links.forEach((l) => l.classList.toggle('on', l.dataset.t === en.target.id));
        }
      });
    }, { rootMargin: '-84px 0px -72% 0px', threshold: 0 });
    heads.forEach((h) => tocSpy.observe(h));
  }

  function buildNav(a) {
    const nav = $('#artNav');

    // 前置篇：按前置序列前后翻，末篇指向第 1 卦
    if (isFront(a)) {
      const fl = frontList();
      const i = fl.findIndex((x) => x.id === a.id);
      const prev = i > 0 ? fl[i - 1] : null;
      const next = i < fl.length - 1 ? fl[i + 1] : null;
      const parts = [];
      if (prev) {
        parts.push(`
          <a href="#/p/${prev.id}">
            <div class="an-dir">← 上一篇</div>
            <div class="an-tt">${esc(prev.short || prev.name)}</div>
          </a>`);
      } else {
        parts.push(`
          <a href="#/toc">
            <div class="an-dir">← 前置起点</div>
            <div class="an-tt">回到目录</div>
          </a>`);
      }
      if (next) {
        parts.push(`
          <a class="an-next" href="#/p/${next.id}">
            <div class="an-dir">下一篇 →</div>
            <div class="an-tt">${esc(next.short || next.name)}</div>
          </a>`);
      } else {
        const first = M.articles[0];
        parts.push(`
          <a class="an-next" href="#/p/${first.id}">
            <div class="an-dir">前置读完，进正文 →</div>
            <div class="an-tt">${first.symbol} 第 1 卦 · ${esc(first.name)}</div>
          </a>`);
      }
      nav.innerHTML = parts.join('');
      return;
    }

    const prev = byN(a.n - 1);
    const next = byN(a.n + 1);
    const parts = [];
    if (prev) parts.push(`
      <a href="#/p/${prev.id}">
        <div class="an-dir">← 上一卦 · 第 ${prev.n} 卦</div>
        <div class="an-tt">${prev.symbol} ${esc(prev.name)}卦 · ${esc(prev.full)}</div>
      </a>`);
    else {
      const lastFront = frontList().slice(-1)[0];
      parts.push(`
        <a href="#/p/${lastFront ? lastFront.id : '#/toc'}">
          <div class="an-dir">← 回到前置</div>
          <div class="an-tt">${lastFront ? esc(lastFront.short || lastFront.name) : '目录'}</div>
        </a>`);
    }
    if (next) parts.push(`
      <a class="an-next" href="#/p/${next.id}">
        <div class="an-dir">下一卦 · 第 ${next.n} 卦 →</div>
        <div class="an-tt">${esc(next.name)}卦 · ${esc(next.full)} ${next.symbol}</div>
      </a>`);
    else parts.push(`
      <a class="an-next" href="#/toc">
        <div class="an-dir">已是最后一卦</div>
        <div class="an-tt">回到目录 ䷀</div>
      </a>`);
    nav.innerHTML = parts.join('');
  }

  /* ---------- 卦象浮动面板 ---------- */
  function renderPetPanel(activeId) {
    const body = $('#petPanelBody');
    const allFront = frontList();

    // 前置篇（不含参考书目）与参考书目分开成组
    const fl = allFront.filter((a) => !a.isRefs);
    const refs = allFront.filter((a) => a.isRefs);

    const item = (a, glyph) => `
      <a class="pet-item${a.id === activeId ? ' on' : ''}" href="#/p/${a.id}">
        <span class="pi-glyph" aria-hidden="true">${glyph}</span>
        <span class="pi-name">${esc(a.short || a.name)}</span>
      </a>`;

    const frontHtml = fl.map((a) => item(a, '◆')).join('');

    const hexHtml = M.articles.map((a) => `
      <a class="pet-item${a.id === activeId ? ' on' : ''}" href="#/p/${a.id}">
        <span class="pi-glyph" aria-hidden="true">${a.symbol}</span>
        <span class="pi-no">${String(a.n).padStart(2, '0')}</span>
        <span class="pi-name">${esc(a.name)}<span class="pi-full">${esc(a.full)}</span></span>
      </a>`).join('');

    const refsHtml = refs.length
      ? `<div class="pet-sec">参考书目</div>${refs.map((a) => item(a, '书')).join('')}`
      : '';

    body.innerHTML = `
      <div class="pet-sec">前置篇</div>
      ${frontHtml}
      <div class="pet-sec">六十四卦</div>
      ${hexHtml}
      ${refsHtml}`;

    $('#petPanelFt').textContent =
      `前置 ${fl.length} 篇 · 六十四卦 ${M.articles.length} 卦${refs.length ? ' · 参考书目' : ''} · 点击跳转`;
  }

  /* ---------- 搜索 ---------- */
  let searchIdx = 0;
  let searchHits = [];

  async function openSearch() {
    $('#searchMask').hidden = false;
    const input = $('#searchInput');
    input.value = '';
    input.focus();
    if (!searchData) {
      $('#searchList').innerHTML = '<div class="search-empty">索引载入中…</div>';
      try { searchData = await getJSON('data/search.json'); } catch { searchData = { items: [] }; }
    }
    doSearch('');
  }
  function closeSearch() { $('#searchMask').hidden = true; }

  function doSearch(q) {
    const list = $('#searchList');
    const query = q.trim().toLowerCase();
    const items = (searchData && searchData.items) || [];

    if (!query) {
      searchHits = items.slice(0, 12);
    } else {
      searchHits = items.filter((it) =>
        (it.t || '').toLowerCase().includes(query) ||
        (it.x || '').toLowerCase().includes(query) ||
        (it.k || '').toLowerCase().includes(query)
      ).slice(0, 40);
    }
    searchIdx = 0;
    renderHits(query);
  }

  function renderHits(query) {
    const list = $('#searchList');
    if (!searchHits.length) {
      list.innerHTML = '<div class="search-empty">没有找到相关内容</div>';
      $('#searchFoot').textContent = '换个关键词试试';
      return;
    }
    list.innerHTML = searchHits.map((h, i) => {
      const snippet = hilite(truncate(h.x || '', 90), query);
      return `
        <a class="search-hit${i === searchIdx ? ' on' : ''}" href="#/p/${h.id}" data-i="${i}">
          <div class="sh-top">
            <span class="sh-glyph" aria-hidden="true">${h.s || ''}</span>
            <span class="sh-tt">${esc(h.t)}</span>
            <span class="sh-where">${esc(h.w || '')}</span>
          </div>
          <div class="sh-snippet">${snippet}</div>
        </a>`;
    }).join('');
    $('#searchFoot').textContent = `${searchHits.length} 条结果 · ↑↓ 选择 · 回车打开`;
    list.querySelectorAll('.search-hit').forEach((el) => {
      el.onclick = () => closeSearch();
    });
  }

  function truncate(s, n) { return s.length > n ? s.slice(0, n) + '…' : s; }
  function hilite(s, q) {
    const safe = esc(s);
    if (!q) return safe;
    const re = new RegExp('(' + q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ')', 'gi');
    return safe.replace(re, '<mark>$1</mark>');
  }

  function moveSearch(delta) {
    if (!searchHits.length) return;
    searchIdx = (searchIdx + delta + searchHits.length) % searchHits.length;
    $$('.search-hit').forEach((el, i) => el.classList.toggle('on', i === searchIdx));
    const el = $$('.search-hit')[searchIdx];
    if (el) el.scrollIntoView({ block: 'nearest' });
  }

  function commitSearch() {
    const hit = searchHits[searchIdx];
    if (!hit) return;
    closeSearch();
    location.hash = `#/p/${hit.id}`;
  }

  /* ---------- 路由 ---------- */
  function showCover() {
    coverView.hidden = false;
    tocView.hidden = true;
    articleView.hidden = true;
    if (standaloneView) standaloneView.hidden = true;
    topbar.hidden = true;
    readProgressEl.hidden = true;
    $('#pet').hidden = true;
    $('#petPanel').hidden = true;
    $('#fab').hidden = true;
    document.title = '周易六十四卦 · 白话全解';
  }

  function showToc() {
    coverView.hidden = true;
    tocView.hidden = false;
    articleView.hidden = true;
    topbar.hidden = false;
    readProgressEl.hidden = true;
    $('#pet').hidden = false;
    $('#fab').hidden = true;
    renderToc();
    renderPetPanel(currentId || null);
    document.title = '目录 · 周易六十四卦全解';
  }

  async function showArticleRoute(a, sec) {
    /* 免费内容不需要登录 —— 卦辞、彖传、象传、爻辞、白话、处世应用，
       以及乾坤两卦的完整深度解读，任何人直接看。

       需要登录的只有两处：
         ① 付费卦的逐爻详解（付费卡之后，登录 + 购买才由服务端下发）
         ② 处境自测（要记额度和结果）

       这样搜索来的人落地就能读，不会被登录墙弹走；
       读到付费卡再要求登录，转化路径更顺。 */

    coverView.hidden = true;
    tocView.hidden = true;
    articleView.hidden = false;
    topbar.hidden = false;
    readProgressEl.hidden = false;
    $('#pet').hidden = false;
    $('#fab').hidden = false;
    document.title = `${a.name}卦 · ${a.full} · 周易全解`;
    await showArticle(a, sec);
  }

  async function route() {
    const h = location.hash || '#/';

    if (h.startsWith('#/p/')) {
      const rest = h.slice(4);
      const [id, sec] = rest.split('/');
      const a = byId(id);
      if (a) { await showArticleRoute(a, sec); return; }
      location.hash = '#/toc';
      return;
    }
    if (h.startsWith('#/s')) {
      const tag = h.split('/')[2];
      if (tag) { await showSituTag(tag); return; }
      await showSituIndex();
      return;
    }
    if (h.startsWith('#/quiz')) { await showQuiz(); return; }
    if (h.startsWith('#/credits')) { await showCredits(); return; }
    if (h.startsWith('#/toc')) {
      showToc();
      const key = h.split('/')[2];
      if (key) {
        requestAnimationFrame(() => {
          const g = document.getElementById('group-' + key);
          if (g) g.scrollIntoView({ behavior: 'smooth', block: 'start' });
        });
      }
      return;
    }
    showCover();
  }

  /* ==========================================================================
     处境自测
     --------------------------------------------------------------------------
     流程：
       点开始 → 检查登录 → 查剩余次数 → 一题一屏 → 前端算阶段
       → 提交服务端扣次数 → 结果页（阶段 + 三条处境）

     文案纪律：对外一律叫「处境自测」，不出现「测卦 / 算命 / 预测 / 吉凶」。
     ========================================================================== */

  let quizState = null;   // { answers, step, left, track }

  function quizApi() {
    return (typeof window.Payment !== 'undefined') ? window.Payment.workerUrl() : '';
  }

  async function quizCall(payload) {
    const w = quizApi();
    if (!w) return { ok: false, reason: 'no-worker' };
    try {
      const r = await fetch(w, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ...payload, session: window.AuthUI ? window.AuthUI.session() : '' }),
      });
      return await r.json();
    } catch {
      return { ok: false, reason: 'network' };
    }
  }

  /** #/quiz —— 入口 + 答题 */
  async function showQuiz() {
    if (!window.Quiz) { toast('题库未加载'); return; }

    if (!window.AuthUI || !window.AuthUI.isLoggedIn()) {
      renderQuizGate('开始之前，需要先登录。', '登录后我们才能记住你用了几次。');
      return;
    }

    const c = await quizCall({ action: 'credits' });
    if (!c.ok && c.reason === 'need-login') { renderQuizGate('登录已过期', '请重新登录。'); return; }

    const left = c.remaining;
    if (left === 0) { renderQuizPaywall(); return; }

    // 先问「你在意哪件事」，再决定出哪套题
    quizState = { answers: {}, step: 0, left, track: '' };
    renderQuizScreen();
  }

  /** 分流题：你现在最想理清楚哪件事 */
  function renderQuizScreen() {
    const sc = window.Quiz.screen;
    const opts = sc.opts.map((o, k) =>
      '<button class="quiz-opt" data-track="' + esc(o.track) + '">' +
        '<span class="quiz-opt-k">' + 'ABCDE'[k] + '</span>' +
        '<span class="quiz-opt-t">' + esc(o.t) + '</span>' +
      '</button>'
    ).join('');

    renderStandalone([
      '<section class="situ-view quiz-view">',
      '  <div class="quiz-meta">',
      '    <span>开始之前</span>',
      '    <span></span>',
      '    <span>' + (quizState.left === -1 ? '不限次' : '还剩 ' + quizState.left + ' 次') + '</span>',
      '  </div>',
      '  <h2 class="quiz-q">' + esc(sc.q) + '</h2>',
      '  <p class="quiz-hint">后面有 12 道题，大概三分钟。</p>',
      '  <div class="quiz-opts">' + opts + '</div>',
      '</section>',
    ].join('\n'));

    $$('[data-track]').forEach((el) => {
      el.onclick = () => {
        quizState.track = el.dataset.track;
        quizState.step = 0;
        renderQuizQuestion();
      };
    });
  }

  function renderQuizGate(title, sub) {
    renderStandalone([
      '<section class="situ-view quiz-view">',
      '  <div class="situ-eyebrow">SELF-CHECK · 处境自测</div>',
      '  <h1 class="situ-h1">' + esc(title) + '</h1>',
      '  <p class="situ-lede">' + esc(sub) + '</p>',
      '  <button class="btn solid quiz-login">登录 / 注册</button>',
      '</section>',
    ].join('\n'));
    const b = document.querySelector('.quiz-login');
    if (b) b.onclick = () => window.AuthUI.open('login');
  }

  function renderQuizPaywall() {
    const packs = [
      { id: 'C3', n: 3, price: 9.9, tag: '试一下' },
      { id: 'C12', n: 12, price: 29.9, tag: '最常选', hot: true },
      { id: 'C30', n: 30, price: 59.9, tag: '反复用' },
    ];
    const cards = packs.map((p) => {
      const unit = (p.price / p.n).toFixed(2);
      return '<div class="quiz-pack' + (p.hot ? ' is-hot' : '') + '">' +
        (p.hot ? '<div class="quiz-pack-flag">最常选</div>' : '') +
        '<div class="quiz-pack-tag">' + esc(p.tag) + '</div>' +
        '<div class="quiz-pack-n">' + p.n + ' <small>次</small></div>' +
        '<div class="quiz-pack-price"><small>￥</small>' + p.price + '</div>' +
        '<div class="quiz-pack-unit">￥' + unit + ' / 次</div>' +
        '<button class="quiz-pack-buy" data-pack="' + p.id + '">买这一次</button>' +
      '</div>';
    }).join('');

    renderStandalone([
      '<section class="situ-view quiz-view">',
      '  <div class="situ-eyebrow">SELF-CHECK · 处境自测</div>',
      '  <h1 class="situ-h1">免费的三次用完了</h1>',
      '  <p class="situ-lede">' +
      '    每一次自测会问你 12 个关于现状的问题，' +
      '    然后给出你所在的阶段、三条最像你的处境，以及该做什么。' +
      '  </p>',
      '  <div class="quiz-packs">' + cards + '</div>',
      '  <div class="situ-foot"><p>' +
      '    买了六十四卦全解的，自测不限次数。' +
      '    <a href="#/p/qian">先免费读乾卦 →</a></p></div>',
      '</section>',
    ].join('\n'));

    $$('[data-pack]').forEach((el) => {
      el.onclick = () => buyCredits(el.dataset.pack);
    });
  }

  function renderQuizQuestion() {
    const Q = window.Quiz.questionsFor(quizState.track);
    const i = quizState.step;
    const q = Q[i];
    if (!q) { finishQuiz(); return; }

    const pct = Math.round((i / Q.length) * 100);
    const opts = q.opts.map((o, k) =>
      '<button class="quiz-opt" data-opt="' + k + '">' +
        '<span class="quiz-opt-k">' + 'ABCDE'[k] + '</span>' +
        '<span class="quiz-opt-t">' + esc(o.t) + '</span>' +
      '</button>'
    ).join('');

    renderStandalone([
      '<section class="situ-view quiz-view">',
      '  <div class="quiz-bar"><div class="quiz-bar-fill" style="width:' + pct + '%"></div></div>',
      '  <div class="quiz-meta">',
      '    <span>' + (i + 1) + ' / ' + Q.length + '</span>',
      '    <span>' + esc(q.cat || '') + '</span>',
      '    <span>' + (quizState.left === -1 ? '不限次' : '还剩 ' + quizState.left + ' 次') + '</span>',
      '  </div>',
      '  <h2 class="quiz-q">' + esc(q.q) + '</h2>',
      q.hint ? '<p class="quiz-hint">' + esc(q.hint) + '</p>' : '',
      '  <div class="quiz-opts">' + opts + '</div>',
      '  <div class="quiz-nav">',
      i > 0 ? '    <button class="quiz-back">← 上一题</button>' : '    <span></span>',
      '  </div>',
      '</section>',
    ].join('\n'));

    $$('[data-opt]').forEach((el) => {
      el.onclick = () => {
        quizState.answers[q.id] = Number(el.dataset.opt);
        quizState.step++;
        renderQuizQuestion();
      };
    });

    const back = document.querySelector('.quiz-back');
    if (back) back.onclick = () => { if (quizState.step > 0) { quizState.step--; renderQuizQuestion(); } };
  }

  async function finishQuiz() {
    const r = window.Quiz.score(quizState.answers, quizState.track);
    renderStandalone([
      '<section class="situ-view quiz-view">',
      '  <div class="quiz-loading">正在看你的答案…</div>',
      '</section>',
    ].join('\n'));

    const res = await quizCall({ action: 'quiz', stage: r.stage });
    if (!res.ok) {
      if (res.reason === 'no-credits') { renderQuizPaywall(); return; }
      if (res.reason === 'need-login') { renderQuizGate('登录已过期', '请重新登录。'); return; }
      toast('提交失败：' + (res.reason || '未知'));
      return;
    }

    const situ = await loadSitu();
    const picks = window.Quiz.pickSituations(res.stage, situ, 3);
    renderQuizResult(res.stage, picks, res.remaining);
  }

  function renderQuizResult(code, picks, remaining) {
    const st = window.Quiz.stageOf(code);
    if (!st) { location.hash = '#/s'; return; }

    const items = picks.map((it, i) => [
      '<article class="quiz-pick">',
      '  <div class="quiz-pick-no">' + (i + 1) + '</div>',
      '  <h3 class="quiz-pick-tt">' + esc(it.verdict) + '</h3>',
      '  <div class="quiz-pick-src">' + esc(it.gua) + '卦 · ' + esc(it.pos) + '</div>',
      '  <div class="quiz-pick-block"><span>你在哪</span><p>' + esc(it.situ) + '</p></div>',
      '  <div class="quiz-pick-block is-do"><span>该做什么</span><p>' + esc(it.rule) + '</p></div>',
      it.exc ? '<div class="quiz-pick-block is-exc"><span>什么情况下不适用</span><p>' + esc(it.exc) + '</p></div>' : '',
      '  <div class="quiz-pick-foot">',
      '    <span class="quiz-yao">' + esc(it.yao) + '</span>',
      '    <a href="#/p/' + esc(hexIdOfN(it.n)) + '">读这一卦 →</a>',
      '  </div>',
      '</article>',
    ].join('\n')).join('\n');

    renderStandalone([
      '<section class="situ-view quiz-view">',
      '  <div class="situ-eyebrow">RESULT · 你的处境</div>',
      '  <div class="quiz-stage-no">阶段 ' + esc(code.replace('P', '')) + ' / 6</div>',
      '  <h1 class="situ-h1">' + esc(st.name) + '</h1>',
      '  <p class="situ-stage-ask">「' + esc(st.ask) + '」</p>',
      '  <p class="situ-lede">' + esc(st.summary) + '</p>',
      '  <div class="quiz-advice">',
      '    <div class="quiz-advice-block"><span>这一阶段该做什么</span><p>' + esc(st.advice) + '</p></div>',
      '    <div class="quiz-advice-block is-caution"><span>但什么情况下这套不适用</span><p>' + esc(st.caution) + '</p></div>',
      '  </div>',
      '  <h2 class="quiz-sub">最像你的三条处境</h2>',
      '  <div class="quiz-picks">' + items + '</div>',
      '  <div class="quiz-share">',
      '    <div class="quiz-share-tt">把这一页带走</div>',
      '    <p class="quiz-share-sub">' +
      '      生成一张图，存下来或者发出去。图上有你所在的阶段和一条判断。' +
      '    </p>',
      '    <button class="quiz-share-btn" id="quizShareBtn">生成分享卡片</button>',
      '    <div id="quizShareOut" class="sc-host"></div>',
      '  </div>',
      '  <div class="quiz-foot">',
      '    <p>' + (remaining === -1 ? '你的自测不限次数。' : '还剩 ' + remaining + ' 次自测。') + '</p>',
      '    <p><a href="#/quiz">再测一次</a> · <a href="#/s/' + esc(code) + '">看这一阶段的全部 64 条</a> · <a href="#/toc">按卦序读</a></p>',
      '  </div>',
      '</section>',
    ].join('\n'));

    // 分享卡片
    const shareBtn = document.getElementById('quizShareBtn');
    if (shareBtn) {
      shareBtn.onclick = async () => {
        if (!window.ShareCard) { toast('分享组件未加载'); return; }
        shareBtn.disabled = true;
        shareBtn.textContent = '正在生成…';

        // 等字体就绪，否则 Canvas 会用回退字体
        try { await document.fonts.ready; } catch { /* 忽略 */ }

        const first = picks && picks[0] ? picks[0] : {};
        const cv = window.ShareCard.render({
          stage: code,
          stageName: st.name,
          ask: st.ask,
          verdict: first.verdict || '',
          gua: first.gua || '',
          pos: first.pos || '',
          advice: st.advice || '',
        }, location.origin + location.pathname);

        window.ShareCard.showIn(document.getElementById('quizShareOut'), cv);
        shareBtn.textContent = '重新生成';
        shareBtn.disabled = false;
      };
    }
  }

  /** 买积分包：复用现有下单 + 支付弹层 */
  async function buyCredits(packId) {
    const w = quizApi();
    if (!w) { toast('购买通道未配置'); return; }
    if (!window.AuthUI || !window.AuthUI.isLoggedIn()) { window.AuthUI.open('login'); return; }

    const NAME = { C3: '处境自测 · 3 次', C12: '处境自测 · 12 次', C30: '处境自测 · 30 次' };

    try {
      const r = await fetch(w, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          action: 'buy', tier: packId,
          session: window.AuthUI.session(),
        }),
      });
      const d = await r.json();
      if (!d.ok) {
        if (d.reason === 'need-login') { window.AuthUI.open('login'); return; }
        toast('下单失败：' + (d.reason || '未知'));
        return;
      }
      openPayFlow(d, { id: packId, name: NAME[packId] || '处境自测' });
    } catch {
      toast('网络不通，请稍后重试');
    }
  }

  /** #/credits —— 我的次数 + 充值 */
  async function showCredits() {
    if (!window.AuthUI || !window.AuthUI.isLoggedIn()) {
      renderQuizGate('先登录，才能看你的次数。', '登录一次，90 天内不用重复登录。');
      return;
    }
    const c = await quizCall({ action: 'credits' });
    if (!c.ok) { toast('查询失败'); return; }

    const packs = (c.packs || []).map((p) => {
      const unit = (p.price / 100 / p.count).toFixed(2);
      const hot = p.id === 'C12';
      return '<div class="quiz-pack' + (hot ? ' is-hot' : '') + '">' +
        (hot ? '<div class="quiz-pack-flag">最常选</div>' : '') +
        '<div class="quiz-pack-n">' + p.count + ' <small>次</small></div>' +
        '<div class="quiz-pack-price"><small>￥</small>' + (p.price / 100) + '</div>' +
        '<div class="quiz-pack-unit">￥' + unit + ' / 次</div>' +
        '<button class="quiz-pack-buy" data-pack="' + p.id + '">购买</button>' +
      '</div>';
    }).join('');

    renderStandalone([
      '<section class="situ-view quiz-view">',
      '  <div class="situ-eyebrow">CREDITS · 我的自测次数</div>',
      '  <h1 class="situ-h1">' +
        (c.unlimited ? '不限次数' : c.remaining + ' 次') + '</h1>',
      '  <p class="situ-lede">' + esc(c.email) + '</p>',
      c.unlimited ? '<p class="situ-lede">你已购买六十四卦全解，自测不限次数。</p>' : '',
      '  <h2 class="quiz-sub">充值</h2>',
      '  <div class="quiz-packs">' + packs + '</div>',
      '  <div class="situ-foot"><p><a href="#/quiz">去自测 →</a></p></div>',
      '</section>',
    ].join('\n'));

    $$('[data-pack]').forEach((el) => { el.onclick = () => buyCredits(el.dataset.pack); });
  }


  let SITU = null;

  async function loadSitu() {
    if (SITU) return SITU;
    try {
      SITU = await getJSON('data/situ.json');
    } catch {
      SITU = { tags: [], items: [] };
    }
    return SITU;
  }

  function situStageOf(code) {
    const s = SITU && SITU.stages ? SITU.stages.find((t) => t.code === code) : null;
    return s || null;
  }

  function situItemsOf(code) {
    const items = (SITU && SITU.items) || [];
    return items.filter((it) => it.stage === code);
  }

  /** #/s —— 六个阶段入口 */
  async function showSituIndex() {
    const s = await loadSitu();

    const cards = (s.stages || []).map((t) => {
      const n = t.count || 0;
      return '<a class="situ-card" href="#/s/' + esc(t.code) + '">' +
        '<div class="situ-card-no">' + esc(t.code.replace('P', '')) + '</div>' +
        '<div class="situ-card-tt">' + esc(t.name) + '</div>' +
        '<div class="situ-card-ask">「' + esc(t.ask) + '」</div>' +
        '<div class="situ-card-sub">' + esc(t.desc) + '</div>' +
        '<div class="situ-card-n">' + n + ' 条处境</div>' +
      '</a>';
    }).join('');

    const html = [
      '<section class="situ-view">',
      '  <div class="situ-eyebrow">SITUATIONS · 按处境查找</div>',
      '  <h1 class="situ-h1">你现在在哪个阶段？</h1>',
      '  <p class="situ-lede">' +
      '    不用先读懂卦。六十四卦的每一爻都在讲一个具体的处境——' +
      '    往下选一个最像你现在的，看你该做什么、什么情况下那条不成立。' +
      '  </p>',
      '  <div class="situ-grid situ-grid-6">' + cards + '</div>',
      '  <div class="situ-foot">',
      '    <p>' + (s.total || 0) + ' 条处境，来自六十四卦的三百八十四爻。' +
      '      六个阶段是《周易》本来的结构：初爻到上爻，就是一件事从起步到收尾的全程。</p>',
      '    <p><a href="#/toc">← 或者按卦序浏览</a></p>',
      '  </div>',
      '</section>',
    ].join('\n');

    renderStandalone(html);
  }

  /** #/s/P1 —— 某个阶段下的条目 */
  async function showSituTag(code) {
    const s = await loadSitu();
    const tag = situStageOf(code);
    if (!tag) { location.hash = '#/s'; return; }

    const items = situItemsOf(code);

    const list = items.map((it, i) => {
      const id = 'sit-' + i;
      return [
        '<article class="situ-item" id="' + id + '">',
        '  <div class="situ-item-head">',
        '    <span class="situ-item-idx">' + String(i + 1).padStart(2, '0') + '</span>',
        '    <div>',
        '      <h3 class="situ-item-tt">' + esc(it.verdict) + '</h3>',
        '      <div class="situ-item-src">' + esc(it.gua) + '卦 · ' + esc(it.pos) + '</div>',
        '    </div>',
        '  </div>',
        '  <div class="situ-block situ-block-where">',
        '    <span class="situ-label">你在哪</span>',
        '    <p>' + esc(it.situ) + '</p>',
        '  </div>',
        '  <div class="situ-block situ-block-do">',
        '    <span class="situ-label">该做什么</span>',
        '    <p>' + esc(it.rule) + '</p>',
        '  </div>',
        it.exc
          ? '  <div class="situ-block situ-block-exc">' +
            '<span class="situ-label">什么情况下不适用</span>' +
            '<p>' + esc(it.exc) + '</p></div>'
          : '',
        '  <div class="situ-item-foot">',
        '    <span class="situ-yao">' + esc(it.yao) + '</span>',
        '    <a class="situ-jump" href="#/p/' + esc(hexIdOfN(it.n)) + '">读这一卦 →</a>',
        '  </div>',
        '</article>',
      ].join('\n');
    }).join('\n');

    const html = [
      '<section class="situ-view">',
      '  <div class="situ-eyebrow"><a href="#/s">← 全部阶段</a></div>',
      '  <h1 class="situ-h1">' + esc(tag.name) + '</h1>',
      '  <p class="situ-stage-ask">「' + esc(tag.ask) + '」</p>',
      '  <p class="situ-lede">' + esc(tag.desc) + '　共 ' + items.length + ' 条。</p>',
      items.length
        ? '<div class="situ-list">' + list + '</div>'
        : '<p class="situ-lede">这一阶段暂无条目。</p>',
      '  <div class="situ-foot"><p><a href="#/s">← 换个阶段</a> · <a href="#/toc">按卦序浏览</a></p></div>',
      '</section>',
    ].join('\n');

    renderStandalone(html);
  }

  /** 卦序 n → 文章 id */
  function hexIdOfN(n) {
    const a = (M.articles || []).find((x) => x.n === n);
    return a ? a.id : 'qian';
  }

  /** 独立视图渲染（处境页用，不依赖文章视图） */
  function renderStandalone(html) {
    coverView.hidden = true;
    tocView.hidden = true;
    articleView.hidden = true;
    if (readProgressEl) readProgressEl.hidden = true;
    if (!standaloneView) return;
    standaloneView.hidden = false;
    standaloneView.innerHTML = html;
    topbar.hidden = false;
    if (articleTocEl) articleTocEl.hidden = true;
    window.scrollTo(0, 0);
  }

  /* ---------- 阅读进度 ---------- */
  function onScroll() {
    if (articleView.hidden) return;
    const doc = document.documentElement;
    const total = doc.scrollHeight - doc.clientHeight;
    const pct = total > 0 ? Math.min(100, (doc.scrollTop / total) * 100) : 0;
    readProgressEl.style.width = pct + '%';
  }

  /* ---------- 事件绑定 ---------- */
  function bind() {
    window.addEventListener('hashchange', route);
    window.addEventListener('scroll', onScroll, { passive: true });

    $('#searchBtn').onclick = openSearch;
    $('#tocBtn').onclick = () => { location.hash = '#/toc'; };

    $$('[data-act="search"]').forEach((b) => (b.onclick = (e) => { e.preventDefault(); openSearch(); }));
    $$('[data-act="toc"]').forEach((b) => (b.onclick = (e) => { e.preventDefault(); location.hash = '#/toc'; }));
    $$('[data-act="random"]').forEach((b) => (b.onclick = (e) => {
      e.preventDefault();
      const a = M.articles[Math.floor(Math.random() * M.articles.length)];
      location.hash = `#/p/${a.id}`;
    }));

    // 搜索交互
    $('#searchClose').onclick = closeSearch;
    $('#searchMask').onclick = (e) => { if (e.target.id === 'searchMask') closeSearch(); };
    let searchTimer = null;
    $('#searchInput').addEventListener('input', (e) => {
      clearTimeout(searchTimer);
      const v = e.target.value;
      searchTimer = setTimeout(() => doSearch(v), 90);
    });
    $('#searchInput').addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown') { e.preventDefault(); moveSearch(1); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); moveSearch(-1); }
      else if (e.key === 'Enter') { e.preventDefault(); commitSearch(); }
      else if (e.key === 'Escape') { closeSearch(); }
    });

    // 目录速览面板
    $('#petBtn').onclick = () => {
      const p = $('#petPanel');
      // 安全网：若面板为空（例如从封面直接进入的状态），首次打开时补渲染
      if ($('#petPanelBody').children.length === 0) renderPetPanel(currentId || null);
      p.hidden = !p.hidden;
      $('#petBubble').hidden = true;
    };
    $('#petPanelClose').onclick = () => { $('#petPanel').hidden = true; };
    $('#petPanelBody').addEventListener('click', () => { $('#petPanel').hidden = true; });

    // 浮动按钮
    $('#fabTop').onclick = () => window.scrollTo({ top: 0, behavior: 'smooth' });
    $('#fabShare').onclick = async () => {
      const url = location.href;
      try {
        await navigator.clipboard.writeText(url);
        toast('链接已复制');
      } catch {
        toast(url);
      }
    };

    // 全局快捷键
    document.addEventListener('keydown', (e) => {
      const meta = e.metaKey || e.ctrlKey;
      if (meta && e.key.toLowerCase() === 'k') { e.preventDefault(); openSearch(); }
      if (e.key === 'Escape' && !$('#searchMask').hidden) closeSearch();
    });

    // 首次提示气泡
    if (!LS.get('bubble', false)) {
      setTimeout(() => {
        const b = $('#petBubble');
        if (b && !$('#pet').hidden) {
          b.hidden = false;
          setTimeout(() => { b.hidden = true; LS.set('bubble', true); }, 4200);
        }
      }, 2600);
    }
  }

  /* ---------- 首页 banner 知识点弹窗 ----------
   * 点卡片不跳页，弹出浮层 —— 读者不丢失当前位置。
   * 内容在 assets/tickets.js，此处只负责渲染与开关。
   */
  /* 极简内联标记：**粗体** → <strong>。先转义再替换，避免注入。 */
  function inline(s) {
    return esc(s).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  }

  function initTickets() {
    const mask = document.getElementById('ticketMask');
    const body = document.getElementById('tmBody');
    const closeBtn = document.getElementById('tmClose');
    if (!mask || !body || typeof window.TICKETS === 'undefined') return;

    let lastFocus = null;

    function render(key) {
      const t = window.TICKETS[key];
      if (!t) return false;
      const paras = (t.body || []).map((p) => `<p>${inline(p)}</p>`).join('');
      const points = (t.points || []).map(([k, v]) =>
        `<div class="tm-row"><dt>${esc(k)}</dt><dd>${inline(v)}</dd></div>`).join('');
      const cta = t.cta ? `<a class="tm-btn" href="${t.cta.href}" data-close>${esc(t.cta.label)}</a>` : '';
      const cta2 = t.cta2 ? `<a class="tm-btn ghost" href="${t.cta2.href}" data-close>${esc(t.cta2.label)}</a>` : '';

      body.innerHTML = `
        <div class="tm-label">${esc(t.label)}</div>
        <h2 class="tm-title" id="tmTitle">${esc(t.title)}</h2>
        <blockquote class="tm-quote">
          「${esc(t.quote)}」
          ${t.quoteNote ? `<cite>${esc(t.quoteNote)}</cite>` : ''}
        </blockquote>
        <div class="tm-text">${paras}</div>
        ${points ? `<dl class="tm-points">${points}</dl>` : ''}
        ${t.why ? `<p class="tm-why">${inline(t.why)}</p>` : ''}
        <div class="tm-cta">${cta}${cta2}</div>`;
      return true;
    }

    function open(key) {
      if (!render(key)) return;
      lastFocus = document.activeElement;
      mask.hidden = false;
      requestAnimationFrame(() => mask.classList.add('on'));
      closeBtn.focus();
      document.body.style.overflow = 'hidden';
    }

    function close() {
      mask.classList.remove('on');
      document.body.style.overflow = '';
      setTimeout(() => { mask.hidden = true; }, 180);
      if (lastFocus && lastFocus.focus) lastFocus.focus();
    }

    $$('.ticket').forEach((el) => {
      el.addEventListener('click', () => open(el.dataset.ticket));
    });
    closeBtn.addEventListener('click', close);
    mask.addEventListener('click', (e) => { if (e.target === mask) close(); });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !mask.hidden) close();
    });
    // 弹窗内的跳转链接：先关窗，再让路由正常跳
    body.addEventListener('click', (e) => {
      if (e.target.closest('[data-close]')) close();
    });
  }

  /* ---------- 顶部账号入口 ---------- */
  function renderAccountBtn() {
    // 两个位置：正文页顶栏 + 封面页右上角
    const hosts = [$('#acctSlot'), $('#acctSlotHero')].filter(Boolean);
    if (!hosts.length) return;

    const logged = window.AuthUI && window.AuthUI.isLoggedIn();
    const cached = window.AuthUI && window.AuthUI.cached;
    const bought = !!(cached && cached.tiers && cached.tiers.length);

    const html = logged
      ? '<button class="acct-btn is-in" data-acct="menu"><span>' +
        esc(bought ? '已购 · 我的' : '我的') + '</span></button>'
      : '<button class="acct-btn" data-acct="login">登录</button>';

    hosts.forEach((host) => {
      host.innerHTML = html;
      const btn = host.querySelector('[data-acct]');
      if (!btn) return;
      btn.onclick = () => {
        if (btn.dataset.acct === 'login') { window.AuthUI.open('login'); return; }
        openAccountMenu();
      };
    });
  }

  function openAccountMenu() {
    if (!window.AuthUI) return;

    const cached = window.AuthUI.cached || {};
    const email = window.AuthUI.email() || '';
    const tiers = cached.tiers || [];
    const tierText = tiers.length
      ? tiers.map((t) => t === 'FULL' ? '全站通行' : t === 'PREM' ? '六十四卦' : t).join(' · ')
      : '还没购买';

    window.AuthUI.panel([
      '<div class="auth-tt">我的账号</div>',
      '<p class="auth-sub">' + esc(email) + '<br>已购：<b>' + esc(tierText) + '</b></p>',
      tiers.length
        ? '<p class="auth-sub" style="font-size:12.5px">换设备或换浏览器，用这个邮箱登录就能继续看。</p>'
        : '<p class="auth-sub" style="font-size:12.5px">买过之后，任何设备登录都能看。</p>',
      '<button class="auth-btn ghost" id="acctLogout">退出登录</button>',
    ].join(''));

    const lo = document.getElementById('acctLogout');
    if (lo) {
      lo.onclick = () => {
        // 先关弹层并清本地状态，再异步通知服务端 ——
        // 不等网络，用户点完立刻就该看到已退出。
        window.AuthUI.close();
        window.AuthUI.logout().catch(() => {});
        toast('已退出登录');
      };
    }
  }

  /* ---------- 启动 ---------- */
  async function boot() {
    try {
      M = await getJSON('data/manifest.json');
    } catch (e) {
      document.body.innerHTML = '<p style="padding:40px;font-family:sans-serif">目录载入失败，请通过本地服务器访问本站（file:// 协议下浏览器会阻止读取 data/）。</p>';
      return;
    }

    // 处理 Google 回调（URL 里带 ?auth=...）
    if (window.AuthUI) window.AuthUI.handleCallback();

    renderCover();
    renderHeroSample();
    bind();
    initTickets();
    renderAccountBtn();

    // 拉一次登录状态（有 session 才发请求）
    if (window.AuthUI && window.AuthUI.isLoggedIn()) {
      window.AuthUI.me(true).then(() => {
        renderAccountBtn();
        // 登录状态可能改变付费卡形态，重渲染当前页
        const a = currentId ? byId(currentId) : null;
        if (a) showArticle(a);
      }).catch(() => {});
    }

    // 登录 / 登出后刷新
    window.addEventListener('zhouyi:auth', () => {
      renderAccountBtn();
      const a = currentId ? byId(currentId) : null;
      if (a) showArticle(a);
    });

    await route();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();







