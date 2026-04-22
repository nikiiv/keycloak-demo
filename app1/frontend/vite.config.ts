import { defineConfig } from 'vite';

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
        target: 'http://app1-bff:8081',
        changeOrigin: true
      }
    }
  }
});
