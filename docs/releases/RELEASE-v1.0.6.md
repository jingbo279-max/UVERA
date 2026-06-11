---
title: UVERA v1.0.6 交付清单
type: release
status: active
owner: Claude
created: 2026-05-08
updated: 2026-05-08
tags: [release]
---

# UVERA v1.0.6 交付清单

> **版本号**：1.0.6
> **发布窗口**：2026-05-07 → 2026-05-08 GA
> **基础版本**：v1.0.5（2026-05-06 已部署）
> **本版本主线**：管理员账号体系扩容 + 用户上传视频通道 + 上传体验修复

---

## 1. 本次发布的所有改动

### 1.1 双层管理员模型（super_admin / admin）

| 项 | 说明 |
|---|---|
| **目的** | 把"全权管理员"和"日常运营管理员"分开。System Settings 涉及第三方 API 凭据校验，只对 super_admin 开放 |
| **新增 super_admin** | `feifeixp@gmail.com`、`longvv.dev@gmail.com` |
| **新增 admin（仅 6 个 ops 账号）** | `yazhongliu186@gmail.com`、`tuaiai20260304@gmail.com`、`jessiehuang9215@gmail.com`、`hquanbin662@gmail.com`、`jingbo279@gmail.com`、`bachbanana@gmail.com` |
| **强制点** | RLS 仍用 `public.is_admin()` 判定（即只看 `is_admin`），System Settings 区分是**纯前端 gating** —— 因为该 tab 已不再展示密钥（BytePlus ARK Key 显示已于 v1.0.5 移除），只剩"测试连通性"的非破坏性按钮 |
| **代码** | `src/api/adminService.js` 新增 `checkSuperAdmin()`；`src/pages/admin/AdminDashboard.jsx` 按 `isSuperAdmin` 过滤 menu + render gate |
| **DB 改动** | `migrations/20260507_admin_roles.up.sql`（已在 Supabase 执行） |

### 1.2 用户视频上传 + 管理员审核（全新功能）

**用户侧**：在 `/create` 页加入第三个 mode `Upload Video`，允许用户提交自有视频用于发布到 Discover。

**强制护栏**：
- ✅ 标题必填（1–200 字）
- ✅ 描述选填（≤ 2000 字）
- ✅ **版权声明 checkbox 强制勾选**（不勾，提交按钮禁用）
- ✅ 单文件 ≤ 2 GB（Stream 实际硬限 30 GB，留 buffer）
- ✅ 文件 MIME 必须 `video/*`

**法务证据链**（每条 `user_video_uploads` 记录都存）：
- `copyright_acknowledged_at`（NOT NULL，证明用户当时点了勾）
- `copyright_text_version = 'v1-2026-05-07'`（证明用户看的是哪一版法律文本，律师改文案时 bump 这个版本号即可保留旧证据）
- `submitter_ip`（CF-Connecting-IP）—— DMCA / 国内著作权法主张时必备
- `submitter_user_agent`

**审核流程**：
1. 用户提交 → 状态 `pending_review`
2. 管理员在 `/admin/dashboard` → `User Videos (Review)` tab 审核
3. **Approve** → 状态 `approved` + 自动写入 `recommended_content`（直接上 Discover）
4. **Reject** → 状态 `rejected` + **强制填写 ≥ 5 字符理由**
5. **48h SLA** 已写入 UI 文案（"We'll review it within 48 hours"）

**技术实现**：
- 浏览器**直接 POST 到 Cloudflare Stream**（绕开 Worker 100MB body 限制）
- Worker 只签 Direct Upload URL + 维护审核队列状态
- Stream 支持 HLS 自适应码率回放（移动端流畅播放，无需自己做转码）

**新增文件**：
- `migrations/20260507_user_video_uploads.up.sql`（19 列、3 索引、2 RLS policy）
- `migrations/20260507_user_video_uploads.down.sql`（一键回滚）

**修改文件**：
- `public/_worker.js` —— 4 个新 endpoint（`/api/user-videos/init-upload`、`/api/user-videos/finalize`、`/api/admin/user-videos/list`、`/api/admin/user-videos/review`）
- `src/pages/StoryGeneratorPage.jsx` —— 新 mode UI + `handleVideoSubmitForReview()`
- `src/pages/admin/AdminDashboard.jsx` —— 新增 `UserVideosReviewView` 组件 + menu wiring

### 1.3 上传体验修复（针对 v1.0.5 的"signal is aborted without reason"报错）

