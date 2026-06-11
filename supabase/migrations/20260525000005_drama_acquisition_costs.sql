-- §2026-05-25 fei — Phase 3 短剧付费:归因投流成本表
--
-- PDF §4.2 公式里的 A (归因投流成本) 在 Phase 2 默认为 0 — 我们没在追踪
-- 单剧的买量花费。Phase 3 加这张表让运营录入 per-series × per-period 的
-- 投流花费,结算引擎读它来更准确地计算可分配收入。
--
-- 表设计:
--   series_acquisition_costs
--     id, series_id, period ('YYYY-MM'), amount_usd_cents, channel
--     (facebook/google/tiktok/influencer/other), notes, created_at,
--     created_by (审计:谁录入)
--   UNIQUE (series_id, period, channel) — 同一剧同一月同一渠道只能录一条;
--     多渠道分开录,再 SUM 用于结算公式。
--
-- 数据流:
--   1. 运营在 SeriesEditModal 或专门的"投流花费"界面录入。
--   2. 结算引擎 generate 时 sum 当月该 series 的所有 acquisition_costs.amount,
--      作为 A 代入 PDF §4 公式。
--   3. RevenueView 显示每剧 ROI = GMV / sum(acquisition_costs).
--
-- RLS:
--   - admin_full     管理员 INSERT/UPDATE/DELETE/SELECT
--   - creator_select 内容方只能 SELECT 自己的剧的成本(透明度,看到自己被
--                   扣了多少)

BEGIN;

CREATE TABLE IF NOT EXISTS public.series_acquisition_costs (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  series_id        uuid NOT NULL REFERENCES public.series(id) ON DELETE CASCADE,
  period           text NOT NULL,                       -- 'YYYY-MM'
  channel          text NOT NULL DEFAULT 'other'        -- 'facebook' | 'google' | 'tiktok' | 'influencer' | 'other'
                   CHECK (channel IN ('facebook','google','tiktok','influencer','other')),
  amount_usd_cents integer NOT NULL CHECK (amount_usd_cents >= 0),
  notes            text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  created_by       uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_at       timestamptz NOT NULL DEFAULT now(),

  UNIQUE (series_id, period, channel)
);

ALTER TABLE public.series_acquisition_costs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "sac_admin_full" ON public.series_acquisition_costs;


CREATE POLICY "sac_admin_full" ON public.series_acquisition_costs
  FOR ALL TO authenticated
  USING (public.is_admin()) WITH CHECK (public.is_admin());

-- Creator can SELECT own series' costs so they understand why their
-- settlements show acquisition_cost_cents > 0 (transparency).
DROP POLICY IF EXISTS "sac_select_creator" ON public.series_acquisition_costs;

CREATE POLICY "sac_select_creator" ON public.series_acquisition_costs
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.series s WHERE s.id = series_acquisition_costs.series_id AND s.user_id = auth.uid()));

CREATE INDEX IF NOT EXISTS idx_sac_series_period
  ON public.series_acquisition_costs(series_id, period);
CREATE INDEX IF NOT EXISTS idx_sac_period
  ON public.series_acquisition_costs(period);

-- updated_at trigger (reuse the touch function from series migration)
DROP TRIGGER IF EXISTS trg_sac_updated_at ON public.series_acquisition_costs;
CREATE TRIGGER trg_sac_updated_at
  BEFORE UPDATE ON public.series_acquisition_costs
  FOR EACH ROW EXECUTE FUNCTION public.touch_series_updated_at();

-- Toggle the default investment-cost behavior on. Was 'false' in Phase 1
-- because we had no data; now that ops can record costs, settlements
-- should deduct them by default.
UPDATE public.system_settings
   SET value = 'true',
       description = '结算公式是否扣减投流成本 (Phase 3: true, 读 series_acquisition_costs 表 SUM)'
 WHERE key = 'default_include_acquisition_cost';

COMMIT;
