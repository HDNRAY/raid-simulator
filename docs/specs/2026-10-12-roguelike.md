# 肉鸽（roguelike）机制设计 —— 7 场战斗 / 随机 Boss 顺序 / 强度曲线 / 「炁机」

> 日期：2026-10-12（第一次修订）
> 状态：**待评审**。本文只是设计，**不含实现代码**（`src/` 一行未改，未 commit、未 push）。
> 前置：[架构与 UI 规范](./2026-10-09-architecture.md) ·
> [数据模型规范](./2026-10-09-data-model.md) ·
> [i18n 规范](./2026-10-09-i18n.md) ·
> [「傲慢」Boss 设计](./2026-10-11-pride-boss.md) ·
> [「色欲」Boss 设计](./2026-10-10-lust-boss.md)
>
> **定位：先定目标体验，引擎跟着改。**
> 本文把"引擎里现在没有的东西"当作**待实现的工作项**（§0.3.1、§9.2），
> **不是**当作"所以设计只能这样"的约束。

---

## 0. 范围与术语

### 0.0 ⚠️ 术语（先说清，全文按这个用）

| 术语 | 含义 | 量级 |
|---|---|---|
| **一局肉鸽**（run） | 玩家选完角色、一路打到底的**整局**：7 场战斗 + 每场之间的结算/选择 | ~15 分钟 |
| **一场战斗**（battle） | 一个 `BattleEngine` 从 `running` 到 `victory`/`defeat` | ~95 秒（当前实测） |
| **位置**（position） | 这一场战斗是**一局肉鸽**里的第几场（1..7） | — |
| **顺序**（order） | 本局肉鸽 7 个 Boss 的一个随机排列 | — |

⚠️ 本文**不再使用孤立的"一局"**这个词 —— 凡涉及歧义处一律写
"一局肉鸽"或"一场战斗"。

### 0.1 本文要做的事

| # | 交付 | 验收（读完本文能判断） |
|---|---|---|
| **A** | **7 个 Boss、出场顺序随机**，由种子决定 | §2、§7 |
| **B** | 按**位置**的**强度曲线**：越后越难 | §6（7 档表） |
| **C** | 难度**不只加数值**，机制也变（例：第 3/4 位起才开二阶段） | §6.3（每条指到引擎的确切落点） |
| **D** | 玩家**选 1 个角色**开局 | §4（只定义流程与数据形状；**角色内容不在本文范围**） |
| **E** | 「炁机」= `GameEntity` 的子类（强化方向 / 奇物 / 奖励） | §5.1 |
| **F** | 解锁条件是**行为式**的（如"成功使用 3 次截"） | §5.2（含**要实现的引擎能力**） |
| **G** | 解锁是**一局肉鸽内**的；每场战斗后**选 1 个生效** | §5.3 |
| **H** | **兜底选项**：+30 血量等 | §5.4（= 一小组"通用炁机"） |
| **I** | 新的局内交互流程 | §3（逐屏状态机 + 复用/新做） |
| **J** | **现有备战界面保留** | §3.4（明确它的语义） |
| **K** | 引擎改动清单 + 可独立验收的落地阶段 | §0.3.1、§9.2、§10 |

### 0.2 本文**不包含**

- 实现代码、commit、push（用户明确要求）。
- **角色设计与初始技能套**。用户已有想法，且"这跟肉鸽流程没关系"。
  本文只保留"流程上怎么选角色"与"角色数据需要什么形状"（§4）。
- **5 个未实现 Boss（`envy` / `gluttony` / `wrath` / `sloth` / `greed`）
  各自的机制**。"还剩的 5 个 Boss 慢慢加" —— 本文只说：7 个位置、
  7 档强度、随机顺序**按 7 个展开**；未实现的会依次补上（§10 P8）。
- 数值平衡矩阵。仓库定位是"数值还会大改、机制优先"
  （`docs/specs/2026-10-10-lust-boss.md` §0.2），所以只给**旋钮**与
  **目标形状**。
- UI 线框图 / 截图 / mockup。

---

## 0.3 现状核实（事实表；每条可复核）

事实核查与"要做什么"分开：**本表只是事实**，结论在 §0.3.1。

| 事实 | 值 / 结论 | 证据 |
|---|---|---|
| Boss 名单 | **7 个**：`meiichiro`(傲慢) / `lust`(色欲) / `envy` / `gluttony` / `wrath` / `sloth` / `greed` | `src/data/roster.ts:60-69` |
| 已实现玩法的 Boss | 2 个（傲慢、色欲）；其余 5 个在 `DEVELOPING` 里、备战界面灰掉 | `src/data/roster.ts:87-95` |
| 未实现 Boss 的行为表 | **借用于「傲慢」的轮转**（占位，防"从存档/调试路径进来崩掉"） | `src/data/units.ts:88-105` |
| 角色名单 | 3 个：`player`(林晚风) / `kaili` / `daixuan` | `src/data/roster.ts:48-52` |
| 已实现玩法的角色 | 1 个（林晚风）；`kaili` / `daixuan` 在 `DEVELOPING` 里 | `src/data/roster.ts:87-95` |
| 3 个角色机制上完全相同 | `makePlayer(id)` **只用 id 取显示名**；属性/上限/技能全是全局常量 | `src/data/units.ts:62-79`、`35-52` |
| 玩家技能全集 | 9 个：`attack` / `blast` / `focus` / `break` / `dodge` / `guard` / `flash` / `jie` / `strike`(派生) | `src/data/content.ts:545-557` |
| "哪些技能是玩家的" | 全局唯一真相 `PLAYER_SKILL_IDS`，**没有 per-character 概念** | `src/data/content.ts:585-587` |
| **引擎的边界 = 一场战斗** | `BattleEngine` 是一个 encounter 的状态机；当前"重开"是**重建一个 `BattleLoop`**，不是引擎里的第二场 | `src/core/combat/battleState.ts:74-83`、`src/app/battleSetup.ts:59-117` |
| 种子从哪来（现状） | app 层 `seed: Date.now() >>> 0`（`core/` 禁 `Date.now`） | `src/app/battleSetup.ts:89-90` |
| 两条随机流 | `BattleState.rngSeed`（玩家侧）+ `BattleState.aiRngSeed`（AI 选招），**刻意分开** | `src/core/types/runtime.ts:73-88`、`src/core/ai/index.ts:57-63` |
| 随机数工具 | `core/rng.ts` 的 mulberry32（`nextRandom` / `randomInt` / `rollChance`），状态手动穿线、纯函数 | `src/core/rng.ts` |
| 重放格式 | `REPLAY_FORMAT_VERSION = 2`；`RecordedRun = {version, seed, ticks, input}`，**一场战斗一份**；测试断言它就是 2 | `src/core/run.ts:44-62`、`tests/golden/replay.test.ts:81-88` |
| 界面阶段 | `Phase = 'prepare' \| 'battle'` | `src/app/flow.ts:37-38` |
| 结算 | 结算面板画在 `BattleScene` 里（`renderResultPanel`）；结束后 **Enter / 触屏点屏 → `backToPrepare()`** | `src/render/resultPanel.ts:32-76`、`src/app/loopWiring.ts:166-172`、`src/app/canvasInput.ts:96-107` |
| 备战界面的语义 | **"选人物 + 选 Boss + 开始"**（玩家直接挑对手），"开始"那一刻判 `isDeveloping` | `src/ui/prepareLogic.ts:275-359`、`src/ui/PrepareScreen.ts:71-96` |
| 生命钳制用的是**静态 caps** | `changeResource` 用 `combatant.caps[key]` 钳制；`maxHp` 只是属性管线里的一个累加器，**没有任何地方读它去改上限** | `src/core/combat/index.ts:83-113`、`src/core/stats/aggregate.ts:89` |
| 内容实体的实例化路径**没有消费者** | 注册表可以传 `entities`，但没有"实体 → 战斗输入"的规范化；`deps.ts` 传的是 `entities: []` | `src/core/content/registry.ts:16-70`、`src/app/deps.ts:48-51` |
| 事件流不外传 | 每 tick `drainEvents()` **排空一次**，被 `ViewAdapter` + `logFormatter` 消费 | `src/app/battleLoop.ts:354-362` |

> ⚠️ **工作区状态说明**：`src/main.ts` 当前**正在被拆成 `src/app/*`**
> （`bootstrap.ts` / `deps.ts` / `flow.ts` / `game.ts` / `loopWiring.ts` /
> `battleSetup.ts` …，本轮 `git status` 里是未提交状态）。本文按**拆分后**
> 的结构引用；若该拆分回退，同一批接线都在 `main.ts` 里，位置一一对应。

### 0.3.1 ⚠️ 引擎缺口清单 = **待实现的工作项**（不是约束）

下表是"类型/数据里声明了、引擎里还没有消费者"的东西。
**它的性质是 TODO 列表**：该实现就实现，不需要的就删掉
（仓库纪律："死值先删，以后需要再加回来"）。

