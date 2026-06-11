---
title: 已知问题 / Bug 临时记录
type: doc
status: active
owner: Claude
created: 2026-05-30
updated: 2026-06-02
tags: [bug, ops, openai, sentry, frontend]
---

# 已知问题 / Bug 临时记录

> ⚠️ **临时家**:Admin Bug 模块(需 DB schema,待与费对齐,见 vision)建好后,这里的条目迁入 Admin。
> 来源:Sentry(前端)/ Supabase `generation_logs`(后端 AI 失败)/ Worker logs。

---

## BUG-001 · OpenAI 出口区域路由失败(storyboard_image)

- **状态**:🟡 间歇性 · 近期未复发(2026-06-02 清查降级)
- **影响**:5/22~5/28 共 29 次失败 / 5 用户。**清查(2026-06-02):5/28 之后连续 5 天(5/29~6/02)0 复发** → 不再"持续中"。属**间歇性**(CF 出口节点偶发命中 OpenAI 区域黑名单),可能再现。
- **当前结论**:未在烧,降为观察。下方"修法方向"(区域固定 / 备用 vendor)仍是值得做的加固,但不紧急;若再次成片复发再优先。
- **现象**:`storyboard_image` 走 OpenAI,报 `unsupported_country_region_territory` 403 / "OpenAI 在当前地区不可用",自动重试 3 次仍失败 → 用户分镜图生成失败
- **根因**:Cloudflare Workers 出口节点跨地区调度,**有时命中 OpenAI 的区域黑名单**(命中不支持的出口 IP)
- **数据源**:`public.generation_logs` WHERE `status='failed' AND vendor='openai' AND generation_type='storyboard_image'`
- **修法方向**(待 Claude 深挖确认):给 OpenAI 调用固定走允许区域 —— CF Workers `cf: { resolveOverride }` / 区域绑定 / 中转代理;或失败后换备用 vendor(gemini storyboard)。涉及 `public/_worker.js` 边缘代理逻辑 → **改前与费对齐**(高危区)。
- **录入**:2026-05-30 由 Claude 从 generation_logs 发现并记录,已提醒 Leon。

---

## Sentry 前端 triage · 2026-05-31(首轮)

接入 Sentry 只读 API(org `ughf-technology-inc` / project `javascript-react`)后,拉近 14 天未解决 issue 25 条逐个核对当前 main 源码。**总量约 600 个事件,其中 ~95% 是噪音/陈旧构建,只有 2 条是真·当前 bug。**

### 分类

| 家族 | 事件量 | 性质 | 处理 |
|---|---|---|---|
| **Supabase Web Locks**(`Lock "...auth-token" was released` / `'steal'`)| ~222 | 库级噪音:多 tab / 页面隐藏时 token 锁竞争,auth 仍成功 | ✅ 已加入 `ignoreErrors` 静音 |
| **React removeChild/insertBefore NotFoundError** | ~194 | DOM reconciliation vs 外部篡改(浏览器翻译 / 插件 / QQ 浏览器内核),userCount=0 | ✅ 已静音(见下方 caveat)|
| **陈旧构建**(`ReferenceError: X is not defined` + chunk `MIME`/`module script failed`)| ~110 | 用户缓存了旧 bundle:`profileTab`/`PROFILE_TABS`/`slideCls`/`RECAST_ENABLED`/`ratioMenuRef` 等符号当前 main **已全部不存在**;chunk hash 404 → 返回 HTML | ✅ chunk 类静音(main.jsx 已自动重载);ReferenceError 类**不按消息静音**(怕挡未来真错)→ 靠 source map + release 归组,见「需费配合」|
| **真·当前 bug** | ~73 | 见 BUG-002 / BUG-003 | 🔴 待查 |

### 已落地降噪(`src/sentry.js` `ignoreErrors`,纯前端)

补齐了之前漏掉的变体:`Lock "...auth-token" was released`、`Importing a module script failed`、`is not a valid JavaScript MIME type`、removeChild/insertBefore 系列、`DataCloneError`。
> ⚠️ **removeChild/insertBefore 的 caveat**:这批按经验是浏览器翻译噪音才静音。若哪天某页面**肉眼可见地崩**(不只是 Sentry 吵),把对应 regex 临时去掉重新观察,排查真的 reconciliation 回归。

