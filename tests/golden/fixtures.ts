import { BattleEngine, type CreateBattleOptions } from '../../src/core/combat/battleState';
import { PRIDE_BEHAVIORS } from '../../src/data/bossPride';
import { createRegistry } from '../../src/core/content/registry';
import { ALL_BUFFS, ALL_SKILLS, DOUQI_MAX, ENERGY_MAX } from '../../src/data/content';
import { GUARD_THRESHOLD } from '../../src/data/balance';
import { BOSS_HP_DISPLAY } from '../../src/data/entities/bossHp';
import { LIN_WANFENG_HP } from '../../src/data/kits/linwanfeng';
import { flattenCatalog } from '../../src/i18n/translator';
import { zhCN } from '../../src/i18n/locales/zh-CN';
import { roughlyUsable, type EngineOptions, type RunOutcome } from '../../src/core/run';
import type { Action, BattleState, Combatant, SkillDef, StatKey } from '../../src/core/types';

/**
 * 黄金重放与集成测试**共用**的夹具。
 *
 * 抽出来的理由：这些数值（种子、血量、基础属性）是"黄金"的一部分 ——
 * 如果两处各写一份，它们会各自漂移，而重放的价值就在于唯一性。
 *
 * ==================================================================
 * ⚠️ 2026-10-12 第二次重标定：夹具的玩家就是**林晚风**
 * ==================================================================
 *
 * 上一版的参考策略用「破」（`interruptSkillId: 'break'`）打断 Boss，
 * 而「破」是**黛玄的** —— 两个已完成的角色都没有它。也就是说：
 * **黄金重放测的是一个游戏里不可能发生的场景**，绿色的测试因此给出
 * 虚假的安全感（用户看到这个取舍后选了"重标定一次"，见
 * `docs/specs/2026-10-12-player-kits.md` §6）。
 *
 * 现在夹具按**林晚风的真实数据**建模：
 *
 *   | 项 | 值 | 来源 |
 *   |---|---|---|
 *   | 技能 | **斩 / 劈 / 凝 / 格 / 避** | 她的 kit（`kits/linwanfeng.ts`） |
 *   | 血上限 | **150** | 同上（`LIN_WANFENG_HP`） |
 *   | 打断技 | **没有** | 她没有「截」也没有「破」 |
 *
 * ⚠️ 这里**没有** import `makePlayer('player')`：夹具仍然自己造单位
 * （理由见下一条"它不读 `data/units.ts`"）。但**技能与血上限**必须与
 * 她的 kit 同源，否则这次改动的全部理由（"测真实场景"）就不成立。
 * `tests/golden/replay.test.ts` 有一条断言钉住"参考策略用的每个技能
 * 都属于她"。
 *
 * ⚠️ 参考策略是**攒炁 + 闪避 + 用格**（用户给的形状）—— 而且它**用上了
 * 她全部 5 个技能**，「卸」的阈值机制也在这一场里被真正走了一遍：
 *   - 会打穿阈值的大招（> `GUARD_THRESHOLD × 2`）→ 「避」（15 炁整击免伤）
 *   - 小招 → 命中前按住「卸」（阈值抵消；只要命中那一刻在就行，
 *     按住整条读条是白烧炁）
 *
 * ⚠️ 「卸」的 `holdDrain` 现在是 **15 炁/秒**（2026-10-12 晚定的新口径：
 * 必须高于回炁 10 炁/秒，否则按住免费还回炁）。引擎按**每逻辑步 1.5 点**扣，
 * 显示侧由 `core/combat/holds.ts` 的 `holdDrainPerSecond()` 乘回来。
 * 详见 `data/balance.ts` 的 `GUARD_HOLD_DRAIN_PER_SECOND`。
 *
 * 夹具里的「卸」用法**刻意把按住窗口压到 300ms**：只要命中那一刻 buff 在就行，
 * 按住整条读条纯属浪费（阈值抵消不看按了多久）。
 *
 * ⚠️ **2026-10-12 晚（第五次重标定，缠系数减半）之后，这个夹具终于对
 * 「卸」的口径敏感了**：战斗从 1436 tick 拉长到 **4136 tick**，参考策略
 * 按住「卸」的次数涨到 **5 段 / 15 个逻辑步 / 毛消耗 20 点**，不再是
 * "被炁上限吸收"。A/B 实测（只把「卸」的每逻辑步代价换回旧口径 0.3）：
 *
 *   | 配置（都含规则 C） | ticks | 炁 | 缠 |
 *   |---|---|---|---|
 *   | 卸 15 炁/秒 + 缠 0.5（当前） | **4136** | 5 | 33 |
 *   | 卸 3 炁/秒 + 缠 0.5（只换卸） | 4556 | 5 | 13 |
 *
 * 也就是说两条数值改动现在是**耦合**的：缠减半把战斗拉长，拉长之后
 * 按住的代价才有机会体现。口径本身的回归保护仍然在
 * `tests/unit/holdDrain.test.ts`（"1 秒 = 恰好 15 炁" + "净 5 炁/秒"）。
 *
 * ⚠️ 第六次重标定又加了**规则 C**（用缠付账的技能不给施放者回缠，
 * 见 `core/combat/holds.ts` 的 `casterGainsDouqiFromDamage`）—— 它把
 * 3776 推到 **4136**，并让"纯进攻"更早输（1153 → **883** tick）。
 */

