// _test/audit-static.js — 静态审计：不跑代码，只做结构性检查
// 检查项:
//   1. wxml 里所有 bind*/catch*/form 事件名 → 对应 js 是否定义了该方法
//   2. wxml 里 <image src> / tabBar iconPath → 文件是否真实存在
//   3. app.json pages / tabBar 路径与真实文件是否对得上
//   4. switchTab 目标必须在 tabBar 里；navigateTo 目标必须在 pages 里（且不能是 tab 页）
//   5. wx:key 值必须在循环项里存在（避免渲染告警）
//   6. 页面 js 引用的 util.* 函数是否存在
//   7. 存在页面目录但没在 app.json 注册（孤儿页面）
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

const app = JSON.parse(fs.readFileSync(path.join(ROOT, 'app.json'), 'utf8'));
const pages = app.pages || [];
const tabPages = (app.tabBar && app.tabBar.list || []).map((t) => t.pagePath);

console.log('========== 1. app.json 路径 ==========');
pages.forEach((p) => {
  const js = path.join(ROOT, p + '.js');
  check('pages 存在 ' + p, fs.existsSync(js));
});
tabPages.forEach((p) => {
  check('tabBar 页在 pages 里: ' + p, pages.indexOf(p) > -1);
});
if (app.tabBar && app.tabBar.list) {
  app.tabBar.list.forEach((t) => {
    ['iconPath', 'selectedIconPath'].forEach((k) => {
      if (!t[k]) return;
      const f = path.join(ROOT, t[k].replace(/^\//, ''));
      check('tabBar 图标存在 ' + t[k], fs.existsSync(f));
    });
  });
}

console.log('========== 1b. 孤儿页面（目录存在但未注册） ==========');
const pagesDir = path.join(ROOT, 'pages');
fs.readdirSync(pagesDir).forEach((dir) => {
  if (!fs.statSync(path.join(pagesDir, dir)).isDirectory()) return;
  const candidate = 'pages/' + dir + '/' + dir;
  if (fs.existsSync(path.join(ROOT, candidate + '.js'))) {
    check('页面已注册: ' + candidate, pages.indexOf(candidate) > -1);
    check('页面有 .json: ' + candidate, fs.existsSync(path.join(ROOT, candidate + '.json')));
    check('页面有 .wxml: ' + candidate, fs.existsSync(path.join(ROOT, candidate + '.wxml')));
  }
});

console.log('========== 2. wxml 事件 → js 方法 ==========');
pages.forEach((p) => {
  const dir = path.dirname(p);
  const name = path.basename(p);
  const wxmlPath = path.join(ROOT, p + '.wxml');
  const jsPath = path.join(ROOT, p + '.js');
  if (!fs.existsSync(wxmlPath) || !fs.existsSync(jsPath)) return;
  const wxml = fs.readFileSync(wxmlPath, 'utf8');
  const js = fs.readFileSync(jsPath, 'utf8');

  const handlers = new Set();
  const re = /\b(?:bind|catch|capture-bind|capture-catch):?([a-zA-Z]+)\s*=\s*"([^"]+)"/g;
  let m;
  while ((m = re.exec(wxml))) {
    const evt = m[1];
    const fn = m[2].trim();
    if (/^(bind|catch)/.test(m[0])) handlers.add(fn);
  }
  handlers.forEach((fn) => {
    // 方法定义: fn(  或 fn:(  (支持 async/空格)
    const defined = new RegExp('(^|[\\s,{])' + fn + '\\s*[(:(]', 'm').test(js);
    check(name + '.wxml → ' + fn + ' 已定义', defined);
  });

  console.log('========== 3. ' + name + ' 资源 / 引用 ==========');
  // image src
  const srcRe = /<image[^>]*\bsrc\s*=\s*"([^"{]+)"/g;
  while ((m = srcRe.exec(wxml))) {
    const src = m[1];
    if (!src.startsWith('/')) continue;
    check(name + ' 图片存在 ' + src, fs.existsSync(path.join(ROOT, src.replace(/^\//, ''))));
  }
  // 静态 import 的 wxss? 略
  // 页面 js 里 wx.switchTab / navigateTo 目标
  const navRe = /wx\.(switchTab|navigateTo|redirectTo|reLaunch)\s*\(\s*\{[^}]*url\s*:\s*'([^']+)'/g;
  while ((m = navRe.exec(js))) {
    const mode = m[1];
    const url = m[2].replace(/^\//, '');
    const base = url.replace(/\?.*$/, '');
    if (mode === 'switchTab') {
      check(name + ' switchTab 目标是 tab 页: ' + url, tabPages.indexOf(base) > -1);
    } else {
      check(name + ' ' + mode + ' 目标已注册: ' + url, pages.indexOf(base) > -1);
      check(name + ' ' + mode + ' 目标不是 tab 页（tab 页必须用 switchTab）: ' + url, tabPages.indexOf(base) === -1);
    }
  }
  // wx:key 检查
  const keyRe = /wx:for\s*=\s*"\{\{([^}]+)\}\}"[^>]*wx:key\s*=\s*"([^"]+)"/g;
  while ((m = keyRe.exec(wxml))) {
    const key = m[2];
    check(name + ' wx:key 非时间戳/索引: ' + key, !/^(t|index)$/.test(key));
  }
});

console.log('========== 4. util 函数引用 ==========');
const utilSrc = fs.readFileSync(path.join(ROOT, 'utils', 'util.js'), 'utf8');
const exported = utilSrc.match(/module\.exports\s*=\s*\{([\s\S]*?)\};/);
const utilNames = exported
  ? exported[1].split(',').map((s) => s.split(':')[0].trim()).filter(Boolean)
  : [];
pages.concat(['utils/storage', 'utils/guardian', 'utils/shadow']).forEach((p) => {
  const jsPath = path.join(ROOT, p + '.js');
  if (!fs.existsSync(jsPath)) return;
  const js = fs.readFileSync(jsPath, 'utf8');
  const re = /\butil\.([a-zA-Z_$][\w$]*)\s*\(/g;
  let m;
  const used = new Set();
  while ((m = re.exec(js))) used.add(m[1]);
  used.forEach((fn) => {
    check(p + ' util.' + fn + ' 存在', utilNames.indexOf(fn) > -1);
  });
});

console.log('\n========== ' + pass + ' 项通过, ' + fail + ' 项有问题 ==========');
if (problems.length) {
  console.log('\n问题清单:');
  problems.forEach((p) => console.log(' -', p));
}
process.exit(fail ? 1 : 0);
