/**
 * **「懒惰」** —— 機甲隊長。
 *
 * 设计记录：`docs/specs/2026-10-12-seven-sins.md` §10。
 *
 * ==================================================================
 * 它的题型
 * ==================================================================
 *
 * | Boss | 逼你决定的 |
 * |---|---|
 * | 傲慢 | "这一下发不发得起 30 炁去躲？" |
 * | 色欲 | "我现在该不该继续打？" |
 * | 嫉妒 | "我攒着的东西，还敢不敢留着？" |
 * | 贪婪 | "它的层数还在涨 —— 现在不爆发，等什么时候？" |
 * | **懒惰** | "**它不动，我也不动 —— 但它的血在回。你打算什么时候动手？**" |
 *
 * ==================================================================
 * 三条互锁的机制（用户 2026-10-14 的设计）
 * ==================================================================
 *
 * 1. **开局只有半血**（上限 500 / 开局 250）—— 正好喂饱它自己的第 2 条
 * 2. **「重压」按它自己损失的血量加成**（`missingResourceRatio`）：
 *    它越残越痛 ⇒ 你**不能**先把它打残再慢慢磨
 * 3. **「怠惰」被动**：每秒回 1 点，而且**每 3 秒没挨打就 +1 层**
 *    （n 层 = n+1 点/秒）—— **挨一次打清零**
 *
 * 三条合起来的意思：**它是一个"你不打它就回血、你打它又更危险"的 Boss** ✓
 * 所以"什么时候动手"是真决定 —— 这正是「懒惰」该有的题。
 *
 * ==================================================================
 * ⚠️ 关于"回血一直翻倍"（用户原话）
 * ==================================================================
 *
 * 用户明确："回血 不挨打 **就一直翻倍**" —— 所以「怠惰」的层数**没有设计
 * 上限**（每 3 秒一层）。⚠️ 这迟早会失控（20 秒 = 7 层 = 8 点/秒），
 * 所以 `maxStacks` 留了一个**很大的数**（不是"无限"这个类型表达不了的东西），
 * 而**真正的平衡旋钮是那个 `maxStacks`**：要压它就把这个数调到 3~5。
 * **实测定。**
 */

import type { ActiveSkillDef, Behavior, BuffDef, Expr, PassiveSkillDef, SkillDef } from '../core/types';
import type { BossDef } from './bossDefs';
import { logicMs } from '../core/loopConstants';
import { S } from './scale';
import { BOSS_TELEGRAPH } from './bossShared';

/** 读条标记（时长 = 自己的 `castTime`）。 */
function tel(skillId: string, ms: number): BuffDef {
  return { ...BOSS_TELEGRAPH, id: `boss-${skillId}-telegraph`, duration: ms };
}

/* ================================================================== *
 * 1. 「睡眠」：玩家被锁死 N 秒，**期间 Boss 不攻击**
 * ================================================================== */

/**
 * 「睡眠」—— 玩家**完全不能行动** 10 秒。
 *
 * ==================================================================
 * 它和「眩晕」是同一个机制（`flags.actionLock`），但语义不同
 * ==================================================================
 *
 * | | 眩晕（色欲） | 睡眠（懒惰） |
 * |---|---|---|
 * | 效果 | 3 秒不能动 + 打断施法 | 10 秒不能动 + 打断施法 |
 * | **Boss 在干什么** | **照常出招**（最痛的就是那 3 秒） | **它也不攻击** |
 * | 玩家的出路 | 无（只能挨） | ⚠️ **按方向键 / 点屏幕，每次减 1 秒**（见下） |
 *
 * ⚠️ **"睡眠期间它不攻击"** 用**行为数组**表达（`LAZY_BEHAVIORS` 的
 * `when: notHasBuff(lazy-sleep)`），不是用 buff 去禁它的招 ——
 * 这样"它不出招"与"它被控住"是两件事，不会互相污染。
 *
 * ⚠️ **"按方向键减 1 秒"是下一步**（要新加 `EffectKind: 'reduceBuff'` +
 * 输入接线）。今天这一招是**纯粹 10 秒锁死** —— 所以它先只用于"看形状"。
 */
