import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { SquaresFour, CardsThree, PlusCircle, UserCircle, Wallet, GearSix, Question, SignOut, CaretRight, FileText } from '@phosphor-icons/react';
import { SIDEBAR_MODE } from '../../hooks/useSidebarState';
import { supabase } from '../../api/supabaseClient';

/* Figma Separators/Separator (node 139:23903) — visionOS two-layer blend divider.
 * Layer 1: white 7% lighten · Layer 2: #5E5E5E 15% color-dodge.
 * mx prop controls horizontal inset (default 20px to match pill padding). */
function Separator({ mx = 20 }) {
  return (
    <div className="relative h-px overflow-hidden my-1" style={{ marginLeft: mx, marginRight: mx }}>
      <div className="absolute inset-0 bg-white/7 mix-blend-lighten" />
      <div className="absolute inset-0 bg-[rgba(94,94,94,0.15)] mix-blend-color-dodge" />
    </div>
  );
}

/* New IA (2026-04-17) — functional navigation (3 items)
 * Per docs/longvv-IA-v2.md §2 and sidebar-refactor-for-claudecode_4.17.md §1 */
const navItems = [
  { id: 'discover', icon: SquaresFour, label: 'Discover', activeText: 'text-label'  },
  { id: 'library', icon: CardsThree,  label: 'Library', activeText: 'text-label'  },
  { id: 'create',  icon: PlusCircle,  label: 'Create',  activeText: 'text-label'  },
];

/* Profile Popover menu — Sign Out is rendered separately as a pill at bottom-right
 * 2026-05-07 Leon — 移除 'Preferences' 项。计划：Preferences 内容由 Session 3
 * 并入 Account Settings 页面右栏（Account Settings 内容改 2 列布局）。
 * 这里去掉避免菜单项过多导致 expanded pill 过高。 */
/* 2026-05-07 Leon — Help 移到 bottom row 与 Sign Out 平行（小按钮，
 * pill 底部左右成对）。Divider 同时移除（剩 3 主菜单项，不需分组）。*/
const userMenuItems = [
  { Icon: Wallet,     label: 'Wallet', id: 'wallet'      },
  { Icon: GearSix,    label: 'Account', id: 'settings'    },
  // 'Terms & Legal' removed (2026-05-12): merged into Help Center as link list at bottom.
];

/* Pill base — concentric nested corners with inner button rounded-full.
 * Uses `glass-regular` (default, more opaque) instead of `glass-clear`
 * so the glass provides consistent contrast for theme-aware text colors
 * regardless of whether the background behind is dark or light.
 * 2026-05-08 Leon — 圆角 concentric 公式：outer_r = inner_r + gap
 *   inner button rounded-full @ 44×44 → r=22; padding p-2 → gap=8
 *   → outer_r = 22 + 8 = 30 (was 34, 比理论值多 4px → 不同心)
 *   left-3 → left-4 (12→16px) 让 60-wide pill 中线在 X=46，与原 68@left-3
 *   中线对齐保持不变。 */
const PILL = 'fixed left-4 z-[60] glass-regular rounded-[30px] transition-all duration-500 ease-in-out';

/*
 * visionOS glass overlay for tab buttons (selected / hover).
 * Light mode: subtle darkening (black 4%)
 * Dark mode:  white 7% + gray 18% color-dodge (Figma spec)
 */
