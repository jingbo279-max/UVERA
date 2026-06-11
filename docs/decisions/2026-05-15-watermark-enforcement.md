---
title: Free/Lite tier 视频 watermark — server-side 强制 + uvera.ai 文字水印
type: decision
status: active
owner: Leon
created: 2026-05-15
updated: 2026-05-15
tags: [decision, adr]
---

# Free/Lite tier 视频 watermark — server-side 强制 + uvera.ai 文字水印

**日期**: 2026-05-15
**决策**: fei
**状态**: Phase 1 已实现（server-side 强制 + 试探性 watermark_text 参数），Phase 2 待验证
**关联代码**: `public/_worker.js` `/api/volcengine/video/submit`
**关联文档**: `src/data/plans.js` `PLAN_LIMITS.{tier}.watermark`

## 背景

费 2026-05-15 提出："seedance-2.0 生成时是有水印功能的，free 用户可以加入水印，水印显示 'uvera.ai'"。

原状态：
- `PLAN_LIMITS.free.watermark = true`（设计层标 free 应有水印）
- 前端 `StoryGeneratorPage.jsx:1220`：`watermark: tier === 'free'`
- worker `/api/volcengine/video/submit:1290`：`watermark: watermark ?? false`（**前端传啥用啥**）

漏洞：**前端可绕过**。恶意用户改请求 payload 为 `watermark: false`，Free tier 也能拿到无水印输出。

## 决策：server-side 强制 + 试探性自定义文字

### 实现

```js
// public/_worker.js /api/volcengine/video/submit

let callerTier = 'free';  // 默认 free（无 JWT 等于 free）
// ... auth lookup → callerTier = user_metadata.tier

const isUnpaidTier = callerTier === 'free' || callerTier === 'lite';
const enforceWatermark = isUnpaidTier;

const baseParams = {
  // ...
  watermark: enforceWatermark ? true : (watermark ?? false),
  // 试探性自定义文字 — BytePlus API 通常忽略未知字段
  ...(enforceWatermark ? { watermark_text: 'uvera.ai' } : {}),
};
```

### 为什么"试探性"

BytePlus Seedance API 文档没明确说支持 `watermark_text` 字段。已知：
- ✅ `watermark: true|false` boolean 接受
- ❓ `watermark_text: string` 接不接受 — **未验证**

策略：发送试试。两种结果都可接受：

| 情况 | 影响 |
|---|---|
| BytePlus 忽略 `watermark_text` | 用 BytePlus 默认水印（可能是 Doubao/Volcengine logo）— 实际不是 "uvera.ai"，需 Phase 2 后处理 |
| BytePlus 拒绝整个请求 | 在 CF Worker Logs 出 ERROR（v1.1.4 loud-fail 已覆盖）— 立即知道，回退去掉这个字段 |
| BytePlus 接受 `watermark_text` | 水印显示 "uvera.ai"，理想结果 |

## 操作员验证（Phase 2）

部署后**必须**触发 1 次 Free tier 真实 gen，检查输出视频水印实际显示什么。

### 验证步骤

1. 用 Free tier 账号（或临时把自己 tier set free）登录
2. /create 触发一次短视频 gen（最小 5s 480p，省 token）
3. 等 gen 完成 → 打开输出视频 → 看右下角（或四角任一）水印文字
4. 截图发 fei + Leon

### 三种可能结果 + 对应行动

#### A. 水印是 "uvera.ai" ✅
完美。BytePlus 接受了 `watermark_text` 自定义字段。**Phase 2 关闭**。

#### B. 水印是 BytePlus / Doubao / Volcengine logo 或其他文字 ⚠️
BytePlus 忽略了 `watermark_text`。需要 Phase 2：
- 选项 1（推荐）：Cloudflare Stream 上传时叠加 watermark image
  - CF Stream 支持 `watermarks` 字段：https://developers.cloudflare.com/stream/edit-videos/applying-watermarks/
  - 上传 "uvera.ai" 文字 SVG/PNG 一次 → 后续 free/lite 视频 watermark UID 引用
  - 不动 BytePlus 调用 → BytePlus 默认水印取消（`watermark: false`），改用 CF Stream watermark
- 选项 2：FFmpeg WASM 在 worker 后处理（贵 CPU 时间）
- 选项 3：接受 BytePlus 默认水印（不理想但能用）

#### C. 视频完全没水印 ❌
说明 BytePlus `watermark: true` 在某些条件下不生效。回退到选项 1（CF Stream overlay）作为兜底。

## 防御：前端依然传 watermark

`StoryGeneratorPage.jsx:1220` 的 `watermark: tier === 'free'` **保留**——server 端是最终防线，但前端正确传值减少 server log warn（`[video/submit] client sent watermark=false but tier=free`）。

## 测试 case

部署后 PR review 必跑：

```bash
# 1. Free tier 用户调用应被强制 watermark=true
curl -X POST https://uvera.ai/api/volcengine/video/submit \
  -H "Authorization: Bearer <free-user-jwt>" \
  -H "Content-Type: application/json" \
  -d '{"prompt":"test","duration":5,"watermark":false}'
# 期望：worker 日志显示 "client sent watermark=false but tier=free — forcing watermark=true"

# 2. 匿名调用（无 JWT）应被强制 watermark=true
curl -X POST https://uvera.ai/api/volcengine/video/submit \
  -H "Content-Type: application/json" \
  -d '{"prompt":"test","duration":5,"watermark":false}'
# 期望：同上,callerTier='free' 触发 enforcement

# 3. Starter+ 用户 watermark:false 应被尊重
curl -X POST https://uvera.ai/api/volcengine/video/submit \
  -H "Authorization: Bearer <starter-user-jwt>" \
  -H "Content-Type: application/json" \
  -d '{"prompt":"test","duration":5,"watermark":false}'
# 期望：watermark=false 传给 BytePlus,输出无水印
```

## 教训

`watermark` boolean 是 client-trusted 多年来都没被察觉。所有"tier-gated"的字段都该 server 端二次验证，不能只依赖前端 happy-path。

参考清单（待 v1.2.0 顺手 audit）：
- `model` 字段（前端有 free 锁 Fast 的逻辑，server 没二次验证）
- `resolution` 字段（前端 `getResolutionOptions(tier)` 限制选项，server 没二次验证）
- `duration` 字段（前端按 tier 限上限？需查）
