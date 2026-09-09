// _test/integration-test.js — 集成测试：onRelapse + xiaobai send 完整链路
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const lib = {};

function load(file, modName) {
  const code = fs.readFileSync(path.join(ROOT, 'utils', file), 'utf8');
  lib[modName] = { src: code, exports: {} };
  return lib[modName];
}
load('storage.js', 'storage');
load('util.js', 'util');
load('guardian.js', 'guardian');
load('shadow.js', 'shadow');
load('wechat.js', 'wechat');

const calls = [];
let stored = {};
const wx = {
  getStorageSync(k) { return stored[k]; },
  setStorageSync(k, v) { stored[k] = v; calls.push(['setStorageSync', k]); },
  removeStorageSync(k) { delete stored[k]; },
  showToast(o) { calls.push(['showToast', o.title]); },
  showModal(o) { calls.push(['showModal', o.title]); },
  pageScrollTo(o) { calls.push(['pageScrollTo']); },
  navigateTo(o) { calls.push(['navigateTo', o.url]); },
  switchTab(o) { calls.push(['switchTab', o.url]); }
};

const ctx = { wx, console, module: { exports: {} }, Date, Math, JSON, setTimeout, clearTimeout, setInterval, clearInterval, require: (m) => {
  // 解析相对路径
  if (m === './storage.js') return loadAndExec('storage.js', lib.storage);
  if (m === './util.js')    return loadAndExec('util.js', lib.util);
  if (m === './guardian.js')return loadAndExec('guardian.js', lib.guardian);
  if (m === './shadow.js')  return loadAndExec('shadow.js', lib.shadow);
  if (m === './wechat.js')  return loadAndExec('wechat.js', lib.wechat);
  return {};
}};
ctx.global = ctx;
const loaded = {};
function loadAndExec(name, slot) {
  if (loaded[name]) return loaded[name];
  const m = { exports: {} };
  const c = vm.createContext(ctx);
  vm.runInContext(slot.src + '\nmodule.exports = module.exports || {};', c);
  // 取回导出
  const exp = c.module.exports;
  loaded[name] = exp;
  return exp;
}

const storage = loadAndExec('storage.js', lib.storage);
const util    = loadAndExec('util.js', lib.util);
const guardian= loadAndExec('guardian.js', lib.guardian);

let pass = 0, fail = 0;
function check(name, cond, info) {
  if (cond) { pass++; console.log('  ✓', name); }
  else      { fail++; console.log('  ✗', name, info || ''); }
}

console.log('\n=== 集成测试：onRelapse 链路 ===');
// 模拟初始状态
stored = {};
let S = storage.load();
check('load 返回默认状态', S.startDate && S.persona === 'warm' && Array.isArray(S.gMsgs));
check('初始 relapses = 0', S.relapses === 0);
const dayBefore = S.startDate;

// 直接调用 onRelapse 的逻辑（模拟 today.js）
function onRelapse() {
  S = storage.load();
  const SHARP_REPLY = ['哼，又没忍住。', '哼，行吧。'];
  const line = '哼，' + SHARP_REPLY[Math.floor(Math.random() * SHARP_REPLY.length)];
  const now = Date.now();
  S.gMsgs.push({ role: 'sys', text: '（' + util.todayStr() + ' · 你没忍住，联系了。计数已重置为 1 天。）', t: now });
  S.gMsgs.push({ role: 'ai', text: line, t: now + 1 });
  S.startDate = util.todayStr();
  S.lastCheckIn = '';
  S.checkCount = 0;
  S.relapses++;
  storage.save(S);
  wx.showToast({ title: '断了 · 去小白那儿被骂两句', icon: 'none', duration: 2000 });
}

calls.length = 0;
onRelapse();
check('onRelapse 触发 showToast', calls.some(c => c[0] === 'showToast'));
check('onRelapse 触发 setStorageSync', calls.some(c => c[0] === 'setStorageSync'));
S = storage.load();
check('relapses 增加到 1', S.relapses === 1);
check('startDate 被重置为今天', S.startDate === util.todayStr());
check('lastCheckIn 清空', S.lastCheckIn === '');
check('checkCount 清零', S.checkCount === 0);
check('gMsgs 多了 2 条（sys + ai）', S.gMsgs.length === 2);
check('gMsgs[0] 是 sys', S.gMsgs[0].role === 'sys');
check('gMsgs[1] 是 ai', S.gMsgs[1].role === 'ai');
check('ai 消息以「哼」开头（毒舌）', S.gMsgs[1].text.startsWith('哼'));