export const LAZY_SLEEP: BuffDef = {
  id: 'lazy-sleep',
  nameKey: 'lazy.sleep.name',
  icon: 'lazy_sleep',
  polarity: 'debuff',
  color: 0x6b7fd6,
  duration: logicMs(100),
  maxStacks: 1,
  stacking: { mode: 'refresh' },
  /**
   * `actionLock` = 不能行动；**另两个旗标是"出路"**：
   *   - `movesWhileLocked`：**仍然可以按技能**（任意技能，不挑 tag）
   *   - `sleepReduceMs`：每按一次，这个 buff 的剩余时长 **−3 秒**
   *
   * ⚠️ 合起来就是用户定的那条："按技能 = 挣扎：**扣资源** + **睡眠减 3 秒**，
   * 但技能本身**不生效**（无伤害 / 无 buff / 不进 CD）" —— 所以按 4 次就醒
   * （10 秒 / 3 秒），而每次都要**付那个技能的代价**（拿资源换时间）。
   */
  flags: {
    actionLock: true,
    movesWhileLocked: true,
    sleepReduceMs: 3000,
  },
};

/* ================================================================== *
 * 2. 「怠惰」：挨打清零的层数（每层 +1 点/秒回血）
 * ================================================================== */

/**
 * 「怠惰」——**每 3 秒没挨打 +1 层，挨打清零**。
 *
 * | 层数 | 总回血 |
 * |---|---|
 * | 0（刚挨过打） | 1 点/秒（基础） |
 * | 1 | 2 点/秒 |
 * | 3 | 4 点/秒 |
 * | 7 | 8 点/秒 |
 *
 * ⚠️ **上限 9 层**（用户 2026-10-14："回血先按最大 9 层"）——
 * "不挨打就一直涨"到 9 层封顶（最狠 10 点/秒）。**那个数就是平衡旋钮。**
 *
 * ⚠️ 基础那 1 点/秒**不在这里**：它走「怠惰」被动技能的 `modifier`（见 `LAZY_IDLE_SKILL`）。
 * 分开的理由：一个是"永远在"，一个是"不挨打才涨"，而 `modifiers` 的层数
 * 展开是**按 buff 实例**算的 —— 合成一个会让"0 层"变成"没有回血"。
 */
export const LAZY_IDLE: BuffDef = {
  id: 'lazy-idle',
  nameKey: 'lazy.idle.name',
  icon: 'lazy_idle',
  polarity: 'buff',
  color: 0x8ad0a0,
  /**
   * ⚠️ **时长必须长于触发间隔**（触发每 3 秒一次，这里给 60 秒）。
   *
   * 踩过的坑（实测）：`stack` 模式的语义是"**加层但不刷新时长**" ——
   * 所以时长一到，那个实例**整个消失、层数也一起没了**。给 6 秒时，
   * 层数会涨到 2 就掉回 1（周期 6 秒），看起来像"回血涨不上去"。
   *
   * 修法是**两个一起**：时长给够（60 秒，远超 3 秒的间隔）+ 用
   * `stackRefresh`（每次加层顺带刷新时长）—— 于是在"没挨打"的那段时间里，
   * 它**永远不会因为到期而清零**，只有挨打才会（那是 `onHitTaken` 那条）。
   */
  duration: logicMs(600),
  maxStacks: 9,
  stacking: { mode: 'stackRefresh', max: 9 },
  /**
   * ⚠️ **每层 ×2**（`op: 'mult'`，不是 `add`）—— 回血 = **2^层数**：
   * 1 层 = 2 点/秒、9 层 = **512 点/秒**（用户 2026-10-14 定的）。
   *
   * ⚠️ **"基础 1 点/秒"不在这里**：`modifiers` 是**按层展开**的，把基础那份
   * 写进来会变成 `1 × 层数`（1 层 2、2 层 8…）而不是 `2^层数`（1 层 2、2 层 4）。
   * 基础那一份由「怠惰」**被动技能的 `modifier`** 提供（见 `LAZY_IDLE_SKILL`）。
   */
  modifiers: [{ stat: 'hpRegen', op: 'mult', value: 2, sourceKey: 'lazy.idle.name' }],
};

/**
 * 「刚挨打」——一条**只活 3 秒**的隐藏标记（每次挨打刷新）。
 *
 * ⚠️ 它的存在是为了表达"**最近 3 秒没挨打**"这件事：引擎里没有"距离上次
 * 挨打多久"这个量（`onHitTaken` 只说"刚被打了"），所以用"一条会过期的标记"
 * 反过来说 —— 与「怠惰」的 `onTick` 那条配对。
 */
export const LAZY_RECENT_HIT: BuffDef = {
  id: 'lazy-recent-hit',
  nameKey: 'lazy.name',
  icon: 'lazy_idle',
  polarity: 'buff',
  hidden: true,
  duration: logicMs(30),
  maxStacks: 1,
  stacking: { mode: 'refresh' },
};

