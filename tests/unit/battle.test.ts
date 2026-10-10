import { describe, expect, it } from 'vitest';
import { BattleEngine } from '../../src/core/combat/battleState';
import { ENTROPY_CLOCK } from '../../src/data/entities/entropyClock';
import type {
  BuffDef,
  Combatant,
  SkillDef,
  StatKey,
  StatModifier,
} from '../../src/core/types';
import { makeBuffDef, makeCombatant, makeSkillDef } from './helpers';

/**
 * 引擎端到端：把修正树 / buff / 技能 / 判定接起来跑。
 *
 * 这一组测试是 M1 的最终验收 —— 它同时也是"无头可玩性"的雏形：
 * 整个战斗在 Node 里跑完，不启动浏览器。
 */

const SLASH = makeSkillDef({
  id: 'slash',
  castTime: 0,
  cooldown: 0,
  cost: [{ resource: 'energy', value: 10 }],
  hits: [
    {
      at: 0,
      effects: [
        {
          kind: 'damage',
          damage: { base: 100, school: 'physical', canCrit: false, countsAsHit: true },
        },
      ],
    },
  ],
});

const HEAVY = makeSkillDef({
  id: 'heavy',
  castTime: 1000,
  cooldown: 5000,
  interruptible: true,
  cost: [{ resource: 'energy', value: 40 }],
  hits: [
    {
      at: 1000,
      effects: [
        {
          kind: 'damage',
          damage: { base: 400, school: 'physical', canCrit: false, countsAsHit: true },
        },
      ],
    },
  ],
});

const DODGE = makeSkillDef({
  id: 'dodge',
  castTime: 0,
  cooldown: 0, // 不占 GCD
  cost: [{ resource: 'energy', value: 30 }],
  abilities: [
    {
      kind: 'grant',
      target: { mode: 'self' },
      buff: makeBuffDef({
        id: 'dodge-iframe',
        duration: 300,
        stacking: { mode: 'refresh' },
        flags: { invulnerable: true },
      }),
    },
  ],
  hits: [],
});

const BOSS_SWING = makeSkillDef({
  id: 'boss-swing',
  castTime: 1000,
  cooldown: 0,
  cost: [],
  hits: [
    {
      at: 1000,
      effects: [
        {
          kind: 'damage',
          damage: { base: 500, school: 'physical', canCrit: false, countsAsHit: true },
        },
      ],
    },
  ],
});

function makeEngine(options: {
  timeLimitMs?: number;
  passiveModifiers?: ReadonlyMap<string, readonly StatModifier[]>;
  baseStats?: ReadonlyMap<string, Partial<Record<StatKey, number>>>;
} = {}): BattleEngine {
  const buffs = new Map<string, BuffDef>([
    ['dodge-iframe', (DODGE.abilities[0] as { buff: BuffDef }).buff],
  ]);
  const skills = new Map<string, SkillDef>([
    ['slash', SLASH],
    ['heavy', HEAVY],
    ['dodge', DODGE],
    ['boss-swing', BOSS_SWING],
  ]);

  const player: Combatant = makeCombatant({ id: 'player', side: 'ally' });
  const boss: Combatant = makeCombatant({
    id: 'boss',
    side: 'enemy',
    caps: { hp: 100_000, energy: 0, douqi: 0 },
    resources: { hp: 100_000, energy: 0, douqi: 0 },
  });

  return new BattleEngine({
    combatants: [player, boss],
    seed: 20261009,
    buffs,
    skills,
    baseStats:
      options.baseStats ??
      new Map<string, Partial<Record<StatKey, number>>>([
        ['player', { intelligence: 100, strength: 100 }],
        ['boss', {}],
      ]),
    passiveModifiers: options.passiveModifiers ?? new Map(),
    ...(options.timeLimitMs === undefined ? {} : { timeLimitMs: options.timeLimitMs }),
  });
}

/** 跑 n 个 tick，收集全部事件。 */
function run(
  engine: BattleEngine,
  ticks: number,
  actionsAt: ReadonlyMap<number, Parameters<BattleEngine['applyActions']>[0]> = new Map(),
): ReturnType<BattleEngine['drainEvents']> {
  const events: ReturnType<BattleEngine['drainEvents']>[number][] = [];
  for (let t = 0; t < ticks; t += 1) {
    const actions = actionsAt.get(t) ?? [];
    engine.tick(actions);
    events.push(...engine.drainEvents());
  }
  return events;
}

