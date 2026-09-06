const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const PORT = 9226;
const URL_BASE = 'http://127.0.0.1:7799';
const OUT = __dirname;

function sleep(ms){ return new Promise(r=>setTimeout(r,ms)); }
async function fetchJson(url){
  return new Promise((resolve,reject)=>{
    require('http').get(url,res=>{ let d=''; res.on('data',c=>d+=c); res.on('end',()=>resolve(JSON.parse(d))); }).on('error',reject);
  });
}

(async ()=>{
  const profileDir = path.join(OUT, '_edge_profile_chat3');
  fs.mkdirSync(profileDir, { recursive: true });
  const child = spawn(EDGE, [
    `--remote-debugging-port=${PORT}`, `--user-data-dir=${profileDir}`,
    '--headless=new', '--disable-gpu', '--no-sandbox', '--hide-scrollbars',
    '--window-size=414,896', '--no-proxy-server', '--proxy-bypass-list=*',
    'about:blank'
  ], { stdio:['ignore','pipe','pipe'] });
  child.stderr.on('data',d=>process.stderr.write('[edge] '+d));

  let tabs = null;
  for (let i=0;i<30;i++){
    try{ tabs = await fetchJson(`http://127.0.0.1:${PORT}/json/list`); if(tabs.length) break; }catch(e){}
    await sleep(400);
  }
  if(!tabs||!tabs.length){ console.error('edge not ready'); child.kill(); process.exit(1); }

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

  const init = `
    localStorage.setItem('liubai_mvp_v1', JSON.stringify({
      onboarded:true, startDate:'2026-08-30', exName:'', lastCheckIn:'2026-09-06',
      checkCount:7, relapses:0, persona:'warm',
      gMsgs:[
        {role:'ai', text:'我是小白。这里说的话不会去任何地方。', tip:'', t:Date.now()-60000},
        {role:'me', text:'想到 ta', tip:'', t:Date.now()-30000},
        {role:'ai', text:'那是很正常的。才刚开始，慢慢来。', tip:'', t:Date.now()-20000}
      ],
      shadow:{enabled:false,name:'',profile:null,msgs:[],sessionsDate:'',sessionsToday:0,sessionStart:0},
      bottle:[]
    }));
  `;
  await send('Page.navigate', { url: URL_BASE+'/' });
  await sleep(1200);
  await send('Runtime.evaluate', { expression: init });
  await send('Page.navigate', { url: URL_BASE+'/' });
  await sleep(800);
  await send('Runtime.evaluate', { expression: `document.querySelector('[data-page="guardian"]').click();` });
  await sleep(800);

  // 测 input/nav 位置
  let pos = await send('Runtime.evaluate', { expression: `
    (function(){
      var input = document.querySelector('#g-input').getBoundingClientRect();
      var nav = document.querySelector('#nav').getBoundingClientRect();
      var wrap = document.querySelector('#page-guardian .chat-wrap').getBoundingClientRect();
      var persona = document.querySelector('#persona-row').getBoundingClientRect();
      var chatHead = document.querySelector('.chat-head').getBoundingClientRect();
      var page = document.querySelector('#page-guardian.active').getBoundingClientRect();
      return JSON.stringify({
        vh: window.innerHeight,
        page_bottom: page.bottom, page_padding_bottom: getComputedStyle(document.querySelector('#page-guardian.active')).paddingBottom,
        chatHead_bottom: chatHead.bottom,
        persona_top: persona.top, persona_bottom: persona.bottom,
        wrap_top: wrap.top, wrap_bottom: wrap.bottom, wrap_height: wrap.height,
        input_top: input.top, input_bottom: input.bottom, input_height: input.height,
        nav_top: nav.top, nav_bottom: nav.bottom, nav_height: nav.height
      });
    })()
  `, returnByValue: true });
  console.log('LAYOUT:', JSON.stringify(pos, null, 2).slice(0, 500));

  // 截全屏
  let shot = await send('Page.captureScreenshot', { format:'png' });
  fs.writeFileSync(path.join(OUT,'shot_chat.png'), Buffer.from(shot.result.data,'base64'));
  console.log('shot_chat ok');

  ws.close();
  child.kill();
  await sleep(300);
  process.exit(0);
})().catch(e=>{ console.error(e); process.exit(1); });
