/**
 * **「暴怒」** —— 七宗罪的最后一个。
 *
 * 设计稿：`docs/specs/2026-10-12-seven-sins.md` §9（2026-10-14 定稿）。
 *
 * ==================================================================
 * 它的题型
 * ==================================================================
 *
 * 需求原文：**根据受伤次数**，**减少技能 cd**，**增加伤害**。
 *
 * ⚠️ 但那句话只是"数值压力"，当不了一个 Boss 的题型。定稿时的关键洞察是：
 *
 * | Boss | 一句话 |
 * |---|---|
 * | **懒惰** | **你不打它，它就变强**（「怠惰」层数）|
 * | **暴怒** | **你打它，它就变强**（「怒火」层数）|
 *
 * 两场连在一起教的是同一件事：**节奏**。所以它的题型是
 *
 * > "**我现在还要不要继续打？**"
 *
 * —— 停手它会**退火**（每 2 秒 −1 层），但你也停了输出；打则逼近临界点。
 *
 * ==================================================================
 * 机制（逐条落实 §9.2）
 * ==================================================================
 *
 * ```
 * 「怒火」：挨一次打 +1 层（上限 8）；2 秒不挨打 **−1 层**（不是清零）
 *   每层：急速 +0.05（⇒ 读条与 CD −5%）+ 伤害 **×1.08**（逐层相乘）
 *        ⚠️ 8 层 = 急速 +0.40，**压在 haste 的 0.5 夹紧之下**
 *        （贪婪踩过"层数一多就被钳掉"的坑，这里靠上限避开）
 * 满 8 层 → 「暴怒」形态（**霸体** + 大幅增伤，5 秒）→ **层数清零**、可再攒
 * 「泄怒」：伤害**按当前层数加成**（层数越高越痛）
 * ```
 *
 * ⚠️ **为什么要有「泄怒」**：没有它，层数只是"它的事"，玩家感觉不到。
 * 有了它，"层数高" = "下一次泄怒会很痛" ⇒ **停手退火才成为一个真实选项**。
 * 所以它同时是"层数的账单"和"玩家的决定"。
 */

import type { ActiveSkillDef, Behavior, BuffDef, PassiveSkillDef, SkillDef } from '../core/types';
import type { BossDef } from './bossDefs';
import { logicMs } from '../core/loopConstants';
import { S } from './scale';
import { BOSS_TELEGRAPH } from './bossShared';

/** 读条标记（时长 = 自己的 `castTime`）。 */
function tel(skillId: string, ms: number): BuffDef {
  return { ...BOSS_TELEGRAPH, id: `boss-${skillId}-telegraph`, duration: ms };
}

/** 怒火上限（用户定稿：8 —— 8 × 0.05 = 0.40，正好在急速夹紧之下）。 */
export const WRATH_MAX_RAGE = 8;

/** 每 2 秒不挨打退一层（用户："2 秒不挨打 −1 层"）。 */
const DECAY_MS = logicMs(20);

/* ================================================================== *
 * 1. 「怒火」：那条层数（计数器就是 buff 层数）
 * ================================================================== */

/**
 * **「暴怒」形态**（满 8 层时结算的那一条）。
 *
 * ⚠️ **霸体**（`interruptImmune`）是有意的：它暴走的那 5 秒**打不断** ——
 * 那是"你把它的怒火攒满了"的代价。⚠️ 而这也是「破」类打断技的
 * "别浪费"时刻（读条上会出现「霸体」提示，见 `viewAdapter`）。
 */
export const WRATH_FURY: BuffDef = {
  id: 'wrath-fury',
  nameKey: 'wrath.fury.name',
  icon: 'char_attack',
  polarity: 'buff',
  color: 0xd03a3a,
  duration: logicMs(50),
  maxStacks: 1,
  stacking: { mode: 'refresh' },
  flags: { interruptImmune: true },
  /** 大幅增伤：×1.5（与每层那 ×1.08 相乘）。 */
  modifiers: [{ stat: 'damageBoost', op: 'addPercent', value: 50, sourceKey: 'wrath.fury.name' }],
};

