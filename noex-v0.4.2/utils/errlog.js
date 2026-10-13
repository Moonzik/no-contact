// utils/errlog.js — 本地异常日志（上线后的"黑匣子"）
//
// 为什么需要它：小程序一旦上线，用户在手机上白屏了、点了没反应、闪退了，
// 开发者是**收不到任何通知**的。用户要么卸载，要么给你一句"用不了"——
// 没有堆栈、没有机型、没有页面，根本没法查。
//
// 这里做最轻量的一件事：把异常悄悄记在本地（最多 MAX 条、只存摘要），
// 用户在「我 → 运行记录」里能看到，愿意的话复制发给我们。
//
// 三条自我约束（监控代码绝不能反过来把 App 搞挂）：
//   1. 所有读写都 try/catch 包死，任何情况下不向上抛
//   2. 写之前先截断长度，防一条超长错误把 storage 写爆
//   3. 同一条错误短时间内重复出现时只累加次数，不重复占位
//
// ⚠️ 只存本地、不上传（项目没有云端用户表）。这也意味着：用户不主动发给我们，
//    我们就看不到——这是当前架构下的必然，不是 bug。

const KEY = 'noex_errlog_v1';
const MAX = 20;          // 最多留 20 条
const MAX_MSG = 300;     // 单条摘要截断长度
const DEDUP_MS = 5000;   // 5 秒内同样的错误只累加次数

let VER = '';

/* ── 底层读写 ─────────────────────────────── */

function read() {
  try {
    const raw = wx.getStorageSync(KEY);
    return Array.isArray(raw) ? raw : [];
  } catch (e) {
    return [];
  }
}

function write(list) {
  try {
    wx.setStorageSync(KEY, list);
  } catch (e) { /* 配额满或存储异常：记不上就算了，绝不能影响主流程 */ }
}

function curPage() {
  try {
    const ps = (typeof getCurrentPages === 'function' && getCurrentPages()) || [];
    const p = ps[ps.length - 1];
    return (p && p.route) || '';
  } catch (e) {
    return '';
  }
}

/* 把任意值压成一行短文本：类型可能不是 string（Error 对象、Promise reason…） */
function short(v, n) {
  let t = '';
  try {
    if (typeof v === 'string') t = v;
    else if (v === null || v === undefined) t = '';
    else if (v && typeof v.message === 'string') t = v.message;
    else t = String(v);
  } catch (e) {
    t = '(无法读取)';
  }
  t = t.replace(/\s+/g, ' ').trim();
  return t.length > n ? t.slice(0, n) + '…' : t;
}

/* ── 写入 ─────────────────────────────────── */

/**
 * 记一条异常
 * @param {string} type js / promise / notfound / memory / manual
 * @param {*} msg  错误信息（字符串或 Error）
 * @param {string} [extra] 补充信息，会拼在 msg 后面
 */
function log(type, msg, extra) {
  try {
    const m = short(msg, MAX_MSG) + (extra ? ' ' + short(extra, 120) : '');
    if (!m.trim()) return;

    const now = Date.now();
    const list = read();
    const last = list[list.length - 1];

    if (last && last.type === type && last.msg === m && now - last.t < DEDUP_MS) {
      last.n = (last.n || 1) + 1;
      last.t = now;
      write(list);
      return;
    }

    list.push({
      t: now,
      type: type,
      msg: m,
      page: curPage(),
      v: VER,
      n: 1
    });
    while (list.length > MAX) list.shift();
    write(list);
  } catch (e) { /* 永不影响主流程 */ }
}

/* ── 读取 ─────────────────────────────────── */

function all() {
  return read();
}

function count() {
  return read().length;
}

function clear() {
  try {
    wx.removeStorageSync(KEY);
    return true;
  } catch (e) {
    return false;
  }
}

