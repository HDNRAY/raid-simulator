import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
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
/**
 * 列出 `src/` 下的 `.ts` 文件（相对项目根的路径，正斜杠）。
 *
 * ⚠️ 用 `fs` 而不是 `import.meta.glob`：这个测试在 vitest 的 node 环境里跑，
 * 不需要打包器参与（与 `PLACEHOLDER` 那几条扫描同一种做法）。
 */
function walkTs(dir: string): readonly string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = `${dir}/${entry.name}`;
    if (entry.isDirectory()) out.push(...walkTs(path));
    else if (entry.name.endsWith('.ts')) out.push(path);
  }
  return out;
}

/**
 * ⚠️ 用 `import.meta.url` 定位 `src/`，**不要**用相对 cwd 的 `'src'`：
 * 测试里踩过一次 —— `readdirSync('src')` 在某些跑法下拿到空数组（cwd 不是
 * 项目根），于是扫描"扫了 0 个文件"却**通过**了 ✗（假绿）。
 */
const PROJECT_ROOT = fileURLToPath(new URL('../../', import.meta.url));
const SRC_ROOT = `${PROJECT_ROOT}src`;

/**
 * 一个 TS 文件里**字符串字面量**的内容（去注释后扫 `'` / `"` / 反引号）。
 *
 * ⚠️ 正则而不是 TS AST：这里只回答"这行源码里有没有用引号包起来的中文标点"，
 * 不需要类型信息；而 AST 会把模板字符串的静态段与表达式拆开，反而更啰嗦。
 */
function stringLiteralsOf(file: string): readonly string[] {
  const source = readFileSync(file, 'utf8');
  /** 去掉注释（保留字符串），否则注释里的标点会被当成字面量。 */
  let code = '';
  for (let i = 0; i < source.length; i += 1) {
    const ch = source[i];
    if (ch === '/' && source[i + 1] === '/') {
      while (i < source.length && source[i] !== '\n') i += 1;
      code += '\n';
    } else if (ch === '/' && source[i + 1] === '*') {
      i += 2;
      while (i + 1 < source.length && !(source[i] === '*' && source[i + 1] === '/')) i += 1;
      i += 1;
    } else {
      code += ch;
    }
  }
  const out: string[] = [];
  for (const match of code.matchAll(/'((?:[^'\\]|\\.)*)'|"((?:[^"\\]|\\.)*)"/g)) {
    out.push(match[1] ?? match[2] ?? '');
  }
  return out;
}

/**
 * **I1 的补充：CJK 标点也是文案**（2026-10-20）。
 *
 * ⚠️ 为什么需要这一条：`raid/i18n/no-hardcoded-cjk` 的判据是**汉字 / 假名 /
 * 谚文**（`CJK_RE`），**不含中文标点**（`、，。：；！？` 在 U+3000–303F /
 * U+FF00–FFEF）。于是「用 `、` 拼列表」这种写法**能过 lint** —— 而它确实是
 * 文案的一部分（英文该是 `, `，间距也不同）。用户 2026-10-20："现在所有的
 * text 都确保用了 i18n 吧" ⇒ 这里用一次源码扫描把那个盲区补上。
 *
 * 允许的两处是**明账**（不是"顺手放过"）：
 *   - `render/theme.ts`：字体族列表（`楷体` 是系统字体名，不是给玩家看的字）
 *   - `ui/settings/wrapText.ts`：断行禁则的**标点集合**（排版规则，与语言无关的
 *     实现细节 —— 它就是"哪些符号不能出现在行首"的定义）
 */
