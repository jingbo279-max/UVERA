import { supabase } from './supabaseClient';
import { STYLES } from '../data/styles';

/* 2026-05-13 Leon — 共享 helper: 给 fetch 加 Bearer token (匿名用户也兼容)
   修复 generation_logs 96 条 NULL user_id 孤儿 bug
   (worker logApiStart 从 Authorization header 提取 user_id) */
const authedHeaders = async (extra = {}) => {
  const headers = { ...extra };
  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (session?.access_token) headers.Authorization = `Bearer ${session.access_token}`;
  } catch {/* anonymous OK */}
  return headers;
};

// Upload Worker URL (Cloudflare Worker with R2 binding — no CORS issues)
const UPLOAD_WORKER_URL = window.location.hostname === 'localhost' ? "http://localhost:8787/upload" : "/api/upload";
const CUSTOM_DOMAIN = "https://asset.uvera.ai";

/**
 * Sanitize any URL from Neodomain that uses wlpaas.weilitech.cn
 * to use asset.uvera.ai instead. This is the SINGLE source of truth
 * for domain rewriting.
 */
const sanitizeNeoUrl = (rawUrl) => {
  if (!rawUrl || typeof rawUrl !== 'string') return rawUrl;
  try {
    const u = new URL(rawUrl);
    if (u.hostname === 'wlpaas.weilitech.cn') {
      u.hostname = 'asset.uvera.ai';
      u.protocol = 'https:';
    }
    return u.toString();
  } catch(e) {
    return rawUrl.replace(/wlpaas\.weilitech\.cn/g, 'asset.uvera.ai');
  }
};

/**
 * Upload an image (by URL) to Neodomain's AliyunOSS (wlpaas bucket)
 * using a temporary STS token obtained from story.neodomain.cn.
 * Returns the public wlpaas.weilitech.cn URL, which Neodomain CAN access.
 *
 * Flow: get STS token → PUT file to OSS via worker proxy → return wlpaas URL
 */
