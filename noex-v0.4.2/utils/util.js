// utils/util.js — 通用工具

/**
 * 获取今天字符串（YYYY-MM-DD，按本地时区）
 */
function todayStr() {
  const d = new Date();
  const y = d.getFullYear();
  const m = ('0' + (d.getMonth() + 1)).slice(-2);
  const day = ('0' + d.getDate()).slice(-2);
  return y + '-' + m + '-' + day;
}

/**
 * 解析 "YYYY-MM-DD" → Date（本地时区 00:00:00）
 *
 * 不用 new Date('2026-09-08') / new Date('2026-09-08T00:00:00')：
 * iOS 的 JavaScriptCore 对 ISO 字符串的解析历史上存在时区差异与 Invalid Date 问题，
 * 统一改数字构造可保证两端一致。
 */
function parseDate(ds) {
  const p = String(ds || '').split('-');
  const y = parseInt(p[0], 10);
  const m = parseInt(p[1], 10);
  const d = parseInt(p[2], 10);
  if (!y || !m || !d) return null;
  return new Date(y, m - 1, d);
}

/**
 * 戒断天数（>=1）
 */
function dayNum(startDate) {
  if (!startDate) return 1;
  const a = parseDate(startDate);
  const b = parseDate(todayStr());
  if (!a || !b) return 1;
  /* 用 round 而非 floor，避免跨夏令时/时区时差 1 天（国内无 DST，但更稳） */
  return Math.max(1, Math.round((b - a) / 86400000) + 1);
}

/**
 * 格式化日期为 "2026 年 8 月 30 日"
 */
function fmtDate(ds) {
  if (!ds) return '';
  const p = ds.split('-');
  return p[0] + ' 年 ' + parseInt(p[1], 10) + ' 月 ' + parseInt(p[2], 10) + ' 日';
}

/**
 * 随机取一个
 */
function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

/**
 * 把毫秒格式化为 "mm:ss"
 */
function fmtRemain(ms) {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const sec = ('0' + (s % 60)).slice(-2);
  return m + ':' + sec;
}

/**
 * 时间段问候（用于 today 页小白的开场白）
 */
function hourBucket() {
  const h = new Date().getHours();
  if (h >= 6 && h < 11) return 'morning';
  if (h >= 11 && h < 14) return 'noon';
  if (h >= 14 && h < 18) return 'afternoon';
  if (h >= 18 && h < 23) return 'evening';
  return 'late';
}

module.exports = {
  todayStr,
  parseDate,
  dayNum,
  fmtDate,
  pick,
  fmtRemain,
  hourBucket
};