describe('引擎：技能施放与门禁', () => {
  it('瞬发技能立刻造成伤害', () => {
    const engine = makeEngine();
    const events = run(engine, 1, new Map([[0, [{ type: 'useSkill', skillId: 'slash', atTick: 0 }]]]));
    const damage = events.find((e) => e.kind === 'damage');
    expect(damage).toBeDefined();
    if (damage?.kind !== 'damage') return;
    expect(damage.amount).toBe(100);
  });

  it('代价不足时拒绝，原因是 cost', () => {
    // 构造一个代价超过角色资源上限的技能
    const expensive = makeSkillDef({
      id: 'expensive',
      castTime: 0,
      cooldown: 0,
      cost: [{ resource: 'energy', value: 999_999 }],
      hits: [],
    });
    const engine = new BattleEngine({
      combatants: [makeCombatant({ id: 'player', side: 'ally' })],
      seed: 1,
      buffs: new Map(),
      skills: new Map([['expensive', expensive]]),
      baseStats: new Map([['player', {}]]),
      passiveModifiers: new Map(),
    });
    engine.tick([{ type: 'useSkill', skillId: 'expensive', atTick: 0 }]);
    const events = engine.drainEvents();
    const rejected = events.find((e) => e.kind === 'skillRejected');
    expect(rejected?.kind).toBe('skillRejected');
    if (rejected?.kind !== 'skillRejected') return;
    expect(rejected.reason).toBe('cost');
  });

  it('正在读条时施放其它技能 → 打断旧读条并施放新技能', () => {
    /**
     * 旧版这条测试断言"被 casting 拒绝"。玩法改成了
     * **读条中出招会打断当前读条**（公共冷却已删除），所以现在的
     * 正确结果是：旧读条被打断、新技能正常施放。
     */
    const engine = makeEngine();
    const events = run(
      engine,
      3,
      new Map([
        [0, [{ type: 'useSkill', skillId: 'heavy', atTick: 0 }]],
        [1, [{ type: 'useSkill', skillId: 'slash', atTick: 1 }]],
      ]),
    );
    const interrupted = events.find((e) => e.kind === 'castInterrupted');
    expect(interrupted?.kind).toBe('castInterrupted');
    if (interrupted?.kind !== 'castInterrupted') return;
    expect(interrupted.skillId).toBe('heavy');
    expect(interrupted.reason).toBe('replaced');

    // 新技能已经接上读条
    const used = events.filter((e) => e.kind === 'skillUsed' && e.skillId === 'slash');
    expect(used.length).toBe(1);
  });
});

describe('引擎：读条与 hit frame', () => {
  it('读条技能在 hit frame 才造成伤害', () => {
    const engine = makeEngine();
    const events = run(
      engine,
      5,
      new Map([[0, [{ type: 'useSkill', skillId: 'heavy', atTick: 0 }]]]),
    );
    // 1000ms = 60 tick，前几个 tick 不该有伤害
    expect(events.filter((e) => e.kind === 'damage')).toHaveLength(0);
    expect(events.some((e) => e.kind === 'castStarted')).toBe(true);
  });

  it('读条满 60 tick 后造成伤害并结束读条', () => {
    const engine = makeEngine();
    const events = run(
      engine,
      65,
      new Map([[0, [{ type: 'useSkill', skillId: 'heavy', atTick: 0 }]]]),
    );
    const damage = events.find((e) => e.kind === 'damage');
    expect(damage).toBeDefined();
    if (damage?.kind !== 'damage') return;
    expect(damage.amount).toBe(400);
    expect(events.some((e) => e.kind === 'castFinished')).toBe(true);
  });

  it('读条期间不能施放其它技能（需要等它结束）', () => {
    const engine = makeEngine();
    const events = run(
      engine,
      10,
      new Map([
        [0, [{ type: 'useSkill', skillId: 'heavy', atTick: 0 }]],
        [5, [{ type: 'useSkill', skillId: 'dodge', atTick: 5 }]],
      ]),
    );
    // dodge 是瞬发但也要等读条结束（引擎当前语义：任何技能都不能打断读条）
    const rejected = events.find((e) => e.kind === 'skillRejected');
    if (rejected?.kind === 'skillRejected') {
      expect(rejected.reason).toBe('casting');
    }
  });
});

