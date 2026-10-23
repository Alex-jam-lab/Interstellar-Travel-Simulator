import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

const rootDir = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig({
  // 相对路径构建，方便部署到 GitHub Pages 子路径、对象存储或任意静态目录
  base: './',
  build: {
    chunkSizeWarningLimit: 900,
    rollupOptions: {
      input: {
        main: resolve(rootDir, 'index.html'),
        miller: resolve(rootDir, 'miller.html'),
      },
    },
  },
});
