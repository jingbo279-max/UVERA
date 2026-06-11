---
title: Free / Lite tier 视频走 Cloudflare Stream + watermark UID burn-in
type: decision
status: active
owner: Leon
created: 2026-05-16
updated: 2026-05-16
tags: [decision, adr]
---

# Free / Lite tier 视频走 Cloudflare Stream + watermark UID burn-in

**日期**: 2026-05-15
**决策**: fei（明确选方案 B）
**状态**: 实现完成，等 watermark UID 上传 + 配置
**关联代码**:
- `public/_worker.js` `/api/stream/upload-from-url`
- `scripts/setup-stream-watermark.mjs`
- 前端无改动（已有 `src/utils/streamUrl.js` 多态支持）

## 背景

`/api/volcengine/video/submit` 已经 server-side 强制 free/lite tier `watermark: true`，但 BytePlus Seedance 的默认水印是 **"AI 生成"** 中文字样（满足中国 AIGC 法规），不是 "uvera.ai" 品牌。

试图通过 `watermark_text: 'uvera.ai'` 字段自定义文字 — **失败**（BytePlus 忽略未知字段，仍是 "AI 生成"）。

费选择方案 B：用 Cloudflare Stream 的 watermark UID API，在视频编码时 burn-in 我们的 "uvera.ai" 品牌水印。

## 架构

```
[BytePlus Seedance gen] → [Worker downloads TOS video] → 分叉:
                                                          │
                                                          ├─ free/lite tier
                                                          │  └─ POST to CF Stream API
                                                          │     + watermark: { uid: 'xxx' }
                                                          │     → "uvera.ai" 烧入视频
                                                          │     → 返回 https://iframe.cloudflarestream.com/<uid>
                                                          │
                                                          └─ paid tier (starter/creator/studio)
                                                             └─ PUT to R2 bucket (cheaper)
                                                                → 返回 https://asset.uvera.ai/generated/video_xxx.mp4
```

**前端透明**：`src/utils/streamUrl.js` 的 `isStreamUrl()` / `extractStreamUid()` 已经支持 polymorphic URL，frontend 不用改 — `<Stream src={uid}>` 自动播 Stream URL，`<video src>` 自动播 R2 URL。

## 双水印问题

⚠️ **当前实现保留 BytePlus 的 "AI 生成" 水印**（worker `/api/volcengine/video/submit` 强制 `watermark: true` for free/lite）。

意味着 free/lite 用户输出**同时有两个 burn-in 水印**：
- BytePlus "AI 生成"（中文，平台默认位置）
- CF Stream "uvera.ai"（我们配置的位置和大小）

### 为什么保留双水印

1. **AIGC 合规**：中国《生成式人工智能服务管理暂行办法》要求 AI 生成内容标识。"AI 生成" 文字水印是 BytePlus 给我们的免费合规品。
2. **审慎默认**：上线初期保险起见，宁可视觉略丑也别因为去 BytePlus 水印导致合规事故。

### 如果未来想去 BytePlus 水印 (仅保留 uvera.ai)

`public/_worker.js` `/api/volcengine/video/submit` 改 `enforceWatermark` 那段：

```js
// 当前
watermark: enforceWatermark ? true : (watermark ?? false),

// 改成
watermark: watermark ?? false,  // 一律听 frontend (paid 永远 false)
```

同时**评估法律风险**：
- 如果服务面向**全球** + 不在中国大陆推广 → 可去
- 如果服务**含中国大陆用户** → 必须保留某种 AIGC 标识。可以在 CF Stream 水印图片里加 "AI generated" 字样替代

## Cost 影响

CF Stream 计费：
- **Stored**: $5 / 1000 min stored / month
- **Streamed**: $1 / 1000 min streamed

Free / Lite 视频典型 5s 短片 = 0.083 min。

预估（假设 10,000 个 free 视频/月，每个平均播 10 次）：
- 存储: 10,000 × 0.083 = 833 min stored = **$4.17/月**
- 播放: 833 × 10 = 8,333 min streamed = **$8.33/月**
- **合计 ~$12.50/月**，与 free 用户付费转化的潜在收益相比微不足道。

