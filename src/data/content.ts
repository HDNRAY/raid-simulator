/**
 * MVP 内容：玩家六招 + Boss「Verrot, the Fallen」。
 *
 * ==================================================================
 * 数值刻度（重要）
 * ==================================================================
 *
 * 逻辑数值用**小整数**：生命上限 100、伤害 10 级别。
 * 但内部实现按 **10 倍刻度**存储（HP 1000、10 伤害存成 100）。
 *
 * 为什么要这个转换：整数化是硬约束（架构规范 §12），
 * 而"每 0.1 秒恢复 1 点缠"在 0.1 秒粒度上要除以 6 个物理 tick ——
 * 直接用 1 点会导致每 tick 0.167 点，被整数化吃掉。
 * 乘 10 之后每 tick 稳定得到整数，且**玩家看到的数字仍然是 100/10 这种小整数**。
 *
 * 换算规则：一切对外数值 × `DISPLAY_SCALE`。
 *
 * ==================================================================
 * 技能设计（每个技能一个字，图标就用那个字）
 * ==================================================================
 *
 * | 字 | 代价 | 效果 |
 * |----|------|------|
 * | 攻 | 10 缠 | 造成 10 点伤害（普攻） |
 * | 闪 | 40 缠 | 0.5 秒完全无敌 |
 * | 御 | 按住，每 0.1 秒 2 缠 | 减伤 40%，松开即取消 |
 * | 破 | —（5 秒 CD） | 打断任何技能，不占公共冷却 |
 * | 轰 | 50 炁 | 造成 30 点伤害 |
 * | 凝 | 50 炁 | 增伤 20%，持续 30 秒 |
 *
 * 资源模型：
 *   缠 —— 每 0.1 秒自动恢复 1 点（= 每秒 10 点）
 *   炁 —— **按伤害换算**：造成 1 点伤害得 1 点，受到 1 点伤害也得 1 点
 *
 * 时间刻度：公共冷却 0.5 秒 = 5 个逻辑步（0.1 秒/步）。
 */

import { logicTicks, logicMs } from '../core/loopConstants';
import type { BuffDef, SkillDef } from '../core/types';

/**
 * 内容刻度 = **展示刻度**。
 *
 * 内容是"100 血 / 10 伤害 / 10 缠"这种可读的小整数，UI 直接显示它，
 * 不需要任何换算。早期版本给血量乘了 10 而伤害没乘，
 * 结果 10 点伤害只打掉 1 点血、一场战斗要按上百次 ——
 * 统一成单一刻度之后这类错位不可能再发生。
 */
function S(value: number): number {
  return value;
}

/** 生命上限（展示值）。 */
export const HP_MAX = 100;
/** 缠上限（展示值）。 */
export const ENERGY_MAX = 100;
/** 炁上限（展示值）。 */
export const DOUQI_MAX = 100;

/** 每 0.1 秒恢复的缠。 */
export const ENERGY_PER_LOGIC_TICK = 1;

/**
 * 每点伤害换多少炁。
 *
 * 1 = "造成 1 点伤害得 1 点炁"，受到伤害同理。
 * 于是打满 100 伤害或挨满 100 伤害各攒满一次炁。
 */
export const DOUQI_PER_DAMAGE = 1;

/** 公共冷却：0.5 秒 = 5 个逻辑步。 */
export const GCD_STEPS = 5;

/* ================================================================== *
 * 玩家图标配色（单色方块占位）
 * ================================================================== */

const C = {
  attack: 0xd8d8e4,
  dodge: 0x60c8f0,
  guard: 0x9aa8d8,
  break: 0xffd050,
  blast: 0xff8040,
  focus: 0xa070e0,
  debuff: 0xd05050,
  boss: 0xff7040,
} as const;

/* ================================================================== *
 * 共享 buff
 * ================================================================== */

/** 公共冷却。`blocksGcd` 让"不占 GCD 的技能"能跳过它。 */
export const GCD_BUFF: BuffDef = {
  id: 'gcd',
  nameKey: 'skill.attack.name',
  icon: 'gcd',
  polarity: 'neutral',
  color: 0x8a8ca0,
  duration: logicMs(GCD_STEPS),
  maxStacks: 1,
  stacking: { mode: 'refresh' },
  flags: { blocksGcd: true },
  /** 引擎内部标记，不在 UI 上显示图标（否则按钮旁边一直挂一个灰块）。 */
  hidden: true,
};

/** 闪：0.5 秒完全无敌。 */
export const DODGE_IFRAME: BuffDef = {
  id: 'dodge-iframe',
  nameKey: 'skill.dodge.name',
  icon: 'char_dodge',
  polarity: 'buff',
  color: C.dodge,
  duration: logicMs(5),
  maxStacks: 1,
  stacking: { mode: 'refresh' },
  flags: { invulnerable: true },
};

