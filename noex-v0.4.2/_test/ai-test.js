/* _test/ai-test.js — AI 智能体接入专项测试 v0.9.0
 *
 * 覆盖：
 *   1. 出厂默认不联网（provider='off'），保证没配置时行为与旧版完全一致
 *   2. 输出清洗（剥前缀 / 剥引号 / 截断 / 违规内容拦截）
 *   3. 影子语言指纹（句长、emoji、语气词、口头禅、句末标点、称呼、样本）
 *   4. 提示词拼装（占位符全部替换、真实原话样本进 prompt）
 *   5. cloud / https 两种后端的成功与失败路径
 *   6. 危机词绝不送进大模型
 */

const path = require('path');
const ROOT = path.resolve(__dirname, '..');

let pass = 0, fail = 0;
function check(name, cond, extra) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (extra ? '  → ' + String(extra).slice(0, 160) : '')); }
}
function section(t) { console.log('\n-- ' + t + ' --'); }

/* ── 极简 wx 桩 ────────────────────────────── */
const wxLog = [];
let cloudResult = null;   // {ok, text} | {ok:false, error}
let cloudShouldFail = false;
let httpResult = null;
let httpShouldFail = false;
let cloudInitCalled = 0;

global.wx = {
  cloud: {
    init: () => { cloudInitCalled++; },
    callFunction: (o) => {
      wxLog.push(['cloud', o.name, JSON.stringify(o.data).slice(0, 60)]);
      if (cloudShouldFail) { o.fail && o.fail({ errMsg: 'mock fail' }); return; }
      o.success && o.success({ result: cloudResult });
    }
  },
  request: (o) => {
    wxLog.push(['https', o.url]);
    if (httpShouldFail) { o.fail && o.fail({ errMsg: 'mock fail' }); return; }
    o.success && o.success({ data: httpResult });
  },
  getSystemInfoSync: () => ({ windowHeight: 600 }),
  showToast: () => {}
};
global.getApp = () => ({ globalData: {} });

const cfg = require(path.join(ROOT, 'utils/ai-config.js'));
const ai = require(path.join(ROOT, 'utils/ai.js'));
const vp = require(path.join(ROOT, 'utils/voiceprint.js'));
const guardian = require(path.join(ROOT, 'utils/guardian.js'));

/* 恢复出厂设置，避免测试之间互相污染 */
function resetCfg() {
  cfg.provider = 'off';
  cfg.timeout = 15000;
  cfg.cloud.env = '';
  cfg.cloud.fn = 'noex-ai';
  cfg.https.url = '';
  cfg.https.key = '';
  cfg.https.model = '';
  cloudResult = null;
  cloudShouldFail = false;
  httpResult = null;
  httpShouldFail = false;
  wxLog.length = 0;
}

/* ════════════════════════════════════════════
   1. 出厂默认：不联网
   ════════════════════════════════════════════ */
section('1. 出厂默认（provider=off）');
{
  resetCfg();
  check('默认 provider 是 off', cfg.provider === 'off', cfg.provider);
  check('mode() 返回 off', ai.mode() === 'off');
  check('isEnabled() 为 false', ai.isEnabled() === false);

  let r1 = 'unset', r2 = 'unset';
  ai.chat({ text: '我想他了', persona: 'warm', history: [] }, (e, t) => { r1 = t; });
  ai.shadowChat({ text: '在吗', profile: {}, affinity: 80, history: [] }, (e, t) => { r2 = t; });
  check('off 模式 chat 直接回 null（不阻塞）', r1 === null, r1);
  check('off 模式 shadowChat 直接回 null', r2 === null, r2);
  check('off 模式完全没有发起任何请求', wxLog.length === 0, JSON.stringify(wxLog));

  /* 非法值也当 off，绝不因为配置写错就悄悄联网 */
  cfg.provider = 'weird-value';
  check('非法 provider 也当 off', ai.mode() === 'off');
  resetCfg();
}

/* ════════════════════════════════════════════
   2. 输出清洗
   ════════════════════════════════════════════ */