---

## BUG-002 · RangeError: Maximum call stack size exceeded(/discover/browse)

- **状态**:🟡 OPEN · 低频 + 已止损(2026-06-03;根治待 iOS 真机抓栈)
- **影响**:~70 次,几乎全是 **iOS(Chrome Mobile iOS / WebKit,iOS 26.x)** 在 **/discover**;**lastSeen 2026-06-03**(清查当天又烧)。
- **现象**:`/discover` 页 `Maximum call stack size exceeded`(栈溢出,疑似某处无限递归 / 同步重入)。
- **2026-06-03 清查结论**:线上 bundle(`index-Bu-MaIHO.js`)**确认带 debug-id、source map 生效**;但**爆栈类错误堆栈天然退化**(Sentry 捕到的帧是 `undefined:38`,栈已溢出浏览器给不出有意义调用链)→ **source map 无对象可符号化,读不出代码行**。breadcrumbs 仅显示 /discover 正常 feed 加载(Supabase 查询 + 一批 videodelivery 缩略图/视频 fetch + version.json 轮询),无明显递归触发点。
- **频率(2026-06-03 全量 70 事件按天)**:**低频涓流**,均值 ~2.5 次/天、峰值 7~8/天,**从不是大爆发**;最近更安静(6/01、6/02 各 0,6/03 仅 1)。`userCount:0`(量小)。→ **慢性低频 iOS 边缘 case,不紧急**。
- **代码审查(2026-06-03)**:扫了 feed + 播放器路径,**未发现**经典 iOS 爆栈模式(大数组 `...` 展开仅在 admin/小数组;shuffle 迭代;无 `.apply(大数组)`;无明显自递归)。所有事件堆栈退化(`undefined:31/38`,无文件名)→ **遥测无法定位**。
- **✅ 止损已加(2026-06-03)**:discover browse feed 单独包了一层 `ErrorBoundary`(`index.jsx`,fallback 局部"重试" UI)。iOS 偶发栈溢出在此子树崩时**只局部降级 + 重试**(间歇性,重试常能成功),不再触发整页白屏。`ErrorBoundary` 加了可选 `fallback`/`reset`(向后兼容)。
- **根治待**:需 **iOS Safari + Mac Web Inspector 真机抓真实 WebKit 栈**(唯一能拿到带文件行号的栈的办法;桌面 Chrome 栈大复现不出)。拿到栈再修。当前频率低 + 已止损 → 不急。

## BUG-003 · NotSupportedError: 媒体元素无可用源(/create/short)

- **状态**:✅ 2026-05-31 已修(`src/pages/StoryGeneratorPage.jsx`)
- **影响**:近 14 天 **5 次**,Chrome desktop
- **现象**:`/create/short` preview `<video>` 播完后点 Replay → `The element has no supported sources`
- **根因**:Replay 用 `document.querySelector('video')` 抓「页面第一个 video」,多 video 时抓错(无源)元素;`v.play()` promise 被拒后没 `.catch()` → 未捕获 rejection 上报 Sentry。
- **修法**:① preview video 加专属 `previewVideoRef`,Replay 改用 ref;② 仅 `v.currentSrc` 有效时 replay 且 `play()` 加 `.catch()`;③ video 加 `onError` 兜底。纯前端。

## BUG-004 · 个人主页媒体点击不能播放(SelfProfilePage / UserProfilePage)