| # | 缺口 | 现在什么样 | 要做什么 | 层 | 用在哪 | 判定 |
|---|---|---|---|---|---|---|
| **W1** | `Combatant.counters` 没有写入者；`Expr {e:'counter'}` 读取恒 0（战斗路径的 `getCounter` 是 `() => 0`） | 死的 | ① 新增一个**写计数器**的能力/效果（`delta` + 池子 + 具名计数器）；② `core/combat/stats.ts` 的 `getCounter` 真正读 `combatant.counters`（`ResourcePoolRef` 的 `combatant` / `entity` / `encounter` 三种） | `core/types` + `core/combat` | **炁机的解锁条件**、Boss 机制 | **实现** |
| **W2** | `Condition` 没有"计数器比较" | 缺 | 新增 `{kind:'counterAtLeast' \| 'counterBelow'; who?; counter; value}`（与既有 `resourceAbove` 同构） | `core/types/stats.ts` + `core/expr/deps.ts` + 求值 | 战斗内的条件（炁机的 `when`、Boss 换招） | **实现** |
| **W3** | `Hook:'onInterruptSuccess'` 不派发（引擎只派发 3 个 hook） | 死的 | 派发它，并**带上"打断者用的哪个技能"**（现在事件里的 `skillId` 是**被打断的读条**，`sourceId` 才是打断者） | `core/combat/triggers.ts` + `core/combat/hitResolution.ts` + `core/events.ts` | "成功使用 N 次**截**"这类条件 | **实现** |
| **W4** | `Ability:'grantSkill'` 无执行点 | 死的 | 实现：把技能加入施法者的已知技能（`SkillBook.known` / 技能栏） | `core/combat` + `core/types/loadout.ts` | 炁机给**新技能**（肉鸽的核心之一） | **实现** |
| **W5** | `Ability:'consume'` 无执行点 | 死的 | 实现：从内容实例的资源池扣（`ResourcePoolRef`） | 同上 | 奇物类炁机（使用次数 / 充能） | **实现**（做活装备路时） |
| **W6** | `maxHp` 修正**不生效** —— 生命钳制走 `combatant.caps`，而 `caps` 是构造时写死的 | 半死 | 把 `caps.hp` 变成 `maxHp` 的**基底**，并让钳制走"结算出的 maxHp" | `core/combat` + `core/stats` | 通用炁机「+30 最大生命」 | **实现** |
| **W7** | `GameEntity` / `Loadout` → 战斗输入**没有规范化层** | 缺 | 新增规范化：`GameEntityInstance[]` → `passiveModifiers` + 固有 buff + `grantSkill` | `core/loadout`（新） | **炁机继承 `GameEntity` 的落地路** | **实现** |
| **W8** | `EntityKind` 没有 `'qiji'` | 缺 | 加值 + 校验器 + 注册表 | `core/types/skills.ts` + `core/content` | 炁机 | **实现** |
| **W9** | `Behavior:'interruptible'` 无消费者 | 死的 | 本设计不需要 → **删** | `core/types/behavior.ts` + `core/content/validate.ts` | — | **删** |
| **W10** | `Behavior:'timeLimit'` 无消费者（时限其实来自 `CreateBattleOptions.timeLimitMs`） | 半死 | 二选一：把时限收进行为数组（更内聚）或删掉这个变体保留 options | `core/ai` + `core/types/behavior.ts` | — | **删**（现状 options 已在工作，改动收益低） |
| **W11** | `Hook:'onPhaseChange'` 不派发 | 死的 | 二阶段用 `onHpBelow` + phase buff **已经够**；不引入"阶段"这个一等概念 → **删** | `core/types/triggers.ts` | — | **删** |
| **W12** | 一局肉鸽的状态 / 流程**不存在** | 缺 | 新增 `src/core/run/`：洗牌、解锁判定、跨场累计、生命周期 | `core/run`（新） | 全部 | **实现** |

**两条"我们**不**采用**的做法"（写下来是为了记录取舍）：

| 被否掉的做法 | 为什么不 |
|---|---|
| 用**事件流归约**（`onEvents` 回调 + 逐事件统计）算计数器 | 改成 W1 之后**不需要**了：`BattleState.combatants[].counters` 是**快照的一部分**，一场战斗结束直接读终局快照即可（可序列化、可哈希、天然重放）。事件流只多一层间接 |
| 把**一局肉鸽**塞进 `BattleState` | `BattleState` 是**一场战斗**、且被黄金重放逐位钉死。跨场数据放进去会让"第 3 场战斗的重放"依赖前两场的输入（见 §2.1） |

---

## 1. 设计目标：一局肉鸽里玩家应该面对什么

一句话：**带着一个角色和一个不断变强的配置，穿过一条由 7 个随机顺序的
Boss 组成、越往后越窄的走廊。**

三个张力，按重要性排序：

| # | 张力 | 靠什么产生 |
|---|---|---|
| 1 | **未知**：下一场是谁、更难在哪 | 7 个 Boss 的顺序随机（§2）+ 位置强度曲线（§6） |
| 2 | **取舍**：每场战斗后只能拿一个强化 | 炁机解锁 + 每场战斗后的选择（§5） |
| 3 | **稀缺**：解锁条件要求你**主动去做某事** | 行为式解锁条件（§5.2） |

第 3 条是核心，也是用户点名要的：如果解锁只是"打赢就送"，它就退化成
数值堆叠；要求"成功使用 3 次截"意味着**玩家必须改变打法去够那个条件**
—— 而"截"的风险是"打空了要等 10 秒"（`data/playerSkills.ts:72-93`），
所以那是一个**有代价的选择**。

---

## 2. 一局肉鸽的结构

### 2.1 定义与边界

| 概念 | 定义 | 归属 |
|---|---|---|
| **一场战斗** | 一个 `BattleEngine` 从 `running` 到 `victory`/`defeat` | **现状**（`core/combat/`）—— 结构不变，但**要往里加能力**（§0.3.1 的 W1–W8） |
| **一局肉鸽** | 从"选定角色"到"某场战斗失败"或"打完第 7 场" | **新增**：`src/core/run/`（§9.1） |
| **位置** | 本局肉鸽内这一场战斗是第几场（1..7） | 决定强度档（§6） |
| **顺序** | 7 个 Boss 的一个排列 | 由 `runSeed` 决定（§7） |

**为什么一局肉鸽必须是新概念、不能塞进 `BattleState`：**

- `BattleState` 是**一场战斗**、**可结构化克隆、可哈希**
  （`core/types/runtime.ts:66-72`），并被 `tests/golden/replay.test.ts`
  逐位钉死。
- 把跨场数据（解锁、计数器、顺序）塞进去，会让"第 3 场战斗的重放"
  依赖"第 1、2 场战斗的输入"，重放文件爆炸，黄金基线跟着变。
- 放在 app 层（`src/app/`）也不行：**不能写单测**（要 DOM），
  而"行为式解锁"的正确性**必须**有单测。`src/core/` 是零依赖纯 TS，
  能在 Node 里直接跑。
- **结论：一局肉鸽 = 一个新的纯逻辑层 `src/core/run/`**，
  零依赖、无 `Math.random` / `Date.now`、状态是 plain object、
  可 JSON 序列化、可哈希。

### 2.2 生命周期

```
startRun(runSeed, playerId)
   → order = 7 个 Boss 的随机排列（由 runSeed 决定，§7）
   → position = 1，counters = {}，unlocked = [通用炁机…]，chosen = []

每一场战斗结束（读终局快照）：
   → counters += 玩家这一场战斗的 counters        // §5.2.2
   → 用 counters 重算 unlocked（§5.2）
   胜 → position += 1
        → position > 7：status = 'victory'（通关）
        → 否则：结算 → 选 1 个炁机生效 → 开下一场战斗
   负 → status = 'defeat'（一局肉鸽结束）
```

### 2.3 局长 = **固定 7 场**

设计按 **7 个位置、7 档强度、7 个 Boss 的随机排列**展开。
剩下 5 个 Boss "慢慢加" —— 它们补上之后，这一局肉鸽的形状**不变**
（只是每个位置有更多可能的面孔）。

| 阶段 | 7 个 Boss 里有几个能打 | 一局肉鸽怎么跑 |
|---|---|---|
| 现在 | 2 | **设计不变**：仍然是 7 个位置、7 档强度。开发期用调试参数跑短局（见下），**这不是设计形态** |
| 逐个补 | 3 → 6 | 同上，每个位置的可选面孔变多 |
| 全部 | 7 | 需求原样 |

**开发期怎么跑（调试入口，不改设计）：**

```
?runlen=2        只打 2 场战斗（第一个位置用最软档，最后一个位置用最硬档）
?runlen=7        默认（正式形态）
?order=k1,k2,... 指定顺序（复现某个具体局面 / 截图）
?tier=4          强制某一档（调曲线用）
```

这些走**玩家同一条代码路径**（与现有 `?prepare=skip` / `?boss=` 的思路一致，
`src/app/game.ts:143-159`），不做旁路。

⚠️ **为什么不"用占位轮转假装 7 个都能打"**：5 个未实现 Boss 现在共用
傲慢的行为表（`data/units.ts:88-105`），对玩家来说"第 4 场是嫉妒"和
"换了个名字的傲慢"没有区别 —— 那会让"随机顺序"看起来像 bug。
所以开发期的 `BOSS_POOL` = 已实现的 Boss，一局肉鸽的场数等于
`BOSS_POOL.length`，**但强度档是按 7 档表取子集**（第 k 个位置取第
`ceil(k * 7 / len)` 档），这样"最后一个位置最难"永远成立，
而且补完 Boss 之后**只是 `len` 从 2 变成 7，曲线表一个字都不用改**。

