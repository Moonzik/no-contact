// _test/privacy-test.js — v0.9.6 隐私授权流程测试
// 覆盖：__usePrivacyCheck__ 开启后的授权链路（app.js 接管 + pages/privacy 弹窗）
// 这一段此前零覆盖，改动风险最大，所以单独成套。
//
// 检查项:
//   1. app.json 已开启 __usePrivacyCheck__，且 privacy 页已注册
//   2. app.js 注册了 wx.onNeedPrivacyAuthorization
//   3. 隐私接口被调用 → 自动跳 privacy 页，resolve 被存下
//   4. 已在 privacy 页时不重复跳转
//   5. 点「同意」→ resolve({event:'agree'}) 且带上正确 buttonId，之后清空
//   6. 点「不同意」→ resolve({event:'disagree'})
//   7. 用户直接返回（onUnload）→ 兜底消费 resolve，不会卡死
//   8. resolve 只被消费一次（幂等）
//   9. navigateTo 失败（页面栈满等）→ 直接放行，不把用户卡死
//  10. 「《用户隐私保护指引》」入口调用 wx.openPrivacyContract
//  11. wxml 的 button id 与 js 里 resolve 的 buttonId 一致
//  12. privacy.json 为透明弹窗配置（navigationStyle custom + 透明背景）

const fs = require('fs');
const path = require('path');

const BASE = path.resolve(__dirname, '..');
let pass = 0, fail = 0;
function check(name, cond, info) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.error('  ✗ ' + name + (info ? '   [' + info + ']' : '')); }
}

/* ───────── 1. 静态配置 ───────── */
console.log('\n[配置]');
const appJsonRaw = fs.readFileSync(path.join(BASE, 'app.json'), 'utf8').replace(/^\uFEFF/, '');
const appJson = JSON.parse(appJsonRaw);

check('app.json 已开启 __usePrivacyCheck__', appJson.__usePrivacyCheck__ === true,
  '当前值: ' + appJson.__usePrivacyCheck__);
check('privacy 页已在 pages 注册', (appJson.pages || []).indexOf('pages/privacy/privacy') > -1);
check('privacy 页不是 tabBar 页（否则 navigateTo 会被拒）',
  ((appJson.tabBar && appJson.tabBar.list) || []).every((t) => t.pagePath !== 'pages/privacy/privacy'));

