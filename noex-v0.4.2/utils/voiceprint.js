// utils/voiceprint.js — 影子语言指纹 v0.9.0
//
// 旧版 analyzeChat 只算 4 个值：平均句长 / 爱不爱用 emoji / 3 个高频词 / 问句率。
// 信息量太少，AI 只能照着"句子短 + 加个呀"去套，结果就是"加了语气词的客服"。
//
// 这里改成提取**可执行的语言指纹**：句长分布、句末标点习惯、具体用了哪些 emoji、
// 语气词、口头禅、称呼、自称、叠词、问句率，外加**若干条真实原话当样本**。
// 大模型模仿一个具体的人，最有效的方式就是给它看这个人真说过的话。

const EMOJI_RE = /[\uD83C-\uDBFF][\uDC00-\uDFFF]|[\u2600-\u27BF\u2B00-\u2BFF\uFE0F]/g;

/* 语气词（句末或句中都能出现）
   ⚠️ v0.9.16：不再收「哈」——「哈哈」已由 CATCHPHRASES 覆盖，
   而单字「哈」在一句「哈哈哈哈」里会被重复计数，把普通人误判成"爱撒娇"。
   同时去掉了原来重复写了两遍的「嘞」。

   v0.9.16 起语气词加了**频率门槛**：偶尔蹦一个「啊」不算特点。
   原因是「啊」「哦」「呢」「吧」在中文里本来就到处都有，
   按出现次数排序必然把 TA 偶尔用的一个字顶到最前面，
   画像里就会出现「语气词：嗯、啊、哦」这种莫名其妙的东西，
   模型照着一写，影子就成了一嘴语气词的假人。 */
const TONE_WORDS = ['啊', '呀', '呢', '吧', '哦', '啦', '嘛', '嘿', '诶', '嗯',
  '咯', '哒', '嗷', '嘞', '喔', '鸭', '惹', '呐', '噜'];

/* 语气词门槛：出现次数 / 消息条数
   实测：真正常带语气词的人 ≥0.3；普通人 0.02~0.1。取 0.2 当分界线。
   整体不达标 → 认定"这人不说语气词"，一个都不列，画像里改成明确禁令。 */
const TONE_MIN_RATE = 0.2;
/* 绝对次数门槛：比例是会被小样本骗到的——5 条消息里蹦出 1 个「啊」就是 0.2，
   正好压线通过，于是"偶尔用了一次"被写成"TA 的习惯"。
   所以再加一条：全文至少出现 2 次，才算得上习惯。 */
const TONE_MIN_COUNT = 2;
/* 单个语气词的门槛：平均每 6~7 条消息至少出现一次，才算 TA 的习惯。 */
const TONE_ITEM_MIN_RATE = 0.15;

/* 口头禅 / 高频短语候选 */
const CATCHPHRASES = ['哈哈', '嘿嘿', '嗯嗯', '好好', '行吧', '好吧', '算了', '不是', '真的',
  '确实', '绝了', '离谱', '无语', '服了', '救命', '笑死', '牛啊', '随便', '都行', '看你',
  '没事', '没事儿', '辛苦', '好嘞', '收到', 'ok', 'OK', 'okk', 'emmm', 'emm', '哈哈哈'];

/* 网络 / 缩写用语 */
const SLANG = ['yyds', 'xswl', 'nb', '666', '绝绝子', '破防', 'emo', '躺平', '卷',
  '栓Q', '蚌埠住了', '泰裤辣', '啊这', '离大谱', '尊嘟', '6666', 'awsl', 'u1s1', 'dddd'];

/* 对对方的称呼 */
const ADDRESS = ['宝宝', '宝贝', '宝子', '乖乖', '亲爱的', '老婆', '老公', '哥哥', '姐姐',
  '傻瓜', '笨蛋', '小猪', '猪猪', '小可爱', '小朋友', '丫头', '小子'];

/* 自称 */
const SELFCALL = { '人家': '人家', '老子': '老子', '你爹': '你爹', '爷': '爷', '俺': '俺', '本少': '本少' };

/* 无信息量的内容，不能当样本也不能计入画像 */
const NOISE = [
  /^\[.{1,10}\]$/,                       // [图片] [语音] [表情]
  /撤回了一条消息/,
  /以上是打招呼的内容/,
  /以下是新消息/,
  /^(.{0,4})?(已添加|已开启|你已添加了)/,
  /^https?:\/\//,
  /微信红包|转账|领取了你的/,
  /^\d{6,}$/,                            // 纯数字（验证码之类）
  /^[\s\p{P}\p{S}]*$/u                   // 纯标点
];

