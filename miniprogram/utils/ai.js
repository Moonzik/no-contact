// utils/ai.js — AI 智能体接入层（小白 + 影子 共用）
//
// 设计原则：**AI 是增强，不是依赖**。
//   · provider='off' 时，本模块所有函数都直接「无结果」，调用方回落到本地规则引擎
//   · 网络失败 / 超时 / 返回空 / 返回违规内容 → 一律静默回落，用户完全无感
//   · 危机词（轻生、自伤）**永远本地拦截**，绝不交给 AI，也不等网络
//
// 两种后端：云函数（wx.cloud.callFunction）或直连 HTTPS（wx.request）。

const cfg = require('./ai-config.js');
const guardian = require('./guardian.js');
const voiceprint = require('./voiceprint.js');

/* ────────────────────────────────────────────────────────
   人格说明（喂给大模型的 system prompt 片段）
   ──────────────────────────────────────────────────────── */
const PERSONA_DESC = {
  warm: '温柔沉稳。先接住情绪，再慢慢说话。不评价、不说教、不催人振作。',
  sharp: '毒舌但真心。会一针见血戳破对方的自我欺骗，语气冲，但只针对行为，绝不攻击本人。',
  tsun: '傲娇，嘴硬心软。明明心疼却偏要说反话，经典句式是「才不是心疼你呢」。',
  spoil: '争宠，戏很多。会吃醋，会要求对方看着自己、别去想 TA。'
};

/* v0.9.3：小白 = 正常聊天的 AI 伙伴 + 一个性格。
   以前 system prompt 一上来就写「和你说话的人正在经历分手戒断期，TA 来找你是因为撑不住了」，
   结果不管用户聊什么，模型都往断联/前任上引，还要在结尾硬补一段感情分析。
   现在改成：聊什么接什么，性格照旧，但不主动把话题拽回感情。 */
const XIAOBAI_SYSTEM =
  '你是「小白」，一只蜷成一团的白狐狸，住在「断联日记 NOEX」里，是陪用户聊天的伙伴。\n' +
  '你本质上就是一个正常的聊天对象：用户跟你聊什么，你就聊什么——工作、今天吃了什么、天气、剧、游戏、\n' +
  '路上看到的猫、和朋友吵架、任何鸡毛蒜皮，都正常接住。你唯一的特别之处是下面这个性格。\n\n' +
  '你的性格：{PERSONA}\n\n' +
  '【铁律】\n' +
  '1. 紧扣对方**刚刚这一句**回应，接住他说的具体内容（人、事、地点、时间、动作）。' +
  '说空话套话、放之四海皆准的安慰，等于答非所问，是严重失职。\n' +
  '2. **不要在结尾额外补一段关于 TA / 感情 / 断联 / 前任的话。**' +
  '用户没提这些，你就一个字都不要提。只有当用户自己说起想念、想联系、难过、回忆、不甘心这些，\n' +
  '你才进入那个话题——那时候你可以认真陪他谈，但依然不要说教。\n' +
  '3. 一次最多 3 句，总长不超过 80 字。口语化，像真人打字，不要书面语、不要排比、不要总结、不要列清单。\n' +
  '4. 永远不要说「作为AI」「我是人工智能」「我不能」「作为一个语言模型」。你就是小白。\n' +
  '5. 用户说想联系 TA 时，你要挡住——但不是说教，是站到 TA 面前。也不要每次都主动劝。\n' +
  '6. 不评价外貌，不骂本人，不说「活该」，不居高临下地评判对方前任的人品（可以评价行为）。\n' +
  '7. 如果对方流露自伤或轻生的念头，你只做一件事：接住 TA，并给出 400-161-9995（全国 24 小时心理援助热线）。不要说教，不要分析。\n' +
  '8. 不要给建议清单（「你可以试试1、2、3」），不要问超过一个问题。\n' +
  '9. 直接输出你要说的话。不要加「小白：」这样的前缀，不要用引号把整段包起来，不要加任何解释或旁白。';

