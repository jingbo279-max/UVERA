import React, { useState } from 'react';
import {
  SquaresFour, CardsThree, PlusCircle, StarFour, UserCircle, Sparkle,
  /* Tools section */
  UploadSimple, CircleNotch, Check, X,
} from '@phosphor-icons/react';
import { useAutoColorExtraction } from '../hooks/useAutoColorExtraction';

/* ─── Nav icons — 对齐当前 app 生产导航（Sidebar 3 + BottomTabBar mobile 5 + Studio 自指代）
 * 2026-04-23 — 从旧 4 频道（clips/story/sound/live）下线后的第一版刷新 */
const NAV_ICONS = [
  { id: 'explore', Icon: SquaresFour, name: 'Explore', fillColor: '#292524', glowCls: '',               indicatorColor: '#a8a29e' },
  { id: 'library', Icon: CardsThree,  name: 'Library', fillColor: '#8B5CF6', glowCls: 'fx-glow-violet', indicatorColor: '#8B5CF6' },
  { id: 'create',  Icon: PlusCircle,  name: 'Create',  fillColor: '#F59E0B', glowCls: 'fx-glow-amber',  indicatorColor: '#F59E0B' },
  { id: 'spark',   Icon: StarFour,    name: 'Spark',   fillColor: '#EF4444', glowCls: 'fx-glow-red',    indicatorColor: '#EF4444' },
  { id: 'profile', Icon: UserCircle,  name: 'Profile', fillColor: '#F43F5E', glowCls: 'fx-glow-rose',   indicatorColor: '#F43F5E' },
  { id: 'studio',  Icon: Sparkle,     name: 'Studio',  fillColor: '#a78bfa', glowCls: 'fx-glow-violet', indicatorColor: '#a78bfa' },
];

/* ─── Tool registry ─── */
const TOOLS = [
  { id: 'color-extractor', label: 'Color Extractor', desc: 'Extract Tailwind color tokens from a cover image.' },
];

/* ─── EffectLabel sub-component ─── */
function EffectLabel({ number, title, note, grad }) {
  return (
    <div className="flex items-center gap-3 mb-4">
      <span className={`px-3 py-0.5 rounded-full text-xs font-semibold text-white bg-gradient-to-r ${grad} shadow-sm flex-shrink-0`}>
        Effect {number}
      </span>
      <span className="text-sm font-medium text-label-secondary">{title}</span>
      <div className="flex-1 border-t border-background-secondary" />
      <span className="text-[10px] text-label-tertiary flex-shrink-0">{note}</span>
    </div>
  );
}