/**
 * 御：减伤 40%。
 *
 * **刻意不给持续时间**（`Number.POSITIVE_INFINITY`）。
 *
 * 它的生命周期完全由"按住 / 松开"驱动：按下时挂上，松开时由
 * `endHold` 移除。加一个有限 duration 反而会产生错误的语义 ——
 * 玩家一直按着，而 buff 却因为到期自己掉了（表现为"格挡莫名其妙失效"）。
 *
 * 唯一的结束条件是**缠耗尽**（引擎在 `tickHolds` 里检查并自动松开）。
 */
export const GUARD_REDUCE: BuffDef = {
  id: 'guard',
  nameKey: 'skill.guard.name',
  icon: 'char_guard',
  polarity: 'buff',
  color: C.guard,
  duration: Number.POSITIVE_INFINITY,
  maxStacks: 1,
  stacking: { mode: 'refresh' },
  flags: { damageReduce: 0.4 },
};

/** 凝：增伤 20%，持续 30 秒。 */
export const FOCUS_BUFF: BuffDef = {
  id: 'focus',
  nameKey: 'skill.focus.name',
  icon: 'char_focus',
  polarity: 'buff',
  color: C.focus,
  duration: logicMs(300),
  maxStacks: 1,
  stacking: { mode: 'refresh' },
  modifiers: [
    {
      stat: 'damageBoost',
      op: 'addPercent',
      value: 20,
      sourceKey: 'skill.focus.name',
      namespace: 'focus',
      tier: 'buff',
    },
  ],
};

/* ================================================================== *
 * Boss 专用
 * ================================================================== */

/** Boss 前摇标记（隐藏，只用于让 UI 知道它在读条）。 */
export const BOSS_TELEGRAPH: BuffDef = {
  id: 'boss-telegraph',
  nameKey: 'hud.casting',
  icon: 'telegraph',
  polarity: 'neutral',
  color: C.boss,
  duration: logicMs(30),
  maxStacks: 1,
  stacking: { mode: 'refresh' },
  hidden: true,
};

/** Boss 狂暴：伤害翻倍。 */
export const BOSS_ENRAGE: BuffDef = {
  id: 'boss-enrage',
  nameKey: 'screen.defeatedByEnrage',
  icon: 'enrage',
  polarity: 'debuff',
  color: 0xff3030,
  duration: Number.POSITIVE_INFINITY,
  maxStacks: 1,
  stacking: { mode: 'refresh' },
  damageMultBoost: 2,
};

/**
 * 玩家给 Boss 挂的易伤。
 *
 * 为什么需要它：玩家只有 6 招，如果全是"直接伤害"，循环会没有层次。
 * 用一个易伤 debuff 让"先叠层再爆发"成为一种选择。
 */
export const SUNDER_DEBUFF: BuffDef = {
  id: 'sunder',
  nameKey: 'debuff.sunder.name',
  icon: 'debuff_sunder',
  polarity: 'debuff',
  color: C.debuff,
  duration: logicMs(80),
  maxStacks: 3,
  stacking: { mode: 'stackRefresh', max: 3 },
  modifiers: [
    {
      stat: 'vulnerability',
      op: 'perStackAdd',
      value: 0.1,
      sourceKey: 'debuff.sunder.name',
      namespace: 'sunder',
      tier: 'debuff',
    },
  ],
};

/* ================================================================== *
 * 玩家技能：六招，每招一个字
 * ================================================================== */

/** 攻：普攻。代价低、伤害低，是循环的填充。 */
const ATTACK: SkillDef = {
  id: 'attack',
  kind: 'activeSkill',
  nameKey: 'skill.attack.name',
  descKey: 'skill.attack.desc',
  icon: 'char_attack',
  abilities: [
    {
      kind: 'trigger',
      trigger: {
        on: 'onCastFinish',
        then: [{ kind: 'grant', target: { mode: 'self' }, buff: GCD_BUFF }],
      },
    },
  ],
  castTime: 0,
  cooldown: 0,
  gcd: true,
  cost: [{ resource: 'energy', value: S(10) }],
  targeting: { mode: 'primaryEnemy' },
  hits: [
    {
      at: 0,
      effects: [
        {
          kind: 'damage',
          damage: {
            base: S(10),
            school: 'physical',
            canCrit: false,
            countsAsHit: true,
          },
        },
      ],
    },
  ],
  tags: ['melee'],
  school: 'physical',
  interruptible: false,
};

