// pages/today/today.js
const storage = require('../../utils/storage.js');
const util = require('../../utils/util.js');
const guardian = require('../../utils/guardian.js');

const QUOTES = {
  morning: ['早上好。新的一天还没有被任何情绪占用。', '晨光是最好 reset。先喝口水，我们慢慢来。'],
  noon:    ['中午了，记得吃点热的东西。胃暖了，心会跟着暖一点。', '再难的日子也要好好吃饭。'],
  afternoon:['下午的光最适合发呆。走神不算浪费。', '撑到现在，已经很了不起了。'],
  evening: ['夜晚会放大情绪。别太相信夜里做出的任何决定。', '晚上了。难过的话，先来找我，别去找聊天框。'],
  late:    ['这么晚还醒着。没关系，我陪你坐一会儿。', '凌晨的心事最重。说出来，会轻一点。']
};

function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

Page({
  data: {
    day: 1,
    subText: '',
    headTag: '',
    foxSay: '',
    checked: false,
    bottleCount: 0,
    agentImg: '/images/agent.png',
    /* milestones */
    milestones: [],
    progressPct: 0,
    nextNote: '',
    nextMs: null,
    /* 鼓励弹层 */
    showEncourage: false,
    encourageDay: 0,
    encourageText: ''
  },

  onShow() {
    this.refresh();
  },

  onMidnightRefresh() {
    this.refresh();
  },

  refresh() {
    const S = storage.load();
    const d = util.dayNum(S.startDate);
    const checked = S.lastCheckIn === util.todayStr();
    const sub = '始于 ' + util.fmtDate(S.startDate) +
      (S.relapses > 0 ? ' · 重新开始过 ' + S.relapses + ' 次，都算数' : '');

    let foxSay = '';
    if (d === 1 && S.relapses > 0) {
      foxSay = '没关系。第 1 天，重新来。你不是从零开始，是从经验开始。';
    } else {
      foxSay = pick(QUOTES[util.hourBucket()] || QUOTES.morning);
    }

    /* milestones */
    const list = storage.MS_LIST.map((m) => {
      let cls = 'ms';
      if (d >= m.d) cls = 'ms done';
      return { d: m.d, n: m.n, cls };
    });
    let nextMs = null;
    let prev = 0;
    let pct = 0;
    for (let i = 0; i < storage.MS_LIST.length; i++) {
      const m = storage.MS_LIST[i];
      if (m.d > d && !nextMs) nextMs = m;
    }
    for (let i = 0; i < storage.MS_LIST.length; i++) {
      if (storage.MS_LIST[i].d < d) prev = storage.MS_LIST[i].d;
    }
    pct = nextMs
      ? Math.min(100, ((d - prev) / (nextMs.d - prev)) * 100)
      : 100;
    const nextNote = nextMs
      ? '距离「' + nextMs.n + '」（' + nextMs.d + ' 天）还有 ' + (nextMs.d - d) + ' 天'
      : '你已经走完了所有刻度。剩下的路，是你自己的了。';

    this.setData({
      day: d,
      subText: sub,
      headTag: '不联系的第 ' + d + ' 天',
      foxSay,
      checked,
      bottleCount: S.bottle.length,
      milestones: list,
      progressPct: pct,
      nextNote,
      nextMs: nextMs ? { d: nextMs.d, n: nextMs.n } : null
    });
  },

  onCheck() {
    const S = storage.load();
    if (S.lastCheckIn === util.todayStr()) return;

    S.lastCheckIn = util.todayStr();
    S.checkCount++;
    const d = util.dayNum(S.startDate);

    /* 把鼓励写进小白对话，等用户去小白页能看到 */
    const enc = guardian.ENCOURAGE[d];
    if (enc) {
      S.gMsgs.push({
        role: 'sys',
        text: '· 第 ' + d + ' 天 ·\n' + enc,
        t: Date.now()
      });
    }
    storage.save(S);
    wx.showToast({ title: '安住今天 · 第 ' + d + ' 天', icon: 'none' });
    this.refresh();
  },

  onRelapse() {
    wx.showModal({
      title: '没关系，先停一下',
      content: '联系了不是失败，是戒断过程里很常见的一步。你可以选择重新计数，也可以只是记录下来——两种都被允许。',
      confirmText: '从今天重新开始',
      cancelText: '只是记录一下',
      confirmColor: '#26231e',
      success: (res) => {
        const S = storage.load();
        if (res.confirm) {
          S.startDate = util.todayStr();
          S.lastCheckIn = '';
          S.checkCount = 0;
          S.relapses++;
          storage.save(S);
          wx.showToast({ title: '第 1 天，重新来', icon: 'none' });
          this.refresh();
        } else if (res.cancel) {
          S.relapses++;
          storage.save(S);
          wx.showToast({ title: '已记下。这不是失败', icon: 'none' });
        }
      }
    });
  },

  onShowBottle() {
    wx.navigateTo({ url: '/pages/bottle/bottle' });
  },

  onBottleWrite() {
    wx.navigateTo({ url: '/pages/bottle/bottle' });
  },

  onChatXiaoBai() {
    wx.switchTab({ url: '/pages/xiaobai/xiaobai' });
  }
});
