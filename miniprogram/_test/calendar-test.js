// _test/calendar-test.js — 打卡日历（v0.9.12）
// 查什么：
//   1. utils/util.js 的日历计算：网格补位、状态归类（撑住 / 断过 / 未来 / 今天）、跨月连击
//   2. utils/storage.js 的新字段：老用户升级上来要自动补空数组，脏数据要过滤掉
//   3. today 页接入：打卡写入 checkLog、复发写入 relapseLog 且不重置历史
//   4. 页面结构：日历卡片、翻月按钮、图例、样式类
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
    console.log('  ✗', name, info || '');
  }
}
function read(rel) { return fs.readFileSync(path.join(ROOT, rel), 'utf8'); }

/* ── storage 需要在 wx 环境里跑，先装一个最小的 mock ── */
let store = null;
global.wx = {
  getStorageSync: () => store,
  setStorageSync: (k, v) => { store = v; },
  removeStorageSync: () => { store = null; }
};

const util = require(path.join(ROOT, 'utils/util.js'));
const storage = require(path.join(ROOT, 'utils/storage.js'));

console.log('========== 1. 日历网格 ==========');
/* 2026-09-01 是周二（周日打头 → 前面补 2 格），9 月 30 天 → 32 格 */
const cells = util.calendarOf(2026, 9, {}, {}, '2026-09-11');
check('9 月共 32 格（2 空格 + 30 天）', cells.length === 32, cells.length);
check('前 2 格是空白', cells[0].blank === true && cells[1].blank === true);
check('第 3 格是 1 号', cells[2].d === 1 && cells[2].blank === undefined);
check('空白格没有日期数字', cells[0].d === undefined);
check('每格都有 wx:key 用的 k', cells.every((c) => typeof c.k === 'string' && c.k));
check('2 月天数按真实月份（2026-02 平年 28 天）',
  util.calendarOf(2026, 2, {}, {}, '2026-09-11').filter((c) => !c.blank).length === 28);
check('闰年 2 月 29 天（2028-02）',
  util.calendarOf(2028, 2, {}, {}, '2026-09-11').filter((c) => !c.blank).length === 29);

console.log('\n========== 2. 每日状态 ==========');
const c2 = util.calendarOf(
  2026, 9,
  { '2026-09-11': 1, '2026-09-08': 1 },
  { '2026-09-10': 1, '2026-09-08': 1 },
  '2026-09-11'
);
function cellOf(list, d) { return list.filter((c) => c.d === d)[0]; }
check('打卡日标 on', cellOf(c2, 11).cls.indexOf('on') > -1);
check('今天额外标 today', cellOf(c2, 11).cls.indexOf('today') > -1);
check('同一天撑住又断过 → 显示断过（rel 优先）',
  cellOf(c2, 8).cls.indexOf('rel') > -1 && cellOf(c2, 8).cls.indexOf('on') === -1);
check('断过标 rel', cellOf(c2, 10).cls.indexOf('rel') > -1);
check('未来日期标 future', cellOf(c2, 12).cls.indexOf('future') > -1);
check('未来日期不会被标成打卡',
  cellOf(c2, 20).cls.indexOf('on') === -1 && cellOf(c2, 20).cls.indexOf('rel') === -1);
check('既没打卡也没断过的过去日 → 只有基础类', cellOf(c2, 5).cls === 'cal-cell');
check('每个格子都带 cal-cell 基础类', c2.every((c) => c.cls.indexOf('cal-cell') === 0));

console.log('\n========== 3. 统计与连击 ==========');
check('countInMonth 只数当月',
  util.countInMonth({ '2026-09-01': 1, '2026-09-11': 1, '2026-08-30': 1 }, 2026, 9) === 2);
check('countInMonth 空对象为 0', util.countInMonth({}, 2026, 9) === 0);
check('连击：3 连', util.longestStreak(['2026-09-01', '2026-09-02', '2026-09-03', '2026-09-10']) === 3);
check('连击：跨月不断', util.longestStreak(['2026-08-30', '2026-08-31', '2026-09-01']) === 3);
check('连击：乱序也正确', util.longestStreak(['2026-09-03', '2026-09-01', '2026-09-02']) === 3);
check('连击：同一天重复不算两天', util.longestStreak(['2026-09-02', '2026-09-02']) === 1);
check('连击：空数组为 0', util.longestStreak([]) === 0);
check('连击：undefined 不炸', util.longestStreak(undefined) === 0);
check('翻月：1 月往前 → 上一年 12 月',
  util.shiftMonth(2026, 1, -1).y === 2025 && util.shiftMonth(2026, 1, -1).m === 12);
check('翻月：12 月往后 → 下一年 1 月',
  util.shiftMonth(2026, 12, 1).y === 2027 && util.shiftMonth(2026, 12, 1).m === 1);
check('dateStr 补零', util.dateStr(2026, 9, 1) === '2026-09-01');

console.log('\n========== 4. storage 新字段 ==========');
const def = storage.defaultState();
check('默认含 checkLog 数组', Array.isArray(def.checkLog) && def.checkLog.length === 0);
check('默认含 relapseLog 数组', Array.isArray(def.relapseLog) && def.relapseLog.length === 0);

