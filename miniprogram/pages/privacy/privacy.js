// pages/privacy/privacy.js — 隐私授权弹窗（v0.9.5）
// 开启 __usePrivacyCheck__ 后，调用相册 / 头像 / 剪贴板等隐私接口前，
// 微信要求必须由用户主动点击「同意」。这个页面就是那一下点击的落点。
const app = getApp();

Page({
  data: {},

  onNoop() { /* 阻止穿透滚动 */ },

  /* 微信托管的《用户隐私保护指引》全文 */
  openContract() {
    if (wx.openPrivacyContract) {
      wx.openPrivacyContract({
        fail: (e) => {
          console.warn('[privacy] openPrivacyContract fail:', e);
          wx.showToast({
            title: '指引还没在后台配置好',
            icon: 'none',
            duration: 2000
          });
        }
      });
    }
  },

  /* 必须在这个回调（用户点击的同步链路）里 resolve，授权才生效 */
  onAgree(e) {
    const btnId = (e && e.detail && e.detail.buttonId) || 'agree-btn';
    this._resolve({ buttonId: btnId, event: 'agree' });
  },

  onDisagree() {
    this._resolve({ event: 'disagree' });
    wx.showToast({
      title: '未同意的话，头像和粘贴功能用不了',
      icon: 'none',
      duration: 2400
    });
  },

  _resolve(payload) {
    const resolve = app && app.globalData && app.globalData.privacyResolve;
    if (typeof resolve === 'function') {
      try {
        resolve(payload);
      } catch (err) {
        console.warn('[privacy] resolve fail:', err);
      }
    }
    if (app && app.globalData) app.globalData.privacyResolve = null;
    wx.navigateBack({
      fail: () => {
        wx.switchTab({ url: '/pages/today/today' });
      }
    });
  },

  /* 用户直接左滑/点空白返回时，也要把 resolve 消费掉，否则后续接口一直卡住 */
  onUnload() {
    if (app && app.globalData && app.globalData.privacyResolve) {
      try {
        app.globalData.privacyResolve({ event: 'disagree' });
      } catch (e) { /* ignore */ }
      app.globalData.privacyResolve = null;
    }
  }
});
