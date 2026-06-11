---
title: 文档系统约定
type: reference
status: active
owner: Claude + Leon
created: 2026-05-30
updated: 2026-05-30
tags: [meta, docs-system]
---

# 文档系统约定（Documentation Conventions）

> 本项目所有 `.md` 文档的**单一标准**。Claude 维护文档时遵循此约定;Leon 可直接读 / 改。
> 这是一个**可复制到其他项目**的知识系统骨架(见 memory `docs-knowledge-system-vision`)。
> 配套工具:`scripts/docs/index.mjs`(生成索引)、`scripts/docs/lint.mjs`(校验,接 CI)。

---

## 1. 核心原则

1. **一切皆带 frontmatter 的 Markdown 记录** —— 每个 `.md` 文件顶部有 YAML frontmatter(下方 schema),工具据此自动索引 / 校验。
2. **git 是唯一载体** —— 不引外部 SaaS。文档可 diff、可 PR review、可版本回溯。
3. **改动同步引用、清废弃、零残留** —— 见 memory `discipline-update-references-on-change`。移动 / 改名 / 删除任何文档,必须同一改动里更新所有引用 + lint 复查。
4. **索引自动生成,不手维护** —— `docs/README.md` 由 `index.mjs` 从 frontmatter 生成,禁止手改。

> 注:**Bug / 任务不在本 Markdown 系统内** —— 它们跑在**费提供的飞书**(甲方在飞书提 Bug)。规划方向是让 Claude 接入飞书:拉取条目 → 验证 → 能直接修的就 修+验证+commit+push+写 dev log,只有真需要 Leon 介入的再升级协作(见 vision,引入时机看进展)。本约定只管**持久正式文档 / Wiki**。
>
> **方法论依据**:本结构遵循 [Diátaxis](https://diataxis.fr/)(按读者需求组织)+ 内部 KB 最佳实践(层级 ≤3 层 / folder 主结构 + frontmatter facet / 每篇 owner + 过期复检)。工具分工:飞书=ticket,git docs=持久文档,`decisions/`=决策依据。

---

## 2. Frontmatter Schema

| 字段 | 必填 | 取值 | 说明 |
|------|------|------|------|
| `title` | ✅ | string | 文档标题(用于索引显示) |
| `type` | ✅ | `doc` `decision` `spec` `plan` `ask` `release` `legal` `reference` | 记录类型 |
| `status` | ✅ | `active` `draft` `superseded` `resolved` `archived` | 生命周期状态 |
| `owner` | ✅ | string | 负责人(`fei` / `Leon` / `Claude` / `律师`) |
| `created` | ✅ | YYYY-MM-DD | 创建日期 |
| `updated` | ✅ | YYYY-MM-DD | 最后实质更新(改内容时同步) |
| `tags` | ◻️ | [string] | 检索标签 |
| `supersedes` | ◻️ | path | 本文取代了哪个旧文档 |
| `superseded_by` | ◻️ | path | 本文被哪个新文档取代(配 `status: superseded`) |
| `source_of_truth` | ◻️ | bool | 标记该领域权威源(如 PRODUCT-DESIGN) |

---

## 3. 目录结构（target taxonomy）

**按"读者要回答什么问题"组织(Diátaxis 思路),≤3 层,交叉维度交给 frontmatter `tags` facet:**

```
docs/
├── README.md             # 🤖 自动生成索引(勿手改)
├── CONVENTIONS.md         # 标准(本文件)
├── product/              # 「是什么/为什么/给谁」产品叙事·设计 SoT·交付清单·订阅方案
├── design/               # 「长什么样」设计系统 — Leon 主场
│   ├── system/           #     tokens·glass·material·color 等参考
│   └── iterations/       #     设计迭代过程 + 参考图
├── engineering/          # 「怎么建/怎么运维」技术栈·后端契约·部署策略
├── guides/               # 「怎么做 X」功能规格·媒体处理·runbook(HERO-LAYOUT·MEDIA_*·VIDEO_COMPRESSION·GLOBAL_MUTE·seedance)
├── decisions/            # 「为什么这么定」ADR(按日期,现有)
├── governance/           # 「我们怎么协作」决策授权·开发日志·延期决策(DEFERRED-DECISIONS)
├── legal/                # 「合规红线」TERMS·PRIVACY·CONTENT-LICENSE·COMPLIANCE
├── releases/             # 发布记录(RELEASE-v*)
├── collaboration/        # 跨方协作:asks(致费)·sessions — 仅 status:active
└── archive/              # 过时/已解决/费侧维护快照
```

> 交叉维度(端类型、产品模块、负责人等)不开新目录,用 frontmatter `tags` 标注,工具可 faceted 检索。

### 归档规则

- **费侧 API 文档**(`API接口文档-*`、`AI图片生成*`、`登录和加入企业*`、`NeoAI_*`、`OSS-STS*`、`(旧）*`、`.docx/.txt/.postman`)→ `archive/fei-api/`,frontmatter `status: archived` `owner: fei`。**由费侧维护,此处仅历史快照。**
- **已解决 asks / 完成 sessions** → `archive/`,`status: resolved`。
- **被取代的文档** → 不立即删,标 `status: superseded` + `superseded_by`,定期清。

---

## 4. 命名

- 文件名 kebab-case 英文;决策 / 计划 / ask 带日期前缀 `YYYY-MM-DD-<slug>.md`(沿用现有 decisions/ 习惯)。
- 一篇文档一个主题;过长拆分并互相 `[[link]]`。

---

## 5. 维护工作流（Claude 自动执行）

1. 新建 / 改文档 → 填全 frontmatter,`updated` 设当天。
2. 移动 / 改名 / 删除 → `grep -rn` 全仓改掉所有引用(含本 docs、CLAUDE.md、README、代码注释)。
3. 跑 `npm run docs:lint` → frontmatter 合规 + 链接零 broken + 过期告警。
4. 跑 `npm run docs:index` → 重新生成 `docs/README.md`。
5. 提交。

> 此工作流将固化进 `.claude/skills/docs-maintain`,每个 session 自动遵循。