### 2.4 失败代价：**一局肉鸽结束，全丢**

- 失败 → 回"选角色"，重开一局肉鸽（`status='defeat'`）。
- **不做**"跨局永久成长"（那是 roguelite 的元进度，用户没要；
  它会让"一局肉鸽内的解锁"与"跨局解锁"两套状态打架）。
- 理由与取舍见 §12 决议 #1。

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
│ CharacterSelect  │  列出 PLAYER_ROSTER（未实现的灰掉）    │ Prepare（现有，保留） │
│ 选 1 个角色      │  ←→ 移光标 / Enter 确定 / 点卡确定     │ 选人物 + 选 Boss      │
└────────┬─────────┘                                       └──────────┬───────────┘
         │ Enter                                                     │ Enter
         ▼                                                           ▼
┌──────────────────┐                                       ┌──────────────────────┐
│ RunIntro         │  显示"本局共 7 场"+"第 1 场：XXX"      │ Battle（单场，现状）  │
│ 开局              │  Enter / 点"开始"                       │                      │
└────────┬─────────┘                                       └──────────┬───────────┘
         ▼                                                           │ 胜/负
┌──────────────────┐                                                 ▼
│ Battle（第1场）   │◄──────────────┐                        ┌──────────────────────┐
└────────┬─────────┘               │                        │ Result（现有结算面板）│
         │ 胜                      │                        │ Enter/点屏 → Prepare  │
         ▼                          │                        └──────────────────────┘
┌──────────────────┐               │
│ Result（结算）    │  Enter/点屏    │
└────────┬─────────┘               │
         │ position ≤ 7             │
         ▼                          │
┌──────────────────┐               │
│ QijiSelect       │  候选 = 已解锁的炁机（含"通用炁机"兜底）
│ 选 1 个生效       │  ←→ 移光标 / Enter 确定 / 点卡确定
└────────┬─────────┘               │
         │                         │
         └─────────────────────────┘
         下一场战斗（Boss = order[position]，档位 = 第 position 档）

  任一场战斗负 ──► RunOver（失败：打到第几场）
  第 7 场胜     ─► RunOver（通关：本局带了哪些炁机）
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
（`render/BattleScene.ts:544-548`）。把它提升成独立 phase 会让
"战斗场景的显隐"多一个状态，而现有代码的注释已经把"两个界面同时可见"
列为踩过的坑（`src/app/game.ts:204-206`）。**结算 = `battle` phase 内的
一个子状态**，由 `snapshot.status !== 'running'` 表达（现有做法）。

⚠️ 加 phase 必须同时改这几处（现在都 switch 在 `phase` 上）：

| 位置 | 现在读什么 | 要改成什么 |
|---|---|---|
| `src/app/loopWiring.ts:86` | `phase === 'prepare'` → 只 frame 备战 | 按 phase 分发到各自的屏 |
| `src/app/loopWiring.ts:132-172` | 备战/战斗两段键盘 | 每段按 phase 分派（Enter 在 4 个屏里语义都不同） |
| `src/app/canvasInput.ts:43,93,96` | `phase() === 'prepare'` + 结算点屏 | 新屏的命中分支插在"设置"之前（该文件"顺序即优先级"） |
| `src/app/game.ts:316,346,363` | `isPrepareOpen` / `phase` / `acceptsKeyboardFocus` | 触屏层要**在非 `battle` 的一切 phase 都隐藏** |
| `src/app/flow.ts:37` | `Phase` 联合 | 加 3 个值 |

### 3.3 复用 / 新做

| 屏幕 | 复用 | 新做 |
|---|---|---|
| `CharacterSelect` | **卡片渲染 + 命中区 + 光标模型**：`prepareLogic` 的 `cycleCursor` / `moveFocus` / `confirmCursor` / `pickOption` 几乎原样可用 | 新的卡片屏（或把 `PrepareScreen` 参数化成"几行槽位"） |
| `QijiSelect` | `Panel` / `Label` / `IconButton` 原语；`prepareLogic` 的光标/命中区模式 | 卡片要显示**解锁进度**（如 `截 2/3`）→ 需要带参数的进度文案 |
| `Result` | 现有 `renderResultPanel` **零改动** | 只加一条"继续"提示的 i18n key |
| `RunOver` | `Panel` / `Label`；摘要排版可参考 `resultPanel` | 通关/失败两种文案 + 本局统计（打到第几场、带了哪些炁机） |
| `Prepare` | **原样保留** | 无 |

**建议抽 `ui/cardSelectLogic.ts`**（纯逻辑，Node 里可测）承载
"上下换槽 / 左右移光标 / Enter 确定 / 点击=移光标+确定"，让
`PrepareScreen` / `CharacterSelect` / `QijiSelect` 共用。

- **为什么**：三个界面的交互**完全同构**，而 `prepareLogic` 里已经有两条
  来之不易的结论 ——"光标与选择是两个独立概念""点击 = 移光标 + 确定
  （为了触屏与键盘对等）"（`src/ui/prepareLogic.ts:19-37,297-306`）。
  复制三份 = 三份会各自漂移的规则。
- **放弃了什么**：这是一次**重构**，会动 `PrepareScreen` 与其测试
  （`tests/unit/prepareLogic.test.ts`、`prepareRender.test.ts`）。
  退路：先复制一份 logic，等三个屏都稳定后再合并（但要在注释里显式记下
  "这里有两份，合并是待办"）。

### 3.4 ⚠️ 备战界面在新流程里的位置

**决议：`Prepare` = 开发/测试入口，不是正式流程的"选角色"页。**

理由：

1. **语义冲突**。备战界面的核心能力是"**玩家直接挑 Boss**"
   （`prepareLogic.ts:275-295`）。而肉鸽模式的第一条规则就是
   "**不许挑 Boss**"。同一界面同时承担两种语义，只能靠"肉鸽模式下把
   Boss 行灰掉"实现 —— 那是把备战的主要功能在正式流程里废掉还留着 UI。
2. **测试需要完整能力**。开发时要能"指定任意 Boss + 任意角色 + `?noai=1`
   静止场景截图"（`data/units.ts:108-115` 的 `noAi` 就是为这个存在）。
   这个能力不该塞进正式流程。
3. **入口可共存**。正式流程走 `CharacterSelect`，开发走 `?mode=dev` /
   `?prepare=skip`，互不影响、不用改现有代码。

**放弃了什么**：玩家路径上多一个屏才能开始；备战界面在正式流程里看不到。

### 3.5 输入：键盘与触屏**必须对等**（AGENTS.md §3b）

| 屏幕 | 键盘 | 触屏 | 对等性怎么保证 |
|---|---|---|---|
| `CharacterSelect` | ←→ 移光标；Enter 确定 | **点卡片 = 移光标 + 确定** | 复用 `prepareLogic.pickOption`（它的注释明确说"点击必须一步确定"） |
| `RunIntro` | Enter = 开始 | **点"开始"按钮** | 不能只让 Enter 能开始（仓库踩过：改键只有 Enter 一条路，触屏进不去） |
| `Result` | Enter = 继续 | 点屏任意处 = 继续（现有路径） | 已有 |
| `QijiSelect` | ←→ 移光标；Enter 确定 | 点卡片 = 确定 | 可选加数字键 `1..9` 直达（**加速器**，不是唯一路径） |
| `RunOver` | Enter = 回选角色 | 点屏任意处 | 同上 |

**键位提示不进 i18n**（AGENTS.md §3b）：新屏的"继续 (Enter)"由渲染层
拼上按键名，触屏不拼；i18n 里只放 `'继续'`。

**一个要处理的边界**：`acceptsKeyboardFocus: () => state.phase === 'battle'`
（`game.ts:363`）—— 新屏里 ↑↓/Enter 属于界面本身，设置按钮**不能**抢焦点。
保持"只在 `battle` 允许"即可，但要显式确认（否则新屏按 `Enter` 会先开设置，
而那种 bug 在截图里看不出来，见 `flow.ts:85-88`）。

---

## 4. 角色：只保留"流程怎么选"与"数据形状"

⚠️ **角色设计与初始技能套不在本文范围**（用户已有想法）。
本节只回答两件事。

### 4.1 流程

`CharacterSelect` 列出 `PLAYER_ROSTER`，未实现的（`isDeveloping`）灰掉、
标"开发中"，与现有备战界面卡片的画法一致（`roster.ts:87-100`）。
选定后写进 `RunState.playerId`，一局肉鸽内不再改变。

### 4.2 角色数据的形状（**如果需要**）

现在 `makePlayer(id)` 只用 id 取显示名，属性/上限/技能全是全局常量
（`units.ts:35-52,62-79`）。要让角色"不一样"，需要一个
`CharacterDef`（放 `src/data/characters.ts`）：

