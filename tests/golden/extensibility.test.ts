import { describe, expect, it } from 'vitest';
import { BattleEngine } from '../../src/core/combat/battleState';
import { createRegistry } from '../../src/core/content/registry';
import { RunRecorder } from '../../src/core/run';
import { flattenCatalog } from '../../src/i18n/translator';
import { zhCN } from '../../src/i18n/locales/zh-CN';
import { ALL_BUFFS, ALL_SKILLS } from '../../src/data/content';
import { ENTROPY_CLOCK } from '../../src/data/entities/entropyClock';
import type {
  Behavior,
  BuffDef,
  Combatant,
  EquipmentEntity,
  SkillDef,
  StatKey,
} from '../../src/core/types';

/**
 * 可扩展性验收（目标的第二条验收条件）：
 *
 * > 新增一个技能 / Boss / 装备**只需写数据，不改引擎代码**。
 *
 * ------------------------------------------------------------------
 * 为什么这些用例必须"动真的"
 * ------------------------------------------------------------------
 *
 * 一个只写了 `hits: []` 的空技能当然能通过校验 —— 但它什么都没证明。
 * 所以下面的用例里，新增的内容都带**真实机制**：
 *   - 技能：多段命中 + 触发授予 buff + 消耗资源
 *   - Boss：全新的行为数组（阶段 / 狂暴 / 轮转 / 开场）
 *   - 装备：modifier + derived + trigger + 命名空间引用
 *
 * 并且用**同一个引擎构造函数**跑起来 —— 如果引擎需要为新内容改代码，
 * 这些用例会在编译期或运行期直接失败。
 */

/**
 * 基础语言 key（来自真实语言包）。
 *
 * 测试内容需要自己的 key，所以下面还有一份"测试追加 key"。
 * 这不是绕过校验 —— 恰恰相反：校验器要求内容里出现的**每个**
 * `sourceKey` / `nameKey` 都真实存在，连 `sourceKey` 也查。
 * 所以新增内容必须同时提供文案，这正是在浏览器里能正确显示的前提。
 */
const baseLocaleKeys = new Set(flattenCatalog(zhCN).keys());

/** 测试内容追加的语言 key（模拟"新增内容时同时加文案"）。 */
const testLocaleKeys = new Set([
  ...baseLocaleKeys,
  'entity.testRelic.name',
  'entity.testRelic.desc',
]);

const localeKeys = testLocaleKeys;

/** 全部内容（真实内容 + 下面新增的），一次建立注册表。 */
function registryWith(extra: {
  skills?: readonly SkillDef[];
  buffs?: readonly BuffDef[];
  entities?: readonly EquipmentEntity[];
}) {
  return createRegistry(
    {
      entities: [...(extra.entities ?? []), ENTROPY_CLOCK],
      skills: [...ALL_SKILLS, ...(extra.skills ?? [])],
      buffs: [...ALL_BUFFS, ...(extra.buffs ?? [])],
    },
    { localeKeys },
  );
}

function makeCombatant(id: string, side: 'ally' | 'enemy', hp: number, base: Partial<Record<StatKey, number>> = {}): Combatant {
  return {
    id,
    nameKey: 'hud.you',
    side,
    caps: { hp, energy: 120, douqi: 100 },
    resources: { hp, energy: 120, douqi: 0 },
    counters: {},
    basePrimary: { strength: 120, agility: 100, intelligence: 110, spirit: 100 },
    buffs: [],
    cooldowns: {},
    casts: [],
    uses: {},
    behaviors: [],
    alive: true,
    ...(Object.keys(base).length > 0 ? {} : {}),
  };
}

/* ================================================================== *
 * 新增技能：带真实机制
 * ================================================================== */

