# 斗 — 架构与 UI 规范

> 状态：待评审
> 日期：2026-10-09
> 范围：技术选型 / 分层架构 / 目录结构 / 测试策略 / UI 组件化与设计系统 / 里程碑 / 发布流程
> 配套文档：`2026-10-09-data-model.md` · `2026-10-09-i18n.md`

---

## 1. 技术选型

| 层 | 选型 | 理由 |
|---|---|---|
| 语言 | TypeScript 5.x，`strict: true` + `noUncheckedIndexedAccess` + `exactOptionalPropertyTypes` | 旧项目到处 `as OverTimeEffect` 硬转，说明类型没兜住 |
| 构建 | **Vite 7** | CRA 已死；worker、静态资源、冷启动都更好 |
| 渲染 | **PixiJS v8** | WebGL/WebGPU、精灵批处理、`AnimatedSprite`、`Assets`、滤镜 |
| 逻辑 | **零依赖纯 TS**，跑在 Web Worker | 可在 Node 里测试，这是重构的核心 |
| 测试 | **Vitest** + **fast-check** | 与 Vite 同源，零配置 |
| 音频 | 薄封装 WebAudio（不引库） | M7 才做 |
| 状态管理 | **无**（不用 Redux / Zustand / MobX） | 游戏状态每帧变，塞进 React 式 store 就是旧项目的死因 |
| UI 框架 | **无**（不引 React/Vue） | 全部走 Pixi 的 `Container` / `Text` / `Graphics` |
| lint | ESLint (flat config) + 自定义规则 | 见 §2.3 |

### 1.1 为什么不引 UI 框架

需求是"不用 DOM、直接 canvas、方便移植"。引入 React 会：

1. 把 DOM 带回来（ReactDOM 必须挂在 DOM 上）
2. 引入"状态 → 虚拟 DOM diff → 真实 DOM"的中间层，而这个游戏的状态是每帧 60 次的全量变化，diff 成本是纯浪费
3. 破坏移植性：React 在 Godot / 原生环境没有对应物，Pixi 的概念（Container/Sprite/Texture）有

**代价**：布局、焦点、文本排版要自己写。本作 UI 是**固定布局**（示意图已经画死了每个区域），
不是流式布局，所以这个代价很小。§6 给出组件化方案。

---

## 2. 分层架构

```
┌───────────────────────────────────────────────────────────────┐
│  core/          纯确定性模拟引擎                               │
│  (state, input, dt) -> (state', events)                       │
│  零依赖 · 无 DOM · 无 Math.random · 可在 Node 跑                 │
└───────────────────────────────────────────────────────────────┘
        ▲                                        │
        │ Action[]（唯一输入接口）                  │ Snapshot + EventDef[]（只读输出）
        │                                        ▼
┌───────────────────────┐            ┌───────────────────────────┐
│ input/                │            │ render/                   │
│ 键盘 → Action 队列      │            │ Pixi 消费者 · 插值 · 动画   │
│ 焦点/暂停/改键          │            │ ui/ 组件 · 布局 · 主题      │
└───────────────────────┘            └───────────────────────────┘
```

### 2.1 硬约束（lint 强制，违反即构建失败）

| # | 约束 | 为什么 |
|---|---|---|
| C1 | `core/` 不许 import `pixi` / DOM API / `app` / `ui` / `render` | 这是"逻辑与 UI 分离"的可执行定义 |
| C2 | `core/` 里不许出现 `Math.random` / `Date.now` / `performance.now` | 时间与随机必须来自 state，否则无法重放与存档 |
| C3 | `render/` 不许 import `core/` 的内部模块，只能 import `core/snapshot.ts` 暴露的类型 | 防止渲染层反向依赖引擎内部 |
| C4 | `core/` 不许出现异步（`Promise` / `async` / `await`） | 引擎是同步的纯计算；异步会破坏确定性 |
| C5 | 状态里不许有 `Map` / `Set` / 类实例 / 函数 | 必须可结构化克隆（worker 通信）且可哈希（golden test） |
| **I1** | `src/**` 里禁止出现中日韩字符（`console.*` 的开发者日志除外） | 强制走 i18n，见 [i18n 规范](2026-10-09-i18n.md) |
| **I2** | 只有 `src/i18n/locales/**` 允许 CJK | I1 的白名单 |
| **I3** | `core/` 与 `data/` 禁止 import `i18n` | 引擎与内容数据只持 key，零文案 |

C5 值得展开：worker 通信要求结构化克隆，golden test 要求稳定哈希。
**所以 `BattleState` 一律用 plain object + array。** 这一条同时干掉了旧项目
`overTimeEffects[].caster` 直接存对象引用的问题（那会导致循环引用，无法序列化）。

### 2.2 数据流

```
键盘事件
   │  (input/keyboard.ts)
   ▼
Action { type, at, payload }        ← 唯一输入接口，可录制可重放
   │  (input/queue.ts)
   ▼
┌─────────────────────────────────────────────┐
│ Worker: core/loop.ts                        │
│   固定步长 60Hz 累加器                        │
│   while (acc >= DT) { tick(state, actions) }│
│   -> { snapshot, events }                   │
└─────────────────────────────────────────────┘
   │  postMessage（结构化克隆）
   ▼
主线程: 渲染插值 → Pixi 场景图
```

**关键**：`Action` 是唯一的输入入口。玩家键盘、Boss AI、回放系统**三者产生同一种
`Action`**。这是"Boss 和玩家共用引擎"以及"可重放"共同的技术基础。

```ts
type Action =
  | { type: 'useSkill';  skillId: SkillId; at: number }
  | { type: 'releaseKey'; key: string;     at: number }   // 松开：停止按住连发
  | { type: 'setTarget'; targetId: CombatantId; at: number }
  | { type: 'pause' | 'resume'; at: number }
  | { type: 'restart'; seed: number; at: number };
```

`at` 是战斗内相对毫秒，**量化到帧**（`Math.round(at / DT) * DT`），
避免浮点抖动导致重放漂移。

### 2.3 循环与时间

```ts
const DT = 1000 / 60;            // 16.6667ms，固定不变

function frame(nowMs: number, state: BattleState, queue: Action[]) {
  let acc = nowMs - state.lastRealTime;
  state.lastRealTime = nowMs;
  acc = Math.min(acc, MAX_CATCHUP);        // 防死亡螺旋：最多补 5 帧
  while (acc >= DT) {
    const due = queue.filter(a => a.at <= state.time + DT);
    tick(state, due);                       // 纯函数：只改 state
    acc -= DT;
  }
}
```

**绝不把 `requestAnimationFrame` 的 delta 直接喂给逻辑。** 那是模拟游戏不确定性的
第一来源。渲染用 `alpha = acc / DT` 做插值，渲染频率与逻辑频率解耦。

### 2.4 性能

- 5 分钟战斗 = 18000 tick。每 tick 约 7 个阶段 × 少量实体 ≈ 可忽略的开销。
- **不需要对象池、不需要脏检查优化、不需要部分重算。** 先做对，测出来慢再优化。
- 唯一需要注意的：每帧 `postMessage` 的 snapshot 大小。用**增量事件 + 周期性全量快照**
  （每 30 帧一次全量），而不是每帧全量。

---

## 3. 目录结构