```ts
export interface CharacterDef {
  readonly id: EntityId;
  readonly nameKey: LocaleKey;
  /** 覆盖 PLAYER_BASE（缺省字段回落全局默认） */
  readonly base: Partial<Record<StatKey, number>>;
  /** 覆盖 PLAYER_CAPS */
  readonly caps: { readonly hp: number; readonly energy: number; readonly douqi: number };
  /** 初始技能套（**内容由用户定**，本文不设计） */
  readonly skills: readonly SkillId[];
  /** 这些技能默认绑哪些键 */
  readonly bindings: readonly KeyBinding[];
  /** 固有被动（开局就挂的 buff） */
  readonly innate: readonly BuffDef[];
}
```

**两条与肉鸽流程有关的注意点**（其余是角色内容的事）：

1. **一局肉鸽的成长（炁机）叠加在角色的 `caps` / `base` 上**，
   所以 `CharacterDef` 要能被"叠加"而不是写死（§5.5）。
2. **若每个角色有不同的初始技能套**，那么"可绑技能 / 技能栏 / 触屏按钮 /
   设置页"这四处现在都从**全局** `PLAYER_SKILL_IDS`（`content.ts:585`）
   与 `DEFAULT_BINDINGS`（`keyboard.ts:53`）派生，需要**参数化成 per-character**。
   这是一个跨 4 层的改动，**记为 R3**（§10）；在它之前，角色差异只能是
   属性/上限/固有被动。

---

## 5. 「炁机」系统（设计重心）

### 5.1 数据模型：`QijiEntity extends GameEntity`

用户确认："**炁机也是 gameentity 啊……继承**"。

```ts
// core/types/skills.ts：加一个 kind
export type EntityKind =
  | 'equipment' | 'consumable' | 'passive' | 'buffTemplate'
  | 'activeSkill' | 'encounter'
  | 'qiji';                      // ← W8

// core/types/qiji.ts（新文件）
/** 一个炁机：`GameEntity` 的子类。 */
export interface QijiEntity extends GameEntity {
  readonly kind: 'qiji';
  /** 只用于 UI 分组与排序。 */
  readonly category: 'offense' | 'defense' | 'tempo' | 'utility' | 'generic';
  /** 解锁条件（**一局肉鸽**维度）。 */
  readonly unlock: QijiUnlock;
  /** 一局肉鸽内最多生效几层（默认 1）。 */
  readonly maxStacks?: number;
}
```

**继承带来什么（这是选它的理由）：**

| `GameEntity` 已有的 | 炁机直接得到 |
|---|---|
| `id` / `nameKey` / `descKey` / `icon` / `rarity` | 展示信息，零额外字段 |
| `abilities: readonly Ability[]` | **"解锁后生效什么"**（与既有能力系统同一套） |
| `requires?: readonly Condition[]` | 战斗内条件（W2 之后能写计数器条件） |
| `pool?: ResourcePool` | 奇物类炁机的使用次数 / 充能（靠 W5 落地） |
| 内容校验器 / 注册表 | 加进 `ContentBundle` 即可被校验 |

**还差的那一步是 W7（规范化层）**：`GameEntityInstance[]` → 战斗输入
（`passiveModifiers` + 固有 buff + `grantSkill`）。现在注册表能收 `entities`
（`registry.ts:16-70`），但**没有任何东西把它变成战斗输入**
（`deps.ts:49` 传的是 `entities: []`）。做活它就是"炁机继承 GameEntity"
的落地路。

### 5.2 解锁条件

#### 5.2.1 数据形状

```ts
// core/types/qiji.ts
export type QijiUnlock =
  | { readonly kind: 'always' }                       // 开局即可选（"通用炁机"，§5.4）
  | { readonly kind: 'counterAtLeast'; readonly counter: RunCounter; readonly value: number }
  | { readonly kind: 'all'; readonly of: readonly QijiUnlock[] }
  | { readonly kind: 'any'; readonly of: readonly QijiUnlock[] }
  | { readonly kind: 'not'; readonly of: QijiUnlock };

/** 一局肉鸽内可累计的计数器（**封闭联合**，防止拼写错误静默失效）。 */
export type RunCounter =
  | 'jieInterrupts'      // 「截」成功打断次数（**W3** 派发 onInterruptSuccess 后可得）
  | 'interrupts'         // 任何技能成功打断次数
  | 'dodges'             // 成功闪避次数（引擎已有 `avoided` 事件 / 池子）
  | 'battlesWon'         // 赢下的战斗数
  | 'flawlessBattles';   // 满血赢下的战斗数
```

**"成功使用 3 次截"的完整链路（要动的引擎能力已标号）：**

| 步 | 做什么 | 需要的能力 |
|---|---|---|
| 1 | 内容里给「截」的 `onSuccess` 加一条**写计数器**的效果（`jieInterrupts += 1`）—— 它天然只在"真打断到了"时结算（`data/playerSkills.ts:132-135` 已经有 `onSuccess` 的用法：退 CD + 挂派生窗口） | **W1**（写计数器） |
| 2 | 也可以改用「挂一个带 `onInterruptSuccess` 触发器的 buff」表达，更通用、对任意技能成立 | **W3**（派发 hook）+ **W1** |
| 3 | 一场战斗结束时，把玩家快照里的 `counters` 累加进 `RunState.counters` | `core/run/`（**W12**） |
| 4 | 用 `RunState.counters` 求值 `unlock`，刷新"已解锁"集合 | `core/run/` |
| 5 | `QijiSelect` 列出已解锁的炁机 | UI |

```ts
export const QIJI_JIE_DERIVE_STRIKE: QijiEntity = {
  id: 'jieDeriveStrike',
  kind: 'qiji',
  nameKey: 'qiji.jieDeriveStrike.name',
  descKey: 'qiji.jieDeriveStrike.desc',
  icon: 'char_break',
  category: 'offense',
  unlock: { kind: 'counterAtLeast', counter: 'jieInterrupts', value: 3 },
  abilities: [ /* 例如：把「截」成功后的派生窗口拉长 / 让派生窗口可叠两层 */ ],
};
```

#### 5.2.2 计数器从哪来：**引擎内计数 + 一局肉鸽累计**

- **引擎内**：`Combatant.counters` 变成活的（W1），于是计数器是
  `BattleState` 的一部分 —— **可克隆、可哈希、天然可重放**。
- **一局肉鸽内**：每场战斗结束读**终局快照**的玩家 `counters`，
  累加进 `RunState.counters`。**不需要事件回调**（§0.3.1 的取舍表）。
- **时间窗**：**一局肉鸽累计**（不是单场内）。理由：单场可能凑不满
  （傲慢实际只有轻蔑/呵斥/回补 3 个可打断读条，碾压起手带霸体
  `bossPride.ts:249-304`；截 CD 10s、一场战斗 ~95s）。
  数据上加一个 `window` 字段留出将来收紧的余地，先只实现 `'run'`。

#### 5.2.3 计数器放在哪（回答关键约束）

| 候选 | 判断 |
|---|---|
| `BattleState` / `Combatant.counters` | ✅ **场内的计数**放这里（W1）。它是快照的一部分，可哈希可重放 |
| **`src/core/run/`（新增）** | ✅ **一局肉鸽的累计**放这里（W12）。零依赖、Node 可跑、满足 C1/C2/C4/C5 |
| app 层 | ❌ 不能写单测（要 DOM），而"行为式解锁"必须有单测 |

**唯一写入路径**：`RunState.counters` 只由"一场战斗结束时的累加"写。
这与 `input/touchLayout.ts` 的"`TouchLayout` 只有一个写入路径 `set()`"
是同一条设计纪律（AGENTS.md §3b）。

### 5.3 「每场战斗后选 1 个生效」的语义

| 问题 | 决议 | 理由 |
|---|---|---|
| **能叠吗** | 不同炁机共存；同一个 `QijiEntity` 默认 `maxStacks = 1`（通用炁机可以 >1） | 保留"每次做一个**新**决定"的节拍 |
| **选了能换吗** | **不能换**（永久生效） | 加"换"要一整个装卸界面，收益低（§12 决议 #2） |
| **同一场战斗里叠加顺序有影响吗** | **没有** —— 前提是**禁止 `op:'setOverride'`** | `core/types/stats.ts:48-54` 的 6 种 op 里，`add`/`addPercent`/`mult`/`max`/`perStackAdd` 全部**交换**，只有 `setOverride` 不交换。禁掉它，顺序就永远无关 |
| **永久累积还是每场战斗临时** | **永久累积**（一局肉鸽内） | §12 决议 #2 |

**禁止 `setOverride` 的落地方式**：在内容校验器里加一条断言（炁机的
`abilities` 里出现 `setOverride` → 内容校验失败），并配一条单测。

### 5.4 兜底：**一小组"通用炁机"**（不是特殊的 +30 血分支）

用户给了两条路：
> 如果 30 血只能选 1 次，就**多加几个兜底**，比如加一个**增加炁回复速度**，
> 或者就**不再限制每局结束只能选一个，但凡解锁的都激活**

**本文的设计：把"兜底"统一成 `unlock: {kind:'always'}` 的通用炁机
（`category: 'generic'`）。** 这样：

- 它**不是**一条特殊分支（不需要"如果没有解锁任何炁机就显示 +30 血"的
  特判代码），它只是候选池里**永远在**的几个选项。
- "多加几个兜底"= **多加几条内容数据**，零结构改动。
- 候选项永远 ≥ 3 → **不会出现"池子太小、没有选择"的假选择屏**
  （原 Q12 因此消失）。

**通用炁机（首批建议 4 个，数值待调）：**

