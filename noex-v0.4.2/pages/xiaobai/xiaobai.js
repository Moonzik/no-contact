// pages/xiaobai/xiaobai.js
const storage = require('../../utils/storage.js');
const util = require('../../utils/util.js');
const guardian = require('../../utils/guardian.js');
const user = require('../../utils/user.js');
const ai = require('../../utils/ai.js');

const CHIPS = ['我想ta了', '睡不着', '今天差点想联系ta', '我就是想说说'];

Page({
  data: {
    agentImg: '/images/agent.png',
    personas: [],
    personaOn: '',
    personaDesc: '',
    msgs: [],
    text: '',
    chips: CHIPS,
    status: '一直都在',
    day: 1,
    crisis: false,
    crisisText: '',
    /* v0.7.0：聊天区可视高度（px），0 = 交给 CSS 兜底 */
    winH: 0,
    /* v0.7.0：scroll-view 滚动锚点（指向最后一条消息的 id） */
    anchor: ''
  },

  _msgSeq: 0,

  onLoad() {
    /* v0.7.0：用系统给的 windowHeight（不含 tabBar）做聊天区高度。
       以前用 100vh —— 在 tabBar 页面里 100vh 会把底部输入框顶出屏幕。 */
    let h = 0;
    try {
      if (typeof wx !== 'undefined' && typeof wx.getSystemInfoSync === 'function') {
        const sys = wx.getSystemInfoSync();
        h = (sys && sys.windowHeight) || 0;
      }
    } catch (e) { h = 0; }
    this.setData({ winH: h || 0 });
  },

  onShow() {
    /* v0.8.0：聊天记录可以看，只有「发消息」才要登录 */
    this.refresh();
  },

  onMidnightRefresh() {
    this.refresh();
  },

  refresh() {
    const S = storage.load();
    const personas = Object.keys(guardian.PERSONAS).map((k) => ({
      k,
      name: guardian.PERSONAS[k].name,
      desc: guardian.PERSONAS[k].desc,
      on: S.persona === k
    }));

    const msgs = S.gMsgs.map((m, i) => {
      const f = this.fmtMsg(m);
      f._k = i; /* 稳定渲染 key（原 wx:key="t"，但 fmtMsg 根本没返回 t） */
      return f;
    });
    /* 首次进入给个开场 */
    if (msgs.length === 0) {
      const introText = '我是小白。这里说的话不会去任何地方——你可以不坚强，也可以说不清楚。今天，是第 ' + util.dayNum(S.startDate) + ' 天。';
      msgs.push({ role: 'ai', avatar: this.data.agentImg, text: introText, _k: 0 });
      S.gMsgs.push({ role: 'ai', text: introText, t: Date.now() });
      storage.save(S);
    }
    this._msgSeq = msgs.length;

    this.setData({
      personas,
      personaOn: S.persona,
      personaDesc: guardian.PERSONAS[S.persona].desc,
      msgs,
      day: util.dayNum(S.startDate)
    });
    /* 进页面就贴到底部：不然老用户一进来看到的是几个月前的对话 */
    this.scrollToBottom();
  },

  fmtMsg(m) {
    if (m.role === 'sys') {
      return { role: 'sys', text: m.text };
    }
    if (m.role === 'ai') {
      return {
        role: 'ai',
        avatar: this.data.agentImg,
        text: m.text,
        tip: m.tip || ''
      };
    }
    return { role: 'me', text: m.text };
  },

  onPickPersona(e) {
    const k = e.currentTarget.dataset.k;
    const S = storage.load();
    if (S.persona !== k) {
      S.persona = k;
      S.gMsgs.push({
        role: 'sys',
        text: '（小白换了一种语气：「' + guardian.PERSONAS[k].name + '」）',
        t: Date.now()
      });
      storage.save(S);
    }
    this.refresh();
    this.scrollToBottom();
  },

  onInput(e) {
    this.setData({ text: e.detail.value || '' });
  },

  onBlur(e) {
    /* 失焦时也同步一次，防止某些机型 bindinput 漏触发 */
    if (e && e.detail && typeof e.detail.value === 'string') {
      this.setData({ text: e.detail.value });
    }
  },

  onTapChip(e) {
    const c = e.currentTarget.dataset.c;
    this.send(c);
  },

  onSend(e) {
    /* form submit 兜底：即使 textarea 的 bindinput 没触发，
       也能从 form 拿不到 value，所以仍然读 this.data.text */
    console.log('[xiaobai] onSend, data.text =', JSON.stringify(this.data.text));
    this.send(this.data.text);
  },

  send(rawText) {
    if (user.requireLogin('和小白说话需要登录一次。登录只是留个头像昵称，对话仍然只在你手机里。')) return;
    const text = (rawText || '').trim();
    if (!text) {
      wx.showToast({ title: '说点什么吧', icon: 'none', duration: 1200 });
      return;
    }

    const S = storage.load();
    S.gMsgs.push({ role: 'me', text, t: Date.now() });
    storage.save(S);
    this.setData({ text: '' });

    /* 把 me 消息 + 打字占位一起 push 到页面，缺一会导致用户看不到自己发的字 */
    const meMsg = { role: 'me', text, _k: this._msgSeq++ };
    const typingMsg = {
      role: 'ai-temp',
      avatar: this.data.agentImg,
      text: '',
      _k: this._msgSeq++
    };
    const msgs = this.data.msgs.concat([meMsg, typingMsg]);
    this.setData({ msgs });
    this.scrollToBottom();

    /* v0.7.0：把去重字典传进去，保证清空数据前不会说出重复的话
       v0.9.0：先算好本地兜底，再尝试 AI；AI 没配 / 超时 / 出错就用本地的 */
    S.usedReplies = S.usedReplies || {};
    const localReply = guardian.guardianReply(text, S.persona, S.bottle, S.usedReplies);
    storage.save(S);

    /* 危机永远走本地：不交给大模型判断，也不等网络 */
    if (localReply.crisis) {
      this.renderReply(localReply.text, true, 600);
      return;
    }

    const t0 = Date.now();
    const baseDelay = 700 + Math.random() * 600;
    ai.chat({
      text: text,
      persona: S.persona,
      history: S.gMsgs,
      day: util.dayNum(S.startDate)
    }, (err, aiText) => {
      /* AI 迟迟不回时至少保留原本的打字停顿，不会「啪」地一下弹出来 */
      const wait = Math.max(0, baseDelay - (Date.now() - t0));
      this.renderReply(aiText || localReply.text, false, wait);
    });
  },

  /* v0.9.0：抽出来统一渲染。重新读一次存储，避免连发消息时互相覆盖丢消息 */
  renderReply(text, crisis, wait) {
    setTimeout(() => {
      const S2 = storage.load();
      const filtered = this.data.msgs.filter((m) => m.role !== 'ai-temp');
      filtered.push({
        role: 'ai',
        avatar: this.data.agentImg,
        text: text,
        _k: this._msgSeq++
      });
      S2.gMsgs.push({ role: 'ai', text: text, t: Date.now() });
      S2.usedReplies = S2.usedReplies || {};
      S2.usedReplies[text] = 1;
      storage.save(S2);
      if (crisis) {
        this.setData({ msgs: filtered, crisis: true, crisisText: this.getCrisisText() });
      } else {
        this.setData({ msgs: filtered });
      }
      this.scrollToBottom();
    }, wait || 0);
  },

  getCrisisText() {
    return '请让真实的人现在陪着你\n\n' +
      '· 全国 24 小时心理援助热线：400-161-9995\n' +
      '· 北京心理危机研究与干预中心：010-82951332\n' +
      '· 紧急情况请直接拨打 120 / 110\n\n' +
      '你的痛苦是真实的，值得被认真对待。小白在乎你，但此刻你更需要身边的具体的人。';
  },

  onCloseCrisis() {
    this.setData({ crisis: false, crisisText: '' });
  },

  /* wxml 里 catchtap="noop" 的空处理器（弹窗内层阻止冒泡用） */
  noop() {},

  /* v0.7.0：滚到底 —— 用 scroll-into-view 指向最后一条消息的 id。
     以前用 wx.pageScrollTo：消息在 scroll-view 里，页面本身不滚动，所以完全没用，
     用户只能手动往下划才能看到新消息和输入框。 */
  scrollToBottom() {
    const msgs = this.data.msgs;
    if (!msgs || !msgs.length) return;
    const last = msgs[msgs.length - 1];
    setTimeout(() => {
      this.setData({ anchor: 'm' + last._k });
    }, 30);
  }
});
