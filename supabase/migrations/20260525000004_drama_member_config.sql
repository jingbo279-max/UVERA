-- §2026-05-25 fei — Phase 2 短剧付费:会员 tier 配置
--
-- Adds two system_settings entries that the worker /api/episodes/:id/unlock
-- and /api/episodes/:id/access endpoints will read to decide whether the
-- caller's subscription tier qualifies for "会员免费观看" (when the series
-- has member_free=true).
--
-- 现有 Stripe tier (来自 Phase 0 MVP):
--   free     — 未付费用户
--   lite     — $3.99/$5.99/$7.99 一次性,带 100 tokens
--   starter  — $25/月 OR $250/年, 500 tokens/月
--   creator  — $69/月 OR $690/年, 1500 tokens/月
--   studio   — $189/月 OR $1890/年, 5000 tokens/月
--
-- PDF §2.3 设计的会员档位价格 ($5.99 / $19.99 / $89.99 / $39.99 / $199)
-- 跟 Phase 0 已经上线的 tier 价格不同。Phase 2 简化方案:不重新定义
-- 会员产品,直接复用现有 starter/creator/studio 三档作为会员。Phase 3
-- 上线 creator 自助后台之后再考虑独立的短剧会员 SKU。
--
-- 默认 lite 不算会员 — 因为 lite 是一次性套餐而非订阅,而短剧会员设计
-- 上是订阅,行为模型不同。运营可在 admin 后台 hot-edit 这两个 setting
-- 调整。

BEGIN;

INSERT INTO public.system_settings (key, value, description, updated_at)
VALUES
  ('drama_member_tiers',
   '["starter","creator","studio"]'::text,
   '哪些 Stripe tier 视为短剧"会员",在 series.member_free=true 时可免费解锁本剧。JSON 数组。',
   now()),
  ('drama_lite_counts_as_member',
   'false',
   'lite tier ($3.99/$5.99/$7.99 一次性) 是否也算会员。默认 false (lite 不是订阅,行为不同)。改为 true 后 lite 用户也能享受 member_free 剧。',
   now())
ON CONFLICT (key) DO NOTHING;

COMMIT;