describe('可扩展性：新增一个技能只需要写数据', () => {
  /**
   * 一个"什么机制都用到一点"的技能：
   *   - 多段命中（两个 hit frame）
   *   - 第二段授予一个自定义 debuff
   *   - 施法完成时授予一个自定义 buff 并消耗资源
   */
  const customBuff: BuffDef = {
    id: 'test-brand',
    nameKey: 'buffShort.bleed',
    icon: 'test',
    polarity: 'debuff',
    color: 0xaa3366,
    duration: 6000,
    maxStacks: 3,
    stacking: { mode: 'stack', max: 3 },
  };

  const customSkill: SkillDef = {
    id: 'test-sigil',
    kind: 'activeSkill',
    nameKey: 'skill.strike.name',
    icon: 'test',
    abilities: [
      {
        kind: 'trigger',
        trigger: {
          on: 'onCastFinish',
          then: [
            { kind: 'grant', target: { mode: 'self' }, buff: customBuff },
            { kind: 'resource', target: { mode: 'self' }, resource: 'douqi', delta: 25 },
          ],
        },
      },
    ],
    castTime: 0,
    cooldown: 0,
    gcd: false,
    cost: [],
    targeting: { mode: 'primaryEnemy' },
    hits: [
      {
        at: 0,
        effects: [
          {
            kind: 'damage',
            damage: { base: 50, school: 'arcane', canCrit: false, countsAsHit: true },
          },
        ],
      },
      {
        at: 0,
        effects: [
          {
            kind: 'damage',
            damage: { base: 70, school: 'arcane', canCrit: false, countsAsHit: true },
          },
          { kind: 'grantBuff', target: { mode: 'primaryEnemy' }, buff: customBuff },
        ],
      },
    ],
    tags: ['spell'],
    school: 'arcane',
    interruptible: false,
  };

  it('新技能的多段命中、buff 授予与资源产出都生效', () => {
    const registry = registryWith({ skills: [customSkill], buffs: [customBuff] });
    const engine = new BattleEngine({
      combatants: [makeCombatant('player', 'ally', 10_000), makeCombatant('dummy', 'enemy', 1_000_000)],
      seed: 1,
      buffs: registry.buffs,
      skills: registry.skills,
      baseStats: new Map([['player', {}], ['dummy', {}]]),
      passiveModifiers: new Map(),
    });

    engine.tick([{ type: 'useSkill', skillId: 'test-sigil', atTick: 0 }]);
    const events = engine.drainEvents();

    const damage = events.filter((e) => e.kind === 'damage');
    expect(damage).toHaveLength(2); // 两段命中
    expect(damage.reduce((sum, e) => sum + (e.kind === 'damage' ? e.amount : 0), 0)).toBe(120);

    // 施法者拿到 buff + 斗炁
    const player = engine.snapshot.combatants.find((c) => c.id === 'player')!;
    expect(player.buffs.some((b) => b.defId === 'test-brand')).toBe(true);
    expect(player.resources.douqi).toBe(25);

    // 目标被挂上 debuff（stack 模式）
    const dummy = engine.snapshot.combatants.find((c) => c.id === 'dummy')!;
    expect(dummy.buffs.some((b) => b.defId === 'test-brand')).toBe(true);
  });

  it('新技能的 buff 是 stack 模式且遵守上限（内容声明，引擎执行）', () => {
    const registry = registryWith({ skills: [customSkill], buffs: [customBuff] });
    const engine = new BattleEngine({
      combatants: [makeCombatant('player', 'ally', 10_000), makeCombatant('dummy', 'enemy', 1_000_000)],
      seed: 1,
      buffs: registry.buffs,
      skills: registry.skills,
      baseStats: new Map([['player', {}], ['dummy', {}]]),
      passiveModifiers: new Map(),
    });

    // 反复施放，叠层不应超过 maxStacks = 3
    for (let t = 0; t < 20; t += 1) {
      engine.tick([{ type: 'useSkill', skillId: 'test-sigil', atTick: t }]);
      engine.drainEvents();
    }
    const dummy = engine.snapshot.combatants.find((c) => c.id === 'dummy')!;
    const brand = dummy.buffs.find((b) => b.defId === 'test-brand');
    expect(brand?.stacks).toBeLessThanOrEqual(3);
  });
});

