/**
 * **「嫉妒」** —— 風魔神（镰刀怪）。
 *
 * 设计记录：`docs/specs/2026-10-12-seven-sins.md` §8。
 *
 * ==================================================================
 * 它的题型（与另外两个 Boss 的区别不是数值，是"逼你做什么决定"）
 * ==================================================================
 *
 * | Boss | 逼你决定的 |
 * |---|---|
 * | 傲慢 | "这一下发不发得起 30 炁去躲？"（防御资源本身） |
 * | 色欲 | "我现在该不该继续打？"（反伤 + 锁死惩罚贪刀） |
 * | **嫉妒** | "**我攒着的东西，还敢不敢留着？**" —— 因为它在**偷** |
 *
 * 所以它有两招**一点伤害都没有**（夺息偷炁、妒火偷血）：它们逼的不是
 * "躲不躲得开"，而是"**你来得及打断吗**"。
 *
 * ------------------------------------------------------------------
 * 四招与三条通道
 * ------------------------------------------------------------------
 *
 * | 招 | 读条 | 通道 | 正确应对 |
 * |---|---|---|---|
 * | 剜 | 0.6s | 快、轻（35） | 硬吃 —— 它是填充，不该占你的打断 |
 * | 殁 | 1.8s | **可打断** + 挂「见红」 | 打断（没断掉就等着挨更痛） |
 * | 夺息 | 1.0s | **偷炁**（你的炁 > 60 才触发） | ⚠️ **不可打断** —— 只能认 |
 * | 妒火 | 1.4s | **招牌：偷血**（CD 一到必出） | 打断它（否则你掉多少、它回多少） |
 *
 * ⚠️ **「夺息」刻意不可打断**（用户 2026-10-14 定）：读条只有 1 秒、
 * 而且有门槛 —— 也就是"你把一大管炁留着不打出去"才会被偷。这是它的
 * 反制方式（**别攒**），不是"按键打断"。所以它是这个 Boss 唯一一条
 * `interruptible: false` 的招，那是有意拿来做对比的。
 *
 * ⚠️ **「妒火」不排轮转**（`Behavior: onCooldown`）：它的节拍只由自己的
 * CD 决定，不能交给"抽签 / 顺序"—— 否则"CD 好了"与"轮到了"会混成两个
 * 条件，实际间隔变成一个说不清的数。
 */

import type { Behavior, BuffDef, Expr, SkillDef } from '../core/types';
import { logicMs } from '../core/loopConstants';
import { S } from './scale';
import { BOSS_ENRAGE, BOSS_TELEGRAPH } from './bossShared';

/* ================================================================== *
 * 1. 「见红」：殁留下的口子（受到的伤害 +30%）
 * ================================================================== */

/**
 * 被镰刀划中的那一记「见红」。
 *
 * ⚠️ 它**只放大"受到的伤害"**，不放大被偷走的血 —— `transfer` 刻意
 * **不走命中管线**（见 `EffectKind.transfer`）：搬运量是"按规则算出来的
 * 那个数"，不该随易伤漂。所以「见红」在这里的作用是让**殁之后的普通招**
 * 更痛，而不是让偷血更狠。
 *
 * ⚠️ 它挂在**玩家**身上（`grantBuff` 的默认目标是挨打者），所以
 * `damageTakenMult` 是加在玩家的修正树上 —— 那是这个属性第一次有真实
 * 消费者（以前它只在 `STAT_RULES` 里被声明）。
 */
export const JEALOUSY_MARK: BuffDef = {
  id: 'jealousy-mark',
  nameKey: 'jealousy.mark.name',
  icon: 'boss_cleave',
  polarity: 'debuff',
  color: 0x9b6bd6,
  duration: logicMs(40),
  maxStacks: 1,
  stacking: { mode: 'refresh' },
  modifiers: [{ stat: 'damageTakenMult', op: 'add', value: 0.3, sourceKey: 'jealousy.mark.name' }],
};

/* ================================================================== *
 * 2. 四招
 * ================================================================== */

/** 读条标记的统一写法（时长 = 自己的 `castTime`，见 `BOSS_TELEGRAPH` 的说明）。 */
function tel(skillId: string, ms: number): BuffDef {
  return { ...BOSS_TELEGRAPH, id: `boss-${skillId}-telegraph`, duration: ms };
}

