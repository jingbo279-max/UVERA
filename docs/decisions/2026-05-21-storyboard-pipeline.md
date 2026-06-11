---
title: Storyboard Pipeline — GPT-image-2 取代 Gemini concept design
type: decision
status: active
owner: Leon
created: 2026-05-21
updated: 2026-05-22
tags: [decision, adr]
---

# Storyboard Pipeline — GPT-image-2 取代 Gemini concept design

**日期**: 2026-05-21
**决策**: fei（参考草帽小蔡 AIGC 提示词手册）
**状态**: 代码已 ship · OpenAI key + feature flag 待 admin 配置后启用
**关联代码**:
- `public/_worker.js` — `/api/generate-storyboard` + `buildStoryboardPrompt()` helper + `/api/public-flags`
- `src/api/neoaiService.js` — `generateConceptDesign()` 分流到新 endpoint
- `src/pages/StoryGeneratorPage.jsx` — 传 shots + reference + 简化 Seedance prompt
- `src/pages/admin/AdminDashboard.jsx` — Runtime Configuration 加 5 个 OpenAI keys
- `migrations/20260521_storyboard_pipeline.up.sql`

## 背景

旧 pipeline（3 段独立 gen）痛点：
1. **Concept design** 走 Gemini 3.1-flash-image-preview，输出"人物 model sheet"（3-view 转身 + 大头特写），但故事的关键画面没体现
2. **Seedance prompt 严重过载** — 把 script summary + 全部 shot.action/dialogue/narration + cinematic music 全塞进去，image-to-video 模型被文字信号淹没
3. Gemini concept prompt 含黑名单词（"masterpiece, highly detailed, 1k resolution"）+ negative prompts（"no watermark, text, signature, deformed, blurry"），按草帽小蔡的总结这两类都会触发 GPT 系模型的"显摆细节"模式 → 画面碎、锐化、塑料

## 决策：新管道 - 一次 GPT-image-2 + 极简 Seedance

```
NeoAI Script (含 N 镜 + dialogue + narration)
        ↓
GPT-image-2 (1 次 API call)
  · 风格 = STYLES 预设的 prompt（不强加 Interstellar 前缀）
  · 角色 = name + costume（不加真人三把钥匙—我们 STYLES 全是非真人）
  · 故事 = 全部 N shots 作为"情绪上下文"（dialogue/narration 是情绪指引，不渲染字幕）
  · 万能尾缀 = 草帽小蔡的 anti-noise 质感锁（柔焦/克制/Kodak Portra 颗粒）
  · 不传 negative prompt（草帽小蔡 Rule #1）
  · 不出现黑名单词（精细/复杂/HDR/hyper-detailed/intricate/8K/masterpiece）
        ↓
1 张 key 场景图 (R2: storyboards/sheet_TS.png)
        ↓
Seedance image-to-video (1 次 call)
  · prompt = "Animate this scene with subtle, natural organic motion. Preserve composition and style. Add ambient sound and gentle environmental motion."
  · 长度 35 字符 vs 旧版 200-1500 字符
  · 图本身已经承载所有叙事信息
        ↓
1 段短片
```

**续作**：上一个作品的 reference image 传入 → OpenAI `/v1/images/edits` 端点 → 角色 + 风格一致延续。

## 草帽小蔡技巧的应用 / 取舍

| 草帽小蔡技巧 | 是否用 | 理由 |
|---|---|---|
| 把"不要"翻译成"要" | ✅ | Drop 所有 negative prompts，正向描述输出 |
| 通用前缀（柯达5219 + IMAX 65mm + 诺兰）| ❌ **不用** | fei 2026-05-21 明确：这是 specific 真人电影质感 anchor，会污染 Pixar/Ghibli/Cyberpunk 风格 |
| 万能尾缀（柔焦/克制/Kodak Portra）| ✅ | fei 明确要保留 — 这是 style-agnostic anti-noise 质感锁 |
| 真人三把钥匙（皮肤/头发/眼睛）| ❌ **不用** | 现有 STYLES 全是非真人（动画经典 / 现代视觉 / 传统工艺 / 游戏前卫），真人词包反而污染风格 |
| 反面参考法（像 X 不像 Y）| 🟡 部分 | 在万能尾缀里隐含（"像剧照不像高清数码照"），不再单独堆 |
| 黑名单词避免 | ✅ | 精细/复杂/HDR/hyper-detailed/intricate/ultra sharp/8K/masterpiece 一律不写 |
| 1792×1024 触发电影偏置 | ✅ | system_settings.openai_image_size 默认值 |
| 情绪克制词包 | 🟡 间接 | dialogue/narration 作为"内心戏" + "氛围 beat" 传入 → 模型自行翻译 |

## OpenAI 接入

