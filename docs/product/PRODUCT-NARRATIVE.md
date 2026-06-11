---
title: UVERA 产品详细描述
type: doc
status: active
owner: Leon
created: 2026-05-08
updated: 2026-05-08
tags: [product, narrative]
---

# UVERA 产品详细描述

> **版本**：对应产品 v1.0.6（GA 2026-05-08）
> **文档定位**：长篇产品叙事 —— 给投资人、合作方、新员工、产品评审。可端到端读完。
> **配套**：盘点见 `docs/product/GA-DELIVERABLES.md`、设计原则见 `docs/product/PRODUCT-DESIGN.md`、技术见 `docs/engineering/TECH-STACK.md`。
> **维护**：费 (feifeixp)

---

## 1. UVERA 是什么

UVERA 是一款面向**独立创作者**的 AI 视频生成与发布平台。它的核心命题非常直接——**让"心里有画面但不会拍"的人，能用一杯咖啡的时间把那段画面变成一段镜头清晰、风格可控的短视频**。

平台运行在 [uvera.ai](https://uvera.ai)，主要面向海外市场，公司主体是注册在美国的 **longVV ltd**。整个产品采用纯 Web 形态，没有 iOS / Android 客户端：用户在浏览器里完成从注册、创作、订阅到发布的完整流程。

我们目前覆盖的能力包括：
- **AI 视频生成**（10–30 秒为主，支持文生视频、图生视频、参考素材生视频）
- **角色一致性**（用一张照片创建一个可复用的"人物"，他可以出现在多部作品里，保留五官、风格、气质）
- **AI 编剧**（用户写一句话故事，系统返回标题 + 旁白 + 镜头脚本，且语言匹配输入）
- **风格化**（4 个基础分类：动画经典、传统工艺、先锋艺术、现代摄影；持续扩展）
- **自有视频上传**（用户可以提交已有视频接受审核后发布到 Discover）
- **创作者订阅**（4 档定价：Free / $25 / $69 / $189，依次解锁分辨率、信用额度、商用授权）
- **管理员后台**（双层权限模型，覆盖用户、订单、内容、对账、审核全套运营动作）

---

## 2. 我们要解决的问题

短视频内容创作过去 5 年的爆发让一件事变得很明显：**"会写剧本"的人和"会拍 / 会剪 / 会做后期"的人是两群人**。前者人数远多于后者，但前者要把脑子里的画面变成可分发的内容，必须依赖后者——这意味着租场地、雇拍摄、谈剪辑、对色调，单条短片的成本经常在四位数美元起。

AI 视频生成模型（Runway / Sora / Kling / Seedance）从 2024 年开始解决了**渲染**这一段，但用户体验仍然停留在"输入 prompt → 等几分钟 → 抽卡看运气"的阶段。这有三个问题：

1. **Prompt 工程门槛高**。普通用户写不出能让模型出彩的描述。"a cat knocks over a flower pot in a sunny kitchen"和"sun-drenched balcony at golden hour, an orange tabby stretches lazily, knocks over a terracotta flowerpot, slow motion, shallow depth of field, Wong Kar-wai-style color grading"——后者出片好得多，但要求用户具备拍摄/摄影知识。

2. **角色不一致**。同一个 prompt 跑两次出来两张脸。这让"系列化作品"几乎不可能——独立创作者最大的产出动力本来就是"我想做一个有连续性的世界观"。

3. **风格漂移**。模型默认风格千篇一律（多数偏写实电影感）。用户想要"村上隆的波普"或"宫崎骏的水彩"时，需要写非常长的风格 prompt，且效果不稳定。

UVERA 的产品逻辑就是把这三个问题一次性解决。

- **降低 prompt 门槛**：用户写一句话故事，**AI 编剧**输出技术 prompt + 镜头列表（自动语言匹配）
- **保证角色一致**：把"创建角色"做成第一步，每个用户的角色入库后**任何作品里都可以 @ 引用**
- **风格化预设**：4 大类共数十种风格预设，用户**点选**而非**描述**

这三件事让一个零经验用户从打开 `/create` 到看到第一段成片，平均时间在 5–8 分钟。这是一个能改变创作分布的提速。

---

## 3. 目标用户的具体故事

我们做了真实的用户访谈，归纳出 4 类核心用户。下面是每类的代表性故事。

### 3.1 Maya —— 自由职业短视频创作者

Maya 27 岁，住纽约布鲁克林，主要在 TikTok 和 Instagram 做内容，靠品牌合作变现。她每个月需要交付 8–12 条短视频，其中至少一半是"概念片"——她需要给品牌提案展示风格，但又不可能为每一次 pitch 都租设备拍摄。

过去她的工作流是：找 Pinterest 灵感板 → 写脚本 → 自己手机拍简陋样片 → 提案。现在她用 UVERA：写一句话故事 → AI 编剧给她剧本 → 选风格 → 5 分钟拿到 5 秒钟的样片 → 发提案。一次提案省下 2 小时 + 大约 $200 的拍摄成本。

她订阅了 Creator 档（$69/月），每月生成大约 30–40 段样片，平均每段 50 tokens。她最在意**渲染速度**和**角色一致性**——同一个客户提案的不同镜头，主角必须长得一样。

### 3.2 Akira —— 概念设计师 / 美术外包

Akira 35 岁，在东京一家中型游戏公司做外包美术。客户最近开始要求"动起来的概念图"——不是完整动画，就是 5 秒的氛围演示。Akira 自己不会做动画，过去要么拒绝这类需求，要么找朋友合作分账。

UVERA 的 **Free Mode** 是他的主战场。他先在 Photoshop 画好 keyframe 概念图，上传到平台，用 Free Mode 的 `@` 引用，写"camera slowly pans left, character turns to face viewer, golden hour lighting"——3 分钟拿到一段 5 秒动态版。客户单价从过去的 $300 涨到 $500，且交付时间缩短一半。

他订阅 Studio 档（$189/月），主要为了**商用授权**——他的产出会作为客户付费内容使用，必须有明确的 license。

### 3.3 Sarah —— 电商社媒经理

Sarah 30 岁，美国西海岸一家中型 D2C 电商品牌的社媒经理。她的痛点是"周更 3 条产品社媒视频，预算紧"。过去她要么用 stock footage 拼凑（同质化严重），要么排队等品牌摄影师档期。

UVERA 给她的最大价值是**批量产出风格一致的产品场景片**——同一个角色（她创建了一个虚拟代言人 Avatar）在不同场景里使用产品。她可以一次性生成一周的内容，且每条都是同一个虚拟人物，给品牌带来极强的人格化识别度。

她公司报销 Studio 档，用来覆盖所有团队成员（v1.1 会有团队订阅）。

### 3.4 Dan —— 重度玩家 / 早期采用者

Dan 22 岁，加州大学生，AI 工具的早期采用者。他没有商业目的，但每天会上 UVERA 探索一两个小时——尝试不同风格、不同 prompt、不同 segment 拼接的可能性，把成果发到 Twitter 和 Discord。

Dan 是我们的"用户传播者"——他的好奇心和分享欲让 UVERA 在 AI 创作者社区里持续被提及。他订阅了 Starter 档（$25/月），但每天活跃度极高，是 Free 转 Paid 漏斗里的"种子用户"。

---

## 4. 产品核心 —— 角色驱动的 AI 视频生成

我们最重要的产品决策是：**把角色作为创作的第一公民**。这不是另一个"输入 prompt 出视频"的工具——而是"基于一个具体的人物去生成"的工具。

### 4.1 角色（Character）是什么

在 UVERA 里，一个**角色**（Character）是一条数据库记录，包含：
- 角色名
- 一张参考照片（用户拍摄或上传）
- 一个 AI 风格化版本（系统在创角时自动生成）
- 关联的属性（性别、年龄段、风格倾向等可选）

用户在第一次进入 Quick Mode 时会被引导创建第一个角色（"打开摄像头创建角色"），之后这个角色就是他的"私人演员"——每个 Quick Mode 创作都从选角色开始，每个 Free Mode 创作都可以 `@角色名` 引用。

### 4.2 为什么这是关键差异化

绝大多数 AI 视频工具的体验是"每次都是新人物"。这让用户产出的作品**没有连续性**——你今天做了一段视频，明天再做一段，画面里是两个完全不同的人。这意味着：

- **不能形成 IP**：一个独立创作者最珍贵的资产是他的**角色和世界观**
- **观众没有粘性**：观众记不住你
- **作品系列化困难**：你做不出"第 1 集 / 第 2 集"

UVERA 让用户拥有**自己的角色库**，每个角色可以反复出演不同剧情、不同风格、不同场景。这把短视频从"一次性消费品"升级到"可积累的创作资产"。

### 4.3 实现方式

技术上，每个角色在 `public.characters` 表里有一行记录，包含原始图 URL（在 R2，自定义域 `asset.uvera.ai`）和风格化处理后的 URL。生成视频时，这张图作为**参考图**传给 Volcengine Seedance 2.0 模型，配合 prompt 一起渲染。

实测下来，Seedance 2.0 在角色一致性上的表现明显优于多数竞品——同一张参考图跑 5 次，五官识别度可以维持在 80%+。这是我们选择 Volcengine 而不是 Runway 的关键原因。

---

## 5. 创作流程详解

UVERA 在 v1.0.6 版本提供三种创作模式，分别对应不同的用户成熟度和创作目的。

### 5.1 Quick Mode —— 5 步引导式向导

这是新手默认进入的模式，目标是**让一个完全没用过 AI 创作工具的人，5 分钟内拿到第一段视频**。

**Step 0：选择角色**

- 第一次进入会引导创建第一个角色（拍照 / 上传 → AI 自动风格化）
- 已有角色会显示在网格里，点选即可

**Step 1：故事描述**

- 一个 textarea，提示文案是"用一句话描述你的故事"
- 下方有 Emoji prompt bubbles 给灵感（"🐱 阳光下的橘猫推倒花盆"等）
- 用户可以用任何语言（中文 / 英文 / 日文 / 西班牙文等）

**Step 2：选择视觉风格**

- 4 个分类 tab：Animation Classics / Traditional Crafts / Avant-garde / Modern
- 每个分类下若干风格卡片（带预览图）
- 选中后高亮，点"Summon the AI screenwriter"进入下一步

**Step 3：审阅 AI 剧本**

- Loading 状态显示"Screenwriter model is drafting your script..."
- 完成后呈现：标题 + 旁白 + 镜头列表
- **关键**：剧本语言**自动匹配**用户输入语言。中文输入 → 中文剧本，英文输入 → 英文剧本。这是通过一个客户端 `detectInputLanguage()` 函数实现的，不依赖任何额外 API
- 用户可以编辑剧本，或直接点"Confirm and enter Render Station"

**Render Station：自动渲染**

- 第一阶段：根据角色 + 剧本 + 风格生成**概念图**（约 30 秒）
- 用户审核概念图，确认后第二阶段：**视频渲染**（约 30 秒–3 分钟）
- 渲染过程显示**真实经过秒数 + 进度条**——这是产品决策上的细节：假进度条让用户觉得"卡住了"，真进度条让用户安心等待

**发布**

- 视频渲染完成后，呈现 **Publishing Settings** 卡片
- 选项包括：Allow Branch（允许其他用户在你的作品上接续创作）、Allow Recast（允许其他用户用你的角色）
- 点"Publish to World Feed"——成功后是**绿色 Confetti 图标的 success card**（不是 alert），下方有"Continue creating / Go home"双 CTA

整个流程平均耗时 5–8 分钟。

### 5.2 Free Mode —— 进阶 Prompt 模式

Free Mode 的目标用户是已经知道自己想要什么的进阶用户。这里我们去掉了所有引导，把控制权完全交给用户。

**Prompt 输入框**

文本框支持两个特性：
- **多语言输入**
- **`@` 引用素材**：当用户输入 `@`，弹出素材选择器（角色 / 之前生成的图片 / 上传的素材 / AI 生成的参考图）。选中后插入文本变成 `[@Image1:橘猫]` 这种**原子 token**——它整体显示为一个高亮 chip，整体删除，不可逐字符删

**素材区**

页面左上有一个素材列表（最多 12 个），每个素材是一个小方块（图片或视频缩略图）。素材有 4 种来源：
1. **直接上传**（image / 视频 mp4，**视频 ≤ 15 秒**——Seedance 模型对参考视频的硬限）
2. **从 Library 选**（用户之前生成或上传过的素材）
3. **从 Character 选**（用户的角色库）
4. **AI 生成参考图**（点 + Generate，输入 prompt + 风格，几秒钟出图）

每个素材会被 AI 描述（10 字以内的中文 / 英文标签），自动作为 `@` 引用时显示的名字。

**多 Segment 拼接**

Free Mode 最强大的能力是**多段拼接**。Seedance 单段最长 15 秒，但用户可以：
- 生成第一段 5 秒（A 角色站在窗前）
- 生成第二段 8 秒（A 角色转身，B 角色出现）
- 生成第三段 5 秒（两人对视）
- 点 **Merge Segments**，**FFmpeg.wasm 在浏览器里合成**总时长 18 秒的完整视频
- 整个合成过程不消耗服务器算力，完全在客户端

我们自托管了 FFmpeg.wasm（32MB 的 wasm 文件存在 R2，JS 在 Workers Assets），原因是 unpkg CDN 跨域加载在 Worker 子线程里失败，自托管才能稳定工作。

**动态信用点定价**

```
RESOLUTION_CREDITS_PER_SEC = {
  '480p':  2,
  '720p':  3,
  '1080p': 7,
}
```

例：5 秒 × 1080p = 35 tokens。1080p 仅对 Starter 及以上订阅开放。

### 5.3 Upload Video Mode —— 自有视频上传（v1.0.6 新增）

这是 GA 版本的新模式，目标用户是**有现成视频、希望发布到 Discover** 的用户——比如 vlogger 把成片放上来扩大曝光。

**为什么要做这个**

UVERA 上线初期 Discover feed 完全靠 admin 手动 curation 和用户 AI 生成内容填充。但有一类用户被排除在外：他们**已经有作品**，只是希望发布到我们平台获得曝光。这部分内容的引入会显著提升 Discover 的多样性和品质。

**为什么要审核**

用户自由上传 = UGC 平台。法务底线是宁可慢也不能让侵权 / 不当内容直接公开，否则平台连带责任。我们的策略：
1. **客户端三道护栏**：标题必填、版权声明 checkbox 强制勾选、文件 ≤ 2GB
2. **管理员人工审核 48 小时 SLA**
3. **Approve 后才进 Discover**

**版权声明的法务设计**

最关键的一处是**版权声明的版本化**。声明文本本身是：

> *I confirm that I own the copyright to this video, or have full authorization from the rights holder to upload and distribute it on uvera.ai. I understand that any upload that infringes third-party rights will be removed without notice and may result in legal action — including civil and criminal liability under applicable copyright law in the user's jurisdiction. uvera.ai will preserve and disclose upload metadata (including IP address and account information) in response to lawful takedown notices and subpoenas.*

每条记录在数据库里存：
- `copyright_acknowledged_at`：时间戳，证明用户当时勾了 checkbox
- `copyright_text_version`：版本号 `v1-2026-05-07`，证明用户看的是哪一版法律文本
- `submitter_ip`：从 `CF-Connecting-IP` 取，DMCA 响应必备
- `submitter_user_agent`：辅助证据

未来律师让改文案时，**bump 版本号**（`v2-...`），旧记录依然可以证明用户当时同意的是哪一版条款——法庭可采信。

**技术实现**

浏览器**直接 POST 到 Cloudflare Stream**（绕开 Worker 100MB body 限制）。Stream 给我们：
- 单视频上限 30 GB（远超用户实际需求，我们前端 cap 在 2GB）
- 自动 HLS 自适应码率（移动端流畅）
- 缩略图自动生成
- iframe 嵌入式播放器

整个上传管道：
1. 前端 POST `/api/user-videos/init-upload` → Worker 验证登录 + 创建 pending row + 调 Cloudflare Stream API 拿一次性上传 URL
2. 浏览器 POST 文件到 Stream URL（multipart/form-data，**XHR 实现以拿到上传进度**——fetch 不支持 progress event）
3. 上传完成后前端 POST `/api/user-videos/finalize` → Worker 翻状态到 `pending_review`
4. Admin 在后台 `User Videos (Review)` tab 看到，Approve / Reject

**Approve / Reject 逻辑**

- **Approve**：状态 → `approved`，**自动**插入 `recommended_content` 表（appears on Discover），admin 可后续在 Homepage Feed tab 调整 pin / CTA
- **Reject**：状态 → `rejected`，**强制填写 ≥ 5 字符理由**，理由保存在数据库，未来用户侧可以看到

---

## 6. 用户上传与社区（GA 阶段）

GA 阶段我们刻意**不做**用户社区和评论。原因：
1. UGC 的反垃圾 / 反骚扰工程量极大，会拖慢主线功能
2. 我们先想让 Discover 的内容**质量先上来**，再放开互动
3. 没有评论的"作品流"反而更类似艺术展览，气质上和我们的设计语言匹配

但我们有"软互动"：
- **Like / Save**（已实现，见 `docs/archive/01-add-likes-saves.sql`）
- **Branch / Recast**（在创作上下游层面互动——你的角色可以被其他用户复用，你的剧情可以被接续；这比评论更有创作生产力）

社区 / 评论是 v2 的候选项。

---

## 7. 商业化与订阅

### 7.1 四档订阅设计

| 档位 | 价格（USD/月）| 信用点 | 关键解锁 |
|---|---|---|---|
| Free | $0 | 6/天主动领 | Quick Mode + Free Mode 480p / 720p |
| Starter | $25 | 500/月 | + 1080p 渲染（部分模型）|
| Creator | $69 | 1500/月 | + 优先队列 + 多 segment 合成 |
| Studio | $189 | 5000/月 | + 商用授权 + 高优先级支持 |

### 7.2 转化漏斗的故意设计

**Free 用户 6 tokens/天 = 一段 3 秒 480p 或 2 秒 720p**。这个数字是**故意算过的**——
（注：Tokens 是对外名字，DB 列仍叫 `credits`，详见技术文档。）

- 够"试一下"：用户能完整体验创作流程
- **不够"做一个完整作品"**：3 秒视频在 TikTok 上没法用
- 用户每天回来领免费额度（**留存机制**）
- 当用户感受到"想做更长 / 更高清的"时，自然引导付费

我们做了一个简单的预测模型，假设：
- Free 注册后 30 天内付费转化率：3–5%
- Starter → Creator 升级率：每月 5%
- Studio 来源：60% 直接订阅、40% Creator 升级
- 退订率：每月 8%

按 GA 30 天目标 5000 注册、150–250 付费用户，MRR 区间应该在 $5,000–$12,000。这是我们 30 天目标的依据。

### 7.3 支付架构的两个关键决策

**第一：双写**

```
auth.users.user_metadata.credits  ← 业务层快读（每次创作扣这个）
public.orders                      ← 财务对账（每次成功支付写一条）
```

业务层不能直接读 `orders` 计算余额——查询太慢。但财务报表也不能只看 `user_metadata`——没有时间序列。所以**双写**是必要的。

**第二：webhook 兜底**

Stripe webhook 偶发不触发是**已观察到的问题**（v1.0.5 出过 2 笔 $25 webhook 返回 200 但没扣分的事故，根因是 `customer.metadata.supabase_user_id` 为空）。我们的兜底设计：

1. webhook 处理失败时，**fallback 用 customer.email 匹配 Supabase 用户**
2. 管理员后台 `Credit Grants` tab **手动补发**（带审计）
3. **自动对账**视图：列出所有 `orders` 里没对应 `credit_grants` 的记录，一键自动 fix

事故响应已经成熟。

### 7.4 信用点的财务模型

每个 token 的成本主要是 AI 模型 API 费用。我们的成本结构（粗估）：
- 480p 1 秒 = 2 tokens → 成本约 $0.015
- 720p 1 秒 = 3 tokens → 成本约 $0.025
- 1080p 1 秒 = 7 tokens → 成本约 $0.06

Starter $25 / 500 tokens → 平均每 token 收 $0.05。在 720p 主流分辨率下，毛利率约 50%。Creator / Studio 因为大量是 1080p 用户，毛利率略低（约 35–45%），但单价高，绝对利润更高。

---

## 8. 管理员后台与运营

GA 当天我们有 **8 位管理员**，分两层权限：

- **2 位 super_admin**（feifeixp@gmail.com、longvv.dev@gmail.com）—— 全权限，包括 System Settings tab（API 连通性测试）
- **6 位 admin**（yazhongliu186 / tuaiai20260304 / jessiehuang9215 / hquanbin662 / jingbo279 / bachbanana）—— 除了 System Settings 外的 7 个 tab

**为什么分两层**：System Settings 涉及第三方 API 凭据相关操作（v1.0.5 已经把 BytePlus ARK Key 显示移除了，但还有连通性测试按钮）。我们希望日常运营管理员**只接触日常运营动作**（审用户、看订单、审视频），不接触系统级配置。

### 8.1 Admin Dashboard 8 个 tab

| Tab | 主要功能 |
|---|---|
| **Users** | 用户列表、tier、tokens（DB 列名 credits）、删除 |
| **Payments & Orders** | Stripe 订单列表、删除（误录）|
| **User Works** | 所有用户作品列表 + 单条删除 |
| **User Videos (Review)** | v1.0.6 新增：上传视频审核队列 |
| **Homepage Feed** | Discover 内容编辑（CTA / pin / 发布开关）|
| **Credit Grants** | 手动补发 + 自动对账（auto-fix Stripe 漏发）|
| **Beta Requests** | Creative Canvas 内测申请审批 |
| **System Settings** | API 连通性测试（仅 super_admin）|

### 8.2 顶部数据看板

每次进入 dashboard，**顶部 6 个数据卡片**实时显示：
- Total Users（auth.users 总数）
- Active Subscribers（35 天内有成功订单的 distinct userIds）
- MRR（最近 30 天订单 SUM）
- Total Revenue（全部订单 SUM）
- Total Assets（user_works 数）
- Feed Items（recommended_content 数）

**重要**：MRR 和 Total Revenue **不是从 Stripe Dashboard 拉的**，是从我们自己的 `orders` 表 SUM 出来的——因为 webhook 偶发不触发，**只有我们自己的表才能反映真实的"已发放服务"对账数字**。

### 8.3 视频审核工作流

新加的 User Videos (Review) tab 是 GA 后管理员的**主要日常工作**之一。每张待审核卡片包含：
- **嵌入 Stream player**（直接预览视频）
- 标题、描述
- 上传者邮箱、IP（IP 用于 takedown 留档）
- 文件大小、原始文件名
- 提交时间
- 版权确认时间 + 文本版本号
- **Approve / Reject 按钮**（Reject 强制填理由）

48 小时 SLA 是我们对用户的承诺。当前 6 位 admin 应该能处理日均 50–100 条提交。如果增长超过这个，监控 `pending_review` 队列长度，当 >50 触发招聘扩容。

---

## 9. 技术架构（外行可读版）

UVERA 是一个完全运行在 **Cloudflare 边缘网络**上的 Web 应用，结合 **Supabase** 作为认证和数据库后端。这个组合让我们用最少的运维负担覆盖全球用户。

### 9.1 核心组件

**前端**：React 19 + Vite 7 单页应用。所有路由在客户端处理，没有服务端渲染。优点是简单、构建快、CF Static Assets 直接出；缺点是 SEO 不友好——但创作工具型产品不靠 SEO，可以接受。

**Cloudflare Workers**：所有 `/api/*` 请求由 Worker 处理。Worker 的优势是**全球边缘部署**——无论用户在巴黎还是加州，请求都到最近的 CF 节点处理，延迟极低。劣势是 Worker 有 100MB 请求体限制和 30 秒 CPU 时间限制——大文件和长任务需要绕过去。

**Cloudflare R2**：对象存储，存所有用户上传的图片和短视频参考素材。R2 有自定义域 `asset.uvera.ai`，用户的素材 URL 是 `https://asset.uvera.ai/characters/...` 这种形式。R2 没有出站流量费——这点比 AWS S3 便宜数量级。

**Cloudflare Stream**（v1.0.6 新增）：专门处理大视频。用户上传的完整视频走 Stream Direct Upload，绕过 Worker body 限制。Stream 自动转 HLS 自适应码率，给我们移动端流畅播放能力。

**Supabase Postgres**：业务数据库。所有用户、订单、作品、上传记录都在这里。Supabase 提供了 **Row-Level Security (RLS)**——一种数据库级别的访问控制，每条 SELECT/UPDATE 都强制经过策略检查。我们用这个保证一个用户绝不能看到另一个用户的私有数据。

**Supabase Auth**：用户登录系统。支持 Google OAuth 和 Email magic link。我们把业务字段（`credits`、`tier`、`is_admin`、`is_super_admin`）存在 `user_metadata` 里——它会自动出现在每次请求的 JWT 里，Worker 端不用额外查库就能做权限判断。

**Stripe**：支付 + 订阅。我们用 Stripe Checkout（用户跳转到 Stripe 页面付款，回来）+ Customer Portal（用户在 Stripe 上自助升降级 / 退订）。Webhook 是关键——每次 `invoice.payment_succeeded` 事件，Stripe 发给我们 Worker，我们更新 `user_metadata.credits` 和 `orders` 表。

**Sentry**：前端错误监控。每个 JS 异常自动上报，dashboard 看到趋势和具体堆栈。我们配了 `sendDefaultPii: false`——不上传任何 PII（email、IP 等），尊重用户隐私。

**BytePlus / Volcengine Seedance 2.0**：核心 AI 视频生成模型。我们调它的 API 生成视频，它返回任务 ID，我们的 Worker 轮询状态，完成后把视频从 Volcengine 的临时 URL 下载下来转存到我们的 R2（永久存储，不依赖 Volcengine 的 URL 寿命）。

**Neodomain LLM 中继**：我们用它中继访问 Gemini / OpenAI / Claude 等模型，主要做 AI 编剧、prompt 优化、图片描述。

### 9.2 一个完整请求的端到端流程

以"用户在 Quick Mode 渲染一段视频"为例：

```
1. 用户点击 "Confirm and enter Render Station"
        │
        ▼
2. React 调 supabase.auth.getSession() 拿 JWT
        │
        ▼
3. POST /api/generate-script with JWT
        │  (Cloudflare Worker 在最近的边缘节点处理)
        │
        ▼
4. Worker 验证 JWT → 调 Neodomain LLM 中继 → 返回剧本
        │
        ▼
5. 用户审核剧本，确认 → POST /api/generate-concept-image
        │
        ▼
6. Worker 调 Gemini 出概念图 → 上传到 R2 → 返回 URL
        │
        ▼
7. 用户审核概念图，确认 → POST /api/volcengine/video/generate
        │
        ▼
8. Worker 扣信用点 (调 Supabase 更新 user_metadata.credits)
        │
        ▼
9. Worker 调 Volcengine 启动视频任务，返回 taskId
        │
        ▼
10. 前端轮询 GET /api/volcengine/video/status/:taskId 每 5s
        │
        ▼
11. 任务完成，Volcengine 返回视频临时 URL
        │
        ▼
12. Worker 下载视频 (POST /api/stream/upload-from-url)
        │  → 转存到 R2 永久 URL
        │
        ▼
13. 用户点击 "Publish to World Feed"
        │
        ▼
14. Supabase RPC 写入 user_works 表 (RLS: only own user_id)
        │
        ▼
15. 返回 success → React 渲染 success card
```

整个流程涉及 6 次跨服务调用，全部在边缘节点完成。中位耗时（包括用户审阅时间）8–12 分钟。

### 9.3 为什么这个架构组合

**为什么不用 AWS / GCP**：传统云成本高、运维复杂、出站流量费天价。Cloudflare 的边缘 + R2 零出口费 + Workers 按请求计费的组合，对一个早期产品来说成本可控且全球均匀。

**为什么不用 Next.js**：SSR 增加了部署和缓存复杂度，且我们不需要 SEO。Vite SPA + CF Static Assets 是最简单的方案。

**为什么不自建支付**：Stripe 有全球 PCI DSS 合规、Customer Portal、税务自动处理。自建 = 半年工程量 + 永久合规负担。完全不值得。

**为什么不自建模型**：训练视频生成模型需要数百万美元和数月。我们的差异化在产品层（角色驱动、AI 编剧、风格化），不在模型层。模型层选择最好的现成 vendor 即可。

---

## 10. 法律合规

我们是一家美国公司（longVV ltd），主战场海外。法律合规框架按美国法律 + GDPR（覆盖欧洲用户）+ DMCA（版权响应）三个维度搭建。

### 10.1 用户协议三件套

我们有三份核心法律文档：
- **Terms of Service**：用户使用平台的协议
- **Privacy Policy**：数据收集和使用说明
- **Content License**：用户上传内容的许可范围 + AI 生成内容的著作权归属

这三份文档由内部起草模板，**外部律师终审**。GA 之前必须把律师终审版上线。

### 10.2 关键合规姿态

| 主题 | 立场 |
|---|---|
| 司法管辖 | 美国（不专门服务中国大陆用户）|
| 用户最低年龄 | 16 岁 |
| 联系邮箱 | `legal@uvera.ai` |
| AI 生成内容著作权 | 用户拥有使用权；UVERA 保留训练 / 改进模型的非排他许可 |
| 用户上传内容 | 必须确认拥有版权 / 授权；侵权下架 + 可能追诉 |
| 数据处理 | Supabase（美国 + EU 区）+ Cloudflare（全球）|
| 数据保留期 | 用户主动删除即时生效；删除账号 30 天后彻底清除 |

### 10.3 上传视频的版权证据链

v1.0.6 的用户视频上传功能特别设计了完整的法务证据链：

1. **强制 checkbox**：不勾不让提交（按钮 disabled）
2. **版权声明文本版本化**：`copyright_text_version = 'v1-2026-05-07'` 写入每条记录
3. **IP 留痕**：`CF-Connecting-IP` 头取真实 IP
4. **UA 留痕**：辅助身份验证
5. **时间戳**：`copyright_acknowledged_at` 精确到毫秒

这些字段在 DMCA takedown 和潜在诉讼时是关键证据。律师明确建议过：**没有这条证据链，平台对侵权内容的免责很难成立**。

### 10.4 GDPR 准备

GA 当天 Cookie Banner 还没上（v1.0.7 候选 P1）。如果 30 天内 EU 用户占比超过 10%，我们会优先把 Cookie Banner 加上。Privacy Policy 已经按 GDPR 写了"用户的访问权 / 修改权 / 删除权"条款。

---

## 11. 数据与监控

### 11.1 我们盯什么

**实时数据**（管理员 dashboard 顶部）：
- Total Users / Active Subscribers / MRR / Total Revenue / Assets / Feed Items

**异常监控**（Sentry）：
- 前端 JS 异常
- 已过滤的噪声：Supabase Web Locks 报错（无业务影响）

**Worker 日志**（Cloudflare Workers Observability）：
- Webhook 处理日志
- 大视频上传 / 下载日志
- AI 模型调用失败

**Stripe Dashboard**：
- 订阅事件流
- 失败的支付（决定要不要改 dunning 策略）

### 11.2 GA 后 30 天目标 KPI

| 指标 | 目标 | 衡量方式 |
|---|---|---|
| 累计注册用户 | 5,000 | `auth.users` count |
| 周活跃用户（WAU）| 1,000 | 7 天内有创作或登录 |
| Weekly Active Creators | 300 | 7 天内 publish 至少 1 个作品 |
| 付费转化率 | ≥ 3% | 付费用户 / 总注册 |
| MRR | ≥ $5,000 | orders 30 天 SUM |
| Discover 总作品数 | ≥ 1,500 | recommended_content count |
| 用户视频上传 + approved | ≥ 100 | user_video_uploads 中 approved 状态 count |
| 平均渲染成功率 | ≥ 92% | Volcengine 任务成功 / 总尝试 |
| Sentry 错误率 | ≤ 0.5% | 唯一错误数 / DAU |

### 11.3 GA 后 90 天目标

- MAU 5,000
- MRR ≥ $25,000
- 累计付费用户 ≥ 800
- 平均 LTV ≥ $80
- 退订率 ≤ 8%/月

如果这些数字达成，我们进入 v1.1 的产品扩展（Series 连载、Creative Canvas 正式开放、多人协作等）。

---

## 12. 路线图

### 12.1 v1.0.6（GA 当天）✅ 已发

- 双层管理员模型（super_admin / admin）
- 用户视频上传 + 48h 审核
- 上传体验大幅优化（动态超时 + 大文件支持 + 参考视频 15s 预检）

### 12.2 v1.0.7（GA 后第一个迭代窗口，预计 2 周内）

P0：
- Discover 视频卡片**举报按钮**（DMCA 入口必加）
- Cookie Banner（GDPR）

P1：
- 用户视频 approved/rejected **邮件通知**（接 SendGrid）
- `orders.userId` FK 修正（指向 auth.users）

P2：
- 用户侧"我的上传"状态查看
- 上传中断恢复（tus 协议）

### 12.3 v1.1（预计 6 月）

P0：
- **Series（连载）功能**：多集一组、跨集角色复用、列表化展示
- Creative Canvas 正式上线（高级编辑器，含图层、关键帧、过渡）

P1：
- 多模型路由（接入 Replicate 作为 Volcengine 备选，避免单一 vendor 风险）
- 用户行为分析（PostHog）
- 团队订阅（多人共享一个 Studio 配额）

### 12.4 v2（远期）

- 国内合规版本（如果决定开拓国内市场，需要备案 + 内容审查 + 国内支付通道）
- 直播 / 实时流
- 用户社区 / 评论
- 创作者收益分成（Discover 分润给作者）

---

## 13. 团队

| 角色 | 人 | 主要负责 |
|---|---|---|
| 产品 / 甲方接口 | Leon | 需求方向、设计语言定调、用户访谈 |
| 工程 CEO（前后端通管）| Fei 、H.Zheng | 全栈实现、数据库、部署、CI、合规跟进 |
| 后端开发 | Shao Yan、Hu | 模型集成、Worker 优化 |
| Ops 管理员（v1.0.6 新增 6 位）| 6 位 Gmail 账号 | 内容审核（48h SLA）、用户支持、补发 |
| 法务 | 外部律师 | TOS / Privacy / Content License 终审 |

GA 后第一个月，团队是这个规模的。如果 KPI 达成，v1.1 会扩招产品 + 增长方向。

---

## 14. 风险与挑战

我们清楚 GA 当天面临的几个主要风险：

| 风险 | 等级 | 缓解 |
|---|---|---|
| **AI 模型 vendor 单一依赖** | 🔴 高 | v1.1 接入 Replicate 多模型路由 |
| **Stripe live mode webhook 偶发不触发** | 🟡 中 | 已有 email fallback + 手动补发对账 |
| **用户上传侵权内容** | 🔴 高 | 强制版权 checkbox + IP/UA 留痕 + 48h 审核 + DMCA 邮箱 |
| **国内访问 CF 慢** | 🟡 中 | 主战场海外，国内不是首要市场 |
| **6 位 Ops 审核能力不足** | 🟡 中 | 监控 pending 队列长度，> 50 时启动招聘 |
| **AI 生成内容版权争议** | 🟡 中 | TOS 明确"用户拥有使用权，UVERA 保留训练许可" |
| **Free tier 烧钱不付费** | 🟢 低 | 6 tokens/天 = $0.10 成本，可控 |
| **GA 当天 traffic spike** | 🟡 中 | CF Workers 自动扩容，Supabase 已升 Pro |

---

## 15. 总结

UVERA 在 GA 当天交付的，不是一个"AI 视频生成 demo"，而是一个**功能完整、商业模型闭环、合规可上线**的产品：

- **完整功能**：3 种创作模式、4 档订阅、Discover 公开 feed、用户上传通道、管理员后台、对账系统
- **闭环商业**：Stripe live、Customer Portal、自动信用点扣减、补发对账兜底
- **合规可上线**：TOS / Privacy / Content License 律师终审中、版权证据链完整、IP 留痕到位

更重要的是，我们做的核心产品决策——**角色驱动、AI 编剧降门槛、风格化预设、强角色一致性**——和市场上其他 AI 视频工具有清晰的差异化。我们不是做 demo 的工具，是做**让创作者积累 IP 的平台**。

如果 GA 后 30 天 / 90 天的 KPI 达成，UVERA 将是少数几个**从 demo 阶段成功跨越到付费产品阶段**的 AI 视频创作类应用。这是我们在做的事。

---

**文档维护**：费 (feifeixp)
**最后更新**：GA 当天
**配套文件**：
- `docs/product/GA-DELIVERABLES.md` —— 全量交付清单
- `docs/product/PRODUCT-DESIGN.md` —— 产品设计原则
- `docs/releases/RELEASE-v1.0.6.md` —— 本版本发布说明
- `docs/legal/COMPLIANCE.md` —— 合规策略
