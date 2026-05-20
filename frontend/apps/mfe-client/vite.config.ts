import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import federation from '@originjs/vite-plugin-federation';

// Module-federation remote: shell loads ./Mfe at runtime via remoteEntry.js.
// React and friends are listed in `shared` so the shell's copy wins and the
// MFE never instantiates a second React (which would break hooks).
export default defineConfig({
  plugins: [
    react(),
    federation({
      name: 'mfeClient',
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
    port: 5181,
    strictPort: true,
    host: '0.0.0.0',
    cors: true,
    allowedHosts: ['localhost', '127.0.0.1', 'mfe-client']
  }
});
