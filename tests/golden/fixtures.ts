import { BattleEngine, type CreateBattleOptions } from '../../src/core/combat/battleState';
import { VERROT_BEHAVIORS } from '../../src/core/ai';
import { createRegistry } from '../../src/core/content/registry';
import { ALL_BUFFS, ALL_SKILLS } from '../../src/data/content';
import { ENTROPY_CLOCK } from '../../src/data/entities/entropyClock';
import { flattenCatalog } from '../../src/i18n/translator';
import { zhCN } from '../../src/i18n/locales/zh-CN';
import { roughlyUsable, type EngineOptions, type RunOutcome } from '../../src/core/run';
import type { Action, BattleState, Combatant, StatKey, StatModifier } from '../../src/core/types';

/**
 * 黄金重放与集成测试**共用**的夹具。
 *
 * 抽出来的理由：这些数值（种子、血量、基础属性）是"黄金"的一部分 ——
 * 如果两处各写一份，它们会各自漂移，而重放的价值就在于唯一性。
 */

/** 固定种子。改它等于让所有黄金断言失效，所以只在这里出现一次。 */
export const FIXED_SEED = 20261009;

export const PLAYER_CAPS = { hp: 12_000, energy: 120, douqi: 100 } as const;
export const BOSS_CAPS = { hp: 170_000, energy: 0, douqi: 0 } as const;

export const PLAYER_BASE: Partial<Record<StatKey, number>> = {
  strength: 120,
  agility: 100,
  intelligence: 110,
  spirit: 100,
  energyRegen: 22,
  critChance: 0.2,
  critDamage: 0.5,
};

const localeKeys = new Set(flattenCatalog(zhCN).keys());

/** 真实内容 + 校验通过（`localeKeys` 由调用方注入，core 不读语言包）。 */
export const registry = createRegistry(
  { entities: [ENTROPY_CLOCK], skills: [...ALL_SKILLS], buffs: [...ALL_BUFFS] },
  { localeKeys },
);

export function makePlayer(): Combatant {
  return {
    id: 'player',
    nameKey: 'hud.you',
    side: 'ally',
    caps: { ...PLAYER_CAPS },
    resources: { hp: PLAYER_CAPS.hp, energy: PLAYER_CAPS.energy, douqi: 0 },
    counters: {},
    basePrimary: { strength: 120, agility: 100, intelligence: 110, spirit: 100 },
    buffs: [],
    cooldowns: {},
    casts: [],
    uses: {},
    behaviors: [],
    alive: true,
  };
}

export function makeBoss(): Combatant {
  return {
    id: 'verrot',
    nameKey: 'boss.name',
    side: 'enemy',
    caps: { ...BOSS_CAPS },
    resources: { hp: BOSS_CAPS.hp, energy: 0, douqi: 0 },
    counters: {},
    basePrimary: { strength: 400, agility: 200, intelligence: 300, spirit: 200 },
    buffs: [],
    cooldowns: {},
    casts: [],
    uses: {},
    behaviors: VERROT_BEHAVIORS,
    alive: true,
  };
}

/**
 * 玩家带的装备（熵之钟）。
 *
 * 把 `derived` 的表达式也摊平进修正池 —— 装备就是"被动修正的集合"，
 * 而派生修正在数据结构上就是"带表达式的修正"。
 */
export function clockModifiers(): StatModifier[] {
  const out: StatModifier[] = [];
  for (const ability of ENTROPY_CLOCK.abilities) {
    if (ability.kind === 'modifier') out.push(ability.modifier);
    else if (ability.kind === 'derived') out.push({ ...ability.modifier, value: ability.value });
  }
  return out;
}

/** 标准引擎参数。`overrides` 允许测试改单个字段。 */
export function makeGoldenEngineOptions(
  seed = FIXED_SEED,
  overrides: Partial<CreateBattleOptions> = {},
): EngineOptions {
  return {
    combatants: [makePlayer(), makeBoss()],
    seed,
    bossId: 'verrot',
    timeLimitMs: 180_000,
    buffs: registry.buffs,
    skills: registry.skills,
    baseStats: new Map<string, Partial<Record<StatKey, number>>>([
      ['player', PLAYER_BASE],
      ['verrot', {}],
    ]),
    passiveModifiers: new Map([['player', clockModifiers()]]),
    ...overrides,
  };
}

