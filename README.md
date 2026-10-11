# 斗

一个**单挑 Boss**的实时战斗数值模拟器。第三人称视角、无位移、
键鼠 + 触屏操作、PixiJS 像素渲染。

**可以在浏览器里真的打完一场**：备战界面选人物与 Boss → 战斗 →
前摇预警、闪避 / 格挡 / 打断、Boss 随机出招、结算。

当前可玩：**林晚风** 对 **傲慢**（快慢刀 + 霸体）或 **色欲**（印记 + 眩晕）。
两个 Boss 共用同一引擎，区别只有行为数组。

---

## 这是什么

- **一场战斗 = 一个 Boss。** 每场有**时限**（超时判负）和**狂暴机制**
  （超时后 Boss 伤害翻倍），Boss 有带前摇的技能、阶段转换、可打断的读条。
- **没有位移，但需要"躲"。** Boss 技能在 **hit frame** 一次性判定，
  你按下的闪避 / 格挡会给自己挂一个 **短时无敌 / 减伤 buff** ——
  时机对了就免伤，错了就吃满。**判定窗口就是 buff**，不是另一套系统。
- **技能派生。** 施放技能 A 后开启一个"派生窗口"，技能 B 只有在这个窗口内可用。
  同样是 buff 存在性判断。
- **玩家和 Boss 数值对等。** 两边跑**同一个引擎、同一套数据模型**，
  区别只有输入来源：玩家是键盘 / 触屏，Boss 是数据驱动的行为数组。
- **没有 WASD。** 主键区全部留给技能。

---

## 设计文档

| 文档 | 内容 |
|---|---|
| [数据模型规范](docs/specs/2026-10-09-data-model.md) | `GameEntity` / `Skill` / `Effect` / `Buff` / `Modifier` / `Expr` / `Condition` / `Trigger`，修正树结算算法 |
| [架构与 UI 规范](docs/specs/2026-10-09-architecture.md) | 技术选型、分层架构、硬约束、目录结构、测试策略、UI 组件化、发布流程 |
| [i18n 规范](docs/specs/2026-10-09-i18n.md) | **强制**：引擎持 key、UI 查表；lint I1–I3 |
| [色欲 Boss 设计](docs/specs/2026-10-10-lust-boss.md) | 印记 + 反伤那套机制的完整设计 |
| [傲慢 Boss 设计](docs/specs/2026-10-11-pride-boss.md) | 快慢刀三通道、霸体合并、加权随机轮转 |
| [美术管线设计](docs/specs/2026-10-11-art-pipeline.md) | 素材路线选型、投影规范、分数倍缩放两层拆解、角色解耦 |
| [美术替换需求（给外部出图）](docs/art-brief-ai-replacement.md) | 要替换什么、每个实体出多少张、规格与七宗罪形象方向；**给不写代码的人看** |
| [画面示意图](docs/mockups/2026-10-09-battle-scene.png) | 960×540 逻辑分辨率下的战斗界面布局 |

另外 [`AGENTS.md`](AGENTS.md) 是**强制**约定（类型断言、单文件行数、
触屏对等、i18n、不许自动 push）。**改这个仓库之前先读它。**

**新读者建议顺序**：先看画面示意图 → 再看数据模型规范的「熵之钟走查」
（一个完整的被动装备例子）→ 再看架构规范的分层章节。

---

## 架构核心：一条硬边界

```
        ┌──────────────────────────────────────────────┐
        │  core/   纯确定性模拟引擎                       │
        │  (state, input, dt) -> (state', events)      │
        │  零依赖 · 无 DOM · 无 Math.random · 可在 Node 跑 │
        └──────────────────────────────────────────────┘
                 ▲                          │
      Action[]   │                          │  Snapshot + Events
                 │                          ▼
        ┌────────────────┐        ┌──────────────────────┐
        │ input/ 键鼠/触屏 │        │ render/ Pixi 消费者   │
        └────────────────┘        └──────────────────────┘
```

