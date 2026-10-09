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

/**
 * AGENTS.md §1：禁止 `as any` 与 `as unknown as`。
 *
 * ------------------------------------------------------------------
 * 为什么用源码扫描而不是 ESLint 规则
 * ------------------------------------------------------------------
 *
 * 这两条是**纯语法**层面的禁令，不需要类型信息，所以正则在语义上
 * 就够准了（`as any` / `as unknown as` 都是固定字面串）。
 * 走 ESLint 反而要多写一条自定义规则 + fixture，收益不划算。
 *
 * ⚠️ 扫描范围必须包含 `tests/` 和 `tools/` —— 违规最常出现在测试里
 * （"构造一个非法输入"），只扫 `src/` 会漏掉大多数。
 */
describe('AGENTS.md 硬规则：禁止类型断言逃生舱', () => {
  /** 扫描的源码根目录 */
  const ROOTS = ['src', 'tests', 'tools'];

  /**
   * 匹配真实的断言用法，**不匹配注释里的提及**。
   *
   * 做法：逐行先剥掉注释（`//` 之后、`/* … *\/` 之内），再匹配。
   * 这样本文件与 `i18n.test.ts` 里"说明为什么不用它"的文字不会误报。
   */
  const BANNED: ReadonlyArray<{ name: string; re: RegExp }> = [
    { name: 'as any', re: /\bas\s+any\b/ },
    { name: 'as unknown as', re: /\bas\s+unknown\s+as\b/ },
  ];

  /**
   * 剥掉注释**和字符串字面量**。
   *
   * 两个都必须剥，否则会误报：
   *   - 注释：本文件与 `i18n.test.ts` 里会**提到**这两个写法（说明为什么禁用）
   *   - 字符串：上面 `BANNED` 的正则字面量、以及测试名里都有这两个词
   *
   * 保留换行，这样行号仍然对得上。
   */
  function stripCommentsAndStrings(source: string): string {
    const blank = (m: string): string => m.replace(/[^\n]/g, ' ');
    return source
      .replace(/\/\*[\s\S]*?\*\//g, blank)
      .replace(/\/\/[^\n]*/g, blank)
      // 单引号 / 双引号 / 模板串（不处理嵌套模板，本仓库用不到）
      .replace(/'(?:[^'\\\n]|\\.)*'/g, blank)
      .replace(/"(?:[^"\\\n]|\\.)*"/g, blank)
      .replace(/`(?:[^`\\]|\\.)*`/g, blank);
  }

  it('src/、tests/、tools/ 里没有 as any / as unknown as', async () => {
    const { readFileSync } = await import('node:fs');
    const { globSync } = await import('node:fs');
    const offenders: string[] = [];

    for (const root of ROOTS) {
      let files: string[] = [];
      try {
        files = globSync(`${root}/**/*.{ts,tsx,mts,cts}`);
      } catch {
        continue;
      }
      for (const file of files) {
        const raw = readFileSync(file, 'utf8');
        // 跳过本文件：它自己的正则/测试名就是那两个字符串
        if (file.endsWith('lintRules.test.ts')) continue;
        const code = stripCommentsAndStrings(raw);
        const lines = code.split('\n');
        lines.forEach((line, i) => {
          for (const { name, re } of BANNED) {
            if (re.test(line)) {
              // 找到原始行号（剥注释不改行数，所以 i 就是行号-1）
              offenders.push(`${file}:${i + 1} 用了 ${name} → ${line.trim().slice(0, 80)}`);
            }
          }
        });
      }
    }

    expect(offenders, `发现 ${offenders.length} 处违规：\n${offenders.join('\n')}`).toEqual([]);
  });

  it('扫描范围不是空的（防止路径写错导致假通过）', async () => {
    const { globSync } = await import('node:fs');
    let total = 0;
    for (const root of ROOTS) total += globSync(`${root}/**/*.ts`).length;
    // 本仓库现在有 100+ 个 ts 文件；给一个宽松但有意义的下限
    expect(total).toBeGreaterThan(50);
  });
});
