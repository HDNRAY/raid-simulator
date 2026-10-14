# 肉鸽（roguelike）机制设计 —— 7 场战斗 / 随机 Boss 顺序 / **机制曲线** / 「炁机」

> 日期：2026-10-12（第一次修订）
> 状态：**待评审**。本文只是设计，**不含实现代码**（`src/` 一行未改，未 commit、未 push）。
>
> ⚠️ **2026-10-14 修订：强度曲线只保留机制那半** —— 位置系数表（原 §6.2）
> **不做了**，位置 → 档**只决定"解锁哪些机制"**。动因、连带后果与新的
> 验收方式见 **§6.1b**；落地阶段表（§10）里 **P4 / P5 合成一条**。
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
| **C** | 难度**只靠机制**（例：第 4 位起才开二阶段），**数值一律不缩放** | §6.1b（动因）+ §6.3（每条指到引擎的确切落点） |
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

> ⚠️ **表里的 `文件:行号` 是初稿那天的快照**，之后代码一直在动（`main.ts`
> 拆成 `src/app/*`、`core/types.ts` 拆成目录……）。**当行号对不上时以文件为准**
> —— 每条都给了文件名，行号只用来少翻几屏。

| 事实 | 值 / 结论 | 证据 |
|---|---|---|
| Boss 名单 | **7 个**：`meiichiro`(傲慢) / `lust`(色欲) / `envy` / `gluttony` / `wrath` / `sloth` / `greed` | `src/data/roster.ts:60-69` |
| 已实现玩法的 Boss | 2 个（傲慢、色欲）；其余 5 个在 `DEVELOPING` 里、备战界面灰掉 | `src/data/roster.ts:87-95` |
| 未实现 Boss 的行为表 | **借用于「傲慢」的轮转**（占位，防"从存档/调试路径进来崩掉"） | `src/data/units.ts` 的 `behaviorsFor`（2026-10-14 起：有自己定义的 Boss 走 `bossDefOf`，其余回落傲慢） |
| 角色名单 | 3 个：`player`(林晚风) / `kaili` / `daixuan` | `src/data/roster.ts:48-52` |
| 已实现玩法的角色 | 1 个（林晚风）；`kaili` / `daixuan` 在 `DEVELOPING` 里 | `src/data/roster.ts:87-95` |
| 3 个角色机制上完全相同 | `makePlayer(id)` **只用 id 取显示名**；属性/上限/技能全是全局常量 | `src/data/units.ts:62-79`、`35-52` |
| 玩家技能全集 | 9 个：`attack` / `blast` / `focus` / `break` / `dodge` / `guard` / `flash` / `jie` / `strike`(派生) | `src/data/content.ts:545-557`。⚠️ **2026-10-12 第二次重标定后**：「破」移出玩家技能全集、进 `PENDING_SKILLS`（无人带、不可绑），全集变成 **8 个**；判据见 `2026-10-12-player-kits.md` §6 |
| "哪些技能是玩家的" | 全局唯一真相 `PLAYER_SKILL_IDS`，**没有 per-character 概念** | `src/data/content.ts:585-587` |
| **引擎的边界 = 一场战斗** | `BattleEngine` 是一个 encounter 的状态机；当前"重开"是**重建一个 `BattleLoop`**，不是引擎里的第二场 | `src/core/combat/battleState.ts:74-83`、`src/app/battleSetup.ts:59-117` |
| 种子从哪来（现状） | **一局**：app 层 `Date.now() >>> 0`（`core/` 禁 `Date.now`）。**一场战斗**：从 run seed 派生 —— `battleSeed(runSeed, position)`，落点 `src/app/battleSetup.ts` 的 `battleSeedOf`（自由模式 / 直接单场没有那一局，仍取时钟） | `src/app/phaseFlow.ts:451-473`、`src/app/battleSetup.ts` 的 `battleSeedOf` |
| 两条随机流 | `BattleState.rngSeed`（玩家侧）+ `BattleState.aiRngSeed`（AI 选招），**刻意分开** | `src/core/types/runtime.ts:73-88`、`src/core/ai/index.ts:57-63` |
| 随机数工具 | `core/rng.ts` 的 mulberry32（`nextRandom` / `randomInt` / `rollChance`），状态手动穿线、纯函数 | `src/core/rng.ts` |
| 重放格式 | `REPLAY_FORMAT_VERSION = 2`；`RecordedRun = {version, seed, ticks, input}`，**一场战斗一份**；测试断言它就是 2 | `src/core/run.ts:44-62`、`tests/golden/replay.test.ts:81-88` |
| 界面阶段 | `Phase = 'home' \| 'characterSelect' \| 'prepare' \| 'battle'`（初稿写作时是 `'prepare' \| 'battle'`；P2 加了前两个） | `src/app/phaseLogic.ts`（`flow.ts` 只转发） |
| 结算 | 结算面板画在 `BattleScene` 里（`renderResultPanel`）；结束后 **Enter / 触屏点屏 → `backFromBattle()`**（按模式分流：肉鸽 → 选角色；自由 → 自由模式界面） | `src/render/resultPanel.ts:32-76`、`src/app/loopWiring.ts`、`src/app/canvasInput.ts`、`src/app/game.ts` |
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
| **W1** | `Combatant.counters` 没有写入者；`Expr {e:'counter'}` 读取恒 0（战斗路径的 `getCounter` 是 `() => 0`） | 死的 | ① 新增一个**写计数器**的能力/效果（`delta` + 池子 + 具名计数器）；② `core/combat/stats.ts` 的 `getCounter` 真正读 `combatant.counters`（`ResourcePoolRef` 的 `combatant` / `entity` / `encounter` 三种） | `core/types` + `core/combat` | **没有已知消费者**（见下：暴怒改用 buff） | **暂不做**（要做须先有一个非它不可的机制） |
| ~~**W2**~~ | ~~`Condition` 没有"计数器比较"~~ | — | **不需要了** → **删** | — | — | **删**（随 W1 一起；见下） |
| ~~**W3**~~ | ~~`Hook:'onInterruptSuccess'` 不派发~~ | — | **不需要了** → **删**。真正缺的只有"事件里没有打断者的招式"这一件小事：给 `interruptSuccess` 加一个**可选** `sourceSkillId`（2 处 emit + 1 个字段） | `core/events.ts` + `core/combat/hitResolution.ts` | "成功使用 N 次**截**"这类条件 | ✅ **已做**（**③**；不改确定性语义，版本号不动） |
| **W4** | `Ability:'grantSkill'` 无执行点 | 死的 | 实现：把技能加入施法者的已知技能（`SkillBook.known` / 技能栏） | `core/combat` + `core/types/loadout.ts` | 炁机给**新技能**（肉鸽的核心之一） | **实现** |
| **W5** | `Ability:'consume'` 无执行点 | 死的 | 实现：从内容实例的资源池扣（`ResourcePoolRef`） | 同上 | 奇物类炁机（使用次数 / 充能） | **实现**（做活装备路时） |
| **W6** | `maxHp` 修正**不生效** —— 生命钳制走 `combatant.caps`，而 `caps` 是构造时写死的 | 半死 | 把 `caps.hp` 变成 `maxHp` 的**基底**，并让钳制走"结算出的 maxHp" | `core/combat` + `core/stats` | 通用炁机「+30 最大生命」 | **实现** |
| **W7** | `GameEntity` / `Loadout` → 战斗输入**没有规范化层** | 缺 | 新增规范化：`GameEntityInstance[]` → `passiveModifiers` + 固有 buff + `grantSkill` | `core/loadout`（新） | **炁机继承 `GameEntity` 的落地路** | **实现** |
| **W8** | `EntityKind` 没有 `'qiji'` | 缺 | 加值 + 校验器 + 注册表 | `core/types/skills.ts` + `core/content` | 炁机 | **实现** |
| **W9** | `Behavior:'interruptible'` 无消费者 | 死的 | 本设计不需要 → **删** | `core/types/behavior.ts` + `core/content/validate.ts` | — | **删** |
| **W10** | `Behavior:'timeLimit'` 无消费者（时限其实来自 `CreateBattleOptions.timeLimitMs`） | 半死 | 二选一：把时限收进行为数组（更内聚）或删掉这个变体保留 options | `core/ai` + `core/types/behavior.ts` | — | **删**（现状 options 已在工作，改动收益低） |
| **W11** | `Hook:'onPhaseChange'` 不派发 | 死的 | 二阶段用 `onHpBelow` + phase buff **已经够**；不引入"阶段"这个一等概念 → **删** | `core/types/triggers.ts` | — | **删** |
| **W12** | 一局肉鸽的状态 / 流程**不存在** | 缺 | 新增 `src/core/run/`：洗牌、**事件流 → 统计**、解锁判定、跨场累计、生命周期 | `core/run`（新） | 全部 | ✅ **已做（P0）** |

**⚠️ 三条"我们**不**采用**的做法"（写下来是为了记录取舍 —— 其中第 1 条
**原本是本文的首选方案，后来被用户否掉**，理由值得留着）：**

| 被否掉的做法 | 为什么不 |
|---|---|
| **在 `BattleState` 里加计数器字段**（= W1 服务于解锁） | ✅ 这**曾经是本文的首选**，现在是结论的反面：它与事件流是**并行的第二份真相**（两处会漂，漂了以后"截数了几次"有两个答案），而且是唯一可能改动确定性语义的改动。用户原话："如果直接从 log 判断，而不是又加一层记录呢"。改用 `core/run/stats.ts` 从 `EventDef[]` 归约 |
| 用**事件回调**（`onEvents` + 逐事件累加）算 | 也不需要：那要求引擎往外推一个回调、并让"统计"变成有状态的东西。直接拿 `EventDef[]` 做**纯函数归约**更简单，而且能在 Node 里单测（不起引擎） |
| 把**一局肉鸽**塞进 `BattleState` | `BattleState` 是**一场战斗**、且被黄金重放逐位钉死。跨场数据放进去会让"第 3 场战斗的重放"依赖前两场的输入（见 §2.1） |

**⚠️ W1 / W2 现在的状态（这一条容易再被带偏，写清楚）：**

- **W1 保留，但它已经不服务于解锁了** ✗（那是初稿的错）。它现在**只剩**
  "战斗内机制要不要按次数/次数型事实做判定"这一个可能的价值。
- ⚠️ **目前没有任何已知消费者** —— 而且**曾经举的那个例子也没了**：
  本文初稿写的是"暴怒：按受伤次数减 CD"。**用户已明确暴怒改用 buff 实现**：

  > 暴怒的那个技能 以后靠 buff 实现

  也就是说"按受伤次数减 CD / 增伤"**不打算靠引擎内计数器**，
  而是做成一个 **buff**（具体形态等做暴怒时再定）。所以 W1 的理由更弱了。
- **定性：没有已知消费者。** 要做它，必须**先有一个真实的、非它不可的机制**
  —— 而不是"将来可能会用到"。（仓库纪律："死值先删"；而 W1 甚至还不是
  死值，它连**设计稿**都没有消费者。）
- ⚠️ **代价（想让以后的人先掂量一下）**：W1 要往 `BattleState` 加一个
  **随战斗推进的字段** —— 它是**唯一可能动确定性语义**的地方
  （§7.2 那张表里唯一标 ⚠️ 的就是这一类）。加了它就必须给
  `REPLAY_FORMAT_VERSION` 的账（若确实改变了结果 → +1，并重标定
  黄金基线 `GOLDEN_OUTCOME`）。**为一个"可能用到"的能力动黄金基线不划算。**
- **W2 随 W1 一起删**：它存在的唯一理由是"给 W1 的计数器写条件"，
  而"解锁条件"已经改走 §5.2 的统计查询。**没有 W1 就没有 W2 的消费者。**

---

## 1. 设计目标：一局肉鸽里玩家应该面对什么

一句话：**带着一个角色和一个不断变强的配置，穿过一条由 7 个随机顺序的
Boss 组成、越往后越窄的走廊。**

三个张力，按重要性排序：

| # | 张力 | 靠什么产生 |
|---|---|---|
| 1 | **未知**：下一场是谁、更难在哪 | 7 个 Boss 的顺序随机（§2）+ 位置**机制**曲线（§6） |
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
| **位置** | 本局肉鸽内这一场战斗是第几场（1..7） | 决定强度档（§6）—— **只决定解锁哪些机制**，不缩放数值（§6.1b） |
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
startRun(runSeed, playerId, order)
   → order = Boss 的随机排列（由 runSeed 决定，§7）
   → position = 1，battleStats = 空统计，unlocked = []，chosen = []

