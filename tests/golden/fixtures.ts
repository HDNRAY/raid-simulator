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
    id: 'meiichiro',
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
    bossId: 'meiichiro',
    timeLimitMs: 180_000,
    buffs: registry.buffs,
    skills: registry.skills,
    baseStats: new Map<string, Partial<Record<StatKey, number>>>([
      ['player', PLAYER_BASE],
      ['meiichiro', {}],
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
   * 当前平衡下"会闪避"的玩家获胜。
   *
   * 实测（规范策略）—— **2026-10-10 加了「倒地」重新标定**：
   *   - 用时 **926** tick ≈ 15.4 秒
   *   - 玩家剩 **65 血**
   *   - 只按「攻」（完美进攻、零防御）：**败**，Boss 还剩 30 血
   *
   * 也就是需求要的"不防御就算完美进攻也打不过"。
   *
   * ⚠️ **「倒地」让会闪避的玩家变强了**（22 血 → 65 血）。
   * A/B 实测（同一策略，只把「横扫」的倒地效果摘掉做对照）：
   *
   *   | | ticks | 玩家 hp | 玩家造成 | 玩家**承受** | 闪避次数 |
   *   | 有倒地 | 926 | 65 | 210 | **35** | **2** |
   *   | 无倒地 | 746 | 22 | 210 | **78** | 1 |
   *
   * **玩家总伤害完全相同（210）** —— 因为「攻」是瞬发，
   * 2 秒的倒地窗口不影响输出；变的是**承受伤害减半**：
   * 倒地窗口让「避」（0.5s 无敌）的时机正好对上横扫，多闪掉一次。
   *
   * 这是「倒地」的**副作用**，不是设计意图。要不要调（例如让倒地也
   * 延长横扫的间隔、或给「避」加冷却）需要产品决策 —— 见
   * `docs/plans` 里的记录。
   *
   * Boss 数值（2026-10-09 末次）：
   *   重斩 前摇 1.8s / 伤害 28 / 冷却 6s / 轮转间隔 2.2s
   *   横扫 前摇 2.2s / 伤害 36 / 冷却 10s / 轮转间隔 6.4s
   *   血量 210
   *
   * ⚠️ **Boss 血量随"读条结算时机"的修复上调过**：
   * 修好"读条没走完就结算伤害"之后，玩家伤害要等读条走完才生效
   * （晚 500ms），整体输出变低，于是纯进攻反而能险胜。
   * 血量 160 → 210 把这条差值补回来。
   *
   * ⚠️ 两个增伤是**叠乘**的：`boss-empowered`(+30%) × `boss-frenzy`(+25%)，
   * 所以纸面 28/36 实际能打到 40+。
   */
  status: 'victory' as const,
  endReason: 'hpZero' as const,
  /** 通关用时（tick）。连续量，对数值改动敏感。 */
  ticks: 926,
  /**
   * 当前内容没有暴击判定，所以随机数一次都不被消耗。
   *
   * 注意这里**没有 `phase`** —— 引擎已经没有"阶段"这个概念了：
   * Boss 的阶段是一层内容 buff（`boss-frenzy`），由 `onHpBelow` 授予，
   * 轮转用 `when: hasBuff(...)` 换招。
   */
  finalRngSeed: 20261009,
  combatants: {
    player: { alive: true, hp: 65, energy: 5, douqi: 53, damageDealt: 0, damageTaken: 0 },
    meiichiro: { alive: false, hp: 0, energy: 0, douqi: 0, damageDealt: 0, damageTaken: 0 },
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
     *   400ms —— 当时的取值。
     *   600ms —— **当前的取值**。玩家现在有 500ms 读条（「攻」），
     *     所以闪避要再晚一点按，无敌窗口才盖得住命中时刻。
     *     实测扫描（见下）：500–700ms 能完全免伤，峰值在 600ms。
     *
     * 数值是扫出来的，不是猜的：
     *   lead=  0ms → 剩 27 血      lead= 500ms → 剩 100 血（免伤）
     *   lead=200ms → 剩 57 血      lead= 600ms → 剩 100 血（免伤）
     *   lead=400ms → 剩 90 血      lead= 800ms → 剩  88 血（又挨打了）
     *
     * 两端都会变差，说明这是个**窗口**而不是"越早越好" ——
     * 这正是玩法想要的手感。
     */
    readonly dodgeLeadMs?: number;
  } = {},
): (tick: number, state: BattleState) => readonly Action[] {
  const leadMs = options.dodgeLeadMs ?? 500;
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
        /**
         * **只对"会造成伤害"的招式闪避。**
         *
         * 踩过的坑：早期只看"Boss 在读条"就闪，于是连不造成伤害的
         * 「蓄能」也闪 —— 白白花掉 30 炁（= 3 次「攻」的代价）。
         * 实测表现为 **"会闪"反而比"不闪"输得更惨**（190 血时：
         * 会闪败、不闪胜剩 4 血），让人误以为闪避机制没用，
         * 其实是**策略在乱闪**。
         *
         * 真人对"纯增益招式"不会闪，所以策略也不该闪。
         */
        const skillDef = registry.skills.get(cast.skillId);
        const dealsDamage = (skillDef?.hits ?? []).some((h) =>
          h.effects.some((e) => e.kind === 'damage'),
        );
        const elapsedMs = (tick - cast.startedAtTick) * (1000 / 60);
        const remainingMs = cast.castTimeMs - elapsedMs;
        if (dealsDamage && remainingMs > 0 && remainingMs <= leadMs) {
          const skill = registry.skills.get(options.dodgeSkillId);
          /**
           * **只在"这次攻击真的会打到我"时才闪。**
           *
           * 踩过的坑：早期版本只要 Boss 在读条就闪 —— 包括那些
           * 前摇刚好被公共冷却挡住的时刻。结果是白白花掉 30 炁
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
           * 一次读条烧掉 360 点缠，把输出的能量全抢走，
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
 * 顺序即"玩家会优先按哪个键"：凝（增伤）→ 轰（炁爆发）→ 攻（填充）。
 * 破与防不在优先级里 —— 它们要在看到 Boss 读条时才用（见 `planPriority`）。
 */
export const OUTPUT_PRIORITY = ['focus', 'blast', 'attack'] as const;
