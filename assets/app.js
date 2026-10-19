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
  function renderCover() {
    const total = M.meta.total;

    // 顶栏计数
    $('#tocCount').textContent = total;

    // 滚动字幕：卦名序列
    const names = M.articles.map((a) => `䷀ ${a.name}　${a.full}`);
    const track = $('#marqueeTrack');
    track.innerHTML = names.concat(names).map((t) => `<span>${esc(t.replace('䷀ ', ''))}</span>`).join('');

    // 统计
    const totalYao = M.articles.reduce((s, a) => s + (a.yaoCount || 0), 0);
    $('#heroStats').innerHTML = [
      `${total} 卦`,
      `${totalYao} 爻`,
      '上经三十 · 下经三十四',
      '卦辞 · 彖传 · 象传 · 爻辞',
    ].map((t) => `<span>${esc(t)}</span>`).join('');

    // 继续阅读
    const last = LS.get('last', null);
    if (last && byId(last)) {
      const a = byId(last);
      $('#continueTitle').textContent = isFront(a) ? (a.short || a.name) : a.name + '卦';
      const link = $('#continueLink');
      link.href = `#/p/${a.id}`;
      link.hidden = false;
    }

    // 阅读路径（贴近前置篇的真实入口）
    const paths = [
      { glyph: '◆', tt: '我完全没接触过《周易》', sub: '从卷首三篇开始——建立正确认知，约 11 分钟', to: '#/p/preface' },
      { glyph: '◆', tt: '我想知道卦象怎么看', sub: '基础篇：阴阳、八卦、爻位、成卦原理', to: '#/p/basics-yinyang' },
      { glyph: '◆', tt: '我关心它准不准、能不能算命', sub: '「占卜与决策」——全书最重要的一篇', to: '#/p/method-divination' },
      { glyph: '◆', tt: '我想直接按处境查卦', sub: '「索引与检索」——按进退、顺逆、人际分类', to: '#/p/method-index' },
      { glyph: '◆', tt: '我想知道该从哪一卦读起', sub: '「本书怎么用」——三种读法与一个原则', to: '#/p/howto' },
      { glyph: '䷀', tt: '我已经懂了，直接看卦', sub: '进入六十四卦——上经三十、下经三十四', to: '#/toc' },
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
      return '<div class="pw-msg">购买渠道尚未开放。若你已购买，可直接在下方输入授权码；' +
        '否则请稍后再来。</div>';
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

    const yuan = (d.amount / 100).toFixed(0);
    const payUrl = absPayUrl(d.payUrl);

    showPayModal([
      '<div class="pw-pay-tt">' + esc((tier && tier.name) || '终身买断') + '</div>',
      '<div class="pw-pay-amt"><small>￥</small>' + esc(yuan) + '</div>',
      d.qrCode
        ? '<div class="pw-pay-qr"><img alt="支付二维码" src="' + esc(d.qrCode) + '"></div>' +
          '<div class="pw-pay-tip">用微信或支付宝扫码支付</div>'
        : '',
      payUrl
        ? '<a class="pw-pay-go" href="' + esc(payUrl) + '" target="_blank" rel="noopener">去支付 ￥' + esc(yuan) + ' →</a>'
        : '',
      '<div class="pw-pay-status" id="pwPayStatus">等待支付…（付款后本页会自动解锁）</div>',
      '<div class="pw-pay-orderno">订单号 ' + esc(d.outTradeNo) + '</div>',
    ].join(''));

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
      '    <div class="pw-unlock" id="pwUnlock">',
      '      <div class="pw-unlock-tt">已经购买了？输入授权码解锁</div>',
      '      <div class="pw-unlock-note">',
      '        授权码形如 <code>ZY-PREM-XXXX-XXXX-X</code>，在你下单后由平台自动发送。',
      '        输入一次即可，之后本机浏览器会记住。',
      '      </div>',
      '      <form class="pw-unlock-row" id="pwForm" autocomplete="off">',
      '        <input class="pw-input" id="pwInput" type="text"',
      '               placeholder="ZY-PREM-XXXX-XXXX-X" aria-label="授权码"',
      '               spellcheck="false" autocapitalize="characters">',
      '        <button class="pw-submit" type="submit">解锁</button>',
      '      </form>',
      '      <div class="pw-msg" id="pwMsg" role="status"></div>',
      '    </div>',
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
      return fail('请先登录，或输入你购买时收到的授权码。');
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
          used: '这个授权码已绑定到另一台设备。请改用登录方式，或联系我们换机。',
          revoked: '这个授权码已停用。',
          notfound: '服务端查不到这个授权码。',
          invalid: '授权码无效。',
          'not-purchased': '这个账号还没购买。购买后任何设备登录都能看。',
          'need-login-or-key': '请先登录，或输入授权码。',
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
    const host = $('#acctSlot');
    if (!host) return;

    const logged = window.AuthUI && window.AuthUI.isLoggedIn();
    const cached = window.AuthUI && window.AuthUI.cached;
    const bought = !!(cached && cached.tiers && cached.tiers.length);

    if (!logged) {
      host.innerHTML = '<button class="acct-btn" data-acct="login">登录</button>';
    } else {
      const label = bought ? '已购 · 我的' : '我的';
      host.innerHTML = '<button class="acct-btn is-in" data-acct="menu">' +
        '<span>' + esc(label) + '</span></button>';
    }

    const btn = host.querySelector('[data-acct]');
    if (!btn) return;
    btn.onclick = () => {
      if (btn.dataset.acct === 'login') { window.AuthUI.open('login'); return; }
      openAccountMenu();
    };
  }

  function openAccountMenu() {
    const cached = (window.AuthUI && window.AuthUI.cached) || {};
    const email = (window.AuthUI && window.AuthUI.email()) || '';
    const tiers = (cached.tiers || []);
    const tierText = tiers.length
      ? tiers.map((t) => t === 'FULL' ? '全站通行' : t === 'PREM' ? '六十四卦' : t).join(' · ')
      : '还没购买';

    const m = document.getElementById('authModal');
    if (!m) return;
    const body = document.getElementById('authBody');
    if (!body) return;
    body.innerHTML = [
      '<div class="auth-tt">我的账号</div>',
      '<p class="auth-sub">' + esc(email) + '<br>已购：<b>' + esc(tierText) + '</b></p>',
      tiers.length ? '' : '<p class="auth-sub">买过之后，任何设备登录都能看。</p>',
      '<button class="auth-btn ghost" id="acctLogout">退出登录</button>',
    ].join('');
    m.hidden = false;
    requestAnimationFrame(() => m.classList.add('on'));

    const lo = document.getElementById('acctLogout');
    if (lo) lo.onclick = async () => {
      await window.AuthUI.logout();
      window.AuthUI.close();
    };
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







