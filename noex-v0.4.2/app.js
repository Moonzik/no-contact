// app.js — 全局入口
const storage = require('./utils/storage.js');
const ai = require('./utils/ai.js');

App({
  globalData: {
    version: '0.9.10',  // 2026-09-11 影子去"亲密称呼/答非所问"（重写铁律 0 + 新增 0b 高压线）+ 修 prompt 重复输入真 bug（dropDupTail）+ 输入框高度稳定化 + 跨零点次数重置
    name: '断联日记 NOEX',
    build: 'shadow-agent-v9.10',
    /* 从功能页点「去登录」过来时置 true，me 页 onShow 消费掉并展开登录卡 */
    autoOpenLogin: false,
    /* 隐私授权：onNeedPrivacyAuthorization 触发时存下 resolve，由 privacy 页消费 */
    privacyResolve: null
  },

  onLaunch() {
    // 跨天检查：挂机过午夜后回到 today 页时自动刷新
    storage.initSessionTimer();
    this.initPrivacy();
    console.log('[断联日记] 启动, 版本', this.globalData.version, this.globalData.build);
  },

  /* v0.9.5：开启 __usePrivacyCheck__ 后，相册/头像/剪贴板等接口调用前
     会先抛 onNeedPrivacyAuthorization。不接这个回调的话，接口会直接 fail，
     用户看到的就是「点了没反应」。这里统一跳到隐私弹窗页，让用户点同意。 */
  initPrivacy() {
    if (typeof wx === 'undefined' || !wx.onNeedPrivacyAuthorization) return;
    wx.onNeedPrivacyAuthorization((resolve) => {
      this.globalData.privacyResolve = resolve;
      const pages = (typeof getCurrentPages === 'function' && getCurrentPages()) || [];
      const cur = pages[pages.length - 1];
      if (cur && cur.route === 'pages/privacy/privacy') return;
      wx.navigateTo({
        url: '/pages/privacy/privacy',
        fail: () => {
          /* 页面栈满了之类的极端情况：直接放行，别把用户卡死 */
          this.globalData.privacyResolve = null;
          try {
            resolve({ event: 'disagree' });
          } catch (e) { /* ignore */ }
        }
      });
    });
  },

  onShow() {}
});
