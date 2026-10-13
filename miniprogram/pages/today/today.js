// pages/today/today.js
const storage = require('../../utils/storage.js');
const util = require('../../utils/util.js');
const guardian = require('../../utils/guardian.js');
const user = require('../../utils/user.js');
const quotes = require('../../utils/quotes.js');
const cfg = require('../../utils/config.js');

const QUOTES = {
  morning: ['早上好。新的一天还没有被任何情绪占用。', '晨光是最好 reset。先喝口水，我们慢慢来。'],
  noon:    ['中午了，记得吃点热的东西。胃暖了，心会跟着暖一点。', '再难的日子也要好好吃饭。'],
  afternoon:['下午的光最适合发呆。走神不算浪费。', '撑到现在，已经很了不起了。'],
  evening: ['夜晚会放大情绪。别太相信夜里做出的任何决定。', '晚上了。难过的话，先来找我，别去找聊天框。'],
  late:    ['这么晚还醒着。没关系，我陪你坐一会儿。', '凌晨的心事最重。说出来，会轻一点。']
};

/* 打卡肯定语（第 1/3/7/21 天有专属，其余日子从这里轮着给，且不重复） */
const DAILY_PRAISE = [
  '又一天。你可能没觉得特别，但身体记得。',
  '今天你选择了自己一次。记下来。',
  '第 N 天不是数字，是你一次次按下那股冲动换来的。',
  '你把想说的话咽回去了。这一下很难，你做到了。',
  '今天的你，比昨天更自由一点点。',
  '不用感谢我，这是你自己撑过来的。',
  '你今天没有把时间交给一个不回头的人。做得好。',
  '哪怕今天很难熬，你也没有去找 TA。这就是进步。',
  '给自己记一笔：今天，安住。',
  '你已经不需要 TA 的回应来过完这一天了。'
];

function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

/* 分享文案：刻意做到「看不出这是什么产品」。
   这是断联日记——卡片上如果写着断联 / 前任 / 失恋，等于替用户向所有好友公开私事，
   没人敢转。所以分享出去的文字和情绪、感情都不挂钩，图片用不带字的白狐狸。
   分享路径指向引导页：老用户会被引导页自动送进首页，新用户看到完整介绍。 */
