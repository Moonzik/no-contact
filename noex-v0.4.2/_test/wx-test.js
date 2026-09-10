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
/* 注意：本文件顶部 util 已被 path 占用，故工具模块用 U */
const U = require(path.join(BASE, 'utils/util.js'));

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
  _storage.fakeStorage['noex_mvp_v1'] = { onboarded: false, startDate: '2026-08-30' };
  const S3 = storage.load();
  check('字段缺失时自动补默认', S3.persona === 'warm' && Array.isArray(S3.bottle) && S3.shadow && S3.shadow.enabled === false);
  storage.clear();
  check('clear 后 load 回到默认', (() => {
    const S = storage.load();
    return S.onboarded === false && Array.isArray(S.bottle) && S.bottle.length === 0;
  })());

  // 存储保险丝：gMsgs 超过 2000 条自动裁剪（微信单 key 上限 1024 KB）
  const big = storage.load();
  big.gMsgs = Array.from({ length: 2500 }, (_, i) => ({ role: 'me', text: 'm' + i, t: i }));
  storage.save(big);
  const after = storage.load();
  check('gMsgs 超 2000 条被裁剪', after.gMsgs.length === 2000, 'len=' + after.gMsgs.length);
  check('裁剪保留的是最新的', after.gMsgs[after.gMsgs.length - 1].text === 'm2499');
  check('裁剪后其余字段不受影响', after.onboarded === false && Array.isArray(after.bottle));
  storage.clear();
})();