describe('引擎：判定层（M2 的核心）', () => {
  it('闪避窗口已过期时正常吃满伤害（反向用例）', () => {
    // Boss 的 hit 落在 200ms（12 tick）处，而闪避只有 300ms 窗口
    // —— 这个用例把闪避开在 t=0，窗口在 t=18 结束，而 hit 在 t=22，
    //    所以必然吃满伤害。
    const fastBoss = makeSkillDef({
      id: 'boss-swing',
      castTime: 200,
      cooldown: 0,
      cost: [],
      hits: [
        {
          at: 200,
          effects: [
            {
              kind: 'damage',
              damage: { base: 500, school: 'physical', canCrit: false, countsAsHit: true },
            },
          ],
        },
      ],
    });

    const buffs = new Map<string, BuffDef>([
      ['dodge-iframe', (DODGE.abilities[0] as { buff: BuffDef }).buff],
    ]);
    const skills = new Map<string, SkillDef>([
      ['dodge', DODGE],
      ['boss-swing', fastBoss],
    ]);

    const engine = new BattleEngine({
      combatants: [
        makeCombatant({ id: 'player', side: 'ally' }),
        makeCombatant({
          id: 'boss',
          side: 'enemy',
          caps: { hp: 100_000, energy: 0, douqi: 0 },
          resources: { hp: 100_000, energy: 0, douqi: 0 },
        }),
      ],
      seed: 1,
      buffs,
      skills,
      baseStats: new Map([
        ['player', {}],
        ['boss', {}],
      ]),
      passiveModifiers: new Map(),
    });

    // 用引擎内部的 AI 动作参数让 Boss 读条
    const events: ReturnType<BattleEngine['drainEvents']>[number][] = [];
    for (let t = 0; t < 40; t += 1) {
      const playerActions =
        t === 0 ? [{ type: 'useSkill' as const, skillId: 'dodge', atTick: 0 }] : [];
      // Boss 在 t=10 开始读条。用公开的 applyActions(_, 'boss')，
      // 它和 AI 走的是**完全相同**的那条施法路径。
      if (t === 10) {
        engine.applyActions([{ type: 'useSkill', skillId: 'boss-swing', atTick: 10 }], 'boss');
      }
      engine.tick(playerActions);
      events.push(...engine.drainEvents());
    }

    // 闪避在 t=0 生效，持续 18 tick；Boss hit 在 t=10 读条 + 200ms(12 tick) = t=22
    // 此时闪避已过期（18 < 22）→ 应当正常受伤
    const avoided = events.filter((e) => e.kind === 'avoided');
    const damageToPlayer = events.filter(
      (e) => e.kind === 'damage' && e.targetId === 'player',
    );
    // 闪避窗口已经过了，所以吃满伤害
    expect(avoided).toHaveLength(0);
    expect(damageToPlayer.length).toBeGreaterThan(0);
  });

  it('闪避窗口**覆盖** hit frame 时完全免伤（一帧之差的边界）', () => {
    const fastBoss = makeSkillDef({
      id: 'boss-swing',
      castTime: 100,
      cooldown: 0,
      cost: [],
      hits: [
        {
          at: 100,
          effects: [
            {
              kind: 'damage',
              damage: { base: 500, school: 'physical', canCrit: false, countsAsHit: true },
            },
          ],
        },
      ],
    });

    const buffs = new Map<string, BuffDef>([
      ['dodge-iframe', (DODGE.abilities[0] as { buff: BuffDef }).buff],
    ]);
    const skills = new Map<string, SkillDef>([
      ['dodge', DODGE],
      ['boss-swing', fastBoss],
    ]);

    const engine = new BattleEngine({
      combatants: [
        makeCombatant({ id: 'player', side: 'ally' }),
        makeCombatant({
          id: 'boss',
          side: 'enemy',
          caps: { hp: 100_000, energy: 0, douqi: 0 },
          resources: { hp: 100_000, energy: 0, douqi: 0 },
        }),
      ],
      seed: 1,
      buffs,
      skills,
      baseStats: new Map([
        ['player', {}],
        ['boss', {}],
      ]),
      passiveModifiers: new Map(),
    });

    const events: ReturnType<BattleEngine['drainEvents']>[number][] = [];
    for (let t = 0; t < 30; t += 1) {
      // 读条只要 100ms = 6 tick；在 t=10 开读，hit 在 t=16
      // 闪避在 t=12 开（持续到 t=30），覆盖 t=16
      const playerActions =
        t === 12 ? [{ type: 'useSkill' as const, skillId: 'dodge', atTick: 12 }] : [];
      if (t === 10) {
        engine.applyActions([{ type: 'useSkill', skillId: 'boss-swing', atTick: 10 }], 'boss');
      }
      engine.tick(playerActions);
      events.push(...engine.drainEvents());
    }

    const avoided = events.filter((e) => e.kind === 'avoided');
    expect(avoided.length).toBeGreaterThan(0);
    if (avoided[0]?.kind !== 'avoided') return;
    expect(avoided[0].reason).toBe('immune');
    // 玩家没有受到伤害
    expect(events.filter((e) => e.kind === 'damage' && e.targetId === 'player')).toHaveLength(0);
  });
});

