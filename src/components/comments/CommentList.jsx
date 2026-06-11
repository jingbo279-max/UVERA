/**
 * §2026-06-10 — CommentList:沉浸态评论 thread 展示(一层回复)。
 *
 * 纯展示 + 内联交互(点赞 / 删除 / 回复 composer),数据与写操作由上层
 * useComments 提供。desktop 右 pane 与 mobile 评论 sheet 共用。
 *
 * 删除按钮可见性:评论作者 OR 作品主(ownerId)。admin 由 RPC 兜底放行
 *   (UI 不单独暴露,admin moderation 走后台)。
 * 软删评论渲染"[已删除]"占位但保留其 replies(回复树不断裂)。
 */

import React, { useState } from 'react';
import { Heart, ChatCircle, Trash, CircleNotch, CaretDown, CaretUp } from '@phosphor-icons/react';
import { formatCompactNumber } from '../../utils/formatNumber';
import CommentComposer from './CommentComposer';

const escapeRegExp = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * 把正文里 stored mentions 的 "@username" linkify 成跳主页链接。
 * mentions: [{username, user_id|userId}]。无 mention 时原样返回 string。
 */
function renderBodyWithMentions(text, mentions, onUserProfile) {
  if (!text || !Array.isArray(mentions) || mentions.length === 0) return text;
  const map = new Map(mentions.map((m) => [m.username, m.user_id || m.userId]));
  const names = [...map.keys()].filter(Boolean).sort((a, b) => b.length - a.length).map(escapeRegExp);
  if (names.length === 0) return text;
  const re = new RegExp(`@(${names.join('|')})`, 'g');
  const out = [];
  let last = 0, m, key = 0;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const uname = m[1];
    const uid = map.get(uname);
    out.push(
      onUserProfile && uid ? (
        <button key={`mn${key++}`} onClick={() => onUserProfile(uid)}
          className="text-accent hover:underline cursor-pointer font-medium">@{uname}</button>
      ) : (
        <span key={`mn${key++}`} className="text-accent font-medium">@{uname}</span>
      )
    );
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

function relTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  const diff = Date.now() - d.getTime();
  const min = Math.floor(diff / 60000);
  if (min < 1)  return 'Just now';
  if (min < 60) return `${min}m`;
  const hr = Math.floor(min / 60);
  if (hr < 24)  return `${hr}h`;
  const day = Math.floor(hr / 24);
  if (day < 7)  return `${day}d`;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function CommentAvatar({ url, name, size = 32 }) {
  const [broken, setBroken] = useState(false);
  const initial = (name || '?').trim().charAt(0).toUpperCase();
  const dim = { width: size, height: size };
  if (url && !broken) {
    return (
      <img
        src={url}
        alt={name || 'avatar'}
        onError={() => setBroken(true)}
        className="rounded-full object-cover flex-shrink-0"
        style={dim}
      />
    );
  }
  return (
    <div
      className="rounded-full flex-shrink-0 flex items-center justify-center text-white text-xs font-semibold"
      style={{ ...dim, background: 'linear-gradient(135deg, #5B53FF 0%, #8E86FF 100%)' }}
    >
      {initial}
    </div>
  );
}

/** 单条评论行(顶层或回复)。 */
function CommentRow({
  comment, isReply, currentUserId, ownerId, onUserProfile,
  onLike, onDelete, onStartReply, busy,
}) {
  const canDelete = !comment.deleted && currentUserId &&
    (comment.authorId === currentUserId || (ownerId && currentUserId === ownerId));
  // 作者头像/名字链接到其主页(有 authorId + 回调 + 未软删时)
  const linkable = !comment.deleted && comment.authorId && onUserProfile;
  const goProfile = () => linkable && onUserProfile(comment.authorId);

  // 长正文折叠:超过 BODY_CLAMP 字符截断,带 Show more / Show less 切换
  const BODY_CLAMP = 120;
  const [bodyExpanded, setBodyExpanded] = useState(false);
  const isLong = !comment.deleted && !!comment.body && comment.body.length > BODY_CLAMP;
  const shownBody = isLong
    ? (bodyExpanded ? comment.body + ' ' : comment.body.slice(0, BODY_CLAMP).trimEnd() + '… ')
    : comment.body;

  return (
    <div className="flex gap-2.5" style={{ marginLeft: isReply ? 38 : 0 }}>
      {linkable ? (
        <button onClick={goProfile} className="flex-shrink-0 cursor-pointer" aria-label={`View ${comment.authorName || 'creator'} profile`}>
          <CommentAvatar url={comment.authorAvatarUrl} name={comment.authorName} size={isReply ? 28 : 32} />
        </button>
      ) : (
        <CommentAvatar url={comment.authorAvatarUrl} name={comment.authorName} size={isReply ? 28 : 32} />
      )}
      <div className="flex-1 min-w-0">
        <div className="flex items-baseline gap-2">
          {linkable ? (
            <button onClick={goProfile} className="text-xs font-semibold text-vision-secondary truncate hover:underline underline-offset-2 cursor-pointer">
              {comment.authorName || 'Anonymous'}
            </button>
          ) : (
            <span className="text-xs font-semibold text-vision-secondary truncate">
              {comment.deleted ? 'Deleted' : (comment.authorName || 'Anonymous')}
            </span>
          )}
          <span className="text-[11px] text-vision-tertiary flex-shrink-0">{relTime(comment.createdAt)}</span>
        </div>
        {comment.deleted ? (
          <p className="text-sm text-vision-tertiary italic mt-0.5">[评论已删除]</p>
        ) : (
          <p className="text-sm text-vision-primary mt-0.5 whitespace-pre-wrap break-words leading-snug">
            {comment.replyToAuthorId && comment.replyToName && (
              onUserProfile ? (
                <button
                  onClick={() => onUserProfile(comment.replyToAuthorId)}
                  className="text-accent hover:underline cursor-pointer font-medium mr-1 align-baseline"
                >@{comment.replyToName}</button>
              ) : (
                <span className="text-accent font-medium mr-1">@{comment.replyToName}</span>
              )
            )}
            {renderBodyWithMentions(shownBody, comment.mentions, onUserProfile)}
            {isLong && (
              <button
                onClick={() => setBodyExpanded((v) => !v)}
                className="text-vision-secondary hover:text-vision-primary cursor-pointer font-medium whitespace-nowrap"
              >
                {bodyExpanded ? 'less' : 'more'}
              </button>
            )}
          </p>
        )}

        {/* 行内操作:点赞 / 回复 / 删除 */}
        {!comment.deleted && (
          <div className="flex items-center gap-4 mt-1.5">
            <button
              onClick={() => onLike(comment)}
              disabled={busy}
              className="flex items-center gap-1 text-vision-tertiary hover:text-vision-secondary transition-colors cursor-pointer disabled:cursor-not-allowed"
              aria-label={comment.liked ? 'Unlike comment' : 'Like comment'}
            >
              <Heart size={15} weight={comment.liked ? 'fill' : 'regular'}
                     className={comment.liked ? 'text-red-500' : ''} />
              {comment.likesCount > 0 && (
                <span className="text-[11px]">{formatCompactNumber(comment.likesCount)}</span>
              )}
            </button>
            <button
              onClick={() => onStartReply(comment)}
              className="flex items-center gap-1 text-vision-tertiary hover:text-vision-secondary transition-colors cursor-pointer text-[11px]"
              aria-label="Reply"
            >
              <ChatCircle size={15} weight="regular" />
              Reply
            </button>
            {canDelete && (
              <button
                onClick={() => onDelete(comment)}
                disabled={busy}
                className="flex items-center gap-1 text-vision-tertiary hover:text-red-400 transition-colors cursor-pointer disabled:cursor-not-allowed text-[11px]"
                aria-label="Delete comment"
              >
                <Trash size={15} weight="regular" />
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/** 回复折叠/展开/加载更多的小控件(带短分隔线 + caret)。noLine 抑制前导线
 *  (同一行有多个 toggle 时,只让第一个带线,避免双横线)。 */
function ReplyToggle({ onClick, label, up, style, noLine }) {
  return (
    <button
      onClick={onClick}
      className="flex items-center gap-2 text-vision-secondary hover:text-vision-primary transition-colors cursor-pointer text-[11px] font-medium"
      style={style}
      aria-expanded={up || undefined}
    >
      {!noLine && <span className="inline-block w-5 h-px bg-white/20" />}
      {label}
      {up ? <CaretUp size={11} weight="bold" /> : <CaretDown size={11} weight="bold" />}
    </button>
  );
}

export default function CommentList({
  comments, loading, error, total,
  currentUserId, ownerId, onUserProfile,
  onLike, onDelete, onReply, posting,
}) {
  const [replyTo, setReplyTo]   = useState(null);   // top-level comment 对象
  const [busyId, setBusyId]     = useState(null);
  const FIRST_PAGE = 3;   // 首次展开显示 3 条(保持 pane 紧凑)
  const MORE_PAGE  = 10;  // 之后每次 +10(长 thread 快速看完)
  // top.id → 当前可见回复数(0/缺省 = 收起)。
  const [replyVisible, setReplyVisible] = useState(() => new Map());
  const visibleFor = (topId) => replyVisible.get(topId) || 0;
  const setVisibleFor = (topId, n) => setReplyVisible((prev) => {
    const m = new Map(prev); m.set(topId, n); return m;
  });

  // 回复某条:reply 指向其 top-level parent(一层)。回复一条 reply 时,
  // @mention 目标 = 该 reply 作者(结构化存 id,不写进正文 → 渲染成跳主页链接)。
  // 回复时全展开该 thread(Infinity),确保发出后能看到自己的回复。
  const startReply = (comment) => {
    const topId = comment.parentId || comment.id;
    const isReplyToReply = !!comment.parentId;
    setVisibleFor(topId, Infinity);
    setReplyTo({
      id: topId,
      name: comment.authorName,
      mentionId:   isReplyToReply ? comment.authorId : null,
      mentionName: isReplyToReply ? comment.authorName : null,
    });
  };

  const wrapLike = async (comment) => {
    setBusyId(comment.id);
    try { await onLike(comment); } catch { /* hook 已回滚 */ }
    finally { setBusyId(null); }
  };
  const wrapDelete = async (comment) => {
    setBusyId(comment.id);
    try { await onDelete(comment); } catch (e) { console.error(e); }
    finally { setBusyId(null); }
  };

  if (loading && comments.length === 0) {
    return (
      <div className="py-10 flex items-center justify-center text-vision-tertiary">
        <CircleNotch size={20} className="animate-spin" />
      </div>
    );
  }
  if (error) {
    return (
      <div className="py-8 text-center text-vision-tertiary text-sm">
        评论加载失败<br/>{error}
      </div>
    );
  }
  if (comments.length === 0) {
    return (
      <div className="py-12 text-center text-vision-tertiary text-sm">
        No comments yet.<br/>Be the first to comment.
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {comments.map((top) => {
        const replyCount = top.replies?.length || 0;
        const visible = Math.min(visibleFor(top.id), replyCount);
        const collapsed = visible === 0;
        const remaining = replyCount - visible;
        return (
        <div key={top.id} className="flex flex-col gap-3">
          <CommentRow
            comment={top} isReply={false}
            currentUserId={currentUserId} ownerId={ownerId} onUserProfile={onUserProfile}
            onLike={wrapLike} onDelete={wrapDelete} onStartReply={startReply}
            busy={busyId === top.id}
          />

          {/* 收起态:原位显示 "View N replies" */}
          {replyCount > 0 && collapsed && (
            <ReplyToggle
              onClick={() => setVisibleFor(top.id, Math.min(FIRST_PAGE, replyCount))}
              label={`View ${replyCount} ${replyCount === 1 ? 'reply' : 'replies'}`}
              style={{ marginLeft: 42 }}
            />
          )}

          {/* 展开态:渲染可见回复,控件移到回复下方。
           * "View N more replies" 与 "Hide replies" 同一行(Hide 在后)。 */}
          {replyCount > 0 && !collapsed && (
            <>
              {top.replies.slice(0, visible).map((r) => (
                <CommentRow
                  key={r.id} comment={r} isReply
                  currentUserId={currentUserId} ownerId={ownerId} onUserProfile={onUserProfile}
                  onLike={wrapLike} onDelete={wrapDelete} onStartReply={startReply}
                  busy={busyId === r.id}
                />
              ))}
              <div className="flex items-center gap-4" style={{ marginLeft: 42 }}>
                {remaining > 0 && (
                  <ReplyToggle
                    onClick={() => setVisibleFor(top.id, Math.min(visible + MORE_PAGE, replyCount))}
                    label={`View ${remaining} more`}
                  />
                )}
                <ReplyToggle
                  onClick={() => setVisibleFor(top.id, 0)}
                  label="Hide" up noLine={remaining > 0}
                />
              </div>
            </>
          )}

          {/* 内联回复 composer */}
          {replyTo?.id === top.id && (
            <div style={{ marginLeft: 38 }}>
              <CommentComposer
                compact
                autoFocus
                busy={posting}
                submitLabel="Reply"
                placeholder={`Reply to ${replyTo.mentionName || top.authorName || 'comment'}...`}
                onSubmit={async (body, mentions) => {
                  await onReply(body, replyTo.id, replyTo.mentionId || null, mentions);
                  setReplyTo(null);
                }}
                onCancel={() => setReplyTo(null)}
              />
            </div>
          )}
        </div>
        );
      })}
    </div>
  );
}
