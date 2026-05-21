import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import federation from '@originjs/vite-plugin-federation';

export default defineConfig({
  plugins: [
    react(),
    federation({
      name: 'mfeOps',
      filename: 'remoteEntry.js',
      exposes: {
        './Mfe': './src/index.tsx'
      },
      shared: ['react', 'react-dom', '@tanstack/react-query']
    })
  ],
  build: {
    target: 'esnext',
    minify: false,
    cssCodeSplit: false
  },
  preview: {
    port: 5182,
    strictPort: true,
    host: '0.0.0.0',
    cors: true,
    allowedHosts: ['localhost', '127.0.0.1', 'mfe-ops']
  }
});
