/**
 * MVP 内容：玩家技能表 + Boss「Verrot, the Fallen」。
 *
 * 这个文件是"横向扩展内容"的**示范**：全部是数据，
 * 引擎（core/）一行都不用改。加一个新技能 = 往 `SKILLS` 里加一项。
 */

import type { BuffDef, SkillDef } from '../core/types';

/* ================================================================== *
 * 共享 buff
 * ================================================================== */

/** GCD：施放占 GCD 的技能后挂上；`gcd:false` 的技能不检查它。 */
export const GCD_BUFF: BuffDef = {
  id: 'gcd',
  nameKey: 'hud.casting',
  icon: 'gcd',
  polarity: 'neutral',
  duration: 300,
  maxStacks: 1,
  stacking: { mode: 'refresh' },
  flags: { blocksGcd: true },
};

/** 闪避的无敌窗口：300ms。判定层只看这个 flag。 */
export const DODGE_IFRAME: BuffDef = {
  id: 'dodge-iframe',
  nameKey: 'hud.dodged',
  icon: 'buff_dodge',
  polarity: 'buff',
  duration: 300,
  maxStacks: 1,
  stacking: { mode: 'refresh' },
  flags: { invulnerable: true },
  vfx: { onApply: 'flash_blue' },
};

/** 格挡：1.5 秒减伤 60%。精防就是"在 hit frame 前 0.2 秒内按下"额外叠一层。 */
export const GUARD_REDUCE: BuffDef = {
  id: 'guard',
  nameKey: 'hud.immune',
  icon: 'buff_guard',
  polarity: 'buff',
  duration: 1500,
  maxStacks: 1,
  stacking: { mode: 'refresh' },
  flags: { damageReduce: 0.6 },
  vfx: { aura: 'shield' },
};

/** 完美格挡：更短、更硬。由 guard 技能的附加 trigger 施加。 */
export const GUARD_PERFECT: BuffDef = {
  id: 'guard-perfect',
  nameKey: 'hud.immune',
  icon: 'buff_guard',
  polarity: 'buff',
  duration: 400,
  maxStacks: 1,
  stacking: { mode: 'refresh' },
  flags: { damageReduce: 0.95 },
  vfx: { aura: 'shield_bright' },
};

/**
 * 斩击产生的斗炁。
 *
 * 这里刻意**用 `modifier` 而不是新增一个 ability 类型** ——
 * "技能给资源"这种需求可以完全由"给一条资源回复修正"表达，
 * 不需要动引擎（这正是可扩展性的验证方式）。
 */
export const SLASH_FURY: BuffDef = {
  id: 'slash-douqi',
  nameKey: 'resource.douqi',
  icon: 'buff_douqi',
  polarity: 'buff',
  duration: 1000,
  maxStacks: 1,
  stacking: { mode: 'refresh' },
  modifiers: [
    {
      stat: 'douqiRegen',
      op: 'add',
      value: 12,
      sourceKey: 'resource.douqi',
      namespace: 'slash-douqi',
      tier: 'buff',
    },
  ],
};

/** 派生窗口：施放斩击后开启，让 arc 可用。 */
export const COMBO_WINDOW: BuffDef = {
  id: 'combo-window',
  nameKey: 'hud.combo',
  icon: 'buff_combo',
  polarity: 'buff',
  duration: 1500,
  maxStacks: 1,
  stacking: { mode: 'refresh' },
  flags: { comboWindow: ['arc'] },
};

/** 风行术：+20% 急速。 */
export const HASTE_BUFF: BuffDef = {
  id: 'haste-buff',
  nameKey: 'stat.haste',
  icon: 'buff_haste',
  polarity: 'buff',
  duration: 15_000,
  maxStacks: 1,
  stacking: { mode: 'refresh' },
  modifiers: [
    {
      stat: 'haste',
      op: 'add',
      value: 0.2,
      sourceKey: 'stat.haste',
      namespace: 'haste-buff',
      tier: 'buff',
    },
  ],
};

/** 割裂的流血 DoT：每 3 秒跳一次，持续 21 秒。 */
export const BLEED_DEBUFF: BuffDef = {
  id: 'bleed',
  nameKey: 'event.crit',
  icon: 'debuff_bleed',
  polarity: 'debuff',
  duration: 21_000,
  maxStacks: 3,
  stacking: { mode: 'stackRefresh', max: 3 },
  modifiers: [
    {
      // 每层让目标受到的物理伤害提高 4%（易伤）
      stat: 'vulnerability',
      op: 'perStackAdd',
      value: 0.04,
      sourceKey: 'stat.vulnerability',
      namespace: 'bleed',
      tier: 'debuff',
    },
  ],
};

