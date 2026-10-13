// utils/notify.js — 打卡提醒（微信订阅消息）
//
// 小程序没有任何「本地定时通知」能力，唯一能让用户被叫回来打卡的官方通道
// 就是订阅消息：用户主动点「订阅」→ 云函数按模板发一条 → 用户收到。
//
// 所以这里的职责只有一半（客户端授权），另一半在云函数（定时触发 + 发送）。
// 模板 ID 在 utils/config.js 里配，没配时 configured() 为 false，
// 页面会如实说明「要先去后台申请模板」，而不是假装订阅成功了。

const cfg = require('./config.js');

/** 模板 ID（未配置时为空字符串） */
function tmplId() {
  return cfg.REMINDER_TMPL_ID || '';
}

/** 是否已经配好模板 ID */
function configured() {
  return !!tmplId();
}

/** 当前微信版本是否支持订阅消息（基础库 2.4.4+） */
function supported() {
  return typeof wx !== 'undefined' && typeof wx.requestSubscribeMessage === 'function';
}

/**
 * 请求订阅授权
 * @param {function} cb cb(ok, reason, err)
 *   reason: off = 模板 ID 未配置
 *           unsupported = 基础库太老
 *           deny = 用户点了「取消」（或勾了「总是保持以上选择」后又拒绝）
 *           fail = 接口调用失败（多为隐私/权限问题）
 *           ok = 订阅成功
 */
function request(cb) {
  cb = cb || function () {};
  if (!configured()) return cb(false, 'off');
  if (!supported()) return cb(false, 'unsupported');
  const id = tmplId();
  wx.requestSubscribeMessage({
    tmplIds: [id],
    success: (res) => {
      const v = res && res[id];
      if (v === 'accept') return cb(true, 'ok');
      cb(false, 'deny');
    },
    fail: (err) => cb(false, 'fail', err)
  });
}

module.exports = { tmplId, configured, supported, request };
