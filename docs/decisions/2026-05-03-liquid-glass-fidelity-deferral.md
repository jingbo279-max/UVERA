---
title: Liquid Glass 高保真打磨：暂缓 + 触发条件
type: decision
status: active
owner: Leon
created: 2026-05-03
updated: 2026-05-03
tags: [decision, adr]
---

# Liquid Glass 高保真打磨：暂缓 + 触发条件

> **决策日期**：2026-05-03
> **触发**：SparkMode desktop Center Play btn (80x80) 多轮 T2 CSS 增强尝试
> 后，Leon 评估"仍达不到 T0 hero 级 Liquid Glass 视觉"，决定挂起进一步
> 打磨，先推进其他模块
> **决策方**：Leon
> **状态**：✅ 暂缓 + 触发条件已明确

## 背景

Center Play (80x80) 是 SparkMode 的 **T0 hero element** — 视频暂停时全屏
中央的主播放控件，代表向用户和甲方展示的"视觉效果 + 技术能力"。期望达到
iOS 26 / macOS Tahoe 26 原生 Liquid Glass 的精致度。

### 多轮 T2 (CSS-only) 尝试历程

| Pass | Commit | 改动 | Leon 反馈 |
|---|---|---|---|
| T2 v1 | `102ddc7` | radial highlight (30%/25%) + 165° specular + 5 层 box-shadow（含 outer rim glow + 杯底 inset） | 缺极细亮边、缺扭曲带 |
| T2 v2 | `60cdcd4` | crisp rim (white@55) + meniscus ring (89-92%, peak black@32) | 仍是磨砂玻璃感，通透度不足，光是一大片 |
| T2 v3 | `1398af1` + `1dfe576` | blur 24→4、saturate 1.8→1.5、主高光收紧到 25% 半径、加次高光点（72%/78%）、base tint near-transparent | T2 路径无法达到精细效果 |

### 三层路径还原度

| 等级 | 技术 | 还原度 | 性能 | 适用 |
|---|---|---|---|---|
| **T1** 纯 CSS 基础 | backdrop-filter + 多层 shadow + gradient border | ~70% | 好 | 控件级，5 个非 hero LG 控件用 |
| **T2** 增强 CSS | + radial highlight 点 + meniscus ring + crisp rim + 4 层 background gradient | ~80% | 好 | 中等需求；本次 Center Play 用 |
| **T3** liquid-glass-react / Canvas + WebGL | 自定义 shader + 真折射 + displacement map | ~92-95% | 重（每实例 1 canvas + WebGL ctx） | hero only；项目已有 dep |
| **T4** Apple 原生 Metal shader | 平台专属 | 100% | — | Web 拿不到 |

### CSS 的体制限制（无法靠 CSS 突破）

1. **真折射 refraction** — 背景被曲面"弯曲" → CSS backdrop-filter 是均匀
   blur，不弯
2. **各向异性模糊** — 中心清透 + 边缘模糊 → CSS 全局均匀
3. **色散 chromatic aberration** — 边缘红蓝分离 → 需 SVG filter，性能差
4. **动态高光跟随** — 视角/鼠标变化高光位置 → 可 JS 但成本高
5. **3D 光照模型** — Apple 用 Metal normal map → Web 仅 canvas/WebGL 能近似

## 决策

### 短期（现在）

**保留** Center Play 当前 T2 v3 spec — 即使未达 T0，仍优于 T1（更通透 + 多
点高光 + meniscus ring + crisp rim），是 production 阶段最佳 CSS-only
方案。其他 5 LG 控件继续 T1（一致性 + 简洁）。

**不再** 进一步 polish T2（边际收益不抵成本，CSS 体制天花板已触）。

### 中期（暂缓，触发条件命中再启动）

**T3 路径**（接 `liquid-glass-react` canvas）暂不动手。原因：
- 项目当前主线在 dual-track design system + Profile/Subscription 模块 +
  Discover/Spark IA 等业务推进
- T3 引入 canvas 实例 + WebGL ctx 有非平凡的性能 / SSR / 资源管理工作
- Center Play 是 paused 态才显示的临时元素，绝大多数时间不可见 — ROI 弱

### 长期（打磨档期回归）

启动 T3 的触发条件（任一命中即重启评估）：

1. **甲方 design demo / 演示 hero 视觉** — 需要在客户面前展示 Uvera 的
   "视觉技术能力"，T0 级体验是 marketing 需要
2. **空闲档期** — 业务主线无 P0/P1 任务、design system 已稳定，可投入
   2-3 天做 T3 单点接入 + 性能验证
3. **浏览器原生 Liquid Glass API 出现** — 不太可能短期发生；如果 W3C 或
   Chrome/Safari 提案进入实验，直接走原生
4. **`liquid-glass-react` 上游有性能优化或 React 19 适配增强** — 引入
   成本下降时

## 不在本决策范围

- T1 spec 自身的小幅打磨（如 specular 角度、blur 数值）— 仍可按需做
- 其他 5 LG 控件保持 T1 — 与本决策无关
- SparkMode 其他视觉细节（pane gap、halo、bottom bar 等）— 与本决策无关

## 关联

- `src/components/SparkMode.jsx` — Center Play (line ~1645) 用 T2 v3
- `src/components/SparkMode.jsx` — 其他 5 LG 控件用 T1：Close (line ~1605) /
  Prev/Next (line ~1745) / Replay (line ~1689) / Speed popup (line ~1900)
- `package.json` — `liquid-glass-react` 已在 deps，T3 启动无需新增
- `docs/decisions/2026-04-29-tokens-studio-deferral.md` — 类似的"暂缓 +
  触发条件"模板
- `docs/decisions/2026-04-29-dual-track-design-system.md` — 2026-04-29
  双轨 design system 决策（Liquid Glass 是控件层 iOS 26 spec 的具体实现）

## 后续 action

无立即 action。Center Play T2 v3 + 其他 5 控件 T1 进入 production，等触发
条件命中再启动 T3。
