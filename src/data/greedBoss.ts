/**
 * **「贪婪」** —— 盜賊頭目。
 *
 * 设计记录：`docs/specs/2026-10-12-seven-sins.md` §11。
 *
 * ==================================================================
 * 它的题型（不是数值，是"逼你做什么决定"）
 * ==================================================================
 *
 * | Boss | 逼你决定的 |
 * |---|---|
 * | 傲慢 | "这一下发不发得起 30 炁去躲？" |
 * | 色欲 | "我现在该不该继续打？" |
 * | 嫉妒 | "我攒着的东西，还敢不敢留着？" |
 * | **贪婪** | "**它的层数还在涨 —— 现在不爆发，等什么时候？**" |
 *
 * ==================================================================
 * 核心：**指数级增长的施法者 buff（可被打断）**
 * ==================================================================
 *
 * 用户原话："**无限叠加、指数级增强的 buff 技能**，**可以被打断**"，
 * 后来把"无限"收成 **9 层**、并且"每一层只变强一点点，但是**全面**"：
 *
 * | 每层 | 落点 |
 * |---|---|
 * | 伤害 +10% | `damageMultBoost`（buff 的修正字段，**对 Boss 的技能伤害生效**） |
 * | 回血 +1/秒 | `hpRegen`（每秒口径，引擎按逻辑步换算） |
 * | 读条 −10% | `haste`（`castPipeline` 里 `hastedCastTime` / `hastedCooldown` 的唯一来源） |
 *
 * 三层一起 ⇒ 玩家看到的是"它越来越快、越来越痛、还在回血"，
 * 而**唯一的解法是打断那一招**（它就是一条普通读条技，`interruptible`）。
 * 这就是这个 Boss 的题。
 *
 * ⚠️ **"读条时间减少 / 减 CD"是公共机制，不是贪婪专属**：
 * 引擎读的是 `haste`（`core/combat/index.ts` 的 `hastedCastTime` /
 * `hastedCooldown`），所以任何 Boss（或玩家）的内容都可以用同一套。
 * 这次顺手删掉了两个**没有被任何引擎分支读的**重复属性
 * （`castSpeed` / `cooldownRate`）—— 见 `core/types/stats.ts` 的说明。
 *
 * ⚠️ `haste` 的钳制是 **[0, 0.5]**（`stats/aggregate.ts`）。9 层 ×10%
 * 的**乘法**口径是 `1 − 0.9^9 ≈ 61%`，所以第 6–9 层的"读条"部分会被
 * 钳掉（伤害与回血照涨）。这是**有意的天花板**：钳制在那里写着，
 * 而且"读条缩到 39%"已经足够危险。
 */

import type { ActiveSkillDef, Behavior, BuffDef, PassiveSkillDef, SkillDef } from '../core/types';
import type { BossDef } from './bossDefs';
import { logicMs } from '../core/loopConstants';
import { S } from './scale';
import { BOSS_TELEGRAPH } from './bossShared';

/** 读条标记（时长 = 自己的 `castTime`，见 `BOSS_TELEGRAPH` 的说明）。 */
function tel(skillId: string, ms: number): BuffDef {
  return { ...BOSS_TELEGRAPH, id: `boss-${skillId}-telegraph`, duration: ms };
}

/* ================================================================== *
 * 1. 「敛财」：层层加码的自身 buff
 * ================================================================== */

