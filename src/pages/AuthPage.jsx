import React, { useState, useEffect } from 'react';
import {
  GlobeSimple,
  User,
  EnvelopeSimple,
  LockSimple,
  Eye,
  EyeSlash,
  PaperPlaneTilt,
  CaretLeft,
} from '@phosphor-icons/react';
import { supabase } from '../api/supabaseClient';
import { Checkbox } from '../design-system/primitives/Checkbox';

/* ─────────────────────────────────────────────────────────── */
/*  Constants                                                   */
/* ─────────────────────────────────────────────────────────── */

/* Local compressed hero background (1280p H.264, no audio, faststart, ~3MB) */
const HERO_VIDEO  = '/videos/hero-bg.mp4';
const HERO_POSTER = '/videos/hero-bg-poster.jpg';

const BG_GRADIENT =
  'linear-gradient(135deg, #0c0c1d 0%, #1b1b3a 50%, #2d1b69 100%)';

const LANGUAGES = [
  { code: 'en',    label: 'English'  },
  { code: 'zh-CN', label: '简体中文' },
  { code: 'zh-TW', label: '繁體中文' },
];

/* ─────────────────────────────────────────────────────────── */
/*  Inline SVG icons (Google / Apple)                          */
/* ─────────────────────────────────────────────────────────── */

function GoogleIcon() {
  return (
    <svg viewBox="0 0 24 24" className="shrink-0" width={18} height={18} fill="none">
      <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
      <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
      <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z" fill="#FBBC05"/>
      <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
    </svg>
  );
}

function AppleIcon() {
  return (
    <svg viewBox="0 0 24 24" width={18} height={18} className="shrink-0" fill="currentColor">
      <path d="M12.152 6.896c-.948 0-2.415-1.078-3.96-1.04-2.04.027-3.91 1.183-4.961 3.014-2.117 3.675-.546 9.103 1.519 12.09 1.013 1.454 2.208 3.09 3.792 3.039 1.52-.065 2.09-.987 3.935-.987 1.831 0 2.35.987 3.96.948 1.637-.026 2.676-1.48 3.676-2.948 1.156-1.688 1.636-3.325 1.662-3.415-.039-.013-3.182-1.221-3.22-4.857-.026-3.04 2.48-4.494 2.597-4.559-1.429-2.09-3.623-2.324-4.39-2.376-2-.156-3.675 1.09-4.61 1.09zm3.378-3.066c.843-1.012 1.4-2.427 1.245-3.83-1.207.052-2.662.805-3.532 1.818-.78.896-1.454 2.338-1.273 3.714 1.338.104 2.715-.688 3.56-1.702z"/>
    </svg>
  );
}

/* ─────────────────────────────────────────────────────────── */
/*  Shared input field                                          */
/* ─────────────────────────────────────────────────────────── */

/* AuthInput — visionOS TextField (Rounded Rect) adapted for project design system.
 * Figma ref: r7ck4nK0sWnyjcSCwbQ4c0 / Text Field, Secure Field (487:10689, 487:10783)
 * Background: two-layer Recessed glass (color-burn + luminosity) + inner shadow.
 * No visible border — depth is conveyed through shadow only.
 * Font size 17px per visionOS spec. Tokens resolve via parent `dark` class. */
