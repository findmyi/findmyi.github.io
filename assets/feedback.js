/* ==========================================================================
   用户反馈窗口
   --------------------------------------------------------------------------
   框架对齐生财「共创反馈」：
     类型  建议 / 问题 / 内容
     状态  待评估 → 处理中 → 已解决 / 暂不处理
     形态  公开列表（反馈墙）+ 提交 + 详情评论 + 官方回复

   为什么要有这扇窗：
     产品评审写了「没有社会证明 / 任何一条用户反馈」——
     没有反馈回路，优化只能靠猜。

   对外语案纪律：不出现「测卦 / 算命 / 预测 / 吉凶」。
   ========================================================================== */
(function (global) {
  'use strict';

  const TYPES = {
    idea: { label: '建议', desc: '希望多点什么、改点什么' },
    bug: { label: '问题', desc: '打不开、算不对、付款卡住' },
    content: { label: '内容', desc: '解读有偏、史料有误、错别字' },
  };
  const TYPE_ORDER = ['idea', 'bug', 'content'];

  const STATUS = {
    0: { label: '待评估', cls: 'st-open' },
    1: { label: '处理中', cls: 'st-wip' },
    2: { label: '已解决', cls: 'st-done' },
    3: { label: '暂不处理', cls: 'st-hold' },
  };

  function workerUrl() {
    return (global.Payment && global.Payment.workerUrl()) || '';
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));
  }

  async function api(payload) {
    const w = workerUrl();
    if (!w) return { ok: false, reason: 'no-worker' };
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 12000);
      const r = await fetch(w, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
        signal: ctrl.signal,
      });
      clearTimeout(timer);
      return await r.json();
    } catch (e) {
      return { ok: false, reason: e && e.name === 'AbortError' ? 'timeout' : 'network' };
    }
  }

  /* ---------------- 页面状态 ---------------- */
  let wall = { type: '', status: '', page: 1 };
  let ctx = { from: '', label: '' };   // 提交来源（文章 / 自测 / 其它）

  function setContext(next) {
    ctx = {
      from: String((next && next.from) || ''),
      label: String((next && next.label) || ''),
    };
  }

  /* ---------------- HTML 片段 ---------------- */

  function typeChips(active) {
    return TYPE_ORDER.map((k) => {
      const t = TYPES[k];
      const on = active === k ? ' is-on' : '';
      return '<button type="button" class="fb-chip' + on + '" data-fb-type="' + k + '">' +
        esc(t.label) + '</button>';
    }).join('');
  }

  function statusBadge(st) {
    const s = STATUS[st] || STATUS[0];
    return '<span class="fb-badge ' + s.cls + '">' + esc(s.label) + '</span>';
  }

  function itemCard(it) {
    const t = TYPES[it.type] || TYPES.idea;
    return [
      '<article class="fb-card" data-fb-id="' + esc(String(it.id)) + '">',
      '  <div class="fb-card-top">',
      '    <span class="fb-type">' + esc(t.label) + '</span>',
      statusBadge(it.status),
      '    <span class="fb-time">' + esc(fmtTime(it.updatedAt || it.createdAt)) + '</span>',
      '  </div>',
      '  <h3 class="fb-card-tt">' + esc(it.title) + '</h3>',
      '  <p class="fb-card-ex">' + esc(snip(it.body, 90)) + '</p>',
      '  <div class="fb-card-ft">',
      '    <span class="fb-count">' + ((it.commentsTotal || 0) ? it.commentsTotal + ' 条跟进' : '暂无跟进') + '</span>',
      '    <span class="fb-open">查看详情 →</span>',
      '  </div>',
      '</article>',
    ].join('');
  }

  function snip(s, n) {
    const t = String(s || '').replace(/\s+/g, ' ').trim();
    return t.length > n ? t.slice(0, n) + '…' : t;
  }

  function fmtTime(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return String(iso);
    const p = (x) => String(x).padStart(2, '0');
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
  }

  /* ---------------- 反馈墙 ---------------- */

  async function showWall(render) {
    const list = await api({
      action: 'feedback.list',
      type: wall.type || undefined,
      status: wall.status === '' ? undefined : Number(wall.status),
      page: wall.page,
      pageSize: 20,
    });

    const items = (list && list.items) || [];
    const cards = items.length
      ? items.map(itemCard).join('\n')
      : '<div class="fb-empty">还没有反馈。第一条写点真的，作者会看。</div>';

    const ctxLine = ctx.label
      ? '<p class="fb-from">提交时会带上：' + esc(ctx.label) + '</p>'
      : '';

    render([
      '<section class="situ-view quiz-view fb-view">',
      '  <div class="situ-eyebrow">FEEDBACK · 反馈</div>',
      '  <h1 class="situ-h1">这扇窗一直开着</h1>',
      '  <p class="situ-lede">哪里不对、该改什么、想多看什么——直接写。' +
        '每条都会标状态，改完了你会在这里看到。</p>',
      '  <div class="fb-bar">',
      '    <div class="fb-chips">' + typeChips(wall.type) + '</div>',
      '    <button type="button" class="fb-write" id="fbWrite">写一条反馈</button>',
      '  </div>',
      ctxLine,
      '  <div class="fb-list" id="fbList">' + cards + '</div>',
      '  <div class="fb-pager" id="fbPager">',
      wall.page > 1 ? '<button type="button" class="fb-page-btn" data-fb-page="' + (wall.page - 1) + '">← 上一页</button>' : '',
      '    <span class="fb-page-no">第 ' + wall.page + ' 页</span>',
      (list && list.hasMore) ? '<button type="button" class="fb-page-btn" data-fb-page="' + (wall.page + 1) + '">下一页 →</button>' : '',
      '  </div>',
      '</section>',
    ].join('\n'));

    bindWall();
  }

  function bindWall() {
    document.querySelectorAll('[data-fb-type]').forEach((el) => {
      el.onclick = () => {
        const t = el.dataset.fbType;
        wall.type = wall.type === t ? '' : t;
        wall.page = 1;
        if (global.FeedbackRerender) global.FeedbackRerender();
      };
    });
    document.querySelectorAll('[data-fb-page]').forEach((el) => {
      el.onclick = () => {
        wall.page = Number(el.dataset.fbPage) || 1;
        if (global.FeedbackRerender) global.FeedbackRerender();
      };
    });
    document.querySelectorAll('[data-fb-id]').forEach((el) => {
      el.onclick = () => {
        location.hash = '#/feedback/' + el.dataset.fbId;
      };
    });
    const w = document.getElementById('fbWrite');
    if (w) w.onclick = () => openCompose();
  }

  /* ---------------- 提交 ---------------- */

  function openCompose() {
    const host = document.getElementById('fbCompose');
    if (host) { host.hidden = false; return; }

    const box = document.createElement('div');
    box.id = 'fbCompose';
    box.className = 'fb-compose';
    box.innerHTML = [
      '<div class="fb-compose-box">',
      '  <div class="fb-compose-hd">',
      '    <strong>写一条反馈</strong>',
      '    <button type="button" class="fb-compose-x" id="fbComposeX" aria-label="关闭">×</button>',
      '  </div>',
      '  <div class="fb-compose-type">' +
        TYPE_ORDER.map((k, i) =>
          '<label class="fb-radio"><input type="radio" name="fbType" value="' + k + '"' +
          (i === 0 ? ' checked' : '') + '><span>' + esc(TYPES[k].label) + '</span></label>'
        ).join('') +
      '  </div>',
      '  <input class="fb-input" id="fbTitle" maxlength="80" placeholder="一句话说清是什么事">',
      '  <textarea class="fb-textarea" id="fbBody" maxlength="2000" rows="6" ' +
        'placeholder="具体一点更好用：在哪个页面、你做了什么、你期望看到什么。"></textarea>',
      '  <input class="fb-input" id="fbContact" maxlength="80" placeholder="联系方式（可选，方便回复你）">',
      ctx.label ? '<p class="fb-from">将带上来源：' + esc(ctx.label) + '</p>' : '',
      '  <div class="fb-msg" id="fbMsg"></div>',
      '  <button type="button" class="fb-submit" id="fbSubmit">提交</button>',
      '</div>',
    ].join('');
    document.body.appendChild(box);

    const close = () => { box.remove(); };
    document.getElementById('fbComposeX').onclick = close;
    box.addEventListener('click', (e) => { if (e.target === box) close(); });

    document.getElementById('fbSubmit').onclick = async () => {
      const title = (document.getElementById('fbTitle').value || '').trim();
      const body = (document.getElementById('fbBody').value || '').trim();
      const contact = (document.getElementById('fbContact').value || '').trim();
      const type = (box.querySelector('input[name="fbType"]:checked') || {}).value || 'idea';
      const msg = document.getElementById('fbMsg');

      if (!title) { msg.textContent = '标题写一句就行'; msg.className = 'fb-msg is-err'; return; }
      if (!body || body.length < 8) { msg.textContent = '正文再具体一点（至少 8 个字）'; msg.className = 'fb-msg is-err'; return; }

      const btn = document.getElementById('fbSubmit');
      btn.disabled = true;
      btn.textContent = '提交中…';
      msg.textContent = '';

      const r = await api({
        action: 'feedback.create',
        type, title, body, contact,
        from: ctx.from,
        label: ctx.label,
      });

      if (!r.ok) {
        btn.disabled = false;
        btn.textContent = '提交';
        msg.textContent = r.reason === 'rate' ? '提交太频繁，过一会儿再来'
          : (r.reason || '提交失败，稍后再试');
        msg.className = 'fb-msg is-err';
        return;
      }

      close();
      if (global.toast) global.toast('已收到，状态会在反馈页更新');
      location.hash = '#/feedback/' + r.id;
    };
  }

  /* ---------------- 详情 ---------------- */

  async function showDetail(id, render) {
    const d = await api({ action: 'feedback.get', id: Number(id) });
    if (!d || !d.ok || !d.item) {
      render([
        '<section class="situ-view quiz-view fb-view">',
        '  <h1 class="situ-h1">找不到这条反馈</h1>',
        '  <p class="situ-lede"><a href="#/feedback">← 回反馈墙</a></p>',
        '</section>',
      ].join('\n'));
      return;
    }

    const it = d.item;
    const t = TYPES[it.type] || TYPES.idea;
    const comments = (it.comments || []).map((c) => [
      '<div class="fb-cmt' + (c.authorType === 1 ? ' is-official' : '') + '">',
      '  <div class="fb-cmt-hd">',
      '    <span class="fb-cmt-who">' + (c.authorType === 1 ? '作者' : '读者') + '</span>',
      '    <span class="fb-cmt-time">' + esc(fmtTime(c.createdAt)) + '</span>',
      '  </div>',
      '  <p class="fb-cmt-body">' + esc(c.body) + '</p>',
      '</div>',
    ].join('\n')).join('\n') || '<div class="fb-empty">还没有跟进。</div>';

    render([
      '<section class="situ-view quiz-view fb-view">',
      '  <div class="situ-eyebrow">FEEDBACK · #' + esc(String(it.id)) + '</div>',
      '  <div class="fb-detail-top">',
      '    <span class="fb-type">' + esc(t.label) + '</span>',
      statusBadge(it.status),
      '    <span class="fb-time">' + esc(fmtTime(it.createdAt)) + '</span>',
      '  </div>',
      '  <h1 class="situ-h1">' + esc(it.title) + '</h1>',
      it.label ? '<p class="fb-from">来源：' + esc(it.label) + '</p>' : '',
      '  <div class="fb-body"><p>' + esc(it.body).replace(/\n/g, '<br>') + '</p></div>',
      '  <h2 class="quiz-sub">跟进</h2>',
      '  <div class="fb-cmts">' + comments + '</div>',
      '  <div class="fb-reply">',
      '    <textarea class="fb-textarea" id="fbReplyBody" rows="3" maxlength="1000" ' +
        'placeholder="补充说明，或回答作者的追问"></textarea>',
      '    <div class="fb-msg" id="fbReplyMsg"></div>',
      '    <button type="button" class="fb-submit" id="fbReplyBtn">发一条跟进</button>',
      '  </div>',
      '  <div class="fb-foot"><a href="#/feedback">← 回反馈墙</a></div>',
      '</section>',
    ].join('\n'));

    const btn = document.getElementById('fbReplyBtn');
    if (btn) {
      btn.onclick = async () => {
        const body = (document.getElementById('fbReplyBody').value || '').trim();
        const msg = document.getElementById('fbReplyMsg');
        if (!body) { msg.textContent = '写点内容'; msg.className = 'fb-msg is-err'; return; }
        btn.disabled = true;
        const r = await api({ action: 'feedback.comment', id: Number(id), body });
        if (!r.ok) {
          btn.disabled = false;
          msg.textContent = r.reason === 'rate' ? '发太快了，歇一下' : (r.reason || '发送失败');
          msg.className = 'fb-msg is-err';
          return;
        }
        if (global.toast) global.toast('已记下');
        showDetail(id, render);
      };
    }
  }

  /* ---------------- 对外 ---------------- */

  global.Feedback = {
    TYPES, STATUS,
    setContext,
    showWall,
    showDetail,
    openCompose,
    api,
  };
})(typeof window !== 'undefined' ? window : globalThis);
