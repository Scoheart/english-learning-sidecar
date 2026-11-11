import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root: path.resolve(__dirname, 'src/web'),
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src/web'),
    },
  },
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:4317',
        changeOrigin: true,
        configure(proxy) {
          proxy.on('proxyReq', (proxyReq, req) => {
            // Only the trusted dev page gets a same-origin rewrite; hostile Origins
            // still reach the backend unchanged and remain rejected.
            if (['http://127.0.0.1:5173', 'http://localhost:5173'].includes(req.headers.origin || '')) {
              proxyReq.setHeader('origin', 'http://127.0.0.1:4317');
            }
          });
        },
      },
    },
  },
  build: {
    outDir: path.resolve(__dirname, 'src/public'),
    emptyOutDir: false,
    assetsDir: 'assets',
    rollupOptions: {
      output: {
        entryFileNames: 'app.js',
        chunkFileNames: 'assets/[name]-[hash].js',
        assetFileNames: (assetInfo) => {
          if (assetInfo.name && assetInfo.name.endsWith('.css')) {
            return 'styles.css';
          }
          return 'assets/[name]-[hash][extname]';
        },
      },
    },
  },
});