/** 固定种子。改它等于让所有黄金断言失效，所以只在这里出现一次。 */
export const FIXED_SEED = 20261009;

/**
 * 上限（**展示刻度**：100 制）。
 *
 * 内容的伤害值本身就是展示刻度（斩 10 / 劈 45），所以这里同刻度 ——
 * 早期把血量乘了 `DISPLAY_SCALE` 而伤害没乘，10 点伤害只打掉 1 点血。
 *
 * ⚠️ **血量是林晚风的 150**（`LIN_WANFENG_HP`），不是全局兜底的
 * `HP_MAX = 100` —— 夹具既然按她建模，血量也要跟着她走，否则"玩家剩
 * 多少血"这个黄金数字仍然是一个她身上不可能出现的场景。
 */
export const PLAYER_CAPS = {
  hp: LIN_WANFENG_HP,
  energy: ENERGY_MAX,
  douqi: DOUQI_MAX,
} as const;
/** Boss 血量。取值依据见 `data/entities/bossHp.ts`（实测出来的）。 */
export const BOSS_CAPS = { hp: BOSS_HP_DISPLAY, energy: 0, douqi: 0 } as const;

/**
 * 玩家基础属性。
 *
 * 新刻度下技能伤害都是内容里写死的固定值，所以主属性不再影响伤害 ——
 * 只留最小值让属性系统可用。
 */
export const PLAYER_BASE: Partial<Record<StatKey, number>> = {
  strength: 10,
  agility: 10,
  intelligence: 10,
  spirit: 10,
};

const localeKeys = new Set(flattenCatalog(zhCN).keys());

/** 真实内容 + 校验通过（`localeKeys` 由调用方注入，core 不读语言包）。 */
export const registry = createRegistry(
  { entities: [], skills: [...ALL_SKILLS], buffs: [...ALL_BUFFS] },
  { localeKeys },
);

export function makePlayer(): Combatant {
  return {
    id: 'player',
    nameKey: 'hud.you',
    side: 'ally',
    caps: { ...PLAYER_CAPS },
    resources: { hp: PLAYER_CAPS.hp, energy: PLAYER_CAPS.energy, douqi: 0 },
    counters: {},
    basePrimary: { strength: 120, agility: 100, intelligence: 110, spirit: 100 },
    buffs: [],
    cooldowns: {},
    casts: [],
    uses: {},
    behaviors: [],
    alive: true,
  };
}

export function makeBoss(): Combatant {
  return {
    id: 'meiichiro',
    nameKey: 'boss.name',
    side: 'enemy',
    caps: { ...BOSS_CAPS },
    resources: { hp: BOSS_CAPS.hp, energy: 0, douqi: 0 },
    counters: {},
    basePrimary: { strength: 400, agility: 200, intelligence: 300, spirit: 200 },
    buffs: [],
    cooldowns: {},
    casts: [],
    uses: {},
    behaviors: PRIDE_BEHAVIORS,
    alive: true,
  };
}

