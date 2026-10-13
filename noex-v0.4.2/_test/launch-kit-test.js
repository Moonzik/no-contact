// _test/launch-kit-test.js — 上线三件套（v0.9.11）
// 查什么：
//   1. 《用户服务协议》页存在、已在 app.json 注册、四个文件齐全
//   2. 协议正文合规：不出现情感/心理类红线词，且保留了危机热线与免责声明
//   3. 「我」页意见反馈入口完整（客服会话按钮 + 可复制的反馈模板）
//   4. 分享卡片文案中性 —— 不出现断联/前任/失恋等，不能替用户公开私事
//   5. 留白瓶输入框清空机制存在（原生 textarea 焦点中忽略 value 更新的老坑）
//   6. 「数据仅存本机」这类不准确表述已清除（对话内容会用于生成回复）
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
let pass = 0, fail = 0;
const problems = [];
function check(name, cond, info) {
  if (cond) { pass++; }
  else {
    fail++;
    problems.push(name + (info ? ' → ' + info : ''));
    console.log('  ✗', name, info || '');
  }
}
function read(rel) { return fs.readFileSync(path.join(ROOT, rel), 'utf8'); }
function exists(rel) { return fs.existsSync(path.join(ROOT, rel)); }

const app = JSON.parse(read('app.json'));
const pages = app.pages || [];

console.log('========== 1. 用户服务协议页 ==========');
const AG = 'pages/agreement/agreement';
['.js', '.wxml', '.wxss', '.json'].forEach((ext) => {
  check('协议页文件存在 ' + AG + ext, exists(AG + ext));
});
check('协议页已在 app.json 注册', pages.indexOf(AG) > -1,
  'pages=' + pages.join(','));

const agJs = read(AG + '.js');
const agWxml = read(AG + '.wxml');

console.log('\n========== 2. 协议正文合规 ==========');
const BANNED = ['心理咨询', '心理治疗', '疏导', '疗愈', '治愈', '抑郁', '焦虑症', '婚恋挽回', '情感咨询'];
BANNED.forEach((w) => {
  check('协议不出现红线词「' + w + '」', agJs.indexOf(w) === -1);
});
check('协议写明不是医疗服务', agJs.indexOf('不提供医疗服务') > -1);
check('协议写明不是咨询服务', agJs.indexOf('也不是咨询服务') > -1);
check('协议保留危机热线', agJs.indexOf('400-161-9995') > -1);
check('协议保留 120/110', agJs.indexOf('120 / 110') > -1);
check('协议披露对话内容会发给第三方大模型', agJs.indexOf('DeepSeek') > -1);
check('协议声明聊天记录原文只存本机', agJs.indexOf('只存在你本机') > -1);
check('协议写明禁止骚扰他人', agJs.indexOf('骚扰') > -1);
check('协议有免责条款', agJs.indexOf('按「现状」提供') > -1);
check('协议有生效/更新说明', agJs.indexOf('继续使用即视为接受') > -1);
check('协议页可跳微信隐私指引', agWxml.indexOf('onOpenPrivacy') > -1 &&
  agJs.indexOf('openPrivacyContract') > -1);