const uploadImageToNeodomainOSS = async (imageUrl, accessToken) => {
  if (!imageUrl) return null;
  try {
    const res = await fetch('/api/migrate-image', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ imageUrl, accessToken })
    });
    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Migration API failed: ${res.status} ${errText}`);
    }
    const data = await res.json();
    if (!data.success) {
      throw new Error(data.errMessage || 'Unknown error');
    }
    console.log('[uploadImageToNeodomainOSS] ✅ Uploaded to OSS:', data.publicUrl);
    return data.publicUrl;
  } catch (err) {
    console.warn('[uploadImageToNeodomainOSS] Failed, will skip reference image:', err.message);
    return null;
  }
};

/**
 * Downloads an image from any URL (e.g. Neodomain's wlpaas server)
 * and re-uploads it to our R2 bucket, returning the asset.uvera.ai URL.
 * This ensures ALL generated images are permanently stored on our CDN.
 */
const mirrorImageToR2 = async (sourceUrl, accessToken = null) => {
  if (!sourceUrl) return sourceUrl;
  
  try {
    // Route through Worker server-side endpoint to bypass browser CORS limitations.
    // This handles Neodomain's dify/dev/... paths that require server-side access.
    const res = await fetch('/api/mirror-to-r2', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sourceUrl, accessToken })
    });
    
    if (!res.ok) {
      console.warn('[mirrorImageToR2] Worker mirror failed, falling back to sanitized URL');
      return sanitizeNeoUrl(sourceUrl);
    }
    
    const data = await res.json();
    if (!data.success) {
      console.warn('[mirrorImageToR2] Mirror API error:', data.errMessage, '— falling back');
      return sanitizeNeoUrl(sourceUrl);
    }
    
    console.log(`[mirrorImageToR2] ✅ Mirrored to R2: ${data.publicUrl}`);
    return data.publicUrl;
  } catch (err) {
    console.warn('[mirrorImageToR2] Error, falling back:', err.message);
    return sanitizeNeoUrl(sourceUrl); // graceful fallback
  }
};


/**
 * Read a video file's duration in seconds without uploading it.
 * Returns NaN if the browser can't decode the file (e.g. unsupported codec).
 * Times out at 5s in case the metadata never resolves.
 */
const probeVideoDuration = (file) => new Promise((resolve) => {
  const url = URL.createObjectURL(file);
  const v = document.createElement('video');
  v.preload = 'metadata';
  let done = false;
  const finish = (val) => {
    if (done) return;
    done = true;
    URL.revokeObjectURL(url);
    resolve(val);
  };
  v.onloadedmetadata = () => finish(v.duration);
  v.onerror = () => finish(NaN);
  setTimeout(() => finish(NaN), 5000);
  v.src = url;
});

/**
 * Uploads a file via the Cloudflare Worker proxy to R2.
 * Worker has a native R2 binding — no CORS restrictions.
 *
 * Timeout scales with file size — was a fixed 15s which routinely
 * killed video uploads (a 30 MB clip on a 5 Mbps link is ~50s, on
 * Chinese mainland → CF often slower). Now: 30s base + 4s/MB,
 * capped at 5min. abort() is called with an explicit Error so the
 * surfaced message identifies *why* the request died (was generic
 * "signal is aborted without reason" before).
 *
 * Workers have a hard 100 MB request body limit on the bundled plan
 * (and we run paid). We reject anything over 90 MB client-side so the
 * user gets a clear error instead of an opaque 413/upstream failure.
 *
 * @param {File} file
 * @param {object} [opts]
 * @param {number} [opts.maxVideoDurationSec] — when set, video files longer
 *   than this are rejected before upload. Used by Free Mode @-asset uploads
 *   where the AI generation model (Seedance) caps reference video at 15s;
 *   *not* set for the standalone "Upload Video" mode which goes to Stream.
 */
export const uploadToSecureOSS = async (file, opts = {}) => {
  const sizeMB = file.size / (1024 * 1024);
  if (sizeMB > 90) {
    throw new Error(
      `File too large (${sizeMB.toFixed(1)} MB). Max 90 MB. ` +
      `For videos, please compress or trim first.`
    );
  }

  // Duration cap (videos only). We probe locally — no upload happens until
  // duration is verified, saving bandwidth when the user picks an episode-length
  // file by mistake. NaN means "couldn't decode" — we let those through rather
  // than block legitimate uploads on a codec edge case (worst case the Worker
  // accepts it and the AI model rejects it downstream with a clearer error).
  const cap = opts.maxVideoDurationSec;
  if (cap && file.type.startsWith('video/')) {
    const dur = await probeVideoDuration(file);
    if (Number.isFinite(dur) && dur > cap) {
      throw new Error(
        `Video too long (${dur.toFixed(1)}s). Reference videos must be ≤ ${cap}s. ` +
        `Trim it first, or use the standalone Upload Video mode for full-length clips.`
      );
    }
  }

  const fileExt = file.name.split('.').pop() || 'jpg';
  const objectKey = `characters/temp_user_${Date.now()}/${Math.random().toString(36).substring(2)}.${fileExt}`;

  // 30s base for handshake/TLS + 4s per MB upstream + 30s ceiling for
  // R2 write. Min 30s (small images) / max 5min (large videos on slow links).
  const timeoutMs = Math.min(
    Math.max(30_000, 30_000 + Math.ceil(sizeMB * 4_000) + 30_000),
    5 * 60_000
  );

  const controller = new AbortController();
  const timeoutId = setTimeout(
    () => controller.abort(new Error(
      `Upload timed out after ${(timeoutMs / 1000).toFixed(0)}s ` +
      `for ${sizeMB.toFixed(1)} MB file. Check connection or retry.`
    )),
    timeoutMs
  );

  try {
    const res = await fetch(`${UPLOAD_WORKER_URL}/${objectKey}`, {
      method: 'PUT',
      headers: {
        'Content-Type': file.type || 'image/jpeg',
      },
      body: file,
      signal: controller.signal
    });
    clearTimeout(timeoutId);

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Upload failed: ${res.status} ${text}`);
    }

    const { url } = await res.json();
    const finalUrl = url || `${CUSTOM_DOMAIN}/${objectKey}`;
    return sanitizeNeoUrl(finalUrl);
  } catch (err) {
    clearTimeout(timeoutId);
    // AbortError surfaces as DOMException with name='AbortError' — its
    // message is empty by default, so we fall through to controller.signal.reason
    // which carries the explicit Error we attached above.
    if (err.name === 'AbortError') {
      const reason = controller.signal.reason;
      throw new Error(`uploadToSecureOSS timed out: ${reason?.message || 'unknown'}`);
    }
    throw new Error(`uploadToSecureOSS failed: ${err.message}`);
  }
};

