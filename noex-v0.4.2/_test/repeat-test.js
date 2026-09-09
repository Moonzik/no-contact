/**
 * _test/repeat-test.js — 回复重复度检测 + 强制登录 / 每日一句 回归
 * 运行：node _test/repeat-test.js
 *
 * 背景：用户反馈「和小白/影子聊天时重复的话太多」。
 * 这个脚本用真实调用路径（guardianReply / shadowReply）跑大量对话，
 * 统计重复率，并验证「去重直到清空数据才失效」这条承诺。
 */
const path = require('path');
const fs = require('fs');

let pass = 0, fail = 0;
const fails = [];
function check(name, cond) {
  if (cond) { pass++; } else { fail++; fails.push(name); }
}
function section(t) { console.log('\n── ' + t + ' ──'); }

/* ── 极简 wx 桩 ───────────────────────────── */
let modalTitle = '';
let modalConfirm = false;
const stored = {};
global.wx = {
  getStorageSync: (k) => stored[k],
  setStorageSync: (k, v) => { stored[k] = JSON.parse(JSON.stringify(v)); },
  removeStorageSync: (k) => { delete stored[k]; },
  getSystemInfoSync: () => ({ windowHeight: 700, SDKVersion: '3.0.0' }),
  env: { USER_DATA_PATH: '/tmp' },
  getFileSystemManager: () => ({ saveFile: (o) => o.fail && o.fail(), unlink: () => {} }),
  login: (o) => o.success && o.success({ code: 'mock-code' }),
  showToast: () => {},
  showModal: (o) => { modalTitle = (o && o.title) || ''; if (o && o.success) o.success({ confirm: modalConfirm, cancel: !modalConfirm }); },
  canIUse: () => true,
  reLaunch: () => {},
  switchTab: () => {},
  navigateTo: () => {},
  setClipboardData: () => {},
  getClipboardData: () => {},
  chooseMessageFile: (o) => o.fail && o.fail({ errMsg: 'not supported' })
};

const ROOT = path.resolve(__dirname, '..');
const guardian = require(path.join(ROOT, 'utils/guardian.js'));
const shadow = require(path.join(ROOT, 'utils/shadow.js'));
const quotes = require(path.join(ROOT, 'utils/quotes.js'));
const storage = require(path.join(ROOT, 'utils/storage.js'));

/* ── 1. 小白：连续对话重复率 ────────────────── */
section('1. 小白 · 连续对话重复率');

const USER_LINES = [
  '我想他了', '睡不着', '今天差点想联系ta', '我好难过', '都是我的错吗',
  '还记得我们以前去过的地方', '为什么会这样', '我想放下重新开始', '你好',
  '在吗', '我又想发消息给他了', '心里难受', '凌晨三点还醒着', '我恨他',
  '是不是我不够好', '脑子里都是他', '凭什么这样对我', '晚安'
];
const PERSONAS = ['warm', 'sharp', 'tsun', 'spoil'];

function runXiaobai(persona, rounds) {
  const used = {};
  const seen = {};
  let dup = 0;
  const out = [];
  for (let i = 0; i < rounds; i++) {
    const line = USER_LINES[i % USER_LINES.length];
    const r = guardian.guardianReply(line, persona, [], used);
    if (seen[r.text]) dup++;
    seen[r.text] = 1;
    out.push(r.text);
  }
  return { dup: dup, total: rounds, unique: Object.keys(seen).length, sample: out };
}

PERSONAS.forEach((p) => {
  /* 池子总量：以「人格可用组合数」为上限，取其中一段来测 */
  const rounds = 60;
  const r = runXiaobai(p, rounds);
  console.log(`  ${p}: ${rounds} 轮 → ${r.unique} 条不同 / 重复 ${r.dup} 次`);
  check(`小白[${p}] 前 ${rounds} 轮零重复`, r.dup === 0);
});

/* 极端：四种人格混着聊 400 句 */
{
  const used = {};
  const seen = {};
  let dup = 0;
  for (let i = 0; i < 400; i++) {
    const p = PERSONAS[i % 4];
    const line = USER_LINES[i % USER_LINES.length];
    const r = guardian.guardianReply(line, p, [], used);
    if (seen[r.text]) dup++;
    seen[r.text] = 1;
  }
  console.log(`  混合人格 400 轮 → ${Object.keys(seen).length} 条不同 / 重复 ${dup} 次`);
  check('混合人格 400 轮重复率 < 15%', dup / 400 < 0.15);
}

/* 池子耗尽后必须能自愈（不能卡死返回空 / undefined） */
{
  const used = {};
  let bad = 0;
  for (let i = 0; i < 3000; i++) {
    const r = guardian.guardianReply('我想他了', 'sharp', [], used);
    if (!r.text || typeof r.text !== 'string' || !r.text.length) bad++;
  }
  check('池子耗尽后仍能持续出句（3000 次无空回复）', bad === 0);
}

