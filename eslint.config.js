import tsParser from '@typescript-eslint/parser';
import raidPlugin from './tools/eslint-plugin-raid/index.js';

/**
 * ESLint flat config。
 *
 * 这里的规则不是风格偏好，而是**架构规范 §2.1 的硬约束**：
 *   C1  core/ 不许 import pixi / DOM / UI
 *   C2  core/ 不许用非确定性来源（Math.random / Date.now / performance.now）
 *   C3  渲染层只许依赖 core 的公开快照类型
 *   C4  core/ 不许出现异步
 *   C5  core/ 状态必须可结构化克隆
 *   I1  src/ 不许硬编码中日韩文字
 *   I2  只有 i18n/locales 是 I1 的白名单
 *   I3  core/ 与 data/ 不许 import i18n
 *
 * 违反任何一条都是**构建失败**，不是"建议"。
 */
/**
 * 反向用例静音开关。
 *
 * 常规 lint 需要 fixture 通过，但 tests/unit/lintRules.test.ts 要证明
 * "规则本身会报错"，所以用环境变量在测试里把它关掉。
 * 这是唯一能让两边同时成立的做法 ——
 * 试过 `overrideConfig`，但那个模式下配置里的相对 `files` 通配符匹配不上，
 * 会导致测试假通过（详见 tests/unit/lintRules.test.ts 的注释）。
 */
const SILENCE_FIXTURES = process.env.RAID_LINT_FIXTURES !== '1';

export default [
  {
    ignores: [
      'dist/**',
      'node_modules/**',
      '.pnpm-store/**',
      'coverage/**',
      'docs/**',
      'tools/verify-e2e.mjs',
    ],
  },

  /* ---------- 全局基础 ---------- */
  {
    files: ['**/*.ts', '**/*.js', '**/*.mjs'],
    languageOptions: {
      // 只需要解析器，不需要类型感知规则：
      // 类型正确性由 `pnpm run typecheck`（tsc）负责，这里只管架构与 i18n 约束。
      parser: tsParser,
      ecmaVersion: 2023,
      sourceType: 'module',
      parserOptions: {
        ecmaFeatures: { jsx: false },
      },
    },
    plugins: { raid: raidPlugin },
    rules: {
      // I1：src/ 下不许硬编码中文（例外见下）
      'raid/i18n/no-hardcoded-cjk': 'error',

      'no-debugger': 'error',
      'no-var': 'error',
      'prefer-const': 'error',
      eqeqeq: ['error', 'always', { null: 'ignore' }],
      'no-throw-literal': 'error',
      'no-unused-private-class-members': 'error',
    },
  },

  /* ---------- I2：i18n 语言包是 CJK 的唯一白名单 ---------- */
  {
    files: ['src/i18n/locales/**/*.ts'],
    rules: {
      'raid/i18n/no-hardcoded-cjk': 'off',
    },
  },

  /* ---------- core/：最严的一层 ---------- */
  {
    files: ['src/core/**/*.ts'],
    rules: {
      'raid/core/no-forbidden-imports': 'error',
      'raid/core/no-nondeterminism': 'error',
      'raid/core/no-dom-globals': 'error',
      'raid/core/no-async': 'error',
      'raid/core/no-non-cloneable': 'error',
    },
  },

  /* ---------- fixture：core/ 那几条约束（路径需显式匹配） ---------- */
  {
    files: ['tools/lint-fixtures/src/core/**/*.ts'],
    rules: {
      'raid/core/no-forbidden-imports': 'error',
      'raid/core/no-nondeterminism': 'error',
      'raid/core/no-dom-globals': 'error',
      'raid/core/no-async': 'error',
      'raid/core/no-non-cloneable': 'error',
    },
  },

  /* ---------- fixture：渲染层越界依赖 ---------- */
  {
    files: ['tools/lint-fixtures/src/render/**/*.ts'],
    rules: {
      'raid/render/no-core-internals': 'error',
    },
  },

  /* ---------- fixture：i18n 白名单（I2） ---------- */
  {
    files: ['tools/lint-fixtures/src/i18n/locales/**/*.ts'],
    rules: {
      'raid/i18n/no-hardcoded-cjk': 'off',
    },
  },

  /* ---------- data/：纯数据，不许有逻辑，也不许碰文案 ---------- */
  {
    files: ['src/data/**/*.ts'],
    rules: {
      'raid/core/no-forbidden-imports': 'error',
      'raid/core/no-nondeterminism': 'error',
    },
  },

  /* ---------- render/ 与 ui/：只许依赖 core 的公开面（C3） ---------- */
  {
    files: ['src/render/**/*.ts', 'src/ui/**/*.ts'],
    rules: {
      'raid/render/no-core-internals': 'error',
    },
  },

  /*
   * lint 反向用例（tools/lint-fixtures/）。
   *
   * 这些文件**故意**违反架构约束，用来证明规则真的会报错
   * （见 tests/unit/lintRules.test.ts）。
   *
   * 注意这里必须为每种约束**单独写一条 files 精确匹配**：
   * `src/core/**\/*.ts` 这类模式匹配不到 `tools/lint-fixtures/src/core/` 下的文件
   * —— config 的匹配基准在项目根，fixture 嵌在 tools/lint-fixtures/ 下，前缀对不上。
   * 这个坑害我在测试里绕了很久，所以写在这里。
   *
   * 常规 `eslint .` 时用 override 静音（否则永远失败）；
   * 测试用 RAID_LINT_FIXTURES=1 关掉静音，让上面的规则配置直接生效。
   */
  ...(SILENCE_FIXTURES
    ? [
        {
          name: 'raid/lint-fixtures-silence',
          files: ['tools/lint-fixtures/**/*.ts'],
          rules: {
            'raid/core/no-forbidden-imports': 'off',
            'raid/core/no-nondeterminism': 'off',
            'raid/core/no-dom-globals': 'off',
            'raid/core/no-async': 'off',
            'raid/core/no-non-cloneable': 'off',
            'raid/render/no-core-internals': 'off',
            'raid/i18n/no-hardcoded-cjk': 'off',
          },
        },
      ]
    : []),

  /* ---------- 测试与工具脚本可以放宽 ---------- */
  {
    files: ['tests/**/*.ts', 'tools/**/*.js', 'tools/**/*.mjs'],
    rules: {
      'raid/i18n/no-hardcoded-cjk': 'off',
    },
  },
];
