// utils/shadow.js — 影子 v0.4.0
// 三个层次叠加：
//   1. 基于聊天记录生成的语气画像 + 短句回复（v0.3.0 起）
//   2. 温水冷却：相似度按天数 + session 数衰减，21 天后触底（v0.4.0 起）
//   3. 自我洞察触发器：在合适时刻温和地说出关键洞察（v0.4.0 起）
//
// 设计原则：用户感知不到机制，只感觉"影子越来越安静"。
// 关键洞察文案：REVEAL_TRIGGERS.REVEAL_TEXT（"你看，你需要的根本就不是 TA。"）

const SHADOW_MAX_DAY = 3;
const SHADOW_MS = 20 * 60 * 1000; // 单次最长 20 分钟

/* ============ 温水冷却参数 ============ */
const SHADOW_AFFINITY = {
  INIT: 80,             // 起步相似度（第一天）
  FLOOR: 30,            // 触底线（不再下降）
  DAY_DECAY: 2.5,       // 每自然天衰减 %/day
  SESSION_PENALTY: 2,   // session 数衰减系数
  HI_THRESHOLD: 60,     // 高仿期下限（>=60 → 走高仿池）
  LOW_THRESHOLD: 40     // 通用期上限（<40 → 完全通用池）
};

/* ============ 自我洞察触发参数 ============ */
const REVEAL_TRIGGERS = {
  NO_USE_DAYS: 7,                  // 连续 N 天未使用即触发
  USER_DECLARATIONS: [             // 用户主动宣告（影子对话里说）的关键句
    '我不想要', '不需要', '我已经不想要', '我已经不想',
    '算了', '就算了吧', '无所谓', '真的不重要',
    '放下', '放下了', '放弃', '不想 ta', '不想他',
    '不在乎', '不想复合', '放下来', '不需要 ta', '不需要 TA',
    '我不想再', '不想再想', '不想再联系', '不必再', '不必想'
  ],
  LONG_TERM_DAYS: 30,               // 跨过这个天数自然触发
  AFFINITY_FLOOR_DAYS: 14,         // 在 30% 持续 14 天也触发
  /* v0.9.3：用户当场起疑时，影子先说的那一句（之后才弹揭示） */
  DOUBT_REPLY: '……嗯。被你发现了。',
  REVEAL_TEXT: '你看，你需要的根本就不是 TA。',
  REVEAL_SECONDARY: '也许不是 TA 本身 —— 是想念、安全感、习惯、或者「想被 TA 看见」这件事本身。\n你值得的是这种需要本身，而不是任何具体的人来满足它。',
  REVEAL_OPTIONS: [
    { key: 'guardian', label: '回小白那儿继续聊聊', target: '/pages/xiaobai/xiaobai', mode: 'switchTab' },
    { key: 'bottle',   label: '把想说的话写进留白瓶', target: '/pages/bottle/bottle',   mode: 'navigateTo' },
    { key: 'today',    label: '出门走走吧', target: '/pages/today/today',             mode: 'switchTab' }
  ]
};

function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

/* 去重取句：优先取「没用过的」；整池用完才清空该池重来（v0.7.0） */
function pickUnused(arr, usedMap) {
  if (!arr || !arr.length) return '';
  if (!usedMap) return pick(arr);
  const avail = [];
  for (let i = 0; i < arr.length; i++) {
    if (!usedMap[arr[i]]) avail.push(arr[i]);
  }
  if (!avail.length) {
    for (let i = 0; i < arr.length; i++) delete usedMap[arr[i]];
    return pick(arr);
  }
  return pick(avail);
}

/* 影子语气分类（每次随机给一个变体，避免一眼能看出是机器人） */
function shadowIntents() {
  return {
    miss:  ['想你','想你了','好想','我还爱你','忘不了'],
    ask:   ['还爱','爱过我','为什么','复合','回来','我们还能','做错了什么','你的意思'],
    angry: ['对不起','抱歉','你凭什么','恨你','骗子','渣'],
    bye:   ['再见','拜拜','走了','最后','告个别','再见了'],
    greet: ['在吗','你好','嗨','是我']
  };
}