/**
 * Get a short AI-generated description of an image (≤10 chars).
 * Falls back gracefully if the API fails.
 */
export const describeAsset = async (imageUrl) => {
  try {
    const res = await fetch('/api/describe-image', {
      method: 'POST',
      headers: await authedHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ imageUrl })
    });
    const data = await res.json();
    return data.description || '素材';
  } catch {
    return '素材';
  }
};

/**
 * §2026-05-30 fei — extract structured demographics (age band, gender,
 *   confidence) from an Actor photo. Used by the character-board step to
 *   decide whether the photo can serve as facial inspiration for the
 *   story-inferred protagonist, OR whether demographics diverge enough
 *   that the photo should be ignored entirely.
 *
 *   Always resolves (no throw). On error or low signal returns
 *   { age: 'unclear', gender: 'unclear', confidence: 0 } so the caller
 *   treats it as "no useful signal" and the character-board prompt
 *   builder defaults to pure protagonist-driven design.
 *
 *   Shape: { age, gender, confidence } where
 *     age ∈ infant | child | teen | young-adult | middle-aged | elderly | unclear
 *     gender ∈ male | female | non-binary | unclear
 *     confidence ∈ [0, 1]
 */
export const extractPhotoDemographics = async (imageUrl) => {
  if (!imageUrl) return { age: 'unclear', gender: 'unclear', confidence: 0 };
  try {
    const res = await fetch('/api/extract-photo-demographics', {
      method: 'POST',
      headers: await authedHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ imageUrl })
    });
    const data = await res.json();
    return {
      age: data.age || 'unclear',
      gender: data.gender || 'unclear',
      confidence: Number(data.confidence) || 0,
    };
  } catch (e) {
    console.warn('[extractPhotoDemographics] failed, falling back to no-signal:', e?.message || e);
    return { age: 'unclear', gender: 'unclear', confidence: 0 };
  }
};

/**
 * Hit the Edge Function `userauth` to register the new character.
 */
export const saveCharacterToDB = async (payload) => {
  const { user_id, photo_url } = payload;

  const { data, error } = await supabase
    .from('characters')
    .insert([
      {
        user_id,
        photo_url,
        identity_features: JSON.stringify({ style: "default", createdVia: "upload" }),
        status: 'success'
      }
    ])
    .select()
    .single();

  if (error) {
    console.error('Error saving character to DB:', error);
    throw error;
  }

  return data;
};

/**
 * Call the Concept Design Edge Function
 */
/**
 * Generate concept art via ga.neodomain.cn Gemini relay (synchronous, no polling).
 * Returns { image_urls: ['https://asset.uvera.ai/...'] } — permanent R2 URL.
 */
/**
 * §2026-05-22 — Storyboard pipeline is now THE only path. Legacy Gemini
 *   "character model sheet" branch + the feature-flag dispatch + the
 *   getStoryboardFlag* machinery have all been deleted. Reasons:
 *
 *   1. The legacy prompt format ("Professional CHARACTER MODEL SHEET... LEFT
 *      60% full-body three-view turnaround, RIGHT 40% facial close-up.
 *      Quality: masterpiece, highly detailed, ... Negative: no watermark...")
 *      was the exact prompt fei reported still showing up despite the flag
 *      being on — caused by either old bundle cache or flag-fetch races.
 *      Killing the code path entirely removes the possibility.
 *   2. fei confirmed in conversation: storyboard is canonical, no
 *      requirement to keep the legacy path as a fallback.
 *   3. Two sources of truth (front + back flag) caused last-write-wins
 *      bugs. Now there's only one path on each side.
 *
 *   The function builds the storyboard payload directly. Caller can omit
 *   shots/character/etc — buildStoryboardPrompt on the worker side handles
 *   missing fields gracefully (empty beats block, default character name).
 */
