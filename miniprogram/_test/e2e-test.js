// _test/e2e-test.js — 全页面 E2E：每个 bindtap 都跑一遍，找出未发现的 bug
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const utilsSrc = {};
/* v0.9.0：新增 voiceprint / ai-config / ai（ai 依赖前两者，顺序不能反） */
['storage', 'util', 'guardian', 'shadow', 'wechat', 'user', 'quotes',
 'voiceprint', 'ai-config', 'ai'].forEach((m) => {
  utilsSrc[m] = fs.readFileSync(path.join(ROOT, 'utils', m + '.js'), 'utf8');
});

const pageFiles = ['onboard', 'today', 'xiaobai', 'yingzi', 'me', 'bottle'];
const pagesSrc = {};
pageFiles.forEach((p) => {
  pagesSrc[p] = fs.readFileSync(path.join(ROOT, 'pages', p, p + '.js'), 'utf8');
});

/* fake-wx */
let stored = {};
const wxLog = [];
const wx = {
  getStorageSync(k) { return stored[k]; },
  setStorageSync(k, v) {
    stored[k] = (typeof v === 'object' && v !== null) ? JSON.parse(JSON.stringify(v)) : v;
    wxLog.push(['set', k]);
  },
  removeStorageSync(k) { delete stored[k]; wxLog.push(['rm', k]); },
  showToast(o) { wxLog.push(['toast', o && o.title]); },
  showModal(o) {
    wxLog.push(['modal', o && o.title]);
    if (o && o.success) o.success({ confirm: true, cancel: false });
  },
  pageScrollTo() { wxLog.push(['scroll']); },
  navigateTo(o) { wxLog.push(['nav', o && o.url]); },
  switchTab(o) { wxLog.push(['switch', o && o.url]); },
  reLaunch(o) { wxLog.push(['relaunch', o && o.url]); },
  chooseMessageFile(o) {
    wxLog.push(['pickfile']);
    if (o && o.success) o.success({ tempFiles: [{ path: '', name: '' }] });
  },
  getFileSystemManager() {
    return {
      readFile: (cfg) => cfg && cfg.fail && cfg.fail(),
      saveFile: (cfg) => {
        wxLog.push(['savefile', cfg && cfg.filePath]);
        if (cfg && cfg.success) cfg.success({ savedFilePath: cfg.filePath });
      },
      unlink: (cfg) => {
        wxLog.push(['unlink', cfg && cfg.filePath]);
        if (cfg && cfg.success) cfg.success();
      }
    };
  },
  env: { USER_DATA_PATH: '/fake/usr' },
  login(o) {
    wxLog.push(['login']);
    if (o && o.success) o.success({ code: 'FAKE_CODE' });
  },
  setClipboardData(o) {
    wxLog.push(['clip', (o && o.data || '').length]);
    if (o && o.success) o.success();
  }
};

/* fake 小程序全局：捕获 Page 的入参（PageDef） */
const PageFns = [];
function makePageFn() {
  const fn = function(def) { fn.last = def; PageFns.push(def); return def; };
  fn.last = null;
  return fn;
}
const Page = makePageFn();
const App = function(def) { return def; };
function getCurrentPages() { return []; }

/* v0.8.0：fake 的 app 实例，全局只有一份，测试里直接改它即可 */
const appHolder = { globalData: { autoOpenLogin: false } };

/* 隔离 vm —— 每个模块一个 sandbox */
const loadedUtils = {};
function execIsolated(src, fakeReq) {
  const pageFn = makePageFn();
  /* fake setTimeout/setInterval 立即同步执行，避免 Promise.then 时序问题 */
  const s = {
    wx, console, module: { exports: {} },
    Date, Math, JSON, Array, Object, String, Number, Boolean, RegExp,
    setTimeout: (cb) => { cb(); return 1; },
    clearTimeout: () => {},
    setInterval: (cb) => { cb(); return 1; },
    clearInterval: () => {},
    Promise, Symbol, Error, parseInt, parseFloat, isNaN,
    Page: pageFn, App, getCurrentPages, getApp: () => appHolder,
    require: fakeReq || (() => ({}))
  };
  s.global = s;
  const c = vm.createContext(s);
  vm.runInContext(src, c);
  return pageFn.last || c.module.exports || {};
}

