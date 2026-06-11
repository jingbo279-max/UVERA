import React from 'react';
import { useNavigate } from 'react-router-dom';
import { CaretLeft } from '@phosphor-icons/react';

/**
 * BackButton — 全站统一返回按钮。
 *
 * 视觉:CaretLeft + 文案(默认 "Back"),沿用全站 back 统一图标 CaretLeft
 * (见 NavigationBar 注释「全站 back 按钮统一 CaretLeft」)。
 *
 * 行为:默认返回浏览器历史上一页(navigate(-1))。仅当确无可回退历史
 * (window.history.length <= 1,即直接输 URL / 新标签页首屏)时才回退到
 * fallback(默认 /discover),避免 navigate(-1) 空转把用户留在原地。
 *
 * ⚠️ 用 window.history.length 而非 location.key:/wallet → /subscription?tab=ucoins
 * 等走 window.location.replace 的整页重载会把 react-router 的 location.key 重置成
 * 'default',误判"无历史" → 旧实现一律回 discover(2026-06-05 甲方实测 bug)。
 * window.history.length 反映真实浏览器历史深度,能跨整页重载/redirect 存活。
 *
 * Props:
 *   label    — 按钮文案(默认 "Back")
 *   fallback — 无历史时的兜底路由(默认 "/discover")
 *   onClick  — 显式覆盖默认导航行为(传了就只跑它)
 *   className/style — 透传到 <button>
 */
export default function BackButton({ label = 'Back', fallback = '/discover', onClick, className = '', style }) {
  const navigate = useNavigate();

  const handleClick = () => {
    if (onClick) { onClick(); return; }
    if (typeof window !== 'undefined' && window.history.length > 1) navigate(-1);
    else navigate(fallback);
  };

  return (
    <button
      type="button"
      onClick={handleClick}
      aria-label={label}
      className={`flex items-center gap-1.5 text-sm text-label-secondary hover:text-label transition-colors cursor-pointer ${className}`}
      style={style}
    >
      <CaretLeft size={18} weight="bold" />
      <span>{label}</span>
    </button>
  );
}
