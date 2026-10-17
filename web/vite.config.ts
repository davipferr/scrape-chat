import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Em desenvolvimento a interface roda no Vite (5173) e manda /api para o servidor (8787).
export default defineConfig({
  root: import.meta.dirname,
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: true,
    proxy: { '/api': { target: 'http://127.0.0.1:8787', changeOrigin: false } },
  },
  build: { outDir: 'dist', emptyOutDir: true },
});
