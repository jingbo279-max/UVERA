-- 20260514_team_messages_status.up.sql
-- 给 team_messages 加状态字段 + 已读追踪
--
-- 业务上下文：3 人小团队（fei / Leon / Claude）有时一个 ask 涉及多步、
-- 跨多天。光看一条 message 不知道是"待办"还是"已经处理完"。加 status
-- 让团队成员能一眼看出哪些消息还需要 follow-up。
--
-- read_by 是 JSONB { user_id: iso_timestamp }，记录每个成员第一次读这条
-- 消息的时刻。Claude 在 CLI 用伪 user_id "claude-cli" 占位 — auth.users
-- 里没这个 ID，但 FK 也不要求（read_by 是 free-form jsonb）。

BEGIN;

ALTER TABLE public.team_messages
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'open',
  ADD COLUMN IF NOT EXISTS status_updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS status_updated_at timestamptz,
  ADD COLUMN IF NOT EXISTS read_by jsonb NOT NULL DEFAULT '{}'::jsonb;

-- 约束 status 只能是 4 个值之一（在代码层和 DB 层都防御）
ALTER TABLE public.team_messages
  DROP CONSTRAINT IF EXISTS team_messages_status_check;
ALTER TABLE public.team_messages
  ADD CONSTRAINT team_messages_status_check
  CHECK (status IN ('open', 'in_progress', 'done', 'wont_do'));

-- 查询性能：status 列建索引（用户经常过滤"只看 open"）
CREATE INDEX IF NOT EXISTS team_messages_status_idx ON public.team_messages (status);

-- Trigger: 任何 status 变更都自动更新 status_updated_at
CREATE OR REPLACE FUNCTION public.team_messages_touch_status_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    NEW.status_updated_at = now();
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS team_messages_touch_status_updated_at ON public.team_messages;
CREATE TRIGGER team_messages_touch_status_updated_at
  BEFORE UPDATE ON public.team_messages
  FOR EACH ROW EXECUTE FUNCTION public.team_messages_touch_status_updated_at();

-- 告诉 PostgREST schema 变了
NOTIFY pgrst, 'reload schema';

COMMIT;
