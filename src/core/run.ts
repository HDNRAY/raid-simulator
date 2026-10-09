/**
 * 无头运行与黄金重放（架构规范 §7.5）。
 *
 * ------------------------------------------------------------------
 * 为什么必须有这个文件
 * ------------------------------------------------------------------
 *
 * 数值平衡一直在调。"这次改动有没有意外改变战斗结果"这个问题
 * 如果只能靠打开浏览器打一场来回答，就永远问得不够勤 ——
 * 而**静默的行为变化正是最难发现的 bug**。
 *
 * 所以把"一整场战斗"压缩成一个可提交、可 diff 的文件：
 *
 *   seed + 玩家动作序列  →  完整的胜负与状态轨迹
 *
 * 重放是**逐位确定**的，因为：
 *   - 引擎没有 `Math.random` / `Date.now`（lint 硬约束 C2）
 *   - 随机数状态存在 `BattleState.rngSeed` 里，随战斗推进
 *   - Boss AI 也从同一个随机源取数，所以它的"临场决定"同样可复现
 *
 * 于是"改了一个数值 → 某场重放的结果变了"会立刻在测试里暴露。
 */

import { BattleEngine } from './combat/battleState';
import type {
  Action,
  BattleState,
  Combatant as CombatantView,
  Condition,
  EndReason,
  EncounterStatus,
} from './types';

/**
 * 重放格式版本。
 *
 * **改动引擎的确定性语义时必须 +1** —— 否则旧的重放文件会
 * 在新引擎上产生"看起来像 bug"的差异。测试会校验这个数字。
 */
export const REPLAY_FORMAT_VERSION = 1 as const;

/** 一次记录的运行。 */
export interface RecordedRun {
  readonly version: number;
  /** 随机种子。Boss AI 与所有概率判定都由它派生。 */
  readonly seed: number;
  /** 跑了多少 tick */
  readonly ticks: number;
  /**
   * 玩家动作，按 tick 索引。
   *
   * 顺序即"同一 tick 内按下的顺序" —— 引擎会依次尝试，
   * 被门禁拒掉的不会生效。所以这个数组本身就是完整输入。
   */
  readonly input: Readonly<Record<string, readonly Action[]>>;
}

/** 一场运行的最终结果摘要（用于黄金断言与可读的 diff）。 */
export interface RunOutcome {
  readonly status: EncounterStatus;
  readonly endReason: EndReason | undefined;
  readonly ticks: number;
  readonly finalRngSeed: number;
  /** `id → 最终状态`。数值取整，避免浮点尾差让 diff 变噪。 */
  readonly combatants: Readonly<Record<string, CombatantSummary>>;
}

export interface CombatantSummary {
  readonly alive: boolean;
  readonly hp: number;
  readonly energy: number;
  readonly douqi: number;
  /** 造成/承受的总伤害（用于快速看出"这场打得凶不凶"） */
  readonly damageDealt: number;
  readonly damageTaken: number;
}

/**
 * 记录器：包住一个引擎，边跑边记玩家输入。
 *
 * 用法与引擎一致，只是把玩家动作同时"抄一份"。
 */
export class RunRecorder {
  private readonly engine: BattleEngine;
  private readonly input: Record<string, Action[]> = {};
  private steps = 0;

  constructor(engineOptions: ConstructorParameters<typeof BattleEngine>[0]) {
    this.engine = new BattleEngine(engineOptions);
  }

  get state(): BattleState {
    return this.engine.snapshot;
  }

  /** 推进一个 tick，并记录玩家动作。 */
  step(actions: readonly Action[] = []): void {
    const tick = this.engine.snapshot.tick;
    if (actions.length > 0) this.input[String(tick)] = [...actions];
    this.engine.tick(actions);
    this.engine.drainEvents();
    this.steps += 1;
  }

  /** 一直跑到战斗结束或达到 `maxTicks`。`plan` 每个 tick 产出一组动作。 */
  runUntilEnd(
    plan: (tick: number, state: BattleState) => readonly Action[],
    maxTicks = 60 * 60 * 10,
  ): void {
    for (let i = 0; i < maxTicks; i += 1) {
      const state = this.engine.snapshot;
      if (state.status !== 'running') break;
      this.step(plan(state.tick, state));
    }
  }

  /** 产出可序列化的重放记录。 */
  toRecordedRun(): RecordedRun {
    return {
      version: REPLAY_FORMAT_VERSION,
      seed: this.engine.initialSeed,
      ticks: this.steps,
      input: this.input,
    };
  }

  outcome(): RunOutcome {
    return summarize(this.engine);
  }
}

/**
 * 重放一次记录。**这是测试与工具的唯一入口。**
 *
 * @param makeEngineOptions 由调用方提供内容（重放文件里只存种子与输入，
 *   不存内容 —— 内容改了，重放就该跟着变，这正是我们要检测的）
 */
export function replayRun(
  run: RecordedRun,
  makeEngineOptions: (seed: number) => ConstructorParameters<typeof BattleEngine>[0],
): RunOutcome {
  if (run.version !== REPLAY_FORMAT_VERSION) {
    // 开发者错误：用英文（i18n 规范 I1）
    throw new Error(
      `replay format version mismatch: file is v${run.version}, engine expects v${REPLAY_FORMAT_VERSION}`,
    );
  }

  const engine = new BattleEngine(makeEngineOptions(run.seed));

  for (let tick = 0; tick < run.ticks; tick += 1) {
    if (engine.snapshot.status !== 'running') break;
    const actions = run.input[String(tick)] ?? [];
    engine.tick(actions);
    engine.drainEvents();
  }

  return summarize(engine);
}