这条边界由五条**机器检查**的约束维持（违反则构建失败）：

1. `core/` 不许 import `pixi` / DOM / UI
2. `core/` 里不许出现 `Math.random` / `Date.now`
3. `render/` 不许反向依赖 `core/` 内部
4. `core/` 里不许出现异步
5. 状态必须可结构化克隆、可哈希

**验收标准**：`core/` 能在 Node 里跑完一整场战斗并断言结果——不启动浏览器。

---

## 操作

### 键鼠

6 个技能铺在一块 **2×4** 上，每个技能一个字，图标就用那个字（楷体）：

```
上排   Q  W  E  R
下排   A  S  D  F
       ↑ 技能        ↑ 空着（留给以后的新技能）
```

| 键 | 字 | 消耗 | 效果 |
|---|---|---|---|
| `Q` | **斩** | 15 炁 | 普攻，造成 10 点伤害 |
| `W` | **轰** | 50 缠 | 造成 30 点伤害并使目标易伤 |
| `E` | **凝** | 50 缠 | 自身增伤 20%，持续 30 秒 |
| `R` | **破** | —（5 秒 CD） | **打断目标的任何招式** |
| `A` | **避** | 15 炁（1 秒 CD） | 0.5 秒完全无敌。**会打断自己的读条** |
| `S` | **防** | 按住，2 炁/秒 | 持续减伤 40%。松开即取消 |
| — | **闪** | 免费 | 0.1 秒无敌，**默认不绑键**（炁见底时的兜底） |
| — | **截** | — | 瞬发强打断；成功则派生「击」，失败进入完整冷却 |
| `Esc` / `,` | | | **打开设置**（顺带暂停） |

⚠️ 技能 id **不跟着显示名走**：「避」的 id 仍是 `dodge`、「斩」的 id 仍是
`attack`。改 id 会连带打断默认键位、绑定表、以及几处按 id 的判断
（改显示名只需要改 `src/i18n/locales/`）。

**改键**：设置 → 「按键」页。键位是**运行期可变状态**，所以按键名**不在 i18n 里**，
而是渲染时从键位表反查后拼上（改快捷键不需要动 i18n）。

### 触屏

移动端与桌面**共用同一套 canvas UI**，触屏只是再加一层虚拟按键（双弧布局）。

- **功能与键盘完全对等** —— 不许有"只有键盘能用"的功能
- 触屏按钮由**键位表机械派生**（"有键的技能"），与键盘是**同一张表**，
  不存在"另一套触屏配置"
- 能力探测**不看 UA**，用 `matchMedia('(pointer: coarse)')` + `(hover: none)`

### 数值刻度

玩家状态条上有三个单字：**血 / 炁 / 缠**。双方血量、炁、缠的上限都是 **100**。

- **逻辑步长 0.1 秒** —— 引擎内部仍是 60Hz（渲染要 60fps），
  但游戏逻辑以 0.1 秒为最小单位，所以内容里不会出现 0.267 秒这种脏数字。
  用 `logicTicks()` / `logicMs()`，**不许手写乘除**。
- **炁**（短循环资源，代码里的 `energy`）：每 0.1 秒回 1 点（= 10/秒）。
  供「斩」「避」「破」消耗 —— 所以"该躲时躲不躲得起"由它决定。
  ⚠️ **输出上限是它定的**：T 秒最多打出 `10 × T` 点伤害。
- **缠**（积攒型资源，代码里的 `douqi`）：**按伤害换算** ——
  造成 1 点伤害得 1 点，受到 1 点伤害也得 1 点。供「轰」「凝」消耗。

> 标识符与中文名不是直译关系：`energy` 是**炁**、`douqi` 是**缠**。
> **改中文名只动 `src/i18n/locales/`**，不影响引擎。

---

## Boss 的招式与应对

### 傲慢 —— 快慢刀