section('2. 输出清洗 clean()');
{
  const c = ai._internal.clean;
  check('剥掉「小白：」前缀', c('小白：我在呢') === '我在呢', c('小白：我在呢'));
  check('剥掉「TA：」前缀', c('TA：嗯') === '嗯', c('TA：嗯'));
  check('剥掉带引号的前缀', c('"影子：嗯"') === '嗯', c('"影子：嗯"'));
  check('去掉整段外层引号', c('"我在听"') === '我在听', c('"我在听"'));
  check('去掉整段外层「」', c('「我在听」') === '我在听', c('「我在听」'));
  check('压缩多余空白', c('我在   听') === '我在 听', c('我在   听'));
  check('空输入返回空', c('') === '' && c(null) === '');
  const long = '一'.repeat(300);
  check('超长被截断到 <= 90', c(long, 90).length <= 90, c(long, 90).length);
  check('截断不会返回空', c(long, 90).length > 0);

  const b = ai._internal.isBanned;
  check('拦截「作为AI」', b('作为AI，我建议你') === true);
  check('拦截「人工智能」', b('我是一个人工智能助手') === true);
  check('拦截「语言模型」', b('作为语言模型我不能') === true);
  check('正常句子不拦截', b('嗯，我在听。') === false);
  check('空内容视为违规', b('') === true);
}

/* ════════════════════════════════════════════
   3. 危机词绝不送进大模型
   ════════════════════════════════════════════ */
section('3. 危机词本地拦截');
{
  resetCfg();
  cfg.provider = 'cloud';
  cfg.cloud.env = 'test-env';
  let out = 'unset';
  ai.chat({ text: '我不想活了', persona: 'warm', history: [] }, (e, t) => { out = t; });
  check('危机句不调 AI（返回 null）', out === null, out);
  check('危机句没有发起云调用', wxLog.length === 0, JSON.stringify(wxLog));

  let out2 = 'unset';
  ai.shadowChat({ text: '想自杀', profile: {}, affinity: 80, history: [] }, (e, t) => { out2 = t; });
  check('影子危机句也不调 AI', out2 === null && wxLog.length === 0);
  resetCfg();
}

/* ════════════════════════════════════════════
   4. 云函数路径
   ════════════════════════════════════════════ */
section('4. cloud 模式');
{
  resetCfg();
  cfg.provider = 'cloud';
  cfg.cloud.env = 'test-env';

  cloudResult = { ok: true, text: '小白：嗯，我听到了。' };
  let out = 'unset';
  ai.chat({ text: '我今天路过以前那家店了', persona: 'warm', history: [] }, (e, t) => { out = t; });
  check('云函数成功 → 返回清洗后的文本', out === '嗯，我听到了。', out);
  check('调用了名为 noex-ai 的云函数', wxLog.length === 1 && wxLog[0][1] === 'noex-ai', JSON.stringify(wxLog));
  check('云开发被初始化', cloudInitCalled > 0);

  /* 云函数返回错误 */
  cloudResult = { ok: false, error: 'NOEX_AI_KEY 未配置' };
  let err1 = null, out1 = 'unset';
  ai.chat({ text: '你好', persona: 'warm', history: [] }, (e, t) => { err1 = e; out1 = t; });
  check('云函数报错 → 返回 null（交给本地兜底）', out1 === null, out1);
  check('云函数报错 → 有 error', err1 && err1.message);

  /* 调用失败（网络 / 未开通云开发） */
  cloudShouldFail = true;
  let err2 = null, out2 = 'unset';
  ai.chat({ text: '你好', persona: 'warm', history: [] }, (e, t) => { err2 = e; out2 = t; });
  check('callFunction fail → 返回 null', out2 === null);
  check('callFunction fail → 有 error', !!err2);

  /* 返回违规内容 → 不采用 */
  cloudShouldFail = false;
  cloudResult = { ok: true, text: '作为一个人工智能助手，我不能给你建议' };
  let out3 = 'unset';
  ai.chat({ text: '你好', persona: 'warm', history: [] }, (e, t) => { out3 = t; });
  check('返回违规内容 → 丢弃', out3 === null, out3);

  /* 超时 */
  cfg.timeout = 40;
  cloudResult = null;   // 不回调，模拟卡住
  const t0 = Date.now();
  let done4 = false;
  ai.chat({ text: '你好', persona: 'warm', history: [] }, () => { done4 = true; });
  setTimeout(() => {
    check('超时后仍然会回调（不会永久挂起）', done4 === true);
    check('超时耗时接近设定值', Date.now() - t0 >= 35, Date.now() - t0);
    step5();
  }, 300);
}

