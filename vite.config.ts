import { defineConfig } from 'vite';

export default defineConfig(({ command }) => ({
  /**
   * 发布子路径必须与 GitHub Pages 的 target-directory 一致（架构规范 §9.2）。
   * 线上地址：https://hdnray.github.io/raid/
   * 本地 dev 用 '/'。
   */
  base: command === 'serve' ? '/' : '/raid/',

  build: {
    outDir: 'dist',
    target: 'es2023',
    sourcemap: true,
    // 逻辑分辨率是 960x540 的像素画，资源不需要 Vite 做 base64 内联
    assetsInlineLimit: 0,
  },

  worker: {
    // core/ 跑在 worker 里（架构规范 §2.2），用 ES module 格式
    format: 'es',
  },

  server: {
    // 刻意避开 Vite 默认的 5173：本机常驻的其他项目（如 bdgame）会占着它。
    port: 5273,
    // 端口被占时直接失败，不静默换端口 —— 否则容易看错页面。
    strictPort: true,
  },
}));