export const generateConceptDesign = async (payload) => {
  const styleObj = STYLES.find(s => s.id === payload.styleId);
  /* §2026-05-25 fei — custom style prompt path.
   *   When payload.styleId === 'custom' AND payload.customStylePrompt is
   *   set, use the user-typed prompt as the style.prompt body, falling
   *   back through the lookup chain otherwise. The user input is trusted
   *   verbatim (it's their own prompt; we don't sanitize content beyond
   *   what GPT-image-2's own moderation does). */
  const isCustom = payload.styleId === 'custom' && (payload.customStylePrompt || '').trim();
  const styleDesc = isCustom
    ? payload.customStylePrompt.trim()
    : (styleObj ? styleObj.prompt : `${payload.styleName || 'cinematic'} style`);
  const costumeDesc = isCustom
    ? 'wardrobe consistent with the user-defined visual style above'
    : (styleObj ? styleObj.clothing : 'story-appropriate costume');

  console.log('🚀 [generateConceptDesign] → /api/generate-storyboard (OpenAI GPT-image-2). Has reference:', !!payload.sourceImageUrl, 'custom-style:', isCustom);

  const res = await fetch('/api/generate-storyboard', {
    method: 'POST',
    headers: await authedHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({
      script: {
        summary: payload.summary || null,
        mood: payload.mood || null,
        shots: payload.shots || [],
        // §2026-05-22 fei: genre signal for camera + motion presets
        videoType: payload.videoType || null,
        // §2026-05-30 fei — pass protagonist via the script envelope so the
        //   worker's effectiveProtagonist fallback chain (body.protagonist
        //   ?? script.protagonist) finds it.
        protagonist: payload.protagonist || null,
        // §2026-05-31 round-4 — supporting_characters[] for multi-character
        //   scenes (e.g. Actor + NPC when demographics differ from transcript).
        supporting_characters: payload.supportingCharacters || [],
      },
      // §2026-05-30 fei — also at top level (preferred path in worker).
      //   Worker takes whichever is set first.
      protagonist: payload.protagonist || null,
      supportingCharacters: payload.supportingCharacters || [],
      style: {
        id: payload.styleId || null,
        name: payload.styleName || null,
        // §2026-05-25 fei — styleDesc already encodes custom-prompt
        //   override (above); styleObj?.prompt would shadow it. Use
        //   styleDesc so user-typed custom prompt actually reaches worker.
        prompt: styleDesc,
        clothing: costumeDesc,
      },
      character: {
        name: payload.characterName || null,
        description: payload.characterDescription || null,
        photoUrl: payload.sourceImageUrl || null,
      },
      characterSeed: payload.characterSeed || null,
      // §2026-05-30 fei — reference image priority:
      //   1. payload.referenceImageUrl (sequel: prior video's last frame)
      //   2. payload.characterBoardUrl (NEW canonical path — character board
      //      generated in the previous step, locks character identity)
      //   3. payload.sourceImageUrl (legacy: raw Actor photo — kept only as
      //      fallback when character-board gen failed; matches old behavior)
      referenceImageUrl: payload.referenceImageUrl
        || payload.characterBoardUrl
        || payload.sourceImageUrl
        || null,
      // §2026-05-30 fei Bug 4 — render_session_id for admin cost aggregation.
      renderSessionId: payload.renderSessionId || null,
    }),
  });
  const data = await res.json();
  if (!data.success) {
    // §2026-05-29 — 服务端余额不足(402)时把 required/current 透传给调用方,
    //   以便 StoryGeneratorPage 弹精确的 paywall(tokenAlert)。
    const e = new Error(data.errMessage || 'Storyboard image generation failed');
    if (res.status === 402 || data.insufficient) { e.insufficient = true; e.required = data.required; e.current = data.current; e.status = 402; }
    throw e;
  }
  console.log(`✅ [generateConceptDesign] Image ready (model=${data.model}, quality=${data.quality}, size=${data.size}) → ${data.imageUrl}`);

  // §2026-05-22 surface safety-fallback so UI can render a gentle notice
  //   when OpenAI rejected the reference photo (real-person likeness) and
  //   we silently fell back to text-only gen. Without this the user
  //   would not know their continuity reference was dropped.
  if (data.safetyFallbackTriggered) {
    console.warn(`[generateConceptDesign] safety fallback fired — reason=${data.safetyFallbackReason}. Reference photo was NOT used.`);
  }

  return {
    image_urls: [data.imageUrl],
    usedReferenceImage: data.usedReferenceImage,
    safetyFallbackTriggered: !!data.safetyFallbackTriggered,
    safetyFallbackReason: data.safetyFallbackReason || null,
  };
};