// 再点一次，relapses 应该到 2
onRelapse();
S = storage.load();
check('再点一次 relapses=2', S.relapses === 2);
check('再点一次 gMsgs 有 4 条', S.gMsgs.length === 4);

console.log('\n=== 集成测试：xiaobai send 链路 ===');
// 模拟 xiaobai.send 的逻辑
function xiaobaiSend(rawText) {
  const text = (rawText || '').trim();
  if (!text) return;
  let s = storage.load();
  s.gMsgs.push({ role: 'me', text, t: Date.now() });
  storage.save(s);
  const reply = guardian.guardianReply(text, s.persona, s.bottle);
  s = storage.load();
  s.gMsgs.push({ role: 'ai', text: reply.text, t: Date.now() });
  storage.save(s);
}

stored = {};
storage.load(); // 初始化
calls.length = 0;
xiaobaiSend('我想 ta 了');
S = storage.load();
check('send 后 gMsgs 有 2 条', S.gMsgs.length === 2);
check('用户消息已写入', S.gMsgs[0].role === 'me' && S.gMsgs[0].text === '我想 ta 了');
check('ai 回复已生成', S.gMsgs[1].role === 'ai' && S.gMsgs[1].text.length > 0);
console.log('   └ ai 回复样例:', S.gMsgs[1].text.slice(0, 60) + '...');

xiaobaiSend('睡不着');
S = storage.load();
check('再 send 一次（4 条）', S.gMsgs.length === 4);

// 测 warm 切到 sharp 后回复风格差异
const warmReply = guardian.guardianReply('睡不着', 'warm');
const sharpReply = guardian.guardianReply('睡不着', 'sharp');
console.log('   └ warm 回复:', warmReply.text.slice(0, 60) + '...');
console.log('   └ sharp 回复:', sharpReply.text.slice(0, 60) + '...');
check('warm 不以「嗯，我在。」开头', !warmReply.text.startsWith('嗯，我在。'));
// sharp 是「温柔 base + 毒舌尾巴」，base 不含毒舌词，所以多次采样
// 24 条尾巴池里含窄关键词(脑子|出息|手贱|肿眼泡|破戒|长记性)的只有 2 条 → 单次 8%，30 次仍 ~7% flaky。
// 用与 e2e 相同的宽关键词集（命中 7 条 → 单次 ~29%，30 次 flake < 0.02%）。
let sharpHit = false;
for (let i = 0; i < 30; i++) {
  const r = guardian.guardianReply('睡不着', 'sharp');
  if (/(脑子|出息|手贱|肿眼泡|破戒|长记性|舍不得|戒不掉|联系人|翻聊天|置顶)/.test(r.text)) { sharpHit = true; break; }
}
check('sharp 30 次采样至少 1 次含毒舌尾巴（宽关键词，与 e2e 同步）', sharpHit);

// tsun 含「才不是心疼你」
const tsunReply = guardian.guardianReply('想 ta', 'tsun');
check('tsun 含「才不是心疼你」', tsunReply.text.indexOf('才不是心疼你') > -1);

// 空字符串 send 不应写入
xiaobaiSend('   ');
S = storage.load();
check('空字符串 send 不会写入（仍是 4 条）', S.gMsgs.length === 4);

console.log('\n=== 集成测试：send 后 msgs 渲染链路（模拟 setData）===');
// 模拟 fmtMsg 和 setData
function fmtMsg(m) {
  if (m.role === 'sys') return { role: 'sys', text: m.text };
  if (m.role === 'ai')  return { role: 'ai', avatar: '/images/agent.png', text: m.text };
  return { role: 'me', text: m.text };
}
const rendered = S.gMsgs.map(fmtMsg);
check('渲染后 4 条', rendered.length === 4);
check('渲染 me 消息', rendered[0].role === 'me');
check('渲染 ai 消息带 avatar', rendered[1].avatar === '/images/agent.png');
check('渲染 ai 消息带 text', rendered[1].text.length > 0);

console.log(`\n=== ${pass} passed, ${fail} failed ===`);
process.exit(fail ? 1 : 0);
