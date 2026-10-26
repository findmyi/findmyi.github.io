const CONTENT = require('./data/actions');

App({
  globalData: {
    content: CONTENT,
    stage: '',
    track: ''
  },

  onLaunch() {
    if (!wx.getStorageSync('records')) {
      wx.setStorageSync('records', {});
    }
    if (!wx.getStorageSync('outputs')) {
      wx.setStorageSync('outputs', {});
    }
  },

  /* ── 完成记录（只存本机） ── */
  getRecords() {
    return wx.getStorageSync('records') || {};
  },

  markDone(id) {
    const records = this.getRecords();
    records[id] = Date.now();
    wx.setStorageSync('records', records);
    return records;
  },

  clearDone(id) {
    const records = this.getRecords();
    delete records[id];
    wx.setStorageSync('records', records);
    return records;
  },

  todayCount() {
    const records = this.getRecords();
    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    let n = 0;
    Object.keys(records).forEach((k) => {
      if (records[k] >= start) n++;
    });
    return n;
  },

  /* ── 攒下的东西 ── */
  getOutputs() {
    return wx.getStorageSync('outputs') || {};
  },

  saveOutput(id, text) {
    const outputs = this.getOutputs();
    const t = (text || '').trim();
    if (t) {
      outputs[id] = { text: t, at: Date.now() };
    } else {
      delete outputs[id];
    }
    wx.setStorageSync('outputs', outputs);
    return outputs;
  },

  outputCount() {
    return Object.keys(this.getOutputs()).length;
  }
});
