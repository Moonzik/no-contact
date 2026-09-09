// pages/bottle/bottle.js
const storage = require('../../utils/storage.js');
const util = require('../../utils/util.js');
const user = require('../../utils/user.js');

Page({
  data: {
    text: '',
    items: []          // 倒序：最新的在最上面
  },

  onShow() {
    /* v0.8.0：留白瓶可以看，只有「写」才要登录 */
    this.refresh();
  },

  refresh() {
    const S = storage.load();
    /* v0.4.1: t 是日期字符串，同一天写两条会重复 → 用索引做稳定 key */
    const items = S.bottle
      .slice()
      .reverse()
      .map((b, i) => ({ t: b.t, text: b.text, _k: i }));
    this.setData({ items });
  },

  onInput(e) {
    this.setData({ text: e.detail.value });
  },

  onSave() {
    if (user.requireLogin('往留白瓶里写东西需要登录一次。')) return;
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
