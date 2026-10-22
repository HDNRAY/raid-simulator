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
    /**
     * **`pnpm run dev` 自动打开浏览器**（用户 2026-10-22："开发环境在 dev
     * 自动打开···build的时候自动关闭"）。
     *
     * ⚠️ 只管 **dev server**：`vite build` 本来就不开浏览器，而 `vite preview`
     * 是**另一个**开关（下面的 `preview.open: false`），两者互不影响 ——
     * 所以"build 时不要自动打开"这条是**天然**成立的，这里只是把它写死，
     * 免得以后有人顺手打开 `preview.open`。
     */
    open: true,
  },

  /**
   * `vite preview`（本地预览构建产物）**不**自动开浏览器。
   * 它是"看 build 结果"的工具，不该像 dev 那样抢焦点。
   */
  preview: {
    open: false,
  },
}));
