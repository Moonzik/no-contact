# 留白 · 微信小程序（测试版）

「分手戒断期」小程序。从 `mvp/` 的纯前端单页原型迁移过来。

## 0 门槛跑起来（推荐先这么试）

1. 打开 [微信开发者工具](https://developers.weixin.qq.com/miniprogram/dev/devtools/download.html)（没装就先装）
2. 用你自己的微信扫码登录
3. 菜单 **项目 → 导入项目**
   - 项目目录：选 `miniprogram/` 文件夹（不是 zip，要先解压）
   - AppID：选 **「测试号」**（左下角小字那栏，无需注册）
   - 后端服务：**不勾选**「微信云开发」
4. 点 **导入** → 工具自动编译 → 直接看到「留白」启动页

> 测试号跑出来的体验跟正式 AppID 几乎一样，只是右上角带个"测试号"水印、不能被别人扫码打开。这正好用来给团队 / 朋友看效果。

## 如果你想发给别人扫码体验

测试号做不到——必须用正式 AppID（要先去 [mp.weixin.qq.com](https://mp.weixin.qq.com) 注册个人号，30 分钟）。等 AppID 拿到，把它粘到 `project.config.json` 里的 `appid` 字段，然后工具会提示「已是正式 AppID」，再点 **预览** 即可扫码。

---

```
miniprogram/
├── app.js / app.json / app.wxss      # 全局入口、tabBar、主题样式
├── project.config.json                # 微信开发者工具项目配置
├── sitemap.json
├── images/                            # 小程序图标、智能体头像
│   ├── appicon.png
│   └── agent.png
├── utils/                             # 纯 JS，可独立 Node 测试
│   ├── storage.js                     # 状态 + 持久化（封装 wx.setStorageSync）
│   ├── util.js                        # todayStr / dayNum / fmtDate / pick / fmtRemain
│   ├── guardian.js                    # 守护者小白：4 人格 + 11 类意图 + 规则回复
│   ├── shadow.js                      # 影子：聊天记录分析 + 短句回复
│   └── wechat.js                      # 微信聊天记录多格式解析（BOM / UTF-16LE / UTF-16BE）
└── pages/                             # 4 个 tabBar 页面 + 2 个子页面
    ├── onboard/                       # 引导：选择戒断日 + ta 代号 + 介绍小白
    ├── today/                         # 今天：戒断天数 + 打卡 + 里程碑 + 留白瓶入口
    ├── xiaobai/                       # 守护者：4 人格 + 聊天 + 危机干预
    ├── yingzi/                        # 影子：导入聊天记录 + 画像 + 限时对话
    ├── me/                            # 我：人格 / 戒断 / 数据 / 关于
    └── bottle/                        # 留白瓶（today 子页面，写入与查看）
```

## 在微信开发者工具中运行

1. 打开「微信开发者工具」（https://developers.weixin.qq.com/miniprogram/dev/devtools/download.html）
2. 选择「导入项目」
3. 项目目录 = `no-contact/miniprogram`
4. AppID：留白点的「测试号」（游客模式）会自动生成可用的 AppID；正式版要在 [微信公众平台](https://mp.weixin.qq.com) 注册一个小程序并替换 `project.config.json` 里的 `appid`
5. 点击「导入」即可在模拟器里看到

> **注意**：上传聊天记录文件需 `wx.chooseMessageFile` API，它要求用户从「微信聊天文件」中选择。模拟器里可以本地文件模拟；真机必须确保是从微信对话里发的 `.txt` / `.html` 附件。

## 与 MVP 原型的对应关系

| MVP (HTML 单页) | 小程序版 |
| --- | --- |
| `index.html` 内 4 个 section | `pages/{today,xiaobai,yingzi,me}` |
| `index.html` 内 `#onboard` | `pages/onboard` |
| `index.html` 内留白瓶弹层 | `pages/bottle` 子页面 |
| `<script>` 内 PERSONAS / INTENT_KEYS 等 | `utils/guardian.js` |
| SHADOW_POOL / analyzeChat / shadowReply | `utils/shadow.js` |
| parseWeChatLog / decodeChatFile | `utils/wechat.js` |
| `localStorage` | `wx.setStorageSync` (封装在 `utils/storage.js`) |
| `FileReader` 读本地 txt | `wx.chooseMessageFile` + `wx.getFileSystemManager().readFile` |
| `<input type=date>` | `<picker mode="date">` |
| `<a download>` 下载 JSON | `wx.setClipboardData` 复制到剪贴板 |

## 数据流

- 单例全局状态：`wx.storage` 里只有一条 key `liubai_mvp_v1`，结构与 MVP 一致。
- `storage.load()` 自动补齐字段缺失，比对 `defaultState()` 后返回。
- 所有写入 `storage.save(S)`。
- 跨天检查：`app.js` 启动时挂一分钟轮询，发现 `lastCheckIn` 不是当天时通知 `today` 页刷新。

## 伦理边界

跟 MVP 完全一致：

- 不暗示「替代专业治疗」
- 检测到「想死/自残/不想活」等危机词时，弹出 24h 心理援助热线卡（400-161-9995）+ 北京危机研究中心（010-82951332）+ 120/110
- 影子默认关闭，使用时长限制：单次 20 分钟，每天 3 次

## 已知未完成

- `wx.chooseMessageFile` 在真机只能选微信聊天文件，模拟器会调出本地文件选择器；测试时建议从浏览器导出一份假的微信聊天 txt 文件。
- 没有做 LLM 接入：守护者和影子的回复都是规则模拟，正式版需要在小程序里走 `wx.request` 调 `https://你的后端/llm/chat`。
- 暂未配置云函数：所有数据都存在本机，换设备会丢；后续可加 `wx.cloud` 同步。

## 下一步

1. 注册小程序 AppID 并替换 `project.config.json`
2. 真机调试：在「小程序后台 → 开发管理 → 开发设置」加 AppID 的开发者微信号
3. 提审前在「小程序后台 → 设置 → 基本设置」备案

详细规划见根目录 `PRD.md`。
