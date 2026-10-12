# 肉鸽（roguelike）机制设计 —— 随机 Boss 顺序 / 强度曲线 / 角色与「炁机」

> 日期：2026-10-12
> 状态：**待评审**。本文只是设计，**不含实现代码**（`src/` 一行未改，未 commit、未 push）。
> 前置：[架构与 UI 规范](./2026-10-09-architecture.md) ·
> [数据模型规范](./2026-10-09-data-model.md) ·
> [i18n 规范](./2026-10-09-i18n.md) ·
> [「傲慢」Boss 设计](./2026-10-11-pride-boss.md) ·
> [「色欲」Boss 设计](./2026-10-10-lust-boss.md)
>
> 定位：**新增一层"局"（run）**，把现有"选人 → 单场战斗 → 结算"包成
> "选角色 → N 场连续战斗 → 每场之后选一个炁机"。引擎（`core/combat/`）
> **基本不动**；新增的是**元层（run）**与**内容装配**。

---

## 0. 范围

### 0.1 本文要做的事

| # | 交付 | 验收（读完本文能判断） |
|---|---|---|
| **A** | 7 个 Boss **出场顺序随机**，且由种子决定 | §7 说清种子从哪来、存在哪、怎么不破坏黄金重放 |
| **B** | 按**当局出场序号**的**强度曲线**：越后越难 | §6 给出具体档位表（数值 + 机制两张） |
| **C** | 难度**不只加数值**，机制也变（例：第 3/4 位起才开二阶段） | §6.2 每条机制都指到**现有引擎的确切函数/字段** |
| **D** | 3 个角色选 1，各有**初始技能套** | §4 给出数据模型 + 现状差距 + 渐进方案 |
| **E** | 「炁机」= 该角色的强化方向/奇物/奖励 | §5.1 数据模型 |
| **F** | 解锁条件是**行为式**的（如"成功使用 3 次截"） | §5.2 写清**复用哪套、差在哪、补什么** |
| **G** | 解锁是**当局内**的；每场战斗后从已解锁里**选 1 个生效** | §5.3 语义（能否叠、能否换、顺序） |
| **H** | 兜底选项：**+30 血量** | §5.4（含"能不能重复选"的正面回答） |
| **I** | 新的局内交互流程 | §3 逐屏状态机 + 复用/新做表 |
| **J** | **现有备战界面保留**（方便开发测试） | §3.4 明确它的语义与位置 |
| **K** | 可独立验收的落地阶段 | §10 |

### 0.2 本文**不包含**

- 实现代码、commit、push（用户明确要求）。
- **5 个未开发 Boss 的具体机制**（`envy` / `gluttony` / `wrath` / `sloth` /
  `greed`）。它们要做各自的 `boss spec`，本文只说"强度曲线在这 5 个做出来
  之前怎么落地"（§2.3）。
- **卡莉 / 玳瑄两套技能的招式设计**。本文只给"角色数据该怎么落"与
  "为什么现在做不到"；招式本身是内容设计。
- 数值平衡矩阵。仓库自己的定位是"数值还会大改、机制优先"
  （`docs/specs/2026-10-10-lust-boss.md` §0.2），所以本文只给**旋钮**与
  **目标形状**，不给"第 N 场应该剩多少血"的保证。
- UI 线框图 / 截图 / mockup。
- 局内存档（`localStorage` 保存 RunState）—— 只在 §11 列为风险与待办。

### 0.3 现状核实（每条都可复核，这是设计的**唯一前提**）

| 事实 | 值 / 结论 | 证据 |
|---|---|---|
| Boss 名单 | 7 个：`meiichiro`(傲慢) / `lust`(色欲) / `envy` / `gluttony` / `wrath` / `sloth` / `greed` | `src/data/roster.ts:60-69` |
| **真能打的 Boss** | **只有 2 个**（傲慢、色欲）。其余 5 个在 `DEVELOPING` 里，备战界面灰掉、不能开战 | `src/data/roster.ts:87-95`、`data/units.ts:99-105` |
| 未开发 Boss 的行为表 | **借用于「傲慢」的轮转**（占位，防"从存档/调试路径进来崩掉"） | `src/data/units.ts:88-105` |
| 角色名单 | 3 个：`player`(林晚风) / `kaili` / `daixuan` | `src/data/roster.ts:48-52` |
| **真能玩的角色** | **只有 1 个**（林晚风）；`kaili` / `daixuan` 在 `DEVELOPING` 里 | `src/data/roster.ts:87-95` |
| **3 个角色机制上完全相同** | `makePlayer(id)` **只用 id 取 `nameKey`**；属性用全局 `PLAYER_BASE`、资源上限用全局 `PLAYER_CAPS`、技能来自全局 `PLAYER_SKILLS` | `src/data/units.ts:62-79`、`src/data/units.ts:35-52` |
| 玩家技能全集 | 9 个：`attack` / `blast` / `focus` / `break` / `dodge` / `guard` / `flash` / `jie` / `strike`(派生) | `src/data/content.ts:545-557` |
| 默认键位 | **全局一张表**；`flash` / `jie` 默认 `key: ''`（可绑、不上场），`strike` 不在这张表里（靠派生出现） | `src/input/keyboard.ts:53-83`、`data/playerSkills.ts:158-198` |
| "哪些技能是玩家的" | 全局唯一真相 `PLAYER_SKILL_IDS`，**没有任何 per-character 概念** | `src/data/content.ts:585-587` |
| **引擎的边界 = 单场战斗** | `BattleEngine` 是"一个 encounter"的状态机；"重开"是**重建一个 `BattleLoop`**，不是引擎里的第二场 | `src/core/combat/battleState.ts:74-83`、`src/app/battleSetup.ts:59-117`、`src/app/game.ts:221-222` |
| 种子从哪来 | app 层 `seed: Date.now() >>> 0`（**core 禁 `Date.now`，app 层允许**） | `src/app/battleSetup.ts:89-90` |
| 两条随机流 | `BattleState.rngSeed`（玩家侧）+ `BattleState.aiRngSeed`（AI 选招），**刻意分开** | `src/core/types/runtime.ts:73-88`、`src/core/ai/index.ts:57-63` |
| 随机数工具 | `core/rng.ts` 的 mulberry32（`nextRandom` / `randomInt` / `rollChance`），**状态手动穿线、纯函数** | `src/core/rng.ts` |
| 重放格式 | `REPLAY_FORMAT_VERSION = 2`；`RecordedRun = {version, seed, ticks, input}`，**一场一份**；测试断言它就是 2 | `src/core/run.ts:44-62`、`tests/golden/replay.test.ts:81-88` |
| 界面阶段 | `Phase = 'prepare' \| 'battle'`，**两个值** | `src/app/flow.ts:37-38` |
| 结算 | 结算面板画在 `BattleScene` 里（`renderResultPanel`）；结束后 **Enter / 触屏点屏 → `backToPrepare()`** | `src/render/resultPanel.ts:32-76`、`src/app/loopWiring.ts:166-172`、`src/app/canvasInput.ts:96-107` |
| 备战界面的语义 | **"选人物 + 选 Boss + 开始"**（玩家可以直接挑对手），并在"开始"那一刻才判 `isDeveloping` | `src/ui/prepareLogic.ts:275-359`、`src/ui/PrepareScreen.ts:71-96` |
| 事件流 | 每 tick `drainEvents()` **排空一次**，被 `ViewAdapter`（飘字）+ `logFormatter`（日志）消费；**原始 `EventDef[]` 不向外暴露** | `src/app/battleLoop.ts:354-362` |
| 炁机可用的"生效"通道 | `CreateBattleOptions.passiveModifiers: Map<id, StatModifier[]>` 被引擎读取；固有 buff 走 `Combatant.buffs`（`innateBuffsFor` 的手法） | `src/core/combat/stats.ts:101`、`src/data/units.ts:142-151` |
| 「闪避成功」有独立事件 | `{kind:'avoided', sourceId, targetId, skillId, reason:'dodged'\|'immune'}` —— run 层的"闪避计数"可以直接用它 | `src/core/events.ts:75-83`、`core/combat/index.ts:480` |

> ⚠️ **一个工作区状态说明**：`src/main.ts` 当前**正在被拆成 `src/app/*`**
> （`bootstrap.ts` / `deps.ts` / `flow.ts` / `game.ts` / `loopWiring.ts` /
> `battleSetup.ts` …，本轮 `git status` 里是未提交状态）。本文按**拆分后**
> 的结构引用（`flow.ts` / `game.ts` / `loopWiring.ts` / `canvasInput.ts`）。
> 若该拆分回退，同一批接线都在 `main.ts` 里，位置一一对应。

#### 0.3.1 ⚠️ 引擎里**声明的**机制 vs **真正生效的**机制

这一节决定"机制解锁表能不能只写数据"。**下列结论每条都做了全仓 grep。**

| 机制 | 状态 | 证据 |
|---|---|---|
| `Behavior: 'opener'` | ✅ 生效（未用过的 opener 到点就出） | `core/ai/index.ts:138-152` |
| `Behavior: 'onHpBelow'` | ✅ 生效（跨过阈值 → 发 `thresholdReached` → 执行 `then`） | `core/ai/index.ts:154-162`、`core/combat/runAi.ts:205-214` |
| `Behavior: 'enrage'` | ✅ 生效（授予 `boss-enrage`，`damageMultBoost: 2`） | `core/ai/index.ts:164-171`、`core/combat/stats.ts:64-75`、`data/bossShared.ts:58-68` |
| `Behavior: 'rotation'`（顺序即优先级） | ✅ 生效 | `core/ai/index.ts:176-183` |
| `Behavior: 'weightedRotation'`（加权 + `when` + `gapMs`） | ✅ 生效 | `core/ai/index.ts:185-195` |
| `Behavior: 'timeLimit'` | ❌ **无运行时消费者**。时限来自 `CreateBattleOptions.timeLimitMs`，不是行为数组 | `core/combat/encounterEnd.ts:29-37`、`core/combat/battleState.ts:583` |
| `Behavior: 'interruptible'` | ❌ **死类型**。校验器认它，`decide()` 里没有分支 | `core/content/validate.ts:523-524`，`core/ai/index.ts` 无 `interruptible` |
| `Hook: 'onInterruptSuccess'` | ❌ **不派发**。引擎实际只派发 3 个 hook | `core/combat/triggers.ts:52-56`（白名单里只有 `onHitTaken` / `onBuffApplied` / `onBuffExpired`） |
| `Hook: 'onPhaseChange'` | ❌ **不派发**（全仓无触发点） | 只在 `core/types/triggers.ts:34` 出现 |
| `Combatant.counters` / `Expr {e:'counter'}` | ❌ **读取恒为 0，且没有任何写入者**。战斗路径的 `getCounter` 是 `() => 0` 的桩 | `core/combat/stats.ts:138`、`core/expr/eval.ts:85-87` |
| `Ability: 'grantSkill'` | ❌ **无执行点**（有类型、有校验） | `core/combat/runAi.ts:104-147` 只处理 `grant` / `resource` / 嵌套 `trigger` |
| `Ability: 'consume'` | ❌ `runAbilities` 里没有分支 | 同上 |
| `Loadout` / `GameEntity.items`（装备/奇物那条路） | ❌ 无引擎消费者；注册表里 `entities: []` | `src/app/deps.ts:48-51`、`core/types/loadout.ts:53-58` |

