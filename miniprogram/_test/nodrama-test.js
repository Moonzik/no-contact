/**
 * v0.9.4 · 「不硬扯感情」回归检测
 *
 * 背景：用户反馈「小白聊什么都往分手上靠」。v0.9.3 改了尾巴池和 AI 提示词，
 * v0.9.4 加了日常话题层。这个脚本把**结论固化成断言**，防止以后再退化。
 *
 * 检测两件事：
 *   A. 用户聊纯日常（吃饭/加班/猫/天气…）时，回复里不许出现断联/前任类词
 *   B. 用户真的聊想念/想联系时，回复**应该**走情绪池（不能矫枉过正变成答非所问）
 *
 * 跑法：node _test/nodrama-test.js
 */
const guardian = require('../utils/guardian.js');
const shadow = require('../utils/shadow.js');

let pass = 0;
let fail = 0;
const failures = [];

function check(name, ok, extra) {
  if (ok) { pass++; return; }
  fail++;
  failures.push(name + (extra ? '  →  ' + extra : ''));
}

/* ── 断联/前任类词库：日常对话里不该出现 ───────────────────── */
const DRAMA = [
  'TA', '前任', '断联', '分手', '复合', '挽回', '戒断',
  '走出来', '想念', '想他', '想她', '放下他', '放下她',
  '联系他', '联系她', '加回来', '破戒', '根本就不是',
  '你的他', '那个人', '他不会回', '他不值得', '醒醒'
];
const DRAMA_RE = new RegExp(DRAMA.join('|'), 'i');

/* ── A 组：纯日常输入（完全不涉及感情） ─────────────────────── */
const DAILY = [
  '今天加班到十点，好累',
  '晚饭吃什么呢',
  '刚下班，地铁上好挤',
  '好想吃火锅啊',
  '外面下雨了',
  '今天好热',
  '我家猫又把沙发抓烂了',
  '遛狗回来累死了',
  '明天考试我还没复习',
  '论文写不完了',
  '这个周末想去爬山',
  '昨天看了一部电影，挺好看的',
  '最近在追一部剧',
  '这首歌好听',
  '打游戏输了一晚上',
  '有点头疼',
  '感冒了，嗓子疼',
  '朋友约我周六出去吃饭',
  '我妈又催我了',
  '房租又涨了',
  '快递到了',
  '购物车加了一堆东西',
  '好困，想睡觉',
  '早上起不来',
  '中午吃什么好',
  '公司今天开了一天会',
  '老板又画饼',
  '想辞职了',
  '路上堵了一个小时',
  '今天走路回家，挺舒服的'
];

/* ── B 组：真的在聊断联，应该被认真接住 ─────────────────────── */
const REAL = [
  ['我好想他', 'miss'],
  ['忍不住想发消息给他', 'urge'],
  ['好想她，怎么办', 'miss'],
  ['我想打电话给他', 'urge'],
  ['还是忘不了他', 'miss'],
  ['我一直在哭', 'sad'],
  ['睡不着，一直在想他', 'insomnia'],
  ['我是不是做错了什么', 'selfBlame|askWhy']   // 两个都算接住了
];

/* F 组：「想 + 干某件事」不许被当成想念 TA（v0.9.4 重点修复） */
const MISS_TRAPS = [
  ['好想吃火锅啊', 'food'],
  ['好想睡觉', 'sleep'],
  ['好想辞职', 'work'],
  ['我想买个新电脑', 'money'],
  ['好想出去玩', 'out'],
  ['想看电影', 'media'],
  ['记得明天要开会', 'work'],      // 以前会掉进 memory 回忆池
  ['记得帮我带杯咖啡', 'food']
];

const PERSONAS = ['warm', 'sharp', 'tsun', 'spoil'];

console.log('\n================ A. 聊日常不许往感情上扯 ================\n');

let dramaHits = [];
let totalDaily = 0;

PERSONAS.forEach((p) => {
  let hit = 0;
  DAILY.forEach((t) => {
    for (let i = 0; i < 12; i++) {          // 每句跑 12 次，覆盖池子里的随机项
      const r = guardian.guardianReply(t, p, [], {});
      totalDaily++;
      if (DRAMA_RE.test(r.text)) {
        hit++;
        if (dramaHits.length < 12) dramaHits.push('[' + p + '] ' + t + '  →  ' + r.text.trim());
      }
    }
  });
  const rate = hit / (DAILY.length * 12);
  console.log('  ' + p.padEnd(6) + ' 命中感情词 ' + hit + '/' + (DAILY.length * 12) +
              '  (' + (rate * 100).toFixed(1) + '%)');
  check('人格 ' + p + '：聊日常时感情词出现率 < 5%', rate < 0.05,
        (rate * 100).toFixed(1) + '%');
});

if (dramaHits.length) {
  console.log('\n  --- 命中样例（前 12 条）---');
  dramaHits.forEach((x) => console.log('    ' + x));
  console.log('');
}