| 配置项 | system_settings key | 默认值 | 类型 |
|---|---|---|---|
| API key | `openai_api_key` | `NULL`（admin 必填）| secret |
| Model | `openai_image_model` | `gpt-image-2` | public |
| Quality | `openai_image_quality` | `hd` | public |
| Size | `openai_image_size` | `1792x1024` | public |
| 启用 flag | `use_storyboard_pipeline` | `false` | public |

**Endpoint**:
- 无 reference image: `POST https://api.openai.com/v1/images/generations` (JSON body)
- 有 reference image (续作): `POST https://api.openai.com/v1/images/edits` (multipart form-data)

**关于"gpt-image-2"模型名**：fei 2026-05-21 提供。如果 OpenAI 实际不存在这个 model name（API 返回 "model not found"），admin 可在 System Settings → Runtime Configuration → "OpenAI image model" 改成 `gpt-image-1`（已知存在）或 `dall-e-3` —— 1 分钟生效，无需 redeploy。

## Cost 分析

| 路径 | 单视频成本 |
|---|---|
| **旧 (Gemini concept + verbose Seedance)** | ~$0.04 (image) + ~$0.05 (5s Seedance) = **~$0.09** |
| **新 (GPT-image-2 hd + 极简 Seedance)** | ~$0.17 (hd image) + ~$0.05 (5s Seedance) = **~$0.22** |
| **新 (standard quality)** | ~$0.04 + ~$0.05 = **~$0.09**（同旧）|

HD vs standard 差 $0.13/视频。按 Lite 100 tokens = $3.99，用户 1 视频扣 25 tokens = $1.00 收入 → 即使全 HD，毛利 78%。OK。

如果月费跑飞（用户暴涨），admin 可秒切 `openai_image_quality` 到 `standard`，1 分钟生效。

## Feature flag 灰度策略

- **默认 `use_storyboard_pipeline=false`** → 全量走旧 Gemini 路径，新代码完全休眠
- Admin 在 PROD 测试：
  1. 配 OpenAI key
  2. 改 flag 为 `true`
  3. **自己** 触发一次 gen 看效果
  4. 满意就让 flag 留 true（全量用户用上新管道）；不满意改回 false（秒回滚）

## Risk + Rollback

| Risk | 缓解 |
|---|---|
| OpenAI key 无效/被限速 | Loud-fail console.error → CF Logs 立刻看到；admin 1 分钟切回旧管道 |
| Model `gpt-image-2` 实际不存在 | Worker 返回包含 hint "试试 gpt-image-1"，admin 在 UI 改 model 即可 |
| GPT-image-2 prompt 效果不好（首版差）| Flag 切回 false → 旧 Gemini 路径继续可用 |
| 月费超预算 | Admin 改 `openai_image_quality=standard` 或切回 flag false |
| 续作（image edit）endpoint 行为不同 | 第一次 sequel 测试时 loud-fail 会暴露问题 |

## 2026-05-22 迭代 — 信息密度 + safety fallback

### 1. Prompt 重写（信息密度太低 → 分镜设计稿级别）

fei 反馈第一版 GPT 出图"信息含量太少 / 看起来还是单人 portrait"。问题是
之前的 `buildStoryboardPrompt` 用抽象 block header（`[STORY BEATS — for emotional weight]`），
把每镜 dialogue 折成 `Character internal beat: "..."` —— 模型看到的有效信息其实就一句 logline
+ 风格名 + 角色名。完全不够画一张能讲故事的电影 key visual。

**Round-2 (同日晚)**：fei 给出"荡魂山 / 粉色霜玉孔雀"作为参考 brief，要求 prompt
用对应的 4-block 中文格式 + 顶部固定指令。模板重排为：

```
根据下面的描述输出一张信息完整的人设和故事板图片：

【续作连续性】(仅续作)
主体形象（Subject）：...
核心灵物（Entity）：...
背景与光影（Background & Lighting）：...
AI 视觉提示词（Tags）：东方仙侠幻想 (Eastern Xianxia fantasy)，... [中文（English）双语]
【剧本 BEATS — 仅作画面推导，绝不渲染】
【质感锁 — 草帽小蔡 万能尾缀】
【纯视觉输出 — TEXT-FREE】
```

灯光提示根据 mood 自动注入（如悬疑 → "冷顶光或单一硬光源、深色阴影占主导、青蓝-暗紫调"），
Tags 双语化（中文（English）pair 格式 GPT-image-2 在中文 context 下识别更稳）。

**Round-1 模板（被 Round-2 替代）**：曾按 production design brief 拆 8 block
英文格式（CONTINUITY / VISUAL STYLE / CHARACTER / STORY BRIEF / BEATS / ENVIRONMENT /
COMPOSITION / QUALITY / TEXT-FREE）—— fei 看完一轮认为不够"分镜设计稿"那种密度，
换成 4-block 中文格式后效果更聚焦。

旧版 → 新版对比：

