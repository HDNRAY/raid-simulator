import { BattleEngine, type CreateBattleOptions } from '../../src/core/combat/battleState';
import { PRIDE_BEHAVIORS } from '../../src/data/bossPride';
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
    behaviors: PRIDE_BEHAVIORS,
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
   * ⚠️ **2026-10-11 改造「傲慢」后重新标定**（快慢刀 + 霸体合并 +
   * 随机选招，见 `docs/specs/2026-10-11-pride-boss.md` §9.3）：
   *   三招 1.0s/20、1.5s/40、2.0s/60，冷却全 3s，`gapMs` 4s（= §Q5 推荐）；
   *   60 起手自带霸体并附带「倒地」；半血有一次可打断的「回补」。
   *
   * 下面的实测表是**旧 Boss（伪名一郎）的记录，刻意保留** ——
   * 它记录了「倒地」这个机制的副作用，对下一个人仍然有用。
   * 它描述的不是当前内容。
   *
   * ⚠️ **当前平衡的实测数字在 `src/data/entities/bossHp.ts`**（那里跟着
   * 数值改动一起更新）。要比较"这次改动变了多少"，读那一份，不要读这里。
   *
   * 实测（规范策略）—— **2026-10-10 加了「倒地」重新标定**：
   *   - 用时 **926** tick ≈ 15.4 秒
   *   - 玩家剩 **65 血**
   *   - 只按「斩」（完美进攻、零防御）：**败**，Boss 还剩 30 血
   *
   * 也就是需求要的"不防御就算完美进攻也打不过"。
   *
   * ⚠️ **「倒地」让会闪避的玩家变强了**（22 血 → 65 血）。
   * A/B 实测（同一策略，只把「横扫」的倒地效果摘掉做对照）：
   *
   *   | | ticks | 玩家出手 | 玩家命中 | boss 出手 | **boss 命中** | 玩家承受 | 闪避 |
   *   | 有倒地 | 926 | 25 | 19 | 5 | **1** | **35** | **2** |
   *   | 无倒地 | 746 | 25 | 19 | 4 | **2** | **78** | 1 |
   *
   * ⚠️ **别用"造成伤害"来比较** —— Boss 血量固定 210，打完就是 0，
   * 所以那个数字在两场里都等于 210，**不含任何信息**。（我一度用它
   * 来论证"倒地不影响输出"，那是**无效论证**。）
   *
   * 有效的度量是**出手/命中次数**：玩家出手在两场里**完全相同（25 次）**
   * —— 倒地 2 秒的封锁**没有让玩家少出手**（战斗长了 180 tick，
   * 而那 2 秒本来就在读条/等 CD）。
   *
   * 差异全在 **boss 命中次数：2 → 1** —— 玩家**多闪掉一次**，
   * 承受伤害因此从 78 掉到 35。这是「倒地」的**副作用**，不是设计意图。
   *
   * ⚠️ 「倒地就不能攻」这条**机制本身是对的**（用户已确认），
   * 实测倒地窗口内「斩」被拒 94 次、成功 0 次。要不要削弱那个副作用
   * （例如给「避」加冷却）是产品决策。
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
  /**
   * 通关用时（tick）。连续量，对数值改动敏感。
   *
   * ⚠️ **926 → 5696**（2026-10-11）。那一次改了四件事：
   *   傲慢血量 210 → **420**；二阶段门槛 50% → **40%**；回补 63 → **126**；
   *   「斩」10 → **15 炁**、「避」30 → **15 炁**；
   *   并且**把参考策略升级成"会攒炁"的**（见 `planPriority` 的说明）。
   *
   * 15.4 秒 → **94.9 秒**。变长的原因是炁：斩 15 炁 + 每秒回 10
   * ⇒ 持续输出约 6.7/s，而这一场要打穿 420 + 126（回补）= 546 点。
   *
   * ⚠️ 需求方已确认"100 秒左右没问题"，**且这些数值后面还会大改** ——
   * 所以别把这几个数字当成需要守住的平衡目标。
   */
  ticks: 5696,
  /**
   * 当前内容没有暴击判定，所以随机数一次都不被消耗 —— **玩家侧**的
   * 随机流确实一次没用（抽招走的是 `BattleState.aiRngSeed`，
   * 与它平级的另一条流，见 `AiState.aiRngSeed`）。
   */
  finalRngSeed: 20261009,
  /**
   * ⚠️ 玩家剩 **20 血**（上一版 40）。数字会跟着上面那批改动一起变，
   * 这里只记"当前实测"，不承担"必须落在某个区间"的职责 ——
   * 那件事由 `prideBoss.test.ts` 的性质断言负责（赢 / 输，而不是具体血量）。
   */
  combatants: {
    player: { alive: true, hp: 20, energy: 5, douqi: 34, damageDealt: 0, damageTaken: 0 },
    meiichiro: { alive: false, hp: 0, energy: 0, douqi: 0, damageDealt: 0, damageTaken: 0 },
  },
} satisfies Omit<RunOutcome, 'ticks'> & { readonly ticks: number };

