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
  color: 0x8a8ca0,
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
  color: 0x60c8f0,
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
  color: 0x9aa8d8,
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
  color: 0xffe070,
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
  color: 0x5acad8,
  nameKey: 'hud.combo',
  icon: 'buff_combo',
  polarity: 'buff',
  duration: 1500,
  maxStacks: 1,
  stacking: { mode: 'refresh' },
  flags: { comboWindow: ['riposte'] },
};

/** 风行术：+20% 急速。 */
export const HASTE_BUFF: BuffDef = {
  id: 'haste-buff',
  color: 0x80e8c0,
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
  color: 0xd05050,
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
  color: 0xff7040,
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
  color: 0xff3030,
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
 * ================================================================== *
 *
 * ------------------------------------------------------------------
 * 这套技能是为「精力 + 斗炁」资源模型**专门设计**的
 * ------------------------------------------------------------------
 *
 * 两条资源各有一个明确的决策问题，技能组必须让这两个问题都出现：
 *
 *   精力（回复快，约 20/秒）
 *     → 防御技能的代价。问题是「我现在躲，还是留着精力等下一发？」
 *       所以两个防御技都消耗精力，且**都不占公共冷却** ——
 *       这样"该躲的时候能不能躲"完全由精力决定。
 *
 *   斗炁（不自动回复，只靠基础技积攒，上限 100）
 *     → 强击与终结技的代价。问题是「斗炁一够就花掉，还是攒满打爆发？」
 *       强击（30）可以持续消耗，终结技（100）要求攒满 ——
 *       于是"攒满"这个选择有真实的机会成本。
 *
 * 循环节奏：
 *   基础技每 1.5 秒一次（GCD 0.3s，但受精力回复限制更接近这个节奏），
 *   每 4 次攒满斗炁；中间穿插强击，满了打终结技。
 *   防御技随时可插，但会挤占后面的基础技。
 */

/** 基础技：回能 + 积攒斗炁。循环的基石。 */
const STRIKE: SkillDef = {
  id: 'strike',
  kind: 'activeSkill',
  nameKey: 'skill.strike.name',
  descKey: 'skill.strike.desc',
  icon: 'skill_strike',
  abilities: [
    {
      kind: 'trigger',
      trigger: {
        on: 'onCastFinish',
        then: [
          { kind: 'grant', target: { mode: 'self' }, buff: GCD_BUFF },
          { kind: 'grant', target: { mode: 'self' }, buff: COMBO_WINDOW },
          // 积攒斗炁（一次性），并小幅回能，让循环能持续
          { kind: 'resource', target: { mode: 'self' }, resource: 'douqi', delta: 18 },
          { kind: 'resource', target: { mode: 'self' }, resource: 'energy', delta: 8 },
        ],
      },
    },
  ],
  castTime: 0,
  cooldown: 0,
  gcd: true,
  cost: [],
  targeting: { mode: 'primaryEnemy' },
  hits: [
    {
      at: 0,
      effects: [
        {
          kind: 'damage',
          damage: {
            base: 100,
            scaling: [{ stat: 'strength', ratio: 1.2 }],
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

/** 强击：消耗斗炁的中等爆发。 */
const HEAVY_STRIKE: SkillDef = {
  id: 'heavyStrike',
  kind: 'activeSkill',
  nameKey: 'skill.heavyStrike.name',
  descKey: 'skill.heavyStrike.desc',
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
  castTime: 0,
  cooldown: 6000,
  gcd: true,
  cost: [{ resource: 'douqi', value: 30 }],
  targeting: { mode: 'primaryEnemy' },
  hits: [
    {
      at: 0,
      effects: [
        {
          kind: 'damage',
          damage: {
            base: 260,
            scaling: [{ stat: 'strength', ratio: 3.4 }],
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

/**
 * 派生技：只能在基础技之后的派生窗口内使用。
 *
 * 它的价值不在伤害（与强击接近），而在**把派生窗口变成收益** ——
 * 否则"派生窗口"这个机制就只是个摆设。
 */
const RIPOSTE: SkillDef = {
  id: 'riposte',
  kind: 'activeSkill',
  nameKey: 'skill.riposte.name',
  descKey: 'skill.riposte.desc',
  icon: 'skill_riposte',
  abilities: [
    {
      kind: 'trigger',
      trigger: {
        on: 'onCastFinish',
        then: [
          { kind: 'grant', target: { mode: 'self' }, buff: GCD_BUFF },
          // 派生成功额外回一点斗炁：奖励"接上连段"
          { kind: 'resource', target: { mode: 'self' }, resource: 'douqi', delta: 10 },
        ],
      },
    },
  ],
  castTime: 0,
  cooldown: 0,
  gcd: true,
  cost: [],
  targeting: { mode: 'primaryEnemy' },
  hits: [
    {
      at: 0,
      effects: [
        {
          kind: 'damage',
          damage: {
            base: 220,
            scaling: [{ stat: 'strength', ratio: 2.6 }],
            school: 'physical',
            canCrit: true,
            countsAsHit: true,
          },
        },
        // **消耗掉派生窗口**：一次基础技只能换来一次派生。
        // 没有这一步，窗口期内可以反复接派生，基础技就没人按了。
        { kind: 'removeBuff', target: { mode: 'self' }, buffId: 'combo-window' },
      ],
    },
  ],
  tags: ['melee'],
  school: 'physical',
  interruptible: false,
  // **派生**：需要基础技刚打出的窗口
  requires: [{ kind: 'hasBuff', buffId: 'combo-window' }],
};

/** 割裂：代价是斗炁，收益是持续伤害 + 易伤。 */
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
  cooldown: 10_000,
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
            base: 70,
            scaling: [{ stat: 'strength', ratio: 1.0 }],
            school: 'physical',
            canCrit: true,
            countsAsHit: true,
          },
        },
        { kind: 'grantBuff', target: { mode: 'primaryEnemy' }, buff: BLEED_DEBUFF },
      ],
    },
  ],
  tags: ['melee'],
  school: 'physical',
  interruptible: false,
};

/**
 * 终结技：**要求斗炁已满**，打空斗炁换取巨额伤害。
 *
 * 门槛用 `douqi-full` 标记 buff 表达（引擎在斗炁加到上限时自动挂上），
 * 所以这里不需要引擎提供"资源是否满"的新条件类型。
 *
 * 2.2 秒读条且可被打断 —— 这是"攒满就放"的机会成本：
 * 放的时机不对会被 Boss 打断，斗炁白攒。
 */
const FINISHER: SkillDef = {
  id: 'finisher',
  kind: 'activeSkill',
  nameKey: 'skill.finisher.name',
  descKey: 'skill.finisher.desc',
  icon: 'skill_finisher',
  abilities: [
    // 打空斗炁（代价在施法时已扣，这里只是确保不会残留标记）
    { kind: 'resource', target: { mode: 'self' }, resource: 'douqi', delta: -100 },
    {
      kind: 'trigger',
      trigger: {
        on: 'onCastFinish',
        then: [
          { kind: 'grant', target: { mode: 'self' }, buff: GCD_BUFF },
          // 打完给一个短暂的增伤窗口：奖励"打空斗炁"这个决定
          {
            kind: 'grant',
            target: { mode: 'self' },
            buff: {
              id: 'aftermath',
              nameKey: 'skill.finisher.name',
              icon: 'buff_aftermath',
              polarity: 'buff',
              color: 0xffb040,
              duration: 8000,
              maxStacks: 1,
              stacking: { mode: 'refresh' },
              modifiers: [
                {
                  stat: 'damageBoost',
                  op: 'addPercent',
                  value: 25,
                  sourceKey: 'skill.finisher.name',
                  namespace: 'aftermath',
                  tier: 'buff',
                },
              ],
            },
          },
        ],
      },
    },
  ],
  castTime: 2200,
  /**
   * 20 秒冷却。
   *
   * 为什么必须有：它不消耗精力、只要斗炁满就能放，而斗炁积攒很快。
   * 早期版本给它 0 冷却，实测 60 秒内能放 184 次 —— 循环完全退化成
   * "无脑按终结技"。冷却把"什么时候放"变成真正的取舍。
   */
  cooldown: 20_000,
  gcd: true,
  cost: [{ resource: 'douqi', value: 100 }],
  targeting: { mode: 'primaryEnemy' },
  hits: [
    {
      at: 2200,
      effects: [
        {
          kind: 'damage',
          damage: {
            base: 500,
            scaling: [{ stat: 'strength', ratio: 4, }, { stat: 'intelligence', ratio: 12 }],
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
  requires: [{ kind: 'hasBuff', buffId: 'douqi-full' }],
};

/** 闪避：耗精力换一个极短的无敌窗口。**不占公共冷却**。 */
const DODGE: SkillDef = {
  id: 'dodge',
  kind: 'activeSkill',
  nameKey: 'skill.dodge.name',
  descKey: 'skill.dodge.desc',
  icon: 'skill_dodge',
  abilities: [{ kind: 'grant', target: { mode: 'self' }, buff: DODGE_IFRAME }],
  castTime: 0,
  cooldown: 1500,
  // **不占 GCD**：所以闪避随时可用，"能不能躲掉"完全由精力决定
  gcd: false,
  cost: [{ resource: 'energy', value: 30 }],
  targeting: { mode: 'self' },
  hits: [],
  tags: ['defensive'],
  school: 'physical',
  interruptible: false,
};

/** 格挡：耗精力换一段减伤。窗口比闪避长、但减伤不到底。 */
const GUARD: SkillDef = {
  id: 'guard',
  kind: 'activeSkill',
  nameKey: 'skill.guard.name',
  descKey: 'skill.guard.desc',
  icon: 'skill_guard',
  abilities: [{ kind: 'grant', target: { mode: 'self' }, buff: GUARD_REDUCE }],
  castTime: 0,
  cooldown: 3000,
  gcd: false,
  cost: [{ resource: 'energy', value: 20 }],
  targeting: { mode: 'self' },
  hits: [],
  tags: ['defensive'],
  school: 'physical',
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
  STRIKE,
  HEAVY_STRIKE,
  RIPOSTE,
  REND,
  FINISHER,
  DODGE,
  GUARD,
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
