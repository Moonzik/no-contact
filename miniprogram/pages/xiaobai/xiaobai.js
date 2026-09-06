// pages/xiaobai/xiaobai.js
const storage = require('../../utils/storage.js');
const util = require('../../utils/util.js');
const guardian = require('../../utils/guardian.js');

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
    crisisText: ''
  },

  onShow() {
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

    const msgs = S.gMsgs.map((m) => this.fmtMsg(m));
    /* 首次进入给个开场 */
    if (msgs.length === 0) {
      msgs.push({
        role: 'ai',
        avatar: this.data.agentImg,
        text: '我是小白。这里说的话不会去任何地方——你可以不坚强，也可以说不清楚。今天，是第 ' + util.dayNum(S.startDate) + ' 天。'
      });
      S.gMsgs.push({
        role: 'ai',
        text: msgs[msgs.length - 1].text,
        t: Date.now()
      });
      storage.save(S);
    }

    this.setData({
      personas,
      personaOn: S.persona,
      personaDesc: guardian.PERSONAS[S.persona].desc,
      msgs,
      day: util.dayNum(S.startDate)
    });
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
    this.setData({ text: e.detail.value });
  },

  onTapChip(e) {
    const c = e.currentTarget.dataset.c;
    this.send(c);
  },

  onSend() {
    this.send(this.data.text);
  },

  send(rawText) {
    const text = (rawText || '').trim();
    if (!text) return;

    const S = storage.load();
    S.gMsgs.push({ role: 'me', text, t: Date.now() });
    storage.save(S);
    this.setData({ text: '' });

    /* 显示打字动画（用 sys-temp 消息占位） */
    const typingMsg = {
      role: 'ai-temp',
      avatar: this.data.agentImg,
      text: ''
    };
    const msgs = this.data.msgs.concat([typingMsg]);
    this.setData({ msgs });
    this.scrollToBottom();

    const reply = guardian.guardianReply(text, S.persona, S.bottle);

    setTimeout(() => {
      const filtered = this.data.msgs.filter((m) => m.role !== 'ai-temp');
      if (reply.crisis) {
        filtered.push({
          role: 'ai',
          avatar: this.data.agentImg,
          text: reply.text
        });
        S.gMsgs.push({ role: 'ai', text: reply.text, t: Date.now() });
        storage.save(S);
        this.setData({ msgs: filtered, crisis: true, crisisText: this.getCrisisText() });
      } else {
        filtered.push({
          role: 'ai',
          avatar: this.data.agentImg,
          text: reply.text
        });
        S.gMsgs.push({ role: 'ai', text: reply.text, t: Date.now() });
        storage.save(S);
        this.setData({ msgs: filtered });
      }
      this.scrollToBottom();
    }, 700 + Math.random() * 600);
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

  scrollToBottom() {
    /* 异步等 DOM 更新 */
    setTimeout(() => {
      wx.pageScrollTo({
        scrollTop: 99999,
        duration: 120
      });
    }, 30);
  }
});