/**
 * 「怒火」——**计数就是这条 buff 的层数**（用户："buff 累计 3 层自己触发别的"
 * 那条纪律；这里是 8 层）。
 *
 * ⚠️ `modifiers` 里的 `haste +0.05` **按层展开**（2026-10-14 接的那条：
 * `core/combat/stats.ts`），所以 8 层真的给 +0.40 —— 而不是"只给一份"。
 * ⚠️ 伤害走 `damageMultBoost: 1.08`：那个字段是**逐层相乘**（1.08^8 ≈ ×1.85）。
 */
export const WRATH_RAGE: BuffDef = {
  id: 'wrath-rage',
  nameKey: 'wrath.rage.name',
  icon: 'char_attack',
  polarity: 'buff',
  color: 0xe08a2a,
  /** ⚠️ 时长要长于退火间隔（2 秒），否则"层数会因为到期而整条消失"。 */
  duration: logicMs(600),
  maxStacks: WRATH_MAX_RAGE,
  stacking: { mode: 'stackRefresh', max: WRATH_MAX_RAGE },
  modifiers: [
    { stat: 'haste', op: 'add', value: 0.05, sourceKey: 'wrath.rage.name' },
    /** 每层 +8%（2026-10-22 从 `damageMultBoost: 1.08`（逐层相乘）改成加算）。 */
    { stat: 'damageBoost', op: 'add', value: 8, sourceKey: 'wrath.rage.name' },
  ],
  triggers: [
    {
      /**
       * **满 8 层 → 形态 + 清零**（可再攒）。
       *
       * ⚠️ 用 `onBuffApplied`（每次"挂 / 加层"都醒一次）+ `buffStacks` 条件
       * —— 与「暴食」的「饕餮」是同一条路（那里已验过）。
       * ⚠️ "清零"用的是 `removeBuff`（缺省 = 整条摘掉）。
       */
      on: 'onBuffApplied',
      when: { kind: 'buffStacks', who: 'self', buffId: 'wrath-rage', minStacks: WRATH_MAX_RAGE },
      then: [
        { kind: 'grant', target: { mode: 'self' }, buff: WRATH_FURY },
        /**
         * ⚠️ **二阶段不再清零**（`wrath-phase2` 在 ⇒ 这一条跳过）：
         * 「暴怒形态」照发，但怒火留在 8 层。
         */
        {
          kind: 'removeBuff',
          target: { mode: 'self' },
          buffId: 'wrath-rage',
          when: { kind: 'notHasBuff', who: 'self', buffId: 'wrath-phase2' },
        },
      ],
    },
  ],
};

/**
 * 「刚挨打」标记（2 秒）—— 与「懒惰」的那条同一种用法，方向相反：
 * 这里用它表达"**最近 2 秒挨过打 ⇒ 不退火**"。
 */
export const WRATH_RECENT_HIT: BuffDef = {
  id: 'wrath-recent-hit',
  nameKey: 'wrath.name',
  icon: 'char_attack',
  polarity: 'buff',
  hidden: true,
  duration: DECAY_MS,
  maxStacks: 2,
  stacking: { mode: 'refresh' },
};

/**
 * **攒层 + 退火**的常驻被动（由 `WRATH_RAGE_SKILL` 授予）。
 *
 * ```
 * 挨打   → 挂「刚挨打」(2 秒) + 怒火 +1 层
 * 每 2 秒 → 若**没有**「刚挨打」⇒ 怒火 **−1 层**（不是清零）
 * ```
 *
 * ⚠️ "−1 层"用的是 `removeBuff` 的 **`stacks: 1`** —— 那是 2026-10-14
 * 为这个 Boss 新加的能力（原来只能整条摘掉）。
 */
export const WRATH_RAGE_PASSIVE: BuffDef = {
  id: 'wrath-rage-passive',
  nameKey: 'wrath.name',
  icon: 'char_attack',
  polarity: 'buff',
  hidden: true,
  duration: Number.POSITIVE_INFINITY,
  maxStacks: 1,
  stacking: { mode: 'refresh' },
  triggers: [
    {
      on: 'onHitTaken',
      then: [
        { kind: 'grant', target: { mode: 'self' }, buff: WRATH_RECENT_HIT },
        { kind: 'grant', target: { mode: 'self' }, buff: WRATH_RAGE },
      ],
    },
    {
      on: 'onTick',
      cooldownMs: DECAY_MS,
      /** ⚠️ 只在"最近没挨打"时退火 —— 判据就是那条会过期的标记。 */
      when: { kind: 'notHasBuff', who: 'self', buffId: 'wrath-recent-hit' },
      then: [{ kind: 'removeBuff', target: { mode: 'self' }, buffId: 'wrath-rage', stacks: 1 }],
    },
  ],
};

