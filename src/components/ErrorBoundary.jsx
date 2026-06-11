import React from 'react';
import * as Sentry from '@sentry/react';

export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null, errorInfo: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    /* Vite chunk 哈希变化（服务端部署了新版）时自动 reload。
     * 闸门用时间戳而非一次性 flag — 30s 内最多 reload 一次（防死循环），
     * 过去 30s 的记录视为过期允许再次自愈（如用户 tab 常驻、连续遇到多次部署）。*/
    if (error && (error.name === 'ChunkLoadError' || (error.message && error.message.includes('fetch dynamically imported module')))) {
      const lastAttempt = Number(sessionStorage.getItem('chunk_reload_ts')) || 0;
      const elapsed = Date.now() - lastAttempt;
      if (elapsed > 30_000) {
        sessionStorage.setItem('chunk_reload_ts', String(Date.now()));
        console.warn('Vite ChunkLoadError: Deploy detected. Forcing clean window reload...');
        window.location.reload();
        return;
      }
      console.warn('Vite ChunkLoadError: already tried reload <30s ago, showing fallback UI.');
    }

    console.error('ErrorBoundary caught an error:', error, errorInfo);
    // Forward to Sentry for centralized monitoring (no-op if VITE_SENTRY_DSN unset).
    Sentry.captureException(error, { contexts: { react: { componentStack: errorInfo?.componentStack } } });
    this.setState({ errorInfo });
  }

  render() {
    if (this.state.hasError) {
      // §2026-06-03 — 可选 scoped fallback:某个子树(如 discover feed)单独包一层
      //   <ErrorBoundary fallback={({error,reset})=>...}> 时,只渲染局部降级 UI +
      //   提供 reset() 重试,不触发下面的整页 fallback。根用法(无 fallback prop)行为不变。
      if (this.props.fallback) {
        const reset = () => this.setState({ hasError: false, error: null, errorInfo: null });
        return typeof this.props.fallback === 'function'
          ? this.props.fallback({ error: this.state.error, reset })
          : this.props.fallback;
      }
      return (
        <div style={{ padding: '20px', background: '#220000', color: '#ffaaaa', minHeight: '100vh', fontFamily: 'monospace' }}>
          <h2>Something went wrong in the component tree.</h2>
          <details style={{ whiteSpace: 'pre-wrap', marginTop: '10px' }}>
            <summary>Click to view error details</summary>
            {this.state.error && this.state.error.toString()}
            <br />
            {this.state.errorInfo?.componentStack}
          </details>
          <button 
            onClick={() => window.location.href = '/'}
            style={{ marginTop: '20px', padding: '10px', background: '#ffaaaa', color: '#220000', border: 'none', cursor: 'pointer' }}
          >
            Go back to Home
          </button>
        </div>
      );
    }

    return this.props.children; 
  }
}
