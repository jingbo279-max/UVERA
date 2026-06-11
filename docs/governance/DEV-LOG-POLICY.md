---
title: 开发日志制度
type: doc
status: active
owner: Claude
created: 2026-05-13
updated: 2026-05-13
tags: [governance, dev-log]
---

# 开发日志制度

> **生效日期**：2026-05-13
> **决策方**：费（项目负责人），与 Leon（产品）确认
> **适用范围**：所有 UVERA 开发人员（当前：费、Leon、Claude；未来：合同工、新员工）

## 这是什么

一个**团队每日活动记录**，活在管理后台里，入口在 **Admin Dashboard → Dev Log** 标签页。每条覆盖一天的工作，记录 release、新功能、修 bug、运维操作、做出的决策。

把它当成团队的**日记**——可搜索、跨作者、长期保存、对没有 git 权限的非工程团队成员（Leon）可见。

## 为什么有这个

1. **跨团队可见性** —— Leon（产品 / 甲方接口）不用读 git log 就能看到工程在干嘛
2. **审计追溯** —— 每条都有 `created_by` + `updated_by`，6 周后出问题反查能快速定位上下文
3. **新人上手** —— 未来合同工 / 新员工读日志，不用追着问"5 月那阵子发生了啥"
4. **故障复盘** —— 生产事故诊断时，能立刻看到事故前几天改过什么
5. **Release notes 的素材池** —— 下一个版本要 tag 时，对应时间段的日志就是写 `public/release-notes.json` 的原材料

## 制度细节

### 谁来写

**当天 ship 了代码 / 做了运维的所有人**。具体说：

- 费（全栈）
- Leon（前端 / 设计，只要写了代码或做了决策都算）
- 未来的合同工 / 员工 —— 入职必读本文档

多人协作的日子，一条 entry 可以有多个作者，编辑时把自己加进 `authors` 数组。

### 什么时候写

**当天下班前。** 触发条件：

- ✅ **打了 release tag**（如 v1.1.2）—— 写一条 release 级别的总结
- ✅ **新功能上生产** —— 哪怕是小功能也要写
- ✅ **修了 bug**，只要是用户或 ops 感知得到的
- ✅ **运维操作** —— 跑了 migration、改了 env var、排查了测试反馈
- ✅ **做了决策**，影响后续工作的（比如"Lite 套餐从 trial 改成一次性"）
- ✅ **调查 / 排查** —— 哪怕没得出结论，也要把假设和下一步写下来

**可以跳过的日子**：

- 真的啥都没干（周末、节假日、病假）
- 纯代码 refactor 没有功能 / 决策变化（**还是建议留一句话**，避免日历上看着像消失了）

### 写什么

**必填字段**：

| 字段 | 用途 |
|------|------|
| `entry_date` | 这条 entry 覆盖的日期（UTC）|
| `title` | 一句话标题，例如「v1.1.2 发布 + 上传问题排查」|
| `body` | Markdown 正文，结构见下方模板 |
| `authors` | 当天的贡献者 |
| `tags` | 分类标签，用于过滤 |

### Body 结构模板（建议）

自由 Markdown，但大多数日子能套这个壳。**记得用标题分块**。

```markdown
### 发布 v1.x.x   <!-- 当天有 release 才写 -->

- ship 了什么
- ship 了什么

### Bug 修复 / Hot patch

- 哪里坏了、做了什么、后续要观察什么

### 运维 / Ops

- 跑过的 migration
- 改过的 env var
- 接触过的外部服务（Stripe / Resend / Cloudflare / Supabase / ...）

### 决策

- 影响后续工作的任何事
- 关联到 `docs/decisions/YYYY-MM-DD-*.md` 的链接

### 调查 / 排查

- 测试反馈、debug 思路
- 没解决的也记 —— 至少留假设和下一步

Commits: 短sha1 短sha2 ...
```

末尾列上当天相关的 commit SHA，方便未来读者直接 `git show` 进去看。

### 标签分类

小写、逗号分隔。约定标签：

| 标签 | 何时用 |
|------|--------|
| `release` | 打了新版本 tag |
| `feature` | 上了新功能 |
| `fix` | 修了 bug |
| `refactor` | 重构（行为不变）|
| `devops` | 构建 / 部署 / CI / 基础设施 |
| `ops` | 手动生产操作（跑 SQL / 改 env var / 配置外部服务）|
| `ux` | 设计打磨 |
| `pricing` | 价格 / 计费相关变更 |
| `compliance` | 法律 / 隐私 / 安全 |
| `investigation` | 调查或研究，未得结论 |

一条 entry 可以有多个标签。Admin UI 支持按标签筛选。

## 怎么用

### 读日志

Admin Dashboard → 左侧 sidebar → **Dev Log**。最新的在最上面。点上方标签 chips 可以筛选。

### 写日志

点 **+ New entry**：
- 日期默认今天
- 作者字段当前默认为 `fei`（之后会改成根据登录用户动态填，先这样将就 —— 直接改成你自己的 handle 即可）
- Body 是 Markdown 文本框
- 保存后立即出现在列表里

要编辑已有的，点对应 entry 的 **Edit** 按钮。编辑会自动记录 `updated_by` 和 `updated_at`，谁改的、什么时候改的都能查。

### 备份 / 导出

数据存在 `public.dev_log_entries`。Supabase 标准备份就包含这张表。

需要临时导出：

```sql
SELECT entry_date, title, authors, tags, body
  FROM dev_log_entries
 ORDER BY entry_date DESC;
```

## 反模式（请避免）

❌ **借口"今天没啥可写"就跳过** —— 只要有东西上了生产（提交了 commit、部署了、改了 env var），就写一行。

❌ **几周后再补日志** —— 这个制度的有效性建立在 24 小时内记下来。如果落下了，写一条"区间总结"覆盖那段时间，**不要伪造逐日 entry**。

❌ **写营销口吻** —— 这是给团队看的，不是给用户看的。直白点："Stripe 轮换了密钥导致 checkout 500，已修"，不是"我们提升了支付基础设施的可靠性"。

❌ **直接粘 commit message** —— commit 本身就在那。日志要补充**上下文**：为啥这么做、先尝试了什么、推迟了什么。

❌ **只贴 git 链接** —— 任何人读日志应该**不点击 commit** 就能理解当天发生了啥。

## 未来增强（待定）

- 用 `git log --since='1 day'` + LLM 自动生成 draft
- 在前端公开 timeline 体现透明度（独立于 release notes）
- 新 entry 时 Slack/Discord 推送通知
- `@mention` 语法，被 mention 的作者会收到通知

想加的话开个 issue 或在 `docs/decisions/` 写提案讨论。

## 初始种子

`migrations/20260513_dev_log.up.sql` 已埋入 **2026-05-11、2026-05-12、2026-05-13** 三天的 entry，覆盖 v1.1.1 → v1.1.2 + 今天部署 + 上传问题排查。之后的日子由大家自觉填。

---

## 新贡献者快速版

1. 今天干了活 → 进 Admin → Dev Log → 点 New entry
2. 日期 = 今天，author 填你的 handle，tag 从上面列表挑
3. Body = Markdown，按推荐结构写
4. 末尾贴 commit SHA
5. **一天 3 分钟**。真的啥都没干才能跳。