function loadUtil(name) {
  if (loadedUtils[name]) return loadedUtils[name];
  const fakeReq = (modPath) => {
    const depName = (modPath.match(/([^/]+)\.js$/) || [])[1];
    return loadedUtils[depName] || {};
  };
  loadedUtils[name] = execIsolated(utilsSrc[name], fakeReq);
  return loadedUtils[name];
}

const storage = loadUtil('storage');
const util = loadUtil('util');
const guardian = loadUtil('guardian');
const shadow = loadUtil('shadow');
const userMod = loadUtil('user');
loadUtil('wechat');
loadUtil('quotes');   /* v0.7.0 首页每日一句 */
loadUtil('voiceprint'); /* v0.9.0 影子语言指纹 */
loadUtil('ai-config');
loadUtil('ai');         /* v0.9.0 AI 智能体（默认 off，测试里不联网） */

const loadedPages = {};
function loadPage(name) {
  if (loadedPages[name]) return loadedPages[name];
  const fakeReq = (modPath) => {
    const depName = (modPath.match(/([^/]+)\.js$/) || [])[1];
    return loadedUtils[depName] || {};
  };
  loadedPages[name] = execIsolated(pagesSrc[name], fakeReq);
  return loadedPages[name];
}
const onboard = loadPage('onboard');
const today = loadPage('today');
const xiaobai = loadPage('xiaobai');
const yingzi = loadPage('yingzi');
const me = loadPage('me');
const bottle = loadPage('bottle');


/* v0.7.0：所有页面 now 强制登录。除了专门测登录墙的用例，其余用例都先塞一个已登录用户 */
function seedUser() {
  const s = storage.defaultState();
  s.startDate = util.todayStr();
  s.user = { nick: '测试用户', avatar: '', loginAt: Date.now() };
  stored.noex_mvp_v1 = s;
}

function section(t) { console.log('\n-- ' + t + ' --'); }
let pass = 0, fail = 0;
const issues = [];
function check(name, cond, info) {
  if (cond) { pass++; console.log('  ✓', name); }
  else      { fail++; console.log('  ✗', name, info || ''); issues.push(name); }
}

function makePage(PageDef) {
  const data = JSON.parse(JSON.stringify(PageDef.data || {}));
  const inst = Object.assign({}, PageDef);
  inst.data = data;
  inst._sets = [];
  inst.setData = function(patch) {
    Object.assign(this.data, patch);
    this._sets.push(JSON.parse(JSON.stringify(patch)));
  };
  return inst;
}

console.log('\n========== onboard ==========');
{
  stored = {}; seedUser();
  const ob = makePage(onboard);
  ob.onLoad();
  check('onLoad 设置 startDate 为今天', ob.data.startDate === util.todayStr());
  ob.onGoStart();
  check('onGoStart step=1', ob.data.step === 1);
  ob.onPickDate({ detail: { value: '2025-01-01' } });
  check('onPickDate 设置 startDate', ob.data.startDate === '2025-01-01');
  ob.onInputEx({ detail: { value: 'ta' } });
  check('onInputEx 设置 exName', ob.data.exName === 'ta');
  wxLog.length = 0;
  ob.onConfirmStart();
  check('onConfirmStart step=2', ob.data.step === 2);
  check('onConfirmStart 写 storage', stored.noex_mvp_v1 && stored.noex_mvp_v1.startDate === '2025-01-01');
  /* v0.8.0：引导结束直接进首页，未登录也不拦 */
  stored.noex_mvp_v1.user = null;
  wxLog.length = 0;
  ob.onEnter();
  check('onEnter 未登录也进首页（无登录墙）', wxLog.some(x => x[0] === 'switch' && x[1] === '/pages/today/today'));
  check('onEnter 已写 onboarded', stored.noex_mvp_v1.onboarded === true);

  /* 已登录 → 同样进首页 */
  stored.noex_mvp_v1.user = { nick: '小明', avatar: '', loginAt: Date.now() };
  wxLog.length = 0;
  ob.onEnter();
  check('onEnter 已登录 → switchTab 首页', wxLog.some(x => x[0] === 'switch' && x[1] === '/pages/today/today'));
}