/* 危机词永远优先，且不受去重影响 */
{
  const used = {};
  let ok = true;
  for (let i = 0; i < 20; i++) {
    const r = guardian.guardianReply('我不想活了', 'warm', [], used);
    if (!r.crisis || r.text !== guardian.CRISIS_TEXT) ok = false;
  }
  check('危机词 20 次全部命中且文案一致', ok);
}

/* ── 2. 影子：连续对话重复率 ───────────────── */
section('2. 影子 · 连续对话重复率');

const SHADOW_LINES = [
  '我想你了', '我们还爱吗', '对不起', '我要走了', '在吗',
  '你还记得吗', '为什么', '你凭什么', '再见了', '是我'
];

[80, 50, 30].forEach((aff) => {
  const used = {};
  const seen = {};
  let dup = 0;
  const profile = { avgLen: 8, emojiLove: true, top: ['呀', '嗯嗯', '啦'], qRate: 0.2 };
  for (let i = 0; i < 40; i++) {
    const r = shadow.shadowReply(SHADOW_LINES[i % SHADOW_LINES.length], profile, aff, null, used);
    if (seen[r]) dup++;
    seen[r] = 1;
  }
  const uniq = Object.keys(seen).length;
  console.log(`  affinity ${aff}: 40 轮 → ${uniq} 条不同 / 重复 ${dup} 次`);
  /* 影子池本身只有 3-4 句/意图，耗尽后必然循环 —— 只要不是「每两句就重复」即可 */
  check(`影子[${aff}] 重复率可接受（< 70%）`, dup / 40 < 0.7);
});

/* 影子池子小 → 检查耗尽后不返回空 */
{
  const used = {};
  let bad = 0;
  const profile = { avgLen: 8, emojiLove: false, top: ['呀', '嗯', '啦'], qRate: 0 };
  for (let i = 0; i < 500; i++) {
    const r = shadow.shadowReply('我想你了', profile, 80, null, used);
    if (!r || typeof r !== 'string' || !r.length) bad++;
  }
  check('影子 500 次无空回复', bad === 0);
}

/* ── 3. 去重只认「清空数据 / 重置」 ─────────── */
section('3. 去重生命周期');

{
  const S = storage.load();
  check('新状态带 usedReplies 字典', S.usedReplies && typeof S.usedReplies === 'object');
  check('新状态带 daily 字段', S.daily && typeof S.daily.date === 'string');

  const used = S.usedReplies;
  const first = guardian.guardianReply('我想他了', 'warm', [], used).text;
  check('说过的话被记进字典', !!used[first]);

  /* 模拟「重新 load」：字典应该还在（storage 里有） */
  storage.save(S);
  const S2 = storage.load();
  check('重新加载后去重字典仍在', !!S2.usedReplies[first]);

  /* 模拟清空数据 */
  Object.assign(S2, storage.defaultState());
  check('清空数据后去重字典归零', Object.keys(S2.usedReplies).length === 0);
}

/* 旧版本数据升级：没有 usedReplies 字段也不能崩 */
{
  stored['noex_mvp_v1'] = { startDate: '2026-09-01', gMsgs: [], shadow: {} };
  const S = storage.load();
  check('老数据自动补 usedReplies', S.usedReplies && typeof S.usedReplies === 'object');
  check('老数据自动补 daily', S.daily && typeof S.daily === 'object');
  const r = guardian.guardianReply('我想他了', 'warm', [], S.usedReplies);
  check('老数据下仍能正常出句', !!r.text);
  delete stored['noex_mvp_v1'];
}

/* ── 4. 每日一句 ───────────────────────────── */
section('4. 首页每日一句');

{
  check('每日一句池 >= 30 条', quotes.DAILY_QUOTES.length >= 30);

  /* 同一天永远同一句 */
  const a = quotes.dailyQuote('2026-09-08', {});
  const b = quotes.dailyQuote('2026-09-08', {});
  check('同一天结果稳定', a === b);

  /* 连续 40 天不重样 */
  const used = {};
  const seen = {};
  let dup = 0;
  for (let i = 0; i < 40; i++) {
    const d = new Date(2026, 8, 1 + i);
    const ds = d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2);
    const q = quotes.dailyQuote(ds, used);
    used[q] = 1;
    if (seen[q]) dup++;
    seen[q] = 1;
  }
  console.log(`  连续 40 天 → ${Object.keys(seen).length} 条不同 / 重复 ${dup} 次`);
  check('连续 40 天每日一句零重复', dup === 0);

  /* 池子耗尽后自愈 */
  const used2 = {};
  let bad = 0;
  for (let i = 0; i < 200; i++) {
    const q = quotes.dailyQuote('2026-01-' + ('0' + ((i % 28) + 1)).slice(-2), used2);
    used2[q] = 1;
    if (!q) bad++;
  }
  check('每日一句耗尽后仍可持续', bad === 0);
}

