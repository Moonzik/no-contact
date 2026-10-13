// _test/robust-test.js — ①异常兜底日志 + ②小白使用说明（v0.9.14）
//
// 查什么：
//   1. errlog 模块本身：写入 / 截断 / 条数封顶 / 短时间去重 / 多类型 / 清空 / 复制文本
//   2. errlog 的健壮性：异常输入、storage 抛错都不能把 App 带崩
//   3. 全局监听：install 把 onError / onUnhandledRejection / onPageNotFound / onMemoryWarning 都挂上
//      低版本基础库缺这些 API 时不能抛
//   4. app.js 接入：install 必须早于其他初始化（晚了就漏掉早期错误）
//   5. 「我」页：只有有记录时才出现入口；查看 / 复制 / 清空 / 清空所有数据时一并清掉
//   6. 小白页说明：首次自动展开、点收起后记「看过了」、以后不再自动弹、手动还能打开
//   7. 新增文案不碰审核红线词；两个 wxml 标签配平
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
let pass = 0, fail = 0;
const problems = [];
function check(name, cond, info) {
  if (cond) { pass++; }
  else {
    fail++;
    problems.push(name + (info === undefined ? '' : ' → ' + info));
    console.log('  ✗', name, info === undefined ? '' : info);
  }
}
function read(rel) { return fs.readFileSync(path.join(ROOT, rel), 'utf8'); }

/* ───────── wx mock ───────── */
const kv = {};
const log = { toast: [], modal: [], clip: '' };
let modalConfirm = true;
let throwOnSet = false;                 // 模拟 storage 写满
const listeners = {};                   // 捕获 install 注册的全局监听

global.wx = {
  getStorageSync: (k) => kv[k],
  setStorageSync: (k, v) => { if (throwOnSet) throw new Error('exceed storage'); kv[k] = v; },
  removeStorageSync: (k) => { delete kv[k]; },
  showToast: (o) => { log.toast.push((o && o.title) || ''); },
  showModal: (o) => {
    log.modal.push(o);
    if (o && o.success) o.success({ confirm: modalConfirm });
  },
  setClipboardData: (o) => {
    if (o && o.success) { log.clip = (o && o.data) || ''; o.success({}); }
  },
  getSystemInfoSync: () => ({
    brand: 'mockBrand', model: 'mockModel', system: 'mockOS 1.0',
    version: '8.0.0', SDKVersion: '2.32.3'
  }),
  onError: (fn) => { listeners.error = fn; },
  onUnhandledRejection: (fn) => { listeners.rejection = fn; },
  onPageNotFound: (fn) => { listeners.pageNotFound = fn; },
  onMemoryWarning: (fn) => { listeners.memory = fn; },
  /* me 页用到但本套件不深究的接口 */
  reLaunch: () => {},
  navigateTo: () => {},
  switchTab: () => {},
  removeSavedFile: (o) => { if (o && o.success) o.success({}); },
  getFileSystemManager: () => ({
    unlink: (o) => { if (o && o.success) o.success({}); },
    readFile: (o) => { if (o && o.success) o.success({ data: '' }); }
  })
};

const errlog = require(path.join(ROOT, 'utils/errlog.js'));
const storage = require(path.join(ROOT, 'utils/storage.js'));

/* 时间可控：去重逻辑依赖时间窗口，必须能"快进" */
let now = 1000000;
const realNow = Date.now;
Date.now = () => now;

/* ───────── 页面装载 ───────── */
function loadPage(rel) {
  let cfgObj = null;
  global.Page = (o) => { cfgObj = o; };
  global.getApp = () => ({ globalData: { version: '0.9.14' } });
  const abs = path.join(ROOT, rel);
  delete require.cache[require.resolve(abs)];
  require(abs);
  return cfgObj;
}
function mount(cfgObj) {
  const ctx = {};
  Object.keys(cfgObj).forEach((k) => {
    ctx[k] = typeof cfgObj[k] === 'function' ? cfgObj[k].bind(ctx) : cfgObj[k];
  });
  ctx.data = JSON.parse(JSON.stringify(cfgObj.data || {}));
  ctx.setData = function (o) { Object.assign(this.data, o); };
  return ctx;
}