```
raid-simulator/
├─ .github/workflows/deploy.yml       # GitHub Pages 自动发布
├─ archive/                           # ← 旧项目（2021 版），只读参考
├─ docs/
│  ├─ specs/                          # 设计规范
│  └─ mockups/                        # 画面示意图
├─ src/
│  ├─ core/                           # ★ 纯确定性模拟引擎（零依赖）
│  │  ├─ types.ts
│  │  ├─ content/                     # validate.ts normalize.ts registry.ts
│  │  ├─ expr/                        # eval.ts deps.ts
│  │  ├─ stats/                       # pipeline.ts aggregate.ts breakdown.ts
│  │  ├─ abilities/                   # modifier/derived/trigger/grant/deal/resource + grantSkill/consume（后两个是设计稿，无执行点）
│  │  ├─ buffs/                       # apply.ts expire.ts stack.ts resolve.ts
│  │  ├─ skills/                      # cast.ts cooldown.ts cost.ts book.ts
│  │  ├─ combat/                      # hit.ts damage.ts heal.ts interrupt.ts
│  │  ├─ ai/                          # behaviors.ts select.ts
│  │  ├─ loop.ts                      # 固定步长、tick 管线、Action 应用
│  │  ├─ rng.ts                       # 种子化 RNG（状态内）
│  │  ├─ snapshot.ts                  # BattleSnapshot 类型 + 序列化
│  │  └─ events.ts                    # EventDef / Hook 类型
│  ├─ data/                           # 内容数据（纯数据，无逻辑）
│  │  ├─ entities/                    # 装备/奇物/消耗品
│  │  ├─ skills/  talents/  buffs/
│  │  ├─ encounters/                  # 关卡定义
│  │  └─ palette.ts                   # ★ 设计 token（代码与美术共用）
│  ├─ i18n/                           # ★ 强制：所有玩家可见文案
│  │  ├─ types.ts                     # 从基准语言推导的 key 类型
│  │  ├─ locales/zh-CN.ts             # 当前唯一语言
│  │  ├─ translator.ts                # t() / number / percent / duration
│  │  └─ keys.ts                      # 代码里引用的固定 key 常量
│  ├─ input/                          # keyboard.ts queue.ts bindings.ts focus.ts
│  ├─ render/                         # app.ts scene.ts camera.ts interp.ts
│  │  ├─ actors/                      # bossView.ts playerView.ts vfx.ts
│  │  └─ theme.ts                     # ★ 主题（读 data/palette.ts）
│  ├─ ui/                             # ★ 组件层
│  │  ├─ primitives/                  # Panel Bar Text Icon Label NineSlice Stack Grid
│  │  ├─ widgets/                     # HealthBar CastBar BuffIcon SkillSlot ResourceRow
│  │  ├─ hud/                         # HudRoot + 各区域面板
│  │  ├─ screens/                     # BattleScreen ResultScreen SettingsScreen
│  │  └─ layout.ts                    # 声明式布局表
│  ├─ app/                            # 启动、worker 桥接、主循环编排
│  └─ main.ts
└─ tests/
   ├─ unit/  golden/  property/
```

★ = 与 UI 规范化直接相关。

---

## 4. 测试策略

| 层次 | 工具 | 覆盖 |
|---|---|---|
| 单元 | Vitest | 数值公式、buff 叠层、CD/资源门禁、无敌窗口边界（§13 T1–T13） |
| **黄金重放** | Vitest | 固定 seed + 录制输入 → 最终状态哈希（§13 T14）**最重要** |
| 属性 | fast-check | 随机输入下 HP 不越界、无 NaN/Infinity、不抛异常 |
| 无头可玩性 | Vitest | 脚本化玩家在 Node 里独立打完一场，断言胜/负与用时 |
| 内容校验 | Vitest | 所有 `data/` 内容通过 §11 校验器 |
| lint | ESLint | C1–C5 硬约束 |
| UI 冒烟 | Vitest (jsdom + pixi 无头) | 场景能构建、组件能挂载、不抛异常 |

**无头可玩性测试是 UI 开发的前置门槛**：只有它通过，才允许开始写 UI。
这是把"逻辑与 UI 分离"从口号变成流程约束的方式。

---

## 5. 里程碑

| # | 内容 | 验收标准 | 依赖 |
|---|---|---|---|
| **M0** | 工程骨架：Vite + TS strict + Pixi + 960×540 + 固定步长循环 + worker 桥接 + 调试面板 | 屏幕上有会动的色块，FPS / step / 插值稳定 | — |
| **M1** | `core/` 确定性模拟：`GameEntity`/`Skill`/`Buff`/`Effect`/`Expr`/`Condition`/修正树/资源/CD/GCD/读条/DoT/回复 | §13 T1–T7、T9–T10 全绿；`core/` 零依赖（C1–C5 lint 通过） | M0 |
| **M2** | 判定层：hit frame 时间轴 + `invulnerable`/`damageReduce` + 中断 + 溯源重算 | §13 T3、T3b、T8、T13 全绿 | M1 |
| **M3** | 输入层：键位映射、Action 队列、按住连发、暂停、回放录制 | 录制一场战斗能逐帧重放出一致结果（T14） | M1 |
| **M4** | Boss AI + 行为数组：时间轴、阶段、狂暴、打断、派生 | Boss 能自己打完，行为 100% 数据驱动（T11–T12） | M2 |
| **M5** | 表现层：战斗场景 + 全 HUD + 飘字 + 受击反馈 + 预警渲染 + HUD 淡出 | 示意图动起来；UI 组件全部可单测 | M2, M3 |
| **M6** | 内容：Verrot 全套技能与动画、胜/败/重开流程 | **MVP 达成**：一场完整可玩的 Boss 战 | M5 |
| **M7** | 打磨：音效、粒子、设置持久化、新手引导、正式像素素材 | 可以给别人玩 | M6 |

**第一个实施计划只做 M0–M2**（骨架 + 纯核心 + 判定层）。做完即可用测试证明架构成立。

---

## 6. UI 组件化与设计系统

### 6.0 两条不可协商的约束

1. **UI 全部走 canvas，不碰 DOM。** 目的不是"技术上更纯粹"，而是**可移植**：
   canvas 是通用渲染接口，DOM 不是。以后要做小程序 / 原生小游戏 / Godot 之类，
   canvas 那层能整体搬走，DOM 那层不能。
   **所以连设置界面和改键界面也走 canvas**（§6.5 给出方案）。
2. **UI 必须组件化、模块化**，不允许把绘制代码堆进一个大文件。

### 6.1 组件分层（不引第三方 UI 库）

固定布局，所以**不需要布局引擎、不需要 CSS、不需要 Flexbox 实现**。
手写三层组件，每层都是纯函数式的 `create(props) → Container`：

```
primitives/   基础图元：Panel  Bar  Text  Icon  Label  NineSlice
               ↓ 只有几何 + 颜色，无业务语义
widgets/      业务组件：HealthBar  CastBar  BuffIcon  SkillSlot  ResourceRow
               ↓ 组合图元 + 读 snapshot 的某个切片
hud/          区域面板：BossFrame  PlayerFrame  BuffStrip  SkillBar  RightRail
               ↓ 布局表定位
screens/      整屏：BattleScreen  ResultScreen  SettingsScreen
```

**组件契约**（强制）：每个组件是一个**纯渲染函数**，签名统一：

```ts
interface View<TProps> {
  readonly root: Container;
  /** 幂等：相同 props 连续调用不产生副作用 */
  update(props: TProps, alpha: number): void;
  destroy(): void;
}
```

**为什么是 `update()` 而不是每帧重建**：Pixi 的 `Container` 创建成本不低，
每帧重建会产生大量 GC 抖动。所以组件**创建一次、每帧 update**。

