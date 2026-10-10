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

### ⚠️ 触线时**不许靠删/压注释解决** —— 要拆 util 或横向切割

用户明确指出过（原话）："你为啥要删注释，你应该倾向于拆 util 方法，
或者横向切割。"

**这条规则的由来**：我连续多轮在文件顶到 700 行时选择"压缩注释"甚至
"删掉整段注释"，把文件挤回上限。这是**错的**：

- 本仓库的注释**不是填充物**，它们承担"记录踩过的坑"的职责（哪一版漏了什么、
  为什么不能那样写）。压掉之后**下一个人会重新踩同一个坑**
- 我的压缩还**丢过信息**：`ui/settings/logic.ts` 里"为什么把判定逻辑抽出来"
  （Pixi v8 在 jsdom 里不好跑 → 只能写"能构造、不报错"这种零信息冒烟测试）
  整段被删，而它在别处没有记录
- 删注释是**把成本转嫁给未来**，换取的只是"这一次不用动结构"

**正确顺序**（依次尝试，不要跳到第 3 步）：

1. **拆 util 方法** —— 把纯逻辑抽成独立模块（几何、判定、格式化通常都能抽）
2. **横向切割** —— 按职责把大类切成小类 / 把一组相关的 case 分出去
3. 只有在 1、2 都确实不成立时，才**问用户**怎么办

**抽取代码时，连带它的注释一起搬**（注释和代码是一体的）。
不要在原处留个"见 xxx"然后在新处只写一行摘要。

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

**当前为空 —— 所有文件都在 700 行以内**（口径：`content.split('\n').length`，
比 `wc -l` 多 1），与测试里的 `GRANDFATHERED` 表一致。

✅ 已拆到 700 以下、**从表里移除**的：

| 原文件 | 原行数 | 现在 | 拆成了 |
|---|---|---|---|
| `src/render/BattleScene.ts` | 1421 | **668** | `skillBar` / `IconStrip` / `FloatingTextLayer` / `background` / `sceneTypes` / `hudUtils` / `actorLayout` + `parts/` 下 7 个帧部件 |
| `src/ui/settings/SettingsPanel.ts` | 938 | **646** | `KeyGrid` / `SkillDetail` / `SettingsFrame` / `KeysFooter` / `ScaleSlider` / `rows` |
| `src/core/combat/battleState.ts` | 1580 | **694** | `castPipeline` / `hitResolution` / `stats` / `holds` / `runAi` / `battleStateTypes` |
| `src/core/types.ts` | **973**（棘轮上限） | **拆成目录** | `core/types/` 下 13 个文件：`ids` / `resources` / `stats` / `buffs` / `triggers` / `effects` / `abilities` / `skills` / `loadout` / `behavior` / `runtime` / `encounter` / `index`（各 21–162 行） |

### ✅ `src/core/types.ts` 已按**横向切割**拆成目录（原来以为不能拆）

**原先的判断是错的。** 这里曾写着"类型图是中心辐射的，再切下去会造出
类型层的 import 环"——**那个顾虑被夸大了**：

- `import type` 在编译期**完全擦除**，运行期没有环，不会有"import 是
  undefined"
- 本仓库真踩过的两次环（`data/scale.ts`、`settingsGeometry.ts`）都是
  **值导入**（`const` / 函数），不是类型
- 而且 `events.ts` / `actions.ts` **早就是先例**：它们反向 `import type`
  标识类型，一直没问题

所以按**横向切割**（按概念分段各一个文件）拆成了 `src/core/types/`：

| 文件 | 行数 |
|---|---|
| `stats.ts`（属性与修正） | 162 |
| `buffs.ts` | 137 |
| `skills.ts`（技能 + 内容基类） | 133 |
| `effects.ts` | 109 |
| `abilities.ts` | 103 |
| `triggers.ts` | 99 |
| `runtime.ts` | 86 |
| `loadout.ts` / `behavior.ts` | 59 / 50 |
| `resources.ts` | 45 |
| `index.ts`（转发） | 32 |
| `ids.ts` / `encounter.ts` | 22 / 21 |

⚠️ **`index.ts` 转发全部**，所以 `from '../core/types'` 这种整体导入**照旧
可用**（模块解析会走到 `types/index.ts`）。真要按需引用时可以改成直接引
具体文件，但那是可选的。

---

## 3b. 触屏（移动端）的约定

移动端与桌面**共用同一套 canvas UI**，触屏只是再加一层虚拟按键。
详见 `docs/plans/2026-10-10-m8-mobile.md`。