/* ═══════════════ 1. errlog：模块与空态 ═══════════════ */
console.log('========== 1. errlog：模块与空态 ==========');
check('导出必要接口',
  ['install', 'log', 'all', 'count', 'clear', 'text', 'fmtT', 'short'].every((k) => typeof errlog[k] === 'function'));
check('初始 0 条', errlog.count() === 0);
check('空态文本可读', errlog.text().indexOf('没有记录') > -1, errlog.text().slice(0, 40));
check('空态也声明条数', errlog.text().indexOf('共 0 条') > -1);
check('清空返回成功', errlog.clear() === true);
check('条数上限是 20', errlog.MAX === 20);

/* ═══════════════ 2. 写入、字段与截断 ═══════════════ */
console.log('\n========== 2. errlog：写入与截断 ==========');
now = 1100000;
errlog.log('js', 'TypeError: a is not a function');
check('能记下一条', errlog.count() === 1);
{
  const one = errlog.all()[0];
  check('字段完整（时间/类型/摘要/次数）',
    typeof one.t === 'number' && one.type === 'js' && !!one.msg && one.n === 1);
  check('记下了机型无关的摘要', one.msg.indexOf('TypeError') > -1);
}
{
  const longMsg = 'x'.repeat(800);
  errlog.log('js', longMsg);
  const last = errlog.all()[errlog.all().length - 1];
  check('超长摘要被截断', last.msg.length <= errlog.MAX_MSG + 1, last.msg.length);
  check('截断留了省略号', last.msg.slice(-1) === '…');
}
{
  const before = errlog.count();
  errlog.log('js', '有错', 'y'.repeat(400));
  const last = errlog.all()[errlog.all().length - 1];
  check('补充信息也被截断', last.msg.length <= errlog.MAX_MSG + 130, last.msg.length);
  check('补充信息确实拼上了', last.msg.indexOf('有错') === 0);
  check('记一条不会多记', errlog.count() === before + 1);
}

/* ═══════════════ 3. 条数封顶 ═══════════════ */
console.log('\n========== 3. errlog：条数封顶（防把 storage 写爆） ==========');
errlog.clear();
for (let i = 0; i < errlog.MAX + 8; i++) {
  now += errlog.DEDUP_MS + 1;           // 拉开时间，避免命中去重
  errlog.log('js', '错误编号 ' + i);
}
check('条数封顶在 20', errlog.all().length === errlog.MAX, errlog.all().length);
check('丢的是最旧的那几条', errlog.all()[0].msg === '错误编号 8', errlog.all()[0].msg);
check('最新的还在', errlog.all()[errlog.all().length - 1].msg === '错误编号 27');

/* ═══════════════ 4. 短时间去重 ═══════════════ */
console.log('\n========== 4. errlog：重复错误只累加次数 ==========');
errlog.clear();
now = 2000000;
errlog.log('js', '同一个错误');
errlog.log('js', '同一个错误');
errlog.log('js', '同一个错误');
check('5 秒内重复只占一条', errlog.all().length === 1, errlog.all().length);
check('次数累加到 3', errlog.all()[0].n === 3, errlog.all()[0].n);

now += errlog.DEDUP_MS + 1;
errlog.log('js', '同一个错误');
check('超过时间窗后另起一条', errlog.all().length === 2, errlog.all().length);
check('新的一条次数重新算', errlog.all()[1].n === 1);

now += 10;
errlog.log('promise', '同一个错误');
check('不同类型分开计数', errlog.all().length === 3, errlog.all().length);

