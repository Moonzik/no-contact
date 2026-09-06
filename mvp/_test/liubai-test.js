'use strict';
/* 留白 MVP 冒烟测试 · CDP driver */
const WebSocket = require('ws');
const PORT = process.argv[2] || '9227';
const URL = 'http://localhost:8099/index.html?cb=' + Date.now();

const errors = [];
const results = [];
function ok(name, pass, extra) {
  results.push({ name, pass, extra: extra || '' });
  console.log((pass ? 'PASS' : 'FAIL') + '  ' + name + (extra ? '  [' + extra + ']' : ''));
}

(async () => {
  const list = await new Promise((resolve, reject) => {
    const req = require('http').get('http://127.0.0.1:' + PORT + '/json/list', res => {
      let d = ''; res.on('data', c => d += c);
      res.on('end', () => { try { resolve(JSON.parse(d)); } catch (e) { reject(e); } });
    });
    req.on('error', reject);
    req.setTimeout(8000, () => { req.destroy(); reject(new Error('http timeout')); });
  });
  const page = list.find(t => t.type === 'page');
  const ws = new WebSocket(page.webSocketDebuggerUrl, { perMessageDeflate: false });
  await new Promise(r => ws.on('open', r));

  let id = 0; const pending = {};
  function send(method, params) {
    return new Promise((resolve, reject) => {
      const mid = ++id;
      pending[mid] = resolve;
      ws.send(JSON.stringify({ id: mid, method, params: params || {} }));
      setTimeout(() => { if (pending[mid]) { delete pending[mid]; reject(new Error('timeout ' + method)); } }, 15000);
    });
  }
  ws.on('message', data => {
    let m; try { m = JSON.parse(data); } catch (e) { return; }
    if (m.id && pending[m.id]) { pending[m.id](m.result); delete pending[m.id]; }
    if (m.method === 'Runtime.exceptionThrown') {
      const d = m.params.exceptionDetails;
      errors.push((d.exception && d.exception.description) || d.text || 'exception');
    }
    if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') {
      const v = m.params.args[0]; errors.push((v && v.value) || 'console.error');
    }
  });

  await send('Runtime.enable');
  await send('Network.enable');
  await send('Network.setCacheDisabled', { cacheDisabled: true });
  await send('Page.enable');
  await send('Page.navigate', { url: URL });
  await new Promise(r => setTimeout(r, 1200));

  async function ev(expr) {
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true });
    if (r.exceptionDetails) throw new Error('eval: ' + JSON.stringify(r.exceptionDetails).slice(0, 300) + ' in ' + expr.slice(0, 80));
    return r.result.value;
  }
  async function waitCond(expr, timeout, label) {
    const t0 = Date.now();
    while (Date.now() - t0 < timeout) {
      if (await ev(expr)) return true;
      await new Promise(r => setTimeout(r, 300));
    }
    throw new Error('timeout waiting: ' + label);
  }

  /* ---------- 1. 引导流程 ---------- */
  ok('onboard 显示', await ev('!document.getElementById("onboard").classList.contains("hide")'));
  await ev('document.getElementById("ob-next").click()');
  ok('引导第2步出现日期输入', await ev('!!document.getElementById("ob-date")'));
  await ev('(function(){var d=new Date(Date.now()-6*86400000);var s=d.getFullYear()+"-"+("0"+(d.getMonth()+1)).slice(-2)+"-"+("0"+d.getDate()).slice(-2);document.getElementById("ob-date").value=s;document.getElementById("ob-ex").value="H";document.getElementById("ob-next2").click()})()');
  await ev('document.getElementById("ob-done").click()');
  ok('引导完成', await ev('document.getElementById("onboard").classList.contains("hide")'));

  /* ---------- 2. 今天页 ---------- */
  ok('第7天计数', await ev('document.getElementById("day-num").textContent === "7"'), await ev('document.getElementById("day-num").textContent'));
  const msCount = await ev('document.querySelectorAll("#ms-track .ms").length');
  ok('里程碑9个刻度', msCount === 9, String(msCount));
  ok('7天已达成', await ev('document.querySelectorAll("#ms-track .ms.done").length >= 2'));
  await ev('document.getElementById("check-btn").click()');
  ok('打卡后按钮禁用', await ev('document.getElementById("check-btn").disabled === true'));
  ok('打卡文案变化', await ev('document.getElementById("check-btn").textContent.replace(/\\s/g,"").indexOf("安住") > -1'));

  /* 没忍住 → 取消 */
  await ev('document.getElementById("relapse-link").click()');
  ok('重置弹层出现', await ev('!!document.getElementById("rl-reset")'));
  await ev('document.getElementById("rl-note").click()');
  ok('不重置保持第7天', await ev('document.getElementById("day-num").textContent === "7"'));

  /* ---------- 3. 留白瓶 ---------- */
  await ev('document.getElementById("act-bottle").click()');
  await ev('document.getElementById("bottle-input").value = "其实我只是想问你最近好吗"');
  await ev('document.getElementById("bottle-save").click()');
  ok('留白瓶存入1条', await ev('document.getElementById("bottle-count").textContent.indexOf("1") > -1'), await ev('document.getElementById("bottle-count").textContent'));

  /* ---------- 4. 守护者 ---------- */
  await ev('document.querySelector("#nav button[data-page=guardian]").click()');
  ok('人格4个', await ev('document.querySelectorAll("#persona-row button").length === 4'));
  await waitCond('document.querySelectorAll("#g-scroll .msg").length >= 1', 5000, 'greeting');
  /* 发消息：想ta了 */
  await ev('sendGuardian("我真的好想他")');
  await waitCond('document.querySelectorAll("#g-scroll .msg.me").length >= 1 && document.querySelectorAll("#g-scroll .msg.ai .bubble").length >= 2 && !document.querySelector("#g-scroll .typing")', 8000, 'guardian reply');
  const lastAi = await ev('(function(){var a=document.querySelectorAll("#g-scroll .msg.ai .bubble");return a[a.length-1].textContent})()');
  ok('守护者回复想ta意图', lastAi.length > 5, lastAi.slice(0, 30));
  /* 危机词 */
  await ev('sendGuardian("我不想活了")');
  await waitCond('document.querySelectorAll("#g-scroll .crisis-card").length === 1', 6000, 'crisis card');
  ok('危机干预卡片出现', true);
  /* 切人格 */
  await ev('document.querySelectorAll("#persona-row button")[3].click()');
  ok('切换到「木」', await ev('document.querySelectorAll("#persona-row button.on").length === 1'));

  /* ---------- 5. 影子 ---------- */
  await ev('document.querySelector("#nav button[data-page=shadow]").click()');
  ok('影子默认关闭介绍页', await ev('!!document.getElementById("sh-start")'));
  await ev('document.getElementById("sh-start").click()');
  await ev('document.getElementById("sh-log").value = "嗯\\n哈哈好的\\n你吃饭了吗？\\n到啦~\\n嗯嗯知道啦\\n哈哈那也太搞笑了吧哈哈哈哈\\n早点睡哦~\\n好呀好呀\\n真的吗？\\n嗯呢"');
  await ev('document.getElementById("sh-go").click()');
  await waitCond('!!document.getElementById("sh-enter")', 8000, 'analyze done');
  ok('分析完成进入影子主页', true);
  const summary = await ev('document.querySelector("#page-shadow .card").textContent');
  ok('画像含口头禅分析', summary.indexOf('哈哈') > -1, summary.slice(0, 80));
  await ev('document.getElementById("sh-enter").click()');
  ok('进入影子对话', await ev('!!document.getElementById("s-input")'));
  await ev('sendShadow("我还是很想你")');
  await waitCond('document.querySelectorAll("#s-scroll .msg.me").length >= 1 && document.querySelectorAll("#s-scroll .msg.ai").length >= 2', 6000, 'shadow reply');
  ok('影子回复出现', true);
  const remain = await ev('document.getElementById("sh-remain").textContent');
  ok('20分钟倒计时显示', /^\d{1,2}:\d{2}$/.test(remain), remain);

  /* ---------- 6. 设置 ---------- */
  await ev('document.querySelector("#nav button[data-page=settings]").click()');
  ok('设置页渲染', await ev('!!document.getElementById("set-start") && document.querySelectorAll("#persona-grid button").length === 4'));

  /* ---------- 汇总 ---------- */
  console.log('\n--- JS RUNTIME ERRORS: ' + (errors.length ? errors.length : 'none') + ' ---');
  errors.slice(0, 5).forEach(e => console.log('ERR: ' + e.slice(0, 300)));
  const failed = results.filter(r => !r.pass).length;
  console.log('\nSUMMARY: ' + (results.length - failed) + '/' + results.length + ' passed' + (errors.length ? ' (+' + errors.length + ' js errors)' : ''));
  process.exit(failed || errors.length ? 1 : 0);
})().catch(e => {
  console.log('FATAL: ' + e.message);
  errors.slice(0, 5).forEach(x => console.log('ERR: ' + x));
  process.exit(1);
});