/**
 * 「怠惰」的两条触发器 —— 这是"不挨打就一直翻倍"的**全部实现**。
 *
 * ==================================================================
 * 为什么是两条（而不是一条带条件的）
 * ==================================================================
 *
 * 引擎里**没有"距离上次挨打多久"这个东西**（`onHitTaken` 只告诉你
 * "刚被打了"，不告诉你"已经 3 秒没被打"）。所以用**两个相反的动作**拼：
 *
 *   ① `onTick`（CD **3 秒**）→ **加一层**（没被打的每个 3 秒都涨）
 *   ② `onHitTaken`          → **移除**（挨打清零）
 *
 * ⚠️ ①的 CD 就是用户在说的那个"**3 秒**"；②没有 CD —— 挨几下都只清零
 * 一次（本来就清零了）。
 *
 * ⚠️ 它**不需要** `hasBuff` 之类的条件：涨与清是两条互相独立的路，
 * 谁最后发生谁说了算（这正是"挨打清零"的语义）。
 */
export const LAZY_IDLE_PASSIVE: BuffDef = {
  id: 'lazy-idle-passive',
  nameKey: 'lazy.name',
  icon: 'lazy_idle',
  polarity: 'buff',
  hidden: true,
  duration: Number.POSITIVE_INFINITY,
  maxStacks: 1,
  stacking: { mode: 'refresh' },
  triggers: [
    {
      /**
       * ⚠️ **只在不挨打时涨**（用户："3 秒不挨打变 2 层"）。
       *
       * 判据是"身上**没有**「刚挨打」" —— 那个标记由下面那条 `onHitTaken`
       * 挂上、3 秒后自然过期。所以这一条 tick 到点时，只有"最近 3 秒真的
       * 没挨打"才会加层 ✓（CD 就是那个"3 秒"）。
       */
      on: 'onTick',
      cooldownMs: logicMs(30),
      when: { kind: 'notHasBuff', who: 'self', buffId: 'lazy-recent-hit' },
      then: [{ kind: 'grant', target: { mode: 'self' }, buff: LAZY_IDLE }],
    },
    {
      /**
       * **挨打 → 回到 1 层**（用户："挨打回到1层"）。
       *
       * ⚠️ 顺序：先挂「刚挨打」（把 tick 那条堵住），再 **removeBuff**
       * （把所有层清掉）**然后 grant 一层** —— 于是结果正好是**1 层**，
       * 而不是 0 层（`removeBuff` 是整条摘掉）。
       */
      on: 'onHitTaken',
      then: [
        { kind: 'grant', target: { mode: 'self' }, buff: LAZY_RECENT_HIT },
        { kind: 'removeBuff', target: { mode: 'self' }, buffId: LAZY_IDLE.id },
        { kind: 'grant', target: { mode: 'self' }, buff: LAZY_IDLE },
      ],
    },
  ],
};

/* ================================================================== *
 * 3. 技能
 * ================================================================== */

const HP_LOSS: Expr = { e: 'missingResourceRatio', who: 'self', resource: 'hp' };

/**
 * ⚠️ **两招共用的那个"损失比"**（0..1）：`missingResourceRatio` 就是
 * "已损失的血量百分比"。用户 2026-10-14："**2 个技能都吃损失血量，
 * 而且是吃百分比**，比如少了 50% 血 伤害加成就是 50%"。
 *
 * ⚠️ 它必须**声明在两招之前**：TS 的 `const` 有 TDZ，写在后面会让
 * 第一招在模块求值时读到未初始化（这个坑今天已经踩过一次）。
 */
/** 「钝击」：普通小技能。 */
export const LAZY_BLUNT: ActiveSkillDef = {
  id: 'lazy-blunt',
  kind: 'activeSkill',
  nameKey: 'lazy.blunt.name',
  descKey: 'lazy.blunt.desc',
  icon: 'boss_sweep',
  abilities: [
    { kind: 'grant', on: 'castStart', target: { mode: 'self' }, buff: tel('lazy-blunt', logicMs(10)) },
  ],
  castTime: logicMs(10),
  /** ⚠️ 用户 2026-10-14："懒惰的 2 个技能 **略微减少 cd**"（4.0s → **3.5s**）。 */
  cooldown: logicMs(35),
  cost: [],
  hits: [
    {
      at: logicMs(10),
      effects: [
        /**
         * ⚠️ **两段式**：第一段保持**数字** base（`{damage}` 模板参数照旧
         * 取得到 —— `descParams.firstDamageOf` 只认数字），第二段是加成。
         *
         * 用户 2026-10-14："**2 个技能都吃损失血量，而且是吃百分比**，
         * 比如少了 50% 血 伤害加成就是 50%"。⇒ 加成 = `base × 损失比`
         * （`missingResourceRatio` 就是那个 0..1 的百分比）。
         */
        { kind: 'damage', damage: { base: S(18), canCrit: false, countsAsHit: true } },
        {
          kind: 'damage',
          damage: {
            base: { e: 'mul', of: [{ e: 'const', value: S(18) }, HP_LOSS] },
            canCrit: false,
            countsAsHit: true,
          },
        },
      ],
    },
  ],
  targeting: { mode: 'primaryEnemy' },
  tags: ['melee'],
  interruptible: true,
};