console.log('\n========== today ==========');
{
  stored = {}; seedUser();
  const td = makePage(today);
  td.onShow();
  check('today onShow 设置 day', typeof td.data.day === 'number');
  check('today foxSay 不空', td.data.foxSay && td.data.foxSay.length > 0);
  td.onCheck();
  check('onCheck 设置 lastCheckIn', stored.noex_mvp_v1.lastCheckIn === util.todayStr());
  td.onCheck();
  check('onCheck 重复点击不重复打卡', stored.noex_mvp_v1.checkCount === 1);
  wxLog.length = 0;
  td.onRelapse();
  check('onRelapse 触发 toast', wxLog.some(x => x[0] === 'toast'));
  check('onRelapse 重置 startDate', stored.noex_mvp_v1.startDate === util.todayStr());
  check('onRelapse relapses=1', stored.noex_mvp_v1.relapses === 1);
  /* onCheck 已经写过 1 条鼓励，所以 onRelapse 后 gMsgs 至少 3 条 */
  check('onRelapse gMsgs 至少 +2 条', stored.noex_mvp_v1.gMsgs.length >= 3);
  check('onRelapse 写到小白对话（含哼开头）', stored.noex_mvp_v1.gMsgs.some(m => m.text.startsWith('哼')));
  td.onShowBottle();
  check('onShowBottle → /pages/bottle/bottle', wxLog.some(x => x[0] === 'nav' && x[1] === '/pages/bottle/bottle'));
  td.onChatXiaoBai();
  check('onChatXiaoBai → /pages/xiaobai/xiaobai', wxLog.some(x => x[0] === 'switch' && x[1] === '/pages/xiaobai/xiaobai'));
}

console.log('\n========== xiaobai ==========');
{
  stored = {}; seedUser();
  const xb = makePage(xiaobai);
  xb.onShow();
  check('xiaobai personas=4', xb.data.personas.length === 4);
  check('xiaobai 首次有开场消息', xb.data.msgs.length >= 1);
  check('xiaobai 第一个是 ai', xb.data.msgs[0].role === 'ai');

  xb.onInput({ detail: { value: '今天好累' } });
  check('onInput 设置 text', xb.data.text === '今天好累');

  xb.onPickPersona({ currentTarget: { dataset: { k: 'sharp' } } });
  check('onPickPersona 切到 sharp', stored.noex_mvp_v1.persona === 'sharp');
  check('onPickPersona 写 sys 提示', stored.noex_mvp_v1.gMsgs.some(m => m.role === 'sys'));

  xb.onTapChip({ currentTarget: { dataset: { c: '我想ta了' } } });
  check('onTapChip me 进入 msgs', xb.data.msgs.some(m => m.role === 'me' && m.text === '我想ta了'));
  const aiMsgs = xb.data.msgs.filter(m => m.role === 'ai').map(m => m.text);
  console.log('   └ ai 回复:', JSON.stringify(aiMsgs));
  /* sharp 池扩到 24 条后,1 次采样命中老关键词概率仅 ~33% → 30 次采样稳态断言 */
  let sharpHit = false;
  for (let i = 0; i < 30; i++) {
    stored = {}; seedUser();
    const xbLoop = makePage(xiaobai);
    xbLoop.onShow();
    xbLoop.onPickPersona({ currentTarget: { dataset: { k: 'sharp' } } });
    xbLoop.onTapChip({ currentTarget: { dataset: { c: '我想ta了' } } });
    const aiMsgsLoop = xbLoop.data.msgs.filter(m => m.role === 'ai').map(m => m.text);
    if (aiMsgsLoop.some(t => /(脑子|出息|手贱|肿眼泡|破戒|长记性|舍不得|戒不掉|联系人|翻聊天|置顶)/.test(t))) {
      sharpHit = true; break;
    }
  }
  check('onTapChip 30 次内 sharp 含毒舌尾巴(扩池后)', sharpHit);

  xb.onInput({ detail: { value: '睡不着' } });
  xb.onSend();
  check('onSend me 消息进入 msgs', xb.data.msgs.some(m => m.role === 'me' && m.text === '睡不着'));
  /* setTimeout 同步执行后，ai-temp 已被替换为 ai 回复 */
  check('onSend 后 ai 回复已生成', xb.data.msgs.some(m => m.role === 'ai' && m.text.length > 0));
}

