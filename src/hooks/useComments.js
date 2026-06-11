/**
 * §2026-06-10 — useComments(contentId, { initialCount })
 *
 * 沉浸态评论区状态机。封装 fetch / post / reply / like / delete,
 * 暴露给 desktop 右 pane 与 mobile 评论 sheet 复用。
 *
 * - 切 contentId 自动重拉(带 race guard,旧请求结果丢弃)
 * - like 乐观更新 + 失败回滚
 * - post / delete 后整段 reload(结构会变:一层树 + 软/硬删),口径最稳
 * - total 与 recommended_content.comments_count 同口径(live 评论数)
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import {
  fetchComments, postComment, toggleCommentLike, deleteComment,
} from '../api/commentService';

export function useComments(contentId, { initialCount = 0 } = {}) {
  const [comments, setComments] = useState([]);
  const [total, setTotal]       = useState(initialCount);
  const [loading, setLoading]   = useState(false);
  const [error, setError]       = useState(null);
  const [posting, setPosting]   = useState(false);

  const reqIdRef = useRef(0);

  const load = useCallback(async (id) => {
    if (!id) { setComments([]); setTotal(0); return; }
    const reqId = ++reqIdRef.current;
    setLoading(true);
    setError(null);
    try {
      const { comments: list, total: t } = await fetchComments(id);
      if (reqId !== reqIdRef.current) return; // 已切到别的 item,丢弃
      setComments(list);
      setTotal(t);
    } catch (err) {
      if (reqId !== reqIdRef.current) return;
      console.error('[useComments] load failed:', err);
      setError(err.message || 'Failed to load comments');
    } finally {
      if (reqId === reqIdRef.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    setTotal(initialCount);
    load(contentId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contentId, load]);

  const post = useCallback(async (body, parentId = null, replyToAuthorId = null, mentions = []) => {
    if (!contentId) return;
    setPosting(true);
    try {
      await postComment(contentId, body, parentId, replyToAuthorId, mentions);
      await load(contentId);
    } finally {
      setPosting(false);
    }
  }, [contentId, load]);

  const remove = useCallback(async (commentId) => {
    await deleteComment(commentId);
    await load(contentId);
  }, [contentId, load]);

  // like 乐观更新(深拷贝 top + replies 的目标项)
  const like = useCallback(async (commentId, currentlyLiked) => {
    const apply = (delta, likedNext) => setComments((prev) => prev.map((top) => {
      if (top.id === commentId) {
        return { ...top, liked: likedNext, likesCount: Math.max(0, top.likesCount + delta) };
      }
      if (top.replies?.some((r) => r.id === commentId)) {
        return {
          ...top,
          replies: top.replies.map((r) =>
            r.id === commentId
              ? { ...r, liked: likedNext, likesCount: Math.max(0, r.likesCount + delta) }
              : r),
        };
      }
      return top;
    }));

    apply(currentlyLiked ? -1 : 1, !currentlyLiked);
    try {
      await toggleCommentLike(commentId, currentlyLiked);
    } catch (err) {
      console.error('[useComments] like failed:', err);
      apply(currentlyLiked ? 1 : -1, currentlyLiked); // 回滚
      throw err;
    }
  }, []);

  return {
    comments, total, loading, error, posting,
    reload: () => load(contentId),
    post, remove, like,
  };
}