function isNoise(s) {
  if (!s) return true;
  const t = String(s).trim();
  if (!t) return true;
  for (let i = 0; i < NOISE.length; i++) {
    if (NOISE[i].test(t)) return true;
  }
  return false;
}

function count(hay, needle) {
  if (!hay) return 0;
  return hay.split(needle).length - 1;
}

/**
 * 从解析结果里取出「TA 说的话」
 * @param {object} parsed wechat.parseWeChatLog 的返回值
 * @param {string} speaker 发言人（为空则取全部）
 * @returns {string[]} 原话数组
 */
function pickSpeakerLines(parsed, speaker) {
  if (!parsed) return [];
  if (parsed.byName && speaker && parsed.byName[speaker]) {
    return parsed.byName[speaker].filter((s) => !isNoise(s));
  }
  const all = [];
  const bn = parsed.byName || {};
  for (const k in bn) {
    if (speaker && k !== speaker) continue;
    bn[k].forEach((s) => { if (!isNoise(s)) all.push(s); });
  }
  if (all.length) return all;
  return String(parsed.cleaned || '').split(/\n+/).filter((s) => !isNoise(s));
}

/**
 * 建立语言指纹
 * @param {string[]} lines TA 的原话
 * @returns {object} 指纹
 */
function buildVoicePrint(lines) {
  const src = (lines || []).filter((s) => s && String(s).trim());
  const n = src.length;
  if (!n) return emptyPrint();

  const joined = src.join('\n');
  const lens = src.map((s) => String(s).replace(/\s/g, '').length);
  const total = lens.reduce((a, b) => a + b, 0);
  const avgLen = Math.round(total / n);
  const shortRate = lens.filter((l) => l <= 6).length / n;
  const longRate = lens.filter((l) => l >= 30).length / n;

  /* emoji：统计具体符号，而不只是"用没用" */
  const emojiAll = joined.match(EMOJI_RE) || [];
  const emojiFreq = {};
  emojiAll.forEach((e) => { emojiFreq[e] = (emojiFreq[e] || 0) + 1; });
  const emojiTop = Object.keys(emojiFreq)
    .sort((a, b) => emojiFreq[b] - emojiFreq[a])
    .slice(0, 6);

  /* 语气词：带频率门槛。中文里「啊」「哦」「呢」「吧」本来到处都是，
     不做门槛的话它们必然霸占排行榜，把 TA 偶尔用的一个字变成"口头禅"。 */
  const tone = {};
  let toneTotal = 0;
  TONE_WORDS.forEach((w) => {
    const c = count(joined, w);
    if (c > 0) { tone[w] = c; toneTotal += c; }
  });
  const toneRate = Math.round((toneTotal / n) * 100) / 100;
  const toneTop = toneRate >= TONE_MIN_RATE && toneTotal >= TONE_MIN_COUNT
    ? Object.keys(tone)
        .filter((w) => tone[w] / n >= TONE_ITEM_MIN_RATE)
        .sort((a, b) => tone[b] - tone[a])
        .slice(0, 4)
    : [];

  /* 口头禅 */
  const cp = {};
  CATCHPHRASES.forEach((w) => {
    const c = count(joined, w);
    if (c > 0) cp[w] = c;
  });
  const cpTop = Object.keys(cp).sort((a, b) => cp[b] - cp[a]).slice(0, 5);

  /* 网络用语 */
  const slangTop = SLANG.filter((w) => joined.toLowerCase().indexOf(w.toLowerCase()) > -1);

  /* 句末标点 */
  const endPunct = { none: 0, period: 0, exclam: 0, question: 0, tilde: 0, ellipsis: 0 };
  src.forEach((s) => {
    const t = String(s).trim();
    const last = t.charAt(t.length - 1);
    if (/[。.]$/.test(last)) endPunct.period++;
    else if (/[!！]$/.test(last)) endPunct.exclam++;
    else if (/[?？]$/.test(last)) endPunct.question++;
    else if (/[~～]$/.test(last)) endPunct.tilde++;
    else if (/…|\.\.\.$/.test(t)) endPunct.ellipsis++;
    else endPunct.none++;
  });
  Object.keys(endPunct).forEach((k) => { endPunct[k] = Math.round((endPunct[k] / n) * 100) / 100; });

  /* 称呼 / 自称 */
  let address = '';
  for (let i = 0; i < ADDRESS.length; i++) {
    if (joined.indexOf(ADDRESS[i]) > -1) { address = ADDRESS[i]; break; }
  }
  let selfCall = '';
  for (const k in SELFCALL) {
    if (joined.indexOf(k) > -1) { selfCall = SELFCALL[k]; break; }
  }

  /* 叠词（哈哈哈哈 / 哈哈哈 / 好好好） */
  const hasRepeat = /([\u4e00-\u9fa5a-zA-Z])\1{2,}/.test(joined);

  const qRate = Math.round((src.filter((m) => /[?？]/.test(m)).length / n) * 100) / 100;

  return {
    count: n,
    avgLen,
    shortRate: Math.round(shortRate * 100) / 100,
    longRate: Math.round(longRate * 100) / 100,
    emojiLove: emojiAll.length > n * 0.3,
    emojiRate: Math.round((emojiAll.length / n) * 100) / 100,
    emojiTop,
    toneTop,
    toneRate,
    cpTop,
    slangTop,
    endPunct,
    address,
    selfCall,
    hasRepeat,
    qRate,
    samples: pickSamples(src, 6, { toneLover: toneTop.length > 0 })
  };
}