- **状态**:✅ 2026-06-01 已修(`index.jsx`)
- **来源**:甲方反馈
- **现象**:用户个人主页(自己 / `/u/:userId`)瀑布流媒体点击后无任何反应,进不了播放页
- **根因**:两处 `onPlay={(item) => setLightboxItem(item)}` 接的是 round-102 已掏空的 `LightboxPlayer` stub(`return null`)→ 点了没播放器。与 round-106 搜索结果 bug 同源(同一个废弃 stub)。
- **修法**:两个主页 onPlay 统一改用 round-106 同款 —— series → `/series/:realId`(paywall 页),否则 `openImmerse(item.id)` 开 SparkMode 沉浸态。纯前端。
- **2026-06-01 全仓审计(同源 stub)** —— 排查所有 `setLightboxItem(<具体 item>)` 入口,又发现并修:
  - ✅ **SeriesTreeOverlay 节点点击**(`index.jsx` L1741):沉浸态点剧集树图标 → overlay → 点节点 → 原 `setLightboxItem` 死 stub。节点是 `recommended_content` 行,改 `setActiveSeriesTree(null) + openImmerse(node.id)`。**活的真 bug,已修。**
  - ✅ **主 MasonryGrid 非-discover 兜底**(`index.jsx` L1527):`else { setLightboxItem(item) }` 改 `openImmerse(item.id)`(防御性,防任何挂此 grid 的 section 点击不播)。
  - ✅ **GridPlayer + Lightbox(整套旧播放器模型)死代码 = 2026-06-02 已清理**。背景:GridPlayer(迷你浮窗)+ Lightbox(全屏)是 SparkMode 沉浸态之前的旧模型,「频道页」概念 2026-04-23 已下线;GridPlayer 唯一渲染点的条件早已把当前全部 8 个 section 排除(条件恒假),`LightboxPlayer.jsx` 自 round-102 起也只是 `return null` stub。本次纯前端清理:删 `src/components/GridPlayer.jsx` + `src/components/LightboxPlayer.jsx` 两个文件;删 `index.jsx` 内 `lightboxItem`/`gridPlayerItem` state、`switchToGridView`/`switchToLightboxView`、两个播放器渲染块、`NO_PLAYER_SECTIONS` 兜底 effect、各处 prev/next 计算;并清理 MasonryGrid/SelfProfilePage/UserProfilePage 里随之失效的 `onCardHover` 插桩。`openImmerse → /discover/s/:id → SparkMode` 仍是全站唯一播放路径,未受影响。`npm run build` 绿,无用户影响。

## BUG-005 · 瀑布流某 card 只有底色、无视频且点击不能播(CF Stream 424)

- **状态**:✅ 2026-06-02 已处理(坏视频已下架 + 前端兜底已加)
- **来源**:甲方反馈(2026-06-02)
- **现象**:Discover 瀑布流里某张 card 不显示视频/缩略图、只有底色,点击进沉浸态也无法播放。
- **定位**:出问题的是 feed 条目 **"Ashes on My Shoes"**
  - `recommended_content.id` = `22adb06c-67c3-46f7-bf8c-c8df0dc359af`
  - `video` = `https://iframe.cloudflarestream.com/f5e924b140f31a288bb6e4e538e76d4f`(CF Stream UID `f5e924b140f31a288bb6e4e538e76d4f`)
  - `published=true`,`createdAt` 2026-05-28
- **根因**:该 Stream 视频在 Cloudflare 侧**整个不可用** —— 缩略图 `…/thumbnails/thumbnail.jpg` 与 HLS manifest `…/manifest/video.m3u8` **均返回 424 Failed Dependency**。DB 行仍 `published=true` → 照常进 feed,但前端拿不到缩略图(只剩底色)也拿不到 manifest(点了播不了)。
- **状态判定(2026-06-02 实测)**:**编码失败 / error 态**(最可能),**不是"已删"也不是"还在处理"**。依据:① 424 ≠ 404 → UID 在 CF Stream 仍存在(已删会 404);② 创建于 2026-05-28(~5 天前),而 CF Stream 编码仅需几分钟 → 不可能还卡在 processing(早该超时转 error)。100% 权威态需查 CF Stream Dashboard(搜该 UID 看 `status.state` + `errorReasonCode`)或 Stream API,但证据已足够指向 error。
- **全 feed 扫描结果(2026-06-02)**:用浏览器 fetch 探活了**全部 437 个已发布 Stream 视频的 manifest**,**只有这 1 个 424,其余 436 个全部 200 正常 —— feed 里没有其它 Stream 孤儿。**(注:本机/沙箱 DNS 解析不了 `videodelivery.net`,curl 探活全 000;改用真实浏览器 fetch 才探通,CF Stream manifest 带 CORS 可读 status。)
- **(噪音排除)**:同时打印的 `beforeinstallpromptevent.preventDefault()`(PWA 安装横幅)、`cdn-cgi/rum ERR_CONNECTION_CLOSED`(CF RUM 监控 beacon)与本 bug **无关**,可忽略。
- **处理(两层,均已完成 2026-06-02)**:
  1. ✅ **数据层下架**:确认是编码失败(见"状态判定")。已 `UPDATE recommended_content SET published=false WHERE id='22adb06c…'`(**下架,可逆,未硬删数据**)→ 移出 feed。全 feed 已扫,仅此 1 条孤儿,无需批量清理。
  2. ✅ **前端兜底**(`MasonryGrid.jsx`):卡片封面/缩略图 `onError` → 记 `coverErrors[id]` → 占位层显示 **"视频不可用"**(FilmSlate 图标 + 文字),不再只剩神秘底色;video 元数据加载成功(`onLoadedMetadata`)时清掉该标记,避免"封面挂了但视频其实能播"的误判。今后再出现 Stream 424 孤儿,用户会看到明确不可用提示而非空白彩色块。