**这张表有两个直接后果：**

1. **"机制解锁"如果没有对应内容，就只是空话。** 引擎支持的只有 5 种行为 +
   2 种 buff 旗标（`interruptImmune` / `restrictToTags`）+ 1 个 `stun` 效果。
   所以 §6.2 的每一条都必须是"**现有机制的开关**"，且要标出**内容缺哪个**。
2. **"成功使用 3 次截"今天表达不了**（`onInterruptSuccess` 不派发、
   `counters` 是死的）。§5.2 给出成本最低的补法。

---

## 1. 设计目标：一局里玩家应该面对什么

一句话：**把"选一个 Boss 打一场"变成"带着一个角色和一个不断变强的配置，
穿过一条越来越窄的走廊"。**

三个张力，按重要性排序：

| # | 张力 | 靠什么产生 |
|---|---|---|
| 1 | **未知**：下一场是谁、更难在哪 | Boss 顺序随机（§2）+ 强度曲线（§6） |
| 2 | **取舍**：每场只能拿一个强化 | 炁机解锁 + 每次三选一（§5） |
| 3 | **稀缺**：解锁条件要求你**主动去做某事** | 行为式解锁条件（§5.2） |

第 3 条是这个设计的**核心**（也是用户点名要的）：如果解锁只是"打赢就送"，
那它退化成数值堆叠；要求"成功使用 3 次截"意味着**玩家必须改变打法去够
那个条件** —— 而"截"的风险是"打空了要等 10 秒"（`data/playerSkills.ts:72-93`），
所以这是一个**有代价的选择**。

---

## 2. 核心概念：什么是"一局"

### 2.1 定义

| 概念 | 定义 | 边界 |
|---|---|---|
| **Battle（一场）** | 一个 `BattleEngine` 从 `running` 到 `victory`/`defeat` | 就是今天已有的东西，**不改** |
| **Run（一局）** | 从"选定角色"到"某一战失败"或"打完最后一战" | **新增**，住在 `core/run/`（§9） |
| **Position（序号）** | 本局内这一场是第几位（0-based 或 1-based） | 决定强度档（§6） |
| **Order（顺序）** | 本局 7（或 `pool.length`）个 Boss 的一个排列 | 由 `runSeed` 决定（§7） |

**为什么"一局"必须是新概念、不能塞进 `BattleState`：**

- `BattleState` 是**单场**、**可结构化克隆、可哈希**（`core/types/runtime.ts:66-72`），
  并且被 `tests/golden/replay.test.ts` 逐位钉死。
- 把跨场数据（解锁、计数器、顺序）塞进去，会让"第 3 场的重放"依赖
  "第 1、2 场的输入"，重放文件爆炸，而且黄金基线会跟着变。
- 反过来，放在 app 层（`app/`）也没有坏处 —— 除了**不能写单测**
  （`src/core/` 是零依赖纯 TS，能在 Node 里直接跑；app 层要 DOM）。

**所以：一局 = 一个新的纯逻辑层 `src/core/run/`，它零依赖、无
`Math.random` / `Date.now`、状态是 plain object、可 JSON 序列化、可哈希。**

### 2.2 生命周期与失败代价

```
startRun(runSeed, playerId)
   → order = shuffle(pool, runSeed)          // §7
   → position = 0
   → counters = {}, unlocked = [初始炁机], chosen = []

每场结束：
   胜 → position += 1
        → 若 position === order.length：status = 'victory'（通关）
        → 否则：结算 → 选炁机 → 开下一场
   负 → status = 'defeat'（一局结束）
```

**中途失败是"全丢"还是"带进度重来"？**

| 方案 | 得到 | 放弃 |
|---|---|---|
| **A（推荐）全丢**：失败即回"选角色" | 规则最简；失败有真实重量；与"一局内的成长"不冲突 | 一局 ~7 场 × ~90s ≈ **10 分钟**，一次失误全丢，惩罚偏重 |
| B 失败回第 1 场、**保留已解锁炁机** | "带着知识重来"，挫败感低 | 需要区分"本局内解锁"与"跨局永久解锁"两套状态；而用户要的是**当局内**解锁，B 会让这两者打架 |
| C 每场之间存检查点 | 惩罚最轻 | 需要 RunState 持久化 + 版本迁移；且会让"失败"几乎无成本，随机顺序的紧张感消失 |

→ **推荐 A**。理由：用户的验收里没有"永久成长"，而 B/C 都会引入第二套
状态（跨局 vs 当局），那正是 §5 的语义最难说清楚的地方。
**代价要说清**：10 分钟一局 + 全丢 = 失败体验很重。若实测觉得太重，
最小改动是"**失败后允许重打当前这一场一次**"（不引入跨局状态）。
→ 见 §12 开放问题 Q1。

### 2.3 7 场是固定的吗？只有 2 个 Boss 能打怎么办

**结论：局长 = `BOSS_POOL.length`，不写死 7。**

| 阶段 | `BOSS_POOL` | 一局几场 | "越后越难"还成立吗 | 顺序随机有意义吗 |
|---|---|---|---|---|
| **今天** | `[meiichiro, lust]` | **2** | ✅ 成立（第 1 场最软、第 2 场最难） | ❌ **没有意义**（2 个的排列只有 2 种，且都等价于"先软后硬"） |
| 做一个 Boss | 3 | 3 | ✅ | ✅（6 种排列） |
| 做两个 | 4 | 4 | ✅ | ✅（24 种） |
| 全做完 | 7 | 7 | ✅ | ✅（5040 种） |

**为什么不"用占位轮转假装 7 个都能打"：** 5 个未开发 Boss 共用「傲慢」的
行为表（`data/units.ts:88-105`），对玩家来说"第 4 场是嫉妒"和第 4 场是
"换了个名字的傲慢"没有区别 —— 那会让"随机顺序"看起来像 bug。

**所以落地的规则是：**

```
BOSS_POOL = BOSS_ROSTER.filter(e => !isDeveloping(e.id))
局长 = BOSS_POOL.length
```

- `pool.length === 1` → **不洗牌**、**只打 1 场**（当前单场体验的退化形态，
  给"刚做完第一个 Boss"用）。
- `pool.length === 2` → 洗牌但两名等价；**机制解锁（§6.2）按归一化进度触发**
  （见 §6.1），所以第 2 场仍然会"更难"。
- 开发/调试用 URL 参数覆盖：`?runlen=1`（只打一场）、`?runlen=99`
  （循环取 Boss，用于压力测试）—— 走与玩家同一条代码路径，不是旁路
  （与 `?prepare=skip` 同一思路，`src/app/game.ts:143-150`）。

**打完最后一战算通关吗？** 算。`order.length` 场全胜 → `status='victory'`，
给一个明确的"通关"结算（复用 `RunOverScreen`，§3）。

---

## 3. 新的交互流程

### 3.1 状态机（逐屏）

```
                         ┌──────────────────────────────┐
                         │ Boot                          │
                         └───────────────┬───────────────┘
              mode=roguelike（默认）      │        mode=dev（?prepare=skip / ?mode=dev）
        ┌────────────────────────────────┴────────────────────────────┐
        ▼                                                             ▼
┌──────────────────┐                                       ┌──────────────────────┐
│ CharacterSelect  │  3 张卡（2 张灰"开发中"）             │ Prepare（现有，保留） │
│ 选 1 个角色      │  ←→ 移光标 / Enter 确定 / 点卡确定     │ 选人物 + 选 Boss      │
└────────┬─────────┘                                       └──────────┬───────────┘
         │ Enter                                                     │ Enter
         ▼                                                           ▼
┌──────────────────┐                                       ┌──────────────────────┐
│ RunIntro         │  显示本局顺序？还是盲打？（§12 Q9）     │ Battle（单场，现状）  │
│ 开局（可选屏）    │  Enter / 点"开始"                       │                      │
└────────┬─────────┘                                       └──────────┬───────────┘
         ▼                                                           │ 胜/负
┌──────────────────┐                                                 ▼
│ Battle（run 第1场）│◄──────────────┐                        ┌──────────────────────┐
└────────┬─────────┘               │                        │ Result（现有结算面板）│
         │ 胜                      │                        │ Enter/点屏 → Prepare  │
         ▼                          │                        └──────────────────────┘
┌──────────────────┐               │
│ Result（结算）    │  Enter/点屏    │
└────────┬─────────┘               │
         │ 还有下一场               │
         ▼                          │
┌──────────────────┐               │
│ QijiSelect       │  候选 = 已解锁炁机 + 兜底(+30 血)
│ 选 1 个生效       │  ←→ 移光标 / Enter 确定 / 点卡确定
└────────┬─────────┘               │
         │                         │
         └─────────────────────────┘
         下一场（Boss = order[position]，档位 = tier(position)）

  任一场负 ──► RunOver（失败：显示打到第几场）
  最后一战胜 ─► RunOver（通关：显示本局用了哪些炁机）
  RunOver：Enter / 点屏 ──► CharacterSelect
```

### 3.2 阶段枚举的改动

现在是 `Phase = 'prepare' | 'battle'`（`src/app/flow.ts:37-38`）。新增后：

```ts
export type Phase =
  | 'prepare'        // 开发用（现有语义，一字不改）
  | 'characterSelect'
  | 'battle'
  | 'qijiSelect'
  | 'runOver';
```

**刻意不新增 `'result'`**：结算面板本来就画在 `BattleScene` 里
（`render/BattleScene.ts:544-548`），把它提升成一个独立 phase 会让
"战斗场景的显隐"多一个状态，而现有代码的注释已经把"两个界面同时可见"
列为踩过的坑（`src/app/game.ts:204-206`）。**结算 = `battle` phase 内的
一个子状态**，由 `snapshot.status !== 'running'` 表达（现有做法）。