| Block | 旧版 | 新版 |
|---|---|---|
| `[CONTINUITY]` | 短句"保持一致" | 显式列出 anchor 维度（face/build/hair/costume + 色调 + 光线温度），明确"不要复制构图，要新场景" |
| `[VISUAL STYLE]` | 单行 styleObj.prompt | + style name 显式 + "no mixing of visual languages" 守门 |
| `[CHARACTER]` | 名字 + costume | + identity_features 描述 + 跨镜一致性显式声明 |
| `[STORY BRIEF]` | （新增） | logline + mood + beat count，作为"剧本梗概" |
| `[BEAT-BY-BEAT SCRIPT]` | `· Beat N: Action — Character internal beat — ...` 一行折叠 | 多行展开，每镜 5 字段（Action / Spoken / Narration / Camera / Duration）verbatim，明确"NEVER drawn as subtitle / speech bubble / caption" |
| `[ENVIRONMENT & STAGING]` | （新增） | 显式指导模型从 beats 推断 location / time-of-day / lighting / set dressing，要求构建有 depth 的真实空间 |
| `[COMPOSITION]` | （新增） | "production-still / key visual" craft 要求：foreground/midground/background 分层、rule-of-thirds、环境讲故事、单一情绪焦点 |
| `[QUALITY / RENDERING]` | 草帽小蔡 万能尾缀 | 同上 + "read like a frame pulled from a finished film" |
| `[TEXT-FREE OUTPUT]` | 短句"no text" | 扩展到 8 类（dialogue bubbles / subtitles / captions / title cards / signage with readable copy / watermarks / signatures / UI / panel borders / annotations） |

**Output 形态决策**：不做多 panel storyboard sheet（如 4-up / 6-up 网格）。
原因：Seedance image-to-video 输入是单张 coherent frame，多 panel 会被理解
为"多个区域同时运动"。新 prompt 通过**单帧内的环境叙事**（depth + 暗示其他
beat 的 set 细节）实现"分镜设计稿"的密度，而不是字面意义的多格。

### 2. OpenAI safety filter auto-fallback

用户报错："Your reference media triggered our safety filter. Please try
again with material that does not contain real-person likenesses."

触发场景：续作 / 角色照片走 `/v1/images/edits`，OpenAI 对真人 likeness
有严格 moderation —— 用户上传自己的照片 / 用真人照做续作 anchor 时直接拒绝。

**修复**：worker 端做透明 fallback，不让用户被卡住。

```
referenceImageUrl 存在
        ↓
POST /v1/images/edits (with reference)
        ↓
       4xx?
        ↓
errBody 包含 "safety filter" | "real-person" | "moderation_blocked" | "likeness" | "content_policy_violation"
        ↓ yes
丢掉 reference，prompt 重建（hasReference=false）+ 追加 [CHARACTER ANCHOR NOTE]
        ↓
POST /v1/images/generations (text-only, no reference)
        ↓
return { success: true, usedReferenceImage: false,
         safetyFallbackTriggered: true,
         safetyFallbackReason: 'openai_safety_filter' }
```

前端 `StoryGeneratorPage` 检测到 `safetyFallbackTriggered` → alert
"Heads up: OpenAI rejected the reference photo... character may not
perfectly match your reference."—— 非阻塞，用户继续做视频。

**关键 invariant**：用户**永远拿得到一张图 + 一条视频**。reference 失败
只降级到 text-only，不让整个 gen 失败。

### 3. usedReferenceImage 字段语义修正

旧 worker 返回 `usedReferenceImage: !!referenceImageUrl` —— 这撒谎：safety
fallback 触发时虽然有 referenceImageUrl，但实际没用。改为反映 OpenAI 真
正接受的请求路径：`true` only if `/v1/images/edits` succeeded with the
reference attached.

## 还没做（明确告知）

1. **Storyboard preview UI** — 当前 Step 2 渲染 `finalConceptUrl` 不变（只是 URL 现在指向 GPT-image-2 输出）。如果想专门"storyboard 预览"UI（更大幅、更突出风格信息），是后续迭代
2. **Per-shot regenerate** — 现在整张图 regenerate 是 atomic，不支持单镜重画（用户说"GPT 出图直接到 Seedance" → 1 图 1 视频，单镜概念不存在）
3. **Public flags 缓存** — Worker getSystemSetting 已有 60s isolate-级缓存；前端 flag 是 session-级缓存（reload 才更新）

## 操作员部署 checklist

1. ✅ 跑 migration `20260521_storyboard_pipeline.up.sql`
2. ⏳ Admin UI → System Settings → 填 `openai_api_key`（sk-xxx）
3. ⏳ 测试：维持 flag false，先观察 admin 自己 trigger 一次 gen，确认旧路径不破
4. ⏳ Admin UI → 改 `use_storyboard_pipeline=true`
5. ⏳ Admin 自测一次新路径 gen，看图效果 + Seedance 视频效果
6. ⏳ OK 就放给用户；不 OK flag 改回 false