## BUG-006 · Quick Mode「Next: Summon AI」→ AI 编剧请求超时(MemFireDB 边缘函数)

- **状态**:🟢 根治方案已实现(2026-06-05,本地 WIP 待合并 + 真机验证)· **彻底删除 memfire 路径 → 不再依赖费的后端**。旧"等费修"路线作废。
- **来源**:甲方反馈(2026-06-04)
- **现象**:`/create/short` Quick Mode → Choose your visual style → 点 **「Next: Summon AI」** 报错:`POST https://functions5.memfiredb.com/d6vussgg91hj59690tv0/aiscreenwriter net::ERR_TIMED_OUT` / `TypeError: Failed to fetch`。
- **定位**:`src/api/neoaiService.js` `generateNeoAIScript()`(L327)→ fetch **MemFireDB 边缘函数 `aiscreenwriter`**(legacy AI 编剧,单段视频走这条;多段走 worker)。`MEMFIRE_FN_BASE = functions5.memfiredb.com/d6vussgg91hj59690tv0`。
- **根因**:该 **MemFireDB `aiscreenwriter` 边缘函数超时/不可达**(后端/基建)。memfiredb 是国内 BaaS,可能函数 down / 冷启动慢 / 跨区网络路径超时。**属费的后端域,前端改不了根因。**
- **(前端缺陷)**:`generateNeoAIScript` 的 fetch **没有超时控制**(裸 `await fetch`,无 `AbortController`)→ 服务慢时会 hang 到浏览器默认网络超时(~分钟级)才抛 raw `Failed to fetch`,体验差。
- **修法(两层)**:
  1. **后端(费)**:查 memfiredb `aiscreenwriter` 函数健康 / 冷启动 / 网络路径;考虑迁到自家 worker 代理或加备用 vendor(跟 BUG-001 类似的"国内出口/第三方依赖不稳"问题)。
  2. ✅ **前端止损已加(2026-06-04,`neoaiService.js`)**:`generateNeoAIScript` 加了 30s `AbortController` 超时 → 超时/连不上时**快速失败 + 抛中文友好错**("AI 编剧服务响应超时(30 秒),请重试" / "连接 AI 编剧服务失败…"),由 `handleGenerateScript` 的 `alert(formatError(...))` 展示给用户,并回退到 step 2 → 用户再点「Next: Summon AI」即重试。不再干等几分钟到 raw `Failed to fetch`。**根因(memfire 函数稳定性)仍待费查。**