/** 「剜」：快、轻、填节奏 —— 它存在的意义是"占住你的手"，不占你的打断。 */
export const JEALOUSY_REND: SkillDef = {
  id: 'jealousy-rend',
  kind: 'activeSkill',
  nameKey: 'jealousy.rend.name',
  descKey: 'jealousy.rend.desc',
  icon: 'boss_sweep',
  abilities: [
    { kind: 'grant', on: 'castStart', target: { mode: 'self' }, buff: tel('jealousy-rend', logicMs(6)) },
  ],
  castTime: logicMs(6),
  cooldown: logicMs(30),
  cost: [],
  hits: [
    {
      at: logicMs(6),
      effects: [{ kind: 'damage', damage: { base: S(35), canCrit: false, countsAsHit: true } }],
    },
  ],
  targeting: { mode: 'primaryEnemy' },
  tags: ['melee'],
  interruptible: true,
};

/** 「殁」：大回环。伤害最高、**可打断**，并给玩家挂「见红」。 */
export const JEALOUSY_REAP: SkillDef = {
  id: 'jealousy-reap',
  kind: 'activeSkill',
  nameKey: 'jealousy.reap.name',
  descKey: 'jealousy.reap.desc',
  icon: 'boss_cleave',
  abilities: [
    { kind: 'grant', on: 'castStart', target: { mode: 'self' }, buff: tel('jealousy-reap', logicMs(18)) },
  ],
  castTime: logicMs(18),
  cooldown: logicMs(80),
  cost: [],
  hits: [
    {
      at: logicMs(18),
      effects: [
        { kind: 'damage', damage: { base: S(70), canCrit: false, countsAsHit: true } },
        { kind: 'grantBuff', buff: JEALOUSY_MARK },
      ],
    },
  ],
  targeting: { mode: 'primaryEnemy' },
  tags: ['melee'],
  interruptible: true,
};

/**
 * 「夺息」：**偷炁**。0 伤害、**不可打断**。
 *
 * ==================================================================
 * 门槛与搬运量（用户 2026-10-14 定）
 * ==================================================================
 *
 * 你的**炁超过 60**（上限 100 ⇒ 60%）才触发；触发就**搬走当前值的一半**
 * （你有 80 → 掉 40）。
 *
 * ⚠️ 门槛写成效果的 `when`（不成立时**整条效果不结算**），而不是让它
 * "搬 0 点" —— 后者会在日志里留下一条"嫉妒偷了你 0 点炁"。
 *
 * ⚠️ `when` 里的 `who: 'target'` 指**被打的那一方**（玩家）。
 * 这里的 60 是**内部刻度**（`DISPLAY_SCALE = 1`，所以与展示值相同）。
 */
export const JEALOUSY_SNATCH: SkillDef = {
  id: 'jealousy-snatch',
  kind: 'activeSkill',
  nameKey: 'jealousy.snatch.name',
  descKey: 'jealousy.snatch.desc',
  icon: 'boss_empower',
  abilities: [
    {
      kind: 'grant',
      on: 'castStart',
      target: { mode: 'self' },
      buff: tel('jealousy-snatch', logicMs(10)),
    },
  ],
  castTime: logicMs(10),
  cooldown: logicMs(100),
  cost: [],
  hits: [
    {
      at: logicMs(10),
      effects: [
        {
          kind: 'transfer',
          when: { kind: 'resourceAbove', who: 'target', resource: 'energy', value: 60 },
          transfer: {
            pool: 'energy',
            amount: {
              e: 'mul',
              of: [
                { e: 'resource', who: 'target', resource: 'energy' },
                { e: 'const', value: 0.5 },
              ],
            },
          },
        },
      ],
    },
  ],
  targeting: { mode: 'primaryEnemy' },
  tags: ['spell'],
  /** ⚠️ 刻意不可打断（见文件头）：它的反制是"别攒炁"，不是按键。 */
  interruptible: false,
};

/**
 * 「妒火」：**招牌**。按"血量百分比之差的三分之一"搬运生命。
 *
 * ==================================================================
 * 算式（用户原话的例子）
 * ==================================================================
 *
 * ```
 * d  = 你的血量% − 我的血量%          （负数 = 0，我不动）
 * 偷 = d / 3                          （单位就是"点"）
 * 你扣「偷」点  →  我回**同样这个数**
 * ```
 *
 * 例：你 80% / 我 20% ⇒ `(80−20)/3 = 20` ⇒ 你扣 20 点，我回 20 点。
 *
 * ⚠️ 百分比差在 `PCT_DIFF` 里**乘 100** 变成"百分点"（`hpRatio` 是
 * 0..1 的小数）—— 少了这一步，偷取量会变成 `20/100 = 0.2` 点，表现为
 * "这一招好像没生效"，一个极难从表现反推的错误。
 *
 * ⚠️ `clamp(..., 0, …)` 是**必需的**：你比我高时才偷，否则算出来是负数
 * （负数会被 `transferResources` 当"这条不成立"跳过 —— 结果一样，
 * 但表达式本身会在别处读成一个负数，那是陷阱）。
 *
 * ⚠️ 用户 2026-10-14 明确："**Boss 回的是数值，不是百分比**" —— 所以
 * 一条 `transfer` 就够：它扣你**多少点**，就回它**多少点**（同一个数），
 * 这是 `transferResources` 里"先扣、按实际 delta 加"那个顺序保证的。
 */
