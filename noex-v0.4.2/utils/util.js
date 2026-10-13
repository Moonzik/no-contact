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

/* ───────── v0.9.12 打卡日历 ───────── */

function pad2(n) { return ('0' + n).slice(-2); }

/**
 * 拼 "YYYY-MM-DD"
 */
function dateStr(y, m, d) { return y + '-' + pad2(m) + '-' + pad2(d); }

/**
 * 把某个月的打卡 / 复发记录铺成 7 列网格（周日打头）
 * @param {number} y 年
 * @param {number} m 月（1-12）
 * @param {object} checkMap { 'YYYY-MM-DD': 1 }
 * @param {object} relMap   { 'YYYY-MM-DD': 1 }
 * @param {string} today    'YYYY-MM-DD'
 * @returns {Array} [{ k, d, cls, blank }]
 *
 * 注意：日期都是等长的 'YYYY-MM-DD'，所以字符串比较就等于日期比较，
 * 不需要构造 Date（也就避开了 iOS 上 ISO 字符串解析的老问题）。
 */
function calendarOf(y, m, checkMap, relMap, today, noteMap) {
  const cells = [];
  const lead = new Date(y, m - 1, 1).getDay();        // 0 = 周日
  const days = new Date(y, m, 0).getDate();           // 该月天数
  for (let i = 0; i < lead; i++) cells.push({ k: 'b' + i, blank: true, cls: 'cal-cell blank' });
  for (let d = 1; d <= days; d++) {
    const ds = dateStr(y, m, d);
    const future = ds > today;
    const on = !!checkMap[ds];
    const rel = !!relMap[ds];
    let cls = 'cal-cell';
    if (future) cls += ' future';
    else if (rel) cls += ' rel';       // 复发优先：这天先记断过
    else if (on) cls += ' on';
    if (ds === today) cls += ' today';
    /* v0.9.13 文字日记：写过日记的日子加一个小点（不是状态，是痕迹） */
    if (noteMap && noteMap[ds]) cls += ' note';
    cells.push({ k: ds, d: d, cls: cls });
  }
  return cells;
}

/**
 * 统计某个 map 里落在指定月份的天数
 */
function countInMonth(map, y, m) {
  const prefix = y + '-' + pad2(m) + '-';
  let n = 0;
  for (const k in map) {
    if (k.indexOf(prefix) === 0) n++;
  }
  return n;
}

/**
 * 最长连续打卡天数（跨月也算，所以直接吃全量日期）
 */
function longestStreak(dateStrs) {
  if (!dateStrs || !dateStrs.length) return 0;
  const arr = dateStrs.slice().sort();
  let best = 1;
  let cur = 1;
  for (let i = 1; i < arr.length; i++) {
    const a = parseDate(arr[i - 1]);
    const b = parseDate(arr[i]);
    if (!a || !b) continue;
    const diff = Math.round((b - a) / 86400000);
    if (diff === 1) {
      cur++;
      if (cur > best) best = cur;
    } else if (diff !== 0) {
      cur = 1;
    }
  }
  return best;
}

/**
 * 上一个月 / 下一个月（跨年处理）
 */
function shiftMonth(y, m, delta) {
  const t = y * 12 + (m - 1) + delta;
  return { y: Math.floor(t / 12), m: (t % 12 + 12) % 12 + 1 };
}

/* ───────── v0.9.13 缺口二 · 文字日记 / 留白瓶封存 ───────── */

/**
 * 加 n 年（留白瓶「一年后打开」用）
 * 用数字构造，不碰 Date 字符串解析。2 月 29 日 + 1 年 → 3 月 1 日，可接受。
 */
function addYears(ds, n) {
  const d = parseDate(ds);
  if (!d) return ds;
  const nd = new Date(d.getFullYear() + n, d.getMonth(), d.getDate());
  return dateStr(nd.getFullYear(), nd.getMonth() + 1, nd.getDate());
}

/**
 * "2026-09-11" → "9 月 11 日"（日期列表里用的短格式）
 */
function mdd(ds) {
  if (!ds) return '';
  const p = String(ds).split('-');
  if (p.length < 3) return String(ds);
  return parseInt(p[1], 10) + ' 月 ' + parseInt(p[2], 10) + ' 日';
}

module.exports = {
  todayStr,
  parseDate,
  dayNum,
  fmtDate,
  pick,
  fmtRemain,
  hourBucket,
  dateStr,
  calendarOf,
  countInMonth,
  longestStreak,
  shiftMonth,
  addYears,
  mdd
};
