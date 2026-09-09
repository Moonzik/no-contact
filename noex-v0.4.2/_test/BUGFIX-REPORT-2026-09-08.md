# 🐛 Bug 排查报告 · v0.4.0 → v0.4.1

**日期**：2026-09-08
**范围**：v0.4.0 改动 + 全项目系统性静态审计（事件/资源/路由/key/孤儿页面/util 引用）
**结论**：两轮共发现 **2 个 P0、4 个 P1、7 个 P2**，已全部修复。
测试 **61 + 26 + 94 = 181 / 181** 通过，静态审计 **112 / 112** 通过。

> ⚠️ 第一轮结束后我说"修完了"，用户追问"你确定没问题了吗"，于是补做了第二轮——**又查出 4 个新 bug**，
> 其中「留白瓶页面没注册」会让核心功能入口在真机上直接报错。教训：只改新代码不够，必须做结构性审计。

---

## 一、第二轮补查（静态审计发现）

### 🔴 P0/P1 · 留白瓶页面根本没注册 → 三个入口全部报错

- **位置**：`app.json`
- **现象**：`pages/bottle/` 四个文件齐全，但**不在 `app.json` 的 `pages` 里** → 真机上点「留白瓶」直接 `navigateTo:fail page is not found`。
- **受影响入口**：今天页「留白瓶」按钮 ×2、洞察面板「把想说的话写进留白瓶」。
- **为什么测试没抓到**：e2e 只断言 `wxLog` 里有 nav 记录，不校验目标是否注册。
- **修复**：注册 `pages/bottle/bottle`；审计脚本新增「孤儿页面」+「跳转目标必须已注册」两项检查。

### 🟠 P1 · 聊天记录无上限增长 → 存满 1 MB 后**静默失效**

- **位置**：`utils/storage.js`
- **现象**：微信单个 storage key 上限 **1024 KB**。实测：2000 条 223 KB、5000 条 557 KB、**约 9000 条即超 1 MB** → `setStorageSync` 抛异常 → `save()` 里被 catch 掉只打了 log → **此后所有数据都存不进去，用户毫无察觉**。
- **修复**：加保险丝——`gMsgs` 超 2000 条自动裁剪（保留最新），写入失败再砍到 500 条重试一次。
- **回归**：wx-test 新增 3 条断言（裁剪生效 / 保留最新 / 其他字段不受影响）。

### 🟡 P2 · `wx:key` 错误 2 处

| 位置 | 问题 |
|---|---|
| `xiaobai.wxml` `wx:key="t"` | `fmtMsg()` 根本不返回 `t` 字段 → 所有项的 key 都是 undefined |
| `bottle.wxml` `wx:key="t"` | `t` 是**日期字符串**，同一天写两条瓶子就 key 冲突 |
- **修复**：两处都改为索引生成 `_k`。

### 🟡 P2 · xiaobai 连发消息同样会丢（同 yingzi 的闭包问题）

- 修复：`setTimeout` 回调内重新 `storage.load()`。顺带修掉 `onLoad` 里残留的旧 build 日志（`send-round-v2`）。

### 🟡 P2 · 危机词覆盖不足（安全项）

- 缺「跳楼 / 跳河 / 烧炭 / 吞药 / 活够了 / 想消失 / 活着没意思」等。
- 修复：补齐 10 个词。危机检测优先级正确（`crisis` 在 `INTENT_KEYS` 首位，已验证）。

---

## 二、第一轮发现的（已修）

### 🔴 P0 · 跨天打开影子页 = 用户数据全灭

- **位置**：`pages/yingzi/yingzi.js` → `utilShadowSessionsToday()`
- **现象**：只要 `sessionsDate` 不是今天（每天第一次进影子页必触发），代码会把 **shadow 子对象**当成整个状态存进 storage：
  ```js
  storage.save(sh);   // ← 存的是子对象！
  ```
