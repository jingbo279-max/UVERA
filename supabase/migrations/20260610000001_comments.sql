-- ═══════════════════════════════════════════════════════════════════════════
-- §2026-06-10 — Comments feature (discover/immerse 评论)
--
-- 决策(Leon 2026-06-10):
--   · 回复结构 = 一层(top-level + 一层 reply,@对方,不再嵌套)
--   · 删除 = 有回复→软删(保留占位,清 author_id/avatar/nickname 防隐私泄露 +
--     点赞数清零);无回复→硬删。权限 = 评论作者 OR 作品主 OR admin。
--   · 评论本身可点赞(comment_likes,独立计数,沿用 user_likes 范式)。
--   · 计数列对齐 likes/saves:recommended_content.comments_count by trigger;
--     comments.likes_count by trigger。
--
-- 鉴权范式对齐 follows / user_likes:RLS auth.uid() 自校验,前端走
--   commentService 直连 supabase client(client SDK + RLS,不经 worker)。
--   删除走 SECURITY DEFINER RPC delete_comment()(条件软/硬删 + 身份擦除 +
--   三方删权,原子,对齐项目"写操作走 RPC"规约)。
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── 1. comments 表 ───────────────────────────────────────────────────────────
-- author_id NULLABLE 且 ON DELETE SET NULL:软删时置 NULL 擦除身份;账号注销时
--   评论保留为匿名占位(不连锁删评论)。
CREATE TABLE IF NOT EXISTS public.comments (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  content_id  uuid NOT NULL REFERENCES public.recommended_content(id) ON DELETE CASCADE,
  author_id   uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  body        text NOT NULL CHECK (char_length(body) BETWEEN 1 AND 2000),
  parent_id   uuid REFERENCES public.comments(id) ON DELETE CASCADE,  -- 一层 reply
  reply_to_author_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,  -- 结构化 @mention 目标(回复一条 reply 时存被回复者 id)
  mentions    jsonb NOT NULL DEFAULT '[]'::jsonb,  -- 正文内 @ 提及:[{username, user_id}](自动补全选中的用户,渲染成链接)
  likes_count integer NOT NULL DEFAULT 0,
  deleted_at  timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS comments_content_idx ON public.comments(content_id, created_at);
CREATE INDEX IF NOT EXISTS comments_parent_idx  ON public.comments(parent_id);
CREATE INDEX IF NOT EXISTS comments_author_idx  ON public.comments(author_id);

-- ── 2. comment_likes 表(对称 user_likes) ────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.comment_likes (
  user_id    uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  comment_id uuid NOT NULL REFERENCES public.comments(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, comment_id)
);
CREATE INDEX IF NOT EXISTS comment_likes_comment_idx ON public.comment_likes(comment_id);

-- ── 3. recommended_content.comments_count 列 ─────────────────────────────────
ALTER TABLE public.recommended_content
  ADD COLUMN IF NOT EXISTS comments_count integer NOT NULL DEFAULT 0;

-- ── 4. 一层回复 guard(reply 的 parent 必须是 top-level + 同内容) ────────────
CREATE OR REPLACE FUNCTION public.enforce_comment_one_level()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_parent_parent uuid;
  v_parent_content uuid;
BEGIN
  IF NEW.parent_id IS NOT NULL THEN
    SELECT parent_id, content_id INTO v_parent_parent, v_parent_content
      FROM comments WHERE id = NEW.parent_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'parent comment % not found', NEW.parent_id;
    END IF;
    IF v_parent_parent IS NOT NULL THEN
      RAISE EXCEPTION 'replies cannot be nested beyond one level';
    END IF;
    IF v_parent_content <> NEW.content_id THEN
      RAISE EXCEPTION 'reply must belong to the same content as its parent';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS comments_one_level ON public.comments;
CREATE TRIGGER comments_one_level
  BEFORE INSERT ON public.comments
  FOR EACH ROW EXECUTE FUNCTION public.enforce_comment_one_level();

-- ── 5. comments_count trigger(对齐 bump_likes_count) ────────────────────────
-- 计 live(非软删)评论数 = top-level + reply 全计。INSERT +1;硬 DELETE -1。
-- 软删是 UPDATE 不触发此 trigger,由 delete_comment RPC 手动 -1。
CREATE OR REPLACE FUNCTION public.bump_comments_count()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE recommended_content SET comments_count = comments_count + 1
      WHERE id = NEW.content_id;
  ELSIF TG_OP = 'DELETE' THEN
    -- 软删行(deleted_at 已置)已在 RPC 里 -1 过,硬 DELETE 它时不再重复 -1
    IF OLD.deleted_at IS NULL THEN
      UPDATE recommended_content SET comments_count = GREATEST(comments_count - 1, 0)
        WHERE id = OLD.content_id;
    END IF;
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS comments_count_bump ON public.comments;
CREATE TRIGGER comments_count_bump
  AFTER INSERT OR DELETE ON public.comments
  FOR EACH ROW EXECUTE FUNCTION public.bump_comments_count();

-- ── 6. comment_likes count trigger(维护 comments.likes_count) ────────────────
CREATE OR REPLACE FUNCTION public.bump_comment_likes_count()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE comments SET likes_count = likes_count + 1 WHERE id = NEW.comment_id;
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE comments SET likes_count = GREATEST(likes_count - 1, 0) WHERE id = OLD.comment_id;
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS comment_likes_count_bump ON public.comment_likes;
CREATE TRIGGER comment_likes_count_bump
  AFTER INSERT OR DELETE ON public.comment_likes
  FOR EACH ROW EXECUTE FUNCTION public.bump_comment_likes_count();

-- ── 7. delete_comment RPC(条件软/硬删 + 身份擦除 + 三方删权) ─────────────────
CREATE OR REPLACE FUNCTION public.delete_comment(p_comment_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid     uuid := auth.uid();
  v_comment public.comments%ROWTYPE;
  v_owner   uuid;
  v_artist  text;
  v_has_replies boolean;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'auth_required');
  END IF;

  SELECT * INTO v_comment FROM comments WHERE id = p_comment_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'not_found');
  END IF;

  -- 作品主:recommended_content.artist 存 UUID(或 legacy 字符串)。仅 UUID 形态可比对。
  SELECT artist INTO v_artist FROM recommended_content WHERE id = v_comment.content_id;
  IF v_artist ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
    v_owner := v_artist::uuid;
  END IF;

  -- 权限:评论作者 OR 作品主 OR admin
  IF NOT (v_comment.author_id = v_uid OR v_owner = v_uid OR public.is_admin()) THEN
    RETURN jsonb_build_object('success', false, 'error', 'forbidden');
  END IF;

  -- 已软删的不重复处理
  IF v_comment.deleted_at IS NOT NULL THEN
    RETURN jsonb_build_object('success', true, 'mode', 'already_deleted');
  END IF;

  SELECT EXISTS(
    SELECT 1 FROM comments c WHERE c.parent_id = p_comment_id AND c.deleted_at IS NULL
  ) INTO v_has_replies;

  IF v_has_replies THEN
    -- 软删:擦除身份 + 清空正文 + 点赞清零 + 删点赞行;保留占位维持回复树
    DELETE FROM comment_likes WHERE comment_id = p_comment_id;
    UPDATE comments
       SET deleted_at  = now(),
           author_id   = NULL,
           body        = '',
           likes_count = 0
     WHERE id = p_comment_id;
    -- 软删不触发 comments_count trigger,手动 -1
    UPDATE recommended_content SET comments_count = GREATEST(comments_count - 1, 0)
     WHERE id = v_comment.content_id;
    RETURN jsonb_build_object('success', true, 'mode', 'soft');
  ELSE
    -- 硬删:DELETE trigger 自动 comments_count -1;comment_likes 级联删
    DELETE FROM comments WHERE id = p_comment_id;
    RETURN jsonb_build_object('success', true, 'mode', 'hard');
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.delete_comment(uuid) TO authenticated;

