// utils/wechat.js — 微信聊天记录解析（小程序版）
// 说明：小程序没有 document，所以不在前端做 HTML 节点清洗；
// 用户若选了 .html 文件，会先 raw 读取，再用宽松正则去除简单标签后 parseWeChatLog。

/**
 * 把 ArrayBuffer 解码为字符串。
 * 支持：UTF-16 LE/BE（带 BOM），UTF-8（带 BOM 或无 BOM 启发式）
 */
function decodeChatFile(buf) {
  const u8 = new Uint8Array(buf);
  if (u8.length >= 2 && u8[0] === 0xFF && u8[1] === 0xFE) {
    // UTF-16 LE with BOM
    return decodeUtf16(buf, 'LE');
  }
  if (u8.length >= 2 && u8[0] === 0xFE && u8[1] === 0xFF) {
    // UTF-16 BE with BOM
    return decodeUtf16(buf, 'BE');
  }
  if (
    u8.length >= 3 &&
    u8[0] === 0xEF &&
    u8[1] === 0xBB &&
    u8[2] === 0xBF
  ) {
    // UTF-8 with BOM
    return decodeUtf8FromU8(u8, 3);
  }
  // 无 BOM 启发式：偶数位置大量 0 → 疑似 UTF-16 LE 中文
  let z = 0;
  const n = Math.min(u8.length, 400);
  for (let i = 1; i < n; i += 2) {
    if (u8[i] === 0) z++;
  }
  if (n > 40 && z > n / 4) {
    return decodeUtf16(buf, 'LE');
  }
  return decodeUtf8FromU8(u8, 0);
}

function decodeUtf8FromU8(u8, start) {
  // 用 wx.TextDecoder 兼容环境，否则手动解码
  if (typeof TextDecoder !== 'undefined') {
    try {
      return new TextDecoder('utf-8').decode(u8.slice(start));
    } catch (e) {}
  }
  // 退路：使用 decodeURIComponent 把 latin1 安全编码后解码
  let str = '';
  for (let i = start; i < u8.length; i++) str += String.fromCharCode(u8[i]);
  try { return decodeURIComponent(escape(str)); } catch (e) { return str; }
}

function decodeUtf16(buf, endian) {
  const u8 = new Uint8Array(buf);
  let off = 2; // skip BOM
  const step = 2;
  let str = '';
  for (let i = off; i + 1 < u8.length; i += step) {
    const a = u8[i], b = u8[i + 1];
    const code = endian === 'LE' ? (b << 8) | a : (a << 8) | b;
    str += String.fromCharCode(code);
  }
  return str;
}

/**
 * 极简 HTML 转纯文本（小程序无 document 时的退化方案）
 * 保留换行语义，去掉 <script>/<style>。
 */
function wechatHtmlToText(html) {
  let h = html;
  h = h.replace(/<script[\s\S]*?<\/script>/gi, ' ');
  h = h.replace(/<style[\s\S]*?<\/script>/gi, ' ');
  h = h.replace(/<style[\s\S]*?<\/style>/gi, ' ');
  h = h.replace(/<br\s*\/?>/gi, '\n');
  h = h.replace(/<\/(td|div|p|li|tr|h\d)>/gi, '\n');
  h = h.replace(/<[^>]+>/g, '\n');
  return h.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n');
}

/**
 * 解析微信导出的聊天记录文本。
 * 返回：
 *   { speakers: [...], byName: {name:[messages]}, cleaned: '全部消息拼接' }
 */
function parseWeChatLog(raw) {
  if (/<html|<body|<table|<div/i.test(raw.slice(0, 2000))) {
    raw = wechatHtmlToText(raw);
  }
  const lines = raw
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean);

  // 微信常见三种聊天记录头部
  const HEAD1 =
    /^(\d{4}[-\/.年]\d{1,2}[-\/.月]\d{1,2}日?)\s*(上午|下午|晚上|凌晨)?\s*(\d{1,2}:\d{2}(?::\d{2})?)\s*[，,]?\s*(.+)$/;
  const HEAD2 =
    /^(.+?)\s+(\d{4}[-\/.年]\d{1,2}[-\/.月]\d{1,2}日?)\s*(上午|下午|晚上|凌晨)?\s*(\d{1,2}:\d{2}(?::\d{2})?)$/;
  const DAYSEP = /^[—\-–=﹉~*·]{3,}\s*\d{4}|^[—\-–=﹉~*·]{3,}$/;

  const msgs = [];
  let cur = null;
  let found = false;

  for (const ln of lines) {
    if (DAYSEP.test(ln)) continue;
    if (/^(以上是|以下是|系统消息)/.test(ln)) continue;

    let m = ln.match(HEAD1);
    let name = null;
    if (m) name = m[4];
    else {
      m = ln.match(HEAD2);
      if (m) name = m[1];
    }

    if (name) {
      found = true;
      cur = { name: name.replace(/[:：]\s*$/, ''), text: '' };
      msgs.push(cur);
      continue;
    }

    if (/^\[[^\]]{1,10}\]$/.test(ln)) continue; // [图片][语音] 等
    if (cur) {
      cur.text += (cur.text ? '\n' : '') + ln;
    } else {
      msgs.push({ name: '', text: ln });
    }
  }

  if (!found) {
    return {
      speakers: [],
      byName: {},
      cleaned: lines.filter((l) => !DAYSEP.test(l)).join('\n')
    };
  }

  const byName = {};
  for (const m of msgs) {
    if (!m.name || !m.text) continue;
    (byName[m.name] = byName[m.name] || []).push(m.text);
  }
  const speakers = Object.keys(byName)
    .sort((a, b) => byName[b].length - byName[a].length);

  return {
    speakers,
    byName,
    cleaned: msgs
      .filter((m) => m.text)
      .map((m) => m.text)
      .join('\n')
  };
}

/**
 * 智能推荐"ta 是谁"：
 *  - 单人：就是 ta
 *  - 多人：优先排除"我"
 */
function defaultShadowSpeaker(r) {
  if (!r || r.speakers.length === 0) return null;
  if (r.speakers.length === 1) return r.speakers[0];
  const notMe = r.speakers.filter(
    (n) => !/^(我|自己|me)$/i.test(n)
  );
  if (notMe.length === 1) return notMe[0];
  return null;
}

module.exports = {
  decodeChatFile,
  wechatHtmlToText,
  parseWeChatLog,
  defaultShadowSpeaker
};