| id | 效果 | 落点 | 需要的能力 | `maxStacks` |
|---|---|---|---|---|
| `vitality` | +30 最大生命 | `maxHp` 修正 | **W6**（`maxHp` 修正要真正生效）；未实现前走"构造时改 `caps`"的过渡 | 3 |
| `breath` | +炁回复速度 | `energyRegen` 修正 | 现有（`passiveModifiers` 已在读） | 2 |
| `resolve` | +护甲（减伤） | `armor` / `damageReduce` | 现有 | 2 |
| `insight` | +暴击率 | `critChance` 修正 | 现有 | 2 |

`maxStacks` 上限的作用：**选满一个维度之后被迫看向机制炁机**
（见 §11 风险 #2）。

**两个模式都写下来，默认 A：**

| 模式 | 规则 | 结果 |
|---|---|---|
| **A（默认）** | 保留"每场战斗后从已解锁里选 **1 个**生效" | 保留肉鸽的核心节拍（每场战斗一个决策）。通用炁机保证兜底 |
| **B（可选开关）** | **取消选择**：已解锁的**全部激活** | 没有 `QijiSelect` 屏；结构上的唯一改动 = 跳过选择屏、把所有已解锁的炁机都写进 `chosen` |

**默认 A 的理由**：用户原始需求第 8 条就是"每次战斗完，选择 1 个生效"，
而且"从 3 个里选 1 个"是这类游戏的标准节拍（选卡 / 选祝福 / 选升级）。
**B** 作为开关保留。

### 5.5 炁机怎么进入一场战斗（W7 规范化层的产物）

一个炁机的 `abilities` 归一化成三类战斗输入：

| `Ability.kind` | 变成什么 | 引擎现状 |
|---|---|---|
| `modifier` / `derived` | `passiveModifiers`（玩家 id → `StatModifier[]`） | ✅ 引擎已在读（`core/combat/stats.ts:101`） |
| `grant`(self, `duration: Infinity`) / `trigger` | 玩家的**固有 buff**（开局就挂） | ✅ 现成手法：`units.ts:142-151` 的 `innateBuffsFor` 就是这么给色欲挂反伤被动的 |
| `grantSkill` | 加入玩家的已知技能 | ❌ **W4** |

```ts
// src/data/kit.ts（纯函数，可单测）
export interface BattleKit {
  readonly base: Partial<Record<StatKey, number>>;
  readonly caps: { readonly hp: number; readonly energy: number; readonly douqi: number };
  readonly innate: readonly BuffDef[];
  readonly modifiers: readonly StatModifier[];
  readonly skills: readonly SkillId[];
}
export function buildPlayerKit(
  character: CharacterDef,
  chosen: readonly { readonly def: QijiEntity; readonly stacks: number }[],
): BattleKit;
```

**它现在就能工作**（modifier / 固有 buff 两条），`grantSkill` 要等 W4。

---

## 6. 强度曲线

### 6.1 档位：**7 个位置 ↔ 7 档**

一局肉鸽固定 7 个位置，位置 `k`（1..7）用第 `k` 档。

| 位置 | 1 | 2 | 3 | 4 | 5 | 6 | 7 |
|---|---|---|---|---|---|---|---|
| 档 | T1 | T2 | T3 | T4 | T5 | T6 | T7 |
| 段 | 开幕 | 开幕 | 中段 | **中段（基准）** | 收尾 | 收尾 | **终局** |

**开发期（已实现的 Boss 还不满 7 个）怎么取档**：
`档位 = ceil(k * 7 / len)` —— 保证**第一个位置一定是最软档、
最后一个位置一定是最硬档**。

| `len` | 位置 → 档 |
|---|---|
| 7 | T1 T2 T3 T4 T5 T6 T7 |
| 3 | **T3** T5 T7 ⚠️ |
| 2 | T4 T7（`ceil(1*7/2)=4`、`ceil(2*7/2)=7`） |
| 1 | T7（单场即终局） |

⚠️ **`len = 3` 那一格原先写的是 `T2`，是错的**（已改）。
`ceil(1 × 7 / 3) = ceil(2.33) = **3**` ✓ 而且 `ceil(k × 7 / 3)` 的取值**只可能是
{3, 5, 7}** —— `T2` **根本无法由公式产生** ✗

**判据是公式，不是这张表**：公式是本节显式给出的，并且满足它自己写的两条不变量
（第一个位置最软、最后一个恒为 T7）。实现（`tierForPosition`）按公式来，
有一组遍历所有 `len` 的不变量测试钉住它 ✓

**补完 Boss 时曲线表一个字都不用改** —— 变的只是"每个位置可能抽到谁"。

### 6.2 数值变化表（**与机制变化分开列**）

基准 = **各 Boss 自己声明的值**（不是全局常量），乘上档位系数。
今天的基准（傲慢，已核实的真实值）：

| 旋钮 | 今天的值 | 证据 |
|---|---|---|
| `weightedRotation.gapMs` | `4000` | `data/bossPride.ts:486` |
| `enrage.atMs` / `dmgMult` | `120_000` / `2` | `data/bossPride.ts:413` |
| Boss HP 上限 | `420` | `data/entities/bossHp.ts:51` |
| 二阶段门槛（回补） | `hpBelow 0.4`，CD `logicMs(2000)`（整场一次） | `data/bossPride.ts:447,367` |
| `timeLimit` | `180_000`（来自 `options`，不是行为） | `src/app/battleSetup.ts:77`、`core/combat/encounterEnd.ts:35` |
| 玩家 HP | `100` | `src/data/content.ts:85` |

档位系数（**建议值，不是拍板值**；`gapMs` 一列是"乘在 Boss 自己的
`gapMs` 上"）：

| 档 | 位置 | `gapMs` × | HP × | `enrage.atMs` × | 二阶段门槛 |
|---|---|---|---|---|---|
| **T1** | 1 | **1.25** | 0.85 | 1.15 | 关 |
| **T2** | 2 | 1.15 | 0.90 | 1.10 | 关 |
| **T3** | 3 | 1.05 | 0.95 | 1.05 | 关 |
| **T4** | 4 | 1.00 | 1.00 | 1.00 | **0.45** |
| **T5** | 5 | 0.94 | 1.06 | 0.95 | **0.45** |
| **T6** | 6 | 0.87 | 1.12 | 0.90 | **0.42** |
| **T7** | 7 | **0.80** | **1.18** | **0.85** | **0.40** |

（T4 故意 = "今天的值 ×1.0"：**基准档**；且**默认档必须是 T4**，
否则会动黄金基线 —— 见 §10 的 P4 验收。）

**必须写出来的约束（都是仓库里踩过的坑）：**

| 约束 | 为什么 | 证据 |
|---|---|---|
| **`gapMs` 的缩放必须逐 Boss 复核"`gapMs` vs 各自冷却 / 轮转类型"** | 傲慢是 `weightedRotation`，`gapMs 4000 > 冷却 3000` 是**刻意的**（真正决定节奏的是 `gapMs`）；色欲是 `rotation`，注释要求 `gapMs` **短于**各自冷却。两者不矛盾（轮转类型不同），但**同一个缩放系数不能想当然地套到两个 Boss 上** | `bossPride.ts:455-486`、`lustBoss.ts:318-360` |
| **`gapMs` 有下界**：不能缩到"纯进攻也赢"或出现死局 | 傲慢注释记着"`gapMs` 改大到 8000+ 会让纯进攻翻盘"（反过来说：改小会让玩家更吃力） | `bossPride.ts:477-479` |
| **HP × 必须与"整场一次的回补"联动** | 回补的数值语义是"回三成血"（`S(126) = 30% × 420`）。只缩/放 HP 而不动它，含义就漂了 | `bossPride.ts:344-355` |
| **`timeLimit` 不参与缩放** | 它来自 `options` 且超时判负（`encounterEnd.ts:33-37`）。缩放它会让"打得慢"直接变成输，而 `gapMs` 已经在控制节奏 | — |
| **所有数值走 `S()`**，时间走 `logicMs()` / `logicTicks()` | AGENTS.md §2；`logicTicks` 只接受非负整数逻辑步并在开发期抛错 | `core/loopConstants.ts:156-163` |

**玩家侧不做缩放**：玩家的成长来自炁机（§5）。若曲线也动玩家数值，
两条曲线互相掩盖，出问题时分不清是"曲线陡"还是"炁机强"。

### 6.3 机制变化表（"**哪一条现有机制在第几位解锁**"）

每条都标了它落在引擎的哪一层。

