-- §2026-05-25 fei — Phase 1 短剧付费功能 schema
--
-- Per docs/Uvera短剧付费功能设计方案.pdf:
--   - 用户侧:U-Coins 单集解锁 + Series 整剧买断 + 付费墙
--   - 后台侧:剧集收益概述 + Series 级付费配置
--
-- 拆 6 张新表 + series 扩展付费字段:
--   1. wallet_balance        — 每个 user 的 U-Coins 余额 (1:1)
--   2. wallet_tx             — U-Coins 流水账 (purchase / unlock / refund)
--   3. episodes              — 单集独立表 (从 series.episodes JSONB 提升)
--   4. episode_unlocks       — 用户已解锁的 episode 记录 (复合唯一)
--   5. series_purchases      — 整剧买断订单 (Stripe Checkout)
--   6. ucoins_orders         — U-Coins 充值订单 (Stripe Checkout)
--
-- Series 表扩展:
--   - free_episodes_count    — 前 N 集免费
--   - ucoins_per_episode     — 单集解锁价 (U-Coins)
--   - bundle_price_usd_cents — 整剧买断价 (美分, NULL = 不提供)
--   - member_free            — 会员是否免费
--   - is_premiere            — 是否首发标签
--   - is_recommended         — 是否进推荐流
--   - revenue_share_pct      — 分成比例 (NULL = 继承全局默认)
--   - scheduled_publish_at   — 排期上架时间 (NULL = 手动上架)
--   - lifecycle_status       — 草稿/待审核/待上架/已上架/已下架
--     (与现有 status='draft'|'published'|'archived' 区分:
--      lifecycle_status 是付费流程审核态,status 是显示状态)
--
-- §U-Coins 与 tokens 完全分离:
--   tokens     = 生产端算力额度 (生视频烧)
--   U-Coins    = 消费端观看货币 (解剧用)
--   两套独立 wallet,独立流水,独立 Stripe 充值 SKU。
--
-- §定价口径:
--   ucoins_per_episode  默认 40 (≈ $0.40,1 U-Coin = $0.01)
--   free_episodes_count 默认 5
--   bundle_price_usd_cents 默认 NULL (运营按剧设置,推荐 $12.99 = 1299)
--   revenue_share_pct   默认 NULL (继承全局,见 system_settings)

BEGIN;

