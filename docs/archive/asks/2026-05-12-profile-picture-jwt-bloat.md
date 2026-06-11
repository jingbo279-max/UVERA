---
title: 致费 · Profile picture data URL 撑爆 JWT header → HTTP 431
type: ask
status: resolved
owner: Leon
created: 2026-05-12
updated: 2026-05-12
tags: [ask, bug, jwt]
---

# 致费 · Profile picture data URL 撑爆 JWT header → HTTP 431

> 发起人：Leon · 日期：2026-05-12
> 状态：**🔥 紧急** — 已临时清理 2 个受影响 admin,但 root cause 未修,任何用户上传 profile picture 后会再次触发。
> 紧迫度：高

## 现象

2 个 admin 用户登录后访问 `/admin` 或任何认证 API 时返回 **HTTP 431 Request Header Fields Too Large** + 空 body。前端 r.json() 抛 "Unexpected end of JSON input"。

清理前数据：

| Email | metadata size | profile_picture_url size |
|---|---|---|
| yazhongliu186@gmail.com | 40,957 chars | **40,275 chars** |
| leonsuen@gmail.com | 21,671 chars | **21,079 chars** |

JWT 包含 user_metadata,base64 编码后 + 签名 → Authorization header 数十 KB → 超 Cloudflare Workers 限制(8KB-32KB 视配置)。

## Root cause

`src/pages/profile/uploadProfilePicture.js` 的 `uploadProfilePicture()`:

```js
export async function uploadProfilePicture(file) {
  const dataUrl = await fileToProfilePictureDataUrl(file);  // 256x256 jpeg 0.85 → ~20KB base64
  const { error } = await supabase.auth.updateUser({
    data: { [PROFILE_PICTURE_KEY]: dataUrl },  // ❌ 整个 data URL 存进 user_metadata
  });
}
```

把 base64 data URL 存 `auth.users.raw_user_meta_data.profile_picture_url`。Supabase 把 user_metadata 编码进每次签发的 JWT,access_token 因此巨大。

之前未爆是因为 admin 用户少 + 没几个上传过 profile picture。Leon + yazhongliu186 上传后,他们每次访问 `/admin/users/list?search=...` (带 search query 让 URL 长) 就超 header 限。

## 临时修复(2026-05-12 Leon SQL)

```sql
UPDATE auth.users
SET raw_user_meta_data = raw_user_meta_data - 'profile_picture_url'
WHERE email IN ('leonsuen@gmail.com', 'yazhongliu186@gmail.com');
```

这 2 用户的 metadata 已清,avatar_url (OAuth Google 头像 URL,~100 chars) 作 fallback。重登后 JWT 缩到 < 1KB。

## 你的 fix(后端)

**正确做法**:profile picture 上传走对象存储(R2 / OSS),metadata 只存 URL(~100-200 chars)。

实现 sketch:

```js
// 旧:dataUrl → user_metadata.profile_picture_url
// 新:upload to R2 → URL → user_metadata.profile_picture_url

export async function uploadProfilePicture(file) {
  // 1. Resize 256x256 jpeg (现有逻辑)
  const blob = await fileToProfilePictureBlob(file);  // → Blob 不是 data URL

  // 2. Upload to R2 via existing /api/upload/* endpoint
  //    (或 reuse Avatar / Character upload path)
  const url = await uploadToR2OrOSS(blob, `profile-pictures/${userId}/${Date.now()}.jpg`);

  // 3. Save URL only
  const { error } = await supabase.auth.updateUser({
    data: { profile_picture_url: url },  // ✅ ~100 chars
  });
  if (error) throw error;
  return url;
}
```

## 历史已上传清理(2 选 1)

**方案 A(推荐)**:写 migration / one-off script,把现有 `profile_picture_url` data URL 上传到 R2,替换为 URL。保留用户已设的头像。

**方案 B**:直接清掉所有 base64 类 `profile_picture_url`,让用户重新上传(用新的 R2 流程)。简单但用户感知掉头像。

```sql
-- 方案 B 一行清掉所有 data URL profile_picture_url:
UPDATE auth.users
SET raw_user_meta_data = raw_user_meta_data - 'profile_picture_url'
WHERE raw_user_meta_data->>'profile_picture_url' LIKE 'data:%';
```

## 防御性 check(可加)

`uploadProfilePicture()` 加 size guard,如果 dataUrl > 4KB 就 reject:

```js
if (dataUrl.length > 4096) {
  throw new Error('Image too large; please upload to storage instead');
}
```

这样即使旧 data URL 流程未完全切走,也不会再上传超大字段进 metadata。

## 前端已做的 defensive 改动(2026-05-12 commit 88db443)

`UsersView.load()` 把 `r.json()` 改成 `r.text() + try parse`,401/431 给可读错误消息:
- 401 → "Session expired — please sign out and sign back in"
- 其他 → "HTTP {code} (empty body)" 或 errMessage

但这只是错误展示改善,不是 root cause 修复。

## 你需要做

1. 改 `uploadProfilePicture()` 走 R2/OSS,return URL
2. (可选)写历史 data URL → R2 migration script,或直接清掉让用户重传
3. 加 size guard 防御
4. 可能其他 `supabase.auth.updateUser({ data: ... })` 调用也应该 audit 看有没有类似把大数据塞 metadata 的隐患

## 联动:credit → token rename(2026-05-12-credit-to-token-rename.md)

那个 handoff 提到 user_metadata.credits / tier 待 rename。这次 metadata 体检顺便看下还有什么不该塞 JWT 的字段。