**关键纪律**：组件**只读 snapshot，绝不持有 sim 对象引用**（C3）。
`update()` 的入参是从 snapshot 里切出来的 plain object。

### 6.2 声明式布局表

固定布局用数据描述，避免散落在各组件里：

```ts
// ui/layout.ts
export const LAYOUT = {
  bossFrame:   { x: 48,  y: 14,  w: 864, h: 44 },
  castBar:     { x: 48,  y: 66,  w: 864, h: 40 },
  playerFrame: { x: 48,  y: 118, w: 352, h: 104 },
  buffStrip:   { x: 902, y: 118, w: 0,   h: 72, anchor: 'right', gap: 8, max: 8 },
  skillBar:    { x: 'center', y: 462, slotW: 66, slotH: 66, gap: 8, count: 9 },
  rightRail:   { x: 928, y: 118, w: 24,  h: 64 },
  combatText:  { x: 'center', y: 250 },
} as const;
```

改布局 = 改这张表。**不引布局库。**

### 6.3 设计 token 与配色（`data/palette.ts`）

**这是"代码与美术共用同一份颜色"的机制**——UI 和像素素材读同一个文件，
所以换配色时不会出现"UI 是蓝的、精灵是紫的"。

```ts
export const PALETTE = {
  // 界面
  bgTop:      0x0a0c16,  bgBottom:  0x1e141c,
  panel:      0x11121b,  panelLine: 0x505266,
  text:       0xf0f0f6,  textDim:   0x8c8c9e,

  // 语义色（每个都有 base/dark/bright 三档，对应 32 色调色板的明暗梯度）
  hp:      { base: 0xd23a34, dark: 0x7c1b1f, bright: 0xf0605a },
  // 刻意不做"魔法值"：两种资源已经够表达循环与爆发
  energy:  { base: 0x5cb460, dark: 0x1f4e29, bright: 0x7cd480 },
  douqi:   { base: 0xe4a840, dark: 0x624215, bright: 0xffc860 },
  // 判定窗口专用：必须最醒目
  iframe:  { base: 0xff6648, dark: 0x5a0d0b, bright: 0xffb8a0 },
  // 预警三色：清晰度就是难度
  danger:  { base: 0xec4c38, dark: 0x460d0f, bright: 0xff9070 },
  magic:   { base: 0x9868d6, dark: 0x3c2666, bright: 0xb890f0 },
  // 状态
  buff: { base: 0x78c478, dark: 0x284c28 },
  debuff:{ base: 0xca5a5a, dark: 0x461a1a },
  proc:  { base: 0x5acad8, dark: 0x1c545c },   // 派生窗口
} as const;

/** 排版：逻辑像素字号，无缩放（像素画不糊的前提） */
export const TYPE = { xs: 14, sm: 16, md: 18, lg: 22, xl: 30 } as const;
```

**注意字号是逻辑像素整数，且不小于 14。** 非整数或小于 14px 的字在像素风里必糊。

**验收**：同一份 `PALETTE` 导出成一张色卡 PNG（`docs/mockups/palette.png`），
美术照着这张图选色。**UI 与素材颜色不一致 = 构建期报错**（用一个校验脚本比对
素材调色板 ⊆ PALETTE）。

### 6.4 第三方库：需要吗？

**默认结论：不需要。** 但**不把话说死**——`PixiJS` 覆盖不到的地方，允许引入，
且引入前要过下面这张表。

| 需求 | 方案 | 第三方库？ |
|---|---|---|
| 2D 渲染 / 精灵 / 文本 | PixiJS | ✅ 需要（唯一必需） |
| 布局 | 固定布局表（§6.2） | ❌ 不需要 |
| 动画缓动 | 自写约 40 行 `lerp` / `easeOutCubic` / `tween` | ❌ 不需要 |
| 状态管理 | snapshot 直接读 | ❌ 不需要 |
| UI 组件库 | 自写三层组件（§6.1） | ❌ 不需要 |
| 音效 | WebAudio 薄封装 | ❌ 不需要 |
| 测试 | Vitest + fast-check | ✅ 需要（dev） |
| schema 校验 | 手写校验器，不引 zod | ❌ 不需要 |

#### 6.4.1 什么时候允许换 / 加库

需求说了"如果 PixiJS 不够用，可以用 KonvaJS、ThreeJS 之类的"。
**我不打算提前换，但也不排斥。** 判定标准是这张表，而不是偏好：

| 如果出现这种需求 | 该考虑的方向 | 说明 |
|---|---|---|
| 大量 GPU 特效、光照、法线、后处理、3D | **Three.js**（或 PixiJS v8 的 WebGPU + 自写 shader） | Pixi 是 2D 优先；真 3D 场景它不适合 |
| 只有矢量图形 / 数据可视化类 UI，不需要精灵批处理 | KonvaJS | 但本项目是像素精灵驱动，Konva 的位图/精灵能力弱于 Pixi |
| 物理模拟（碰撞、抛体） | 独立的 2D 物理库 | **本作没有位移，预计不需要** |
| 需要相机移动 / 缩放 / 视口裁剪 | `pixi-viewport` | 本作无位移，预计不需要 |
| 骨骼动画（Spine / DragonBones） | `@esotericsoftware/spine-pixi-v8` | **这是最可能真正需要的一个**：Boss 动画如果超出逐帧精灵的表现力 |

#### 6.4.2 换库的代价控制

**架构已经把代价压到最低**：`core/` 零依赖（C1 硬约束），
渲染层全部藏在 `render/` 与 `ui/` 两棵子树里。所以：

- **换渲染库 = 重写 `render/` + `ui/`，`core/` 一行不动。**
  这正是"逻辑与 UI 分离"的真正回报——不是为了好看，是为了让这种替换变得可行。
- **反过来，如果哪天 `core/` 里出现了 `pixi` 或 `three` 的 import，这次重构就失败了。**

#### 6.4.3 一条重要的约束

**上表里所有候选库（Konva / Three / pixi-viewport / Spine）都只允许出现在
`render/` 和 `ui/` 里**，由同一套 ESLint 规则拦截（C1 的反向规则）。
加库可以，越界不行。

### 6.5 非战斗界面也走 canvas

设置、改键、暂停菜单、结算界面**全部用 canvas 画**，不使用 DOM 覆盖层。
因为 canvas 没有 DOM 的焦点系统，需要一个最小交互模型：

```ts
// ui/interaction.ts
interface Focusable {
  id: string;
  next?: string;          // 上下（或 W/S）移动焦点
  prev?: string;
  nextH?: string;         // 左右移动（改键界面用）
  prevH?: string;
  onActivate?: () => void; // Enter / Space 触发
  captureKeys?: boolean;   // 捕获原始按键（改键界面：等待玩家按任意键）
}

interface FocusState {
  focusId: string;
  owner: 'battle' | 'pause' | 'settings' | 'rebind' | 'result';
}
```

规则：

- **只用键盘**（与战斗一致，不引鼠标）。
- 上下移动焦点，Enter 确认，Esc 返回。
- 改键界面：焦点在某一行时按 Enter 进入**捕获态**，
  下一次任意 `keydown` 就是新绑定（**在 canvas 里处理，不需要 DOM input**）。
- 焦点用发光描边表现（复用 `PALETTE.proc`）。
- 每个界面是 `screens/` 下的一个 `View`，与战斗 UI 用同一套 primitives。

