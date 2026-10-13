// _test/gap2-test.js — 缺口二（v0.9.13）
// 查什么：
//   1. 文字日记：数据清洗（同一天只留一条 / 空串与脏日期丢弃 / 封顶 200 字）
//      + 页面接入（写入、二次修改不重复、删除、日历上标「写过日记」的点）
//   2. 备份还原：识别（空 / 非 JSON / 结构不对 / 不是本小程序 / 正常）
//      + 导入流程（先核对后覆盖、导入前自动快照、可撤销）
//   3. 换断联对象：本段归档、计数归零、影子清空、日记与留白瓶保留
//   4. 打卡提醒：模板 ID 未配时如实拒绝（不发假成功），配好后能记下订阅状态
//   5. 留白瓶仪式：封存写 openAt、封存中不显示正文、提前打开、销毁
//   6. 流量主广告位：AD_UNIT_ID 为空时整块不存在，配了才渲染
//   7. 新增文件不碰审核红线词
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
let pass = 0, fail = 0;
const problems = [];
function check(name, cond, info) {
  if (cond) { pass++; }
  else {
    fail++;
    problems.push(name + (info ? ' → ' + info : ''));
    console.log('  ✗', name, info === undefined ? '' : info);
  }
}
function read(rel) { return fs.readFileSync(path.join(ROOT, rel), 'utf8'); }

/* ───────── wx mock ───────── */
const kv = {};
const log = { toast: [], modal: [], sheet: [], clip: '' };
let modalConfirm = true;    // 弹窗默认点「确定」
let sheetPick = -1;         // ActionSheet 默认取消
let subAccept = true;       // 订阅消息默认同意
let subCalled = 0;

global.wx = {
  getStorageSync: (k) => kv[k],
  setStorageSync: (k, v) => { kv[k] = v; },
  removeStorageSync: (k) => { delete kv[k]; },
  showToast: (o) => { log.toast.push((o && o.title) || ''); },
  showModal: (o) => { log.modal.push(o); if (o && o.success) o.success({ confirm: modalConfirm }); },
  showActionSheet: (o) => { log.sheet.push(o); if (o && o.success && sheetPick >= 0) o.success({ tapIndex: sheetPick }); },
  getClipboardData: (o) => { if (o && o.success) o.success({ data: log.clip }); },
  setClipboardData: (o) => { if (o && o.success) o.success({}); },
  chooseMessageFile: (o) => { if (o && o.fail) o.fail({ errMsg: 'cancel' }); },
  getFileSystemManager: () => ({ readFile: (o) => { if (o && o.success) o.success({ data: '' }); } }),
  requestSubscribeMessage: (o) => {
    subCalled++;
    const id = o.tmplIds && o.tmplIds[0];
    if (o && o.success) {
      const r = {};
      r[id] = subAccept ? 'accept' : 'reject';
      o.success(r);
    }
  },
  getSystemInfoSync: () => ({ platform: 'devtools', system: 'mock', model: 'mock' })
};

const storage = require(path.join(ROOT, 'utils/storage.js'));
const util = require(path.join(ROOT, 'utils/util.js'));
const cfg = require(path.join(ROOT, 'utils/config.js'));
const notify = require(path.join(ROOT, 'utils/notify.js'));

/* ───────── 页面装载小工具 ─────────
   把 Page({...}) 的配置抓出来，绑到一个假 this 上，就能直接调方法断言行为。
   比只做静态文本匹配靠谱：这里是「跑」逻辑，不是「读」代码。 */
