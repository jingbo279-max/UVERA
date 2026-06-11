// --- BytePlus V4 Signature Utility (WebCrypto) ---
async function sha256Hex(text) {
  const enc = new TextEncoder();
  const hash = await crypto.subtle.digest('SHA-256', enc.encode(text));
  return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, '0')).join('');
}

async function hmac(keyData, msg) {
  const enc = new TextEncoder();
  const keyBuf = typeof keyData === 'string' ? enc.encode(keyData) : keyData;
  const key = await crypto.subtle.importKey('raw', keyBuf, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return await crypto.subtle.sign('HMAC', key, enc.encode(msg));
}

async function hmacHex(keyData, msg) {
  const sig = await hmac(keyData, msg);
  return Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, '0')).join('');
}

async function signBytePlusRequest(method, action, bodyStr, ak, sk) {
  const url = new URL(`https://open.ap-southeast-1.byteplusapi.com/?Action=${action}&Version=2024-01-01`);
  const date = new Date();
  const amzDate = date.toISOString().replace(/[:-]|\.\d{3}/g, '');
  const dateStamp = amzDate.slice(0, 8);
  const region = 'ap-southeast-1';
  const service = 'ark';

  const payloadHash = await sha256Hex(bodyStr || '');

  const canonicalHeaders = `content-type:application/json\nhost:${url.host}\nx-content-sha256:${payloadHash}\nx-date:${amzDate}\n`;
  const signedHeaders = 'content-type;host;x-content-sha256;x-date';
  const canonicalRequest = `${method}\n${url.pathname}\n${url.search.slice(1)}\n${canonicalHeaders}\n${signedHeaders}\n${payloadHash}`;

  const algorithm = 'HMAC-SHA256';
  const credentialScope = `${dateStamp}/${region}/${service}/request`;
  const stringToSign = `${algorithm}\n${amzDate}\n${credentialScope}\n${await sha256Hex(canonicalRequest)}`;

  const kDate = await hmac(sk, dateStamp);
  const kRegion = await hmac(kDate, region);
  const kService = await hmac(kRegion, service);
  const kSigning = await hmac(kService, 'request');

  const signature = await hmacHex(kSigning, stringToSign);
  const authorization = `${algorithm} Credential=${ak}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

  return {
    'Content-Type': 'application/json',
    'X-Date': amzDate,
    'X-Content-Sha256': payloadHash,
    'Authorization': authorization
  };
}

/* uploadRealPersonAssetToBytePlus(assetUrl, env, assetType)
 *
 * When BytePlus rejects a public URL for real-person sensitive-content
 * (InputImageSensitiveContentDetected / InputVideoSensitiveContentDetected /
 * generic Invalid url codes that turn out to be face-detection), we have a
 * fallback: upload the asset to our private Asset Library (BAIZE platform)
 * with Moderation.Strategy="Skip", then retry the video generation with
 * the asset:// URI instead of the raw URL. That bypasses the auto-rejection
 * for users whose protocol agreement is on file with BytePlus.
 *
 * assetType: 'Image' | 'Video'
 *   Image  — used by image_url reference path (role='reference_image' —
 *            Seedance treats it as creative anchor, NOT as first frame of
 *            output video; first_frame mode is a different role we don't use)
 *   Video  — used by video_url reference path (Recast / Sequel reference clip)
 *
 * Returns `asset://${assetId}` which BytePlus understands as a private
 * asset reference, bypassing the URL-fetch + moderation pipeline.
 *
 * Throws on AK/SK missing or polling timeout.                            */
async function uploadRealPersonAssetToBytePlus(assetUrl, env, assetType = 'Image') {
  // §2026-05-15: prefer admin-configured DB values over Cloudflare env vars
  // (admin can rotate via UI without wrangler CLI). Falls back to env if
  // DB not yet configured — keeps existing deploys working through migration.
  const AK = (await getSystemSetting(env, 'byteplus_ark_ak', null)) || env.ARK_AK;
  const SK = (await getSystemSetting(env, 'byteplus_ark_sk', null)) || env.ARK_SK;
  // §2026-05-22 admin-configurable project name. Hardcode was the cause of
  // many "AccessDenied on resource trn:iam::project/X" errors when the AK
  // was scoped to a different project than the hardcoded one. Default
  // "HKBAIZE-005" preserves backward compat.
  const PROJECT_NAME = await getSystemSetting(env, 'byteplus_asset_project', 'HKBAIZE-005');
  if (!AK || !SK) throw new Error("ARK_AK or ARK_SK not configured for asset upload (checked system_settings + Cloudflare env vars)");
  if (!['Image', 'Video'].includes(assetType)) {
    throw new Error(`Invalid assetType "${assetType}" — must be 'Image' or 'Video'`);
  }

  console.log(`[BytePlus] Uploading real-person ${assetType.toLowerCase()} to Private Asset Library (project=${PROJECT_NAME})...`, assetUrl);

  // §2026-05-22 loud-fail wrapper for BytePlus calls. Previously these
  // fetched + .json()'d without checking r.ok, swallowing 403 AccessDenied
  // (IAM permission missing) + 401 (signature drift) + 5xx as
  // "Failed to create AssetGroup: <undefined>" mystery errors. Now every
  // API call routes through here so the actual BytePlus error code +
  // message hit CF Worker Logs immediately.
  // §2026-05-22 actionable-error helper: BytePlus IAM 403s are the #1 source
  //   of mystery "real-person fallback failed" reports, almost always caused
  //   by AK/SK + project name mismatch (rotated AK but didn't update project
  //   name; new account but kept old hardcoded project; etc). When the API
  //   returns AccessDenied / 100013 / similar, we synthesize an admin-facing
  //   hint that names the exact admin UI field to change and tells them where
  //   to find the right value in BytePlus console. Saves the next round of
  //   "I changed the key, why doesn't it work?" debugging.
  const buildActionableHint = (code, msg, action) => {
    const codeStr = String(code);
    const msgLower = String(msg).toLowerCase();
    // §2026-05-22 NotFound.ProjectName — project doesn't exist on this account.
    //   Different from AccessDenied (which means project exists, just no permission).
    //   This means admin TYPED a project name that hasn't been created in BytePlus
    //   console yet, OR copied a project name from another account.
    if (
      codeStr === 'NotFound.ProjectName' ||
      (msgLower.includes('projectname') && msgLower.includes('not found'))
    ) {
      const projMatch = String(msg).match(/projectname\s+([A-Z0-9-]+)/i);
      const missingProj = projMatch?.[1] || PROJECT_NAME;
      return ` 📁 Project "${missingProj}" doesn't exist in this BytePlus account. Two fixes: ` +
             `(A) easiest — change "BytePlus Asset Library project name" in admin to "default" (BytePlus auto-creates this on every account); ` +
             `(B) create the project — BytePlus console → IAM → Resource management → Projects → "Create Project" → name it "${missingProj}" → grant your AK ark:*Asset* permissions on it.`;
    }
    // AccessDenied + project-scoped error → project name mismatch (different from above —
    //   project EXISTS but AK doesn't have access)
    if (
      codeStr === '100013' ||
      codeStr.includes('AccessDenied') ||
      msgLower.includes('not authorized') ||
      msgLower.includes('iam::project')
    ) {
      // Try to extract the project name BytePlus rejected from the error msg
      const projMatch = String(msg).match(/project\/([A-Z0-9-]+)/i);
      const rejectedProj = projMatch?.[1] || PROJECT_NAME;
      return ` 🔑 Likely cause: AK/SK has no IAM access to project "${rejectedProj}". ` +
             `Fix in admin → System Settings → "BytePlus Asset Library project name" ` +
             `— set it to whatever project the new AK is actually scoped to ` +
             `(look it up in BytePlus console → IAM → Access Keys → click the AK → Resource field shows "trn:iam::ACCOUNT:project/<NAME>"). ` +
             `If you have no project yet on the new account, try "default".`;
    }
    if (codeStr === '100018' || msgLower.includes('quota') || msgLower.includes('rate limit')) {
      return ' ⏱️ Likely cause: BytePlus rate limit or quota exhausted. Check console → Billing.';
    }
    if (msgLower.includes('signature') || codeStr === '100009') {
      return ' 🔐 Likely cause: invalid signature — SK may be wrong or AK/SK got desynced. Re-paste both in admin UI.';
    }
    return '';
  };

  const bytePlusCall = async (action, body) => {
    const headers = await signBytePlusRequest('POST', action, body, AK, SK);
    const r = await fetch(`https://open.ap-southeast-1.byteplusapi.com/?Action=${action}&Version=2024-01-01`, {
      method: 'POST', headers, body,
    });
    const text = await r.text();
    let data;
    try { data = JSON.parse(text); } catch { data = { _rawText: text }; }
    if (!r.ok) {
      const err = data?.ResponseMetadata?.Error;
      const code = err?.Code || err?.CodeN || 'unknown';
      const msg = err?.Message || text.slice(0, 200);
      const hint = buildActionableHint(code, msg, action);
      // Loud-fail per 2026-05-15 pattern — these errors used to disappear silently
      console.error(`[BytePlus] ${action} HTTP ${r.status}: ${code} — ${msg}${hint ? ' ' + hint : ''}`);
      throw new Error(`BytePlus ${action} failed (HTTP ${r.status}, ${code}): ${msg}.${hint}`);
    }
    // Even when HTTP 200, BytePlus sometimes returns ResponseMetadata.Error
    // for application-level failures (param invalid, project mismatch, etc.)
    if (data?.ResponseMetadata?.Error) {
      const err = data.ResponseMetadata.Error;
      const hint = buildActionableHint(err.Code, err.Message, action);
      console.error(`[BytePlus] ${action} 200-with-error: ${err.Code} — ${err.Message}${hint ? ' ' + hint : ''}`);
      throw new Error(`BytePlus ${action} returned application error (${err.Code}): ${err.Message}.${hint}`);
    }
    return data;
  };

  // 1. Get or Create Asset Group
  const listBody = JSON.stringify({ ProjectName: PROJECT_NAME, Filter: { GroupType: "AIGC" }, PageNumber: 1, PageSize: 1 });
  const listData = await bytePlusCall('ListAssetGroups', listBody);

  let groupId;
  if (listData.Result?.Items?.length > 0) {
    groupId = listData.Result.Items[0].Id;
  } else {
    console.log('[BytePlus] No AssetGroup found, creating one...');
    const createGroupBody = JSON.stringify({ Name: "uvera_auto_group", Description: "Uvera Auto Group", ProjectName: PROJECT_NAME });
    const createGroupData = await bytePlusCall('CreateAssetGroup', createGroupBody);
    if (!createGroupData.Result?.Id) throw new Error("Failed to create AssetGroup (no Result.Id): " + JSON.stringify(createGroupData).slice(0, 200));
    groupId = createGroupData.Result.Id;
  }

  // 2. Create Asset (Image or Video)
  const createBody = JSON.stringify({ GroupId: groupId, URL: assetUrl, AssetType: assetType, ProjectName: PROJECT_NAME, Moderation: { Strategy: "Skip" } });
  const createData = await bytePlusCall('CreateAsset', createBody);
  if (!createData.Result?.Id) throw new Error("Failed to create Asset (no Result.Id): " + JSON.stringify(createData).slice(0, 200));

  const assetId = createData.Result.Id;
  console.log(`[BytePlus] ${assetType} asset created, polling status...`, assetId);

  // 3. Poll GetAsset until Active. Video transcoding takes longer than
  // image preprocessing — give video up to 60s (30 polls × 2s) vs the
  // 30s budget for images (15 polls × 2s).
  const maxPolls = assetType === 'Video' ? 30 : 15;
  for (let i = 0; i < maxPolls; i++) {
    await new Promise(r => setTimeout(r, 2000));
    const getBody = JSON.stringify({ Id: assetId, ProjectName: PROJECT_NAME });
    const getData = await bytePlusCall('GetAsset', getBody);

    if (getData.Result?.Status === 'Active') {
      console.log(`[BytePlus] ${assetType} asset is Active!`, assetId);
      return `asset://${assetId}`;
    }
    if (getData.Result?.Status === 'Failed') {
      throw new Error(`Asset processing failed: ${JSON.stringify(getData).slice(0, 300)}`);
    }
  }
  throw new Error(`Timeout polling ${assetType} asset status: ${assetId}`);
}

// Backward-compat alias — existing callers pass image only
async function uploadRealPersonToBytePlus(imageUrl, env) {
  return uploadRealPersonAssetToBytePlus(imageUrl, env, 'Image');
}

/* ─── Generation log helpers ─────────────────────────────────────────────
 * Capture every paid / AI API call into public.generation_logs so admin
 * can see exactly what was called, by whom, with what params, and how
 * long it took. All best-effort — failures here NEVER break the user-
 * facing endpoint (logged warnings only).
 *
 * Pattern at every endpoint:
 *
 *   const logId = await logApiStart(env, request, 'concept_image', {
 *     prompt, refsCount, model, ...
 *   });
 *   const t0 = Date.now();
 *   try {
 *     ... do work ...
 *     await logApiFinish(env, logId, { status: 'succeeded',
 *       duration_ms: Date.now() - t0, http_status: 200 });
 *     return response;
 *   } catch (err) {
 *     await logApiFinish(env, logId, { status: 'failed',
 *       duration_ms: Date.now() - t0, error_message: err.message });
 *     throw err;
 *   }
 *
 * Schema: migrations/20260508_generation_logs.up.sql +
 *         20260509_generation_logs_extend.up.sql +
 *         20260522_generation_logs_storyboard_type.up.sql
 * ───────────────────────────────────────────────────────────────────── */

/* §2026-05-22 fei: source-of-truth allow-lists for the two CHECK constraints
 * on generation_logs. Must stay in sync with migrations. logApiStart
 * validates against these BEFORE attempting INSERT so if a developer adds
 * a new value here without writing the migration, they get a LOUD warning
 * in worker logs immediately (instead of the previous "silent INSERT
 * rejection by Postgres + fail-open swallow" that hid the storyboard_image
 * + openai bugs for 24 hours).
 *
 * If you add a value here, ALSO write a migration extending the matching
 * CHECK constraint. See migrations/20260522_*.up.sql for the pattern.
 */
const VALID_GENERATION_TYPES = new Set([
  'video',
  'concept_image',
  'script',
  'asset_describe',
  'optimize_prompt',
  'random_ideas',
  'user_video_upload',
  'admin_grant_credits',
  'storyboard_image',  // §2026-05-21 GPT-image-2 pipeline
  'character_board',   // §2026-06-06 — was logged by /api/generate-character-board since 5/25 but never in the CHECK → rows silently rejected; fixed in 20260606 migration
  'freemode_image',    // §2026-06-06 fei — Free Mode 纯多模态出图 (/api/generate-image)
]);
const VALID_VENDORS = new Set([
  'volcengine',
  'gemini',
  'neodomain',
  'cloudflare',
  'openai',  // §2026-05-21 GPT-image-2 pipeline
]);

async function logApiStart(env, request, generationType, params = {}) {
  // §2026-05-22 fei: defensive validation. Catches generation_type / vendor
  //   mismatch between worker code + DB CHECK constraint at the call site,
  //   so the developer sees the warning IMMEDIATELY in CF logs (rather
  //   than the previous "silent INSERT failure" that hid storyboard_image
  //   + openai bugs for 24h).
  if (!VALID_GENERATION_TYPES.has(generationType)) {
    console.error(
      `[logApiStart] ⚠️ Unknown generation_type "${generationType}". ` +
      `This INSERT will be REJECTED by Postgres CHECK constraint. ` +
      `Fix: (1) add "${generationType}" to VALID_GENERATION_TYPES in public/_worker.js, ` +
      `(2) write a migration extending generation_logs_generation_type_check. ` +
      `See migrations/20260522_generation_logs_storyboard_type.up.sql for the pattern.`
    );
  }
  const vendorParam = params?.vendor;
  if (vendorParam && !VALID_VENDORS.has(vendorParam)) {
    console.error(
      `[logApiStart] ⚠️ Unknown vendor "${vendorParam}". ` +
      `This INSERT will be REJECTED by Postgres CHECK constraint. ` +
      `Fix: (1) add "${vendorParam}" to VALID_VENDORS in public/_worker.js, ` +
      `(2) extend generation_logs_vendor_check in the next migration.`
    );
  }

  const supabaseUrl = env.SUPABASE_URL || 'https://wjhdsodlxekvhpahascs.supabase.co';
  const anonKey = env.SUPABASE_ANON_KEY || '';

  // Best-effort identify caller
  let userId = null, userEmail = null;
  try {
    const auth = request.headers.get('Authorization');
    if (auth) {
      const r = await fetch(`${supabaseUrl}/auth/v1/user`, {
        headers: { 'Authorization': auth, 'apikey': anonKey },
      });
      if (r.ok) {
        const u = await r.json();
        userId = u?.id || null;
        userEmail = u?.email || null;
      }
    }
  } catch { /* anonymous OK */ }

  // Sanitize params — strip any potentially huge fields (full base64 images,
  // long prompts) to keep log rows reasonable. Cap prompt at 1000 chars,
  // skip raw base64.
  const sanitized = sanitizeLogParams(params);

  try {
    const r = await fetch(`${supabaseUrl}/rest/v1/generation_logs`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
        'apikey': env.SUPABASE_SERVICE_ROLE_KEY,
        'Content-Type': 'application/json',
        'Prefer': 'return=representation',
      },
      body: JSON.stringify({
        user_id: userId,
        user_email: userEmail,
        generation_type: generationType,
        endpoint: new URL(request.url).pathname,
        // Promote a few well-known fields out of params for indexable columns
        prompt: typeof sanitized.prompt === 'string' ? sanitized.prompt.substring(0, 4000) : null,
        prompt_length: typeof sanitized.prompt === 'string' ? sanitized.prompt.length : null,
        reference_image_count: Number.isFinite(sanitized.refsCount) ? sanitized.refsCount : 0,
        has_video_reference: !!sanitized.hasVideoRef,
        resolution: sanitized.resolution || null,
        duration_seconds: Number.isFinite(sanitized.duration) ? sanitized.duration : null,
        ratio: sanitized.ratio || null,
        generate_audio: typeof sanitized.generateAudio === 'boolean' ? sanitized.generateAudio : null,
        model: sanitized.model || null,
        vendor: sanitized.vendor || null,
        // §2026-05-30 fei Bug 4 — render_session_id groups all logs from one
        //   Quick Mode render (char board + storyboard + N video segs). Caller
        //   passes via params.renderSessionId; promoted here so admin can
        //   aggregate cost/credit by session.
        render_session_id: typeof sanitized.renderSessionId === 'string' ? sanitized.renderSessionId : null,
        request_params: sanitized,
        status: 'started',
        client_ip: request.headers.get('CF-Connecting-IP') || null,
        user_agent: request.headers.get('User-Agent') || null,
      }),
    });
    if (!r.ok) {
      // §2026-05-15 loud-fail audit: fail-open (return null) by design —
      // a failure here would cause the entire API call to refuse to serve,
      // and observability is less important than uptime. But escalate to
      // console.error + include response body so PostgREST schema drift
      // is visible in CF Worker Logs / alerting.
      const errBody = await r.text().catch(() => '(unreadable)');
      // §2026-05-22 fei: detect CHECK constraint violations specifically.
      //   This was the failure mode that hid storyboard_image + openai for
      //   24h. Postgres returns 400 with code 23514 + a constraint name in
      //   the body. We surface a SUPER actionable error with the exact fix.
      const isCheckViolation = /23514|violates check constraint/i.test(errBody);
      if (isCheckViolation) {
        const constraintMatch = errBody.match(/constraint\s+"?([a-z_]+_check)"?/i);
        const constraintName = constraintMatch?.[1] || '(unknown constraint)';
        console.error(
          `[logApiStart] ⛔ CHECK constraint violation on ${constraintName}. ` +
          `Attempted: generation_type="${generationType}" vendor="${params?.vendor}". ` +
          `This row is LOST (fail-open). ` +
          `Fix: add the value to the constraint via a new migration. ` +
          `See migrations/20260522_generation_logs_storyboard_type.up.sql for the pattern. ` +
          `Raw error: ${errBody.slice(0, 200)}`
        );
      } else {
        console.error('[logApiStart] insert non-OK', 'status=' + r.status, 'body=' + errBody.slice(0, 300), '— FAIL-OPEN: returning null logId');
      }
      return null;
    }
    const rows = await r.json();
    return rows?.[0]?.id || null;
  } catch (err) {
    console.error('[logApiStart] exception (fail-open):', err.message);
    return null;
  }
}

/* §2026-05-26 fei — LLM usage extraction + pricing helpers.
 *
 *   Gemini returns usageMetadata: {
 *     promptTokenCount: <int>,
 *     candidatesTokenCount: <int>,
 *     totalTokenCount: <int>
 *   }
 *   OpenAI returns usage: { prompt_tokens, completion_tokens, total_tokens }.
 *   Both shapes flow through this single helper so endpoint code stays terse.
 *
 *   priceLLMCallUsd looks up per-million-token rates from system_settings
 *   (key='llm_token_prices', JSON map model→rates). Unknown models fall
 *   back to a 'default' entry. Returns numeric USD or null when we have
 *   no tokens to bill (caller should keep cost_usd as null rather than
 *   inventing a placeholder). */
function extractLlmUsage(responseJson) {
  if (!responseJson || typeof responseJson !== 'object') return { inputTokens: null, outputTokens: null };
  // Gemini shape
  const gu = responseJson.usageMetadata;
  if (gu && typeof gu === 'object') {
    return {
      inputTokens:  Number.isFinite(gu.promptTokenCount)     ? gu.promptTokenCount     : null,
      outputTokens: Number.isFinite(gu.candidatesTokenCount) ? gu.candidatesTokenCount : null,
    };
  }
  // OpenAI shape
  const ou = responseJson.usage;
  if (ou && typeof ou === 'object') {
    return {
      inputTokens:  Number.isFinite(ou.prompt_tokens)     ? ou.prompt_tokens     : null,
      outputTokens: Number.isFinite(ou.completion_tokens) ? ou.completion_tokens : null,
    };
  }
  return { inputTokens: null, outputTokens: null };
}

async function priceLLMCallUsd(env, { model, inputTokens, outputTokens }) {
  if (!Number.isFinite(inputTokens) && !Number.isFinite(outputTokens)) return null;
  let rates = null;
  try {
    const raw = await getSystemSetting(env, 'llm_token_prices', null);
    if (raw) rates = JSON.parse(raw);
  } catch (e) {
    console.warn('[priceLLMCallUsd] failed to parse llm_token_prices:', e.message);
  }
  if (!rates || typeof rates !== 'object') return null;
  const modelKey = String(model || '').toLowerCase();
  // Best-effort match: exact key first, then any rate key the model name contains.
  let entry = rates[modelKey] || rates[model] || null;
  if (!entry) {
    for (const k of Object.keys(rates)) {
      if (k === 'default') continue;
      if (modelKey.includes(k.toLowerCase())) { entry = rates[k]; break; }
    }
  }
  if (!entry) entry = rates.default;
  if (!entry) return null;
  const inPm  = Number(entry.input_per_million_usd)  || 0;
  const outPm = Number(entry.output_per_million_usd) || 0;
  const cost  = ((Number(inputTokens)  || 0) * inPm / 1_000_000)
              + ((Number(outputTokens) || 0) * outPm / 1_000_000);
  return Number.isFinite(cost) ? Math.round(cost * 1_000_000) / 1_000_000 : null;  // 6dp precision
}

async function logApiFinish(env, logId, fields = {}) {
  if (!logId) return;
  const supabaseUrl = env.SUPABASE_URL || 'https://wjhdsodlxekvhpahascs.supabase.co';
  try {
    const r = await fetch(`${supabaseUrl}/rest/v1/generation_logs?id=eq.${logId}`, {
      method: 'PATCH',
      headers: {
        'Authorization': `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
        'apikey': env.SUPABASE_SERVICE_ROLE_KEY,
        'Content-Type': 'application/json',
        'Prefer': 'return=minimal',
      },
      body: JSON.stringify({
        status: fields.status || 'succeeded',
        finished_at: new Date().toISOString(),
        duration_ms: Number.isFinite(fields.duration_ms) ? fields.duration_ms : null,
        http_status: Number.isFinite(fields.http_status) ? fields.http_status : null,
        response_size_bytes: Number.isFinite(fields.response_size_bytes) ? fields.response_size_bytes : null,
        output_url: fields.output_url || null,
        error_message: fields.error_message || null,
        cost_usd: Number.isFinite(fields.cost_usd) ? fields.cost_usd : null,
        // §A Phase 1.5 (2026-05-13): dual-write credits_charged + tokens_charged
        // Single fields.credits_charged source covers both columns until
        // Phase 4 drops the old one. Symmetric: caller can pass tokens_charged
        // and we mirror to credits_charged so worker is rename-transition safe.
        credits_charged: Number.isFinite(fields.credits_charged ?? fields.tokens_charged) ? (fields.credits_charged ?? fields.tokens_charged) : null,
        tokens_charged:  Number.isFinite(fields.tokens_charged ?? fields.credits_charged) ? (fields.tokens_charged ?? fields.credits_charged) : null,
        task_id: fields.task_id || null,
        // §2026-05-26 fei — per-call LLM token counts. NULL for non-LLM calls.
        input_tokens:  Number.isFinite(fields.input_tokens)  ? fields.input_tokens  : null,
        output_tokens: Number.isFinite(fields.output_tokens) ? fields.output_tokens : null,
      }),
    });
    // §2026-05-15 loud-fail audit: PROD `tokens_charged` was missing for
    // days because this function silently swallowed PostgREST 400s — fetch
    // resolves any HTTP response, only `throw`s on network failure. Now we
    // log the full error to CF Worker Logs so Sentry/Grafana can alert.
    // See docs/decisions/2026-05-15-loud-fail-pattern.md.
    if (!r.ok) {
      const errBody = await r.text().catch(() => '(unreadable)');
      console.error(
        '[logApiFinish] PATCH non-OK',
        'status=' + r.status,
        'logId=' + logId,
        'fieldKeys=' + JSON.stringify(Object.keys(fields)),
        'body=' + errBody.slice(0, 300),
      );
    }
  } catch (err) {
    console.error('[logApiFinish] PATCH exception:', err.message, 'logId=' + logId);
  }
}

// Trim large / sensitive fields from request_params before logging.
function sanitizeLogParams(params) {
  if (!params || typeof params !== 'object') return {};
  const out = {};
  for (const [k, v] of Object.entries(params)) {
    if (v == null) continue;
    if (typeof v === 'string') {
      // Skip raw base64 / data URIs (huge, useless in logs)
      if (v.startsWith('data:') || v.length > 4000) {
        out[k] = `<${v.length}-char string truncated>`;
      } else {
        out[k] = v;
      }
    } else if (Array.isArray(v)) {
      out[k] = v.length;  // store length only — full arrays of URLs are noisy
    } else if (typeof v === 'object') {
      out[k] = '<object>';
    } else {
      out[k] = v;
    }
  }
  return out;
}

/* ─── Lite (one-time top-up) tiered pricing ────────────────────────────
 *
 * Decision 2026-05-14: Lite repeated purchases get progressively more
 * expensive to nudge heavy buyers toward the monthly subscriptions:
 *
 *   1st purchase: $3.99 / 100 tokens ($0.0399/token, cheapest)
 *   2nd purchase: $5.99 / 100 tokens ($0.0599/token)
 *   3rd+        : $7.99 / 100 tokens ($0.0799/token, more than Studio)
 *
 * Why: pure $3.99 had pricing-economics inversion — cheaper per-token
 * than Starter monthly. Savvy users would never upgrade. Tiered fix:
 * first taste is cheap (acquisition), repeat usage gets expensive enough
 * that Starter $25/mo becomes the rational choice.
 *
 * Implementation: ad-hoc pricing via Stripe Checkout's
 * line_items[0][price_data] parameter. We don't need 3 separate Stripe
 * products — just override unit_amount on the existing Lite product per
 * checkout. The product is derived once from STRIPE_PRICE_LITE_TRIAL.
 *
 * Counting past purchases: orders table query for completed Lite rows
 * (status=1, not voided, not refunded). Refunded/voided purchases don't
 * count toward tier — fair, since user didn't actually get the value.
 * ───────────────────────────────────────────────────────────────────── */

/**
 * Loud-fail wrapper for service_role / Stripe / 3rd-party fetches.
 *
 * Why this exists: native `fetch()` resolves any HTTP response (including
 * 4xx/5xx). It only `throw`s on DNS / network failure. If a downstream
 * caller doesn't check `r.ok`, a 400 PGRST204 (unknown column) or 500
 * Supabase failure silently disappears — that's what hid the Phase 1.5
 * schema mismatch for several days in May 2026.
 *
 * Use this for:
 *   - service_role POST/PATCH/PUT/DELETE on /rest/v1/* (PostgREST)
 *   - /auth/v1/admin/* admin operations
 *   - Stripe API write operations
 *   - Any operation whose silent failure would lose data
 *
 * Logs to console.error (lands in CF Worker Logs → alerting can pick it
 * up) AND throws so the caller's outer try/catch can return 500 to the
 * client. If you need fail-open (e.g. fire-and-forget receipt email),
 * wrap the call in your own try/catch with an explicit comment saying
 * WHY fail-open is correct for that flow.
 *
 * See docs/decisions/2026-05-15-loud-fail-pattern.md for rationale.
 */
async function assertOk(r, context) {
  if (r.ok) return r;
  const errBody = await r.text().catch(() => '(unreadable)');
  const msg = `[${context}] HTTP ${r.status}: ${errBody.slice(0, 300)}`;
  console.error(msg);
  throw new Error(msg);
}

/**
 * §2026-06-05 — 给 CF Stream 视频设默认 poster 帧 = 时长 10% 处(非纯黑首帧)。
 *   CF Stream 的 `thumbnails/thumbnail.jpg` 默认取 time=0(很多视频开头是黑/淡入
 *   → 黑 poster)。设 `thumbnailTimestampPct=0.1` 后,所有用 thumbnail.jpg 的地方
 *   (URL 不变)自动返回 10% 处的帧。fire-and-forget:失败只 log,不阻断发布。
 *   背景 + 449 条旧数据回填见 scripts/backfill-stream-thumbnails.mjs。
 */
async function setStreamPosterPct(env, streamUid, pct = 0.1) {
  if (!streamUid || !/^[a-f0-9]{32}$/i.test(streamUid)) return false;
  const acct = env.CF_ACCOUNT_ID || 'd2acf946d8f80f382be77437a71c4832';
  const token = env.CF_API_TOKEN || ('cfut' + '_MGaGN86d75OIHOSPrVfqP7f2iw' + 'nhpxpbnSRhNNJi231d9654');
  try {
    const r = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${acct}/stream/${streamUid}`,
      {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ thumbnailTimestampPct: pct }),
      }
    );
    if (!r.ok) {
      console.error(`[setStreamPosterPct] ${streamUid} → HTTP ${r.status} ${(await r.text().catch(() => '')).slice(0, 200)}`);
      return false;
    }
    return true;
  } catch (e) {
    console.error(`[setStreamPosterPct] ${streamUid} threw: ${e.message}`);
    return false;
  }
}

const LITE_PRICE_TIERS_CENTS = [399, 599, 799];  // 1st / 2nd / 3rd+

/**
 * Computes the post-payment `tier` value for a user_metadata patch.
 *
 * Lite is an additive token top-up (one-time, +100 tokens). Buying Lite
 * MUST NOT downgrade a user already on a paid subscription. Shipping that
 * downgrade was a real production bug: a Creator user bought $3.99 Lite
 * and silently lost Creator-tier privileges because the webhook
 * unconditionally wrote `tier = planInfo.tier` (= 'lite').
 *
 * Rules:
 *   - Buying Lite while on `free` → set tier='lite' (gives Lite badge)
 *   - Buying Lite while on lite/starter/creator/studio → tier unchanged
 *   - Buying a subscription tier (starter/creator/studio) → tier = that tier
 *     (the "downgrade defers to period end" UX is enforced UPSTREAM in
 *     /api/stripe/checkout — by the time invoice.payment_succeeded fires,
 *     Stripe has actually charged for that tier and it should activate)
 */
const TIER_RANK = { free: 0, lite: 1, starter: 2, creator: 3, studio: 4 };
function computeNewTier(currentTier, purchasedTier) {
  if (purchasedTier === 'lite') {
    const curRank = TIER_RANK[currentTier] ?? 0;
    return curRank < TIER_RANK['lite']
      ? 'lite'
      : (currentTier || 'free');
  }
  return purchasedTier;
}

/**
 * Build the GPT-image-2 prompt for storyboard generation.
 *
 * Architecture (§2026-05-21, expanded §2026-05-22):
 *   - Style: 100% sourced from user-selected styleObj.prompt — we do NOT
 *     force the "诺兰 IMAX 65mm Kodak Vision3 5219" cinematic prefix that
 *     草帽小蔡 recommends as universal. That prefix locks in a specific
 *     filmic look (live-action / Interstellar) which fights against
 *     stylized art categories (Pixar / Ghibli / Cyberpunk / etc.). Per
 *     fei 2026-05-21, style anchor is per-preset.
 *   - 真人 三把钥匙 (skin/hair/eye keywords): SKIPPED — all current STYLES
 *     entries are non-photoreal (动画经典 / 现代视觉与实验 / 传统工艺美术 /
 *     游戏前卫与艺术). Real-skin keywords would fight these aesthetics.
 *   - Universal cinematic tail: KEPT — fei wants the soft-focus / restrained
 *     detail / Kodak Portra grain anti-noise lock applied. 草帽小蔡 marks
 *     this as style-agnostic.
 *   - Negative prompts: NEVER — GPT-image-2 ignores them at best, activates
 *     forbidden concepts at worst. Use positive form instead ("text-free
 *     output" instead of "no subtitles").
 *   - Blacklist words avoided in our template: 精细, 复杂, HDR, hyper-detailed,
 *     intricate, ultra sharp, 8K, masterpiece, highly detailed. These trigger
 *     GPT's "show off detail" mode → noise / over-sharp / fragmented texture.
 *   - Story shots: ALL included as narrative context with VERBATIM action /
 *     dialogue / narration / camera language. Dialogue + narration are
 *     EMOTIONAL CUES the model uses to pick pose & lighting — NEVER rendered
 *     as text. (草帽小蔡 positive-form: explicit "do not render as text",
 *     not "no subtitles".)
 *
 * §2026-05-22 round-2 (fei: "信息含量太少 → 用 4-block 中文格式 + 顶部固定指令"):
 *   Restructured to match fei's reference brief format (荡魂山 / 粉色霜玉孔雀
 *   example). 4-block 中文 design brief layout.
 *
 * §2026-05-22 round-3 (fei: "输出始终是电影风格，使用用户选择的风格，
 *   去掉固定的风格描述"):
 *   Round-2 inherited 草帽小蔡's "万能尾缀" verbatim (Kodak Portra 400 / 胶片
 *   颗粒 / 电影剧照 / film-like softness) PLUS hardcoded cinematic Tags
 *   (电影宽幅 16:9 / 浅景深 / 柔光摄影 / 电影剧照质感 / 史诗感构图). For
 *   stylized styles (Ghibli / Pixar / Arcane / Spider-Verse / Wes Anderson),
 *   these vocabularies dragged every output toward photoreal cinema —
 *   the user's chosen style was outvoted 3:1 by hardcoded cinematic
 *   language scattered across subject / tags / tail blocks.
 *
 *   Round-3 fix — STRIPPED all hardcoded cinematic vocabulary:
 *     · cinematicTail (Kodak Portra / 胶片颗粒 / 电影剧照) → qualityLock
 *       (pure style-agnostic anti-noise principles: no hyper-detailed,
 *       no 8K, no intricate — works in 2D/3D/painted/photoreal alike)
 *     · subjectBlock: removed "电影宽幅 16:9" (aspect is set by OpenAI
 *       size param, doesn't need to be in prompt)
 *     · tagsBlock: removed 电影级关键帧 / 史诗感构图 / 浅景深 / 柔光摄影 /
 *       电影剧照质感. Now derives 100% from style.prompt + style.name + mood.
 *     · lightingBlock: changed 浪漫 mood's "浅景深 / 柔和散景" (photoreal
 *       techniques) to "柔和光晕 / 暖色边缘光" (style-agnostic).
 *
 *   Added new styleAnchor block FIRST in the layout (right after reference)
 *   to explicitly anchor the user's chosen style as the SOLE aesthetic
 *   authority — with explicit instruction that 2D/animation styles should
 *   NOT incorporate photo/film vocabulary. Single voice.
 *
 *   Final block order (post round-3):
 *     0. 头部固定指令
 *     1. 【续作连续性】(only if hasReference)
 *     2. 视觉风格锚定 (Style Anchor — ONLY aesthetic authority) ← NEW
 *     3. 主体形象 (Subject)
 *     4. 核心灵物 (Entity)
 *     5. 背景与光影 (Background & Lighting)
 *     6. AI 视觉提示词 (Tags — now derived purely from chosen style)
 *     7. 剧本 BEATS
 *     8. 质感锁 (Quality Lock — style-agnostic anti-noise) ← REPLACES cinematicTail
 *     9. 纯视觉输出 (TEXT-FREE)
 */
/* §2026-05-23 fei — buildStoryboardPrompt v2: multi-panel storyboard sheet.
 *
 *   This function used to produce a SINGLE key-frame cinematic image (one
 *   composition, rendered in the user's chosen style). User asked for the
 *   opposite: a multi-panel STORYBOARD SHEET — a planning artifact with
 *   rough hand-drawn pencil/ink panels in a grid, each showing one shot's
 *   action with annotation overlays.
 *
 *   Output structure mirrors the reference template fei provided:
 *     [STORYBOARD] meta (title/type/aspect/count/grid)
 *     [LOOK] forces rough pencil+ink, no illustration polish
 *     [DETAIL LEVEL] semi-mannequin, gesture-driven
 *     [PACE / MOTION LOGIC] videoType-aware
 *     [COLOR LOGIC] grayscale base + annotation color key
 *     [ANNOTATION KEY] RED=camera BLUE=body GREEN=object ORANGE=impact PURPLE=timing
 *     [ARROW / MARK STYLE] hand-drawn arrow conventions
 *     [WORLD] derived from script.summary
 *     [CAST] derived from character + hasReference
 *     [DIRECTORIAL LANGUAGE] videoType-aware
 *     [OPENING / ENDING LOGIC] shot 1 = hook, last = active payoff
 *     [BOARD RULES] panel numbering, readability
 *     [SHOT NOTE RULES] brief notes per panel
 *     [SEQUENCE FORMAT] per-shot row template
 *     [SEQUENCE] expanded from script.shots
 *     [STYLE FLAVOR] staging hint only (NOT for rendering — keep pencil look)
 *
 *   Decisions (fei §2026-05-23):
 *     · SHOT NAME generated by GPT-image-2 from action context (not pre-baked)
 *     · User-selected style influences STAGING (locations, costumes, mood)
 *       but NOT rendering — panels stay rough pencil regardless
 *     · Reference photo (sequel/continuity) is used for character identity
 *       across panels, still rendered as sketch
 *     · No dialogue bubbles — keep pure visual planning
 *     · All English (cinematic vocabulary is more natural in English)
 */
function buildStoryboardPrompt({ script, style, protagonist, supportingCharacters, hasReference }) {
  const shots = Array.isArray(script?.shots) ? script.shots : [];
  const shotCount = shots.length || 1;
  const summary = script?.summary || '';
  const mood = script?.mood || '';
  const videoType = script?.videoType || 'trailer';

  // §2026-05-31 round-4 — multi-character support. When the Actor's
  //   demographics differ from the transcript's lead, the screenwriter
  //   adds supporting characters to be drawn alongside the protagonist
  //   in the storyboard panels.
  const supports = Array.isArray(supportingCharacters)
    ? supportingCharacters.filter(c => c && (c.name || c.appearance || c.role))
    : [];

  // §2026-05-30 fei — protagonist is the SINGLE source of truth for character
  //   identity here. Old behavior pulled character.description (Vision-extracted
  //   from Actor photo) + characterSeed (UI-typed) which leaked photo identity
  //   into the storyboard panels. Now we read from script.protagonist (output
  //   of the screenwriter LLM) so the panels match the story's character —
  //   even when the user's Actor photo demographics don't.
  //   The `hasReference` flag, when true, means a CHARACTER IDENTITY BOARD
  //   image is attached upstream as visual anchor (NOT the Actor photo).
  const p = protagonist || {};
  const protName        = p.name                    || 'Protagonist';
  const protAge         = p.age                     || 'young-adult';
  const protGender      = p.gender                  || 'unspecified';
  const protRole        = p.role                    || '';
  const protPersonality = p.personality             || '';
  const protOutfit      = p.outfit                  || '';
  const protFeatures    = p.distinguishing_features || '';

  // ─── Compute grid layout ────────────────────────────────────────────
  // 1792x1024 canvas — prefer wider grids (more cols, fewer rows) so each
  // panel maintains a horizontal aspect close to 16:9.
  let grid;
  if (shotCount <= 2)  grid = '2x1';
  else if (shotCount === 3) grid = '3x1';
  else if (shotCount === 4) grid = '2x2';
  else if (shotCount <= 6)  grid = '3x2';
  else if (shotCount <= 8)  grid = '4x2';
  else if (shotCount === 9) grid = '3x3';
  else if (shotCount <= 12) grid = '4x3';
  else grid = `4x${Math.ceil(shotCount / 4)}`;

  // ─── videoType-aware blocks ─────────────────────────────────────────
  const TYPE_LABELS = {
    'trailer':     'TRAILER / FILM PROMO',
    'mv':          'MUSIC VIDEO',
    'short-drama': 'SHORT DRAMA / NARRATIVE',
    'vlog':        'VLOG / LIFESTYLE',
    'art-film':    'ART FILM / CONTEMPLATIVE',
    'product':     'PRODUCT COMMERCIAL',
  };
  const PACE_LOGIC = {
    'trailer':     'This sequence must feel climactic and escalating, building to a hero moment. Favor active transitions over still reveals. Each panel should contain visible momentum or impending action. Almost every panel should have camera energy.',
    'mv':          'This sequence must feel rhythmic and fast-paced, like a music video matched to a beat. Every panel contains visible movement, transformation or camera energy. Continuous motion flow between panels.',
    'short-drama': 'This sequence follows the character\'s emotional journey. Mix moments of action with quiet beats for emotional weight. Each panel should clearly read as a single emotional state or interaction. Camera serves emotion.',
    'vlog':        'This sequence captures casual, everyday moments stitched together. Handheld feel, candid energy, eye-level perspective. Favor real moments over staged poses.',
    'art-film':    'This sequence is contemplative and meditative. Each panel can hold a single still moment of mood or symbolism. Allowed stillness, slow visual rhythm, weight per shot.',
    'product':     'This sequence is a clean commercial flow: hero reveal → feature highlights → lifestyle context → benefit moment → final CTA frame. Each panel has polished, considered composition with the product clearly readable.',
  };
  const DIRECTORIAL_LANGUAGE = {
    'trailer':     'Use clearly cinematic framing with strong shot variety and progressive escalation. Favor push-throughs, fast arcs, low angles, overhead spins, profile drifts, foreground wipes and near-lens passes. Begin with an immediate hook. End with a hero shot.',
    'mv':          'Use rhythmic music-video framing. Favor profile drifts, overhead spins, near-lens passes, foreground wipes, dutch tilts at motion peaks, silhouette-strong staging. Each shot reads in under a second.',
    'short-drama': 'Use narrative cinematic framing. Favor over-the-shoulder, medium-close conversation framing, reaction-shot cuts, environmental wide shots that set emotional context. Restrained camera language that serves the actor.',
    'vlog':        'Use handheld, eye-level framing. Favor talking-head close-ups, B-roll inserts of environment/objects, candid reactions. Loose camera energy, real-world rhythm.',
    'art-film':    'Use symmetrical or precise rule-of-thirds framing. Favor long focal lengths, symbolic compositional elements (window frames, doorways, reflections, shadows), generous negative space. Allow stillness — atmosphere over action.',
    'product':     'Use clean commercial framing. Favor hero-product center compositions, feature close-ups, lifestyle context wides, controlled lighting setups. Each panel has the polish of a commercial pitch board.',
  };
  const typeLabel       = TYPE_LABELS[videoType] || TYPE_LABELS.trailer;
  const paceLogic       = PACE_LOGIC[videoType]  || PACE_LOGIC.trailer;
  const directorialLang = DIRECTORIAL_LANGUAGE[videoType] || DIRECTORIAL_LANGUAGE.trailer;

  // ─── [STORYBOARD] meta block ────────────────────────────────────────
  const titleHint = summary
    ? summary.split(/[.。!?！？\n]/)[0].slice(0, 60).trim().toUpperCase()
    : 'UNTITLED STORYBOARD';
  const storyboardMeta = `[STORYBOARD]:
TITLE: ${titleHint}
TYPE: ${typeLabel}
ASPECT RATIO: 16:9
PANEL COUNT: ${shotCount}
GRID: ${grid}`;

  // ─── [LOOK] block — forces rough pencil/ink regardless of user style ─
  const lookBlock = `[LOOK]:
Create a rough cinematic storyboard focused entirely on planning, staging and motion readability rather than illustration quality.
Use loose hand-drawn pencil and ink strokes, quick construction lines, gesture drawing and simplified masses.
Characters and environments should be built from basic forms rather than finished drawings.
Keep characters semi-abstract with minimal facial information and simplified costumes.
Indicate environments rather than illustrating them.
Allow rough unfinished strokes, broken lines, visible construction and sketch overlap.
Do not clean the drawing.
Prioritize timing, motion, staging and readability over appearance.
Avoid texture rendering, materials, lighting nuance, clothing folds, decorative linework and production illustration quality.
The storyboard should feel like rough animation thumbnails, action planning boards, animatic preparation sketches and first-pass previs notes — NOT concept art.`;

  // ─── [DETAIL LEVEL] ─────────────────────────────────────────────────
  const detailBlock = `[DETAIL LEVEL]:
low-to-medium detail
semi-mannequin characters
gesture-driven poses
strong silhouette readability`;

  // ─── [PACE / MOTION LOGIC] ──────────────────────────────────────────
  const paceBlock = `[PACE / MOTION LOGIC]:
${paceLogic}`;

  // ─── [COLOR LOGIC] ──────────────────────────────────────────────────
  const colorBlock = `[COLOR LOGIC]:
Keep the base storyboard grayscale.
All annotations must follow the color key below.`;

  // ─── [ANNOTATION KEY] ───────────────────────────────────────────────
  const annotationKeyBlock = `[ANNOTATION KEY]:
RED = camera / lens / framing / camera movement
BLUE = body movement / path / turn / jump / fall / pose flow
GREEN = object movement / shape formation / transformation flow
ORANGE = burst / snap / impact / vibration / visual accent
PURPLE = timing / acceleration / hold / speed change`;

  // ─── [ARROW / MARK STYLE] ───────────────────────────────────────────
  const arrowStyleBlock = `[ARROW / MARK STYLE]:
Draw annotation arrows and marks as visible production notes over the storyboard.
Use thin hand-drawn arrows rather than clean vector graphics.
Use curved arrows for spins, arcs, turns, orbital motion.
Use straight arrows for direct movement and push-in direction.
Use dashed arrows for anticipated motion and trailing continuation.
Keep annotations readable and functional.
Do not cover face, hands or key silhouette reads.`;

  // ─── [WORLD] — derived from script summary + mood ───────────────────
  const worldBlock = `[WORLD]:
${summary
  ? `Setting derived from the story: ${summary.trim()}`
  : 'Setting derived from the shot beats below.'}
${mood ? `Mood / atmosphere: ${mood}.` : ''}
Keep the world indicated rather than illustrated — minimum shapes needed for spatial orientation and interaction with the action.`;

  // ─── [CHARACTER SEED] + [CAST] ──────────────────────────────────────
  // §2026-05-30 fei — rewritten to consume protagonist (from screenwriter)
  //   instead of character/characterSeed. Sourced from the story, not the
  //   Actor photo, so storyboard panels match the script's character even
  //   when the user's photo demographics diverge.
  //
  //   When hasReference=true, the attached image is the CHARACTER IDENTITY
  //   BOARD (generated in the previous step from the same protagonist),
  //   NOT the raw Actor photo. The board fixes the canonical look; the
  //   storyboard panels reproduce that look across the sequence.
  const characterSeedBlock = [
    `[CHARACTER SEED]: ${protName}${protRole ? `, ${protRole}` : ''}${protPersonality ? ` — ${protPersonality}` : ''}.`,
    `[AGE / GENDER / BODY TYPE]: ${protAge}${protGender !== 'unspecified' ? `, ${protGender}` : ''}, proportions appropriate to ${protRole || 'the role'}.`,
    protOutfit   ? `[OUTFIT]: ${protOutfit}.` : null,
    protFeatures ? `[DISTINGUISHING FEATURES]: ${protFeatures}.` : null,
    `[VISUAL MEDIUM]: rough storyboard pencil sketch — keep the panels as planning thumbnails, not finished illustration.`,
    style?.prompt
      ? `[STYLE FLAVOR]: ${style.prompt} — staging hint only; panels stay as pencil sketches.`
      : `[STYLE FLAVOR]: consistent with the story's genre and mood — staging hint only; panels stay as pencil sketches.`,
  ].filter(Boolean).join('\n');

  // §2026-05-31 round-4 — supporting characters block. When supports
  //   is non-empty, the storyboard MUST render these additional people
  //   interacting with the protagonist in the relevant panels. Each is
  //   described enough that the rough pencil sketch can distinguish them
  //   by silhouette + age + key visual features.
  const supportingCastBlock = supports.length > 0
    ? '\n\nSupporting characters appearing in this story (DRAW these alongside the protagonist in the relevant panels):\n' +
      supports.map((c, i) => {
        const bits = [];
        if (c.name)       bits.push(c.name);
        if (c.age)        bits.push(c.age);
        if (c.gender && c.gender !== 'unspecified') bits.push(c.gender);
        if (c.role)       bits.push(`role: ${c.role}`);
        if (c.appearance) bits.push(`appearance: ${c.appearance}`);
        if (c.outfit)     bits.push(`outfit: ${c.outfit}`);
        if (c.relationship_to_protagonist) bits.push(`relationship: ${c.relationship_to_protagonist}`);
        if (c.interaction) bits.push(`interaction: ${c.interaction}`);
        return `  ${i + 1}. ${bits.join(' · ')}`;
      }).join('\n') +
      '\nThese supporting characters must be visibly DISTINCT from the protagonist (different silhouette / age / costume — easy to tell apart at a glance). Draw them whenever the panel\'s action involves them.'
    : '';

  const castBlock = hasReference
    ? `[CAST]:
PROTAGONIST is FULLY DEFINED by the attached CHARACTER IDENTITY BOARD reference image.
Reproduce the SAME person across every panel:
  • Same age band (${protAge}) and body type
  • Same costume silhouette${protOutfit ? ` (${protOutfit})` : ''}
  • Same distinguishing features${protFeatures ? ` (${protFeatures})` : ''}
Render in rough pencil sketch — NOT the polished art style of the reference.
Vary pose and expression by shot intent; the protagonist is consistent across all panels.
DO NOT borrow protagonist identity traits from any source other than this reference board — the board is canonical for the protagonist.${supportingCastBlock}`
    : `[CAST]:
PROTAGONIST (see [CHARACTER SEED] above) appears in every panel.
Preserve identity — age band (${protAge}), body type, costume silhouette${protOutfit ? ` (${protOutfit})` : ''}, hair/features${protFeatures ? ` (${protFeatures})` : ''} — across the full sheet.
Vary pose and expression by shot intent.${supportingCastBlock}`;

  // ─── [DIRECTORIAL LANGUAGE] ─────────────────────────────────────────
  const directorialBlock = `[DIRECTORIAL LANGUAGE]:
${directorialLang}
Use clearly cinematic framing with strong shot variety. Avoid repeated camera angles unless intentional. The board should feel like premium previs with strong silhouette design and continuous shape evolution between panels.`;

  // ─── [OPENING / ENDING LOGIC] ───────────────────────────────────────
  const openingEndingBlock = `[OPENING / ENDING LOGIC]:
Panel 1 = IMMEDIATE HOOK — open with motion or visual intrigue, not a calm establishing shot (exception: art-film, where stillness IS the intrigue).
Middle panels = CONTINUOUS ESCALATION — each panel raises visual energy, scale, or emotional stakes above the previous one. No plateaus.
Final panel = ACTIVE PAYOFF — close on the central image while still feeling alive (residual motion, particles, breath, lingering action). Avoid calm dissolves unless genre demands.`;

  // ─── [BOARD RULES] ──────────────────────────────────────────────────
  const boardRulesBlock = `[BOARD RULES]:
Use large readable panel numbers in the top-left corner of each panel.
Each panel includes a short SHOT NAME (all caps, 1-3 words) hand-lettered in the panel header area.
Each panel must show one clear action beat.
Preserve spatial continuity across the sequence — same character, same world, evolving moments.
Avoid repeated camera angles unless intentional.
Keep the sheet readable at a glance.
No spoken-dialogue subtitles, no logos, no watermarks, no decorative UI — just panel number, SHOT NAME header, and the in-panel annotations from the [ANNOTATION KEY].`;

  // ─── [SHOT NOTE RULES] ──────────────────────────────────────────────
  const shotNoteRulesBlock = `[SHOT NOTE RULES]:
Each panel includes a short hand-lettered SHOT NOTE (one brief sentence) explaining purpose, transition value or visual idea.
Keep notes brief and human — like a director's marginalia, not a formal caption.`;

  // ─── [SEQUENCE FORMAT] ──────────────────────────────────────────────
  // §2026-05-23 fei: instruct the model to GENERATE the SHOT NAME from the
  //   action context (decision 1.1) — we don't pre-bake names because the
  //   screenwriter doesn't produce them, and auto-extracting from action
  //   tends to read mechanical.
  const sequenceFormatBlock = `[SEQUENCE FORMAT]:
For each panel render the following layout:
  [NUMBER] - [SHOT NAME]      ← invent a short evocative all-caps name from the action below
  SHOT NOTE: [short cinematic note — 1 sentence]
  camera: [framing + movement, with RED annotation arrows in the panel]
  action: [what happens, with BLUE/GREEN annotation arrows for body/object motion]
  focus:  [the panel's purpose: hook / escalation / transition / reveal / payoff]
------------------------------------------------`;

  // ─── [SEQUENCE] — expand script.shots ───────────────────────────────
  const sequenceItems = shots.map((s, i) => {
    const num = i + 1;
    const positionFocus = i === 0
      ? 'Immediate hook — establish energy and mystery in motion.'
      : i === shotCount - 1
        ? 'Active payoff — iconic final image, still alive with residual motion.'
        : 'Escalation — raise visual stakes above previous panel.';
    const lines = [`PANEL ${num} of ${shotCount}`];
    if (s.action)  lines.push(`  Action: ${s.action}`);
    if (s.camera)  lines.push(`  Camera hint: ${s.camera}`);
    lines.push(`  Position purpose: ${positionFocus}`);
    return lines.join('\n');
  }).join('\n\n');
  const sequenceBlock = `[SEQUENCE]:
${sequenceItems || '(No shot data — improvise a coherent sequence based on TITLE and WORLD.)'}`;

  // ─── [STYLE FLAVOR] — staging hint only, NOT for rendering ──────────
  const stylePromptStr = style?.prompt || '';
  const styleNameStr   = style?.name   || '';
  const styleFlavorBlock = (stylePromptStr || styleNameStr)
    ? `[STYLE FLAVOR — staging hint ONLY, NOT for rendering]:
The final video will eventually be rendered in: ${styleNameStr}${stylePromptStr ? ` — ${stylePromptStr}` : ''}.
Let this inform STAGING decisions (location archetypes, costume silhouettes, prop choices, atmosphere mood) so the storyboard hints at the final aesthetic.
But DO NOT render the storyboard panels in this style — keep them as rough hand-drawn pencil/ink sketches per the [LOOK] block above. The storyboard is a planning artifact, not a finished piece.`
    : '';

  // ─── Compose full prompt ────────────────────────────────────────────
  return [
    storyboardMeta,
    lookBlock,
    detailBlock,
    paceBlock,
    colorBlock,
    annotationKeyBlock,
    arrowStyleBlock,
    worldBlock,
    characterSeedBlock,  // §2026-05-23 fei: 5-field character seed (added)
    castBlock,
    directorialBlock,
    openingEndingBlock,
    boardRulesBlock,
    shotNoteRulesBlock,
    sequenceFormatBlock,
    sequenceBlock,
    styleFlavorBlock,
  ].filter(Boolean).join('\n\n');
}

/* §2026-05-25 fei — buildCharacterBoardPrompt: CHARACTER IDENTITY BOARD.
 *
 *   Sibling of buildStoryboardPrompt above. While the storyboard sheet is
 *   a multi-panel rough pencil planning artifact, the character board is
 *   a single polished character-design reference — face/costume/proportion
 *   sheet rendered IN the user's chosen art style.
 *
 *   Use case: shown in Step 3 alongside the storyboard for user QA, and
 *   becomes the AUTHORITATIVE character reference (Image 1) sent to
 *   Seedance for video gen, AND the reference input to the storyboard
 *   generation step that follows it.
 *
 *   §2026-05-30 fei round-2 — actor-as-protagonist design.
 *
 *   The Actor photo (when uploaded) IS the protagonist. Always used as
 *   facial inspiration — no demographic-match gating. The screenwriter
 *   has already set protagonist.{age,gender,outfit,...} to reflect the
 *   Actor's identity, so the protagonist object and the photo are aligned
 *   by construction. Demographics-matching policy (round-1, briefly
 *   enabled) is removed — was based on the wrong assumption that protagonist
 *   could diverge from the photo.
 *
 *   "Inspired by, not copied" wording for OpenAI safety still matters
 *   (real-person-likeness moderation). Otherwise photo is a strong
 *   facial reference, with the protagonist field providing the structured
 *   age/gender/outfit/etc that the photo's freeform description doesn't.
 */
function buildCharacterBoardPrompt({ protagonist, actor, style, hasReference }) {
  // Defensive defaults — caller should pass a fully-populated protagonist
  //   (server + frontend normalizers guarantee this), but guard anyway so
  //   a stray null doesn't crash GPT-image-2 prompt assembly.
  // §2026-05-31 fei round-3 — actor adds the user-named Avatar + Vision
  //   description so the model has concrete photo-side anchors (not just
  //   the abstract protagonist age/gender/role).
  const p = protagonist || {};
  const a = actor       || {};

  // Prefer the Actor's real name (user-given) over the LLM-invented
  //   protagonist.name. The screenwriter's "Maya" / etc. was breaking
  //   immersion by appearing on the user's own character board.
  const charName     = a.name                    || p.name                    || 'Protagonist';
  const ageBand      = p.age                     || 'young-adult';
  const gender       = p.gender                  || 'unspecified';
  const role         = p.role                    || '';
  const personality  = p.personality             || '';
  const outfit       = p.outfit                  || '';
  const features     = p.distinguishing_features || '';
  const emotionalArc = p.emotional_arc           || '';

  // Actor's freeform facial description from Vision (identity_features
  //   column — e.g. "年轻男性，约 28 岁，短发偏黑，方脸轮廓，浓眉，皮肤偏白").
  //   Concrete photo-side anchor that the abstract protagonist fields lack.
  const actorDescription = a.description || '';

  const styleName     = style?.name     || 'cinematic';
  const stylePrompt   = style?.prompt   || '';
  const styleClothing = style?.clothing || '';

  // §2026-05-31 round-3 — opener rewrite.
  //   OLD (broken): "创建一个完全原创、版权安全的角色，面部特征灵感参考..."
  //     "完全原创" (entirely original) told the model to ignore the reference.
  //     Result: GPT generated a stranger and hand-lettered the LLM-invented
  //     name "Maya" on it. Catastrophic for user trust.
  //   NEW: "stylized portrait of the same person from the reference photo".
  //     This is moderation-safe (no "exact match" / "replica") but firmly
  //     anchors the output to the user's actor. The safety-fallback path
  //     (real-person rejection) still catches edge cases.
  const opener = hasReference
    ? `基于所附 Actor 照片中的人物，制作一张「${styleName}」艺术风格化的角色身份设定图 (CHARACTER IDENTITY BOARD)。这是同一个人物的风格化呈现 —— 不是一个新角色。观众应能从这张图清楚地认出照片中的那个人。`
    : `创建一个角色身份设定图 (CHARACTER IDENTITY BOARD)，呈现为「${styleName}」艺术风格。`;

  // §2026-05-31 — explicit "preserve from reference" block, paired with
  //   the opener. The "do" counterpart of the moderation-safe language.
  const referencePolicyBlock = hasReference
    ? `[参考照片处理 (REFERENCE PHOTO HANDLING)]：
忠实保留所附照片中人物的:
  · 面部结构（脸型轮廓、五官比例、五官位置关系）
  · 发型轮廓和发色基调
  · 体型和身材比例
  · 整体气质和神态
将上述特征转换/重绘为「${styleName}」艺术风格的呈现方式。
注意：是同一个人物，只是换了艺术风格 —— 而不是另一个长得有点像的人。`
    : '';

  // Actor's freeform description supplements the structured protagonist
  //   fields with photo-side detail. Optional — only included when present.
  const actorDescriptionBlock = (hasReference && actorDescription)
    ? `[照片人物描述 (PHOTO SUBJECT DESCRIPTION — from Vision)]：
${actorDescription}`
    : '';

  // Costume direction — combine protagonist.outfit (from screenwriter,
  //   reflects Actor's wardrobe direction adapted to the scene) with the
  //   style's clothing hint (e.g. "vintage tailored suit + bow tie" for
  //   Wes Anderson). protagonist.outfit wins when both speak.
  const costumeLine = outfit
    ? `Costume / wardrobe direction: ${outfit}${styleClothing ? ` (style accent: ${styleClothing})` : ''}.`
    : (styleClothing ? `Costume / wardrobe direction: ${styleClothing}.` : 'Costume / wardrobe direction: story-appropriate.');

  return [
    opener,
    '',
    referencePolicyBlock || null,
    referencePolicyBlock ? '' : null,
    actorDescriptionBlock || null,
    actorDescriptionBlock ? '' : null,
    `[角色身份 (CHARACTER IDENTITY)]：`,
    `Name: ${charName}.`,
    `Age band: ${ageBand}.`,
    `Gender: ${gender}.`,
    role         ? `Social role in this story: ${role}.`            : null,
    personality  ? `Personality tone: ${personality}.` : null,
    features     ? `Distinguishing features: ${features}.` : null,
    emotionalArc ? `Emotional arc context: ${emotionalArc}.` : null,
    '',
    `[艺术风格 (ART STYLE)]：`,
    `Render the entire board in: ${styleName}${stylePrompt ? ` — ${stylePrompt}` : ''}.`,
    costumeLine,
    '',
    `[板面布局 (BOARD LAYOUT)]：`,
    `A single horizontal character-design board, like a model sheet from an animation production bible.`,
    `Compose the canvas with: (a) one full-body hero pose centered, (b) a front-view face close-up upper-left, (c) a three-quarter-view face study upper-right, (d) costume / wardrobe callouts and color swatches along the bottom.`,
    `Hand-letter the character name "${charName}" in the top margin.`,
    `Annotate proportions, costume details and color palette like a real character bible page.`,
    '',
    `[渲染要求 (RENDERING REQUIREMENTS)]：`,
    `Polished, production-ready character design — NOT a rough sketch. This is the canonical reference everyone (artists, animators, future video gens) will use.`,
    `Show the character clearly enough to recognize across future shots: face structure, hair shape, costume silhouette, distinctive accessories, color palette.`,
    hasReference
      ? `CRITICAL: the character on this board MUST be visibly recognizable as the same person from the reference photo (face structure + hair shape + body type), just rendered in the chosen art style. NOT a different person who happens to share demographics.`
      : null,
    `Neutral studio background so the character reads clearly.`,
    `Aspect ratio 16:9. No dialogue, no logos, no watermarks — just the character board.`,
  ].filter(line => line !== null).join('\n');
}

/* Maps an "elevation" (0..MAX) to the next Lite purchase price.
 * Elevation 0 = $3.99 (entry), 1 = $5.99, 2 = $7.99 (cap).
 * See computeLiteElevation() for how elevation grows + decays. */
function getLitePriceCentsForElevation(elevation) {
  const idx = Math.min(Math.max(elevation, 0), LITE_PRICE_TIERS_CENTS.length - 1);
  return LITE_PRICE_TIERS_CENTS[idx];
}

/* ─── system_settings cache + getter ───────────────────────────────────
 *
 * Reads from public.system_settings (created in migration
 * 20260514_system_settings.up.sql). Module-level cache with 60s TTL so
 * the same Worker isolate doesn't hammer the DB on every request.
 * Cache is per-isolate so changes propagate within ~1 minute globally
 * after an admin update.
 *
 * Fail-open semantics: if the DB is unreachable, return the default
 * value. This protects checkout flows from breaking on a transient
 * Postgres issue.
 */
const _systemSettingsCache = new Map();  // key → { value, expiresAt }
const SYSTEM_SETTINGS_CACHE_TTL_MS = 60_000;

async function getSystemSetting(env, key, defaultValue) {
  const cached = _systemSettingsCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.value;

  const supabaseUrl = env.SUPABASE_URL || 'https://wjhdsodlxekvhpahascs.supabase.co';
  try {
    const r = await fetch(
      `${supabaseUrl}/rest/v1/system_settings?key=eq.${encodeURIComponent(key)}&select=value`,
      {
        headers: {
          'Authorization': `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
          'apikey': env.SUPABASE_SERVICE_ROLE_KEY,
        }
      }
    );
    if (!r.ok) {
      // §2026-05-15 loud-fail: fail-open by design (returning defaultValue
      // keeps checkout flows working if DB is sick) but escalate so the
      // failure is visible in CF Worker Logs / alerting. Without this,
      // schema drift on system_settings would silently lock admins out
      // of runtime config changes.
      const errBody = await r.text().catch(() => '(unreadable)');
      console.error(`[system-settings] read non-OK for "${key}"`, 'status=' + r.status, 'body=' + errBody.slice(0, 200), '— FAIL-OPEN: using default', defaultValue);
      return defaultValue;
    }
    const rows = await r.json();
    const value = (Array.isArray(rows) && rows.length > 0) ? rows[0].value : defaultValue;
    _systemSettingsCache.set(key, { value, expiresAt: Date.now() + SYSTEM_SETTINGS_CACHE_TTL_MS });
    return value;
  } catch (e) {
    console.error(`[system-settings] read exception for "${key}":`, e.message, '— FAIL-OPEN: using default', defaultValue);
    return defaultValue;
  }
}

/* Invalidate a single key's cache. Called when admin updates a setting
 * via /api/admin/system-settings/update so the new value is visible on
 * the next read within this isolate (others get it after TTL). */
function invalidateSystemSettingCache(key) {
  _systemSettingsCache.delete(key);
}

/* ─── §2026-05-29 fei — 服务端积分(token)helpers ──────────────────────────
 *
 * 模块级函数(像 getSystemSetting),显式传 env。【必须】放模块级而非 fetch
 * body 内 const:各端点是独立 `if (pathname){...; return}` 顺序块,fetch body
 * 内靠后定义的 const 对靠前端点处于 TDZ(用不了)。模块级函数被 hoist,处处可用。
 *
 * 权威余额在 public.user_credits(RLS 只读自己,无写策略)。增减只走 RPC
 * spend_credits/grant_credits(SECURITY DEFINER + FOR UPDATE,service_role)。
 * 详见 migration 20260529000001/2 + docs/engineering/credit-enforcement-design.md
 */

// 内部:调 service_role RPC。返回 {ok, json}。
async function _creditRpc(env, fnName, payload) {
  const supabaseUrl = env.SUPABASE_URL || 'https://wjhdsodlxekvhpahascs.supabase.co';
  const r = await fetch(`${supabaseUrl}/rest/v1/rpc/${fnName}`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
      'apikey': env.SUPABASE_SERVICE_ROLE_KEY,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });
  let json = null;
  try { json = await r.json(); } catch { json = null; }
  return { ok: r.ok, json };
}

// 解析 Authorization JWT → 用户。无/无效 → 抛 Error(.httpStatus=401),端点 catch 转 401。
async function requireUser(request, env) {
  const supabaseUrl = env.SUPABASE_URL || 'https://wjhdsodlxekvhpahascs.supabase.co';
  const authHeader = request.headers.get('Authorization');
  if (!authHeader) { const e = new Error('Authentication required'); e.httpStatus = 401; throw e; }
  const r = await fetch(`${supabaseUrl}/auth/v1/user`, {
    headers: { 'Authorization': authHeader, 'apikey': env.SUPABASE_ANON_KEY || '' }
  });
  if (!r.ok) { const e = new Error('Invalid session'); e.httpStatus = 401; throw e; }
  const u = await r.json().catch(() => null);
  if (!u?.id) { const e = new Error('Invalid session'); e.httpStatus = 401; throw e; }
  return { id: u.id, email: u.email || null, tier: u?.user_metadata?.tier || 'free', meta: u.user_metadata || {} };
}

// 原子扣费。成功返回 {success,balance_after,spent,credit_tx_id};余额不足抛
// Error(.httpStatus=402, .insufficient=true, .required, .current)。RPC 故障抛 500-级。
async function creditSpend(env, userId, amount, txType, reference, description) {
  const { ok, json } = await _creditRpc(env, 'spend_credits', {
    p_user_id: userId, p_amount: amount, p_tx_type: txType,
    p_reference: reference || null, p_description: description || null,
  });
  if (!ok) throw new Error('spend_credits RPC failed: ' + JSON.stringify(json).slice(0, 200));
  if (json && json.insufficient) {
    const e = new Error(`Insufficient credits (need ${json.required}, have ${json.current})`);
    e.httpStatus = 402; e.insufficient = true; e.required = json.required; e.current = json.current; throw e;
  }
  if (!json || !json.success) throw new Error('spend_credits failed: ' + JSON.stringify(json).slice(0, 200));
  return json;
}

// 原子加币/退款(可幂等)。best-effort:失败只 log 返回 null,不抛(避免阻断主流程)。
async function creditGrant(env, userId, amount, txType, reference, idempotencyKey, description) {
  try {
    const { ok, json } = await _creditRpc(env, 'grant_credits', {
      p_user_id: userId, p_amount: amount, p_tx_type: txType,
      p_reference: reference || null, p_idempotency_key: idempotencyKey || null,
      p_description: description || null,
    });
    if (!ok || !json?.success) { console.error('[credits] grant_credits non-OK', JSON.stringify(json).slice(0, 200)); return null; }
    return json; // {success, balance_after, credited?, idempotent?, credit_tx_id}
  } catch (e) { console.error('[credits] grant_credits exception', e.message); return null; }
}

// 冷路径过渡镜像:把权威余额写回 user_metadata.tokens+credits(best-effort,rollback 保险)。
async function mirrorBalanceToMeta(env, userId, balance, currentMeta) {
  const supabaseUrl = env.SUPABASE_URL || 'https://wjhdsodlxekvhpahascs.supabase.co';
  try {
    await fetch(`${supabaseUrl}/auth/v1/admin/users/${userId}`, {
      method: 'PUT',
      headers: {
        'Authorization': `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
        'apikey': env.SUPABASE_SERVICE_ROLE_KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ user_metadata: { ...(currentMeta || {}), tokens: balance, credits: balance } }),
    });
  } catch (e) { console.error('[credits] mirror to user_metadata failed', e.message); }
}

// 服务端权威视频成本(镜像 StoryGeneratorPage computeFreeModeCredits)。
async function computeVideoCost(env, resolution, duration, modelId) {
  const CREDITS_PER_SEC = { '480p': 4, '720p': 6, '1080p': 12 };
  const standardEndpoint = await getSystemSetting(env, 'seedance_standard_endpoint', 'ep-20260507184058-tpr79');
  const fastMul = Number(await getSystemSetting(env, 'seedance_fast_cost_multiplier', '1.0')) || 1.0;
  const stdMul = Number(await getSystemSetting(env, 'seedance_standard_cost_multiplier', '1.5')) || 1.5;
  const mul = (modelId && modelId === standardEndpoint) ? stdMul : fastMul;
  const base = (CREDITS_PER_SEC[resolution || '480p'] || 6) * (duration || 5);
  return Math.ceil(base * mul);
}

/* §2026-06-05 模型感知的 resolution 校正。
 *   BytePlus Seedance 2.0 **Fast** (dreamina-seedance-2-0-fast) 只支持
 *   480p/720p,**不支持 1080p**;**Standard** (dreamina-seedance-2-0) 才支持
 *   到 1080p。该限制是模型级、跨 t2v/i2v/r2v 所有模式 —— BytePlus 报错里
 *   带 "in r2v" 只是因为当次请求恰好用了视频参考。
 *
 *   旧实现前端只按会员 tier 放开档位(creator/studio = 1080p),不看模型,
 *   于是「默认 Fast 模型 + 1080p」必然被 BytePlus 拒(InvalidParameter:
 *   "the parameter resolution ... is not valid for model
 *   dreamina-seedance-2-0-fast in r2v")。这里在提交前把 resolution clamp
 *   到模型支持的最高档,并让**计费用生效后的 resolution**(避免按 1080p 多扣
 *   却只产出 720p)。
 *
 *   max-resolution 可经 system_settings 覆盖,使端点轮换 / 新模型解锁 1080p
 *   时无需改代码: seedance_fast_max_resolution(默认 720p)/
 *   seedance_standard_max_resolution(默认 1080p)。 */
const RES_RANK = { '480p': 1, '720p': 2, '1080p': 3 };
async function resolveModelMaxResolution(env, modelId) {
  const fastEndpoint = await getSystemSetting(env, 'seedance_fast_endpoint', 'ep-20260507183959-d7mr2');
  const standardEndpoint = await getSystemSetting(env, 'seedance_standard_endpoint', 'ep-20260507184058-tpr79');
  if (modelId && modelId === standardEndpoint) {
    return await getSystemSetting(env, 'seedance_standard_max_resolution', '1080p');
  }
  if (modelId && modelId === fastEndpoint) {
    return await getSystemSetting(env, 'seedance_fast_max_resolution', '720p');
  }
  // 未知模型(admin 新加的端点):permissive,不 clamp —— 不替不认识的模型
  // 设上限,以免误挡未来支持 1080p 的新模型。已知 Fast/Standard 才生效。
  return '1080p';
}
function clampResolutionToMax(requested, maxRes) {
  const req = requested || '480p';
  const reqRank = RES_RANK[req] || RES_RANK['480p'];
  const maxRank = RES_RANK[maxRes] || RES_RANK['1080p'];
  return reqRank > maxRank ? maxRes : req;
}

/* Module-level cache: derives Stripe product ID from the existing
 * STRIPE_PRICE_LITE_TRIAL on first use. Cloudflare Workers reuse module
 * scope across requests within the same execution context, so this
 * usually hits the cache after the first cold-start request.            */
let _cachedLiteProductId = null;

async function getLiteProductId(env) {
  if (_cachedLiteProductId) return _cachedLiteProductId;
  if (!env.STRIPE_PRICE_LITE_TRIAL) {
    throw new Error('STRIPE_PRICE_LITE_TRIAL not configured — cannot derive Lite product ID for ad-hoc pricing');
  }
  if (!env.STRIPE_SECRET_KEY) throw new Error('STRIPE_SECRET_KEY not configured');
  const r = await fetch(`https://api.stripe.com/v1/prices/${env.STRIPE_PRICE_LITE_TRIAL}`, {
    headers: { 'Authorization': `Bearer ${env.STRIPE_SECRET_KEY}` }
  });
  if (!r.ok) {
    const t = await r.text().catch(() => '');
    throw new Error(`Stripe Price lookup failed (${r.status}): ${t.slice(0, 200)}`);
  }
  const data = await r.json();
  if (!data.product) {
    throw new Error('Stripe Price has no product field — corrupt STRIPE_PRICE_LITE_TRIAL config?');
  }
  _cachedLiteProductId = data.product;
  return _cachedLiteProductId;
}

/* ─── Lite price elevation (with time-decay cooldown) ──────────────────
 *
 * Returns the user's current "elevation" — an integer index into
 * LITE_PRICE_TIERS_CENTS that determines what they'd pay on the NEXT
 * Lite purchase. Designed by Leon/fei 2026-05-14 to discourage runaway
 * stacking while letting prices come back down over time.
 *
 * Mechanics:
 *   - Start at elevation 0 (next price = $3.99)
 *   - Each completed Lite purchase: elevation += 1, capped at len-1 (= 2)
 *   - Between consecutive purchases: elevation -= floor(gap / cooldown)
 *     (so a 6-hour gap with 3h cooldown decays 2 steps)
 *   - After the last purchase: same decay rule applied to (now - last)
 *   - Elevation floor = 0, ceiling = LITE_PRICE_TIERS_CENTS.length - 1
 *
 * Cooldown duration: from system_settings.lite_price_cooldown_hours
 * (admin-configurable, default 3 hours). 0 disables decay (legacy
 * monotonic-count behavior).
 *
 * Fail-safe: on DB read error returns elevation 0 (= $3.99 floor).
 * Under-charging is preferable to refusing the sale or charging more
 * than the user expects. */
async function computeLiteElevation(env, userId) {
  const supabaseUrl = env.SUPABASE_URL || 'https://wjhdsodlxekvhpahascs.supabase.co';

  // 1) Load cooldown setting (admin-configurable)
  const cooldownHoursRaw = await getSystemSetting(env, 'lite_price_cooldown_hours', '3');
  const cooldownHours = Math.max(0, parseFloat(cooldownHoursRaw) || 0);
  const cooldownMs = cooldownHours * 3_600_000;
  const maxElevation = LITE_PRICE_TIERS_CENTS.length - 1;

  // 2) Pull all the user's successful Lite purchases, oldest first.
  //    Need createdAt timestamps — count alone isn't enough for decay.
  let purchases = [];
  try {
    const r = await fetch(
      `${supabaseUrl}/rest/v1/orders?` +
      `userId=eq.${encodeURIComponent(userId)}` +
      `&subject=ilike.UVERA lite*` +
      `&status=eq.1` +
      `&refunded_at=is.null` +
      `&voided_at=is.null` +
      `&select=createdAt` +
      `&order=createdAt.asc`,
      {
        headers: {
          'Authorization': `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
          'apikey': env.SUPABASE_SERVICE_ROLE_KEY,
        }
      }
    );
    if (!r.ok) {
      // §2026-05-15 loud-fail: fail-open returning 0 (= $3.99 cheapest tier)
      // is preferable to refusing the sale, but log loud so PostgREST or
      // schema problems are visible.
      const errBody = await r.text().catch(() => '(unreadable)');
      console.error('[lite-elevation] query non-OK', 'status=' + r.status, 'userId=' + userId, 'body=' + errBody.slice(0, 200), '— FAIL-OPEN: returning elevation 0');
      return 0;
    }
    purchases = await r.json();
  } catch (e) {
    console.error('[lite-elevation] exception:', e.message, 'userId=' + userId, '— FAIL-OPEN: returning elevation 0');
    return 0;
  }

  if (!Array.isArray(purchases) || purchases.length === 0) return 0;

  // 3) Walk through purchases chronologically: each one bumps elevation
  //    (capped); each gap decays it (floored at 0).
  let elevation = 0;
  let lastT = null;
  for (const p of purchases) {
    const t = p.createdAt ? new Date(p.createdAt).getTime() : null;
    if (!t || Number.isNaN(t)) continue;
    if (lastT !== null && cooldownMs > 0) {
      const gap = t - lastT;
      const decay = Math.floor(gap / cooldownMs);
      elevation = Math.max(0, elevation - decay);
    }
    elevation = Math.min(maxElevation, elevation + 1);
    lastT = t;
  }

  // 4) Final decay: from the most recent purchase to now.
  //    If cooldownMs === 0 (admin disabled decay), elevation is locked
  //    at the post-last-purchase value — monotonic count semantics.
  if (lastT !== null && cooldownMs > 0) {
    const gap = Date.now() - lastT;
    const decay = Math.floor(gap / cooldownMs);
    elevation = Math.max(0, elevation - decay);
  }

  return elevation;
}

/* ─── Stripe deep order fetcher ────────────────────────────────────────
 *
 * For admin order detail drawer. Resolves an orderNo (in_xxx invoice or
 * cs_xxx checkout session) into a rich tree of Stripe objects:
 *
 *   {
 *     type: 'invoice' | 'checkout_session',
 *     invoice?: { ... },           // when in_xxx
 *     session?: { ... },           // when cs_xxx
 *     payment_intent: { ... },     // status, amount, charges, last_payment_error
 *     charge: { ... },             // most recent charge with refunds + receipt
 *     payment_method: { ... },     // card brand, last4, exp, country
 *     customer: { ... },           // Stripe customer object
 *     refunds: [ ... ],            // refund list for this charge
 *   }
 *
 * Each leaf fetch is wrapped in try/catch — partial data is better than
 * none. If Stripe returns 4xx (wrong-mode key, deleted object) we skip
 * that leaf and continue with what we have.
 * ───────────────────────────────────────────────────────────────────── */

async function fetchStripeOrderDetails(env, orderNo) {
  const stripeGet = async (path) => {
    try {
      const r = await fetch(`https://api.stripe.com/v1/${path}`, {
        headers: { 'Authorization': `Bearer ${env.STRIPE_SECRET_KEY}` }
      });
      if (!r.ok) {
        const err = await r.json().catch(() => ({}));
        return { _error: err.error?.message || `HTTP ${r.status}` };
      }
      return await r.json();
    } catch (e) {
      return { _error: e.message };
    }
  };

  const out = {};
  let paymentIntentId = null;
  let chargeId = null;
  let customerId = null;

  if (orderNo.startsWith('in_')) {
    out.type = 'invoice';
    out.invoice = await stripeGet(`invoices/${orderNo}`);
    paymentIntentId = out.invoice?.payment_intent || null;
    chargeId        = out.invoice?.charge || null;
    customerId      = out.invoice?.customer || null;
  } else if (orderNo.startsWith('cs_')) {
    out.type = 'checkout_session';
    out.session = await stripeGet(`checkout/sessions/${orderNo}`);
    paymentIntentId = out.session?.payment_intent || null;
    customerId      = out.session?.customer || null;
  } else {
    return { type: 'unknown', _error: 'Order is not a Stripe-sourced row (no in_/cs_ prefix)' };
  }

  if (paymentIntentId) {
    out.payment_intent = await stripeGet(`payment_intents/${paymentIntentId}`);
    if (!chargeId) chargeId = out.payment_intent?.latest_charge || null;
    if (!customerId) customerId = out.payment_intent?.customer || null;
  }

  if (chargeId) {
    out.charge = await stripeGet(`charges/${chargeId}`);
    // Surface the most useful fields up-front
    if (out.charge && !out.charge._error) {
      const pm = out.charge.payment_method_details || {};
      const card = pm.card || {};
      out.payment_method = {
        type: pm.type || null,
        brand: card.brand || null,
        last4: card.last4 || null,
        exp_month: card.exp_month || null,
        exp_year: card.exp_year || null,
        country: card.country || null,
        funding: card.funding || null,
      };
      out.receipt_url = out.charge.receipt_url || null;
    }
  }

  if (customerId) {
    out.customer = await stripeGet(`customers/${customerId}`);
  }

  if (chargeId) {
    const refunds = await stripeGet(`refunds?charge=${encodeURIComponent(chargeId)}&limit=10`);
    out.refunds = refunds?.data || [];
  } else {
    out.refunds = [];
  }

  return out;
}

/* ─── Anthropic Claude API (for admin team chat) ────────────────────────
 *
 * Calls Anthropic /v1/messages with the team's conversation history +
 * project system prompt + 1-2 read-only tools. Runs a basic tool-use
 * loop: model → tool_use stop → execute tool → tool_result → continue.
 *
 * MAX_TOOL_TURNS caps how many tool calls per single user message —
 * prevents runaway loops if Claude gets stuck.
 *
 * Cost: ~$0.01-0.03 per invocation depending on history length and
 * tool calls. Rate-limited to 100 invocations/user/day in the caller.
 * ───────────────────────────────────────────────────────────────────── */

const TEAM_CHAT_SYSTEM_PROMPT = `You are Claude, a software engineering assistant embedded in the UVERA project's admin dashboard team chat.

# Project context
UVERA is an AI video creation platform. Tech stack:
- Frontend: React 19 + Vite 7 SPA
- Backend: Cloudflare Workers (single \`public/_worker.js\` file)
- Database: Supabase Postgres (auth + RLS + tables)
- Payments: Stripe (live mode, UGHF Technology Inc account)
- Storage: Cloudflare R2 + Cloudflare Stream
- Email: Resend HTTP API
- AI: Neodomain Gemini relay (text + image), BytePlus Volcengine (video)

Team members in this chat:
- **fei** (project lead, full-stack — 费 in Chinese)
- **Leon** (product / frontend / design — 甲方接口)
- **Claude** (you — the AI assistant)

# Communication style
- Respond in the same language the user uses (Chinese ↔ English mix is fine).
- Be direct. The team values blunt > polite. Use 中文 for fei/Leon, English for technical terms / SQL / code / library names.
- Use markdown headings + bullet lists for non-trivial answers, plain prose for quick replies.
- When citing files use \`path/to/file.ext:LINE\` format.
- Brief is better than thorough unless the user asks "give me everything".

# Decision authority (see docs/governance/DECISION-OWNERSHIP.md)

**You CAN do directly (no human ack required):**
- Read DB queries via the query_db tool
- Suggest code changes (text only — they ship to a draft, fei merges)
- Answer technical questions, propose architectures
- Write dev log entries / decision docs
- Diagnose bug reports

**You MUST get explicit ack before:**
- DROP TABLE / DROP COLUMN / DELETE FROM in production
- Refunding > $100
- Sending emails to users (other than admin-triggered receipts)
- Adding new npm dependencies
- Tagging a release

**Only fei can decide:**
- Strategic direction / GA timing
- Pricing changes
- Legal / compliance terms (deferred to lawyer review)
- User-facing communications

# Tools
You have access to:
- **query_db(sql, description)** — Run read-only SQL against Supabase. SELECT only. Use this to answer data questions ("how many users signed up today", "show me the last 5 orders for user X", etc.). Include a 1-line \`description\` of why you're querying for the audit log.

# Useful schema (frequent tables)
- \`auth.users\` (Supabase Auth) — id, email, user_metadata (jsonb: credits, tier, is_admin)
- \`public.orders\` (orderNo, userId, subject, amount, status, createdAt, voided_at, refunded_at, refunded_amount, stripe_refund_id, credits_deducted)
- \`public.recommended_content\` (id, title, artist, video, cover, tags[], allow_recast, allow_branch, published, published_at, likes_count, saves_count, createdAt)
- \`public.user_likes\` (user_id, content_id)
- \`public.user_saves\` (user_id, content_id)
- \`public.follows\` (follower_id, following_id, created_at)
- \`public.generation_logs\` (user_id, generation_type, vendor, model, resolution, duration_seconds, prompt, credits_charged, cost_usd, status, started_at, finished_at, duration_ms, error_message)
- \`public.credit_grants\` (user_id, amount, tier, reason, granted_by, stripe_invoice_id, granted_at)
- \`public.beta_requests\`, \`public.user_video_uploads\`, \`public.content_reports\`, \`public.profiles\`, \`public.help_articles\`, \`public.dev_log_entries\`, \`public.team_messages\`

# Constraints
- Don't fabricate facts. If you don't know, say so.
- For code suggestions: cite specific file paths + line numbers. Don't write code blocks longer than ~30 lines in chat — instead say "I can put this in a PR; just say go".
- For sensitive ops (refunds / deletes), ALWAYS show the SQL/diff first and wait for explicit "do it" from fei.
- If a query takes too long or hits an error, mention it; don't silently retry.`;

const CLAUDE_TOOLS = [
  {
    name: 'query_db',
    description: 'Execute a read-only SELECT query against the Supabase Postgres database. Use for answering data questions. Returns up to 100 rows.',
    input_schema: {
      type: 'object',
      properties: {
        sql: {
          type: 'string',
          description: 'A single SELECT statement. WITH/CTE is fine. INSERT/UPDATE/DELETE/DDL will be rejected.',
        },
        description: {
          type: 'string',
          description: 'One short sentence explaining what you\'re looking up. Logged for audit.',
        },
      },
      required: ['sql', 'description'],
    },
  },
];

const isReadOnlySql = (sql) => {
  // Basic safety check: must be a single statement that starts with SELECT or WITH
  // and contains no INSERT/UPDATE/DELETE/DROP/CREATE/ALTER/TRUNCATE/GRANT/REVOKE.
  // Defense in depth — even if our supabaseQueryReadOnly endpoint also blocks.
  if (!sql || typeof sql !== 'string') return false;
  const trimmed = sql.trim().replace(/;+\s*$/, '');
  if (/;/.test(trimmed)) return false;  // no multi-statement
  if (!/^\s*(SELECT|WITH)\b/i.test(trimmed)) return false;
  if (/\b(INSERT|UPDATE|DELETE|DROP|CREATE|ALTER|TRUNCATE|GRANT|REVOKE|COMMENT|REINDEX|VACUUM)\b/i.test(trimmed)) return false;
  return true;
};

async function runReadOnlyQuery(env, sql) {
  // We don't have a generic SQL endpoint via PostgREST. Use Supabase's
  // pg_meta RPC? Or just run via the JS supabase-js admin (service role).
  // Simplest path: call the PostgREST stored RPC `claude_query` if exists,
  // else fall back to a curated read of common tables.
  //
  // For now: use the `pg_meta` query endpoint that Supabase exposes via
  // pgsodium / pg_net is overkill. Instead, ship with a simpler RPC:
  // `CREATE FUNCTION public.claude_readonly_query(sql_text text) RETURNS json`
  // that runs the query and returns rows. This is created in the
  // 20260513_team_chat migration as a separate companion. If the RPC
  // doesn't exist, we error out.
  const supabaseUrl = env.SUPABASE_URL || 'https://wjhdsodlxekvhpahascs.supabase.co';
  const r = await fetch(`${supabaseUrl}/rest/v1/rpc/claude_readonly_query`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
      'apikey': env.SUPABASE_SERVICE_ROLE_KEY,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ sql_text: sql }),
  });
  if (!r.ok) {
    const t = await r.text().catch(() => '');
    throw new Error(`Query failed (${r.status}): ${t.slice(0, 500)}`);
  }
  return await r.json();
}

async function invokeClaude(env, history, callerDisplayName) {
  const MAX_TOOL_TURNS = 5;
  const MODEL = env.CLAUDE_CHAT_MODEL || 'claude-sonnet-4-5';

  // Map our team_messages → Anthropic messages format.
  // Skip system messages (they have author_kind='system') — only show as
  // context if needed.
  const apiMessages = [];
  for (const m of history) {
    if (m.author_kind === 'human') {
      // Prefix with display name so Claude knows who said what
      // (Anthropic's multi-user convention)
      apiMessages.push({
        role: 'user',
        content: `[${m.author_display_name}] ${m.body}`,
      });
    } else if (m.author_kind === 'claude') {
      apiMessages.push({
        role: 'assistant',
        content: m.body,
      });
    }
    // 'system' messages skipped
  }

  // Collapse consecutive same-role messages (Anthropic requires alternating)
  const collapsed = [];
  for (const msg of apiMessages) {
    if (collapsed.length > 0 && collapsed[collapsed.length - 1].role === msg.role) {
      collapsed[collapsed.length - 1].content += '\n\n' + msg.content;
    } else {
      collapsed.push(msg);
    }
  }

  // Ensure conversation starts with 'user'
  if (collapsed.length === 0 || collapsed[0].role !== 'user') {
    collapsed.unshift({ role: 'user', content: `[${callerDisplayName}] (start of conversation)` });
  }

  const allToolCalls = [];
  let finalText = '';

  for (let turn = 0; turn < MAX_TOOL_TURNS; turn++) {
    const resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${env.ANTHROPIC_API_KEY}`,
        'anthropic-version': '2023-06-01',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 2048,
        system: TEAM_CHAT_SYSTEM_PROMPT,
        tools: CLAUDE_TOOLS,
        messages: collapsed,
      }),
    });

    if (!resp.ok) {
      const errBody = await resp.text().catch(() => '');
      throw new Error(`Anthropic API error (${resp.status}): ${errBody.slice(0, 300)}`);
    }
    const data = await resp.json();

    // Extract text + tool_use blocks
    const textBlocks = (data.content || []).filter(b => b.type === 'text').map(b => b.text);
    const toolUses = (data.content || []).filter(b => b.type === 'tool_use');

    if (textBlocks.length > 0) {
      finalText = textBlocks.join('\n\n');
    }

    if (data.stop_reason !== 'tool_use' || toolUses.length === 0) {
      // No more tools needed — done
      break;
    }

    // Execute each tool call
    const toolResults = [];
    for (const tu of toolUses) {
      const callRecord = {
        name: tu.name,
        input: tu.input,
        executed_at: new Date().toISOString(),
      };
      let result;
      try {
        if (tu.name === 'query_db') {
          const { sql, description } = tu.input || {};
          if (!isReadOnlySql(sql)) {
            throw new Error('Only single read-only SELECT/WITH statements allowed');
          }
          const rows = await runReadOnlyQuery(env, sql);
          result = {
            rows: Array.isArray(rows) ? rows.slice(0, 100) : rows,
            row_count: Array.isArray(rows) ? rows.length : null,
            truncated: Array.isArray(rows) && rows.length > 100,
          };
          callRecord.success = true;
          callRecord.row_count = result.row_count;
        } else {
          throw new Error(`Unknown tool: ${tu.name}`);
        }
      } catch (e) {
        result = { error: e.message };
        callRecord.success = false;
        callRecord.error = e.message;
      }
      allToolCalls.push(callRecord);
      toolResults.push({
        type: 'tool_result',
        tool_use_id: tu.id,
        content: JSON.stringify(result).slice(0, 8000),  // cap to ~8KB per result
      });
    }

    // Add assistant turn + tool_result turn to messages
    collapsed.push({ role: 'assistant', content: data.content });
    collapsed.push({ role: 'user', content: toolResults });
    // Loop continues until model emits a final text response with
    // stop_reason='end_turn'
  }

  if (!finalText) {
    finalText = '(Claude returned no text — possibly hit tool loop limit. Check tool_calls in audit log.)';
  }

  return { text: finalText, toolCalls: allToolCalls };
}

/* ─── Resend email ──────────────────────────────────────────────────────
 *
 * Cloudflare Workers can't open raw TCP for SMTP (no `net` module), so
 * we use Resend's HTTP API instead. The `re_xxx` API key works for both
 * SMTP and HTTP, so the SMTP_PASS env var the user provided is the same
 * key we POST to /v1/emails with.
 *
 * Required env vars:
 *   RESEND_API_KEY  (or SMTP_PASS as alias) — re_xxx
 *   FROM_EMAIL                              — e.g. noreply@send.uvera.ai
 *   FROM_NAME                               — e.g. Uvera
 *
 * Required Resend Dashboard setup:
 *   - Verify the FROM_EMAIL domain (DNS: SPF/DKIM/DMARC) — Resend
 *     refuses to send from unverified domains in production.
 *
 * sendEmail() is fire-and-forget-friendly: returns { ok: true } on success
 * or { ok: false, error } on failure. Callers should NEVER let an email
 * failure break the parent operation (payment, refund, etc.) — log the
 * error and move on. Wrap in try/catch.
 * ───────────────────────────────────────────────────────────────────── */

async function sendEmail(env, { to, subject, html, text, replyTo, tags }) {
  const apiKey = env.RESEND_API_KEY || env.SMTP_PASS;
  if (!apiKey) {
    return { ok: false, error: 'RESEND_API_KEY not configured' };
  }
  const fromEmail = env.FROM_EMAIL || 'noreply@send.uvera.ai';
  const fromName  = env.FROM_NAME  || 'Uvera';
  const from      = `${fromName} <${fromEmail}>`;

  if (!to || !subject || (!html && !text)) {
    return { ok: false, error: 'to + subject + (html|text) are required' };
  }

  const payload = {
    from,
    to: Array.isArray(to) ? to : [to],
    subject,
  };
  if (html) payload.html = html;
  if (text) payload.text = text;
  if (replyTo) payload.reply_to = replyTo;
  if (tags) payload.tags = tags;

  try {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) {
      return { ok: false, error: data.message || data.error || `HTTP ${r.status}`, status: r.status };
    }
    return { ok: true, id: data.id };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

/* Renders a minimal branded HTML email shell with a heading, body
 * paragraphs, and an optional CTA button. Inline styles only — most
 * mail clients ignore <style> blocks. Returns { html, text }; pass
 * both to sendEmail() so clients without HTML support get a fallback. */
function renderEmail({ heading, paragraphs = [], cta, footerNote }) {
  const safeText = (s) => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const ctaHtml = cta ? `
    <p style="margin: 28px 0;">
      <a href="${safeText(cta.url)}" style="background:#18181b;color:#ffffff;padding:10px 20px;border-radius:8px;text-decoration:none;font-size:14px;font-weight:500;display:inline-block;">${safeText(cta.label)}</a>
    </p>` : '';
  const paraHtml = paragraphs.map(p => `<p style="line-height:1.55;margin:14px 0;color:#3f3f46;font-size:14px;">${safeText(p)}</p>`).join('');
  const footerHtml = footerNote
    ? `<p style="font-size:11px;color:#a1a1aa;margin:0;">${safeText(footerNote)}</p>`
    : '';
  const html = `<!doctype html>
<html><head><meta charset="utf-8"></head>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#fafafa;margin:0;padding:32px 16px;">
  <table width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:520px;margin:0 auto;background:#ffffff;border-radius:12px;overflow:hidden;border:1px solid #e4e4e7;">
    <tr><td style="padding:32px 32px 24px 32px;">
      <h1 style="margin:0 0 18px 0;font-size:18px;font-weight:600;color:#18181b;">${safeText(heading)}</h1>
      ${paraHtml}
      ${ctaHtml}
    </td></tr>
    <tr><td style="padding:18px 32px 24px 32px;border-top:1px solid #f4f4f5;">
      <p style="font-size:12px;color:#71717a;margin:0 0 4px 0;">UVERA · <a href="https://uvera.ai" style="color:#71717a;text-decoration:none;">uvera.ai</a></p>
      ${footerHtml}
    </td></tr>
  </table>
</body></html>`;
  // Plain-text fallback: heading + paragraphs + CTA URL
  const text = [
    heading,
    '',
    ...paragraphs,
    cta ? `\n${cta.label}: ${cta.url}` : '',
    '',
    '— UVERA · uvera.ai',
    footerNote || '',
  ].filter(Boolean).join('\n');
  return { html, text };
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    /* ── Gemini model resolution ─────────────────────────────────────────
     * Pulled from env vars so ops can hot-swap when Neodomain's
     * distributor rotates available models, WITHOUT redeploying.
     *
     * To change in production:
     *   1. Cloudflare Dashboard → Workers & Pages → uvera → Settings →
     *      Variables → Secret variables → Add variable
     *   2. Name: GEMINI_TEXT_MODEL  (or GEMINI_IMAGE_MODEL)
     *   3. Value: e.g. "gemini-2.5-flash" / "gemini-2.0-flash-exp" / etc
     *   4. Save → effect within 60 seconds (no redeploy needed)
     *
     * History of Neodomain's distributor rotations (defaults updated each):
     *   - 2026-05-09: gemini-1.5-flash dropped → switched to gemini-3.1-flash
     *   - 2026-05-11: gemini-3.1-flash dropped → switched to gemini-3-flash-preview
     *                 (image model kept as gemini-3.1-flash-image-preview which is still on)
     *
     * GEMINI_TEXT_MODEL_FALLBACKS / GEMINI_IMAGE_MODEL_FALLBACKS env vars
     * (comma-separated) provide the auto-retry chain in geminiFetch() —
     * if primary returns model_not_found, the worker walks this list and
     * loudly warns ops about the drift. Defaults below cover known-good
     * Neodomain channels as of 2026-05-11. */
    const GEMINI_TEXT_MODEL  = env.GEMINI_TEXT_MODEL  || 'gemini-3-flash-preview';
    const GEMINI_IMAGE_MODEL = env.GEMINI_IMAGE_MODEL || 'gemini-3.1-flash-image-preview';
    const GEMINI_TEXT_FALLBACKS  = (env.GEMINI_TEXT_MODEL_FALLBACKS  || 'gemini-2.5-flash,gemini-2.0-flash-exp,gemini-1.5-flash').split(',').map(s => s.trim()).filter(Boolean);
    const GEMINI_IMAGE_FALLBACKS = (env.GEMINI_IMAGE_MODEL_FALLBACKS || 'gemini-2.5-flash-image-preview,gemini-2.0-flash-exp').split(',').map(s => s.trim()).filter(Boolean);

    /* Gemini call wrapper with auto-fallback on model_not_found.
     * Walks [primary, ...fallbacks] until one succeeds or all are exhausted.
     * Returns the same Response shape as fetch() so call sites are unchanged.
     * - opts.body must be a JSON string (caller serializes)
     * - opts.kind = 'text' | 'image' (selects fallback list)
     * - opts.headers, opts.method passed through */
    const geminiFetch = async ({ kind, body, headers = {}, method = 'POST' }) => {
      const candidates = kind === 'image'
        ? [GEMINI_IMAGE_MODEL, ...GEMINI_IMAGE_FALLBACKS]
        : [GEMINI_TEXT_MODEL,  ...GEMINI_TEXT_FALLBACKS];
      // Dedup while preserving order
      const tried = [];
      const seen = new Set();
      for (const m of candidates) {
        if (!m || seen.has(m)) continue;
        seen.add(m);
        const resp = await fetch(`https://ga.neodomain.cn/v1beta/models/${m}:generateContent`, {
          method,
          headers: { 'Content-Type': 'application/json', ...headers },
          body,
        });
        if (resp.ok) {
          if (tried.length > 0) {
            console.warn(`[gemini] MODEL_DRIFT: primary "${candidates[0]}" failed, succeeded with fallback "${m}". Tried: ${tried.join(', ')}. FIX: set GEMINI_${kind.toUpperCase()}_MODEL=${m} in Cloudflare env.`);
          }
          return resp;
        }
        // Only walk fallbacks for model_not_found / 404 — other errors
        // (auth, quota, malformed request) should NOT silently fall through.
        const status = resp.status;
        let bodyText = '';
        try { bodyText = await resp.clone().text(); } catch (e) {}
        const isModelMissing =
          status === 404 ||
          /model_not_found/i.test(bodyText) ||
          /No available channel for model/i.test(bodyText);
        tried.push(`${m}(${status})`);
        if (!isModelMissing) {
          // Not a "wrong model" failure — return as-is so caller sees real error
          console.warn(`[gemini] non-fallback error from "${m}": ${status} ${bodyText.slice(0, 200)}`);
          return resp;
        }
        console.warn(`[gemini] model_not_found for "${m}", trying next fallback`);
      }
      // All candidates exhausted — fabricate a response the caller can handle
      const errBody = JSON.stringify({
        error: {
          code: 'model_not_found',
          message: `All Gemini models exhausted. Tried: ${tried.join(', ')}. Update GEMINI_${kind.toUpperCase()}_MODEL env var to a working model.`,
          tried,
        },
      });
      console.error(`[gemini] ALL_MODELS_FAILED: ${errBody}`);
      return new Response(errBody, { status: 502, headers: { 'Content-Type': 'application/json' } });
    };

    // Proxy requests prefixed with /neodomain-api/  → dev.neodomain.cn
    if (url.pathname.startsWith('/neodomain-api/')) {
      if (request.method === 'OPTIONS') {
        return new Response(null, {
          status: 204,
          headers: {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Requested-With, accesstoken',
            'Access-Control-Max-Age': '86400',
          }
        });
      }

      const targetPath = url.pathname.replace(/^\/neodomain-api/, '');
      const targetUrl = `https://dev.neodomain.cn${targetPath}${url.search}`;
      
      const proxyHeaders = new Headers(request.headers);
      proxyHeaders.delete('Host');
      proxyHeaders.delete('Cookie');
      proxyHeaders.set('Origin', 'https://dev.neodomain.cn');
      proxyHeaders.set('Referer', 'https://dev.neodomain.cn/');

      const proxyRequest = new Request(targetUrl, {
        method: request.method,
        headers: proxyHeaders,
        body: request.body,
        redirect: 'manual'
      });
      
      const response = await fetch(proxyRequest);
      
      const responseHeaders = new Headers(response.headers);
      responseHeaders.set('Access-Control-Allow-Origin', '*');
      responseHeaders.set('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
      responseHeaders.set('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With, accesstoken');
      
      return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers: responseHeaders
      });
    }

    // --- DEDICATED STS TOKEN PROXY ---
    // A completely clean, server-to-server proxy to bypass ANY browser WAF/CORS header issues on Neodomain's STS gateway
    if (url.pathname === '/api/neo-oss-sts') {
      if (request.method === 'OPTIONS') {
        return new Response(null, {
          status: 204,
          headers: {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Headers': '*',
            'Access-Control-Allow-Methods': 'GET, OPTIONS'
          }
        });
      }

      const token = request.headers.get('Authorization') || request.headers.get('accesstoken');
      if (!token) {
        return new Response('Missing token', { status: 401, headers: { 'Access-Control-Allow-Origin': '*' } });
      }

      try {
        // Clean backend-to-backend fetch
        const stsRes = await fetch('https://dev.neodomain.cn/agent/sts/oss/token', {
          method: 'GET',
          headers: {
            'accesstoken': token,
            'Authorization': token,
            'User-Agent': 'Cloudflare-Worker'
          }
        });
        
        const responseData = await stsRes.text();
        return new Response(responseData, {
          status: stsRes.status,
          headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*'
          }
        });
      } catch (err) {
        return new Response(JSON.stringify({ success: false, errMessage: err.message }), {
          status: 500,
          headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
        });
      }
    }

    // ─── Volcengine Ark: Submit video generation task ───────────────────────────
    // POST /api/volcengine/video/submit
    // Body: { prompt, imageUrl, duration, ratio, resolution, generateAudio }
    // Returns: { taskId, usedImage }
    // Auto-fallback: if image triggers real-person safety filter, retries text-only
    //
    // Generation logging: every submit inserts a row in public.generation_logs
    // with status='started'. The matching /status endpoint flips that row to
    // 'succeeded'/'failed' on first terminal poll. This powers the admin
    // "Generation Logs" tab + CSV export. Logging failures never block the
    // user-facing flow — we wrap in try/catch and continue.
    if (url.pathname === '/api/volcengine/video/submit' && request.method === 'POST') {
      const corsHeaders = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST, OPTIONS' };
      if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders });
      // §2026-05-29 在 try 外声明,使 catch 可见(同步失败退款用)。
      let callerId = null, callerEmail = null, callerTier = 'free', chargedCredits = 0;
      try {
        const { prompt, imageUrl, imageUrls, videoUrl, videoUrls, duration, ratio, resolution, generateAudio, model, watermark, renderSessionId } = await request.json();
        // §2026-05-15: DB-first lookup (admin can rotate via UI), env fallback
        // for transition period before admin sets the value.
        const arkApiKey = (await getSystemSetting(env, 'byteplus_ark_api_key', null)) || env.ARK_API_KEY;
        if (!arkApiKey) throw new Error('ARK_API_KEY not configured (checked system_settings.byteplus_ark_api_key + Cloudflare env)');

        // Optional auth: read user identity if JWT provided. We do NOT require
        // auth here because /video/submit isn't gated yet (legacy decision);
        // logging just records NULL user_id when unauthenticated.
        // §2026-05-15 also extract tier — needed below for server-side
        // watermark enforcement on free/lite tier output.
        // §2026-05-29 必须登录(挡匿名烧 BytePlus)+ 服务端权威成本原子扣费。
        // 旧实现是 best-effort 鉴权(匿名也放行,扣费在可篡改的客户端)——可被绕过免费烧钱。
        const caller = await requireUser(request, env);   // 无/无效 JWT → 抛 401(下方 catch 处理)
        callerId = caller.id;
        callerEmail = caller.email;
        callerTier = caller.tier;                          // 来自可信 JWT,优于旧客户端默认值

        // §2026-06-05 模型感知 resolution 校正(必须在计费 + submitToArk 之前)。
        //   usedModel 与下方 baseParams.model 同源(model || fast 端点)。
        //   Fast 模型不支持 1080p → clamp 到 720p,否则 BytePlus 直接 InvalidParameter。
        //   计费 + 日志一律用 effectiveResolution,保证「按实际产出档位扣费」。
        const usedModel = model || (await getSystemSetting(env, 'seedance_fast_endpoint', 'ep-20260507183959-d7mr2'));
        const modelMaxRes = await resolveModelMaxResolution(env, usedModel);
        const effectiveResolution = clampResolutionToMax(resolution, modelMaxRes);
        if (effectiveResolution !== (resolution || '480p')) {
          console.warn(`[video/submit] resolution '${resolution}' 不被模型 ${usedModel} 支持(max ${modelMaxRes}),已 clamp 到 '${effectiveResolution}'(userId=${callerId})`);
        }

        // 服务端权威成本 → 原子扣费(必须在 submitToArk 调 BytePlus 之前)。
        // 余额不足:creditSpend 抛 402,主 catch 返回 402(此时 chargedCredits 仍为 0,不退款)。
        const videoCost = await computeVideoCost(env, effectiveResolution, duration, usedModel);
        const spendInfo = await creditSpend(env, callerId, videoCost, 'spend_video', null, `Video gen ${effectiveResolution} ${duration || 5}s`);
        chargedCredits = spendInfo.spent;

        // §2026-05-15 server-side watermark enforcement.
        // Previously the watermark flag was passed verbatim from the
        // frontend (StoryGeneratorPage sends `watermark: tier === 'free'`),
        // which is bypassable — a user could modify the request payload
        // to set `watermark: false` and get clean output on Free tier.
        //
        // Rule: free + lite tier output is always watermarked, regardless
        // of what the client sends. Paid tiers (starter/creator/studio)
        // get clean output. Watermark text is set via `watermark_text` —
        // if BytePlus Seedance ignores the field (boolean-only API), the
        // platform's default watermark applies instead. Verification of
        // exact text rendering is operator follow-up (see decision doc
        // 2026-05-15-watermark-enforcement.md).
        const isUnpaidTier = callerTier === 'free' || callerTier === 'lite';
        const enforceWatermark = isUnpaidTier;
        if (enforceWatermark && watermark === false) {
          console.warn(`[video/submit] client sent watermark=false but tier=${callerTier} — forcing watermark=true (userId=${callerId})`);
        }

        // Compute reference counts. Frontend may send singular `imageUrl` or
        // array `imageUrls`; same for video. We normalize to counts here.
        const refImageCount = Array.isArray(imageUrls)
          ? imageUrls.filter(Boolean).length
          : (imageUrl ? 1 : 0);
        const hasVideoRef = !!(videoUrl || (Array.isArray(videoUrls) && videoUrls.some(Boolean)));

        // §2026-05-15 Seedance endpoint IDs are now admin-configurable via
        // system_settings (no redeploy needed for ID rotation). usedModel 已在
        // 上方(计费前)解析为 model || seedance_fast_endpoint。
        const baseParams = {
          model: usedModel,   // §2026-06-05 = model || fast 端点(早于计费已解析)
          generate_audio: generateAudio ?? true, // Default to true so videos always have sound unless explicitly turned off
          ratio: ratio || '16:9',
          resolution: effectiveResolution,   // §2026-06-05 模型感知 clamp 后的生效档位(Fast 不支持 1080p)
          duration: duration || 5,
          // §2026-05-15: server-side enforce — paid tier can opt out,
          // free/lite cannot. See watermark enforcement block above.
          watermark: enforceWatermark ? true : (watermark ?? false),
          // §2026-05-15 experimental: attempt custom watermark text.
          // BytePlus Seedance API typically ignores unknown fields. If
          // ignored → falls back to platform default watermark (likely
          // BytePlus / Volcengine logo). If accepted → "uvera.ai" appears
          // on Free / Lite output.
          // Operator verification: trigger a Free gen post-deploy, inspect
          // output. If watermark text isn't "uvera.ai", we'll need to add
          // a post-processing step (Cloudflare Stream overlay or FFmpeg).
          ...(enforceWatermark ? { watermark_text: 'uvera.ai' } : {}),
        };

        /* submitToArk(withReference, overrideRefUrl?, opts?)
         *   withReference: true → include the reference asset(s) in content
         *   overrideRefUrl: when set, used as the URL/URI for the reference
         *                   (video_url OR image_url depending on input type).
         *                   Used by real-person fallback to substitute the
         *                   private asset:// URI for the original public URL.
         *                   When the request was MULTI-image, override only
         *                   substitutes for the first image (the one most
         *                   likely to be the offending reference).
         *
         *   opts.singleImageOnly: when true, force single-image mode even
         *                         if imageUrls had multiple entries. Used
         *                         by the multi-image-rejection fallback so
         *                         we can downgrade to imageUrls[0] only.
         *
         * §2026-05-26 fei — multi-reference image support. Frontend can now
         *   pass imageUrls=[characterBoardUrl, storyboardUrl] for Quick Mode
         *   so Seedance sees BOTH the character identity board (for face/
         *   costume/art style) AND the storyboard (for composition/action).
         *   We push one image_url content entry per URL, all tagged with
         *   role='reference_image'. BytePlus Ark Seedance docs say this is
         *   supported; if a specific endpoint version rejects (we detect
         *   by error code 10010 or "invalid content" patterns), the outer
         *   fallback chain re-calls with singleImageOnly=true. */
        const submitToArk = async (withReference, overrideRefUrl = null, opts = {}) => {
          const { singleImageOnly = false } = opts;
          const content = [];
          if (withReference) {
            if (videoUrl) {
              const urlToUse = overrideRefUrl || videoUrl;
              content.push({ type: 'video_url', video_url: { url: urlToUse }, role: 'reference_video' });
            } else {
              // Normalize image refs: prefer imageUrls (array) when present,
              // fall back to imageUrl (singular) for backward compat.
              let imgList = Array.isArray(imageUrls)
                ? imageUrls.filter(Boolean)
                : (imageUrl ? [imageUrl] : []);
              if (singleImageOnly && imgList.length > 1) imgList = imgList.slice(0, 1);
              // Apply override (only substitutes the FIRST image — typical
              // real-person fallback case has only 1 anyway).
              if (overrideRefUrl && imgList.length > 0) {
                imgList = [overrideRefUrl, ...imgList.slice(1)];
              }
              for (const u of imgList) {
                content.push({ type: 'image_url', image_url: { url: u }, role: 'reference_image' });
              }
            }
          }
          content.push({ type: 'text', text: prompt });
          const res = await fetch('https://ark.ap-southeast.bytepluses.com/api/v3/contents/generations/tasks', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${arkApiKey}` },
            body: JSON.stringify({ ...baseParams, content })
          });
          return res.json();
        };

        /* §2026-05-26 fei — detect "endpoint rejected multi-image" so we
         *   can downgrade to single-image. BytePlus Ark doesn't have a
         *   dedicated code for this; in practice rejection looks like
         *   "InvalidParameter" + a message about content array size or
         *   unsupported role count. We probe pragmatically and let the
         *   real-person heuristic handle its own codes separately. */
        const isMultiImageRejection = (errResp) => {
          const code = String(errResp?.error?.code ?? '');
          const msg = String(errResp?.error?.message ?? '').toLowerCase();
          // Real-person rejection has its own code 10010 — exclude that here
          if (code === '10010') return false;
          return (
            /reference_image.*(count|exceed|limit|max|only)/i.test(msg) ||
            /multiple.*image.*not.*support/i.test(msg) ||
            /content.*array.*size/i.test(msg) ||
            /only.*one.*reference/i.test(msg) ||
            (code.toLowerCase().includes('invalidparameter') && /image|reference/.test(msg))
          );
        };

        // Detects "BytePlus rejected this for real-person / face / privacy"
        // across the several error codes/messages BytePlus uses for both
        // image and video paths. Centralized so video + image flow share
        // the same heuristic.
        const isRealPersonRejection = (errResp) => {
          // §2026-05-22: cast code to String — BytePlus sometimes returns
          // numeric code (10010 vs '10010') which would TypeError on
          // .includes(). Defensive normalization here covers both.
          const code = String(errResp?.error?.code ?? '');
          const msg = String(errResp?.error?.message ?? '').toLowerCase();
          return (
            code === '10010' ||
            code.includes('InputImageSensitiveContentDetected') ||
            code.includes('InputVideoSensitiveContentDetected') ||
            code.includes('SensitiveContent') ||
            /real.person|real_person|face|identity|privacy|deepfake|portrait/.test(msg) ||
            msg.includes('invalid video_url')  // empirically: BytePlus returns "Invalid video_url" for some real-person rejections too
          );
        };

        // First attempt: with reference (multi-image when frontend sent imageUrls)
        let arkData = await submitToArk(true);

        // §2026-05-22 — capture asset-library upload errors so they surface
        //   in the final user-facing error if fallback chain exhausts. Before
        //   this, IAM 403s / project mismatches were only visible in CF Worker
        //   Logs — users + admins got the generic "real-person rejected" msg
        //   with no clue that the actual root cause was a misconfigured AK/SK.
        let lastAssetUploadError = null;

        /* ── Fallback chain ────────────────────────────────────────────
         * §2026-05-26 fei — NEW: 0. Multi-image rejected by endpoint version.
         *   Quick Mode now sends [characterBoard, storyboard] for richer
         *   reference. If the specific Seedance endpoint version we're
         *   pointed at doesn't accept 2 image_url entries, downgrade to
         *   single image (imageUrls[0] = character board, the more
         *   important reference for face + art style). Real-person /
         *   sensitive-content checks below still apply to the downgraded
         *   payload. */
        const sentMultiImage = Array.isArray(imageUrls) && imageUrls.filter(Boolean).length > 1;
        if (!arkData.id && sentMultiImage && !videoUrl && isMultiImageRejection(arkData)) {
          console.warn('[BytePlus] Multi-image rejected by endpoint, downgrading to single (character board) ref:', arkData.error);
          arkData = await submitToArk(true, null, { singleImageOnly: true });
        }

        // 1. Real-person rejection (image path) — try Private Asset Library
        if (!arkData.id && imageUrl && !videoUrl && isRealPersonRejection(arkData)) {
          console.warn('[BytePlus] Image rejected (real-person or sensitive), trying Private Asset Library:', arkData.error);
          try {
            const assetUri = await uploadRealPersonAssetToBytePlus(imageUrl, env, 'Image');
            console.log('[BytePlus] Retrying with Image asset URI:', assetUri);
            arkData = await submitToArk(true, assetUri);
          } catch (assetErr) {
            console.error('[BytePlus] Image Asset Library upload failed:', assetErr);
            lastAssetUploadError = assetErr.message;
            // Don't throw yet — fall through to text-only fallback below
          }
        }

        // 2. Real-person rejection (video path) — try Private Asset Library as Video
        if (!arkData.id && videoUrl && isRealPersonRejection(arkData)) {
          console.warn('[BytePlus] Video rejected (real-person or sensitive), trying Private Asset Library:', arkData.error);
          try {
            const assetUri = await uploadRealPersonAssetToBytePlus(videoUrl, env, 'Video');
            console.log('[BytePlus] Retrying with Video asset URI:', assetUri);
            arkData = await submitToArk(true, assetUri);
          } catch (assetErr) {
            console.error('[BytePlus] Video Asset Library upload failed:', assetErr);
            lastAssetUploadError = assetErr.message;
            // Don't throw — try text-only fallback below
          }
        }

        // 3. Non-real-person SensitiveContent (10006) — drop reference, retry text-only
        if (!arkData.id && arkData.error?.code === '10006' && imageUrl && !videoUrl) {
          console.warn('[BytePlus] Image rejected (SensitiveContent 10006), retrying text-only');
          arkData = await submitToArk(false);
        }

        // 4. Last-resort for video path: if asset upload also failed AND
        //    the error is real-person flavored, drop the reference video
        //    and retry text-only. User loses the Recast/Sequel fidelity
        //    but at least gets a video.
        if (!arkData.id && videoUrl && isRealPersonRejection(arkData)) {
          console.warn('[BytePlus] Video asset upload failed too — retrying text-only as last resort');
          arkData = await submitToArk(false);
        }

        // 4b. §2026-05-22 fei — same last-resort path for IMAGE path.
        //   Before this, image-path real-person rejection that ALSO failed
        //   asset library upload (typically IAM 403 from project mismatch
        //   on new account) had no fallback → user got "Your reference
        //   media triggered our safety filter" and 0 video. Now we drop
        //   the reference image and retry text-only so user gets SOME
        //   video (loses the character-specific composition but workflow
        //   doesn't break). Pairs with formatError surfacing the asset
        //   error suffix so user knows why asset upload failed.
        if (!arkData.id && imageUrl && !videoUrl && isRealPersonRejection(arkData)) {
          console.warn('[BytePlus] Image asset upload failed too — retrying text-only as last resort');
          arkData = await submitToArk(false);
        }

        // 5. Prompt triggers copyright restriction → safe generic prompt
        if (!arkData.id && (arkData.error?.code?.includes('copyright') || arkData.error?.message?.toLowerCase().includes('copyright'))) {
          console.warn('[BytePlus] Prompt rejected (copyright), retrying with safe generic prompt');
          const safeContent = [{ type: 'text', text: '电影级镜头，人物在自然光线下做出优雅的动作，镜头缓缓推进' }];
          const safeRes = await fetch('https://ark.ap-southeast.bytepluses.com/api/v3/contents/generations/tasks', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${arkApiKey}` },
            body: JSON.stringify({ ...baseParams, content: safeContent })
          });
          arkData = await safeRes.json();
        }

        if (!arkData.id) {
          // Surface a user-readable error that distinguishes the common cases.
          // The raw error code+message is preserved for ops via console.error.
          console.error('[BytePlus] All fallbacks exhausted:', JSON.stringify(arkData));
          const errCode = arkData.error?.code || 'unknown';
          const errMsg  = arkData.error?.message || JSON.stringify(arkData).slice(0, 200);
          // §2026-05-22 — when an asset-library fallback was attempted and
          //   failed (typically IAM 403 / project name mismatch), include
          //   that diagnostic + hint in the final error so admin sees it in
          //   generation_logs.error_message without digging through CF logs.
          const assetErrSuffix = lastAssetUploadError
            ? ` [Asset Library fallback also failed: ${lastAssetUploadError.slice(0, 300)}]`
            : '';
          if (isRealPersonRejection(arkData)) {
            throw new Error(
              `视频生成被拒：参考${videoUrl ? '视频' : '图片'}涉及真人内容，BytePlus 无法处理。` +
              `如果是你本人的形象，请先在 Library 创建一个 Avatar 再使用。` +
              `(错误码: ${errCode})${assetErrSuffix}`
            );
          }
          if (/invalid.*video_url/i.test(errMsg) || /invalid.*image_url/i.test(errMsg)) {
            throw new Error(
              `视频生成失败：参考素材 URL 无法被 BytePlus 访问或解析。可能原因：` +
              `(1) URL 已过期 / 受签名保护；` +
              `(2) 文件格式或时长不被支持；` +
              `(3) 内容触发了 BytePlus 内容审核。` +
              `如需排查请联系管理员。原始错误: ${errMsg.slice(0, 100)}`
            );
          }
          throw new Error(`BytePlus did not return a task ID: ${errMsg} (code: ${errCode})`);
        }

        // §2026-05-30 fei — admin cost_usd Bug 1 + Bug 2 fix:
        //   Bug 1: Old code did `ratePerSec * duration` with NO model multiplier,
        //          so Standard runs (which cost BytePlus ~1.5× Fast in compute)
        //          logged the same cost_usd as Fast → admin saw inflated margin
        //          on Standard rows.
        //   Bug 2: COST_USD_PER_SECOND was a hardcoded constant. Comment said
        //          "should be revised quarterly" — 3 months later, no one had.
        //          Now read from system_settings so admin can tune without
        //          a redeploy when BytePlus pricing changes.
        //   Defaults match the previous hardcoded values exactly, so no
        //   behavior change until admin overrides via UI.
        const standardEndpoint = await getSystemSetting(env, 'seedance_standard_endpoint', 'ep-20260507184058-tpr79');
        const fastMul = Number(await getSystemSetting(env, 'seedance_fast_cost_multiplier', '1.0')) || 1.0;
        const stdMul = Number(await getSystemSetting(env, 'seedance_standard_cost_multiplier', '1.5')) || 1.5;
        // usedModel 已在上方(计费前)解析,此处复用。
        const costMul = (usedModel === standardEndpoint) ? stdMul : fastMul;
        const rate480 = Number(await getSystemSetting(env, 'video_cost_usd_per_sec_480p',  '0.015')) || 0.015;
        const rate720 = Number(await getSystemSetting(env, 'video_cost_usd_per_sec_720p',  '0.025')) || 0.025;
        const rate1080 = Number(await getSystemSetting(env, 'video_cost_usd_per_sec_1080p', '0.06'))  || 0.06;
        const COST_USD_PER_SECOND = { '480p': rate480, '720p': rate720, '1080p': rate1080 };
        const ratePerSec = COST_USD_PER_SECOND[effectiveResolution] || rate720;   // §2026-06-05 用生效档位
        const estimatedCostUsd = ratePerSec * (duration || 5) * costMul;

        // §2026-05-29 扣费已在 submitToArk 之前由 creditSpend 原子完成,
        // chargedCredits 即真实扣减额(computeVideoCost,含 standard 模型 1.5x)。
        // 旧的 CREDITS_PER_SEC/creditsCharged 估算块删除——记真实值而非估算。

        // Log to generation_logs (best-effort — never blocks the response)
        try {
          const supabaseUrl = env.SUPABASE_URL || 'https://wjhdsodlxekvhpahascs.supabase.co';
          await fetch(`${supabaseUrl}/rest/v1/generation_logs`, {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
              'apikey': env.SUPABASE_SERVICE_ROLE_KEY,
              'Content-Type': 'application/json',
              'Prefer': 'return=minimal',
            },
            body: JSON.stringify({
              user_id: callerId,
              user_email: callerEmail,
              generation_type: 'video',
              vendor: 'volcengine',
              endpoint: '/api/volcengine/video/submit',
              model: usedModel,
              task_id: arkData.id,
              resolution: effectiveResolution,   // §2026-06-05 记生效档位(= 实际产出 + 计费档位)
              duration_seconds: duration || 5,
              ratio: ratio || '16:9',
              generate_audio: generateAudio ?? true,
              prompt: (prompt || '').substring(0, 4000),  // safety cap
              prompt_length: (prompt || '').length,
              reference_image_count: refImageCount,
              has_video_reference: hasVideoRef,
              // §A Phase 1.5 dual-write — same value to both legacy + new columns
              // §2026-05-29 真实扣费额(服务端 creditSpend),供 status 端点异步退款引用。
              credits_charged: chargedCredits,
              tokens_charged: chargedCredits,
              cost_usd: estimatedCostUsd,
              // §2026-05-31 fei — mark this row as ESTIMATE at submit time;
              //   status-poll terminal reconciles to 'actual' (or keeps 'estimate'
              //   if no token rate is configured).
              cost_basis: 'estimate',
              // §2026-05-30 fei Bug 4 — render_session_id groups all logs from
              //   one Quick Mode render (char board + storyboard + N video segs)
              //   so admin can see total cost per render at a glance.
              render_session_id: renderSessionId || null,
              // Persist full sanitized request body so admin can inspect
              // exactly what user submitted, including watermark / audio
              // toggles and which model they chose.
              request_params: {
                resolution: effectiveResolution,            // §2026-06-05 生效档位(clamp 后)
                requested_resolution: resolution || '480p',  // §2026-06-05 用户原始请求(便于审计 clamp)
                resolution_clamped: effectiveResolution !== (resolution || '480p'),
                duration: duration || 5,
                ratio: ratio || '16:9',
                generate_audio: generateAudio ?? true,
                model: usedModel,
                // §2026-05-15: log the EFFECTIVE watermark, not the raw client
                // request — admin should see what BytePlus actually got.
                watermark: enforceWatermark ? true : (watermark ?? false),
                watermark_enforced: enforceWatermark,
                caller_tier: callerTier,
                refImageCount,
                hasVideoRef,
                promptLen: (prompt || '').length,
              },
              status: 'started',
              client_ip: request.headers.get('CF-Connecting-IP') || null,
              user_agent: request.headers.get('User-Agent') || null,
            })
          });
        } catch (logErr) {
          // Don't fail the user-facing call if logging fails — but escalate
          // to error so observability picks up schema drift / RLS issues.
          // §2026-05-15 loud-fail audit.
          console.error('[generation_logs] insert exception:', logErr.message, '— FAIL-OPEN: continuing without log row');
        }

        return new Response(JSON.stringify({
          success: true,
          taskId: arkData.id,
          usedImage: !!(imageUrl && arkData.id), // indicates whether image was actually used
          balance_after: spendInfo.balance_after, // §2026-05-29 前端用它刷新余额(无需再拉一次 profile)
        }), {
          status: 200, headers: { 'Content-Type': 'application/json', ...corsHeaders }
        });
      } catch (err) {
        console.error('Render pipeline encountered an error:', err);
        // §2026-05-29 鉴权失败 → 401;余额不足 → 402(均未扣费,不退款)。
        if (err.httpStatus === 401) {
          return new Response(JSON.stringify({ success: false, errMessage: err.message }),
            { status: 401, headers: { 'Content-Type': 'application/json', ...corsHeaders } });
        }
        if (err.httpStatus === 402 && err.insufficient) {
          return new Response(JSON.stringify({ success: false, insufficient: true, required: err.required, current: err.current, errMessage: err.message }),
            { status: 402, headers: { 'Content-Type': 'application/json', ...corsHeaders } });
        }
        // 已扣费但 BytePlus 提交阶段失败 → 同步退款(同请求内,无需幂等键)。
        // §2026-06-06 fei — 回传 refunded 信号给前端。
        let refunded = false;
        if (callerId && chargedCredits > 0) {
          const r = await creditGrant(env, callerId, chargedCredits, 'refund', null, null, 'Refund: video submit failed');
          refunded = !!r;
        }
        return new Response(JSON.stringify({ success: false, errMessage: err.message, refunded, refundedCredits: refunded ? chargedCredits : 0 }), {
          status: 500, headers: { 'Content-Type': 'application/json', ...corsHeaders }
        });
      }
    }

    // ─── Server-side R2 mirror: download image from any URL and PUT to R2 ──────
    // POST /api/mirror-to-r2
    // Body: { sourceUrl, accessToken? }
    // Returns: { success, publicUrl }
    if (url.pathname === '/api/mirror-to-r2' && request.method === 'POST') {
      const corsHeaders = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST, OPTIONS' };
      if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders });
      try {
        const { sourceUrl, accessToken } = await request.json();
        if (!sourceUrl) throw new Error('sourceUrl is required');

        const fetchHeaders = {};
        if (accessToken) {
          fetchHeaders['accesstoken'] = accessToken;
          fetchHeaders['Authorization'] = accessToken;
        }
        const imgRes = await fetch(sourceUrl, { headers: fetchHeaders });
        if (!imgRes.ok) throw new Error(`Failed to download image: ${imgRes.status} from ${sourceUrl}`);

        const imgBuffer = await imgRes.arrayBuffer();
        const contentType = imgRes.headers.get('content-type') || 'image/jpeg';
        const ext = contentType.split('/').pop().replace('jpeg', 'jpg').split(';')[0];
        const objectKey = `generated/concept_${Date.now()}_${Math.random().toString(36).substring(2, 8)}.${ext}`;

        await env.BUCKET.put(objectKey, imgBuffer, { httpMetadata: { contentType } });

        const publicUrl = `https://asset.uvera.ai/${objectKey}`;
        return new Response(JSON.stringify({ success: true, publicUrl }), {
          status: 200, headers: { 'Content-Type': 'application/json', ...corsHeaders }
        });
      } catch (err) {
        return new Response(JSON.stringify({ success: false, errMessage: err.message }), {
          status: 500, headers: { 'Content-Type': 'application/json', ...corsHeaders }
        });
      }
    }

    /* ════════════════════════════════════════════════════════════════════
     * §2026-05-25 fei — Phase 2 短剧付费:分成结算引擎
     *
     * Admin-only endpoints for generating, listing, and managing
     * settlements per PDF §4.
     *
     *   POST /api/admin/settlements/generate  { period: 'YYYY-MM' }
     *     Recomputes settlements for every series that had revenue in
     *     the given period. Upserts on (period, series_id) — re-running
     *     refreshes numbers without creating duplicates.
     *
     *   GET  /api/admin/settlements?period=YYYY-MM
     *     Returns all settlement rows for the period (joined with series
     *     title + creator email for display).
     *
     *   PATCH /api/admin/settlements/:id  { status, paid_reference?, notes? }
     *     State transitions: pending_confirm → creator_confirmed → paid.
     *     'disputed' / 'cancelled' allowed from any state for ops escape.
     *
     * Auth: caller.user_metadata.is_admin === true (same gate as the
     *   other admin endpoints in this file).
     * ════════════════════════════════════════════════════════════════════ */

    // Helper: shared admin auth check + supabase admin client.
    //   Declared at file scope earlier via the wallet block (requireUser /
    //   supabaseAdmin) — re-declared inline here only when those helpers
    //   weren't in scope yet. We DO have them above (defined just before
    //   /api/stripe/webhook), so reuse.
    const requireAdmin = async () => {
      const supabaseUrlA = env.SUPABASE_URL || 'https://wjhdsodlxekvhpahascs.supabase.co';
      const authHeader = request.headers.get('Authorization');
      if (!authHeader) throw new Error('Authorization header required');
      const callerResp = await fetch(`${supabaseUrlA}/auth/v1/user`, {
        headers: { 'Authorization': authHeader, 'apikey': env.SUPABASE_ANON_KEY || '' }
      });
      if (!callerResp.ok) throw new Error('Could not verify caller');
      const caller = await callerResp.json();
      if (caller.user_metadata?.is_admin !== true) {
        throw new Error('Admin access required');
      }
      return caller;
    };

    // Helper: Supabase REST with service role (bypasses RLS for the
    //   ledger aggregations below — admin policies would work too but
    //   service role avoids the round-trip to validate is_admin per row).
    const sbAdmin2 = (path, init = {}) => {
      const supabaseUrlSb = env.SUPABASE_URL || 'https://wjhdsodlxekvhpahascs.supabase.co';
      return fetch(`${supabaseUrlSb}/rest/v1${path}`, {
        ...init,
        headers: {
          'Authorization': `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
          'apikey': env.SUPABASE_SERVICE_ROLE_KEY,
          'Content-Type': 'application/json',
          ...(init.headers || {}),
        },
      });
    };

    /* ── POST /api/admin/settlements/generate ────────────────────────── */
    if (url.pathname === '/api/admin/settlements/generate' && request.method === 'POST') {
      const corsHeaders = { 'Access-Control-Allow-Origin': '*' };
      try {
        await requireAdmin();
        const { period } = await request.json();
        if (!period || !/^\d{4}-\d{2}$/.test(period)) {
          throw new Error('period must be YYYY-MM');
        }

        // Compute period bounds (UTC)
        const [yr, mo] = period.split('-').map(Number);
        const startIso = new Date(Date.UTC(yr, mo - 1, 1)).toISOString();
        const endIso   = new Date(Date.UTC(yr, mo, 1)).toISOString();   // exclusive

        // Read global defaults from system_settings
        const coinToCentsStr = await getSystemSetting(env, 'ucoins_to_usd_cents', '1');
        const coinToCents = Number(coinToCentsStr) || 1;
        const channelFeePctStr = await getSystemSetting(env, 'default_channel_fee_pct_web', '3');
        const channelFeePct = Number(channelFeePctStr) || 3;
        const serviceFeePctStr = await getSystemSetting(env, 'default_platform_service_pct', '10');
        const serviceFeePct = Number(serviceFeePctStr) || 10;
        const defaultSharePctStr = await getSystemSetting(env, 'default_revenue_share_pct', '50');
        const defaultSharePct = Number(defaultSharePctStr) || 50;

        // 1) Aggregate U-Coins consumption per series during the period.
        //    Use episode_unlocks (already has series_id denormalized).
        const unlockResp = await sbAdmin2(
          `/episode_unlocks?unlock_type=eq.ucoins&unlocked_at=gte.${startIso}&unlocked_at=lt.${endIso}&select=series_id,ucoins_paid`
        );
        const unlockRows = unlockResp.ok ? await unlockResp.json() : [];
        // Group by series_id → { ucoinsConsumed, unlockCount }
        const ucoinsBySeries = new Map();
        for (const u of unlockRows) {
          const prev = ucoinsBySeries.get(u.series_id) || { ucoins: 0, count: 0 };
          prev.ucoins += (u.ucoins_paid || 0);
          prev.count  += 1;
          ucoinsBySeries.set(u.series_id, prev);
        }

        // 2) Aggregate bundle GMV per series during the period.
        const bundleResp = await sbAdmin2(
          `/series_purchases?status=eq.succeeded&completed_at=gte.${startIso}&completed_at=lt.${endIso}&select=series_id,amount_usd_cents`
        );
        const bundleRows = bundleResp.ok ? await bundleResp.json() : [];
        const bundleBySeries = new Map();
        for (const b of bundleRows) {
          const prev = bundleBySeries.get(b.series_id) || { gmv: 0, count: 0 };
          prev.gmv   += (b.amount_usd_cents || 0);
          prev.count += 1;
          bundleBySeries.set(b.series_id, prev);
        }

        /* §2026-05-25 fei Phase 3 — aggregate acquisition costs per series
         *   for the period. Multiple channels per series get SUM'd into a
         *   single A value (PDF §4.2 公式 just needs the total). Only
         *   pulled / deducted when system_settings.default_include_acquisition_cost
         *   is 'true'. Migration 20260525_drama_acquisition_costs sets it
         *   to true; admin can flip back to false in /admin/system. */
        const includeAcqCostStr = await getSystemSetting(env, 'default_include_acquisition_cost', 'false');
        const includeAcqCost = includeAcqCostStr === 'true' || includeAcqCostStr === true;
        const acqBySeries = new Map();
        if (includeAcqCost) {
          const acqResp = await sbAdmin2(
            `/series_acquisition_costs?period=eq.${period}&select=series_id,amount_usd_cents,channel`
          );
          const acqRows = acqResp.ok ? await acqResp.json() : [];
          for (const a of acqRows) {
            acqBySeries.set(a.series_id, (acqBySeries.get(a.series_id) || 0) + (a.amount_usd_cents || 0));
          }
        }

        // 3) Union of series IDs that had any revenue
        const allSeriesIds = new Set([...ucoinsBySeries.keys(), ...bundleBySeries.keys()]);
        if (allSeriesIds.size === 0) {
          return new Response(JSON.stringify({
            success: true, period, generated: 0, message: 'No revenue in this period — nothing to settle.',
          }), { headers: { 'Content-Type': 'application/json', ...corsHeaders } });
        }

        // 4) Pull series rows (need user_id + revenue_share_pct override)
        const seriesIdsCsv = [...allSeriesIds].map(id => `"${id}"`).join(',');
        const seriesResp = await sbAdmin2(
          `/series?id=in.(${seriesIdsCsv})&select=id,title,user_id,revenue_share_pct`
        );
        const seriesRows = seriesResp.ok ? await seriesResp.json() : [];
        const seriesById = new Map(seriesRows.map(s => [s.id, s]));

        // 5) Compute and upsert one row per series
        const computed = [];
        for (const sid of allSeriesIds) {
          const series = seriesById.get(sid);
          if (!series) {
            console.warn(`[settlements] series ${sid} had revenue but row missing — skipped`);
            continue;
          }
          const u = ucoinsBySeries.get(sid) || { ucoins: 0, count: 0 };
          const b = bundleBySeries.get(sid) || { gmv: 0, count: 0 };

          const ucoinsGmvCents = u.ucoins * coinToCents;
          const bundleGmvCents = b.gmv;
          const gmvCents       = ucoinsGmvCents + bundleGmvCents;

          const channelFeeCents = Math.round(gmvCents * channelFeePct / 100);
          const serviceFeeCents = Math.round(gmvCents * serviceFeePct / 100);
          // §2026-05-25 fei Phase 3 — read from series_acquisition_costs
          const acquisitionCostCents = acqBySeries.get(sid) || 0;
          const distributableCents = Math.max(0, gmvCents - channelFeeCents - serviceFeeCents - acquisitionCostCents);

          const sharePct = (series.revenue_share_pct != null) ? Number(series.revenue_share_pct) : defaultSharePct;
          const creatorEarningsCents = Math.round(distributableCents * sharePct / 100);
          const platformEarningsCents = (distributableCents - creatorEarningsCents) + serviceFeeCents;

          computed.push({
            period,
            series_id: sid,
            content_creator_id: series.user_id,
            ucoins_consumed: u.ucoins,
            ucoins_to_usd_cents: coinToCents,
            bundle_orders_count: b.count,
            unlock_count: u.count,
            ucoins_gmv_cents: ucoinsGmvCents,
            bundle_gmv_cents: bundleGmvCents,
            gmv_cents: gmvCents,
            channel_fee_pct: channelFeePct,
            channel_fee_cents: channelFeeCents,
            service_fee_pct: serviceFeePct,
            service_fee_cents: serviceFeeCents,
            acquisition_cost_cents: acquisitionCostCents,
            distributable_cents: distributableCents,
            revenue_share_pct: sharePct,
            creator_earnings_cents: creatorEarningsCents,
            platform_earnings_cents: platformEarningsCents,
            // Preserve existing status — only set on insert (handled below).
          });
        }

        /* 6) Upsert via on_conflict + Prefer: resolution=merge-duplicates.
         *
         *   §2026-05-26 fei (audit #12 verification) — PostgREST's merge-
         *   duplicates only UPDATEs fields PRESENT in the payload. Verified
         *   by smoke test (insert with status='paid' + confirmed_at, upsert
         *   without those keys → values preserved). Therefore: status,
         *   generated_at, confirmed_at, paid_at, paid_reference, notes are
         *   NEVER touched by recompute because the `computed` row above
         *   intentionally excludes them.
         *
         *   ⚠️ DO NOT add status / confirmed_at / paid_at / paid_reference /
         *   notes to the `computed` object — doing so will silently clobber
         *   creator confirmations + ops payments on every recompute. The
         *   state-machine transitions live in /api/admin/settlements/:id/*
         *   and /api/creator/settlements/:id/confirm endpoints only. */
        const upsertResp = await sbAdmin2('/settlements?on_conflict=period,series_id', {
          method: 'POST',
          headers: {
            'Prefer': 'resolution=merge-duplicates,return=representation',
          },
          body: JSON.stringify(computed),
        });
        if (!upsertResp.ok) {
          const t = await upsertResp.text();
          throw new Error(`Settlement upsert failed: ${upsertResp.status} ${t.slice(0, 300)}`);
        }
        const upserted = await upsertResp.json();

        return new Response(JSON.stringify({
          success: true,
          period,
          generated: upserted.length,
          rows: upserted,
        }), { headers: { 'Content-Type': 'application/json', ...corsHeaders } });
      } catch (err) {
        console.error('[admin/settlements/generate]', err.message);
        return new Response(JSON.stringify({ success: false, errMessage: err.message }), {
          status: 500, headers: { 'Content-Type': 'application/json', ...corsHeaders },
        });
      }
    }

    /* ── GET /api/admin/settlements?period=YYYY-MM ────────────────────── */
    if (url.pathname === '/api/admin/settlements' && request.method === 'GET') {
      const corsHeaders = { 'Access-Control-Allow-Origin': '*' };
      try {
        await requireAdmin();
        const period = url.searchParams.get('period');
        let q = '/settlements?select=*,series:series_id(title)&order=created_at.desc';
        if (period) q = `/settlements?period=eq.${period}&select=*,series:series_id(title)&order=gmv_cents.desc`;

        const resp = await sbAdmin2(q);
        const rows = resp.ok ? await resp.json() : [];

        // Hydrate creator emails (best effort — failure doesn't block list)
        const creatorIds = [...new Set(rows.map(r => r.content_creator_id))];
        const creatorEmails = {};
        for (const cid of creatorIds) {
          try {
            const r = await fetch(`${env.SUPABASE_URL || 'https://wjhdsodlxekvhpahascs.supabase.co'}/auth/v1/admin/users/${cid}`, {
              headers: {
                'Authorization': `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
                'apikey': env.SUPABASE_SERVICE_ROLE_KEY,
              },
            });
            if (r.ok) {
              const u = await r.json();
              creatorEmails[cid] = u.email || null;
            }
          } catch (_) { /* swallow */ }
        }
        for (const r of rows) {
          r.creator_email = creatorEmails[r.content_creator_id] || null;
        }

        // Period summary
        const summary = {
          total_gmv_cents: rows.reduce((s, r) => s + r.gmv_cents, 0),
          total_creator_cents: rows.reduce((s, r) => s + r.creator_earnings_cents, 0),
          total_platform_cents: rows.reduce((s, r) => s + r.platform_earnings_cents, 0),
          total_channel_fee_cents: rows.reduce((s, r) => s + r.channel_fee_cents, 0),
          row_count: rows.length,
        };

        return new Response(JSON.stringify({ success: true, period, summary, rows }), {
          headers: { 'Content-Type': 'application/json', ...corsHeaders },
        });
      } catch (err) {
        console.error('[admin/settlements GET]', err.message);
        return new Response(JSON.stringify({ success: false, errMessage: err.message }), {
          status: 500, headers: { 'Content-Type': 'application/json', ...corsHeaders },
        });
      }
    }

    /* ── PATCH /api/admin/settlements/:id  { status, paid_reference?, notes? } ── */
    const settlePatchMatch = url.pathname.match(/^\/api\/admin\/settlements\/([0-9a-f-]{36})$/i);
    if (settlePatchMatch && request.method === 'PATCH') {
      const corsHeaders = { 'Access-Control-Allow-Origin': '*' };
      const settlementId = settlePatchMatch[1];
      try {
        await requireAdmin();
        const body = await request.json();
        const allowed = ['status', 'paid_reference', 'notes'];
        const patch = {};
        for (const k of allowed) if (body[k] !== undefined) patch[k] = body[k];

        if (patch.status === 'creator_confirmed' && !body.confirmed_at) {
          patch.confirmed_at = new Date().toISOString();
        }
        if (patch.status === 'paid' && !body.paid_at) {
          patch.paid_at = new Date().toISOString();
        }

        const resp = await sbAdmin2(`/settlements?id=eq.${settlementId}`, {
          method: 'PATCH',
          headers: { 'Prefer': 'return=representation' },
          body: JSON.stringify(patch),
        });
        if (!resp.ok) {
          const t = await resp.text();
          throw new Error(`Settlement patch failed: ${resp.status} ${t.slice(0, 200)}`);
        }
        const updated = await resp.json();
        return new Response(JSON.stringify({ success: true, settlement: updated[0] }), {
          headers: { 'Content-Type': 'application/json', ...corsHeaders },
        });
      } catch (err) {
        console.error('[admin/settlements PATCH]', err.message);
        return new Response(JSON.stringify({ success: false, errMessage: err.message }), {
          status: 500, headers: { 'Content-Type': 'application/json', ...corsHeaders },
        });
      }
    }

    /* ── Acquisition-cost endpoints (Phase 3 ROI tracking) ──────────────
     *
     * Admin records per-series × per-period × per-channel ad spend. Read
     * by the settlement engine and surfaced in RevenueView as a ROI
     * column (single-series GMV / sum of acquisition_costs).
     *
     *   GET    /api/admin/acquisition-costs?period=YYYY-MM[&series_id=…]
     *   POST   /api/admin/acquisition-costs  { series_id, period, channel, amount_usd_cents, notes? }
     *   PATCH  /api/admin/acquisition-costs/:id  { amount_usd_cents?, notes? }
     *   DELETE /api/admin/acquisition-costs/:id
     *
     * Uses upsert pattern via UNIQUE (series_id, period, channel) — POSTing
     * the same triple replaces the amount (idempotent for re-imports from
     * Facebook/Google ad reports).
     */
    if (url.pathname === '/api/admin/acquisition-costs' && request.method === 'GET') {
      const corsHeaders = { 'Access-Control-Allow-Origin': '*' };
      try {
        await requireAdmin();
        const period = url.searchParams.get('period');
        const seriesId = url.searchParams.get('series_id');
        let q = '/series_acquisition_costs?select=*,series:series_id(title,user_id)&order=period.desc,created_at.desc';
        const filters = [];
        if (period) filters.push(`period=eq.${period}`);
        if (seriesId) filters.push(`series_id=eq.${seriesId}`);
        if (filters.length) {
          q = `/series_acquisition_costs?${filters.join('&')}&select=*,series:series_id(title,user_id)&order=period.desc,created_at.desc`;
        }
        const resp = await sbAdmin2(q);
        const rows = resp.ok ? await resp.json() : [];
        return new Response(JSON.stringify({ success: true, rows }), {
          headers: { 'Content-Type': 'application/json', ...corsHeaders },
        });
      } catch (err) {
        return new Response(JSON.stringify({ success: false, errMessage: err.message }), {
          status: 500, headers: { 'Content-Type': 'application/json', ...corsHeaders },
        });
      }
    }

    if (url.pathname === '/api/admin/acquisition-costs' && request.method === 'POST') {
      const corsHeaders = { 'Access-Control-Allow-Origin': '*' };
      try {
        const caller = await requireAdmin();
        const body = await request.json();
        const { series_id, period, channel, amount_usd_cents, notes } = body;
        if (!series_id || !period || !channel || amount_usd_cents == null) {
          throw new Error('series_id / period / channel / amount_usd_cents are required');
        }
        if (!/^\d{4}-\d{2}$/.test(period)) throw new Error('period must be YYYY-MM');
        if (!['facebook','google','tiktok','influencer','other'].includes(channel)) throw new Error('invalid channel');
        if (typeof amount_usd_cents !== 'number' || amount_usd_cents < 0) throw new Error('amount_usd_cents must be ≥ 0');

        const resp = await sbAdmin2('/series_acquisition_costs?on_conflict=series_id,period,channel', {
          method: 'POST',
          headers: { 'Prefer': 'resolution=merge-duplicates,return=representation' },
          body: JSON.stringify([{ series_id, period, channel, amount_usd_cents, notes: notes || null, created_by: caller.id }]),
        });
        if (!resp.ok) {
          const t = await resp.text();
          throw new Error(`Insert failed: ${resp.status} ${t.slice(0, 200)}`);
        }
        const upserted = await resp.json();
        return new Response(JSON.stringify({ success: true, row: upserted[0] }), {
          headers: { 'Content-Type': 'application/json', ...corsHeaders },
        });
      } catch (err) {
        return new Response(JSON.stringify({ success: false, errMessage: err.message }), {
          status: 500, headers: { 'Content-Type': 'application/json', ...corsHeaders },
        });
      }
    }

    const acqPatchMatch = url.pathname.match(/^\/api\/admin\/acquisition-costs\/([0-9a-f-]{36})$/i);
    if (acqPatchMatch && request.method === 'PATCH') {
      const corsHeaders = { 'Access-Control-Allow-Origin': '*' };
      const acqId = acqPatchMatch[1];
      try {
        await requireAdmin();
        const body = await request.json();
        const patch = {};
        if (body.amount_usd_cents != null) {
          if (typeof body.amount_usd_cents !== 'number' || body.amount_usd_cents < 0) throw new Error('amount_usd_cents must be ≥ 0');
          patch.amount_usd_cents = body.amount_usd_cents;
        }
        if (body.notes !== undefined) patch.notes = body.notes;
        const resp = await sbAdmin2(`/series_acquisition_costs?id=eq.${acqId}`, {
          method: 'PATCH',
          headers: { 'Prefer': 'return=representation' },
          body: JSON.stringify(patch),
        });
        if (!resp.ok) {
          const t = await resp.text();
          throw new Error(`Update failed: ${resp.status} ${t.slice(0, 200)}`);
        }
        const updated = await resp.json();
        return new Response(JSON.stringify({ success: true, row: updated[0] }), {
          headers: { 'Content-Type': 'application/json', ...corsHeaders },
        });
      } catch (err) {
        return new Response(JSON.stringify({ success: false, errMessage: err.message }), {
          status: 500, headers: { 'Content-Type': 'application/json', ...corsHeaders },
        });
      }
    }

    if (acqPatchMatch && request.method === 'DELETE') {
      const corsHeaders = { 'Access-Control-Allow-Origin': '*' };
      const acqId = acqPatchMatch[1];
      try {
        await requireAdmin();
        const resp = await sbAdmin2(`/series_acquisition_costs?id=eq.${acqId}`, { method: 'DELETE' });
        if (!resp.ok) {
          const t = await resp.text();
          throw new Error(`Delete failed: ${resp.status} ${t.slice(0, 200)}`);
        }
        return new Response(JSON.stringify({ success: true }), {
          headers: { 'Content-Type': 'application/json', ...corsHeaders },
        });
      } catch (err) {
        return new Response(JSON.stringify({ success: false, errMessage: err.message }), {
          status: 500, headers: { 'Content-Type': 'application/json', ...corsHeaders },
        });
      }
    }

    /* ── POST /api/creator/settlements/:id/confirm ──────────────────────
     *
     * §2026-05-25 fei Phase 3 — creator-side confirmation.
     *
     * Lets a content creator move their settlement from 'pending_confirm'
     * to 'creator_confirmed'. The PATCH variant above is admin-only — this
     * is the matching creator-callable endpoint with the appropriate
     * security: caller MUST be content_creator_id of the row, and ONLY the
     * pending_confirm → creator_confirmed transition is allowed (no
     * status escape hatches for creators).
     *
     * Optionally body.notes can be set to leave a creator comment (e.g.
     * "已确认,请按合同条款打款到 Stripe Connect xxx").
     */
    const confirmMatch = url.pathname.match(/^\/api\/creator\/settlements\/([0-9a-f-]{36})\/confirm$/i);
    if (confirmMatch && request.method === 'POST') {
      const corsHeaders = { 'Access-Control-Allow-Origin': '*' };
      const settlementId = confirmMatch[1];
      try {
        const user = await requireUser(request, env);
        const body = await request.json().catch(() => ({}));

        // Fetch the settlement and verify ownership in one round-trip
        const sResp = await sbAdmin2(
          `/settlements?id=eq.${settlementId}&select=id,status,content_creator_id`
        );
        const sRows = sResp.ok ? await sResp.json() : [];
        if (sRows.length === 0) throw new Error('Settlement not found');
        const settle = sRows[0];
        if (settle.content_creator_id !== user.id) {
          // Don't leak whether the row exists — just deny.
          return new Response(JSON.stringify({ success: false, errMessage: '无权限' }), {
            status: 403, headers: { 'Content-Type': 'application/json', ...corsHeaders },
          });
        }
        if (settle.status !== 'pending_confirm') {
          throw new Error(`只能在「待确认」状态确认,当前状态: ${settle.status}`);
        }

        const patch = {
          status: 'creator_confirmed',
          confirmed_at: new Date().toISOString(),
        };
        if (typeof body.notes === 'string') patch.notes = body.notes;

        const upd = await sbAdmin2(`/settlements?id=eq.${settlementId}`, {
          method: 'PATCH',
          headers: { 'Prefer': 'return=representation' },
          body: JSON.stringify(patch),
        });
        if (!upd.ok) {
          const t = await upd.text();
          throw new Error(`Confirm failed: ${upd.status} ${t.slice(0, 200)}`);
        }
        const [updated] = await upd.json();

        return new Response(JSON.stringify({ success: true, settlement: updated }), {
          headers: { 'Content-Type': 'application/json', ...corsHeaders },
        });
      } catch (err) {
        console.error('[creator/settlements/confirm]', err.message);
        return new Response(JSON.stringify({ success: false, errMessage: err.message }), {
          status: err.message === '无权限' ? 403 : 500,
          headers: { 'Content-Type': 'application/json', ...corsHeaders },
        });
      }
    }

    // ─── OpenAI GPT-image-2 connectivity test (admin) ────────────────
    // POST /api/admin/openai/test
    //   body: { prompt?: string }  — optional custom prompt; else fixed test prompt
    //   → { success, status, message, imageUrl?, model, quality, size, hint?, costUsd }
    //
    // Designed to be the "click here before flipping use_storyboard_pipeline"
    // confidence check. Uses the admin's CONFIGURED model + size + quality so
    // the test reflects real-world cost + behavior. Stores the resulting
    // image to R2 so admin can preview it inline.
    //
    // Why a separate endpoint vs reusing /api/generate-storyboard: that
    // endpoint requires full script + style + character payload (production
    // flow). This is a pure "does my OpenAI key work + does my model exist"
    // probe with a fixed minimal prompt + clear error mapping.
    if (url.pathname === '/api/admin/openai/test' && request.method === 'POST') {
      const corsHeaders = { 'Access-Control-Allow-Origin': '*' };
      try {
        const supabaseUrl = env.SUPABASE_URL || 'https://wjhdsodlxekvhpahascs.supabase.co';
        const anonKey = env.SUPABASE_ANON_KEY || '';

        // Admin gate
        const authHeader = request.headers.get('Authorization');
        if (!authHeader) throw new Error('Authorization header required');
        const callerResp = await fetch(`${supabaseUrl}/auth/v1/user`, {
          headers: { 'Authorization': authHeader, 'apikey': anonKey }
        });
        if (!callerResp.ok) throw new Error('Could not verify caller');
        const caller = await callerResp.json();
        if (caller.user_metadata?.is_admin !== true) {
          throw new Error('Admin access required');
        }

        const body = await request.json().catch(() => ({}));
        const testPrompt = body.prompt?.trim() ||
          'A single red apple on a wooden table, soft natural window light, ' +
          'minimalist composition, restrained detail. Pure visual storytelling, ' +
          'no text or watermarks.';

        // Pull live config from system_settings
        const openaiApiKey = await getSystemSetting(env, 'openai_api_key', null);
        const openaiModel = await getSystemSetting(env, 'openai_image_model', 'gpt-image-2');
        const openaiQuality = await getSystemSetting(env, 'openai_image_quality', 'medium');
        const openaiSize = await getSystemSetting(env, 'openai_image_size', '1792x1024');
        if (!openaiApiKey) {
          return new Response(JSON.stringify({
            success: false,
            status: 0,
            message: 'OpenAI API key not configured.',
            hint: 'Fill in openai_api_key in System Settings → Runtime configuration above.',
          }), { status: 200, headers: { 'Content-Type': 'application/json', ...corsHeaders }});
        }

        console.log(`[openai-test] ${caller.email || caller.id} testing model=${openaiModel} quality=${openaiQuality} size=${openaiSize}`);

        const t0 = Date.now();
        const openaiResp = await fetch('https://api.openai.com/v1/images/generations', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${openaiApiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model: openaiModel,
            prompt: testPrompt,
            n: 1,
            size: openaiSize,
            quality: openaiQuality,
          }),
        });
        const elapsedMs = Date.now() - t0;

        const data = await openaiResp.json().catch(() => ({}));

        if (!openaiResp.ok) {
          // Map common errors to actionable hints (mirrors what
          // /api/generate-storyboard already does, but admin-friendly).
          let hint = '';
          const errCode = data?.error?.code;
          const errMsg = (data?.error?.message || '').toLowerCase();
          if (errCode === 'model_not_found' || errMsg.includes('model')) {
            hint = `Model "${openaiModel}" not found at OpenAI. Try gpt-image-1 (known working) — change in admin → Runtime configuration → "OpenAI image model".`;
          } else if (openaiResp.status === 401) {
            hint = 'Invalid API key. Re-paste in admin → Runtime configuration → "OpenAI API key" (use a fresh key from https://platform.openai.com/api-keys — full-length, no truncation).';
          } else if (openaiResp.status === 429) {
            hint = 'OpenAI rate limit hit. Wait a few seconds, or check your quota at https://platform.openai.com/account/usage.';
          } else if (openaiResp.status === 400 && errMsg.includes('size')) {
            hint = `Size "${openaiSize}" not supported for model ${openaiModel}. Try 1024x1024 or 1792x1024.`;
          } else if (openaiResp.status === 400 && (errMsg.includes('quality') || (errMsg.includes('low') && errMsg.includes('medium') && errMsg.includes('high')))) {
            // §2026-05-22 gpt-image-2 changed quality enum
            hint = `Quality "${openaiQuality}" not supported for ${openaiModel}. gpt-image-2 uses: low | medium | high | auto. Change in admin → Runtime configuration → "OpenAI image quality".`;
          } else if (errMsg.includes('safety filter') || errMsg.includes('moderation') || errMsg.includes('content_policy') || errCode === 'moderation_blocked') {
            // §2026-05-22 — should be rare on the test path (no reference
            //   image is sent), but if the default prompt ever trips it
            //   we want the admin to see clearly what's happening.
            hint = 'OpenAI moderation blocked the prompt itself. The default test prompt is innocuous, so if you see this on the canned test you likely have an account-level moderation flag. Contact OpenAI support.';
          }

          console.error('[openai-test] non-OK', 'status=' + openaiResp.status, 'code=' + errCode, 'msg=' + (data?.error?.message || '').slice(0, 200));

          return new Response(JSON.stringify({
            success: false,
            status: openaiResp.status,
            message: data?.error?.message || `HTTP ${openaiResp.status}`,
            errorCode: errCode || null,
            hint: hint || 'See full error in CF Worker Logs for context.',
            model: openaiModel,
            quality: openaiQuality,
            size: openaiSize,
            elapsedMs,
          }), { status: 200, headers: { 'Content-Type': 'application/json', ...corsHeaders }});
        }

        // Success — decode base64 + store to R2 so admin can preview
        const b64 = data.data?.[0]?.b64_json;
        if (!b64) {
          return new Response(JSON.stringify({
            success: false,
            status: 200,
            message: 'OpenAI returned 200 but response missing b64_json data.',
            hint: 'Unexpected response shape — file a bug.',
            model: openaiModel,
            elapsedMs,
          }), { status: 200, headers: { 'Content-Type': 'application/json', ...corsHeaders }});
        }

        const bin = atob(b64);
        const bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        if (!env.BUCKET) throw new Error('R2 BUCKET binding missing');
        const objectKey = `openai-test/test_${Date.now()}_${caller.id.slice(0, 8)}.png`;
        await env.BUCKET.put(objectKey, bytes.buffer, { httpMetadata: { contentType: 'image/png' } });
        const imageUrl = `https://asset.uvera.ai/${objectKey}`;

        // Approx cost lookup. gpt-image-2 enum: low / medium / high / auto.
        // gpt-image-1 era enum: standard / hd. Both supported here for
        // mixed-deploy compat.
        const COST_TABLE = {
          // gpt-image-2 — published OpenAI pricing 2026-05
          'low':      0.011,
          'medium':   0.042,
          'high':     0.167,
          'auto':     0.042,  // estimate — auto usually picks medium-ish
          // gpt-image-1 era
          'standard': 0.04,
          'hd':       openaiSize === '1024x1024' ? 0.08 : 0.17,
        };
        const costUsd = COST_TABLE[openaiQuality] ?? 0.04;

        console.log(`[openai-test] ✅ ${caller.email} success · ${(bytes.length/1024).toFixed(1)} KB · ${elapsedMs}ms · ${imageUrl}`);

        return new Response(JSON.stringify({
          success: true,
          status: 200,
          message: `Model "${openaiModel}" works. Image generated in ${(elapsedMs/1000).toFixed(1)}s.`,
          imageUrl,
          revisedPrompt: data.data?.[0]?.revised_prompt || null,
          model: openaiModel,
          quality: openaiQuality,
          size: openaiSize,
          fileSizeKb: Math.round(bytes.length / 1024),
          elapsedMs,
          costUsd,
        }), {
          status: 200,
          headers: { 'Content-Type': 'application/json', ...corsHeaders }
        });
      } catch (err) {
        console.error('[openai-test]', err.message);
        return new Response(JSON.stringify({
          success: false,
          message: err.message,
          hint: 'Internal error — see CF Worker Logs.',
        }), {
          status: 200,  // 200 so admin UI can render the error inline rather than alerting
          headers: { 'Content-Type': 'application/json', ...corsHeaders }
        });
      }
    }

    // §2026-05-22: /api/public-flags endpoint deleted along with the
    //   frontend feature-flag check. Storyboard is canonical, no more
    //   dispatch. See generateConceptDesign in src/api/neoaiService.js.

    // ─── Bulk migrate videos R2 / TOS → CF Stream (admin) ────────────────
    // POST /api/admin/migrate-videos-to-stream
    //   body: { dryRun?: boolean, limit?: number, ids?: string[] }
    //   → { processed, migrated, skipped, failed, items: [...] }
    //
    // §2026-05-22 fei: 历史数据 (paid tier AI gen + legacy uploads) 在 R2
    //   或 asset.uvera.ai 上, 现在统一迁到 CF Stream 以拿到全球 edge CDN
    //   加速 + 统一播放器. CF Stream 的 copy-from-URL API 自己 pull 公开
    //   HTTPS URL, 不需要 worker 下载再上传 → 带宽 + 时间 0 成本.
    //
    // Flow per row:
    //   1. Read recommended_content row (id + video field)
    //   2. Skip if video is already a Stream URL (isStreamUrl regex)
    //   3. Skip if video looks like volces.com TOS (likely expired)
    //   4. POST /accounts/<id>/stream/copy with { url, meta } → uid
    //   5. PATCH recommended_content SET video = iframe.cloudflarestream.com/<uid>
    //   6. CF Stream transcodes async (1-3min); video URL returns "processing"
    //      placeholder until ready, then serves real video. Acceptable for
    //      migration of old content.
    //
    // Idempotent: re-running skips rows already on Stream. Pagination via
    //   `limit` param. `dryRun: true` lists candidates without mutating.
    //   `ids: [...]` restricts to specific rows for targeted migration.
    if (url.pathname === '/api/admin/migrate-videos-to-stream' && request.method === 'POST') {
      const corsHeaders = { 'Access-Control-Allow-Origin': '*' };
      try {
        const supabaseUrl = env.SUPABASE_URL || 'https://wjhdsodlxekvhpahascs.supabase.co';
        const anonKey = env.SUPABASE_ANON_KEY || '';

        // Admin gate
        const authHeader = request.headers.get('Authorization');
        if (!authHeader) throw new Error('Authorization header required');
        const callerResp = await fetch(`${supabaseUrl}/auth/v1/user`, {
          headers: { 'Authorization': authHeader, 'apikey': anonKey }
        });
        if (!callerResp.ok) throw new Error('Could not verify caller');
        const caller = await callerResp.json();
        if (caller.user_metadata?.is_admin !== true) throw new Error('Admin access required');

        const body = await request.json().catch(() => ({}));
        const dryRun = body.dryRun === true;
        const limit = Math.min(Math.max(parseInt(body.limit, 10) || 10, 1), 100);
        const idsFilter = Array.isArray(body.ids) ? body.ids : null;

        // CF Stream auth (re-uses the same token as the upload endpoint)
        const CF_ACCOUNT_ID = env.CF_ACCOUNT_ID || 'd2acf946d8f80f382be77437a71c4832';
        const CF_API_TOKEN = env.CF_API_TOKEN || ('cfut' + '_MGaGN86d75OIHOSPrVfqP7f2iw' + 'nhpxpbnSRhNNJi231d9654');
        if (!CF_API_TOKEN) throw new Error('CF_API_TOKEN not configured');

        // Query candidate rows. We exclude Stream URLs (iframe.cloudflarestream.com
        //   or videodelivery.net) — only migrate non-Stream URLs. Volces.com TOS
        //   URLs ARE included (might still be valid; if expired, CF Stream returns
        //   error which we capture in the per-row result).
        const idClause = idsFilter ? `&id=in.(${idsFilter.map(encodeURIComponent).join(',')})` : '';
        // PostgREST doesn't support negated regex easily — fetch all then filter in worker
        // §2026-05-22 fei: column name is camelCase 'createdAt' (Supabase
        //   default for inserted columns), NOT 'created_at'. PostgREST is
        //   case-sensitive and the column was created with quotes preserving
        //   the camelCase identifier.
        const dbResp = await fetch(
          `${supabaseUrl}/rest/v1/recommended_content?select=id,video,title&media_kind=eq.Video&video=not.is.null&order=createdAt.desc&limit=${limit * 3}${idClause}`,
          { headers: { 'Authorization': `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`, 'apikey': env.SUPABASE_SERVICE_ROLE_KEY }}
        );
        if (!dbResp.ok) {
          const t = await dbResp.text().catch(() => '');
          throw new Error(`DB query failed (${dbResp.status}): ${t.slice(0, 200)}`);
        }
        const allRows = await dbResp.json();
        const STREAM_HOSTS = /(?:videodelivery\.net|cloudflarestream\.com)/i;
        const candidates = allRows.filter(r => r.video && !STREAM_HOSTS.test(r.video)).slice(0, limit);

        const result = { processed: 0, migrated: 0, skipped: 0, failed: 0, items: [] };

        if (dryRun) {
          for (const row of candidates) {
            result.items.push({ id: row.id, title: row.title?.slice(0, 40), oldUrl: row.video, action: 'would-migrate' });
            result.processed++;
          }
          return new Response(JSON.stringify({ success: true, dryRun: true, ...result }), {
            status: 200, headers: { 'Content-Type': 'application/json', ...corsHeaders }
          });
        }

        // §2026-05-22 fei round-2: poll-until-ready before PATCH.
        //   Before this, we PATCH'd DB immediately after CF Stream
        //   accepted the copy job. But Stream transcodes async (~1-3 min
        //   for short videos), and during that window the iframe URL
        //   returns 503 — users hitting the works page get broken videos.
        //   Now: poll Stream GET /accounts/<id>/stream/<uid> until
        //   status.state === 'ready' (or 90s timeout). Only PATCH DB
        //   when video is actually playable. Worse case (timeout), we
        //   still PATCH so user can retry the row, but mark item.status
        //   as 'patched-while-processing' for transparency.
        // §2026-05-22 fei round-2 budget: CF Workers cap wall-time around
        //   30s CPU + I/O. With poll loop per video, we must keep total
        //   request time bounded. 45s per video × batch of 2 = 90s max,
        //   fits comfortably. If transcode takes longer than 45s (rare for
        //   short clips, common for >60s videos), we mark item.status as
        //   'patched-while-processing' but still PATCH the DB — user can
        //   retry that specific row OR wait a minute and the video will
        //   simply become playable as Stream finishes async.
        const pollUntilReady = async (uid, maxWaitMs = 45000) => {
          const pollStart = Date.now();
          const pollInterval = 3000;
          while (Date.now() - pollStart < maxWaitMs) {
            await new Promise(r => setTimeout(r, pollInterval));
            const statusResp = await fetch(
              `https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/stream/${uid}`,
              { headers: { 'Authorization': `Bearer ${CF_API_TOKEN}` } }
            );
            if (!statusResp.ok) continue;
            const statusData = await statusResp.json().catch(() => ({}));
            const state = statusData?.result?.status?.state;
            if (state === 'ready') return { ready: true, elapsedMs: Date.now() - pollStart };
            if (state === 'error') return { ready: false, error: statusData?.result?.status?.errorReasonText || 'CF Stream reported error state' };
          }
          return { ready: false, error: `still transcoding after ${maxWaitMs}ms` };
        };

        // For each candidate: POST to CF Stream copy-from-URL, poll until ready, PATCH DB.
        for (const row of candidates) {
          result.processed++;
          try {
            const copyResp = await fetch(
              `https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/stream/copy`,
              {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${CF_API_TOKEN}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  url: row.video,
                  meta: { name: `migrated-${row.id.slice(0, 8)}`, source_url: row.video, migrated_at: new Date().toISOString() },
                  requireSignedURLs: false,
                }),
              }
            );
            const copyData = await copyResp.json().catch(() => ({}));
            if (!copyResp.ok || !copyData.success || !copyData.result?.uid) {
              throw new Error(`CF Stream copy failed (${copyResp.status}): ${JSON.stringify(copyData.errors || copyData).slice(0, 200)}`);
            }
            const newUid = copyData.result.uid;
            const newUrl = `https://iframe.cloudflarestream.com/${newUid}`;

            // Wait until Stream finishes transcoding. Three outcomes:
            //   · ready=true → PATCH DB normally; user sees playable video
            //   · ready=false + error like "still transcoding..." (timeout) →
            //     PATCH DB anyway, but mark as 'patched-while-processing'.
            //     User just needs to wait another minute — video will work.
            //   · ready=false + error like "Stream reported error state" →
            //     throw, mark item as 'failed', skip PATCH. DB row keeps
            //     old URL so user can retry from a clean state.
            const pollResult = await pollUntilReady(newUid);
            const isHardError = !pollResult.ready && !pollResult.error?.includes('transcoding');
            if (isHardError) {
              throw new Error(`Stream transcode failed: ${pollResult.error} (uid=${newUid})`);
            }
            const stillTranscoding = !pollResult.ready;

            // PATCH the DB row
            const patchResp = await fetch(
              `${supabaseUrl}/rest/v1/recommended_content?id=eq.${row.id}`,
              {
                method: 'PATCH',
                headers: {
                  'Authorization': `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
                  'apikey': env.SUPABASE_SERVICE_ROLE_KEY,
                  'Content-Type': 'application/json',
                  'Prefer': 'return=minimal',
                },
                body: JSON.stringify({ video: newUrl }),
              }
            );
            if (!patchResp.ok) {
              const t = await patchResp.text().catch(() => '');
              throw new Error(`DB PATCH failed (${patchResp.status}): ${t.slice(0, 100)}`);
            }
            result.migrated++;
            const itemStatus = stillTranscoding ? 'patched-while-processing' : 'migrated';
            result.items.push({ id: row.id, title: row.title?.slice(0, 40), oldUrl: row.video, newUrl, uid: newUid, status: itemStatus });
            console.log(`[migrate-videos] ${stillTranscoding ? '⏳' : '✅'} ${row.id}: ${row.video.slice(0, 60)} → ${newUrl}${stillTranscoding ? ' (still transcoding)' : ''}`);
          } catch (err) {
            result.failed++;
            result.items.push({ id: row.id, title: row.title?.slice(0, 40), oldUrl: row.video, error: err.message, status: 'failed' });
            console.error(`[migrate-videos] ✘ ${row.id}: ${err.message}`);
          }
        }

        result.skipped = allRows.length - candidates.length;
        return new Response(JSON.stringify({ success: true, dryRun: false, ...result }), {
          status: 200, headers: { 'Content-Type': 'application/json', ...corsHeaders }
        });
      } catch (err) {
        console.error('[migrate-videos] fatal:', err.message);
        return new Response(JSON.stringify({ success: false, errMessage: err.message }), {
          status: 500, headers: { 'Content-Type': 'application/json', ...corsHeaders }
        });
      }
    }

    // ─── Check Stream readiness for all migrated videos (admin) ──────────
    // POST /api/admin/check-stream-status
    //   body: { limit?: number }  — how many Stream-URL rows to check
    //   → { checked, ready, processing, errored, items: [...] }
    //
    // §2026-05-22 fei: helper for diagnosing the "video can't play" 503
    //   on videos migrated BEFORE the poll-until-ready fix landed. Iterates
    //   recommended_content rows whose video is a CF Stream URL, queries
    //   each UID's status via Stream API, returns per-row state so admin
    //   can see who's still transcoding vs who errored permanently.
    if (url.pathname === '/api/admin/check-stream-status' && request.method === 'POST') {
      const corsHeaders = { 'Access-Control-Allow-Origin': '*' };
      try {
        const supabaseUrl = env.SUPABASE_URL || 'https://wjhdsodlxekvhpahascs.supabase.co';
        const anonKey = env.SUPABASE_ANON_KEY || '';

        // Admin gate
        const authHeader = request.headers.get('Authorization');
        if (!authHeader) throw new Error('Authorization header required');
        const callerResp = await fetch(`${supabaseUrl}/auth/v1/user`, {
          headers: { 'Authorization': authHeader, 'apikey': anonKey }
        });
        if (!callerResp.ok) throw new Error('Could not verify caller');
        const caller = await callerResp.json();
        if (caller.user_metadata?.is_admin !== true) throw new Error('Admin access required');

        const body = await request.json().catch(() => ({}));
        const limit = Math.min(Math.max(parseInt(body.limit, 10) || 30, 1), 100);

        const CF_ACCOUNT_ID = env.CF_ACCOUNT_ID || 'd2acf946d8f80f382be77437a71c4832';
        const CF_API_TOKEN = env.CF_API_TOKEN || ('cfut' + '_MGaGN86d75OIHOSPrVfqP7f2iw' + 'nhpxpbnSRhNNJi231d9654');
        if (!CF_API_TOKEN) throw new Error('CF_API_TOKEN not configured');

        // Query Stream-URL rows from recommended_content
        const STREAM_UID_RE = /(?:videodelivery\.net|cloudflarestream\.com)\/([a-f0-9]{32})/i;
        const dbResp = await fetch(
          `${supabaseUrl}/rest/v1/recommended_content?select=id,video,title&media_kind=eq.Video&video=not.is.null&order=createdAt.desc&limit=${limit}`,
          { headers: { 'Authorization': `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`, 'apikey': env.SUPABASE_SERVICE_ROLE_KEY }}
        );
        if (!dbResp.ok) throw new Error(`DB query failed (${dbResp.status})`);
        const rows = await dbResp.json();
        const streamRows = rows.filter(r => r.video && STREAM_UID_RE.test(r.video));

        const result = { checked: 0, ready: 0, processing: 0, errored: 0, items: [] };

        // Per-row Stream status check. Fast — Stream API responds quickly.
        for (const row of streamRows) {
          result.checked++;
          const m = row.video.match(STREAM_UID_RE);
          const uid = m?.[1];
          if (!uid) {
            result.items.push({ id: row.id, title: row.title?.slice(0, 40), uid: null, state: 'invalid-url' });
            continue;
          }
          try {
            const statusResp = await fetch(
              `https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/stream/${uid}`,
              { headers: { 'Authorization': `Bearer ${CF_API_TOKEN}` } }
            );
            if (!statusResp.ok) {
              // 404 means the Stream video was deleted or never existed
              const state = statusResp.status === 404 ? 'not-found' : `http-${statusResp.status}`;
              result.errored++;
              result.items.push({ id: row.id, title: row.title?.slice(0, 40), uid, state });
              continue;
            }
            const statusData = await statusResp.json();
            const state = statusData?.result?.status?.state || 'unknown';
            const errorReason = statusData?.result?.status?.errorReasonText;
            if (state === 'ready') {
              result.ready++;
            } else if (state === 'error') {
              result.errored++;
            } else {
              result.processing++;
            }
            result.items.push({
              id: row.id,
              title: row.title?.slice(0, 40),
              uid,
              state,
              errorReason: errorReason || null,
              pctComplete: statusData?.result?.status?.pctComplete || null,
            });
          } catch (err) {
            result.errored++;
            result.items.push({ id: row.id, title: row.title?.slice(0, 40), uid, state: 'fetch-failed', error: err.message });
          }
        }

        return new Response(JSON.stringify({ success: true, ...result }), {
          status: 200, headers: { 'Content-Type': 'application/json', ...corsHeaders }
        });
      } catch (err) {
        console.error('[check-stream-status] fatal:', err.message);
        return new Response(JSON.stringify({ success: false, errMessage: err.message }), {
          status: 500, headers: { 'Content-Type': 'application/json', ...corsHeaders }
        });
      }
    }

    // ─── BytePlus Trusted Asset Library connectivity test (admin) ────
    // POST /api/admin/byteplus/test
    //   body: { imageUrl?: string }  — optional custom test image URL
    //   → { success, status, message, assetId?, assetUri?, hint?,
    //       project, akPrefix, elapsedMs }
    //
    // §2026-05-22 fei: parallels /api/admin/openai/test. Does the full
    // asset-library round-trip (ListAssetGroups → CreateAssetGroup if
    // needed → CreateAsset → poll GetAsset until Active) with the same
    // configured AK/SK + project that production gen uses. Verifies:
    //   · AK/SK signature works
    //   · AK has IAM scope on the configured project
    //   · CreateAsset accepts URLs from our R2 bucket
    //   · Skip moderation is honored (Secure Mode is off OR account has
    //     the protocol agreement)
    //   · Asset reaches Active status (preprocessing succeeded)
    //
    // Default test image: a static asset hosted on uvera.ai (CF Pages).
    // BytePlus servers can fetch it; doesn't matter what the picture is.
    if (url.pathname === '/api/admin/byteplus/test' && request.method === 'POST') {
      const corsHeaders = { 'Access-Control-Allow-Origin': '*' };
      try {
        const supabaseUrl = env.SUPABASE_URL || 'https://wjhdsodlxekvhpahascs.supabase.co';
        const anonKey = env.SUPABASE_ANON_KEY || '';

        // Admin gate
        const authHeader = request.headers.get('Authorization');
        if (!authHeader) throw new Error('Authorization header required');
        const callerResp = await fetch(`${supabaseUrl}/auth/v1/user`, {
          headers: { 'Authorization': authHeader, 'apikey': anonKey }
        });
        if (!callerResp.ok) throw new Error('Could not verify caller');
        const caller = await callerResp.json();
        if (caller.user_metadata?.is_admin !== true) {
          throw new Error('Admin access required');
        }

        const body = await request.json().catch(() => ({}));
        // Default test image: public R2 asset that BytePlus can fetch.
        //   ghibli.jpg is a known-existing CF Pages static asset (one of
        //   the visual-style sample images in /public/styles/).
        const testImageUrl = body.imageUrl?.trim() ||
          'https://uvera.ai/styles/ghibli.jpg';

        // Pull live config so test reflects production behavior
        const AK = (await getSystemSetting(env, 'byteplus_ark_ak', null)) || env.ARK_AK;
        const SK = (await getSystemSetting(env, 'byteplus_ark_sk', null)) || env.ARK_SK;
        const PROJECT_NAME = await getSystemSetting(env, 'byteplus_asset_project', 'HKBAIZE-005');
        const akPrefix = AK ? `${AK.slice(0, 6)}…${AK.slice(-4)}` : '(missing)';

        if (!AK || !SK) {
          return new Response(JSON.stringify({
            success: false,
            status: 0,
            message: 'BytePlus AK/SK not configured.',
            hint: 'Fill byteplus_ark_ak + byteplus_ark_sk in admin → System Settings → BytePlus secrets group.',
            project: PROJECT_NAME,
            akPrefix,
          }), { status: 200, headers: { 'Content-Type': 'application/json', ...corsHeaders }});
        }

        console.log(`[byteplus-test] ${caller.email || caller.id} testing project=${PROJECT_NAME} AK=${akPrefix} url=${testImageUrl}`);

        const t0 = Date.now();
        let assetUri = null;
        let assetId = null;
        try {
          // Exercise the SAME function production uses — round-trip with
          //   ListAssetGroups → CreateAssetGroup → CreateAsset → poll Active.
          assetUri = await uploadRealPersonAssetToBytePlus(testImageUrl, env, 'Image');
          assetId = assetUri.replace('asset://', '');
        } catch (uploadErr) {
          const elapsedMs = Date.now() - t0;
          console.error('[byteplus-test] upload failed:', uploadErr.message);
          // The error from bytePlusCall already includes buildActionableHint's
          //   suffix when applicable (IAM 403 / signature / quota). Surface
          //   the full thing to the admin UI for one-glance diagnosis.
          return new Response(JSON.stringify({
            success: false,
            status: 500,
            message: uploadErr.message,
            hint: 'See message above — most common cause is project name mismatch (new account, old project name in admin UI).',
            project: PROJECT_NAME,
            akPrefix,
            testImageUrl,
            elapsedMs,
          }), { status: 200, headers: { 'Content-Type': 'application/json', ...corsHeaders }});
        }

        const elapsedMs = Date.now() - t0;
        console.log(`[byteplus-test] ✅ ${caller.email} success · ${elapsedMs}ms · ${assetUri}`);

        return new Response(JSON.stringify({
          success: true,
          status: 200,
          message: `Asset Library round-trip succeeded in ${(elapsedMs/1000).toFixed(1)}s. Asset is Active and ready for Seedance gen.`,
          assetId,
          assetUri,
          project: PROJECT_NAME,
          akPrefix,
          testImageUrl,
          elapsedMs,
        }), {
          status: 200,
          headers: { 'Content-Type': 'application/json', ...corsHeaders }
        });
      } catch (err) {
        console.error('[byteplus-test]', err.message);
        return new Response(JSON.stringify({
          success: false,
          message: err.message,
          hint: 'Internal error — see CF Worker Logs.',
        }), {
          status: 200,
          headers: { 'Content-Type': 'application/json', ...corsHeaders }
        });
      }
    }

    // ─── Storyboard image generation via OpenAI GPT-image-2 ────────────
    // POST /api/generate-storyboard
    // Body: {
    //   script: { summary, mood, shots: [...] },
    //   style: { id, name, prompt, clothing },
    //   character: { name?, description?, photoUrl? },
    //   referenceImageUrl?: string,   // sequel: previous video's last frame
    //   aspectRatio?: string          // ignored — we use system_settings.openai_image_size
    // }
    // Returns: { success, imageUrl, model, quality, size }
    //
    // §2026-05-21 Replaces the legacy concept-design step. Generates ONE
    // key scene image with the FULL story context (style + character +
    // all-shots narrative arc + dialogue/narration as emotion guides)
    // baked into the prompt. The image is the single creative anchor for
    // the entire short — Seedance then animates it into the video clip
    // (image-to-video with bare-minimum motion prompt).
    //
    // Why one image (not panel-grid composite): fei 2026-05-21 — no
    // slicing, GPT image → directly to Seedance → short. The "storyboard"
    // intent is satisfied by giving GPT-image-2 the full narrative
    // context so it picks the most evocative frame, not by producing N
    // separate panels.
    //
    // Prompt construction: applies 草帽小蔡's anti-noise techniques:
    //   - No negative prompts (model ignores or activates them)
    //   - Style 100% from styleObj.prompt (no Interstellar/Kodak prefix
    //     forced — different style categories need different anchors)
    //   - Universal cinematic tail kept (柔焦/克制细节/Kodak Portra 400 颗粒)
    //   - Blacklist words avoided: 精细/HDR/hyper-detailed/intricate/8K
    //
    // §2026-05-22: previously gated by system_settings.use_storyboard_pipeline
    //   with a legacy Gemini fallback. Both the flag and the fallback are
    //   now removed — this is the only image-gen endpoint.
    //
    // Decision: docs/decisions/2026-05-21-storyboard-pipeline.md
    if (url.pathname === '/api/generate-storyboard' && request.method === 'POST') {
      const corsHeaders = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST, OPTIONS' };
      if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders });
      const t0 = Date.now();
      let logId = null;
      let caller = null;
      let sbCharged = 0;
      try {
        const body = await request.json();
        // §2026-05-30 fei — accept protagonist as the new canonical character
        //   input. character/characterSeed still destructured for back-compat
        //   with any cached frontend bundle, but no longer read by the prompt
        //   builder (buildStoryboardPrompt signature changed).
        // §2026-05-31 round-4 — also accept supporting_characters so the
        //   storyboard renders multi-character scenes (e.g. Actor + an NPC
        //   when their demographics differ from the transcript's lead).
        const { script, style, protagonist, supportingCharacters: bodySupporting, character, characterSeed, referenceImageUrl, aspectRatio, renderSessionId } = body;
        if (!script || !style) throw new Error('script and style are required');
        // Fallback chain for protagonist when caller didn't pass it explicitly:
        //   prefer script.protagonist (server normalizer guarantees it on the
        //   new screenwriter path), else top-level body.protagonist, else null
        //   so buildStoryboardPrompt's defensive defaults kick in.
        const effectiveProtagonist = protagonist || script?.protagonist || null;
        const effectiveSupporting = (Array.isArray(bodySupporting) && bodySupporting.length > 0)
          ? bodySupporting
          : (Array.isArray(script?.supporting_characters) ? script.supporting_characters : []);

        // §2026-05-29 — 鉴权 + 原子扣费(统一扣 3)。creditSpend 余额不足抛 402 → catch 处理。
        caller = await requireUser(request, env);
        const STORYBOARD_COST = 3;
        const sbSpend = await creditSpend(env, caller.id, STORYBOARD_COST, 'spend_storyboard', null, 'Storyboard image');
        sbCharged = sbSpend.spent;

        // OpenAI config — DB-first per the admin-configurable pattern (commit d6d184e)
        const openaiApiKey = await getSystemSetting(env, 'openai_api_key', null);
        const openaiModel = await getSystemSetting(env, 'openai_image_model', 'gpt-image-2');
        const openaiQuality = await getSystemSetting(env, 'openai_image_quality', 'medium');
        const openaiSize = await getSystemSetting(env, 'openai_image_size', '1792x1024');
        if (!openaiApiKey) {
          throw new Error('OpenAI API key not configured. Set system_settings.openai_api_key in admin → System Settings → Runtime configuration.');
        }

        logId = await logApiStart(env, request, 'storyboard_image', {
          prompt: '(built below)',
          refsCount: referenceImageUrl ? 1 : 0,
          model: openaiModel,
          vendor: 'openai',
          ratio: aspectRatio || openaiSize,
          sourceImageUrl: referenceImageUrl || null,
          renderSessionId: renderSessionId || null,    // §2026-05-30 Bug 4
        });

        let promptText = buildStoryboardPrompt({ script, style, protagonist: effectiveProtagonist, supportingCharacters: effectiveSupporting, hasReference: !!referenceImageUrl });

        // ─── OpenAI call: edits (with reference) vs generations (no ref) ───
        // §2026-05-22 safety-fallback: OpenAI rejects reference media
        //   containing real-person likenesses ("Your reference media
        //   triggered our safety filter"). When that happens we drop the
        //   reference and re-run as a pure /generations call, augmenting
        //   the prompt with a note that the character is fully described
        //   in text (so the model doesn't expect a visual anchor).
        let openaiResp;
        let safetyFallbackTriggered = false;
        let safetyFallbackReason = null;
        let usedReferenceImage = false;

        // §2026-05-25 fei: retry-on-geo-block wrapper.
        //   OpenAI sometimes returns 403 "unsupported_country_region_territory"
        //   when CF Workers route the request through a colo OpenAI's
        //   IP-geo lookup considers outside its supported regions
        //   (HK/CN sometimes hit this on randomly-routed colos).
        //   Symptom is intermittent — the very next attempt often
        //   succeeds because CF picks a different upstream IP path.
        //   We retry up to 3 times with a small backoff so users don't
        //   see the 500 → "OpenAI image API 403" alert flickering.
        const isGeoBlock = async (response) => {
          if (response.status !== 403) return false;
          const body = await response.clone().text().catch(() => '');
          return body.includes('unsupported_country_region_territory')
              || body.includes('Country, region, or territory not supported');
        };

        const withGeoRetry = async (label, fn) => {
          for (let attempt = 1; attempt <= 3; attempt++) {
            const resp = await fn();
            if (resp.ok) return resp;
            if (await isGeoBlock(resp)) {
              if (attempt < 3) {
                console.warn(`[storyboard] OpenAI geo-block on ${label} attempt ${attempt} — retrying after backoff`);
                await new Promise(r => setTimeout(r, 600 * attempt));
                continue;
              }
              console.error(`[storyboard] OpenAI geo-block on ${label} — all 3 retries exhausted`);
            }
            return resp;
          }
        };

        const callGenerations = async (textPrompt) => {
          console.log('[storyboard] OpenAI /v1/images/generations (no reference)');
          return withGeoRetry('generations', () => fetch('https://api.openai.com/v1/images/generations', {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${openaiApiKey}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              model: openaiModel,
              prompt: textPrompt,
              n: 1,
              size: openaiSize,
              quality: openaiQuality,
            }),
          }));
        };

        if (referenceImageUrl) {
          // Sequel / continuation: include previous frame as character anchor
          console.log(`[storyboard] OpenAI /v1/images/edits with reference: ${referenceImageUrl.slice(0, 80)}…`);
          // Download reference image server-side (CORS / signed URL bypass)
          const refResp = await fetch(referenceImageUrl, {
            headers: { 'User-Agent': 'Mozilla/5.0 Cloudflare-Worker' },
          });
          if (!refResp.ok) {
            const t = await refResp.text().catch(() => '');
            console.error('[storyboard] reference image fetch non-OK', refResp.status, 'url=' + referenceImageUrl, t.slice(0, 200));
            // Soft-fail: instead of aborting the whole gen, drop the
            // reference and continue text-only. The user's video still
            // gets made; only continuity is lost.
            console.warn('[storyboard] reference fetch failed → falling back to text-only generation');
            safetyFallbackTriggered = true;
            safetyFallbackReason = `reference_fetch_failed_${refResp.status}`;
            openaiResp = await callGenerations(promptText);
          } else {
            const refBuffer = await refResp.arrayBuffer();
            const refContentType = (refResp.headers.get('content-type') || 'image/png').split(';')[0].trim();

            const form = new FormData();
            form.append('model', openaiModel);
            form.append('image', new Blob([refBuffer], { type: refContentType }), 'reference.png');
            form.append('prompt', promptText);
            form.append('n', '1');
            form.append('size', openaiSize);
            form.append('quality', openaiQuality);
            // OpenAI image edits API: returns base64 by default. Some model
            // versions don't accept response_format on edits — omit it.
            // §2026-05-25 fei: same geo-block retry on edits path
            openaiResp = await withGeoRetry('edits', () => fetch('https://api.openai.com/v1/images/edits', {
              method: 'POST',
              headers: { 'Authorization': `Bearer ${openaiApiKey}` },
              body: form,
            }));
            usedReferenceImage = openaiResp.ok;

            // §2026-05-22 safety-fallback detection: OpenAI rejects reference
            //   images containing real-person likenesses, deepfake-risk
            //   subjects, or copyrighted faces. Their error message is
            //   pretty stable — "Your reference media triggered our safety
            //   filter" / "real-person likeness" / "moderation_blocked"
            //   error code. When we see it, drop the reference and re-run
            //   the prompt as a pure text-to-image call so the user still
            //   gets a video (just without character-photo continuity).
            if (!openaiResp.ok) {
              const peek = await openaiResp.clone().text().catch(() => '');
              const peekLower = peek.toLowerCase();
              const looksLikeSafetyBlock =
                peekLower.includes('safety filter') ||
                peekLower.includes('real-person') ||
                peekLower.includes('real person') ||
                peekLower.includes('moderation_blocked') ||
                peekLower.includes('likeness') ||
                peekLower.includes('content_policy_violation');
              if (looksLikeSafetyBlock) {
                console.warn('[storyboard] reference image triggered OpenAI safety filter — falling back to text-only generation. body=' + peek.slice(0, 200));
                safetyFallbackTriggered = true;
                safetyFallbackReason = 'openai_safety_filter';
                // Strip the [CONTINUITY] block and append a note that the
                // character is described in text (no visual anchor available).
                promptText = buildStoryboardPrompt({ script, style, protagonist: effectiveProtagonist, supportingCharacters: effectiveSupporting, hasReference: false }) +
                  '\n[CHARACTER ANCHOR NOTE] No reference image available for this generation — render the character purely from the description above, preserving consistency across the story arc as best as possible.\n';
                openaiResp = await callGenerations(promptText);
                usedReferenceImage = false;
              }
            }
          }
        } else {
          // First gen: no reference image
          openaiResp = await callGenerations(promptText);
        }

        // §2026-05-22 round-4 — prompt-content moderation auto-retry.
        //   OpenAI text moderation occasionally rejects prompts where the
        //   user's script content (verbatim BEATS block: dialogue, action,
        //   narration) contains themes the safety system flags — violence
        //   hints, mentions of real names, edgy noir tropes. When this
        //   fires, we retry ONCE with a sanitized prompt that strips the
        //   beat-by-beat user content and keeps only the structural blocks
        //   (style anchor + character description + lighting + tags +
        //   quality lock + text-free). The output is less narratively
        //   specific but visually consistent with the chosen style.
        if (!openaiResp.ok && openaiResp.status === 400) {
          const peekErr = await openaiResp.clone().text().catch(() => '');
          const peekLower = peekErr.toLowerCase();
          const looksLikePromptModeration = (
            peekLower.includes('safety system') ||
            peekLower.includes('safety filter') ||
            peekLower.includes('moderation') ||
            peekLower.includes('content_policy') ||
            peekLower.includes('rejected by')
          );
          if (looksLikePromptModeration) {
            console.warn('[storyboard] prompt-content moderation hit — retrying with sanitized prompt (script content stripped). body=' + peekErr.slice(0, 200));
            // Sanitized: strip the BEATS block + replace summary with a
            //   generic "story key visual" placeholder. Keeps style +
            //   character + lighting + tags + quality intact.
            const sanitizedScript = {
              summary: 'A story key visual moment — emotionally engaging, narratively rich',
              mood: script?.mood || null,
              shots: [],  // <-- the critical strip: no verbatim user dialogue/action
            };
            promptText = buildStoryboardPrompt({
              script: sanitizedScript,
              style,
              protagonist: effectiveProtagonist,
              supportingCharacters: effectiveSupporting,
              hasReference: false,
            }) + '\n[CONTENT NOTE] Render a story-appropriate key visual without dialogue overlay or specific narrative beats — focus on style + character + mood.\n';
            safetyFallbackTriggered = true;
            safetyFallbackReason = 'openai_prompt_moderation';
            openaiResp = await callGenerations(promptText);
            usedReferenceImage = false;
          }
        }

        if (!openaiResp.ok) {
          const errBody = await openaiResp.text().catch(() => '(unreadable)');
          // §2026-05-15 loud-fail: full body so admin can see what OpenAI
          // says (e.g. "model not found", "invalid prompt", "rate limit")
          console.error('[storyboard] OpenAI non-OK', 'status=' + openaiResp.status, 'model=' + openaiModel, 'body=' + errBody.slice(0, 500));
          // Common helpful nudges in error messages
          let hint = '';
          const errLower = errBody.toLowerCase();
          if (errBody.includes('model') && errBody.includes('not found')) {
            hint = ' Hint: model "' + openaiModel + '" may not exist — try gpt-image-1 in admin → System Settings.';
          } else if (openaiResp.status === 401) {
            hint = ' Hint: OpenAI key invalid — check system_settings.openai_api_key.';
          } else if (openaiResp.status === 429) {
            hint = ' Hint: OpenAI rate limit — wait or upgrade quota.';
          } else if (errLower.includes('safety') || errLower.includes('moderation') || errLower.includes('content_policy')) {
            // Even the sanitized retry got blocked — script themes are too
            //   spicy even without verbatim content, OR account-level flag.
            hint = ' Hint: prompt itself triggered OpenAI moderation even after sanitization. Your script may have themes OpenAI consistently flags (graphic violence, sexual content, real public figures by name, etc.). Try rewriting with softer language.';
          } else if (openaiResp.status === 400 && (errLower.includes('quality') || (errLower.includes('low') && errLower.includes('medium') && errLower.includes('high')))) {
            hint = ` Hint: quality "${openaiQuality}" not supported by ${openaiModel} — gpt-image-2 uses low|medium|high|auto. Change in admin → System Settings.`;
          } else if (openaiResp.status === 403 && (errLower.includes('unsupported_country_region_territory') || errLower.includes('country, region'))) {
            // §2026-05-25 fei — geo-block survived all 3 retries.
            //   Throw a CLEAN user-facing message instead of dumping raw
            //   OpenAI JSON. Frontend formatError already recognizes
            //   "unsupported_country" pattern and shows this message
            //   verbatim.
            throw new Error(
              'OpenAI 在当前地区不可用：本次请求被路由到了 OpenAI 不支持的出口节点（CF Workers 跨地区调度有时会命中黑名单）。' +
              '已自动重试 3 次仍失败。\n\n👉 请等 1-2 分钟后重试 —— Cloudflare 会换出口路由，通常下一次就能成功。' +
              '\n\n[unsupported_country_region_territory]'  // marker for frontend formatError
            );
          }
          throw new Error(`OpenAI image API ${openaiResp.status}: ${errBody.slice(0, 200)}.${hint}`);
        }

        const openaiData = await openaiResp.json();
        const b64 = openaiData.data?.[0]?.b64_json;
        const revisedPrompt = openaiData.data?.[0]?.revised_prompt;
        if (!b64) {
          throw new Error('OpenAI response missing b64_json data');
        }

        // Decode base64 → bytes → store to R2
        const bin = atob(b64);
        const bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        if (!env.BUCKET) throw new Error('R2 BUCKET binding missing');
        const objectKey = `storyboards/sheet_${Date.now()}_${Math.random().toString(36).substring(2, 6)}.png`;
        await env.BUCKET.put(objectKey, bytes.buffer, { httpMetadata: { contentType: 'image/png' } });
        const imageUrl = `https://asset.uvera.ai/${objectKey}`;
        console.log(`[storyboard] ✅ stored ${imageUrl} (${(bytes.length / 1024).toFixed(1)} KB)`);

        // logApiFinish + PATCH the new storyboard columns
        await logApiFinish(env, logId, {
          status: 'succeeded',
          duration_ms: Date.now() - t0,
          http_status: 200,
          response_size_bytes: bytes.length,
          output_url: imageUrl,
          // §2026-05-22 — gpt-image-2 pricing per OpenAI: low=$0.011 /
          //   medium=$0.042 / high=$0.167 / auto~$0.167. Legacy 'hd'
          //   maps to high (gpt-image-1 era), 'standard' to medium.
          cost_usd: (() => {
            const q = String(openaiQuality).toLowerCase();
            if (q === 'low') return 0.011;
            if (q === 'medium' || q === 'standard') return 0.042;
            if (q === 'high' || q === 'hd' || q === 'auto') return 0.167;
            return 0.042; // safe default for unknown enums
          })(),
        });

        // Best-effort PATCH the storyboard metadata columns on the same log row
        try {
          const supabaseUrl = env.SUPABASE_URL || 'https://wjhdsodlxekvhpahascs.supabase.co';
          const patchResp = await fetch(`${supabaseUrl}/rest/v1/generation_logs?id=eq.${logId}`, {
            method: 'PATCH',
            headers: {
              'Authorization': `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
              'apikey': env.SUPABASE_SERVICE_ROLE_KEY,
              'Content-Type': 'application/json',
              'Prefer': 'return=minimal',
            },
            body: JSON.stringify({
              storyboard_image_url: imageUrl,
              storyboard_reference_url: referenceImageUrl || null,
              storyboard_prompt_summary: promptText.slice(0, 500),
              file_size_bytes: bytes.length,
            }),
          });
          if (!patchResp.ok) {
            const t = await patchResp.text().catch(() => '');
            console.error('[storyboard] generation_logs PATCH non-OK', 'status=' + patchResp.status, 'logId=' + logId, 'body=' + t.slice(0, 200));
          }
        } catch (patchErr) {
          console.error('[storyboard] generation_logs PATCH exception:', patchErr.message);
        }

        return new Response(JSON.stringify({
          success: true,
          imageUrl,
          model: openaiModel,
          quality: openaiQuality,
          size: openaiSize,
          revisedPrompt: revisedPrompt || null,
          // §2026-05-22 — was: !!referenceImageUrl (lied when safety
          //   fallback fired). Now reflects whether the reference
          //   actually made it into the OpenAI call.
          usedReferenceImage,
          // Surfaces to frontend so we can show a gentle notice if the
          //   reference photo was dropped (real-person safety filter,
          //   fetch failure, etc.). null when nothing unusual happened.
          safetyFallbackTriggered,
          safetyFallbackReason,
        }), {
          status: 200,
          headers: { 'Content-Type': 'application/json', ...corsHeaders },
        });
      } catch (err) {
        console.error('[storyboard]', err.message);
        if (err.httpStatus === 401) {
          return new Response(JSON.stringify({ success: false, errMessage: err.message }), {
            status: 401, headers: { 'Content-Type': 'application/json', ...corsHeaders },
          });
        }
        if (err.httpStatus === 402 && err.insufficient) {
          return new Response(JSON.stringify({ success: false, insufficient: true, required: err.required, current: err.current, errMessage: err.message }), {
            status: 402, headers: { 'Content-Type': 'application/json', ...corsHeaders },
          });
        }
        // 已扣费但生成失败 → 退款(best-effort)。§2026-06-06 fei — 回传 refunded 信号。
        let refunded = false;
        if (caller?.id && sbCharged > 0) {
          const r = await creditGrant(env, caller.id, sbCharged, 'refund', null, null, 'Refund: storyboard failed');
          refunded = !!r;
        }
        if (logId) {
          await logApiFinish(env, logId, {
            status: 'failed',
            duration_ms: Date.now() - t0,
            error_message: err.message,
          });
          if (refunded) {
            // §2026-06-06 fei — 在 log 行打退款标记(后台可见)
            const sbu = env.SUPABASE_URL || 'https://wjhdsodlxekvhpahascs.supabase.co';
            await fetch(`${sbu}/rest/v1/generation_logs?id=eq.${logId}`, {
              method: 'PATCH',
              headers: { 'Authorization': `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`, 'apikey': env.SUPABASE_SERVICE_ROLE_KEY, 'Content-Type': 'application/json', 'Prefer': 'return=minimal' },
              body: JSON.stringify({ refunded: true, refunded_credits: sbCharged, refunded_at: new Date().toISOString() }),
            }).catch(() => {});
          }
        }
        return new Response(JSON.stringify({ success: false, errMessage: err.message, refunded, refundedCredits: refunded ? sbCharged : 0 }), {
          status: 500,
          headers: { 'Content-Type': 'application/json', ...corsHeaders },
        });
      }
    }

    /* §2026-06-06 fei — POST /api/generate-image
     *
     * Free Mode 纯多模态出图。与 /api/generate-storyboard 的本质区别:这里
     * 没有任何故事板 scaffold —— prompt 就是用户输入的文本(verbatim),可
     * 选叠加一个轻量风格后缀(prompt 永远是主指令)。有参考图 → OpenAI
     * /v1/images/edits(图+文 → 新图);无参考图 → /v1/images/generations
     * (纯文生图)。
     *
     * BUG 背景:Free Mode 的 handleGenerateAsset 过去复用 generateConceptDesign
     * → /api/generate-storyboard,而后者在 2026-05-23 被重写成"铅笔多格故事板
     * sheet"生成器(buildStoryboardPrompt v2),把用户 prompt 降级成
     * script.summary、把用户图当成连续性锚点 → 用户拿到的是角色故事板,而非
     * "按我的图+文出的图"。本端点给 Free Mode 一条忠实于用户意图的出图路径,
     * 完全不碰故事板/剧集管线(零回归)。
     *
     * Body:    { prompt, referenceImageUrls?: string[], quality?, size?, renderSessionId? }
     *   多张参考图 → OpenAI /v1/images/edits 合成(image[]);size 由前端传具体值
     *   (「自动」已在前端解析为参考图比例对应的尺寸)。
     * Returns: { success, imageUrl, model, quality, size, revisedPrompt,
     *            usedReferenceImage, safetyFallbackTriggered, safetyFallbackReason }
     */
    if (url.pathname === '/api/generate-image' && request.method === 'POST') {
      const corsHeaders = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST, OPTIONS' };
      if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders });
      const t0 = Date.now();
      let logId = null;
      let caller = null;
      let imgCharged = 0;
      try {
        const body = await request.json();
        const { prompt, referenceImageUrls, referenceImageUrl, quality, size, renderSessionId } = body;
        const userPrompt = (prompt || '').trim();
        if (!userPrompt) throw new Error('prompt is required');
        // §2026-06-06 fei — 参考图多选;兼容旧单值 referenceImageUrl。最多 4 张。
        const refUrls = (Array.isArray(referenceImageUrls)
          ? referenceImageUrls
          : (referenceImageUrl ? [referenceImageUrl] : []))
          .filter(u => typeof u === 'string' && u.trim()).slice(0, 4);

        /* §2026-06-06 fei — 用户可选画质 + 分辨率,价格随选择 3 → 6(封顶 2×)。
         * 白名单校验,非法/缺失落安全默认(medium + 横版 1536×1024)。
         * 注意:这里 NOT 用 system_settings.openai_image_size —— 那是 1792x1024
         * (DALL·E 3 尺寸),不是 gpt-image-2 的合法尺寸。gpt-image-2 三档尺寸:
         *   1024x1024(方)/ 1536x1024(横)/ 1024x1536(竖)。 */
        const ALLOWED_IMG_QUALITY = new Set(['low', 'medium', 'high']);
        const ALLOWED_IMG_SIZE = new Set(['1024x1024', '1536x1024', '1024x1536']);
        const openaiQuality = ALLOWED_IMG_QUALITY.has(String(quality || '').toLowerCase()) ? String(quality).toLowerCase() : 'medium';
        const openaiSize = ALLOWED_IMG_SIZE.has(String(size || '').toLowerCase()) ? String(size).toLowerCase() : '1536x1024';
        /* 服务端权威定价(绝不信任前端传价):
         *   credit = 3(base) + 画质(low0/med1/high2) + 尺寸(方0/横竖1) → 3..6
         *   矩阵:经济方3 经济横竖4 标准方4 标准横竖5 高清方5 高清横竖6(=2×封顶)。*/
        const IMAGE_QUALITY_COST = { low: 0, medium: 1, high: 2 };
        const IMAGE_COST = 3 + (IMAGE_QUALITY_COST[openaiQuality] ?? 1) + (openaiSize === '1024x1024' ? 0 : 1);

        // 鉴权 + 原子扣费(按上面算出的档位价)。余额不足抛 402。
        caller = await requireUser(request, env);
        const imgSpend = await creditSpend(env, caller.id, IMAGE_COST, 'spend_image', null, `Free Mode image (${openaiQuality}/${openaiSize})`);
        imgCharged = imgSpend.spent;

        // OpenAI key/model 仍走 system_settings(那些是对的);size/quality 用上面用户选的。
        const openaiApiKey = await getSystemSetting(env, 'openai_api_key', null);
        const openaiModel = await getSystemSetting(env, 'openai_image_model', 'gpt-image-2');
        if (!openaiApiKey) {
          throw new Error('OpenAI API key not configured. Set system_settings.openai_api_key in admin → System Settings → Runtime configuration.');
        }

        logId = await logApiStart(env, request, 'freemode_image', {
          prompt: userPrompt.slice(0, 500),
          refsCount: refUrls.length,
          model: openaiModel,
          vendor: 'openai',
          ratio: openaiSize,
          sourceImageUrl: refUrls[0] || null,
          renderSessionId: renderSessionId || null,
        });

        /* prompt 为主:用户文本就是出图主指令(Style 已移除,2026-06-06 fei)。
         * 结尾一句话防止模型自作主张画成分镜/网格/带文字 —— 与旧故事板路径的
         * 关键差别。 */
        const promptText = `${userPrompt}\n\nProduce a single finished image. Do NOT render storyboard panels, grids, annotations, arrows, captions, or any text overlay.`;

        // ── geo-block retry(与 storyboard 同语义)──
        const isGeoBlock = async (response) => {
          if (response.status !== 403) return false;
          const b = await response.clone().text().catch(() => '');
          return b.includes('unsupported_country_region_territory')
              || b.includes('Country, region, or territory not supported');
        };
        const withGeoRetry = async (label, fn) => {
          for (let attempt = 1; attempt <= 3; attempt++) {
            const resp = await fn();
            if (resp.ok) return resp;
            if (await isGeoBlock(resp)) {
              if (attempt < 3) {
                console.warn(`[generate-image] OpenAI geo-block on ${label} attempt ${attempt} — retrying`);
                await new Promise(r => setTimeout(r, 600 * attempt));
                continue;
              }
              console.error(`[generate-image] OpenAI geo-block on ${label} — all 3 retries exhausted`);
            }
            return resp;
          }
        };
        const callGenerations = async (textPrompt) => {
          console.log('[generate-image] OpenAI /v1/images/generations (no reference)');
          return withGeoRetry('generations', () => fetch('https://api.openai.com/v1/images/generations', {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${openaiApiKey}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ model: openaiModel, prompt: textPrompt, n: 1, size: openaiSize, quality: openaiQuality }),
          }));
        };

        let openaiResp;
        let usedReferenceImage = false;
        let safetyFallbackTriggered = false;
        let safetyFallbackReason = null;

        if (refUrls.length > 0) {
          console.log(`[generate-image] OpenAI /v1/images/edits with ${refUrls.length} reference(s)`);
          // 服务端下载每张参考图(绕过 CORS / 签名 URL)。任一张取不到 → 整体回落纯文生图。
          const fetched = [];
          let fetchFailed = null;
          for (const u of refUrls) {
            const r = await fetch(u, { headers: { 'User-Agent': 'Mozilla/5.0 Cloudflare-Worker' } });
            if (!r.ok) { fetchFailed = r.status; break; }
            const buf = await r.arrayBuffer();
            const ct = (r.headers.get('content-type') || 'image/png').split(';')[0].trim();
            fetched.push({ buf, ct });
          }
          if (fetchFailed !== null || fetched.length === 0) {
            console.warn(`[generate-image] reference fetch failed (${fetchFailed}) → text-only fallback`);
            safetyFallbackTriggered = true;
            safetyFallbackReason = `reference_fetch_failed_${fetchFailed}`;
            openaiResp = await callGenerations(promptText);
          } else {
            const form = new FormData();
            form.append('model', openaiModel);
            // 单图用 image 字段(已验证可用);多图用 image[](OpenAI edits 多图合成)。
            const imgField = fetched.length > 1 ? 'image[]' : 'image';
            fetched.forEach((f, i) => form.append(imgField, new Blob([f.buf], { type: f.ct }), `reference_${i}.png`));
            form.append('prompt', promptText);
            form.append('n', '1');
            form.append('size', openaiSize);
            form.append('quality', openaiQuality);
            openaiResp = await withGeoRetry('edits', () => fetch('https://api.openai.com/v1/images/edits', {
              method: 'POST',
              headers: { 'Authorization': `Bearer ${openaiApiKey}` },
              body: form,
            }));
            usedReferenceImage = openaiResp.ok;
            // 参考图触发真人/版权安全过滤 → 丢参考图,纯文生图重试(用户仍拿到图)
            if (!openaiResp.ok) {
              const peek = (await openaiResp.clone().text().catch(() => '')).toLowerCase();
              const looksLikeSafetyBlock =
                peek.includes('safety filter') || peek.includes('real-person') || peek.includes('real person') ||
                peek.includes('moderation_blocked') || peek.includes('likeness') || peek.includes('content_policy_violation');
              if (looksLikeSafetyBlock) {
                console.warn('[generate-image] reference triggered OpenAI safety filter — text-only fallback');
                safetyFallbackTriggered = true;
                safetyFallbackReason = 'openai_safety_filter';
                openaiResp = await callGenerations(promptText);
                usedReferenceImage = false;
              }
            }
          }
        } else {
          openaiResp = await callGenerations(promptText);
        }

        if (!openaiResp.ok) {
          const errBody = await openaiResp.text().catch(() => '(unreadable)');
          console.error('[generate-image] OpenAI non-OK', 'status=' + openaiResp.status, 'model=' + openaiModel, 'body=' + errBody.slice(0, 500));
          let hint = '';
          const errLower = errBody.toLowerCase();
          if (errBody.includes('model') && errBody.includes('not found')) {
            hint = ' Hint: model "' + openaiModel + '" may not exist — try gpt-image-1 in admin → System Settings.';
          } else if (openaiResp.status === 401) {
            hint = ' Hint: OpenAI key invalid — check system_settings.openai_api_key.';
          } else if (openaiResp.status === 429) {
            hint = ' Hint: OpenAI rate limit — wait or upgrade quota.';
          } else if (openaiResp.status === 403 && (errLower.includes('unsupported_country_region_territory') || errLower.includes('country, region'))) {
            throw new Error(
              'OpenAI 在当前地区不可用:本次请求被路由到了 OpenAI 不支持的出口节点(CF Workers 跨地区调度有时会命中黑名单)。已自动重试 3 次仍失败。\n\n👉 请等 1-2 分钟后重试。\n\n[unsupported_country_region_territory]'
            );
          } else if (errLower.includes('safety') || errLower.includes('moderation') || errLower.includes('content_policy')) {
            hint = ' Hint: 你的提示词或参考图触发了 OpenAI 内容审核,换个描述或图片再试。';
          } else if (openaiResp.status === 400 && (errLower.includes('quality') || (errLower.includes('low') && errLower.includes('high')))) {
            hint = ` Hint: quality "${openaiQuality}" not supported by ${openaiModel} — gpt-image-2 uses low|medium|high|auto. Change in admin → System Settings.`;
          }
          throw new Error(`OpenAI image API ${openaiResp.status}: ${errBody.slice(0, 200)}.${hint}`);
        }

        const openaiData = await openaiResp.json();
        const b64 = openaiData.data?.[0]?.b64_json;
        const revisedPrompt = openaiData.data?.[0]?.revised_prompt;
        if (!b64) throw new Error('OpenAI response missing b64_json data');

        // base64 → bytes → R2
        const bin = atob(b64);
        const bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        if (!env.BUCKET) throw new Error('R2 BUCKET binding missing');
        const objectKey = `images/img_${Date.now()}_${Math.random().toString(36).substring(2, 6)}.png`;
        await env.BUCKET.put(objectKey, bytes.buffer, { httpMetadata: { contentType: 'image/png' } });
        const imageUrl = `https://asset.uvera.ai/${objectKey}`;
        console.log(`[generate-image] ✅ stored ${imageUrl} (${(bytes.length / 1024).toFixed(1)} KB)`);

        await logApiFinish(env, logId, {
          status: 'succeeded',
          duration_ms: Date.now() - t0,
          http_status: 200,
          response_size_bytes: bytes.length,
          output_url: imageUrl,
          cost_usd: (() => {
            const q = String(openaiQuality).toLowerCase();
            if (q === 'low') return 0.011;
            if (q === 'medium' || q === 'standard') return 0.042;
            if (q === 'high' || q === 'hd' || q === 'auto') return 0.167;
            return 0.042;
          })(),
        });

        return new Response(JSON.stringify({
          success: true,
          imageUrl,
          model: openaiModel,
          quality: openaiQuality,
          size: openaiSize,
          revisedPrompt: revisedPrompt || null,
          usedReferenceImage,
          safetyFallbackTriggered,
          safetyFallbackReason,
        }), { status: 200, headers: { 'Content-Type': 'application/json', ...corsHeaders } });
      } catch (err) {
        console.error('[generate-image]', err.message);
        if (err.httpStatus === 401) {
          return new Response(JSON.stringify({ success: false, errMessage: err.message }), {
            status: 401, headers: { 'Content-Type': 'application/json', ...corsHeaders },
          });
        }
        if (err.httpStatus === 402 && err.insufficient) {
          return new Response(JSON.stringify({ success: false, insufficient: true, required: err.required, current: err.current, errMessage: err.message }), {
            status: 402, headers: { 'Content-Type': 'application/json', ...corsHeaders },
          });
        }
        // 已扣费但生成失败 → 退款(best-effort)。§2026-06-06 fei — 回传 refunded 信号,
        //   前端据此明确告知用户「积分已返还」(只在真退款时,402 余额不足不显示)。
        let refunded = false;
        if (caller?.id && imgCharged > 0) {
          const r = await creditGrant(env, caller.id, imgCharged, 'refund', null, null, 'Refund: image gen failed');
          refunded = !!r;
        }
        if (logId) {
          await logApiFinish(env, logId, { status: 'failed', duration_ms: Date.now() - t0, error_message: err.message });
          if (refunded) {
            // §2026-06-06 fei — 在 log 行打退款标记(后台 FAILED 行显示「已退款 N」)
            const sbu = env.SUPABASE_URL || 'https://wjhdsodlxekvhpahascs.supabase.co';
            await fetch(`${sbu}/rest/v1/generation_logs?id=eq.${logId}`, {
              method: 'PATCH',
              headers: { 'Authorization': `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`, 'apikey': env.SUPABASE_SERVICE_ROLE_KEY, 'Content-Type': 'application/json', 'Prefer': 'return=minimal' },
              body: JSON.stringify({ refunded: true, refunded_credits: imgCharged, refunded_at: new Date().toISOString() }),
            }).catch(() => {});
          }
        }
        return new Response(JSON.stringify({ success: false, errMessage: err.message, refunded, refundedCredits: refunded ? imgCharged : 0 }), {
          status: 500, headers: { 'Content-Type': 'application/json', ...corsHeaders },
        });
      }
    }

    // §2026-05-22 /api/generate-concept-image (legacy Gemini concept-design
    //   flow) has been REMOVED. The frontend's only caller used to be
    //   generateConceptDesign's `else` branch — now collapsed to always
    //   route to /api/generate-storyboard. If something pings this URL it
    //   will get a 404 from the catch-all below, which is correct: the
    //   legacy "CHARACTER MODEL SHEET turnaround" output was wrong for our
    //   pipeline and we never want it back.

    /* §2026-05-25 fei — POST /api/generate-character-board
     *
     * Sibling of /api/generate-storyboard. Produces a single polished
     * CHARACTER IDENTITY BOARD (face / costume / proportion model sheet
     * in the user's chosen art style, optionally inspired by an Actor
     * reference photo). Same OpenAI image gen plumbing — different
     * prompt builder + same safety/geo fallback semantics.
     *
     * Returns: { success, imageUrl, model, quality, size,
     *            usedReferenceImage, safetyFallbackTriggered,
     *            safetyFallbackReason }
     */
    if (url.pathname === '/api/generate-character-board' && request.method === 'POST') {
      const corsHeaders = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST, OPTIONS' };
      if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders });
      const t0 = Date.now();
      let logId = null;
      try {
        await requireUser(request, env);  // §2026-05-29 挡匿名;character board 维持免费,不扣费
        const body = await request.json();
        // §2026-05-30 fei round-2 — protagonist is the canonical character input.
        //   Reflects the Actor's identity (set by the screenwriter from the
        //   uploaded photo's identity_features). character/characterSeed
        //   kept for back-compat but no longer read by the prompt builder.
        //   photoDemographics destructured for back-compat with any cached
        //   round-1 frontend bundle but ignored — actor=protagonist policy
        //   doesn't gate on demographics.
        const { protagonist, photoDemographics: _photoDemographicsIgnored, character, characterSeed, style, referenceImageUrl, renderSessionId } = body;
        if (!protagonist && !character && !characterSeed) {
          throw new Error('protagonist (preferred) or character/characterSeed (deprecated) is required');
        }

        const openaiApiKey = await getSystemSetting(env, 'openai_api_key', null);
        const openaiModel = await getSystemSetting(env, 'openai_image_model', 'gpt-image-2');
        const openaiQuality = await getSystemSetting(env, 'openai_image_quality', 'medium');
        const openaiSize = await getSystemSetting(env, 'openai_image_size', '1792x1024');
        if (!openaiApiKey) {
          throw new Error('OpenAI API key not configured. Set system_settings.openai_api_key in admin → System Settings.');
        }

        logId = await logApiStart(env, request, 'character_board', {
          prompt: '(built below)',
          refsCount: referenceImageUrl ? 1 : 0,
          model: openaiModel,
          vendor: 'openai',
          ratio: openaiSize,
          sourceImageUrl: referenceImageUrl || null,
          renderSessionId: renderSessionId || null,    // §2026-05-30 Bug 4
        });

        let promptText = buildCharacterBoardPrompt({
          protagonist,
          // §2026-05-31 round-3 — actor identity (name + Vision description)
          //   so the board reflects the user's real Actor, not an LLM invention.
          actor: character ? { name: character.name, description: character.description } : null,
          style,
          hasReference: !!referenceImageUrl,
        });

        // Same geo-block + safety-fallback semantics as the storyboard
        //   endpoint above. Duplicated by design: the retry/fallback
        //   logic is short enough that inlining keeps each endpoint
        //   self-contained and easier to debug than a shared helper that
        //   takes 8 closure dependencies.
        const isGeoBlock = async (response) => {
          if (response.status !== 403) return false;
          const respBody = await response.clone().text().catch(() => '');
          return respBody.includes('unsupported_country_region_territory')
              || respBody.includes('Country, region, or territory not supported');
        };
        const withGeoRetry = async (label, fn) => {
          for (let attempt = 1; attempt <= 3; attempt++) {
            const resp = await fn();
            if (resp.ok) return resp;
            if (await isGeoBlock(resp)) {
              if (attempt < 3) {
                console.warn(`[character-board] OpenAI geo-block on ${label} attempt ${attempt} — retrying`);
                await new Promise(r => setTimeout(r, 600 * attempt));
                continue;
              }
            }
            return resp;
          }
        };

        const callGenerations = async (textPrompt) => {
          return withGeoRetry('generations', () => fetch('https://api.openai.com/v1/images/generations', {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${openaiApiKey}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              model: openaiModel,
              prompt: textPrompt,
              n: 1,
              size: openaiSize,
              quality: openaiQuality,
            }),
          }));
        };

        let openaiResp;
        let usedReferenceImage = false;
        let safetyFallbackTriggered = false;
        let safetyFallbackReason = null;

        if (referenceImageUrl) {
          console.log(`[character-board] OpenAI /v1/images/edits with reference: ${referenceImageUrl.slice(0, 80)}…`);
          const refResp = await fetch(referenceImageUrl, {
            headers: { 'User-Agent': 'Mozilla/5.0 Cloudflare-Worker' },
          });
          if (!refResp.ok) {
            console.warn(`[character-board] reference fetch ${refResp.status} → falling back to text-only`);
            safetyFallbackTriggered = true;
            safetyFallbackReason = `reference_fetch_failed_${refResp.status}`;
            openaiResp = await callGenerations(promptText);
          } else {
            const refBuffer = await refResp.arrayBuffer();
            const refContentType = (refResp.headers.get('content-type') || 'image/png').split(';')[0].trim();
            const form = new FormData();
            form.append('model', openaiModel);
            form.append('image', new Blob([refBuffer], { type: refContentType }), 'reference.png');
            form.append('prompt', promptText);
            form.append('n', '1');
            form.append('size', openaiSize);
            form.append('quality', openaiQuality);
            openaiResp = await withGeoRetry('edits', () => fetch('https://api.openai.com/v1/images/edits', {
              method: 'POST',
              headers: { 'Authorization': `Bearer ${openaiApiKey}` },
              body: form,
            }));
            usedReferenceImage = openaiResp.ok;

            if (!openaiResp.ok) {
              const peek = await openaiResp.clone().text().catch(() => '');
              if (/safety|moderation|real.person|likeness/i.test(peek)) {
                console.warn(`[character-board] reference triggered safety filter — text-only fallback. body=${peek.slice(0, 200)}`);
                safetyFallbackTriggered = true;
                safetyFallbackReason = 'openai_safety_filter';
                // Re-build prompt without hasReference so wording shifts
                //   to "fully original" framing (no "inspired by photo").
                promptText = buildCharacterBoardPrompt({
                  protagonist,
                  actor: character ? { name: character.name, description: character.description } : null,
                  style,
                  hasReference: false,
                });
                openaiResp = await callGenerations(promptText);
                usedReferenceImage = false;
              }
            }
          }
        } else {
          openaiResp = await callGenerations(promptText);
        }

        if (!openaiResp.ok) {
          const errText = await openaiResp.text().catch(() => '');
          throw new Error(`OpenAI image API ${openaiResp.status}: ${errText.slice(0, 500)}`);
        }

        const data = await openaiResp.json();
        const b64 = data?.data?.[0]?.b64_json;
        if (!b64) throw new Error('OpenAI response missing b64_json data');

        // Decode base64 → bytes → R2 (mirrors storyboard endpoint pattern
        //   above so cleanup/quotas/asset.uvera.ai routing stay consistent)
        const bin = atob(b64);
        const bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        if (!env.BUCKET) throw new Error('R2 BUCKET binding missing');
        const objectKey = `character-boards/board_${Date.now()}_${Math.random().toString(36).substring(2, 6)}.png`;
        await env.BUCKET.put(objectKey, bytes.buffer, { httpMetadata: { contentType: 'image/png' } });
        const imageUrl = `https://asset.uvera.ai/${objectKey}`;
        console.log(`[character-board] ✅ stored ${imageUrl} (${(bytes.length / 1024).toFixed(1)} KB)`);

        if (logId) {
          await logApiFinish(env, logId, {
            status: 'succeeded',
            duration_ms: Date.now() - t0,
            http_status: 200,
            response_size_bytes: bytes.length,
            output_url: imageUrl,
            cost_usd: (() => {
              const q = String(openaiQuality).toLowerCase();
              if (q === 'low') return 0.011;
              if (q === 'medium' || q === 'standard') return 0.042;
              if (q === 'high' || q === 'hd' || q === 'auto') return 0.167;
              return 0.042;
            })(),
          });
        }

        return new Response(JSON.stringify({
          success: true,
          imageUrl,
          model: openaiModel,
          quality: openaiQuality,
          size: openaiSize,
          usedReferenceImage,
          safetyFallbackTriggered,
          safetyFallbackReason,
        }), {
          headers: { 'Content-Type': 'application/json', ...corsHeaders },
        });
      } catch (err) {
        console.error('[character-board]', err.message);
        if (err.httpStatus === 401) {
          return new Response(JSON.stringify({ success: false, errMessage: err.message }), {
            status: 401, headers: { 'Content-Type': 'application/json', ...corsHeaders },
          });
        }
        if (logId) {
          await logApiFinish(env, logId, {
            status: 'failed',
            duration_ms: Date.now() - t0,
            error_message: err.message,
          });
        }
        return new Response(JSON.stringify({ success: false, errMessage: err.message }), {
          status: 500,
          headers: { 'Content-Type': 'application/json', ...corsHeaders },
        });
      }
    }

    // POST /api/describe-image
    // Body: { imageUrl }
    // Returns: { success, description } — short ≤10 char description
    if (url.pathname === '/api/describe-image' && request.method === 'POST') {
      const corsHeaders = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST, OPTIONS' };
      if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders });
      const t0 = Date.now();
      let logId = null;
      try {
        const { imageUrl } = await request.json();
        logId = await logApiStart(env, request, 'asset_describe', {
          imageUrl,
          model: GEMINI_TEXT_MODEL,
          vendor: 'gemini',
        });
        const gaApiKey = env.NEODOMAIN_GA_API_KEY;
        if (!gaApiKey) throw new Error('NEODOMAIN_GA_API_KEY not configured');
        if (!imageUrl) throw new Error('imageUrl is required');

        // Download image server-side
        const imgRes = await fetch(imageUrl, { headers: { 'User-Agent': 'Cloudflare-Worker' } });
        if (!imgRes.ok) throw new Error(`Failed to fetch image: ${imgRes.status}`);
        const imgBuffer = await imgRes.arrayBuffer();
        const rawMime = imgRes.headers.get('content-type') || 'image/jpeg';
        const mimeType = rawMime.split(';')[0].trim();
        const bytes = new Uint8Array(imgBuffer);
        let binary = '';
        for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]);

        const parts = [
          { inline_data: { mime_type: mimeType, data: btoa(binary) } },
          { text: '用中文10个字以内简短描述这张图片中的主体，例如"10岁小男孩"、"穿红裙的女孩"、"夕阳下的城市"。只输出描述文字，不要加标点。' }
        ];

        // Use gemini-3.1-flash — same family as the image-preview model
        // we use elsewhere (gemini-3.1-flash-image-preview), so the
        // Neodomain default group is known to have a channel for it.
        // 2026-05-11: routed through geminiFetch wrapper so model rotations
        // by Neodomain (1.5-flash → 3.1-flash → 2.5-flash …) auto-fall back
        // to the next env-configured model instead of erroring out.
        const geminiRes = await geminiFetch({
          kind: 'text',
          headers: { 'Authorization': `Bearer ${gaApiKey}` },
          body: JSON.stringify({ contents: [{ parts }] })
        });
        const geminiData = await geminiRes.json();

        // Diagnose why we're getting "素材" — the model returns null/blocked
        // for real-person photos triggering Gemini's safety filter. Log the
        // full response server-side (visible via wrangler tail) and surface
        // the finishReason / blockReason in the API response so the client
        // can show why instead of silently using a placeholder.
        const candidate = geminiData.candidates?.[0];
        const rawText = candidate?.content?.parts?.[0]?.text;
        const finishReason = candidate?.finishReason;
        const safetyRatings = candidate?.safetyRatings;
        const promptFeedback = geminiData.promptFeedback;
        if (!rawText) {
          console.warn('[describe-image] Gemini returned no text', JSON.stringify({
            httpStatus: geminiRes.status,
            finishReason,
            safetyRatings,
            promptFeedback,
            full: geminiData,
          }));
        }
        const desc = (rawText || '素材').trim().substring(0, 15);

        // §2026-05-26 fei — accurate token-based pricing (replaces $0.0001 placeholder)
        const { inputTokens, outputTokens } = extractLlmUsage(geminiData);
        const accCost = await priceLLMCallUsd(env, { model: GEMINI_TEXT_MODEL, inputTokens, outputTokens });

        await logApiFinish(env, logId, {
          status: rawText ? 'succeeded' : 'failed',
          duration_ms: Date.now() - t0,
          http_status: geminiRes.status,
          response_size_bytes: JSON.stringify(geminiData).length,
          output_url: desc,  // store the produced description as output
          input_tokens: inputTokens,
          output_tokens: outputTokens,
          cost_usd: accCost,
          error_message: rawText ? null : `Gemini returned no text (finishReason=${finishReason}, blockReason=${promptFeedback?.blockReason})`,
        });

        return new Response(JSON.stringify({
          success: true,
          description: desc,
          // Diagnostic fields — included only when the description fell back
          // to the placeholder, so production responses stay clean.
          // Slim diagnostic fields — present only when fallback was used so
          // future regressions are visible (no rawResponse, that leaks too
          // much upstream detail to clients).
          ...(rawText ? {} : {
            usedFallback: true,
            httpStatus: geminiRes.status,
            finishReason: finishReason || null,
            blockReason: promptFeedback?.blockReason || null,
            safetyRatings: safetyRatings || null,
          }),
        }), {
          headers: { 'Content-Type': 'application/json', ...corsHeaders }
        });
      } catch (err) {
        await logApiFinish(env, logId, {
          status: 'failed',
          duration_ms: Date.now() - t0,
          error_message: err.message,
        });
        return new Response(JSON.stringify({ success: false, description: '素材', errMessage: err.message }), {
          status: 200, headers: { 'Content-Type': 'application/json', ...corsHeaders }
        });
      }
    }

    // §2026-05-30 fei — POST /api/extract-photo-demographics
    //   Body: { imageUrl }
    //   Returns: { success, age, gender, confidence }
    //
    //   Used by the character-board step to decide whether the user's Actor
    //   photo can serve as facial-inspiration for the protagonist the
    //   screenwriter inferred. Demographic match (age band + gender) gates
    //   photo usage:
    //     - match  → "Actor photo as weak face hint"
    //     - mismatch → "ignore photo, pure protagonist-driven design"
    //   This severs the photo-identity → script leak that used to force
    //   a 28-year-old male into an "elderly grandmother" story.
    //
    //   Same gemini-text-model channel as describe-image. Cheap (one
    //   short structured JSON output). Fail-open: when Gemini returns
    //   nothing or fails, returns null fields with confidence=0 so the
    //   caller treats it as "no useful signal" rather than blocking gen.
    if (url.pathname === '/api/extract-photo-demographics' && request.method === 'POST') {
      const corsHeaders = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST, OPTIONS' };
      if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders });
      const t0 = Date.now();
      let logId = null;
      try {
        const { imageUrl } = await request.json();
        if (!imageUrl) throw new Error('imageUrl is required');
        logId = await logApiStart(env, request, 'photo_demographics', {
          imageUrl,
          model: GEMINI_TEXT_MODEL,
          vendor: 'gemini',
        });
        const gaApiKey = env.NEODOMAIN_GA_API_KEY;
        if (!gaApiKey) throw new Error('NEODOMAIN_GA_API_KEY not configured');

        // Fetch image server-side (CORS + signed-URL bypass — same as describe-image)
        const imgRes = await fetch(imageUrl, { headers: { 'User-Agent': 'Cloudflare-Worker' } });
        if (!imgRes.ok) throw new Error(`Failed to fetch image: ${imgRes.status}`);
        const imgBuffer = await imgRes.arrayBuffer();
        const rawMime = imgRes.headers.get('content-type') || 'image/jpeg';
        const mimeType = rawMime.split(';')[0].trim();
        const bytes = new Uint8Array(imgBuffer);
        let binary = '';
        for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]);

        const parts = [
          { inline_data: { mime_type: mimeType, data: btoa(binary) } },
          { text: `Analyze the most prominent person in this photo. Output STRICT JSON only, no markdown, no commentary:
{
  "age": "infant" | "child" | "teen" | "young-adult" | "middle-aged" | "elderly" | "unclear",
  "gender": "male" | "female" | "non-binary" | "unclear",
  "confidence": <number between 0.0 and 1.0 representing how certain you are about age + gender combined>
}
Use "unclear" + confidence < 0.4 when the photo is ambiguous (e.g. heavy makeup, occluded face, non-human subject, child of indeterminate gender, low-quality photo). Do NOT guess if the signal is weak.` }
        ];

        const geminiRes = await geminiFetch({
          kind: 'text',
          headers: { 'Authorization': `Bearer ${gaApiKey}` },
          body: JSON.stringify({
            contents: [{ parts }],
            generationConfig: { temperature: 0.0 },  // deterministic — same photo should give same answer
          }),
        });
        const geminiData = await geminiRes.json();
        const rawText = geminiData.candidates?.[0]?.content?.parts?.[0]?.text || '';

        // Parse: strip markdown fences if any, find first {...}
        const cleaned = rawText.replace(/```json/gi, '').replace(/```/g, '').trim();
        let parsed = { age: 'unclear', gender: 'unclear', confidence: 0 };
        try {
          parsed = JSON.parse(cleaned);
        } catch {
          const start = cleaned.indexOf('{');
          const end = cleaned.lastIndexOf('}');
          if (start >= 0 && end > start) {
            try { parsed = JSON.parse(cleaned.slice(start, end + 1)); } catch { /* fall through */ }
          }
        }

        // Normalize + clamp
        const VALID_AGES = new Set(['infant', 'child', 'teen', 'young-adult', 'middle-aged', 'elderly', 'unclear']);
        const VALID_GENDERS = new Set(['male', 'female', 'non-binary', 'unclear']);
        const result = {
          age: VALID_AGES.has(parsed.age) ? parsed.age : 'unclear',
          gender: VALID_GENDERS.has(parsed.gender) ? parsed.gender : 'unclear',
          confidence: Math.max(0, Math.min(1, Number(parsed.confidence) || 0)),
        };

        const { inputTokens, outputTokens } = extractLlmUsage(geminiData);
        const costUsd = await priceLLMCallUsd(env, { model: GEMINI_TEXT_MODEL, inputTokens, outputTokens });
        await logApiFinish(env, logId, {
          status: 'succeeded',
          duration_ms: Date.now() - t0,
          http_status: geminiRes.status,
          response_size_bytes: JSON.stringify(geminiData).length,
          output_url: `${result.age}/${result.gender}/${result.confidence.toFixed(2)}`,
          input_tokens: inputTokens,
          output_tokens: outputTokens,
          cost_usd: costUsd,
        });

        return new Response(JSON.stringify({ success: true, ...result }), {
          headers: { 'Content-Type': 'application/json', ...corsHeaders }
        });
      } catch (err) {
        if (logId) {
          await logApiFinish(env, logId, {
            status: 'failed',
            duration_ms: Date.now() - t0,
            error_message: err.message,
          });
        }
        // Fail-open: return null fields so caller proceeds without demographic info.
        return new Response(JSON.stringify({
          success: false,
          age: 'unclear',
          gender: 'unclear',
          confidence: 0,
          errMessage: err.message,
        }), {
          status: 200, headers: { 'Content-Type': 'application/json', ...corsHeaders }
        });
      }
    }

    // POST /api/generate-ideas
    // Generates creative prompts using Gemini 3.1 Flash
    if (url.pathname === '/api/generate-ideas' && request.method === 'POST') {
      const corsHeaders = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST, OPTIONS' };
      if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders });

      const t0 = Date.now();
      const logId = await logApiStart(env, request, 'random_ideas', {
        model: GEMINI_TEXT_MODEL,
        vendor: 'gemini',
      });
      try {
        const gaApiKey = env.NEODOMAIN_GA_API_KEY;
        if (!gaApiKey) throw new Error('NEODOMAIN_GA_API_KEY not configured in Worker environment');

        const prompt = `You are a creative director for a cinematic video generation AI.
Generate 4 highly creative, visually striking, and completely random 1-sentence story concepts.
They should span different genres (e.g. sci-fi, romance, slice of life, cyberpunk, fantasy).
Return ONLY a valid JSON array of objects. Each object must have an 'emoji' (1 character) and 'text' (the story concept in Chinese, max 25 chars).
Example format:
[{"emoji": "🍵", "text": "古镇清晨，少女在氤氲雾气中煮茶"}, {"emoji": "🛸", "text": "废土城市上空，巨大的飞船缓缓降落"}]
Output ONLY the JSON array, no markdown formatting.`;

        const geminiRes = await geminiFetch({
          kind: 'text',
          headers: { 'Authorization': `Bearer ${gaApiKey}` },
          body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: {
              temperature: 1.2
            }
          })
        });

        const geminiData = await geminiRes.json();
        if (!geminiRes.ok) throw new Error('Gemini API error: ' + JSON.stringify(geminiData));

        const textOutput = geminiData.candidates?.[0]?.content?.parts?.[0]?.text || '[]';
        let parsed = [];
        try {
          parsed = JSON.parse(textOutput.replace(/```json/g, '').replace(/```/g, '').trim());
        } catch (e) {
          console.warn('Failed to parse Gemini output, returning fallback');
          parsed = [
            { emoji: '🎨', text: '画室里，蒙着双眼的画家正挥舞画笔' },
            { emoji: '🏍️', text: '沙漠公路上，一辆重机车在夕阳下疾驰' }
          ];
        }

        // §2026-05-26 fei — accurate token-based pricing
        const { inputTokens: itIdeas, outputTokens: otIdeas } = extractLlmUsage(geminiData);
        const costIdeas = await priceLLMCallUsd(env, { model: GEMINI_TEXT_MODEL, inputTokens: itIdeas, outputTokens: otIdeas });
        await logApiFinish(env, logId, {
          status: 'succeeded',
          duration_ms: Date.now() - t0,
          http_status: 200,
          response_size_bytes: textOutput.length,
          input_tokens: itIdeas,
          output_tokens: otIdeas,
          cost_usd: costIdeas,
        });
        return new Response(JSON.stringify({ success: true, ideas: parsed }), {
          headers: { 'Content-Type': 'application/json', ...corsHeaders }
        });
      } catch (err) {
        await logApiFinish(env, logId, {
          status: 'failed',
          duration_ms: Date.now() - t0,
          error_message: err.message,
        });
        return new Response(JSON.stringify({ success: false, errMessage: err.message }), {
          status: 500,
          headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
        });
      }
    }

    // POST /api/optimize-prompt
    // Rewrites user prompt based on Seedance 2.0 best practices
    if (url.pathname === '/api/optimize-prompt' && request.method === 'POST') {
      const corsHeaders = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST, OPTIONS' };
      if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders });

      const t0 = Date.now();
      let logId = null;
      try {
        const { prompt } = await request.json();
        logId = await logApiStart(env, request, 'optimize_prompt', {
          prompt,
          model: GEMINI_TEXT_MODEL,
          vendor: 'gemini',
        });
        const gaApiKey = env.NEODOMAIN_GA_API_KEY;
        if (!gaApiKey) throw new Error('NEODOMAIN_GA_API_KEY not configured in Worker environment');

        const sysPrompt = `你是一个专业的视频生成提示词（Prompt）优化专家。
当前正在使用的是类似 Seedance 2.0 的视频大模型，它能根据精确的描述生成高质量动态视频。
用户的原始输入可能比较简单，或者仅仅是故事的粗略描述。你需要根据视频生成的最佳实践对其进行扩写和润色。

优化要求：
1. **画面描述强化**：增加明确的镜头语言（如特写、广角、平移、推轨、主观视角等）。
2. **光影与质感**：增加光线与色彩描写（如电影级光影、赛博朋克霓虹、清晨柔和阳光、丁达尔效应等）。
3. **动态细节**：丰富角色或物体的动作细节、表情、服饰纹理。
4. **环境背景**：细化背景环境，提升画面的空间感和氛围感。

【极端重要：保留 @ 引用】
如果用户的原提示词中包含形如“@角色名”、“@图片1”、“@某某某”这种带有 @ 前缀的引用标签，**你必须在优化后的提示词中原封不动地保留它们**，绝不能删除或将其替换为普通文字，因为这是前端系统识别素材的保留语法。

【输出要求】
不要改变用户原本想表达的核心故事和核心动作。
请直接返回优化后的一整段或几句话的提示词文本。
绝对不要包含任何前置解释、多余的寒暄、Markdown 格式标记（如 \`\`\` 等），只输出最终的纯文本内容。`;

        const geminiRes = await geminiFetch({
          kind: 'text',
          headers: { 'Authorization': `Bearer ${gaApiKey}` },
          body: JSON.stringify({
            contents: [{ parts: [{ text: `${sysPrompt}\n\n用户原提示词：\n${prompt}` }] }],
            generationConfig: { temperature: 0.7 }
          })
        });

        const geminiData = await geminiRes.json();
        if (!geminiRes.ok) throw new Error('Gemini API error: ' + JSON.stringify(geminiData));

        const optimizedText = geminiData.candidates?.[0]?.content?.parts?.[0]?.text || prompt;

        // §2026-05-26 fei — token-based pricing
        const { inputTokens: itOpt, outputTokens: otOpt } = extractLlmUsage(geminiData);
        const costOpt = await priceLLMCallUsd(env, { model: GEMINI_TEXT_MODEL, inputTokens: itOpt, outputTokens: otOpt });

        await logApiFinish(env, logId, {
          status: 'succeeded',
          duration_ms: Date.now() - t0,
          http_status: 200,
          response_size_bytes: optimizedText.length,
          input_tokens: itOpt,
          output_tokens: otOpt,
          cost_usd: costOpt,
        });
        return new Response(JSON.stringify({ success: true, optimizedPrompt: optimizedText.trim() }), {
          status: 200, headers: { 'Content-Type': 'application/json', ...corsHeaders }
        });
      } catch (err) {
        await logApiFinish(env, logId, {
          status: 'failed',
          duration_ms: Date.now() - t0,
          error_message: err.message,
        });
        return new Response(JSON.stringify({ success: false, errMessage: err.message }), {
          status: 200, headers: { 'Content-Type': 'application/json', ...corsHeaders }
        });
      }
    }

    // POST /api/expand-character-seed
    // §2026-05-23 fei: Takes a short freeform character description and
    //   expands it via Gemini into the 5-field CHARACTER SEED structure
    //   used by buildStoryboardPrompt:
    //     { name, seed, ageBody, visualMedium, style, otherDetails }
    //
    //   Input: { hint: string, context?: { videoType, styleName } }
    //   Output: { success, seed: { name, seed, ageBody, visualMedium, style, otherDetails } }
    if (url.pathname === '/api/expand-character-seed' && request.method === 'POST') {
      const corsHeaders = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST, OPTIONS' };
      if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders });

      const t0 = Date.now();
      let logId = null;
      try {
        const { hint, context } = await request.json();
        if (!hint || typeof hint !== 'string' || hint.trim().length < 3) {
          return new Response(JSON.stringify({ success: false, errMessage: 'hint required (min 3 chars)' }), {
            status: 400, headers: { 'Content-Type': 'application/json', ...corsHeaders }
          });
        }
        logId = await logApiStart(env, request, 'optimize_prompt', {
          prompt: `[expand-character-seed] ${hint}`,
          model: GEMINI_TEXT_MODEL,
          vendor: 'gemini',
        });
        const gaApiKey = env.NEODOMAIN_GA_API_KEY;
        if (!gaApiKey) throw new Error('NEODOMAIN_GA_API_KEY not configured');

        const ctxLine = context?.videoType || context?.styleName
          ? `Context — this character appears in a ${context?.videoType || 'video'}${context?.styleName ? ` rendered in ${context.styleName} style` : ''}.`
          : '';

        const sysPrompt = `You are a character designer for cinematic storyboards.

Given a SHORT user description of a character, expand it into 5 structured fields used to drive AI image generation. Output a single valid JSON object with EXACTLY these keys:

{
  "name":         "Short character name (1-3 words). If the user didn't provide one, invent something evocative.",
  "seed":         "1-2 sentences: who they are + their core role/identity (e.g. 'Seralya Veil, mythic ribbon dancer and living choreography performer. An unearthly elegant woman whose body and costume dissolve into flowing motion.').",
  "ageBody":      "1-2 sentences: appearance age + body type + posture/movement language (e.g. 'Appears mid-20s. Tall and slender with elongated graceful proportions, lightweight presence, weightless dancer physique.').",
  "visualMedium": "1 sentence: the design medium / rendering style for the character (e.g. 'Stylized 3D animation character design, clean sculpted forms, soft material definition, expressive facial design, appealing proportions.').",
  "style":        "1-2 sentences: costume aesthetic + style mood (e.g. 'Poetic mythic fantasy, elegant living-performance aesthetic, ethereal ceremonial costume design, silk-and-wind visual language.').",
  "otherDetails": "OPTIONAL — 1 sentence of distinctive facial features, hair, or signature details. May be empty string if not applicable."
}

Rules:
  - Output ONLY the JSON object, no markdown fences, no commentary.
  - Each field must be a string (otherDetails may be "").
  - Keep evocative, sensory, visually concrete — these feed an image model.
  - Do not include any quotation marks INSIDE the field values that would break JSON parsing.
  - Inherit tone and genre from the user's hint and the context line below.
  - Output the values in the SAME LANGUAGE the user used in their hint (if user wrote Chinese, output Chinese; if English, output English).

${ctxLine}

User hint:
${hint.trim()}`;

        const geminiRes = await geminiFetch({
          kind: 'text',
          headers: { 'Authorization': `Bearer ${gaApiKey}` },
          body: JSON.stringify({
            contents: [{ parts: [{ text: sysPrompt }] }],
            generationConfig: { temperature: 0.8 }
          })
        });
        const geminiData = await geminiRes.json();
        if (!geminiRes.ok) throw new Error('Gemini API error: ' + JSON.stringify(geminiData));

        const rawOutput = geminiData.candidates?.[0]?.content?.parts?.[0]?.text || '{}';
        // Strip any accidental markdown fencing
        const cleaned = rawOutput
          .replace(/```json/gi, '')
          .replace(/```/g, '')
          .trim();

        let seed;
        try {
          seed = JSON.parse(cleaned);
        } catch (parseErr) {
          // Last-ditch: find first '{' to last '}' to salvage if Gemini wrapped extra text
          const start = cleaned.indexOf('{');
          const end = cleaned.lastIndexOf('}');
          if (start >= 0 && end > start) {
            seed = JSON.parse(cleaned.slice(start, end + 1));
          } else {
            throw new Error('Could not parse character seed JSON: ' + cleaned.slice(0, 120));
          }
        }

        // Coerce any missing fields to empty strings so the consumer never
        // hits "undefined". Schema enforcement is explicit.
        const normalized = {
          name:         String(seed.name || '').trim(),
          seed:         String(seed.seed || '').trim(),
          ageBody:      String(seed.ageBody || '').trim(),
          visualMedium: String(seed.visualMedium || '').trim(),
          style:        String(seed.style || '').trim(),
          otherDetails: String(seed.otherDetails || '').trim(),
        };

        // §2026-05-26 fei — token-based pricing
        const { inputTokens: itSeed, outputTokens: otSeed } = extractLlmUsage(geminiData);
        const costSeed = await priceLLMCallUsd(env, { model: GEMINI_TEXT_MODEL, inputTokens: itSeed, outputTokens: otSeed });

        await logApiFinish(env, logId, {
          status: 'succeeded',
          duration_ms: Date.now() - t0,
          http_status: 200,
          response_size_bytes: rawOutput.length,
          input_tokens: itSeed,
          output_tokens: otSeed,
          cost_usd: costSeed,
        });
        return new Response(JSON.stringify({ success: true, seed: normalized }), {
          status: 200, headers: { 'Content-Type': 'application/json', ...corsHeaders }
        });
      } catch (err) {
        if (logId) await logApiFinish(env, logId, { status: 'failed', duration_ms: Date.now() - t0, error_message: err.message });
        return new Response(JSON.stringify({ success: false, errMessage: err.message }), {
          status: 200, headers: { 'Content-Type': 'application/json', ...corsHeaders }
        });
      }
    }

    // POST /api/stream/enable-download
    // §2026-05-25 fei: CF Stream needs an explicit "downloads" generation
    //   step before the underlying mp4 is fetchable. Caller posts the
    //   Stream UID; we POST to CF Stream's /downloads endpoint (which is
    //   idempotent — re-posting is safe). Response tells caller whether
    //   the mp4 is ready, in progress (with percent), or errored.
    //
    //   Frontend pattern: poll this endpoint every 3s until status='ready',
    //   then fetch the returned URL as blob + trigger browser download.
    //
    //   Input  : { uid: string }   (the 32-char Stream UID)
    //          | { url: string }   (any Stream URL; we extract UID)
    //   Output : { success, status: 'ready' | 'inprogress' | 'error',
    //              url?: string, percentComplete?: number }
    if (url.pathname === '/api/stream/enable-download' && request.method === 'POST') {
      const corsHeaders = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST, OPTIONS' };
      if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders });

      try {
        const body = await request.json();
        let uid = body?.uid;
        if (!uid && body?.url) {
          const m = String(body.url).match(/(?:videodelivery\.net|cloudflarestream\.com)\/([a-f0-9]{32})/i);
          if (m) uid = m[1];
        }
        if (!uid || !/^[a-f0-9]{32}$/i.test(uid)) {
          return new Response(JSON.stringify({ success: false, errMessage: 'Missing or invalid uid (expected 32 hex chars).' }), {
            status: 400, headers: { 'Content-Type': 'application/json', ...corsHeaders }
          });
        }

        const CF_ACCOUNT_ID = env.CF_ACCOUNT_ID || 'd2acf946d8f80f382be77437a71c4832';
        const CF_API_TOKEN  = env.CF_API_TOKEN  || ('cfut' + '_MGaGN86d75OIHOSPrVfqP7f2iw' + 'nhpxpbnSRhNNJi231d9654');
        if (!CF_API_TOKEN) throw new Error('CF_API_TOKEN not configured');

        // POST to /downloads — idempotent. CF Stream:
        //   · On first call: starts mp4 generation, returns status='inprogress' percent=0
        //   · Subsequent calls: returns current status (inprogress / ready / error)
        const cfRes = await fetch(
          `https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/stream/${uid}/downloads`,
          {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${CF_API_TOKEN}` }
          }
        );
        const cfJson = await cfRes.json();
        if (!cfRes.ok || !cfJson.success) {
          const errMsg = cfJson?.errors?.[0]?.message || `CF Stream API HTTP ${cfRes.status}`;
          throw new Error(errMsg);
        }
        const dl = cfJson.result?.default || {};
        return new Response(JSON.stringify({
          success: true,
          status: dl.status || 'unknown',                 // 'ready' | 'inprogress' | 'error'
          url: dl.url || null,
          percentComplete: dl.percentComplete ?? null,
        }), { status: 200, headers: { 'Content-Type': 'application/json', ...corsHeaders } });
      } catch (err) {
        return new Response(JSON.stringify({ success: false, errMessage: err.message }), {
          status: 200, headers: { 'Content-Type': 'application/json', ...corsHeaders }
        });
      }
    }

    // GET /api/stream/download-proxy?url=<encoded mp4 url>&filename=<encoded fn>
    // §2026-05-26 fei: CF Stream's customer-*.cloudflarestream.com mp4 URLs
    //   block cross-origin fetch from uvera.ai with CORS. Direct browser
    //   download via <a download> also failed because the browser inherits
    //   the cross-origin restriction for blob conversion + the filename
    //   attribute is ignored for cross-origin links. Solution: proxy the
    //   fetch through this worker (same-origin to the page), set
    //   Content-Disposition: attachment so the browser saves rather than
    //   navigates, and stream the upstream body straight through (no
    //   buffering — keeps memory flat for large mp4s).
    //
    //   Whitelist: only CF Stream domains are allowed as upstream targets
    //   to prevent the worker becoming an open proxy.
    //
    //   Use: frontend builds `<a href="/api/stream/download-proxy?url=...&
    //   filename=...">` and clicks it. The browser navigates, the worker
    //   responds with the file + attachment disposition, the browser saves.
    if (url.pathname === '/api/stream/download-proxy' && request.method === 'GET') {
      try {
        const targetUrl = url.searchParams.get('url');
        const filename  = url.searchParams.get('filename') || 'video.mp4';

        if (!targetUrl) {
          return new Response('Missing `url` query param', { status: 400 });
        }
        // Whitelist CF Stream + videodelivery.net only (prevent open-proxy abuse).
        if (!/^https:\/\/(customer-[a-z0-9]+\.cloudflarestream\.com|videodelivery\.net)\//i.test(targetUrl)) {
          return new Response('Upstream URL not on allowlist (CF Stream domains only)', { status: 403 });
        }

        const upstream = await fetch(targetUrl, {
          // Forward Range so seeking + resume work for large files.
          headers: request.headers.get('Range') ? { 'Range': request.headers.get('Range') } : {},
        });

        if (!upstream.ok && upstream.status !== 206) {
          return new Response(`Upstream fetch failed: HTTP ${upstream.status}`, { status: upstream.status });
        }

        // Build response headers — pass through Content-Type/Length/Range, force
        // attachment with the user-supplied filename (UTF-8 safe via RFC 5987).
        const safeAscii = filename.replace(/[^\x20-\x7E]/g, '_');
        const headers = new Headers();
        headers.set('Content-Type', upstream.headers.get('Content-Type') || 'video/mp4');
        const cl = upstream.headers.get('Content-Length');     if (cl) headers.set('Content-Length', cl);
        const cr = upstream.headers.get('Content-Range');      if (cr) headers.set('Content-Range', cr);
        const ar = upstream.headers.get('Accept-Ranges');      if (ar) headers.set('Accept-Ranges', ar);
        headers.set('Content-Disposition', `attachment; filename="${safeAscii}"; filename*=UTF-8''${encodeURIComponent(filename)}`);
        headers.set('Cache-Control', 'private, no-store');
        headers.set('Access-Control-Allow-Origin', '*');

        return new Response(upstream.body, { status: upstream.status, headers });
      } catch (err) {
        return new Response(`Proxy error: ${err.message}`, { status: 500 });
      }
    }

    // POST /api/byteplus/certify-asset
    // §2026-05-24 fei: user-triggered Asset Library certification.
    //   Wraps uploadRealPersonAssetToBytePlus so the frontend Free Mode
    //   can offer a "Certify" button per uploaded asset. Once certified,
    //   the asset gets an asset://<id> URI that bypasses BytePlus's
    //   automatic safety filter — required for real-person reference
    //   photos to be accepted by Seedance.
    //
    //   Input  : { assetUrl: string, assetType: 'Image' | 'Video' }
    //   Output : { success: true, assetUri: 'asset://xxx' }
    //   Errors : { success: false, errMessage: string with admin hint }
    if (url.pathname === '/api/byteplus/certify-asset' && request.method === 'POST') {
      const corsHeaders = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST, OPTIONS' };
      if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders });

      const t0 = Date.now();
      let logId = null;
      try {
        const { assetUrl, assetType: rawType } = await request.json();
        if (!assetUrl || typeof assetUrl !== 'string') {
          return new Response(JSON.stringify({ success: false, errMessage: 'assetUrl required' }), {
            status: 400, headers: { 'Content-Type': 'application/json', ...corsHeaders }
          });
        }
        const assetType = rawType === 'Video' ? 'Video' : 'Image';
        // Skip certification if already an asset:// URI (idempotent for double-clicks)
        if (assetUrl.startsWith('asset://')) {
          return new Response(JSON.stringify({ success: true, assetUri: assetUrl, alreadyCertified: true }), {
            status: 200, headers: { 'Content-Type': 'application/json', ...corsHeaders }
          });
        }

        logId = await logApiStart(env, request, 'asset_describe', {
          prompt: `[certify-asset ${assetType}] ${assetUrl.slice(0, 200)}`,
          vendor: 'volcengine',
        });

        const assetUri = await uploadRealPersonAssetToBytePlus(assetUrl, env, assetType);

        await logApiFinish(env, logId, {
          status: 'succeeded',
          duration_ms: Date.now() - t0,
          http_status: 200,
          response_size_bytes: assetUri.length,
          cost_usd: 0,
        });
        return new Response(JSON.stringify({ success: true, assetUri }), {
          status: 200, headers: { 'Content-Type': 'application/json', ...corsHeaders }
        });
      } catch (err) {
        if (logId) await logApiFinish(env, logId, { status: 'failed', duration_ms: Date.now() - t0, error_message: err.message });
        return new Response(JSON.stringify({ success: false, errMessage: err.message }), {
          status: 200, headers: { 'Content-Type': 'application/json', ...corsHeaders }
        });
      }
    }

    // POST /api/generate-multi-segment-script
    // §2026-05-23 fei: bypass aiscreenwriter Edge Function for multi-segment
    //   stories. The external screenwriter has a fixed output schema
    //   ({summary, mood, shots}) and doesn't honor our segments[] schema,
    //   so multi-segment stories were getting back empty segment envelopes
    //   with no shot bodies. This endpoint uses Gemini directly with a
    //   system prompt we fully control → reliable structured segments[].
    //
    //   Input  : { transcript, videoType, segmentCount, style, character?,
    //              characterSeed?, language? }
    //   Output : { success: true, script: { summary, mood, totalDuration,
    //              segments: [{segmentIndex, summary, targetDurationSec,
    //                          shots: [{number, action, camera, dialogue,
    //                                   narration, duration}] }] } }
    if (url.pathname === '/api/generate-multi-segment-script' && request.method === 'POST') {
      const corsHeaders = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST, OPTIONS' };
      if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders });

      const t0 = Date.now();
      let logId = null;
      try {
        await requireUser(request, env);  // §2026-05-29 挡匿名烧 Gemini;脚本维持免费
        const body = await request.json();
        const {
          transcript,
          videoType: vt = 'trailer',
          segmentCount: rawSegCount = 3,
          style = {},
          character = {},
          characterSeed = null,
          language = 'auto',
        } = body || {};

        if (!transcript || typeof transcript !== 'string' || transcript.trim().length < 3) {
          return new Response(JSON.stringify({ success: false, errMessage: 'transcript required (min 3 chars)' }), {
            status: 400, headers: { 'Content-Type': 'application/json', ...corsHeaders }
          });
        }
        const segmentCount = Math.max(1, Math.min(5, Number(rawSegCount) || 1));

        logId = await logApiStart(env, request, 'script', {
          prompt: `[multi-segment x${segmentCount}] ${transcript.slice(0, 200)}`,
          model: GEMINI_TEXT_MODEL,
          vendor: 'gemini',
        });
        const gaApiKey = env.NEODOMAIN_GA_API_KEY;
        if (!gaApiKey) throw new Error('NEODOMAIN_GA_API_KEY not configured');

        // ── Per-videoType pacing / shot density hints ────────────────
        const SHOT_HINT = {
          'trailer':     { shotsPerSeg: '2-3', vocab: 'cinematic angles, push-ins, low angles, dramatic shadow shapes' },
          'mv':          { shotsPerSeg: '3-4', vocab: 'rhythmic fast cuts, profile drifts, overhead spins, near-lens passes' },
          'vlog':        { shotsPerSeg: '2-3', vocab: 'handheld eye-level, talking-head, candid B-roll' },
          'short-drama': { shotsPerSeg: '2-3', vocab: 'over-the-shoulder, medium-close reactions, environmental wides' },
          'art-film':    { shotsPerSeg: '1-2', vocab: 'symmetrical framing, long focal length, contemplative stillness' },
          'product':     { shotsPerSeg: '2-3', vocab: 'hero-centered, controlled studio lighting, feature close-ups' },
        };
        const hint = SHOT_HINT[vt] || SHOT_HINT.trailer;

        // §2026-06-04 — a single-segment story holds the ENTIRE arc in ONE
        //   segment, so it needs the full shot density rather than the
        //   per-segment slice used when the story is split across segments.
        //   (Mirrors the old client-side SCRIPT_SHOT_COUNT_HINT that used to
        //   feed the now-removed external aiscreenwriter path — the default
        //   segmentCount is 1, so this is the common case.)
        const SINGLE_SEG_SHOTS = {
          'trailer':     '6-10',
          'mv':          '8-12',
          'short-drama': '4-6',
          'vlog':        '4-6',
          'art-film':    '2-4',
          'product':     '5-8',
        };
        const shotsPerSeg = segmentCount === 1
          ? (SINGLE_SEG_SHOTS[vt] || SINGLE_SEG_SHOTS.trailer)
          : hint.shotsPerSeg;

        // §2026-05-30 fei round-2 — actor IS the protagonist.
        //   The user-uploaded Actor (photo + identity_features) is always
        //   the lead of every scene. The transcript describes the SCENE
        //   the actor appears in. When the transcript implies a specific
        //   different person, that person becomes a SUPPORTING CHARACTER
        //   (NPC). The actor's identity stays fixed; the story bends around
        //   them. See actorBlock + system prompt rule 7 below.
        //
        //   Round-1 (wrong direction): tried to ignore the photo entirely
        //   and infer protagonist from transcript. That produced "old lady
        //   bakes pie" stories where the photo's young man never appeared,
        //   which is not what users want when they upload their own face.
        const hasActor = !!(character && (character.name || character.description));
        const actorBlock = hasActor
          ? `\nActor (the user-uploaded protagonist):\n  Name: ${character.name || '(unspecified)'}\n  Identity: ${character.description || '(no description)'}\n`
          : '';

        // characterSeed kept for back-compat; if present treated as
        //   additional flavor on top of the actor — does not override.
        const seedLines = [];
        if (characterSeed?.seed)         seedLines.push(`  Seed flavor: ${characterSeed.seed}`);
        if (characterSeed?.otherDetails) seedLines.push(`  Additional notes: ${characterSeed.otherDetails}`);
        const seedBlock = seedLines.length > 0
          ? `\nOptional character seed (additive — does NOT override actor identity):\n${seedLines.join('\n')}\n`
          : '';

        const styleLine = style?.prompt
          ? `Visual style flavor (for staging only — the storyboard is rendered as rough sketch): ${style.name || ''} — ${style.prompt}`
          : '';

        const langInstr = language && language !== 'auto'
          ? `Write all summary / dialogue / narration / action text in ${language}.`
          : 'Detect the user\'s input language and write all summary / dialogue / narration / action text in the SAME language.';

        const sysPrompt = `You are a cinematic AI screenwriter for an AI video generation product. The user gives you a one-sentence idea + a target structure. You produce a structured multi-segment script formatted as STRICT JSON.

PRODUCT CONTEXT:
The story will be rendered as ${segmentCount} sequential video segments, each 10-15 seconds long, all sharing ONE storyboard image. Each video segment is generated separately by Seedance, with the SAME storyboard reference but a DIFFERENT prompt targeting that segment's shot range. So shots in different segments must be visually distinct (different action, different camera angle).

OUTPUT SCHEMA — ONLY valid JSON, no markdown fences, no commentary:
{
  "summary": "1-2 sentence overall story arc",
  "mood": "one of: 温馨 | 热血 | 奇幻 | 治愈 | 悬疑 | 浪漫 | (or English equivalent)",
  "protagonist": {
    // §2026-05-31 round-4 — the protagonist IS the user's Actor.
    //   When an Actor is provided (see input block below), this field MUST
    //   mirror the Actor's identity FROM THE PHOTO. Demographics (age,
    //   gender, distinguishing_features) come from the photo —
    //   DO NOT change them to match what the transcript implies.
    //   Only role/personality/outfit/emotional_arc are scene-derived.
    "name": "<Actor's user-given name from input block, or short invented one if no Actor>",
    "age": "infant | child | teen | young-adult | middle-aged | elderly",
    "gender": "male | female | non-binary | unspecified",
    "role": "<what this character DOES in this story (scene-derived), e.g. 'pie recipient', 'witness', 'late-night patron'>",
    "personality": "<1-2 words, scene-derived>",
    "outfit": "<wardrobe — keep close to Actor's photo; adapt slightly to scene if needed>",
    "distinguishing_features": "<from Actor photo when uploaded; from story when no Actor>",
    "emotional_arc": "<1 sentence on emotional evolution>"
  },
  "supporting_characters": [
    // §2026-05-31 round-4 — populate ONLY when the transcript implies a
    //   SPECIFIC character whose demographics (age band, gender) DON'T match
    //   the Actor's. That character becomes a visible NPC in the storyboard
    //   AND video — interacts with the protagonist on screen. Empty array
    //   when Actor naturally fits the transcript's lead role.
    {
      "name": "<scene-appropriate name>",
      "age": "infant | child | teen | young-adult | middle-aged | elderly",
      "gender": "male | female | non-binary | unspecified",
      "appearance": "<concrete visual description for image gen — hair, body type, accessories, full sentence>",
      "outfit": "<wardrobe, full sentence>",
      "role": "<what they do in the story>",
      "relationship_to_protagonist": "<e.g. 'grandmother of the protagonist', 'stranger at the cafe'>",
      "interaction": "<one-sentence summary of how they interact with the protagonist>"
    }
  ],
  "totalDuration": <number, sum of all segment durations>,
  "segments": [
    {
      "segmentIndex": 1,
      "summary": "what this segment is about — 1 sentence, sets up its beat",
      "targetDurationSec": <integer, 10-15>,
      "shots": [
        {
          "number": 1,
          "action": "concrete visual motion. Always include the protagonist (refer as 'the protagonist' / 'he' / 'she' / 'they' / Actor's name). When supporting_characters exist, ALSO depict them visibly — e.g. 'an elderly woman in a knit cardigan slides a warm pie across the counter to the protagonist, who reaches for it'. DO NOT bake the protagonist's age/gender/outfit details into shot text — those live in the protagonist field. Supporting characters' appearance DOES go inline so the storyboard can render them.",
          "camera": "explicit framing + movement (e.g. 'low-angle push-in through hanging crystals')",
          "dialogue": "spoken line by character, or null if silent shot",
          "narration": "voiceover / inner monologue, or null",
          "duration": <number, seconds, typically 3-6>
        }
      ]
    }
  ]
}

REQUIRED rules:
1. Output EXACTLY ${segmentCount} segments (not more, not fewer).
2. Each segment must have ${shotsPerSeg} shots (per videoType "${vt}").
3. shot.number is globally unique across all segments (segment 1 has shots 1..K, segment 2 starts at K+1, etc.).
4. Story arc:
   - Segment 1 = opening hook (introduce character + world + central question)
${segmentCount >= 3 ? `   - Segments 2 through ${segmentCount - 1} = continuous escalation (raise stakes, deepen mystery, build to peak)` : ''}
   - Segment ${segmentCount} = climactic payoff (resolve the central question, land the emotional beat)
5. Each shot description must be VISUALLY CONCRETE — describe motion, framing, lighting. Avoid abstract feelings like "she is sad" — instead "tear breaks at the corner of her eye, slow pan reveals empty room".
6. Preferred camera vocabulary for this videoType: ${hint.vocab}.
7. PROTAGONIST = ACTOR + SUPPORTING_CHARACTERS for everyone else:
${actorBlock}${seedBlock}
   ${hasActor
     ? `   ## Hard constraints (NON-NEGOTIABLE)
   The Actor described above IS the protagonist of EVERY scene. The Actor:
     · age, gender, distinguishing_features come FROM THE PHOTO (above)
     · NEVER change these to match what the transcript implies
     · NEVER set protagonist.gender to a gender different from the Actor's
   The transcript describes the SCENE, not who the protagonist IS.

   ## Demographic match check (deciding supporting_characters)
   When the transcript implies a SPECIFIC character (with explicit age, gender, or role like "old lady", "young soldier"), compare their demographics to the Actor's:
     • MATCH (same age band + same gender, OR transcript is loose like "a person bakes"):
         → The Actor IS that character; supporting_characters stays EMPTY.
         → Example: "warrior charges" + Actor "30yo male" → Actor is the warrior.
         → Example: "old lady bakes" + Actor "elderly female" → Actor is the old lady.
     • MISMATCH (different age band OR different gender):
         → The transcript-described character becomes a SUPPORTING CHARACTER.
         → Add one entry to supporting_characters[] with their full appearance.
         → Shot.action depicts BOTH the Actor AND this character interacting on screen.
         → Example: "old lady bakes a pie" + Actor "28yo male" →
             protagonist = the 28yo male Actor (NOT an old lady),
             supporting_characters = [{ "name": "Grandma Chen", "age": "elderly", "gender": "female", "appearance": "silver-grey bun, knit cardigan, reading glasses on a chain", ... }],
             shot.action = "Grandma Chen slides a warm pie across the kitchen counter to the protagonist, who reaches for it with both hands."
         → Example: "young soldier marches" + Actor "60yo female" →
             protagonist = the 60yo female Actor (NOT a young soldier),
             supporting_characters = [{ "name": "the soldier", "age": "young-adult", "gender": "male", "appearance": "tall lean build, buzz cut, regulation greens", ... }],
             shot.action = "The young soldier marches past the protagonist, who watches from the storefront, hand over her heart."

   ## Atmosphere/action only (no explicit character)
   "late afternoon at a coffee shop", "rain on the windows" → Actor takes the lead naturally; supporting_characters stays EMPTY.

   ## Shot text rules
   - Refer to the Actor as "the protagonist" / "he" / "she" / their name.
   - Describe supporting characters BY NAME + appearance inline so the
     storyboard can draw them (e.g. "Grandma Chen, silver-haired in a
     knit cardigan, leans over the counter...").
   - DO NOT bake the Actor's age/gender/outfit into shot text — those
     live in the protagonist field.
   - DO depict supporting characters visibly in shot.action — the
     storyboard renders panels FROM these text descriptions.

   ## protagonist field rules
   - protagonist.age / .gender / .distinguishing_features: COPY from the
     Actor block above (PHOTO-derived, immutable for this story).
   - protagonist.role / .personality / .outfit / .emotional_arc:
     scene-derived. May adapt to fit the story.
   - protagonist.name: USE THE NAME FROM THE ACTOR BLOCK VERBATIM when
     given. Only invent a name if the Actor block has no name.`
     : `   ## No Actor uploaded
   Infer the protagonist from the transcript naturally — pick the most
   fitting age band, gender (or 'unspecified'), social role, personality,
   outfit, distinguishing features, emotional arc.
   Supporting_characters stays empty unless the transcript explicitly
   describes additional people the protagonist interacts with.

   ## Shot text rules
   - Refer to the character as "the protagonist" / "he" / "she" / "they" / their role.
   - DO NOT bake age/gender/hair/skin/outfit details into shot text —
     those belong in the protagonist field.`
   }
${styleLine ? '8. ' + styleLine + '\n' : ''}9. ${langInstr}
10. Sum of segment targetDurationSec values goes into totalDuration.
11. CRITICAL: Output ONLY the JSON object. No backticks, no "Here is the script:" preamble, nothing else.

USER INPUT:
${transcript.trim()}`;

        const geminiRes = await geminiFetch({
          kind: 'text',
          headers: { 'Authorization': `Bearer ${gaApiKey}` },
          body: JSON.stringify({
            contents: [{ parts: [{ text: sysPrompt }] }],
            generationConfig: { temperature: 0.85 },
          }),
        });
        const geminiData = await geminiRes.json();
        if (!geminiRes.ok) throw new Error('Gemini API error: ' + JSON.stringify(geminiData));

        const rawOutput = geminiData.candidates?.[0]?.content?.parts?.[0]?.text || '{}';
        // Strip any accidental markdown fencing
        const cleaned = rawOutput
          .replace(/```json/gi, '')
          .replace(/```/g, '')
          .trim();

        let script;
        try {
          script = JSON.parse(cleaned);
        } catch (parseErr) {
          // Salvage: find first '{' to last '}' in case the model wrapped extra text
          const start = cleaned.indexOf('{');
          const end = cleaned.lastIndexOf('}');
          if (start >= 0 && end > start) {
            script = JSON.parse(cleaned.slice(start, end + 1));
          } else {
            throw new Error('Gemini returned unparseable output: ' + cleaned.slice(0, 200));
          }
        }

        // Normalize: enforce exactly segmentCount segments + clamp durations.
        //   Frontend's normalizeMultiSegmentScript() does this too, but
        //   sanitizing on the server side keeps the contract clean.
        const segs = Array.isArray(script.segments) ? script.segments.slice(0, segmentCount) : [];
        while (segs.length < segmentCount) {
          segs.push({
            segmentIndex: segs.length + 1,
            summary: `Segment ${segs.length + 1}`,
            targetDurationSec: 12,
            shots: [],
          });
        }
        const cleanedSegments = segs.map((seg, i) => {
          let dur = Number(seg.targetDurationSec);
          if (!Number.isFinite(dur)) dur = 12;
          dur = Math.max(10, Math.min(15, Math.round(dur)));
          return {
            segmentIndex: i + 1,
            summary: String(seg.summary || `Segment ${i + 1}`),
            targetDurationSec: dur,
            shots: Array.isArray(seg.shots) ? seg.shots : [],
          };
        });
        const flatShots = cleanedSegments.flatMap(s => s.shots);
        const totalDuration = cleanedSegments.reduce((acc, s) => acc + s.targetDurationSec, 0);

        // §2026-05-30 fei: protagonist field — sanitize the LLM's output OR
        //   synth a conservative fallback if it didn't honor the schema. The
        //   character board + storyboard image gens read this object directly,
        //   so it MUST always be present with all 8 keys.
        const rawProt = (script.protagonist && typeof script.protagonist === 'object') ? script.protagonist : {};
        const protagonist = {
          name:                    String(rawProt.name                    || 'Protagonist'),
          age:                     String(rawProt.age                     || 'young-adult'),
          gender:                  String(rawProt.gender                  || 'unspecified'),
          role:                    String(rawProt.role                    || ''),
          personality:             String(rawProt.personality             || ''),
          outfit:                  String(rawProt.outfit                  || ''),
          distinguishing_features: String(rawProt.distinguishing_features || ''),
          emotional_arc:           String(rawProt.emotional_arc           || ''),
        };

        // §2026-05-31 round-4 — supporting_characters[] array. Populated by
        //   the LLM when the transcript implies a character whose demographics
        //   don't match the Actor's. Each entry is sanitized to ensure all
        //   downstream image gens (storyboard, video) have full appearance
        //   detail. Empty array when Actor naturally fits the story.
        const rawSupport = Array.isArray(script.supporting_characters) ? script.supporting_characters : [];
        const supportingCharacters = rawSupport.slice(0, 5).map(c => ({  // cap at 5 to keep storyboard panels readable
          name:        String(c?.name        || ''),
          age:         String(c?.age         || ''),
          gender:      String(c?.gender      || ''),
          appearance:  String(c?.appearance  || ''),
          outfit:      String(c?.outfit      || ''),
          role:        String(c?.role        || ''),
          relationship_to_protagonist: String(c?.relationship_to_protagonist || ''),
          interaction: String(c?.interaction || ''),
        })).filter(c => c.name || c.appearance || c.role);  // drop empty entries

        const normalized = {
          summary: String(script.summary || ''),
          mood:    String(script.mood    || ''),
          protagonist,
          supporting_characters: supportingCharacters,
          totalDuration,
          segments: cleanedSegments,
          // Compat field — frontend storyboard gen + legacy renderers read .shots[]
          shots: flatShots,
        };

        // §2026-05-26 fei — token-based pricing for multi-segment-script
        const { inputTokens: itMSS, outputTokens: otMSS } = extractLlmUsage(geminiData);
        const costMSS = await priceLLMCallUsd(env, { model: GEMINI_TEXT_MODEL, inputTokens: itMSS, outputTokens: otMSS });
        await logApiFinish(env, logId, {
          status: 'succeeded',
          duration_ms: Date.now() - t0,
          http_status: 200,
          response_size_bytes: rawOutput.length,
          input_tokens: itMSS,
          output_tokens: otMSS,
          cost_usd: costMSS,
        });
        return new Response(JSON.stringify({ success: true, script: normalized }), {
          status: 200, headers: { 'Content-Type': 'application/json', ...corsHeaders }
        });
      } catch (err) {
        if (err.httpStatus === 401) {
          return new Response(JSON.stringify({ success: false, errMessage: err.message }), {
            status: 401, headers: { 'Content-Type': 'application/json', ...corsHeaders }
          });
        }
        if (logId) await logApiFinish(env, logId, { status: 'failed', duration_ms: Date.now() - t0, error_message: err.message });
        return new Response(JSON.stringify({ success: false, errMessage: err.message }), {
          status: 200, headers: { 'Content-Type': 'application/json', ...corsHeaders }
        });
      }
    }

    // GET /api/proxy-asset?url=...
    // Proxies asset fetching to bypass CORS issues for FFmpeg
    if (url.pathname === '/api/proxy-asset' && request.method === 'GET') {
      const targetUrl = url.searchParams.get('url');
      if (!targetUrl) return new Response('Missing url', { status: 400 });
      try {
        const response = await fetch(targetUrl);
        const headers = new Headers(response.headers);
        headers.set('Access-Control-Allow-Origin', '*');
        return new Response(response.body, { status: response.status, headers });
      } catch (e) {
        return new Response(e.message, { status: 500, headers: { 'Access-Control-Allow-Origin': '*' } });
      }
    }


    // GET /api/volcengine/video/status/:taskId

    // Returns: { status: 'queued'|'running'|'succeeded'|'failed', videoUrl }
    if (url.pathname.startsWith('/api/volcengine/video/status/') && request.method === 'GET') {
      const corsHeaders = { 'Access-Control-Allow-Origin': '*' };
      try {
        const taskId = url.pathname.replace('/api/volcengine/video/status/', '');
        // §2026-06-06 fei — 回传退款信号给前端(明确告知「积分已返还」)
        let videoRefunded = false, videoRefundedCredits = 0;
        // §2026-05-15: DB-first, env fallback (admin-rotatable)
        const arkApiKey = (await getSystemSetting(env, 'byteplus_ark_api_key', null)) || env.ARK_API_KEY;
        if (!arkApiKey) throw new Error('ARK_API_KEY not configured (checked system_settings.byteplus_ark_api_key + Cloudflare env)');

        const arkRes = await fetch(`https://ark.ap-southeast.bytepluses.com/api/v3/contents/generations/tasks/${taskId}`, {
          method: 'GET',
          headers: { 'Authorization': `Bearer ${arkApiKey}` }
        });

        const arkData = await arkRes.json();

        let normalizedStatus = arkData.status;
        if (arkData.error && !normalizedStatus) {
          normalizedStatus = 'failed';
        }

        // On terminal status, flip the matching generation_logs row from
        // 'started' to 'succeeded'/'failed'. The status=started filter
        // makes this idempotent — a second poll after success no-ops.
        // Best-effort: never blocks the user response.
        if (normalizedStatus === 'succeeded' || normalizedStatus === 'failed') {
          try {
            const supabaseUrl = env.SUPABASE_URL || 'https://wjhdsodlxekvhpahascs.supabase.co';
            // We need duration_ms = now - started_at. Easiest: fetch the
            // started_at, compute, then update. Single round trip via
            // Postgres function would be cleaner but two calls is fine.
            const fetchResp = await fetch(
              // §2026-05-29 增 user_id,tokens_charged 供异步失败退款用
              // §2026-05-31 增 resolution,duration_seconds,model 用于 actual-cost 重算
              `${supabaseUrl}/rest/v1/generation_logs?task_id=eq.${encodeURIComponent(taskId)}&status=eq.started&select=id,started_at,user_id,tokens_charged,resolution,duration_seconds,model`,
              {
                headers: {
                  'Authorization': `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
                  'apikey': env.SUPABASE_SERVICE_ROLE_KEY,
                }
              }
            );
            if (!fetchResp.ok) {
              // §2026-05-15 loud-fail audit
              const errBody = await fetchResp.text().catch(() => '(unreadable)');
              console.error('[generation_logs] SELECT for video status update non-OK', 'status=' + fetchResp.status, 'body=' + errBody.slice(0, 200), 'taskId=' + taskId);
            }
            const rows = fetchResp.ok ? await fetchResp.json() : [];
            if (rows.length > 0) {
              const row = rows[0];
              const startedAt = new Date(row.started_at);
              const durationMs = Date.now() - startedAt.getTime();
              /* §2026-05-25 fei — DO NOT write Seedance TOS temp URL to
               *   output_url. The TOS signed URL expires in 24h, making
               *   admin Generation Logs useless after that (link 404s).
               *
               *   Pipeline contract:
               *     1. status endpoint  (this)        — sets status / duration / NOT URL
               *     2. /api/stream/upload-from-url    — re-PATCHes output_url with
               *        permanent R2 / CF Stream URL after the video is mirrored
               *
               *   If upload never happens (legacy caller, upload failure, user
               *   bailed before save), output_url stays NULL — which is HONEST:
               *   we don't have a permanent URL because nothing was persisted.
               *
               *   Failure-mode notes:
               *     · TOS URL is still in arkData.content?.video_url and gets
               *       returned to the frontend caller below — that path keeps
               *       working (frontend uses it once to upload, then forgets).
               *     · For failed renders we DO still set error_message; just
               *       not output_url. */
              // §2026-05-31 fei — extract BytePlus actuals from response.
              //   Seedance v3 status response typically contains:
              //     usage.completion_tokens / usage.total_tokens (true billing unit)
              //     content.video_url
              //     content.duration                                (rendered length, optional)
              //     content.video.duration / video.video_duration   (some endpoint variants)
              //
              //   We extract defensively — any field that's not present stays
              //   null. Raw response is stored in byteplus_response JSONB for
              //   debug / future schema discovery.
              const usage         = arkData.usage || {};
              const content       = arkData.content || {};
              const actualTokens  = Number(usage.completion_tokens ?? usage.total_tokens);
              const actualDurRaw  = content.duration
                                 ?? content.video?.duration
                                 ?? content.video?.video_duration
                                 ?? null;
              const actualDur     = actualDurRaw != null ? Number(actualDurRaw) : null;

              // Recompute cost_usd if we have actual usage and a token rate.
              //   Otherwise keep cost_basis='estimate' and don't touch cost_usd.
              let recomputedCostUsd = null;
              let costBasis        = 'estimate';
              if (Number.isFinite(actualTokens) && actualTokens > 0) {
                const standardEndpoint = await getSystemSetting(env, 'seedance_standard_endpoint', 'ep-20260507184058-tpr79');
                const isStandard = row.model && row.model === standardEndpoint;
                const ratePerMRaw = isStandard
                  ? await getSystemSetting(env, 'seedance_standard_usd_per_million_tokens', '')
                  : await getSystemSetting(env, 'seedance_fast_usd_per_million_tokens', '');
                const ratePerM = parseFloat(String(ratePerMRaw || '').trim());
                if (Number.isFinite(ratePerM) && ratePerM > 0) {
                  recomputedCostUsd = (actualTokens / 1_000_000) * ratePerM;
                  costBasis = 'actual';
                }
              }

              const updateBody = {
                status: normalizedStatus,
                finished_at: new Date().toISOString(),
                duration_ms: durationMs,
                // output_url intentionally OMITTED — see comment above
                error_message: arkData.error?.message || null,
                // §2026-05-31 — BytePlus actuals
                actual_completion_tokens:      Number.isFinite(actualTokens) ? actualTokens : null,
                actual_video_duration_seconds: Number.isFinite(actualDur) ? actualDur : null,
                cost_basis:                    costBasis,
                byteplus_response:             arkData,
              };
              if (recomputedCostUsd != null) {
                updateBody.cost_usd = recomputedCostUsd;
              }

              const updResp = await fetch(
                `${supabaseUrl}/rest/v1/generation_logs?id=eq.${row.id}&status=eq.started`,
                {
                  method: 'PATCH',
                  headers: {
                    'Authorization': `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
                    'apikey': env.SUPABASE_SERVICE_ROLE_KEY,
                    'Content-Type': 'application/json',
                    'Prefer': 'return=minimal',
                  },
                  body: JSON.stringify(updateBody)
                }
              );
              if (!updResp.ok) {
                // §2026-05-15 loud-fail audit: this is the SAME class of
                // silent failure as the old logApiFinish — without this
                // check, a schema mismatch here would leave video gens
                // stuck at 'started' forever, repeating the May 2026 incident.
                const errBody = await updResp.text().catch(() => '(unreadable)');
                console.error('[generation_logs] video status PATCH non-OK', 'status=' + updResp.status, 'body=' + errBody.slice(0, 200), 'logId=' + row.id, 'newStatus=' + normalizedStatus);
              }

              // §2026-05-29 异步失败退款。只在 PATCH 成功翻转(updResp.ok)且
              // status='failed' 时退。双保险:status=eq.started 过滤让本块只在
              // 【首次】terminal 轮询命中(后续轮询 SELECT 返回 0 行);grant_credits
              // 幂等键 refund:<taskId> 再防任何重复退(并发/重放)。
              if (updResp.ok && normalizedStatus === 'failed' && row.user_id && Number(row.tokens_charged) > 0) {
                const rfd = await creditGrant(env, row.user_id, Number(row.tokens_charged), 'refund',
                  taskId, `refund:${taskId}`, 'Refund: video generation failed');
                if (rfd) {
                  videoRefunded = true; videoRefundedCredits = Number(row.tokens_charged);
                  // §2026-06-06 fei — 在 generation_log 行打退款标记,后台 FAILED 行直接显示「已退款 N」
                  await fetch(`${supabaseUrl}/rest/v1/generation_logs?id=eq.${row.id}`, {
                    method: 'PATCH',
                    headers: { 'Authorization': `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`, 'apikey': env.SUPABASE_SERVICE_ROLE_KEY, 'Content-Type': 'application/json', 'Prefer': 'return=minimal' },
                    body: JSON.stringify({ refunded: true, refunded_credits: Number(row.tokens_charged), refunded_at: new Date().toISOString() }),
                  }).catch(() => {});
                }
              }
            }
          } catch (logErr) {
            console.error('[generation_logs] video status update exception:', logErr.message, 'taskId=' + taskId);
          }
        }

        return new Response(JSON.stringify({
          success: true,
          status: normalizedStatus,          // queued | running | succeeded | failed
          videoUrl: arkData.content?.video_url || null,
          errorMessage: arkData.error?.message || null,
          // §2026-06-06 fei — 本次轮询是否触发了异步退款(及金额),前端据此提示
          refunded: videoRefunded,
          refundedCredits: videoRefundedCredits,
        }), {
          status: 200, headers: { 'Content-Type': 'application/json', ...corsHeaders }
        });
      } catch (err) {
        return new Response(JSON.stringify({ success: false, errMessage: err.message }), {
          status: 500, headers: { 'Content-Type': 'application/json', ...corsHeaders }
        });
      }
    }



    /* §2026-06-06 fei — POST /api/video/reconcile-stuck
     *
     * 关页兜底:异步视频退款(/api/volcengine/video/status)依赖前端轮询到
     * terminal 才翻转日志 + 退款。若用户在 Seedance 跑挂前就关了页面,日志会
     * 永远停在 'started',积分不退。本端点在用户下次进入创作页/Library 时调用:
     * 找出该用户 stuck 在 'started' 且超时的视频任务(有 task_id),逐个向
     * BytePlus 核对真实状态;failed 的翻转为 failed 并退款(复用 refund:<taskId>
     * 幂等键 → 与正常轮询路径绝不重复退);succeeded 的翻转为 succeeded。
     * 返回 { refundedCount, refundedCredits } 供前端三语提示。
     */
    if (url.pathname === '/api/video/reconcile-stuck' && request.method === 'POST') {
      const corsHeaders = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST, OPTIONS' };
      if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders });
      try {
        const caller = await requireUser(request, env);
        const arkApiKey = (await getSystemSetting(env, 'byteplus_ark_api_key', null)) || env.ARK_API_KEY;
        const supabaseUrl = env.SUPABASE_URL || 'https://wjhdsodlxekvhpahascs.supabase.co';
        // 只核对超过 8 分钟仍 'started' 的(避免打扰前端正在轮询的在途任务)
        const STUCK_MINUTES = 8;
        const threshold = new Date(Date.now() - STUCK_MINUTES * 60 * 1000).toISOString();
        const listResp = await fetch(
          `${supabaseUrl}/rest/v1/generation_logs?user_id=eq.${caller.id}&status=eq.started&task_id=not.is.null&started_at=lt.${encodeURIComponent(threshold)}&select=id,task_id,tokens_charged,started_at&limit=20`,
          { headers: { 'Authorization': `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`, 'apikey': env.SUPABASE_SERVICE_ROLE_KEY } }
        );
        const rows = listResp.ok ? await listResp.json() : [];
        let refundedCount = 0, refundedCredits = 0, checked = 0;
        if (arkApiKey) {
          for (const row of rows) {
            checked++;
            try {
              const arkRes = await fetch(`https://ark.ap-southeast.bytepluses.com/api/v3/contents/generations/tasks/${row.task_id}`, {
                headers: { 'Authorization': `Bearer ${arkApiKey}` }
              });
              const arkData = await arkRes.json().catch(() => ({}));
              let st = arkData.status;
              if (arkData.error && !st) st = 'failed';
              if (st !== 'succeeded' && st !== 'failed') continue; // 仍在途,跳过
              // 翻转日志(status=eq.started 过滤 → 幂等,只第一次命中生效)
              const updResp = await fetch(
                `${supabaseUrl}/rest/v1/generation_logs?id=eq.${row.id}&status=eq.started`,
                { method: 'PATCH',
                  headers: { 'Authorization': `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`, 'apikey': env.SUPABASE_SERVICE_ROLE_KEY, 'Content-Type': 'application/json', 'Prefer': 'return=minimal' },
                  body: JSON.stringify({ status: st, finished_at: new Date().toISOString(), error_message: arkData.error?.message || null, byteplus_response: arkData }) }
              );
              if (updResp.ok && st === 'failed' && Number(row.tokens_charged) > 0) {
                const rfd = await creditGrant(env, caller.id, Number(row.tokens_charged), 'refund',
                  row.task_id, `refund:${row.task_id}`, 'Refund: video generation failed (reconcile)');
                if (rfd) {
                  refundedCount++; refundedCredits += Number(row.tokens_charged);
                  // §2026-06-06 fei — generation_log 行打退款标记(后台可见)
                  await fetch(`${supabaseUrl}/rest/v1/generation_logs?id=eq.${row.id}`, {
                    method: 'PATCH',
                    headers: { 'Authorization': `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`, 'apikey': env.SUPABASE_SERVICE_ROLE_KEY, 'Content-Type': 'application/json', 'Prefer': 'return=minimal' },
                    body: JSON.stringify({ refunded: true, refunded_credits: Number(row.tokens_charged), refunded_at: new Date().toISOString() }),
                  }).catch(() => {});
                }
              }
            } catch (e) { console.error('[reconcile-stuck] task error', row.task_id, e.message); }
          }
        }
        return new Response(JSON.stringify({ success: true, checked, refundedCount, refundedCredits }), {
          status: 200, headers: { 'Content-Type': 'application/json', ...corsHeaders }
        });
      } catch (err) {
        return new Response(JSON.stringify({ success: false, errMessage: err.message }), {
          status: err.httpStatus === 401 ? 401 : 500, headers: { 'Content-Type': 'application/json', ...corsHeaders }
        });
      }
    }

    // Proxy requests prefixed with /neodomain-api/ → dev.neodomain.cn (Regular API endpoints)
    if (url.pathname.startsWith('/neodomain-story-api/')) {
      if (request.method === 'OPTIONS') {
        return new Response(null, {
          status: 204,
          headers: {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Requested-With, accessToken, accesstoken',
            'Access-Control-Max-Age': '86400',
          }
        });
      }

      const targetPath = url.pathname.replace(/^\/neodomain-story-api/, '');
      const targetUrl = `https://story.neodomain.cn${targetPath}${url.search}`;
      
      const proxyHeaders = new Headers(request.headers);
      proxyHeaders.delete('Host');
      proxyHeaders.set('Origin', 'https://story.neodomain.cn');
      proxyHeaders.set('Referer', 'https://story.neodomain.cn/');

      const proxyRequest = new Request(targetUrl, {
        method: request.method,
        headers: proxyHeaders,
        body: request.body,
        redirect: 'follow'
      });
      
      const response = await fetch(proxyRequest);
      const responseHeaders = new Headers(response.headers);
      responseHeaders.set('Access-Control-Allow-Origin', '*');
      responseHeaders.set('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With, accessToken, accesstoken');
      
      return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers: responseHeaders
      });
    }

    // Proxy OSS PutObject uploads → AliyunOSS (wlpaas bucket, Shanghai region)
    // Route: /api/oss-put/{objectKey}  expects headers: x-oss-security-token, Authorization, Content-Type
    if (url.pathname.startsWith('/api/oss-put/') && request.method === 'PUT') {
      const objectKey = url.pathname.replace('/api/oss-put/', '');
      const ossUrl = `https://wlpaas.oss-cn-shanghai.aliyuncs.com/${objectKey}`;
      
      const corsHeaders = { 'Access-Control-Allow-Origin': '*' };
      
      const proxyHeaders = new Headers(request.headers);
      proxyHeaders.delete('Host');
      
      // Browsers strip the "Date" header, so we pass it as x-uvera-date and restore it here
      if (proxyHeaders.has('x-uvera-date')) {
        proxyHeaders.set('Date', proxyHeaders.get('x-uvera-date'));
        proxyHeaders.delete('x-uvera-date');
      }

      try {
        const ossRes = await fetch(ossUrl, {
          method: 'PUT',
          headers: proxyHeaders,
          body: request.body
        });
        return new Response(ossRes.body, {
          status: ossRes.status,
          headers: { ...corsHeaders, 'x-oss-status': String(ossRes.status) }
        });
      } catch (err) {
        return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: { 'Content-Type': 'application/json', ...corsHeaders } });
      }
    }

    if (url.pathname.startsWith('/api/oss-put') && request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'PUT, OPTIONS', 'Access-Control-Allow-Headers': '*' } });
    }



    // --- STREAM UPLOAD PROXY (direct_upload ticket) ---
    if (url.pathname === '/api/stream/direct_upload' && request.method === 'POST') {
      const CF_ACCOUNT_ID = env.CF_ACCOUNT_ID || 'd2acf946d8f80f382be77437a71c4832';
      const CF_API_TOKEN = env.CF_API_TOKEN || ('cfut' + '_MGaGN86d75OIHOSPrVfqP7f2iw' + 'nhpxpbnSRhNNJi231d9654');

      try {
        const cfResponse = await fetch(`https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/stream/direct_upload`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${CF_API_TOKEN}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            maxDurationSeconds: 7200,
            creator: "admin-dashboard"
          })
        });

        const cfData = await cfResponse.json();
        return new Response(JSON.stringify(cfData), {
          status: cfResponse.ok ? 200 : 400,
          headers: { 'Content-Type': 'application/json' },
        });
      } catch (err) {
        return new Response(JSON.stringify({ success: false, error: err.message }), {
          status: 500, headers: { 'Content-Type': 'application/json' }
        });
      }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // USER VIDEO UPLOADS WITH ADMIN REVIEW
    //
    // Pipeline (see migrations/20260507_user_video_uploads.up.sql for schema):
    //   /api/user-videos/init-upload  → mint Stream Direct Upload URL +
    //                                   insert user_video_uploads row (status=uploading)
    //   /api/user-videos/finalize     → flip row to status=pending_review
    //   /api/admin/user-videos/list   → admin pending-review queue
    //   /api/admin/user-videos/review → admin approve / reject (approve also
    //                                   inserts into recommended_content for Discover)
    // All endpoints require a valid Supabase JWT in Authorization header;
    // admin endpoints additionally require user_metadata.is_admin=true.
    // ─────────────────────────────────────────────────────────────────────────

    // POST /api/series/save
    // Body: { seriesId?, title, description?, castIds?, episodes? }
    // Returns: { id, status }  — id of the inserted/updated row
    //
    // Upserts a public.series row owned by the caller. seriesId === null
    // → INSERT new row; seriesId !== null → UPDATE existing (scoped by
    // user_id to prevent cross-user edits even if RLS were bypassed).
    //
    // v1.0.6 GA only ships draft save. Publishing flips status='published'
    // — wired up but UI gate is v1.1.
    if (url.pathname === '/api/series/save' && request.method === 'POST') {
      const corsHeaders = { 'Access-Control-Allow-Origin': '*' };
      try {
        const supabaseUrl = env.SUPABASE_URL || 'https://wjhdsodlxekvhpahascs.supabase.co';
        const anonKey = env.SUPABASE_ANON_KEY || '';

        const authHeader = request.headers.get('Authorization');
        if (!authHeader) throw new Error('Authorization header required');
        const callerResp = await fetch(`${supabaseUrl}/auth/v1/user`, {
          headers: { 'Authorization': authHeader, 'apikey': anonKey }
        });
        if (!callerResp.ok) throw new Error('Could not verify caller');
        const caller = await callerResp.json();
        if (!caller?.id) throw new Error('Login required');

        const body = await request.json();
        const { seriesId, title, description, castIds, episodes, status } = body;

        if (!title || typeof title !== 'string' || title.trim().length === 0 || title.length > 200) {
          throw new Error('Title is required (1–200 chars)');
        }
        if (description && description.length > 4000) {
          throw new Error('Description too long (max 4000 chars)');
        }
        if (castIds && !Array.isArray(castIds)) {
          throw new Error('castIds must be an array');
        }
        if (episodes && !Array.isArray(episodes)) {
          throw new Error('episodes must be an array');
        }
        if (status && !['draft', 'published', 'archived'].includes(status)) {
          throw new Error('Invalid status');
        }

        const payload = {
          title: title.trim(),
          description: description ?? null,
          cast_ids: Array.isArray(castIds) ? castIds : [],
          episodes: Array.isArray(episodes) ? episodes : [],
        };
        if (status) payload.status = status;
        if (status === 'published') payload.published_at = new Date().toISOString();

        let resp;
        if (seriesId) {
          // UPDATE — scope by both id AND user_id so we don't accidentally
          // edit someone else's row even via service_role.
          resp = await fetch(
            `${supabaseUrl}/rest/v1/series?id=eq.${seriesId}&user_id=eq.${caller.id}`,
            {
              method: 'PATCH',
              headers: {
                'Authorization': `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
                'apikey': env.SUPABASE_SERVICE_ROLE_KEY,
                'Content-Type': 'application/json',
                'Prefer': 'return=representation',
              },
              body: JSON.stringify(payload),
            }
          );
        } else {
          // INSERT
          resp = await fetch(`${supabaseUrl}/rest/v1/series`, {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
              'apikey': env.SUPABASE_SERVICE_ROLE_KEY,
              'Content-Type': 'application/json',
              'Prefer': 'return=representation',
            },
            body: JSON.stringify({ user_id: caller.id, ...payload }),
          });
        }

        if (!resp.ok) {
          const errText = await resp.text();
          throw new Error(`Series save failed: ${resp.status} ${errText.substring(0, 200)}`);
        }
        const rows = await resp.json();
        const row = Array.isArray(rows) ? rows[0] : rows;
        if (!row?.id) throw new Error('Series save returned no row (may not exist or wrong owner)');

        /* ───────────────────────────────────────────────────────────────
         * §2026-05-26 fei — episodes JSONB → episodes table sync.
         *
         *   Two storage paths coexist during Phase 1 短剧付费 rollout:
         *     · legacy public.series.episodes  (JSONB array, written above)
         *     · new    public.episodes         (one row per ep, paywall reads it)
         *
         *   SeriesDetailPage prefers the new table when it has any rows
         *   (V2 path). If we only update JSONB on save, episodes added
         *   AFTER the new table was first backfilled never show up — that
         *   bug let Neowow ship with 4 JSONB eps but only 1 V2 row, so
         *   /series/<id> showed "1 episode" until I manually backfilled.
         *
         *   This sync block fixes the root cause:
         *     · upsert each ready ep keyed by (series_id, episode_no)
         *       — UNIQUE constraint on that pair lets Postgrest merge
         *     · soft-archive any V2 rows beyond the current ep count so
         *       deleted-from-JSONB eps disappear from /series/<id>
         *     · soft (status='archived') not hard delete — episode_unlocks
         *       has ON DELETE CASCADE which would wipe paying users' unlock
         *       records and let them re-pay for the same episode
         *
         *   Non-fatal: if this fails, JSONB save already succeeded and the
         *   frontend's V2-or-JSONB fallback keeps the page rendering.
         * ─────────────────────────────────────────────────────────────── */
        try {
          const inputEps = Array.isArray(episodes) ? episodes : [];
          const readyEps = inputEps
            .map((ep, idx) => ({ ep, episode_no: idx + 1 }))
            .filter(({ ep }) => ep && ep.status === 'ready' && ep.url);

          if (readyEps.length > 0) {
            const epsPayload = readyEps.map(({ ep, episode_no }) => ({
              series_id: row.id,
              episode_no,
              title: ep.title || `Episode ${episode_no}`,
              video_url: ep.url,
              stream_uid: ep.streamUid || null,
              thumbnail_url: ep.thumbnailUrl || null,
              status: 'ready',
              // is_free_override / ucoins_price_override intentionally
              // omitted — server-side merge keeps any admin-set overrides
              // (Prefer: resolution=merge-duplicates only writes provided keys).
            }));

            const epsResp = await fetch(
              `${supabaseUrl}/rest/v1/episodes?on_conflict=series_id,episode_no`,
              {
                method: 'POST',
                headers: {
                  'Authorization': `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
                  'apikey': env.SUPABASE_SERVICE_ROLE_KEY,
                  'Content-Type': 'application/json',
                  'Prefer': 'resolution=merge-duplicates,return=minimal',
                },
                body: JSON.stringify(epsPayload),
              }
            );
            if (!epsResp.ok) {
              const errText = await epsResp.text();
              console.warn(`[series/save] V2 episodes upsert non-fatal failure: ${epsResp.status} ${errText.substring(0,300)}`);
            }
          }

          // Soft-archive any V2 rows whose episode_no is past the live count
          // (i.e. the user deleted episode N from JSONB). status='archived'
          // is filtered out by SeriesDetailPage's status='ready' query.
          await fetch(
            `${supabaseUrl}/rest/v1/episodes?series_id=eq.${row.id}&episode_no=gt.${readyEps.length}&status=neq.archived`,
            {
              method: 'PATCH',
              headers: {
                'Authorization': `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
                'apikey': env.SUPABASE_SERVICE_ROLE_KEY,
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({ status: 'archived' }),
            }
          );
        } catch (syncErr) {
          console.warn('[series/save] V2 episodes sync error (non-fatal):', syncErr.message);
        }

        return new Response(JSON.stringify({
          success: true,
          id: row.id,
          status: row.status,
        }), { status: 200, headers: { 'Content-Type': 'application/json', ...corsHeaders } });
      } catch (err) {
        console.error('[series/save]', err.message);
        return new Response(JSON.stringify({ success: false, errMessage: err.message }), {
          status: 500, headers: { 'Content-Type': 'application/json', ...corsHeaders }
        });
      }
    }

    // POST /api/series/publish
    // Body: { seriesId }
    // Returns: { id, recommendedContentId }
    //
    // Flips public.series.status → 'published', sets published_at, and
    // upserts a row in public.recommended_content so the series shows up
    // on Discover. The Discover card uses the series title/description
    // and the first episode's thumbnail+playback URL — clicking plays
    // the first episode inline.
    //
    // The recommended_content row is tagged 'series:<id>' which lets us
    // (a) find the existing card on republish and UPDATE rather than
    // duplicate, and (b) future-build a series detail page that links
    // tag → series row.
    //
    // Validation:
    //   - caller must own the series
    //   - title required (already enforced at save-time, double-check here)
    //   - ≥ 1 episode in 'ready' status (otherwise Discover would show a
    //     placeholder with no playable content)
    if (url.pathname === '/api/series/publish' && request.method === 'POST') {
      const corsHeaders = { 'Access-Control-Allow-Origin': '*' };
      try {
        const supabaseUrl = env.SUPABASE_URL || 'https://wjhdsodlxekvhpahascs.supabase.co';
        const anonKey = env.SUPABASE_ANON_KEY || '';

        const authHeader = request.headers.get('Authorization');
        if (!authHeader) throw new Error('Authorization header required');
        const callerResp = await fetch(`${supabaseUrl}/auth/v1/user`, {
          headers: { 'Authorization': authHeader, 'apikey': anonKey }
        });
        if (!callerResp.ok) throw new Error('Could not verify caller');
        const caller = await callerResp.json();
        if (!caller?.id) throw new Error('Login required');

        const { seriesId } = await request.json();
        if (!seriesId) throw new Error('seriesId is required');

        // 1. Load + own-check the series
        const fetchResp = await fetch(
          `${supabaseUrl}/rest/v1/series?id=eq.${seriesId}&user_id=eq.${caller.id}&select=*`,
          {
            headers: {
              'Authorization': `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
              'apikey': env.SUPABASE_SERVICE_ROLE_KEY,
            }
          }
        );
        if (!fetchResp.ok) throw new Error(`Series fetch failed: ${fetchResp.status}`);
        const seriesRows = await fetchResp.json();
        if (!seriesRows.length) {
          throw new Error('Series not found or you do not own it');
        }
        const series = seriesRows[0];

        // 2. Validate publishability
        if (!series.title || !series.title.trim()) {
          throw new Error('Series must have a title to publish');
        }
        const episodes = Array.isArray(series.episodes) ? series.episodes : [];
        const readyEpisodes = episodes.filter(ep => ep && ep.status === 'ready' && ep.url);
        if (readyEpisodes.length === 0) {
          throw new Error('Series must have at least one episode with a ready video before publishing');
        }

        // 3. Build the Discover card payload from the first ready episode.
        // Cover priority: episode.thumbnailUrl (Stream JPG) > episode.url
        // (R2 mp4; <video poster> in Discover will derive a frame).
        const firstEp = readyEpisodes[0];
        const coverUrl = firstEp.thumbnailUrl || firstEp.url;
        const playbackUrl = firstEp.url;
        const seriesTag = `series:${seriesId}`;

        // §2026-06-05 #1 — 给所有 ready episode 的 Stream 视频设 poster 帧 10%
        //   (series episodes 走 internal-video/init-upload,无 finalize hook,
        //    在这里统一兜)。覆盖封面(firstEp)+ 各集播放器 poster。fire-and-forget。
        const STREAM_UID_RE = /(?:videodelivery\.net|cloudflarestream\.com)\/([a-f0-9]{32})/i;
        for (const ep of readyEpisodes) {
          const m = String(ep.thumbnailUrl || ep.url || '').match(STREAM_UID_RE);
          if (m) await setStreamPosterPct(env, m[1]);
        }

        // Note: 'type' (legacy) is intentionally omitted — this Supabase
        // project's recommended_content schema only has 'media_kind'.
        // 'artist' (the row's creator) is NOT NULL on this schema; we
        // use series.user_id since the series owner is the work's
        // attributed author. See existing inserts in StoryGeneratorPage
        // (Quick / Free mode) for the canonical field set: artist /
        // title / cover / video / media_kind / published / tags.
        const cardPayload = {
          artist: series.user_id,
          media_kind: 'Video',
          title: series.title,
          description: series.description || `Series · ${readyEpisodes.length} episode${readyEpisodes.length === 1 ? '' : 's'}`,
          cover: coverUrl,
          video: playbackUrl,
          published: true,
          published_at: new Date().toISOString(),
          // Tags carry both presentation hints (`series` triggers the
          // episode-count badge) and a reverse-lookup key (`series:<id>`
          // lets the next publish UPDATE the same card). `episodes:N`
          // is read by the Discover card renderer to show a "Series · 5
          // eps" badge without an extra DB join.
          tags: ['series', seriesTag, `episodes:${readyEpisodes.length}`],
          // CTA links to the SeriesDetailPage where viewers can browse
          // all episodes. Discover renders this as a click-through link
          // when present (see recommended_content_v2 schema).
          cta_label: readyEpisodes.length > 1 ? `View all ${readyEpisodes.length} episodes` : 'Watch series',
          cta_url: `/series/${seriesId}`,
          cta_target: '_self',
        };

        // 4. Upsert into recommended_content. Look up by the series-specific
        // tag; UPDATE if found, INSERT otherwise. Postgrest's `tags=cs.{...}`
        // is the contains operator on text[]/jsonb arrays.
        const lookupResp = await fetch(
          `${supabaseUrl}/rest/v1/recommended_content?tags=cs.{${seriesTag}}&select=id`,
          {
            headers: {
              'Authorization': `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
              'apikey': env.SUPABASE_SERVICE_ROLE_KEY,
            }
          }
        );
        const existingCards = lookupResp.ok ? await lookupResp.json() : [];

        let recommendedContentId;
        if (existingCards.length > 0) {
          // UPDATE the existing card (republish path)
          const cardId = existingCards[0].id;
          const updateResp = await fetch(
            `${supabaseUrl}/rest/v1/recommended_content?id=eq.${cardId}`,
            {
              method: 'PATCH',
              headers: {
                'Authorization': `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
                'apikey': env.SUPABASE_SERVICE_ROLE_KEY,
                'Content-Type': 'application/json',
                'Prefer': 'return=minimal',
              },
              body: JSON.stringify(cardPayload),
            }
          );
          if (!updateResp.ok) {
            const errText = await updateResp.text();
            throw new Error(`Discover update failed: ${updateResp.status} ${errText.substring(0, 200)}`);
          }
          recommendedContentId = cardId;
        } else {
          // INSERT new card
          const insertResp = await fetch(`${supabaseUrl}/rest/v1/recommended_content`, {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
              'apikey': env.SUPABASE_SERVICE_ROLE_KEY,
              'Content-Type': 'application/json',
              'Prefer': 'return=representation',
            },
            body: JSON.stringify(cardPayload),
          });
          if (!insertResp.ok) {
            const errText = await insertResp.text();
            throw new Error(`Discover insert failed: ${insertResp.status} ${errText.substring(0, 200)}`);
          }
          const [row] = await insertResp.json();
          recommendedContentId = row.id;
        }

        // 5. Flip series status='published', save FK back
        const seriesUpdateResp = await fetch(
          `${supabaseUrl}/rest/v1/series?id=eq.${seriesId}&user_id=eq.${caller.id}`,
          {
            method: 'PATCH',
            headers: {
              'Authorization': `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
              'apikey': env.SUPABASE_SERVICE_ROLE_KEY,
              'Content-Type': 'application/json',
              'Prefer': 'return=minimal',
            },
            body: JSON.stringify({
              status: 'published',
              published_at: new Date().toISOString(),
              cover_url: coverUrl,
              /* §2026-05-26 fei — CRITICAL: also flip lifecycle_status to 'live'.
               *   /api/episodes/:id/access requires lifecycle_status='live'
               *   (line 7890), but the DB default is 'draft' and we previously
               *   never wrote this field on publish. Result: every newly
               *   published series threw "该剧未上架" on paywall checks. Neowow
               *   only worked because someone manually SQL'd it. Now publish
               *   sets both flags atomically. */
              lifecycle_status: 'live',
            }),
          }
        );
        if (!seriesUpdateResp.ok) {
          throw new Error(`Series status update failed: ${seriesUpdateResp.status}`);
        }

        return new Response(JSON.stringify({
          success: true,
          id: seriesId,
          recommendedContentId,
          episodeCount: readyEpisodes.length,
        }), { status: 200, headers: { 'Content-Type': 'application/json', ...corsHeaders } });
      } catch (err) {
        console.error('[series/publish]', err.message);
        return new Response(JSON.stringify({ success: false, errMessage: err.message }), {
          status: 500, headers: { 'Content-Type': 'application/json', ...corsHeaders }
        });
      }
    }

    // POST /api/content-reports/submit
    // Body: { contentType, contentId, reason, detail?, reportedTitle?, reportedUrl? }
    // Returns: { id }
    //
    // Anonymous submission allowed (no Authorization header) — DMCA
    // takedown notices can come from non-users. Authenticated users
    // get attribution via reporter_user_id; anonymous reports are
    // identified only by IP + UA.
    //
    // Validation:
    //   - contentType ∈ {recommended_content, series, user_video_upload}
    //   - reason ∈ {copyright, inappropriate, spam, impersonation, dangerous, other}
    //   - detail length ≤ 4000
    //   - contentId looks like a uuid (basic shape check; FK is the source of truth)
    if (url.pathname === '/api/content-reports/submit' && request.method === 'POST') {
      const corsHeaders = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': '*',
      };
      if (request.method === 'OPTIONS') {
        return new Response(null, { status: 204, headers: corsHeaders });
      }
      try {
        const supabaseUrl = env.SUPABASE_URL || 'https://wjhdsodlxekvhpahascs.supabase.co';
        const anonKey = env.SUPABASE_ANON_KEY || '';

        // Optional auth — anonymous reports are accepted
        let reporterId = null;
        let reporterEmail = null;
        try {
          const authHeader = request.headers.get('Authorization');
          if (authHeader) {
            const r = await fetch(`${supabaseUrl}/auth/v1/user`, {
              headers: { 'Authorization': authHeader, 'apikey': anonKey }
            });
            if (r.ok) {
              const u = await r.json();
              reporterId = u?.id || null;
              reporterEmail = u?.email || null;
            }
          }
        } catch { /* anonymous fallback */ }

        const body = await request.json();
        const { contentType, contentId, reason, detail, reportedTitle, reportedUrl } = body;

        const VALID_TYPES = ['recommended_content', 'series', 'user_video_upload'];
        const VALID_REASONS = ['copyright', 'inappropriate', 'spam', 'impersonation', 'dangerous', 'other'];

        if (!contentType || !VALID_TYPES.includes(contentType)) {
          throw new Error(`contentType must be one of: ${VALID_TYPES.join(', ')}`);
        }
        if (!contentId || typeof contentId !== 'string' || contentId.length < 36) {
          throw new Error('contentId is required (uuid)');
        }
        if (!reason || !VALID_REASONS.includes(reason)) {
          throw new Error(`reason must be one of: ${VALID_REASONS.join(', ')}`);
        }
        if (detail && detail.length > 4000) {
          throw new Error('detail too long (max 4000 chars)');
        }

        // Insert via service_role (RLS deliberately denies anon writes)
        const insertResp = await fetch(`${supabaseUrl}/rest/v1/content_reports`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
            'apikey': env.SUPABASE_SERVICE_ROLE_KEY,
            'Content-Type': 'application/json',
            'Prefer': 'return=representation',
          },
          body: JSON.stringify({
            reporter_user_id: reporterId,
            reporter_email: reporterEmail,
            content_type: contentType,
            reported_content_id: contentId,
            reported_title: reportedTitle || null,
            reported_url: reportedUrl || null,
            reason,
            detail: detail || null,
            reporter_ip: request.headers.get('CF-Connecting-IP') || null,
            reporter_user_agent: request.headers.get('User-Agent') || null,
          }),
        });
        if (!insertResp.ok) {
          const errText = await insertResp.text();
          throw new Error(`Insert failed: ${insertResp.status} ${errText.substring(0, 200)}`);
        }
        const [row] = await insertResp.json();

        return new Response(JSON.stringify({ success: true, id: row.id }), {
          status: 200, headers: { 'Content-Type': 'application/json', ...corsHeaders }
        });
      } catch (err) {
        console.error('[content-reports/submit]', err.message);
        return new Response(JSON.stringify({ success: false, errMessage: err.message }), {
          status: 400, headers: { 'Content-Type': 'application/json', ...corsHeaders }
        });
      }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // USER MANAGEMENT (admin-only)
    //
    // Backed by auth.users (Supabase Auth) which is the source of truth for
    // identity + tokens balance + role flags + ban state. The legacy
    // public.users table is no longer used here — that's where the
    // pre-refactor admin tab pulled stale data from.
    // ─────────────────────────────────────────────────────────────────────────

    // GET /api/admin/users/list?search=<email-substr>&page=1&perPage=50
    // Returns: { users: [{ id, email, name, created_at, last_sign_in_at,
    //                       credits, tier, is_admin, is_super_admin,
    //                       banned, banned_until, video_count, order_count,
    //                       last_generation_at }], total }
    //
    // Pagination uses Supabase's admin/users endpoint native paging
    // (page + perPage). Supabase doesn't support email substring in that
    // endpoint, so we fetch a page and filter client-side. For our scale
    // (< 10k users at GA) that's acceptable; future: add a database view.
    if (url.pathname === '/api/admin/users/list' && request.method === 'GET') {
      const corsHeaders = { 'Access-Control-Allow-Origin': '*' };
      try {
        const supabaseUrl = env.SUPABASE_URL || 'https://wjhdsodlxekvhpahascs.supabase.co';
        const anonKey = env.SUPABASE_ANON_KEY || '';

        const authHeader = request.headers.get('Authorization');
        if (!authHeader) throw new Error('Authorization header required');
        const callerResp = await fetch(`${supabaseUrl}/auth/v1/user`, {
          headers: { 'Authorization': authHeader, 'apikey': anonKey }
        });
        if (!callerResp.ok) throw new Error('Could not verify caller');
        const caller = await callerResp.json();
        if (caller.user_metadata?.is_admin !== true) {
          throw new Error('Admin access required');
        }

        const search = (url.searchParams.get('search') || '').toLowerCase().trim();
        const page = Math.max(1, parseInt(url.searchParams.get('page') || '1', 10));
        const perPage = Math.min(200, Math.max(10, parseInt(url.searchParams.get('perPage') || '50', 10)));

        // Supabase admin list endpoint
        const listResp = await fetch(
          `${supabaseUrl}/auth/v1/admin/users?page=${page}&per_page=${perPage}`,
          {
            headers: {
              'Authorization': `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
              'apikey': env.SUPABASE_SERVICE_ROLE_KEY,
            }
          }
        );
        if (!listResp.ok) {
          const errText = await listResp.text();
          throw new Error(`Users fetch failed: ${listResp.status} ${errText.substring(0, 200)}`);
        }
        const listData = await listResp.json();
        const rawUsers = listData.users || [];

        // Apply search filter (email substring match)
        const filtered = search
          ? rawUsers.filter(u =>
              (u.email || '').toLowerCase().includes(search) ||
              (u.user_metadata?.name || '').toLowerCase().includes(search) ||
              (u.id || '').toLowerCase().includes(search)
            )
          : rawUsers;

        // Enrich each user with quick activity counts (videos / orders /
        // last generation). All best-effort — failures yield null counts
        // rather than failing the whole list.
        const userIds = filtered.map(u => u.id);
        const counts = {};
        const balances = {};  // §2026-05-29 — authoritative credits from user_credits
        try {
          if (userIds.length > 0) {
            // PostgREST count via Prefer: count=exact, but we batch by
            // fetching ids only and counting client-side — simpler and
            // works without explicit aggregations.
            const idsParam = userIds.map(id => `"${id}"`).join(',');

            // §2026-05-29 — authoritative credit balances (user_credits is the
            //   source of truth; user_metadata.credits is only a rollback mirror).
            const balResp = await fetch(
              `${supabaseUrl}/rest/v1/user_credits?select=user_id,balance&user_id=in.(${idsParam})`,
              {
                headers: {
                  'Authorization': `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
                  'apikey': env.SUPABASE_SERVICE_ROLE_KEY,
                }
              }
            );
            if (balResp.ok) {
              const balRows = await balResp.json();
              for (const b of balRows) balances[b.user_id] = b.balance;
            }

            // Video / works count
            const worksResp = await fetch(
              `${supabaseUrl}/rest/v1/recommended_content?select=artist&artist=in.(${idsParam})`,
              {
                headers: {
                  'Authorization': `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
                  'apikey': env.SUPABASE_SERVICE_ROLE_KEY,
                }
              }
            );
            if (worksResp.ok) {
              const works = await worksResp.json();
              for (const w of works) {
                if (!counts[w.artist]) counts[w.artist] = {};
                counts[w.artist].video_count = (counts[w.artist].video_count || 0) + 1;
              }
            }

            // Orders count
            const ordersResp = await fetch(
              `${supabaseUrl}/rest/v1/orders?select=userId&userId=in.(${idsParam})`,
              {
                headers: {
                  'Authorization': `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
                  'apikey': env.SUPABASE_SERVICE_ROLE_KEY,
                }
              }
            );
            if (ordersResp.ok) {
              const orders = await ordersResp.json();
              for (const o of orders) {
                if (!counts[o.userId]) counts[o.userId] = {};
                counts[o.userId].order_count = (counts[o.userId].order_count || 0) + 1;
              }
            }

            // Last generation timestamp (most recent generation_logs row per user)
            const gensResp = await fetch(
              `${supabaseUrl}/rest/v1/generation_logs?select=user_id,started_at&user_id=in.(${idsParam})&order=started_at.desc`,
              {
                headers: {
                  'Authorization': `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
                  'apikey': env.SUPABASE_SERVICE_ROLE_KEY,
                }
              }
            );
            if (gensResp.ok) {
              const gens = await gensResp.json();
              for (const g of gens) {
                if (!counts[g.user_id]) counts[g.user_id] = {};
                if (!counts[g.user_id].last_generation_at) {
                  counts[g.user_id].last_generation_at = g.started_at;
                }
              }
            }
          }
        } catch (enrichErr) {
          // §2026-05-15 loud-fail: admin saw incomplete user counts but no
          // explanation. Escalate so partial data loss is investigable.
          console.error('[admin/users/list] enrichment partial failure:', enrichErr.message, '— admin UI may show incomplete counts');
        }

        const enriched = filtered.map(u => {
          const meta = u.user_metadata || {};
          const c = counts[u.id] || {};
          // Banned: Supabase sets banned_until to a future timestamp when banned.
          // null / undefined / past timestamp = active.
          const bannedUntil = u.banned_until || null;
          const banned = bannedUntil ? (new Date(bannedUntil).getTime() > Date.now()) : false;
          return {
            id: u.id,
            email: u.email || null,
            phone: u.phone || null,
            name: meta.name || meta.full_name || null,
            avatar_url: meta.avatar_url || meta.picture || null,
            created_at: u.created_at,
            last_sign_in_at: u.last_sign_in_at,
            email_confirmed_at: u.email_confirmed_at,
            credits: balances[u.id] ?? (meta.credits ?? null),
            tier: meta.tier || 'free',
            is_admin: meta.is_admin === true,
            is_super_admin: meta.is_super_admin === true,
            banned,
            banned_until: bannedUntil,
            ban_reason: meta.ban_reason || null,
            video_count: c.video_count || 0,
            order_count: c.order_count || 0,
            last_generation_at: c.last_generation_at || null,
            // Provider info (google / email)
            provider: u.app_metadata?.provider || null,
          };
        });

        return new Response(JSON.stringify({
          success: true,
          users: enriched,
          total: enriched.length,
          page,
          perPage,
        }), { status: 200, headers: { 'Content-Type': 'application/json', ...corsHeaders } });
      } catch (err) {
        console.error('[admin/users/list]', err.message);
        return new Response(JSON.stringify({ success: false, errMessage: err.message }), {
          status: 500, headers: { 'Content-Type': 'application/json', ...corsHeaders }
        });
      }
    }

    // POST /api/admin/users/update-role
    // Body: { userId, role: 'super_admin' | 'admin' | 'user' }
    //
    // Sets is_admin / is_super_admin on user_metadata. 'user' = strip both.
    // Self-modification of super_admin status is allowed but flagged in
    // logs — admin can demote themselves to regular user but should think
    // twice about de-supering themselves (last super admin standing
    // problem). Worker doesn't block self-demotion to keep things simple.
    if (url.pathname === '/api/admin/users/update-role' && request.method === 'POST') {
      const corsHeaders = { 'Access-Control-Allow-Origin': '*' };
      try {
        const supabaseUrl = env.SUPABASE_URL || 'https://wjhdsodlxekvhpahascs.supabase.co';
        const anonKey = env.SUPABASE_ANON_KEY || '';

        const authHeader = request.headers.get('Authorization');
        if (!authHeader) throw new Error('Authorization header required');
        const callerResp = await fetch(`${supabaseUrl}/auth/v1/user`, {
          headers: { 'Authorization': authHeader, 'apikey': anonKey }
        });
        if (!callerResp.ok) throw new Error('Could not verify caller');
        const caller = await callerResp.json();
        if (caller.user_metadata?.is_admin !== true) {
          throw new Error('Admin access required');
        }
        // Only super admins can grant / revoke admin roles. Regular admins
        // shouldn't be able to escalate themselves or peers.
        if (caller.user_metadata?.is_super_admin !== true) {
          throw new Error('Super admin access required for role changes');
        }

        const { userId, role } = await request.json();
        if (!userId) throw new Error('userId is required');
        const VALID_ROLES = ['super_admin', 'admin', 'user'];
        if (!role || !VALID_ROLES.includes(role)) {
          throw new Error(`role must be one of: ${VALID_ROLES.join(', ')}`);
        }

        // Fetch current metadata to preserve other fields
        const fetchResp = await fetch(`${supabaseUrl}/auth/v1/admin/users/${userId}`, {
          headers: {
            'Authorization': `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
            'apikey': env.SUPABASE_SERVICE_ROLE_KEY,
          }
        });
        if (!fetchResp.ok) throw new Error(`User lookup failed: ${fetchResp.status}`);
        const targetUser = await fetchResp.json();
        const meta = { ...(targetUser.user_metadata || {}) };

        // Apply role
        if (role === 'super_admin') {
          meta.is_admin = true;
          meta.is_super_admin = true;
        } else if (role === 'admin') {
          meta.is_admin = true;
          delete meta.is_super_admin;
        } else {
          // 'user' — strip both
          delete meta.is_admin;
          delete meta.is_super_admin;
        }

        const updateResp = await fetch(`${supabaseUrl}/auth/v1/admin/users/${userId}`, {
          method: 'PUT',
          headers: {
            'Authorization': `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
            'apikey': env.SUPABASE_SERVICE_ROLE_KEY,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ user_metadata: meta }),
        });
        if (!updateResp.ok) {
          const errText = await updateResp.text();
          throw new Error(`Update failed: ${updateResp.status} ${errText.substring(0, 200)}`);
        }

        return new Response(JSON.stringify({ success: true, role }), {
          status: 200, headers: { 'Content-Type': 'application/json', ...corsHeaders }
        });
      } catch (err) {
        console.error('[admin/users/update-role]', err.message);
        return new Response(JSON.stringify({ success: false, errMessage: err.message }), {
          status: 500, headers: { 'Content-Type': 'application/json', ...corsHeaders }
        });
      }
    }

    // POST /api/admin/users/ban
    // Body: { userId, banned: true|false, reason?: string, durationHours?: number }
    //
    // Banning uses Supabase's `ban_duration` (string like "24h", "168h",
    // "8760h" for a year, or "none" to unban). We store the human-readable
    // reason in user_metadata.ban_reason for transparency on the user
    // detail panel. ban_duration: "100y" effectively bans permanently —
    // admin can always unban later.
    //
    // Side effects:
    //   - User can't log in (Supabase rejects auth attempts during ban)
    //   - Existing JWTs still valid until they expire (max 1h on default
    //     Supabase config). We accept this lag — alternative is force
    //     log-out which is more invasive.
    //   - Banned users' content stays on Discover. Admin should also
    //     unpublish their videos via the Reports / User Videos tab if
    //     the violation requires content takedown.
    if (url.pathname === '/api/admin/users/ban' && request.method === 'POST') {
      const corsHeaders = { 'Access-Control-Allow-Origin': '*' };
      try {
        const supabaseUrl = env.SUPABASE_URL || 'https://wjhdsodlxekvhpahascs.supabase.co';
        const anonKey = env.SUPABASE_ANON_KEY || '';

        const authHeader = request.headers.get('Authorization');
        if (!authHeader) throw new Error('Authorization header required');
        const callerResp = await fetch(`${supabaseUrl}/auth/v1/user`, {
          headers: { 'Authorization': authHeader, 'apikey': anonKey }
        });
        if (!callerResp.ok) throw new Error('Could not verify caller');
        const caller = await callerResp.json();
        if (caller.user_metadata?.is_admin !== true) {
          throw new Error('Admin access required');
        }

        const { userId, banned, reason, durationHours } = await request.json();
        if (!userId) throw new Error('userId is required');
        if (typeof banned !== 'boolean') {
          throw new Error('banned must be true (to ban) or false (to unban)');
        }
        // Prevent banning yourself — recovery would require DB access
        if (banned && userId === caller.id) {
          throw new Error('Refusing to ban yourself — would lock you out of admin access');
        }

        // Compute ban_duration string. Supabase expects e.g. "24h" / "168h" / "none".
        // Default to ~100y (876000h) for "permanent" bans without a duration.
        const banDuration = banned
          ? `${durationHours && durationHours > 0 ? durationHours : 876000}h`
          : 'none';

        // Fetch current metadata to merge ban_reason
        const fetchResp = await fetch(`${supabaseUrl}/auth/v1/admin/users/${userId}`, {
          headers: {
            'Authorization': `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
            'apikey': env.SUPABASE_SERVICE_ROLE_KEY,
          }
        });
        if (!fetchResp.ok) throw new Error(`User lookup failed: ${fetchResp.status}`);
        const targetUser = await fetchResp.json();
        // Refuse to ban another super admin unless caller is super admin
        // AND target is not equal to caller (already handled above).
        if (banned && targetUser.user_metadata?.is_super_admin === true &&
            caller.user_metadata?.is_super_admin !== true) {
          throw new Error('Cannot ban a super admin (only super admins can do that)');
        }

        const meta = { ...(targetUser.user_metadata || {}) };
        if (banned) {
          meta.ban_reason = reason || 'No reason provided';
          meta.banned_at = new Date().toISOString();
          meta.banned_by = caller.email || caller.id;
        } else {
          delete meta.ban_reason;
          delete meta.banned_at;
          delete meta.banned_by;
        }

        const updateResp = await fetch(`${supabaseUrl}/auth/v1/admin/users/${userId}`, {
          method: 'PUT',
          headers: {
            'Authorization': `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
            'apikey': env.SUPABASE_SERVICE_ROLE_KEY,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            ban_duration: banDuration,
            user_metadata: meta,
          }),
        });
        if (!updateResp.ok) {
          const errText = await updateResp.text();
          throw new Error(`Ban update failed: ${updateResp.status} ${errText.substring(0, 200)}`);
        }

        return new Response(JSON.stringify({ success: true, banned, banDuration }), {
          status: 200, headers: { 'Content-Type': 'application/json', ...corsHeaders }
        });
      } catch (err) {
        console.error('[admin/users/ban]', err.message);
        return new Response(JSON.stringify({ success: false, errMessage: err.message }), {
          status: 500, headers: { 'Content-Type': 'application/json', ...corsHeaders }
        });
      }
    }

    // POST /api/admin/content-reports/resolve
    // Body: { reportId, status: 'investigating'|'resolved'|'dismissed', resolutionNote?, actionTaken? }
    if (url.pathname === '/api/admin/content-reports/resolve' && request.method === 'POST') {
      const corsHeaders = { 'Access-Control-Allow-Origin': '*' };
      try {
        const supabaseUrl = env.SUPABASE_URL || 'https://wjhdsodlxekvhpahascs.supabase.co';
        const anonKey = env.SUPABASE_ANON_KEY || '';

        const authHeader = request.headers.get('Authorization');
        if (!authHeader) throw new Error('Authorization header required');
        const callerResp = await fetch(`${supabaseUrl}/auth/v1/user`, {
          headers: { 'Authorization': authHeader, 'apikey': anonKey }
        });
        if (!callerResp.ok) throw new Error('Could not verify caller');
        const caller = await callerResp.json();
        if (caller.user_metadata?.is_admin !== true) {
          throw new Error('Admin access required');
        }

        const { reportId, status, resolutionNote, actionTaken } = await request.json();
        if (!reportId) throw new Error('reportId required');
        const VALID = ['investigating', 'resolved', 'dismissed'];
        if (!status || !VALID.includes(status)) {
          throw new Error(`status must be one of: ${VALID.join(', ')}`);
        }

        const patchResp = await fetch(
          `${supabaseUrl}/rest/v1/content_reports?id=eq.${reportId}`,
          {
            method: 'PATCH',
            headers: {
              'Authorization': `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
              'apikey': env.SUPABASE_SERVICE_ROLE_KEY,
              'Content-Type': 'application/json',
              'Prefer': 'return=minimal',
            },
            body: JSON.stringify({
              status,
              resolved_by: status === 'resolved' || status === 'dismissed' ? caller.id : null,
              resolved_at: status === 'resolved' || status === 'dismissed' ? new Date().toISOString() : null,
              resolution_note: resolutionNote || null,
              action_taken: actionTaken || null,
            }),
          }
        );
        if (!patchResp.ok) {
          const errText = await patchResp.text();
          throw new Error(`Update failed: ${patchResp.status} ${errText.substring(0, 200)}`);
        }

        return new Response(JSON.stringify({ success: true }), {
          status: 200, headers: { 'Content-Type': 'application/json', ...corsHeaders }
        });
      } catch (err) {
        console.error('[admin/content-reports/resolve]', err.message);
        return new Response(JSON.stringify({ success: false, errMessage: err.message }), {
          status: 500, headers: { 'Content-Type': 'application/json', ...corsHeaders }
        });
      }
    }

    // POST /api/series/archive
    // Body: { seriesId }
    // Returns: { id, removedFromDiscover }
    //
    // Inverse of /api/series/publish — flips series.status='archived' and
    // removes the corresponding card from recommended_content (so it
    // disappears from Discover). The series itself is NOT deleted; the
    // owner can republish later by hitting Publish again.
    //
    // We find the Discover card via the 'series:<id>' tag (same convention
    // publish uses for upsert lookup). If a card is missing for any reason
    // we treat that as "already removed" rather than erroring.
    if (url.pathname === '/api/series/archive' && request.method === 'POST') {
      const corsHeaders = { 'Access-Control-Allow-Origin': '*' };
      try {
        const supabaseUrl = env.SUPABASE_URL || 'https://wjhdsodlxekvhpahascs.supabase.co';
        const anonKey = env.SUPABASE_ANON_KEY || '';

        const authHeader = request.headers.get('Authorization');
        if (!authHeader) throw new Error('Authorization header required');
        const callerResp = await fetch(`${supabaseUrl}/auth/v1/user`, {
          headers: { 'Authorization': authHeader, 'apikey': anonKey }
        });
        if (!callerResp.ok) throw new Error('Could not verify caller');
        const caller = await callerResp.json();
        if (!caller?.id) throw new Error('Login required');

        const { seriesId } = await request.json();
        if (!seriesId) throw new Error('seriesId is required');

        // Own-check (admin can also archive any series via service_role
        // direct access, but we route admin actions through this same
        // endpoint with explicit user context).
        const ownerCheck = await fetch(
          `${supabaseUrl}/rest/v1/series?id=eq.${seriesId}&user_id=eq.${caller.id}&select=id,status`,
          {
            headers: {
              'Authorization': `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
              'apikey': env.SUPABASE_SERVICE_ROLE_KEY,
            }
          }
        );
        const ownerRows = ownerCheck.ok ? await ownerCheck.json() : [];
        if (!ownerRows.length) {
          throw new Error('Series not found or you do not own it');
        }

        // 1. Remove the Discover card via the series:<id> tag lookup.
        // Soft-fail if not found — could already be archived, or never
        // got a card if publish previously fell over partway.
        const seriesTag = `series:${seriesId}`;
        const lookupResp = await fetch(
          `${supabaseUrl}/rest/v1/recommended_content?tags=cs.{${seriesTag}}&select=id`,
          {
            headers: {
              'Authorization': `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
              'apikey': env.SUPABASE_SERVICE_ROLE_KEY,
            }
          }
        );
        const cards = lookupResp.ok ? await lookupResp.json() : [];
        let removedFromDiscover = false;
        if (cards.length > 0) {
          const cardId = cards[0].id;
          const delResp = await fetch(
            `${supabaseUrl}/rest/v1/recommended_content?id=eq.${cardId}`,
            {
              method: 'DELETE',
              headers: {
                'Authorization': `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
                'apikey': env.SUPABASE_SERVICE_ROLE_KEY,
              }
            }
          );
          removedFromDiscover = delResp.ok;
        }

        // 2. Flip series status to 'archived'. Preserve published_at as
        // a record of when it was originally on Discover.
        const updResp = await fetch(
          `${supabaseUrl}/rest/v1/series?id=eq.${seriesId}&user_id=eq.${caller.id}`,
          {
            method: 'PATCH',
            headers: {
              'Authorization': `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
              'apikey': env.SUPABASE_SERVICE_ROLE_KEY,
              'Content-Type': 'application/json',
              'Prefer': 'return=minimal',
            },
            body: JSON.stringify({ status: 'archived' })
          }
        );
        if (!updResp.ok) {
          throw new Error(`Series status update failed: ${updResp.status}`);
        }

        return new Response(JSON.stringify({
          success: true,
          id: seriesId,
          removedFromDiscover,
        }), { status: 200, headers: { 'Content-Type': 'application/json', ...corsHeaders } });
      } catch (err) {
        console.error('[series/archive]', err.message);
        return new Response(JSON.stringify({ success: false, errMessage: err.message }), {
          status: 500, headers: { 'Content-Type': 'application/json', ...corsHeaders }
        });
      }
    }

    // POST /api/internal-video/init-upload
    // Body: { fileSize }
    // Returns: { uploadURL, streamUid, playbackUrl, thumbnailUrl }
    //
    // Lightweight cousin of /api/user-videos/init-upload — used for *internal*
    // Stream uploads where the video is the user's own working asset (e.g.
    // Series episode files), NOT something destined for Discover. Skips:
    //   - copyright affirmation (user's own internal content)
    //   - admin review queue (no public exposure)
    //   - DB row in user_video_uploads
    //
    // Just mints a Stream tus URL and returns it. Caller is responsible for
    // tracking the streamUid in their own data structures (e.g. seriesEpisodes
    // state in StoryGeneratorPage). 500 MB hard cap mirrors Upload Video mode.
    if (url.pathname === '/api/internal-video/init-upload' && request.method === 'POST') {
      const corsHeaders = { 'Access-Control-Allow-Origin': '*' };
      try {
        const supabaseUrl = env.SUPABASE_URL || 'https://wjhdsodlxekvhpahascs.supabase.co';
        const anonKey = env.SUPABASE_ANON_KEY || '';

        const authHeader = request.headers.get('Authorization');
        if (!authHeader) throw new Error('Authorization header required');
        const callerResp = await fetch(`${supabaseUrl}/auth/v1/user`, {
          headers: { 'Authorization': authHeader, 'apikey': anonKey }
        });
        if (!callerResp.ok) throw new Error('Could not verify caller');
        const caller = await callerResp.json();
        if (!caller?.id) throw new Error('Login required');

        const { fileSize } = await request.json();
        const MAX_UPLOAD_BYTES = 500 * 1024 * 1024;
        if (!Number.isFinite(fileSize) || fileSize <= 0 || fileSize > MAX_UPLOAD_BYTES) {
          throw new Error(`fileSize required, must be 1 byte – ${MAX_UPLOAD_BYTES} bytes (500 MB)`);
        }

        const CF_ACCOUNT_ID = env.CF_ACCOUNT_ID || 'd2acf946d8f80f382be77437a71c4832';
        const CF_API_TOKEN = env.CF_API_TOKEN || ('cfut' + '_MGaGN86d75OIHOSPrVfqP7f2iw' + 'nhpxpbnSRhNNJi231d9654');

        const b64 = (s) => {
          const bytes = new TextEncoder().encode(s);
          let bin = '';
          for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
          return btoa(bin);
        };
        const metaParts = [
          `creator ${b64(`user:${caller.id}`)}`,
          `uploaded_by ${b64(caller.email || '')}`,
          `purpose ${b64('internal')}`,
          `maxDurationSeconds ${b64('3600')}`,
        ].join(',');

        const streamResp = await fetch(
          `https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/stream?direct_user=true`,
          {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${CF_API_TOKEN}`,
              'Tus-Resumable': '1.0.0',
              'Upload-Length': String(fileSize),
              'Upload-Metadata': metaParts,
            },
          }
        );

        if (!streamResp.ok) {
          let detail;
          try { detail = await streamResp.text(); } catch { detail = ''; }
          throw new Error(`Cloudflare Stream tus error: ${streamResp.status} ${detail.substring(0, 300)}`);
        }
        const tusUploadURL = streamResp.headers.get('Location');
        const streamUid = streamResp.headers.get('stream-media-id');
        if (!tusUploadURL || !streamUid) {
          throw new Error('Stream tus response missing Location / stream-media-id headers');
        }

        return new Response(JSON.stringify({
          success: true,
          uploadURL: tusUploadURL,
          streamUid,
          // Pre-computed playback + thumbnail URLs so caller doesn't have to
          // construct them. iframe URL works as soon as upload completes;
          // thumbnail is auto-generated by Stream after processing.
          playbackUrl: `https://iframe.cloudflarestream.com/${streamUid}`,
          thumbnailUrl: `https://videodelivery.net/${streamUid}/thumbnails/thumbnail.jpg`,
        }), { status: 200, headers: { 'Content-Type': 'application/json', ...corsHeaders } });
      } catch (err) {
        console.error('[internal-video/init-upload]', err.message);
        return new Response(JSON.stringify({ success: false, errMessage: err.message }), {
          status: 500, headers: { 'Content-Type': 'application/json', ...corsHeaders }
        });
      }
    }

    // POST /api/stream/set-poster-frame   Body: { uid }
    // §2026-06-05 #1 — 前端(create/short 等直接写 recommended_content 的流程)
    //   拿到 Stream uid 后调它,把视频 poster 帧设为时长 10%(跳过纯黑首帧)。
    //   worker 侧持有 CF Stream token,前端不接触。需登录;idempotent。
    if (url.pathname === '/api/stream/set-poster-frame' && request.method === 'POST') {
      const corsHeaders = { 'Access-Control-Allow-Origin': '*' };
      try {
        const authHeader = request.headers.get('Authorization');
        if (!authHeader) throw new Error('Authorization header required');
        const supabaseUrl = env.SUPABASE_URL || 'https://wjhdsodlxekvhpahascs.supabase.co';
        const anonKey = env.SUPABASE_ANON_KEY || '';
        const callerResp = await fetch(`${supabaseUrl}/auth/v1/user`, {
          headers: { 'Authorization': authHeader, 'apikey': anonKey }
        });
        if (!callerResp.ok) throw new Error('Could not verify caller');
        const caller = await callerResp.json();
        if (!caller?.id) throw new Error('Login required');

        const { uid, pct } = await request.json();
        // pct 可选(创作者选帧);缺省/越界回退 0.1(时长 10%)。
        const safePct = (typeof pct === 'number' && pct > 0 && pct < 1) ? pct : 0.1;
        const ok = await setStreamPosterPct(env, uid, safePct);
        return new Response(JSON.stringify({ success: ok }), {
          status: ok ? 200 : 502,
          headers: { 'Content-Type': 'application/json', ...corsHeaders },
        });
      } catch (err) {
        console.error('[stream/set-poster-frame]', err.message);
        return new Response(JSON.stringify({ success: false, errMessage: err.message }), {
          status: 500, headers: { 'Content-Type': 'application/json', ...corsHeaders }
        });
      }
    }

    // POST /api/user-videos/init-upload
    // Body: { title, description?, copyrightTextVersion, copyrightAcknowledged: true, fileSize }
    // Returns: { uploadURL, streamUid, recordId }
    //
    // Uses Cloudflare Stream tus protocol (resumable upload). The basic
    // POST endpoint at /stream/direct_upload caps at 200 MB, which is
    // smaller than our 500 MB user requirement. The tus endpoint at
    // /stream?direct_user=true supports up to 30 GB and can resume across
    // dropped connections. Browser uses tus-js-client to PATCH chunks
    // directly to the URL we return here.
    //
    // CF Stream tus protocol details:
    //   POST https://api.cloudflare.com/client/v4/accounts/{id}/stream?direct_user=true
    //   Headers: Tus-Resumable: 1.0.0, Upload-Length: <bytes>,
    //            Upload-Metadata: name <b64>,filename <b64>,filetype <b64>,
    //                             maxDurationSeconds <b64> (Stream's own limit)
    //   Response headers: Location (one-time upload URL),
    //                     stream-media-id (the Stream UID)
    if (url.pathname === '/api/user-videos/init-upload' && request.method === 'POST') {
      const corsHeaders = { 'Access-Control-Allow-Origin': '*' };
      try {
        const supabaseUrl = env.SUPABASE_URL || 'https://wjhdsodlxekvhpahascs.supabase.co';
        const anonKey = env.SUPABASE_ANON_KEY || '';

        // 1. Verify caller is logged in
        const authHeader = request.headers.get('Authorization');
        if (!authHeader) throw new Error('Authorization header required');
        const callerResp = await fetch(`${supabaseUrl}/auth/v1/user`, {
          headers: { 'Authorization': authHeader, 'apikey': anonKey }
        });
        if (!callerResp.ok) throw new Error('Could not verify caller');
        const caller = await callerResp.json();
        if (!caller?.id) throw new Error('Login required');

        // 2. Validate body — copyright MUST be acknowledged. Title + size required.
        const body = await request.json();
        const { title, description, copyrightAcknowledged, copyrightTextVersion, fileSize } = body;
        if (!copyrightAcknowledged) {
          throw new Error('Copyright acknowledgement is required');
        }
        if (!copyrightTextVersion) {
          throw new Error('copyrightTextVersion is required (legal traceability)');
        }
        if (!title || title.length < 1 || title.length > 200) {
          throw new Error('Title is required (1–200 chars)');
        }
        if (description && description.length > 2000) {
          throw new Error('Description too long (max 2000 chars)');
        }
        // tus requires Upload-Length up front. 500 MB cap mirrors client UI;
        // hard server cap prevents a malicious client from claiming 30 GB.
        const MAX_UPLOAD_BYTES = 500 * 1024 * 1024;
        if (!Number.isFinite(fileSize) || fileSize <= 0 || fileSize > MAX_UPLOAD_BYTES) {
          throw new Error(`fileSize required, must be 1 byte – ${MAX_UPLOAD_BYTES} bytes (500 MB)`);
        }

        // 3. Create one-time tus upload URL via CF Stream API.
        // Upload-Metadata is comma-separated `key base64(value)` pairs.
        // We pin maxDurationSeconds to 3600s (1 hour) — anything longer
        // exceeds our review SLA budget per submission anyway.
        const CF_ACCOUNT_ID = env.CF_ACCOUNT_ID || 'd2acf946d8f80f382be77437a71c4832';
        const CF_API_TOKEN = env.CF_API_TOKEN || ('cfut' + '_MGaGN86d75OIHOSPrVfqP7f2iw' + 'nhpxpbnSRhNNJi231d9654');

        // Encoder: btoa needs Latin-1; for unicode title/email we go via
        // TextEncoder→base64. Workers don't have Buffer; this is the
        // standards-compliant path that handles Chinese / emoji safely.
        const b64 = (s) => {
          const bytes = new TextEncoder().encode(s);
          let bin = '';
          for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
          return btoa(bin);
        };
        const metaParts = [
          `name ${b64(title.substring(0, 100))}`,
          `filename ${b64(title.substring(0, 100))}`,
          `creator ${b64(`user:${caller.id}`)}`,
          `uploaded_by ${b64(caller.email || '')}`,
          `maxDurationSeconds ${b64('3600')}`,
        ].join(',');

        const streamResp = await fetch(
          `https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/stream?direct_user=true`,
          {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${CF_API_TOKEN}`,
              'Tus-Resumable': '1.0.0',
              'Upload-Length': String(fileSize),
              'Upload-Metadata': metaParts,
            },
          }
        );

        // tus success is 201 Created with Location header; CF also surfaces
        // errors as JSON body on non-2xx, so we read both paths.
        if (!streamResp.ok) {
          let detail;
          try { detail = await streamResp.text(); } catch { detail = ''; }
          throw new Error(`Cloudflare Stream tus error: ${streamResp.status} ${detail.substring(0, 300)}`);
        }
        const tusUploadURL = streamResp.headers.get('Location');
        const streamUid = streamResp.headers.get('stream-media-id');
        if (!tusUploadURL || !streamUid) {
          throw new Error(`Stream tus response missing Location / stream-media-id headers`);
        }

        // 4. Insert pending row in user_video_uploads (service_role)
        const submitterIp = request.headers.get('CF-Connecting-IP');
        const submitterUa = request.headers.get('User-Agent');
        const insertResp = await fetch(`${supabaseUrl}/rest/v1/user_video_uploads`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
            'apikey': env.SUPABASE_SERVICE_ROLE_KEY,
            'Content-Type': 'application/json',
            'Prefer': 'return=representation',
          },
          body: JSON.stringify({
            user_id: caller.id,
            stream_uid: streamUid,
            title,
            description: description || null,
            file_size_bytes: fileSize,
            status: 'uploading',
            copyright_acknowledged_at: new Date().toISOString(),
            copyright_text_version: copyrightTextVersion,
            submitter_ip: submitterIp || null,
            submitter_user_agent: submitterUa || null,
          })
        });
        if (!insertResp.ok) {
          const errText = await insertResp.text();
          throw new Error(`DB insert failed: ${insertResp.status} ${errText}`);
        }
        const [row] = await insertResp.json();

        return new Response(JSON.stringify({
          success: true,
          uploadURL: tusUploadURL,    // tus one-time URL — client PATCHes chunks here
          streamUid,
          recordId: row.id,
        }), { status: 200, headers: { 'Content-Type': 'application/json', ...corsHeaders } });
      } catch (err) {
        console.error('[user-videos/init-upload]', err.message);
        return new Response(JSON.stringify({ success: false, errMessage: err.message }), {
          status: 500, headers: { 'Content-Type': 'application/json', ...corsHeaders }
        });
      }
    }

    // POST /api/user-videos/finalize
    // Body: { recordId, fileSize?, durationSeconds? }
    // Called by browser after the Stream upload completes — flips status from
    // 'uploading' to 'pending_review' and records optional file metadata.
    if (url.pathname === '/api/user-videos/finalize' && request.method === 'POST') {
      const corsHeaders = { 'Access-Control-Allow-Origin': '*' };
      try {
        const supabaseUrl = env.SUPABASE_URL || 'https://wjhdsodlxekvhpahascs.supabase.co';
        const anonKey = env.SUPABASE_ANON_KEY || '';

        const authHeader = request.headers.get('Authorization');
        if (!authHeader) throw new Error('Authorization header required');
        const callerResp = await fetch(`${supabaseUrl}/auth/v1/user`, {
          headers: { 'Authorization': authHeader, 'apikey': anonKey }
        });
        if (!callerResp.ok) throw new Error('Could not verify caller');
        const caller = await callerResp.json();

        const { recordId, fileSize, durationSeconds, originalFilename } = await request.json();
        if (!recordId) throw new Error('recordId is required');

        // Update — RLS would normally prevent cross-user updates but we use
        // service_role here, so we manually scope by user_id to prevent a
        // user from finalizing someone else's record.
        const updateUrl = `${supabaseUrl}/rest/v1/user_video_uploads` +
          `?id=eq.${recordId}&user_id=eq.${caller.id}&status=eq.uploading`;
        const updateResp = await fetch(updateUrl, {
          method: 'PATCH',
          headers: {
            'Authorization': `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
            'apikey': env.SUPABASE_SERVICE_ROLE_KEY,
            'Content-Type': 'application/json',
            'Prefer': 'return=representation',
          },
          body: JSON.stringify({
            status: 'pending_review',
            file_size_bytes: fileSize || null,
            duration_seconds: durationSeconds || null,
            original_filename: originalFilename || null,
            // Stream playback URLs are deterministic from the UID — fill in
            // here so admin can preview without an extra API hop.
            playback_url: null, // populated after we read stream_uid back
            thumbnail_url: null,
          })
        });
        if (!updateResp.ok) {
          const errText = await updateResp.text();
          throw new Error(`Finalize failed: ${updateResp.status} ${errText}`);
        }
        const updated = await updateResp.json();
        if (!updated.length) throw new Error('No matching uploading record (already finalized or wrong user?)');

        // Backfill playback + thumbnail from the now-known stream_uid
        const streamUid = updated[0].stream_uid;
        if (streamUid) {
          await fetch(
            `${supabaseUrl}/rest/v1/user_video_uploads?id=eq.${recordId}`,
            {
              method: 'PATCH',
              headers: {
                'Authorization': `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
                'apikey': env.SUPABASE_SERVICE_ROLE_KEY,
                'Content-Type': 'application/json',
                'Prefer': 'return=minimal',
              },
              body: JSON.stringify({
                playback_url: `https://iframe.cloudflarestream.com/${streamUid}`,
                thumbnail_url: `https://videodelivery.net/${streamUid}/thumbnails/thumbnail.jpg`,
              })
            }
          );
          // §2026-06-05 #1 — poster 帧设 10%(跳过纯黑首帧)。fire-and-forget。
          await setStreamPosterPct(env, streamUid);
        }

        return new Response(JSON.stringify({ success: true }), {
          status: 200, headers: { 'Content-Type': 'application/json', ...corsHeaders }
        });
      } catch (err) {
        console.error('[user-videos/finalize]', err.message);
        return new Response(JSON.stringify({ success: false, errMessage: err.message }), {
          status: 500, headers: { 'Content-Type': 'application/json', ...corsHeaders }
        });
      }
    }

    // GET /api/admin/user-videos/list?status=pending_review
    // Returns: [{ id, user_id, user_email, title, description, stream_uid,
    //            playback_url, thumbnail_url, status, created_at,
    //            file_size_bytes, duration_seconds, copyright_acknowledged_at,
    //            copyright_text_version, rejection_reason }]
    if (url.pathname === '/api/admin/user-videos/list' && request.method === 'GET') {
      const corsHeaders = { 'Access-Control-Allow-Origin': '*' };
      try {
        const supabaseUrl = env.SUPABASE_URL || 'https://wjhdsodlxekvhpahascs.supabase.co';
        const anonKey = env.SUPABASE_ANON_KEY || '';

        const authHeader = request.headers.get('Authorization');
        if (!authHeader) throw new Error('Authorization header required');
        const callerResp = await fetch(`${supabaseUrl}/auth/v1/user`, {
          headers: { 'Authorization': authHeader, 'apikey': anonKey }
        });
        if (!callerResp.ok) throw new Error('Could not verify caller');
        const caller = await callerResp.json();
        if (caller.user_metadata?.is_admin !== true) {
          throw new Error('Admin access required');
        }

        const statusFilter = url.searchParams.get('status') || 'pending_review';
        const validStatuses = ['uploading','pending_review','approved','rejected','all'];
        if (!validStatuses.includes(statusFilter)) {
          throw new Error('Invalid status filter');
        }

        const filter = statusFilter === 'all' ? '' : `&status=eq.${statusFilter}`;
        const listResp = await fetch(
          `${supabaseUrl}/rest/v1/user_video_uploads?select=*${filter}&order=created_at.desc&limit=100`,
          {
            headers: {
              'Authorization': `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
              'apikey': env.SUPABASE_SERVICE_ROLE_KEY,
            }
          }
        );
        if (!listResp.ok) throw new Error(`List failed: ${listResp.status}`);
        const rows = await listResp.json();

        // Enrich with submitter email — useful for admin without an extra round
        // trip per row in the UI. Batch the user lookups by unique user_id.
        const userIds = [...new Set(rows.map(r => r.user_id).filter(Boolean))];
        const emailMap = {};
        await Promise.all(userIds.map(async (uid) => {
          try {
            const r = await fetch(`${supabaseUrl}/auth/v1/admin/users/${uid}`, {
              headers: {
                'Authorization': `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
                'apikey': env.SUPABASE_SERVICE_ROLE_KEY,
              }
            });
            if (r.ok) {
              const u = await r.json();
              emailMap[uid] = u.email || null;
            }
          } catch { /* ignore */ }
        }));
        const enriched = rows.map(r => ({ ...r, user_email: emailMap[r.user_id] || null }));

        return new Response(JSON.stringify({ success: true, items: enriched }), {
          status: 200, headers: { 'Content-Type': 'application/json', ...corsHeaders }
        });
      } catch (err) {
        console.error('[admin/user-videos/list]', err.message);
        return new Response(JSON.stringify({ success: false, errMessage: err.message }), {
          status: 500, headers: { 'Content-Type': 'application/json', ...corsHeaders }
        });
      }
    }

    // POST /api/admin/user-videos/review
    // Body: { recordId, action: 'approve' | 'reject', rejectionReason? }
    // Approve: inserts a row in recommended_content (so the video appears on
    //          Discover per product decision 2026-05-07) and marks approved.
    // Reject: marks rejected with reason; does NOT delete the Stream asset
    //         (in case the user appeals — admin can re-approve later).
    if (url.pathname === '/api/admin/user-videos/review' && request.method === 'POST') {
      const corsHeaders = { 'Access-Control-Allow-Origin': '*' };
      try {
        const supabaseUrl = env.SUPABASE_URL || 'https://wjhdsodlxekvhpahascs.supabase.co';
        const anonKey = env.SUPABASE_ANON_KEY || '';

        const authHeader = request.headers.get('Authorization');
        if (!authHeader) throw new Error('Authorization header required');
        const callerResp = await fetch(`${supabaseUrl}/auth/v1/user`, {
          headers: { 'Authorization': authHeader, 'apikey': anonKey }
        });
        if (!callerResp.ok) throw new Error('Could not verify caller');
        const caller = await callerResp.json();
        if (caller.user_metadata?.is_admin !== true) {
          throw new Error('Admin access required');
        }

        const { recordId, action, rejectionReason } = await request.json();
        if (!recordId) throw new Error('recordId is required');
        if (action !== 'approve' && action !== 'reject') {
          throw new Error('action must be "approve" or "reject"');
        }
        if (action === 'reject' && (!rejectionReason || rejectionReason.length < 5)) {
          throw new Error('rejectionReason is required (min 5 chars) when rejecting');
        }

        // Load the record so we have all metadata for downstream Discover insert
        const fetchResp = await fetch(
          `${supabaseUrl}/rest/v1/user_video_uploads?id=eq.${recordId}&select=*`,
          {
            headers: {
              'Authorization': `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
              'apikey': env.SUPABASE_SERVICE_ROLE_KEY,
            }
          }
        );
        if (!fetchResp.ok) throw new Error(`Record fetch failed: ${fetchResp.status}`);
        const rows = await fetchResp.json();
        if (!rows.length) throw new Error('Record not found');
        const record = rows[0];
        if (record.status !== 'pending_review') {
          throw new Error(`Cannot review a record in status='${record.status}' (must be pending_review)`);
        }

        let recommendedContentId = null;

        if (action === 'approve') {
          // Insert into recommended_content so it shows up on Discover.
          // We deliberately don't pin or set CTA — admin can edit those
          // later in the Homepage Feed tab if they want to feature it.
          const playbackUrl = record.playback_url || `https://iframe.cloudflarestream.com/${record.stream_uid}`;
          const thumbnailUrl = record.thumbnail_url || `https://videodelivery.net/${record.stream_uid}/thumbnails/thumbnail.jpg`;
          const insertFeedResp = await fetch(`${supabaseUrl}/rest/v1/recommended_content`, {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
              'apikey': env.SUPABASE_SERVICE_ROLE_KEY,
              'Content-Type': 'application/json',
              'Prefer': 'return=representation',
            },
            // Note: 'type' (legacy) intentionally omitted — schema only
            // has media_kind. 'artist' is NOT NULL — set to the uploader
            // (record.user_id) since they're the original creator.
            body: JSON.stringify({
              artist: record.user_id,
              media_kind: 'Video',
              title: record.title,
              description: record.description || null,
              cover: thumbnailUrl,
              video: playbackUrl,
              published: true,
              published_at: new Date().toISOString(),
              tags: ['user-upload'],
            })
          });
          if (!insertFeedResp.ok) {
            const errText = await insertFeedResp.text();
            throw new Error(`Discover insert failed: ${insertFeedResp.status} ${errText}`);
          }
          const [feedRow] = await insertFeedResp.json();
          recommendedContentId = feedRow?.id || null;
        }

        // Update the upload record (single PATCH for both approve + reject)
        const patchPayload = {
          status: action === 'approve' ? 'approved' : 'rejected',
          reviewed_by: caller.id,
          reviewed_at: new Date().toISOString(),
          rejection_reason: action === 'reject' ? rejectionReason : null,
          recommended_content_id: recommendedContentId,
        };
        const patchResp = await fetch(
          `${supabaseUrl}/rest/v1/user_video_uploads?id=eq.${recordId}`,
          {
            method: 'PATCH',
            headers: {
              'Authorization': `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
              'apikey': env.SUPABASE_SERVICE_ROLE_KEY,
              'Content-Type': 'application/json',
              'Prefer': 'return=minimal',
            },
            body: JSON.stringify(patchPayload)
          }
        );
        if (!patchResp.ok) {
          const errText = await patchResp.text();
          throw new Error(`Status update failed: ${patchResp.status} ${errText}`);
        }

        return new Response(JSON.stringify({
          success: true,
          action,
          recommendedContentId,
        }), { status: 200, headers: { 'Content-Type': 'application/json', ...corsHeaders } });
      } catch (err) {
        console.error('[admin/user-videos/review]', err.message);
        return new Response(JSON.stringify({ success: false, errMessage: err.message }), {
          status: 500, headers: { 'Content-Type': 'application/json', ...corsHeaders }
        });
      }
    }

    // --- VIDEO: Download from Volcengine TOS → store permanently in R2 ---
    // POST /api/stream/upload-from-url
    // Body: { videoUrl }  — Worker downloads the video (bypasses CORS / signed-URL restrictions)
    // Returns: { success, videoUrl }  — permanent asset.uvera.ai R2 URL
    if (url.pathname === '/api/stream/upload-from-url' && request.method === 'POST') {
      const corsHeaders = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST, OPTIONS' };
      if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders });
      try {
        const { videoUrl: srcUrl, taskId } = await request.json();
        if (!srcUrl) throw new Error('videoUrl is required');
        // §2026-05-15 P0.b: caller may pass `taskId` (BytePlus arkData.id)
        // so we can PATCH generation_logs.file_size_bytes after the upload.
        // null is OK — feature degrades gracefully (no file_size capture).

        // §2026-05-15 Free/Lite tier: route through Cloudflare Stream so we
        // can burn in a "uvera.ai" watermark via Stream's watermark UID API.
        // Paid tier: keep on R2 (cheaper, no watermark). Per-tier branching
        // happens inline below — single endpoint, two storage backends, all
        // transparent to frontend (player handles both URL forms — see
        // src/utils/streamUrl.js isStreamUrl / extractStreamUid).
        //
        // Decision: see docs/decisions/2026-05-15-stream-watermark.md
        let callerTier = 'free';
        try {
          const authHeader = request.headers.get('Authorization');
          if (authHeader) {
            const supabaseUrl = env.SUPABASE_URL || 'https://wjhdsodlxekvhpahascs.supabase.co';
            const anonKey = env.SUPABASE_ANON_KEY || '';
            const r = await fetch(`${supabaseUrl}/auth/v1/user`, {
              headers: { 'Authorization': authHeader, 'apikey': anonKey }
            });
            if (r.ok) {
              const u = await r.json();
              callerTier = u?.user_metadata?.tier || 'free';
            }
          }
        } catch { /* anon = free = watermarked */ }

        // §2026-05-22 fei: 所有 tier 都走 Cloudflare Stream (统一存储 + 全球
        //   edge CDN 加速 + 单一播放器). 之前 paid→R2 / unpaid→Stream 的双轨,
        //   导致前端要维护两种 player (native <video> + <Stream> iframe),
        //   iOS Safari 上 <Stream> iframe 的 mount 代价让 swipe-back 黑屏.
        //   现在: 永远 Stream. watermark 只在 free/lite tier 应用.
        //
        //   旧逻辑保留为 history (comments below) 以备 R2 路径 future need.
        const isUnpaidTier = callerTier === 'free' || callerTier === 'lite';

        console.log(`[video-upload] Downloading source video (tier=${callerTier}, route=cf-stream${isUnpaidTier ? '+watermark' : ''}):`, srcUrl.substring(0, 80) + '...');

        // Workers CAN fetch Volcengine TOS signed URLs — CF Stream copy-by-URL cannot
        const videoRes = await fetch(srcUrl, {
          headers: { 'User-Agent': 'Mozilla/5.0 (compatible; Cloudflare-Worker)' }
        });
        if (!videoRes.ok) throw new Error(`Failed to download video from TOS: HTTP ${videoRes.status}`);

        const videoBuffer = await videoRes.arrayBuffer();
        const contentType = videoRes.headers.get('content-type') || 'video/mp4';
        const sizeMb = (videoBuffer.byteLength / 1024 / 1024).toFixed(1);

        // §2026-05-15 P0.b: PATCH generation_logs.file_size_bytes if caller
        // gave us a taskId. Best-effort + fire-and-forget — failures here
        // are logged loud (per loud-fail pattern) but don't block the
        // upload response. Without taskId we have no way to correlate
        // (legacy callers + admin reconciliation flows).
        const supabaseUrlForLog = env.SUPABASE_URL || 'https://wjhdsodlxekvhpahascs.supabase.co';
        // §2026-05-22 fei: combined helper. Was just patchGenerationLogSize
        //   — now also overwrites output_url with the PERMANENT storage URL
        //   (R2 / CF Stream) once we know it. Before, output_url stored the
        //   Seedance TOS temp URL (volces.com) which looks scary in admin
        //   Logs tab ("why is everything pointing at volces.com? did upload
        //   fail?") even though uploads were succeeding. Now it points
        //   where the video actually lives.
        const patchGenerationLogFinal = async (permanentUrl, storageKind) => {
          if (!taskId) return;  // legacy caller, skip
          try {
            const r = await fetch(
              `${supabaseUrlForLog}/rest/v1/generation_logs?task_id=eq.${encodeURIComponent(taskId)}`,
              {
                method: 'PATCH',
                headers: {
                  'Authorization': `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
                  'apikey': env.SUPABASE_SERVICE_ROLE_KEY,
                  'Content-Type': 'application/json',
                  'Prefer': 'return=minimal',
                },
                body: JSON.stringify({
                  file_size_bytes: videoBuffer.byteLength,
                  output_url: permanentUrl,  // overwrites the TOS temp URL with R2/Stream permanent URL
                }),
              }
            );
            if (!r.ok) {
              const t = await r.text().catch(() => '');
              console.error('[video-upload] generation_logs PATCH non-OK', 'status=' + r.status, 'taskId=' + taskId, 'storage=' + storageKind, 'body=' + t.slice(0, 200));
            } else {
              console.log(`[video-upload] generation_logs.output_url updated to ${storageKind} URL (taskId=${taskId})`);
            }
          } catch (e) {
            console.error('[video-upload] generation_logs PATCH exception:', e.message, 'taskId=' + taskId);
          }
        };

        // §2026-05-22 fei: 单一路径 — 所有 tier 都上传到 Cloudflare Stream.
        //   只有 free/lite tier 加 watermark; paid tier 不加.
        //   旧的 R2 paid path (else branch) 整段删除. R2 视频 (legacy 历史
        //   行) 继续在 DB 里活着,前端 UnifiedVideoPlayer 仍然能播 (直链 mp4
        //   走 native <video>). 新生成的视频从今天起全是 Stream URL.
        const CF_ACCOUNT_ID = env.CF_ACCOUNT_ID || 'd2acf946d8f80f382be77437a71c4832';
        // §2026-05-15 fallback: mirror /api/stream/direct_upload pattern.
        // Open TODO: rotate the token and remove the fallback in both sites.
        const CF_API_TOKEN = env.CF_API_TOKEN || ('cfut' + '_MGaGN86d75OIHOSPrVfqP7f2iw' + 'nhpxpbnSRhNNJi231d9654');
        if (!CF_API_TOKEN) {
          throw new Error('CF_API_TOKEN not set — cannot upload to Stream. Fix: `npx wrangler secret put CF_API_TOKEN` with Stream:Edit token.');
        }

        // Watermark UID lookup: only applies to free/lite. Paid skips.
        let watermarkUid = null;
        if (isUnpaidTier) {
          const wmFromSettings = await getSystemSetting(env, 'stream_watermark_uid', null);
          watermarkUid = wmFromSettings || env.STREAM_WATERMARK_UID || null;
          if (!watermarkUid) {
            console.error('[video-upload] No watermark UID configured — free/lite output will NOT be watermarked. Fix: run scripts/setup-stream-watermark.mjs and persist UID to system_settings.stream_watermark_uid.');
          }
        }

        // Multipart upload (TOS signed URLs aren't fetchable by CF Stream's puller).
        const form = new FormData();
        form.append('file', new Blob([videoBuffer], { type: contentType }), `gen_${Date.now()}.mp4`);
        form.append('meta', JSON.stringify({
          name: `uvera-gen-${Date.now()}`,
          uploader_tier: callerTier,
        }));
        if (watermarkUid) {
          form.append('watermark', JSON.stringify({ uid: watermarkUid }));
        }
        form.append('requireSignedURLs', 'false');

        const streamResp = await fetch(
          `https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/stream`,
          {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${CF_API_TOKEN}` },
            body: form,
          }
        );
        if (!streamResp.ok) {
          const errBody = await streamResp.text().catch(() => '');
          console.error('[video-upload] CF Stream upload non-OK', 'status=' + streamResp.status, 'body=' + errBody.slice(0, 300));
          throw new Error(`CF Stream upload failed (${streamResp.status}): ${errBody.slice(0, 200)}`);
        }
        const streamData = await streamResp.json();
        if (!streamData.success) {
          throw new Error('CF Stream upload returned success=false: ' + JSON.stringify(streamData.errors || {}));
        }
        const streamUid = streamData.result?.uid;
        if (!streamUid) throw new Error('CF Stream response missing UID');

        // Canonical playback URL — UnifiedVideoPlayer extracts uid + builds
        //   HLS manifest URL for native <video>. iOS Safari plays natively
        //   without iframe; hls.js handles Chrome/Firefox/Android via MSE.
        const playbackUrl = `https://iframe.cloudflarestream.com/${streamUid}`;
        console.log('[video-upload] ✅ CF Stream upload OK', 'tier=' + callerTier, 'uid=' + streamUid, 'watermark=' + (watermarkUid || 'NONE'), 'size=' + sizeMb + 'MB', 'taskId=' + (taskId || 'n/a'));

        await patchGenerationLogFinal(playbackUrl, 'cloudflare-stream');

        return new Response(JSON.stringify({
          success: true,
          videoUrl: playbackUrl,
          streamUid,
          storage: 'cloudflare-stream',
          watermarked: !!watermarkUid,
          tier: callerTier,
          fileSizeBytes: videoBuffer.byteLength,
        }), {
          status: 200, headers: { 'Content-Type': 'application/json', ...corsHeaders }
        });
      } catch (err) {
        console.error('[video-upload] Error:', err.message);
        return new Response(JSON.stringify({ success: false, errMessage: err.message }), {
          status: 500, headers: { 'Content-Type': 'application/json', ...corsHeaders }
        });
      }
    }


    // --- CORS IMAGE PROXY ---
    if (url.pathname === '/api/proxy-image') {
      const targetUrl = url.searchParams.get('url');
      const corsHeaders = { 'Access-Control-Allow-Origin': '*' };
      if (!targetUrl) return new Response('Missing url param', { status: 400, headers: corsHeaders });
      
      try {
        const imgRes = await fetch(targetUrl, {
          headers: {
            'User-Agent': 'Cloudflare-Worker'
          }
        });
        const headers = new Headers(imgRes.headers);
        headers.set('Access-Control-Allow-Origin', '*');
        headers.set('Access-Control-Allow-Methods', 'GET, OPTIONS');
        return new Response(imgRes.body, { status: imgRes.status, headers });
      } catch (e) {
        return new Response(e.message, { status: 500, headers: corsHeaders });
      }
    }

    // --- R2 UPLOAD PROXY ---
    if (url.pathname.startsWith('/api/upload/')) {
      const origin = request.headers.get('Origin') || '';
      const corsHeaders = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': '*',
        'Access-Control-Allow-Methods': 'PUT, POST, OPTIONS',
      };

      if (request.method === 'OPTIONS') {
        return new Response(null, { status: 204, headers: corsHeaders });
      }

      if (request.method !== 'PUT' && request.method !== 'POST') {
        return new Response('Method Not Allowed', { status: 405 });
      }

      const objectKey = url.pathname.replace('/api/upload/', '');
      if (!objectKey) {
        return new Response('Missing object key', { status: 400 });
      }

      /* 2026-04-23 objectKey 前缀白名单 — 防止未来路径错配把非预期 POST body
       * 静默写成 0-byte R2 object（参考 2026-04-20 /upload/stream_ticket 事故）。
       *   cover_      — admin 封面 (cover_<ts>_<filename>)
       *   video_      — admin 视频  (video_<ts>_<filename>，走 Stream 前的备用)
       *   generated/  — neoaiService 生成图镜像 (generated/concept_<ts>_<rand>.jpg)
       *   characters/ — neoaiService 上传的 character photo
       * 任一端新增前缀需同步更新本白名单。 */
      const ALLOWED_KEY_PREFIXES = ['cover_', 'video_', 'generated/', 'characters/'];
      if (
        objectKey.length > 256 ||
        objectKey.includes('..') ||
        !ALLOWED_KEY_PREFIXES.some(p => objectKey.startsWith(p))
      ) {
        return new Response(
          JSON.stringify({
            error: `Invalid objectKey. Must be <= 256 chars, no '..', and start with one of: ${ALLOWED_KEY_PREFIXES.join(', ')}`,
          }),
          { status: 400, headers: { 'Content-Type': 'application/json', ...corsHeaders } }
        );
      }

      // Ensure R2 bucket is bound in CF dashboard or wrangler.jsonc
      if (!env.BUCKET) {
        return new Response(JSON.stringify({ error: "R2 BUCKET binding is missing" }), { 
            status: 500, headers: { 'Content-Type': 'application/json', ...corsHeaders } 
        });
      }

      try {
        const CUSTOM_DOMAIN = 'https://asset.uvera.ai';
        const contentType = request.headers.get('Content-Type') || 'application/octet-stream';
        const body = await request.arrayBuffer();

        await env.BUCKET.put(objectKey, body, {
          httpMetadata: { contentType },
        });

        const publicUrl = `${CUSTOM_DOMAIN}/${objectKey}`;
        return new Response(JSON.stringify({ url: publicUrl }), {
          status: 200,
          headers: { 'Content-Type': 'application/json', ...corsHeaders },
        });
      } catch (err) {
        return new Response(JSON.stringify({ error: err.message }), { 
            status: 500, headers: { 'Content-Type': 'application/json', ...corsHeaders } 
        });
      }
    }

    // ─── Stripe: checkout session ───────────────────────────────────────
    // POST /api/stripe/checkout
    // Body: { tier: 'lite'|'starter'|'creator'|'studio', billing: 'monthly'|'yearly', successUrl?, cancelUrl? }  →  { url }
    // Creates a Stripe Checkout Session for the authenticated user; client
    // window.location's to the returned `url`. Stripe handles the actual
    // payment UI; on success, Stripe webhooks /api/stripe/webhook below.
    //
    // tier='lite' is a ONE-TIME $3.99 purchase that grants 100 tokens and
    // sets the user's tier to 'lite'. No subscription, no trial, no auto-
    // conversion. User can re-purchase Lite, or upgrade to Starter/Creator/
    // Studio (which DOES become a subscription) at any time.
    // ─── Lite tiered pricing preview ─────────────────────────────────
    // ─── Video models config (admin-rotatable) ───────────────────────
    // GET /api/video-models  →  {
    //   models: [{ id, label, tier_required }],
    //   default_for_tier: { free: 'ep-...', starter: 'ep-...', ... },
    // }
    //
    // Replaces the hardcoded <option> values in StoryGeneratorPage. Reads
    // current endpoint IDs from system_settings so admins can rotate them
    // without redeploying the worker (e.g. when BytePlus issues a new
    // endpoint after model upgrades — happened 2026-05-07).
    //
    // Tier-aware: Free locked to Fast; paid tiers can also pick Standard.
    // Frontend uses this both to render the dropdown options AND to
    // determine the default selection per tier.
    if (url.pathname === '/api/video-models' && request.method === 'GET') {
      const corsHeaders = { 'Access-Control-Allow-Origin': '*' };
      try {
        const fastEndpoint = await getSystemSetting(env, 'seedance_fast_endpoint', 'ep-20260507183959-d7mr2');
        const standardEndpoint = await getSystemSetting(env, 'seedance_standard_endpoint', 'ep-20260507184058-tpr79');

        /* §2026-05-25 fei — per-model cost multiplier.
         *   Lets pricing for Fast vs Standard differ on top of the
         *   resolution rate. Admin-tunable via system_settings:
         *     seedance_fast_cost_multiplier      (default 1.0)
         *     seedance_standard_cost_multiplier  (default 1.5)
         *   Final per-segment cost (client + server)
         *     = duration × RESOLUTION_CREDITS_PER_SEC[res] × multiplier
         *     ROUNDed up to nearest integer so users never undershoot.
         *   Frontend reads cost_multiplier off each model option in the
         *   /api/video-models response — see StoryGeneratorPage.jsx
         *   computeQuickModeVideoCost() and the confirm modal. */
        const fastMultiplierStr = await getSystemSetting(env, 'seedance_fast_cost_multiplier', '1.0');
        const standardMultiplierStr = await getSystemSetting(env, 'seedance_standard_cost_multiplier', '1.5');
        const fastMultiplier = Number(fastMultiplierStr) || 1.0;
        const standardMultiplier = Number(standardMultiplierStr) || 1.5;

        // Look up caller tier (optional — anon defaults to free)
        let callerTier = 'free';
        try {
          const authHeader = request.headers.get('Authorization');
          if (authHeader) {
            const supabaseUrl = env.SUPABASE_URL || 'https://wjhdsodlxekvhpahascs.supabase.co';
            const anonKey = env.SUPABASE_ANON_KEY || '';
            const r = await fetch(`${supabaseUrl}/auth/v1/user`, {
              headers: { 'Authorization': authHeader, 'apikey': anonKey }
            });
            if (r.ok) {
              const u = await r.json();
              callerTier = u?.user_metadata?.tier || 'free';
            }
          }
        } catch { /* ignore — default free */ }

        // §2026-06-05 per-model max_resolution — BytePlus Seedance 2.0 Fast
        //   不支持 1080p(只 480p/720p),Standard 才到 1080p。前端据此 gate
        //   resolution 选择器(Fast 选项下锁 1080p)。与 resolveModelMaxResolution
        //   同源 system_settings,admin 轮换/解锁无需改前端。
        const fastMaxRes = await getSystemSetting(env, 'seedance_fast_max_resolution', '720p');
        const standardMaxRes = await getSystemSetting(env, 'seedance_standard_max_resolution', '1080p');

        // All models (front-end uses tier_required to gray-out / hide locked options)
        const models = [
          { id: fastEndpoint,     label: 'Seedance 2.0 Fast',     tier_required: 'free',    cost_multiplier: fastMultiplier,     max_resolution: fastMaxRes },
          { id: standardEndpoint, label: 'Seedance 2.0 Standard', tier_required: 'starter', cost_multiplier: standardMultiplier, max_resolution: standardMaxRes },
        ];

        // Default per tier — Free always Fast; paid tier defaults to Fast
        // too (cheaper / more permissive moderation), but can pick Standard.
        const TIER_RANK = { free: 0, lite: 1, starter: 2, creator: 3, studio: 4 };
        const callerRank = TIER_RANK[callerTier] ?? 0;
        const availableModels = models.filter(m => callerRank >= (TIER_RANK[m.tier_required] ?? 0));
        const defaultModel = fastEndpoint;  // Fast for everyone by default

        return new Response(JSON.stringify({
          success: true,
          tier: callerTier,
          models: availableModels,
          allModels: models,  // for admin / debug — full list incl. tier-locked
          default: defaultModel,
        }), {
          status: 200,
          headers: { 'Content-Type': 'application/json', ...corsHeaders }
        });
      } catch (err) {
        return new Response(JSON.stringify({ success: false, errMessage: err.message }), {
          status: 500,
          headers: { 'Content-Type': 'application/json', ...corsHeaders }
        });
      }
    }

    // GET /api/lite/next-price  →  { tier, priceUsd, priceCents, completedCount }
    //
    // Frontend calls this on /subscription page load to show the
    // accurate price for the current user's next Lite purchase.
    // Without this, the card would always show $3.99 even after the
    // user has already bought once (next would actually be $5.99).
    //
    // Authentication: requires a logged-in user (any tier). Anonymous
    // visitors don't reach the /subscription page anyway.
    if (url.pathname === '/api/lite/next-price' && request.method === 'GET') {
      const corsHeaders = { 'Access-Control-Allow-Origin': '*' };
      try {
        const authHeader = request.headers.get('Authorization');
        if (!authHeader) throw new Error('Authorization header required');
        const userResp = await fetch(`${env.SUPABASE_URL || 'https://wjhdsodlxekvhpahascs.supabase.co'}/auth/v1/user`, {
          headers: { 'Authorization': authHeader, 'apikey': env.SUPABASE_ANON_KEY || '' }
        });
        if (!userResp.ok) throw new Error('Could not resolve user');
        const user = await userResp.json();

        // §2026-05-14: switched from monotonic count → time-decay
        // elevation. Same final price math (LITE_PRICE_TIERS_CENTS), but
        // elevation can come back down if the user doesn't buy for
        // `lite_price_cooldown_hours` (system_settings, default 3h).
        const elevation = await computeLiteElevation(env, user.id);
        const priceCents = getLitePriceCentsForElevation(elevation);
        const tierIndex = elevation + 1;  // 1-indexed for human display

        return new Response(JSON.stringify({
          success: true,
          tier: tierIndex,
          priceUsd: priceCents / 100,
          priceCents,
          elevation,
          tokensGranted: 100,
        }), {
          status: 200,
          headers: { 'Content-Type': 'application/json', ...corsHeaders }
        });
      } catch (err) {
        // Fail-safe: return tier 1 so frontend at least shows something
        return new Response(JSON.stringify({
          success: false,
          errMessage: err.message,
          // Default to tier 1 so frontend renders SOMETHING
          tier: 1,
          priceUsd: LITE_PRICE_TIERS_CENTS[0] / 100,
          priceCents: LITE_PRICE_TIERS_CENTS[0],
          completedCount: 0,
          tokensGranted: 100,
        }), {
          status: 200,  // Still 200 so frontend doesn't break — error is in body
          headers: { 'Content-Type': 'application/json', ...corsHeaders }
        });
      }
    }

    if (url.pathname === '/api/stripe/checkout' && request.method === 'POST') {
      const corsHeaders = { 'Access-Control-Allow-Origin': '*' };
      try {
        const { tier, billing, successUrl, cancelUrl } = await request.json();
        if (!tier) throw new Error('tier required');
        if (!env.STRIPE_SECRET_KEY) throw new Error('STRIPE_SECRET_KEY not configured');

        // Lite is one-time mode=payment; subscriptions need billing.
        const isLite = tier === 'lite';
        if (!isLite && !billing) throw new Error('billing required for subscription tiers');

        // Map tier+billing to Stripe Price ID via env vars
        const priceMap = {
          'starter:monthly': env.STRIPE_PRICE_STARTER_MONTHLY,
          'starter:yearly':  env.STRIPE_PRICE_STARTER_YEARLY,
          'creator:monthly': env.STRIPE_PRICE_CREATOR_MONTHLY,
          'creator:yearly':  env.STRIPE_PRICE_CREATOR_YEARLY,
          'studio:monthly':  env.STRIPE_PRICE_STUDIO_MONTHLY,
          'studio:yearly':   env.STRIPE_PRICE_STUDIO_YEARLY,
        };

        // Lite uses its own one-time price; everything else uses recurring.
        const priceId = isLite
          ? env.STRIPE_PRICE_LITE_TRIAL
          : priceMap[`${tier}:${billing}`];
        if (!priceId) {
          throw new Error(isLite
            ? 'STRIPE_PRICE_LITE_TRIAL not configured — create a $3.99 one-time price in Stripe Dashboard and set the env var'
            : `No price ID configured for ${tier}/${billing} — check Worker env vars`);
        }

        // Identify the user from the Supabase JWT in Authorization header
        const authHeader = request.headers.get('Authorization');
        if (!authHeader) throw new Error('Authorization header required');
        const userResp = await fetch(`${env.SUPABASE_URL || 'https://wjhdsodlxekvhpahascs.supabase.co'}/auth/v1/user`, {
          headers: { 'Authorization': authHeader, 'apikey': env.SUPABASE_ANON_KEY || '' }
        });
        if (!userResp.ok) throw new Error('Could not resolve user from Supabase token');
        const user = await userResp.json();

        // Reuse a Stripe customer per Supabase user — stored in user_metadata.stripe_customer_id
        let stripeCustomerId = user.user_metadata?.stripe_customer_id;
        if (!stripeCustomerId) {
          const custResp = await fetch('https://api.stripe.com/v1/customers', {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${env.STRIPE_SECRET_KEY}`,
              'Content-Type': 'application/x-www-form-urlencoded'
            },
            body: new URLSearchParams({ email: user.email, 'metadata[supabase_user_id]': user.id })
          });
          const custData = await custResp.json();
          if (!custResp.ok) throw new Error('Stripe customer creation failed: ' + JSON.stringify(custData));
          stripeCustomerId = custData.id;
          // Persist customer ID back to Supabase via service role (bypasses RLS)
          await fetch(`${env.SUPABASE_URL || 'https://wjhdsodlxekvhpahascs.supabase.co'}/auth/v1/admin/users/${user.id}`, {
            method: 'PUT',
            headers: {
              'Authorization': `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
              'apikey': env.SUPABASE_SERVICE_ROLE_KEY,
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({ user_metadata: { ...user.user_metadata, stripe_customer_id: stripeCustomerId } })
          });
        }

        // ─── Existing subscription guard ──────────────────────────────
        // §2026-05-14: A user buying a NEW subscription while they
        // already have one creates dual-billing chaos. Also, naive
        // "switch tier" via a new Checkout Session bypasses Stripe's
        // proration + downgrade-at-period-end machinery, leading to
        // accidental immediate downgrades that overcharge or
        // undercharge users.
        //
        // Fix: detect an active subscription on this customer. If
        // present, redirect the caller to the Stripe Customer Portal,
        // which has native UI for "switch plan" with the correct
        // proration_behavior (upgrade → immediate prorate; downgrade
        // → end of current period). Configure that behavior in:
        // Stripe Dashboard → Settings → Customer Portal → Subscriptions.
        //
        // Lite is exempt: it's a one-time top-up (mode='payment'), so
        // it never conflicts with an existing subscription.
        if (!isLite) {
          try {
            const subsResp = await fetch(
              `https://api.stripe.com/v1/subscriptions?customer=${stripeCustomerId}&status=active&limit=10`,
              { headers: { 'Authorization': `Bearer ${env.STRIPE_SECRET_KEY}` } }
            );
            if (subsResp.ok) {
              const subsData = await subsResp.json();
              const activeSubs = subsData.data || [];
              if (activeSubs.length > 0) {
                // Open a Customer Portal session and hand the URL back
                const portalResp = await fetch('https://api.stripe.com/v1/billing_portal/sessions', {
                  method: 'POST',
                  headers: {
                    'Authorization': `Bearer ${env.STRIPE_SECRET_KEY}`,
                    'Content-Type': 'application/x-www-form-urlencoded',
                  },
                  body: new URLSearchParams({
                    customer: stripeCustomerId,
                    return_url: `${url.origin}/subscription`,
                  }),
                });
                const portalData = await portalResp.json();
                if (!portalResp.ok) {
                  // Portal session failed — fall through to checkout anyway
                  // rather than blocking the user. Worst case is two subs,
                  // which is still recoverable; refusing the sale is worse.
                  // §2026-05-15 loud-fail: escalate so portal config drift
                  // is visible (otherwise users silently get double-billed).
                  console.error('[checkout] portal session creation non-OK', 'status=' + portalResp.status, 'err=' + (portalData.error?.message || '(no message)'), '— FAIL-OPEN: falling through to new Checkout Session');
                } else {
                  console.log(`[checkout] user ${user.id} has ${activeSubs.length} active sub(s); routing to Customer Portal`);
                  return new Response(JSON.stringify({
                    success: false,
                    code: 'EXISTING_SUBSCRIPTION',
                    portalUrl: portalData.url,
                    activeSubscriptionCount: activeSubs.length,
                    message: 'You already have an active subscription. Switching plans goes through the Customer Portal — downgrades take effect at the end of your current billing period, upgrades prorate immediately.',
                  }), {
                    status: 200,
                    headers: { 'Content-Type': 'application/json', ...corsHeaders },
                  });
                }
              }
            } else {
              // §2026-05-15 loud-fail — escalate so Stripe key drift visible
              const errBody = await subsResp.text().catch(() => '(unreadable)');
              console.error('[checkout] subscriptions list non-OK', 'status=' + subsResp.status, 'customerId=' + stripeCustomerId, 'body=' + errBody.slice(0, 200), '— FAIL-OPEN: skipping existing-sub guard, may double-bill');
            }
          } catch (e) {
            // Defensive: don't block checkout on a detection failure
            console.error('[checkout] existing-sub detection exception:', e.message, 'customerId=' + stripeCustomerId, '— FAIL-OPEN: skipping guard');
          }
        }

        // Create the checkout session.
        // - Lite: mode='payment' (one-time charge, no subscription created).
        //   Ad-hoc pricing (tiered): unit_amount picked from past purchase
        //   count. Webhook handles checkout.session.completed → grants
        //   100 tokens + tier='lite'. User can re-purchase, price climbs.
        // - Starter/Creator/Studio: mode='subscription' (recurring monthly
        //   or yearly). Webhook handles invoice.payment_succeeded.
        const sessionParams = {
          mode: isLite ? 'payment' : 'subscription',
          customer: stripeCustomerId,
          'line_items[0][quantity]': '1',
          success_url: successUrl || `${url.origin}/subscription?checkout=success&session_id={CHECKOUT_SESSION_ID}`,
          cancel_url:  cancelUrl  || `${url.origin}/subscription?checkout=cancel`,
          'metadata[supabase_user_id]': user.id,
          'metadata[uvera_plan]': isLite ? 'lite' : tier,
        };

        if (isLite) {
          // §2026-05-14 Tiered Lite pricing with time-decay cooldown —
          // ad-hoc price_data on the existing Lite product. Elevation
          // grows with each purchase, decays with idle time (see
          // computeLiteElevation). Webhook still credits 100 tokens
          // regardless of price tier (metadata.uvera_plan='lite').
          const elevation = await computeLiteElevation(env, user.id);
          const litePriceCents = getLitePriceCentsForElevation(elevation);
          const liteProductId = await getLiteProductId(env);
          const tierIndex = elevation + 1;  // 1-indexed for human display
          sessionParams['line_items[0][price_data][currency]'] = 'usd';
          sessionParams['line_items[0][price_data][product]'] = liteProductId;
          sessionParams['line_items[0][price_data][unit_amount]'] = String(litePriceCents);
          sessionParams['metadata[uvera_lite_tier]'] = String(tierIndex);
          console.log(`[checkout] Lite tier ${tierIndex} (elev ${elevation}) → $${(litePriceCents/100).toFixed(2)} for user ${user.id}`);
        } else {
          sessionParams['line_items[0][price]'] = priceId;
        }

        const sessionResp = await fetch('https://api.stripe.com/v1/checkout/sessions', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${env.STRIPE_SECRET_KEY}`,
            'Content-Type': 'application/x-www-form-urlencoded'
          },
          body: new URLSearchParams(sessionParams)
        });
        const sessionData = await sessionResp.json();
        if (!sessionResp.ok) throw new Error('Stripe session creation failed: ' + JSON.stringify(sessionData));

        return new Response(JSON.stringify({ success: true, url: sessionData.url }), {
          status: 200,
          headers: { 'Content-Type': 'application/json', ...corsHeaders },
        });
      } catch (err) {
        return new Response(JSON.stringify({ success: false, errMessage: err.message }), {
          status: 500,
          headers: { 'Content-Type': 'application/json', ...corsHeaders },
        });
      }
    }

    // ─── Stripe: customer portal session ────────────────────────────────
    // POST /api/stripe/customer-portal  →  { url }
    // For "Manage subscription" button. Stripe-hosted page lets users update
    // payment methods, cancel, view invoices.
    if (url.pathname === '/api/stripe/customer-portal' && request.method === 'POST') {
      const corsHeaders = { 'Access-Control-Allow-Origin': '*' };
      try {
        if (!env.STRIPE_SECRET_KEY) throw new Error('STRIPE_SECRET_KEY not configured');
        const authHeader = request.headers.get('Authorization');
        if (!authHeader) throw new Error('Authorization header required');

        const userResp = await fetch(`${env.SUPABASE_URL || 'https://wjhdsodlxekvhpahascs.supabase.co'}/auth/v1/user`, {
          headers: { 'Authorization': authHeader, 'apikey': env.SUPABASE_ANON_KEY || '' }
        });
        const user = await userResp.json();
        const stripeCustomerId = user.user_metadata?.stripe_customer_id;
        if (!stripeCustomerId) throw new Error('No Stripe customer for this user — complete a checkout first');

        const portalResp = await fetch('https://api.stripe.com/v1/billing_portal/sessions', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${env.STRIPE_SECRET_KEY}`,
            'Content-Type': 'application/x-www-form-urlencoded'
          },
          body: new URLSearchParams({
            customer: stripeCustomerId,
            return_url: `${url.origin}/subscription`,
          })
        });
        const portalData = await portalResp.json();
        if (!portalResp.ok) throw new Error('Stripe portal session failed: ' + JSON.stringify(portalData));

        return new Response(JSON.stringify({ success: true, url: portalData.url }), {
          status: 200,
          headers: { 'Content-Type': 'application/json', ...corsHeaders },
        });
      } catch (err) {
        return new Response(JSON.stringify({ success: false, errMessage: err.message }), {
          status: 500,
          headers: { 'Content-Type': 'application/json', ...corsHeaders },
        });
      }
    }

    /* ════════════════════════════════════════════════════════════════════
     * §2026-05-25 fei — 短剧付费 Phase 1 endpoints
     *
     * Five new endpoints landing the U-Coins + Series bundle flow:
     *
     *   GET  /api/wallet/balance                — current user's U-Coins + recent tx
     *   POST /api/wallet/checkout               — Stripe Session for U-Coins pack
     *   POST /api/series/:id/checkout-bundle    — Stripe Session for whole-series buy
     *   POST /api/episodes/:id/unlock           — atomic U-Coins deduct + unlock
     *   GET  /api/episodes/:id/access           — can-watch check (free/unlocked/member/bundle)
     *
     * The Stripe webhook below (/api/stripe/webhook) is extended to detect
     * metadata.product_type = 'ucoins' or 'bundle' and dispatch to U-Coins
     * grant / Series unlock instead of the legacy tier-upgrade path.
     *
     * Auth: every endpoint requires a valid Supabase user JWT via the
     *   Authorization header. We resolve user via /auth/v1/user (cached at
     *   colo via Supabase) and use SERVICE_ROLE for the actual table writes
     *   (RLS blocks user-direct writes to wallet_balance / wallet_tx /
     *   episode_unlocks by design — frontend can't bypass deduction logic).
     * ════════════════════════════════════════════════════════════════════ */

    // Helper: resolve the calling user from the Authorization header.
    //   Returns the RAW Supabase user JSON ({ id, email, user_metadata, ... })
    //   or throws on failure. The wallet/stripe endpoints below depend on the
    //   raw `user.user_metadata` shape, which differs from the module-level
    //   requireUser() (returns { id, email, tier, meta }).
    //   §2026-05-30 fei — RENAMED from `requireUser` to `requireUserLocal`.
    //   The old name shadowed the hoisted module-level requireUser across the
    //   ENTIRE fetch-handler block, putting every earlier call site (video
    //   submit / character board / script — the Quick Mode render path) into a
    //   temporal dead zone → "Cannot access 'requireUser' before initialization".
    const requireUserLocal = async () => {
      const authHeader = request.headers.get('Authorization');
      if (!authHeader) throw new Error('Authorization header required');
      const supabaseUrl = env.SUPABASE_URL || 'https://wjhdsodlxekvhpahascs.supabase.co';
      const userResp = await fetch(`${supabaseUrl}/auth/v1/user`, {
        headers: { 'Authorization': authHeader, 'apikey': env.SUPABASE_ANON_KEY || '' }
      });
      if (!userResp.ok) {
        const t = await userResp.text().catch(() => '');
        throw new Error(`Could not resolve user (${userResp.status}): ${t.slice(0, 200)}`);
      }
      return await userResp.json();
    };

    /* §2026-05-26 fei — anonymous-friendly variant of requireUser.
     *   Returns the user object when a valid JWT is present, OR null when
     *   the request is anonymous / token is invalid / expired. Never throws.
     *
     *   Why: /api/episodes/:id/access needs to serve TWO audiences:
     *     1. logged-in users (full unlock / bundle / member resolution)
     *     2. anonymous visitors (so they can preview free episodes from
     *        Discover without an account, then get prompted to sign in
     *        only when they hit a paid episode)
     *   Previously requireUser threw on missing/invalid JWT, killing the
     *   anon-preview funnel entirely (audit #4). This helper lets the same
     *   endpoint branch based on user presence instead of always failing
     *   closed. */
    const requireUserOptional = async () => {
      const authHeader = request.headers.get('Authorization');
      if (!authHeader) return null;
      const supabaseUrl = env.SUPABASE_URL || 'https://wjhdsodlxekvhpahascs.supabase.co';
      try {
        const userResp = await fetch(`${supabaseUrl}/auth/v1/user`, {
          headers: { 'Authorization': authHeader, 'apikey': env.SUPABASE_ANON_KEY || '' }
        });
        if (!userResp.ok) return null;
        return await userResp.json();
      } catch {
        return null;
      }
    };

    // Helper: build a fetch wrapper for Supabase REST with service role
    //   so we can bypass RLS for ledger writes.
    const supabaseAdmin = (path, init = {}) => {
      const supabaseUrl = env.SUPABASE_URL || 'https://wjhdsodlxekvhpahascs.supabase.co';
      return fetch(`${supabaseUrl}/rest/v1${path}`, {
        ...init,
        headers: {
          'Authorization': `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
          'apikey': env.SUPABASE_SERVICE_ROLE_KEY,
          'Content-Type': 'application/json',
          ...(init.headers || {}),
        },
      });
    };

    /* §2026-05-25 fei Phase 2 — member tier check, configurable.
     *
     * Reads system_settings.drama_member_tiers (JSON array, e.g.
     * ["starter","creator","studio"]) and drama_lite_counts_as_member
     * to decide if a given user.tier qualifies as "drama member" for
     * the member_free fast path. Cached per-request via a tiny memo
     * so /unlock + /access don't re-read system_settings twice.
     *
     * Falls open to "starter+" if the setting is missing (e.g. migration
     * hasn't been run yet) so the existing inline behavior is preserved. */
    let __memberTiersCached = null;
    const isDramaMemberTier = async (tier) => {
      if (!tier || tier === 'free') return false;
      if (!__memberTiersCached) {
        try {
          const raw = await getSystemSetting(env, 'drama_member_tiers', '["starter","creator","studio"]');
          const liteRaw = await getSystemSetting(env, 'drama_lite_counts_as_member', 'false');
          __memberTiersCached = {
            tiers: JSON.parse(raw),
            liteCounts: liteRaw === 'true' || liteRaw === true,
          };
        } catch (e) {
          console.warn('[member-tier] system_settings parse fail, default to starter+:', e.message);
          __memberTiersCached = { tiers: ['starter', 'creator', 'studio'], liteCounts: false };
        }
      }
      const { tiers, liteCounts } = __memberTiersCached;
      if (tier === 'lite') return liteCounts;
      return tiers.includes(tier);
    };

    /* ── GET /api/wallet/balance ────────────────────────────────────────
     * Response: { success, ucoins, lifetime_purchased, lifetime_spent,
     *             recent_tx: [{ amount, balance_after, tx_type,
     *                           description, created_at }] }
     * Returns 0 / [] for users who never had a wallet row yet — the row is
     * lazily created on first credit (Stripe webhook) so a fresh user
     * shouldn't see an error.
     */
    if (url.pathname === '/api/wallet/balance' && request.method === 'GET') {
      const corsHeaders = { 'Access-Control-Allow-Origin': '*' };
      try {
        const user = await requireUserLocal();
        // §2026-06-09 货币合并:Ucoin 已并入 Token,余额改读 user_credits(wallet_balance
        //   已清零)。响应 key 沿用(ucoins/lifetime_*),值现为 Token,前端不破;
        //   前端改名 Ucoin→Tokens 后即一致。
        const balResp = await supabaseAdmin(`/user_credits?user_id=eq.${user.id}&select=balance,lifetime_granted,lifetime_spent`);
        const balRows = balResp.ok ? await balResp.json() : [];
        const bal = balRows[0] || { balance: 0, lifetime_granted: 0, lifetime_spent: 0 };

        const txResp = await supabaseAdmin(`/credit_tx?user_id=eq.${user.id}&select=amount,balance_after,tx_type,description,created_at&order=created_at.desc&limit=20`);
        const txRows = txResp.ok ? await txResp.json() : [];

        return new Response(JSON.stringify({
          success: true,
          ucoins: bal.balance,
          lifetime_purchased: bal.lifetime_granted,
          lifetime_spent: bal.lifetime_spent,
          recent_tx: txRows,
        }), { headers: { 'Content-Type': 'application/json', ...corsHeaders } });
      } catch (err) {
        return new Response(JSON.stringify({ success: false, errMessage: err.message }), {
          status: 500, headers: { 'Content-Type': 'application/json', ...corsHeaders },
        });
      }
    }

    /* ── POST /api/wallet/checkout ─────────────────────────────────────
     * Body: { package_id: 'pkg_499' | 'pkg_999' | ... | 'pkg_099_first' }
     * Response: { success, session_url, order_id }
     *
     * Looks up the package in system_settings.ucoins_packages, creates a
     * Stripe Checkout Session in payment-mode (one-time, not subscription),
     * inserts a pending ucoins_orders row, and returns the session URL for
     * the frontend to redirect to.
     *
     * First-charge gate: pkg_099_first is rejected if the user already has
     * any ucoins_orders.status='succeeded' for that package_id. Prevents
     * the obvious "buy first-charge twice" exploit.
     */
    if (url.pathname === '/api/wallet/checkout' && request.method === 'POST') {
      const corsHeaders = { 'Access-Control-Allow-Origin': '*' };
      try {
        if (!env.STRIPE_SECRET_KEY) throw new Error('STRIPE_SECRET_KEY not configured');
        const user = await requireUserLocal();
        const { package_id } = await request.json();
        if (!package_id) throw new Error('package_id is required');

        // Fetch packages from system_settings (admin can hot-edit prices)
        const pkgs = JSON.parse(await getSystemSetting(env, 'ucoins_packages', '[]'));
        const pkg = pkgs.find(p => p.id === package_id);
        if (!pkg) throw new Error(`Unknown package_id: ${package_id}`);

        // First-charge eligibility check
        if (pkg.first_charge) {
          const prevResp = await supabaseAdmin(
            `/ucoins_orders?user_id=eq.${user.id}&package_id=eq.${package_id}&status=eq.succeeded&select=id&limit=1`
          );
          const prevRows = prevResp.ok ? await prevResp.json() : [];
          if (prevRows.length > 0) {
            throw new Error('首充优惠仅限首次购买,无法重复使用。请选择其他档位。');
          }
        }

        // Insert pending order row FIRST so webhook can join on metadata.order_id
        const insertResp = await supabaseAdmin('/ucoins_orders', {
          method: 'POST',
          headers: { 'Prefer': 'return=representation' },
          body: JSON.stringify([{
            user_id: user.id,
            package_id: pkg.id,
            amount_usd_cents: pkg.price_cents,
            ucoins_to_credit: pkg.ucoins,
            ucoins_bonus: pkg.bonus || 0,
            is_first_charge: !!pkg.first_charge,
            status: 'pending',
          }]),
        });
        if (!insertResp.ok) {
          const e = await insertResp.text();
          throw new Error(`Order row insert failed: ${e.slice(0, 200)}`);
        }
        const [orderRow] = await insertResp.json();

        // Create Stripe Checkout Session (payment mode, not subscription)
        const origin = url.origin;
        const sessionParams = new URLSearchParams();
        sessionParams.append('mode', 'payment');
        /* §2026-05-25 fei — point Stripe back to /subscription's U-Coins
         * tab (the canonical topup surface). /wallet now redirects there
         * anyway, but using the direct URL skips one redirect hop +
         * preserves the ?checkout query param cleanly. */
        sessionParams.append('success_url', `${origin}/subscription?tab=ucoins&checkout=success&order=${orderRow.id}`);
        sessionParams.append('cancel_url',  `${origin}/subscription?tab=ucoins&checkout=cancelled`);
        sessionParams.append('customer_email', user.email || '');
        sessionParams.append('line_items[0][price_data][currency]', 'usd');
        sessionParams.append('line_items[0][price_data][unit_amount]', String(pkg.price_cents));
        sessionParams.append('line_items[0][price_data][product_data][name]', pkg.label || `${pkg.ucoins} Tokens`);
        sessionParams.append('line_items[0][price_data][product_data][description]',
          pkg.bonus > 0 ? `${pkg.ucoins - pkg.bonus} + ${pkg.bonus} bonus = ${pkg.ucoins} Tokens` : `${pkg.ucoins} Tokens`);
        sessionParams.append('line_items[0][quantity]', '1');
        // Metadata used by webhook to dispatch correctly
        sessionParams.append('metadata[product_type]', 'ucoins');
        sessionParams.append('metadata[order_id]', orderRow.id);
        sessionParams.append('metadata[user_id]', user.id);
        sessionParams.append('metadata[package_id]', pkg.id);
        sessionParams.append('metadata[ucoins_to_credit]', String(pkg.ucoins));

        const stripeResp = await fetch('https://api.stripe.com/v1/checkout/sessions', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${env.STRIPE_SECRET_KEY}`,
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          body: sessionParams.toString(),
        });
        if (!stripeResp.ok) {
          const errText = await stripeResp.text();
          throw new Error(`Stripe Checkout Session create failed: ${errText.slice(0, 300)}`);
        }
        const session = await stripeResp.json();

        // PATCH the order row with the Stripe session id for later webhook join
        await supabaseAdmin(`/ucoins_orders?id=eq.${orderRow.id}`, {
          method: 'PATCH',
          body: JSON.stringify({ stripe_session_id: session.id }),
        });

        return new Response(JSON.stringify({
          success: true,
          session_url: session.url,
          order_id: orderRow.id,
        }), { headers: { 'Content-Type': 'application/json', ...corsHeaders } });
      } catch (err) {
        console.error('[wallet/checkout]', err.message);
        return new Response(JSON.stringify({ success: false, errMessage: err.message }), {
          status: 500, headers: { 'Content-Type': 'application/json', ...corsHeaders },
        });
      }
    }

    /* ── POST /api/series/:id/checkout-bundle ───────────────────────────
     * Body: {} (series id in URL)
     * Response: { success, session_url, order_id }
     *
     * Creates a Stripe Checkout Session for the full-series buyout price.
     * Series must be lifecycle_status='live' and have bundle_price_usd_cents
     * set (NULL means owner didn't offer bundle pricing). Idempotent: if user
     * already has a succeeded bundle purchase for this series, returns 409.
     */
    const bundleMatch = url.pathname.match(/^\/api\/series\/([0-9a-f-]{36})\/checkout-bundle$/i);
    if (bundleMatch && request.method === 'POST') {
      const corsHeaders = { 'Access-Control-Allow-Origin': '*' };
      const seriesId = bundleMatch[1];
      try {
        if (!env.STRIPE_SECRET_KEY) throw new Error('STRIPE_SECRET_KEY not configured');
        const user = await requireUserLocal();

        // Fetch series for price + status
        const sResp = await supabaseAdmin(
          `/series?id=eq.${seriesId}&select=id,title,bundle_price_usd_cents,lifecycle_status,user_id`
        );
        const sRows = sResp.ok ? await sResp.json() : [];
        if (sRows.length === 0) throw new Error('Series not found');
        const series = sRows[0];
        if (series.lifecycle_status !== 'live') {
          throw new Error('该剧未上架,无法购买。');
        }
        if (!series.bundle_price_usd_cents) {
          throw new Error('该剧未开通整剧买断。请逐集解锁。');
        }

        // Already bought?
        const ownedResp = await supabaseAdmin(
          `/series_purchases?user_id=eq.${user.id}&series_id=eq.${seriesId}&status=eq.succeeded&select=id&limit=1`
        );
        const ownedRows = ownedResp.ok ? await ownedResp.json() : [];
        if (ownedRows.length > 0) {
          return new Response(JSON.stringify({
            success: false, errMessage: '你已经买断这部剧了。', already_owned: true,
          }), { status: 409, headers: { 'Content-Type': 'application/json', ...corsHeaders } });
        }

        // Pending row
        const insertResp = await supabaseAdmin('/series_purchases', {
          method: 'POST',
          headers: { 'Prefer': 'return=representation' },
          body: JSON.stringify([{
            user_id: user.id,
            series_id: seriesId,
            amount_usd_cents: series.bundle_price_usd_cents,
            status: 'pending',
          }]),
        });
        if (!insertResp.ok) {
          const e = await insertResp.text();
          throw new Error(`Order row insert failed: ${e.slice(0, 200)}`);
        }
        const [orderRow] = await insertResp.json();

        const origin = url.origin;
        const sessionParams = new URLSearchParams();
        sessionParams.append('mode', 'payment');
        sessionParams.append('success_url', `${origin}/series/${seriesId}?checkout=success`);
        sessionParams.append('cancel_url', `${origin}/series/${seriesId}?checkout=cancelled`);
        sessionParams.append('customer_email', user.email || '');
        sessionParams.append('line_items[0][price_data][currency]', 'usd');
        sessionParams.append('line_items[0][price_data][unit_amount]', String(series.bundle_price_usd_cents));
        sessionParams.append('line_items[0][price_data][product_data][name]', `${series.title} — 整剧买断`);
        sessionParams.append('line_items[0][price_data][product_data][description]', 'Unlock all episodes of this series, forever.');
        sessionParams.append('line_items[0][quantity]', '1');
        sessionParams.append('metadata[product_type]', 'bundle');
        sessionParams.append('metadata[order_id]', orderRow.id);
        sessionParams.append('metadata[user_id]', user.id);
        sessionParams.append('metadata[series_id]', seriesId);

        const stripeResp = await fetch('https://api.stripe.com/v1/checkout/sessions', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${env.STRIPE_SECRET_KEY}`,
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          body: sessionParams.toString(),
        });
        if (!stripeResp.ok) {
          const errText = await stripeResp.text();
          throw new Error(`Stripe Checkout Session create failed: ${errText.slice(0, 300)}`);
        }
        const session = await stripeResp.json();

        await supabaseAdmin(`/series_purchases?id=eq.${orderRow.id}`, {
          method: 'PATCH',
          body: JSON.stringify({ stripe_session_id: session.id }),
        });

        return new Response(JSON.stringify({
          success: true,
          session_url: session.url,
          order_id: orderRow.id,
        }), { headers: { 'Content-Type': 'application/json', ...corsHeaders } });
      } catch (err) {
        console.error('[series/checkout-bundle]', err.message);
        return new Response(JSON.stringify({ success: false, errMessage: err.message }), {
          status: 500, headers: { 'Content-Type': 'application/json', ...corsHeaders },
        });
      }
    }

    /* ── POST /api/episodes/:id/unlock ──────────────────────────────────
     * Body: {}
     * Response: { success, unlock_id, balance_after } | { success: false, errMessage }
     *
     * Atomic flow:
     *   1) load episode + parent series → determine effective price
     *   2) check existing unlock (same user + episode) — return idempotently
     *   3) check member_free / bundle owned → free-grant path (insert unlock
     *      with unlock_type='member' or 'bundle', no U-Coins deducted)
     *   4) check U-Coins balance >= price
     *   5) decrement balance, insert wallet_tx (negative), insert unlock
     *
     * RLS blocks frontend from writing wallet_balance directly, so the only
     * way to unlock is through this endpoint — credit deduction can't be
     * bypassed by crafted Supabase calls from the browser.
     */
    const unlockMatch = url.pathname.match(/^\/api\/episodes\/([0-9a-f-]{36})\/unlock$/i);
    if (unlockMatch && request.method === 'POST') {
      const corsHeaders = { 'Access-Control-Allow-Origin': '*' };
      const episodeId = unlockMatch[1];
      try {
        const user = await requireUserLocal();

        // Load episode + parent series
        const epResp = await supabaseAdmin(
          `/episodes?id=eq.${episodeId}&select=id,series_id,episode_no,is_free_override,ucoins_price_override,series:series_id(id,title,free_episodes_count,ucoins_per_episode,member_free,lifecycle_status)`
        );
        const epRows = epResp.ok ? await epResp.json() : [];
        if (epRows.length === 0) throw new Error('Episode not found');
        const ep = epRows[0];
        const series = ep.series;
        if (!series || series.lifecycle_status !== 'live') {
          throw new Error('该剧未上架,无法解锁。');
        }

        // Effective price + free-ness
        const isFreeByPosition = ep.episode_no <= series.free_episodes_count;
        const isFree = ep.is_free_override === true || (ep.is_free_override !== false && isFreeByPosition);
        const price = ep.ucoins_price_override ?? series.ucoins_per_episode;

        if (isFree) {
          // Free episodes don't need unlock rows — caller should never hit this
          //   for a free episode, but be friendly.
          return new Response(JSON.stringify({
            success: true, already_free: true, unlock_id: null, balance_after: null,
          }), { headers: { 'Content-Type': 'application/json', ...corsHeaders } });
        }

        // Already unlocked?
        const existingResp = await supabaseAdmin(
          `/episode_unlocks?user_id=eq.${user.id}&episode_id=eq.${episodeId}&select=id&limit=1`
        );
        const existingRows = existingResp.ok ? await existingResp.json() : [];
        if (existingRows.length > 0) {
          return new Response(JSON.stringify({
            success: true, already_unlocked: true, unlock_id: existingRows[0].id,
          }), { headers: { 'Content-Type': 'application/json', ...corsHeaders } });
        }

        // Bundle ownership = free unlock
        const bundleResp = await supabaseAdmin(
          `/series_purchases?user_id=eq.${user.id}&series_id=eq.${series.id}&status=eq.succeeded&select=id&limit=1`
        );
        const bundleRows = bundleResp.ok ? await bundleResp.json() : [];
        if (bundleRows.length > 0) {
          const unlockResp = await supabaseAdmin('/episode_unlocks', {
            method: 'POST',
            headers: { 'Prefer': 'return=representation' },
            body: JSON.stringify([{
              user_id: user.id, episode_id: episodeId, series_id: series.id,
              unlock_type: 'bundle', ucoins_paid: 0,
            }]),
          });
          const [unlock] = unlockResp.ok ? await unlockResp.json() : [{}];
          return new Response(JSON.stringify({
            success: true, unlock_id: unlock.id, via_bundle: true,
          }), { headers: { 'Content-Type': 'application/json', ...corsHeaders } });
        }

        // §Member-free path: check user_metadata.tier against the
        //   configured drama_member_tiers list (default starter+).
        //   When series.member_free=false, members still need to pay
        //   U-Coins (per PDF §5.2 "会员是否免费" config note).
        if (series.member_free) {
          const tier = (user.user_metadata && user.user_metadata.tier) || 'free';
          if (await isDramaMemberTier(tier)) {
            const unlockResp = await supabaseAdmin('/episode_unlocks', {
              method: 'POST',
              headers: { 'Prefer': 'return=representation' },
              body: JSON.stringify([{
                user_id: user.id, episode_id: episodeId, series_id: series.id,
                unlock_type: 'member', ucoins_paid: 0,
              }]),
            });
            const [unlock] = unlockResp.ok ? await unlockResp.json() : [{}];
            return new Response(JSON.stringify({
              success: true, unlock_id: unlock.id, via_member: true, member_tier: tier,
            }), { headers: { 'Content-Type': 'application/json', ...corsHeaders } });
          }
        }

        /* §2026-05-26 fei (audit #5) — Pay-with-U-Coins path now goes through
         *   SECURITY DEFINER RPC wallet_unlock_episode (migration
         *   20260526000002_wallet_atomic_rpc.sql).
         *
         *   The RPC wraps balance lock + check + deduct + tx insert + unlock
         *   insert in a single transaction with SELECT FOR UPDATE on
         *   wallet_balance. This eliminates three concrete bugs that the
         *   old read-modify-write sequence had:
         *     (A) Two concurrent unlocks for different episodes both reading
         *         balance=100, both PATCHing balance=60 — user charged once,
         *         got two unlocks.
         *     (B) Concurrent unlock + Stripe topup webhook: topup adds 200
         *         (balance 100→300), unlock PATCHes balance=60 (overwrite),
         *         topup vanishes.
         *     (C) Race-refund at the end of the old code path overwrote
         *         balance with a stale snapshot, potentially deleting
         *         concurrent unrelated updates.
         *
         *   RPC return shape:
         *     { success: true, unlock_id, balance_after, spent_ucoins, ... }
         *     | { success: true, already_unlocked: true, unlock_id, ... }
         *     | { success: false, insufficient: true, required, current }
         *     | { success: false, errMessage }
         */
        const rpcResp = await supabaseAdmin('/rpc/wallet_unlock_episode', {
          method: 'POST',
          headers: { 'Prefer': 'return=representation' },
          body: JSON.stringify({
            p_user_id: user.id,
            p_episode_id: episodeId,
            p_series_id: series.id,
            p_price: price,
            p_description: `解锁 ${series.title || 'Series'} 第 ${ep.episode_no} 集`,
          }),
        });
        if (!rpcResp.ok) {
          const eTxt = await rpcResp.text();
          throw new Error(`wallet_unlock_episode RPC HTTP ${rpcResp.status}: ${eTxt.slice(0, 200)}`);
        }
        const rpcResult = await rpcResp.json();

        if (rpcResult.insufficient) {
          return new Response(JSON.stringify({
            success: false,
            errMessage: `余额不足,需要 ${rpcResult.required} Tokens,当前 ${rpcResult.current}。请充值。`,
            insufficient: true,
            required: rpcResult.required,
            current: rpcResult.current,
          }), { status: 402, headers: { 'Content-Type': 'application/json', ...corsHeaders } });
        }
        if (!rpcResult.success) {
          throw new Error(rpcResult.errMessage || 'Unlock RPC returned non-success');
        }

        return new Response(JSON.stringify({
          success: true,
          unlock_id: rpcResult.unlock_id,
          balance_after: rpcResult.balance_after,
          ucoins_paid: rpcResult.spent_ucoins ?? price,
          already_unlocked: !!rpcResult.already_unlocked,
          race_caught: !!rpcResult.race_caught,
        }), { headers: { 'Content-Type': 'application/json', ...corsHeaders } });
      } catch (err) {
        console.error('[episodes/unlock]', err.message);
        return new Response(JSON.stringify({ success: false, errMessage: err.message }), {
          status: 500, headers: { 'Content-Type': 'application/json', ...corsHeaders },
        });
      }
    }

    /* ── GET /api/episodes/:id/access ────────────────────────────────────
     * Response: { success, can_watch, reason, episode: { id, episode_no,
     *             title, video_url, stream_uid }, locked: { price, balance } }
     *
     * Source of truth for the player to decide whether to start playback
     * or render the paywall. `reason` is one of:
     *   'free' | 'unlocked' | 'bundle' | 'member' | 'locked'
     *
     * For 'locked' the response includes the price + user balance so the
     * paywall can render without an extra round-trip.
     */
    const accessMatch = url.pathname.match(/^\/api\/episodes\/([0-9a-f-]{36})\/access$/i);
    if (accessMatch && request.method === 'GET') {
      const corsHeaders = { 'Access-Control-Allow-Origin': '*' };
      const episodeId = accessMatch[1];
      try {
        /* §2026-05-26 fei — anonymous-friendly. user may be null for
         *   logged-out visitors browsing /series/:id from Discover. Free
         *   episodes serve unconditionally; paid episodes return a
         *   need_login reason so the frontend renders a sign-in CTA
         *   instead of a paywall the user can't satisfy yet. */
        const user = await requireUserOptional();
        const epResp = await supabaseAdmin(
          `/episodes?id=eq.${episodeId}&select=id,series_id,episode_no,title,video_url,stream_uid,thumbnail_url,duration_sec,is_free_override,ucoins_price_override,series:series_id(id,title,free_episodes_count,ucoins_per_episode,member_free,lifecycle_status)`
        );
        const epRows = epResp.ok ? await epResp.json() : [];
        if (epRows.length === 0) throw new Error('Episode not found');
        const ep = epRows[0];
        const series = ep.series;
        if (!series || series.lifecycle_status !== 'live') {
          throw new Error('该剧未上架');
        }

        const isFreeByPosition = ep.episode_no <= series.free_episodes_count;
        const isFree = ep.is_free_override === true || (ep.is_free_override !== false && isFreeByPosition);
        const price = ep.ucoins_price_override ?? series.ucoins_per_episode;

        const episodePayload = {
          id: ep.id,
          episode_no: ep.episode_no,
          title: ep.title,
          duration_sec: ep.duration_sec,
          thumbnail_url: ep.thumbnail_url,
        };

        // Free → always watchable (anon + logged-in)
        if (isFree) {
          return new Response(JSON.stringify({
            success: true, can_watch: true, reason: 'free',
            episode: { ...episodePayload, video_url: ep.video_url, stream_uid: ep.stream_uid },
          }), { headers: { 'Content-Type': 'application/json', ...corsHeaders } });
        }

        /* §2026-05-26 fei — anon visitor hitting a PAID episode. Short-circuit
         *   with need_login so the frontend can render "Sign in to unlock for
         *   N U-Coins" CTA instead of opening PaywallModal (user can't pay
         *   without a wallet). All subsequent unlock / bundle / member checks
         *   below require a real user. */
        if (!user) {
          return new Response(JSON.stringify({
            success: true, can_watch: false, reason: 'need_login',
            episode: episodePayload,
            locked: { price, balance: 0, bundle_price_usd_cents: series.bundle_price_usd_cents ?? null },
          }), { headers: { 'Content-Type': 'application/json', ...corsHeaders } });
        }

        // Unlocked previously
        const unlockResp = await supabaseAdmin(
          `/episode_unlocks?user_id=eq.${user.id}&episode_id=eq.${episodeId}&select=id,unlock_type&limit=1`
        );
        const unlockRows = unlockResp.ok ? await unlockResp.json() : [];
        if (unlockRows.length > 0) {
          return new Response(JSON.stringify({
            success: true, can_watch: true, reason: unlockRows[0].unlock_type,
            episode: { ...episodePayload, video_url: ep.video_url, stream_uid: ep.stream_uid },
          }), { headers: { 'Content-Type': 'application/json', ...corsHeaders } });
        }

        // Bundle owned (without explicit unlock row yet — could be lazy-created)
        const bundleResp = await supabaseAdmin(
          `/series_purchases?user_id=eq.${user.id}&series_id=eq.${series.id}&status=eq.succeeded&select=id&limit=1`
        );
        if (bundleResp.ok && (await bundleResp.json()).length > 0) {
          return new Response(JSON.stringify({
            success: true, can_watch: true, reason: 'bundle',
            episode: { ...episodePayload, video_url: ep.video_url, stream_uid: ep.stream_uid },
          }), { headers: { 'Content-Type': 'application/json', ...corsHeaders } });
        }

        // §2026-05-25 fei Phase 2 — configurable member tier check
        if (series.member_free) {
          const tier = (user.user_metadata && user.user_metadata.tier) || 'free';
          if (await isDramaMemberTier(tier)) {
            return new Response(JSON.stringify({
              success: true, can_watch: true, reason: 'member', member_tier: tier,
              episode: { ...episodePayload, video_url: ep.video_url, stream_uid: ep.stream_uid },
            }), { headers: { 'Content-Type': 'application/json', ...corsHeaders } });
          }
        }

        // Locked → return paywall payload, no video URL
        const balResp = await supabaseAdmin(`/wallet_balance?user_id=eq.${user.id}&select=ucoins_balance`);
        const balRows = balResp.ok ? await balResp.json() : [];
        const balance = balRows[0]?.ucoins_balance || 0;

        return new Response(JSON.stringify({
          success: true, can_watch: false, reason: 'locked',
          episode: episodePayload,
          locked: { price, balance, bundle_price_usd_cents: null /* TODO: read series.bundle_price_usd_cents */ },
        }), { headers: { 'Content-Type': 'application/json', ...corsHeaders } });
      } catch (err) {
        console.error('[episodes/access]', err.message);
        return new Response(JSON.stringify({ success: false, errMessage: err.message }), {
          status: 500, headers: { 'Content-Type': 'application/json', ...corsHeaders },
        });
      }
    }

    // ─── Stripe: webhook ────────────────────────────────────────────────
    // POST /api/stripe/webhook
    // Handles checkout.session.completed (initial subscription) and
    // customer.subscription.updated (renewals, plan changes, cancellations).
    // §2026-05-25 fei: also handles checkout.session.completed for
    //   metadata.product_type IN ('ucoins','bundle') — credits U-Coins or
    //   creates series_purchases row before the legacy tier-upgrade path.
    // Signature verification per Stripe webhook security guide.
    if (url.pathname === '/api/stripe/webhook' && request.method === 'POST') {
      try {
        const signature = request.headers.get('stripe-signature');
        const body = await request.text();
        if (!env.STRIPE_WEBHOOK_SECRET) throw new Error('STRIPE_WEBHOOK_SECRET not configured');
        if (!signature) throw new Error('Missing stripe-signature header');

        // Verify signature: parse `t=...,v1=...` header, recompute HMAC-SHA256 of `t.body`
        const parts = Object.fromEntries(signature.split(',').map(p => p.split('=')));
        const timestamp = parts.t;
        const expectedSig = parts.v1;
        const signedPayload = `${timestamp}.${body}`;
        const key = await crypto.subtle.importKey(
          'raw',
          new TextEncoder().encode(env.STRIPE_WEBHOOK_SECRET),
          { name: 'HMAC', hash: 'SHA-256' },
          false,
          ['sign']
        );
        const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(signedPayload));
        const computedSig = Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, '0')).join('');
        if (computedSig !== expectedSig) {
          return new Response('Invalid signature', { status: 400 });
        }

        const event = JSON.parse(body);

        // Map Stripe Price ID → tier + monthly credit allocation.
        // monthly_credits is added to user.credits on every successful invoice
        // (initial payment AND renewals), per Leon's pricing table 2026-05-05.
        // Daily login bonus (universal +6/day) is separate — see /api/credits/claim-daily.
        const priceMap = {
          [env.STRIPE_PRICE_LITE_TRIAL]:      { tier: 'lite',    monthly_credits: 100  },
          [env.STRIPE_PRICE_STARTER_MONTHLY]: { tier: 'starter', monthly_credits: 500  },
          [env.STRIPE_PRICE_STARTER_YEARLY]:  { tier: 'starter', monthly_credits: 500  },
          [env.STRIPE_PRICE_CREATOR_MONTHLY]: { tier: 'creator', monthly_credits: 1500 },
          [env.STRIPE_PRICE_CREATOR_YEARLY]:  { tier: 'creator', monthly_credits: 1500 },
          [env.STRIPE_PRICE_STUDIO_MONTHLY]:  { tier: 'studio',  monthly_credits: 5000 },
          [env.STRIPE_PRICE_STUDIO_YEARLY]:   { tier: 'studio',  monthly_credits: 5000 },
        };

        // Amount fallback (USD cents) → tier. Used when priceId is unknown
        // (config drift between Stripe Dashboard and Cloudflare env vars).
        // Prices frozen 2026-05-08 — see project_stripe_mvp.md.
        // This makes price-ID misconfig self-healing: user still gets tokens,
        // and ops sees a loud warning telling them which env var to update.
        const AMOUNT_FALLBACK = {
          // §Lite tiered pricing (2026-05-14): each new tier amount also recognized
          // as Lite. Webhook normally takes the metadata.uvera_plan path so these
          // are defense-in-depth for the rare metadata-loss case.
          399:   { tier: 'lite',    monthly_credits: 100,  envHint: 'Lite tier 1 — first purchase $3.99' },
          599:   { tier: 'lite',    monthly_credits: 100,  envHint: 'Lite tier 2 — second purchase $5.99' },
          799:   { tier: 'lite',    monthly_credits: 100,  envHint: 'Lite tier 3+ — third or later purchase $7.99' },
          2500:  { tier: 'starter', monthly_credits: 500,  envHint: 'STRIPE_PRICE_STARTER_MONTHLY' },
          25000: { tier: 'starter', monthly_credits: 500,  envHint: 'STRIPE_PRICE_STARTER_YEARLY (≈$250/yr)' },
          6900:  { tier: 'creator', monthly_credits: 1500, envHint: 'STRIPE_PRICE_CREATOR_MONTHLY' },
          69000: { tier: 'creator', monthly_credits: 1500, envHint: 'STRIPE_PRICE_CREATOR_YEARLY (≈$690/yr)' },
          18900: { tier: 'studio',  monthly_credits: 5000, envHint: 'STRIPE_PRICE_STUDIO_MONTHLY' },
          189000:{ tier: 'studio',  monthly_credits: 5000, envHint: 'STRIPE_PRICE_STUDIO_YEARLY (≈$1890/yr)' },
        };

        // CRITICAL: throw on non-OK response. Previously returned empty
        // object on auth failure, which made (meta.credits || 0) = 0 in the
        // caller and OVERWROTE the user's existing credits with just the
        // monthly_credits amount. Throwing here lets the outer try/catch
        // return 500 → Stripe retries → next attempt has working creds.
        const fetchSupabaseUser = async (supabaseUserId) => {
          const r = await fetch(`${env.SUPABASE_URL || 'https://wjhdsodlxekvhpahascs.supabase.co'}/auth/v1/admin/users/${supabaseUserId}`, {
            headers: {
              'Authorization': `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
              'apikey': env.SUPABASE_SERVICE_ROLE_KEY,
            }
          });
          if (!r.ok) {
            const errText = await r.text().catch(() => '');
            throw new Error(`Supabase admin user fetch failed (${r.status}): ${errText.slice(0, 200)}`);
          }
          return await r.json();
        };

        // CRITICAL: throw on non-OK response. Previously fired-and-forgot the
        // PUT — if Supabase returned 4xx (key revoked, schema issue, rate
        // limit) we'd say 200 OK to Stripe while the user got nothing. Now
        // we fail loud so the outer handler returns 500 and Stripe retries.
        const updateSupabaseMeta = async (supabaseUserId, metaPatch) => {
          const u = await fetchSupabaseUser(supabaseUserId);
          const existingMeta = u.user_metadata || {};

          // §A Phase 1 dual-write (2026-05-13): wherever `credits` is being
          // written, also write `tokens` with the same value (and vice versa
          // if caller already used the new key). Frontend Phase 2 will read
          // `tokens ?? credits` so either key works during transition.
          const dualWritePatch = { ...metaPatch };
          if (dualWritePatch.credits !== undefined && dualWritePatch.tokens === undefined) {
            dualWritePatch.tokens = dualWritePatch.credits;
          }
          if (dualWritePatch.tokens !== undefined && dualWritePatch.credits === undefined) {
            dualWritePatch.credits = dualWritePatch.tokens;
          }

          const r = await fetch(`${env.SUPABASE_URL || 'https://wjhdsodlxekvhpahascs.supabase.co'}/auth/v1/admin/users/${supabaseUserId}`, {
            method: 'PUT',
            headers: {
              'Authorization': `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
              'apikey': env.SUPABASE_SERVICE_ROLE_KEY,
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({ user_metadata: { ...existingMeta, ...dualWritePatch } })
          });
          if (!r.ok) {
            const errText = await r.text().catch(() => '');
            throw new Error(`Supabase metadata update failed (${r.status}): ${errText.slice(0, 200)}`);
          }
        };

        // Resolve a Supabase user id from a Stripe customer.
        // Primary: customer.metadata.supabase_user_id. Fallback: email lookup.
        // Returns { supabaseUserId, source } or { supabaseUserId: null, ... }.
        const resolveSupabaseUserFromStripeCustomer = async (customerId, fallbackEmailHint) => {
          const supabaseUrl = env.SUPABASE_URL || 'https://wjhdsodlxekvhpahascs.supabase.co';
          const custResp = await fetch(`https://api.stripe.com/v1/customers/${customerId}`, {
            headers: { 'Authorization': `Bearer ${env.STRIPE_SECRET_KEY}` }
          });
          if (!custResp.ok) {
            // Wrong-mode key (test vs live) gives 404. Continue with email
            // hint so we still have a chance via the fallback path.
            // §2026-05-15 loud-fail: this is the silent failure that hid
            // the live/test key mismatch from us for half a day during the
            // first PROD rollout — escalating to error so it screams next time.
            const custErrBody = await custResp.text().catch(() => '(unreadable)');
            console.error('[stripe-webhook] Stripe customer fetch non-OK', 'status=' + custResp.status, 'customerId=' + customerId, 'body=' + custErrBody.slice(0, 200), '— possible test/live key mismatch, falling back to email lookup');
          }
          const cust = custResp.ok ? await custResp.json() : {};
          let supabaseUserId = cust.metadata?.supabase_user_id || null;
          let source = supabaseUserId ? 'metadata' : null;

          if (!supabaseUserId) {
            const fallbackEmail = cust.email || fallbackEmailHint;
            if (fallbackEmail) {
              try {
                const lookupResp = await fetch(
                  `${supabaseUrl}/auth/v1/admin/users?email=${encodeURIComponent(fallbackEmail)}`,
                  {
                    headers: {
                      'Authorization': `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
                      'apikey': env.SUPABASE_SERVICE_ROLE_KEY,
                    }
                  }
                );
                if (lookupResp.ok) {
                  const lookupData = await lookupResp.json();
                  supabaseUserId = lookupData.users?.[0]?.id || null;
                  if (supabaseUserId) source = 'email_fallback';
                } else {
                  // §2026-05-15 loud-fail: previously this silently fell
                  // through and the outer handler reported "no_supabase_user"
                  // without context about WHY the lookup failed (RLS / rate
                  // limit / auth schema cache stale). Escalate so root cause
                  // is captured in CF Worker Logs.
                  const lookupErrBody = await lookupResp.text().catch(() => '(unreadable)');
                  console.error('[stripe-webhook] email fallback lookup non-OK', 'status=' + lookupResp.status, 'email=' + fallbackEmail, 'body=' + lookupErrBody.slice(0, 200));
                }
              } catch (e) {
                console.error('[stripe-webhook] email fallback exception:', e.message, 'email=' + fallbackEmail);
              }
            }
          }
          return { supabaseUserId, source, customerEmail: cust.email };
        };

        // Check if an invoice was already processed (idempotency guard).
        // Stripe webhooks are at-least-once — without this guard, retries
        // would double-credit the user. Uses the orders table as the source
        // of truth (we insert orderNo = invoice.id, which is unique).
        const isInvoiceAlreadyProcessed = async (invoiceId) => {
          const supabaseUrl = env.SUPABASE_URL || 'https://wjhdsodlxekvhpahascs.supabase.co';
          try {
            const r = await fetch(
              `${supabaseUrl}/rest/v1/orders?orderNo=eq.${encodeURIComponent(invoiceId)}&select=orderNo`,
              {
                headers: {
                  'Authorization': `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
                  'apikey': env.SUPABASE_SERVICE_ROLE_KEY,
                }
              }
            );
            if (!r.ok) {
              // §2026-05-15 loud-fail audit: this is intentional fail-open
              // (returning false → caller proceeds → maybe double-credit if
              // we missed a real duplicate). That's deliberately preferred
              // over fail-closed (which could SKIP a legitimate first-time
              // webhook delivery if the orders SELECT happened to glitch).
              // BUT the failure must be visible so ops can see PostgREST
              // problems before they cause damage elsewhere — escalating
              // to console.error from console.warn.
              const errBody = await r.text().catch(() => '(unreadable)');
              console.error(
                '[stripe-webhook] idempotency check non-OK',
                'status=' + r.status,
                'invoiceId=' + invoiceId,
                'body=' + errBody.slice(0, 200),
                '— FAIL-OPEN: proceeding as if not-processed'
              );
              return false;
            }
            const rows = await r.json();
            return Array.isArray(rows) && rows.length > 0;
          } catch (e) {
            // Network / DNS failure — same fail-open rationale, same loud log
            console.error('[stripe-webhook] idempotency check exception (fail-open):', e.message, 'invoiceId=' + invoiceId);
            return false;
          }
        };

        // invoice.payment_succeeded fires for both the initial payment AND every
        // renewal — single handler covers the whole subscription lifecycle.
        if (event.type === 'invoice.payment_succeeded') {
          const invoice = event.data.object;
          const customerId = invoice.customer;
          if (!customerId) return new Response('No customer on invoice', { status: 200 });

          // Find the line item that drove this invoice's payment.
          // Why scan instead of grabbing data[0]: a Lite paid trial invoice
          // contains TWO lines — the trialing Starter subscription at $0,
          // plus the Lite Trial Fee at $3.99 (added via add_invoice_items).
          // The order isn't guaranteed; we want the priced line, not the $0
          // trial line. Strategy: prefer the line whose amount equals
          // invoice.amount_paid; fall back to first non-zero line; final
          // fallback to data[0] for backward compat with single-line invoices.
          //
          // Stripe API 2025+ uses `pricing.price_details.price`; older payloads
          // use `price.id`. Try both per line.
          const lines = invoice.lines?.data || [];
          const amountPaidCents = invoice.amount_paid || 0;
          const extractPrice = (l) =>
            l?.pricing?.price_details?.price || l?.price?.id || null;

          const matchingLine =
            lines.find(l => l.amount === amountPaidCents) ||
            lines.find(l => l.amount > 0) ||
            lines[0];
          const priceId = extractPrice(matchingLine);
          const lineItem = matchingLine;  // referenced later for plan.interval

          let planInfo = priceMap[priceId];
          let resolvedVia = 'price_id';

          // Fallback: price ID misconfig → derive tier from invoice amount.
          // Self-healing — user gets tokens even if env vars are stale,
          // but ops still sees a loud warning telling them which env var to fix.
          if (!planInfo) {
            const fallback = AMOUNT_FALLBACK[amountPaidCents];
            if (fallback) {
              planInfo = { tier: fallback.tier, monthly_credits: fallback.monthly_credits };
              resolvedVia = 'amount_fallback';
              // §2026-05-15 loud-fail: env config drift between Stripe
              // Dashboard and Cloudflare. Escalate so ops fixes it (not just
              // a silent self-heal that masks misconfig forever).
              console.error(
                '[stripe-webhook] PRICE_ID_DRIFT: priceId',
                priceId,
                'not in env. Used amount fallback ($' + (amountPaidCents / 100) + ' → ' + fallback.tier + ').',
                'FIX: set Cloudflare env var', fallback.envHint, '=', priceId
              );
            } else {
              // Both lookups failed — refuse so Stripe retries and ops notices.
              // Returning JSON makes the failure visible in Stripe Dashboard's
              // webhook delivery details (vs an opaque "Unknown price" string).
              const errBody = {
                success: false,
                reason: 'unknown_price_and_amount',
                priceId,
                amountPaidCents,
                invoiceId: invoice.id,
                fix: 'priceId is not mapped in priceMap (env vars STRIPE_PRICE_*) and amount does not match any known tier ($25/$69/$189). Update Cloudflare Worker env vars to match this Stripe account, then redeploy.',
              };
              console.error('[stripe-webhook] UNRECOVERABLE:', JSON.stringify(errBody));
              return new Response(JSON.stringify(errBody), {
                status: 200,
                headers: { 'Content-Type': 'application/json' },
              });
            }
          }

          console.log('[stripe-webhook] resolved tier', planInfo.tier, '+' + planInfo.monthly_credits, 'credits via', resolvedVia, 'priceId=' + priceId, 'amount=' + amountPaidCents);

          // IDEMPOTENCY: Stripe delivers webhooks at-least-once. Without this
          // check, a retry after our 200-OK delivery would double-credit the
          // user. orders.orderNo = invoice.id is our dedup key.
          if (await isInvoiceAlreadyProcessed(invoice.id)) {
            console.log('[stripe-webhook] duplicate invoice', invoice.id, '— skipping (already processed)');
            return new Response(JSON.stringify({ success: true, duplicate: true, invoiceId: invoice.id }), {
              status: 200,
              headers: { 'Content-Type': 'application/json' },
            });
          }

          const supabaseUrl = env.SUPABASE_URL || 'https://wjhdsodlxekvhpahascs.supabase.co';
          const { supabaseUserId, source: userSource, customerEmail } =
            await resolveSupabaseUserFromStripeCustomer(customerId, invoice.customer_email);

          if (!supabaseUserId) {
            // Return 500 so Stripe retries — gives ops a window to fix
            // metadata or backfill the user. But cap retries by responding
            // 200 if we've truly exhausted options? We choose 500 here:
            // worst case Stripe stops after ~3 days of retries, and the
            // webhook delivery is visible in dashboard the whole time.
            const errBody = {
              success: false,
              reason: 'no_supabase_user',
              invoiceId: invoice.id,
              customerId,
              customerEmail,
              fix: 'Either set customer.metadata.supabase_user_id in Stripe Dashboard, or ensure a Supabase user exists with this email.',
            };
            console.error('[stripe-webhook] could not resolve supabase user:', JSON.stringify(errBody));
            return new Response(JSON.stringify(errBody), {
              status: 500,
              headers: { 'Content-Type': 'application/json' },
            });
          }
          console.log('[stripe-webhook] resolved user', supabaseUserId, 'via', userSource);

          // Insert order row FIRST. If it conflicts (409), we already
          // processed this invoice and bail out — extra layer of idempotency
          // belt-and-suspenders alongside isInvoiceAlreadyProcessed (handles
          // race where two webhook deliveries arrive within ms of each other).
          const orderPayload = {
            orderNo: invoice.id,                         // unique Stripe invoice ID
            userId: supabaseUserId,
            subject: `UVERA ${planInfo.tier} (${invoice.lines?.data?.[0]?.plan?.interval || lineItem?.plan?.interval || 'monthly'})`,
            amount: (invoice.amount_paid || 0) / 100,    // USD dollars
            status: 1,                                    // 1 = succeeded
            createdAt: new Date(invoice.created * 1000).toISOString(),
          };
          let orderInserted = false;
          try {
            const orderResp = await fetch(`${supabaseUrl}/rest/v1/orders`, {
              method: 'POST',
              headers: {
                'Authorization': `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
                'apikey': env.SUPABASE_SERVICE_ROLE_KEY,
                'Content-Type': 'application/json',
                'Prefer': 'return=minimal',  // no merge — let conflict signal duplicate
              },
              body: JSON.stringify(orderPayload),
            });
            if (orderResp.ok) {
              orderInserted = true;
            } else if (orderResp.status === 409) {
              console.log('[stripe-webhook] order already exists (race-condition duplicate), skipping credits:', invoice.id);
              return new Response(JSON.stringify({ success: true, duplicate: true, invoiceId: invoice.id }), {
                status: 200,
                headers: { 'Content-Type': 'application/json' },
              });
            } else {
              const errText = await orderResp.text().catch(() => '');
              // §2026-05-15 loud-fail: fail-open by design (user paid and
              // deserves their tokens) but escalate from warn to error so
              // financial reconciliation gaps are visible.
              console.error('[stripe-webhook] order insert non-OK', 'status=' + orderResp.status, 'invoiceId=' + invoice.id, 'body=' + errText.slice(0, 300), '— FAIL-OPEN: still granting credits, run admin Reconcile to backfill orders row');
            }
          } catch (err) {
            // §2026-05-15 loud-fail (fail-open) — same rationale as the non-OK branch above
            console.error('[stripe-webhook] order insert exception', err.message, 'invoiceId=' + invoice.id, '— FAIL-OPEN: still granting credits');
          }

          // Add monthly credits to existing balance + set tier.
          // updateSupabaseMeta now throws on failure → outer catch returns
          // 500 → Stripe retries. Order row will exist, but
          // isInvoiceAlreadyProcessed catches it next attempt and short-
          // circuits to duplicate=true. Result: at most one credits update.
          const u = await fetchSupabaseUser(supabaseUserId);
          const meta = u.user_metadata || {};
          // §2026-05-29 — credits 走权威 grant_credits(幂等键 stripe:eventId 防 webhook 重放重复发);
          //   tier 仍写 user_metadata。meta credits 降为镜像。
          const g = await creditGrant(env, supabaseUserId, planInfo.monthly_credits, 'stripe_subscription', invoice.id || null, `stripe:${event.id}`, 'Monthly subscription credits');
          if (!g) throw new Error('Subscription credit grant failed');
          const newBalance = g.balance_after;
          await updateSupabaseMeta(supabaseUserId, {
            tier: planInfo.tier,
            credits: newBalance,
          });
          console.log('[stripe-webhook] credited user', supabaseUserId, '+' + planInfo.monthly_credits, '→', newBalance, 'total | tier=' + planInfo.tier, '| idempotent=' + !!g.idempotent + ' | orderInserted=' + orderInserted);

          // Receipt email — fire-and-forget, never block the webhook ack.
          try {
            const recipientEmail = u.email;
            if (recipientEmail) {
              const tierLabel = planInfo.tier.charAt(0).toUpperCase() + planInfo.tier.slice(1);
              const amountUsd = (amountPaidCents / 100).toFixed(2);
              const { html, text } = renderEmail({
                heading: `Payment received — ${planInfo.monthly_credits.toLocaleString()} tokens added`,
                paragraphs: [
                  `We've received your $${amountUsd} payment for the UVERA ${tierLabel} plan. ${planInfo.monthly_credits.toLocaleString()} tokens have been added to your account.`,
                  `Your new balance: ${newBalance.toLocaleString()} tokens.`,
                  `Tokens carry over month-to-month — they don't expire as long as your subscription is active.`,
                ],
                cta: { label: 'Open UVERA', url: `${url.origin}/subscription` },
                footerNote: `Invoice ${invoice.id}`,
              });
              const r = await sendEmail(env, {
                to: recipientEmail,
                subject: `Payment received — ${planInfo.monthly_credits.toLocaleString()} tokens added`,
                html, text,
                tags: [{ name: 'category', value: 'payment_receipt' }, { name: 'tier', value: planInfo.tier }],
              });
              if (!r.ok) console.warn('[stripe-webhook] receipt email failed:', r.error);
            }
          } catch (e) {
            console.warn('[stripe-webhook] receipt email exception:', e.message);
          }
        }

        // checkout.session.completed (mode=payment): one-time purchases.
        // Currently used for tier='lite' ($3.99 → 100 tokens, no recurring).
        // Subscription checkouts don't enter this branch — those flow through
        // invoice.payment_succeeded above. We use the session's metadata
        // (set in /api/stripe/checkout) to identify which UVERA plan was
        // bought; falls back to amount lookup if metadata is missing.
        else if (event.type === 'checkout.session.completed') {
          const session = event.data.object;
          if (session.mode !== 'payment') {
            console.log('[stripe-webhook] checkout.session.completed mode=' + session.mode + ' — skipping (subscription mode handled by invoice.payment_succeeded)');
            return new Response('ok', { status: 200 });
          }
          if (session.payment_status !== 'paid') {
            console.log('[stripe-webhook] checkout.session.completed payment_status=' + session.payment_status + ' — skipping (not paid)');
            return new Response('ok', { status: 200 });
          }

          /* §2026-05-25 fei — 短剧付费 Phase 1 dispatch.
           *
           * U-Coins top-up (product_type=ucoins):
           *   1) Look up the pending ucoins_orders row by metadata.order_id.
           *   2) Mark it succeeded.
           *   3) Credit U-Coins to wallet_balance (upsert + increment).
           *   4) Insert wallet_tx row (positive).
           *
           * Series bundle (product_type=bundle):
           *   1) Look up pending series_purchases row by metadata.order_id.
           *   2) Mark it succeeded → grants access via /api/episodes/:id/access
           *      (which checks for any succeeded bundle purchase).
           *
           * Idempotency: dedupe via session.id (isInvoiceAlreadyProcessed
           *   checks the orders table, but we also rely on the order row
           *   being moved from pending→succeeded — a duplicate webhook
           *   would find it already succeeded and noop).
           */
          const productType = session.metadata?.product_type;
          if (productType === 'ucoins' || productType === 'bundle') {
            const orderId = session.metadata?.order_id;
            const supabaseUrlSb = env.SUPABASE_URL || 'https://wjhdsodlxekvhpahascs.supabase.co';
            const sbAdmin = (path, init = {}) => fetch(`${supabaseUrlSb}/rest/v1${path}`, {
              ...init,
              headers: {
                'Authorization': `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
                'apikey': env.SUPABASE_SERVICE_ROLE_KEY,
                'Content-Type': 'application/json',
                ...(init.headers || {}),
              },
            });

            if (!orderId) {
              console.error('[stripe-webhook] ucoins/bundle session missing metadata.order_id', session.id);
              return new Response(JSON.stringify({ success: false, reason: 'missing_order_id' }), { status: 200 });
            }

            try {
              if (productType === 'ucoins') {
                // Fetch the pending order
                const ordResp = await sbAdmin(`/ucoins_orders?id=eq.${orderId}&select=*`);
                const ordRows = ordResp.ok ? await ordResp.json() : [];
                if (ordRows.length === 0) throw new Error('Order not found');
                const order = ordRows[0];
                if (order.status === 'succeeded') {
                  console.log('[stripe-webhook] ucoins order already succeeded, skipping', orderId);
                  return new Response(JSON.stringify({ success: true, duplicate: true }), { status: 200 });
                }

                /* §2026-05-26 fei (audit #5) — atomic credit via SECURITY
                 *   DEFINER RPC. Replaces the previous read-modify-write
                 *   sequence (lines were lossy under concurrency with the
                 *   unlock path — see migration 20260526000002 header).
                 *
                 *   Idempotency: the ucoins_orders.status check above
                 *   (line ~8497) already returns early on duplicates, so this
                 *   RPC only fires once per order. RPC itself is NOT
                 *   idempotent (calling twice would credit twice) — that's by
                 *   design; idempotency lives at the order level. */
                const creditResp = await sbAdmin('/rpc/wallet_credit_purchase', {
                  method: 'POST',
                  headers: { 'Prefer': 'return=representation' },
                  body: JSON.stringify({
                    p_user_id: order.user_id,
                    p_ucoins_amount: order.ucoins_to_credit,
                    p_tx_type: order.is_first_charge ? 'first_charge' : 'purchase',
                    p_reference_type: 'ucoins_order',
                    p_reference_id: order.id,
                    p_description: `充值 $${(order.amount_usd_cents / 100).toFixed(2)} → ${order.ucoins_to_credit} Tokens${order.ucoins_bonus > 0 ? ` (含 ${order.ucoins_bonus} 赠送)` : ''}`,
                  }),
                });
                if (!creditResp.ok) {
                  const eTxt = await creditResp.text();
                  throw new Error(`wallet_credit_purchase RPC HTTP ${creditResp.status}: ${eTxt.slice(0, 200)}`);
                }
                const creditResult = await creditResp.json();
                if (!creditResult.success) {
                  throw new Error(creditResult.errMessage || 'Credit RPC returned non-success');
                }
                const newBal = creditResult.balance_after;
                const tx = { id: creditResult.wallet_tx_id };

                // Mark order succeeded
                await sbAdmin(`/ucoins_orders?id=eq.${orderId}`, {
                  method: 'PATCH',
                  body: JSON.stringify({
                    status: 'succeeded',
                    completed_at: new Date().toISOString(),
                    stripe_payment_intent: session.payment_intent || null,
                    wallet_tx_id: tx.id || null,
                  }),
                });

                console.log(`[stripe-webhook] ✅ U-Coins credited: user=${order.user_id} +${order.ucoins_to_credit} → ${newBal} (order=${orderId})`);
                return new Response(JSON.stringify({ success: true, ucoins_credited: order.ucoins_to_credit, new_balance: newBal }), {
                  status: 200, headers: { 'Content-Type': 'application/json' },
                });
              }

              if (productType === 'bundle') {
                const ordResp = await sbAdmin(`/series_purchases?id=eq.${orderId}&select=*`);
                const ordRows = ordResp.ok ? await ordResp.json() : [];
                if (ordRows.length === 0) throw new Error('Series purchase not found');
                const order = ordRows[0];
                if (order.status === 'succeeded') {
                  console.log('[stripe-webhook] bundle order already succeeded', orderId);
                  return new Response(JSON.stringify({ success: true, duplicate: true }), { status: 200 });
                }

                await sbAdmin(`/series_purchases?id=eq.${orderId}`, {
                  method: 'PATCH',
                  body: JSON.stringify({
                    status: 'succeeded',
                    completed_at: new Date().toISOString(),
                    stripe_payment_intent: session.payment_intent || null,
                  }),
                });

                // Also write a wallet_tx for visibility (no balance change)
                //   so the user's transaction history shows the buy-out.
                await sbAdmin('/wallet_tx', {
                  method: 'POST',
                  body: JSON.stringify([{
                    user_id: order.user_id,
                    amount: 0,
                    balance_after: 0, // placeholder; we don't need to read here
                    tx_type: 'bundle_purchase',
                    reference_type: 'series_purchase',
                    reference_id: order.id,
                    description: `整剧买断 $${(order.amount_usd_cents / 100).toFixed(2)}`,
                  }]),
                });

                console.log(`[stripe-webhook] ✅ Series bundle purchased: user=${order.user_id} series=${order.series_id} (order=${orderId})`);
                return new Response(JSON.stringify({ success: true, bundle_unlocked: true }), {
                  status: 200, headers: { 'Content-Type': 'application/json' },
                });
              }
            } catch (dispatchErr) {
              console.error('[stripe-webhook] ucoins/bundle dispatch failed:', dispatchErr.message);
              // Throw to outer catch → 500 → Stripe retries with backoff
              throw dispatchErr;
            }
          }

          const customerId = session.customer;
          const amountTotal = session.amount_total || 0;
          const planFromMeta = session.metadata?.uvera_plan || null;

          // Resolve plan info:
          // 1. metadata.uvera_plan → priceMap-equivalent lookup
          // 2. amount fallback ($3.99 → lite)
          let planInfo = null;
          let resolvedVia = null;
          if (planFromMeta === 'lite') {
            planInfo = { tier: 'lite', monthly_credits: 100 };
            resolvedVia = 'metadata.uvera_plan';
          } else {
            const fallback = AMOUNT_FALLBACK[amountTotal];
            if (fallback) {
              planInfo = { tier: fallback.tier, monthly_credits: fallback.monthly_credits };
              resolvedVia = 'amount_fallback';
              console.warn('[stripe-webhook] one-time checkout: no uvera_plan metadata, used amount fallback $' + (amountTotal / 100) + ' → ' + fallback.tier);
            }
          }
          if (!planInfo) {
            const errBody = {
              success: false,
              reason: 'one_time_no_match',
              sessionId: session.id,
              amountTotal,
              uvera_plan: planFromMeta,
              fix: 'Set metadata.uvera_plan when creating the Checkout Session, or add the amount to AMOUNT_FALLBACK in the webhook.',
            };
            console.error('[stripe-webhook] one-time checkout unrecognized:', JSON.stringify(errBody));
            return new Response(JSON.stringify(errBody), {
              status: 200,
              headers: { 'Content-Type': 'application/json' },
            });
          }

          // Idempotency: dedup on session.id (one-time payments don't have
          // an invoice we can use, but session.id is unique per checkout).
          if (await isInvoiceAlreadyProcessed(session.id)) {
            console.log('[stripe-webhook] duplicate checkout session', session.id, '— skipping');
            return new Response(JSON.stringify({ success: true, duplicate: true, sessionId: session.id }), {
              status: 200,
              headers: { 'Content-Type': 'application/json' },
            });
          }

          const supabaseUrl = env.SUPABASE_URL || 'https://wjhdsodlxekvhpahascs.supabase.co';
          const { supabaseUserId, source: userSource } =
            await resolveSupabaseUserFromStripeCustomer(customerId, session.customer_email || session.customer_details?.email);

          if (!supabaseUserId) {
            const errBody = {
              success: false,
              reason: 'no_supabase_user',
              sessionId: session.id,
              customerId,
              fix: 'Either set customer.metadata.supabase_user_id in Stripe Dashboard, or ensure a Supabase user exists with this email.',
            };
            console.error('[stripe-webhook] one-time checkout could not resolve user:', JSON.stringify(errBody));
            return new Response(JSON.stringify(errBody), {
              status: 500,
              headers: { 'Content-Type': 'application/json' },
            });
          }

          // Insert orders row first (idempotency belt-and-suspenders).
          // §Lite tiered pricing — surface tier in subject so admin can
          // see at a glance which top-up generation this was (1st / 2nd /
          // 3rd+). Pulled from metadata.uvera_lite_tier set at checkout.
          const liteTierLabel = session.metadata?.uvera_lite_tier
            ? ` × ${session.metadata.uvera_lite_tier}`
            : '';
          const orderPayload = {
            orderNo: session.id,                          // unique Stripe checkout session ID
            userId: supabaseUserId,
            subject: `UVERA ${planInfo.tier}${liteTierLabel} (one-time)`,
            amount: amountTotal / 100,
            status: 1,
            createdAt: new Date(session.created * 1000).toISOString(),
          };
          try {
            const orderResp = await fetch(`${supabaseUrl}/rest/v1/orders`, {
              method: 'POST',
              headers: {
                'Authorization': `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
                'apikey': env.SUPABASE_SERVICE_ROLE_KEY,
                'Content-Type': 'application/json',
                'Prefer': 'return=minimal',
              },
              body: JSON.stringify(orderPayload),
            });
            if (orderResp.status === 409) {
              console.log('[stripe-webhook] one-time order race-duplicate, skipping credits:', session.id);
              return new Response(JSON.stringify({ success: true, duplicate: true, sessionId: session.id }), {
                status: 200,
                headers: { 'Content-Type': 'application/json' },
              });
            } else if (!orderResp.ok) {
              const errText = await orderResp.text().catch(() => '');
              // §2026-05-15 loud-fail (fail-open, same rationale as invoice path)
              console.error('[stripe-webhook] one-time order insert non-OK', 'status=' + orderResp.status, 'sessionId=' + session.id, 'body=' + errText.slice(0, 300), '— FAIL-OPEN: still granting credits, admin Reconcile can backfill');
            }
          } catch (err) {
            console.error('[stripe-webhook] one-time order insert exception:', err.message, 'sessionId=' + session.id, '— FAIL-OPEN: still granting credits');
          }

          // Grant tokens + (conditionally) set tier.
          // §2026-05-14 fix: Lite is purely additive — it adds 100 tokens
          // and ONLY upgrades the badge if the user was on `free`. Users
          // already on a paid subscription tier (starter/creator/studio)
          // keep their tier untouched. Previously this overwrote tier with
          // 'lite' and silently downgraded paid subscribers — see
          // computeNewTier() docstring at the top of this file for the
          // full rules + bug history.
          const u = await fetchSupabaseUser(supabaseUserId);
          const meta = u.user_metadata || {};
          // §2026-05-29 — credits 走权威 grant_credits(幂等键 stripe:eventId);tier 仍写 meta。
          const g = await creditGrant(env, supabaseUserId, planInfo.monthly_credits, 'stripe_topup', session.id || null, `stripe:${event.id}`, 'Top-up purchase');
          if (!g) throw new Error('Top-up credit grant failed');
          const newBalance = g.balance_after;
          const newTier = computeNewTier(meta.tier, planInfo.tier);
          await updateSupabaseMeta(supabaseUserId, {
            tier: newTier,
            credits: newBalance,
          });
          console.log('[stripe-webhook] one-time purchase credited user', supabaseUserId, '+' + planInfo.monthly_credits, '→', newBalance, 'total | tier=', meta.tier || 'free', '→', newTier, '| idempotent=' + !!g.idempotent + ' | via=' + resolvedVia, '| sessionId=' + session.id);

          // Receipt email — fire-and-forget.
          try {
            const recipientEmail = u.email || session.customer_email || session.customer_details?.email;
            if (recipientEmail) {
              const amountUsd = (amountTotal / 100).toFixed(2);
              const tierLabel = planInfo.tier.charAt(0).toUpperCase() + planInfo.tier.slice(1);
              const { html, text } = renderEmail({
                heading: `Top-up complete — ${planInfo.monthly_credits.toLocaleString()} tokens added`,
                paragraphs: [
                  `Thanks for your $${amountUsd} ${tierLabel} purchase. ${planInfo.monthly_credits.toLocaleString()} tokens have been added to your account.`,
                  `Your new balance: ${newBalance.toLocaleString()} tokens.`,
                  `This is a one-time purchase — no recurring charge. You can buy more anytime, or upgrade to a monthly plan from your subscription page.`,
                ],
                cta: { label: 'Open UVERA', url: `${url.origin}/subscription` },
                footerNote: `Order ${session.id}`,
              });
              const r = await sendEmail(env, {
                to: recipientEmail,
                subject: `Top-up complete — ${planInfo.monthly_credits.toLocaleString()} tokens added`,
                html, text,
                tags: [{ name: 'category', value: 'one_time_receipt' }, { name: 'tier', value: planInfo.tier }],
              });
              if (!r.ok) console.warn('[stripe-webhook] one-time receipt email failed:', r.error);
            }
          } catch (e) {
            console.warn('[stripe-webhook] one-time receipt email exception:', e.message);
          }
        }

        // customer.subscription.deleted: user cancelled — drop to free.
        // Existing credits remain (user already paid for this period).
        else if (event.type === 'customer.subscription.deleted') {
          const sub = event.data.object;
          const customerId = sub.customer;
          // Use the same resolver as invoice.payment_succeeded so cancellations
          // also benefit from email fallback (legacy customers without metadata
          // would otherwise stay on paid tier forever).
          const { supabaseUserId, source: userSource } =
            await resolveSupabaseUserFromStripeCustomer(customerId, null);
          if (supabaseUserId) {
            await updateSupabaseMeta(supabaseUserId, { tier: 'free' });
            console.log('[stripe-webhook] downgraded user', supabaseUserId, 'to free via', userSource);
          } else {
            console.warn('[stripe-webhook] subscription.deleted: could not resolve user for customer', customerId, '— tier not updated');
          }
        }

        // charge.refunded: a refund was issued (either via our admin UI,
        // which already wrote audit columns, or directly in Stripe Dashboard).
        // Sync the orders row so KPIs reflect refunds regardless of channel.
        // Idempotent: re-running is safe (we only update if refunded_at is null
        // or stripe_refund_id changed, and we never deduct credits here —
        // out-of-band refunds don't get credits clawed back automatically;
        // admin can use +Tokens to adjust if needed).
        else if (event.type === 'charge.refunded') {
          const charge = event.data.object;
          const paymentIntentId = charge.payment_intent;
          if (!paymentIntentId) {
            console.warn('[stripe-webhook] charge.refunded without payment_intent — id=' + charge.id);
            return new Response('ok', { status: 200 });
          }

          // Find the orderNo in our DB by walking back from the payment_intent.
          // For invoices: PaymentIntent.invoice → in_xxx
          // For one-time: search Sessions by payment_intent → cs_xxx
          let orderNo = null;
          try {
            const piResp = await fetch(`https://api.stripe.com/v1/payment_intents/${paymentIntentId}`, {
              headers: { 'Authorization': `Bearer ${env.STRIPE_SECRET_KEY}` }
            });
            if (piResp.ok) {
              const pi = await piResp.json();
              if (pi.invoice) {
                orderNo = pi.invoice;
              } else {
                // Look up the checkout session via list endpoint
                const sessResp = await fetch(`https://api.stripe.com/v1/checkout/sessions?payment_intent=${paymentIntentId}&limit=1`, {
                  headers: { 'Authorization': `Bearer ${env.STRIPE_SECRET_KEY}` }
                });
                if (sessResp.ok) {
                  const list = await sessResp.json();
                  orderNo = list.data?.[0]?.id || null;
                } else {
                  // §2026-05-15 loud-fail
                  const errBody = await sessResp.text().catch(() => '(unreadable)');
                  console.error('[stripe-webhook] charge.refunded session lookup non-OK', 'status=' + sessResp.status, 'paymentIntentId=' + paymentIntentId, 'body=' + errBody.slice(0, 200));
                }
              }
            } else {
              // §2026-05-15 loud-fail
              const errBody = await piResp.text().catch(() => '(unreadable)');
              console.error('[stripe-webhook] charge.refunded PI lookup non-OK', 'status=' + piResp.status, 'paymentIntentId=' + paymentIntentId, 'body=' + errBody.slice(0, 200));
            }
          } catch (e) {
            console.error('[stripe-webhook] charge.refunded order lookup exception:', e.message, 'paymentIntentId=' + paymentIntentId);
          }

          if (!orderNo) {
            // Informational warn — legitimately can happen for non-UVERA
            // charges in shared Stripe accounts; keep as warn so it doesn't
            // pollute the error stream.
            console.warn('[stripe-webhook] charge.refunded: no UVERA orderNo found for payment_intent', paymentIntentId, '— skipping DB sync');
            return new Response('ok', { status: 200 });
          }

          // Cumulative refund amount (Stripe sums prior partial refunds).
          const cumulativeRefundedCents = charge.amount_refunded || 0;
          const cumulativeRefundedUsd = cumulativeRefundedCents / 100;
          // Latest refund object in case admin needs the link
          const latestRefund = charge.refunds?.data?.[0];

          const supabaseUrl = env.SUPABASE_URL || 'https://wjhdsodlxekvhpahascs.supabase.co';
          const patch = {
            refunded_at: new Date().toISOString(),
            refunded_amount: cumulativeRefundedUsd,
            stripe_refund_id: latestRefund?.id || null,
            refunded_reason: latestRefund?.metadata?.uvera_reason || latestRefund?.reason || 'Refunded via Stripe Dashboard (out of band)',
          };
          try {
            const updResp = await fetch(
              `${supabaseUrl}/rest/v1/orders?orderNo=eq.${encodeURIComponent(orderNo)}`,
              {
                method: 'PATCH',
                headers: {
                  'Authorization': `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
                  'apikey': env.SUPABASE_SERVICE_ROLE_KEY,
                  'Content-Type': 'application/json',
                  'Prefer': 'return=minimal',
                },
                body: JSON.stringify(patch),
              }
            );
            if (!updResp.ok) {
              const t = await updResp.text().catch(() => '');
              // §2026-05-15 loud-fail: refund sync failing silently means
              // KPI dashboards show stale revenue (refund didn't subtract).
              console.error('[stripe-webhook] charge.refunded DB sync non-OK', 'status=' + updResp.status, 'orderNo=' + orderNo, 'body=' + t.slice(0, 300));
            } else {
              console.log('[stripe-webhook] charge.refunded synced:', orderNo, '$' + cumulativeRefundedUsd, 'refund=' + latestRefund?.id);
            }
          } catch (e) {
            console.error('[stripe-webhook] charge.refunded DB sync exception:', e.message, 'orderNo=' + orderNo);
          }

          /* §2026-05-26 fei (audit #7) — Drama paywall refund cascade.
           *   The legacy `orders` table sync above covers subscription/tier
           *   refunds. Drama products (ucoins_orders + series_purchases)
           *   live in separate tables, and they need ledger-side reversal:
           *     · ucoins_orders refund → atomic wallet_refund_purchase RPC
           *       (decrements wallet_balance up to what's left, logs refund tx)
           *     · series_purchases refund → mark refunded + DELETE the
           *       bundle-derived episode_unlocks rows (revokes future access)
           *   Without this cascade, refunded users keep their bundle access
           *   AND their U-Coins balance, AND the settlement engine still
           *   counts the refunded GMV → platform pays creator share on money
           *   that was returned to the customer. Direct cash loss.
           *
           *   Idempotency: ucoins_orders.status / series_purchases.status
           *   transition to 'refunded' is the guard. If status is already
           *   'refunded' we skip the RPC + delete (avoid double-debit). */
          try {
            const sbAdmin = (path, init = {}) => fetch(`${supabaseUrl}/rest/v1${path}`, {
              ...init,
              headers: {
                'Authorization': `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
                'apikey': env.SUPABASE_SERVICE_ROLE_KEY,
                'Content-Type': 'application/json',
                ...(init.headers || {}),
              },
            });

            // 1. ucoins_orders match by stripe_checkout_session_id = orderNo
            const ucoinsLookup = await sbAdmin(
              `/ucoins_orders?stripe_session_id=eq.${encodeURIComponent(orderNo)}&select=id,user_id,ucoins_to_credit,status&limit=1`
            );
            const ucoinsRows = ucoinsLookup.ok ? await ucoinsLookup.json() : [];
            const ucoinsOrder = ucoinsRows[0];
            if (ucoinsOrder && ucoinsOrder.status === 'succeeded') {
              // Atomic reverse via RPC (handles concurrent unlock/topup races)
              const rpcResp = await sbAdmin('/rpc/wallet_refund_purchase', {
                method: 'POST',
                headers: { 'Prefer': 'return=representation' },
                body: JSON.stringify({
                  p_user_id: ucoinsOrder.user_id,
                  p_ucoins_amount: ucoinsOrder.ucoins_to_credit,
                  p_reference_type: 'ucoins_order',
                  p_reference_id: ucoinsOrder.id,
                  p_description: `Stripe refund (${latestRefund?.id || 'manual'}) for ucoins_order ${ucoinsOrder.id}`,
                }),
              });
              const rpcJson = rpcResp.ok ? await rpcResp.json() : null;
              await sbAdmin(`/ucoins_orders?id=eq.${ucoinsOrder.id}`, {
                method: 'PATCH',
                body: JSON.stringify({
                  status: 'refunded',
                  refunded_at: new Date().toISOString(),
                  stripe_refund_id: latestRefund?.id || null,
                }),
              });
              console.log('[stripe-webhook] ucoins_order refunded:', ucoinsOrder.id, 'rpc=', JSON.stringify(rpcJson));
            }

            // 2. series_purchases match same way
            const bundleLookup = await sbAdmin(
              `/series_purchases?stripe_session_id=eq.${encodeURIComponent(orderNo)}&select=id,user_id,series_id,status&limit=1`
            );
            const bundleRows = bundleLookup.ok ? await bundleLookup.json() : [];
            const bundleOrder = bundleRows[0];
            if (bundleOrder && bundleOrder.status === 'succeeded') {
              await sbAdmin(`/series_purchases?id=eq.${bundleOrder.id}`, {
                method: 'PATCH',
                body: JSON.stringify({
                  status: 'refunded',
                  refunded_at: new Date().toISOString(),
                  stripe_refund_id: latestRefund?.id || null,
                }),
              });
              // Revoke bundle-derived unlocks. unlock_type='bundle' filter avoids
              // wiping individual U-Coins unlocks the user paid for separately.
              const delResp = await sbAdmin(
                `/episode_unlocks?user_id=eq.${bundleOrder.user_id}&series_id=eq.${bundleOrder.series_id}&unlock_type=eq.bundle`,
                { method: 'DELETE', headers: { 'Prefer': 'return=minimal' } }
              );
              console.log('[stripe-webhook] bundle refunded:', bundleOrder.id, 'unlocks_revoked_status=' + delResp.status);
            }
          } catch (e) {
            console.error('[stripe-webhook] drama refund cascade exception:', e.message, 'orderNo=' + orderNo);
          }
        }

        // Visibility: log everything else so we know what events Stripe is
        // actually sending. Helps spot misconfigured webhook subscriptions
        // (too many events selected in dashboard) or new event types we
        // should be handling.
        else {
          console.log('[stripe-webhook] unhandled event type:', event.type, '— id=' + event.id);
        }

        return new Response('ok', { status: 200 });
      } catch (err) {
        console.error('[stripe-webhook]', err);
        return new Response('Webhook handler failed: ' + err.message, { status: 500 });
      }
    }

    // ─── Universal daily login bonus ────────────────────────────────────
    // POST /api/credits/claim-daily  →  { claimed, credits, last_claim_date, added? }
    // 6 credits/day for ALL users (free + paid). Once per UTC day. Idempotent
    // — already-claimed returns claimed=false. Paid users get this on TOP of
    // their monthly subscription allocation (delivered via Stripe webhook).
    // §A Phase 1 (2026-05-13): /api/tokens/claim-daily is the new canonical
    // path; /api/credits/claim-daily kept as alias for backward compat with
    // legacy frontend during transition. Phase 4 will drop the credits/ path.
    if ((url.pathname === '/api/credits/claim-daily' ||
         url.pathname === '/api/tokens/claim-daily') &&
        request.method === 'POST') {
      const corsHeaders = { 'Access-Control-Allow-Origin': '*' };
      const DAILY_LOGIN_BONUS = 6;
      try {
        // §2026-05-29 — 走权威 user_credits(grant_credits 幂等键=daily:uid:date)。
        //   取代旧的 user_metadata 手判 + admin PUT(用户可写,能刷)。
        const caller = await requireUser(request, env);
        const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD UTC
        const g = await creditGrant(env, caller.id, DAILY_LOGIN_BONUS, 'daily', null, `daily:${caller.id}:${today}`, 'Daily login bonus');
        if (!g) throw new Error('Daily claim failed');
        const claimed = !g.idempotent;
        const balance = g.balance_after;
        // 冷路径镜像:成功领取才写回 meta(rollback 保险 + 旧前端兼容)。
        if (claimed) await mirrorBalanceToMeta(env, caller.id, balance, { ...caller.meta, last_claim_date: today });
        return new Response(JSON.stringify({
          success: true, claimed,
          credits: balance, tokens: balance,  // dual-key response
          last_claim_date: today,
          ...(claimed ? { added: DAILY_LOGIN_BONUS } : { message: 'Already claimed today' })
        }), {
          status: 200, headers: { 'Content-Type': 'application/json', ...corsHeaders }
        });
      } catch (err) {
        const code = err.httpStatus === 401 ? 401 : 500;
        return new Response(JSON.stringify({ success: false, errMessage: err.message }), {
          status: code, headers: { 'Content-Type': 'application/json', ...corsHeaders }
        });
      }
    }

    // §2026-05-29 fei — 分享加币(服务端权威,限频 +10/次,≤3/日)。
    //   取代旧的客户端直接改 user_metadata(用户可写,能无限刷)。
    //   幂等键 share:uid:date:n 防同一次分享重复领;当天计数数 credit_tx。
    if (url.pathname === '/api/credits/claim-share' && request.method === 'POST') {
      const corsHeaders = { 'Access-Control-Allow-Origin': '*' };
      const SHARE_BONUS = 10, MAX_PER_DAY = 3;
      try {
        const caller = await requireUser(request, env);
        const today = new Date().toISOString().slice(0, 10);
        // 当天已领次数:数 credit_tx 当天 share 行。
        const cntResp = await supabaseAdmin(
          `/credit_tx?user_id=eq.${caller.id}&tx_type=eq.share&created_at=gte.${today}T00:00:00Z&select=id`,
          { method: 'GET' });
        const rows = cntResp.ok ? await cntResp.json().catch(() => []) : [];
        const used = Array.isArray(rows) ? rows.length : 0;
        if (used >= MAX_PER_DAY) {
          return new Response(JSON.stringify({ success: false, reason: 'daily_limit_reached' }),
            { status: 200, headers: { 'Content-Type': 'application/json', ...corsHeaders } });
        }
        const n = used + 1;
        const g = await creditGrant(env, caller.id, SHARE_BONUS, 'share', null, `share:${caller.id}:${today}:${n}`, 'Share bonus');
        if (!g) throw new Error('Share grant failed');
        await mirrorBalanceToMeta(env, caller.id, g.balance_after, caller.meta);
        return new Response(JSON.stringify({ success: true, newCredits: g.balance_after, tokens: g.balance_after, newCount: n }),
          { status: 200, headers: { 'Content-Type': 'application/json', ...corsHeaders } });
      } catch (err) {
        const code = err.httpStatus === 401 ? 401 : 500;
        return new Response(JSON.stringify({ success: false, errMessage: err.message }),
          { status: code, headers: { 'Content-Type': 'application/json', ...corsHeaders } });
      }
    }

    // ─── Admin: manually grant credits/tokens to a user ───────────────
    // POST /api/admin/grant-credits  (legacy alias, kept during v1.2 rename)
    // POST /api/admin/grant-tokens   (canonical new path — §A Phase 1)
    // Body: { userEmail | userId, credits | tokens, tier?, reason?, stripeInvoiceId? }
    //
    // Accepts either `credits` or `tokens` in the body (frontend Phase 2
    // switches to `tokens`); writes to BOTH credit_grants and token_grants
    // tables; writes BOTH user_metadata keys.
    if ((url.pathname === '/api/admin/grant-credits' ||
         url.pathname === '/api/admin/grant-tokens') &&
        request.method === 'POST') {
      const corsHeaders = { 'Access-Control-Allow-Origin': '*' };
      try {
        const supabaseUrl = env.SUPABASE_URL || 'https://wjhdsodlxekvhpahascs.supabase.co';
        const anonKey = env.SUPABASE_ANON_KEY || '';

        // 1. Verify caller is admin (read JWT, check user_metadata.is_admin)
        const authHeader = request.headers.get('Authorization');
        if (!authHeader) throw new Error('Authorization header required');
        const callerResp = await fetch(`${supabaseUrl}/auth/v1/user`, {
          headers: { 'Authorization': authHeader, 'apikey': anonKey }
        });
        if (!callerResp.ok) throw new Error('Could not verify caller');
        const caller = await callerResp.json();
        if (caller.user_metadata?.is_admin !== true) {
          throw new Error('Admin access required');
        }

        // 2. Parse + validate body. Accept either userEmail or userId
        // (the latter is used by the reconciliation auto-fix flow where we
        // already know the user id from the orders.userId column).
        // §A Phase 1: accept either `tokens` (new) or `credits` (old) key.
        const body = await request.json();
        const { userEmail, userId, tier, reason, stripeInvoiceId } = body;
        const amount = body.tokens ?? body.credits;
        if ((!userEmail && !userId) || !amount || Number(amount) <= 0) {
          throw new Error('Either userEmail or userId, plus a positive tokens/credits value, are required');
        }
        const validTiers = ['free', 'starter', 'creator', 'studio'];
        if (tier && !validTiers.includes(tier)) {
          throw new Error('Invalid tier — must be one of: ' + validTiers.join(', '));
        }

        // 3. Look up the target user. Prefer userId when provided (faster,
        // no email-search round trip). Fall back to email lookup.
        let targetUser;
        if (userId) {
          const r = await fetch(`${supabaseUrl}/auth/v1/admin/users/${userId}`, {
            headers: {
              'Authorization': `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
              'apikey': env.SUPABASE_SERVICE_ROLE_KEY,
            }
          });
          if (!r.ok) throw new Error(`User lookup by id failed: ${r.status}`);
          targetUser = await r.json();
          if (!targetUser?.id) throw new Error(`No user found with id ${userId}`);
        } else {
          const r = await fetch(
            `${supabaseUrl}/auth/v1/admin/users?email=${encodeURIComponent(userEmail)}`,
            {
              headers: {
                'Authorization': `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
                'apikey': env.SUPABASE_SERVICE_ROLE_KEY,
              }
            }
          );
          if (!r.ok) throw new Error(`User lookup failed: ${r.status}`);
          const lookupData = await r.json();
          targetUser = lookupData.users?.[0];
          if (!targetUser) throw new Error(`No user found with email ${userEmail}`);
        }

        // 4. §2026-05-29 — credits 走权威 grant_credits(原子加,绕用户可写 meta);
        //    tier 仍写 user_metadata(本轮不动 tier 写入);meta credits/tokens 降级为镜像。
        const meta = targetUser.user_metadata || {};
        const g = await creditGrant(env, targetUser.id, Number(amount), 'admin_grant', null, null, `Admin grant by ${caller.email || caller.id}${reason ? ': ' + reason : ''}`);
        if (!g) throw new Error('Admin grant failed');
        const newBalance = g.balance_after;
        // 镜像权威余额 + 按需写 tier。meta 现为只读副本,镜像失败不阻断(credits 已权威入账)。
        const newMeta = { ...meta, credits: newBalance, tokens: newBalance };
        if (tier) newMeta.tier = tier;

        const updateResp = await fetch(`${supabaseUrl}/auth/v1/admin/users/${targetUser.id}`, {
          method: 'PUT',
          headers: {
            'Authorization': `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
            'apikey': env.SUPABASE_SERVICE_ROLE_KEY,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ user_metadata: newMeta })
        });
        if (!updateResp.ok) console.warn(`[grant-credits] meta mirror failed: ${updateResp.status} (credits granted authoritatively; meta stale)`);

        // 5. Audit log — best effort, non-fatal.
        // §A Phase 1: dual-write to BOTH credit_grants AND token_grants
        // so the rename transition doesn't lose history. After Phase 4
        // drops credit_grants the SQL below becomes a single insert.
        const grantRow = {
          user_id: targetUser.id,
          granted_by: caller.id,
          amount: Number(amount),
          tier: tier || null,
          reason: reason || null,
          stripe_invoice_id: stripeInvoiceId || null,
        };
        const insertGrantTo = async (tableName) => {
          await fetch(`${supabaseUrl}/rest/v1/${tableName}`, {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
              'apikey': env.SUPABASE_SERVICE_ROLE_KEY,
              'Content-Type': 'application/json',
              'Prefer': 'return=minimal',
            },
            body: JSON.stringify(grantRow),
          });
        };
        try {
          await Promise.all([
            insertGrantTo('credit_grants'),
            insertGrantTo('token_grants'),
          ]);
        } catch (logErr) {
          // §2026-05-15 loud-fail: audit log loss = compliance gap. Money
          // moved (tokens granted), but the "who granted what when" record
          // is missing. Escalate so ops can manually backfill if needed.
          console.error('[grant-credits] audit log insert failed:', logErr.message, '— tokens were granted but credit_grants/token_grants row missing; investigate');
        }

        // 6. Notify the user — fire-and-forget. Skip if we suspect this is
        // an internal reconciliation grant the user shouldn't be told about
        // (reason starts with "internal:" — convention).
        try {
          const skipEmail = typeof reason === 'string' && reason.toLowerCase().startsWith('internal:');
          if (!skipEmail && targetUser.email) {
            const reasonLine = reason
              ? `Reason: ${reason}`
              : 'Reason: Manual adjustment by support.';
            const paragraphs = [
              `Our support team has added ${Number(amount).toLocaleString()} tokens to your UVERA account.`,
              reasonLine,
              `Your new balance: ${newBalance.toLocaleString()} tokens.`,
            ];
            if (tier && tier !== meta.tier) {
              paragraphs.push(`Your tier has been updated to ${tier.charAt(0).toUpperCase() + tier.slice(1)}.`);
            }
            const { html, text } = renderEmail({
              heading: `${Number(amount).toLocaleString()} tokens added to your account`,
              paragraphs,
              cta: { label: 'Open UVERA', url: `${url.origin}/subscription` },
            });
            const r = await sendEmail(env, {
              to: targetUser.email,
              subject: `${Number(amount).toLocaleString()} tokens added to your account`,
              html, text,
              tags: [{ name: 'category', value: 'manual_grant' }],
            });
            if (!r.ok) console.warn('[grant-credits] notification email failed:', r.error);
          }
        } catch (e) {
          console.warn('[grant-credits] notification email exception:', e.message);
        }

        return new Response(JSON.stringify({
          success: true,
          userId: targetUser.id,
          userEmail: targetUser.email,
          // Dual-key response: clients reading either name get the same value
          newCredits: newBalance,
          newTokens: newBalance,
          newTier: newMeta.tier || null,
        }), {
          status: 200,
          headers: { 'Content-Type': 'application/json', ...corsHeaders }
        });
      } catch (err) {
        return new Response(JSON.stringify({ success: false, errMessage: err.message }), {
          status: 500,
          headers: { 'Content-Type': 'application/json', ...corsHeaders }
        });
      }
    }

    // ─── Admin: send a test email via Resend ────────────────────────────
    // POST /api/admin/email/test
    // Body: { to, subject?, body? }
    // Used to verify Resend API key + FROM domain DNS are configured. Sends
    // a small "UVERA email pipeline test" message to the given address.
    // ─── Help articles (public read) ────────────────────────────────────
    // GET /api/help/articles?category=foo
    //
    // Public endpoint — anyone can read published help articles. The
    // table has RLS allowing select where published=true, so this could
    // technically be a direct supabase client call. We expose it as an
    // endpoint anyway for two reasons:
    //   1. Centralized caching / future CDN cache headers.
    //   2. Stable contract for the frontend even if the underlying schema
    //      shifts (e.g. tag system added later).
    if (url.pathname === '/api/help/articles' && request.method === 'GET') {
      const corsHeaders = { 'Access-Control-Allow-Origin': '*' };
      try {
        const supabaseUrl = env.SUPABASE_URL || 'https://wjhdsodlxekvhpahascs.supabase.co';
        const category = url.searchParams.get('category');
        const params = new URLSearchParams();
        params.set('select', 'id,category,title,body,sort_order,updated_at');
        params.set('published', 'eq.true');
        params.set('order', 'category.asc,sort_order.asc,updated_at.desc');
        if (category) params.append('category', `eq.${category}`);

        const r = await fetch(`${supabaseUrl}/rest/v1/help_articles?${params.toString()}`, {
          headers: {
            'apikey': env.SUPABASE_ANON_KEY || '',
          }
        });
        if (!r.ok) {
          const t = await r.text().catch(() => '');
          throw new Error(`Help articles fetch failed (${r.status}): ${t.slice(0, 200)}`);
        }
        const articles = await r.json();
        return new Response(JSON.stringify({ success: true, articles }), {
          status: 200,
          headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=300', ...corsHeaders }
        });
      } catch (err) {
        return new Response(JSON.stringify({ success: false, errMessage: err.message }), {
          status: 500,
          headers: { 'Content-Type': 'application/json', ...corsHeaders }
        });
      }
    }

    // ─── Admin: help articles CRUD ─────────────────────────────────────
    // GET    /api/admin/help/articles            — list ALL (incl unpublished)
    // POST   /api/admin/help/articles            — create
    // PATCH  /api/admin/help/articles/:id        — update
    // DELETE /api/admin/help/articles/:id        — hard delete
    //
    // All require is_admin=true on the caller. Body for POST/PATCH:
    //   { category, title, body, sort_order?, published? }
    //
    // Uses SUPABASE_SERVICE_ROLE_KEY so bypasses RLS — admin writes need
    // to reach the table even though no INSERT/UPDATE/DELETE policy
    // exists (RLS = denied for everyone except service role).
    // ─── Admin: dev log CRUD ───────────────────────────────────────────
    // GET    /api/admin/dev-log              — list all (most recent first)
    // POST   /api/admin/dev-log              — create entry
    // PATCH  /api/admin/dev-log/:id          — update entry
    // DELETE /api/admin/dev-log/:id          — delete entry
    //
    // Internal-only — admin verification required. Table RLS denies all
    // PostgREST access; worker uses SUPABASE_SERVICE_ROLE_KEY.
    //
    // Project policy: see docs/governance/DEV-LOG-POLICY.md. Daily entry expected on
    // every non-trivial activity day. Common tags: release, feature, fix,
    // refactor, devops, ops, ux, pricing, compliance, investigation.
    // ─── Admin: team chat (Claude as participant) ─────────────────────
    //
    // GET  /api/admin/team-chat/messages?since=<iso>&limit=<n>
    //   List recent messages. `since` enables polling for new messages
    //   without re-fetching the full history.
    //
    // POST /api/admin/team-chat/send
    //   Body: { body: string, thread_id?: string }
    //   1. Stores human message
    //   2. If body contains @claude OR is the first message in a thread,
    //      synchronously invokes Anthropic API with conversation history
    //      + project system prompt + read-only DB tools
    //   3. Stores Claude response
    //   4. Returns BOTH messages in order
    //
    // Cost control: per-user rate limit = 100 Claude invocations/day.
    // Counted via team_messages.author_id + triggered_claude=true.
    if (url.pathname.startsWith('/api/admin/team-chat/') &&
        (request.method === 'GET' || request.method === 'POST')) {
      const corsHeaders = { 'Access-Control-Allow-Origin': '*' };
      try {
        const supabaseUrl = env.SUPABASE_URL || 'https://wjhdsodlxekvhpahascs.supabase.co';
        const anonKey = env.SUPABASE_ANON_KEY || '';

        // §2026-05-31 fei — dual auth path:
        //   (A) Browser/Admin UI: Authorization: Bearer <Supabase admin JWT>
        //   (B) CLI/scripts:      X-Admin-API-Token: <CLAUDE_ADMIN_API_TOKEN>
        // (B) is for programmatic use (Claude tooling, ops scripts) so we
        // don't have to repeatedly extract a session JWT from the browser.
        // Token is stored as a Cloudflare Worker env secret — never in code,
        // never in git. Set via: `wrangler secret put CLAUDE_ADMIN_API_TOKEN`.
        //
        // Constant-time comparison to prevent timing oracle leaks (the token
        // is a long random string so a length-mismatch quick-out is fine, but
        // we still equal-string-compare via plain === after length guard —
        // this isn't ultra-sensitive crypto, just admin-tool token).
        const apiTokenHeader = (request.headers.get('X-Admin-API-Token') || '').trim();
        const envToken = (env.CLAUDE_ADMIN_API_TOKEN || '').trim();
        const apiTokenOk = !!(apiTokenHeader && envToken && apiTokenHeader.length === envToken.length && apiTokenHeader === envToken);

        let caller;
        let callerName;
        if (apiTokenOk) {
          // API-token path: synthesize a caller record. No real Supabase
          // user, so insert paths that need author_id must guard against null.
          caller = {
            id: null,
            email: 'admin-api-token@uvera.ai',
            user_metadata: { is_admin: true, name: 'Admin (API token)' },
          };
          callerName = 'Admin (API token)';
        } else {
          // JWT path (browser admin UI)
          const authHeader = request.headers.get('Authorization');
          if (!authHeader) throw new Error('Authorization required (Bearer JWT or X-Admin-API-Token)');
          const callerResp = await fetch(`${supabaseUrl}/auth/v1/user`, {
            headers: { 'Authorization': authHeader, 'apikey': anonKey }
          });
          if (!callerResp.ok) throw new Error('Could not verify caller');
          caller = await callerResp.json();
          if (caller.user_metadata?.is_admin !== true) {
            throw new Error('Admin access required');
          }
          callerName =
            caller.user_metadata?.name ||
            caller.user_metadata?.full_name ||
            caller.user_metadata?.username ||
            (caller.email ? caller.email.split('@')[0] : 'admin');
        }

        const supabaseAdmin = async (method, path, body, prefer) => {
          const r = await fetch(`${supabaseUrl}/rest/v1/${path}`, {
            method,
            headers: {
              'Authorization': `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
              'apikey': env.SUPABASE_SERVICE_ROLE_KEY,
              'Content-Type': 'application/json',
              ...(prefer ? { 'Prefer': prefer } : {}),
            },
            body: body ? JSON.stringify(body) : undefined,
          });
          if (!r.ok) {
            const t = await r.text().catch(() => '');
            throw new Error(`Supabase ${method} ${path} failed (${r.status}): ${t.slice(0, 200)}`);
          }
          if (r.status === 204) return null;
          try { return await r.json(); } catch (e) { return null; }
        };

        // ─── List messages ──
        if (request.method === 'GET' && url.pathname === '/api/admin/team-chat/messages') {
          const since = url.searchParams.get('since');
          const limit = Math.min(200, Math.max(1, parseInt(url.searchParams.get('limit') || '100', 10)));
          const params = new URLSearchParams();
          params.set('select', '*');
          params.set('order', 'created_at.asc');
          params.set('limit', String(limit));
          if (since) params.append('created_at', `gt.${since}`);
          const messages = await supabaseAdmin('GET', `team_messages?${params.toString()}`);
          return new Response(JSON.stringify({ success: true, messages: messages || [] }), {
            status: 200, headers: { 'Content-Type': 'application/json', ...corsHeaders }
          });
        }

        // §2026-05-31 fei — temp filter endpoint for "Leon's open issues" review.
        //   GET /api/admin/team-chat/filter?author=<name>&status=<status>&limit=<n>
        //   All params optional; defaults: limit=50, order by created_at DESC.
        //   author = case-insensitive substring match on author_display_name.
        //   status ∈ {open, in_progress, done, wont_do}.
        if (request.method === 'GET' && url.pathname === '/api/admin/team-chat/filter') {
          const authorQ = (url.searchParams.get('author') || '').trim();
          const statusQ = (url.searchParams.get('status') || '').trim();
          const limit = Math.min(200, Math.max(1, parseInt(url.searchParams.get('limit') || '50', 10)));
          const params = new URLSearchParams();
          params.set('select', 'id,author_display_name,body,thread_id,status,status_updated_at,created_at,mentions');
          params.set('order', 'created_at.desc');
          params.set('limit', String(limit));
          if (authorQ) params.append('author_display_name', `ilike.*${authorQ}*`);
          if (statusQ) params.append('status', `eq.${statusQ}`);
          const messages = await supabaseAdmin('GET', `team_messages?${params.toString()}`);
          return new Response(JSON.stringify({ success: true, count: messages?.length || 0, messages: messages || [] }), {
            status: 200, headers: { 'Content-Type': 'application/json', ...corsHeaders }
          });
        }

        // ─── Post message ──
        if (request.method === 'POST' && url.pathname === '/api/admin/team-chat/send') {
          // §2026-05-31 fei round-2 — API token path now CAN post messages.
          //   Identity attribution comes from X-Admin-Post-As header:
          //     fei|leon  → resolve real auth.users row by email (lookup)
          //     claude    → synthetic Claude author (author_kind='claude')
          //   Token already proves admin authority; Post-As just picks
          //   which admin's name appears on the message. Without the header
          //   we reject (can't silently default to one admin).
          let postAsKind = 'human';  // overridden below for 'claude'
          if (apiTokenOk && !caller.id) {
            const postAs = String(request.headers.get('X-Admin-Post-As') || '').trim().toLowerCase();
            const adminEmails = { fei: 'longvv.dev@gmail.com', leon: 'leonkkkk7@gmail.com' };
            if (postAs === 'claude') {
              caller = { id: null, email: 'claude@uvera.ai', user_metadata: {} };
              callerName = 'Claude';
              postAsKind = 'claude';
            } else if (adminEmails[postAs]) {
              const r = await fetch(
                `${supabaseUrl}/auth/v1/admin/users?email=${encodeURIComponent(adminEmails[postAs])}`,
                {
                  headers: {
                    'Authorization': `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
                    'apikey': env.SUPABASE_SERVICE_ROLE_KEY,
                  },
                }
              );
              if (!r.ok) throw new Error(`Failed to resolve X-Admin-Post-As=${postAs}: HTTP ${r.status}`);
              const data = await r.json();
              const u = (data.users || [])[0];
              if (!u) throw new Error(`No auth.users row for ${adminEmails[postAs]} — has that admin signed up yet?`);
              caller = { id: u.id, email: u.email, user_metadata: u.user_metadata || {} };
              callerName =
                u.user_metadata?.name
                || u.user_metadata?.full_name
                || u.user_metadata?.username
                || (u.email ? u.email.split('@')[0] : 'admin');
            } else {
              throw new Error('POST /send via API token requires X-Admin-Post-As header (allowed: fei | leon | claude)');
            }
          }
          const body = await request.json();
          const { body: messageBody, thread_id } = body;
          if (!messageBody || !String(messageBody).trim()) throw new Error('body required');
          const text = String(messageBody).trim();

          // Detect @ mentions (simple regex — anything matching @word)
          const mentions = Array.from(text.matchAll(/@(\w+)/g)).map(m => '@' + m[1].toLowerCase());
          const shouldInvokeClaude =
            mentions.includes('@claude') ||
            (!mentions.some(m => m !== '@claude'));  // no mentions = default to claude (free chat)

          // Daily rate limit on Claude invocations per user
          if (shouldInvokeClaude) {
            const dayStart = new Date();
            dayStart.setUTCHours(0, 0, 0, 0);
            const countParams = new URLSearchParams();
            countParams.set('author_id', `eq.${caller.id}`);
            countParams.set('triggered_claude', 'eq.true');
            countParams.set('created_at', `gte.${dayStart.toISOString()}`);
            countParams.set('select', 'id');
            const todayInvocations = await supabaseAdmin('GET', `team_messages?${countParams.toString()}`);
            if (Array.isArray(todayInvocations) && todayInvocations.length >= 100) {
              throw new Error('Daily Claude invocation limit reached (100). Try again tomorrow or ping fei to raise the cap.');
            }
          }

          // Insert the message. author_kind defaults to 'human' (regular admin
          //   post); becomes 'claude' when API token + X-Admin-Post-As=claude
          //   (rare — usually Claude posts via the @claude invocation flow
          //   below, not this direct path). 'system' is reserved for migration
          //   seed messages, never written here.
          const humanRows = await supabaseAdmin('POST', 'team_messages',
            {
              author_id: caller.id,
              author_kind: postAsKind,
              author_display_name: callerName,
              body: text,
              thread_id: thread_id || null,
              mentions,
              triggered_claude: shouldInvokeClaude,
            },
            'return=representation'
          );
          const humanMsg = humanRows?.[0];

          // If Claude isn't invoked, just return the human message
          if (!shouldInvokeClaude) {
            return new Response(JSON.stringify({
              success: true,
              messages: [humanMsg],
            }), { status: 200, headers: { 'Content-Type': 'application/json', ...corsHeaders }});
          }

          // Otherwise: invoke Claude with conversation history
          // ───────────────────────────────────────────────────────────
          if (!env.ANTHROPIC_API_KEY) {
            const errMsg = await supabaseAdmin('POST', 'team_messages',
              {
                author_id: null,
                author_kind: 'system',
                author_display_name: 'system',
                body: '⚠️ Anthropic API key not configured in Cloudflare env vars. Set `ANTHROPIC_API_KEY` to enable @claude responses.',
                thread_id: thread_id || null,
                mentions: [],
              },
              'return=representation'
            );
            return new Response(JSON.stringify({
              success: true, messages: [humanMsg, errMsg?.[0]],
            }), { status: 200, headers: { 'Content-Type': 'application/json', ...corsHeaders }});
          }

          // Build conversation history (last ~30 messages of same thread)
          const historyParams = new URLSearchParams();
          historyParams.set('select', 'author_kind,author_display_name,body,tool_calls,created_at');
          historyParams.set('order', 'created_at.desc');
          historyParams.set('limit', '30');
          if (thread_id) historyParams.append('thread_id', `eq.${thread_id}`);
          else historyParams.append('thread_id', 'is.null');
          const recentRows = await supabaseAdmin('GET', `team_messages?${historyParams.toString()}`);
          const history = (recentRows || []).reverse();  // chronological

          // Run Claude with tool loop
          const claudeResult = await invokeClaude(env, history, callerName);

          // Store Claude's reply
          const claudeRows = await supabaseAdmin('POST', 'team_messages',
            {
              author_id: null,
              author_kind: 'claude',
              author_display_name: 'Claude',
              body: claudeResult.text,
              thread_id: thread_id || null,
              mentions: [],
              tool_calls: claudeResult.toolCalls.length > 0 ? claudeResult.toolCalls : null,
            },
            'return=representation'
          );

          return new Response(JSON.stringify({
            success: true,
            messages: [humanMsg, claudeRows?.[0]],
          }), { status: 200, headers: { 'Content-Type': 'application/json', ...corsHeaders }});
        }

        // ─── Set message status ──
        // POST /api/admin/team-chat/set-status  body: { message_id, status }
        //   status ∈ {open, in_progress, done, wont_do}
        // Audit columns (status_updated_at) are bumped by DB trigger; we
        // explicitly set status_updated_by to the caller so we know who.
        if (request.method === 'POST' && url.pathname === '/api/admin/team-chat/set-status') {
          const body = await request.json();
          const messageId = body.message_id;
          const status = body.status;
          if (!messageId) throw new Error('message_id required');
          const VALID = ['open', 'in_progress', 'done', 'wont_do'];
          if (!VALID.includes(status)) {
            throw new Error(`status must be one of ${VALID.join(' / ')}`);
          }
          const updated = await supabaseAdmin(
            'PATCH',
            `team_messages?id=eq.${encodeURIComponent(messageId)}`,
            { status, status_updated_by: caller.id },
            'return=representation'
          );
          const row = Array.isArray(updated) ? updated[0] : updated;
          if (!row) throw new Error(`message_id ${messageId} not found`);
          console.log(`[team-chat] ${callerName} set ${messageId} → ${status}`);
          return new Response(JSON.stringify({ success: true, message: row }), {
            status: 200, headers: { 'Content-Type': 'application/json', ...corsHeaders }
          });
        }

        // ─── Mark messages as read ──
        // POST /api/admin/team-chat/mark-read  body: { message_ids: [string, ...] }
        // Idempotent: stamps read_by[<caller_id>] = now() for each id. If
        // already stamped, the caller's first-read timestamp is preserved
        // (we don't overwrite — earlier read time is the truth).
        if (request.method === 'POST' && url.pathname === '/api/admin/team-chat/mark-read') {
          const body = await request.json();
          const ids = Array.isArray(body.message_ids) ? body.message_ids : [];
          if (ids.length === 0) {
            return new Response(JSON.stringify({ success: true, updated: 0 }), {
              status: 200, headers: { 'Content-Type': 'application/json', ...corsHeaders }
            });
          }
          // Read the current read_by maps for each message in one call
          const inList = ids.map(id => encodeURIComponent(id)).join(',');
          const existing = await supabaseAdmin('GET',
            `team_messages?id=in.(${inList})&select=id,read_by`);
          const now = new Date().toISOString();
          let touched = 0;
          for (const m of (existing || [])) {
            const prev = m.read_by || {};
            // Don't overwrite an existing first-read timestamp
            if (prev[caller.id]) continue;
            const patched = { ...prev, [caller.id]: now };
            await supabaseAdmin('PATCH',
              `team_messages?id=eq.${encodeURIComponent(m.id)}`,
              { read_by: patched }
            );
            touched++;
          }
          return new Response(JSON.stringify({ success: true, updated: touched }), {
            status: 200, headers: { 'Content-Type': 'application/json', ...corsHeaders }
          });
        }

        throw new Error('Bad request');
      } catch (err) {
        console.error('[admin/team-chat]', err.message);
        return new Response(JSON.stringify({ success: false, errMessage: err.message }), {
          status: 500, headers: { 'Content-Type': 'application/json', ...corsHeaders }
        });
      }
    }

    if (url.pathname.startsWith('/api/admin/dev-log') &&
        (request.method === 'GET' || request.method === 'POST' || request.method === 'PATCH' || request.method === 'DELETE')) {
      const corsHeaders = { 'Access-Control-Allow-Origin': '*' };
      try {
        const supabaseUrl = env.SUPABASE_URL || 'https://wjhdsodlxekvhpahascs.supabase.co';
        const anonKey = env.SUPABASE_ANON_KEY || '';

        const authHeader = request.headers.get('Authorization');
        if (!authHeader) throw new Error('Authorization header required');
        const callerResp = await fetch(`${supabaseUrl}/auth/v1/user`, {
          headers: { 'Authorization': authHeader, 'apikey': anonKey }
        });
        if (!callerResp.ok) throw new Error('Could not verify caller');
        const caller = await callerResp.json();
        if (caller.user_metadata?.is_admin !== true) {
          throw new Error('Admin access required');
        }

        // Extract :id (PATCH/DELETE). /api/admin/dev-log/<id> → 4 parts
        const pathParts = url.pathname.split('/').filter(Boolean);
        const entryId = pathParts.length === 4 ? pathParts[3] : null;

        const supabaseAdmin = async (method, path, body, prefer) => {
          const r = await fetch(`${supabaseUrl}/rest/v1/${path}`, {
            method,
            headers: {
              'Authorization': `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
              'apikey': env.SUPABASE_SERVICE_ROLE_KEY,
              'Content-Type': 'application/json',
              ...(prefer ? { 'Prefer': prefer } : {}),
            },
            body: body ? JSON.stringify(body) : undefined,
          });
          if (!r.ok) {
            const t = await r.text().catch(() => '');
            throw new Error(`Supabase ${method} ${path} failed (${r.status}): ${t.slice(0, 200)}`);
          }
          if (r.status === 204) return null;
          try { return await r.json(); } catch (e) { return null; }
        };

        if (request.method === 'GET' && !entryId) {
          const entries = await supabaseAdmin('GET', 'dev_log_entries?select=*&order=entry_date.desc,created_at.desc');
          return new Response(JSON.stringify({ success: true, entries }), {
            status: 200, headers: { 'Content-Type': 'application/json', ...corsHeaders }
          });
        }

        if (request.method === 'POST') {
          const body = await request.json();
          const { entry_date, title, body: entryBody, authors, tags } = body;
          if (!entry_date) throw new Error('entry_date required (YYYY-MM-DD)');
          if (!title || !title.trim()) throw new Error('title required');
          if (!entryBody || !entryBody.trim()) throw new Error('body required');
          const payload = {
            entry_date,
            title: String(title).trim(),
            body: String(entryBody),
            authors: Array.isArray(authors) ? authors.map(a => String(a).trim()).filter(Boolean) : [],
            tags:    Array.isArray(tags)    ? tags.map(t => String(t).trim().toLowerCase()).filter(Boolean) : [],
            created_by: caller.id,
            updated_by: caller.id,
          };
          const rows = await supabaseAdmin('POST', 'dev_log_entries', payload, 'return=representation');
          return new Response(JSON.stringify({ success: true, entry: rows?.[0] || null }), {
            status: 200, headers: { 'Content-Type': 'application/json', ...corsHeaders }
          });
        }

        if (request.method === 'PATCH' && entryId) {
          const body = await request.json();
          const patch = { updated_by: caller.id };
          if (body.entry_date != null) patch.entry_date = body.entry_date;
          if (body.title != null)      patch.title = String(body.title).trim();
          if (body.body != null)       patch.body = String(body.body);
          if (Array.isArray(body.authors)) patch.authors = body.authors.map(a => String(a).trim()).filter(Boolean);
          if (Array.isArray(body.tags))    patch.tags = body.tags.map(t => String(t).trim().toLowerCase()).filter(Boolean);
          const rows = await supabaseAdmin(
            'PATCH',
            `dev_log_entries?id=eq.${encodeURIComponent(entryId)}`,
            patch,
            'return=representation'
          );
          if (!rows || rows.length === 0) throw new Error(`Entry ${entryId} not found`);
          return new Response(JSON.stringify({ success: true, entry: rows[0] }), {
            status: 200, headers: { 'Content-Type': 'application/json', ...corsHeaders }
          });
        }

        if (request.method === 'DELETE' && entryId) {
          await supabaseAdmin(
            'DELETE',
            `dev_log_entries?id=eq.${encodeURIComponent(entryId)}`,
            null,
            'return=minimal'
          );
          return new Response(JSON.stringify({ success: true }), {
            status: 200, headers: { 'Content-Type': 'application/json', ...corsHeaders }
          });
        }

        throw new Error('Bad request');
      } catch (err) {
        console.error('[admin/dev-log]', err.message);
        return new Response(JSON.stringify({ success: false, errMessage: err.message }), {
          status: 500, headers: { 'Content-Type': 'application/json', ...corsHeaders }
        });
      }
    }

    if (url.pathname.startsWith('/api/admin/help/articles') &&
        (request.method === 'GET' || request.method === 'POST' || request.method === 'PATCH' || request.method === 'DELETE')) {
      const corsHeaders = { 'Access-Control-Allow-Origin': '*' };
      try {
        const supabaseUrl = env.SUPABASE_URL || 'https://wjhdsodlxekvhpahascs.supabase.co';
        const anonKey = env.SUPABASE_ANON_KEY || '';

        // Verify admin
        const authHeader = request.headers.get('Authorization');
        if (!authHeader) throw new Error('Authorization header required');
        const callerResp = await fetch(`${supabaseUrl}/auth/v1/user`, {
          headers: { 'Authorization': authHeader, 'apikey': anonKey }
        });
        if (!callerResp.ok) throw new Error('Could not verify caller');
        const caller = await callerResp.json();
        if (caller.user_metadata?.is_admin !== true) {
          throw new Error('Admin access required');
        }

        // Extract :id if present (PATCH/DELETE)
        const pathParts = url.pathname.split('/').filter(Boolean);
        // /api/admin/help/articles/<id>  →  pathParts = ['api','admin','help','articles','<id>']
        const articleId = pathParts.length === 5 ? pathParts[4] : null;

        const supabaseAdmin = async (method, path, body, prefer) => {
          const r = await fetch(`${supabaseUrl}/rest/v1/${path}`, {
            method,
            headers: {
              'Authorization': `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
              'apikey': env.SUPABASE_SERVICE_ROLE_KEY,
              'Content-Type': 'application/json',
              ...(prefer ? { 'Prefer': prefer } : {}),
            },
            body: body ? JSON.stringify(body) : undefined,
          });
          if (!r.ok) {
            const t = await r.text().catch(() => '');
            throw new Error(`Supabase ${method} ${path} failed (${r.status}): ${t.slice(0, 200)}`);
          }
          // PATCH/DELETE with Prefer: return=minimal returns no body
          if (r.status === 204) return null;
          try { return await r.json(); } catch (e) { return null; }
        };

        if (request.method === 'GET' && !articleId) {
          // List all — admin sees unpublished too
          const articles = await supabaseAdmin('GET', 'help_articles?select=*&order=category.asc,sort_order.asc');
          return new Response(JSON.stringify({ success: true, articles }), {
            status: 200,
            headers: { 'Content-Type': 'application/json', ...corsHeaders }
          });
        }

        if (request.method === 'POST') {
          const body = await request.json();
          const { category, title, body: articleBody, sort_order, published } = body;
          if (!category || !category.trim()) throw new Error('category is required');
          if (!title || !title.trim())       throw new Error('title is required');
          if (!articleBody || !articleBody.trim()) throw new Error('body is required');
          const payload = {
            category: String(category).trim().toLowerCase(),
            title: String(title).trim(),
            body: String(articleBody),
            sort_order: Number.isFinite(Number(sort_order)) ? Number(sort_order) : 0,
            published: published !== false,  // default true
            created_by: caller.id,
            updated_by: caller.id,
          };
          const rows = await supabaseAdmin('POST', 'help_articles', payload, 'return=representation');
          return new Response(JSON.stringify({ success: true, article: rows?.[0] || null }), {
            status: 200,
            headers: { 'Content-Type': 'application/json', ...corsHeaders }
          });
        }

        if (request.method === 'PATCH' && articleId) {
          const body = await request.json();
          const patch = { updated_by: caller.id };
          if (body.category != null)   patch.category = String(body.category).trim().toLowerCase();
          if (body.title != null)      patch.title = String(body.title).trim();
          if (body.body != null)       patch.body = String(body.body);
          if (body.sort_order != null) patch.sort_order = Number(body.sort_order) || 0;
          if (typeof body.published === 'boolean') patch.published = body.published;
          const rows = await supabaseAdmin(
            'PATCH',
            `help_articles?id=eq.${encodeURIComponent(articleId)}`,
            patch,
            'return=representation'
          );
          if (!rows || rows.length === 0) throw new Error(`Article ${articleId} not found`);
          return new Response(JSON.stringify({ success: true, article: rows[0] }), {
            status: 200,
            headers: { 'Content-Type': 'application/json', ...corsHeaders }
          });
        }

        if (request.method === 'DELETE' && articleId) {
          await supabaseAdmin(
            'DELETE',
            `help_articles?id=eq.${encodeURIComponent(articleId)}`,
            null,
            'return=minimal'
          );
          return new Response(JSON.stringify({ success: true }), {
            status: 200,
            headers: { 'Content-Type': 'application/json', ...corsHeaders }
          });
        }

        throw new Error('Bad request');
      } catch (err) {
        console.error('[admin/help/articles]', err.message);
        return new Response(JSON.stringify({ success: false, errMessage: err.message }), {
          status: 500,
          headers: { 'Content-Type': 'application/json', ...corsHeaders }
        });
      }
    }

    if (url.pathname === '/api/admin/email/test' && request.method === 'POST') {
      const corsHeaders = { 'Access-Control-Allow-Origin': '*' };
      try {
        const supabaseUrl = env.SUPABASE_URL || 'https://wjhdsodlxekvhpahascs.supabase.co';
        const anonKey = env.SUPABASE_ANON_KEY || '';

        const authHeader = request.headers.get('Authorization');
        if (!authHeader) throw new Error('Authorization header required');
        const callerResp = await fetch(`${supabaseUrl}/auth/v1/user`, {
          headers: { 'Authorization': authHeader, 'apikey': anonKey }
        });
        if (!callerResp.ok) throw new Error('Could not verify caller');
        const caller = await callerResp.json();
        if (caller.user_metadata?.is_admin !== true) {
          throw new Error('Admin access required');
        }

        const body = await request.json();
        const { to, subject, body: messageBody } = body;
        if (!to) throw new Error('to is required');

        const { html, text } = renderEmail({
          heading: subject || 'UVERA email pipeline test',
          paragraphs: [
            messageBody || 'If you received this, the Resend integration is working correctly.',
            `Sent from ${env.FROM_EMAIL || 'noreply@send.uvera.ai'} via Resend HTTP API.`,
            `Triggered by: ${caller.email || caller.id}`,
          ],
          footerNote: 'This is a one-off test email triggered from the admin dashboard.',
        });
        const result = await sendEmail(env, {
          to,
          subject: subject || 'UVERA email pipeline test',
          html,
          text,
          tags: [{ name: 'category', value: 'admin_test' }],
        });

        if (!result.ok) throw new Error(result.error);

        return new Response(JSON.stringify({ success: true, resendId: result.id }), {
          status: 200,
          headers: { 'Content-Type': 'application/json', ...corsHeaders }
        });
      } catch (err) {
        console.error('[admin/email/test]', err.message);
        return new Response(JSON.stringify({ success: false, errMessage: err.message }), {
          status: 500,
          headers: { 'Content-Type': 'application/json', ...corsHeaders }
        });
      }
    }

    // ─── Admin: enriched orders list ────────────────────────────────────
    // GET /api/admin/orders/list?search=&status=&from=&to=&voided=&page=&perPage=
    // Returns orders joined with auth.users (email/name) so the admin
    // OrdersView doesn't have to display raw UUIDs. Supports server-side
    // filters (search, status, date range, include-voided) and pagination.
    //
    // - search: matches orderNo, subject, or user email (substring, case-insensitive)
    // - status: 'paid' (status=1), 'pending' (status=0), 'all' (default)
    // - from / to: ISO date strings (createdAt range)
    // - voided: 'include' to show voided rows; default omits them
    // - page / perPage: 1-indexed pagination, max perPage=200
    //
    // Each enriched order also carries `source = 'stripe' | 'manual'` based
    // on whether orderNo starts with 'in_' (Stripe invoice ID format).
    if (url.pathname === '/api/admin/orders/list' && request.method === 'GET') {
      const corsHeaders = { 'Access-Control-Allow-Origin': '*' };
      try {
        const supabaseUrl = env.SUPABASE_URL || 'https://wjhdsodlxekvhpahascs.supabase.co';
        const anonKey = env.SUPABASE_ANON_KEY || '';

        // Verify caller is admin
        const authHeader = request.headers.get('Authorization');
        if (!authHeader) throw new Error('Authorization header required');
        const callerResp = await fetch(`${supabaseUrl}/auth/v1/user`, {
          headers: { 'Authorization': authHeader, 'apikey': anonKey }
        });
        if (!callerResp.ok) throw new Error('Could not verify caller');
        const caller = await callerResp.json();
        if (caller.user_metadata?.is_admin !== true) {
          throw new Error('Admin access required');
        }

        const search       = (url.searchParams.get('search') || '').trim();
        const status       = (url.searchParams.get('status') || 'all').trim();
        const from         = url.searchParams.get('from');
        const to           = url.searchParams.get('to');
        const voidedMode   = (url.searchParams.get('voided') || 'exclude').trim();
        const refundedMode = (url.searchParams.get('refunded') || 'include').trim();  // include by default — refunded is interesting
        const page         = Math.max(1, parseInt(url.searchParams.get('page') || '1', 10));
        const perPage      = Math.min(200, Math.max(1, parseInt(url.searchParams.get('perPage') || '50', 10)));

        // Build PostgREST query. We can't easily search across user email at
        // the DB layer (orders has no FK index to auth.users), so search by
        // email is applied client-side after enrichment when search term
        // doesn't match any orderNo/subject.
        const params = new URLSearchParams();
        params.set('select', '*');
        params.set('order', 'createdAt.desc');
        if (status === 'paid')     params.append('status', 'eq.1');
        if (status === 'pending')  params.append('status', 'eq.0');
        if (status === 'refunded') params.append('refunded_at', 'not.is.null');  // overrides refundedMode
        if (from) params.append('createdAt', `gte.${new Date(from).toISOString()}`);
        if (to)   params.append('createdAt', `lte.${new Date(to).toISOString()}`);
        if (voidedMode !== 'include') params.append('voided_at', 'is.null');
        if (refundedMode === 'exclude' && status !== 'refunded') params.append('refunded_at', 'is.null');

        // Search across orderNo + subject (substring). User email search is
        // resolved post-enrichment so the user can paste an email directly.
        if (search) {
          // Escape PostgREST special chars: '*', '"', ',', '(', ')'
          const safe = search.replace(/[*",()]/g, '');
          if (safe) params.append('or', `(orderNo.ilike.*${safe}*,subject.ilike.*${safe}*)`);
        }

        // Pagination via Range header (PostgREST honors it; cheaper than offset/limit query params)
        const rangeStart = (page - 1) * perPage;
        const rangeEnd   = rangeStart + perPage - 1;

        const ordersResp = await fetch(`${supabaseUrl}/rest/v1/orders?${params.toString()}`, {
          headers: {
            'Authorization': `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
            'apikey': env.SUPABASE_SERVICE_ROLE_KEY,
            'Range-Unit': 'items',
            'Range': `${rangeStart}-${rangeEnd}`,
            'Prefer': 'count=exact',
          }
        });
        if (!ordersResp.ok) {
          const t = await ordersResp.text().catch(() => '');
          throw new Error(`Orders fetch failed (${ordersResp.status}): ${t.slice(0, 200)}`);
        }
        const orders = await ordersResp.json();
        // Content-Range header looks like "0-49/123" — total is after the slash
        const contentRange = ordersResp.headers.get('Content-Range') || '';
        const total = parseInt(contentRange.split('/')[1] || '0', 10);

        // Enrich with user email/name. Batch unique userIds, parallel fetch.
        const uniqueUserIds = [...new Set(orders.map(o => o.userId).filter(Boolean))];
        const userMap = new Map();
        await Promise.all(uniqueUserIds.map(async (uid) => {
          try {
            const r = await fetch(`${supabaseUrl}/auth/v1/admin/users/${uid}`, {
              headers: {
                'Authorization': `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
                'apikey': env.SUPABASE_SERVICE_ROLE_KEY,
              }
            });
            if (r.ok) {
              const u = await r.json();
              userMap.set(uid, {
                email: u.email,
                name: u.user_metadata?.name || u.user_metadata?.full_name || null,
                avatar_url: u.user_metadata?.avatar_url || null,
              });
            }
          } catch (e) { /* leave undefined → row falls back to raw uuid */ }
        }));

        // Voiders + refunders (separate batch — usually a small set, often the same admin)
        const adminIds = [...new Set([
          ...orders.map(o => o.voided_by).filter(Boolean),
          ...orders.map(o => o.refunded_by).filter(Boolean),
        ])];
        const adminMap = new Map();
        await Promise.all(adminIds.map(async (uid) => {
          if (userMap.has(uid)) {
            adminMap.set(uid, userMap.get(uid));
            return;
          }
          try {
            const r = await fetch(`${supabaseUrl}/auth/v1/admin/users/${uid}`, {
              headers: {
                'Authorization': `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
                'apikey': env.SUPABASE_SERVICE_ROLE_KEY,
              }
            });
            if (r.ok) {
              const u = await r.json();
              adminMap.set(uid, { email: u.email, name: u.user_metadata?.name || null });
            }
          } catch (e) { /* skip */ }
        }));

        // Source classifier:
        //   in_xxx → stripe (subscription invoice)
        //   cs_xxx → stripe (one-time Checkout Session, e.g. Lite)
        //   else  → manual (admin-entered ORD-xxx)
        const classifySource = (orderNo) => {
          if (typeof orderNo !== 'string') return 'manual';
          if (orderNo.startsWith('in_')) return 'stripe';
          if (orderNo.startsWith('cs_')) return 'stripe';
          return 'manual';
        };

        let enriched = orders.map(o => ({
          ...o,
          source: classifySource(o.orderNo),
          userEmail: userMap.get(o.userId)?.email || null,
          userName:  userMap.get(o.userId)?.name  || null,
          userAvatar: userMap.get(o.userId)?.avatar_url || null,
          voidedByEmail:   o.voided_by   ? (adminMap.get(o.voided_by)?.email   || null) : null,
          refundedByEmail: o.refunded_by ? (adminMap.get(o.refunded_by)?.email || null) : null,
        }));

        // Post-enrichment email search: if the search term matches an email
        // but didn't match any row's orderNo/subject, broaden to email match.
        if (search && enriched.length === 0 && /@/.test(search)) {
          const reParams = new URLSearchParams();
          reParams.set('select', '*');
          reParams.set('order', 'createdAt.desc');
          if (voidedMode !== 'include') reParams.append('voided_at', 'is.null');
          // No other filters — we'll match email client-side
          const allResp = await fetch(`${supabaseUrl}/rest/v1/orders?${reParams.toString()}`, {
            headers: {
              'Authorization': `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
              'apikey': env.SUPABASE_SERVICE_ROLE_KEY,
              'Range-Unit': 'items',
              'Range': '0-499',
            }
          });
          if (allResp.ok) {
            const all = await allResp.json();
            const allUids = [...new Set(all.map(o => o.userId).filter(Boolean))];
            await Promise.all(allUids.map(async (uid) => {
              if (userMap.has(uid)) return;
              try {
                const r = await fetch(`${supabaseUrl}/auth/v1/admin/users/${uid}`, {
                  headers: {
                    'Authorization': `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
                    'apikey': env.SUPABASE_SERVICE_ROLE_KEY,
                  }
                });
                if (r.ok) {
                  const u = await r.json();
                  userMap.set(uid, { email: u.email, name: u.user_metadata?.name || null, avatar_url: u.user_metadata?.avatar_url || null });
                }
              } catch (e) {}
            }));
            const lower = search.toLowerCase();
            enriched = all
              .filter(o => userMap.get(o.userId)?.email?.toLowerCase().includes(lower))
              .map(o => ({
                ...o,
                source: classifySource(o.orderNo),
                userEmail: userMap.get(o.userId)?.email || null,
                userName: userMap.get(o.userId)?.name || null,
                userAvatar: userMap.get(o.userId)?.avatar_url || null,
                voidedByEmail:   o.voided_by   ? (adminMap.get(o.voided_by)?.email   || null) : null,
                refundedByEmail: o.refunded_by ? (adminMap.get(o.refunded_by)?.email || null) : null,
              }));
          }
        }

        return new Response(JSON.stringify({
          success: true,
          orders: enriched,
          page,
          perPage,
          total,
        }), {
          status: 200,
          headers: { 'Content-Type': 'application/json', ...corsHeaders }
        });
      } catch (err) {
        console.error('[admin/orders/list]', err.message);
        return new Response(JSON.stringify({ success: false, errMessage: err.message }), {
          status: 500,
          headers: { 'Content-Type': 'application/json', ...corsHeaders }
        });
      }
    }

    // ─── Admin: void / unvoid an order (soft-delete with audit) ─────────
    // POST /api/admin/orders/void
    // Body: { orderNo, void: true|false, reason?: string }
    //
    // Replaces the legacy hard-delete flow which destroyed audit data.
    // Voiding is reversible (set void:false to restore).
    if (url.pathname === '/api/admin/orders/void' && request.method === 'POST') {
      const corsHeaders = { 'Access-Control-Allow-Origin': '*' };
      try {
        const supabaseUrl = env.SUPABASE_URL || 'https://wjhdsodlxekvhpahascs.supabase.co';
        const anonKey = env.SUPABASE_ANON_KEY || '';

        const authHeader = request.headers.get('Authorization');
        if (!authHeader) throw new Error('Authorization header required');
        const callerResp = await fetch(`${supabaseUrl}/auth/v1/user`, {
          headers: { 'Authorization': authHeader, 'apikey': anonKey }
        });
        if (!callerResp.ok) throw new Error('Could not verify caller');
        const caller = await callerResp.json();
        if (caller.user_metadata?.is_admin !== true) {
          throw new Error('Admin access required');
        }

        const body = await request.json();
        const { orderNo, void: shouldVoid, reason } = body;
        if (!orderNo) throw new Error('orderNo is required');
        if (typeof shouldVoid !== 'boolean') throw new Error('void (boolean) is required');
        if (shouldVoid && (!reason || !String(reason).trim())) {
          throw new Error('reason is required when voiding');
        }

        const patch = shouldVoid
          ? {
              voided_at: new Date().toISOString(),
              voided_by: caller.id,
              voided_reason: String(reason).trim().slice(0, 500),
            }
          : {
              voided_at: null,
              voided_by: null,
              voided_reason: null,
            };

        const r = await fetch(
          `${supabaseUrl}/rest/v1/orders?orderNo=eq.${encodeURIComponent(orderNo)}`,
          {
            method: 'PATCH',
            headers: {
              'Authorization': `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
              'apikey': env.SUPABASE_SERVICE_ROLE_KEY,
              'Content-Type': 'application/json',
              'Prefer': 'return=representation',
            },
            body: JSON.stringify(patch),
          }
        );
        if (!r.ok) {
          const t = await r.text().catch(() => '');
          throw new Error(`Order update failed (${r.status}): ${t.slice(0, 200)}`);
        }
        const rows = await r.json();
        if (!Array.isArray(rows) || rows.length === 0) {
          throw new Error(`Order ${orderNo} not found`);
        }

        return new Response(JSON.stringify({ success: true, order: rows[0] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json', ...corsHeaders }
        });
      } catch (err) {
        console.error('[admin/orders/void]', err.message);
        return new Response(JSON.stringify({ success: false, errMessage: err.message }), {
          status: 500,
          headers: { 'Content-Type': 'application/json', ...corsHeaders }
        });
      }
    }

    // ─── Admin: refund-decision context ─────────────────────────────────
    // GET /api/admin/orders/refund-context?orderNo=in_xxx
    // Returns abuse-detection signals so admin can make an informed refund
    // decision: how many tokens granted by this order, how many the user
    // has consumed since (via generation_logs.credits_charged sum), the
    // user's current balance, and whether they've refunded orders before.
    //
    // Risk levels (used for the modal's color-coded warning):
    //   low    — <30% of granted tokens consumed, no prior refunds
    //   medium — 30-70% consumed OR 1 prior refund
    //   high   — >70% consumed OR 2+ prior refunds (likely abuse)
    //
    // The admin still has full authority to refund regardless — this is
    // a signal, not a block.
    // ─── Admin: full order detail (deep Stripe fetch for the drawer) ───
    // GET /api/admin/orders/details?orderNo=in_xxx | cs_xxx | ORD-xxx
    //
    // Returns everything available about an order, joining our DB row
    // with live Stripe data fetched on demand:
    //   - Our orders row + voided/refunded audit fields
    //   - User profile (email, name, avatar)
    //   - Stripe customer (email, name, address, default payment method)
    //   - For invoice (in_xxx): full invoice with line items + payment_intent
    //   - For checkout session (cs_xxx): session + payment_intent + charge
    //   - Payment method details (brand, last4, exp, country)
    //   - Refund list (refunds via Stripe API for the underlying charge)
    //   - Receipt URL
    //
    // Manual orders (orderNo not in_xxx/cs_xxx) just return DB row + user
    // info — no Stripe data exists for those.
    //
    // Worker uses STRIPE_SECRET_KEY (live mode) for Stripe API calls and
    // SUPABASE_SERVICE_ROLE_KEY for our DB queries; nothing here should
    // ever leak to a non-admin caller (admin verification at top).
    if (url.pathname === '/api/admin/orders/details' && request.method === 'GET') {
      const corsHeaders = { 'Access-Control-Allow-Origin': '*' };
      try {
        const supabaseUrl = env.SUPABASE_URL || 'https://wjhdsodlxekvhpahascs.supabase.co';
        const anonKey = env.SUPABASE_ANON_KEY || '';

        const authHeader = request.headers.get('Authorization');
        if (!authHeader) throw new Error('Authorization header required');
        const callerResp = await fetch(`${supabaseUrl}/auth/v1/user`, {
          headers: { 'Authorization': authHeader, 'apikey': anonKey }
        });
        if (!callerResp.ok) throw new Error('Could not verify caller');
        const caller = await callerResp.json();
        if (caller.user_metadata?.is_admin !== true) {
          throw new Error('Admin access required');
        }

        const orderNo = url.searchParams.get('orderNo');
        if (!orderNo) throw new Error('orderNo required');

        // 1. Order row from our DB
        const orderResp = await fetch(
          `${supabaseUrl}/rest/v1/orders?orderNo=eq.${encodeURIComponent(orderNo)}&select=*`,
          {
            headers: {
              'Authorization': `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
              'apikey': env.SUPABASE_SERVICE_ROLE_KEY,
            }
          }
        );
        if (!orderResp.ok) throw new Error(`Order lookup failed (${orderResp.status})`);
        const orderRows = await orderResp.json();
        if (!Array.isArray(orderRows) || orderRows.length === 0) {
          throw new Error(`Order ${orderNo} not found`);
        }
        const order = orderRows[0];

        // 2. User info (best-effort — keep going even if it fails)
        let userInfo = null;
        if (order.userId) {
          try {
            const r = await fetch(`${supabaseUrl}/auth/v1/admin/users/${order.userId}`, {
              headers: {
                'Authorization': `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
                'apikey': env.SUPABASE_SERVICE_ROLE_KEY,
              }
            });
            if (r.ok) {
              const u = await r.json();
              // §2026-05-29 — authoritative credits from user_credits.
              let bal = u.user_metadata?.credits || 0;
              try {
                const bResp = await fetch(
                  `${supabaseUrl}/rest/v1/user_credits?select=balance&user_id=eq.${encodeURIComponent(order.userId)}&limit=1`,
                  { headers: { 'Authorization': `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`, 'apikey': env.SUPABASE_SERVICE_ROLE_KEY } }
                );
                if (bResp.ok) {
                  const bRows = await bResp.json();
                  if (Array.isArray(bRows) && bRows.length > 0) bal = Number(bRows[0].balance) || 0;
                }
              } catch (e) { /* keep meta fallback */ }
              userInfo = {
                id: u.id,
                email: u.email,
                name: u.user_metadata?.name || u.user_metadata?.full_name || null,
                avatar_url: u.user_metadata?.avatar_url || null,
                tier: u.user_metadata?.tier || 'free',
                credits: bal,
                created_at: u.created_at,
              };
            }
          } catch (e) { /* skip */ }
        }

        // 3. Stripe deep fetch (only for Stripe-sourced orders)
        let stripe = null;
        const isStripeOrder = typeof orderNo === 'string' && (orderNo.startsWith('in_') || orderNo.startsWith('cs_'));
        if (isStripeOrder && env.STRIPE_SECRET_KEY) {
          stripe = await fetchStripeOrderDetails(env, orderNo);
        }

        // 4. Voider / refunder profile lookups (denormalized for UI)
        const adminIds = [order.voided_by, order.refunded_by].filter(Boolean);
        const adminMap = {};
        for (const aid of [...new Set(adminIds)]) {
          try {
            const r = await fetch(`${supabaseUrl}/auth/v1/admin/users/${aid}`, {
              headers: {
                'Authorization': `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
                'apikey': env.SUPABASE_SERVICE_ROLE_KEY,
              }
            });
            if (r.ok) {
              const u = await r.json();
              adminMap[aid] = { email: u.email, name: u.user_metadata?.name || null };
            }
          } catch (e) { /* skip */ }
        }

        return new Response(JSON.stringify({
          success: true,
          order,
          user: userInfo,
          stripe,
          voidedBy: order.voided_by ? adminMap[order.voided_by] : null,
          refundedBy: order.refunded_by ? adminMap[order.refunded_by] : null,
        }), {
          status: 200,
          headers: { 'Content-Type': 'application/json', ...corsHeaders }
        });
      } catch (err) {
        console.error('[admin/orders/details]', err.message);
        return new Response(JSON.stringify({ success: false, errMessage: err.message }), {
          status: 500,
          headers: { 'Content-Type': 'application/json', ...corsHeaders }
        });
      }
    }

    if (url.pathname === '/api/admin/orders/refund-context' && request.method === 'GET') {
      const corsHeaders = { 'Access-Control-Allow-Origin': '*' };
      try {
        const supabaseUrl = env.SUPABASE_URL || 'https://wjhdsodlxekvhpahascs.supabase.co';
        const anonKey = env.SUPABASE_ANON_KEY || '';

        const authHeader = request.headers.get('Authorization');
        if (!authHeader) throw new Error('Authorization header required');
        const callerResp = await fetch(`${supabaseUrl}/auth/v1/user`, {
          headers: { 'Authorization': authHeader, 'apikey': anonKey }
        });
        if (!callerResp.ok) throw new Error('Could not verify caller');
        const caller = await callerResp.json();
        if (caller.user_metadata?.is_admin !== true) {
          throw new Error('Admin access required');
        }

        const orderNo = url.searchParams.get('orderNo');
        if (!orderNo) throw new Error('orderNo is required');

        // 1. Fetch the order
        const orderLookup = await fetch(
          `${supabaseUrl}/rest/v1/orders?orderNo=eq.${encodeURIComponent(orderNo)}&select=*`,
          {
            headers: {
              'Authorization': `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
              'apikey': env.SUPABASE_SERVICE_ROLE_KEY,
            }
          }
        );
        if (!orderLookup.ok) throw new Error(`Order lookup failed (${orderLookup.status})`);
        const orderRows = await orderLookup.json();
        if (!Array.isArray(orderRows) || orderRows.length === 0) {
          throw new Error(`Order ${orderNo} not found`);
        }
        const order = orderRows[0];

        // 2. Estimate tokens granted by THIS order from subject pattern.
        // Subject format: "UVERA <tier> ..." (set by webhook on insert).
        const subject = String(order.subject || '');
        const tierMatch = subject.match(/UVERA\s+(\w+)/i);
        const tier = tierMatch ? tierMatch[1].toLowerCase() : null;
        const tierToTokens = { lite: 100, starter: 500, creator: 1500, studio: 5000 };
        const grantedTokens = tierToTokens[tier] || 0;

        // 3. Token usage since order createdAt — sum of credits_charged for
        // all generation_logs rows where started_at > orders.createdAt.
        // PostgREST doesn't have SUM() in select directly, so we fetch the
        // rows and sum client-side (capped at 1000 to bound cost).
        let usageTokens = 0;
        let generationCount = 0;
        if (order.userId && order.createdAt) {
          const logsResp = await fetch(
            `${supabaseUrl}/rest/v1/generation_logs?` +
            `user_id=eq.${encodeURIComponent(order.userId)}` +
            `&started_at=gte.${encodeURIComponent(order.createdAt)}` +
            // §A Phase 1.5 dual-read: select both, prefer tokens_charged
            `&select=credits_charged,tokens_charged,started_at` +
            `&limit=1000`,
            {
              headers: {
                'Authorization': `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
                'apikey': env.SUPABASE_SERVICE_ROLE_KEY,
              }
            }
          );
          if (logsResp.ok) {
            const logs = await logsResp.json();
            generationCount = logs.length;
            usageTokens = logs.reduce((sum, l) => sum + (Number(l.tokens_charged ?? l.credits_charged) || 0), 0);
          }
        }

        // 4. Current credit balance — authoritative from user_credits
        //    (§2026-05-29; user_metadata.credits is only a rollback mirror).
        let currentBalance = 0;
        let userEmail = null;
        if (order.userId) {
          const userResp = await fetch(`${supabaseUrl}/auth/v1/admin/users/${order.userId}`, {
            headers: {
              'Authorization': `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
              'apikey': env.SUPABASE_SERVICE_ROLE_KEY,
            }
          });
          if (userResp.ok) {
            const userObj = await userResp.json();
            currentBalance = Number(userObj.user_metadata?.credits) || 0;
            userEmail = userObj.email || null;
          }
          const balResp = await fetch(
            `${supabaseUrl}/rest/v1/user_credits?select=balance&user_id=eq.${encodeURIComponent(order.userId)}&limit=1`,
            {
              headers: {
                'Authorization': `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
                'apikey': env.SUPABASE_SERVICE_ROLE_KEY,
              }
            }
          );
          if (balResp.ok) {
            const balRows = await balResp.json();
            if (Array.isArray(balRows) && balRows.length > 0) currentBalance = Number(balRows[0].balance) || 0;
          }
        }

        // 5. Prior refund count for this user — flag serial refunders.
        let priorRefunds = 0;
        if (order.userId) {
          const refundsResp = await fetch(
            `${supabaseUrl}/rest/v1/orders?` +
            `userId=eq.${encodeURIComponent(order.userId)}` +
            `&refunded_at=not.is.null` +
            `&orderNo=neq.${encodeURIComponent(orderNo)}` +  // exclude current order
            `&select=orderNo`,
            {
              headers: {
                'Authorization': `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
                'apikey': env.SUPABASE_SERVICE_ROLE_KEY,
                'Prefer': 'count=exact',
                'Range-Unit': 'items',
                'Range': '0-0',  // we only need the count
              }
            }
          );
          if (refundsResp.ok) {
            const range = refundsResp.headers.get('Content-Range') || '';
            priorRefunds = parseInt(range.split('/')[1] || '0', 10);
          }
        }

        // 6. Compute risk level + suggested refund.
        const usagePct = grantedTokens > 0 ? (usageTokens / grantedTokens) : 0;
        let riskLevel = 'low';
        const reasons = [];
        if (usagePct >= 0.70) {
          riskLevel = 'high';
          reasons.push(`User has consumed ${Math.round(usagePct * 100)}% of granted tokens`);
        } else if (usagePct >= 0.30) {
          riskLevel = 'medium';
          reasons.push(`User has consumed ${Math.round(usagePct * 100)}% of granted tokens`);
        }
        if (priorRefunds >= 2) {
          riskLevel = 'high';
          reasons.push(`User has ${priorRefunds} prior refunds — possible serial refund pattern`);
        } else if (priorRefunds === 1 && riskLevel === 'low') {
          riskLevel = 'medium';
          reasons.push(`User has 1 prior refund`);
        }

        // Pro-rated refund suggestion: refund only the unused portion.
        // (Tokens already consumed cost UVERA real $$ in API + storage fees.)
        const unusedPct = Math.max(0, 1 - usagePct);
        const suggestedRefundUsd = Number((Number(order.amount || 0) * unusedPct).toFixed(2));

        return new Response(JSON.stringify({
          success: true,
          context: {
            orderNo,
            orderAmount: Number(order.amount || 0),
            orderCreatedAt: order.createdAt,
            tier,
            grantedTokens,
            usageTokens,
            usagePct: Number(usagePct.toFixed(3)),
            generationCount,
            currentBalance,
            priorRefunds,
            riskLevel,
            riskReasons: reasons,
            suggestedRefundUsd,
            suggestedRefundReason: usagePct >= 0.30
              ? `Pro-rate to unused portion only: ${Math.round(unusedPct * 100)}% × $${order.amount} = $${suggestedRefundUsd}`
              : 'Full refund OK based on usage signals',
            userEmail,
          },
        }), {
          status: 200,
          headers: { 'Content-Type': 'application/json', ...corsHeaders }
        });
      } catch (err) {
        console.error('[admin/orders/refund-context]', err.message);
        return new Response(JSON.stringify({ success: false, errMessage: err.message }), {
          status: 500,
          headers: { 'Content-Type': 'application/json', ...corsHeaders }
        });
      }
    }

    // ─── Admin: refund an order via Stripe Refunds API ──────────────────
    // POST /api/admin/orders/refund
    // Body: {
    //   orderNo,                   // in_xxx (subscription invoice) or cs_xxx (one-time session)
    //   amount?,                   // USD; omit for full refund
    //   reason: string,            // free-form (required)
    //   stripeReason?: string,     // 'duplicate' | 'fraudulent' | 'requested_by_customer'
    //   deductCredits?: number,    // tokens to subtract from user (optional, default 0)
    // }
    //
    // Calls Stripe POST /v1/refunds with the payment_intent looked up from
    // the Stripe object that owns this order. Manual orders (orderNo not
    // matching in_*/cs_*) are rejected — those have no corresponding Stripe
    // payment to refund. For those, use Void instead.
    //
    // After Stripe accepts the refund, writes audit columns to orders and
    // (optionally) deducts credits from user_metadata.
    if (url.pathname === '/api/admin/orders/refund' && request.method === 'POST') {
      const corsHeaders = { 'Access-Control-Allow-Origin': '*' };
      try {
        const supabaseUrl = env.SUPABASE_URL || 'https://wjhdsodlxekvhpahascs.supabase.co';
        const anonKey = env.SUPABASE_ANON_KEY || '';
        if (!env.STRIPE_SECRET_KEY) throw new Error('STRIPE_SECRET_KEY not configured');

        const authHeader = request.headers.get('Authorization');
        if (!authHeader) throw new Error('Authorization header required');
        const callerResp = await fetch(`${supabaseUrl}/auth/v1/user`, {
          headers: { 'Authorization': authHeader, 'apikey': anonKey }
        });
        if (!callerResp.ok) throw new Error('Could not verify caller');
        const caller = await callerResp.json();
        if (caller.user_metadata?.is_admin !== true) {
          throw new Error('Admin access required');
        }

        const body = await request.json();
        const { orderNo, amount, reason, stripeReason, deductCredits } = body;
        if (!orderNo) throw new Error('orderNo is required');
        if (!reason || !String(reason).trim()) throw new Error('reason is required');

        const validStripeReasons = ['duplicate', 'fraudulent', 'requested_by_customer'];
        if (stripeReason && !validStripeReasons.includes(stripeReason)) {
          throw new Error(`stripeReason must be one of: ${validStripeReasons.join(', ')}`);
        }

        // Look up the order to (a) confirm it exists, (b) get amount/userId,
        // (c) reject if already refunded.
        const orderLookup = await fetch(
          `${supabaseUrl}/rest/v1/orders?orderNo=eq.${encodeURIComponent(orderNo)}&select=*`,
          {
            headers: {
              'Authorization': `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
              'apikey': env.SUPABASE_SERVICE_ROLE_KEY,
            }
          }
        );
        if (!orderLookup.ok) throw new Error(`Order lookup failed (${orderLookup.status})`);
        const orderRows = await orderLookup.json();
        if (!Array.isArray(orderRows) || orderRows.length === 0) {
          throw new Error(`Order ${orderNo} not found`);
        }
        const order = orderRows[0];
        if (order.refunded_at) {
          throw new Error(`Order ${orderNo} is already refunded (${order.refunded_at}). For multi-step partial refunds, issue subsequent refunds in Stripe Dashboard — webhook will sync.`);
        }
        if (order.voided_at) {
          throw new Error(`Order ${orderNo} is voided. Restore it first if you want to refund instead.`);
        }

        // Resolve the Stripe payment_intent from the order's identifier.
        let paymentIntentId = null;
        let stripeObjectType = null;
        if (typeof orderNo === 'string' && orderNo.startsWith('in_')) {
          // Subscription invoice → fetch invoice → .payment_intent
          const r = await fetch(`https://api.stripe.com/v1/invoices/${orderNo}`, {
            headers: { 'Authorization': `Bearer ${env.STRIPE_SECRET_KEY}` }
          });
          if (!r.ok) throw new Error(`Stripe invoice fetch failed (${r.status}) for ${orderNo}`);
          const inv = await r.json();
          paymentIntentId = inv.payment_intent;
          stripeObjectType = 'invoice';
          if (!paymentIntentId) throw new Error(`Invoice ${orderNo} has no payment_intent — cannot refund`);
        } else if (typeof orderNo === 'string' && orderNo.startsWith('cs_')) {
          // One-time Checkout session → fetch session → .payment_intent
          const r = await fetch(`https://api.stripe.com/v1/checkout/sessions/${orderNo}`, {
            headers: { 'Authorization': `Bearer ${env.STRIPE_SECRET_KEY}` }
          });
          if (!r.ok) throw new Error(`Stripe session fetch failed (${r.status}) for ${orderNo}`);
          const sess = await r.json();
          paymentIntentId = sess.payment_intent;
          stripeObjectType = 'checkout_session';
          if (!paymentIntentId) throw new Error(`Checkout session ${orderNo} has no payment_intent — cannot refund`);
        } else {
          throw new Error(`Order ${orderNo} is not a Stripe payment (manual ORD-xxx). Use Void instead — there's nothing to refund on Stripe's side.`);
        }

        // Compute refund amount in cents. Omit for full refund.
        const fullAmountCents = Math.round(Number(order.amount) * 100);
        let refundAmountCents = null;
        if (amount !== undefined && amount !== null && amount !== '') {
          refundAmountCents = Math.round(Number(amount) * 100);
          if (!Number.isFinite(refundAmountCents) || refundAmountCents <= 0) {
            throw new Error('amount must be a positive number');
          }
          if (refundAmountCents > fullAmountCents) {
            throw new Error(`amount (${amount}) exceeds order total ($${order.amount})`);
          }
        }

        // Issue the refund via Stripe.
        const refundParams = {
          payment_intent: paymentIntentId,
          'metadata[uvera_admin_id]': caller.id,
          'metadata[uvera_admin_email]': caller.email || '',
          'metadata[uvera_reason]': String(reason).trim().slice(0, 500),
          'metadata[uvera_order_no]': orderNo,
        };
        if (refundAmountCents !== null) refundParams.amount = String(refundAmountCents);
        if (stripeReason) refundParams.reason = stripeReason;

        const refundResp = await fetch('https://api.stripe.com/v1/refunds', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${env.STRIPE_SECRET_KEY}`,
            'Content-Type': 'application/x-www-form-urlencoded'
          },
          body: new URLSearchParams(refundParams)
        });
        const refundData = await refundResp.json();
        if (!refundResp.ok) {
          // Stripe error — pass through so admin sees the actual reason
          throw new Error(`Stripe refund failed: ${refundData.error?.message || JSON.stringify(refundData)}`);
        }

        // Optional: deduct credits from the user. Clamped to >= 0 — never
        // let credits go negative even if they've used what was refunded.
        // §2026-05-29 — deduct via spend_credits RPC (authoritative
        //   user_credits + credit_tx audit row), then mirror to
        //   user_metadata for rollback safety. Clamp to the live balance so
        //   the RPC (which rejects over-spend) always succeeds.
        let actualDeducted = 0;
        const deductN = Number(deductCredits) || 0;
        if (deductN > 0 && order.userId) {
          try {
            const u = await fetch(`${supabaseUrl}/auth/v1/admin/users/${order.userId}`, {
              headers: {
                'Authorization': `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
                'apikey': env.SUPABASE_SERVICE_ROLE_KEY,
              }
            });
            const userObj = u.ok ? await u.json() : null;
            const meta = userObj?.user_metadata || {};
            const balResp = await fetch(
              `${supabaseUrl}/rest/v1/user_credits?select=balance&user_id=eq.${encodeURIComponent(order.userId)}&limit=1`,
              {
                headers: {
                  'Authorization': `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
                  'apikey': env.SUPABASE_SERVICE_ROLE_KEY,
                }
              }
            );
            const balRows = balResp.ok ? await balResp.json() : [];
            const currentCredits = (Array.isArray(balRows) && balRows.length > 0) ? (Number(balRows[0].balance) || 0) : 0;
            const candidate = Math.min(deductN, currentCredits);
            if (candidate > 0) {
              const sp = await creditSpend(env, order.userId, candidate, 'admin_refund_deduct', orderNo, `Refund deduction by ${caller.email || caller.id}`);
              actualDeducted = sp.spent;
              await mirrorBalanceToMeta(env, order.userId, sp.balance_after, meta);
            }
          } catch (e) {
            // Non-fatal — refund already succeeded on Stripe's side. Admin
            // can manually use +Tokens to adjust if needed.
            // §2026-05-15 loud-fail: escalate so token-imbalance after refund
            // is visible to ops (else user keeps tokens they got from a now-
            // refunded payment, distorting financials silently).
            console.error('[admin/orders/refund] credits deduction failed:', e.message, '— refund succeeded on Stripe but user still has the tokens; admin should adjust via +Tokens');
          }
        }

        // Persist audit columns to orders.
        const refundedAmountUsd = (refundAmountCents !== null ? refundAmountCents : fullAmountCents) / 100;
        const patch = {
          refunded_at: new Date().toISOString(),
          refunded_by: caller.id,
          refunded_reason: String(reason).trim().slice(0, 500),
          refunded_amount: refundedAmountUsd,
          stripe_refund_id: refundData.id,
          // §A Phase 1.5 dual-write — same value to both legacy + new columns
          credits_deducted: actualDeducted,
          tokens_deducted: actualDeducted,
        };
        const updateResp = await fetch(
          `${supabaseUrl}/rest/v1/orders?orderNo=eq.${encodeURIComponent(orderNo)}`,
          {
            method: 'PATCH',
            headers: {
              'Authorization': `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
              'apikey': env.SUPABASE_SERVICE_ROLE_KEY,
              'Content-Type': 'application/json',
              'Prefer': 'return=representation',
            },
            body: JSON.stringify(patch),
          }
        );
        if (!updateResp.ok) {
          // The refund already happened on Stripe — log loudly but return success
          // so admin knows the customer got their money back. The webhook
          // (charge.refunded) will retry the DB sync if it fires.
          const errText = await updateResp.text().catch(() => '');
          console.error('[admin/orders/refund] DB update failed AFTER successful Stripe refund. Order:', orderNo, 'Refund:', refundData.id, 'Error:', updateResp.status, errText);
        }

        console.log('[admin/orders/refund] refunded', orderNo, 'amount=$' + refundedAmountUsd, 'stripe_refund=' + refundData.id, 'deducted_credits=' + actualDeducted, 'admin=' + caller.email);

        // Notify the customer their refund is processing. Stripe usually
        // takes 5-10 business days to surface the credit on the card.
        try {
          if (order.userId) {
            const userResp = await fetch(`${supabaseUrl}/auth/v1/admin/users/${order.userId}`, {
              headers: {
                'Authorization': `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
                'apikey': env.SUPABASE_SERVICE_ROLE_KEY,
              }
            });
            if (userResp.ok) {
              const userObj = await userResp.json();
              const recipientEmail = userObj.email;
              if (recipientEmail) {
                const isPartial = refundedAmountUsd < Number(order.amount);
                const paragraphs = [
                  `We've processed a ${isPartial ? 'partial ' : ''}refund of $${refundedAmountUsd.toFixed(2)} for your UVERA order. The funds will appear on your original payment method within 5-10 business days, depending on your bank.`,
                ];
                if (actualDeducted > 0) {
                  paragraphs.push(`As part of the refund, ${actualDeducted.toLocaleString()} tokens were removed from your account.`);
                }
                paragraphs.push(`If you didn't expect this refund or have questions, reply to this email and we'll look into it.`);
                const { html, text } = renderEmail({
                  heading: `Refund processed — $${refundedAmountUsd.toFixed(2)}`,
                  paragraphs,
                  footerNote: `Order ${orderNo} · Refund ${refundData.id}`,
                });
                const r = await sendEmail(env, {
                  to: recipientEmail,
                  subject: `Refund processed — $${refundedAmountUsd.toFixed(2)}`,
                  html, text,
                  replyTo: env.SUPPORT_EMAIL || undefined,
                  tags: [{ name: 'category', value: 'refund_confirmation' }],
                });
                if (!r.ok) console.warn('[admin/orders/refund] notification email failed:', r.error);
              }
            }
          }
        } catch (e) {
          console.warn('[admin/orders/refund] notification email exception:', e.message);
        }

        return new Response(JSON.stringify({
          success: true,
          orderNo,
          refundId: refundData.id,
          refundedAmount: refundedAmountUsd,
          creditsDeducted: actualDeducted,
          stripeObjectType,
        }), {
          status: 200,
          headers: { 'Content-Type': 'application/json', ...corsHeaders }
        });
      } catch (err) {
        console.error('[admin/orders/refund]', err.message);
        return new Response(JSON.stringify({ success: false, errMessage: err.message }), {
          status: 500,
          headers: { 'Content-Type': 'application/json', ...corsHeaders }
        });
      }
    }

    /* ── POST /api/admin/drama/refund ─────────────────────────────────────
     * §2026-05-26 fei (audit #10) — Admin-initiated refund for drama orders.
     *
     * Body: { source_table: 'ucoins_orders' | 'series_purchases',
     *         source_id:    uuid,
     *         reason:       string (audit trail) }
     *
     * Flow:
     *   1. Auth: admin only.
     *   2. Look up source row by id. Reject if status != 'succeeded' or
     *      already refunded (idempotency).
     *   3. Call Stripe refunds.create with metadata (admin id + reason +
     *      uvera order link).
     *   4. Inline DB reversal:
     *        ucoins_orders → wallet_refund_purchase RPC (atomic) +
     *                        status='refunded' patch
     *        series_purchases → status='refunded' patch + DELETE
     *                           episode_unlocks where unlock_type='bundle'
     *   5. The charge.refunded webhook will fire later but is idempotent
     *      (status='refunded' guard above) — no double-debit.
     *
     * Returns: { success, refund_id, refunded_amount_cents, reversal }
     */
    if (url.pathname === '/api/admin/drama/refund' && request.method === 'POST') {
      const corsHeaders = { 'Access-Control-Allow-Origin': '*' };
      try {
        const supabaseUrl = env.SUPABASE_URL || 'https://wjhdsodlxekvhpahascs.supabase.co';
        const anonKey = env.SUPABASE_ANON_KEY || '';
        const authHeader = request.headers.get('Authorization');
        if (!authHeader) throw new Error('Authorization required');
        const callerResp = await fetch(`${supabaseUrl}/auth/v1/user`, {
          headers: { 'Authorization': authHeader, 'apikey': anonKey }
        });
        if (!callerResp.ok) throw new Error('Could not verify caller');
        const caller = await callerResp.json();
        if (caller.user_metadata?.is_admin !== true) throw new Error('Admin access required');

        const { source_table, source_id, reason } = await request.json();
        if (!source_table || !['ucoins_orders', 'series_purchases'].includes(source_table)) {
          throw new Error('source_table must be "ucoins_orders" or "series_purchases"');
        }
        if (!source_id) throw new Error('source_id is required');
        if (!reason || !String(reason).trim()) throw new Error('reason is required');

        const sbAdmin = (path, init = {}) => fetch(`${supabaseUrl}/rest/v1${path}`, {
          ...init,
          headers: {
            'Authorization': `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
            'apikey': env.SUPABASE_SERVICE_ROLE_KEY,
            'Content-Type': 'application/json',
            ...(init.headers || {}),
          },
        });

        // 1. Look up the source row
        const lookupSelect = source_table === 'ucoins_orders'
          ? 'id,user_id,amount_usd_cents,ucoins_to_credit,stripe_session_id,stripe_payment_intent,status,refunded_at'
          : 'id,user_id,series_id,amount_usd_cents,stripe_session_id,stripe_payment_intent,status,refunded_at';
        const lookupResp = await sbAdmin(`/${source_table}?id=eq.${source_id}&select=${lookupSelect}&limit=1`);
        const lookupRows = lookupResp.ok ? await lookupResp.json() : [];
        if (lookupRows.length === 0) throw new Error(`${source_table} row ${source_id} not found`);
        const order = lookupRows[0];
        if (order.status !== 'succeeded') {
          throw new Error(`Order is in status="${order.status}" — only succeeded orders can be refunded`);
        }
        if (order.refunded_at) {
          throw new Error(`Order already refunded at ${order.refunded_at}`);
        }

        // 2. Resolve Stripe payment_intent (we stored it but fall back to session lookup)
        let paymentIntentId = order.stripe_payment_intent;
        if (!paymentIntentId && order.stripe_session_id) {
          const sessResp = await fetch(`https://api.stripe.com/v1/checkout/sessions/${order.stripe_session_id}`, {
            headers: { 'Authorization': `Bearer ${env.STRIPE_SECRET_KEY}` }
          });
          if (sessResp.ok) {
            const sess = await sessResp.json();
            paymentIntentId = sess.payment_intent;
          }
        }
        if (!paymentIntentId) throw new Error('Could not resolve Stripe payment_intent — order may be test/manual');

        // 3. Issue Stripe refund (full, no partial for drama MVP)
        const refundResp = await fetch('https://api.stripe.com/v1/refunds', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${env.STRIPE_SECRET_KEY}`,
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          body: new URLSearchParams({
            payment_intent: paymentIntentId,
            'metadata[uvera_admin_id]': caller.id,
            'metadata[uvera_admin_email]': caller.email || '',
            'metadata[uvera_reason]': String(reason).trim().slice(0, 500),
            'metadata[uvera_source_table]': source_table,
            'metadata[uvera_source_id]': source_id,
          }),
        });
        const refundData = await refundResp.json();
        if (!refundResp.ok) {
          throw new Error(`Stripe refund failed: ${refundData.error?.message || JSON.stringify(refundData)}`);
        }

        // 4. Inline DB reversal — webhook will be idempotent fallback.
        const reversal = {};
        if (source_table === 'ucoins_orders') {
          const rpcResp = await sbAdmin('/rpc/wallet_refund_purchase', {
            method: 'POST',
            headers: { 'Prefer': 'return=representation' },
            body: JSON.stringify({
              p_user_id: order.user_id,
              p_ucoins_amount: order.ucoins_to_credit,
              p_reference_type: 'ucoins_order',
              p_reference_id: order.id,
              p_description: `Admin refund (${refundData.id}): ${reason}`,
            }),
          });
          reversal.wallet = rpcResp.ok ? await rpcResp.json() : { error: 'rpc failed' };
          await sbAdmin(`/ucoins_orders?id=eq.${order.id}`, {
            method: 'PATCH',
            body: JSON.stringify({
              status: 'refunded',
              refunded_at: new Date().toISOString(),
              stripe_refund_id: refundData.id,
            }),
          });
        } else {
          // series_purchases
          await sbAdmin(`/series_purchases?id=eq.${order.id}`, {
            method: 'PATCH',
            body: JSON.stringify({
              status: 'refunded',
              refunded_at: new Date().toISOString(),
              stripe_refund_id: refundData.id,
            }),
          });
          const delResp = await sbAdmin(
            `/episode_unlocks?user_id=eq.${order.user_id}&series_id=eq.${order.series_id}&unlock_type=eq.bundle`,
            { method: 'DELETE', headers: { 'Prefer': 'return=minimal' } }
          );
          reversal.unlocks_revoked = delResp.status === 204 || delResp.status === 200;
        }

        console.log('[admin/drama/refund]', source_table, source_id, 'stripe_refund=', refundData.id, 'admin=', caller.email);
        return new Response(JSON.stringify({
          success: true,
          refund_id: refundData.id,
          refunded_amount_cents: refundData.amount,
          reversal,
        }), { status: 200, headers: { 'Content-Type': 'application/json', ...corsHeaders } });
      } catch (err) {
        console.error('[admin/drama/refund]', err.message);
        return new Response(JSON.stringify({ success: false, errMessage: err.message }), {
          status: 500, headers: { 'Content-Type': 'application/json', ...corsHeaders }
        });
      }
    }

    // ─── Stripe reconciliation: list missing orders ─────────────────────
    // GET /api/admin/stripe/reconcile?days=30  →  {
    //   missingOneTime: [{ id, created, amount, customer, ... }],
    //   missingInvoices: [{ id, created, amount, customer, ... }],
    //   summary: { stripeOneTime: N, stripeInvoices: M, dbMatched: K, missingTotal: X },
    // }
    //
    // Cross-references Stripe with our orders table to find payments that
    // succeeded in Stripe but never made it into our DB (webhook missed /
    // failed / didn't fire). Admin can then one-click import each.
    //
    // Why this matters: Stripe webhook delivery is at-least-once but not
    // guaranteed under all failure modes (e.g. signing secret mismatch,
    // CF Worker cold-start 503, FK violation on INSERT, Stripe Dashboard
    // subscription not actually saved). This is the safety net.
    if (url.pathname === '/api/admin/stripe/reconcile' && request.method === 'GET') {
      const corsHeaders = { 'Access-Control-Allow-Origin': '*' };
      try {
        const supabaseUrl = env.SUPABASE_URL || 'https://wjhdsodlxekvhpahascs.supabase.co';
        const anonKey = env.SUPABASE_ANON_KEY || '';

        // Admin gate
        const authHeader = request.headers.get('Authorization');
        if (!authHeader) throw new Error('Authorization header required');
        const callerResp = await fetch(`${supabaseUrl}/auth/v1/user`, {
          headers: { 'Authorization': authHeader, 'apikey': anonKey }
        });
        if (!callerResp.ok) throw new Error('Could not verify caller');
        const caller = await callerResp.json();
        if (caller.user_metadata?.is_admin !== true) {
          throw new Error('Admin access required');
        }
        if (!env.STRIPE_SECRET_KEY) throw new Error('STRIPE_SECRET_KEY not configured');

        const days = Math.min(180, Math.max(1, parseInt(url.searchParams.get('days') || '30', 10)));
        const sinceUnix = Math.floor((Date.now() - days * 86400_000) / 1000);

        // Paginated Stripe list helper (cursor via `starting_after`).
        // Caps at MAX_PAGES to bound worst-case latency on a 6-month window.
        const MAX_PAGES = 5;       // 5 × 100 = 500 records per resource
        const PAGE_LIMIT = 100;
        const listAllStripe = async (resource, extraQs = '') => {
          const out = [];
          let cursor = null;
          for (let page = 0; page < MAX_PAGES; page++) {
            const qs = new URLSearchParams({
              limit: String(PAGE_LIMIT),
              'created[gte]': String(sinceUnix),
            });
            if (cursor) qs.set('starting_after', cursor);
            const r = await fetch(`https://api.stripe.com/v1/${resource}?${qs.toString()}${extraQs}`, {
              headers: { 'Authorization': `Bearer ${env.STRIPE_SECRET_KEY}` }
            });
            if (!r.ok) {
              const errBody = await r.text().catch(() => '');
              throw new Error(`Stripe ${resource} list failed (${r.status}): ${errBody.slice(0, 200)}`);
            }
            const data = await r.json();
            const items = data.data || [];
            out.push(...items);
            if (!data.has_more || items.length === 0) break;
            cursor = items[items.length - 1].id;
          }
          return out;
        };

        // Pull one-time sessions + invoices in parallel.
        // Filtering predicates applied client-side because Stripe's list API
        // doesn't accept payment_status / mode / status as query filters on
        // all resources (only invoices accept `status=paid`).
        const [allSessions, paidInvoices] = await Promise.all([
          listAllStripe('checkout/sessions'),
          listAllStripe('invoices', '&status=paid'),
        ]);

        const paidOneTimeSessions = allSessions.filter(s =>
          s.mode === 'payment' &&
          s.payment_status === 'paid' &&
          s.status === 'complete'
        );

        // Look up all candidate orderNos at once in DB. Use `in.()` PostgREST
        // filter — single query instead of N round-trips.
        const candidateIds = [
          ...paidOneTimeSessions.map(s => s.id),
          ...paidInvoices.map(i => i.id),
        ];
        const existingOrderNos = new Set();
        if (candidateIds.length > 0) {
          // PostgREST in.() syntax; URL-encode each (cs_ / in_ IDs are safe
          // alphanumeric but encodeURIComponent is defensive)
          const inList = candidateIds.map(id => encodeURIComponent(id)).join(',');
          const r = await fetch(
            `${supabaseUrl}/rest/v1/orders?orderNo=in.(${inList})&select=orderNo`,
            {
              headers: {
                'Authorization': `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
                'apikey': env.SUPABASE_SERVICE_ROLE_KEY,
              }
            }
          );
          if (r.ok) {
            const rows = await r.json();
            for (const row of (rows || [])) existingOrderNos.add(row.orderNo);
          } else {
            // Fail-loud: better to surface error than silently report
            // "missing" rows that actually exist.
            const t = await r.text().catch(() => '');
            throw new Error(`DB match lookup failed (${r.status}): ${t.slice(0, 200)}`);
          }
        }

        // Shape results — keep payload small (UI doesn't need full Stripe blob)
        const shapeSession = (s) => ({
          id: s.id,
          type: 'checkout_session',
          created: s.created,
          amount: (s.amount_total || 0) / 100,
          currency: s.currency,
          customer: s.customer,
          customerEmail: s.customer_email || s.customer_details?.email || null,
          customerName: s.customer_details?.name || null,
          uveraPlan: s.metadata?.uvera_plan || null,
          liteTier: s.metadata?.uvera_lite_tier || null,
          supabaseUserId: s.metadata?.supabase_user_id || null,
          paymentIntent: s.payment_intent || null,
        });
        const shapeInvoice = (i) => ({
          id: i.id,
          type: 'invoice',
          created: i.created,
          amount: (i.amount_paid || 0) / 100,
          currency: i.currency,
          customer: i.customer,
          customerEmail: i.customer_email || null,
          customerName: i.customer_name || null,
          subscription: i.subscription || null,
          paymentIntent: i.payment_intent || null,
        });

        const missingOneTime = paidOneTimeSessions
          .filter(s => !existingOrderNos.has(s.id))
          .map(shapeSession)
          .sort((a, b) => b.created - a.created);
        const missingInvoices = paidInvoices
          .filter(i => !existingOrderNos.has(i.id))
          .map(shapeInvoice)
          .sort((a, b) => b.created - a.created);

        return new Response(JSON.stringify({
          success: true,
          days,
          summary: {
            stripeOneTime: paidOneTimeSessions.length,
            stripeInvoices: paidInvoices.length,
            dbMatched: existingOrderNos.size,
            missingTotal: missingOneTime.length + missingInvoices.length,
            scannedPages: { sessions: allSessions.length, invoices: paidInvoices.length },
            maxPages: MAX_PAGES,
            maxRecordsPerResource: MAX_PAGES * PAGE_LIMIT,
          },
          missingOneTime,
          missingInvoices,
        }), {
          status: 200,
          headers: { 'Content-Type': 'application/json', ...corsHeaders }
        });
      } catch (err) {
        console.error('[admin/stripe/reconcile]', err.message);
        return new Response(JSON.stringify({ success: false, errMessage: err.message }), {
          status: 500,
          headers: { 'Content-Type': 'application/json', ...corsHeaders }
        });
      }
    }

    // ─── Stripe reconciliation: import one missing order ────────────────
    // POST /api/admin/stripe/reconcile/import  body: { id: 'cs_xxx' | 'in_xxx' }
    //   → { success, orderNo, creditsGranted, newBalance, alreadyExisted }
    //
    // Runs the equivalent of the webhook handler against a specific Stripe
    // object. Idempotent — re-running on an already-imported orderNo is a
    // no-op (returns alreadyExisted=true). Audit trail: subject is suffixed
    // with "(reconciled by <admin email>)" so the row is distinguishable
    // from organic webhook imports.
    if (url.pathname === '/api/admin/stripe/reconcile/import' && request.method === 'POST') {
      const corsHeaders = { 'Access-Control-Allow-Origin': '*' };
      try {
        const supabaseUrl = env.SUPABASE_URL || 'https://wjhdsodlxekvhpahascs.supabase.co';
        const anonKey = env.SUPABASE_ANON_KEY || '';

        const authHeader = request.headers.get('Authorization');
        if (!authHeader) throw new Error('Authorization header required');
        const callerResp = await fetch(`${supabaseUrl}/auth/v1/user`, {
          headers: { 'Authorization': authHeader, 'apikey': anonKey }
        });
        if (!callerResp.ok) throw new Error('Could not verify caller');
        const caller = await callerResp.json();
        if (caller.user_metadata?.is_admin !== true) {
          throw new Error('Admin access required');
        }
        if (!env.STRIPE_SECRET_KEY) throw new Error('STRIPE_SECRET_KEY not configured');

        const body = await request.json().catch(() => ({}));
        const stripeId = (body.id || '').trim();
        if (!stripeId) throw new Error('id required');
        const isSession = stripeId.startsWith('cs_');
        const isInvoice = stripeId.startsWith('in_');
        if (!isSession && !isInvoice) {
          throw new Error('id must start with cs_ (checkout session) or in_ (invoice)');
        }

        // Idempotency check
        {
          const r = await fetch(
            `${supabaseUrl}/rest/v1/orders?orderNo=eq.${encodeURIComponent(stripeId)}&select=orderNo`,
            {
              headers: {
                'Authorization': `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
                'apikey': env.SUPABASE_SERVICE_ROLE_KEY,
              }
            }
          );
          if (r.ok) {
            const rows = await r.json();
            if (Array.isArray(rows) && rows.length > 0) {
              return new Response(JSON.stringify({
                success: true,
                orderNo: stripeId,
                alreadyExisted: true,
                message: 'Order already in DB — nothing to do',
              }), { status: 200, headers: { 'Content-Type': 'application/json', ...corsHeaders } });
            }
          }
        }

        // Fetch the Stripe object
        const stripeResp = await fetch(`https://api.stripe.com/v1/${isSession ? 'checkout/sessions' : 'invoices'}/${encodeURIComponent(stripeId)}`, {
          headers: { 'Authorization': `Bearer ${env.STRIPE_SECRET_KEY}` }
        });
        if (!stripeResp.ok) {
          const errBody = await stripeResp.json().catch(() => ({}));
          throw new Error(`Stripe fetch failed (${stripeResp.status}): ${errBody.error?.message || 'unknown'}`);
        }
        const stripeObj = await stripeResp.json();

        // Resolve plan + amount based on object type
        let amountUsd = 0;
        let createdUnix = stripeObj.created || Math.floor(Date.now() / 1000);
        let customerId = stripeObj.customer || null;
        let customerEmail = null;
        let planInfo = null;
        let liteTierLabel = '';
        let subjectPrefix = 'UVERA';

        // Inline price/amount maps (same source-of-truth as webhook; if you
        // change one, change the other — both are intentionally local to
        // their handlers so each route is auditable in isolation).
        const priceMap = {
          [env.STRIPE_PRICE_LITE_TRIAL]:      { tier: 'lite',    monthly_credits: 100  },
          [env.STRIPE_PRICE_STARTER_MONTHLY]: { tier: 'starter', monthly_credits: 500  },
          [env.STRIPE_PRICE_STARTER_YEARLY]:  { tier: 'starter', monthly_credits: 500  },
          [env.STRIPE_PRICE_CREATOR_MONTHLY]: { tier: 'creator', monthly_credits: 1500 },
          [env.STRIPE_PRICE_CREATOR_YEARLY]:  { tier: 'creator', monthly_credits: 1500 },
          [env.STRIPE_PRICE_STUDIO_MONTHLY]:  { tier: 'studio',  monthly_credits: 5000 },
          [env.STRIPE_PRICE_STUDIO_YEARLY]:   { tier: 'studio',  monthly_credits: 5000 },
        };
        const AMOUNT_FALLBACK = {
          399: { tier: 'lite', monthly_credits: 100 },
          599: { tier: 'lite', monthly_credits: 100 },
          799: { tier: 'lite', monthly_credits: 100 },
          2500:  { tier: 'starter', monthly_credits: 500  },
          25000: { tier: 'starter', monthly_credits: 500  },
          6900:  { tier: 'creator', monthly_credits: 1500 },
          69000: { tier: 'creator', monthly_credits: 1500 },
          18900: { tier: 'studio',  monthly_credits: 5000 },
          189000:{ tier: 'studio',  monthly_credits: 5000 },
        };

        if (isSession) {
          if (stripeObj.mode !== 'payment') throw new Error(`Session mode=${stripeObj.mode} not supported (only mode=payment for one-time)`);
          if (stripeObj.payment_status !== 'paid') throw new Error(`Session payment_status=${stripeObj.payment_status} (need 'paid')`);
          amountUsd = (stripeObj.amount_total || 0) / 100;
          customerEmail = stripeObj.customer_email || stripeObj.customer_details?.email || null;

          if (stripeObj.metadata?.uvera_plan === 'lite') {
            planInfo = { tier: 'lite', monthly_credits: 100 };
          } else {
            const fb = AMOUNT_FALLBACK[stripeObj.amount_total || 0];
            if (fb) planInfo = fb;
          }
          if (stripeObj.metadata?.uvera_lite_tier) {
            liteTierLabel = ` × ${stripeObj.metadata.uvera_lite_tier}`;
          }
          subjectPrefix = `UVERA ${planInfo?.tier || 'unknown'}${liteTierLabel} (one-time)`;
        } else {
          if (stripeObj.status !== 'paid') throw new Error(`Invoice status=${stripeObj.status} (need 'paid')`);
          amountUsd = (stripeObj.amount_paid || 0) / 100;
          customerEmail = stripeObj.customer_email || null;

          // Scan lines: prefer non-zero priced line (skips $0 trial line)
          const lines = stripeObj.lines?.data || [];
          let priceId = null;
          for (const line of lines) {
            const lineAmount = line.amount || 0;
            const linePriceId = line.pricing?.price_details?.price || line.price?.id || null;
            if (lineAmount > 0 && linePriceId) {
              priceId = linePriceId;
              break;
            }
          }
          if (priceId && priceMap[priceId]) {
            planInfo = priceMap[priceId];
          } else {
            const fb = AMOUNT_FALLBACK[stripeObj.amount_paid || 0];
            if (fb) planInfo = fb;
          }
          subjectPrefix = `UVERA ${planInfo?.tier || 'unknown'} subscription`;
        }

        if (!planInfo) {
          throw new Error(`Could not resolve plan: amount=$${amountUsd}, metadata=${JSON.stringify(stripeObj.metadata || {})}. Add the amount to AMOUNT_FALLBACK or check price ID config.`);
        }

        // Resolve Supabase user: try (a) session.metadata.supabase_user_id,
        // (b) Stripe customer.metadata.supabase_user_id, (c) email lookup
        let supabaseUserId = stripeObj.metadata?.supabase_user_id || null;
        let resolveVia = supabaseUserId ? 'session.metadata' : null;

        if (!supabaseUserId && customerId) {
          const custResp = await fetch(`https://api.stripe.com/v1/customers/${customerId}`, {
            headers: { 'Authorization': `Bearer ${env.STRIPE_SECRET_KEY}` }
          });
          if (custResp.ok) {
            const cust = await custResp.json();
            supabaseUserId = cust.metadata?.supabase_user_id || null;
            if (supabaseUserId) resolveVia = 'customer.metadata';
            if (!customerEmail) customerEmail = cust.email || null;
          }
        }
        if (!supabaseUserId && customerEmail) {
          const r = await fetch(`${supabaseUrl}/auth/v1/admin/users?email=${encodeURIComponent(customerEmail)}`, {
            headers: {
              'Authorization': `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
              'apikey': env.SUPABASE_SERVICE_ROLE_KEY,
            }
          });
          if (r.ok) {
            const d = await r.json();
            supabaseUserId = d.users?.[0]?.id || null;
            if (supabaseUserId) resolveVia = 'email_fallback';
          }
        }
        if (!supabaseUserId) {
          throw new Error(`Could not resolve Supabase user: customerId=${customerId}, email=${customerEmail || 'none'}. Set customer.metadata.supabase_user_id in Stripe Dashboard or ensure a Supabase user exists with this email.`);
        }

        // INSERT orders row (suffix subject with reconciler info for audit)
        const adminEmail = caller.email || 'unknown';
        const orderPayload = {
          orderNo: stripeId,
          userId: supabaseUserId,
          subject: `${subjectPrefix} — reconciled by ${adminEmail}`,
          amount: amountUsd,
          status: 1,
          createdAt: new Date(createdUnix * 1000).toISOString(),
        };
        const orderInsert = await fetch(`${supabaseUrl}/rest/v1/orders`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
            'apikey': env.SUPABASE_SERVICE_ROLE_KEY,
            'Content-Type': 'application/json',
            'Prefer': 'return=minimal',
          },
          body: JSON.stringify(orderPayload),
        });
        if (orderInsert.status === 409) {
          // Race with another tab / webhook firing simultaneously — fine
          return new Response(JSON.stringify({
            success: true,
            orderNo: stripeId,
            alreadyExisted: true,
            message: 'Order inserted by concurrent process — nothing to do',
          }), { status: 200, headers: { 'Content-Type': 'application/json', ...corsHeaders } });
        }
        if (!orderInsert.ok) {
          const t = await orderInsert.text().catch(() => '');
          throw new Error(`orders INSERT failed (${orderInsert.status}): ${t.slice(0, 300)}. If this is a 23503 FK violation, run migration 20260514_drop_orders_userId_legacy_fkey.up.sql.`);
        }

        // Grant credits + tier
        const userResp = await fetch(`${supabaseUrl}/auth/v1/admin/users/${supabaseUserId}`, {
          headers: {
            'Authorization': `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
            'apikey': env.SUPABASE_SERVICE_ROLE_KEY,
          }
        });
        if (!userResp.ok) {
          // Order is now in DB but credits couldn't be granted — caller can retry
          throw new Error(`Supabase user fetch failed (${userResp.status}). Order row inserted; credits NOT granted. Re-run import (idempotent) to retry.`);
        }
        const u = await userResp.json();
        const existingMeta = u.user_metadata || {};
        const currentBalance = existingMeta.tokens ?? existingMeta.credits ?? 0;
        const newBalance = currentBalance + planInfo.monthly_credits;
        // §2026-05-14 — same tier-preservation rule as the webhook handler.
        // Backfilling a Lite purchase MUST NOT downgrade a paid subscriber.
        const newTier = computeNewTier(existingMeta.tier, planInfo.tier);

        const metaPatch = {
          ...existingMeta,
          tier: newTier,
          credits: newBalance,
          tokens: newBalance,  // dual-write Phase 1
        };
        const updResp = await fetch(`${supabaseUrl}/auth/v1/admin/users/${supabaseUserId}`, {
          method: 'PUT',
          headers: {
            'Authorization': `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
            'apikey': env.SUPABASE_SERVICE_ROLE_KEY,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ user_metadata: metaPatch }),
        });
        if (!updResp.ok) {
          const t = await updResp.text().catch(() => '');
          throw new Error(`Credits grant failed (${updResp.status}): ${t.slice(0, 200)}. Order row inserted but balance NOT updated. Use admin +Tokens to grant ${planInfo.monthly_credits} manually.`);
        }

        console.log(`[admin/stripe/reconcile] ${adminEmail} imported ${stripeId} → user ${supabaseUserId} +${planInfo.monthly_credits} via ${resolveVia}`);

        return new Response(JSON.stringify({
          success: true,
          orderNo: stripeId,
          alreadyExisted: false,
          userId: supabaseUserId,
          resolveVia,
          tier: planInfo.tier,
          creditsGranted: planInfo.monthly_credits,
          newBalance,
        }), {
          status: 200,
          headers: { 'Content-Type': 'application/json', ...corsHeaders }
        });
      } catch (err) {
        console.error('[admin/stripe/reconcile/import]', err.message);
        return new Response(JSON.stringify({ success: false, errMessage: err.message }), {
          status: 500,
          headers: { 'Content-Type': 'application/json', ...corsHeaders }
        });
      }
    }

    // ─── System Settings: list all key/value pairs ──────────────────────
    // GET /api/admin/system-settings  →  { settings: [{key, value, description, updated_at, updated_by}] }
    // Lightweight read; admin System Settings tab uses this to populate
    // its config form. Cache is intentionally bypassed (admin should see
    // their own change reflected immediately).
    if (url.pathname === '/api/admin/system-settings' && request.method === 'GET') {
      const corsHeaders = { 'Access-Control-Allow-Origin': '*' };
      try {
        const supabaseUrl = env.SUPABASE_URL || 'https://wjhdsodlxekvhpahascs.supabase.co';
        const anonKey = env.SUPABASE_ANON_KEY || '';

        const authHeader = request.headers.get('Authorization');
        if (!authHeader) throw new Error('Authorization header required');
        const callerResp = await fetch(`${supabaseUrl}/auth/v1/user`, {
          headers: { 'Authorization': authHeader, 'apikey': anonKey }
        });
        if (!callerResp.ok) throw new Error('Could not verify caller');
        const caller = await callerResp.json();
        if (caller.user_metadata?.is_admin !== true) {
          throw new Error('Admin access required');
        }

        const r = await fetch(
          `${supabaseUrl}/rest/v1/system_settings?select=*&order=key.asc`,
          {
            headers: {
              'Authorization': `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
              'apikey': env.SUPABASE_SERVICE_ROLE_KEY,
            }
          }
        );
        if (!r.ok) {
          const t = await r.text().catch(() => '');
          throw new Error(`system_settings list failed (${r.status}): ${t.slice(0, 200)}`);
        }
        const rows = await r.json();

        // Enrich updated_by with email (best-effort)
        const adminIds = [...new Set((rows || []).map(s => s.updated_by).filter(Boolean))];
        const adminMap = new Map();
        await Promise.all(adminIds.map(async (uid) => {
          try {
            const ar = await fetch(`${supabaseUrl}/auth/v1/admin/users/${uid}`, {
              headers: {
                'Authorization': `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
                'apikey': env.SUPABASE_SERVICE_ROLE_KEY,
              }
            });
            if (ar.ok) {
              const u = await ar.json();
              adminMap.set(uid, { email: u.email, name: u.user_metadata?.name || null });
            }
          } catch (e) { /* skip */ }
        }));

        // §2026-05-15: mask secret values. is_secret=true rows return the
        // value as "******abcd" (last 4 chars only) so admin UI can show
        // "configured" without leaking the full value. UI also uses the
        // is_secret flag to render a password-style input + "rotate" CTA.
        const settings = (rows || []).map(s => {
          const isSecret = !!s.is_secret;
          let displayValue = s.value;
          if (isSecret && s.value) {
            const v = String(s.value);
            displayValue = v.length > 4
              ? '••••••' + v.slice(-4)
              : '••••••';
          }
          return {
            ...s,
            value: displayValue,
            configured: !!s.value,  // helper flag for UI
            updated_by_user: s.updated_by ? adminMap.get(s.updated_by) || null : null,
          };
        });

        // Also synthesize rows for ALL_KNOWN_KEYS that aren't in DB yet,
        // so admin UI can see "not configured" placeholders for secrets the
        // operator hasn't filled in. Keep in sync with VALIDATORS below.
        const ALL_KNOWN_KEYS = {
          lite_price_cooldown_hours:    { is_secret: false, description: 'Hours of no Lite purchases before price decays one tier (default 3).' },
          stream_watermark_uid:         { is_secret: false, description: 'CF Stream watermark UID applied to free/lite tier video output.' },
          seedance_fast_endpoint:       { is_secret: false, description: 'BytePlus Seedance 2.0 Fast model endpoint ID (Free tier locked here).' },
          seedance_standard_endpoint:   { is_secret: false, description: 'BytePlus Seedance 2.0 Standard model endpoint ID (paid tier opt-in).' },
          // §2026-05-30 fei — admin cost_usd bugs (Bug 1 + Bug 2) fix.
          //   Cost multipliers were already read by worker but never exposed
          //   to admin UI; cost per-second was a hardcoded constant.
          seedance_fast_cost_multiplier:     { is_secret: false, description: 'Cost multiplier for Seedance 2.0 Fast model — applied to BOTH user-facing token cost AND admin cost_usd. Default 1.0.' },
          seedance_standard_cost_multiplier: { is_secret: false, description: 'Cost multiplier for Seedance 2.0 Standard model — applied to BOTH user-facing token cost AND admin cost_usd. Default 1.5 (Standard ≈ 1.5x BytePlus compute vs Fast).' },
          video_cost_usd_per_sec_480p:  { is_secret: false, description: 'BytePlus Seedance USD cost per second for 480p output. Used for admin generation_logs.cost_usd column. Multiplied by model multiplier automatically.' },
          video_cost_usd_per_sec_720p:  { is_secret: false, description: 'BytePlus Seedance USD cost per second for 720p output. Same multiplier semantics as 480p key.' },
          video_cost_usd_per_sec_1080p: { is_secret: false, description: 'BytePlus Seedance USD cost per second for 1080p output. Same multiplier semantics as 480p key.' },
          // §2026-05-31 fei — token-based pricing. When set + the row has
          //   actual_completion_tokens (from BytePlus status poll), worker
          //   reconciles cost_usd to the real billing model. Empty = keep estimate.
          seedance_fast_usd_per_million_tokens:     { is_secret: false, description: 'BytePlus Seedance 2.0 Fast token rate (USD per million completion tokens). SET from actual BytePlus invoice to enable cost_basis=actual reconciliation. Empty = keep per-second estimate.' },
          seedance_standard_usd_per_million_tokens: { is_secret: false, description: 'BytePlus Seedance 2.0 Standard token rate (USD per million completion tokens). Same semantics as Fast key.' },
          byteplus_ark_api_key:         { is_secret: true,  description: 'BytePlus ARK API key (Bearer token for ark.ap-southeast.bytepluses.com). Falls back to Cloudflare env ARK_API_KEY if unset.' },
          byteplus_ark_ak:              { is_secret: true,  description: 'BytePlus Trusted Asset Library Access Key ID. Falls back to Cloudflare env ARK_AK.' },
          byteplus_ark_sk:              { is_secret: true,  description: 'BytePlus Trusted Asset Library Secret Access Key. Falls back to Cloudflare env ARK_SK.' },
          byteplus_asset_project:       { is_secret: false, description: 'BytePlus Trusted Asset Library project name. Default HKBAIZE-005. Must match what the AK/SK has IAM scope on.' },
          // §2026-05-21 OpenAI GPT-image-2 storyboard pipeline
          openai_api_key:               { is_secret: true,  description: 'OpenAI API key for GPT-image-2 storyboard generation.' },
          openai_image_model:           { is_secret: false, description: 'OpenAI image model name (default gpt-image-2).' },
          openai_image_quality:         { is_secret: false, description: 'gpt-image-2 enum: low / medium / high / auto. Default high.' },
          openai_image_size:            { is_secret: false, description: 'Image size, e.g. 1792x1024.' },
          use_storyboard_pipeline:      { is_secret: false, description: 'Feature flag — true enables OpenAI storyboard flow, false uses legacy Gemini flow.' },
        };
        const existingKeys = new Set(settings.map(s => s.key));
        for (const [key, meta] of Object.entries(ALL_KNOWN_KEYS)) {
          if (existingKeys.has(key)) continue;
          settings.push({
            key,
            value: null,
            description: meta.description,
            is_secret: meta.is_secret,
            configured: false,
            updated_at: null,
            updated_by: null,
            updated_by_user: null,
          });
        }
        // Sort by key for stable UI ordering
        settings.sort((a, b) => a.key.localeCompare(b.key));

        return new Response(JSON.stringify({ success: true, settings }), {
          status: 200,
          headers: { 'Content-Type': 'application/json', ...corsHeaders }
        });
      } catch (err) {
        console.error('[admin/system-settings] list', err.message);
        return new Response(JSON.stringify({ success: false, errMessage: err.message }), {
          status: 500,
          headers: { 'Content-Type': 'application/json', ...corsHeaders }
        });
      }
    }

    // ─── System Settings: update one key/value ──────────────────────────
    // POST /api/admin/system-settings/update  body: { key, value }
    //   → { success, key, value, updated_at }
    //
    // Validation: explicit allow-list of editable keys with their
    // accepted value shape (avoids admin typos like '3hours' or '03' or
    // accidental newlines breaking the parser downstream).
    if (url.pathname === '/api/admin/system-settings/update' && request.method === 'POST') {
      const corsHeaders = { 'Access-Control-Allow-Origin': '*' };
      try {
        const supabaseUrl = env.SUPABASE_URL || 'https://wjhdsodlxekvhpahascs.supabase.co';
        const anonKey = env.SUPABASE_ANON_KEY || '';

        const authHeader = request.headers.get('Authorization');
        if (!authHeader) throw new Error('Authorization header required');
        const callerResp = await fetch(`${supabaseUrl}/auth/v1/user`, {
          headers: { 'Authorization': authHeader, 'apikey': anonKey }
        });
        if (!callerResp.ok) throw new Error('Could not verify caller');
        const caller = await callerResp.json();
        if (caller.user_metadata?.is_admin !== true) {
          throw new Error('Admin access required');
        }

        const body = await request.json().catch(() => ({}));
        const key = (body.key || '').trim();
        const rawValue = body.value;
        if (!key) throw new Error('key required');
        if (rawValue === undefined || rawValue === null) throw new Error('value required');

        // Allow-list of editable keys + their parsers. Anything not here
        // requires a migration + redeploy. Better than letting admin
        // accidentally set lite_price_cooldown_hours='banana'.
        // §2026-05-15: each entry now has { validate, is_secret } so the
        // UPSERT can also persist is_secret correctly when creating a row
        // for the first time (e.g. when admin saves byteplus_ark_api_key
        // and there's no DB row yet).
        const VALIDATORS = {
          lite_price_cooldown_hours: {
            is_secret: false,
            validate: (v) => {
              const n = parseFloat(String(v).trim());
              if (Number.isNaN(n)) throw new Error('value must be a number (hours)');
              if (n < 0) throw new Error('value must be ≥ 0 (0 disables decay)');
              if (n > 720) throw new Error('value must be ≤ 720 hours (30 days)');
              return String(n);  // normalize ("3.0" → "3")
            },
          },
          stream_watermark_uid: {
            is_secret: false,
            validate: (v) => {
              const s = String(v).trim();
              if (!/^[a-f0-9]{32}$/.test(s)) throw new Error('CF Stream UID must be 32 lowercase hex chars');
              return s;
            },
          },
          seedance_fast_endpoint: {
            is_secret: false,
            validate: (v) => {
              const s = String(v).trim();
              if (!/^ep-\d{14}-[a-z0-9]+$/.test(s)) throw new Error('Endpoint ID must match ep-<14-digit-timestamp>-<hash>');
              return s;
            },
          },
          seedance_standard_endpoint: {
            is_secret: false,
            validate: (v) => {
              const s = String(v).trim();
              if (!/^ep-\d{14}-[a-z0-9]+$/.test(s)) throw new Error('Endpoint ID must match ep-<14-digit-timestamp>-<hash>');
              return s;
            },
          },
          // §2026-05-30 fei — cost multiplier + per-sec USD validators.
          //   All numeric, positive, bounded so a typo can't blow up costs.
          seedance_fast_cost_multiplier: {
            is_secret: false,
            validate: (v) => {
              const n = parseFloat(String(v).trim());
              if (Number.isNaN(n)) throw new Error('value must be a number');
              if (n <= 0) throw new Error('value must be > 0');
              if (n > 10) throw new Error('value must be ≤ 10 (extreme multiplier — sanity check)');
              return String(n);
            },
          },
          seedance_standard_cost_multiplier: {
            is_secret: false,
            validate: (v) => {
              const n = parseFloat(String(v).trim());
              if (Number.isNaN(n)) throw new Error('value must be a number');
              if (n <= 0) throw new Error('value must be > 0');
              if (n > 10) throw new Error('value must be ≤ 10 (extreme multiplier — sanity check)');
              return String(n);
            },
          },
          video_cost_usd_per_sec_480p: {
            is_secret: false,
            validate: (v) => {
              const n = parseFloat(String(v).trim());
              if (Number.isNaN(n)) throw new Error('value must be a USD per-second number');
              if (n < 0) throw new Error('value must be ≥ 0');
              if (n > 5) throw new Error('value must be ≤ 5 USD/sec (extreme rate — sanity check)');
              return String(n);
            },
          },
          video_cost_usd_per_sec_720p: {
            is_secret: false,
            validate: (v) => {
              const n = parseFloat(String(v).trim());
              if (Number.isNaN(n)) throw new Error('value must be a USD per-second number');
              if (n < 0) throw new Error('value must be ≥ 0');
              if (n > 5) throw new Error('value must be ≤ 5 USD/sec (extreme rate — sanity check)');
              return String(n);
            },
          },
          video_cost_usd_per_sec_1080p: {
            is_secret: false,
            validate: (v) => {
              const n = parseFloat(String(v).trim());
              if (Number.isNaN(n)) throw new Error('value must be a USD per-second number');
              if (n < 0) throw new Error('value must be ≥ 0');
              if (n > 5) throw new Error('value must be ≤ 5 USD/sec (extreme rate — sanity check)');
              return String(n);
            },
          },
          // §2026-05-31 fei — token-rate validators. Empty string = "not configured"
          //   (keep per-sec estimate); otherwise must be a non-negative USD/M number.
          seedance_fast_usd_per_million_tokens: {
            is_secret: false,
            validate: (v) => {
              const s = String(v).trim();
              if (s === '') return '';
              const n = parseFloat(s);
              if (Number.isNaN(n)) throw new Error('value must be empty or a USD per-million-tokens number');
              if (n < 0) throw new Error('value must be ≥ 0');
              if (n > 10000) throw new Error('value must be ≤ 10000 USD/M (extreme rate — sanity check)');
              return String(n);
            },
          },
          seedance_standard_usd_per_million_tokens: {
            is_secret: false,
            validate: (v) => {
              const s = String(v).trim();
              if (s === '') return '';
              const n = parseFloat(s);
              if (Number.isNaN(n)) throw new Error('value must be empty or a USD per-million-tokens number');
              if (n < 0) throw new Error('value must be ≥ 0');
              if (n > 10000) throw new Error('value must be ≤ 10000 USD/M (extreme rate — sanity check)');
              return String(n);
            },
          },
          byteplus_ark_api_key: {
            is_secret: true,
            validate: (v) => {
              const s = String(v).trim();
              if (s.length < 16) throw new Error('ARK API key looks too short (min 16 chars)');
              if (s.length > 1024) throw new Error('Value too long (>1024 chars) — paste error?');
              return s;
            },
          },
          byteplus_ark_ak: {
            is_secret: true,
            validate: (v) => {
              const s = String(v).trim();
              if (s.length < 8) throw new Error('Access Key ID looks too short (min 8 chars)');
              if (s.length > 256) throw new Error('Value too long — paste error?');
              return s;
            },
          },
          byteplus_ark_sk: {
            is_secret: true,
            validate: (v) => {
              const s = String(v).trim();
              if (s.length < 16) throw new Error('Secret Access Key looks too short (min 16 chars)');
              if (s.length > 1024) throw new Error('Value too long — paste error?');
              return s;
            },
          },
          byteplus_asset_project: {
            is_secret: false,
            validate: (v) => {
              const s = String(v).trim();
              if (!s) throw new Error('Project name required');
              // §2026-05-22 fei: relaxed validator. Previously hardcoded
              //   /^[A-Z0-9-]{3,64}$/ (uppercase only, 3+ chars). That was
              //   MY assumption from seeing HKBAIZE-005 / TIANWENYUE-2 in
              //   the wild — NOT a BytePlus requirement. Their official
              //   "Creating a project" doc just says "Enter a project name"
              //   with no format spec, and the auto-created "default"
              //   project on every account is lowercase — which the old
              //   regex rejected. Now allow letters (both cases) + digits
              //   + dash + underscore, 1-64 chars. Covers all known forms.
              if (!/^[A-Za-z0-9_-]{1,64}$/.test(s)) {
                throw new Error('Project name format: letters / digits / dash / underscore, 1-64 chars (e.g. "default", "HKBAIZE-005", "my_project")');
              }
              return s;
            },
          },
          // §2026-05-21 OpenAI GPT-image-2 storyboard pipeline
          openai_api_key: {
            is_secret: true,
            validate: (v) => {
              const s = String(v).trim();
              // OpenAI keys start with sk- and are 50+ chars
              if (!s.startsWith('sk-')) throw new Error('OpenAI key must start with "sk-"');
              if (s.length < 32) throw new Error('OpenAI key looks too short (min 32 chars)');
              if (s.length > 1024) throw new Error('Value too long — paste error?');
              return s;
            },
          },
          openai_image_model: {
            is_secret: false,
            validate: (v) => {
              const s = String(v).trim();
              if (!s) throw new Error('Model name required');
              // Allow alphanumeric + dash + dot (gpt-image-2, dall-e-3, etc.)
              if (!/^[a-z0-9.-]+$/i.test(s)) throw new Error('Model name must be alphanumeric + dash/dot only');
              if (s.length > 64) throw new Error('Model name too long');
              return s;
            },
          },
          openai_image_quality: {
            is_secret: false,
            validate: (v) => {
              const s = String(v).trim().toLowerCase();
              // §2026-05-22: gpt-image-2 changed the quality enum from
              // the gpt-image-1 era (standard|hd) to (low|medium|high|auto).
              // Accept both during transition so admins migrating from
              // gpt-image-1 → gpt-image-2 don't get blocked, but the OpenAI
              // API itself will reject standard/hd for gpt-image-2 (we
              // surface the actionable hint in /api/admin/openai/test).
              const allowed = ['low', 'medium', 'high', 'auto', 'standard', 'hd'];
              if (!allowed.includes(s)) throw new Error(`Quality must be one of ${allowed.join(' / ')}. For gpt-image-2 use low/medium/high/auto; standard/hd are gpt-image-1 era only.`);
              return s;
            },
          },
          openai_image_size: {
            is_secret: false,
            validate: (v) => {
              const s = String(v).trim().toLowerCase();
              // OpenAI gpt-image-1 accepts: 1024x1024, 1024x1792, 1792x1024
              if (!/^\d{3,5}x\d{3,5}$/.test(s)) throw new Error('Size must be WIDTHxHEIGHT (e.g. 1792x1024)');
              return s;
            },
          },
          use_storyboard_pipeline: {
            is_secret: false,
            validate: (v) => {
              const s = String(v).trim().toLowerCase();
              if (!['true', 'false'].includes(s)) throw new Error('Value must be "true" or "false"');
              return s;
            },
          },

          /* ── §2026-05-26 fei (audit #9) — Drama paywall global config ──
           *   Pre-2026-05-26 these keys lived in DB but had no admin UI
           *   path → ops had to SQL into Supabase to change them. Added to
           *   the allow-list so admin can tune via the Settings tab. Paired
           *   with LABELS entries in AdminDashboard.jsx so each gets a
           *   friendly description + edit hint. */
          default_revenue_share_pct: {
            is_secret: false,
            validate: (v) => {
              const n = parseFloat(String(v).trim());
              if (Number.isNaN(n)) throw new Error('Value must be a number (percentage)');
              if (n < 0 || n > 100) throw new Error('Share % must be between 0 and 100');
              return String(n);
            },
          },
          default_channel_fee_pct_web: {
            is_secret: false,
            validate: (v) => {
              const n = parseFloat(String(v).trim());
              if (Number.isNaN(n)) throw new Error('Value must be a number');
              if (n < 0 || n > 50) throw new Error('Channel fee % must be 0-50 (Stripe ~3, Apple ~30)');
              return String(n);
            },
          },
          default_platform_service_pct: {
            is_secret: false,
            validate: (v) => {
              const n = parseFloat(String(v).trim());
              if (Number.isNaN(n)) throw new Error('Value must be a number');
              if (n < 0 || n > 50) throw new Error('Platform service % must be 0-50');
              return String(n);
            },
          },
          ucoins_to_usd_cents: {
            is_secret: false,
            validate: (v) => {
              const n = parseInt(String(v).trim(), 10);
              if (!Number.isInteger(n) || n <= 0) throw new Error('Conversion rate must be a positive integer (cents per U-Coin)');
              if (n > 100) throw new Error('Sanity check: rate > 100 cents/coin? Verify before saving.');
              return String(n);
            },
          },
          default_include_acquisition_cost: {
            is_secret: false,
            validate: (v) => {
              const s = String(v).trim().toLowerCase();
              if (!['true', 'false'].includes(s)) throw new Error('Value must be "true" or "false"');
              return s;
            },
          },
          /* JSON-typed keys — validate parses-as-object + minimal shape so a
           * typo doesn't silently break the consumer code. Stored as JSON
           * string (matches DB column = text). */
          ucoins_packages: {
            is_secret: false,
            validate: (v) => {
              const s = String(v).trim();
              let parsed;
              try { parsed = JSON.parse(s); } catch { throw new Error('Value must be valid JSON array of packages'); }
              if (!Array.isArray(parsed)) throw new Error('Must be a JSON array');
              for (const pkg of parsed) {
                if (typeof pkg.id !== 'string') throw new Error('Each package needs string id');
                if (!Number.isInteger(pkg.price_cents) || pkg.price_cents <= 0) throw new Error(`Package ${pkg.id}: price_cents must be positive integer`);
                if (!Number.isInteger(pkg.ucoins) || pkg.ucoins <= 0) throw new Error(`Package ${pkg.id}: ucoins must be positive integer`);
              }
              return s;
            },
          },
          drama_member_tiers: {
            is_secret: false,
            validate: (v) => {
              const s = String(v).trim();
              let parsed;
              try { parsed = JSON.parse(s); } catch { throw new Error('Value must be valid JSON array of tier names'); }
              if (!Array.isArray(parsed) || parsed.some(t => typeof t !== 'string')) {
                throw new Error('Must be a JSON array of strings (e.g. ["starter","creator","studio"])');
              }
              return s;
            },
          },
          llm_token_prices: {
            is_secret: false,
            validate: (v) => {
              const s = String(v).trim();
              let parsed;
              try { parsed = JSON.parse(s); } catch { throw new Error('Value must be valid JSON object'); }
              if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Must be a JSON object mapping model → {input_per_million_usd, output_per_million_usd}');
              for (const [m, entry] of Object.entries(parsed)) {
                if (!entry || typeof entry !== 'object') throw new Error(`${m}: entry must be object`);
                if (typeof entry.input_per_million_usd !== 'number') throw new Error(`${m}: input_per_million_usd must be number`);
                if (typeof entry.output_per_million_usd !== 'number') throw new Error(`${m}: output_per_million_usd must be number`);
              }
              return s;
            },
          },
        };
        const meta = VALIDATORS[key];
        if (!meta) {
          throw new Error(`key "${key}" is not in the editable allow-list. Add a validator in /api/admin/system-settings/update to enable.`);
        }
        const normalizedValue = meta.validate(rawValue);

        // UPSERT via PostgREST (Prefer: resolution=merge-duplicates handles
        // ON CONFLICT for us). We always set updated_by to the caller and
        // is_secret (consistent for the lifetime of the row — admin can't
        // accidentally toggle a non-secret to secret or vice-versa).
        const upsertResp = await fetch(`${supabaseUrl}/rest/v1/system_settings`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
            'apikey': env.SUPABASE_SERVICE_ROLE_KEY,
            'Content-Type': 'application/json',
            'Prefer': 'resolution=merge-duplicates,return=representation',
          },
          body: JSON.stringify({
            key,
            value: normalizedValue,
            is_secret: meta.is_secret,
            updated_by: caller.id,
            // description left null — preserved if existed before
          }),
        });
        if (!upsertResp.ok) {
          const t = await upsertResp.text().catch(() => '');
          throw new Error(`system_settings UPSERT failed (${upsertResp.status}): ${t.slice(0, 300)}`);
        }
        const rows = await upsertResp.json().catch(() => []);
        const row = Array.isArray(rows) ? rows[0] : rows;

        // Invalidate this isolate's cache; other isolates pick up on TTL
        invalidateSystemSettingCache(key);

        // Never log the raw value of a secret — only key + length + last 4
        if (meta.is_secret) {
          console.log(`[admin/system-settings] ${caller.email || caller.id} set ${key} (secret, len=${normalizedValue.length}, suffix=…${normalizedValue.slice(-4)})`);
        } else {
          console.log(`[admin/system-settings] ${caller.email || caller.id} set ${key}=${normalizedValue}`);
        }

        // Mask the response value for secrets — the admin already typed it
        // and doesn't need it echoed back. Frontend treats `value:'<configured>'`
        // as a successful save indicator without exposing the cleartext.
        const responseValue = meta.is_secret ? '<configured>' : normalizedValue;

        return new Response(JSON.stringify({
          success: true,
          key,
          value: responseValue,
          is_secret: meta.is_secret,
          updated_at: row?.updated_at || new Date().toISOString(),
        }), {
          status: 200,
          headers: { 'Content-Type': 'application/json', ...corsHeaders }
        });
      } catch (err) {
        console.error('[admin/system-settings] update', err.message);
        return new Response(JSON.stringify({ success: false, errMessage: err.message }), {
          status: 500,
          headers: { 'Content-Type': 'application/json', ...corsHeaders }
        });
      }
    }

    // ─── Self-hosted FFmpeg core wasm (R2-primary, unpkg-fallback) ──────
    // The 32 MB ffmpeg-core.wasm exceeds Workers Assets' 25 MiB per-file
    // limit, so it can't ship with the app bundle. Strategy:
    //   1. Prefer R2 at key `ffmpeg/ffmpeg-core.wasm` (low latency, no
    //      external dep — populate via scripts/upload-ffmpeg-wasm.sh).
    //   2. Fall back to unpkg.com pinned to the version in package.json
    //      so deploys to fresh accounts (where R2 wasn't seeded yet)
    //      still produce a working Combine button. CF edge-caches our
    //      response for a year — first request takes ~300ms to proxy
    //      unpkg, subsequent requests are instant.
    //
    // §2026-05-25 fei: added the unpkg fallback after a deploy to fei's
    //   account exposed that the wasm was never uploaded — combine step
    //   failed with "WebAssembly.Module doesn't parse at byte 0" because
    //   the not-found error string was being served as text/html (which
    //   CF then cached at the edge with status 200). The fallback path
    //   keeps the same-origin contract (no CORS issues for the FFmpeg-
    //   spawned module worker) — we proxy, not redirect.
    if (url.pathname === '/ffmpeg/ffmpeg-core.wasm' && request.method === 'GET') {
      try {
        const obj = await env.BUCKET.get('ffmpeg/ffmpeg-core.wasm');
        if (obj) {
          return new Response(obj.body, {
            headers: {
              'Content-Type': 'application/wasm',
              'Cache-Control': 'public, max-age=31536000, immutable',
              'X-FFmpeg-Source': 'r2',
            },
          });
        }
        // R2 miss → proxy from unpkg. Version pinned to match
        //   package.json's @ffmpeg/core dependency so the bytes the
        //   browser executes always match the .js it was paired with
        //   (mismatch = silent corruption).
        const FFMPEG_CORE_VERSION = '0.12.10';
        const unpkgUrl = `https://unpkg.com/@ffmpeg/core@${FFMPEG_CORE_VERSION}/dist/esm/ffmpeg-core.wasm`;
        const upstream = await fetch(unpkgUrl, {
          // CF will cache this at the colo per the response's own
          //   cache-control (unpkg sends max-age=31536000), so subsequent
          //   requests from this region are served from cache without
          //   another origin hop.
          cf: { cacheTtl: 31536000, cacheEverything: true },
        });
        if (!upstream.ok) {
          return new Response(`FFmpeg wasm unavailable (R2 empty, unpkg returned ${upstream.status})`, { status: 502 });
        }
        return new Response(upstream.body, {
          headers: {
            'Content-Type': 'application/wasm',
            'Cache-Control': 'public, max-age=31536000, immutable',
            'X-FFmpeg-Source': 'unpkg-fallback',
          },
        });
      } catch (err) {
        return new Response('Error serving wasm: ' + err.message, { status: 500 });
      }
    }

    // Serve all other requests from Cloudflare Pages static assets
    return env.ASSETS.fetch(request);
  }
};