function emptyPrint() {
  return {
    count: 0, avgLen: 0, shortRate: 0, longRate: 0,
    emojiLove: false, emojiRate: 0, emojiTop: [],
    toneTop: [], toneRate: 0, cpTop: [], slangTop: [],
    endPunct: { none: 1, period: 0, exclam: 0, question: 0, tilde: 0, ellipsis: 0 },
    address: '', selfCall: '', hasRepeat: false, qRate: 0,
    samples: []
  };
}

/**
 * 挑代表性原话当 few-shot 样本。
 * 标准：长度 4-24 字、有信息量、彼此不重复、尽量体现风格。
 */
function pickSamples(src, n, opts) {
  const want = n || 6;
  /* v0.9.16：只有 TA 真的爱用语气词时，才优先挑带语气词的句子当样本。
     否则会把 TA 偶尔蹦的一个「啊」放大成"口头禅"，等于教影子撒娇。 */
  const toneLover = !!(opts && opts.toneLover);
  const pool = (src || []).filter(function (s) {
    const t = String(s).trim();
    const len = t.replace(/\s/g, '').length;
    return len >= 3 && len <= 26 && !/https?:\/\//.test(t) && !/\d{5,}/.test(t);
  });
  if (!pool.length) return [];

  /* 打分：能体现风格（含语气词/口头禅/emoji/标点习惯）的优先 */
  const scored = pool.map(function (t, i) {
    let score = 0;
    if (toneLover && /[啊呀呢吧哦啦嘛哈诶嗯咯哒嗷]/.test(t)) score += 2;
    if (/[?？！!~～]$/.test(t)) score += 1;
    if (EMOJI_RE.test(t)) score += 1;
    const len = t.replace(/\s/g, '').length;
    if (len >= 5 && len <= 18) score += 1;    // 太短没信息，太长不适合当样本
    return { t: t, i: i, s: score + Math.random() * 0.9 };
  });
  scored.sort((a, b) => b.s - a.s);

  const out = [];
  const seen = {};
  for (let i = 0; i < scored.length && out.length < want; i++) {
    const t = scored[i].t;
    /* 去重：开头 3 个字相同视为同类，避免样本全是「哈哈哈」 */
    const key = t.slice(0, 3);
    if (seen[key]) continue;
    seen[key] = 1;
    out.push(t);
  }
  return out;
}

/* ── 把指纹翻译成给大模型看的自然语言 ─────────────── */

function pct(v) { return Math.round((v || 0) * 100) + '%'; }

