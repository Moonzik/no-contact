// pages/me/me.js
const storage = require('../../utils/storage.js');
const util = require('../../utils/util.js');
const user = require('../../utils/user.js');
const ai = require('../../utils/ai.js');
const notify = require('../../utils/notify.js');
const errlog = require('../../utils/errlog.js');

Page({
  data: {
    day: 1,
    sub: '已坚持 1 天',
    startDate: '',
    exName: '',
    /* 登录态 */
    logged: false,
    avatar: '',
    nick: '',
    showLogin: false,
    tmpAvatar: '',
    tmpNick: '',
    tmpPhone: '',
    /* 基础库能力：决定用微信头像昵称，还是降级到手选 */
    avaSupported: true,
    nickSupported: true,
    showLogout: false,
    showClear: false,
    showFeedback: false,
    /* v0.9.13 缺口二 · 备份还原 */
    showImport: false,
    importSummary: null,     // 校验通过后的数据摘要
    importRaw: '',           // 校验通过后的原始 JSON 串（确认时才落盘）
    importErr: '',           // 校验失败的说明文案
    prevExists: false,       // 是否存在「导入前快照」（可撤销）
    /* v0.9.13 缺口二 · 换断联对象 */
    showNewSeg: false,
    showSegs: false,
    segCount: 0,
    segList: [],
    /* v0.9.13 缺口二 · 打卡提醒 */
    showReminder: false,
    reminderOn: false,
    reminderReady: false,    // utils/config.js 里有没有填模板 ID
    /* v0.9.14 · 运行记录（本地异常日志）
       刻意只在「有记录」时才出现——没出过错的时候，普通用户不该看到"错误日志"这种东西 */
    errCount: 0,
    showErrs: false,
    errText: '',
    devtools: false,
    version: ''
  },

  onShow() {
    /* v0.8.0：不再有登录墙，个人主页永远可进 */
    this.refresh();
    /* 版本号从 app.globalData 读，避免关于页硬编码落后于真实版本 */
    this.setData({
      version: this.readVersion(),
      avaSupported: user.avatarSupported(),
      nickSupported: user.nicknameSupported(),
      phoneSupported: user.phoneSupported(),
      /* v0.9.3：模拟器里 chooseAvatar 点不动，页面上直接给出「从相册选」的提示语 */
      devtools: user.isDevtools()
    });

    /* 从别的功能页点「去登录」过来的：自动展开登录卡 */
    let auto = false;
    try {
      if (typeof getApp === 'function') {
        const app = getApp();
        if (app && app.globalData && app.globalData.autoOpenLogin) {
          auto = true;
          app.globalData.autoOpenLogin = false;
        }
      }
    } catch (e) { /* ignore */ }
    if (auto && !this.data.logged) this.onEditProfile();
  },

  /* 测试环境可能没有 getApp，做防御 */
  readVersion() {
    try {
      if (typeof getApp === 'function') {
        const app = getApp();
        if (app && app.globalData && app.globalData.version) {
          return app.globalData.version;
        }
      }
    } catch (e) {
      /* ignore */
    }
    return '';
  },

  onMidnightRefresh() {
    this.refresh();
  },

  refresh() {
    const S = storage.load();
    const d = util.dayNum(S.startDate);
    const u = S.user || null;
    const avatar = (u && u.avatar) || '';
    const nick = (u && u.nick) || '';
    /* v0.9.0：关于页显示 AI 引擎状态，方便排查"为什么还是老样子" */
    const aiMode = ai.mode();
    const aiText = aiMode === 'cloud' ? 'AI 智能体 · 云函数'
      : (aiMode === 'https' ? 'AI 智能体 · 直连' : 'AI 智能体 · 未接入（本地引擎）');
    this.setData({
      aiText: aiText,
      day: d,
      sub: '已坚持 ' + d + ' 天',
      startDate: S.startDate,
      exName: S.exName,
      avatar: avatar,
      nick: nick || '断联中',
      logged: !!(nick || avatar),
      /* v0.9.13：导入备份的撤销入口只在有快照时出现 */
      prevExists: !!storage.loadPrev(),
      segCount: Array.isArray(S.segments) ? S.segments.length : 0,
      reminderOn: !!(S.reminder && S.reminder.on),
      reminderReady: notify.configured(),
      /* v0.9.14：有异常记录时才显示入口（入口本身就是「坏了」的信号） */
      errCount: errlog.count()
    });
  },

  onPickDate(e) {
    this.setData({ startDate: e.detail.value });
    const S = storage.load();
    if (e.detail.value) {
      S.startDate = e.detail.value;
      storage.save(S);
      wx.showToast({ title: '已更新', icon: 'none' });
      this.refresh();
    }
  },

  onExInput(e) {
    const S = storage.load();
    S.exName = e.detail.value;
    storage.save(S);
  },

  /* ── 微信登录 / 编辑资料 ───────────────────────────── */

  onEditProfile() {
    const S = storage.load();
    const u = S.user || {};
    this.setData({
      showLogin: true,
      tmpAvatar: u.avatar || '',
      tmpNick: u.nick || '',
      tmpPhone: u.phone || ''
    });
  },

  /* 点了微信头像那颗按钮。
     正常情况 1 秒内会弹出选择面板并回调 onChooseAvatar；
     没弹出来（基础库不支持 / 隐私指引没配 / 授权被拒）时给一句明确提示，
     而不是让用户对着一个没反应的圆点干瞪眼。 */
  onAvatarTap() {
    this._clearAvatarTimer();
    try {
      this._avatarTimer = setTimeout(() => {
        this._avatarTimer = null;
        wx.showToast({
          title: '没弹出来？多半是隐私指引还没在后台生效，过审后自动恢复',
          icon: 'none',
          duration: 2800
        });
      }, 1200);
    } catch (e) { /* ignore */ }
  },

  _clearAvatarTimer() {
    if (this._avatarTimer) {
      clearTimeout(this._avatarTimer);
      this._avatarTimer = null;
    }
  },

  /* button open-type="chooseAvatar" 的回调：拿到的是临时文件，要转存 */
  onChooseAvatar(e) {
    this._clearAvatarTimer();
    const url = e && e.detail && e.detail.avatarUrl;
    if (!url) {
      /* 拿不到（隐私未授权 / 基础库问题）就直接开相册，不让用户干瞪眼 */
      this.onPickAvatarAlbum();
      return;
    }
    const old = this.data.tmpAvatar;
    user.saveAvatar(url, old, (p) => {
      this.setData({ tmpAvatar: p });
    });
  },

  /* 微信头像按钮报错（基础库不支持 / 隐私指引没配 / 授权被拒）。
     v0.9.7：隐私类报错不再转相册——指引没过审时相册同样被平台拦，
     转过去也是白转，直接把原因说清楚。其他错误才转相册。 */
  onAvatarError(e) {
    this._clearAvatarTimer();
    const msg = String((e && e.detail && (e.detail.errMsg || e.detail.errno)) || '');
    if (/privacy|auth|授权/i.test(msg)) {
      wx.showToast({
        title: '隐私指引还没在后台生效，过审后就能选微信头像',
        icon: 'none',
        duration: 3000
      });
      return;
    }
    wx.showToast({
      title: '改用相册选头像',
      icon: 'none',
      duration: 2200
    });
    this.onPickAvatarAlbum();
  },

  /* 兜底：从相册/拍照选一张当头像 */
  onPickAvatarAlbum() {
    this._clearAvatarTimer();
    const old = this.data.tmpAvatar;
    user.pickFromAlbum((p) => {
      if (!p) return;
      user.saveAvatar(p, old, (final) => {
        this.setData({ tmpAvatar: final });
      });
    });
  },

  onNickInput(e) {
    this.setData({ tmpNick: (e && e.detail && e.detail.value) || '' });
  },

  onPhoneInput(e) {
    /* 只留数字，避免粘贴进来带空格/横杠 */
    const v = String((e && e.detail && e.detail.value) || '').replace(/\D/g, '').slice(0, 11);
    this.setData({ tmpPhone: v });
  },

  /* 微信一键填手机号。
     v0.9.8：主体已变更为个体工商户，getPhoneNumber 可用。
     流程：点按钮 → 微信弹授权 → 拿到 code → 云函数用 appid/secret 换真实号码。
     手机号是选填项，任何一步失败都不阻塞登录，退回手填即可。 */
  onGetPhoneNumber(e) {
    const d = (e && e.detail) || {};
    const code = d.code;
    const errmsg = String((d && d.errMsg) || '');

    if (!code) {
      /* 用户主动拒绝，或隐私指引未生效。区分一下，别让用户以为是坏了 */
      const denied = errmsg.indexOf('deny') > -1;
      wx.showToast({
        title: denied ? '已取消，可手动填写（选填）' : '暂时读不到，请手动填写（选填）',
        icon: 'none',
        duration: 2200
      });
      return;
    }

    wx.showLoading({ title: '读取中', mask: true });
    user.fetchPhone(code, (phone, err) => {
      wx.hideLoading();
      if (phone) {
        this.setData({ tmpPhone: phone });
        wx.showToast({ title: '已填入手机号', icon: 'none' });
        return;
      }
      /* 换号失败基本都是云函数没部署或没配 NOEX_APPID/NOEX_APPSECRET。
         用户侧只说「手动填」，具体原因打进控制台，方便排查。 */
      if (err) console.warn('[NOEX] 手机号换取失败：', err);
      wx.showToast({ title: '一键填写暂不可用，请手动填写（选填）', icon: 'none', duration: 2400 });
    });
  },

  onProfileSave() {
    const raw = this.data.tmpNick || '';
    const avatar = this.data.tmpAvatar || '';
    if (!avatar && !raw.replace(/\s/g, '')) {
      wx.showToast({ title: '选个头像或填个昵称', icon: 'none' });
      return;
    }
    const S = storage.load();
    const prevAvatar = (S.user && S.user.avatar) || '';
    if (prevAvatar && prevAvatar !== avatar) user.removeFile(prevAvatar);

    S.user = {
      nick: user.cleanNick(raw) || '断联中',
      avatar: avatar,
      phone: this.data.tmpPhone || '',
      loginAt: Date.now(),
      viaWx: false
    };
    storage.save(S);
    this.setData({ showLogin: false });
    wx.showToast({ title: this.data.logged ? '已保存' : '登录成功', icon: 'none' });
    this.refresh();

    /* 走一次微信登录确认身份；将来接了服务器，在这里把 code 换成 openid 即可 */
    user.silentLogin((ok) => {
      if (!ok) return;
      const S2 = storage.load();
      if (S2.user) { S2.user.viaWx = true; storage.save(S2); }
    });
  },

  onProfileClose() {
    this._clearAvatarTimer();
    this.setData({ showLogin: false });
  },

  onLogoutAsk() {
    this.setData({ showLogin: false, showLogout: true });
  },

  onLogoutCancel() {
    this.setData({ showLogout: false });
  },

  onLogoutConfirm() {
    const S = storage.load();
    user.clearAvatar((S.user && S.user.avatar) || '');
    S.user = null;
    storage.save(S);
    this.setData({ showLogout: false });
    wx.showToast({ title: '已退出登录', icon: 'none' });
    /* v0.8.0：退出后留在个人主页，不拦任何人 */
    this.refresh();
  },

  /* ── 数据 ───────────────────────────── */

  onExport() {
    const S = storage.load();
    const json = storage.exportJson(S);
    /* 小程序里没法直接下载，复制到剪贴板让用户粘贴 */
    wx.setClipboardData({
      data: json,
      success: () => {
        wx.showToast({ title: '已复制 JSON 到剪贴板', icon: 'none' });
      }
    });
  },

  onClear() {
    this.setData({ showClear: true });
  },

  onClearConfirm() {
    const S = storage.load();
    user.clearAvatar((S.user && S.user.avatar) || '');
    Object.assign(S, storage.defaultState());
    S.startDate = util.todayStr();
    S.onboarded = false;
    S.user = null;
    storage.save(S);
    /* v0.9.14：「清空所有数据」要名副其实——运行记录也是数据，一并清掉 */
    errlog.clear();
    this.setData({ showClear: false });
    wx.showToast({ title: '已清空，重新开始', icon: 'none' });
    /* 退出后回 onboard */
    wx.reLaunch({ url: '/pages/onboard/onboard' });
  },

  onClearCancel() {
    this.setData({ showClear: false });
  },

  /* 跳转微信托管的《用户隐私保护指引》——审核要求在小程序内可触达 */
  onOpenPrivacy() {
    if (typeof wx.openPrivacyContract === 'function') {
      wx.openPrivacyContract({
        fail: () => {
          wx.showToast({ title: '暂无法打开，请稍后重试', icon: 'none' });
        }
      });
    } else {
      wx.showToast({ title: '当前基础库版本不支持', icon: 'none' });
    }
  },

  /* 用户服务协议（我们自己的条款，写在代码里；和微信托管的隐私指引是两份东西） */
  onOpenAgreement() {
    wx.navigateTo({ url: '/pages/agreement/agreement' });
  },

  onOpenFeedback() {
    this.setData({ showFeedback: true });
  },

  onCloseFeedback() {
    this.setData({ showFeedback: false });
  },

  /* 备用反馈路径：把「版本 / AI 模式 / 机型」这些定位必需的信息拼成模板复制走。
     这样即使客服会话还没在后台配好，用户手上也有一份完整的问题信息可以发出来。 */
  onCopyFeedback() {
    let sys = '';
    try {
      const info = wx.getSystemInfoSync();
      sys = [info.platform, info.system, info.model].filter(Boolean).join(' / ');
    } catch (e) { /* 模拟器可能取不到 */ }

    let day = 1;
    try { day = util.dayNum(storage.load().startDate); } catch (e) { /* ignore */ }

    const data = [
      '【问题描述】（简单说说发生了什么）',
      '',
      '【怎么出现的】1.  2.  3.',
      '',
      '【希望它变成什么样】',
      '',
      '--- 以下信息自动生成，方便定位 ---',
      '版本：v' + (this.readVersion() || '未知'),
      'AI 模式：' + ai.mode(),
      '使用天数：第 ' + day + ' 天',
      '设备：' + (sys || '未知'),
      '时间：' + util.todayStr()
    ].join('\n');

    /* setClipboardData 属于隐私接口，隐私指引没过审时会 fail —— 不能让它静默失败 */
    wx.setClipboardData({
      data: data,
      success: () => {
        wx.showToast({ title: '已复制，粘贴到留言里就行', icon: 'none', duration: 2200 });
      },
      fail: () => {
        wx.showToast({ title: '复制失败，可以截图发给我们', icon: 'none', duration: 2200 });
      }
    });
  },

  /* ───────── v0.9.13 缺口二 · 备份还原 ─────────
     导入这件事最大的风险是「把现有数据覆盖掉」，所以流程刻意做成三步：
     读来源 → 校验 + 展示摘要（此时还没写任何东西）→ 用户确认才落盘。
     落盘前再自动快照一份当前数据，事后能一键撤销。 */

  onImportBackup() {
    this.setData({ showImport: true, importSummary: null, importErr: '', importRaw: '' });
  },

  onCloseImport() {
    this.setData({ showImport: false, importSummary: null, importErr: '', importRaw: '' });
  },

  onImportFromClipboard() {
    if (typeof wx.getClipboardData !== 'function') {
      this._importFail('当前微信版本读不了剪贴板');
      return;
    }
    wx.getClipboardData({
      success: (r) => this._checkImport((r && r.data) || ''),
      /* 剪贴板属隐私接口：隐私指引没过审时会直接 fail，得说清楚 */
      fail: () => this._importFail('读不到剪贴板。可先从「导出数据」把备份存成文件，再用「从聊天选文件」。')
    });
  },

  onImportFromFile() {
    if (typeof wx.chooseMessageFile !== 'function') {
      this._importFail('当前微信版本不支持选文件');
      return;
    }
    wx.chooseMessageFile({
      count: 1,
      type: 'file',
      extension: ['json', 'txt'],
      success: (r) => {
        const f = r && r.tempFiles && r.tempFiles[0];
        if (!f || !f.path) { this._importFail('没选到文件'); return; }
        try {
          wx.getFileSystemManager().readFile({
            filePath: f.path,
            encoding: 'utf8',
            success: (res) => this._checkImport(res && res.data),
            fail: () => this._importFail('这个文件读不出来')
          });
        } catch (e) {
          this._importFail('这个文件读不出来');
        }
      },
      fail: () => { /* 用户取消，不提示 */ }
    });
  },

  _importFail(msg) {
    this.setData({ importErr: msg, importSummary: null, importRaw: '' });
  },

  /* 校验 + 生成摘要。这一步不写 storage，所以用户看到摘要时数据还是原来的 */
  _checkImport(raw) {
    const v = storage.validateBackup(raw);
    if (!v.ok) {
      const map = {
        empty: '剪贴板是空的，先把备份复制进来',
        parse: '这段内容不是有效的备份（JSON 解析失败），可能复制少了字符',
        shape: '备份结构不对，可能不是本小程序的备份',
        not_backup: '看起来不是本小程序的备份文件'
      };
      this._importFail(map[v.reason] || '这份备份认不出来');
      return;
    }
    this.setData({
      importErr: '',
      importRaw: typeof raw === 'string' ? raw : JSON.stringify(raw),
      importSummary: v.summary
    });
  },

  onImportConfirm() {
    const v = storage.validateBackup(this.data.importRaw);
    if (!v.ok) { this._importFail('这份备份认不出来'); return; }
    /* 落盘前先把当前数据整体快照一份，导入后悔了还能退回来 */
    storage.snapshotPrev(storage.load());
    storage.applyBackup(v.data);
    this.setData({ showImport: false, importSummary: null, importRaw: '' });
    wx.showToast({ title: '已恢复。想反悔可以「撤销」', icon: 'none', duration: 2400 });
    this.refresh();
  },

  onImportUndo() {
    const raw = storage.loadPrev();
    const v = storage.validateBackup(raw);
    if (!v.ok) {
      storage.clearPrev();
      wx.showToast({ title: '没有可撤销的备份', icon: 'none' });
      this.refresh();
      return;
    }
    wx.showModal({
      title: '撤销上次导入？',
      content: '会回到导入之前那份数据，导入进来的那份会被换掉。',
      confirmText: '撤销',
      success: (r) => {
        if (!r.confirm) return;
        storage.applyBackup(v.data);
        storage.clearPrev();
        wx.showToast({ title: '已回到导入前的数据', icon: 'none' });
        this.refresh();
      }
    });
  },

  /* ───────── v0.9.13 缺口二 · 换断联对象 ─────────
     计数要归零、影子和代号要跟着换人走，但日记、留白瓶、小白对话是「你自己」的东西，
     不属于某一个 TA，所以一个都不动。上一段整段归档进 segments，能回看。 */

  onNewSegment() {
    this.setData({ showNewSeg: true });
  },

  onCloseNewSeg() {
    this.setData({ showNewSeg: false });
  },

  onNewSegmentConfirm() {
    const S = storage.load();
    const day = util.dayNum(S.startDate);
    if (!Array.isArray(S.segments)) S.segments = [];
    /* 归档：只存摘要 + 日期列表，不存对话内容（避免 storage 膨胀） */
    S.segments.push({
      exName: S.exName || '',
      startDate: S.startDate,
      endDate: util.todayStr(),
      days: day,
      checkCount: S.checkCount || 0,
      relapses: S.relapses || 0,
      checkLog: (S.checkLog || []).slice(),
      relapseLog: (S.relapseLog || []).slice(),
      archivedAt: Date.now()
    });

    S.exName = '';
    S.startDate = util.todayStr();
    S.lastCheckIn = '';
    S.checkCount = 0;
    S.relapses = 0;
    S.checkLog = [];
    S.relapseLog = [];
    /* 影子模仿的是上一个人：换段必须清掉，让他重新导入聊天记录（不清会认错人） */
    S.shadow = storage.defaultState().shadow;
    storage.save(S);

    this.setData({ showNewSeg: false });
    wx.showToast({ title: '新的一段，从今天开始', icon: 'none', duration: 2200 });
    this.refresh();
  },

  onShowSegs() {
    const S = storage.load();
    const list = (S.segments || [])
      .slice()
      .reverse()
      .map((g) => ({
        name: g.exName || '（没有代号）',
        range: util.mdd(g.startDate) + ' – ' + util.mdd(g.endDate),
        days: g.days || 0,
        note: '撑住 ' + (g.checkCount || 0) + ' 次' +
          ((g.relapses || 0) > 0 ? ' · 断过 ' + g.relapses + ' 次' : ' · 一次没断')
      }));
    this.setData({ showSegs: true, segList: list });
  },

  onCloseSegs() {
    this.setData({ showSegs: false });
  },

  /* ───────── v0.9.13 缺口二 · 打卡提醒 ─────────
     小程序没有本地定时通知，只能走微信订阅消息（用户授权 → 云函数按模板发）。
     模板 ID 要先去 mp 后台申请，放在 utils/config.js；没配就如实说明，不假装订阅成功。 */

  onReminder() {
    if (!notify.configured()) {
      this.setData({ showReminder: true });
      return;
    }
    if (!notify.supported()) {
      wx.showToast({ title: '当前微信版本不支持提醒', icon: 'none' });
      return;
    }
    notify.request((ok, reason) => {
      if (ok) {
        const S = storage.load();
        S.reminder = { on: true, at: Date.now() };
        storage.save(S);
        wx.showToast({ title: '好了，明天会提醒你', icon: 'none', duration: 2200 });
        this.refresh();
        return;
      }
      if (reason === 'deny') {
        wx.showToast({ title: '没关系，想开的时候再来', icon: 'none', duration: 2200 });
        return;
      }
      wx.showToast({ title: '提醒没开成，回头再试', icon: 'none', duration: 2200 });
    });
  },

  onCloseReminder() {
    this.setData({ showReminder: false });
  },

  /* ── v0.9.14 · 运行记录（本地异常日志）─────────────
     它是一个「出问题才会出现」的入口：errCount 为 0 时，整块在 wxml 里就不渲染。
     文案刻意不吓人——不写「错误」「崩溃」，写「运行记录」。用户看到这个，
     第一反应应该是"哦，帮我记着呢"，而不是"我的手机是不是中毒了"。 */

  onShowErrs() {
    this.setData({ showErrs: true, errText: errlog.text() });
  },

  onCloseErrs() {
    this.setData({ showErrs: false });
  },

  onCopyErrs() {
    const data = this.data.errText || errlog.text();
    wx.setClipboardData({
      data: data,
      success: () => {
        /* setClipboardData 成功后微信自己会弹「内容已复制」，等它显示完再补一句去哪儿发 */
        setTimeout(() => {
          wx.showToast({ title: '去「意见反馈」粘贴发给我就行', icon: 'none', duration: 2600 });
        }, 1200);
      },
      fail: () => {
        /* 隐私指引未过审时剪贴板接口会被拦，这时让用户手动长按选 */
        wx.showModal({
          title: '复制没成功',
          content: '可以长按上面的文字，手动选中复制。',
          showCancel: false,
          confirmText: '知道了'
        });
      }
    });
  },

  onClearErrs() {
    wx.showModal({
      title: '清掉这些记录？',
      content: '清了之后就看不到之前出的问题是怎么发生的了。如果小程序一直正常，清掉没影响。',
      confirmText: '清掉',
      cancelText: '先留着',
      success: (r) => {
        if (!r.confirm) return;
        errlog.clear();
        this.setData({ showErrs: false });
        this.refresh();
        wx.showToast({ title: '已清掉', icon: 'none' });
      }
    });
  },

  /* wxml 里 catchtap="noop" 的空处理器（弹窗内层阻止冒泡用） */
  noop() {}
});
