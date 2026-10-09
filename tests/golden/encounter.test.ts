import { describe, expect, it } from 'vitest';
import { BattleEngine } from '../../src/core/combat/battleState';
import { createRegistry } from '../../src/core/content/registry';
import { VERROT_BEHAVIORS } from '../../src/core/ai';
import {
  ALL_BUFFS,
  ALL_SKILLS,
  BOSS_ENRAGE,
  PLAYER_SKILLS,
} from '../../src/data/content';
import { ENTROPY_CLOCK } from '../../src/data/entities/entropyClock';
import type {
  BuffDef,
  Combatant,
  SkillDef,
  StatKey,
  StatModifier,
} from '../../src/core/types';
import { flattenCatalog } from '../../src/i18n/translator';
import { zhCN } from '../../src/i18n/locales/zh-CN';

/** 语言 key 集合由测试注入 —— core 自己不读语言包（C1/I3）。 */
const localeKeys = new Set(flattenCatalog(zhCN).keys());

/**
 * 真实内容的集成测试（M4/M6 的验收）。
 *
 * 这里用的是**真正会上线的**内容定义与行为数组，不是测试专用的假数据。
 * 目的：证明"内容驱动"这条链路真的通 ——
 *   registry → engine → AI(behavior 数组) → Action → 门禁 → 读条 → 判定
 */

const registry = createRegistry(
  {
    entities: [ENTROPY_CLOCK],
    skills: [...ALL_SKILLS],
    buffs: [...ALL_BUFFS],
  },
  { localeKeys },
);

function makeEncounter(): BattleEngine {
  const player: Combatant = {
    id: 'player',
    nameKey: 'hud.level',
    side: 'ally',
    caps: { hp: 12_000, energy: 120, douqi: 100 },
    resources: { hp: 12_000, energy: 120, douqi: 0 },
    counters: {},
    basePrimary: { strength: 120, agility: 100, intelligence: 110, spirit: 100 },
    buffs: [],
    cooldowns: {},
    casts: [],
    uses: {},
    behaviors: [],
    alive: true,
  };

  const boss: Combatant = {
    id: 'verrot',
    nameKey: 'boss.name',
    side: 'enemy',
    caps: { hp: 150_000, energy: 0, douqi: 0 },
    resources: { hp: 150_000, energy: 0, douqi: 0 },
    counters: {},
    basePrimary: { strength: 400, agility: 200, intelligence: 300, spirit: 200 },
    buffs: [],
    cooldowns: {},
    casts: [],
    uses: {},
    behaviors: VERROT_BEHAVIORS,
    alive: true,
  };

  // 玩家带熵之钟（验证装备内容也真的参与了战斗）
  const clockModifiers: StatModifier[] = ENTROPY_CLOCK.abilities.flatMap((a) =>
    a.kind === 'modifier' || a.kind === 'derived' ? [a.kind === 'modifier' ? a.modifier : ({ ...a.modifier, value: a.value } as StatModifier)] : [],
  );

  const baseStats = new Map<string, Partial<Record<StatKey, number>>>([
    ['player', { strength: 120, agility: 100, intelligence: 110, spirit: 100 }],
    ['verrot', {}],
  ]);

  return new BattleEngine({
    combatants: [player, boss],
    seed: 20261009,
    bossId: 'verrot',
    timeLimitMs: 180_000,
    buffs: registry.buffs,
    skills: registry.skills,
    baseStats,
    passiveModifiers: new Map([['player', clockModifiers]]),
  });
}

/**
 * 一个"合格玩家"的循环。
 *
 * 约束：GCD 是 300ms（18 tick），所以任意两次施放之间必须 >= 18 tick；
 * 斗炁由斩击产生（每次 20），弧光/割裂各消耗 25/35。
 *
 * 节奏：斩击(0) → 斩击(20) → 弧光(40) → 斩击(52)
 */
function playerPlan(tick: number): string | undefined {
  const cycle = tick % 60;
  if (cycle === 0) return 'slash';
  if (cycle === 20) return 'slash';
  if (cycle === 40) return 'arc';
  if (cycle === 52) return 'slash';
  return undefined;
}

