---
title: Tokens Studio 切换决策：暂缓 + 触发条件
type: decision
status: active
owner: Leon
created: 2026-04-29
updated: 2026-04-29
tags: [decision, adr]
---

# Tokens Studio 切换决策：暂缓 + 触发条件

> **决策日期**：2026-04-29
> **触发**：实现 SparkMode 右侧 info pane 时遇到 Figma 的
> `Windows/(Stroke) Glass Specular` token 在 Variables API 返回空字符串
> （Figma 原生 Variables 类型不支持 gradient stroke），引发对"是否
> 切换 Tokens Studio 插件作为 design token source of truth"的讨论
> **决策方**：Leon
> **状态**：✅ 暂不切 + 触发条件已明确

## 背景

### 当前 design token 链路

- **source**：`src/design-system/tokens/index.css` @theme block（约 60 token）
- **同步脚本**：`scripts/sync-design-tokens.js`
- **mapping**：`tokens/code-connect-map.json`
- **Figma 端**：原生 Variables（`lKatfXIfgAii0NHTXenM71`）
- **覆盖类型**：COLOR / FLOAT / STRING / BOOLEAN（Figma Variables 仅支持这 4 类）

### 触发问题

实现 right pane (Figma node `139:23912`) 时，Figma 端引用了 token
`Windows/(Stroke) Glass Specular`。MCP `get_variable_defs` 返回：

```json
{
  "Windows/Glass": "#808080",
  "Windows/(Stroke) Glass Specular": "",
  "Blur + Shadow Small": "Effect(type: BACKGROUND_BLUR, radius: 100); ..."
}
```

`Glass Specular` 是 **gradient stroke**，Figma Variables 装不下，故返回
空字符串。`get_design_context` 把它塌成单色 `rgba(255,255,255,0.4)`，
导致初次实现的 border 太硬，需要 hand-tune CSS gradient 还原。

## 评估

### Tokens Studio 切换的收益

1. **复合 token 类型完整**：typography / gradient stroke / boxShadow chain /
   composition 都可登记为 token
2. **W3C DTCG 格式 → 跨平台**：单 `tokens.json` 喂给 Style Dictionary →
   CSS / Tailwind / iOS / Android / Flutter
3. **Multi-theme**：themes 多轴叠加（dark + compact + brand-A）
4. **PR-based 同步**：Figma push GitHub → tokens.json diff 可 review /
   rollback
5. **资产化**：DTCG 是行业标准，乙方未来给其他客户复用门槛低

### 切换的成本

1. **一次性 migration**：60 token 重新登记，约 1-2 天
2. **设计师工作流变更**：Leon 从 Figma Variables 面板切到 Tokens Studio
   插件面板
3. **订阅成本**：Pro 档 $10/seat/月（解锁 GitHub 同步），1-2 人 = $10-20/月
4. **生态风险**：Figma 原生 Variables 1-2 年内可能补齐 typography /
   gradient，届时反向切回成本
5. **双 source of truth 风险**：Tokens Studio 与原生 Variables 并行需严格
   约定，否则同步混乱

## 决策

### 短期（现在 → Uvera production 内测）

**不切**。当前 60 token 量级 + 单 Web 单品牌，sync-design-tokens.js +
@theme 链路够用。这次 specular stroke 走 hand-tune CSS gradient
（`linear-gradient(170deg, ...)` via padding-box/border-box trick），不
为单一 token 需求引入工具链变更。

### 中期触发条件（满足任一即重新评估）

1. **Uvera 决定做 iOS / Android Native App** — Tokens Studio 是
   multi-platform 通用语，单 Web 优势线性放大
2. **乙方拿到第二个 design system 重的客户** — DTCG 格式 = 可复用资产，
   单价随积累上升
3. **Figma 原生 Variables 长期未支持 gradient stroke / typography
   composite**（观察 1-2 年）— 若 Figma 已跟上，可不切
4. **Uvera 启动 multi-brand / 白标战略** — themes 多轴比 CSS override
   干净

## 不在本决策范围

- 当前 60 token 整理 / 重命名 / 三层结构（primitive → semantic → component）
  优化 — 不需要 Tokens Studio 也能做，按需推进
- code-connect-map.json 的扩充 — 与 Tokens Studio 解耦，独立演进
- gradient stroke 等复合 effect 的 hand-tune CSS — 当前路径

## 关联

- `src/design-system/tokens/index.css` — 当前 token source
- `scripts/sync-design-tokens.js` — 当前同步链路
- `tokens/code-connect-map.json` — 组件映射雏形
- `docs/decisions/2026-04-29-subscription-into-session-3.md` — 同日 scope 决策
- `~/.claude/memory/MEMORY.md` — design system 架构小节

## 后续 action

无立即 action。待触发条件命中时，启动新 decision file 评估迁移方案。