每一场战斗结束（**喂这一场的 EventDef[] + 胜负**）：
   → battleStats = mergeBattleStats(battleStats, reduceBattleStats(events))   // §5.2.2
   → 用 battleStats 重算 unlocked（§5.2）——**先累加、后判定**
   胜 → position += 1
        → position > order.length：status = 'victory'（通关）
        → 否则：结算 → 选 1 个炁机生效 → 开下一场战斗
   负 → status = 'defeat'（一局肉鸽结束）
```

⚠️ 两处**改过一次**，别照着旧稿改回去：

1. **通关判据是 `order.length`，不是 7**（§2.3 与 §12 决议 #7 的矛盾，
   以"7 是终点、`len` 是现实"为准）。
2. **没有 `counters`**：统计是从**事件流**归约出来的（§5.2.2），
   所以这一场的输入是 `EventDef[]`，不是"读终局快照里的计数"。

### 2.3 局长 = **固定 7 场**

设计按 **7 个位置、7 档强度、7 个 Boss 的随机排列**展开。
剩下 5 个 Boss "慢慢加" —— 它们补上之后，这一局肉鸽的形状**不变**
（只是每个位置有更多可能的面孔）。

| 阶段 | 7 个 Boss 里有几个能打 | 一局肉鸽怎么跑 |
|---|---|---|
| 现在（2026-10-14） | **4**（傲慢 / 色欲 / 嫉妒 / 贪婪） | **设计不变**：仍然是 7 个位置、7 档。开发期用调试参数跑短局（见下），**这不是设计形态** |
| 逐个补 | 5 → 6（剩暴食 / 暴怒 / 懒惰） | 同上，每个位置的可选面孔变多 |
| 全部 | 7 | 需求原样 |

⚠️ **档位今天只决定"解锁哪些机制"**（2026-10-14 修订）：不长数值、不缩放
`gapMs` / HP —— 见 §6.1b。所以"越后越难"在**开发期短局**里**不再自动成立**：
2 个 Boss 时档是 `T4 T7`，但两个 Boss 的数值都是它们各自声明的那些，
第 2 场并不因为档高就更硬，只因为**机制开得更全**。满编（7 个 Boss）时
这条曲线才真正完整。

**开发期怎么跑（调试入口，不改设计）：**

```
?runlen=2        只打 2 场战斗（第一个位置用最软档，最后一个位置用最硬档）
?runlen=7        满编形态（7 个 Boss 都做完之后）
?runseed=123     指定这一局的种子（⚠️ 决定 Boss 顺序；不传 = 现取 Date.now() >>> 0）
?order=k1,k2,... 指定顺序（复现某个具体局面 / 截图）
?tier=4          强制某一档（调曲线用）
```

⚠️ **今天真正实现的只有 `?runlen=` 与 `?runseed=`**（解析在
`src/app/urlParams.ts`，落点在 `src/app/phaseFlow.ts`）；`?order=` /
`?tier=` 是**设计稿**，还没接线。另外 `?runlen=` **不传时是"池子多长
打几场"、不是 7** —— 7 是满编终点，拿它当缺省会让"今天只有 2 个 Boss"
的一局永远通不了关（见 `src/app/urlParams.ts` 的 `runLength`）。

⚠️ ⭐ `?runseed=` **钉住整个一局**（B，2026-10-13）：一场战斗的种子从
run seed 派生（`battleSeed(runSeed, position)`，落点 `battleSetup.ts` 的
`battleSeedOf`），所以同一个 `?runseed=` 跑两次 —— **Boss 顺序 + 每场战斗
内部的随机（出招 / 概率判定）全部相同**，这就是"完整复现一局"。

⚠️ **沿革（为什么这条注释改过）**：上一版这里写的是"战斗种子另取时钟
（`Date.now() >>> 0`），与 run seed 没有派生关系"。那是当时的**事实**，
而 `core/run/types.ts` 的 `RunBattleRecord.seed` 与 §7.1 下表早就写着
"由 `battleSeed` 派生" —— **约定在、线上没接**。两边对不上的后果是 P7
（中途存档 + 重放）复现不出"同一局"，且爆出来的位置离原因很远。
现在线上按约定派生，文档 / 测试 / 线上三者一致。

这些走**玩家同一条代码路径**（与现有 `?prepare=skip` / `?boss=` 的思路一致），
不做旁路。

⚠️ **为什么不"用占位轮转假装 7 个都能打"**：5 个未实现 Boss 现在共用
傲慢的行为表（`data/units.ts:88-105`），对玩家来说"第 4 场是嫉妒"和
"换了个名字的傲慢"没有区别 —— 那会让"随机顺序"看起来像 bug。
所以开发期的 `BOSS_POOL` = 已实现的 Boss，一局肉鸽的场数等于
`BOSS_POOL.length`，**但档位是按 7 档表取子集**（第 k 个位置取第
`ceil(k * 7 / len)` 档），这样"最后一个位置**最难**"永远成立，
而且补完 Boss 之后**只是 `len` 从 2 变成 7，档表一个字都不用改**。

⚠️ **"最难"的准确含义（2026-10-14 修订）**：位置最靠后 ⇒ **档最高** ⇒
**解锁的机制最多**。数值**不参与**这件事（§6.1b）—— 所以"最难"指的是
"这一场可能出现的机制最多"，不是"这一场的 Boss 血更厚 / 出手更快"。

### 2.4 失败代价：**一局肉鸽结束，全丢**

- 失败 → 回"选角色"，重开一局肉鸽（`status='defeat'`）。
- **不做**"跨局永久成长"（那是 roguelite 的元进度，用户没要；
  它会让"一局肉鸽内的解锁"与"跨局解锁"两套状态打架）。
- 理由与取舍见 §12 决议 #1。

---

## 3. 新的交互流程

> ⚠️ **本节同时写着"当前"与"目标"两件事**（2026-10-12 第三次修订），别混起来读：
>
> - **当前（P2 已落地）**：`首页 → 选角色 → 一局肉鸽`；自由模式是**开发/测试入口**。
>   P2 的"只跑一场"是**临时桩**（本节末尾）。
> - **目标（P3 起）**：一局肉鸽 = 7 场 + 每场之后的炁机选择（§2、§5）。

### 3.1 状态机（逐屏）

```text
首页（默认入口）
  ├─ 「肉鸽模式」 → 选角色屏 → 一局肉鸽
  └─ 「自由模式」 → 备战界面（标题「自由模式」）
                    以后 + 炁机选择 / Boss 难度
```

两条路都从首页出发，**首页是唯一的正门**。

**⚠️ 为什么"首页"能当默认入口，而"选角色"不能**（这是判断，不是细节）：

- **首页只是路由**：它不通向半成品 —— 一个按钮去"还不完整但能用"的肉鸽，
  另一个去"完全能用"的自由模式。
- **"选角色"当正门不安全**：它背后那条路**还不完整**（炁机选择是 P3、
  强度曲线是 P4/P5、7 个 Boss 只有 2 个能打）。把玩家直接丢进半成品的
  入口，等于把"还没做完"呈现成"这就是成品"。
- ⚠️ 因此初稿那张"Boot 之后按 `mode` 二选一、默认 `characterSelect`"的图
  **作废**：模式的选择权交给**玩家**（首页那两个按钮），而不是启动参数。
  `?prepare=skip` 仍然保留 —— 它是**开发参数**（直接进战斗、跳过首页），
  不是玩家路径。

**⚠️ "自由模式"是给"任意测试任意节点场景"用的**（用户原话）：

- 它就是原来的备战界面（选人物 + 选 Boss + 开始），语义一字未改 ——
  **玩家直接挑对手**正是它存在的理由，也是它**不能**混进肉鸽那条路的原因
  （肉鸽第一条规则就是"不许挑 Boss"，见 §3.4）。
- 以后给它加的那两个选择器（**炁机选择** / **Boss 难度**）就是为它加的：
  开发时要能"指定任意 Boss + 任意角色 + 任意炁机 + `?noai=1`"，
  才能把某个机制单独摆出来看。

**⚠️ P2 的"只跑一场"是临时桩**：选完角色只打**一场**，结算完回选角色屏。
P3 才把它接成 **N 场 + 每场之间的炁机选择**。桩的落点在
`src/app/runSession.ts` 与 `ui/CharacterSelectScreen.ts` 的文件头，两处都标了。
**不要**为了"看起来完整"而在选角色屏后面假装有炁机选择。

**当前实现的相位**（唯一真相 `src/app/phaseLogic.ts`，只有四个值）：

```ts
export type Phase = 'home' | 'characterSelect' | 'prepare' | 'battle';
```

**后续阶段再加的值**（见 §3.2）：`qijiSelect`、`runOver`。

**这一轮（P2 收尾）新增/改动的两条交互**：

| 交互 | 键 | 触屏 | 落点 |
|---|---|---|---|
| **返回首页** | `Esc` | **左上角的返回箭头**（可见、可点） | `phaseLogic.phaseFromEscape` + `ui/ScreenControls.ts` |
| **打开设置** | **`F1`**（原先 `Esc` / `,`） | 点右上角的齿轮 | `app/settingsKeys.ts` |

- ⚠️ **战斗中 `Esc` 什么都不做**（判断）：传统上战斗里的 `Esc` 是
  "暂停 / 菜单"，而本作**没有菜单**；没有确认的"中途弃局"比"没反应"更坏。
- ⚠️ **键位提示不进 i18n**（AGENTS.md §3b）：返回箭头的 `Esc`、齿轮的 `F1`
  都由渲染层拼；触屏不拼（`IconButton.setShowShortcut`）。
- ⚠️ **触屏与键盘功能必须对等**（§3.5）：返回**不是**"只有键盘能用"的东西。

### 3.2 阶段枚举的改动

现在是四个值（`src/app/phaseLogic.ts`）：

```ts
export type Phase = 'home' | 'characterSelect' | 'prepare' | 'battle';
```

（初稿这里是 `'prepare' | 'battle'`；P2 加了 `'home'` 与 `'characterSelect'`。）

**P3 起再加**：

```ts
  | 'qijiSelect'     // 每场战斗后选 1 个炁机
  | 'runOver'        // 一局肉鸽结束（通关 / 失败）