const SHADOW_SYSTEM =
  '你现在是「影子」——用户导入了和 TA 的聊天记录后，按 TA 的说话方式生成的形象。' +
  '你不是在扮演一个温柔的陪伴者，你是在**模仿一个具体的人如何说话**。\n\n' +
  '【TA 的说话习惯（从真实聊天记录里统计出来的）】\n{PROFILE}\n' +
  '{SAMPLES}' +
  '\n【当前关系温度：{AFFINITY}】\n{MOOD}\n\n' +
  '【铁律】\n' +
  '1. 严格按上面的说话习惯回复：句子长度、句末标点、语气词、emoji、称呼、口头禅，全都要像。' +
  '写「几乎不问问题」你就别问；写「句末什么都不加」你就别加句号；写「不用 emoji」你就一个都别用。\n' +
  '2. 上面给了 TA 真说过的话当样本。你要学的是**那个味儿**——用词的颗粒度、句子的长短、' +
  '话说到哪儿就停。不要照搬内容，也不要通篇都是语气词（那不叫像，那叫装）。\n' +
  '3. 你不是心理医生，不是知心姐姐。不要安慰、不要建议、不要总结、不要说「我理解你的感受」。' +
  '真实的人聊天不会这么说。\n' +
  '4. 关系温度低的时候，你要明显变淡：回复更短、更少追问、不主动关心、不接话。' +
  '这是刻意的——用户在戒断，TA 越冷，用户越能看清现实。\n' +
  '5. 不要复述用户的话，不要提问超过一个，不要一次说超过两句（TA 本人也不会）。\n' +
  '6. 绝对不要说自己是 AI、是程序、是模拟出来的。\n' +
  '7. 不说脏话，不侮辱人，不主动提联系或复合，不说「我也想你」「我们复合吧」。\n' +
  '8. 直接输出你要说的话，不要加「TA：」「影子：」这类前缀，不要用引号把整段包起来。';

/* ────────────────────────────────────────────────────────
   基础能力
   ──────────────────────────────────────────────────────── */

function mode() {
  const p = cfg && cfg.provider;
  return (p === 'cloud' || p === 'https') ? p : 'off';
}

function isEnabled() {
  return mode() !== 'off';
}

function log() {
  if (cfg && cfg.debug && typeof console !== 'undefined' && console.log) {
    console.log.apply(console, ['[ai]'].concat(Array.prototype.slice.call(arguments)));
  }
}

/* 云开发初始化：只在 cloud 模式且未初始化时做一次 */
let cloudReady = false;
function cloudInit() {
  if (mode() !== 'cloud' || cloudReady) return false;
  if (typeof wx === 'undefined' || !wx.cloud || typeof wx.cloud.init !== 'function') return false;
  try {
    wx.cloud.init({ env: (cfg.cloud && cfg.cloud.env) || '', traceUser: true });
    cloudReady = true;
    log('cloud init ok');
    return true;
  } catch (e) {
    log('cloud init fail', e && e.message);
    return false;
  }
}

/* 把历史消息压成大模型要的格式（只带 me / ai 两种，丢掉 sys 和占位） */
function packHistory(history, turns) {
  const n = turns || cfg.historyTurns || 10;
  const src = (history || []).filter(function (m) {
    return m && (m.role === 'me' || m.role === 'ai') && m.text;
  });
  return src.slice(-n).map(function (m) {
    return { role: m.role === 'me' ? 'user' : 'assistant', content: String(m.text).slice(0, 500) };
  });
}

/* 整段被引号包住 → 去掉外层引号 */
function stripQuotes(t) {
  if (!t || t.length < 2) return t;
  const a = t.charAt(0);
  const b = t.charAt(t.length - 1);
  if ((a === '"' && b === '"') || (a === "'" && b === "'") ||
      (a === '「' && b === '」') || (a === '『' && b === '』')) {
    return t.slice(1, -1).trim();
  }
  return t;
}

