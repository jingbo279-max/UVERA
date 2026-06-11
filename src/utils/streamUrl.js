/**
 * Cloudflare Stream URL helpers.
 *
 * Background: when we publish a user-uploaded video (from the Upload Video
 * mode or via Series episodes), the Worker writes a Cloudflare Stream
 * URL into recommended_content.video. The exact form has drifted over
 * time:
 *
 *   - https://iframe.cloudflarestream.com/<uid>             (iframe embed)
 *   - https://iframe.cloudflarestream.com/<uid>?<params>    (iframe + params)
 *   - https://videodelivery.net/<uid>                       (naked, legacy)
 *   - https://videodelivery.net/<uid>/manifest/video.m3u8   (HLS)
 *   - https://videodelivery.net/<uid>/thumbnails/...        (thumbnail)
 *   - https://customer-<sub>.cloudflarestream.com/<uid>/... (private subdomain, future)
 *
 * Plain `<video src=URL>` cannot play any of these — iframe.cloudflarestream.com
 * is HTML, videodelivery.net needs HLS. The Cloudflare-Stream-React `<Stream>`
 * component takes the UID alone and handles both natively.
 *
 * These helpers normalise detection + UID extraction so all rendering
 * surfaces (Hero, MasonryGrid, SparkMode, SeriesDetailPage) treat
 * Stream URLs identically.
 */

const STREAM_HOST_RE = /(?:videodelivery\.net|cloudflarestream\.com)/i;

// CF Stream UIDs are 32-char lowercase hex. Anchored after a CF host so
// we don't match arbitrary 32-hex strings appearing elsewhere in URLs.
const STREAM_UID_RE = /(?:videodelivery\.net|cloudflarestream\.com)\/([a-f0-9]{32})/i;

/**
 * Returns true if the URL looks like any flavour of Cloudflare Stream URL.
 * Returns false for null / undefined / empty / non-Stream URLs.
 */
export function isStreamUrl(url) {
  if (!url || typeof url !== 'string') return false;
  return STREAM_HOST_RE.test(url);
}

/**
 * Extract the 32-char UID from a Cloudflare Stream URL. Returns null if
 * the URL isn't a Stream URL or if no UID can be parsed.
 *
 * Examples:
 *   extractStreamUid('https://iframe.cloudflarestream.com/abc123…')   → 'abc123…'
 *   extractStreamUid('https://videodelivery.net/abc/manifest/m.m3u8') → 'abc'
 *   extractStreamUid('https://example.com/video.mp4')                 → null
 *   extractStreamUid(null)                                            → null
 */
export function extractStreamUid(url) {
  if (!url || typeof url !== 'string') return null;
  const m = url.match(STREAM_UID_RE);
  return m ? m[1] : null;
}

/**
 * §2026-05-22 fei: convert a Cloudflare Stream UID to its HLS manifest URL.
 *
 * iOS Safari + macOS Safari can natively decode HLS — passing this URL to a
 * regular <video src=...> works without iframe overhead. This avoids the
 * <Stream> iframe player which has expensive mount/unmount cost on iOS
 * (the source of the "swipe-back stuck on black" bug).
 *
 * The videodelivery.net hostname is the universal Stream HLS endpoint —
 * works for all CF Stream accounts without needing the customer subdomain.
 */
export function streamUidToHlsUrl(uid) {
  if (!uid || typeof uid !== 'string') return null;
  return `https://videodelivery.net/${uid}/manifest/video.m3u8`;
}

/**
 * §2026-05-22 fei: detect if the current browser supports HLS playback
 * natively in a <video> element. iOS Safari + macOS Safari return true;
 * Chrome / Firefox / Edge / Android Chrome return false (they need hls.js
 * for HLS, which we haven't added yet).
 *
 * Result is cached per session — canPlayType() is cheap but no need to
 * call it repeatedly.
 */
let _hlsNativeCache = null;
export function canPlayHlsNatively() {
  if (_hlsNativeCache !== null) return _hlsNativeCache;
  if (typeof document === 'undefined' || typeof navigator === 'undefined') { _hlsNativeCache = false; return false; }
  try {
    // §2026-06-09 fei — 只有真正的 Apple 平台(iOS 全浏览器 + 桌面 Safari)走原生 HLS:
    //   它们对 HLS 一级支持,且 hls.js/MSE 在 iOS Safari 会黑屏(Leon round-91 实测)。
    //   而**安卓 Chrome 的 canPlayType 也返回 'maybe'**,但其"原生 HLS"很烂——开播
    //   240p、JS 完全控不了 ABR(这就是 Discover 视频开播总 240p 的根因)。所以**不能
    //   只看 canPlayType**,必须先用 UA 排除非 Apple 浏览器,让安卓/桌面 Chrome 走 hls.js。
    const ua = navigator.userAgent || '';
    const isApple = /iP(hone|od|ad)/.test(ua)
      || /^((?!chrome|android|crios|fxios|edg|samsungbrowser).)*safari/i.test(ua);
    if (!isApple) { _hlsNativeCache = false; return false; }
    const v = document.createElement('video');
    const support = v.canPlayType('application/vnd.apple.mpegurl');
    _hlsNativeCache = support === 'probably' || support === 'maybe';
  } catch {
    _hlsNativeCache = false;
  }
  return _hlsNativeCache;
}