/** 标准引擎参数。`overrides` 允许测试改单个字段。 */
export function makeGoldenEngineOptions(
  seed = FIXED_SEED,
  overrides: Partial<CreateBattleOptions> = {},
): EngineOptions {
  return {
    combatants: [makePlayer(), makeBoss()],
    seed,
    bossId: 'meiichiro',
    timeLimitMs: 180_000,
    buffs: registry.buffs,
    skills: registry.skills,
    baseStats: new Map<string, Partial<Record<StatKey, number>>>([
      ['player', PLAYER_BASE],
      ['meiichiro', {}],
    ]),
    passiveModifiers: new Map(),
    ...overrides,
  };
}

/** 一个纯粹用于观察的引擎（不走重放）。 */
export function makeEngine(seed = FIXED_SEED): BattleEngine {
  return new BattleEngine(makeGoldenEngineOptions(seed));
}

/**
 * 黄金结果常量。
 *
 * **这个常量被测试断言精确匹配。** 如果它变了，说明某个改动
 * 改变了整场战斗 —— 那正是需要被注意到的事。
 * 更新它之前先确认：变化是本次改动**有意**造成的吗？
 */
export const GOLDEN_OUTCOME = {
  /**
   * 林晚风（攒炁 + 闪避）对「傲慢」：**险胜**。
   *
   * ⚠️ 数值的逐版来历都留在下面 —— 它们记录的是"哪一次改动把它推到了
   * 哪里"，而不是"必须守住的平衡目标"（需求方说过数值后面还会大改）。
   *
   * ⚠️ **2026-10-11 改造「傲慢」后重新标定**（快慢刀 + 霸体合并 +
   * 随机选招，见 `docs/specs/2026-10-11-pride-boss.md` §9.3）：
   *   三招 1.0s/20、1.5s/40、2.0s/60，冷却全 3s，`gapMs` 4s（= §Q5 推荐）；
   *   60 起手自带霸体并附带「倒地」；半血有一次可打断的「回补」。
   *
   * 下面的实测表是**旧 Boss（伪名一郎）的记录，刻意保留** ——
   * 它记录了「倒地」这个机制的副作用，对下一个人仍然有用。
   * 它描述的不是当前内容。
   *
   * ⚠️ **当前平衡的实测数字在 `src/data/entities/bossHp.ts`**（那里跟着
   * 数值改动一起更新）。要比较"这次改动变了多少"，读那一份，不要读这里。
   *
   * 实测（规范策略）—— **2026-10-10 加了「倒地」重新标定**：
   *   - 用时 **926** tick ≈ 15.4 秒
   *   - 玩家剩 **65 血**
   *   - 只按「斩」（完美进攻、零防御）：**败**，Boss 还剩 30 血
   *
   * 也就是需求要的"不防御就算完美进攻也打不过"。
   *
   * ⚠️ **「倒地」让会闪避的玩家变强了**（22 血 → 65 血）。
   * A/B 实测（同一策略，只把「横扫」的倒地效果摘掉做对照）：
   *
   *   | | ticks | 玩家出手 | 玩家命中 | boss 出手 | **boss 命中** | 玩家承受 | 闪避 |
   *   | 有倒地 | 926 | 25 | 19 | 5 | **1** | **35** | **2** |
   *   | 无倒地 | 746 | 25 | 19 | 4 | **2** | **78** | 1 |
   *
   * ⚠️ **别用"造成伤害"来比较** —— Boss 血量固定，打完就是 0，
   * 所以那个数字在两场里都等于血量，**不含任何信息**。
   *
   * 有效的度量是**出手/命中次数** —— 倒地 2 秒的封锁**没有让玩家少出手**
   * （战斗长了 180 tick，而那 2 秒本来就在读条/等 CD）。
   *
   * ⚠️ 「倒地就不能攻」这条**机制本身是对的**（用户已确认），
   * 实测倒地窗口内「斩」被拒 94 次、成功 0 次。要不要削弱那个副作用
   * （例如给「避」加冷却）是产品决策。
   *
   * ⚠️ **2026-10-11 → 2026-10-12 的第二次重标定**（本文开头那次）：
   *   夹具从"通用玩家 + 「轰」+ 「破」"换成**林晚风**，
   *   所以 5696 tick / 剩 20 血是**旧夹具**的数字，保留它才有"改了多少"。
   */
  status: 'victory' as const,
  endReason: 'hpZero' as const,
  /**
   * 通关用时（tick）。连续量，对数值改动敏感。
   *
   * ⚠️ **926 → 5696**（2026-10-11）。那一次改了四件事：
   *   傲慢血量 210 → **420**；二阶段门槛 50% → **40%**；回补 63 → **126**；
   *   「斩」10 → **15 炁**、「避」30 → **15 炁**；
   *   并且**把参考策略升级成"会攒炁"的**（见 `planPriority` 的说明）。
   *
   * 15.4 秒 → **94.9 秒**。变长的原因是炁：斩 15 炁 + 每秒回 10
   * ⇒ 持续输出约 6.7/s，而这一场要打穿 420 + 126（回补）= 546 点。
   *
   * ⚠️ **5696 → 1436**（2026-10-12 第二次重标定，约 **23.9 秒**）。
   * 同时变了三件事，方向都是"更快"：
   *   1. **「轰」→「劈」**：50 缠换 45 伤（轰是 30 + 易伤），
   *      而林晚风的缠只出口这一处
   *   2. **参考策略不再白烧炁**：旧策略带着「破」，每次读条都朝它按一遍
   *      （10 炁一次，多数被霸体挡下）—— 那些炁本来能变成输出
   *   3. **「凝」不再白抢缠**：旧优先级是 凝 → 轰 → 斩，而两者都花 50 缠、
   *      「凝」没有冷却 —— 只按优先级挑，"凝"会一直排在"轰"前面。
   *      现在给参考策略加了 `onlyRefreshesActiveBuff`（增益还挂着就跳过），
   *      两个技能才都真的用上
   *
   * ⚠️ **2026-10-12 晚（第三 / 四次检查）：按住消耗口径修正（18 → 0 点）
   * 与 3 → 15 炁/秒的改向，这一串数字都没动**（1436 / 140 血 / 炁 100 / 缠 94）。
   *
   * 那不是"没生效"，而是**当时的夹具对按住口径不敏感**：参考策略只按住了
   * 2 段 / 共 6 个逻辑步，而玩家的炁全程顶在上限（回炁 10/秒，整场回 240 点）
   * —— 那点消耗被上限吸收了，输出节奏一点没变。口径的回归保护因此**必须**
   * 放在 `tests/unit/holdDrain.test.ts`，不能指望这条黄金常量。
   *
   * ⚠️ **1436 → 3776**（2026-10-12 晚第五次重标定，约 **62.9 秒**）。
   * 这次改的是**缠的产出**：`DOUQI_PER_DAMAGE` 从 **1 减半到 0.5**
   * （用户："造成伤害 攒的缠 改成一半"）。
   *
   * 归因（A/B 实测，见文件头）：
   *   - **「卸」单独改（3 → 15 炁/秒），缠还是 1**：**1436 不变**（被上限吸收）
   *   - **缠单独减半（卸保持旧的 3）**：1436 → **3940** tick
   *   - **两条一起（当前）**：1436 → **3776** tick
   *
   * 方向解释：缠减半 ⇒ 「劈」（45 伤，缠的唯一出口）与「凝」的可用频率
   * 一起降下来 ⇒ 输出变慢 ⇒ 战斗从 24 秒拉长到 63 秒 ⇒ 玩家挨更多、
   * 炁也攒不下来（炁 100 → 5，缠 94 → 36，血 140 → 125）。
   *
   * ⚠️ **拉长之后，这个夹具终于对「卸」的代价敏感了**：按住「卸」从
   * 2 段 / 6 个逻辑步涨到 **5 段 / 15 个逻辑步 / 毛消耗 20 点**，
   * 于是"卸 15 + 缠 0.5"（3776）与"卸 3 + 缠 0.5"（3940）不再相同。
   * 也就是说这两条数值改动是**耦合**的，归因表里必须分开量。
   *
   * ⚠️ **3776 → 4136**（2026-10-12 晚第六次重标定，约 **68.9 秒**）。
   * 这次改的是**规则**：**用缠付账的技能不给施放者回缠**（规则 C）。
   * 「劈」（50 缠 / 45 伤）原来会退回 `45 × 0.5 = 22` —— 退回自己 44% 的
   * 代价；现在一次都不退。于是参考策略的「劈」变少 ⇒ 输出更慢 ⇒ 更长。
   *
   * 归因（只换这一个变量）：3776 → **4136** tick（+360 ≈ 6 秒），
   * 玩家终局缠 36 → **33**，血 / 炁不变（125 / 5）。
   * 对照：只按「斩」的策略（不用缠）**6188 不变** —— 规则 C 对它是空操作。
   *
   * ⚠️ **别把这个数字当平衡目标**：需求方说过"这些数值后面还会大改"。
   * 它的职责是"哪次改动动了整场战斗"能被立刻发现。
   *
   * ================================================================
   * ⚠️ **4136 → 4046**（2026-10-13「凝」重标定 —— **用户明令**）
   * ================================================================
   *
   * 用户原话："**凝改成增伤 60% 持续 10 秒，代价 40 缠**"。
   * 所以 `src/data/kits/shared.ts` 同时变了三个数：
   *
   *   | | 旧 | 新 |
   *   |---|---|---|
   *   | 增伤（`FOCUS_BUFF.modifiers[0].value`） | 20 | **60** |
   *   | 时长（`FOCUS_BUFF.duration`） | 30 秒 | **10 秒** |
   *   | 缠耗（`FOCUS.cost[0].value`） | 50 | **40** |
   *
   * **归因是实测的，不是推理的**（把 `shared.ts` 那三行单独回退再跑）：
   *
   *   | 配置 | 结果 |
   *   |---|---|
   *   | 只回退「凝」那三行（其余全保留） | **4136** tick / 剩 125 血 / 炁 5 / **缠 33** |
   *   | 当前（60% / 10 秒 / 40 缠） | **4046** tick / 剩 125 血 / 炁 5 / **缠 13** |
   *
   * 变了的是 **`ticks`（4136 → 4046，约 68.9 秒 → 67.4 秒）与玩家的终局
   * `douqi`（33 → 13）**；**`finalRngSeed`（20261009）与 `combatants` 的
   * 其它字段（血 125 / 炁 5 / 存活）一个都没变**。
   *
   * 方向解释：增伤 20% → 60% ⇒ 每一击更重、更早打穿 420 + 126 的回补
   * （少约 1.5 秒）；而缠耗 50 → 40 让「凝」更便宜，参考策略在这一段里
   * 更频繁地把缠换成「凝 / 劈」，于是**收尾时缠反而更空**（33 → 13）。
   *
   * ⚠️ 这一条与"三条新炁机"**无关**：那三条只在本局**选了**之后才进
   * `buildPlayerKit`，而黄金重放走的是**空 `chosen`**（`passiveModifiers`
   * 是空的、`comboWindows` 是空的、`skillTweaks` 也是空的）——
   * 所以夹具**一个字都不用改**（这条常量动的是"凝的数值"，不是策略）。
   * ⚠️ `REPLAY_FORMAT_VERSION` **也不动**：这是数值改动，不是引擎语义。
   */
  ticks: 4046,
  /**
   * 当前内容没有暴击判定，所以随机数一次都不被消耗 —— **玩家侧**的
   * 随机流确实一次没用（抽招走的是 `BattleState.aiRngSeed`，
   * 与它平级的另一条流，见 `AiState.aiRngSeed`）。
   */
  finalRngSeed: 20261009,
  /**
   * ⚠️ 玩家剩 **125 血**（林晚风上限 150），炁 **5**、缠 **13**。
   *
   * 打法：大招（40 / 60）用「避」整击免掉，小招（20）按住「卸」抵消 15。
   * 缠减半 + 规则 C（用缠不回缠）之后这一场从 24 秒变成约 67 秒，资源不再
   * 顶在上限，所以炁只剩 5、缠只剩 13（凝重标定之后：缠耗更低 ⇒ 结尾更空，
   * 见 `ticks` 上方那段归因）。这个数字只记"当前实测"，
   * 不承担"必须落在某个区间"的职责 —— 那件事由 `prideBoss.test.ts`
   * 的性质断言负责（赢 / 不是满血，而不是具体血量）。
   */
  combatants: {
    player: { alive: true, hp: 125, energy: 5, douqi: 13, damageDealt: 0, damageTaken: 0 },
    meiichiro: { alive: false, hp: 0, energy: 0, douqi: 0, damageDealt: 0, damageTaken: 0 },
  },
} satisfies Omit<RunOutcome, 'ticks'> & { readonly ticks: number };