/**
 * 「重压」：**本身伤害不高，但按它自己损失的血量加成**。
 *
 * ==================================================================
 * 算式
 * ==================================================================
 *
 * ```
 * 伤害 = 基础 24 + 损失血量比例 × 40
 * ```
 *
 * - 它满血（损失 0）→ **24**（比「钝击」只高一点）
 * - 半血（损失 50%）→ 44
 * - 残血（损失 90%）→ 60
 *
 * ⚠️ **这一条与「怠惰」是一对**：它越残 → 回血越快（层数涨）**而且**
 * 打你越痛 ⇒ **你必须在它残血时尽快结束**，不能"打残了再等"。
 *
 * ⚠️ 系数用 `missingResourceRatio`（现成的 `Expr`）：它读的是**它自己**
 * 损失了多少比例，不依赖玩家的任何状态。
 */

export const LAZY_PRESSURE: ActiveSkillDef = {
  id: 'lazy-pressure',
  kind: 'activeSkill',
  nameKey: 'lazy.pressure.name',
  descKey: 'lazy.pressure.desc',
  icon: 'boss_cleave',
  abilities: [
    { kind: 'grant', on: 'castStart', target: { mode: 'self' }, buff: tel('lazy-pressure', logicMs(16)) },
  ],
  castTime: logicMs(16),
  /** ⚠️ 用户 2026-10-14："**略微减少 cd**"（8.0s → **7.0s**）。 */
  cooldown: logicMs(70),
  cost: [],
  hits: [
    {
      at: logicMs(16),
      effects: [
        {
          kind: 'damage',
          damage: { base: S(24), canCrit: false, countsAsHit: true },
        },
        /**
         * ⚠️ **加成段**（用户 2026-10-14 改的规则）：
         * "**2 个技能都吃损失血量，而且是吃百分比**，比如少了 50% 血
         * 伤害加成就是 50%"。
         *
         * ⇒ 加成 = `base × 损失比`，于是总伤害 = `base × (1 + 损失比)`
         * （少了 50% 血 ⇒ 24 + 12 = **36**）。
         *
         * ⚠️ **旧的"×40 封顶"已删**：那是"按损失血量"的另一种口径
         * （绝对加成、有上限），与新规则不是一回事。
         *
         * ⚠️ 为什么拆两段而不是写进同一个 `DamageSpec`：`DamageSpec.scaling`
         * 是 `stat × ratio` 的**线性**项，而这里要的是"读一个表达式"；
         * 拆两段是**最窄**的写法（不动 `DamageSpec` 的形状）。第一段保持
         * 数字 base 也是有意的（见钝击那段的说明）。
         */
        {
          kind: 'damage',
          damage: {
            base: { e: 'mul', of: [{ e: 'const', value: S(24) }, HP_LOSS] },
            canCrit: false,
            countsAsHit: true,
          },
        },
      ],
    },
  ],
  targeting: { mode: 'primaryEnemy' },
  tags: ['melee'],
  interruptible: true,
};

/* ================================================================== *
 * 4. 定义
 * ================================================================== */

/**
 * **「睡眠」= 一条真正的技能**（用户："**睡眠技** 10 秒"）。
 *
 * ⚠️ 它以前被做成了"一条被动每 12 秒挂个 debuff"—— 那是错的：
 * 技能才有前摇（**看得见**）、才进轮转、才谈得上"可不可以打断"。
 *
 * ⚠️ 读条 **1.2 秒**、冷却 **12 秒**（> 睡眠的 10 秒 ⇒ **一次睡眠结束之后
 * 才可能再来一次**，不会"醒了立刻又睡"）。
 * ⚠️ 命中效果是 `grantBuff`（**默认作用在挨打者身上** ⇒ 挂到玩家），
 * 不是"伤害" —— 这一招不造成伤害。
 */