export default function StudioPage({ isSmallScreen }) {
  /* ── Tool state ── */
  const [activeTool,      setActiveTool]      = useState('color-extractor');
  const [imagePreview,    setImagePreview]     = useState(null);
  const [extractedColors, setExtractedColors] = useState(null);
  const [copied,          setCopied]           = useState(false);
  const { extractColorsFromFile, isProcessing, error } = useAutoColorExtraction();

  /* ── Animation effect state ── */
  const [activeWeights, setActiveWeights] = useState(new Set()); // Effect 01
  const [shakingId,     setShakingId]     = useState(null);      // Effect 04b
  const [ripples,       setRipples]       = useState([]);         // Effect 04a
  const [activeNav,     setActiveNav]     = useState('explore');  // Effect 05

  /* ── Card width ── */
  const cardW = isSmallScreen ? '60px' : '72px';

  /* ── Effect 01: toggle weight ── */
  const toggleWeight = (id) =>
    setActiveWeights(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  /* ── Effect 04a: ripple ── */
  const addRipple = (e, containerId) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const size = Math.max(e.currentTarget.offsetWidth, e.currentTarget.offsetHeight);
    const x = e.clientX - rect.left - size / 2;
    const y = e.clientY - rect.top  - size / 2;
    const id = Date.now() + Math.random();
    setRipples(prev => [...prev, { id, containerId, x, y, size }]);
  };

  /* ── Effect 04b: shake ── */
  const triggerShake = (id) => {
    setShakingId(null);
    requestAnimationFrame(() => setShakingId(id));
  };

  /* ── Tool handlers ── */
  const handleUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    setExtractedColors(null);
    const reader = new FileReader();
    reader.onload = (ev) => setImagePreview(ev.target.result);
    reader.readAsDataURL(file);
    try {
      const colors = await extractColorsFromFile(file);
      setExtractedColors(colors);
    } catch { /* error shown via hook */ }
  };

  const copyCode = () => {
    if (!extractedColors) return;
    const code = `{\n  color:    '${extractedColors.color}',\n  badgeHex: '${extractedColors.badgeHex}',\n  bgColor:  '${extractedColors.bgColor}',\n}`;
    navigator.clipboard.writeText(code).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    });
  };

  return (
    <div className="pb-16">

      {/* ── Page header ── */}
      <div className={`${isSmallScreen ? 'px-4 pt-6 pb-6' : 'px-8 pt-6 pb-8'}`}>
        <p className="text-xs font-semibold text-accent tracking-widest uppercase mb-2">Internal Tools</p>
        <h2
          className={`${isSmallScreen ? 'text-3xl' : 'text-4xl'} font-medium text-label tracking-tight`}
          style={{ fontFamily: "'Crimson Pro', 'Georgia', serif" }}
        >
          Studio
        </h2>
        <p className="text-label-tertiary mt-2 text-sm leading-relaxed">
          Design tools &amp; component library for the UVERA platform.
        </p>
      </div>

      {/* ═══════════════════════════════════════════
          Section 1 — Icon Animation Gallery
         ═══════════════════════════════════════════ */}
      <div className={`${isSmallScreen ? 'px-4' : 'px-8'} mb-14`}>
        <h3 className="text-base font-semibold text-label mb-1">Icon Animation Gallery</h3>
        <p className="text-xs text-label-tertiary mb-6">
          5 种 Phosphor 图标动效方案 — 点击 / Hover 预览。
        </p>

        {/* Scoped keyframes + effect CSS */}
        <style>{`
          /* ── Effect 02: Spring Bounce ── */
          .fx-spring .fx-icon {
            transition: transform 0.25s cubic-bezier(0.34,1.56,0.64,1), color 0.2s ease;
          }
          .fx-spring:hover .fx-icon { transform: scale(1.28); color: rgba(0,0,0,0.85); }
          .fx-spring:active .fx-icon { transform: scale(0.88); transition: transform 0.1s ease; }

          /* ── Effect 03: Channel Color Glow ── */
          .fx-glow {
            transition: background 0.25s ease, border-color 0.25s ease, box-shadow 0.25s ease;
          }
          .fx-glow .fx-icon {
            transition: color 0.25s ease, filter 0.25s ease, transform 0.2s cubic-bezier(0.34,1.56,0.64,1);
          }
          .fx-glow:hover .fx-icon { transform: scale(1.1); }
          .fx-glow:active .fx-icon { transform: scale(0.93); }

          .fx-glow-amber:hover { background: rgba(245,158,11,0.09) !important; border-color: rgba(245,158,11,0.4) !important; box-shadow: 0 0 18px rgba(245,158,11,0.14); }
          .fx-glow-amber:hover .fx-icon { color: #F59E0B; filter: drop-shadow(0 0 5px rgba(245,158,11,0.6)); }

          .fx-glow-rose:hover { background: rgba(244,63,94,0.09) !important; border-color: rgba(244,63,94,0.4) !important; box-shadow: 0 0 18px rgba(244,63,94,0.14); }
          .fx-glow-rose:hover .fx-icon { color: #F43F5E; filter: drop-shadow(0 0 5px rgba(244,63,94,0.6)); }

          .fx-glow-violet:hover { background: rgba(139,92,246,0.09) !important; border-color: rgba(139,92,246,0.4) !important; box-shadow: 0 0 18px rgba(139,92,246,0.14); }
          .fx-glow-violet:hover .fx-icon { color: #8B5CF6; filter: drop-shadow(0 0 5px rgba(139,92,246,0.6)); }

          .fx-glow-red:hover { background: rgba(239,68,68,0.09) !important; border-color: rgba(239,68,68,0.4) !important; box-shadow: 0 0 18px rgba(239,68,68,0.14); }
          .fx-glow-red:hover .fx-icon { color: #EF4444; filter: drop-shadow(0 0 5px rgba(239,68,68,0.6)); }

          /* ── Effect 04a: Tap Ripple ── */
          @keyframes studioRipple { to { transform: scale(4); opacity: 0; } }
          .fx-ripple-circle {
            position: absolute; border-radius: 50%; pointer-events: none;
            transform: scale(0); animation: studioRipple 0.5s linear forwards;
            background: rgba(0,0,0,0.06);
          }

          /* ── Effect 04b: Shake ── */
          @keyframes studioShake {
            0%, 100% { transform: rotate(0deg); }
            20%  { transform: rotate(-18deg); }
            40%  { transform: rotate(18deg); }
            60%  { transform: rotate(-12deg); }
            80%  { transform: rotate(8deg); }
          }
          .fx-shaking { animation: studioShake 0.45s cubic-bezier(0.36,0.07,0.19,0.97) forwards; }
        `}</style>

        <div className="space-y-10">

          {/* ─── Effect 01: Regular → Fill ──────────────────────── */}
          <div>
            <EffectLabel
              number="01" grad="from-slate-500 to-stone-700"
              title="Regular → Fill 切换" note="推荐用于 Active 激活态 · 点击切换"
            />
            <div className="flex flex-wrap gap-3">
              {NAV_ICONS.map(({ id, Icon, name, fillColor }) => {
                const isActive = activeWeights.has(id);
                return (
                  <button
                    key={id}
                    onClick={() => toggleWeight(id)}
                    className="flex flex-col items-center gap-2 p-3 rounded-2xl bg-background-secondary border border-background-tertiary hover:border-label-quaternary transition-colors duration-200 cursor-pointer select-none"
                    style={{ width: cardW }}
                  >
                    <div className="relative w-10 h-10 flex items-center justify-center">
                      {/* Regular — fades out + scale-up on active */}
                      <span
                        style={{
                          position: 'absolute',
                          opacity: isActive ? 0 : 1,
                          transform: isActive ? 'scale(1.3)' : 'scale(1)',
                          transition: 'opacity 0.15s ease, transform 0.15s ease',
                        }}
                      >
                        <Icon size={20} weight="regular" className="text-label-tertiary" />
                      </span>
                      {/* Fill — springs in on active */}
                      <span
                        style={{
                          position: 'absolute',
                          opacity: isActive ? 1 : 0,
                          transform: isActive ? 'scale(1)' : 'scale(0.7)',
                          color: fillColor,
                          transition: isActive
                            ? 'opacity 0.15s ease, transform 0.2s cubic-bezier(0.34,1.56,0.64,1)'
                            : 'opacity 0.15s ease, transform 0.15s ease',
                        }}
                      >
                        <Icon size={20} weight="fill" />
                      </span>
                    </div>
                    <span className="text-[9px] text-label-tertiary font-medium text-center leading-tight">{name}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* ─── Effect 02: Spring Bounce ───────────────────────── */}
          <div>
            <EffectLabel
              number="02" grad="from-violet-400 to-purple-600"
              title="Spring Bounce" note="Hover 弹性回弹 · cubic-bezier(0.34,1.56,0.64,1)"
            />
            <div className="flex flex-wrap gap-3">
              {NAV_ICONS.map(({ id, Icon, name }) => (
                <button
                  key={id}
                  className="fx-spring flex flex-col items-center gap-2 p-3 rounded-2xl bg-background-secondary border border-background-tertiary cursor-default select-none"
                  style={{ width: cardW }}
                >
                  <div className="w-10 h-10 flex items-center justify-center">
                    <Icon size={20} weight="regular" className="fx-icon text-label-tertiary" />
                  </div>
                  <span className="text-[9px] text-label-tertiary font-medium text-center leading-tight">{name}</span>
                </button>
              ))}
            </div>
          </div>

          {/* ─── Effect 03: Channel Color Glow ─────────────────── */}
          <div>
            <EffectLabel
              number="03" grad="from-amber-400 to-orange-500"
              title="Channel Color Glow" note="频道识别色高光 · Hover"
            />
            <div className="flex flex-wrap gap-3">
              {NAV_ICONS.map(({ id, Icon, name, glowCls }) => (
                <button
                  key={id}
                  className={`fx-glow ${glowCls} flex flex-col items-center gap-2 p-3 rounded-2xl bg-background-secondary border border-background-tertiary cursor-default select-none`}
                  style={{ width: cardW }}
                >
                  <div className="w-10 h-10 flex items-center justify-center">
                    <Icon size={20} weight="regular" className="fx-icon text-label-tertiary" />
                  </div>
                  <span className="text-[9px] text-label-tertiary font-medium text-center leading-tight">{name}</span>
                </button>
              ))}
            </div>
          </div>

          {/* ─── Effect 04: Tap Ripple + Shake ─────────────────── */}
          <div>
            <EffectLabel
              number="04" grad="from-rose-400 to-red-500"
              title="Tap Ripple & Shake" note="点击特效"
            />
            <div className="flex flex-wrap gap-3 items-start">
              {/* Ripple — first 3 icons */}
              {NAV_ICONS.slice(0, 3).map(({ id, Icon }) => (
                <button
                  key={id}
                  onClick={(e) => addRipple(e, id)}
                  className="relative flex flex-col items-center gap-2 p-3 rounded-2xl bg-background-secondary border border-background-tertiary overflow-hidden cursor-pointer select-none hover:border-label-quaternary transition-colors"
                  style={{ width: cardW }}
                >
                  <div className="relative z-10 w-10 h-10 flex items-center justify-center">
                    <Icon size={20} weight="regular" className="text-label-secondary" />
                  </div>
                  <span className="text-[9px] text-label-tertiary font-medium text-center leading-tight relative z-10">
                    Ripple
                  </span>
                  {ripples.filter(r => r.containerId === id).map(r => (
                    <span
                      key={r.id}
                      className="fx-ripple-circle"
                      style={{ width: r.size, height: r.size, left: r.x, top: r.y }}
                      onAnimationEnd={() => setRipples(prev => prev.filter(x => x.id !== r.id))}
                    />
                  ))}
                </button>
              ))}

              {/* Visual divider */}
              <div className="w-px bg-background-tertiary self-stretch mx-1" />

              {/* Shake — last 3 icons */}
              {NAV_ICONS.slice(3).map(({ id, Icon }) => (
                <button
                  key={id}
                  onClick={() => triggerShake(id)}
                  className="flex flex-col items-center gap-2 p-3 rounded-2xl bg-background-secondary border border-background-tertiary cursor-pointer select-none hover:border-label-quaternary transition-colors"
                  style={{ width: cardW }}
                >
                  <div className="w-10 h-10 flex items-center justify-center">
                    <span
                      className={shakingId === id ? 'fx-shaking' : ''}
                      onAnimationEnd={() => setShakingId(null)}
                      style={{ display: 'block' }}
                    >
                      <Icon size={20} weight="regular" className="text-label-secondary" />
                    </span>
                  </div>
                  <span className="text-[9px] text-label-tertiary font-medium text-center leading-tight">Shake</span>
                </button>
              ))}
            </div>
          </div>

          {/* ─── Effect 05: Full Nav Simulation ────────────────── */}
          <div>
            <EffectLabel
              number="05" grad="from-cyan-400 to-blue-500"
              title="完整侧边导航模拟" note="Weight Switch + Color Indicator · 点击切换"
            />
            <div className="flex gap-4 items-stretch">

              {/* Mini sidebar */}
              <div
                className="flex flex-col gap-1 p-2 rounded-[28px] bg-background-secondary border border-background-tertiary"
                style={{ width: '60px', flexShrink: 0 }}
              >
                {NAV_ICONS.map(({ id, Icon, name, fillColor, indicatorColor }) => {
                  const isActive = activeNav === id;
                  return (
                    <button
                      key={id}
                      onClick={() => setActiveNav(id)}
                      title={name}
                      className="relative flex items-center justify-center rounded-[14px] cursor-pointer transition-colors duration-200"
                      style={{
                        height: '44px', width: '100%',
                        background: isActive ? 'rgba(0,0,0,0.06)' : 'transparent',
                      }}
                    >
                      {/* Left indicator pill */}
                      <span
                        style={{
                          position: 'absolute', left: 0,
                          width: 3, height: 18, borderRadius: '0 3px 3px 0',
                          background: indicatorColor,
                          opacity: isActive ? 1 : 0,
                          transform: isActive ? 'scaleY(1)' : 'scaleY(0)',
                          transition: 'opacity 0.2s ease, transform 0.25s cubic-bezier(0.34,1.56,0.64,1)',
                        }}
                      />
                      {/* Regular icon */}
                      <span
                        style={{
                          position: 'absolute',
                          opacity: isActive ? 0 : 1,
                          transform: isActive ? 'scale(1.4)' : 'scale(1)',
                          transition: 'all 0.2s cubic-bezier(0.34,1.56,0.64,1)',
                        }}
                      >
                        <Icon size={20} weight="regular" className="text-label-tertiary" />
                      </span>
                      {/* Fill icon */}
                      <span
                        style={{
                          position: 'absolute',
                          opacity: isActive ? 1 : 0,
                          transform: isActive ? 'scale(1)' : 'scale(0.6)',
                          color: fillColor,
                          transition: 'all 0.2s cubic-bezier(0.34,1.56,0.64,1)',
                        }}
                      >
                        <Icon size={20} weight="fill" />
                      </span>
                    </button>
                  );
                })}
              </div>

              {/* Content panel */}
              <div
                className="flex-1 rounded-3xl bg-background border border-background-tertiary flex items-center justify-center relative overflow-hidden"
                style={{ minHeight: isSmallScreen ? '240px' : '300px' }}
              >
                {/* Radial color hint per channel */}
                {NAV_ICONS.map(({ id, indicatorColor }) =>
                  activeNav === id ? (
                    <div
                      key={id}
                      className="absolute inset-0 pointer-events-none transition-all duration-500"
                      style={{ background: `radial-gradient(circle at 30% 40%, ${indicatorColor}22 0%, transparent 65%)` }}
                    />
                  ) : null
                )}
                {/* Channel label */}
                <div className="text-center relative z-10">
                  {NAV_ICONS.filter(n => n.id === activeNav).map(({ name, indicatorColor }) => (
                    <div key={name}>
                      <div className="text-xl font-bold text-label mb-2" style={{ transition: 'color 0.3s' }}>{name}</div>
                      <div className="w-8 h-[3px] rounded-full mx-auto" style={{ background: indicatorColor, transition: 'background 0.3s' }} />
                      <p className="text-[11px] text-label-tertiary mt-3">点击左侧导航切换频道</p>
                    </div>
                  ))}
                </div>
              </div>

            </div>
          </div>

        </div>
      </div>

      {/* Section divider */}
      <div className={`${isSmallScreen ? 'mx-4' : 'mx-8'} border-t border-background-secondary mb-12`} />

      {/* ═══════════════════════════════════════════
          Section 2 — Tool Tabs + Active Tool
         ═══════════════════════════════════════════ */}
      <div className={`${isSmallScreen ? 'px-4' : 'px-8'}`}>
        <h3 className="text-base font-semibold text-label mb-1">Tools</h3>
        <p className="text-xs text-label-tertiary mb-5">
          Platform internal utilities. More tools will be added here.
        </p>

        {/* Tool tab bar */}
        <div className="flex items-center gap-2 mb-6 flex-wrap">
          {TOOLS.map((t) => (
            <button
              key={t.id}
              onClick={() => setActiveTool(t.id)}
              className={`px-4 py-1.5 rounded-full text-sm font-medium transition-all duration-200 cursor-pointer ${
                activeTool === t.id
                  ? 'bg-stone-900 text-white shadow-sm'
                  : 'bg-background-secondary text-label-secondary hover:bg-background-tertiary'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* ── Color Extractor tool ── */}
        {activeTool === 'color-extractor' && (
          <div className={isSmallScreen ? '' : 'max-w-[576px]'}>

            <input
              type="file"
              accept="image/*"
              onChange={handleUpload}
              className="hidden"
              id="studio-upload"
            />
            <label
              htmlFor="studio-upload"
              className="block border-2 border-dashed border-background-tertiary rounded-2xl p-8 text-center cursor-pointer hover:border-accent/50 hover:bg-accent-bg/40 transition-all duration-200"
            >
              {imagePreview ? (
                <div className="space-y-3">
                  <img
                    src={imagePreview}
                    alt="Preview"
                    className="w-32 h-32 object-cover rounded-xl mx-auto shadow-md"
                  />
                  {isProcessing ? (
                    <div className="flex items-center justify-center gap-2 text-accent text-sm">
                      <CircleNotch size={16} className="animate-spin" />
                      <span>Analysing…</span>
                    </div>
                  ) : extractedColors ? (
                    <div className="flex items-center justify-center gap-2 text-emerald-600 text-sm">
                      <Check size={16} />
                      <span>Done — click to replace</span>
                    </div>
                  ) : null}
                </div>
              ) : (
                <>
                  <UploadSimple size={32} className="text-label-quaternary mx-auto mb-2" />
                  <p className="text-sm text-label-secondary font-medium">Drop cover image here or click to browse</p>
                  <p className="text-xs text-label-quaternary mt-1">JPG · PNG · WebP</p>
                </>
              )}
            </label>

            {/* Results */}
            {extractedColors && (
              <div className="mt-5 space-y-4">

                {/* Card preview strip */}
                <div className={`rounded-2xl ${extractedColors.bgColor} p-3 flex items-center gap-4`}>
                  <div className="relative w-16 h-16 rounded-xl overflow-hidden flex-shrink-0 shadow">
                    <img src={imagePreview} alt="" className="w-full h-full object-cover" />
                    <div className="absolute top-1 left-1">
                      <div
                        className="w-5 h-5 rounded-md flex items-center justify-center shadow-sm"
                        style={{ backgroundColor: extractedColors.badgeHex }}
                      >
                        <Lightning size={12} weight="fill" className="text-white" />
                      </div>
                    </div>
                  </div>

                  <div className="space-y-1.5 min-w-0">
                    <div className="flex items-center gap-2">
                      <div
                        className="w-4 h-4 rounded flex-shrink-0 border border-black/8 shadow-sm"
                        style={{ backgroundColor: extractedColors.tailwindHex || '#F3F4F6' }}
                      />
                      <span className="font-mono text-sm font-semibold text-label">{extractedColors.colorName}</span>
                      <span className="font-mono text-xs text-label-tertiary">{extractedColors.tailwindHex}</span>
                    </div>
                    {extractedColors.rgb && (
                      <div className="flex items-center gap-2">
                        <div
                          className="w-4 h-4 rounded flex-shrink-0 border border-black/8 shadow-sm"
                          style={{ backgroundColor: `rgb(${extractedColors.rgb.r},${extractedColors.rgb.g},${extractedColors.rgb.b})` }}
                        />
                        <span className="font-mono text-xs text-label-tertiary">
                          RGB({extractedColors.rgb.r}, {extractedColors.rgb.g}, {extractedColors.rgb.b})
                        </span>
                      </div>
                    )}
                  </div>
                </div>

                {/* Code block */}
                <div className="bg-stone-900 rounded-xl overflow-hidden">
                  <div className="flex items-center justify-between px-4 py-2.5 border-b border-white/5">
                    <span className="text-xs text-label-secondary font-mono">mediaItem snippet</span>
                    <button
                      onClick={copyCode}
                      className="flex items-center gap-1.5 text-xs font-medium transition-colors cursor-pointer px-2 py-1 rounded hover:bg-white/10"
                      style={{ color: copied ? '#34d399' : '#9ca3af' }}
                    >
                      <Check size={12} />
                      {copied ? 'Copied!' : 'Copy'}
                    </button>
                  </div>
                  <pre className="px-4 py-4 text-sm font-mono overflow-x-auto" style={{ color: '#86efac' }}>
{`{
  color:    '${extractedColors.color}',
  badgeHex: '${extractedColors.badgeHex}',
  bgColor:  '${extractedColors.bgColor}',
}`}
                  </pre>
                </div>
              </div>
            )}

            {error && (
              <div className="mt-4 bg-destructive/10 border border-destructive/20 rounded-xl p-3 flex items-start gap-2.5">
                <X size={16} className="text-destructive flex-shrink-0 mt-0.5" />
                <p className="text-sm text-destructive">{error}</p>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