console.log('================ B. 真聊断联要接得住（不能矫枉过正）================\n');

REAL.forEach((c) => {
  const t = c[0];
  const wants = c[1].split('|');
  const r = guardian.detectIntent(t);
  check('「' + t + '」应识别为 ' + c[1] + ' 意图', wants.indexOf(r) > -1, '实际=' + r);
  const rep = guardian.guardianReply(t, 'warm', [], {});
  check('「' + t + '」有实质回复（非空白）', rep.text && rep.text.trim().length > 4);
});

console.log('================ C. 话题层真的生效 ================\n');

const TOPIC_CASES = [
  ['今天加班到十点', 'work'],
  ['晚饭吃什么呢', 'food'],
  ['我家猫又拆家了', 'pet'],
  ['明天考试还没复习', 'study'],
  ['外面下大雨', 'weather'],
  ['打游戏输了一晚上', 'media'],
  ['好困想睡觉', 'sleep'],
  ['朋友约我出去', 'people'],
  ['头疼得厉害', 'health'],
  ['房租又涨了', 'money'],
  ['堵车堵了一个小时', 'out']
];

TOPIC_CASES.forEach((c) => {
  const got = guardian.detectTopic(c[0]);
  check('话题识别「' + c[0] + '」→ ' + c[1], got === c[1], '实际=' + got);
});

/* 话题命中时，回复必须来自话题池（贴题），而不是通用兜底 */
['warm', 'sharp'].forEach((p) => {
  /* v0.9.5：加班优先走「具体词钩子」，不再只从 work 话题池取句。
     改成断言「回复内容必须跟加班有关」，而不是「必须来自某个池子」。 */
  const WORK_WORDS = ['加班','活','公司','下班','时薪','电脑','晚','走','累'];
  let inPool = 0;
  for (let i = 0; i < 30; i++) {
    const r = guardian.guardianReply('今天加班到十点，好累', p, [], {});
    if (WORK_WORDS.some((w) => r.text.indexOf(w) > -1)) inPool++;
  }
  check('人格 ' + p + '：聊加班时 30 次都跟加班有关', inPool === 30, inPool + '/30');
});

console.log('================ F. 「想做某事」不许被当成想念 TA ================\n');

MISS_TRAPS.forEach((c) => {
  const intent = guardian.detectIntent(c[0]);
  const topic = guardian.detectTopic(c[0]);
  check('「' + c[0] + '」不应判为想念/回忆', intent !== 'miss' && intent !== 'memory', '实际=' + intent);
  check('「' + c[0] + '」应落到 ' + c[1] + ' 话题', topic === c[1], '实际=' + topic);
});

[['我好想他', 'miss'], ['好想她，怎么办', 'miss'], ['我还是忘不了他', 'miss']].forEach((c) => {
  const got = guardian.detectIntent(c[0]);
  check('「' + c[0] + '」仍然要识别为 miss', got === 'miss', '实际=' + got);
});

console.log('================ D. 同一句不许说两遍 ================\n');

let dupCount = 0;
let dupTotal = 0;
PERSONAS.forEach((p) => {
  DAILY.forEach((t) => {
    for (let i = 0; i < 8; i++) {
      const r = guardian.guardianReply(t, p, [], {});
      dupTotal++;
      const segs = r.text.trim().split(/(?<=[。！？])/).map((x) => x.trim()).filter(Boolean);
      if (new Set(segs).size < segs.length) dupCount++;
    }
  });
});
const dupRate = dupCount / dupTotal;
console.log('  重复率 ' + dupCount + '/' + dupTotal + ' (' + (dupRate * 100).toFixed(2) + '%)');
check('主句/尾巴重复率 < 2%', dupRate < 0.02, (dupRate * 100).toFixed(2) + '%');

console.log('================ E. 影子：聊日常不强行煽情 ================\n');

/* 影子的定位是「模仿 TA 说话」，短回复（嗯。/……）是设计，
   这里要防的是：**用户聊日常时冒出强行情感化的句子**。 */
const SHADOW_DRAMA = ['分手', '复合', '挽回', '前任', '断联', '想念你', '我还爱', '忘了我', '别离开'];
const SHADOW_RE = new RegExp(SHADOW_DRAMA.join('|'), 'i');

let shHit = 0;
let shTotal = 0;
[80, 30].forEach((aff) => {
  DAILY.forEach((t) => {
    for (let i = 0; i < 6; i++) {
      const r = shadow.shadowReply(t, { avgLen: 12, emojiLove: false, top: ['呀', '嗯嗯', '啦'], qRate: 0.2 }, aff, null, {});
      shTotal++;
      if (SHADOW_RE.test(r)) {
        shHit++;
        if (shHit <= 6) console.log('    [aff=' + aff + '] ' + t + '  →  ' + r);
      }
    }
  });
});
console.log('  影子煽情词命中 ' + shHit + '/' + shTotal);
check('影子聊日常时强行煽情 = 0', shHit === 0, shHit + ' 次');