**根因**：`uploadToSecureOSS()` 用了固定 15 秒网络超时，对国内访问 CF / 大于 30MB 的视频频繁超时。

**修复**：
- 超时**按文件大小动态计算**：30s 基础 + 4s/MB + 30s R2 写入余量，上限 5min
- AbortController 调用 `abort(new Error(...))` 带明确原因，错误信息从"signal is aborted without reason"变成"Upload timed out after 180s for 30.5 MB file"
- **客户端预检 90 MB 上限**（Worker body 硬限 100 MB，留 10% 余量）
- 区分 `AbortError`（超时）vs 其他 fetch 失败

**新增**：参考视频 15 秒 duration 限制
- Free Mode @素材上传时，视频 ≤ 15s（Seedance 模型硬限）
- 通过 `uploadToSecureOSS(file, { maxVideoDurationSec: 15 })` 选项参数实现
- 上传前用 `<video>` 元素本地探测 duration，**不浪费带宽**
- 太长的视频立刻看到 `Video too long (45s). Reference videos must be ≤ 15s. Trim it first, or use the standalone Upload Video mode for full-length clips.`
- **新 Upload Video mode 不受影响**（走 Stream Direct Upload 通道，可上传完整长度视频）

---

## 2. 数据库迁移清单

> ⚠️ **必须在 Supabase Dashboard → SQL Editor 顺序执行，缺一不可**

| 文件 | 状态 | 说明 |
|---|---|---|
| `migrations/20260507_admin_roles.up.sql` | ⚠️ 待执行 | 6 个新管理员 + 2 个 super_admin 的 user_metadata 写入 |
| `migrations/20260507_user_video_uploads.up.sql` | ⚠️ 待执行 | `user_video_uploads` 表 + RLS + 索引 |

**执行后 verify**：
```sql
-- 1. 双层管理员
SELECT email,
       raw_user_meta_data ->> 'is_admin'       AS is_admin,
       raw_user_meta_data ->> 'is_super_admin' AS is_super_admin
FROM auth.users
WHERE (raw_user_meta_data ->> 'is_admin')::boolean = true
ORDER BY (raw_user_meta_data ->> 'is_super_admin')::boolean DESC NULLS LAST, email;
-- 期望：8 行，2 行 super_admin=true，6 行只有 is_admin=true

-- 2. user_video_uploads
SELECT count(*) FROM information_schema.columns WHERE table_name='user_video_uploads';
-- 期望：19

SELECT polname FROM pg_policy WHERE polrelid='public.user_video_uploads'::regclass;
-- 期望：user_video_uploads_select_own、user_video_uploads_admin_full
```

---

## 3. 部署步骤

```bash
# 1. 提交 + 推送
git add migrations/20260507_admin_roles.up.sql \
        migrations/20260507_user_video_uploads.up.sql \
        migrations/20260507_user_video_uploads.down.sql \
        src/api/adminService.js \
        src/api/neoaiService.js \
        src/pages/StoryGeneratorPage.jsx \
        src/pages/admin/AdminDashboard.jsx \
        public/_worker.js \
        public/version.json

git commit -m "v1.0.6: two-tier admin, user video uploads, upload fixes"
git push

# 2. 部署 Worker + 静态资产
npm run deploy

# 3. 在 Supabase 执行两个 migration（见上方 §2）
```

---

## 4. 上线冒烟测试（部署后必跑）

### 4.1 双层管理员（5 分钟）

- [ ] super_admin 账号登录 → 看到全部 8 个 tab（包括 System Settings 和 User Videos）
- [ ] 6 个新 admin 中任一账号登录 → 看到 **7 个 tab**（**没有 System Settings**）
- [ ] 普通用户登录访问 `/admin/dashboard` → 重定向到 `/admin` 登录页

### 4.2 用户视频上传 + 审核（10 分钟）

- [ ] 普通用户 → `/create` → 切到 `Upload Video`
- [ ] 不勾 checkbox → Submit 按钮**禁用**
- [ ] 选 > 2GB 文件 → 立刻报错"File too large"
- [ ] 选合规视频（≤ 100 MB 测试用）+ 填标题 + 勾 checkbox → 提交
- [ ] 应看到上传进度条（百分比平滑变化）
- [ ] 完成后看到绿色 ✅ "Submitted for review"
- [ ] DB 抽查：`SELECT * FROM user_video_uploads WHERE status='pending_review' ORDER BY created_at DESC LIMIT 1;` —— 应有刚才那条
- [ ] admin 登录 → User Videos 标签 → 看到刚才那条 + Stream player 可以播放
- [ ] 点 **Approve** → 状态变 approved
- [ ] 去 `/`（首页 Discover）→ 视频应出现在 feed
- [ ] DB 抽查：`SELECT * FROM recommended_content WHERE tags && ARRAY['user-upload'] ORDER BY created_at DESC LIMIT 1;`

