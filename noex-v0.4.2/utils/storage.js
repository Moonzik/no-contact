// utils/storage.js — 数据持久化（封装 wx.setStorageSync）

const LS_KEY = 'noex_mvp_v1';

/* 导入备份失败时可回退：导入前把当前数据快照到这个 key（不是第二份正式数据，只用于撤销） */
const PREV_KEY = 'noex_mvp_v1_prev';

/* 文字日记上限：一天一条，400 条 ≈ 一年多的量；单条 200 字 */
const MAX_DIARY_LEN = 200;
const MAX_DIARY_DAYS = 400;

/* 过往段最多留 20 段（每段只存摘要 + 日期列表，不存对话） */
const MAX_SEGMENTS = 20;

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
    /* v0.9.12 · 打卡日历：逐日记录，数组里放 'YYYY-MM-DD'
       ⚠️ 复发（onRelapse）只把 checkCount 归零，这两个数组是历史，不重置——
       日历要能回看"我哪几天撑住了、哪几天断了" */
    checkLog: [],
    relapseLog: [],
    persona: 'warm',
    /* v0.9.13 · 文字日记：每天最多一句话，{ d: 'YYYY-MM-DD', text: '…' }，按日期排序存 */
    diary: [],
    /* v0.9.13 · 过往的段：换断联对象（onNewSegment）时把上一段归档进来，供回看 */
    segments: [],
    /* v0.9.13 · 打卡提醒（订阅消息）：on = 用户点过订阅，at = 最近一次订阅时间戳 */
    reminder: { on: false, at: 0 },
    /* v0.9.14 · 小白页「怎么用」说明是否看过：第一次进来自动展开一次，之后默认收起 */
    xiaobaiHowtoSeen: false,
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

/* 文字日记清洗：只留 { d: 'YYYY-MM-DD', text: 非空 }, 同一天只留最后写的那条, 按日期升序 */
function sanitizeDiary(arr) {
  if (!Array.isArray(arr)) return [];
  const map = {};
  arr.forEach((it) => {
    if (!it || typeof it !== 'object') return;
    if (typeof it.d !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(it.d)) return;
    if (typeof it.text !== 'string') return;
    const t = it.text.trim();
    if (!t) return;
    map[it.d] = t.slice(0, MAX_DIARY_LEN);
  });
  return Object.keys(map).sort().map((k) => ({ d: k, text: map[k] }));
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
    /* v0.9.12 字段补全：打卡日历（老用户没有这两个数组，补空数组即可） */
    if (!Array.isArray(s.checkLog)) s.checkLog = [];
    if (!Array.isArray(s.relapseLog)) s.relapseLog = [];
    /* 打卡日期去重 + 只留合法格式，避免脏数据把日历画出多余的格子 */
    s.checkLog = s.checkLog.filter((k, i) => typeof k === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(k) && s.checkLog.indexOf(k) === i);
    s.relapseLog = s.relapseLog.filter((k, i) => typeof k === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(k) && s.relapseLog.indexOf(k) === i);
    /* v0.9.13 字段补全：文字日记（同一天只留最新一条）/ 过往段 / 提醒 */
    s.diary = sanitizeDiary(s.diary);
    if (!Array.isArray(s.segments)) s.segments = [];
    if (!s.reminder || typeof s.reminder !== 'object') s.reminder = { on: false, at: 0 };
    if (typeof s.reminder.on !== 'boolean') s.reminder.on = false;
    if (typeof s.reminder.at !== 'number') s.reminder.at = 0;
    /* v0.9.14 字段补全：小白用法说明是否看过 */
    if (typeof s.xiaobaiHowtoSeen !== 'boolean') s.xiaobaiHowtoSeen = false;
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
    /* 同样是配额保险丝：日记 / 过往段长期只增不减，久了会顶到 1024KB */
    if (S && Array.isArray(S.diary) && S.diary.length > MAX_DIARY_DAYS) {
      S.diary = S.diary.slice(-MAX_DIARY_DAYS);
    }
    if (S && Array.isArray(S.segments) && S.segments.length > MAX_SEGMENTS) {
      S.segments = S.segments.slice(-MAX_SEGMENTS);
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

/* ───────── v0.9.13 缺口二 · 备份还原 ─────────
   导入这件事的风险是「把用户现有数据覆盖掉」，所以拆成两步：
   validateBackup 只做判断（不写任何东西），applyBackup 才落盘。
   两步分开，页面才有机会在覆盖前把风险讲清楚、让用户确认。 */

/* 备份文件的特征字段：至少命中 2 个才认（防止用户随便复制一段 JSON 就点导入） */
const SIG_KEYS = ['startDate', 'checkLog', 'relapseLog', 'gMsgs', 'bottle', 'shadow', 'diary', 'persona'];

/**
 * 校验一段备份（字符串或已解析对象）
 * @returns {{ ok: boolean, reason?: string, data?: object, hits?: number, summary?: object }}
 *   reason: empty / parse / shape / not_backup
 */
function validateBackup(input) {
  let data = input;
  if (typeof input === 'string') {
    const t = input.trim();
    if (!t) return { ok: false, reason: 'empty' };
    try {
      data = JSON.parse(t);
    } catch (e) {
      return { ok: false, reason: 'parse' };
    }
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return { ok: false, reason: 'shape' };
  }
  const hits = SIG_KEYS.filter((k) => data[k] !== undefined).length;
  if (hits < 2) return { ok: false, reason: 'not_backup', hits: hits };
  if (typeof data.startDate !== 'string') return { ok: false, reason: 'shape' };

  const seg = Array.isArray(data.segments) ? data.segments : [];
  const summary = {
    startDate: data.startDate,
    checkCount: typeof data.checkCount === 'number' ? data.checkCount : (Array.isArray(data.checkLog) ? data.checkLog.length : 0),
    relapseCount: typeof data.relapses === 'number' ? data.relapses : 0,
    msgCount: Array.isArray(data.gMsgs) ? data.gMsgs.length : 0,
    bottleCount: Array.isArray(data.bottle) ? data.bottle.length : 0,
    diaryCount: Array.isArray(data.diary) ? data.diary.length : 0,
    segmentCount: seg.length,
    shadowOn: !!(data.shadow && data.shadow.enabled),
    hasUser: !!(data.user && (data.user.nick || data.user.avatar))
  };
  return { ok: true, data: data, hits: hits, summary: summary };
}

/**
 * 落盘导入。写法上刻意「先写进去再 load() 一次」——
 * load() 里已经有一整套老数据补全 / 清洗逻辑，复用它，
 * 导入旧版本备份时也能自动补齐新字段。
 */
function applyBackup(data) {
  wx.setStorageSync(LS_KEY, data);
  return load();
}

/* 导入前快照（用于「撤销导入」）。存的是字符串，省一次序列化。 */
function snapshotPrev(S) {
  try {
    wx.setStorageSync(PREV_KEY, exportJson(S || load()));
    return true;
  } catch (e) {
    return false;
  }
}

function loadPrev() {
  try {
    const raw = wx.getStorageSync(PREV_KEY);
    return raw ? String(raw) : '';
  } catch (e) {
    return '';
  }
}

function clearPrev() {
  try {
    wx.removeStorageSync(PREV_KEY);
  } catch (e) { /* ignore */ }
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
  PREV_KEY,
  MS_LIST,
  MAX_DIARY_LEN,
  defaultState,
  sanitizeDiary,
  load,
  save,
  clear,
  exportJson,
  validateBackup,
  applyBackup,
  snapshotPrev,
  loadPrev,
  clearPrev,
  initSessionTimer,
  todayStr
};