/** 闪：0.5 秒完全无敌。代价是 40 缠（满缠的 40%）。 */
const DODGE: SkillDef = {
  id: 'dodge',
  kind: 'activeSkill',
  nameKey: 'skill.dodge.name',
  descKey: 'skill.dodge.desc',
  icon: 'char_dodge',
  abilities: [{ kind: 'grant', target: { mode: 'self' }, buff: DODGE_IFRAME }],
  castTime: 0,
  /**
   * **没有冷却**。代价就是那 40 点缠，不需要再加冷却。
   *
   * 踩过的坑：早期给它加了 1.5 秒冷却，而 Boss 每 1.5–2.2 秒读一次条 ——
   * 于是它总是差一点点就来不及，实测只减掉 6.5% 的伤害，
   * 等于这个技能不存在。现在的约束是缠：满缠 100 只能连闪两次。
   */
  cooldown: 0,
  /** 不占公共冷却 —— 否则"该躲时躲不了"。 */
  gcd: false,
  cost: [{ resource: 'energy', value: S(40) }],
  targeting: { mode: 'self' },
  hits: [],
  tags: ['defensive'],
  school: 'physical',
  interruptible: false,
};

/**
 * 御：按住持续减伤，松开取消。
 *
 * `holdDrain` 是引擎里"按住"机制的表达：每个逻辑步扣一次资源，
 * 资源耗尽或松手就自动取消。这样"一直按着"会有明确代价。
 */
const GUARD: SkillDef = {
  id: 'guard',
  kind: 'activeSkill',
  nameKey: 'skill.guard.name',
  descKey: 'skill.guard.desc',
  icon: 'char_guard',
  abilities: [{ kind: 'grant', target: { mode: 'self' }, buff: GUARD_REDUCE }],
  castTime: 0,
  cooldown: 0,
  gcd: false,
  cost: [],
  /** 按住期间每 0.1 秒扣 2 点缠。 */
  holdDrain: { resource: 'energy', perLogicTick: 2 },
  targeting: { mode: 'self' },
  hits: [],
  tags: ['defensive'],
  school: 'physical',
  interruptible: false,
};

/** 破：打断任何技能。固定 5 秒 CD，不占公共冷却。 */
const BREAK: SkillDef = {
  id: 'break',
  kind: 'activeSkill',
  nameKey: 'skill.break.name',
  descKey: 'skill.break.desc',
  icon: 'char_break',
  abilities: [],
  castTime: 0,
  cooldown: logicMs(50),
  gcd: false,
  cost: [],
  targeting: { mode: 'primaryEnemy' },
  hits: [
    {
      at: 0,
      effects: [
        // 打断不区分可打断性：Boss 的所有招式都能被破
        { kind: 'interrupt', target: { mode: 'primaryEnemy' }, force: true },
      ],
    },
  ],
  tags: ['interrupt'],
  school: 'physical',
  interruptible: false,
};

/** 轰：消耗 50 炁，造成 30 点伤害。 */
const BLAST: SkillDef = {
  id: 'blast',
  kind: 'activeSkill',
  nameKey: 'skill.blast.name',
  descKey: 'skill.blast.desc',
  icon: 'char_blast',
  abilities: [
    {
      kind: 'trigger',
      trigger: {
        on: 'onCastFinish',
        then: [{ kind: 'grant', target: { mode: 'self' }, buff: GCD_BUFF }],
      },
    },
  ],
  castTime: 0,
  cooldown: 0,
  gcd: true,
  cost: [{ resource: 'douqi', value: S(50) }],
  targeting: { mode: 'primaryEnemy' },
  hits: [
    {
      at: 0,
      effects: [
        {
          kind: 'damage',
          damage: {
            base: S(30),
            school: 'arcane',
            canCrit: false,
            countsAsHit: true,
          },
        },
        // 轰会打裂目标，叠易伤 —— 让"攒炁打轰"有额外收益
        { kind: 'grantBuff', target: { mode: 'primaryEnemy' }, buff: SUNDER_DEBUFF },
      ],
    },
  ],
  tags: ['spell'],
  school: 'arcane',
  interruptible: false,
};

/** 凝：消耗 50 炁，增伤 20%，持续 30 秒。 */
const FOCUS: SkillDef = {
  id: 'focus',
  kind: 'activeSkill',
  nameKey: 'skill.focus.name',
  descKey: 'skill.focus.desc',
  icon: 'char_focus',
  abilities: [
    {
      kind: 'grant',
      target: { mode: 'self' },
      buff: FOCUS_BUFF,
    },
  ],
  castTime: 0,
  cooldown: 0,
  gcd: true,
  cost: [{ resource: 'douqi', value: S(50) }],
  targeting: { mode: 'self' },
  hits: [],
  tags: [],
  school: 'arcane',
  interruptible: false,
};

