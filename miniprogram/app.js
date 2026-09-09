// app.js — 全局入口
const storage = require('./utils/storage.js');
const ai = require('./utils/ai.js');

App({
  globalData: {
    version: '0.9.3',  // 2026-09-10 ① 小白改成「正常 AI 聊天 + 性格」：聊什么接什么，不再句句把话题拽回 TA/断联，识别出意图后不再额外追加一段 ② 影子揭示只在用户起疑（你怎么越来越不像他了）时才弹，取消所有自动计时触发 ③ 头像上传：模拟器自动降级相册 + chooseAvatar 报错兜底 + 隐私校验临时关闭
    name: '断联日记 NOEX',
    build: 'chat-nature-v9.3',
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