- **2026-06-04 后端**:Leon 已 call 费排查 memfire `aiscreenwriter` 函数。
- **✅ 2026-06-05 前端死循环修复**:超时反复触发时,step 3 脚本步**卡空白 / 死循环**(三元末尾 `: null` —— 失败后 `!isGeneratingScript && !generatedScript` 渲染空白,无 Retry/返回;原 catch 用 blocking alert + 回弹 step2,每次重试又 30s 超时)。修:加 `scriptGenError` 状态,失败后**停在 step 3 渲染「Couldn't generate the script + 错误信息」卡**,提供 `[Edit prompt]` / `[Try again]` 受控操作,**不自动重跑**(避免后端持续超时时的死循环)。同源那张「空白卡」也一并修。**根因(memfire 超时)仍归费。**
- **✅ 2026-06-05 根治 —— 彻底删除 memfire 路径(本地 WIP,待合并 / 验证;⬆️ 上一条"仍归费"作废)**:不再"等费修后端",直接**移除 legacy aiscreenwriter / memfire 调用** —— `neoaiService.js` 删 `generateNeoAIScript` / `MEMFIRE_FN_BASE` / `getNeoAIAccessToken`;`StoryGeneratorPage.jsx` `handleGenerateScript` 单段/多段**统一走 worker `/api/generate-multi-segment-script`**(Gemini,prompt 全自控);`_worker.js` 补单段镜头密度 `SINGLE_SEG_SHOTS`(单段也拿全镜头量)。**UVERA 不再依赖任何第三方编剧后端 → BUG-006 根因消除,与费的 memfire 健康解耦。** 上一条的失败卡(`scriptGenError` + `[Try again]`)保留,兜底 worker 侧偶发失败。`npm run build` 绿。**注:合并 `feifeixp/main` 时此"删除"覆盖远端 `generateNeoAIScript` 的 30s 止损(函数已不存在);保留失败卡 + Seedance clamp(`3495f95`)。**

## BUG-007 · iPhone Safari 沉浸态:视频上下漏出相邻槽(分镜)图片

- **状态**:✅ 2026-06-04 已修复并验证(Leon 本机 Safari mobile + desktop 两端确认;规则统一)
- **来源**:费反馈(2026-06-04,默认沉浸页/mobile)
- **现象**:iPhone Safari 上,Discover 默认沉浸态(SparkMode)里,当前视频的**上方和下方各漏出一块相邻 feed item 的图片**(截图是某多段帖 prev/current/next 三槽同屏可见 —— 分镜图 + 视频 + 分镜图)。
- **根因**:移动沉浸态是 TikTok 式 **3 槽竖向轨道** `[prev, current, next]`(`SparkMode.jsx` L1271+),槽高 = `SH = screenH.current`(JS 测的屏高,`visualViewport.height`/`innerHeight`),轨道 `translateY(-SH)` 让中间槽=当前。容器是 `absolute top/bottom/left/right:0`(= 父 modal `fixed inset-0`,**含 iOS 工具栏背后区域**)。iOS Safari 动态地址栏/工具栏导致**实际可见视口 ≠ SH** → 当前视频槽没精确填满可见区 → 相邻槽从上/下露出。
- **已知**:`SparkMode.jsx` L592-594 注释明载"保持 screenH/trackY 与实际 viewport 同步…**Leon 2026-04-21 真机验证后反馈该 fix 未解决**" → **历史顽疾,改过一次没解**。
- **✏️ 根因修正(2026-06-04,Leon)**:不是相邻槽高度漏出,而是**封面/图片用了 `object-cover` 撑满视口高度**,没按适配标准(横屏图→适配视口宽、竖屏图→适配视口高)。
- **🔧 已修(2026-06-04,待 Leon 本机 Safari mobile 验证)**:
  - mobile 图片条目封面(`SparkMode.jsx` L1367)`objectFit: 'cover'` → **`'contain'`**(横屏 letterbox 适配宽 / 竖屏适配高,与同槽视频 boxStyle 的 contain 一致)。
  - 上一版"钳容器高度 = SH"的改动**已回退**(诊断错方向,与本问题无关)。
  - **desktop 沉浸分支已是 `object-contain`(封面 + 视频),无需改** → 这也解释了为何 desktop 之前若有类似现象应属其它路径;当前 desktop 适配正确。
  - mobile 视频本身早已正确 aspect-fit(L1411 boxW/boxH:横屏 boxW=slotW / 竖屏 boxH=slotH)。