/**
 * §2026-06-06 fei — Free Mode 纯多模态出图(/api/generate-image)。
 *
 * 与 generateConceptDesign(→ /api/generate-storyboard 故事板管线)的本质区别:
 * 这里把用户文本作为出图主指令(verbatim),只把所选风格作为轻量后缀叠加,
 * 有参考图就走 OpenAI /v1/images/edits(图+文 → 新图)。不套任何故事板/分镜
 * scaffold —— 修复"Free Mode 出图被系统提示词覆盖成角色故事板"的 bug。
 *
 *   payload: { prompt, referenceImageUrls?: string[], quality?, size?, renderSessionId? }
 *     quality: 'low' | 'medium' | 'high'(经济/标准/高清)
 *     size:    '1024x1024' | '1536x1024' | '1024x1536'(「自动」已在上游解析为具体尺寸)
 *   returns: { image_urls:[url], usedReferenceImage, safetyFallbackTriggered, safetyFallbackReason }
 */
export const generateImageAsset = async (payload) => {
  // §2026-06-06 fei — 参考图多选;兼容旧单值 referenceImageUrl。Style 已移除。
  const referenceImageUrls = Array.isArray(payload.referenceImageUrls)
    ? payload.referenceImageUrls.filter(Boolean)
    : (payload.referenceImageUrl ? [payload.referenceImageUrl] : []);

  console.log('🎨 [generateImageAsset] → /api/generate-image (gpt-image-2 multimodal). refs:', referenceImageUrls.length, 'quality:', payload.quality || 'medium', 'size:', payload.size || '1536x1024');

  const res = await fetch('/api/generate-image', {
    method: 'POST',
    headers: await authedHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({
      prompt: payload.prompt,
      referenceImageUrls,
      // §2026-06-06 fei — 画质 + 分辨率(服务端白名单校验并据此定价 3..6 credit)
      quality: payload.quality || null,
      size: payload.size || null,
      renderSessionId: payload.renderSessionId || null,
    }),
  });
  const data = await res.json();
  if (!data.success) {
    const e = new Error(data.errMessage || 'Image generation failed');
    if (res.status === 402 || data.insufficient) { e.insufficient = true; e.required = data.required; e.current = data.current; e.status = 402; }
    // §2026-06-06 fei — 透传退款信号,前端据此提示「积分已返还」
    e.refunded = !!data.refunded; e.refundedCredits = data.refundedCredits || 0;
    throw e;
  }
  if (data.safetyFallbackTriggered) {
    console.warn(`[generateImageAsset] safety fallback fired — reason=${data.safetyFallbackReason}. Reference image was NOT used.`);
  }
  return {
    image_urls: [data.imageUrl],
    usedReferenceImage: data.usedReferenceImage,
    safetyFallbackTriggered: !!data.safetyFallbackTriggered,
    safetyFallbackReason: data.safetyFallbackReason || null,
  };
};

/**
 * §2026-05-25 fei — fire alongside generateConceptDesign to produce a
 * polished CHARACTER IDENTITY BOARD (face / costume / proportion sheet
 * in the user's chosen style). Non-blocking: storyboard is the primary
 * artifact for proceeding to render; this one is for user QA + future
 * Seedance reference.
 *
 *   payload shape:
 *     styleId, styleName             — same as generateConceptDesign
 *     characterName                   — display name
 *     characterDescription            — fallback for CHARACTER SEED core idea
 *     characterSeed: {…}              — 5-field structured seed (optional)
 *     sourceImageUrl                  — Actor photo, used as face-inspiration reference
 *
 *   returns: { imageUrl, usedReferenceImage, safetyFallbackTriggered,
 *              safetyFallbackReason }
 *   throws on hard failure (caller decides whether to surface or swallow).
 */
