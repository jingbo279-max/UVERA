/**
 * §2026-06-10 — Comments service(discover/immerse 评论)。
 *
 * 鉴权范式对齐 followService:client SDK 直连 supabase + RLS 兜底,不经 worker。
 * 删除走 SECURITY DEFINER RPC delete_comment()(条件软/硬删 + 身份擦除 + 三方删权)。
 *
 * 表(migration 20260610000001_comments.sql):
 *   comments(id, content_id, author_id, body, parent_id, likes_count, deleted_at, created_at)
 *   comment_likes(user_id, comment_id)
 *   recommended_content.comments_count(trigger 维护)
 *
 * 回复结构:一层。fetchComments 返回 top-level 列表,每条带 replies[]。
 */

import { supabase } from './supabaseClient';

const requireAuth = async () => {
  const { data: { session }, error } = await supabase.auth.getSession();
  if (error || !session) throw new Error('Requires authentication');
  return session.user.id;
};

/** 把一行 DB comment + 作者 profile + liked 标记 normalize 成前端形状。 */
function normalizeComment(row, profileMap, likedSet) {
  const deleted = !!row.deleted_at;
  const prof = row.author_id ? profileMap.get(row.author_id) : null;
  const mentionProf = row.reply_to_author_id ? profileMap.get(row.reply_to_author_id) : null;
  return {
    id:         row.id,
    contentId:  row.content_id,
    parentId:   row.parent_id ?? null,
    authorId:   deleted ? null : (row.author_id ?? null),
    authorName: deleted ? null : (prof?.username ?? null),
    authorAvatarUrl: deleted ? null : (prof?.avatar_url ?? null),
    // 结构化 @mention:被回复者 id + 当前 profile 名(渲染成跳主页链接)
    replyToAuthorId: deleted ? null : (row.reply_to_author_id ?? null),
    replyToName:     deleted ? null : (mentionProf?.username ?? null),
    // 正文内 @ 提及:[{username, userId}](自动补全选中的用户,渲染时 linkify)
    mentions:   deleted ? [] : (Array.isArray(row.mentions) ? row.mentions : []),
    body:       deleted ? '' : row.body,
    likesCount: deleted ? 0 : (row.likes_count ?? 0),
    liked:      deleted ? false : likedSet.has(row.id),
    deleted,
    createdAt:  row.created_at,
    replies:    [],
  };
}

/**
 * 拉某条内容(recommended_content id)的全部评论,组装成一层树。
 * 返回 { comments: TopLevel[], total } —— total = live(非软删)评论数,
 * 与 recommended_content.comments_count 口径一致(top-level + reply 全计)。
 *
 * 软删的 top-level 评论(有回复 → 占位)仍返回(deleted:true),前端渲染"[已删除]"。
 * 软删的若无回复其实已硬删,不会出现。
 */
export const fetchComments = async (contentId) => {
  if (!contentId) return { comments: [], total: 0 };

  const { data: rows, error } = await supabase
    .from('comments')
    .select('id, content_id, author_id, body, parent_id, likes_count, reply_to_author_id, mentions, deleted_at, created_at')
    .eq('content_id', contentId)
    .order('created_at', { ascending: true });
  if (error) throw error;
  if (!rows || rows.length === 0) return { comments: [], total: 0 };

  // profiles(批量 join):评论作者 + @mention 被回复者,跳过软删的 null
  const authorIds = [...new Set(
    rows.flatMap(r => [r.author_id, r.reply_to_author_id]).filter(Boolean)
  )];
  let profileMap = new Map();
  if (authorIds.length > 0) {
    const { data: profiles } = await supabase
      .from('profiles')
      .select('id, username, avatar_url')
      .in('id', authorIds);
    profileMap = new Map((profiles || []).map(p => [p.id, p]));
  }

  // 当前用户对这些评论的 like 标记(RLS 只返回自己的行)
  let likedSet = new Set();
  const { data: { session } } = await supabase.auth.getSession();
  if (session) {
    const ids = rows.map(r => r.id);
    const { data: likes } = await supabase
      .from('comment_likes')
      .select('comment_id')
      .eq('user_id', session.user.id)
      .in('comment_id', ids);
    likedSet = new Set((likes || []).map(l => l.comment_id));
  }

  // 组装一层树
  const byId = new Map();
  const tops = [];
  for (const row of rows) {
    const c = normalizeComment(row, profileMap, likedSet);
    byId.set(c.id, c);
    if (!c.parentId) tops.push(c);
  }
  for (const row of rows) {
    if (row.parent_id) {
      const parent = byId.get(row.parent_id);
      if (parent) parent.replies.push(byId.get(row.id));
    }
  }
  // replies 内部按时间升序(已天然有序,显式保证)
  for (const t of tops) {
    t.replies.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
  }
  // top-level 按时间降序(新评论在上)
  tops.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

  // total = live 评论数(排除软删占位)
  const total = rows.reduce((n, r) => n + (r.deleted_at ? 0 : 1), 0);
  return { comments: tops, total };
};

