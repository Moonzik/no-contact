/**
 * audit-platform.js — 真机/iOS-安卓兼容 + 微信审核视角 静态审计
 *
 * 覆盖静态能查的部分（渲染效果、真机行为必须人工在开发者工具里看，脚本查不了）
 *
 *   1. 居中文本 letter-spacing 未抵消 → 安卓/iOS 视觉偏左
 *   2. backdrop-filter 无降级背景色 → 安卓旧 WebView 蒙层全透明
 *   3. 100vh 用于页面根容器 → iOS 键盘弹起/地址栏变化时高度跳动
 *   4. 图片资源过大 → 主包 2MB 硬限制
 *   5. 主包体积
 *   6. 隐私接口调用 但未配置 __usePrivacyCheck__
 *   7. tabBar 图标规格
 *   8. new Date('YYYY-MM-DD') 老 iOS JSCore 解析风险
 *   9. 审核红线词扫描（医疗承诺 / 绝对化 / 诱导分享 / 虚拟支付 / 涉政）
 *  10. 必要条件：sitemap / 页面注册 / 类目相关
 *
 * 用法: node _test/audit-platform.js
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
let pass = 0;
const problems = [];

function ok(msg) {
  pass++;
  console.log('  ✓ ' + msg);
}
function bad(msg, fix) {
  problems.push({ msg, fix });
  console.log('  ✗ ' + msg + (fix ? '\n      建议: ' + fix : ''));
}

/**
 * 去掉 JS 注释再扫描，避免注释里的示例代码/说明被误判为真实调用
 * （如 util.js 注释中的 new Date('2026-09-08')）
 */
function stripComments(s) {
  return s
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:'"`\\])\/\/[^\n]*/g, '$1');
}

function walk(dir, ext, out) {
  out = out || [];
  if (!fs.existsSync(dir)) return out;
  for (const f of fs.readdirSync(dir)) {
    const p = path.join(dir, f);
    const st = fs.statSync(p);
    if (st.isDirectory()) {
      if (f === '_test' || f === '_orig_backup' || f === 'node_modules') continue;
      walk(p, ext, out);
    } else if (p.endsWith(ext)) {
      out.push(p);
    }
  }
  return out;
}

const wxssFiles = [].concat(walk(path.join(ROOT, 'pages'), '.wxss'), [path.join(ROOT, 'app.wxss')]);
const jsFiles = [].concat(walk(path.join(ROOT, 'pages'), '.js'), walk(path.join(ROOT, 'utils'), '.js'), [path.join(ROOT, 'app.js')]);
const wxmlFiles = walk(path.join(ROOT, 'pages'), '.wxml');

console.log('========== 1. letter-spacing 居中偏移 ==========');
{
  // 找出「居中 + letter-spacing >= 4rpx + 未用 text-indent 抵消」的规则
  let hit = 0;
  for (const f of wxssFiles) {
    const css = fs.readFileSync(f, 'utf8');
    const rel = path.relative(ROOT, f);
    const re = /([^{}]+)\{([^}]*)\}/g;
    let m;
    while ((m = re.exec(css))) {
      const sel = m[1].trim().replace(/\s+/g, ' ');
      const body = m[2];
      const ls = /letter-spacing:\s*([\d.]+)rpx/.exec(body);
      if (!ls) continue;
      const val = parseFloat(ls[1]);
      if (val < 4) continue; // 2rpx 以下偏移 <1rpx，肉眼不可见
      const centered = /text-align:\s*center/.test(body) ||
                       /\bbutton\b/.test(sel) ||
                       /\.btn/.test(sel);
      if (!centered) continue;
      if (/text-indent:\s*[\d.]+rpx/.test(body)) continue; // 已抵消
      hit++;
      bad(`${rel}  ${sel}  居中 + letter-spacing:${val}rpx 未抵消 → 视觉偏左 ${(val / 2).toFixed(1)}rpx`,
          `加 text-indent: ${val}rpx`);
    }
  }
  if (!hit) ok('无未抵消的居中 letter-spacing');
}

