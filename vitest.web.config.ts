import { defineProject } from 'vitest/config';

/**
 * 渲染层 / UI 测试 project。
 *
 * 需要 DOM 环境（Pixi 的 Application 会碰 canvas API）。
 * 只包含 src/render 与 src/ui 的测试。
 *
 * 注意：本项目的核心验收全部在 core project 里。
 * 这个 project 只做冒烟测试（场景能构建、组件能挂载、不抛异常），
 * 因为它需要真实 WebGL / Canvas，CI 里的价值有限（架构规范 §4）。
 */
export default defineProject({
  test: {
    name: 'web',
    environment: 'jsdom',
    include: ['tests/web/**/*.test.ts'],
    globals: false,
  },
});
