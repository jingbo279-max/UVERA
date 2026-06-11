---
title: Seedance 2.0 私有资产库 — 审核上传 + 生成调用 流程与方法
type: reference
status: active
owner: Claude
created: 2026-06-07
updated: 2026-06-07
tags: [byteplus, seedance, volcengine, asset-library, video-generation]
---

# Seedance 2.0 私有资产库 · 流程与方法

> UVERA 视频生成走 BytePlus Seedance(火山引擎海外版)。本文记录**私有资产库(BAIZE Asset Library)的审核上传**与**生成调用 `asset://` 私有资产**的完整流程与方法。
> 全部对照 `public/_worker.js` 实际实现(行号以当时为准,改动后用关键字定位)。

---

## 0. 两套凭据 + 两个域名(最容易踩坑)

资产库管理和视频生成是**两个不同的鉴权体系**,凭据不通用。

| 用途 | 凭据(system_settings,DB 优先于 CF env) | 域名 | 鉴权方式 |
|---|---|---|---|
| **资产库管理(审核 / 上传 / 查状态)** | `byteplus_ark_ak` + `byteplus_ark_sk`(AK/SK)+ `byteplus_asset_project`(默认 `HKBAIZE-005`) | `open.ap-southeast-1.byteplusapi.com` | **BytePlus V4 签名**(`signBytePlusRequest`) |
| **视频生成(提交任务 / 轮询)** | `byteplus_ark_api_key`(Bearer,= `env.ARK_API_KEY`) | `ark.ap-southeast.bytepluses.com/api/v3` | **Bearer Token** |

- AK/SK ≠ Ark Key。资产库报 `403 / AccessDenied / 100013` 几乎都是 **AK/SK 没绑对 project**;`buildActionableHint()` 会针对这类错配生成「改哪个 admin 字段、去哪查正确值」的提示。
- 三个值都在 **admin → System Settings** 可改(DB 优先,改完无需重部署)。
- Seedance 2.0 模型端点(`baseParams.model`):
  - `seedance_fast_endpoint` = `ep-20260507183959-d7mr2`(Fast)
  - `seedance_standard_endpoint` = `ep-20260507184058-tpr79`(Standard)

---

## 1. 审核资产库:把素材传进私有库并过审

核心函数:`uploadRealPersonAssetToBytePlus(assetUrl, env, assetType)`(`assetType: 'Image' | 'Video'`)。

```
① ListAssetGroups   (Filter.GroupType="AIGC", ProjectName=HKBAIZE-005, PageSize=1)
       └─ 无 group → ② CreateAssetGroup (Name="uvera_auto_group")
③ CreateAsset {
     GroupId,
     URL: <公开素材 URL>,
     AssetType: "Image" | "Video",
     ProjectName,
     Moderation: { Strategy: "Skip" }      ← 关键:跳过内容审核
   }
④ 轮询 GetAsset(Id) 直到 Result.Status === "Active"
       Image: 最多 15 × 2s = 30s
       Video: 最多 30 × 2s = 60s(转码更久)
       Status === "Failed" → 抛错
   →  返回  asset://<assetId>
```

V4 签名调用统一走 `bytePlusCall(action, body)`:`POST https://open.ap-southeast-1.byteplusapi.com/?Action=<Action>&Version=2024-01-01`。即使 HTTP 200,也会检查 `ResponseMetadata.Error`(BytePlus 常用 200-with-error 返应用层失败),并 loud-fail 到 CF Worker Logs。

### 「审核」的本质 = `Moderation.Strategy`

| Strategy | 行为 | 前提 |
|---|---|---|
| `"Skip"`(现用) | **跳过 BytePlus 内容审核**,真人/敏感素材也能入库 | BytePlus 账号**合规协议已备案**(真人/敏感内容协议),否则 Skip 无权限 |
| 默认(不传 Skip) | 走审核管线,真人/敏感会被拒 | — |

- 资产到达 `Status="Active"` = **预处理 + 审核都通过**,拿到稳定引用 `asset://<id>`。
- `asset://<id>` 被 BytePlus 当成**已过审素材**:后续生成直接引用,**不再走「抓 URL + 重新审核」管线**——这正是绕过「公开 URL 直传被真人/敏感自动拒」的手段。

---

## 2. 生成调用私有资产库:把 asset:// 塞进生成请求

生成走 `submitToArk(withReference, overrideRefUrl, opts)`,组 `content` 数组打到 Ark 任务接口。

```js
// 图片参考(角色设定图 / 分镜),可多张,role 固定 reference_image
content.push({ type: 'image_url', image_url: { url: <asset:// 或 公开URL> }, role: 'reference_image' });

// 视频参考(Recast / 续写参考片)
content.push({ type: 'video_url', video_url: { url: <asset:// 或 公开URL> }, role: 'reference_video' });

// 文本提示词
content.push({ type: 'text', text: prompt });

// 提交
POST https://ark.ap-southeast.bytepluses.com/api/v3/contents/generations/tasks
  Authorization: Bearer <arkApiKey>
  body: { ...baseParams /* model端点/分辨率/时长/水印 */, content }
→ { id: <taskId> }

// 轮询
GET https://ark.ap-southeast.bytepluses.com/api/v3/contents/generations/tasks/<taskId>
→ status === 'succeeded' → 取产物 video_url
```