/* ================================================================== *
 * Boss 专用 buff（前摇标记 / 狂暴）
 * ================================================================== */

/** 前摇标记：让 UI 知道 Boss 正在读条（也用于"打断"这类机制）。 */
export const BOSS_TELEGRAPH: BuffDef = {
  id: 'boss-telegraph',
  nameKey: 'hud.phase',
  icon: 'telegraph',
  polarity: 'neutral',
  duration: 2000,
  maxStacks: 1,
  stacking: { mode: 'refresh' },
  flags: { interruptImmune: true },
};

/** 狂暴：伤害 +100%。 */
export const BOSS_ENRAGE: BuffDef = {
  id: 'boss-enrage',
  nameKey: 'event.enrage',
  icon: 'buff_enrage',
  polarity: 'debuff',
  duration: Number.POSITIVE_INFINITY,
  maxStacks: 1,
  stacking: { mode: 'refresh' },
  damageMultBoost: 2,
};

/* ================================================================== *
 * 玩家技能
 * ================================================================== */

/**
 * 斩击：**循环的基石**。瞬发、CD 0、耗精力 8、产生 20 斗炁。
 *
 * 数值设计：GCD 是 300ms（18 tick），所以循环里任意两个技能之间
 * 至少隔 18 tick —— 这是"循环节奏"的硬约束。
 */
