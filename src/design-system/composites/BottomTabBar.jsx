import React from 'react';
import {
  House,
  CardsThree,
  PlusCircle,
  UserCircle,
} from '@phosphor-icons/react';

/* ── Tab definitions — 2026-04-25 调整：
 *   Left pill = [Discover, Library, Profile]：浏览 + 个人入口归组
 *   Right pill = Create 独立按钮：创作 CTA 独立 pill 给最高视觉权重（对标 TikTok/IG + 号）
 * icon 语义：
 *   House = Discover（immerse home）；PlusCircle = Create（原 MagicWand 小白识别困难）；
 *   UserCircle = Profile。*/
const TAB_ITEMS = [
  { id: 'discover', icon: House,       label: 'Discover' },
  { id: 'library',  icon: CardsThree,  label: 'Library'  },
  { id: 'profile',  icon: UserCircle,  label: 'Profile'  },
];

/* Active color: indigo-600 (project brand), inactive: adaptive label color */
const ACTIVE_COLOR   = 'rgb(99, 102, 241)';
const ACTIVE_BG      = 'rgba(99, 102, 241, 0.13)';
const INACTIVE_COLOR = 'var(--color-label-secondary)';

/* ── BottomTabBar ─────────────────────────────────────────────────────────
 * Mobile-only floating bottom navigation (方案B — 2026-04-25 重构)
 *
 * Layout:
 *   Left  pill  — hug-content glass 胶囊容器，内含 3 圆形 tab 按钮 [Discover, Library, Profile]
 *   Right pill  — Create CTA 独立圆按钮（PlusCircle，indigo 持续高亮）
 * 左右 pill 分列屏幕两端（justify-between），中间露出视频沉浸内容。
 *
 * Props:
 *   activeTab    — one of TAB_ITEMS ids or 'create'
 *   onTabChange  — (id: string) => void
 * Touch target ≥ 46×46，超 44px HIG 下限。Safe area 通过 paddingBottom 注入。
 * ─────────────────────────────────────────────────────────────────────── */
const OUTER_SIZE = 54;   // Create 独立圆 & 左 pill 高度对齐
const INNER_SIZE = 46;   // 左 pill 内每个 tab 圆按钮直径（capsule 4px 内距两边 + 46 = 54）

export default function BottomTabBar({ activeTab, onTabChange }) {
  return (
    <nav
      aria-label="Main navigation"
      className="fixed left-0 right-0 z-[60] flex items-center justify-between px-3 pt-[10px]"
      style={{ bottom: 0, paddingBottom: 'max(env(safe-area-inset-bottom, 0px), 10px)' }}
    >
      {/* ── Left pill: 胶囊容器 + 3 圆形 tab 按钮 ──────────────────── */}
      <div
        className="glass-nav-pill rounded-full flex items-center"
        style={{ padding: 4, gap: 4, height: OUTER_SIZE }}
      >
        {TAB_ITEMS.map(({ id, icon: Icon, label }) => {
          const isActive = activeTab === id;
          return (
            <button
              key={id}
              type="button"
              onClick={() => onTabChange(id)}
              aria-label={label}
              aria-current={isActive ? 'page' : undefined}
              className="relative rounded-full flex items-center justify-center flex-shrink-0 cursor-pointer select-none transition-opacity duration-150 active:opacity-70"
              style={{ width: INNER_SIZE, height: INNER_SIZE, background: isActive ? ACTIVE_BG : 'transparent' }}
            >
              <span
                className="relative z-10 flex items-center justify-center transition-transform duration-200"
                style={{ transform: isActive ? 'scale(1.08)' : 'scale(1)' }}
              >
                <Icon
                  size={22}
                  weight={isActive ? 'fill' : 'regular'}
                  style={{ color: isActive ? ACTIVE_COLOR : INACTIVE_COLOR }}
                />
              </span>
            </button>
          );
        })}
      </div>

      {/* ── Right: Create CTA 独立圆按钮 ──────────────────────────
       * 独立圆给 Create 最高视觉权重（对标 TikTok 中部 + 号 / IG Reels post）。
       * inactive 也是 indigo outline，active 变 fill，恒现"创作"召唤。 */}
      <button
        type="button"
        onClick={() => onTabChange('create')}
        aria-label="Create"
        aria-current={activeTab === 'create' ? 'page' : undefined}
        className="glass-nav-pill rounded-full flex items-center justify-center flex-shrink-0 cursor-pointer select-none transition-opacity duration-150 active:opacity-70"
        style={{ width: OUTER_SIZE, height: OUTER_SIZE }}
      >
        <PlusCircle
          size={26}
          weight={activeTab === 'create' ? 'fill' : 'regular'}
          style={{ color: ACTIVE_COLOR }}
        />
      </button>
    </nav>
  );
}
