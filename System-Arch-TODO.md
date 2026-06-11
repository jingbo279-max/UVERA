# System Architecture TODO

> **项目**：智能音乐流媒体与内容生产系统
> **文档类型**：系统架构开发清单
> **最后更新**：2026-03-01

---

## 一、核心数据模型

### Music Asset（音乐资产）
- [ ] 定义 MusicAsset 数据表结构（id, file_url, audio_hash, duration, author_id, type, created_at）
- [ ] 实现 Asset ID 唯一生成机制（UUID v4 / ULID）
- [ ] 音频哈希计算服务（SHA-256）
- [ ] 作品类型枚举：`original` / `ai_generated` / `remix`

### Video Asset（视频资产）
- [ ] 定义 VideoAsset 表结构（id, file_url, video_hash, music_asset_id, digital_human_id, type, created_at）
- [ ] 资产类型枚举：`mv` / `live_replay`

### Digital Human Instance（数字人实例）
- [ ] 定义 DigitalHumanInstance 表结构（id, role_config, music_asset_id, drive_mode, style_config）
- [ ] 角色配置 JSON Schema 设计

### Live Session（直播会话）
- [ ] 定义 LiveSession 表结构（id, host_id, type, music_asset_id, digital_human_id, status, started_at, ended_at）
- [ ] 直播回放关联设计（session_id → replay_asset_id）

### Asset Relation（作品关系）
- [ ] 父子作品关系表（parent_asset_id, child_asset_id, relation_type）
- [ ] 关系类型枚举：`remix` / `edit` / `sample`

---

## 二、API 接口设计

### 音乐资产 API
- [ ] `POST   /api/music` — 上传创建音乐资产
- [ ] `GET    /api/music` — 作品列表（分页、搜索）
- [ ] `GET    /api/music/:id` — 作品详情
- [ ] `GET    /api/music/:id/stream` — 流媒体播放地址
- [ ] `GET    /api/artists/:id` — 作者页数据
- [ ] `GET    /api/albums/:id` — 专辑页数据

### 用户行为 API
- [ ] `POST   /api/favorites` — 收藏作品
- [ ] `DELETE /api/favorites/:id` — 取消收藏
- [ ] `GET    /api/playlists` — 歌单列表
- [ ] `POST   /api/playlists` — 创建歌单
- [ ] `PATCH  /api/playlists/:id` — 编辑歌单
- [ ] `DELETE /api/playlists/:id` — 删除歌单

### AI 生成 API
- [ ] `POST /api/ai/generate/music` — 文本生成音乐（Prompt → Music）
- [ ] `POST /api/ai/generate/music-from-audio` — 参考音频生成音乐
- [ ] `GET  /api/ai/generate/status/:jobId` — 查询生成进度
- [ ] `GET  /api/ai/generate/history` — 生成记录列表

### Remix API
- [ ] `POST  /api/remix` — 新建 Remix 草稿
- [ ] `PATCH /api/remix/:id` — 保存编辑
- [ ] `POST  /api/remix/:id/publish` — 发布 Remix（触发资产创建）
- [ ] `GET   /api/remix/:id/relations` — 查询 Remix 关系链

### 数字人 & MV API
- [ ] `POST /api/digital-human` — 创建数字人实例
- [ ] `GET  /api/digital-human` — 实例列表
- [ ] `POST /api/mv/generate` — 发起 MV 生成任务
- [ ] `GET  /api/mv/status/:jobId` — 查询 MV 生成状态
- [ ] `GET  /api/mv/:id` — MV 资产详情

### 直播 API
- [ ] `POST /api/live/rooms` — 创建直播间
- [ ] `GET  /api/live/rooms/:id` — 直播间详情
- [ ] `POST /api/live/rooms/:id/start` — 开始直播
- [ ] `POST /api/live/rooms/:id/end` — 结束直播（触发回放生成）
- [ ] `GET  /api/live/token` — 获取 Agora RTC Token
- [ ] `GET  /api/live/rooms/:id/replay` — 获取回放资产

---

## 三、服务层架构

### 核心服务（Service Layer）
- [ ] **MusicAssetService** — 资产 CRUD、哈希计算、类型标记
- [ ] **VideoAssetService** — MV & 回放视频资产管理
- [ ] **AIGenerationService** — AI 音乐生成任务投递与结果处理
- [ ] **RemixService** — Remix 编辑、发布、父子关系记录
- [ ] **DigitalHumanService** — 数字人实例 CRUD、配置管理
- [ ] **MVGenerationService** — MV 生成任务投递与结果处理
- [ ] **LiveService** — 直播会话管理、Agora Token 签发
- [ ] **StorageService** — 文件上传、CDN URL 生成、哈希校验

### 异步任务 & 队列
- [ ] AI 音乐生成任务队列（支持重试、状态回调）
- [ ] MV 视频生成任务队列
- [ ] 直播回放生成任务队列
- [ ] 任务状态推送方案（轮询 or WebSocket）

---

## 四、第三方服务集成

### 声网 Agora（直播）
- [ ] Agora RTC SDK 集成（主播端推流）
- [ ] Agora RTC SDK 集成（观众端拉流）
- [ ] Agora Token Server 实现（App ID + App Certificate）
- [ ] Agora 云端录制接入（生成回放文件）

### AI 音乐生成服务
- [ ] AI 生成服务选型确认（Suno / Udio / 自建模型）
- [ ] Prompt → Music 接口对接与参数映射
- [ ] Reference Audio → Music 接口对接
- [ ] 生成结果 Webhook / 轮询回调机制

### 数字人 & MV 生成服务
- [ ] 数字人生成服务选型（HeyGen / D-ID / 自建）
- [ ] 音频驱动口型接口对接
- [ ] 节奏驱动动作接口对接
- [ ] MV 视频合成服务对接与结果回调

### 文件存储
- [ ] 音频文件存储方案选型（阿里云 OSS / AWS S3）
- [ ] 视频文件存储方案（大文件分片上传）
- [ ] CDN 加速配置与防盗链

---

## 五、前端页面 & 组件

### 页面清单
- [ ] 首页 / 发现页
- [ ] 音乐列表 & 搜索结果页
- [ ] 作品详情页
- [ ] 作者页
- [ ] 专辑页
- [ ] 歌单页
- [ ] AI 音乐生成页
- [ ] Remix 编辑器页
- [ ] 数字人 & MV 生成工作流页
- [ ] 直播间（主播端）
- [ ] 直播间（观众端）
- [ ] 个人中心页

### 核心组件
- [ ] 全局播放器（底部悬浮条，播放控制）
- [ ] 作品衍生关系链可视化组件
- [ ] AI 生成进度条组件（实时状态反馈）
- [ ] 直播状态指示器组件

---

## 六、安全 & 边界约束

- [ ] 文件哈希防篡改服务端校验
- [ ] API 鉴权方案（JWT + Refresh Token）

---

## 七、验收测试 Checklist

- [ ] E2E：音乐播放、搜索、浏览正常
- [ ] E2E：AI 生成音乐 → 自动创建资产 → 正确入库
- [ ] E2E：Remix 创作 → 父子作品关系正确建立
- [ ] E2E：基于音乐生成 MV → 视频资产正确入库
- [ ] E2E：创建直播 → 实时观看 → 结束生成回放资产
