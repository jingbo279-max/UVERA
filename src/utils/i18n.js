/**
 * §2026-06-06 fei — 轻量 i18n 工具。
 *
 * 项目目前没有正式 i18n 系统;NavigationBar 的语言选择器之前是装饰性的
 * (只改局部 state)。本文件提供两件最小能力:
 *   1. getUserLang() —— 读用户当前语言:localStorage('uvera_lang') 优先,
 *      读不到回退 navigator.language,归一到 en / zh-CN / zh-TW。
 *   2. t(key, vars) —— 取对应语言文案(缺失回退英文),支持 {name} 插值。
 *
 * 范围:目前只承载「生成失败 / 积分已返还」这一类提示三语化(fei 要求)。
 * 将来全站 i18n 可在此扩展 MESSAGES,或换成正式 i18n 库。
 */

export const SUPPORTED_LANGS = ['en', 'zh-CN', 'zh-TW'];
export const LANG_STORAGE_KEY = 'uvera_lang';

/** 归一任意 BCP-47 语言串到我们支持的三档 */
export function normalizeLang(raw) {
  const s = String(raw || '').trim();
  if (SUPPORTED_LANGS.includes(s)) return s;
  if (/^zh[-_]?(tw|hk|hant|mo)/i.test(s)) return 'zh-TW';
  if (/^zh/i.test(s)) return 'zh-CN';
  if (/^en/i.test(s)) return 'en';
  return null;
}

/** 用户当前语言:站内选择(localStorage)优先 → 浏览器语言回退 → en */
export function getUserLang() {
  try {
    const stored = normalizeLang(localStorage.getItem(LANG_STORAGE_KEY));
    if (stored) return stored;
  } catch { /* SSR / 隐私模式无 localStorage */ }
  try {
    const nav = normalizeLang(navigator.language || (navigator.languages && navigator.languages[0]));
    if (nav) return nav;
  } catch { /* no navigator */ }
  return 'en';
}

/** 持久化用户语言选择(NavigationBar 选择器调用) */
export function setUserLang(lang) {
  const norm = normalizeLang(lang) || 'en';
  try { localStorage.setItem(LANG_STORAGE_KEY, norm); } catch { /* ignore */ }
  return norm;
}

/* 文案表。每条三语;缺某语自动回退 en。{xxx} 为插值占位。 */
const MESSAGES = {
  videoFailTitle:   { 'en': 'Video generation failed',       'zh-CN': '视频生成失败',       'zh-TW': '影片生成失敗' },
  imageFailTitle:   { 'en': 'Image generation failed',       'zh-CN': '图片生成失败',       'zh-TW': '圖片生成失敗' },
  segmentFailTitle: { 'en': 'Segment {n} failed',            'zh-CN': '段 {n} 渲染失败',     'zh-TW': '段 {n} 算圖失敗' },
  // 失败提示主体 —— 明确告知积分已返还
  creditsRefunded:  { 'en': 'Your credits have been refunded.', 'zh-CN': '积分已返还。',      'zh-TW': '積分已返還。' },
  // 进页兜底:核对 stuck 视频任务后,发现失败并补退
  reconcileRefunded: {
    'en': '{count} failed video(s) detected — {credits} credits refunded.',
    'zh-CN': '检测到 {count} 个视频生成失败,已返还 {credits} 积分。',
    'zh-TW': '偵測到 {count} 個影片生成失敗,已返還 {credits} 積分。',
  },
  refundNoticeTitle: { 'en': 'Credits refunded', 'zh-CN': '积分已返还', 'zh-TW': '積分已返還' },
};

function interpolate(str, vars) {
  if (!vars) return str;
  return str.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m));
}

/** 取文案。lang 默认取 getUserLang();key 缺失返回 key 本身(便于发现遗漏)。 */
export function t(key, vars, lang) {
  const L = normalizeLang(lang) || getUserLang();
  const entry = MESSAGES[key];
  if (!entry) return key;
  return interpolate(entry[L] || entry['en'] || key, vars);
}