/**
 * 「敛财」——**可被打断的、每层都全面变强一点**的 buff。
 *
 * ⚠️ 三层修正**必须都在**（用户原话"全面"）：只写伤害会让它变成
 * 一个普通的增伤 buff；有了读条与回血才是"越拖越没法打"。
 *
 * ⚠️ `stacking.mode: 'stackRefresh'` 且 `max: 9` —— 用户把"无限"收成 9 层，
 * 所以到顶之后 `applyBuff` 不再加层、只**刷新时长**。
 *
 * ==================================================================
 * ⚠️ 2026-10-15：`'stack'` → `'stackRefresh'`（**9 层以前到不了**）
 * ==================================================================
 *
 * 用户原话："3. 修复9层"。
 *
 * 根因：`'stack'` **不刷新时长**（见 `core/buffs/index.ts`）—— 12 秒是从
 * **第 1 层**那一刻起算的，所以第 3 层拿到手 1 秒后整条就过期了。
 * 真引擎实测（玩家完全不还手、CD 还是 6 秒时）：
 *
 * ```
 *   2.0s → 1 层     7.8s → 2 层     13.0s → 3 层     （12 秒到点，整条清空重来）
 * ```
 *
 * 于是"最高 9 层"永远不出现、这一招的威胁也自己会消失 ✗ ——
 * 而设计要的是"**不打断就一直涨**"（所以止损点才是打断）。
 * 现在每次施放都刷新那 12 秒 ⇒ 只要它还在放这一招，层数就一直涨到 9。
 */
export const GREED_HOARD: BuffDef = {
  id: 'greed-hoard',
  nameKey: 'greed.hoard.name',
  icon: 'boss_empower',
  /** 从**它自己**的角度是增益。 */
  polarity: 'buff',
  color: 0xd8b34a,
  /**
   * 12 秒（每次施放**刷新**）—— 够玩家看着它涨。
   *
   * ⚠️ 与 `GREED_HOARD_SKILL` 的 CD 是一对：CD 必须**远短于**它，否则
   * 层数还没涨起来就自己掉了（`'stack'` 那版就是这么坏的，见文件头）。
   * 今天 CD 3 秒 vs 12 秒 ⇒ 只要不被连续打断，一定能叠到 9。
   */
  duration: logicMs(120),
  maxStacks: 9,
  stacking: { mode: 'stackRefresh', max: 9 },
  /** 每层：伤害 +10%（乘子，所以 9 层 ≈ ×2.56）。 */
  damageMultBoost: 1.1,
  modifiers: [
    { stat: 'hpRegen', op: 'add', value: 1, sourceKey: 'greed.hoard.name' },
    { stat: 'haste', op: 'add', value: 0.1, sourceKey: 'greed.hoard.name' },
  ],
};

/* ================================================================== *
 * 2. 「弱点」：双方都吃、受伤翻倍
 * ================================================================== */

/**
 * 「弱点」——**双方各挂一层，2 秒内受到的伤害翻倍**。
 *
 * ⚠️ 它同时挂在**贪婪自己**和**玩家**身上（用户原话："使双方都出现
 * 一个持续 2 秒的 debuff"）—— 所以那 2 秒是一个**双面窗口**：
 *   - 对玩家：现在是爆发它的最好时机（它的血掉得快）
 *   - 对玩家也是危险：它那两秒里打你也是双倍
 *
 * ⚠️ "翻倍" = `damageTakenMult` 的**乘子**加 1（基准是 1）。
 * 那个属性在 `computeDamage` 里被读（在此之前它只有声明、没有内容用）。
 *
 * ⚠️ 极性是 **debuff**（对挂着的人来说是坏事），两人各挂一层 ——
 * 所以它会在**双方的减益行**上各出现一次，这是有意的（双方都看得见）。
 */
export const GREED_WEAK_POINT: BuffDef = {
  id: 'greed-weak-point',
  nameKey: 'greed.weakPoint.name',
  icon: 'boss_cleave',
  polarity: 'debuff',
  color: 0xff6b6b,
  duration: logicMs(20),
  maxStacks: 1,
  stacking: { mode: 'refresh' },
  modifiers: [
    { stat: 'damageTakenMult', op: 'add', value: 1, sourceKey: 'greed.weakPoint.name' },
  ],
};

/**
 * 「弱点」的**挂载者**（常驻、隐藏）—— 与「欲望印记」的自举悖论同一个解法。
 *
 * ⚠️ `on: 'onTick'` + `cooldownRangeMs: [3000, 5000]` 就是用户要的
 * "**随机频率，3–5 秒**"：每逻辑步问一次"到点了吗"，到点才现掷下一个
 * 间隔。掷点走**种子化 RNG**，所以重放逐位可复现。
 *
 * ⚠️ 它**不需要玩家挨打**才走 —— 这是"按时间"而不是"按命中"，
 * 也正是 `onTick` 这个钩子存在的理由（在此之前 `Hook` 里声明了它、
 * 但引擎从不派发）。
 */