/* ════════════════════════════════════════════
   5. https 直连路径
   ════════════════════════════════════════════ */
function step5() {
  section('5. https 模式');
  resetCfg();
  cfg.provider = 'https';

  /* 没配 url/key → 直接失败，不发起请求 */
  let out0 = 'unset';
  ai.chat({ text: '你好', persona: 'warm', history: [] }, (e, t) => { out0 = t; });
  check('未配置时不发起请求', out0 === null && wxLog.length === 0);

  cfg.https.url = 'https://api.example.com/chat/completions';
  cfg.https.key = 'sk-test';
  cfg.https.model = 'test-model';

  httpResult = { choices: [{ message: { content: '在呢，说吧。' } }] };
  let out = 'unset';
  ai.chat({ text: '在吗', persona: 'sharp', history: [] }, (e, t) => { out = t; });
  check('https 成功 → 返回文本', out === '在呢，说吧。', out);
  check('https 请求已发出', wxLog.length === 1 && wxLog[0][0] === 'https');

  httpShouldFail = true;
  let out2 = 'unset';
  ai.chat({ text: '你好', persona: 'warm', history: [] }, (e, t) => { out2 = t; });
  check('https 失败 → 返回 null', out2 === null);
  resetCfg();
  step6();
}

/* ════════════════════════════════════════════
   6. 提示词拼装
   ════════════════════════════════════════════ */
function step6() {
  section('6. 提示词拼装');
  {
    const msgs = ai._internal.buildXiaobaiMessages({
      text: '我今天路过以前那家咖啡店了',
      persona: 'sharp',
      history: [{ role: 'me', text: 'hi' }, { role: 'ai', text: '嗯' }],
      day: 5
    });
    const sys = msgs[0].content;
    check('system 含人格描述', sys.indexOf('毒舌') > -1);
    check('system 无未替换占位符', sys.indexOf('{PERSONA}') === -1);
    check('system 含断联天数', msgs[1].content.indexOf('第 5 天') > -1, msgs[1].content);
    check('历史被带上', msgs.length === 5, msgs.length);
    check('最后一条是用户消息', msgs[msgs.length - 1].role === 'user');
    check('历史 role 映射正确', msgs[2].role === 'user' && msgs[3].role === 'assistant');
    check('system 要求紧扣用户的话', sys.indexOf('答非所问') > -1);
  }

  {
    const voice = vp.buildVoicePrint([
      '哈哈哈哈行吧', '嗯那就这样', '你先忙～', '好嘞', '宝 我到了', '嗯嗯'
    ]);
    const msgs = ai._internal.buildShadowMessages({
      text: '在吗', profile: { voice: voice }, affinity: 75, history: []
    });
    const sys = msgs[0].content;
    check('影子 system 无 {PROFILE} 残留', sys.indexOf('{PROFILE}') === -1);
    check('影子 system 无 {SAMPLES} 残留', sys.indexOf('{SAMPLES}') === -1);
    check('影子 system 无 {AFFINITY} 残留', sys.indexOf('{AFFINITY}') === -1);
    check('影子 system 含真实原话样本', sys.indexOf('TA 真说过的话') > -1);
    check('样本里能找到原始句子', sys.indexOf('哈哈哈哈行吧') > -1);
    check('影子 system 含关系温度', sys.indexOf('当前关系温度：75') > -1, sys.slice(0, 0) || '');
    check('影子 system 含阶段说明', sys.indexOf('高仿期') > -1);
    check('影子 prompt 要求学味儿不照搬', sys.indexOf('别照抄') > -1);
  }

  /* 无指纹时的老画像兜底 */
  {
    const msgs = ai._internal.buildShadowMessages({
      text: '在吗', profile: { avgLen: 6, emojiLove: true, top: ['哈哈'], qRate: 0.4 }, affinity: 80, history: []
    });
    const sys = msgs[0].content;
    check('老画像也能拼出 prompt', sys.indexOf('{PROFILE}') === -1 && sys.length > 100);
    check('老画像提到口头禅', sys.indexOf('哈哈') > -1);
    check('老画像无样本块也不报错', sys.indexOf('{SAMPLES}') === -1);
  }
  step7();
}

