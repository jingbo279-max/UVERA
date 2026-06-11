---
title: Subscription / Upgrade Plan 模块归入 Session 3 scope
type: decision
status: active
owner: Leon
created: 2026-04-29
updated: 2026-04-29
tags: [decision, adr]
---

# Subscription / Upgrade Plan 模块归入 Session 3 scope

> **决策日期**：2026-04-29
> **触发**：Leon 提问 "UPGRADE Plan 页面是否属于 Session 3 权限范围"，主 session
> 确认当前不在，Leon 决定扩入
> **决策方**：Leon
> **状态**：✅ 已落地

## 背景

之前 `docs/archive/sessions/scope-3-profile.md` 仅列：
- `src/pages/MobileProfilePage.jsx`
- `src/pages/SettingsPage.jsx`
- `src/pages/profile/**`

`src/pages/SubscriptionPage.jsx` 不在内 → 属"无 owner，主 session 兜底"。

## 决策

`SubscriptionPage` 本体 + `src/pages/subscription/**` 子组件 / 文档归入
**Session 3** scope。理由：
- 用户视角：账户 / 设置 / 计划 / 头像 都是同一心智（user account 区域）
- 维护一致性：归一处 session 维护，避免主 session 与未来 Subscription session
  并发改动冲突
- Profile 已有 Upgrade plan CTA，目标 page 与触发点同 session 维护更连贯

## 边界保留（避免 scope 蔓延）

仍**不属** Session 3 scope：
- `src/components/MasonryGrid.jsx` 的 `UpgradePromoCard` — 主 session 管
  （它在 Discover 瀑布流里，属推荐内容流而非账户区）
- 真实支付服务接入（Stripe / Apple IAP / 微信支付）— 高危，需 Leon + 费
  + 法务三方对齐
- subscription / billing DB schema 变动 — 高危

## 实施

1. ✅ 改 `docs/archive/sessions/scope-3-profile.md`：
   - 标题改为 "Profile + Subscription"
   - 角色 / 范围加入 SubscriptionPage 路径
   - 新增 "Subscription / Upgrade Plan 模块" 小节，列入口、上下文、约束
   - "本 session 任务" 加 Subscription 相关增强点
   - "不要做" 加 "不接支付 / 不改 UpgradePromoCard"

2. ✅ 主 session 写本 decision file

3. ⏳ Leon relay 给 Session 3，让其 Read 新 scope file

## Relay 模板（给 Leon 复制粘贴用）

```
Session 3 scope 扩展（2026-04-29 Leon 决策）：

读 docs/archive/sessions/scope-3-profile.md（已更新）+
docs/decisions/2026-04-29-subscription-into-session-3.md（决策记录）。

新增你的 scope：
- src/pages/SubscriptionPage.jsx 本体
- src/pages/subscription/** 如需新建

约束：
- 纯前端 / 静态 plan UI 你可以做
- 真实支付服务（Stripe / IAP / 微信）禁接 — 高危需法务对齐
- subscription / billing DB schema 不动 — 高危
- src/components/MasonryGrid.jsx 的 UpgradePromoCard 仍归主 session（不动）

之后 Profile / Settings / Subscription 三页面改动都你出。继续手头工作即可。
```

## 关联

- `docs/archive/sessions/README.md` — 协议总纲（说明 scope 变更流程）
- `docs/archive/sessions/scope-3-profile.md` — Session 3 scope 文档（本次更新）
- `~/.claude/memory/MEMORY.md` — 高危变更规则（subscription 支付 / DB 触发）
