// _test/wx-test.js — Node 端验证 utils/ 下的核心逻辑
// 用 fake wx（storage 模块依赖 wx.*）跑 storage roundtrip；
// guardian / shadow / wechat 是纯 JS，require 后直接调用即可。

const path = require('path');
const util = require('path');

const BASE = path.resolve(__dirname, '..');
const _storage = { fakeStorage: {} };

// 构造 fake wx
global.wx = {
  getStorageSync(k) { return _storage.fakeStorage[k]; },
  setStorageSync(k, v) { _storage.fakeStorage[k] = v; },
  removeStorageSync(k) { delete _storage.fakeStorage[k]; }
};

const storage = require(path.join(BASE, 'utils/storage.js'));
const guardian = require(path.join(BASE, 'utils/guardian.js'));
const shadow = require(path.join(BASE, 'utils/shadow.js'));
const wechat = require(path.join(BASE, 'utils/wechat.js'));

let pass = 0, fail = 0;
function check(label, cond, extra) {
  if (cond) {
    pass++;
    console.log('  ✓ ' + label);
  } else {
    fail++;
    console.error('  ✗ ' + label + (extra ? '   [' + extra + ']' : ''));
  }
}

/* === STORAGE === */
console.log('\n[storage]');
(function () {
  _storage.fakeStorage = {};
  const S1 = storage.load();
  check('首次加载返回默认状态', S1.onboarded === false && S1.startDate === storage.todayStr());
  check('默认状态含 shadow 子对象', S1.shadow && typeof S1.shadow === 'object' && S1.shadow.enabled === false);
  S1.onboarded = true; S1.startDate = '2026-08-30'; S1.exName = 'H';
  storage.save(S1);
  const S2 = storage.load();
  check('save 后 load 读到一致数据', S2.onboarded === true && S2.startDate === '2026-08-30' && S2.exName === 'H');
  // 字段缺失容错
  _storage.fakeStorage['liubai_mvp_v1'] = { onboarded: false, startDate: '2026-08-30' };
  const S3 = storage.load();
  check('字段缺失时自动补默认', S3.persona === 'warm' && Array.isArray(S3.bottle) && S3.shadow && S3.shadow.enabled === false);
  storage.clear();
  check('clear 后 load 回到默认', (() => {
    const S = storage.load();
    return S.onboarded === false && Array.isArray(S.bottle) && S.bottle.length === 0;
  })());
})();

/* === GUARDIAN === */
console.log('\n[guardian]');
(function () {
  check('detectIntent 思 ta', guardian.detectIntent('我想ta了') === 'miss');
  check('detectIntent 想联系', guardian.detectIntent('我想联系 ta') === 'urge');
  check('detectIntent 睡不着', guardian.detectIntent('今晚又睡不着') === 'insomnia');
  check('detectIntent 自杀 → crisis', guardian.detectIntent('我真的想自杀') === 'crisis');
  check('detectIntent 默认 null', guardian.detectIntent('今天吃了螺蛳粉') === null);

  const warm = guardian.guardianReply('今晚又睡不着', 'warm');
  check('warm 回复含「嗯，我在」', warm.text.indexOf('嗯，我在') > -1, warm.text);
  check('warm reply 无 crisis', !warm.crisis);

  const sharp = guardian.guardianReply('想找他', 'sharp');
  check('sharp 含吐槽池任一项', /(脑子进水|出息|记脸|手贱|肿眼泡|放下)/.test(sharp.text), sharp.text);

  const tsun = guardian.guardianReply('想找他', 'tsun');
  check('tsun 含「才不是心疼你」', tsun.text.indexOf('才不是心疼你呢') > -1, tsun.text);

  const spoil = guardian.guardianReply('想找他', 'spoil');
  check('spoil 含吃醋 / 争宠', /(我才是|先看我|想我吗|吃醋|小宝贝)/.test(spoil.text), spoil.text);

  const crisis = guardian.guardianReply('我不想活了', 'warm');
  check('crisis 关键词触发危机回复', crisis.crisis === true);

  check('ENCOURAGE 含 1/3/7/21', [1,3,7,21].every(d => guardian.ENCOURAGE[d] && guardian.ENCOURAGE[d].length > 0));
})();

