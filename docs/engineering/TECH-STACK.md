---
title: Tech Stack（技术栈）
type: doc
status: active
owner: fei
created: 2026-04-18
updated: 2026-05-30
tags: [engineering, tech-stack]
---

# Tech Stack（技术栈）

> **项目**：longvv — 智能音乐流媒体与内容生产系统
> **最后更新**：2026-03-02

---

## 一、当前状态（原型阶段，已部署）

| 层级 | 技术 | 说明 |
|------|------|------|
| 前端框架 | React 19 + Vite 7 | SPA，原型阶段使用 |
| 样式 | Tailwind CSS 4 | Utility-first CSS |
| 部署 | Cloudflare Pages | 基于 GitHub 主干自动构建部署 |
| 域名 | uvera.ai | Cloudflare 分配的独立子域名 |
| 数据 | 静态 JSON（`src/data/`） | 无后端，无数据库 |

---

## 二、目标技术栈（16 周正式开发，SRS v2.0）

### 2.1 前端

| 技术 | 用途 | 说明 |
|------|------|------|
| Next.js / Nuxt.js | 前端框架（SSR/SSG） | 替代纯 SPA，支持 SEO、服务端渲染 |
| Tailwind CSS 4 | 样式框架 | 沿用，设计 Token 已建立 |
| React 19 | UI 组件库基础 | Next.js 场景下保留 |

> 框架最终选型（Next.js vs Nuxt.js）在 Phase 0 确认。

---

### 2.2 后端 / API

| 技术 | 用途 | 说明 |
|------|------|------|
| Cloudflare Workers | API 层（无服务器） | 边缘计算，冷启动极低；CPU 限额 30s（重计算须外部化） |
| Cloudflare KV | 缓存 / Session / Token | 读多写少的轻量 K-V 存储 |
| Cloudflare Durable Objects | 实时状态（直播间、打赏池） | 强一致，支持 WebSocket |
| JWT + Refresh Token | 认证鉴权 | 无状态 Token，含权限等级 |

---

### 2.3 数据库

| 技术 | 用途 | 说明 |
|------|------|------|
| MySQL / PostgreSQL | 主关系型数据库 | 用户、资产、订单、审计等核心数据 |
| Redis | 热点缓存 / 计数器 / 队列 | 播放计数、点赞、异步任务队列 |
| Elasticsearch | 全文搜索 | 音乐、作者、标签搜索 |

**ID 生成**：Snowflake 算法（雪花 ID），所有实体主键统一使用（替代 UUID/ULID）

**软删除**：所有资产实体使用 `is_deleted = 1`，禁止物理删除

---

### 2.4 文件存储 & CDN

| 技术 | 用途 | 说明 |
|------|------|------|
| Cloudflare R2 | 音频文件、封面图、普通视频存储 | S3 兼容，无出站流量费 |
| Cloudflare Stream | 视频点播（MV、Story Video） | 自适应码率、内置 CDN |
| Cloudflare CDN | 全局静态资源加速 | 与 Workers / R2 / Stream 一体化 |

---

### 2.5 直播

| 技术 | 用途 | 说明 |
|------|------|------|
| Cloudflare Stream Live | 推/拉流核心 | RTMP 推流，HLS/DASH 拉流 |
| AWS IVS Timed Metadata | 礼物特效音画同步 | 直播打赏时礼物动效与音频精准对齐 |
| Cloudflare Durable Objects | 直播间状态同步（在线人数、打赏池） | WebSocket 持久连接 |

---

### 2.6 AI 能力

| 能力 | 服务 | 说明 |
|------|------|------|
| AI 音乐生成（Prompt → Music） | 外部 AI API（Suno / Udio，待选型确认） | Webhook 回调，结果存 R2 |
| AI 音乐生成（参考音频 → Music） | 同上 | |
| Story Video 生成（数字人 + AI 视频） | **Neodomain AI 系统**（乙方自建算力） | 重计算，由 Neodomain GPU 节点处理 |
| 音频人声分离 / 伴奏提取 | 外部 GPU 节点（AWS EC2 / Lambda） | CF Workers CPU 上限 30s，须外部化 |

---

### 2.7 支付

| 技术 | 用途 | 说明 |
|------|------|------|
| Stripe Connect | 创作者收益分润 | Separate Charges & Transfers（打赏池）/ Destination Charges（直接购买） |
| KYC / W-8BEN | 创作者税务合规 | Stripe Connect 托管 KYC 流程 |

---

### 2.8 部署目标

| 层级 | 目标方案 | 当前方案（迁移前） |
|------|---------|-----------------|
| 前端托管 | Cloudflare Pages | Cloudflare Pages |
| API | Cloudflare Workers | 无（静态） |
| 存储 | Cloudflare R2 + Stream | 本地 public/ 目录 |
| 域名 | Cloudflare 分发域 | Cloudflare 分发域 |

> 完全切换为基于 GitHub Commit 的 Cloudflare 生态系统部署。

---

## 三、架构限制与注意事项

| 限制 | 说明 |
|------|------|
| CF Workers CPU ≤ 30s | AI 视频渲染、音频分离等重计算必须由外部 GPU 节点处理，Workers 只负责任务调度和结果回调 |
| Remix 功能 → Phase 2 | SRS 明确 Remix 编辑器推迟到第二阶段，Phase 1 不实现 |
| 无物理删除 | 所有数据软删除（`is_deleted = 1`），无永久清除接口 |
| App Store IAP 冲突风险 | iOS App 内购打赏可能触发 Apple 30% 抽成规则（WBS R4 风险项，需法务审查） |
| AI API 稳定性 | 第三方 AI 音乐生成 API 存在响应时延和可用性风险（WBS R2），需实现重试队列和降级提示 |

---

## 四、本地开发快速参考

```bash
# 进入开发目录
cd /Users/sunjingbo/longvv/04-Development

# 安装依赖
npm install

# 启动开发服务器
npm run dev        # → http://localhost:5173

# 构建 & 预览
npm run build && npm run preview   # → http://localhost:4173
```

---

## 五、相关文档

| 文档 | 路径 |
|------|------|
| 系统架构 TODO | `System-Arch-TODO.md` |

> 注：原 SRS / WBS / Milestones / Feature-Backlog（旧 `03-Product/Requirements/`）及 Notion 同步说明随 2026-05-30 Google Drive 迁出 / Notion 同步退役而移除。
