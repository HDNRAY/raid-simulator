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

  it('【关键】src/ 里没有 `process` —— 浏览器里它不存在', async () => {
    /**
     * ================================================================
     * 为什么要有这条
     * ================================================================
     *
     * 我在 `triggers.ts` 里留了一句临时调试日志
     * `if (process.env.DBG) console.log(...)`，**忘了删**。
     *
     * 它**过了所有自动检查**：
     *   - `tsc` 通过（有 `@types/node`，`process` 有类型）
     *   - 711 个单测通过（**vitest 跑在 Node 里，`process` 存在**）
     *   - Vite dev 也正常（dev 环境有 `process` 兜底）
     *
     * 只有**浏览器里的生产代码**会崩：
     *   `Uncaught ReferenceError: process is not defined`
     *   → 之后**每一次受伤结算都抛异常**，战斗直接废掉。
     *
     * 是用户实测「色欲」时发现的。这类"只在真实运行环境炸"的问题
     * 必须由**这种源码扫描**兜住，测试跑在 Node 里天然看不见。
     *
     * ⚠️ 只扫 `src/`：`tests/` 与 `tools/` 本来就跑在 Node 里，
     * `process.env` 在那里是**正确用法**。
     */
    const { readFileSync, globSync } = await import('node:fs');
    const offenders: string[] = [];
    for (const file of globSync('src/**/*.{ts,tsx,mts,cts}')) {
      const code = stripCommentsAndStrings(readFileSync(file, 'utf8'));
      code.split('\n').forEach((line, i) => {
        /** ⚠️ 匹配真实的 `process.xxx` 用法，不匹配注释与字符串里的提及。 */
        if (/\bprocess\./.test(line)) {
          offenders.push(`${file}:${i + 1} → ${line.trim().slice(0, 80)}`);
        }
      });
    }
    expect(
      offenders,
      `src/ 里出现 \`process\`（浏览器不存在，会抛 ReferenceError）：\n${offenders.join('\n')}`,
    ).toEqual([]);
  });

  it('单文件不超过 700 行（已超限的走棘轮：不许再变大）', async () => {
    const { readFileSync, globSync } = await import('node:fs');

    /** 行数上限（AGENTS.md §3）。 */
    const LIMIT = 700;

    /**
     * 规则生效时**已经**超限的文件 —— 它们不因规则生效而变小，
     * 所以记录当时的行数当"天花板"，只要求**不再变大**。
     *
     * 这是棘轮（ratchet）：既让规则立刻可执行，又不需要为了过测试
     * 去做一次大重构（那正是 AGENTS.md §3 说要先问用户的事）。
     * 拆小之后请把对应条目从这张表里删掉。
     */
    /**
     * ⚠️ 口径是 `content.split('\n').length`（末行没有换行符时比 `wc -l` 多 1）
     *
     * **当前为空** —— 所有文件都在 700 行以内。
     * ✅ 已移除的条目（棘轮只往一个方向转）：
     *   - `src/render/BattleScene.ts`（1421 → 669）
     *   - `src/core/types.ts`（973 → 拆成 `core/types/` 目录，13 个文件
     *     各 21–162 行）
     *
     * 保留这张空表是因为它**将来还会用到**：真出现拆不动的大文件时，
     * 按 AGENTS.md §3 的流程登记天花板，而不是去删注释。
     */
    const GRANDFATHERED: Record<string, number> = {};

    const overLimit: string[] = [];
    const ratchetBreaks: string[] = [];

    for (const root of ['src', 'tests', 'tools']) {
      let files: string[] = [];
      try {
        files = globSync(`${root}/**/*.{ts,tsx,mts,cts,mjs}`);
      } catch {
        continue;
      }
      for (const file of files) {
        const lines = readFileSync(file, 'utf8').split('\n').length;
        const ceiling = GRANDFATHERED[file];
        if (ceiling === undefined) {
          if (lines > LIMIT) overLimit.push(`${file} = ${lines} 行`);
        } else if (lines > ceiling) {
          ratchetBreaks.push(`${file} = ${lines} 行（天花板 ${ceiling}）`);
        }
      }
    }

    expect(
      overLimit,
      `以下文件超过 ${LIMIT} 行。按 AGENTS.md §3：**先问用户是否立刻拆分**，\n` +
        `要拆就拆、并同步上面的 GRANDFATHERED 表；不拆也请把行数登记进去。\n` +
        overLimit.join('\n'),
    ).toEqual([]);

    expect(
      ratchetBreaks,
      `以下文件已经超过 ${LIMIT} 行，这次改动还让它变得更大了。\n` +
        `按 AGENTS.md §3：**先问用户是否立刻拆分**。\n` +
        ratchetBreaks.join('\n'),
    ).toEqual([]);
  });

  it('扫描范围不是空的（防止路径写错导致假通过）', async () => {
    const { globSync } = await import('node:fs');
    let total = 0;
    for (const root of ROOTS) total += globSync(`${root}/**/*.ts`).length;
    // 本仓库现在有 100+ 个 ts 文件；给一个宽松但有意义的下限
    expect(total).toBeGreaterThan(50);
  });
});

