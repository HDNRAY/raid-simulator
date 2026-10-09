import { describe, expect, it } from 'vitest';
import type {
  Ability,
  BattleState,
  BuffDef,
  Condition,
  EncounterDef,
  EquipmentEntity,
  Expr,
  GameEntityInstance,
  HitDef,
  Loadout,
  SkillDef,
  StatKey,
  StatModifier,
} from '../../src/core/types';

/**
 * M1-1 的**真正验收**。
 *
 * `tsc` 通过只说明类型"内部自洽"，不说明它"能表达真实内容"。
 * 所以这里用类型标注构造数据模型规范里承诺的那些东西：
 *   - 熵之钟的三个效果（被动属性 / 派生增伤 / 暴击触发）
 *   - 判定窗口（闪避 / 格挡）与派生窗口
 *   - 不占 GCD 的技能
 *   - 一个完整的 BattleState（必须可结构化克隆）
 *
 * 这个文件编译不过 = 数据模型有洞，**在写实现之前**就该发现。
 * 运行时的断言很轻（只验证这些字面量确实能构造出来），
 * 重量全在编译期。
 */

/* ------------------------------------------------------------------ *
 * 熵之钟：规范 §9 的完整走查
 * ------------------------------------------------------------------ */

/** 效果 2 的命名空间：让"值不是写死的"成为可能 */
const POTENTIAL_NS = 'entropy-clock.potential';

/** 效果 2：根据智力增伤 */
const potentialExpr: Expr = {
  e: 'mul',
  of: [
    { e: 'const', value: 0.1 },
    { e: 'stat', who: 'self', stat: 'intelligence' },
  ],
};

/** 效果 3 的 buff：值引用命名空间，因此**动态重算** */
const surgeBuff: BuffDef = {
  id: 'entropy-surge',
  nameKey: 'hud.combo',
  icon: 'buff_surge',
  polarity: 'buff',
  duration: 10_000,
  maxStacks: 1,
  stacking: { mode: 'refresh' },
  modifiers: [
    {
      stat: 'damageBoost',
      op: 'addPercent',
      value: { e: 'contrib', namespace: POTENTIAL_NS },
      sourceKey: 'stat.damageBoost',
      tier: 'buff',
    },
  ],
};

const entropyClockAbilities: readonly Ability[] = [
  // 效果 1：被动 +2 属性
  {
    kind: 'modifier',
    modifier: {
      stat: 'intelligence',
      op: 'add',
      value: 2,
      sourceKey: 'resource.mp',
      tier: 'item',
    },
  },
  {
    kind: 'modifier',
    modifier: {
      stat: 'spirit',
      op: 'add',
      value: 2,
      sourceKey: 'resource.mp',
      tier: 'item',
    },
  },
  // 效果 2：派生增伤（带命名空间，可被引用）
  {
    kind: 'derived',
    modifier: {
      stat: 'damageBoost',
      op: 'addPercent',
      sourceKey: 'stat.damageBoost',
      namespace: POTENTIAL_NS,
      tier: 'item',
    },
    value: potentialExpr,
  },
  // 效果 3：暴击后授予 surge buff
  {
    kind: 'trigger',
    trigger: {
      on: 'onCritDealt',
      filter: { by: 'self' },
      then: [{ kind: 'grant', buff: surgeBuff, target: { mode: 'self' } }],
    },
  },
];

const entropyClock: EquipmentEntity = {
  id: 'entropy-clock',
  kind: 'equipment',
  nameKey: 'stat.intelligence',
  icon: 'relic_entropy',
  slot: 'relic',
  rarity: 'legendary',
  multiEquip: true,
  abilities: entropyClockAbilities,
};

/* ------------------------------------------------------------------ *
 * 判定窗口与派生：全部用 buff 表达，零新机制
 * ------------------------------------------------------------------ */

/** 闪避：300ms 无敌 */
const dodgeBuff: BuffDef = {
  id: 'dodge-iframe',
  nameKey: 'hud.dodged',
  icon: 'buff_dodge',
  polarity: 'buff',
  duration: 300,
  maxStacks: 1,
  stacking: { mode: 'refresh' },
  flags: { invulnerable: true },
};

/** 格挡：1.5 秒减伤 60% */
const guardBuff: BuffDef = {
  id: 'guard',
  nameKey: 'hud.immune',
  icon: 'buff_guard',
  polarity: 'buff',
  duration: 1500,
  maxStacks: 1,
  stacking: { mode: 'refresh' },
  flags: { damageReduce: 0.6 },
};

/** GCD：300ms */
const gcdBuff: BuffDef = {
  id: 'gcd',
  nameKey: 'reject.gcd',
  icon: 'gcd',
  polarity: 'neutral',
  duration: 300,
  maxStacks: 1,
  stacking: { mode: 'refresh' },
  flags: { blocksGcd: true },
};

