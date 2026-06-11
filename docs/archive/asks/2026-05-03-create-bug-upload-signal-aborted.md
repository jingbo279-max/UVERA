---
title: 致费 · Create / Free Mode 上传报错 "signal is aborted without reason"
type: ask
status: resolved
owner: Leon
created: 2026-05-07
updated: 2026-05-07
tags: [ask, bug, upload]
---

# 致费 · Create / Free Mode 上传报错 "signal is aborted without reason"

> 发起人：Leon（前端团队） · 日期：2026-05-03
> 状态：🔴 用户可复现 bug
> 紧迫度：**高**（用户上传任何稍大的视频文件都失败，Free Mode 整条链路阻塞）

## 复现路径

1. 进入 Create → Free Mode
2. 点 "上传素材" 选一个 mp4 视频文件（手机原片、几十 MB 量级）
3. 等约 15 秒后弹错：`Upload failed. (uploadToSecureOSS failed: signal is aborted without reason)`

同样路径在 Quick Mode → InlineCharacterCreator（拍摄/上传角色照片）以及 cover 上传等所有
`uploadToSecureOSS` 调用点都受影响。

## Root Cause

[`src/api/neoaiService.js:112-142`](../../../src/api/neoaiService.js)

```js
export const uploadToSecureOSS = async (file) => {
  // ...
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 15000);  // ⚠️ 15s 太短

  try {
    const res = await fetch(`${UPLOAD_WORKER_URL}/${objectKey}`, {
      method: 'PUT',
      // ...
      body: file,
      signal: controller.signal
    });
    // ...
  } catch (err) {
    clearTimeout(timeoutId);
    throw new Error(`uploadToSecureOSS failed: ${err.message}`);
  }
};
```

两个问题：

1. **Timeout 15s 对视频上传不够**。手机视频原片几十 MB，在普通 4G/家用 wifi 上 PUT 到
   Cloudflare Worker（再写 R2）经常 > 15s。`uploadUrlToCloudflareStream`
   line 367-368 已经把 timeout 提到 35s 并附注释 `// 35s since Cloudflare Worker
   max is 30s`，但 `uploadToSecureOSS` 没跟着调。
2. **`controller.abort()` 没传 reason 参数**。Web 标准下 fetch 看到的 `err.message`
   就是默认值 `"signal is aborted without reason"` — 完全不知道是 timeout 还是别的。
   外层 `throw new Error(\`uploadToSecureOSS failed: ${err.message}\`)` 把这条
   无信息错误透传给用户 alert，导致用户看到的是这条诡异消息而非"上传超时"。

## 建议修复（费侧 src/api/neoaiService.js）

**方案 A — 最小改动**：

```js
export const uploadToSecureOSS = async (file) => {
  const fileExt = file.name.split('.').pop() || 'jpg';
  const objectKey = `characters/temp_user_${Date.now()}/${Math.random().toString(36).substring(2)}.${fileExt}`;

  const controller = new AbortController();
  // Differentiate by file kind: images small & fast, videos big & slow.
  const isVideo = (file.type || '').startsWith('video/');
  const timeoutMs = isVideo ? 120000 : 30000;  // 2 min for video, 30s for image
  const timeoutId = setTimeout(
    () => controller.abort(new DOMException(`Upload timeout after ${timeoutMs/1000}s`, 'TimeoutError')),
    timeoutMs
  );

  try {
    const res = await fetch(`${UPLOAD_WORKER_URL}/${objectKey}`, {
      method: 'PUT',
      headers: { 'Content-Type': file.type || 'image/jpeg' },
      body: file,
      signal: controller.signal
    });
    clearTimeout(timeoutId);

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Upload failed: ${res.status} ${text}`);
    }

    const { url } = await res.json();
    const finalUrl = url || `${CUSTOM_DOMAIN}/${objectKey}`;
    return sanitizeNeoUrl(finalUrl);
  } catch (err) {
    clearTimeout(timeoutId);
    // Surface a useful message instead of "signal is aborted without reason"
    if (err.name === 'TimeoutError' || err.name === 'AbortError') {
      throw new Error(`uploadToSecureOSS timed out (${timeoutMs/1000}s). File too large or network too slow.`);
    }
    throw new Error(`uploadToSecureOSS failed: ${err.message}`);
  }
};
```

**关键改动**：
- 视频 timeout 提到 120s（与火山引擎、Cloudflare Stream 链路 SLA 对齐），图片维持 30s
- `controller.abort(new DOMException(..., 'TimeoutError'))` 让 abort 携带 reason，catch 能识别
- catch 区分 TimeoutError vs 其他错误，错误消息携带信息（用户能看懂"超时"而非看 "signal is aborted"）

**方案 B（如果费想做更彻底的）**：用流式上传 + 进度条（XMLHttpRequest 而非 fetch），
显示 "已上传 35% / 12MB / 30MB"，避免用户盲等 + 给慢网络更明确反馈。这个工作量更大，
属于 UX nice-to-have，不 block。

## 影响范围

`uploadToSecureOSS` 全局调用点（grep 显示）：

| 文件 | 行 | 场景 |
|---|---|---|
| `src/components/InlineCharacterCreator.jsx` | 101 | Quick Mode 角色拍照/上传 |
| `src/pages/StoryGeneratorPage.jsx` | 1159 | Free Mode 视频合并后上传 |
| `src/pages/StoryGeneratorPage.jsx` | 1368 | 视频生成后封面上传 |
| `src/pages/StoryGeneratorPage.jsx` | 1503 | （需查上下文）|
| `src/pages/StoryGeneratorPage.jsx` | 1834 | （需查上下文）|
| `src/pages/StoryGeneratorPage.jsx` | 1954 | （需查上下文）|

只要传视频/大文件就会触发，是 Create 模块当前最痛的 bug。

## 前端侧不能动

按 `docs/archive/sessions/scope-4-create.md` 协议，`src/api/neoaiService.js` 是费的
backend 接口定义，**前端 session 只读**。所以这条修复必须由费在 backend session
执行，前端只能等 patch 落 main。

## 临时缓解（用户侧）

在费修之前，告诉用户：
1. 把视频压缩到 <10MB 再上传（FFmpeg CRF 28 可以把手机原片缩 5-10x）
2. 或换有线/快 wifi 网络环境

---

**请 Leon relay 给费，越快越好 — 这是 Free Mode 阻塞性 bug。**