describe('I1 补充 — 中文标点 / 全角符号也必须来自语言包', () => {
  /** 中文标点与全角符号（汉字本身由 ESLint 规则管，这里只管标点）。 */
  const PUNCT = /[\u3000-\u303f\uff01-\uff60]/;
  /** 允许出现 CJK 标点字面量的两个文件（明账，只会变短）。 */
  const ALLOWED = new Set(['src/render/theme.ts', 'src/ui/settings/wrapText.ts']);

  it('src/ 里除语言包 / 两处明账外，没有只含中文标点的字符串字面量', () => {
    const offenders: string[] = [];
    const files = walkTs(SRC_ROOT);
    /** 先断言"真的扫到了文件"——否则空数组会让下面恒等于 []（假绿）。 */
    expect(files.length).toBeGreaterThan(200);
    for (const abs of files) {
      const file = abs.slice(PROJECT_ROOT.length);
      if (file.includes('src/i18n/locales/')) continue;
      if (ALLOWED.has(file)) continue;
      for (const literal of stringLiteralsOf(abs)) {
        /** 只关心"没有汉字、但有中文标点"的那种（有汉字的已被 ESLint 拦）。 */
        if (PUNCT.test(literal) && !/[\u4e00-\u9fff]/.test(literal)) {
          offenders.push(`${file}: ${JSON.stringify(literal)}`);
        }
      }
    }
    expect(offenders, `这些字面量应该进 src/i18n/locales/：\n${offenders.join('\n')}`).toEqual(
      [],
    );
  });
});

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

    /**
     * ⚠️ **豁免：`src/i18n/locales/`**（用户决定）。
     *
     * 原话："locales 不限制行数"。
     *
     * 理由是**它是数据表，不是代码**：一个语言包就是"key → 文案"的
     * 平铺映射，按命名空间切开会带来**纯粹的间接层**（要跨文件找一个
     * 词、`flattenCatalog` 的遍历要跟、diff 会分散），而不会让任何人
     * 更容易读懂 —— §3 拆分的目的是"让人一次读得完一个单元"，
     * 而语言包的正确读法本来就是"搜 key"，不是"通读"。
     *
     * ⚠️ 豁免的**只有 locales**，其余照旧。判据放在这里而不是
     * `GRANDFATHERED`（那张表是"暂时超限"，这张是"永不适用"）。
     */
    const EXEMPT = /^src\/i18n\/locales\//;

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
        if (EXEMPT.test(file)) continue;
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

/**
 * ==================================================================
 * 测试**不许 import / 读 gitignore 的第三方素材**
 * ==================================================================
 *
 * 这一条防的是一个**本地全绿、CI 必红**的坑（真实发生过）：
 *
 *   `tests/web/spriteAssets.test.ts` 写了一句
 *   `import manifest from '../../public/fd2/rgba/manifest.json'` ——
 *   而 `public/fd2/`（54MB 第三方素材，汉堂 1995）是 **gitignore** 的，
 *   仓库里没有。本地有素材所以 `typecheck` / `test` / `build` 全过，
 *   推到 CI 上 `vite build` 直接挂：
 *   `TS2307: Cannot find module '.../manifest.json'`。
 *
 * ⚠️ **这条规则的判据比它曾经的样子更窄、也更严**（2026-10-13 用户拍板）：
 *   要求"素材不在就显式 skip"是**不够**的 —— 那等于承认"这个测试该读
 *   没进仓库的东西，只是这次读不到"。用户的判据是**根本不该读、也不该
 *   判断素材从哪来**（素材是第三方，`local 有 ≠ 仓库有`；单测不是素材的
 *   质检员）。所以现在只扫**静态 import**（编译期解析，文件不在必炸），
 *   而真正读素材的那几处断言是**整体删除**的 —— 见
 *   `tests/web/spriteAssets.test.ts` 文件头与 `src/render/portraitAssets.ts`
 *   顶部记的那两笔账（`tests/unit/preparePortraits.test.ts` 整个文件已删）。
 *
 * ⚠️ **为什么这条扫描仍然留着**：静态 import 是**编译期**的事，
 * 它不只让 test 红，还会让 CI 的 `vite build` 挂 —— 这是"本地绿、线上红"
 * 最容易复发的形状，值得一条机器检查盯着。
 */