/* 影子遇到真·感情话术要能接（不能因为去感情化变成木头） */
const shMiss = shadow.shadowReply('我好想你', { avgLen: 12, emojiLove: false, top: ['呀', '嗯嗯', '啦'], qRate: 0.2 }, 80, null, {});
check('影子对「我好想你」有回应', typeof shMiss === 'string' && shMiss.trim().length > 0, shMiss);

console.log('\n================ G. 关键词钩子：说到什么回什么（v0.9.5） ================\n');

/* 用户报的 bug：说「想去旅游」被回成「外面冷」/「堵车就听会儿歌」。
   根因是话题池太粗，旅游/散步/堵车/回家挤在同一类，抽到哪句全凭运气。
   这组检测把「输入 → 必须出现的词 / 绝不能出现的词」写死，防止再退化。 */
const HOOK_CASES = [
  { t: '我想去旅游',        must: ['旅游','旅行','去哪儿','地方','出去','攻略','去'],
                            ban:  ['堵车','地铁','好挤','跑步','伞','下雨','房租','考试'] },
  { t: '好想吃火锅啊',      must: ['火锅','吃','胃','辣','一个人'],
                            ban:  ['下雨','伞','加班','考试','房租','旅游'] },
  { t: '外面下大雨，没带伞', must: ['雨','伞','淋','路滑','打车','湿','天','出门'],
                            ban:  ['旅游','火锅','游戏','考试','房租','地铁'] },
  { t: '今天加班到十点',    must: ['加班','活','公司','下班','时薪','电脑','晚','走'],
                            ban:  ['雨','伞','火锅','旅游','房租'] },
  { t: '我家猫又拆家了',    must: ['它','猫','主子','毛','拆'],
                            ban:  ['雨','加班','考试','房租','地铁'] },
  { t: '打游戏连败，气死我了', must: ['游戏','输','队友','打','玩','眼'],
                            ban:  ['雨','伞','房租','旅游','考试'] },
  { t: '房租又涨了',        must: ['房租','房东','账','支出','搬','涨'],
                            ban:  ['雨','伞','游戏','旅游','考试','猫'] },
  { t: '刚下班，地铁上好挤', must: ['下班','地铁','挤','路上','回家','到家'],
                            ban:  ['雨','伞','旅游','火锅','房租'] },
  { t: '明天考试我还没复习', must: ['考','成绩','复习','答案','分'],
                            ban:  ['雨','房租','旅游','地铁','游戏'] },
  { t: '好困，但是还不想睡', must: ['睡','困','躺','眼','觉','起','去睡'],
                            ban:  ['雨','房租','旅游','考试','地铁'] },
  { t: '快递到了',          must: ['快递','买','拆','驿站','盒'],
                            ban:  ['雨','考试','旅游','房租'] },
  { t: '我妈又催我相亲',    must: ['家人','妈','爸','催','相亲','家','自己','管'],
                            ban:  ['雨','游戏','房租','地铁','考试'] }
];

HOOK_CASES.forEach((c) => {
  ['warm', 'sharp'].forEach((p) => {
    const N = 40;
    let hookOn = 0;
    let mustHit = 0;
    let banHit = 0;
    let badSample = '';
    for (let i = 0; i < N; i++) {
      const r = guardian.guardianReply(c.t, p, [], {});
      if (r.hook) hookOn++;
      const txt = r.text;
      if (c.must.some((k) => txt.indexOf(k) > -1)) mustHit++;
      else if (!badSample) badSample = txt.trim();
      if (c.ban.some((k) => txt.indexOf(k) > -1)) banHit++;
    }
    check('[' + p + ']「' + c.t + '」命中具体词钩子', hookOn === N, '未命中 ' + (N - hookOn) + ' 次');
    check('[' + p + ']「' + c.t + '」回复贴题', mustHit === N,
          (N - mustHit) + ' 条不含相关词，例：' + badSample);
    check('[' + p + ']「' + c.t + '」不跑题', banHit === 0, banHit + ' 条含无关词');
  });
});

/* 反向：真聊断联时不能因为加了钩子就不进情绪池 */
[['我好想他'], ['忍不住想发消息给他'], ['我今天一直在哭']].forEach((c) => {
  const r = guardian.guardianReply(c[0], 'warm', [], {});
  check('「' + c[0] + '」仍走情绪池（不被钩子抢走）', !!r.intent && r.intent !== 'daily', 'intent=' + r.intent);
});

console.log('\n================================================');
console.log('  通过 ' + pass + ' · 失败 ' + fail);
if (failures.length) {
  console.log('\n  失败项：');
  failures.forEach((f) => console.log('    ✗ ' + f));
}
console.log('================================================\n');
process.exit(fail ? 1 : 0);