/* ============ 通用回复池（所有阶段都可用，低相似度时优先） ============ */
/* v0.7.0：每格扩到 8 句。影子本来就短，格子太小会三两句就绕回来。 */
const SHADOW_POOL = {
  miss:  ['嗯。','我知道。','……嗯。','这段时间，你还好吗。','我也……说不好。','嗯，我听见了。','……别说了，我懂。','你想就好。'],
  ask:   ['我不知道怎么回答这个。','……这个问题，我想放一放。','你希望我怎么说呢。','……给我点时间。','这个问题，我也没有答案。','嗯……以后再说吧。','你真的想知道吗。','……我不太想聊这个。'],
  angry: ['对不起。','嗯，你说，我听着。','……我没资格解释。','嗯。是我的问题。','……你骂吧。','我知道我做得不好。','嗯，你说得对。','……我没话说。'],
  bye:   ['嗯，去吧。','照顾好自己。','……嗯。再见。','好。','那就这样吧。','……我会记得的。','你走吧，别回头。','嗯。'],
  greet: ['嗯。','在。','……是你啊。','嗯，我来晚了。','你来了。','……嗯，我在。','好久不见。','嗯，说吧。'],
  fallback: ['嗯。','……','在听。','你说。','……嗯。','我在。','嗯，然后呢。','……我知道了。']
};

/* ============ 高仿回复池（仅高相似度时使用，拼接用户口头禅） ============
 * 占位符：
 *   ${top1} = 用户最常说的口头禅（如"呀"）
 *   ${top2} = 第二口头禅（如"嗯嗯"）
 *   ${top3} = 第三口头禅（如"啦"）
 * 池里的话不能"装得太像 TA"——保持短、抽象、克制；
 * 用户的口头禅只用来在尾巴带上，是提味，不是变声。
 */
const SHADOW_POOL_HIGH = {
  miss: [
    '${top1}…你怎么又想起这件事。',
    '……${top1}……',
    '${top2}，是你呀。',
    '这段时候……${top1}是真的吗。',
    '${top1}……我也没办法。',
    '${top3} 别问了。',
    '……${top2} 我也是。',
    '${top1}……你还好吗。'
  ],
  ask: [
    '${top1}……这个问题，我想放一放。',
    '你希望我怎么说呢${top2}。',
    '${top3} 我不知道怎么回答。',
    '${top1}……给我点时间。',
    '……${top2} 以后再说吧。',
    '${top3} 你真的想知道吗。'
  ],
  angry: [
    '对不起${top2}。',
    '嗯，你说，${top1}我听着。',
    '${top2} 我没资格解释。',
    '${top1}……是我的问题。',
    '……${top3} 你骂吧。',
    '${top2} 我知道我做得不好。'
  ],
  bye: [
    '${top2} 去吧。',
    '照顾好自己${top1}。',
    '……${top3}。再见。',
    '${top1}……那就这样吧。',
    '${top2} 别回头。',
    '……${top1} 我会记得的。'
  ],
  greet: [
    '${top1}',
    '在${top2}？',
    '……${top1}是你呀。',
    '${top3} 你来了。',
    '${top2} 嗯，我在。',
    '……${top1} 说吧。'
  ],
  fallback: [
    '${top1}……',
    '在听${top2}。',
    '${top3}你说。',
    '${top1} 嗯。',
    '……${top2}',
    '${top3} 我在。'
  ]
};

/* ============ 模板替换 ============ */
function fillTemplate(tpl, top) {
  const t = (top && top.length >= 3) ? top.slice(0, 3) : (top || []).slice();
  // 兜底：保证 t[0..2] 都有值
  const pool = ['嗯', '呀', '啦'];
  for (let i = 0; i < 3; i++) {
    if (!t[i]) t[i] = pool[i] || '嗯';
  }
  return tpl
    .replace('${top1}', t[0])
    .replace('${top2}', t[1])
    .replace('${top3}', t[2]);
}

/* ============ 选档：相似度 → 池子 ============ */
function pickTier(affinity, rng) {
  const r = rng || Math.random;
  if (affinity >= SHADOW_AFFINITY.HI_THRESHOLD) return 'high';
  if (affinity >= SHADOW_AFFINITY.LOW_THRESHOLD) {
    return r() < 0.5 ? 'high' : 'base';
  }
  return 'base';
}

