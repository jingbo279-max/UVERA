---
title: 模型能力
type: doc
status: active
owner: Claude
created: 2026-04-22
updated: 2026-04-22
tags: [guide, seedance, api]
---

## Step1: 创建视频生成任务

通过 POST /contents/generations/tasks 创建视频生成任务。

 

```
curl https://ark.cn-beijing.volces.com/api/v3/contents/generations/tasks \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $ARK_API_KEY" \
  -d '{
    "model": "doubao-seedance-2-0-260128",
    "content": [
        {
            "type": "text",
            "text": "女孩抱着狐狸，女孩睁开眼，温柔地看向镜头，狐狸友善地抱着，镜头缓缓拉出，女孩的头发被风吹动，可以听到风声"
        },
        {
            "type": "image_url",
            "image_url": {
                "url": "https://ark-project.tos-cn-beijing.volces.com/doc_image/i2v_foxrgirl.png"
            }
        }
    ],
    "generate_audio": true,
    "ratio": "adaptive",
    "duration": 5,
    "watermark": false
}'
```

请求成功后，系统将返回一个任务 ID。

```
{
  "id": "cgt-2025******-****"
}
```

## Step2: 查询视频生成任务

利用创建视频生成任务时返回的 ID ，您可以查询视频生成任务的详细状态与结果。此接口会返回任务的当前状态（如 queued 、running 、 succeeded 等）以及生成的视频相关信息（如视频下载链接、分辨率、时长等）。

说明

因模型、API负载和视频输出规格的不同，视频生成的过程可能耗时较长。为高效管理这一过程，您可以通过轮询 API 接口（详见 [基础使用]() 和 [进阶使用]() 部分的 SDK 示例）来请求状态更新，或通过 [使用 Webhook 通知]() 接收通知。

 

当任务状态变为 succeeded 后，您可在 content.**video_url** 字段处，下载最终生成的视频文件。

```
{
    "id": "cgt-2025****",
    "model": "doubao-seedance-2-0-260128",
    "status": "succeeded", 
    "content": {
        // Video download URL (file format is MP4)
        "video_url": "https://ark-content-generation-cn-beijing.tos-cn-beijing.volces.com/****"
    },
    "usage": {
        "completion_tokens": 246840,
        "total_tokens": 246840
    },
    "created_at": 1765510475,
    "updated_at": 1765510559,
    "seed": 58944,
    "resolution": "1080p",
    "ratio": "16:9",
    "duration": 5,
    "framespersecond": 24,
    "service_tier": "default",
    "execution_expires_after": 172800
}
```

# 模型能力

本表格展示所有 seedance 模型支持的能力，方便您对比和选型。如需了解 seedance 2.0 系列模型的最新用法，请参见 [Seedance 2.0 系列教程]()。

