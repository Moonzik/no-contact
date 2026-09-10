// 云函数：noex-ai —— 小白 / 影子的 AI 回复中转
//
// 为什么走云函数而不是小程序直连：
//   1. API Key 放在这里，不会打进小程序包（直连的话，任何人反编译你的小程序都能拿到 Key）
//   2. wx.cloud.callFunction 走微信内部通道，**不需要在 mp 后台配 request 合法域名**，
//      也就不用买服务器、不用备案、不用搞 HTTPS 证书
//   3. 想换模型只改这里，小程序不用重新发版
//
// 零第三方依赖（用 Node 内置 https），部署时不用装包。

const https = require('https');

/* ── 配置：改这里 ─────────────────────────────────────────
   下面都是 OpenAI 兼容格式，换服务商只改 host / path / model 三行。
   常见选择：
     DeepSeek   host: api.deepseek.com    path: /chat/completions          model: deepseek-chat
     通义千问    host: dashscope.aliyuncs.com path: /compatible-mode/v1/chat/completions  model: qwen-plus
     智谱 GLM    host: open.bigmodel.cn    path: /api/paas/v4/chat/completions            model: glm-4-flash
     月之暗面    host: api.moonshot.cn     path: /v1/chat/completions                     model: moonshot-v1-8k
     硅基流动    host: api.siliconflow.cn  path: /v1/chat/completions                     model: Qwen/Qwen2.5-7B-Instruct
   ──────────────────────────────────────────────────────── */
const CONFIG = {
  host: 'api.deepseek.com',
  path: '/chat/completions',
  model: 'deepseek-chat',
  apiKey: '' // ← 直接填也行；更推荐在云函数「配置 → 环境变量」里加 NOEX_AI_KEY
};

function post(host, path, headers, body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const req = https.request(
      {
        hostname: host,
        path: path,
        method: 'POST',
        headers: Object.assign(
          {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(data)
          },
          headers
        ),
        timeout: 20000
      },
      (res) => {
        let buf = '';
        res.setEncoding('utf8');
        res.on('data', (c) => (buf += c));
        res.on('end', () => {
          if (res.statusCode >= 200 && res.statusCode < 300) {
            try { resolve(JSON.parse(buf)); } catch (e) { reject(new Error('bad json: ' + buf.slice(0, 200))); }
          } else {
            reject(new Error('HTTP ' + res.statusCode + ': ' + buf.slice(0, 300)));
          }
        });
      }
    );
    req.on('timeout', () => { req.destroy(new Error('upstream timeout')); });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

function get(host, path) {
  return new Promise((resolve, reject) => {
    const req = https.request(
      { hostname: host, path: path, method: 'GET', timeout: 15000 },
      (res) => {
        let buf = '';
        res.setEncoding('utf8');
        res.on('data', (c) => (buf += c));
        res.on('end', () => {
          try { resolve(JSON.parse(buf)); } catch (e) { reject(new Error('bad json: ' + buf.slice(0, 200))); }
        });
      }
    );
    req.on('timeout', () => req.destroy(new Error('upstream timeout')));
    req.on('error', reject);
    req.end();
  });
}

/* ── v0.9.8 · 手机号：把 getPhoneNumber 的 code 换成真实号码 ──
   前置条件：
   1) 小程序主体必须是**非个人**（企业 / 个体工商户等）。
      v0.9.8 起本项目主体已变更为个体工商户，条件满足。
   2) 云函数环境变量要配 NOEX_APPID、NOEX_APPSECRET
      （mp 后台 → 开发管理 → 开发设置 → AppSecret）。
   3) 该接口按次计费（有免费额度），用量见 mp 后台 → 付费管理。
   拿不到就返回空，前端会退回「手动填写」，手机号本身是选填项。 */
async function getPhone(code) {
  const appid = process.env.NOEX_APPID || '';
  const secret = process.env.NOEX_APPSECRET || '';
  if (!appid || !secret) return { ok: false, error: 'NOEX_APPID / NOEX_APPSECRET 未配置', phone: '' };
  try {
    const tok = await get(
      'api.weixin.qq.com',
      '/cgi-bin/token?grant_type=client_credential&appid=' + appid + '&secret=' + secret
    );
    const accessToken = tok && tok.access_token;
    if (!accessToken) return { ok: false, error: 'access_token 获取失败', phone: '' };
    const r = await post(
      'api.weixin.qq.com',
      '/wxa/business/getuserphonenumber?access_token=' + accessToken,
      {},
      { code: code }
    );
    const info = r && r.phone_info;
    if (info && info.phoneNumber) return { ok: true, phone: info.phoneNumber };
    return { ok: false, error: 'getuserphonenumber 失败: ' + JSON.stringify(r).slice(0, 200), phone: '' };
  } catch (e) {
    return { ok: false, error: String((e && e.message) || e).slice(0, 200), phone: '' };
  }
}

exports.main = async (event) => {
  /* 手机号分支：不需要 AI Key */
  if (event && event.action === 'phone') {
    return getPhone(event.code);
  }

  const apiKey = process.env.NOEX_AI_KEY || CONFIG.apiKey;
  const model = process.env.NOEX_AI_MODEL || CONFIG.model;

  if (!apiKey) {
    return { ok: false, error: 'NOEX_AI_KEY 未配置。请在云函数环境变量里配置，或填进 CONFIG.apiKey。', text: '' };
  }

  const messages = event.messages;
  if (!Array.isArray(messages) || !messages.length) {
    return { ok: false, error: 'messages 为空', text: '' };
  }

  /* 安全兜底：即便前端漏判，这里也不让危机相关内容走模型 */
  const lastUser = messages.filter((m) => m.role === 'user').pop();
  const danger = ['不想活', '自杀', '自残', '跳楼', '吞药', '割腕', '结束生命'];
  if (lastUser && danger.some((w) => String(lastUser.content).indexOf(w) > -1)) {
    return { ok: false, error: 'crisis', text: '' };
  }

  try {
    const r = await post(
      CONFIG.host,
      CONFIG.path,
      { Authorization: 'Bearer ' + apiKey },
      {
        model: model,
        messages: messages,
        max_tokens: event.maxTokens || 220,
        temperature: event.temperature == null ? 0.85 : event.temperature
      }
    );
    const text =
      r && r.choices && r.choices[0] && r.choices[0].message && r.choices[0].message.content;
    return { ok: true, text: (text || '').trim() };
  } catch (e) {
    return { ok: false, error: String((e && e.message) || e).slice(0, 300), text: '' };
  }
};
