// 云函数：noex-ai —— 小白 / 影子的 AI 回复中转
//
// 为什么走云函数而不是小程序直连：
//   1. API Key 放在这里，不会打进小程序包（直连的话，任何人反编译你的小程序都能拿到 Key）
//   2. wx.cloud.callFunction 走微信内部通道，**不需要在 mp 后台配 request 合法域名**，
//      也就不用买服务器、不用备案、不用搞 HTTPS 证书
//   3. 想换模型只改这里，小程序不用重新发版
//
// 零第三方依赖（用 Node 内置 https），部署时不用装包。
//
// 三个分支（按 event.action 分）：
//   （无）      小白 / 影子 的文字对话
//   'phone'     手机号解码（需要 NOEX_APPID / NOEX_APPSECRET）
//   'vision'    聊天截图转文字（v0.9.15，需要视觉模型，见 NOEX_AI_VISION_MODEL）
//
// 环境变量：
//   NOEX_AI_KEY         必填，大模型 Key
//   NOEX_AI_MODEL       选填，文字模型名（默认 deepseek-chat）
//   NOEX_AI_VISION_MODEL 选填，图片转写模型名（默认 deepseek-v4-flash-vision-exp）
//   ⚠️ 图片转写会花 20-40 秒，云函数「配置 → 超时时间」要设成 60 秒，否则会被掐断。

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
  /* v0.9.15 · 图片转写用的视觉模型。
     deepseek-chat / deepseek-v4-flash / deepseek-v4-pro 都是**纯文本**，喂图片会 400。
     能用图的只有带 vision 的那个型号（截止 2026-09 为 deepseek-v4-flash-vision-exp；
     2026-09-10 起 V4.1 Flash 也原生支持图片，别名 deepseek-flash，可作备选）。
     换名字不用改代码：云函数环境变量加 NOEX_AI_VISION_MODEL 即可。 */
  visionModel: 'deepseek-v4-flash-vision-exp',
  apiKey: '' // ← 直接填也行；更推荐在云函数「配置 → 环境变量」里加 NOEX_AI_KEY
};

function post(host, path, headers, body, timeoutMs) {
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
        timeout: timeoutMs || 20000
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

/* ── v0.9.15 · 聊天截图 → 文字（视觉模型）───────────────────
   为什么不让模型「理解」截图：影子要模仿的是 TA 真实的说话方式。
   模型在这里只要多写一句脑补的台词，用户后面调出来的影子就是假的，
   而且用户完全看不出来 —— 所以提示词把「不许编」放在第一条。
   转写格式定为「说话人：内容」，小程序端的解析器正好认这种写法。 */
const VISION_SYSTEM = [
  '你是一个聊天记录转写工具，只做转写，不做任何理解、总结或创作。',
  '硬性要求，必须全部遵守：',
  '1. 只转写图片里真实存在的文字。一个字都不许编造、不许补全、不许润色。',
  '2. 看不清的字用「□」代替；整条实在看不清就直接跳过。',
  '3. 每条消息占一行，格式固定为「说话人：内容」。',
  '4. 对方（左侧白色气泡）统一写作「对方」；自己（右侧绿色气泡）统一写作「我」。',
  '5. 如果图片里能看到对方的名字或备注，就直接用那个名字，别写「对方」。',
  '6. 不要输出时间戳、日期分隔线、「以下为新消息」这类系统文字。',
  '7. 图片、语音、表情、转账、红包等非文字消息，写成 [图片] [语音] [表情] [转账] [红包]。',
  '8. 不要输出任何解释、标题、序号说明、markdown 代码块，直接给转写结果。',
  '9. 如果整张图里没有可读的聊天文字，只回一句：没有识别到聊天内容。'
].join('\n');

function pickText(r) {
  const t = r && r.choices && r.choices[0] && r.choices[0].message && r.choices[0].message.content;
  return (t || '').trim();
}

/* 模型名兜底：deepseek-chat 这类旧名随时可能下线（官方已公告过一批），
   真下线时不该让整个 AI 功能变成哑巴。只在「看起来是模型名的问题」时换名重试一次。 */
const FALLBACK_MODEL = 'deepseek-flash';

function looksLikeModelErr(msg) {
  return /model|模型/i.test(String(msg || '')) &&
    !/does not support image|该模型不支持图片/i.test(String(msg || ''));
}

async function callChat(apiKey, model, messages, maxTokens, temperature, timeoutMs) {
  const body = {
    model: model,
    messages: messages,
    max_tokens: maxTokens,
    temperature: temperature
  };
  try {
    const r = await post(CONFIG.host, CONFIG.path, { Authorization: 'Bearer ' + apiKey }, body, timeoutMs);
    return { ok: true, text: pickText(r), model: model };
  } catch (e) {
    const msg = String((e && e.message) || e);
    if (looksLikeModelErr(msg) && model !== FALLBACK_MODEL) {
      try {
        const r2 = await post(
          CONFIG.host,
          CONFIG.path,
          { Authorization: 'Bearer ' + apiKey },
          Object.assign({}, body, { model: FALLBACK_MODEL }),
          timeoutMs
        );
        return { ok: true, text: pickText(r2), model: FALLBACK_MODEL };
      } catch (e2) {
        return { ok: false, error: String((e2 && e2.message) || e2).slice(0, 300) };
      }
    }
    return { ok: false, error: msg.slice(0, 300) };
  }
}

exports.main = async (event) => {
  /* 手机号分支：不需要 AI Key */
  if (event && event.action === 'phone') {
    return getPhone(event.code);
  }

  const apiKey = process.env.NOEX_AI_KEY || CONFIG.apiKey;
  if (!apiKey) {
    return { ok: false, error: 'NOEX_AI_KEY 未配置。请在云函数环境变量里配置，或填进 CONFIG.apiKey。', text: '' };
  }

  /* ── 图片转写分支（v0.9.15）───────────────────────────
     event.imageUrl 是小程序上传到云存储后换来的**临时链接**，
     视觉模型自己去下载，所以这里不需要把图片转 base64 塞进请求体。 */
  if (event && event.action === 'vision') {
    const url = String(event.imageUrl || '').trim();
    if (!/^https:\/\//i.test(url)) {
      return { ok: false, error: 'imageUrl 不合法（需要 https 临时链接）', text: '' };
    }
    const vModel = process.env.NOEX_AI_VISION_MODEL || CONFIG.visionModel;
    const r = await callChat(
      apiKey,
      vModel,
      [
        { role: 'system', content: VISION_SYSTEM },
        {
          role: 'user',
          content: [
            { type: 'text', text: '转写这张聊天截图。' },
            { type: 'image_url', image_url: { url: url } }
          ]
        }
      ],
      event.maxTokens || 1600,
      0.1,
      45000
    );
    if (r.ok) return { ok: true, text: r.text, model: r.model };
    /* 把「模型不支持图片」单独标出来，前端才好给出"去换视觉模型"的具体指引 */
    const notVision = /does not support image|不支持图片|vision/i.test(String(r.error || ''));
    return { ok: false, error: r.error, code: notVision ? 'not_vision_model' : 'vision_failed', text: '' };
  }

  const model = process.env.NOEX_AI_MODEL || CONFIG.model;
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

  const r = await callChat(
    apiKey,
    model,
    messages,
    event.maxTokens || 220,
    event.temperature == null ? 0.85 : event.temperature,
    20000
  );
  if (r.ok) return { ok: true, text: r.text, model: r.model };
  return { ok: false, error: r.error, text: '' };
};
