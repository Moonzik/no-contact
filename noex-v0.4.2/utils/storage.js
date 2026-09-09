// utils/storage.js — 数据持久化（封装 wx.setStorageSync）

const LS_KEY = 'noex_mvp_v1';

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
    /* 登录态：null = 未登录；对象 = 已登录（微信头像 + 昵称，仅存本机） */
    user: null,
    /* v0.7.0 · 回复去重字典：{ "已经说过的句子": 1 }
       只有「清空数据 / 重置」才会清掉，所以用户不主动清就不会听到重复的话 */
    usedReplies: {},
    /* v0.7.0 · 首页每日一句：{ date: '2026-09-08', text: '…' }，跨天自动换 */
    daily: { date: '', text: '' },
    gMsgs: [],
    shadow: {
      enabled: false,
      name: '',
      profile: null,
      msgs: [],
      sessionsDate: '',
      sessionsToday: 0,
      sessionStart: 0,
      // ── 温水冷却 / 自我洞察（v0.4.0）──
      firstUsedAt: 0,             // 第一次进入影子聊天的时间戳（ms），0 = 未启用
      totalShadowSessions: 0,     // 累计聊天 session 数（跨天）
      affinitySnapshot: 80,       // 上次记录相似度快照（不进 UI，仅给观察用）
      revealTriggered: false,     // 是否已经触发过自我洞察面板（永久只触发一次）
      revealSeenAt: 0,            // 用户接受洞察的时间戳
      revealReason: '',           // 触发原因：no_use | declaration | long_term | affinity_floor | manual
      observation: {              // 安静观察期
        lastUsedAt: 0,            // 上次进影子聊天的时间戳
        daysWithNoUse: 0,         // 连续多少天没进过影子
        userSaidNotLikeTa: 0,     // 用户主动说"不像 ta"等关键字的次数
        recentMsgAvgLen: 0        // 用户最近消息平均长度（衰减）
      }
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
    // 字段缺失补默认（浅合并）
    for (const k in d) {
      if (s[k] === undefined) s[k] = d[k];
    }
    if (!s.startDate) s.startDate = todayStr();
    // shadow 子对象字段补默认（v0.4.0 嵌套字段补全）
    if (s.shadow && typeof s.shadow === 'object') {
      for (const k in d.shadow) {
        if (s.shadow[k] === undefined) {
          s.shadow[k] = typeof d.shadow[k] === 'object' && d.shadow[k] !== null
            ? JSON.parse(JSON.stringify(d.shadow[k]))
            : d.shadow[k];
        }
      }
      if (!s.shadow.observation || typeof s.shadow.observation !== 'object') {
        s.shadow.observation = JSON.parse(JSON.stringify(d.shadow.observation));
      }
    }
    // user 子对象字段补默认（v0.6.0 登录态；null = 未登录，是合法值不要补成对象）
    if (s.user && typeof s.user === 'object') {
      if (typeof s.user.nick !== 'string') s.user.nick = '';
      if (typeof s.user.avatar !== 'string') s.user.avatar = '';
      if (typeof s.user.loginAt !== 'number') s.user.loginAt = 0;
    } else if (s.user !== null) {
      s.user = null;
    }
    /* v0.7.0 字段补全：去重字典 + 每日一句 */
    if (!s.usedReplies || typeof s.usedReplies !== 'object') s.usedReplies = {};
    if (!s.daily || typeof s.daily !== 'object') s.daily = { date: '', text: '' };
    if (typeof s.daily.date !== 'string') s.daily.date = '';
    if (typeof s.daily.text !== 'string') s.daily.text = '';
    return s;
  } catch (e) {
    const d = defaultState();
    d.startDate = todayStr();
    return d;
  }
}

/* 单条 storage key 在微信里上限 1024 KB。
   gMsgs 是自动增长的唯一数组（约 9000 条就会撑爆 → setStorageSync 抛异常 → save 静默失败，
   此后所有数据都存不进去）。这里做保险丝：只保留最近 MAX_GMSGS 条。 */
const MAX_GMSGS = 2000;

/* 保存 */
function save(S) {
  try {
    if (S && Array.isArray(S.gMsgs) && S.gMsgs.length > MAX_GMSGS) {
      S.gMsgs = S.gMsgs.slice(-MAX_GMSGS);
      console.warn('[storage] gMsgs 超过 ' + MAX_GMSGS + ' 条，已裁剪最旧的（可用「我 → 导出」备份）');
    }
    wx.setStorageSync(LS_KEY, S);
  } catch (e) {
    /* 配额异常：再抢救一次，砍到 500 条重试 */
    try {
      if (S && Array.isArray(S.gMsgs)) S.gMsgs = S.gMsgs.slice(-500);
      wx.setStorageSync(LS_KEY, S);
      console.warn('[storage] 首次写入失败，已裁剪后重试成功');
    } catch (e2) {
      console.error('[storage] save failed', e2);
    }
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