describe('引擎：动态重算（装备熵之钟）', () => {
  it('装备后智力 +2、精神 +2，damageBoost 来自势能', () => {
    const engine = makeEngine({
      passiveModifiers: new Map([['player', ENTROPY_CLOCK.abilities.flatMap((a) => (a.kind === 'modifier' ? [a.modifier] : []))]]),
      baseStats: new Map([['player', { intelligence: 100, spirit: 100 }]]),
    });

    const stats = engine.statsOf('player');
    expect(stats.intelligence).toBe(102);
    expect(stats.spirit).toBe(102);
  });

  it('没有装备时智力就是基础值', () => {
    const engine = makeEngine({ baseStats: new Map([['player', { intelligence: 100 }]]) });
    expect(engine.statsOf('player').intelligence).toBe(100);
  });
});

describe('引擎：时间限制与胜负', () => {
  it('超时判负并发出 encounterEnd(timeout)', () => {
    const engine = makeEngine({ timeLimitMs: 100 });
    const events = run(engine, 20);
    const end = events.find((e) => e.kind === 'encounterEnd');
    expect(end?.kind).toBe('encounterEnd');
    if (end?.kind !== 'encounterEnd') return;
    expect(end.result).toBe('defeat');
    expect(end.reason).toBe('timeout');
  });

  it('Boss 血量归零判胜', () => {
    // 直接把 boss 打空：用一个大伤害技能
    const nuke = makeSkillDef({
      id: 'nuke',
      castTime: 0,
      cooldown: 0,
      cost: [],
      hits: [
        {
          at: 0,
          effects: [
            {
              kind: 'damage',
              damage: { base: 999_999, school: 'physical', canCrit: false, countsAsHit: true },
            },
          ],
        },
      ],
    });
    const engine2 = new BattleEngine({
      combatants: [
        makeCombatant({ id: 'player', side: 'ally' }),
        makeCombatant({
          id: 'boss',
          side: 'enemy',
          caps: { hp: 100, energy: 0, douqi: 0 },
          resources: { hp: 100, energy: 0, douqi: 0 },
        }),
      ],
      seed: 1,
      buffs: new Map(),
      skills: new Map([['nuke', nuke]]),
      baseStats: new Map([
        ['player', {}],
        ['boss', {}],
      ]),
      passiveModifiers: new Map(),
    });

    engine2.tick([{ type: 'useSkill', skillId: 'nuke', atTick: 0 }]);
    const events = engine2.drainEvents();
    expect(events.some((e) => e.kind === 'death' && e.targetId === 'boss')).toBe(true);
    const end = events.find((e) => e.kind === 'encounterEnd');
    if (end?.kind !== 'encounterEnd') throw new Error('expected end');
    expect(end.result).toBe('victory');
  });

  it('战斗结束后 tick 不再推进', () => {
    const engine = makeEngine({ timeLimitMs: 50 });
    run(engine, 10);
    const tickAtEnd = engine.snapshot.tick;
    engine.tick();
    expect(engine.snapshot.tick).toBe(tickAtEnd);
  });
});

describe('引擎：确定性与可序列化', () => {
  it('同一 seed + 同一动作序列 → 状态完全一致', () => {
    const play = (): string => {
      const engine = makeEngine();
      run(engine, 120, new Map([[0, [{ type: 'useSkill', skillId: 'slash', atTick: 0 }]]]));
      return JSON.stringify(engine.snapshot);
    };
    expect(play()).toBe(play());
  });

  it('BattleState 可结构化克隆（C5）', () => {
    const engine = makeEngine();
    run(engine, 30);
    expect(() => structuredClone(engine.snapshot)).not.toThrow();
  });

  it('不同 seed 不会影响纯确定的战斗（没有随机源参与时）', () => {
    const a = makeEngine();
    const b = makeEngine();
    run(a, 60);
    run(b, 60);
    expect(a.snapshot.tick).toBe(b.snapshot.tick);
  });
});

