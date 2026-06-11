import React, { useState, useEffect } from 'react';
import { supabase } from '../api/supabaseClient';
import { UserCircle, Wallet, GearSix, SignOut } from '@phosphor-icons/react';
import MasonryGrid from '../components/MasonryGrid';
import SegmentedControl from '../design-system/composites/SegmentedControl';
import { formatCompactNumber } from '../utils/formatNumber';
import { normalizeRecommendedList } from '../utils/normalizeRecommended';
import { pickAndUploadProfilePicture, PROFILE_PICTURE_KEY } from './profile/uploadProfilePicture';

/* ─────────────────────────────────────────────────────────── */
/*  SelfProfilePage — 自己的个人主页 (route: /profile)          */
/*                                                            */
/*  原 MobileProfilePage 重命名 (2026-05-08 Leon)。命名对仗：  */
/*    SelfProfilePage  /profile     看自己（含 Edit / Wallet  */
/*                                  / Settings / SignOut /    */
/*                                  Liked tab）               */
/*    UserProfilePage  /u/:userId   看别人（无私域操作；含    */
/*                                  Back / Follow）           */
/*  Desktop + Mobile 共用此组件（按 isSmallScreen 切 mobile-  */
/*  only 行为，如 px-4 / safe-area padding）。                 */
/* ─────────────────────────────────────────────────────────── */
import FollowListModal from '../components/FollowListModal';
import { togglePublishedStatus } from '../api/worksService';