const SLASH: SkillDef = {
  id: 'slash',
  kind: 'activeSkill',
  nameKey: 'skill.slash.name',
  descKey: 'skill.slash.desc',
  icon: 'skill_slash',
  abilities: [
    {
      kind: 'trigger',
      trigger: {
        on: 'onCastFinish',
        then: [
          { kind: 'grant', target: { mode: 'self' }, buff: GCD_BUFF },
          { kind: 'grant', target: { mode: 'self' }, buff: COMBO_WINDOW },
          // 一次性产生斗炁（不是"每秒回复"—— 后者语义不同）
          { kind: 'resource', target: { mode: 'self' }, resource: 'douqi', delta: 20 },
          // 少量回能：让斩击可以接近 GCD 节奏持续输出，
          // 而不是被能量卡死（那样循环会变得毫无选择余地）
          { kind: 'resource', target: { mode: 'self' }, resource: 'energy', delta: 6 },
        ],
      },
    },
  ],
  castTime: 0,
  cooldown: 0,
  gcd: true,
  cost: [{ resource: 'energy', value: 8 }],
  targeting: { mode: 'primaryEnemy' },
  hits: [
    {
      at: 0,
      effects: [
        {
          kind: 'damage',
          damage: {
            // 目标：一发斩击约 600（暴击后更高），配合 GCD 形成 ~500 DPS 的基础节奏
            base: 240,
            scaling: [{ stat: 'strength', ratio: 3 }],
            school: 'physical',
            canCrit: true,
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

const HEAVY: SkillDef = {
  id: 'heavy',
  kind: 'activeSkill',
  nameKey: 'skill.heavy.name',
  descKey: 'skill.heavy.desc',
  icon: 'skill_heavy',
  abilities: [
    {
      kind: 'trigger',
      trigger: {
        on: 'onCastFinish',
        then: [{ kind: 'grant', target: { mode: 'self' }, buff: GCD_BUFF }],
      },
    },
  ],
  // 2 秒读条：可被打断，这是"要不要现在放大招"的取舍来源
  castTime: 2000,
  cooldown: 8000,
  gcd: true,
  cost: [{ resource: 'energy', value: 55 }],
  targeting: { mode: 'primaryEnemy' },
  hits: [
    {
      at: 2000,
      effects: [
        {
          kind: 'damage',
          damage: {
            // 8 秒 CD 的大招，约 2500
            base: 400,
            scaling: [{ stat: 'intelligence', ratio: 19 }],
            school: 'arcane',
            canCrit: true,
            countsAsHit: true,
          },
        },
      ],
    },
  ],
  tags: ['spell'],
  school: 'arcane',
  interruptible: true,
};

const REND: SkillDef = {
  id: 'rend',
  kind: 'activeSkill',
  nameKey: 'skill.rend.name',
  descKey: 'skill.rend.desc',
  icon: 'skill_rend',
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
  cost: [{ resource: 'douqi', value: 35 }],
  targeting: { mode: 'primaryEnemy' },
  hits: [
    {
      at: 0,
      effects: [
        {
          kind: 'damage',
          damage: {
            // 割裂本体伤害低，价值在易伤层数
            base: 60,
            scaling: [{ stat: 'strength', ratio: 1.2 }],
            school: 'physical',
            canCrit: true,
            countsAsHit: true,
          },
        },
        // 挂流血：每层提高目标承受的物理伤害
        { kind: 'grantBuff', target: { mode: 'primaryEnemy' }, buff: BLEED_DEBUFF },
      ],
    },
  ],
  tags: ['melee'],
  school: 'physical',
  interruptible: false,
};

const ARC: SkillDef = {
  id: 'arc',
  kind: 'activeSkill',
  nameKey: 'skill.arc.name',
  descKey: 'skill.arc.desc',
  icon: 'skill_arc',
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
  cost: [{ resource: 'douqi', value: 25 }],
  targeting: { mode: 'primaryEnemy' },
  hits: [
    {
      at: 0,
      effects: [
        {
          kind: 'damage',
          damage: {
            // 派生技：比斩击强，但需要先斩击开启窗口
            base: 380,
            scaling: [{ stat: 'strength', ratio: 5 }],
            school: 'physical',
            canCrit: true,
            countsAsHit: true,
          },
        },
      ],
    },
  ],
  tags: ['melee'],
  school: 'physical',
  interruptible: false,
  // 派生：只有在 combo-window 内可用。**这是"技能派生"的全部实现**
  requires: [{ kind: 'hasBuff', buffId: 'combo-window' }],
};

const DODGE: SkillDef = {
  id: 'dodge',
  kind: 'activeSkill',
  nameKey: 'skill.dodge.name',
  descKey: 'skill.dodge.desc',
  icon: 'skill_dodge',
  abilities: [{ kind: 'grant', target: { mode: 'self' }, buff: DODGE_IFRAME }],
  castTime: 0,
  cooldown: 0,
  // **不占 GCD**：所以闪避随时可用。这就是"能不能躲掉"的全部机制。
  gcd: false,
  cost: [{ resource: 'energy', value: 25 }],
  targeting: { mode: 'self' },
  hits: [],
  tags: ['defensive', 'movement'],
  school: 'physical',
  interruptible: false,
};

const GUARD: SkillDef = {
  id: 'guard',
  kind: 'activeSkill',
  nameKey: 'skill.guard.name',
  descKey: 'skill.guard.desc',
  icon: 'skill_guard',
  abilities: [{ kind: 'grant', target: { mode: 'self' }, buff: GUARD_REDUCE }],
  castTime: 0,
  cooldown: 0,
  gcd: false,
  cost: [{ resource: 'energy', value: 15 }],
  targeting: { mode: 'self' },
  hits: [],
  tags: ['defensive'],
  school: 'physical',
  interruptible: false,
};

const HASTE_SKILL: SkillDef = {
  id: 'haste',
  kind: 'activeSkill',
  nameKey: 'skill.haste.name',
  descKey: 'skill.haste.desc',
  icon: 'skill_haste',
  abilities: [
    {
      kind: 'grant',
      target: { mode: 'self' },
      buff: HASTE_BUFF,
    },
  ],
  castTime: 0,
  cooldown: 20_000,
  gcd: true,
  cost: [{ resource: 'energy', value: 30 }],
  targeting: { mode: 'self' },
  hits: [],
  tags: ['spell'],
  school: 'arcane',
  interruptible: false,
};

/* ================================================================== *
 * Boss 技能
 * ================================================================== */

/** 红弧：带前摇的扇形重击，**必须躲或挡**。 */
const CRIMSON_ARC: SkillDef = {
  id: 'crimson-arc',
  kind: 'activeSkill',
  nameKey: 'boss.crimsonArc.name',
  descKey: 'boss.crimsonArc.desc',
  icon: 'boss_arc',
  abilities: [{ kind: 'grant', target: { mode: 'self' }, buff: BOSS_TELEGRAPH }],
  castTime: 1200,
  cooldown: 9000,
  gcd: false,
  cost: [],
  targeting: { mode: 'primaryEnemy' },
  hits: [
    {
      at: 1200,
      avoidable: true,
      effects: [
        {
          kind: 'damage',
          damage: {
            // 一次红弧 200。Boss 的总承伤被调到约 80 DPS ——
            // 一场 2.5 分钟的战斗会打掉玩家约 12000（即全部血量），
            // 所以**必须**用闪避/格挡削掉一部分才能活到最后。
            base: 200,
            school: 'fire',
            canCrit: false,
            countsAsHit: true,
            avoidable: true,
          },
        },
      ],
    },
  ],
  tags: ['spell'],
  school: 'fire',
  interruptible: false,
};

/** 裂地三连：三段判定，每段都可以躲。 */
const TRIPLE_SLAM: SkillDef = {
  id: 'triple-slam',
  kind: 'activeSkill',
  nameKey: 'boss.tripleSlam.name',
  descKey: 'boss.tripleSlam.desc',
  icon: 'boss_slam',
  abilities: [{ kind: 'grant', target: { mode: 'self' }, buff: BOSS_TELEGRAPH }],
  castTime: 900,
  cooldown: 12_000,
  gcd: false,
  cost: [],
  targeting: { mode: 'primaryEnemy' },
  hits: [
    {
      at: 900,
      avoidable: true,
      effects: [
        { kind: 'damage', damage: { base: 70, school: 'physical', canCrit: false, countsAsHit: true, avoidable: true } },
      ],
    },
    {
      at: 1150,
      avoidable: true,
      effects: [
        { kind: 'damage', damage: { base: 70, school: 'physical', canCrit: false, countsAsHit: true, avoidable: true } },
      ],
    },
    {
      at: 1400,
      avoidable: true,
      effects: [
        { kind: 'damage', damage: { base: 110, school: 'physical', canCrit: false, countsAsHit: true, avoidable: true } },
      ],
    },
  ],
  tags: ['melee'],
  school: 'physical',
  interruptible: false,
};

/**
 * 腐蚀咏唱：**可打断**的读条。
 *
 * 这条是给玩家出考题的：你得留一个打断技能（或者用高伤害压制）。
 * `interruptible: true` 是引擎唯一需要的声明。
 */
const CORRUPTION: SkillDef = {
  id: 'corruption',
  kind: 'activeSkill',
  nameKey: 'boss.corruption.name',
  descKey: 'boss.corruption.desc',
  icon: 'boss_cast',
  abilities: [{ kind: 'grant', target: { mode: 'self' }, buff: BOSS_TELEGRAPH }],
  castTime: 3000,
  cooldown: 18_000,
  gcd: false,
  cost: [],
  targeting: { mode: 'primaryEnemy' },
  hits: [
    {
      at: 3000,
      avoidable: false,
      effects: [
        {
          kind: 'damage',
          damage: {
            // 不可闪避、可打断。不打断就是 450 点（约占玩家 4% 血），
            // 这是"留一手打断"的动机但不会一击致命。
            base: 450,
            school: 'arcane',
            canCrit: false,
            countsAsHit: true,
            avoidable: false,
          },
        },
      ],
    },
  ],
  tags: ['spell'],
  school: 'arcane',
  interruptible: true,
};

/** 蓄能：给自己加攻（Boss 的"呼吸"技能，给玩家喘息窗口）。 */
const EMPOWER: SkillDef = {
  id: 'empower',
  kind: 'activeSkill',
  nameKey: 'boss.empower.name',
  icon: 'boss_buff',
  abilities: [
    {
      kind: 'grant',
      target: { mode: 'self' },
      buff: {
        id: 'boss-empowered',
        nameKey: 'event.enrage',
        icon: 'buff_enrage',
        polarity: 'debuff',
        duration: 8000,
        maxStacks: 1,
        stacking: { mode: 'refresh' },
        modifiers: [
          {
            stat: 'damageBoost',
            op: 'addPercent',
            value: 30,
            sourceKey: 'event.enrage',
            namespace: 'boss-empowered',
            tier: 'buff',
          },
        ],
      },
    },
  ],
  castTime: 800,
  cooldown: 14_000,
  gcd: false,
  cost: [],
  targeting: { mode: 'self' },
  hits: [],
  tags: [],
  school: 'physical',
  interruptible: false,
};

/* ================================================================== *
 * 导出
 * ================================================================== */

export const PLAYER_SKILLS: readonly SkillDef[] = [
  SLASH,
  HEAVY,
  REND,
  ARC,
  DODGE,
  GUARD,
  HASTE_SKILL,
];

export const BOSS_SKILLS: readonly SkillDef[] = [CRIMSON_ARC, TRIPLE_SLAM, CORRUPTION, EMPOWER];

export const ALL_SKILLS: readonly SkillDef[] = [...PLAYER_SKILLS, ...BOSS_SKILLS];

/** 全部会被 id 引用的 buff（含内联在技能里的那些）。 */
export const ALL_BUFFS: readonly BuffDef[] = [
  GCD_BUFF,
  SLASH_FURY,
  DODGE_IFRAME,
  GUARD_REDUCE,
  GUARD_PERFECT,
  COMBO_WINDOW,
  HASTE_BUFF,
  BLEED_DEBUFF,
  BOSS_TELEGRAPH,
  BOSS_ENRAGE,
];