⚠️ 想加 phase 就必须同时改这几处（现在都 switch 在 `phase` 上）：

| 位置 | 现在读什么 | 要改成什么 |
|---|---|---|
| `src/app/loopWiring.ts:86` | `phase === 'prepare'` → 只 frame 备战 | 按 phase 分发到各自的屏 |
| `src/app/loopWiring.ts:132-172` | 备战/战斗两段键盘 | 每段按 phase 分派（Enter 的语义在 4 个屏里都不同） |
| `src/app/canvasInput.ts:43,93,96` | `phase() === 'prepare'` + 结算点屏 | 新屏的命中分支插在"设置"之前、按优先级排序（该文件 §"顺序即优先级"） |
| `src/app/game.ts:316,346,363` | `isPrepareOpen` / `phase` / `acceptsKeyboardFocus` | 触屏层要**在非 battle 的一切 phase 都隐藏** |
| `src/app/flow.ts:37` | `Phase` 联合 | 加 3 个值 |

### 3.3 复用 / 新做

| 屏幕 | 复用 | 新做 |
|---|---|---|
| `CharacterSelect` | **卡片渲染 + 命中区 + 光标模型**：`prepareLogic` 的 `cycleCursor` / `moveFocus` / `confirmCursor` / `pickOption` 几乎原样可用 | 新的三卡屏（或把 `PrepareScreen` 参数化成"几行槽位"） |
| `QijiSelect` | `Panel` / `Label` / `IconButton` 原语；`prepareLogic` 的光标/命中区模式 | 卡片要显示"解锁条件进度"（如 `截 2/3`）→ 需要新的**进度文案**（i18n 参数） |
| `Result` | 现有 `renderResultPanel` **零改动** | 只加一条"继续"提示的 i18n key |
| `RunOver` | `Panel` / `Label`；结算摘要可复用 `resultPanel` 的排版 | 通关/失败两种文案 + 本局统计（打了几场、带了哪些炁机） |
| `Prepare` | **原样保留** | 无 |

**建议抽一个 `ui/cardSelectLogic.ts`**（纯逻辑，可在 Node 里测）承载
"上下换槽 / 左右移光标 / Enter 确定 / 点击=移光标+确定"这套交互，
让 `PrepareScreen` / `CharacterSelect` / `QijiSelect` 共用。

- **为什么**：三个界面的交互**完全同构**，而 `prepareLogic` 里已经写着
  "光标与选择是两个独立概念""点击 = 移光标 + 确定（为了触屏与键盘对等）"
  两条来之不易的结论（`src/ui/prepareLogic.ts:19-37,297-306`）。复制三份
  = 三份会各自漂移的规则。
- **放弃了什么**：这是一次**重构**，会动 `PrepareScreen` 与
  `prepareLogic` 的调用点（以及 `tests/unit/prepareLogic.test.ts`、
  `tests/unit/prepareRender.test.ts`）。若不想在第一阶段承担这个代价，
  退路是**先复制一份 logic**，等三个屏都稳定后再合并 —— 但要在
  代码注释里显式记下"这里有两份，合并是待办"。

### 3.4 ⚠️ 备战界面在新流程里的位置（用户点名要明确）

**选择：`Prepare` = 开发/测试入口，不是正式流程的"选角色"页。**

理由：

1. **语义冲突**。备战界面的核心能力是"**玩家直接挑 Boss**"
   （`prepareLogic.ts:275-295` 的 `confirmCursor`，与 `PrepareScreen` 的
   boss 卡片行）。而肉鸽模式的**第一条规则就是"不许挑 Boss"**
   （顺序随机）。同一个界面同时承担这两种语义，只能靠"肉鸽模式下把
   Boss 行灰掉"来实现 —— 那就是把备战的**主要功能**在正式流程里废掉，
   却还留着它的 UI，玩家会困惑"为什么这一行点不了"。
2. **测试需要完整能力**。开发时要能"指定任意 Boss + 任意角色 + `?noai=1`
   静止场景截图"（`data/units.ts:108-115` 的 `noAi` 就是为这个存在的）。
   这个能力不该被塞进正式流程。
3. **入口可共存**。正式流程走 `CharacterSelect`，开发走 `?mode=dev`
   或 `?prepare=skip`，两者**互不影响**、都不用改现有代码。

**放弃了什么**：玩家路径上会**多一个屏**（`CharacterSelect`）才能开始，
而备战界面在正式流程里**看不到**（只有带参数时才出现）。
如果希望玩家也能像现在一样"直接挑 Boss 打一场"，那就是
§12 Q5 的开放问题。

### 3.5 输入：键盘与触屏**必须对等**（AGENTS.md §3b）

| 屏幕 | 键盘 | 触屏 | 对等性怎么保证 |
|---|---|---|---|
| `CharacterSelect` | ←→ 移光标；↑↓/Tab 换槽（如有）；Enter 确定；Esc 返回 | **点卡片 = 移光标 + 确定**（`pickOption` 的语义） | 复用 `prepareLogic.pickOption` —— 它的注释明确说"点击必须一步确定，否则触屏玩家永远停在只移动了光标" |
| `RunIntro` | Enter = 开始 | **点"开始"按钮** | 不能只让 Enter 能开始（这是仓库踩过的坑：改键只有 Enter 一条路，触屏进不去） |
| `Result` | Enter = 继续 | 点屏任意处 = 继续（现有路径，`canvasInput.ts:96-107`） | 已有 |
| `QijiSelect` | ←→ 移光标；Enter 确定；可选 `1..9` 直达 | 点卡片 = 确定 | 数字键是**加速器**，不是唯一路径；触屏靠点卡片 |
| `RunOver` | Enter = 回选角色 | 点屏任意处 | 同上 |

**键位提示不进 i18n**（AGENTS.md §3b）：新屏的"继续 (Enter)"要由渲染层
拼上按键名，触屏不拼。i18n 里只放 `'继续'`。

**一个要处理的边界**：`wireSettingsKeys` 的
`acceptsKeyboardFocus: () => state.phase === 'battle'`（`game.ts:363`）——
新屏里 ↑↓/Enter 属于界面本身，所以设置按钮**不能**抢焦点；
保持"只在 `battle` 允许"即可，但要显式确认（否则新屏按 `Enter` 会先
开设置，而那种 bug 在截图里看不出来，见 `flow.ts:85-88` 的由来）。

---

## 4. 角色与初始技能套

### 4.1 现状：3 个角色**机制上完全不同 = 不存在**

- `PLAYER_ROSTER` 有 3 条（`roster.ts:48-52`），但 `makePlayer(id)`
  **只用 id 取显示名**，属性/资源/技能全部来自全局常量
  （`units.ts:35-52,62-79`）。
- "哪些技能是玩家的"由全局 `PLAYER_SKILL_IDS` 决定（`content.ts:585-587`），
  设置页、触屏按钮、技能栏三处都从它（或 `DEFAULT_BINDINGS`）派生。
- 所以**今天给 3 个角色写 3 套技能，没有任何数据结构可以承载它。**

### 4.2 角色数据模型（新增 `src/data/characters.ts`）

```ts
/** 一个可玩角色的全部差异。⚠️ 只放"角色之间不同"的东西。 */
export interface CharacterDef {
  readonly id: EntityId;              // 'player' | 'kaili' | 'daixuan'
  readonly nameKey: LocaleKey;        // 复用 roster 的 key，不另起
  /** 覆盖 PLAYER_BASE（缺省字段回落全局默认） */
  readonly base: Partial<Record<StatKey, number>>;
  /** 覆盖 PLAYER_CAPS —— 「炁机 +30 血」也走它（§5.4） */
  readonly caps: { readonly hp: number; readonly energy: number; readonly douqi: number };
  /** 初始技能套：这个角色**拥有**哪些技能 */
  readonly skills: readonly SkillId[];
  /** 这些技能默认绑哪些键（空串 = 可绑但不上场，沿用现有约定） */
  readonly bindings: readonly KeyBinding[];
  /** 固有被动（开局就挂的 buff）—— 复用 units.ts 的 innateBuffsFor 手法 */
  readonly innate: readonly BuffDef[];
}
```

### 4.3 三个角色各自的"初始技能套"是什么？现有技能够不够？

**够不够，分两问：**

| 问题 | 答案 |
|---|---|
| 引擎/内容模型能不能表达"角色专属技能"？ | ✅ **能**。`SkillDef` 已支持瞬发/读条/多段/消耗/派生（`requires`）/tag/被动（`kind:'passive'`），不需要新字段 |
| 现有数据管道能不能**按角色**给出不同技能？ | ❌ **不能**。`PLAYER_SKILL_IDS`（`content.ts:585`）与 `DEFAULT_BINDINGS`（`keyboard.ts:53`）**都是全局单例**，`parseBindings(raw, validSkillIds)` 收的是全局集合（`settingsStore.ts:97-100`），`slotsFromBindings` 也是全局（`viewAdapter.ts:25`）。要 per-character，必须把这两张表**参数化** |

**林晚风的"初始技能套"（今天的事实，不是设计）：**

| 类别 | 技能 | 备注 |
|---|---|---|
| 技能栏（默认绑键） | 6 个：斩 `attack`(Q) / 轰 `blast`(W) / 凝 `focus`(E) / 破 `break`(R) / 避 `dodge`(A) / 防 `guard`(S) | `keyboard.ts:53-59` |
| 可绑但默认不上场 | 闪 `flash`、截 `jie`（`key: ''`） | `keyboard.ts:60-83` |
| 不由玩家直出 | 击 `strike`（派生技，`requires: hasBuff 'combo-window'`） | `data/playerSkills.ts:158-198` |

**卡莉 / 玳瑄：`null`。** 今天它们没有任何技能、属性、被动差异。
所以"它们各自的初始技能套"是**新内容设计**，本文只给结构与骨架：

| 角色 | 设计意图（**待内容作者拍板**） | 需要的新内容 |
|---|---|---|
| 林晚风 | 均衡：打断（破/截）+ 派生（击）+ 完整防御 | 已有 |
| 卡莉 | 建议方向：**资源/节奏型**（炁流转更快、更依赖派生窗口） | 技能 3~4 个 + 固有被动 1 个 |
| 玳瑄 | 建议方向：**防御/反制型**（格挡收益、受击触发） | 技能 3~4 个 + 固有被动 1 个 |