/**
 * 影子回复（v0.4.0 起第三参数为 affinity，不传默认 80）
 * @param {string} text
 * @param {object} profile 画像 {avgLen, emojiLove, top, qRate}
 * @param {number} affinity 0-100（默认 SHADOW_AFFINITY.INIT）
 * @param {function=} rng 可选，Math.random 替代（测试用）
 * @param {object=} usedMap 已使用句子字典（v0.7.0 去重，传 S.usedReplies）
 */
function shadowReply(text, profile, affinity, rng, usedMap) {
  const used = usedMap || null;
  const tier = pickTier(typeof affinity === 'number' ? affinity : SHADOW_AFFINITY.INIT, rng);

  /* 组装一次（不落库），外层判重；最多试 12 次 */
  const build = () => {
    const keys = shadowIntents();
    for (const k in keys) {
      for (let i = 0; i < keys[k].length; i++) {
        if (text.indexOf(keys[k][i]) > -1) {
          if (tier === 'high') {
            const tpl = pickUnused(SHADOW_POOL_HIGH[k], used);
            return { out: fillTemplate(tpl, profile && profile.top), tpl: tpl };
          }
          const s = pickUnused(SHADOW_POOL[k], used);
          return { out: s, tpl: s };
        }
      }
    }
    if (tier === 'high') {
      const tpl = pickUnused(SHADOW_POOL_HIGH.fallback, used);
      return { out: fillTemplate(tpl, profile && profile.top), tpl: tpl };
    }
    const s = pickUnused(SHADOW_POOL.fallback, used);
    return { out: s, tpl: s };
  };

  let r = build();
  for (let n = 0; n < 12 && used && used[r.out]; n++) r = build();

  let out = r.out;
  // 保留 v0.3.0 的 emoji 尾巴 + 短句截断机制（仅基础池生效，高仿池已有自带的克制）
  if (tier === 'base') {
    if (profile && profile.emojiLove && Math.random() < 0.4) {
      out += pick(['🥲','…','。']);
    }
    if (profile && profile.avgLen < 10 && Math.random() < 0.5) {
      out = out.split('。')[0] + '。';
    }
  }
  if (used) { used[r.tpl] = 1; used[out] = 1; }
  return out;
}

/**
 * 分析聊天记录（每行一条）
 * 返回 { count, avgLen, emojiLove, top:[口头禅], qRate:反问率 }
 */
function analyzeChat(text) {
  const msgs = text
    .split(/\n+/)
    .map((s) => s.trim())
    .filter(Boolean);
  const joined = msgs.join('');
  const avgLen = msgs.length ? Math.round(joined.length / msgs.length) : 0;
  const emoji = (joined.match(/[\uD83C-\uDBFF][\uDC00-\uDFFF]/g) || []).length;
  const parts = {};
  ['哈哈','嗯嗯','呀','啦','嘛','哦','~','。。。','？'].forEach((w) => {
    const c = joined.split(w).length - 1;
    if (c > 0) parts[w] = c;
  });
  const qRate = msgs.length
    ? msgs.filter((m) => /[?？]$/.test(m)).length / msgs.length
    : 0;
  const top = Object.keys(parts)
    .sort((a, b) => parts[b] - parts[a])
    .slice(0, 3);
  return {
    count: msgs.length,
    avgLen,
    emojiLove: emoji > msgs.length * 0.3,
    top,
    qRate
  };
}

function profileSummary(p) {
  if (!p) return '';
  const lines = [];
  lines.push(
    p.avgLen < 10
      ? '· 回复偏简短，常常只有一两个字'
      : p.avgLen > 30
      ? '· 话偏多，一次会说一大段'
      : '· 回复长短适中'
  );
  if (p.emojiLove) lines.push('· 习惯用表情收尾');
  if (p.top.length) lines.push('· 常说「' + p.top.join('」「') + '」');
  if (p.qRate > 0.25) lines.push('· 喜欢用反问');
  if (lines.length === 1) lines.push('· 语气比较平，没有明显口头禅');
  return lines.join('\n');
}