export const GREED_WEAK_POINT_PASSIVE: BuffDef = {
  id: 'greed-weak-point-passive',
  nameKey: 'greed.name',
  icon: 'boss_empower',
  polarity: 'buff',
  hidden: true,
  duration: Number.POSITIVE_INFINITY,
  maxStacks: 1,
  stacking: { mode: 'refresh' },
  triggers: [
    {
      on: 'onTick',
      cooldownRangeMs: [3000, 5000],
      then: [
        /** 给自己挂（贪婪也会"露出弱点"）。 */
        { kind: 'grant', target: { mode: 'self' }, buff: GREED_WEAK_POINT },
        /** 给玩家挂（同一时刻的另一个窗口）。 */
        { kind: 'grant', target: { mode: 'primaryEnemy' }, buff: GREED_WEAK_POINT },
      ],
    },
  ],
};

/* ================================================================== *
 * 3. 技能
 * ================================================================== */

/**
 * 「敛财」——叠一层 `GREED_HOARD`。
 *
 * ⚠️ 它**可以被打断**（用户明确要的）：这是全场唯一的"止损点"。
 *
 * 读条 **2.0 秒**，而层数越高它自己放得越快（`haste`）—— 所以"越晚越难断"
 * 是**同一个机制的自然结果**，不需要另写一条规则。`haste` 有 0.5 的封顶
 * （`core/stats/aggregate.ts`），所以读条最快 **1.0 秒**、CD 最快 **1.5 秒**
 * （⚠️ 这里曾写"缩短到 1.22 秒"，那是 haste 还没接上限时的读数）。
 *
 * ⚠️ **2026-10-15：CD 6 秒 → 3 秒**（用户原话："1 改成3秒cd"）。
 * 与 `'stackRefresh'` 一起把"越拖越难"做成真的：3 秒的 CD 让层数在
 * ~30 秒内叠满，而 12 秒的时长每次施放都刷新（见 `GREED_HOARD`）。
 */
export const GREED_HOARD_SKILL: ActiveSkillDef = {
  id: 'greed-hoard',
  kind: 'activeSkill',
  nameKey: 'greed.hoard.name',
  descKey: 'greed.hoard.desc',
  icon: 'boss_empower',
  abilities: [
    { kind: 'grant', on: 'castStart', target: { mode: 'self' }, buff: tel('greed-hoard', logicMs(20)) },
    { kind: 'grant', on: 'castFinish', target: { mode: 'self' }, buff: GREED_HOARD },
  ],
  castTime: logicMs(20),
  cooldown: logicMs(30),
  cost: [],
  hits: [],
  targeting: { mode: 'primaryEnemy' },
  tags: ['spell'],
  interruptible: true,
};

/** 「掠夺」：快、轻（填充）。 */
export const GREED_PLUNDER: ActiveSkillDef = {
  id: 'greed-plunder',
  kind: 'activeSkill',
  nameKey: 'greed.plunder.name',
  descKey: 'greed.plunder.desc',
  icon: 'boss_sweep',
  abilities: [
    { kind: 'grant', on: 'castStart', target: { mode: 'self' }, buff: tel('greed-plunder', logicMs(8)) },
  ],
  castTime: logicMs(8),
  cooldown: logicMs(30),
  cost: [],
  hits: [
    {
      at: logicMs(8),
      effects: [{ kind: 'damage', damage: { base: S(30), canCrit: false, countsAsHit: true } }],
    },
  ],
  targeting: { mode: 'primaryEnemy' },
  tags: ['melee'],
  interruptible: true,
};

