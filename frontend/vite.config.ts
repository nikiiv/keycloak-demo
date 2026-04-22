import { defineConfig } from 'vite';

const bffUrl = process.env.BFF_URL;
if (!bffUrl) {
  throw new Error('BFF_URL env var is required (e.g. http://bff-a:8080)');
}

export default defineConfig({
  server: {
    port: 5173,
    host: '0.0.0.0',
    allowedHosts: ['localhost', '127.0.0.1'],
    watch: {
      usePolling: true,
      interval: 500
    },
    proxy: {
      '/api': {
        target: bffUrl,
        changeOrigin: true
      }
    }
  }
});