console.log('\n========== 2. backdrop-filter 降级 ==========');
{
  let hit = 0;
  for (const f of wxssFiles) {
    const css = fs.readFileSync(f, 'utf8');
    const rel = path.relative(ROOT, f);
    const re = /([^{}]+)\{([^}]*)\}/g;
    let m;
    while ((m = re.exec(css))) {
      if (!/backdrop-filter:/.test(m[2])) continue;
      // 必须有 -webkit- 前缀（旧 iOS）且有不透明/半透明背景兜底（安卓不支持时）
      const hasWebkit = /-webkit-backdrop-filter:/.test(m[2]);
      const hasBg = /(^|[;\s])background(-color)?:\s*(rgba?\()/.test(m[2]) ||
                    /(^|[;\s])background:\s*#[0-9a-fA-F]{6,8}/.test(m[2]);
      if (!hasWebkit || !hasBg) {
        hit++;
        bad(`${rel}  ${m[1].trim().replace(/\s+/g, ' ')}  backdrop-filter 缺 ${!hasWebkit ? '-webkit- 前缀 ' : ''}${!hasBg ? '不透明背景兜底' : ''}`,
            '安卓旧 WebView 不支持 backdrop-filter，蒙层会全透明导致文字不可读');
      }
    }
  }
  if (!hit) ok('backdrop-filter 均有前缀与兜底');
}

console.log('\n========== 3. 100vh 与键盘 ==========');
{
  let hit = 0;
  for (const f of wxssFiles) {
    const css = fs.readFileSync(f, 'utf8');
    const rel = path.relative(ROOT, f);
    const re = /([^{}]+)\{([^}]*)\}/g;
    let m;
    while ((m = re.exec(css))) {
      const body = m[2];
      // 注意：min-height/max-height 是安全写法，不能误报，故用反向断言排除
      if (!/(?<![-\w])height:\s*(?:calc\([^)]*)?100vh/.test(body)) continue;
      // flex 列布局下的 height:100vh 是聊天页标准写法（滚动区靠 flex:1 撑开），可接受
      if (/display:\s*flex/.test(body) && /flex-direction:\s*column/.test(body)) continue;
      hit++;
      bad(`${rel}  ${m[1].trim().replace(/\s+/g, ' ')}  裸 height:100vh → iOS 键盘弹起时输入框可能被顶出可视区`,
          '改用 flex 列布局（滚动区 flex:1，输入区 flex-shrink:0）或 min-height；输入区配 adjust-position');
    }
  }
  if (!hit) ok('无裸 height:100vh（flex 列布局下的用法可接受）');
}

console.log('\n========== 4. 图片资源 ==========');
{
  const imgDir = path.join(ROOT, 'images');
  let hit = 0;
  if (fs.existsSync(imgDir)) {
    for (const f of fs.readdirSync(imgDir)) {
      if (f.startsWith('_')) continue;
      const p = path.join(imgDir, f);
      if (!fs.statSync(p).isFile()) continue;
      const buf = fs.readFileSync(p);
      const kb = buf.length / 1024;
      let dim = '?';
      if (buf.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
        dim = buf.readUInt32BE(16) + 'x' + buf.readUInt32BE(20);
      }
      const isTab = /^tab-/.test(f);
      const limit = isTab ? 40 : 100;
      if (kb > limit) {
        hit++;
        bad(`images/${f}  ${dim}  ${kb.toFixed(0)} KB  超过 ${limit} KB`,
            '压缩或降分辨率；单图建议 <100KB，tabBar 图标 <40KB');
      }
    }
  }
  if (!hit) ok('所有图片体积在阈值内');
}

