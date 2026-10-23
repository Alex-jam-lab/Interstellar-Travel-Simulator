import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

const rootDir = fileURLToPath(new URL('.', import.meta.url));

// 单页构建：用于把主航程打包成「双击即开」的单文件
export default defineConfig({
  base: './',
  build: {
    outDir: 'dist-standalone-index',
    emptyOutDir: true,
    chunkSizeWarningLimit: 900,
    rollupOptions: {
      input: resolve(rootDir, 'index.html'),
    },
  },
});
