---
title: 「然后呢？」功能实现详档
type: reference
status: archived
owner: fei
created: 2026-04-19
updated: 2026-04-19
tags: [fei-api, archive]
---

# 「然后呢？」功能实现详档

> 接龙式持续创作（Continued Creation）功能技术规格 v1.0
>
> 文档版本：1.0 ｜ 模块归属：NeoAI 视频创作平台 ｜ 适用范围：研发 / QA / PM

---

## 目录

1. [功能概述与产品定位](#1-功能概述与产品定位)
2. [核心交互流程](#2-核心交互流程)
3. [技术架构总览](#3-技术架构总览)
4. [触发入口详解](#4-触发入口详解)
5. [数据载体与持久化协议](#5-数据载体与持久化协议)
6. [启动恢复（Recovery）机制](#6-启动恢复recovery机制)
7. [AI 编剧接龙逻辑](#7-ai-编剧接龙逻辑)
8. [视频生成接龙逻辑（R2V / U2V）](#8-视频生成接龙逻辑r2v--u2v)
9. [API 接口契约](#9-api-接口契约)
10. [数据库与持久化](#10-数据库与持久化)
11. [边界与异常处理](#11-边界与异常处理)
12. [端到端示例（E2E Walkthrough）](#12-端到端示例e2e-walkthrough)
13. [测试用例清单](#13-测试用例清单)
14. [上线与监控建议](#14-上线与监控建议)

---

## 1. 功能概述与产品定位

### 1.1 产品定位

**「然后呢？」**（Continued Creation）是 NeoAI 视频创作平台的核心增长机制，用于解决短视频"一次性消费、缺乏延展"的痛点。

它将"看完一段视频"自然衔接到"创作下一段剧情"，形成 **观看 → 共创 → 再观看** 的闭环。从产品视角看，它承担了三重角色：

| 角色 | 价值 |
|------|------|
| **创作激励器** | 用户看完作品后，被「然后呢？」按钮唤起继续讲故事的冲动 |
| **角色一致性桥梁** | 通过传递 `characterImageUrl` 复用同一角色，避免每次重新建模 |
| **病毒式拉新入口** | 在分享落地页（WorkDetail）也提供该入口，让访客接续他人作品并完成首次创作 |

### 1.2 核心价值主张

- **零摩擦续作**：观众只需一键，无需重新拍照、选风格
- **剧情连贯**：AI 编剧获取"前情提要"，新一段剧情承接而非重启
- **画面延续**：视频生成引擎以上一段视频作为 R2V 参考帧，保持画面风格 / 角色 / 镜头语言一致
- **跨场景触发**：同时支持站内自有作品页（DisplayPage）和分享落地页（WorkDetail）两种触发场景

### 1.3 适用范围

| 场景 | 支持 | 说明 |
|------|------|------|
| 站内创作完成后 | ✅ | DisplayPage 视频播放结束自动浮现按钮 |
| 分享链接落地页 | ✅ | WorkDetail 页面，访客无需登录即可点击；点击后再要求登录 |
| 历史作品列表 | ✅ | "我的视频" Tab 中点击任一作品后进入 WorkDetail，再触发 |
| 视频未生成完成 | ❌ | 仅当 `videoEnded === true` 时按钮才出现 |

---

## 2. 核心交互流程

### 2.1 主流程（已登录用户）

```
[DisplayPage / WorkDetail]
    │
    │  视频播放结束（onEnded）
    ▼
[显示"🪄 然后呢？"浮层]
    │
    │  用户点击
    ▼
[写入 sessionStorage: neo_continue_work]
    │   { videoUrl, scriptSummary, styleName, characterImageUrl }
    ▼
[导航至 / （首页）]
    │
    │  Index.tsx useEffect 检测 neo_continue_work
    ▼
[注入 WorkflowContext]
    │   • setReferenceVideoUrl(videoUrl)
    │   • setPreviousStory(scriptSummary)
    │   • setSelectedStyle(null, styleName)
    │   • setCharacterImage(characterImageUrl)
    ▼
[判断起始页]
    │   hasStyle && hasCharacter → 第 3 页（VoiceInputPage）
    │   否则 → 第 1 页（PhotoInputPage）
    ▼
[用户输入新一段语音/文字描述]
    ▼
[AIScreenwriterPage]
    │   把 previousStory 注入 ai-screenwriter 函数
    │   AI 基于"前情提要"创作续集脚本
    ▼
[ConceptDesignPage / VideoGenerationPage]
    │   把 referenceVideoUrl 作为 R2V/U2V 参考视频
    │   生成画面延续的新视频
    ▼
[DisplayPage]
    │   新作品保存入库
    │   再次出现"🪄 然后呢？"，可无限接龙
```

### 2.2 未登录用户分支（仅 DisplayPage）

```
[点击"🪄 然后呢？"]
    │
    │  isLoggedIn === false
    ▼
[弹出登录对话框 LoginGate]
    │
    │  登录成功 onSuccess
    ▼
[写入 neo_continue_work + 跳转 /]
```

WorkDetail 落地页则**完全开放**，未登录也可点击；登录卡点会发生在第二步 VideoGenerationPage 提交任务时。

---

## 3. 技术架构总览

### 3.1 涉及的代码模块

| 模块 | 路径 | 职责 |
|------|------|------|
| 触发按钮 A（站内） | `src/components/pages/DisplayPage.tsx` (~L427) | 视频结束浮层 + 登录卡点 |
| 触发按钮 B（落地页） | `src/pages/WorkDetail.tsx` (~L247, L342) | 浮层版 + 底部 CTA 版双入口 |
| 数据中转 | `sessionStorage['neo_continue_work']` | 跨路由传值唯一通道 |
| 启动恢复 | `src/pages/Index.tsx` (~L26-48) | 首页挂载时读取并注入上下文 |
| 状态容器 | `src/contexts/WorkflowContext.tsx` | 持有 `referenceVideoUrl` / `previousStory` |
| 编剧调用 | `src/components/pages/AIScreenwriterPage.tsx` (~L42-52) | 透传 `previousStory` |
| 视频调用 | `src/components/pages/VideoGenerationPage.tsx` (~L482, L621) | 透传 `referenceVideoUrl` |
| 编剧后端 | `memfire/ai-screenwriter/index.js` (~L161) | 拼装"故事接龙"提示词 |
| 视频后端 | `memfire/video-generate/index.js` (~L144-228) | R2V / U2V 类型映射 |

### 3.2 技术栈定位

| 层 | 技术 |
|---|---|
| 前端 | React 18 + TypeScript + React Router |
| 跨路由通信 | `sessionStorage`（不持久化，关闭标签页即清空） |
| 状态管理 | React Context（`WorkflowProvider`） |
| 后端 | MemfireDB Edge Functions（Node.js 20，60s 上限） |
| AI 编剧 | `gemini-3-flash-preview` via `ai-api.neodomain.cn` |
| 视频引擎 | `seedance2.0` via `agent/user/video/create`（neodomain） |

---

## 4. 触发入口详解

### 4.1 入口 A：DisplayPage 视频结束浮层

**位置**：`src/components/pages/DisplayPage.tsx` 第 427-461 行。

**触发条件**：
- 视频元素触发 `onEnded`
- React 状态 `videoEnded === true`

**关键代码片段**：

```tsx
{videoEnded && (
  <div className="absolute inset-0 bg-background/60 backdrop-blur-[2px] flex flex-col items-center justify-center gap-4 z-10 animate-fade-in">
    <button
      onClick={() => {
        if (!isLoggedIn) {
          setShowLoginDialog(true);
        } else {
          sessionStorage.setItem('neo_continue_work', JSON.stringify({
            videoUrl: ossVideoUrl || videoUrl,
            scriptSummary: screenwriterResult?.summary || '',
            styleName: selectedStyleName || '',
            characterImageUrl: characterImage || '',
          }));
          window.location.href = '/';
        }
      }}
    >
      🪄 然后呢？
    </button>
    <button onClick={() => { /* 重播 */ }}>再看一次</button>
  </div>
)}
```

**特殊点**：
- 优先使用 `ossVideoUrl`（已转储到国内 OSS 的稳定地址），避免外链超时
- 使用 `window.location.href = '/'` 而非 React Router 的 `navigate()`，**强制全页刷新**以重置 WorkflowContext，避免脏状态污染新一轮创作
- 登录卡点：未登录时显示 `LoginGate`，登录成功后再次写入 sessionStorage 并跳转

### 4.2 入口 B：WorkDetail 浮层 + 底部 CTA

**位置**：`src/pages/WorkDetail.tsx` 第 247-277 行（浮层）、第 342-355 行（底部 CTA）。

**与入口 A 的差异**：

| 维度 | DisplayPage | WorkDetail |
|------|-------------|------------|
| 登录卡点 | 卡在按钮点击瞬间 | **完全开放**，不卡登录 |
| 数据来源 | WorkflowContext 内存 | 数据库 `works` 表查询结果 |
| 路由跳转 | `window.location.href = '/'` | `navigate('/')`（React Router） |
| 触发位置 | 仅视频结束浮层 | 浮层 + 永久底部 CTA |

**永久底部 CTA 关键代码**：

```tsx
<button
  onClick={() => {
    sessionStorage.setItem('neo_continue_work', JSON.stringify({
      videoUrl: work.video_url,
      scriptSummary: work.script_summary || '',
      styleName: work.style_name || '',
      characterImageUrl: work.concept_image_url || ''
    }));
    navigate('/');
  }}
  className="..."
>
  🪄 然后呢？
</button>
```

**字段映射**：WorkDetail 直接使用数据库列名，对应关系如下：

| sessionStorage 键 | DB 列（works 表） |
|-------------------|------------------|
| `videoUrl` | `video_url` |
| `scriptSummary` | `script_summary` |
| `styleName` | `style_name` |
| `characterImageUrl` | `concept_image_url` |

---

## 5. 数据载体与持久化协议

### 5.1 载体选型：sessionStorage

| 候选 | 优点 | 缺点 | 是否选用 |
|------|------|------|----------|
| URL Query | 可分享 | 长字符（OSS URL）易超长 | ❌ |
| LocalStorage | 持久化 | **跨标签页污染**，老数据干扰 | ❌ |
| **sessionStorage** | 隔离当前标签页，关闭即清 | 无 | ✅ |
| IndexedDB | 容量大 | 接龙载荷只有 4 字段，无需 | ❌ |

**关键约束**：sessionStorage 在 `window.location.href = '/'` 跳转后**仍然保留**（同源同标签页），这是入口 A 选择硬跳转的核心原因。

### 5.2 数据契约

**键名**：`neo_continue_work`

**值类型**：JSON 字符串

**Schema**：

```typescript
interface ContinueWorkPayload {
  videoUrl: string;            // 上一段视频的可播放 URL（优先 OSS 国内地址）
  scriptSummary: string;       // 上一段剧本摘要（一句话总结）
  styleName: string;           // 上一段所选风格的中文名（用于 UI 展示与 AI 提示词）
  characterImageUrl: string;   // 上一段角色设定图（多用作概念图同字段）
}
```

**示例**：

```json
{
  "videoUrl": "https://neo-shanghai.oss-cn-shanghai.aliyuncs.com/videos/2025/04/abc123.mp4",
  "scriptSummary": "一位身穿西装的咖啡师在午后阳光下为客人冲煮单品咖啡",
  "styleName": "写实电影感",
  "characterImageUrl": "https://neo-shanghai.oss-cn-shanghai.aliyuncs.com/concepts/2025/04/char_xyz.jpg"
}
```

### 5.3 生命周期

| 阶段 | 操作 |
|------|------|
| 写入 | 用户点击「然后呢？」时（DisplayPage / WorkDetail） |
| 读取 | Index.tsx `AppContent` 组件 mount 时（useEffect） |
| 删除 | 读取后立即 `sessionStorage.removeItem('neo_continue_work')` |
| 兜底过期 | 用户关闭标签页时浏览器自动清空 |

---

## 6. 启动恢复（Recovery）机制

### 6.1 入口位置

`src/pages/Index.tsx` 第 26-48 行：

```tsx
useEffect(() => {
  const continueWorkStr = sessionStorage.getItem('neo_continue_work');
  if (continueWorkStr) {
    try {
      const data = JSON.parse(continueWorkStr);
      if (data.videoUrl) setReferenceVideoUrl(data.videoUrl);
      if (data.scriptSummary) setPreviousStory(data.scriptSummary);
      if (data.styleName) setSelectedStyle(null, data.styleName);
      if (data.characterImageUrl) setCharacterImage(data.characterImageUrl);
      sessionStorage.removeItem('neo_continue_work');

      // 决定起始页
      const hasStyle = !!data.styleName;
      const hasCharacter = !!data.characterImageUrl;
      let startPage = 1; // 默认：照片输入
      if (hasStyle && hasCharacter) {
        startPage = 3; // 跳过照片+风格，直接到语音输入
      }
      setTimeout(() => goToPage(startPage), 100);
    } catch (e) {
      console.error('Failed to parse continue work', e);
    }
  }
}, [goToPage, setReferenceVideoUrl, setPreviousStory, setSelectedStyle, setCharacterImage]);
```

### 6.2 状态注入映射

| sessionStorage 字段 | WorkflowContext setter | 用途 |
|----------------------|------------------------|------|
| `videoUrl` | `setReferenceVideoUrl` | 传给视频引擎做 R2V/U2V 参考 |
| `scriptSummary` | `setPreviousStory` | 传给 AI 编剧做"前情提要" |
| `styleName` | `setSelectedStyle(null, name)` | 沿用原风格名（id 留空） |
| `characterImageUrl` | `setCharacterImage` | 复用角色设定图，无需重新生成 |

> ⚠️ `setSelectedStyle(null, data.styleName)` 故意不传 styleId，使后端必走 `styleScreenwritingMap[styleName]` 命中逻辑（按中文名匹配）。

### 6.3 起始页决策表

| hasStyle | hasCharacter | startPage | 跳转目标 | 含义 |
|---------|--------------|-----------|----------|------|
| ✅ | ✅ | **3** | VoiceInputPage | 跳过照片和风格，直接进入语音输入 |
| ✅ | ❌ | 1 | PhotoInputPage | 风格已有，但需要重新选/拍角色 |
| ❌ | ✅ | 1 | PhotoInputPage | 角色已有，但需要重新选风格（罕见） |
| ❌ | ❌ | 1 | PhotoInputPage | 退化为完全新建创作 |

**setTimeout 100ms 的必要性**：等待 `WorkflowProvider` 子树完成首轮渲染，确保所有 setter 已挂载到 context。否则 `goToPage` 可能先于 setter 完成而读到旧状态。

---

## 7. AI 编剧接龙逻辑

### 7.1 前端透传

`src/components/pages/AIScreenwriterPage.tsx` 第 42-52 行：

```tsx
const { data, error: fnError } = await invokeFunction('ai-screenwriter', {
  body: {
    style: selectedStyle || 'pixar',
    styleName: selectedStyleName || '皮克斯 3D',
    transcript: voiceTranscript || '一个小女孩在星空下追逐萤火虫的温馨故事',
    hasPhoto: !!capturedPhoto,
    photoData: capturedPhoto || null,
    videoType: videoType || 'trailer',
    previousStory: previousStory || undefined,   // 关键字段
  },
});
```

**特点**：`previousStory` 在非接龙模式下为 `null`，传 `undefined` 让后端跳过故事接龙分支。

### 7.2 后端拼装提示词

`memfire/ai-screenwriter/index.js` 第 161-163 行：

```javascript
if (previousStory) {
  userMessage =
    '【这是故事接龙！以下为前情提要】：\n' +
    previousStory +
    '\n\n请不要重复前情，基于上述前情提要，继续紧接着创作后续发展的新一段多镜头剧本（' +
    typeLabel +
    '风格）。\n\n' +
    userMessage;
}
```

**Prompt 设计要点**：

1. **明确身份标识** —— 使用「这是故事接龙」六个字让模型识别这是续集任务
2. **前情提要前置** —— 放在用户输入之前，作为"上下文"而非"约束"
3. **去重约束** —— 显式要求"不要重复前情"，避免 LLM 把摘要复述一遍
4. **承接而非重启** —— 关键词"继续紧接着""后续发展"
5. **保留视频类型一致性** —— 续集仍然遵守预告片/Vlog/MV 等节奏框架

### 7.3 完整请求示例

**Request：**

```http
POST https://functions5.memfiredb.com/{projectId}/aiscreenwriter
Content-Type: application/json
Authorization: Bearer {ANON_KEY}
apikey: {ANON_KEY}

{
  "apiBase": "https://story.neodomain.cn",
  "style": "cinematic-photorealistic",
  "styleName": "写实电影感",
  "transcript": "他走出咖啡店，街角传来手风琴声",
  "hasPhoto": false,
  "photoData": null,
  "videoType": "trailer",
  "previousStory": "一位身穿西装的咖啡师在午后阳光下为客人冲煮单品咖啡"
}
```

**Response（关键字段）：**

```json
{
  "summary": "咖啡师步入巴黎街角，被手风琴声吸引，与街头艺人即兴合奏",
  "mood": "温暖、巴黎风情、即兴邂逅",
  "totalDuration": 12,
  "videoPrompt": "镜头一：咖啡师推开店门走入夕阳…",
  "segments": [
    { "tag": "镜头一·开场", "text": "咖啡师推开店门，走入巴黎黄昏的街角" },
    { "tag": "镜头二·邂逅", "text": "手风琴声从街角传来，他循声望去" },
    { "tag": "镜头三·合奏", "text": "他取出口袋里的口琴，与艺人共谱小调" }
  ],
  "shots": [...],
  "music": { "style": "法式手风琴爵士", "mood": "慵懒俏皮", "reference": "Yann Tiersen" },
  "identityDescription": ""
}
```

### 7.4 视觉一致性的隐式协议

虽然没有把上一段视频的画面信息（构图、配色）显式传给编剧，但通过两个机制实现视觉延续：

1. **风格名沿用**：`styleName` 与上一段一致，命中同一条 `styleScreenwritingMap` 配置（含 `visualGuidance` / `moodPreset` / `musicPreset`）
2. **角色一致性**：`characterImage` 复用，VideoGenerationPage 把它直接作为 `firstFrameImageUrl`

---

## 8. 视频生成接龙逻辑（R2V / U2V）

### 8.1 前端透传

`src/components/pages/VideoGenerationPage.tsx` 第 482-490 行：

```tsx
const bodyPayload: any = {
  action: 'create',
  prompt,
  duration: resolvedDuration,
  totalDuration: resolvedDuration,
  model: resolvedModel,
  accessToken: accessToken || undefined,
  referenceVideoUrl: referenceVideoUrl || undefined,   // 关键字段
};

if (characterImage) {
  bodyPayload.characterImageUrl = await uploadConceptImage(characterImage);
}
if (sceneImage) {
  bodyPayload.sceneImageUrl = await uploadConceptImage(sceneImage);
}
```

### 8.2 后端类型映射

`memfire/video-generate/index.js` 第 142-155 行：

```javascript
var hasCharacterOrImage = !!(characterImageUrl || sceneImageUrl || imageUrl);
var hasReferenceVideo = !!referenceVideoUrl;
var generationType;

if (hasReferenceVideo && hasCharacterOrImage) {
  generationType = "U2V"; // Universal: 同时有参考视频和图片
} else if (hasReferenceVideo) {
  generationType = "R2V"; // 仅参考视频
} else if (hasCharacterOrImage) {
  generationType = "I2V"; // 仅参考图
} else {
  generationType = "T2V"; // 纯文本
}
```

**「然后呢？」场景下的两种典型类型**：

| 场景 | 触发条件 | generationType |
|------|----------|----------------|
| 沿用角色 + 沿用上段视频 | hasCharacter ✅ + hasRefVideo ✅ | **U2V** |
| 仅沿用上段视频（如重新挑选风格/角色） | hasCharacter ❌ + hasRefVideo ✅ | **R2V** |

### 8.3 R2V / U2V 请求体

```javascript
// R2V
reqBody = {
  modelName: "seedance2.0",
  generationType: "R2V",
  prompt: imageRef + prompt + fixedSuffix,
  aspectRatio: "16:9",
  resolution: "720p",
  duration: "10s",
  generateAudio: true,
  enhancePrompt: false,
  referenceVideoUrls: [referenceVideoUrl]   // R2V 关键字段
};

// U2V
reqBody = {
  ...同上,
  generationType: "U2V",
  firstFrameImageUrl: characterImageUrl,
  imageUrls: sceneImageUrl ? [sceneImageUrl] : undefined,
  referenceVideoUrls: [referenceVideoUrl]
};
```

### 8.4 计费差异

`useCredits` 与 `pointsPerSecond` 计算逻辑会因 `referenceVideoUrl` 存在而切换费率档位：

```tsx
// VideoGenerationPage.tsx L107
const hasRefVideo = !!referenceVideoUrl;
let pps;
if (hasRefVideo) {
  pps = ratio.pointsPerSecondWithAudioAndRefVideo
     || ratio.pointsPerSecondWithRefVideo
     || ratio.pointsPerSecondWithAudio
     || ratio.pointsPerSecond
     || 100;
} else {
  pps = ratio.pointsPerSecondWithAudio || ratio.pointsPerSecond || 100;
}
```

**接龙模式通常计费更高**（参考视频带来额外算力开销），UI 在金额展示时会自动反映此差价。

---

## 9. API 接口契约

### 9.1 `/aiscreenwriter`（接龙模式）

| 项 | 值 |
|----|----|
| URL | `POST {MEMFIRE_FN_BASE}/aiscreenwriter` |
| Headers | `Content-Type: application/json`, `Authorization: Bearer {ANON_KEY}`, `apikey: {ANON_KEY}` |
| 超时 | 60s（MemfireDB 上限） |

**Request Schema**：

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `style` | string | 是 | 风格 ID（接龙时通常为空字符串/任意） |
| `styleName` | string | 是 | 风格中文名，用于 `styleScreenwritingMap` 匹配 |
| `transcript` | string | 是 | 用户输入的"下一段"剧情描述 |
| `hasPhoto` | boolean | 否 | 接龙模式通常为 false |
| `photoData` | string\|null | 否 | base64；接龙模式通常为 null |
| `videoType` | enum | 否 | trailer/vlog/mv/tvc/promo/short-drama |
| `previousStory` | string | **接龙必填** | 上一段剧本摘要 |
| `apiBase` | string | 否 | 由 invokeFunction 自动注入 |

**Response Schema**：见 §7.3 完整示例。

### 9.2 `/videogenerate`（接龙模式）

| 项 | 值 |
|----|----|
| URL | `POST {MEMFIRE_FN_BASE}/videogenerate` |
| Headers | 同上 |
| 超时 | 60s（任务为异步，需轮询） |

**Request Schema（create action）**：

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `action` | enum | 是 | `"create"` |
| `prompt` | string | 是 | 视频生成提示词 |
| `duration` | int | 是 | 5/10/15 秒（约束三选一） |
| `totalDuration` | int | 否 | 用于后端积分扣减计算 |
| `model` | string | 是 | 默认 `seedance2.0` |
| `accessToken` | string | 是 | 用户登录凭证 |
| `referenceVideoUrl` | string | **接龙必填** | 上一段视频 URL（OSS 优先） |
| `characterImageUrl` | string | 否 | 角色设定图（接龙时通常已有） |
| `sceneImageUrl` | string | 否 | 场景概念图 |

**Response（成功）**：

```json
{
  "taskId": "task_abc123",
  "status": "queued"
}
```

**轮询请求**：

```json
POST {MEMFIRE_FN_BASE}/videogenerate
{ "action": "poll", "taskId": "task_abc123", "accessToken": "..." }
```

**轮询响应**：

```json
{
  "status": "succeeded",
  "videoUrl": "https://...",
  "thumbnailUrl": "https://...",
  "usage": null
}
```

可能的 status：`queued` / `running` / `succeeded` / `failed`。

---

## 10. 数据库与持久化

### 10.1 `works` 表（无 schema 改动）

接龙功能**不引入新表、不新增列**，完全依赖现有 `works` 表实现状态延续：

| 字段 | 接龙时角色 |
|------|-----------|
| `id` | 新作品独立 ID（与上一段无外键关系） |
| `script_summary` | 当本作品被"接龙"时，作为下一段的 `previousStory` |
| `concept_image_url` | 作为下一段的 `characterImageUrl` |
| `style_name` | 作为下一段的 `styleName` |
| `video_url` | 作为下一段的 `referenceVideoUrl` |
| `user_id` | 接龙用户的 ID（可能与原作者不同） |

> 当前架构**不存储父子关系**。如未来要做"接龙树"展示，可加 `parent_work_id uuid` 列。

### 10.2 任务持久化时机

任务在视频生成提交瞬间即写入 `works` 表（前置持久化），保证：

- 接龙过程中崩溃，仍可在"我的视频"中找回
- 分享 URL 立即可用（即使视频还在渲染）
- 计费记录可追溯

参见 `mem://architecture/task-persistence` 既定规范。

---

## 11. 边界与异常处理

### 11.1 数据缺失场景

| 缺失字段 | 处理策略 |
|----------|----------|
| `videoUrl` | 退化为普通新建（无 R2V），仅保留 previousStory |
| `scriptSummary` | AI 编剧不进入接龙分支，按用户新输入正常生成 |
| `styleName` | startPage 退化为 1，让用户重新选风格 |
| `characterImageUrl` | startPage 退化为 1，让用户重新拍照/选角色 |
| 全部缺失 | 等同于普通创作流程 |

### 11.2 异常处理

| 异常 | 处理 |
|------|------|
| sessionStorage JSON 解析失败 | catch 后打印 console.error，等同于普通创作 |
| OSS URL 已失效（过期/删除） | 视频引擎报错，前端 toast 提示，回退提示用户重新选取参考 |
| 上一段视频未完成持久化 | 按钮不显示（`videoEnded` 不会触发） |
| 用户在登录对话框关闭未登录 | sessionStorage 已写入，但页面停留；下次登录后任意路径访问 / 仍会触发恢复 |
| 接龙模式风格 ID 缺失 | 后端按 `styleName` 在 `styleScreenwritingMap` 查找，找到即用，否则降级为通用提示词 |

### 11.3 多标签页隔离

由于使用 `sessionStorage`（标签页隔离），用户即使在 A 标签页点了「然后呢？」，B 标签页打开 `/` 不会被影响 —— 这是**有意设计**，避免跨标签页污染。

### 11.4 安全与合规

- 接龙不绕过任何风控：依然受 `useWorkflowGuards` 控制
- 写实风格（参见 `REAL_PERSON_REVIEW_STYLES`）的接龙仍需经 Ark 真人审核（角色图复用，所以审核结果可缓存复用）
- 接龙不绕过积分校验，每次新生成独立扣费

---

## 12. 端到端示例（E2E Walkthrough）

### 场景设定
用户 Alice 看完一段"巴黎咖啡师"的视频后，希望看到这位咖啡师"走出咖啡店遇到街头艺人"的续集。

### Step 1 ｜触发

Alice 在 DisplayPage 看到视频结束，点击「🪄 然后呢？」。

```javascript
// 浏览器存储写入
sessionStorage['neo_continue_work'] = JSON.stringify({
  videoUrl: "https://neo-shanghai.oss-cn-shanghai.aliyuncs.com/videos/coffee_v1.mp4",
  scriptSummary: "一位身穿西装的咖啡师在午后阳光下为客人冲煮单品咖啡",
  styleName: "写实电影感",
  characterImageUrl: "https://neo-shanghai.oss-cn-shanghai.aliyuncs.com/concepts/barista_char.jpg"
});
window.location.href = '/';
```

### Step 2 ｜恢复

首页 mount，Index.tsx useEffect 执行：

```javascript
setReferenceVideoUrl("https://...coffee_v1.mp4");
setPreviousStory("一位身穿西装的咖啡师在午后阳光下为客人冲煮单品咖啡");
setSelectedStyle(null, "写实电影感");
setCharacterImage("https://...barista_char.jpg");
sessionStorage.removeItem('neo_continue_work');
goToPage(3); // hasStyle=true, hasCharacter=true → 直跳 VoiceInputPage
```

### Step 3 ｜输入

Alice 在 VoiceInputPage 输入："他走出咖啡店，街角传来手风琴声"。

### Step 4 ｜AI 编剧（接龙模式）

请求 `/aiscreenwriter`：

```json
{
  "styleName": "写实电影感",
  "transcript": "他走出咖啡店，街角传来手风琴声",
  "hasPhoto": false,
  "videoType": "trailer",
  "previousStory": "一位身穿西装的咖啡师在午后阳光下为客人冲煮单品咖啡"
}
```

后端拼装的 userMessage（关键片段）：
```
【这是故事接龙！以下为前情提要】：
一位身穿西装的咖啡师在午后阳光下为客人冲煮单品咖啡

请不要重复前情，基于上述前情提要，继续紧接着创作后续发展的新一段多镜头剧本（电影预告片风格）。

动画风格：写实电影感
...
```

返回新一段剧本：

```json
{
  "summary": "咖啡师推开店门，街角的手风琴声引他走向一段即兴邂逅",
  "totalDuration": 12,
  "videoPrompt": "...",
  "segments": [...]
}
```

### Step 5 ｜视频生成（U2V 模式）

请求 `/videogenerate`：

```json
{
  "action": "create",
  "prompt": "<image1> 是角色设定图…",
  "duration": 12,
  "model": "seedance2.0",
  "accessToken": "...",
  "referenceVideoUrl": "https://...coffee_v1.mp4",
  "characterImageUrl": "https://...barista_char.jpg"
}
```

后端识别：`hasReferenceVideo=true && hasCharacter=true` → `generationType="U2V"`。

请求 neodomain 视频引擎：

```json
{
  "modelName": "seedance2.0",
  "generationType": "U2V",
  "prompt": "...",
  "firstFrameImageUrl": "https://...barista_char.jpg",
  "referenceVideoUrls": ["https://...coffee_v1.mp4"],
  "duration": "10s",
  "aspectRatio": "16:9",
  "resolution": "720p",
  "generateAudio": true
}
```

### Step 6 ｜结果展示

视频生成完成，DisplayPage 展示新作。Alice 又可以再次点击「然后呢？」继续接龙，形成无限延展的故事链。

---

## 13. 测试用例清单

### 13.1 功能测试

| 用例 ID | 场景 | 预期结果 |
|---------|------|----------|
| TC-CC-001 | 已登录用户在 DisplayPage 视频播完点击按钮 | 跳转 / 并直接到 VoiceInputPage |
| TC-CC-002 | 未登录用户在 DisplayPage 点击按钮 | 弹出登录对话框 |
| TC-CC-003 | 登录对话框完成登录 | 自动写入 sessionStorage 并跳转 |
| TC-CC-004 | WorkDetail 浮层按钮点击 | 直接跳转 / 无登录卡点 |
| TC-CC-005 | WorkDetail 底部 CTA 点击（无需视频结束） | 同 TC-CC-004 |
| TC-CC-006 | 接龙后 AI 编剧返回 segments 不复述前情 | 字符相似度 < 50% |
| TC-CC-007 | 接龙时视频引擎实际下发 generationType | 包含 R2V 或 U2V |
| TC-CC-008 | 接龙第二段计费金额 | 高于纯 T2V 模式（带 RefVideo 费率） |
| TC-CC-009 | 接龙过程中关闭标签页再打开 | sessionStorage 自动清空，正常进入首页 |
| TC-CC-010 | 接龙时 styleName 在 styleScreenwritingMap 查不到 | 后端降级为通用提示词，不抛错 |

### 13.2 异常测试

| 用例 ID | 场景 | 预期结果 |
|---------|------|----------|
| TC-CC-101 | 篡改 sessionStorage 为非法 JSON | console.error，正常进入首页 |
| TC-CC-102 | videoUrl 字段为空 | 退化为非接龙模式（生成普通视频） |
| TC-CC-103 | scriptSummary 字段为空 | AI 编剧不进入接龙分支 |
| TC-CC-104 | OSS URL 已删除 | 视频引擎返回 failed，前端 toast 报错 |
| TC-CC-105 | 用户积分不足 | 弹出充值对话框，sessionStorage 数据保留 |

### 13.3 兼容性测试

| 用例 ID | 场景 |
|---------|------|
| TC-CC-201 | iOS Safari 视频结束 onEnded 触发 |
| TC-CC-202 | Android Chrome PWA 模式接龙 |
| TC-CC-203 | 桌面端 1156px 视口浮层显示 |
| TC-CC-204 | 移动端 390px 视口按钮可点 |

---

## 14. 上线与监控建议

### 14.1 关键监控指标

| 指标 | 含义 | 健康阈值 |
|------|------|----------|
| `continue_work_click_rate` | 视频播完后点击「然后呢？」的占比 | ≥ 15% |
| `continue_work_completion_rate` | 点击后实际完成第二段视频生成的占比 | ≥ 40% |
| `continue_work_login_drop_rate` | 登录卡点流失率 | ≤ 30% |
| `r2v_failure_rate` | R2V/U2V 生成失败率 | ≤ 8% |
| `continue_chain_depth_avg` | 平均接龙深度 | ≥ 1.5 段 |

### 14.2 日志埋点建议

在以下位置添加 `page_views` 或自定义事件：

```typescript
// DisplayPage 浮层按钮点击
analytics.track('continue_work_clicked', {
  source: 'display_page',
  is_logged_in: isLoggedIn,
  work_id: savedWorkId,
});

// Index.tsx 恢复成功
analytics.track('continue_work_resumed', {
  has_style: !!data.styleName,
  has_character: !!data.characterImageUrl,
  start_page: startPage,
});

// 接龙视频生成成功
analytics.track('continue_work_completed', {
  parent_work_id: '...',  // 可写入 sessionStorage 一并传入
  child_work_id: savedWorkId,
});
```

### 14.3 灰度与回滚

由于接龙逻辑只是"额外注入"，可通过移除按钮快速降级而不影响主流程：

1. **降级路径 1**：注释 DisplayPage / WorkDetail 中按钮 JSX，主流程不受影响
2. **降级路径 2**：在 Index.tsx useEffect 顶部 return，跳过恢复逻辑

### 14.4 后续演进方向

| 优化项 | 优先级 | 说明 |
|--------|--------|------|
| 接龙树可视化 | P1 | `works` 表加 `parent_work_id` 列，UI 展示作品族谱 |
| 接龙激励 | P1 | 每完成一次接龙赠送少量积分，提升留存 |
| 多人接龙 | P2 | 任意用户可接龙他人作品，形成社区 UGC |
| AI 自动续集 | P3 | 一键生成，无需用户输入新一段描述 |
| 反向回溯 | P3 | "前情是什么？" 让 AI 倒推上文 |

---

## 附录 A：核心文件清单

| 文件 | 行号区间 | 角色 |
|------|----------|------|
| `src/components/pages/DisplayPage.tsx` | 427-461, 546-561 | 触发入口 + 登录卡点 |
| `src/pages/WorkDetail.tsx` | 247-277, 342-355 | 落地页双触发入口 |
| `src/pages/Index.tsx` | 26-48 | 启动恢复 |
| `src/contexts/WorkflowContext.tsx` | 62-63, 79-80, 106-107 | 状态字段定义 |
| `src/components/pages/AIScreenwriterPage.tsx` | 10, 50 | previousStory 透传 |
| `src/components/pages/VideoGenerationPage.tsx` | 81, 107, 489, 627 | referenceVideoUrl 透传 |
| `memfire/ai-screenwriter/index.js` | 108, 161-163 | 接龙提示词拼装 |
| `memfire/video-generate/index.js` | 62, 144-228 | R2V / U2V 类型映射 |

## 附录 B：关键术语表

| 术语 | 全称 | 含义 |
|------|------|------|
| **Continued Creation** | 接龙式持续创作 | 本功能的英文代号 |
| **R2V** | Reference-to-Video | 仅以参考视频生成新视频 |
| **U2V** | Universal-to-Video | 同时使用参考视频 + 参考图生成 |
| **I2V** | Image-to-Video | 仅以参考图生成视频 |
| **T2V** | Text-to-Video | 纯文本生成视频 |
| **previousStory** | 前情提要 | 传给 AI 编剧的上一段剧本摘要 |
| **referenceVideoUrl** | 参考视频 URL | 传给视频引擎的上一段视频 OSS 地址 |
| **WorkflowContext** | 工作流上下文 | React Context，承载创作流程的全部状态 |

---

**文档结束**

> 编写：NeoAI 工程团队 ｜ 最后更新：2026-04
> 反馈渠道：在 NeoAI 项目内提 Issue