/* 时间戳 → 'MM-DD HH:mm'（本地时区，够看就行）
   ⚠️ 必须挡掉非法值：new Date(undefined) 是 Invalid Date，getMonth() 返回 NaN，
   ('0' + NaN).slice(-2) 会得到 "aN" ——用户会看到 "aN-aN aN:aN" 这种像乱码的东西。
   存储里的 t 有可能是脏数据（老版本格式、被人为改过），所以这里不能假设它一定合法。 */
function fmtT(ts) {
  try {
    const d = new Date(ts);
    if (isNaN(d.getTime())) return '--';
    const p = (n) => ('0' + n).slice(-2);
    return p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
  } catch (e) {
    return '--';
  }
}

const TYPE_NAME = {
  js: '脚本错误',
  promise: '未处理的异步错误',
  notfound: '页面不存在',
  memory: '内存告警',
  manual: '手动记录'
};

/* 给用户看的可复制文本（用户直接粘给我们就是完整线索） */
function text() {
  try {
    const list = read();
    const lines = [];
    lines.push('【NOEX 运行记录】');
    lines.push('版本 ' + (VER || '未知'));

    try {
      const info = (typeof wx !== 'undefined' && wx.getSystemInfoSync) ? wx.getSystemInfoSync() : null;
      if (info) {
        lines.push('设备 ' + (info.brand || '') + ' ' + (info.model || '') +
          ' / ' + (info.system || '') +
          ' / 微信 ' + (info.version || '') +
          ' / 基础库 ' + (info.SDKVersion || ''));
      }
    } catch (e) { /* 拿不到设备信息不影响 */ }

    lines.push('共 ' + list.length + ' 条');
    lines.push('');

    list.forEach((it, i) => {
      lines.push((i + 1) + '. ' + fmtT(it.t) + '｜' + (TYPE_NAME[it.type] || it.type) +
        (it.page ? '｜' + it.page : '') +
        (it.n > 1 ? '｜重复 ' + it.n + ' 次' : ''));
      lines.push('   ' + it.msg);
    });

    if (!list.length) lines.push('（没有记录）');
    return lines.join('\n');
  } catch (e) {
    return '【NOEX 运行记录】读取失败';
  }
}

/* ── 挂载全局监听 ─────────────────────────── */

/**
 * 在 app.js 的 onLaunch 里调一次即可。
 * 所有 wx.onXxx 都做存在性判断：低版本基础库没有这些 API 时静默跳过。
 */
function install(version, build) {
  VER = (version || '') + (build ? ' (' + build + ')' : '');
  if (typeof wx === 'undefined') return false;

  if (typeof wx.onError === 'function') {
    wx.onError((e) => {
      /* 文档说是 string，实际各版本可能给 Error 对象，都兼容一下 */
      const msg = (e && (e.message || e.errMsg)) || (typeof e === 'string' ? e : e);
      const stack = e && typeof e.stack === 'string' ? e.stack : '';
      log('js', msg, stack ? '@ ' + short(stack, 100) : '');
    });
  }

  if (typeof wx.onUnhandledRejection === 'function') {
    wx.onUnhandledRejection((res) => {
      const r = res && res.reason;
      log('promise', (r && (r.message || r.errMsg)) || r || '(空 reason)');
    });
  }

  if (typeof wx.onPageNotFound === 'function') {
    wx.onPageNotFound((res) => {
      log('notfound', (res && res.path) || '(未知路径)');
    });
  }

  if (typeof wx.onMemoryWarning === 'function') {
    wx.onMemoryWarning((res) => {
      log('memory', 'memory warning', 'level ' + ((res && res.level) || '?'));
    });
  }

  return true;
}

/* 记录 App 生命周期里的手动埋点（比如冷启动失败），也走这里 */
function manual(msg, extra) {
  log('manual', msg, extra);
}

/* 仅测试用：重置版本号 */
function _setVer(v) {
  VER = v || '';
}

module.exports = {
  KEY,
  MAX,
  MAX_MSG,
  DEDUP_MS,
  TYPE_NAME,
  install,
  log,
  manual,
  all,
  count,
  clear,
  text,
  fmtT,
  short,
  _setVer
};