### 4.3 拒绝流程（5 分钟）

- [ ] 再用普通用户提交一条
- [ ] admin 点 **Reject** → 弹框输入 < 5 字 → 提示 "Reason must be at least 5 characters"
- [ ] 输入合规理由 → 提交成功
- [ ] DB 抽查：rejected 记录的 `rejection_reason` 字段已填

### 4.4 上传体验修复（5 分钟）

- [ ] Free Mode @ 素材上传：选 > 15 秒视频 → 立刻报错（不应进入网络上传）
- [ ] 选 ≤ 15 秒视频 → 正常上传 + AI 描述生成
- [ ] 大图片（10–80 MB）→ 不再 15 秒超时

---

## 5. 已知遗留 / 不在本版本范围

| 项 | 状态 | 备注 |
|---|---|---|
| Stripe 实时模式（live） | ✅ 上一版已通 | 已发现并修复 webhook 不触发的兜底逻辑（v1.0.5） |
| 2 笔 $25 错发到 dev@uvera.ai | ✅ 已对账修复 | 1000 credits 已从 dev 反转，已重发给 ronghouh08 / zhiqiangtang9215 |
| `orders.userId` FK 指向 `public.users` 而非 `auth.users` | ⚠️ 已知 | 不影响支付，但限制了纯 auth.users 用户的对账插入。建议下个版本修 |
| FFmpeg.wasm 自托管 | ✅ 已上 R2 | `scripts/upload-ffmpeg-wasm.sh` 一次性脚本，已在 v1.0.5 部署 |
| Sentry 错误监控 | ✅ 已开 | DSN 在 `src/sentry.js`，已过滤 Supabase Web Locks 噪声 |
| Discover 用户上传视频的"举报/下架"按钮 | ❌ 未实现 | DMCA takedown 需要的 `recommended_content_id` FK 已留好。下个版本加 |
| 用户提交视频后的邮件通知（approved / rejected） | ❌ 未实现 | 当前用户必须自己回 dashboard 查状态。下版本接 SendGrid 或 Supabase 邮件 |
| 视频长度服务端二次校验 | ⚠️ 仅前端 | Stream 在 init-upload 时已用 `maxDurationSeconds: 3600` 硬限 1 小时；前端 2GB 大小限只是 UX 防呆 |
| 上传中断 / 网络断开恢复 | ❌ 未实现 | 当前会失败需重传。Cloudflare Stream 支持 tus 协议可恢复传输，下版本可换 |
| Test 7 个新管理员真实登录 | ⚠️ 待 ops | 6 个新邮箱可能从未在 uvera 注册过 → 需先 Google OAuth 登录创建 user，**再**在 Supabase 跑一次 migration（幂等，重复跑安全） |

---

## 6. 紧急回滚方案

**Worker 回滚**：
```bash
# 找到上一个稳定 deploy 的 wrangler version
wrangler versions list
wrangler rollback <version-id>
```

**DB 回滚**：
```sql
-- 在 Supabase 跑 migrations/20260507_user_video_uploads.down.sql
-- 双层管理员暂无 down.sql（is_admin 字段保留无害）
```

**前端回滚**：直接 `git revert <commit-sha>` 然后 `npm run deploy`。

---

## 7. v1.0.6 发布说明（用户可见）

需要在 `public/release-notes.json` 顶部添加：

```json
{
  "version": "1.0.6",
  "date": "2026-05-07",
  "title": "Upload your own videos + faster uploads",
  "highlights": [
    "New 'Upload Video' mode in Quick Create — submit your own work for publication",
    "Mandatory copyright check protects you and other creators",
    "All uploads reviewed by our team within 48 hours",
    "Upload reliability improved — bigger files and slow networks now work",
    "Reference videos in Free Mode now show clear error if longer than 15s"
  ]
}
```

并把 `public/version.json` 的 `latestRelease` 同步成上面的 v1.0.6 entry，触发 in-app toast。

---

**文档维护人**：费 (feifeixp)
**最后更新**：2026-05-07
**下个版本预定**：v1.0.7（GA 后第一个迭代窗口）