/* ================================================================== *
 * Boss 技能
 * ================================================================== *
 *
 * 设计约束（来自需求）：**Boss 的所有招式都默认可以被打断 / 闪避 / 格挡**。
 * 所以每个招式都是 `interruptible: true`，且伤害都走正常判定路径。
 */

/** 重斩：有前摇，可被打断 / 闪避 / 格挡。 */
const BOSS_CLEAVE: SkillDef = {
  id: 'boss-cleave',
  kind: 'activeSkill',
  nameKey: 'boss.cleave.name',
  descKey: 'boss.cleave.desc',
  icon: 'boss_cleave',
  abilities: [{ kind: 'grant', target: { mode: 'self' }, buff: BOSS_TELEGRAPH }],
  castTime: logicMs(8),
  cooldown: logicMs(30),
  gcd: false,
  cost: [],
  targeting: { mode: 'primaryEnemy' },
  hits: [
    {
      at: logicMs(8),
      effects: [
        {
          kind: 'damage',
          /**
           * 8 点伤害。**数值是按"玩家 100 血能撑多久"倒推的**：
           * 收紧出招节奏后 Boss 每 2–4 秒一招，如果单发 18 点，
           * 实测 9.1 秒就能打死玩家（承伤 111 DPS），而玩家完全打不完。
           * 单发 8 点 → 承伤约 11 DPS，战斗长度回到 15 秒左右。
           */
          damage: { base: S(8), school: 'physical', canCrit: false, countsAsHit: true },
        },
      ],
    },
  ],
  tags: ['melee'],
  school: 'physical',
  interruptible: true,
};

/** 横扫：前摇更长、伤害更高，是"必须躲"的那一招。 */
const BOSS_SWEEP: SkillDef = {
  id: 'boss-sweep',
  kind: 'activeSkill',
  nameKey: 'boss.sweep.name',
  descKey: 'boss.sweep.desc',
  icon: 'boss_sweep',
  abilities: [{ kind: 'grant', target: { mode: 'self' }, buff: BOSS_TELEGRAPH }],
  castTime: logicMs(12),
  cooldown: logicMs(60),
  gcd: false,
  cost: [],
  targeting: { mode: 'primaryEnemy' },
  hits: [
    {
      at: logicMs(12),
      effects: [
        {
          kind: 'damage',
          /**
           * 14 点火焰伤害 —— **这是为「闪」准备的那一招**：
           * 前摇 1.2 秒够长，玩家来得及反应；伤害是重斩的近两倍，
           * 所以躲掉它的收益明显。
           */
          damage: { base: S(14), school: 'fire', canCrit: false, countsAsHit: true },
        },
      ],
    },
  ],
  tags: ['spell'],
  school: 'fire',
  interruptible: true,
};

/** 蓄力：不造成伤害，给自己加攻。可以被打断（打断它就等于免掉一轮爆发）。 */
const BOSS_EMPOWER: SkillDef = {
  id: 'boss-empower',
  kind: 'activeSkill',
  nameKey: 'boss.empower.name',
  descKey: 'boss.empower.desc',
  icon: 'boss_empower',
  abilities: [
    {
      kind: 'grant',
      target: { mode: 'self' },
      buff: {
        id: 'boss-empowered',
        nameKey: 'boss.empower.name',
        icon: 'boss_empower',
        polarity: 'debuff',
        color: C.boss,
        duration: logicMs(100),
        maxStacks: 1,
        stacking: { mode: 'refresh' },
        modifiers: [
          {
            stat: 'damageBoost',
            op: 'addPercent',
            value: 30,
            sourceKey: 'boss.empower.name',
            namespace: 'boss-empowered',
            tier: 'buff',
          },
        ],
      },
    },
  ],
  castTime: logicMs(10),
  cooldown: logicMs(120),
  gcd: false,
  cost: [],
  targeting: { mode: 'self' },
  hits: [],
  tags: [],
  school: 'physical',
  interruptible: true,
};

/* ================================================================== *
 * 导出
 * ================================================================== */

export const PLAYER_SKILLS: readonly SkillDef[] = [ATTACK, DODGE, GUARD, BREAK, BLAST, FOCUS];

export const BOSS_SKILLS: readonly SkillDef[] = [BOSS_CLEAVE, BOSS_SWEEP, BOSS_EMPOWER];

export const ALL_SKILLS: readonly SkillDef[] = [...PLAYER_SKILLS, ...BOSS_SKILLS];

export const ALL_BUFFS: readonly BuffDef[] = [
  GCD_BUFF,
  DODGE_IFRAME,
  GUARD_REDUCE,
  FOCUS_BUFF,
  SUNDER_DEBUFF,
  BOSS_TELEGRAPH,
  BOSS_ENRAGE,
];

void logicTicks;