/** 「重利」：慢、重（可打断）。 */
export const GREED_USURY: ActiveSkillDef = {
  id: 'greed-usury',
  kind: 'activeSkill',
  nameKey: 'greed.usury.name',
  descKey: 'greed.usury.desc',
  icon: 'boss_cleave',
  abilities: [
    { kind: 'grant', on: 'castStart', target: { mode: 'self' }, buff: tel('greed-usury', logicMs(16)) },
  ],
  castTime: logicMs(16),
  cooldown: logicMs(80),
  cost: [],
  hits: [
    {
      at: logicMs(16),
      effects: [{ kind: 'damage', damage: { base: S(55), canCrit: false, countsAsHit: true } }],
    },
  ],
  targeting: { mode: 'primaryEnemy' },
  tags: ['melee'],
  interruptible: true,
};

/* ================================================================== *
 * 4. 定义
 * ================================================================== */

export const GREED_SKILLS: readonly SkillDef[] = [GREED_HOARD_SKILL, GREED_PLUNDER, GREED_USURY];

export const GREED_BUFFS: readonly BuffDef[] = [
  GREED_HOARD,
  GREED_WEAK_POINT_PASSIVE,
  GREED_WEAK_POINT,
  tel('greed-hoard', logicMs(20)),
  tel('greed-plunder', logicMs(8)),
  tel('greed-usury', logicMs(16)),
];

/**
 * 轮转：**顺序即优先级**（`rotation` 取第一个就绪的）。
 *
 * ⚠️ 顺序 = "**先把层数叠起来，再打人**"：
 *   敛财(3s) → 重利(8s) → 掠夺(3s)
 * 这不是"长 CD 在前"（重利比敛财长）—— 那是**有意的**：贪婪的题是
 * "层数在涨"，所以叠层必须**优先于**输出，否则它退化成一个普通 Boss。
 *
 * ⚠️ 代价（2026-10-15 记下来，改 CD 时看的）：CD 越短，"先叠层"这条
 * 优先级就越占满它的节奏 —— 3 秒 CD 下它**几乎一直在敛财**，
 * 重利只在读条之间的空档里出。这是用户要的取舍（"越拖越难"优先于输出）。
 *
 * ⚠️ 「弱点」**不在轮转里**：它是 `onTick` 被动（按时间、不看它出什么招）。
 */
export const GREED_BEHAVIORS: readonly Behavior[] = [
  { kind: 'enrage', atMs: 120_000, dmgMult: 2 },
  {
    kind: 'rotation',
    steps: [
      { skillId: 'greed-hoard' },
      { skillId: 'greed-usury' },
      { skillId: 'greed-plunder' },
    ],
  },
];

/**
 * ⚠️ 血量与另外几个 Boss **暂时相同**（420）—— 那个数是傲慢实测出来的，
 * 贪婪自己的值等实测之后填（它是"越拖越难"的 Boss，血量大概要**更低**
 * 才对：给玩家的时间窗更短）。
 */
export const GREED_HP = 420;

/**
 * **「弱点」被动**（`PassiveSkillDef`）—— 随机 3~5 秒给双方各挂一层易伤。
 *
 * ⚠️ 它以前只是个 `BuffDef`，而引擎**从不挂 `BossDef.buffs`** ⇒ 这条被动
 * 一直是**死的**（一整场都不出现）。换成被动技能之后 `makeBoss` 会挂它。
 */
export const GREED_WEAK_POINT_SKILL: PassiveSkillDef = {
  id: 'greed-weak-point',
  kind: 'passive',
  nameKey: 'greed.weakPoint.name',
  descKey: 'greed.weakPoint.desc',
  icon: 'greed_idle',
  abilities: [{ kind: 'grant', target: { mode: 'self' }, buff: GREED_WEAK_POINT_PASSIVE }],
  tags: [],
};

export const GREED_BOSS: BossDef = {
  id: 'greed',
  hp: GREED_HP,
  nameKey: 'greed.name',
  skills: GREED_SKILLS,
  buffs: GREED_BUFFS,
  /**
   * ⚠️ **整场都在的被动**（开战前就挂上）。与 `buffs` 分开的理由见
   * `BossDef.passives` —— 这里的每一条都是**引擎真的会挂**的。
   */
  passives: [GREED_WEAK_POINT_SKILL],
  behaviors: GREED_BEHAVIORS,
};