| 模型名称                                                     |                                                              | [seedance 2.0](https://console.volcengine.com/ark/region:ark+cn-beijing/model/detail?Id=doubao-seedance-2-0&projectName=default) | [seedance 2.0 fast](https://console.volcengine.com/ark/region:ark+cn-beijing/model/detail?Id=doubao-seedance-2-0-fast&projectName=default) | [seedance 1.5 pro](https://console.volcengine.com/ark/region:ark+cn-beijing/model/detail?Id=doubao-seedance-1-5-pro&projectName=default) | [seedance 1.0 pro](https://console.volcengine.com/ark/region:ark+cn-beijing/model/detail?Id=doubao-seedance-1-0-pro&projectName=default) | [seedance 1.0 pro fast](https://console.volcengine.com/ark/region:ark+cn-beijing/model/detail?Id=doubao-seedance-1-0-pro-fast&projectName=default) | [seedance 1.0 lite i2v](https://console.volcengine.com/ark/region:ark+cn-beijing/model/detail?Id=doubao-seedance-1-0-lite-i2v&projectName=default) | [seedance-1.0 lite t2v](https://console.volcengine.com/ark/region:ark+cn-beijing/model/detail?Id=doubao-seedance-1-0-lite-t2v) |
| ------------------------------------------------------------ | ------------------------------------------------------------ | ------------------------------------------------------------ | ------------------------------------------------------------ | ------------------------------------------------------------ | ------------------------------------------------------------ | ------------------------------------------------------------ | ------------------------------------------------------------ | ------------------------------------------------------------ |
| Model ID                                                     |                                                              | doubao-seedance-2-0-260128                                   | doubao-seedance-2-0-fast-260128                              | doubao-seedance-1-5-pro-251215                               | doubao-seedance-1-0-pro-250528                               | doubao-seedance-1-0-pro-fast-251015                          | doubao-seedance-1-0-lite-i2v-250428                          | doubao-seedance-1-0-lite-t2v-250428                          |
| [文生视频](https://www.volcengine.com/docs/82379/2298881?lang=zh#4e74bcee) |                                                              | ![Image](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/ee51ce32c1914aed81ff95080bb7db1d~tplv-goo7wpa0wc-image.image) | ![Image](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/ee51ce32c1914aed81ff95080bb7db1d~tplv-goo7wpa0wc-image.image) | ![Image](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/ee51ce32c1914aed81ff95080bb7db1d~tplv-goo7wpa0wc-image.image) | ![Image](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/ee51ce32c1914aed81ff95080bb7db1d~tplv-goo7wpa0wc-image.image) | ![Image](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/ee51ce32c1914aed81ff95080bb7db1d~tplv-goo7wpa0wc-image.image) | ![Image](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/ee51ce32c1914aed81ff95080bb7db1d~tplv-goo7wpa0wc-image.image) | ![Image](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/ee51ce32c1914aed81ff95080bb7db1d~tplv-goo7wpa0wc-image.image) |
| [图生视频-首帧](https://www.volcengine.com/docs/82379/2298881?lang=zh#979b2d28) |                                                              | ![Image](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/ee51ce32c1914aed81ff95080bb7db1d~tplv-goo7wpa0wc-image.image) | ![Image](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/ee51ce32c1914aed81ff95080bb7db1d~tplv-goo7wpa0wc-image.image) | ![Image](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/ee51ce32c1914aed81ff95080bb7db1d~tplv-goo7wpa0wc-image.image) | ![Image](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/ee51ce32c1914aed81ff95080bb7db1d~tplv-goo7wpa0wc-image.image) | ![Image](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/ee51ce32c1914aed81ff95080bb7db1d~tplv-goo7wpa0wc-image.image) | ![Image](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/ee51ce32c1914aed81ff95080bb7db1d~tplv-goo7wpa0wc-image.image) | ![Image](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/f359753773c94d97885008ca1223c9bc~tplv-goo7wpa0wc-image.image) |
| [图生视频-首尾帧](https://www.volcengine.com/docs/82379/2298881?lang=zh#0d55ca07) |                                                              | ![Image](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/ee51ce32c1914aed81ff95080bb7db1d~tplv-goo7wpa0wc-image.image) | ![Image](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/ee51ce32c1914aed81ff95080bb7db1d~tplv-goo7wpa0wc-image.image) | ![Image](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/ee51ce32c1914aed81ff95080bb7db1d~tplv-goo7wpa0wc-image.image) | ![Image](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/ee51ce32c1914aed81ff95080bb7db1d~tplv-goo7wpa0wc-image.image) | ![Image](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/f359753773c94d97885008ca1223c9bc~tplv-goo7wpa0wc-image.image) | ![Image](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/ee51ce32c1914aed81ff95080bb7db1d~tplv-goo7wpa0wc-image.image) | ![Image](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/f359753773c94d97885008ca1223c9bc~tplv-goo7wpa0wc-image.image) |
| [多模态参考](https://www.volcengine.com/docs/82379/2291680?lang=zh#50e1b4ea)【New】 | 图片参考                                                     | ![Image](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/ee51ce32c1914aed81ff95080bb7db1d~tplv-goo7wpa0wc-image.image) | ![Image](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/ee51ce32c1914aed81ff95080bb7db1d~tplv-goo7wpa0wc-image.image) | ![Image](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/f359753773c94d97885008ca1223c9bc~tplv-goo7wpa0wc-image.image) | ![Image](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/f359753773c94d97885008ca1223c9bc~tplv-goo7wpa0wc-image.image) | ![Image](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/f359753773c94d97885008ca1223c9bc~tplv-goo7wpa0wc-image.image) | ![Image](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/ee51ce32c1914aed81ff95080bb7db1d~tplv-goo7wpa0wc-image.image) | ![Image](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/f359753773c94d97885008ca1223c9bc~tplv-goo7wpa0wc-image.image) |
| 视频参考                                                     | ![Image](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/ee51ce32c1914aed81ff95080bb7db1d~tplv-goo7wpa0wc-image.image) | ![Image](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/ee51ce32c1914aed81ff95080bb7db1d~tplv-goo7wpa0wc-image.image) | ![Image](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/f359753773c94d97885008ca1223c9bc~tplv-goo7wpa0wc-image.image) | ![Image](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/f359753773c94d97885008ca1223c9bc~tplv-goo7wpa0wc-image.image) | ![Image](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/f359753773c94d97885008ca1223c9bc~tplv-goo7wpa0wc-image.image) | ![Image](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/f359753773c94d97885008ca1223c9bc~tplv-goo7wpa0wc-image.image) | ![Image](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/f359753773c94d97885008ca1223c9bc~tplv-goo7wpa0wc-image.image) |                                                              |
| 组合参考图片 + 音频图片 + 视频视频 + 音频图片 + 视频 + 音频  | ![Image](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/ee51ce32c1914aed81ff95080bb7db1d~tplv-goo7wpa0wc-image.image) | ![Image](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/ee51ce32c1914aed81ff95080bb7db1d~tplv-goo7wpa0wc-image.image) | ![Image](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/f359753773c94d97885008ca1223c9bc~tplv-goo7wpa0wc-image.image) | ![Image](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/f359753773c94d97885008ca1223c9bc~tplv-goo7wpa0wc-image.image) | ![Image](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/f359753773c94d97885008ca1223c9bc~tplv-goo7wpa0wc-image.image) | ![Image](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/f359753773c94d97885008ca1223c9bc~tplv-goo7wpa0wc-image.image) | ![Image](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/f359753773c94d97885008ca1223c9bc~tplv-goo7wpa0wc-image.image) |                                                              |
| [编辑视频](https://www.volcengine.com/docs/82379/2291680?lang=zh#75a28782)【New】 |                                                              | ![Image](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/ee51ce32c1914aed81ff95080bb7db1d~tplv-goo7wpa0wc-image.image) | ![Image](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/ee51ce32c1914aed81ff95080bb7db1d~tplv-goo7wpa0wc-image.image) | ![Image](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/f359753773c94d97885008ca1223c9bc~tplv-goo7wpa0wc-image.image) | ![Image](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/f359753773c94d97885008ca1223c9bc~tplv-goo7wpa0wc-image.image) | ![Image](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/f359753773c94d97885008ca1223c9bc~tplv-goo7wpa0wc-image.image) | ![Image](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/f359753773c94d97885008ca1223c9bc~tplv-goo7wpa0wc-image.image) | ![Image](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/f359753773c94d97885008ca1223c9bc~tplv-goo7wpa0wc-image.image) |
| [延长视频](https://www.volcengine.com/docs/82379/2291680?lang=zh#46d77653)【New】 |                                                              | ![Image](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/ee51ce32c1914aed81ff95080bb7db1d~tplv-goo7wpa0wc-image.image) | ![Image](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/ee51ce32c1914aed81ff95080bb7db1d~tplv-goo7wpa0wc-image.image) | ![Image](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/f359753773c94d97885008ca1223c9bc~tplv-goo7wpa0wc-image.image) | ![Image](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/f359753773c94d97885008ca1223c9bc~tplv-goo7wpa0wc-image.image) | ![Image](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/f359753773c94d97885008ca1223c9bc~tplv-goo7wpa0wc-image.image) | ![Image](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/f359753773c94d97885008ca1223c9bc~tplv-goo7wpa0wc-image.image) | ![Image](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/f359753773c94d97885008ca1223c9bc~tplv-goo7wpa0wc-image.image) |
| [生成有声视频](https://www.volcengine.com/docs/82379/2298881?lang=zh#979b2d28)"generate_audio": "true" |                                                              | ![Image](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/ee51ce32c1914aed81ff95080bb7db1d~tplv-goo7wpa0wc-image.image) | ![Image](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/ee51ce32c1914aed81ff95080bb7db1d~tplv-goo7wpa0wc-image.image) | ![Image](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/ee51ce32c1914aed81ff95080bb7db1d~tplv-goo7wpa0wc-image.image) | ![Image](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/f359753773c94d97885008ca1223c9bc~tplv-goo7wpa0wc-image.image) | ![Image](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/f359753773c94d97885008ca1223c9bc~tplv-goo7wpa0wc-image.image) | ![Image](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/f359753773c94d97885008ca1223c9bc~tplv-goo7wpa0wc-image.image) | ![Image](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/f359753773c94d97885008ca1223c9bc~tplv-goo7wpa0wc-image.image) |
| [联网搜索工具](https://www.volcengine.com/docs/82379/2291680?lang=zh#c40ed3ef)【New】 |                                                              | ![Image](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/ee51ce32c1914aed81ff95080bb7db1d~tplv-goo7wpa0wc-image.image) | ![Image](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/ee51ce32c1914aed81ff95080bb7db1d~tplv-goo7wpa0wc-image.image) | ![Image](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/f359753773c94d97885008ca1223c9bc~tplv-goo7wpa0wc-image.image) | ![Image](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/f359753773c94d97885008ca1223c9bc~tplv-goo7wpa0wc-image.image) | ![Image](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/f359753773c94d97885008ca1223c9bc~tplv-goo7wpa0wc-image.image) | ![Image](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/f359753773c94d97885008ca1223c9bc~tplv-goo7wpa0wc-image.image) | ![Image](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/f359753773c94d97885008ca1223c9bc~tplv-goo7wpa0wc-image.image) |
| [样片模式](https://www.volcengine.com/docs/82379/2298881?lang=zh#5acd28c8) |                                                              | ![Image](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/f359753773c94d97885008ca1223c9bc~tplv-goo7wpa0wc-image.image) | ![Image](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/f359753773c94d97885008ca1223c9bc~tplv-goo7wpa0wc-image.image) | ![Image](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/ee51ce32c1914aed81ff95080bb7db1d~tplv-goo7wpa0wc-image.image) | ![Image](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/f359753773c94d97885008ca1223c9bc~tplv-goo7wpa0wc-image.image) | ![Image](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/f359753773c94d97885008ca1223c9bc~tplv-goo7wpa0wc-image.image) | ![Image](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/f359753773c94d97885008ca1223c9bc~tplv-goo7wpa0wc-image.image) | ![Image](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/f359753773c94d97885008ca1223c9bc~tplv-goo7wpa0wc-image.image) |
| [返回视频产物对应的尾帧图](https://www.volcengine.com/docs/82379/2298881?lang=zh#141cf7fa)"return_last_frame":"true" |                                                              | ![Image](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/ee51ce32c1914aed81ff95080bb7db1d~tplv-goo7wpa0wc-image.image) | ![Image](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/ee51ce32c1914aed81ff95080bb7db1d~tplv-goo7wpa0wc-image.image) | ![Image](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/ee51ce32c1914aed81ff95080bb7db1d~tplv-goo7wpa0wc-image.image) | ![Image](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/ee51ce32c1914aed81ff95080bb7db1d~tplv-goo7wpa0wc-image.image) | ![Image](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/ee51ce32c1914aed81ff95080bb7db1d~tplv-goo7wpa0wc-image.image) | ![Image](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/ee51ce32c1914aed81ff95080bb7db1d~tplv-goo7wpa0wc-image.image) | ![Image](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/ee51ce32c1914aed81ff95080bb7db1d~tplv-goo7wpa0wc-image.image) |
| [输出视频规格](https://www.volcengine.com/docs/82379/2298881?lang=zh#9fe4cce0) | 输出分辨率"resolution": "720p"                               | 480p720p1080p                                                | 480p720p                                                     | 480p720p1080p                                                | 480p720p1080p                                                | 480p720p1080p                                                | 480p720p1080p                                                | 480p720p1080p                                                |
|                                                              | 输出宽高比"ratio":"16:9"                                     | 21:916:94:31:13:49:16                                        | 21:916:94:31:13:49:16                                        | 21:916:94:31:13:49:16                                        | 21:916:94:31:13:49:16                                        | 21:916:94:31:13:49:16                                        | 21:916:94:31:13:49:16                                        | 21:916:94:31:13:49:16                                        |
|                                                              | 输出时长"duration": 5                                        | 4~15 秒                                                      | 4~15 秒                                                      | 4~12 秒                                                      | 2~12 秒                                                      | 2~12 秒                                                      | 2~12 秒                                                      | 2~12 秒                                                      |
|                                                              | 输出视频格式                                                 | mp4                                                          | mp4                                                          | mp4                                                          | mp4                                                          | mp4                                                          | mp4                                                          | mp4                                                          |
| [离线推理](https://www.volcengine.com/docs/82379/2298881?lang=zh#c3588bd1)"service_tier": "flex" |                                                              | ![Image](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/f359753773c94d97885008ca1223c9bc~tplv-goo7wpa0wc-image.image) | ![Image](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/f359753773c94d97885008ca1223c9bc~tplv-goo7wpa0wc-image.image) | ![Image](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/ee51ce32c1914aed81ff95080bb7db1d~tplv-goo7wpa0wc-image.image) | ![Image](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/ee51ce32c1914aed81ff95080bb7db1d~tplv-goo7wpa0wc-image.image) | ![Image](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/ee51ce32c1914aed81ff95080bb7db1d~tplv-goo7wpa0wc-image.image) | ![Image](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/ee51ce32c1914aed81ff95080bb7db1d~tplv-goo7wpa0wc-image.image) | ![Image](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/ee51ce32c1914aed81ff95080bb7db1d~tplv-goo7wpa0wc-image.image) |
| 在线推理限流                                                 | 最大 RPM                                                     | 企业用户：600个人用户：180                                   | 企业用户：600个人用户：180                                   | 600                                                          | 600                                                          | 600                                                          | 300                                                          | 300                                                          |
|                                                              | 最大并发数                                                   | 企业用户：10个人用户：3                                      | 企业用户：10个人用户：3                                      | 10                                                           | 10                                                           | 10                                                           | 5                                                            | 5                                                            |
| 离线推理限流                                                 | TPD                                                          | -                                                            | -                                                            | 5000亿                                                       | 5000亿                                                       | 5000亿                                                       | 2500亿                                                       | 2500亿                                                       |

# 基础使用

## 文生视频

根据用户输入的提示词生成视频，结果具有较大的随机性，可以用于激发创作灵感。

| 提示词                                                       | 输出                       |
| ------------------------------------------------------------ | -------------------------- |
| 写实风格，晴朗的蓝天之下，一大片白色的雏菊花田，镜头逐渐拉近，最终定格在一朵雏菊花的特写上，花瓣上有几颗晶莹的露珠 | 暂时无法在文档外展示此内容 |

 

## 图生视频-基于首帧（含音频）

通过指定视频的首帧图片，模型能够基于该图片生成与之相关且画面连贯的视频内容。

seedance 2.0 / seedance 1.5 pro 可通过设置参数 **generate_audio** 为 true，生成有声视频。

| 提示词                                                       | 首帧                                                         | 输出                       |
| ------------------------------------------------------------ | ------------------------------------------------------------ | -------------------------- |
| 女孩抱着狐狸，女孩睁开眼，温柔地看向镜头，狐狸友善地抱着，镜头缓缓拉出，女孩的头发被风吹动，可以听到风声 | ![Image](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/a28ec84ff9fc4287a0d98191020a3218~tplv-goo7wpa0wc-image.image) | 暂时无法在文档外展示此内容 |

 

## 图生视频-基于首尾帧（含音频）

通过指定视频的起始和结束图片，模型即可生成流畅衔接首、尾帧的视频，实现画面间自然、连贯的过渡效果。

seedance 2.0 / seedance 1.5 pro 可通过设置参数 **generate_audio** 为 true，生成有声视频。

| 提示词                                  | 首帧                                                         | 尾帧                                                         | 输出                       |
| --------------------------------------- | ------------------------------------------------------------ | ------------------------------------------------------------ | -------------------------- |
| 图中女孩对着镜头说“茄子”，360度环绕运镜 | ![Image](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/649cb2057eae48d6a6eec872d912c75c~tplv-goo7wpa0wc-image.image) | ![Image](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/e39fd8e500a34bbdad50d06659c4ea6b~tplv-goo7wpa0wc-image.image) | 暂时无法在文档外展示此内容 |

 

## 图生视频-基于参考图

模型能精准提取参考图片（支持输入1-4张）中各类对象的关键特征，并依据这些特征在视频生成过程中高度还原对象的形态、色彩和纹理等细节，确保生成的视频与参考图的视觉风格一致。

| 提示词                                                       | 参考图1                                                      | 参考图2                                                      | 参考图3                                                      | 输出                       |
| ------------------------------------------------------------ | ------------------------------------------------------------ | ------------------------------------------------------------ | ------------------------------------------------------------ | -------------------------- |
| [图1]戴着眼镜穿着蓝色T恤的男生和[图2]的柯基小狗，坐在[图3]的草坪上，视频卡通风格 | ![Image](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/2637ac87f1e64bd897bfc651fe7d0386~tplv-goo7wpa0wc-image.image) | ![Image](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/9450c9444b574112a9f228db9e81cdf4~tplv-goo7wpa0wc-image.image) | ![Image](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/574b8785f4b740ddaff791655e8633ba~tplv-goo7wpa0wc-image.image) | 暂时无法在文档外展示此内容 |

 

## 管理视频任务

### 查询视频生成任务列表

该接口支持传入条件筛选参数，以查询符合条件的视频生成任务列表。

 

### 删除或取消视频生成任务

取消排队中的视频生成任务，或者删除视频生成任务记录。

 

## 设置视频输出规格【New】

支持通过 **resolution、ratio、duration、frames、seed、camera_fixed、watermark** 参数控制视频输出的规格。

注意

不同模型，可能对应支持不同的参数与取值，详见下方表格。当输入的参数或取值不符合所选的模型时，该参数将被忽略或触发报错。

- **新方式：**在 request body 中直接传入参数。此方式为**强校验，**若参数填写错误，模型会返回错误提示。

- **旧方式：**在文本提示词后追加 --[parameters]。此方式为**弱校验，**若参数填写错误，模型将自动使用默认值且不会报错。

- **新方式（推荐）：在 request body 中直接传入参数**

```
...
   // Strongly recommended
   // Specify the aspect ratio of the generated video as 16:9, duration as 5 seconds, resolution as 720p, seed as 11, and include a watermark. The camera is not fixed.
    "model": "doubao-seedance-2-0-260128",
    "content": [
        {
            "type": "text",
            "text": "小猫对着镜头打哈欠"
        }
    ],
    // All parameters must be written in full; abbreviations are not supported
    "resolution": "720p",
    "ratio":"16:9",
    "duration": 5,
    // "frames": 29, Either duration or frames is required
    "seed": 11,
    "camera_fixed": false,
    "watermark": true
...
```

- **旧方式：在文本提示词后追加** **--[parameters]**

```
...
// Specify the aspect ratio of the generated video as 16:9, duration as 5 seconds, resolution as 720p, seed as 11, and include a watermark. The camera is not fixed.
"content": [
        {
            "type": "text",
            "text": "小猫对着镜头打哈欠 --rs 720p --rt 16:9 --dur 5 --seed 11 --cf false --wm true"
            // "text": "小猫对着镜头打哈欠 --resolution 720p --ratio 16:9 --duration 5 --seed 11 --camerafixed false --watermark true"
        }
 ]
 ...
```

|                            | doubao-seedance-2-0                                          | doubao-seedance-2-0-fast                                     | doubao-seedance-1-5-pro                                      | doubao-seedance-1-0-prodoubao-seedance-1-0-pro-fast          | doubao-seedance-1-0-lite-t2vdoubao-seedance-1-0-lite-i2v     |
| -------------------------- | ------------------------------------------------------------ | ------------------------------------------------------------ | ------------------------------------------------------------ | ------------------------------------------------------------ | ------------------------------------------------------------ |
| resolution分辨率           | 480p720p1080p                                                | 480p720p                                                     | 480p720p1080p                                                | 480p720p1080p                                                | 480p720p1080p参考图场景不支持                                |
| ratio宽高比                | 16:94:31:13:49:1621:9adaptive480p 各画面比例的宽高像素值如下16:9：864×4964:3：752×5601:1：640×6403:4：560×7529:16：496×86421:9：992×432720p 各画面比例的宽高像素值如下16:9：1280×7204:3：1112×8341:1：960×9603:4：834×11129:16：720×128021:9：1470×6301080p 各画面比例的宽高像素值如下16:9：1920×10804:3：1664×12481:1：1440×14403:4：1248×16649:16：1080×192021:9：2206×946 | 16:94:31:13:49:1621:9adaptive480p 各画面比例的宽高像素值如下16:9：864×4964:3：752×5601:1：640×6403:4：560×7529:16：496×86421:9：992×432720p 各画面比例的宽高像素值如下16:9：1280×7204:3：1112×8341:1：960×9603:4：834×11129:16：720×128021:9：1470×630 | 16:94:31:13:49:1621:9adaptive480p 各画面比例的宽高像素值如下16:9：864×4964:3：752×5601:1：640×6403:4：560×7529:16：496×86421:9：992×432720p 各画面比例的宽高像素值如下16:9：1280×7204:3：1112×8341:1：960×9603:4：834×11129:16：720×128021:9：1470×6301080p 各画面比例的宽高像素值如下16:9：1920×10804:3：1664×12481:1：1440×14403:4：1248×16649:16：1080×192021:9：2206×946 | 16:94:31:13:49:1621:9adaptive文生视频场景不支持480p 各画面比例的宽高像素值如下16:9：864×4804:3：736×5441:1：640×6403:4：544×7369:16：480×86421:9：960×416720p 各画面比例的宽高像素值如下16:9：1248×7044:3：1120×8321:1：960×9603:4：832×11209:16：704×124821:9：1504×6401080p 各画面比例的宽高像素值如下16:9：1920×10884:3：1664×12481:1：1440×14403:4：1248×16649:16：1088×192021:9：2176×928 | 16:94:31:13:49:1621:9adaptive参考图和文生视频场景不支持480p 各画面比例的宽高像素值如下16:9：864×4804:3：736×5441:1：640×6403:4：544×7369:16：480×86421:9：960×416720p 各画面比例的宽高像素值如下16:9：1248×7044:3：1120×8321:1：960×9603:4：832×11209:16：704×124821:9：1504×6401080p 各画面比例的宽高像素值如下参考图场景不支持16:9：1920×10884:3：1664×12481:1：1440×14403:4：1248×16649:16：1088×192021:9：2176×928 |
| duration生成视频时长（秒） | 4 ~15 秒                                                     | 4 ~15 秒                                                     | 4 ~12 秒                                                     | 2 ~12 秒                                                     | 2 ~12 秒                                                     |
| frames生成视频帧数         | ![Image](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/f359753773c94d97885008ca1223c9bc~tplv-goo7wpa0wc-image.image) | ![Image](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/f359753773c94d97885008ca1223c9bc~tplv-goo7wpa0wc-image.image) | ![Image](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/f359753773c94d97885008ca1223c9bc~tplv-goo7wpa0wc-image.image) | 支持 [29, 289] 区间内所有满足 25 + 4n 格式的整数值，其中 n 为正整数。 | 支持 [29, 289] 区间内所有满足 25 + 4n 格式的整数值，其中 n 为正整数。 |
| seed种子整数               | ![Image](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/ee51ce32c1914aed81ff95080bb7db1d~tplv-goo7wpa0wc-image.image) | ![Image](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/ee51ce32c1914aed81ff95080bb7db1d~tplv-goo7wpa0wc-image.image) | ![Image](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/ee51ce32c1914aed81ff95080bb7db1d~tplv-goo7wpa0wc-image.image) | ![Image](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/ee51ce32c1914aed81ff95080bb7db1d~tplv-goo7wpa0wc-image.image) | ![Image](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/ee51ce32c1914aed81ff95080bb7db1d~tplv-goo7wpa0wc-image.image) |
| camera_fixed是否固定摄像头 | ![Image](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/f359753773c94d97885008ca1223c9bc~tplv-goo7wpa0wc-image.image) | ![Image](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/f359753773c94d97885008ca1223c9bc~tplv-goo7wpa0wc-image.image) | ![Image](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/ee51ce32c1914aed81ff95080bb7db1d~tplv-goo7wpa0wc-image.image) | ![Image](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/ee51ce32c1914aed81ff95080bb7db1d~tplv-goo7wpa0wc-image.image) | ![Image](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/ee51ce32c1914aed81ff95080bb7db1d~tplv-goo7wpa0wc-image.image)参考图场景不支持 |
| watermark是否包含水印      | ![Image](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/ee51ce32c1914aed81ff95080bb7db1d~tplv-goo7wpa0wc-image.image) | ![Image](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/ee51ce32c1914aed81ff95080bb7db1d~tplv-goo7wpa0wc-image.image) | ![Image](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/ee51ce32c1914aed81ff95080bb7db1d~tplv-goo7wpa0wc-image.image) | ![Image](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/ee51ce32c1914aed81ff95080bb7db1d~tplv-goo7wpa0wc-image.image) | ![Image](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/ee51ce32c1914aed81ff95080bb7db1d~tplv-goo7wpa0wc-image.image) |

## 提示词建议

- **提示词 = 主体 + 运动， 背景 + 运动，镜头 + 运动 ...**

- 用简洁准确的自然语言写出你想要的效果。

- 如果有较为明确的效果预期，建议先用生图模型生成符合预期的图片，再用图生视频进行视频片段的生成。

- 文生视频会有较大的结果随机性，可以用于激发创作灵感

- 图生视频时请尽量上传高清高质量的图片，上传图片的质量对图生视频影响较大。

- 当生成的视频不符合预期时，建议修改提示词，将抽象描述换成具象描述，并注意删除不重要的部分，将重要内容前置。

- 更多提示词的使用技巧请参见 [Seedance-1.5-pro 提示词指南]()、[Seedance-1.0-pro&pro-fast 提示词指南]()、 [Seedance-1.0-lite 提示词指南]()。

# 进阶使用

## 离线推理

> 不支持 seedance 2.0 及 seedance 2.0 fast

针对推理时延敏感度低（例如小时级响应）的场景，建议将 **service_tier** 设为 flex，一键切换至离线推理模式——价格仅为在线推理的 50%，显著降低业务成本。

注意根据业务场景设置合适的超时时间，超过该时间后任务将自动终止。

 

## 样片模式

> 仅支持 seedance 1.5 pro

获得一个符合预期的生产级别视频，通常需要多次抽卡，耗时耗力。样片模式是平台推出的中间产物可视化功能，开启该功能后，将生成一段预览视频，帮助用户 **低成本验证** 生成视频的场景结构、镜头调度、主体动作与 Prompt 意图等关键要素是否符合预期，快速调整方向。确认符合预期后，再基于 Draft 视频生成最终的高质量视频。

| 输入                                                         | Draft 视频                                                   | 正式视频                                                     |
| ------------------------------------------------------------ | ------------------------------------------------------------ | ------------------------------------------------------------ |
| ![Image](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/ebb5217645b04cfc94209a6f7d36a523~tplv-goo7wpa0wc-image.image)提示词：女孩抱着狐狸，女孩睁开眼，温柔地看向镜头，狐狸友善地抱着，镜头缓缓拉出，女孩的头发被风吹动，可以听到风声 | 暂时无法在文档外展示此内容生成一段预览视频，低成本验证结果。 | 暂时无法在文档外展示此内容复用 Draft 视频使用 **模型、提示词、输入图片、种子值、音频设置、视频宽高比、视频时长等** 生成正式视频，保证视频关键要素一致。 |

本功能使用分为两步：

### Step1: 生成 Draft 视频

1. 设置 "draft": true，调用POST /contents/generations/tasks接口创建 Draft 视频生成任务。

1. 调用GET /contents/generations/tasks/{id}接口查询生成状态和结果，下载 Draft 视频，确认是否符合预期。

说明

- 仅 seedance 1.5 pro 支持该功能。

- 仅支持 480p 分辨率（使用其他分辨率会报错），不支持返回尾帧功能，不支持离线推理功能。

- Draft 视频的 token 单价不变，消耗的 token 更少。Draft视频token用量 = 正常视频token用量 × 折算系数，以 seedance 1.5 pro 为例，有声视频的折算系数为 0.6，故生成一个 Draft 有声视频的价格是正常视频的 0.6 倍，显著降低了成本。

 

### Step2: 基于 Draft 视频生成正式视频

如果确认 Draft 视频符合预期，可基于 Step1 返回的 Draft 视频任务 ID，再次调用POST /contents/generations/tasks接口，生成最终视频。

说明

- 平台将自动复用 Draft 视频使用的用户输入（ **model、**content.**text、**content.**image_url、generate_audio、seed、ratio、duration、camera_fixed** ），生成正式视频。

- 其余参数支持指定，不指定将使用本模型的默认值。例如：指定正式视频的分辨率、是否包含水印、是否使用离线推理、是否返回尾帧等。

- 基于 Draft 视频生成最终视频属于正常推理过程，按照正常视频消耗 token 量计费。

- Draft 视频任务 ID 的有效期为 7 天（从 **created at** 时间戳开始计算），超时后将无法使用该 Draft 视频生成正式视频。

 

## 生成多个连续视频

使用前一个生成视频的尾帧，作为后一个视频任务的首帧，循环生成多个连续的视频。

后续您可以自行使用 FFmpeg 等工具，将生成的多个短视频拼接成一个完整长视频。

| 输出1                                                        | 输出2                                                        | 输出3                                                        |
| ------------------------------------------------------------ | ------------------------------------------------------------ | ------------------------------------------------------------ |
| 暂时无法在文档外展示此内容女孩抱着狐狸，女孩睁开眼，温柔地看向镜头，狐狸友善地抱着，镜头缓缓拉出，女孩的头发被风吹动 | 暂时无法在文档外展示此内容女孩和狐狸在草地上奔跑，阳光明媚，女孩的笑容灿烂，狐狸欢快地跳跃 | 暂时无法在文档外展示此内容女孩和狐狸坐在树下休息，女孩轻轻抚摸狐狸的毛发，狐狸温顺地趴在女孩腿上 |

```
import os
import time  
# Install SDK:  pip install 'volcengine-python-sdk[ark]'
from volcenginesdkarkruntime import Ark 

# Make sure that you have stored the API Key in the environment variable ARK_API_KEY
# Initialize the Ark client to read your API Key from an environment variable
client = Ark(
    # This is the default path. You can configure it based on the service location
    base_url="https://ark.cn-beijing.volces.com/api/v3",
    # Get API Key：https://console.volcengine.com/ark/region:ark+cn-beijing/apikey
    api_key=os.environ.get("ARK_API_KEY"),
)

def generate_video_with_last_frame(prompt, initial_image_url=None):
    """
    Generate video and return video URL and last frame URL
    Parameters:
    prompt: Text prompt for video generation
    initial_image_url: Initial image URL (optional) 
    Returns:
    video_url: Generated video URL
    last_frame_url: URL of the last frame of the video
    """
    print(f"----- Generating video: {prompt} -----")
    
    # Build content list
    content = [{
        "text": prompt,
        "type": "text"
    }]
    
    # If initial image is provided, add to content
    if initial_image_url:
        content.append({
            "image_url": {
                "url": initial_image_url
            },
            "type": "image_url"
        })
    
    # Create video generation task
    create_result = client.content_generation.tasks.create(
        model="doubao-seedance-2-0-260128", # Replace with Model ID
        content=content,
        return_last_frame=True, 
        ratio="adaptive",
        duration=5,
        watermark=False,
    )
    
    # Poll to check task status
    task_id = create_result.id
    while True:
        get_result = client.content_generation.tasks.get(task_id=task_id)
        status = get_result.status
        
        if get_result.status == "succeeded":
            print("Video generation succeeded")
            try:
                if hasattr(get_result, 'content') and hasattr(get_result.content, 'video_url') and hasattr(get_result.content, 'last_frame_url'):
                    return get_result.content.video_url, get_result.content.last_frame_url
                print("Failed to obtain video URL or last frame URL")
                return None, None
            except Exception as e:
                print(f"Error occurred while obtaining video URL and last frame URL: {e}")
                return None, None
        elif status == "failed":
            print(f"----- Video generation failed -----")
            print(f"Error: {get_result.error}")
            return None, None
        else:
            print(f"Current status: {status}, retrying in 10 seconds...")
            time.sleep(10)



if __name__ == "__main__":
    # Define 3 video prompts
    prompts = [
        "女孩抱着狐狸，女孩睁开眼，温柔地看向镜头，狐狸友善地抱着，镜头缓缓拉出，女孩的头发被风吹动",
        "女孩和狐狸在草地上奔跑，阳光明媚，女孩的笑容灿烂，狐狸欢快地跳跃",
        "女孩和狐狸坐在树下休息，女孩轻轻抚摸狐狸的毛发，狐狸温顺地趴在女孩腿上"
    ]
    
    # Store generated video URLs
    video_urls = []
    
    # Initial image URL
    initial_image_url = "https://ark-project.tos-cn-beijing.volces.com/doc_image/i2v_foxrgirl.png"
    
    # Generate 3 short videos
    for i, prompt in enumerate(prompts):
        print(f"Generating video {i+1}")
        video_url, last_frame_url = generate_video_with_last_frame(prompt, initial_image_url)
        
        if video_url and last_frame_url:
            video_urls.append(video_url)
            print(f"Video {i+1} URL: {video_url}")
            # Use the last frame of the current video as the first frame of the next video
            initial_image_url = last_frame_url
        else:
            print(f"Video {i+1} generation failed, exiting program")
            exit(1)
    
    print("All videos generated successfully!")
    print("Generated video URL list:")
    for i, url in enumerate(video_urls):
        print(f"Video {i+1}: {url}")
```

## 使用 Webhook 通知

通过 **callback_url** 参数可以指定一个回调通知地址，当视频生成任务的状态发生变化时，方舟会向该地址发送一条 POST 请求，方便您及时获取任务最新情况。 请求内容结构与[查询任务API](https://www.volcengine.com/docs/82379/1521309)的返回体一致。

```
{
  "id": "cgt-2025****",
  "model": "doubao-seedance-2-0-260128",
  "status": "running", # Possible status values: queued, running, succeeded, failed, expired
  "created_at": 1765434920,
  "updated_at": 1765434920,
  "service_tier": "default",
  "execution_expires_after": 172800
}
```

您需要自行搭建一个公网可访问的 Web Server 来接收 Webhook 通知。以下是一个简单的 Web Server 代码示例，供您参考。

```
# Building a Simple Web Server with Python Flask for Webhook Notification Processing

from flask import Flask, request, jsonify
import sqlite3
import logging
from datetime import datetime
import os

# === Basic Configuration ===
app = Flask(__name__)
# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s',
    handlers=[logging.FileHandler('webhook.log'), logging.StreamHandler()]
)
# Database path
DB_PATH = 'video_tasks.db'

# === Database Initialization ===
def init_db():
    """Automatically create task table on first run, aligning fields with callback parameters"""
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    # Create table: task_id as primary key for idempotent updates
    cursor.execute('''
    CREATE TABLE IF NOT EXISTS video_generation_tasks (
        task_id TEXT PRIMARY KEY,
        model TEXT NOT NULL,
        status TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        service_tier TEXT NOT NULL,
        execution_expires_after INTEGER NOT NULL,
        last_callback_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
    ''')
    conn.commit()
    conn.close()
    logging.info("Database initialized, table created/exists")

# === Core Webhook Interface ===
@app.route('/webhook/callback', methods=['POST'])
def video_task_callback():
    """Core interface for receiving Ark callback"""
    try:
        # 1. Parse callback request body (JSON format)
        callback_data = request.get_json()
        if not callback_data:
            logging.error("Callback request body empty or non-JSON format")
            return jsonify({"code": 400, "msg": "Invalid JSON data"}), 400

        # 2. Validate required fields
        required_fields = ['id', 'model', 'status', 'created_at', 'updated_at', 'service_tier', 'execution_expires_after']
        for field in required_fields:
            if field not in callback_data:
                logging.error(f"Callback data missing required field: {field}, data: {callback_data}")
                return jsonify({"code": 400, "msg": f"Missing field: {field}"}), 400

        # 3. Extract key information and log
        task_id = callback_data['id']
        status = callback_data['status']
        model = callback_data['model']
        logging.info(f"Received task callback | Task ID: {task_id} | Status: {status} | Model: {model}")
        print(f"[{datetime.now()}] Task {task_id} status updated to: {status}")  # Console output

        # 4. Database operation
        conn = sqlite3.connect(DB_PATH)
        cursor = conn.cursor()
        cursor.execute('''
        INSERT OR REPLACE INTO video_generation_tasks (
            task_id, model, status, created_at, updated_at, service_tier, execution_expires_after
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
        ''', (
            task_id,
            model,
            status,
            callback_data['created_at'],
            callback_data['updated_at'],
            callback_data['service_tier'],
            callback_data['execution_expires_after']
        ))
        conn.commit()
        conn.close()
        logging.info(f"Task {task_id} database update successful")

        # 5. Return 200 response
        return jsonify({"code": 200, "msg": "Callback received successfully", "task_id": task_id}), 200

    except Exception as e:
        # Catch all exceptions to avoid returning 5xx
        logging.error(f"Callback processing failed: {str(e)}", exc_info=True)
        return jsonify({"code": 200, "msg": "Callback received successfully (internal processing exception)"}), 200

# === Helper Interface (Optional, for querying task status) ===
@app.route('/tasks/<task_id>', methods=['GET'])
def get_task_status(task_id):
    """Query latest status of specified task"""
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    cursor.execute('SELECT * FROM video_generation_tasks WHERE task_id = ?', (task_id,))
    task = cursor.fetchone()
    conn.close()
    if not task:
        return jsonify({"code": 404, "msg": "Task not found"}), 404
    # Map field names for response
    fields = ['task_id', 'model', 'status', 'created_at', 'updated_at', 'service_tier', 'execution_expires_after', 'last_callback_at']
    task_dict = dict(zip(fields, task))
    return jsonify({"code": 200, "data": task_dict}), 200

# === Service Startup ===
if __name__ == '__main__':
    # Initialize database
    init_db()
    # Start Flask service (bind to 0.0.0.0 for public access, port customizable)
    # Test environment: debug=True; Production environment should disable debug and use gunicorn
    app.run(host='0.0.0.0', port=8080, debug=False)
```

# 使用限制

## 多模态输入

注意

seedance 2.0 系列模型不支持直接上传含有真人人脸的参考图/视频。为了便利创作者对肖像的使用，平台推出了一系列解决方案，详情参见seedance 2.0 系列教程的[便利创作]()章节。

**图片要求**

- 传入方式：URL或Base64编码。

- 格式：jpeg、png、webp、bmp、tiff、gif。其中，seedance 1.5 pro 新增支持 heic 和 heif。

- 单个图片尺寸：

- 宽高比（宽/高）： (0.4, 2.5)

- 宽高长度（px）：(300, 6000)

- 大小：单张图片小于 30 MB。请求体大小不超过 64 MB。大文件请勿使用Base64编码。

- 图片数量：

- 图生视频-首帧：1 张

- 图生视频-首尾帧：2 张

- seedance 2.0 多模态参考生视频：1~9 张

- seedance 1.0 lite 参考图生视频：1~4 张

**视频要求**

- 传入方式：URL。

- 视频格式：mp4、mov，支持编码格式见下表。

- 分辨率：480p，720p，1080p

- 时长：单个视频时长 [2, 15] s，最多传入 3 个参考视频，所有视频总时长不超过 15s。

- 单个视频尺寸：

- 宽高比（宽/高）：[0.4, 2.5]

- 宽高长度（px）：[300, 6000]

- 总像素数：[640×640=409600, 2206×946=2086876]，即宽和高的乘积符合 [409600, 2086876] 的区间要求。

- 大小：单个视频不超过 50 MB。

- 帧率 (FPS)：[24, 60]

| **容器格式** | **常用文件扩展名** | **MIME**        | **支持编码**                              |
| ------------ | ------------------ | --------------- | ----------------------------------------- |
| MP4          | .mp4               | video/mp4       | 视频：H.264/AVC、H.265/HEVC音频：AAC、MP3 |
| QuickTime    | .mov               | video/quicktime | 视频：H.264/AVC、H.265/HEVC音频：AAC、MP3 |

**音频要求**

- 格式：wav、mp3

- 时长：单个音频时长 [2, 15] s，最多传入 3 段参考音频，所有音频总时长不超过 15 s。

- 大小：单个音频不超过 15 MB，请求体大小不超过 64 MB。大文件请勿使用Base64编码。

## 保存时间

任务数据（如任务状态、视频URL等）仅保留24小时，超时后会被自动清除。请您务必及时保存生成的视频。

## 限流说明

**模型限流**

**default（在线推理）**

- RPM 限流：账号下同模型（区分模型版本）每分钟允许创建的任务数量上限。若超过该限制，创建视频生成任务时会报错。

- 并发数限制：账号下同模型（区分模型版本）同一时刻在处理中的任务数量上限。超过此限制的任务将进入队列等待处理。

- 不同模型的限制值不同，详见[视频生成能力]()。

**flex（离线推理）**

- TPD 限流：账号在一天内对同一模型（区分模型版本）的总调用 token 上限。超过此限制的调用请求将被拒绝。不同模型的 TPD 限流值不同，详见[视频生成能力]()。

## 图片裁剪规则

**seedance 系列模型的图生视频场景，支持设置生成视频的宽高比。**当选择的视频宽高与您上传的图片宽高比不一致时，方舟会对您的图片进行裁剪，裁剪时会居中裁剪。详细规则如下：

说明

若要呈现出较好的视频效果，建议所指定的视频宽高比（ratio）与实际上传图片的宽高比尽可能接近。

1. 输入参数：

- 原始图片宽度记为W（单位：像素），高度记为H（单位：像素）。

- 目标比例记为A:B（例如，21:9），这表示裁剪后的宽度与高度之比应为 A/B（如 21/9≈2.333）。

1. 比较宽高比：

- 计算原始图片的宽高比Ratio_原始=W/H。

- 计算目标比例的比值Ratio_目标=A/B（例如，21:9 的 Ratio目标=21/9≈2.333)。

- 根据比较结果，决定裁剪基准：

- 如果Ratio_原始<Ratio_目标（即原始图片“太高”或“竖高”），则以宽度为基准裁剪。

- 如果Ratio_原始>Ratio_目标（即原始图片“太宽”或“横宽”），则以高度为基准裁剪。

- 如果相等，则无需裁剪，直接使用全图。

1. 裁剪尺寸计算（量化公式）：

- 以宽度为基准（适用于竖高图片）：

- 裁剪宽度Crop_W=W（使用整个原始宽度）。

- 裁剪高度Crop_H=(B/A)×W（根据目标比例等比例计算高度）。

- 裁剪区域的起始坐标（居中定位）：

- X 坐标（水平）：总是 0（因为宽度全用，从左侧开始）。

- Y 坐标（垂直）：(H−Crop_H)/2（确保垂直居中，从顶部开始）。

- 以高度为基准（适用于横宽图片）：

- 裁剪高度Crop_H=H（使用整个原始高度）。

- 裁剪宽度Crop_W=(A/B)×H（根据目标比例等比例计算宽度）。

- 裁剪区域的起始坐标（居中定位）：

- X 坐标（水平）：(W−Crop_W)/2（确保水平居中，从左侧开始）。

- Y 坐标（垂直）：总是 0（因为高度全用，从顶部开始）。

1. 裁剪结果：