/**
 * **「怒火」被动技能**（`PassiveSkillDef`）—— 整场都在的攒层器。
 *
 * ⚠️ 被动技能是"整场都在"的那个外壳（`BossDef.passives`）；
 * 真正的层数住在 `WRATH_RAGE` 那条 buff 里。
 */
export const WRATH_RAGE_SKILL: PassiveSkillDef = {
  id: 'wrath-rage-source',
  kind: 'passive',
  nameKey: 'wrath.rage.name',
  descKey: 'wrath.rage.desc',
  icon: 'char_attack',
  abilities: [{ kind: 'grant', target: { mode: 'self' }, buff: WRATH_RAGE_PASSIVE }],
  tags: [],
};

/* ================================================================== *
 * 2. 三招
 * ================================================================== */

/** 「怒击」：普通小技能（快、伤害低）。 */
export const WRATH_SMASH: ActiveSkillDef = {
  id: 'wrath-smash',
  kind: 'activeSkill',
  nameKey: 'wrath.smash.name',
  descKey: 'wrath.smash.desc',
  icon: 'boss_sweep',
  abilities: [
    { kind: 'grant', on: 'castStart', target: { mode: 'self' }, buff: tel('wrath-smash', logicMs(8)) },
  ],
  castTime: logicMs(8),
  cooldown: logicMs(30),
  cost: [],
  hits: [
    {
      at: logicMs(8),
      effects: [{ kind: 'damage', damage: { base: S(20), canCrit: false, countsAsHit: true } }],
    },
  ],
  targeting: { mode: 'primaryEnemy' },
  tags: ['melee'],
  interruptible: true,
};

/** 「横扫」：慢、伤害高。 */
export const WRATH_SWEEP: ActiveSkillDef = {
  id: 'wrath-sweep',
  kind: 'activeSkill',
  nameKey: 'wrath.sweep.name',
  descKey: 'wrath.sweep.desc',
  icon: 'boss_cleave',
  abilities: [
    { kind: 'grant', on: 'castStart', target: { mode: 'self' }, buff: tel('wrath-sweep', logicMs(14)) },
  ],
  castTime: logicMs(14),
  cooldown: logicMs(80),
  cost: [],
  hits: [
    {
      at: logicMs(14),
      effects: [{ kind: 'damage', damage: { base: S(42), canCrit: false, countsAsHit: true } }],
    },
  ],
  targeting: { mode: 'primaryEnemy' },
  tags: ['melee'],
  interruptible: true,
};

/** 「泄怒」每层的加成（`base + 层数 × 这个数`）。 */
export const WRATH_VENT_PER_STACK = 12;

/**
 * 「泄怒」——**层数的账单**：伤害按它当前的「怒火」层数加成。
 *
 * ⚠️ 用 `Expr: 'buffStacks'` 直接读层数（引擎已实现）：
 * `base 30 + 层数 × 12` ⇒ 0 层 30、8 层 **126**。
 * ⚠️ 它**不消耗**层数（设计稿没要求消耗）—— 「暴怒」形态才清层。
 * ⚠️ 轮转里给它挂了"层数 ≥ 4 才出"的条件（见 `WRATH_BEHAVIORS`）：
 * 于是"层数高"这件事**一定会在屏幕上兑现**，玩家学得到。
 */
