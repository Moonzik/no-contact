// pages/me/me.js
const storage = require('../../utils/storage.js');
const util = require('../../utils/util.js');
const guardian = require('../../utils/guardian.js');

Page({
  data: {
    day: 1,
    sub: '已坚持 1 天',
    startDate: '',
    exName: '',
    personas: [],
    agentImg: '/images/agent.png',
    showGear: false,
    showClear: false
  },

  onShow() {
    this.refresh();
  },

  onMidnightRefresh() {
    this.refresh();
  },

  refresh() {
    const S = storage.load();
    const d = util.dayNum(S.startDate);
    const personas = Object.keys(guardian.PERSONAS).map((k) => ({
      k,
      name: guardian.PERSONAS[k].name,
      desc: guardian.PERSONAS[k].desc,
      on: S.persona === k
    }));
    this.setData({
      day: d,
      sub: '已坚持 ' + d + ' 天',
      startDate: S.startDate,
      exName: S.exName,
      personas
    });
  },

  onPickDate(e) {
    this.setData({ startDate: e.detail.value });
    const S = storage.load();
    if (e.detail.value) {
      S.startDate = e.detail.value;
      storage.save(S);
      wx.showToast({ title: '已更新', icon: 'none' });
      this.refresh();
    }
  },

  onExInput(e) {
    const S = storage.load();
    S.exName = e.detail.value;
    storage.save(S);
  },

  onPickPersona(e) {
    const k = e.currentTarget.dataset.k;
    const S = storage.load();
    if (S.persona !== k) {
      S.persona = k;
      storage.save(S);
      wx.showToast({ title: '切换为「' + guardian.PERSONAS[k].name + '」', icon: 'none' });
      this.refresh();
    }
  },

  onExport() {
    const S = storage.load();
    const json = storage.exportJson(S);
    /* 小程序里没法直接下载，复制到剪贴板让用户粘贴 */
    wx.setClipboardData({
      data: json,
      success: () => {
        wx.showToast({ title: '已复制 JSON 到剪贴板', icon: 'none' });
      }
    });
  },

  onClear() {
    this.setData({ showClear: true });
  },

  onClearConfirm() {
    const S = storage.load();
    Object.assign(S, storage.defaultState());
    S.startDate = util.todayStr();
    S.onboarded = false;
    storage.save(S);
    this.setData({ showClear: false });
    wx.showToast({ title: '已清空，重新开始', icon: 'none' });
    /* 退出后回 onboard */
    wx.reLaunch({ url: '/pages/onboard/onboard' });
  },

  onClearCancel() {
    this.setData({ showClear: false });
  },

  onGear() {
    this.setData({ showGear: true });
  },

  onCloseGear() {
    this.setData({ showGear: false });
  }
});
