---
title: Multi-quality 切换暴露：取消 + 触发条件（CF Stream 迁移）
type: decision
status: active
owner: Leon
created: 2026-05-03
updated: 2026-05-03
tags: [decision, adr]
---

# Multi-quality 切换暴露：取消 + 触发条件（CF Stream 迁移）

> **决策日期**：2026-05-03
> **触发**：Leon 询问 X / Instagram / YouTube 的 Quality 处理方式 →
> 推断现代标准是 HLS / DASH adaptive streaming，并提到"理论上 Uvera
> 视频应该都走 CF Stream"
> **决策方**：Leon
> **状态**：✅ Quality popup 已取消暴露 + CF Stream 迁移作为触发条件

## 背景

之前误判 Uvera 视频已走 CF Stream（Stream 自带 HLS adaptive 多分辨率），
基于此误判 commit `08d6929` 给 SparkMode 桌面 control bar 加了 Quality
popup（480p / 720p / 1080p）。

### Audit 结果（2026-05-03 实地查询）

```sql
SELECT
  CASE
    WHEN video ILIKE '%cloudflarestream.com%' THEN 'CF Stream'
    WHEN video ~ '^[a-f0-9]{32}$' THEN 'CF Stream id'
    WHEN video ILIKE '%.m3u8' THEN 'HLS manifest'
    WHEN video ILIKE '%.mp4' THEN 'MP4 single quality'
    ELSE 'Other'
  END AS source_type,
  COUNT(*)
FROM recommended_content
WHERE video IS NOT NULL
GROUP BY source_type;
```

| Source type | Count |
|---|---|
| MP4 single quality | **35** |
| CF Stream | 0 |
| HLS manifest | 0 |
| Other | 0 |

**100% 单文件 MP4**，存放在 `https://asset.uvera.ai/video_*.mp4`。
没有 CF Stream，没有 HLS，没有 multi-quality variants 的底层数据。

### 行业 Quality 处理标准（参考）

| 平台 | 协议 | 暴露 picker | 默认 |
|---|---|---|---|
| YouTube | DASH 主 / HLS fallback | 是（齿轮菜单） | Auto |
| X | HLS | 是（桌面） | Auto |
| Instagram | HLS | **否** | Auto |
| TikTok | HLS | 否（桌面也基本不暴露） | Auto |
| Cloudflare Stream | HLS + DASH（自动生成） | 自定义 | Auto |

共识：现代标准是 **adaptive streaming (HLS / DASH)** + auto-quality default，
manual picker 是可选（移动端通常隐藏）。**没有平台用"换 URL"的古早方式做
quality switch**。

## 决策

### 短期（现在）

**取消 Quality popup 暴露**。原因：
1. Prod 视频架构不支持 multi-quality（单 MP4 文件）
2. 暴露一个无效控件 = 用户感知"产品功能不可靠"
3. UI-only 假切换 = 反 UX 模式（用户期望切换生效）

实施：完全删除 SparkMode.jsx 里 Quality 相关代码（state / effect / UI /
QUALITIES 常量 / MonitorPlay import）。Row 2 控件少一项。

### 触发条件（命中即重启 multi-quality 暴露）

**触发 = CF Stream 迁移完成 + 占主流**。具体定义：

1. ✅ 后端有视频上传到 CF Stream 的流水线
2. ✅ 新生成视频默认走 CF Stream（不再写 asset.uvera.ai/.mp4）
3. ✅ `recommended_content.video` 字段或新增字段存 CF Stream id / iframe URL
4. ✅ 前端 `<Stream>` React component 已替换原 `<video>` 标签
5. ✅ 至少 **80%** prod 视频迁移到 CF Stream（可 audit SQL 验证）

满足上述任一显著进展时（不需全满足）即可重启评估，从 git 历史
`git cherry-pick 08d6929` 把 Quality popup 加回（spec 完整：state / ref /
effect / popup UI / QUALITIES const）。

### 长期目标

CF Stream + adaptive streaming 是行业标准，长期方向。本决策不影响那个目标的
推进，只是暂不暴露不可用的 UI。

## 不在本决策范围

- **是否启动 CF Stream 迁移** — 这是 backend / 业务策略决策，需费 + Leon
  对齐。本决策只处理前端 UI 暴露问题
- **Speed popup / 其他 control 的命运** — 不变，独立于 Quality
- **DB schema 变动** — 本决策**不动**任何 schema；MEMORY.md 高危规则未触发

## 关联

- `src/components/SparkMode.jsx` — Quality popup 删除 (line ~1880-1890)
- `src/components/SparkMode.jsx` — state/effect/QUALITIES 删除 (line ~101)
- Commit `08d6929` — Quality popup 实现，已取消暴露但代码可在 git 历史
  cherry-pick
- `docs/decisions/2026-05-03-glass-tier-system.md` — Speed popup 的 T-1a
  spec（Quality popup 之前共用 spec）
- `~/.claude/memory/MEMORY.md` — 高危变更规则（DB schema / API contract）
  本决策**未触发**

## 后续 action（待 Leon / 费分别推进）

- **费**：决定是否启动 CF Stream 迁移（独立于本决策，但是 trigger
  condition）
- **Leon**：迁移完成后，relay "可恢复 Quality popup" 给 main session
- **main session（未来）**：cherry-pick commit `08d6929` 加回 Quality
  popup，按时已就绪的 CF Stream API 接入真切换逻辑