/* === SHADOW === */
console.log('\n[shadow]');
(function () {
  const text =
    '2023-05-12 21:34:05 我\n' +
    '今天累死了\n' +
    '2023-05-12 21:34:20 Ta\n' +
    '嗯嗯？？哈哈你吃什么了？\n' +
    '2023-05-13 09:12 我\n' +
    '在忙吗？\n' +
    '2023-05-13 09:18 Ta\n' +
    '嗯嗯\n';
  const p = shadow.analyzeChat(text);
  check('analyzeChat count >= 4', p.count >= 4, JSON.stringify(p));
  check('analyzeChat top 包含 嗯嗯', Array.isArray(p.top) && p.top.indexOf('嗯嗯') > -1, JSON.stringify(p.top));
  check('analyzeChat qRate > 0', p.qRate > 0);

  check('shadowReply「想你」命中 miss pool', shadow.shadowReply('我真的好想你', null).length > 0);
  check('shadowReply「为什么」命中 ask pool', shadow.shadowReply('你为什么这样', null).length > 0);
  check('shadowReply 默认 fallback', shadow.shadowReply('asdfghjkl', null).length > 0);

  check('profileSummary 至少 1 行', shadow.profileSummary(p).split('\n').length >= 1);
})();

/* === WECHAT === */
console.log('\n[wechat]');
(function () {
  // UTF-8 with BOM
  const u8 = Buffer.concat([Buffer.from([0xEF, 0xBB, 0xBF]), Buffer.from('2023-05-12 21:34:05 我\nhello\n2023-05-12 21:35:10 Ta\nhi\n')]);
  const text1 = wechat.decodeChatFile(u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength));
  check('UTF-8 BOM 解码', text1.indexOf('2023-05-12 21:34:05 我') > -1, text1.slice(0, 60));

  // UTF-16LE 启发式：纯 ASCII 字符串编码成 LE 后奇数位置全 0
  const ascii = 'hello world hello world hello world hello world hello world hello world';
  const leBuf = Buffer.alloc(ascii.length * 2);
  for (let i = 0; i < ascii.length; i++) leBuf.writeUInt16LE(ascii.charCodeAt(i), i * 2);
  const text2 = wechat.decodeChatFile(leBuf.buffer.slice(leBuf.byteOffset, leBuf.byteOffset + leBuf.byteLength));
  check('UTF-16LE 启发式', text2.indexOf('hello world') > -1, text2.slice(0, 60));

  // parseWeChatLog 两种 head
  const log =
    '2023-05-12 21:34:05 我\n今天累死了\n' +
    '2023-05-12 21:34:20 Ta\n嗯嗯？哈哈\n' +
    '2023-05-13 09:12 我\n在忙吗？\n' +
    '2023-05-13 09:18 Ta\n嗯嗯\n';
  const r = wechat.parseWeChatLog(log);
  check('解析出 2 位说话人', r.speakers.length === 2, JSON.stringify(r.speakers));
  check('说话人含 我 和 Ta', r.speakers.indexOf('我') > -1 && r.speakers.indexOf('Ta') > -1);
  check('Ta 的消息多于 我 的', r.byName['Ta'] && r.byName['Ta'].length >= 2);

  // 给「我 + Ta」，默认应该排除「我」
  const def = wechat.defaultShadowSpeaker(r);
  check('defaultShadowSpeaker 排除「我」', def === 'Ta', String(def));

  // 单说话人
  const r2 = wechat.parseWeChatLog(
    '小张 2023-05-12 21:34\nhello\n小张 2023-05-12 21:35\nhi\n'
  );
  check('另一种 head 也能解析', r2.speakers.length === 1 && r2.speakers[0] === '小张', JSON.stringify(r2));

  // 没有任何 head → cleaned 文本
  const r3 = wechat.parseWeChatLog('hello\nworld\n');
  check('无 head 不报错, 返回 cleaned', r3.cleaned.indexOf('hello') > -1, JSON.stringify(r3));
})();

console.log('\n=== ' + pass + ' passed, ' + fail + ' failed ===');
process.exit(fail === 0 ? 0 : 1);
