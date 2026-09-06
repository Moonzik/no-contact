// pages/yingzi/yingzi.js
const storage = require('../../utils/storage.js');
const util = require('../../utils/util.js');
const guardian = require('../../utils/guardian.js');
const shadow = require('../../utils/shadow.js');
const wechat = require('../../utils/wechat.js');

Page({
  data: {
    mode: 'view', // view | setup | analyze | chat
    agentImg: '/images/agent.png',

    /* setup */
    shName: '',
    shLog: '',
    shFile: '',
    shSpeakers: [],
    shSel: '',
    shParseInfo: '',

    /* analyze */
    analyzeStep: 0,
    analyzeSteps: ['正在读取聊天记录…', '识别口头禅与语气词…', '分析回复节奏…', '生成影子…'],

    /* view (enabled) */
    shadowName: '',
    profileText: '',
    used: 0,
    maxDay: shadow.SHADOW_MAX_DAY,
    canEnter: true,

    /* chat */
    msgs: [],
    remain: '--:--',
    text: '',
    leftToday: 0,
    remainingSessionMs: shadow.SHADOW_MS,

    /* session-end 提示 */
    sessionEnd: false,

    /* crisis */
    crisis: false,
    crisisText: ''
  },

  _tyingTimer: null,
  _userCount: 0,
  _parseCache: null,

  onShow() {
    this.refresh();
  },

  onUnload() {
    if (this._tyingTimer) clearInterval(this._tyingTimer);
  },

  refresh() {
    const S = storage.load();
    const mode = S.shadow.enabled ? 'view' : 'view'; // 不变
    const used = this.utilShadowSessionsToday(S.shadow);
    const canEnter = used < shadow.SHADOW_MAX_DAY;
    this.setData({
      mode,
      shadowName: S.shadow.name || '',
      profileText: S.shadow.profile ? shadow.profileSummary(S.shadow.profile) : '',
      used,
      canEnter,
      shName: S.shadow.name || S.exName || ''
    });
  },

  utilShadowSessionsToday(sh) {
    if (sh.sessionsDate !== util.todayStr()) {
      sh.sessionsDate = util.todayStr();
      sh.sessionsToday = 0;
      storage.save(storage.load());
    }
    return sh.sessionsToday;
  },

  /* view → setup */
  onStart() {
    const S = storage.load();
    this.setData({
      mode: 'setup',
      shName: S.shadow.name || S.exName || '',
      shLog: '',
      shFile: '',
      shSpeakers: [],
      shSel: '',
      shParseInfo: ''
    });
  },

  onNameInput(e) {
    this.setData({ shName: e.detail.value });
  },

  onLogInput(e) {
    this.setData({ shLog: e.detail.value });
  },

  /* 从微信选择聊天记录文件 */
  onPickFile() {
    const self = this;
    wx.chooseMessageFile({
      count: 1,
      type: 'file',
      success: (res) => {
        const f = (res.tempFiles && res.tempFiles[0]) || {};
        const path = f.path;
        const name = f.name || '文件';
        if (!path) {
          wx.showToast({ title: '没有拿到文件路径', icon: 'none' });
          return;
        }
        if (!/\.(txt|html|htm|log|csv)$/i.test(name)) {
          wx.showToast({ title: '请选 txt 或 html', icon: 'none' });
          return;
        }
        self.setData({ shFile: '正在读取 ' + name + '…' });
        const fs = wx.getFileSystemManager();
        fs.readFile({
          filePath: path,
          success: (r) => {
            try {
              const text = wechat.decodeChatFile(r.data);
              const result = wechat.parseWeChatLog(text);
              self._parseCache = result;
              const sel = wechat.defaultShadowSpeaker(result);
              const content = sel
                ? (result.byName[sel] || []).join('\n')
                : result.cleaned;
              const cnt = content
                ? content.split(/\n+/).filter(Boolean).length
                : 0;
              self.setData({
                shLog: content,
                shFile: name + ' · 读到 ' + cnt + ' 条消息',
                shSpeakers: ['全部'].concat(result.speakers),
                shSel: sel || ''
              });
              if (!content || content.trim().length < 20) {
                wx.showToast({ title: '文件内容较少，建议直接粘贴', icon: 'none' });
              }
            } catch (e) {
              self.setData({ shFile: '解析失败，试试直接粘贴' });
              wx.showToast({ title: '解析失败：' + (e.message || ''), icon: 'none' });
            }
          },
          fail: () => {
            self.setData({ shFile: '读取失败，试试直接粘贴' });
          }
        });
      },
      fail: () => {
        // 用户取消，不报错
      }
    });
  },

  onPickSpeaker(e) {
    const sp = e.currentTarget.dataset.sp;
    const r = this._parseCache;
    if (!r) return;
    const content =
      sp === '全部' || !r.byName[sp] ? r.cleaned : r.byName[sp].join('\n');
    this.setData({ shSel: sp, shLog: content });
  },

  /* setup → analyze */
  onGoAnalyze() {
    const log = (this.data.shLog || '').trim();
    const name = (this.data.shName || '').trim();
    if (log.length < 20) {
      wx.showToast({ title: '多粘贴一些聊天记录，至少几行', icon: 'none' });
      return;
    }
    const S = storage.load();
    S.shadow.name = name || '影子';
    storage.save(S);
    this.setData({
      mode: 'analyze',
      analyzeStep: 0
    });
    this.runAnalyze(log);
  },

  runAnalyze(log) {
    const self = this;
    const steps = this.data.analyzeSteps;
    let i = 0;
    const tick = setInterval(() => {
      i++;
      if (i < steps.length) {
        self.setData({ analyzeStep: i });
      } else {
        clearInterval(tick);
        const S = storage.load();
        S.shadow.profile = shadow.analyzeChat(log);
        S.shadow.enabled = true;
        storage.save(S);
        self.setData({ mode: 'view' });
        wx.showToast({ title: '影子已生成', icon: 'none' });
        self.refresh();
      }
    }, 700);
  },

  onCancelSetup() {
    this.setData({ mode: 'view' });
  },

  /* view(enabled) → chat */
  onEnterChat() {
    const S = storage.load();
    const used = S.shadow.sessionsToday || 0;
    if (used >= shadow.SHADOW_MAX_DAY) {
      wx.showToast({ title: '今天影子次数用完了', icon: 'none' });
      return;
    }
    S.shadow.sessionsToday = used + 1;
    S.shadow.sessionStart = Date.now();
    S.shadow.msgs = [];
    storage.save(S);
    this.setData({ mode: 'chat', text: '', remainingSessionMs: shadow.SHADOW_MS });
    this.renderChat();
  },

  onResetShadow() {
    wx.showModal({
      title: '关闭影子？',
      content: '已有的影子资料和记录会被删除。',
      confirmText: '删除影子',
      cancelText: '先留着',
      success: (res) => {
        if (res.confirm) {
          const S = storage.load();
          const def = storage.defaultState().shadow;
          S.shadow = def;
          storage.save(S);
          this.refresh();
          wx.showToast({ title: '影子已关闭', icon: 'none' });
        }
      }
    });
  },

  /* chat */
  renderChat() {
    const S = storage.load();
    const remain = Math.max(0, shadow.SHADOW_MS - (Date.now() - (S.shadow.sessionStart || Date.now())));
    const left = shadow.SHADOW_MAX_DAY - (S.shadow.sessionsToday || 0);
    let msgs = (S.shadow.msgs || []).map((m) => this.fmtMsg(m));
    if (msgs.length === 0) {
      const intro1 = {
        role: 'sys',
        text:
          '（这是根据聊天记录生成的 AI 影子，不是真的' +
          (S.shadow.name || '') +
          '。它不会主动找你，也不会替ta做任何承诺。）'
      };
      const intro2 = { role: 'ai', avatar: this.data.agentImg, text: '……嗯。', tip: '' };
      msgs = [intro1, intro2];
      S.shadow.msgs = [
        { role: 'sys', text: intro1.text, t: Date.now() },
        { role: 'ai', text: '……嗯。', t: Date.now() }
      ];
      storage.save(S);
    }
    this.setData({
      msgs,
      remain: util.fmtRemain(remain),
      leftToday: left,
      shadowName: S.shadow.name
    });
    /* 启动倒计时 */
    if (this._tyingTimer) clearInterval(this._tyingTimer);
    this._tyingTimer = setInterval(() => {
      const S2 = storage.load();
      const r = Math.max(0, shadow.SHADOW_MS - (Date.now() - (S2.shadow.sessionStart || Date.now())));
      this.setData({ remain: util.fmtRemain(r) });
      if (r <= 0) {
        this.endChat();
      }
    }, 1000);
    this.scrollChatToBottom();
  },

  fmtMsg(m) {
    if (m.role === 'sys') return { role: 'sys', text: m.text };
    if (m.role === 'ai')
      return { role: 'ai', avatar: this.data.agentImg, text: m.text, tip: m.tip || '' };
    return { role: 'me', text: m.text };
  },

  onChatInput(e) {
    this.setData({ text: e.detail.value });
  },

  onChatSend() {
    this.sendShadow(this.data.text);
  },

  sendShadow(raw) {
    const text = (raw || '').trim();
    if (!text) return;
    this.setData({ text: '' });
    const S = storage.load();
    S.shadow.msgs.push({ role: 'me', text, t: Date.now() });
    storage.save(S);
    this._userCount++;

    /* 打字占位 */
    const msgs = this.data.msgs.concat([
      {
        role: 'ai-temp',
        avatar: this.data.agentImg,
        text: ''
      }
    ]);
    this.setData({ msgs });
    this.scrollChatToBottom();

    const crisis = guardian.detectIntent(text) === 'crisis';
    setTimeout(() => {
      const filtered = this.data.msgs.filter((m) => m.role !== 'ai-temp');
      if (crisis) {
        const text2 = guardian.CRISIS_TEXT;
        filtered.push({ role: 'ai', avatar: this.data.agentImg, text: text2 });
        S.shadow.msgs.push({ role: 'ai', text: text2, t: Date.now() });
        storage.save(S);
        this.setData({
          msgs: filtered,
          crisis: true,
          crisisText:
            '· 全国 24 小时心理援助热线：400-161-9995\n' +
            '· 紧急情况请直接拨打 120 / 110\n\n' +
            '影子接不住这么重的痛苦。但小白在乎你，你身边的人也在。'
        });
      } else {
        const reply = shadow.shadowReply(text, S.shadow.profile);
        const tip =
          this._userCount > 0 && this._userCount % 3 === 0
            ? '提醒：这是AI生成的影子，不是真的ta。'
            : '';
        filtered.push({ role: 'ai', avatar: this.data.agentImg, text: reply, tip });
        S.shadow.msgs.push({ role: 'ai', text: reply, tip, t: Date.now() });
        storage.save(S);
        this.setData({ msgs: filtered });
      }
      this.scrollChatToBottom();
    }, 800 + Math.random() * 900);
  },

  endChat() {
    if (this._tyingTimer) {
      clearInterval(this._tyingTimer);
      this._tyingTimer = null;
    }
    const S = storage.load();
    S.shadow.sessionStart = 0;
    storage.save(S);
    this.setData({ sessionEnd: true });
  },

  onSessionEndChat() {
    this.setData({ sessionEnd: false, mode: 'view' });
    this.refresh();
  },

  onSessionEndToGuardian() {
    this.setData({ sessionEnd: false, mode: 'view' });
    wx.switchTab({ url: '/pages/xiaobai/xiaobai' });
  },

  onCloseCrisis() {
    this.setData({ crisis: false, crisisText: '' });
  },

  scrollChatToBottom() {
    setTimeout(() => {
      wx.pageScrollTo({ scrollTop: 99999, duration: 100 });
    }, 30);
  }
});
