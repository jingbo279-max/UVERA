import { useState, useEffect } from 'react';

/**
 * useMediaQuery Hook
 * 用于检测当前窗口是否匹配指定的媒体查询
 *
 * @param {string} query - CSS 媒体查询字符串
 * @returns {boolean} - 是否匹配
 *
 * 使用示例：
 * const isMobile = useMediaQuery('(max-width: 791px)');
 * const isDesktop = useMediaQuery('(min-width: 1312px)');
 */
export function useMediaQuery(query) {
  // 用 lazy initializer 直接读取当前状态，避免首帧闪烁
  const [matches, setMatches] = useState(() =>
    typeof window !== 'undefined' ? window.matchMedia(query).matches : false
  );

  useEffect(() => {
    // 创建 MediaQueryList 对象
    const media = window.matchMedia(query);

    // 同步初始值（query 变化时）
    if (media.matches !== matches) {
      setMatches(media.matches);
    }

    // 监听变化
    const listener = (e) => setMatches(e.matches);

    // 使用现代 API（兼容旧版浏览器）
    if (media.addEventListener) {
      media.addEventListener('change', listener);
    } else {
      media.addListener(listener); // 旧版 Safari
    }

    // 清理函数
    return () => {
      if (media.removeEventListener) {
        media.removeEventListener('change', listener);
      } else {
        media.removeListener(listener);
      }
    };
  }, [matches, query]);

  return matches;
}

/**
 * 预定义的断点常量（参考 YouTube + Tailwind）
 */
export const BREAKPOINTS = {
  mobile: 640,      // Tailwind sm
  tablet: 792,      // YouTube mini sidebar 起点
  desktop: 1312,    // YouTube full sidebar 起点
  wide: 1536,       // Tailwind 2xl
};

/**
 * 便捷 Hooks（基于 BREAKPOINTS）
 */
export function useIsMobile() {
  return useMediaQuery(`(max-width: ${BREAKPOINTS.tablet - 1}px)`);
}

export function useIsTablet() {
  return useMediaQuery(
    `(min-width: ${BREAKPOINTS.tablet}px) and (max-width: ${BREAKPOINTS.desktop - 1}px)`
  );
}

export function useIsDesktop() {
  return useMediaQuery(`(min-width: ${BREAKPOINTS.desktop}px)`);
}
