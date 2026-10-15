/* ==========================================================================
   周易六十四卦 · 应用逻辑
   三视图 hash 路由：#/ 封面 · #/toc 目录 · #/p/{id} 正文
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

  /* ---------- 主题 ---------- */
  function initTheme() {
    const saved = LS.get('theme', null);
    const prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
    const theme = saved || (prefersDark ? 'dark' : 'light');
    document.documentElement.setAttribute('data-theme', theme);
  }
  function toggleTheme() {
    const cur = document.documentElement.getAttribute('data-theme');
    const next = cur === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    LS.set('theme', next);
    toast(next === 'dark' ? '已切换到夜间' : '已切换到日间');
  }

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

  /* ---------- 目录渲染 ---------- */
  function renderToc() {
    $('#tocCount').textContent = M.meta.total;
    const ft = M.meta.frontTotal || 0;
    $('.tocv-title').textContent = `先读前置 ${ft} 篇，再览六十四卦`;

    $('#tocViewBody').innerHTML = M.meta.groups.map((g, gi) => {
      const isFrontGroup = !!g.isFront;
      const list = isFrontGroup
        ? (M.front || []).filter((a) => a.group === g.key)
        : M.articles.filter((a) => a.group === g.key);
      const unit = isFrontGroup ? '篇' : '卦';

      return `
      <section class="tocv-group${isFrontGroup ? ' toc-front' : ''}" id="group-${g.key}">
        <div class="tocv-ghead">
          <span class="tocv-gno">${String(gi + 1).padStart(2, '0')}</span>
          <span class="tocv-gname">${esc(g.name)}</span>
          <span class="tocv-gsub">${esc(g.sub)}</span>
          <span class="tocv-gcnt">${list.length} ${unit}</span>
        </div>
        <div class="tocv-list${isFrontGroup ? ' is-front' : ''}">
          ${list.map((a, i) => `
            <a class="tocv-item" href="#/p/${a.id}">
              <span class="tocv-glyph" aria-hidden="true">${isFrontGroup ? '◆' : a.symbol}</span>
              <span class="tocv-no">${String(a.seq || a.n).padStart(2, '0')}</span>
              <span class="tocv-name">${esc(isFrontGroup ? a.short || a.name : a.name)}</span>
              <span class="tocv-meta">${esc(isFrontGroup ? `约 ${a.mins} 分钟` : a.full)}</span>
            </a>`).join('')}
        </div>
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

    buildToc();
    buildNav(a);
    renderPetPanel(a.id);
    window.scrollTo({ top: 0, behavior: 'auto' });

    if (sec) {
      const target = document.getElementById(sec);
      if (target) requestAnimationFrame(() => target.scrollIntoView({ behavior: 'smooth', block: 'start' }));
    }
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
    const fl = frontList();

    const frontHtml = fl.map((a) => `
      <a class="pet-item${a.id === activeId ? ' on' : ''}" href="#/p/${a.id}">
        <span class="pi-glyph" aria-hidden="true">◆</span>
        <span class="pi-name">${esc(a.short || a.name)}</span>
      </a>`).join('');

    const hexHtml = M.articles.map((a) => `
      <a class="pet-item${a.id === activeId ? ' on' : ''}" href="#/p/${a.id}">
        <span class="pi-glyph" aria-hidden="true">${a.symbol}</span>
        <span class="pi-no">${String(a.n).padStart(2, '0')}</span>
        <span class="pi-name">${esc(a.name)}<span class="pi-full">${esc(a.full)}</span></span>
      </a>`).join('');

    body.innerHTML = `
      <div class="pet-sec">前置篇</div>
      ${frontHtml}
      <div class="pet-sec">六十四卦</div>
      ${hexHtml}`;

    $('#petPanelFt').textContent = `前置 ${fl.length} 篇 · 六十四卦 · 点击跳转`;
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
    $('#themeBtn').onclick = toggleTheme;

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

  /* ---------- 启动 ---------- */
  async function boot() {
    initTheme();
    try {
      M = await getJSON('data/manifest.json');
    } catch (e) {
      document.body.innerHTML = '<p style="padding:40px;font-family:sans-serif">目录载入失败，请通过本地服务器访问本站（file:// 协议下浏览器会阻止读取 data/）。</p>';
      return;
    }
    renderCover();
    bind();
    await route();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
