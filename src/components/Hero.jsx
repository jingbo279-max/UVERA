import React, { Suspense, lazy, useRef, useEffect, useCallback, useState } from 'react';
import { Play, CaretDown } from '@phosphor-icons/react';
import UnifiedVideoPlayer from './UnifiedVideoPlayer';
import { getMainPaddingLeft } from '../hooks/useSidebarState';

const Spline = lazy(() => import('@splinetool/react-spline'));

/* ─── Hero slide definitions (background + text paired) ─── */
const SEKO_VIDEO_URL = 'https://seko-resource.sensetime.com/STS/animo/dev/resource/publicVideo/videos/landing_video.mov';

const HERO_SLIDES = [
  {
    id: 'spline',
    type: 'spline',
    content: {
      eyebrow:     'Dream with AI',
      title:       'Universal Gateway',
      description: 'to Hybrid Futures.',
      cta: [{ label: "Share your inspiration, and the AI will craft content & generate videos for you.", input: true }],
    },
  },
  {
    id: 'seko',
    type: 'video',
    src: SEKO_VIDEO_URL,
    content: {
      eyebrow:     'AI Video',
      title:       'Create Worlds',
      description: 'Transform ideas into cinematic reality.',
      cta: [{ label: "Describe your vision and let AI bring it to life.", input: true }],
    },
  },
  {
    id: 'placeholder',
    type: 'gradient',
    gradient: 'linear-gradient(135deg, #0c0c1d 0%, #1b1b3a 50%, #2d1b69 100%)',
    content: {
      eyebrow:     'Sound Studio',
      title:       'Hear the Future',
      description: 'AI-powered music and sound design.',
      cta: [{ label: "Hum a melody, describe a mood — AI composes the rest.", input: true }],
    },
  },
];

/* Default hero appearance — used on the home section */
const HOME_HERO = {
  gradient:     'linear-gradient(135deg, #7C3AED 0%, #9333EA 50%, #4338CA 100%)',
  shadowColor:  'rgba(139,92,246,0.2)',
  overlayColor: 'rgba(167,139,250,0.5)',
};

/* Fallback content — used on channel pages without custom content */
const HOME_CONTENT = HERO_SLIDES[0].content;

/* ─── Spline 3D galaxy background ─── */
function SplineBackground() {
  return (
    <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', overflow: 'hidden' }}>
      <Spline
        style={{ width: '100%', height: '100%', pointerEvents: 'none' }}
        scene="https://prod.spline.design/us3ALejTXl6usHZ7/scene.splinecode"
      />
    </div>
  );
}

/* ─── Gradient fallback ─── */
function GradientFallback({ gradient }) {
  return (
    <div style={{ position: 'absolute', inset: 0, background: gradient }}>
      <div
        className="animate-pulse"
        style={{ position: 'absolute', inset: 0, background: 'linear-gradient(135deg, rgba(167,139,250,0.5), transparent)' }}
      />
    </div>
  );
}

/* ─── Video slide with error fallback ───
 * §2026-05-23 fei: previously branched between <Stream> iframe (CF videos)
 *   and native <video> (direct mp4). UnifiedVideoPlayer handles both paths
 *   internally now — native HLS on Safari, hls.js everywhere else. One
 *   element, no iframe, swipe-friendly. */
function VideoSlide({ src }) {
  const [error, setError] = useState(false);
  if (error) return <GradientFallback gradient="linear-gradient(135deg, #1a1a2e 0%, #16213e 50%, #0f3460 100%)" />;
  return (
    <UnifiedVideoPlayer
      src={src}
      autoPlay
      loop
      muted
      playsInline
      preload="auto"
      onError={() => setError(true)}
      style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }}
      className="absolute inset-0 w-full h-full"
    />
  );
}