⚠️ **本文不建议"现在就设计卡莉/玳瑄的招"** —— 那会与"7 个 Boss 还没做完"
抢资源，而且没有可玩性验证。

### 4.4 渐进方案（推荐路径）

| 阶段 | 做到什么 | 代价 |
|---|---|---|
| **R0（现在）** | 3 个角色全部**只差属性 + 1 个固有被动**，技能套**共享** `PLAYER_SKILLS` | 几乎零改动：`makePlayer(id, character)` 读 `CharacterDef.base/caps/innate`；`battleSetup.ts` 的 `baseStats` map 已经是 per-combatant（`battleSetup.ts:95-98`） |
| **R1** | "选角色"界面出现，3 张卡（2 张灰"开发中"），**可玩 1 个** | 新增屏；`Phase` 加值 |
| **R2** | 卡莉可玩（**共享技能池 + 不同属性/被动**） | 内容设计 |
| **R3** | 卡莉有**专属技能套** → 这时才把 `PLAYER_SKILL_IDS` / `DEFAULT_BINDINGS` 参数化 | **跨 4 层改动**：`data/characters.ts`（数据）+ `app/deps.ts`（按角色取合法技能集）+ `input/keyboard.ts`（默认键位）+ `ui/prepareLogic`/设置页（"可绑技能"按角色过滤）+ 触屏按钮（`touchButtonsFromBindings`） |
| **R4** | 玳瑄同上 | 同 R3 |

**R0 的关键理由**：用户要的是"从 3 个角色里选 1 个"这个**决策**，
而决策可以只靠属性/被动差异成立（"这个角色炁回得快、那个角色更肉"）。
把它先做成"3 套技能"会让第一步就撞上 R3 那个跨层改动，
而那时还没有任何内容需要它。
→ 但这是**取舍**：只差属性的话，3 个角色的**玩法差异很小**，
可能不满足用户对"3 个角色"的期待。→ §12 Q6。

---

## 5. 「炁机」系统（设计重心）

### 5.1 数据模型：`QijiDef`

**先回答"是不是新的 `GameEntity`"：不是。** 三条理由：

1. `GameEntity`（`core/types/skills.ts:55-79`）是"可持有/可使用的内容"，
   它的实例化路径是 `Loadout` / `GameEntityInstance`（`core/types/loadout.ts`），
   而**那条路引擎完全没有消费者**（注册表 `entities: []`，见 §0.3.1）。
   塞进去等于挂在一个死管道上。
2. 炁机需要表达的是"**解锁条件**"，而 `GameEntity.requires` 是
   **战斗内**的 `Condition`（由 `checkGate` 求值，`core/types/stats.ts:112-127`）。
   语义不同，硬塞会让类型撒谎。
3. 炁机"生效什么"确实**应该复用** `Ability[]` —— 但那是字段复用，
   不是类型继承。

```ts
/** 一个炁机（强化方向 / 奇物 / 奖励）。 */
export interface QijiDef {
  readonly id: QijiId;                 // 'jieDeriveStrike'
  readonly nameKey: LocaleKey;         // 'qiji.jieDeriveStrike.name'
  readonly descKey: LocaleKey;
  readonly icon: string;
  /** 仅用于 UI 分组与排序，不参与任何判定。 */
  readonly category: 'offense' | 'defense' | 'tempo' | 'utility';
  /**
   * 解锁条件。**不是**引擎的 `Condition` —— 见 §5.2 的说明。
   */
  readonly unlock: QijiUnlock;
  /**
   * 解锁后生效什么。**直接复用引擎的 `Ability[]`**：
   *   modifier / derived → 装配成 `passiveModifiers`
   *   grant(self, 永久) / trigger → 装配成固有 buff
   */
  readonly abilities: readonly Ability[];
  /**
   * 可否被**重复选取**。默认 1（每局最多带一层）。
   * ⚠️ 见 §5.4 关于"无限堆血"的平衡风险。
   */
  readonly maxStacks?: number;
}
```

**两条硬约束（写进设计与将来的校验器）：**

| 约束 | 为什么 |
|---|---|
| 炁机的 `Ability[]` **只允许 `modifier` / `derived` / `grant`(self, `duration: Infinity`) / `trigger`** | 这四种是"进入战斗时就存在"的形态，能被装配成 `passiveModifiers` / 固有 buff。`deal` / `consume` / `grantSkill` / `stun` 在 `runAbilities` 里没有执行点（§0.3.1），写了就是静默无效 |
| **禁止 `op: 'setOverride'`** | 见 §5.3"叠加顺序" |

### 5.2 解锁条件：优先复用 `Condition` 吗？

**结论：复用不了。** 差在两处，都要补。

| | 引擎的 `Condition`（`core/types/stats.ts:112-127`） | 炁机需要的 `QijiUnlock` |
|---|---|---|
| 求值上下文 | **一场战斗的快照**（`Combatant` / `Expr`，见 `core/expr/eval.ts`） | **本局的累计**（跨场） |
| 能读的计数 | ❌ 什么计数都读不到：`Expr {e:'counter'}` 在战斗路径的 `getCounter` **恒返回 0**（`core/combat/stats.ts:138`），而 `Combatant.counters` **没有任何写入者** | 需要 `截成功数` / `闪避数` / `场次` … |
| "成功使用 3 次截" | ❌ 做不到：`onInterruptSuccess` **不被派发**（`core/combat/triggers.ts:52-56` 只有 3 个 hook） | 需要 |

**所以新增一个 run 层的判定语言（不是 `Condition` 的替代，是它的上层）：**

```ts
/** 一局内可累计的行为计数（**唯一写入路径**见 §5.2.3）。 */
export type RunCounter =
  | 'jieInterrupts'     // 「截」成功打断的次数
  | 'interrupts'        // 任何技能成功打断的次数
  | 'dodges'            // 成功闪避（无敌帧挡下伤害）的次数
  | 'battlesWon'
  | 'flawlessWins';     // 满血通关一场的次数

export type QijiUnlock =
  | { readonly kind: 'always' }                                  // 初始解锁
  | { readonly kind: 'counterAtLeast'; readonly counter: RunCounter; readonly value: number }
  | { readonly kind: 'all'; readonly of: readonly QijiUnlock[] }
  | { readonly kind: 'any'; readonly of: readonly QijiUnlock[] }
  | { readonly kind: 'not'; readonly of: QijiUnlock };
```

**具名计数器而不是自由的 `string`**：让"哪些行为可被计数"是一张封闭的表，
编译器与测试都能穷举；自由字符串会让"条件永远不成立"变成一个静默的
拼写错误（本仓库在 skill id 上踩过同类的坑，见 `content.ts:587-604`）。

#### 5.2.1 条件怎么写（"成功使用 3 次截"的完整链路）

```ts
// src/data/qiji.ts
export const QIJI_JIE_DERIVE_STRIKE: QijiDef = {
  id: 'jieDeriveStrike',
  nameKey: 'qiji.jieDeriveStrike.name',
  descKey: 'qiji.jieDeriveStrike.desc',
  icon: 'char_break',
  category: 'offense',
  unlock: { kind: 'counterAtLeast', counter: 'jieInterrupts', value: 3 },
  abilities: [
    // 示例：把「截」成功后的派生窗口从 0.8s 拉长到 1.6s
    // （改的是 COMBO_WINDOW 的时长；具体数值由内容作者定）
  ],
};
```

#### 5.2.2 计数器从哪来：**事件流归约**（推荐）

`BattleEngine` 已经产出**确定性**的 `EventDef[]`（`core/events.ts`），
其中：

```ts
{ kind: 'skillUsed',        tick, sourceId, skillId }
{ kind: 'interruptSuccess', tick, sourceId, targetId, skillId }   // ✅ 有 sourceId
{ kind: 'avoided',          tick, sourceId, targetId, skillId, reason: 'dodged' | 'immune' }
{ kind: 'encounterEnd',     tick, result, reason }
```

所以 run 层可以**只读事件流**算出所有计数：

```ts
// src/core/run/counters.ts —— 唯一写入路径
export function reduceEvents(state: RunState, events: readonly EventDef[]): RunState;
```

**这套路线的优点：**

- **零引擎改动**（理论上）—— 事件已经在了，且是确定性的。
- counters 是纯数字的 plain object → **可 JSON 序列化、可哈希**（满足 C5）。
- 不碰 `BattleState` → **黄金重放与 `REPLAY_FORMAT_VERSION` 不受影响**（§7）。

**⚠️ 但有一个真实的缺口（必须正面说）：**

`interruptSuccess` 事件的 `skillId` 是**被打断的那个读条**的 id
（`core/combat/hitResolution.ts:429-434` 与 `492-497` 都是
`skillId: cast.skillId`，而 `cast` 来自 `target.casts`），
`sourceId` 才是打断者。**所以事件里没有"打断者用的哪个技能"** ——
我们分不出"成功用截"和"成功用破"。

三个补法：

| 方案 | 做法 | 代价 | 推荐 |
|---|---|---|---|
| **A** | 给 `interruptSuccess` 事件**加一个可选字段** `sourceSkillId`（打断者当时正在放的技能，`hitResolution.ts` 的结算现场拿得到） | 改 1 个 core 文件（2 处 emit + 1 处类型）。**纯加字段、不参与任何判定** → 战斗结果逐位不变 | ✅ **推荐** |
| B | 同一 tick 内把 `skillUsed{skillId:'jie'}` 与 `interruptSuccess{sourceId:player}` **配对** | 零引擎改动，但依赖"截是瞬发、两者同 tick"这一实现细节；一旦将来截改成读条就静默失效 | ❌ 不推荐（脆） |
| C | 把 `onInterruptSuccess` 接进 `SUPPORTED_HOOKS` + 让它能写计数器 | 动 `triggers.ts` 白名单 + 新增"写计数器"的 ability + 接 `getCounter` —— 为一个条件做 3 处引擎改动 | ❌ 过度 |

#### 5.2.3 计数器放在哪：**run 层，不放 `BattleState`**

| 候选 | 判断 |
|---|---|
| `BattleState` / `Combatant.counters` | ❌ 单场、且被黄金重放钉死；跨场数据放进去会让每场重放依赖前几场 |
| app 层（`src/app/`） | ❌ 不能写单测（要 DOM）；而这是**必须**有单测的纯逻辑（用户要的"行为式解锁"全靠它） |
| **`src/core/run/`（新增，推荐）** | ✅ 零依赖、Node 里可跑、满足 C1/C2/C4/C5；与 `core/rng.ts` 同级 |