store = { startDate: '2026-09-01', checkCount: 5, checkLog: null, relapseLog: 'x' };
const migrated = storage.load();
check('老数据 checkLog=null → 补空数组', Array.isArray(migrated.checkLog) && migrated.checkLog.length === 0);
check('老数据 relapseLog 非法 → 补空数组', Array.isArray(migrated.relapseLog) && migrated.relapseLog.length === 0);

store = {
  startDate: '2026-09-01',
  checkLog: ['2026-09-01', '2026-09-01', 'not-a-date', '2026-9-2', '2026-09-03'],
  relapseLog: ['2026-09-05', '2026-09-05']
};
const cleaned = storage.load();
check('脏日期被过滤', cleaned.checkLog.indexOf('not-a-date') === -1 && cleaned.checkLog.indexOf('2026-9-2') === -1);
check('重复日期被去掉', cleaned.checkLog.length === 2, JSON.stringify(cleaned.checkLog));
check('复发记录同样去重', cleaned.relapseLog.length === 1);

console.log('\n========== 5. today 页接入 ==========');
const todayJs = read('pages/today/today.js');
const todayWxml = read('pages/today/today.wxml');
const todayWxss = read('pages/today/today.wxss');

check('today.js 有 renderCalendar', todayJs.indexOf('renderCalendar(') > -1);
check('refresh 里会重算日历', /nextMs:[\s\S]{0,60}?\}\);[\s\S]{0,40}?this\.renderCalendar\(S\);/.test(todayJs));
check('有上一月按钮 handler', todayJs.indexOf('onCalPrev()') > -1);
check('有下一月按钮 handler', todayJs.indexOf('onCalNext()') > -1);
check('翻月只重算日历不重跑 refresh',
  /onCalPrev\(\)[\s\S]{0,200}?this\.renderCalendar\(storage\.load\(\)\)/.test(todayJs));
check('打卡写入 checkLog', /onCheck\(\)[\s\S]{0,900}?checkLog\.push\(today\)/.test(todayJs));
check('打卡不重复写同一天', /checkLog\.indexOf\(today\) === -1/.test(todayJs));
check('复发写入 relapseLog', /relapseLog\.push\(S\.startDate\)/.test(todayJs));
/* onRelapse 段内不许出现 checkLog 清空——onCheck 里有 `S.checkLog = []` 的补默认写法，
   所以要限定范围，不能全文匹配 */
const relBody = todayJs.slice(
  todayJs.indexOf('onRelapse()'),
  todayJs.indexOf('onShowBottle')
);
check('复发不重置打卡历史（checkLog 是历史，不跟着归零）',
  relBody.indexOf('S.checkLog = []') === -1);
check('复发段内确实写入了 relapseLog', relBody.indexOf('relapseLog.push') > -1);
check('data 有星期表头', todayJs.indexOf("weekNames: ['日', '一', '二', '三', '四', '五', '六']") > -1);
check('data 有 calCells / calLabel / calFoot',
  todayJs.indexOf('calCells: []') > -1 && todayJs.indexOf('calLabel:') > -1 && todayJs.indexOf('calFoot:') > -1);
check('老用户会看到「从这次更新后开始记」的说明',
  todayJs.indexOf('日历从这次更新后开始记') > -1);

console.log('\n========== 6. 页面结构 ==========');
check('wxml 有日历卡片', todayWxml.indexOf('card cal-card') > -1);
check('wxml 绑定了翻月', todayWxml.indexOf('bindtap="onCalPrev"') > -1 && todayWxml.indexOf('bindtap="onCalNext"') > -1);
check('wxml 遍历 calCells', todayWxml.indexOf('wx:for="{{calCells}}"') > -1);
check('wxml 遍历用 k 做 key', todayWxml.indexOf('wx:key="k"') > -1);
check('wxml 空白格不渲染数字', todayWxml.indexOf('wx:if="{{!item.blank}}"') > -1);
check('wxml 星期表头 7 列', /cal-week[\s\S]{0,200}?weekNames/.test(todayWxml));
check('wxml 有图例', todayWxml.indexOf('cal-legend') > -1);
check('wxss 定义了三种格子状态',
  todayWxss.indexOf('.cal-cell.on .cal-d') > -1 &&
  todayWxss.indexOf('.cal-cell.rel .cal-d') > -1 &&
  todayWxss.indexOf('.cal-cell.today .cal-d') > -1);
check('wxss 未来日期变淡', todayWxss.indexOf('.cal-cell.future .cal-d') > -1);
check('wxss 7 列等宽', todayWxss.indexOf('width: 14.2857%') > -1);
check('日历在戒断刻度之后（不打断主信息流）',
  todayWxml.indexOf('ms-next') < todayWxml.indexOf('cal-card'));

console.log('\n========== ' + pass + ' 项通过, ' + fail + ' 项有问题 ==========');
if (problems.length) {
  console.log('\n问题清单:');
  problems.forEach((p) => console.log(' -', p));
}
process.exit(fail ? 1 : 0);