/* ─── Page Control (Figma 51:5275 spec) ─── */
function PageControl({ total, current, onChange }) {
  return (
    <div
      className="flex items-center justify-center gap-2 pointer-events-auto"
      style={{ height: '44px', padding: '8px 12px' }}
    >
      {Array.from({ length: total }, (_, i) => (
        <button
          key={i}
          onClick={() => onChange(i)}
          className="rounded-full cursor-pointer transition-opacity duration-300"
          style={{
            width: 8, height: 8,
            background: 'white',
            opacity: i === current ? 1 : 0.3,
          }}
        />
      ))}
    </div>
  );
}


/* ═══════════════════════════════════════════════════════════
   HeroBackdrop — fixed background layer, OUTSIDE scroll container
   ═══════════════════════════════════════════════════════════ */
export function HeroBackdrop({ hero, activeSlide, scrollContainer }) {
  const scrimRef = useRef(null);

  /* Scroll-driven darken: black scrim fades IN as user scrolls past hero */
  useEffect(() => {
    const container = scrollContainer;
    if (!container || !scrimRef.current) return;
    const onScroll = () => {
      const h = window.innerHeight * 0.69;
      const progress = Math.min(container.scrollTop / h, 1);
      scrimRef.current.style.opacity = progress;
    };
    container.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
    return () => container.removeEventListener('scroll', onScroll);
  }, [scrollContainer]);

  const { gradient, overlayColor } = hero ?? HOME_HERO;
  const isCarousel = !hero; /* carousel only on Explore home */
  const slides = isCarousel ? HERO_SLIDES : null;

  return (
    <div
      style={{ position: 'absolute', inset: 0, zIndex: 0, pointerEvents: 'none', background: 'black' }}
    >
      {isCarousel ? (
        /* ── 3-slide carousel backgrounds ── */
        slides.map((slide, i) => (
          <div
            key={slide.id}
            className="hero-slide"
            style={{
              position: 'absolute', inset: 0,
              opacity: i === activeSlide ? 1 : 0,
              transition: 'opacity 1.2s ease-in-out',
            }}
          >
            {slide.type === 'spline' && (
              <Suspense fallback={<GradientFallback gradient={gradient} />}>
                {(i === activeSlide || i === (activeSlide + 1) % slides.length) && <SplineBackground />}
              </Suspense>
            )}
            {slide.type === 'video' && <VideoSlide src={slide.src} />}
            {slide.type === 'gradient' && (
              <div style={{ position: 'absolute', inset: 0, background: slide.gradient }} />
            )}
          </div>
        ))
      ) : (
        /* ── Channel page: single gradient background ── */
        <div style={{ position: 'absolute', inset: 0, background: gradient }} />
      )}

      {/* Gradient overlays — side vignette + bottom fade (always on top) */}
      <div
        style={{
          position: 'absolute', inset: 0,
          background: `
            linear-gradient(to right, rgba(0,0,0,0.7), transparent 30%, transparent 70%, rgba(0,0,0,0.7)),
            linear-gradient(to bottom, transparent 50%, rgba(0,0,0,1))
          `,
          pointerEvents: 'none',
          zIndex: 1,
        }}
      />

      {/* Channel color tint (only for channel pages) */}
      {hero && (
        <div
          style={{
            position: 'absolute', inset: 0,
            background: `linear-gradient(135deg, ${overlayColor}, transparent)`,
            opacity: 0.3,
            pointerEvents: 'none',
            zIndex: 1,
            maskImage: 'linear-gradient(to bottom, black 40%, transparent 85%)',
            WebkitMaskImage: 'linear-gradient(to bottom, black 40%, transparent 85%)',
          }}
        />
      )}

      {/* Black scrim — fades IN on scroll to darken (not brighten) the backdrop */}
      <div
        ref={scrimRef}
        style={{
          position: 'absolute', inset: 0,
          background: 'black',
          opacity: 0,
          zIndex: 2,
          pointerEvents: 'none',
          willChange: 'opacity',
        }}
      />
    </div>
  );
}


/* ═══════════════════════════════════════════════════════════
   HeroContent — transparent window INSIDE scroll container
   ═══════════════════════════════════════════════════════════ */