/* ═══════════════ 5. 健壮性（监控代码自己不能崩） ═══════════════ */
console.log('\n========== 5. errlog：异常输入不能把 App 带崩 ==========');
{
  const before = errlog.count();
  let threw = false;
  try {
    errlog.log(null);
    errlog.log(undefined);
    errlog.log('js', '');
    errlog.log('js', '   ');
    errlog.log('js', 12345);
    const circ = {}; circ.self = circ;
    errlog.log('js', circ);
    errlog.log(null, null);
  } catch (e) { threw = true; }
  check('奇怪输入不抛异常', !threw);
  check('空消息不占位（只记了数字和白板对象）', errlog.count() === before + 2,
    'before=' + before + ' now=' + errlog.count());
}
{
  /* 存储写满时：整条链路（写入 / 读取 / 生成文本）都不能抛。
     这里不断言"计数不变"——测试用的 mock getStorageSync 返回的是同一个对象引用，
     push 进去内存就被改了；真机微信每次都返回反序列化后的新对象，不存在这个现象。 */
  throwOnSet = true;
  let threw = false;
  try {
    errlog.log('js', '存储写不进去时');
    errlog.log('js', '存储写不进去时');
    const c = errlog.count();
    errlog.text();
    check('写失败后仍能读出计数', typeof c === 'number');
  } catch (e) { threw = true; }
  throwOnSet = false;
  check('storage 抛异常时全链路不抛', !threw);
}
check('short 能处理各种类型',
  errlog.short('abc') === 'abc' &&
  errlog.short(null) === '' &&
  errlog.short({ message: 'hi' }) === 'hi' &&
  errlog.short('a\n\n  b') === 'a b');
check('fmtT 合法时间戳正常格式化', /^\d{2}-\d{2} \d{2}:\d{2}$/.test(errlog.fmtT(1694400000000)),
  errlog.fmtT(1694400000000));
check('fmtT 非法值不吐乱码', errlog.fmtT(undefined) === '--' && errlog.fmtT(NaN) === '--',
  errlog.fmtT(undefined) + ' / ' + errlog.fmtT(NaN));
check('fmtT 脏字符串返回 --', errlog.fmtT('乱七八糟的时间') === '--', errlog.fmtT('乱七八糟的时间'));
check('fmtT 0 也给出合法格式', /^\d{2}-\d{2} \d{2}:\d{2}$/.test(errlog.fmtT(0)), errlog.fmtT(0));

/* ═══════════════ 6. 复制文本 ═══════════════ */
console.log('\n========== 6. errlog：给用户复制的文本 ==========');
errlog.clear();
errlog._setVer('0.9.14 (robust-v9.14)');
errlog.log('js', 'Boom 出问题了');
const txt = errlog.text();
check('有标题', txt.indexOf('【NOEX 运行记录】') > -1);
check('带版本号', txt.indexOf('0.9.14') > -1);
check('带设备信息（用户发来就能定位机型）',
  txt.indexOf('mockBrand') > -1 && txt.indexOf('2.32.3') > -1);
check('带条数', txt.indexOf('共 1 条') > -1);
check('类型显示成中文', txt.indexOf('脚本错误') > -1, txt.slice(0, 200));
check('带错误正文', txt.indexOf('Boom 出问题了') > -1);
check('多条时编号连续', (() => {
  errlog.clear();
  now += errlog.DEDUP_MS + 1; errlog.log('js', 'A');
  now += errlog.DEDUP_MS + 1; errlog.log('js', 'B');
  const t2 = errlog.text();
  return t2.indexOf('1. ') > -1 && t2.indexOf('2. ') > -1 && t2.indexOf('共 2 条') > -1;
})());

/* ═══════════════ 7. install：挂上全局监听 ═══════════════ */
console.log('\n========== 7. install：全局监听挂载 ==========');
errlog.clear();
now = 3000000;
check('install 返回 true', errlog.install('0.9.14', 'robust-v9.14') === true);
check('注册了 onError', typeof listeners.error === 'function');
check('注册了 onUnhandledRejection', typeof listeners.rejection === 'function');
check('注册了 onPageNotFound', typeof listeners.pageNotFound === 'function');
check('注册了 onMemoryWarning', typeof listeners.memory === 'function');

listeners.error(new Error('脚本炸了'));
{
  const last = errlog.all()[errlog.all().length - 1];
  check('onError 记成 js 类型', last.type === 'js', last && last.type);
  check('onError 存下 message', last.msg.indexOf('脚本炸了') > -1, last.msg);
}
listeners.error('这一版是纯字符串');
check('onError 兼容 string 参数',
  errlog.all()[errlog.all().length - 1].msg.indexOf('这一版是纯字符串') > -1);
listeners.rejection({ reason: { message: '异步炸了' } });
check('onUnhandledRejection 记成 promise',
  errlog.all()[errlog.all().length - 1].type === 'promise');
listeners.rejection({});
check('空 reason 也不炸',
  errlog.all()[errlog.all().length - 1].type === 'promise');