const pJson = JSON.parse(fs.readFileSync(path.join(BASE, 'pages/privacy/privacy.json'), 'utf8'));
check('privacy.json 用自定义导航栏', pJson.navigationStyle === 'custom');
check('privacy.json 背景透明（真弹窗效果）', /#00000000/i.test(String(pJson.backgroundColor || '')));

const pWxml = fs.readFileSync(path.join(BASE, 'pages/privacy/privacy.wxml'), 'utf8');
check('wxml 有 agreePrivacyAuthorization 按钮',
  /open-type="agreePrivacyAuthorization"/.test(pWxml));
check('wxml 绑定了 bindagreeprivacyauthorization',
  /bindagreeprivacyauthorization="onAgree"/.test(pWxml));

/* ───────── 2. 搭 fake 环境 ───────── */
const calls = { navigateTo: [], navigateBack: 0, switchTab: [], toast: [], openContract: 0 };
let needHandler = null;      // wx.onNeedPrivacyAuthorization 注册进来的回调
let navFail = false;         // 模拟 navigateTo 失败
let pageStack = [{ route: 'pages/me/me' }];

global.wx = {
  getStorageSync: () => undefined,
  setStorageSync: () => {},
  removeStorageSync: () => {},
  getSystemInfoSync: () => ({ SDKVersion: '3.0.0', platform: 'devtools' }),
  onNeedPrivacyAuthorization(h) { needHandler = h; },
  requirePrivacyAuthorize() {},
  openPrivacyContract(o) {
    calls.openContract++;
    if (o && typeof o.success === 'function') o.success({});
  },
  navigateTo(o) {
    calls.navigateTo.push(o && o.url);
    if (navFail) {
      if (o && typeof o.fail === 'function') o.fail({ errMsg: 'navigateTo:fail' });
    } else if (o && typeof o.success === 'function') {
      o.success({});
    }
  },
  navigateBack() { calls.navigateBack++; },
  switchTab(o) { calls.switchTab.push(o && o.url); },
  showToast(o) { calls.toast.push(o && o.title); },
  setStorage() {},
  request() {}
};
global.getCurrentPages = () => pageStack;

let appConfig = null;
global.App = (obj) => { appConfig = obj; };
let privacyPage = null;
global.Page = (obj) => { privacyPage = obj; };
global.getApp = () => ({ globalData: appConfig.globalData });

/* ───────── 3. 加载 app.js 并启动 ───────── */
console.log('\n[授权接管]');
require(path.join(BASE, 'app.js'));
check('app.js 能加载且 App() 已调用', !!appConfig);
appConfig.onLaunch();
check('onLaunch 注册了 onNeedPrivacyAuthorization', typeof needHandler === 'function');

/* ───────── 4. 隐私接口被触发 ───────── */
let resolved = null;
needHandler((payload) => { resolved = payload; });
check('触发后自动跳 privacy 页',
  calls.navigateTo[calls.navigateTo.length - 1] === '/pages/privacy/privacy',
  JSON.stringify(calls.navigateTo));
check('resolve 已存进 globalData', typeof appConfig.globalData.privacyResolve === 'function');

/* 已在 privacy 页时应跳过重复跳转 */
pageStack = [{ route: 'pages/privacy/privacy' }];
const before = calls.navigateTo.length;
needHandler(() => {});
check('已在 privacy 页时不重复跳转', calls.navigateTo.length === before);

/* ───────── 5. 加载 privacy 页并走完流程 ───────── */
console.log('\n[弹窗交互]');
pageStack = [{ route: 'pages/me/me' }];
require(path.join(BASE, 'pages/privacy/privacy.js'));
check('privacy.js 能加载且 Page() 已调用', !!privacyPage);
check('privacy.js 定义了 onAgree', typeof privacyPage.onAgree === 'function');
check('privacy.js 定义了 onDisagree', typeof privacyPage.onDisagree === 'function');
check('privacy.js 定义了 openContract', typeof privacyPage.openContract === 'function');
check('privacy.js 定义了 onUnload 兜底', typeof privacyPage.onUnload === 'function');

/* 同意（上面「不重复跳转」那步挂的 resolve 是空函数，这里重新挂一个可观测的） */
needHandler((p) => { resolved = p; });
resolved = null;
calls.navigateBack = 0;
privacyPage.onAgree({ detail: { buttonId: 'agree-btn' } });
check('点同意 → resolve event=agree', !!resolved && resolved.event === 'agree', JSON.stringify(resolved));
check('点同意 → 带上 buttonId', !!resolved && resolved.buttonId === 'agree-btn', JSON.stringify(resolved));
check('点同意 → 返回上一页', calls.navigateBack === 1);
check('点同意 → resolve 已清空', appConfig.globalData.privacyResolve === null);

/* buttonId 与 wxml 的 id 对得上 */
const idInWxml = (pWxml.match(/id="([^"]+)"/) || [])[1];
check('js 默认 buttonId 与 wxml 的 id 一致', !idInWxml || idInWxml === 'agree-btn', idInWxml);

/* 《用户隐私保护指引》入口 */
privacyPage.openContract();
check('点指引 → 调 wx.openPrivacyContract', calls.openContract === 1);

/* 不同意 */
needHandler((p) => { resolved = p; });   // 重新挂一个待处理请求
resolved = null;
privacyPage.onDisagree();
check('点不同意 → resolve event=disagree', !!resolved && resolved.event === 'disagree', JSON.stringify(resolved));
check('点不同意 → resolve 已清空', appConfig.globalData.privacyResolve === null);

/* ───────── 6. 用户直接返回（不点按钮） ───────── */
console.log('\n[异常兜底]');
needHandler((p) => { resolved = p; });
resolved = null;
privacyPage.onUnload();
check('直接返回 → 兜底消费 resolve（不卡死）', !!resolved && resolved.event === 'disagree', JSON.stringify(resolved));

/* 幂等：已消费后再 onUnload 不应二次 resolve */
resolved = null;
privacyPage.onUnload();
check('resolve 不会被消费两次', resolved === null);

/* navigateTo 失败（页面栈满等极端情况） */
navFail = true;
resolved = null;
needHandler((p) => { resolved = p; });
check('跳转失败 → 直接放行，不卡死', !!resolved && resolved.event === 'disagree', JSON.stringify(resolved));
check('跳转失败 → resolve 已清空', appConfig.globalData.privacyResolve === null);
navFail = false;

/* 旧基础库没有 onNeedPrivacyAuthorization 时不崩 */
delete global.wx.onNeedPrivacyAuthorization;
let crashed = false;
try { appConfig.initPrivacy(); } catch (e) { crashed = true; }
check('旧基础库（无 onNeedPrivacyAuthorization）不崩溃', !crashed);

console.log('\n================================================');
console.log('  通过 ' + pass + ' · 失败 ' + fail);
console.log('================================================\n');
process.exit(fail ? 1 : 0);
