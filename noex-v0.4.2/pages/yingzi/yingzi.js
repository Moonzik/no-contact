// pages/yingzi/yingzi.js
const storage = require('../../utils/storage.js');
const util = require('../../utils/util.js');
const guardian = require('../../utils/guardian.js');
const shadow = require('../../utils/shadow.js');
const wechat = require('../../utils/wechat.js');
const voiceprint = require('../../utils/voiceprint.js');
const user = require('../../utils/user.js');
const ai = require('../../utils/ai.js');

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
    showHowto: false,
    /* v0.9.4：一进设置页就看一眼剪贴板，有聊天记录就直接提示，省得用户不知道去哪复制 */
    clipHint: '',
    clipLines: 0,

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
    crisisText: '',
    /* v0.9.0：chat 模式整页高度（px）与滚动锚点 */
    winH: 0,
    anchor: '',
    /* v0.9.0：AI 是否开启（开了就在导入页提示数据会外发） */
    aiOn: false,

    /* v0.4.0 · 温水冷却 + 自我洞察 */
    affinity: 80,        // 0-100，不进 UI，纯内部
    affinityText: '',    // 用户能看到的阶段文案（不显示数字）
    showReveal: false,   // 自我洞察面板可见性
    reveal: null         // { reason, text, secondary, options }
  },

  _tyingTimer: null,
  _userCount: 0,
  _parseCache: null,
  _msgSeq: 0,

  onLoad() {
    /* v0.9.0：chat 模式整页锁高为 windowHeight（不含 tabBar）。
       用 100vh 会把输入框顶出屏幕，页面下方还能继续往下拖。 */
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
    /* v0.8.0：影子页可以进来看，只有「创建 / 聊天」才要登录 */
    this.setData({ aiOn: ai.isEnabled() });
    this.refresh();
    /* v0.9.4：切回来时再看一眼剪贴板（用户很可能是刚去微信复制完） */
    if (this.data.mode === 'setup') this.autoCheckClipboard();
  },

  onUnload() {
    if (this._tyingTimer) clearInterval(this._tyingTimer);
  },

  refresh() {
    const S = storage.load();
    /* 聊天进行中切 tab 再回来：恢复聊天界面，而不是踢回 view（否则用户丢会话） */
    if (this.data.mode === 'chat' && S.shadow.sessionStart > 0) {
      this.renderChat();
      return;
    }
    const used = this.utilShadowSessionsToday(S);
    const canEnter = used < shadow.SHADOW_MAX_DAY;
    /* v0.4.0 · 温水冷却相似度计算 */
    const affinity = shadow.computeAffinity(S.shadow.firstUsedAt, S.shadow.totalShadowSessions);
    const affinityText = S.shadow.enabled ? shadow.affinityStageText(affinity) : '';
    this.setData({
      mode: 'view',
      shadowName: S.shadow.name || '',
      profileText: S.shadow.profile ? this.buildProfileText(S.shadow.profile) : '',
      used,
      canEnter,
      affinity,
      affinityText,
      shName: S.shadow.name || S.exName || ''
    });
    /* v0.9.3 · 打开影子页不再自动弹揭示。
       以前是「7 天没用 / 满 30 天」自动弹，用户根本没问就被说教。
       现在只有两种触发：用户在对话里起疑（你怎么越来越不像他了）、或自己宣告放下了。 */
  },

  utilShadowSessionsToday(S) {
    const sh = S.shadow;
    if (sh.sessionsDate !== util.todayStr()) {
      sh.sessionsDate = util.todayStr();
      sh.sessionsToday = 0;
      /* 必须保存整个 S。之前误存 sh（shadow 子对象）会把根状态整个覆盖，
         导致 onboarded/startDate/gMsgs/bottle 全部丢失 —— P0 级数据毁灭 bug */
      storage.save(S);
    }
    return sh.sessionsToday;
  },

  /* view → setup */
  onStart() {
    if (user.requireLogin('创建影子需要登录一次。登录只是留个头像昵称，聊天记录仍然只在你手机里。')) return;
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
    this.autoCheckClipboard();
  },

  onNameInput(e) {
    this.setData({ shName: e.detail.value });
  },

  onLogInput(e) {
    this.setData({ shLog: e.detail.value });
  },

  /* 共用：把一段文本解析成影子语料并填进界面 */
  applyLogText(text, label) {
    const self = this;
    try {
      const result = wechat.parseWeChatLog(text || '');
      self._parseCache = result;
      const sel = wechat.defaultShadowSpeaker(result);
      const content = sel
        ? (result.byName[sel] || []).join('\n')
        : result.cleaned;
      const cnt = content ? content.split(/\n+/).filter(Boolean).length : 0;
      self.setData({
        shLog: content,
        shFile: label + ' · 读到 ' + cnt + ' 条消息',
        shSpeakers: ['全部'].concat(result.speakers),
        shSel: sel || ''
      });
      if (!content || content.trim().length < 20) {
        wx.showToast({ title: '内容太少，多弄一些', icon: 'none' });
        return false;
      }
      return true;
    } catch (e) {
      self.setData({ shFile: '解析失败' });
      wx.showToast({ title: '解析失败：' + (e.message || ''), icon: 'none' });
      return false;
    }
  },

  /* 从剪贴板导入——最顺手的路径：在微信里复制好，回来点一下 */
  /* v0.9.4 · 自动看一眼剪贴板：如果里面像聊天记录（≥3 行 / ≥30 字），
     就在页面上直接提示「点这里导入」，用户不用猜按钮在哪。
     拿不到就静默失败，不打扰。 */
  autoCheckClipboard() {
    const self = this;
    try {
      if (typeof wx === 'undefined' || !wx.getClipboardData) return;
      wx.getClipboardData({
        success(res) {
          const t = (res && res.data ? String(res.data) : '').trim();
          const lines = t ? t.split(/\r?\n/).filter((x) => x.trim()) : [];
          if (t.length >= 30 && lines.length >= 3) {
            self.setData({
              clipHint: '剪贴板里有 ' + lines.length + ' 行文字，是从微信复制的聊天记录吗？',
              clipLines: lines.length
            });
          } else {
            self.setData({ clipHint: '', clipLines: 0 });
          }
        },
        fail() { /* 静默 */ }
      });
    } catch (e) { /* 静默 */ }
  },

  onPasteClipboard() {
    if (user.requireLogin('导入聊天记录需要登录一次。')) return;
    const self = this;
    wx.getClipboardData({
      success: (res) => {
        const t = res && res.data ? String(res.data).trim() : '';
        if (!t) {
          self.setData({ shFile: '剪贴板是空的，先去微信复制' });
          wx.showToast({ title: '剪贴板是空的', icon: 'none', duration: 2000 });
          return;
        }
        if (t.length < 8) {
          wx.showToast({ title: '复制的内容太短了', icon: 'none' });
          return;
        }
        self.setData({ clipHint: '', clipLines: 0 });
        self.applyLogText(t, '剪贴板');
      },
      fail: (err) => {
        const msg = (err && err.errMsg) || '';
        if (/privacy/i.test(msg)) {
          wx.showModal({
            title: '需要剪贴板授权',
            content:
              '小程序还没通过「用户隐私保护指引」审核，暂时读不了剪贴板。\n\n' +
              '可以直接在上面的输入框里长按粘贴，效果一样。',
            showCancel: false,
            confirmText: '知道了'
          });
          return;
        }
        self.setData({ shFile: '读剪贴板失败，试试长按粘贴' });
        wx.showToast({ title: '读剪贴板失败，试试长按粘贴', icon: 'none', duration: 2000 });
        console.warn('[yingzi] getClipboardData fail:', msg);
      }
    });
  },

  /* 从微信选择聊天记录文件 */
  onPickFile() {
    if (user.requireLogin('导入聊天记录需要登录一次。')) return;
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
              self.applyLogText(text, name);
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
      fail: (err) => {
        const msg = (err && err.errMsg) || '';
        /* 用户主动取消：静默，不打扰 */
        if (/cancel/i.test(msg)) return;

        /* 微信 PC 端 / 部分环境不支持这个接口 */
        if (/not supported/i.test(msg)) {
          self.setData({ shFile: '当前环境不支持选文件' });
          wx.showModal({
            title: '这里选不了文件',
            content:
              '微信电脑版不支持从会话里选文件。\n\n' +
              '两个办法：\n' +
              '1. 换手机打开这个小程序再选\n' +
              '2. 直接用下面的输入框粘贴聊天记录（更简单）',
            showCancel: false,
            confirmText: '知道了'
          });
          return;
        }

        /* 隐私指引没配/没过审 */
        if (/privacy/i.test(msg)) {
          self.setData({ shFile: '需要隐私授权' });
          wx.showModal({
            title: '需要隐私授权',
            content: '小程序还没通过「用户隐私保护指引」审核，暂时用不了选文件。\n\n可以先用下面的输入框粘贴聊天记录。',
            showCancel: false,
            confirmText: '知道了'
          });
          return;
        }

        /* 其他失败：至少让用户知道发生了什么 */
        self.setData({ shFile: '选文件失败，试试直接粘贴' });
        wx.showToast({
          title: /fail/i.test(msg) ? '选文件失败，可试试粘贴' : '没选到文件',
          icon: 'none',
          duration: 2500
        });
        console.warn('[yingzi] chooseMessageFile fail:', msg);
      }
    });
  },

  /* 展开 / 收起「怎么导出聊天记录」说明 */
  onToggleHowto() {
    this.setData({ showHowto: !this.data.showHowto });
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
        S.shadow.profile = self.buildProfile(log);
        S.shadow.enabled = true;
        storage.save(S);
        self.setData({ mode: 'view' });
        wx.showToast({ title: '影子已生成', icon: 'none' });
        self.refresh();
      }
    }, 700);
  },

  /* v0.9.0：有语言指纹就展示指纹摘要（比旧版 4 字段详细得多） */
  buildProfileText(p) {
    if (!p) return '';
    if (p.voice && p.voice.count) return voiceprint.summary(p.voice);
    return shadow.profileSummary(p);
  },

  /**
   * v0.9.0：影子画像 = 旧版统计字段（本地语料池还要用）+ 新版语言指纹。
   *
   * 关键改动：以前直接拿整段聊天记录统计，把**用户自己说的话**也算进了「TA 的画像」，
   * 所以怎么模仿都像自己。现在先按发言人把 TA 的话挑出来，再建指纹。
   */
  buildProfile(log) {
    let parsed = this._parseCache;
    if (!parsed || !parsed.byName) {
      try { parsed = wechat.parseWeChatLog(log); } catch (e) { parsed = null; }
    }
    const sel = this.data.shSel;
    const sp = (sel && sel !== '全部')
      ? sel
      : (wechat.defaultShadowSpeaker(parsed) || '');
    const lines = voiceprint.pickSpeakerLines(parsed, sp);
    const vp = voiceprint.buildVoicePrint(lines);
    /* 本地语料池仍要 top/avgLen/emojiLove/qRate，用 TA 的话重算更准 */
    const legacy = shadow.analyzeChat(lines.length ? lines.join('\n') : log);
    legacy.voice = vp;
    return legacy;
  },

  onCancelSetup() {
    this.setData({ mode: 'view' });
  },

  /* view(enabled) → chat */
  onEnterChat() {
    if (user.requireLogin('进入影子对话需要登录一次。')) return;
    const S = storage.load();
    const used = S.shadow.sessionsToday || 0;
    if (used >= shadow.SHADOW_MAX_DAY) {
      wx.showToast({ title: '今天影子次数用完了', icon: 'none' });
      return;
    }
    /* v0.9.3 · 进入对话也不再自动弹揭示，改为在对话中检测用户是否起疑。 */
    const now = Date.now();
    /* v0.4.0 · 记录温水冷却数据 */
    if (!S.shadow.firstUsedAt || S.shadow.firstUsedAt <= 0) {
      S.shadow.firstUsedAt = now;
    }
    S.shadow.totalShadowSessions = (S.shadow.totalShadowSessions || 0) + 1;
    if (!S.shadow.observation || typeof S.shadow.observation !== 'object') {
      S.shadow.observation = { lastUsedAt: 0, daysWithNoUse: 0, userSaidNotLikeTa: 0, recentMsgAvgLen: 0 };
    }
    S.shadow.observation.lastUsedAt = now;
    S.shadow.observation.daysWithNoUse = 0;

    S.shadow.sessionsToday = used + 1;
    S.shadow.sessionStart = now;
    S.shadow.msgs = [];
    storage.save(S);
    /* 当前相似度传到 chat 用 */
    const affinity = shadow.computeAffinity(S.shadow.firstUsedAt, S.shadow.totalShadowSessions, now);
    this.setData({
      mode: 'chat',
      text: '',
      remainingSessionMs: shadow.SHADOW_MS,
      affinity,
      affinityText: shadow.affinityStageText(affinity)
    });
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
    let msgs = (S.shadow.msgs || []).map((m, i) => {
      const f = this.fmtMsg(m);
      f._k = i; /* 稳定的渲染 key（避免 wx:key="t" 时间戳重复） */
      return f;
    });
    if (msgs.length === 0) {
      const intro1 = {
        role: 'sys',
        text:
          '（这是根据聊天记录生成的 AI 影子，不是真的' +
          (S.shadow.name || '') +
          '。它不会主动找你，也不会替ta做任何承诺。）'
      };
      const intro2 = { role: 'ai', avatar: this.data.agentImg, text: '……嗯。', tip: '' };
      intro1._k = 0;
      intro2._k = 1;
      msgs = [intro1, intro2];
      S.shadow.msgs = [
        { role: 'sys', text: intro1.text, t: Date.now() },
        { role: 'ai', text: '……嗯。', t: Date.now() }
      ];
      storage.save(S);
    }
    this._msgSeq = msgs.length;
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
    if (user.requireLogin('和影子说话需要登录一次。登录只是留个头像昵称，对话仍然只在你手机里。')) return;
    const text = (raw || '').trim();
    if (!text) return;
    this.setData({ text: '' });
    const S = storage.load();
    S.shadow.msgs.push({ role: 'me', text, t: Date.now() });
    storage.save(S);
    this._userCount++;

    /* me 消息 + 打字占位一起 push 到页面，否则用户看不到自己发的字 */
    const meMsg = { role: 'me', text, _k: this._msgSeq++ };
    const typingMsg = {
      role: 'ai-temp',
      avatar: this.data.agentImg,
      text: '',
      _k: this._msgSeq++
    };
    const msgs = this.data.msgs.concat([meMsg, typingMsg]);
    this.setData({ msgs });
    this.scrollChatToBottom();

    const crisis = guardian.detectIntent(text) === 'crisis';
    /* v0.4.0 · 自我洞察：用户宣告检测 */
    const declaration = shadow.detectDeclaration(text);
    /* v0.9.3 · 用户起疑检测：「你怎么越来越不像他了」这类话
       —— 这是揭示「你需要的根本不是 TA」的唯一时机，除此之外绝不主动弹 */
    const doubt = !crisis && !declaration && shadow.detectDoubt(text)
      && !(S.shadow && S.shadow.revealTriggered);

    setTimeout(() => {
      /* 重新读取：setTimeout 闭包里的 S 是旧快照，用户连发几条时会互相覆盖丢消息 */
      const S2 = storage.load();
      const filtered = this.data.msgs.filter((m) => m.role !== 'ai-temp');
      if (crisis) {
        const text2 = guardian.CRISIS_TEXT;
        filtered.push({ role: 'ai', avatar: this.data.agentImg, text: text2, _k: this._msgSeq++ });
        S2.shadow.msgs.push({ role: 'ai', text: text2, t: Date.now() });
        storage.save(S2);
        this.setData({
          msgs: filtered,
          crisis: true,
          crisisText:
            '· 全国 24 小时心理援助热线：400-161-9995\n' +
            '· 紧急情况请直接拨打 120 / 110\n\n' +
            '影子接不住这么重的痛苦。但小白在乎你，你身边的人也在。'
        });
      } else if (declaration) {
        /* 自我洞察触发（用户宣告） */
        S2.shadow.observation = S2.shadow.observation || {};
        S2.shadow.observation.userSaidNotLikeTa = (S2.shadow.observation.userSaidNotLikeTa || 0) + 1;
        storage.save(S2);
        this.setData({ msgs: filtered });
        this.fireReveal({ reason: 'declaration' });
      } else if (doubt) {
        /* v0.9.3 · 用户当场起疑：影子先应一句，再揭示。
           顺序很重要——先把「被你发现了」说出口，弹层才不突兀。 */
        S2.shadow.observation = S2.shadow.observation || {};
        S2.shadow.observation.userDoubtCount = (S2.shadow.observation.userDoubtCount || 0) + 1;
        storage.save(S2);
        const admit = shadow.REVEAL_TRIGGERS.DOUBT_REPLY;
        filtered.push({ role: 'ai', avatar: this.data.agentImg, text: admit, _k: this._msgSeq++ });
        S2.shadow.msgs.push({ role: 'ai', text: admit, t: Date.now() });
        storage.save(S2);
        this.setData({ msgs: filtered });
        this.scrollChatToBottom();
        this.fireReveal({ reason: 'user_doubt' });
      } else {
        /* v0.4.0 · 把 affinity 传给 shadowReply
           v0.7.0 · 第 5 个参数传去重字典，影子的话也不再说第二遍
           v0.9.0 · 先算好本地兜底，再尝试 AI；AI 没配/失败就用本地的 */
        S2.usedReplies = S2.usedReplies || {};
        const localReply = shadow.shadowReply(
          text, S2.shadow.profile, this.data.affinity, null, S2.usedReplies
        );
        const tip =
          this._userCount > 0 && this._userCount % 3 === 0
            ? '提醒：这是AI生成的影子，不是真的TA。'
            : '';
        const t0 = Date.now();
        const baseDelay = 800 + Math.random() * 900;
        ai.shadowChat({
          text: text,
          profile: S2.shadow.profile,
          affinity: this.data.affinity,
          history: S2.shadow.msgs
        }, (err, aiText) => {
          /* AI 迟迟不回时至少保留原本的打字停顿，不会"啪"地一下弹出来 */
          const wait = Math.max(0, baseDelay - (Date.now() - t0));
          setTimeout(() => {
            this.appendShadowMsg(aiText || localReply, tip);
          }, wait);
        });
        return; /* appendShadowMsg 内部会自己滚到底 */
      }
      this.scrollChatToBottom();
    }, 800 + Math.random() * 900);
  },

  /* v0.9.0：单独抽出来，AI 异步回来后才渲染，且重新读一次存储防丢消息 */
  appendShadowMsg(text, tip) {
    const S2 = storage.load();
    const filtered = this.data.msgs.filter((m) => m.role !== 'ai-temp');
    filtered.push({ role: 'ai', avatar: this.data.agentImg, text, tip, _k: this._msgSeq++ });
    S2.shadow.msgs.push({ role: 'ai', text, tip, t: Date.now() });
    S2.usedReplies = S2.usedReplies || {};
    S2.usedReplies[text] = 1;
    storage.save(S2);
    this.setData({ msgs: filtered });
    this.scrollChatToBottom();
  },

  onChatBlur(e) {
    /* 失焦时同步一次，防止某些机型 bindinput 漏触发 */
    if (e && e.detail && typeof e.detail.value === 'string') {
      this.setData({ text: e.detail.value });
    }
  },

  /* v0.4.0 · 触发自我洞察面板 */
  fireReveal(reasonObj) {
    const S = storage.load();
    if (this._tyingTimer) { clearInterval(this._tyingTimer); this._tyingTimer = null; }
    S.shadow.sessionStart = 0;
    S.shadow.revealTriggered = true;
    S.shadow.revealSeenAt = Date.now();
    S.shadow.revealReason = (reasonObj && reasonObj.reason) || 'manual';
    storage.save(S);
    this.setData({
      mode: 'view',
      sessionEnd: false,
      showReveal: true,
      reveal: {
        reason: S.shadow.revealReason,
        text: shadow.REVEAL_TRIGGERS.REVEAL_TEXT,
        secondary: shadow.REVEAL_TRIGGERS.REVEAL_SECONDARY,
        options: shadow.REVEAL_TRIGGERS.REVEAL_OPTIONS.slice()
      }
    });
  },

  /* v0.4.0 · 用户主动问「你用了这么久…有啥发现吗」 */
  onRevealManual() {
    const S = storage.load();
    /* 已经触发过并关闭 → 允许再看一次（而不是误报「还不到时候」） */
    if (S.shadow.revealTriggered) {
      this.setData({
        showReveal: true,
        reveal: {
          reason: S.shadow.revealReason || 'manual',
          text: shadow.REVEAL_TRIGGERS.REVEAL_TEXT,
          secondary: shadow.REVEAL_TRIGGERS.REVEAL_SECONDARY,
          options: shadow.REVEAL_TRIGGERS.REVEAL_OPTIONS.slice()
        }
      });
      return;
    }
    if (!shadow.manualReveal(S.shadow)) {
      wx.showToast({ title: '还不到时候，继续用一段时间吧', icon: 'none' });
      return;
    }
    this.fireReveal({ reason: 'manual' });
  },

  /* v0.4.0 · 关闭洞察面板 */
  onRevealDismiss() {
    this.setData({ showReveal: false, reveal: null });
    this.refresh();
  },

  /* v0.4.0 · 跳到洞察后的去向 */
  onRevealOption(e) {
    const opt = e.currentTarget.dataset.opt;
    if (!opt) return;
    this.setData({ showReveal: false, reveal: null });
    if (opt.mode === 'switchTab') {
      wx.switchTab({ url: opt.target });
    } else if (opt.mode === 'navigateTo') {
      wx.navigateTo({ url: opt.target });
    }
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

  /* wxml 里 catchtap="noop" 的空处理器（弹窗内层阻止冒泡用） */
  noop() {},

  /* v0.9.0：改用 scroll-into-view 锚点。
     以前用 wx.pageScrollTo —— 消息在 scroll-view 里、页面本身不滚动，
     这个函数一直是空转的，用户只能手动往下划才能看到新消息。 */
  scrollChatToBottom() {
    const msgs = this.data.msgs;
    if (!msgs || !msgs.length) return;
    const last = msgs[msgs.length - 1];
    setTimeout(() => {
      this.setData({ anchor: 'm' + last._k });
    }, 30);
  }
});