export const generateCharacterBoard = async (payload) => {
  const styleObj = STYLES.find(s => s.id === payload.styleId);
  // §2026-05-25 fei — same custom-style resolution as generateConceptDesign
  const isCustom = payload.styleId === 'custom' && (payload.customStylePrompt || '').trim();
  const styleDesc = isCustom
    ? payload.customStylePrompt.trim()
    : (styleObj ? styleObj.prompt : `${payload.styleName || 'cinematic'} style`);
  const costumeDesc = isCustom
    ? 'wardrobe consistent with the user-defined visual style above'
    : (styleObj ? styleObj.clothing : 'story-appropriate costume');

  console.log('🎭 [generateCharacterBoard] → /api/generate-character-board. Has reference:', !!payload.sourceImageUrl, 'custom-style:', !!isCustom, 'has protagonist:', !!payload.protagonist);

  const res = await fetch('/api/generate-character-board', {
    method: 'POST',
    headers: await authedHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({
      // §2026-05-30 fei round-2 — protagonist is the canonical character input.
      //   Reflects the Actor's identity (the screenwriter set it from the
      //   uploaded photo's identity_features). The Actor photo is ALSO
      //   attached as referenceImageUrl below for face inspiration.
      protagonist: payload.protagonist || null,
      character: {
        name: payload.characterName || null,
        description: payload.characterDescription || null,
        photoUrl: payload.sourceImageUrl || null,
      },
      characterSeed: payload.characterSeed || null,
      style: {
        id: payload.styleId || null,
        name: payload.styleName || null,
        prompt: styleDesc,
        clothing: costumeDesc,
      },
      // Actor photo serves as facial-inspiration reference. Worker uses
      //   "inspired by, not copied" prompt wording for OpenAI moderation
      //   safety. The protagonist field above provides the structured
      //   age/gender/outfit/etc that the photo's freeform appearance doesn't.
      referenceImageUrl: payload.sourceImageUrl || null,
      // §2026-05-30 fei Bug 4 — render_session_id for admin cost aggregation.
      renderSessionId: payload.renderSessionId || null,
    }),
  });
  const data = await res.json();
  if (!data.success) throw new Error(data.errMessage || 'Character board generation failed');
  console.log(`✅ [generateCharacterBoard] image ready → ${data.imageUrl}`);

  return {
    imageUrl: data.imageUrl,
    usedReferenceImage: !!data.usedReferenceImage,
    safetyFallbackTriggered: !!data.safetyFallbackTriggered,
    safetyFallbackReason: data.safetyFallbackReason || null,
  };
};


export const generateRandomIdeas = async () => {
  try {
    const res = await fetch('/api/generate-ideas', {
      method: 'POST',
      headers: await authedHeaders()
    });
    const data = await res.json();
    if (!data.success) throw new Error(data.errMessage);
    return data.ideas || [];
  } catch (err) {
    console.error('[generateRandomIdeas] Failed:', err);
    return [];
  }
};

/**
 * §2026-05-23 fei: Generate a multi-segment script directly via our worker
 *   (Gemini-driven). Bypasses the Supabase aiscreenwriter Edge Function
 *   because that function's output schema doesn't honor our segments[]
 *   contract — it kept returning empty segment envelopes when asked for
 *   multi-segment stories.
 *
 *   Returns the script object on success, or throws on failure so the
 *   caller can decide whether to fall back to the legacy single-segment
 *   path.
 *
 *   Output shape: { summary, mood, totalDuration, shots, segments[] }
 */
export const generateMultiSegmentScript = async (payload) => {
  const res = await fetch('/api/generate-multi-segment-script', {
    method: 'POST',
    headers: await authedHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify(payload),
  });
  const data = await res.json();
  if (!data?.success || !data?.script) {
    throw new Error(data?.errMessage || 'Multi-segment script generation failed');
  }
  return data.script;
};

