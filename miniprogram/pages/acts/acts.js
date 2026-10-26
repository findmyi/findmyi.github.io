Page({
  data: {
    mod: 'A',
    info: {},
    items: []
  },

  onLoad(options) {
    const app = getApp();
    const mod = options.mod === 'B' ? 'B' : 'A';
    const info = app.globalData.content[mod];

    this.setData({ mod, info });
    wx.setNavigationBarTitle({ title: info.key });
    this.refresh();
  },

  onShow() {
    if (this.data.info && this.data.info.items) {
      this.refresh();
    }
  },

  refresh() {
    const app = getApp();
    const records = app.getRecords();
    const items = this.data.info.items.map((it) => ({
      id: it.id,
      q: it.q,
      tag: it.tag,
      time: it.time,
      done: !!records[it.id]
    }));
    this.setData({ items });
  },

  goCard(e) {
    const idx = e.currentTarget.dataset.idx;
    wx.navigateTo({
      url: '/pages/card/card?mod=' + this.data.mod + '&idx=' + idx
    });
  }
});