```

**刻意不新增 `'result'`**：结算面板本来就画在 `BattleScene` 里
（`render/BattleScene.ts` 的 `renderResultPanel`）。把它提升成独立 phase 会让
"战斗场景的显隐"多一个状态，而"两个界面同时可见"是仓库踩过的坑。
**结算 = `battle` phase 内的一个子状态**，由 `snapshot.status !== 'running'`
表达（现有做法）。

⚠️ 加 phase 必须同时改这几处（现在都读 `phase`）：

| 位置 | 现在读什么 | 加新屏时要做什么 |
|---|---|---|
| `src/app/game.ts` 的 `applyPhase` | **显隐的唯一写入点**：三屏 + 返回箭头 + 战斗场景 | **先改这里**（加一行），别的路径都不用动 |
| `src/app/loopWiring.ts` 主循环 | `phase !== 'battle'` → 分发给三屏各自 `frame()` | 加一屏的分支（漏了的表现是"那一屏停住不动"） |
| `src/app/loopWiring.ts` 键盘 | 每屏一段 switch（Enter 在每屏语义不同） | 新屏一段；`Esc`（返回）已经在**最前面**统一判 |
| `src/app/canvasInput.ts` | 齿轮 → 返回箭头 → 当前那一屏（"顺序即优先级"） | 新屏的命中分支插在返回箭头之后 |
| `src/app/game.ts` 的 `isBattleActive` | 触屏按钮层**在非 `battle` 的一切 phase 都隐藏** | 什么都不用做（判据是"在战斗中"，新屏默认就隐藏） |
| `src/app/phaseLogic.ts` | `Phase` 联合 + `backVisibleIn` / `phaseFromEscape` | 加值 + 决定新屏能不能返回 |

⚠️ **`backVisibleIn` 与 `phaseFromEscape` 必须同源**：前者是"返回箭头在不在"，
后者是"`Esc` 去哪"。两处各写一遍判据，漂移的样子就是"箭头看得见、按 `Esc`
却没反应"。它们已经在 `phaseLogic.ts` 里绑在一起，并有单测钉住
（`tests/unit/phaseLogic.test.ts`）。

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

**决议：`Prepare` = 「自由模式」，开发/测试入口，不是正式流程的"选角色"页。**

它在首页上是**和「肉鸽模式」并列的一个按钮**（不是 `?mode=dev` 那种隐藏入口）——
玩家点了"自由模式"就进这一屏，标题也是「自由模式」。

理由：

1. **语义冲突**。备战界面的核心能力是"**玩家直接挑 Boss**"
   （`prepareLogic.ts:275-295`）。而肉鸽模式的第一条规则就是
   "**不许挑 Boss**"。同一界面同时承担两种语义，只能靠"肉鸽模式下把
   Boss 行灰掉"实现 —— 那是把备战的主要功能在正式流程里废掉还留着 UI。
2. **测试需要完整能力**。开发时要能"指定任意 Boss + 任意角色 + `?noai=1`
   静止场景截图"（`data/units.ts` 的 `noAi` 就是为这个存在）。这个能力
   不该塞进正式流程 —— **"任意测试任意节点场景"正是这一屏存在的目的**
   （用户原话），以后加的炁机选择 / Boss 难度也是为它加的。
3. **两条入口可以共存**：正式流程走 `CharacterSelect`，开发走「自由模式」
   与 `?prepare=skip`，互不影响。

**放弃了什么**：备战界面在肉鸽那条路里看不到（它只属于「自由模式」）；
玩家要"挑对手打一场"得走自由模式，而不是肉鸽。

⚠️ **返回**：自由模式与选角色屏都**能回首页**（`Esc` / 左上角箭头）。
这一屏不再是"死胡同"——原先只能一路往前（开战 → 结算 → 回来）。

### 3.5 输入：键盘与触屏**必须对等**（AGENTS.md §3b）

| 屏幕 | 键盘 | 触屏 | 对等性怎么保证 |
|---|---|---|---|
| `Home` | ↑↓ 移光标；Enter 进入 | **点按钮 = 进入**（一步到位） | 键盘能到的两个状态，触屏都能一步到达 |
| `CharacterSelect` | ←→ 移光标；Enter 确定 | **点卡片 = 移光标 + 确定** | 复用 `prepareLogic.pickOption`（它的注释明确说"点击必须一步确定"） |
| `CharacterSelect` / `Prepare` | **`Esc` = 返回首页** | **点左上角的返回箭头** | `ui/ScreenControls.ts`（两个屏共用一份实现；`Esc` 只有键盘按得出，所以箭头是**必需的**） |
| `RunIntro`（P3） | Enter = 开始 | **点"开始"按钮** | 不能只让 Enter 能开始（仓库踩过：改键只有 Enter 一条路，触屏进不去） |
| `Result` | Enter = 继续 | 点屏任意处 = 继续（现有路径） | 已有 |
| `QijiSelect`（P3） | ←→ 移光标；Enter 确定 | 点卡片 = 确定 | 可选加数字键 `1..9` 直达（**加速器**，不是唯一路径） |
| `RunOver`（P3） | Enter = 回选角色 | 点屏任意处 | 同上 |

**打开设置**：键盘 `F1`；触屏点右上角的齿轮（`SettingsButton`，一直可点）。
两者作用相同 —— `F1` 不是"只有键盘能用"的另一套东西。

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
  // ⚠️ 这里**曾经**有一个 `maxStacks?: number`（"一局内最多叠几层"）——
  // 已整条删除（2026-10-13：一局只能选一次、不叠加）。理由见 §5.3 的作废段。
}
```

**继承带来什么（这是选它的理由）：**

| `GameEntity` 已有的 | 炁机直接得到 |
|---|---|
| `id` / `nameKey` / `descKey` / `icon` / `rarity` | 展示信息，零额外字段 |
| `abilities: readonly Ability[]` | **"解锁后生效什么"**（与既有能力系统同一套） |
| `requires?: readonly Condition[]` | 战斗内条件（将来 W2 若做，能写计数器条件；**解锁不走它**——见 §5.2） |
| `pool?: ResourcePool` | 奇物类炁机的使用次数 / 充能（靠 W5 落地） |
| 内容校验器 / 注册表 | 加进 `ContentBundle` 即可被校验 |

**还差的那一步是 W7（规范化层）**：`GameEntityInstance[]` → 战斗输入
（`passiveModifiers` + 固有 buff + `grantSkill`）。现在注册表能收 `entities`
（`registry.ts:16-70`），但**没有任何东西把它变成战斗输入**
（`deps.ts:49` 传的是 `entities: []`）。做活它就是"炁机继承 GameEntity"
的落地路。

### 5.2 解锁条件

#### 5.2.1 数据形状

**⚠️ 这一节改过一次。** 初稿是一个**封闭的 5 元素计数器联合**，用户否掉了
它，原话是嫌它**只能数技能使用次数**。具体三个"做不出来"：

1. **分不出是哪个技能**：「截」打断 3 次与「破」打断 3 次在旧形状里是
   **同一个数**（`interrupts`）。而「截拳道」/「招架反击流」要的正是区分。
2. **没有伤害维度**：闭集里根本没有 `damage`，所以"某个技能造成伤害数"
   （用户点名的第一条）**无法表达** —— 想加一条炁机就得回去改 `core/` 的类型表。
3. **作用域没有位置放**：`'battle' | 'run'` 只写在文档里。

现在的形状是**对统计的一次查询 + 组合子**：

```ts
// core/types/qiji.ts
export type QijiUnlock =
  | { readonly kind: 'always'; readonly of: readonly QijiUnlock[] }
  | { readonly kind: 'statAtLeast'; readonly stat: RunStatQuery; readonly value: number }
  | { readonly kind: 'all'; readonly of: readonly QijiUnlock[] }
  | { readonly kind: 'any'; readonly of: readonly QijiUnlock[] }
  | { readonly kind: 'not'; readonly of: QijiUnlock };

// core/run/stats.ts —— 查询本身（**开放**：加维度不动 QijiUnlock）
export type BattleStatQuery =
  | { readonly s: 'skillUses';       readonly skillId: SkillId; readonly scope: StatScope }
  | { readonly s: 'skillDamage';     readonly skillId: SkillId; readonly scope: StatScope }
  | { readonly s: 'skillHits';       readonly skillId: SkillId; readonly scope: StatScope }
  | { readonly s: 'skillInterrupts'; readonly skillId: SkillId; readonly scope: StatScope }
  | { readonly s: 'dodges';                                    readonly scope: StatScope }
  | { readonly s: 'battlesWon';                                readonly scope: StatScope }
  | { readonly s: 'flawlessBattles';                           readonly scope: StatScope };

export type StatScope = 'battle' | 'run';
```

**关键差别：条件写在内容数据里**（`data/qiji.ts` 的每一条 `QijiUnlock`），
而不是写死在 `core/types/` 的常量表里。加一个维度 = 在 `BattleStats`
加一张表 + 在 `BattleStatQuery` 加一个成员，**`QijiUnlock` 一个字都不用动**。

**用户点名的两个例子现在都能直接写出来：**

```ts
// 例 1「某个技能造成伤害数」→ 求和（不是计数）
{ kind: 'statAtLeast', stat: { s: 'skillDamage', skillId: 'jie', scope: 'battle' }, value: 300 }

// 例 2「一场战斗同时用了 n 次 a 和 m 次 b」→ all + 两条 skillUses
{ kind: 'all', of: [
  { kind: 'statAtLeast', stat: { s: 'skillUses', skillId: 'jie',   scope: 'battle' }, value: 3 },
  { kind: 'statAtLeast', stat: { s: 'skillUses', skillId: 'break', scope: 'battle' }, value: 2 },
]}
```

**"成功使用 3 次截"的完整链路（⚠️ 已**不再**需要 W1/W2，也不需要写计数器）：**

| 步 | 做什么 | 需要什么 |
|---|---|---|
| 1 | 引擎结算时 emit `interruptSuccess`，**带上打断者用的招式**（`sourceSkillId`） | **③**（已做：`events.ts` 加可选字段 + `hitResolution.ts` 两处 emit） |
| 2 | 一场战斗打完，`reduceBattleStats(events, { actorId })` 按 `sourceSkillId` 计数 | `core/run/stats.ts`（纯函数） |
| 3 | `advanceRun` 把它 `mergeBattleStats` 进 `RunState.battleStats` | `core/run/lifecycle.ts` |
| 4 | 用 `RunState.battleStats` 求值 `unlock`，刷新"已解锁"集合 | `core/run/unlock.ts` |
| 5 | `QijiSelect` 列出已解锁的炁机（顺带用它算"截 2/3"的进度） | UI（P3） |

**⚠️ 为什么"用截打断"原本表达不出来（③ 的全部意义）**：
`interruptSuccess.skillId` 是**被打断的那个读条**（Boss 的招），
`sourceId` 只是"谁打断的"。所以"用截打断"与"用破打断"在这个事件里
**长得完全一样** —— 归约器无法区分。加一个可选的 `sourceSkillId`
（2 处 emit + 1 个字段）就解决了，而它**不参与任何判定**，
所以**确定性语义不变、`REPLAY_FORMAT_VERSION` 不用 +1**（依据见 §7.2）。

```ts
export const QIJI_JIE_DERIVE_STRIKE: QijiEntity = {
  id: 'jieDeriveStrike',
  kind: 'qiji',
  nameKey: 'qiji.jieDeriveStrike.name',
  descKey: 'qiji.jieDeriveStrike.desc',
  icon: 'char_break',
  category: 'offense',
  unlock: {
    kind: 'statAtLeast',
    stat: { s: 'skillInterrupts', skillId: 'jie', scope: 'run' },
    value: 3,
  },
  abilities: [ /* 例如：把「截」成功后的派生窗口拉长 / 让派生窗口可叠两层 */ ],
};
```

#### 5.2.2 计数从哪来：**从事件流归约**（⚠️ 不是"引擎内计数器"）

**⚠️ 这一节改过一次，改动的理由比结论更重要。**

初稿写的是"在引擎里加计数器（W1/W2/W3），一局肉鸽去读快照里的计数"。
用户否掉了它，原话是：

> 如果**直接从 log 判断** 而不是又加一层记录呢

那个否定是对的，而且**在这个仓库里格外成立**：

| 做法 | 问题 |
|---|---|
| **在 `BattleState` 里加计数器字段** | ① 它是**与事件流并行的第二份真相** —— 两处会漂，而漂了以后"截到底数了几次"有两个不同的答案。② 它是**唯一可能改动确定性语义**的改动（多一个随战斗推进的字段），而 `BattleState` 被黄金重放逐位钉死 |
| **从事件流归约**（现在） | 事件流本来就是**输出**、本来就带 `sourceId` / `skillId` / `amount` / `reason`。统计只是"读一遍输出、做加法" —— 纯函数、零状态、可在 Node 单测 |

**"第二份真相"是这个仓库一路在清的那个病**（见 `AGENTS.md` §2 的
"删 / 留 判据"）。所以现在的形状是：

```ts
// src/core/run/stats.ts —— 纯函数，无副作用
export function reduceBattleStats(
  events: readonly EventDef[],
  scope: { actorId: CombatantId; flawless?: boolean },
): BattleStats;
```

三个必须写清的细节：

1. **读 `EventDef[]`，不是 `LogEntry[]`。** 用户说"从 log 判断"，
   但真正的源头是 `EventDef[]`：`app/logFormat.ts` 是它的**显示层**，
   它会**丢噪声**（若干 kind 不产生日志行）并且有 `limit`（**截断**）。
   拿 `LogEntry[]` 统计会静默少算。而且 `app/` 碰 DOM，不能单测。