/** 派生窗口：让 arc 在 1.5 秒内可用 */
const comboBuff: BuffDef = {
  id: 'combo-window',
  nameKey: 'hud.combo',
  icon: 'buff_combo',
  polarity: 'buff',
  duration: 1500,
  maxStacks: 1,
  stacking: { mode: 'refresh' },
  flags: { comboWindow: ['arc'] },
};

const requiresCombo: Condition = { kind: 'hasBuff', buffId: 'combo-window' };
const requiresNoGcd: Condition = { kind: 'notHasBuff', buffId: 'gcd' };

const slashHits: readonly HitDef[] = [
  {
    at: 0,
    effects: [
      {
        kind: 'damage',
        damage: {
          base: 100,
          scaling: [{ stat: 'strength', ratio: 0.8 }],
          school: 'physical',
          canCrit: true,
          countsAsHit: true,
        },
      },
    ],
  },
];

const heavyHits: readonly HitDef[] = [
  { at: 500, effects: [{ kind: 'damage', damage: { base: 300, school: 'physical', canCrit: true, countsAsHit: true } }] },
  { at: 1000, effects: [{ kind: 'damage', damage: { base: 300, school: 'physical', canCrit: true, countsAsHit: true } }] },
  { at: 1500, effects: [{ kind: 'damage', damage: { base: 400, school: 'physical', canCrit: true, countsAsHit: true } }] },
];

const slash: SkillDef = {
  id: 'slash',
  kind: 'activeSkill',
  nameKey: 'resource.energy',
  icon: 'skill_slash',
  abilities: [
    { kind: 'trigger', trigger: { on: 'onCastFinish', then: [{ kind: 'grant', buff: comboBuff, target: { mode: 'self' } }] } },
    { kind: 'trigger', trigger: { on: 'onCastFinish', then: [{ kind: 'grant', buff: gcdBuff, target: { mode: 'self' } }] } },
  ],
  castTime: 0,
  cooldown: 0,
  gcd: true,
  cost: [{ resource: 'energy', value: 10 }],
  targeting: { mode: 'primaryEnemy' },
  hits: slashHits,
  tags: ['melee'],
  school: 'physical',
  interruptible: false,
};

const dodge: SkillDef = {
  id: 'dodge',
  kind: 'activeSkill',
  nameKey: 'hud.dodged',
  icon: 'skill_dodge',
  abilities: [{ kind: 'grant', buff: dodgeBuff, target: { mode: 'self' } }],
  castTime: 0,
  cooldown: 0,
  gcd: false, // 不占 GCD —— 这就是"闪避随时可用"的落地方式
  cost: [{ resource: 'energy', value: 30 }],
  targeting: { mode: 'self' },
  hits: [],
  tags: ['defensive', 'movement'],
  school: 'physical',
  interruptible: false,
};

const guard: SkillDef = {
  id: 'guard',
  kind: 'activeSkill',
  nameKey: 'hud.immune',
  icon: 'skill_guard',
  abilities: [{ kind: 'grant', buff: guardBuff, target: { mode: 'self' } }],
  castTime: 0,
  cooldown: 0,
  gcd: false,
  cost: [{ resource: 'energy', value: 20 }],
  targeting: { mode: 'self' },
  hits: [],
  tags: ['defensive'],
  school: 'physical',
  interruptible: false,
};

/** 派生技能：只有 combo 窗口内可用 */
const arc: SkillDef = {
  id: 'arc',
  kind: 'activeSkill',
  nameKey: 'stat.damageBoost',
  icon: 'skill_arc',
  abilities: [],
  castTime: 0,
  cooldown: 0,
  gcd: true,
  cost: [{ resource: 'energy', value: 15 }],
  targeting: { mode: 'primaryEnemy' },
  hits: [
    {
      at: 0,
      effects: [
        { kind: 'damage', damage: { base: 250, school: 'physical', canCrit: true, countsAsHit: true } },
      ],
    },
  ],
  tags: ['melee'],
  school: 'physical',
  interruptible: false,
  // 派生条件 —— 注意 requires 用的是统一的 Condition
  requires: [requiresCombo, requiresNoGcd],
};

/** 重击：可被打断的读条技能 */
export const heavySkill: SkillDef = {
  id: 'heavy',
  kind: 'activeSkill',
  nameKey: 'stat.strength',
  icon: 'skill_heavy',
  abilities: [],
  castTime: 2500,
  cooldown: 8000,
  gcd: true,
  cost: [{ resource: 'mp', value: 2000 }],
  targeting: { mode: 'primaryEnemy' },
  hits: heavyHits,
  tags: ['spell'],
  school: 'arcane',
  interruptible: true,
};