要点:

- **`url` 字段公开 URL 与 `asset://<id>` 通用** —— 「调用私有资产库」= 把 `image_url.url` / `video_url.url` 换成 `asset://<id>`,**role 不变**。
- `role='reference_image'` = **创作锚点**(脸 / 服装 / 画风参考),**不是**输出视频的首帧(首帧是另一个 role,本项目不用)。
- 多张参考图都标 `reference_image`;若某端点版本不支持多图(`isMultiImageRejection`:错误含 `reference_image count/limit`、`InvalidParameter`+image 等),自动降级到单图(`imageUrls[0]` = 角色设定图,脸 + 画风的主参考)。

---

## 3. UVERA 的实际触发链路(被拒才上私有库)

UVERA **不是每次都先传私有库**,而是**先用公开 URL 直发,被真人/敏感拒了再上私有库重试**(省一次上传 + 审核耗时)。`/api/volcengine/video/submit` 的 fallback 链:

```
submitToArk(true)                         先用公开 URL 直发
   │ 失败 & isMultiImageRejection()       多图被端点拒
   ├─ submitToArk(true, null, {singleImageOnly:true})   降级单图
   │
   │ 失败 & isRealPersonRejection()       code 10010 / InputImageSensitiveContentDetected
   │                                       / face|privacy|portrait|deepfake …
   ▼
uploadRealPersonAssetToBytePlus(imageUrl, 'Image')  → asset://<id>   上私有库 + 过审
   ▼
submitToArk(true, assetUri)               用 asset:// 重试
   │ 仍失败(如 AK/SK 没绑 project、IAM 403)
   ▼
submitToArk(false)                        丢参考、纯文本兜底(至少出片)
```

- 视频参考走同样链路(`assetType='Video'`)。
- 非真人的 `SensitiveContent (10006)` → 直接丢参考、纯文本重试。
- 提示词触发版权(`copyright`)→ 换安全通用提示词重发。
- 所有资产库上传错误由 `lastAssetUploadError` 捕获,拼进最终用户报错 + 写 `generation_logs.error_message`,admin 后台可直接看到根因(不用翻 CF Logs)。

---

## 4. 相关端点

| 端点 | 作用 |
|---|---|
| `POST /api/byteplus/certify-asset` | **主动**把素材认证进私有库,直接拿 `asset://<id>`(Free Mode 用,避免生成时才被拒再等)。已是 `asset://` 则幂等跳过。 |
| `POST /api/admin/byteplus/test` | admin 自测:跑完整资产库往返(传图 → 等 Active),验证 AK/SK + project 配置,排查 403 / 项目错配。 |
| `POST /api/volcengine/video/submit` | 视频生成提交(含上面整条 fallback 链)。 |
| `GET /api/volcengine/video/status/:taskId` | 轮询任务,`succeeded` 取 `video_url`。 |

---

## 5. 接私有库配置 checklist

1. admin → System Settings 填全:`byteplus_ark_ak`、`byteplus_ark_sk`、`byteplus_ark_api_key`、`byteplus_asset_project`。
2. AK 必须在 BytePlus console → IAM 对该 **project** 有 `ark:*Asset*` 权限;project 名要和 AK 绑定资源完全一致(查 IAM → Access Keys → 点 AK → Resource = `trn:iam::ACCOUNT:project/<NAME>`)。不确定就用 `default`(BytePlus 每账号自动建)。
3. 要用 `Moderation.Strategy="Skip"`(真人/敏感):BytePlus 账号需**合规协议在案**,否则 Skip 无权限、仍被审核拒。
4. 跑一次 `POST /api/admin/byteplus/test`,确认资产能到 `Active`。

---

## 6. 常见错误对照

| 现象 / 错误码 | 根因 | 处理 |
|---|---|---|
| `NotFound.ProjectName` | project 名在该账号不存在 | 改 `byteplus_asset_project` 为 `default`,或在 console 建该 project |
| `AccessDenied` / `100013` / `iam::project` | AK/SK 对该 project 无权限 | 把 project 名改成 AK 实际 scoped 的那个 |
| `100018` / `quota` / `rate limit` | BytePlus 限流 / 额度耗尽 | console → Billing |
| `signature` / `100009` | SK 错或 AK/SK 不同步 | admin 重贴 AK + SK |
| 生成 `10010` / `InputImageSensitiveContentDetected` | 真人/敏感被公开 URL 管线拒 | 自动走私有库 `asset://` 重试(需协议在案 + Skip) |
