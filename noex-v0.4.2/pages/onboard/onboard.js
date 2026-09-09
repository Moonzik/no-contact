// pages/onboard/onboard.js
const storage = require('../../utils/storage.js');
const util = require('../../utils/util.js');

/* v0.8.0：引导结束直接进首页，不拦登录 */
function goAfterOnboard() {
  wx.switchTab({ url: '/pages/today/today' });
}

Page({
  data: {
    step: 0,            // 0 欢迎 1 立起点 2 进介绍
    startDate: '',
    exName: '',
    appIcon: '/images/appicon.png',
    agentImg: '/images/agent.png'
  },

  onLoad() {
    const S = storage.load();
    if (S.onboarded) {
      goAfterOnboard();
      return;
    }
    this.setData({ startDate: util.todayStr() });
  },

  onGoStart() {
    this.setData({ step: 1 });
  },

  onPickDate(e) {
    this.setData({ startDate: e.detail.value });
  },

  onInputEx(e) {
    this.setData({ exName: e.detail.value });
  },

  onConfirmStart() {
    const S = storage.load();
    S.startDate = this.data.startDate || util.todayStr();
    S.exName = (this.data.exName || '').trim();
    storage.save(S);
    this.setData({ step: 2 });
  },

  onEnter() {
    const S = storage.load();
    S.onboarded = true;
    S.startDate = S.startDate || util.todayStr();
    S.usedReplies = S.usedReplies || {};
    storage.save(S);
    goAfterOnboard();
  }
});
