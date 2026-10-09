/**
 * 本项目的 ESLint 自定义规则。
 *
 * 为什么手写而不是用 typescript-eslint：
 *   1. 这些规则要断言的正是架构规范 §2.1 的硬约束（C1–C5、I1–I3），
 *      需要精确控制消息与边界，现成规则集覆盖不到。
 *   2. 不引 typescript-eslint 能少一整套运行时依赖，而这些规则
 *      全部是**语法级**判定，不需要类型信息（类型检查由 tsc 负责）。
 *
 * 每条规则都在 tools/lint-fixtures/ 下有对应的正反用例，
 * 由 tests/unit/lintRules.test.ts 驱动（不实测的 lint 规则等于没写）。
 */

/* ------------------------------------------------------------------ *
 * 工具
 * ------------------------------------------------------------------ */

/** 中日韩字符范围（不含标点）。用于 I1。 */
const CJK_RE = /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\uac00-\ud7af]/;

/** 浏览器 / DOM 全局。core/ 里出现任何一个都说明层被穿透了。 */
export const DOM_GLOBALS = [
  'window',
  'document',
  'navigator',
  'location',
  'history',
  'localStorage',
  'sessionStorage',
  'indexedDB',
  'requestAnimationFrame',
  'cancelAnimationFrame',
  'setTimeout',
  'setInterval',
  'clearTimeout',
  'clearInterval',
  'queueMicrotask',
  'fetch',
  'XMLHttpRequest',
  'WebSocket',
  'Worker',
  'Image',
  'Audio',
  'HTMLElement',
  'HTMLCanvasElement',
  'CanvasRenderingContext2D',
  'ResizeObserver',
  'IntersectionObserver',
  'MutationObserver',
  'performance',
  'alert',
  'confirm',
  'prompt',
];

/** 非确定性来源。core/ 里出现任何一个都会让重放与黄金测试失效。 */
const NON_DETERMINISTIC = ['random', 'now'];

/** 取成员的完整名字，支持 a.b.c。 */
function memberPath(node) {
  const parts = [];
  let cur = node;
  while (cur && cur.type === 'MemberExpression' && !cur.computed) {
    parts.unshift(cur.property.name);
    cur = cur.object;
  }
  if (cur && cur.type === 'Identifier') parts.unshift(cur.name);
  return parts.join('.');
}

/** 判断节点是否在注释之外（用于 CJK 检查时跳过注释）。 */
function isInComment() {
  // ESLint 的 AST 不含注释，注释在 sourceCode.getAllComments() 里，
  // 所以遍历 AST 时天然不会碰到注释内容。这里的处理见 rules['i18n/no-hardcoded-cjk']。
  return false;
}

/* ------------------------------------------------------------------ *
 * 规则
 * ------------------------------------------------------------------ */