/** 被动天赋：同一 schema，只是 kind 是 passive */
const passiveTalent: SkillDef = {
  id: 'talent-resonance',
  kind: 'passive',
  nameKey: 'stat.haste',
  icon: 'talent_resonance',
  abilities: [
    {
      kind: 'derived',
      modifier: { stat: 'damageBoost', op: 'addPercent', sourceKey: 'stat.damageBoost', tier: 'talent' },
      // 引用熵之钟的命名空间："势能类效果再提升 50%"
      value: {
        e: 'mul',
        of: [{ e: 'contrib', namespace: POTENTIAL_NS }, { e: 'const', value: 0.5 }],
      },
    },
  ],
  castTime: 0,
  cooldown: 0,
  gcd: false,
  cost: [],
  targeting: { mode: 'self' },
  hits: [],
  tags: [],
  school: 'physical',
  interruptible: false,
};

/* ------------------------------------------------------------------ *
 * Boss：与玩家共用同一套类型，只是多了 behaviors
 * ------------------------------------------------------------------ */

const bossCastBuff: BuffDef = {
  id: 'boss-telegraph',
  nameKey: 'hud.phase',
  icon: 'telegraph',
  polarity: 'neutral',
  duration: 1200,
  maxStacks: 1,
  stacking: { mode: 'refresh' },
};

export const crimsonArcSkill: SkillDef = {
  id: 'crimson-arc',
  kind: 'activeSkill',
  nameKey: 'event.enrage',
  icon: 'boss_arc',
  abilities: [{ kind: 'grant', buff: bossCastBuff, target: { mode: 'self' } }],
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
        { kind: 'damage', damage: { base: 800, school: 'fire', canCrit: false, countsAsHit: true, avoidable: true } },
      ],
    },
  ],
  tags: ['spell'],
  school: 'fire',
  interruptible: true,
};

/* ------------------------------------------------------------------ *
 * 实例、装备方案、关卡、状态
 * ------------------------------------------------------------------ */

const clockInstance: GameEntityInstance = {
  instanceId: 'ent_1',
  defId: 'entropy-clock',
  pool: { counters: { uses: { current: 3, max: 3 } } },
  cooldowns: {},
};

const loadout: Loadout = {
  items: [clockInstance, { ...clockInstance, instanceId: 'ent_2' }], // 装两份
  talents: ['talent-resonance'],
  skillBar: [
    { index: 0, key: '1', skillId: 'slash' },
    { index: 1, key: '2', skillId: 'heavy' },
    { index: 2, key: '3', skillId: 'arc' },
    { index: 3, key: '4', skillId: 'dodge' },
    { index: 4, key: '5', skillId: 'guard' },
  ],
  barSlotCount: 12,
};

const encounter: EncounterDef = {
  id: 'verrot',
  nameKey: 'event.enrage',
  player: loadout,
  boss: {
    ...loadout,
    items: [],
    talents: [],
    behaviors: [
      { kind: 'timeLimit', ms: 180_000 },
      { kind: 'enrage', atMs: 180_000, dmgMult: 2 },
      { kind: 'phases', at: [0.6, 0.3] },
      { kind: 'opener', skillId: crimsonArcSkill.id, delayMs: 4000 },
      {
        kind: 'rotation',
        steps: [
          { skillId: crimsonArcSkill.id, when: { kind: 'phase', phase: 1 }, gapMs: 9000 },
          { skillId: heavySkill.id, when: { kind: 'hpBelow', who: 'self', ratio: 0.5 } },
        ],
      },
      {
        kind: 'onHpBelow',
        ratio: 0.3,
        then: [{ kind: 'enrage', atMs: 0, dmgMult: 1.5 }],
      },
    ],
  },
  victory: [{ kind: 'hpBelow', who: 'target', ratio: 0 }],
  defeat: [{ kind: 'hpBelow', who: 'self', ratio: 0 }],
  timeLimitMs: 180_000,
};

/** 一个完整的初始战斗状态。这个对象必须能被 structuredClone。 */
const initialState: BattleState = {
  tick: 0,
  rngSeed: 20261009,
  status: 'idle',
  phase: 1,
  startedAtTick: 0,
  charges: {},
  combatants: [
    {
      id: 'player',
      nameKey: 'hud.level',
      side: 'ally',
      caps: { hp: 10_000, mp: 10_000, energy: 120, fury: 100 },
      resources: { hp: 10_000, mp: 10_000, energy: 120, fury: 0 },
      counters: {},
      basePrimary: { strength: 100, agility: 100, intelligence: 100, spirit: 100 },
      buffs: [],
      cooldowns: {},
      casts: [],
      uses: {},
      behaviors: [],
      alive: true,
    },
    {
      id: 'boss',
      nameKey: 'event.enrage',
      side: 'enemy',
      caps: { hp: 100_000, mp: 0, energy: 0, fury: 0 },
      resources: { hp: 100_000, mp: 0, energy: 0, fury: 0 },
      counters: {},
      basePrimary: { strength: 800, agility: 400, intelligence: 600, spirit: 400 },
      buffs: [],
      cooldowns: {},
      casts: [],
      uses: {},
      behaviors: encounter.boss.behaviors,
      alive: true,
    },
  ],
};

