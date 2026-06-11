---
title: 媒体文件命名规范
type: doc
status: active
owner: Claude
created: 2026-04-18
updated: 2026-04-18
tags: [guide, media, naming]
---

# 媒体文件命名规范

## 文件命名格式

为了自动解析文件名并生成 title 和 artist，请遵循以下命名格式：

### 格式 1：标题-艺术家（推荐）

```
Title-Artist.ext
```

**示例：**
```
Don't Start Now-Dua Lipa.mp4
Blinding Lights-The Weeknd.mp4
Levitating-Dua Lipa.mp4
Midnight Dreams-Luna Rivers.mp3
```

**解析结果：**
- Title: `Don't Start Now`
- Artist: `Dua Lipa`

### 格式 2：仅标题

```
Title.ext
```

**示例：**
```
Crystal Waves.mp4
```

**解析结果：**
- Title: `Crystal Waves`
- Artist: `Unknown Artist`（默认）

## 自动生成配置

### 方法 1：使用工具函数

```javascript
import { generateMediaItem } from './src/utils/mediaParser';

const item = generateMediaItem({
  id: 13,
  type: 'mv',
  category: 'MV',
  filename: "Don't Start Now-Dua Lipa.mp4",
  color: 'from-cyan-100 to-cyan-300',
  badgeHex: '#22D3EE',
  bgColor: 'bg-cyan-100',
  aspectRatio: '9/16'
});
```

### 方法 2：批量生成脚本

```bash
# 扫描 public/assets/media/ 目录下的所有媒体文件
# 自动生成配置文件
node scripts/generateMediaConfig.js
```

**输出：**
- 控制台显示生成的配置
- 生成文件：`src/data/mediaItems.generated.js`

## 封面图片命名

封面图片会自动根据 title 生成 kebab-case 文件名：

| Title | 封面文件名 |
|-------|-----------|
| Don't Start Now | dont-start-now.jpg |
| Crystal Waves | crystal-waves.jpg |
| Midnight Dreams | midnight-dreams.jpg |

**封面路径：**
```
/assets/covers/{type}/{kebab-case-title}.jpg
```

## 目录结构

```
public/assets/
├── media/              # 媒体源文件
│   ├── single/
│   │   └── Midnight Dreams-Luna Rivers.mp3
│   ├── album/
│   │   └── Forest Tales-Green Valley.mp3
│   ├── mv/
│   │   ├── Don't Start Now-Dua Lipa.mp4
│   │   └── Crystal Waves-Echo Dreams.mp4
│   ├── clip/
│   ├── film/
│   ├── story/
│   ├── live/
│   └── parallel/
└── covers/             # 封面图片（自动生成路径）
    ├── single/
    │   └── midnight-dreams.jpg
    ├── album/
    │   └── forest-tales.jpg
    ├── mv/
    │   ├── dont-start-now.jpg
    │   └── crystal-waves.jpg
    └── ...
```

## 工具函数 API

### `parseMediaFileName(filename)`

解析文件名，提取 title 和 artist。

```javascript
import { parseMediaFileName } from './src/utils/mediaParser';

const { title, artist } = parseMediaFileName("Don't Start Now-Dua Lipa.mp4");
// { title: "Don't Start Now", artist: "Dua Lipa" }
```

### `toKebabCase(str)`

转换字符串为 kebab-case。

```javascript
import { toKebabCase } from './src/utils/mediaParser';

const filename = toKebabCase("Don't Start Now");
// "dont-start-now"
```

### `generateMediaItem(config)`

生成完整的媒体项配置对象。

```javascript
import { generateMediaItem } from './src/utils/mediaParser';

const item = generateMediaItem({
  id: 1,
  type: 'mv',
  category: 'MV',
  filename: "Don't Start Now-Dua Lipa.mp4",
  color: 'from-cyan-100 to-cyan-300',
  badgeHex: '#22D3EE',
  bgColor: 'bg-cyan-100',
  aspectRatio: '16/9'
});
```

## 注意事项

1. **连字符分隔符**：使用单个连字符 `-` 分隔 title 和 artist
2. **特殊字符**：文件名可以包含撇号、引号等，解析器会自动处理
3. **大小写**：文件名保持原样，转换为 kebab-case 时自动小写
4. **空格**：连字符前后的空格会被自动去除

## 常见问题

### Q: 如果艺术家名字中有连字符怎么办？

A: 使用引号或避免在艺术家名中使用连字符。例如：
```
Title-"Artist-Name".mp4
```

### Q: 封面图片必须存在吗？

A: 不是必须的。如果封面图片不存在，会自动使用渐变背景作为后备方案。

### Q: 可以手动修改生成的配置吗？

A: 可以。生成的配置只是起点，你可以手动调整任何字段。