export const LAZY_SLEEP_SKILL: ActiveSkillDef = {
  id: 'lazy-sleep',
  kind: 'activeSkill',
  nameKey: 'lazy.sleep.name',
  descKey: 'lazy.sleep.desc',
  icon: 'lazy_sleep',
  abilities: [
    { kind: 'grant', on: 'castStart', target: { mode: 'self' }, buff: tel('lazy-sleep', logicMs(12)) },
  ],
  castTime: logicMs(12),
  cooldown: logicMs(120),
  cost: [],
  hits: [
    {
      at: logicMs(12),
      effects: [{ kind: 'grantBuff', buff: LAZY_SLEEP }],
    },
  ],
  targeting: { mode: 'primaryEnemy' },
  tags: [],
  interruptible: true,
};

export const LAZY_SKILLS: readonly SkillDef[] = [LAZY_BLUNT, LAZY_PRESSURE, LAZY_SLEEP_SKILL];

export const LAZY_BUFFS: readonly BuffDef[] = [
  LAZY_SLEEP,
  LAZY_IDLE,
  LAZY_IDLE_PASSIVE,
  LAZY_RECENT_HIT,
  tel('lazy-blunt', logicMs(10)),
  tel('lazy-pressure', logicMs(16)),
  tel('lazy-sleep', logicMs(12)),
];

/**
 * 行为：**睡眠期间它不出招**。
 *
 * ⚠️ `when: { kind: 'notHasBuff', who: 'target', buffId: 'lazy-sleep' }`
 * —— `who: 'target'` 在行为条件里指**玩家**（`core/ai` 的 `evalAiCondition`），
 * 所以"玩家在睡 ⇒ 这一条不成立 ⇒ 它这一 tick 不出招" ✓
 *
 * ⚠️ 两条伤害技也要各自带这个条件：`rotation` 是"取第一个成立的"，
 * 只在第一条上写会让它跳到下一条去打人。
 */
const ASLEEP = { kind: 'notHasBuff', who: 'target', buffId: 'lazy-sleep' } as const;

export const LAZY_BEHAVIORS: readonly Behavior[] = [
  { kind: 'enrage', atMs: 120_000, dmgMult: 2 },
  {
    kind: 'rotation',
    steps: [
      /**
       * ⚠️ **「睡眠」要摆在最前面**：轮转是"取第一个成立的"，而它是这一套
       * 里唯一带 12 秒冷却的那个 —— 冷却一好就该轮到它。
       * ⚠️ 它**不带** `when: ASLEEP`：那一招正是用来把玩家睡着的。
       */
      { skillId: 'lazy-sleep' },
      { skillId: 'lazy-pressure', when: ASLEEP },
      { skillId: 'lazy-blunt', when: ASLEEP },
    ],
  },
];

/**
 * ⚠️ **上限 500 / 开局 250**（用户 2026-10-14 指定）。
 *
 * 开局半血是**有意的**：它一上来就喂饱自己那条"按损失血量加成"。
 * 所以「懒惰」的战斗形状是"**一开场它就比平时痛**"，而随着你打它，
 * 它一边变痛一边回血更快 —— 逼你**集中爆发**而不是慢慢磨。
 */
export const LAZY_HP = 500;
export const LAZY_START_HP = 250;

/**
 * **「怠惰」= 一条被动技能**（用户："基础回血不是单独的被动，**就是怠惰本身**"）。
 *
 * 它是**一条**东西，里面两半：
 *   ① `modifier` → 基础 **1 点/秒**（**不随层数走** —— 所以不能写进那条
 *      buff 的 `modifiers`，那个会按层展开）
 *   ② `grant`    → 那条记层数的「怠惰」buff（每层 ×2 ⇒ 回血 `2^层数`）
 */
export const LAZY_IDLE_SKILL: PassiveSkillDef = {
  id: 'lazy-idle',
  kind: 'passive',
  nameKey: 'lazy.idle.name',
  descKey: 'lazy.idle.desc',
  icon: 'lazy_idle',
  abilities: [
    {
      kind: 'modifier',
      modifier: { stat: 'hpRegen', op: 'add', value: 1, sourceKey: 'lazy.idle.name' },
    },
    { kind: 'grant', target: { mode: 'self' }, buff: LAZY_IDLE_PASSIVE },
  ],
  tags: [],
};

export const LAZY_BOSS: BossDef = {
  id: 'sloth',
  hp: LAZY_HP,
  startHp: LAZY_START_HP,
  nameKey: 'sloth.name',
  skills: LAZY_SKILLS,
  buffs: LAZY_BUFFS,
  /**
   * ⚠️ **整场都在的被动**（开战前就挂上）。与 `buffs` 分开的理由见
   * `BossDef.passives` —— 这里的每一条都是**引擎真的会挂**的。
   */
  passives: [LAZY_IDLE_SKILL],
  behaviors: LAZY_BEHAVIORS,
};
