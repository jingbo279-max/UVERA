// §2026-06-06 Step 5 — 订阅页浮窗(modal)全局开关。
//   本项目路由是 activeSection 制(非 react-router modal route),CTA 散落在多个
//   组件里。用一个轻量 CustomEvent 作全局 opener:CTA 调 openSubscriptionModal()
//   弹出浮层盖在当前页上(不切 activeSection、不离开原流程),IndexPage 顶层监听并
//   渲染浮层。关闭即回原页。付款走 Stripe 整页跳转,返回落 /subscription 整页显示
//   成功(沿用现有逻辑),不依赖此浮层。
export const SUBSCRIPTION_MODAL_EVENT = 'uvera:open-subscription';

export function openSubscriptionModal() {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(SUBSCRIPTION_MODAL_EVENT));
}
