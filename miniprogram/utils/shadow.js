// utils/shadow.js — 影子：基于聊天记录生成的语气画像 + 短句回复

const SHADOW_MAX_DAY = 3;
const SHADOW_MS = 20 * 60 * 1000; // 单次最长 20 分钟

function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
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

const SHADOW_POOL = {
  miss:  ['嗯。','我知道。','……嗯。','这段时间，你还好吗。'],
  ask:   ['我不知道怎么回答这个。','……这个问题，我想放一放。','你希望我怎么说呢。'],
  angry: ['对不起。','嗯，你说，我听着。','……我没资格解释。'],
  bye:   ['嗯，去吧。','照顾好自己。','……嗯。再见。'],
  greet: ['嗯。','在。','……是你啊。'],
  fallback: ['嗯。','……','在听。','你说。','……']
};

/**
 * 影子回复
 * @param {string} text
 * @param {object} profile 画像 {avgLen, emojiLove, top, qRate}
 */
function shadowReply(text, profile) {
  const keys = shadowIntents();
  for (const k in keys) {
    for (let i = 0; i < keys[k].length; i++) {
      if (text.indexOf(keys[k][i]) > -1) return pick(SHADOW_POOL[k]);
    }
  }
  let out = pick(SHADOW_POOL.fallback);
  if (profile && profile.emojiLove && Math.random() < 0.4) {
    out += pick(['🥲','…','。']);
  }
  if (profile && profile.avgLen < 10 && Math.random() < 0.5) {
    out = out.split('。')[0] + '。';
  }
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

module.exports = {
  SHADOW_MAX_DAY,
  SHADOW_MS,
  shadowReply,
  analyzeChat,
  profileSummary
};