**唯一写入路径**：`RunState.counters` 只由 `reduceEvents()` 写。
这与 `input/touchLayout.ts` 的"`TouchLayout` 只有一个写入路径 `set()`"
是同一条设计纪律（AGENTS.md §3b）：**不许多处各留一份**。

**跨场还是单场？** 用户原话"成功使用 3 次截"没说时间窗。两个选择：

| 方案 | 得到 | 代价 |
|---|---|---|
| **跨场累计（推荐）** | 条件一定可达：傲慢一场 ~95s、截 CD 10s → 理论上 9 次机会（`bossPride.ts:249-304,336-373` 的 4 个技能里 3 个可打断，`碾压` 起手霸体挡住） | 需要 counters 跨场存活（这正是 run 层要做的） |
| 单场内累计 | 语义更"硬"（必须在一场里做到） | **可能不可达**：某场可能只给 1~2 次可打断读条 → 条件永远不成立 |

→ **推荐跨场累计**，但把"时间窗"**做成数据**（`unlock` 里将来可加
`withinBattles?: number` 或 `window: 'battle' | 'run'`），先只实现 `'run'`。
→ §12 Q4。

### 5.3 "选 1 个生效"的语义

#### 5.3.1 永久累积 vs 每场临时

用户原话："一旦解锁，**整局游戏**，每次战斗完都可以选取"
—— 字面上是"解锁是一次性的、永久进池；**每次**战斗完从池里选 1 个"。

| 解读 | 语义 | 玩家到第 7 场时 |
|---|---|---|
| **A（推荐）永久累积** | 每次选的炁机**永久**进入本局 build | 最多 6 个炁机同时生效（第 1 场前没有） |
| B 每场临时 | 每次选的只对**下一场**生效 | 有 1 个炁机，但要每场重选 |

**推荐 A**：与"解锁是永久的"一致（如果选择是临时的，那"解锁"和"选择"
就没有区别了，UI 上也会变成"每场从池里挑一个用一次"，与用户描述的
"整局游戏都可以选取"不符）。**代价**：A 需要 §5.3.2 的叠加规则；
B 不需要，但每场都要重选、决策疲劳。

#### 5.3.2 能否叠、能否换、顺序有影响吗

| 问题 | 答案 | 理由 |
|---|---|---|
| **多个炁机能叠吗** | ✅ 能，但**同一个 `QijiDef` 默认只带 1 层**（`maxStacks` 默认 1） | 否则"再选一次同一个"变成数值堆叠，抹掉"每次要做一个新选择"的设计 |
| **选了之后能换吗** | ❌ **不能换**（A 语义下不需要换：选了就永久在） | 加"换"需要一整个"卸下/装配"界面。**但如果将来要 B 语义或要做 maxStacks，就必须有换的 UI** |
| **同一场里叠加顺序有影响吗** | **取决于 op**：`add` / `addPercent` / `mult` / `max` / `perStackAdd` 都**交换**（顺序无关）；**只有 `setOverride` 不交换** | `core/types/stats.ts:48-54` 定义了 6 种 op。所以规则是：**炁机禁用 `setOverride`**（用校验器/单测强制），于是**顺序永远无关** |
| **buff 之间的顺序** | 无关（叠层规则 `stacking` 决定，`core/types/buffs.ts:20-26`） | 同名 buff 走 `refresh` / `stack` 等既有规则 |

#### 5.3.3 炁机怎么"进入战斗"（零引擎改动的装配）

`CreateBattleOptions.passiveModifiers` 已被引擎读取（`core/combat/stats.ts:101`），
固有 buff 走 `Combatant.buffs`（`data/units.ts:142-151` 的 `innateBuffsFor`
就是这么给色欲挂反伤被动的）。所以：

```ts
// src/data/kit.ts（纯函数，可单测）
export interface BattleKit {
  readonly base: Partial<Record<StatKey, number>>;
  readonly caps: { readonly hp: number; readonly energy: number; readonly douqi: number };
  readonly innate: readonly BuffDef[];        // → makePlayer 时挂上
  readonly modifiers: readonly StatModifier[]; // → passiveModifiers.get(playerId)
}

export function buildPlayerKit(
  character: CharacterDef,
  chosen: readonly QijiDef[],
): BattleKit;
```

- `modifier` / `derived` ability → `kit.modifiers`
- `grant`(self, 永久) / `trigger` ability → `kit.innate`（装的 buff 自己带
  `triggers` / `modifiers`）
- `caps.hp += 30 × (兜底次数)`（§5.4）

**这一步全是数据装配**：`battleSetup.ts:95-99` 现在传的是
`new Map([[playerId, PLAYER_BASE]])` 与 `passiveModifiers: new Map()`，
把它换成 `buildPlayerKit(...)` 的输出即可。**引擎一行不动。**

### 5.4 兜底选项「+30 血量」

#### 5.4.1 它是什么

```ts
export const QIJI_FALLBACK = { hp: S(30) } as const;   // data/balance.ts 或 data/qiji.ts
```

- **每个角色都一样**：❌ 不建议按角色变。理由：兜底是**保底**，
  它的语义是"这一场至少不会空手"；按角色变会让"哪个角色兜底更值"
  变成一个需要平衡的维度，而兜底本来就不该是 build。
  （若将来要变，数值放 `data/balance.ts` 一处即可。）
- **数值**：`+30` 相对玩家 `HP_MAX = 100`（`content.ts:85`）是 **+30%**。
- **加的是"上限 + 当前"**：`caps.hp += 30` 且 `resources.hp += 30`
  （否则只是回血，不是变肉）。引擎用的是每个 combatant 自己的
  `caps`（`core/types/runtime.ts:33-36`），所以这**天然可行**。

#### 5.4.2 ⚠️ 可以重复选吗？（正面回答平衡风险）

**先算账。** 一局最多选 `order.length - 1` 次（每场之后一次；最后一场
之后是通关屏，不再选）。全选兜底时：

| 局长度 | 可选次数 | 玩家 maxHp | 相当于多挨几下「碾压」(60) |
|---|---|---|---|
| 2 场（今天） | 1 | 130 | +0.5 刀 |
| 4 场 | 3 | 190 | +1.5 刀 |
| 7 场 | 6 | 280 | +3 刀 |

**风险是真实的，而且有两个方向：**

1. **兜底变成最优解**：如果强度曲线主要加**机制**、数值加得慢，
   那"+30 血"是最稳的（它不依赖任何操作，而机制炁机要靠玩家打出来）。
   → 玩家一路点兜底 → **整个炁机系统失去意义**。
2. **兜底变成废选项**：如果机制炁机的收益（DPS/资源）远高于 +30 血，
   那兜底只在"什么都没解锁"时被选 → 那它就没起到"保底"以外的任何作用，
   而这是**可以接受的**（保本就是它的定位）。

**三个对策：**

| 方案 | 规则 | 代价 |
|---|---|---|
| **(a) 每局最多一次（推荐）** | 选过就从候选里移除（`RunState.fallbackTaken`） | 后期没有"安全选项"，build 没成型时会很难；但兜底的定位就是"开局保底" |
| (b) 可重复但递减 | 第 1 次 +30、第 2 次 +15、第 3 次 +10… | 解释成本；UI 要显示"这次 +15"；递减公式要定 |
| (c) 可重复、按比例 | +30% 当前 maxHp | ❌ **不要**：与其它 maxHp 乘区耦合会指数增长 |

**推荐 (a)**，并在文档里写死理由：**兜底是"保底"，不是 build**。
"故意不解锁任何炁机、一路堆血"这条退化策略必须在设计层面关掉，
而不是靠数值调参去压。

#### 5.4.3 兜底解决不了的那个问题（用户点名的"开发阶段炁机不够"）

用户提到"开发阶段不够那么多炁机"。兜底解决了"**没有任何解锁**"，
但没解决"**已解锁池只有 1 个**"：那时每次战斗后的"选择"是
**没有选择**（只能选它或兜底），玩家会觉得这个界面是多余的。

**规则建议**（写进 `QijiSelect` 的候选生成）：

```
候选 = 已解锁且未达 maxStacks 的炁机
      + (兜底未取 ? [兜底] : [])
若 候选.length <= 1  → 跳过选择屏，自动取那一个（或什么都不取），
                        给一个"本场无新选择"的提示
```

这样开发期（池子小）不会每场都弹一个假选择屏，而正式玩（池子足够）
时选择屏才出现。**代价**：玩家在池子小时会疑惑"为什么这次没有选择"，
所以必须有提示文案。→ §12 Q3。

---

## 6. 强度曲线

### 6.1 档位怎么定：**按归一化进度，不按绝对序号**

用户原话是"根据在当局的出场顺序"。但绝对序号有个问题：
**只有 2 个 Boss 时，第 2 位就是"第 2 档"；而全做完时第 2 位也是第 2 档
—— 但这两局的长度完全不同（2 vs 7），第 2 档在两者里的位置差很远。**

所以用**归一化进度**：

```ts
/** 0（第一场，最软）→ 1（最后一场，最硬）。局长为 1 时规定为 1。 */
function progress(position: number, total: number): number {
  if (total <= 1) return 1;
  return position / (total - 1);        // position: 0-based
}

/** 7 档（T1..T7）：`tier = 1 + round(progress * 6)` → 0..6 → T1..T7。 */
function tierOf(position: number, total: number): IntensityTier;
```

**这个映射的性质（要写进单测）：**

| `total` | `progress` 取值 | 落到哪些档 |
|---|---|---|
| 7 | `0, 1/6, 2/6, 3/6, 4/6, 5/6, 1` | **T1..T7 各一次**（首场最软、末场最硬） |
| 2 | `0, 1` | T1 → **T7**（只有两端） |
| 4 | `0, 1/3, 2/3, 1` | T1 / T3 / T5 / T7（取最近的档） |
| 1 | `1` | T7（单场即终局） |

⚠️ **`total=1` 时用 T7（最硬）是一个刻意的选择**：只有一场的话，
它就是这一局的终局，不该用最软的档。但开发期"只想快速打一场"时，
用 `?runlen=1` 会同时拿到最硬的档 —— 所以要给一个**显式的覆盖参数**
（`?tier=1`）供截图/调试，而不是靠改 `total` 去凑。