/**
 * 参考策略用的**防御技**（林晚风的「避」= 闪）。
 *
 * 单独导出、而不是在 `planPriority` 里写字面量，是为了让
 * `tests/golden/replay.test.ts` 能断言"它真的属于林晚风" ——
 * 这次重标定的全部理由就是这一条。
 */
export const DODGE_SKILL_ID = 'dodge';

/**
 * 参考策略用的**按住防御**（林晚风的「卸」）。
 *
 * 策略里「避」管大招、「卸」管小招（判据见 `planPriority` 的
 * `GUARD_THRESHOLD * 2`）—— 这条线同时用上了她全部 5 个技能，
 * 也就同时覆盖了她的新机制（阈值抵消）。
 */
export const GUARD_SKILL_ID = 'guard';

/** 一个技能"打在身上最重的那一击"的伤害（展示刻度；不是伤害技能返回 0）。 */
function incomingDamage(skill: SkillDef | undefined): number {
  if (skill === undefined) return 0;
  let worst = 0;
  for (const hit of skill.hits) {
    for (const effect of hit.effects) {
      if (effect.kind !== 'damage' || effect.damage === undefined) continue;
      const base = effect.damage.base;
      /**
       * ⚠️ 今天的内容全部是字面量（`S(20)` 这种）。如果将来有人把伤害
       * 写成 `Expr`，这里**读不出静态值** —— 那就当成"威胁未知"（正无穷）
       * 让策略保守地「避」，而不是静默按 0 伤害放着不管（后者会漏防）。
       */
      if (typeof base !== 'number') return Number.POSITIVE_INFINITY;
      worst = Math.max(worst, base);
    }
  }
  return worst;
}