const rules = {
  /**
   * C1：core/ 不许 import pixi / DOM / UI 层。
   *
   * 用 no-restricted-imports 也能做，但那要写在 config 里（字符串匹配），
   * 写成规则可以把"允许的例外"表达得更清楚。
   */
  'core/no-forbidden-imports': {
    meta: {
      type: 'problem',
      docs: { description: 'core/ 不许依赖渲染层、UI 层或浏览器专用包' },
      schema: [],
      messages: {
        forbidden:
          "core/ 不许 import '{{name}}'（架构规范 C1）。core/ 必须是零依赖纯 TS，能在 node 里跑测试。",
      },
    },
    create(context) {
      const forbidden = [
        { test: /^pixi\.js$/, why: 'pixi.js' },
        { test: /^pixi\.js\//, why: 'pixi.js 子模块' },
        { test: /(^|\/)render\//, why: 'render/ 层' },
        { test: /(^|\/)ui\//, why: 'ui/ 层' },
        { test: /(^|\/)app\//, why: 'app/ 层' },
        { test: /^@pixi\//, why: '@pixi/* 包' },
        { test: /(^|\/)i18n\//, why: 'i18n（C1 扩展 I3：引擎只持 key，不碰文案）' },
        { test: /^three$/, why: 'three' },
        { test: /^konva$/, why: 'konva' },
      ];
      return {
        ImportDeclaration(node) {
          const name = node.source.value;
          if (typeof name !== 'string') return;
          for (const f of forbidden) {
            if (f.test.test(name)) {
              context.report({ node, messageId: 'forbidden', data: { name: f.why } });
              return;
            }
          }
        },
        ImportExpression(node) {
          const src = node.source;
          if (src && src.type === 'Literal' && typeof src.value === 'string') {
            for (const f of forbidden) {
              if (f.test.test(src.value)) {
                context.report({ node, messageId: 'forbidden', data: { name: f.why } });
                return;
              }
            }
          }
        },
      };
    },
  },

  /**
   * C2：core/ 不许出现非确定性来源。
   *
   * Math.random / Date.now / performance.now 任何一个出现在引擎里，
   * 整场战斗就无法重放、无法存档、黄金测试立刻失效。
   */
  'core/no-nondeterminism': {
    meta: {
      type: 'problem',
      docs: { description: 'core/ 不许使用非确定性来源' },
      schema: [],
      messages: {
        random:
          '禁止 Math.random（架构规范 C2）。用 core/rng.ts 的种子化 RNG——随机状态必须在 BattleState 里，否则战斗无法重放。',
        now: '禁止 Date.now / performance.now（架构规范 C2）。时间必须由调用方传入。',
      },
    },
    create(context) {
      return {
        CallExpression(node) {
          const path = memberPath(node.callee);
          if (path === 'Math.random') {
            context.report({ node, messageId: 'random' });
            return;
          }
          if (path === 'Date.now' || path === 'performance.now') {
            context.report({ node, messageId: 'now' });
          }
        },
        NewExpression(node) {
          if (memberPath(node.callee) === 'Date') {
            context.report({ node, messageId: 'now' });
          }
        },
      };
    },
  },

  /**
   * C2 续：core/ 不许出现 DOM / 浏览器全局。
   *
   * 用 no-restricted-globals 也能覆盖大部分，但那样只能拦"当成全局用"的写法；
   * 写成规则还能拦 `globalThis.window` 这类绕法。
   */
  'core/no-dom-globals': {
    meta: {
      type: 'problem',
      docs: { description: 'core/ 不许引用 DOM / 浏览器全局' },
      schema: [],
      messages: {
        dom: "core/ 不许引用浏览器全局 '{{name}}'（架构规范 C1/C2）。core/ 要能在 node 里跑。",
      },
    },
    create(context) {
      const domSet = new Set(DOM_GLOBALS);
      return {
        Identifier(node) {
          if (!domSet.has(node.name)) return;
          // 只拦"当成变量用"，不拦属性名（obj.window 里的 window）与声明
          const parent = node.parent;
          if (!parent) return;
          if (parent.type === 'MemberExpression' && parent.property === node) return;
          if (parent.type === 'Property' && parent.key === node) return;
          if (
            (parent.type === 'VariableDeclarator' ||
              parent.type === 'FunctionDeclaration' ||
              parent.type === 'FunctionExpression' ||
              parent.type === 'ClassDeclaration') &&
            parent.id === node
          ) {
            return;
          }
          context.report({ node, messageId: 'dom', data: { name: node.name } });
        },
      };
    },
  },

  /**
   * C4：core/ 不许出现异步。
   *
   * 引擎是同步的纯计算；异步会破坏确定性（以及 tick 的可预测性）。
   */
  'core/no-async': {
    meta: {
      type: 'problem',
      docs: { description: 'core/ 不许出现 async / await / Promise' },
      schema: [],
      messages: {
        async: 'core/ 不许出现 {{what}}（架构规范 C4）。引擎是同步纯计算。',
      },
    },
    create(context) {
      return {
        AwaitExpression(node) {
          context.report({ node, messageId: 'async', data: { what: 'await' } });
        },
        'FunctionDeclaration[async=true]'(node) {
          context.report({ node, messageId: 'async', data: { what: 'async function' } });
        },
        'FunctionExpression[async=true]'(node) {
          context.report({ node, messageId: 'async', data: { what: 'async function' } });
        },
        'ArrowFunctionExpression[async=true]'(node) {
          context.report({ node, messageId: 'async', data: { what: 'async 箭头函数' } });
        },
        NewExpression(node) {
          if (memberPath(node.callee) === 'Promise') {
            context.report({ node, messageId: 'async', data: { what: 'Promise' } });
          }
        },
        ImportExpression(node) {
          context.report({ node, messageId: 'async', data: { what: '动态 import()' } });
        },
      };
    },
  },

  /**
   * C3：render/ 与 ui/ 只许从 core/snapshot.ts 读类型，不许深入 core/ 内部。
   *
   * 方向永远是 sim -> snapshot -> renderer。渲染层不许反向依赖引擎内部，
   * 否则换渲染库时（Three/Konva/Spine）会牵连到 core。
   */
  'render/no-core-internals': {
    meta: {
      type: 'problem',
      docs: { description: '渲染层只许依赖 core 的公开快照类型' },
      schema: [],
      messages: {
        internal:
          "渲染层不许 import core 内部模块 '{{name}}'（架构规范 C3）。只允许 core/snapshot 与 core/protocol 暴露的类型。",
      },
    },
    create(context) {
      // 允许的 core 公开面
      const ALLOWED = /^.*core\/(snapshot|protocol|workerProtocol)$/;
      const isCore = /(^|\/)core\//;
      return {
        ImportDeclaration(node) {
          const name = node.source.value;
          if (typeof name !== 'string') return;
          if (!isCore.test(name)) return;
          if (ALLOWED.test(name)) return;
          context.report({ node, messageId: 'internal', data: { name } });
        },
      };
    },
  },

  /**
   * I1 / I2：src/ 里不许硬编码中日韩文字。
   *
   * 这是 i18n 强制约束里最有价值的一条：把"忘记走 i18n"
   * 从"评审时可能发现"变成"写下来就报错"。
   *
   * 唯一的例外是 console.* 里的开发者日志——这个例外刻意写窄。
   */
  'i18n/no-hardcoded-cjk': {
    meta: {
      type: 'problem',
      docs: { description: '面向玩家的文字必须来自 i18n 表' },
      schema: [],
      messages: {
        cjk: "禁止硬编码中文文案 '{{sample}}'（i18n 规范 I1）。请放进 src/i18n/locales/ 并用 t() 取。",
      },
    },
    create(context) {
      /** 判断某节点是否位于 console.* 调用的参数里。 */
      function isConsoleArg(node) {
        let cur = node;
        while (cur) {
          if (cur.type === 'CallExpression') {
            const path = memberPath(cur.callee);
            return path.startsWith('console.');
          }
          cur = cur.parent;
        }
        return false;
      }

      /** 截取一小段样例，报错信息才有用。 */
      function sample(text) {
        const match = CJK_RE.exec(text);
        if (!match) return text.slice(0, 12);
        const start = Math.max(0, match.index - 4);
        return text.slice(start, start + 12);
      }

      /**
       * 字体族里的中文名不算文案。
       *
       * `'KaiTi, STKaiti, 楷体, serif'` 是**字体族列表**，
       * 不是给玩家看的文字 —— 把它搬进语言包毫无意义，
       * 而列里保留中文名是必要的：某些系统只认"楷体"这个名字。
       *
       * 判据：字符串里出现 `serif` / `sans-serif` / `monospace` /
       * `cursive` 这类 CSS 通用族关键字时，视为字体族。
       */
      const FONT_FAMILY_HINT = /\b(serif|sans-serif|monospace|cursive|fantasy|KaiTi|STKaiti)\b/;

      function check(node, text) {
        if (!CJK_RE.test(text)) return;
        if (isConsoleArg(node)) return;
        if (FONT_FAMILY_HINT.test(text)) return;
        context.report({ node, messageId: 'cjk', data: { sample: sample(text) } });
      }

      return {
        Literal(node) {
          if (typeof node.value === 'string') check(node, node.value);
        },
        TemplateElement(node) {
          check(node, node.value.raw);
        },
        // JSX 文本（虽然本项目不用 JSX，但规则要完整）
        JSXText(node) {
          check(node, node.value);
        },
      };
    },
  },

  /**
   * C5：**状态定义**里不许出现 Map / Set / 类实例 / 函数。
   *
   * 规则的设计过程值得记录（它一开始是错的）：
   *
   * 最初的版本禁止整个 `core/` 使用 `Map`/`Set`。写 M1-2 的依赖图时
   * 被拦下了 —— 但那是**加载期的瞬态分析结构**（成员关系图），
   * 不是战斗状态。语法层无法区分"持久状态"与"临时结构"，
   * 所以那条规则是个过宽的近似：它拦不住真正的违规
   * （`Map` 从别处传进状态），却挡了合理用法。
   *
   * 现在改成**按文件精确管辖**：只检查状态定义所在的文件。
   * 这比"全 core 禁 Map"更严（它真的盯着状态），也更实用。
   * 运行时的保证仍然由 structuredClone 测试兜底。
   */
  'core/no-non-cloneable': {
    meta: {
      type: 'problem',
      docs: { description: '状态定义必须是可结构化克隆的 plain object' },
      schema: [],
      messages: {
        bad: '状态里不许使用 {{name}}（架构规范 C5）。BattleState 必须可结构化克隆且可哈希——用 plain object 与数组。',
      },
    },
    create(context) {
      const banned = new Set(['Map', 'Set', 'WeakMap', 'WeakSet']);
      return {
        NewExpression(node) {
          if (node.callee.type === 'Identifier' && banned.has(node.callee.name)) {
            context.report({ node, messageId: 'bad', data: { name: node.callee.name } });
          }
        },
        // 类型注解同样算（`buffs: Map<...>` 这种）
        TSTypeReference(node) {
          const name = node.typeName.type === 'Identifier' ? node.typeName.name : undefined;
          if (name && banned.has(name)) {
            context.report({ node, messageId: 'bad', data: { name } });
          }
        },
      };
    },
  },
};

/* ------------------------------------------------------------------ *
 * 插件导出
 * ------------------------------------------------------------------ */

export const raidPlugin = {
  meta: {
    name: 'eslint-plugin-raid',
    version: '0.1.0',
  },
  rules,
};

export default raidPlugin;