- **后果**：根状态被 shadow 覆盖 → `onboarded / startDate / checkCount / gMsgs / bottle / exName` **全部丢失**，用户被踢回 onboarding，影子本身也重置。对断联打卡类产品等于「戒断天数清零」，是毁灭级的。
- **修复**：改为传入并保存整个 `S`。
- **回归**：e2e #12 —— 模拟跨天后 `onboarded/startDate/gMsgs/bottle/shadow.enabled` 全保留、`sessionsToday` 正常归零。

### 🟠 P1 · 「7 天未使用」洞察触发器是死的

- **位置**：`onEnterChat()`
- **现象**：`observation.lastUsedAt = now` 写在 `shouldReveal()` **之前**，检测时「未使用天数」永远是 0 → `no_use` 分支永远不触发。而它唯一的调用点就是这里。
- **修复**：① `onEnterChat` 把检测挪到重置 `lastUsedAt` 之前；② `refresh()` 里也加检测——用户 7 天没碰影子、重新打开影子 tab 时就温和弹出洞察（这才符合设计意图）。
- **回归**：e2e #13 —— 模拟 8 天未用 → `onShow` 即触发、原因 `no_use`、关闭后不重复弹。

### 🟠 P1 · 聊天中切 tab 再回来，会话丢失

- **位置**：`refresh()` 无条件 `setData({ mode: 'view' })`
- **现象**：20 分钟会话进行中切到别的 tab 再切回，`onShow → refresh` 把用户踢回 view 模式，聊天界面消失（`sessionStart` 还在跑，但界面没了）。
- **修复**：`refresh()` 开头判断 `mode === 'chat' && sessionStart > 0` → 直接 `renderChat()` 恢复现场。
- **回归**：e2e #14 —— 进 chat → `onShow` → 仍是 chat 且消息还在。

### 🟠 P1 · 影子聊天连发消息可能丢消息

- **位置**：`sendShadow()` 的 `setTimeout` 闭包
- **现象**：回复延迟 800–1700ms，闭包持有的是发送时刻的旧 `S` 快照。用户在占位期间连发第二条，两个回调各自 `push + save`，**后保存的覆盖先保存的**，丢一条消息。
- **修复**：回调内重新 `storage.load()` 取最新状态再写。

### 🟡 P2 · 已看过洞察后，手动按钮误报「还不到时候」

- **位置**：`onRevealManual()`
- **现象**：洞察触发并关闭后（`revealTriggered=true`），点「你用了这么久…有啥发现吗」会弹「还不到时候，继续用一段时间吧」——语义完全反了。
- **修复**：已触发过 → 直接重新打开面板（允许随时回看，洞察只自动弹一次的承诺不变）。
- **回归**：e2e #15。

### 🟡 P2 · 3 个页面的 `catchtap="noop"` 指向不存在的 handler

- **位置**：`yingzi.wxml`(×2) / `me.wxml`(×2) / `xiaobai.wxml`(×1)
- **现象**：弹窗内层用 `catchtap="noop"` 阻止冒泡，但 3 个页面的 Page 里都没有定义 `noop()` → 真机 Console 持续警告（catch 本身仍生效，功能不受影响）。
- **修复**：三个页面各补 `noop() {}`。

### 🟡 P2 · 聊天列表 `wx:key="t"` 时间戳重复

- **位置**：`yingzi.wxml`
- **现象**：开场 sys + ai 两条消息用同一个 `Date.now()`；快速连发也可能同毫秒 → key 重复，渲染警告 + 列表更新时可能错位。
- **修复**：改用页面级自增 `_k` 作为 key（`wx:key="_k"`），renderChat / sendShadow 全链路赋值。

### 🟡 P2 · integration 测试关键词集太窄（本次实际翻车）

- **位置**：`_test/integration-test.js`
- **现象**：24 条毒舌池中只有 2 条含窄关键词（`脑子|出息|…`）→ 单次命中 8%，30 次采样仍有 **~7% 概率全落空**——本次跑就失败了。e2e 用宽关键词集（命中 7 条）很稳。
- **修复**：同步为 e2e 的宽关键词集，连跑 5 次全过。

