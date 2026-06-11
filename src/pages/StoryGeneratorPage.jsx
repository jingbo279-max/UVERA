import { useState, useEffect, useRef, useCallback, useLayoutEffect } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate, useSearchParams, useLocation } from 'react-router-dom';
import { supabase, getUserProfile, handleShareCredits } from '../api/supabaseClient';
import { openSubscriptionModal } from '../utils/subscriptionModal';
import { generateConceptDesign, generateImageAsset, generateCharacterBoard, generateVolcengineVideo, pollVolcengineVideoStatus, uploadUrlToCloudflareStream, uploadToSecureOSS, describeAsset, generateRandomIdeas, optimizePrompt, expandCharacterSeed, generateMultiSegmentScript, certifyAsset, extractPhotoDemographics, reconcileStuckVideos } from '../api/neoaiService';
import UnifiedVideoPlayer from '../components/UnifiedVideoPlayer';
// §2026-05-25 fei — inline error banner, replaces alert() for Seedance /
//   upload / merge errors. See src/components/InlineErrorBanner.jsx.
import InlineErrorBanner from '../components/InlineErrorBanner';
import { listDrafts, upsertDraft, deleteDraft } from '../api/draftService';
// §2026-05-22 fei: Actor creation moved to LibraryPage. StoryGenerator now
//   only SELECTS existing Avatars — if user has none, button redirects to
//   /library. InlineCharacterCreator no longer rendered here.
import SegmentedControl from '../design-system/composites/SegmentedControl';
import { GlassPane } from '../design-system/composites/GlassPane';
import { Checkbox } from '../design-system/primitives/Checkbox';
import { TextField } from '../design-system/primitives/TextField';
import { Tooltip } from '../design-system/primitives/Tooltip';
import {
  getTierLimits,
  canCreateActor,
  canAccessSeries,
  canAccessFlow,
  getNextTier,
  tierUnlocking,
  getResolutionOptions,
  hasWatermark,
  TIER_DISPLAY,
  STORYBOARD_TOKEN_COST,
} from '../data/plans';
import { Lock } from '@phosphor-icons/react';
import { Sparkle, ArrowRight, ArrowLeft, CaretLeft, Image as ImageIcon, FilmStrip, FlowArrow, CircleNotch, CheckCircle, Check, VideoCamera, CloudArrowUp, X, ArrowsClockwise, TreeStructure, ArrowSquareOut, Plus, Cube, MonitorPlay, Clock, Coin, FilmSlate, MagicWand, DownloadSimple, Play, ListPlus, UserCirclePlus, UserCircle, PaintBrush, House, Confetti, CaretUp, CaretDown, Archive, Info, ShieldCheck, ShieldWarning, ArrowsOutSimple } from '@phosphor-icons/react';
import { Stream } from '@cloudflare/stream-react';
import { FFmpeg } from '@ffmpeg/ffmpeg';
import { fetchFile } from '@ffmpeg/util';
import * as tus from 'tus-js-client';

import { STYLES, VIDEO_TYPE_STYLES } from '../data/styles';
import { t } from '../utils/i18n';
import { extractStreamUid } from '../utils/streamUrl';

/* §2026-06-05 #1 — 给 CF Stream 视频设默认 poster 帧 = 时长 10%(跳过纯黑首帧)。
 *   create/short 各流程直接写 recommended_content,cover 来自 Stream thumbnail.jpg
 *   (默认 time=0 常黑)。拿到 uid 后调 worker 端点设 thumbnailTimestampPct=0.1,
 *   之后 thumbnail.jpg(URL 不变)自动返回非黑帧。fire-and-forget,不阻断发布。
 *   accept uid 或任意含 32-hex uid 的 Stream URL。 */
function ensureStreamPoster(uidOrUrl, accessToken, pct) {
  try {
    const m = String(uidOrUrl || '').match(/([a-f0-9]{32})/i);
    if (!m || !accessToken) return;
    const body = { uid: m[1] };
    if (typeof pct === 'number' && pct > 0 && pct < 1) body.pct = pct;
    fetch('/api/stream/set-poster-frame', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
      body: JSON.stringify(body),
    }).catch(() => {});
  } catch { /* never block publish */ }
}

/* §2026-05-22 fei: added 'art-film' (文艺片) + 'product' (产品宣传) to
   support more genre variety. Each videoType drives camera + motion
   presets in buildStoryboardPrompt (worker) and the Seedance motion
   prompt (handleGenerateVideo). New options first, original 4 after. */
const VIDEO_TYPES = [
  { id: 'trailer', name: 'Trailer' },
  { id: 'vlog', name: 'Vlog' },
  { id: 'mv', name: 'Music Video' },
  { id: 'short-drama', name: 'Short Drama' },
  { id: 'art-film', name: 'Art Film' },
  { id: 'product', name: 'Product' },
];

/* §2026-05-27 Leon round-79 — Video aspect ratio options (i18n-ready data shape).
 * `en` / `zh` 两套 label 共存,当前 UI 用 `en` (English-first codebase);未来加
 * i18n hook 时切到 `zh` 不需要重写 option list,只 swap label 字段。 */
const RATIO_OPTIONS = [
  { value: '16:9', en: 'Landscape',   zh: '横屏' },
  { value: '9:16', en: 'Portrait',    zh: '竖屏' },
  { value: '1:1',  en: 'Square',      zh: '方形' },
  { value: '21:9', en: 'Ultrawide',   zh: '超宽' },
  { value: '9:21', en: 'Tall',        zh: '超长竖' },
  { value: '4:3',  en: 'Classic',     zh: '老电视' },
  { value: '3:4',  en: 'Vertical',    zh: '竖向' },
];

/* §2026-05-25 fei (Leon ask): single source of truth for the genre tag
 * we write into recommended_content.tags. Quick Mode + Free Mode + future
 * upload paths all share this so Discover / Library filtering stays
 * coherent. Lifted out of the inline Quick Mode block where it was
 * declared previously, because Free Mode was silently writing only
 * `#FreeSegment` — every Free Mode work showed up as untagged on Discover. */
const VIDEO_TYPE_TAG = {
  vlog: '#Vlog',
  mv: '#MV',
  'short-drama': '#Short Drama',
  trailer: '#Trailer',
  'art-film': '#Art Film',
  product: '#Product',
};

// Copyright affirmation shown in the Upload Video flow. The version string
// is persisted with each user_video_uploads row (copyright_text_version) so
// that future revisions of this text don't undermine evidentiary value of
// older records — we can prove exactly which disclaimer the user clicked.
// IMPORTANT: do NOT mutate this string in-place. If you need to change the
// language, bump the version too (e.g. 'v3-2026-MM-DD').
//
// Version history:
//   v1-2026-05-07 — Initial verbose legalese (~90 words, civil + criminal
//                   liability, jurisdiction, IP-disclosure, subpoenas).
//   v2-2026-05-18 — Leon UX pass: shortened to ~55 words keeping core
//                   covenants: (a) copyright ownership / authorization,
//                   (b) infringing uploads removed + legal action,
//                   (c) metadata preserved for lawful takedown notices.
//                   Civil/criminal/jurisdiction clauses dropped — Terms
//                   of Service already covers those (linked in footer).
const COPYRIGHT_TEXT_VERSION = 'v2-2026-05-18';
const COPYRIGHT_TEXT =
  "I own this video's copyright (or have full authorization) and may distribute it on uvera.ai. Infringing uploads will be removed and may result in legal action. uvera.ai may preserve upload metadata to respond to lawful takedown notices.";

// Hard cap on user-uploaded videos. Server enforces the same limit
// (see /api/user-videos/init-upload). 500 MB is a deliberate sweet spot:
// large enough for a ~10-minute 1080p clip, small enough to stay
// reviewable within the 48h SLA without burning admin bandwidth on
// 30-minute uploads. Cloudflare Stream tus protocol supports up to 30 GB,
// so this is purely a product / SLA decision, not a technical limit.
const UPLOAD_MAX_BYTES = 500 * 1024 * 1024; // 500 MB

const getCaretCoordinates = (element, position) => {
  const div = document.createElement('div');
  const style = div.style;
  const computed = window.getComputedStyle(element);

  style.whiteSpace = 'pre-wrap';
  style.wordWrap = 'break-word';
  style.position = 'absolute';
  style.visibility = 'hidden';

  const properties = [
    'direction', 'boxSizing', 'width', 'height', 'overflowX', 'overflowY',
    'borderTopWidth', 'borderRightWidth', 'borderBottomWidth', 'borderLeftWidth',
    'borderStyle', 'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft',
    'fontStyle', 'fontVariant', 'fontWeight', 'fontStretch', 'fontSize', 'fontSizeAdjust',
    'lineHeight', 'fontFamily', 'textAlign', 'textTransform', 'textIndent',
    'textDecoration', 'letterSpacing', 'wordSpacing', 'tabSize', 'MozTabSize'
  ];

  properties.forEach(prop => { style[prop] = computed[prop]; });

  div.textContent = element.value.substring(0, position);
  const span = document.createElement('span');
  span.textContent = element.value.substring(position) || '.';
  div.appendChild(span);
  document.body.appendChild(div);

  const coordinates = {
    top: span.offsetTop + parseInt(computed['borderTopWidth']),
    left: span.offsetLeft + parseInt(computed['borderLeftWidth']),
    height: parseInt(computed['lineHeight']) || 20
  };
  document.body.removeChild(div);
  return coordinates;
};

/* ── MOCK SCRIPT RESPONSE ── */
const MOCK_SCRIPT = {
  summary: "A solitary hacker in a neon-drenched metropolis uncovers a digital conspiracy that threatens the world.",
  shots: [
    { number: 1, duration: 3, action: "Wide shot of neon city skyline. Rain pouring.", camera: "Slow Pan Right" },
    { number: 2, duration: 4, action: "Close up of protagonist's eyes reflecting computer code.", camera: "Static, Shallow DOF" },
    { number: 3, duration: 5, action: "Protagonist walking through crowded cyberpunk alleyway.", camera: "Tracking Shot" }
  ]
};

/* ── STATIC CREATIVE PROMPTS (50 items) ── */
const STATIC_PROMPTS = [
  { emoji: '☕', text: 'A barista pulls a perfect espresso in afternoon sunlight, then looks up and smiles' },
  { emoji: '🌊', text: 'On a seaside cliff, a girl spreads her arms to the wind, dress fluttering' },
  { emoji: '🍜', text: 'Late-night street food cart — the cook tosses noodles in a sizzling wok' },
  { emoji: '🌸', text: 'Under cherry blossoms, a boy gently places a fallen petal in a girl\'s hair' },
  { emoji: '🏙️', text: 'Neon-soaked city street — a lone detective lights a cigarette in the rain' },
  { emoji: '🎻', text: 'In an empty concert hall, a violinist plays with closed eyes as tears fall' },
  { emoji: '🚀', text: 'An astronaut steps onto an unknown planet, removes their helmet, breathes deep' },
  { emoji: '🦊', text: 'Deep forest cabin — a witch brews potion as snow drifts past the window' },
  { emoji: '⚔️', text: 'Ancient battlefield at dusk — a general unsheaths a battle-worn sword' },
  { emoji: '🎭', text: 'Backstage at a theatre, a dancer adjusts her red dress one last time in the mirror' },
  { emoji: '🌧️', text: 'A rainy bus stop at night — two strangers share a single broken umbrella' },
  { emoji: '🐉', text: 'Between mountain peaks, a massive dragon roars and takes flight' },
  { emoji: '🎸', text: 'Underground basement venue — a punk band tears through a furious set' },
  { emoji: '📸', text: 'A war photographer crouches behind sandbags and captures the explosion' },
  { emoji: '🐱', text: 'Sun-drenched balcony — an orange tabby stretches and topples a flowerpot' },
  { emoji: '❄️', text: 'Beneath the aurora, a husky team pulls a sled across the snow at full speed' },
  { emoji: '🚂', text: 'A steam train hisses smoke as it pulls into a magic academy platform' },
  { emoji: '🔬', text: 'In a sterile lab, a scientist smiles at glowing cells under the microscope' },
  { emoji: '🏴‍☠️', text: 'Storm-tossed seas — a pirate captain swings a cutlass and shouts orders' },
  { emoji: '🏮', text: 'A small girl carries a paper rabbit lantern through a Lunar New Year festival crowd' },
  { emoji: '🤖', text: 'Cyberpunk back-alley — a robot sheds a single luminous blue tear' },
  { emoji: '🎪', text: 'Inside a circus tent, a clown removes his mask to reveal an exhausted face' },
  { emoji: '🏹', text: 'Deep elven forest — an archer draws back her bow, aiming at unseen shadows' },
  { emoji: '🛹', text: 'Skatepark at golden hour — a kid lands a perfect kickflip' },
  { emoji: '🍷', text: 'Luxury cruise dinner — a socialite swirls red wine, her gaze drifting' },
  { emoji: '🌋', text: 'On a volcano rim, an explorer wipes sweat as molten lava churns below' },
  { emoji: '🎹', text: 'Amid post-war ruins, a soldier plays a lullaby on a battered piano' },
  { emoji: '🧜‍♀️', text: 'A mermaid weaves through coral reefs and schools of bright fish' },
  { emoji: '🚁', text: 'A helicopter hovers above a skyscraper as an agent rappels down' },
  { emoji: '🌻', text: 'A girl in a straw hat runs through an endless field of sunflowers' },
  { emoji: '🥋', text: 'A martial-arts dojo — students drenched in sweat practice spinning kicks' },
  { emoji: '🧛‍♂️', text: 'Moonlit castle balcony — a vampire lord gazes over the sleeping village' },
  { emoji: '🛸', text: 'A farmer stands stunned in a crop circle as a beam of light descends' },
  { emoji: '🧗‍♀️', text: 'On a sheer snowy cliff, a climber strains to clip a safety carabiner' },
  { emoji: '🎨', text: 'A street artist in Montmartre sketches a couple in love' },
  { emoji: '🦈', text: 'Deep blue ocean — a diver passes within arm\'s reach of a great white shark' },
  { emoji: '🏥', text: 'A weary surgeon finishes a ten-hour operation in a quiet ER' },
  { emoji: '🧚‍♂️', text: 'A tiny fairy beats translucent wings, gathering dew from a leaf at dawn' },
  { emoji: '🏎️', text: 'An F1 car screams across the finish line, the driver cheering in the cockpit' },
  { emoji: '⛺', text: 'Travelers under a starry sky play guitar around the campfire and sing of home' },
  { emoji: '🤠', text: 'Outside a Western saloon, a cowboy tips his hat and draws his revolver' },
  { emoji: '🧶', text: 'A grandmother knits by a warm hearth, golden retriever asleep at her feet' },
  { emoji: '🏜️', text: 'In a wasteland, a scavenger digs an old phone out of the yellow sand' },
  { emoji: '🕵️‍♀️', text: 'In an antique-shop basement, a detective examines a cipher box with a magnifier' },
  { emoji: '🏄‍♂️', text: 'A surfer threads the inside of a Hawaiian barrel wave' },
  { emoji: '🥷', text: 'Deep bamboo grove — a ninja leaps spectrally through the canopy' },
  { emoji: '🏺', text: 'Inside a pharaoh\'s tomb, an archaeologist\'s torch reveals mysterious murals' },
  { emoji: '🏇', text: 'On the racetrack, a jockey leans low and sprints toward the finish' },
  { emoji: '🎢', text: 'A rollercoaster crests the highest peak — every rider holds their breath' },
  { emoji: '🧘‍♀️', text: 'In a misty temple courtyard at dawn, a monk strikes a deep ancient bell' }
];

/**
 * Detect the dominant language of a transcript by character ranges.
 * Returns a label suitable for embedding in an LLM instruction so the
 * screenwriter outputs dialogue + narration in the user's language and
 * cultural register, not whatever the model defaults to.
 *
 * Heuristic only — covers the common non-Latin scripts. Latin-script
 * inputs (English, Spanish, French, German, Portuguese, Italian, etc.)
 * fall through to "English" by default; users who specifically want a
 * Romance language can mention it inline ("…escribe los diálogos en
 * español") and the LLM will follow.
 */
const detectInputLanguage = (text) => {
  if (!text) return 'English';
  if (/[぀-ゟ゠-ヿ]/.test(text)) return 'Japanese';
  if (/[가-힯]/.test(text)) return 'Korean';
  if (/[一-鿿]/.test(text)) return 'Chinese (Simplified or Traditional, matching the user input)';
  if (/[؀-ۿ]/.test(text)) return 'Arabic';
  if (/[֐-׿]/.test(text)) return 'Hebrew';
  if (/[Ѐ-ӿ]/.test(text)) return 'Russian (or the appropriate Cyrillic-script language)';
  if (/[฀-๿]/.test(text)) return 'Thai';
  if (/[ऀ-ॿ]/.test(text)) return 'Hindi';
  return 'English';
};

/**
 * Free Mode @-mention asset tag — format and parse helpers.
 *
 * Inserted as a single atomic unit: `[@Image1: 樱花]`. Brackets are the
 * unambiguous boundaries (much more reliable than parsing `@Image1`
 * with arbitrary description text) and they let onKeyDown / onBeforeInput
 * detect when the cursor sits inside a tag and refuse to break it.
 */
const ASSET_TAG_PATTERN = /\[@(?:Image|Video|Audio)\d+(?::[^\]]*)?\]/g;

const buildAssetReference = (asset, allAssets) => {
  const type = asset.isVideo ? 'Video' : 'Image';
  // Index within same-type assets (1-based) so users can disambiguate
  // multiple uploads of the same kind.
  const sameType = allAssets.filter(a => a.isVideo === asset.isVideo);
  const idx = sameType.findIndex(a => a.id === asset.id) + 1;
  // Truncate description to keep tags compact. asset.name comes from
  // describeAsset() and may be Chinese, English, or the placeholder
  // "Recognizing…" — strip the latter so the tag stays clean.
  const rawName = (asset.name || '')
    .replace(/Recognizing…?/i, '')
    .replace(/[\n\r]/g, '')
    .trim();
  const desc = rawName.length > 10 ? rawName.slice(0, 10) + '…' : rawName;
  return desc ? `[@${type}${idx}: ${desc}]` : `[@${type}${idx}]`;
};

/**
 * Categorize errors into user-friendly English messages.
 * Used at every alert() site to give actionable hints instead of raw exceptions.
 */
const formatError = (err, fallback = 'Something went wrong') => {
  const msg = err?.message || String(err);
  if (msg.includes('SensitiveContent') || msg.includes('PrivacyInformation')) {
    // §2026-05-22 fei: surface BytePlus Asset Library upload diagnostic if
    //   present in the error. The worker appends "[Asset Library fallback
    //   also failed: ...]" to the throw when the real-person bypass path
    //   couldn't upload (usually IAM 403 from byteplus_asset_project not
    //   matching the new account's project). Without surfacing this, the
    //   user sees only the friendly safety-filter message and has no
    //   actionable diagnostic — they can't fix what they can't see.
    const assetErrMatch = msg.match(/\[Asset Library fallback also failed: ([^\]]+)\]/);
    if (assetErrMatch) {
      return 'Your reference media triggered our safety filter. We tried uploading to the BytePlus trusted asset library as a fallback, but that ALSO failed:\n\n' +
        assetErrMatch[1].slice(0, 400) +
        '\n\n👉 Likely fix: check admin → System Settings → "BytePlus Asset Library project name" matches the IAM project your AK/SK is authorized on.';
    }
    return 'Your reference media triggered our safety filter. Please try again with material that does not contain real-person likenesses.';
  }
  // Worker / DB still call them 'credits' internally (column name in
  // user_metadata) — match both spellings in the matcher so future
  // renames don't break this branch silently.
  if (msg.toLowerCase().includes('insufficient') || /credits?|tokens? required/i.test(msg)) {
    return 'Not enough tokens for this action. Upgrade your plan or share to earn more.';
  }
  if (msg.includes('429') || msg.toLowerCase().includes('rate limit')) {
    return 'Too many requests right now. Please wait a moment and try again.';
  }
  if (msg.toLowerCase().includes('network') || msg.includes('Failed to fetch') || msg.includes('NetworkError')) {
    return 'Network error. Check your connection and try again.';
  }
  // §2026-05-25 fei: BytePlus output-audio safety filter rejection.
  //   The video CAN be re-rendered without audio (we already auto-retry
  //   in renderSegmentVideo + handleFreeSegmentGenerate). This branch
  //   covers callers that don't auto-retry — surface clear instruction.
  if (/output audio.*sensitive|audio.*sensitive information/i.test(msg)) {
    return '音频被 BytePlus 安全过滤器拒绝：生成的音频内容被审核认为含敏感信息（通常是台词/旁白触发）。请重试 —— 这次会自动用无声模式生成，画面不受影响。';
  }
  // §2026-05-25 fei: OpenAI 地区限制 — worker 已经抛出干净的中文消息
  //   并加了 [unsupported_country_region_territory] 末尾 marker。检测
  //   到就原样返回（不要再叠 "Failed (...)" 前缀），用户看到清晰提示。
  if (msg.includes('unsupported_country_region_territory') || msg.includes('Country, region, or territory not supported')) {
    // worker 抛的中文版本（v54+）含 "OpenAI 在当前地区不可用" 前缀，直接返回
    if (msg.includes('OpenAI 在当前地区不可用')) {
      // 剥掉末尾 marker 让用户看到干净文案
      return msg.replace(/\s*\[unsupported_country_region_territory\]\s*$/, '').trim();
    }
    // 兜底：worker 旧版（v53 及之前）会返回原始 OpenAI JSON，包装成中文
    return 'OpenAI 在当前地区不可用：本次请求被路由到了 OpenAI 不支持的出口节点。请等 1-2 分钟后重试 —— Cloudflare 会换出口路由，下一次通常就能成功。';
  }
  return `${fallback} (${msg})`;
};

/* §2026-05-23 fei (round-2): normalize the LLM screenwriter output for
 *   multi-segment rendering. This function ALWAYS returns exactly
 *   `segmentCount` segments (honors the user's choice over whatever the
 *   LLM picked) and each segment is guaranteed to have at least 1 shot
 *   IF we have any shot data at all.
 *
 *   Why this is hard: the LLM-driven script source (worker
 *   /api/generate-multi-segment-script, Gemini) has its own system prompt
 *   that constrains the output shape. The most common failure modes we've
 *   seen:
 *     (i)   Returns `{ summary, mood, shots: [...real] }` only — no segments[].
 *     (ii)  Returns `{ summary, segments: [{}, {}, {}] }` with empty segment
 *           objects (LLM said yes to our segments schema but didn't fill them).
 *     (iii) Returns `{ summary, shots: [...], segments: [{shots:[]}, ...] }`
 *           where segments exist but their shots are empty — the data IS in
 *           raw.shots, the segments are just envelopes.
 *     (iv)  Returns N segments != segmentCount (LLM picked its own count).
 *
 *   Strategy: build a single shotPool from EVERY available source (raw.shots
 *   + raw.segments[].shots flattened), then deterministically split that
 *   pool into exactly `segmentCount` segments. If a segment from raw came
 *   with non-empty data (summary / duration), prefer it over our defaults
 *   for that slot. If raw has zero shots anywhere, segments come back empty
 *   but at least the count + structure is right — UI shows "0 shots" so
 *   user can see the LLM failed and re-generate.
 */
const clampSegmentDuration = (d) => {
  const n = Number(d);
  if (!Number.isFinite(n) || n <= 0) return 12;
  return Math.max(10, Math.min(15, Math.round(n)));
};

// §2026-05-30 fei: protagonist defaults — used as fallback when the script
//   source (any malformed / partial LLM response) didn't return
//   a `protagonist` field. Keeps the contract uniform so downstream image
//   gens (character board + storyboard) always see all 8 keys.
const DEFAULT_PROTAGONIST = {
  name: 'Protagonist',
  age: 'young-adult',
  gender: 'unspecified',
  role: '',
  personality: '',
  outfit: '',
  distinguishing_features: '',
  emotional_arc: '',
};

const normalizeMultiSegmentScript = (raw, segmentCount) => {
  if (!raw) return raw;
  const summary = raw.summary || '';
  const mood    = raw.mood    || '';
  const N       = Math.max(1, Math.min(5, Number(segmentCount) || 1));

  // §2026-05-30 fei: ensure protagonist is always present. Merge any
  //   partial object the LLM returned over defaults so missing keys
  //   silently get sensible values without erasing user-meaningful ones.
  const rawProt = (raw.protagonist && typeof raw.protagonist === 'object') ? raw.protagonist : {};
  const protagonist = { ...DEFAULT_PROTAGONIST, ...rawProt };

  // §2026-05-31 fei round-4 — supporting_characters[] array passthrough.
  //   When the Actor's demographics don't match the transcript's lead
  //   character (e.g. user is a man + story is "old lady bakes pie"),
  //   the screenwriter populates this with the story character so it
  //   appears VISIBLY in the storyboard AND video alongside the Actor.
  const rawSupporting = Array.isArray(raw.supporting_characters) ? raw.supporting_characters : [];
  const supporting_characters = rawSupporting.filter(c => c && (c.name || c.appearance || c.role));

  // ── Build a single shotPool from every available source. ────────────
  //   Prefer raw.segments[].shots when present + non-empty; else fall
  //   back to raw.shots. Some LLMs return BOTH so we de-duplicate by
  //   index — segments[].shots wins because that's the more-structured
  //   answer when it's populated.
  let shotPool = [];
  const rawSegments = Array.isArray(raw.segments) ? raw.segments : [];
  const flatFromSegments = rawSegments.flatMap(s =>
    Array.isArray(s?.shots) ? s.shots : []
  );
  if (flatFromSegments.length > 0) {
    shotPool = flatFromSegments;
  } else if (Array.isArray(raw.shots)) {
    shotPool = raw.shots;
  }

  // ── Build exactly N segments. Always honors user's segmentCount. ────
  const segments = [];
  const perSeg = shotPool.length > 0 ? Math.max(1, Math.ceil(shotPool.length / N)) : 0;

  for (let i = 0; i < N; i++) {
    const start = perSeg > 0 ? i * perSeg : 0;
    const end   = perSeg > 0 ? Math.min((i + 1) * perSeg, shotPool.length) : 0;
    const segShots = shotPool.slice(start, end);

    // Try to inherit summary/duration from a matching raw.segment if it had any
    const rawSeg = rawSegments[i] || {};
    const inheritedSummary = (typeof rawSeg.summary === 'string' && rawSeg.summary.trim())
      ? rawSeg.summary.trim()
      : null;

    const fallbackSummary =
      N === 1            ? (summary || 'Full story')
    : i === 0            ? `开场 hook — ${summary}`
    : i === N - 1        ? `高潮 payoff — ${summary}`
    :                      `Escalation ${i + 1} — ${summary}`;

    segments.push({
      segmentIndex: i + 1,
      summary: inheritedSummary || fallbackSummary,
      targetDurationSec: clampSegmentDuration(rawSeg.targetDurationSec),
      shots: segShots,
    });
  }

  // ── totalDuration: real sum of per-segment durations. ─────────────
  const totalDuration = segments.reduce(
    (acc, s) => acc + (s.targetDurationSec || 12),
    0
  );

  return {
    ...raw,
    summary,
    mood,
    protagonist,               // §2026-05-30 always present (LLM output or default)
    supporting_characters,     // §2026-05-31 multi-character scenes (empty when not needed)
    shots: shotPool,           // flat list for the storyboard image gen
    segments,                  // exactly N segments for the per-segment renders
    totalDuration,
    /* Diagnostic flag — set when the LLM gave us zero shots anywhere.
     * The Step 3 UI can use this to warn the user + offer regenerate. */
    _llmReturnedNoShots: shotPool.length === 0,
  };
};

export default function StoryGeneratorPage({ isSmallScreen, onBack }) {
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const [step, setStep] = useState(0); // Step 0 = Character Select
  const [characters, setCharacters] = useState([]);
  const [isLoadingCharacters, setIsLoadingCharacters] = useState(true);
  const [selectedCharacterId, setSelectedCharacterId] = useState('');
  // §2026-05-22 fei: isAddingCharacter state removed — Actor creation
  //   moved to LibraryPage. Buttons that used to open the creator now
  //   navigate('/library') instead.
  const [userTier, setUserTier] = useState('free');

  // §2026-05-23 fei: 5-field character seed for this story (matches
  //   buildStoryboardPrompt's [CHARACTER SEED] block in _worker.js).
  //   Optional — when blank, backend uses fallbacks derived from
  //   character.name + character.description.
  //   characterSeedHint: short freeform sentence, used as input to AI expand.
  //   characterSeed:     the structured 5-field object that gets sent to backend.
  //   showCharacterSeedPanel: collapsible UI toggle.
  const [characterSeedHint, setCharacterSeedHint] = useState('');
  const [characterSeed, setCharacterSeed] = useState({
    name: '',
    seed: '',
    ageBody: '',
    visualMedium: '',
    style: '',
    otherDetails: '',
  });
  const [showCharacterSeedPanel, setShowCharacterSeedPanel] = useState(false);
  const [isExpandingSeed, setIsExpandingSeed] = useState(false);
  const [seedExpandError, setSeedExpandError] = useState('');
  
  const [transcript, setTranscript] = useState('');
  const [videoType, setVideoType] = useState('trailer');

  // §2026-05-23 fei: multi-segment story support.
  //   User picks 1-5 segments at Step 1. Each segment is 10-15s of video.
  //   ONE big storyboard image is generated (showing all shots across all
  //   segments). For video rendering: same reference image (the storyboard)
  //   for all segments, different per-segment prompts targeting that
  //   segment's shot range. Segments rendered one at a time — user confirms
  //   "continue to next segment" between renders. After all done, optional
  //   "combine into one mp4" via ffmpeg concat.
  const MAX_SEGMENTS = 5;
  const [segmentCount, setSegmentCount] = useState(1);
  // renderedSegments: [{ idx, videoUrl, taskId, durationSec, status }]
  //   status: 'pending' (not started) | 'rendering' | 'ready' | 'failed'
  const [renderedSegments, setRenderedSegments] = useState([]);
  const [currentSegmentIdx, setCurrentSegmentIdx] = useState(0);
  const [combinedVideoUrl, setCombinedVideoUrl] = useState(null);
  const [isCombining, setIsCombining] = useState(false);
  const [selectedStyle, setSelectedStyle] = useState('');
  const [styleName, setSelectedStyleName] = useState('');
  /* §2026-05-25 fei — custom style prompt (when selectedStyle === 'custom').
   * Stored separately from selectedStyle so the picker keeps a stable
   * `id: 'custom'` while the prompt body is user-editable. Threaded
   * through to generateConceptDesign / generateCharacterBoard payloads
   * and persisted in the story draft (cross-device + page refresh). */
  const [customStylePrompt, setCustomStylePrompt] = useState('');
  const [stylePage, setStylePage] = useState(0); // legacy — retained in case other refs exist
  const [styleCategory, setStyleCategory] = useState('all'); // 'all' or a category from STYLES[].category
  
  // Script state
  const [isGeneratingScript, setIsGeneratingScript] = useState(false);
  // §2026-06-05 — script 生成失败信息(含 BUG-006 aiscreenwriter 超时)。非 null 时
  //   step 3 渲染「失败 + 重试/改提示」卡,替代原 `: null` 空白(避免卡死/死循环)。
  const [scriptGenError, setScriptGenError] = useState(null);
  const [generatedScript, setGeneratedScript] = useState(null);
  const scriptGenAttemptedRef = useRef(false);

  /* §2026-05-27 fei — output language override.
   *
   *   null      → Auto (走 detectInputLanguage(transcript) 现有自动检测)
   *   '<lang>'  → 强制指定 (e.g. 'English', 'Chinese (Simplified)', '日本語', ...)
   *
   *   场景: 用户中英混输入(80% 英文 + 20% 中文人名)时 detector 看到任一
   *   汉字就判 Chinese; 拉丁字符语种(法/西/德/葡)默认 English 无法区分;
   *   有时英文 transcript 想要中文脚本。手动 override 解决这 3 类。
   *
   *   持久化到 draft (localStorage + Supabase) 跟其他 wizard state 同周期. */
  const [outputLanguage, setOutputLanguage] = useState(null);
  const [langMenuOpen, setLangMenuOpen] = useState(false);
  // §2026-05-25 fei: debounced server-side draft save timer.
  //   localStorage write happens immediately on every state change; server
  //   write is debounced 3s via this timeout so we don't spam Supabase with
  //   one upsert per keystroke. The timer is cleared + re-armed on each
  //   change so only the LAST snapshot per quiet period gets uploaded.
  const draftSaveTimerRef = useRef(null);
  useEffect(() => {
    // Flush + cleanup on unmount: clear the pending timer so an unmounted
    //   component doesn't try to schedule more upserts. Don't await — we
    //   accept losing the last 0-3s of changes (localStorage still has it).
    return () => {
      if (draftSaveTimerRef.current) {
        clearTimeout(draftSaveTimerRef.current);
        draftSaveTimerRef.current = null;
      }
    };
  }, []);

  // Render station state
  const [renderProgress, setRenderProgress] = useState(0); // 0 = idle, 1 = character, 1.5 = concept preview, 2 = review, 3 = video, 4 = done
  // Wall-clock tracking for the long-running video render (renderProgress=3) so
  // the user sees something other than a spinner — typical render is 30s-3min,
  // long enough that a static spinner reads as "frozen".
  const [renderStartedAt, setRenderStartedAt] = useState(null);
  const [renderElapsedSec, setRenderElapsedSec] = useState(0);
  const [finalVideoUrl, setFinalVideoUrl] = useState(null);
  const [finalConceptUrl, setFinalConceptUrl] = useState(null);

  /* §2026-05-25 fei — inline error state buckets, replacing alert() for
   * Seedance / upload / merge errors. Each shape: { message, title?, help?,
   * retry?: () => void } or null. Each bucket is independent so multiple
   * concurrent failures (e.g. one Free Mode segment failing + an upload
   * failing) coexist as stacked banners instead of overwriting each other.
   *
   *   renderError       Quick Mode storyboard + render pipeline
   *   freeSegmentError  Free Mode single-segment Seedance call
   *   mergeError        ffmpeg.wasm video concat
   *   uploadError       Asset / reference / drag-drop uploads
   *   librarySaveError  Quick Mode / multi-segment merge → recommended_content
   *                     insert failure. §2026-05-26 fei added — previously
   *                     these inserts only console.error'd, so users with RLS
   *                     denials or network blips never saw their finished
   *                     video land in Library and had no way to retry short
   *                     of burning credits on a full re-render.
   *
   * Cleared on successful retry or by the X button on the banner. */
  const [renderError, setRenderError] = useState(null);
  // §2026-06-06 fei — 关页兜底退款提示(进页核对 stuck 视频任务后,若补退则提示)
  const [refundNotice, setRefundNotice] = useState(null);
  const [freeSegmentError, setFreeSegmentError] = useState(null);
  const [mergeError, setMergeError] = useState(null);
  const [uploadError, setUploadError] = useState(null);
  const [librarySaveError, setLibrarySaveError] = useState(null);

  /* §2026-05-25 fei: second image generated alongside the storyboard —
   * a polished CHARACTER IDENTITY BOARD (face / costume / proportion
   * model sheet in the user's chosen art style, optionally inspired by
   * the Actor photo). Shown in Step 3 next to the storyboard for QA.
   * Persisted with the draft. Generation is non-blocking — if it fails
   * the storyboard / render flow keeps working. */
  const [characterBoardUrl, setCharacterBoardUrl] = useState(null);
  const [characterBoardGenerating, setCharacterBoardGenerating] = useState(false);
  // §2026-05-30 fei Bug 4 — render_session_id groups generation_logs rows
  //   from one Quick Mode render. Generated at handleNextToRender entry,
  //   passed to all 3 downstream endpoints (character board, storyboard,
  //   video). Cleared / regenerated on each new render.
  const [currentRenderSessionId, setCurrentRenderSessionId] = useState(null);
  
  // States newly added for Draft history filtering and Feed Publishing
  // §2026-05-22 fei: showGeneratedChars state deleted — picker now always
  //   hides legacy AI-Character rows, no toggle needed.
  const [insertedWorkId, setInsertedWorkId] = useState(null);
  // Tracks whether the just-finished work has been published. When true, the
  // Render Station shows a success card with "Go home" / "Continue creating"
  // CTAs instead of the previous blocking alert().
  const [publishComplete, setPublishComplete] = useState(false);
  // Creative Canvas beta-access request state. The card on the mode-selection
  // screen reflects: not-requested → requesting → requested.
  const [isRequestingBeta, setIsRequestingBeta] = useState(false);
  const [creativeCanvasRequested, setCreativeCanvasRequested] = useState(false);
  const [previewVideoUrl, setPreviewVideoUrl] = useState('');

  // Publish-time authorization opt-in (persisted to recommended_content.allow_branch).
  // §2026-05-29 Leon round-105 — allow_recast state 删除 (Recast 产品取消)。
  const [allowBranch, setAllowBranch] = useState(false);
  // §2026-05-31 Leon round-103 Phase B — allow_download creator opt-in
  //   (persisted to recommended_content.allow_download). Default OFF —
  //   creators must explicitly opt in to let viewers download the video.
  //   isOwner viewers can ALWAYS download regardless of this flag (handled
  //   in the player caller, not here).
  const [allowDownload, setAllowDownload] = useState(false);

  // §2026-06-05 #2 — 创作者自助设封面(从视频选帧)。coverPct = 选中的时长比例
  //   (0–1),默认 0.1(= 自动非黑首帧)。coverDuration 从预览视频 metadata 读,
  //   用于把 pct 换算成 ?time={秒} 拉缩略图预览。发布时把 coverPct 传给
  //   ensureStreamPoster → 设 thumbnailTimestampPct。
  const [coverPct, setCoverPct] = useState(0.1);
  const [coverDuration, setCoverDuration] = useState(0);
  const [coverTouched, setCoverTouched] = useState(false); // 创作者是否主动拖过选帧滑块

  // Sequel State (旧名 Continuation,2026-05-13 rename)
  const [isSequel, setIsSequel] = useState(false);
  const [isRecast, setIsRecast] = useState(false);
  const [referenceVideoUrl, setReferenceVideoUrl] = useState('');
  const [sequelTitle, setSequelTitle] = useState('');
  const [sourceWorkId, setSourceWorkId] = useState(null);
  const [seriesId, setSeriesId] = useState(null);
  const [parentId, setParentId] = useState(null);

  // 2026-04-30 main-session emergency fix — handlePublishToFeed (line ~798)
  // 与 Publish 按钮 (line ~1656) 引用 isPublishing / setIsPublishing 但漏了
  // useState 声明，导致 ReferenceError 阻断创作页 production。Session 4
  // scope 文件，临时跨 scope 修补；relay 让 Session 4 后续接管。
  const [isPublishing, setIsPublishing] = useState(false);

  // Video generation options
  // §2026-06-02 fei — default to the GLOBAL max (1080p), not 720p. The
  //   profile-load effect below caps this DOWN to each tier's ceiling
  //   (free→480p, starter→720p), so paid tiers (creator/studio) now
  //   default to the full 1080p they pay for instead of silently getting
  //   720p unless they manually bumped the picker. CF Stream's ladder top
  //   == the source res, so this is what makes paid discover content render
  //   at 1080p instead of 720p. Cost note: 1080p = 12 tokens vs 720p = 6.
  const [videoResolution, setVideoResolution] = useState('1080p');
  // §2026-05-15: model IDs are now admin-configurable via system_settings
  // (see /api/video-models endpoint). Frontend fetches on mount + when
  // tier changes, renders dropdown from the response. Hardcoded fallback
  // here covers the brief window before /api/video-models returns.
  const [videoModel, setVideoModel] = useState('ep-20260507183959-d7mr2'); // default to Seedance 2.0 Fast (DB value)
  const [videoModelOptions, setVideoModelOptions] = useState([
    // Bootstrap fallback so the dropdown renders SOMETHING even before
    // /api/video-models resolves (~50-200ms latency on cold mount).
    // §2026-05-25 fei: cost_multiplier now part of each option — see
    //   computeQuickModeVideoCost / Free Mode pricing card.
    { id: 'ep-20260507183959-d7mr2', label: 'Seedance 2.0 Fast', tier_required: 'free', cost_multiplier: 1.0, max_resolution: '720p' },
  ]);

  const [promptBubbles, setPromptBubbles] = useState([]);
  
  // Series Creation Level State
  /* creationLevel & pinnedCard 初值从 URL 解析,确保 mount 时 state 与 URL match,
     避免 state→URL effect 用过期 default state 把刷新页面 navigate 回 /create。
     2026-05-12: /create 不再渲染 "Start your creation" landing hero,而是
     auto-redirect 到 /create/short (Short 是最高频 mode,默认显示)。Initial
     state 直接给 'quick' 避免首次渲染时 flash 一帧 select 态。
     映射: /create | /create/short → quick / /create/series → series /
     /create/flow → select+flow pin */
  const [creationLevel, setCreationLevel] = useState(() => {
    if (typeof window === 'undefined') return 'quick';
    const parts = window.location.pathname.split('/').filter(Boolean);
    if (parts[0] !== 'create') return 'select';
    if (parts[1] === 'short' || !parts[1]) return 'quick';  // /create 默认 → quick
    if (parts[1] === 'series') return 'series';
    return 'select';  // /create/flow → select + pinned flow (设在 pinnedCard)
  });

  /* ── Landing-screen pill card expand state ──
   * pinnedCard: chevron-clicked, persists until clicked again
   * hoveredCard: desktop hover, transient (mobile 不用)
   * 显示展开 = pinnedCard === key || hoveredCard === key */
  const [pinnedCard, setPinnedCard]   = useState(() => {
    if (typeof window === 'undefined') return null;
    const parts = window.location.pathname.split('/').filter(Boolean);
    return parts[0] === 'create' && parts[1] === 'flow' ? 'flow' : null;
  });
  const [hoveredCard, setHoveredCard] = useState(null);

  /* generationMode 初值从 URL 解析 — `/create/short/upload` 直链上传模式,
     `/create/short/free` 直链 Free Mode,其他 → 'quick'。让 Library
     "Upload a video" CTA 等深链一次到位,不再着陆 quick mode 再让用户切 tab。
     (2026-05-13 Leon)
     注:声明位置必须在下面 URL↔state 双向 sync effects 之前 — 那两个
     effect 都引用 generationMode/setGenerationMode,TDZ 不能反过来。 */
  const [generationMode, setGenerationMode] = useState(() => {
    if (typeof window === 'undefined') return 'quick';
    /* 2026-05-19 round-37 (Leon) — dev shortcut:
       ?_devMockUploadSuccess=1 → 直接进 upload mode + success card,
       跳过 file pick → submit path,方便 visual review success card。
       必须在 useState init 里 check (而非 mount useEffect),否则
       state→URL effect navigate replace 会先丢 query string。 */
    const params = new URLSearchParams(window.location.search);
    if (params.get('_devMockUploadSuccess') === '1') return 'upload';
    const parts = window.location.pathname.split('/').filter(Boolean);
    if (parts[0] === 'create' && parts[1] === 'short') {
      if (parts[2] === 'upload') return 'upload';
      if (parts[2] === 'free')   return 'free';
    }
    return 'quick';
  }); // 'quick' | 'free' | 'upload'

  /* Insufficient-tokens modal — 替换 native alert() 用 design-system 一致的
     web-style modal。点 Top up 跳 /subscription。 */
  const [tokenAlert, setTokenAlert] = useState(null);  // null | { required, current, context }

  /* 离开 select 子页(进入 series/quick) state 没机会被 onMouseLeave 清。
     返回 select 时 pill 会卡在上次的 expanded 状态。监听 creationLevel,
     一旦不在 select 就清空 hover state。pinnedCard 由 URL 决定,这里跳过。 */
  useEffect(() => {
    if (creationLevel !== 'select') {
      setHoveredCard(null);
    }
  }, [creationLevel]);

  /* ── URL ↔ creationLevel/pinnedCard 双向 sync (2026-05-11 Leon) ──
   * 让 Short/Series 进入后刷新页面能保留状态,Flow pinned 状态也能恢复。
   *   /create        ↔ creationLevel='select', pinnedCard=null
   *   /create/short  ↔ creationLevel='quick'
   *   /create/series ↔ creationLevel='series'
   *   /create/flow   ↔ creationLevel='select', pinnedCard='flow'
   *
   * Race guards (sidebar effect 已有同模式):
   *   - URL → state 由 location.pathname effect 处理
   *   - state → URL 由 creationLevel/pinnedCard 变化 effect 处理
   *   - 用 ref 区分谁先变,避免循环。 */
  const prevPathnameRef = useRef(location.pathname);
  const prevLevelRef    = useRef(creationLevel);
  const prevPinnedRef   = useRef(pinnedCard);

  /* URL → state: location.pathname 变化时 sync 进 state */
  useEffect(() => {
    const parts = location.pathname.split('/').filter(Boolean);
    if (parts[0] !== 'create') return;
    const sub = parts[1]; // 'short' | 'series' | 'flow' | undefined
    if (sub === 'short') {
      if (creationLevel !== 'quick') setCreationLevel('quick');
      /* 第三段决定 generationMode 子选项 (2026-05-13 Leon):
         /create/short          → quick
         /create/short/upload   → upload (Library "Upload a video" 深链入口)
         /create/short/free     → free */
      const sub2 = parts[2];
      const nextMode = sub2 === 'upload' ? 'upload'
                     : sub2 === 'free'   ? 'free'
                     : 'quick';
      if (generationMode !== nextMode) setGenerationMode(nextMode);
    } else if (sub === 'series') {
      if (creationLevel !== 'series') setCreationLevel('series');
    } else if (sub === 'flow') {
      if (creationLevel !== 'select') setCreationLevel('select');
      if (pinnedCard !== 'flow') setPinnedCard('flow');
    } else {
      // /create 裸路径 → 默认 Short (2026-05-12 Leon: Short 是最高频 mode,
      // 作为 Create 频道 default。state→URL effect 会接手 navigate 到
      // /create/short,这里只确保 state 对齐避免视觉 flash)
      if (creationLevel !== 'quick') setCreationLevel('quick');
    }
  }, [location.pathname]);

  /* state → URL: creationLevel/pinnedCard/generationMode 变化时 navigate */
  const prevGenModeRef = useRef(generationMode);
  useEffect(() => {
    const pathnameChanged = prevPathnameRef.current !== location.pathname;
    const levelChanged    = prevLevelRef.current !== creationLevel;
    const pinnedChanged   = prevPinnedRef.current !== pinnedCard;
    const modeChanged     = prevGenModeRef.current !== generationMode;
    prevPathnameRef.current = location.pathname;
    prevLevelRef.current    = creationLevel;
    prevPinnedRef.current   = pinnedCard;
    prevGenModeRef.current  = generationMode;

    // URL 先变 → 让 effect 1 接手,此处 bail 避免反向 navigate
    if (pathnameChanged && !levelChanged && !pinnedChanged && !modeChanged) return;

    // Default target: /create/short (Short 是 Create 默认 mode)
    let target = '/create/short';
    if (creationLevel === 'quick') {
      /* Short 下三种 mode → 三个 URL (2026-05-13 Leon):
         quick (默认) → /create/short
         upload       → /create/short/upload
         free         → /create/short/free
         三个 URL 都属 Short level,Pills bar 高亮 Short,后端不感知 */
      if (generationMode === 'upload')    target = '/create/short/upload';
      else if (generationMode === 'free') target = '/create/short/free';
      else target = '/create/short';
    } else if (creationLevel === 'series') target = '/create/series';
    else if (creationLevel === 'select' && pinnedCard === 'flow') target = '/create/flow';
    // creationLevel === 'select' 且无 pinned flow → 默认 Short(transient state)

    if (location.pathname !== target) {
      navigate(target, { replace: true });
    }
  }, [creationLevel, pinnedCard, generationMode, location.pathname, navigate]);
  const [seriesTitle, setSeriesTitle] = useState('');
  const [seriesDescription, setSeriesDescription] = useState('');
  const [seriesCastIds, setSeriesCastIds] = useState([]);
  const [showCastPicker, setShowCastPicker] = useState(false);
  const [seriesEpisodes, setSeriesEpisodes] = useState([]);
  // Series save state. currentSeriesId is null until first save (then UPDATE
  // path). lastSavedAt drives the "Saved" eyebrow under the Save button.
  const [currentSeriesId, setCurrentSeriesId] = useState(null);
  const [isSavingSeries, setIsSavingSeries] = useState(false);
  const [lastSavedAt, setLastSavedAt] = useState(null);
  const [seriesSaveError, setSeriesSaveError] = useState(null);
  const [isPublishingSeries, setIsPublishingSeries] = useState(false);
  const [seriesStatus, setSeriesStatus] = useState('draft'); // draft | published

  // Free Mode State — `generationMode` state lifted up earlier (next to pinnedCard,
  // before URL sync effects) so the URL↔state effects can reference it without TDZ.

  // Upload Video Mode state — submits user-owned video to Cloudflare Stream
  // (via /api/user-videos/init-upload), records pending_review row in DB,
  // and surfaces success message instructing user to wait for admin review.
  // See migrations/20260507_user_video_uploads.up.sql for full pipeline.
  const [uploadFile, setUploadFile] = useState(null);
  const [uploadTitle, setUploadTitle] = useState('');
  const [uploadDescription, setUploadDescription] = useState('');
  const [uploadCopyrightChecked, setUploadCopyrightChecked] = useState(false);
  const [uploadIsSubmitting, setUploadIsSubmitting] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  /* 2026-05-20 round-57 — drop-zone visionOS Controls/Fills 4 态。
   * MEMORY.md 设计纪律: "不做 :hover/:active auto-binding,consumer 按 UX
   * 意图手动 toggle class" — 这里由 React state 显式管。 */
  const [dropzoneFillState, setDropzoneFillState] = useState('idle'); // 'idle' | 'hover' | 'pinch'
  const [uploadResult, setUploadResult] = useState(() => {
    // 2026-05-19 round-37 — dev shortcut 同 generationMode init
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search);
      if (params.get('_devMockUploadSuccess') === '1') return { ok: true };
    }
    return null;
  }); // null | { ok: true } | { ok: false, message }

  const [freePrompt, setFreePrompt] = useState('');
  const [isOptimizingPrompt, setIsOptimizingPrompt] = useState(false);
  const [isPromptOptimized, setIsPromptOptimized] = useState(false);
  const [freeAssets, setFreeAssets] = useState([]); // array of { id, url, isVideo, name }
  // §2026-06-06 fei — 用户历史生成的图片(从 Works 加载),供 Free Mode 选作参考图(跨会话)
  const [savedImages, setSavedImages] = useState([]); // array of { id, url, title }
  const [isUploadingRef, setIsUploadingRef] = useState(false);
  const [freeDuration, setFreeDuration] = useState(5);

  // Dynamic pricing: credits per second by resolution.
  // MUST stay in sync with CREDITS_PER_SEC in public/_worker.js — backend
  // is the source of truth, frontend value here only drives the preview
  // "cost ~ X credits" UI before submit.
  // 2026-05-11 — adjusted +60% per Leon. Old: 2/3/7 → new: 4/6/12 (2:3:6 ratio).
  const RESOLUTION_CREDITS_PER_SEC = { '480p': 4, '720p': 6, '1080p': 12 };

  /* §2026-05-25 fei — cost now includes model multiplier.
   *
   *   base    = resolution rate × duration
   *   final   = ceil(base × model.cost_multiplier)
   *
   * Fast = 1.0× (no surcharge), Standard = 1.5× per the default
   * system_settings.seedance_*_cost_multiplier values.
   *
   * Looked up via videoModelOptions which is hydrated from
   * /api/video-models on mount. If model lookup fails (unknown id,
   * options not yet loaded), defaults to 1.0× — fail open to base
   * pricing rather than blocking the modal.
   *
   * Rounding UP (ceil) because partial tokens are unspendable AND we
   * never want to undershoot what the worker side might re-compute. */
  const getModelMultiplier = (modelId) => {
    const m = videoModelOptions.find(o => o.id === modelId);
    const x = m?.cost_multiplier;
    return (typeof x === 'number' && x > 0) ? x : 1.0;
  };
  /* §2026-06-05 模型支持的最高 resolution。BytePlus Seedance 2.0 Fast 不支持
   *   1080p(只 480p/720p),Standard 才到 1080p。值来自 /api/video-models 的
   *   max_resolution(与 worker resolveModelMaxResolution 同源 system_settings)。
   *   老 API 没返回该字段时 fail-open 到 '1080p'(worker 端仍会兜底 clamp)。 */
  const RES_RANK = { '480p': 1, '720p': 2, '1080p': 3, '4K': 4 };
  const getModelMaxResolution = (modelId) => {
    const m = videoModelOptions.find(o => o.id === modelId);
    return m?.max_resolution || '1080p';
  };
  // 某 resolution 是否被当前模型支持(超过模型上限 = 不支持)。
  const resAllowedByModel = (res, modelId) =>
    (RES_RANK[res] || 1) <= (RES_RANK[getModelMaxResolution(modelId)] || 3);
  const computeFreeModeCredits = (dur, res, modelId = null) => {
    const base = (RESOLUTION_CREDITS_PER_SEC[res] || 6) * dur;
    const multiplier = modelId ? getModelMultiplier(modelId) : 1.0;
    return Math.ceil(base * multiplier);
  };
  // §Pass current videoModel to keep Free Mode price reactive to model too.
  const freeModeCost = computeFreeModeCredits(freeDuration, videoResolution, videoModel);
  // §2026-05-22 fei: Quick mode cost = storyboard + video.
  //   Initial render entry charges BOTH (one storyboard + one video budget).
  //   "Not quite right — regenerate" charges another storyboard.
  //   "Confirm image & generate video" never charges (paid at entry).
  //
  //   Storyboard cost = STORYBOARD_TOKEN_COST (flat 3 tokens, see plans.js)
  //   Video cost = computeFreeModeCredits (resolution × duration)
  //
  //   Refund policy:
  //     · Initial entry → if storyboard fails BEFORE video starts,
  //       refund (storyboard + video) = whole entry cost
  //     · Regenerate storyboard → if storyboard fails, refund (storyboard)
  //     · Seedance video failure → no auto-refund (user has usable assets)
  const quickModeVideoCost = computeFreeModeCredits(
    (generatedScript?.totalDuration) || 5,
    videoResolution,
    videoModel,  // §2026-05-25 fei — Quick Mode price now reacts to model too
  );
  const quickModeCost = STORYBOARD_TOKEN_COST + quickModeVideoCost;
  // pendingRenderConfirm = { cost, storyboardCost, videoCost,
  //                           durationSec, resolution, kind: 'entry'|'regenerate' } | null
  //   null     → no modal
  //   value    → modal open with cost preview; user confirms or cancels
  //   kind:'entry'      → initial entry (charges storyboard + video)
  //   kind:'regenerate' → just storyboard re-gen (charges storyboard only)
  const [pendingRenderConfirm, setPendingRenderConfirm] = useState(null);
  const [videoRatio, setVideoRatio] = useState('16:9');
  const [showAssetPicker, setShowAssetPicker] = useState(false);
  // §2026-05-23 fei: assetPickerPos removed — picker is now anchored to
  //   the bottom of the textarea via CSS (top-full) instead of measured
  //   caret position. Eliminates the "jumping picker" + "focus-to-start"
  //   bugs caused by getCaretCoordinates() appending a hidden mirror div
  //   to document.body.

  // Multi-segment Free Mode State
  const [freeSegments, setFreeSegments] = useState([]); // array of { id, url, prompt, duration, status: 'ready'|'generating' }
  const [freeSegmentGenerating, setFreeSegmentGenerating] = useState(false);
  const [showLibraryPicker, setShowLibraryPicker] = useState(false);
  const [libraryVideos, setLibraryVideos] = useState([]);
  const [isLoadingLibrary, setIsLoadingLibrary] = useState(false);
  const [isMergingSegments, setIsMergingSegments] = useState(false);
  const [mergeProgress, setMergeProgress] = useState(0);
  const [historyAssets, setHistoryAssets] = useState([]); // previously used assets kept as shortcuts
  const [showCharacterAssetPicker, setShowCharacterAssetPicker] = useState(false);
  const [showGenerateAssetPanel, setShowGenerateAssetPanel] = useState(false);
  const [generateAssetPrompt, setGenerateAssetPrompt] = useState('');
  const [isGeneratingAsset, setIsGeneratingAsset] = useState(false);
  // §2026-06-06 fei — 参考图改多选(数组);Style 选择器已移除(忠实按 prompt 出图)
  const [generateAssetRefUrls, setGenerateAssetRefUrls] = useState([]);
  // §2026-06-06 fei — Free Mode 出图:用户可选画质 + 分辨率,价格随选择 3→6(封顶 2×)
  const [generateAssetQuality, setGenerateAssetQuality] = useState('medium'); // low 经济 / medium 标准 / high 高清
  const [generateAssetSize, setGenerateAssetSize] = useState('1536x1024');     // 1536x1024 横 / 1024x1024 方 / 1024x1536 竖 / auto 自动(跟参考图)
  const [autoResolvedSize, setAutoResolvedSize] = useState(null);              // 「自动」时由参考图比例解析出的实际尺寸
  // 「自动」仅在恰好 1 张参考图时可用;解析为 effectiveAssetSize 用于出图 + 定价
  const effectiveAssetSize = generateAssetSize === 'auto' ? (autoResolvedSize || '1536x1024') : generateAssetSize;
  // 与 worker /api/generate-image 服务端定价一致:credit = 3 + 画质(low0/med1/high2) + 尺寸(方0/横竖1)
  const IMAGE_ASSET_QUALITY_COST = { low: 0, medium: 1, high: 2 };
  const computeImageAssetCost = (q, s) => 3 + (IMAGE_ASSET_QUALITY_COST[q] ?? 1) + (s === '1024x1024' ? 0 : 1);
  const generateAssetCost = computeImageAssetCost(generateAssetQuality, effectiveAssetSize);
  const [showGenerateAssetCharPicker, setShowGenerateAssetCharPicker] = useState(false);
  const [lightboxUrl, setLightboxUrl] = useState(null); // asset lightbox preview
  // 2026-05-27 round-79 — Prompt expanded mode:点 expand button 把 prompt textarea
  // "呈现到上块"(便于看长 prompt)。state true 时上块 swap 显示大 textarea (可编辑,
  // 跟下块 textarea 共享 freePrompt state)。
  /* §2026-05-30 round-106 — 全屏 prompt 编辑器(甲方反馈:Free mode 需要编辑超大
   * prompt,720×360 in-panel 展开不够)。点全屏按钮 → 近全屏 modal 大 textarea,
   * 共享 freePrompt state 实时 sync。 */
  const [promptFullscreen, setPromptFullscreen] = useState(false);

  // 2026-05-27 round-79 — Ratio custom dropdown:chip 显 short value (`16:9`),
  // 点击展开 menu items 详细 (`16:9 · Landscape`)。native <select> 不能分开
  // display vs option text,所以自实现 button + popover。
  // v2: createPortal to body + position:fixed 逃 GlassPane overflow:hidden clip
  // (跟 Tooltip primitive 同思路)。click-outside check 跨 portal 两个 ref。
  const [ratioMenuOpen, setRatioMenuOpen] = useState(false);
  const [ratioChipRect, setRatioChipRect] = useState(null);
  const ratioChipRef = useRef(null);
  const ratioDropdownRef = useRef(null);
  useLayoutEffect(() => {
    if (ratioMenuOpen && ratioChipRef.current) {
      setRatioChipRect(ratioChipRef.current.getBoundingClientRect());
    }
  }, [ratioMenuOpen]);
  useEffect(() => {
    if (!ratioMenuOpen) return;
    const handler = (e) => {
      const inChip = ratioChipRef.current?.contains(e.target);
      const inDropdown = ratioDropdownRef.current?.contains(e.target);
      if (!inChip && !inDropdown) setRatioMenuOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [ratioMenuOpen]);
  const [lightboxIsVideo, setLightboxIsVideo] = useState(false);
  const [savedSegments, setSavedSegments] = useState([]);
  const [savedSegmentsPage, setSavedSegmentsPage] = useState(0);
  const [hasMoreSavedSegments, setHasMoreSavedSegments] = useState(true);
  const [isLoadingSavedSegments, setIsLoadingSavedSegments] = useState(false);
  const SAVED_SEG_PAGE_SIZE = 5;
  const ffmpegRef = useRef(null);
  const ffmpegLoadedRef = useRef(false);

  // Generate a stable unique ID from a URL (short hash)
  const generateAssetId = (url) => {
    let hash = 0;
    for (let i = 0; i < url.length; i++) {
      const char = url.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32bit integer
    }
    return 'asset_' + Math.abs(hash).toString(36);
  };
  
  const textareaRef = useRef(null);
  // §2026-05-31 BUG-003 — preview <video> 专属 ref。Replay 之前用
  //   document.querySelector('video') 抓"页面第一个 video",多 video 时会抓错
  //   元素并对无源 video 调 .play() → 未捕获的 NotSupportedError 上报 Sentry。
  const previewVideoRef = useRef(null);
  const coverVideoRef = useRef(null); // §2026-06-05 #2 — 封面选帧用的独立 picker video
  const [credits, setCredits] = useState(0);
  const [tier, setTier] = useState('free');
  const [dailyShareCount, setDailyShareCount] = useState(0);
  const [isVideoEnded, setIsVideoEnded] = useState(false);

  // Load Profile on Mount
  useEffect(() => {
    getUserProfile().then(async profile => {
      setCredits(profile.credits);
      setTier(profile.tier);
      setDailyShareCount(profile.dailyShareCount || 0);

      // Auto-cap resolution to the tier ceiling via plans.js.
      //   FREE: 480p / STARTER: 720p / CREATOR & STUDIO: 1080p (4K not built).
      //   The default state above is the GLOBAL max (1080p); this pulls it
      //   DOWN for free/starter, and leaves creator/studio at 1080p — so
      //   paid tiers default to full resolution. Only caps when the current
      //   value EXCEEDS the ceiling, so a restored draft's explicit (lower)
      //   choice is preserved.
      const allowed = getResolutionOptions(profile.tier || 'free');
      if (!allowed.includes(videoResolution)) {
        setVideoResolution(allowed[allowed.length - 1]); // cap to highest allowed
      }

      // §2026-05-15: fetch the live model list from /api/video-models —
      // admin can rotate endpoint IDs in System Settings without redeploy.
      // Returns models filtered by caller tier (Free only sees Fast, paid
      // tiers see Fast + Standard). On failure, keeps the bootstrap state.
      try {
        const { data: { session } } = await supabase.auth.getSession();
        const headers = session ? { 'Authorization': `Bearer ${session.access_token}` } : {};
        const r = await fetch('/api/video-models', { headers });
        if (r.ok) {
          const data = await r.json();
          if (data.success && Array.isArray(data.models) && data.models.length > 0) {
            setVideoModelOptions(data.models);
            // Auto-pick default: Free forced to Fast (default returned),
            // paid tier keeps whatever they had selected if still available
            // in the list; otherwise resets to default.
            const stillAvailable = data.models.some(m => m.id === videoModel);
            if ((profile.tier || 'free') === 'free' || !stillAvailable) {
              setVideoModel(data.default || data.models[0].id);
            }
          }
        }
      } catch { /* keep bootstrap state */ }
    });
  }, []);

  /* §2026-06-05 模型感知 resolution 自动收口。
   *   切到不支持当前 resolution 的模型(如从 Standard 切回 Fast,而当前是
   *   1080p)时,自动把 videoResolution 降到该模型的最高支持档,避免提交后
   *   被 BytePlus 拒(InvalidParameter)。worker 端仍有兜底 clamp,这里只是
   *   让 UI 提前同步、价格预览准确。依赖 videoModelOptions 以便 API 返回
   *   max_resolution 后重新评估。 */
  useEffect(() => {
    if (!resAllowedByModel(videoResolution, videoModel)) {
      const max = getModelMaxResolution(videoModel);
      setVideoResolution(max);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [videoModel, videoModelOptions]);

  // Load existing series when navigated from /my-series Continue link
  // (?series=<id>). Auto-switches creationLevel to 'series' and hydrates
  /* 2026-05-08 Leon — sidebar Create click 时 IndexPage navigate('/create',
   * { state: { freshNav: ts } }) 触发此 effect。重置 creationLevel 回 'select'
   * 让用户从 series/quick 子流程返回 landing 选择页。 */
  useEffect(() => {
    if (location.state?.freshNav) {
      setCreationLevel('select');
      setPinnedCard(null);  // 2026-05-11 A.5: sidebar Create click 也清 pin,
                            // 否则 pinnedCard='flow' 会让 URL 卡在 /create/flow
    }
  }, [location.state?.freshNav]);

  // all form fields. Owner-scoped via RLS — if a user pastes someone
  // else's series id into the URL, the query returns nothing and we
  // silently no-op (no security concern, just a stale link).
  useEffect(() => {
    const seriesIdFromUrl = searchParams.get('series');
    if (!seriesIdFromUrl) return;
    let cancelled = false;
    (async () => {
      try {
        const { data, error } = await supabase
          .from('series')
          .select('*')
          .eq('id', seriesIdFromUrl)
          .maybeSingle();
        if (error || !data || cancelled) return;
        setCreationLevel('series');
        setCurrentSeriesId(data.id);
        setSeriesTitle(data.title || '');
        setSeriesDescription(data.description || '');
        setSeriesCastIds(Array.isArray(data.cast_ids) ? data.cast_ids : []);
        setSeriesEpisodes(Array.isArray(data.episodes) ? data.episodes : []);
        setSeriesStatus(data.status || 'draft');
        if (data.updated_at) setLastSavedAt(new Date(data.updated_at));
      } catch (err) {
        console.warn('[load series from URL]', err);
      }
    })();
    return () => { cancelled = true; };
    // searchParams excluded so we only run on initial mount param
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  
  // Auto-restore Draft on Mount
  useEffect(() => {
    /* §2026-05-25 fei: hybrid restore — server FIRST, localStorage fallback.
     *
     *   Why this order:
     *     · Server source of truth means a draft saved on iPhone shows up
     *       on Mac. localStorage only ever saw one device.
     *     · If user is anonymous OR offline OR server returns empty, we
     *       still have the local copy — no regression from the old behavior.
     *     · We pick the most-recently-updated server row across all modes
     *       (matches old "single most recent draft" semantics; multi-mode
     *       Library card now exposes the others explicitly).
     *
     *   Conflict policy: server wins when both exist. The user's last
     *   action on ANY device is what we believe. localStorage gets a
     *   re-write from the auto-save effect once state loads, so the two
     *   sides re-converge naturally. */
    let cancelled = false;
    (async () => {
      let draft = null;
      try {
        const serverDrafts = await listDrafts();
        if (cancelled) return;
        if (serverDrafts && serverDrafts.length > 0) {
          /* §2026-05-25 fei: prefer the row matching the URL-derived
           *   generationMode (e.g. /create/short/free → 'free'). This
           *   matters when the user has multiple drafts on the server —
           *   landing on /create/short/free should restore the FREE
           *   draft, not just "most recent across all modes". The initial
           *   value of generationMode comes from useState's URL parser
           *   (line ~561) so by the time this async runs after first
           *   render, it's already correct.
           *   Falls back to the most-recently-updated row if no match. */
          const preferredMode = generationMode || 'quick';
          const matchingRow = serverDrafts.find(r => r.generation_mode === preferredMode);
          const top = matchingRow || serverDrafts[0];
          if (top?.data && typeof top.data === 'object') {
            draft = top.data;
            // Ensure generationMode survives even if the JSONB blob predates
            //   our schema (older Quick Mode rows didn't store it).
            if (!draft.generationMode && top.generation_mode) {
              draft.generationMode = top.generation_mode;
            }
          }
        }
      } catch (e) {
        console.warn('[draft] server fetch failed, falling back to local:', e);
      }
      if (cancelled) return;
      if (!draft) {
        try {
          const draftStr = localStorage.getItem('uvera_story_draft');
          if (draftStr) draft = JSON.parse(draftStr);
        } catch (e) {
          console.warn('[draft] local parse failed:', e);
        }
      }
      if (cancelled || !draft) return;

      try {
        // Only restore if the draft isn't fully completed
        if (draft.renderProgress !== 4) {
          /* §2026-05-25 fei: infer the highest meaningful step from
           *   present data, then use max(saved_step, inferred_step).
           *
           *   Why: some error handlers (handleGenerateScript catch,
           *   handleFreeSegmentGenerate catch, etc.) call setStep(0)
           *   on failure to recover gracefully. But other state stays
           *   set (transcript / style / generatedScript). The
           *   auto-save runs AFTER that reset, so the draft persists
           *   with step=0 + all the work intact. On restore, naively
           *   using draft.step=0 lands the user back on Step 0 (Avatar
           *   select), hiding all their previous work — they think the
           *   draft is broken.
           *
           *   By inferring, we route them to the LATEST step their
           *   data supports. e.g., if generatedScript exists, land
           *   them on Step 3 (script review) so they can see + render.
           */
          const inferredStep = (() => {
            if (draft.renderProgress >= 1) return 4;        // already in render station
            if (draft.generatedScript)     return 3;         // script ready → review page
            if (draft.selectedStyle)       return 2;         // style picked → style page
            if (draft.transcript)          return 1;         // transcript written → transcript page
            return 0;                                        // nothing → avatar select
          })();
          const savedStep = (typeof draft.step === 'number') ? draft.step : 0;
          const restoredStep = Math.max(savedStep, inferredStep);
          setStep(restoredStep);
          if (draft.selectedCharacterId) setSelectedCharacterId(draft.selectedCharacterId);
          if (draft.transcript) setTranscript(draft.transcript);
          if (draft.videoType) setVideoType(draft.videoType);
          if (draft.selectedStyle) setSelectedStyle(draft.selectedStyle);
          if (draft.styleName) setSelectedStyleName(draft.styleName);
          if (draft.customStylePrompt) setCustomStylePrompt(draft.customStylePrompt);
          // §2026-05-27 fei — persist output-language override across sessions
          if (draft.outputLanguage !== undefined) setOutputLanguage(draft.outputLanguage);
          if (draft.generatedScript) setGeneratedScript(draft.generatedScript);
          if (draft.renderProgress !== undefined) setRenderProgress(draft.renderProgress);
          if (draft.finalConceptUrl) setFinalConceptUrl(draft.finalConceptUrl);
          // §2026-05-25 fei: character identity board (sibling of storyboard)
          if (draft.characterBoardUrl) setCharacterBoardUrl(draft.characterBoardUrl);
          // 2026-05-13 dual-read: backward compat 旧 localStorage drafts 用
          // isContinuation / continuationTitle key,新代码用 isSequel / sequelTitle。
          // 1-2 周观察期后可删除 ?? fallback (Phase 4 cleanup)。
          if (draft.isSequel ?? draft.isContinuation) setIsSequel(draft.isSequel ?? draft.isContinuation);
          if (draft.isRecast) setIsRecast(draft.isRecast);
          if (draft.referenceVideoUrl) setReferenceVideoUrl(draft.referenceVideoUrl);
          if (draft.sequelTitle ?? draft.continuationTitle) setSequelTitle(draft.sequelTitle ?? draft.continuationTitle);
          if (draft.sourceWorkId) setSourceWorkId(draft.sourceWorkId);
          if (draft.seriesId) setSeriesId(draft.seriesId);
          if (draft.parentId) setParentId(draft.parentId);
          // §2026-05-23 fei: multi-segment state restore
          if (typeof draft.segmentCount === 'number') setSegmentCount(draft.segmentCount);
          if (Array.isArray(draft.renderedSegments)) setRenderedSegments(draft.renderedSegments);
          if (typeof draft.currentSegmentIdx === 'number') setCurrentSegmentIdx(draft.currentSegmentIdx);
          if (draft.combinedVideoUrl) setCombinedVideoUrl(draft.combinedVideoUrl);

          // §2026-05-24 fei: Free Mode state restore. When user clicked
          //   Continue on a Free Mode draft from Library, generationMode
          //   gets set first (auto-routes URL to /create/short/free
          //   via the existing URL sync effect at line ~599) so the UI
          //   shows the Free Mode card with all prior content restored.
          if (draft.generationMode === 'free') {
            setGenerationMode('free');
            if (typeof draft.freePrompt === 'string') setFreePrompt(draft.freePrompt);
            if (Array.isArray(draft.freeAssets)) setFreeAssets(draft.freeAssets);
            if (Array.isArray(draft.freeSegments)) setFreeSegments(draft.freeSegments);
            if (typeof draft.freeDuration === 'number') setFreeDuration(draft.freeDuration);
            if (typeof draft.videoRatio === 'string') setVideoRatio(draft.videoRatio);
            if (typeof draft.videoResolution === 'string') setVideoResolution(draft.videoResolution);
            if (typeof draft.videoModel === 'string') setVideoModel(draft.videoModel);
          }
        }
      } catch(e) {
        console.warn("Failed to restore draft:", e);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // Auto-run script generation for Continuation / Recast flows.
  //
  // Continuation (sequel): inherits parent's character + style, so we
  // SKIP from step 0 directly to step 3 (script) and fire generation.
  //
  // Recast (re-cast actor): user MUST pick their own character + style
  // before script generation (whole point of recast is "swap the actor").
  // We DO NOT skip step 0 — user traverses the picker UI normally, and
  // only when they reach step 3 via Next-button navigation does the
  // script auto-generate. This was a real bug pre-2026-05-11 where
  // Recast users couldn't change the character at all.
  useEffect(() => {
    if (
      (isSequel || isRecast) &&
      transcript &&
      !generatedScript &&
      !isGeneratingScript &&
      !scriptGenAttemptedRef.current
    ) {
      const shouldAutoSkipToScript = isSequel && step === 0;
      const atScriptStep            = step === 3;
      if (shouldAutoSkipToScript || atScriptStep) {
        scriptGenAttemptedRef.current = true;
        console.log(`[${isSequel ? 'Sequel' : 'Recast'}] Auto-generating script at step ${step}…`);
        if (shouldAutoSkipToScript) setStep(3);
        handleGenerateScript(true);
      }
    }
  }, [isSequel, isRecast, transcript, generatedScript, isGeneratingScript, step]);

  // Auto-advance to render after script generation completes for
  // Recast / Continuation. Without this the user sits forever on the
  // "Preparing video assets…" loading screen because the normal
  // Quick Mode handoff (user clicks "Confirm and enter Render Station"
  // at step 3) is hidden behind the loading overlay for Continuation
  // (sequel flow — user already saw the story context on the parent video,
  // so re-reviewing an AI-generated continuation is redundant).
  //
  // Recast does NOT auto-advance — user explicitly wants to rewrite the
  // story with new characters, so they need to see and edit the script
  // before render. Removing isRecast from the trigger (2026-05-11 Leon
  // bug report: "无重新撰写故事，现在是直接自动生成完成无法重新撰写").
  //
  // Guard with renderProgress === 0 so we only fire once — the render
  // pipeline itself moves renderProgress to 1+ inside handleNextToRender.
  // Use a separate ref so a Continuation restart (back-button) re-arms.
  const autoRenderTriggeredRef = useRef(false);
  useEffect(() => {
    if (
      isSequel &&
      !isRecast &&  // explicit guard — Recast pauses at step 3 for review
      generatedScript &&
      !isGeneratingScript &&
      renderProgress === 0 &&
      !autoRenderTriggeredRef.current
    ) {
      autoRenderTriggeredRef.current = true;
      console.log("[Sequel] Script ready — opening render cost-confirm modal…");
      // §2026-05-22 fei: sequel/continuation flow also goes through the
      //   cost-confirm modal. User clicked "Continue this story" knowing
      //   they'd pay, but showing the explicit cost + confirm is consistent
      //   with the Quick mode entry UX. If they cancel, they're back on
      //   step 3 with the generated script ready.
      handleRequestRenderEntry();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isSequel, isRecast, generatedScript, isGeneratingScript, renderProgress]);

  // The script generation now pauses at step 3 for user review.

  // Initialize Random Ideas
  useEffect(() => {
    // Set up initial random bubbles when entering step 1
    if (step === 1 && promptBubbles.length === 0) {
      const shuffled = [...STATIC_PROMPTS].sort(() => 0.5 - Math.random());
      setPromptBubbles(shuffled.slice(0, 8));
      
      // Async fetch new AI ideas in background
      generateRandomIdeas().then(newIdeas => {
        if (newIdeas && newIdeas.length > 0) {
          setPromptBubbles(prev => {
            // Keep first 4 static, replace last 4 with AI generated
            const keep = prev.slice(0, 4);
            return [...newIdeas, ...keep];
          });
        }
      });
    }
  }, [step]);

  // Auto-save Draft on State Changes
  useEffect(() => {
    if (renderProgress === 4) return; // Don't save completed runs
    if (publishComplete) return;       // Already published — no resume needed

    // §2026-05-24 fei: per generationMode persistence gate.
    //   Quick Mode (and Sequel/Recast variants): the meaningful state
    //     starts when user has picked a character. Pre-character entry
    //     = empty draft, don't save.
    //   Free Mode: there's no character step — meaningful state is when
    //     user has written a prompt, uploaded an asset, OR generated a
    //     segment. Save only when at least one of these is non-empty.
    if (generationMode === 'free') {
      const hasFreeContent = !!(freePrompt && freePrompt.trim())
        || (Array.isArray(freeAssets) && freeAssets.length > 0)
        || (Array.isArray(freeSegments) && freeSegments.length > 0);
      if (!hasFreeContent) return;
    } else {
      if (step === 0 && !selectedCharacterId) return;
    }

    const draft = {
      // §2026-05-24 fei: generationMode + timestamp so Library can show
      //   the right draft kind + sort by recency
      generationMode,
      timestamp: Date.now(),

      // Quick Mode story flow
      step,
      selectedCharacterId,
      transcript,
      videoType,
      selectedStyle,
      styleName,
      customStylePrompt,  // §2026-05-25 fei — persist user-defined style prompt
      outputLanguage,     // §2026-05-27 fei — persist language override (null = auto)
      generatedScript,
      renderProgress,
      finalConceptUrl,
      characterBoardUrl,  // §2026-05-25 fei: persist character identity board with draft
      isSequel,
      isRecast,
      referenceVideoUrl,
      sequelTitle,
      sourceWorkId,
      seriesId,
      parentId,
      // §2026-05-23 fei: multi-segment state persistence
      segmentCount,
      renderedSegments,
      currentSegmentIdx,
      combinedVideoUrl,

      // §2026-05-24 fei: Free Mode state — must be persisted or the
      //   "Continue" button in Library would land users on a blank page.
      //   freeAssets carry public R2 URLs that survive across sessions;
      //   freeSegments hold Stream URLs. The only thing we drop is
      //   ephemeral generation status (a segment mid-render at the time
      //   of save will replay as "ready" if its TOS URL is still valid).
      freePrompt,
      freeAssets,
      freeSegments,
      freeDuration,
      videoRatio,
      videoResolution,
      videoModel,
    };
    localStorage.setItem('uvera_story_draft', JSON.stringify(draft));

    /* §2026-05-25 fei: also persist to Supabase, debounced 3s.
     *   localStorage write is immediate (offline-resilient, no network).
     *   Server write is debounced so we don't hammer the DB on every
     *   keystroke. The debounce timer is re-armed on each state change;
     *   when state settles for 3s, the final draft hits server.
     *   draftSaveTimerRef tracks the in-flight timeout so subsequent
     *   changes can cancel + re-arm cleanly.
     *   Anonymous users (no session) silently skip — server has nothing
     *   to associate the draft with. localStorage still works for them. */
    if (draftSaveTimerRef.current) clearTimeout(draftSaveTimerRef.current);
    draftSaveTimerRef.current = setTimeout(() => {
      upsertDraft(generationMode || 'quick', draft).then(ok => {
        if (ok) {
          // Light log so devs can see syncing is happening; no UI surface
          //   (the toast / status indicator would be too noisy on every
          //   keystroke pause). LibraryPage's Drafts tab is where users
          //   see persistence happened.
          console.debug('[draft] synced to server', generationMode || 'quick');
        }
      });
    }, 3000);
  }, [
    step, selectedCharacterId, transcript, videoType, selectedStyle, styleName, customStylePrompt, outputLanguage, generatedScript,
    renderProgress, finalConceptUrl, characterBoardUrl, isSequel, isRecast, referenceVideoUrl, sequelTitle,
    sourceWorkId, seriesId, parentId, publishComplete,
    segmentCount, renderedSegments, currentSegmentIdx, combinedVideoUrl,
    // §2026-05-24 fei: Free Mode deps
    generationMode, freePrompt, freeAssets, freeSegments, freeDuration, videoRatio, videoResolution, videoModel,
  ]);

  // Reset all wizard state to step 0. Used by both the cancel button (with
  // confirm prompt) and the post-publish "Continue creating" CTA (no prompt
  // since the work has already been published).
  const resetWorkflowState = () => {
    localStorage.removeItem('uvera_story_draft');
    /* §2026-05-25 fei: also delete the server-side row for THIS mode.
     *   resetWorkflowState is called by:
     *     · the cancel ✕ button (user said "discard this work")
     *     · post-publish "Continue creating" CTA (work already shipped)
     *   In both cases, the user is done with the draft. Leaving it on
     *   the server would re-appear next time they open the app on
     *   another device — confusing. Fire-and-forget; failure is fine
     *   since the row would just get UPSERTed away on next save anyway. */
    if (draftSaveTimerRef.current) {
      clearTimeout(draftSaveTimerRef.current);
      draftSaveTimerRef.current = null;
    }
    deleteDraft(generationMode || 'quick').catch(() => { /* logged inside */ });
    setStep(0);
    setSelectedCharacterId('');
    setTranscript('');
    setVideoType('trailer');
    setSelectedStyle('');
    setSelectedStyleName('');
    setCustomStylePrompt('');
    setGeneratedScript(null);
    setRenderProgress(0);
    setFinalConceptUrl(null);
    // §2026-05-25 fei: also clear the sibling character board image
    setCharacterBoardUrl(null);
    setCharacterBoardGenerating(false);
    setFinalVideoUrl(null);
    setInsertedWorkId(null);
    setIsPublishing(false);
    setPublishComplete(false);
    // §2026-05-23 fei: multi-segment reset
    setSegmentCount(1);
    setRenderedSegments([]);
    setCurrentSegmentIdx(0);
    setCombinedVideoUrl(null);
    setIsCombining(false);
    // §2026-05-24 fei: Free Mode reset (so user clicking X on a Free Mode
    //   draft truly resets everything, not just Quick Mode state).
    setFreePrompt('');
    setFreeAssets([]);
    setFreeSegments([]);
    setFreeDuration(5);
  };

  // Global restart (cancel button — guards against accidental data loss)
  const handleRestartWorkflow = () => {
    if (!window.confirm("Discard current work and start a new creation? Your progress will be lost.")) return;
    resetWorkflowState();
  };

  // Check whether the current user has already submitted a Creative Canvas
  // beta request — used to show the right card state without making them
  // re-click and hit a duplicate-key error.
  //
  // 2026-05-09 fixes (reported "Start creating still flashing"):
  //   - Switched supabase.auth.getUser() (NETWORK call to /auth/v1/user)
  //     to getSession() (cache read, zero network). Previous getUser()
  //     fired on every /create mount and caused console CORS errors when
  //     users had Brave Shields / Safari ITP / privacy extensions.
  //   - Deferred until user actually lands on the mode-picker screen
  //     (creationLevel === 'select') — Recast/Continuation flows skip
  //     the picker entirely so they don't need this check.
  //   - Wrapped both calls in .catch so any failure stays out of console.
  const betaCheckedRef = useRef(false);
  useEffect(() => {
    if (creationLevel !== 'select' || isSequel || isRecast) return;
    if (betaCheckedRef.current) return;
    let cancelled = false;
    (async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (cancelled || !session?.user) return;
        betaCheckedRef.current = true;
        const { data: rows, error } = await supabase
          .from('beta_requests')
          .select('id')
          .eq('user_id', session.user.id)
          .eq('feature', 'creative_canvas')
          .limit(1);
        if (cancelled || error) return;
        if (rows && rows.length > 0) setCreativeCanvasRequested(true);
      } catch {
        // Network blocked / extension intercepted — UI just shows the
        // default "Request access" state. User can still click it; the
        // server-side dedup will handle the duplicate gracefully.
      }
    })();
    return () => { cancelled = true; };
  }, [creationLevel, isSequel, isRecast]);

  // ── Atomic asset-tag protection in the Free Mode prompt textarea ────────
  // Tags inserted via the asset picker live as a single unit `[@Image1: …]`.
  // These two handlers refuse to let users break them: backspace/delete near
  // a tag removes the whole tag, and typing or pasting inside a tag is a
  // no-op. Combined, this gives near-contenteditable atomic-tag behavior
  // without rewriting the textarea into a contenteditable div.

  const findAssetTagAt = (text, pos) => {
    ASSET_TAG_PATTERN.lastIndex = 0;
    let m;
    while ((m = ASSET_TAG_PATTERN.exec(text)) !== null) {
      const start = m.index;
      const end = start + m[0].length;
      if (pos > start && pos < end) return { start, end, text: m[0], inside: true };
      if (pos === end) return { start, end, text: m[0], atRightEdge: true };
      if (pos === start) return { start, end, text: m[0], atLeftEdge: true };
    }
    return null;
  };

  const handleFreePromptKeyDown = (e) => {
    if (e.key !== 'Backspace' && e.key !== 'Delete') return;
    const ta = e.currentTarget;
    if (ta.selectionStart !== ta.selectionEnd) return; // user has a selection — let normal delete work

    const cursor = ta.selectionStart;
    const text = ta.value;
    const hit = findAssetTagAt(text, cursor);
    if (!hit) return;

    // Only swallow the keystroke when the cursor is touching the tag in a
    // way that would otherwise damage it.
    const isBackspaceTouching = e.key === 'Backspace' && (hit.inside || hit.atRightEdge);
    const isDeleteTouching    = e.key === 'Delete'    && (hit.inside || hit.atLeftEdge);
    if (!isBackspaceTouching && !isDeleteTouching) return;

    e.preventDefault();
    const newText = text.slice(0, hit.start) + text.slice(hit.end);
    setFreePrompt(newText);
    if (isPromptOptimized) setIsPromptOptimized(false);
    setTimeout(() => {
      ta.focus();
      ta.setSelectionRange(hit.start, hit.start);
    }, 0);
  };

  const handleFreePromptBeforeInput = (e) => {
    const ta = e.currentTarget;
    if (ta.selectionStart !== ta.selectionEnd) return;
    const hit = findAssetTagAt(ta.value, ta.selectionStart);
    if (hit && hit.inside) e.preventDefault();
  };

  const handleRequestCreativeCanvas = async () => {
    if (creativeCanvasRequested || isRequestingBeta) return;
    setIsRequestingBeta(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        alert('Please sign in first to request access.');
        return;
      }
      const { error } = await supabase
        .from('beta_requests')
        .insert({ user_id: user.id, feature: 'creative_canvas' });
      if (error) {
        // Postgres unique-violation code; user already has a pending request.
        if (error.code === '23505') {
          setCreativeCanvasRequested(true);
          alert("You've already requested access. We'll reach out when Creative Canvas is ready.");
          return;
        }
        throw error;
      }
      setCreativeCanvasRequested(true);
      alert('Request submitted — thanks! We\'ll email you when Creative Canvas is open for testing.');
    } catch (err) {
      alert(formatError(err, 'Could not submit your request.'));
    } finally {
      setIsRequestingBeta(false);
    }
  };

  // Sanitize a photo_url at the source — fixes any wlpaas.weilitech.cn domain in-memory
  const sanitizePhotoUrl = (url) => {
    if (!url) return url;
    try {
      const u = new URL(url);
      if (u.hostname === 'wlpaas.weilitech.cn') {
        u.hostname = 'asset.uvera.ai';
        u.protocol = 'https:';
      }
      return u.toString();
    } catch {
      return url.replace(/wlpaas\.weilitech\.cn/g, 'asset.uvera.ai');
    }
  };

  // Fetch Characters lazily — only when user enters a flow that actually
  // uses character data. The /create landing page is a 3-mode picker
  // (Quick / Free / Upload Video) that doesn't need any user data; firing
  // a Supabase request on mount was wasteful + surfaced spurious console
  // CORS errors to users with privacy extensions / strict ITP since
  // there's nothing for the page to actually do with the data yet.
  //
  // Trigger now: when creationLevel transitions away from 'select', OR
  // when we're in a continuation/recast flow (those need the original
  // character to be loaded immediately for auto-script generation), OR
  // when Free Mode opens its asset picker. Guard with a ref so we only
  // fetch once per page mount even if creationLevel toggles.
  const charactersFetchedRef = useRef(false);
  useEffect(() => {
    const needsCharacters =
      creationLevel === 'quick' ||
      creationLevel === 'series' ||
      isSequel ||
      isRecast ||
      generationMode === 'free';
    if (!needsCharacters) return;
    if (charactersFetchedRef.current) return;
    charactersFetchedRef.current = true;

    async function fetchCharacters() {
      setIsLoadingCharacters(true);
      try {
        const { data: { session } } = await supabase.auth.getSession();
        const normalize = (rows) => (rows || []).map(c => ({ ...c, photo_url: sanitizePhotoUrl(c.photo_url) }));
        if (!session) {
          const { data } = await supabase.from('characters').select('*').order('createdAt', { ascending: false });
          setCharacters(normalize(data));
        } else {
          setUserTier(session.user?.user_metadata?.tier || 'free');
          const { data } = await supabase.from('characters').select('*').eq('user_id', session.user.id).order('createdAt', { ascending: false });
          setCharacters(normalize(data));
        }
      } catch (err) {
        console.error('Error fetching characters:', err);
        // Reset ref so a manual retry (e.g. user switches mode away+back)
        // can re-attempt once the network / extension settles.
        charactersFetchedRef.current = false;
      } finally {
        setIsLoadingCharacters(false);
      }
    }
    fetchCharacters();
  }, [creationLevel, generationMode, isSequel, isRecast]);

  // Effect to check for pending video tasks on page load (recover from reload/navigation).
  // 24h TTL: stale tasks (browser crashed yesterday, etc.) are dropped — Volcengine
  // tasks already expire after a few hours, so recovering anything older just wastes
  // a poll cycle and shows the user a confusing "rendering…" forever.
  // Tick the elapsed counter while a video render is in flight so the user
  // gets visible feedback during the 30s-3min wait.
  useEffect(() => {
    if (renderProgress === 3 && renderStartedAt) {
      setRenderElapsedSec(Math.floor((Date.now() - renderStartedAt) / 1000));
      const id = setInterval(() => {
        setRenderElapsedSec(Math.floor((Date.now() - renderStartedAt) / 1000));
      }, 1000);
      return () => clearInterval(id);
    } else if (renderProgress > 3) {
      // Render finished — freeze the elapsed display
    } else {
      setRenderElapsedSec(0);
    }
  }, [renderProgress, renderStartedAt]);

  useEffect(() => {
    // §2026-05-23 fei: reduced TTL 24h → 30 min.
    //   Reason: legit Seedance tasks complete in 3-5 min; anything older
    //   than 30 min is almost certainly stale (task already done OR Seedance
    //   discarded it). Auto-polling a stale taskId tends to 503 the worker,
    //   which surfaces as "Failed to load resource: 503 (Offline)" in
    //   console and an alert() on the user. Better to silently drop.
    const STALE_TASK_TTL_MS = 30 * 60 * 1000;
    const pendingJson = localStorage.getItem('uvera_pending_video_task');
    if (!pendingJson) return;
    try {
      const pendingMsg = JSON.parse(pendingJson);
      const age = pendingMsg?.timestamp ? Date.now() - pendingMsg.timestamp : Infinity;
      if (!pendingMsg?.taskId || age > STALE_TASK_TTL_MS) {
        console.warn(`[recovery] Dropping stale pending task (age ${Math.round(age / 60_000)}m)`);
        localStorage.removeItem('uvera_pending_video_task');
        return;
      }
      setGeneratedScript(pendingMsg.generatedScript || {});
      setFinalConceptUrl(pendingMsg.finalConceptUrl || null);
      setStep(3);
      setRenderProgress(3);
      // Resume the elapsed-time meter from the original render start
      setRenderStartedAt(pendingMsg.timestamp || Date.now());
      resumeVideoPolling(pendingMsg.taskId, pendingMsg.generatedScript, pendingMsg.finalConceptUrl);
    } catch (e) {
      console.error('Failed to parse pending task', e);
      localStorage.removeItem('uvera_pending_video_task');
    }
  }, []);

  const clearPendingTask = () => {
    localStorage.removeItem('uvera_pending_video_task');
  };


  /* ── STEP PROGRESSIONS ── */
  const handleNextToIdea = () => {
    if (!selectedCharacterId) return;
    if (isRecast || isSequel) {
      setStep(3);
      handleGenerateScript(true);
      return;
    }
    setStep(1);
  };

  // §2026-05-23 fei: AI-expand a short character hint into 5 structured fields.
  //   Calls /api/expand-character-seed (Gemini). On success, fills the
  //   characterSeed state which is then sent to /api/generate-storyboard.
  //   On failure, surfaces an error message so user can edit fields manually.
  const handleExpandCharacterSeed = async () => {
    const hint = (characterSeedHint || '').trim();
    if (!hint || isExpandingSeed) return;
    setIsExpandingSeed(true);
    setSeedExpandError('');
    try {
      const expanded = await expandCharacterSeed(hint, {
        videoType,
        styleName,
      });
      if (!expanded) {
        setSeedExpandError('AI expand failed — please fill the fields manually below.');
        return;
      }
      setCharacterSeed({
        name:         expanded.name         || '',
        seed:         expanded.seed         || '',
        ageBody:      expanded.ageBody      || '',
        visualMedium: expanded.visualMedium || '',
        style:        expanded.style        || '',
        otherDetails: expanded.otherDetails || '',
      });
      setShowCharacterSeedPanel(true);  // auto-expand the panel so user sees the result
    } catch (err) {
      setSeedExpandError(err.message || 'AI expand failed.');
    } finally {
      setIsExpandingSeed(false);
    }
  };

  const handleNextToStyle = () => {
    if (!transcript.trim()) return;
    setStep(2);
  };

  const handleGenerateScript = async (isAuto = false) => {
    if (!isAuto && !selectedStyle) return;

    // §2026-05-22 fei: per-Avatar Character quota check deleted along with
    //   the AI-generated-Character concept. Storyboards are now a per-gen
    //   artifact (lives in recommended_content), not a saved Character row,
    //   so there's nothing to quota-gate at script-gen time. Actor count
    //   itself is still gated (Library actor-create flow); that's unchanged.

    if (!isAuto) setStep(3);
    setScriptGenError(null);
    setIsGeneratingScript(true);

    try {
      const targetStyle = selectedStyle || 'cinematic-photorealistic';
      
      /* §2026-05-27 fei — language resolution order:
       *   1. outputLanguage state (user-picked override)  ← if set, win
       *   2. detectInputLanguage(transcript) (auto detect)  ← default
       *
       *   Auto detection covers the common case (Chinese/Japanese/Korean
       *   inputs get matching script output). User picks override when
       *   detection misfires (e.g. English + Chinese name mixed input
       *   triggering Chinese; or wanting English output from a Chinese
       *   transcript). UI: pill next to "Next: Summon AI" button on
       *   step 2 (style picker). */
      const detectedLanguage = outputLanguage || detectInputLanguage(transcript);

      // §2026-06-04 — script generation ALWAYS goes through our own worker
      //   endpoint /api/generate-multi-segment-script (Gemini, prompt we fully
      //   control). The legacy external `aiscreenwriter` Edge Function
      //   (functions5.memfiredb.com / dev.neodomain.cn) has been removed
      //   entirely — UVERA no longer depends on any third-party screenwriter
      //   backend.
      //
      //   The worker handles BOTH single-segment (segmentCount === 1, the
      //   default) and multi-segment stories: it clamps segmentCount to [1,5],
      //   picks shot density by videoType (richer for single-segment — see
      //   SINGLE_SEG_SHOTS in _worker.js), and writes its own language /
      //   pacing / structure guidance, so the raw transcript is passed
      //   straight through (no client-side prompt augmentation needed).
      //
      //   Actor identity contract (enforced server-side in the system prompt):
      //     - The Actor IS the protagonist of every scene. ALWAYS.
      //     - The transcript describes the SCENE the protagonist appears in.
      //     - A transcript-implied character whose demographics DON'T match the
      //       actor becomes an NPC (supporting_characters[]); the actor stays
      //       protagonist. If they match → the actor plays that role.
      const activeCharForScript = characters.find(c => c.id === selectedCharacterId);
      const styleObj = STYLES.find(s => s.id === targetStyle);

      const result = await generateMultiSegmentScript({
        transcript,                                              // raw user transcript
        videoType: videoType || 'trailer',
        segmentCount,
        style: styleObj ? { id: styleObj.id, name: styleObj.name, prompt: styleObj.prompt } : { id: targetStyle, name: styleName, prompt: '' },
        character: activeCharForScript ? {
          name:        activeCharForScript.name || null,
          description: activeCharForScript.identity_features || null,
        } : null,
        // characterSeed kept null — user-typed character seed UI is being
        //   phased out in favor of actor + protagonist field flowing from
        //   the screenwriter. If a user has a seed, the worker still accepts it
        //   but it no longer overrides the actor identity contract.
        characterSeed: null,
        language: detectedLanguage,
      });

      const normalized = normalizeMultiSegmentScript(result, segmentCount);
      normalized._scriptSource = 'multi-segment-worker';
      setGeneratedScript(normalized);
      // Reset segment-render state for the new script
      setRenderedSegments([]);
      setCurrentSegmentIdx(0);
      setCombinedVideoUrl(null);
    } catch (err) {
      console.error(err);
      // §2026-06-05 — 不再用 blocking alert + 回弹 step2(失败后会渲染成 `: null`
      //   空白 → 卡死/死循环)。改为记录错误态,停在 step 3 显示「失败 + 重试/改提示」
      //   卡片,用户可受控重试(等后端 BUG-006 恢复)或回去改提示。
      setScriptGenError(formatError(err, 'Script generation failed.'));
      if (!isAuto) setStep(3);
    } finally {
      setIsGeneratingScript(false);
    }
  };


  // §2026-05-22 fei round-2: pendingRenderConfirm no longer SNAPSHOTS cost
  //   at open time. Cost was wrong if user opened modal → entered render
  //   station → changed resolution there → price was already locked at the
  //   old resolution. Now the modal embeds the resolution + model selectors
  //   itself; cost is computed REACTIVELY from current videoResolution
  //   inside the modal. Confirm uses the live state. Render station's
  //   selectors are locked / read-only since price is fixed at confirm.
  //
  //   pendingRenderConfirm is now just { kind: 'entry' | 'regenerate' }.

  const handleRequestRenderEntry = () => {
    // Credits check uses current videoResolution. If user changes resolution
    //   inside the modal, the modal does its own real-time validation.
    const storyboardCost = STORYBOARD_TOKEN_COST;
    const cost = storyboardCost + quickModeVideoCost;
    if (credits < cost) {
      setTokenAlert({
        required: cost,
        current: credits,
        context: `storyboard + ${(generatedScript?.totalDuration) || 5}s ${videoResolution} video`,
      });
      return;
    }
    setPendingRenderConfirm({ kind: 'entry' });
  };

  const handleRequestRegenerateStoryboard = () => {
    const storyboardCost = STORYBOARD_TOKEN_COST;
    if (credits < storyboardCost) {
      setTokenAlert({
        required: storyboardCost,
        current: credits,
        context: 'storyboard regeneration',
      });
      return;
    }
    setPendingRenderConfirm({ kind: 'regenerate' });
  };

  const runConfirmedRenderEntry = async () => {
    const confirmInfo = pendingRenderConfirm;
    if (!confirmInfo) return;
    // Compute cost from current live state at the moment of confirm.
    //   For 'entry': storyboard + video (live videoResolution × duration).
    //   For 'regenerate': storyboard only.
    const cost = confirmInfo.kind === 'regenerate'
      ? STORYBOARD_TOKEN_COST
      : STORYBOARD_TOKEN_COST + quickModeVideoCost;
    // Double-check credits — modal's resolution selector could have nudged
    //   the cost above what handleRequestRenderEntry checked. If so, bail
    //   out and show tokenAlert instead of silently failing the deduct.
    if (credits < cost) {
      setPendingRenderConfirm(null);
      setTokenAlert({
        required: cost,
        current: credits,
        context: confirmInfo.kind === 'entry'
          ? `storyboard + ${(generatedScript?.totalDuration) || 5}s ${videoResolution} video`
          : 'storyboard regeneration',
      });
      return;
    }
    setPendingRenderConfirm(null);
    try {
      // §2026-05-29 — no client-side deduct. The pipeline's generation
      //   endpoints (generate-storyboard, volcengine/video/submit) charge
      //   server-side atomically and refund themselves on failure. We only
      //   prechecked above; the server is authoritative.
      await handleNextToRender();
      // Refresh balance from the authoritative source (user_credits table).
      try { const { credits: bal } = await getUserProfile(); if (typeof bal === 'number') setCredits(bal); } catch { /* non-fatal */ }
    } catch (err) {
      console.error(`Render ${confirmInfo.kind} failed:`, err);
      // Reconcile balance — server already refunded its own charge on
      //   failure; just re-read the truth.
      try { const { credits: bal } = await getUserProfile(); if (typeof bal === 'number') setCredits(bal); } catch { /* non-fatal */ }
      if (err?.status === 402 || err?.insufficient) {
        setTokenAlert({
          required: err.required ?? cost,
          current: err.current ?? credits,
          context: confirmInfo.kind === 'entry'
            ? `storyboard + ${(generatedScript?.totalDuration) || 5}s ${videoResolution} video`
            : 'storyboard regeneration',
        });
        return;
      }
      alert(formatError(err, confirmInfo.kind === 'entry' ? 'Failed to enter render station.' : 'Storyboard regeneration failed.'));
    }
  };

  const handleNextToRender = async () => {
    setStep(4);

    try {
      // 1. Concept Art
      setRenderProgress(1);
      
      if (isSequel) {
        console.log('[ConceptGen] Bypassed for Continuation');
        setRenderProgress(1.5);
        return;
      }

      const activeChar = characters.find(c => c.id === selectedCharacterId);
      // Use the character's photo_url as reference — do NOT strip query params (breaks signed URLs)
      const rawPhotoUrl = activeChar?.photo_url;
      let cleanPhotoUrl = rawPhotoUrl
        ? rawPhotoUrl.replace('wlpaas.weilitech.cn', 'asset.uvera.ai')
        : null;

      // §2026-05-30 fei Bug 4 — sessionId groups all generation_logs rows from
      //   this one Quick Mode render (character board + storyboard + N video
      //   segments). Admin can aggregate by render_session_id to see one-render
      //   total cost/credits at a glance instead of stitching rows by user/time.
      //   crypto.randomUUID is supported in all modern browsers we target.
      const renderSessionId = (typeof crypto !== 'undefined' && crypto.randomUUID)
        ? crypto.randomUUID()
        : `rs_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
      setCurrentRenderSessionId(renderSessionId);

      console.log(`[ConceptGen] Character: "${activeChar?.name || activeChar?.id}" | Reference photo: ${cleanPhotoUrl || '(none — no photo_url on this character)'} | Protagonist: ${generatedScript?.protagonist?.name || '(none)'} (${generatedScript?.protagonist?.age || '?'} ${generatedScript?.protagonist?.gender || '?'}) | Session: ${renderSessionId}`);

      /* §2026-05-30 fei round-2 — actor-as-protagonist pipeline.
       *
       *   Image pipeline is sequential: character board first, storyboard
       *   second (storyboard uses character board as authoritative reference).
       *   The Actor photo is the canonical face reference — no demographic
       *   matching needed because the screenwriter has already set the
       *   protagonist's identity to reflect the Actor.
       *
       *   Pipeline:
       *     1. character board ← protagonist (Actor identity) + photo as face ref
       *     2. storyboard ← protagonist + characterBoardUrl as reference
       *     3. Seedance ← [characterBoardUrl, storyboardUrl] (unchanged)
       *
       *   Trade-off: doubles user wait time (~30s → ~60s) vs the old
       *   parallel-but-disconnected approach. Worth it: step 2 now actually
       *   uses step 1's output, so the protagonist looks consistent across
       *   both images and the final video.
       *
       *   Sequel mode skips both: reference is the previous video's last
       *   frame, character identity follows from it, no board needed. */

      const protagonist = generatedScript?.protagonist || null;

      // Step 1: generate the CHARACTER IDENTITY BOARD.
      //   Soft-fail: if this errors, the storyboard step degrades gracefully
      //   to using the raw Actor photo (or no reference) — degraded but the
      //   user still gets a video. characterBoardUrl stays null in that case.
      let resolvedCharacterBoardUrl = null;
      if (!isSequel) {
        setCharacterBoardGenerating(true);
        try {
          const boardRes = await generateCharacterBoard({
            styleId: selectedStyle,
            styleName,
            customStylePrompt: selectedStyle === 'custom' ? customStylePrompt : null,
            protagonist,                                            // canonical character identity
            // §2026-05-31 round-3 — prefer the user's actual Actor name
            //   over the LLM-invented protagonist.name (the screenwriter
            //   was generating "Maya" / etc and the character board
            //   hand-lettered it onto the user's own avatar). Also pass
            //   Vision-extracted facial description so GPT-image-2 has
            //   concrete photo-side anchors, not just abstract age/gender.
            characterName: activeChar?.name || protagonist?.name || null,
            characterDescription: activeChar?.identity_features || null,
            sourceImageUrl: cleanPhotoUrl,                          // Actor photo — always used as face ref when available
            renderSessionId,                                        // §2026-05-30 Bug 4 — admin cost aggregation
          });
          if (boardRes?.imageUrl) {
            resolvedCharacterBoardUrl = boardRes.imageUrl;
            setCharacterBoardUrl(boardRes.imageUrl);
          }
          if (boardRes?.safetyFallbackTriggered) {
            console.warn('[character-board] safety fallback fired — reason=' + boardRes.safetyFallbackReason);
          }
        } catch (err) {
          // Degrade-not-block: storyboard step will fall back to using the
          //   raw Actor photo (or nothing) as reference.
          console.warn('[character-board] generation failed (degrading to photo-ref):', err?.message || err);
        } finally {
          setCharacterBoardGenerating(false);
        }
      }

      // Step 2: generate the STORYBOARD using the character board (or
      //   raw Actor photo as fallback) as the reference image.
      const conceptRes = await generateConceptDesign({
        styleId: selectedStyle,
        styleName,
        customStylePrompt: selectedStyle === 'custom' ? customStylePrompt : null,
        mood: generatedScript.mood,
        summary: generatedScript.summary,
        shots: generatedScript.shots || [],
        videoType,
        characterId: selectedCharacterId,
        characterName: protagonist?.name || activeChar?.name || null,
        // §2026-05-30 fei — characterDescription / characterSeed are no
        //   longer the canonical character source. Pass null so the worker
        //   uses protagonist exclusively. (Legacy fields kept in the API
        //   call signature for back-compat with older cached bundles.)
        characterDescription: null,
        characterSeed: null,
        protagonist,                                                // §2026-05-30 canonical input
        // §2026-05-31 round-4 — supporting characters that appear in the
        //   story alongside the protagonist. Empty when Actor naturally
        //   fits the lead role. Used by storyboard to draw NPCs visibly.
        supportingCharacters: generatedScript?.supporting_characters || [],
        // §2026-05-30 fei — character board (if generated) is now the
        //   authoritative reference for the storyboard. Raw Actor photo
        //   is the legacy fallback only when board gen failed.
        characterBoardUrl: resolvedCharacterBoardUrl,
        sourceImageUrl: cleanPhotoUrl,
        // Sequel mode: pass the previous video's last frame as the
        // character/style anchor for continuity.
        referenceImageUrl: (isSequel && referenceVideoUrl) ? referenceVideoUrl : null,
        renderSessionId,                                            // §2026-05-30 Bug 4
      });
      const generatedConceptUrl = conceptRes?.image_urls?.[0];
      if (!generatedConceptUrl) throw new Error("API did not return a valid concept image URL");

      setFinalConceptUrl(generatedConceptUrl);

      // §2026-05-22 — surface OpenAI safety-fallback as a non-blocking
      //   notice. Happens when the reference photo (sequel anchor or
      //   character upload) contained a real-person likeness OpenAI's
      //   moderation rejected. We auto-fell-back to text-only gen so the
      //   user still gets a video, but continuity is reduced — tell them
      //   so they're not surprised when the character looks different.
      if (conceptRes?.safetyFallbackTriggered) {
        const reasonMap = {
          openai_safety_filter: 'OpenAI rejected the reference photo (real-person likeness in the source image). We generated the storyboard from the script alone — character may not perfectly match your reference.',
          openai_prompt_moderation: 'OpenAI flagged some script content as sensitive (violence, real names, mature themes). We rendered a generic key visual based on style + character + mood, without the specific story beats.',
          reference_fetch_failed_403: 'Reference photo URL was inaccessible (403). We generated from the script alone.',
          reference_fetch_failed_404: 'Reference photo URL was not found (404). We generated from the script alone.',
        };
        const msg = reasonMap[conceptRes.safetyFallbackReason] ||
          `Reference photo could not be used (${conceptRes.safetyFallbackReason}). Storyboard was generated from the script alone.`;
        // Non-blocking — toast-style alert. User can still proceed to video.
        try { alert('Heads up: ' + msg); } catch (_) {}
      }

      // §2026-05-22 fei: previously we INSERTed a Character row with
      //   identity_features.createdVia='generated_concept' into the
      //   characters table every time a storyboard was generated. That
      //   created the per-Avatar Character quota problem ("9/8 Characters,
      //   upgrade to Studio") and the awkward Library drill-down view.
      //   Deleted. Storyboard images live only in recommended_content.video
      //   (saved after the video render in resumeVideoPolling), which is
      //   the right granularity — one storyboard per gen run, not a
      //   permanent reusable Character.

      // Pause here for user to review the image
      setRenderProgress(1.5);
    } catch (err) {
      console.error('Render pipeline error:', err);
      // §2026-05-25 fei — inline banner; user returns to Step 3 review.
      setRenderError({
        title: '渲染管线失败',
        message: formatError(err, '已回到剧本审阅页,可点击 Render Station 重试。'),
      });
      setRenderProgress(0);
      setStep(3); // Go back on error
    }
  };

  const handleGenerateVideo = async () => {
    // §2026-05-29 — charging is now SERVER-SIDE. generateVolcengineVideo
    //   POSTs /api/volcengine/video/submit, which atomically spends the
    //   video cost (and self-refunds on task failure via video/status).
    //   No client-side deduct here; we refresh balance from user_credits
    //   after submit and surface 402 as the paywall.
    try {
      // 2. Review Phase
      setRenderProgress(2);
      await new Promise(r => setTimeout(r, 2000)); // Mocking the Ark review for now
      
      // 3. Video Render
      setRenderProgress(3);
      setRenderStartedAt(Date.now());

      // §2026-05-21: prompt construction depends on which image-gen
      // pipeline produced finalConceptUrl. The storyboard pipeline puts
      // ALL story context (dialogue/narration/style/character) into the
      // GPT-image-2 prompt, so the resulting image IS the storytelling.
      // Seedance then needs only minimal motion guidance — long prompts
      // here would just fight the visual signal that's already baked in.
      //
      // §2026-05-22 round-5 (fei: "更丰富的运镜，满足 MV / 文艺片 / 产品宣传"):
      //   Hardcoded "subtle organic motion" was producing barely-moving
      //   videos regardless of genre. Now Seedance gets genre-aware motion
      //   guidance — same storyboard image, different motion energy.
      //   The image-as-storytelling principle still holds (no verbose
      //   script paste-through), but motion language varies by videoType.
      const SEEDANCE_MOTION_PRESETS = {
        'trailer':     'Animate this scene with dramatic build-up motion: subtle camera push-in toward the subject, climactic energy rising, cinematic ambient sound and impactful low-end music cue.',
        'mv':          'Animate this scene with rhythmic dynamic motion: noticeable camera movement (push-in, lateral tracking, or arc), character motion has musical beat, ambient music-video atmosphere, energetic sound design.',
        'short-drama': 'Animate this scene with purposeful narrative motion: slow dolly or pan following the character\'s emotional beat, breathing pacing, dialogue-aware ambient sound and subtle music undertone.',
        'vlog':        'Animate this scene with handheld natural motion: gentle camera sway as if held, candid subject movement, ambient real-world sound, no overdone effects.',
        'art-film':    'Animate this scene with meditative slow motion: extremely subtle camera drift or static long-take feel, time-stretched contemplative pacing, atmospheric ambient sound with sparse music.',
        'product':     'Animate this scene with clean commercial motion: smooth orbital or parallax camera around the product, controlled studio movement, polished ambient sound, no shake.',
      };
      let finalPrompt = SEEDANCE_MOTION_PRESETS[videoType]
        || SEEDANCE_MOTION_PRESETS['trailer'];

      /* §2026-05-26 fei — Quick Mode single-segment legacy path: same
       *   multi-reference treatment as renderSegmentVideo. Send character
       *   board + storyboard so Seedance respects the chosen art style.
       *   Sequel path keeps videoUrl as the only reference (no images). */
      const legacyRefImages = isSequel
        ? []
        : [characterBoardUrl, finalConceptUrl].filter(Boolean);
      const legacyHasCharBoard = !isSequel && !!characterBoardUrl;
      const legacyStyleHint = (customStylePrompt && customStylePrompt.trim()) || styleName || null;
      if (legacyHasCharBoard || legacyStyleHint) {
        // Augment the bare motion preset with reference + style guidance so
        // the model knows what Image 1 vs Image 2 means + which aesthetic.
        const refsHint = legacyHasCharBoard
          ? `You receive TWO references: Image 1 = CHARACTER IDENTITY BOARD (use for face/costume/proportions/art style — authoritative); Image 2 = storyboard (use for scene composition only). Match Image 1's aesthetic for every frame. `
          : '';
        const styleLine = legacyStyleHint ? `Art style direction: ${legacyStyleHint}. ` : '';
        // §2026-05-30 fei — protagonist reinforcement: when the screenwriter
        //   produced a protagonist object, restate the key identity facts
        //   here so Seedance has both visual (Image 1) AND textual anchors
        //   for who shows up on screen.
        const prot = generatedScript?.protagonist || null;
        const protagonistLock = (legacyHasCharBoard && prot)
          ? `The protagonist's age (${prot.age || 'unspecified'}), gender (${prot.gender || 'unspecified'})${prot.role ? `, social role (${prot.role})` : ''}${prot.outfit ? `, and outfit (${prot.outfit})` : ''} are FINALIZED in Image 1 — the protagonist must look like the person in Image 1. `
          : '';
        // §2026-05-31 round-4 — supporting characters block for single-segment
        //   legacy path. Same as multi-segment buildSeedancePromptForSegment.
        const legacySupports = Array.isArray(generatedScript?.supporting_characters)
          ? generatedScript.supporting_characters
          : [];
        const supportLock = legacySupports.length > 0
          ? 'ADDITIONAL CHARACTERS (visually distinct from the protagonist, must also appear on screen): ' +
            legacySupports.map((c, i) => {
              const bits = [];
              if (c.name)       bits.push(c.name);
              if (c.age)        bits.push(c.age);
              if (c.gender && c.gender !== 'unspecified') bits.push(c.gender);
              if (c.appearance) bits.push(c.appearance);
              if (c.outfit)     bits.push(`wearing ${c.outfit}`);
              return `(${i + 1}) ${bits.filter(Boolean).join(', ')}`;
            }).join(' ') + '. '
          : '';
        finalPrompt = refsHint + protagonistLock + supportLock + styleLine + finalPrompt;
      }

      const taskId = await generateVolcengineVideo({
        prompt: finalPrompt,
        imageUrl: isSequel ? null : (legacyRefImages[0] || finalConceptUrl),
        imageUrls: isSequel ? null : (legacyRefImages.length > 0 ? legacyRefImages : null),
        videoUrl: isSequel ? referenceVideoUrl : null,
        duration: generatedScript.totalDuration || 5,
        ratio: '16:9',
        resolution: videoResolution,
        model: videoModel,
        generateAudio: true,
        watermark: tier === 'free',
        renderSessionId: currentRenderSessionId,                    // §2026-05-30 Bug 4
      });

      // Refresh balance from the authoritative source after the server charge.
      try { const { credits: bal } = await getUserProfile(); if (typeof bal === 'number') setCredits(bal); } catch { /* non-fatal */ }

      // Write task backup to localStorage guard
      localStorage.setItem('uvera_pending_video_task', JSON.stringify({
        taskId,
        generatedScript,
        finalConceptUrl,
        timestamp: Date.now()
      }));

      // Non-blocking handoff to the resilient polling function
      resumeVideoPolling(taskId, generatedScript, finalConceptUrl);

    } catch (err) {
      console.error('Render pipeline error:', err);
      // Server already refunded its own charge on failure; re-read truth.
      try { const { credits: bal } = await getUserProfile(); if (typeof bal === 'number') setCredits(bal); } catch { /* non-fatal */ }
      if (err?.status === 402 || err?.insufficient) {
        setTokenAlert({
          required: err.required ?? quickModeVideoCost,
          current: err.current ?? credits,
          context: `${generatedScript?.totalDuration || 5}s ${videoResolution} video`,
        });
        setRenderProgress(1.5);
        clearPendingTask();
        return;
      }
      // §2026-05-25 fei — inline banner instead of alert.
      // §2026-06-06 fei — 提交失败且已退款 → 三语「积分已返还」置顶
      setRenderError({
        title: t('videoFailTitle'),
        message: (err?.refunded ? t('creditsRefunded') + '\n\n' : '') + formatError(err, '请检查参考素材后再点 Generate。'),
        retry: () => { setRenderError(null); handleGenerateVideo(); },
      });
      setRenderProgress(1.5); // Go back to image confirmation on video error
      clearPendingTask();
    }
  };

  /* §2026-05-25 fei: detect BytePlus's "output audio may contain sensitive
   *   information" error. Fires AFTER Seedance has already rendered the
   *   video — their downstream audio safety filter rejects the audio track.
   *   The video itself is fine; only the audio synth output is the problem.
   *
   *   Recovery: retry with generateAudio=false → user gets silent video.
   */
  const isAudioBlockedError = (errMsg) => {
    if (!errMsg) return false;
    return /output audio.*sensitive|audio.*sensitive information/i.test(errMsg);
  };

  /* §2026-05-23 fei: per-segment video render for multi-segment stories.
   *
   *   How it works:
   *     · ONE storyboard image (finalConceptUrl) is generated upfront in
   *       handleNextToRender — it contains ALL shots across all segments
   *       in a multi-panel grid.
   *     · Each segment is rendered independently:
   *         - Same reference image: finalConceptUrl (the big storyboard)
   *         - Different prompt: targets that segment's shot range
   *         - Different duration: per-segment targetDurationSec (10-15s)
   *     · User clicks "Render Segment N" → costs are charged per segment.
   *     · State tracked in renderedSegments[]; each item:
   *         { idx, status: 'pending'|'rendering'|'ready'|'failed',
   *           videoUrl, taskId, durationSec, error }
   */
  const SEEDANCE_MOTION_PRESETS_MULTI = {
    'trailer':     'dramatic build-up motion, subtle push-in, climactic energy rising, cinematic ambient sound',
    'mv':          'rhythmic dynamic motion, noticeable camera movement (push-in, lateral tracking, or arc), musical beat',
    'short-drama': 'purposeful narrative motion, slow dolly or pan following the emotional beat, breathing pacing',
    'vlog':        'handheld natural motion, gentle camera sway, candid subject movement',
    'art-film':    'meditative slow motion, extremely subtle camera drift, time-stretched contemplative pacing',
    'product':     'clean commercial motion, smooth orbital or parallax camera, controlled studio movement',
  };

  /* §2026-05-26 fei — Seedance prompt rewritten to explicitly reference
   *   BOTH the character identity board AND the storyboard sheet, plus
   *   the user-chosen art style. Previous prompt only said "Maintain
   *   character identity and visual style consistent with the storyboard
   *   reference" — but the storyboard is a rough hand-drawn multi-panel
   *   sketch, NOT the source of truth for character look or art style.
   *   Result: rendered videos had inconsistent character faces / outfits
   *   and reverted to Seedance's default photoreal aesthetic, ignoring
   *   the chosen style (anime / 3D / paper cut / etc.).
   *
   *   New prompt structure (matches the 2 reference images we now send):
   *     · Image 1 (FIRST in attachment array): character identity board —
   *       face, costume, proportion model sheet in the chosen art style.
   *       Authoritative source for who-the-character-is + art aesthetic.
   *     · Image 2 (SECOND): storyboard sheet — rough multi-panel sketch.
   *       Authoritative source for scene composition + action beats only.
   *
   *   Style line: pulled from styleName / customStylePrompt so Seedance
   *   knows the explicit aesthetic to enforce, in case it weights text
   *   stronger than image refs for style. */
  const buildSeedancePromptForSegment = (segments, segIdx, vt, opts = {}) => {
    const { hasCharacterBoard = false, styleHint = null, protagonist = null } = opts;
    const totalSegs = segments.length;
    const seg = segments[segIdx];
    const motion = SEEDANCE_MOTION_PRESETS_MULTI[vt] || SEEDANCE_MOTION_PRESETS_MULTI['trailer'];
    if (!seg) return motion;
    const shots = seg.shots || [];
    const firstShotNum = shots[0]?.number || (segIdx * Math.max(1, shots.length) + 1);
    const lastShotNum = shots[shots.length - 1]?.number || (firstShotNum + shots.length - 1);

    const shotLines = shots.map((s, i) => {
      const n = s.number || (firstShotNum + i);
      const parts = [];
      if (s.action) parts.push(s.action);
      if (s.camera) parts.push(`(${s.camera})`);
      return `  Panel ${n}: ${parts.join(' ') || '(no detail)'}`;
    }).join('\n');

    // Reference image preamble — varies depending on whether we have a
    // character board to send alongside the storyboard.
    const refsPreamble = hasCharacterBoard
      ? `You will receive TWO reference images:\n` +
        `  • Image 1 — CHARACTER IDENTITY BOARD. Authoritative reference for ` +
        `the protagonist's face, costume, proportions, AND the overall art ` +
        `style/aesthetic. Match this image precisely for character look and visual style.\n` +
        `  • Image 2 — STORYBOARD SHEET (rough hand-drawn multi-panel sketch). ` +
        `Use ONLY for scene composition, camera angles, and action beats. ` +
        `DO NOT inherit the rough sketch's style or character rendering — that ` +
        `comes from Image 1.\n\n`
      : `You will receive ONE reference image: a storyboard sheet (rough ` +
        `hand-drawn multi-panel sketch). Use it for scene composition + action ` +
        `beats, NOT for final art style.\n\n`;

    const styleLine = styleHint
      ? `\nArt style direction (must enforce, overriding any photoreal default): ${styleHint}.`
      : '';

    // §2026-05-30 fei — protagonist reinforcement (text anchor alongside
    //   Image 1). Restates the identity facts the screenwriter assigned so
    //   Seedance has both visual and textual locks against drift.
    const protagonistLock = (hasCharacterBoard && protagonist)
      ? `\nThe protagonist's age (${protagonist.age || 'unspecified'}), gender (${protagonist.gender || 'unspecified'})${protagonist.role ? `, social role (${protagonist.role})` : ''}${protagonist.outfit ? `, and outfit (${protagonist.outfit})` : ''} are FINALIZED in Image 1. The protagonist must look like the person in Image 1.`
      : '';

    // §2026-05-31 round-4 — supporting characters block. When the script
    //   has supporting_characters[], tell Seedance to render them alongside
    //   the protagonist (Image 1 is the protagonist only — supporting chars
    //   come from text description). Without this, Seedance defaults to
    //   single-character output even when shot.action mentions others.
    const supports = Array.isArray(opts.supportingCharacters) ? opts.supportingCharacters : [];
    const supportingLock = supports.length > 0
      ? '\n\nADDITIONAL CHARACTERS (must also be rendered, distinct from the protagonist):\n' +
        supports.map((c, i) => {
          const bits = [];
          if (c.name)       bits.push(c.name);
          if (c.age)        bits.push(c.age);
          if (c.gender && c.gender !== 'unspecified') bits.push(c.gender);
          if (c.appearance) bits.push(c.appearance);
          if (c.outfit)     bits.push(`wearing ${c.outfit}`);
          if (c.role)       bits.push(`(${c.role})`);
          return `  ${i + 1}. ${bits.filter(Boolean).join(', ')}`;
        }).join('\n') +
        '\nThese characters must be VISIBLY DIFFERENT from the protagonist (different face, age, costume — easy to tell apart). The protagonist (Image 1) is NOT these characters.'
      : '';

    return (
      refsPreamble +
      `Animate segment ${segIdx + 1} of ${totalSegs}.\n` +
      `This segment covers panels ${firstShotNum}-${lastShotNum} of the storyboard.\n` +
      `Scene: ${seg.summary || 'continuation of the story'}.\n` +
      `Shot-by-shot action:\n${shotLines}\n` +
      `Motion direction: ${motion}.` +
      styleLine +
      protagonistLock +
      supportingLock + `\n` +
      (hasCharacterBoard
        ? `Maintain the character identity, costume, AND art style from Image 1 throughout the entire segment — every frame must show the same protagonist as Image 1, in Image 1's aesthetic. Supporting characters (if any, listed above) appear as visually distinct people interacting with the protagonist. `
        : `Maintain character identity and visual style consistent with the storyboard reference. `) +
      `Target duration: ${seg.targetDurationSec || 12} seconds. ` +
      `${segIdx === 0 ? 'Open with immediate visual hook.' : segIdx === totalSegs - 1 ? 'Land the climactic final image.' : 'Continuous escalation from the previous segment.'}`
    );
  };

  // Cost per segment — uses live videoResolution + segment's target duration
  //   §2026-05-25 fei: now also factors model multiplier so Standard model
  //   shows the correct per-segment cost in the multi-segment timeline.
  const costForSegment = (seg) => {
    return computeFreeModeCredits(seg?.targetDurationSec || 12, videoResolution, videoModel);
  };

  const renderSegmentVideo = async (segIdx) => {
    const segments = generatedScript?.segments || [];
    const seg = segments[segIdx];
    if (!seg) {
      alert(`Segment ${segIdx + 1} not found in script.`);
      return;
    }
    if (!finalConceptUrl) {
      alert('Storyboard image not ready yet. Please wait for the storyboard to finish generating.');
      return;
    }

    // Cost + credits check
    const cost = costForSegment(seg);
    if (credits < cost) {
      setTokenAlert({
        required: cost,
        current: credits,
        context: `Segment ${segIdx + 1} · ${seg.targetDurationSec || 12}s ${videoResolution} video`,
      });
      return;
    }

    // Mark this segment as rendering BEFORE the await so UI reflects the click immediately.
    setRenderedSegments(prev => {
      const next = [...prev];
      next[segIdx] = { idx: segIdx, status: 'rendering', videoUrl: null, taskId: null, durationSec: seg.targetDurationSec || 12 };
      return next;
    });
    setCurrentSegmentIdx(segIdx);

    try {
      // §2026-05-29 — no client-side deduct. volcengine/video/submit charges
      //   server-side atomically (and refunds itself if the task fails).

      /* §2026-05-26 fei — assemble reference image array (character board
       *   first, storyboard second). Both are global across segments —
       *   character board defines the look + style, storyboard provides
       *   per-segment composition. Filter Boolean so missing characterBoard
       *   (Phase 1 didn't always generate it) gracefully degrades to single
       *   storyboard ref, matching old behavior. */
      const refImageUrls = [characterBoardUrl, finalConceptUrl].filter(Boolean);
      const hasCharacterBoard = !!characterBoardUrl;

      /* Style hint — pulled from user's selectedStyle + customStylePrompt
       *   so the prompt has an explicit aesthetic anchor, in case Seedance
       *   weights text more than image refs for art style. customStylePrompt
       *   takes priority (user wrote it themselves), styleName fallback for
       *   the preset 9-style picker. */
      const styleHint = (customStylePrompt && customStylePrompt.trim())
        || styleName
        || null;

      // Build segment-specific Seedance prompt with the new multi-ref + style structure
      // §2026-05-30 fei — also thread the protagonist through so the prompt
      //   has explicit text anchors for age/gender/role/outfit (reinforces Image 1).
      // §2026-05-31 round-4 — thread supporting_characters so Seedance renders
      //   multi-character scenes (e.g. Actor + old lady interacting).
      const prompt = buildSeedancePromptForSegment(segments, segIdx, videoType, {
        hasCharacterBoard,
        styleHint,
        protagonist: generatedScript?.protagonist || null,
        supportingCharacters: generatedScript?.supporting_characters || [],
      });

      /* §2026-05-25 fei: try-with-audio → if BytePlus output-audio safety
       *   filter rejects the audio track, auto-retry with audio off so user
       *   gets a silent video instead of a hard failure (no refund + no
       *   asset). Inner closure so the polling loop can be re-entered on
       *   the retry path. */
      const trySubmitAndPoll = async (audioOn) => {
        const taskIdLocal = await generateVolcengineVideo({
          prompt,
          // §2026-05-26 fei — multi-ref path: send both character board +
          //   storyboard. Worker iterates imageUrls and pushes one image_url
          //   content entry per URL with role='reference_image'. If BytePlus
          //   rejects multi-ref, worker auto-falls back to imageUrls[0]
          //   (character board) — the more important reference.
          imageUrls: refImageUrls,
          imageUrl: refImageUrls[0] || null,    // legacy single-image fallback for older worker
          videoUrl: null,
          duration: seg.targetDurationSec || 12,
          ratio: '16:9',
          resolution: videoResolution,
          model: videoModel,
          generateAudio: audioOn,
          watermark: tier === 'free',
          renderSessionId: currentRenderSessionId,    // §2026-05-30 Bug 4
        });
        setRenderedSegments(prev => {
          const next = [...prev];
          next[segIdx] = { ...(next[segIdx] || {}), taskId: taskIdLocal, status: 'rendering' };
          return next;
        });
        const TIMEOUT_MS = 30 * 60 * 1000;
        const start = Date.now();
        while (true) {
          if (Date.now() - start > TIMEOUT_MS) throw new Error('Segment video timed out (over 30 minutes).');
          await new Promise(r => setTimeout(r, 6000));
          const status = await pollVolcengineVideoStatus(taskIdLocal);
          if (status.status === 'succeeded') return status.videoUrl;
          if (['failed', 'cancelled', 'timeout'].includes(status.status)) {
            const e = new Error(`Segment render failed: ${status.status} — ${status.errorMessage || 'unknown'}`);
            e.segRefunded = !!status.refunded; e.refundedCredits = status.refundedCredits || 0;
            throw e;
          }
        }
      };

      let videoUrl;
      try {
        videoUrl = await trySubmitAndPoll(true);
      } catch (initialErr) {
        if (isAudioBlockedError(initialErr.message)) {
          console.warn(`[renderSegment ${segIdx}] audio blocked by BytePlus — auto-retrying with audio off`);
          // Don't re-deduct credits — the first attempt's charge stays.
          videoUrl = await trySubmitAndPoll(false);
          // Use timeout so the alert doesn't block the polling promise resolution
          setTimeout(() => {
            alert('⚠️ 音频被 BytePlus 安全过滤器拒绝（输出音频含敏感内容）。已自动重新生成「无声版本」—— 视频画面正常，没有声音。');
          }, 0);
        } else {
          throw initialErr;
        }
      }

      setRenderedSegments(prev => {
        const next = [...prev];
        next[segIdx] = { ...(next[segIdx] || {}), status: 'ready', videoUrl };
        return next;
      });

      // Refresh balance from the authoritative source after the server charge.
      try { const { credits: bal } = await getUserProfile(); if (typeof bal === 'number') setCredits(bal); } catch { /* non-fatal */ }

      // Auto-advance to next pending segment for the UI cursor (user still
      // has to click to actually render it — no auto-charge).
      if (segIdx + 1 < segments.length) {
        setCurrentSegmentIdx(segIdx + 1);
      }
    } catch (err) {
      console.error(`[renderSegment ${segIdx}] failed:`, err);
      // Server already refunded its own charge on failure; re-read truth.
      try { const { credits: bal } = await getUserProfile(); if (typeof bal === 'number') setCredits(bal); } catch { /* non-fatal */ }
      setRenderedSegments(prev => {
        const next = [...prev];
        next[segIdx] = { ...(next[segIdx] || {}), status: 'failed', error: err.message };
        return next;
      });
      if (err?.status === 402 || err?.insufficient) {
        setTokenAlert({
          required: err.required ?? cost,
          current: err.current ?? credits,
          context: `Segment ${segIdx + 1} · ${seg.targetDurationSec || 12}s ${videoResolution} video`,
        });
        return;
      }
      // §2026-05-25 fei — inline banner instead of alert. The segment
      //   card itself already shows the red "failed" badge; the banner
      //   provides one-click retry + dismisses to leave the timeline
      //   readable. Retry re-runs the per-segment render.
      setRenderError({
        title: t('segmentFailTitle', { n: segIdx + 1 }),
        message: (err?.segRefunded ? t('creditsRefunded') + '\n\n' : '') + formatError(err, '点击 重试 重新跑该段;其他段不受影响。'),
        retry: () => { setRenderError(null); renderSegmentVideo(segIdx); },
      });
    }
  };

  /* §2026-05-23 fei: combine all rendered segments into one mp4 using ffmpeg.wasm.
   *   Reuses the existing loadFFmpeg + uploadToSecureOSS infrastructure
   *   already in use by the free-mode multi-segment merger (handleMergeSegments).
   *   On success: sets previewVideoUrl + finalVideoUrl + advances renderProgress
   *   so the rest of the publish flow takes over.
   */
  const handleCombineSegments = async () => {
    const segments = generatedScript?.segments || [];
    const ready = segments
      .map((_, i) => renderedSegments[i])
      .filter(r => r && r.status === 'ready' && r.videoUrl);

    if (ready.length < 2) {
      alert('需要至少 2 段已渲染的视频才能合并。');
      return;
    }
    setIsCombining(true);
    try {
      const ffmpeg = await loadFFmpeg();
      const inputFiles = [];
      for (let i = 0; i < ready.length; i++) {
        const fileName = `seg_${i}.mp4`;
        // Use /api/proxy-asset for CORS — Seedance TOS URLs aren't CORS-friendly
        const proxyUrl = `/api/proxy-asset?url=${encodeURIComponent(ready[i].videoUrl)}`;
        const data = await fetchFile(proxyUrl);
        await ffmpeg.writeFile(fileName, data);
        inputFiles.push(fileName);
      }
      const concatList = inputFiles.map(f => `file '${f}'`).join('\n');
      await ffmpeg.writeFile('concat.txt', concatList);
      // -c copy: stream copy, no re-encode → fast (typically <5s for 5×15s clips)
      // -movflags +faststart: moov atom at the start for streaming
      await ffmpeg.exec(['-f', 'concat', '-safe', '0', '-i', 'concat.txt',
                         '-c', 'copy', '-movflags', '+faststart', 'output.mp4']);
      const outputData = await ffmpeg.readFile('output.mp4');
      const blob = new Blob([outputData.buffer], { type: 'video/mp4' });
      const file = new File([blob], `combined_${Date.now()}.mp4`, { type: 'video/mp4' });

      // Upload to R2 / CDN via existing helper. Returns the permanent URL.
      const combinedUrl = await uploadToSecureOSS(file);

      setCombinedVideoUrl(combinedUrl);
      setPreviewVideoUrl(combinedUrl);
      setFinalVideoUrl(combinedUrl);
      setRenderProgress(4);  // unblock the publish flow

      /* §2026-05-27 fei (CRITICAL data-loss fix) — INSERT recommended_content.
       *
       *   Symptom: fei reported merged Quick Mode multi-segment video '没有
       *   出现在 Library 中,我希望看到的是合并的视频'. Investigation: this
       *   function uploaded to R2 + set local state but NEVER INSERTed a row.
       *   The 3 individual TOS-URL renders had BytePlus task IDs so we could
       *   backfill from logs; the merged R2 URL had NO task ID and was lost
       *   the moment the user navigated away.
       *
       *   Free Mode's parallel handleMergeSegments has had the INSERT since
       *   commit dbecbf1; Quick Mode's handleCombineSegments was the asymmetric
       *   gap.
       *
       *   Mirrors the Free Mode + Quick Mode single-segment patterns:
       *   immediate R2 URL INSERT for instant Library presence + background
       *   Stream mirror to upgrade to HLS later.  banner+retry on session/
       *   RLS failure so user never silently loses work again. */
      const { data: authData } = await supabase.auth.getSession();
      let combinedRowId = null;
      if (authData?.session) {
        const baseTags = [VIDEO_TYPE_TAG[videoType] || '#Trailer', '#MultiSegment'];
        const draftStr = localStorage.getItem('uvera_story_draft');
        const draftData = draftStr ? JSON.parse(draftStr) : {};
        if (draftData.seriesId) baseTags.push(`#Series:${draftData.seriesId}`);
        if (draftData.parentId) baseTags.push(`#Parent:${draftData.parentId}`);

        /* §2026-05-27 fei — pack all segments into segment_videos jsonb.
         *
         *   Single Library row per multi-segment story (vs the old N+1 row
         *   sprawl from before commit 9346151). Library detail view shows
         *   a dropdown to switch between merged version (default) and any
         *   individual segment. ready[] entries from renderSegmentVideo
         *   carry { idx, videoUrl, durationSec, taskId } — map to the
         *   stable schema {index, video, duration_sec}. */
        const segmentVideos = ready.map((r, i) => ({
          index: i,
          video: r.videoUrl,
          duration_sec: r.durationSec || null,
        }));

        const insertPayload = {
          artist: authData.session.user.id,
          title: generatedScript?.title || generatedScript?.summary?.substring(0, 30) + '...' || 'Multi-segment story',
          video: combinedUrl,
          cover: ready[0]?.coverUrl || finalConceptUrl || 'https://uvera.ai/icon-uvera.png',
          media_kind: 'Video',
          published: false,
          tags: baseTags,
          segment_videos: segmentVideos,
        };

        const attemptCombinedInsert = async () => {
          const { data: ins, error: insE } = await supabase
            .from('recommended_content').insert([insertPayload]).select();
          if (insE) {
            setLibrarySaveError({
              title: '合并视频保存到 Library 失败',
              message: insE.message || JSON.stringify(insE),
              help: '合并视频 URL 还有效(在预览处仍可播)。点「重试保存」可以直接写入 Library,不重新合并。',
              retry: async () => { setLibrarySaveError(null); await attemptCombinedInsert(); },
            });
            return null;
          }
          if (!ins || ins.length === 0) {
            setLibrarySaveError({
              title: '合并视频保存被拒绝',
              message: 'RLS 拒绝(空 rows,通常 session 失效)。',
              help: '请刷新登录后点「重试保存」。',
              retry: async () => { setLibrarySaveError(null); await attemptCombinedInsert(); },
            });
            return null;
          }
          combinedRowId = ins[0].id;
          setInsertedWorkId(combinedRowId);
          setLibrarySaveError(null);
          console.log(`[combine] ✅ INSERT recommended_content.id=${combinedRowId}`);
          return combinedRowId;
        };
        await attemptCombinedInsert();
      } else {
        // No session → still surface a banner so user can recover
        console.warn('[combine] No session — INSERT skipped, banner shown');
        setLibrarySaveError({
          title: '合并视频保存暂停 — 登录已失效',
          message: '合并已成功(预览处可播),但写入 Library 跳过(session 失效)。',
          help: '刷新页面或重新登录后,点「重试保存」即可写入 Library 而不重做合并。',
          retry: async () => {
            const { data: freshAuth } = await supabase.auth.getSession();
            if (!freshAuth?.session) {
              alert('仍未检测到登录,请先重新登录。');
              return;
            }
            // Inline retry — single-shot, payload identical
            const { data: ins } = await supabase.from('recommended_content').insert([{
              artist: freshAuth.session.user.id,
              title: generatedScript?.title || 'Multi-segment story',
              video: combinedUrl,
              cover: ready[0]?.coverUrl || finalConceptUrl || 'https://uvera.ai/icon-uvera.png',
              media_kind: 'Video',
              published: false,
              tags: [VIDEO_TYPE_TAG[videoType] || '#Trailer', '#MultiSegment'],
            }]).select();
            if (ins && ins[0]) {
              setInsertedWorkId(ins[0].id);
              setLibrarySaveError(null);
              alert('✅ 已保存到 Library。');
            }
          },
        });
      }

      /* Background CF Stream mirror (parity with handleMergeSegments).
         R2 URL is the immediate playback source; Stream URL backfills via
         PATCH so future loads get HLS adaptive. Best-effort, non-blocking. */
      if (combinedRowId) {
        (async () => {
          try {
            const streamUrl = await uploadUrlToCloudflareStream(combinedUrl, {
              taskId: `combine_${Date.now()}`,
            });
            const { error: patchErr } = await supabase
              .from('recommended_content')
              .update({ video: streamUrl })
              .eq('id', combinedRowId);
            if (!patchErr) console.log(`[combine] ✅ Stream mirror done: ${streamUrl}`);
          } catch (streamErr) {
            console.warn('[combine] Stream mirror failed (non-fatal):', streamErr.message);
          }
        })();
      }

      // Cleanup ffmpeg FS so subsequent merges have clean state
      for (const f of inputFiles) { try { await ffmpeg.deleteFile(f); } catch {} }
      try { await ffmpeg.deleteFile('concat.txt'); } catch {}
      try { await ffmpeg.deleteFile('output.mp4'); } catch {}
    } catch (err) {
      console.error('[handleCombineSegments] failed:', err);
      // §2026-05-25 fei — inline merge error banner; retry just re-runs concat.
      setMergeError({
        title: '多段合并失败',
        message: formatError(err, '所有单段视频还在,可重试合并。第一次失败常是 ffmpeg-core wasm 加载问题,等几秒再试通常 ok。'),
        retry: () => { setMergeError(null); handleCombineSegments(); },
      });
    } finally {
      setIsCombining(false);
    }
  };

  // Precheck the dynamically computed credits for free mode.
  //   §2026-05-29 — no longer deducts. volcengine/video/submit charges
  //   server-side atomically; this is just a fast client-side gate so we
  //   don't kick off the pipeline for a user who obviously can't afford it.
  //   §2026-05-25 fei: factors videoModel multiplier so Free Mode users
  //   are gated at the higher rate when they pick Standard model.
  const handleDeductCredits = async () => {
    const cost = computeFreeModeCredits(freeDuration, videoResolution, videoModel);
    const { credits: currentCredits } = await getUserProfile();
    if (currentCredits < cost) {
      return { success: false, reason: 'insufficient_credits', required: cost, current: currentCredits };
    }
    return { success: true };
  };

  // Load saved segments from DB (paginated)
  const loadSavedSegments = async (page = 0, append = false) => {
    setIsLoadingSavedSegments(true);
    try {
      const { data: authData } = await supabase.auth.getSession();
      if (!authData?.session) return;
      /* §2026-05-25 round-73 (Claude): column 名 created_at → createdAt。
       * recommended_content schema (migration 20260420_recommended_content_v2)
       * 用 camelCase column "createdAt",PostgREST 报 42703 (column not found,
       * hint "Perhaps you meant ...createdAt")。PostgREST 自动 quote 含大写
       * 的 identifier,所以 select/order 直接写 camelCase 即可。 */
      const { data } = await supabase.from('recommended_content')
        .select('id, title, video, cover, createdAt, tags')
        .eq('artist', authData.session.user.id)
        .contains('tags', ['#FreeSegment'])
        .order('createdAt', { ascending: false })
        .range(page * SAVED_SEG_PAGE_SIZE, (page + 1) * SAVED_SEG_PAGE_SIZE - 1);
      const items = data || [];
      if (append) {
        setSavedSegments(prev => [...prev, ...items]);
      } else {
        setSavedSegments(items);
      }
      setHasMoreSavedSegments(items.length === SAVED_SEG_PAGE_SIZE);
      setSavedSegmentsPage(page);
    } catch (e) {
      console.error('Failed to load saved segments:', e);
    } finally {
      setIsLoadingSavedSegments(false);
    }
  };

  // §2026-06-06 fei — 加载用户历史生成的 Free Mode 图片(Works 里 media_kind=Image
  //   + #FreeImage),供出图面板选作参考图(下次进 Free Mode 仍可选)。
  const loadSavedImages = async () => {
    try {
      const { data: authData } = await supabase.auth.getSession();
      if (!authData?.session) return;
      const { data } = await supabase
        .from('recommended_content')
        .select('id, cover, video, title')
        .eq('artist', authData.session.user.id)
        .eq('media_kind', 'Image')
        .contains('tags', ['#FreeImage'])
        .order('createdAt', { ascending: false })
        .limit(30);
      setSavedImages((data || []).map(d => ({ id: d.id, url: d.cover || d.video, title: d.title })).filter(d => d.url));
    } catch (e) { console.warn('[loadSavedImages] failed:', e?.message); }
  };

  // Auto-load saved segments + images when entering free mode
  useEffect(() => {
    if (generationMode === 'free') {
      if (savedSegments.length === 0) loadSavedSegments(0);
      loadSavedImages();
    }
  }, [generationMode]);

  // §2026-06-06 fei — 「自动」比例:仅恰好 1 张参考图时可用。解析该图宽高比 →
  //   映射到最近的 gpt-image-2 尺寸(横 1536×1024 / 方 1024×1024 / 竖 1024×1536)。
  useEffect(() => {
    if (generateAssetSize !== 'auto' || generateAssetRefUrls.length !== 1) {
      setAutoResolvedSize(null);
      return;
    }
    let cancelled = false;
    const probe = new Image();
    probe.onload = () => {
      if (cancelled) return;
      const r = (probe.naturalWidth || 1) / (probe.naturalHeight || 1);
      setAutoResolvedSize(r >= 1.2 ? '1536x1024' : (r <= 0.83 ? '1024x1536' : '1024x1024'));
    };
    probe.onerror = () => { if (!cancelled) setAutoResolvedSize('1536x1024'); };
    probe.src = generateAssetRefUrls[0];
    return () => { cancelled = true; };
  }, [generateAssetSize, generateAssetRefUrls]);

  // §2026-06-06 fei — 参考图变成 0 张或多张时,「自动」失效 → 回落到横版。
  useEffect(() => {
    if (generateAssetSize === 'auto' && generateAssetRefUrls.length !== 1) {
      setGenerateAssetSize('1536x1024');
    }
  }, [generateAssetRefUrls, generateAssetSize]);

  // §2026-06-06 fei — 进页兜底:核对 stuck 'started' 视频任务(用户上次关页前
  //   Seedance 跑挂、没轮询到 failed → 没退款)。failed 的补退款 + 三语提示。
  useEffect(() => {
    let cancelled = false;
    reconcileStuckVideos().then(r => {
      if (cancelled || !r || r.refundedCount <= 0) return;
      setRefundNotice(t('reconcileRefunded', { count: r.refundedCount, credits: r.refundedCredits }));
      getUserProfile().then(({ credits: bal }) => { if (typeof bal === 'number') setCredits(bal); }).catch(() => {});
    }).catch(() => {});
    return () => { cancelled = true; };
  }, []);

  // §2026-06-06 fei — Free Mode 生成的图片也存进 Works(media_kind='Image'),
  //   让用户可在 Library 查看,并在下次 Free Mode 选作参考图。fire-and-forget。
  const saveFreeImageToLibrary = async (imageUrl, prompt) => {
    try {
      const { data: authData } = await supabase.auth.getSession();
      if (!authData?.session) return null;
      const { data: inserted } = await supabase
        .from('recommended_content')
        .insert([{
          artist: authData.session.user.id,
          title: (prompt || 'Free Mode image').substring(0, 50),
          cover: imageUrl,
          video: imageUrl,           // 图片无视频;同填便于 Works 缩略图/点开预览
          media_kind: 'Image',
          published: false,
          tags: ['#FreeImage'],
        }])
        .select();
      return inserted?.[0] || null;
    } catch (e) {
      console.warn('[saveFreeImageToLibrary] failed:', e?.message);
      return null;
    }
  };

  // Generate an AI image and add it as a reference asset
  const handleGenerateAsset = async () => {
    if (isGeneratingAsset || !generateAssetPrompt.trim()) return;
    setIsGeneratingAsset(true);
    try {
      // §2026-06-06 fei — Free Mode 出图走 generateImageAsset → /api/generate-image
      //   (纯多模态出图,无故事板 scaffold)。prompt 为主指令;可带多张参考图
      //   (OpenAI /v1/images/edits 合成);比例支持「自动」= 跟单张参考图一致
      //   (上游已解析为 effectiveAssetSize)。Style 选择器已移除。
      const result = await generateImageAsset({
        prompt: generateAssetPrompt,
        referenceImageUrls: generateAssetRefUrls,
        quality: generateAssetQuality,
        size: effectiveAssetSize,
      });
      const imageUrl = result.image_urls?.[0];
      if (!imageUrl) throw new Error('Image generation failed');
      const assetId = generateAssetId(imageUrl);
      const newAsset = { id: assetId, url: imageUrl, isVideo: false, name: 'Recognizing…' };
      setFreeAssets(prev => [...prev, newAsset]);
      // §2026-06-06 fei — 存进 Works(Image)+ 加进「已生成图」供下次选参考
      saveFreeImageToLibrary(imageUrl, generateAssetPrompt).then((row) => {
        if (row) setSavedImages(prev => prev.some(p => p.url === imageUrl) ? prev : [{ id: row.id, url: imageUrl, title: row.title }, ...prev]);
      });
      // Get AI description
      describeAsset(imageUrl).then(desc => {
        setFreeAssets(prev => prev.map(a => a.id === assetId ? { ...a, name: desc } : a));
      });
      setGenerateAssetPrompt('');
      setGenerateAssetRefUrls([]);
      setShowGenerateAssetPanel(false);
    } catch (err) {
      // §2026-06-06 fei — 图片生成失败:三语提示;真退款时明确「积分已返还」(402 余额不足不显示)
      const refundNote = err?.refunded ? '\n' + t('creditsRefunded') : '';
      alert(t('imageFailTitle') + refundNote + (err?.message ? '\n\n' + formatError(err, '') : ''));
    } finally {
      setIsGeneratingAsset(false);
    }
  };

  // Load library videos for the segment picker
  const loadLibraryVideos = async () => {
    setIsLoadingLibrary(true);
    try {
      const { data: authData } = await supabase.auth.getSession();
      if (!authData?.session) return;
      /* §2026-05-25 round-73 (Claude): 同上 column 名 createdAt 修。 */
      const { data } = await supabase.from('recommended_content')
        .select('id, title, video, cover')
        .eq('artist', authData.session.user.id)
        .eq('media_kind', 'Video')
        .order('createdAt', { ascending: false })
        .limit(50);
      setLibraryVideos(data || []);
    } catch (e) {
      console.error('Failed to load library:', e);
    } finally {
      setIsLoadingLibrary(false);
    }
  };

  // Load FFmpeg.wasm lazily
  const loadFFmpeg = async () => {
    if (ffmpegLoadedRef.current) return ffmpegRef.current;
    const ffmpeg = new FFmpeg();
    ffmpegRef.current = ffmpeg;
    ffmpeg.on('progress', ({ progress }) => {
      setMergeProgress(Math.round(progress * 100));
    });
    // Self-hosted FFmpeg core (copied from node_modules to public/ffmpeg/ at
    // build time by scripts/copy-ffmpeg.mjs). Loading from same origin avoids
    // the cross-origin failures we hit with unpkg/jsdelivr where the FFmpeg-
    // spawned worker couldn't import the core script.
    //
    // §2026-05-25 fei: query-string version-bust on the wasm URL.
    //   The previous deploy returned a "wasm not in R2" 404 text body, but
    //   Cloudflare's edge cached it with status 200 + content-type text/html.
    //   Subsequent (now-correct) Worker responses got shadowed by that
    //   poisoned cache → browsers downloaded HTML instead of wasm and the
    //   Combine button died with "WebAssembly.Module doesn't parse at byte 0".
    //   Adding ?v=0.12.10 creates a new cache key so the bad entry is
    //   skipped. Bump this string if @ffmpeg/core version ever changes.
    await ffmpeg.load({
      coreURL: '/ffmpeg/ffmpeg-core.js',
      wasmURL: '/ffmpeg/ffmpeg-core.wasm?v=0.12.10',
    });
    ffmpegLoadedRef.current = true;
    return ffmpeg;
  };

  const handleOptimizePrompt = async () => {
    if (!freePrompt.trim() || isPromptOptimized || isOptimizingPrompt) return;
    setIsOptimizingPrompt(true);
    try {
      const optimized = await optimizePrompt(freePrompt);
      setFreePrompt(optimized);
      setIsPromptOptimized(true);
    } catch (err) {
      console.error(err);
      alert('Could not optimize the prompt. Please try again.');
    } finally {
      setIsOptimizingPrompt(false);
    }
  };

  /* §2026-05-24 fei: certify a Free Mode asset to BytePlus's Private
   *   Asset Library so Seedance accepts it as reference even if it
   *   contains real-person content. After certification we store
   *   `certifiedUri` on the asset object — generation uses that URI
   *   (asset://xxx) instead of the public URL.
   *
   *   In-flight tracking via the asset's own `certifying` flag (per-asset
   *   spinner without needing extra state). */
  const handleCertifyAsset = async (assetId) => {
    const target = freeAssets.find(a => a.id === assetId);
    if (!target) return;
    if (target.certifiedUri) return;  // already certified — idempotent
    if (target.certifying) return;    // double-click guard

    // Mark as certifying
    setFreeAssets(prev => prev.map(a =>
      a.id === assetId ? { ...a, certifying: true, certifyError: null } : a
    ));
    try {
      const assetUri = await certifyAsset(target.url, target.isVideo ? 'Video' : 'Image');
      setFreeAssets(prev => prev.map(a =>
        a.id === assetId ? { ...a, certifying: false, certifiedUri: assetUri, certifyError: null } : a
      ));
    } catch (err) {
      console.error('[handleCertifyAsset] failed:', err);
      setFreeAssets(prev => prev.map(a =>
        a.id === assetId ? { ...a, certifying: false, certifyError: err.message || 'Certification failed' } : a
      ));
    }
  };

  /* §2026-05-25 fei: persist a Free Mode segment to recommended_content.
   *
   *   Extracted from the inline auto-save block in handleFreeSegmentGenerate
   *   so the per-segment "重试保存" button can call it too. The previous
   *   inline-only version meant that if the insert failed (RLS denial, network
   *   blip), the user had no way to retry short of regenerating the whole
   *   segment from scratch (and burning another N credits). Now: the segment
   *   carries its DB save state (dbId on success, dbSaveError on failure),
   *   the timeline card shows it visually, and a single click retries.
   *
   *   Args:
   *     segId          — freeSegment.id to update with results
   *     permanentUrl   — CF Stream URL of the rendered video
   *     prompt         — user prompt (used for title); falls back to placeholder
   *     isAutoSave     — true when called from auto-save (suppresses success log
   *                      alert; failures STILL alert so user knows to retry).
   *                      false when called from manual retry button.
   *
   *   Returns true on success, false otherwise. Always updates freeSegments
   *   state with dbId / dbSaveError so the UI reflects current truth. */
  const saveFreeSegmentToLibrary = async ({ segId, permanentUrl, prompt, isAutoSave }) => {
    try {
      const { data: authData } = await supabase.auth.getSession();
      if (!authData?.session) {
        const msg = '未登录 — 请先登录再保存。';
        setFreeSegments(prev => prev.map(s => s.id === segId ? { ...s, dbSaveStatus: 'failed', dbSaveError: msg } : s));
        alert('视频已生成，但你未登录所以未保存到 Library。\n\n请先登录，然后在 Segment Timeline 中点击对应片段的「重试保存」按钮。');
        return false;
      }

      // Derive cover URL from CF Stream UID (works for any Stream-hosted video)
      let coverUrl = null;
      const streamMatch = String(permanentUrl).match(/(?:videodelivery\.net|cloudflarestream\.com)\/([a-f0-9]{32})/i);
      if (streamMatch) {
        coverUrl = `https://videodelivery.net/${streamMatch[1]}/thumbnails/thumbnail.jpg`;
        // §2026-06-05 #1 — 设 Stream poster 帧 = 时长 10%(跳过纯黑首帧)。
        //   worker 持 CF token,前端只传 uid。fire-and-forget,不阻断保存。
        ensureStreamPoster(streamMatch[1], authData.session.access_token);
      }

      const insertRow = {
        artist: authData.session.user.id,
        title: (prompt || 'Free Mode segment').substring(0, 50),
        video: permanentUrl,
        cover: coverUrl,
        media_kind: 'Video',
        published: false,
        tags: [VIDEO_TYPE_TAG[videoType] || '#Trailer', '#FreeSegment'],
      };

      const { data: inserted, error: insertErr } = await supabase
        .from('recommended_content')
        .insert([insertRow])
        .select();

      if (insertErr) {
        console.error('[freeSegment] DB insert failed:', insertErr, 'row=', insertRow);
        const msg = insertErr.message || JSON.stringify(insertErr);
        setFreeSegments(prev => prev.map(s => s.id === segId ? { ...s, dbSaveStatus: 'failed', dbSaveError: msg } : s));
        alert(
          '保存到 Library 失败：\n\n' + msg +
          '\n\n视频本身仍可在 Segment Timeline 中播放。点击片段卡上的「重试保存」按钮可以再试一次。'
        );
        return false;
      }

      if (!inserted || inserted.length === 0) {
        // RLS denial with no error is the typical case here. Supabase
        //   returns empty rows when the policy blocks the insert silently.
        console.warn('[freeSegment] insert returned empty rows (no error) — likely RLS denial');
        const msg = '数据库权限拒绝（RLS 政策阻止了写入，但没有返回错误信息）';
        setFreeSegments(prev => prev.map(s => s.id === segId ? { ...s, dbSaveStatus: 'failed', dbSaveError: msg } : s));
        alert('保存到 Library 没返回任何记录 — 可能是权限问题。\n\n请把这条消息截图发给开发者，并尝试重新登录后再点击片段卡的「重试保存」按钮。');
        return false;
      }

      // Success
      setFreeSegments(prev => prev.map(s => s.id === segId ? {
        ...s, dbSaveStatus: 'saved', dbId: inserted[0].id, dbSaveError: null,
      } : s));
      setSavedSegments(prev => [inserted[0], ...prev]);
      console.log(`[freeSegment] ✅ ${isAutoSave ? 'auto-saved' : 'manually saved'} segment ${segId} → recommended_content.id=${inserted[0].id}`);
      if (!isAutoSave) {
        // Manual retry succeeded — give the user a small confirmation toast
        try { alert('✅ 已保存到 Library。'); } catch (_) {}
      }
      return true;
    } catch (err) {
      console.error('[freeSegment] persist exception:', err);
      const msg = err?.message || String(err);
      setFreeSegments(prev => prev.map(s => s.id === segId ? { ...s, dbSaveStatus: 'failed', dbSaveError: msg } : s));
      alert('保存到 Library 出现网络错误：\n\n' + msg + '\n\n点击片段卡上的「重试保存」按钮可以再试一次。');
      return false;
    }
  };

  // Generate a single segment in free mode (segment-aware)
  const handleFreeSegmentGenerate = async (referenceVideoUrl = null) => {
    if (freeSegmentGenerating) return; // guard against double-click
    if (!freePrompt && freeAssets.length === 0 && !referenceVideoUrl) {
      alert('Please enter a prompt or upload reference material first.');
      return;
    }

    // Immediately lock the button BEFORE any async work
    setFreeSegmentGenerating(true);
    
    const cost = freeModeCost;
    if (credits < cost) {
      setTokenAlert({ required: cost, current: credits, context: `${freeDuration}s ${videoResolution} video` });
      setFreeSegmentGenerating(false);
      return;
    }
    const res = await handleDeductCredits();
    if (!res.success) {
      setTokenAlert({ required: res.required ?? cost, current: res.current ?? credits, context: `${freeDuration}s ${videoResolution} video` });
      setFreeSegmentGenerating(false);
      return;
    }
    const segId = Date.now();
    const newSeg = { id: segId, prompt: freePrompt, duration: freeDuration, status: 'generating', url: null, assets: [...freeAssets] };
    setFreeSegments(prev => [...prev, newSeg]);
    
    try {
      // §2026-05-24 fei: prefer certifiedUri over raw URL when present.
      //   certifiedUri is BytePlus's `asset://xxx` form for assets uploaded
      //   to the Private Asset Library — bypasses the safety filter for
      //   real-person reference photos. Falls back to the public URL when
      //   the asset isn't certified.
      const imageUrls = freeAssets.filter(a => !a.isVideo).map(a => a.certifiedUri || a.url);
      const videoUrls = freeAssets.filter(a => a.isVideo).map(a => a.certifiedUri || a.url);

      // If continuing from a previous segment, use it as the video reference
      const refVideo = referenceVideoUrl || (videoUrls.length > 0 ? videoUrls[0] : null);

      // Build prompt: if continuing, prepend continuation hint
      let finalPrompt = freePrompt || 'Video generation';
      if (referenceVideoUrl && freeSegments.length > 0) {
        finalPrompt = `[Continuing from previous segment] ${finalPrompt}`;
      }

      /* §2026-05-25 fei: same audio-block auto-retry as renderSegmentVideo.
       *   BytePlus's output-audio safety filter sometimes rejects the
       *   generated audio (especially with dialog-rich prompts). On that
       *   specific failure, retry with audio off so user still gets a
       *   silent video instead of a hard failure + refund. */
      const trySubmitAndPoll = async (audioOn) => {
        const taskIdLocal = await generateVolcengineVideo({
          prompt: finalPrompt,
          imageUrl: (!refVideo && imageUrls.length > 0) ? imageUrls[0] : null,
          imageUrls: (!refVideo && imageUrls.length > 0) ? imageUrls : null,
          videoUrl: refVideo || null,
          videoUrls: null,
          duration: freeDuration,
          ratio: videoRatio,
          resolution: videoResolution,
          model: videoModel,
          generateAudio: audioOn,
        });
        const TIMEOUT_MS = 30 * 60 * 1000;
        const startTime = Date.now();
        while (true) {
          if (Date.now() - startTime > TIMEOUT_MS) throw new Error('Video generation timed out');
          await new Promise(r => setTimeout(r, 6000));
          const statusData = await pollVolcengineVideoStatus(taskIdLocal);
          if (statusData.status === 'succeeded') return { videoUrl: statusData.videoUrl, taskId: taskIdLocal };
          if (['failed', 'cancelled', 'timeout'].includes(statusData.status)) {
            const e = new Error('Generation failed: ' + (statusData.errorMessage || statusData.status));
            e.refunded = !!statusData.refunded; e.refundedCredits = statusData.refundedCredits || 0;
            throw e;
          }
        }
      };

      let outVideoUrl, taskId;
      try {
        ({ videoUrl: outVideoUrl, taskId } = await trySubmitAndPoll(true));
      } catch (initialErr) {
        if (isAudioBlockedError(initialErr.message)) {
          console.warn('[freeSegment] audio blocked by BytePlus — auto-retrying with audio off');
          ({ videoUrl: outVideoUrl, taskId } = await trySubmitAndPoll(false));
          setTimeout(() => {
            alert('⚠️ 音频被 BytePlus 安全过滤器拒绝（输出音频含敏感内容）。已自动重新生成「无声版本」—— 视频画面正常，没有声音。');
          }, 0);
        } else {
          throw initialErr;
        }
      }

      // Upload to permanent storage
      // §2026-05-15 P0.b: pass taskId so worker can PATCH file_size_bytes
      // back to generation_logs for cost / quota analytics.
      const permanentUrl = await uploadUrlToCloudflareStream(outVideoUrl, { taskId });

      // §2026-06-06 fei — 同时保留原始全分辨率 TOS 源(rawUrl)给合并用。
      //   permanentUrl 是 CF Stream iframe 地址(HTML,非视频文件),合并 fetch 它
      //   只会拿到 HTML/低档 → 合并出 240p。rawUrl=Seedance 原画 mp4,同会话内有效。
      setFreeSegments(prev => prev.map(s => s.id === segId ? { ...s, url: permanentUrl, rawUrl: outVideoUrl, status: 'ready', dbSaveStatus: 'pending' } : s));
      // Save current assets to history before clearing
      setHistoryAssets(prev => {
        const existingUrls = new Set(prev.map(a => a.url));
        const newHistory = freeAssets.filter(a => !existingUrls.has(a.url));
        return [...prev, ...newHistory];
      });

      // §2026-05-25 fei: actual insert is now in saveFreeSegmentToLibrary
      //   (defined outside this function for retry-button reuse). Auto-call
      //   it here on first ready; user can also click the per-segment retry
      //   button if it fails.
      await saveFreeSegmentToLibrary({
        segId,
        permanentUrl,
        prompt: freePrompt,
        isAutoSave: true,
      });

      setFreePrompt('');
      setFreeAssets([]);
      // Refresh balance from the authoritative source after the server charge.
      try { const { credits: bal } = await getUserProfile(); if (typeof bal === 'number') setCredits(bal); } catch { /* non-fatal */ }
    } catch (err) {
      console.error('Segment generation error:', err);
      // Server already refunded its own charge on failure; re-read truth.
      try { const { credits: bal } = await getUserProfile(); if (typeof bal === 'number') setCredits(bal); } catch { /* non-fatal */ }
      if (err?.status === 402 || err?.insufficient) {
        setTokenAlert({ required: err.required ?? cost, current: err.current ?? credits, context: `${freeDuration}s ${videoResolution} video` });
        setFreeSegments(prev => prev.filter(s => s.id !== segId));
        setFreeSegmentGenerating(false);
        return;
      }
      // §2026-06-06 fei — 视频失败且已退款 → 各分支提示前置三语「积分已返还」
      const refundPrefix = err?.refunded ? t('creditsRefunded') + '\n\n' : '';
      const msg = err.message || '';
      const hasAnyAssets = freeAssets.length > 0;
      /* §2026-05-25 fei — surface as InlineErrorBanner inside the Free
       *   Mode card instead of window.alert(). Each case is mapped to a
       *   user-actionable message + retry hook. User can dismiss + see
       *   the segment timeline / re-edit prompt without the alert
       *   blocking the page. */
      if (msg.includes('InputVideoSensitiveContentDetected.PrivacyInformation')) {
        setFreeSegmentError({
          title: '参考素材含真人面孔,被安全过滤器拒绝',
          message: refundPrefix + '点击每张素材卡下方的「认证」按钮,将素材上传到 BytePlus 私有素材库,绕过安全过滤器后再 Generate。',
          retry: () => { setFreeSegmentError(null); handleFreeSegmentGenerate(referenceVideoUrl); },
        });
      } else if (/invalid.*video_url|invalid.*image_url/i.test(msg) && !hasAnyAssets) {
        // §2026-05-24 fei: the active Seedance endpoint likely requires
        //   a reference image (i2v) and the user submitted text-only.
        //   BytePlus surfaces this as "Invalid video_url" which is
        //   confusing — translate to actionable instruction.
        setFreeSegmentError({
          title: '当前视频模型需要参考素材',
          message: refundPrefix + '请在上方点 [+ Upload] 至少上传一张图片或一段视频,然后再点 Generate。\n\n如果上传的是真人照片,建议先点素材上的「认证」按钮做安全过滤旁路。',
        });
      } else if (/invalid.*video_url|invalid.*image_url/i.test(msg) && hasAnyAssets) {
        setFreeSegmentError({
          title: '参考素材被 BytePlus 安全过滤器拒绝',
          message: refundPrefix + '点击每个素材卡上的「认证」按钮,将素材上传到 BytePlus 私有素材库后再 Generate。这能让真人照片或敏感内容通过审核。',
          retry: () => { setFreeSegmentError(null); handleFreeSegmentGenerate(referenceVideoUrl); },
        });
      } else {
        setFreeSegmentError({
          title: t('videoFailTitle'),
          message: refundPrefix + formatError(err, '请检查 prompt + 参考素材后重试。'),
          retry: () => { setFreeSegmentError(null); handleFreeSegmentGenerate(referenceVideoUrl); },
        });
      }
      setFreeSegments(prev => prev.filter(s => s.id !== segId));
    } finally {
      setFreeSegmentGenerating(false);
    }
  };

  // Add an existing library video as a segment
  const handleAddLibrarySegment = (video) => {
    setFreeSegments(prev => [...prev, {
      id: Date.now(),
      url: video.video,
      prompt: video.title || 'Existing video',
      duration: null,
      status: 'ready'
    }]);
    setShowLibraryPicker(false);
  };

  // Remove a segment
  const handleRemoveSegment = (segId) => {
    setFreeSegments(prev => prev.filter(s => s.id !== segId));
  };

  /* §2026-06-06 fei — 合并/拼接前把分段解析到「全分辨率 mp4 源」。
   *   分段的 .url 是 CF Stream iframe 地址(HTML,非视频),直接 fetch 它合并
   *   会拿到 HTML/低档 → 合出 240p。解析优先级:
   *     1. rawUrl(渲染时存的原始 Seedance TOS mp4,同会话即时、全分辨率)
   *     2. 对 Stream 视频 enable-download 拿原画 mp4(跨会话兜底,需轮询,稍慢)
   *     3. 最后才回退 url(可能仍是低档) */
  const resolveFullResMergeSource = async (seg) => {
    if (seg?.rawUrl) return seg.rawUrl;
    const uid = extractStreamUid(seg?.url || '');
    if (uid) {
      for (let attempt = 0; attempt < 20; attempt++) {
        try {
          const res = await fetch('/api/stream/enable-download', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ uid }),
          });
          const data = await res.json();
          if (data?.status === 'ready' && data.url) return data.url;
          if (data?.status === 'error') break;
        } catch { break; }
        await new Promise(r => setTimeout(r, 3000));
      }
    }
    return seg?.url;
  };

  // Merge all segments using FFmpeg.wasm
  const handleMergeSegments = async () => {
    const readySegments = freeSegments.filter(s => s.status === 'ready' && s.url);
    if (readySegments.length < 2) {
      alert('You need at least 2 video segments to merge.');
      return;
    }

    setIsMergingSegments(true);
    setMergeProgress(0);

    try {
      const ffmpeg = await loadFFmpeg();

      // Download each segment (全分辨率源) and write to FFmpeg FS
      const inputFiles = [];
      for (let i = 0; i < readySegments.length; i++) {
        const fileName = `seg_${i}.mp4`;
        const srcUrl = await resolveFullResMergeSource(readySegments[i]);
        const proxyUrl = `/api/proxy-asset?url=${encodeURIComponent(srcUrl)}`;
        const data = await fetchFile(proxyUrl);
        await ffmpeg.writeFile(fileName, data);
        inputFiles.push(fileName);
      }
      
      // Build concat list
      const concatList = inputFiles.map(f => `file '${f}'`).join('\n');
      await ffmpeg.writeFile('concat.txt', concatList);
      
      // Run ffmpeg concat
      await ffmpeg.exec(['-f', 'concat', '-safe', '0', '-i', 'concat.txt', '-c', 'copy', '-movflags', '+faststart', 'output.mp4']);
      
      const outputData = await ffmpeg.readFile('output.mp4');
      const blob = new Blob([outputData.buffer], { type: 'video/mp4' });
      const file = new File([blob], `merged_${Date.now()}.mp4`, { type: 'video/mp4' });
      
      /* §2026-05-26 fei — Two-stage upload (architectural alignment with
       *   Quick Mode + single-segment Free Mode).
       *
       *   Before: merged mp4 stayed on R2 only (uploadToSecureOSS misleading
       *   name — it's R2 not Aliyun OSS). Asymmetry vs single-segment which
       *   lives on CF Stream: merged video lost HLS adaptive bitrate, free-
       *   tier watermark, and the unified /api/stream/download-proxy path.
       *
       *   After: R2 upload first (so user has an instantly playable URL
       *   right when ffmpeg finishes), then fire-and-forget Stream upload
       *   in the background (worker pulls from the R2 URL — handles
       *   transcode + watermark serverside). DB row INSERTs with R2 URL
       *   initially, then PATCHes to Stream URL once the worker pull
       *   completes. Pattern mirrors line 3382-3402's Quick Mode flow. */
      const mergedR2Url = await uploadToSecureOSS(file);

      // User-visible state goes live with R2 URL immediately. Plays via
      // UnifiedVideoPlayer's direct-mp4 branch. Stream URL kicks in on
      // page reload after the background pull finishes.
      setPreviewVideoUrl(mergedR2Url);
      setFinalVideoUrl(mergedR2Url);
      setStep(4);
      setRenderProgress(4);

      // Auto-save to works (synchronous so user sees the row appear in Library
      // immediately + has a retry handle if it fails). Bg Stream upload below.
      const { data: authData } = await supabase.auth.getSession();
      let savedRowId = null;
      if (authData?.session) {
        /* §2026-05-25 fei (Leon ask): also tag the combined-segments row
         *   with the videoType so it categorizes correctly on Discover.
         *   '#MultiSegment' stays as a 2nd meta-tag for any future merge-
         *   only views.
         *
         *   §2026-05-26 fei — surface failure as InlineErrorBanner with
         *   retry instead of silently swallowing. mergedUrl is already in
         *   memory + valid for the session, so retry doesn't need any
         *   re-rendering or re-merging. */
        /* §2026-05-27 fei — same single-row model as handleCombineSegments.
         *   readySegments[] from freeSegments has shape { id, url, status,
         *   prompt, duration }. Map to canonical { index, video, duration_sec }
         *   so LibraryPage detail view's dropdown can offer the user a
         *   "合并版 / 分段 N" switcher off this jsonb column. */
        const freeSegmentVideos = readySegments.map((seg, i) => ({
          index: i,
          video: seg.url,
          duration_sec: seg.duration || null,
        }));

        const mergePayload = {
          artist: authData.session.user.id,
          title: (freeSegments[0]?.prompt || 'Multi-segment video').substring(0, 50),
          video: mergedR2Url,
          media_kind: 'Video',
          published: false,
          tags: [VIDEO_TYPE_TAG[videoType] || '#Trailer', '#MultiSegment'],
          segment_videos: freeSegmentVideos,
        };
        const attemptMergeInsert = async () => {
          const { data: insertedData, error } = await supabase
            .from('recommended_content')
            .insert([mergePayload])
            .select();
          if (error) {
            console.error('[merge] Library save failed:', error, 'payload=', mergePayload);
            setLibrarySaveError({
              title: '合并视频保存到 Library 失败',
              message: error.message || JSON.stringify(error),
              help: '合并后的视频可以在预览处继续播放(URL 仍有效)。点「重试保存」可以直接写入 Library,不需要重新合并。',
              retry: async () => { setLibrarySaveError(null); await attemptMergeInsert(); },
            });
            return null;
          }
          if (!insertedData || insertedData.length === 0) {
            console.warn('[merge] insert returned empty rows — likely RLS denial');
            setLibrarySaveError({
              title: '合并视频保存被拒绝',
              message: '数据库权限拒绝 (无错误信息,通常 session 失效)。',
              help: '请刷新页面或重新登录后,点「重试保存」。',
              retry: async () => { setLibrarySaveError(null); await attemptMergeInsert(); },
            });
            return null;
          }
          setInsertedWorkId(insertedData[0].id);
          setLibrarySaveError(null);
          return insertedData[0].id;
        };
        savedRowId = await attemptMergeInsert();
      }

      // ── Background CF Stream upload (fire-and-forget) ─────────────────
      // Workers /api/stream/upload-from-url pulls the R2 URL into CF Stream.
      // Once Stream returns its iframe URL, PATCH the DB row to use it so
      // future loads benefit from HLS adaptive + watermark. R2 URL stays
      // valid (we don't delete) so any in-flight viewer keeps playing
      // through the cutover.
      if (savedRowId) {
        (async () => {
          try {
            const streamUrl = await uploadUrlToCloudflareStream(mergedR2Url, {
              taskId: `merge_${Date.now()}`,
            });
            console.log('[merge] ✅ Stream mirror done:', streamUrl);
            const { error: patchErr } = await supabase
              .from('recommended_content')
              .update({ video: streamUrl })
              .eq('id', savedRowId);
            if (patchErr) {
              console.error('[merge] Stream URL PATCH failed (R2 URL stays):', patchErr);
            } else {
              console.log('[merge] ✅ DB row patched to Stream URL');
            }
          } catch (streamErr) {
            // R2 URL is already in DB + still works — Stream is best-effort.
            // Logging only; no UI surface (user already sees Generation complete).
            console.warn('[merge] Stream mirror failed (non-fatal, R2 URL persists):', streamErr.message);
          }
        })();
      }

      // Cleanup FFmpeg FS
      for (const f of inputFiles) { try { await ffmpeg.deleteFile(f); } catch {} }
      try { await ffmpeg.deleteFile('concat.txt'); } catch {}
      try { await ffmpeg.deleteFile('output.mp4'); } catch {}
      
    } catch (err) {
      console.error('FFmpeg merge error:', err);
      // §2026-05-25 fei — inline merge banner (Free Mode multi-segment merge)
      setMergeError({
        title: 'Free Mode 合并失败',
        message: formatError(err, '请确认每段视频都是 ready 状态;然后再点合并。'),
        retry: () => { setMergeError(null); handleMergeSegments(); },
      });
    } finally {
      setIsMergingSegments(false);
    }
  };

  const handleDownloadAll = () => {
    const readySegments = freeSegments.filter(s => s.status === 'ready' && s.url);
    if (readySegments.length === 0) {
      alert('No video segments available to download.');
      return;
    }
    readySegments.forEach((seg, index) => {
      const a = document.createElement('a');
      a.href = seg.url;
      a.download = `segment-${index + 1}.mp4`;
      a.target = '_blank';
      a.click();
    });
  };

  const handleCreateNewClip = () => {
    if (freeSegments.length > 0 && !confirm('Discard current segments and start a new short?')) return;
    setFreeSegments([]);
    setFreePrompt('');
    setFreeAssets([]);
  };

  /**
   * Submit a user-owned video for admin review.
   *
   * Three-step pipeline:
   *   1. POST /api/user-videos/init-upload  — Worker validates auth + copyright
   *      acknowledgement, creates a Cloudflare Stream Direct Upload URL, inserts
   *      a row in user_video_uploads (status='uploading').
   *   2. POST <uploadURL> as multipart/form-data  — browser sends the file
   *      DIRECTLY to Cloudflare Stream, bypassing the Worker 100 MB body limit.
   *      Stream supports up to 30 GB per video.
   *   3. POST /api/user-videos/finalize  — Worker flips the row to
   *      status='pending_review' so it appears in the admin queue.
   *
   * Why three round-trips: a single upload-through-worker would cap us at
   * 100 MB and route gigs of bytes through CF's Worker compute budget. The
   * Direct Upload pattern is what Cloudflare itself recommends for video.
   *
   * Errors at any stage surface as `uploadResult: { ok: false, message }` so
   * the user can retry without losing form state. We deliberately do NOT
   * roll back the DB row on step-2 / step-3 failure: the row stays as
   * 'uploading' which admin can clean up, and the user can resubmit.
   */
  const handleVideoSubmitForReview = async () => {
    if (!uploadFile) {
      setUploadResult({ ok: false, message: 'Please select a video file first.' });
      return;
    }
    if (!uploadTitle || uploadTitle.trim().length < 1) {
      setUploadResult({ ok: false, message: 'Title is required.' });
      return;
    }
    if (!uploadCopyrightChecked) {
      setUploadResult({ ok: false, message: 'You must acknowledge the copyright statement to upload.' });
      return;
    }
    if (uploadFile.size > UPLOAD_MAX_BYTES) {
      const sizeMB = (uploadFile.size / 1024 / 1024).toFixed(0);
      const maxMB = (UPLOAD_MAX_BYTES / 1024 / 1024).toFixed(0);
      setUploadResult({ ok: false, message: `File too large (${sizeMB} MB). Max ${maxMB} MB.` });
      return;
    }
    if (!uploadFile.type.startsWith('video/')) {
      setUploadResult({ ok: false, message: 'File must be a video (mp4, webm, mov, etc.).' });
      return;
    }

    setUploadIsSubmitting(true);
    setUploadResult(null);
    setUploadProgress(0);

    try {
      // §2026-05-15: extract duration from the file BEFORE upload so we can
      // pass it to /api/user-videos/finalize. Without this, the column stays
      // NULL — verified all 12 historical rows were NULL pre-fix. Browser
      // HTMLVideoElement parses metadata-only (preload='metadata' avoids
      // downloading the entire file just to read duration).
      // Best-effort: if duration read fails (e.g. corrupt header), continue
      // with durationSeconds=null — better to lose the metadata than to
      // block the upload entirely.
      let durationSeconds = null;
      try {
        durationSeconds = await new Promise((resolve, reject) => {
          const video = document.createElement('video');
          video.preload = 'metadata';
          const objUrl = URL.createObjectURL(uploadFile);
          video.src = objUrl;
          const timeoutId = setTimeout(() => {
            URL.revokeObjectURL(objUrl);
            reject(new Error('Duration probe timeout (5s)'));
          }, 5000);
          video.onloadedmetadata = () => {
            clearTimeout(timeoutId);
            URL.revokeObjectURL(objUrl);
            const d = Number.isFinite(video.duration) ? Math.round(video.duration) : null;
            resolve(d);
          };
          video.onerror = () => {
            clearTimeout(timeoutId);
            URL.revokeObjectURL(objUrl);
            reject(new Error('Duration probe failed: invalid video metadata'));
          };
        });
      } catch (e) {
        console.warn('[user-video-upload] duration probe failed, proceeding without:', e.message);
      }

      // Step 1: get session token + init upload
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error('You must be logged in to upload videos.');

      const initResp = await fetch('/api/user-videos/init-upload', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${session.access_token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          title: uploadTitle.trim(),
          description: uploadDescription.trim() || null,
          copyrightAcknowledged: true,
          copyrightTextVersion: COPYRIGHT_TEXT_VERSION,
          // Required for tus protocol — Worker passes through to Stream
          // as Upload-Length header. Server enforces same 500 MB cap.
          fileSize: uploadFile.size,
        })
      });
      const initData = await initResp.json();
      if (!initResp.ok || !initData.success) {
        throw new Error(initData.errMessage || `init-upload failed (HTTP ${initResp.status})`);
      }
      const { uploadURL, recordId } = initData;

      // Step 2: tus resumable upload to the one-time URL Stream returned.
      //
      // Why tus instead of basic POST:
      //   - CF Stream's basic upload caps at 200 MB; we need 500 MB.
      //   - tus is resumable across network drops — for big files on flaky
      //     connections this is the difference between "works" and "user
      //     gives up after 2 retries".
      //   - Standard chunk size 50 MB; for 500 MB max file = 10 chunks,
      //     each retried independently if needed.
      //
      // The endpoint returned by Worker IS already authorized (it's a
      // one-time URL minted on our CF account), so the browser sends no
      // auth headers — that's by design.
      /* §2026-05-25 round-74 (Leon, 甲方反馈 VPN 链路 PATCH chunk 失败):
       * 调小 chunkSize 50MB → 5MB + 加长 retryDelays 让 VPN 链路稳定性问题
       * 不再致命。VPN 不稳定环境下大 chunk 单 PATCH 失败 = 整个 upload 失败,
       * tus 协议的 chunk-level retry 优势被绕过。
       *   chunkSize: 5 MB — Cloudflare Stream 推荐最小值,VPN session 抖动
       *     时单 chunk 失败,retry 只重传 5MB 不是 50MB
       *   retryDelays 加 30s + 60s — 给 VPN session 重连时间
       *   onError 增 detailed log (XHR status / responseText / cause) — 下次
       *     失败有可读诊断信息,不再是 [object ProgressEvent] 黑盒 */
      await new Promise((resolve, reject) => {
        const upload = new tus.Upload(uploadFile, {
          endpoint: uploadURL,
          uploadUrl: uploadURL,        // pre-created URL — skip the create step
          chunkSize: 5 * 1024 * 1024,  // 5 MB chunks (VPN-friendly)
          retryDelays: [0, 1000, 3000, 5000, 10000, 30000, 60000],
          metadata: {
            filename: uploadFile.name,
            filetype: uploadFile.type,
          },
          onError: (err) => {
            /* tus-js-client v4 DetailedError 结构 (node_modules/tus-js-client/
             * lib.esm/error.js):err.originalRequest (HttpRequest wrapper),
             * err.originalResponse (HttpResponse wrapper),err.causingError
             * (root ProgressEvent / TypeError 等)。 */
            const req = err?.originalRequest;
            const res = err?.originalResponse;
            const detail = {
              method: req?.getMethod?.() ?? null,
              url:    req?.getURL?.() ?? null,
              status: res?.getStatus?.() ?? 'n/a (network-level fail before HTTP)',
              body:   res?.getBody?.()?.slice?.(0, 200) ?? null,
              requestId: req?.getHeader?.('X-Request-ID') ?? null,
              cause:  err?.causingError?.message || err?.causingError?.toString?.() || null,
            };
            console.error('[tus upload error]', err?.message);
            console.error('[tus upload detail]', detail);
            console.error('[tus upload raw err]', err);
            reject(new Error(
              `Stream upload failed: ${err?.message || err}` +
              ` | cause: ${detail.cause || 'unknown'}` +
              ` | status: ${detail.status}`
            ));
          },
          onProgress: (bytesUploaded, bytesTotal) => {
            setUploadProgress(Math.round((bytesUploaded / bytesTotal) * 100));
          },
          onSuccess: () => {
            resolve();
          },
        });
        upload.start();
      });

      // Step 3: finalize — flip status to pending_review
      const finalizeResp = await fetch('/api/user-videos/finalize', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${session.access_token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          recordId,
          fileSize: uploadFile.size,
          // §2026-05-15: durationSeconds probed above via HTMLVideoElement.
          // null is OK — server-side column is nullable.
          durationSeconds,
          originalFilename: uploadFile.name,
        })
      });
      const finalizeData = await finalizeResp.json();
      if (!finalizeResp.ok || !finalizeData.success) {
        throw new Error(finalizeData.errMessage || `finalize failed (HTTP ${finalizeResp.status})`);
      }

      setUploadResult({ ok: true });
      // Clear form for next submission
      setUploadFile(null);
      setUploadTitle('');
      setUploadDescription('');
      setUploadCopyrightChecked(false);
      setUploadProgress(0);
    } catch (err) {
      console.error('[handleVideoSubmitForReview]', err);
      setUploadResult({ ok: false, message: err.message || 'Upload failed' });
    } finally {
      setUploadIsSubmitting(false);
    }
  };

  const handleFreeModeGenerate = async () => {
    if (!freePrompt && freeAssets.length === 0) {
      alert('Please enter a prompt or upload reference material first.');
      return;
    }
    
    // Deduct credits (dynamic cost)
    const cost = freeModeCost;
    if (credits < cost) {
      setTokenAlert({ required: cost, current: credits, context: `${freeDuration}s ${videoResolution} video` });
      return;
    }
    const res = await handleDeductCredits();
    if (!res.success) {
      setTokenAlert({ required: res.required ?? cost, current: res.current ?? credits, context: `${freeDuration}s ${videoResolution} video` });
      return;
    }

    setStep(4);
    setRenderProgress(1);
    setIsGeneratingScript(true);

    try {
      setRenderProgress(2);
      await new Promise(r => setTimeout(r, 1000));
      setRenderProgress(3);
      setIsGeneratingScript(false);

      const imageUrls = freeAssets.filter(a => !a.isVideo).map(a => a.url);
      const videoUrls = freeAssets.filter(a => a.isVideo).map(a => a.url);

      const taskId = await generateVolcengineVideo({
        prompt: freePrompt || 'Video generation',
        imageUrl: imageUrls.length > 0 ? imageUrls[0] : null,
        imageUrls: imageUrls.length > 0 ? imageUrls : null,
        videoUrl: videoUrls.length > 0 ? videoUrls[0] : null,
        videoUrls: videoUrls.length > 0 ? videoUrls : null,
        duration: freeDuration,
        ratio: videoRatio,
        resolution: videoResolution,
        model: videoModel,
        generateAudio: true
      });

      // Refresh balance from the authoritative source after the server charge.
      try { const { credits: bal } = await getUserProfile(); if (typeof bal === 'number') setCredits(bal); } catch { /* non-fatal */ }

      // Pass a dummy script
      const dummyScript = { title: freePrompt.substring(0, 20) || 'Free Mode Video' };
      resumeVideoPolling(taskId, dummyScript, imageUrls.length > 0 ? imageUrls[0] : null);

    } catch (err) {
      console.error('Free mode error:', err);
      // Server already refunded its own charge on failure; re-read truth.
      try { const { credits: bal } = await getUserProfile(); if (typeof bal === 'number') setCredits(bal); } catch { /* non-fatal */ }
      if (err?.status === 402 || err?.insufficient) {
        setTokenAlert({ required: err.required ?? cost, current: err.current ?? credits, context: `${freeDuration}s ${videoResolution} video` });
        setStep(0);
        setRenderProgress(0);
        return;
      }
      // §2026-05-25 fei — inline error for the legacy Free-Mode quick-gen
      //   path. Same safety-filter detection, mapped to the freeSegmentError
      //   bucket so it shares the Free Mode card's banner area.
      if (err.message && err.message.includes('InputVideoSensitiveContentDetected.PrivacyInformation')) {
        setFreeSegmentError({
          title: '参考素材含真人面孔,被安全过滤器拒绝',
          message: '请换不含明显真人面孔的素材,或点素材上的「认证」按钮把素材上传到 BytePlus 私有库再重试。',
        });
      } else {
        setFreeSegmentError({
          title: '生成失败',
          message: formatError(err, '请稍后重试。'),
        });
      }
      setStep(0);
      setRenderProgress(0);
    }
  };

  /**
   * Separated, idempotent polling func that checks task.
   * Runs in background loop. Saves output or recovers failure.
   */
  const resumeVideoPolling = async (taskId, currentScript, currentConceptUrl) => {
    try {
      let isDone = false;
      let outVideoUrl = '';
      const startTime = Date.now();
      const TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes

      while(!isDone) {
        if (Date.now() - startTime > TIMEOUT_MS) {
          throw new Error('Video generation timed out (over 30 minutes). Please retry or check system status.');
        }

        await new Promise(r => setTimeout(r, 6000));
        const statusData = await pollVolcengineVideoStatus(taskId);
        if (statusData.status === 'succeeded') {
          isDone = true;
          outVideoUrl = statusData.videoUrl;
        } else if (statusData.status === 'failed' || statusData.status === 'cancelled' || statusData.status === 'timeout') {
          // §2026-06-06 fei — 带上退款信号,catch 里据此三语提示「积分已返还」
          const e = new Error('Video generation failed with status: ' + statusData.status + ' - ' + (statusData.errorMessage || 'Unknown Error'));
          e.videoFailed = true; e.refunded = !!statusData.refunded; e.refundedCredits = statusData.refundedCredits || 0;
          throw e;
        } else if (statusData.status !== 'queued' && statusData.status !== 'running') {
          throw new Error('Video generation encountered an unexpected status: ' + statusData.status);
        }
        // If queued/running, loop simply continues
      }

      // §2026-05-22 fei: "Step 4 Deploy to global CDN" 经常卡 → 改成后台
      //   静默运行。用户在 Seedance 完成的瞬间就能看到视频(TOS URL 直接可
      //   播),不用等 R2/Stream 上传完。流程变成:
      //
      //   旧 (blocking):
      //     Seedance done → upload (await, 30s-2min) → cover (await) →
      //     DB insert (await) → progress=4 → user sees done
      //
      //   新 (background):
      //     Seedance done → progress=4 immediately → user 立刻看到视频
      //     ↓ (后台 fire-and-forget)
      //     upload → cover → DB insert (用 TOS URL 先入库,upload 完再 PATCH 成永久 URL)
      //
      //   Edge case: 用户在 background upload 完成前关 tab → DB 里留的是 TOS
      //   URL (24h 后失效)。后续 publish 流程会 detect TOS URL 并尝试一次
      //   重新上传 (现有的 uploadUrlToCloudflareStream 调用)。
      //
      //   Publish 流程: insertedWorkId 仍立刻可用 (DB row 立刻 insert),
      //   只是 row.video 起初是 TOS URL 后台 PATCH 成 R2/Stream。Publish 按钮
      //   永远工作。
      setPreviewVideoUrl(outVideoUrl);
      setFinalVideoUrl(outVideoUrl);  // immediately give user playable TOS URL
      setRenderProgress(4);  // mark visually done — user can interact NOW
      setStep(4);
      clearPendingTask();  // Seedance succeeded; pending-task storage no longer needed

      // ── Background mirror: upload to R2/Stream + capture cover + insert DB row.
      //    All errors logged, never blocks user. Runs detached (no await).
      (async () => {
        const captureVideoFrame = (url) => new Promise((resolve) => {
          let resolved = false;
          const safeResolve = (val) => { if (!resolved) { resolved = true; resolve(val); } };
          setTimeout(() => safeResolve(null), 8000);
          const video = document.createElement('video');
          video.crossOrigin = 'anonymous';
          video.muted = true;
          video.playsInline = true;
          video.preload = 'auto';
          let hasSeeked = false;
          video.onloadeddata = () => {
            if (!hasSeeked) {
              hasSeeked = true;
              video.currentTime = Math.min(0.5, video.duration / 2);
            }
          };
          video.onseeked = () => {
            const canvas = document.createElement('canvas');
            canvas.width = video.videoWidth;
            canvas.height = video.videoHeight;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
            canvas.toBlob((blob) => {
              if (blob) safeResolve(new File([blob], 'cover.jpg', { type: 'image/jpeg' }));
              else safeResolve(null);
            }, 'image/jpeg', 0.85);
          };
          video.onerror = () => safeResolve(null);
          video.src = url;
          video.load();
        });
        const probeAspectRatio = (videoUrl) => new Promise((resolve) => {
          try {
            const v = document.createElement('video');
            v.preload = 'metadata';
            v.muted = true;
            const cleanup = () => { v.src = ''; };
            v.onloadedmetadata = () => {
              const w = v.videoWidth;
              const h = v.videoHeight;
              cleanup();
              resolve(w > 0 && h > 0 ? `${w}/${h}` : null);
            };
            v.onerror = () => { cleanup(); resolve(null); };
            setTimeout(() => { cleanup(); resolve(null); }, 5000);
            v.src = videoUrl;
          } catch { resolve(null); }
        });

        // §2026-05-22 fei round-2: insert DB row IMMEDIATELY with TOS URL
        //   so Publish flow works even before upload completes. We PATCH
        //   the row's video field after upload succeeds.
        let insertedRowId = null;
        try {
          const { data: authData } = await supabase.auth.getSession();
          /* §2026-05-27 fei — Session-missing branch was previously silent.
           *   When supabase.auth.getSession() returns null (token expired
           *   between login + render completion, OAuth refresh failed, third-
           *   party cookie blocked, etc.), the old code's `if (authData?.session)`
           *   skipped the entire INSERT WITHOUT ANY UI. User saw "Generation
           *   complete" + playable video but Library stayed empty — exactly
           *   the symptom fei reported 2026-05-27 ("新流程的视频依然没有出
           *   现在 Library 中"). Two video tasks succeeded (Seedance task IDs
           *   in generation_logs) but recommended_content gained 0 rows.
           *
           *   Now: if no session, surface a banner + retry that re-fetches
           *   the session at retry time. After user re-logs (or session
           *   refresh completes async), they click retry and the insert
           *   reuses the same video URL — no re-render, no credit burn. */
          if (!authData?.session) {
            console.warn('[background] No active session — INSERT skipped, surfacing banner so user can recover');
            const tryInsertAfterAuth = async () => {
              const { data: freshAuth } = await supabase.auth.getSession();
              if (!freshAuth?.session) {
                setLibrarySaveError({
                  title: '仍未检测到登录',
                  message: '请刷新页面或重新登录后再点「重试保存」。',
                  help: '视频已渲染成功(预览处仍可播)。登录恢复后点重试即写入 Library,无需重新生成。',
                  retry: tryInsertAfterAuth,
                });
                return;
              }
              // Have session now → re-enter the main insert path. Easiest =
              // recursive call into this whole resumeVideoPolling closure is
              // overkill; just build the payload inline + insert.
              const probedAR = await probeAspectRatio(outVideoUrl);
              const draftStr = localStorage.getItem('uvera_story_draft');
              const draftData = draftStr ? JSON.parse(draftStr) : {};
              const baseTags = [VIDEO_TYPE_TAG[videoType] || '#Trailer'];
              if (draftData.seriesId) baseTags.push(`#Series:${draftData.seriesId}`);
              if (draftData.parentId) baseTags.push(`#Parent:${draftData.parentId}`);
              if (draftData.isRecast) baseTags.push('#Recast');
              const payload = {
                artist: freshAuth.session.user.id,
                title: currentScript?.title || currentScript?.summary?.substring(0, 30) + '...',
                video: outVideoUrl,
                cover: currentConceptUrl,
                media_kind: 'Video',
                aspect_ratio: probedAR,
                published: false,
                tags: baseTags,
              };
              const { data: ins, error: insE } = await supabase
                .from('recommended_content').insert([payload]).select();
              if (insE) {
                setLibrarySaveError({
                  title: '重试保存失败',
                  message: insE.message || JSON.stringify(insE),
                  help: '可以再点一次重试。',
                  retry: tryInsertAfterAuth,
                });
                return;
              }
              if (!ins || ins.length === 0) {
                setLibrarySaveError({
                  title: 'RLS 拒绝',
                  message: '权限被拒(空 rows)。请确认登录账户与渲染时一致。',
                  retry: tryInsertAfterAuth,
                });
                return;
              }
              insertedRowId = ins[0].id;
              setInsertedWorkId(insertedRowId);
              setLibrarySaveError(null);
              console.log(`[background] ✅ recovered, inserted recommended_content.id=${insertedRowId}`);
            };
            setLibrarySaveError({
              title: '保存到 Library 暂停 — 登录已失效',
              message: '渲染时拿不到登录 session,Library 写入被跳过。视频本身已渲染成功(预览处可播)。',
              help: '请刷新页面或重新登录后,点「重试保存」即可写入 Library — 无需重新生成视频。',
              retry: tryInsertAfterAuth,
            });
            return;  // exit the inner background promise; insert path resumes via banner retry
          }

          if (authData?.session) {
            const probedAR = await probeAspectRatio(outVideoUrl);
            const draftStr = localStorage.getItem('uvera_story_draft');
            const draftData = draftStr ? JSON.parse(draftStr) : {};
            const baseTags = [VIDEO_TYPE_TAG[videoType] || '#Trailer'];
            if (draftData.seriesId) baseTags.push(`#Series:${draftData.seriesId}`);
            if (draftData.parentId) baseTags.push(`#Parent:${draftData.parentId}`);
            if (draftData.isRecast) baseTags.push('#Recast');

            /* §2026-05-26 fei — Library save failure feedback.
             *   Previously: console.error only. Symptom: user's finished
             *   Quick Mode video plays in preview, but never appears in
             *   Library / Works tab. They have no UI signal that anything
             *   went wrong and no way to retry short of re-rendering from
             *   scratch (= burning more credits). Fei's 5/25 work loss
             *   (~6 videos missing) was this exact bug.
             *
             *   Now: capture the insert payload + show a banner with a
             *   one-click retry. Banner mounts both in Free Mode UI and
             *   Step 4 Render Station so it surfaces no matter which view
             *   the user is currently on. */
            const insertPayload = {
              artist: authData.session.user.id,
              title: currentScript?.title || currentScript?.summary?.substring(0, 30) + '...',
              video: outVideoUrl,  // initially TOS URL — patched after upload
              cover: currentConceptUrl,  // initially storyboard image — patched after frame capture
              media_kind: 'Video',
              aspect_ratio: probedAR,
              published: false,
              tags: baseTags,
            };
            const attemptInsert = async () => {
              const { data: insertedData, error: insertErr } = await supabase
                .from('recommended_content')
                .insert([insertPayload])
                .select();
              if (insertErr) {
                console.error('[background] Failed to insert works row:', insertErr, 'payload=', insertPayload);
                setLibrarySaveError({
                  title: '保存到 Library 失败',
                  message: insertErr.message || JSON.stringify(insertErr),
                  help: '视频本身已渲染成功(在预览处可以播放)。点「重试保存」可以直接把它写到 Library,不需要重新渲染。',
                  retry: async () => { setLibrarySaveError(null); await attemptInsert(); },
                });
                return null;
              }
              if (!insertedData || insertedData.length === 0) {
                // RLS silent denial: Postgrest returns 200 with empty rows
                // when policy blocks. Most common cause is session expiry
                // (auth.uid() returns null → artist != auth.uid() check fails).
                console.warn('[background] insert returned empty rows — likely RLS denial (session expired?)');
                setLibrarySaveError({
                  title: '保存到 Library 被拒绝',
                  message: '数据库权限拒绝 (没有返回错误信息,通常是登录 session 失效)。',
                  help: '请刷新页面或重新登录后,点「重试保存」。视频已渲染成功,刷新不会丢。',
                  retry: async () => { setLibrarySaveError(null); await attemptInsert(); },
                });
                return null;
              }
              insertedRowId = insertedData[0].id;
              setInsertedWorkId(insertedRowId);
              setLibrarySaveError(null);
              console.log(`[background] ✅ Inserted recommended_content.id=${insertedRowId}`);
              return insertedRowId;
            };
            await attemptInsert();
          }
        } catch (insertExn) {
          console.error('[background] DB insert exception:', insertExn);
          setLibrarySaveError({
            title: '保存到 Library 出错',
            message: insertExn.message || String(insertExn),
            help: '视频已渲染成功。刷新页面或检查网络后,点「重试保存」可以重新写入 Library。',
          });
        }

        // Now mirror to permanent storage. May take 30s-2min for free/lite
        //   tier (Stream watermark processing); paid tier R2 is faster.
        let permanentVideoUrl = null;
        try {
          permanentVideoUrl = await uploadUrlToCloudflareStream(outVideoUrl, { taskId });
          console.log('[background] ✅ Video mirrored to permanent storage:', permanentVideoUrl);
          // §2026-05-22 fei iOS Safari fix:
          //   ❌ DO NOT setPreviewVideoUrl(permanentVideoUrl) here — that
          //      changes <video src> mid-playback, which iOS Safari handles
          //      poorly (video goes black + freezes after the swap). Mobile
          //      users were reporting "看到一个画面，播放开始后又变成黑色,
          //      卡住不播了" — root cause was this URL swap.
          //   ✅ Keep playing the TOS URL the user is already on. It works
          //      for the duration of the page session (Volces TOS URLs valid
          //      ~24h). DB row gets PATCHed to permanent below for cross-
          //      session retention.
          //   ✅ finalVideoUrl is what publish/share use — update it so
          //      subsequent actions use the permanent URL even though the
          //      playing video keeps using the TOS one.
          setFinalVideoUrl(permanentVideoUrl);
        } catch (uploadErr) {
          console.error('[background] ⚠️ Permanent storage upload failed — TOS URL still in DB (expires in hours). Publish flow will retry.', uploadErr);
          // Don't surface this to user — they have a working video for now.
          //   If they navigate away + come back later, the TOS URL will be
          //   expired. Publish flow should detect this + retry.
          return;
        }

        // Capture cover from the permanent URL (CORS works) + upload to OSS
        let coverUrlToSave = null;
        try {
          const coverFile = await captureVideoFrame(permanentVideoUrl);
          if (coverFile) {
            coverUrlToSave = await uploadToSecureOSS(coverFile);
          }
        } catch (coverErr) {
          console.warn('[background] cover capture failed:', coverErr);
        }

        // PATCH the DB row with permanent URL + cover (if we got both)
        if (insertedRowId) {
          try {
            const patchFields = { video: permanentVideoUrl };
            if (coverUrlToSave) patchFields.cover = coverUrlToSave;
            const { error: patchErr } = await supabase.from('recommended_content')
              .update(patchFields)
              .eq('id', insertedRowId);
            if (patchErr) console.error('[background] DB PATCH failed:', patchErr);
            else console.log('[background] ✅ DB row patched with permanent URL + cover');
          } catch (patchExn) {
            console.error('[background] DB PATCH exception:', patchExn);
          }
        }
      })();  // fire-and-forget — no await
    } catch (err) {
      console.error('Render pipeline error:', err);
      // Server refunds async video failures (video/status path); re-read truth.
      try { const { credits: bal } = await getUserProfile(); if (typeof bal === 'number') setCredits(bal); } catch { /* non-fatal */ }
      // §2026-05-25 fei — inline render error banner (post-Seedance pipeline)
      // §2026-06-06 fei — 视频失败且已退款 → 三语「积分已返还」置顶
      setRenderError({
        title: err?.videoFailed ? t('videoFailTitle') : 'Seedance 渲染管线失败',
        message: (err?.videoFailed && err?.refunded ? t('creditsRefunded') + '\n\n' : '') + formatError(err, '已回到图片确认页。点击确认图后可重试整段渲染。'),
      });
      setRenderProgress(1.5); // Go back to image confirmation on video error
      clearPendingTask();
    }
  };

  const handleShare = async () => {
    try {
      const shareText = `Check out the cinematic video I generated on UVERA.ai: ${previewVideoUrl || window.location.href}`;
      if (navigator.share) {
        await navigator.share({ title: 'UVERA.ai Video', text: shareText, url: previewVideoUrl || window.location.href });
      } else {
        await navigator.clipboard.writeText(shareText);
        alert('Share link copied to clipboard.');
      }
      
      const res = await handleShareCredits();
      if (res.success) {
        setCredits(res.newCredits);
        setDailyShareCount(res.newCount);
        alert(`Share successful — +10 tokens! (${res.newCount}/3 shares today)`);
      } else if (res.reason === 'daily_limit_reached') {
        alert('Daily share reward limit reached (3/3). Come back tomorrow.');
      }
    } catch (err) {
      console.log('Share canceled or failed', err);
    }
  };

  const handlePublishToFeed = async () => {
    if (!insertedWorkId) {
      alert("No work ID found. The video might not be saved yet.");
      return;
    }

    setIsPublishing(true);
    try {
      // 2026-04-25 — DB schema ships allow_branch / allow_recast; persist user opt-in.
      // See migrations/20260425_branch_recast_authorization.up.sql + docs/legal/COMPLIANCE.md.
      // §2026-05-31 Leon round-103 Phase B — also persist allow_download.
      //   Default OFF (DB-side default + frontend default) so this opt-in is
      //   never silently set without the creator's deliberate check.
      const { error } = await supabase
        .from('recommended_content')
        .update({
          published: true,
          published_at: new Date().toISOString(),
          allow_branch: allowBranch,
          allow_download: allowDownload,
        })
        .eq('id', insertedWorkId);

      if (error) throw error;
      // §2026-06-05 #1 — 发布进 feed 时,确保该作品的 Stream 视频 poster 帧 = 时长
      //   10%(跳过纯黑首帧)。create/short 各模式(Quick/Free/multi-segment/merge)
      //   都经此唯一 publish chokepoint,统一在这兜。fire-and-forget,不阻断发布。
      try {
        const { data: { session } } = await supabase.auth.getSession();
        const { data: pubRow } = await supabase
          .from('recommended_content').select('video,cover').eq('id', insertedWorkId).single();
        const uidMatch = String(pubRow?.video || pubRow?.cover || '').match(/([a-f0-9]{32})/i);
        if (uidMatch) {
          // 设 Stream 视频 poster 帧 = 选中比例(默认 10%)。
          ensureStreamPoster(uidMatch[1], session?.access_token, coverPct);
          // 创作者主动选了帧 → 把 feed 封面指向 Stream thumbnail(那帧),即便原
          //   cover 是概念图也覆盖,确保封面 = 所选帧。未动过则不覆盖原 cover。
          if (coverTouched) {
            const thumb = `https://videodelivery.net/${uidMatch[1]}/thumbnails/thumbnail.jpg`;
            if (pubRow?.cover !== thumb) {
              await supabase.from('recommended_content').update({ cover: thumb }).eq('id', insertedWorkId);
            }
          }
        }
      } catch { /* never block publish */ }
      // Clear persisted wizard state so the user doesn't get a ghost "still
      // rendering" UI if they leave /create and come back later — the work is
      // published, there's nothing to resume.
      localStorage.removeItem('uvera_story_draft');
      localStorage.removeItem('uvera_pending_video_task');
      // §2026-05-25 fei: also clear the server row for this mode so the
      //   published draft doesn't reappear on another device. Fire-and-forget.
      deleteDraft(generationMode || 'quick').catch(() => {});
      // Show in-app success card — replaces the old blocking alert().
      setPublishComplete(true);
      setInsertedWorkId(null); // Prevent re-publishing
    } catch (err) {
      console.error('Publish error:', err);
      alert('Publish failed: ' + err.message);
    } finally {
      setIsPublishing(false);
    }
  };

  /**
   * Persist the current Series form state (title, description, cast,
   * episodes) to public.series. First save INSERTs and remembers the
   * id; subsequent saves UPDATE the same row. RLS scopes both paths to
   * the current user.
   *
   * v1.0.6 GA only writes status='draft'. Publishing is v1.1 — when we
   * ship it, this same handler will accept a `publish: true` flag.
   */
  const handleSaveSeries = async () => {
    if (!seriesTitle.trim()) {
      setSeriesSaveError('Please give your series a title before saving.');
      return;
    }
    setSeriesSaveError(null);
    setIsSavingSeries(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error('You must be logged in to save a series.');

      const res = await fetch('/api/series/save', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${session.access_token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          seriesId: currentSeriesId,        // null = create new
          title: seriesTitle.trim(),
          description: seriesDescription.trim() || null,
          castIds: seriesCastIds,
          // Persist the full episode shape so reload + future Stream
          // playback can reconstruct rendering decisions.
          episodes: seriesEpisodes,
          status: 'draft',
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.errMessage || `Save failed (HTTP ${res.status})`);
      }

      setCurrentSeriesId(data.id);
      setLastSavedAt(new Date());
    } catch (err) {
      console.error('[handleSaveSeries]', err);
      setSeriesSaveError(err.message || 'Save failed');
    } finally {
      setIsSavingSeries(false);
    }
  };

  /**
   * Publish the series to Discover. Two-step under the hood:
   *   1. If we don't have a currentSeriesId yet (user clicked Publish
   *      before Save), do an implicit save first so the series exists
   *      in the DB. UX: never make the user click two buttons.
   *   2. POST /api/series/publish — server validates ≥1 ready episode,
   *      flips status='published', and upserts a recommended_content
   *      row tagged 'series:<id>' so the card appears on Discover.
   *
   * The Discover card auto-republishes (UPDATE not INSERT) if the user
   * publishes again after edits, keyed by the series:<id> tag.
   */
  const handlePublishSeries = async () => {
    if (!seriesTitle.trim()) {
      setSeriesSaveError('Please give your series a title before publishing.');
      return;
    }
    const readyCount = seriesEpisodes.filter(ep => ep.status === 'ready' && ep.url).length;
    if (readyCount === 0) {
      setSeriesSaveError('Add at least one episode with a video before publishing.');
      return;
    }
    if (!window.confirm(
      `Publish "${seriesTitle.trim()}" to Discover?\n\n` +
      `${readyCount} episode${readyCount === 1 ? '' : 's'} will be visible.\n` +
      `You can edit and republish later — viewers will see the latest version.`
    )) {
      return;
    }

    setSeriesSaveError(null);
    setIsPublishingSeries(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error('You must be logged in to publish.');

      // Step 1: ensure the series is saved (implicit save if first publish)
      let seriesIdToPublish = currentSeriesId;
      if (!seriesIdToPublish) {
        const saveRes = await fetch('/api/series/save', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${session.access_token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            seriesId: null,
            title: seriesTitle.trim(),
            description: seriesDescription.trim() || null,
            castIds: seriesCastIds,
            episodes: seriesEpisodes,
            status: 'draft',
          }),
        });
        const saveData = await saveRes.json();
        if (!saveRes.ok || !saveData.success) {
          throw new Error(saveData.errMessage || `Implicit save failed (HTTP ${saveRes.status})`);
        }
        seriesIdToPublish = saveData.id;
        setCurrentSeriesId(saveData.id);
      } else {
        // Always re-save current state right before publishing to make
        // sure the published card reflects the latest edits.
        await fetch('/api/series/save', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${session.access_token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            seriesId: seriesIdToPublish,
            title: seriesTitle.trim(),
            description: seriesDescription.trim() || null,
            castIds: seriesCastIds,
            episodes: seriesEpisodes,
            status: 'draft',  // server flips to 'published' below
          }),
        });
      }

      // Step 2: publish
      const pubRes = await fetch('/api/series/publish', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${session.access_token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ seriesId: seriesIdToPublish }),
      });
      const pubData = await pubRes.json();
      if (!pubRes.ok || !pubData.success) {
        throw new Error(pubData.errMessage || `Publish failed (HTTP ${pubRes.status})`);
      }

      setSeriesStatus('published');
      setLastSavedAt(new Date());
    } catch (err) {
      console.error('[handlePublishSeries]', err);
      setSeriesSaveError(err.message || 'Publish failed');
    } finally {
      setIsPublishingSeries(false);
    }
  };

  /**
   * Archive (unpublish) a published series. Removes the corresponding
   * card from Discover and flips status to 'archived'. The series row
   * itself is preserved — owner can republish later.
   */
  const handleArchiveSeries = async () => {
    if (!currentSeriesId) return;
    if (!window.confirm(
      `Unpublish "${seriesTitle.trim()}" from Discover?\n\n` +
      `Viewers will no longer see this series. You can republish anytime.`
    )) {
      return;
    }
    setSeriesSaveError(null);
    setIsPublishingSeries(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error('You must be logged in.');
      const res = await fetch('/api/series/archive', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${session.access_token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ seriesId: currentSeriesId }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.errMessage || `Archive failed (HTTP ${res.status})`);
      }
      setSeriesStatus('archived');
      setLastSavedAt(new Date());
    } catch (err) {
      console.error('[handleArchiveSeries]', err);
      setSeriesSaveError(err.message || 'Archive failed');
    } finally {
      setIsPublishingSeries(false);
    }
  };

  /**
   * Move an episode up or down in the ordered list. Used by the
   * up/down arrow buttons in the series episode editor. Edge cases
   * (first/last) are guarded by button disabled state.
   */
  const moveEpisode = (idx, direction) => {
    setSeriesEpisodes(prev => {
      const next = [...prev];
      const newIdx = idx + direction;
      if (newIdx < 0 || newIdx >= next.length) return prev;
      [next[idx], next[newIdx]] = [next[newIdx], next[idx]];
      return next;
    });
  };

  /**
   * Upload an episode video file. Routes by size:
   *   - ≤ 90 MB  → R2 via uploadToSecureOSS (fast, direct .mp4 URL works
   *                with the existing <video> tag thumbnail preview)
   *   - > 90 MB  → Cloudflare Stream via tus protocol (resumable, up to
   *                500 MB; playback uses Stream's iframe / HLS, thumbnail
   *                preview uses Stream's auto-generated JPG)
   *
   * Server-side route /api/internal-video/init-upload mints the Stream tus
   * URL — no admin review queue (these are user's working files, not
   * Discover-bound).
   */
  const handleUploadEpisodeVideo = async (idx, file) => {
    if(!file) return;
    if (!file.type.startsWith('video/')) {
      alert('Please select a video file (mp4 / webm / mov).');
      return;
    }
    const HARD_MAX = 500 * 1024 * 1024;
    if (file.size > HARD_MAX) {
      alert(`File too large (${(file.size / 1024 / 1024).toFixed(0)} MB). Max 500 MB.`);
      return;
    }
    const newEps = [...seriesEpisodes];
    newEps[idx].status = 'uploading';
    setSeriesEpisodes(newEps);
    try {
      const isLarge = file.size > 90 * 1024 * 1024;
      let updatedEpisode;

      if (!isLarge) {
        // Small file: existing R2 path. Direct .mp4 URL plays in <video>.
        const url = await uploadToSecureOSS(file);
        updatedEpisode = { url, streamUid: null, thumbnailUrl: null };
      } else {
        // Big file: Stream tus protocol via internal-video endpoint.
        const { data: { session } } = await supabase.auth.getSession();
        if (!session) throw new Error('You must be logged in to upload videos.');

        const initResp = await fetch('/api/internal-video/init-upload', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${session.access_token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ fileSize: file.size }),
        });
        const initData = await initResp.json();
        if (!initResp.ok || !initData.success) {
          throw new Error(initData.errMessage || `init-upload failed (HTTP ${initResp.status})`);
        }
        const { uploadURL, streamUid, playbackUrl, thumbnailUrl } = initData;

        /* §2026-05-25 round-74 — 同 handleVideoSubmitForReview tus tune,
         * 详见上方 doc block。Series episode upload 同样改 5MB chunk +
         * 109s retry window + XHR detail log。 */
        await new Promise((resolve, reject) => {
          const upload = new tus.Upload(file, {
            endpoint: uploadURL,
            uploadUrl: uploadURL,
            chunkSize: 5 * 1024 * 1024,
            retryDelays: [0, 1000, 3000, 5000, 10000, 30000, 60000],
            metadata: { filename: file.name, filetype: file.type },
            onError: (err) => {
              /* tus-js-client v4 — 同上 doc block,抽 method/url/status/body/cause */
              const req = err?.originalRequest;
              const res = err?.originalResponse;
              const detail = {
                method: req?.getMethod?.() ?? null,
                url:    req?.getURL?.() ?? null,
                status: res?.getStatus?.() ?? 'n/a (network-level fail before HTTP)',
                body:   res?.getBody?.()?.slice?.(0, 200) ?? null,
                requestId: req?.getHeader?.('X-Request-ID') ?? null,
                cause:  err?.causingError?.message || err?.causingError?.toString?.() || null,
              };
              console.error('[tus episode upload error]', err?.message);
              console.error('[tus episode upload detail]', detail);
              console.error('[tus episode upload raw err]', err);
              reject(new Error(`Stream upload failed: ${err?.message || err} | cause: ${detail.cause || 'unknown'} | status: ${detail.status}`));
            },
            onSuccess: resolve,
          });
          upload.start();
        });

        // Note: thumbnailUrl returns 404 for ~10–30s while Stream processes
        // the video. The <img> tag below will lazy-retry until it loads;
        // we accept this brief gap as a UX trade-off vs the much more
        // complex alternative of polling /stream/<uid> for ready status.
        updatedEpisode = { url: playbackUrl, streamUid, thumbnailUrl };
      }

      const updatedEps = [...seriesEpisodes];
      updatedEps[idx] = { ...updatedEps[idx], ...updatedEpisode, status: 'ready' };
      setSeriesEpisodes(updatedEps);
    } catch (e) {
      // §2026-05-25 fei — inline upload banner (series episode upload site)
      setUploadError({
        title: 'Episode 上传失败',
        message: formatError(e, '请重新点上传按钮选择文件。'),
      });
      const updatedEps = [...seriesEpisodes];
      updatedEps[idx].status = 'empty';
      setSeriesEpisodes(updatedEps);
    }
  };

  /* ── A.5 control-deck cards (2026-05-11 Leon) ─────────────────────────────
   * cards 提到 return 外面,供 (1) 顶层 pills bar 和 (2) select branch 的 hero
   * panel 共用。pills bar 在所有 creationLevel 下都渲染(isSequel/isRecast
   * 除外),实现「pills 持久 + 内容 swap」控制台模式。 */
  const cards = [
    {
      key: 'short',
      title: 'Short',
      label: 'INSTANT',
      icon: Sparkle,
      accent: 'accent',
      description: 'One-shot generation. Use Free mode or the guided wizard to spin up a standalone short video in a single pass.',
      onSelect: () => setCreationLevel('quick'),
    },
    {
      key: 'series',
      title: 'Series',
      label: 'EPISODIC',
      icon: FilmStrip,
      accent: 'accent',
      description: 'Build a full story arc with a recurring cast. Generate or upload episode by episode for an immersive serialized experience.',
      onSelect: () => setCreationLevel('series'),
    },
    {
      key: 'flow',
      title: 'Flow',
      label: 'PRO',
      icon: FlowArrow,
      accent: 'purple',
      badge: creativeCanvasRequested ? 'Requested' : 'Beta',
      description: 'Infinite canvas with node-based AI workflow. Chain generation cards through multi-input connections to compose complex creations.',
      statusNote: creativeCanvasRequested
        ? "We've recorded your request and will reach out when it's ready."
        : 'Beta not yet open — pin this card to request access.',
      /* Flow click 不再直接 submit beta,改成 toggle pin → 展示详情。
         beta 请求改在 panel 内的 CTA 触发(only-when-pinned,避免 hover 丢失)。 */
      onSelect: () => {
        if (creationLevel !== 'select') setCreationLevel('select');
        setPinnedCard(pinnedCard === 'flow' ? null : 'flow');
      },
    },
  ];
  const activeKey  = pinnedCard || hoveredCard;
  const activeCard = activeKey ? cards.find(c => c.key === activeKey) : null;
  /* isCurrentMode 决定 pill 是否高亮反映「当前所在 mode」 */
  const isCurrentMode = (cardKey) =>
    (cardKey === 'short'  && creationLevel === 'quick') ||
    (cardKey === 'series' && creationLevel === 'series') ||
    (cardKey === 'flow'   && creationLevel === 'select' && pinnedCard === 'flow');

  return (
    /* A.5 layout — pills bar persistent at top, content area below scrolls.
     * 整页 h-full + overflow-hidden,内部 flex-col 让 pills shrink-0 + content
     * area flex-1 overflow-y-auto 各司其职。 */
    <div className="flex flex-col h-full overflow-hidden">
      {/* ── Persistent pills bar (Short/Series/Flow) ────────────────────────
        * Desktop pills 已移到 Header center (NavigationBar.jsx CreateChannelPills)。
        * 此处只为 mobile 渲染 — mobile header 太挤放不下 3 pills,保留在内容区上方。 */}
      {/* 2026-05-19 round-48 (Leon) — Mobile pills 改 horizontal 3 等分:
        * · flex-col → flex-row,3 个 pill 平行
        * · 去掉 eyebrow (INSTANT/EPISODIC/PRO label)
        * · 去掉 chevron toggle (mobile 不展开 detail panel,tap = onSelect 直入)
        * · rounded-[24px] → rounded-full (短 pill 视觉更紧凑)
        * · icon background circle (32×32) → 裸 icon 16px (节省 horizontal 空间)
        * Desktop layout 不变 — 此 branch 已是 `isSmallScreen &&` mobile-only。 */}
      {isSmallScreen && !(isSequel || isRecast) && (
        <div className="shrink-0 px-4 pt-1 animate-fade-in">
          <div className="w-full max-w-3xl mx-auto">
            <div className="flex flex-row gap-2 items-stretch">
              {cards.map(card => {
                const isActive  = pinnedCard === card.key || isCurrentMode(card.key);
                const Icon      = card.icon;
                const iconColor = card.accent === 'purple' ? 'text-label-tertiary' : 'text-accent';
                return (
                  <button
                    key={card.key}
                    onClick={card.onSelect}
                    disabled={card.disabled}
                    className={`group flex-1 min-w-0 rounded-full ${isActive ? 'glass-clear' : 'glass-ultra-thin'} px-3 py-2 flex items-center justify-center gap-1.5 transition-colors cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed`}
                  >
                    <Icon size={16} weight="fill" className={`shrink-0 ${iconColor}`} />
                    <span className="text-sm font-medium text-label truncate">{card.title}</span>
                    {card.badge && (
                      <span className="shrink-0 ml-0.5 px-1 py-px rounded-full text-[8px] font-semibold uppercase bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300 border border-amber-200 dark:border-amber-800">
                        {card.badge}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* ── Content area — scrolls independently below pills ──────────────
        * lg:-translate-x-10 = pills bar 同位移,所有 mode 子页面统一对齐
        * viewport center,不被 Sidebar pl-20 拉偏。 */}
      <div className={`flex-1 min-h-0 overflow-y-auto ${isSmallScreen ? 'px-4 pb-4' : 'px-6 pb-6'} lg:-translate-x-10`}>
      {creationLevel === 'select' && !(isSequel || isRecast) ? (
        /* Hero panel — viewport center vertically, swaps based on active pill.
           translate-x 由 content-area 父级统一管,这里不再重复。 */
        <div className="w-full max-w-3xl mx-auto h-full flex flex-col justify-center items-center text-center pt-12 animate-fade-in">
          {activeCard ? (
            <div key={activeCard.key} className="max-w-xl">
              {/* Flow when tier < STUDIO: 显示 locked preview (lock icon + upgrade CTA)
                  Flow when tier === STUDIO: 显示 standard hero + beta request CTA
                  Series/Short: 标准 hero (Series 进入后 form 内部会显示 LockedPreview) */}
              {activeCard.key === 'flow' && !canAccessFlow(userTier) ? (
                <>
                  <div className="w-14 h-14 mx-auto rounded-full bg-fill-secondary flex items-center justify-center mb-5">
                    <Lock size={24} weight="fill" className="text-label-tertiary" />
                  </div>
                  <p className="text-xs font-semibold text-label-tertiary tracking-widest uppercase mb-1 leading-none">
                    Locked · Available on {TIER_DISPLAY[tierUnlocking('flow')]?.label}
                  </p>
                  <h2
                    className={`${isSmallScreen ? 'text-3xl' : 'text-4xl'} font-medium text-label tracking-tight leading-none`}
                    style={{ fontFamily: "'Crimson Pro', 'Georgia', serif" }}
                  >
                    {activeCard.title} mode
                  </h2>
                  <p className="text-label-secondary mt-3 text-base leading-relaxed">
                    {activeCard.description}
                  </p>
                  <ul className="text-sm text-label-secondary space-y-2 mt-6 mb-2 text-left mx-auto max-w-sm">
                    <li className="flex gap-2"><span className="text-accent">✓</span><span>Infinite canvas, no linear constraint</span></li>
                    <li className="flex gap-2"><span className="text-accent">✓</span><span>Node-based AI workflow composition</span></li>
                    <li className="flex gap-2"><span className="text-accent">✓</span><span>4 Actors, 1080p output (4K upscale in development)</span></li>
                    <li className="flex gap-2"><span className="text-accent">✓</span><span>All Series features included</span></li>
                  </ul>
                  <button
                    onClick={() => openSubscriptionModal()}
                    className="mt-6 inline-flex items-center gap-2 px-6 py-2.5 rounded-full bg-accent hover:bg-accent/90 text-white text-sm font-medium transition-colors cursor-pointer"
                  >
                    Upgrade to {TIER_DISPLAY[tierUnlocking('flow')]?.label}
                    <ArrowRight size={16} />
                  </button>
                </>
              ) : (
                <>
                  <p className={`text-xs font-semibold tracking-widest uppercase mb-1 leading-none ${activeCard.accent === 'purple' ? 'text-label-tertiary' : 'text-accent'}`}>
                    {activeCard.label}
                  </p>
                  <h2
                    className={`${isSmallScreen ? 'text-3xl' : 'text-4xl'} font-medium text-label tracking-tight leading-none`}
                    style={{ fontFamily: "'Crimson Pro', 'Georgia', serif" }}
                  >
                    {activeCard.title}
                  </h2>
                  <p className="text-label-secondary mt-3 text-base leading-relaxed">
                    {activeCard.description}
                  </p>
                  {activeCard.statusNote && (
                    <p className={`mt-2 text-sm ${creativeCanvasRequested ? 'text-emerald-600 dark:text-emerald-400' : 'text-label-tertiary'}`}>
                      {activeCard.statusNote}
                    </p>
                  )}
                  {/* Flow Beta request — only for STUDIO tier (gated by outer condition)
                      AND when pinned (panel persistent, CTA click safe). */}
                  {activeCard.key === 'flow' && pinnedCard === 'flow' && !creativeCanvasRequested && (
                    <button
                      onClick={handleRequestCreativeCanvas}
                      disabled={isRequestingBeta}
                      className="mt-6 inline-flex items-center gap-2 px-5 py-2.5 rounded-full bg-label-tertiary hover:bg-label-tertiary/80 text-background text-sm font-medium transition-colors cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed"
                    >
                      {isRequestingBeta ? 'Submitting…' : 'Request Beta access'}
                      <ArrowRight size={16} />
                    </button>
                  )}
                </>
              )}
            </div>
          ) : (
            <div className="max-w-xl">
              <p className="text-xs font-semibold text-accent tracking-widest uppercase mb-1 leading-none">Create</p>
              <h2
                className={`${isSmallScreen ? 'text-3xl' : 'text-4xl'} font-medium text-label tracking-tight leading-none`}
                style={{ fontFamily: "'Crimson Pro', 'Georgia', serif" }}
              >
                Start your creation
              </h2>
              <p className="text-label-tertiary mt-2 text-sm leading-relaxed">
                Choose a flow that fits the work you have in mind.
              </p>
            </div>
          )}
        </div>
      ) : creationLevel === 'series' && !(isSequel || isRecast) && !canAccessSeries(userTier) ? (
        /* P1 locked preview: tier 不够时不显示 Series form,改显示 upgrade hero。 */
        <div className="w-full max-w-2xl mx-auto h-full flex flex-col justify-center items-center text-center pt-12 pb-12 animate-fade-in">
          <div className="w-14 h-14 rounded-full bg-fill-secondary flex items-center justify-center mb-5">
            <Lock size={24} weight="fill" className="text-label-tertiary" />
          </div>
          <p className="text-xs font-semibold text-label-tertiary tracking-widest uppercase mb-1 leading-none">
            Locked · Available on {TIER_DISPLAY[tierUnlocking('series')]?.label}
          </p>
          <h2
            className={`${isSmallScreen ? 'text-3xl' : 'text-4xl'} font-medium text-label tracking-tight leading-none mb-4`}
            style={{ fontFamily: "'Crimson Pro', 'Georgia', serif" }}
          >
            Series mode
          </h2>
          <p className="text-base text-label-secondary leading-relaxed max-w-md mb-6">
            Build a full story arc with a recurring cast. Generate or upload episode by episode for an immersive serialized experience.
          </p>
          <ul className="text-sm text-label-secondary space-y-2 mb-8 text-left max-w-sm">
            <li className="flex gap-2"><span className="text-accent">✓</span><span>Connect episodes into a coherent narrative</span></li>
            <li className="flex gap-2"><span className="text-accent">✓</span><span>Reuse Actors across the whole series</span></li>
            <li className="flex gap-2"><span className="text-accent">✓</span><span>Bigger Avatar quotas (3 Actors × 8 Chars)</span></li>
            <li className="flex gap-2"><span className="text-accent">✓</span><span>1080p output, no watermark</span></li>
          </ul>
          <button
            onClick={() => openSubscriptionModal()}
            className="inline-flex items-center gap-2 px-6 py-2.5 rounded-full bg-accent hover:bg-accent/90 text-white text-sm font-medium transition-colors cursor-pointer"
          >
            Upgrade to {TIER_DISPLAY[tierUnlocking('series')]?.label}
            <ArrowRight size={16} />
          </button>
        </div>
      ) : creationLevel === 'series' && !(isSequel || isRecast) ? (
        <div className="w-full max-w-4xl mx-auto flex flex-col gap-6 pt-4 pb-20 animate-fade-in">
          {/* Back button + heading removed (2026-05-11 A.5): pills bar 顶端
              已 active 高亮 Series,导航职责归 pills + Sidebar Create */}

          <div className="bg-background-secondary border border-background-tertiary rounded-2xl p-6 md:p-7 space-y-6">
             <div>
               <label className="block text-sm font-medium text-label mb-2">Series title</label>
               <input 
                 type="text" 
                 value={seriesTitle}
                 onChange={e => setSeriesTitle(e.target.value)}
                 placeholder="Give your series a memorable name"
                 className="w-full rounded-2xl border border-background-tertiary bg-background px-4 py-3 text-base text-label placeholder-label-quaternary focus:outline-none focus:ring-2 focus:ring-accent/30 focus:border-accent/50 transition-all"
               />
             </div>
             <div>
               <label className="block text-sm font-medium text-label mb-2">Series description</label>
               <textarea
                 value={seriesDescription}
                 onChange={e => setSeriesDescription(e.target.value)}
                 placeholder="Briefly describe the world or central storyline of this series…"
                 rows={3}
                 className="w-full resize-none rounded-2xl border border-background-tertiary bg-background px-4 py-3 text-base text-label placeholder-label-quaternary focus:outline-none focus:ring-2 focus:ring-accent/30 focus:border-accent/50 transition-all"
               />
             </div>
             
             <div>
               <label className="block text-sm font-medium text-label mb-2">Cast (Actors)</label>
               <div className="flex flex-wrap gap-4">
                  {seriesCastIds.map(id => {
                     const char = characters.find(c => c.id === id);
                     if(!char) return null;
                     return (
                        <div key={id} className="relative aspect-[3/4] w-20 rounded-xl overflow-hidden border-2 border-accent group">
                          <img src={char.photo_url} className="w-full h-full object-cover" />
                          <button onClick={() => setSeriesCastIds(prev => prev.filter(cId => cId !== id))} className="absolute top-1 right-1 bg-black/50 p-1 rounded-full text-white opacity-0 group-hover:opacity-100 transition-opacity">
                             <X size={12} />
                          </button>
                        </div>
                     );
                  })}
                  <button onClick={() => setShowCastPicker(true)} className="aspect-[3/4] w-20 rounded-xl border-2 border-dashed border-background-tertiary flex flex-col items-center justify-center text-label-secondary hover:border-accent hover:text-accent transition-colors">
                     <Plus size={24} />
                     <span className="text-[10px] mt-1">Pick Avatar</span>
                  </button>
               </div>
             </div>

             {showCastPicker && (
               <div className="p-4 border border-background-tertiary rounded-xl bg-background-secondary animate-fade-in">
                 <div className="flex justify-between items-center mb-4">
                   <h4 className="text-sm font-medium text-label">Choose Actors</h4>
                   <button onClick={() => setShowCastPicker(false)} className="text-label-secondary hover:text-label"><X size={16} /></button>
                 </div>
                 <div className="flex flex-wrap gap-3">
                   {/* §2026-05-22 fei: filter out legacy AI-generated characters
                       — picker shows only source Avatars (uploaded photos). */}
                   {characters.filter(char => {
                     try {
                       const f = typeof char.identity_features === 'string' ? JSON.parse(char.identity_features) : (char.identity_features || {});
                       return f.createdVia !== 'generated_concept';
                     } catch { return true; }
                   }).map(char => {
                     const isSelected = seriesCastIds.includes(char.id);
                     return (
                       <button
                         key={char.id}
                         onClick={() => {
                           if(isSelected) setSeriesCastIds(prev => prev.filter(id => id !== char.id));
                           else setSeriesCastIds(prev => [...prev, char.id]);
                         }}
                         className={`relative w-16 aspect-[3/4] rounded-lg overflow-hidden border-2 ${isSelected ? 'border-accent' : 'border-transparent'}`}
                       >
                         <img src={char.photo_url} className="w-full h-full object-cover" />
                         {isSelected && <div className="absolute inset-0 bg-accent/20 flex items-center justify-center"><CheckCircle size={20} weight="fill" className="text-accent drop-shadow-md" /></div>}
                       </button>
                     );
                   })}
                 </div>
               </div>
             )}

             <div className="pt-6 border-t border-background-secondary">
                <div className="flex items-center justify-between mb-4">
                   <h3 className="text-lg font-medium text-label">Episodes</h3>
                   <button onClick={() => setSeriesEpisodes(prev => [...prev, { id: Date.now(), title: `Episode ${prev.length + 1}`, status: 'empty' }])} className="text-accent text-sm font-medium flex items-center gap-1 hover:opacity-80 transition-opacity">
                      <Plus size={16} /> Add episode
                   </button>
                </div>
                
                <div className="space-y-4">
                   {seriesEpisodes.length === 0 ? (
                      <div className="text-center py-8 text-label-secondary text-sm bg-background-secondary rounded-xl border border-background-tertiary">
                         No episodes yet — tap the button at the top right to add one.
                      </div>
                   ) : (
                      seriesEpisodes.map((ep, idx) => (
                         <div key={ep.id} className="flex items-center justify-between p-4 border border-background-tertiary rounded-xl hover:border-accent/30 transition-colors bg-background">
                            <div className="flex items-center gap-4 flex-1">
                               <div className="w-12 h-12 bg-background-secondary rounded-lg flex items-center justify-center font-bold text-label-secondary shrink-0">
                                  {idx + 1}
                               </div>
                               <div className="flex-1">
                                  <input 
                                     type="text" 
                                     value={ep.title} 
                                     onChange={(e) => {
                                        const newEps = [...seriesEpisodes];
                                        newEps[idx].title = e.target.value;
                                        setSeriesEpisodes(newEps);
                                     }}
                                     className="font-medium text-label bg-transparent border-none outline-none focus:border-b focus:border-accent w-full max-w-sm"
                                  />
                                  <div className="text-xs text-label-secondary mt-1">
                                     {ep.status === 'empty' ? 'No content added' : ep.status === 'uploading' ? 'Processing video…' : 'Content ready'}
                                  </div>
                               </div>
                            </div>
                            <div className="flex items-center gap-2 shrink-0 pl-4">
                               {ep.status === 'empty' ? (
                                  <>
                                     <label className="px-3 py-1.5 bg-background-secondary hover:bg-background-tertiary rounded-lg text-sm font-medium text-label transition-colors cursor-pointer text-center">
                                        <input type="file" className="hidden" accept="video/mp4" onChange={(e) => handleUploadEpisodeVideo(idx, e.target.files[0])} />
                                        Upload video
                                     </label>
                                     <button 
                                       onClick={() => alert("Coming soon. For now, please choose a published video from the home Library.")}
                                       className="px-3 py-1.5 bg-background-secondary hover:bg-background-tertiary rounded-lg text-sm font-medium text-label transition-colors"
                                     >
                                        Pick video
                                     </button>
                                     <button 
                                       onClick={() => setCreationLevel('quick')}
                                       className="px-3 py-1.5 bg-accent text-white rounded-lg text-sm font-medium hover:bg-accent/90 transition-colors flex items-center gap-1"
                                     >
                                        <Sparkle size={14} /> AI generate
                                     </button>
                                  </>
                               ) : ep.status === 'ready' && ep.url ? (
                                  // Stream-hosted episodes (large files) render via the auto-thumbnail JPG.
                                  // R2-hosted episodes (small files, direct .mp4) render via <video>.
                                  ep.streamUid ? (
                                    <img
                                      src={ep.thumbnailUrl}
                                      alt="Episode thumbnail"
                                      className="h-10 w-16 object-cover rounded bg-black"
                                      onError={(e) => {
                                        // Stream thumbnail can 404 for ~30s while video is processing.
                                        // Schedule one retry; if still 404, leave the broken-img placeholder.
                                        if (!e.target.dataset.retried) {
                                          e.target.dataset.retried = '1';
                                          setTimeout(() => { e.target.src = ep.thumbnailUrl + '?t=' + Date.now(); }, 5000);
                                        }
                                      }}
                                    />
                                  ) : (
                                    <video src={ep.url} className="h-10 w-16 object-cover rounded bg-black" />
                                  )
                               ) : ep.status === 'uploading' ? (
                                  <div className="px-3 py-1.5 bg-background-secondary rounded-lg text-sm font-medium text-label-tertiary flex items-center gap-2">
                                     <CircleNotch size={14} className="animate-spin" /> Uploading
                                  </div>
                               ) : null}
                               {/* Reorder + delete controls. Up/down disabled at list edges.
                                   Delete is destructive — confirm if episode has uploaded content. */}
                               <div className="flex items-center ml-2">
                                  <button
                                     onClick={() => moveEpisode(idx, -1)}
                                     disabled={idx === 0}
                                     className="p-1.5 text-label-secondary hover:text-label disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                                     title="Move up"
                                  >
                                     <CaretUp size={14} weight="bold" />
                                  </button>
                                  <button
                                     onClick={() => moveEpisode(idx, 1)}
                                     disabled={idx === seriesEpisodes.length - 1}
                                     className="p-1.5 text-label-secondary hover:text-label disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                                     title="Move down"
                                  >
                                     <CaretDown size={14} weight="bold" />
                                  </button>
                                  <button
                                     onClick={() => {
                                       const hasContent = ep.url || ep.streamUid;
                                       if (hasContent && !window.confirm('Remove this episode? The uploaded video will be detached but not deleted from storage.')) return;
                                       setSeriesEpisodes(prev => prev.filter((_, i) => i !== idx));
                                     }}
                                     className="p-2 text-label-secondary hover:text-red-500 transition-colors"
                                     title="Remove episode"
                                  >
                                     <X size={16} />
                                  </button>
                               </div>
                            </div>
                         </div>
                      ))
                   )}
                </div>
             </div>

             {/* ─── Save bar ───────────────────────────────────────────────
                 Sticks to the bottom of the form card. Save Draft is the
                 only action wired up in v1.0.6 GA — Publish is v1.1.
                 We deliberately render the Publish button as disabled +
                 "Coming soon" copy so users know the feature is on the
                 roadmap rather than thinking it's broken. */}
             <div className="pt-6 border-t border-background-secondary">
                {seriesSaveError && (
                  <div className="mb-4 p-3 rounded-xl bg-red-500/10 border border-red-500/30 text-xs text-red-500">
                    {seriesSaveError}
                  </div>
                )}
                {seriesStatus === 'published' && (
                  <div className="mb-4 p-3 rounded-xl bg-amber-500/10 border border-amber-500/30 text-xs text-amber-700">
                    ⚠️ This series is currently <strong>published on Discover</strong>. Saving / republishing will update what viewers see immediately. To temporarily hide it, use Unpublish.
                  </div>
                )}
                <div className="flex flex-col-reverse sm:flex-row sm:items-center gap-3 flex-wrap">
                   <div className="flex-1 text-xs text-label-tertiary">
                      {seriesStatus === 'published' ? (
                        <span className="inline-flex items-center gap-1.5 text-emerald-600">
                          <CheckCircle size={14} weight="fill" /> Published to Discover · {lastSavedAt?.toLocaleTimeString()}
                        </span>
                      ) : seriesStatus === 'archived' ? (
                        <span className="inline-flex items-center gap-1.5 text-label-tertiary">
                          <Archive size={14} /> Archived · republish anytime
                        </span>
                      ) : lastSavedAt ? (
                        <>Saved as draft · {lastSavedAt.toLocaleTimeString()}</>
                      ) : (
                        <>Drafts save to your account — come back later to finish.</>
                      )}
                   </div>
                   {seriesStatus === 'published' && (
                     <button
                        onClick={handleArchiveSeries}
                        disabled={isPublishingSeries || isSavingSeries}
                        className="px-4 py-2.5 bg-background-secondary hover:bg-red-500/10 hover:text-red-500 hover:border-red-500/30 disabled:opacity-50 disabled:cursor-not-allowed text-label-secondary rounded-xl text-sm font-medium transition-colors flex items-center justify-center gap-1.5 border border-background-tertiary"
                        title="Remove this series from Discover (you can republish later)"
                     >
                        <Archive size={14} /> Unpublish
                     </button>
                   )}
                   <button
                      onClick={handleSaveSeries}
                      disabled={isSavingSeries || isPublishingSeries || !seriesTitle.trim()}
                      className="px-5 py-2.5 bg-background-secondary hover:bg-background-tertiary disabled:bg-background-tertiary disabled:text-label-tertiary disabled:cursor-not-allowed text-label rounded-xl text-sm font-medium transition-colors flex items-center justify-center gap-2 min-w-[140px] border border-background-tertiary"
                   >
                      {isSavingSeries
                        ? <><CircleNotch size={14} className="animate-spin" /> Saving…</>
                        : currentSeriesId
                          ? <>Update draft</>
                          : <>Save draft</>}
                   </button>
                   <button
                      onClick={handlePublishSeries}
                      disabled={isPublishingSeries || isSavingSeries || !seriesTitle.trim() || seriesEpisodes.filter(e => e.status === 'ready').length === 0}
                      title={seriesEpisodes.filter(e => e.status === 'ready').length === 0
                        ? 'Add at least one episode with a video to publish'
                        : 'Publish this series to Discover'}
                      className="px-5 py-2.5 bg-accent hover:bg-accent/90 disabled:bg-background-tertiary disabled:text-label-tertiary disabled:cursor-not-allowed text-white rounded-xl text-sm font-medium transition-colors flex items-center justify-center gap-2 min-w-[140px]"
                   >
                      {isPublishingSeries
                        ? <><CircleNotch size={14} className="animate-spin" /> Publishing…</>
                        : seriesStatus === 'published'
                          ? <>Republish</>
                          : seriesStatus === 'archived'
                            ? <>Republish to Discover</>
                            : <>Publish to Discover</>}
                   </button>
                </div>
             </div>
          </div>
        </div>
      ) : (
      <>
      {(isSequel || isRecast) && renderProgress < 4 && step !== 4 ? (
        <div className="w-full max-w-2xl mx-auto flex flex-col items-center justify-center pt-20 pb-20 animate-fade-in text-center">
          <div className="w-20 h-20 rounded-full glass-regular flex items-center justify-center mb-6 text-accent">
            <FilmStrip size={36} weight="duotone" className="animate-pulse" />
          </div>
          <h2 className="text-2xl md:text-3xl font-medium mb-3 text-label tracking-tight" style={{ fontFamily: "'Crimson Pro', 'Georgia', serif" }}>
            {isRecast ? 'Recasting' : 'Making sequel of'} {sequelTitle ? `“${sequelTitle}”` : 'your story'}…
          </h2>
          <p className="text-sm text-label-secondary mb-8">
            {isGeneratingScript
               ? 'AI is sketching where the story heads next…'
               : (generatedScript ? 'Preparing video assets…' : 'Script generation did not finish — please retry.')}
          </p>
          <div className="w-full max-w-md bg-background-secondary h-2 rounded-full overflow-hidden">
            <div 
              className="h-full bg-accent transition-all duration-1000 ease-out"
              style={{ width: isGeneratingScript ? '40%' : '80%' }}
            />
          </div>
          
          {!isGeneratingScript && !generatedScript && (
            <button
              onClick={() => {
                scriptGenAttemptedRef.current = false;
                setStep(0);
              }}
              className="mt-6 px-6 py-2 bg-background-secondary hover:bg-background-tertiary rounded-full text-label-secondary text-sm font-medium transition flex items-center gap-2"
            >
              <ArrowsClockwise size={16} /> Retry script generation
            </button>
          )}

          {/* Fallback: if auto-advance to render didn't fire (e.g. user
              navigated away mid-flow, network blip, etc.) the script will
              be ready but renderProgress stays 0. Give the user an escape
              hatch so they can manually trigger the render pipeline. */}
          {!isGeneratingScript && generatedScript && renderProgress === 0 && (
            <button
              onClick={() => {
                autoRenderTriggeredRef.current = true;
                handleNextToRender();
              }}
              className="mt-6 px-6 py-2 bg-accent hover:bg-accent/90 rounded-full text-white text-sm font-medium transition flex items-center gap-2"
            >
              Start render now
            </button>
          )}
        </div>
      ) : (
      <div className="w-full max-w-4xl xl:max-w-5xl mx-auto flex flex-col gap-3 pt-4 pb-6">
        {/* 2026-05-18 Leon round-7 — gap-6→gap-3, pb-20→pb-6 (mobile FAB
            空间通过 viewport 安全区 env(safe-area-inset-bottom) 处理,
            desktop 不需要 80px 留空) — 助攻 1440×900 不滚动. */}

        {/* Mode Toggle — 用 design-system SegmentedControl(iOS+visionOS 双轨,
            light/dark 自动 token 化)。替换之前 hardcoded bg-white selected pill。
            w-full max-w-[440px] 给宽度,避免 segments 塌缩导致文本 ellipsis。 */}
        <div className="flex justify-center mb-2">
          <SegmentedControl
            segments={[
              { value: 'quick',  label: 'Quick Mode' },
              { value: 'free',   label: 'Free Mode' },
              { value: 'upload', label: 'Upload Video' },
            ]}
            value={generationMode}
            onChange={(v) => {
              setGenerationMode(v);
              setStep(0);
              if (v === 'upload') setUploadResult(null);
            }}
            className="w-full max-w-[440px]"
          />
        </div>

        {generationMode === 'free' && step !== 4 && (
          <>
          {/* Asset Lightbox */}
          {lightboxUrl && (
            <div className="fixed inset-0 bg-black/80 z-[9999] flex items-center justify-center p-4 animate-fade-in" onClick={() => { setLightboxUrl(null); setLightboxIsVideo(false); }}>
              <button className="absolute top-4 right-4 text-white/80 hover:text-white bg-white/10 rounded-full p-2 backdrop-blur-sm z-10" onClick={() => { setLightboxUrl(null); setLightboxIsVideo(false); }}><X size={24} /></button>
              {lightboxIsVideo ? (
                /* §2026-05-24 fei: was <video src={lightboxUrl}> — black
                   screen for Stream HLS URLs on non-Safari. UnifiedVideoPlayer
                   branches Safari→native HLS / others→hls.js. */
                <div onClick={e => e.stopPropagation()} className="max-w-full max-h-[85vh]">
                  <UnifiedVideoPlayer
                    src={lightboxUrl}
                    /* §2026-05-30 round-106 path A — 统一用 PlayerActionBar(customControls,
                       desktop;mobile 自动降级 native)。替代原 native controls。 */
                    customControls
                    showQualitySelector
                    autoPlay
                    /* §2026-05-30 round-106 增量C — 生成预览短视频 loop self(跟 Spark 一致)。*/
                    loop
                    playsInline
                    className="max-w-full max-h-[85vh] rounded-xl shadow-2xl"
                  />
                </div>
              ) : (
                <img src={lightboxUrl} className="max-w-full max-h-[85vh] rounded-xl shadow-2xl object-contain" onClick={e => e.stopPropagation()} />
              )}
            </div>
          )}
          {/* 2026-05-27 round-77 (Leon, R77-a-1):Free mode 主 panel 改
           * <GlassPane> (radius=32 max-w-720,跟 Upload mode 上块对齐)。
           * 内部 layout 暂时保持原 order,R77-a-2/3 才做上下两块 IA split。
           * 加 eyebrow "SUBMIT YOUR WORK" 跟 Upload mode 视觉一致。 */}
          <GlassPane className="w-full max-w-[720px] mx-auto animate-fade-in md:h-[360px]" radius={32} contentClassName="relative z-[3] p-4 h-full space-y-3 flex flex-col">
            {/* §2026-05-30 round-106 — 全屏 prompt 编辑器 modal(甲方:Free mode 需编辑超大
              * prompt)。createPortal 到 body 逃 GlassPane overflow clip;近全屏大 textarea
              * 共享 freePrompt state。点遮罩 / Done 关闭。 */}
            {promptFullscreen && createPortal(
              <div
                className="fixed inset-0 z-[300] flex items-center justify-center p-3 md:p-6 bg-black/60 backdrop-blur-sm animate-fade-in"
                onMouseDown={(e) => { if (e.target === e.currentTarget) setPromptFullscreen(false); }}
              >
                <div className="w-full max-w-[1100px] h-[90vh] flex flex-col rounded-2xl bg-background shadow-2xl border border-black/8 dark:border-white/12 overflow-hidden">
                  <div className="flex items-center justify-between px-5 py-3 border-b border-black/8 dark:border-white/10 shrink-0">
                    <div className="flex items-center gap-2.5">
                      <span className="text-sm font-semibold text-label">Edit prompt</span>
                      <span className="text-xs text-label-tertiary tabular-nums">{freePrompt.length} chars</span>
                    </div>
                    <button
                      type="button"
                      onClick={() => setPromptFullscreen(false)}
                      className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-semibold cursor-pointer transition-colors bg-accent text-white hover:opacity-90 shadow-sm shadow-accent/20"
                    >
                      <Check size={14} weight="bold" /> Done
                    </button>
                  </div>
                  <textarea
                    autoFocus
                    value={freePrompt}
                    onChange={(e) => {
                      setFreePrompt(e.target.value);
                      if (isPromptOptimized && e.target.value !== freePrompt) setIsPromptOptimized(false);
                    }}
                    placeholder="Write a prompt — tap @ to reference an asset, e.g. [@Image1] mimics motion of [@Video1] …"
                    className="flex-1 w-full resize-none px-6 py-5 bg-transparent text-label text-[16px] leading-relaxed outline-none placeholder:text-label-tertiary"
                  />
                </div>
              </div>,
              document.body
            )}
            {/* §2026-05-30 round-106 — 去掉 in-panel 展开版本(甲方:只需 full screen)。
              * top block 固定显 header;大 prompt 走 compact 框右下全屏按钮 → modal 编辑器。 */}
            <>
                {/* 2026-05-27 round-79 (Leon): 当 Action row 任一 btn 触发上块有内容
                  * (Character picker / Generate Asset panel / 已上传 assets) 时,
                  * header (eyebrow + title + description) 隐藏 — 让位给实际内容,
                  * 避免占用 360px 上块限定高度。Empty state 才显示 header。 */}
                {!showCharacterAssetPicker && !showGenerateAssetPanel && freeAssets.length === 0 && (
                  <>
                    {/* Header: eyebrow + h2 (顶部固定,不 grow) */}
                    <div className="text-center shrink-0">
                      <span className="text-[10px] uppercase tracking-[0.18em] text-accent font-medium">Submit your work</span>
                      <h2 className="text-2xl md:text-3xl font-medium text-label tracking-tight mt-0.5" style={{ fontFamily: "'Crimson Pro', 'Georgia', serif" }}>Free Mode</h2>
                    </div>
                    {/* Description: 垂直 center 在 header bottom 跟 上块底之间剩余空间
                      * (Leon round-79 — flex-1 + items-center,empty state 视觉 spacious)。 */}
                    <div className="flex-1 flex items-center justify-center">
                      <p className="text-sm text-label-secondary text-center max-w-md">Type a prompt, upload references, skip the storyboard step, and generate a video directly with the Seedance 2.0 model.</p>
                    </div>
                  </>
                )}
              </>

            {/* §2026-06-06 fei — 关页兜底退款提示(三语 · info 蓝条 · 12s 自动消失) */}
            <InlineErrorBanner
              error={refundNotice}
              kind="info"
              title={t('refundNoticeTitle')}
              onDismiss={() => setRefundNotice(null)}
            />
            {/* §2026-05-25 fei — inline error banners for Seedance + upload errors */}
            <InlineErrorBanner
              error={freeSegmentError}
              title={freeSegmentError?.title}
              help={freeSegmentError?.help}
              onDismiss={() => setFreeSegmentError(null)}
              onRetry={freeSegmentError?.retry}
            />
            <InlineErrorBanner
              error={uploadError}
              title={uploadError?.title}
              help={uploadError?.help}
              onDismiss={() => setUploadError(null)}
              onRetry={uploadError?.retry}
            />
            {/* §2026-05-26 fei — Library save failure banner. Mounted here
                so users still in Free Mode UI see merge-insert failures. */}
            <InlineErrorBanner
              error={librarySaveError}
              title={librarySaveError?.title}
              help={librarySaveError?.help}
              onDismiss={() => setLibrarySaveError(null)}
              onRetry={librarySaveError?.retry}
            />

            <div className="flex flex-col gap-4 items-start w-full">
              {/* 2026-05-27 round-79 (Leon): 子 panel (AI Generate / Character
                * picker) 展开时,清空上块其他内容 (safety banner / asset list /
                * history shortcuts) — 让 panel 独占视觉焦点,不跟现有内容混叠。
                * Panel 自身在下面独立 mount,不受这个 wrapper 影响。 */}
              {!showGenerateAssetPanel && !showCharacterAssetPicker && (<>
              {/* §2026-05-24 fei round-2: safety-filter notice. Uses
                  semantic label-color (auto-adapts to light/dark) +
                  stronger background contrast so the message is readable
                  on any theme. */}
              {freeAssets.length > 0 && freeAssets.some(a => !a.certifiedUri) && (
                <div className="w-full p-4 rounded-xl border-2 border-amber-500/60 bg-amber-50 dark:bg-amber-950/40 flex items-start gap-3">
                  <ShieldWarning size={22} weight="fill" className="text-amber-600 dark:text-amber-400 flex-shrink-0 mt-0.5" />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-amber-900 dark:text-amber-100 mb-1">
                      真人参考？先认证素材
                    </p>
                    <p className="text-xs text-amber-800 dark:text-amber-200 leading-relaxed">
                      如果素材包含真人面孔，BytePlus 安全过滤器可能直接拒绝生成。
                      点击每张素材下方的 <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-amber-200 dark:bg-amber-800/60 text-amber-900 dark:text-amber-100 font-medium align-middle"><ShieldWarning size={10} weight="fill" /> 认证</span> 按钮，
                      上传到私有素材库（仅你账号可见，绕过过滤器）。
                    </p>
                  </div>
                </div>
              )}

              {/* Asset List */}
              <div className="flex flex-wrap gap-4 w-full">
                {freeAssets.map(asset => (
                  <div key={asset.id} className="relative shrink-0">
                    {/* Thumbnail card */}
                    <div
                      className="relative aspect-[3/4] w-24 border border-background-tertiary rounded-xl overflow-hidden bg-background-secondary group cursor-pointer"
                      onClick={() => { setLightboxUrl(asset.url); setLightboxIsVideo(asset.isVideo); }}
                    >
                      {asset.isVideo ? (
                        <video src={asset.url} className="w-full h-full object-cover" />
                      ) : (
                        <img src={asset.url} className="w-full h-full object-cover" />
                      )}
                      <div className="absolute bottom-0 left-0 right-0 bg-black/60 text-white text-[10px] px-1 py-0.5 truncate text-center">
                        @{asset.name}
                      </div>
                      <button
                        onClick={(e) => { e.stopPropagation(); setFreeAssets(prev => prev.filter(a => a.id !== asset.id)); }}
                        className="absolute top-1 right-1 bg-red-500 text-white p-1 rounded-full opacity-0 group-hover:opacity-100 transition-opacity"
                        title="删除"
                      >
                        <X size={12} weight="bold" />
                      </button>
                      {/* §2026-05-24 round-2: certification BADGE in card top-left.
                          Always-visible state indicator: green check when certified,
                          amber warning when needs attention. Click region is the
                          big button BELOW the card. */}
                      {asset.certifiedUri && (
                        <div className="absolute top-1 left-1 bg-emerald-500 text-white rounded-full p-1 shadow-md" title="已认证">
                          <ShieldCheck size={12} weight="fill" />
                        </div>
                      )}
                    </div>

                    {/* §2026-05-24 round-2: BIG visible certify button BELOW the
                        card. Always visible (not hover-only). Touch-friendly.
                        Color-coded state: amber=需认证, blue=认证中,
                        green=已认证, red=失败. */}
                    <button
                      onClick={(e) => { e.stopPropagation(); handleCertifyAsset(asset.id); }}
                      disabled={!!asset.certifiedUri || !!asset.certifying}
                      title={
                        asset.certifiedUri ? '已认证 — 可放心使用真人参考'
                        : asset.certifying ? '认证中... (5-15 秒)'
                        : asset.certifyError ? `认证失败 — 点击重试 (${asset.certifyError.slice(0, 60)})`
                        : '认证素材到 BytePlus 私有库，绕过安全过滤器'
                      }
                      className={`mt-1.5 w-24 px-2 py-1.5 rounded-lg text-[11px] font-medium flex items-center justify-center gap-1 transition-colors ${
                        asset.certifiedUri ? 'bg-emerald-500 text-white cursor-default' :
                        asset.certifying ? 'bg-blue-500 text-white cursor-wait' :
                        asset.certifyError ? 'bg-red-500 text-white hover:bg-red-600 cursor-pointer' :
                        'bg-amber-500 text-white hover:bg-amber-600 cursor-pointer'
                      }`}
                    >
                      {asset.certifying ? (
                        <><CircleNotch size={11} className="animate-spin" /> 认证中</>
                      ) : asset.certifiedUri ? (
                        <><ShieldCheck size={11} weight="fill" /> 已认证</>
                      ) : asset.certifyError ? (
                        <><ArrowsClockwise size={11} weight="bold" /> 重试认证</>
                      ) : (
                        <><ShieldWarning size={11} weight="fill" /> 认证</>
                      )}
                    </button>
                  </div>
                ))}
                
              </div>

                {/* 2026-05-27 R77-a-4 (Leon): Asset grid 内原 3 dashed-border 大卡
                  * (Upload / Pick Actor / AI generate) 删除 — 下块 action row 已有
                  * 3 圆 button (round-78 v2) 共用 handlers (setIsUploadingRef +
                  * setShowCharacterAssetPicker + setShowGenerateAssetPanel),功能
                  * 重复 + 视觉冗余。Asset grid 现在只显已选 assets thumbnail。 */}
              </>)}

              {/* Generate Asset Panel — 2026-05-27 round-79 (Leon):
                * 1. 移除 panel 自身 p-4 / border / bg / rounded,让 panel fill
                *    GlassPane content area。Padding 由 GlassPane contentClassName
                *    p-4 统一提供 (上下左右 16px 严谨一致)。
                * 2. 全清 hardcode purple,统一改 brand --color-accent (MEMORY #11):
                *    - Generate CTA: bg-accent + shadow shadow-accent/20 (primary CTA)
                *    - Style pill selected: bg-accent text-white (selected pill)
                *    - Style pill hover: hover:bg-black/8 dark:hover:bg-white/10 (wash)
                *    - Pick Actor toggle: bg-accent/15 text-accent (active toggle)
                *    - Input focus: ring-accent (focus ring)
                *    - Asset thumb selected: border-accent / hover: border-accent/60
                *    - Header icon: MagicWand text-accent (跟 toolbar 一致)
                * 3. bg-white → bg-white dark:bg-background-secondary (dark mode safe)。 */}
              {showGenerateAssetPanel && (
                <div className="w-full animate-fade-in">
                  <div className="flex justify-between items-center mb-3">
                    <h4 className="text-sm font-medium text-label flex items-center gap-1.5"><MagicWand size={16} className="text-accent" /> AI-generate reference image</h4>
                    <button onClick={() => setShowGenerateAssetPanel(false)} className="text-label-secondary hover:text-label cursor-pointer"><X size={16} /></button>
                  </div>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={generateAssetPrompt}
                      onChange={e => setGenerateAssetPrompt(e.target.value)}
                      onKeyDown={e => { if (e.key === 'Enter' && !isGeneratingAsset && generateAssetPrompt.trim()) handleGenerateAsset(); }}
                      placeholder="Describe the image you want to generate — e.g. a girl smiling in a garden"
                      className="flex-1 px-3 py-2 text-sm border border-background-tertiary rounded-lg bg-white dark:bg-background-secondary text-label focus:outline-none focus:ring-2 focus:ring-accent"
                      disabled={isGeneratingAsset}
                    />
                    <button
                      onClick={handleGenerateAsset}
                      disabled={isGeneratingAsset || !generateAssetPrompt.trim()}
                      className="px-4 py-2 bg-accent hover:bg-accent/90 text-white rounded-lg text-sm font-medium shadow-md shadow-accent/20 disabled:bg-background-tertiary disabled:text-label-tertiary disabled:shadow-none cursor-pointer disabled:cursor-not-allowed transition flex items-center gap-1.5 shrink-0"
                    >
                      {isGeneratingAsset ? <><CircleNotch size={14} className="animate-spin" /> Generating</> : <><MagicWand size={14} /> Generate · {generateAssetCost}</>}
                    </button>
                  </div>

                  {/* §2026-06-06 fei — 画质 + 分辨率(影响出图精度与价格 3→6 credit) */}
                  <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2">
                    <div>
                      <p className="text-[11px] text-label-tertiary mb-2">画质 Quality</p>
                      <div className="flex gap-1.5">
                        {[{ v: 'low', label: '经济' }, { v: 'medium', label: '标准' }, { v: 'high', label: '高清' }].map(o => (
                          <button
                            key={o.v}
                            onClick={() => setGenerateAssetQuality(o.v)}
                            disabled={isGeneratingAsset}
                            className={`flex-1 px-2 py-1.5 rounded-lg text-xs font-medium border transition-colors cursor-pointer disabled:opacity-50 ${generateAssetQuality === o.v ? 'border-transparent bg-accent text-white' : 'border-background-tertiary bg-white dark:bg-background-secondary text-label-secondary hover:bg-black/8 dark:hover:bg-white/10'}`}
                          >
                            {o.label}
                          </button>
                        ))}
                      </div>
                    </div>
                    <div>
                      <p className="text-[11px] text-label-tertiary mb-2">比例 Resolution</p>
                      <div className="flex gap-1.5">
                        {[{ v: 'auto', label: '自动' }, { v: '1536x1024', label: '横版' }, { v: '1024x1024', label: '方形' }, { v: '1024x1536', label: '竖版' }].map(o => {
                          // 「自动」= 跟随单张参考图比例;仅恰好 1 张参考图时可选,0 张或多张置灰
                          const autoDisabled = o.v === 'auto' && generateAssetRefUrls.length !== 1;
                          return (
                            <button
                              key={o.v}
                              onClick={() => setGenerateAssetSize(o.v)}
                              disabled={isGeneratingAsset || autoDisabled}
                              title={o.v === 'auto' ? '跟随参考图比例(需恰好 1 张参考图)' : undefined}
                              className={`flex-1 px-2 py-1.5 rounded-lg text-xs font-medium border transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed ${generateAssetSize === o.v ? 'border-transparent bg-accent text-white' : 'border-background-tertiary bg-white dark:bg-background-secondary text-label-secondary hover:bg-black/8 dark:hover:bg-white/10'}`}
                            >
                              {o.label}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                  <p className="text-[11px] text-label-tertiary mt-2">本次扣费 <span className="font-semibold text-label-secondary">{generateAssetCost}</span> credits{generateAssetSize === 'auto' ? `(自动 → ${effectiveAssetSize === '1024x1024' ? '方形' : effectiveAssetSize === '1024x1536' ? '竖版' : '横版'})` : '(画质×分辨率,最高 6)'}</p>

                  {/* Reference Image */}
                  <div className="mt-3">
                    <p className="text-[11px] text-label-tertiary mb-2">参考图 Reference(可选,可多张 — 最多 4 张)</p>
                    <div className="flex items-center gap-2 flex-wrap">
                      {generateAssetRefUrls.map(url => (
                        <div key={url} className="relative w-16 h-16 rounded-lg overflow-hidden border border-background-tertiary shrink-0 group">
                          <img src={url} className="w-full h-full object-cover cursor-pointer" onClick={() => { setLightboxUrl(url); setLightboxIsVideo(false); }} />
                          <button onClick={(e) => { e.stopPropagation(); setGenerateAssetRefUrls(prev => prev.filter(u => u !== url)); }} className="absolute top-0.5 right-0.5 bg-black/55 p-0.5 rounded-full text-white opacity-80 group-hover:opacity-100 transition-opacity"><X size={10} /></button>
                        </div>
                      ))}
                      {generateAssetRefUrls.length < 4 && (
                        <div className="relative w-16 h-16 border-2 border-dashed border-background-tertiary rounded-lg flex flex-col items-center justify-center bg-white dark:bg-background-secondary cursor-pointer hover:border-accent transition shrink-0">
                          <Plus size={15} className="text-label-tertiary" />
                          <span className="text-[9px] text-label-tertiary mt-0.5">Upload</span>
                          <input type="file" accept="image/*" className="absolute inset-0 opacity-0 cursor-pointer" onChange={async (e) => {
                            const file = e.target.files?.[0];
                            if (!file) return;
                            try {
                              const url = await uploadToSecureOSS(file);
                              setGenerateAssetRefUrls(prev => prev.includes(url) ? prev : [...prev, url]);
                            } catch (err) {
                              // §2026-05-25 fei — inline upload banner (reference image)
                              setUploadError({
                                title: '参考图上传失败',
                                message: formatError(err, '请检查文件后重试。'),
                              });
                            } finally { e.target.value = ''; }
                          }} />
                        </div>
                      )}
                      
                      {/* §2026-05-22 fei: filter generated_concept + relabel
                          "Pick Actor / Char" → "Pick Actor". Picker only shows
                          source Avatars (uploaded photos). */}
                      {generateAssetRefUrls.length < 4 && characters.some(c => {
                        try {
                          const f = typeof c.identity_features === 'string' ? JSON.parse(c.identity_features) : (c.identity_features || {});
                          return f.createdVia !== 'generated_concept';
                        } catch { return true; }
                      }) && (
                        <div
                          className={`relative w-16 h-16 border-2 border-dashed rounded-lg flex flex-col items-center justify-center cursor-pointer transition shrink-0 ${showGenerateAssetCharPicker ? 'border-accent bg-accent/15 text-accent' : 'border-background-tertiary bg-white dark:bg-background-secondary text-label-secondary hover:border-accent'}`}
                          onClick={() => setShowGenerateAssetCharPicker(!showGenerateAssetCharPicker)}
                        >
                          <UserCircle size={15} className={showGenerateAssetCharPicker ? "text-accent" : "text-label-tertiary"} />
                          <span className="text-[9px] mt-0.5">Pick Actor</span>
                        </div>
                      )}

                      {freeAssets.filter(a => !a.isVideo).length > 0 && (
                        <div className="flex gap-1.5 overflow-x-auto">
                          {freeAssets.filter(a => !a.isVideo).map(a => (
                            <button
                              key={a.id}
                              onClick={() => setGenerateAssetRefUrls(prev => prev.includes(a.url) ? prev.filter(u => u !== a.url) : (prev.length < 4 ? [...prev, a.url] : prev))}
                              className={`shrink-0 w-10 h-10 rounded-lg overflow-hidden border-2 transition-colors cursor-pointer ${generateAssetRefUrls.includes(a.url) ? 'border-accent' : 'border-transparent hover:border-accent/60'}`}
                            >
                              <img src={a.url} className="w-full h-full object-cover" />
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                    
                    {/* §2026-05-22 fei: filter to source Avatars only. */}
                    {showGenerateAssetCharPicker && (() => {
                      const avatarsOnly = characters.filter(c => {
                        try {
                          const f = typeof c.identity_features === 'string' ? JSON.parse(c.identity_features) : (c.identity_features || {});
                          return f.createdVia !== 'generated_concept';
                        } catch { return true; }
                      });
                      if (avatarsOnly.length === 0) return null;
                      return (
                        <div className="mt-3 p-3 bg-white dark:bg-background-secondary border border-background-tertiary rounded-xl animate-fade-in">
                          <p className="text-[10px] text-label-secondary mb-2">选 Avatar 作参考(可多选,最多 4 张):</p>
                          <div className="flex gap-2 overflow-x-auto pb-1">
                            {avatarsOnly.map(char => {
                              const picked = generateAssetRefUrls.includes(char.photo_url);
                              return (
                                <button
                                  key={char.id}
                                  onClick={() => setGenerateAssetRefUrls(prev => prev.includes(char.photo_url) ? prev.filter(u => u !== char.photo_url) : (prev.length < 4 ? [...prev, char.photo_url] : prev))}
                                  className={`shrink-0 w-14 h-14 rounded-lg overflow-hidden border-2 transition-colors bg-background cursor-pointer ${picked ? 'border-accent' : 'border-transparent hover:border-accent'}`}
                                >
                                  <img src={char.photo_url} className="w-full h-full object-cover" />
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      );
                    })()}
                  </div>

                  {/* §2026-06-06 fei — 历史生成的图片(Works),点选作参考图(跨会话) */}
                  {savedImages.length > 0 && (
                    <div className="mt-3">
                      <p className="text-[11px] text-label-tertiary mb-2">已生成的图(点选作参考,最多 4 张)</p>
                      <div className="flex gap-1.5 overflow-x-auto pb-1">
                        {savedImages.map(img => {
                          const picked = generateAssetRefUrls.includes(img.url);
                          return (
                            <button
                              key={img.id}
                              onClick={() => setGenerateAssetRefUrls(prev => prev.includes(img.url) ? prev.filter(u => u !== img.url) : (prev.length < 4 ? [...prev, img.url] : prev))}
                              title={img.title || ''}
                              className={`shrink-0 w-12 h-12 rounded-lg overflow-hidden border-2 transition-colors cursor-pointer ${picked ? 'border-accent' : 'border-transparent hover:border-accent/60'}`}
                            >
                              <img src={img.url} className="w-full h-full object-cover" loading="lazy" />
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  <p className="text-[11px] text-label-tertiary mt-3 leading-relaxed">用 GPT-image-2 按你的提示词(可带多张参考图)多模态出图,自动存入素材库。下次还能在「已生成的图」里选它作参考。</p>
                </div>
              )}

              {/* Character Asset Picker Panel — 2026-05-27 round-79 (Leon flat 化):
                * 跟 Generate Asset Panel 一致,移除 panel 自身 p-4/border/bg/rounded,
                * padding 由 GlassPane 统一提供(上下左右 16px 严谨一致),消除嵌套
                * card 视觉冗余。Empty-state copy points to Library since Actor
                * creation moved there (fei §2026-05-22)。 */}
              {showCharacterAssetPicker && (() => {
                const avatarsOnly = characters.filter(char => {
                  try {
                    const f = typeof char.identity_features === 'string' ? JSON.parse(char.identity_features) : (char.identity_features || {});
                    return f.createdVia !== 'generated_concept';
                  } catch { return true; }
                });
                return (
                <div className="w-full animate-fade-in">
                  <div className="flex justify-between items-center mb-3">
                    <h4 className="text-sm font-medium text-label flex items-center gap-1.5"><UserCirclePlus size={16} className="text-accent" /> Pick Actor</h4>
                    <button onClick={() => setShowCharacterAssetPicker(false)} className="text-label-secondary hover:text-label cursor-pointer"><X size={16} /></button>
                  </div>
                  {avatarsOnly.length === 0 ? (
                    <p className="text-sm text-label-secondary text-center py-4">
                      No Avatar yet —{' '}
                      <button onClick={() => navigate('/library')} className="text-accent underline hover:opacity-80">
                        create one in Library
                      </button>{' '}
                      first.
                    </p>
                  ) : (
                    <div className="flex flex-wrap gap-3">
                      {avatarsOnly.map(char => {
                        const alreadyAdded = freeAssets.some(a => a.url === char.photo_url);
                        return (
                          <button
                            key={char.id}
                            onClick={() => {
                              if (alreadyAdded || freeAssets.length >= 12) return;
                              const assetId = generateAssetId(char.photo_url);
                              const newAsset = { id: assetId, url: char.photo_url, isVideo: false, name: 'Recognizing…' };
                              setFreeAssets(prev => [...prev, newAsset]);
                              describeAsset(char.photo_url).then(desc => {
                                setFreeAssets(prev => prev.map(a => a.id === assetId ? { ...a, name: desc } : a));
                              });
                              setShowCharacterAssetPicker(false);
                            }}
                            disabled={alreadyAdded || freeAssets.length >= 12}
                            className={`relative w-16 aspect-[3/4] rounded-lg overflow-hidden border-2 transition-colors ${alreadyAdded ? 'border-accent opacity-60' : 'border-transparent hover:border-accent'}`}
                          >
                            <img src={char.photo_url} className="w-full h-full object-cover" />
                            {alreadyAdded && <div className="absolute inset-0 bg-accent/20 flex items-center justify-center"><CheckCircle size={20} weight="fill" className="text-accent drop-shadow-md" /></div>}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
                );
              })()}

              {/* History Asset Shortcuts — 子 panel open 时同样隐藏(让 panel 独占) */}
              {!showGenerateAssetPanel && !showCharacterAssetPicker && historyAssets.length > 0 && (
                <div className="w-full">
                  <p className="text-[11px] text-label-tertiary mb-2">Recent assets (tap to add)</p>
                  <div className="flex flex-wrap gap-2">
                    {historyAssets.map(asset => {
                      const alreadyAdded = freeAssets.some(a => a.url === asset.url);
                      return (
                        <button
                          key={asset.id}
                          onClick={() => {
                            if (!alreadyAdded && freeAssets.length < 12) {
                              setFreeAssets(prev => [...prev, { ...asset, id: Date.now() + Math.random() }]);
                            }
                          }}
                          disabled={alreadyAdded || freeAssets.length >= 12}
                          className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-xs transition-all ${alreadyAdded ? 'border-accent/30 bg-accent/5 text-accent opacity-60' : 'border-background-tertiary bg-background-secondary text-label-secondary hover:border-accent/40 hover:bg-accent/5 hover:text-accent'}`}
                        >
                          <div className="w-5 h-5 rounded overflow-hidden shrink-0 bg-black">
                            {asset.isVideo ? <video src={asset.url} className="w-full h-full object-cover" /> : <img src={asset.url} className="w-full h-full object-cover" />}
                          </div>
                          <span className="max-w-[80px] truncate">{asset.name}</span>
                          {alreadyAdded ? <CheckCircle size={12} weight="fill" /> : <Plus size={12} />}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
              
              {/* 2026-05-27 R77-b-1 (Leon): Prompt textarea + @ mention picker +
                * Optimize button cut 到下块顶部 (Leon 决策 4)。textareaRef +
                * handleFreePromptKeyDown + handleFreePromptBeforeInput + 等
                * handlers 都是 component-level,move 无需改 logic。 */}
            </div>
          </GlassPane>

          {/* 2026-05-27 round-77 (Leon, R77-a-3-v2): 下块「主控」垂直 stack:
            * Settings chip 行 / Duration / Action row (Vireel-style chip layout)。
            * Chip 统一 visionOS pill 风格 (bg-black/8 dark:bg-white/10 rounded-full)。 */}
          {!showGenerateAssetPanel && (
            <GlassPane className="w-full max-w-[512px] mx-auto animate-fade-in" radius={24} contentClassName="relative z-[3] p-3 space-y-2">
              <div className="flex flex-col gap-3">
                {/* Top: Prompt textarea + @ mention picker (R77-b-1 cut 自上块).
                  * R77-b-2 (Leon round-79):
                  *   1. textarea rows=4 (固定 4 行,~88px,跟下块 width 比例协调)
                  *   2. Optimize + 全屏 button 浮在 textarea 右下角
                  *   3. §round-106 全屏 button → 近全屏 modal 编辑器(甲方:大 prompt)。
                  *      旧 in-panel 展开版本(promptExpanded)已移除,只留 full screen。 */}
                <div className="relative w-full">
                  {/* R79-fix:TextField multiline primitive (Leon "不重造轮子") +
                    * Expand/Optimize button 浮回 textarea 内 absolute right-bottom
                    * (button bg-opaque 防 text scroll 透过)。 */}
                  <TextField
                    multiline
                    rows={4}
                    ref={textareaRef}
                    value={freePrompt}
                    onKeyDown={handleFreePromptKeyDown}
                    onBeforeInput={handleFreePromptBeforeInput}
                    onChange={(e) => {
                      const val = e.target.value;
                      setFreePrompt(val);
                      if (isPromptOptimized && val !== freePrompt) setIsPromptOptimized(false);
                      const cursor = e.target.selectionStart;
                      const textBeforeCursor = val.slice(0, cursor);
                      if (textBeforeCursor.endsWith('@')) {
                        setShowAssetPicker(true);
                      } else {
                        setShowAssetPicker(false);
                      }
                    }}
                    placeholder="Write a prompt — tap @ to reference an asset, e.g. [@Image1] mimics motion of [@Video1] …"
                  />
                  {/* Floating Expand + Optimize buttons (bg-opaque + backdrop-blur 让
                    * text scroll 透过仍 button 可读)。 */}
                  <div className="absolute bottom-2 right-2 flex items-center gap-1.5 pointer-events-none">
                    {/* §round-106 — 全屏编辑器入口(大 prompt 用) */}
                    <Tooltip content="Open full-screen editor">
                      <button
                        type="button"
                        onClick={() => setPromptFullscreen(true)}
                        className="pointer-events-auto flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] font-medium cursor-pointer transition-colors bg-black/40 dark:bg-white/20 backdrop-blur-md text-white/95 hover:bg-black/55 dark:hover:bg-white/25"
                      >
                        <ArrowsOutSimple size={12} weight="bold" />
                      </button>
                    </Tooltip>
                    <button
                      type="button"
                      onClick={handleOptimizePrompt}
                      disabled={!freePrompt.trim() || isPromptOptimized || isOptimizingPrompt}
                      className={`pointer-events-auto flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] font-medium cursor-pointer transition-colors backdrop-blur-md ${
                        isPromptOptimized
                          ? 'bg-green-500/85 text-white cursor-not-allowed'
                          : !freePrompt.trim()
                            ? 'bg-black/30 dark:bg-white/15 text-label-tertiary cursor-not-allowed'
                            : 'bg-accent/90 text-white hover:bg-accent'
                      }`}
                    >
                      {isOptimizingPrompt ? (
                        <><CircleNotch size={12} className="animate-spin" /> Optimizing</>
                      ) : isPromptOptimized ? (
                        <><CheckCircle size={12} /> Optimized</>
                      ) : (
                        <><MagicWand size={12} /> Optimize</>
                      )}
                    </button>
                  </div>
                  {showAssetPicker && freeAssets.length > 0 && (
                    <div className="absolute left-0 right-0 top-full mt-2 bg-white border border-background-tertiary shadow-lg rounded-xl p-2 z-50 max-h-[260px] overflow-y-auto flex flex-col gap-1">
                      <div className="text-xs text-label-secondary px-2 pb-1 border-b border-background-tertiary mb-1 sticky top-0 bg-white">Choose an asset to reference</div>
                      {freeAssets.map(asset => {
                        const refLabel = buildAssetReference(asset, freeAssets);
                        return (
                          <button
                            key={asset.id}
                            onClick={() => {
                              const cursor = textareaRef.current?.selectionStart ?? freePrompt.length;
                              const before = freePrompt.slice(0, cursor);
                              const after = freePrompt.slice(cursor);
                              const insertion = refLabel + ' ';
                              const stripTrigger = before.endsWith('@');
                              const newBefore = stripTrigger ? before.slice(0, -1) : before;
                              const newText = newBefore + insertion + after;
                              const newCursor = newBefore.length + insertion.length;
                              setFreePrompt(newText);
                              if (isPromptOptimized) setIsPromptOptimized(false);
                              setShowAssetPicker(false);
                              setTimeout(() => {
                                if (textareaRef.current) {
                                  textareaRef.current.focus();
                                  textareaRef.current.setSelectionRange(newCursor, newCursor);
                                }
                              }, 0);
                            }}
                            className="flex items-center gap-2 hover:bg-background-secondary p-1.5 rounded-lg text-left cursor-pointer"
                          >
                            <div className="w-6 h-6 rounded overflow-hidden shrink-0 bg-black">
                              {asset.isVideo ? <video src={asset.url} className="w-full h-full object-cover" /> : <img src={asset.url} className="w-full h-full object-cover" />}
                            </div>
                            <span className="text-sm font-medium font-mono">{refLabel}</span>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>

                {/* Settings: 3 chip (Model / Resolution / Ratio) 单独一行。
                  *
                  * 2026-05-27 TODO (Leon round-79): Video Type chip 已 cut 出 Settings
                  * row,Leon 决定 mount 位置后加回。videoType state + setVideoType +
                  * VIDEO_TYPES const 仍保留 (drive genre tag #Trailer/#Vlog/#MV 等写入
                  * recommended_content.tags),default 'trailer' 仍生效。chip JSX template
                  * 备用 (Leon 指定位置后 paste):
                  *
                  *   <div className="px-2.5 py-1 bg-black/8 dark:bg-white/10 rounded-full
                  *        flex items-center justify-center gap-1.5 text-xs text-label-secondary"
                  *        title="Content tag — affects Discover categorization">
                  *     <FilmSlate size={16}/>
                  *     <select className="bg-transparent text-label-secondary font-medium
                  *             appearance-none outline-none cursor-pointer pr-3 text-xs text-center"
                  *             value={videoType} onChange={e => setVideoType(e.target.value)}>
                  *       {VIDEO_TYPES.map(vt => (
                  *         <option key={vt.id} value={vt.id}>{vt.name}</option>
                  *       ))}
                  *     </select>
                  *   </div>
                  */}
                <div className="flex flex-wrap items-center gap-1.5">
                <div className="px-2.5 py-1 bg-black/8 dark:bg-white/10 rounded-full flex items-center justify-center gap-1.5 text-xs text-label-secondary">
                  <select className="bg-transparent text-label-secondary font-medium appearance-none outline-none cursor-pointer pr-3 text-xs text-center" value={videoModel} onChange={e => setVideoModel(e.target.value)}>
                    {/* §2026-05-15: options come from /api/video-models (admin-rotatable IDs).
                        Free tier sees only Fast; paid tier sees Fast + Standard. */}
                    {videoModelOptions.map(m => (
                      <option key={m.id} value={m.id}>{m.label}</option>
                    ))}
                  </select>
                </div>
                <div className="px-2.5 py-1 bg-black/8 dark:bg-white/10 rounded-full flex items-center justify-center gap-1.5 text-xs text-label-secondary">
                  <select className="bg-transparent text-label-secondary font-medium appearance-none outline-none cursor-pointer pr-3 text-xs text-center" value={videoResolution} onChange={e => setVideoResolution(e.target.value)}>
                    {(() => {
                      const allowed = getResolutionOptions(userTier);
                      const ALL = ['480p', '720p', '1080p'];
                      return ALL.map(r => {
                        const tierLocked  = !allowed.includes(r);
                        // §2026-06-05 模型不支持(Fast 无 1080p)也锁,提示切 Standard。
                        const modelLocked = !resAllowedByModel(r, videoModel);
                        const unlockBy = tierLocked ? tierUnlocking(r) : null;
                        return (
                          <option key={r} value={r} disabled={tierLocked || modelLocked}>
                            {r.toUpperCase()}{tierLocked && unlockBy ? ` · ${TIER_DISPLAY[unlockBy]?.label}+` : (modelLocked ? ' · Standard' : '')}
                          </option>
                        );
                      });
                    })()}
                  </select>
                </div>
                {/* Ratio custom dropdown — chip 显 short value (`16:9`),点击展开
                  * portal menu items 详细 (`16:9 · Landscape`)。Dropdown 用
                  * createPortal to body + fixed positioning 逃 GlassPane
                  * overflow:hidden clip。 */}
                <div ref={ratioChipRef} className="relative px-2.5 py-1 bg-black/8 dark:bg-white/10 rounded-full flex items-center justify-center gap-1.5 text-xs text-label-secondary">
                  <button
                    type="button"
                    onClick={() => setRatioMenuOpen(o => !o)}
                    className="bg-transparent text-label-secondary font-medium cursor-pointer text-xs text-center"
                  >
                    {videoRatio}
                  </button>
                </div>
                {/* Ratio dropdown portal (escape GlassPane overflow:hidden clip).
                  * position:fixed,centered horizontally on chip,below chip + 8px gap. */}
                {ratioMenuOpen && ratioChipRect && createPortal(
                  <div
                    ref={ratioDropdownRef}
                    style={{
                      position: 'fixed',
                      top: ratioChipRect.bottom + 8,
                      /* Viewport-clamped left:chip center 居中,clamp 让 menu
                       * 不超出 viewport 两侧 8px margin。estimated menu width 200
                       * (max option text `16:9 · Landscape` + padding + check). */
                      left: (() => {
                        const ESTIMATED_W = 200;
                        const MARGIN = 8;
                        const chipCenterX = ratioChipRect.left + ratioChipRect.width / 2;
                        const naturalLeft = chipCenterX - ESTIMATED_W / 2;
                        return Math.max(MARGIN, Math.min(naturalLeft, window.innerWidth - ESTIMATED_W - MARGIN));
                      })(),
                      zIndex: 9999,
                    }}
                    className="min-w-[180px] max-w-[220px] bg-black/55 dark:bg-white/15 backdrop-blur-xl border border-white/15 rounded-xl shadow-lg shadow-black/20 overflow-hidden p-2"
                  >
                    {/* macOS native menu pattern:items text-center,selected 项
                      * 永久 pill-shape accent bg + Check icon(跟参考截图 720P
                      * selected state 一致)。Hover unselected items subtle wash。
                      * Items mx 由 menu container p-1 提供 inset,item 自身
                      * rounded-full → pill 视觉。 */}
                    {RATIO_OPTIONS.map(r => (
                      <button
                        type="button"
                        key={r.value}
                        onClick={() => { setVideoRatio(r.value); setRatioMenuOpen(false); }}
                        className={`relative block w-full text-center px-7 py-1.5 text-xs whitespace-nowrap cursor-pointer transition-colors rounded-full ${
                          videoRatio === r.value
                            ? 'bg-accent text-white'
                            : 'text-white/95 hover:bg-white/10'
                        }`}
                      >
                        {videoRatio === r.value && (
                          <Check size={12} weight="bold" className="absolute left-2 top-1/2 -translate-y-1/2 text-white" />
                        )}
                        {r.value} · {r.en}
                      </button>
                    ))}
                  </div>,
                  document.body
                )}

                {/* Duration chip — R79: merge 到 Settings row,chip-style mini slider
                  * (跟 Settings 3 chip 同 visual: bg-black/8 dark:bg-white/10 pill)。 */}
                <div className="px-2.5 py-1 bg-black/8 dark:bg-white/10 rounded-full flex items-center gap-1.5 text-xs text-label-secondary">
                  <Clock size={14}/>
                  <input
                    type="range"
                    min={3}
                    max={15}
                    step={1}
                    value={freeDuration}
                    onChange={e => setFreeDuration(Number(e.target.value))}
                    className="w-16 accent-accent h-1 rounded-full appearance-none cursor-pointer"
                    style={{
                      background: `linear-gradient(to right, var(--color-accent) 0%, var(--color-accent) ${((freeDuration - 3) / 12) * 100}%, rgba(127,127,127,0.3) ${((freeDuration - 3) / 12) * 100}%, rgba(127,127,127,0.3) 100%)`
                    }}
                  />
                  <span className="font-medium text-label tabular-nums min-w-[24px] text-right">{freeDuration}s</span>
                </div>
              </div>

              {/* Watermark hint (FREE tier only) */}
              {hasWatermark(userTier) && (
                <p className="text-xs text-label-tertiary -mt-2 flex items-center gap-1.5">
                  <Lock size={12} weight="fill" className="text-label-tertiary" />
                  Output includes Uvera watermark.{' '}
                  <button onClick={() => openSubscriptionModal()} className="text-accent hover:underline cursor-pointer">
                    Upgrade to remove
                  </button>
                </p>
              )}

              {/* 2026-05-27 round-77 (Leon, R77-a-3): action row 3 段重组 —
                * 左 [Pick Actor] [+Upload] [AI Generate] 3 chip · 中 Cost coin ·
                * 右 Generate CTA。3 chip 跟 Asset List grid 内 dashed-border 大卡
                * 共用 handler (setShowCharacterAssetPicker / setShowGenerateAssetPanel
                * / file input onChange);Asset List 内 3 卡暂时保留 (R77-a-4 才删),
                * 让 Leon 视觉决定要不要去重。 */}
              <div className="flex items-center justify-between w-full mt-2 gap-2 flex-wrap">
                {/* Left: 3 圆形 icon-only button (round-78 v2) — 高度 40px match
                  * Generate CTA。Label 通过 <Tooltip> hover 显示,精简空间。 */}
                <div className="flex items-center gap-1.5">
                  <Tooltip content="Pick Actor">
                    <button
                      onClick={() => { setShowCharacterAssetPicker(prev => !prev); setShowGenerateAssetPanel(false); }}
                      disabled={freeAssets.length >= 12}
                      className={`w-10 h-10 rounded-full flex items-center justify-center transition cursor-pointer ${showCharacterAssetPicker ? 'bg-accent/15 text-accent' : 'bg-black/8 dark:bg-white/10 text-label-secondary hover:bg-black/12 dark:hover:bg-white/15 hover:text-label'} disabled:opacity-50 disabled:cursor-not-allowed`}
                    >
                      <UserCirclePlus size={18}/>
                    </button>
                  </Tooltip>
                  <Tooltip content="Upload">
                    <label
                      className={`w-10 h-10 rounded-full flex items-center justify-center transition bg-black/8 dark:bg-white/10 text-label-secondary hover:bg-black/12 dark:hover:bg-white/15 hover:text-label ${freeAssets.length >= 12 || isUploadingRef ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
                    >
                      {isUploadingRef ? <CircleNotch size={18} className="animate-spin"/> : <Plus size={18}/>}
                      <input
                        type="file"
                        accept="image/*,video/mp4"
                        multiple
                        disabled={freeAssets.length >= 12 || isUploadingRef}
                        className="hidden"
                        onChange={async (e) => {
                          const files = Array.from(e.target.files);
                          if (!files.length) return;
                          setIsUploadingRef(true);
                          try {
                            const newAssets = [];
                            for (const file of files) {
                              const url = await uploadToSecureOSS(file, { maxVideoDurationSec: 15 });
                              const isVideo = file.type.startsWith('video/');
                              const assetId = generateAssetId(url);
                              newAssets.push({ id: assetId, url, isVideo, name: 'Recognizing…' });
                            }
                            setFreeAssets(prev => [...prev, ...newAssets]);
                            for (const asset of newAssets) {
                              if (!asset.isVideo) {
                                describeAsset(asset.url).then(desc => {
                                  setFreeAssets(prev => prev.map(a => a.id === asset.id ? { ...a, name: desc } : a));
                                });
                              } else {
                                setFreeAssets(prev => prev.map(a => a.id === asset.id ? { ...a, name: 'Video asset' } : a));
                              }
                            }
                          } catch(err) {
                            setUploadError({
                              title: '素材上传失败',
                              message: formatError(err, '检查文件大小 (<50MB) 和格式 (图片或 mp4) 后重试。'),
                            });
                          } finally {
                            setIsUploadingRef(false);
                            e.target.value = '';  // reset input so re-selecting same file works
                          }
                        }}
                      />
                    </label>
                  </Tooltip>
                  <Tooltip content="AI Generate image">
                    <button
                      onClick={() => { setShowGenerateAssetPanel(prev => !prev); setShowCharacterAssetPicker(false); }}
                      disabled={freeAssets.length >= 12}
                      className={`w-10 h-10 rounded-full flex items-center justify-center transition cursor-pointer ${showGenerateAssetPanel ? 'bg-accent/15 text-accent' : 'bg-black/8 dark:bg-white/10 text-label-secondary hover:bg-black/12 dark:hover:bg-white/15 hover:text-label'} disabled:opacity-50 disabled:cursor-not-allowed`}
                    >
                      <MagicWand size={18}/>
                    </button>
                  </Tooltip>
                </div>

                {/* Middle: Cost coin · Credits/sec */}
                <div className="flex items-center gap-2">
                  <div className="flex items-center gap-1.5 text-accent font-semibold text-base">
                    <Coin size={20} weight="fill" />
                    <span className="tabular-nums">{freeModeCost}</span>
                  </div>
                  <span className="text-xs text-label-secondary">
                    {(() => {
                      const base = RESOLUTION_CREDITS_PER_SEC[videoResolution] || 6;
                      const m = getModelMultiplier(videoModel);
                      return m === 1
                        ? `(${base} credits/sec × ${freeDuration}s)`
                        : `(${base} × ${m}× × ${freeDuration}s)`;
                    })()}
                  </span>
                </div>

                {/* Right: Generate CTA — round-78 wrapped with Tooltip
                  * showing full action description on hover (button label
                  * itself stays 1-word concise). */}
                <Tooltip content={freeSegmentGenerating ? null : (freeSegments.length > 0 ? 'Continue next segment' : 'Generate segment')}>
                  <button
                    onClick={() => { handleFreeSegmentGenerate(freeSegments.length > 0 ? freeSegments[freeSegments.length - 1]?.url : null); }}
                    disabled={freeSegmentGenerating || (!freePrompt && freeAssets.length === 0)}
                    className="bg-accent hover:bg-accent/90 disabled:bg-background-tertiary text-white disabled:text-label-tertiary cursor-pointer disabled:cursor-not-allowed px-6 py-2.5 rounded-full font-medium transition-colors shadow-md shadow-accent/20 disabled:shadow-none flex items-center gap-2"
                  >
                    {freeSegmentGenerating ? <><CircleNotch size={16} className="animate-spin" /> Generating…</> : <><FilmSlate size={16} /> {freeSegments.length > 0 ? 'Continue' : 'Generate'}</>}
                  </button>
                </Tooltip>
              </div>
            </div>
            </GlassPane>
          )}

          {/* ── Segment Timeline ── */}
          {freeSegments.length > 0 && (
            <GlassPane className="max-w-[720px] mx-auto animate-fade-in" radius={24} contentClassName="relative z-[3] p-6 md:p-7 space-y-6">
              {/* §2026-05-25 fei — inline merge error banner */}
              <InlineErrorBanner
                error={mergeError}
                title={mergeError?.title}
                help={mergeError?.help}
                onDismiss={() => setMergeError(null)}
                onRetry={mergeError?.retry}
              />
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-medium text-label flex items-center gap-2"><FilmStrip size={22} className="text-accent" /> Segment timeline ({freeSegments.length})</h3>
                <div className="flex flex-wrap items-center gap-2">
                  <button onClick={() => { loadLibraryVideos(); setShowLibraryPicker(true); }} className="px-4 py-2 bg-background-secondary hover:bg-background-tertiary rounded-lg text-sm font-medium text-label transition-colors flex items-center gap-1.5">
                    <ListPlus size={16} /> Add from library
                  </button>
                  <button
                    onClick={handleDownloadAll}
                    className="px-4 py-2 bg-background-secondary hover:bg-background-tertiary rounded-lg text-sm font-medium text-label transition-colors flex items-center gap-1.5"
                  >
                    <DownloadSimple size={16} /> Download all
                  </button>
                  <button
                    onClick={handleMergeSegments}
                    disabled={isMergingSegments || freeSegments.filter(s => s.status === 'ready').length < 2}
                    className="px-5 py-2 bg-gradient-to-r from-blue-600 to-indigo-600 text-white rounded-lg text-sm font-medium hover:opacity-90 disabled:opacity-50 transition flex items-center gap-1.5"
                  >
                    {isMergingSegments ? <><CircleNotch size={14} className="animate-spin" /> Merging {mergeProgress}%</> : <><MagicWand size={16} /> Merge into video</>}
                  </button>
                </div>
              </div>

              {/* Library Picker Modal */}
              {showLibraryPicker && (
                <div className="p-4 border border-background-tertiary rounded-xl bg-background-secondary animate-fade-in">
                  <div className="flex justify-between items-center mb-4">
                    <h4 className="text-sm font-medium text-label">Pick from existing videos</h4>
                    <button onClick={() => setShowLibraryPicker(false)} className="text-label-secondary hover:text-label"><X size={16} /></button>
                  </div>
                  {isLoadingLibrary ? (
                    <div className="py-8 flex justify-center"><CircleNotch size={24} className="animate-spin text-accent" /></div>
                  ) : libraryVideos.length === 0 ? (
                    <p className="text-sm text-label-secondary text-center py-6">No saved videos yet.</p>
                  ) : (
                    <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 gap-3 max-h-60 overflow-y-auto">
                      {libraryVideos.map(v => (
                        <button key={v.id} onClick={() => handleAddLibrarySegment(v)} className="relative aspect-video rounded-lg overflow-hidden border-2 border-transparent hover:border-accent transition-colors bg-black group">
                          {v.cover ? <img src={v.cover} className="w-full h-full object-cover" /> : <video src={v.video} className="w-full h-full object-cover" />}
                          <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center"><Plus size={20} className="text-white" /></div>
                          <div className="absolute bottom-0 inset-x-0 bg-black/60 p-1"><p className="text-[9px] text-white truncate">{v.title || 'Untitled'}</p></div>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* Segment Cards */}
              <div className="flex gap-4 overflow-x-auto pb-2">
                {freeSegments.map((seg, idx) => (
                  <div 
                    key={seg.id} 
                    className="relative shrink-0 w-48 rounded-xl border border-background-tertiary overflow-hidden bg-background group cursor-pointer hover:border-accent/50 transition-colors"
                    onClick={() => {
                      if (seg.status === 'ready' && seg.assets) {
                        setFreePrompt(seg.prompt || '');
                        setFreeAssets(seg.assets.map(a => ({ ...a })));
                      }
                    }}
                  >
                    {seg.status === 'ready' && seg.url ? (
                      /* §2026-05-24 fei: was <video src={seg.url}> — failed
                         to play because seg.url is a Cloudflare Stream HLS
                         URL (videodelivery.net/<uid>/manifest/video.m3u8)
                         that needs hls.js on non-Safari. UnifiedVideoPlayer
                         handles both paths transparently. */
                      <div onClick={e => e.stopPropagation()}>
                        <UnifiedVideoPlayer
                          src={seg.url}
                          className="w-full aspect-video object-cover bg-black"
                          /* §2026-05-30 round-106 path A — PlayerActionBar(customControls)。*/
                          customControls
                          showQualitySelector
                          /* §2026-05-30 round-106 增量C — 段落预览 loop self(跟 Spark 一致)。*/
                          loop
                          playsInline
                        />
                      </div>
                    ) : (
                      <div className="w-full aspect-video bg-background-secondary flex items-center justify-center">
                        <CircleNotch size={24} className="animate-spin text-accent" />
                      </div>
                    )}
                    <div className="p-2">
                      <p className="text-[11px] text-label-secondary truncate">#{idx + 1} {seg.prompt || 'Segment'}</p>
                      <div className="flex items-center justify-between">
                        <p className="text-[10px] text-label-quaternary">{seg.duration ? `${seg.duration}s` : ''} {seg.status === 'generating' ? 'Generating…' : 'Ready'}</p>
                        {seg.status === 'ready' && seg.assets?.length > 0 && (
                          <span className="text-[9px] text-accent">{seg.assets.length} ref{seg.assets.length === 1 ? '' : 's'}</span>
                        )}
                      </div>
                      {/* §2026-05-25 fei: per-segment DB save state.
                          User can see at a glance whether the segment landed
                          in Library and click "重试" if not. The auto-save runs
                          on first ready; this is the recovery path. */}
                      {seg.status === 'ready' && (
                        <div className="mt-1.5 flex items-center justify-between gap-1 text-[10px]">
                          {seg.dbSaveStatus === 'saved' ? (
                            <span className="flex items-center gap-1 text-emerald-600 dark:text-emerald-400" title="已保存到 Library">
                              <CheckCircle size={11} weight="fill" /> 已入库
                            </span>
                          ) : seg.dbSaveStatus === 'pending' || (!seg.dbSaveStatus && !seg.dbSaveError) ? (
                            <span className="flex items-center gap-1 text-label-tertiary" title="正在保存到 Library">
                              <CircleNotch size={11} className="animate-spin" /> 保存中
                            </span>
                          ) : (
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                setFreeSegments(prev => prev.map(s => s.id === seg.id ? { ...s, dbSaveStatus: 'pending', dbSaveError: null } : s));
                                saveFreeSegmentToLibrary({
                                  segId: seg.id,
                                  permanentUrl: seg.url,
                                  prompt: seg.prompt,
                                  isAutoSave: false,
                                });
                              }}
                              title={seg.dbSaveError || '点击重试保存到 Library'}
                              className="flex items-center gap-1 text-amber-600 dark:text-amber-400 hover:text-amber-700 transition-colors"
                            >
                              <ArrowsClockwise size={11} weight="bold" /> 重试保存
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                    <button onClick={(e) => { e.stopPropagation(); handleRemoveSegment(seg.id); }} className="absolute top-1 right-1 bg-black/50 p-1 rounded-full text-white opacity-0 group-hover:opacity-100 transition-opacity"><X size={12} /></button>
                    {idx < freeSegments.length - 1 && <div className="absolute top-1/2 -right-3 transform -translate-y-1/2 text-label-quaternary z-10"><ArrowRight size={14} /></div>}
                  </div>
                ))}
              </div>
            </GlassPane>
          )}

          {/* ── Saved Segments History ── */}
          <GlassPane className="max-w-[720px] mx-auto animate-fade-in" radius={24} contentClassName="relative z-[3] p-6">
            <h3 className="text-base font-medium text-label mb-4 flex items-center gap-2"><FilmStrip size={20} className="text-accent" /> Recent segments</h3>
            {savedSegments.length === 0 && !isLoadingSavedSegments ? (
              <p className="text-sm text-label-secondary text-center py-6">No recent segments yet — once you generate a video it will appear here automatically.</p>
            ) : (
              <div className="space-y-3">
                {savedSegments.map(seg => (
                  <div key={seg.id} className="flex items-center gap-4 p-3 rounded-xl border border-background-tertiary hover:border-accent/30 transition-colors bg-background">
                    <div className="w-28 shrink-0 aspect-video bg-black rounded-lg overflow-hidden">
                      {/* §2026-05-24 fei: was <video src> — black for Stream
                          HLS URLs. UnifiedVideoPlayer renders the first
                          frame via native HLS / hls.js lazy load. */}
                      <UnifiedVideoPlayer
                        src={seg.video}
                        poster={seg.cover}
                        className="w-full h-full object-cover"
                        muted
                        playsInline
                        preload="metadata"
                      />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-label truncate">{seg.title || 'Segment'}</p>
                      <p className="text-[11px] text-label-quaternary mt-0.5">{new Date(seg.createdAt).toLocaleString('zh-CN', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</p>
                    </div>
                    <button
                      onClick={() => {
                        const alreadyInTimeline = freeSegments.some(s => s.url === seg.video);
                        if (!alreadyInTimeline) {
                          setFreeSegments(prev => [...prev, {
                            id: Date.now(),
                            url: seg.video,
                            prompt: seg.title || 'Recent segment',
                            duration: null,
                            status: 'ready',
                            assets: []
                          }]);
                        }
                      }}
                      className="px-3 py-1.5 bg-background-secondary hover:bg-background-tertiary rounded-lg text-xs font-medium text-label transition-colors shrink-0"
                    >
                      Add to timeline
                    </button>
                  </div>
                ))}
              </div>
            )}
            {isLoadingSavedSegments && (
              <div className="flex justify-center py-4"><CircleNotch size={20} className="animate-spin text-accent" /></div>
            )}
            {hasMoreSavedSegments && !isLoadingSavedSegments && savedSegments.length > 0 && (
              <button
                onClick={() => loadSavedSegments(savedSegmentsPage + 1, true)}
                className="w-full mt-4 py-2.5 bg-background-secondary hover:bg-background-tertiary rounded-xl text-sm font-medium text-label-secondary transition-colors"
              >
                Load more
              </button>
            )}
          </GlassPane>
          </>
        )}

        {/* ─── Upload Video Mode ─────────────────────────────────────────────
            User submits an existing video they own the rights to. After admin
            approval (SLA 48h) the video is published to Discover. Pipeline:
            init-upload → Stream Direct Upload → finalize → admin review queue.
            See migrations/20260507_user_video_uploads.up.sql for full schema. */}
        {generationMode === 'upload' && (
          /* 2026-05-18 Leon — Upload Video "上下两大块控制平台"结构 v2:
           *   - 上块 720 (主呈现 + metadata): file picker + Title + Description
           *   - 下块 512 (acknowledgement + action): Copyright + Submit (右下)
           * 玻璃从 glass-clear 升级到 glass-regular (regular material) —
           *   原 clear 太透 (bg 0.08, border 0.18),磨砂感不够;
           *   regular bg 0.18 + saturate 1.8 + border 0.42,符合 Leon 参考图
           *   "明显磨砂玻璃半透明" 体感.
           * Drop-zone bg 改全透明 (依赖外层玻璃 + sub-card wash 做底),让
           *   drop-zone "嵌入"而非"贴在玻璃上".
           * Title/Description 去 label,placeholder 兼任标识 (含 * 表达 required).
           * Submit 改 inline pill (Library Sequel 同款) + 与 Terms footer
           *   同行右靠齐 (Terms 占左 flex-1).
           * 整体压缩 padding / icon size / textarea rows 控制总高度,
           *   目标 desktop 标准视口 (≥768) 不滚动. */
          <div className="animate-fade-in space-y-3">

            {/* 2026-05-18 Leon round-4 — page-level Header 已移入上块 sub-card
             * 内部顶部 (line ~3608 附近),与 file picker 视觉一体. */}

            {uploadResult?.ok ? (
              /* 成功态: 单卡确认,宽度对位下块 512.
               * 2026-05-19 round-38 (Leon):
               *   1. flex centering wrapper 让 success card 在视口中心
               *   2. radius 改 32px (--radius-glass token, visionOS hero glass 同档)
               *   3. Title ↔ description 间距增大 (description mt-3) */
              <div className="flex items-center justify-center min-h-[60vh]">
                <GlassPane
                  className="max-w-[512px] w-full"
                  contentClassName="relative z-[3] p-5 text-center"
                  radius={32}
                >
                  <CheckCircle size={48} className="mx-auto text-emerald-500" weight="fill" />
                  <h3 className="text-lg font-medium text-label mt-3">Submitted for review</h3>
                  <p className="text-sm text-label-secondary max-w-md mx-auto mt-5">
                    Your video is in our admin queue. We'll review it within 48 hours and notify you of the result.
                  </p>
                  <button
                    onClick={() => setUploadResult(null)}
                    className="mt-5 px-5 py-2 bg-accent hover:bg-accent/90 text-white rounded-full text-sm font-medium transition-colors"
                  >
                    Upload another
                  </button>
                </GlassPane>
              </div>
            ) : (
              <>
                {/* ─── 上块 (720): Header + Left(file picker) + Right(Title/Desc) ──
                 * 2026-05-18 Leon round-4 — sub-card 顶部内嵌 Header (eyebrow +
                 * h2),下方左右两列 grid:
                 *   Left 240px = drop-zone (file picker)
                 *   Right flex-1 = Title input + Description textarea
                 * 横排节省 ~80-100px 垂直,助攻 1440×900 不滚动. mobile <md
                 * 退回纵向 (grid-cols-1). */}
                {/* 2026-05-18 Leon round-8/9:
                 *   - 上块 height 360 (round-8 不滚动定型)
                 *   - grid height 360 - p-2 - p-3 = 320
                 *   - round-9: drop-zone width 180 → 200 (Leon "稍微宽一点").
                 *     比例 200/320 = 0.625 (5:8), 仍偏 portrait 但比严格
                 *     9:16 (0.5625) 宽 ~11%. 让 Header h2 在 Crimson Pro 下
                 *     有更舒展的空间. */}
                {/* 2026-05-19 round-23 — 上模块去掉 inner sub-card 完整包裹层
                 * (Leon: visionOS panel 不嵌套另一个完整 panel,直接坐 chip /
                 * control elements). outer padding p-2 → p-4 补回 inner 之前
                 * 提供的内边距. drop-zone / right column 直接在 panel 内.
                 * 2026-05-19 round-34 — .glass-regular .glass-border-gradient
                 * hybrid 迁到 <GlassPane> (visionOS Windows/Glass authoritative,
                 * SVG Skia stroke + luminosity blend fill + light/dark variant). */}
                <GlassPane
                  className="max-w-[720px] mx-auto md:h-[360px]"
                  contentClassName="relative z-[3] p-4 h-full"
                  radius={32}
                >
                    {/* 2026-05-20 round-66 — gap-3 → gap-4: 与 GlassPane p-4 一致,
                     * panel 内部 4 边 + grid gap 全 16px,符合 visionOS Windows/Glass
                     * 均匀 spacing spec (Leon 报右侧 spacing 4px 短于其他三边)。 */}
                    {/* 2026-05-25 round-75 — drop-zone 200 → 240px (Leon)。chip 行
                     * 4 个 10px font 在 200px 内放不下,240px 给舒展空间。右列
                     * textarea 从 ~472 缩到 ~432,仍宽,无影响。 */}
                    <div className="grid grid-cols-1 md:grid-cols-[240px_1fr] gap-4 items-stretch h-full">

                      {/* Left: Drop-zone — md+ 由 grid template 控制
                       * 200×320 (~5:8 portrait,round-9 加宽).
                       * mobile min-h-180 退回纵向单列 sane height (移除
                       * md:aspect — grid stretch 已锁宽高,aspect 多余).
                       * 内部布局: 顶部 Header (centered) + flex-1 center 区
                       * (cloud icon + 文件 info / empty hint). */}
                      {/* 2026-05-20 round-57 — fill 色彩从手抄 bg-accent/5
                       * 切换到 visionOS Controls/Fills tokens (.fill-idle /
                       * .fill-hover / .fill-pinch / .fill-disabled).
                       * Pinch = mousedown active, Hover = pointer hover
                       * (mobile touch 不触发,无 regression).
                       * 2026-05-20 round-58 — 移除 border-dashed,fill 自身
                       * 视觉反馈足够,dashed 在 visionOS 风格里偏老气。
                       * 2026-05-20 round-61 — 移除 fill-selected:语义错配
                       * (visionOS 中 selected = active control highlight,不是
                       * "completed upload"),且 100% white 在 dark mode 突兀,
                       * 也丢失了 hover/pinch 变化。改为 upload 前后 fill 不变,
                       * 共享 idle/hover/pinch 三态;"已上传" 反馈完全靠内部
                       * 内容承担(绿 CheckCircle + 文件名 + size + hint)。 */}
                      <label
                        className={`relative flex flex-col min-h-[180px] md:min-h-0 px-3 pt-3 pb-3 rounded-2xl transition-colors ${
                          uploadIsSubmitting
                            ? 'fill-disabled cursor-not-allowed'
                            : dropzoneFillState === 'pinch'
                              ? 'fill-pinch cursor-pointer'
                              : dropzoneFillState === 'hover'
                                ? 'fill-hover cursor-pointer'
                                : 'fill-idle cursor-pointer'
                        }`}
                        onMouseEnter={() => !uploadIsSubmitting && setDropzoneFillState((s) => (s === 'pinch' ? s : 'hover'))}
                        onMouseLeave={() => setDropzoneFillState('idle')}
                        onMouseDown={() => !uploadIsSubmitting && setDropzoneFillState('pinch')}
                        onMouseUp={() => !uploadIsSubmitting && setDropzoneFillState('hover')}
                      >
                        {/* Top: Header (Submit your work + Upload Video) — 水平居中 */}
                        <div className="text-center">
                          <span className="text-[10px] uppercase tracking-[0.18em] text-accent font-medium">Submit your work</span>
                          <h2 className="text-lg md:text-xl font-medium text-label tracking-tight mt-0.5" style={{ fontFamily: "'Crimson Pro', 'Georgia', serif" }}>Upload Video</h2>
                        </div>

                        {/* Center fill: Cloud icon + file info / empty hint.
                         * 2026-05-20 round-59 — uploadFile 选中态视觉强化:
                         *   1. icon 换 CheckCircle + emerald-500 (success 语义)
                         *   2. file size 字号 10 → xs (12) + label-secondary (60% alpha)
                         *      让"我选了多大的文件"信息更易扫读
                         *   3. "Click to change" 从 inline link 升级为 pill CTA
                         *      (fill-idle + rounded-full padding) — visual affordance 更强 */}
                        {/* 2026-05-25 round-76b (Leon) — icon + chips + "Select a video"
                         * 整体下移 15px。用 translate-y 不影响 layout / click target。 */}
                        <div className="flex-1 flex flex-col items-center justify-center text-center translate-y-[15px]">
                          {uploadFile ? (
                            <>
                              <CheckCircle size={28} weight="fill" className="text-emerald-500 mb-1.5" />
                              <span className="text-xs font-medium text-label text-center break-all">{uploadFile.name}</span>
                              <span className="text-xs text-label-secondary mt-1">
                                {(uploadFile.size / 1024 / 1024).toFixed(1)} MB
                              </span>
                              {/* 2026-05-20 round-60 — pill 形态去掉:整个 drop-zone
                               * 都是 click target,pill 会误导用户以为"只有 pill 可点".
                               * 改 subtle inline hint (icon + text).
                               * 2026-05-20 round-62 — label-tertiary 在 fill-idle
                               * 上对比度太低,升 label-secondary。
                               * 2026-05-20 round-63 — secondary 在 light/dark fill 上
                               * 仍 "几乎不可见"(Leon),升 label 主色。
                               * 2026-05-20 round-64 — 字号 11 → text-sm (14) font-medium,
                               * 与 "Select a video" 空态文字同级; icon 同比升到 14。 */}
                              <span className="inline-flex items-center gap-1 text-sm font-medium text-label mt-2">
                                <ArrowsClockwise size={14} weight="bold" /> Click to change
                              </span>
                            </>
                          ) : (
                            <>
                              {/* 2026-05-25 round-76 (Leon) — icon 加 48×48 圆底色
                               * (rounded-full + bg 跟 chip 同款 black/8 dark white/10,
                               * 跨 light/dark 视觉一致) + 间距 mb-3 → mb-5 让 icon 跟
                               * chip 行有明显呼吸感。 */}
                              <div className="w-12 h-12 rounded-full bg-black/8 dark:bg-white/10 flex items-center justify-center mb-5">
                                <CloudArrowUp size={22} className="text-label-secondary" />
                              </div>
                              <div className="flex flex-nowrap gap-1 justify-center mb-3">
                                {['MP4', 'WebM', 'MOV', '≤500 MB'].map(label => (
                                  <span
                                    key={label}
                                    className="px-2 py-0.5 bg-black/8 dark:bg-white/10 rounded text-[10px] font-medium text-label-secondary whitespace-nowrap"
                                  >
                                    {label}
                                  </span>
                                ))}
                              </div>
                              <span className="text-sm font-medium text-label">Select a video</span>
                            </>
                          )}
                        </div>

                        <input
                          type="file"
                          accept="video/*"
                          disabled={uploadIsSubmitting}
                          className="absolute inset-0 opacity-0 cursor-pointer disabled:cursor-not-allowed"
                          onChange={(e) => {
                            const f = e.target.files?.[0];
                            if (f) {
                              setUploadFile(f);
                              setUploadResult(null);
                              // Auto-fill title from filename if empty
                              if (!uploadTitle) {
                                setUploadTitle(f.name.replace(/\.[^.]+$/, '').substring(0, 200));
                              }
                            }
                          }}
                        />
                      </label>

                      {/* Right: Title + Description.
                       * min-h-0 + textarea flex-1 让 textarea 自动 fill 剩余
                       * 高度,与左 drop-zone 同底对齐.
                       * 2026-05-20 round-67 — gap-3 → gap-4: 与外层 grid gap-4
                       * 和 panel p-4 一致,panel 内全 16px 均匀 spacing。 */}
                      <div className="flex flex-col gap-4 min-h-0">
                        {/* Title — placeholder 含字数上限说明 (≤200).
                         * 2026-05-18 round-13 — "陷入"效果替换 v10 手写 inset
                         * 为 Figma 已验证的 .material-recessed inset shadow
                         * 4-stack spec (--material-recessed-inset-shadow,
                         * see tokens/materials.css). <input> 不渲染 pseudo-
                         * element,只用 shadow var 单独应用,bg approximation
                         * 仍走 dark:bg-black/40 (blend 结果在 Create dark BG
                         * 上的近似). 调 var 一处全同步,不再手抄. */}
                        {/* 2026-05-22 round-71 (Leon) — 抽 <TextField> primitive 替换
                         * round-69 ad-hoc className 堆砌。visionOS Figma node 137:9597
                         * spec 1:1 (Idle/Typing state base + 4-stack inset shadow + Clear
                         * button + caret-color accent)。详见
                         * src/design-system/primitives/TextField.jsx 头部 doc。 */}
                        <TextField
                          value={uploadTitle}
                          onChange={(e) => setUploadTitle(e.target.value)}
                          maxLength={200}
                          disabled={uploadIsSubmitting}
                          placeholder="Title * (≤200)"
                        />
                        {/* Description — placeholder 含字数上限说明 (≤2000),
                         * multiline + flex-1 + min-h-0 让 textarea 高度 fill 剩余
                         * grid 行。Recessed inset shadow var 同源,与 Title 一致。
                         * multiline 默认不显示 Clear (textarea Clear 误触风险大)。 */}
                        <TextField
                          multiline
                          rows={2}
                          value={uploadDescription}
                          onChange={(e) => setUploadDescription(e.target.value)}
                          maxLength={2000}
                          disabled={uploadIsSubmitting}
                          placeholder="Description (optional, ≤2000)"
                          className="flex-1 min-h-0"
                        />
                      </div>
                    </div>
                </GlassPane>

                {/* ─── 下块 (512): Copyright + Submit ───────────────────
                 * sub-card 1 = Copyright affirmation (acknowledgement)
                 * 裸放 action row = Terms footer (left flex-1) + Submit pill (right)
                 * 2026-05-19 round-34 — 同上块,迁到 <GlassPane>。 */}
                <GlassPane
                  className="max-w-[512px] mx-auto"
                  contentClassName="relative z-[3] p-3 space-y-2"
                  radius={24}
                >

                  {/* sub-card: Copyright affirmation.
                   * 2026-05-22 round-68 Z-C 落地 — `.material-regular` 静态色版本
                   * (materials.css 头部 Z-C doc block 详解)。light/dark 自带 cascade:
                   *   light: rgba(0,0,0,0.05) — 微凹陷,无 inset shadow
                   *   dark:  rgba(0,0,0,0.12) — 中凹陷,backdrop tint 透出来
                   * 无 isolation:isolate (旧 sanity-multiply-gray 带的 SC barrier),
                   * 让 GlassPane backdrop tint 等比例透出来形成"颜色比外围深"视觉。 */}
                  <div className="rounded-xl material-regular p-4">
                    {/* 2026-05-19 round-46 — Checkbox primitive API 改:outer 是
                     * `<label>`,label text 作 children 传入。Click 任何 children
                     * 区域通过 HTML label-control association toggle (a11y 恢复)。 */}
                    <Checkbox
                      checked={uploadCopyrightChecked}
                      onChange={(e) => setUploadCopyrightChecked(e.target.checked)}
                      disabled={uploadIsSubmitting}
                      className="gap-3"
                    >
                      <span className="text-xs text-label-secondary leading-relaxed">
                        <span className="font-medium text-label block mb-1">Copyright Acknowledgement (required)</span>
                        {COPYRIGHT_TEXT}
                      </span>
                    </Checkbox>
                  </div>

                  {/* Progress (uploading 时) */}
                  {uploadIsSubmitting && (
                    <div className="px-4 pt-1 space-y-2">
                      <div className="flex items-center justify-between text-xs text-label-secondary">
                        <span>Uploading…</span>
                        <span className="font-medium text-label">{uploadProgress}%</span>
                      </div>
                      <div className="w-full h-1.5 bg-black/8 dark:bg-white/10 rounded-full overflow-hidden">
                        <div
                          className="h-full bg-accent transition-[width] duration-200"
                          style={{ width: `${uploadProgress}%` }}
                        />
                      </div>
                    </div>
                  )}

                  {/* Error banner */}
                  {uploadResult && !uploadResult.ok && (
                    <div className="mx-4 mt-1 bg-red-500/10 border border-red-500/30 rounded-xl p-3 text-xs text-red-500">
                      {uploadResult.message}
                    </div>
                  )}

                  {/* Action row: Terms + 48h note (left flex-1) + Submit pill (right).
                   * 2026-05-18 Leon round-3 — 48h review 信息从 Header
                   * paragraph 下移到这里 inline.
                   * round-7 — 48h note 改为独立一行 (<br/> 换行),与 Terms
                   * 分两层信息更清晰. */}
                  <div className="px-4 pt-2 pb-1 flex items-center justify-between gap-3 flex-wrap">
                    {/* 2026-05-20 Leon round-56 — Info icon prefix (Figma node
                     * 877:4574, visionOS Controls/Idle fill spec). 28px circle
                     * (size 与 Checkbox 一致,X 中心天然左对齐 Checkbox 中心),
                     * via .fill-idle utility (1:1 token,layer1 white 0.07 normal
                     * + layer2 gray 0.18 color-dodge),不手抄 rgba。 */}
                    <div className="flex items-center gap-3 flex-1 min-w-0">
                      <div className="fill-idle relative rounded-full w-7 h-7 flex items-center justify-center shrink-0">
                        <Info size={16} weight="regular" className="text-label relative z-10" />
                      </div>
                      <p className="text-[10px] text-label-secondary flex-1 min-w-0 leading-relaxed">
                        {/* 2026-05-18 Leon round-8 — text-label-tertiary 在
                         * light mode Create BG 上对比不够 (浅灰 #c7c7c7 +
                         * 玻璃 wash + 黑 30% alpha 几乎看不见). 升级到
                         * label-secondary (60% alpha), 两行同色但都可读.
                         * 2026-05-20 round-56 — 去 <br/> 让 48h review 接到
                         * License. 后,与 Info icon 缩到 28px 配套(行数减少
                         * 让 28px circle 与 1-行文字垂直更协调)。 */}
                        By submitting you agree to our <a href="/legal/terms" target="_blank" className="underline hover:text-label">Terms</a> &amp; <a href="/legal/content-license" target="_blank" className="underline hover:text-label">Content License</a>. <span className="font-medium">~48h review before publishing.</span>
                      </p>
                    </div>
                    <button
                      onClick={handleVideoSubmitForReview}
                      disabled={uploadIsSubmitting || !uploadFile || !uploadTitle.trim() || !uploadCopyrightChecked}
                      className="inline-flex items-center justify-center gap-2 py-2 px-4 bg-accent hover:bg-accent/90 disabled:bg-background-tertiary disabled:text-label-tertiary cursor-pointer disabled:cursor-not-allowed text-white rounded-full text-sm font-medium transition-colors flex-shrink-0"
                    >
                      {uploadIsSubmitting ? (
                        <><CircleNotch size={16} className="animate-spin" /> Uploading…</>
                      ) : (
                        <>Submit for review</>
                      )}
                    </button>
                  </div>
                </GlassPane>
              </>
            )}
          </div>
        )}

        {generationMode === 'quick' && (
          <>
            {/* Slim wizard nav (2026-05-11 Leon): 单行紧凑,~32px 高。
                Removed:
                  - 大 serif h1(各 step 的 title) — 与 form card 内 h2 重复
                  - 多行 eyebrow + title 块 — 占 70-80px 垂直空间
                Kept:
                  - back arrow / step text / progress dots / close
                Logic 完全 1:1,只是压扁 layout。 */}
            <div className="flex items-center justify-between gap-3 mb-1">
              <div className="flex items-center gap-2 min-w-0">
                {step > 0 && step < 4 && (
                  <button onClick={() => setStep(s => s - 1)} className="p-1.5 -ml-1.5 rounded-full hover:bg-background-tertiary text-label-secondary transition-colors flex-shrink-0 cursor-pointer">
                    <CaretLeft size={18} weight="bold" />
                  </button>
                )}
                <p className="text-[10px] font-semibold text-accent tracking-widest uppercase leading-none">
                  {step === 4 ? 'Render' : `Step ${step + 1} of 4`}
                </p>
              </div>
              <div className="flex items-center gap-3 flex-shrink-0">
                <div className="hidden sm:flex gap-1.5">
                  {[0,1,2,3,4].map(s => (
                    <div key={s} className={`h-1 w-5 rounded-full transition-colors ${step >= s ? 'bg-accent' : 'bg-background-tertiary'}`} />
                  ))}
                </div>
                {step > 0 && renderProgress !== 4 && (
                  <button onClick={handleRestartWorkflow} className="p-1.5 rounded-full hover:bg-red-50 text-label-secondary hover:text-red-500 transition-colors cursor-pointer" title="Cancel and restart">
                    <X size={16} />
                  </button>
                )}
              </div>
            </div>

        {/* ── STEP 0: SELECT CHARACTER ── */}
        {step === 0 && (
          <div className="animate-fade-in bg-background-secondary border border-background-tertiary rounded-2xl p-6 md:p-7">
            <div className="flex items-start justify-between gap-4 mb-8">
              <div className="min-w-0 flex-1">
                <h2 className="text-2xl md:text-3xl font-medium text-label tracking-tight mb-2" style={{ fontFamily: "'Crimson Pro', 'Georgia', serif" }}>Select Avatar</h2>
                <p className="text-sm text-label-secondary">We'll extract the identity features and use them to bring the story to life.</p>
              </div>
              <button
                onClick={handleNextToIdea}
                disabled={!selectedCharacterId}
                className="flex-shrink-0 px-4 py-2 bg-accent text-white rounded-full text-sm font-medium flex items-center gap-1.5 hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed transition-opacity cursor-pointer"
              >
                Next: Story Idea <ArrowRight size={14} />
              </button>
            </div>
            
            {isLoadingCharacters ? (
              <div className="py-20 flex justify-center"><CircleNotch size={32} className="animate-spin text-accent" /></div>
            ) : characters.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 text-center border-2 border-dashed border-background-tertiary rounded-2xl bg-background-secondary">
                <ImageIcon size={48} className="text-label-quaternary mb-4" />
                <h3 className="text-lg font-medium text-label mb-2">No Actor yet</h3>
                <p className="text-sm text-label-secondary mb-6 max-w-sm">
                  Create your first Actor in the Library — capture a photo or upload one. You'll need an Actor before you can generate a story.
                </p>
                <button
                  onClick={() => navigate('/library')}
                  className="px-6 py-3 bg-label text-background rounded-full font-medium"
                >
                  Go to Library to create Actor
                </button>
              </div>
            ) : (
              <div className="space-y-6">
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  {/* §2026-05-22 fei: Avatar picker now hides AI-generated
                      Characters entirely (was: gated by showGeneratedChars
                      toggle). Legacy generated_concept rows in DB are filtered
                      out — never shown, never selectable. New generations
                      don't INSERT them anymore. */}
                  {characters.filter(char => {
                    try {
                      const features = typeof char.identity_features === 'string' ? JSON.parse(char.identity_features) : (char.identity_features || {});
                      return features.createdVia !== 'generated_concept';
                    } catch(e) { return true; }
                  }).map(char => (
                    <button
                      key={char.id}
                      onClick={() => setSelectedCharacterId(char.id)}
                      className={`relative aspect-[3/4] rounded-2xl overflow-hidden border-2 transition-all ${selectedCharacterId === char.id ? 'border-accent ring-4 ring-accent/20' : 'border-transparent hover:border-accent/50'}`}
                    >
                      <img src={char.photo_url} alt="Avatar" className="w-full h-full object-cover" />
                      {selectedCharacterId === char.id && (
                        <div className="absolute top-2 right-2 bg-accent text-white rounded-full p-1 shadow-md">
                          <CheckCircle weight="fill" size={20} />
                        </div>
                      )}
                    </button>
                  ))}
                  
                  {(() => {
                    /* 2026-05-12 Leon — refactored to use plans.js β config
                       (FREE:1 / STARTER:2 / CREATOR:3 / STUDIO:4 Actors).
                       baseCharacters 是 Actor (createdVia='upload'),不是 Character。
                       变量名保留为 baseCharacters 待后续 rename pass。
                       2026-05-14 Leon — locked 态从灰按钮 + alert() 升级到完整锁屏
                       卡 (Lock icon + 描述 + Upgrade CTA),视觉语言对齐 Flow tier-gate
                       LockedPreview (上面的 §Flow locked block 同款样式)。 */
                    const baseCharacters = characters.filter(char => {
                      try {
                        const features = typeof char.identity_features === 'string' ? JSON.parse(char.identity_features) : (char.identity_features || {});
                        return features.createdVia !== 'generated_concept';
                      } catch(e) { return true; }
                    });
                    const actorLimit = getTierLimits(userTier).actors;
                    const canAddMore = canCreateActor(userTier, baseCharacters.length);
                    const nextTier   = getNextTier(userTier);
                    const tierLabel  = TIER_DISPLAY[userTier]?.label || userTier;
                    const nextLabel  = nextTier ? TIER_DISPLAY[nextTier]?.label : null;

                    /* ── Locked 卡(达到 plan 限额) ── */
                    if (!canAddMore) {
                      const handleUpgrade = () => {
                        window.dispatchEvent(new CustomEvent('NEOAI_UPGRADE_MODAL', { detail: { feature: 'actor_slots', currentTier: userTier, nextTier } }));
                        /* 同时直接跳订阅页 — 比 modal 更直接,modal 由全局 listener
                           接管,navigate 不冲突。 */
                        if (nextTier) openSubscriptionModal();
                      };
                      return (
                        <div
                          className="aspect-[3/4] rounded-2xl border-2 border-dashed border-background-tertiary/50 bg-background-secondary/30 flex flex-col items-center justify-center gap-2 px-3 py-4 text-center"
                          title={`You've reached your ${tierLabel} plan limit (${actorLimit} Actor${actorLimit > 1 ? 's' : ''})`}
                        >
                          <div className="w-10 h-10 rounded-full bg-fill-secondary flex items-center justify-center mb-1">
                            <Lock size={20} weight="fill" className="text-label-tertiary" />
                          </div>
                          <span className="text-[10px] font-semibold text-label-tertiary tracking-widest uppercase leading-none">
                            {nextLabel ? `Locked · Upgrade to ${nextLabel}` : 'Locked · Highest tier'}
                          </span>
                          <span className="text-sm font-medium text-label">New Actor</span>
                          <span className="text-[11px] text-label-secondary leading-snug px-1">
                            Your {tierLabel} plan includes {actorLimit} Actor{actorLimit > 1 ? 's' : ''}
                            {nextLabel ? `. Upgrade for more slots.` : ' — this is the highest tier.'}
                          </span>
                          {nextTier && (
                            <button
                              onClick={handleUpgrade}
                              className="mt-1 inline-flex items-center gap-1 px-3 py-1.5 rounded-full bg-accent hover:bg-accent/90 text-white text-[11px] font-medium transition-colors cursor-pointer"
                            >
                              Upgrade Plan
                              <ArrowRight size={11} />
                            </button>
                          )}
                          <span className="text-[10px] text-label-tertiary mt-0.5">({baseCharacters.length}/{actorLimit})</span>
                        </div>
                      );
                    }

                    /* §2026-05-22 fei: "+ New Actor" 按钮跳到 Library 而不是
                       本地打开 creator — Library 现在是 Actor 创建的唯一入口。 */
                    return (
                      <button
                        onClick={() => navigate('/library')}
                        className="flex flex-col items-center justify-center gap-2 aspect-[3/4] rounded-2xl border-2 border-dashed border-background-tertiary hover:border-accent/50 hover:bg-background-secondary text-label-secondary hover:text-accent cursor-pointer transition-colors"
                        title="Create new Actor in Library"
                      >
                        <div className="w-10 h-10 rounded-full bg-background-tertiary flex items-center justify-center mb-1">
                          <span className="text-xl leading-none font-medium">+</span>
                        </div>
                        <span className="text-sm font-medium">New Actor</span>
                        <span className="text-[10px] opacity-70 block mt-1">({baseCharacters.length}/{actorLimit}) · in Library</span>
                      </button>
                    );
                  })()}
                </div>

                {/* §2026-05-22 fei: removed "Show past AI-generated
                    characters" toggle along with the whole AI-Character
                    concept. Picker now only shows Avatars. */}

                {/* §2026-05-23 fei: Character role / seed editor (optional).
                    Shown only when an actor is selected, since the seed only
                    makes sense in the context of a specific character.
                    Collapsible — defaults closed so users not interested in
                    fine-grained character design don't see clutter. */}
                {selectedCharacterId && (
                  <div className="mt-6 border-t border-background-tertiary pt-6">
                    <button
                      type="button"
                      onClick={() => setShowCharacterSeedPanel(s => !s)}
                      className="w-full flex items-center justify-between text-left group"
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <Sparkle size={16} weight="fill" className="text-accent flex-shrink-0" />
                        <div className="min-w-0">
                          <h3 className="text-sm font-medium text-label">
                            Character role <span className="text-label-tertiary text-xs font-normal">(optional · for this story)</span>
                          </h3>
                          <p className="text-xs text-label-secondary mt-0.5">
                            {Object.values(characterSeed).some(v => (v || '').trim())
                              ? `Custom seed set${characterSeed.name ? ` — ${characterSeed.name}` : ''}`
                              : 'Describe who this actor plays. AI fills the details, or you edit by hand.'}
                          </p>
                        </div>
                      </div>
                      <span className="text-label-tertiary text-xs flex-shrink-0">
                        {showCharacterSeedPanel ? '收起 ▴' : '展开 ▾'}
                      </span>
                    </button>

                    {showCharacterSeedPanel && (
                      <div className="mt-5 space-y-4">
                        {/* Quick describe + AI Expand */}
                        <div>
                          <label className="block text-xs font-medium text-label-secondary mb-1.5">
                            Quick describe
                          </label>
                          <textarea
                            value={characterSeedHint}
                            onChange={e => setCharacterSeedHint(e.target.value)}
                            placeholder="e.g. Seralya Veil, a mythic ribbon dancer whose body dissolves into flowing motion."
                            rows={2}
                            className="w-full px-3 py-2.5 bg-background border border-background-tertiary rounded-xl text-sm text-label placeholder-label-tertiary focus:outline-none focus:border-accent transition-colors resize-none"
                          />
                          <div className="flex items-center gap-2 mt-2">
                            <button
                              type="button"
                              onClick={handleExpandCharacterSeed}
                              disabled={!characterSeedHint.trim() || isExpandingSeed}
                              className="px-4 py-2 bg-accent text-white rounded-full text-xs font-medium flex items-center gap-1.5 hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed transition-opacity"
                            >
                              {isExpandingSeed ? (
                                <><CircleNotch size={12} className="animate-spin" /> AI 扩写中...</>
                              ) : (
                                <><Sparkle size={12} weight="fill" /> ✨ AI 扩写为 5 个字段</>
                              )}
                            </button>
                            {(characterSeed.name || characterSeed.seed) && (
                              <button
                                type="button"
                                onClick={() => setCharacterSeed({ name: '', seed: '', ageBody: '', visualMedium: '', style: '', otherDetails: '' })}
                                className="px-3 py-2 text-label-secondary hover:text-label text-xs transition-colors"
                              >
                                清空
                              </button>
                            )}
                          </div>
                          {seedExpandError && (
                            <p className="text-xs text-red-400 mt-2">{seedExpandError}</p>
                          )}
                        </div>

                        {/* 5 editable fields */}
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                          <div>
                            <label className="block text-[11px] font-semibold tracking-wider text-label-secondary mb-1 uppercase">
                              Name
                            </label>
                            <input
                              type="text"
                              value={characterSeed.name}
                              onChange={e => setCharacterSeed(s => ({ ...s, name: e.target.value }))}
                              placeholder="Seralya Veil"
                              className="w-full px-3 py-2 bg-background border border-background-tertiary rounded-lg text-sm text-label placeholder-label-tertiary focus:outline-none focus:border-accent"
                            />
                          </div>
                          <div>
                            <label className="block text-[11px] font-semibold tracking-wider text-label-secondary mb-1 uppercase">
                              Visual medium
                            </label>
                            <input
                              type="text"
                              value={characterSeed.visualMedium}
                              onChange={e => setCharacterSeed(s => ({ ...s, visualMedium: e.target.value }))}
                              placeholder="Stylized 3D animation character design..."
                              className="w-full px-3 py-2 bg-background border border-background-tertiary rounded-lg text-sm text-label placeholder-label-tertiary focus:outline-none focus:border-accent"
                            />
                          </div>
                        </div>

                        <div>
                          <label className="block text-[11px] font-semibold tracking-wider text-label-secondary mb-1 uppercase">
                            Character seed <span className="text-label-tertiary normal-case font-normal">— role + identity</span>
                          </label>
                          <textarea
                            value={characterSeed.seed}
                            onChange={e => setCharacterSeed(s => ({ ...s, seed: e.target.value }))}
                            placeholder="e.g. Seralya Veil, mythic ribbon dancer and living choreography performer. An unearthly elegant woman whose body and costume dissolve into flowing motion."
                            rows={2}
                            className="w-full px-3 py-2 bg-background border border-background-tertiary rounded-lg text-sm text-label placeholder-label-tertiary focus:outline-none focus:border-accent resize-none"
                          />
                        </div>

                        <div>
                          <label className="block text-[11px] font-semibold tracking-wider text-label-secondary mb-1 uppercase">
                            Age / body type
                          </label>
                          <textarea
                            value={characterSeed.ageBody}
                            onChange={e => setCharacterSeed(s => ({ ...s, ageBody: e.target.value }))}
                            placeholder="e.g. Appears mid-20s. Tall and slender with elongated graceful proportions, lightweight presence, weightless dancer physique."
                            rows={2}
                            className="w-full px-3 py-2 bg-background border border-background-tertiary rounded-lg text-sm text-label placeholder-label-tertiary focus:outline-none focus:border-accent resize-none"
                          />
                        </div>

                        <div>
                          <label className="block text-[11px] font-semibold tracking-wider text-label-secondary mb-1 uppercase">
                            Style <span className="text-label-tertiary normal-case font-normal">— costume + aesthetic mood</span>
                          </label>
                          <textarea
                            value={characterSeed.style}
                            onChange={e => setCharacterSeed(s => ({ ...s, style: e.target.value }))}
                            placeholder="e.g. Poetic mythic fantasy, elegant living-performance aesthetic, ethereal ceremonial costume design, silk-and-wind visual language."
                            rows={2}
                            className="w-full px-3 py-2 bg-background border border-background-tertiary rounded-lg text-sm text-label placeholder-label-tertiary focus:outline-none focus:border-accent resize-none"
                          />
                        </div>

                        <div>
                          <label className="block text-[11px] font-semibold tracking-wider text-label-secondary mb-1 uppercase">
                            Other details <span className="text-label-tertiary normal-case font-normal">— optional · face / hair / accessories</span>
                          </label>
                          <textarea
                            value={characterSeed.otherDetails}
                            onChange={e => setCharacterSeed(s => ({ ...s, otherDetails: e.target.value }))}
                            placeholder="e.g. Soft asymmetrical facial features, captivating beauty, long flowing hair partially merging with ribbon structures."
                            rows={2}
                            className="w-full px-3 py-2 bg-background border border-background-tertiary rounded-lg text-sm text-label placeholder-label-tertiary focus:outline-none focus:border-accent resize-none"
                          />
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* Next: Story Idea — moved to top-right of card header (2026-05-12) */}
              </div>
            )}
          </div>
        )}

        {/* ── STEP 1: TRANSCRIPT ── */}
        {step === 1 && (
          <div className="animate-fade-in bg-background-secondary border border-background-tertiary rounded-2xl p-6 md:p-7">
            <div className="flex items-start justify-between gap-4 mb-8">
              <div className="min-w-0 flex-1">
                <h2 className="text-2xl md:text-3xl font-medium text-label tracking-tight mb-2" style={{ fontFamily: "'Crimson Pro', 'Georgia', serif" }}>One sentence · one universe</h2>
                <p className="text-sm text-label-secondary">We just need your seed concept — the screenwriter model takes it from there.</p>
              </div>
              <button
                onClick={handleNextToStyle}
                disabled={!transcript.trim()}
                className="flex-shrink-0 px-4 py-2 bg-accent text-white rounded-full text-sm font-medium flex items-center gap-1.5 hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed transition-opacity cursor-pointer"
              >
                Next: Visual Style <ArrowRight size={14} />
              </button>
            </div>

            <div className="space-y-6">
              <div>
                <label className="block text-sm font-medium text-label mb-2">Story description (Transcript)</label>
                <textarea
                  value={transcript}
                  onChange={e => setTranscript(e.target.value)}
                  placeholder="e.g. A barista pulls a perfect espresso in the afternoon sunlight, then looks up and smiles…"
                  rows={4}
                  className="w-full resize-none rounded-2xl border border-background-tertiary bg-background px-4 py-3 text-base text-label placeholder-label-quaternary focus:outline-none focus:ring-2 focus:ring-accent/30 focus:border-accent/50 transition-all"
                />

                {/* Creative Prompt Bubbles */}
                <div className="mt-3 flex flex-wrap gap-2">
                  {promptBubbles.map(({ emoji, text }, idx) => (
                    <button
                      key={idx + '-' + text.substring(0, 5)}
                      type="button"
                      onClick={() => setTranscript(text)}
                      className="group flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-background-tertiary bg-background-secondary text-xs text-label-secondary hover:border-accent/40 hover:bg-accent/5 hover:text-accent active:scale-95 transition-all duration-150 animate-fade-in"
                    >
                      <span>{emoji}</span>
                      <span className="max-w-[120px] truncate">{text}</span>
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-label mb-2">Video type</label>
                <div className="grid grid-cols-2 gap-3">
                  {VIDEO_TYPES.map(vt => (
                    <button
                      key={vt.id}
                      onClick={() => {
                        setVideoType(vt.id);
                        // §2026-05-22 fei: style picker is now videoType-
                        //   filtered (3 curated styles per genre). If the
                        //   user had picked a style that's not in the new
                        //   videoType's curated list, reset it so the picker
                        //   doesn't show a phantom selection that's invisible
                        //   in the new filter.
                        const newGenreStyles = VIDEO_TYPE_STYLES[vt.id];
                        if (newGenreStyles && selectedStyle && !newGenreStyles.includes(selectedStyle)) {
                          setSelectedStyle('');
                          setSelectedStyleName('');
                        }
                      }}
                      className={`p-3 rounded-xl border text-left transition-all ${videoType === vt.id ? 'bg-accent/5 text-accent border-accent/50 ring-1 ring-accent/20' : 'bg-background border-background-tertiary text-label-secondary hover:border-accent/30 hover:bg-background-secondary'}`}
                    >
                      <span className="text-sm font-medium">{vt.name}</span>
                    </button>
                  ))}
                </div>
              </div>

              {/* §2026-05-23 fei: Story length picker — multi-segment story.
                  Each segment is one 10-15s rendered video clip. The user
                  pays per segment as they render (controlled by Step 4 flow),
                  so picking 5 here doesn't lock them into rendering all 5. */}
              <div>
                <label className="block text-sm font-medium text-label mb-2">
                  Story length
                  <span className="ml-2 text-xs font-normal text-label-tertiary">
                    Each segment = 10-15s · render one at a time
                  </span>
                </label>
                <div className="grid grid-cols-5 gap-2">
                  {[1, 2, 3, 4, 5].map(n => {
                    const estMinSec = n * 10;
                    const estMaxSec = n * 15;
                    return (
                      <button
                        key={n}
                        onClick={() => setSegmentCount(n)}
                        className={`p-3 rounded-xl border text-center transition-all ${segmentCount === n ? 'bg-accent/5 text-accent border-accent/50 ring-1 ring-accent/20' : 'bg-background border-background-tertiary text-label-secondary hover:border-accent/30 hover:bg-background-secondary'}`}
                      >
                        <div className="text-lg font-semibold">{n}</div>
                        <div className="text-[10px] mt-0.5 leading-tight">
                          {n === 1 ? '~12s' : `~${estMinSec}-${estMaxSec}s`}
                        </div>
                      </button>
                    );
                  })}
                </div>
                {segmentCount > 1 && (
                  <p className="mt-2 text-xs text-label-tertiary leading-relaxed">
                    AI 会把故事拆成 <span className="text-accent font-medium">{segmentCount} 段</span>，每段 10-15 秒的连续视频。
                    渲染时<span className="text-label-secondary font-medium">一段一段来</span>，每段单独扣费，可中途停。
                    所有段共享同一张大故事板图作为视觉参考。
                  </p>
                )}
              </div>
            </div>

            {/* Next: Visual Style — moved to top-right (2026-05-12) */}
          </div>
        )}

        {/* ── STEP 2: STYLE ── */}
        {step === 2 && (
          <div className="animate-fade-in bg-background-secondary border border-background-tertiary rounded-2xl p-6 md:p-7">
            <div className="flex items-start justify-between gap-4 mb-8">
              <div className="min-w-0 flex-1">
                <h2 className="text-2xl md:text-3xl font-medium text-label tracking-tight mb-2" style={{ fontFamily: "'Crimson Pro', 'Georgia', serif" }}>Choose your visual style</h2>
                <p className="text-sm text-label-secondary">We'll use this style to generate concept art and the final video. (Photorealistic styles may trigger live-person safety review.)</p>
              </div>

              {/* §2026-05-27 fei — language picker + Next button group.
                  Auto-detect default: shows the resolved language as a hint
                  (e.g. "Auto · 中文 ▾") so user can SEE what'll be used
                  before clicking Next. Click pill to override with explicit
                  pick (中文 / English / 日本語 / 한국어 / Español / Français /
                  Deutsch / Português / العربية / Русский). Choice persists
                  to draft so reload/device switch keeps the pick.
                  Backdrop overlay closes on click-outside. */}
              <div className="flex-shrink-0 flex items-center gap-2 relative">
                {(() => {
                  const SCRIPT_LANG_OPTIONS = [
                    // [label_shown_in_pill, llm_lang_directive_string]
                    ['中文',     'Chinese (Simplified or Traditional, matching the user input)'],
                    ['English',  'English'],
                    ['日本語',   'Japanese'],
                    ['한국어',   'Korean'],
                    ['Español',  'Spanish'],
                    ['Français', 'French'],
                    ['Deutsch',  'German'],
                    ['Português','Portuguese'],
                    ['العربية',  'Arabic'],
                    ['Русский',  'Russian'],
                  ];
                  // Resolve current label for pill text. If outputLanguage
                  // null → run detector against transcript so user sees the
                  // auto-resolved language before they click Next.
                  const currentLangRaw = outputLanguage || detectInputLanguage(transcript || '');
                  const currentEntry = SCRIPT_LANG_OPTIONS.find(([, val]) => val === currentLangRaw);
                  const pillLabel = outputLanguage
                    ? (currentEntry ? currentEntry[0] : '自定义')
                    : `自动 · ${currentEntry ? currentEntry[0] : (currentLangRaw.split(/[\s(]/)[0] || 'English')}`;
                  return (
                    <>
                      <button
                        type="button"
                        onClick={() => setLangMenuOpen(s => !s)}
                        className="px-3 py-1.5 rounded-full bg-background border border-background-tertiary hover:border-accent/50 text-label-secondary hover:text-label text-xs font-medium flex items-center gap-1.5 transition-colors"
                        title="输出脚本的语言。默认从输入文本自动检测,点这里可手动覆盖。"
                      >
                        🌐 <span>{pillLabel}</span>
                        <span className="opacity-60">▾</span>
                      </button>
                      {langMenuOpen && (
                        <>
                          <div
                            className="fixed inset-0 z-40"
                            onClick={() => setLangMenuOpen(false)}
                          />
                          <div className="absolute top-full right-0 mt-1 min-w-[180px] rounded-xl bg-background border border-background-tertiary shadow-xl py-1 z-50 max-h-[60vh] overflow-y-auto">
                            <button
                              type="button"
                              onClick={() => { setOutputLanguage(null); setLangMenuOpen(false); }}
                              className={`w-full text-left px-3 py-2 text-xs hover:bg-background-secondary ${!outputLanguage ? 'text-accent font-medium' : 'text-label'}`}
                            >
                              {!outputLanguage ? '✓ ' : '  '}自动检测 <span className="text-[10px] opacity-60">(根据输入文字)</span>
                            </button>
                            <div className="my-1 border-t border-background-tertiary" />
                            {SCRIPT_LANG_OPTIONS.map(([label, val]) => {
                              const isActive = outputLanguage === val;
                              return (
                                <button
                                  key={val}
                                  type="button"
                                  onClick={() => { setOutputLanguage(val); setLangMenuOpen(false); }}
                                  className={`w-full text-left px-3 py-2 text-xs hover:bg-background-secondary ${isActive ? 'text-accent font-medium' : 'text-label'}`}
                                >
                                  {isActive ? '✓ ' : '  '}{label}
                                </button>
                              );
                            })}
                          </div>
                        </>
                      )}
                    </>
                  );
                })()}
                <button
                  onClick={() => handleGenerateScript(false)}
                  disabled={!selectedStyle}
                  className="flex-shrink-0 px-4 py-2 bg-accent text-white rounded-full text-sm font-medium flex items-center gap-1.5 hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed transition-opacity cursor-pointer"
                >
                  Next: Summon AI <Sparkle size={14} weight="fill" />
                </button>
              </div>
            </div>
            
            {/* §2026-05-22 fei: style picker now filtered by videoType (3
                curated styles per genre). Was: 11-style flat list with
                category tabs. Now: focused trio per genre — Trailer gets
                cinematic/arcane/steampunk, MV gets spider-verse/cyberpunk/
                retrowave, etc. See VIDEO_TYPE_STYLES in src/data/styles.js
                for the full mapping.
                Old category tabs removed (3 items don't need tabs).
                If videoType unset, fall back to all 11 styles. */}
            {(() => {
              const genreStyleIds = VIDEO_TYPE_STYLES[videoType];
              const curatedStyles = genreStyleIds
                ? genreStyleIds.map(id => STYLES.find(s => s.id === id)).filter(Boolean)
                : STYLES.filter(s => s.id !== 'custom');
              /* §2026-05-25 fei — always append the Custom card at the
               * end so user can write their own style. Not duplicated
               * when fallthrough 'all styles' branch already includes it. */
              const customStyle = STYLES.find(s => s.id === 'custom');
              if (customStyle && !curatedStyles.find(s => s.id === 'custom')) {
                curatedStyles.push(customStyle);
              }
              const curatedLabel = videoType
                ? `Curated for ${VIDEO_TYPES.find(v => v.id === videoType)?.name || videoType}`
                : `All styles`;
              return (
                <>
                  <div className="mb-5 flex items-center gap-2 text-xs text-label-tertiary">
                    <span className="px-3 py-1 rounded-full bg-accent/10 text-accent font-medium">
                      {curatedLabel}
                    </span>
                    <span className="text-label-quaternary">
                      ({curatedStyles.length} {curatedStyles.length === 1 ? 'style' : 'styles'} matched to your video type)
                    </span>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    {curatedStyles.map(style => (
                      <button
                        key={style.id}
                        onClick={() => { setSelectedStyle(style.id); setSelectedStyleName(style.name); }}
                        className={`group relative aspect-[4/3] rounded-2xl overflow-hidden border-2 transition-all cursor-pointer ${selectedStyle === style.id ? 'border-accent shadow-md shadow-accent/20 scale-[1.02]' : `${style.border} hover:border-label-tertiary opacity-90 hover:opacity-100`}`}
                      >
                        {/* Style preview image — §2026-05-23 fei: with the
                            new 21-style set we don't have generated previews
                            yet. Fall back to a gradient + large style.icon
                            emoji so the cards still feel distinct. Will be
                            replaced with real GPT-image-2 sample renders
                            later. */}
                        {style.image ? (
                          <img
                            src={style.image}
                            alt={style.name}
                            loading="lazy"
                            className="absolute inset-0 w-full h-full object-cover transition-transform group-hover:scale-105"
                          />
                        ) : (
                          <div className={`absolute inset-0 bg-gradient-to-br ${style.color} flex items-center justify-center`}>
                            <span className="text-5xl md:text-6xl drop-shadow-lg select-none" role="img" aria-label={style.name}>
                              {style.icon || '🎨'}
                            </span>
                          </div>
                        )}
                        {/* Gradient overlay for text legibility */}
                        <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/20 to-transparent" />
                        {/* Check mark for selected */}
                        {selectedStyle === style.id && (
                          <div className="absolute top-3 right-3 bg-accent text-white rounded-full p-1 shadow-md">
                            <CheckCircle weight="fill" size={18} />
                          </div>
                        )}
                        {/* Name overlay (bottom-left, on dark gradient).
                            §2026-05-22: removed redundant category sublabel
                            (was showing 'Animation Classics' / 'Cinematic
                            & Genre' but with curated trio that's noise). */}
                        <div className="absolute bottom-0 left-0 right-0 p-3 text-left">
                          <p className="text-sm font-semibold text-white leading-tight drop-shadow-md">{style.name}</p>
                          {style.feel && <p className="text-[11px] text-white/70 mt-0.5 drop-shadow">{style.feel}</p>}
                        </div>
                      </button>
                    ))}
                  </div>

                  {/* §2026-05-25 fei — Custom style input panel.
                      Appears under the grid when 'custom' card is selected.
                      Textarea is the actual style prompt body that will be
                      sent to GPT-image-2 as the visual style spec. Empty
                      input → falls back to a generic "user-defined" stub
                      string and the user still gets a usable image, but
                      we surface a soft warning hint to guide them. */}
                  {selectedStyle === 'custom' && (
                    <div className="mt-5 p-5 rounded-2xl border-2 border-accent/40 bg-accent/5 animate-fade-in">
                      <div className="flex items-start gap-3 mb-3">
                        <div className="w-8 h-8 rounded-lg bg-accent/15 text-accent flex items-center justify-center text-base shrink-0">✏️</div>
                        <div className="min-w-0 flex-1">
                          <h4 className="text-sm font-medium text-label">自定义风格</h4>
                          <p className="text-xs text-label-tertiary mt-0.5 leading-relaxed">
                            写一段英文 (或中文 / 中英混排都行) 描述你想要的视觉风格。
                            高效写法:具体光线词 + 镜头/构图 + 渲染媒介 + 文化参照。
                            例如 "1980s Tokyo neon-noir, soft volumetric haze, Wong Kar-wai handheld energy, 16mm grain, jewel-tone palette"。
                          </p>
                        </div>
                      </div>
                      <textarea
                        value={customStylePrompt}
                        onChange={e => setCustomStylePrompt(e.target.value)}
                        rows={4}
                        maxLength={1500}
                        placeholder="例:Studio Ghibli watercolor backgrounds with Kodak Portra 400 film grain on characters, golden-hour rim light, Wes Anderson symmetrical framing…"
                        className="w-full rounded-xl border border-background-tertiary bg-background p-3 text-sm text-label placeholder:text-label-tertiary focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent/30 resize-y min-h-[100px]"
                      />
                      <div className="flex items-center justify-between mt-2 text-[11px] text-label-tertiary">
                        <span>
                          {customStylePrompt.trim().length === 0
                            ? '⚠️ 留空会用通用 fallback,效果不可控,建议写 30 字以上'
                            : customStylePrompt.trim().length < 30
                              ? '📝 太短,GPT 难以把握风格 — 至少 30 字'
                              : '✓ 长度合适'}
                        </span>
                        <span className="tabular-nums">{customStylePrompt.length} / 1500</span>
                      </div>
                    </div>
                  )}
                </>
              );
            })()}

            {/* Next: Summon AI screenwriter — moved to top-right (2026-05-12) */}
          </div>
        )}

        {/* ── STEP 3: SCREENWRITER ── */}
        {step === 3 && (
          <div className="animate-fade-in bg-background-secondary border border-background-tertiary rounded-2xl p-6 md:p-7">
            {/* §2026-05-25 fei — render error banner reachable from Step 3
                (handleConfirmStoryboard / handleEnterRenderStation paths) */}
            <InlineErrorBanner
              error={renderError}
              title={renderError?.title}
              help={renderError?.help}
              onDismiss={() => setRenderError(null)}
              onRetry={renderError?.retry}
            />
            {isGeneratingScript ? (
              <div className="flex flex-col items-center justify-center py-20 text-center space-y-6">
                <div className="relative">
                  <div className="absolute inset-0 bg-accent/20 rounded-full blur-xl animate-pulse" />
                  <Sparkle size={48} className="text-accent animate-spin-slow relative z-10" />
                </div>
                <div>
                  <h3 className="text-lg font-medium text-label mb-2">Screenwriter model is drafting your script…</h3>
                  <p className="text-sm text-label-secondary">Expanding your one-line idea into professional shots, camera moves, and rendering prompts.</p>
                </div>
              </div>
            ) : generatedScript ? (
              <div className="space-y-6">
                {/* Header row: chip + summary on left, primary Next on right */}
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0 flex-1">
                    <div className="inline-flex items-center gap-1.5 px-3 py-1 bg-accent/10 text-accent text-xs font-semibold uppercase tracking-wider rounded-full mb-3">
                       <CheckCircle size={14} /> Script ready
                    </div>
                    <h2 className="text-xl font-medium text-label mb-2" style={{ fontFamily: "'Crimson Pro', 'Georgia', serif" }}>Story summary</h2>
                    <p className="text-sm text-label-secondary leading-relaxed p-4 bg-background-secondary rounded-xl border border-background-tertiary">
                      {generatedScript.summary}
                    </p>
                  </div>
                  <button
                    onClick={handleRequestRenderEntry}
                    className="flex-shrink-0 px-4 py-2 bg-accent text-white rounded-full text-sm font-medium flex items-center gap-1.5 hover:opacity-90 transition-opacity cursor-pointer"
                  >
                    Render ({quickModeCost} Tokens) <VideoCamera size={14} />
                  </button>
                </div>

                {/* §2026-05-23 fei: multi-segment script display.
                    Backwards compat: when segmentCount === 1, show shots flat
                    like before. When > 1, show N segment cards, each with
                    its own shot list + target duration + segment summary. */}
                {(() => {
                  const segments = generatedScript.segments || [];
                  const isMultiSegment = segmentCount > 1 && segments.length > 1;

                  if (!isMultiSegment) {
                    // Single-segment view (legacy)
                    return (
                      <div>
                        <h2 className="text-lg font-medium text-label mb-4" style={{ fontFamily: "'Crimson Pro', 'Georgia', serif" }}>Generated shots</h2>
                        <div className="space-y-3">
                          {(generatedScript.shots || []).map((shot, i) => (
                            <div key={shot.number || i} className="flex gap-4 p-4 rounded-xl border border-background-tertiary hover:border-accent/30 transition-colors">
                              <div className="w-8 h-8 rounded-full bg-background-tertiary flex items-center justify-center font-bold text-xs text-label-secondary flex-shrink-0">
                                {shot.number || (i + 1)}
                              </div>
                              <div>
                                <p className="text-sm font-medium text-label mb-1">
                                  <FilmStrip size={14} className="inline mr-1 text-label-tertiary align-text-bottom" />
                                  {shot.camera || '—'} {shot.duration ? `(${shot.duration}s)` : ''}
                                </p>
                                <p className="text-xs text-label-secondary">{shot.action}</p>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    );
                  }

                  // Multi-segment view — one card per segment, expandable
                  return (
                    <div>
                      <h2 className="text-lg font-medium text-label mb-4" style={{ fontFamily: "'Crimson Pro', 'Georgia', serif" }}>
                        Segments
                        <span className="ml-2 text-sm font-normal text-label-tertiary">
                          {segments.length} segments · ~{generatedScript.totalDuration || segments.length * 12}s total
                        </span>
                      </h2>
                      {/* §2026-05-23 fei: LLM returned zero shot data → warn user.
                          Common cause: edge-fn screenwriter didn't comply with
                          our segments[] schema and dropped shot bodies.
                          User should click Regenerate. */}
                      {generatedScript._llmReturnedNoShots && (
                        <div className="mb-4 p-4 rounded-xl border border-amber-500/40 bg-amber-500/10 text-sm text-amber-200">
                          ⚠️ <span className="font-medium">剧本生成不完整</span> ——
                          AI 返回了空 shot 数据。请点下方 "Regenerate script" 重新生成。
                          如果重复出现，可以减少段数（5 段 → 3 段）让 AI 更稳定。
                        </div>
                      )}
                      <div className="space-y-4">
                        {segments.map((seg, segIdx) => {
                          const segNumber = seg.segmentIndex || (segIdx + 1);
                          const shotCount = (seg.shots || []).length;
                          return (
                            <div
                              key={segNumber}
                              className="rounded-2xl border border-background-tertiary bg-background-secondary/30 overflow-hidden"
                            >
                              {/* Segment header */}
                              <div className="px-4 py-3 bg-accent/5 border-b border-background-tertiary flex items-center gap-3">
                                <div className="w-9 h-9 rounded-full bg-accent text-white flex items-center justify-center font-bold text-sm flex-shrink-0">
                                  {segNumber}
                                </div>
                                <div className="min-w-0 flex-1">
                                  <p className="text-sm font-semibold text-label leading-tight truncate">
                                    Segment {segNumber} of {segments.length}
                                  </p>
                                  <p className="text-xs text-label-secondary mt-0.5">
                                    {shotCount} shot{shotCount === 1 ? '' : 's'} · ~{seg.targetDurationSec || 12}s
                                  </p>
                                </div>
                              </div>
                              {/* Segment summary */}
                              {seg.summary && (
                                <p className="px-4 py-2.5 text-xs text-label-secondary italic border-b border-background-tertiary leading-relaxed">
                                  {seg.summary}
                                </p>
                              )}
                              {/* Shots inside this segment */}
                              <div className="p-3 space-y-2">
                                {(seg.shots || []).map((shot, shotIdx) => (
                                  <div
                                    key={shot.number || `${segNumber}-${shotIdx}`}
                                    className="flex gap-3 p-3 rounded-lg bg-background/50 hover:bg-background transition-colors"
                                  >
                                    <div className="w-7 h-7 rounded-full bg-background-tertiary flex items-center justify-center font-semibold text-[11px] text-label-secondary flex-shrink-0">
                                      {shot.number || (shotIdx + 1)}
                                    </div>
                                    <div className="min-w-0 flex-1">
                                      <p className="text-xs font-medium text-label mb-0.5">
                                        <FilmStrip size={12} className="inline mr-1 text-label-tertiary align-text-bottom" />
                                        {shot.camera || '—'} {shot.duration ? `(${shot.duration}s)` : ''}
                                      </p>
                                      <p className="text-xs text-label-secondary leading-snug">{shot.action}</p>
                                    </div>
                                  </div>
                                ))}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                      <p className="mt-3 text-xs text-label-tertiary">
                        Step 4 will render one segment at a time. You pay per segment and can stop after any segment.
                      </p>
                    </div>
                  );
                })()}

                {/* Secondary actions only — primary "Next: Render" moved to top-right header. */}
                <div className="mt-8 flex justify-end flex-wrap gap-4">
                  <button onClick={() => setStep(2)} className="px-5 py-2 text-sm text-label-secondary hover:text-label transition-colors cursor-pointer">
                    Adjust again
                  </button>
                  <button onClick={() => handleGenerateScript(true)} className="px-5 py-2 text-sm text-label-secondary hover:text-label transition-colors flex items-center gap-1.5 cursor-pointer">
                    <ArrowsClockwise size={14} /> Regenerate script
                  </button>
                </div>
              </div>
            ) : scriptGenError ? (
              /* §2026-06-05 — 生成失败态(替代原 `: null` 空白)。给受控重试 + 改提示,
                 不自动重跑(避免后端持续超时时的死循环)。根因多为 BUG-006 后端超时。 */
              <div className="flex flex-col items-center justify-center py-16 text-center space-y-5">
                <div className="w-14 h-14 rounded-full bg-red-500/10 text-red-500 flex items-center justify-center">
                  <ShieldWarning size={28} weight="bold" />
                </div>
                <div>
                  <h3 className="text-lg font-medium text-label mb-2">Couldn't generate the script</h3>
                  <p className="text-sm text-label-secondary max-w-md mx-auto leading-snug">{scriptGenError}</p>
                </div>
                <div className="flex items-center gap-3">
                  <button
                    onClick={() => setStep(2)}
                    className="px-5 py-2.5 rounded-full bg-background-secondary hover:bg-background-tertiary text-label text-sm font-medium transition cursor-pointer"
                  >
                    Edit prompt
                  </button>
                  <button
                    onClick={() => handleGenerateScript(false)}
                    className="px-5 py-2.5 rounded-full bg-accent text-white text-sm font-medium flex items-center gap-1.5 hover:opacity-90 transition cursor-pointer shadow-md shadow-accent/20"
                  >
                    <ArrowsClockwise size={16} weight="bold" /> Try again
                  </button>
                </div>
              </div>
            ) : null}
          </div>
        )}
        </>
        )}

        {/* ── STEP 4: RENDER STATION ── */}
        {step === 4 && (
          <div className="animate-fade-in bg-background-secondary border border-background-tertiary rounded-2xl p-6 md:p-7">
            <h2 className="text-2xl md:text-3xl font-medium text-label tracking-tight mb-2" style={{ fontFamily: "'Crimson Pro', 'Georgia', serif" }}>Render station</h2>
            <p className="text-sm text-label-secondary mb-10">The video engine is taking over from here — please bear with us.</p>

            {/* §2026-05-25 fei — inline error banners for Seedance + merge + upload */}
            <InlineErrorBanner
              error={renderError}
              title={renderError?.title}
              help={renderError?.help}
              onDismiss={() => setRenderError(null)}
              onRetry={renderError?.retry}
            />
            <InlineErrorBanner
              error={mergeError}
              title={mergeError?.title}
              help={mergeError?.help}
              onDismiss={() => setMergeError(null)}
              onRetry={mergeError?.retry}
            />
            <InlineErrorBanner
              error={uploadError}
              title={uploadError?.title}
              help={uploadError?.help}
              onDismiss={() => setUploadError(null)}
              onRetry={uploadError?.retry}
            />
            {/* §2026-05-26 fei — Library save failure banner in Render Station.
                This is where Quick Mode finishes; if the silent insert at the
                end of the background pipeline fails, this banner is the
                user's only signal (otherwise their finished video just
                doesn't show up in Library and they're left guessing). */}
            <InlineErrorBanner
              error={librarySaveError}
              title={librarySaveError?.title}
              help={librarySaveError?.help}
              onDismiss={() => setLibrarySaveError(null)}
              onRetry={librarySaveError?.retry}
            />

            <div className="space-y-8 max-w-md mx-auto">
              
              {/* Concept Generation Step */}
              <div className={`flex items-start gap-4 transition-opacity duration-500 ${renderProgress >= 1 ? 'opacity-100' : 'opacity-30'}`}>
                <div className="mt-0.5">
                  {renderProgress > 1 ? <CheckCircle size={24} className="text-green-500" weight="fill" /> : renderProgress === 1 ? <CircleNotch size={24} className="text-accent animate-spin" /> : <div className="w-6 h-6 border-2 border-background-tertiary rounded-full" />}
                </div>
                <div>
                  <h4 className={`text-base font-medium ${renderProgress >= 1 ? 'text-label' : 'text-label-tertiary'}`}>1. Generate concept art</h4>
                  <p className="text-xs text-label-secondary mt-1">Fusing your Actor with the {selectedStyle} style.</p>
                </div>
              </div>

              {/* Concept Review Step UI */}
              {renderProgress === 1.5 && (finalConceptUrl || isSequel) && (
                <div className="mt-8 pt-8 border-t border-background-secondary animate-fade-in text-center">
                   <div className="inline-flex w-12 h-12 bg-blue-500/10 text-blue-500 rounded-full items-center justify-center mb-4">
                     <CheckCircle size={24} weight="fill" />
                   </div>
                   <h3 className="text-lg font-bold text-label mb-2">
                     {isSequel ? 'Ready to generate sequel video' : 'Concept image ready'}
                   </h3>
                   <p className="text-sm text-label-secondary mb-6">
                     {isSequel ? 'Configure your video generation options, then start the automated render pipeline.' : 'Preview the first-frame reference. When you\'re happy, start the automated render pipeline.'}
                   </p>
                   
                   {finalConceptUrl && (
                     <div className="my-6 space-y-4">
                       {/* §2026-05-25 fei: storyboard + character identity
                           board shown side-by-side. Storyboard is the multi-
                           panel rough sketch (drives shot composition);
                           character board is the polished design sheet
                           (face / costume / proportion reference, rendered
                           in user's chosen style). The board is generated
                           in parallel — show a skeleton while it loads, or
                           skip the column entirely if generation failed. */}
                       <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                         <div className="text-left">
                           <p className="text-xs text-label-tertiary mb-2 font-medium uppercase tracking-wider">Storyboard</p>
                           <img src={finalConceptUrl} alt="Storyboard" className="w-full max-h-72 object-contain rounded-xl shadow-lg border border-background-tertiary bg-black/5" />
                         </div>
                         <div className="text-left">
                           <p className="text-xs text-label-tertiary mb-2 font-medium uppercase tracking-wider">Character Identity Board</p>
                           {characterBoardUrl ? (
                             <img src={characterBoardUrl} alt="Character Identity Board" className="w-full max-h-72 object-contain rounded-xl shadow-lg border border-background-tertiary bg-black/5" />
                           ) : characterBoardGenerating ? (
                             <div className="w-full h-72 rounded-xl border border-background-tertiary bg-background-secondary flex flex-col items-center justify-center gap-3">
                               <CircleNotch size={28} className="animate-spin text-accent" />
                               <p className="text-xs text-label-tertiary">生成中… (10-30s)</p>
                             </div>
                           ) : (
                             <div className="w-full h-72 rounded-xl border border-dashed border-background-tertiary bg-background-secondary flex items-center justify-center">
                               <p className="text-xs text-label-tertiary px-4 text-center">设定图未生成（不影响视频渲染）</p>
                             </div>
                           )}
                         </div>
                       </div>
                     </div>
                   )}
                   
                   {/* Video specs summary — read-only (§2026-05-22 fei round-2:
                       selectors moved to the entry confirm modal so user can't
                       change after price is locked. This is a display-only
                       summary of what they confirmed). */}
                   <div className="mb-6 bg-background-secondary/50 rounded-xl p-4 text-left border border-background-tertiary">
                     <h4 className="text-sm font-semibold text-label mb-3 flex items-center gap-2">
                       <Sparkle size={16} className="text-accent" /> Video specs (locked)
                     </h4>
                     <div className="grid grid-cols-2 gap-4 text-sm">
                       <div>
                         <div className="text-xs text-label-secondary mb-1">Resolution</div>
                         <div className="font-medium text-label">{videoResolution}</div>
                       </div>
                       <div>
                         <div className="text-xs text-label-secondary mb-1">Model engine</div>
                         <div className="font-medium text-label">
                           {videoModelOptions.find(m => m.id === videoModel)?.label || videoModel}
                         </div>
                       </div>
                     </div>
                     <p className="text-[11px] text-label-tertiary mt-3">
                       Specs were set when you confirmed the render. To change, cancel and start a new render.
                     </p>
                     {hasWatermark(userTier) && (
                       <p className="text-xs text-label-tertiary mt-3 flex items-center gap-1.5">
                         <Lock size={12} weight="fill" className="text-label-tertiary" />
                         Output includes Uvera watermark.{' '}
                         <button onClick={() => openSubscriptionModal()} className="text-accent hover:underline cursor-pointer">
                           Upgrade to remove
                         </button>
                       </p>
                     )}
                   </div>
                   
                   {/* §2026-05-23 fei: branch on segmentCount.
                       Single-segment: keep legacy "Confirm & generate" flow.
                       Multi-segment: render per-segment list with individual
                       render buttons. */}
                   {(() => {
                     const segments = generatedScript?.segments || [];
                     const isMultiSegment = segmentCount > 1 && segments.length > 1;
                     if (!isMultiSegment) {
                       return (
                         <>
                           <button onClick={handleGenerateVideo} className="px-6 py-3 mt-2 bg-accent text-white rounded-xl text-sm font-medium w-full flex items-center justify-center gap-2 hover:opacity-90 transition-opacity cursor-pointer">
                             {isSequel ? 'Confirm settings & generate video' : 'Confirm image & generate video'} <VideoCamera size={18} />
                           </button>
                           {!isSequel && (
                             <button onClick={handleRequestRegenerateStoryboard} className="px-8 py-3 bg-transparent text-label-secondary rounded-xl font-medium w-full flex items-center justify-center gap-2 hover:bg-background-secondary transition">
                               <ArrowsClockwise size={18} /> Not quite right — regenerate ({STORYBOARD_TOKEN_COST} Tokens)
                             </button>
                           )}
                         </>
                       );
                     }

                     // Multi-segment per-segment render list
                     const allReady = segments.every((_, i) => renderedSegments[i]?.status === 'ready');
                     const anyRendering = segments.some((_, i) => renderedSegments[i]?.status === 'rendering');
                     return (
                       <div className="space-y-3 text-left">
                         <div className="text-xs text-label-tertiary text-center mb-3">
                           渲染时一段一段来，每段单独扣费。可以中途停。
                         </div>
                         {segments.map((seg, segIdx) => {
                           const rendered = renderedSegments[segIdx];
                           const status = rendered?.status || 'pending';
                           const cost = costForSegment(seg);
                           const isPrevReady = segIdx === 0 || (renderedSegments[segIdx - 1]?.status === 'ready');
                           const canRender = isPrevReady && status === 'pending' && !anyRendering;

                           return (
                             <div
                               key={segIdx}
                               className={`rounded-xl border p-4 transition-colors ${
                                 status === 'ready' ? 'border-emerald-500/40 bg-emerald-500/5' :
                                 status === 'rendering' ? 'border-accent/50 bg-accent/5' :
                                 status === 'failed' ? 'border-red-500/40 bg-red-500/5' :
                                 isPrevReady ? 'border-background-tertiary bg-background-secondary/30' :
                                 'border-background-tertiary/50 bg-background-secondary/10 opacity-60'
                               }`}
                             >
                               <div className="flex items-start gap-3 mb-2">
                                 <div className={`w-8 h-8 rounded-full flex items-center justify-center font-bold text-xs flex-shrink-0 ${
                                   status === 'ready' ? 'bg-emerald-500 text-white' :
                                   status === 'rendering' ? 'bg-accent text-white' :
                                   status === 'failed' ? 'bg-red-500 text-white' :
                                   'bg-background-tertiary text-label-secondary'
                                 }`}>
                                   {status === 'ready' ? <CheckCircle size={14} weight="fill" />
                                    : status === 'rendering' ? <CircleNotch size={14} className="animate-spin" />
                                    : (segIdx + 1)}
                                 </div>
                                 <div className="min-w-0 flex-1">
                                   <p className="text-sm font-medium text-label">
                                     Segment {segIdx + 1} / {segments.length}
                                     <span className="ml-2 text-xs font-normal text-label-tertiary">
                                       ~{seg.targetDurationSec || 12}s · {cost} tokens
                                     </span>
                                   </p>
                                   {seg.summary && (
                                     <p className="text-xs text-label-secondary mt-1 leading-snug">{seg.summary}</p>
                                   )}
                                 </div>
                               </div>

                               {/* Per-segment video player when ready
                                   §2026-05-30 round-106 path A — 原生 <video> → UnifiedVideoPlayer
                                   (HLS/CF Stream 兼容 + PlayerActionBar,desktop;mobile 降级 native)。 */}
                               {status === 'ready' && rendered.videoUrl && (
                                 <UnifiedVideoPlayer
                                   src={rendered.videoUrl}
                                   customControls
                                   className="w-full rounded-lg bg-black mt-3"
                                   playsInline
                                 />
                               )}

                               {/* Per-segment failure */}
                               {status === 'failed' && (
                                 <div className="text-xs text-red-300 mt-2 mb-2">
                                   ✘ {rendered?.error || 'unknown error'}
                                 </div>
                               )}

                               {/* Per-segment render button */}
                               {(status === 'pending' || status === 'failed') && (
                                 <button
                                   onClick={() => renderSegmentVideo(segIdx)}
                                   disabled={!canRender && status !== 'failed'}
                                   className={`mt-3 w-full px-4 py-2.5 rounded-lg text-sm font-medium flex items-center justify-center gap-2 transition-opacity ${
                                     canRender || status === 'failed'
                                       ? 'bg-accent text-white hover:opacity-90 cursor-pointer'
                                       : 'bg-background-tertiary text-label-tertiary cursor-not-allowed'
                                   }`}
                                 >
                                   {!isPrevReady ? (
                                     <><Lock size={14} /> 等待前一段渲染完成</>
                                   ) : anyRendering ? (
                                     <><CircleNotch size={14} className="animate-spin" /> Other segment rendering...</>
                                   ) : status === 'failed' ? (
                                     <><ArrowsClockwise size={14} /> 重试 Segment {segIdx + 1} ({cost} tokens)</>
                                   ) : (
                                     <><VideoCamera size={14} /> 渲染 Segment {segIdx + 1} ({cost} tokens)</>
                                   )}
                                 </button>
                               )}

                               {status === 'rendering' && (
                                 <div className="text-xs text-accent flex items-center gap-2 mt-2">
                                   <CircleNotch size={12} className="animate-spin" /> Rendering... (~30s-3min)
                                 </div>
                               )}
                             </div>
                           );
                         })}

                         {/* When all segments ready, show combine CTA */}
                         {allReady && (
                           <div className="mt-6 p-4 rounded-xl bg-emerald-500/5 border border-emerald-500/30 text-center">
                             <div className="text-emerald-400 text-2xl mb-2">🎬</div>
                             <p className="text-sm font-medium text-label mb-1">All {segments.length} segments rendered</p>
                             <p className="text-xs text-label-secondary mb-4">
                               Combine them into one continuous {generatedScript.totalDuration}s video,
                               or publish each segment separately.
                             </p>
                             {combinedVideoUrl ? (
                               <UnifiedVideoPlayer
                                 src={combinedVideoUrl}
                                 customControls
                                 className="w-full rounded-lg bg-black"
                                 playsInline
                               />
                             ) : (
                               <button
                                 disabled={isCombining}
                                 onClick={handleCombineSegments}
                                 className="px-5 py-2.5 bg-emerald-500 hover:bg-emerald-600 disabled:opacity-50 text-white rounded-full text-sm font-medium inline-flex items-center gap-2 cursor-pointer"
                               >
                                 {isCombining
                                   ? <><CircleNotch size={14} className="animate-spin" /> Combining…(ffmpeg.wasm)</>
                                   : <><VideoCamera size={14} /> Combine into one {generatedScript.totalDuration}s video</>}
                               </button>
                             )}
                           </div>
                         )}

                         {/* Regenerate storyboard (multi-segment) */}
                         {!anyRendering && !allReady && (
                           <button onClick={handleRequestRegenerateStoryboard} className="px-6 py-2.5 mt-4 bg-transparent text-label-secondary rounded-lg text-xs w-full flex items-center justify-center gap-2 hover:bg-background-secondary transition">
                             <ArrowsClockwise size={14} /> Storyboard 不满意 — 重新生成 ({STORYBOARD_TOKEN_COST} Tokens)
                           </button>
                         )}
                       </div>
                     );
                   })()}
                </div>
              )}

              {/* Review Step */}
              <div className={`flex items-start gap-4 transition-opacity duration-500 ${renderProgress >= 2 ? 'opacity-100' : 'opacity-30'}`}>
                <div className="mt-0.5">
                  {renderProgress > 2 ? <CheckCircle size={24} className="text-green-500" weight="fill" /> : renderProgress === 2 ? <CircleNotch size={24} className="text-accent animate-spin" /> : <div className="w-6 h-6 border-2 border-background-tertiary rounded-full" />}
                </div>
                <div>
                  <h4 className={`text-base font-medium ${renderProgress >= 2 ? 'text-label' : 'text-label-tertiary'}`}>2. Live-person safety review</h4>
                  <p className="text-xs text-label-secondary mt-1">Submitting the concept image to the Ark platform for compliance verification.</p>
                </div>
              </div>

              {/* Video Step */}
              <div className={`flex items-start gap-4 transition-opacity duration-500 ${renderProgress >= 3 ? 'opacity-100' : 'opacity-30'}`}>
                <div className="mt-0.5">
                  {renderProgress > 3 ? <CheckCircle size={24} className="text-green-500" weight="fill" /> : renderProgress === 3 ? <CircleNotch size={24} className="text-accent animate-spin" /> : <div className="w-6 h-6 border-2 border-background-tertiary rounded-full" />}
                </div>
                <div className="flex-1">
                  <h4 className={`text-base font-medium ${renderProgress >= 3 ? 'text-label' : 'text-label-tertiary'}`}>3. Render the final video</h4>
                  <p className="text-xs text-label-secondary mt-1">Composing the storyboard into a finished cut. Typically takes 30 seconds to 3 minutes.</p>
                  {renderProgress === 3 && (
                    <div className="mt-2 flex items-center gap-3">
                      <span className="text-xs font-mono text-accent tabular-nums">
                        {Math.floor(renderElapsedSec / 60)}:{String(renderElapsedSec % 60).padStart(2, '0')} elapsed
                      </span>
                      <div className="flex-1 max-w-[180px] h-1 bg-background-tertiary rounded-full overflow-hidden">
                        {/* Visual feedback so the static spinner doesn't read as frozen.
                            Linear progress assuming a 3-minute upper bound — not scientifically
                            accurate but better than nothing for keeping users patient. */}
                        <div
                          className="h-full bg-accent transition-all duration-1000"
                          style={{ width: `${Math.min(95, (renderElapsedSec / 180) * 100)}%` }}
                        />
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* §2026-05-22 fei: "Deploy to global CDN" 不再是 blocking step。
                  Seedance 完成时 renderProgress 直接跳 4, CDN 上传后台异步跑。
                  这一行只在 renderProgress>=4 时显示, 视觉上就是个"已经在
                  后台进行"的状态标记, 不再 spinner block 用户。 */}
              <div className={`flex items-start gap-4 transition-opacity duration-500 ${renderProgress >= 4 ? 'opacity-100' : 'opacity-30'}`}>
                <div className="mt-0.5">
                  {renderProgress >= 4
                    ? <CircleNotch size={24} className="text-label-tertiary animate-spin" />
                    : <div className="w-6 h-6 border-2 border-background-tertiary rounded-full" />}
                </div>
                <div>
                  <h4 className={`text-base font-medium ${renderProgress >= 4 ? 'text-label-secondary' : 'text-label-tertiary'}`}>
                    4. Backing up to global CDN <span className="text-[11px] text-label-tertiary font-normal">(background)</span>
                  </h4>
                  <p className="text-xs text-label-tertiary mt-1">Syncing to Cloudflare Stream's edge network for permanent storage. You can preview / publish / share now — no need to wait.</p>
                </div>
              </div>

              {renderProgress === 4 && (
                <div className="mt-10 pt-8 border-t border-background-secondary animate-fade-in text-center">
                   <div className="inline-flex w-16 h-16 bg-green-500/10 text-green-500 rounded-full items-center justify-center mb-4">
                     <CheckCircle size={32} weight="fill" />
                   </div>
                   <h3 className="text-lg font-bold text-label mb-2">Generation complete</h3>
                  <p className="text-sm text-label-secondary mb-6">Your video is ready. We're syncing it to the global edge CDN for permanent hosting.</p>
                   
                   {previewVideoUrl && (
                     <div className="my-6">
                       <div className="relative aspect-video bg-black rounded-xl overflow-hidden shadow-lg border border-background-tertiary">
                         {/* §2026-05-22 fei iOS Safari 视频卡黑屏 + 闪黑修复 round-2:
                             · playsInline — iOS 必须 (没有的话试图全屏 → inline 黑屏)
                             · muted — iOS 不允许有声 autoplay (没 muted 直接 silently 失败)
                             · preload="auto" — 提前 buffer 一段防止 stall
                             · poster={finalConceptUrl} — rebuffer / load 间隙显示
                               storyboard 图而不是纯黑, 比"闪黑"看感觉好很多
                             · onEnded 时机做安全 URL upgrade — 如果后台上传完成
                               (finalVideoUrl 已 = permanentVideoUrl), 在 onEnded
                               (非播放中) 时把 src 切到 CDN URL, 用户下次 replay
                               就是 fast CDN. 避开 iOS 对 mid-playback src swap
                               的崩溃模式.
                           Volcengine TOS URL 从中国服务器出来对移动网络/海外用户
                           偏慢, 第一遍播放可能仍有 buffer 卡顿; 这是 CDN 路径
                           本身的速度问题, 不是代码 bug. 替换到 R2/Stream URL
                           才是根本解 (走 onEnded swap 实现). */}
                         <video
                           ref={previewVideoRef}
                           src={previewVideoUrl}
                           poster={finalConceptUrl || undefined}
                           controls
                           autoPlay
                           muted
                           playsInline
                           preload="auto"
                           style={{ width: '100%', height: '100%', objectFit: 'contain' }}
                           className="w-full h-full block"
                           onError={() => {
                             // §2026-05-31 BUG-003 — 源加载失败(空/无效/不支持)时
                             //   静默兜底,不让它冒成未捕获错误。退出 ended 态,
                             //   用户可手动 replay 重试。
                             console.warn('[player] preview video load error:', previewVideoUrl);
                             setIsVideoEnded(false);
                           }}
                           onEnded={() => {
                             setIsVideoEnded(true);
                             // §2026-05-22 fei: safe URL swap window.
                             //   Background upload may have completed while user
                             //   was watching. At onEnded (no active playback),
                             //   it's safe to upgrade src to permanent URL —
                             //   user's next replay will use the fast CDN URL
                             //   instead of the slower TOS URL.
                             if (finalVideoUrl && finalVideoUrl !== previewVideoUrl) {
                               console.log('[player] safe URL upgrade onEnded: TOS → permanent CDN');
                               setPreviewVideoUrl(finalVideoUrl);
                             }
                           }}
                           onPlay={() => setIsVideoEnded(false)}
                         />
                         {isVideoEnded && (
                           <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 z-20 pointer-events-auto">
                             <div className="absolute inset-0 bg-black/40 backdrop-blur-sm pointer-events-none" />
                             <button
                               onClick={() => {
                                 setIsVideoEnded(false);
                                 // §2026-05-31 BUG-003 — 用专属 ref(不抓页面第一个
                                 //   video),且仅在有有效源时 replay;play() 是 promise,
                                 //   被拒(如 NotSupportedError)要 catch 掉,否则成
                                 //   未捕获 rejection 上报 Sentry。
                                 const v = previewVideoRef.current;
                                 if (v && v.currentSrc) {
                                   v.currentTime = 0;
                                   v.play().catch((err) => {
                                     console.warn('[player] replay failed:', err?.message || err);
                                   });
                                 }
                               }}
                               aria-label="Replay"
                               className="w-16 h-16 rounded-full bg-black/60 backdrop-blur-md flex items-center justify-center cursor-pointer hover:bg-black/80 transition-colors relative z-10"
                             >
                               <ArrowLeft size={28} weight="bold" className="text-white transform rotate-[180deg]" /> 
                             </button>
                             <button
                               onClick={() => {
                                 const title = currentScript?.title || 'Untitled story';
                                 localStorage.setItem('uvera_story_draft', JSON.stringify({
                                    transcript: `[Sequel] Previously on "${title}". Continue the story into the next episode.`,
                                    referenceVideoUrl: previewVideoUrl,
                                    sequelTitle: title,
                                    isSequel: true,
                                    step: 0
                                  }));
                                  window.location.reload();
                               }}
                               className="px-6 h-10 rounded-full text-white text-[15px] font-semibold cursor-pointer shadow-lg relative z-10"
                               style={{
                                 background: 'rgba(255,255,255,0.2)',
                                 backdropFilter: 'blur(12px)',
                                 border: '1px solid rgba(255,255,255,0.3)',
                               }}
                             >
                               Continue this story
                             </button>
                           </div>
                         )}
                         {tier === 'free' && (
                           <div className="absolute bottom-16 right-4 text-white/80 text-xs font-bold pointer-events-none drop-shadow-md z-10 bg-black/40 px-2 py-1 rounded">
                             create by uvera.ai
                           </div>
                         )}
                       </div>
                       <p className="mt-3 text-[11px] text-label-quaternary flex items-center justify-center gap-1">
                         <CheckCircle size={12} weight="fill" className="text-green-500/70" />
                         MP4 plays instantly; Cloudflare Stream adaptive transcode finishes in the background.
                       </p>
                     </div>
                   )}

                   {/* Post-publish success card — shown after Publish to World Feed succeeds.
                     * Replaces the previous blocking alert() with two clear next-step CTAs. */}
                   {publishComplete && (
                     <div className="mt-6 mb-6 max-w-lg mx-auto text-left bg-emerald-50 dark:bg-emerald-950/20 border border-emerald-200 dark:border-emerald-900 rounded-2xl p-6 animate-fade-in">
                       <div className="flex items-start gap-3 mb-4">
                         <div className="w-10 h-10 rounded-full bg-emerald-500/15 flex items-center justify-center flex-shrink-0">
                           <Confetti size={20} weight="fill" className="text-emerald-600 dark:text-emerald-400" />
                         </div>
                         <div>
                           <h4 className="text-base font-medium text-label mb-1">Published to the World Feed</h4>
                           <p className="text-sm text-label-secondary leading-relaxed">
                             Your work is now discoverable by other UVERA users. You can keep creating, or head home to see how it looks in the feed.
                           </p>
                         </div>
                       </div>
                       <div className="flex flex-wrap gap-2">
                         <button
                           onClick={() => navigate('/')}
                           className="px-5 py-2.5 bg-accent text-white rounded-xl text-sm font-medium hover:opacity-90 transition-opacity cursor-pointer flex items-center gap-1.5"
                         >
                           <House size={16} weight="fill" /> Go home
                         </button>
                         <button
                           onClick={resetWorkflowState}
                           className="px-5 py-2.5 bg-background border border-background-tertiary text-label rounded-xl text-sm font-medium hover:bg-background-secondary transition-colors cursor-pointer flex items-center gap-1.5"
                         >
                           <Plus size={16} /> Continue creating
                         </button>
                       </div>
                     </div>
                   )}

                   {/* Publishing Settings — authorization opt-ins persisted to
                     * recommended_content.allow_branch / .allow_recast. Backend RLS
                     * + Branch/Recast creation校验 仍待费完成（docs/legal/COMPLIANCE.md §2/§3）.
                     * Hidden once publishComplete=true (success card shown above instead). */}
                   {insertedWorkId && !publishComplete && (
                     <div className="mt-6 mb-6 max-w-lg mx-auto text-left glass-regular rounded-2xl p-5">
                       <h4 className="text-[11px] font-semibold text-label-secondary uppercase tracking-wider mb-4">
                         Publishing Settings
                       </h4>

                       {/* §2026-06-05 #2 — 创作者自助设封面(从视频选帧)。拖滑块 seek
                         * picker video 显示该帧;发布时把 coverPct 设为 Stream 视频的
                         * thumbnailTimestampPct。默认 10%(= 自动非黑首帧)。 */}
                       {previewVideoUrl && (
                         <div className="mb-5 pb-5 border-b border-white/10">
                           <span className="flex items-center gap-1.5 text-[15px] font-medium text-label">
                             <ImageIcon size={16} weight="bold" />
                             Cover frame
                           </span>
                           <span className="block text-[12px] text-label-tertiary leading-snug mt-1 mb-3">
                             Drag to pick the frame shown as your cover. Defaults to 10% in, which skips a black intro.
                           </span>
                           <div className="relative aspect-video bg-black rounded-lg overflow-hidden border border-white/10">
                             <video
                               ref={coverVideoRef}
                               src={previewVideoUrl}
                               muted
                               playsInline
                               preload="auto"
                               className="w-full h-full object-contain"
                               onLoadedData={(e) => {
                                 // §2026-06-05 #2 修黑屏 — 用 loadeddata(首帧已解码)而非
                                 //   loadedmetadata:metadata-only 不解码帧 → seek 不绘制 → 黑。
                                 //   preload=auto + 此处 seek 才能可靠出帧(对齐 captureVideoFrame)。
                                 const d = e.currentTarget.duration || 0;
                                 if (isFinite(d) && d > 0) {
                                   setCoverDuration(d);
                                   e.currentTarget.currentTime = Math.min(d * coverPct, Math.max(d - 0.05, 0));
                                 }
                               }}
                               onError={() => setCoverDuration(0)}
                             />
                           </div>
                           <input
                             type="range"
                             min={0}
                             max={coverDuration || 0}
                             step={0.1}
                             value={Math.min(coverPct * (coverDuration || 0), coverDuration || 0)}
                             disabled={!coverDuration}
                             onChange={(e) => {
                               const sec = Number(e.target.value);
                               if (coverVideoRef.current) coverVideoRef.current.currentTime = sec;
                               setCoverPct(coverDuration ? Math.min(Math.max(sec / coverDuration, 0.001), 0.999) : 0.1);
                               setCoverTouched(true);
                             }}
                             className="w-full mt-3 cursor-pointer disabled:cursor-not-allowed"
                             style={{ accentColor: 'var(--color-accent)' }}
                           />
                           <div className="flex justify-between text-[11px] text-label-tertiary mt-1">
                             <span>Drag to choose the cover frame</span>
                             <span>{coverDuration ? `${(coverPct * coverDuration).toFixed(1)}s / ${coverDuration.toFixed(1)}s` : '…'}</span>
                           </div>
                         </div>
                       )}

                       <label className="flex items-start gap-3 cursor-pointer group">
                         <input
                           type="checkbox"
                           checked={allowBranch}
                           onChange={(e) => setAllowBranch(e.target.checked)}
                           className="mt-1 w-4 h-4 cursor-pointer"
                           style={{ accentColor: 'var(--color-accent)' }}
                         />
                         <span className="flex-1">
                           <span className="flex items-center gap-1.5 text-[15px] font-medium text-label">
                             <TreeStructure size={16} weight="bold" />
                             Allow Branch
                           </span>
                           <span className="block text-[12px] text-label-tertiary leading-snug mt-1">
                             Let others continue your story in new directions while keeping the style, setting, and characters.
                           </span>
                         </span>
                       </label>

                       {/* §2026-05-29 Leon round-105 — "Allow Recast" checkbox 完全删除 (Recast 产品取消) */}

                       {/* §2026-05-31 Leon round-103 Phase B — Allow Download.
                         * Creator opt-in for whether NON-OWNER viewers see the
                         * download icon in the player. Owners always download
                         * regardless. Default OFF so this never enables silently. */}
                       <label className="flex items-start gap-3 cursor-pointer group mt-3">
                         <input
                           type="checkbox"
                           checked={allowDownload}
                           onChange={(e) => setAllowDownload(e.target.checked)}
                           className="mt-1 w-4 h-4 cursor-pointer"
                           style={{ accentColor: 'var(--color-accent)' }}
                         />
                         <span className="flex-1">
                           <span className="flex items-center gap-1.5 text-[15px] font-medium text-label">
                             <DownloadSimple size={16} weight="bold" />
                             Allow viewers to download
                           </span>
                           <span className="block text-[12px] text-label-tertiary leading-snug mt-1">
                             Show a Download button in the player for everyone who watches. You can change this later in Library.
                           </span>
                         </span>
                       </label>

                       <p className="mt-4 text-[11px] text-label-quaternary">
                         By publishing, you agree to the{' '}
                         <a
                           href="#"
                           onClick={(e) => e.preventDefault()}
                           className="inline-flex items-center gap-0.5 text-accent hover:opacity-80"
                         >
                           Content License Terms
                           <ArrowSquareOut size={10} weight="bold" />
                         </a>
                         .
                       </p>
                     </div>
                   )}

                   {/* Bottom action row — hidden after publish since the success card
                       above already provides Go home / Continue creating CTAs. */}
                   {!publishComplete && (
                     <div className="flex flex-wrap justify-center gap-4">
                       <button onClick={() => { localStorage.removeItem('uvera_story_draft'); deleteDraft(generationMode || 'quick').catch(() => {}); window.location.reload(); }} className="px-6 py-2.5 bg-background-secondary hover:bg-background-tertiary text-label rounded-xl font-medium transition">
                         Start a new creation
                       </button>
                       {insertedWorkId && (
                         <button onClick={handlePublishToFeed} disabled={isPublishing} className="px-6 py-2.5 flex items-center justify-center gap-2 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white rounded-xl font-medium transition disabled:opacity-50">
                           {isPublishing ? 'Publishing…' : 'Publish to World Feed'} <ArrowRight size={18} />
                         </button>
                       )}
                     </div>
                   )}
                </div>
              )}

            </div>
          </div>
        )}

      </div>
      )}
      </>
      )}
      </div>{/* content area close */}
      <button id="auto-generate-video-btn" onClick={handleGenerateVideo} className="hidden" />

      {/* ─── Insufficient-tokens modal (replaces native alert) ───────────────
            Web-style centered card,brand 一致 (rounded-2xl + design tokens)。
            Top up CTA 跳 /subscription。Click backdrop / Cancel 关闭。 */}
      {tokenAlert && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 animate-fade-in">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setTokenAlert(null)} />
          <div className="relative max-w-sm w-full rounded-2xl bg-background-secondary border border-background-tertiary p-6 shadow-2xl">
            <div className="flex items-start gap-3 mb-5">
              <div className="w-10 h-10 rounded-full bg-amber-100 dark:bg-amber-900/30 flex items-center justify-center flex-shrink-0">
                <Coin size={20} weight="fill" className="text-amber-600 dark:text-amber-400" />
              </div>
              <div className="flex-1 min-w-0">
                <h3 className="text-base font-semibold text-label">Not enough tokens</h3>
                <p className="text-sm text-label-secondary mt-1">
                  {tokenAlert.context} requires {tokenAlert.required} tokens — your balance is short.
                </p>
              </div>
            </div>
            <div className="bg-background border border-background-tertiary rounded-xl p-3 mb-5 space-y-1.5 text-sm">
              <div className="flex items-center justify-between">
                <span className="text-label-secondary">Required</span>
                <span className="font-semibold text-label tabular-nums">{tokenAlert.required}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-label-secondary">Your balance</span>
                <span className="font-semibold text-label tabular-nums">{tokenAlert.current}</span>
              </div>
              <div className="flex items-center justify-between pt-1.5 border-t border-background-tertiary">
                <span className="text-label-secondary">Short by</span>
                <span className="font-semibold text-amber-600 dark:text-amber-400 tabular-nums">{Math.max(0, tokenAlert.required - tokenAlert.current)}</span>
              </div>
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => setTokenAlert(null)}
                className="flex-1 px-4 py-2.5 rounded-full border border-background-tertiary text-sm font-medium text-label-secondary hover:bg-background-tertiary transition-colors cursor-pointer"
              >
                Cancel
              </button>
              <button
                onClick={() => { setTokenAlert(null); openSubscriptionModal(); }}
                className="flex-1 px-4 py-2.5 rounded-full bg-accent hover:bg-accent/90 text-white text-sm font-medium transition-colors cursor-pointer flex items-center justify-center gap-1.5"
              >
                Top up
                <ArrowRight size={14} />
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ─── Render cost-confirm modal (§2026-05-22 fei round-2) ──────────
            Now embeds resolution + model selectors so user can finalize
            video specs BEFORE confirming. Cost is reactive to current
            videoResolution. After confirm, render station's selectors
            are read-only (price is locked).
            Two kinds:
              · kind='entry'      → initial render (storyboard + video + selectors)
              · kind='regenerate' → "Not quite right" storyboard re-gen only */}
      {pendingRenderConfirm && (() => {
        // Reactive cost: re-computed every render of this modal because
        //   the user can change videoResolution via the embedded selector
        //   and the prices below should update immediately.
        const isEntry = pendingRenderConfirm.kind === 'entry';
        const storyboardCost = STORYBOARD_TOKEN_COST;
        const videoCost = isEntry ? quickModeVideoCost : 0;
        const totalCost = storyboardCost + videoCost;
        const durationSec = (generatedScript?.totalDuration) || 5;
        const insufficient = credits < totalCost;
        return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 animate-fade-in">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setPendingRenderConfirm(null)} />
          <div className="relative max-w-md w-full rounded-2xl bg-background-secondary border border-background-tertiary p-6 shadow-2xl">
            <div className="flex items-start gap-3 mb-5">
              <div className="w-10 h-10 rounded-full bg-accent/15 flex items-center justify-center flex-shrink-0">
                {isEntry
                  ? <VideoCamera size={20} weight="fill" className="text-accent" />
                  : <ArrowsClockwise size={20} weight="fill" className="text-accent" />}
              </div>
              <div className="flex-1 min-w-0">
                <h3 className="text-base font-semibold text-label">
                  {isEntry ? 'Confirm render' : 'Regenerate storyboard?'}
                </h3>
                <p className="text-sm text-label-secondary mt-1">
                  {isEntry
                    ? 'Adjust video specs below — cost updates live. Tokens are deducted on confirm; refunded if pipeline fails before video starts.'
                    : 'A new storyboard image costs tokens each attempt. Tokens are deducted now; if generation fails, they are refunded.'}
                </p>
              </div>
            </div>

            {/* Spec selectors — only on entry kind. §2026-05-22 fei round-2:
                moved here from render station so user picks specs BEFORE
                price lock, not after. */}
            {isEntry && (
              <div className="bg-background border border-background-tertiary rounded-xl p-3 mb-3 space-y-3">
                <div className="text-xs text-label-tertiary uppercase tracking-wider">Video specs</div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs text-label-secondary mb-1">Resolution</label>
                    <select
                      value={videoResolution}
                      onChange={e => setVideoResolution(e.target.value)}
                      className="w-full bg-background-secondary border border-background-tertiary rounded-lg px-3 py-2 text-sm text-label focus:border-accent/50 outline-none transition"
                    >
                      {(() => {
                        const allowed = getResolutionOptions(userTier);
                        const ALL = ['480p', '720p', '1080p'];
                        return ALL.map(r => {
                          const tierLocked  = !allowed.includes(r);
                          // §2026-06-05 模型不支持(Fast 无 1080p)也锁。
                          const modelLocked = !resAllowedByModel(r, videoModel);
                          const unlockBy = tierLocked ? tierUnlocking(r) : null;
                          return (
                            <option key={r} value={r} disabled={tierLocked || modelLocked}>
                              {r}{tierLocked && unlockBy ? ` (${TIER_DISPLAY[unlockBy]?.label}+)` : (modelLocked ? ' (Standard)' : '')}
                            </option>
                          );
                        });
                      })()}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs text-label-secondary mb-1">Model engine</label>
                    <select
                      value={videoModel}
                      onChange={e => setVideoModel(e.target.value)}
                      className="w-full bg-background-secondary border border-background-tertiary rounded-lg px-3 py-2 text-sm text-label focus:border-accent/50 outline-none transition"
                    >
                      {videoModelOptions.map(m => (
                        <option key={m.id} value={m.id}>{m.label}</option>
                      ))}
                    </select>
                  </div>
                </div>
              </div>
            )}

            <div className="bg-background border border-background-tertiary rounded-xl p-3 mb-5 space-y-1.5 text-sm">
              {isEntry ? (
                <>
                  <div className="flex items-center justify-between">
                    <span className="text-label-secondary">Storyboard image</span>
                    <span className="font-semibold text-label tabular-nums">{storyboardCost} Tokens</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-label-secondary">Video ({durationSec}s @ {videoResolution})</span>
                    <span className="font-semibold text-label tabular-nums">{videoCost} Tokens</span>
                  </div>
                  {/* §2026-05-25 fei — show effective rate including model
                      multiplier so user sees WHY Standard costs more than
                      Fast at the same resolution. */}
                  <div className="text-xs text-label-tertiary pl-2">
                    {(() => {
                      const base = RESOLUTION_CREDITS_PER_SEC[videoResolution] || 6;
                      const m = getModelMultiplier(videoModel);
                      const eff = Math.ceil(base * m);
                      const modelLabel = videoModelOptions.find(o => o.id === videoModel)?.label || 'Model';
                      return m === 1
                        ? `rate: ${base} tokens/sec × ${durationSec}s = ${videoCost}`
                        : `rate: ${base} × ${m}× (${modelLabel}) ≈ ${eff} tokens/sec`;
                    })()}
                  </div>
                </>
              ) : (
                <div className="flex items-center justify-between">
                  <span className="text-label-secondary">New storyboard image</span>
                  <span className="font-semibold text-label tabular-nums">{storyboardCost} Tokens</span>
                </div>
              )}
              <div className="flex items-center justify-between pt-1.5 border-t border-background-tertiary">
                <span className="text-label-secondary">Total cost</span>
                <span className="font-semibold text-accent tabular-nums">{totalCost} Tokens</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-label-secondary">Balance after</span>
                <span className={`font-semibold tabular-nums ${insufficient ? 'text-red-500' : 'text-label'}`}>
                  {credits - totalCost}{insufficient && ' (insufficient!)'}
                </span>
              </div>
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => setPendingRenderConfirm(null)}
                className="flex-1 px-4 py-2.5 rounded-full border border-background-tertiary text-sm font-medium text-label-secondary hover:bg-background-tertiary transition-colors cursor-pointer"
              >
                Cancel
              </button>
              <button
                onClick={runConfirmedRenderEntry}
                disabled={insufficient}
                className="flex-1 px-4 py-2.5 rounded-full bg-accent hover:bg-accent/90 disabled:bg-background-tertiary disabled:text-label-tertiary disabled:cursor-not-allowed text-white text-sm font-medium transition-colors cursor-pointer flex items-center justify-center gap-1.5"
              >
                {isEntry ? 'Confirm & render' : 'Confirm & regenerate'}
                <ArrowRight size={14} />
              </button>
            </div>
          </div>
        </div>
        );
      })()}
    </div>
  );
}