-- ── 8. RLS ───────────────────────────────────────────────────────────────────
ALTER TABLE public.comments      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.comment_likes ENABLE ROW LEVEL SECURITY;

-- comments:公开读(软删行已擦身份+空正文,前端渲染"[已删除]"占位);
--   登录用户只能插入自己署名的评论;无 UPDATE/DELETE policy → 删除一律走 RPC。
DROP POLICY IF EXISTS comments_read_public ON public.comments;
CREATE POLICY comments_read_public ON public.comments
  FOR SELECT USING (true);

DROP POLICY IF EXISTS comments_insert_self ON public.comments;
CREATE POLICY comments_insert_self ON public.comments
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = author_id);

-- comment_likes:对称 user_likes — 只读/写/删自己的行
DROP POLICY IF EXISTS comment_likes_select_own ON public.comment_likes;
CREATE POLICY comment_likes_select_own ON public.comment_likes
  FOR SELECT TO authenticated USING (auth.uid() = user_id);

DROP POLICY IF EXISTS comment_likes_insert_own ON public.comment_likes;
CREATE POLICY comment_likes_insert_own ON public.comment_likes
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS comment_likes_delete_own ON public.comment_likes;
CREATE POLICY comment_likes_delete_own ON public.comment_likes
  FOR DELETE TO authenticated USING (auth.uid() = user_id);

-- ── 9. 授权 ──────────────────────────────────────────────────────────────────
GRANT SELECT ON public.comments TO anon, authenticated;
GRANT INSERT ON public.comments TO authenticated;
GRANT SELECT, INSERT, DELETE ON public.comment_likes TO authenticated;

COMMIT;
