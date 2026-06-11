import React, { useEffect, useRef, useState } from 'react';
import { Sparkle, Play } from '@phosphor-icons/react';

/**
 * Hero AR 视觉实测页（/test/hero-ar）
 * ------------------------------------------------------------------
 * 目的：让 Leon 在真实 viewport 下直接对比 4 种 hero 规格的视觉效果，
 *      决定是否把当前固定 280/320 的 Hero 改成 AR 驱动的瀑布流卡。
 *
 * 设计决策（2026-04-21 讨论）：
 *   - 同一条内容（hero-bg.mp4 + 同一文案 + 同一 CTA）渲染 4 次
 *   - 唯一变量是**容器几何**：固定高 vs 16:9 vs 4:3 vs 21:9
 *   - 每块正下方标注当前视口下的 px 尺寸，方便 mobile/desktop 互切对比
 *
 * ⚠️  此页为 dev-only 测试工具，不进导航，仅 /test/hero-ar 直达。
 *     决策确定后此文件会被删除或归档。
 */

const HERO_VIDEO  = '/videos/hero-bg.mp4';
const HERO_POSTER = '/videos/hero-bg-poster.jpg';

/* 4 种规格 —— 唯一变量是 height 策略 */
const VARIANTS = [
  {
    id: 'current',
    label: 'Current · 固定高度',
    description: 'mobile 280px / desktop 320px，与 video AR 解耦，object-fit: cover 裁切。当前线上 Hero 的规格。',
    mode: 'fixed',
    mobileHeight: 280,
    desktopHeight: 320,
  },
  {
    id: '16x9',
    label: '16:9 · AR 驱动（推荐候选）',
    description: 'height = width × 9/16。视觉张力够，不至于太高。',
    mode: 'ar',
    ar: 16 / 9,
  },
  {
    id: '4x3',
    label: '4:3 · AR 驱动',
    description: 'height = width × 3/4。撑开更多视觉空间，desktop 会占屏大半。',
    mode: 'ar',
    ar: 4 / 3,
  },
  {
    id: '21x9',
    label: '21:9 · AR 驱动（超宽电影感，需新增）',
    description: 'height = width × 9/21。最扁最窄，接近电影横幅。现有 AR 枚举里没有这档。',
    mode: 'ar',
    ar: 21 / 9,
  },
];

