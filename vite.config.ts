import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  optimizeDeps: { entries: ['index.html'] },
  server: {
    fs: { deny: ['.env', '.env.*', '**/assets/incoming/**', '**/data/**', '**/server/**', '**/tests/**', '**/node_modules/**/.git/**'] },
    host: '0.0.0.0',
    port: 5173,
    proxy: { '/api': { target: 'http://127.0.0.1:3001', changeOrigin: false } },
  },
  preview: { host: '0.0.0.0', port: 4173 },
});
