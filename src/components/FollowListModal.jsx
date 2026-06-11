import React, { useEffect, useState } from 'react';
import { X, UserCircle, ArrowsClockwise } from '@phosphor-icons/react';
import { fetchFollowingList, fetchFollowerList } from '../api/followService';

/**
 * FollowListModal — shows the list of users I'm Following or Followers.
 *
 * Props:
 *   mode: 'following' | 'followers'
 *   onClose: () => void
 *   onUserClick: (userId: string) => void — opens UserProfilePage
 *   followingUsers: Set<string> — current following set (for the toggle state)
 *   toggleFollow: (userId, isFollowing) => Promise<void>
 *
 * Layout: centered modal w/ scrollable list. Each row = avatar + name +
 * Follow/Unfollow button (Following mode shows Unfollow; Followers mode
 * shows Follow/Following depending on whether you also follow them back).
 *
 * Click on row body (not button) → calls onUserClick(id) which the parent
 * uses to navigate to UserProfilePage `/u/:userId`.
 */
export default function FollowListModal({ mode, onClose, onUserClick, followingUsers, toggleFollow }) {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [acting, setActing] = useState(null); // userId mid-toggle

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const fn = mode === 'followers' ? fetchFollowerList : fetchFollowingList;
        const list = await fn();
        if (!cancelled) setUsers(list);
      } catch (e) {
        if (!cancelled) setError(e.message || 'Failed to load');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [mode]);

  const title = mode === 'followers' ? 'Followers' : 'Following';
  const emptyText = mode === 'followers'
    ? 'No followers yet.'
    : 'Not following anyone yet.';
  const emptyHint = mode === 'followers'
    ? 'Share your work — others will discover and follow you.'
    : 'Find creators you like and tap Follow to see their work in your feed.';

  const handleToggle = async (e, userId) => {
    e.stopPropagation();
    if (!toggleFollow) return;
    setActing(userId);
    try {
      const isFollowing = followingUsers?.has(userId) || false;
      await toggleFollow(userId, isFollowing);
      // If this is the Following list and we just unfollowed, remove the row
      // immediately for the optimistic-update feel (parent's state update
      // already inverted followingUsers, so re-render of this list isn't
      // automatic; we mutate local users).
      if (mode === 'following' && isFollowing) {
        setUsers(prev => prev.filter(u => u.id !== userId));
      }
    } finally {
      setActing(null);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center bg-black/60 backdrop-blur-sm animate-in fade-in duration-150"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md max-h-[80vh] bg-background border border-background-tertiary rounded-2xl shadow-2xl overflow-hidden flex flex-col mx-4"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-5 py-3 border-b border-background-tertiary flex items-center justify-between flex-shrink-0">
          <h3 className="text-sm font-medium text-label">{title}</h3>
          <button onClick={onClose} className="p-1.5 text-label-tertiary hover:text-label rounded transition-colors">
            <X size={14} weight="bold" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto">
          {loading && (
            <div className="flex items-center justify-center py-12 text-label-secondary text-sm gap-2">
              <ArrowsClockwise size={14} className="animate-spin" /> Loading…
            </div>
          )}

          {error && !loading && (
            <div className="px-5 py-8 text-center text-red-400 text-sm">{error}</div>
          )}

          {!loading && !error && users.length === 0 && (
            <div className="px-6 py-12 text-center">
              <p className="text-label text-sm font-medium mb-1">{emptyText}</p>
              <p className="text-label-tertiary text-xs max-w-[280px] mx-auto leading-relaxed">{emptyHint}</p>
            </div>
          )}

          {!loading && !error && users.length > 0 && (
            <ul className="divide-y divide-background-tertiary">
              {users.map(u => {
                const isCurrentlyFollowing = followingUsers?.has(u.id) || false;
                const isActing = acting === u.id;
                const showFollowBtn = mode === 'following' || !isCurrentlyFollowing;
                return (
                  <li
                    key={u.id}
                    className="flex items-center gap-3 px-5 py-3 hover:bg-background-secondary/50 cursor-pointer transition-colors"
                    onClick={() => onUserClick?.(u.id)}
                  >
                    {u.avatar_url ? (
                      <img src={u.avatar_url} alt="" className="w-10 h-10 rounded-full bg-background-tertiary flex-shrink-0 object-cover" />
                    ) : (
                      <div className="w-10 h-10 rounded-full bg-background-tertiary flex-shrink-0 flex items-center justify-center text-label-tertiary">
                        <UserCircle size={28} />
                      </div>
                    )}
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-medium text-label truncate">
                        {u.username || u.id.substring(0, 8) + '…'}
                      </div>
                      <div className="text-[11px] text-label-tertiary">
                        {mode === 'followers' ? 'Follows you' : 'You follow them'}
                      </div>
                    </div>

                    {/* In Following mode → Unfollow button (with confirm via the toggleFollow flow).
                        In Followers mode → "Follow back" if not already following them. */}
                    {showFollowBtn && (
                      <button
                        onClick={(e) => handleToggle(e, u.id)}
                        disabled={isActing}
                        className={`flex-shrink-0 px-3 py-1.5 text-xs font-medium rounded-full transition-colors disabled:opacity-50 ${
                          isCurrentlyFollowing
                            ? 'bg-background-secondary border border-background-tertiary text-label hover:bg-background-tertiary'
                            : 'bg-accent text-white hover:opacity-90'
                        }`}
                      >
                        {isActing
                          ? '…'
                          : isCurrentlyFollowing ? 'Unfollow' : 'Follow back'}
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