/* ------------------------------------------------------------------ *
 * 断言（很轻：重量在编译期）
 * ------------------------------------------------------------------ */

describe('类型层能表达规范承诺的内容', () => {
  it('熵之钟的三个效果都能构造', () => {
    expect(entropyClock.abilities).toHaveLength(4);
    expect(entropyClock.slot).toBe('relic');
    expect(entropyClock.multiEquip).toBe(true);
  });

  it('判定窗口与派生窗口都由 buff 表达，没有新机制', () => {
    expect(dodgeBuff.flags?.invulnerable).toBe(true);
    expect(dodgeBuff.duration).toBe(300);
    expect(guardBuff.flags?.damageReduce).toBeCloseTo(0.6);
    expect(comboBuff.flags?.comboWindow).toContain('arc');
  });

  it('不占 GCD 的技能显式声明 gcd: false', () => {
    expect(slash.gcd).toBe(true);
    expect(dodge.gcd).toBe(false);
    expect(guard.gcd).toBe(false);
  });

  it('派生技能用统一的 Condition 表达前置条件', () => {
    expect(arc.requires).toEqual([requiresCombo, requiresNoGcd]);
  });

  it('被动技能与主动技能同一 schema', () => {
    expect(passiveTalent.kind).toBe('passive');
    expect(passiveTalent.hits).toHaveLength(0);
    expect(passiveTalent.abilities[0]?.kind).toBe('derived');
  });

  it('同一件内容可以装两份', () => {
    expect(loadout.items).toHaveLength(2);
    expect(loadout.items[0]?.defId).toBe(loadout.items[1]?.defId);
    expect(loadout.items[0]?.instanceId).not.toBe(loadout.items[1]?.instanceId);
  });

  it('Boss 行为是数据数组，且能嵌套', () => {
    const kinds = encounter.boss.behaviors.map((b) => b.kind);
    expect(kinds).toContain('timeLimit');
    expect(kinds).toContain('rotation');
    expect(kinds).toContain('onHpBelow');
  });

  it('【C5】BattleState 可结构化克隆且往返无损', () => {
    const cloned = structuredClone(initialState);
    expect(cloned).toEqual(initialState);
    // 不允许出现 Map / Set / 函数（结构化克隆会抛错或丢失）
    expect(JSON.parse(JSON.stringify(initialState))).toEqual(initialState);
  });

  it('stat key 的联合类型覆盖规范列出的全部属性', () => {
    // 这里只是抽样：如果某个 key 被删掉，这行会编译失败
    const keys: readonly StatKey[] = [
      'strength',
      'haste',
      'damageBoost',
      'damageMult',
      'critDamageBoost',
      'armorPen',
      'vulnerability',
      'damageTakenMult',
    ];
    expect(keys).toHaveLength(8);
  });

  it('多段攻击用多个 HitDef 表达，且时间段递增', () => {
    expect(heavySkill.hits).toHaveLength(3);
    const times = heavySkill.hits.map((h) => h.at);
    expect(times).toEqual([...times].sort((a, b) => a - b));
    // 每段都可以有自己的效果
    expect(heavySkill.hits.every((h) => h.effects.length > 0)).toBe(true);
  });

  it('可打断的读条技能与"无法闪避"的判定标记都能表达', () => {
    expect(heavySkill.interruptible).toBe(true);
    expect(heavySkill.castTime).toBeGreaterThan(0);
    const bossHit = crimsonArcSkill.hits[0];
    expect(bossHit?.avoidable).toBe(true);
    expect(bossHit?.effects[0]?.damage?.avoidable).toBe(true);
    // 命中时刻与读条时长一致（hit frame 落在读条结束）
    expect(bossHit?.at).toBe(crimsonArcSkill.castTime);
  });

  it('修正支持全部 6 种 op', () => {
    const mods: readonly StatModifier[] = [
      { stat: 'strength', op: 'add', value: 2, sourceKey: 'stat.strength' },
      { stat: 'damageMult', op: 'mult', value: 1.5, sourceKey: 'stat.damageMult' },
      { stat: 'damageBoost', op: 'addPercent', value: 0.1, sourceKey: 'stat.damageBoost' },
      { stat: 'haste', op: 'max', value: 0.2, sourceKey: 'stat.haste' },
      { stat: 'critChance', op: 'setOverride', value: 1, sourceKey: 'stat.critChance' },
      { stat: 'damageBoost', op: 'perStackAdd', value: 0.02, sourceKey: 'stat.damageBoost' },
    ];
    expect(mods).toHaveLength(6);
  });
});