console.log('\n========== 5. 主包体积 ==========');
{
  let total = 0;
  function size(dir) {
    if (!fs.existsSync(dir)) return;
    for (const f of fs.readdirSync(dir)) {
      if (f === '_test' || f === '_orig_backup' || f === 'node_modules') continue;
      const p = path.join(dir, f);
      const st = fs.statSync(p);
      if (st.isDirectory()) size(p);
      else total += st.size;
    }
  }
  size(ROOT);
  const mb = total / 1024 / 1024;
  if (mb > 2) {
    bad(`主包 ${mb.toFixed(2)} MB 超过微信 2MB 硬限制`, '压缩图片 / 分包 / 删除无用资源');
  } else if (mb > 1.5) {
    bad(`主包 ${mb.toFixed(2)} MB 接近 2MB 上限（余量 <0.5MB）`, '建议继续瘦身，避免后续迭代超限');
  } else {
    ok(`主包 ${(total / 1024).toFixed(0)} KB（${mb.toFixed(2)} MB），距 2MB 上限余量充足`);
  }
}

console.log('\n========== 6. 隐私接口声明 ==========');
{
  const appJson = JSON.parse(fs.readFileSync(path.join(ROOT, 'app.json'), 'utf8'));
  const usePrivacy = appJson.__usePrivacyCheck__ === true;
  const used = new Set();
  for (const f of jsFiles) {
    const s = stripComments(fs.readFileSync(f, 'utf8'));
    const rel = path.relative(ROOT, f);
    const map = {
      'wx.chooseMessageFile': '从聊天中选择文件（聊天记录导入）',
      'wx.chooseImage': '相册/拍照',
      'wx.chooseLocation': '位置信息',
      'wx.getLocation': '位置信息',
      'wx.getUserProfile': '用户信息',
      'wx.getUserInfo': '用户信息',
      'wx.setClipboardData': '剪贴板',
      'wx.getClipboardData': '剪贴板',
      'wx.authorize': '授权接口'
    };
    for (const k in map) {
      if (s.indexOf(k) > -1) used.add(k + ' → ' + map[k] + '  @' + rel);
    }
  }
  if (used.size === 0) {
    ok('未调用任何隐私接口');
  } else if (!usePrivacy) {
    bad(`调用了 ${used.size} 个隐私接口，但 app.json 未配置 "__usePrivacyCheck__": true\n      ${[...used].join('\n      ')}`,
        '2023-09 起强制：需在 mp 后台配置《用户隐私保护指引》并在 app.json 开启隐私校验，否则真机调用直接 fail');
  } else {
    ok(`已开启 __usePrivacyCheck__，覆盖 ${used.size} 个隐私接口`);
  }
}

console.log('\n========== 7. tabBar 图标规格 ==========');
{
  const appJson = JSON.parse(fs.readFileSync(path.join(ROOT, 'app.json'), 'utf8'));
  if (!appJson.tabBar) {
    ok('无 tabBar');
  } else {
    let hit = 0;
    for (const it of appJson.tabBar.list) {
      for (const key of ['iconPath', 'selectedIconPath']) {
        const p = path.join(ROOT, it[key]);
        if (!fs.existsSync(p)) {
          hit++;
          bad(`tabBar ${it.text} 的 ${key} 不存在: ${it[key]}`, '补齐图标文件');
          continue;
        }
        const buf = fs.readFileSync(p);
        const kb = buf.length / 1024;
        if (buf.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
          const w = buf.readUInt32BE(16);
          const h = buf.readUInt32BE(20);
          if (w !== 81 || h !== 81) {
            hit++;
            bad(`tabBar ${it.text} ${key} 尺寸 ${w}x${h}，建议 81x81`, '导出 81x81');
          }
        }
        if (kb > 40) {
          hit++;
          bad(`tabBar ${it.text} ${key} ${kb.toFixed(0)} KB > 40KB`, '压缩');
        }
      }
    }
    if (!hit) ok('tabBar 图标均为 81x81 且 <40KB');
  }
}

