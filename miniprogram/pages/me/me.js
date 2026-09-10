// pages/me/me.js
const storage = require('../../utils/storage.js');
const util = require('../../utils/util.js');
const user = require('../../utils/user.js');
const ai = require('../../utils/ai.js');

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
      logged: !!(nick || avatar)
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
          title: '没弹出微信头像？用下面那个「从相册选」',
          icon: 'none',
          duration: 2600
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
     这里不再让用户对着一个没反应的圆点干瞪眼，直接转相册。 */
  onAvatarError(e) {
    this._clearAvatarTimer();
    const msg = (e && e.detail && (e.detail.errMsg || e.detail.errno)) || '';
    wx.showToast({
      title: /privacy|auth|授权/i.test(String(msg)) ? '隐私指引未配置，先用相册选' : '改用相册选头像',
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
     注意：getPhoneNumber 需要**企业主体**小程序，个人主体点了会 fail；
     而且拿到的是 code，必须后端（这里是云函数）用 appid/secret 才能换成真实号码。
     所以这里拿不到就明确告诉用户手填，不做假象。 */
  onGetPhoneNumber(e) {
    const d = (e && e.detail) || {};
    const code = d.code;
    if (!code) {
      wx.showToast({ title: '没拿到手机号，请手动填写（可留空）', icon: 'none', duration: 2400 });
      return;
    }
    user.fetchPhone(code, (phone) => {
      if (phone) {
        this.setData({ tmpPhone: phone });
        wx.showToast({ title: '已填入手机号', icon: 'none' });
      } else {
        wx.showToast({ title: '需要配置云函数才能自动读取，请先手填', icon: 'none', duration: 2400 });
      }
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

  /* wxml 里 catchtap="noop" 的空处理器（弹窗内层阻止冒泡用） */
  noop() {}
});
