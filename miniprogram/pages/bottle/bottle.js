// pages/bottle/bottle.js
const storage = require('../../utils/storage.js');
const util = require('../../utils/util.js');

Page({
  data: {
    text: '',
    items: []          // 倒序：最新的在最上面
  },

  onShow() {
    this.refresh();
  },

  refresh() {
    const S = storage.load();
    const items = S.bottle
      .slice()
      .reverse()
      .map((b) => ({ t: b.t, text: b.text }));
    this.setData({ items });
  },

  onInput(e) {
    this.setData({ text: e.detail.value });
  },

  onSave() {
    const v = (this.data.text || '').trim();
    if (!v) {
      wx.showToast({ title: '先写点什么吧', icon: 'none' });
      return;
    }
    const S = storage.load();
    S.bottle.push({ t: util.todayStr(), text: v });
    storage.save(S);
    this.setData({ text: '' });
    this.refresh();
    wx.showToast({ title: '已存好。它不会被发送', icon: 'none' });
  }
});
