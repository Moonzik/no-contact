/* _test/vision-test.js — 图片导入（聊天截图 → 文字）+ 导入入口（v0.9.15）
 *
 * 查什么：
 *   1. 云函数视觉分支：入参校验、模型名可配、超时长、错误码、零第三方依赖
 *   2. 提示词约束：**不许编造**、「说话人：内容」格式、对方/我、跳过系统文字
 *   3. 小程序侧 ocrImage：payload 结构、45 秒超时、失败分类、off 模式
 *   4. 转写结果清洗与合并：剥围栏/前言/时间行，且**绝不改写正文**
 *   5. 与影子解析器联动：清洗后必须能解析出说话人，且默认选中「对方」
 *   6. 隐私：截图用完立刻从云端删除、图片不落本地存储、文案有交代
 *   7. 导入入口：四条路都在，格式白名单与数量上限，文案不碰审核红线
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
let pass = 0, fail = 0;
const problems = [];
function check(name, cond, info) {
  if (cond) { pass++; }
  else {
    fail++;
    problems.push(name + (info === undefined ? '' : ' → ' + info));
    console.log('  ✗', name, info === undefined ? '' : info);
  }
}
function section(t) { console.log('\n-- ' + t + ' --'); }
function read(rel) { return fs.readFileSync(path.join(ROOT, rel), 'utf8'); }

/* ── wx 桩 ─────────────────────────────────── */
const wxLog = [];
let cloudResult = null;
let cloudShouldFail = false;
global.wx = {
  cloud: {
    init: () => {},
    callFunction: (o) => {
      wxLog.push(o.data);
      if (cloudShouldFail) { o.fail && o.fail({ errMsg: 'mock fail' }); return; }
      o.success && o.success({ result: cloudResult });
    }
  },
  request: () => {},
  showToast: () => {}
};
global.getApp = () => ({ globalData: {} });

const cfg = require(path.join(ROOT, 'utils/ai-config.js'));
const ai = require(path.join(ROOT, 'utils/ai.js'));
const wechat = require(path.join(ROOT, 'utils/wechat.js'));

function resetCfg() {
  cfg.provider = 'off';
  cfg.timeout = 15000;
  cfg.cloud.env = '';
  cfg.cloud.fn = 'noex-ai';
  cloudResult = null;
  cloudShouldFail = false;
  wxLog.length = 0;
}

