// utils/storage.js — 数据持久化（封装 wx.setStorageSync）

const LS_KEY = 'liubai_mvp_v1';

/* 里程碑刻度 */
const MS_LIST = [
  { d: 1,   n: '起步' },
  { d: 3,   n: '初雪' },
  { d: 7,   n: '一周' },
  { d: 21,  n: '习惯' },
  { d: 30,  n: '满月' },
  { d: 60,  n: '双月' },
  { d: 90,  n: '一季' },
  { d: 180, n: '半年' },
  { d: 365, n: '一年' }
];

/* 默认状态 */
function defaultState() {
  return {
    onboarded: false,
    startDate: '',
    exName: '',
    lastCheckIn: '',
    checkCount: 0,
    relapses: 0,
    persona: 'warm',
    gMsgs: [],
    shadow: {
      enabled: false,
      name: '',
      profile: null,
      msgs: [],
      sessionsDate: '',
      sessionsToday: 0,
      sessionStart: 0
    },
    bottle: []
  };
}

/* 加载：返回当前状态（不存在则返回默认状态，且写入） */
function load() {
  try {
    const raw = wx.getStorageSync(LS_KEY);
    if (!raw) {
      const d = defaultState();
      d.startDate = todayStr();
      wx.setStorageSync(LS_KEY, d);
      return d;
    }
    const s = raw;
    const d = defaultState();
    // 字段缺失补默认
    for (const k in d) {
      if (s[k] === undefined) s[k] = d[k];
    }
    if (!s.startDate) s.startDate = todayStr();
    return s;
  } catch (e) {
    const d = defaultState();
    d.startDate = todayStr();
    return d;
  }
}

/* 保存 */
function save(S) {
  try {
    wx.setStorageSync(LS_KEY, S);
  } catch (e) {
    console.warn('[storage] save failed', e);
  }
}

/* 清空 */
function clear() {
  try {
    wx.removeStorageSync(LS_KEY);
  } catch (e) {}
}

/* 导出 JSON（小程序里没法直接下载，用 wx.setStorage 暂存到全局，让用户手动复制） */
function exportJson(S) {
  return JSON.stringify(S, null, 2);
}

/* 跨天定时器：回到 today 时检查是否需要刷新 */
let sessionTimer = null;
function initSessionTimer() {
  if (sessionTimer) clearInterval(sessionTimer);
  sessionTimer = setInterval(() => {
    // 主动发全局事件，让 today 页响应
    const pages = getCurrentPages ? getCurrentPages() : [];
    if (pages && pages.length) {
      const top = pages[pages.length - 1];
      if (top && top.onMidnightRefresh) top.onMidnightRefresh();
    }
  }, 60000);
}

/* 工具：兼容地引入 todayStr（避免循环引用） */
function todayStr() {
  const d = new Date();
  return d.getFullYear() + '-' +
    ('0' + (d.getMonth() + 1)).slice(-2) + '-' +
    ('0' + d.getDate()).slice(-2);
}

module.exports = {
  LS_KEY,
  MS_LIST,
  defaultState,
  load,
  save,
  clear,
  exportJson,
  initSessionTimer,
  todayStr
};