/**
 * 这个技能是不是"**只在给自己挂一个已经挂着的 buff**"。
 *
 * 用途：`priority` 里的「凝」是增益技。如果只是"缠够了就再放一次"，
 * 它会**永远抢在「劈」前面**（两者都是 50 缠）—— 于是参考策略里
 * 「劈」一次都用不出来，而"参考策略用上了她全部技能"就不成立了。
 * 真人对一个还挂着的增益不会重放（那只是白花资源）。
 */
function onlyRefreshesActiveBuff(skill: SkillDef | undefined, player: Combatant | undefined): boolean {
  if (skill === undefined || player === undefined) return false;
  return skill.abilities.some(
    (ability) =>
      ability.kind === 'grant' &&
      ability.target.mode === 'self' &&
      player.buffs.some((b) => b.defId === ability.buff.id),
  );
}

/**
 * 一个可以被重放复用的玩家策略：**每 tick 按优先级尝试**。
 *
 * 刻意不用手写动作时间表 —— 那种输入会随 GCD / 代价改动而整体失效，
 * 让重放因为"技能被拒"而失败，掩盖真正想检测的行为变化。
 *
 * ==================================================================
 * ⚠️ 2026-10-12：它现在按**林晚风**的真实技能建模，且**没有打断**
 * ==================================================================
 *
 * 上一版这里有一个 `interruptSkillId`（黄金夹具传的是「破」）。那是
 * **一个没有角色带的技能** —— 见文件头。现在去掉了：她既不认识
 * 「破」也不认识「截」，一个"会打断的参考玩家"不是她。
 *
 * 策略的行为（真人打法）：
 *   1. Boss 在读条、且那一招**会造成伤害**：
 *        · 大招（`> GUARD_THRESHOLD × 2`，即会打穿「卸」的那两刀）
 *          → 快到命中时「避」（15 炁换整击免伤）
 *        · 小招 → 命中前按住「卸」（阈值抵消），命中后松开
 *        · 两种都**不做输出** —— 输出与防御抢同一个炁池
 *   2. Boss 在放**不造成伤害**的招（「回补」）→ 不理它，也不输出
 *   3. 没有读条 → 才按优先级输出（还挂着的增益不重放）
 *
 * ⚠️ **"攒炁"只在配了 `dodgeSkillId` 时生效**：不配 = 这个策略压根不防御，
 * 那时"停手攒炁"没有意义，会把它从"纯进攻"变成"纯站桩"，
 * 毁掉 `pureAttackPlan` 想测的那件事。
 *
 * ⚠️ 「卸」的按住窗口（`guardLeadMs`）刻意**短于**「避」的窗口：
 * 它的代价按时间扣（`holdDrain`），按住整个读条会白烧炁；
 * 而阈值抵消只看命中那一刻 buff 在不在，按多久都一样。
 *
 * @param priority 技能 id，顺序即优先级（必须全是林晚风有的技能）
 * @param dodgeSkillId 看到 Boss 读条时要插的防御技（不给则不躲、也不攒炁）
 * @param dodgeLeadMs 在命中前多少毫秒闪避。默认 500。
 */
