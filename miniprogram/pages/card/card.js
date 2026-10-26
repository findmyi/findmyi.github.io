Page({
  data: {
    mod: 'A',
    idx: 0,
    item: {},
    isDone: false,
    isB: false,
    draft: '',
    saved: false,
    showHome: false
  },

  onLoad(options) {
    const app = getApp();
    const mod = options.mod === 'B' ? 'B' : 'A';
    const list = app.globalData.content[mod].items;
    const idx = parseInt(options.idx, 10) || 0;
    const item = list[idx] || list[0];
    const stored = app.getOutputs()[item.id];

    this.setData({
      mod,
      idx,
      item,
      isB: mod === 'B',
      draft: stored ? stored.text : '',
      saved: !!stored
    });

    wx.setNavigationBarTitle({ title: item.tag });
  },

  onReady() {
    // 页面栈只有一层 = 从分享或「最近使用」直接进来的，没有返回路径
    const stack = getCurrentPages() || [];
    this.setData({ showHome: stack.length === 1 });
  },

  onShow() {
    if (this.data.item && this.data.item.id) {
      const records = getApp().getRecords();
      this.setData({ isDone: !!records[this.data.item.id] });
    }
  },

  goHome() {
    wx.reLaunch({ url: '/pages/index/index' });
  },

  onDraft(e) {
    this.setData({ draft: e.detail.value });
  },

  saveOut() {
    const app = getApp();
    const text = (this.data.draft || '').trim();

    if (!text) {
      wx.showToast({ title: '先写一句', icon: 'none' });
      return;
    }

    app.saveOutput(this.data.item.id, text);
    this.setData({ saved: true, draft: text });
    wx.showToast({ title: '存好了', icon: 'success' });
  },

  toggleDone() {
    const app = getApp();
    const id = this.data.item.id;

    if (this.data.isDone) {
      app.clearDone(id);
      this.setData({ isDone: false });
      wx.showToast({ title: '已取消', icon: 'none' });
    } else {
      app.markDone(id);
      this.setData({ isDone: true });
      wx.showToast({ title: '记下了', icon: 'success' });
    }
  },

  // 分享单张行动卡。只带处境编号，不带用户填写的任何内容
  onShareAppMessage() {
    const item = this.data.item || {};
    const title =
      item.q && item.act ? item.q + '，' + item.act : '挑一个处境，照着做完，就算完成';

    return {
      title,
      path: '/pages/card/card?mod=' + this.data.mod + '&idx=' + this.data.idx
    };
  }
});