const PCT_DIFF: Expr = {
  e: 'mul',
  of: [
    { e: 'add', of: [{ e: 'hpRatio', who: 'target' }, { e: 'neg', value: { e: 'hpRatio', who: 'self' } }] },
    { e: 'const', value: 100 },
  ],
};

const FLAME_AMOUNT: Expr = {
  e: 'clamp',
  value: { e: 'mul', of: [PCT_DIFF, { e: 'const', value: 1 / 3 }] },
  min: { e: 'const', value: 0 },
  max: { e: 'const', value: 1e9 },
};

/**
 * 「妒火」的搬运量 —— **导出**是为了让单测用它，而不是在测试里抄一份。
 *
 * ⚠️ 抄一份的后果：测试验的是"抄的那份对不对"，而线上那份改坏了它照样绿
 * （那正是这份算式最容易坏的地方 —— 少乘 100 会让偷取量变成 0.2 点，
 * 表现只是"这一招好像没生效"）。
 */
export const JEALOUSY_FLAME_AMOUNT: Expr = FLAME_AMOUNT;

export const JEALOUSY_FLAME: SkillDef = {
  id: 'jealousy-flame',
  kind: 'activeSkill',
  nameKey: 'jealousy.flame.name',
  descKey: 'jealousy.flame.desc',
  icon: 'boss_empower',
  abilities: [
    { kind: 'grant', on: 'castStart', target: { mode: 'self' }, buff: tel('jealousy-flame', logicMs(14)) },
  ],
  castTime: logicMs(14),
  /**
   * ⚠️ 这个 CD **就是它的节拍**（配合 `Behavior: onCooldown`）：一局
   * ~95 秒里出 3~4 次。28 秒不是拍脑袋 —— 一局偷的总量约 240~320 点，
   * 与傲慢那次「回补」126 点同一量级；缩到 14 秒会变成"一局偷 6 次、
   * 再也打不死它"。**实测定。**
   */
  cooldown: logicMs(280),
  cost: [],
  hits: [
    {
      at: logicMs(14),
      effects: [{ kind: 'transfer', transfer: { pool: 'hp', amount: FLAME_AMOUNT } }],
    },
  ],
  targeting: { mode: 'primaryEnemy' },
  tags: ['spell'],
  interruptible: true,
};

/* ================================================================== *
 * 3. 导出
 * ================================================================== */

export const JEALOUSY_SKILLS: readonly SkillDef[] = [
  JEALOUSY_REND,
  JEALOUSY_REAP,
  JEALOUSY_SNATCH,
  JEALOUSY_FLAME,
];

export const JEALOUSY_BUFFS: readonly BuffDef[] = [
  JEALOUSY_MARK,
  tel('jealousy-rend', logicMs(6)),
  tel('jealousy-reap', logicMs(18)),
  tel('jealousy-snatch', logicMs(10)),
  tel('jealousy-flame', logicMs(14)),
];

/**
 * 行为：**狂暴 + 招牌走 CD + 三招走轮转**。
 *
 * ⚠️ 轮转的顺序必须**长 CD 在前**（`rotation` 取第一个就绪的）：夺息
 * 10s → 殁 8s → 剜 3s。否则短 CD 的「剜」永远可用，会把另外两招饿死
 * ——「色欲」踩过这个坑（连着 8 条「轻吟」，「魅惑」一次都没出来）。
 *
 * ⚠️ **「妒火」不在轮转里**（`onCooldown`）：它不参与抽签，CD 一到就出，
 * 而且优先级排在轮转**之前** —— 所以它出现的那一次，轮转让位。
 */
export const JEALOUSY_BEHAVIORS: readonly Behavior[] = [
  { kind: 'enrage', atMs: 120_000, dmgMult: 2 },
  { kind: 'onCooldown', skillId: 'jealousy-flame' },
  {
    kind: 'rotation',
    steps: [
      { skillId: 'jealousy-snatch' },
      { skillId: 'jealousy-reap' },
      { skillId: 'jealousy-rend' },
    ],
  },
];

export { BOSS_ENRAGE };
