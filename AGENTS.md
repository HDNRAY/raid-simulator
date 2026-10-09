# AGENTS.md — 本仓库给 AI/协作者的硬规则

本文件是**强制**约定。与其它文档冲突时以本文件为准。

---

## 1. 类型断言：禁止 `as any` 与 `as unknown as`

**不允许**在仓库任何位置（`src/`、`tests/`、`tools/`）写：

```ts
value as any
value as unknown as T
```

### 为什么

这两个写法会**同时**关掉两件事：

1. **类型检查** —— 编译器不再校验这个值到底是不是 `T`
2. **代码审查的信号** —— 读到 `as unknown as` 时，人无法判断
   这是"我知道自己在做什么"还是"我懒得查类型"

它们最常见的用途是"让报错消失"，而不是"让代码正确"。
一旦出现，后续所有基于类型的重构都会在这几行上失效。

### 应该怎么写

按情况选一种，**都要把"为什么类型对不上"写出来**：

| 场景 | 做法 |
|---|---|
| 两个接口形状不同 | **写适配器函数**，显式声明两侧类型 |
| 运行期数据未经校验 | **写类型守卫**（`function isX(v: unknown): v is X`） |
| 测试要喂非法数据 | 写一个**有名字的解析器**（见下） |
| 第三方类型确实不对 | 在**调用处**用最小范围的 cast，并写明原因；优先考虑 `.d.ts` 补丁 |

### 示例：测试里要构造非法数据

不要写 `{ a: 1 } as unknown as typeof catalog`，而是：

```ts
/**
 * 把"故意构造的非法/残缺数据"交给被测量函数。
 *
 * ⚠️ 这不是绕过类型检查 —— 它把"这里确实是一份未经验证的数据"
 * 写在了名字上，而且只有这一处。
 */
function asCatalog(value: unknown): typeof zhCN {
  return value as typeof zhCN;
}
```

### 示例：两个接口事件形状不同

不要写 `listener as unknown as EventListener`，而是：

```ts
addEventListener: (type, listener) =>
  worker.addEventListener(type, (message: MessageEvent<FromWorker>) => {
    listener({ data: message.data });
    return undefined;
  }),
```

### 这条规则被违反时

`tests/unit/lintRules.test.ts` 里有一条源码扫描断言会失败
（同时扫描 `src/`、`tests/`、`tools/`）。注释里提到这两个写法不算违规
（只有**真实的断言用法**才拦），所以请不要把示例写进注释去试探规则。

---

## 2. 其它既有规则（简表）

详见 `docs/specs/2026-10-09-architecture.md`：

- `src/core/` **零依赖**、可在 Node 里跑；不许 `Math.random` / `Date.now`
  （随机数一律走 `BattleState.rngSeed`）
- 数据流单向：`Action[] → sim → Snapshot/EventDef[] → renderer`；
  渲染层**不许**反向调用 sim
- 渲染层不许硬编码可显示文案（i18n 规范 I1）
- 所有 UI 走 canvas（不用 DOM 元素）
- 时间只有两个刻度：物理 tick 60Hz、逻辑步 0.1 秒。
  用 `logicTicks()` / `logicMs()`，不许手写乘除
- 数值用 `S()` 包一层（`DISPLAY_SCALE = 1`），不要散落魔法数

---

## 3. 改动后的必跑流程

```
pnpm run typecheck   →   npx eslint .   →   pnpm run test:run
                     →   pnpm run build  →   node tools/verify-e2e.mjs
```

`verify-e2e.mjs` 需要开发服务器在 <http://localhost:5273/>。
若脚本挂住，先 `pkill -f "Google Chrome.*headless"`（残留的 headless
Chrome 会让它一直等）。