**代价评估**：比 DOM 方案多约 100~150 行（焦点遍历 + 列表滚动 + 捕获态）。
**收益**：UI 层零 DOM、整层可移植；且战斗内外输入模型统一
（都是 `keydown -> Action`），不存在"某些界面走 DOM 事件、某些走 canvas"的双轨制。

### 6.5.1 图标：SVG（`render/icons.ts`）

图标经历三代，每代都因为具体缺陷被换掉：

| 代 | 做法 | 为什么被换掉 |
| --- | --- | --- |
| 1 | **字符**（「设」当设置图标） | 字必须显式 `set()`，漏一次就渲染成空方块，看起来像"图标没加载"；抽象字也不如图形一眼认得出 |
| 2 | **命令式绘制**（`Graphics.arc/lineTo` 拼齿轮） | 不依赖字体，但造型能力很差：8 个齿是一堆 `cos/sin` 拼出来的，改形状就要重算，美术无法参与 |
| 3 | **SVG**（当前） | 矢量、有标准工具链、美术可以直接给文件 |

**约定**

- `viewBox` 统一 `0 0 24 24`，线宽统一 `2`。于是所有图标坐标系一致，`size` 只需一个数字。
- 颜色**构建时注入**（`buildSvg` 把 `{{color}}` 替换掉），缓存按 `名字@颜色` 分键。
  不在运行时染色的原因：`stroke="currentColor"` 在纹理上下文里没有 CSS 继承链，
  会变成透明；而 Pixi 的 `ColorMatrixFilter` 是乘法，只能压暗不能提亮。
- 默认 `fill="none"`，**只有需要实心的图标显式写 `fill="{{color}}"`**。
  （早期同时设了 `fill` 与 `stroke` 同色，闭合路径的轮廓图标全被填成实心块 —— 齿轮成了圆饼。）
- 解码器是**注入**的（`setIconDecoder`）：生产用 `Assets.load`，
  测试可以塞假的。这一段不能省 —— Pixi v8 的 `Texture.from(svgDataUri)`
  只会返回 1×1 的 EMPTY 纹理（SVG 必须先经资源系统光栅化）。

**异步性**：`Icon` 的纹理是异步就绪的，所以定位请用构造时给的 `size`，
不要读 `root.width`（解码完成前是 0），也不要假设"构造完立刻能截图看到"。

### 6.6 canvas 里显示中文

文案**全部来自 i18n 表**（[i18n 规范](2026-10-09-i18n.md)），不在代码里硬编码。
这里只讲渲染层要注意的：

- **中文没有能覆盖常用字的现成像素字体**，不要用点阵中文字体（体积巨大）。
- 方案：引一个等宽无衬线中文字体，**裁剪成只含 catalog 里出现过的字符子集**
  （`fontmin` / `subfont`，通常能压到 100KB 以内），配 `Pixi.Text` + 整数坐标。
  **裁剪的输入就是 `zh-CN.ts` 的全部字符串**——这是 i18n 集中化的附带好处。
- **中文字号必须 >= 16 逻辑像素**。14px 中文在 960x540 下读不清，所以
  `TYPE.xs`(14) 只给数字和拉丁字母，中文从 `TYPE.sm`(16) 起。
- 文本节点**缓存复用**：`Pixi.Text` 改 `text` 会重建内部 canvas 纹理，
  是明显的性能开销。所以 HUD 文本节点创建一次、只在值真变化时赋值
  （比较新旧字符串），不要每帧无条件赋值。

**中文渲染是像素风 / H5 小游戏最常见的翻车点**，所以字体子集化放在 M5
（表现层）第一件事做，不拖到最后。

## 7. 输入与全键盘

- **主键区**：`1-6` `Q E R T F G Z X C V` + `Shift`/`Ctrl` 修饰 → 20+ 槽位。
  没有 WASD，全部留给技能。
- **按键 → Action → 队列**（§2.2）。`input/bindings.ts` 持有一张可配置的映射表。
- **按住连发**：`keydown`（`event.repeat === false`）入队一次 `useSkill`；
  引擎在 GCD 结束后若该键仍处按下状态，则自动重发（MMO 手感标配）。
  松开键 → `releaseKey` Action。
- **暂停**：`Esc` 打开暂停菜单（继续 / 重开 / 设置 / 退出）。
  暂停时 worker 停止推进 tick（不消耗战斗时间）。
- **改键**：**走 canvas**（§6.5），不使用 DOM 覆盖层。持久化到 `localStorage`。
- **快捷键提示画在技能格上**（见示意图），不依赖说明书。
- **必须处理 `preventDefault`**：`Tab`（焦点切换）、空格（滚动）、
  `F1-F12`（浏览器功能）都要拦。
- **失焦即暂停**：`window.blur` → 自动暂停，避免"切走了还在被打"。

---

## 8. 像素美术规范

| 项 | 值 |
|---|---|
| 逻辑分辨率 | **960×540**（16:9），整数倍放大到屏幕 |
| 缩放 | 2× → 1920×1080；整数倍，`roundPixels: true`，纹理 `NEAREST` |
| Boss 精灵 | **144×192**（纹理区域约 200×360），占屏高约 36% |
| 玩家背影 | **160×160**，只 3 帧（idle / 闪避下沉 / 格挡抬盾） |
| 调色板 | **32 色**，从 `data/palette.ts` 导出，预警色独立且高饱和 |
| 帧数 | idle 4 · attack 4（**前摇→挥击→命中→收招**）· hurt 2 · death 5 |
| 格式 | Aseprite 导出 sprite sheet + JSON atlas，Pixi `Assets` 加载 |
| 剪影测试 | 填纯黑仍能认出是哪个 Boss 才算过 |
| 预警三通道 | 精灵动画（举剑）+ 地面标记 + 施法条文字，缺一不可 |

**attack 的 4 帧与 hit frame 时间轴一一对应**：帧 1 = 前摇（同时开始读条预警），
帧 3 = 命中（hit frame 在此触发），帧 4 = 收招。**动画与逻辑共用同一个时间轴定义**，
不各写一份。

**MVP 用程序生成的占位精灵**（见 `docs/mockups/`），**换正式美术不改一行代码**
——`render/actors/bossView.ts` 只依赖 atlas 的键名，不依赖图片内容。

---

## 9. 发布流程

### 9.1 实际机制（2026-10-09 确认）

**上一版本文档此处写错了**，更正如下。

发布方式与 `bdgame` / `colorGuess` **完全一致**：在各自的仓库里用 GitHub Actions
构建，然后用 `cpina/github-action-push-to-another-repository` 把产物**推到
`HDNRAY.github.io` 仓库的子目录**。

```
raid-simulator 仓库                    HDNRAY.github.io 仓库（用户站点）
  push main                              main 分支
     |                                      |- index.html      <- 个人主页
     v                                      |- bdgame/         <- bdgame 的产物
  GitHub Actions                            |- colorguess/     <- colorGuess 的产物
   build -> dist                            `- raid/           <- 本项目的产物
     |                                          |- index.html
     `-- push 到 HDNRAY.github.io/raid/ --------|  static/js/main.afc504d1.js
                                                `- static/css/...
```

**证据**（本地 `HDNRAY.github.io` 仓库）：

- 存在 `raid/` 目录，其中 `index.html` 802 字节、与
  `https://hdnray.github.io/raid/` 返回的内容**逐字节一致**
- 该目录唯一一次提交是 `bf36b3c 2022-09-07 "try to update structure"`
- 同级有 `bdgame/`、`colorguess/`，与 bdgame / colorGuess 的
  `target-directory` 一一对应