-- ═══════════════════════════════════════════════════════════════════════════
-- 1. wallet_balance — 每用户当前 U-Coins 余额 (1:1)
-- ═══════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.wallet_balance (
  user_id        uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  ucoins_balance integer NOT NULL DEFAULT 0 CHECK (ucoins_balance >= 0),
  ucoins_lifetime_purchased integer NOT NULL DEFAULT 0,  -- 累计充值过的 U-Coins (LTV 用)
  ucoins_lifetime_spent     integer NOT NULL DEFAULT 0,  -- 累计花掉的 U-Coins
  updated_at     timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.wallet_balance ENABLE ROW LEVEL SECURITY;

-- 自己看自己的余额
CREATE POLICY "wallet_balance_select_own" ON public.wallet_balance
  FOR SELECT TO authenticated USING (user_id = auth.uid());

-- 管理员看全部
CREATE POLICY "wallet_balance_admin_full" ON public.wallet_balance
  FOR ALL TO authenticated
  USING (public.is_admin()) WITH CHECK (public.is_admin());

-- 注意:wallet_balance 的写入 ONLY 通过 service role 在 worker 端完成
-- (Stripe webhook 充值 / 解锁扣费),前端永远不直接写。所以这里没有 owner_write 策略。

CREATE INDEX IF NOT EXISTS idx_wallet_balance_updated
  ON public.wallet_balance(updated_at DESC);

-- ═══════════════════════════════════════════════════════════════════════════
-- 2. wallet_tx — U-Coins 流水账
--
-- 每一笔余额变动 (充值 / 解锁 / 退款) 都在这里留账。
-- amount 正数 = 入账,负数 = 出账。
-- balance_after 是该笔后的余额快照,用于客服查账时不用从头加。
-- ═══════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.wallet_tx (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  amount          integer NOT NULL,                     -- 正充值, 负扣费
  balance_after   integer NOT NULL CHECK (balance_after >= 0),
  tx_type         text NOT NULL CHECK (tx_type IN (
                    'purchase',       -- 用户充值
                    'first_charge',   -- 首充翻倍
                    'unlock_episode', -- 解锁单集
                    'bundle_purchase',-- 整剧买断 (不消耗 U-Coins,但留账方便聚合)
                    'refund',         -- 退款
                    'admin_grant',    -- 管理员手工赠送
                    'admin_revoke'    -- 管理员手工扣减
                  )),
  reference_type  text,    -- 'ucoins_order' | 'episode' | 'series_purchase' | NULL
  reference_id    uuid,    -- 指向相关订单 / 集数 / 买断单
  description     text,    -- 客户端可读的描述 ("解锁 我的甜心 第 6 集")
  created_at      timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.wallet_tx ENABLE ROW LEVEL SECURITY;

CREATE POLICY "wallet_tx_select_own" ON public.wallet_tx
  FOR SELECT TO authenticated USING (user_id = auth.uid());

CREATE POLICY "wallet_tx_admin_full" ON public.wallet_tx
  FOR ALL TO authenticated
  USING (public.is_admin()) WITH CHECK (public.is_admin());

CREATE INDEX IF NOT EXISTS idx_wallet_tx_user_time
  ON public.wallet_tx(user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_wallet_tx_ref
  ON public.wallet_tx(reference_type, reference_id)
  WHERE reference_id IS NOT NULL;

-- ═══════════════════════════════════════════════════════════════════════════
-- 3. episodes — 单集独立表
--
-- 从 series.episodes JSONB 提升:JSONB 不支持单集 FK / 聚合查询 (各集解锁
-- 人数分布、最热单集排行)。这里独立成行,方便订单 / 解锁记录 FK 进来。
--
-- 现有 series.episodes JSONB 列保留,作为向后兼容的备份 (Phase 1 写入
-- episodes 表,读取也走新表;一段时间后 cleanup 脚本删 JSONB 列)。
-- ═══════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.episodes (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  series_id       uuid NOT NULL REFERENCES public.series(id) ON DELETE CASCADE,
  episode_no      integer NOT NULL CHECK (episode_no > 0),
  title           text,
  video_url       text,                                  -- mp4 或 Stream HLS
  stream_uid      text,                                  -- CF Stream UID (有则取代 video_url 播放)
  duration_sec    integer CHECK (duration_sec IS NULL OR duration_sec > 0),
  thumbnail_url   text,

  -- 单集级覆盖 series 价格 (可选;通常继承)
  is_free_override        boolean,           -- TRUE/FALSE 强制免费/付费; NULL 跟随 series.free_episodes_count
  ucoins_price_override   integer,           -- NULL 跟随 series.ucoins_per_episode

  status          text NOT NULL DEFAULT 'ready'
                  CHECK (status IN ('empty','uploading','ready','archived')),

  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),

  UNIQUE (series_id, episode_no)
);

ALTER TABLE public.episodes ENABLE ROW LEVEL SECURITY;

-- 公开读 (已上架 series 的 ready episode)。具体能不能看视频走应用层 can-watch 检查。
CREATE POLICY "episodes_public_read" ON public.episodes
  FOR SELECT TO anon, authenticated
  USING (
    status = 'ready'
    AND EXISTS (
      SELECT 1 FROM public.series s
      WHERE s.id = episodes.series_id
        AND s.status = 'published'
    )
  );

-- Owner 看自己 series 下全部 episode
CREATE POLICY "episodes_owner_full" ON public.episodes
  FOR ALL TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.series s WHERE s.id = episodes.series_id AND s.user_id = auth.uid())
  ) WITH CHECK (
    EXISTS (SELECT 1 FROM public.series s WHERE s.id = episodes.series_id AND s.user_id = auth.uid())
  );

CREATE POLICY "episodes_admin_full" ON public.episodes
  FOR ALL TO authenticated
  USING (public.is_admin()) WITH CHECK (public.is_admin());

CREATE INDEX IF NOT EXISTS idx_episodes_series_no
  ON public.episodes(series_id, episode_no);