export function HeroContent({
  hero, sidebarMode, scrollContainer, onCtaClick, onScrollDown,
  activeSlide, setActiveSlide, totalSlides,
}) {
  const { content } = hero ?? HOME_HERO;
  const isCarousel = !hero;
  /* For carousel: text comes from the active slide; for channel pages: static content */
  const slideContent = isCarousel ? (HERO_SLIDES[activeSlide]?.content ?? HOME_CONTENT) : (content ?? HOME_CONTENT);
  const { eyebrow, title, description, cta } = slideContent;

  const heroHeight = '69vh';
  const textRef    = useRef(null);
  const chevronRef = useRef(null);
  const sectionRef = useRef(null);

  /* ── Auto-advance carousel ── */
  const timerRef = useRef(null);

  const resetTimer = useCallback(() => {
    if (!isCarousel) return;
    clearInterval(timerRef.current);
    timerRef.current = setInterval(() => {
      setActiveSlide?.(prev => (prev + 1) % totalSlides);
    }, 8000);
  }, [isCarousel, totalSlides, setActiveSlide]);

  useEffect(() => {
    resetTimer();
    return () => clearInterval(timerRef.current);
  }, [resetTimer]);

  const handleDotClick = (index) => {
    setActiveSlide?.(index);
    resetTimer();
  };

  /* ── Scroll-driven fade: text + chevron ── */
  useEffect(() => {
    const container = scrollContainer;
    if (!container) return;

    const onScroll = () => {
      const scrollTop = container.scrollTop;
      const h = sectionRef.current?.offsetHeight || 1;

      const textProgress = Math.min(scrollTop / (h * 0.5), 1);
      if (textRef.current) {
        textRef.current.style.opacity = 1 - textProgress;
        textRef.current.style.transform = `translateY(${-textProgress * 30}px)`;
      }

      const chevronProgress = Math.min(scrollTop / (h * 0.3), 1);
      if (chevronRef.current) {
        chevronRef.current.style.opacity = 1 - chevronProgress;
      }
    };

    container.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
    return () => container.removeEventListener('scroll', onScroll);
  }, [scrollContainer]);

  /* ── CTA hover handlers ── */
  const onPrimaryHover = (e) => {
    e.currentTarget.style.backgroundColor = 'rgba(255,255,255,1)';
    e.currentTarget.style.boxShadow = '0 4px 20px rgba(255,255,255,0.15)';
  };
  const offPrimaryHover = (e) => {
    e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.95)';
    e.currentTarget.style.boxShadow = 'none';
  };
  const onSecondaryHover = (e) => {
    e.currentTarget.querySelector('[data-hover-overlay]').style.background = 'rgba(255,255,255,0.12)';
  };
  const offSecondaryHover = (e) => {
    e.currentTarget.querySelector('[data-hover-overlay]').style.background = 'transparent';
  };

  const pillBase = {
    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px',
    borderRadius: '9999px', padding: '10px 24px', height: '42px',
    fontSize: '14px', fontWeight: '600', lineHeight: '20px',
    cursor: 'pointer', position: 'relative', overflow: 'hidden',
    transition: 'all 0.3s ease',
  };
  const pillHoverOverlay = {
    position: 'absolute', top: 0, left: 0, width: '100%', height: '100%',
    borderRadius: 'inherit', pointerEvents: 'none', transition: '0.25s ease-in-out',
  };

  /* ── Play FAB hover ── */
  const fabEnter = (e) => {
    const el = e.currentTarget;
    el.style.transition = 'background-color 0.2s ease-out';
    el.style.backgroundColor = 'rgba(255,255,255,0.38)';
    setTimeout(() => { el.style.transition = 'background-color 0.4s ease-in-out'; el.style.backgroundColor = 'rgba(255,255,255,0.26)'; }, 250);
  };
  const fabLeave = (e) => {
    e.currentTarget.style.transition = 'background-color 0.35s ease-in';
    e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.15)';
  };

  return (
    <section ref={sectionRef} className="relative overflow-hidden group" style={{ height: heroHeight, background: 'transparent' }}>

      {/* Text content — centered, fades on scroll */}
      <div
        ref={textRef}
        style={{
          position: 'absolute', inset: 0,
          display: 'flex', justifyContent: 'flex-start', alignItems: 'center',
          zIndex: 10, pointerEvents: 'none',
          willChange: 'opacity, transform', transition: 'none',
        }}
      >
        <div className={`w-full ${sidebarMode ? getMainPaddingLeft(sidebarMode) : ''}`}>
        <div className="text-center text-white px-12 w-full flex flex-col items-center relative" style={{ minHeight: '280px' }}>
          {/* Carousel: all slides stacked, crossfade via opacity */}
          {isCarousel ? HERO_SLIDES.map((slide, i) => {
            const sc = slide.content;
            return (
              <div
                key={slide.id}
                className="absolute inset-0 flex flex-col items-center justify-center transition-opacity duration-700 ease-in-out"
                style={{ opacity: i === activeSlide ? 1 : 0, pointerEvents: i === activeSlide ? 'auto' : 'none' }}
              >
                <p className="text-sm font-medium tracking-widest uppercase mb-3 opacity-80">{sc.eyebrow}</p>
                <h2
                  className="text-7xl font-medium mb-4 tracking-tight whitespace-nowrap"
                  style={{ fontFamily: "'Crimson Pro', 'Georgia', serif", lineHeight: 1.1 }}
                >{sc.title}</h2>
                <p className="text-lg mb-8 opacity-80 max-w-[576px] leading-relaxed">{sc.description}</p>

                <div className="flex pointer-events-auto flex-row items-center justify-center gap-3 w-full max-w-[640px]">
                  {sc.cta.map(({ label, input }) => input ? (
                    <div
                      key={label}
                      onClick={() => onCtaClick?.(label)}
                      className="cursor-pointer w-full"
                      style={{
                        display: 'flex', alignItems: 'center', borderRadius: '9999px',
                        padding: '12px 24px', height: '48px', fontSize: '14px', lineHeight: '20px',
                        color: 'rgba(255,255,255,0.45)',
                        backgroundColor: 'rgba(255,255,255,0.06)',
                        border: '1px solid rgba(255,255,255,0.15)',
                        backdropFilter: 'blur(8px)', WebkitBackdropFilter: 'blur(8px)',
                        whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                      }}
                    >
                      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{label}</span>
                    </div>
                  ) : (
                    <button
                      key={label}
                      onClick={() => onCtaClick?.(label)}
                      style={{
                        ...pillBase,
                        backgroundColor: 'rgba(255,255,255,0.06)',
                        color: 'rgba(255,255,255,0.85)',
                        border: '1px solid rgba(255,255,255,0.2)',
                        backdropFilter: 'blur(8px)', WebkitBackdropFilter: 'blur(8px)',
                      }}
                      onMouseEnter={onSecondaryHover}
                      onMouseLeave={offSecondaryHover}
                    >
                      <div data-hover-overlay style={pillHoverOverlay} />
                      <span style={{ position: 'relative', zIndex: 1 }}>{label}</span>
                    </button>
                  ))}
                </div>
              </div>
            );
          }) : (
            /* Non-carousel: static content */
            <>
              <p className="text-sm font-medium tracking-widest uppercase mb-3 opacity-80">{eyebrow}</p>
              <h2
                className="text-7xl font-medium mb-4 tracking-tight whitespace-nowrap"
                style={{ fontFamily: "'Crimson Pro', 'Georgia', serif", lineHeight: 1.1 }}
              >{title}</h2>
              <p className="text-lg mb-8 opacity-80 max-w-[576px] leading-relaxed">{description}</p>
              <div className="flex pointer-events-auto flex-row items-center justify-center gap-3 w-full max-w-[640px]">
                {cta.map(({ label, href, primary, input }) => {
                  if (input) {
                    return (
                      <div
                        key={label}
                        onClick={() => onCtaClick?.(label)}
                        className="cursor-pointer w-full"
                        style={{
                          display: 'flex', alignItems: 'center', borderRadius: '9999px',
                          padding: '12px 24px', height: '48px', fontSize: '14px', lineHeight: '20px',
                          color: 'rgba(255,255,255,0.45)',
                          backgroundColor: 'rgba(255,255,255,0.06)',
                          border: '1px solid rgba(255,255,255,0.15)',
                          backdropFilter: 'blur(8px)', WebkitBackdropFilter: 'blur(8px)',
                          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                        }}
                      >
                        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{label}</span>
                      </div>
                    );
                  }
                  const style = {
                    ...pillBase,
                    backgroundColor: primary ? 'rgba(255,255,255,0.95)' : 'rgba(255,255,255,0.06)',
                    color: primary ? 'rgba(0,0,0,0.88)' : 'rgba(255,255,255,0.85)',
                    border: '1px solid rgba(255,255,255,0.2)',
                    backdropFilter: primary ? 'none' : 'blur(8px)',
                    WebkitBackdropFilter: primary ? 'none' : 'blur(8px)',
                    width: 'auto',
                  };
                  const hoverEnter = primary ? onPrimaryHover : onSecondaryHover;
                  const hoverLeave = primary ? offPrimaryHover : offSecondaryHover;
                  return href ? (
                    <a key={label} href={href} style={{ ...style, textDecoration: 'none' }} onMouseEnter={hoverEnter} onMouseLeave={hoverLeave}>
                      {!primary && <div data-hover-overlay style={pillHoverOverlay} />}
                      <span style={{ position: 'relative', zIndex: 1 }}>{label}</span>
                    </a>
                  ) : (
                    <button key={label} onClick={() => onCtaClick?.(label)} style={style} onMouseEnter={hoverEnter} onMouseLeave={hoverLeave}>
                      {!primary && <div data-hover-overlay style={pillHoverOverlay} />}
                      <span style={{ position: 'relative', zIndex: 1 }}>{label}</span>
                    </button>
                  );
                })}
              </div>
            </>
          )}

        </div>
        </div>
      </div>

      {/* Play FAB — only for playable hero content */}
      {cta?.some?.(c => c.playable) || content?.playable ? (
        <div
          className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity duration-500 ease-in-out"
          style={{ zIndex: 11, pointerEvents: 'none' }}
        >
          <div
            className="rounded-full flex items-center justify-center cursor-pointer"
            style={{
              width: '80px', height: '80px',
              backgroundColor: 'rgba(255,255,255,0.15)',
              backdropFilter: 'blur(80px)', WebkitBackdropFilter: 'blur(80px)',
              border: '0px none', transition: 'background-color 0.25s ease-out',
              pointerEvents: 'auto',
            }}
            onMouseEnter={fabEnter}
            onMouseLeave={fabLeave}
          >
            <Play size={36} weight="fill" color="white" style={{ marginLeft: '3px' }} />
          </div>
        </div>
      ) : null}

      {/* Page Control + Scroll-down chevron — stacked at bottom center */}
      <div
        ref={chevronRef}
        style={{
          position: 'absolute', bottom: '5%', left: '50%', transform: 'translateX(-50%)',
          zIndex: 12, willChange: 'opacity',
          display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '8px',
        }}
      >
        {isCarousel && (
          <PageControl total={totalSlides} current={activeSlide} onChange={handleDotClick} />
        )}
        <div
          className="rounded-full flex items-center justify-center cursor-pointer"
          style={{
            width: '40px', height: '40px',
            backgroundColor: 'rgba(255,255,255,0.1)',
            border: '1px solid rgba(255,255,255,0.15)',
            transition: 'background-color 0.25s ease',
            pointerEvents: 'auto',
          }}
          onClick={onScrollDown}
          onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.2)'; }}
          onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.1)'; }}
        >
          <CaretDown size={18} weight="bold" color="rgba(255,255,255,0.7)" />
        </div>
      </div>
    </section>
  );
}


/* ═══════════════════════════════════════════════════════════
   Default export — backward compat for channel pages
   ═══════════════════════════════════════════════════════════ */
export default function Hero(props) {
  return <HeroContent {...props} />;
}