| # | 机制 | 解锁于 | 落在哪 | 内容上缺什么 |
|---|---|---|---|---|
| M0 | `opener` + 主轮转（Boss 的招牌机制） | 位置 1+（始终） | `opener` / `rotation` / `weightedRotation`（`core/ai/index.ts:138-152,176-195`） | ✅ 两个已实现的 Boss 都有 |
| **M1** | **二阶段** | **位置 ≥ 4**（"后 4 个"，对上用户说的"后 3、4 个出场"） | ① `weightedRotation` 的一步带 `when: hpBelow` + 长 CD —— **傲慢用的就是这条**（`bossPride.ts:438-449`）<br>② 或 `Behavior: onHpBelow` + `then: [grant(phase2 buff)]`（`core/ai/index.ts:154-162` + `runAi.ts:111-125`，`grant` 真的被执行） | ⚠️ **色欲没有二阶段**（`lustBoss.ts:324-360` 只有 opener + rotation） |
| **M2** | **霸体**（`interruptImmune`） | 位置 ≥ 4 | `BuffDef.flags.interruptImmune`（`core/types/buffs.ts:34`）被 `hitResolution` 读取；挂在招式的 `castStart`（`bossPride.ts:263` 的 `BOSS_HEAVY_ARMOR`） | ⚠️ **色欲没有霸体技** |
| **M3** | **控制**（倒地 / 眩晕） | 位置 ≥ 5 | `KNOCKDOWN`（`restrictToTags:['dodge']`，`bossShared.ts:89-103`）或 `EffectKind:'stun'`（`core/types/effects.ts:51-65`，`lustBoss.ts:281` 在用） | ⚠️ 傲慢只有倒地、色欲只有眩晕 |
| **M4** | **狂暴提前 + 更狠** | 位置 ≥ 5 | `Behavior: enrage` 的 `atMs` / `dmgMult`（`core/ai/index.ts:164-171`）→ `applyEnrage` 挂 `boss-enrage`（`bossShared.ts:58-68`） | ✅ 现有 |
| **M5** | **二阶段换招表**（进二阶段后轮转多出/少掉某些招） | 位置 ≥ 6 | `RotationStep.when` / `WeightedRotationStep.when` 支持 `hasBuff`（`core/types/behavior.ts:12-37` + `core/ai/index.ts:359-369`）→ 写 `when: hasBuff 'phase2'` 即可，**零新机制** | 需要"phase2 buff"（M1 的产出） |
| **M6** | **终局**：以上全部 + `gapMs` 最短 + 数值最高 | 位置 7 | 数据组合 | — |

**要新造的东西（明确标出）：**

| 新东西 | 加在哪 | 是不是新机制 |
|---|---|---|
| **洗牌 + 档位映射 + 解锁判定 + 一局肉鸽生命周期** | `src/core/run/`（**新层**，不碰 `core/combat/`） | ❌ 不是引擎机制，是**元层逻辑** |
| **档位 → `Behavior[]` / `caps` 的装配** | `src/data/intensity.ts` + `units.ts` 的 `behaviorsFor(id, tier)`（纯数据） | ❌ 不是新机制：`Behavior[]` 本来就是构造战斗时的输入 |
| **炁机的数据模型与规范化** | `core/types/qiji.ts` + `core/loadout/`（**W7 / W8**） | ⚠️ 新增（但继承 `GameEntity`，不是另起一套） |
| **计数器 + 计数器条件** | `core/combat`（**W1 / W2**） | ⚠️ 新增（补活已有声明） |
| **`onInterruptSuccess` 派发** | `core/combat/triggers.ts` + `hitResolution.ts`（**W3**） | ⚠️ 新增（补活已有声明） |
| **`grantSkill` / `maxHp` / `consume` 真正生效** | `core/combat`（**W4 / W5 / W6**） | ⚠️ 新增（补活已有声明） |
| **色欲的二阶段 / 霸体 / 控制；5 个未实现 Boss** | `src/data/*.ts` | ❌ 内容工作 |

**每个 Boss 的"最小机制集"（给未来的 boss spec 当验收项）**：
为了让"按位置解锁机制"成立，**7 个 Boss 每个都要能提供
M1（二阶段）+ M2（霸体）+ M3（控制）三条通道**；至少一条是它自己的
招牌。否则第 5 个位置遇到一个没有二阶段的 Boss，体感会比第 3 个位置还简单。

### 6.4 双曲线（Boss 越难 vs 玩家越强）

一局肉鸽里**两条曲线同时在动**：Boss 每场战斗更难（§6.2/6.3），玩家每场
战斗多一个炁机（§5）。设计上能做的：

1. **目标形状**：`第 k 场战斗的用时 / 剩余血量`大致持平
   （越来越轻松 = 曲线太缓；越来越险 = 太陡）。
2. **可测的量**：记录每场战斗的 `ticks` / 玩家剩余 HP，做一条
   "曲线回归"测试（固定 `runSeed` + 固定策略 → 逐场摘要），
   与 `tests/golden/replay.test.ts` 是同一个套路。
3. **不做数值保证**：仓库定位是"数值还会大改、机制优先"。

---

## 7. 确定性与重放（硬约束，逐条落实）

### 7.1 种子从哪来、存在哪

| 问题 | 答案 |
|---|---|
| 从哪来 | **app 层**用 `Date.now() >>> 0`。已有先例：`battleSetup.ts:90` 就是这么给一场战斗种种子的。**`core/` 里不许有它**（lint C2，`tests/unit/lintRules.test.ts:85-91`） |
| 存在哪 | `RunState.runSeed`（内存）；落盘见 §12 决议 #10 |
| 怎么派生顺序 | `shuffle(BOSS_ROSTER, runSeed)` 用 `core/rng.ts` 的 mulberry32（`randomInt`），**纯函数、状态显式穿线** |
| 每场战斗的种子 | `battleSeed(runSeed, k)`（纯函数，再跑一次 mulberry32 取 uint32）。**每场独立**，绝不共用同一 seed（否则两个 Boss 的出招序列会相关） |
| **绝不能**用什么 | `BattleState.rngSeed` / `aiRngSeed` —— 一局肉鸽的随机必须走**自己的**流 |

**"自己的随机流"不是洁癖，是结构性保护。** 仓库里已有同源教训：

> `core/types/runtime.ts:78-88`：`aiRngSeed` 与 `rngSeed` 分开之后，
> "玩家侧的黄金基线是否被动过"从"要重新标定才不会错"变成
> **结构上不可能**。

一局肉鸽的洗牌若去消耗 `BattleState.rngSeed`，会**同时改变玩家侧的
所有概率判定**，`tests/golden/replay.test.ts` 会因此变红。

### 7.2 重放

| 层面 | 做法 |
|---|---|
| **一场战斗的重放** | **不变**。`RecordedRun`（`core/run.ts:48-62`）仍是 `{version, seed, ticks, input}`。理由：`RunState` 不进 `BattleState`，对引擎而言每一场依旧只是"combatants + seed + input" |
| **一局肉鸽的重放（新增）** | `{ runFormatVersion, runSeed, playerId, order, choices, battles: RecordedRun[] }`。校验规则照抄 `replayRun`（版本不匹配 → **开发期错误用英文**，i18n 规范 I1 / `run.ts:148-153`） |
| **`REPLAY_FORMAT_VERSION` 要不要 +1** | **看具体工作项**（见下表）。判断依据是 `run.ts:37-45` 的原文："改动引擎的**确定性语义**时必须 +1" |

| 工作项 | 是否改变现有战斗的确定性语义 | 要不要 +1 |
|---|---|---|
| W1 计数器写入 / W2 计数器条件 | ❌ 现有内容不用它 → 结果逐位不变 | 不必 |
| W3 `onInterruptSuccess` 派发 | ❌ 现有内容没有该 hook 的触发器 | 不必 |
| W4 `grantSkill` / W5 `consume` | ❌ 现有内容不用它 | 不必 |
| **W6 `maxHp` 钳制改走结算值** | ⚠️ **理论上会**（钳制口径变了）。今天没有任何内容加 `maxHp` 修正 → 实际应逐位不变 | **必须由黄金测试证明**；若变了 → **+1**，并改 `tests/golden/replay.test.ts:86` 与 `GOLDEN_OUTCOME` |
| W12 `core/run/` | ❌ 不碰引擎 | 不必 |

⚠️ **"一局肉鸽"的边界不在引擎里**：一个 `BattleEngine` 永远是**一场战斗**。
一局肉鸽是 `RunState` + 依次构造的 7 个 `BattleEngine`。这正是为什么
**不需要**把"多场"塞进引擎。

### 7.3 一局肉鸽状态的可哈希保证

`RunState` 必须是 plain object（`core/types/runtime.ts:66-72` 的 C5 同样适用）：

1. 不许 `Map` / `Set` / 类实例（lint C5，`lintRules.test.ts:107-112`）。
2. `unlocked` / `chosen` 用**数组**（保序，便于 diff 与哈希）。
3. `counters` 是 `Record<string, number>`，**键是封闭的 `RunCounter` 联合**。

---

## 8. i18n / 输入 / 触屏的硬约束

### 8.1 i18n

| 事项 | 做法 | 依据 |
|---|---|---|
| 新文案 | 全部进 `src/i18n/locales/zh-CN.ts`；`src/**` 里出现中日韩字符会被 lint 拦下（I1） | `docs/specs/2026-10-09-i18n.md` §7 |
| **新 domain** | 需要 `qiji.*`、`run.*`。i18n 规范 §5 的 domain 白名单**是文档表格、不是机器校验**（全仓 grep 无 domain 校验）→ 加 domain = 改文档 + 加 key | `docs/specs/2026-10-09-i18n.md:170-187` |
| key 命名 | `<domain>.<subject>.<field>`，全小写驼峰：`qiji.jieDeriveStrike.name` | 同上 §5 |
| **内容 key ↔ id 对应** | 现有校验器对 `entity.<camelId>.*` 有 `KEY_ID_MISMATCH`（`content/validate.ts` 的 `toSubject`）。炁机现在是 `GameEntity` 子类，可以并进 `entities` 那条校验路 | `i18n/translator.ts:60-90` |
| 键位提示 | **不进 i18n**（"继续 (Enter)"由渲染层拼；触屏不拼） | AGENTS.md §3b |
| 数字 / 时间 | 走 `Translator` 的 `number` / `percent` / `duration`，不手写 `toFixed` | i18n 规范 §8 |

