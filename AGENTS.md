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

## 3. 单文件不超过 700 行

**一个文件不许超过 700 行**（`src/`、`tests/`、`tools/` 都算，空行与注释
也计入）。

### 超过时怎么办

**不要默默继续往上加，也不要自作主张立刻大改。**
先把情况说清楚，然后**问用户是否马上拆分**：

```
这个文件现在 N 行，已经超过 700 行的上限。
我这次改动会让它到 M 行。
要不要现在就开始拆分？（拆法建议：……）
```

用户说拆就拆；说不拆就继续做当前的事，但要在回复里提一句
"文件已超限、这次先不拆"。

### 为什么是"问"而不是"自动拆"

拆分是有代价的：它会动很多文件的边界、让 `git blame` 断代、
也可能引入循环引用。**在"正在改一个功能"的中间顺手重构整个文件，
是最容易把两件事都做砸的做法。**

所以规则是：**超限必须被指出，但拆不拆由用户决定。**

### 这条规则是**机器检查**的

`tests/unit/lintRules.test.ts` 里有一条断言在扫描行数，所以规则不会
只停留在文档里。

已超限的文件走**棘轮**（ratchet）：它们在 `GRANDFATHERED` 表里登记了
当前行数当"天花板"，规则只要求**不再变大**。

- 给这些文件加代码 → 测试失败 → 必须先问用户
- 把它们拆小 → 请把对应条目从表里删掉（棘轮只往一个方向转）

### 已超限的文件（基线）

规则生效时的情况（口径：`content.split('\n').length`，比 `wc -l` 多 1），
与测试里的 `GRANDFATHERED` 表必须一致：

| 文件 | 天花板 |
|---|---|
| `src/core/combat/battleState.ts` | 1580 |
| `src/core/types.ts` | 1091 |
| `src/ui/settings/SettingsPanel.ts` | 938 |

✅ 已拆到 700 以下、**从表里移除**的：
`src/render/BattleScene.ts`（1421 → **668**，拆成
`skillBar` / `IconStrip` / `FloatingTextLayer` / `background` /
`sceneTypes` / `hudUtils` / `actorLayout` + `parts/` 下 7 个帧部件）。

改这些文件时**必然触线**，所以每次都要走上面的"问一句"流程。

---

## 4. 改动后的必跑流程

```
pnpm run typecheck   →   npx eslint .   →   pnpm run test:run
                     →   pnpm run build  →   node tools/verify-e2e.mjs
```

`verify-e2e.mjs` 需要开发服务器在 <http://localhost:5273/>。
若脚本挂住，先 `pkill -f "Google Chrome.*headless"`（残留的 headless
Chrome 会让它一直等）。

### ⚠️ e2e 不必每次改动都跑

**e2e 固定要 ~22 秒**（Chrome 启动 + 游戏跑 8 秒）。前四条
（typecheck / eslint / test / build，合计约 3 秒）**每次都要跑**，
e2e 按下面的规则降频。

> **⚠️ AI 无法可靠判断"用户是否还有排队消息"。**
> 不要把这当成可以自动执行的判据 —— 试过一次，判断错了，
> 在用户明明还有消息时跳过了 e2e。
>
> 实际做法：**每次回复末尾**主动说明"这次没跑 e2e（因为…）"，
> 让用户能纠正。宁可多问一句，不要静默跳过。

降频依据（按可靠性排序）：

1. **改动是否触及浏览器边界** —— 动了 `src/render/`、`src/ui/`、
   `src/input/`、`src/main.ts`、`index.html`、vite 配置，就跑；
   纯 `src/core/` + 测试的改动，单测已经覆盖，可以跳。
2. **距上次跑 e2e 过了几轮** —— 连续几轮小改后补一次。

**无论跳不跳，都要在回复里写出来**，不要静默。

### 清理 headless Chrome 时**必须**带限定

```
pkill -9 -f "Google Chrome.*headless"     # ✓
pkill -9 -f "Google Chrome"               # ✗ 会把用户自己的浏览器也杀掉
```

后者匹配的是完整命令行，而用户的浏览器路径就是
`/Applications/Google Chrome.app/Contents/MacOS/Google Chrome` ——
**完全匹配**，`-9` 还让它来不及保存会话。这个错误犯过一次，不要再犯。
