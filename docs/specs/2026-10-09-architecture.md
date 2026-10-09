# Raid Simulator — 架构与 UI 规范

> 状态：待评审
> 日期：2026-10-09
> 范围：技术选型 / 分层架构 / 目录结构 / 测试策略 / UI 组件化与设计系统 / 里程碑 / 发布流程
> 配套文档：`2026-10-09-data-model.md`

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
│  │  ├─ abilities/                   # modifier/derived/trigger/grant/deal/grantSkill/consume
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
  mp:      { base: 0x3a7ad2, dark: 0x1b3a76, bright: 0x5a9ef0 },
  energy:  { base: 0x5cb460, dark: 0x1f4e29, bright: 0x7cd480 },
  fury:    { base: 0xe4a840, dark: 0x624215, bright: 0xffc860 },
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

**明确结论：不需要。**

| 需求 | 方案 | 第三方库？ |
|---|---|---|
| 2D 渲染 / 精灵 / 文本 | PixiJS | 已有（唯一必需） |
| 布局 | 固定布局表（§6.2） | ❌ 不需要 |
| 动画缓动 | 自写 40 行 `lerp` / `easeOutCubic` / `tween` | ❌ 不需要 |
| 状态管理 | snapshot 直接读 | ❌ 不需要 |
| UI 组件库 | 自写三层组件（§6.1） | ❌ 不需要 |
| 音效 | WebAudio 薄封装 | ❌ 不需要 |
| 测试 | Vitest + fast-check | ✅ 需要（dev） |
| 校验 schema | 手写校验器（§11），不引 zod | ❌ 不需要 |

**唯一可能后期要加的**：`pixi-viewport`（如果要相机移动）——但本作没有位移，
所以不需要。**保持依赖最少是移植性的前提。**

---

## 7. 输入与全键盘

- **主键区**：`1-6` `Q E R T F G Z X C V` + `Shift`/`Ctrl` 修饰 → 20+ 槽位。
  没有 WASD，全部留给技能。
- **按键 → Action → 队列**（§2.2）。`input/bindings.ts` 持有一张可配置的映射表。
- **按住连发**：`keydown`（`event.repeat === false`）入队一次 `useSkill`；
  引擎在 GCD 结束后若该键仍处按下状态，则自动重发（MMO 手感标配）。
  松开键 → `releaseKey` Action。
- **暂停**：`Esc` 打开暂停菜单（继续 / 重开 / 设置 / 退出）。
  暂停时 worker 停止推进 tick（不消耗战斗时间）。
- **改键**：MVP 用 DOM 覆盖层实现（**唯一允许的 DOM**，因为它是低频非战斗界面）。
  持久化到 `localStorage`。
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

### 9.1 现状调查（2026-10-09 实测）

线上地址：**https://hdnray.github.io/raid/**（注意路径是 `/raid/`，
不是仓库同名的 `/raid-simulator/`）。

实测结果：

| 检查项 | 结果 |
|---|---|
| `https://hdnray.github.io/raid/` | `200`，返回旧版 CRA 构建 |
| `https://hdnray.github.io/raid-simulator/` | `404` |
| 线上 `asset-manifest.json` | 与 `archive/build/asset-manifest.json` **逐字节一致** |
| 线上 `main.afc504d1.js` | `207532` 字节 = 本地 `archive/build/static/js/main.afc504d1.js` |
| 线上 `main.388d8cf3.css` | `8047` 字节 = 本地同名文件 |
| `git ls-remote --heads origin` | **只有 `main` 一个分支** |
| `.github/` 目录 | 当前不存在 |
| `git log --all -- index.html` | **root 的 `index.html` 从未被提交过** |
| `git log --all -- build/index.html` | **`build/` 从未被提交过** |
| `git log --all --grep='deploy\|pages\|gh-pages'` | 无相关历史提交 |

**结论**：线上站点**不可能**来自当前 `main` 的任何已提交内容——
它既不来自 root，也不来自 `build/`，也不来自 `docs/`。
唯一自洽的解释是 **Pages 发布源为 "GitHub Actions"，且 2022 年 1 月
那次成功部署的 artifact 仍在被继续服务**（GitHub Pages 会保留最后一次成功部署的
内容，即使产生它的 workflow 后来消失了）。这也解释了为什么仓库里没有 workflow、
没有 `gh-pages` 分支、没有构建产物提交。

> 我无法 100% 确认这一点：`api.github.com/repos/HDNRAY/raid-simulator/pages`
> 需要认证，而当前环境的匿名请求被限流（403）。**请在仓库
> Settings → Pages 里核对 "Build and deployment → Source" 的值。**
> 如果是 `GitHub Actions`，下面的方案完全对齐；如果是 `Deploy from a branch`，
> 请告诉我，我会改成对齐那个模式。

### 9.2 不改动的三件事

需求是"这块我不希望有任何变化"。所以以下三件事**一件都不改**：

| 项 | 保持不变 |
|---|---|
| URL | `https://hdnray.github.io/raid/` |
| 路由形式 | **hash 路由**（`#/battle`），不是 history 路由 |
| 页面标题 | `Code:Raid` |

于是新项目必须满足：

```ts
// vite.config.ts
export default defineConfig({
  base: '/raid/',          // ← 必须，不能是 '/raid-simulator/'
  build: { outDir: 'dist' },
});
```

```ts
// 路由必须是 hash 形式，才能保持 #/battle 这个 URL 不变
// 不引路由库：路由表只有 2 个状态，手写 ~20 行
type Route = '#/battle' | '#/archive' | '#/settings';
```

`index.html` 的 `<title>` 写 `Code:Raid`。

**`/raid/archive/` 是新增路径**（不覆盖任何现有路径），
用于从线上访问 2022 年的旧版本。这是"不改变现状"下的净增量。

### 9.3 过渡期发布策略

新项目尚未有构建入口时，workflow 自动构建并发布 `archive/`，
保证 `/raid/` **始终有一个可用的站点**，不会白屏：

```
src/main.ts 不存在  →  只构建 archive/，发布到 /
src/main.ts 存在    →  构建新项目发布到 /，archive/ 构建后挂到 /archive/
```

切换是自动的（靠检测构建入口文件），不需要改 workflow。
**CI 以 typecheck / lint / test 为发布硬门槛**：任一失败则不发布，
线上继续保留上一次成功部署的内容。

`.github/workflows/deploy.yml` 已按此写好。

---

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

**选 B**：`app.init()` 里的 `resolution` 固定为 1，`autoDensity: false`，
**渲染器尺寸在生命周期内永不改变**。缩放完全交给 CSS。

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

---

## 11. 待确认

1. 请在 **Settings → Pages** 核对发布源（§9.1 结论依赖它），告诉我实际值。
2. **默认缩放模式 `fit`**（填满屏幕）、设置里可切 `integer`（绝对锐利 + 黑边）——
   认可吗？还是默认就用 `integer`？
3. `archive/` 旧版本**从线上可访问**（`/raid/archive/`），认可吗？
   如果不想要，我加一行从 artifact 里剔除。
4. 上一轮的四个待确认（counters 资源模型 / 不引 UI 库 / pnpm / CI 硬门槛）
   已在 2026-10-09 全部确认：**1、2、4 认可，3 用 pnpm**。

