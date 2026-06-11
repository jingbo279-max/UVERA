---
title: Stream 视频 poster 处理 — 单层渲染 + 非黑首帧
type: decision
status: active
owner: Claude
created: 2026-06-05
updated: 2026-06-05
tags: [video, stream, poster, cover, immerse, frontend, worker]
---

# Stream 视频 poster 处理决策(2026-06-05)

来源:费/Leon 反馈沉浸态 poster 问题串(BUG-007 适配 → 多层叠画 → 黑首帧)。

## 1. 术语统一

显示在视频前/加载时的那张图,**一律称 `poster`**(代码 prop 名)。数据源是
`recommended_content.cover`(DB 单列)。不再混用 封面 / PosterBg / CSS背景图 /
模糊封面层 等叫法。

## 2. 渲染:收敛成单层(盖在视频上面)

`UnifiedVideoPlayer` 过去对沉浸主播放叠了 **3 层同一张 poster**(native
`<video poster>` + wrapper CSS 背景 + 模糊 overlay),造成"清晰→模糊→清晰"闪烁
+ letterbox 被模糊海报填满。

**现状(showLoadingOverlay 路径)**:
- 唯一 **poster overlay** 盖在视频【上面】(zIndex 1),清晰显示 → `canplay` 淡出。
- wrapper 只留 `backgroundColor:black`(letterbox 留白),不画 poster。
- 撤掉 native `<video poster>`(overlay 接管)。
- bare 路径(静态缩略图,无 overlay)仍保留 poster CSS 背景兜底,行为不变。

## 3. 非黑首帧:CF Stream `thumbnailTimestampPct=0.1`

CF Stream 默认 `thumbnails/thumbnail.jpg` 取 time=0(很多视频开头黑/淡入 → 黑
poster)。决策:给视频设 **`thumbnailTimestampPct=0.1`**(原生按时长比例取帧),
之后所有用 `thumbnail.jpg` 的地方(URL 不变)自动返回 10% 处的帧。

- **旧数据回填**:`scripts/backfill-stream-thumbnails.mjs`(2026-06-05 跑过,
  449/449 成功)。可逆(pct 设回 0)。
- **新视频自动设**(worker `setStreamPosterPct` helper + 端点
  `POST /api/stream/set-poster-frame`):
  - 用户上传 `/api/user-videos/finalize`
  - `/api/series/publish`(所有 ready episode)
  - create/short 前端 `handlePublishToFeed`(Quick/Free/multi-segment/merge
    统一 chokepoint)+ Free mode 保存点
- **token**:worker `CF_API_TOKEN` 有 Stream:Edit 权限(回填验证通过)。

## 4. 自定 poster 优先级(#2,creator 自助)— 已实现(从视频选帧)

- `recommended_content.cover` 是 **单列** → "唯一"天然成立。
- create/short 发布卡新增「Cover frame」选帧器(`StoryGeneratorPage`):拖滑块
  seek 一个独立 picker `<video>` 显示该帧,默认 10%(= 自动非黑首帧)。
- 发布(`handlePublishToFeed`)时:
  - 设该 Stream 视频 `thumbnailTimestampPct` = 所选比例(端点 `set-poster-frame`
    扩展支持可选 `{pct}`)。
  - 若创作者**主动拖过**滑块(`coverTouched`),把 `cover` 指向 Stream
    `thumbnail.jpg`(确保 feed 封面 = 所选帧,即便原 cover 是概念图);未动则不覆盖。
- **零存储、零上传** —— 纯复用 Stream `thumbnailTimestampPct`。
- 起步版只支持「选帧」;「上传自定图」(R2)留待后续(见 #2 决策)。

## 待办 / 已知遗留

- create/short 若有未经上述 chokepoint 的零散发布点,靠 backfill 脚本定期补跑兜底。
- 选帧器 picker video 复用 `previewVideoUrl`(再 load 一次);create/short 短视频可接受。
- 「上传自定封面图」未做(本期定为「从视频选帧」起步)。
- ⚠️ 安全:`public/_worker.js` 的 CF API token 仍硬编码在源码(应挪 Worker secret)。
