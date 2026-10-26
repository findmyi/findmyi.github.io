Page({
  data: {
    content: {},
    mineDesc: '还没有记录'
  },

  onShow() {
    const app = getApp();
    const today = app.todayCount();
    const outs = app.outputCount();

    const parts = [];
    if (today > 0) parts.push('今天完成 ' + today + ' 件');
    if (outs > 0) parts.push('攒下 ' + outs + ' 样东西');

    this.setData({
      content: app.globalData.content,
      mineDesc: parts.length ? parts.join(' · ') : '还没有记录'
    });
  },

  startQuiz() {
    wx.navigateTo({ url: '/pages/quiz/quiz' });
  },

  goActs(e) {
    const mod = e.currentTarget.dataset.mod;
    wx.navigateTo({ url: '/pages/acts/acts?mod=' + mod });
  },

  goRecords() {
    wx.navigateTo({ url: '/pages/records/records' });
  },

  onShareAppMessage() {
    return {
      title: '什么都不想做的时候，先做一件小事',
      path: '/pages/index/index'
    };
  }
});