### 🟡 P2 · wx-test `spoil` 断言关键词漏 2 条（排查过程中实际翻车 4/10 次）

- **位置**：`_test/wx-test.js`
- **现象**：spoil 池 7 条尾巴里「只准想我 / 只能想我」2 条不在关键词集里 → 单次落空率 ~29%，连跑 10 次翻车 4 次。上次修 flaky 时新加的句子没同步进关键词集。
- **修复**：关键词集补全，覆盖全部 7 条 → 断言确定性通过，连跑 10 次全绿。

---

## 二、发现但不改（记录在案）

| 项 | 说明 | 建议 |
|---|---|---|
| `affinity_floor` 触发器不可达 | 需 34 天才满足，而 `long_term` 30 天就先触发 | 无害，当防御性代码保留；若想让它有意义，把 `AFFINITY_FLOOR_DAYS` 降到 ≤10 |
| `affinitySnapshot` / `recentMsgAvgLen` 字段闲置 | 声明了但从不更新 | 预留字段，不影响功能 |
| `shadowReply` 里 emoji 尾巴直接用 `Math.random` | 与 `rng` 参数不一致 | 仅测试可控性小问题，不影响线上 |

---

### 🟡 P2 · 三处「毒舌采样」断言共用窄关键词 → 反复 flaky（排查中又翻车 1 次）

- 24 条池里只有 2 条含窄关键词 → 单次 8%。三处断言（integration ×1、e2e ×2）之前只改了两处。
- **修复**：全部统一为宽关键词（命中 7 条）+ e2e 采样提到 60 次 → flake < 1e-9。连跑 10 次全绿。

---

## 三、测试结果（两轮修复后）

```
wx-test.js         61 / 61   ✓（+3 存储保险丝）  连跑 10 次稳定
integration-test   26 / 26   ✓                    连跑 5 次稳定
e2e-test.js        94 / 94   ✓（+18 回归）        连跑 10 次稳定
audit-static.js   112 / 112  ✓
───────────────────────────────
合计            181 项测试 + 112 项静态检查 全过

## 四、改动文件

```
app.json                  注册 pages/bottle/bottle（P0）
utils/storage.js          gMsgs 2000 条保险丝 + 写入失败重试
utils/guardian.js         危机词 +10
pages/yingzi/yingzi.js    P0 存档修复 + no_use 活化 + 会话恢复 + 闭包竞态 + 手动回看 + noop + _k
pages/yingzi/yingzi.wxml  wx:key="_k"
pages/xiaobai/xiaobai.js  闭包竞态 + _k + 旧 build 日志
pages/xiaobai/xiaobai.wxml wx:key="_k"
pages/bottle/bottle.js/js wx:key="_k"
pages/me/me.js            + noop()
_test/audit-static.js     新增静态审计脚本
_test/e2e-test.js         + 18 条回归
_test/wx-test.js          + 3 条存储保险丝；spoil 关键词补全
_test/integration-test.js 关键词集加宽
project.config.json       version 0.3.0 → 0.4.1
app.js                    0.4.0 → 0.4.1 (bugfix-sweep-v5)
```

## 五、仍然存在的已知风险（未改，需要你拍板）

| 风险 | 说明 | 建议 |
|---|---|---|
| 存档裁剪会丢最旧聊天 | 超过 2000 条自动丢最旧的（约 220 KB，远低于 1 MB 上限） | 已在「我 → 导出 JSON」提供备份；如想保留全部，需改成分页/多 key 存储 |
| 影子 session 计时在后台继续 | 切到别的 tab，20 分钟照走，到点弹结束弹窗 | 可接受；若要改，需在 onHide 暂停 |
| H5 网页版 `web/index.html` 未同步 | 它是独立 demo，不含 v0.4.x 任何改动 | 需要的话我可以同步或删掉 |