/** 一个纯粹用于观察的引擎（不走重放）。 */
export function makeEngine(seed = FIXED_SEED): BattleEngine {
  return new BattleEngine(makeGoldenEngineOptions(seed));
}

/**
 * 黄金结果常量。
 *
 * **这个常量被测试断言精确匹配。** 如果它变了，说明某个改动
 * 改变了整场战斗 —— 那正是需要被注意到的事。
 * 更新它之前先确认：变化是本次改动**有意**造成的吗？
 */
export const GOLDEN_OUTCOME = {
  status: 'victory' as const,
  endReason: 'hpZero' as const,
  /** 击杀用时（tick）。这是个**连续量**，所以对数值改动敏感。 */
  ticks: 6455,
  phase: 3,
  /**
   * 随机数终态。
   *
   * 它同时验证两件事：暴击判定确实消耗了随机数（否则这里会等于初始种子），
   * 以及消耗顺序是可复现的。
   */
  finalRngSeed: 996_765_970,
  combatants: {
    player: { alive: true, hp: 8798, energy: 120, douqi: 0, damageDealt: 0, damageTaken: 0 },
    verrot: { alive: false, hp: 0, energy: 0, douqi: 0, damageDealt: 0, damageTaken: 0 },
  },
} satisfies Omit<RunOutcome, 'ticks'> & { readonly ticks: number };

/**
 * 一个可以被重放复用的玩家策略：**每 tick 按优先级尝试**。
 *
 * 刻意不用手写动作时间表 —— 那种输入会随 GCD / 代价改动而整体失效，
 * 让重放因为"技能被拒"而失败，掩盖真正想检测的行为变化。
 *
 * @param priority 技能 id，顺序即优先级
 * @param dodgeSkillId 看到 Boss 读条时要插的防御技（不给则不躲）
 */
export function planPriority(
  priority: readonly string[],
  options: {
    readonly dodgeSkillId?: string;
    /** 在命中前多少毫秒闪避。默认 200（闪避免疫窗口是 300ms）。 */
    readonly dodgeLeadMs?: number;
  } = {},
): (tick: number, state: BattleState) => readonly Action[] {
  const leadMs = options.dodgeLeadMs ?? 200;
  return (tick, state) => {
    /**
     * 会躲的玩家：**在命中前一点点闪避**，而不是一看到读条就闪。
     *
     * 踩过的坑：早期版本一看到 `casts.length > 0` 就闪 —— 而 Boss 的
     * 前摇有 1.2 秒，闪避的无敌窗口只有 300ms，于是 iframe 在命中前
     * 早就过期了。表现为"策略明明在闪避，却一点伤害都没躲掉"，
     * 看起来像是判定层坏了。
     *
     * 这正是玩法本身要求的时机判断，所以测试策略必须也做对。
     */
    if (options.dodgeSkillId !== undefined) {
      const boss = state.combatants.find((c) => c.side === 'enemy');
      const cast = boss?.casts[0];
      if (cast !== undefined) {
        const elapsedMs = (tick - cast.startedAtTick) * (1000 / 60);
        const remainingMs = cast.castTimeMs - elapsedMs;
        if (remainingMs > 0 && remainingMs <= leadMs) {
          const skill = registry.skills.get(options.dodgeSkillId);
          if (roughlyUsable(options.dodgeSkillId, state, skill)) {
            return [{ type: 'useSkill', skillId: options.dodgeSkillId, atTick: tick }];
          }
        }
      }
    }

    for (const skillId of priority) {
      const skill = registry.skills.get(skillId);
      if (roughlyUsable(skillId, state, skill)) {
        return [{ type: 'useSkill', skillId, atTick: tick }];
      }
    }
    return [];
  };
}

/** 输出优先级（黄金重放用）。 */
export const OUTPUT_PRIORITY = ['finisher', 'rend', 'heavyStrike', 'riposte', 'strike'] as const;
