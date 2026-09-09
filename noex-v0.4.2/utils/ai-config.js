// utils/ai-config.js — AI 引擎开关（**你只需要改这一个文件**）
//
// 三种模式：
//   'off'    纯本地规则引擎（默认）。不联网、不花钱、不需要任何配置，行为和以前一样。
//   'cloud'  走微信云开发云函数 —— 推荐。Key 存在云函数里不泄露，且**不需要配 request 合法域名**。
//   'https'  小程序直连大模型 API —— 必须在 mp 后台配 request 合法域名，且 Key 会打进小程序包（有泄露风险）。
//
// 现在默认 'off'，所以即使你什么都不做，小程序也照常能用。

module.exports = {
  provider: 'cloud', // ← 接入成功后把这里改成 'cloud' 或 'https'

  /* ── 模式一：云开发云函数（推荐）───────────────────── */
  cloud: {
    env: 'cloud1-d4gmglocfb7dc5a47',   // 云开发环境 ID，形如 'noex-1x2y3z4a5b6c7d'（云开发控制台 → 环境 → 环境ID）
    fn: 'noex-ai' // 云函数名，默认别改
  },

  /* ── 模式二：直连 HTTPS（需配合法域名）────────────── */
  https: {
    url: '',    // 完整接口地址，例：'https://api.deepseek.com/chat/completions'
    key: '',    // API Key（注意：会打进小程序包，任何人反编译都能拿到）
    model: ''   // 例：'deepseek-chat'
  },

  /* ── 通用参数 ────────────────────────────────────── */
  timeout: 15000,   // 超时毫秒数。超时后自动用本地回复，用户不会卡住
  historyTurns: 10, // 携带的历史消息条数（越多越连贯，也越费 token）
  debug: false      // 打开后会在 console 打印 AI 相关日志，排查用
};