/**
 * ==================================================================
 * 取词函数的形状：**不许收窄成"只收 key"**
 * ==================================================================
 *
 * 这一条防的是一个**编译器不会报的 bug**（真实发生过，用户报告）：
 *
 *   设置页里技能的**代价与冷却全没了**；修好取数之后，界面上显示的
 *   是 `{value} {resource}` / `{seconds}` 这些**占位符本身**。
 *
 * 两层根因，第二层才是难查的那个：
 *
 *   1. `main.ts` 写成 `(key) => translator.t(key)` —— 手工丢了 `params`
 *   2. **`SettingsPanelOptions.translate` 的类型是 `(key: string) => string`**
 *      → "丢参数"不是失误，而是**类型系统认可的写法**。TS 允许
 *      "参数更少的函数"赋值给"参数更多的类型"（为了 `map(parseInt)`
 *      那类场景），于是它一路静默：**typecheck / eslint / 单测全绿**。
 *
 * 所以收窄的类型不是安全网，是帮凶。形状只该有一个：`TranslateFn`。
 */
describe('取词函数：不许用"只收一个参数"的类型', () => {
  it('没有任何 `translate` 字段被声明成 `(key) => string`', async () => {
    const { readFileSync, globSync } = await import('node:fs');
    const ROOTS = ['src', 'tests', 'tools'];
    /** 匹配 `translate: (…) => string` 这种内联函数类型。 */
    const inlineFnType = /translate\s*:\s*\(([^)]*)\)\s*=>\s*string/g;
    const offenders: string[] = [];

    for (const root of ROOTS) {
      for (const file of globSync(`${root}/**/*.ts`)) {
        /**
         * ⚠️ **跳过本文件自身**：下面这条正则的字面量就写在这里，
         * 不跳过会把自己也扫成违规（假失败）。
         * 只跳这一个文件，`tests/` 下别处照样扫。
         */
        if (file.endsWith('lintRules.test.ts')) continue;
        const content = readFileSync(file, 'utf8');
        for (const m of content.matchAll(inlineFnType)) {
          const params = m[1] ?? '';
          /**
           * ⚠️ 判定只看**参数个数**：一个参数 = 必然丢掉 `params`。
           * 两个及以上（或引用 `TranslateFn`）都算合格 ——
           * 后者不会被这条正则匹配到，因为它不是内联函数类型。
           */
          if (!params.includes(',')) {
            offenders.push(`${file}: translate: (${params}) => string`);
          }
        }
      }
    }

    expect(
      offenders,
      `这些 translate 形状会静默丢掉 params，界面上会显示 {占位符} 本身：\n${offenders.join('\n')}`,
    ).toEqual([]);
  });
});