console.log('\n========== yingzi ==========');
{
  stored = {}; seedUser();
  const yz = makePage(yingzi);
  yz.onShow();
  check('yingzi 默认 view 模式', yz.data.mode === 'view');
  check('yingzi shName 默认空', yz.data.shName === '');

  yz.onStart();
  check('onStart 切到 setup', yz.data.mode === 'setup');
  yz.onNameInput({ detail: { value: 'ta' } });
  check('onNameInput 设置 shName', yz.data.shName === 'ta');
  yz.onLogInput({ detail: { value: '今天好累真的好累啊'.repeat(15) } });
  check('onLogInput 设置 shLog', yz.data.shLog.length >= 100);
  yz.onGoAnalyze();
  check('onGoAnalyze 切到 analyze', yz.data.mode === 'analyze');
  yz.onCancelSetup();
  check('onCancelSetup 回 view', yz.data.mode === 'view');

  stored.noex_mvp_v1 = storage.defaultState();
  stored.noex_mvp_v1.startDate = util.todayStr();
  stored.noex_mvp_v1.user = { nick: '测试用户', avatar: '', loginAt: Date.now() };
  stored.noex_mvp_v1.shadow.enabled = true;
  stored.noex_mvp_v1.shadow.name = 'ta';
  yz.onShow();
  check('yingzi 启用后 canEnter=true', yz.data.canEnter === true);

  yz.onEnterChat();
  check('onEnterChat 切到 chat', yz.data.mode === 'chat');
  yz.onChatInput({ detail: { value: '想你' } });
  yz.onChatSend();
  check('onChatSend me 消息进入 msgs', yz.data.msgs.some(m => m.role === 'me' && m.text === '想你'));
  check('onChatSend 后 ai 回复已生成', yz.data.msgs.some(m => m.role === 'ai' && m.text.length > 0));

  yz.onSessionEndChat();
  check('onSessionEndChat 回 view', yz.data.mode === 'view');

  yz.onSessionEndToGuardian();
  check('onSessionEndToGuardian 触发 switchTab', wxLog.some(x => x[0] === 'switch' && x[1] === '/pages/xiaobai/xiaobai'));
}

console.log('\n========== me ==========');
{
  stored = {}; seedUser();
  const mp = makePage(me);
  mp.onShow();
  check('me onShow 设置 day', typeof mp.data.day === 'number');
  /* 下面测的是「未登录」流程：撤掉登录态再刷一次（不能直接 onShow，会被登录墙拦掉） */
  stored.noex_mvp_v1.user = null;
  mp.refresh();
  check('me 默认未登录', mp.data.logged === false);
  check('me 不再有 personas（性格已从小白页选）', mp.data.personas === undefined);

  /* 未登录：弹层打开后什么都不填，点了不该写库 */
  mp.onEditProfile();
  check('onEditProfile 打开登录弹层', mp.data.showLogin === true);
  wxLog.length = 0;
  mp.onProfileSave();
  check('空资料点保存不写 user', stored.noex_mvp_v1.user === null);
  check('空资料点保存有提示', wxLog.some(x => x[0] === 'toast'));

  /* 选头像 + 填昵称 → 登录 */
  mp.onChooseAvatar({ detail: { avatarUrl: 'wxfile://tmp_abc.png' } });
  check('onChooseAvatar 头像转存到永久目录', mp.data.tmpAvatar.indexOf('/fake/usr/') === 0);
  mp.onNickInput({ detail: { value: '  阿七  ' } });
  wxLog.length = 0;
  mp.onProfileSave();
  check('onProfileSave 写入 user', !!(stored.noex_mvp_v1 && stored.noex_mvp_v1.user));
  check('昵称已清洗（去首尾空格）', stored.noex_mvp_v1.user.nick === '阿七');
  check('头像路径已持久化', stored.noex_mvp_v1.user.avatar.indexOf('/fake/usr/') === 0);
  check('登录走了一次 wx.login', wxLog.some(x => x[0] === 'login'));
  check('保存后关闭弹层', mp.data.showLogin === false);
  mp.onShow();
  check('登录后 logged=true', mp.data.logged === true);
  check('登录后 nick 正确', mp.data.nick === '阿七');

  /* 退出登录 */
  mp.onLogoutAsk();
  check('onLogoutAsk 弹出确认', mp.data.showLogout === true);
  wxLog.length = 0;
  mp.onLogoutConfirm();
  check('onLogoutConfirm 清空 user', stored.noex_mvp_v1.user === null);
  check('onLogoutConfirm 删除头像文件', wxLog.some(x => x[0] === 'unlink'));
  check('onLogoutConfirm 不再跳登录墙（留在个人主页）', !wxLog.some(x => x[0] === 'relaunch'));
  check('退出后 logged=false', mp.data.logged === false);

  mp.onPickDate({ detail: { value: '2025-06-15' } });
  check('onPickDate 更新 startDate', stored.noex_mvp_v1.startDate === '2025-06-15');
  mp.onExInput({ detail: { value: '前任' } });
  check('onExInput 更新 exName', stored.noex_mvp_v1.exName === '前任');

  wxLog.length = 0;
  mp.onExport();
  check('onExport 触发 setClipboardData', wxLog.some(x => x[0] === 'clip'));
  mp.onClear();
  check('onClear 弹出 showClear', mp.data.showClear === true);
  mp.onClearCancel();
  check('onClearCancel 关闭弹层', mp.data.showClear === false);
  mp.onClear();
  mp.onClearConfirm();
  check('onClearConfirm 重置 state', stored.noex_mvp_v1.onboarded === false);

  mp.onGear();
  check('onGear 弹出 showGear', mp.data.showGear === true);
  mp.onCloseGear();
  check('onCloseGear 关闭弹层', mp.data.showGear === false);
}

