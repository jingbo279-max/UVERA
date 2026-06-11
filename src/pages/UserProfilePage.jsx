import React, { useState, useEffect } from 'react';
import { supabase } from '../api/supabaseClient';
import { CaretLeft, UserCircle, CircleNotch } from '@phosphor-icons/react';
import MasonryGrid from '../components/MasonryGrid';
import SegmentedControl from '../design-system/composites/SegmentedControl';
import GlassButton from '../design-system/primitives/GlassButton';
import { formatCompactNumber } from '../utils/formatNumber';
import { normalizeRecommendedList } from '../utils/normalizeRecommended';

/* ─────────────────────────────────────────────────────────── */
/*  UserProfilePage — 看别人的主页（route: /u/:userId）         */
/*                                                            */
/*  与 SelfProfilePage 的区别（2026-05-08 重命名）：            */
/*   - 无 Edit Profile / Wallet / Settings / SignOut          */
/*   - 无 Liked tab（用户私域偏好不公开）                       */
/*   - 不展示 characters / Avatars 库（§1 红线 — 私有 Avatar    */
/*     只能 owner 调用，看别人不能看其分身库）                   */
/*   - 加 Back 按钮 + Follow 按钮（已接 follows 表）            */
/* ─────────────────────────────────────────────────────────── */
export default function UserProfilePage({
  userId,
  isSmallScreen,
  onBack,
  allItems,
  isMuted,
  likedItems,
  toggleLike,
  savedItems,
  toggleSave,
  onPlay,
  onChain,
  cardRefs,
  videoRefs,
  audioRefs,
  hoveredCard,
  setHoveredCard,
  visibleCards,
  followingUsers,   // Set<string> — 当前登录用户已关注的 userIds
  toggleFollow,     // (userId: string) => Promise<void>
}) {
  const [profile, setProfile] = useState(null);
  const [profileTab, setProfileTab] = useState('works'); // 'works' (round-105: recasts tab 删除)
  const [stats, setStats] = useState({ works: 0, followers: 0, following: 0, likes: 0 });
  const [userWorks, setUserWorks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [currentUserId, setCurrentUserId] = useState(null);
  const [followBusy, setFollowBusy] = useState(false);

  /* Resolve current logged-in user (to suppress Follow on own profile) */
  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      setCurrentUserId(data?.user?.id || null);
    });
  }, []);

  /* Load profile + works + follower/following counts */
  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    setLoading(true);
    setError(null);

    (async () => {
      try {
        const [profileRes, worksRes, followersRes, followingRes] = await Promise.all([
          supabase.from('profiles').select('id, username, avatar_url, bio').eq('id', userId).maybeSingle(),
          supabase.from('recommended_content').select('*').eq('artist', userId).order('createdAt', { ascending: false }),
          supabase.from('follows').select('*', { count: 'exact', head: true }).eq('following_id', userId),
          supabase.from('follows').select('*', { count: 'exact', head: true }).eq('follower_id', userId),
        ]);

        if (cancelled) return;

        if (profileRes.error) throw profileRes.error;

        /* 2026-05-13 — Normalize raw rows: `item.artist` from DB is raw UUID,
           会让卡片底部显示 36-char UUID 而不是 username。注入 profile.username
           后 normalize → 卡片显示 "jingbo" / 创作者名,不再裸 UUID。 */
        const profileUsername = profileRes.data?.username || null;
        const decoratedRows = (worksRes.data || []).map(w => ({
          ...w,
          artist_username: w.artist_username || profileUsername,
        }));
        const normalized = normalizeRecommendedList(decoratedRows);
        /* §2026-05-29 Leon round-105 — Recast 取消,filter 老 #Recast 数据 (backend Phase B 清理后可删此 filter) */
        const fetchedWorks = normalized.filter(item => !(item.tags || []).includes('#Recast'));
        const totalLikes = (worksRes.data || []).reduce((sum, w) => sum + (w.likes_count || 0), 0);

        setProfile(profileRes.data);
        setUserWorks(fetchedWorks);
        setStats({
          works: fetchedWorks.length,
          followers: followersRes.count || 0,
          following: followingRes.count || 0,
          likes: totalLikes,
        });
      } catch (e) {
        if (!cancelled) setError(e?.message || 'Failed to load profile');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, [userId]);

  const isOwnProfile = currentUserId && currentUserId === userId;
  const isFollowing = followingUsers?.has?.(userId) || false;

  const handleToggleFollow = async () => {
    if (!toggleFollow || followBusy || isOwnProfile) return;
    setFollowBusy(true);
    try {
      await toggleFollow(userId);
      // Optimistic counter bump (server-side count refresh on next mount)
      setStats(s => ({ ...s, followers: s.followers + (isFollowing ? -1 : 1) }));
    } catch (err) {
      console.error('Follow toggle failed:', err);
      alert(err?.message || 'Follow failed');
    } finally {
      setFollowBusy(false);
    }
  };

  const activeItems = userWorks;

  /* ── Loading ───────────────────────────────────────────── */
  if (loading) {
    return (
      <div className="w-full min-h-screen flex items-center justify-center pt-20">
        <CircleNotch size={28} className="animate-spin text-accent" />
      </div>
    );
  }

  /* ── User not found / error ────────────────────────────── */
  if (error || !profile) {
    return (
      <div className="w-full min-h-screen flex flex-col items-center justify-center pt-20 px-4 text-center">
        <div className="w-20 h-20 rounded-full bg-background-secondary flex items-center justify-center mb-4">
          <UserCircle size={48} className="text-label-tertiary" />
        </div>
        <h2 className="text-lg font-medium text-label mb-1">User not found</h2>
        <p className="text-sm text-label-secondary mb-6 max-w-xs">
          {error || 'This profile is unavailable or has been removed.'}
        </p>
        {onBack && (
          <button
            onClick={onBack}
            className="px-5 py-2.5 rounded-full border border-background-tertiary bg-background hover:bg-background-secondary text-[14px] font-medium text-label transition-colors"
          >
            Back
          </button>
        )}
      </div>
    );
  }

  const displayName = profile.username || 'Creator';

  return (
    /* 2026-05-08 Leon — desktop 主内容区 padding 与 Discover MasonryGrid /
     * Library 统一：pl 92 / pr 56。Mobile 各 children 保留 px-4 自身。 */
    <div
      className={`w-full min-h-screen pb-[max(env(safe-area-inset-bottom,72px),72px)] flex flex-col ${isSmallScreen ? 'pt-2' : 'pt-10'}`}
      style={isSmallScreen ? undefined : { paddingLeft: '92px', paddingRight: '56px' }}
    >

      {/* ── Header Area ── */}
      <div className={`flex flex-col items-center ${isSmallScreen ? 'px-4' : ''} pt-4 pb-6 relative`}>

        {/* Back button (top left) — 标准 GlassButton(与 immerse 返回按钮同款):
            玻璃视觉 40pt + 点击区 44pt(Apple HIG)。颜色走主题 token 自适应。 */}
        {onBack && (
          <GlassButton
            onClick={onBack}
            aria-label="Back"
            variant="prominent"
            size="regular"
            className="absolute top-2 left-4 text-label-secondary hover:text-label transition-colors"
          >
            <CaretLeft size={20} weight="bold" />
          </GlassButton>
        )}

        {/* Profile Picture (read-only — viewing someone else's) */}
        <div className="relative w-24 h-24 rounded-full mt-2 overflow-hidden shadow-[0_4px_16px_rgba(99,102,241,0.3)] border-2 border-background">
          {profile.avatar_url ? (
            <img
              src={profile.avatar_url}
              alt={`Profile picture of ${displayName}`}
              className="w-full h-full object-cover"
            />
          ) : (
            <div className="w-full h-full bg-gradient-to-br from-indigo-400 to-purple-500 flex items-center justify-center">
              <UserCircle size={64} weight="fill" className="text-white opacity-95" />
            </div>
          )}
        </div>

        {/* User Info */}
        <div className="mt-4 text-center max-w-md">
          <h1 className="text-[20px] font-bold text-label leading-tight">{displayName}</h1>
          {profile.bio && (
            <p className="text-sm text-label-secondary mt-1.5 leading-relaxed whitespace-pre-line">
              {profile.bio}
            </p>
          )}
        </div>

        {/* Stats Row */}
        <div className="flex items-center gap-6 mt-5 text-center">
          <div className="flex flex-col">
            <span className="text-[17px] font-bold text-label">{formatCompactNumber(stats.works)}</span>
            <span className="text-[11px] font-medium text-label-tertiary uppercase tracking-wider">Works</span>
          </div>
          <div className="w-px h-8 bg-background-tertiary" />
          <div className="flex flex-col">
            <span className="text-[17px] font-bold text-label">{formatCompactNumber(stats.followers)}</span>
            <span className="text-[11px] font-medium text-label-tertiary uppercase tracking-wider">Followers</span>
          </div>
          <div className="w-px h-8 bg-background-tertiary" />
          <div className="flex flex-col">
            <span className="text-[17px] font-bold text-label">{formatCompactNumber(stats.following)}</span>
            <span className="text-[11px] font-medium text-label-tertiary uppercase tracking-wider">Following</span>
          </div>
          <div className="w-px h-8 bg-background-tertiary" />
          <div className="flex flex-col">
            <span className="text-[17px] font-bold text-label">{formatCompactNumber(stats.likes)}</span>
            <span className="text-[11px] font-medium text-label-tertiary uppercase tracking-wider">Likes</span>
          </div>
        </div>

        {/* Follow / Following button (suppressed on own profile) */}
        {!isOwnProfile && (
          <button
            onClick={handleToggleFollow}
            disabled={followBusy}
            className={`mt-6 px-8 py-2.5 rounded-full text-[14px] font-medium transition-colors w-full max-w-[200px] disabled:opacity-60 ${
              isFollowing
                ? 'border border-background-tertiary bg-background hover:bg-background-secondary text-label'
                : 'bg-accent text-white hover:opacity-90'
            }`}
          >
            {followBusy ? '…' : isFollowing ? 'Following' : 'Follow'}
          </button>
        )}
      </div>

      {/* ── Tabs SegmentedControl (sticky 在 Header 内,垂直居中) ──
       * 2026-05-13 Leon — 真 sticky 行为:初始位置在 stats / Follow 按钮下方
       * (与瀑布流之上),随页面滚动上移,top edge 触到 sticky 阈值时 pin 住。
       *
       * **pin 位置 = Header 内部垂直居中**(不是 Header 底边下方),视觉上
       * 与 Discover 的 SegmentedControl-in-Header 等价 — pin 后 pill 看起来
       * 就在 Header 里和 logo / 右侧 controls 同高。
       *
       * 数学(Chrome 实测,Safari/FF 应同 spec):
       *   scroll container = `<div ... pt-20 overflow-y-auto>` (index.jsx)
       *   sticky `top` 偏移是从 **scroll container CONTENT 边** 起算(即
       *   pt-20=80px 内边距之后),不是 border-box top。所以要 pin 在视口
       *   y=22 处,实际 top 值 = 22 - 80 = **-58**。这个细节坑过我一次
       *   (top:22 → 实际 y=102,80px 错位)。
       *
       *   pill height = 36 (SegmentedControl.jsx h-[36px])
       *   Header height = 80 desktop / 52 mobile
       *   desktop: pill 居中 y=22 → top = 22 - 80 = -58
       *   mobile : pill 居中 y=8  → top = 8  - 80 = -72
       *
       * z-index:Header overlay 是 z-40,sticky pin 时 pill 落在 Header 同
       * 一 y 区段,必须 z>40 才不被 Header (虽然背景透明) 的 stacking
       * context 盖住。给 z=50。
       *
       * my-3 (margin not padding):sticky 容器盒只包 pill 本身 36px,margin
       * 12px 仅在自然位置提供视觉间距,不参与 sticky positioning 计算。
       *
       * 结构:外 sticky block / 内 flex 居中,避免 sticky+flex 同 div 触发
       * 部分浏览器阈值异常。 */}
      <div
        style={{
          position: 'sticky',
          top: isSmallScreen ? -72 : -58,
          zIndex: 50,
          pointerEvents: 'none',
        }}
        className="my-3"
      >
        <div className="w-full flex justify-center">
          {/* §2026-05-29 Leon round-105 — Recast tab 删除,只剩 Works 单 segment。
            * SegmentedControl 仍渲染保持视觉一致性 (label 化)。 */}
          <SegmentedControl
            segments={[{ value: 'works', label: 'Works' }]}
            value={profileTab}
            onChange={setProfileTab}
            className="pointer-events-auto w-[300px] mx-4"
          />
        </div>
      </div>

      {/* ── Content Grid ── */}
      {/* 2026-05-08 Leon — 去掉 bg-background：内容区直接浮在页面渐变上，
          避免 empty state 时显得是个 dark rectangle backdrop。 */}
      <div className="flex-1 pt-4">
        {activeItems.length === 0 ? (
          <div className={`flex flex-col items-center justify-center h-48 text-center ${isSmallScreen ? 'px-4' : ''}`}>
            <p className="text-label text-base font-medium mb-1">No works yet</p>
            <p className="text-label-secondary text-sm">This creator hasn’t shared anything yet.</p>
          </div>
        ) : (
          <MasonryGrid
            isSmallScreen={isSmallScreen}
            filteredMediaItems={activeItems}
            activeFilter="#All"
            setActiveFilter={() => {}}
            chips={['#All']}
            title=""
            overDarkBg={false}
            isMuted={isMuted}
            likedItems={likedItems}
            toggleLike={toggleLike}
            savedItems={savedItems}
            toggleSave={toggleSave}
            onPlay={onPlay}
            onChain={onChain}
            cardRefs={cardRefs}
            videoRefs={videoRefs}
            audioRefs={audioRefs}
            hoveredCard={hoveredCard}
            setHoveredCard={setHoveredCard}
            visibleCards={visibleCards}
            allItems={allItems}
            hideSearch={true}
          />
        )}
      </div>

    </div>
  );
}