/* === GUARDIAN === */
console.log('\n[guardian]');
(function () {
  check('detectIntent 思 ta', guardian.detectIntent('我想ta了') === 'miss');
  check('detectIntent 想联系', guardian.detectIntent('我想联系 ta') === 'urge');
  check('detectIntent 睡不着', guardian.detectIntent('今晚又睡不着') === 'insomnia');
  check('detectIntent 自杀 → crisis', guardian.detectIntent('我真的想自杀') === 'crisis');
  /* v0.8.1：日常倾诉单独成一类，不再掉进兜底池回「然后呢」 */
  check('detectIntent 日常吃饭 → daily', guardian.detectIntent('今天吃了螺蛳粉') === 'daily');
  check('detectIntent 默认 null', guardian.detectIntent('桌面上的水杯空了') === null);
  /* v0.8.1：打分制——长词权重高，「睡不着」+「想他」时取信息量大的那个 */
  check('打分制：失眠+想念 → insomnia', guardian.detectIntent('睡不着，满脑子都是他') === 'insomnia',
    guardian.detectIntent('睡不着，满脑子都是他'));
  check('打分制：想念词更多 → miss', guardian.detectIntent('今晚睡不着，好想他，忘不了他') === 'miss',
    guardian.detectIntent('今晚睡不着，好想他，忘不了他'));

  const warm = guardian.guardianReply('今晚又睡不着', 'warm');
  check('warm 不再前置安慰（不含「嗯，我在。」前缀）', warm.text.indexOf('嗯，我在。') !== 0, warm.text);
  /* v0.9.5：尾巴改成概率挂载，单次必现的断言会 flaky → 改 40 次采样至少命中 1 次 */
  let warmTail = false;
  let warmSample = warm.text;
  for (let i = 0; i < 40; i++) {
    const r = guardian.guardianReply('今晚又睡不着', 'warm');
    warmSample = r.text;
    if (/(我陪着你|你不用急|我听着呢|累了|不急|哭也没关系)/.test(r.text)) { warmTail = true; break; }
  }
  check('warm 40 次采样至少 1 次温柔收尾（陪我/不急/听着/歇/哭）', warmTail, warmSample);
  check('warm reply 无 crisis', !warm.crisis);

  /* sharp 多次采样，base 是温柔的，毒舌在尾巴（8 个候选，约 12% 命中/次） */
  let sharpHit = false;
  let sharpSample = '';
  for (let i = 0; i < 20; i++) {
    const r = guardian.guardianReply('想找他', 'sharp');
    sharpSample = r.text;
    if (/(脑子|出息|手贱|肿眼泡|破戒|长记性|鼻涕|放下)/.test(r.text)) { sharpHit = true; break; }
  }
  check('sharp 20 次采样至少 1 次含毒舌尾巴', sharpHit, sharpSample);

  const tsun = guardian.guardianReply('想找他', 'tsun');
  /* v0.9.5：同 warm，概率尾巴 → 采样断言 */
  let tsunTail = false;
  let tsunSample = tsun.text;
  for (let i = 0; i < 40; i++) {
    const r = guardian.guardianReply('想找他', 'tsun');
    tsunSample = r.text;
    if (r.text.indexOf('才不是心疼你呢') > -1) { tsunTail = true; break; }
  }
  check('tsun 40 次采样至少 1 次含「才不是心疼你」', tsunTail, tsunSample);

  const spoil = guardian.guardianReply('想找他', 'spoil');
  // 关键词覆盖 spoil 池全部 7 条尾巴 → 断言确定性通过（此前漏了「只准想我/只能想我」2 条，~29% flaky）
  /* v0.9.5：同上，改采样 */
  let spoilTail = false;
  let spoilSample = spoil.text;
  for (let i = 0; i < 40; i++) {
    const r = guardian.guardianReply('想找他', 'spoil');
    spoilSample = r.text;
    if (/(我才是|先看我|想我吗|吃醋|小宝贝|只准想我|只能想我)/.test(r.text)) { spoilTail = true; break; }
  }
  check('spoil 40 次采样至少 1 次含吃醋 / 争宠', spoilTail, spoilSample);

  /* ── v0.8.1 接话：回复要对着用户这句话说，不是随便抽一句 ── */
  /* 「我」和「今天」都是口水词，会被逐层剥掉，剩下最有信息量的那截 */
  check('pickPhrase 摘出具体片段', guardian.pickPhrase('我今天路过那家咖啡店了，好难受') === '路过那家咖啡店',
    guardian.pickPhrase('我今天路过那家咖啡店了，好难受'));
  check('pickPhrase 去掉句首口水词', guardian.pickPhrase('其实我就是很难过') !== '其实我就是很难过');
  check('pickPhrase 引号内容优先', guardian.pickPhrase('他说「我们不合适」然后就走了') === '我们不合适',
    guardian.pickPhrase('他说「我们不合适」然后就走了'));
  check('pickPhrase 保留话题主体他', (guardian.pickPhrase('他说他要结婚了') || '').indexOf('他') === 0,
    guardian.pickPhrase('他说他要结婚了'));
  check('pickPhrase 太短返回空', guardian.pickPhrase('嗯') === '', guardian.pickPhrase('嗯'));

  /* 兜底（没识别出意图）时必须接住用户刚说的话，不能只回「然后呢」 */
  let fbHit = 0;
  for (let i = 0; i < 20; i++) {
    const r = guardian.guardianReply('桌面上的水杯空了', 'warm', [], {});
    if (r.text.indexOf('水杯') > -1) fbHit++;
  }
  check('兜底回复会引用用户原话（20 次都命中）', fbHit === 20, '命中 ' + fbHit + '/20');

  /* 有意图时也常常接话（不是每次，避免太长） */
  let intHit = 0;
  for (let i = 0; i < 30; i++) {
    const r = guardian.guardianReply('我今天路过那家咖啡店了，好难受', 'warm', [], {});
    if (r.text.indexOf('咖啡店') > -1) intHit++;
  }
  /* v0.9.3：识别出意图后就不再额外追加接话（用户反馈「故意多加一段」） */
  check('有意图时不再追加接话', intHit === 0, '命中 ' + intHit + '/30');

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

  /* === v0.4.0 · 温水冷却（affinity）=== */
  check('computeAffinity 未启用返回 80', shadow.computeAffinity(0, 0) === 80);
  check('SHADOW_AFFINITY 常量存在', shadow.SHADOW_AFFINITY && shadow.SHADOW_AFFINITY.INIT === 80 && shadow.SHADOW_AFFINITY.FLOOR === 30);
  /* 第 0 天首次，无 session：80 */
  const now0 = 1735660800000; // 2025-01-01 00:00:00 UTC
  check('computeAffinity 0 天 / 0 session = 80', shadow.computeAffinity(now0, 0, now0) === 80);
  /* 第 7 天：80 - 2.5*7 = 62.5 → 62.5 */
  check('computeAffinity 7 天 = 62.5', shadow.computeAffinity(now0, 0, now0 + 7 * 86400000) === 62.5);
  /* 第 21 天后触底：80 - 2.5*21 = 27.5 → max(30)=30 */
  check('computeAffinity 21 天触底 = 30', shadow.computeAffinity(now0, 0, now0 + 21 * 86400000) === 30);
  /* 第 100 天仍触底 */
  check('computeAffinity 100 天仍触底 = 30', shadow.computeAffinity(now0, 0, now0 + 100 * 86400000) === 30);

  /* shadowReply 多 affinity 参数 */
  check('shadowReply 80% 命中 miss pool（高仿期）', shadow.shadowReply('我好想你', p, 80).length > 0);
  check('shadowReply 30% 命中 miss pool（通用期）', shadow.shadowReply('我好想你', p, 30).length > 0);
  check('shadowReply 50% mixed 也返回', shadow.shadowReply('我好想你', p, 50, () => 0.3).length > 0);
  /* 高仿期 miss 应该带 top 词 */
  let highHit = false;
  let highSample = '';
  for (let i = 0; i < 30 && !highHit; i++) {
    const r = shadow.shadowReply('我好想你', p, 80);
    highSample = r;
    /* top 应包含「嗯嗯」，所以高仿可能输出「嗯嗯……」或类似 */
    if (/(嗯嗯|呀|啦|哈哈)/.test(r)) highHit = true;
  }
  check('高仿期 miss 30 次采样带 top 口头禅', highHit, highSample);
  /* 通用期 miss 不带 top 词（保持极简） */
  let baseHit = false;
  let baseSample = '';
  for (let i = 0; i < 30 && !baseHit; i++) {
    const r = shadow.shadowReply('我好想你', p, 30);
    baseSample = r;
    if (/^(嗯|我知道|……)/.test(r) && !/(嗯嗯|呀|啦|哈哈)/.test(r)) baseHit = true;
  }
  check('通用期 miss 30 次采样不带 top 口头禅', baseHit, baseSample);

  /* === v0.4.0 · 自我洞察 (revelation) === */
  check('detectDeclaration 「我已经不想要 ta 了」', shadow.detectDeclaration('我已经不想要 ta 了') === true);
  check('detectDeclaration 「算了吧」', shadow.detectDeclaration('算了吧') === true);
  check('detectDeclaration 「放下」', shadow.detectDeclaration('我想放下了') === true);
  check('detectDeclaration 「普通聊天」不命中', shadow.detectDeclaration('今天吃了螺蛳粉') === false);
  check('detectDeclaration 空字符串不命中', shadow.detectDeclaration('') === false);

  /* shouldReveal 各场景 */
  /* 1. 连续 7 天不用 */
  const S_no_use = {
    revealTriggered: false,
    firstUsedAt: now0,
    totalShadowSessions: 5,
    observation: { lastUsedAt: now0 + 1 * 86400000 }
  };
  /* v0.9.3：自动计时触发全部取消——没被问就不该说教 */
  check('shouldReveal: 8 天未用也不自动触发', shadow.shouldReveal(S_no_use, now0 + 8 * 86400000) === false);
  check('shouldReveal: 3 天未用未触发', shadow.shouldReveal(S_no_use, now0 + 4 * 86400000) === false);
  /* 2. 长程使用 */
  const S_long = { revealTriggered: false, firstUsedAt: now0, totalShadowSessions: 50, observation: { lastUsedAt: now0 + 30 * 86400000 } };
  check('shouldReveal: 30 天长程也不自动触发', shadow.shouldReveal(S_long, now0 + 31 * 86400000) === false);
  /* 3. 已经触发过的不再触发 */
  const S_done = { revealTriggered: true, firstUsedAt: now0, totalShadowSessions: 50, observation: { lastUsedAt: now0 } };
  check('shouldReveal: 已触发过不再触发', shadow.shouldReveal(S_done, now0 + 100 * 86400000, '你怎么越来越不像他了') === false);
  /* 4. v0.9.3：只有用户在对话里起疑才触发 */
  check('shouldReveal: 用户起疑才触发',
    shadow.shouldReveal(S_long, now0 + 31 * 86400000, '你怎么越来越不像他了') !== false);
  check('detectDoubt 命中「你怎么越来越不像他了」', shadow.detectDoubt('你怎么越来越不像他了') === true);
  check('detectDoubt 命中「你变了」', shadow.detectDoubt('你变了') === true);
  check('detectDoubt 不命中日常聊天', shadow.detectDoubt('今天上班好累') === false);

  /* affinityStageText 三段文案 */
  check('affinityStageText 80% 走高仿期文案', /影子今天/.test(shadow.affinityStageText(80)));
  check('affinityStageText 50% 走混合文案', /越来越安静/.test(shadow.affinityStageText(50)));
  check('affinityStageText 30% 走通用文案', /脱去了/.test(shadow.affinityStageText(30)));

  /* REVEAL_TRIGGERS 关键文案存在 */
  check('REVEAL_TEXT 包含「根本就不是 TA」', shadow.REVEAL_TRIGGERS.REVEAL_TEXT.indexOf('根本就不是 TA') > -1);
  check('REVEAL_OPTIONS 至少 3 个去向', shadow.REVEAL_TRIGGERS.REVEAL_OPTIONS.length >= 3);
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

/* === UTIL（日期解析 iOS 兼容回归） === */
console.log('\n[util]');
(function () {
  /* parseDate 必须按「本地时区」解析。
     若误用 new Date('2026-09-08')，东八区会变成 08:00（UTC 解析），跨天边界会算错天数。 */
  const d = U.parseDate('2026-09-08');
  check('parseDate 年月日正确',
    !!d && d.getFullYear() === 2026 && d.getMonth() === 8 && d.getDate() === 8, String(d));
  check('parseDate 是本地 00:00:00（非 UTC 解析）',
    !!d && d.getHours() === 0 && d.getMinutes() === 0 && d.getSeconds() === 0,
    d ? (d.getHours() + ':' + d.getMinutes()) : 'null');

  /* 跨月 / 跨年 / 闰年：天数差必须精确为 1 */
  const diff = (a, b) => {
    const x = U.parseDate(a), y = U.parseDate(b);
    return Math.round((y - x) / 86400000);
  };
  check('跨月天数差 = 1 (01-31 → 02-01)', diff('2026-01-31', '2026-02-01') === 1,
    String(diff('2026-01-31', '2026-02-01')));
  check('跨年天数差 = 1 (2025-12-31 → 2026-01-01)', diff('2025-12-31', '2026-01-01') === 1,
    String(diff('2025-12-31', '2026-01-01')));
  check('闰年 2024-02-29 可解析且差 1 天 (→ 03-01)',
    diff('2024-02-29', '2024-03-01') === 1, String(diff('2024-02-29', '2024-03-01')));
  check('整月天数差 = 31 (01-01 → 02-01)', diff('2026-01-01', '2026-02-01') === 31,
    String(diff('2026-01-01', '2026-02-01')));

  /* dayNum */
  check('todayStr 格式 YYYY-MM-DD', /^\d{4}-\d{2}-\d{2}$/.test(U.todayStr()), U.todayStr());
  check('dayNum 当天 = 1', U.dayNum(U.todayStr()) === 1, String(U.dayNum(U.todayStr())));

  const daysAgo = (n) => {
    const t = new Date();
    t.setDate(t.getDate() - n);
    return t.getFullYear() + '-' + ('0' + (t.getMonth() + 1)).slice(-2) +
           '-' + ('0' + t.getDate()).slice(-2);
  };
  check('dayNum 7 天前 = 8', U.dayNum(daysAgo(7)) === 8, String(U.dayNum(daysAgo(7))));
  check('dayNum 30 天前 = 31', U.dayNum(daysAgo(30)) === 31, String(U.dayNum(daysAgo(30))));
  check('未来日期不出现 0 或负数（兜底 1）', U.dayNum(daysAgo(-5)) === 1,
    String(U.dayNum(daysAgo(-5))));

  /* 非法输入 */
  check('dayNum 空串 = 1', U.dayNum('') === 1);
  check('dayNum 非法字符串 = 1', U.dayNum('not-a-date') === 1);
  check('parseDate 非法输入返回 null', U.parseDate('not-a-date') === null);

  /* 其他小工具 */
  check('fmtDate 去零', U.fmtDate('2026-09-08') === '2026 年 9 月 8 日', U.fmtDate('2026-09-08'));
  check('fmtRemain 2:05', U.fmtRemain(125000) === '2:05', U.fmtRemain(125000));
  check('fmtRemain 补零 0:05', U.fmtRemain(5000) === '0:05', U.fmtRemain(5000));
  check('hourBucket 返回合法值',
    ['morning', 'noon', 'afternoon', 'evening', 'late'].indexOf(U.hourBucket()) > -1,
    U.hourBucket());
  check('pick 返回池内元素', ['a', 'b', 'c'].indexOf(U.pick(['a', 'b', 'c'])) > -1);
})();

console.log('\n=== ' + pass + ' passed, ' + fail + ' failed ===');
process.exit(fail === 0 ? 0 : 1);
