const { SCREEN, TRACKS, questionsFor, score } = require('../../data/quiz');

Page({
  data: {
    phase: 'screen', // screen → quiz
    screen: SCREEN,
    q: null,
    idx: 0,
    total: 12,
    pct: 0,
    picked: -1,
    hide: false,
    trackName: ''
  },

  onLoad() {
    // 非渲染状态放在实例上，避免无谓的 setData
    this.questions = [];
    this.answers = [];
    this.picks = [];
    this.track = '';
    this.locked = false;
  },

  /** 分流题：选定领域，进第一题 */
  pickScreen(e) {
    if (this.locked) return;
    this.locked = true;

    const i = Number(e.currentTarget.dataset.i);
    const opt = SCREEN.opts[i];
    const t = TRACKS.find((x) => x.key === opt.track);

    this.track = opt.track;
    this.questions = questionsFor(opt.track);
    this.answers = [];
    this.picks = [];

    this.setData({ picked: i });

    setTimeout(() => {
      this.setData({ hide: true });
      setTimeout(() => {
        this.setData({
          phase: 'quiz',
          trackName: t ? t.name : '',
          idx: 0,
          q: this.questions[0],
          total: this.questions.length,
          pct: Math.round(100 / this.questions.length),
          picked: -1,
          hide: false
        });
        this.locked = false;
      }, 120);
    }, 180);
  },

  /** 答题：点一下即记录并跳下一题 */
  pick(e) {
    if (this.locked) return;
    this.locked = true;

    const i = Number(e.currentTarget.dataset.i);
    const idx = this.data.idx;
    const q = this.questions[idx];

    // 回退后再改答案时，丢掉后面的旧记录
    this.answers.length = idx;
    this.picks.length = idx;
    this.answers[idx] = q.opts[i];
    this.picks[idx] = i;

    this.setData({ picked: i });

    setTimeout(() => {
      if (idx + 1 >= this.questions.length) {
        this.finish();
      } else {
        this.go(idx + 1);
      }
    }, 240);
  },

  go(n) {
    const q = this.questions[n];
    this.setData({ hide: true });
    setTimeout(() => {
      this.setData({
        idx: n,
        q,
        picked: this.picks[n] === undefined ? -1 : this.picks[n],
        pct: Math.round(((n + 1) / this.questions.length) * 100),
        hide: false
      });
      this.locked = false;
    }, 120);
  },

  finish() {
    const stageCode = score(this.answers);
    getApp().globalData.stage = stageCode;
    getApp().globalData.track = this.track;

    wx.redirectTo({
      url: '/pages/result/result?stage=' + stageCode
    });
  },

  goBack() {
    if (this.locked) return;

    // 分流题：退回首页
    if (this.data.phase === 'screen') {
      wx.reLaunch({ url: '/pages/index/index' });
      return;
    }

    // 第一题：退回分流题
    if (this.data.idx === 0) {
      this.setData({ hide: true });
      setTimeout(() => {
        this.setData({ phase: 'screen', picked: -1, hide: false });
      }, 120);
      return;
    }

    this.go(this.data.idx - 1);
  }
});