describe('测试不许 import 被 gitignore 的素材', () => {
  it('tests/ 下没有指向 public/fd2 的静态 import', async () => {
    const { readFileSync, globSync } = await import('node:fs');
    /** 静态 import / require 一个 public/fd2 下的路径。 */
    const badImport = /(?:from\s*|require\(\s*)['"][^'"]*public\/fd2\/[^'"]*['"]/g;
    const offenders: string[] = [];

    for (const file of globSync('tests/**/*.{ts,tsx,mts,cts}')) {
      if (file.endsWith('lintRules.test.ts')) continue;
      const content = readFileSync(file, 'utf8');
      for (const m of content.matchAll(badImport)) offenders.push(`${file}: ${m[0]}`);
    }

    expect(
      offenders,
      `这些静态 import 会在没有素材的 CI 上让 build 失败（public/fd2 是 gitignore 的）：\n` +
        `删掉对素材的依赖（单测不该读不进仓库的素材），不要改成"素材在才跑"。\n${offenders.join('\n')}`,
    ).toEqual([]);
  });
});

/**
 * AGENTS.md §2：**滑块几何只能有一份**（去重）。
 *
 * ------------------------------------------------------------------
 * 它防的是什么（这不是"为了整洁"）
 * ------------------------------------------------------------------
 *
 * 2026-10-13 用户报的"**滚动内容 滚动条没动**"，根因是详情区把
 * `scrollThumbRatio(count, rows)` 的两个参数**写反**（传的是
 * `(视口, 内容)`）：它恒返回 `1` ⇒ 滑块长度 = 整条轨道 ⇒
 * `(轨道 − 滑块)` 恒为 0 ⇒ 滑块永远贴顶端。
 *
 * 修好之后场上却成了**两份**实现（备战屏卡片区 `sectionScrollbar`、
 * 详情区 `detailScrollThumb`），而且**参数顺序不同** —— 两份都"对"，
 * 下一个人抄错一次就又回来。所以两处都并到了
 * `src/ui/scrollWindow.ts`：**像素**那份是
 * `scrollBarGeometry({ viewportPx, maxScrollPx, scrollPx, trackLenPx,
 * minLengthPx })`（入参具名 —— 那串同型 number 没法再静默传反），
 * 而 `scrollThumbRatio` 退成它内部用的**按行**比例。
 *
 * ------------------------------------------------------------------
 * 为什么必须有这条扫描（`scrollBarGeometry` 的注释拦不住抄写）
 * ------------------------------------------------------------------
 *
 * `src/ui/logReview.ts` 有一个**很自然**的诱惑：它是一个"转发
 * `scrollWindow` 那族数学"的模块，谁想再写一条滚动条，顺手就
 * `import { scrollThumbRatio } from './logReview'`，自己乘轨道长 ——
 * 于是**第二份滑块几何**在没人注意的地方长出来。"只有一处"这件事
 * **必须由机器守**，不能靠下一个人记得（本仓库 §1 的 `as any` 扫描、
 * `process` 扫描都是同一个判据）。
 *
 * ⚠️ 为什么钉的是 `scrollThumbRatio` 而不是 `scrollFraction`：
 * 前者**只有**"把内容/视口换成滑块长度比例"这一个含义，别处出现就
 * 一定是第二份几何；而 `scrollFraction` 是通用的"偏移 → 0..1 进度"，
 * 还有与滚动条无关的正当用途（`LogReviewPanel.pointerRatio` 拿它给
 * 验证脚本反推指针点在第几行）。钉后者会误报，钉前者够用 —— 而
 * "滑块贴在顶端不动"那个 bug 的入口正是前者。
 */
describe('AGENTS.md §2：滑块几何只有 scrollWindow 一份', () => {
  it('src/ 下没有第二处自己算滑块长度比例的模块', async () => {
    const { readFileSync, globSync } = await import('node:fs');

    /**
     * 只有它**允许**算滑块长度比例（`scrollBarGeometry` 的家）。
     * 其余模块一律只许 import `scrollBarGeometry` 的结果。
     */
    const HOME = 'src/ui/scrollWindow.ts';

    /**
     * ⚠️ **允许例外**：单位是"行"的两条滚动条（复盘整屏 / 设置页技能详情）。
     *
     * 它们**不是**这次出 bug 的那条像素几何，而且结构上不同：
     *
     * ```
     *   像素（出过 bug）  内容 = 视口 + maxScrollPx；滑块长 = 视口/内容 × 轨道
     *   行（这两条）      滑块长 = 行数比例 × 轨道；设置页的"一屏几行"来自
     *                     另一个行高（LINE_H），与轨道高**不是**同一个数
     *                     （直接改走像素那份会改变行为，见 AGENTS.md §3：
     *                      这一轮只做搬家，不许"顺手改得更合理"）
     * ```
     *
     * 它们留在原处是**明账**：新增一处、或这两个文件里再长出一条，都会因为
     * 不在这张表里而红。这张表只会**变短**（等哪天行 / 像素两套真能合成
     * 同一个具名入参，就把对应条目删掉）。
     */
    /** ⚠️ **2026-10-22 起为空**：两条行式滚动条已改用共用画笔（只许变短）。 */
    const ROW_BASED_ALLOWED: readonly string[] = [];

    /**
     * 剥掉注释**和字符串字面量**（与 §1 的扫描同一做法）：
     * 这一条防线会在注释里被**引用**（"别处不许再算…"），那不是违规；
     * 而 import 路径是字符串，剥掉之后 `from './scrollWindow'` 那种
     * 形式自然不匹配（`from` 后没有括号调用）—— 只有真实调用留下。
     */
    function stripCommentsAndStrings(source: string): string {
      const blank = (m: string): string => m.replace(/[^\n]/g, ' ');
      return source
        .replace(/\/\*[\s\S]*?\*\//g, blank)
        .replace(/\/\/[^\n]*/g, blank)
        .replace(/'(?:[^'\\\n]|\\.)*'/g, blank)
        .replace(/"(?:[^"\\\n]|\\.)*"/g, blank)
        .replace(/`(?:[^`\\]|\\.)*`/g, blank);
    }

    /** 把"内容/视口"换成滑块长度比例 —— 只许 `scrollWindow` 自己调。 */
    const THUMB_RATIO = /\bscrollThumbRatio\s*\(/;
    const offenders: string[] = [];

    for (const file of globSync('src/**/*.{ts,tsx,mts,cts}')) {
      if (file === HOME || ROW_BASED_ALLOWED.includes(file)) continue;
      const lines = stripCommentsAndStrings(readFileSync(file, 'utf8')).split('\n');
      lines.forEach((line, i) => {
        if (THUMB_RATIO.test(line)) {
          offenders.push(`${file}:${i + 1} → ${line.trim().slice(0, 90)}`);
        }
      });
    }

    expect(
      offenders,
      `src/ 下出现了第二处滑块几何。按 AGENTS.md §2：把偏移换成滑块几何只有一份 ——\n` +
        `    像素：scrollWindow.scrollBarGeometry({ viewportPx, maxScrollPx, scrollPx, trackLenPx })\n` +
        `确实需要另开一处时，请在 \`ROW_BASED_ALLOWED\` 里写明"为什么它与像素那份不是同一件事"。\n` +
        offenders.join('\n'),
    ).toEqual([]);

    /**
     * ⚠️ 反向验证：**两处像素调用点真的走了入参具名的那一份**。
     *
     * 只扫"没人再调 `scrollThumbRatio`"不够 —— 谁把调用点改回自己乘一个
     * `view.viewPx / view.countPx`（不经过那个函数名）也照样是第二份几何。
     * 这里钉住"调用点确实在调它"，于是"把唯一那份删掉"这条路也会红。
     */
    /**
     * ⚠️ 2026-10-22：**"画"也收成了共用的一份**（`ui/scrollBarPaint.paintScrollBar`）——
     * 图鉴 / 备战详情 / 设置页技能详情都走它，所以"像素调用点"从
     * "各处自己画"变成了这两处：卡片区（`prepareCardGrid`，它算轨道位置）+
     * 那个共用画笔（`scrollBarPaint`，它调 `scrollBarGeometry`）。
     * `prepareDetailViewport` 已改成调 `paintScrollBar`，不再自己算 ✓。
     */
    const PIXEL_CALLERS: readonly string[] = [
      'src/ui/prepareCardGrid.ts',
      'src/ui/scrollBarPaint.ts',
    ];
    const missing = PIXEL_CALLERS.filter(
      (file) => !readFileSync(file, 'utf8').includes('scrollBarGeometry('),
    );

    expect(
      missing,
      `这些像素滚动条的调用点没有走 scrollWindow.scrollBarGeometry：\n${missing.join('\n')}`,
    ).toEqual([]);
  });
});