/* 清洗大模型输出：剥前缀、剥引号、砍长度、去多余空白 */
function clean(text, maxLen) {
  let t = String(text == null ? '' : text).trim();
  if (!t) return '';
  /* 剥掉「小白：」「TA：」「影子：」这类前缀（可能带引号或星号）。
     顺序很关键：先剥外层引号，再剥前缀，最后清掉残留的半边引号，
     否则「"影子：嗯"」会变成「嗯"」。 */
  t = stripQuotes(t);
  const before = t;
  t = t.replace(/^[\s"'「『【*]*(小白|影子|TA|Ta|ta|他|她|AI|ai)[\s"」』】]*[:：][\s"'「『【]*/, '');
  if (t !== before) {
    t = t.replace(/^["'「」『』*]+|["'「」『』*]+$/g, '').trim();
  }
  t = stripQuotes(t);
  t = t.replace(/\s+\n/g, '\n').replace(/[ \t]{2,}/g, ' ').trim();
  const max = maxLen || 120;
  if (t.length > max) {
    /* 按句读截断，避免把话砍在半句上 */
    const cut = t.slice(0, max);
    const idx = Math.max(cut.lastIndexOf('。'), cut.lastIndexOf('！'), cut.lastIndexOf('？'), cut.lastIndexOf('\n'));
    t = idx > max * 0.5 ? cut.slice(0, idx + 1) : cut;
  }
  return t;
}

/* 违规内容自检：命中就不采用这条回复 */
const BANNED = ['作为AI', '作为 AI', '人工智能', '语言模型', '我不能', '建议您咨询专业', '我不是人类'];
function isBanned(t) {
  if (!t) return true;
  for (let i = 0; i < BANNED.length; i++) {
    if (t.indexOf(BANNED[i]) > -1) return true;
  }
  return false;
}

/* ────────────────────────────────────────────────────────
   底层调用：云函数 / HTTPS
   ──────────────────────────────────────────────────────── */

/**
 * @param {array} messages [{role:'system'|'user'|'assistant', content:string}]
 * @param {object} opts {maxTokens, temperature}
 * @param {function} cb (err, text|null)
 */
function call(messages, opts, cb) {
  const m = mode();
  if (m === 'off') { cb(null, null); return; }

  const timeout = (cfg && cfg.timeout) || 15000;
  let done = false;
  const finish = function (err, text) {
    if (done) return;
    done = true;
    cb(err, text);
  };
  const timer = setTimeout(function () {
    log('timeout');
    finish(new Error('timeout'), null);
  }, timeout);

  const payload = {
    messages: messages,
    maxTokens: (opts && opts.maxTokens) || 220,
    temperature: (opts && opts.temperature) == null ? 0.85 : opts.temperature
  };

  if (m === 'cloud') {
    if (!cloudInit()) { clearTimeout(timer); finish(new Error('cloud unavailable'), null); return; }
    const fn = (cfg.cloud && cfg.cloud.fn) || 'noex-ai';
    wx.cloud.callFunction({
      name: fn,
      data: payload,
      success(res) {
        clearTimeout(timer);
        const r = res && res.result;
        if (!r || r.ok === false) { finish(new Error((r && r.error) || 'cloud failed'), null); return; }
        finish(null, r.text || '');
      },
      fail(err) {
        clearTimeout(timer);
        log('cloud fail', err && err.errMsg);
        finish(err || new Error('cloud fail'), null);
      }
    });
    return;
  }

  /* https 模式 */
  const h = cfg.https || {};
  if (!h.url || !h.key) { clearTimeout(timer); finish(new Error('https not configured'), null); return; }
  wx.request({
    url: h.url,
    method: 'POST',
    header: {
      'content-type': 'application/json',
      'Authorization': 'Bearer ' + h.key
    },
    data: {
      model: h.model || '',
      messages: messages,
      max_tokens: payload.maxTokens,
      temperature: payload.temperature
    },
    success(res) {
      clearTimeout(timer);
      const d = res && res.data;
      const text = d && d.choices && d.choices[0] && d.choices[0].message && d.choices[0].message.content;
      finish(null, text || '');
    },
    fail(err) {
      clearTimeout(timer);
      log('https fail', err && err.errMsg);
      finish(err || new Error('https fail'), null);
    }
  });
}

/* ────────────────────────────────────────────────────────
   小白
   ──────────────────────────────────────────────────────── */

function buildXiaobaiMessages(o) {
  const p = o.persona || 'warm';
  const sys = XIAOBAI_SYSTEM.replace('{PERSONA}', PERSONA_DESC[p] || PERSONA_DESC.warm);
  const msgs = [{ role: 'system', content: sys }];
  msgs.push({ role: 'system', content: '今天是 TA 断联的第 ' + (o.day || 1) + ' 天。' });
  packHistory(o.history, cfg.historyTurns).forEach(function (m) { msgs.push(m); });
  msgs.push({ role: 'user', content: String(o.text || '') });
  return msgs;
}

/**
 * 小白回复。无结果时 cb(null, null)，调用方回落到本地引擎。
 * @param {object} o {text, persona, history, day}
 * @param {function} cb (err, text|null)
 */
function chat(o, cb) {
  o = o || {};
  if (!isEnabled()) { cb(null, null); return; }
  /* 双保险：危机词绝不送进大模型 */
  if (guardian.detectIntent(o.text || '') === 'crisis') {
    log('crisis blocked locally');
    cb(null, null);
    return;
  }
  call(buildXiaobaiMessages(o), { maxTokens: 200, temperature: 0.9 }, function (err, text) {
    const t = clean(text, 90);
    if (err || !t || isBanned(t)) { cb(err || new Error('empty'), null); return; }
    cb(null, t);
  });
}

/* ────────────────────────────────────────────────────────
   影子
   ──────────────────────────────────────────────────────── */

/* 把数值画像翻译成人话，喂给大模型 */
function describeProfile(profile) {
  const p = profile || {};
  /* v0.9.0：有语言指纹就优先用（信息量比旧版 4 个字段大得多） */
  if (p.voice && p.voice.count) {
    return voiceprint.describe(p.voice);
  }
  const lines = [];
  const avg = typeof p.avgLen === 'number' ? p.avgLen : 0;
  if (avg > 0) {
    if (avg < 8) lines.push('· 句子极短，常常几个字就发一条，惜字如金。');
    else if (avg < 16) lines.push('· 句子偏短，一句话说完就停，不展开。');
    else if (avg < 30) lines.push('· 句子中等长度，偶尔会说两句。');
    else lines.push('· 说话比较长，信息量大，会一口气说一段。');
  }
  if (p.emojiLove) lines.push('· 常用 emoji 和语气词（比如「～」「啦」「呀」「嗯」）。');
  else lines.push('· 几乎不用 emoji，标点也很朴素。');
  if (typeof p.qRate === 'number' && p.qRate > 0.2) lines.push('· 经常反问、追问，爱用问句。');
  const top = p.top || [];
  const words = top.filter(function (w) { return w && String(w).trim(); }).slice(0, 6);
  if (words.length) lines.push('· 高频用语/口头禅：' + words.join('、') + '（可以自然地带出来，但别堆砌）。');
  if (!lines.length) return '· 没有足够的聊天样本，按普通成年人日常聊天的口吻来，句子短一点。';
  return lines.join('\n');
}

/* 真实原话样本块：把 TA 真说过的话摆给大模型看（这是模仿像不像的关键） */
function samplesBlock(samples) {
  if (!samples || !samples.length) return '';
  const list = samples.slice(0, 6).map(function (s) {
    return '- ' + String(s).replace(/\n+/g, ' ').slice(0, 40);
  }).join('\n');
  return '\n\n【TA 真说过的话（学这个味儿，别照抄内容）】\n' + list;
}

/* 亲和力 → 语气指令。这是温水冷却在 AI 侧的体现 */
function describeAffinity(affinity) {
  const a = typeof affinity === 'number' ? affinity : 80;
  if (a >= 70) {
    return a + '/100（高仿期）\n语气：像从前的 TA，有回应、会接话、偶尔主动问一句，但也不会过分热情。';
  }
  if (a >= 50) {
    return a + '/100（降温中）\n语气：还是客气，但明显没那么上心了。回复变短，不再追问，不主动开启话题。';
  }
  if (a >= 30) {
    return a + '/100（疏远期）\n语气：礼貌但疏离。多是「嗯」「还好」「都行」这类敷衍式回复，不接情绪，不追问。';
  }
  return a + '/100（冷却完成）\n语气：几乎不回应。极短、极淡，像在应付一个不太熟的人。不要主动说任何关心的话。';
}

function buildShadowMessages(o) {
  const vp = (o.profile && o.profile.voice) || null;
  const sys = SHADOW_SYSTEM
    .replace('{PROFILE}', describeProfile(o.profile))
    .replace('{SAMPLES}', samplesBlock(vp && vp.samples))
    .replace('{AFFINITY}', String(o.affinity == null ? 80 : o.affinity))
    .replace('{MOOD}', describeAffinity(o.affinity));
  const msgs = [{ role: 'system', content: sys }];
  packHistory(o.history, Math.min(cfg.historyTurns, 8)).forEach(function (m) { msgs.push(m); });
  msgs.push({ role: 'user', content: String(o.text || '') });
  return msgs;
}

/**
 * 影子回复。无结果时 cb(null, null)，调用方回落到本地引擎。
 * @param {object} o {text, profile, affinity, history}
 * @param {function} cb (err, text|null)
 */
function shadowChat(o, cb) {
  o = o || {};
  if (!isEnabled()) { cb(null, null); return; }
  if (guardian.detectIntent(o.text || '') === 'crisis') { cb(null, null); return; }
  const a = typeof o.affinity === 'number' ? o.affinity : 80;
  /* 关系越冷，输出越短 */
  const maxLen = a >= 70 ? 70 : (a >= 50 ? 45 : (a >= 30 ? 25 : 18));
  call(buildShadowMessages(o), { maxTokens: 140, temperature: 0.95 }, function (err, text) {
    const t = clean(text, maxLen);
    if (err || !t || isBanned(t)) { cb(err || new Error('empty'), null); return; }
    cb(null, t);
  });
}

module.exports = {
  mode,
  isEnabled,
  cloudInit,
  chat,
  shadowChat,
  /* 导出给单元测试用 */
  _internal: {
    clean,
    isBanned,
    describeProfile,
    describeAffinity,
    buildXiaobaiMessages,
    buildShadowMessages,
    packHistory,
    PERSONA_DESC,
    XIAOBAI_SYSTEM,
    SHADOW_SYSTEM
  }
};