/**
 * §2026-05-24 fei: Certify an uploaded reference asset to BytePlus's
 *   Private Asset Library. The returned asset:// URI bypasses BytePlus's
 *   automatic safety filter — required for real-person reference photos
 *   that would otherwise be rejected as "InputImageSensitiveContentDetected".
 *
 *   Frontend stores the returned URI alongside the asset and uses it as
 *   the imageUrl / videoUrl in subsequent generation calls.
 *
 *   Returns: 'asset://<id>' on success, throws on failure (caller shows
 *   error to user — typically a config issue worth surfacing not silenting).
 */
export const certifyAsset = async (assetUrl, assetType = 'Image') => {
  const res = await fetch('/api/byteplus/certify-asset', {
    method: 'POST',
    headers: await authedHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ assetUrl, assetType }),
  });
  const data = await res.json();
  if (!data?.success || !data?.assetUri) {
    throw new Error(data?.errMessage || 'Asset certification failed');
  }
  return data.assetUri;
};

/**
 * §2026-05-23 fei: Expand a short character hint into the 5-field
 *   CHARACTER SEED structure used by buildStoryboardPrompt.
 *
 *   Returns: { name, seed, ageBody, visualMedium, style, otherDetails }
 *   On failure: returns null so caller can fall back to manual entry.
 */
export const expandCharacterSeed = async (hint, context) => {
  try {
    const res = await fetch('/api/expand-character-seed', {
      method: 'POST',
      headers: await authedHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ hint, context: context || null }),
    });
    const data = await res.json();
    if (!data.success) throw new Error(data.errMessage || 'expandCharacterSeed failed');
    return data.seed || null;
  } catch (err) {
    console.error('[expandCharacterSeed] failed:', err);
    return null;
  }
};

export const optimizePrompt = async (prompt) => {
  try {
    const res = await fetch('/api/optimize-prompt', {
      method: 'POST',
      headers: await authedHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ prompt })
    });
    const data = await res.json();
    if (!data.success) throw new Error(data.errMessage);
    return data.optimizedPrompt || prompt;
  } catch (err) {
    console.error('[optimizePrompt] Failed:', err);
    return prompt;
  }
};
/**
 * Submit a video generation task to Volcengine Ark (Seedance 2.0)
 * The imageUrl can be any public URL — asset.uvera.ai R2 URLs work directly, no OSS migration needed.
 * Returns a task ID like "cgt-2025XXXX"
 */
export const generateVolcengineVideo = async (payload) => {
  const { prompt, imageUrl, imageUrls, videoUrl, videoUrls, duration, ratio, resolution, generateAudio, watermark, renderSessionId } = payload;

  console.log('[generateVolcengineVideo] Submitting task. Image:', imageUrl || '(none)', 'ImageUrls:', imageUrls || '(none)', 'VideoUrls:', videoUrls || '(none)');

  // Attach JWT so the Worker can record user identity in generation_logs.
  // This isn't a hard auth gate (the Worker still accepts anonymous calls
  // and logs user_id=NULL), but for any logged-in user we want correct
  // attribution for cost analysis and the admin "Generation Logs" tab.
  const headers = { 'Content-Type': 'application/json' };
  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (session?.access_token) headers.Authorization = `Bearer ${session.access_token}`;
  } catch { /* anonymous fallback OK */ }

  const res = await fetch('/api/volcengine/video/submit', {
    method: 'POST',
    headers,
    body: JSON.stringify({
      prompt,
      imageUrl: imageUrl || null,
      imageUrls: imageUrls || null,
      videoUrl: videoUrl || null,
      videoUrls: videoUrls || null,
      duration: duration || 5,
      ratio: ratio || '16:9',
      resolution: resolution || '1080p',
      generateAudio: generateAudio ?? false,
      model: payload.model,
      watermark: watermark ?? false,
      // §2026-05-30 fei Bug 4 — render_session_id groups all logs from one
      //   Quick Mode render so admin can aggregate cost/credits per render.
      renderSessionId: renderSessionId || null,
    })
  });

  const data = await res.json();
  if (!data.success) {
    const e = new Error(data.errMessage || 'Volcengine video submission failed');
    if (res.status === 402 || data.insufficient) {
      e.insufficient = true; e.required = data.required; e.current = data.current; e.status = 402;
    }
    if (res.status === 401) e.status = 401;
    // §2026-06-06 fei — 透传退款信号(提交阶段已扣费失败时已退)
    e.refunded = !!data.refunded; e.refundedCredits = data.refundedCredits || 0;
    throw e;
  }

  console.log('[generateVolcengineVideo] Task submitted, ID:', data.taskId);
  return data.taskId;
};


