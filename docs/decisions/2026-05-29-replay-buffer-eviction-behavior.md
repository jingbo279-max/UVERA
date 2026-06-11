---
title: Replay 时 buffer eviction — by-design,HTTP cache 兜底,不主动改
type: decision
status: active
owner: Leon
created: 2026-05-29
updated: 2026-05-29
tags: [decision, adr]
---

# Replay 时 buffer eviction — by-design,HTTP cache 兜底,不主动改

> **决策日期**:2026-05-29
> **触发 session**:Leon round-100/101 进度条 buffered 指示器收尾后
> **决策方**:Leon(产品判断)
> **状态**:✅ 不动 — 行为说明记档,如生产环境用户反馈再启动方案 A/B

## 触发场景

Leon 问:"视频 buffer 加载完毕并播放完毕,点击重播是要重新加载吗?"

回答:**通常会**(浏览器/MSE 标准 buffer eviction 行为),但 HTTP cache 命中让用户几乎无感。

## 现状逻辑链

### 重播触发点(两条等价路径)

| 触发 | 文件位置 | 行为 |
|---|---|---|
| 中心 Replay 按钮(round-93)| [PlayerActionBar.jsx](../../src/design-system/primitives/PlayerActionBar.jsx) `handleReplay` | `v.currentTime = 0` + `setIsEnded(false)` + `v.play()` |
| Row 2 Play 按钮(round-98)| [PlayerActionBar.jsx](../../src/design-system/primitives/PlayerActionBar.jsx) `togglePlay` isEnded 分支 | 同上 |
| Click-on-video(round-93)| [PlayerActionBar.jsx](../../src/design-system/primitives/PlayerActionBar.jsx) onClick handler isEnded 分支 | 同上 |

**三条路径都不动 `src`** → 不会触发 `loadstart` → 不会重新 fetch manifest / 整文件。只是 `currentTime` seek 回 0。

### `currentTime = 0` 后浏览器实际行为

| 场景 | Buffer 状态 | Replay 体感 |
|---|---|---|
| **mp4 短视频(< 30s)** | 通常整段 buffer 还在 | 即时播,无 spinner |
| **mp4 长视频(> 1min)** | 浏览器主动 evict 已播段(节省内存)| 重新拉 byte-range,HTTP cache 命中 → ~100-300ms |
| **HLS.js (Chrome/Firefox)** | MSE `maxBufferLength` 默认 30s,播过 segment 自动 evict | 重新 fetch segment 0,CF edge cache 命中 → ~200-500ms |
| **HLS native (Safari)** | Safari 内部策略类似 MSE | 同上,~200-500ms |

### Spinner 行为(round-95 + round-98 fix)

[UnifiedVideoPlayer.jsx](../../src/components/UnifiedVideoPlayer.jsx) loading overlay effect:
1. 点 Replay → `currentTime=0` + `play()`
2. 如果 buffer 还在 → `readyState >= 3` → 立即播,**无 spinner**
3. 如果 buffer evicted → `waiting` event fire → 200ms 后显示 spinner → segment 重新到达 → `playing` event → spinner 消失
4. timeupdate 兜底 cancel(round-98)防止 spinner 卡死

**这是预期行为,不是 bug**。长视频 replay 时短闪一下 spinner = 正在重新拉首段 segment,跟首次加载体验一致。

## 为什么不主动避免

| 方案 | 改动成本 | 副作用 |
|---|---|---|
| **A. HLS.js 加大 `maxBufferLength` 到 video duration** | UnifiedVideoPlayer.jsx hls.config 1 行 | 内存占用 ×N(长视频可能 100+ MB),移动端 OOM 风险 |
| **B. 浏览器 buffer 不 evict** | 无 API 控制 | 不可行 |
| **C. Replay 时先 preload 一段再 play** | 加 logic | 用户感知 200ms 等,反而更糟 |
| **D. 不动(当前)** | 0 | 长视频 replay 短闪 spinner,HTTP cache 命中所以 < 500ms |

Leon 选 D — HTTP cache 兜底让"重新加载"几乎透明,代价 < 收益。

## 触发重新评估的条件

任一满足,启动方案 A(只对长视频 caller opt-in):

- [ ] 生产环境用户报"replay 卡顿" ≥ 2 次
- [ ] 短剧场景(SeriesDetailPage)每集 < 60s 但用户反馈集间切换 + replay 体验差
- [ ] 移动端实测 4G/5G 下 replay 重新拉 segment > 1s(慢网络放大问题)

## 引用

- HTML5 spec:[HTMLMediaElement.buffered](https://html.spec.whatwg.org/multipage/media.html#dom-media-buffered) — 浏览器 buffer eviction 是 implementation-defined
- MSE spec:[SourceBuffer.remove()](https://w3c.github.io/media-source/#dom-sourcebuffer-remove) — HLS.js 默认配置自动 evict 已播 segment
- HLS.js docs:[`maxBufferLength`](https://github.com/video-dev/hls.js/blob/master/docs/API.md#maxbufferlength) — 默认 30s,可调
- Round-95:loading overlay 引入
- Round-98:togglePlay isEnded 分支 + timeupdate spinner 兜底