export function planPriority(
  priority: readonly string[],
  options: {
    readonly dodgeSkillId?: string;
    /**
     * 在命中前多少毫秒闪避。默认 500。
     *
     * 无敌窗口是 0.5 秒（500ms），所以要在命中前
     * **不超过 500ms、也不要太接近 0** 的时刻按下。
     *
     * ⚠️ 下面那组扫描数字来自 **旧数值**（斩 10 炁 / 避 30 炁），
     * 只当"这是个窗口、两端都会变差"的旁证看，不要当当前平衡：
     *   lead=  0ms → 剩 27 血      lead= 500ms → 剩 100 血（免伤）
     *   lead=200ms → 剩 57 血      lead= 600ms → 剩 100 血（免伤）
     *   lead=400ms → 剩 90 血      lead= 800ms → 剩  88 血（又挨打了）
     */
    readonly dodgeLeadMs?: number;
    /** 命中前多少毫秒开始按住「卸」。默认 300（= 3 个逻辑步的扣费）。 */
    readonly guardLeadMs?: number;
    /**
     * **伤害超过多少就用「避」而不是「卸」**。默认 `GUARD_THRESHOLD × 2`。
     *
     * 传 `0` 就变成"一律用避、从不格" —— `replay.test.ts` 用它来单独测
     * 「避」的完全免伤（那是引擎机制的性质，不该被「卸」的减伤盖住）。
     */
    readonly dodgeAboveDamage?: number;
  } = {},
): (tick: number, state: BattleState) => readonly Action[] {
  const leadMs = options.dodgeLeadMs ?? 500;
  const guardLeadMs = options.guardLeadMs ?? 300;
  const dodgeAbove = options.dodgeAboveDamage ?? GUARD_THRESHOLD * 2;
  /** 「卸」是按住型，所以策略必须记住"我现在按着吗"。 */
  let holdingGuard = false;

  return (tick, state) => {
    const player = state.combatants.find((c) => c.side === 'ally');
    const boss = state.combatants.find((c) => c.side === 'enemy');
    const cast = boss?.casts[0];
    const releaseGuard = (): readonly Action[] => {
      holdingGuard = false;
      return [{ type: 'releaseSkill', skillId: GUARD_SKILL_ID, atTick: tick }];
    };

    if (cast !== undefined && options.dodgeSkillId !== undefined) {
      const skillDef = registry.skills.get(cast.skillId);
      /**
       * **只对"会造成伤害"的招式反应。**
       *
       * 踩过的坑：早期只看"Boss 在读条"就闪 → 连不造成伤害的招式也闪，
       * 白花炁（= 2 次「斩」）。表现为"会闪反而输得更惨"，让人误以为
       * 闪避机制没用，其实是**策略在乱闪**。真人对纯增益招式不会闪。
       *
       * ⚠️ 这一条在"没有打断"之后更重要了：Boss 的「回补」现在**没人
       * 打断**，而它不造成伤害 —— 策略必须不去理它。
       */
      const threat = incomingDamage(skillDef);
      const remainingMs = cast.castTimeMs - (tick - cast.startedAtTick) * (1000 / 60);

      if (threat > 0 && remainingMs > 0) {
        /**
         * **大招一律「避」**：判据是 `dodgeAbove`（默认 `GUARD_THRESHOLD × 2`）。
         * 会打穿阈值的那两刀（40 / 60）用「卸」只能各减 15，太亏；
         * 而「避」花 15 炁整击免掉。小招（20）则相反：一次「避」要 15 炁，
         * 用「卸」只要按住 3 个逻辑步。
         */
        if (threat > dodgeAbove) {
          const alreadyImmune = (player?.buffs ?? []).some((b) => b.defId === 'dodge-iframe');
          const dodger = options.dodgeSkillId;
          const canDodge =
            remainingMs <= leadMs &&
            !alreadyImmune &&
            roughlyUsable(dodger, state, registry.skills.get(dodger));
          if (canDodge) {
            const dodge: Action = { type: 'useSkill', skillId: dodger, atTick: tick };
            /** 先松开「卸」再闪（同一个 tick 里两个动作）—— 否则格的 buff 会留着。 */
            return holdingGuard ? [...releaseGuard(), dodge] : [dodge];
          }
          return holdingGuard ? releaseGuard() : [];
        }
        /** 小招：命中前按住「卸」，命中后松开。 */
        if (remainingMs <= guardLeadMs) {
          if (!holdingGuard) {
            holdingGuard = true;
            return [{ type: 'hold', skillId: GUARD_SKILL_ID, atTick: tick }];
          }
          /** 已经按着 —— 引擎的 `startHold` 会忽略重复，这里就不重复发。 */
          return [];
        }
        return holdingGuard ? releaseGuard() : [];
      }
      /** 不造成伤害的招（「回补」）：不防御、不输出，只攒炁。 */
      return holdingGuard ? releaseGuard() : [];
    }

    /** 没有读条 → 收起「卸」，正常输出。 */
    if (holdingGuard) return releaseGuard();

    for (const skillId of priority) {
      const skill = registry.skills.get(skillId);
      if (onlyRefreshesActiveBuff(skill, player)) continue;
      if (roughlyUsable(skillId, state, skill)) {
        return [{ type: 'useSkill', skillId, atTick: tick }];
      }
    }
    return [];
  };
}

/**
 * 输出优先级（黄金重放用）—— **全是林晚风的技能**。
 *
 * 顺序即"玩家会优先按哪个键"：凝（增伤）→ 劈（炁爆发）→ 斩（填充）。
 *
 * ⚠️ 上一版这里是 `['focus', 'blast', 'attack']` —— 「轰」是**凯丽的**，
 * 林晚风按不出来。换成她自己的「劈」（45 伤 / 50 缠 / 1.2s 读条）。
 * 这次重标定之后，"夹具用的技能属于她"由
 * `tests/golden/replay.test.ts` 的断言钉住。
 *
 * ⚠️ 「卸」「避」不在这个优先级里 —— 它们只在看到 Boss 读条时才用
 * （见 `planPriority`）。
 */
export const OUTPUT_PRIORITY = ['focus', 'pi', 'attack'] as const;