listeners.pageNotFound({ path: 'pages/notexist/x' });
check('onPageNotFound 记下路径',
  errlog.all()[errlog.all().length - 1].msg.indexOf('pages/notexist/x') > -1);
listeners.memory({ level: 10 });
check('onMemoryWarning 记成 memory',
  errlog.all()[errlog.all().length - 1].type === 'memory');
check('install 后版本号进了复制文本', errlog.text().indexOf('robust-v9.14') > -1);

console.log('\n========== 8. install：低版本基础库不抛 ==========');
{
  const backup = global.wx;
  const stripped = Object.assign({}, backup);
  delete stripped.onError;
  delete stripped.onUnhandledRejection;
  delete stripped.onPageNotFound;
  delete stripped.onMemoryWarning;
  global.wx = stripped;
  let threw = false, r = null;
  try { r = errlog.install('0.9.14', ''); } catch (e) { threw = true; }
  global.wx = backup;
  check('缺 API 时不抛', !threw);
  check('仍返回 true（装了能装的）', r === true);
}

/* ═══════════════ 9. app.js 接入 ═══════════════ */
console.log('\n========== 9. app.js 接入 ==========');
{
  const appJs = read('app.js');
  check('app.js 引入 errlog', /require\('\.\/utils\/errlog\.js'\)/.test(appJs));
  check('onLaunch 里调用 install',
    /errlog\.install\(this\.globalData\.version, this\.globalData\.build\)/.test(appJs));
  check('install 排在最前面（晚了会漏掉早期错误）',
    appJs.indexOf('errlog.install') > -1 &&
    appJs.indexOf('errlog.install') < appJs.indexOf('storage.initSessionTimer'),
    'install@' + appJs.indexOf('errlog.install') + ' initSessionTimer@' + appJs.indexOf('storage.initSessionTimer'));
  check('版本号已升到 0.9.16', /version:\s*'0\.9\.16'/.test(appJs));
  check('build 标记为 no-tone', /build:\s*'no-tone-v9\.16'/.test(appJs));
}

/* ═══════════════ 10. 「我」页：运行记录 ═══════════════ */
console.log('\n========== 10. 「我」页：运行记录入口 ==========');
{
  const meCfg = loadPage('pages/me/me.js');
  const me = mount(meCfg);

  kv['noex_mvp_v1'] = Object.assign(storage.defaultState(), { onboarded: true });
  errlog.clear();
  me.refresh();
  check('无异常时 errCount 为 0', me.data.errCount === 0, me.data.errCount);

  now += errlog.DEDUP_MS + 1;
  errlog.log('js', 'me 页测试错误');
  me.refresh();
  check('有异常时 errCount 反映条数', me.data.errCount === 1, me.data.errCount);

  me.onShowErrs();
  check('能打开弹层', me.data.showErrs === true);
  check('弹层里带了可复制的文本', me.data.errText.indexOf('me 页测试错误') > -1);
  check('复制文本里带版本号', me.data.errText.indexOf('0.9.14') > -1);

  log.clip = '';
  me.onCopyErrs();
  check('复制走了系统剪贴板', log.clip.indexOf('me 页测试错误') > -1);

  me.onCloseErrs();
  check('能关掉弹层', me.data.showErrs === false);

  /* 弹窗问一句再清，避免误触 */
  log.modal.length = 0;
  modalConfirm = false;
  errlog.clear();
  now += errlog.DEDUP_MS + 1;
  errlog.log('js', '不该被清掉的');
  me.onClearErrs();
  check('清空前先问一句', log.modal.length === 1);
  check('选「先留着」就不清', errlog.count() === 1, errlog.count());

  modalConfirm = true;
  me.onClearErrs();
  check('确认后清空', errlog.count() === 0);
  check('清空后计数归零', me.data.errCount === 0);
  check('清空后关掉弹层', me.data.showErrs === false);

  /* 「清空所有数据」要名副其实 */
  now += errlog.DEDUP_MS + 1;
  errlog.log('js', '清空数据前的残留');
  kv['noex_mvp_v1'] = Object.assign(storage.defaultState(), { onboarded: true });
  me.onClearConfirm();
  check('「清空所有数据」一并清掉运行记录', errlog.count() === 0, errlog.count());
}