console.log('\n========== bottle ==========');
{
  stored = {}; seedUser();
  const bt = makePage(bottle);
  bt.onShow();
  check('bottle 默认空 items', Array.isArray(bt.data.items) && bt.data.items.length === 0);

  bt.onInput({ detail: { value: '想说的话' } });
  bt.onSave();
  check('bottle onSave 写入 1 条', stored.noex_mvp_v1.bottle.length === 1);
  bt.onShow();
  check('bottle refresh items=1', bt.data.items.length === 1);

  bt.onInput({ detail: { value: '' } });
  wxLog.length = 0;
  bt.onSave();
  check('bottle 空字符串不写', stored.noex_mvp_v1.bottle.length === 1);
  check('bottle 空字符串提示', wxLog.some(x => x[0] === 'toast'));
}

console.log('\n========== 边界场景 ==========');
/* 1. xiaobai 空 send 不增 + 触发 toast */
{
  stored = {}; seedUser();
  const xb = makePage(xiaobai);
  xb.onShow();
  const m0 = xb.data.msgs.length;
  xb.onSend();
  check('xiaobai 空 send 不增 msgs', xb.data.msgs.length === m0);
  check('xiaobai 空 send 触发 toast', wxLog.some(x => x[0] === 'toast' && x[1] === '说点什么吧'));
}

/* 2. yingzi 短日志不进入 analyze */
{
  stored = {}; seedUser();
  const yz = makePage(yingzi);
  yz.onShow();
  yz.onStart();
  yz.onLogInput({ detail: { value: '太短' } });
  wxLog.length = 0;
  yz.onGoAnalyze();
  check('yingzi 日志太短提示', wxLog.some(x => x[0] === 'toast'));
  check('yingzi 日志太短不进入 analyze', yz.data.mode !== 'analyze');
}

/* 3. xiaobai 多次 send me 累积 */
{
  stored = {}; seedUser();
  const xb = makePage(xiaobai);
  xb.onShow();
  xb.onInput({ detail: { value: '今天' } }); xb.onSend();
  xb.onInput({ detail: { value: '睡不着' } }); xb.onSend();
  const meCount = xb.data.msgs.filter(m => m.role === 'me').length;
  check('xiaobai 多次 send me=2', meCount === 2, '实际 ' + meCount);
}

