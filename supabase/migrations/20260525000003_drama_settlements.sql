-- §2026-05-25 fei — Phase 2 短剧付费:分成结算引擎
--
-- 表设计 (PDF §6):
--   settlements — 一行 = 一个 (period × series) 对的分成结算单。
--   period      = 'YYYY-MM' 自然月,Phase 2 MVP 不支持半月结算。
--
-- 数据流:
--   1. 管理员在后台点 "生成 2026-05 结算" → 后端聚合该月所有
--      ucoins_orders + series_purchases + episode_unlocks → 按 series
--      分组 → 套 PDF §4 公式 → 写 settlements 行 (一个 series 一行)。
--   2. 结算单状态:pending_confirm → creator_confirmed → paid。
--      (Phase 3 上 creator 自助后台后,creator 会 confirm。Phase 2 MVP
--       全在 admin 后台做。)
--
-- 计算说明 (重要):
--   ucoins_gmv_cents = sum(episode_unlocks.ucoins_paid WHERE
--       series_id = X AND unlocked_at IN period) × coin_to_usd_cents
--   bundle_gmv_cents = sum(series_purchases.amount_usd_cents WHERE
--       series_id = X AND status='succeeded' AND completed_at IN period)
--   gmv_cents = ucoins_gmv_cents + bundle_gmv_cents
--
--   channel_fee_cents = gmv_cents × c%
--   service_fee_cents = gmv_cents × s%
--   acquisition_cost_cents = 0 (Phase 2 not tracking per-series ad spend yet)
--   distributable_cents = gmv_cents − channel_fee − service_fee − acquisition_cost
--   creator_earnings_cents = distributable_cents × n%
--   platform_earnings_cents = distributable_cents × (1 − n%) + service_fee_cents
--
--   c% from system_settings.default_channel_fee_pct_web (3 in Phase 1 seed)
--   s% from system_settings.default_platform_service_pct (10 in Phase 1 seed)
--   n% from series.revenue_share_pct, OR system_settings.default_revenue_share_pct
--
-- §coin_to_usd_cents:
--   PDF says "100 U-Coins ≈ $0.99" — the cheapest non-first-charge SKU
--   ($1.99 → 200 U-Coins) makes 1 U-Coin = $0.00995. We round to 1 cent
--   per U-Coin for settlement (slight over-estimate of GMV, slight under-
--   estimate of platform margin — conservative for the creator). Admin
--   can hot-edit the setting to refine.

BEGIN;

-- ═══════════════════════════════════════════════════════════════════════════
-- settlements — one row per (period × series)
-- ═══════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.settlements (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  period                   text NOT NULL,                           -- 'YYYY-MM'
  series_id                uuid NOT NULL REFERENCES public.series(id) ON DELETE CASCADE,
  content_creator_id       uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  -- Inputs (snapshots — recomputable but stored for audit)
  ucoins_consumed          integer NOT NULL DEFAULT 0,              -- sum of unlock spend
  ucoins_to_usd_cents      integer NOT NULL DEFAULT 1,              -- conversion rate at time of run
  bundle_orders_count      integer NOT NULL DEFAULT 0,
  unlock_count             integer NOT NULL DEFAULT 0,

  -- Money amounts in USD cents
  ucoins_gmv_cents         integer NOT NULL DEFAULT 0,
  bundle_gmv_cents         integer NOT NULL DEFAULT 0,
  gmv_cents                integer NOT NULL DEFAULT 0,

  channel_fee_pct          numeric(5,2) NOT NULL DEFAULT 3,
  channel_fee_cents        integer NOT NULL DEFAULT 0,

  service_fee_pct          numeric(5,2) NOT NULL DEFAULT 10,
  service_fee_cents        integer NOT NULL DEFAULT 0,

  acquisition_cost_cents   integer NOT NULL DEFAULT 0,

  distributable_cents      integer NOT NULL DEFAULT 0,

  revenue_share_pct        numeric(5,2) NOT NULL DEFAULT 50,
  creator_earnings_cents   integer NOT NULL DEFAULT 0,
  platform_earnings_cents  integer NOT NULL DEFAULT 0,

  status                   text NOT NULL DEFAULT 'pending_confirm'
                           CHECK (status IN ('pending_confirm','creator_confirmed','paid','disputed','cancelled')),

  generated_at             timestamptz NOT NULL DEFAULT now(),
  confirmed_at             timestamptz,
  paid_at                  timestamptz,
  paid_reference           text,                                    -- bank ref / Stripe transfer id

  notes                    text,

  -- Idempotency: re-running "generate for period" on the same series
  --   should UPDATE the existing row, not insert a duplicate.
  UNIQUE (period, series_id)
);

ALTER TABLE public.settlements ENABLE ROW LEVEL SECURITY;

-- Creator can see own series' settlements (read-only).
DROP POLICY IF EXISTS "settlements_select_creator" ON public.settlements;

CREATE POLICY "settlements_select_creator" ON public.settlements
  FOR SELECT TO authenticated
  USING (content_creator_id = auth.uid());

-- Admin full access (generate / mark paid / dispute).
DROP POLICY IF EXISTS "settlements_admin_full" ON public.settlements;

CREATE POLICY "settlements_admin_full" ON public.settlements
  FOR ALL TO authenticated
  USING (public.is_admin()) WITH CHECK (public.is_admin());

CREATE INDEX IF NOT EXISTS idx_settlements_period
  ON public.settlements(period DESC);
CREATE INDEX IF NOT EXISTS idx_settlements_creator_period
  ON public.settlements(content_creator_id, period DESC);
CREATE INDEX IF NOT EXISTS idx_settlements_series_period
  ON public.settlements(series_id, period DESC);

-- ═══════════════════════════════════════════════════════════════════════════
-- system_settings: U-Coins → USD conversion rate
-- ═══════════════════════════════════════════════════════════════════════════
INSERT INTO public.system_settings (key, value, description, updated_at)
VALUES
  ('ucoins_to_usd_cents', '1',
   '结算时 1 U-Coin 折合多少美分 (PDF: 100 U-Coins ≈ $0.99,默认 1 ¢/coin 略高估 GMV,对内容方略有利)', now())
ON CONFLICT (key) DO NOTHING;

COMMIT;

-- ═══════════════════════════════════════════════════════════════════════════
-- Verify (manual):
--   SELECT * FROM public.settlements LIMIT 5;
--   SELECT key, value FROM public.system_settings WHERE key = 'ucoins_to_usd_cents';
-- ═══════════════════════════════════════════════════════════════════════════