function GlassOverlay({ visible }) {
  return (
    <div aria-hidden="true" className="absolute inset-0 pointer-events-none rounded-full">
      {/* Base glass — visible when active or on hover */}
      <div className={`absolute inset-0 rounded-full transition-opacity duration-200 ${
        visible ? 'opacity-100' : 'opacity-0 group-hover/btn:opacity-100'
      }`}>
        {/* Light mode — subtle darkening */}
        <div className="absolute bg-black/4 dark:bg-transparent inset-0 rounded-full" />
        {/* Dark mode — visionOS specular highlight */}
        <div className="absolute bg-transparent dark:bg-white/7 inset-0 rounded-full" />
        <div className="absolute bg-transparent dark:bg-[rgba(94,94,94,0.18)] inset-0 dark:mix-blend-color-dodge rounded-full" />
      </div>

      {/* Hover glow — visionOS radial gradient from bottom center, Figma spec */}
      <div className="absolute inset-0 rounded-full opacity-0 group-hover/btn:opacity-100 transition-opacity duration-200 overflow-hidden">
        {/* Radial 1: FFFFFF 6% → 0%, ellipse 100%×50% at bottom center */}
        <div className="absolute inset-0 rounded-full"
          style={{ background: 'radial-gradient(ellipse 100% 50% at 50% 100%, rgba(255,255,255,0.06) 0%, transparent 100%)' }} />
        {/* Radial 2: 5E5E5E 16% → 0%, same shape, color-dodge */}
        <div className="absolute inset-0 rounded-full mix-blend-color-dodge"
          style={{ background: 'radial-gradient(ellipse 100% 50% at 50% 100%, rgba(94,94,94,0.16) 0%, transparent 100%)' }} />
      </div>
    </div>
  );
}

