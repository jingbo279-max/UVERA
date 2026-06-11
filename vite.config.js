import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

import { cloudflare } from "@cloudflare/vite-plugin";
import { sentryVitePlugin } from '@sentry/vite-plugin';
import { readFileSync } from 'fs';
import dotenv from 'dotenv';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url)));

// §2026-05-31 — Sentry source map 上传。token 放本地 .env.sentry-build-plugin
//   (gitignored)。只有有 token 时才上传 + 出 sourcemap;没 token(fei 的
//   `npm run deploy` / CI / 普通 dev)→ 插件不挂载,行为完全不变。
//   上传后 .map 会从 dist 删掉,不随静态资源公开发布(不暴露源码)。
dotenv.config({ path: '.env.sentry-build-plugin' });
const SENTRY_AUTH_TOKEN = process.env.SENTRY_AUTH_TOKEN;

// ⚠️  端口永久固定，禁止修改：
//   Dev     → 5176  (npm run dev)
//   Preview → 4173  (npm run preview)
export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  // 仅当要上传 Sentry source map 时才生成(否则不出 .map,避免公开发布暴露源码)。
  build: {
    sourcemap: SENTRY_AUTH_TOKEN ? true : false,
  },
  // Cloudflare Worker 模拟器默认关闭 —— 当前部署在阿里云 nginx，CF 迁移前用不到。
  // Dev 下开启会让每个请求同时走 Worker 模拟器（environment: "uvera"），
  // 真机 LAN 访问时 env.ASSETS 为 undefined 抛错，导致 CSS 注入链路静默失败。
  // 需要验证 Worker 行为时用：CF=1 npm run dev
  plugins: [
    react(),
    tailwindcss(),
    ...(process.env.CF === '1' ? [cloudflare()] : []),
    // Sentry source map 上传 + 建 release(必须放插件数组最后)。无 token → 不挂载。
    //   release 名 = package.json version,跟 src/sentry.js 的 Sentry.init release
    //   一致;实际匹配靠注入的 debug id,所以即便同版本多次部署也对得上堆栈。
    ...(SENTRY_AUTH_TOKEN ? [sentryVitePlugin({
      org: 'ughf-technology-inc',
      project: 'javascript-react',
      authToken: SENTRY_AUTH_TOKEN,
      release: { name: pkg.version },
      // 上传后删掉 dist 里的 .map,绝不随静态资源公开发布。
      sourcemaps: { filesToDeleteAfterUpload: ['./dist/**/*.map'] },
      telemetry: false,
    })] : []),
  ],
  server: {
    host: '0.0.0.0',   // 监听所有网卡，局域网设备可通过 Mac IP 访问
    port: 5176,        // 固定，不读 process.env.PORT
    strictPort: true,  // 端口被占用时直接报错，不自动漂移
    // 让 HMR WebSocket 跟随 client 看到的 host（而不是写死 localhost）
    // 真机通过 http://192.168.x.x:5176 访问时，WS 自动连 ws://192.168.x.x:5176
    // 不配时 Vite 对 host=0.0.0.0 偶发把 HMR host 默认成 localhost，
    // 真机 WS 握手失败 → __vite__updateStyle 抛错 → Tailwind CSS 不注入 → 无样式 HTML
    hmr: {
      clientPort: 5176,
    },
    proxy: {
      '/neodomain-api': {
        target: 'https://dev.neodomain.cn',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/neodomain-api/, '')
      },
      '/api': {
        target: 'https://uvera.ai',
        changeOrigin: true
        // Path is intentionally not rewritten so uvera.ai/_worker.js catches /api/stream/... and /api/upload/...
      }
    }
  },
  preview: {
    host: '0.0.0.0',
    port: 4173,        // 固定
    strictPort: true,
  },
})