/* 4. me 换头像：旧头像文件要被删掉，避免本地文件越堆越多 */
{
  stored = {}; seedUser();
  const mp = makePage(me);
  mp.onShow();
  mp.onEditProfile();
  mp.onChooseAvatar({ detail: { avatarUrl: 'wxfile://tmp_1.png' } });
  mp.onNickInput({ detail: { value: '阿七' } });
  mp.onProfileSave();
  const first = stored.noex_mvp_v1.user.avatar;
  check('首次登录头像落在永久目录', first.indexOf('/fake/usr/') === 0);

  mp.onEditProfile();
  wxLog.length = 0;
  mp.onChooseAvatar({ detail: { avatarUrl: 'wxfile://tmp_2.png' } });
  check('换头像时删掉上一张头像文件', wxLog.some(x => x[0] === 'unlink' && x[1] === first));
  mp.onProfileSave();
  check('新头像仍是永久路径', stored.noex_mvp_v1.user.avatar.indexOf('/fake/usr/') === 0);
  check('换头像不影响戒断记录', stored.noex_mvp_v1.startDate !== undefined);
}

/* 5. today onCheck 重复点击 */
{
  stored = {}; seedUser();
  const td = makePage(today);
  td.onShow();
  td.onCheck();
  const ci1 = stored.noex_mvp_v1.checkCount;
  td.onCheck();
  check('today onCheck 重复不增加', stored.noex_mvp_v1.checkCount === ci1);
}

/* 6. today onRelapse 累计 */
{
  stored = {}; seedUser();
  const td = makePage(today);
  td.onShow();
  td.onRelapse(); td.onRelapse(); td.onRelapse();
  check('today onRelapse 3 次 relapses=3', stored.noex_mvp_v1.relapses === 3);
  check('today onRelapse 后 gMsgs = 6 条', stored.noex_mvp_v1.gMsgs.length === 6);
}

/* 7. 切人格后 sharp 回复不带安慰（多次采样确认尾巴池能命中） */
{
  const warm = guardian.guardianReply('我想 ta', 'warm');
  check('warm 不以「嗯，我在。」开头', !warm.text.startsWith('嗯，我在。'));

  /* 关键词必须覆盖毒舌池里足够多的条目：
     窄关键词(脑子|出息|手贱|肿眼泡|破戒|长记性)只命中 24 条里的 2 条 → 单次 8%，30 次仍 ~7% flaky。
     改用宽关键词（命中 7 条）+ 60 次采样 → flake < 1e-9。与 integration-test 保持一致。 */
  let sharpHit = false;
  for (let i = 0; i < 60 && !sharpHit; i++) {
    const r = guardian.guardianReply('我想 ta', 'sharp');
    if (/(脑子|出息|手贱|肿眼泡|破戒|长记性|舍不得|戒不掉|联系人|翻聊天|置顶)/.test(r.text)) {
      sharpHit = true;
    }
  }
  check('sharp 60 次内能命中毒舌尾巴（宽关键词）', sharpHit);
}

/* 8. crisis 关键词触发危机回复 */
{
  const r = guardian.guardianReply('我不想活了', 'warm');
  check('crisis 关键词触发', r.crisis === true);
}

/* 9. bottle 多条倒序 */
{
  stored = {}; seedUser();
  const bt = makePage(bottle);
  bt.onShow();
  bt.onInput({ detail: { value: '第一条' } }); bt.onSave();
  bt.onInput({ detail: { value: '第二条' } }); bt.onSave();
  bt.onShow();
  check('bottle items=2', bt.data.items.length === 2);
  check('bottle 最新在前', bt.data.items[0].text === '第二条');
}

/* 10. me.onClearConfirm 后 startDate 是今天 */
{
  stored = {}; seedUser();
  const mp = makePage(me);
  mp.onShow();
  mp.onClear(); mp.onClearConfirm();
  check('me 清空后 startDate 是今天', stored.noex_mvp_v1.startDate === util.todayStr());
}

/* 11. yingzi onPickSpeaker 没 _parseCache 时不崩 */
{
  stored = {}; seedUser();
  const yz = makePage(yingzi);
  yz.onShow();
  /* 在 setup 模式下没 parseCache 就点，应该不抛错 */
  yz.onStart();
  yz.onPickSpeaker({ currentTarget: { dataset: { sp: 'ta' } } });
  check('yingzi 无 parseCache 不崩', true);  /* 走到这里没抛就算通过 */
}