### 8.2 触屏对等

- 所有"确定 / 继续"都必须有**可点区域**，不能只有 `Enter`。
- 触屏层在**非 `battle` 的一切 phase 都隐藏**：现在传的是
  `isPrepareOpen: () => state.phase === 'prepare'`（`game.ts:316`），
  要改成 `isBattleActive: () => state.phase === 'battle'`，否则新屏上会浮着
  双弧按钮、与卡片重叠（AGENTS.md §3b："触屏时整条技能栏都隐藏"同理）。
- `canvasInput.ts` 的 `phase()` 判断要为新屏加分支，且**顺序即优先级**
  （该文件已写明三条实测踩出来的规则，`canvasInput.ts:83-107`）。

---

## 9. 模块划分与引擎改动

### 9.1 按职责划模块

```text
src/core/run/                     ← 新层：一局肉鸽的纯逻辑（零依赖、Node 可跑）
  types.ts        RunState / RunCounter / 一局肉鸽的记录形状
  shuffle.ts      种子化洗牌（这一层唯一的随机消费者）
  unlock.ts       解锁判定 + 每场战斗后的候选生成（纯函数）
  lifecycle.ts    场次推进 / 胜负 / 通关 / 累计计数器（状态转移）
  record.ts       一局肉鸽的重放记录（序列化 + 校验）
  index.ts        转发

src/core/types/
  qiji.ts         （新）QijiEntity / QijiUnlock / RunCounter

src/core/loadout/                 ← 新：GameEntity → 战斗输入的规范化（W7）
  normalize.ts    GameEntityInstance[] → passiveModifiers / 固有 buff / grantSkill

src/data/
  qiji.ts         炁机内容表（含 category:'generic' 的通用炁机）
  intensity.ts    7 档表：位置 → 数值缩放 + 机制解锁清单（纯数据）
  kit.ts          buildPlayerKit(character, chosen) → BattleKit（纯函数）
  characters.ts   角色定义（形状见 §4.2；内容由用户定）
  units.ts        （改）behaviorsFor(id, tier)

src/app/
  runSession.ts   RunState 的持有者 + 与 BattleLoop 的接线
  flow.ts         （改）Phase 加 3 个值
  battleSetup.ts  （改）从"读 selection"变成"读 runSession 的当前场"
  game.ts / loopWiring.ts / canvasInput.ts （改）phase 分发

src/ui/
  cardSelectLogic.ts       三个选择界面共享的光标/命中区/确定逻辑（纯）
  CharacterSelectScreen.ts
  QijiSelectScreen.ts
  RunOverScreen.ts
  prepareLogic.ts / PrepareScreen.ts  （不动，或按 §3.3 参数化）
```

- **`core/run/` 为什么不放 `data/` 或 `app/`**：它是**逻辑**（洗牌、判定、
  累计），不是内容表；而它**必须能在 Node 里单测**（"行为式解锁"的正确性
  全靠它），`app/` 碰 DOM/Pixi。
- **方向**：`data/qiji.ts` 实现 `core/types/qiji.ts` 声明的
  `QijiEntity` —— 与 `LocaleKey` 的"接口形状由消费者声明，实现方满足它"
  （`core/types/ids.ts:7-13`）是同一条纪律。
- **`core/run/` 满足 `core/` 的全部硬约束**：零依赖 / 无 `Math.random` /
  无 `Date.now` / 无异步 / 无可克隆容器。

### 9.2 引擎改动清单（= §0.3.1 的工作项，按依赖排序）

| 顺序 | 工作项 | 改动文件 | 验收 |
|---|---|---|---|
| 1 | **W1 + W2**：计数器写入 + 计数器条件 | `core/types/{effects,stats}.ts`、`core/expr/deps.ts`、`core/combat/{stats,runAi,hitResolution}.ts` | 单测：某个效果让计数器 +1；`counterAtLeast` 在 `requires` / `when` 里生效；黄金重放不变 |
| 2 | **W3**：派发 `onInterruptSuccess`（带打断者的 skillId） | `core/combat/{triggers,hitResolution}.ts`、`core/events.ts` | 单测：截成功打断 → 触发器收到事件；黄金重放不变 |
| 3 | **W7 + W8**：`EntityKind:'qiji'` + 实体规范化层 | `core/types/{skills,qiji}.ts`、`core/loadout/normalize.ts`、`core/content/validate.ts` | 单测：一个 `QijiEntity` → `passiveModifiers` + 固有 buff |
| 4 | **W4 + W5**：`grantSkill` / `consume` | `core/combat/*` | 单测：授予的技能出现在 `SkillBook.known` |
| 5 | **W6**：`maxHp` 真正影响上限与钳制 | `core/combat/index.ts`、`core/stats/*` | 单测 + **黄金重放必须不变**（否则 `REPLAY_FORMAT_VERSION + 1`） |
| 6 | **W9 / W10 / W11**：删掉 3 个死变体 | `core/types/{behavior,triggers}.ts`、`core/content/validate.ts` | 类型与校验器一致；全仓无引用 |
| 7 | **W12**：`core/run/` | 新目录 | 单测：固定 `runSeed` → 固定顺序；喂终局快照 → counters 与解锁按预期 |

⚠️ **删变体（W9–W11）要单独一步**：它们会让"内容里能写但永远不生效"
变成"写了就编译不过"，这正是仓库要的方向（"死值先删"），但会动
`validate.ts` 的 `behaviorSkillRefs` 与 `SUPPORTED_HOOKS` 的注释。

---

## 10. 落地计划（每阶段可独立验收）

| 阶段 | 交付 | **做完能看到什么** |
|---|---|---|
| **P0** | `core/run/`：`RunState`、洗牌、解锁判定、候选生成 + 单测 | `pnpm run test:run`：同一 `runSeed` → 同一顺序；喂终局快照 → counters 与解锁按预期；`RunState` 能 JSON 往返 |
| **P1** | 引擎能力 **W1+W2+W3**（计数器 + 计数器条件 + hook） | 单测通过；**黄金重放不变**（硬验收） |
| **P2** | `CharacterSelect` 屏 + `RunState` 接进 app + 一场战斗 → 结算 → 回选角色 | 截图：角色卡（未实现的灰掉）、键盘与触屏各选一次、`?runlen=2` 能跑完一圈 |
| **P3** | `QijiSelect` 屏 + 通用炁机兜底 + `buildPlayerKit` 真正影响下一场战斗 | 截图：选完炁机后下一场战斗玩家的 maxHp / 属性确实变了 |
| **P4** | 强度曲线**数值档**（`intensity.ts` + `behaviorsFor(id, tier)`） | 单测：同一 Boss 在位置 1 与位置 7 的 `gapMs` / HP 不同；**默认档 = T4 = 今天的值** → `tests/golden/replay.test.ts` 不变红 |
| **P5** | 强度曲线**机制解锁**（M1/M2/M3/M5，位置门） | 单测：位置 < 4 的 `Behavior[]` 里没有二阶段那一项 |
| **P6** | 实体化 **W7+W8+W4+W5**（炁机走 `GameEntity`，能给技能、能用次数） | 单测：一个"给新技能的炁机"让下一场战斗的技能栏多一格 |
| **P7** | 一局肉鸽的**中途存档**（§12 #10）+ 曲线回归测试 | 刷新页面能续上一局肉鸽 |
| **P8** | 剩余 5 个 Boss 依次补上（各自 boss spec） | `BOSS_POOL` 从 2 逐步到 7 |

**P4 有一条硬验收**：`behaviorsFor(id)` **不传 tier** 时必须与今天逐字相同
（`BOSS_BEHAVIORS.get(id) ?? PRIDE_BEHAVIORS`，`units.ts:103-105`），
否则黄金基线会变。

---

## 11. 风险（在"兜底变多 / 可选全激活"之后重新评估）