**这解释了上一版本里所有"矛盾"的观察**：`raid-simulator` 仓库没有
`gh-pages` 分支、没有 workflow、从未提交过 `index.html` —— 因为**发布产物
本来就不在这个仓库里**，它在 `HDNRAY.github.io` 仓库。上一版本"Pages 源是
GitHub Actions artifact"的推断是错的，作废。

### 9.2 三个参照实现的关键参数

| 项 | bdgame | colorGuess | **本项目** |
|---|---|---|---|
| 触发分支 | `master` | `main` | `main` |
| Node | `20.x` | `20.x` | `20.x` |
| 构建脚本 | `npm run build` | `npm run build:h5:pages` | `pnpm run build` |
| 产物目录 | `bdgame/` | `dist-h5` | `dist` |
| `target-directory` | `bdgame` | `colorguess` | **`raid`** |
| 依赖 secret | `SSH_DEPLOY_KEY` | `SSH_DEPLOY_KEY` | **`SSH_DEPLOY_KEY`**（同一对密钥） |
| 部署 action | `cpina/...@v1.7.2` | `cpina/...@v1.7.2` | `cpina/...@v1.7.2` |

**子路径与 base 路径必须一致**，两个参照实现都遵守：

```ts
// bdgame/vite.config.ts
base: command === 'serve' ? '/' : '/bdgame/'

// colorGuess/package.json
"build:h5:pages": "TARO_H5_PUBLIC_PATH=/colorguess/ npm run build:h5"
```

所以本项目：

```ts
// raid-simulator/vite.config.ts
base: command === 'serve' ? '/' : '/raid/'
```

**唯一无法从本地确认的是 `SSH_DEPLOY_KEY` secret。** 它必须在
`raid-simulator` 仓库的 Settings -> Secrets and variables -> Actions 里存在，
且对应公钥在 `HDNRAY.github.io` 仓库有写权限。2022 年能发布成功说明它当时存在；
**如果被清理过，需要在两个仓库里重新配置**（`HDNRAY.github.io` 目录下留有一对
`id_github_pages_codelinez` / `.pub`，是 codelinez 用的同类密钥，可作参考）。

### 9.3 不改动的三件事

需求是"这块我不希望有任何变化"。所以以下三件事**一件都不改**：

| 项 | 保持不变 |
|---|---|
| URL | `https://hdnray.github.io/raid/` |
| 路由形式 | **hash 路由**（`#/battle`），不是 history 路由 |
| 页面标题 | `斗` |

路由**不引库**——只有 2 个状态，手写约 20 行 `hashchange` 监听即可。

### 9.4 新项目就绪前的行为

`archive/` 已从工作区删除（v1 源码完整保留在 git 历史，见 README）。
所以新项目就绪前，workflow **只做校验、不发布**：

```
src/main.ts 不存在  ->  workflow 空转，线上 /raid/ 保持 2022 年内容不变
src/main.ts 存在    ->  构建并推送到 HDNRAY.github.io/raid/
```

用 `git` 的 `if` 条件实现（`steps.detect.outputs.ready`），**不需要改 workflow**。

**CI 以 typecheck / lint / test 为发布硬门槛**：任一失败则不推送，
`HDNRAY.github.io/raid/` 继续保留上一次成功的内容。

`.github/workflows/deploy.yml` 已按此写好。

### 9.5 当前阻塞项

`raid-simulator` 仓库**没有** `SSH_DEPLOY_KEY` secret（2026-10-09 核查），
所以发布链路目前是断的：push `main` 会构建成功但推送失败。

配置步骤见 [`docs/setup-deploy-key.md`](../setup-deploy-key.md)，约 3 分钟。
要点：公钥加到 `HDNRAY.github.io` 的 Deploy keys 并**勾选 Allow write access**；
私钥存为 `raid-simulator` 的 Actions secret，名字必须是 `SSH_DEPLOY_KEY`。

**注意**：`cpina` 会同步整个 `target-directory`，所以 `raid/` 会被**完全替换**成
新产物——2022 年那个 `Readme.md` 和旧构建都会消失（与 bdgame / colorGuess 行为一致）。
旧版源码不受影响，它在 git 历史里。

## 10. 分辨率与自适应缩放

### 10.1 目标

- 逻辑分辨率固定 **960×540**（16:9），游戏内坐标与像素画不受屏幕尺寸影响
- **始终保持 16:9**，多余区域用黑边（letterbox）填充
- 像素**在任何屏幕尺寸下都不糊**

### 10.2 方案：定尺寸 canvas + CSS 缩放

两条路线的取舍：

| 方案 | 做法 | 问题 |
|---|---|---|
| A. 改 renderer 分辨率 | 按容器尺寸反复 `renderer.resize()` | 每次 resize 重分配 framebuffer；逻辑坐标被拉伸，像素比例失控 |
| **B. 定尺寸 canvas + CSS 缩放**（选这个） | canvas 内部永远是 960×540，用 CSS 居中缩放 | 需要处理 CSS 缩放的采样方式 |

**选 B**：`autoDensity: false`，**渲染器尺寸在生命周期内永不改变**（不响应
窗口尺寸），缩放完全交给 CSS。

⚠️ **2026-10-20 修订：`resolution` 不再固定为 1** —— 它是 `STAGE_SCALE`
（`render/stageScale.ts`，**1 或 2**，启动时按设备定一次）：
`1080p` 屏上 960×540 的缓冲被 CSS 拉伸 2 倍会发虚，改用 2 倍缓冲（1920×1080）
正好 1:1。**逻辑空间仍是 960×540、布局常量一个不动**，所以"缩放只改 CSS"
这条规则没有变 —— 变的只是"一个逻辑像素用几个设备像素画"，而它由
`senders`：`?scale=1|2` 覆盖 / 触屏 1 × / 视口宽 ≥1200 → 2×。
`render/sizes.applyStageSize` 的断言随之改成 `backing = 逻辑 × scale`
（防止有人运行期偷偷 `renderer.resize`，那仍然会抛错）。

```ts
// render/scaling.ts
const LOGICAL_W = 960, LOGICAL_H = 540;

/** 视口内可用的 CSS 像素尺寸 */
function computeCanvasRect(viewportW: number, viewportH: number, mode: ScalingMode) {
  const fitScale = Math.min(viewportW / LOGICAL_W, viewportH / LOGICAL_H);
  // 整数模式：找最大的整数倍；至少 1 倍（小窗口时允许被裁切）
  const scale = mode === 'integer'
    ? Math.max(1, Math.floor(fitScale))
    : fitScale;
  return {
    scale,
    width:  LOGICAL_W * scale,
    height: LOGICAL_H * scale,
  };
}
```

**两种模式，默认推荐 `fit`**：

| 模式 | 行为 | 取舍 |
|---|---|---|
| `fit`（默认） | 按 `min(w/960, h/540)` 等比放大到刚好填满 | **始终填满屏幕**，1920×1080 下正好 2.0 倍；像素比例均匀，观感优于大量黑边 |
| `integer` | 取 `floor` 到整数倍，周围留黑边 | 每个逻辑像素严格对齐物理像素，绝对锐利，但黑边可能很宽 |

**默认 `fit` 的理由**：非整数倍缩放会让**所有**逻辑像素不均匀（有的 2 物理像素宽、
有的 3），这比"边缘略软"更伤观感。而 `min()` 采样意味着像素边界落在物理像素栅格上时
是干净的整数映射——1920×1080、2560×1440、3840×2160 这些常见分辨率下
`fitScale` 恰好是整数（2/2.667/4），所以实践中大部分情况两者等价。
设置里提供切换，让在意绝对锐利的玩家用 `integer`。

