---
title: 并发 Session 协作协议
type: doc
status: archived
owner: Leon
created: 2026-04-26
updated: 2026-04-28
tags: [session, archive]
---

# 并发 Session 协作协议

> 本目录是 Uvera 项目并发 Claude Code session 的 scope 限定 + 协调规范。
> 起草时间：2026-04-26 · Leon

## 为什么需要这个

Uvera 项目模块多（Spark / Library / Profile / Create / Auth / Admin），单 session
跑久了上下文膨胀且效率下降。多 session 并发可以同时推进多个模块，但有协作风险：

- 同一文件被多 session 编辑 → git 冲突
- MEMORY.md / 设计 token / 共享组件被并发修改 → 后写覆盖前写
- 跨 session 产品决策 / 术语 / 后端契约不同步
- DB schema / API signature 改动需要费配合

本目录的文件解决这些。

## 目录结构

```
docs/sessions/
├── README.md              ← 本文件（协议总纲）
├── scope-1-spark-discover.md   ← 主 session：Spark/Discover/中央协调
├── scope-2-library.md          ← Library 模块全英化 + 视觉打磨
├── scope-3-profile.md          ← Profile 全部
└── scope-4-create.md           ← Create 全部（最敏感，依赖费的 Neodomain）

docs/decisions/
└── YYYY-MM-DD-<topic>.md  ← 跨 session 决策记录（产品 / 术语 / 后端契约）

docs/asks/
└── YYYY-MM-DD-<topic>.md  ← 致费的征询（顶部 ✅/⏸/⏳ 状态标记）
```

## 主 session 与子 session 的角色分工

### 主 session（Session 1）— Spark/Discover + 中央协调
- 维护 MEMORY.md（**唯一写权限**）
- 仲裁跨模块产品决策（其他 session 暂停问 → Leon → 决定 → relay）
- 处理高危变更（DB schema / API / 部署 / 设计系统 token）
- 兜底共享组件（index.jsx / main.jsx / 设计 token / SparkMode / Discover）
- 写 decision docs，做"广播中心"

### 子 session（Session 2/3/4）— 各自模块
- 只动自己 scope 内的文件
- MEMORY.md 不写，需沉淀的规则告诉 Leon relay 给主 session
- 触发高危规则（碰 backend）→ 暂停问主 session
- push 前必跑 `git pull --rebase --autostash`

## 费授权后的协调链路

当某 session 触发"需要后端配合 — 暂停执行"，Leon 转给费，费回复后按以下分流：

### 路径 A — "授权我们直接做"

费让我们直接动后端（schema / RLS / API endpoint 等）：

```
费 reply → Leon
        ↓
   主 session：
     1. 写 docs/decisions/YYYY-MM-DD-<topic>.md（授权范围 + 实施细节 + 风险）
     2. 更新对应 docs/asks/<file>.md 顶部加 ✅ 状态
     3. 判断改动归属：
        - 中央性（DB schema / 设计 token / index.jsx 等）→ 主 session 自己做
        - 子 session scope 内 → 主 session 写完 decision doc，**Leon relay 一句话**
          给该 session："费 OK 了，详细看 docs/decisions/<file>.md，接着做"
     4. 主 session 写 MEMORY.md（如果产生新规则 / 经验）
```

**示例（2026-04-25 Branch/Recast schema）**：
- 费回"我们直接做"
- 主 session 用 Supabase Management API 跑了 migrations/20260425_*.up.sql
- 写了 docs/legal/COMPLIANCE.md §2.4 / §3.3 + 更新 docs/asks/2026-04-25-*.md ✅
- 同步前端 normalizeRecommended.js + StoryGeneratorPage publish handler

### 路径 B — "费已经做了，前端接线"

费自己 push 了 backend：

```
费 push backend → main
        ↓
任何 session 下次 git pull --rebase --autostash 自动拿到
        ↓
请求 session 继续工作（git pull 时若发现费的相关 commit，主动看 commit
message 理解契约；不确定停下来问 Leon）
```

### 路径 C — "先不做，等我"

费要做但还没做完：

```
费 reply → Leon → 主 session：
  1. docs/governance/DEFERRED-DECISIONS.md 新增 D-XXX 条目
  2. relay 给请求 session："这块 backend 阻塞，跳过做下一项"
  3. 费做完后回到路径 A 或 B
```

## 冲突防范的核心原则

1. **主 session 是 broadcast 中心** — 跨 session 影响的改动必须经过主 session
   写到磁盘（decision doc / MEMORY.md / ask resolution），不靠对话内口头沟通