/* ── HeroCard —— 渲染单个 hero 变体 ───────────────────────────────────── */
function HeroCard({ height, isSmallScreen }) {
  const [videoError, setVideoError] = useState(false);
  return (
    <section
      className="relative overflow-hidden rounded-3xl"
      style={{
        height,
        background: 'var(--gradient-hero-explore)',
      }}
    >
      {!videoError && (
        <video
          autoPlay loop muted playsInline
          poster={HERO_POSTER}
          onError={() => setVideoError(true)}
          className="absolute inset-0 w-full h-full object-cover"
          style={{ objectPosition: 'center 30%' }}
          src={HERO_VIDEO}
          aria-hidden
        />
      )}
      <div
        aria-hidden
        className="absolute inset-0"
        style={{
          background:
            'linear-gradient(180deg, rgba(0,0,0,0.15) 0%, rgba(0,0,0,0.35) 100%)',
        }}
      />
      <div
        className="relative h-full flex flex-col items-center justify-center text-center"
        style={{ padding: isSmallScreen ? '20px 16px' : '40px 48px' }}
      >
        <div className="max-w-xl mx-auto">
          <p
            className="uppercase mb-2"
            style={{
              fontSize: '11px',
              fontWeight: 600,
              letterSpacing: '0.2em',
              color: 'rgba(255,255,255,0.75)',
            }}
          >
            AI-native worldbuilding
          </p>
          <h1
            className="font-semibold leading-[1.05] mb-2"
            style={{
              fontSize: isSmallScreen ? '1.75rem' : '2.5rem',
              letterSpacing: '-0.02em',
              color: '#fff',
              textShadow: '0 2px 16px rgba(0,0,0,0.35)',
            }}
          >
            Parallel Worlds, Second Life
          </h1>
          <p
            className="mb-4"
            style={{
              fontSize: isSmallScreen ? '0.8125rem' : '0.9375rem',
              lineHeight: 1.45,
              color: 'rgba(255,255,255,0.85)',
              textShadow: '0 1px 8px rgba(0,0,0,0.3)',
            }}
          >
            New worlds. New stories. New selves — crafted by AI, lived by you.
          </p>
          <div className="flex flex-nowrap gap-2 justify-center">
            <button
              type="button"
              className="flex items-center gap-2 rounded-full cursor-pointer whitespace-nowrap shrink-0"
              style={{
                padding: isSmallScreen ? '9px 14px' : '10px 18px',
                fontSize: isSmallScreen ? '13px' : '14px',
                fontWeight: 600,
                color: '#fff',
                background:
                  'linear-gradient(135deg, var(--color-raw-violet-600) 0%, #9333ea 100%)',
                boxShadow: '0 6px 20px rgba(124, 58, 237, 0.28)',
                border: '1px solid rgba(255,255,255,0.12)',
              }}
            >
              <Sparkle size={14} weight="fill" />
              Explore Spark
            </button>
            <button
              type="button"
              className="glass-prominent flex items-center gap-2 rounded-full cursor-pointer whitespace-nowrap shrink-0"
              style={{
                padding: isSmallScreen ? '9px 14px' : '10px 18px',
                fontSize: isSmallScreen ? '13px' : '14px',
                fontWeight: 600,
                color: '#fff',
              }}
            >
              <Play size={14} weight="fill" />
              Start Creating
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}

/* ── HeroARTestPage ─────────────────────────────────────────────────── */
export default function HeroARTestPage() {
  /* 视口宽度追踪，用于实时显示 card 当前实际 px 高度 */
  const [vw, setVw] = useState(typeof window === 'undefined' ? 1440 : window.innerWidth);
  const containerRef = useRef(null);
  const [containerWidth, setContainerWidth] = useState(0);

  useEffect(() => {
    const handle = () => setVw(window.innerWidth);
    window.addEventListener('resize', handle);
    return () => window.removeEventListener('resize', handle);
  }, []);

  useEffect(() => {
    if (!containerRef.current) return;
    const ro = new ResizeObserver(entries => {
      setContainerWidth(Math.round(entries[0].contentRect.width));
    });
    ro.observe(containerRef.current);
    return () => ro.disconnect();
  }, []);

  const isSmallScreen = vw < 792;

  /* 根据变体配置计算当前 viewport 下的实际高度 */
  function computeHeight(v) {
    if (v.mode === 'fixed') {
      return isSmallScreen ? v.mobileHeight : v.desktopHeight;
    }
    return containerWidth > 0 ? Math.round(containerWidth / v.ar) : 0;
  }

  return (
    <div className="min-h-screen bg-zinc-950 text-white" style={{ paddingTop: 24, paddingBottom: 80 }}>
      {/* 顶部说明 */}
      <header
        style={{
          padding: isSmallScreen ? '16px 16px 24px' : '24px 64px 32px',
          maxWidth: 1400,
          margin: '0 auto',
        }}
      >
        <p className="text-xs uppercase tracking-widest text-violet-400 mb-2">Dev test · /test/hero-ar</p>
        <h1 className="text-2xl md:text-3xl font-semibold mb-3">Hero AR 视觉实测</h1>
        <p className="text-sm text-zinc-400 leading-relaxed max-w-2xl">
          同一条内容（hero-bg.mp4 + 同一文案 + 同一 CTA）用 4 种几何规格渲染，
          用来决定 Hero 是否改造成 AR 驱动的瀑布流卡。
          <strong className="text-zinc-200"> 请分别在 mobile（DevTools 切 iPhone 或窗口 &lt; 792px）和 desktop 下对比。</strong>
        </p>
        <div className="mt-4 flex flex-wrap gap-4 text-xs text-zinc-500">
          <span>
            Viewport：<strong className="text-zinc-200">{vw}px</strong>
          </span>
          <span>
            Breakpoint：<strong className="text-zinc-200">{isSmallScreen ? 'mobile' : 'desktop'}</strong>
          </span>
          <span>
            Content width：<strong className="text-zinc-200">{containerWidth}px</strong>
          </span>
        </div>
      </header>

      {/* 容器：和 ExploreHero 一致的内边距，保证几何对齐线上 */}
      <div
        ref={containerRef}
        style={{
          paddingLeft:  isSmallScreen ? '16px' : '92px',
          paddingRight: isSmallScreen ? '16px' : '56px',
          maxWidth: 1400,
          margin: '0 auto',
        }}
      >
        {VARIANTS.map(v => {
          const h = computeHeight(v);
          return (
            <section key={v.id} style={{ marginBottom: 56 }}>
              {/* 规格标签 */}
              <div
                className="flex items-baseline justify-between gap-4 mb-3 pb-2"
                style={{ borderBottom: '1px solid rgba(255,255,255,0.08)' }}
              >
                <div>
                  <h2 className="text-base font-semibold text-zinc-100">{v.label}</h2>
                  <p className="text-xs text-zinc-500 mt-1">{v.description}</p>
                </div>
                <div className="text-right font-mono text-xs text-zinc-400 whitespace-nowrap shrink-0">
                  <div>
                    <span className="text-zinc-600">W × H：</span>
                    <strong className="text-zinc-200">
                      {containerWidth} × {h}
                    </strong>{' '}
                    <span className="text-zinc-600">px</span>
                  </div>
                  <div className="mt-0.5">
                    <span className="text-zinc-600">ratio：</span>
                    <strong className="text-zinc-200">
                      {containerWidth > 0 ? (containerWidth / h).toFixed(2) : '-'} : 1
                    </strong>
                  </div>
                </div>
              </div>
              {/* Hero card */}
              <HeroCard height={h} isSmallScreen={isSmallScreen} />
            </section>
          );
        })}

        {/* 底部对比小结 */}
        <div
          className="rounded-2xl p-5 mt-8 border border-zinc-800 bg-zinc-900/40"
          style={{ fontSize: 13, lineHeight: 1.65 }}
        >
          <h3 className="text-sm font-semibold text-zinc-100 mb-2">对比要点</h3>
          <ul className="space-y-1.5 text-zinc-400">
            <li>• <strong className="text-zinc-200">Current</strong> 是基线，替代方案要比它明显更好才值得换</li>
            <li>• <strong className="text-zinc-200">16:9</strong> mobile 看会比 Current 稍扁；desktop 会比 Current 高一倍（~620px）</li>
            <li>• <strong className="text-zinc-200">4:3</strong> desktop 会高到 800+ px，基本占满首屏</li>
            <li>• <strong className="text-zinc-200">21:9</strong> 电影级横幅，需要新增 AR 选项</li>
            <li>• 视频 object-fit: cover 在所有变体都一致，差异纯粹来自容器几何</li>
          </ul>
        </div>
      </div>
    </div>
  );
}