2. **作用域必须显式：`scope: 'battle' | 'run'`。** 同一句话在两种作用域下
   是两个答案，而它们是**两套累加**（不是同一个数的两种读法）：

   ```ts
   // 数值是不同的，两者都必须能问
   statProgress({ s:'skillUses', skillId:'jie', scope:'battle' }, battleStats, runStats)  // 这一场
   statProgress({ s:'skillUses', skillId:'jie', scope:'run'    }, battleStats, runStats)  // 整局
   ```

   `scope` **没有默认值** —— 有默认值就意味着"有人会忘记写，然后拿到
   另一个作用域的数"，而那个数看起来完全正常（只是偏小）。

   **⚠️ 但在"每场战斗结束、判定解锁"那一刻，两个作用域读到的是同一个值。**
   这不是 bug，是一个**有意的、但会让人困惑**的设计，所以写清原因与分叉点：

   - **为什么相同**：那一刻这一场的统计**已经被 `mergeBattleStats` 并进
     整局了**（`core/run/lifecycle.ts` 的 `unlockStatsOf` 两份传的是同一个
     `state.battleStats`）。而 §5.2 的语义本来就是"这一场**结束后**用累计值
     判定"。所以"本场用截打断了 ≥1 次"与"本局用截打断了 ≥1 次"在结算时
     必然同真同假。
   - **分叉点在哪（`scope` 不是装饰，这两处它是真的）**：
     1. **P3 的 `QijiSelect` 卡片文案**：显示"本场 2/3"还是"本局 2/3"
        取决于 `scope` —— 那时调用方会显式传**两份不同的**统计
        （`battleStats` = 刚打完的那一场，`runStats` = 整局累计），
        两个数就分开了。
     2. **将来的战斗内判定**（`requires` / `when` 用统计）：
        "这一场已经用截打断过"用 `scope: 'battle'`，
        "这一局累计"用 `scope: 'run'` —— 那时两者真的不同。
   - ⚠️ **在那两处到来之前**：不要因为"看不出差别"就把 `scope` 删掉，
     也不要反过来以为它现在就该有差别。这个事实有一条断言钉着
     （`tests/unit/run/query.test.ts` 的"两份传同一个值时 battle / run
     读到相同的数"）—— 那条断言失败意味着**语义变了**，
     该改的是 `unlockStatsOf` 与本文，不是断言。

3. **一局肉鸽的累计 = `mergeBattleStats` 逐字段相加。** 累加器就是整局
   统计，**不需要在 `RunState` 里再存一份"计数"**（那就是第二份真相）。
   `RunState.battleStats` 的类型与单场统计**是同一个**
   （`(BattleStats, BattleStats) => BattleStats`）。

**"赢了几场"也不是计数器**：它是 `BattleStats.battles`
（**逐场结果数组**）的过滤结果（`battles.filter(b => b.won).length`）。
存"逐场事实"而不是"结论"的收益：它是**日志**（可审计）、
长度 = 场数（**可校验** —— `record.ts` 会拿它与 `RunRecord.battles`
做长度 / 次序 / 胜负 / 满血的**对账**，不一致整条丢弃），
而且没有两条独立累加路径可以漂。

**闪避的两种 `reason`（`dodged` / `immune`）**：`{ s: 'dodges' }`
**只数 `dodged`** —— "成功闪避"指的是真的闪开，而 `immune` 是机制免疫
（不用玩家做任何事），数进去会让"闪避流"的进度在挨某些机制时白涨。
⚠️ `BattleStats.dodges['immune']` **归约照收，但没有查询能拿到它**
（符合"死值先删"）。**将来要数免疫时，那是第一个要改的地方**：
加一个 `{ s: 'immunes' }` 查询即可，**不要**改 `dodges` 的语义
（那会让已经写好的"闪避流"炁机的数字突然变大）。

**时间窗**：**一局肉鸽累计**（不是单场内）—— 这正是 `scope: 'run'` 的用处。
理由不变：单场可能凑不满（傲慢实际只有轻蔑/呵斥/回补 3 个可打断读条，
碾压起手带霸体 `bossPride.ts:249-304`；截 CD 10s、一场战斗 ~95s）。
单场作用域留给"这一场就够狠"的炁机（例如"这一场用截打断过"）。

#### 5.2.3 统计放在哪（回答关键约束）

| 候选 | 判断 |
|---|---|
| 引擎里的计数器字段 | ❌ **已否决**：与事件流并行的第二份真相，且动确定性语义 |
| **`src/core/run/stats.ts`（新）** | ✅ **归约**放这里：纯函数、零依赖、Node 可跑、满足 C1/C2/C4/C5 |
| **`RunState.battleStats`** | ✅ **整局累计**放这里（`mergeBattleStats` 的产物）。它是 plain object，可 JSON 往返、可哈希 |
| app 层 | ❌ 不能写单测（要 DOM），而"行为式解锁"必须有单测 |

**唯一写入路径**：`RunState.battleStats` 只由 `advanceRun` 写
（它内部调 `battleStatsFor` + `mergeBattleStats`）。
这与 `input/touchLayout.ts` 的"`TouchLayout` 只有一个写入路径 `set()`"
是同一条设计纪律（AGENTS.md §3b）。

**⚠️ 顺带删掉的东西**：初稿的 `RunCounter` 封闭联合
（`jieInterrupts | interrupts | dodges | battlesWon | flawlessBattles`）
以及 `RunState.counters` **已整个删除**。原因见 §5.2.1：
它**只能数技能使用次数**，而用户要的是"某个技能造成伤害数"——那是**求和**。

### 5.3 「每场战斗后选 1 个生效」的语义

| 问题 | 决议 | 理由 |
|---|---|---|
| **能叠吗** | 不同炁机共存；同一个 `QijiEntity` 默认 `maxStacks = 1`（通用炁机可以 >1） | 保留"每次做一个**新**决定"的节拍 |
| ⚠️ **能叠吗（2026-10-13 改）** | **不能**。一局里**每条炁机只能选一次**，而且**选了不能取消**；选过的那条**不再出现在候选里**。`maxStacks` 字段**已整条删除** | 用户原话（两条，一起定死了肉鸽的语义）："**肉鸽也改成一局只能选一次（不叠加）**"、"**而且肉鸽里是不能把已经激活的再取消的**" |
| **选了能换吗** | **不能换**（永久生效） | 加"换"要一整个装卸界面，收益低（§12 决议 #2） |
| **同一场战斗里叠加顺序有影响吗** | **没有** —— 前提是**禁止 `op:'setOverride'`** | `core/types/stats.ts:48-54` 的 6 种 op 里，`add`/`addPercent`/`mult`/`max`/`perStackAdd` 全部**交换**，只有 `setOverride` 不交换。禁掉它，顺序就永远无关 |
| **永久累积还是每场战斗临时** | **永久累积**（一局肉鸽内） | §12 决议 #2 |

**禁止 `setOverride` 的落地方式**：在内容校验器里加一条断言（炁机的
`abilities` 里出现 `setOverride` → 内容校验失败），并配一条单测。

#### ⚠️【作废 · 2026-10-13】"每场战斗后可以再选同一条、累积到 `maxStacks`"

**作废的是上面那行"能叠吗（初版）"，以及它派生出来的全部说法。**

用户 2026-10-13 的两条原话（一起定死了肉鸽的语义）：

> **肉鸽也改成一局只能选一次（不叠加）**
> **而且肉鸽里是不能把已经激活的再取消的**

**当时为什么那么想**：初版的节拍是"每场战斗做一个**新**决定"。为了让
"通用炁机"（+30 血 / +炁回复）不至于在第一场就被选完（那样后面几场的
选择屏会变成"没有一维可加"），给它们标了 `maxStacks`（生命 3 / 炁回复 2），
于是**同一个通用炁机可以在不同场次被反复选中**，每次都算"又一个新决定"。

**为什么错**：那条节拍把"选择"与"同一个东西再买一次"混成了一件事。
`maxStacks` 换来的"每场都有东西可加"并不是**决策**（同一个 +30 血点三次
不是三个决定），而它却给整条线带来了真实成本：

- **一个字段 + 一族读者**：`maxStacksOf` / `stacksOf` / `Candidate.remainingStacks` /
  卡片右下角的 `0/3` / `RunChoice.stacks` / `buildPlayerKit` 的按层展开
  —— 全部只服务"同一件事的第二份表达"
- **一个误导的操作**：既然"再选一次 = 叠一层"，玩家很自然会把**再选一次
  当成取消/减去一层**（备战屏当年正是这么长出了"卡片劈成左右半边"）

**现在的规则**（这一版是活的）：

| 问题 | 决议 |
|---|---|
| 能叠吗 | **不能**。`RunState.chosen` 是一局内**每个 id 至多一条**的集合 |
| 选过的还出现吗 | **不出现**（`nextCandidates` 按 `chosen` 过滤，不是"叠满才消失"） |
| 选了能取消吗 | **不能**（`chosen` 只有一处写入、且只**追加**；没有反选 / 清空 / 减层的路） |

**"兜底够不够"这条担心的答案**仍旧是用户当年给的那条（见 §5.4）：
**多加几条兜底**（多条 `unlock: always` 的通用炁机），
而不是"同一条叠 N 层"。

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

| id | 效果 | 落点 | 需要的能力 |
|---|---|---|---|
| `vitality` | +30 最大生命 | `maxHp` 修正 | **W6**（`maxHp` 修正要真正生效）；未实现前走"构造时改 `caps`"的过渡 |
| `breath` | +炁回复速度 | `energyRegen` 修正 | 现有（`passiveModifiers` 已在读） |
| `resolve` | +护甲（减伤） | `armor` / `damageReduce` | 现有 |
| `insight` | +暴击率 | `critChance` 修正 | 现有 |

⚠️ **这一版删掉了 `maxStacks` 那一列，以及它派生的那条设计推理**（2026-10-13）：

原文（**保留，用来记住当时为什么那么想**）：

> `maxStacks` 上限的作用：**选满一个维度之后被迫看向机制炁机**
> （见 §11 风险 #2）。

**当时为什么那么想**：如果一条 +30 血能无限选，玩家会一直点它 ——
"选满一维就没得选了"看起来是一个**逼玩家看机制炁机**的机制。

**为什么错**：那条推理的**前提被用户推翻了** —— 一局里每条炁机
只能选一次（"肉鸽也改成一局只能选一次（不叠加）"），所以
"选满一维"这件事**不存在**：点过一次之后它就从候选里消失了，
不存在"继续点它"这条路。于是这条推理的结论（"被迫看向机制炁机"）
**不需要 `maxStacks` 也会成立**，而且成立得更干净：一局 7 场、
通用炁机只有几条 —— 选完就没了，剩下的候选**必然**是解锁出来的机制炁机。

**兜底够不够**仍然按用户当年那句"**多加几个兜底**"来办：
多加几条 `unlock: always` 的通用炁机（内容数据，零结构改动），
而不是"同一条叠 3 层"。

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

### 6.1b ⚠️ 位置系数表**作废** —— 位置只决定"解锁哪些机制"（2026-10-14）

**用户原话**：

> 我觉得 甚至可以不要数值曲线，只要机制曲线

**当时的方案**（= 下面 §6.2 那张表，**保留原文**）：位置 → 档 → 一组
**数值缩放系数**（`gapMs ×0.80~1.25` / `HP ×0.85~1.18` /
`enrage.atMs ×0.85~1.15` / 二阶段门槛 `0.40~0.45`），乘在**每个 Boss 自己
声明的基准值**上。基础值是逐 Boss 的、系数是全局的，两半相乘。

**为什么不要它**：

1. **同一条设计里有两条相反的结论**。§6.2 自己写着"同一缩放系数不能想当然
   套到两个 Boss 上"（傲慢是 `weightedRotation`，色欲是 `rotation`，两者对
   `gapMs` 的语义要求**相反**）—— 也就是说那条全局系数**每个 Boss 都得
   单独复核一遍**，等于"全局旋钮"这个好处大半是假的。
2. **它对"这个 Boss 的节奏为什么是这样"是否定的**。傲慢 `gapMs = 4000`
   是实测出来的（改大到 8000+ 会让纯进攻翻盘，注释里记着那次诊断），
   色欲要求 `gapMs` **短于**各自冷却 —— 把这两个数各乘一个系数，
   等于把那些结论按位置重新掷一次 🎲。
3. **数值轴与机制轴叠在同一个位置号上，谁在起作用分不清**。第 5 场更难
   是因为 Boss 血更厚，还是因为多了霸体 + 控制？两条一起动，调平衡时
   无法归因（§6.4 那条"双曲线"的担忧从这个角度反而更强）。
4. **它从来没接线，而且黄金基线看不见它**（见下面「连带后果」）。
   一份没有实现、又很难验证的缩放表，价值是负的（AGENTS.md §2 的
   "未实现 → 保留 + 标注"是给**能力**留的，不是给一条**数值方案**留的）。

**新的设计**：

| 项 | 之前 | 现在 |
|---|---|---|
| 位置 → 档（`tierForPosition`） | 算数值缩放系数 | **不变**，但用途改成"算**解锁门槛**" |
| `gapMs` / HP / `enrage.atMs` / 二阶段门槛 | 乘档位系数 | **各 Boss 自己声明多少就是多少**，逐位置完全相同 |
| 难度怎么变 | 数值 + 机制 | **只有机制**（§6.3 那张表变成**唯一**的曲线） |
| `src/data/intensity.ts` | 新文件：7 档 × 4 个系数 | **不建这个文件**。档 → 机制集的映射是**纯数据**，放哪见 §6.3 |