- **验证**:Leon 本机 Safari(视口调 mobile)复现 → 看横屏图/视频是否按宽适配(上下 letterbox 留白)、不再被拉满高度。
- **✅ 2026-06-04 续修1(letterbox 被模糊海报填满)**:视频本身宽适配后,letterbox 带仍被 `UnifiedVideoPlayer` 海报背景层以 `backgroundSize:cover` 填满。根因:mobile SparkMode 调用只传 `style` 没传 `className`,UnifiedVideoPlayer 靠 className 的 `object-contain` 正则判定才用 `contain`。修:mobile call 加 `className="object-contain"` → 海报背景 + loading 封面层改 `contain`。**Leon 验证:填充已消失 ✅**。
- **✅ 2026-06-04 续修2(视频"清晰→模糊→清晰"闪烁)**:UnifiedVideoPlayer 的 loading 封面层(round-106 加的模糊版)造成闪烁 —— t=0 露原生清晰 poster → 该层模糊海报加载盖上变模糊 → canplay 淡出又清晰。修:去掉该层 `filter: blur(12px)` + `transform: scale(1.08)`,改为**清晰**海报盖住缓冲中视频、canplay 淡出 → 清晰→清晰无模糊中间态。**注:此举反转了 round-106 的"模糊遮首帧"做法**(那做法本意遮 HLS 首帧低码率,但实测造成闪烁,得不偿失)。

## BUG-008 · Safari(mobile 视口)横版视频尺寸抖动(Chrome 无)

- **状态**:🟡 已根治(2026-06-04,待 Leon Safari 验证)
- **来源**:费/Leon 反馈(2026-06-04)
- **现象**:Safari 模拟 mobile 视口下,沉浸态横版视频:① **切到新视频时"从小到大"放大**(视频播放前,封面/背景图);② **播放中尺寸抖动**。Chrome 端均无。
- **根因**:移动沉浸 box 尺寸过去由 JS 按实测 `videoWidth/Height`(`measuredARs`)算 `boxW/boxH` 居中。**Safari 原生 HLS 播放前才报维度** → box 先按 fallback AR(小/错)画、metadata 到了再变 → 切视频"从小到大";码率切换重报维度(比例不变、数值微差)→ box 反复重算抖动。**Chrome 走 hls.js,维度早稳** → 无此问题。
- **🔧 根治**:**废弃 JS 算的 measured-AR pixel box**,沉浸视频改为 `position:absolute; inset:0; width/height:100%; object-fit:contain` 铺满整槽 → **浏览器按视频 intrinsic AR letterbox,无任何 JS box 重算** → 切视频/加载/码率切换全程尺寸稳定。同步删除 `measuredARs` state + `recordMeasuredAR` + onLoadedMetadata 里的 AR 记录(全部废弃)。Chrome/Safari 统一。
- **副带**:letterbox 留白由 UnifiedVideoPlayer 的 `backgroundColor:black` 兜底(干净黑边)。
- **验证**:Leon 本机 Safari(mobile 视口)切横版视频 → 应无"从小到大"、无抖动。

## BUG-009 · Seedance 2.0 Fast 视频参考(r2v)resolution 报错 ——「视频参考」生成直接失败

- **状态**:✅ 2026-06-05 已修(`3495f95`,双层 + 全模式按模型;计费口径已与 Leon 确认)
- **来源**:费 / 排查反馈
- **现象**:Quick Mode 用「视频参考」(r2v)生成**直接失败**,BytePlus 报 `InvalidParameter: the parameter resolution ... is not valid for model dreamina-seedance-2-0-fast in r2v`。
- **根因**:前端只按会员 tier 放开 resolution(creator/studio=1080p),**不看模型**。`dreamina-seedance-2-0-fast`(默认端点)模型级**只支持 480p/720p,不支持 1080p**(跨 t2v/i2v/r2v 都一样;报错带 "in r2v" 仅因那次用了视频参考)。默认 Fast + 1080p → 必被 BytePlus 拒。
- **合法 resolution 集合**:Fast ≤ **720p**,Standard ≤ **1080p**;经 `system_settings`(`seedance_fast_max_resolution` 默认 720p / `seedance_standard_max_resolution` 默认 1080p)可覆盖,端点轮换 / 新模型解锁无需改码。
- **计费口径(已与 Leon 确认)**:一律按 clamp 后的 `effectiveResolution` 计费 —— 选 Fast+1080p → 产出 720p、按 720p 扣(旧行为按 1080p 扣 → BytePlus 失败 → 退款);要 1080p 切 Standard 模型。
- **修法(双层 + 全模式按模型)**:
  - **worker(`_worker.js`,兜底+权威)**:`resolveModelMaxResolution` / `clampResolutionToMax`,提交前 clamp 到模型上限;计费 / baseParams / cost_usd / generation_logs 一律用 `effectiveResolution`;命中 clamp 打 warn;`request_params` 记 `requested_resolution` + `resolution_clamped` 便于审计。
  - **`/api/video-models`**:每模型返回 `max_resolution` 供前端 gate。
  - **前端(`StoryGeneratorPage.jsx`)**:resolution 选择器模型感知,Fast 下锁 1080p 并提示「· Standard」;切到不支持当前档位的模型时自动降档(chip + 确认弹层两处同步)。

