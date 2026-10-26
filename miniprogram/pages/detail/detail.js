const { ofGua } = require('../../data/situations');

Page({
  data: {
    gua: '',
    rows: [],
    open: -1
  },

  onLoad(query) {
    let g = '乾';
    if (query && query.g) {
      try {
        g = decodeURIComponent(query.g);
      } catch (err) {
        g = query.g;
      }
    }

    const six = ofGua(g); // 初爻 → 上爻
    if (!six.length) {
      wx.navigateBack();
      return;
    }

    // 反过来：上爻在最上面
    const rows = six
      .slice()
      .reverse()
      .map((it) => ({
        p: it.p,
        v: it.v,
        w: it.w,
        r: it.r,
        e: it.e,
        y: it.y,
        yang: it.p.indexOf('九') >= 0
      }));

    wx.setNavigationBarTitle({ title: g });
    this.setData({ gua: g, rows });
  },

  toggle(e) {
    const i = Number(e.currentTarget.dataset.i);
    this.setData({ open: this.data.open === i ? -1 : i });
  },

  onShareAppMessage() {
    return {
      title: this.data.gua + '卦 · 六个位置，六种处境',
      path: '/pages/index/index'
    };
  }
});