-- updated_at trigger (复用 series 的函数,函数本身是通用的)
DROP TRIGGER IF EXISTS trg_episodes_updated_at ON public.episodes;
CREATE TRIGGER trg_episodes_updated_at
  BEFORE UPDATE ON public.episodes
  FOR EACH ROW EXECUTE FUNCTION public.touch_series_updated_at();

-- ═══════════════════════════════════════════════════════════════════════════
-- 4. episode_unlocks — 用户已解锁的单集记录
--
-- 复合唯一索引保证同一用户对同一集只解锁一次。重复解锁请求 (网络重试)
-- 走 ON CONFLICT DO NOTHING 兜底,前端拿到 conflict 也能正常播放。
-- ═══════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.episode_unlocks (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  episode_id      uuid NOT NULL REFERENCES public.episodes(id) ON DELETE CASCADE,
  series_id       uuid NOT NULL REFERENCES public.series(id) ON DELETE CASCADE,  -- 反范式以加速 series 维度聚合
  unlock_type     text NOT NULL CHECK (unlock_type IN (
                    'ucoins',         -- 用 U-Coins 解锁单集
                    'bundle',         -- 整剧买断带来的解锁
                    'member',         -- 会员权益解锁
                    'admin_grant'     -- 管理员补发
                  )),
  ucoins_paid     integer NOT NULL DEFAULT 0,
  wallet_tx_id    uuid REFERENCES public.wallet_tx(id) ON DELETE SET NULL,  -- 关联到对应的流水
  unlocked_at     timestamptz NOT NULL DEFAULT now(),

  UNIQUE (user_id, episode_id)
);

ALTER TABLE public.episode_unlocks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "episode_unlocks_select_own" ON public.episode_unlocks
  FOR SELECT TO authenticated USING (user_id = auth.uid());

CREATE POLICY "episode_unlocks_admin_full" ON public.episode_unlocks
  FOR ALL TO authenticated
  USING (public.is_admin()) WITH CHECK (public.is_admin());

-- 应用层只通过 service role 写入 (worker 在 /api/episodes/:id/unlock 里事务性扣 U-Coins + 插 unlock)。
-- 前端没有直接 INSERT 权限,避免绕过扣费。

CREATE INDEX IF NOT EXISTS idx_episode_unlocks_user
  ON public.episode_unlocks(user_id, unlocked_at DESC);
CREATE INDEX IF NOT EXISTS idx_episode_unlocks_episode
  ON public.episode_unlocks(episode_id);
CREATE INDEX IF NOT EXISTS idx_episode_unlocks_series
  ON public.episode_unlocks(series_id, unlocked_at DESC);

