import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

export default defineConfig(({ mode }) => ({
  base: './',
  plugins: mode === 'single' ? [viteSingleFile()] : [],
  build: {
    target: 'es2020',
    assetsInlineLimit: 100000000,
    chunkSizeWarningLimit: 5000,
    modulePreload: false,
    outDir: mode === 'single' ? 'dist-single' : 'dist',
  },
  server: {
    host: true,
  },
}));
