import { BattleEngine, type CreateBattleOptions } from '../../src/core/combat/battleState';
import { VERROT_BEHAVIORS } from '../../src/core/ai';
import { createRegistry } from '../../src/core/content/registry';
import { ALL_BUFFS, ALL_SKILLS, DOUQI_MAX, ENERGY_MAX, HP_MAX } from '../../src/data/content';
import { BOSS_HP_DISPLAY } from '../../src/data/entities/bossHp';
import { flattenCatalog } from '../../src/i18n/translator';
import { zhCN } from '../../src/i18n/locales/zh-CN';
import { roughlyUsable, type EngineOptions, type RunOutcome } from '../../src/core/run';
import type { Action, BattleState, Combatant, StatKey } from '../../src/core/types';

/**
 * 黄金重放与集成测试**共用**的夹具。
 *
 * 抽出来的理由：这些数值（种子、血量、基础属性）是"黄金"的一部分 ——
 * 如果两处各写一份，它们会各自漂移，而重放的价值就在于唯一性。
 */

/** 固定种子。改它等于让所有黄金断言失效，所以只在这里出现一次。 */
export const FIXED_SEED = 20261009;

/**
 * 上限（**展示刻度**：100 制）。
 *
 * 内容的伤害值本身就是展示刻度（攻 10 / 轰 30），所以这里同刻度 ——
 * 早期把血量乘了 `DISPLAY_SCALE` 而伤害没乘，10 点伤害只打掉 1 点血。
 */
export const PLAYER_CAPS = {
  hp: HP_MAX,
  energy: ENERGY_MAX,
  douqi: DOUQI_MAX,
} as const;
/** Boss 血量。取值依据见 `data/entities/bossHp.ts`（实测出来的）。 */
export const BOSS_CAPS = { hp: BOSS_HP_DISPLAY, energy: 0, douqi: 0 } as const;

/**
 * 玩家基础属性。
 *
 * 新刻度下技能伤害都是内容里写死的固定值，所以主属性不再影响伤害 ——
 * 只留最小值让属性系统可用。
 */
export const PLAYER_BASE: Partial<Record<StatKey, number>> = {
  strength: 10,
  agility: 10,
  intelligence: 10,
  spirit: 10,
};

const localeKeys = new Set(flattenCatalog(zhCN).keys());

/** 真实内容 + 校验通过（`localeKeys` 由调用方注入，core 不读语言包）。 */
export const registry = createRegistry(
  { entities: [], skills: [...ALL_SKILLS], buffs: [...ALL_BUFFS] },
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
    passiveModifiers: new Map(),
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
  /**
   * 当前平衡下"会闪 + 会轰"的玩家**险胜**。
   *
   * 实测（不是估计）：
   *   - 用时 898 tick ≈ 15.0 秒
   *   - 玩家剩 **30 血**（满血 100）
   *   - Boss 承伤约 4.9 DPS，所以玩家约能撑 20 秒
   *
   * 同一条策略如果**只按「攻」**也能赢，但要多花 3 秒（17.9s）——
   * 说明「轰」是效率工具而不是通关必需。真正的门槛是**别站着挨打**：
   * Boss 不还手时玩家 12.4 秒满血通关。
   */
  status: 'victory' as const,
  endReason: 'hpZero' as const,
  /** 通关用时（tick）。连续量，对数值改动敏感。 */
  ticks: 898,
  phase: 3,
  /** 当前内容没有暴击判定，所以随机数一次都不被消耗。 */
  finalRngSeed: 20261009,
  combatants: {
    player: { alive: true, hp: 30, energy: 0, douqi: 12, damageDealt: 0, damageTaken: 0 },
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
    /**
     * 在命中前多少毫秒闪避。默认 400。
     *
     * 「闪」的无敌窗口是 0.5 秒（500ms），所以要在命中前
     * **不超过 500ms、也不要太接近 0** 的时刻按下：
     *
     *   150ms（早期取值）—— 太紧。因为"预测"是按 tick 粒度做的，
     *     而 Boss 可能在闪避的无敌窗口**结束之后**才开始下一次读条，
     *     于是两发重击只躲掉零发（实测"成功规避=0"）。
     *   400ms —— 留出完整窗口覆盖命中时刻，同时仍有余量吸收
     *     预测误差与人类反应时间。
     */
    readonly dodgeLeadMs?: number;
  } = {},
): (tick: number, state: BattleState) => readonly Action[] {
  const leadMs = options.dodgeLeadMs ?? 400;
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
          /**
           * **只在"这次攻击真的会打到我"时才闪。**
           *
           * 踩过的坑：早期版本只要 Boss 在读条就闪 —— 包括那些
           * 前摇刚好被公共冷却挡住的时刻。结果是白白花掉 40 精力
           * （= 4 次「攻」的代价），实测"会闪"反而比"不闪"输得更惨。
           *
           * 所以这里要求：闪完之后还够打一次「攻」，
           * 否则宁可挨这一下 —— 这与真人玩家的取舍一致。
           */
          /**
           * **已经处于无敌窗口里就不要再闪了。**
           *
           * 踩过的坑：`remainingMs <= leadMs` 这个条件在 150ms 的
           * 窗口里会命中约 9 个 tick，于是每个 tick 都闪一次 ——
           * 一次读条烧掉 360 点精力，把输出的能量全抢走，
           * 结果"会闪"反而输得比"不闪"更惨。
           */
          const alreadyImmune = (state.combatants.find((c) => c.side === 'ally')?.buffs ?? []).some(
            (b) => b.defId === 'dodge-iframe',
          );
          if (alreadyImmune) {
            // 直接跳到输出循环
          } else {
          const attackCost = registry.skills.get('attack')?.cost[0];
          const needForAttack =
            attackCost !== undefined && typeof attackCost.value === 'number' ? attackCost.value : 0;
          const energyNow =
            (state.combatants.find((c) => c.side === 'ally')?.resources.energy ?? 0);
          const dodgeCost = skill?.cost[0];
          const needForDodge =
            dodgeCost !== undefined && typeof dodgeCost.value === 'number' ? dodgeCost.value : 0;
          if (energyNow >= needForDodge + needForAttack && roughlyUsable(options.dodgeSkillId, state, skill)) {
            return [{ type: 'useSkill', skillId: options.dodgeSkillId, atTick: tick }];
          }
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

/**
 * 输出优先级（黄金重放用）。
 *
 * 顺序即"玩家会优先按哪个键"：凝（增伤）→ 轰（斗炁爆发）→ 攻（填充）。
 * 破与御不在优先级里 —— 它们要在看到 Boss 读条时才用（见 `planPriority`）。
 */
export const OUTPUT_PRIORITY = ['focus', 'blast', 'attack'] as const;
