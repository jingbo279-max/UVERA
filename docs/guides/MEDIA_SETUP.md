---
title: 媒体文件处理环境配置指南
type: doc
status: active
owner: Claude
created: 2026-04-18
updated: 2026-05-30
tags: [guide, media, setup]
---

# 媒体文件处理环境配置指南

本文档详细说明了项目中媒体文件的处理环境、工具配置和工作流程。

## 目录
- [环境要求](#环境要求)
- [目录结构](#目录结构)
- [工具安装](#工具安装)
- [文件命名规范](#文件命名规范)
- [工作流程](#工作流程)
- [常用命令](#常用命令)

---

## 环境要求

### 必需工具

| 工具 | 版本 | 用途 |
|------|------|------|
| **Homebrew** | 最新 | macOS 包管理器 |
| **FFmpeg** | 8.0+ | 视频/音频处理 |
| **Node.js** | 16+ | 运行脚本工具 |

### 可选工具

| 工具 | 用途 |
|------|------|
| **ImageMagick** | 图片批处理 |
| **yt-dlp** | YouTube 视频下载 |

---

## 目录结构

```
uvera/
├── public/
│   └── assets/
│       ├── covers/              # 封面图片目录
│       │   ├── single/          # 单曲封面 (1:1, 4:3)
│       │   ├── album/           # 专辑封面 (1:1, 16:9)
│       │   ├── mv/              # MV 封面 (9:16, 16:9)
│       │   ├── clip/            # 短视频封面 (9:16)
│       │   ├── film/            # 电影封面 (16:9)
│       │   ├── story/           # 故事封面 (9:16, 其他)
│       │   ├── live/            # 直播封面 (4:3, 其他)
│       │   └── parallel/        # 平行世界封面 (混合)
│       └── media/               # 媒体文件目录
│           ├── single/          # 单曲音频文件
│           ├── album/           # 专辑音频文件
│           ├── mv/              # MV 视频文件
│           ├── clip/            # 短视频文件
│           ├── film/            # 电影视频文件
│           ├── story/           # 故事视频文件
│           ├── live/            # 直播视频文件
│           └── parallel/        # 平行世界媒体文件
├── src/
│   ├── data/
│   │   └── mediaItems.js        # 媒体配置数据
│   └── utils/
│       └── mediaParser.js       # 文件名解析工具
├── scripts/
│   └── generateMediaConfig.js   # 批量生成配置脚本
└── docs/
    ├── MEDIA_SETUP.md           # 本文档
    └── MEDIA_FILE_NAMING.md     # 文件命名规范
```

---

## 工具安装

### 1. 安装 Homebrew

```bash
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
```

**安装后配置：**
```bash
echo 'eval "$(/opt/homebrew/bin/brew shellenv)"' >> ~/.zprofile
eval "$(/opt/homebrew/bin/brew shellenv)"
```

### 2. 安装 FFmpeg

```bash
brew install ffmpeg
```

**验证安装：**
```bash
ffmpeg -version
```

### 3. 安装可选工具

```bash
# 图片处理
brew install imagemagick

# YouTube 下载
brew install yt-dlp
```

---

## 文件命名规范

### 媒体文件命名格式

**格式：** `Title-Artist.ext`

**示例：**
```
Give back to God-Henry.MP4
Don't Start Now-Dua Lipa.mp4
Crystal Waves-Echo Dreams.mp4
Midnight Dreams-Luna Rivers.mp3
```

**解析规则：**
- 使用单个 `-` 分隔 title 和 artist
- 特殊字符（撇号、引号）会被自动处理
- 大小写保持原样

**解析结果：**
```javascript
"Give back to God-Henry.MP4" → {
  title: "Give back to God",
  artist: "Henry"
}
```

### 封面图片命名格式

**自动生成为 kebab-case：**

| Title | 封面文件名 |
|-------|-----------|
| Give back to God | give-back-to-god.jpg |
| Don't Start Now | dont-start-now.jpg |
| Crystal Waves | crystal-waves.jpg |

---

## 工作流程

### 流程 1：添加新媒体文件

#### 步骤 1：准备源文件

将媒体文件按命名规范重命名：
```bash
# 示例
mv "原始文件.mp4" "Title-Artist.mp4"
```

#### 步骤 2：提取封面图

```bash
ffmpeg -i "path/to/video.mp4" \
  -ss 00:00:03 \
  -vframes 1 \
  -vf "scale=800:-1" \
  "public/assets/covers/{type}/{kebab-case-title}.jpg"
```

**示例：**
```bash
ffmpeg -i ~/Downloads/MV/"Give back to God-Henry.MP4" \
  -ss 00:00:03 \
  -vframes 1 \
  -vf "scale=800:-1" \
  public/assets/covers/mv/give-back-to-god.jpg
```

#### 步骤 3：压缩视频（如果需要）

**推荐设置（demo 使用）：**
```bash
ffmpeg -i "input.mp4" \
  -vf "scale=720:-2" \
  -c:v libx264 -crf 28 -preset fast \
  -c:a aac -b:a 128k \
  "output.mp4"
```

**完整示例：**
```bash
ffmpeg -i ~/Downloads/MV/"Give back to God-Henry.MP4" \
  -vf "scale=720:-2" \
  -c:v libx264 -crf 28 -preset fast \
  -c:a aac -b:a 128k \
  public/assets/media/mv/give-back-to-god.mp4
```

**压缩参数说明：**
- `scale=720:-2` - 缩放到 720p，保持宽高比
- `-crf 28` - 质量控制（18-28 推荐，数值越低质量越好）
- `-preset fast` - 编码速度（ultrafast, fast, medium, slow）
- `-b:a 128k` - 音频比特率 128kbps

**预期文件大小：**
| 原始大小 | 压缩后大小 | 分辨率 |
|----------|------------|--------|
| 300+ MB | 10-20 MB | 720p |
| 100-200 MB | 5-10 MB | 720p |

#### 步骤 4：添加配置

编辑 `src/data/mediaItems.js`：

```javascript
{
  id: 25,
  type: 'mv',
  category: 'MV',
  title: 'Give back to God',
  artist: 'Henry',
  cover: '/assets/covers/mv/give-back-to-god.jpg',
  color: 'from-purple-100 to-indigo-300',
  badgeHex: '#A78BFA',
  bgColor: 'bg-purple-100',
  aspectRatio: '16/9'
}
```

### 流程 2：批量处理

使用自动化脚本：

```bash
node scripts/generateMediaConfig.js
```

这会：
1. 扫描 `public/assets/media/` 下所有文件
2. 自动解析文件名
3. 生成配置到 `src/data/mediaItems.generated.js`

---

## 常用命令

### FFmpeg 常用操作

#### 1. 提取视频缩略图

```bash
# 在第 3 秒提取一帧
ffmpeg -i input.mp4 -ss 00:00:03 -vframes 1 output.jpg

# 缩放到指定宽度
ffmpeg -i input.mp4 -ss 00:00:03 -vframes 1 -vf "scale=800:-1" output.jpg
```

#### 2. 压缩视频

```bash
# 720p 压缩（推荐）
ffmpeg -i input.mp4 -vf "scale=720:-2" -c:v libx264 -crf 28 output.mp4

# 480p 压缩（更小）
ffmpeg -i input.mp4 -vf "scale=480:-2" -c:v libx264 -crf 30 output.mp4
```

#### 3. 截取视频片段

```bash
# 截取前 30 秒
ffmpeg -i input.mp4 -t 30 -c copy output.mp4

# 从第 10 秒开始截取 30 秒
ffmpeg -i input.mp4 -ss 00:00:10 -t 30 -c copy output.mp4
```

#### 4. 转换视频格式

```bash
# 转为 MP4
ffmpeg -i input.avi -c:v libx264 -c:a aac output.mp4

# 转为 WebM
ffmpeg -i input.mp4 -c:v libvpx-vp9 -c:a libopus output.webm
```

#### 5. 获取视频信息

```bash
ffmpeg -i input.mp4 2>&1 | grep Duration
```

#### 6. 批量处理

```bash
# 批量压缩当前目录所有 MP4
for file in *.mp4; do
  ffmpeg -i "$file" -vf "scale=720:-2" -c:v libx264 -crf 28 "compressed_${file}"
done
```

### 文件管理

```bash
# 查看文件大小
ls -lh public/assets/media/mv/

# 批量重命名
rename 's/ /-/g' *.mp4

# 移动文件
mv ~/Downloads/*.mp4 public/assets/media/mv/
```

---

## 故障排除

### 问题 1：FFmpeg 未安装

**症状：** `command not found: ffmpeg`

**解决：**
```bash
brew install ffmpeg
```

### 问题 2：视频文件过大

**症状：** 上传或加载缓慢

**解决：** 使用压缩命令
```bash
ffmpeg -i large-file.mp4 -vf "scale=720:-2" -crf 28 compressed.mp4
```

### 问题 3：封面图不显示

**检查清单：**
1. 文件路径是否正确（kebab-case）
2. 封面图是否存在于 `public/assets/covers/{type}/`
3. 配置中 `cover` 字段是否正确

### 问题 4：文件名解析错误

**常见原因：**
- 缺少 `-` 分隔符
- 使用了多个 `-`

**正确格式：**
```
✅ Title-Artist.mp4
❌ Title Artist.mp4
❌ Title-Sub-Title-Artist.mp4
```

---

## 性能优化建议

### 1. 视频优化

| 用途 | 分辨率 | CRF | 预期大小 |
|------|--------|-----|----------|
| Demo | 720p | 28 | 10-20 MB |
| 预览 | 480p | 30 | 5-10 MB |
| 生产 | 1080p | 23 | 30-50 MB |

### 2. 图片优化

```bash
# 使用 FFmpeg 压缩 JPG
ffmpeg -i input.jpg -q:v 3 output.jpg

# 转换为 WebP（更小）
ffmpeg -i input.jpg -c:v libwebp -quality 80 output.webp
```

### 3. 批量优化

创建脚本 `scripts/optimize-media.sh`：

```bash
#!/bin/bash

# 优化所有 MV
for file in public/assets/media/mv/*.mp4; do
  filename=$(basename "$file" .mp4)
  ffmpeg -i "$file" \
    -vf "scale=720:-2" \
    -c:v libx264 -crf 28 -preset fast \
    -c:a aac -b:a 128k \
    "public/assets/media/mv/optimized_${filename}.mp4"
done
```

---

## 相关文档

- [文件命名规范](./MEDIA_FILE_NAMING.md)
- 封面图片说明 — `public/assets/covers/`
- API 文档 — 见 `docs/archive/fei-api/`

---

## 更新日志

| 日期 | 版本 | 更新内容 |
|------|------|----------|
| 2025-02-13 | 1.0.0 | 初始版本，包含完整环境配置 |
