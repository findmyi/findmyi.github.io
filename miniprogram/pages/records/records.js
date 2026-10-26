function fmt(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  const now = new Date();
  const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const startYesterday = startToday - 86400000;

  if (ts >= startToday) {
    const m = d.getMinutes();
    return '今天 ' + d.getHours() + ':' + (m < 10 ? '0' + m : m);
  }
  if (ts >= startYesterday) return '昨天';
  return d.getMonth() + 1 + '月' + d.getDate() + '日';
}

Page({
  data: {
    todayCount: 0,
    totalCount: 0,
    outputCount: 0,
    groups: [],
    outputs: []
  },

  onShow() {
    this.refresh();
  },

  refresh() {
    const app = getApp();
    const content = app.globalData.content;
    const records = app.getRecords();
    const outputs = app.getOutputs();

    const groups = [];
    ['A', 'B'].forEach((mod) => {
      const done = [];
      content[mod].items.forEach((it, i) => {
        if (records[it.id]) {
          done.push({
            id: it.id,
            idx: i,
            q: it.q,
            act: it.act,
            ts: records[it.id],
            at: fmt(records[it.id])
          });
        }
      });
      done.sort((a, b) => b.ts - a.ts);

      if (done.length) {
        groups.push({
          mod,
          key: content[mod].key,
          items: done
        });
      }
    });

    const outList = [];
    content.B.items.forEach((it, i) => {
      if (outputs[it.id]) {
        outList.push({
          id: it.id,
          idx: i,
          q: it.q,
          out: it.out,
          text: outputs[it.id].text,
          at: fmt(outputs[it.id].at)
        });
      }
    });
    outList.sort((a, b) => outputs[b.id].at - outputs[a.id].at);

    this.setData({
      todayCount: app.todayCount(),
      totalCount: Object.keys(records).length,
      outputCount: outList.length,
      groups,
      outputs: outList
    });
  },

  goCard(e) {
    const d = e.currentTarget.dataset;
    wx.navigateTo({
      url: '/pages/card/card?mod=' + d.mod + '&idx=' + d.idx
    });
  },

  undo(e) {
    const id = e.currentTarget.dataset.id;
    const app = getApp();

    wx.showModal({
      title: '去掉这条记录？',
      content: '只是从记录里去掉，别的都不受影响。',
      confirmText: '去掉',
      cancelText: '算了',
      success: (res) => {
        if (res.confirm) {
          app.clearDone(id);
          this.refresh();
        }
      }
    });
  },

  goHome() {
    wx.navigateBack({ delta: 1 });
  }
});