### 10.3 不糊的三个必要条件（缺一不可）

```css
/* index.html */
html, body { margin: 0; height: 100%; background: #000; overflow: hidden; }
#stage { display: flex; align-items: center; justify-content: center; height: 100%; }
#game {
  display: block;
  image-rendering: pixelated;       /* ① CSS 放大用最近邻，禁止线性插值 */
  image-rendering: crisp-edges;     /*    Firefox 用这个关键字 */
}
```

```ts
// render/app.ts
await app.init({
  width: LOGICAL_W, height: LOGICAL_H,
  resolution: 1,
  autoDensity: false,               // ② 不让 Pixi 按 devicePixelRatio 改 canvas 尺寸
  antialias: false,
  roundPixels: true,                // ③ 精灵落在整数逻辑像素上
  background: 0x000000,
});
```

**关于 `devicePixelRatio`（retina）**：因为 canvas 内部固定 960×540，
DPR 只影响 CSS 缩放后的最终物理尺寸，不会引入额外采样模糊。
CSS 的 `pixelated` 负责最后一跳。**这是"定尺寸 canvas"方案相对"改 renderer
分辨率"方案的又一个优势**——DPR 完全不需要处理。

### 10.4 响应式监听

```ts
const ro = new ResizeObserver(() => {
  const { width, height } = computeCanvasRect(stage.clientWidth, stage.clientHeight, mode);
  canvas.style.width  = `${width}px`;
  canvas.style.height = `${height}px`;
  hud.setSafeArea((stage.clientWidth - width) / 2, (stage.clientHeight - height) / 2);
});
ro.observe(stage);
```

**注意 canvas 的内部尺寸在这里完全没有被修改**，只改 CSS 尺寸。
所以 resize 是廉价的（浏览器重排），不会触发 Pixi 的纹理与 framebuffer 重建。

### 10.5 安全区

黑边意味着 HUD 在超宽屏上可能贴近画面边缘。所以 HUD 布局按
**960×540 逻辑坐标**定位（`ui/layout.ts`），并额外检查：
关键元素（Boss 血条、自身血条、技能栏、I-FRAME 提示）距逻辑边界
**不少于 24 逻辑像素**。这条会在 UI 单测里断言。

### 10.6 ⚠️【待定方案 · 未实施】画布分辨率 vs 文字清晰度（2026-10-13 调研）

> **状态：只测量、未改任何代码。** 用户当时的决定是 **"画布的事情先放着"**。
> 下面每个数字都是**实测**的（不是估算），方案都量过收益与代价 ——
> 留着是为了下次要动时不用重新量一遍。

#### 10.6.1 现状（实测）

| 项 | 值 |
|---|---|
| 逻辑分辨率 | 960×540 |
| `app.init` 的 `resolution` | **1** |
| `autoDensity` | **false** |
| `Text._resolution` | **全是 1**（实测数了 **285** 个 Text 对象） |

#### 10.6.2 ❌ 两条**被证伪**的假设（保留，用来记住当时为什么那么想）

| 假设 | 实测结果 |
|---|---|
| "浏览器**插值放大** → 糊" | **证伪**。CSS 生效的是 `crisp-edges`（= 最近邻）；DPR=1 vs 2 的 `uniqueColors` 是 **957 vs 955** —— 没有插值 |
| "DPR=2 更糊" | **证伪**。DPR=2 的信息与 DPR=1 相同，只是**块更大** |

#### 10.6.3 ⭐ 真根因

内容只在 **960×540 这一个缓冲区**里光栅化**一次**；文字 11–17 逻辑像素 +
灰度抗锯齿，然后被浏览器**块状放大**。

- "糊" = **1× 时烘进去的灰边**（面板区约 **10–17%** 是中间色）
  + 非整数放大的块大小不均
- 所以**变量是"画布分辨率 vs 显示尺寸"的落差，不是 DPR**
- ⚠️ "**文字糊**"（光栅化分辨率不足，与缩放整数性**无关**）与
  "**像素画毛**"（最近邻 + 非整数缩放，与分辨率**无关**）是**两个问题**

#### 10.6.4 补丁实测（在 `/tmp` 的 dist 副本上做的，**没动 `src/`**）

`resolution = devicePixelRatio`：

| 项 | 结果 |
|---|---|
| DPR=2 中间色 | `0.108 → 0.067` / `0.111 → 0.077` = **−37%** |
| DPR=1 | **逐位完全相同**（零副作用） |
| `Text._resolution` | 自动跟着变 2（**不需要重建 Text**） |
| 显存 | 文字纹理 +1MB；后备缓冲 2.07 → 8.3MB |
| JS | +0.04ms/帧 |
| ⚠️ SwiftShader（headless 硬编码 `--disable-gpu`） | **26 → 97ms** = CPU 光栅上界；**真 GPU 未量到** |

#### 10.6.5 ⚠️ "只改一行"**实测会白屏**

只改 `bootstrap.ts` → `sizes.ts` 的断言抛错
（`canvas backing size must stay 960x540, got 1920x1080`）
→ `#stage` 永远没有 `.ready` → `__raidBattle` undefined → **整页黑屏**。

必须**同时**改 4 处：`bootstrap.ts`、`sizes.ts:59`、
`tests/web/sizes.test.ts`（3 条断言）、本文件 §10 附近。

#### 10.6.6 各方案（每个都量过）

| 方案 | 收益 | 代价 |
|---|---|---|
| **(a)** `resolution: devicePixelRatio` | 收益/风险比最好；DPR1 零回归 | 需改 4 处；⚠️ 在 1280 宽的 Retina 窗口上**仍残留 1.333 倍块状放大**（后备 1920 vs 设备 2560）—— **别写成"彻底解决"** |
| **(b)** 只调 `Text.resolution` | ❌ **被实测堵死**：backing 仍 960×540 时把 285 个 Text 设 res=2 → 中间色 `0.098 → 0.117`（**无效，而且略微更糊**）—— 细节在**合成回 1× 缓冲**时被丢掉。别单独做（(a) 已自动包含） |
| **(d)** `resolution = fitScale × devicePixelRatio` | 唯一能**逐像素 1:1**；(a)+(d) 同时修文字与像素格 | resize 时重建 framebuffer + **所有文字纹理重新光栅化**；最复杂。本机（M1 Pro / 3024×1964 Retina / 逻辑 1512×982 → DPR=2）`fitScale = 1512/960 = 1.575` → resolution 需 **3.15** → 后备缓冲 3024×1701 = **5.1 Mpix**（现 0.52） |
| **(c)** 整数倍缩放（`SCALING_MODE='integer'`，机制已存在） | 只修**像素格** | 画面变小 + 黑边 |
| **(e1)** CSS `image-rendering` | ❌ 无效（生效的已经是 `crisp-edges`） | — |
| **(e2)** 设置里 UI 缩放 100%→200% | ❌ 只影响战斗 HUD（面板在 §10.7 单独修了） | — |

> **结论：待定，不实施。** 用户："画布的事情先放着"。

### 10.7 ✅【已实施】设置弹窗响应 UI 缩放（2026-10-13）

用户要求："**设置面板不随 UI 缩放 也要修**"。修之前的实测：UI 缩放 = 2 时
HUD 字号 11 → 22（走 `UiLayout`），而**设置面板的字号 17 / 13 一个字都不变**
（它完全不读 `uiScale`）。而设置面板恰恰是"文字说明"最密集的地方
（技能详情 / 按键 / 通用），**最该变大的那块没变大**。