console.log('\n========== 3. 意见反馈入口 ==========');
const meJs = read('pages/me/me.js');
const meWxml = read('pages/me/me.wxml');
check('我页有反馈入口行', meWxml.indexOf('bindtap="onOpenFeedback"') > -1);
check('我页有客服会话按钮', meWxml.indexOf('open-type="contact"') > -1);
check('我页有复制反馈模板按钮', meWxml.indexOf('bindtap="onCopyFeedback"') > -1);
['onOpenFeedback', 'onCloseFeedback', 'onCopyFeedback', 'onOpenAgreement'].forEach((fn) => {
  check('me.js 定义 ' + fn, meJs.indexOf(fn + '(') > -1);
});
check('反馈模板含版本号', meJs.indexOf("'版本：v'") > -1);
check('反馈模板含设备信息', meJs.indexOf('getSystemInfoSync') > -1);
check('剪贴板失败有兜底提示', /setClipboardData\([\s\S]{0,400}?fail:/.test(meJs));
check('我页有协议入口行', meWxml.indexOf('bindtap="onOpenAgreement"') > -1);
check('onOpenAgreement 跳协议页', meJs.indexOf('/pages/agreement/agreement') > -1);

console.log('\n========== 4. 分享卡片文案中性 ==========');
const SHARE_PAGES = [
  ['pages/today/today.js', '今天页'],
  ['pages/xiaobai/xiaobai.js', '小白页'],
  ['pages/yingzi/yingzi.js', '影子页'],
  ['pages/bottle/bottle.js', '留白瓶页']
];
const LEAK = ['断联', '前任', '失恋', '分手', '挽回', '暗恋', '想你', '戒断'];
SHARE_PAGES.forEach(([file, label]) => {
  const src = read(file);
  check(label + ' 有 onShareAppMessage', src.indexOf('onShareAppMessage(') > -1);
  const m = src.match(/const SHARE_TITLES\s*=\s*\[([\s\S]*?)\]/);
  check(label + ' 定义了 SHARE_TITLES', !!m);
  if (!m) return;
  const titles = m[1];
  LEAK.forEach((w) => {
    check(label + ' 分享文案不出现「' + w + '」', titles.indexOf(w) === -1, titles.trim());
  });
  check(label + ' 分享路径指向引导页（新老用户都能进）',
    src.indexOf("path: '/pages/onboard/onboard'") > -1 || src.indexOf('onShareTimeline') > -1);
});
const todayJs = read('pages/today/today.js');
check('今天页支持分享到朋友圈', todayJs.indexOf('onShareTimeline(') > -1);
check('今天页主动开启朋友圈菜单项', todayJs.indexOf('showShareMenu') > -1);
check('分享图片用不带字的狐狸', todayJs.indexOf("SHARE_IMG = '/images/agent.png'") > -1);
check('分享图片文件真实存在', exists('images/agent.png'));

console.log('\n========== 5. 留白瓶输入框清空 ==========');
const bottleJs = read('pages/bottle/bottle.js');
const bottleWxml = read('pages/bottle/bottle.wxml');
check('bottle.js 有 clearInputBox', bottleJs.indexOf('clearInputBox(') > -1);
check('bottle 保存后调用 clearInputBox', /onSave\(\)[\s\S]{0,600}?clearInputBox\(\)/.test(bottleJs));
check('bottle textarea 受 taAlive 控制', bottleWxml.indexOf('wx:if="{{taAlive}}"') > -1);
check('bottle 不再直接 setData 清空', !/storage\.save\(S\);\s*this\.setData\(\{\s*text:\s*''\s*\}\)/.test(bottleJs));

console.log('\n========== 6. 数据表述准确性 ==========');
const SCAN = [
  'app.js', 'pages/me/me.js', 'pages/me/me.wxml',
  'pages/privacy/privacy.wxml', 'pages/xiaobai/xiaobai.wxml',
  'pages/yingzi/yingzi.wxml', 'pages/bottle/bottle.wxml',
  'pages/agreement/agreement.wxml', 'pages/agreement/agreement.js'
];
SCAN.forEach((f) => {
  const src = read(f);
  check(f + ' 不再声称「所有数据仅保存在本机」', src.indexOf('所有数据仅保存在本机') === -1);
  check(f + ' 不再声称「不会上传服务器」', src.indexOf('不会上传服务器') === -1);
  check(f + ' 不出现「心理治疗」', src.indexOf('心理治疗') === -1);
});
check('我页披露对话内容用于生成回复',
  read('pages/me/me.wxml').indexOf('会用于生成回复') > -1);
check('隐私弹窗同样如实说明',
  read('pages/privacy/privacy.wxml').indexOf('会用于生成回复') > -1);

console.log('\n========== ' + pass + ' 项通过, ' + fail + ' 项有问题 ==========');
if (problems.length) {
  console.log('\n问题清单:');
  problems.forEach((p) => console.log(' -', p));
}
process.exit(fail ? 1 : 0);
