// pages/bottle/bottle.js
const storage = require('../../utils/storage.js');
const util = require('../../utils/util.js');
const user = require('../../utils/user.js');
const cfg = require('../../utils/config.js');

/* 分享文案：中性，不出现断联 / 前任 / 失恋，避免替用户公开私事 */
const SHARE_TITLES = ['把时间留给自己', '今天也要好好过', '慢一点，也没关系'];
const SHARE_IMG = '/images/agent.png';

/* 封存年限：一年。留白瓶收的是「当时说不出口的话」，
   一年之后再看，多数人对这件事的态度已经变了——那时候打开才有意义。 */
const SEAL_YEARS = 1;

Page({
  data: {
    text: '',
    /* v0.9.11：原生 textarea 持有焦点时会忽略 value 更新，保存后用 wx:if 重建清空 */
    taAlive: true,
    items: [],          // 倒序：最新的在最上面
    total: 0,
    sealedCount: 0,
    /* v0.9.13 缺口二 · 仪式：封存 / 销毁 */
    sealOn: false,      // 写的时候是否直接封存
    sealHint: '',       // 「2027 年 9 月 11 日」——让用户看见一年后是哪天
    /* v0.9.13 缺口二 · 广告位 */
    adShow: false,
    adUnitId: ''
  },

  onShow() {
    /* v0.8.0：留白瓶可以看，只有「写」才要登录 */
    this.refresh();
    /* 广告位：utils/config.js 里的 AD_UNIT_ID 配了才渲染 */
    const adId = cfg.AD_UNIT_ID || '';
    this.setData({ adUnitId: adId, adShow: !!adId });
  },

  refresh() {
    const S = storage.load();
    const today = util.todayStr();
    let sealedCount = 0;

    /* 按写入顺序拿原始下标（_k），再倒序显示——封存 / 销毁要能精确指回原数组元素 */
    const items = S.bottle
      .map((b, idx) => {
        const sealed = !!b.openAt;
        const locked = sealed && String(b.openAt) > today;   // 日期等长字符串比较即日期比较
        if (sealed) sealedCount++;
        return {
          t: b.t,
          text: b.text,
          _k: idx,
          sealed: sealed,
          locked: locked,
          state: locked
            ? '封存中 · ' + util.mdd(b.openAt) + ' 打开'
            : (sealed ? '封存到期了，随时可以打开' : '')
        };
      })
      .reverse();

    this.setData({
      items: items,
      total: S.bottle.length,
      sealedCount: sealedCount,
      sealHint: util.mdd(util.addYears(today, SEAL_YEARS))
    });
  },

  onInput(e) {
    this.setData({ text: e.detail.value });
  },

  onToggleSeal() {
    this.setData({ sealOn: !this.data.sealOn });
  },

  /* 清空输入框：先清 data，再把 textarea 卸掉 100ms 后重建。
     直接 setData({text:''}) 对正在聚焦的原生 textarea 无效（字会留在框里），
     重建出来的组件才拿得到空值。小白 / 影子页同款处理。 */
  clearInputBox() {
    this._clearedAt = Date.now();
    this.setData({ text: '', taAlive: false });
    setTimeout(() => {
      this.setData({ taAlive: true });
    }, 100);
  },

  onSave() {
    if (user.requireLogin('往留白瓶里写东西需要登录一次。')) return;
    const v = (this.data.text || '').trim();
    if (!v) {
      wx.showToast({ title: '先写点什么吧', icon: 'none' });
      return;
    }
    const S = storage.load();
    const today = util.todayStr();
    const item = { t: today, text: v };
    if (this.data.sealOn) {
      /* 封存：记下封存时间与解锁日（界面先不给看不等于藏起来，是给自己留个体面） */
      item.sealedAt = Date.now();
      item.openAt = util.addYears(today, SEAL_YEARS);
    }
    S.bottle.push(item);
    storage.save(S);
    this.clearInputBox();
    this.setData({ sealOn: false });
    this.refresh();
    wx.showToast({
      title: item.openAt
        ? '封好了，' + util.mdd(item.openAt) + ' 再打开'
        : '已存好。它不会被发送',
      icon: 'none',
      duration: 2200
    });
  },

  /* 点一条：封存中的点了就提醒一下；正常的点开可以看全文（长文会被折叠） */
  onItemTap(e) {
    const k = this._key(e);
    if (k < 0) return;
    const b = storage.load().bottle[k];
    if (!b) return;
    if (this._isLocked(b)) {
      wx.showToast({ title: '封存中，' + util.mdd(b.openAt) + ' 才能打开', icon: 'none', duration: 2000 });
    }
  },

  /* 长按一条：封存 / 提前打开 / 销毁。
     刻意不做成常驻按钮——销毁这种事，越不容易误触越好。 */
  onItemAction(e) {
    const k = this._key(e);
    if (k < 0) return;
    const S = storage.load();
    const b = S.bottle[k];
    if (!b) return;

    const sealed = !!b.openAt;
    const locked = this._isLocked(b);
    const actions = sealed
      ? ['提前打开（还没到期）', '销毁这一句']
      : ['封存起来（' + SEAL_YEARS + ' 年后打开）', '现在就销毁'];

    if (typeof wx.showActionSheet !== 'function') return;
    wx.showActionSheet({
      itemList: actions,
      success: (r) => {
        if (r.tapIndex === 0) {
          if (sealed) this._openNow(k);
          else this._seal(k);
        } else if (r.tapIndex === 1) {
          this._burn(k);
        }
      },
      fail: () => { /* 用户取消 */ }
    });
  },

  _key(e) {
    const ds = e && e.currentTarget && e.currentTarget.dataset;
    const k = ds ? parseInt(ds.k, 10) : NaN;
    return isNaN(k) ? -1 : k;
  },

  _isLocked(b) {
    return !!(b && b.openAt) && String(b.openAt) > util.todayStr();
  },

  _seal(k) {
    const S = storage.load();
    if (!S.bottle[k]) return;
    const today = util.todayStr();
    S.bottle[k].sealedAt = Date.now();
    S.bottle[k].openAt = util.addYears(today, SEAL_YEARS);
    storage.save(S);
    this.refresh();
    wx.showToast({ title: util.mdd(S.bottle[k].openAt) + ' 再打开', icon: 'none', duration: 2200 });
  },

  _openNow(k) {
    wx.showModal({
      title: '现在就打开？',
      content: '还没到封的日子。提前打开就失去封存的意义了，确定吗？',
      confirmText: '打开',
      success: (r) => {
        if (!r.confirm) return;
        const S = storage.load();
        if (!S.bottle[k]) return;
        delete S.bottle[k].openAt;
        delete S.bottle[k].sealedAt;
        storage.save(S);
        this.refresh();
        wx.showToast({ title: '打开了', icon: 'none' });
      }
    });
  },

  _burn(k) {
    wx.showModal({
      title: '销毁这一句？',
      content: '这一句会从瓶子里消失，找不回来。留白瓶本来是写给自己的，销毁也是。',
      confirmText: '销毁',
      confirmColor: '#a5432e',
      success: (r) => {
        if (!r.confirm) return;
        const S = storage.load();
        S.bottle.splice(k, 1);
        storage.save(S);
        this.refresh();
        wx.showToast({ title: '烧掉了', icon: 'none' });
      }
    });
  },

  /* 广告位加载失败（没开通流量主 / 暂无填充）不打扰用户 */
  onAdError(e) {
    console.warn('[bottle] 广告位加载失败（多为流量主未开通或暂无广告填充）', e && e.detail);
  },

  /* 分享文案同首页：中性，不暴露用户在用断联日记（原因见 today.js 注释） */
  onShareAppMessage() {
    return {
      title: SHARE_TITLES[Math.floor(Math.random() * SHARE_TITLES.length)],
      path: '/pages/onboard/onboard',
      imageUrl: SHARE_IMG
    };
  }
});