/* ═══════════════ 1. 云函数视觉分支（源码契约） ═══════════════ */
section('1. 云函数视觉分支');
{
  const cf = read('cloudfunctions/noex-ai/index.js');
  check('有 action === \'vision\' 分支', /action\s*===\s*'vision'/.test(cf));
  check('视觉分支在危机词过滤之前（截图不该被文字危机词表拦掉）',
    cf.indexOf("action === 'vision'") < cf.indexOf('const danger ='),
    cf.indexOf("action === 'vision'") + ' vs ' + cf.indexOf('const danger ='));
  check('支持 NOEX_AI_VISION_MODEL 环境变量', /process\.env\.NOEX_AI_VISION_MODEL/.test(cf));
  check('视觉模型有默认值', /visionModel:\s*'[^']+'/.test(cf));
  check('文字模型可通过 NOEX_AI_MODEL 覆盖', /process\.env\.NOEX_AI_MODEL/.test(cf));
  check('post 支持自定义超时', /function post\(host, path, headers, body, timeoutMs\)/.test(cf));
  check('视觉调用超时 >= 45 秒', /,\s*45000\s*\)/.test(cf));
  check('imageUrl 必须是 https', /\^https:\\\/\\\//.test(cf));
  check('非 https 直接返回错误（不去请求）', /imageUrl 不合法/.test(cf));
  check('模型不认图时给出独立错误码', /not_vision_model/.test(cf));
  check('文字模型名失效时有兜底重试', /FALLBACK_MODEL/.test(cf));
  check('兜底不会用于图片（避免把图喂给纯文本模型）',
    !/FALLBACK_MODEL[^]*?image_url/.test(cf.split('callChat')[2] || ''));
  check('仍然零第三方依赖（不用 wx-server-sdk）', !/require\(['"]wx-server-sdk['"]\)/.test(cf));
  check('只 require https', (cf.match(/require\(/g) || []).length === 1);
  check('图片放在 user 消息里（system 里带图会 400）',
    /role:\s*'user'[\s\S]{0,120}image_url/.test(cf));
  check('image_url 结构正确', /image_url:\s*\{\s*url:\s*url\s*\}/.test(cf));
}

/* ═══════════════ 2. 提示词约束 ═══════════════ */
section('2. 转写提示词约束');
{
  const cf = read('cloudfunctions/noex-ai/index.js');
  const m = cf.match(/const VISION_SYSTEM = \[([\s\S]*?)\]\.join/);
  const sys = m ? m[1] : '';
  check('提示词存在', sys.length > 200, sys.length);
  check('第一条就是「不许编造」', /只转写图片里真实存在的文字/.test(sys));
  check('要求看不清就跳过，不许脑补', /看不清的字用/.test(sys) && /跳过/.test(sys));
  check('规定「说话人：内容」逐行格式', /说话人：内容/.test(sys));
  check('规定对方 / 我 的对应关系', /对方/.test(sys) && /我/.test(sys));
  check('能看到昵称时用真名', /昵称|备注/.test(sys));
  check('要求丢掉时间戳等系统文字', /时间戳/.test(sys));
  check('非文字消息给占位符', /\[图片\]/.test(sys) && /\[语音\]/.test(sys));
  check('禁止输出解释/标题/代码块', /不要输出任何解释/.test(sys));
  check('读不到内容时如实说', /没有识别到聊天内容/.test(sys));
  check('提示词温度低（转写要稳定）', /0\.1\s*,?\s*$|0\.1,/.test(cf) || /,\s*0\.1,\s*45000/.test(cf));
  /* 转写提示词也不该出现审核红线词 */
  ['咨询', '疗愈', '治愈', '抑郁', '心理治疗'].forEach((w) => {
    check('提示词不含红线词「' + w + '」', sys.indexOf(w) < 0);
  });
}

/* ═══════════════ 3. ocrImage ═══════════════ */
section('3. ocrImage');
{
  resetCfg();
  check('导出 ocrImage', typeof ai.ocrImage === 'function');
  check('导出 describeVisionErr', typeof ai.describeVisionErr === 'function');
  check('VISION_TIMEOUT = 45000', ai.VISION_TIMEOUT === 45000, String(ai.VISION_TIMEOUT));
  check('图片超时明显长于文字超时', ai.VISION_TIMEOUT > (cfg.timeout || 0));

  /* 非法链接：不该发起任何请求 */
  let e0 = null;
  ai.ocrImage('http://insecure/x.jpg', (e) => { e0 = e; });
  check('非 https → bad_url', e0 && e0.code === 'bad_url', e0 && e0.code);
  let e0b = null;
  ai.ocrImage('', (e) => { e0b = e; });
  check('空链接 → bad_url', e0b && e0b.code === 'bad_url');
  check('非法链接没有调用云函数', wxLog.length === 0);

  /* off 模式 */
  resetCfg();
  let e1 = null, t1 = 'unset';
  ai.ocrImage('https://x.tcb.qcloud.la/a.jpg', (e, t) => { e1 = e; t1 = t; });
  check('off 模式 → code=off', e1 && e1.code === 'off', e1 && e1.code);
  check('off 模式 → 无文本', t1 === null);

  /* cloud 成功：payload 结构 */
  resetCfg();
  cfg.provider = 'cloud';
  cfg.cloud.env = 'test-env';
  cloudResult = { ok: true, text: '对方: 在忙吗\n我: 没有' };
  let t2 = null, e2 = null;
  ai.ocrImage('https://x.tcb.qcloud.la/a.jpg', (e, t) => { e2 = e; t2 = t; });
  check('成功 → 拿到转写文本', typeof t2 === 'string' && t2.length > 0, t2);
  check('成功 → 无错误', e2 === null);
  const sent = wxLog[wxLog.length - 1] || {};
  check('payload 带 action=vision', sent.action === 'vision', JSON.stringify(sent.action));
  check('payload 带 imageUrl', sent.imageUrl === 'https://x.tcb.qcloud.la/a.jpg', sent.imageUrl);
  check('图片不塞 messages（走云函数侧拼装）', sent.messages === null || sent.messages === undefined);
  check('maxTokens 足够装下几十条对话', sent.maxTokens >= 1000, String(sent.maxTokens));

  /* 失败分类 */
  resetCfg();
  cfg.provider = 'cloud';
  cfg.cloud.env = 'test-env';
  cloudResult = { ok: false, error: 'This model does not support image', code: 'not_vision_model' };
  let e3 = null;
  ai.ocrImage('https://x.tcb.qcloud.la/a.jpg', (e) => { e3 = e; });
  check('模型不认图 → vision_model_bad', e3 && e3.code === 'vision_model_bad', e3 && e3.code);

  cloudResult = { ok: false, error: 'Authentication Fails, Your api key is invalid' };
  let e4 = null;
  ai.ocrImage('https://x.tcb.qcloud.la/a.jpg', (e) => { e4 = e; });
  check('Key 无效 → key_bad', e4 && e4.code === 'key_bad', e4 && e4.code);

  cloudResult = { ok: false, error: 'NOEX_AI_KEY 未配置。请在云函数环境变量里配置' };
  let e5 = null;
  ai.ocrImage('https://x.tcb.qcloud.la/a.jpg', (e) => { e5 = e; });
  check('Key 没配 → ai_key_missing', e5 && e5.code === 'ai_key_missing', e5 && e5.code);

  cloudResult = { ok: true, text: '   ' };
  let e6 = null;
  ai.ocrImage('https://x.tcb.qcloud.la/a.jpg', (e) => { e6 = e; });
  check('模型返回空白 → empty', e6 && e6.code === 'empty', e6 && e6.code);

  cloudShouldFail = true;
  let e7 = null;
  ai.ocrImage('https://x.tcb.qcloud.la/a.jpg', (e) => { e7 = e; });
  check('调不到云函数 → network', e7 && e7.code === 'network', e7 && e7.code);
}

/* ═══════════════ 4. 失败文案 ═══════════════ */
section('4. 失败文案要能落地');
{
  const codes = ['off', 'cloud_unavailable', 'not_deployed', 'env_bad', 'ai_key_missing',
    'key_bad', 'vision_model_bad', 'vision_failed', 'timeout', 'network', 'upload_failed',
    'bad_format', 'no_content', 'bad_url', 'empty'];
  codes.forEach((c) => {
    const t = ai.describeVisionErr({ code: c });
    check('code=' + c + ' 有中文说明', typeof t === 'string' && t.length >= 8, t);
  });
  check('未知 code 有兜底文案', ai.describeVisionErr({ code: 'whatever' }).length > 8);
  check('无 err 也能兜底', ai.describeVisionErr(null).length > 8);
  check('超时文案指向云函数超时设置', ai.describeVisionErr({ code: 'timeout' }).indexOf('60') > -1);
  check('模型不认图文案给出环境变量名',
    ai.describeVisionErr({ code: 'vision_model_bad' }).indexOf('NOEX_AI_VISION_MODEL') > -1);
}

/* ═══════════════ 5. 转写清洗 ═══════════════ */
section('5. 转写结果清洗');
{
  const raw = [
    '```',
    '以下是转写结果：',
    '**对方**: 在忙吗',
    '我: 没有 怎么了',
    '2026年9月1日 12:00',
    '12:30',
    '———',
    '- 对方: 没什么 就是问问你',
    '',
    '我: 哦',
    '```'
  ].join('\n');
  const c = wechat.cleanTranscript(raw);
  check('剥掉代码围栏', c.indexOf('```') < 0);
  check('剥掉「以下是…」前言', c.indexOf('以下是') < 0);
  check('剥掉 markdown 粗体说话人', c.indexOf('**') < 0);
  check('剥掉纯日期行', c.indexOf('2026年9月1日') < 0);
  check('剥掉纯时间行', c.indexOf('12:30') < 0);
  check('剥掉分隔线', c.indexOf('———') < 0);
  check('剥掉列表符号', /^- /m.test(c) === false);
  check('全角冒号统一为半角', c.indexOf('：') < 0);
  check('正文一字未改（第一句）', c.indexOf('对方: 在忙吗') > -1);
  check('正文一字未改（含空格）', c.indexOf('我: 没有 怎么了') > -1);
  check('正文一字未改（第三条）', c.indexOf('对方: 没什么 就是问问你') > -1);

  /* 内容里带冒号不能丢 */
  const c2 = wechat.cleanTranscript('我: 几点来着？ 8:30 那班车');
  check('正文里的冒号保留', c2.indexOf('8:30 那班车') > -1, c2);

  /* 非转写内容（模型没听话，写了一堆分析）不该进语料 */
  const c3 = wechat.cleanTranscript('这段对话体现出一方比较冷淡，另一方在主动靠近。\n对方: 嗯');
  check('丢掉成段的模型分析（无冒号、长句、句号结尾）',
    c3.indexOf('体现出一方') < 0, c3);
  check('同一份里正常的转写行仍保留', c3.indexOf('对方: 嗯') > -1);

  check('空输入 → 空串', wechat.cleanTranscript('') === '');
  check('null 输入不抛', wechat.cleanTranscript(null) === '');
  check('undefined 输入不抛', wechat.cleanTranscript(undefined) === '');
}

/* ═══════════════ 6. 多张合并 ═══════════════ */
section('6. 多张截图合并');
{
  const a = '对方: 第一句\n我: 第二句';
  const b = '我: 第二句\n对方: 第三句';
  const merged = wechat.mergeTranscripts([a, b]);
  const lines = merged.split('\n');
  check('按顺序拼接', lines[0] === '对方: 第一句' && lines[lines.length - 1] === '对方: 第三句', merged);
  check('相邻重复行去重（截图重叠时很常见）',
    lines.filter((x) => x === '我: 第二句').length === 1, merged);
  check('三段合并', wechat.mergeTranscripts([a, b, '我: 第四句']).split('\n').length === 4);
  check('空数组 → 空串', wechat.mergeTranscripts([]) === '');
  check('全是空内容 → 空串', wechat.mergeTranscripts(['', null, '   ']) === '');
  check('接受 {text} 形式', wechat.mergeTranscripts([{ text: a }]).indexOf('第一句') > -1);
  check('混合字符串与对象都行', wechat.mergeTranscripts([a, { text: '对方: 第五句' }]).indexOf('第五句') > -1);
}

/* ═══════════════ 7. 与影子解析器联动 ═══════════════ */
section('7. 与影子解析器联动');
{
  const merged = wechat.mergeTranscripts([
    '对方: 在忙吗\n我: 没有 怎么了',
    '对方: 没什么 就是问问你最近怎么样'
  ]);
  const r = wechat.parseWeChatLog(merged);
  check('解析出两位说话人', r.speakers.length === 2, JSON.stringify(r.speakers));
  check('包含「对方」', r.speakers.indexOf('对方') > -1);
  check('包含「我」', r.speakers.indexOf('我') > -1);
  check('默认选中非「我」的那位作为 TA',
    wechat.defaultShadowSpeaker(r) === '对方', wechat.defaultShadowSpeaker(r));
  check('TA 的消息条数正确', (r.byName['对方'] || []).length === 2,
    JSON.stringify((r.byName['对方'] || []).length));
  check('清理后的全文不含说话人前缀（语料是纯消息）',
    r.cleaned.indexOf('对方:') < 0, r.cleaned);

  const r2 = wechat.parseWeChatLog(wechat.cleanTranscript('对方: 嗯\n没有识别到聊天内容'));
  check('「没有识别到聊天内容」被判为无内容', wechat.isNoContent('没有识别到聊天内容'));
  check('正常转写不算无内容', wechat.isNoContent('对方: 嗯') === false);
  check('无内容文本不会污染语料', r2.cleaned.indexOf('没有识别到') < 0, r2.cleaned);
}

/* ═══════════════ 8. 页面接入 ═══════════════ */
section('8. 影子页接入');
{
  const js = read('pages/yingzi/yingzi.js');
  const wxml = read('pages/yingzi/yingzi.wxml');
  const wxss = read('pages/yingzi/yingzi.wxss');

  check('有统一导入入口 onImportMenu', /onImportMenu\s*\(/.test(js));
  check('入口是 ActionSheet 四条路', /showActionSheet/.test(js));
  check('从微信聊天选截图（chooseMessageFile type image）',
    /onPickChatImage/.test(js) && /type:\s*'image'/.test(js));
  check('从相册选截图（chooseMedia）', /onPickAlbumImage/.test(js) && /chooseMedia/.test(js));
  check('保留从聊天选文件的老路径', /onPickFile/.test(js));
  check('保留剪贴板路径', /onPasteClipboard/.test(js));
  check('截图先压缩再上传', /compressImage/.test(js));
  check('上传到云存储的独立目录', /'import\/'\s*\+/.test(js));
  check('上传前先做云开发初始化（没 init 上传必失败）', /ai\.cloudInit\(\)/.test(js));
  check('初始化失败时给明确提示', /云开发没连上/.test(js));
  check('用临时链接喂模型', /getTempFileURL/.test(js) && /ai\.ocrImage/.test(js));
  check('识别完立刻删云端文件', /dropCloudFiles/.test(js) && /deleteFile/.test(js));
  check('删除发生在 ocrImage 回调里（不依赖页面卸载）',
    /ai\.ocrImage\(url,\s*\(err,\s*text\)\s*=>\s*\{[\s\S]{0,200}dropCloudFiles/.test(js));
  check('格式白名单', /'jpg',\s*'jpeg',\s*'png',\s*'webp',\s*'gif'/.test(js));
  check('数量上限 9 张', /slice\(0,\s*9\)/.test(js));
  check('单张体积上限', /12 \* 1024 \* 1024/.test(js));
  check('并发保护（连点不会重复上传）', /_impBusy/.test(js));
  check('进度提示（识别要等 30 秒，不能干等）', /impTip/.test(js) && /正在识别第/.test(js));
  check('失败要如实说明原因', /describeVisionErr/.test(js));
  check('有图没识别成功时也提示', /张没识别成功/.test(js));
  check('提醒用户核对「我/对方」有没有标反', /标反/.test(js));
  check('识别结果仍走同一个解析入口', /applyLogText\(merged/.test(js));
  check('图片不落本地存储（不写 S.shadow.image）', !/\.image\s*=\s*(final|url|fileID)/.test(js));
  check('未开 AI 时明确告知而不是静默失败', /ai\.isEnabled\(\)/.test(js) && /图片识别没开/.test(js));

  check('wxml 有「导入微信聊天记录」按钮', wxml.indexOf('导入微信聊天记录') > -1);
  check('wxml 保留了粘贴剪贴板入口', wxml.indexOf('只粘贴剪贴板') > -1);
  check('wxml 说明支持截图与文件', wxml.indexOf('截图') > -1 && wxml.indexOf('文件') > -1);
  check('wxml 有进度节点', wxml.indexOf('imp-busy') > -1);
  check('wxml 明确说了识别完就删', wxml.indexOf('识别完立刻从云端删除') > -1);
  check('wxml 讲了怎么用（两条路）', wxml.indexOf('两条路') > -1);
  check('wxml 不再承诺「只在你手机里」（截图会过云）', wxml.indexOf('只存在于你的手机里') < 0);
  check('wxss 补了导入区样式', /\.imp-note/.test(wxss) && /\.imp-busy/.test(wxss) && /\.imp-priv/.test(wxss));
  check('wxss 补了次级按钮样式', /\.clip-btn/.test(wxss));

  /* 文案不碰审核红线 */
  const all = js + wxml;
  ['咨询', '疏导', '疗愈', '治愈', '抑郁', '焦虑症'].forEach((w) => {
    check('导入相关文案不含红线词「' + w + '」', all.indexOf(w) < 0);
  });
  ['最好的', '第一品牌', '国家级', '永久', '100%有效'].forEach((w) => {
    check('导入相关文案不含绝对化用语「' + w + '」', all.indexOf(w) < 0);
  });
}

/* ═══════════════ 9. 隐私与版本 ═══════════════ */
section('9. 隐私与版本');
{
  const priv = read('pages/privacy/privacy.wxml');
  const appJs = read('app.js');
  const hdr = read('cloudfunctions/noex-ai/index.js');
  check('隐私弹窗提到图片会临时上传', priv.indexOf('截图导入') > -1 || priv.indexOf('临时上传') > -1);
  check('隐私弹窗说明转完就删', priv.indexOf('立刻从云端删除') > -1);
  check('隐私弹窗仍说明聊天记录只在手机里', priv.indexOf('只存在你自己的手机里') > -1);
  check('隐私弹窗列出相册能力', priv.indexOf('相册') > -1);
  check('版本号升到 0.9.16', /version:\s*'0\.9\.16'/.test(appJs));
  check('build 标记 no-tone-v9.16', /build:\s*'no-tone-v9\.16'/.test(appJs));
  check('云函数头注释写了 vision 分支', /'vision'/.test(hdr));
  check('云函数头注释提醒把超时改成 60 秒', /60 秒/.test(hdr));
}

/* ═══════════════ 收尾 ═══════════════ */
console.log('\n========================================');
console.log(`${pass} 项通过, ${fail} 项有问题`);
if (problems.length) {
  console.log('\n待处理清单:');
  problems.forEach((p, i) => console.log(`  ${i + 1}. ${p}`));
  process.exitCode = 1;
}
