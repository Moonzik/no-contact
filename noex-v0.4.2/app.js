// app.js — 全局入口
const storage = require('./utils/storage.js');
const ai = require('./utils/ai.js');
const errlog = require('./utils/errlog.js');

App({
  globalData: {
    version: '0.9.16',  // 2026-09-11 影子去语气词：①取消写死开场白「……嗯。」与起疑承认句里的语气词；②语气词加频率门槛（toneRate<0.2 一律不算特点），画像改为明确禁令「不用语气词」，只有 TA 真高频才允许用；③用户看的画像摘要与老画像口头禅过滤纯语气词
    name: '断联日记 NOEX',
    build: 'no-tone-v9.16',
    /* 从功能页点「去登录」过来时置 true，me 页 onShow 消费掉并展开登录卡 */
    autoOpenLogin: false,
    /* 隐私授权：onNeedPrivacyAuthorization 触发时存下 resolve，由 privacy 页消费 */
    privacyResolve: null
  },

  onLaunch() {
    /* v0.9.14：先挂异常监听，越早越好——后面任何一步出错都会被记下来。
       记在本地（不联网、不上传），用户在「我 → 运行记录」里能看到并复制给我们。
       这是上线后排查"用户说用不了但我这边好好的"的仅有线索来源。 */
    errlog.install(this.globalData.version, this.globalData.build);

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
