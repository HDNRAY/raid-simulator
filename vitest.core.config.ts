import { defineProject } from 'vitest/config';

/**
 * 纯逻辑测试 project。
 *
 * **这个 project 里不允许出现任何 DOM / Pixi / 浏览器 API。**
 * 它是架构规范 §2.1 的 C1 约束最直接的证据：
 * 如果 core/ 偷偷依赖了浏览器，这个 project 会直接崩。
 */
export default defineProject({
  test: {
    name: 'core',
    environment: 'node',
    include: ['tests/unit/**/*.test.ts', 'tests/golden/**/*.test.ts'],
    globals: false,
  },
});