⚠️ **"档"这个抽象保留**：`tierForPosition(k, len)` 是纯函数、有单测、
公式（`ceil(k * 7 / len)`）保证"第一个位置最软、最后一个最硬"，这些
**一条都不用改**。变的只是**消费者**：以前它喂"乘系数"，现在它喂
"查机制清单"。

#### 6.1b-1 ⚠️ 连带后果（三条，都是这次修订才出现的）

| # | 后果 | 处理 |
|---|---|---|
| **1** | **黄金基线必须显式选档** —— 今天 `tests/golden/fixtures.ts` 的 `makeBoss()` **直接写死** `PRIDE_BEHAVIORS`，**绕过了** `behaviorsFor(id)`。也就是说黄金测试现在跑的**不是**任何一局里会出现的配置。机制曲线一上来，黄金必须显式写"跑的是哪一档" | 改成 `behaviorsFor('meiichiro', <档>)`。⚠️ 这是**改既有测试**（动的是"测试跑什么"，不是"期望值是什么"）—— 期望值（`GOLDEN_OUTCOME`）应当**逐位不变**，因为现在是全机制齐的那一档 |
| **2** | **"默认档 = T4 = 今天的值"这条 P4 硬验收没有了** | 它是为系数表设的（T4 = ×1.0 的恒等档）。没有系数就没有"恒等档" —— 黄金改取**最高档**（机制全开，代表满编时的终局那一场），T4 不再是特殊值 |
| **3** | ⚠️ **这条曲线对现有 Boss 是"往下剥"，不是"往上加"** | 傲慢的二阶段（回补）**今天就在它的基础表里**。按位置解锁机制 ⇒ 位置 1~3 打傲慢时**没有二阶段**，而不是位置 4+ 才有。所以每个 Boss 的行为表要能**按档过滤**；这正是 §6.3"每个 Boss 都要能提供 M1+M2+M3"那条验收的现实含义 |

⚠️ **顺带一条已有的错，这次一起记账**：§6.2 说 T1/T2/T3"二阶段门槛 = 关"、
T4+ 是 0.45/0.42/0.40 —— 但"0.40 **就是**今天傲慢的值"（`bossPride.ts` 的
`hpBelow ratio: 0.4`）。那张表把**基准档 T4 写成 0.45**、把 T7 写成 0.40，
与它自己"T4 = 今天的值 ×1.0"的规矩**互相矛盾**。系数方案作废之后这条
矛盾随之消失，但**记在这里**：下次给位置写"今天的值"时，先回去读内容。


### 6.2 ⚠️【作废 · 2026-10-14】数值变化表（原文保留）

> ⚠️ **本节整节作废** —— 位置系数表**不做了**（动因见 §6.1b）。
> **原文完整保留**，理由：① 里面那几条"约束"是**踩过的坑**（`gapMs` 对
> 不同轮转类型语义相反 / `gapMs` 有下界 / HP 与"整场一次的回补"联动 /
> `timeLimit` 不参与缩放），**今天仍然成立**，做机制曲线时照样要守；
> ② "玩家侧不做缩放"这条**升级成整份文档的规则**（见本节末尾）。
> ⚠️ 读的时候：**任何"乘系数"的说法都不要再实现**，凡是"约束"都要照守。

基准 = **各 Boss 自己声明的值**（不是全局常量），乘上档位系数。
今天的基准（傲慢，已核实的真实值）：

| 旋钮 | 今天的值 | 证据 |
|---|---|---|
| `weightedRotation.gapMs` | `4000` | `data/bossPride.ts:486` |
| `enrage.atMs` / `dmgMult` | `120_000` / `2` | `data/bossPride.ts:413` |
| Boss HP 上限 | `420`（**傲慢**的值） | `data/prideBoss.ts`（2026-10-14 起每个 Boss 一份定义，见 `data/bossDefs.ts`） |
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

⚠️ **这条现在是整节里唯一还生效的"缩放"类结论，而且升级成了全文规则**
（2026-10-14）：**Boss 侧也不做缩放了** —— 所以"两条曲线互相掩盖"这件事
从根上没了。剩下的那条曲线是**机制曲线**（§6.3），玩家侧的成长仍然只有
炁机（§5）。

### 6.3 机制变化表（"**哪一条现有机制在第几位解锁**"）

⚠️ **这张表现在是唯一的位置曲线**（2026-10-14，§6.1b）。三条落地规则：

1. **门槛写在内容里，不写在代码里**：Boss 的每条 `Behavior` /
   `RotationStep` 带一个**可选** `minTier`，构造战斗时按档过滤掉不够格的。
   加一条"位置 ≥ 6 才开"的机制 = 在内容表里加一个字段 —— 而不是在
   `core/ai` 里写 `if (tier >= 6)`。
2. `behaviorsFor(id, tier)` 是**唯一的装配点**（`src/data/units.ts`）。
   ⚠️ 现在它的签名是 `behaviorsFor(id: string)` —— 加档是这次改动的入口。
3. ⚠️ **档 → 机制集**的映射（M1 位置 ≥ 4 / M2 ≥ 4 / M3 ≥ 5 / M4 ≥ 5 /
   M5 ≥ 6 / M6 = 7）是**纯数据**，`src/data/intensity.ts` 这个名字留给它
   （**不再是"7 档 × 4 个系数"**）。放 `data/` 而不是 `core/`：
   它是内容侧的编排，不是引擎机制。

每条都标了它落在引擎的哪一层。

| # | 机制 | 解锁于 | 落在哪 | 内容上缺什么 |
|---|---|---|---|---|
| M0 | `opener` + 主轮转（Boss 的招牌机制） | 位置 1+（始终） | `opener` / `rotation` / `weightedRotation`（`core/ai/index.ts:138-152,176-195`） | ✅ 两个已实现的 Boss 都有 |
| **M1** | **二阶段** | **位置 ≥ 4**（"后 4 个"，对上用户说的"后 3、4 个出场"） | ① `weightedRotation` 的一步带 `when: hpBelow` + 长 CD —— **傲慢用的就是这条**（`bossPride.ts:438-449`）<br>② 或 `Behavior: onHpBelow` + `then: [grant(phase2 buff)]`（`core/ai/index.ts:154-162` + `runAi.ts:111-125`，`grant` 真的被执行） | ⚠️ **色欲没有二阶段**（`lustBoss.ts:324-360` 只有 opener + rotation）。⚠️ 傲慢**有**，但要给它一条"位置 < 4 时把它剥掉"的路（§6.1b 后果 3） |
| **M2** | **霸体**（`interruptImmune`） | 位置 ≥ 4 | `BuffDef.flags.interruptImmune`（`core/types/buffs.ts:34`）被 `hitResolution` 读取；挂在招式的 `castStart`（`bossPride.ts:263` 的 `BOSS_HEAVY_ARMOR`） | ⚠️ **色欲没有霸体技** |
| **M3** | **控制**（倒地 / 眩晕） | 位置 ≥ 5 | `KNOCKDOWN`（`restrictToTags:['dodge']`，`bossShared.ts:89-103`）或 `EffectKind:'stun'`（`core/types/effects.ts:51-65`，`lustBoss.ts:281` 在用） | ⚠️ 傲慢只有倒地、色欲只有眩晕 |
| **M4** | **狂暴提前 + 更狠** | 位置 ≥ 5 | `Behavior: enrage` 的 `atMs` / `dmgMult`（`core/ai/index.ts:164-171`）→ `applyEnrage` 挂 `boss-enrage`（`bossShared.ts:58-68`） | ✅ 现有。⚠️ **"更狠"不再是"乘系数"**（§6.1b）：要么位置 5+ 才**挂** `enrage`，要么 Boss 自己声明两套值 —— 具体取哪种由各自 boss spec 定 |
| **M5** | **二阶段换招表**（进二阶段后轮转多出/少掉某些招） | 位置 ≥ 6 | `RotationStep.when` / `WeightedRotationStep.when` 支持 `hasBuff`（`core/types/behavior.ts:12-37` + `core/ai/index.ts:359-369`）→ 写 `when: hasBuff 'phase2'` 即可，**零新机制** | 需要"phase2 buff"（M1 的产出） |
| **M6** | **终局**：以上全部（机制最全） | 位置 7 | 数据组合 | ⚠️ ~~`gapMs` 最短 + 数值最高~~ **删掉**（数值不缩放，§6.1b） |

**要新造的东西（明确标出）：**

| 新东西 | 加在哪 | 是不是新机制 |
|---|---|---|
| **洗牌 + 档位映射 + 解锁判定 + 一局肉鸽生命周期** | `src/core/run/`（**新层**，不碰 `core/combat/`） | ❌ 不是引擎机制，是**元层逻辑** |
| **事件流 → 统计的归约**（`stats.ts`）与**对统计的查询**（`query.ts`） | `src/core/run/{stats,query,outcome}.ts`（**纯函数**，读 `EventDef[]`） | ❌ 不是引擎机制：它是**输出的只读派生**。⚠️ **不需要** W1/W2/W3。拆成三个文件是"一个文件一句话"那条判据的直接产物（`stats` 造数 / `query` 读数 / `outcome` 叶子） |
| **档位 → `Behavior[]` 的装配**（**只有机制，没有数值**） | `src/data/intensity.ts`（档 → 机制集，纯数据）+ `units.ts` 的 `behaviorsFor(id, tier)` | ❌ 不是新机制：`Behavior[]` 本来就是构造战斗时的输入。⚠️ **不缩放任何数值**（§6.1b） |
| **炁机的数据模型与规范化** | `core/types/qiji.ts` + `core/loadout/`（**W7 / W8**） | ⚠️ 新增（但继承 `GameEntity`，不是另起一套） |
| **`interruptSuccess.sourceSkillId`**（打断者用的招式） | `core/events.ts` + `core/combat/hitResolution.ts` | ❌ 不是新机制：**已有事件的观测字段**，不参与判定 |
| **`damage.viaBuffId`**（`>N` 的平减是谁磨的） | `core/events.ts` + `core/combat/avoidedSource.ts`（`absorbedByOf` / `withAbsorbedByBuffId`）+ `hitResolution.ts` 两处 emit | ❌ 不是新机制：与上一条同一个形状（**观测字段**）。⚠️ 它服务的判据放宽（「卸」吸收 > 0 也算）写在 §7.2 的表里 |
| ~~计数器 + 计数器条件~~ | ~~`core/combat`（W1 / W2）~~ | ❌ **不需要**（解锁改走事件流归约；W1 等战斗内机制的真实消费者） |
| ~~`onInterruptSuccess` 派发~~ | ~~`core/combat/triggers.ts`~~ | ❌ **不需要**（归约读已有事件即可，见 §5.2） |
| **`grantSkill` / `maxHp` / `consume` 真正生效** | `core/combat`（**W4 / W5 / W6**） | ⚠️ 新增（补活已有声明） |
| **色欲的二阶段 / 霸体 / 控制；5 个未实现 Boss** | `src/data/*.ts` | ❌ 内容工作 |

**每个 Boss 的"最小机制集"（给未来的 boss spec 当验收项）**：
为了让"按位置解锁机制"成立，**7 个 Boss 每个都要能提供
M1（二阶段）+ M2（霸体）+ M3（控制）三条通道**；至少一条是它自己的
招牌。否则第 5 个位置遇到一个没有二阶段的 Boss，体感会比第 3 个位置还简单。

⚠️ **这次修订让这条更要紧了，而且它多了一层**（2026-10-14）：由于数值
不再缩放，**位置之间的难度差 100% 由这条通道是否齐备决定**。所以每个 Boss
的 spec 除了"要有这三条通道"，还要写清**每条通道的 `minTier`**（哪一档
起开）—— 否则"档更高"就只是个数，玩家感觉不到。

### 6.4 双曲线（Boss 越难 vs 玩家越强）