/* ============ 温水冷却：相似度计算 ============ */
function computeAffinity(firstUsedAt, totalSessions, now) {
  if (!firstUsedAt || firstUsedAt <= 0) return SHADOW_AFFINITY.INIT;
  const t = now || Date.now();
  const days = Math.max(0, Math.floor((t - firstUsedAt) / 86400000));
  const sess = Math.max(0, totalSessions || 0);
  const penalty = SHADOW_AFFINITY.SESSION_PENALTY * Math.log2(sess + 1);
  const v = SHADOW_AFFINITY.INIT - SHADOW_AFFINITY.DAY_DECAY * days - penalty;
  return Math.max(SHADOW_AFFINITY.FLOOR, Math.round(v * 10) / 10);
}

/* ============ 自我洞察：用户关键句检测 ============ */
function detectDeclaration(text) {
  if (!text || typeof text !== 'string') return false;
  for (let i = 0; i < REVEAL_TRIGGERS.USER_DECLARATIONS.length; i++) {
    if (text.indexOf(REVEAL_TRIGGERS.USER_DECLARATIONS[i]) > -1) return true;
  }
  return false;
}

/* v0.9.3 · 用户「起疑」检测。
   用户原话：「这句话要等用户和影子聊天的时候发出疑问，类似说你怎么越来越不像他了，才可以发送给用户。」
   以前揭示是被动计时（7 天没用 / 满 30 天 / 相似度触底 14 天）自动弹出来的，
   用户根本没问就被说教，体验很糟。现在**只认用户在对话里主动提出的疑问**。 */
const DOUBT_KEYS = [
  '不像', '不像他', '不像她', '不像ta', '不像TA', '越来越不像', '怎么不像',
  '你变了', '你怎么变了', '变了好多', '感觉你变了',
  '你不是他', '不是他', '不是她', '不是ta', '根本不是他', '假的',
  '你到底是谁', '你是谁', '谁在', '装得像', '装的像', '在装', '装他', '装她',
  '以前你会', '以前你都', '以前不是', '你以前',
  '你怎么不', '怎么不', '不对劲', '怪怪的', '好陌生', '陌生',
  '怪不得', '不是本人', '模拟', 'ai吧', 'AI吧', '机器人', '程序'
];

function detectDoubt(text) {
  if (!text || typeof text !== 'string') return false;
  const t = text.toLowerCase();
  for (let i = 0; i < DOUBT_KEYS.length; i++) {
    if (t.indexOf(String(DOUBT_KEYS[i]).toLowerCase()) > -1) return true;
  }
  return false;
}

/* ============ 自我洞察：触发判定 ============
 * v0.9.3：自动计时触发**全部取消**。
 * 现在唯一的触发方式是：用户在影子对话里主动起疑（detectDoubt），
 * 或者用户自己宣告放下了（detectDeclaration）。
 * 保留这个函数是为了兼容旧调用（不传用户原话时恒为 false）。
 * 一旦 revealTriggered=true，永远不会再触发。
 */
function shouldReveal(shadowState, now, lastUserText) {
  if (!shadowState || shadowState.revealTriggered) return false;
  /* 只有用户真的说了「你怎么越来越不像他了」这种话，才算数 */
  if (detectDoubt(lastUserText)) return { reason: 'user_doubt' };
  return false;
}

/* ============ 自我洞察：手动触发（用户主动问"你用了这么久…有啥发现吗"） ============ */
function manualReveal(shadowState) {
  if (!shadowState || shadowState.revealTriggered) return false;
  if (!shadowState.firstUsedAt) return false;
  return true; // 只要用过 + 没触发过，手动按钮都能点
}

/* ============ 相似度阶段文案（view 模式可选用，不显示具体数字） ============ */
function affinityStageText(affinity) {
  if (affinity >= SHADOW_AFFINITY.HI_THRESHOLD) return '影子今天还在观察 TA 的影子';
  if (affinity >= SHADOW_AFFINITY.LOW_THRESHOLD) return '影子越来越安静';
  return '影子已经脱去了 TA 的影子';
}

module.exports = {
  SHADOW_MAX_DAY,
  SHADOW_MS,
  SHADOW_AFFINITY,
  REVEAL_TRIGGERS,
  shadowReply,
  pickUnused,
  analyzeChat,
  profileSummary,
  computeAffinity,
  detectDeclaration,
  detectDoubt,
  DOUBT_KEYS,
  shouldReveal,
  manualReveal,
  affinityStageText,
  fillTemplate,
  pickTier
};