console.log('\n========== 8. 日期解析（老 iOS JSCore） ==========');
{
  let hit = 0;
  for (const f of jsFiles) {
    const s = stripComments(fs.readFileSync(f, 'utf8'));
    const rel = path.relative(ROOT, f);
    // new Date('2026-09-08') 或 new Date(x + 'T00:00:00') 形式
    const re = /new Date\(\s*[^)]*['"`]\s*[-\/]\s*['"`]/g;
    const re2 = /new Date\(([A-Za-z_$][\w$.]*)\s*\+\s*['"`]T?\d{2}/g;
    let m;
    while ((m = re.exec(s))) {
      hit++;
      bad(`${rel}  new Date(日期字符串) 老 iOS JSCore 存在解析/时区风险`,
          "改用 new Date(y, m-1, d) 数字构造");
    }
    while ((m = re2.exec(s))) {
      hit++;
      bad(`${rel}  new Date(${m[1]} + 'T...') 拼接字符串解析，iOS 有坑`,
          '改用数字构造 new Date(y, m-1, d)');
    }
  }
  if (!hit) ok('无字符串日期解析');
}

console.log('\n========== 9. 审核红线词 ==========');
{
  const rules = [
    { name: '医疗/疗效承诺', re: /治愈|根治|疗效|诊断|治疗|抑郁症|焦虑症|药物|处方/, level: '高' },
    { name: '绝对化用语', re: /最好的|第一品牌|国家级|最佳|100%有效|永久/, level: '中' },
    { name: '诱导分享', re: /分享给?好友|转发得|邀请.{0,4}得|集赞|分享.{0,3}领/, level: '高' },
    { name: '虚拟支付', re: /充值|购买会员|VIP|积分兑换|打赏/, level: '中' },
    { name: '涉政敏感', re: /政府|领导人|党|游行|示威/, level: '高' }
  ];
  const texts = [];
  for (const f of wxmlFiles) texts.push({ rel: path.relative(ROOT, f), s: fs.readFileSync(f, 'utf8') });
  for (const f of jsFiles) {
    const s = stripComments(fs.readFileSync(f, 'utf8'));
    // 只取中文字符串字面量，避免拿变量名误判
    const hits = s.match(/['"`][^'"`\n]*[\u4e00-\u9fa5][^'"`\n]*['"`]/g) || [];
    texts.push({ rel: path.relative(ROOT, f), s: hits.join('\n') });
  }
  let hit = 0;
  for (const r of rules) {
    for (const t of texts) {
      const m = t.s.match(r.re);
      if (m) {
        // 免责/否定语境（如"不替代专业心理治疗"）是审核加分项，不算违规，跳过
        const idx = t.s.indexOf(m[0]);
        const ctx = t.s.slice(Math.max(0, idx - 14), idx + m[0].length + 14);
        if (/不替代|不是|不属于|非|无(?!法)|不含|不涉及|免责|仅供/.test(ctx)) continue;
        hit++;
        bad(`[${r.level}危] ${r.name}：${t.rel} 命中「${m[0]}」`,
            '审核可能拒审，建议改写或准备说明');
        break;
      }
    }
  }
  if (!hit) ok('未命中审核红线词');
}

console.log('\n========== 10. 基础配置 ==========');
{
  const need = ['app.json', 'sitemap.json', 'project.config.json', 'app.js', 'app.wxss'];
  for (const f of need) {
    if (fs.existsSync(path.join(ROOT, f))) ok(`${f} 存在`);
    else bad(`缺少 ${f}`, '补齐');
  }
  const appJson = JSON.parse(fs.readFileSync(path.join(ROOT, 'app.json'), 'utf8'));
  if (appJson.pages && appJson.pages.length) ok(`已注册 ${appJson.pages.length} 个页面`);
  else bad('app.json 无 pages', '注册页面');
}

console.log('\n========================================');
console.log(`${pass} 项通过, ${problems.length} 项需要处理`);
if (problems.length) {
  console.log('\n待处理清单:');
  problems.forEach((p, i) => console.log(`  ${i + 1}. ${p.msg}`));
  process.exitCode = 1;
}