/* ── 5. 强制登录 ───────────────────────────── */
section('5. 软登录：用功能才提醒（v0.8.0）');

const user = require(path.join(ROOT, 'utils/user.js'));

{
  let launched = '';
  global.wx.reLaunch = (o) => { launched = o.url; };
  global.wx.switchTab = (o) => { launched = o.url; };

  delete stored['noex_mvp_v1'];
  let S = storage.load();
  S.user = null;
  storage.save(S);
  const blocked = user.requireLogin('测试');
  check('未登录时用功能 → 被拦截（返回 true）', blocked === true);
  check('未登录时用功能 → 弹登录提醒', modalTitle === '需要登录');
  check('拦截后不直接跳走（等用户点确认）', launched === '');
  modalConfirm = true;
  launched = '';
  user.requireLogin('测试');
  check('点「去登录」→ 跳个人主页', launched === '/pages/me/me');
  modalConfirm = false;

  S = storage.load();
  S.user = { nick: '小明', avatar: '', loginAt: Date.now() };
  storage.save(S);
  launched = '';
  modalTitle = '';
  const passed = user.requireLogin('测试');
  check('已登录时不拦截（返回 false）', passed === false);
  check('已登录时不弹提醒', modalTitle === '');

  /* 只有头像没昵称也算登录 */
  S = storage.load();
  S.user = { nick: '', avatar: 'wxfile://a.png', loginAt: Date.now() };
  storage.save(S);
  check('只有头像也算已登录', user.isLogged() === true);
}

/* v0.8.0：页面 onShow 不再有硬拦截，但关键动作必须挂 requireLogin */
['today', 'xiaobai', 'yingzi', 'me', 'bottle'].forEach((p) => {
  const f = path.join(ROOT, 'pages', p, p + '.js');
  const src = fs.readFileSync(f, 'utf8');
  check(`pages/${p} onShow 不再硬拦登录`, !/guardLogin\(\)/.test(src));
});
{
  const must = {
    'pages/today/today.js': '打卡',
    'pages/xiaobai/xiaobai.js': '发消息',
    'pages/yingzi/yingzi.js': '影子聊天',
    'pages/bottle/bottle.js': '写留白瓶'
  };
  Object.keys(must).forEach((rel) => {
    const src = fs.readFileSync(path.join(ROOT, rel), 'utf8');
    check(`${rel} 的${must[rel]}挂了软登录`, /requireLogin\(/.test(src));
  });
}
{
  /* 登录入口唯一在「我」页 */
  const appJson = JSON.parse(fs.readFileSync(path.join(ROOT, 'app.json'), 'utf8'));
  check('app.json 不再注册独立登录页', !appJson.pages.includes('pages/login/login'));
  check('登录页目录已删除', !fs.existsSync(path.join(ROOT, 'pages/login')));
  const meWxml = fs.readFileSync(path.join(ROOT, 'pages/me/me.wxml'), 'utf8');
  check('「我」页有 chooseAvatar 入口', /open-type="chooseAvatar"/.test(meWxml));
  check('「我」页有 type="nickname" 入口', /type="nickname"/.test(meWxml));
  check('「我」页有头像降级入口', /onPickAvatarAlbum/.test(meWxml));
}

/* ── 6. 聊天输入框常驻底部 ─────────────────── */
section('6. 聊天输入框布局');

{
  const wxml = fs.readFileSync(path.join(ROOT, 'pages/xiaobai/xiaobai.wxml'), 'utf8');
  const wxss = fs.readFileSync(path.join(ROOT, 'pages/xiaobai/xiaobai.wxss'), 'utf8');
  const js = fs.readFileSync(path.join(ROOT, 'pages/xiaobai/xiaobai.js'), 'utf8');
  check('聊天容器高度用 windowHeight 行内写入', /winH/.test(wxml) && /windowHeight/.test(js));
  check('.msgs 有 min-height:0（否则会把输入框顶出屏幕）', /min-height:\s*0/.test(wxss));
  check('不再用 pageScrollTo 滚聊天（对 scroll-view 无效）', !/wx\.pageScrollTo\s*\(/.test(js));
  check('用 scroll-into-view 定位到最后一条', /anchor/.test(js) && /scroll-into-view/.test(wxml));
}

/* ── 结果 ─────────────────────────────────── */
console.log('\n' + '='.repeat(46));
console.log(`通过 ${pass} · 失败 ${fail}`);
if (fails.length) {
  console.log('失败项：');
  fails.forEach((f) => console.log('  ✗ ' + f));
}
console.log('='.repeat(46));
process.exit(fail ? 1 : 0);