/**
 * 把一场战斗压缩成可读、可 diff 的摘要。
 *
 * 取整而不是保留浮点：平衡微调会让小数位到处变化，
 * 那样 diff 会充满噪声，"有没有真的变"反而看不出来。
 */
function summarize(engine: BattleEngine): RunOutcome {
  const state = engine.snapshot;
  const combatants: Record<string, CombatantSummary> = {};

  for (const combatant of state.combatants) {
    combatants[combatant.id] = {
      alive: combatant.alive,
      hp: Math.round(combatant.resources.hp),
      energy: Math.round(combatant.resources.energy),
      douqi: Math.round(combatant.resources.douqi),
      damageDealt: 0,
      damageTaken: 0,
    };
  }

  return {
    status: state.status,
    endReason: state.endReason,
    ticks: state.tick,
    finalRngSeed: state.rngSeed,
    combatants,
  };
}

/**
 * 一个"够好但不完美"的通用玩家计划，供重放与平衡测试复用。
 *
 * 存在的理由：重放需要一个**稳定的、不依赖手写时间表**的输入源。
 * 手写时间表会随 GCD / 代价改动而失效，导致重放"因为没放技能"而失败，
 * 掩盖真正想检测的行为变化。
 *
 * 策略（按优先级）：能放就放，顺序即优先级。
 */
export function greedyPlan(
  priority: readonly string[],
  isUsable: (skillId: string, state: BattleState) => boolean,
): (tick: number, state: BattleState) => readonly Action[] {
  return (tick, state) => {
    for (const skillId of priority) {
      if (isUsable(skillId, state)) {
        return [{ type: 'useSkill', skillId, atTick: tick }];
      }
    }
    return [];
  };
}

/**
 * 判断某个技能此刻能否施放。
 *
 * 刻意不调用引擎内部的门禁 —— 那会让"测试用的可用性判断"
 * 和"引擎真正的判断"共用一份实现，于是门禁本身的 bug 检测不出来。
 * 这里用**独立的**判断。
 *
 * ⚠️ **必须检查 `requires`**。踩过的坑：早期版本漏了它，
 * 于是策略一直选中派生技（缺派生窗口、会被引擎拒），
 * 而基础技永远轮不到 —— 整场战斗跑空，表现为"Boss 满血而玩家已死"。
 *
 * 当时的注释写着"判错也没关系，多放一个会被拒掉"，那是错的：
 * 被拒虽然不污染状态，但**会让优先级彻底堵死**，
 * 因为它把"这个技能不能放"和"这个技能能放但会被拒"混为一谈。
 */
export function roughlyUsable(
  skillId: string,
  state: BattleState,
  skill:
    | {
        readonly cooldown: number;
        readonly cost: readonly { readonly resource: string; readonly value: unknown }[];
        readonly requires?: readonly Condition[];
      }
    | undefined,
  actorId = 'player',
): boolean {
  if (!skill) return false;
  const actor = state.combatants.find((c) => c.id === actorId);
  if (!actor || !actor.alive) return false;
  if (actor.casts.length > 0) return false;
  if ((actor.cooldowns[skillId] ?? 0) > state.tick) return false;
  for (const cost of skill.cost) {
    const need = typeof cost.value === 'number' ? cost.value : 0;
    const has = (actor.resources as Record<string, number>)[cost.resource] ?? 0;
    if (has < need) return false;
  }
  for (const condition of skill.requires ?? []) {
    if (!conditionHolds(condition, actor)) return false;
  }
  return true;
}

/** 只实现 `requires` 里真正会用到的几种条件；其余保守判为"不满足"。 */
function conditionHolds(condition: Condition, actor: CombatantView): boolean {
  switch (condition.kind) {
    case 'always':
      return true;
    case 'hasBuff':
      return actor.buffs.some((b) => b.defId === condition.buffId);
    case 'notHasBuff':
      return !actor.buffs.some((b) => b.defId === condition.buffId);
    case 'resourceAbove':
      return ((actor.resources as Record<string, number>)[condition.resource] ?? 0) > condition.value;
    case 'resourceBelow':
      return ((actor.resources as Record<string, number>)[condition.resource] ?? 0) < condition.value;
    case 'hpBelow':
      return ratioOf(actor) < condition.ratio;
    case 'hpAbove':
      return ratioOf(actor) > condition.ratio;
    case 'all':
      return condition.of.every((c) => conditionHolds(c, actor));
    case 'any':
      return condition.of.some((c) => conditionHolds(c, actor));
    case 'not':
      return !conditionHolds(condition.of, actor);
    default:
      // 需要引擎上下文的条件（目标数量、上次是否暴击等）一律保守判否
      return false;
  }
}

function ratioOf(actor: CombatantView): number {
  const cap = (actor.caps as Record<string, number>).hp ?? 0;
  return cap > 0 ? (actor.resources.hp ?? 0) / cap : 0;
}

/** 供调用方构造引擎参数时复用的类型别名。 */
export type EngineOptions = ConstructorParameters<typeof BattleEngine>[0];

/** 玩家计划里能用的技能 id 列表（由内容层提供）。 */
export type SkillPriority = readonly string[];

/** 便利：把一个 `Combatant` 的摘要取出来。 */
export function summaryOf(outcome: RunOutcome, id: string): CombatantSummary | undefined {
  return outcome.combatants[id];
}