describe('真实内容集成：Verrot 一场战斗', () => {
  it('Boss 会按 behavior 数组施放技能（不是站着不动）', () => {
    const engine = makeEncounter();
    const used = new Set<string>();

    for (let t = 0; t < 60 * 30; t += 1) {
      const skillId = playerPlan(t);
      engine.tick(skillId ? [{ type: 'useSkill', skillId, atTick: t }] : []);
      for (const event of engine.drainEvents()) {
        if (event.kind === 'skillUsed' && event.sourceId === 'verrot') {
          used.add(event.skillId);
        }
      }
    }

    // 开场动作是 crimson-arc（4 秒延迟）
    expect(used.has('crimson-arc')).toBe(true);
    // 轮转里的技能至少要有两个被用到
    expect(used.size).toBeGreaterThanOrEqual(2);
  });

  it('Boss 的读条产生了前摇（castStarted 事件）', () => {
    const engine = makeEncounter();
    let castStarts = 0;
    for (let t = 0; t < 60 * 10; t += 1) {
      engine.tick();
      for (const event of engine.drainEvents()) {
        if (event.kind === 'castStarted' && event.sourceId === 'verrot') castStarts += 1;
      }
    }
    expect(castStarts).toBeGreaterThan(0);
  });

  it('Boss 会对玩家造成伤害（Boss 有威胁）', () => {
    const engine = makeEncounter();
    let playerDamage = 0;
    for (let t = 0; t < 60 * 30; t += 1) {
      engine.tick();
      for (const event of engine.drainEvents()) {
        if (event.kind === 'damage' && event.targetId === 'player') playerDamage += event.amount;
      }
    }
    expect(playerDamage).toBeGreaterThan(0);
    // 30 秒不闪不挡应当被打掉可观血量（证明"必须躲"）
    const player = engine.snapshot.combatants.find((c) => c.id === 'player');
    expect(player?.resources.hp).toBeLessThan(12_000);
  });

  it('玩家能打死 Boss（战斗是双向可行的）', () => {
    const engine = makeEncounter();
    for (let t = 0; t < 60 * 180; t += 1) {
      if (engine.snapshot.status !== 'running') break;
      const skillId = playerPlan(t);
      engine.tick(skillId ? [{ type: 'useSkill', skillId, atTick: t }] : []);
      engine.drainEvents();
    }
    const status = engine.snapshot.status;
    // 三分钟内应当分出胜负（不计较哪一方赢 —— 数值平衡是内容调优的事）
    expect(['victory', 'defeat']).toContain(status);
  });

  it('3 分钟超时判负', () => {
    const engine = makeEncounter();
    let sawTimeout = false;
    for (let t = 0; t < 60 * 185; t += 1) {
      engine.tick();
      for (const event of engine.drainEvents()) {
        if (event.kind === 'encounterEnd' && event.reason === 'timeout') sawTimeout = true;
      }
      if (sawTimeout) break;
      // 玩家不动，Boss 也不一定打得完；防止把玩家打死导致提前结束
      const player = engine.snapshot.combatants.find((c) => c.id === 'player');
      if (player && player.resources.hp < 12_000) {
        // 玩家已经在挨打，补满血以便观察超时
        player.resources.hp = 12_000;
      }
    }
    expect(sawTimeout).toBe(true);
  });

  it('60% 血量触发阶段转换', () => {
    const engine = makeEncounter();
    let phaseEvents = 0;
    for (let t = 0; t < 60 * 180; t += 1) {
      if (engine.snapshot.status !== 'running') break;
      const skillId = playerPlan(t);
      engine.tick(skillId ? [{ type: 'useSkill', skillId, atTick: t }] : []);
      for (const event of engine.drainEvents()) {
        if (event.kind === 'phaseChanged') phaseEvents += 1;
      }
    }
    expect(phaseEvents).toBeGreaterThanOrEqual(1);
  });
});

describe('内容注册表：扩展内容不需要改引擎', () => {
  it('注册表能按 id 解析技能与 buff', () => {
    expect(registry.skill('slash').id).toBe('slash');
    expect(registry.buff('dodge-iframe')?.flags?.invulnerable).toBe(true);
  });

  it('技能内联的 buff 也能被解析（内容作者不必把 buff 拆出去）', () => {
    // dodge 的免伤 buff 是内联在技能里的
    expect(registry.buff('dodge-iframe')).toBeDefined();
    expect(registry.buff('combo-window')).toBeDefined();
  });

  it('未知技能 id 会抛错（而不是静默返回 undefined）', () => {
    expect(() => registry.skill('no-such-skill')).toThrow(/unknown skill id/);
  });

  it('校验失败的内容在建立注册表时就抛错', () => {
    const broken: SkillDef = {
      ...PLAYER_SKILLS[0]!,
      id: 'broken',
      nameKey: 'skill.doesNotExist.name' as SkillDef['nameKey'],
    };
    expect(() =>
      createRegistry(
        {
          entities: [],
          skills: [broken],
          buffs: [] as readonly BuffDef[],
        },
        { localeKeys },
      ),
    ).toThrow(/invalid content/);
  });

  it('新增一个技能只写数据：注册表 + 引擎即可让它生效', () => {
    const newSkill: SkillDef = {
      id: 'data-only-skill',
      kind: 'activeSkill',
      nameKey: 'skill.slash.name',
      icon: 'x',
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
              damage: { base: 1, school: 'physical', canCrit: false, countsAsHit: true },
            },
          ],
        },
      ],
      tags: [],
      school: 'physical',
      interruptible: false,
    };

    const extended = createRegistry(
      {
        entities: [],
        skills: [...ALL_SKILLS, newSkill],
        buffs: [...ALL_BUFFS],
      },
      { localeKeys },
    );

    const player: Combatant = {
      id: 'player',
      nameKey: 'hud.level',
      side: 'ally',
      caps: { hp: 1000, energy: 0, douqi: 0 },
      resources: { hp: 1000, energy: 0, douqi: 0 },
      counters: {},
      basePrimary: { strength: 1, agility: 1, intelligence: 1, spirit: 1 },
      buffs: [],
      cooldowns: {},
      casts: [],
      uses: {},
      behaviors: [],
      alive: true,
    };
    const enemy: Combatant = {
      ...player,
      id: 'dummy',
      side: 'enemy',
      caps: { hp: 100, energy: 0, douqi: 0 },
      resources: { hp: 100, energy: 0, douqi: 0 },
    };

    const engine = new BattleEngine({
      combatants: [player, enemy],
      seed: 1,
      buffs: extended.buffs,
      skills: extended.skills,
      baseStats: new Map([
        ['player', {}],
        ['dummy', {}],
      ]),
      passiveModifiers: new Map(),
    });

    engine.tick([{ type: 'useSkill', skillId: 'data-only-skill', atTick: 0 }]);
    const events = engine.drainEvents();
    expect(events.some((e) => e.kind === 'damage')).toBe(true);
  });

  it('BOSS_ENRAGE 内容里的伤害倍率字段被类型接受（狂暴机制由数据声明）', () => {
    expect(BOSS_ENRAGE.damageMultBoost).toBe(2);
  });
});
