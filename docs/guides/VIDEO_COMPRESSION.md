---
title: 视频压缩优化记录
type: doc
status: active
owner: Claude
created: 2026-04-18
updated: 2026-04-21
tags: [guide, media, video]
---

# 视频压缩优化记录

**优化日期**: 2026-02-13 22:15

---

## 📊 压缩结果

### the-tiger-who-came-to-tea.mp4

**压缩前**:
- 文件大小: 197MB
- 码率: 1179 kbps
- 分辨率: 720x404
- 编码: H.264 + AAC
- 时长: 23分18秒

**压缩后**:
- 文件大小: 93MB
- 码率: 560 kbps（约）
- 分辨率: 720x404（保持不变）
- 编码: H.264 + AAC
- 时长: 23分18秒

**优化效果**:
- ✅ 节省空间: 104MB（52.8%）
- ✅ 音视频完整: 保留所有音视频流
- ✅ 质量可观看: CRF 28 保持良好质量
- ✅ 部署友好: 符合主流托管平台限制

---

## 🛠️ 压缩参数

### FFmpeg 命令
```bash
ffmpeg -i the-tiger-who-came-to-tea.mp4 \
  -c:v libx264 \
  -crf 28 \
  -preset medium \
  -c:a aac \
  -b:a 128k \
  -movflags +faststart \
  the-tiger-who-came-to-tea-compressed.mp4 \
  -y
```

### 参数说明
- **-c:v libx264**: 使用 H.264 视频编码器
- **-crf 28**: 恒定质量模式，28 是平衡质量和大小的选择（范围 0-51，越小质量越好）
- **-preset medium**: 编码速度预设，平衡速度和压缩效果
- **-c:a aac**: 使用 AAC 音频编码器
- **-b:a 128k**: 音频比特率 128kbps（原始为 96kbps，略微提升）
- **-movflags +faststart**: 优化在线流媒体播放

---

## 📈 项目整体影响

### 构建大小变化
- **优化前**: 570MB
- **优化后**: 458MB
- **节省**: 112MB（19.6%）

### 部署兼容性
| 平台 | 状态 |
|------|------|
| 阿里云 ECS | ✅ 当前部署方案，无文件大小限制 |

---

## 💡 压缩策略

### 选择 CRF 28 的原因
1. **CRF 18-22**: 几乎无损，文件仍然很大
2. **CRF 23-27**: 高质量，适合重要内容
3. **CRF 28**: ✅ **平衡点** - 质量可观看，大小合理
4. **CRF 29-33**: 中等质量，适合社交媒体
5. **CRF 34+**: 低质量，不推荐

### 为什么不进一步压缩
- 这是一个 23 分钟的儿童故事视频
- 需要保持足够清晰度供观看
- CRF 28 已经达到了很好的平衡
- 进一步压缩会明显降低观看体验

---

## 🔍 验证结果

### 视频验证
```bash
ffprobe -v error -show_entries stream=codec_type \
  -of default=noprint_wrappers=1:nokey=1 \
  the-tiger-who-came-to-tea.mp4
```

**输出**:
```
video
audio
```
✅ 音频和视频流均正常

### 编码信息
- **视频编码**: H.264 (High Profile, Level 3.0)
- **音频编码**: AAC-LC
- **帧率**: 25 fps
- **宽高比**: SAR 1:1, DAR 180:101

---

## 📝 最佳实践

### 何时需要压缩视频
1. 单个文件超过 100MB
2. 准备部署到有文件大小限制的平台
3. 需要优化加载速度和带宽消耗
4. 视频时长较长（>5分钟）

### 推荐的 CRF 值
- **高质量内容**（教程、产品展示）: CRF 23-26
- **一般内容**（故事、娱乐）: CRF 27-29
- **社交媒体**（短视频、预览）: CRF 30-33

### 音频设置建议
- **音乐视频**: 192-256 kbps
- **一般对话**: 128 kbps
- **播客**: 96 kbps

---

## 🎯 后续优化建议

### 其他可能需要压缩的文件
检查项目中其他大文件：
```bash
find public/assets/media -type f -size +20M -exec ls -lh {} \;
```

### CDN 方案（可选）
如果文件仍然太大，可以考虑：
1. 使用 Cloudinary 或 AWS S3 托管视频
2. 更新 `mediaItems.js` 中的路径为 CDN URL
3. 仅在 dist 中保留小于 10MB 的文件

### 渐进式加载（可选）
1. 实现视频懒加载
2. 使用低质量占位符
3. 用户点击播放时才加载完整视频

---

**优化完成**: 2026-02-13 22:15
**下一步**: 部署到 Cloudflare Workers（`npm run deploy`，由费在 CF 侧配置的 GitHub auto-deploy 触发，详见 `CLAUDE.md §自动化部署工作流`）

> 2026-04-21 更新：阿里云 ECS（`./deploy/deploy.sh`）已停用，主 prod 切到 `https://uvera.ai`（Cloudflare Workers）。
