import { defineConfig } from 'vitest/config';

/**
 * 测试分成两个 project，这是架构规范 §4 的结构化落地：
 *
 *   core  —— 纯逻辑测试。environment: 'node'，不加载任何 DOM，
 *            证明 core/ 真的零依赖（C1 约束的可执行证据）。
 *   web   —— 渲染层测试。需要 DOM 环境，允许 import pixi。
 *
 * 命令行按 project 过滤：
 *   pnpm run test:core     # 只跑纯逻辑，秒级，不碰浏览器
 *   pnpm run test          # 全部
 */
export default defineConfig({
  test: {
    projects: ['vitest.core.config.ts', 'vitest.web.config.ts'],
  },
});
