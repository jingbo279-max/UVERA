---
title: 决策授权制度
type: doc
status: active
owner: Leon
created: 2026-05-13
updated: 2026-05-13
tags: [governance, decisions]
---

# 决策授权制度

> **生效日期**：2026-05-13
> **决策方**：费（项目负责人）
> **适用对象**：所有 UVERA 开发参与者 —— 费、Leon、Claude（Admin Team Chat 频道内的 AI 助手），以及未来贡献者
> **配套**：Admin Dashboard → Team Chat 频道（实时三方协作通道）

## 这是什么

明确**谁能拍板什么事**，让小事不堵在费身上、大事不在 Claude 这里跑偏。

三个层级：

| 层级 | 含义 | 谁来做 |
|------|------|--------|
| ✅ **直接执行** | 不需要别人 ack，做完写 dev log 即可 | 看类别 |
| ⚠️ **先提议再做** | 草拟方案 / SQL / PR，**等明确"do it"再执行** | 看类别 |
| ❌ **只能你决策** | 别人只能给 input，最终拍板权在费 | 仅费 |

---

## Claude 的授权

### ✅ Claude 可以直接做

- **代码层操作**：函数命名、文件拆分、添加测试、refactor、性能优化、accessibility 修复
- **小 bug 修复**：用户报错明确、影响小、回滚成本低（如 typo、空指针、漏 import）
- **读 DB**：通过 `query_db` 工具运行 SELECT/WITH 查询，回答数据问题
- **回答技术问题** / 提架构方案 / 解释代码 / 估工时
- **写 dev log entry** / 写决策文档 / 更新 docs/
- **第三方 API 适配**：Neodomain 模型轮换、Stripe 字段路径变化、Anthropic SDK 版本升级
- **DB schema 加字段**：non-breaking 的 `ALTER TABLE ADD COLUMN`（带 default 不破坏现有 row）
- **诊断 bug 报告**：草拟根因假设 + 验证 SQL

### ⚠️ Claude 必须先 propose 再做

- **DROP COLUMN / DROP TABLE / DELETE FROM** 影响生产数据
- **改 API 接口**（端点路径、请求/响应字段）可能影响 Leon 前端或外部集成
- **新增 npm 依赖**（长期维护负担）
- **写迁移 SQL** 涉及数据 backfill 或 RLS 变更
- **打 release tag**（版本号决策）
- **删除 / 大幅重构现有功能**
- **跨组件大改**（同时影响 ≥5 个文件 且涉及行为变化）
- **改环境变量** 或部署配置

**触发方式**：在 Team Chat 里输出方案 + SQL/diff + 风险，等费或 Leon（在对应领域内）回复 "do it" / "ack" / "go" 后再 commit。

### ❌ Claude 永远不能直接做

- **真金白银动作**：退款 / 删除大批数据 / 改 Stripe 价格 / 给用户加 tokens >100
- **战略决策**：要不要做 X 功能、什么时候 GA、定价策略、用什么模式收费
- **法律 / 合规终审内容**：ToS / Privacy / DMCA / 内容审查准则 —— 起草可以，发布必须律师 + 费过
- **品牌 / 设计审美选择**：除非有明确 reference 或 Leon 给规范
- **用户沟通**：发邮件 / 站内信内容 —— 起草可以，发送前必须人审
- **生产数据库直接写**：哪怕是 SELECT-only 工具之外的任何操作，必须走人触发的端点

---

## Leon 的授权

Leon 是产品 / 设计 / 前端主导，在他的领域内**和费同等权限**。

### ✅ Leon 可以直接拍板

- **前端 UI / 设计**：色彩、布局、字体、动画、组件结构
- **用户文案 / Help Center 内容**：直接编辑 admin 的 Help Articles
- **产品决策**：功能优先级、信息架构、用户流程
- **PLANS.md、品牌相关文档**：直接更新
- **设计层面的 PR review**：可以直接 merge 纯前端 / 文案 PR

### ⚠️ Leon 先和费 / Claude 对齐再做