**为什么归一化能在任意局长度下满足"越后越难"**：单调不减，
且首场永远是最软档、末场永远是最硬档。**代价**：局长为 2 时，
第 2 场直接落在**最硬档**（不是"中间档"）—— 那对一局只有 2 场来说是
合理的（它确实是这一局的终局），但意味着"用 2 个 Boss 测全 7 档的
极值"是可行的，而"测中间档"需要 `?runlen=4` 之类。

### 6.2 数值变化表（**与机制变化分开列**）

基准 = **各 Boss 自己声明的值**（不是全局常量），乘上档位系数。
今天的基准（傲慢，已核实的真实值）：

| 旋钮 | 今天的值 | 证据 |
|---|---|---|
| `weightedRotation.gapMs` | `4000` | `data/bossPride.ts:486` |
| `enrage.atMs` / `dmgMult` | `120_000` / `2` | `data/bossPride.ts:413` |
| Boss HP 上限 | `420` | `data/entities/bossHp.ts:51` |
| 二阶段门槛（回补） | `hpBelow 0.4`，CD `logicMs(2000)`（整场一次） | `data/bossPride.ts:447,367` |
| `timeLimit` | `180_000`（来自 `options`，**不是**行为） | `src/app/battleSetup.ts:77`、`core/combat/encounterEnd.ts:35` |
| 玩家 HP | `100` | `src/data/content.ts:85` |

档位系数（**建议值，不是拍板值**；`gapMs` 一列是"乘在 Boss 自己的
`gapMs` 上"）：

| 档 | `progress` | total=7 时 | `gapMs` × | HP × | `enrage.atMs` × | 二阶段门槛 |
|---|---|---|---|---|---|---|
| **T1** | `0` | 第 1 场 | **1.25** | 0.85 | 1.15 | 关 |
| **T2** | `1/6` | 第 2 场 | 1.15 | 0.90 | 1.10 | 关 |
| **T3** | `2/6` | 第 3 场 | 1.05 | 0.95 | 1.05 | 关 |
| **T4** | `3/6` | 第 4 场 | 1.00 | 1.00 | 1.00 | **0.45** |
| **T5** | `4/6` | 第 5 场 | 0.94 | 1.06 | 0.95 | **0.45** |
| **T6** | `5/6` | 第 6 场 | 0.87 | 1.12 | 0.90 | **0.42** |
| **T7** | `1` | 第 7 场 | **0.80** | **1.18** | **0.85** | **0.40** |

（T4 故意等于"今天的值 ×1.0"：**基准档**落在第 4 位，
所以 `total=7` 时前 3 场比今天软、后 3 场比今天硬；而**默认档必须是 T4**，
否则会动到黄金基线 —— 见 §10 的 P3 验收。）

**这个表有几个必须写出来的约束（都是仓库里踩过的坑）：**

| 约束 | 为什么 | 证据 |
|---|---|---|
| **`gapMs` 的缩放必须逐 Boss 复核"`gapMs` vs 各自的冷却/轮转类型"** | 傲慢是 `weightedRotation`，`gapMs 4000 > 冷却 3000` 是**刻意的**（`bossPride.ts:455-457`）；色欲是 `rotation`，注释要求 `gapMs` **短于**各自冷却（`lustBoss.ts:350-356`）。两者不矛盾（轮转类型不同），但**同一个缩放系数不能想当然地套到两个 Boss 上** | `bossPride.ts:455-486`、`lustBoss.ts:318-360` |
| **`gapMs` 有下界**：不能缩到让"纯进攻也赢"或"出现死局" | 傲慢注释明确记着"`gapMs` 改大到 8000+ 会让纯进攻翻盘"（反过来说：改小会让玩家更吃力）。而 `gapMs` 太接近冷却会让轮转被冷却锁住、节奏不可控 | `bossPride.ts:477-479` |
| **HP × 与"整场一次的回补"必须联动** | 回补的数值语义是"回三成血"（`S(126) = 30% × 420`）。如果只缩/放 HP 而不动回补，它的含义就漂了 | `bossPride.ts:344-355` |
| **`timeLimit` 不参与缩放** | 它来自 `options`，且超时判负（`encounterEnd.ts:33-37`）。缩放它会让"打得慢"直接变成输，而 `gapMs` 已经在控制节奏了 | — |
| **所有数值走 `S()`**，时间走 `logicMs()`/`logicTicks()` | AGENTS.md §2；`logicTicks` 只接受非负整数逻辑步并在开发期抛错（`core/loopConstants.ts:156-163`） | — |

**玩家侧不做缩放**。理由：玩家侧的成长来自炁机（§5），如果曲线也动玩家
数值，两条曲线会互相掩盖，出问题时分不清是"曲线太陡"还是"炁机太强"。

### 6.3 机制变化表（**"哪一条现有机制在第几位解锁"**）

`progress` 阈值（与 §6.2 同一套归一化）。**每一条都标了它落在引擎的哪一层。**

| # | 机制 | 解锁于（`progress`） | total=7 时 | 落在哪（**现有引擎的确切位置**） | 内容缺什么 |
|---|---|---|---|---|---|
| M0 | `opener` + 主轮转（Boss 的招牌机制） | `≥ 0`（始终） | 1–7 | `Behavior` 的 `opener` / `rotation` / `weightedRotation`（`core/ai/index.ts:138-152,176-195`） | ✅ 现有两个 Boss 都有 |
| M1 | **二阶段**（用户点名的例子："后 3、4 个出场的才把二阶段放出来"） | `≥ 0.5` | **4–7**（"后 4 个"） | **两条现成路径**：<br>① `weightedRotation` 的一步带 `when: {kind:'hpBelow', who:'self', ratio}` + 长 CD → 傲慢用的就是这条（`bossPride.ts:438-449`）<br>② `Behavior: onHpBelow` + `then: [grant(phase2 buff)]`（`core/ai/index.ts:154-162` + `runAi.ts:111-125`，**`grant` 真的被执行**） | ⚠️ **色欲没有二阶段**（它的 `LUST_BEHAVIORS` 只有 opener + rotation，`lustBoss.ts:324-360`）→ 要么给它做，要么"第 4 场是色欲时它没有二阶段"（那会让曲线的可预测性变差） |
| M2 | **霸体**（`interruptImmune`） | `≥ 0.5` | 4–7 | `BuffDef.flags.interruptImmune`（`core/types/buffs.ts:34`），被 `hitResolution.ts:452-460` 读取；挂在招式的 `castStart`（`bossPride.ts:263` 的 `BOSS_HEAVY_ARMOR`） | ⚠️ **色欲没有霸体技** |
| M3 | **控制**（倒地 / 眩晕） | `≥ 4/6 ≈ 0.667` | 5–7 | `KNOCKDOWN`（`restrictToTags:['dodge']`，`bossShared.ts:89-103`）或 `EffectKind:'stun'`（`core/types/effects.ts:51-65`，`lustBoss.ts:281` 在用） | ⚠️ 傲慢只有倒地、色欲只有眩晕 → "两者都开"需要新内容 |
| M4 | **狂暴提前 + 更狠** | `≥ 4/6` | 5–7 | `Behavior: enrage` 的 `atMs` / `dmgMult`（`core/ai/index.ts:164-171`）→ `applyEnrage` 挂 `boss-enrage`（`data/bossShared.ts:58-68`，`damageMultBoost: 2`） | ✅ 现有 |
| M5 | **二阶段换招表**（进二阶段后轮转里多出/少掉某些招） | `≥ 5/6 ≈ 0.833` | 6–7 | `RotationStep.when` / `WeightedRotationStep.when` 支持 `hasBuff`（`core/types/behavior.ts:12-37` + `core/ai/index.ts:359-369` 的 `hasBuff` 分支）→ **用 `when: hasBuff 'phase2'` 即可，零新机制** | 需要"phase2 buff"这个内容（M1 的产出） |
| M6 | **终局**：以上全部 + `gapMs` 最短 + 数值最高 | `= 1` | 7 | 数据组合 | — |

**必须新造的（明确标出）：**

| 新东西 | 加在引擎的哪一层 | 是不是"新机制" |
|---|---|---|
| **洗牌 + 档位映射 + 解锁判定 + 事件归约** | `src/core/run/`（**新层**，不碰 `core/combat/`） | ❌ 不是引擎机制，是**元层逻辑** |
| **档位 → `Behavior[]` / `caps` 的装配** | `src/data/intensity.ts` + `data/units.ts` 的 `behaviorsFor(id, tier)`（**纯数据**） | ❌ 不是新机制：`Behavior[]` 本来就是构造战斗时的输入 |
| **`interruptSuccess.sourceSkillId`** | `core/combat/hitResolution.ts`（2 处 emit）+ `core/events.ts`（1 个可选字段） | ⚠️ **是唯一的引擎改动**，且是**纯加字段、不参与判定** |
| **色欲的二阶段 / 霸体 / 控制** | `src/data/lustBoss.ts`（内容） | ❌ 内容工作 |
| **5 个未开发 Boss** | 各自 `boss*.ts` | ❌ 内容工作 |

**明确不要设计进去的死代码**（§0.3.1）：`Behavior:'interruptible'`、
`Hook:'onPhaseChange'`、`Expr.counter` / `Combatant.counters`、
`grantSkill`、`consume`、`Loadout.items`。

### 6.4 双曲线（Boss 变难 vs 玩家变强）—— 这是最可能失控的地方

一局里**两条曲线同时在动**：Boss 每场更难（§6.2/6.3），玩家每场多一个
炁机（§5）。设计上能做的只有：

1. **给"目标形状"**：建议 `第 k 场的用时/剩余血量` 大致持平
   （而不是越来越轻松 = 曲线太缓，或越来越险 = 太陡）。
2. **给可测的量**：`RunOutcome` 里记录每场的 `ticks` / 玩家剩余 HP，
   做一个"曲线回归测试"（固定 `runSeed` + 固定策略 → 逐场摘要），
   与 `tests/golden/replay.test.ts` 是同一个套路。
3. **不做数值保证**：仓库的定位是"数值还会大改、机制优先"
   （`lust-boss.md` §0.2）。所以这里只要求"每场结束时**没有死局**"
   （任何 build 都能打完，或者干脆认输）。

---

## 7. 确定性与重放（这一节是硬约束，必须逐条落实）

### 7.1 种子从哪来、存在哪