const SHARE_TITLES = [
  '把时间留给自己',
  '今天也要好好过',
  '慢一点，也没关系'
];
const SHARE_IMG = '/images/agent.png';

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
    /* 每日一句 + 肯定 */
    dailyText: '',
    praise: '',
    /* 鼓励弹层 */
    showEncourage: false,
    encourageDay: 0,
    encourageText: '',
    /* v0.9.12 · 打卡日历 */
    weekNames: ['日', '一', '二', '三', '四', '五', '六'],
    calCells: [],
    calLabel: '',
    calFoot: '',
    canPrev: false,
    canNext: false,
    /* v0.9.13 缺口二 · 文字日记 */
    taAlive: true,          // 原生 textarea 焦点中忽略 value 更新 → 重建清空（同小白/影子/留白瓶）
    diaryText: '',
    diarySaved: '',         // 今天已经存下的那一句（空 = 还没写）
    diaryCount: 0,          // 累计写过多少天
    diaryOpen: false,       // 往期是否展开
    diaryList: [],          // 往期（不含今天），新的在前
    /* v0.9.13 缺口二 · 广告位（AD_UNIT_ID 没配时为 false，整块不渲染） */
    adShow: false,
    adUnitId: ''
  },

  onShow() {
    /* v0.8.0：首页随便看，不拦登录 */
    this.refresh();
    /* 广告位：utils/config.js 里的 AD_UNIT_ID 配了才渲染，没配则整块不存在 */
    const adId = cfg.AD_UNIT_ID || '';
    this.setData({ adUnitId: adId, adShow: !!adId });
    /* 让右上角菜单里也出现「分享到朋友圈」（需要基础库 2.11.3+，低版本静默忽略） */
    try {
      if (wx.showShareMenu) {
        wx.showShareMenu({
          withShareTicket: false,
          menus: ['shareAppMessage', 'shareTimeline']
        });
      }
    } catch (e) { /* 低版本不支持，不影响其它功能 */ }
  },

  onMidnightRefresh() {
    this.refresh();
  },

  refresh() {
    const S = storage.load();
    const d = util.dayNum(S.startDate);
    const today = util.todayStr();
    const checked = S.lastCheckIn === today;
    const sub = '始于 ' + util.fmtDate(S.startDate) +
      (S.relapses > 0 ? ' · 重新开始过 ' + S.relapses + ' 次，都算数' : '');

    /* 每日一句：跨天自动换，同一天永远同一句 */
    let dailyText = (S.daily && S.daily.date === today) ? S.daily.text : '';
    if (!dailyText) {
      dailyText = quotes.dailyQuote(today, S.usedReplies);
      S.daily = { date: today, text: dailyText };
      S.usedReplies = S.usedReplies || {};
      S.usedReplies[dailyText] = 1;
      storage.save(S);
    }

    /* 肯定与鼓励：今天只要还没联系，就值得被肯定（不用等打卡） */
    const relapsedToday = S.relapses > 0 && S.startDate === today;
    let praise = '';
    if (checked) {
      praise = '今天你按住了。第 ' + d + ' 天，你做了一件很难的事。';
    } else if (relapsedToday) {
      praise = '今天断了。不等于失败——明天重新数，我陪你。';
    } else if (d >= 2) {
      praise = '到此刻为止，今天还没有联系 TA。哪怕只是「还没有」，也值得被肯定。';
    } else {
      praise = '第一天最难。你愿意开始，这已经赢了。';
    }

    let foxSay = '';
    if (d === 1 && S.relapses > 0) {
      foxSay = '没关系。第 1 天，重新来。你不是从零开始，是从经验开始。';
    } else {
      foxSay = guardian.pickUnused(QUOTES[util.hourBucket()] || QUOTES.morning, S.usedReplies);
    }
    if (S.usedReplies) S.usedReplies[foxSay] = 1;

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
      dailyText,
      praise,
      checked,
      bottleCount: S.bottle.length,
      milestones: list,
      progressPct: pct,
      nextNote,
      nextMs: nextMs ? { d: nextMs.d, n: nextMs.n } : null
    });

    this.renderCalendar(S);
    this.renderDiary(S);
  },

  /* ───────── v0.9.13 缺口二 · 文字日记 ─────────
     一天一条，写满 200 字封顶。往期只渲染列表，不做编辑——
     日记是给自己看的痕迹，改起来越麻烦越好，不然会变成反复修改的「作业」。
     当前输入框只在「今天这条还没存」时用 rebuildTextarea 清空，
     存过之后重建时会带回已存内容，方便继续补两句。 */
  renderDiary(S) {
    const today = util.todayStr();
    const list = S.diary || [];
    const mine = list.filter((it) => it.d === today)[0];
    const saved = mine ? mine.text : '';

    const past = list
      .filter((it) => it.d !== today)
      .slice()
      .reverse()
      .slice(0, 30)
      .map((it) => ({ d: it.d, label: util.mdd(it.d), text: it.text }));

    /* 输入框内容怎么定：用户正在改到一半的字不能被 refresh 冲掉。
       判据是「当前内容 ≠ 上次存过的内容」→ 说明有未保存的编辑，保留它。 */
    const prev = this._diarySaved || '';
    const typed = this.data.diaryText || '';
    const keepTyped = typed && typed !== prev;

    this.setData({
      diarySaved: saved,
      diaryCount: list.length,
      diaryList: past,
      diaryText: keepTyped ? typed : (saved || typed || '')
    });
    this._diarySaved = saved;
  },

  onDiaryInput(e) {
    this.setData({ diaryText: (e && e.detail && e.detail.value) || '' });
  },

  onDiaryBlur(e) {
    /* 某些机型 bindinput 会漏触发，失焦再同步一次 */
    if (e && e.detail && typeof e.detail.value === 'string') {
      this.setData({ diaryText: e.detail.value });
    }
  },

  onDiarySave() {
    if (user.requireLogin('写日记需要登录一次。登录只是留个头像昵称，内容仍然只在你手机里。')) return;
    const raw = (this.data.diaryText || '').trim();
    if (!raw) {
      wx.showToast({ title: '先写点什么吧', icon: 'none' });
      return;
    }
    const S = storage.load();
    const today = util.todayStr();
    if (!Array.isArray(S.diary)) S.diary = [];
    const idx = S.diary.map((it) => it.d).indexOf(today);
    const item = { d: today, text: raw.slice(0, storage.MAX_DIARY_LEN) };
    if (idx > -1) {
      const isNew = S.diary[idx].text !== item.text;
      S.diary[idx] = item;
      if (!isNew) {
        wx.showToast({ title: '和刚才一模一样，没动', icon: 'none' });
        return;
      }
    } else {
      S.diary.push(item);
    }
    storage.save(S);
    this.setData({ diarySaved: item.text });
    wx.showToast({ title: '存好了，只有你能看到', icon: 'none' });
    this.refresh();
  },

  /* 删掉今天写的。放在「往期」列表之外、单独一个小入口——不显眼，但要找得到 */
  onDiaryDeleteToday() {
    wx.showModal({
      title: '删掉今天这一句？',
      content: '删了就找不回来了。',
      confirmText: '删掉',
      confirmColor: '#b5563f',
      success: (r) => {
        if (!r.confirm) return;
        const S = storage.load();
        const today = util.todayStr();
        S.diary = (S.diary || []).filter((it) => it.d !== today);
        storage.save(S);
        this.rebuildDiaryBox();
        wx.showToast({ title: '已删掉', icon: 'none' });
        this.refresh();
      }
    });
  },

  onToggleDiary() {
    this.setData({ diaryOpen: !this.data.diaryOpen });
  },

  /* 清空日记输入框：同小白 / 影子 / 留白瓶的原生 textarea 坑——
     组件持有焦点时会忽略 value 更新，必须卸掉重建才拿得到新值 */
  rebuildDiaryBox() {
    this.setData({ diaryText: '', taAlive: false });
    setTimeout(() => {
      this.setData({ taAlive: true });
    }, 100);
  },

  /* 点日历格子：有日记的那天弹出来看看（这是「回看」最自然的入口） */
  onCalTap(e) {
    const ds = e && e.currentTarget && e.currentTarget.dataset
      ? e.currentTarget.dataset.d : '';
    if (!ds) return;
    const S = storage.load();
    const it = (S.diary || []).filter((x) => x.d === ds)[0];
    if (!it) return;
    wx.showModal({
      title: util.mdd(ds) + ' 写的',
      content: it.text,
      showCancel: false,
      confirmText: '知道了'
    });
  },

  /* 广告位加载失败（没开通流量主 / 广告拉不到）不打扰用户，只在控制台留个痕 */
  onAdError(e) {
    console.warn('[today] 广告位加载失败（多为流量主未开通或暂无广告填充）', e && e.detail);
  },

  /* ───────── v0.9.12 · 打卡日历 ─────────
     每次打卡 / 复发都会往 checkLog / relapseLog 里记一个日期，
     这里把当前显示月份的记录铺成 7 列网格。
     单独成函数是为了让「翻月」只重算日历，不重跑整个 refresh
     （refresh 会消耗掉一句小白开场白，翻个月就换一句话太跳了）。 */
  renderCalendar(S) {
    const today = util.todayStr();
    if (!this._calYM) {
      const p = today.split('-');
      this._calYM = { y: parseInt(p[0], 10), m: parseInt(p[1], 10) };
    }
    const ym = this._calYM;

    const checkMap = {};
    (S.checkLog || []).forEach((k) => { checkMap[k] = 1; });
    const relMap = {};
    (S.relapseLog || []).forEach((k) => { relMap[k] = 1; });
    /* v0.9.13：写过日记的日子在格子上点一个小点（不是状态，是痕迹） */
    const noteMap = {};
    (S.diary || []).forEach((it) => { if (it && it.d) noteMap[it.d] = 1; });

    const cells = util.calendarOf(ym.y, ym.m, checkMap, relMap, today, noteMap);
    const onDays = util.countInMonth(checkMap, ym.y, ym.m);
    const relDays = util.countInMonth(relMap, ym.y, ym.m);
    const streak = util.longestStreak(S.checkLog || []);

    /* 一句人话总结：只陈述事实，不加压力 */
    let foot = '';
    if (onDays > 0) {
      foot = '亮起 ' + onDays + ' 天';
      if (relDays > 0) foot += ' · 断过 ' + relDays + ' 天';
      if (streak > 1) foot += ' · 最长连着 ' + streak + ' 天';
    } else if (relDays > 0) {
      foot = '这个月断过 ' + relDays + ' 天，别的格子还空着';
    } else if (S.checkCount > 0) {
      /* 老用户升级上来：以前的打卡只有总数没有日期，说清楚免得以为丢数据 */
      foot = '日历从这次更新后开始记，之后每天点亮一格';
    } else {
      foot = '每天打卡，这里就会亮起一格';
    }

    /* 能翻到多早：不早于最早那条记录所在的月 */
    const earliest = [S.startDate].concat(S.checkLog || [], S.relapseLog || [])
      .filter(Boolean).sort()[0] || today;
    const eP = earliest.split('-');
    const tP = today.split('-');
    const canPrev = !(ym.y === parseInt(eP[0], 10) && ym.m === parseInt(eP[1], 10));
    const canNext = !(ym.y === parseInt(tP[0], 10) && ym.m === parseInt(tP[1], 10));

    this.setData({
      calCells: cells,
      calLabel: ym.y + ' 年 ' + ym.m + ' 月',
      calFoot: foot,
      canPrev: canPrev,
      canNext: canNext
    });
  },

  onCalPrev() {
    if (!this.data.canPrev) return;
    this._calYM = util.shiftMonth(this._calYM.y, this._calYM.m, -1);
    this.renderCalendar(storage.load());
  },

  onCalNext() {
    if (!this.data.canNext) return;
    this._calYM = util.shiftMonth(this._calYM.y, this._calYM.m, 1);
    this.renderCalendar(storage.load());
  },

  onCheck() {
    /* 打卡是写数据：没登录先请他去「我」页登录 */
    if (user.requireLogin('打卡需要登录一次。登录只是留个头像昵称，记录仍然只在你手机里。')) return;
    const S = storage.load();
    if (S.lastCheckIn === util.todayStr()) return;

    const today = util.todayStr();
    S.lastCheckIn = today;
    S.checkCount++;
    /* v0.9.12：逐日记录，供打卡日历回看（同一天不会记两次） */
    if (!Array.isArray(S.checkLog)) S.checkLog = [];
    if (S.checkLog.indexOf(today) === -1) S.checkLog.push(today);
    const d = util.dayNum(S.startDate);

    /* 把鼓励写进小白对话，等用户去小白页能看到 */
    const enc = guardian.ENCOURAGE[d] || guardian.pickUnused(DAILY_PRAISE, S.usedReplies);
    if (enc) {
      S.gMsgs.push({
        role: 'sys',
        text: '· 第 ' + d + ' 天 ·\n' + enc,
        t: Date.now()
      });
      S.usedReplies = S.usedReplies || {};
      S.usedReplies[enc] = 1;
    }
    storage.save(S);
    wx.showToast({ title: '安住今天 · 第 ' + d + ' 天', icon: 'none' });
    /* 首页直接给一句肯定——不用跑去小白页才看得到 */
    this.setData({ showEncourage: true, encourageDay: d, encourageText: enc });
    this.refresh();
  },

  onCloseEncourage() {
    this.setData({ showEncourage: false });
  },

  onRelapse() {
    if (user.requireLogin('记录一次「没忍住」需要登录一次。')) return;
    console.log('[today] onRelapse clicked');
    const S = storage.load();

    /* 毒舌语录池 22 条——一键断签后，小白会先骂两句。
       原则：戳行为/戳依赖/戳错觉，但留一线"明天重新做人"的余地 */
    const SHARP_REPLY = [
      '又没忍住？我就知道你这手迟早要犯贱。今天从 1 开始重新数，慢慢来，反正你也习惯了。',
      '看你这点出息。明天顶着肿眼泡去上班，被同事问起来记得说"我没事"——看你能演多久。',
      '手机给我先，我替你没收两小时。不，算了，反正你拿回去了也白搭。',
      '嗯，联系了。舒服了？舒服完记得回来打卡，我这儿不欢迎半途而废的人。',
      '你以为你联系了就会好受吗？三天后你会后悔的——到时候别来找我哭，我嫌吵。',
      '我本来想夸你一句，话到嘴边咽回去了。因为你又破戒了。下次再聊。',
      '又一段可以拿出来当笑话讲的日子。行，记下了，计数归零，我等你下一次的笑话。',
      '我见过戒十次又破十次的人，你是下一个吗？——不，你已经是了。',
      '你以为 TA 看了会心软吗？ TA 只会觉得你烦，顺手把你设成"消息免打扰"。',
      '这次先骂你两句。下次再没忍住，我骂得更狠——记着。我说话算话。',
      '戒不断就先别戒了——但别来找我，我不爱看笑话。',
      '嗯，没关系，又破了一次。我等你下次戒到第三天再来找我吹牛，目前纪录为零。',
      '我替你说一句你不敢对自己说的话：你就是舍不得 TA。行了吧，承认吧。',
      '行，这次放过你。但下次再点这个按钮，我会骂得比今天更难听——到时候别委屈。',
      '今天就先这样，明天重新做人。你能做的，我也只能帮你到这里，剩下的看你自己。',
      '你以为这一次是"最后一次联系"？上次也是这么说的——别打脸太快，行吗。',
      '你给自己写的"再也不联系了"那张便签还在不在？在——撕了吧，留着打脸用的吗。',
      '你今天给 TA 发了几条消息？ TA 回了你几条？你心里有数，我就不替你算了。',
      '我猜你正在等一个"对方也回你了"的奇迹发生——不会的，行，你看手机吧，我等你失望。',
      '你这次断签不是因为 TA,是因为你自己心里那根弦断了。承认了，我们从 1 开始。',
      '别跟我说"只是随便聊聊"——随便聊聊十次的你，今天第几次随便了?',
      '你要是明天又来找我，我会嘲笑你。但我会接待你。这是我能给的最多，你拿走。'
    ];
    const rawSharp = guardian.pickUnused(SHARP_REPLY, S.usedReplies);
    const line = '哼，' + rawSharp;
    S.usedReplies = S.usedReplies || {};
    S.usedReplies[rawSharp] = 1;

    /* 写到小白对话里：系统提示 + 一句毒舌 */
    const now = Date.now();
    S.gMsgs.push({
      role: 'sys',
      text: '（' + util.todayStr() + ' · 你没忍住，联系了。计数已重置为 1 天。）',
      t: now
    });
    S.gMsgs.push({
      role: 'ai',
      text: line,
      t: now + 1
    });

    /* 断签：重置 startDate，relapses++ */
    S.startDate = util.todayStr();
    S.lastCheckIn = '';
    S.checkCount = 0;
    S.relapses++;
    /* v0.9.12：复发也记进日历。注意 checkLog 不重置——
       计数归零是让用户重新开始，日历是历史，要能回看哪几天撑住了、哪几天断了 */
    if (!Array.isArray(S.relapseLog)) S.relapseLog = [];
    if (S.relapseLog.indexOf(S.startDate) === -1) S.relapseLog.push(S.startDate);
    storage.save(S);

    wx.showToast({
      title: '断了 · 去小白那儿被骂两句',
      icon: 'none',
      duration: 2000
    });
    this.refresh();
  },

  onShowBottle() {
    wx.navigateTo({ url: '/pages/bottle/bottle' });
  },

  onBottleWrite() {
    /* 写留白瓶是写数据；只看（onShowBottle）不用登录 */
    if (user.requireLogin('往留白瓶里写东西需要登录一次。')) return;
    wx.navigateTo({ url: '/pages/bottle/bottle' });
  },

  noop() {},

  onChatXiaoBai() {
    wx.switchTab({ url: '/pages/xiaobai/xiaobai' });
  },

  /* 分享给好友 / 朋友圈。
     两个都返回中性文案：不出现断联、天数、TA 的代号，别人从卡片上看不出用户在经历什么。 */
  onShareAppMessage() {
    return {
      title: pick(SHARE_TITLES),
      path: '/pages/onboard/onboard',
      imageUrl: SHARE_IMG
    };
  },

  onShareTimeline() {
    return {
      title: pick(SHARE_TITLES),
      imageUrl: SHARE_IMG
    };
  }
});
