import { useState, useEffect } from 'react';
import { useIsMobile, useIsTablet, useIsDesktop } from './useMediaQuery';

/**
 * Sidebar 的三种显示模式
 */
export const SIDEBAR_MODE = {
  FULL: 'full',       // 完整模式：240px，显示图标+文字
  MINI: 'mini',       // 迷你模式：72px，仅显示图标
  OVERLAY: 'overlay', // 覆盖模式：240px + 遮罩，移动端使用
};

/**
 * useSidebarState Hook
 * 管理 Sidebar 的三态逻辑 + 手动折叠功能
 *
 * 返回值：
 * - mode: 当前模式 ('full' | 'mini' | 'overlay')
 * - isOpen: Overlay 模式下的打开/关闭状态
 * - isManuallyCollapsed: 用户是否手动折叠（Full <-> Mini）
 * - toggle: 切换状态（Overlay 模式切换开/关，其他模式切换 Full/Mini）
 * - open: 打开 Overlay
 * - close: 关闭 Overlay
 */
export function useSidebarState() {
  const isMobile = useIsMobile();     // < 792px
  const isTablet = useIsTablet();     // 792-1311px
  const isDesktop = useIsDesktop();   // >= 1312px

  // Overlay 模式下的打开/关闭状态
  const [isOpen, setIsOpen] = useState(false);

  // 用户手动折叠状态（在 Desktop 和 Tablet 模式都有效）
  const [isManuallyCollapsed, setIsManuallyCollapsed] = useState(false);

  // 根据屏幕宽度和手动折叠状态决定最终模式
  let mode;
  if (isMobile) {
    mode = SIDEBAR_MODE.OVERLAY;
  } else if (isTablet) {
    // Tablet: 默认 Mini，但允许手动展开为 Full
    mode = isManuallyCollapsed ? SIDEBAR_MODE.FULL : SIDEBAR_MODE.MINI;
  } else {
    // Desktop: 默认 Full，但允许手动折叠为 Mini
    mode = isManuallyCollapsed ? SIDEBAR_MODE.MINI : SIDEBAR_MODE.FULL;
  }

  // 当屏幕尺寸变化时，重置状态
  useEffect(() => {
    // 离开 mobile 模式时，关闭 overlay
    if (!isMobile && isOpen) {
      setIsOpen(false);
    }
    // 进入或离开 mobile 模式时，重置手动折叠状态
    if (isMobile && isManuallyCollapsed) {
      setIsManuallyCollapsed(false);
    }
  }, [isMobile, isOpen, isManuallyCollapsed]);

  // 统一的 toggle 函数
  const toggle = () => {
    if (mode === SIDEBAR_MODE.OVERLAY) {
      // Overlay 模式：切换打开/关闭
      setIsOpen(prev => !prev);
    } else {
      // Full/Mini 模式：切换折叠状态
      setIsManuallyCollapsed(prev => !prev);
    }
  };

  return {
    mode,
    isOpen,
    isManuallyCollapsed,
    toggle,
    open: () => setIsOpen(true),
    close: () => setIsOpen(false),
  };
}

/**
 * Sidebar 样式配置（Tailwind classes）
 */
export const getSidebarStyles = (mode, isOpen) => {
  // Pill 形状：增加上下边距，全方向圆角，添加阴影
  const baseStyles = 'fixed left-4 top-[88px] bottom-[88px] bg-white/80 backdrop-blur-xl border border-white/20 shadow-xl shadow-black/5 transition-all duration-500 ease-in-out z-[60] flex flex-col';

  const widthStyles = {
    [SIDEBAR_MODE.FULL]: 'w-60',      // 240px
    [SIDEBAR_MODE.MINI]: 'w-16',      // 64px - 标准 Tailwind 值
    [SIDEBAR_MODE.OVERLAY]: 'w-60',   // 240px
  };

  // 统一圆角：所有模式使用相同圆角，切换更平滑
  const borderRadiusStyles = {
    [SIDEBAR_MODE.FULL]: 'rounded-[32px]',    // 32px - 64px / 2 = 32px 完美 pill
    [SIDEBAR_MODE.MINI]: 'rounded-[32px]',    // 64px / 2 = 32px - 完美 pill
    [SIDEBAR_MODE.OVERLAY]: 'rounded-[32px]', // 32px - 与 Full/Mini 统一
  };

  const visibilityStyles =
    mode === SIDEBAR_MODE.OVERLAY
      ? (isOpen ? 'translate-x-0' : '-translate-x-[calc(100%+16px)]')
      : 'translate-x-0';

  return `${baseStyles} ${widthStyles[mode]} ${borderRadiusStyles[mode]} ${visibilityStyles}`;
};

/**
 * 获取 Main 内容区的 padding-left（适应 Sidebar 宽度）
 */
export const getMainPaddingLeft = (mode) => {
  return {
    [SIDEBAR_MODE.FULL]: 'pl-20',     // 80px — pill floats, default collapsed 66px + left-4
    [SIDEBAR_MODE.MINI]: 'pl-20',     // 80px — same as FULL, both pills default to 66px
    [SIDEBAR_MODE.OVERLAY]: 'pl-0',   // 0px（overlay 不占空间）
  }[mode];
};
