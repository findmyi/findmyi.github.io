const { GUA_ORDER, ofGua } = require('../../data/situations');

Page({
  data: {
    guas: []
  },

  onLoad() {
    // ofGua 返回的是「初爻 → 上爻」，展示时翻过来：上爻在最上面
    const guas = GUA_ORDER.map((g) => {
      const six = ofGua(g);
      const lines = six
        .slice()
        .reverse()
        .map((it, i) => ({
          i,
          yang: it.p.indexOf('九') >= 0
        }));

      return { g, lines };
    });

    this.setData({ guas });
  },

  open(e) {
    const g = e.currentTarget.dataset.g;
    wx.navigateTo({
      url: '/pages/detail/detail?g=' + encodeURIComponent(g)
    });
  }
});
