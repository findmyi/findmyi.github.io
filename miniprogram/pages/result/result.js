const { pickThree } = require('../../data/picker');
const { stageOf } = require('../../data/quiz');

Page({
  data: {
    stage: null,
    stageNo: 1,
    picks: []
  },

  onLoad(query) {
    const code = query.stage || getApp().globalData.stage;
    const stage = code ? stageOf(code) : null;

    if (!stage) {
      wx.reLaunch({ url: '/pages/index/index' });
      return;
    }

    // pickThree 已处理好「尽量不同卦」与「判词长度」，直接用
    const picks = pickThree(code).map((it) => ({
      key: it.g + it.p,
      g: it.g,
      p: it.p,
      v: it.v,
      w: it.w,
      r: it.r,
      e: it.e
    }));

    this.setData({
      stage,
      stageNo: Number(code.slice(1)),
      picks
    });
  },

  again() {
    wx.reLaunch({ url: '/pages/quiz/quiz' });
  },

  goActs(e) {
    const mod = e.currentTarget.dataset.mod;
    wx.navigateTo({ url: '/pages/acts/acts?mod=' + mod });
  },

  toList() {
    wx.navigateTo({ url: '/pages/list/list' });
  },

  onShareAppMessage() {
    const s = this.data.stage;
    return {
      title: s ? '我在「' + s.name + '」这个阶段，你在哪个？' : '你现在，在哪个阶段？',
      path: '/pages/index/index'
    };
  }
});