function describe(vp) {
  if (!vp || !vp.count) {
    return '· 没有足够的聊天样本。按普通成年人日常聊天的口吻来，句子短一点，别太热情。';
  }
  const L = [];

  /* 1. 句长 */
  if (vp.avgLen < 8) L.push('· 句子极短，平均只有 ' + vp.avgLen + ' 个字，常常三两个字就发一条，惜字如金。');
  else if (vp.avgLen < 16) L.push('· 句子偏短，平均 ' + vp.avgLen + ' 个字，说完就停，不展开。');
  else if (vp.avgLen < 32) L.push('· 句子中等长度，平均 ' + vp.avgLen + ' 个字。');
  else L.push('· 说话比较长，平均 ' + vp.avgLen + ' 个字，会一口气说一段。');
  if (vp.shortRate >= 0.5) L.push('· 有 ' + pct(vp.shortRate) + ' 的消息在 6 个字以内，经常一个词一条往外蹦。');
  if (vp.longRate >= 0.2) L.push('· 偶尔（' + pct(vp.longRate) + '）会发很长的一段。');

  /* 2. 句末标点 */
  const e = vp.endPunct || {};
  const eps = [
    ['什么都不加', e.none], ['句号', e.period], ['感叹号', e.exclam],
    ['问号', e.question], ['～', e.tilde], ['省略号', e.ellipsis]
  ].filter((x) => x[1] >= 0.15).sort((a, b) => b[1] - a[1]);
  if (eps.length) {
    L.push('· 句末习惯：' + eps.map((x) => x[0] + '（' + pct(x[1]) + '）').join('、') + '。');
  }

  /* 3. emoji */
  if (vp.emojiTop && vp.emojiTop.length) {
    L.push('· 会用的 emoji：' + vp.emojiTop.slice(0, 4).join(' ') + '（每条平均 ' + vp.emojiRate + ' 个，别超量）。');
  } else {
    L.push('· 不用 emoji。');
  }

  /* 4. 语气词 —— v0.9.16：没到门槛就明确下禁令，而不是"干脆不提"。
     只写"TA 不带语气词"是不够的：模型会默认「聊天就该加个呀/啦」，
     照样往上堆。必须写死一句"不许加"，影子才会干巴巴地像真人。

     ⚠️ toneRate 是 v0.9.16 才有的字段。**老画像（升级前建的影子）没有它**，
     所以这里用 `vp.toneRate >= TONE_MIN_RATE` 判断：undefined 比较为 false，
     老画像一律走"不用语气词"分支——否则那些按旧口径统计出来的
     toneTop（「嗯」「呀」「啦」）会继续生效，等于这次改动对老用户失效。 */
  if (vp.toneRate >= TONE_MIN_RATE && vp.toneTop && vp.toneTop.length) {
    L.push('· 高频语气词：' + vp.toneTop.join('、') +
      '（这是 TA 真的习惯，可以自然带出来，但不要每句都挂）。');
  } else {
    L.push('· 不用语气词。「啊」「呀」「啦」「呢」「吧」「哦」「嘛」「嘿」「诶」「～」' +
      '这些一个都不要加——不加语气词，才像 TA。');
  }

  /* 5. 口头禅 */
  if (vp.cpTop && vp.cpTop.length) L.push('· 口头禅：' + vp.cpTop.join('、') + '。');

  /* 6. 网络用语 */
  if (vp.slangTop && vp.slangTop.length) L.push('· 会用网络用语：' + vp.slangTop.join('、') + '。');

  /* 7. 称呼 / 自称 */
  if (vp.address) L.push('· 称呼对方用「' + vp.address + '」。');
  if (vp.selfCall) L.push('· 自称「' + vp.selfCall + '」。');

  /* 8. 叠词 */
  if (vp.hasRepeat) L.push('· 爱用叠词（比如「哈哈哈哈」「好好好」）。');

  /* 9. 问句 */
  if (vp.qRate >= 0.3) L.push('· 经常反问或追问，爱用问句（' + pct(vp.qRate) + '）。');
  else if (vp.qRate <= 0.08) L.push('· 几乎不问问题，不主动追问。');

  return L.join('\n');
}

/* 用户能看到的画像摘要（影子首页展示用，和给 AI 看的是两套） */
function summary(vp) {
  if (!vp || !vp.count) return '';
  const L = [];
  if (vp.avgLen < 8) L.push('· 话很少，常常几个字');
  else if (vp.avgLen > 30) L.push('· 话比较多，会说一整段');
  else L.push('· 回复长短适中');
  if (vp.emojiTop && vp.emojiTop.length) L.push('· 会用 ' + vp.emojiTop.slice(0, 3).join(' '));
  /* 用户看到的摘要：只有真的到门槛才写（老画像缺 toneRate 一律不写）。
     摘要里出现「常带「嗯」「呀」」是最容易被当成"莫名其妙"的一行，
     因为这几个字在中文里本来就到处都是。 */
  if (vp.toneRate >= TONE_MIN_RATE && vp.toneTop && vp.toneTop.length) {
    L.push('· 说话爱带「' + vp.toneTop.slice(0, 3).join('」「') + '」');
  }
  if (vp.cpTop && vp.cpTop.length) L.push('· 爱说「' + vp.cpTop.slice(0, 3).join('」「') + '」');
  if (vp.address) L.push('· 会叫你「' + vp.address + '」');
  if (vp.qRate >= 0.3) L.push('· 喜欢反问');
  if (!L.length) L.push('· 语气比较平，没有明显口头禅');
  return L.join('\n');
}

module.exports = {
  buildVoicePrint,
  pickSamples,
  pickSpeakerLines,
  describe,
  summary,
  emptyPrint,
  isNoise
};