| 招式 | 读条 | 伤害 | 正确应对 |
|---|---|---|---|
| **轻蔑** | 1.0s | 20 | **「避」**（15 炁 ≈ 少打一次「斩」= 10 伤，换掉 20 伤） |
| **呵斥** | 1.5s | 40 | **「破」**（10 炁换 40 伤，最划算） |
| **碾压** | 2.0s | 60 | **「避」**（「破」无效、格挡只剩 25% 收益） |

⚠️ 这张表是按**当前数值**算的（判断依据：`炁` 的每秒回复量 vs 招式的伤害）。
数值一改就要重算 —— 它不是永久结论。

- 「碾压」**起手自带霸体**，覆盖整个前摇 —— 连「破」的强制打断也挡得住
- 血量掉到 **40%** 时有一次**「回补」**：2.5 秒读条、回复 30% 血量、
  **可打断**。全场只出现一次
- ⚠️ 读条 UI 是**固定宽度**的，所以分辨招式靠**剩余秒数数字 + 填充速度**，
  不是"条的长度"

### 色欲 —— 印记与眩晕

机制与傲慢完全不同（一样是"读前摇决定应对"，但资源换成印记层数）。
详见 [色欲设计文档](docs/specs/2026-10-10-lust-boss.md)。

---

## 开发

```bash
pnpm install
pnpm run dev            # 本地开发（http://localhost:5273）
pnpm run typecheck      # tsc --noEmit
pnpm run lint           # eslint .，含架构硬约束与 i18n 规则
pnpm run test:run       # 全部单测
pnpm run test:core      # 只跑纯逻辑，node 环境，不碰浏览器
pnpm run build          # 产出 dist/（base 为 /raid/）
```

### 校验流水线（改完必跑这四条）

```
pnpm run typecheck  →  pnpm run lint  →  pnpm run test:run  →  pnpm run build
```

**没有端到端脚本** —— 逻辑靠单测、UI 靠截图。

| 要验证的 | 用什么 |
|---|---|
| **逻辑**（结算、触发器、条件、内容、状态机） | **单元测试**。`src/core/` 是零依赖纯 TS，能在 Node 里直接跑 |
| **UI**（布局、位置、重叠、显隐、文案） | **截图**，然后**自己看图**判断 |

⚠️ **改完必须跑 `build`**，不能只跑 typecheck。仓库里有些素材是
**gitignore** 的（见「美术素材」），本地有、CI 没有 ——
测试一旦**静态 import** 它们，本地全绿而 CI 必挂。已有一条 lint 规则拦这个。

### 截图与调试参数

```bash
pnpm run shot /tmp/x.png        # 拍一张战斗截图（只拍图、不做断言）
pnpm run bench                  # 性能基准
```

| URL 参数 | 作用 |
|---|---|
| `?prepare=skip` | 跳过备战界面直接进战斗 |
| `?prepare=skip&boss=lust` | 指定 Boss 直接开一局 |
| `?noai=1` | Boss 不出招（观察用） |

⚠️ 画布有 letterbox：`clientY = rect.top + 逻辑Y × (rect.width / 960)`。

**lint 的硬约束不是风格偏好**：`core/` 里出现 `Math.random`、`import 'pixi.js'`、
`document`、`await`，或者 `src/` 下写死中文，都会**构建失败**。

推送 `main` 会触发 [.github/workflows/deploy.yml](.github/workflows/deploy.yml)：
typecheck → lint → test → build → 发布到 GitHub Pages。**任一步不通过则不发布。**

### 确定性重放

`tests/golden/replay.test.ts` 把**一整场战斗**压缩成一个可提交、可 diff 的常量：

```
固定种子 + 固定玩家策略  →  胜负 / 击杀用时 / 随机数终态 / 双方终局状态
```

它防的是**静默的行为变化** —— 改了一个数值、门禁顺序、AI 优先级或 tick 语义，
重放会立刻暴露。因为引擎没有 `Math.random`（lint 硬约束）、
随机数状态存在 `BattleState` 里，重放是逐位确定的。