#### 10.7.1 ⚠️ 硬约束：面板**已经顶到画布边上**，外框不能乘系数

```
面板 640×520（settingsGeometry.SETTINGS_PANEL）
画布 960×540（ui/layout.LOGICAL）→ 居中后 y 10..530，上下各只剩 10px
面板 × 2 = 1280×1040 → 横向超 320、纵向超 500 ✗（画在画布外面，被裁掉）
```

⚠️ **"整体乘系数" 在这里根本不可行** —— 与战斗 HUD（若干块贴边部件，朝各自
锚点长）不是一回事。连"里面那几行整体乘 k"也不行：面板总高固定 520，多占的
空间只能从详情区抢，实测 k=1.2 时详情区从 210px 掉到 167px
（**8 行 → 5 行**）—— 字大了但一句话读不完。

#### 10.7.2 做法（`src/ui/settings/settingsScale.ts`）

**不动任何行高**（格阵格子 / 详情区外框 / 提示行 / 按钮全保持 1× 的几何），
只把**字号 + 详情区的行距与留白**按 k 放大：

| 跟着 k | 不跟 k |
|---|---|
| 面板内所有字号（`scaledFont`）、详情区行距（22 → 26.4）与 padding（8 → 9.6） | 面板外框、格阵列宽/行高、详情区外框、提示两行、按钮、命中区 |

- **钳位由规则给出**（不是"算完再夹"）：`panelScaleFor(uiScale) = min(uiScale, PANEL_SCALE_MAX)`，
  而 `PANEL_SCALE_MAX` 是**竖向预算解出来的**（见那个常量的推导）。
  ⚠️ 曾经多写了一道"按画布高"的上限 `(540−20)/520 = 1.0`，于是
  `panelScaleFor(1.5)` 直接变成 **1** —— 整个功能**静默失效**，而输出里
  "k=1"看起来完全正常。
- **唯一写入路径** `setSettingsScale()`，`PanelScaleSync` 只在系数**真的变了**
  时重排部件（拖动滑块每帧都会进来；`Label.setSize` 会让 Pixi 重新光栅化）。
  ⚠️ `__raidBattle.setUiScale()`（调试入口）**自己不重绘** —— 它只写
  `state.uiScale`，面板要等下一次 `redraw()`（打开 / 切页 / 拖滑块）才吃到新系数。
  验证脚本因此必须**先 `setUiScale` 再 `settings.open()`**。
- **横向一个字都不动**：详情说明是折行的（加宽只能加面板宽，而面板宽也顶边）、
  格阵 4 列 × 2 行 = 8 格正好放下当前 8 个可绑技能（横向放大 = 「劈」「卸」
  配不到键）、而且横向不动就不需要换算指针坐标。

#### 10.7.2b ⚠️【2026-10-13 修正】上限 1.2 → **1.35**，而且旧的 1.2 不是详情区定的

上一版把 1.2 记成"详情区被挤到 5 行"换来的。**那是一次误诊**：真正把 k 卡住的是
**右下角键位预览那一列** —— 预览块的 y 原先写成 `TOUCH_PREVIEW.top × k`，
而它上面那一列（格阵）一个字都不随 k 变，于是预览随着 k **一路往下滑**，
最后撞到面板底边（`234k + 190 + 8k + 26 ≤ 520 − 16` → k ≤ 1.19）。

修法（用户 2026-10-13 批准"**等比缩小**触屏键位预览"，见 AGENTS.md §3b）：

1. 预览块**位置钉死**（`TOUCH_PREVIEW.top`，不再 ×k）—— 这就是"腾出竖直空间"；
2. 块高不跟 k 变，只有里面的说明行跟 k 长 → 双弧那块按 `h − captionH·k`
   **等比缩小**（`touchPreview.ts` 取的本来就是 `min(宽比, 高比)`）；
3. 缩小有**下限**：等比装完之后键位圆直径必须 ≥ **44px**（触屏可点下限），
   由 `touchPreviewMinArcH()` 反算 → k ≤ 1.75。

上限因此让给了**左列**的详情区：一屏行数 = `floor((226 − 32k) / 22k)`，
要求 ≥ `MIN_DETAIL_ROWS`（**6** 行 —— 5 行是用户明确否掉的那一档）：
`226 − 32k ≥ 132k → k ≤ 1.378` → 收成 **1.35**。

⚠️ 这一条要记住的是**排错方向**：左右两列（详情区 x 16..416 / 预览 x 428..624）
**不共享竖直空间** —— "缩预览"结构上不可能给详情区腾地方，它能腾的只有自己那一列
的底边。真正决定 k 的始终是左列。

#### 10.7.3 实测（`__raidBattle.settings.panelScale()` / `.panelText()`）

| UI 缩放 | 面板系数 | 页签 | 技能名 | 说明正文 | 底栏提示 | 详情区一屏 |
|---|---|---|---|---|---|---|
| 100% | 1 | 15 | 20 | 11 | 13 | 8 行 |
| 150% | **1.35** | 20 | 27 | 15 | 18 | 6 行 |
| 200% | **1.35** | 20 | 27 | 15 | 18 | 6 行 |

外框在三档下都是 `x 160 / y 10 / 640×520`（**在画布内**），桌面容量恒为 **8**、
触屏恒为 **6**（**改缩放不吞功能**）。⚠️ 代价：详情区一屏少两行（可滚，
测试断言"滚到底最后一行完整"），而且**底部提示两行的行高是固定的 20px**
（`HINT_LINE.height` 不跟 k 走）—— 所以再往上调会被它挡住（k ≤ 1.57），
那是"提示行高也要跟缩放走"的另一件事。

⚠️ 键位预览在 1.35 下只缩了约 4%（圆心距 152.96 → 146.71，圆钮直径 47 → 45）：
它**不是**这次变大的来源，只是被收口成"不再跟着 k 往下滑"（见 10.7.2b）。

#### 10.7.4 ⚠️ 它**也不响应画布尺寸**（顺带查清的）

面板几何只从"面板底座 + 当前缩放"算出来，**完全没有读视口 / 画布 CSS 尺寸**
（`measureStage` 的 `padX/padY` 没进过它）。letterbox 变宽变窄时面板不动 ——
因为画布**内部**永远是 960×540（§10.2），面板在逻辑坐标里居中，
所以视觉上它本来就跟画布一起被 CSS 缩放，不需要单独响应。

---

## 11. 决议记录

