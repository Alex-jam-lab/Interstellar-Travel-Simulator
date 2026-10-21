import { defineConfig } from 'vite';

export default defineConfig({
  // 相对路径构建，方便部署到 GitHub Pages 子路径、对象存储或任意静态目录
  base: './',
  build: {
    chunkSizeWarningLimit: 900,
  },
});