export const WRATH_VENT: ActiveSkillDef = {
  id: 'wrath-vent',
  kind: 'activeSkill',
  nameKey: 'wrath.vent.name',
  descKey: 'wrath.vent.desc',
  icon: 'boss_empower',
  abilities: [
    { kind: 'grant', on: 'castStart', target: { mode: 'self' }, buff: tel('wrath-vent', logicMs(18)) },
  ],
  castTime: logicMs(18),
  cooldown: logicMs(120),
  cost: [],
  hits: [
    {
      at: logicMs(18),
      effects: [
        { kind: 'damage', damage: { base: S(30), canCrit: false, countsAsHit: true } },
        {
          kind: 'damage',
          damage: {
            base: {
              e: 'mul',
              of: [
                { e: 'buffStacks', who: 'self', buffId: 'wrath-rage' },
                { e: 'const', value: WRATH_VENT_PER_STACK },
              ],
            },
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
 * 3. 定义
 * ================================================================== */

export const WRATH_SKILLS: readonly SkillDef[] = [WRATH_SMASH, WRATH_SWEEP, WRATH_VENT];

/**
 * **暴怒·二阶段「暴走」**：**「怒火」不再清零**（2026-10-20 恢复原设计）。
 *
 * 一阶段：满 8 层 → 发「暴怒形态」+ **把怒火清零**（可再攒）。
 * 二阶段：**清零那一条被跳过** ⇒ 层数停在 8（×1.85 伤害 + `haste 0.4`）。
 *
 * ⚠️ 这条曾经不敢做：`haste > 0` 会让 `hits[].at === castTime` 的招式
 * **永远结算不到** ⇒ 常驻 8 层 = 常驻 0.4 急速 = **打不出伤害的木桩** ✗。
 * 2026-10-20 那个 bug 修好了，于是这条设计**终于**能按原样成立。
 */
export const WRATH_PHASE2: BuffDef = {
  id: 'wrath-phase2',
  nameKey: 'phase2.wrath.name',
  icon: 'char_attack',
  polarity: 'buff',
  color: 0xe08a2a,
  hidden: true,
  duration: Number.POSITIVE_INFINITY,
  maxStacks: 1,
  stacking: { mode: 'refresh' },
};

export const WRATH_BUFFS: readonly BuffDef[] = [
  WRATH_PHASE2,
  WRATH_RAGE,
  WRATH_FURY,
  WRATH_RAGE_PASSIVE,
  WRATH_RECENT_HIT,
  tel('wrath-smash', logicMs(8)),
  tel('wrath-sweep', logicMs(14)),
  tel('wrath-vent', logicMs(18)),
];

/**
 * 行为：**泄怒只在"有火"的时候出**（层数 ≥ 4）。
 *
 * ⚠️ 那条 `when`（`buffStacks`）是这套机制**能被玩家学会**的关键：
 * 如果泄怒随时可能来，玩家只会觉得"它偶尔很痛"；只在层数高时来，
 * 玩家才会把"我打得太狠了"和"它要还手了"连起来。
 */
export const WRATH_BEHAVIORS: readonly Behavior[] = [
  /**
   * **「恶魔低语·二阶段」的开关**（2026-10-20）：血量 ≤40% 时进入「暴走」。
   * 能力守在 `PHASE2_GATE`（这一层抽到二阶段的隐藏标记）后面。
   */
  {
    kind: 'onHpBelow',
    ratio: 0.4,
    then: [
      { kind: 'grant', target: { mode: 'self' }, buff: WRATH_PHASE2, when: { kind: 'hasBuff', who: 'self', buffId: 'whisper-phase2' } },
    ],
  },
  { kind: 'enrage', atMs: 120_000, dmgMult: 2 },
  {
    kind: 'rotation',
    steps: [
      { skillId: 'wrath-vent', when: { kind: 'buffStacks', who: 'self', buffId: 'wrath-rage', minStacks: 4 } },
    ],
  },
];

/** ⚠️ 血量与其它几个 Boss 一样是 420（**还没标定**，等实测）。 */
export const WRATH_HP = 420;

export const WRATH_BOSS: BossDef = {
  id: 'wrath',
  hp: WRATH_HP,
  nameKey: 'wrath.name',
  skills: WRATH_SKILLS,
  buffs: WRATH_BUFFS,
  /** ⚠️ **整场都在的被动**（开战前就挂上）—— 它是那个攒层器。 */
  passives: [WRATH_RAGE_SKILL],
  behaviors: WRATH_BEHAVIORS,
};