/* ════════════════════════════════════════════
   7. 影子语言指纹
   ════════════════════════════════════════════ */
function step7() {
  section('7. 影子语言指纹 voiceprint');
  {
    const short = vp.buildVoicePrint(['嗯', '好', '行', '哦', '嗯嗯', '哈哈']);
    check('短句样本 → 平均句长短', short.avgLen < 8, short.avgLen);
    check('短句样本 → shortRate 高', short.shortRate >= 0.5, short.shortRate);

    const long = vp.buildVoicePrint([
      '我今天跟你说的那个事情我觉得我们还是需要考虑一下的',
      '其实我一直在想我们之间到底是什么原因走到了今天这一步'
    ]);
    check('长句样本 → 平均句长长', long.avgLen > 20, long.avgLen);

    const emo = vp.buildVoicePrint(['好呀😊', '行吧🥲', '嗯嗯😊']);
    check('emoji 被识别', emo.emojiTop.length > 0, JSON.stringify(emo.emojiTop));
    check('emojiLove 为真', emo.emojiLove === true);

    const noEmo = vp.buildVoicePrint(['好的', '知道了', '嗯']);
    check('无 emoji 样本 → emojiTop 为空', noEmo.emojiTop.length === 0);

    const tone = vp.buildVoicePrint(['好呀', '行吧', '是哦', '来啦']);
    check('语气词被提取', tone.toneTop.length > 0, JSON.stringify(tone.toneTop));

    const q = vp.buildVoicePrint(['你去哪了？', '为什么呀？', '真的吗？']);
    check('问句率高', q.qRate >= 0.9, q.qRate);

    const addr = vp.buildVoicePrint(['宝宝我在忙', '宝宝晚点聊']);
    check('称呼被识别', addr.address === '宝宝', addr.address);

    const e = vp.buildVoicePrint(['好的。', '知道了。', '行。']);
    check('句末句号被统计', e.endPunct.period > 0.8, e.endPunct.period);

    const empty = vp.buildVoicePrint([]);
    check('空输入返回空指纹不报错', empty.count === 0 && empty.samples.length === 0);

    /* 噪声过滤 */
    check('[图片] 被过滤', vp.isNoise('[图片]') === true);
    check('[语音] 被过滤', vp.isNoise('[语音]') === true);
    check('撤回消息被过滤', vp.isNoise('你撤回了一条消息') === true);
    check('正常句子不被过滤', vp.isNoise('我今天很累') === false);

    /* 样本挑选 */
    const samples = vp.pickSamples(['哈哈哈', '哈哈哈啊', '我今天加班到十点', '好累啊', '嗯'], 3);
    check('样本数量受限', samples.length <= 3, samples.length);
    check('样本去重（不会全是哈哈哈）', samples.filter((s) => s.indexOf('哈哈哈') === 0).length <= 1,
      JSON.stringify(samples));

    /* describe 输出 */
    const d = vp.describe(short);
    check('describe 有内容', d.length > 20);
    check('describe 提到句短', d.indexOf('短') > -1, d);
    check('空指纹 describe 有兜底', vp.describe(empty).indexOf('没有足够') > -1);
    check('summary 有内容', vp.summary(tone).length > 0);
    check('空指纹 summary 返回空串', vp.summary(empty) === '');
  }

  /* 按发言人分离 —— 这是"模仿得像"的前提 */
  {
    const parsed = {
      byName: {
        'TA': ['嗯', '哈哈哈哈行吧', '你先忙～'],
        '我': ['我今天好想你啊，你在干嘛呢，怎么不回我消息', '我真的很难过']
      },
      speakers: ['我', 'TA'],
      cleaned: ''
    };
    const lines = vp.pickSpeakerLines(parsed, 'TA');
    check('只取 TA 的话', lines.length === 3 && lines.indexOf('你先忙～') > -1, JSON.stringify(lines));
    check('不含用户自己说的话', lines.every((l) => l.indexOf('好想你') === -1));
    const mine = vp.pickSpeakerLines(parsed, '我');
    check('取另一个人也正常', mine.length === 2);
    const print = vp.buildVoicePrint(lines);
    check('TA 的画像句长短', print.avgLen < 8, print.avgLen);
  }
  step8();
}