export default function Sidebar({ sidebar, activeSection, setActiveSection, overDarkBg = false }) {
  /* Profile pill — pure hover-driven expand (matches nav pill pattern above).
   * Earlier click-to-expand state caused a layout bug: hover ended → pill
   * width collapsed to 68px via CSS, but content stayed expanded because
   * userMenuExpanded was still true → menu text squished on top of avatar.
   * Pure hover keeps width + content in lockstep.                           */
  const [bouncingId, setBouncingId] = useState(null);
  const navigate = useNavigate();

  /* 2026-05-08 Leon — Sidebar nav 点击 dispatch 'sidebar-nav-reset' event +
   * navigate state freshNav，让 section page 内部 sub-flow state (如
   * StoryGeneratorPage creationLevel='series'/'quick') 能 reset 回 landing。
   *
   * Bug fix: Create 频道在 'Create a Series' / 'Quick Create' 子流程下点
   * sidebar Create 不触发 setActiveSection state change（已在 'create'），
   * StoryGeneratorPage internal creationLevel 不重置 → 卡在子流程。 */
  const handleNavClick = (id) => {
    setActiveSection(id);
    setBouncingId(id);
    /* 任意 nav click → fire freshNav signal。即使 activeSection 没变，
     * 让 section page useEffect 监听 location.state.freshNav reset sub-state。 */
    const targetPath = id === 'create' ? '/create'
                     : id === 'library' ? '/library'
                     : id === 'discover' ? '/discover'
                     : `/${id}`;
    navigate(targetPath, { state: { freshNav: Date.now() } });
  };

  const isOverlay = sidebar.mode === SIDEBAR_MODE.OVERLAY;

  /* Adaptive inactive text: when over dark bg in light mode, use light text */
  const inactiveText = overDarkBg
    ? 'text-white/50 hover:text-white/80'
    : 'text-label-secondary hover:text-label';

  /* Slide-in/out for overlay mode (mobile + desktop forced overlay e.g. /create).
   * Inline style 而非 Tailwind className — 因为 v4 对
   * `-translate-x-[calc(100%+12px)]` 的 arbitrary value 解析不稳，computed
   * transform 会变成 "none"，导致 collapse 失败露 4px 在屏幕左边缘。
   * 仅导出 X 偏移，让 nav pill / profile pill 各自合成 Y（前者 -50% 居中，
   * 后者 bottom-4 不需 Y）。 */
  const slideX = isOverlay && !sidebar.isOpen
    ? 'calc(-100% - 24px)'  // 完全藏到屏幕左边外（额外 -12px buffer）
    : '0';

  const [sessionUser, setSessionUser] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);

  useEffect(() => {
    /* 2026-05-08 Leon — getUser() (network 4-8s) → getSession() (localStorage,
     * sync). 修复甲方反馈：刷 /subscription 时 sidebar 显示 'User/@guest/0'
     * 占位 → paid user 付完跳回看到 @guest 怀疑被骗。Session 已含 user
     * metadata (avatar/email/credits/tier)，立即可用无 network roundtrip。 */
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSessionUser(session?.user || null);
      setAuthLoading(false);
    });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_e, session) => {
      setSessionUser(session?.user || null);
      setAuthLoading(false);
    });
    return () => subscription?.unsubscribe();
  }, []);

  /* authLoading 期间 (~50ms) 不显示 'User/@guest' 占位，用   (non-breaking
   * space) 占位维持 layout，避免 paid user 付费回跳看到 guest 怀疑被骗。 */
  const displayName = authLoading
    ? ' '
    : (sessionUser?.user_metadata?.username || sessionUser?.email?.split('@')[0] || 'Sign in');
  const displayEmail = authLoading
    ? ' '
    : (sessionUser?.email || 'Not signed in');
  // 2026-05-07 Leon — Profile pill avatar 真实化。当前用户 metadata 已含
  // avatar 字段；OAuth (Google) 走 avatar_url/picture，本地用户走
  // profile_picture_url (base64)。null 时 fallback 到 UserCircle icon。
  const avatarUrl =
    sessionUser?.user_metadata?.avatar_url ||
    sessionUser?.user_metadata?.picture ||
    sessionUser?.user_metadata?.profile_picture_url ||
    null;

  return (
    <>
      {/* Overlay backdrop (mobile) */}
      {isOverlay && sidebar.isOpen && (
        <div
          className="fixed inset-0 bg-black/50 z-40 transition-opacity duration-300"
          onClick={sidebar.close}
          aria-label="Close sidebar"
        />
      )}

      {/* ── Nav pill — Collapsed 60px, Expanded on hover ─────────── */}
      {/* 2026-05-08 Leon — 统一 nav / profile pill 规格：
       *   outer 60px = p-2 (8px) + 44px content + p-2 (8px)
       *   icon zone 44 (button h-11 w-full) — 两 pill content 距 outer 8px 一致 */}
      <aside
        className={`${PILL} group top-1/2 w-[60px] hover:w-[158px]`}
        style={{ transform: `translate(${slideX}, -50%)` }}
      >
        <nav className="flex flex-col gap-3 p-2">
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive = activeSection === item.id;

            return (
              <button
                key={item.id}
                onClick={() => handleNavClick(item.id)}
                onMouseEnter={() => setBouncingId(item.id)}
                className={`group/btn relative flex items-center transition-all duration-500 overflow-hidden cursor-pointer h-11 w-full rounded-full ${
                  isActive ? item.activeText : inactiveText
                }`}
              >
                <GlassOverlay visible={isActive} />

                {/* Icon zone — 44×44px */}
                <span
                  className={`absolute left-0 top-0 bottom-0 w-11 flex items-center justify-center flex-shrink-0 [&>svg]:block ${bouncingId === item.id ? 'animate-nav-spring' : ''}`}
                  style={bouncingId !== item.id ? { transform: isActive ? 'scale(1.1)' : 'scale(1)', transition: 'transform 0.3s ease' } : {}}
                  onAnimationEnd={() => setBouncingId(null)}
                >
                  <Icon
                    size={20}
                    weight={isActive ? 'fill' : 'regular'}
                    className="transition-colors duration-300"
                  />
                </span>

                {/* Label — text-[19px] per Figma.
                 * 2026-05-08 Leon — pr-7 (28) → pr-3 (12) 让 label 距 pill 右
                 * 边缘 = p-2 (8) + pr-3 (12) = 20px，与 icon 距 pill 左边缘
                 * (p-2 8 + icon-center-buffer 12 = 20) 对称。 */}
                <span className="font-medium text-[19px] leading-6 whitespace-nowrap overflow-hidden text-ellipsis pl-11 pr-3 opacity-0 group-hover:opacity-100 transition-opacity duration-200 delay-150">
                  {item.label}
                </span>
              </button>
            );
          })}
        </nav>
      </aside>

      {/* ── Profile pill — collapsed 60px, expands to 280px on hover.
       * 2026-05-08 Leon — PILL 基类已统一 left-4 (16px) 让 60-wide pill 中线
       * 在 X=46，profile 不再需要 inline left: 16 override。 */}
      <div
        className={`${PILL} group bottom-4 overflow-hidden w-[60px] hover:w-[198px]`}
        style={{ transform: `translateX(${slideX})` }}
      >

        {/* Expandable user info + menu — opens/closes with pill hover.
         * 2026-05-08 Leon — wrapper px-3 → px-2 满足 R-007 concentric:
         *   pill rounded 30 = inner button rounded-full (22 @ h-11) + 8 gap
         *   px-2 = 8 gap ✓
         * 同步 avatar / menu icon center 从 X=51 → X=46（与 collapsed 中线一致）。
         * pt-3 → pt-2: avatar 顶部 padding 与左侧对称（avatar top 距 pill top
         *   = 8 + 2 = 10 ≈ avatar 距 pill 左 10）。 */}
        <div className="transition-all duration-300 ease-in-out overflow-hidden max-h-0 opacity-0 group-hover:max-h-[520px] group-hover:opacity-100">
          {/* ── User identity block ── */}
          <div className="pt-2 px-2">
            {/* Avatar + name row — 2026-05-07 Leon: wrap into clickable
             * button → 自己的 profile / 账号设置（SelfProfilePage，
             * activeSection === 'profile'）。
             * 区别：/u/:userId 是第三方查看的 UserProfilePage，自己的设置页
             * 走 internal section state 而非 URL（与 mobile BottomTabBar
             * Profile tab 同 navigation pattern）。
             * Hover: avatar opacity + name underline。 */}
            {/* 2026-05-08 Leon — avatar 中心与 menu icon 中心对齐 + 视觉 breathing：
             *   外层 wrapper-px-3 (12) 后是 44-wide content slot（与下方 menu icon
             *   zone 同尺寸），slot 内 avatar 40 居中 → 2px breathing 每边
             *   slot center X = pill_left + 12 + 44/2 = pill_left + 34
             *   avatar center 也在 X = slot_center ✓ 与 menu icon center 对齐 */}
            <button
              type="button"
              onClick={() => setActiveSection('profile')}
              className="flex items-center gap-3 pr-2 w-full text-left cursor-pointer group"
              aria-label="My profile and account settings"
            >
              {/* 44-wide avatar slot (= menu icon zone width)，inside avatar 40 centered */}
              <span className="w-11 h-11 flex items-center justify-center flex-shrink-0">
                {avatarUrl ? (
                  <img
                    src={avatarUrl}
                    alt={displayName}
                    className="w-10 h-10 rounded-full object-cover bg-white/6 group-hover:opacity-80 transition-opacity"
                    referrerPolicy="no-referrer"
                    onError={(e) => { e.currentTarget.style.display = 'none'; }}
                  />
                ) : (
                  <div className="w-10 h-10 rounded-full bg-gradient-to-br from-indigo-400 to-purple-500 flex items-center justify-center group-hover:opacity-80 transition-opacity">
                    <UserCircle size={22} weight="fill" className="text-white" />
                  </div>
                )}
              </span>
              {/* 2026-05-08 Leon — 去掉 email 显示 + 去掉 name 下划线。
               * Name 跟随 flex-1 容器宽度自动 truncate ellipsis（受 pill width
               * 限制；当前 pill 222 → name container 142）。 */}
              <div className="min-w-0 flex-1">
                <p className="text-[15px] font-semibold text-label whitespace-nowrap overflow-hidden text-ellipsis">
                  {displayName}
                </p>
              </div>
            </button>

            {/* 2026-05-07 Leon — Token + Plan row 已迁到 header 段化 pill
             * (NavigationBar.jsx)，profile pill 不再重复展示。 */}
          </div>

          {/* ── Menu items ── */}
          <div className="pt-1 flex flex-col gap-0 px-2">
            {userMenuItems.map((mi, idx) => {
              if (mi.type === 'divider') {
                return <Separator key={`div-${idx}`} mx={8} />;
              }
              const { Icon, label, id } = mi;
              const isActive = id && activeSection === id;
              return (
                <button
                  key={label}
                  onClick={() => { if (id) setActiveSection(id); }}
                  className={`group/btn relative flex items-center rounded-full transition-all duration-300 overflow-hidden cursor-pointer h-11 w-full ${
                    isActive ? 'text-accent' : inactiveText
                  }`}
                >
                  <GlassOverlay visible={isActive} />
                  <span className="absolute left-0 top-0 bottom-0 w-11 flex items-center justify-center">
                    <Icon className={`w-5 h-5 transition-all duration-300 ${isActive ? 'scale-110' : ''}`} />
                  </span>
                  {/* 2026-05-08 Leon — pr-4 → pr-3 让 label 距 pill 右
                   * = wrapper px-2 (8) + pr-3 (12) = 20，与 icon 距 pill 左
                   * (wrapper 8 + icon-zone-buffer 12 = 20) 对称 */}
                  <span className="font-medium text-[15px] leading-5 pl-11 pr-3 whitespace-nowrap overflow-hidden text-ellipsis">
                    {label}
                  </span>
                </button>
              );
            })}

          </div>

          {/* Bottom row — Help (left) + Sign Out (right) 平行
           * (2026-05-07 Leon: Help 从 menu 移下来与 Sign Out 成对)。
           * 两者同 secondary style：transparent bg, hover fill。
           * 2026-05-08 Leon — wrapper px-3 → px-2 满足 R-007 concentric。
           * pt-[6px] → pt-2, pb-3 → pb-2: 上/下 padding = 左/右 padding = 8
           *   让 button outline 距 pill 底 与 距 pill 右 对称 (与 avatar 顶部
           *   padding 修复同理)。 */}
          <Separator mx={20} />
          <div className="px-2 pb-2 pt-2 flex justify-between items-center">
            <button
              onClick={() => setActiveSection('help')}
              className="flex items-center gap-[7px] px-3 py-[7px] cursor-pointer"
              style={{
                background: 'transparent',
                border: '1px solid transparent',
                borderRadius: '22px',
                transition: 'background 0.2s ease, border-color 0.2s ease',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = 'var(--color-fill)';
                e.currentTarget.style.borderColor = 'var(--color-separator)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = 'transparent';
                e.currentTarget.style.borderColor = 'transparent';
              }}
            >
              <Question size={15} className="text-label-secondary" />
              <span className="text-[13px] font-medium text-label-secondary whitespace-nowrap">Help</span>
            </button>
            <button
              onClick={() => setActiveSection('logout')}
              className="flex items-center gap-[7px] px-3 py-[7px] cursor-pointer"
              style={{
                background: 'transparent',
                border: '1px solid transparent',
                borderRadius: '22px',
                transition: 'background 0.2s ease, border-color 0.2s ease',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = 'var(--color-fill)';
                e.currentTarget.style.borderColor = 'var(--color-separator)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = 'transparent';
                e.currentTarget.style.borderColor = 'transparent';
              }}
            >
              {/* 2026-05-08 Leon — Sign Out 用 destructive 色（Apple HIG 标准）：
               *   --color-destructive 自动 light/dark 切换（systemRed）
               *   light: #ef4444 / dark: #ff453a
               *   红色对比强，无论 backdrop（hero / video / 实色）都清晰可读。 */}
              <SignOut size={15} style={{ color: 'var(--color-destructive)' }} />
              <span
                className="text-[13px] font-medium whitespace-nowrap"
                style={{ color: 'var(--color-destructive)' }}
              >
                Sign Out
              </span>
            </button>
          </div>
        </div>

        {/* Profile avatar — collapsed-only anchor.
         * Collapses to zero height when the pill is expanded so Sign Out
         * sits flush at the pill's bottom edge with no dead space.
         * 2026-05-08 Leon — pill 60 + p-2 (8) → content area 44×44；avatar 自身
         * 收回 w-10 h-10 (40) 让头像有 2px breathing 在 content area 内居中
         * （视觉上不贴 pill 边）。 */}
        <div className="overflow-hidden transition-all duration-300 ease-in-out max-h-[60px] group-hover:max-h-0">
          <div className="p-2 flex justify-center">
            {avatarUrl ? (
              <img
                src={avatarUrl}
                alt={displayName}
                className="w-10 h-10 rounded-full object-cover bg-white/6"
                referrerPolicy="no-referrer"
                onError={(e) => { e.currentTarget.style.display = 'none'; }}
              />
            ) : (
              <div className="w-10 h-10 flex items-center justify-center">
                <UserCircle size={24} weight="regular" className="text-indigo-600" />
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