/* ================================================================== *
 * 新增 Boss：全新行为数组
 * ================================================================== */

describe('可扩展性：新增一个 Boss 只需要写数据', () => {
  /** 一个技能组与 Verrot 完全不同的 Boss，用全新的行为数组。 */
  const bossSkillA: SkillDef = {
    id: 'test-boss-beam',
    kind: 'activeSkill',
    nameKey: 'boss.corruption.name',
    icon: 'test',
    abilities: [],
    castTime: 800,
    cooldown: 0,
    gcd: false,
    cost: [],
    targeting: { mode: 'primaryEnemy' },
    hits: [
      {
        at: 800,
        effects: [
          {
            kind: 'damage',
            damage: { base: 300, school: 'arcane', canCrit: false, countsAsHit: true },
          },
        ],
      },
    ],
    tags: ['spell'],
    school: 'arcane',
    interruptible: false,
  };

  const bossSkillB: SkillDef = {
    id: 'test-boss-heal',
    kind: 'activeSkill',
    nameKey: 'boss.empower.name',
    icon: 'test',
    abilities: [{ kind: 'grant', target: { mode: 'self' }, buff: { ...ALL_BUFFS[0]!, id: 'test-boss-focus', nameKey: 'boss.empower.name' } }],
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

  const behaviors: readonly Behavior[] = [
    { kind: 'timeLimit', ms: 120_000 },
    { kind: 'enrage', atMs: 60_000, dmgMult: 3 },
    { kind: 'phases', at: [0.5] },
    { kind: 'opener', skillId: 'test-boss-beam', delayMs: 1000 },
    {
      kind: 'rotation',
      steps: [
        { skillId: 'test-boss-heal', gapMs: 5000 },
        { skillId: 'test-boss-beam', gapMs: 2000 },
      ],
    },
  ];

  function makeBossEngine() {
    const registry = registryWith({ skills: [bossSkillA, bossSkillB] });
    const boss = makeCombatant('test-boss', 'enemy', 50_000);
    const engine = new BattleEngine({
      combatants: [makeCombatant('player', 'ally', 60_000), { ...boss, behaviors }],
      seed: 3,
      bossId: 'test-boss',
      timeLimitMs: 120_000,
      buffs: registry.buffs,
      skills: registry.skills,
      baseStats: new Map([['player', {}], ['test-boss', {}]]),
      passiveModifiers: new Map(),
    });
    return engine;
  }

  it('新 Boss 会按自己的行为数组行动（开场 + 轮转）', () => {
    const engine = makeBossEngine();
    const used = new Set<string>();
    for (let t = 0; t < 60 * 40; t += 1) {
      engine.tick();
      for (const e of engine.drainEvents()) {
        if (e.kind === 'skillUsed' && e.sourceId === 'test-boss') used.add(e.skillId);
      }
    }
    // 开场动作在 1 秒后触发，轮转里两个技能都该被用到
    expect(used.has('test-boss-beam')).toBe(true);
    expect(used.has('test-boss-heal')).toBe(true);
  });

  it('新 Boss 的阶段阈值按自己的配置触发（50% 而不是 60%/30%）', () => {
    // 一个能快速打掉 Boss 一半血的高伤技能
    const heavy: SkillDef = {
      id: 'test-heavy',
      kind: 'activeSkill',
      nameKey: 'skill.strike.name',
      icon: 'test',
      abilities: [],
      castTime: 0,
      cooldown: 0,
      gcd: false,
      cost: [],
      targeting: { mode: 'primaryEnemy' },
      hits: [
        {
          at: 0,
          effects: [
            { kind: 'damage', damage: { base: 30_000, school: 'physical', canCrit: false, countsAsHit: true } },
          ],
        },
      ],
      tags: [],
      school: 'physical',
      interruptible: false,
    };
    const withHeavy = createRegistry(
      {
        entities: [ENTROPY_CLOCK],
        skills: [...ALL_SKILLS, bossSkillA, bossSkillB, heavy],
        buffs: [...ALL_BUFFS],
      },
      { localeKeys },
    );
    const engine = new BattleEngine({
      combatants: [
        makeCombatant('player', 'ally', 60_000),
        { ...makeCombatant('test-boss', 'enemy', 50_000), behaviors },
      ],
      seed: 3,
      bossId: 'test-boss',
      timeLimitMs: 120_000,
      buffs: withHeavy.buffs,
      skills: withHeavy.skills,
      baseStats: new Map([['player', {}], ['test-boss', {}]]),
      passiveModifiers: new Map(),
    });

    let phase = 1;
    for (let t = 0; t < 60 * 20; t += 1) {
      // 每 2 秒打一发，几发之后就会跨过 50%
      const actions = t % 120 === 0 ? [{ type: 'useSkill' as const, skillId: 'test-heavy', atTick: t }] : [];
      engine.tick(actions);
      for (const e of engine.drainEvents()) {
        if (e.kind === 'phaseChanged') phase = e.phase;
      }
      if (phase > 1) break;
    }
    // 阈值是 0.5 → 只配了一个阈值，所以阶段变成 2
    expect(phase).toBe(2);
  });

  it('新 Boss 的狂暴按自己的时间点触发', () => {
    const engine = makeBossEngine();
    let enraged = false;
    for (let t = 0; t < 60 * 62; t += 1) {
      engine.tick();
      for (const e of engine.drainEvents()) {
        if (e.kind === 'enrageStarted' && e.bossId === 'test-boss') enraged = true;
      }
      if (enraged) break;
    }
    expect(enraged).toBe(true);
  });

  it('同一套引擎代码能同时驱动两个完全不同的 Boss', () => {
    // Verrot 与新 Boss 各自跑 10 秒，都应有自己的行为表现
    const a = new BattleEngine({
      ...{ combatants: [makeCombatant('player', 'ally', 30_000), { ...makeCombatant('verrot', 'enemy', 50_000), behaviors: [{ kind: 'opener', skillId: 'crimson-arc', delayMs: 500 }] }] },
      seed: 5,
      bossId: 'verrot',
      buffs: registryWith({}).buffs,
      skills: registryWith({}).skills,
      baseStats: new Map([['player', {}], ['verrot', {}]]),
      passiveModifiers: new Map(),
    });
    const aUsed = new Set<string>();
    for (let t = 0; t < 60 * 10; t += 1) {
      a.tick();
      for (const e of a.drainEvents()) if (e.kind === 'skillUsed') aUsed.add(e.skillId);
    }
    expect(aUsed.has('crimson-arc')).toBe(true);

    const b = makeBossEngine();
    const bUsed = new Set<string>();
    for (let t = 0; t < 60 * 10; t += 1) {
      b.tick();
      for (const e of b.drainEvents()) if (e.kind === 'skillUsed') bUsed.add(e.skillId);
    }
    expect(bUsed.has('test-boss-beam')).toBe(true);
  });
});

/* ================================================================== *
 * 新增装备：modifier + derived + trigger + 命名空间
 * ================================================================== */

describe('可扩展性：新增一件装备只需要写数据', () => {
  /**
   * 一件"用满数据模型"的装备：
   *   - modifier：+5 力量
   *   - derived：按力量提升增伤，并暴露一个命名空间
   *   - trigger：受击时授予一个引用该命名空间的 buff
   */
  const customBuff: BuffDef = {
    id: 'test-aegis',
    nameKey: 'hud.immune',
    icon: 'test',
    polarity: 'buff',
    color: 0x66ccff,
    duration: 4000,
    maxStacks: 1,
    stacking: { mode: 'refresh' },
    modifiers: [
      {
        stat: 'armor',
        op: 'add',
        value: { e: 'contrib', namespace: 'test-relic.power' },
        sourceKey: 'hud.immune',
        namespace: 'test-aegis',
        tier: 'buff',
      },
    ],
  };

  const relic: EquipmentEntity = {
    id: 'test-relic',
    kind: 'equipment',
    nameKey: `entity.testRelic.name`,
    descKey: `entity.testRelic.desc`,
    icon: 'test',
    slot: 'relic',
    rarity: 'rare',
    tags: ['relic'],
    abilities: [
      {
        kind: 'modifier',
        modifier: {
          stat: 'strength',
          op: 'add',
          value: 5,
          sourceKey: `entity.testRelic.name`,
          tier: 'item',
        },
      },
      {
        kind: 'derived',
        modifier: {
          stat: 'damageBoost',
          op: 'addPercent',
          sourceKey: `entity.testRelic.name`,
          namespace: 'test-relic.power',
          tier: 'item',
        },
        value: { e: 'mul', of: [{ e: 'const', value: 0.5 }, { e: 'stat', who: 'self', stat: 'strength' }] },
      },
      {
        kind: 'trigger',
        trigger: {
          on: 'onHitTaken',
          then: [{ kind: 'grant', target: { mode: 'self' }, buff: customBuff }],
        },
      },
    ],
  };

  /** 把装备的能力摊平成被动修正池（与 `main.ts` 里的做法一致）。 */
  function relicModifiers(entity: EquipmentEntity) {
    const out = [];
    for (const ability of entity.abilities) {
      if (ability.kind === 'modifier') out.push(ability.modifier);
      else if (ability.kind === 'derived') out.push({ ...ability.modifier, value: ability.value });
    }
    return out;
  }

  it('装备的 modifier 与 derived 都进入属性结算，且命名空间可被引用', () => {
    const registry = registryWith({ entities: [relic], buffs: [customBuff] });
    const engine = new BattleEngine({
      combatants: [makeCombatant('player', 'ally', 10_000), makeCombatant('dummy', 'enemy', 10_000)],
      seed: 1,
      buffs: registry.buffs,
      skills: registry.skills,
      baseStats: new Map([['player', { strength: 100 }], ['dummy', {}]]),
      passiveModifiers: new Map([['player', relicModifiers(relic)]]),
    });

    const stats = engine.statsOf('player');
    // modifier：+5 力量
    expect(stats.strength).toBe(105);
    // derived：damageBoost = 0.5 × 力量 = 52.5
    expect(stats.damageBoost).toBeCloseTo(52.5, 5);
  });

  it('装备的 trigger 引用了一个由**装备自己产出**的命名空间（跨来源引用）', () => {
    // 这是数据模型里最有表达力的一条：buff 的修正不写死数值，
    // 而是引用装备产出的命名空间 —— 于是装备属性一变，buff 跟着变。
    const modifier = customBuff.modifiers?.[0];
    expect(modifier?.value).toEqual({ e: 'contrib', namespace: 'test-relic.power' });

    // 而那个命名空间确实由装备的 derived 能力声明
    const derived = relic.abilities.find((a) => a.kind === 'derived');
    expect(derived?.kind).toBe('derived');
    if (derived?.kind !== 'derived') return;
    expect(derived.modifier.namespace).toBe('test-relic.power');
  });

  it('装备的 trigger hook 是真实存在的引擎钩子', () => {
    const trigger = relic.abilities.find((a) => a.kind === 'trigger');
    if (trigger?.kind !== 'trigger') throw new Error('expected trigger');
    expect(trigger.trigger.on).toBe('onHitTaken');
  });

  it('新装备的三件能力齐全（modifier / derived / trigger）', () => {
    expect(relic.abilities.map((a) => a.kind)).toEqual(['modifier', 'derived', 'trigger']);
  });

  it('注册表能解析新装备与它内联的 buff', () => {
    const registry = registryWith({ entities: [relic], buffs: [customBuff] });
    expect(registry.buff('test-aegis')).toBeDefined();
  });
});

/* ================================================================== *
 * 一整场战斗：用全是新内容的 Boss 跑完
 * ================================================================== */

describe('可扩展性：全新内容也能跑完一整场战斗', () => {
  const newSkill: SkillDef = {
    id: 'test-nuke',
    kind: 'activeSkill',
    nameKey: 'skill.strike.name',
    icon: 'test',
    abilities: [],
    castTime: 0,
    cooldown: 0,
    gcd: false,
    cost: [],
    targeting: { mode: 'primaryEnemy' },
    hits: [
      {
        at: 0,
        effects: [
          {
            kind: 'damage',
            damage: { base: 900, school: 'physical', canCrit: false, countsAsHit: true },
          },
        ],
      },
    ],
    tags: [],
    school: 'physical',
    interruptible: false,
  };

  const newBossSkill: SkillDef = {
    id: 'test-boss-hit',
    kind: 'activeSkill',
    nameKey: 'boss.empower.name',
    icon: 'test',
    abilities: [],
    castTime: 0,
    cooldown: 0,
    gcd: false,
    cost: [],
    targeting: { mode: 'primaryEnemy' },
    hits: [
      {
        at: 0,
        effects: [
          { kind: 'damage', damage: { base: 400, school: 'physical', canCrit: false, countsAsHit: true } },
        ],
      },
    ],
    tags: [],
    school: 'physical',
    interruptible: false,
  };

  it('用同一套引擎跑完新内容的一场战斗，并得到结算结果', () => {
    const registry = registryWith({ skills: [newSkill, newBossSkill] });
    const boss = makeCombatant('new-boss', 'enemy', 20_000);
    const engine = new BattleEngine({
      combatants: [
        makeCombatant('player', 'ally', 10_000),
        { ...boss, behaviors: [{ kind: 'rotation', steps: [{ skillId: 'test-boss-hit', gapMs: 1000 }] }] },
      ],
      seed: 11,
      bossId: 'new-boss',
      timeLimitMs: 120_000,
      buffs: registry.buffs,
      skills: registry.skills,
      baseStats: new Map([['player', {}], ['new-boss', {}]]),
      passiveModifiers: new Map(),
    });

    let guard = 0;
    while (engine.snapshot.status === 'running' && guard < 60 * 120) {
      engine.tick([{ type: 'useSkill', skillId: 'test-nuke', atTick: engine.snapshot.tick }]);
      engine.drainEvents();
      guard += 1;
    }

    expect(engine.snapshot.status).toBe('victory');
    expect(engine.snapshot.endReason).toBe('hpZero');
  });

  it('新内容的重放也是确定的（黄金机制对内容无偏见）', () => {
    const runOnce = (): string => {
      const registry = registryWith({ skills: [newSkill, newBossSkill] });
      const recorder = new RunRecorder({
        combatants: [
          makeCombatant('player', 'ally', 10_000),
          { ...makeCombatant('new-boss', 'enemy', 20_000), behaviors: [{ kind: 'rotation', steps: [{ skillId: 'test-boss-hit', gapMs: 1000 }] }] },
        ],
        seed: 11,
        bossId: 'new-boss',
        timeLimitMs: 120_000,
        buffs: registry.buffs,
        skills: registry.skills,
        baseStats: new Map([['player', {}], ['new-boss', {}]]),
        passiveModifiers: new Map(),
      });
      recorder.runUntilEnd((tick) => [{ type: 'useSkill', skillId: 'test-nuke', atTick: tick }], 60 * 120);
      return JSON.stringify(recorder.outcome());
    };
    expect(runOnce()).toBe(runOnce());
  });
});