/* ════════════════════════════════════════════
   8. 页面降级：AI 不可用时必须用本地回复
   ════════════════════════════════════════════ */
function step8() {
  section('8. 页面降级链路');
  {
    resetCfg();
    const fs = require('fs');
    const xb = fs.readFileSync(path.join(ROOT, 'pages/xiaobai/xiaobai.js'), 'utf8');
    const yz = fs.readFileSync(path.join(ROOT, 'pages/yingzi/yingzi.js'), 'utf8');

    check('xiaobai 引入了 ai 模块', /require\(['"][^'"]*utils\/ai\.js['"]\)/.test(xb));
    check('xiaobai 先算本地兜底再调 AI',
      /localReply\s*=\s*guardian\.guardianReply/.test(xb) && /ai\.chat\(/.test(xb));
    check('xiaobai 用 (aiText || localReply.text) 兜底', /aiText \|\| localReply\.text/.test(xb));
    check('xiaobai 危机不经过 AI', /localReply\.crisis[\s\S]{0,200}return;/.test(xb));

    check('yingzi 引入了 ai 模块', /require\(['"][^'"]*utils\/ai\.js['"]\)/.test(yz));
    check('yingzi 引入了 voiceprint', /require\(['"][^'"]*utils\/voiceprint\.js['"]\)/.test(yz));
    check('yingzi 用 (aiText || localReply) 兜底', /aiText \|\| localReply/.test(yz));
    check('yingzi 画像先按发言人分离', /pickSpeakerLines/.test(yz));
    check('yingzi 画像含 voice 指纹', /voice\s*=\s*vp/.test(yz) || /legacy\.voice = vp/.test(yz));

    /* 影子聊天区布局（本轮修的 UI） */
    const yzw = fs.readFileSync(path.join(ROOT, 'pages/yingzi/yingzi.wxml'), 'utf8');
    const yzs = fs.readFileSync(path.join(ROOT, 'pages/yingzi/yingzi.wxss'), 'utf8');
    check('影子输入框下方不再可滚（chat 模式锁高）', /yz-chat/.test(yzw) && /yz-chat/.test(yzs));
    check('影子聊天区有 min-height:0', /min-height:\s*0/.test(yzs));
    check('影子发送按钮与小白同名 send-btn', /class="send-btn"/.test(yzw));
    check('影子发送按钮重置了 ::after', /send-btn::after/.test(yzs));
    check('影子发送按钮是 64rpx 正圆',
      /width:\s*64rpx/.test(yzs) && /height:\s*64rpx/.test(yzs) && /border-radius:\s*50%/.test(yzs));
    check('影子不再调用 wx.pageScrollTo（对 scroll-view 无效）', !/wx\.pageScrollTo\s*\(/.test(yz));
    check('影子用 scroll-into-view 锚点', /scroll-into-view/.test(yzw));

    /* 云函数 */
    const fn = path.join(ROOT, 'cloudfunctions', 'noex-ai', 'index.js');
    check('云函数已存在', fs.existsSync(fn));
    if (fs.existsSync(fn)) {
      const src = fs.readFileSync(fn, 'utf8');
      check('云函数零第三方依赖', !/require\(['"](?!https)/.test(src.replace(/require\('https'\)/g, '')));
      check('云函数从环境变量读 Key', /process\.env\.NOEX_AI_KEY/.test(src));
      check('云函数有危机兜底', /crisis/.test(src));
      check('云函数异常也返回结构化结果', /ok:\s*false/.test(src));
    }
  }

  resetCfg();
  console.log('\n========== ' + pass + ' passed, ' + fail + ' failed ==========');
  process.exit(fail > 0 ? 1 : 0);
}