/* 12. yingzi 跨天刷新：不破坏根状态（P0 回归——曾把 shadow 子对象存成根） */
{
  stored = {}; seedUser();
  const yz = makePage(yingzi);
  yz.onShow();
  const S = stored.noex_mvp_v1;
  S.onboarded = true;
  S.startDate = '2026-01-01';
  S.gMsgs = [{ role: 'ai', text: 'hi', t: 1 }];
  S.bottle = [{ text: 'x', t: 1 }];
  S.shadow.enabled = true;
  S.shadow.sessionsDate = '2000-01-01'; /* 模拟跨天 */
  S.shadow.sessionsToday = 2;
  stored.noex_mvp_v1 = JSON.parse(JSON.stringify(S));
  yz.onShow(); /* refresh → 触发跨天重置路径 */
  const S2 = stored.noex_mvp_v1;
  check('跨天刷新后根字段 onboarded 保留', S2.onboarded === true);
  check('跨天刷新后 startDate 保留', S2.startDate === '2026-01-01');
  check('跨天刷新后 gMsgs 保留', Array.isArray(S2.gMsgs) && S2.gMsgs.length === 1);
  check('跨天刷新后 bottle 保留', Array.isArray(S2.bottle) && S2.bottle.length === 1);
  check('跨天刷新后 shadow.enabled 保留', S2.shadow.enabled === true);
  check('跨天后 sessionsToday 重置为 0', S2.shadow.sessionsToday === 0);
}

/* 13. yingzi 7 天未使用 → 打开页面即触发洞察；且只触发一次 */
{
  stored = {}; seedUser();
  const yz = makePage(yingzi);
  yz.onShow();
  const S = stored.noex_mvp_v1;
  S.shadow.enabled = true;
  S.shadow.firstUsedAt = Date.now() - 20 * 86400000;
  S.shadow.observation.lastUsedAt = Date.now() - 8 * 86400000; /* 8 天没用 */
  stored.noex_mvp_v1 = JSON.parse(JSON.stringify(S));
  yz.onShow(); /* refresh 应触发 no_use */
  check('7天未用 → 打开影子页触发洞察面板', yz.data.showReveal === true);
  check('洞察文案含「根本就不是 TA」', (yz.data.reveal && yz.data.reveal.text || '').indexOf('根本就不是 TA') > -1);
  check('触发原因 no_use', yz.data.reveal && yz.data.reveal.reason === 'no_use');
  check('revealTriggered 已持久化', stored.noex_mvp_v1.shadow.revealTriggered === true);
  yz.onRevealDismiss();
  check('关闭面板后 showReveal=false', yz.data.showReveal === false);
  yz.onShow();
  check('再次进入不重复触发', yz.data.showReveal === false);
}

/* 14. yingzi 聊天中切 tab 回来：保留 chat 模式（不丢会话） */
{
  stored = {}; seedUser();
  const yz = makePage(yingzi);
  yz.onShow();
  /* 快速启用影子 */
  yz.onStart();
  yz.onLogInput({ detail: { value: '嗯嗯今天好累呀'.repeat(10) } });
  yz.onGoAnalyze();
  yz.onEnterChat();
  check('进入 chat 模式', yz.data.mode === 'chat');
  yz.onShow(); /* 模拟切 tab 再回来 */
  check('切 tab 回来仍是 chat 模式', yz.data.mode === 'chat');
  check('回来后消息列表还在', yz.data.msgs.length >= 2);
}

/* 15. yingzi 已触发过洞察 → 手动按钮可再看（不误报「还不到时候」） */
{
  stored = {}; seedUser();
  const yz = makePage(yingzi);
  yz.onShow();
  const S = stored.noex_mvp_v1;
  S.shadow.enabled = true;
  S.shadow.firstUsedAt = Date.now() - 40 * 86400000;
  S.shadow.revealTriggered = true;
  S.shadow.revealReason = 'long_term';
  stored.noex_mvp_v1 = JSON.parse(JSON.stringify(S));
  yz.onShow();
  check('已触发过 → onShow 不再弹', yz.data.showReveal === false);
  wxLog.length = 0;
  yz.onRevealManual();
  check('手动按钮 → 重新打开洞察面板', yz.data.showReveal === true);
  check('手动重看不弹「还不到时候」', !wxLog.some(x => x[0] === 'toast' && /还不到时候/.test(x[1])));
}

