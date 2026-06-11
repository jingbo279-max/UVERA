/**
 * contentType.js — 从 item.tags 推导播放 contentType。
 * 权威定义:docs/decisions/2026-05-29-playback-transport-model.md 矩阵。
 *
 * media_kind ∈ { Video, Image, Live } —— MV 不是 media_kind。
 * 内容细分全在 tags(#MV / #Short Drama / #Series: 等)。
 *
 *   series      — #Short Drama / #Series:  → 不循环,autoplay 下一集
 *   mv-album    — #MV 且在 playlist 上下文 → 循环专辑(需 inPlaylist)
 *   mv-single   — #MV 未在 playlist        → loop self
 *   short-feed  — 其余                      → loop self(默认)
 */
export function deriveContentType(item) {
  const tags = (item && item.tags) || [];
  if (tags.includes('#Short Drama') || tags.some((t) => typeof t === 'string' && t.startsWith('#Series:'))) {
    return 'series';
  }
  if (tags.includes('#MV')) return item && item.inPlaylist ? 'mv-album' : 'mv-single';
  return 'short-feed';
}

/** 短视频/MV 默认 loop self(series 不循环)。 */
export function isLoopSelf(item) {
  const ct = deriveContentType(item);
  return ct === 'short-feed' || ct === 'mv-single';
}