| # | 议题 | 结论 |
|---|---|---|
| 1 | 发布源 | ✅ 已确认：`cpina/github-action-push-to-another-repository` 推到 `HDNRAY.github.io/raid/`（§9.1）。上一版"GitHub Actions artifact"的推断**作废** |
| 1b | `SSH_DEPLOY_KEY` | ❌ **当前不存在**，发布链路断了，需按 `docs/setup-deploy-key.md` 配置（§9.5） |
| 1c | `archive/` | ✅ 已删除。v1 源码完整保留在 git 历史（`993e2db`） |
| 1d | 旧版是否保留在线 | ✅ 不保留。`raid/` 会被新产物完全替换 |
| 2 | 缩放模式 | 默认 `fit`（填满屏幕），设置可切 `integer`（§10.2） |
| 3 | UI 层 | ✅ **全部走 canvas，零 DOM**，包括设置与改键（§6.0、§6.5） |
| 4 | 第三方库 | ✅ **默认不引**；PixiJS 覆盖不到时允许引入（Konva / Three / Spine 等），但只允许出现在 `render/` 与 `ui/`（§6.4） |
| 5 | 使用次数 / 消耗品 | ⚠️ **设计稿，引擎未实现**（`ResourcePool.counters` 的读取是 `() => 0` 的桩；内容用 `Expr.counter` 会被校验器拒。见数据模型 §2.2 顶部的核对说明） |
| 6 | UI 库 | ✅ 不引 |
| 7 | 包管理器 | ✅ pnpm |
| 8 | CI 硬门槛 | ✅ typecheck / lint / test 不通过则不发布 |
| 9 | 主题系统 | ✅ 不做多主题；`data/palette.ts` 保留为 UI 与美术的唯一配色真相源（§6.3） |
| 10 | i18n | ✅ **强制**。引擎与内容只持 key，UI 查表；当前仅 `zh-CN`。lint I1–I3 + 6 个构建期校验码。见 [i18n 规范](2026-10-09-i18n.md) |
| 11 | 沙箱网络 | ✅ 实际可用（`registry.npmjs.org` 200）。需用 `--store-dir ./.pnpm-store` 绕开只读的 `~/.npm` |

### 11.1 唯一待办（不是设计问题，是运维）

按 [`docs/setup-deploy-key.md`](../setup-deploy-key.md) 配置 `SSH_DEPLOY_KEY`
（约 3 分钟）。这一步不阻塞写代码，只阻塞"看到线上效果"。

### 11.2 已默认采用的假设

以下未单独确认、按默认值推进，如不认可请指出：

1. ~~玩家可见文案保持中文，不做 i18n 铺垫~~ -> **已推翻**：
   **i18n 强制**，当前只支持 `zh-CN`，见 [i18n 规范](2026-10-09-i18n.md)。
2. **默认缩放模式 `fit`**（§10.2），设置里可切 `integer`。
3. **不做多主题系统**；`data/palette.ts` 作为唯一配色真相源（§6.3）。

---

## 12. 数值纪律（浮点处理）

游戏里的浮点问题和数值计算里的不是一回事。会咬人的有四类，各有对策。

### 12.1 时间：整数皮秒，tick 数由真实时间直接算出

**这是踩了三轮坑才定下来的方案**，过程值得记录：

| 尝试 | 结果 |
|---|---|
| ① 浮点累积：`t += dt; if (t >= nextAt)` | `60 * (1000/60) = 1000.0000000000001`，而逐帧累加得 `999.9999999999999` → **"喂 60 帧"只推进 59 tick**，误差 O(N·ε) |
| ② 给浮点比较加 `1e-9` 容差 | 治症状。换个帧率/抖动模式又错 |
| ③ 整数纳秒 + 债务累加 | 脱离浮点，但 `NS_PER_TICK` 只能取 16666667（真值 16666666.67），"债务攒够 N tick"与"`ticksAt` 说 N tick"**是两套舍入，必然差 1**，且差值随时间增长 |

**最终方案**：`targetTick = ticksAt(realNow)` 是唯一真相源，
`steps = targetTick - tick`。**没有累积状态，所以没有漂移；
只有一套舍入，所以不会自相矛盾。**

配套两点：

- **单位取皮秒**（`PS_PER_TICK = 16666666667`）。每 tick 的相对表示误差
  从纳秒的 2e-8 降到 2e-11，于是 `1000ms = 60 tick`、`5 分钟 = 18000 tick`
  这些整数量**精确成立**。代价是皮秒的安全整数范围只有约 2.5 小时，
  所以时钟只保存**帧间隔级别的短时差**，绝不保存绝对时间。
- **所有时间→tick 的换算都必须走 `ticksAt`**（`frameOf` / `quantizeToFrame` /
  `FixedLoop.tickAt` / `SimClock.advance`）。实测过：只要有**一条**路径自己算，
  就会出现"时钟说 60、量化说 59"。

**容差是明示的取舍，不是掩盖**：`ticksAt` 用 round，容差半个 tick（8.3ms）。
精度预算**花在"整数 tick 数正确"上**，而不是花在纳秒级等价上 ——
玩家感知的是 60Hz 手感。

### 12.2 持续状态：存"截止时刻"，不存"剩余时长"

```ts
// ✗ 剩余时长每帧减 dt，误差 O(N·ε)
remaining -= dt;

// ✓ 截止时刻是立刻确定的值，不随时间漂移
expiresAtTick <= currentTick;
```

DoT/HoT、buff 过期、CD、狂暴计时**全部**用截止 tick。这是引擎里最容易
写出漂移的地方 —— 旧项目的 `lastTriggerTime + interval` 就是浮点版本。

### 12.3 生命与离散资源：整数

`hp` / 缠 / 炁 / 层数 / 使用次数一律整数。公式内部按 float 算，
**只在写回状态时取整**，且只允许通过 `roundStat` / `roundDamage`。

- 伤害**向下取整**（`roundDamage`）：向上取整会让"每次 0.5 伤害"变成 1 点，
  相当于凭空放大。
- **整数生命还顺带消灭了一整类判定 bug**：`hp <= 0` 不再受
  `0.0000001` 残差影响而给出"打不死"。

百分比、急速、暴击率等**比率**保留 float（取整它们没有意义）。

### 12.4 阈值比较与求和

- `feq` / `flt` / `fgt` / `fle` / `fge`（`core/numeric.ts`）显式选容差。
  **禁止裸写 `a === b`** 比较浮点。
- 百分比聚合（`damageBoost` 那类 `Σ`）用 **Kahan 补偿求和**。
  实测：在 `1e9` 上累加 1000 个 `0.1`，朴素误差 `2.4e-5`、
  Kahan 误差为 **0**。更重要的是**顺序不敏感** —— 否则黄金重放测试
  会因为修正数组顺序不同而随机通过。
- 连乘（`damageMult` 那类 `∏`）按 `sourceKey` 排序后连乘，保证可复现。
- **除法一律走 `safeDiv`**：引擎里出现 `NaN` 最糟 —— 它会顺着算术传播，
  而 `NaN <= 0` 恒为 `false`，表现为"打不死"且极难定位。
- **每次写回状态前过 `assertFinite`**：把 NaN 挡在状态之外。

### 12.5 Kahan 不是万能的

诚实记录：**灾难性抵消无法被 Kahan 消除**。对
`[1e15, 1, -1e15, ...]` 这种量级悬殊的加法，Kahan 与朴素加法结果一致
（都偏离精确值）。它的价值在"大量**同量级**小量累加到**大量**上"，
而这正是百分比修正的形态。测试里对这一点有明确断言。

### 12.6 对应测试

| 测试 | 覆盖 |
|---|---|
| `tests/unit/loop.test.ts`（29 个） | 60 帧=60 tick、1000ms=60 tick、144/30Hz 下严格按真实时间、抖动不丢 tick、慢帧零头跨帧累积、5 分钟 18000 tick 无漂移、钳制语义 |
| `tests/unit/numeric.test.ts`（22 个） | 容差比较、取整策略、Kahan 精度与顺序不敏感、安全除法、NaN 防护 |
| `tests/unit/workerSession.test.ts` | 快照的时间推进在协议层也一致 |

全部时间构造必须用 `exactTickMs(n)` 而不是 `n * MS_PER_TICK` ——
后者是浮点乘法，`60 * MS_PER_TICK = 1000.0000000000001`，
与 `ticksAt` 认定的边界不是同一个数。这个坑在测试里也踩到过。

---