function AuthInput({ icon: Icon, type = 'text', placeholder, value, onChange, rightSlot }) {
  return (
    <div className="relative h-[44px] rounded-[12px] overflow-hidden">

      {/* ── Recessed glass — darker than bg + top shadow + bottom highlight ── */}
      <div
        aria-hidden="true"
        className="absolute inset-0 pointer-events-none"
        style={{
          background: 'rgba(0,0,0,0.25)',
          backdropFilter: 'blur(16px) saturate(1.2)',
          WebkitBackdropFilter: 'blur(16px) saturate(1.2)',
          boxShadow: [
            'inset 0px 2px 6px rgba(0,0,0,0.50)',          /* top dark — recessed cue   */
            'inset 1px 0px 3px rgba(0,0,0,0.20)',           /* left edge slight shadow   */
            'inset 0px -1px 1px rgba(255,255,255,0.18)',    /* bottom highlight          */
          ].join(', '),
        }}
      />

      {/* ── Left icon ── */}
      {Icon && (
        <Icon
          size={17}
          weight="regular"
          className="absolute left-5 top-1/2 -translate-y-1/2 text-label-tertiary pointer-events-none z-10"
        />
      )}

      {/* ── Input element ── */}
      <input
        type={type}
        placeholder={placeholder}
        value={value}
        onChange={onChange}
        autoComplete="off"
        className={`relative z-10 w-full h-full bg-transparent font-medium text-[17px] text-label
                    placeholder:text-label-tertiary placeholder:font-normal
                    focus:outline-none transition-colors duration-200
                    ${Icon ? 'pl-[48px]' : 'pl-5'} ${rightSlot ? 'pr-[48px]' : 'pr-5'}`}
      />

      {/* ── Right slot (eye toggle / clear) ── */}
      {rightSlot && (
        <div className="absolute right-3 top-1/2 -translate-y-1/2 text-label-tertiary z-10">
          {rightSlot}
        </div>
      )}
    </div>
  );
}

/* ─────────────────────────────────────────────────────────── */
/*  Language menu                                               */
/* ─────────────────────────────────────────────────────────── */