⚠️ **`REPLAY_FORMAT_VERSION` 当前是 `2`**。改动引擎的确定性语义时必须 `+1`，
否则旧的重放文件会在新引擎上产生"看起来像 bug"的差异。测试会校验这个数字。

### 线上地址

**https://hdnray.github.io/raid/** —— 路径是 `/raid/`，不是仓库同名的
`/raid-simulator/`。所以 `vite.config.ts` 的 `base` 是 `/raid/`。

⚠️ **引用 `public/` 下的素材必须走 `assetUrl()`**（`src/render/assetUrl.ts`）。
硬编码 `/xxx.png` 会解析到**域名根**，线上必然 404 ——
而 dev 下 base 恰好是 `/`，所以这个 bug **在本地看不出来**。

### 分辨率

逻辑分辨率固定 **960×540**（16:9），渲染层按视口自适应缩放。

⚠️ canvas 的**内部缓冲跟着 CSS 尺寸与 DPR 走**（见 `render/scaling.ts`）。
CSS 拉伸会让画面变糊（视网膜屏上等效放大更多），所以 resize 会重建 framebuffer。

`image-rendering: pixelated` 已启用，所以非整数倍缩放是"**锐利但不均匀**"
（1px / 2px 交替），不是糊。细节见架构规范。

---

## 美术素材

⚠️ **角色 / 敌人 / 头像 / 战斗背景取自《炎龍騎士團2：黃金城之謎》
（漢堂國際資訊，1995，MS-DOS）。**

- 本项目是**非商业的个人作品**，供作者本人与朋友游玩
- 素材**一切权利属于原权利人**；本项目**不主张任何权利，也无权向他人授权**
- 素材仅在 `.gitignore` 的目录里，**不随仓库或发行版分发**
- ⚠️ **若要用于任何商业场合，必须先移除全部此类素材**，或取得权利人许可

完整说明（含素材清单、抽取流程、第三方工具授权）见
**[THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md)**。
**计划把这些素材整体换掉**，需求见
[美术替换需求](docs/art-brief-ai-replacement.md)。

### 素材目录

⚠️ `public/fd2/` **不入库**（约 54MB），需要时用 `artgen/` 的脚本重新生成。

| 目录 | 内容 |
|---|---|
| `public/fd2/rgba/` | **游戏实际用的**：10 个实体的战斗动画，已合成 RGBA + `manifest.json` |
| `public/fd2/animations/` | FIGANI 战斗动画逐帧 PNG + 合成 GIF（288 组） |
| `public/fd2/units/` | 1680 个 24×24 地图单位小人（4 方向 × 3 帧） |
| `public/fd2/portraits/` | 136 个人物头像（各 4 张嘴型帧） |
| `public/fd2/images/` | 标题图、战斗背景等全幅图 |
| `public/fd2/maps/` | 全部 33 张战场地图 |

浏览素材：`artgen/make_index.py` 生成 `public/fd2/INDEX.html`（540 个条目）。

### 出图（`artgen/`）

`artgen/` 是一个**独立于游戏代码**的工具目录（不入 `src/`，不参与 lint）：

```bash
python3 artgen/generate.py balance              # 查余额
python3 artgen/generate.py styles               # 拉风格目录
python3 artgen/generate.py estimate --prompt "..." --style rd_plus__classic
python3 artgen/generate.py gen --prompt "..." --style rd_plus__classic
python3 artgen/prepare_frames.py                # 帧 + 掩码 → RGBA，并生成 manifest
python3 artgen/make_index.py                    # 生成素材索引页
```

- key 放 `artgen/.env`（**已 gitignore**），或设环境变量 `RD_API_KEY`
- `estimate` 是**免费试算**，不出图不扣费
- ⚠️ `--negative` 字段**当前无效**（服务方文档说没有模型使用它）——
  想排除什么就改写正向 prompt

---

## 发布密钥

推送 `main` 需要 `SSH_DEPLOY_KEY` secret 才能发布到 GitHub Pages。
配置步骤见 [docs/setup-deploy-key.md](docs/setup-deploy-key.md)，约 3 分钟。