/**
 * 发评论。parentId 非空 = 回复某 top-level 评论(一层,DB trigger 拒绝二层嵌套)。
 * 返回插入行(未 join 作者,调用方乐观更新或 refetch)。
 */
export const postComment = async (contentId, body, parentId = null, replyToAuthorId = null, mentions = []) => {
  const userId = await requireAuth();
  const text = (body || '').trim();
  if (!text) throw new Error('Comment cannot be empty');
  if (text.length > 2000) throw new Error('Comment too long (max 2000)');

  // 仅保留 @username 仍出现在正文里的 mention(用户可能删掉了插入的 @)
  const liveMentions = (Array.isArray(mentions) ? mentions : [])
    .filter((m) => m && m.username && m.userId && text.includes(`@${m.username}`))
    // 去重(同一人多次提及只存一条)
    .filter((m, i, arr) => arr.findIndex((x) => x.userId === m.userId) === i)
    .map((m) => ({ username: m.username, user_id: m.userId }));

  const { data, error } = await supabase
    .from('comments')
    .insert({
      content_id: contentId, author_id: userId, body: text,
      parent_id: parentId, reply_to_author_id: replyToAuthorId,
      mentions: liveMentions,
    })
    .select('id, content_id, author_id, body, parent_id, likes_count, reply_to_author_id, mentions, deleted_at, created_at')
    .single();
  if (error) throw error;
  return data;
};

/** toggle 评论点赞。返回新的 liked 布尔。 */
export const toggleCommentLike = async (commentId, isCurrentlyLiked) => {
  const userId = await requireAuth();
  if (isCurrentlyLiked) {
    const { error } = await supabase
      .from('comment_likes')
      .delete()
      .match({ user_id: userId, comment_id: commentId });
    if (error) throw error;
    return false;
  } else {
    const { error } = await supabase
      .from('comment_likes')
      .insert({ user_id: userId, comment_id: commentId });
    if (error) throw error;
    return true;
  }
};

/**
 * 删评论。条件软/硬删 + 身份擦除 + 三方删权全在 RPC 内原子完成。
 * 返回 { success, mode: 'soft'|'hard'|'already_deleted', error? }。
 */
export const deleteComment = async (commentId) => {
  await requireAuth();
  const { data, error } = await supabase.rpc('delete_comment', { p_comment_id: commentId });
  if (error) throw error;
  if (data && data.success === false) {
    const e = new Error(data.error || 'Delete failed');
    e.code = data.error;
    throw e;
  }
  return data;
};

/**
 * @ 提及自动补全:按用户名前缀搜索 profiles。
 * 返回 [{ id, username, avatarUrl }],最多 limit 条;空 query 返回 []。
 * 公开读(profiles RLS 允许),anon 也能搜(渲染链接需要)。
 */
export const searchUsers = async (query, limit = 6) => {
  const q = (query || '').trim();
  if (!q) return [];
  const { data, error } = await supabase
    .from('profiles')
    .select('id, username, avatar_url')
    .ilike('username', `${q}%`)
    .not('username', 'is', null)
    .limit(limit);
  if (error) {
    console.warn('[commentService] searchUsers failed:', error.message);
    return [];
  }
  return (data || []).map((p) => ({ id: p.id, username: p.username, avatarUrl: p.avatar_url }));
};