| 问题 | 答案 |
|---|---|
| 从哪来 | **app 层**用 `Date.now() >>> 0`。已有先例：`battleSetup.ts:90` 就是这么给战斗种子的。**`core/` 里不许有它**（lint C2，`tests/unit/lintRules.test.ts:85-91`） |
| 存在哪 | `RunState.runSeed`（内存）；可选落 `localStorage` 的 `raid.run.v1`（沿用 `SettingsStore` 的"带版本后缀 + 解析失败回落"约定，`settingsStore.ts:48-64,97-132`） |
| 怎么派生顺序 | `shuffle(BOSS_POOL, runSeed)` 用 `core/rng.ts` 的 mulberry32（`randomInt`），**纯函数、状态显式穿线** |
| 每场的种子 | `battleSeed(runSeed, i) = deriveSeed(runSeed, i)`（纯函数，例如再跑一次 mulberry32 取 uint32）。**每场独立**，绝不共用同一 seed（否则两个 Boss 的出招序列会相关） |
| **绝不能**用什么 | `BattleState.rngSeed` / `aiRngSeed`。run 层的随机必须走**自己的**流 |

**"自己的随机流"不是洁癖，是结构性保护。** 仓库里已经有一条同源的教训：

> `core/types/runtime.ts:78-88`：`aiRngSeed` 与 `rngSeed` 分开之后，
> "玩家侧的黄金基线是否被动过"从"要重新标定才不会错"变成
> **结构上不可能**。

run 层的洗牌如果去消耗 `BattleState.rngSeed`，就会**同时改变玩家侧的
所有概率判定** —— 而 `tests/golden/replay.test.ts` 会因此变红。

### 7.2 重放：单场不变，新增 run 记录

| 层面 | 做法 |
|---|---|
| **单场重放** | **完全不变**。`RecordedRun`（`core/run.ts:48-62`）仍然是 `{version, seed, ticks, input}`。理由：`RunState` 不进 `BattleState`，对引擎而言每一场依旧只是"combatants + seed + input" |
| **一局重放（新增）** | `{ formatVersion: RUN_FORMAT_VERSION, runSeed, playerId, choices: QijiId[], battles: RecordedRun[] }`。校验规则照抄 `replayRun`（版本不匹配 → **开发期错误用英文**，i18n 规范 I1 / `run.ts:148-153`） |
| **`REPLAY_FORMAT_VERSION` 要不要 +1** | **方案 A（§5.2.2，推荐）下：不必。** 判断依据是 `run.ts:37-45` 的原文："改动引擎的**确定性语义**时必须 +1"。加一个不参与判定的 `sourceSkillId` 字段不改变任何战斗结果。**但**：若将来引入方案 B（引擎内实时计数器、动 tick 管线或 `Condition` 求值语义），**必须 +1**，同时改 `tests/golden/replay.test.ts:86` 的断言与 `GOLDEN_OUTCOME` |

⚠️ **注意"一局"的边界不在引擎里**：一个 `BattleEngine` 永远是**一场**。
"一局"是 `RunState` + 依次构造的 N 个 `BattleEngine`。这正是为什么
**不需要**把"多场"塞进引擎。

### 7.3 一局的三个"可哈希"保证

`RunState` 必须是 plain object（`core/types/runtime.ts:66-72` 的 C5 同样适用）：

1. 不许 `Map` / `Set` / 类实例（lint C5，`lintRules.test.ts:107-112`）。
2. `unlocked` / `chosen` 用**数组**（保序，便于 diff 与哈希），不用 `Set`。
3. counters 是 `Record<string, number>`。**键是封闭的 `RunCounter` 联合**
   （§5.2），所以"未知键"在类型层就被挡住。

---

## 8. i18n / 输入 / 触屏的硬约束（落地时必须遵守）

### 8.1 i18n

| 事项 | 做法 | 依据 |
|---|---|---|
| 新文案 | 全部进 `src/i18n/locales/zh-CN.ts`；`src/**` 里出现中日韩字符会被 lint 拦下（I1） | `docs/specs/2026-10-09-i18n.md` §7 |
| **新 domain** | 需要 `qiji.*`（炁机名/描述）、`run.*`（局内界面文案）。i18n 规范 §5 的 domain 白名单**是文档表格，不是机器校验**（全仓 grep 无 domain 校验）→ 加 domain 是"改文档 + 加 key"，不是改代码 | `docs/specs/2026-10-09-i18n.md:170-187` |
| key 命名 | `<domain>.<subject>.<field>`，全小写驼峰；炁机建议 `qiji.jieDeriveStrike.name`（`id: 'jieDeriveStrike'` 的 camelCase） | 同上 §5 |
| **内容 key ↔ id 对应** | 现有校验器对 `entity.<camelId>.*` 有 `KEY_ID_MISMATCH`（`content/validate.ts` 的 `toSubject`）。炁机不是 `GameEntity`，所以**没有现成校验** → 加一条单测：每个 `QijiDef` 的 `nameKey` / `descKey` 都在 `flattenCatalog(zhCN)` 里（`flattenCatalog` 已导出，`deps.ts:50` 就是这么校验内容的） | `i18n/translator.ts:60-90` |
| 键位提示 | **不进 i18n**（"继续 (Enter)"由渲染层拼按键名；触屏不拼） | AGENTS.md §3b |
| 数字/时间 | 走 `Translator` 的 `number` / `percent` / `duration`，不手写 `toFixed` | i18n 规范 §8 |

### 8.2 触屏对等

每个新屏都必须给出**触摸路径**（AGENTS.md §3b 的"功能必须对等"）：

- 所有"确定/继续"都必须有**可点的区域**，不能只有 `Enter`。
- 触屏层（`touchControls`）在**非 `battle` 的一切 phase 都隐藏**
  —— 现在传的是 `isPrepareOpen: () => state.phase === 'prepare'`
  （`game.ts:316`），要改成 `isBattleActive: () => state.phase === 'battle'`，
  否则新屏上会浮着双弧按钮、与卡片重叠（AGENTS.md §3b：
  "触屏时整条技能栏都隐藏"是同一个道理）。
- `canvasInput.ts` 的 `phase()` 判断要为新屏加分支，且**顺序即优先级**
  （该文件里已经写明三条实测踩出来的规则，`canvasInput.ts:83-107`）。

---

## 9. 模块划分（按**职责**，不按行数）

```text
src/core/run/                     ← 新层：一局的纯逻辑（零依赖、Node 可跑）
  types.ts        RunState / RunCounter / QijiUnlock / QijiDef 的**形状**
  shuffle.ts      种子化洗牌（run 层唯一的随机消费者）
  counters.ts     事件流 → counters 的归约（**唯一写入路径**）
  unlock.ts       解锁判定 + 每场候选生成（纯函数）
  lifecycle.ts    场次推进 / 胜负 / 通关 / 兜底（状态转移）
  record.ts       RunRecord（一局重放）的序列化与校验
  index.ts        转发

src/data/
  characters.ts   角色定义（属性 / 资源上限 / 初始技能套 / 默认键位 / 固有被动）
  qiji.ts         炁机内容表（QijiDef[]，引用 Ability / BuffDef）
  intensity.ts    档位表：progress → 数值缩放 + 机制解锁清单（**纯数据**）
  kit.ts          buildPlayerKit(character, chosenQiji) → BattleKit（纯函数）
  units.ts        （改）behaviorsFor(id, tier)、makePlayer(id, character, kit)

src/app/
  runSession.ts   RunState 的持有者 + 与 BattleLoop 的接线
                  （BattleLoop 需要新增一个 onEvents 回调 → §9.1）
  flow.ts         （改）Phase 加 3 个值
  battleSetup.ts  （改）从"读 selection"变成"读 runSession 的当前场"
  game.ts / loopWiring.ts / canvasInput.ts （改）phase 分发

src/ui/
  cardSelectLogic.ts      三个选择界面共享的光标/命中区/确定逻辑（纯）
  CharacterSelectScreen.ts
  QijiSelectScreen.ts
  RunOverScreen.ts
  prepareLogic.ts / PrepareScreen.ts  （不动，或按 §3.3 参数化）
```

**`core/run/` 为什么不放在 `data/` 或 `app/`：**

- 不是 `data/`：它是**逻辑**（洗牌、归约、判定），不是内容表。
- 不是 `app/`：`app/` 碰 DOM/Pixi，而这里的每一条都必须能在 Node 里单测
  （用户要的"行为式解锁"的正确性全靠它）。
- 它满足 `core/` 的全部硬约束（零依赖 / 无 `Math.random` / 无 `Date.now` /
  无异步 / 无可克隆容器）。
- **方向**：`data/qiji.ts` 实现 `core/run/types.ts` 声明的 `QijiDef`
  —— 与 `LocaleKey` 的"接口形状由消费者声明，实现方满足它"
  （`core/types/ids.ts:7-13`）是同一条纪律。

### 9.1 唯一需要改 `BattleLoop` 的地方：把事件流交出来

现在 `drainEvents()` 是排空语义、只能调一次，且被 `ViewAdapter` +
`logFormatter` 消费（`battleLoop.ts:354-362`）。run 层要读它，加一个**可选回调**：

```ts
// BattleLoopOptions
readonly onEvents?: (events: readonly EventDef[]) => void;
// consumeEvents() 里：events = engine.drainEvents(); ...; options.onEvents?.(events);
```

这是 **app 层的接线**（`battleLoop.ts` 属于 `app/`），**core 不动**。
⚠️ 注意：回调必须**只读**、不能影响引擎（渲染层不许反向调用 sim，
AGENTS.md §2）；run 层拿到的事件只用于累计计数。

---

## 10. 落地计划（每阶段可独立验收）

| 阶段 | 交付 | **做完能看到什么** | 依赖 |
|---|---|---|---|
| **P0** | `core/run/`：`RunState`、洗牌、事件归约、解锁判定、候选生成 + 单测 | `pnpm run test:run` 里能看到：同一个 `runSeed` → 同一个顺序；喂一串 `EventDef` → counters 与解锁按预期变；`RunState` 能 JSON 往返 | 无（纯逻辑，不碰 UI） |
| **P1** | `CharacterSelect` 屏 + `RunState` 接进 app + 打完一场 → 结算 → 回选角色 | 截图：三张卡（2 张灰"开发中"）、能用键盘与触屏各选一次、`BOSS_POOL.length === 2` 时能打赢两场并看到"通关" | P0；`Phase` 改动（§3.2） |
| **P2** | `QijiSelect` 屏 + 兜底 + `buildPlayerKit` 真正影响下一场 | 截图：选完炁机后，下一场玩家的 **maxHp / 属性**确实变了（可截图看血条上限）；单测：`buildPlayerKit` 的输出符合预期 | P1；`qiji.ts` 先放 3 个炁机 |
| **P3** | 强度曲线**数值档**（`intensity.ts` + `behaviorsFor(id, tier)`） | 单测：同一个 Boss 在第 1 场与第 7 场的 `gapMs` / HP 不同；**`makeGoldenEngineOptions()` 默认档 = 今天的值** → `tests/golden/replay.test.ts` 不变红 | P1 |
| **P4** | 强度曲线**机制解锁**（M1 二阶段 / M2 霸体 / M3 控制 / M5 换招） | 单测：`progress < 0.5` 的 `Behavior[]` 里**没有**二阶段那一项；同时需要**内容**（色欲的二阶段/霸体） | P3；内容工作 |
| **P5** | `RunIntro` / `RunOver` 完善 + 每场存档（可选）+ 曲线回归测试 | 一局跑完能看到每场摘要；`RunRecord` 能重放 | P1–P4 |
| **P6** | 5 个未开发 Boss（各自 `boss spec` + 内容） | `BOSS_POOL` 逐步变 7 | 内容工作 |