/**
 * Poll the status of a Volcengine video generation task.
 * Returns normalized { status, videoUrl, errorMessage }
 * status values: 'queued' | 'running' | 'succeeded' | 'failed'
 */
export const pollVolcengineVideoStatus = async (taskId) => {
  const res = await fetch(`/api/volcengine/video/status/${taskId}`, { method: 'GET' });
  const data = await res.json();
  if (!data.success) throw new Error('Volcengine status poll failed: ' + (data.errMessage || 'unknown'));
  return {
    status: data.status,        // queued | running | succeeded | failed
    videoUrl: data.videoUrl,    // direct TOS mp4 link when succeeded
    errorMessage: data.errorMessage,
    // §2026-06-06 fei — 本次轮询是否触发了异步退款(及金额),供前端三语提示
    refunded: !!data.refunded,
    refundedCredits: data.refundedCredits || 0,
  };
};

/**
 * §2026-06-06 fei — 进页兜底:核对该用户 stuck 在 'started' 的视频任务,
 * BytePlus 已 failed 的补退款(复用 refund:<taskId> 幂等键,不会重复退)。
 * 静默失败(返回 0)。返回 { refundedCount, refundedCredits }。
 */
export const reconcileStuckVideos = async () => {
  try {
    const res = await fetch('/api/video/reconcile-stuck', {
      method: 'POST',
      headers: await authedHeaders({ 'Content-Type': 'application/json' }),
    });
    const data = await res.json().catch(() => ({}));
    if (!data || !data.success) return { refundedCount: 0, refundedCredits: 0 };
    return { refundedCount: data.refundedCount || 0, refundedCredits: data.refundedCredits || 0 };
  } catch { return { refundedCount: 0, refundedCredits: 0 }; }
};



/**
 * Downloads a video from a URL and stores it permanently. Worker handles
 * tier branching: free/lite → CF Stream + "uvera.ai" watermark, paid → R2.
 * Function name is legacy (predates the tier split) — kept for compatibility.
 *
 * @param {string} videoUrl - source video URL (Volcengine TOS signed URL)
 * @param {Object} [opts]
 * @param {string} [opts.taskId] - BytePlus task ID for generation_logs
 *                                 correlation (§2026-05-15 P0.b). When
 *                                 provided, worker PATCHes file_size_bytes
 *                                 back to generation_logs for cost analytics.
 * @returns {Promise<string>} permanent playback URL (R2 OR CF Stream form)
 */
export const uploadUrlToCloudflareStream = async (videoUrl, opts = {}) => {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 35000); // 35s since Cloudflare Worker max is 30s

  try {
    // Forward the user's session so worker can detect tier for routing
    // (free/lite → CF Stream + watermark, paid → R2 direct).
    let authHeader = {};
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (session?.access_token) authHeader = { 'Authorization': `Bearer ${session.access_token}` };
    } catch { /* anon = free routing */ }

    const res = await fetch('/api/stream/upload-from-url', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeader },
      body: JSON.stringify({
        videoUrl,
        ...(opts.taskId ? { taskId: opts.taskId } : {}),
      }),
      signal: controller.signal
    });
    clearTimeout(timeoutId);

    const data = await res.json();
    if (!data.success || !data.videoUrl) {
      throw new Error('Failed to upload video to permanent storage: ' + (data.errMessage || 'unknown error'));
    }

    return data.videoUrl;
  } catch (err) {
    clearTimeout(timeoutId);
    throw new Error(`uploadUrlToCloudflareStream failed: ${err.message}`);
  }
};


