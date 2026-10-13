/**
 * sync-check.js — 三目录同步一致性检查（防「改了源码忘了同步交付版」）
 *
 * 背景：本项目有三份目录
 *   no-contact/miniprogram   = 源码
 *   no-contact/noex-v0.4.2   = 交付版（用户实际导入开发者工具的）
 *   Desktop/noex             = 无空格无中文的副本（给开发者工具用）
 * 同步遗漏过多次（新增 utils 忘登记 utilsSrc、HTML 版本不一致…），故单列一套件。
 *
 * 检查项：
 *   1. 文件集合一致（排除 images/_orig_backup 这类纯备份）
 *   2. 逐字节内容一致
 *   3. ⚠️ 关键：utils/ai-config.js 两版【故意不同】——
 *      源码 provider 必须是 'off'，交付版必须是 'cloud'。
 *      同步时若把源码的覆盖过去，AI 会被静默关闭（小白退化成固定话术）。
 *   4. 交付版不得残留临时调试脚本（_tmp_check.js / _chk.js 之类）
 *
 * 用法: 在【交付版目录】下执行 node _test/sync-check.js
 *       在源码目录执行会自动跳过（找不到同级交付版）
 */
const fs = require('fs');
const path = require('path');

const SELF = path.resolve(__dirname, '..');
const PEER = path.resolve(SELF, '..', 'miniprogram');

let pass = 0, fail = 0;
function ok(m) { pass++; console.log('  ✓ ' + m); }
function bad(m, fix) { fail++; console.log('  ✗ ' + m + (fix ? '\n      建议: ' + fix : '')); }

if (!fs.existsSync(PEER) || SELF === PEER) {
  console.log('\n========== 同步检查 ==========');
  console.log('  跳过：未找到同级的 miniprogram 源码目录（本脚本请在交付版目录下运行）');
  console.log(`\n通过 ${pass} · 失败 ${fail}`);
  process.exit(0);
}

// 允许两版不同的文件（有明确理由）
const ALLOW = new Set([
  'utils/ai-config.js',            // 故意：provider off vs cloud
  'project.config.json',           // 路径/工具版本字段
  'project.private.config.json'    // 开发者工具本地状态
]);
const SKIP_DIR = new Set(['node_modules', '.git', '_orig_backup', '_test']);

function walk(root) {
  const out = [];
  (function go(d) {
    for (const f of fs.readdirSync(d)) {
      if (SKIP_DIR.has(f)) continue;
      const p = path.join(d, f);
      const rel = path.relative(root, p).split(path.sep).join('/');
      if (fs.statSync(p).isDirectory()) go(p);
      else out.push(rel);
    }
  })(root);
  return out.sort();
}

console.log('\n========== 1. 文件集合 ==========');
{
  const a = walk(PEER), b = walk(SELF);
  const sa = new Set(a), sb = new Set(b);
  const onlySrc = a.filter(f => !sb.has(f) && !ALLOW.has(f));
  const onlySelf = b.filter(f => !sa.has(f) && !ALLOW.has(f));
  if (onlySrc.length) bad(`源码有、交付版缺 ${onlySrc.length} 个：${onlySrc.slice(0, 8).join('、')}${onlySrc.length > 8 ? ' …' : ''}`, '补 cp 同步');
  else ok('源代码文件在交付版中都存在');
  if (onlySelf.length) bad(`交付版有、源码缺 ${onlySelf.length} 个：${onlySelf.slice(0, 8).join('、')}`, '确认是否为遗留文件');
  else ok('交付版无多余文件');
}

console.log('\n========== 2. 逐字节内容 ==========');
{
  const a = walk(PEER);
  let diff = 0;
  for (const rel of a) {
    if (ALLOW.has(rel)) continue;
    const pa = path.join(PEER, rel), pb = path.join(SELF, rel);
    if (!fs.existsSync(pb)) continue;
    const ba = fs.readFileSync(pa), bb = fs.readFileSync(pb);
    if (Buffer.compare(ba, bb) === 0) continue;
    const na = ba.toString('utf8').replace(/\r\n/g, '\n');
    const nb = bb.toString('utf8').replace(/\r\n/g, '\n');
    diff++;
    bad(`${rel} 内容不一致（${na === nb ? '仅行尾符 CRLF/LF 不同' : '真实差异'}）`,
        '以源码为准覆盖，或确认改动是否有意只落在一边');
  }
  if (!diff) ok('除豁免清单外，全部文件逐字节一致');
}

console.log('\n========== 3. ai-config.js 双版本约定（关键）==========');
{
  const pSrc = path.join(PEER, 'utils/ai-config.js');
  const pSelf = path.join(SELF, 'utils/ai-config.js');
  if (!fs.existsSync(pSelf)) bad('交付版缺 utils/ai-config.js', '补齐');
  else {
    const conf = fs.readFileSync(pSelf, 'utf8');
    if (/provider\s*:\s*'cloud'/.test(conf)) ok("交付版 provider 为 'cloud'（AI 开启）");
    else bad("交付版 provider 不是 'cloud' —— AI 处于关闭状态", "改回 provider: 'cloud' 并填好 env，否则小白退化为固定话术");
    if (/cloud1-/.test(conf)) ok('交付版已填云环境 ID');
    else bad('交付版未填云环境 ID', '填 cloud1-xxxxx');
  }
  if (fs.existsSync(pSrc)) {
    const s = fs.readFileSync(pSrc, 'utf8');
    if (/provider\s*:\s*'off'/.test(s)) ok("源码 provider 为 'off'（保持默认关闭）");
    else console.log("  · 源码 provider 非 'off'（若有意为之可忽略）");
  }
}

console.log('\n========== 4. 无临时调试残留 ==========');
{
  const junk = /^(_tmp|_chk|_scratch|tmp_|test_?)\.js$|^_chk\.js$/;
  let hit = 0;
  for (const rel of walk(SELF)) {
    const base = path.basename(rel);
    if (junk.test(base) && !/_test\//.test(rel)) { hit++; bad(`残留临时脚本 ${rel}`, '删除'); }
  }
  if (!hit) ok('未发现一次性调试脚本残留');
}

console.log('\n========================================');
console.log(`通过 ${pass} · 失败 ${fail}`);
if (fail) process.exitCode = 1;
