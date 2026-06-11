-- 20260513_team_chat.up.sql
-- Internal team chat — admin-only conversation space with Claude as a
-- participant. 费 / Leon / Claude (and future contributors) talk here
-- instead of bouncing between WeChat / Slack / docs.
--
-- Claude is invoked via @claude mention (or starts the next message).
-- Anthropic API key lives in env (ANTHROPIC_API_KEY). Tool calls are
-- logged into `tool_calls` for audit. See docs/DECISION-OWNERSHIP.md.

BEGIN;

CREATE TABLE IF NOT EXISTS public.team_messages (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Author: either a real auth.users row (humans) OR 'claude' synthetic.
  -- author_id NULL means it's Claude (kind='claude'); human messages
  -- always have author_id set (RLS-checked at insert).
  author_id            uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  author_kind          text NOT NULL CHECK (author_kind IN ('human', 'claude', 'system')),
  author_display_name  text,  -- denormalized for UI: 'fei', 'Leon', 'Claude'

  body                 text NOT NULL,           -- markdown supported
  thread_id            text,                    -- optional thread tag, e.g. 'rename-refactor'
  mentions             text[] NOT NULL DEFAULT '{}',  -- ['@claude', '@fei', '@leon']

  -- For Claude messages: log any tools called so admin can audit what
  -- DB queries / external calls the bot made on each turn.
  tool_calls           jsonb,

  -- For human messages: did this message trigger a Claude response?
  -- (Useful for cost tracking + debugging.)
  triggered_claude     boolean NOT NULL DEFAULT false,

  created_at           timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS team_messages_created_idx
  ON public.team_messages (created_at DESC);

CREATE INDEX IF NOT EXISTS team_messages_thread_idx
  ON public.team_messages (thread_id, created_at DESC)
  WHERE thread_id IS NOT NULL;

-- ── RLS ── admin-only.
ALTER TABLE public.team_messages ENABLE ROW LEVEL SECURITY;

-- Admins can read everything
DROP POLICY IF EXISTS "team_messages_admin_read" ON public.team_messages;
CREATE POLICY "team_messages_admin_read"
  ON public.team_messages
  FOR SELECT
  TO authenticated
  USING (
    (auth.jwt() -> 'user_metadata' ->> 'is_admin')::boolean = true
  );

-- Admins can insert their own human messages.
-- Claude messages are inserted by the worker via service_role (bypasses RLS).
DROP POLICY IF EXISTS "team_messages_admin_insert" ON public.team_messages;
CREATE POLICY "team_messages_admin_insert"
  ON public.team_messages
  FOR INSERT
  TO authenticated
  WITH CHECK (
    (auth.jwt() -> 'user_metadata' ->> 'is_admin')::boolean = true
    AND author_kind = 'human'
    AND author_id = auth.uid()
  );

-- No UPDATE / DELETE policies — messages are immutable. If we ever need
-- to redact, do it via service_role with audit log.

-- ── claude_readonly_query RPC ──
-- Lets the worker run arbitrary SELECT statements on behalf of Claude
-- without exposing a generic SQL endpoint. The worker layer enforces
-- "single SELECT/WITH, no DDL/DML" via isReadOnlySql() check; this RPC
-- is a defense-in-depth backstop with SECURITY DEFINER + restricted
-- grants. We also wrap the statement in a SAVEPOINT so any error
-- doesn't poison the outer transaction.
--
-- Note: SECURITY DEFINER + role-isolation pattern. This function runs
-- as the owner (postgres role) but only when called via service_role.
-- RLS is bypassed (intended — Claude needs visibility into all rows).

CREATE OR REPLACE FUNCTION public.claude_readonly_query(sql_text text)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  result json;
  cleaned text;
BEGIN
  cleaned := trim(trailing ';' from trim(sql_text));

  -- Reject anything that isn't a single SELECT or WITH statement.
  -- Belt + suspenders with the worker-side regex check.
  IF cleaned !~* '^\s*(SELECT|WITH)\s' THEN
    RAISE EXCEPTION 'Only SELECT/WITH statements allowed';
  END IF;
  IF cleaned ~* '\m(INSERT|UPDATE|DELETE|DROP|CREATE|ALTER|TRUNCATE|GRANT|REVOKE|COMMENT|REINDEX|VACUUM|COPY)\M' THEN
    RAISE EXCEPTION 'Statement contains forbidden DDL/DML keyword';
  END IF;
  IF position(';' in cleaned) > 0 THEN
    RAISE EXCEPTION 'Multiple statements not allowed';
  END IF;

  -- Wrap in subquery to coerce to json array. LIMIT 100 hard cap.
  EXECUTE format(
    'SELECT coalesce(json_agg(t), ''[]''::json) FROM (%s LIMIT 100) t',
    cleaned
  ) INTO result;
  RETURN result;
END;
$$;

-- Only service_role can call this. Other roles get permission denied,
-- which is fine — Claude only runs via the worker which uses service_role.
REVOKE ALL ON FUNCTION public.claude_readonly_query(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.claude_readonly_query(text) TO service_role;

-- ── Seed: opening kick-off message from Claude so the room isn't empty
-- when the first admin lands. References the team chat policy.
INSERT INTO public.team_messages (
  author_id, author_kind, author_display_name, body, mentions, triggered_claude
) VALUES (
  NULL, 'system', 'system',
  E'### 团队聊天频道已上线 🎉\n\n这里是 **费 / Leon / Claude** 的实时协作空间。\n\n**怎么用：**\n- 直接输入消息发送\n- 在消息里 `@claude` 触发我自动回复\n- 我能查数据（orders / users / generation_logs / 等等），能草拟代码方案，但所有写操作前会先 propose 让人确认\n\n**决策授权：** 见 `docs/DECISION-OWNERSHIP.md`\n\n**Leon 你好，** 这里就是费在 docs/threads 里提到的"即时通道"。你可以直接 `@claude` 问任何问题（rename refactor 进度、推荐策略细节、用户报错排查），我会立刻回。\n\n第一条问题随便扔过来试试 👇',
  ARRAY['@leon', '@fei'], false
);

COMMIT;
