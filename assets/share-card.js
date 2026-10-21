/* ==========================================================================
   分享卡片 · Canvas 生成
   --------------------------------------------------------------------------
   为什么需要它：
     MBTI / 塔罗 / 星座的传播全靠这一个动作 ——
     测完 → 存一张图 → 发朋友圈 → 朋友看到 → 也想测。
     没有这张卡，自测只能自娱自乐。

   设计约束：
     · 1080 × 1440（3:4）—— 朋友圈、小红书、微信聊天窗口都不裁
     · 白纸底 + 宋体 + 朱砂红，和网站同一套视觉
     · 必须带二维码 —— 卡片被转发后，别人扫得进来
     · 不依赖任何服务端，纯前端画

   用法：
     ShareCard.render({ stage, stageName, ask, verdict, gua, pos }, url) → canvas
     ShareCard.download(canvas, filename)
   ========================================================================== */

(function (global) {
  'use strict';

  const W = 1080;
  const H = 1440;

  const C = {
    paper: '#fbf8f1',
    ink: '#1c1a17',
    ink2: '#44403a',
    ink3: '#6b645a',
    ink4: '#9a938a',
    red: '#a8322a',
    line: '#e8e2d8',
    line2: '#d9d2c6',
  };

  const SERIF = '"Songti SC","Source Han Serif SC","Noto Serif CJK SC",Georgia,serif';

  /** 手动换行：Canvas 不自动折行 */
  function wrapText(ctx, text, maxWidth) {
    const lines = [];
    let cur = '';
    for (const ch of String(text)) {
      const test = cur + ch;
      if (ctx.measureText(test).width > maxWidth && cur) {
        lines.push(cur);
        cur = ch;
      } else {
        cur = test;
      }
    }
    if (cur) lines.push(cur);
    return lines;
  }

  function drawLines(ctx, lines, x, y, lineHeight) {
    lines.forEach((l, i) => ctx.fillText(l, x, y + i * lineHeight));
    return y + (lines.length - 1) * lineHeight;
  }

  /** 画二维码 */
  function drawQr(ctx, text, x, y, size) {
    if (typeof qrcode === 'undefined') return false;
    try {
      const qr = qrcode(0, 'M');
      qr.addData(text);
      qr.make();
      const n = qr.getModuleCount();
      // 白底
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(x - 12, y - 12, size + 24, size + 24);
      // 模块
      const cell = size / n;
      ctx.fillStyle = C.ink;
      for (let r = 0; r < n; r++) {
        for (let c = 0; c < n; c++) {
          if (qr.isDark(r, c)) {
            ctx.fillRect(x + c * cell, y + r * cell, Math.ceil(cell), Math.ceil(cell));
          }
        }
      }
      return true;
    } catch (e) {
      return false;
    }
  }

  /**
   * 生成卡片。
   * @param {object} d  { stage, stageName, ask, verdict, gua, pos }
   * @param {string} url 二维码指向的网址
   * @returns {HTMLCanvasElement}
   */
  function render(d, url) {
    const cv = document.createElement('canvas');
    // 2x 渲染，导出更清晰
    const scale = 2;
    cv.width = W * scale;
    cv.height = H * scale;
    const ctx = cv.getContext('2d');
    ctx.scale(scale, scale);

    /* ---- 底 ---- */
    ctx.fillStyle = C.paper;
    ctx.fillRect(0, 0, W, H);

    // 四角内框
    ctx.strokeStyle = C.line2;
    ctx.lineWidth = 1.5;
    ctx.strokeRect(48, 48, W - 96, H - 96);

    const PAD = 108;
    const CW = W - PAD * 2;    // 内容宽度

    ctx.textBaseline = 'alphabetic';

    /* ---- 顶部署名 ---- */
    ctx.fillStyle = C.ink4;
    ctx.font = `13px ${SERIF}`;
    ctx.letterSpacing = '3px';
    ctx.fillText('I CHING · 周易六十四卦', PAD, 130);
    ctx.letterSpacing = '0px';

    /* ---- 阶段编号 ---- */
    ctx.fillStyle = C.red;
    ctx.font = `15px ${SERIF}`;
    ctx.letterSpacing = '2px';
    ctx.fillText('阶段 ' + String(d.stage || '').replace('P', '') + ' / 6', PAD, 232);
    ctx.letterSpacing = '0px';

    /* ---- 阶段名（大字） ---- */
    ctx.fillStyle = C.ink;
    ctx.font = `700 76px ${SERIF}`;
    ctx.fillText(d.stageName || '', PAD, 330);

    /* ---- 自测句（引用体） ---- */
    ctx.fillStyle = C.ink3;
    ctx.font = `30px ${SERIF}`;
    const askLines = wrapText(ctx, '「' + (d.ask || '') + '」', CW - 24);
    drawLines(ctx, askLines, PAD + 22, 412, 50);

    // 左侧竖线
    ctx.strokeStyle = C.line2;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(PAD, 382);
    ctx.lineTo(PAD, 412 + (askLines.length - 1) * 50 + 14);
    ctx.stroke();

    /* ---- 分隔 ---- */
    const sepY = 412 + (askLines.length - 1) * 50 + 90;
    ctx.strokeStyle = C.line;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(PAD, sepY);
    ctx.lineTo(W - PAD, sepY);
    ctx.stroke();

    /* ---- 一条处境（判词） ---- */
    ctx.fillStyle = C.ink4;
    ctx.font = `13px ${SERIF}`;
    ctx.letterSpacing = '2px';
    ctx.fillText('最像你的那一条', PAD, sepY + 56);
    ctx.letterSpacing = '0px';

    ctx.fillStyle = C.ink;
    ctx.font = `700 46px ${SERIF}`;
    const vLines = wrapText(ctx, d.verdict || '', CW);
    drawLines(ctx, vLines, PAD, sepY + 122, 64);

    // 出处
    const srcY = sepY + 122 + (vLines.length - 1) * 64 + 52;
    if (d.gua) {
      ctx.fillStyle = C.red;
      ctx.font = `22px ${SERIF}`;
      ctx.fillText(d.gua + '卦 · ' + (d.pos || ''), PAD, srcY);
    }

    /* ---- 六阶段刻度：填补中部空白，同时说明「你在 6 个阶段里的位置」 ---- */
    const tickY = srcY + 78;
    const curLevel = parseInt(String(d.stage || 'P3').replace('P', ''), 10) || 3;
    const NAMES = ['还没起来', '刚被看见', '最难的中段', '在关口上', '到顶了', '该收了'];

    ctx.fillStyle = C.ink4;
    ctx.font = `13px ${SERIF}`;
    ctx.letterSpacing = '2px';
    ctx.fillText('六十四卦的六个阶段', PAD, tickY);
    ctx.letterSpacing = '0px';

    const gap = (CW - 6 * 90) / 5;
    for (let i = 0; i < 6; i++) {
      const x = PAD + i * (90 + gap);
      const isCur = i + 1 === curLevel;
      const by = tickY + 30;

      // 方块
      ctx.fillStyle = isCur ? C.red : '#ffffff';
      ctx.strokeStyle = isCur ? C.red : C.line2;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.roundRect(x, by, 90, 44, 5);
      ctx.fill();
      ctx.stroke();

      // 编号
      ctx.fillStyle = isCur ? '#ffffff' : C.ink4;
      ctx.font = `700 19px ${SERIF}`;
      ctx.textAlign = 'center';
      ctx.fillText(String(i + 1), x + 45, by + 30);

      // 名称
      ctx.fillStyle = isCur ? C.red : C.ink4;
      ctx.font = `${isCur ? '700 ' : ''}13px ${SERIF}`;
      ctx.fillText(NAMES[i], x + 45, by + 72);
      ctx.textAlign = 'left';
    }

    /* ---- 这一阶段该做什么（摘要，最多三行） ---- */
    if (d.advice) {
      const advY = tickY + 190;
      ctx.fillStyle = C.ink4;
      ctx.font = `13px ${SERIF}`;
      ctx.letterSpacing = '2px';
      ctx.fillText('这一阶段该做什么', PAD, advY);
      ctx.letterSpacing = '0px';

      ctx.fillStyle = C.ink2;
      ctx.font = `25px ${SERIF}`;
      const raw = wrapText(ctx, d.advice, CW);
      const shown = raw.slice(0, 3);
      if (raw.length > 3) shown[2] = shown[2].replace(/[，。、]$/, '') + '…';
      drawLines(ctx, shown, PAD, advY + 44, 42);
    }

    /* ---- 底部：二维码 + 引导 ---- */
    const qrSize = 168;
    const qrX = PAD;
    const qrY = H - 118 - qrSize;

    const okQr = drawQr(ctx, url || '', qrX, qrY, qrSize);

    if (okQr) {
      const tx = qrX + qrSize + 46;
      ctx.fillStyle = C.ink;
      ctx.font = `700 34px ${SERIF}`;
      ctx.fillText('测一测你在哪个阶段', tx, qrY + 58);

      ctx.fillStyle = C.ink3;
      ctx.font = `20px ${SERIF}`;
      ctx.fillText('12 道题，三分钟', tx, qrY + 100);

      ctx.fillStyle = C.red;
      ctx.font = `700 22px ${SERIF}`;
      ctx.fillText((url || '').replace(/^https?:\/\//, '').replace(/\/index\.html$/, ''), tx, qrY + 146);
    }

    return cv;
  }

  function download(cv, filename) {
    const a = document.createElement('a');
    a.download = filename || 'findmyi.png';
    a.href = cv.toDataURL('image/png');
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }

  /** 支持 iOS 长按保存：把图塞进一个可长按的容器 */
  function showIn(container, cv) {
    if (!container) return;
    const url = cv.toDataURL('image/png');
    container.innerHTML =
      '<div class="sc-wrap">' +
        '<img class="sc-img" src="' + url + '" alt="分享卡片">' +
        '<div class="sc-hint">长按图片保存 · 或点下面的按钮下载</div>' +
        '<button class="sc-btn" id="scDownload">保存图片</button>' +
      '</div>';
    const b = document.getElementById('scDownload');
    if (b) {
      b.onclick = () => download(cv, 'findmyi-' + Date.now() + '.png');
    }
  }

  global.ShareCard = { render, download, showIn, W, H };
})(window);