| # | 风险 | 为什么危险 | 缓解 |
|---|---|---|---|
| **1** | **双曲线失控**（Boss 每场战斗更难 vs 玩家每场战斗更强） | 两条曲线互相追赶，很容易变成"前 3 场碾压、第 6 场必死"或反过来。**这是本设计最可能翻车的地方** | 定"目标形状"（第 k 场战斗用时/剩余血量大致持平）+ 固定 `runSeed` + 固定策略的曲线回归测试 |
| **2** | **通用炁机 vs 机制炁机的收益差**（模式 A） | 通用项（血量/回复/护甲/暴击）永远可选、收益稳定、不依赖操作。若机制炁机的收益不明显，玩家会一直点通用 → 炁机系统的"强化方向"失去意义 | ① 通用项加 **`maxStacks` 上限** → 选满一维被迫看向机制项；② 机制项要**改变玩法**（派生、追击、资源循环）而不是加数字 |
| **2′** | （模式 B 下替换为）**build 多样性消失 + 数值爆炸** | "解锁即全部激活"没有决策 → 一局肉鸽没有 build；7 场 × 每场多个炁机同时生效，数值需要重新标定 | 若选 B，必须先把"每场战斗后解锁的量"控制住（例如每场只解锁 1 个） |
| **3** | **7 个 Boss 的机制通道不齐** | "按位置解锁二阶段/霸体/控制"要求 7 个 Boss **都能提供**这些通道。否则第 5 个位置遇到一个没有二阶段的 Boss，体感比第 3 个位置还简单 —— **曲线在玩家体感上是反的** | §6.3 的"每个 Boss 最小机制集"写进各自的 boss spec 当验收项 |
| **4** | **一局肉鸽的长度与失败惩罚** | 7 场 × ~95s ≈ **11 分钟纯战斗** + 8 个界面；失败全丢 | 要么缩短单场战斗（改 `BOSS_HP_DISPLAY`，已有实测流程），要么做中途存档（§12 #10） |
| **5** | **引擎改动的面积（W1–W12）** | 会动 `core/`；其中 **W6（`maxHp` 钳制）真的可能改变现有战斗的确定性语义** | 每项都以"黄金重放不变"为硬验收；W6 若变 → `REPLAY_FORMAT_VERSION + 1` 并重标定 `GOLDEN_OUTCOME` |
| **6** | **新屏数量（3 个）** | 每个都要 canvas + 键鼠/触屏对等 + i18n + 命中区 | 抽 `cardSelectLogic` 共用（§3.3） |
| **7** | **`Phase` 改动的面** | `phase` 被 5 处 switch，漏一处就"两个界面同时可见"（仓库踩过） | P2 就把 5 处一起改，验收里加"逐屏截图" |
| **8** | **洗牌扰动黄金基线** | 若图省事用 `BattleState.rngSeed` 或 `Math.random`，黄金测试会红或静默改变 | §7.1 写死"一局肉鸽自己的随机流"；`core/` 的 `Math.random` 被 lint 拦（C2） |
| **9** | **中途存档是未验证输入** | 与键位表同理：可能被手改/被旧版本写过/写一半 | 照抄 `parseBindings` 的"逐项校验 + 坏数据整条丢弃 + 回落默认"（`settingsStore.ts:28-44,97-132`） |

---

## 12. 决议（肉鸽惯例 + 为什么）

> 用户原话："**你问的这些问题，肉鸽游戏都有答案**。"
> 所以下面每条都按**这类游戏的标准做法**给答案，而不是留给用户拍板。
> 只有 §12.2 那几条是真正只有用户能定的（口味/数值）。

### 12.1 结构与流程

| # | 问题 | **决议** | 为什么（惯例） |
|---|---|---|---|
| 1 | 一局肉鸽中途失败：全丢 / 带进度重来？ | **全丢**，回"选角色"重开一局 | 肉鸽的标准就是"死亡即结束本次 run"（Rogue / 以撒 / Slay the Spire）。Hades 那种"回大厅"保留的是**跨局元进度**，本设计没有那套系统。带进度重来属于 roguelite 的软保底，会削弱随机顺序的紧张感 |
| 2 | "每场战斗后选 1 个" vs "解锁即全部激活" | **默认 A（选 1 个）**；**B 作为可选开关** | "每场战斗后 3 选 1"是这类游戏的核心节拍（StS 选卡 / Hades 选祝福 / 吸血鬼幸存者选升级）。用户原始需求第 8 条也是"选择 1 个生效"。B 保留为开关（跳过 `QijiSelect`、把已解锁的全部写进 `chosen`） |
| 3 | 兜底 +30 血能重复选吗？ | **兜底 = 一组 `unlock:'always'` 的通用炁机**，各自有 `maxStacks` 上限（生命 3 / 炁回复 2 / 护甲 2 / 暴击 2） | 用户在两条路里给的第一条就是"多加几个兜底"。做成"通用炁机"之后：① 不需要"没有任何解锁"的特判；② 候选项永远 ≥ 3，不会出现假选择屏；③ `maxStacks` 上限让玩家选满一维后**被迫看向机制炁机** |
| 4 | 解锁计数：一局肉鸽累计还是单场内？ | **一局肉鸽累计** | 成就/解锁按 run 计是标准做法；更实际的原因是单场可能凑不满（傲慢实际只有 3 个可打断读条） |
| 5 | 备战界面的位置？ | **开发/测试入口**（`?mode=dev` / `?prepare=skip`）；正式流程走 `CharacterSelect` | 备战的核心能力是"玩家挑 Boss"，与"顺序随机"语义冲突。见 §3.4 |
| 6 | 3 个角色各是什么、初始技能套是什么？ | **不在本文范围**（用户已有想法）。本文只给流程与 `CharacterDef` 的形状（§4.2） | 用户原话："角色和初始技能我也有想法了，这跟肉鸽流程没关系吧" |
| 7 | 一局肉鸽几场？ | **固定 7 场**（7 个位置 / 7 档） | 固定长度的 run 是标准做法；剩余 5 个 Boss 依次补上，曲线表不变（§2.3） |
| 8 | 通关之后做什么？ | **回"选角色"开新的一局肉鸽** | run 结束回主界面。可选的后续（不属本设计）：通关后解锁更高难度（ascension）再来 |
| 9 | 开局展示本局随机顺序吗？ | **只显示"下一场"**（第 k/7 场是谁）+ 总局数；**不显示全局顺序** | 这类游戏显示的是**下一步**（StS 的地图节点、Hades 的下一个房间），不是全局剧本。全显示 → 随机性没有意义；全盲 → 无法为后面的 Boss 规划 build |
| 10 | 做中途存档吗？ | **做**（P7）。`localStorage` + 版本后缀 + 逐项校验 | StS / Hades 都能中途退出继续；手机切后台被回收是常态，不做会掉用户。解析照抄 `parseBindings` 的模式 |
| 11 | 允许改 `core/`（引擎）吗？ | **允许**，按 §0.3.1 / §9.2 的清单改 | 用户："这是我的思路，我要往这个方向做，**当然要改引擎**"。唯一不变的是 §7 的确定性硬约束 |
| 12 | 已解锁炁机只有 1 个时跳过选择屏吗？ | **不会发生**：通用炁机恒在池里，候选永远 ≥ 3 | 这是把兜底做成"通用炁机"的直接收益（原 Q12 消失） |

### 12.2 真正需要用户拍板的（都是口味 / 数值，不是架构）

| # | 问题 | 说明 |
|---|---|---|
| U1 | **通用炁机的具体数值** | +30 最大生命 / 炁回复 +X / 护甲 +X / 暴击 +X% —— 给的是结构，数值要试 |
| U2 | **一局肉鸽的目标时长** | 现在 7 场 × ~95s ≈ 11 分钟纯战斗。要更短就得动单场战斗的血量 / 时长（有实测流程：`data/entities/bossHp.ts`） |
| U3 | **炁机的图标与美术取向** | 现在只有单色方块占位（`BuffDef.color` 是玩家看到的东西，`core/types/buffs.ts:76-82`） |
| U4 | **A / B 模式**（选 1 个 vs 全激活）**要不要做成玩家可见的选项**，还是固定一个 | 默认 A；B 作为开关存在 |

---

## 13. 我没做的事（明确说明）

- **没写任何功能代码**：`src/` 一行未改；本文档是唯一改动。
- **没 commit、没 push**（用户明确要求；AGENTS.md §3c 禁止自行 push）。
- **没跑 typecheck / eslint / test / build**：没有代码改动，跑了也不能证明
  设计对；文档本身不在 lint 范围。
- **没设计 3 个角色的内容与初始技能套**（用户已有想法），
  **没设计 5 个未实现 Boss 的机制**（各自需要 boss spec）。
- **没做数值平衡**（§6.2 的档位系数、§5.4 的通用炁机数值都是建议值），
  **没画 UI 线框图 / 没出截图**。
- **没验证**"每个 Boss 都能提供 M1/M2/M3 三条通道"—— 那是 P5/P8 的内容工作。

---

## 14. 修订记录

| 日期 | 改动 | 方向 |
|---|---|---|
| 2026-10-12 | 初稿 | 把"引擎里现在没有的机制"当成**约束**；"一局" = 一场战斗；曲线按"现在只有 2 个能打"设计；炁机不继承 `GameEntity`；12 条开放问题留给用户 |
| 2026-10-12 | **第一次修订** | ① 术语拆成"**一局肉鸽**"与"**一场战斗**"；② 曲线/流程**按 7 个 Boss 展开**，未实现的"慢慢加"，开发期只用调试参数跑短局；③ 引擎缺口表（§0.3.1）从"约束"改成**工作清单**，并给出"删 / 实现"的逐项判定 + 依赖排序（§9.2）；④ 炁机改为 **`QijiEntity extends GameEntity`**（并列出让那条路"做活"的 W7/W8）；⑤ 角色内容移出范围，只留流程与数据形状；⑥ 兜底改成**一组 `unlock:'always'` 的通用炁机**（不再单押 +30 血），并把"全激活"写成可选模式 B；⑦ 12 条开放问题改成**决议**（肉鸽惯例 + 为什么），只留 4 条口味/数值项 |