console.log('\n========== 11. 「我」页：wxml / wxss ==========');
{
  const meWxml = read('pages/me/me.wxml');
  const meWxss = read('pages/me/me.wxss');
  check('入口只在有记录时渲染', /wx:if="\{\{errCount > 0\}\}"/.test(meWxml));
  check('入口绑定 onShowErrs', /bindtap="onShowErrs"/.test(meWxml));
  check('弹层绑定 showErrs', /wx:if="\{\{showErrs\}\}"/.test(meWxml));
  check('有复制按钮', /bindtap="onCopyErrs"/.test(meWxml));
  check('有清空按钮', /bindtap="onClearErrs"/.test(meWxml));
  check('有关闭按钮', /bindtap="onCloseErrs"/.test(meWxml));
  check('日志文本可长按选中', /<text user-select="true" class="err-text">/.test(meWxml));
  check('文案说明了数据没上传', /没有上传到任何地方/.test(meWxml));
  check('有日志容器样式', /\.err-box\s*\{/.test(meWxss));
  check('日志限高可滚（小屏不撑破）', /max-height:\s*46vh/.test(meWxss));
}

/* ═══════════════ 12. 小白说明：数据层 ═══════════════ */
console.log('\n========== 12. 小白说明：storage 字段 ==========');
check('defaultState 有新字段且默认 false',
  storage.defaultState().xiaobaiHowtoSeen === false);
{
  kv['noex_mvp_v1'] = { startDate: '2026-09-01' };
  check('老用户数据自动补 false', storage.load().xiaobaiHowtoSeen === false);
  kv['noex_mvp_v1'] = { startDate: '2026-09-01', xiaobaiHowtoSeen: 'yes' };
  check('脏值被纠正为 false', storage.load().xiaobaiHowtoSeen === false);
  kv['noex_mvp_v1'] = { startDate: '2026-09-01', xiaobaiHowtoSeen: true };
  check('已看过的保持 true', storage.load().xiaobaiHowtoSeen === true);
}

/* ═══════════════ 13. 小白说明：页面行为 ═══════════════ */
console.log('\n========== 13. 小白说明：展开与记忆 ==========');
{
  const xbCfg = loadPage('pages/xiaobai/xiaobai.js');
  const xb = mount(xbCfg);
  check('data 默认是收起的', xb.data.showHowto === false);

  kv['noex_mvp_v1'] = Object.assign(storage.defaultState(), { onboarded: true, persona: 'warm' });
  xb.onShow();
  check('第一次进来自动展开', xb.data.showHowto === true);

  xb.onToggleHowto();
  check('点一下能收起', xb.data.showHowto === false);
  check('收起后被标记为看过了', storage.load().xiaobaiHowtoSeen === true);

  xb.onShow();
  check('看过之后不再自动弹', xb.data.showHowto === false);

  xb.onToggleHowto();
  check('手动还能再打开', xb.data.showHowto === true);
  xb.onToggleHowto();
  check('再点一次又收起', xb.data.showHowto === false);

  /* 老用户（已标记看过）第一次进来不该被弹 */
  const xb2 = mount(loadPage('pages/xiaobai/xiaobai.js'));
  kv['noex_mvp_v1'] = Object.assign(storage.defaultState(), { onboarded: true, xiaobaiHowtoSeen: true });
  xb2.onShow();
  check('老用户不被打扰', xb2.data.showHowto === false);

  /* storage 读不到时不能崩 */
  kv['noex_mvp_v1'] = null;
  const xb3 = mount(loadPage('pages/xiaobai/xiaobai.js'));
  let threw = false;
  try { xb3.onShow(); } catch (e) { threw = true; }
  check('storage 异常时页面不崩', !threw);
}

console.log('\n========== 14. 小白说明：wxml / wxss ==========');
{
  const xbWxml = read('pages/xiaobai/xiaobai.wxml');
  const xbWxss = read('pages/xiaobai/xiaobai.wxss');
  check('说明块存在', /class="xb-help"/.test(xbWxml));
  check('开关绑定 onToggleHowto', /bindtap="onToggleHowto"/.test(xbWxml));
  check('内容受 showHowto 控制', /wx:if="\{\{showHowto\}\}"/.test(xbWxml));
  check('四段说明齐全', (xbWxml.match(/class="xh-sec"/g) || []).length === 4,
    (xbWxml.match(/class="xh-sec"/g) || []).length);
  check('有结尾的隐私交待', /class="xh-foot"/.test(xbWxml));
  check('提到了可切换语气', /宠溺/.test(xbWxml) && /毒舌/.test(xbWxml));
  check('说了「不会劝你放下」', /该放下了/.test(xbWxml));
  check('说了怎么说都行（降低开口门槛）', /跟我说什么都行/.test(xbWxml));
  check('隐私表述和「我」页口径一致（只存本机 + AI 会用到）',
    /只存在你自己的手机里/.test(xbWxml) && /用来生成回复/.test(xbWxml));
  check('有说明样式', /\.xb-help-body\s*\{/.test(xbWxss) && /\.xh-t\s*\{/.test(xbWxss));
  check('说明限高可滚', /max-height:\s*46vh/.test(xbWxss));
  check('说明区不被压缩（flex-shrink:0）', /\.xb-help\s*\{[^}]*flex-shrink:\s*0/.test(xbWxss));
}

/* ═══════════════ 15. 文案合规 ═══════════════ */
console.log('\n========== 15. 新增文案的审核红线 ==========');
{
  /* 和 audit-platform 同源的红线词，这里只查本次新增/改动的文案 */
  const BANNED = ['治愈', '根治', '疗效', '诊断', '抑郁症', '焦虑症', '处方',
    '咨询', '疏导', '疗愈', '心理治疗', '永久', '100%有效', '全网', '第一品牌', '打赏', '充值'];
  const meWxml = read('pages/me/me.wxml');
  const xbWxml = read('pages/xiaobai/xiaobai.wxml');
  const errJs = read('utils/errlog.js');

  check('「我」页文案无红线词', !BANNED.some((w) => meWxml.indexOf(w) > -1),
    BANNED.filter((w) => meWxml.indexOf(w) > -1).join(','));

  /* 说明块单独查：小白页原有文案里就有「危机」等词，不该被这次改动牵连 */
  const helpBlock = (xbWxml.match(/<view class="xb-help">[\s\S]*?<\/view>\s*<\/view>/) || [''])[0];
  check('小白说明块无红线词', helpBlock.length > 0 && !BANNED.some((w) => helpBlock.indexOf(w) > -1),
    BANNED.filter((w) => helpBlock.indexOf(w) > -1).join(',') || '未抓到说明块');

  /* 日志模块只扫中文字符串字面量（注释里的说明不算用户可见文案） */
  const lits = (errJs.match(/['"`][^'"`\n]*[\u4e00-\u9fa5][^'"`\n]*['"`]/g) || []).join('\n');
  check('日志模块可见文案无红线词', !BANNED.some((w) => lits.indexOf(w) > -1),
    BANNED.filter((w) => lits.indexOf(w) > -1).join(','));
  check('日志模块确实扫到了文案', lits.length > 0);
}

/* ═══════════════ 16. wxml 标签配平 ═══════════════ */
console.log('\n========== 16. wxml 结构 ==========');
['pages/me/me.wxml', 'pages/xiaobai/xiaobai.wxml'].forEach((rel) => {
  const s = read(rel).replace(/<!--[\s\S]*?-->/g, '');
  const open = (s.match(/<view\b/g) || []).length;
  const close = (s.match(/<\/view>/g) || []).length;
  check(rel + ' 的 view 标签配平', open === close, open + '/' + close);
});
{
  const meWxml = read('pages/me/me.wxml');
  const meMask = (meWxml.match(/<view class="mask"/g) || []).length;
  const meSheet = (meWxml.match(/<view class="sheet" catchtap="noop">/g) || []).length;
  check('「我」页每个弹层都配了 sheet', meMask === meSheet, meMask + '/' + meSheet);
}

/* ═══════════════ 收尾 ═══════════════ */
Date.now = realNow;
console.log('\n========================================');
console.log(`${pass} 项通过, ${fail} 项有问题`);
if (problems.length) {
  console.log('\n待处理清单:');
  problems.forEach((p, i) => console.log(`  ${i + 1}. ${p}`));
  process.exitCode = 1;
}