/**
 * 一个可以被重放复用的玩家策略：**每 tick 按优先级尝试**。
 *
 * 刻意不用手写动作时间表 —— 那种输入会随 GCD / 代价改动而整体失效，
 * 让重放因为"技能被拒"而失败，掩盖真正想检测的行为变化。
 *
 * ==================================================================
 * ⚠️ **2026-10-11 升级：它现在"会攒炁"了**
 * ==================================================================
 *
 * 旧版的行为是"**一有炁就打输出**，只有炁够『闪避 + 再打一次』时才闪"。
 * 那在"斩 10 炁 / 避 30 炁"时勉强能用，但 `斩` 与 `避` 都改成 **15 炁**
 * 之后它就**永远闪不出来**了 —— 因为它的炁全变成了斩，
 * 而闪一次需要 `15 + 15 = 30`。实测：**6.7 秒被打死，一次没闪**。
 *
 * ⚠️ 那不是游戏打不过，是**这个策略在炁需要管理的游戏里是个坏参考**。
 * 一个有炁必打的玩家，等于"从不给闪避留预算"。
 *
 * 所以现在它按**真人打法**做取舍：
 *   1. Boss 在读条、且那一招**会造成伤害** → 这一 tick **不做输出，攒炁**
 *   2. 读条还长（> 400ms）→ 先试「破」（它才是设计给"长读条"的答案）
 *   3. 快到命中了（≤ `dodgeLeadMs`）且没在无敌里 → 闪
 *   4. 没有读条 → 才按优先级输出
 *
 * ⚠️ **"攒炁"只在配了 `dodgeSkillId` 时生效**：不配 = 这个策略压根不防御，
 * 那时"停手攒炁"没有意义，会把它从"纯进攻"变成"纯站桩"，
 * 毁掉 `pureAttackPlan` 想测的那件事。
 *
 * @param priority 技能 id，顺序即优先级
 * @param dodgeSkillId 看到 Boss 读条时要插的防御技（不给则不躲、也不攒炁）
 * @param interruptSkillId 长读条时用来打断的技能（不给则不打断）
 */
export function planPriority(
  priority: readonly string[],
  options: {
    readonly dodgeSkillId?: string;
    /** 用来打断长读条的技能（「破」）。不给则不打断。 */
    readonly interruptSkillId?: string;
    /**
     * 在命中前多少毫秒闪避。默认 500。
     *
     * 无敌窗口是 0.5 秒（500ms），所以要在命中前
     * **不超过 500ms、也不要太接近 0** 的时刻按下。
     *
     * ⚠️ 下面那组扫描数字来自 **旧数值**（斩 10 炁 / 避 30 炁），
     * 只当"这是个窗口、两端都会变差"的旁证看，不要当当前平衡：
     *   lead=  0ms → 剩 27 血      lead= 500ms → 剩 100 血（免伤）
     *   lead=200ms → 剩 57 血      lead= 600ms → 剩 100 血（免伤）
     *   lead=400ms → 剩 90 血      lead= 800ms → 剩  88 血（又挨打了）
     */
    readonly dodgeLeadMs?: number;
  } = {},
): (tick: number, state: BattleState) => readonly Action[] {
  const leadMs = options.dodgeLeadMs ?? 500;
  /** 打断的提前量：读条剩这么多以上才值得用「破」。 */
  const breakLeadMs = 400;

  return (tick, state) => {
    const boss = state.combatants.find((c) => c.side === 'enemy');
    const cast = boss?.casts[0];

    if (cast !== undefined && options.dodgeSkillId !== undefined) {
      const skillDef = registry.skills.get(cast.skillId);
      /**
       * **只对"会造成伤害"的招式反应。**
       *
       * 踩过的坑：早期只看"Boss 在读条"就闪 → 连不造成伤害的招式也闪，
       * 白花 30 炁（= 3 次「斩」）。表现为"会闪反而输得更惨"，让人误以为
       * 闪避机制没用，其实是**策略在乱闪**。真人对纯增益招式不会闪。
       */
      const dealsDamage = (skillDef?.hits ?? []).some((h) =>
        h.effects.some((e) => e.kind === 'damage'),
      );
      const remainingMs = cast.castTimeMs - (tick - cast.startedAtTick) * (1000 / 60);

      if (dealsDamage && remainingMs > 0) {
        /** ① 长读条：打断（霸体会拒，那也没关系 —— 拒绝不花炁）。 */
        const breaker = options.interruptSkillId;
        if (
          breaker !== undefined &&
          remainingMs > breakLeadMs &&
          roughlyUsable(breaker, state, registry.skills.get(breaker))
        ) {
          return [{ type: 'useSkill', skillId: breaker, atTick: tick }];
        }
        /** ② 快命中了：闪（已经无敌就别再闪，否则一次读条烧掉好几次）。 */
        const alreadyImmune = (state.combatants.find((c) => c.side === 'ally')?.buffs ?? []).some(
          (b) => b.defId === 'dodge-iframe',
        );
        const dodger = options.dodgeSkillId;
        if (
          remainingMs <= leadMs &&
          !alreadyImmune &&
          roughlyUsable(dodger, state, registry.skills.get(dodger))
        ) {
          return [{ type: 'useSkill', skillId: dodger, atTick: tick }];
        }
      }
      /**
       * ③ **攒炁**：读条期间不做输出。
       *
       * 这是本次升级的**核心**：输出与闪避抢同一个炁池，
       * "有炁就花掉"等于永远给闪避留不下预算。
       */
      return [];
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