function LangMenu({ lang, setLang }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(v => !v)}
        className="btn-icon-muted"
        aria-label="Language"
      >
        <GlobeSimple size={20} weight="regular" className="text-white/80" />
      </button>

      {open && (
        <>
          {/* Click-away backdrop */}
          <div className="fixed z-0" style={{ top: 0, right: 0, bottom: 0, left: 0 }} onClick={() => setOpen(false)} />
          {/* Dropdown — matches NavigationBar glass-regular menu pattern */}
          <div
            className="glass-regular"
            style={{
              position: 'absolute',
              top: 'calc(100% + 4px)',
              right: 0,
              zIndex: 1,
              borderRadius: '16px',
              padding: '6px',
              display: 'flex',
              flexDirection: 'column',
              gap: '2px',
              minWidth: '148px',
            }}
          >
            {LANGUAGES.map(l => (
              <button
                key={l.code}
                onClick={() => { setLang(l.code); setOpen(false); }}
                style={{
                  height: '36px',
                  padding: '0 14px',
                  borderRadius: '10px',
                  backgroundColor: lang === l.code ? 'rgba(255,255,255,0.15)' : 'transparent',
                  border: 'none',
                  fontSize: '13px',
                  fontWeight: lang === l.code ? 600 : 500,
                  color: lang === l.code ? 'rgba(255,255,255,0.95)' : 'rgba(255,255,255,0.55)',
                  whiteSpace: 'nowrap',
                  textAlign: 'left',
                  width: '100%',
                  cursor: 'pointer',
                  transition: 'background-color 0.15s',
                }}
                onMouseEnter={e => { if (lang !== l.code) e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.08)'; }}
                onMouseLeave={e => { if (lang !== l.code) e.currentTarget.style.backgroundColor = 'transparent'; }}
              >
                {l.label}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

/* ─────────────────────────────────────────────────────────── */
/*  Cloudflare Turnstile placeholder                            */
/* ─────────────────────────────────────────────────────────── */

function TurnstilePlaceholder() {
  return (
    <div className="flex items-center gap-3 bg-white/8 border border-white/12 rounded-xl px-4 py-3.5">
      <div className="w-6 h-6 rounded-full border-2 border-white/25 flex items-center justify-center shrink-0">
        <div className="w-2.5 h-2.5 rounded-full bg-white/20" />
      </div>
      <span className="text-sm text-white/45 flex-1">Verify you are human</span>
      <div className="flex items-center gap-1.5 shrink-0">
        <svg viewBox="0 0 60 60" width={20} height={20}>
          <circle cx="30" cy="30" r="30" fill="#F48225"/>
          <text x="50%" y="55%" dominantBaseline="middle" textAnchor="middle" fontSize="22" fill="white" fontWeight="bold">CF</text>
        </svg>
        <span className="text-[10px] text-white/30 leading-none">Cloudflare</span>
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────── */
/*  Main AuthPage component                                     */
/* ─────────────────────────────────────────────────────────── */

export default function AuthPage({ onLogin }) {
  /* view: 'welcome' | 'login' | 'signup' */
  const [view,            setView]           = useState('welcome');
  const [email,           setEmail]          = useState('');
  const [username,        setUsername]       = useState('');
  const [password,        setPassword]       = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword,    setShowPassword]   = useState(false);
  const [showConfirmPw,   setShowConfirmPw]  = useState(false);
  const [subscribe,       setSubscribe]      = useState(true);
  const [lang,            setLang]           = useState('en');
  const [videoError,      setVideoError]     = useState(false);
  const [resendCooldown,  setResendCooldown] = useState(0);
  const [authError,       setAuthError]      = useState('');
  const [loading,         setLoading]        = useState(false);

  const isSignup = view === 'signup';
  const isForm   = view === 'login' || view === 'signup';

  /* Resend cooldown countdown */
  useEffect(() => {
    if (resendCooldown <= 0) return;
    const t = setInterval(() => setResendCooldown(v => (v <= 1 ? (clearInterval(t), 0) : v - 1)), 1000);
    return () => clearInterval(t);
  }, [resendCooldown]);

  /* ── Email / Password submit ── */
  const handleSubmit = async (e) => {
    e.preventDefault();
    setAuthError('');

    /* Client-side validation — fast feedback before hitting the network */
    if (isSignup) {
      if (!username.trim())     return setAuthError('Please enter a username.');
      if (!email.trim())        return setAuthError('Please enter your email.');
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()))
                                return setAuthError('Please enter a valid email address.');
      if (password.length < 8)  return setAuthError('Password must be at least 8 characters.');
      if (password !== confirmPassword) return setAuthError('Passwords do not match.');
    } else {
      if (!email.trim())  return setAuthError('Please enter your email.');
      if (!password)      return setAuthError('Please enter your password.');
    }

    setLoading(true);
    try {
      if (isSignup) {
        /* 2026-05-14 Leon — `emailRedirectTo` 显式指向当前 origin,不再依赖
           Supabase project 的 site_url 默认值 (旧配置可能指 localhost / dev,
           PROD 用户点链接落错地方)。IndexPage 的 auth bootstrap 会从 URL 解析
           `?token_hash=...&type=signup` 完成 verifyOtp,无需专门的 callback 路由。 */
        const { error } = await supabase.auth.signUp({
          email:    email.trim(),
          password,
          options:  {
            data: { username: username.trim() },
            emailRedirectTo: window.location.origin,
          },
        });
        if (error) throw error;
        setView('verify-email');
        setResendCooldown(60);
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
        if (error) throw error;
        onLogin?.(); /* explicit fallback — App also detects session via onAuthStateChange */
      }
    } catch (err) {
      setAuthError(err.message ?? 'Something went wrong. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  /* ── Forgot password: send reset link ── */
  const handleForgotPassword = async (e) => {
    e.preventDefault();
    setAuthError('');
    if (!email.trim()) return setAuthError('Please enter your email address.');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()))
      return setAuthError('Please enter a valid email address.');
    setLoading(true);
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
        redirectTo: window.location.origin,
      });
      if (error) throw error;
      setView('reset-sent');
    } catch (err) {
      setAuthError(err.message ?? 'Something went wrong. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  /* ── OAuth (Google / Apple) — skip email verification ── */
  const handleOAuth = async (provider) => {
    setAuthError('');
    const { error } = await supabase.auth.signInWithOAuth({
      provider,
      options: { redirectTo: window.location.origin },
    });
    if (error) setAuthError(error.message);
  };

  /* ── Resend verification email ── */
  const handleResend = async () => {
    if (resendCooldown > 0) return;
    setResendCooldown(60);
    /* emailRedirectTo 与 signUp 保持一致,IndexPage bootstrap 会处理回跳 token_hash。 */
    await supabase.auth.resend({
      type: 'signup',
      email,
      options: { emailRedirectTo: window.location.origin },
    });
  };

  /* ── Background layers (shared across all views) ── */
  const Background = (
    <>
      {/* Base gradient — always shown */}
      <div className="absolute" style={{ top: 0, right: 0, bottom: 0, left: 0, background: BG_GRADIENT }} />

      {/* Ambient video (muted, looping, falls back silently on error).
       * poster shows instantly while the mp4 buffers, giving us a clean
       * first-paint without a black flash. */}
      {!videoError && (
        <video
          autoPlay loop muted playsInline
          poster={HERO_POSTER}
          onError={() => setVideoError(true)}
          className="absolute w-full h-full object-cover opacity-50"
          style={{ top: 0, right: 0, bottom: 0, left: 0 }}
          src={HERO_VIDEO}
        />
      )}

      {/* Dark overlay for readability */}
      <div className="absolute bg-black/50" style={{ top: 0, right: 0, bottom: 0, left: 0 }} />

      {/* Subtle grain */}
      <div
        className="absolute pointer-events-none opacity-[0.04]"
        style={{ top: 0, right: 0, bottom: 0, left: 0, backgroundImage: 'url("data:image/svg+xml,%3Csvg viewBox=\'0 0 256 256\' xmlns=\'http://www.w3.org/2000/svg\'%3E%3Cfilter id=\'noise\'%3E%3CfeTurbulence type=\'fractalNoise\' baseFrequency=\'0.9\' numOctaves=\'4\' stitchTiles=\'stitch\'/%3E%3C/filter%3E%3Crect width=\'100%25\' height=\'100%25\' filter=\'url(%23noise)\'/%3E%3C/svg%3E")', backgroundSize: '200px 200px' }}
      />
    </>
  );

  /* ═══════════════════════════════════════════════════════ */
  /*  WELCOME VIEW (Figma 636-381)                           */
  /* ═══════════════════════════════════════════════════════ */
  if (view === 'welcome') {
    return (
      <div className="dark fixed z-[100] overflow-y-auto" style={{ top: 0, right: 0, bottom: 0, left: 0, height: '100dvh' }}>
        {Background}

        {/* Language button — z-[110] to stay above auth container (z-[100]) */}
        <div className="fixed right-4 z-[110]" style={{ top: 'max(env(safe-area-inset-top, 16px), 16px)' }}>
          <LangMenu lang={lang} setLang={setLang} />
        </div>

        {/* Content — vertically split: flex-1 top + button bottom */}
        <div
          className="relative z-10 flex flex-col items-center justify-between px-8 pt-12 pb-14 min-h-screen"
          style={{
            minHeight: '100dvh',
            paddingTop: 'max(env(safe-area-inset-top, 48px), 48px)',
            paddingBottom: 'max(env(safe-area-inset-bottom, 56px), 56px)',
          }}
        >
          {/* Center: logo + title */}
          <div className="flex-1 flex flex-col items-center justify-center gap-5">
            <img
              src="/brand/uvera-logo.png"
              alt="UVERA"
              className="w-[64px] h-[64px]"
              style={{ filter: 'drop-shadow(0 8px 24px rgba(99,102,241,0.45)) drop-shadow(0 2px 8px rgba(0,0,0,0.4))' }}
            />
            <div className="text-center">
              <h1 className="text-[22px] font-semibold text-white">
                UVERA.ai
              </h1>
              <p
                className="text-[15px] mt-1 font-medium"
                style={{ color: 'rgba(235,235,245,0.6)' }}
              >
                Dream with AI
              </p>
            </div>
          </div>

          {/* Join in — Figma 51:1784 Not Tinted · Dark Mode
            * iOS dark mode: rgba(255,255,255,0.18) fill + blur + white text
            * Inline style width/maxWidth: avoids --spacing-sm=8px @theme conflict */}
          <button
            onClick={() => setView('login')}
            className="relative flex items-center justify-center gap-[4px] px-[20px] py-[6px]
                       rounded-[1000px] cursor-pointer shrink-0"
            style={{ width: '100%', maxWidth: '400px' }}
          >
            {/* Backdrop blur fill */}
            <div
              className="absolute inset-0 rounded-[1000px] pointer-events-none overflow-hidden"
              aria-hidden
              style={{
                backdropFilter: 'blur(20px) saturate(180%)',
                WebkitBackdropFilter: 'blur(20px) saturate(180%)',
                background: 'rgba(255,255,255,0.18)',
                boxShadow: '0px 0px 2px 0px rgba(0,0,0,0.1), 0px 1px 8px 0px rgba(0,0,0,0.12), inset 0 0.5px 0 rgba(255,255,255,0.35)',
              }}
            />
            {/* Label — white text on dark */}
            <div className="relative flex h-[36px] items-center justify-center rounded-[100px] shrink-0">
              <span className="text-[17px] font-medium text-white text-center whitespace-nowrap leading-none">
                Join in
              </span>
            </div>
          </button>
        </div>
      </div>
    );
  }

  /* ═══════════════════════════════════════════════════════ */
  /*  VERIFY EMAIL VIEW                                      */
  /* ═══════════════════════════════════════════════════════ */
  if (view === 'verify-email') {
    return (
      <div className="dark fixed z-[100] overflow-y-auto" style={{ top: 0, right: 0, bottom: 0, left: 0, background: '#0c0c1d', height: '100dvh' }}>
        {Background}

        <div className="fixed right-4 z-[110]" style={{ top: 'max(env(safe-area-inset-top, 16px), 16px)' }}>
          <LangMenu lang={lang} setLang={setLang} />
        </div>

        <div
          className="relative z-10 flex items-center justify-center px-6 min-h-screen"
          style={{
            minHeight: '100dvh',
            paddingTop: 'max(env(safe-area-inset-top, 64px), 64px)',
            paddingBottom: 'max(env(safe-area-inset-bottom, 64px), 64px)',
          }}
        >
          <div
            className="w-full max-w-[400px] flex flex-col items-center gap-6 text-center"
            style={{ animation: 'authFadeIn 0.3s ease-out' }}
          >
            {/* Icon */}
            <div
              className="w-[72px] h-[72px] rounded-full flex items-center justify-center"
              style={{ background: 'rgba(99,102,241,0.18)', boxShadow: '0 0 0 1px rgba(99,102,241,0.3)' }}
            >
              <PaperPlaneTilt size={32} weight="fill" style={{ color: 'rgb(99,102,241)' }} />
            </div>

            {/* Title + body */}
            <div className="flex flex-col gap-2">
              <h1 className="text-2xl font-bold text-white">Check your email</h1>
              <p className="text-sm text-white/55 leading-relaxed">
                We sent a verification link to
              </p>
              <p className="text-sm font-semibold text-white/90">{email}</p>
              <p className="text-sm text-white/40 mt-1">
                Click the link to activate your account. Check your spam folder if you don't see it.
              </p>
            </div>

            {/* Resend */}
            <div className="flex flex-col items-center gap-2 w-full">
              <button
                type="button"
                onClick={handleResend}
                disabled={resendCooldown > 0}
                className="btn-primary disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {resendCooldown > 0 ? `Resend in ${resendCooldown}s` : 'Resend email'}
              </button>

              <button
                type="button"
                onClick={() => { setView('signup'); setResendCooldown(0); }}
                className="flex items-center gap-1.5 text-sm text-white/40 hover:text-white/70 transition-colors cursor-pointer mt-1"
              >
                <CaretLeft size={16} weight="bold" />
                Wrong email? Go back
              </button>
            </div>
          </div>
        </div>

        <style>{`
          @keyframes authFadeIn {
            from { opacity: 0; transform: translateY(8px); }
            to   { opacity: 1; transform: translateY(0);   }
          }
        `}</style>
      </div>
    );
  }

  /* ═══════════════════════════════════════════════════════ */
  /*  AUTH FORM VIEW (login / signup)                        */
  /* ═══════════════════════════════════════════════════════ */
  return (
    <div
      className="dark fixed z-[100] overflow-y-auto"
      style={{ top: 0, right: 0, bottom: 0, left: 0, background: '#0c0c1d', height: '100dvh' }}
    >
      {Background}

      {/* Language button — z-[110] to stay above auth container (z-[100]) */}
      <div className="fixed right-4 z-[110]" style={{ top: 'max(env(safe-area-inset-top, 16px), 16px)' }}>
        <LangMenu lang={lang} setLang={setLang} />
      </div>

      {/* Centered form card */}
      <div
        className="relative z-10 flex items-center justify-center px-6 pt-10 pb-16 min-h-screen"
        style={{
          minHeight: '100dvh',
          paddingTop: 'max(env(safe-area-inset-top, 40px), 40px)',
          paddingBottom: 'max(env(safe-area-inset-bottom, 64px), 64px)',
        }}
      >
        <div
          className="w-full max-w-[400px] flex flex-col gap-6 transition-opacity duration-200"
          key={view} /* re-mount on view switch for fade effect */
          style={{ animation: 'authFadeIn 0.2s ease-out' }}
        >
          {/* Logo */}
          <div className="flex justify-center">
            <img
              src="/brand/uvera-logo.png"
              alt="UVERA"
              className="w-12 h-12"
              style={{ filter: 'drop-shadow(0 4px 16px rgba(99,102,241,0.4)) drop-shadow(0 1px 4px rgba(0,0,0,0.3))' }}
            />
          </div>

          {/* Title + subtitle */}
          <div className="text-center">
            <h1 className="text-2xl font-bold text-white leading-tight">
              {isSignup ? 'Create your account' : 'Welcome to UVERA.ai'}
            </h1>
            <p className="text-sm text-white/55 mt-2">
              {isSignup ? (
                <>Already have an account?{' '}
                  <button
                    type="button"
                    onClick={() => setView('login')}
                    className="text-accent hover:opacity-80 font-medium transition-opacity cursor-pointer"
                  >
                    Log in
                  </button>
                </>
              ) : (
                <>Don't have an account?{' '}
                  <button
                    type="button"
                    onClick={() => setView('signup')}
                    className="text-accent hover:opacity-80 font-medium transition-opacity cursor-pointer"
                  >
                    Sign up
                  </button>
                </>
              )}
            </p>
          </div>

          {/* Third-party OAuth buttons */}
          <div className="flex flex-col gap-3 w-full mx-auto" style={{ maxWidth: '400px' }}>
            <button
              type="button"
              onClick={() => handleOAuth('google')}
              className="w-full flex items-center justify-center gap-2.5
                         glass-regular text-label font-medium py-3 rounded-full
                         transition-all duration-200 text-sm cursor-pointer
                         hover:opacity-90 active:opacity-75"
            >
              <GoogleIcon />
              Continue with Google
            </button>
            <button
              type="button"
              onClick={() => handleOAuth('apple')}
              className="w-full flex items-center justify-center gap-2.5
                         glass-regular text-label font-medium py-3 rounded-full
                         transition-all duration-200 text-sm cursor-pointer
                         hover:opacity-90 active:opacity-75"
            >
              <AppleIcon />
              Continue with Apple
            </button>
          </div>

          {/* ── or divider ── */}
          <div className="flex items-center gap-3 px-5 -my-[16px]">
            <div className="flex-1 h-px bg-white/15" />
            <span className="text-xs text-white/35 select-none">or</span>
            <div className="flex-1 h-px bg-white/15" />
          </div>

          {/* ── Form ── */}
          <form onSubmit={handleSubmit} className="flex flex-col gap-3">
            {/* Error message */}
            {authError && (
              <div className="rounded-xl px-4 py-3 text-sm text-red-300 bg-red-500/10 border border-red-500/20">
                {authError}
              </div>
            )}

            {/* Username — signup only */}
            {isSignup && (
              <AuthInput
                icon={User}
                placeholder="Username"
                value={username}
                onChange={e => setUsername(e.target.value)}
              />
            )}

            {/* Email */}
            <AuthInput
              icon={EnvelopeSimple}
              type="email"
              placeholder={isSignup ? 'Email' : 'Email or Username'}
              value={email}
              onChange={e => setEmail(e.target.value)}
            />

            {/* Password */}
            <AuthInput
              icon={LockSimple}
              type={showPassword ? 'text' : 'password'}
              placeholder="Password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              rightSlot={
                <button
                  type="button"
                  onClick={() => setShowPassword(v => !v)}
                  className="text-white/40 hover:text-white/70 transition-colors cursor-pointer"
                >
                  {showPassword ? <EyeSlash size={16} /> : <Eye size={16} />}
                </button>
              }
            />

            {/* Confirm password — signup only */}
            {isSignup && (
              <AuthInput
                icon={LockSimple}
                type={showConfirmPw ? 'text' : 'password'}
                placeholder="Confirm password"
                value={confirmPassword}
                onChange={e => setConfirmPassword(e.target.value)}
                rightSlot={
                  <button
                    type="button"
                    onClick={() => setShowConfirmPw(v => !v)}
                    className="text-white/40 hover:text-white/70 transition-colors cursor-pointer"
                  >
                    {showConfirmPw ? <EyeSlash size={16} /> : <Eye size={16} />}
                  </button>
                }
              />
            )}

            {/* Forgot password — login only */}
            {!isSignup && (
              <div className="flex justify-end -mt-1">
                <button
                  type="button"
                  className="text-xs text-accent hover:opacity-80 transition-opacity cursor-pointer"
                >
                  Forgot your password?
                </button>
              </div>
            )}

            {/* Turnstile — signup only */}
            {isSignup && <TurnstilePlaceholder />}

            {/* Submit CTA */}
            <button type="submit" disabled={loading} className="btn-primary mt-1 disabled:opacity-50 disabled:cursor-not-allowed">
              {loading ? (isSignup ? 'Creating account…' : 'Logging in…') : (isSignup ? 'Continue' : 'Login')}
            </button>
          </form>

          {/* ── Legal + subscribe ── */}
          <div className="flex flex-col items-center gap-3 text-center">
            <p className="text-xs text-white/35 leading-relaxed">
              By {isSignup ? 'signing up' : 'logging in'}, you agree to our{' '}
              <button
                type="button"
                className="text-white/55 hover:text-white/80 underline underline-offset-2 transition-colors cursor-pointer"
              >
                Terms & Privacy
              </button>
            </p>

            {/* 2026-05-19 round-46 — native checkbox → visionOS <Checkbox>
              * primitive (Figma node 137:9566 spec)。children prop 传 label
              * text,outer label HTML association,text click 也 toggle。 */}
            <Checkbox
              checked={subscribe}
              onChange={e => setSubscribe(e.target.checked)}
              className="text-left"
            >
              <span className="text-xs text-white/40 leading-relaxed">
                Receive updates & promotional emails
              </span>
            </Checkbox>
          </div>
        </div>
      </div>

      {/* Fade-in keyframe */}
      <style>{`
        @keyframes authFadeIn {
          from { opacity: 0; transform: translateY(8px); }
          to   { opacity: 1; transform: translateY(0);   }
        }
      `}</style>
    </div>
  );
}