function loadPage(rel) {
  let cfgObj = null;
  global.Page = (o) => { cfgObj = o; };
  global.getApp = () => ({ globalData: { version: '0.9.13' } });
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
/* 造一个「已登录 + 有数据」的初始状态 */
function seed(extra) {
  const s = storage.defaultState();
  s.onboarded = true;
  s.user = { nick: '测试', avatar: '', phone: '', loginAt: 1, viaWx: false };
  s.startDate = util.todayStr();
  Object.assign(s, extra || {});
  kv['noex_mvp_v1'] = s;
  delete kv['noex_mvp_v1_prev'];
  return s;
}
function state() { return storage.load(); }
const TODAY = util.todayStr();

/* ───────── 1. 工具函数 ───────── */
console.log('========== 1. util：加年 / 短日期 ==========');
check('addYears 一年后', util.addYears('2026-09-11', 1) === '2027-09-11', util.addYears('2026-09-11', 1));
check('addYears 闰日顺延', util.addYears('2028-02-29', 1) === '2029-03-01', util.addYears('2028-02-29', 1));
check('addYears 非法输入原样返回', util.addYears('', 1) === '');
check('mdd 短日期', util.mdd('2026-09-11') === '9 月 11 日', util.mdd('2026-09-11'));
check('mdd 空值不炸', util.mdd('') === '' && util.mdd(undefined) === '');

/* ───────── 2. 文字日记：数据层 ───────── */
console.log('\n========== 2. 文字日记：数据清洗 ==========');
check('默认 diary 是空数组', Array.isArray(storage.defaultState().diary) && storage.defaultState().diary.length === 0);

const dirty = [
  { d: '2026-09-11', text: '  今天没联系  ' },
  { d: '2026-09-11', text: '改过的第二条' },   // 同一天，留最后一条
  { d: '2026-9-2', text: '格式不对' },
  { d: '2026-09-03', text: '   ' },            // 空白内容
  null,
  { d: '2026-09-01', text: '最早的一条' },
  { text: '没有日期' },
  123
];
const clean = storage.sanitizeDiary(dirty);
check('同一天只留最后一条', clean.filter((x) => x.d === '2026-09-11').length === 1);
check('留的是改过的那条', clean.filter((x) => x.d === '2026-09-11')[0].text === '改过的第二条');
check('脏日期被丢弃', clean.filter((x) => x.d === '2026-9-2').length === 0);
check('空白内容被丢弃', clean.filter((x) => x.d === '2026-09-03').length === 0);
check('非对象项被忽略', clean.length === 2, JSON.stringify(clean.map((x) => x.d)));
check('按日期升序', clean[0].d === '2026-09-01' && clean[1].d === '2026-09-11');
check('文字两端空格被去掉', clean[1].text === '改过的第二条');
check('超长内容截到 200 字',
  storage.sanitizeDiary([{ d: '2026-09-09', text: 'x'.repeat(500) }])[0].text.length === storage.MAX_DIARY_LEN);
check('非数组入参返回空数组', storage.sanitizeDiary('oops').length === 0 && storage.sanitizeDiary(undefined).length === 0);

kv['noex_mvp_v1'] = { startDate: '2026-09-01', diary: 'not-an-array' };
check('老数据 diary 非法 → 补空数组', Array.isArray(storage.load().diary));

kv['noex_mvp_v1'] = { startDate: '2026-09-01', diary: [] };
{
  const st = storage.load();
  for (let i = 0; i < 500; i++) {
    const d = new Date(2026, 0, 1 + i);
    st.diary.push({ d: util.dateStr(d.getFullYear(), d.getMonth() + 1, d.getDate()), text: '第' + i });
  }
  storage.save(st);
}
check('日记数量封顶 400 条', kv['noex_mvp_v1'].diary.length === 400, kv['noex_mvp_v1'].diary.length);

/* ───────── 3. 文字日记：页面 ───────── */
console.log('\n========== 3. 文字日记：今天页 ==========');
seed();
const todayCfg = loadPage('pages/today/today.js');
const today = mount(todayCfg);
today.refresh();
check('refresh 后 diaryCount 为 0', today.data.diaryCount === 0);
check('data 里有 taAlive（原生 textarea 重建用）', today.data.taAlive === true);
check('往期默认是收起的', today.data.diaryOpen === false);

/* 没登录不让写（和打卡、留白瓶一个口径） */
kv['noex_mvp_v1'] = Object.assign(storage.defaultState(), { startDate: TODAY, user: null });
today.refresh();
today.onDiaryInput({ detail: { value: '未登录时写的' } });
today.onDiarySave();
check('未登录写日记被拦下', state().diary.length === 0, JSON.stringify(state().diary));
check('未登录会引导去登录', log.modal[log.modal.length - 1].title === '需要登录');
seed();
today.refresh();

/* 改到一半的字不会被 refresh 冲掉 */
today.onDiaryInput({ detail: { value: '输入到一半' } });
today.refresh();
check('未保存的编辑被保留', today.data.diaryText === '输入到一半', today.data.diaryText);
today.onDiaryInput({ detail: { value: '' } });
today.refresh();

today.onDiaryInput({ detail: { value: '今天路过那家店，没停下来。' } });
today.onDiarySave();
let S = state();
check('写日记落库', S.diary.length === 1 && S.diary[0].d === TODAY, JSON.stringify(S.diary));
check('落库内容正确', S.diary[0].text === '今天路过那家店，没停下来。');

today.refresh();
check('refresh 带出今天已写内容', today.data.diarySaved === '今天路过那家店，没停下来。');
check('diaryCount 变成 1', today.data.diaryCount === 1);

today.onDiaryInput({ detail: { value: '改一下，今天没哭。' } });
today.onDiarySave();
S = state();
check('二次保存是更新不是新增', S.diary.length === 1, JSON.stringify(S.diary));
check('二次保存内容被替换', S.diary[0].text === '改一下，今天没哭。');

today.onDiaryInput({ detail: { value: '   ' } });
const before = JSON.stringify(state().diary);
today.onDiarySave();
check('空白内容不写库', JSON.stringify(state().diary) === before);
check('空白内容有提示', log.toast[log.toast.length - 1].indexOf('先写点什么') > -1);

/* 日历上的「写过日记」小点 */
today.refresh();
{
  const dayNum = parseInt(TODAY.split('-')[2], 10);
  const cell = today.data.calCells.filter((c) => c.d === dayNum)[0];
  check('今天的格子里标了 note', !!cell && cell.cls.indexOf('note') > -1, cell && cell.cls);
}

/* 点格子回看 */
today.onCalTap({ currentTarget: { dataset: { d: TODAY } } });
check('点有日记的格子会弹出来', log.modal[log.modal.length - 1].content.indexOf('没哭') > -1);

/* 删除今天这一句 */
modalConfirm = true;
today.onDiaryDeleteToday();
check('删掉今天这一句', state().diary.length === 0, JSON.stringify(state().diary));
today.refresh();
check('删完后输入框被清空', today.data.diaryText === '' && today.data.diarySaved === '');
check('rebuildDiaryBox 会先卸掉 textarea', todayCfg.rebuildDiaryBox !== undefined &&
  read('pages/today/today.wxml').indexOf('wx:if="{{taAlive}}"') > -1);

/* 往期列表 */
seed({ diary: [
  { d: '2026-09-01', text: '第一天' },
  { d: '2026-09-05', text: '第五天' },
  { d: TODAY, text: '今天' }
] });
today.refresh();
check('往期不含今天', today.data.diaryList.length === 2 &&
  today.data.diaryList.every((x) => x.d !== TODAY), JSON.stringify(today.data.diaryList.map((x) => x.d)));
check('往期新的在前', today.data.diaryList[0].d === '2026-09-05');
check('往期带中文日期', today.data.diaryList[0].label === '9 月 5 日', today.data.diaryList[0].label);
today.onToggleDiary();
check('能展开往期', today.data.diaryOpen === true);
today.onToggleDiary();
check('能收起往期', today.data.diaryOpen === false);

const todayWxml = read('pages/today/today.wxml');
const todayJs = read('pages/today/today.js');
check('wxml 有日记卡片', todayWxml.indexOf('card diary-card') > -1);
check('日记输入框受 taAlive 控制', /diary-ta[\s\S]{0,200}?wx:if|wx:if="\{\{taAlive\}\}"[\s\S]{0,200}?diary-ta/.test(todayWxml));
check('wxml 有封存入口无关的保存按钮', todayWxml.indexOf('bindtap="onDiarySave"') > -1);
check('wxml 有删除今天的入口', todayWxml.indexOf('bindtap="onDiaryDeleteToday"') > -1);
check('wxml 有往期展开', todayWxml.indexOf('bindtap="onToggleDiary"') > -1);
check('wxml 日历格子可点', /calCells[\s\S]{0,120}?bindtap="onCalTap"/.test(todayWxml));
check('wxml 图例含「写过日记」', todayWxml.indexOf('lg-dot note') > -1 && todayWxml.indexOf('写过日记') > -1);
check('wxss 有 note 小点样式', read('pages/today/today.wxss').indexOf('.cal-cell.note .cal-d::after') > -1);
check('today.js 用 storage.MAX_DIARY_LEN 截断', todayJs.indexOf('storage.MAX_DIARY_LEN') > -1);
check('today.js 日记写入前要求登录', /onDiarySave\(\)[\s\S]{0,120}?requireLogin/.test(todayJs));

/* ───────── 4. 备份还原 ───────── */
console.log('\n========== 4. 备份还原 ==========');
check('空字符串 → empty', storage.validateBackup('   ').reason === 'empty');
check('非 JSON → parse', storage.validateBackup('{ 这不是 json').reason === 'parse');
check('数组 → shape', storage.validateBackup([1, 2]).reason === 'shape');
check('随便一段 JSON → not_backup', storage.validateBackup('{"a":1,"b":2}').ok === false);
check('只有一个特征字段也不认', storage.validateBackup('{"startDate":"2026-09-01","a":1}').reason === 'not_backup');

const backup = {
  startDate: '2026-08-01',
  checkCount: 12,
  relapses: 2,
  checkLog: ['2026-08-01'],
  relapseLog: ['2026-08-10'],
  gMsgs: [{ role: 'me', text: 'x' }],
  bottle: [{ t: '2026-08-02', text: 'y' }],
  diary: [{ d: '2026-08-03', text: 'z' }],
  segments: [{ exName: '前任', startDate: '2026-01-01', endDate: '2026-02-01', days: 32 }],
  shadow: { enabled: true, name: 'TA' },
  user: { nick: '小王', avatar: 'a.png' }
};
const bStr = JSON.stringify(backup);
const v = storage.validateBackup(bStr);
check('正常备份被接受', v.ok === true, JSON.stringify(v));
check('摘要：开始日', v.summary.startDate === '2026-08-01');
check('摘要：打卡/断过', v.summary.checkCount === 12 && v.summary.relapseCount === 2);
check('摘要：对话/留白瓶/日记', v.summary.msgCount === 1 && v.summary.bottleCount === 1 && v.summary.diaryCount === 1);
check('摘要：过往段数', v.summary.segmentCount === 1);
check('摘要：影子是否开着', v.summary.shadowOn === true);
check('摘要：是否含登录信息', v.summary.hasUser === true);
check('传对象也认（不只接受字符串）', storage.validateBackup(backup).ok === true);

/* 老备份缺新字段 → applyBackup 后自动补齐 */
seed({ diary: [{ d: TODAY, text: '会被覆盖' }] });
const legacy = { startDate: '2026-07-01', checkLog: ['2026-07-01'], gMsgs: [] };
storage.applyBackup(legacy);
check('导入后 startDate 变成备份里的', state().startDate === '2026-07-01');
check('导入旧备份自动补 diary 数组', Array.isArray(state().diary));
check('导入旧备份自动补 segments 数组', Array.isArray(state().segments));
check('导入旧备份自动补 reminder 对象', state().reminder && state().reminder.on === false);

/* 快照 / 撤销 */
check('快照写入后能读到', storage.snapshotPrev(state()) === true && storage.loadPrev().length > 0);
storage.clearPrev();
check('清除快照后读不到', storage.loadPrev() === '');

/* ───────── 5. 我页：导入流程 ───────── */
console.log('\n========== 5. 我页：导入流程 ==========');
const meCfg = loadPage('pages/me/me.js');
const me = mount(meCfg);
const original = seed({ diary: [{ d: TODAY, text: '原始数据' }] });
me.refresh();
check('我页能读到过往段数量', me.data.segCount === 0);
check('提醒未配置时 reminderReady=false', me.data.reminderReady === false);

me.onImportBackup();
check('打开导入弹层', me.data.showImport === true && me.data.importSummary === null);

log.clip = '{"hello":1}';
me.onImportFromClipboard();
check('认不出来时给说明', me.data.importErr.indexOf('不是本小程序的备份') > -1, me.data.importErr);
check('认不出来时不写库', JSON.stringify(state().diary) === JSON.stringify(original.diary));

log.clip = bStr;
me.onImportFromClipboard();
check('正确备份 → 出摘要', !!me.data.importSummary && me.data.importErr === '');
check('出摘要时仍未覆盖数据', state().startDate !== '2026-08-01');

log.clip = '{坏掉的 json';
me.onImportFromClipboard();
check('坏 JSON 给出解析失败提示', me.data.importErr.indexOf('JSON') > -1, me.data.importErr);

log.clip = bStr;
me.onImportFromClipboard();
me.onImportConfirm();
check('确认后数据被覆盖', state().startDate === '2026-08-01');
check('导入后自动留了快照', storage.loadPrev().length > 0);
me.refresh();
check('刷新后 prevExists=true', me.data.prevExists === true);

modalConfirm = true;
me.onImportUndo();
check('撤销后回到导入前的数据', state().startDate === original.startDate);
check('撤销后清掉快照', me.data.prevExists === false);

const meWxml = read('pages/me/me.wxml');
const meJs = read('pages/me/me.js');
check('wxml 有导入备份入口', meWxml.indexOf('bindtap="onImportBackup"') > -1);
check('wxml 有剪贴板/文件两条来源', meWxml.indexOf('onImportFromClipboard') > -1 && meWxml.indexOf('onImportFromFile') > -1);
check('wxml 有待确认的摘要区', meWxml.indexOf('imp-sum') > -1 && meWxml.indexOf('onImportConfirm') > -1);
check('wxml 有撤销入口（条件显示）', /prevExists[\s\S]{0,80}?onImportUndo/.test(meWxml));
check('导出先复制再导入不会互相踩（导入读剪贴板只在点击时）',
  /onImportFromClipboard\(\)[\s\S]{0,300}?getClipboardData/.test(meJs));

/* ───────── 6. 换断联对象 ───────── */
console.log('\n========== 6. 换断联对象 ==========');
seed({
  exName: '前任',
  startDate: '2026-08-20',
  checkCount: 20,
  relapses: 1,
  checkLog: ['2026-08-20', '2026-08-21'],
  relapseLog: ['2026-08-25'],
  diary: [{ d: TODAY, text: '我的日记' }],
  bottle: [{ t: TODAY, text: '我的留白瓶' }],
  shadow: { enabled: true, name: 'TA', profile: { a: 1 }, msgs: [{ role: 'me', text: 'hi' }] }
});
me.refresh();
me.onNewSegment();
check('打开「开始新的一段」确认', me.data.showNewSeg === true);
me.onNewSegmentConfirm();
S = state();
check('本段被归档', S.segments.length === 1, JSON.stringify(S.segments));
check('归档含代号', S.segments[0].exName === '前任');
check('归档含起止日期', S.segments[0].startDate === '2026-08-20' && S.segments[0].endDate === TODAY);
check('归档含天数与打卡数', S.segments[0].days > 0 && S.segments[0].checkCount === 20);
check('归档含复发次数', S.segments[0].relapses === 1);
check('归档含日期列表（可回看）', S.segments[0].checkLog.length === 2);
check('计数归零', S.checkCount === 0 && S.relapses === 0);
check('断联天数从今天重新开始', S.startDate === TODAY);
check('打卡日历清零', S.checkLog.length === 0 && S.relapseLog.length === 0);
check('打卡标记也清掉', S.lastCheckIn === '');
check('TA 的代号清空', S.exName === '');
check('影子被清空（他认的是人）', S.shadow.enabled === false && (S.shadow.msgs || []).length === 0);
check('日记保留（是你自己的东西）', S.diary.length === 1 && S.diary[0].text === '我的日记');
check('留白瓶保留', S.bottle.length === 1 && S.bottle[0].text === '我的留白瓶');

me.refresh();
check('refresh 后能看到 1 段过往', me.data.segCount === 1);
me.onShowSegs();
check('过往列表能展开', me.data.showSegs === true && me.data.segList.length === 1);
check('过往列表内容对', me.data.segList[0].name === '前任' && me.data.segList[0].note.indexOf('一次没断') === -1,
  JSON.stringify(me.data.segList[0]));

kv['noex_mvp_v1'] = { startDate: TODAY, segments: new Array(25).fill({ startDate: '2026-01-01', endDate: '2026-01-02' }) };
storage.save(storage.load());
check('过往段封顶 20 条', kv['noex_mvp_v1'].segments.length === 20, kv['noex_mvp_v1'].segments.length);
check('wxml 有开始新的一段入口', meWxml.indexOf('onNewSegment') > -1);
check('wxml 有过往记录入口', meWxml.indexOf('onShowSegs') > -1);

/* ───────── 7. 打卡提醒 ───────── */
console.log('\n========== 7. 打卡提醒（订阅消息） ==========');
check('默认没有模板 ID', cfg.REMINDER_TMPL_ID === '' && notify.configured() === false);
check('当前环境支持订阅消息', notify.supported() === true || typeof wx.requestSubscribeMessage === 'function');

let r1 = null;
notify.request((ok, reason) => { r1 = { ok: ok, reason: reason }; });
check('未配置模板时不发假成功', r1.ok === false && r1.reason === 'off');

seed();
me.refresh();
me.onReminder();
check('未配置时给的是说明弹层，不是订阅', me.data.showReminder === true);
me.onCloseReminder();
check('说明弹层能关', me.data.showReminder === false);

cfg.REMINDER_TMPL_ID = 'tmpl-test-1';
notify.request((ok, reason) => { r1 = { ok: ok, reason: reason }; });
check('配好模板后订阅成功', r1.ok === true && r1.reason === 'ok');
subAccept = false;
notify.request((ok, reason) => { r1 = { ok: ok, reason: reason }; });
check('用户拒绝 → deny（不报错）', r1.ok === false && r1.reason === 'deny');

subAccept = true;
me.refresh();
check('配好模板后 reminderReady=true', me.data.reminderReady === true);
me.onReminder();
check('订阅成功后记下状态', state().reminder.on === true && state().reminder.at > 0);
check('订阅走的是记录在案的模板 ID', subCalled > 0);
check('wxml 有提醒入口', meWxml.indexOf('bindtap="onReminder"') > -1);
check('wxml 有未配置说明弹层', meWxml.indexOf('onCloseReminder') > -1);
cfg.REMINDER_TMPL_ID = '';   // 复原，别影响别的套件

/* ───────── 8. 留白瓶仪式 ───────── */
console.log('\n========== 8. 留白瓶仪式 ==========');
seed();
const bottleCfg = loadPage('pages/bottle/bottle.js');
const bottle = mount(bottleCfg);
bottle.onShow();
check('bottle 页能读起状态', bottle.data.total === 0);
check('sealHint 是「一年后」的日期', bottle.data.sealHint === util.mdd(util.addYears(TODAY, 1)), bottle.data.sealHint);

bottle.onInput({ detail: { value: '普通的一句' } });
bottle.onSave();
check('普通保存不带封存字段', state().bottle.length === 1 && !state().bottle[0].openAt);

bottle.onToggleSeal();
check('勾上封存', bottle.data.sealOn === true);
bottle.onInput({ detail: { value: '一年后再看的一句' } });
bottle.onSave();
S = state();
check('封存保存写入 openAt', S.bottle[1].openAt === util.addYears(TODAY, 1), JSON.stringify(S.bottle[1]));
check('封存保存写入 sealedAt', typeof S.bottle[1].sealedAt === 'number' && S.bottle[1].sealedAt > 0);
check('保存后勾选状态复位', bottle.data.sealOn === false);
check('提示语说清什么时候能打开',
  log.toast[log.toast.length - 1].indexOf('再打开') > -1, log.toast[log.toast.length - 1]);

bottle.refresh();
{
  const locked = bottle.data.items.filter((x) => x.locked)[0];
  const open = bottle.data.items.filter((x) => !x.locked && x.sealed === false)[0];
  check('有封存中的一条', !!locked);
  check('封存中标记 locked + 状态文案', locked.state.indexOf('封存中') > -1, locked && locked.state);
  check('封存计数正确', bottle.data.sealedCount === 1, bottle.data.sealedCount);
  check('未封存的照常显示', !!open && open.text === '普通的一句');
}

/* 封存中的条目：点一下只提示，不显示正文 */
bottle.onItemTap({ currentTarget: { dataset: { k: 1 } } });
check('点封存中的条目只提示打不开',
  log.toast[log.toast.length - 1].indexOf('封存中') > -1, log.toast[log.toast.length - 1]);

/* 长按 → 提前打开 */
sheetPick = 0;
modalConfirm = true;
bottle.onItemAction({ currentTarget: { dataset: { k: 1 } } });
check('ActionSheet 第一项是「提前打开」', log.sheet[log.sheet.length - 1].itemList[0].indexOf('提前打开') > -1,
  JSON.stringify(log.sheet[log.sheet.length - 1].itemList));
check('提前打开后 openAt 被移除', !state().bottle[1].openAt);
check('提前打开后正文可见', state().bottle[1].text === '一年后再看的一句');

/* 长按 → 销毁 */
sheetPick = 1;
bottle.refresh();
const beforeCount = state().bottle.length;
bottle.onItemAction({ currentTarget: { dataset: { k: 0 } } });
check('销毁会先问一次', log.modal[log.modal.length - 1].title.indexOf('销毁') > -1);
check('确认后条目被删', state().bottle.length === beforeCount - 1, state().bottle.length);
check('销毁文案不含「永久」等绝对化用语',
  log.modal[log.modal.length - 1].content.indexOf('永久') === -1);

modalConfirm = false;
const keep = state().bottle.length;
bottle.onItemAction({ currentTarget: { dataset: { k: 0 } } });
check('取消就不删', state().bottle.length === keep);
modalConfirm = true;
sheetPick = -1;   // 复原

/* 未封存条目长按 → 第一项是「封存」 */
bottle.refresh();
bottle.onItemAction({ currentTarget: { dataset: { k: 0 } } });
sheetPick = 0;
bottle.onItemAction({ currentTarget: { dataset: { k: 0 } } });
check('未封存条目第一项是封存', state().bottle[0].openAt === util.addYears(TODAY, 1));
sheetPick = -1;

const bottleWxml = read('pages/bottle/bottle.wxml');
check('wxml 有封存勾选', bottleWxml.indexOf('onToggleSeal') > -1 && bottleWxml.indexOf('seal-box') > -1);
check('wxml 有长按操作', bottleWxml.indexOf('bindlongpress="onItemAction"') > -1);
check('wxml 封存中不显示正文', /item\.locked[\s\S]{0,160}?bi-locked/.test(bottleWxml));
check('wxml 有瓶子状态统计', bottleWxml.indexOf('sealedCount') > -1);
check('wxss 有封存中的样式', read('pages/bottle/bottle.wxss').indexOf('.bottle-item.locked') > -1);

/* ───────── 9. 流量主广告位 ───────── */
console.log('\n========== 9. 流量主广告位预留 ==========');
check('默认没有广告位 ID', cfg.AD_UNIT_ID === '');
seed();
const t2 = mount(loadPage('pages/today/today.js'));
t2.onShow();
check('未配 ID 时今天页不渲染广告', t2.data.adShow === false, t2.data.adShow);
cfg.AD_UNIT_ID = 'adunit-verify-1';
t2.onShow();
check('配了 ID 才渲染', t2.data.adShow === true && t2.data.adUnitId === 'adunit-verify-1');
const b2 = mount(loadPage('pages/bottle/bottle.js'));
b2.onShow();
check('留白瓶页同规则', b2.data.adShow === true);
cfg.AD_UNIT_ID = '';
b2.onShow();
check('清掉 ID 后不再渲染', b2.data.adShow === false);
check('广告位有加载失败兜底', todayJs.indexOf('onAdError') > -1 && read('pages/bottle/bottle.js').indexOf('onAdError') > -1);
check('today wxml 广告块受 adShow 控制', /adShow[\s\S]{0,120}?<ad unit-id/.test(todayWxml));
check('bottle wxml 广告块受 adShow 控制', /adShow[\s\S]{0,120}?<ad unit-id/.test(bottleWxml));

/* ───────── 10. 新增文件的合规扫描 ───────── */
console.log('\n========== 10. 新代码不碰红线词 ==========');
const NEW_FILES = [
  'utils/config.js', 'utils/notify.js', 'utils/storage.js', 'utils/util.js',
  'pages/today/today.js', 'pages/today/today.wxml', 'pages/me/me.js', 'pages/me/me.wxml',
  'pages/bottle/bottle.js', 'pages/bottle/bottle.wxml'
];
/* 去掉注释再扫：注释里的说明文字不该被当成文案 */
function stripComments(s) {
  return s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`\\])\/\/[^\n]*/g, '$1');
}
const RED = ['治愈', '根治', '疗效', '心理治疗', '抑郁', '焦虑症', '永久', '100%', '最好的', '充值', '购买会员', '打赏'];
RED.forEach((w) => {
  let hit = '';
  NEW_FILES.forEach((f) => {
    const s = f.endsWith('.wxml') ? read(f) : stripComments(read(f));
    if (s.indexOf(w) > -1) hit = f;
  });
  check('新代码不出现「' + w + '」', hit === '', hit);
});
check('配置项里如实写清「配之前不生效」',
  read('utils/config.js').indexOf('还没配') > -1 || read('utils/config.js').indexOf('空着的意思') > -1);

/* ───────── 汇总 ───────── */
console.log('\n========== ' + pass + ' 项通过, ' + fail + ' 项有问题 ==========');
if (problems.length) {
  console.log('\n问题清单:');
  problems.forEach((p) => console.log(' -', p));
}
process.exit(fail ? 1 : 0);