export default function SelfProfilePage({
  isSmallScreen,
  setActiveSection,
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
  followingUsers,
  toggleFollow,
}) {
  const [username, setUsername] = useState('Creator');
  const [email, setEmail]       = useState('');
  const [selfId, setSelfId]     = useState(null);
  const [profileTab, setProfileTab] = useState('works'); // 'works' | 'liked' | 'saved' (round-105: recasts 删除)
  const [stats, setStats] = useState({ works: 0, followers: 0, following: 0 });
  const [userWorks, setUserWorks] = useState([]);
  const [profilePictureUrl, setProfilePictureUrl] = useState('');
  const [uploadingPicture, setUploadingPicture] = useState(false);
  const [followListMode, setFollowListMode] = useState(null); // null | 'following' | 'followers'

  /* Load user info, works, and live follower count.
   *
   * 2026-05-11 fix — `following` and `followers` were previously read from
   * user_metadata, but those fields aren't auto-maintained when rows are
   * inserted into / deleted from the `follows` table. They'd drift from
   * reality after the first follow/unfollow. UserProfilePage already used
   * the right pattern (COUNT(*) on follows directly); SelfProfilePage now
   * matches:
   *   - followers ← COUNT(*) FROM follows WHERE following_id = me (server)
   *   - following ← followingUsers.size (already-loaded prop, always fresh)
   *
   * The Promise.all keeps mount cost flat — single round-trip instead of
   * sequential queries.
   *
   * 2026-05-13 fix —
   *   1. **Auth-state listener**: 之前 `useEffect(..., [])` 只在 mount 跑一次,
   *      用户切账号(同 tab logout → login)不重新拉数据,看到的是上一个账号
   *      残留的 userWorks / stats。现在 subscribe onAuthStateChange,任何
   *      SIGNED_IN / USER_UPDATED 都重新 loadProfileData,SIGNED_OUT 清空。
   *   2. **Normalize 数据**: 之前 `setUserWorks(raw worksRes.data)`,MasonryGrid
   *      渲染的 `item.artist` 是原始 UUID(36 chars),卡片底部显示
   *      "c7eda438-b427-4c69-bc0f-c87ee..." 而不是 username。改用
   *      normalizeRecommendedList,且先把 artist_username 注入(我们已经知道
   *      是自己的作品),保证显示名落到 jingbo / Creator 而不是 UUID 截断。
   *   3. **cancelled guard**: 防止 unmount 后 setState。 */
  useEffect(() => {
    let cancelled = false;

    const loadProfileData = async () => {
      const { data } = await supabase.auth.getUser();
      const u = data?.user;
      if (!u || cancelled) return;

      const myUsername = u.user_metadata?.username || u.email?.split('@')[0] || 'Creator';

      setSelfId(u.id);
      setUsername(myUsername);
      setEmail(u.email || '');
      setProfilePictureUrl(u.user_metadata?.[PROFILE_PICTURE_KEY] || u.user_metadata?.avatar_url || '');

      let fetchedWorks = [];
      let followersCount = 0;
      try {
        const [worksRes, followersRes] = await Promise.all([
          supabase
            .from('recommended_content')
            .select('*')
            .eq('artist', u.id)
            .order('createdAt', { ascending: false }),
          supabase
            .from('follows')
            .select('*', { count: 'exact', head: true })
            .eq('following_id', u.id),
        ]);
        if (worksRes.data) {
          /* 注入 artist_username 后再 normalize — normalizeRecommendedItem 优先
             读 dbItem.artist_username,否则会 fallback 到 UUID 截断 (`user_xxxxxxxx`),
             这里我们已经知道是自己的作品,直接用准确的 myUsername。 */
          const decorated = worksRes.data.map(w => ({ ...w, artist_username: myUsername }));
          const normalized = normalizeRecommendedList(decorated);
          /* §2026-05-29 Leon round-105 — Recast 取消,filter 老 #Recast 数据 */
          fetchedWorks = normalized.filter(item => !(item.tags || []).includes('#Recast'));
        }
        followersCount = followersRes.count || 0;
      } catch (err) {
        console.error('Failed to fetch user profile data:', err);
        followersCount = u.user_metadata?.followers || 0;
      }

      if (cancelled) return;
      setUserWorks(fetchedWorks);
      setStats({
        works: fetchedWorks.length,
        followers: followersCount,
        following: followingUsers?.size || 0,
      });
    };

    loadProfileData();

    /* Auth state listener — 切账号(SIGNED_IN/USER_UPDATED)时重新 loadProfileData,
       SIGNED_OUT 清空残留,防止 cross-account 数据泄露(甲方报: 切换账号后看到
       上个账号的作品 + 错的 stats counter)。 */
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'SIGNED_IN' || event === 'USER_UPDATED' || event === 'TOKEN_REFRESHED') {
        loadProfileData();
      } else if (event === 'SIGNED_OUT') {
        if (cancelled) return;
        setSelfId(null);
        setUsername('Creator');
        setEmail('');
        setProfilePictureUrl('');
        setUserWorks([]);
        setStats({ works: 0, followers: 0, following: 0 });
      }
    });

    return () => {
      cancelled = true;
      subscription?.unsubscribe?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* Keep "Following" count in sync with the live followingUsers Set —
   * when user unfollows from the modal (or follows back from Followers
   * modal), this set updates in the parent and we re-render. */
  useEffect(() => {
    setStats(prev => ({ ...prev, following: followingUsers?.size ?? prev.following }));
  }, [followingUsers]);

  const likedMediaItems = React.useMemo(() => {
    if (!allItems) return [];
    return allItems.filter(item => likedItems?.has(item.id));
  }, [allItems, likedItems]);

  const savedMediaItems = React.useMemo(() => {
    if (!allItems) return [];
    return allItems.filter(item => savedItems?.has(item.id));
  }, [allItems, savedItems]);

  const activeItems =
    profileTab === 'liked' ? likedMediaItems :
    profileTab === 'saved' ? savedMediaItems :
    userWorks;  // 'works' (round-105: recasts 删除)

  const handleLogout = async () => {
    try {
      await supabase.auth.signOut();
      window.location.reload();
    } catch (error) {
      console.error(error);
    }
  };

  const handleChangeProfilePicture = async () => {
    if (uploadingPicture) return;
    setUploadingPicture(true);
    try {
      const url = await pickAndUploadProfilePicture();
      if (url) setProfilePictureUrl(url);
    } catch (err) {
      console.error('Failed to update profile picture:', err);
      alert(err?.message || 'Failed to update profile picture');
    } finally {
      setUploadingPicture(false);
    }
  };

  return (
    /* 2026-05-08 Leon — desktop 主内容区 padding 与 Discover MasonryGrid /
     * Library / UserProfilePage 统一：pl 92 / pr 56。Mobile 各 children 保留
     * px-4 自身。 */
    <div
      className={`relative w-full min-h-screen pb-[max(env(safe-area-inset-bottom,72px),72px)] flex flex-col ${isSmallScreen ? 'pt-2' : 'pt-10'}`}
      style={isSmallScreen ? undefined : { paddingLeft: '92px', paddingRight: '56px' }}
    >

      {/* Actions row — 2026-05-08 Leon: fixed viewport-anchored 置顶（贴
       * NavigationBar 下方）。
       *   mobile NavigationBar ~52 高 → top-[60px] (8px breathing)
       *   desktop NavigationBar ~96 高 → top-[100px] (4px breathing)
       *   right-4 = 16px viewport edge。z-[15] 高于 sticky tabs (z-40 是
       *   tabs 但 fixed action bar 应在最上层；用 z-[45] 与 sticky tabs 同级
       *   或 higher 以免 scroll 时被 tabs 盖）。 */}
      <div className={`fixed z-[45] right-4 flex items-center gap-1 ${isSmallScreen ? 'top-3' : 'top-[100px]'}`}>
        <button
          onClick={() => setActiveSection('wallet')}
          className="w-11 h-11 flex items-center justify-center rounded-full bg-background-secondary border border-background-tertiary text-label-secondary hover:text-label transition-colors cursor-pointer"
          aria-label="Wallet"
        >
          <Wallet size={20} />
        </button>
        <button
          onClick={() => setActiveSection('settings')}
          className="w-11 h-11 flex items-center justify-center rounded-full bg-background-secondary border border-background-tertiary text-label-secondary hover:text-label transition-colors cursor-pointer"
          aria-label="Settings"
        >
          <GearSix size={20} />
        </button>
        <button
          onClick={handleLogout}
          className="w-11 h-11 flex items-center justify-center rounded-full bg-red-500/10 border border-red-500/20 text-red-400 hover:bg-red-500/20 transition-colors cursor-pointer"
          aria-label="Sign Out"
        >
          <SignOut size={20} />
        </button>
      </div>

      {/* ── Header Area ── */}
      <div className={`flex flex-col items-center ${isSmallScreen ? 'px-4' : ''} pt-4 pb-6`}>

        {/* Profile Picture */}
        <button
          type="button"
          onClick={handleChangeProfilePicture}
          disabled={uploadingPicture}
          aria-label="Change profile picture"
          className="relative w-24 h-24 rounded-full mt-2 overflow-hidden shadow-[0_4px_16px_rgba(99,102,241,0.3)] border-2 border-background cursor-pointer hover:opacity-90 transition-opacity disabled:opacity-60"
        >
          {profilePictureUrl ? (
            <img src={profilePictureUrl} alt="" className="w-full h-full object-cover" />
          ) : (
            <div className="w-full h-full bg-gradient-to-br from-indigo-400 to-purple-500 flex items-center justify-center">
              <UserCircle size={64} weight="fill" className="text-white opacity-95" />
            </div>
          )}
          {uploadingPicture && (
            <div className="absolute inset-0 bg-black/40 flex items-center justify-center">
              <div className="w-6 h-6 border-2 border-white border-t-transparent rounded-full animate-spin" />
            </div>
          )}
        </button>

        {/* User Info */}
        <div className="mt-4 text-center">
          <h1 className="text-[20px] font-bold text-label leading-tight">{username}</h1>
          {email && <p className="text-sm text-label-secondary mt-0.5">{email}</p>}
        </div>

        {/* Stats Row — order: Works · Followers · Following (2026-05-08).
            2026-05-11: Followers/Following are now clickable → opens
            FollowListModal so the user can see WHO they follow / who follows
            them, with per-row Unfollow / Follow-back actions. Works stays
            non-clickable (the works themselves are already in the Works tab). */}
        <div className="flex items-center gap-6 mt-5 text-center">
          <div className="flex flex-col">
            <span className="text-[17px] font-bold text-label">{formatCompactNumber(stats.works)}</span>
            <span className="text-[11px] font-medium text-label-tertiary uppercase tracking-wider">Works</span>
          </div>
          <div className="w-px h-8 bg-background-tertiary" />
          <button
            type="button"
            onClick={() => setFollowListMode('followers')}
            className="flex flex-col cursor-pointer hover:opacity-80 transition-opacity"
            aria-label="View followers"
          >
            <span className="text-[17px] font-bold text-label">{formatCompactNumber(stats.followers)}</span>
            <span className="text-[11px] font-medium text-label-tertiary uppercase tracking-wider">Followers</span>
          </button>
          <div className="w-px h-8 bg-background-tertiary" />
          <button
            type="button"
            onClick={() => setFollowListMode('following')}
            className="flex flex-col cursor-pointer hover:opacity-80 transition-opacity"
            aria-label="View following"
          >
            <span className="text-[17px] font-bold text-label">{formatCompactNumber(stats.following)}</span>
            <span className="text-[11px] font-medium text-label-tertiary uppercase tracking-wider">Following</span>
          </button>
        </div>

        {/* 2026-05-08 Leon — Edit Profile button 移除：与右上角 GearSix
         * 齿轮（同样 setActiveSection('settings')）+ desktop Sidebar profile
         * pill 内 "Account Settings" menu 项功能重复。Header 区简化为
         * avatar + name + email + stats，无 redundant CTA。 */}
      </div>

      {/* ── Tabs SegmentedControl ──
       * 2026-05-08 Leon — 用 design-system SegmentedControl 组件（iOS /
       * visionOS 双轨 + light/dark 自动）。无 sticky bg backdrop — 让 segmented
       * control 自身玻璃 pill 直接浮在页面渐变上，避免矩形 backdrop 破坏视觉。 */}
      <div className="sticky top-[40px] z-[40] w-full py-3 flex justify-center pointer-events-none">
        <SegmentedControl
          segments={[
            { value: 'works', label: 'Works' },
            { value: 'liked', label: 'Liked' },
            { value: 'saved', label: 'Saved' },
          ]}
          value={profileTab}
          onChange={setProfileTab}
          className="pointer-events-auto w-full max-w-[420px] mx-4"
        />
      </div>

      {/* ── Following / Followers list modal ──
          Opens when user clicks the Following or Followers stats. Lists
          users with avatars/usernames + per-row Unfollow / Follow-back
          action. Click on row body → navigate to UserProfilePage. */}
      {followListMode && (
        <FollowListModal
          mode={followListMode}
          onClose={() => setFollowListMode(null)}
          onUserClick={(userId) => {
            setFollowListMode(null);
            // /u/:userId is the public read-only profile route — see index.jsx.
            window.location.href = `/u/${userId}`;
          }}
          followingUsers={followingUsers}
          toggleFollow={toggleFollow}
        />
      )}

      {/* ── Content Grid ── */}
      {/* 2026-05-08 Leon — 去掉 bg-background：内容区直接浮在页面渐变上，
          避免 empty state 时显得是个 dark rectangle backdrop。 */}
      <div className="flex-1 pt-4">
        {activeItems.length === 0 ? (
          <div className={`flex flex-col items-center justify-center h-48 text-center ${isSmallScreen ? 'px-4' : ''}`}>
            <p className="text-label text-base font-medium mb-1">
              {profileTab === 'works' ? 'No works yet'
                : profileTab === 'liked' ? 'No liked works'
                : profileTab === 'saved' ? 'No saved works'
                : 'Nothing here'}
            </p>
            <p className="text-label-secondary text-sm">
              {profileTab === 'works' ? 'Capture some magic to see it here.'
                : profileTab === 'liked' ? 'Tap the heart on works to save them here.'
                : profileTab === 'saved' ? 'Bookmark works to revisit them later.'
                : ''}
            </p>
          </div>
        ) : (
          <MasonryGrid
            isSmallScreen={isSmallScreen}
            filteredMediaItems={activeItems}
            activeFilter="#All"
            setActiveFilter={() => {}}
            chips={['#All']}
            title="" /* hidden title */
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
            ownerUserId={profileTab === 'works' ? selfId : null}
            onTogglePublished={async (item, makePublished) => {
              // Optimistic update: flip the flag locally first so the
              // Globe/Lock icon swaps instantly. Revert on error.
              const updater = (list) => list.map(w =>
                w.id === item.id ? { ...w, published: makePublished } : w
              );
              setUserWorks(updater);
              try {
                await togglePublishedStatus(item.id, makePublished);
              } catch (e) {
                // Revert
                const revert = (list) => list.map(w =>
                  w.id === item.id ? { ...w, published: !makePublished } : w
                );
                setUserWorks(revert);
                alert(`Failed to update visibility: ${e.message}`);
              }
            }}
          />
        )}
      </div>
      
    </div>
  );
}
