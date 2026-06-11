-- 20260514_team_messages_status.down.sql
-- 回滚 team_messages 的 status / read_by 增列
-- ⚠️ 会丢失所有 status 状态记录 + 已读追踪。

BEGIN;

DROP TRIGGER IF EXISTS team_messages_touch_status_updated_at ON public.team_messages;
DROP FUNCTION IF EXISTS public.team_messages_touch_status_updated_at();

DROP INDEX IF EXISTS public.team_messages_status_idx;

ALTER TABLE public.team_messages
  DROP CONSTRAINT IF EXISTS team_messages_status_check,
  DROP COLUMN IF EXISTS status,
  DROP COLUMN IF EXISTS status_updated_by,
  DROP COLUMN IF EXISTS status_updated_at,
  DROP COLUMN IF EXISTS read_by;

NOTIFY pgrst, 'reload schema';

COMMIT;
