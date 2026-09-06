// app.js — 全局入口
const storage = require('./utils/storage.js');

App({
  globalData: {
    version: '0.1',
    name: '留白 Whitespace'
  },

  onLaunch() {
    // 跨天检查：挂机过午夜后回到 today 页时自动刷新
    storage.initSessionTimer();
  },

  onShow() {}
});