/* 16. v0.8.0 软登录：浏览自由，用功能才提醒 ==================== */
section('16 · 软登录（v0.8.0）');

{
  stored = {};
  const S = storage.defaultState();
  S.startDate = util.todayStr();
  S.user = null;              /* 未登录 */
  stored.noex_mvp_v1 = S;

  /* 未登录时，页面 onShow 必须放行（不能跳登录页） */
  wxLog.length = 0;
  const tp = makePage(today);
  tp.onShow();
  check('未登录也能进首页', !wxLog.some(x => x[0] === 'relaunch'));
  check('未登录也能刷新出天数', typeof tp.data.day === 'number');

  /* 点「打卡」→ 弹登录提醒 */
  wxLog.length = 0;
  tp.onCheck();
  check('未登录点打卡 → 弹登录提醒', wxLog.some(x => x[0] === 'modal'));
  check('未登录点打卡 → 没写进打卡记录', stored.noex_mvp_v1.checkCount === 0);

  /* 提醒里点「去登录」→ 跳个人主页 */
  wxLog.length = 0;
  userMod.goLogin();
  check('去登录 → switchTab 个人主页', wxLog.some(x => x[0] === 'switch' && x[1] === '/pages/me/me'));
  check('去登录 → 置了 autoOpenLogin', appHolder.globalData.autoOpenLogin === true);

  /* 已登录 → 功能正常使用，不再弹提醒 */
  stored.noex_mvp_v1.user = { nick: '小明', avatar: '', loginAt: Date.now() };
  wxLog.length = 0;
  tp.onCheck();
  check('已登录点打卡 → 不弹提醒', !wxLog.some(x => x[0] === 'modal'));
  check('已登录点打卡 → 打卡成功', stored.noex_mvp_v1.checkCount === 1);
}

{
  stored = {}; seedUser();
  stored.noex_mvp_v1.user = null;
  wxLog.length = 0;
  const xb = makePage(xiaobai);
  xb.onShow();
  check('未登录也能进小白页', !wxLog.some(x => x[0] === 'relaunch'));
  xb.setData({ text: '想他了' });
  xb.onSend();
  check('未登录发消息 → 弹登录提醒', wxLog.some(x => x[0] === 'modal'));
}

{
  stored = {}; seedUser();
  stored.noex_mvp_v1.user = null;
  wxLog.length = 0;
  const bt = makePage(bottle);
  bt.onShow();
  check('未登录也能进留白瓶', !wxLog.some(x => x[0] === 'relaunch'));
  bt.setData({ text: '想说的话' });
  bt.onSave();
  check('未登录写瓶子 → 弹登录提醒', wxLog.some(x => x[0] === 'modal'));
}

{
  /* me 页：收到 autoOpenLogin 时自动展开登录卡 */
  stored = {};
  const S = storage.defaultState();
  S.startDate = util.todayStr();
  S.user = null;
  stored.noex_mvp_v1 = S;
  appHolder.globalData.autoOpenLogin = true;

  const mp2 = makePage(me);
  mp2.onShow();
  check('autoOpenLogin → 自动展开登录卡', mp2.data.showLogin === true);
  check('autoOpenLogin 用后即清除', appHolder.globalData.autoOpenLogin === false);
  check('未登录不弹登录卡之外的拦截', !wxLog.some(x => x[0] === 'relaunch'));

  /* 头像能力降级：拿不到 avatarUrl 时自动转相册，不能哑火 */
  const before = mp2.data.tmpAvatar;
  mp2.onChooseAvatar({ detail: {} });
  check('头像回调没拿到 url → 不崩溃', mp2.data.tmpAvatar === before);
}

{
  /* 头像/昵称能力开关 */
  stored = {}; seedUser();
  const mp3 = makePage(me);
  mp3.onShow();
  check('avaSupported 已下发', typeof mp3.data.avaSupported === 'boolean');
  check('nickSupported 已下发', typeof mp3.data.nickSupported === 'boolean');
}

console.log(`\n========== ${pass} passed, ${fail} failed ==========`);
if (issues.length) {
  console.log('\n失败项:');
  issues.forEach(i => console.log(' -', i));
}
process.exit(fail ? 1 : 0);