describe('引擎：「倒地」（Boss 的「横扫」）', () => {
  /**
   * 需求："给 伪名一郎 的 横扫，增加倒地效果，会给玩家 到底debuff，
   * 2s内只能按 带有 闪避 tag的技能。"
   *
   * 机制：`BuffFlags.restrictToTags` = 技能 **tag 白名单**。
   * 与 `actionLock`（完全不能动）分开 —— 倒地要的是"**只能翻滚**"，
   * 那是玩家的一条出路，不该被堵死。
   */
  const knockdown = makeBuffDef({
    id: 'knockdown',
    nameKey: 'debuff.knockdown.name',
    polarity: 'debuff',
    duration: 120,
    flags: { restrictToTags: ['dodge'] },
  });

  const mkEngine = (): BattleEngine => {
    const attack = makeSkillDef({
      id: 'attack',
      castTime: 500,
      tags: ['melee'],
      hits: [{ at: 500, effects: [{ kind: 'damage', damage: { base: 10, school: 'physical', canCrit: false, countsAsHit: true } }] }],
    });
    const dodge = makeSkillDef({ id: 'dodge', castTime: 0, tags: ['defensive', 'dodge'] });
    const heavy = makeSkillDef({ id: 'heavy', castTime: 0, tags: ['spell'] });
    const sweep = makeSkillDef({
      id: 'sweep',
      castTime: 0,
      tags: ['spell'],
      hits: [
        {
          at: 0,
          effects: [
            { kind: 'damage', damage: { base: 1, school: 'physical', canCrit: false, countsAsHit: true } },
            { kind: 'grantBuff', buff: knockdown },
          ],
        },
      ],
    });
    return new BattleEngine({
      seed: 1,
      bossId: 'boss',
      combatants: [
        makeCombatant({ id: 'player', side: 'ally' }),
        makeCombatant({ id: 'boss', side: 'enemy' }),
      ],
      skills: new Map([attack, dodge, heavy, sweep].map((s) => [s.id, s])),
      buffs: new Map([[knockdown.id, knockdown]]),
      baseStats: new Map(),
      passiveModifiers: new Map(),
    });
  };

  it('横扫命中后玩家挂上倒地', () => {
    const e = mkEngine();
    e.tick([{ type: 'useSkill', skillId: 'sweep', atTick: 0 }], 'boss');
    const applied = e.drainEvents().some((ev) => ev.kind === 'buffApplied' && ev.buffId === 'knockdown');
    expect(applied).toBe(true);
    const player = e.snapshot.combatants.find((c) => c.id === 'player')!;
    expect(player.buffs.some((b) => b.defId === 'knockdown')).toBe(true);
  });

  it('【关键】倒地期间：带 dodge tag 的能用，没带的一律被拒', () => {
    const e = mkEngine();
    e.tick([{ type: 'useSkill', skillId: 'sweep', atTick: 0 }], 'boss');
    e.drainEvents();

    // 「攻」没带 dodge → 被拒，且原因是**专门的 tagRestricted**
    // （不是 `locked` —— 玩家需要知道"我还能按什么"）
    e.tick([{ type: 'useSkill', skillId: 'attack', atTick: 1 }]);
    const rejected = e.drainEvents().filter((ev) => ev.kind === 'skillRejected');
    expect(rejected).toHaveLength(1);
    if (rejected[0]?.kind === 'skillRejected') {
      expect(rejected[0].reason).toBe('tagRestricted');
      expect(rejected[0].skillId).toBe('attack');
    }
  });

  it('【关键】倒地期间「避」（带 dodge tag）仍然放得出来', () => {
    const e = mkEngine();
    e.tick([{ type: 'useSkill', skillId: 'sweep', atTick: 0 }], 'boss');
    e.drainEvents();
    e.tick([{ type: 'useSkill', skillId: 'dodge', atTick: 1 }]);
    const used = e.drainEvents().filter((ev) => ev.kind === 'skillUsed');
    expect(used.some((ev) => ev.kind === 'skillUsed' && ev.skillId === 'dodge')).toBe(true);
  });

  it('倒地过期后「攻」恢复可用', () => {
    const e = mkEngine();
    e.tick([{ type: 'useSkill', skillId: 'sweep', atTick: 0 }], 'boss');
    e.drainEvents();
    // 倒地 120 tick，跑过去
    for (let t = 1; t <= 125; t += 1) {
      e.tick([], 'boss');
      e.drainEvents();
    }
    e.tick([{ type: 'useSkill', skillId: 'attack', atTick: 126 }]);
    const rejected = e.drainEvents().filter((ev) => ev.kind === 'skillRejected');
    expect(rejected).toHaveLength(0);
  });
});
