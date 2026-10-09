import { ESLint } from 'eslint';
import { describe, expect, it, beforeAll } from 'vitest';

/**
 * lint 规则的反向用例测试。
 *
 * **不实测的 lint 规则等于没写。** 这些规则是架构规范 §2.1 的硬约束
 * （C1–C5、I1–I3）唯一的技术保障，所以必须证明它们**真的会报错**，
 * 而不只是"配置看起来对"。
 *
 * 用例在 tools/lint-fixtures/ 下，每个文件对应一条或几条约束。
 * 注意：反向用例文件是**故意**违规的，不要"修好"它们。
 */

const FIXTURES = 'tools/lint-fixtures';


interface FileResult {
  readonly messages: ReadonlyArray<{ ruleId: string | null; line: number; message: string }>;
  readonly errorCount: number;
}

/**
 * 让 ESLint 用"未静音"的配置加载。
 *
 * 踩过的坑记录在这里，避免以后有人再走一遍：
 *   1. `overrideConfig` + `lintText`：配置里的**相对** `files` 通配符
 *      （如 'src/core/**\/*.ts'）匹配不到，core/ 的规则全变成 undefined，
 *      测试会**假通过** —— 用 calculateConfigForFile 才查到这一点。
 *   2. `overrideConfig` 且自动加载配置文件：raid 插件被注册两次，
 *      报 "Cannot redefine plugin"。
 * 所以最终走"环境变量 + 正常加载配置文件"这条路 —— 规则解析一切照旧。
 */
process.env.RAID_LINT_FIXTURES = '1';

async function lintFixtures(): Promise<Map<string, FileResult>> {
  const eslint = new ESLint({ cwd: process.cwd() });
  const results = await eslint.lintFiles([`${FIXTURES}/**/*.ts`]);

const map = new Map<string, FileResult>();
  for (const r of results) {
    const rel = r.filePath.slice(r.filePath.indexOf(FIXTURES));
    map.set(rel, {
      messages: r.messages.map((m) => ({
        ruleId: m.ruleId,
        line: m.line,
        message: m.message,
      })),
      errorCount: r.errorCount,
    });
  }
  return map;
}

/** 某个文件命中了指定规则几次。 */
function hits(result: FileResult | undefined, ruleId: string): number {
  return result?.messages.filter((m) => m.ruleId === ruleId).length ?? 0;
}

describe('架构约束的反向用例（lint 规则真的生效）', () => {
  let results: Map<string, FileResult>;

  beforeAll(async () => {
    results = await lintFixtures();
  });

  it('取到了全部用例文件（防止路径写错导致空跑通过）', () => {
    const names = [...results.keys()].sort();
    expect(names).toEqual([
      'tools/lint-fixtures/src/core/clean.ts',
      'tools/lint-fixtures/src/core/violations.ts',
      'tools/lint-fixtures/src/i18n/locales/zh-CN.ts',
      'tools/lint-fixtures/src/render/bad.ts',
      'tools/lint-fixtures/src/render/console.ts',
      'tools/lint-fixtures/src/render/text.ts',
    ]);
  });

  describe('C1 — core/ 不许依赖渲染层 / UI / i18n', () => {
    it('拦住 pixi.js', () => {
      expect(hits(results.get('tools/lint-fixtures/src/core/violations.ts'), 'raid/core/no-forbidden-imports')).toBeGreaterThanOrEqual(2);
    });
  });

  describe('C2 — core/ 不许有非确定性来源', () => {
    it('拦住 Math.random 与 Date.now', () => {
      const r = results.get('tools/lint-fixtures/src/core/violations.ts');
      // 两处：Math.random 与 Date.now
      expect(hits(r, 'raid/core/no-nondeterminism')).toBe(2);
    });
  });

  describe('C1/C2 — core/ 不许引用 DOM 全局', () => {
    it('拦住 document 与 window', () => {
      const r = results.get('tools/lint-fixtures/src/core/violations.ts');
      expect(hits(r, 'raid/core/no-dom-globals')).toBe(2);
    });
  });

  describe('C4 — core/ 不许出现异步', () => {
    it('拦住 async function 与 await', () => {
      const r = results.get('tools/lint-fixtures/src/core/violations.ts');
      expect(hits(r, 'raid/core/no-async')).toBe(2);
    });
  });

  describe('C5 — core/ 不许出现不可克隆的容器', () => {
    it('拦住 new Map()', () => {
      const r = results.get('tools/lint-fixtures/src/core/violations.ts');
      expect(hits(r, 'raid/core/no-non-cloneable')).toBe(1);
    });
  });

  describe('C3 — 渲染层不许依赖 core 内部', () => {
    it('拦住 import core/worker', () => {
      const r = results.get('tools/lint-fixtures/src/render/bad.ts');
      expect(hits(r, 'raid/render/no-core-internals')).toBe(1);
    });
  });

  describe('I1 — src/ 不许硬编码中日韩文字', () => {
    it('拦住普通字符串与模板字符串里的中文', () => {
      const r = results.get('tools/lint-fixtures/src/render/text.ts');
      // '生命值' + 模板字符串里的两段
      expect(hits(r, 'raid/i18n/no-hardcoded-cjk')).toBeGreaterThanOrEqual(3);
    });
  });

  describe('白名单必须真的放行（否则规则会被绕过而失去意义）', () => {
    it('core/ 的合规写法零报错', () => {
      expect(results.get('tools/lint-fixtures/src/core/clean.ts')?.errorCount).toBe(0);
    });

    it('i18n/locales 里的中文零报错（I2 白名单）', () => {
      expect(results.get('tools/lint-fixtures/src/i18n/locales/zh-CN.ts')?.errorCount).toBe(0);
    });

    it('console.* 里的中文零报错（I1 的窄例外）', () => {
      expect(results.get('tools/lint-fixtures/src/render/console.ts')?.errorCount).toBe(0);
    });
  });
});