一局肉鸽里**两条曲线同时在动**：Boss 每场战斗更难（§6.3 的**机制**曲线；
⚠️ 数值**不**参与，§6.1b），玩家每场战斗多一个炁机（§5）。设计上能做的：

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
| 从哪来 | **app 层**用 `Date.now() >>> 0`（一局的种子）。**一场战斗**的种子从它派生：`battleSeed(runSeed, position)`，落点 `app/battleSetup.ts` 的 `battleSeedOf`。**`core/` 里不许有 `Date.now`**（lint C2，`tests/unit/lintRules.test.ts:85-91`） |
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
| **一局肉鸽的记录（P0 已实现）** | `RunRecord = { runFormatVersion, state: RunState, battles: RunBattleRecord[] }`（`core/run/record.ts`），**当前 `RUN_FORMAT_VERSION = 3`**（1 → 2 是 `RunBattleRecord` 加了必填的 `flawless`；2 → 3 是 `RunChoice` 删掉 `stacks`；见下面的「两个版本号」）。⚠️ **不内嵌**引擎的 `RecordedRun`：那会让一局肉鸽的记录在战斗重放格式变更时被迫一起变。**校验规则与 `replayRun` 刻意不同**：`replayRun` 的入参是开发者给的重放文件（版本不匹配 → **英文抛错**），而这里的入参是**用户的存档**（版本旧了是常态 → **整条丢弃**返回 `undefined`）。同一件事的正确反应天生不同，所以刻意不一致 |
| **`REPLAY_FORMAT_VERSION` 要不要 +1** | **看具体工作项**（见下表）。判断依据是 `run.ts:37-45` 的原文："改动引擎的**确定性语义**时必须 +1" |

#### ⚠️ 两个版本号，**判据不同，不要互相套用**

仓库里有两个"格式版本号"，它们长得像、后果完全不同：

```text
REPLAY_FORMAT_VERSION   引擎的**确定性语义**（动了要重标定黄金基线）
RUN_FORMAT_VERSION      我们**自己的记录格式**（加了字段就该 +1）
```

| | `REPLAY_FORMAT_VERSION`（`src/core/run.ts`） | `RUN_FORMAT_VERSION`（`src/core/run/record.ts`） |
|---|---|---|
| 管什么 | **一场战斗**的重放：`{version, seed, ticks, input}` | **一局肉鸽**的记录：`{runFormatVersion, state, battles}` |
| 判据 | "有没有动**引擎的确定性语义**"（`run.ts:37-45` 原文） | "**记录的形状 / 字段含义**有没有变"（与引擎无关） |
| 改它的后果 | 旧重放在同一份 `(seed + 输入)` 下得到**不同结果** | 旧记录**读不回来**（本层是**整条丢弃**） |
| +1 时必须做什么 | **重标定** `tests/golden/replay.test.ts` 的 `GOLDEN_OUTCOME` | 什么都不用重标定（没有基线可标） |
| 版本不匹配时 | **英文抛错**（开发者错误） | **返回 `undefined`**（用户存档，整条丢弃） |
| 当前值 | **2** | **3**（1 → 2：`flawless` 收成必填；2 → 3：`RunChoice` 删掉 `stacks`） |

⚠️ **最容易套错的一步**：给一局肉鸽的记录**加一个字段**时，**不要**去论证
"它不参与判定所以不用 +1" ✗ —— 那句话是 `REPLAY_FORMAT_VERSION` 的判据。
**记录格式加字段就该 +1。**

**本仓库刚发生过一次，可以当例子**：`RunBattleRecord` 加了 `flawless`
（为了让 `Q-e` 的"满血对账"成立）——

- `RUN_FORMAT_VERSION` **1 → 2** ✅（记录形状变了）
- `REPLAY_FORMAT_VERSION` **不动，仍是 2** ✅（引擎一个字没动，黄金重放 18/18 逐位不变）
- 而**同一轮**给 `interruptSuccess` 加 `sourceSkillId` 时，判断**恰好相反**：
  引擎的事件字段变了，但**它不参与判定、事件流也不进 `BattleState`**，
  所以 `REPLAY_FORMAT_VERSION` **不必 +1** —— 那时**也不要**去动
  `RUN_FORMAT_VERSION`（它不是记录格式的事）。

**一句话记法**：问"**这改变的是引擎算出来的东西，还是我们写下来的东西？**"
前者 → `REPLAY_FORMAT_VERSION`；后者 → `RUN_FORMAT_VERSION`。

⚠️ 顺带一条**当前状态**：`RunRecord` **从来没有被真正写出去过**（存档是 P7）。
所以 `RUN_FORMAT_VERSION` 的每次 +1 现在都**没有要兼容的旧数据** ——
它此刻的作用是"形状变了就改号"，而不是"救回一份旧存档"。

| 工作项 | 是否改变现有战斗的确定性语义 | 要不要 +1 |
|---|---|---|
| W1 计数器写入 / W2 计数器条件 | ❌ 现有内容不用它 → 结果逐位不变 | 不必（**且已推迟**：等战斗内机制的真实消费者） |
| ~~W3 `onInterruptSuccess` 派发~~ | — | ❌ **不需要**（已删） |
| W4 `grantSkill` / W5 `consume` | ❌ 现有内容不用它 | 不必 |
| **W6 `maxHp` 钳制改走结算值** | ⚠️ **理论上会**（钳制口径变了）。今天没有任何内容加 `maxHp` 修正 → 实际应逐位不变 | **必须由黄金测试证明**；若变了 → **+1**，并改 `tests/golden/replay.test.ts:86` 与 `GOLDEN_OUTCOME` |
| W12 `core/run/` | ❌ 不碰引擎 | 不必 |
| **③ `interruptSuccess.sourceSkillId`** | ❌ **不参与任何判定**：`core/` 里唯一消费事件的引擎侧代码是 `buffHookDispatch.ts` 的 `drain`，它只认 `buffApplied` / `buffExpired`；而事件流**不进** `BattleState`（快照里没有事件字段）。黄金重放逐位不变（已实测） | **不必**（仍为 2） |
| **④ `damage.viaBuffId` +「卸」放宽为"吸收 > 0"**（2026-10-13） | ⚠️ **两半分开看**：<br>① **字段**：`damage` 加可选 `viaBuffId`（`>N` 平减是**谁**磨的）—— 由 `hitResolution` 在事件产出**之后**补，**不碰伤害 / 命中的任何算式**（`amount` / `thinned` 一个数都没动）→ 与上面两条同一条纪律<br>② **判据**：「连消带打」从"**完全**卸掉才算"放宽为"**吸收 ≥1 点**就算"（`comboWindow.ts` 的 `viaBuffId` 通道多认一个出口）。它只在**带了炁机**的一局里有效（`comboWindows` 为空时是空操作），而 `RecordedRun` **不携带炁机**（`{version, seed, ticks, input}`）→ 版本号**观察不到这个维度**，+1 也保护不了任何一份旧文件<br>黄金重放（夹具按了卸、但**没有炁机**）**逐位不变** → 已实测 | **不必**（仍为 2）。⚠️ 若哪天炁机进了重放文件 / 存档，这条要**重新算** |

⚠️ **"一局肉鸽"的边界不在引擎里**：一个 `BattleEngine` 永远是**一场战斗**。
一局肉鸽是 `RunState` + 依次构造的 7 个 `BattleEngine`。这正是为什么
**不需要**把"多场"塞进引擎。

### 7.3 一局肉鸽状态的可哈希保证

`RunState` 必须是 plain object（`core/types/runtime.ts:66-72` 的 C5 同样适用）：

1. 不许 `Map` / `Set` / 类实例（lint C5，`lintRules.test.ts:107-112`）。
2. `unlocked` / `chosen` 用**数组**（保序，便于 diff 与哈希）。
3. `battleStats` 是 plain object：每张技能表是 `Record<SkillId, number>`（**键是技能 id，来自内容表**），`battles` 是**数组**（逐场结果）。⚠️ 第一版的 `counters: Record<RunCounter, number>` 已随 §5.2 的方向修正删除。

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
  ⚠️ 同理**"返回"也不能只有 `Esc`**：自由模式 / 选角色屏左上角的箭头就是
  那条对等入口（`ui/ScreenControls.ts`，P2 已落地）。
- 触屏层在**非 `battle` 的一切 phase 都隐藏**：现在传的是
  `isBattleActive: () => state.phase === 'battle'`（P2 已改对），
  所以新屏**默认就是隐藏**的（不会浮着双弧按钮与卡片重叠；
  AGENTS.md §3b："触屏时整条技能栏都隐藏"同理）。
- `canvasInput.ts` 的 `phase()` 判断要为新屏加分支，且**顺序即优先级**
  （该文件已写明实测踩出来的规则：齿轮 → 返回箭头 → 当前那一屏 → 结算点屏
  → 触屏按钮）。

---

## 9. 模块划分与引擎改动

### 9.1 按职责划模块