- **跨前后端的 API 契约改动**：和 Claude 在 Team Chat 对齐数据 shape，确认 Worker 改完后再切前端
- **影响业务流程的 UX 改动**：比如付款流程、Recast/Sequel 行为变化
- **新增需要后端支持的功能**：Leon 写 spec → Team Chat 讨论 → 费/Claude 实施

### ❌ Leon 需要费决策的事

- **价格 / 套餐 / 计费**：业务决策
- **法律 / 合规**：律师 + 费
- **production 直接操作**：跑 SQL / 改 env var / 退款
- **架构方向 / 技术栈选择**

---

## 费的领域

**费拥有最终决策权的事项**：

- 所有 ❌ 类别的事项（见上）
- 项目战略 / 商业模式
- 雇佣 / 合作 / 钱
- 任何**长期不可逆的**架构决策
- 任何**外部沟通**（投资人 / 律师 / 监管）

费**也是兜底**：当 Leon 和 Claude 意见分歧时，最终由费判。

---

## 落地：怎么走这套流程

### 场景 A：Leon 想加个功能

1. Leon 在 Team Chat 描述需求（`@claude` 或 `@fei`）
2. Claude 立刻评估：是否在他可直接做范围？
   - ✅ 是 → 直接 propose 实施方案 + 工时估
   - ⚠️ 涉及 DB / API 变更 → 写方案等 ack
3. 费如果没意见，Claude 拿到 ack 后开始动手
4. 完工后写 dev log entry

### 场景 B：Claude 发现 bug 想修

1. 在 Team Chat 提：「发现 X 问题，根因是 Y，建议修法 Z」
2. 影响小（typo / 空指针）→ 直接修，写 dev log
3. 影响大或涉及 DB → 等费 ack

### 场景 C：用户报告问题（测试反馈）

1. 费或 Leon 把问题贴到 Team Chat
2. Claude 立刻查 generation_logs / orders / 等数据
3. 给出诊断 + 修复方案
4. 修复执行按 A/B 规则

### 场景 D：Leon 要改设计 / 文案

1. 直接改，不用问
2. 写 dev log entry 同步即可
3. 如果改的是 PLANS.md 这种术语 spec，告诉 Claude 一声好同步代码命名

---

## 反模式

❌ **每件小事都问费** —— Claude 和 Leon 在自己授权范围内自主做。费不是审批官。

❌ **大事直接做不打招呼** —— ⚠️ 类别的事**必须 propose**。哪怕你 95% 确定对的。

❌ **绕过 Team Chat 私下决策** —— 跨 ≥2 人的决策**必须留痕在 Team Chat**。否则未来无法 audit。

❌ **Claude 假装有授权** —— 如果不确定一件事属于哪一类，**默认按 ⚠️ 处理 = propose**。

❌ **Leon 改后端 / Claude 改设计** —— 各做自己擅长的，跨领域时讨论后再动手。

---

## 调整 / 反馈

这份制度不是一锤子买卖。运行 1-2 个月后大家觉得：
- 某类决策应该升级 / 降级权限 → 在 Team Chat 提
- 某种新场景没覆盖 → 在 Team Chat 讨论后更新这份 doc
- 整个授权框架失灵 → 费拍板大改

更新这份 doc 本身**是 Claude ✅ 可以直接做的事**（毕竟是文档），但记得在 dev log 标 `compliance` tag 让大家看到。

---

## TL;DR 30 秒版

| 场景 | 怎么办 |
|------|--------|
| Leon 问"怎么实现 X" | Claude 立刻答 + 出方案 |
| Leon 问数据情况 | Claude 跑 SQL 立刻答 |
| Leon 说"帮我加 X 功能" | Claude 看难度：小直接做，大 propose 等 ack |
| Leon 想改 UI / 文案 | 直接改 |
| 用户报 bug | Claude 诊断 → 小修直接做 / 大改 propose |
| 涉及钱 / 删数据 / 改价格 / 法律 | 永远等费 |
| Leon 和 Claude 想法分歧 | Team Chat 讨论，僵局时 @ 费 |
