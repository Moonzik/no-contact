// pages/today/today.js
const storage = require('../../utils/storage.js');
const util = require('../../utils/util.js');
const guardian = require('../../utils/guardian.js');
const user = require('../../utils/user.js');
const quotes = require('../../utils/quotes.js');

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
    encourageText: ''
  },

  onShow() {
    /* v0.8.0：首页随便看，不拦登录 */
    this.refresh();
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
  },

  onCheck() {
    /* 打卡是写数据：没登录先请他去「我」页登录 */
    if (user.requireLogin('打卡需要登录一次。登录只是留个头像昵称，记录仍然只在你手机里。')) return;
    const S = storage.load();
    if (S.lastCheckIn === util.todayStr()) return;

    S.lastCheckIn = util.todayStr();
    S.checkCount++;
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
  }
});