-- ═══════════════════════════════════════════════════════════════════════════
-- 5. series_purchases — 整剧买断订单 (Stripe Checkout)
-- ═══════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.series_purchases (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  series_id           uuid NOT NULL REFERENCES public.series(id) ON DELETE CASCADE,
  amount_usd_cents    integer NOT NULL CHECK (amount_usd_cents > 0),
  currency            text NOT NULL DEFAULT 'usd',
  stripe_session_id   text UNIQUE,                       -- Stripe Checkout Session ID
  stripe_payment_intent text,                            -- 付款成功后填
  status              text NOT NULL DEFAULT 'pending'
                      CHECK (status IN ('pending','succeeded','refunded','failed','cancelled')),
  created_at          timestamptz NOT NULL DEFAULT now(),
  completed_at        timestamptz,

  -- 防止同一用户对同一剧重复买断 (pending 中的允许多个,因为可能没付完)
  -- 但 succeeded 状态下唯一 — 用 partial unique index 实现
  UNIQUE (user_id, series_id, stripe_session_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_series_purchases_succeeded_per_user
  ON public.series_purchases(user_id, series_id)
  WHERE status = 'succeeded';

ALTER TABLE public.series_purchases ENABLE ROW LEVEL SECURITY;

CREATE POLICY "series_purchases_select_own" ON public.series_purchases
  FOR SELECT TO authenticated USING (user_id = auth.uid());

CREATE POLICY "series_purchases_admin_full" ON public.series_purchases
  FOR ALL TO authenticated
  USING (public.is_admin()) WITH CHECK (public.is_admin());

CREATE INDEX IF NOT EXISTS idx_series_purchases_series_status
  ON public.series_purchases(series_id, status, completed_at DESC);

-- ═══════════════════════════════════════════════════════════════════════════
-- 6. ucoins_orders — U-Coins 充值订单 (Stripe Checkout)
--
-- 6 个充值档位预定义 (见 PDF 2.2):
--   $0.99    → 200 U-Coins (首充翻倍,one-shot)
--   $1.99    → 200
--   $4.99    → 520  (500 + 20 赠)
--   $9.99    → 1100 (1000 + 100 赠)
--   $19.99   → 2300 (2000 + 300 赠)
--   $49.99   → 6000 (5000 + 1000 赠)
-- 实际 SKU 配置在 system_settings.ucoins_packages (JSONB),后台可调。
-- ═══════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.ucoins_orders (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  package_id          text NOT NULL,                     -- 'pkg_099_first' | 'pkg_499' | ...
  amount_usd_cents    integer NOT NULL CHECK (amount_usd_cents > 0),
  currency            text NOT NULL DEFAULT 'usd',
  ucoins_to_credit    integer NOT NULL CHECK (ucoins_to_credit > 0),
  ucoins_bonus        integer NOT NULL DEFAULT 0,        -- 赠送部分 (展示用)
  stripe_session_id   text UNIQUE,
  stripe_payment_intent text,
  status              text NOT NULL DEFAULT 'pending'
                      CHECK (status IN ('pending','succeeded','refunded','failed','cancelled')),
  is_first_charge     boolean NOT NULL DEFAULT FALSE,    -- 首充翻倍标记
  wallet_tx_id        uuid REFERENCES public.wallet_tx(id) ON DELETE SET NULL,
  created_at          timestamptz NOT NULL DEFAULT now(),
  completed_at        timestamptz
);

ALTER TABLE public.ucoins_orders ENABLE ROW LEVEL SECURITY;

CREATE POLICY "ucoins_orders_select_own" ON public.ucoins_orders
  FOR SELECT TO authenticated USING (user_id = auth.uid());

CREATE POLICY "ucoins_orders_admin_full" ON public.ucoins_orders
  FOR ALL TO authenticated
  USING (public.is_admin()) WITH CHECK (public.is_admin());

CREATE INDEX IF NOT EXISTS idx_ucoins_orders_user_time
  ON public.ucoins_orders(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ucoins_orders_status_time
  ON public.ucoins_orders(status, completed_at DESC);

-- ═══════════════════════════════════════════════════════════════════════════
-- 7. series 表扩展付费配置字段
-- ═══════════════════════════════════════════════════════════════════════════
ALTER TABLE public.series
  ADD COLUMN IF NOT EXISTS free_episodes_count    integer NOT NULL DEFAULT 5
                                                  CHECK (free_episodes_count >= 0),
  ADD COLUMN IF NOT EXISTS ucoins_per_episode     integer NOT NULL DEFAULT 40
                                                  CHECK (ucoins_per_episode >= 0),
  ADD COLUMN IF NOT EXISTS bundle_price_usd_cents integer
                                                  CHECK (bundle_price_usd_cents IS NULL OR bundle_price_usd_cents > 0),
  ADD COLUMN IF NOT EXISTS member_free            boolean NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS is_premiere            boolean NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS is_recommended         boolean NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS revenue_share_pct      numeric(5,2)
                                                  CHECK (revenue_share_pct IS NULL OR (revenue_share_pct >= 0 AND revenue_share_pct <= 100)),
  ADD COLUMN IF NOT EXISTS scheduled_publish_at   timestamptz,
  ADD COLUMN IF NOT EXISTS lifecycle_status       text NOT NULL DEFAULT 'draft'
                                                  CHECK (lifecycle_status IN ('draft','pending_review','approved','live','off_shelf','archived'));

-- 索引:运营常按 lifecycle_status + scheduled_publish_at 筛选 (查排期上架队列)
CREATE INDEX IF NOT EXISTS idx_series_lifecycle_schedule
  ON public.series(lifecycle_status, scheduled_publish_at)
  WHERE scheduled_publish_at IS NOT NULL;

-- 已上架 + 推荐位 (Discover 拉推荐时用)
CREATE INDEX IF NOT EXISTS idx_series_recommended_live
  ON public.series(updated_at DESC)
  WHERE lifecycle_status = 'live' AND is_recommended = TRUE;

-- ═══════════════════════════════════════════════════════════════════════════
-- 8. system_settings 写入分成默认值 + U-Coins SKU 列表
--
-- (system_settings 表已存在,这里只插值。Stripe 价格 ID 留空待 fei 在
-- Stripe Dashboard 创建好 product 后通过 admin UI 填进来。)
-- ═══════════════════════════════════════════════════════════════════════════
INSERT INTO public.system_settings (key, value, description, updated_at)
VALUES
  ('default_revenue_share_pct', '50',
   '内容方分成默认比例 (0-100,可被 series.revenue_share_pct 覆盖)', now()),
  ('default_channel_fee_pct_web', '3',
   'Stripe Web 渠道支付手续费率,用于结算成本扣减', now()),
  ('default_channel_fee_pct_ios', '30',
   'Apple IAP 渠道手续费率 (Phase 1 未接 IAP,预留)', now()),
  ('default_platform_service_pct', '10',
   '平台技术服务费率 (CDN/转码/播放/风控)', now()),
  ('default_include_acquisition_cost', 'false',
   '结算公式是否扣减投流成本 (false = 不扣)', now()),
  ('ucoins_packages',
   '[
     {"id":"pkg_099_first","price_cents":99,"ucoins":200,"bonus":100,"first_charge":true,"label":"$0.99 首充翻倍"},
     {"id":"pkg_199","price_cents":199,"ucoins":200,"bonus":0,"label":"$1.99"},
     {"id":"pkg_499","price_cents":499,"ucoins":520,"bonus":20,"label":"$4.99"},
     {"id":"pkg_999","price_cents":999,"ucoins":1100,"bonus":100,"label":"$9.99"},
     {"id":"pkg_1999","price_cents":1999,"ucoins":2300,"bonus":300,"label":"$19.99"},
     {"id":"pkg_4999","price_cents":4999,"ucoins":6000,"bonus":1000,"label":"$49.99"}
   ]'::text,
   'U-Coins 充值档位定义 (与 Stripe Product 对齐)', now())
ON CONFLICT (key) DO NOTHING;

-- ═══════════════════════════════════════════════════════════════════════════
-- 9. JSONB → episodes 数据迁移
--
-- 把 series.episodes JSONB 现有数据复制到独立 episodes 表。幂等:
-- 已存在的 (series_id, episode_no) 跳过 (ON CONFLICT DO NOTHING)。
-- ═══════════════════════════════════════════════════════════════════════════
DO $$
DECLARE
  r RECORD;
  ep JSONB;
  ep_idx INT;
BEGIN
  FOR r IN SELECT id, episodes FROM public.series WHERE jsonb_typeof(episodes) = 'array' LOOP
    ep_idx := 0;
    FOR ep IN SELECT * FROM jsonb_array_elements(r.episodes) LOOP
      ep_idx := ep_idx + 1;
      INSERT INTO public.episodes (
        series_id, episode_no, title, video_url, stream_uid, thumbnail_url, status
      ) VALUES (
        r.id,
        ep_idx,
        COALESCE(ep->>'title', 'Episode ' || ep_idx),
        ep->>'url',
        ep->>'streamUid',
        ep->>'thumbnailUrl',
        COALESCE(ep->>'status', 'ready')
      ) ON CONFLICT (series_id, episode_no) DO NOTHING;
    END LOOP;
  END LOOP;
END $$;

COMMIT;

-- ═══════════════════════════════════════════════════════════════════════════
-- Verify (manual)
-- ═══════════════════════════════════════════════════════════════════════════
-- SELECT table_name FROM information_schema.tables
--  WHERE table_schema='public' AND table_name IN
--   ('wallet_balance','wallet_tx','episodes','episode_unlocks',
--    'series_purchases','ucoins_orders');
--
-- SELECT key FROM public.system_settings WHERE key LIKE 'default_%' OR key='ucoins_packages';
--
-- SELECT s.id, s.title, count(e.id) AS ep_count
--   FROM public.series s LEFT JOIN public.episodes e ON e.series_id = s.id
--  GROUP BY s.id, s.title;