## 实施步骤

### Phase 1（已 commit）— 代码 ✅

- `scripts/setup-stream-watermark.mjs`：CLI 上传 watermark 图到 CF Stream，输出 UID
- `/api/stream/upload-from-url` worker 改造：检测 tier，分叉 CF Stream / R2

### Phase 2（待 ops 执行）— 配置

1. 准备 watermark 图片
   - 临时：用脚本默认 placehold.co 文字 PNG（够用，可立即测）
   - 长期：Leon 设计正式 "uvera.ai" 品牌水印 PNG（建议 400×100 透明背景，白色文字 + 半透明黑色描边）

2. 运行 CLI 上传：
   ```bash
   # 临时 placeholder
   node scripts/setup-stream-watermark.mjs

   # 自定义 Leon 设计的 PNG
   node scripts/setup-stream-watermark.mjs --image=./watermark.png
   ```

3. 持久化 watermark UID：
   ```sql
   INSERT INTO public.system_settings (key, value, description) VALUES
     ('stream_watermark_uid', '<UID-from-step-2>',
      'CF Stream watermark UID applied to free/lite tier video output')
   ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;
   ```

4. （可选）admin 界面让 Leon 之后能在线换水印：
   System Settings → Runtime configuration 卡片已有 `lite_price_cooldown_hours`，
   加 `stream_watermark_uid` 到 worker 的 `VALIDATORS` 允许编辑（短 UID 字符串）。

### Phase 3 — 测试

1. Free tier 触发一次短视频 gen
2. 确认输出视频**右上角**有 "uvera.ai" 水印（CF Stream burn-in），**右下角**是 BytePlus "AI 生成"。
   - 位置：`upperRight`（避开 BytePlus 默认右下水印，避免两个水印重叠）
   - 尺寸：10% video width / 65% opacity / 2% padding from edge
   - 想换位置改 `--position=upperLeft` 之类重跑 CLI 即可（覆盖 system_settings 里的 UID）
3. 确认前端 video player 正常播放 Stream URL（已有 `<Stream>` 多态支持）

### Phase 4 — 监控

- CF Dashboard → Stream → 查看每个 free 视频是否成功上传 + 是否带 watermark
- Worker logs grep `[video-upload]` 监控 storage path 分流是否正确
- Stream 月费监控 → 如果远超预估（用户激增），评估去 BytePlus 水印或提升 Starter pricing

## 迁移说明

**老视频不动**：
- 历史 free 用户的视频在 R2 没有 watermark，**不迁移**（cost vs 价值不划算）
- 新视频走新路径

**Paid tier**:
- 历史 + 未来都在 R2，无变化
- 如果未来想给 paid tier 也加 watermark（marketing），改 `isUnpaidTier` 为 `true` 即可

## 风险 + 回滚

### 风险

1. **CF API rate limit / 故障** → free/lite 上传失败 → 用户体验断。
   缓解：loud-fail 已 log 错误（v1.1.4 audit 覆盖），ops 一看就知道。
2. **Watermark UID 没配置 / 误删** → 上传成功但视频无 watermark。
   缓解：worker 在 UID 缺失时 `console.error` 警告，不阻塞上传（用户优先）。
3. **CF Stream 月费跑飞** → 详见 Cost 节，预估 $12/月，超 10x 才需介入。

### 回滚

如果决定撤回到 R2-only：

```js
// /api/stream/upload-from-url 删掉 isUnpaidTier 分叉,
// 全部走 R2 路径(原状)
```

同时 `system_settings.stream_watermark_uid` row 可以保留（无害），下次重启用直接读。

## 教训

1. **试探未知 API 字段** 不一定有效（`watermark_text` BytePlus 忽略）— 这次浪费了一次部署。下次先确认或测试。
2. **Polymorphic URL handling** 在前端早就写好（`src/utils/streamUrl.js`），让 backend 切换存储无感 — **这种"早期投资"今天救命**。
3. **CF Stream 已经在用**（user-uploaded video review flow）, 边际成本低 — 不算新依赖。