**P3 有一条硬验收**：`behaviorsFor(id)` 在不传 tier 时**必须**与今天
逐字相同（`BOSS_BEHAVIORS.get(id) ?? PRIDE_BEHAVIORS`，
`units.ts:103-105`），否则黄金基线会变。

---

## 11. 风险 / 我不确定的地方

按"最可能翻车"排序：

| # | 风险 | 为什么危险 | 缓解 / 待验证 |
|---|---|---|---|
| **1** | **兜底变成最优解**（§5.4.2） | 如果机制炁机的收益不明显，"一路 +30 血"是零操作、稳定的选择 → 整个炁机系统失去意义 | 每局一次（推荐 (a)）；另外**需要一个可测指标**（每场用时/剩余血量）来发现"玩家只选兜底" |
| **2** | **双曲线失控**（§6.4） | Boss 越难 + 玩家越强，两条曲线互相追赶，很容易变成"前 3 场碾压、第 6 场必死"或反过来 | 只能靠**固定 runSeed + 固定策略**的曲线回归测试去量；本文不给数值保证 |
| **3** | **机制解锁撞上"内容不存在"**（§6.3） | M1/M2/M3 都需要**色欲以及未来 5 个 Boss 都有对应内容**。今天色欲没有二阶段、没有霸体 → "第 4 场是色欲时它比第 3 场的傲慢还简单" → 曲线在玩家体感上是**反的** | 要么给每个 Boss 补齐这几条通道，要么接受"机制按 Boss 本身有什么"（那"越后越难"就只能靠数值） |
| **4** | **"成功使用 3 次截"的可达性** | 截 CD 10s、一场 ~95s → 理论 9 次机会；但要玩家**每次都赌**。若某场 Boss 只给 1 次可打断读条（傲慢的碾压被霸体挡住 → 实际只有轻蔑/呵斥/回补 3 个可打断），条件可能拖到第 3 场才解锁 | 跨场累计（§5.2.3）；并可给一条"进度可见"的 UI（`2/3`） |
| **5** | **per-character 技能套 = 跨 4 层改动**（§4.4 R3） | `PLAYER_SKILL_IDS`（`content.ts:585`）与 `DEFAULT_BINDINGS`（`keyboard.ts:53`）是全局单例，牵动设置页 / 触屏按钮 / 技能栏 / 键位校验四处 | R0 先用"属性 + 被动"差异顶着，把 R3 单独作为一个阶段 |
| **6** | **一局 10 分钟 + 失败全丢的体验** | 挫败感重；而且中途关页面/刷新会丢（除非做局内存档） | 见 §12 Q1/Q10 |
| **7** | **新屏数量（3 个）** | 每个都要 canvas + 键鼠/触屏对等 + i18n + 命中区；这是**工作量**风险，不是设计风险 | 抽 `cardSelectLogic` 共用（§3.3） |
| **8** | **`Phase` 改动的面** | `phase` 现在被 5 个位置 switch（§3.2），漏一处就出"两个界面同时可见"（仓库已踩过） | P1 就把 5 处一起改，并在阶段验收里加"逐屏截图" |
| **9** | **洗牌扰动黄金基线** | 如果实现时图省事用 `BattleState.rngSeed` 或 `Math.random`，黄金测试会红，或者更糟——静默改变 | §7.1 写死"run 层自己的随机流"；`core/` 的 `Math.random` 会被 lint 拦（C2） |
| **10** | **`localStorage` 的 RunState 是未验证输入** | 与键位表同理（`settingsStore.ts:28-44`）：可能被手改/被旧版本写过/写一半 | 以后做存档时照抄 `parseBindings` 的"逐项校验 + 坏数据整条丢弃 + 回落默认"模式 |

---

## 12. 开放问题（需要拍板；每条给倾向 + 理由 + 代价）

| # | 问题 | 我的倾向 | 理由 | 代价 / 备选 |
|---|---|---|---|---|
| **Q1** | 一局失败：全丢 / 回第 1 场保留解锁 / 存检查点？ | **全丢** | 规则最简；不引入"跨局"与"当局"两套状态 | 一局 10 分钟、失败惩罚重。备选：允许"重打当前场一次" |
| **Q2** | "每次战斗后选 1 个"：**永久累积**还是**只对下一场生效**？ | **永久累积** | 与"解锁是永久的、整局都可以选"一致；不需要"换/卸"的界面 | 到第 7 场有 6 个炁机同时在跑，叠加规则（禁用 `setOverride`）必须到位 |
| **Q3** | 兜底 +30 血能重复选吗？ | **不能（每局一次）** | 关掉"故意不解锁、一路堆血"的退化策略 | 后期没有安全选项。备选：可重复但收益递减 |
| **Q4** | 解锁计数是**跨场累计**还是**单场内**？ | **跨场累计** | 单场可能凑不满（某场可打断读条少） | "3 次截"可能拖到第 3 场才解锁；需要 UI 显示进度 |
| **Q5** | 正式流程里**备战界面**的语义？ | **开发入口**（`?mode=dev` / `?prepare=skip`） | 备战的核心能力是"挑 Boss"，与肉鸽的"顺序随机"语义冲突 | 玩家路径多一个 `CharacterSelect` 屏；若希望玩家也能直接挑 Boss 打一场，就要给一个"自由战斗"入口 |
| **Q6** | 3 个角色**共享技能套**还是**各有一套**？ | **先共享**（R0：只差属性 + 固有被动） | 第一步避开跨 4 层的改动；属性差异已经能构成"选择" | 角色玩法差异小，可能不满足期待。备选：直接做 R3，代价是 P1 之前先做一次跨层重构 |
| **Q7** | 局长随 `BOSS_POOL` 变（2→7）还是固定 7 场？ | **随 pool 变** | 今天就能跑通（2 场），且不会"换个名字的傲慢" | 局长度在开发期会一直变；需要单测覆盖 `total=1/2/3/7` 的归一化 |
| **Q8** | 通关之后做什么？ | 回 `CharacterSelect`（重开一局） | 最小实现 | 缺少长期动力。备选：无尽模式 / 提高起始档位再来一局（需要新的状态字段） |
| **Q9** | 开局是否展示**本局随机顺序**？ | **盲打**（不展示） | 未知 = 紧张感，也是用户要"顺序随机"的本意 | 玩家无法为后面的 Boss 提前规划 build（但那本来也是肉鸽的核心张力）。备选：只显示"还剩几场" |
| **Q10** | 是否做**局内存档**（刷新不丢）？ | **先不做**（P5 再评估） | 引入持久化 = 版本迁移 + 未验证输入解析 | 中途刷新丢一局；手机上尤其容易（切后台被回收） |
| **Q11** | 允许给引擎加 `interruptSuccess.sourceSkillId`（§5.2.2 方案 A）吗？ | **允许** | 这是唯一需要动 `core/` 的地方（2 处 emit + 1 个可选字段），且**不参与任何判定** | 若不允许，只能用"同 tick 配对"的脆做法（方案 B） |
| **Q12** | 开发期炁机数量不足时，选择屏**跳过**还是**照常弹（只有兜底可点）**？ | **候选 ≤ 1 时跳过 + 提示** | 避免一个假选择屏 | 玩家会疑惑"为什么这次没有选择"，需要文案 |

---

## 13. 我没做的事（明确说明，避免误解）

- **没写任何功能代码**：`src/` 一行未改；本文档是唯一新增文件。
- **没 commit、没 push**（用户明确要求，且 AGENTS.md §3c 禁止自行 push）。
- **没跑 typecheck / eslint / test / build**：没有代码改动，跑了也不能证明
  这个设计对；文档本身不在 lint 范围（`tests/unit/lintRules.test.ts` 扫
  `src/`、`tests/`、`tools/`）。
- **没设计 5 个未开发 Boss 的机制**（`envy`/`gluttony`/`wrath`/`sloth`/`greed`）
  —— 各自需要一份 boss spec。
- **没设计卡莉 / 玳瑄的招式**（只给了数据模型与骨架）。
- **没做数值平衡**（没有可玩的 7 档，无法实测）。
- **没画 UI 线框图、没出截图**。
- **没验证 §6.2 的档位系数**是不是"手感对"—— 那要等 P3 能跑起来实测。

---

## 14. 决议记录

| 日期 | 决定 | 理由 |
|---|---|---|
| 2026-10-12 | 「一局」是**新的 `core/run/` 层**，不进 `BattleState` | 单场重放被黄金测试钉死；跨场数据放进去会让重放依赖前几场 |
| 2026-10-12 | 强度档按**归一化进度**，不按绝对序号 | 局长度随 `BOSS_POOL` 变；归一化才能在任何长度下满足"越后越难" |
| 2026-10-12 | 炁机**不是** `GameEntity`；生效用 `Ability[]`，装配成 `passiveModifiers` + 固有 buff | `Loadout`/`items` 那条路引擎无消费者（§0.3.1） |
| 2026-10-12 | 解锁条件用**事件流归约**，不新增引擎计数器 | counters 在战斗路径是死桩（`stats.ts:138`）；事件已经确定性地产出，成本低一个数量级 |
| 2026-10-12 | **禁用 `setOverride`** 的炁机 | 它是唯一非交换的 op，禁掉之后"叠加顺序"永远无关 |
| 2026-10-12 | 备战界面 = **开发入口**，不是正式"选角色"页 | 语义冲突（挑 Boss vs 顺序随机），且测试需要它的完整能力 |
| 2026-10-12 | 兜底 = **+30 血、每局一次** | 关掉"不解锁、一路堆血"的退化策略 |