- **唯一真相**：`input/touchLayout.ts` 的 `TouchLayout` 只有**一个写入
  路径** `set()`，写完通知所有订阅者。输入层与渲染层各自订阅 ——
  **不许任何一方自己留副本**（那正是"画面改了、输入还是旧的"的来源）
- **能力探测不看 UA**：`render/platform.ts` 用 `matchMedia('(pointer: coarse)')`
  + `(hover: none)`。触屏笔记本的 UA 与普通笔记本一样，UA 判断会漏掉它
- **触屏输入用合成 key**（`touch:{skillId}`）：这样 `repeatHeld()` 的
  "按住连发"逻辑**不用改**就同时服务键鼠与触屏
- **一个 `pointerId` 只占一个按钮**：按下时绑定，移动不切换。
  `pointercancel` / `pointerleave` 必须当作松开，否则引擎会一直扣那个
  技能的代价
- **画布几何是算出来的**：双弧的半径/角度范围靠弦长约束
  （`2·asin((D+gap)/2r)`）推出来，不要手调数字 —— 实测手调很容易
  撞出重叠或越界
- **隐藏键名的四处**：技能格 / 设置按钮 / 设置页 / 结算提示。
  ⚠️ 触屏时**整条技能栏都隐藏**（双弧按钮承担它的全部职责，
  同时显示会直接重叠）

### ⚠️ 触屏与键盘**功能必须对等**

用户明确要求："移动端和键盘的功能需要是一样的。"

- **不许**把某个功能做成"只有键盘能用"。已经踩过的坑：改键
  （`startCapture`）只有 `Enter` 一条路，触屏**完全进不去改键**
- 触屏按钮的配置入口**就是**「按键」页 —— 触屏按钮是由键位表
  机械派生出来的（`touchButtonsFromBindings` = "有键的技能"），
  所以两者是**同一张表**，不存在"另一套触屏配置"
- 加任何键位相关功能时，**同时**给出触屏的操作方式，或明确说明
  为什么不需要

### ⚠️ 键位提示**不能放进 i18n**

**括号与括号里的按键名不属于文案** —— 它们是**键位**。放进 i18n 会造成
两个问题：

1. **改快捷键要改 i18n**（用户指出的核心问题："改快捷键 害得改 i18n吗？"）
   —— 键位是运行期可变的状态，文案是静态资源，两者生命周期不同
2. **触屏要隐藏时只能去删文案** —— 删了桌面也就丢了信息；不删触屏又藏不掉

正确做法：**i18n 只写标签**，渲染时**拼**上按键名。

- `settings.tabGeneral` = `'通用'`、`settings.keysReset` = `'恢复默认'`
- 助记键从 `MNEMONIC_KEYS`（`ui/settings/logic.ts`）**反查**实际生效的键，
  由渲染层拼成 `通用 (G)` —— 这样标签与键盘行为**永远一致**
- 触屏不拼那段，只显示 `通用` / `恢复默认`

❌ 错误做法（我做过一次）：把 `'通用 (G)'` 写进 i18n，再用正则
`stripMnemonic()` 在触屏时把括号删掉 —— 那是在给一个不该存在的耦合打补丁。

---

## 3c. ⚠️ 绝对不要自己 `git push`

**不许**自行执行 `git push`（任何形式：`git push`、`git push origin main`、
`git push --force`）。

### 为什么

用户明确要求过。原因不是"怕出错"，而是**推送会触发 CI 部署到线上** ——
那是对外可见的副作用，必须由**人**决定什么时候发生。

改完之后**提交到本地就行**，然后告诉用户"已提交在本地，等你推"。

### 允许做的

- `git add` + `git commit`（本地提交是安全的、可回退的）
- `git status` / `git log` / `git diff` 之类的只读查询
- 用户明确说"推"或"push"时再推

### 这条规则被违反过

我连续多轮自作主张 `git push` 并轮询 CI 部署状态，用户多次没预料到线上
已经被更新。**不要再犯。**

---

## 4. 改动后的必跑流程

```
pnpm run typecheck   →   npx eslint .   →   pnpm run test:run
                     →   pnpm run build
                     →   node tools/verify-e2e.mjs        （键盘）
                     →   node tools/verify-e2e-touch.mjs  （触屏）
```

⚠️ **两个 e2e 都要跑。** `verify-e2e.mjs` **只按键盘**，所以"触屏坏了、
键盘没事"这一类 bug 它**完全看不见** —— 实测踩过：`restartBattle()`
重建 `BattleLoop` 时漏了接触屏输入源，于是**任何一次重开之后触屏永久断开**
（Action 全堆进没人 drain 的数组），键盘正常。那个 bug 活了很久就是因为
没有触屏覆盖。触屏脚本固定约 5 秒。

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
