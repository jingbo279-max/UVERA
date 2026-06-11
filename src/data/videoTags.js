/* ─── Video Type tags — single source of truth ───────────────────────────────
 * 2026-04-22 费收敛到 4 个：Trailer / Vlog / MV / Short Drama
 *
 * Admin (ConfigView) 用 VIDEO_TAGS 做 tag multi-select；
 * Explore (index.jsx) 用 VIDEO_TAG_CHIPS 做 filter chip 行（前置 #All sentinel）。
 *
 * 任一端改了这里，另一端自动同步，避免两处硬编码走偏。
 *
 * 向前兼容：DB 老记录可能仍含 #TVC / #Promo / #ShortDrama（无空格），
 * utils/normalizeRecommended.js#VIDEO_META_BY_TAG 仍保留其 slug 映射，
 * 渲染不会断 —— 本文件只管"新建时可选"的那 4 个。
 * ────────────────────────────────────────────────────────────────────────── */
/* §2026-05-29 Leon round-105 — Recast 产品功能完全取消。Tag picker 不含 #Recast,
 * DB 老 #Recast 数据由 backend (fei Phase B) 清理。 */
export const VIDEO_TAGS = ['#Trailer', '#Vlog', '#MV', '#Short Drama'];

/* Explore filter chip 行前置 #All sentinel（表示"不过滤"） */
export const VIDEO_TAG_CHIPS = ['#All', ...VIDEO_TAGS];
