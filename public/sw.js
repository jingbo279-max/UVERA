/* ═══════════════════════════════════════════════════════════════════════════
   UVERA Service Worker — PWA offline shell + cache strategy
   ───────────────────────────────────────────────────────────────────────────
   Strategy: Network-first for navigation & API, Cache-first for static assets.
   Critical: NEVER intercept video/audio/Range requests — browsers issue
   HTTP Range requests for media playback and the server returns 206 Partial
   Content; Cache API rejects 206 responses with TypeError, which then takes
   down the entire FetchEvent. This SW used to do that and broke playback
   for every user-uploaded video on Discover.
   ═══════════════════════════════════════════════════════════════════════════ */

// Bump on each policy change so old SW + caches get evicted.
//   v1 (initial): blanket cache.put(response) — broke media via 206.
//   v2 (2026-05-09): skip Range/media/non-200, defensive put().catch().
//   v3 (2026-05-13): force eviction after profile-data normalization fix.
//   v4 (2026-05-14): install resilience — Promise.allSettled so any one
//     precache miss doesn't reject the whole install; activate doesn't
//     delete old caches until new cache is confirmed populated (avoids
//     甲方-report'd "Offline" plaintext when v3 install partially failed);
//     navigation fallback returns proper HTML page instead of bare text;
//     opportunistic SWR caches '/' on every successful fetch.
//   v5 (2026-05-22): forced eviction after AI-Character concept deletion.
//     fei reported "9/8 Characters · Upgrade to Studio" alert still firing
//     post-deploy — source code IS clean (commit 97702a8 deleted the
//     trigger + the entire concept), but v4 was serving cached /index.html
//     that pointed to the OLD bundle hash. Bumping forces every existing
//     SW instance to evict v4 + re-fetch /index.html on next navigation,
//     which then loads the new bundle without the alert.
//   v6 (2026-05-22): OpenAI prompt-moderation auto-retry + frontend
//     reason-map extension (openai_prompt_moderation). New deploy needs
//     SW bump so the safety-fallback alert text comes from the new
//     bundle, not the v5-cached one.
//   v7 (2026-05-22): Storyboard token cost + regenerate-confirm modal.
//     Cost breakdown UI changed materially (entry shows storyboard +
//     video rows; regenerate shows storyboard-only). Old cached bundle
//     would show flat-cost UI with no breakdown.
//   v8 (2026-05-22): Genre-aware camera presets + 2 new VIDEO_TYPES
//     (Art Film / Product). Old cached bundle missing the new options
//     in the genre picker AND missing the videoType payload field that
//     drives storyboard camera language in the worker.
//   v9 (2026-05-22): Script-gen shot-count hint per videoType. Old bundle
//     keeps sending vanilla augmentedTranscript without the shot count
//     section, → still 3-shot output. Bumping forces fresh fetch so the
//     new prompt augmentation takes effect.
//   v10 (2026-05-22): formatError surfaces asset-library upload diagnostic
//     (previously hidden behind generic safety-filter friendly message,
//     so admin couldn't see WHY upload failed). Combined with worker's
//     new step 4b (image-path text-only fallback). Need fresh bundle for
//     the new formatError logic to kick in.
//   v11 (2026-05-22): BytePlus Asset Library admin test card. New UI
//     component (BytePlusTestCard) in System Settings tab triggers
//     /api/admin/byteplus/test for end-to-end round-trip validation.
//   v12 (2026-05-22): videoType-curated style picker. Was 11-style flat
//     list with category tabs; now 3 curated styles per genre (Trailer
//     gets cinematic/arcane/steampunk, MV gets spider-verse/cyberpunk/
//     retrowave, etc). Bump so old bundle's category-tabs UI doesn't
//     conflict with new curated-trio UI.
//   v13 (2026-05-22): RECOVERY bump. Leon deployed main branch (4 design
//     commits, none of mine since 6027362) — wiped out v5-v12 + Character
//     deletion + storyboard pipeline improvements + BytePlus test card +
//     videoType-curated styles. fei caught it ("Character alert again,
//     style wrong, did someone else submit?"). Merged Leon's 4 commits
//     into our 139, redeploying. v13 bump forces eviction of whatever
//     Leon's deploy cached so browsers fetch fresh /index.html.
//   v14 (2026-05-22): Render confirm modal embeds resolution + model
//     selectors with reactive cost. Render-station selectors locked to
//     read-only (price was lockable BEFORE this). Bumping so old bundle
//     UI (selectors inside render station) doesn't conflict with new UI
//     (selectors inside modal).
//   v15 (2026-05-22): "Deploy to global CDN" no longer blocks user. Once
//     Seedance returns, render shows complete + TOS URL playable. CDN
//     upload runs as fire-and-forget background task, silently upgrading
//     URLs + DB row when done. Old bundle would still await the upload
//     synchronously — bump forces fresh fetch.
//   v16 (2026-05-22): admin Logs view adds storyboard_image filter +
//     fuchsia badge. Old bundle's TYPE_FILTERS list missing the entry.
//   v17 (2026-05-22): defensive validation in logApiStart against the
//     CHECK constraint allow-lists (VALID_GENERATION_TYPES + VALID_VENDORS).
//     Plus extended migration to also fix vendor='openai' violation.
//     Pure worker + migration change, but bump anyway for hygiene.
//   v18 (2026-05-22): Actor creation flow moved from StoryGenerator step 0
//     to LibraryPage. StoryGen empty state + "+New Actor" tile both
//     navigate('/library') now. Library has InlineCharacterCreator inline
//     above the avatars grid.
//   v19 (2026-05-22): Free mode "Pick Actor / Char" pickers (3 of them —
//     main asset picker, generate-asset reference picker, series cast
//     picker) filtered to show only source Avatars (no AI-generated
//     character rows). Label simplified to "Pick Actor".
//   v20 (2026-05-22): iOS Safari "video frame shown then goes black"
//     fix. Three changes: add playsInline+muted+preload="auto" to the
//     render-complete <video>; STOP setPreviewVideoUrl(permanentVideoUrl)
//     mid-playback (was triggering iOS reload-then-black on src swap);
//     keep finalVideoUrl upgrade for share/publish use.
//   v21 (2026-05-22): iOS "闪黑" round-2 — add poster={storyboardUrl}
//     so rebuffer/load gaps show storyboard image instead of pure black,
//     plus safe URL upgrade onEnded (swap to CDN URL when not playing,
//     for fast replay). Doesn't fix Volces TOS slowness fundamentally
//     — that's a CDN routing issue with Chinese-origin signed URLs.
//   v22 (2026-05-22): Spark feed swipe-back fix. Pre-render prev slot
//     (pos=0) in addition to active+next, so swipe-down doesn't mount
//     a fresh <video> from scratch (which causes 1-3s black on iOS).
//     Bandwidth cost: ~50KB extra metadata per video, worth it for UX.
//   v23 (2026-05-22): UNIFIED VIDEO PLAYER. All videos now go to CF
//     Stream (worker /api/stream/upload-from-url drops the paid-tier R2
//     branch; all tiers → Stream). UnifiedVideoPlayer + hls.js renders
//     everything in native <video> — no more <Stream> iframe in SparkMode.
//     iOS Safari swipe smooth; non-Safari uses hls.js via MSE. Old bundle
//     cached with the dual-player paths would regress. Bump forces fresh.
//   v24 (2026-05-22): Recast feature flagged off via RECAST_ENABLED=false
//     in src/data/features.js. All UI surfaces gated: SparkMode Recast
//     buttons (mobile+desktop), LightboxPlayer Recast button, Library
//     Recasts tab, UserProfile Recasts segmented control, '#Recast' tag
//     picker, and the publish-time "Allow Recast" checkbox. Backend +
//     DB columns untouched. Old bundle still shows the Recast UI.
//   v25 (2026-05-22): MigrateVideosCard in admin System Settings — one-
//     click batch migration of legacy R2/TOS videos to Cloudflare Stream
//     (was a CLI-only path requiring manual JWT extraction). Auto-grabs
//     JWT from active admin session via supabase.auth.getSession().
//   v26 (2026-05-22): hotfix — CircleNotch missing from AdminDashboard
//     imports caused MigrateVideosCard to crash on "Preview candidates"
//     click ("ReferenceError: CircleNotch is not defined").
//   v27 (2026-05-22): MigrateVideos round-2 — poll-until-ready before
//     PATCH so DB never has non-playable URL (was: PATCH immediately,
//     causing 503 for 1-3min while CF Stream transcoded). Batch size
//     10 → 2 to fit poll budget inside CF Worker wall-time. UI shows
//     new 'patched-while-processing' state (amber ⏳) for videos where
//     transcode exceeded 45s timeout but DB was still PATCHed.
//   v28 (2026-05-22): + "🏥 Diagnose Stream URLs" button in admin —
//     queries each migrated Stream URL's actual readiness state, surfaces
//     errorReason / pctComplete for stuck videos. Useful for diagnosing
//     503 playback on pre-v27 migrated rows.
//   v29 (2026-05-23): MigrateVideosCard fixes —
//       · runPreview: missing setPhase('idle') on success kept the spinner
//         spinning forever (preview panel only renders when phase==='idle'
//         && preview, so it never appeared). Now uses finally{} to always
//         reset phase.
//       · Migration spinner now shows live "Xs elapsed" counter + warns red
//         when batch exceeds 120s, so users can tell a long poll-until-ready
//         batch from a hang.
//   v30 (2026-05-23): MigrateVideosCard empty-state + console-log diagnostics.
//       · Migration completing with 0 items previously left the card blank
//         (running-block needs items.length > 0, done-block needs items.length
//         > 0, idle-buttons hidden when phase='done'). Now shows explicit
//         "✓ All videos already on Stream — nothing to migrate" panel.
//       · runMigration now console.logs each batch request/response so blank
//         screens can be diagnosed from devtools without redeploying.
//   v31 (2026-05-23): MigrateVideosCard — root-cause fix for blank-card.
//       The v29/v30 fixes patched specific empty-state holes, but the
//       underlying design flaw was that the action buttons were gated by
//       `phase === 'idle'`, so ANY phase transition could leave the body
//       empty if no result-panel matched. Restructured: buttons ALWAYS
//       visible (disabled while busy). Preview/migration result panels
//       also relaxed — preview shows whenever `preview` is set, migration
//       "0 videos" empty-state always shows when phase==='done'. User can
//       no longer end up staring at a blank card.
//   v32 (2026-05-23): unify ALL playback to UnifiedVideoPlayer + TikTok-style
//       HLS lookahead prefetch.
//       · Migrations: Hero, MasonryGrid, LightboxPlayer, SeriesDetailPage,
//         admin uploader-preview + works-modal — all now render via
//         UnifiedVideoPlayer instead of <Stream> iframe / hardcoded iframe.
//         hls.js is lazy-imported so the main bundle stays slim (~500KB
//         only loads when a non-Safari user first plays HLS).
//       · SparkMode prefetch: for items at index+2 / index+3, fires a
//         low-priority cached fetch() of the HLS manifest (for Stream URLs)
//         or Range 0-256KB (for direct mp4) to warm the browser HTTP cache.
//         When the slot scrolls into ±1 visible range, hls.js / <video>
//         loads from cache → instant first-frame paint. Skipped on
//         save-data / 2g connections.
//   v60 (2026-05-25): Free Mode DB persist — surface silent failures + Works
//       refresh button.
//       User report: 'FreeMode 生成的内容在 library 看不到记录'.
//       Root cause: handleFreeSegmentGenerate's insert was destructuring
//       only `data` from the Supabase call, NOT `error`. Supabase doesn't
//       throw on RLS / schema / CHECK constraint errors — it returns them
//       via `error`. The try/catch only caught network errors. So if the
//       insert silently failed (most likely missing cover/aspect_ratio
//       field, or RLS blocking, or some other constraint), the user
//       saw 'video generated' but nothing in Library.
//       Fix:
//         · Destructure { data, error } properly. Loud-fail with full
//           Postgres error message via alert() so user knows what
//           happened + can screenshot for debug.
//         · Set cover field explicitly (derived from CF Stream UID:
//           videodelivery.net/<uid>/thumbnails/thumbnail.jpg). Was
//           previously omitted — Works tab relied on a derived fallback
//           added in v53 but having it on the row is cleaner.
//         · Empty-rows-no-error case (RLS denial that returns 0 rows
//           silently) — also alert.
//         · Console.error verbose so devtools shows the failed row.
//       Library Works tab: added a manual Refresh button (top-right of
//       grid). Increments worksRefreshSeq state which is in the effect
//       deps, triggering re-fetch. Helps users who just generated
//       something elsewhere and come back to Library without changing
//       tab (per-tab effect won't auto-refetch otherwise).
//   v59 (2026-05-25): Library work-modal video player — use UnifiedVideoPlayer.
//       User report: "library 中点击打开预览，应该是播放stream的视频".
//       The work modal video was using raw <video src={url}> which
//       can't play Cloudflare Stream HLS URLs on non-Safari browsers
//       — showed 0:00/0:00 black player. This is the same class of bug
//       fixed for StoryGeneratorPage in v52 and confirmed user wanted
//       direct download (v57's downloadVideo helper handles that path).
//       Fix: replaced <video> with UnifiedVideoPlayer. forwardRef
//       preserves the existing workVideoRef.current.play() / .pause() /
//       .currentTime / .muted usage. onClick moved to a wrapper div
//       (UnifiedVideoPlayer doesn't pass onClick through; div catches
//       the bubbled click for play/pause toggle).
//   v58 (2026-05-25): draft restore now lands on highest-data step.
//       User report: 'Library 草稿中的记录点开后没有回到之前的状态'.
//       Card showed 'Quick Mode · Step 1' but actually had generatedScript
//       + style filled in (saved from Step 3 originally). Restore used
//       draft.step=0 (some prior error handler reset it before
//       auto-save fired), so user landed back on Step 0 / Avatar select.
//       Their script + style were silently still in localStorage but
//       hidden behind a Step 0 page.
//       Fix: when restoring, infer step from data presence (not from
//       saved step). renderProgress>=1 → step 4, generatedScript →
//       step 3, selectedStyle → step 2, transcript → step 1. Use
//       max(saved_step, inferred_step) so user routes to the latest
//       valid step their data supports.
//       Same inference in LibraryPage draft card so the badge shows
//       a meaningful step name ('剧本审阅' / '渲染中' / etc.) instead
//       of literal '1'.
//   v57 (2026-05-25): direct video download for CF Stream URLs.
//       User report: "下载视频是跳出一个页面，我希望直接下载视频文件，
//       在 stream 下载视频可能需要预处理后才可以".
//       Root cause: clicking Download on a Stream-hosted video did one of:
//         · `window.open('iframe.cloudflarestream.com/<uid>')` → new tab
//           opens the iframe player HTML page, not a video file
//         · `fetch(url).blob()` → got a 1KB m3u8 HLS manifest text, not
//           an mp4. Saved as video.mp4 it's a corrupt file.
//       CF Stream requires you to POST /downloads first to GENERATE the
//       mp4 (takes 10-60s server-side), then GET the resulting URL.
//       Fix:
//         · NEW worker endpoint POST /api/stream/enable-download.
//           Idempotent. Returns { status: ready|inprogress|error,
//           url?, percentComplete? }
//         · NEW src/utils/downloadVideo.js shared helper:
//             1. Detect Stream URL via existing streamUrl utils
//             2. If Stream: poll the endpoint every 3s up to 2min,
//                report progress via onProgress hook
//             3. Once ready, fetch the mp4 URL as blob + trigger
//                browser native download (synthetic <a download> click)
//             4. For non-Stream URLs (R2 direct), skip pre-process and
//                blob-fetch immediately
//         · Replaced inline download code in LibraryPage (work modal
//           player) + SparkMode (spark video download). Both surface
//           progress text + spinner on the button so user sees it
//           working through the (potentially long) Stream mp4 prep.
//   v56 (2026-05-25): auto-retry on BytePlus output-audio safety rejection.
//       User report: "Generation failed: The request failed because the
//       output audio may contain sensitive information"
//       Root cause: BytePlus Seedance has a downstream safety filter on
//       the generated AUDIO track (separate from input image / prompt
//       moderation). Dialog-rich prompts sometimes produce TTS that the
//       filter flags. The visual generation succeeded — only the audio
//       track is the problem.
//       Fix: detect this specific error message (regex 'output audio.*
//       sensitive|audio.*sensitive information') in both
//       renderSegmentVideo (multi-segment Step 4) and
//       handleFreeSegmentGenerate (Free Mode). On hit, auto-retry the
//       same prompt with generateAudio=false. User gets a silent video
//       instead of a hard failure + refund + 0 asset. Alert tells them
//       the audio was blocked so they understand why their result is
//       silent.
//       Plus formatError fallback for any caller without auto-retry
//       — clean Chinese explanation instead of raw 'Generation failed:'
//       prefix.
//   v55 (2026-05-25): cleaner user-facing error for OpenAI geo-block.
//       After v54's auto-retry exhausts (all 3 attempts hit geo-block),
//       worker now throws a clean Chinese message instead of raw OpenAI
//       JSON:
//         "OpenAI 在当前地区不可用：本次请求被路由到了 OpenAI 不支持的
//          出口节点（CF Workers 跨地区调度有时会命中黑名单）。已自动
//          重试 3 次仍失败。请等 1-2 分钟后重试 —— Cloudflare 会换出口
//          路由，通常下一次就能成功。"
//       Frontend formatError() recognizes the marker tag and shows the
//       worker's Chinese message verbatim (no 'Failed: (...)' prefix
//       wrapping). Backward-compat fallback handles older worker
//       responses that still leak raw OpenAI JSON.
//   v54 (2026-05-25): OpenAI 403 geo-block retry-wrapper.
//       User report: intermittent "OpenAI image API 403: unsupported_
//       country_region_territory" 500s on /api/generate-storyboard.
//       Root cause: CF Workers can route OpenAI requests through colos
//       whose outbound IPs OpenAI's geo-block treats as unsupported
//       (HK/CN/etc. randomly). The very next request to the same
//       endpoint often succeeds because CF reroutes.
//       Fix: withGeoRetry() wrapper around both /v1/images/generations
//       and /v1/images/edits. Retries up to 3 times with 600ms-1.8s
//       backoff on 403+unsupported_country specifically. If all 3
//       attempts fail, error message tells user to wait 1-2 min and
//       retry (CF will rebalance routing by then).
//   v53 (2026-05-24): Free Mode drafts + works visibility in Library.
//       User report: "Free Mode 创建中的草稿和完成的作品，都应该加入到
//       Library 中，现在没有添加".
//       Two real bugs found:
//
//       (1) Drafts: the auto-save effect early-returned with
//             `if (step === 0 && !selectedCharacterId) return`
//           — Free Mode has no character step so this gate triggered
//           on every Free Mode session. NO Free Mode draft was ever
//           saved. The Library drafts tab read uvera_story_draft but
//           only matched parsed.transcript / parsed.generatedScript
//           — Free Mode fields ignored either way.
//
//           Fix: per-mode persistence gate. Free Mode saves whenever
//           any of (freePrompt, freeAssets, freeSegments) is non-empty.
//           Draft now carries generationMode + timestamp + freeAssets
//           + freeSegments + freeDuration + videoRatio/Resolution/Model.
//           Restore on mount sets generationMode='free' first, then
//           restores all Free Mode state. Reset clears Free Mode too.
//
//           Library drafts tab: recognizes Free Mode drafts (matches
//           freePrompt/freeAssets/freeSegments). Draft card shows
//           "Free Mode · N 段" badge in emerald + Continue button
//           routes to /create/short/free instead of /create.
//
//       (2) Works: completed Free Mode segments WERE saving to
//           recommended_content with tag #FreeSegment (they appear in
//           the DB), but the Works tab thumbnail fallback used a fake
//           `image.mux.com/<url>/thumbnail.jpg` URL that doesn't exist
//           for our CF Stream videos. So Free Mode works showed broken
//           thumbnails and looked invisible.
//
//           Fix: derive thumb URL from Stream UID
//           (`videodelivery.net/<uid>/thumbnails/thumbnail.jpg`) when
//           no cover. + onError handler hides broken images. + neutral
//           placeholder card underneath. + emerald "Free Mode" badge
//           on cards tagged #FreeSegment for easy visual identification.
//   v52 (2026-05-24): fix Free Mode segment / lightbox video playback.
//       User report: "quickMode 的 segment 中的视频无法播放" — black
//       player with controls but no actual video.
//       Root cause: 3 raw <video src={url}> in StoryGeneratorPage that
//       were never migrated to UnifiedVideoPlayer when we moved
//       everything to CF Stream in v32. seg.url is a Stream HLS URL
//       (videodelivery.net/<uid>/manifest/video.m3u8) which plain
//       <video src=> can't play on non-Safari browsers.
//       Fixes (replaced <video src={url}> with UnifiedVideoPlayer):
//         · Free Mode segment timeline player (the segment cards under
//           "Segment timeline (N)")
//         · Asset Lightbox (full-screen preview when clicking an asset)
//         · "Recent segments" thumbnail row
//       Also imported UnifiedVideoPlayer at the top of the file (was
//       previously not imported — that's why these sites never got
//       upgraded in v32).
//   v51 (2026-05-24): Free Mode certification UI — visibility + contrast fixes.
//       User report: "认证提醒的字体颜色看不清" + "没有上传认证的功能按钮".
//       v50's banner used text-amber-200 on bg-amber-500/10 — invisible
//       in light mode. The cert button was opacity-0 group-hover, so
//       on touch/mobile or anywhere user didn't hover it was invisible.
//       Fixes:
//         · Banner: text-amber-900 dark:text-amber-100 + bg-amber-50
//           dark:bg-amber-950/40 with border-amber-500/60 — strong
//           contrast in both themes.
//         · Cert button moved BELOW the card thumbnail. Always visible,
//           full-width of the 24-col card (w-24), color-coded by state:
//           amber (needs cert) / blue (in progress) / emerald (done) /
//           red (failed). Text label "认证 / 认证中 / 已认证 / 重试认证"
//           always shown next to icon — no tooltip-only states.
//         · Certified badge (ShieldCheck) still shown in card top-left
//           corner for at-a-glance verification.
//   v50 (2026-05-24): Free Mode — asset certification UI + Invalid-video_url
//       error UX.
//       (1) New endpoint POST /api/byteplus/certify-asset wraps
//           uploadRealPersonAssetToBytePlus so users can manually certify
//           reference assets (uploads to BytePlus Private Asset Library,
//           returns asset://<id> URI that bypasses the safety filter).
//       (2) Free Mode UI: each asset card now has a Shield icon button
//           bottom-left. States: ShieldWarning (uncertified) → spinner
//           (certifying) → ShieldCheck green (certified) → red on failure
//           (click to retry). Hover-visible by default; certified state
//           always visible.
//       (3) Banner above asset list when any asset is uncertified:
//           "真人参考？先认证素材" with explanation + how-to.
//       (4) Generation: imageUrls / videoUrls use asset.certifiedUri when
//           present, fallback to asset.url. So certified assets ride
//           through as asset://xxx URIs that BytePlus accepts.
//       (5) Error handler: when Seedance returns "Invalid video_url" /
//           "Invalid image_url", translate to actionable message —
//           "需要参考素材" (no assets) or "尝试认证素材" (has assets).
//   v49 (2026-05-23): Free Mode — +4 aspect ratios + @-picker stability.
//       (1) Ratio selector extended from 3 to 7 options. Added 21:9, 9:21,
//           4:3, 3:4. Seedance supports arbitrary ratios via the ratio
//           param so no backend change needed.
//       (2) @-mention asset picker bugs fixed:
//             · Picker no longer jumps as text wraps (was using
//               document-space caret coords as wrapper-relative).
//             · Focus no longer snaps to position 0 when typing @ (the
//               getCaretCoordinates helper appended a hidden mirror div
//               to document.body, which sometimes triggered a reflow
//               that stole textarea focus).
//           Both fixed by dropping the caret-measurement entirely and
//           anchoring the picker to the textarea's bottom edge via CSS
//           (top-full + mt-2). Slightly less precise visually but
//           rock-solid stable.
//   v48 (2026-05-23): defensive: pending-video-task TTL 24h → 30 min.
//       User report: "Continue draft" → 503 (Offline) in console.
//       Most likely cause: pending_video_task localStorage entry from
//       a previous session pointed to a Seedance taskId that's now stale
//       (task done / discarded). resumeVideoPolling auto-fires on mount,
//       polls the stale ID, worker returns 503, SW shows offline banner.
//       Fix: cap recovery age at 30 min — legit tasks complete in 3-5
//       min, anything older is silently dropped at mount with no fetch.
//   v47 (2026-05-23): NEW worker endpoint /api/generate-multi-segment-script.
//       Bypasses Supabase aiscreenwriter (whose output schema doesn't
//       support our segments[] contract — kept returning empty segment
//       envelopes). New endpoint uses Gemini directly with a system prompt
//       we fully control + server-side enforcement of:
//         · EXACTLY segmentCount segments (not more, not fewer)
//         · 2-4 shots per segment (videoType-tuned)
//         · 10-15s targetDurationSec per segment
//         · Story arc: hook → escalation → payoff
//         · Detected user language for all text
//         · Character continuity across segments
//       Frontend handleGenerateScript now calls the new endpoint when
//       segmentCount > 1 (with graceful fallback to legacy aiscreenwriter
//       on failure). segmentCount === 1 keeps legacy path entirely.
//   v46 (2026-05-23): multi-segment normalizer fix — empty-shots bug.
//       User report: picked story length, screenwriter LLM returned
//       `{ segments: [{}, {}, {}, {}, {}, {}] }` — 6 empty segment
//       envelopes with no shot bodies. v45 normalizer faithfully echoed
//       this back, producing 6 cards each showing "0 shots ~12s".
//       Fix:
//         · Always honor user's segmentCount (not the LLM's count).
//         · Build a shotPool from BOTH raw.shots AND
//           raw.segments[].shots.flat() — whichever has data wins.
//         · Split shotPool evenly across exactly N segments.
//         · New _llmReturnedNoShots diagnostic flag → Step 3 shows a
//           clear warning banner asking user to Regenerate or reduce
//           the segment count.
//   v45 (2026-05-23): multi-segment story rendering.
//       User can now pick 1-5 segments at Step 1 ("Story length" selector).
//       Each segment = 10-15s of video. ONE big storyboard image gets
//       generated upfront (multi-panel grid showing ALL shots across all
//       segments). Then each video segment is rendered separately with
//       the SAME reference image (the storyboard) and a DIFFERENT prompt
//       targeting that segment's shot range (panels X-Y).
//       Pipeline:
//         Step 1: pick segmentCount (1-5, default 1)
//         Step 2: pick style (unchanged)
//         Step 3: screenwriter returns segments[] (or frontend auto-splits
//                 flat shots[] into N pieces); UI shows per-segment cards
//         Step 4: storyboard generated once. Then per-segment render list —
//                 user clicks "Render Segment N" → pays cost → polls
//                 Seedance → 15s video shown inline. Repeat for each.
//         After all N done: "Combine into one video" button uses ffmpeg.wasm
//         to concat segment mp4s + uploads result via uploadToSecureOSS.
//       Backwards compat: segmentCount=1 keeps the entire legacy flow.
//   v44 (2026-05-23): Style library full rewrite — 21 GPT-image-2-optimized
//       styles in 5 new categories.
//       User feedback: the old 11-style + previously-proposed 114-style sets
//       both underperformed because their prompts were tuned for older
//       diffusion models (buzzword-heavy: 8K / masterpiece / intricate /
//       ultra-detailed) — GPT-image-2 doesn't reward that vocabulary and
//       actually dilutes the chosen style.
//       New design:
//         · 5 categories: 写实电影 / 动画 / 插画 / 概念艺术 / 商业
//         · 21 curated styles total
//         · Prompts rewritten for GPT-image-2:
//             ✓ Specific lighting (Rembrandt, chiaroscuro, volumetric,
//               golden-hour, wet-on-wet)
//             ✓ Specific composition (anamorphic 2.39:1, negative space,
//               handheld, near-lens passes)
//             ✓ Specific rendering medium (cel-shaded, oil impasto,
//               halftone, painterly oil-stroke on 3D)
//             ✓ Cultural references (Demon Slayer, Spider-Verse, Rembrandt,
//               Vogue, Miyazaki-FromSoftware)
//             ✗ No 8K / masterpiece / intricate / ultra-detailed
//         · VIDEO_TYPE_STYLES re-curated: 6 styles per videoType (was 3).
//       UI: image=null for all — placeholder is gradient + style.icon emoji
//       at large size. Real GPT-image-2 sample renders to replace later.
//       Backwards compat: old style IDs (cinematic-photorealistic, ghibli,
//       wes-anderson, etc.) fall through to defaults in buildStoryboardPrompt
//       — drafts referencing them get reset on videoType change as before.
//   v43 (2026-05-23): Character seed UI + AI expand endpoint.
//       Added a collapsible "Character role" editor on StoryGeneratorPage
//       step 0 (shown after actor is selected). Has:
//         · 1 freeform "Quick describe" textarea + [✨ AI 扩写] button.
//         · 5 editable fields: Name, Visual Medium, Character Seed,
//           Age/Body, Style, Other Details.
//         · AI button calls new /api/expand-character-seed worker endpoint
//           (Gemini, JSON output) which takes a short hint and produces
//           all 5 fields. Errors shown inline; user can edit by hand.
//       The 5-field seed is now passed to /api/generate-storyboard as
//       `characterSeed`; backend uses it to populate the [CHARACTER SEED]
//       block in buildStoryboardPrompt. Backend still has fallbacks so
//       users who don't touch the panel get reasonable defaults.
//   v42 (2026-05-23): + [CHARACTER SEED] 5-field block in buildStoryboardPrompt.
//       User asked to incorporate a structured character seed (CHARACTER
//       SEED / AGE / VISUAL MEDIUM / STYLE / OTHER DETAILS) inspired by
//       their Seralya Veil example. New optional `characterSeed` payload
//       object lets callers pass the 5 fields explicitly; backend falls
//       back to character.name + description with sensible defaults when
//       any field is missing, so the block is always populated.
//   v41 (2026-05-23): buildStoryboardPrompt rewritten — multi-panel storyboard
//       sheet (rough hand-drawn pencil/ink grid) instead of single key frame.
//       User request: switch from a single cinematic key image (rendered in
//       user-selected style) to a planning artifact — N panels in a 2x2/3x2/
//       4x3 grid, each one a rough hand-drawn sketch of one shot, with
//       annotation arrows (RED=camera, BLUE=body, GREEN=object, etc.) and
//       hand-lettered SHOT NAME + SHOT NOTE per panel.
//       Structure mirrors the reference template fei provided:
//         [STORYBOARD] meta, [LOOK] (rough pencil), [DETAIL LEVEL],
//         [PACE / MOTION LOGIC] (videoType-aware), [COLOR LOGIC] (grayscale
//         base + annotation color key), [ANNOTATION KEY], [ARROW / MARK
//         STYLE], [WORLD], [CAST], [DIRECTORIAL LANGUAGE], [OPENING /
//         ENDING LOGIC], [BOARD RULES], [SHOT NOTE RULES], [SEQUENCE
//         FORMAT], [SEQUENCE], [STYLE FLAVOR] (staging hint only — final
//         video rendering style does NOT apply to the storyboard sheet).
//       Decisions: model generates SHOT NAMES from action context, ref
//       photo used for character continuity (rendered as sketch), no
//       dialogue bubbles, all English vocabulary for cinematic clarity.
//   v40 (2026-05-23): real swipe smoothness — preload="auto" for next slot
//       + hls.js startFragPrefetch + tuned buffer params.
//       User feedback: v39 cache-warm helped a bit but "切换过去之后" 仍感觉
//       慢. Root cause: v39 only cached the m3u8 manifest (~3KB). The actual
//       first .ts segment (~500KB-2MB) was still cold when user swiped.
//       Fixes:
//         · SparkMode: preload changed from 'metadata' to 'auto' for the
//           NEXT slot (pos=2). Browser now buffers the first segment +
//           5-10s of video BEFORE the user swipes. When swipe lands,
//           play() can decode immediately. Prev (pos=0) kept as 'metadata'
//           — less likely target, save bandwidth.
//         · UnifiedVideoPlayer hls.js config:
//             - startFragPrefetch: true — fetch first fragment on attach
//               instead of waiting for play().
//             - maxBufferHole: 0.5 — start playback as soon as 0.5s
//               buffered (default ~10s).
//             - backBufferLength: 10 — aggressive memory eviction so
//               multiple pre-rendered slots don't exhaust iOS decoders.
//             - startLevel: -1 — auto-pick initial bitrate by bandwidth.
//   v39 (2026-05-23): 10-deep Spark lookahead prefetch + cover prefetch.
//       User request: preload beginning of 10 videos for smoother swipe.
//       Was: lookahead 2 items, manifest-only, skipped on Safari.
//       Now:
//         · Lookahead extended 2 → 10 items.
//         · Re-enabled on Safari (Stream URLs only — manifest fetch is
//           tiny + safe; we still skip direct-mp4 Range fetch on iOS to
//           avoid HTTP/2 contention).
//         · Each upcoming item also prefetches its cover image via
//           `new Image()`. Browser caches + decodes → instant poster
//           paint on swipe, no flash regardless of video mount latency.
//       Total ~250KB per index change (10 × ~25KB). Skipped on save-data
//       / slow-2g.
//   v38 (2026-05-23): mobile homepage pagination + Spark end-of-feed refresh.
//       User complaints:
//         · "播放列表播放完毕后...卡在了最后一个视频" — Spark stuck at end.
//         · "手机上首页推荐每次只显示25个推荐的视频...可以分页刷新" —
//           homepage should be 25-at-a-time with load-more / refresh.
//       Fixes:
//         · MasonryGrid: + mobilePageLimit + onLoadMore + onRefreshMobile
//           props. On mobile: slices grid to first N (=25 by default),
//           renders "加载更多" footer button. When all loaded → button
//           becomes "已加载全部 · 点击换一批" which reshuffles + resets.
//         · index.jsx: mobileGridLimit state (default 25), increments by
//           25 on Load More, resets on filter/tab change. handleMobileRefresh
//           reshuffles shuffledMediaItems + resets limit + scrolls to top.
//         · SparkMode: + onRefreshFeed prop. New triedEndSwipe state set
//           when user tries to swipe past last item; reset on index/feed
//           change. Renders "🎉 已看完所有视频" overlay with [🔄 刷新看
//           更多] + [⬆ 返回顶部] buttons. Parent's onRefreshFeed re-fetches
//           from DB (uses existing retryDiscoverFetch path).
//   v37 (2026-05-23): default sound ON + sync isMuted with real video.muted.
//       User complaint: "声音默认改为开启" + "按钮看上去时打开的，但声音没有
//       ，点击两次才会打开声音". Default was muted; unmute button required
//       two taps because UI showed unmuted while actual video.muted was true
//       (state desync from the v33/v35 iOS-autoplay fallback that force-
//       mutes when play() rejects on unmuted).
//       Fixes:
//         · index.jsx: const [isMuted] = useState(true) → useState(false).
//           Sound on by default. iOS will still force-mute on first load
//           (no user gesture) — see sync fix below — but after user
//           unmutes once, subsequent swipes stay unmuted (gesture credit
//           + Safari Media Engagement Index).
//         · UnifiedVideoPlayer: new onVolumeChange prop pass-through.
//         · SparkMode (mobile + desktop branches): listen to onVolumeChange
//           on the ACTIVE video; when actual v.muted ≠ React isMuted, call
//           setIsMuted(actual). The auto-mute fallback now immediately
//           updates the UI to show "muted" — first unmute tap does the
//           real unmute (no more 2-tap pattern).
//   v36 (2026-05-23): Spark feed ordering + watched-history filter.
//       User complaint: "目前是没有规律的，而且会不停循环播几段视频".
//       Old behaviour:
//         · DB query orders only by published_at (no popularity).
//         · IndexPage shuffles the result before passing to SparkMode →
//           any order is randomized away.
//         · SparkMode baseFeed sorted only by aspect ratio + capped at 20
//           items. Once index 19 reached, swipe-back hit the same 20.
//         · markAsWatched existed but no reader → watched filter never
//           applied → same videos again on next visit.
//       Fixes:
//         · watchedHistory.js: + getWatchedIds() / isWatched() readers,
//           FIFO cap at 1000 entries.
//         · SparkMode baseFeed: hybrid score sort (popularity × recency
//           + small vertical-orientation bonus), excludes watched IDs at
//           mount, 20-cap REMOVED. User now scrolls a real backlog of
//           unseen content in a meaningful order.
//   v35 (2026-05-23): iOS Safari unmuted-autoplay-after-swipe fix.
//       Symptom: "有时候视频不会自动播放，需要点击屏幕才可以继续".
//       Root cause: Safari rejects v.play() with NotAllowedError when
//       called outside a user-gesture handler chain AND the video isn't
//       muted. SparkMode defers setIndex by 330ms (snap animation), so by
//       the time UnifiedVideoPlayer's autoPlay useEffect calls play() in
//       the re-render, the user-gesture token is GONE — rejected.
//       Fixes:
//         · SparkMode handleTouchEnd: pre-play the target slot's <video>
//           SYNCHRONOUSLY in the touch handler, BEFORE the 330ms snap
//           setTimeout. iOS captures the user-gesture token at call time.
//           The play promise resolves later (when video has enough data)
//           but the authorization persists across the snap delay.
//         · Added data-slot-pos={pos} to each slot div so handleTouchEnd
//           can querySelector the target video without managing refs.
//         · UnifiedVideoPlayer autoPlay useEffect: defense-in-depth
//           mute-fallback. If play() rejects with NotAllowedError on an
//           unmuted video (e.g. a caller that doesn't have the user-gesture
//           trick), retry muted so the user at least sees video play; they
//           can tap volume to restore sound.
//   v34 (2026-05-23): aspect-ratio + poster-to-video gap fixes.
//       Issue 1: 16:9 landscape videos rendered as 9:16 portrait (only
//         center slice visible) in MasonryGrid cards, LightboxPlayer, and
//         SparkMode. Root cause: many recommended_content rows have wrong
//         /missing aspectRatio metadata; with object-fit:cover the
//         mismatched media got cropped to fit the assumed-portrait box.
//       Issue 2: video playback flashed black 0.5-1s between cover and
//         video. Root cause: the native `poster` attr is cleared the
//         instant src/MSE attaches; for Chrome (lazy hls.js dynamic
//         import + manifest fetch + first segment decode) there was a
//         long gap with no frame to paint.
//       Fixes:
//         · UnifiedVideoPlayer: when `poster` prop given, render it as
//           CSS background-image on the <video> element. Persists until
//           the first decoded frame paints over it — no black flash.
//         · MasonryGrid cover img + video: object-cover → object-contain.
//           Full media visible (letterboxed if AR mismatch) instead of
//           center-crop.
//         · LightboxPlayer video: object-cover → object-contain.
//         · SparkMode: measure actual videoWidth/videoHeight on
//           loadedmetadata, use measured AR in box sizing (overrides
//           DB-stale aspectRatio). Switched objectFit to 'contain' so
//           pre-measurement renders are safe (letterbox not crop).
//   v33 (2026-05-23): iOS-stuck-after-5-6-swipes fix.
//       Root cause: browsers IGNORE autoPlay attribute changes after mount.
//       SparkMode's 3-slot pre-render rendered <video autoPlay={false}> for
//       prev/next slots; when a swipe reconciled the SAME DOM node from
//       non-active to active, the autoPlay flip didn't start playback.
//       Worse, the OLD active slot's video kept PLAYING silently (muted)
//       because the autoPlay flip true→false also did nothing. After 5-6
//       swipes, multiple <video> elements held iOS Safari's hard-capped
//       (~4-6) media decoders, exhausting the pool — new slot couldn't
//       acquire a decoder, screen sat black.
//       Fixes:
//         · UnifiedVideoPlayer: new useEffect driving play()/pause() from
//           autoPlay prop, so prop changes after mount are honored.
//         · SparkMode prefetch: skip entirely on Safari (canPlayHlsNatively
//           true) — native HLS doesn't benefit + iOS HTTP/2 contention from
//           extra prefetch fetches starved the active video's segments.
//         · Dropped `cache: 'force-cache'` (Safari footgun) for `cache: 'default'`.
const CACHE_NAME = 'uvera-v119';

