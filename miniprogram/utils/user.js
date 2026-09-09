// utils/user.js — 微信登录（头像昵称填写能力 + wx.login 静默凭证）
//
// 说明：本小程序没有服务器，做不了「code 换 openid」的账号体系。
// 这里的「微信登录」分两步，都是纯本地：
//   1) wx.login 拿到临时登录凭证 code → 只取成功与否，记录 loginAt（不外传，理由见下）
//   2) button open-type="chooseAvatar" + input type="nickname"
//      → 真正拿到微信头像和昵称，用户能直接看到
// 数据仍然全部只存在本机，和以前一样。
//
// v0.8.0 起：**不再有登录墙**。浏览（首页/看记录）随便看，
// 只有真正要「用功能」时才弹一次登录提醒（和别的小程序一样）。
// 登录入口唯一放在「我」页。

const AVATAR_PREFIX = 'noex_avatar_';
/* 自增序号：同一毫秒内连续换头像也不会撞文件名（撞了就不会删旧文件了） */
let avatarSeq = 0;

/* 登录入口 = 个人主页（唯一） */
const ME_PAGE = '/pages/me/me';

/* 是否已登录：有昵称或有头像都算（只勾了头像没填昵称也放行） */
function isLogged(S) {
  try {
    const st = S || require('./storage.js').load();
    return !!(st && st.user && (st.user.nick || st.user.avatar));
  } catch (e) {
    return false;
  }
}

/* 微信基础库能力检测：测试环境没有 canIUse，一律按"支持"走主路径 */
function canUse(what) {
  try {
    if (typeof wx === 'undefined' || typeof wx.canIUse !== 'function') return true;
    return !!wx.canIUse(what);
  } catch (e) {
    return true;
  }
}

/* button open-type="chooseAvatar" 需要基础库 2.21.2+，低版本点了没反应 */
function avatarSupported() { return canUse('button.open-type.chooseAvatar'); }
/* input type="nickname" 同上，低版本只能手填 */
function nicknameSupported() { return canUse('input.type.nickname'); }

/**
 * 软登录拦截：放在「真正要用的动作」里调用（发消息 / 打卡 / 写瓶子 / 导入 …）。
 * 未登录弹一次说明，用户点「去登录」才跳个人主页并自动展开登录卡。
 * @param {string=} tip 可选，说明这个动作为什么需要登录
 * @returns {boolean} true = 已拦截，调用方直接 return
 */
function requireLogin(tip) {
  if (isLogged()) return false;
  const content = tip
    ? tip
    : '登录后才能使用这个功能。头像和昵称只保存在你手机里，不会上传。';
  try {
    if (typeof wx !== 'undefined' && typeof wx.showModal === 'function') {
      wx.showModal({
        title: '需要登录',
        content: content,
        confirmText: '去登录',
        cancelText: '再看看',
        success: (r) => {
          if (r && r.confirm) goLogin();
        }
      });
      return true;
    }
  } catch (e) { /* 没有 showModal 就直接跳 */ }
  goLogin();
  return true;
}

/* 去个人主页并自动展开登录卡 */
function goLogin() {
  try {
    if (typeof getApp === 'function') {
      const app = getApp();
      if (app && app.globalData) app.globalData.autoOpenLogin = true;
    }
  } catch (e) { /* ignore */ }
  try {
    if (typeof wx !== 'undefined' && typeof wx.switchTab === 'function') {
      wx.switchTab({ url: ME_PAGE });
    }
  } catch (e) { /* ignore */ }
}

