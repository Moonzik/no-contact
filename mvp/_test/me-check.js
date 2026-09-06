const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const PORT = 9223;
const URL_BASE = 'http://127.0.0.1:7799';
const OUT = __dirname;

function sleep(ms){ return new Promise(r=>setTimeout(r,ms)); }
async function fetchJson(url){
  return new Promise((resolve,reject)=>{
    require('http').get(url,res=>{ let d=''; res.on('data',c=>d+=c); res.on('end',()=>resolve(JSON.parse(d))); }).on('error',reject);
  });
}

(async ()=>{
  const profileDir = path.join(OUT, '_edge_profile_me');
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
      onboarded:true, startDate:'2026-08-30', exName:'', lastCheckIn:'',
      checkCount:3, relapses:0, persona:'sharp',
      gMsgs:[], shadow:{enabled:false,name:'',profile:null,msgs:[],sessionsDate:'',sessionsToday:0,sessionStart:0},
      bottle:[]
    }));
  `;

  await send('Page.navigate', { url: URL_BASE+'/' });
  await sleep(1200);
  await send('Runtime.evaluate', { expression: init });
  await send('Page.navigate', { url: URL_BASE+'/' });
  await sleep(800);
  await send('Runtime.evaluate', { expression: `document.querySelector('[data-page="me"]').click();` });
  await sleep(800);

  // 截「我」页
  let shot = await send('Page.captureScreenshot', { format:'png' });
  fs.writeFileSync(path.join(OUT,'shot_me.png'), Buffer.from(shot.result.data,'base64'));
  console.log('shot_me ok');

  // 点齿轮
  await send('Runtime.evaluate', { expression: `document.querySelector('#me-gear').click();` });
  await sleep(400);
  shot = await send('Page.captureScreenshot', { format:'png' });
  fs.writeFileSync(path.join(OUT,'shot_me_gear.png'), Buffer.from(shot.result.data,'base64'));
  console.log('shot_me_gear ok');

  ws.close();
  child.kill();
  await sleep(300);
  process.exit(0);
})().catch(e=>{ console.error(e); process.exit(1); });