```text
src/core/run/                     ← 新层：一局肉鸽的纯逻辑（零依赖、Node 可跑）
  types.ts        RunState / 一局肉鸽的记录形状 / 位置与档位（tierForPosition）
  shuffle.ts      种子化洗牌（这一层唯一的随机消费者）
  stats.ts        **造数**：EventDef[] → BattleStats（归约）+ 累加（纯函数）
  query.ts        **读数**：BattleStatQuery 的联合与求值（作用域在这里生效）
  outcome.ts      这一场打完了没有 / 谁赢了（两边共用的**叶子**，避免类型环）
                  ⚠️ `outcomeOf` **目前没有 core 消费者**（P2/P3 的 app 入口）—— 见其注释
  unlock.ts       解锁判定 + 每场战斗后的候选生成（纯函数）
  lifecycle.ts    场次推进 / 胜负 / 通关 / 累计统计（状态转移）
  record.ts       一局肉鸽的重放记录（序列化 + 校验 + **两份描述的对账**）
  index.ts        转发

src/core/types/
  qiji.ts         （新）QijiEntity / QijiUnlock / RunStatQuery（转发 stats.ts 的查询类型）

src/core/events.ts                （改）`interruptSuccess` 加可选 `sourceSkillId` ← **③，本轮唯一动引擎的地方**
src/core/combat/hitResolution.ts  （改）2 处 emit 点带上打断者用的招式

src/core/loadout/                 ← 新：GameEntity → 战斗输入的规范化（W7）
  normalize.ts    GameEntityInstance[] → passiveModifiers / 固有 buff / grantSkill

src/data/
  qiji.ts         炁机内容表（含 category:'generic' 的通用炁机）
  intensity.ts    7 档 → **机制集**（哪一档起解锁 M1/M2/M3…；纯数据，**无数值系数**）
  kit.ts          buildPlayerKit(character, chosen) → BattleKit（纯函数）
  characters.ts   角色定义（形状见 §4.2；内容由用户定）
  units.ts        （改）behaviorsFor(id, tier) —— 按档过滤行为（唯一的装配点）

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

⚠️ **这张表改过一次**：初稿把 **W1 + W2 + W3** 排在最前面（"先做计数器，
再做解锁"）。§5.2 的方向修正之后，**解锁完全不需要它们** ——
所以第 1、2 行变成了"不需要"，而真正要做的只剩一行一字段的
`sourceSkillId`（**③**，已完成）。

| 顺序 | 工作项 | 改动文件 | 验收 |
|---|---|---|---|
| **0** | ✅ **已完成（本轮）**：给 `interruptSuccess` 加**可选** `sourceSkillId`（打断者用的招式） | `core/events.ts` + `core/combat/hitResolution.ts`（2 处 emit） | 单测：真引擎跑一场 → 事件带 `sourceSkillId`；**黄金重放全绿**；`REPLAY_FORMAT_VERSION` **仍是 2**（依据见 §7.2） |
| 1 | ~~**W1 + W2**：计数器写入 + 计数器条件~~ | — | ❌ **暂不做**：解锁不再需要它；而**目前没有任何已知消费者** —— 本文初稿举的"暴怒：按受伤次数减 CD"已被用户否掉（**暴怒改用 buff 实现**）。要做它，必须**先有一个真实的、非它不可的机制**。⚠️ 代价：它要往 `BattleState` 加随战斗推进的字段，是**唯一可能动确定性语义**的一项（→ 可能要 `REPLAY_FORMAT_VERSION + 1` 并重标定黄金基线） |
| 2 | ~~**W3**：派发 `onInterruptSuccess`~~ | — | ❌ **不需要**：归约读已有事件即可（§5.2） |
| 3 | **W7 + W8**：`EntityKind:'qiji'` + 实体规范化层 | `core/types/{skills,qiji}.ts`、`core/loadout/normalize.ts`、`core/content/validate.ts` | 单测：一个 `QijiEntity` → `passiveModifiers` + 固有 buff |
| 4 | **W4 + W5**：`grantSkill` / `consume` | `core/combat/*` | 单测：授予的技能出现在 `SkillBook.known` |
| 5 | **W6**：`maxHp` 真正影响上限与钳制 | `core/combat/index.ts`、`core/stats/*` | 单测 + **黄金重放必须不变**（否则 `REPLAY_FORMAT_VERSION + 1`） |
| 6 | **W9 / W10 / W11**：删掉 3 个死变体 | `core/types/{behavior,triggers}.ts`、`core/content/validate.ts` | 类型与校验器一致；全仓无引用 |
| 7 | ✅ **已完成（P0）**：**W12 `core/run/`** | 新目录 | 单测：固定 `runSeed` → 固定顺序；喂**事件数组** → 统计与解锁按预期；`RunState` JSON 往返 |

---

## 10. 落地计划（每阶段可独立验收）

| 阶段 | 交付 | **做完能看到什么** |
|---|---|---|
| **P0** | ✅ **已完成**：`core/run/`：`RunState`、洗牌、**事件流 → 统计**、解锁判定、候选生成 + 单测（**125+ 条**）；外加 **③** `interruptSuccess.sourceSkillId` | `pnpm run test:run` 全绿：同一 `runSeed` → 同一顺序；喂**事件数组** → 统计与解锁按预期；`RunState` 能 JSON 往返；**黄金重放不变**（`REPLAY_FORMAT_VERSION` 仍 2） |
| ~~**P1**~~ | ⚠️ **【作废 · 2026-10-13】引擎能力 W1+W2+W3（计数器 + 计数器条件 + hook）** | **不做**（见下） |

### ⚠️ P1 为什么作废（补记 · 2026-10-13）

用户原话：「**p1 之前你说 可以不要了**」（⚠️ 我当时口头说了"可以不要"，**但没有记进文档** —— 这一笔是补的）。

**原因**：P1 的唯一消费者是 **W1 的"暴怒那个技能"**，而用户后来改口：

> 「**暴怒的那个技能 以后靠buff实现**」

→ W1 **没有消费者了**；W2/W3 也随之失去这条线（真要用的能力另开条目，不挂在这个 P1 名下）。

**⚠️ 但有一件必须一起记住的事**：P3 里用户要的「**截 / 卸 / 闪 各用 3 次、解锁对应的"派生 击"**」
**需要"用过几次"这个计数** ✗ —— 而 P1 那条路（引擎计数器）**已经作废** ✗
→ **改走 P0 已经建好的那条路**：**事件流 → run 统计 → 解锁判定** ✓
（`core/run/stats.ts` 的事件流归约 ✓ + `unlock.ts` 的解锁判定 ✓ + `record.ts` 的持久化 ✓）
→ 也就是说：**这三条解锁逻辑不需要新的引擎能力** ✓ 只需要把 P0 的层**接进 app** ✓
（若真需要"单场战斗内计数"，那是另一件事，届时单独提 ✓）
| **P2** | ✅ **已完成**：`CharacterSelect` 屏 + `RunState` 接进 app + 一场战斗 → 结算 → 回选角色 | 截图：角色卡（未实现的灰掉）、键盘与触屏各选一次、`?runlen=2` 能跑完一圈 |
| **P3** | ✅ **已完成**：`QijiSelect` 屏 + 通用炁机兜底 + `buildPlayerKit` 真正影响下一场战斗（P2 的"只跑一场"桩已拆，见 `app/runSession.ts` 文件头） | 截图：选完炁机后下一场战斗玩家的 maxHp / 属性确实变了 |
| ~~**P4**~~ | ⚠️ **【作废 · 2026-10-14】强度曲线数值档**（原：`intensity.ts` 系数表 + `behaviorsFor(id, tier)` 缩放数值） | **不做**（§6.1b）。它原来的硬验收"同一 Boss 在位置 1 与位置 7 的 `gapMs` / HP 不同"随之作废 |
| **P4′** | **机制曲线**（原 P4 + P5 合并）：`src/data/intensity.ts` 的**档 → 机制集** + `behaviorsFor(id, tier)` 按档过滤 + 黄金夹具显式选档 | ① 单测：**位置 < 4 的 `Behavior[]` 里没有二阶段那一项**（原 P5 的验收）；② 单测：**位置 1 与位置 7 的 `gapMs` / HP 完全相同**（新加的反向断言 —— 它把"不再缩放数值"钉住）；③ 黄金重放**逐位不变**（`GOLDEN_OUTCOME` 不改） |
| **P6** | 实体化 **W7+W8+W4+W5**（炁机走 `GameEntity`，能给技能、能用次数） | 单测：一个"给新技能的炁机"让下一场战斗的技能栏多一格 |
| **P7** | 一局肉鸽的**中途存档**（§12 #10）+ 曲线回归测试 | 刷新页面能续上一局肉鸽 |
| **P8** | 剩余 5 个 Boss 依次补上（各自 boss spec） | `BOSS_POOL` 从 2 逐步到 7 |

**P4′ 有一条硬验收**（**取代**原来那条"`behaviorsFor(id)` 不传 tier 时必须与
今天逐字相同"）：`behaviorsFor(id, tier)` 在**最高档**下必须与今天逐字相同
（`BOSS_BEHAVIORS.get(id) ?? PRIDE_BEHAVIORS`，`units.ts:201-203`）——
因为最高档 = 机制全开 = 那个 Boss 的完整行为表。黄金夹具从"写死
`PRIDE_BEHAVIORS`"改成"调 `behaviorsFor(id, 最高档)`"，**期望值不变**（§6.1b
后果 1/2）。

---

## 11. 风险（在"兜底变多 / 可选全激活"之后重新评估）

| # | 风险 | 为什么危险 | 缓解 |
|---|---|---|---|
| **1** | **双曲线失控**（Boss 每场战斗更难 vs 玩家每场战斗更强） | 两条曲线互相追赶，很容易变成"前 3 场碾压、第 6 场必死"或反过来。**这是本设计最可能翻车的地方**。⚠️ **2026-10-14 后收窄**：Boss 侧只剩**机制**曲线（§6.1b），但"机制变多"同样会让后期突然变陡 —— 这条风险的形状没变，只是旋钮少了 | 定"目标形状"（第 k 场战斗用时/剩余血量大致持平）+ 固定 `runSeed` + 固定策略的曲线回归测试 |
| **2** | **通用炁机 vs 机制炁机的收益差**（模式 A） | 通用项（血量/回复/护甲/暴击）永远可选、收益稳定、不依赖操作。若机制炁机的收益不明显，玩家会一直点通用 → 炁机系统的"强化方向"失去意义 | ① 一局里每条通用炁机**只能选一次**（2026-10-13 改：原为"加 `maxStacks` 上限"）→ 选过就从候选里消失，后面的场次**只能**看向机制项；② 机制项要**改变玩法**（派生、追击、资源循环）而不是加数字 |
| **2′** | （模式 B 下替换为）**build 多样性消失 + 数值爆炸** | "解锁即全部激活"没有决策 → 一局肉鸽没有 build；7 场 × 每场多个炁机同时生效，数值需要重新标定 | 若选 B，必须先把"每场战斗后解锁的量"控制住（例如每场只解锁 1 个） |
| **3** | **7 个 Boss 的机制通道不齐** | "按位置解锁二阶段/霸体/控制"要求 7 个 Boss **都能提供**这些通道。否则第 5 个位置遇到一个没有二阶段的 Boss，体感比第 3 个位置还简单 —— **曲线在玩家体感上是反的**。⚠️ **2026-10-14 后这是唯一的难度轴**（数值不再缩放）→ 这条从"重要"升级成"**不做就整条曲线不存在**" | §6.3 的"每个 Boss 最小机制集 + 各自的 `minTier`"写进各自的 boss spec 当验收项 |
| **3′** | **机制曲线对现有 Boss 是"往下剥"** | 傲慢的二阶段**今天就在它的基础表里**；按位置解锁 ⇒ 位置 1~3 打傲慢**没有**二阶段。若"剥掉之后"的那个傲慢不好玩（它靠回补撑节奏），低档位的体验会明显塌 | 每个 Boss 的 boss spec 要回答"低档位下它靠什么撑住"；实在不行该 Boss 的 `minTier` 就调低（门槛是**内容**的事，不是全局常量） |
| **4** | **一局肉鸽的长度与失败惩罚** | 7 场 × ~95s ≈ **11 分钟纯战斗** + 8 个界面；失败全丢 | 要么缩短单场战斗（改**那个 Boss 自己**的血量，已有实测流程），要么做中途存档（§12 #10） |
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
| 3 | 兜底 +30 血能重复选吗？ | **兜底 = 一组 `unlock:'always'` 的通用炁机**，**一局里每条至多选一次**（2026-10-13 改：原为"各自有 `maxStacks` 上限：生命 3 / 炁回复 2 / 护甲 2 / 暴击 2"） | 用户在两条路里给的第一条就是"多加几个兜底"。做成"通用炁机"之后：① 不需要"没有任何解锁"的特判；② 候选项永远 ≥ 3，不会出现假选择屏；③ **一局只能选一次**（用户 2026-10-13："肉鸽也改成一局只能选一次（不叠加）"）让选过的那条从候选里消失 —— 后面的场次自然看向机制炁机，且不会出现"同一个 +30 血点三次"那种假决策 |
| 4 | 解锁计数：一局肉鸽累计还是单场内？ | **一局肉鸽累计** | 成就/解锁按 run 计是标准做法；更实际的原因是单场可能凑不满（傲慢实际只有 3 个可打断读条） |
| 5 | 备战界面的位置？ | **开发/测试入口**（`?mode=dev` / `?prepare=skip`）；正式流程走 `CharacterSelect` | 备战的核心能力是"玩家挑 Boss"，与"顺序随机"语义冲突。见 §3.4 |
| 6 | 3 个角色各是什么、初始技能套是什么？ | **不在本文范围**（用户已有想法）。本文只给流程与 `CharacterDef` 的形状（§4.2） | 用户原话："角色和初始技能我也有想法了，这跟肉鸽流程没关系吧" |
| 7 | 一局肉鸽几场？ | **固定 7 场**（7 个位置 / 7 档） | 固定长度的 run 是标准做法；剩余 5 个 Boss 依次补上，档表不变（§2.3） |
| 8 | 通关之后做什么？ | **回"选角色"开新的一局肉鸽** | run 结束回主界面。可选的后续（不属本设计）：通关后解锁更高难度（ascension）再来 |
| 9 | 开局展示本局随机顺序吗？ | **只显示"下一场"**（第 k/7 场是谁）+ 总局数；**不显示全局顺序** | 这类游戏显示的是**下一步**（StS 的地图节点、Hades 的下一个房间），不是全局剧本。全显示 → 随机性没有意义；全盲 → 无法为后面的 Boss 规划 build |
| 10 | 做中途存档吗？ | **做**（P7）。`localStorage` + 版本后缀 + 逐项校验 | StS / Hades 都能中途退出继续；手机切后台被回收是常态，不做会掉用户。解析照抄 `parseBindings` 的模式 |
| 11 | 允许改 `core/`（引擎）吗？ | **允许**，按 §0.3.1 / §9.2 的清单改 | 用户："这是我的思路，我要往这个方向做，**当然要改引擎**"。唯一不变的是 §7 的确定性硬约束 |
| 12 | 已解锁炁机只有 1 个时跳过选择屏吗？ | **不会发生**：通用炁机恒在池里，候选永远 ≥ 3 | 这是把兜底做成"通用炁机"的直接收益（原 Q12 消失） |

### 12.2 真正需要用户拍板的（都是口味 / 数值，不是架构）

| # | 问题 | 说明 |
|---|---|---|
| U1 | **通用炁机的具体数值** | +30 最大生命 / 炁回复 +X / 护甲 +X / 暴击 +X% —— 给的是结构，数值要试 |
| U2 | **一局肉鸽的目标时长** | 现在 7 场 × ~95s ≈ 11 分钟纯战斗。要更短就得动单场战斗的血量 / 时长（有实测流程：`data/prideBoss.ts` 记着傲慢那次怎么标定的）。⚠️ 2026-10-14 后**每场战斗的时长不再随位置变**（数值不缩放），只有机制在变 —— 所以这条变成了"**每个 Boss 自己**的时长" |
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
- **没做数值平衡**（~~§6.2 的档位系数~~ **已作废**、§5.4 的通用炁机数值仍是
  建议值），**没画 UI 线框图 / 没出截图**。
- **没验证**"每个 Boss 都能提供 M1/M2/M3 三条通道"—— 那是 P4′/P8 的内容工作。
- **2026-10-14 这次修订只动了本文档**：`src/` 一行未改。⚠️ **因此留下两处
  「代码里的注释与本文档不一致」**，做 P4′ 时一并改掉——
  ① `src/core/run/types.ts` 的 `tierForPosition` 注释里写着"那些是 P4 的
  `data/intensity.ts` + `behaviorsFor(id, tier)`（算 `caps`）"→ `caps` 不再
  参与，档只喂机制；
  ② `src/data/units.ts` 的 `behaviorsFor(id: string)` 还没有档这个参数。
- ⚠️ **另外两处"以前那版的残留"，是 P3 落地时漏掉的，不在本次范围内**
  （用户问"P3 完了吗"时发现）：`src/data/kits/combo.ts:18,31` 与
  `docs/specs/2026-10-12-player-kits.md:429` 都还写着「击」**没有产出者** /
  "P3 要做什么" —— 而 P3 已经把产出者（炁机 `jieShengJi`）接上了，
  `tests/unit/playerKits.test.ts:341` 的标题也早就改成"（P3 已接回）"。
  **改不改由用户定**（它不影响运行，只影响"下一个人读到哪一版"）。

---

## 14. 修订记录

| 日期 | 改动 | 方向 |
|---|---|---|
| 2026-10-12 | 初稿 | 把"引擎里现在没有的机制"当成**约束**；"一局" = 一场战斗；曲线按"现在只有 2 个能打"设计；炁机不继承 `GameEntity`；12 条开放问题留给用户 |
| 2026-10-12 | **第一次修订** | ① 术语拆成"**一局肉鸽**"与"**一场战斗**"；② 曲线/流程**按 7 个 Boss 展开**，未实现的"慢慢加"，开发期只用调试参数跑短局；③ 引擎缺口表（§0.3.1）从"约束"改成**工作清单**，并给出"删 / 实现"的逐项判定 + 依赖排序（§9.2）；④ 炁机改为 **`QijiEntity extends GameEntity`**（并列出让那条路"做活"的 W7/W8）；⑤ 角色内容移出范围，只留流程与数据形状；⑥ 兜底改成**一组 `unlock:'always'` 的通用炁机**（不再单押 +30 血），并把"全激活"写成可选模式 B；⑦ 12 条开放问题改成**决议**（肉鸽惯例 + 为什么），只留 4 条口味/数值项 |
| 2026-10-12 | **第二次修订（P0 落地后的方向修正）** | ① **解锁条件改成"从事件流归约"**（§5.2.2/§5.2.3）：删掉"引擎内计数器（W1/W2/W3）"那条路，理由是它与事件流是**并行的第二份真相**、且是唯一能动确定性语义的地方（用户："如果直接从 log 判断，而不是又加一层记录呢"）；② **`QijiUnlock` 换形状**（§5.2.1）：封闭的 5 元素 `RunCounter` 联合 → **开放的 `BattleStatQuery` 查询 + 组合子**（旧形状"只能数技能使用次数"，表达不了"某个技能造成伤害数"）；③ **W2 / W3 划掉**，W1 **保留但改理由**（不再服务于解锁，只服务**战斗内**机制，等第一个真实消费者，现在不做）；④ 真正动引擎的只剩一件小事：`interruptSuccess` 加可选 **`sourceSkillId`**（**③**），**不参与判定 → `REPLAY_FORMAT_VERSION` 不动**（§7.2）；⑤ §2.2 的生命周期伪码、§6.3 的"要新造的东西"、§9.1 的模块表、§9.2 的依赖排序、§10 的 P0 行、§7.3 的可哈希条目全部跟着改（把所有还写着 `counters` 的地方清掉——**文档比代码更容易被相信**） |
| 2026-10-12 | **第二次修订的收尾（评审 7 条反馈）** | ① **`Q-a` 拆文件**：`stats.ts`（514 行，混了"归约"与"查询求值"两个职责）拆成 `stats.ts`（造数）+ `query.ts`（读数）+ `outcome.ts`（叶子；避免 `stats ⇄ query` 的类型环）；② **`Q-b` `flawless` 收成必填**（默认值 = 静默失效：忘了传会让某个炁机永远解锁不了）；③ **`Q-e` 加对账**：`parseRecordedRun` 现在校验 `battleStats.battles` 与 `RunRecord.battles` 的**长度 / 次序 / 胜负 / 满血**一致，不一致整条丢弃（`RunBattleRecord` 因此新增可选 `flawless`；⚠️ **P7 写存档时应把它收成必填并 `RUN_FORMAT_VERSION + 1`**——长期留着"缺 = 不参与对账"这个口子等于那半条对账不存在）；④ **`Q-f` 删掉整局汇总的 `flawless` 字段**（逐场的在 `battles` 里，顶层那个没有消费者）；⑤ **`Q-d` / `Q-c` 写进文档**：`scope` 在结算那一刻同值（不是 bug；分叉点在 P3 的卡片文案与将来的战斗内判定）、`dodges` 只数 `dodged` 而 `immune` 没有查询能拿到 |
| 2026-10-12 | **评审追加（用户对形状的确认 + W1 理由再改）** | ① **把用户确认的形状写成纪律**：`query.ts` 顶部新增"**一次归约，多次查询；加条件不重扫事件**"（用户原话："以后对战斗 log 的处理，最好遍历一次，统计所有需要统计的……方便我们开发进行扩展"）—— 落点：`reduceBattleStats` 是**唯一**读 `EventDef[]` 的地方；查询只读 `BattleStats` 字段；加一条 `QijiUnlock` 不动归约。⚠️ 并写明禁止"把归约塞进查询里"；② **W1 的理由再改**：用户明确"**暴怒的那个技能以后靠 buff 实现**"，于是 §0.3.1 里 W1 唯一举的例子（"按受伤次数减 CD"）**没了** —— 定性从"暂不做，等第一个消费者"改成"**没有已知消费者；要做它必须先有一个真实的、非它不可的机制**"，并把它往 `BattleState` 加状态、可能动 `REPLAY_FORMAT_VERSION` 的**代价**写在同一条里（让想加它的人先掂量） |
| 2026-10-12 | **评审三条决定（收尾）** | ① **两个版本号的判据写进 §7.2**（新增一节）：`REPLAY_FORMAT_VERSION` = 引擎的确定性语义（+1 要重标定黄金基线、不匹配**英文抛错**）vs `RUN_FORMAT_VERSION` = 我们自己的记录格式（+1 只是因为形状变了、不匹配**整条丢弃**）——⚠️ 并点明"**加记录字段时不要套用引擎那条判据**"，附本轮两个反向实例（`flawless` → 记录号 +1 而引擎号不动；`sourceSkillId` → 引擎事件字段变了但引擎号不 +1）；② **`RunBattleRecord.flawless` 收成必填、`RUN_FORMAT_VERSION` 1 → 2**：原先留的"缺 = 不参与对账"那个口子只为兼容 v1 记录，而**没有任何 v1 记录存在**（存档是 P7）→ 有洞的检查等于没有检查；③ **`outcomeOf` 留着并标注"目前没有 core 消费者"**（删它会重建 `stats ⇄ query` 的类型环；它是叶子的语义理由，也是 P2/P3 的 app 入口） |
| 2026-10-13 | **第四次修订（炁机语义：一局只能选一次 + 不能取消）** | ① **§5.3 那一行"能叠吗"作废**（保留原文 + "当时为什么那么想" + "为什么错"）：用户两条原话把肉鸽的语义定死成"**一局只能选一次（不叠加）**"与"**选了不能取消**"。落点：`RunState.chosen` 的元素从 `{qijiId, stacks}` 收成 `{qijiId}`（一局内每个 id 至多一条）、`nextCandidates` 的过滤判据从"叠满 `maxStacks`"改成"**这个 id 选过没有**"、`QijiEntity.maxStacks` **字段整条删除**（连同 `maxStacksOf` / `stacksOf` / `Candidate.remainingStacks` 与卡片右下角的 `0/3`）—— 判据是 AGENTS.md §2 的"**重复：同一件事有第二份表达，而第一份是活的 → 删**"（"一局至多一次"已经由 `chosen` 这个 id 集合完整表达）。② **记录形状变了 → `RUN_FORMAT_VERSION` 2 → 3**（⚠️ 判据是"**记录形状 / 语义变了**"，**不是**"引擎语义变了" —— 依据与那次 `flawless` 1 → 2 同源：v2 的 `chosen[]` 带 `stacks`，v3 不带，旧记录过新解析器会**静默丢字段**）。③ **§5.4 删掉 `maxStacks` 那一列与它派生的"选满一维被迫看向机制炁机"那段推理**（保留原文 + 为什么不再成立：一局只能选一次 ⇒ "继续点它"这条路根本不存在；兜底仍按用户那句"**多加几个兜底**"= 多加几条 `always` 的通用炁机）。④ **未实现的机制那条纪律不动**；**自由模式一个字没改**（那边的炁机是备战屏上的**开关**，可以来回切，与肉鸽这条"一局的永久事实"是两套语义）。 |
| 2026-10-12 | **第三次修订（P2 落地后的流程对账 + 收尾）** | ① **§3.1 / §3.2 / §3.4 改成新流程**：初稿那张"Boot 按 `mode` 二选一、默认 `characterSelect`"的图**作废** —— 现在是 `首页（默认入口）├ 肉鸽模式 → 选角色 → 一局肉鸽 └ 自由模式 → 备战界面`；并把三条**判断**写进去（不是细节）：**为什么首页能当默认入口而"选角色"不能**（首页只是路由，不通向半成品；肉鸽那条路还不完整）、**"自由模式"是给"任意测试任意节点场景"用的**（用户原话；以后加的炁机选择 / Boss 难度就是为它加的）、**P2 的"只跑一场"是临时桩**（P3 接成 N 场 + 炁机选择）。② **`Phase` 的真相源搬到 `src/app/phaseLogic.ts`**（四个值，`flow.ts` 只转发），加 `qijiSelect` / `runOver` 时要动的那张表跟着更新。③ **这一轮加的两条交互写进 §3.1 / §3.5**：**返回**（`Esc` / 左上角箭头 → 首页，只在自由模式与选角色屏；**战斗中 `Esc` 什么都不做**）与 **`F1` 打开设置**（原先 `Esc` / `,`）。④ §3.4 的"入口"说法改对：自由模式是首页上**并列的按钮**，不是 `?mode=dev` 那种隐藏入口 |
| 2026-10-14 | **第五次修订（曲线只要机制，不要数值）** | 用户原话：「**我觉得 甚至可以不要数值曲线，只要机制曲线**」。① **§6.1b 新增**：位置系数表**不做**（原文保留在 §6.2 并标作废），`tierForPosition` 一字不改但**消费者变成"算解锁门槛"**；② **§6.3 变成唯一的位置曲线**，落地方式是内容里加可选 `minTier` + `behaviorsFor(id, tier)` 按档过滤（**纯过滤**，不碰 `core/ai` 的判定）；③ **三条连带后果写清**：黄金夹具**必须显式选档**（今天它写死 `PRIDE_BEHAVIORS`、**绕过** `behaviorsFor` —— 也就是说黄金跑的从来不是一局里的配置）、"默认档 = T4"那条验收消失（黄金改取**最高档**）、以及**这条曲线对现有 Boss 是"往下剥"**（傲慢的二阶段今天就在基础表里，位置 1~3 会**没有**它）；④ **§10 的 P4/P5 合成 P4′**，硬验收换成"最高档下与今天逐字相同 + 黄金期望值不变"，并加一条**反向**断言"位置 1 与位置 7 的 `gapMs` / HP 完全相同"（把"不再缩放数值"钉住）；⑤ **§11 加风险 3′**（"剥掉机制之后低档位好不好玩"），并把风险 3 升级成"**不做就整条曲线不存在**"；⑥ §13 记下**两处待改的代码注释**（`core/run/types.ts` 的 `tierForPosition`、`data/units.ts` 的 `behaviorsFor` 签名）—— 本次**只动文档**；⑦ 顺带补上 **P2 / P3 的"已完成"标记**（代码早已落地，表格一直没跟上 —— 用户正是因此问"P3 完了吗"） |