2. **决策都有书面** — 每条费授权 → `docs/decisions/YYYY-MM-DD-<topic>.md`。
   未来 session restart 翻文件就能 catch up
3. **写权限单点** — MEMORY.md 永远只有主 session 写，避免覆盖
4. **git pull --rebase --autostash** — 每个 session push 前跑，吸收别人的改动
5. **兜底审查** — 如果某 session 误改了别人的 scope，由主 session 代为审查 +
   revert 或合并

## Session 启动 / 重启的标准开场

新 session 启动后，第一条消息：

```
读取本 session 的 scope 文档：docs/sessions/scope-N-<module>.md
按其中"第一条消息你应该做"那段执行。
```

这样不用每次粘贴长 prompt，只读对应 scope 文件即可。

## 运行中 session 热同步 memory（broadcast 协议）

**问题**：Claude Code session 启动时读 `~/.claude/memory/MEMORY.md` + 它点名读的
topic 文件，存进对话上下文。**之后 memory 文件被改/新增，运行中 session 不会
自动感知**。如果主 session 在 session 3 启动后写了一条新术语规则，session 3
继续工作时仍按旧规则跑。

### 手动 relay 步骤（Leon 执行）

1. **主 session** 写完新 memory 文件 + 更新 `MEMORY.md` 索引（已有 commit）
2. **Leon 复制下面的 relay 模板**，到每个受影响的 sub-session 发一次：

   ```
   读 ~/.claude/memory/<新 memory 文件名>.md，吸收里面的规则。
   之后所有 [描述涉及范围] 都按这条执行。
   ```

   例：
   ```
   读 ~/.claude/memory/project_terminology_avatar_vs_profile_pic.md，
   吸收 Avatar（数字分身）vs Profile picture（账号头像）的区分规则。
   Profile 相关 UI / 文案 / 命名一律按 Profile picture，不用 Avatar。
   ```

3. **Sub-session** 收到后用 `Read` 工具拉文件进上下文，从此按新规则工作

### 哪些 session 需要 relay

只 relay **可能涉及该规则的 session**。例：
- 新增"出镜 Recasts"术语 → relay Session 2 (Library) + Session 4 (Create)
- 新增"Avatar vs Profile pic" → relay Session 3 (Profile)
- 新增"高危变更暂停规则" → relay 全部 sub-session

不相关 session 不必 relay（避免对话上下文膨胀）。

### 不需要 relay 的情况

- **新建 docs/decisions/** 决策记录：sub-session 不会主动读 docs/，Leon 在让它做
  涉及该决策的具体任务时再 relay 即可
- **memory feedback_*.md 反馈规则**：通常对所有 session 都适用，可以等 session
  自然 restart 时新启动会读到。如果当下就要生效再 relay
- **MEMORY.md 索引行变动**：sub-session 不会主动重读 MEMORY.md。要让它读到，必须
  直接 relay 索引指向的 topic 文件

### 反模式

❌ 在主 session 对话里说"我已经更新了 memory"，期待其他 session 也知道 — 它们看不到
这个对话

❌ 让 sub-session "重新读取 MEMORY.md" — Claude 会用 Read 工具读，但**已有的对话
上下文不会清掉**，旧规则和新规则可能冲突。直接读 topic 文件更精准

✅ 总是 relay 具体的新 topic 文件路径 + 适用范围，让 sub-session 拉进上下文

## 跨 session 沟通 anti-patterns

❌ **不要这样**：在 Session 2 对话里说"我刚改了 SparkMode 的 X"。其他 session
看不到这个对话，只能通过 git diff 或 MEMORY.md 知道。

✅ **要这样**：Session 2 改完通过 git push 落地 → 其他 session git pull 拿到 →
若有跨 session 影响（罕见），主 session 写 MEMORY.md 或 decision doc 沉淀。

❌ **不要这样**：两个 session 同时编辑 index.jsx 不同区域，分别 push。后推的
会 rebase 出冲突，需要解。

✅ **要这样**：index.jsx 类共享文件归主 session 所有。其他 session 想动 → 暂停
问主 session。

## 应急情况

### Session 间发现冲突的 commit

主 session 用 `git log --all --oneline` 查时间线，决定：
- revert 后写的（保留先写的）
- 还是手动 merge 两个改动

### 某 session 写错了 MEMORY.md

主 session 唯一有写权，子 session 不应该写。如果误写了，主 session `git revert`
该 commit。

### 跨 session 决策反复（产品方向变更）

主 session 写新 decision doc 覆盖老的，并在所有相关 session 的下一次启动时让
Leon 提示"先看 docs/decisions/最新的"。