/** 从相册/拍照选一张当头像——chooseAvatar 不可用时的兜底路径 */
function pickFromAlbum(cb) {
  const done = (p) => { if (typeof cb === 'function') cb(p || ''); };
  try {
    if (typeof wx === 'undefined') { done(''); return; }
    if (typeof wx.chooseMedia === 'function') {
      wx.chooseMedia({
        count: 1,
        mediaType: ['image'],
        sizeType: ['compressed'],
        sourceType: ['album', 'camera'],
        success: (r) => {
          const f = r && r.tempFiles && r.tempFiles[0];
          done(f && f.tempFilePath);
        },
        fail: () => done('')
      });
      return;
    }
    if (typeof wx.chooseImage === 'function') {
      wx.chooseImage({
        count: 1,
        sizeType: ['compressed'],
        success: (r) => {
          const p = r && r.tempFilePaths && r.tempFilePaths[0];
          done(p);
        },
        fail: () => done('')
      });
      return;
    }
  } catch (e) { /* ignore */ }
  done('');
}

/* 微信给的是临时文件（wxfile://tmp_xxx），小程序重启后会被清掉。
   必须复制到 USER_DATA_PATH 才能长期显示。 */
function userDir() {
  try {
    return (typeof wx !== 'undefined' && wx.env && wx.env.USER_DATA_PATH) || '';
  } catch (e) {
    return '';
  }
}

function fsManager() {
  try {
    if (typeof wx === 'undefined' || typeof wx.getFileSystemManager !== 'function') return null;
    return wx.getFileSystemManager();
  } catch (e) {
    return null;
  }
}

/* 删除单个文件，失败静默（文件不存在也算成功） */
function removeFile(p) {
  if (!p) return;
  const fs = fsManager();
  if (!fs || typeof fs.unlink !== 'function') return;
  try {
    fs.unlink({ filePath: p, fail: () => {} });
  } catch (e) { /* ignore */ }
}

/* 把临时头像存到永久目录，回调返回最终可用的路径 */
function saveAvatar(tempPath, oldPath, cb) {
  const done = (finalPath) => { if (typeof cb === 'function') cb(finalPath || ''); };

  if (!tempPath) { done(''); return; }
  const dir = userDir();
  const fs = fsManager();

  /* 没有文件系统能力（非真机/测试环境）时，退回临时路径，保证 UI 不崩 */
  if (!dir || !fs || typeof fs.saveFile !== 'function') { done(tempPath); return; }

  const dest = dir + '/' + AVATAR_PREFIX + Date.now() + '_' + (++avatarSeq) + '.png';
  try {
    fs.saveFile({
      tempFilePath: tempPath,
      filePath: dest,
      success: () => {
        if (oldPath && oldPath !== dest) removeFile(oldPath);
        done(dest);
      },
      fail: () => { done(tempPath); }
    });
  } catch (e) {
    done(tempPath);
  }
}

/* wx.login：只用来确认「这是微信环境 + 用户已授权登录态」。
   code 有效期 5 分钟，存着没有意义（还会误导），所以只记时间戳。
   将来接了服务器，把 code 传给后端换 openid 即可，改这里一处。 */
function silentLogin(cb) {
  const done = (ok) => { if (typeof cb === 'function') cb(!!ok); };
  try {
    if (typeof wx === 'undefined' || typeof wx.login !== 'function') { done(false); return; }
    wx.login({
      timeout: 8000,
      success: (r) => { done(r && r.code); },
      fail: () => { done(false); }
    });
  } catch (e) {
    done(false);
  }
}

/* 退出登录：清掉头像文件 */
function clearAvatar(avatarPath) {
  removeFile(avatarPath);
}

/* 昵称清洗：去首尾空格、限长，避免空昵称 / 超长昵称把排版撑坏 */
function cleanNick(n) {
  const s = (n || '').toString().replace(/\s+/g, ' ').trim();
  return s.slice(0, 16);
}

module.exports = {
  AVATAR_PREFIX,
  ME_PAGE,
  isLogged,
  requireLogin,
  goLogin,
  canUse,
  avatarSupported,
  nicknameSupported,
  userDir,
  saveAvatar,
  pickFromAlbum,
  removeFile,
  silentLogin,
  clearAvatar,
  cleanNick
};
