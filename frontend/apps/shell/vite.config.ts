import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import federation from '@originjs/vite-plugin-federation';

// Each MFE is its own deployable; the shell discovers them at runtime via
// remoteEntry.js fetched from URLs set in env vars (defaults match the dev
// compose port assignments).
const mfeClientUrl = process.env.VITE_MFE_CLIENT_URL ?? 'http://localhost:5181';
const mfeOpsUrl = process.env.VITE_MFE_OPS_URL ?? 'http://localhost:5182';
const mfeAdminUrl = process.env.VITE_MFE_ADMIN_URL ?? 'http://localhost:5183';

// One BFF per MFE plus a "shell" BFF for /api/whoami. In compose every host
// resolves; for host-side dev the defaults map to the published ports.
const bffShellUrl = process.env.BFF_SHELL_URL ?? 'http://localhost:8081';
const bffClientUrl = process.env.BFF_CLIENT_URL ?? 'http://localhost:8081';
const bffOpsUrl = process.env.BFF_OPS_URL ?? 'http://localhost:8082';
const bffAdminUrl = process.env.BFF_ADMIN_URL ?? 'http://localhost:8083';

export default defineConfig({
  plugins: [
    react(),
    federation({
      name: 'shell',
      remotes: {
        mfeClient: `${mfeClientUrl}/assets/remoteEntry.js`,
        mfeOps: `${mfeOpsUrl}/assets/remoteEntry.js`,
        mfeAdmin: `${mfeAdminUrl}/assets/remoteEntry.js`
      },
      shared: ['react', 'react-dom', 'react-router-dom', '@tanstack/react-query']
    })
  ],
  build: {
    target: 'esnext',
    minify: false,
    cssCodeSplit: false
  },
  server: {
    port: 5173,
    host: '0.0.0.0',
    allowedHosts: ['localhost', '127.0.0.1', '.int'],
    watch: {
      usePolling: true,
      interval: 500
    },
    proxy: apiProxy()
  },
  preview: {
    port: 5173,
    strictPort: true,
    host: '0.0.0.0',
    cors: true,
    proxy: apiProxy()
  }
});

// Per-MFE BFF routing: the shell strips the /client|/ops|/admin segment so
// each downstream BFF sees a plain /api/* URL. /api/whoami goes to the shell
// BFF (which is bff-client in compose — any auth'd user can call it).
function apiProxy() {
  return {
    '/api/client': {
      target: bffClientUrl,
      changeOrigin: true,
      rewrite: (p: string) => p.replace(/^\/api\/client/, '/api')
    },
    '/api/ops': {
      target: bffOpsUrl,
      changeOrigin: true,
      rewrite: (p: string) => p.replace(/^\/api\/ops/, '/api')
    },
    '/api/admin': {
      target: bffAdminUrl,
      changeOrigin: true,
      rewrite: (p: string) => p.replace(/^\/api\/admin/, '/api')
    },
    '/api': {
      target: bffShellUrl,
      changeOrigin: true
    }
  };
}
