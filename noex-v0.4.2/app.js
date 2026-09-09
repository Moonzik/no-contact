// app.js — 全局入口
const storage = require('./utils/storage.js');
const ai = require('./utils/ai.js');

App({
  globalData: {
    version: '0.9.1',  // 2026-09-09 「我」页排版：关于/隐私做成页面行可点，AI 引擎状态直接显示在页底（不用进弹层）
    name: '断联日记 NOEX',
    build: 'me-redesign-v9.1',
    /* 从功能页点「去登录」过来时置 true，me 页 onShow 消费掉并展开登录卡 */
    autoOpenLogin: false
  },

  onLaunch() {
    // 跨天检查：挂机过午夜后回到 today 页时自动刷新
    storage.initSessionTimer();
    console.log('[断联日记] 启动, 版本', this.globalData.version, this.globalData.build);
  },

  onShow() {}
});
