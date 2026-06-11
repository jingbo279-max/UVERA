/**
 * Cover placeholder — used wherever a `cover` value is missing.
 *
 * 2026-05-03 Leon — 替换原 https://neoai-prod.oss-cn-shanghai.aliyuncs.com/
 * mock.jpg 远程图。原 URL 是品牌泄露唯一对外可见点（DevTools Network /
 * 右键查看图片可见 neoai 域名）。
 *
 * 实现：URL-encoded inline SVG data URI — 0 网络请求、0 外部依赖、
 * 0 品牌泄露。viewBox 1:1，icon 居中占 ~30%，任意 aspect-ratio 容器
 * object-cover 裁剪后仍能保留中心图标。
 *
 * 视觉：
 *   - bg #131726（与 SparkMode modal halo 同基色）
 *   - 标准 "image" placeholder icon（outline rect + sun + mountain），
 *     白色 18-22% 透明度，中性不喧宾夺主
 */
export const COVER_PLACEHOLDER = "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 400 400'><rect width='400' height='400' fill='%23131726'/><g fill='none' stroke='%23ffffff' stroke-opacity='0.22' stroke-width='8' stroke-linecap='round' stroke-linejoin='round'><rect x='130' y='140' width='140' height='120' rx='12'/></g><circle cx='170' cy='180' r='14' fill='%23ffffff' fill-opacity='0.20'/><path d='M140 245 L 178 210 L 205 230 L 245 195 L 260 215 L 260 250 L 140 250 Z' fill='%23ffffff' fill-opacity='0.14'/></svg>";