---

## 🔎 清查记录 · 2026-06-02

用 Supabase `generation_logs` + Sentry 只读 API 逐条复核:

| Bug | 复查结论 |
|---|---|
| **BUG-001** OpenAI 区域失败 | 🟡 5/28 后连续 5 天 0 复发 → 降级"间歇性·观察"(详见条目) |
| **BUG-002** RangeError 爆栈 | 🔴 6/03 复发(~70,几乎全 iOS/discover)。source map 生效但**爆栈类堆栈天然退化、无法符号化** → 需真机复现/代码审查,详见条目 |
| **BUG-003** video 无源 | ✅ 修复后已掉出活跃榜,确认止血 |
| **BUG-004** 主页/剧集树/grid 播放 | ✅ 已修上线 |
| **BUG-005** Stream 424 孤儿 | ✅ 下架 + 前端兜底,全 feed 仅此 1 条 |

**清查新发现(已闭环)**:Sentry 出现 `ReferenceError: lightboxItem is not defined`(~20 次,lastSeen 6/02 03:21)—— 是 GridPlayer/Lightbox 死代码清理那次中间态坏 bundle(`fb449af`)的残留,已被 `9dfacf2` 修复(补掉 `onLogoClick` 漏删的 `setLightboxItem`)。属一次性事故,非活 bug。

**噪音现状**:Supabase Web Locks / removeChild 翻译噪音 / 陈旧构建等家族的事件 lastSeen 多 ≤5/31,降噪过滤(`src/sentry.js` `ignoreErrors`)+ 各修复上线后**新事件基本停止**。这些老 issue 在 Sentry 里仍是 "unresolved" 状态(只读 token 不能改)。
> **2026-06-03 ✅ 已清空**:Leon 在 Sentry UI 用 `is:unresolved`(注意要拉到 30D 时间窗,默认 14D 漏掉更老的)全选 + Resolve,**未解决 issue 已归零**。之后面板新冒出的即真信号(已知噪音变体被 `src/sentry.js` `ignoreErrors` 持续过滤)。注:BUG-002(RangeError)仍在烧,被一起 resolve 后会自动重新打开 → 届时它就是面板上唯一的真信号。

---

## 🏛 需费配合(基建 / 高危区,非前端能独立完成)

1. ✅ **~~上传 source map 到 Sentry + 修 `release` 版本号~~ — 2026-06-01 已完成**。`@sentry/vite-plugin` 接入 `vite.config.js`(仅当本地 `.env.sentry-build-plugin` 提供 `SENTRY_AUTH_TOKEN` 才启用,无 token 对 fei 部署零影响);release 改用 vite 注入的 `__APP_VERSION__`(= pkg version,不再 `unknown`);上传后 `.map` 从 dist 删除不公开,靠 debug-id 匹配。首次上传 52 文件 / release 1.2.0 验证通过。**注意:谁跑 `npm run deploy` 谁的机器就要有 `.env.sentry-build-plugin`,否则那一版新代码堆栈不可读**(给 fei 的放置步骤见下方协作说明)。
2. **SW / Cloudflare 缓存策略** — 陈旧构建那 ~110 个事件根因是部署后旧 bundle 仍被缓存命中。`public/sw.js`(每次部署 bump `CACHE_NAME`)+ CF `_headers` 是费/部署域。可评估更激进的 cache-bust 或版本提示重载。