// Shell files to pre-cache on install (lightweight — just the app shell)
const PRECACHE_URLS = [
  '/',
  '/manifest.json',
  '/favicon.svg',
  '/icons/icon-192x192.png',
  '/icons/icon-512x512.png',
];

// Inline offline fallback HTML — shown ONLY when network fetch fails AND
// no cached '/' exists. Self-contained (no asset deps so it works offline).
// Auto-retries when navigator.onLine flips back; manual retry button too.
const OFFLINE_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Offline · Uvera</title>
<style>
:root { color-scheme: light dark; }
html, body { margin: 0; padding: 0; height: 100%; }
body {
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Inter, system-ui, sans-serif;
  background: linear-gradient(180deg, #faf9ff 0%, #f0eef9 100%);
  color: #1a1a2e;
  display: grid; place-items: center;
  -webkit-font-smoothing: antialiased;
}
@media (prefers-color-scheme: dark) {
  body { background: linear-gradient(180deg, #0c0c1d 0%, #14142b 100%); color: #fff; }
}
.card {
  max-width: 380px; padding: 32px 28px; text-align: center;
  border-radius: 24px; backdrop-filter: blur(20px);
  background: rgba(255,255,255,0.6);
  border: 1px solid rgba(0,0,0,0.06);
  box-shadow: 0 20px 60px rgba(0,0,0,0.08);
}
@media (prefers-color-scheme: dark) {
  .card { background: rgba(255,255,255,0.06); border-color: rgba(255,255,255,0.10); }
}
.dot { width: 12px; height: 12px; border-radius: 50%; background: #ef4444;
  display: inline-block; margin-bottom: 16px; animation: pulse 1.6s ease-in-out infinite; }
@keyframes pulse { 0%,100% { opacity: 1 } 50% { opacity: 0.4 } }
h1 { margin: 0 0 8px; font-size: 22px; font-weight: 600; letter-spacing: -0.02em; }
p { margin: 0 0 24px; font-size: 14px; line-height: 1.55; opacity: 0.75; }
button {
  appearance: none; cursor: pointer; border: none;
  padding: 10px 22px; border-radius: 999px;
  background: #5B53FF; color: #fff;
  font-size: 14px; font-weight: 600; font-family: inherit;
  transition: background 0.15s ease, transform 0.15s ease;
}
button:hover { background: #4a42e8; }
button:active { transform: scale(0.97); }
small { display: block; margin-top: 16px; font-size: 12px; opacity: 0.5; }
</style>
</head>
<body>
<main class="card">
  <span class="dot" aria-hidden="true"></span>
  <h1>You're offline</h1>
  <p>Uvera can't reach the network right now. We'll auto-retry when you're back online, or you can refresh manually.</p>
  <button type="button" onclick="location.reload()">Try again</button>
  <small>Status: 503 · cache miss</small>
</main>
<script>
  window.addEventListener('online', () => location.reload());
  setInterval(() => { if (navigator.onLine) location.reload(); }, 5000);
</script>
</body>
</html>`;

// Hosts that serve video/audio. We pass these straight through to the
// browser without going through the cache layer at all — the browser's
// native HTTP cache handles them more efficiently and supports Range
// requests properly.
const MEDIA_HOSTS = [
  'cloudflarestream.com',     // Stream iframe embeds
  'videodelivery.net',         // Stream HLS / progressive
  'asset.uvera.ai',            // R2 (user-uploaded media)
  'wlpaas.weilitech.cn',       // legacy backwards-compat
];

// Path-extension match for media files served from any host.
const MEDIA_EXT_RE = /\.(mp4|webm|mov|m3u8|ts|mp3|wav|ogg|aac|flac)(\?|$)/i;

const isMediaRequest = (request) => {
  if (request.headers.get('range')) return true;
  try {
    const url = new URL(request.url);
    if (MEDIA_HOSTS.some((h) => url.hostname.includes(h))) return true;
    if (MEDIA_EXT_RE.test(url.pathname)) return true;
  } catch { /* ignore malformed URLs */ }
  // Browser flags media element fetches with destination 'video'/'audio'
  // — most reliable signal across hosts we don't know about.
  if (request.destination === 'video' || request.destination === 'audio') return true;
  return false;
};

/* ── Install: pre-cache shell (lenient) ───────────────────────────────
 * 2026-05-14 — v3 used cache.addAll() which is all-or-nothing: ANY one
 * URL failing rejects the whole install, leaving the cache empty. v3
 * activate then deleted v2's populated cache → next nav fell through
 * to the bare "Offline" string fallback (甲方 reported seeing this on
 * /discover). v4 fetches each URL individually with allSettled so a
 * partial network failure during install doesn't leave us empty. */
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(async (cache) => {
      await Promise.allSettled(
        PRECACHE_URLS.map(async (url) => {
          try {
            const response = await fetch(url, { cache: 'no-cache' });
            if (response && response.ok) await cache.put(url, response);
          } catch { /* this one URL failed, others continue */ }
        })
      );
    })
  );
  self.skipWaiting();
});

/* ── Activate: clean old caches only AFTER new cache has the shell ──── */
self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    // Confirm new cache has at least the root shell before deleting old.
    // If our install fetched '/' successfully it's already there; otherwise
    // we keep old caches around so navigation fallback can still hit them.
    const newCache = await caches.open(CACHE_NAME);
    const hasShell = await newCache.match('/');

    if (hasShell) {
      const keys = await caches.keys();
      await Promise.all(
        keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))
      );
    }
    // else: keep old caches as a fallback; next install pass will retry.

    await self.clients.claim();
  })());
});

/* ── Fetch: network-first for HTML/API, cache-first for static ──────── */
self.addEventListener('fetch', (event) => {
  const { request } = event;

  // Skip non-GET, chrome-extension, etc.
  if (request.method !== 'GET') return;
  if (!request.url.startsWith('http')) return;

  // ── Bail out for media requests ──
  // Video/audio playback issues HTTP Range requests; the server returns
  // 206 Partial Content; cache.put() rejects 206 with TypeError. Skip
  // these entirely so the browser's HTTP stack handles streaming +
  // caching natively. This was the actual bug behind the May-9 report.
  if (isMediaRequest(request)) return;

  // API / Supabase calls — always network, never cache
  if (request.url.includes('supabase') || request.url.includes('/api/')) return;

  // Navigation requests — network first, fallback to cache, fallback to
  // a proper offline HTML page. Wrap in a resolver that ALWAYS yields a
  // valid Response so respondWith() never sees `undefined`.
  // 2026-05-14: on success, opportunistically update the cached '/' so
  // even users who arrived via /some/path will have a shell next time
  // (v3 left some users with empty caches; this self-heals over visits).
  if (request.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        const response = await fetch(request);
        // Cache the root shell on any successful HTML nav — small write,
        // huge resilience win for next-visit offline fallback.
        if (response && response.ok && response.type === 'basic') {
          const url = new URL(request.url);
          if (url.pathname === '/' || url.pathname === '') {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((c) => c.put('/', clone)).catch(() => {});
          }
        }
        return response;
      } catch {
        const cached = await caches.match('/');
        if (cached) return cached;
        return new Response(OFFLINE_HTML, {
          status: 503,
          statusText: 'Offline',
          headers: { 'Content-Type': 'text/html; charset=utf-8' },
        });
      }
    })());
    return;
  }

  // Static assets (JS, CSS, images, fonts) — stale-while-revalidate
  event.respondWith(
    (async () => {
      const cached = await caches.match(request);

      const networkPromise = fetch(request)
        .then((response) => {
          // Only cache full 200 responses we actually own. Skip:
          //   - Range / partial (206)
          //   - Errors (404, 5xx)
          //   - Opaque cross-origin (response.type !== 'basic')
          //     because we can't introspect them safely
          if (response && response.status === 200 && response.type === 'basic') {
            const clone = response.clone();
            caches
              .open(CACHE_NAME)
              .then((cache) => cache.put(request, clone))
              .catch(() => { /* swallow — caching is best-effort */ });
          }
          return response;
        })
        .catch(() => cached || null);

      // If we have a cached copy, serve it immediately + revalidate in
      // background. Otherwise wait for network. Either way, fall back to
      // a 503 if both fail so respondWith() always gets a Response.
      const result = cached || (await networkPromise);
      return result || new Response('Offline', { status: 503, statusText: 'Offline' });
    })()
  );
});
