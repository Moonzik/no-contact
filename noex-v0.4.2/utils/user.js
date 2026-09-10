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

/* 是不是跑在开发者工具的模拟器里 */
function isDevtools() {
  try {
    if (typeof wx === 'undefined' || typeof wx.getSystemInfoSync !== 'function') return false;
    const info = wx.getSystemInfoSync();
    return !!(info && info.platform === 'devtools');
  } catch (e) {
    return false;
  }
}

/* button open-type="chooseAvatar" 需要基础库 2.21.2+，低版本点了没反应。
   v0.9.3：开发者工具模拟器里 chooseAvatar 也经常点了没反应（真机才生效），
   所以模拟器环境一律降级到「从相册选」——保证在工具里也一定能测通上传。 */
function avatarSupported() {
  if (isDevtools()) return false;
  return canUse('button.open-type.chooseAvatar');
}
/* input type="nickname" 同上，低版本只能手填 */
function nicknameSupported() { return canUse('input.type.nickname'); }
/* button open-type="getPhoneNumber" 能不能用，取决于两件事：
   1) 基础库支持 —— 这里是能力检测，能测出来；
   2) 主体必须是非个人（企业 / 个体工商户等）—— 这条运行时才知道，
      个人主体点了会直接 fail。v0.9.8 起主体已是个体工商户，可正常使用；
      万一仍失败，前端一律退回「手动填写」，不阻塞登录。 */
function phoneSupported() {
  return canUse('button.open-type.getPhoneNumber');
}

/**
 * 用 getPhoneNumber 拿到的 code 换真实手机号。
 * 必须走云函数（需要 appid + secret），没配就回调空，调用方提示手填。
 */
function fetchPhone(code, cb) {
  /* cb(phone, err)：phone 为空即失败，err 只用于开发者排查，不展示给用户 */
  const done = (p, err) => { if (typeof cb === 'function') cb(p || '', err || ''); };
  try {
    if (typeof wx === 'undefined' || !wx.cloud || typeof wx.cloud.callFunction !== 'function') {
      done('', 'wx.cloud 不可用（云开发未初始化？）');
      return;
    }
    wx.cloud.callFunction({
      name: 'noex-ai',
      data: { action: 'phone', code: code },
      success(res) {
        const r = res && res.result;
        if (r && r.phone) { done(r.phone); return; }
        done('', (r && r.error) || '云函数未返回手机号');
      },
      fail: (e) => {
        const msg = String((e && (e.errMsg || e.message)) || 'callFunction 失败');
        done('', msg.indexOf('not exist') > -1 || msg.indexOf('-501000') > -1
          ? '云函数 noex-ai 未部署' : msg);
      }
    });
  } catch (e) {
    done('', String((e && e.message) || e));
  }
}

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
  /* v0.9.7：失败不再静默——隐私指引未过审时相册接口也会被平台拦截，
     必须告诉用户原因，否则表现为「点了没反应」。 */
  const explain = (r) => {
    const msg = String((r && r.errMsg) || '');
    if (/privacy|Privacy|授权|auth/i.test(msg)) {
      try {
        wx.showToast({
          title: '隐私指引还没在后台生效，暂时选不了，过审后恢复',
          icon: 'none',
          duration: 3000
        });
      } catch (e2) { /* ignore */ }
    } else if (!/cancel/i.test(msg)) {
      try {
        wx.showToast({ title: '相册打不开，稍后再试', icon: 'none', duration: 2200 });
      } catch (e2) { /* ignore */ }
    }
    done('');
  };
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
        fail: explain
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
        fail: explain
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
  isDevtools,
  avatarSupported,
  nicknameSupported,
  phoneSupported,
  fetchPhone,
  userDir,
  saveAvatar,
  pickFromAlbum,
  removeFile,
  silentLogin,
  clearAvatar,
  cleanNick
};
