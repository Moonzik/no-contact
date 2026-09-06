const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const PORT = 9222;
const URL_BASE = 'http://127.0.0.1:7799';
const OUT = __dirname;

function sleep(ms){ return new Promise(r=>setTimeout(r,ms)); }

async function fetchJson(url){
  return new Promise((resolve,reject)=>{
    require('http').get(url,res=>{
      let d=''; res.on('data',c=>d+=c); res.on('end',()=>resolve(JSON.parse(d)));
    }).on('error',reject);
  });
}

(async ()=>{
  // 1) 启动 edge
  const profileDir = path.join(OUT, '_edge_profile');
  fs.mkdirSync(profileDir, { recursive: true });
  const args = [
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${profileDir}`,
    '--headless=new',
    '--disable-gpu',
    '--no-sandbox',
    '--hide-scrollbars',
    '--window-size=414,896',
    '--no-proxy-server',
    '--proxy-bypass-list=*',
    'about:blank'
  ];
  const child = spawn(EDGE, args, { stdio:['ignore','pipe','pipe'] });
  child.stderr.on('data',d=>process.stderr.write('[edge] '+d));

  // 2) 等就绪
  let tabs = null;
  for (let i=0;i<30;i++){
    try{ tabs = await fetchJson(`http://127.0.0.1:${PORT}/json/list`); if(tabs.length) break; }catch(e){}
    await sleep(400);
  }
  if(!tabs||!tabs.length){ console.error('edge not ready'); child.kill(); process.exit(1); }

  // 3) 通过 CDP 连接
  const WebSocket = require('ws');
  const ws = new WebSocket(tabs[0].webSocketDebuggerUrl);
  let id = 0; const pend = {};
  ws.on('message', d=>{
    const m = JSON.parse(d);
    if(m.id && pend[m.id]){ pend[m.id](m); delete pend[m.id]; }
  });
  await new Promise((r,j)=>{ ws.once('open',r); ws.once('error',j); });
  function send(method, params={}){
    return new Promise((res,rej)=>{
      const _id = ++id; pend[_id]=res;
      ws.send(JSON.stringify({id:_id, method, params}));
      setTimeout(()=>{ if(pend[_id]){ delete pend[_id]; rej(new Error('timeout '+method)); } }, 30000);
    });
  }

  await send('Page.enable');
  await send('Runtime.enable');

  // 4) 注入 localStorage 跳过 onboard
  const init = `
    localStorage.setItem('liubai_mvp_v1', JSON.stringify({
      onboarded: true,
      startDate: '2026-08-30',
      exName: '',
      lastCheckIn: '',
      checkCount: 0,
      relapses: 0,
      persona: 'warm',
      gMsgs: [
        {role:'ai', text:'我是小白。这里说的话不会去任何地方——你可以不坚强，也可以说不清楚。今天，是第 7 天。'},
        {role:'me', text:'今天有点累'},
        {role:'ai', text:'嗯，我在。累的时候不需要解释为什么。'}
      ],
      shadow: { enabled:false, name:'', profile:null, msgs:[], sessionsDate:'', sessionsToday:0, sessionStart:0 },
      bottle: []
    }));
  `;

  // 5) 打开页面 → 注入 → 切到 guardian
  await send('Page.navigate', { url: URL_BASE+'/' });
  await sleep(1200);
  await send('Runtime.evaluate', { expression: init });
  await send('Page.navigate', { url: URL_BASE+'/' });
  await sleep(800);

  // 跳到 guardian 标签
  await send('Runtime.evaluate', { expression: "document.querySelector('[data-page=\"guardian\"]').click(); " });
  await sleep(500);

  // 截 guardian
  let shot = await send('Page.captureScreenshot', { format:'png' });
  fs.writeFileSync(path.join(OUT,'shot_guardian.png'), Buffer.from(shot.result.data,'base64'));
  console.log('shot_guardian ok');

  // 测一下 input 底部位置 vs nav 顶部位置
  let pos = await send('Runtime.evaluate', { expression: `
    (function(){
      var input = document.querySelector('#g-input').getBoundingClientRect();
      var nav = document.querySelector('#nav').getBoundingClientRect();
      var wrap = document.querySelector('#page-guardian .chat-wrap').getBoundingClientRect();
      var persona = document.querySelector('#persona-row').getBoundingClientRect();
      var body = document.body.getBoundingClientRect();
      return JSON.stringify({
        vh: window.innerHeight,
        input_bottom: input.bottom, input_top: input.top,
        nav_top: nav.top, nav_bottom: nav.bottom,
        wrap_bottom: wrap.bottom, wrap_top: wrap.top, wrap_height: wrap.height,
        persona_bottom: persona.bottom,
        body_height: body.height
      });
    })()
  `, returnByValue: true });
  console.log('guardian layout:', pos.result.value);

  // 切到 shadow chat 模式（先开启影子）
  await send('Runtime.evaluate', { expression: `
    S.shadow = { enabled:true, name:'那个人', profile:{count:50,avgLen:12,emojiLove:false,top:['嗯','哈哈'],qRate:0.1}, msgs:[{role:'ai',text:'……嗯。'},{role:'me',text:'还在吗'}], sessionsDate:'', sessionsToday:0, sessionStart: Date.now() };
    shadowMode='chat'; save();
    document.querySelector('[data-page=\"shadow\"]').click();
  ` });
  await sleep(700);

  shot = await send('Page.captureScreenshot', { format:'png' });
  fs.writeFileSync(path.join(OUT,'shot_shadow.png'), Buffer.from(shot.result.data,'base64'));
  console.log('shot_shadow ok');

  pos = await send('Runtime.evaluate', { expression: `
    (function(){
      var input = document.querySelector('#s-input').getBoundingClientRect();
      var nav = document.querySelector('#nav').getBoundingClientRect();
      return JSON.stringify({ vh: window.innerHeight, input_bottom: input.bottom, nav_top: nav.top });
    })()
  `, returnByValue: true });
  console.log('shadow layout:', pos.result.value);

  ws.close();
  child.kill();
  await sleep(300);
  process.exit(0);
})().catch(e=>{ console.error(e); process.exit(1); });
