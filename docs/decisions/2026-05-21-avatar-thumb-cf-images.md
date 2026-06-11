---
title: Avatar 缩略图压缩走 CF Images / R2 Transforms（方案 A）
type: decision
status: active
owner: fei
created: 2026-05-21
updated: 2026-05-31
tags: [decision, performance, cf-images, library]
---

# Avatar 缩略图压缩走 CF Images / R2 Transforms（方案 A）

> **决策日期**：2026-05-31（issue 提出于 2026-05-21）
> **触发**：Leon 提 P2 — Library Avatar 列表加载慢，原图 photo_url 直接渲染（~2-5 MB/张），desktop 列表常带 9-12 张
> **决策方**：fei
> **状态**：✅ 采用方案 A（CF Images URL transforms），Leon 开 PR

---

## 背景

Library Avatar 列表（`<AvatarThumbCard>`）渲染时直接用 `<img src={avatar.photo_url} />`，原图来自 R2，分辨率多在 2048×3072 左右、~2-5 MB/张。Desktop 一次加载 9-12 张 → 首屏 20-50 MB 带宽。Leon 提出两套备选：

| 方案 | 思路 | 实现 |
|---|---|---|
| **A** | CF Images / R2 Transforms 边缘压缩 | URL 加参数 `?w=400&fit=cover&f=webp`，CF 边缘节点出图 |
| **B** | Worker 上传时跑 sharp WASM 生成缩略图 | 上传 pipeline 多一步，存独立 thumbnail R2 key |

## 决策

**走方案 A**。

## 论据

### 1. 零代码改动
URL 加查询参数即可，**不动 worker upload pipeline**。Leon 只需在 `<AvatarThumbCard>` 把 `src` 包一层 helper：
```jsx
<img src={getThumbUrl(avatar.photo_url, { width: 400, fit: 'cover' })} />
```

### 2. Worker 复杂度已经够重
`public/_worker.js` 当前约 12000+ 行，已经塞了 Stripe / Reconcile / CF Stream / system_settings / TeamChat / generation_logs / drama paywall / BytePlus Asset Library 等等。再加 sharp WASM 处理 = 维护面又涨一层（每次 CF runtime 升级都要 verify WASM 兼容性）。

### 3. CPU 时间 vs 月费成本对比
- **方案 B**：WASM 压缩每张 ~300-800ms CPU。Free user 大规模上传场景下，CPU 秒数累计可能比 CF Images $5/月还贵。
- **方案 A**：$5+/月起，按当前营收节奏（`yazhongliu186` $25/mo subscription 起步 + 数个 Lite 转化）压力极小。

### 4. Worker cold-start UX
sharp WASM 加载 100-300ms cold-start overhead → 上传感知变慢，方案 A 没这个开销。

### 5. Edge cache 自动
CF 全球节点自动缓存 transformed 图，无需我们管 invalidation。重复访问同一缩略图 → bandwidth ≈ 0（只算第一次 transform）。

### 6. 未来弹性
后面想加 `srcset` / responsive image / format negotiation（AVIF / WebP / JPEG fallback）都是 URL 参数级别改动，**零迁移成本**。

## Leon 接下来开 PR 建议

### 启用 CF Images / R2 Transforms
- `wrangler.jsonc` 或 Cloudflare Dashboard 启用 Polish / Images
- URL 模式 `https://uvera.ai/cdn-cgi/image/<options>/<original-url>`
- 或者 R2 自定义域名直接接受参数

### 替换 `<AvatarThumbCard>` 的 src
旧：
```jsx
<img src={avatar.photo_url} />
```
新：
```jsx
<img src={getThumbUrl(avatar.photo_url, { width: 400, fit: 'cover' })} />
```
或者抽 helper：
```js
const getThumbUrl = (url, { width = 400, fit = 'cover', format = 'webp' } = {}) =>
  `https://uvera.ai/cdn-cgi/image/width=${width},fit=${fit},format=${format}/${url}`;
```

### Fallback chain
CF transform 失败 → 浏览器自动 fallback 到原图（已有 skeleton + onError 兜底），不需要额外逻辑。

### 监控（PR merge 后第一周）
- CF Dashboard → Images → Usage：transform 次数 + bandwidth saved
- 如果月费 > $50：考虑加 cache headers 或 srcset 进一步降频

## 复用范围

helper 抽出来后，**所有用户头像 / 角色卡 / 视频 thumbnail** 都可以用同一个 transform URL pattern，统一加速 + 减带宽。优先迁移顺序建议：

1. Library AvatarThumbCard（本次 PR）
2. Discover MasonryGrid card cover
3. SeriesDetailPage episode thumbnails
4. AdminDashboard generation_logs thumbnail preview

## 为什么不选方案 B（决策记录）

| 维度 | 方案 A | 方案 B |
|---|---|---|
| 代码改动 | URL helper 1 处 | upload pipeline + sharp wasm 集成 |
| Worker 复杂度增加 | 0 | +1 重型依赖（WASM 加载、cold start、CPU 占用） |
| CPU 成本 | 0（CF 边缘出图） | 每张 300-800ms CPU |
| 月费 | $5+/月（含 100k transforms） | 0（但 CPU 时间换钱） |
| Edge cache | 自动全球 | 需手动 invalidation 策略 |
| 未来扩展（srcset / AVIF） | URL 参数 | 后端再加一轮压缩 |
| 维护面 | 0 | CF runtime 升级时要 verify WASM 兼容 |

## v1.2.0 Backlog 影响

- ✅ Library P2「Avatar 加载慢」标 done（决策已下，PR 交给 Leon）
- 📋 helper 落地后，可以顺手把其他静态图也走 CDN transform（Discover / SeriesDetail / Admin）
- 不阻塞 v1.2.0 启动；Leon ship 时机由他自己排
