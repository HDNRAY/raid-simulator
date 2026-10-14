/**
 * Boss AI：行为数组解释器（M4）。
 *
 * ------------------------------------------------------------------
 * 核心原则：**Boss 与玩家走同一条施法路径**
 * ------------------------------------------------------------------
 *
 * AI 不直接改状态，而是**产出一串 `Action`** —— 与玩家按键产生的
 * 是同一个类型。于是：
 *   - 两个单位跑完全相同的门禁 / 消耗 / 读条 / 判定代码
 *   - 回放系统录下玩家 Action 的同时也录下 AI Action，一次重放整场
 *   - 把 Boss 的 behavior 数组换成玩家的按键来源，它就变成了一个玩家
 *
 * ------------------------------------------------------------------
 * 行为是数据，不是代码
 * ------------------------------------------------------------------
 *
 * `Behavior` 是一个可辨识联合，每种的语义都在这里解释一次。
 * 新增一种机制 = 加一个 union 分支 + 这里加一个 case，
 * **不需要为每个 Boss 写代码**。
 */

import { nextRandom } from '../rng';
import type {
  Ability,
  Action,
  Behavior,
  Combatant,
  RotationStep,
  SkillDef,
  WeightedRotationStep,
} from '../types';

/** AI 做决策时能看到的全部信息（只读快照）。 */
export interface AiView {
  readonly self: Combatant;
  readonly opponent: Combatant;
  /** 当前 tick */
  readonly tick: number;
  /** 自战斗开始经过的毫秒 */
  readonly elapsedMs: number;
  /** 解析技能定义 */
  readonly skillOf: (skillId: string) => SkillDef | undefined;
  /** 某个技能的冷却是否已好 */
  readonly isReady: (skillId: string) => boolean;
  /** 该单位当前能否施放（未在读条、未被动作锁） */
  readonly canAct: boolean;
}

/** AI 的持久状态（必须可序列化，进 BattleState 或单独保存）。 */
export interface AiState {
  /** 已经用过的 opener（每个只触发一次） */
  readonly openedSkills: readonly string[];
  /** 每个技能上次施放的 tick（用于 rotation 的 gapMs） */
  readonly lastUsedAt: Readonly<Record<string, number>>;
  /**
   * 已触发的 `onHpBelow` 阈值下标。
   *
   * 只记下标而不记"阶段号" —— 引擎不再有阶段的概念，
   * 它只知道"这条 onHpBelow 已经执行过了，不要重复执行"。
   */
  readonly triggeredThresholds: readonly number[];
  readonly enraged: boolean;
  /**
   * **AI 自己的随机流**（uint32）。
   *
   * ==================================================================
   * 为什么和玩家的 `BattleState.rngSeed` 分开（设计 §4.3 / Q3）
   * ==================================================================
   *
   * 玩家侧的黄金基线（`tests/golden/fixtures.ts` 的 `GOLDEN_OUTCOME`）
   * 明确断言"当前内容没有暴击判定，所以随机数一次都不被消耗"。
   * 随机选招一旦接上**同一条**流，就会连带打破那条断言与整个黄金基线
   * —— 而且会让"Boss 选招"与"玩家暴击"互相扰动随机序列。
   *
   * 分成两条流之后，"这一改动会不会悄悄改变玩家侧的黄金值"从
   * "要重新标定才不会错"变成**结构上不可能**。
   *
   * ⚠️ 它必须与 `rngSeed` 平级地进快照（`BattleState.aiRngSeed`），
   * 否则"从快照恢复战斗"会静默错位 —— 这正是 `snapshot` 的 getter
   * 注释里记的那个坑（rngSeed 曾经长期是初始种子的硬编码）。
   */
  readonly aiRngSeed: number;
}

/** 创建初始状态。 */
export function createAiState(aiRngSeed = 0): AiState {
  return {
    openedSkills: [],
    lastUsedAt: {},
    triggeredThresholds: [],
    enraged: false,
    aiRngSeed: aiRngSeed >>> 0,
  };
}

/**
 * 每个 tick 调用一次，产出本 tick 要执行的 Action。
 *
 * 返回 `{ actions, nextState, events }`：
 *   - `actions` 会被喂给引擎，与玩家按键完全同路
 *   - `events` 是"AI 层面"的事件（阶段转换、狂暴），需要引擎记进事件流
 */
export interface AiDecision {
  readonly actions: readonly Action[];
  readonly nextState: AiState;
  readonly events: readonly AiEvent[];
}

export type AiEvent =
  | { readonly kind: 'enrageStarted' }
  /**
   * 一条 `onHpBelow` 首次满足。引擎据此执行它的 `then` 能力。
   *
   * 用 `index` 标识是哪一条（内容里的顺序），不引入"阶段号"。
   */
  | { readonly kind: 'thresholdReached'; readonly index: number; readonly abilities: readonly Ability[] };

/**
 * 决策主入口。
 *
 * 优先级（从高到低）：
 *   1. 未触发的 opener（开场动作）
 *   2. `onHpBelow` 阈值刚被跨过 → 发事件让引擎执行它的能力
 *      （例如"授予二阶段 buff"）
 *   3. 狂暴阈值
 *   4. rotation：按顺序找第一个"条件满足 + 冷却好 + 间隔够"的技能。
 *      **换招就靠这里的 `when`** —— 例如
 *      `{ skillId: 'x', when: { kind: 'hasBuff', buffId: 'phase2' } }`。
 *      同一个 tick 只会执行**一条**轮转行为：第一条挑得出招就 `break`。
 *      `weightedRotation` 与它同级，只是挑法不同（候选集内加权随机）。
 */
export function decide(view: AiView, behaviors: readonly Behavior[], state: AiState): AiDecision {
  const actions: Action[] = [];
  const events: AiEvent[] = [];
  let next: AiState = state;

  // ---- 1. opener ----
  for (const behavior of behaviors) {
    if (behavior.kind !== 'opener') continue;
    if (state.openedSkills.includes(behavior.skillId)) continue;
    if (view.elapsedMs < behavior.delayMs) continue;
    if (!view.canAct) continue;

    actions.push({ type: 'useSkill', skillId: behavior.skillId, atTick: view.tick });
    next = {
      ...next,
      openedSkills: [...next.openedSkills, behavior.skillId],
      lastUsedAt: { ...next.lastUsedAt, [behavior.skillId]: view.tick },
    };
  }
  if (actions.length > 0) return { actions, nextState: next, events };

  // ---- 2. onHpBelow 阈值 ----
  const hpRatio = view.self.caps.hp > 0 ? view.self.resources.hp / view.self.caps.hp : 1;
  for (const [index, behavior] of behaviors.entries()) {
    if (behavior.kind !== 'onHpBelow') continue;
    if (hpRatio > behavior.ratio) continue;
    if (next.triggeredThresholds.includes(index)) continue;
    next = { ...next, triggeredThresholds: [...next.triggeredThresholds, index] };
    events.push({ kind: 'thresholdReached', index, abilities: behavior.then });
  }

  // ---- 3. 狂暴 ----
  for (const behavior of behaviors) {
    if (behavior.kind !== 'enrage') continue;
    if (next.enraged) continue;
    if (view.elapsedMs < behavior.atMs) continue;
    next = { ...next, enraged: true };
    events.push({ kind: 'enrageStarted' });
  }

  // ---- 4. rotation / weightedRotation ----
  if (!view.canAct) return { actions, nextState: next, events };

  /**
   * ---- 3.5 onCooldown：冷却好了就用（排在轮转**之前** = 招牌优先）----
   *
   * ⚠️ 位置很关键：它在 `canAct` 之后（不能行动时当然不出手），
   * 在轮转之前（所以它一出手，这个 tick 的轮转就不出手了）。
   *
   * ⚠️ 不消费随机数 —— 固定种子下的轮转序列不会因为这条行为而漂。
   */
  for (const behavior of behaviors) {
    if (behavior.kind !== 'onCooldown') continue;
    if (!view.skillOf(behavior.skillId)) continue;
    if (!view.isReady(behavior.skillId)) continue;
    const last = next.lastUsedAt[behavior.skillId];
    if (
      behavior.minIntervalMs !== undefined &&
      last !== undefined &&
      (view.tick - last) * (1000 / 60) < behavior.minIntervalMs
    ) {
      continue;
    }
    actions.push({ type: 'useSkill', skillId: behavior.skillId, atTick: view.tick });
    next = {
      ...next,
      lastUsedAt: { ...next.lastUsedAt, [behavior.skillId]: view.tick },
    };
    return { actions, nextState: next, events };
  }

  for (const behavior of behaviors) {
    if (behavior.kind === 'rotation') {
      const step = pickStep(view, behavior.steps, next);
      if (!step) continue;
      actions.push({ type: 'useSkill', skillId: step.skillId, atTick: view.tick });
      next = { ...next, lastUsedAt: { ...next.lastUsedAt, [step.skillId]: view.tick } };
      break; // 一个 tick 最多一个动作
    }

    if (behavior.kind === 'weightedRotation') {
      const picked = pickWeightedStep(view, behavior, next);
      if (!picked) continue;
      actions.push({ type: 'useSkill', skillId: picked.step.skillId, atTick: view.tick });
      next = {
        ...next,
        aiRngSeed: picked.aiRngSeed,
        lastUsedAt: { ...next.lastUsedAt, [picked.step.skillId]: view.tick },
      };
      break; // 一个 tick 最多一个动作
    }
  }

  return { actions, nextState: next, events };
}

/**
 * 从轮转步骤里挑一个可执行的。
 *
 * 规则：按声明顺序取**第一个**满足条件、冷却已好、且距上次使用
 * 超过 `gapMs` 的技能。顺序即优先级 —— 内容作者用它表达
 * "有这个机制时优先用它"。
 */
function pickStep(view: AiView, steps: readonly RotationStep[], state: AiState): RotationStep | undefined {
  for (const step of steps) {
    const skill = view.skillOf(step.skillId);
    if (!skill) continue;
    if (!view.isReady(step.skillId)) continue;

    if (step.gapMs !== undefined) {
      const last = state.lastUsedAt[step.skillId];
      if (last !== undefined) {
        const sinceMs = (view.tick - last) * (1000 / 60);
        if (sinceMs < step.gapMs) continue;
      }
    }

    if (step.when && !evalAiCondition(step.when, view)) continue;

    return step;
  }
  return undefined;
}

/**
 * 加权随机轮转的抽取结果。
 *
 * 返回**推进后的种子**而不是原地改 `state`：`AiState` 是 `readonly` 的，
 * 而且"这一次抽取消耗了一个随机数"应当在类型上可见（`nextRandom` 的
 * 注释里解释了同一个理由）。
 */
interface WeightedPick {
  readonly step: WeightedRotationStep;
  readonly aiRngSeed: number;
}

/**
 * 从加权随机轮转里挑一招。
 *
 * ==================================================================
 * 四条决策（设计 §4.2，逐条给理由）
 * ==================================================================
 *
 * 1. **候选集** = 定义存在 + 冷却已好 + `when` 成立，且**全场间隔**够。
 *
 *    ⚠️ `gapMs` 是"**任意两刀之间**至少隔多久"，不是"同一个技能多久能
 *    再来一次"（那是 `cooldown` 的职责）。所以它比的是**轮转里最近一次
 *    施放**，而不是"这个技能自己上次施放"。
 *
 *    实现时我一度写成后者，症状是**开场三刀连着出**（实测
 *    0 / 91 / 212）—— 因为每个技能第一次出手时"自己上次施放"还是空的，
 *    gap 完全不生效。设计 §4.2 把 `gapMs` 与单技能冷却**分开列两行**，
 *    要的正是这个区别。
 * 2. **同招不连发**：候选集里若有"上一次刚放过的那个"，且候选集大小 > 1
 *    → 剔掉它。纯随机会出现"连着 4 次 60"这种**不可玩**的局面
 *    （100 血，3 刀就死）。⚠️ 这是**体验保底**，不是平衡补丁 ——
 *    它保证"随机"是**难猜**而不是**要命**。
 * 3. **加权抽取**：`weight` 是正整数，直接当权重。
 * 4. **空候选集不消耗随机数**：与 `rollChance` 的短路原则一致
 *    （`chance <= 0` 不消耗），否则"某一步的门槛暂时不成立"会扰动
 *    整条随机序列，让固定种子下的出招序列变得无法推理。
 *
 * ⚠️ `view.canAct` 为假时 `decide` 根本走不到这里（上面已经 return），
 * 所以这里不必再判一次 —— 也正是"不在不能行动时消耗随机数"的落点。
 *
 * ⚠️ `opener` **不受 `gapMs` 约束**（它只有"每个 opener 一次"这一个门禁）：
 * 所以开场第一刀可以紧跟着第二刀。那是设计的"开场爆发"，设计 §10 的
 * 风险表把它列为已知项。
 */
function pickWeightedStep(
  view: AiView,
  behavior: { readonly steps: readonly WeightedRotationStep[]; readonly gapMs?: number },
  state: AiState,
): WeightedPick | undefined {
  /**
   * **全场**最近一次施放的 tick（只看这条轮转里的技能）。
   *
   * `undefined` = 这条轮转一次都还没出手 → 不设间隔门槛（开场第一刀）。
   */
  const mostRecent = latestUseIn(behavior.steps, state);
  const gapOk =
    behavior.gapMs === undefined ||
    mostRecent === undefined ||
    (view.tick - mostRecent) * (1000 / 60) >= behavior.gapMs;

  const candidates: WeightedRotationStep[] = [];
  if (gapOk) {
    for (const step of behavior.steps) {
      if (!view.skillOf(step.skillId)) continue;
      if (!view.isReady(step.skillId)) continue;
      if (step.when && !evalAiCondition(step.when, view)) continue;
      candidates.push(step);
    }
  }

  if (candidates.length === 0) return undefined;

  // ---- 保底：同招不连发（候选集只剩一个时不动它，否则会把候选集清空）----
  /**
   * 找"最近一次被放过的候选"，而不是比较"上一次决策"。
   *
   * 两个理由：候选集里可能混着 opener 刚放的招；而"最近"要用 tick 比较才
   * 与 `gapMs` 的判定同源（免得出现"刚放过的招反而被当成很久没放"）。
   */
  const latestTick = latestUseIn(candidates, state) ?? -1;
  const justUsed = candidates.filter((s) => state.lastUsedAt[s.skillId] === latestTick);
  const pool =
    latestTick >= 0 && justUsed.length === 1 && candidates.length > 1
      ? candidates.filter((s) => s !== justUsed[0])
      : candidates;

  // ---- 加权抽取 ----
  const total = pool.reduce((sum, s) => sum + Math.max(0, s.weight), 0);
  if (!(total > 0)) return undefined;

  const rolled = nextRandom({ seed: state.aiRngSeed });
  const roll = rolled.value * total;
  let acc = 0;
  for (const step of pool) {
    acc += Math.max(0, step.weight);
    if (roll < acc) return { step, aiRngSeed: rolled.state.seed };
  }
  // 浮点边界兜底：`roll` 极小概率恰好等于 `total`
  return { step: pool[pool.length - 1]!, aiRngSeed: rolled.state.seed };
}

/**
 * 一组技能里**最近一次**被施放的 tick（没有则 `undefined`）。
 *
 * 抽出来是因为"最近"这个词在本文件里有两个消费者（`gapMs` 的全场间隔、
 * 保底的"同招不连发"），它们必须是**同一份**判定 —— 两处各写一遍
 * 会漂移，而漂移的表现是"同一招连着出"这种极难反推的症状。
 */
function latestUseIn(
  steps: readonly { readonly skillId: string }[],
  state: AiState,
): number | undefined {
  let latest: number | undefined;
  for (const step of steps) {
    const last = state.lastUsedAt[step.skillId];
    if (last !== undefined && (latest === undefined || last > latest)) latest = last;
  }
  return latest;
}

/** AI 侧的条件求值（只依赖只读视图，不需要引擎上下文）。 */
function evalAiCondition(condition: import('../types').Condition, view: AiView): boolean {
  const who = (): Combatant => {
    if (condition.kind === 'always') return view.self;
    const w = 'who' in condition ? condition.who : undefined;
    return w === 'target' ? view.opponent : view.self;
  };

  switch (condition.kind) {
    case 'always':
      return true;
    case 'hpBelow':
      return ratioOf(who()) < condition.ratio;
    case 'hpAbove':
      return ratioOf(who()) > condition.ratio;
    case 'hasBuff':
      return who().buffs.some((b) => b.defId === condition.buffId);
    case 'notHasBuff':
      return !who().buffs.some((b) => b.defId === condition.buffId);
    case 'isCasting':
      return view.self.casts.length > 0;
    case 'resourceAbove':
      return (who().resources as Record<string, number>)[condition.resource]! > condition.value;
    case 'resourceBelow':
      return (who().resources as Record<string, number>)[condition.resource]! < condition.value;
    case 'all':
      return condition.of.every((c) => evalAiCondition(c, view));
    case 'any':
      return condition.of.some((c) => evalAiCondition(c, view));
    case 'not':
      return !evalAiCondition(condition.of, view);
    // 以下条件需要引擎上下文（stat / buff 剩余时间 / 计数），
    // AI 侧保守返回 false —— 内容作者应优先用 hpBelow / hasBuff 这类。
    case 'buffExpiring':
    case 'statAbove':
    case 'targetCount':
    case 'lastHitWasCrit':
      return false;
  }
}

function ratioOf(combatant: Combatant): number {
  const cap = combatant.caps.hp;
  return cap > 0 ? combatant.resources.hp / cap : 1;
}

/* ------------------------------------------------------------------ *
 * 旧「伪名一郎」的内容去哪了
 * ------------------------------------------------------------------ */

/**
 * ⚠️ 这里曾经有 `VERROT_BEHAVIORS`（约 128 行）—— 它**本来就不该在
 * `core/`**：`core/` 是引擎，里面却写着"重斩 28 伤、横扫 36 伤"这种
 * 具体内容，连设计说明都混在引擎文件里。
 *
 * 改造「傲慢」时把它整体搬到了 `data/bossPride.ts`（改名
 * `PRIDE_BEHAVIORS`），与 `data/lustBoss.ts` 对称：**一个 Boss 一个内容
 * 文件，引擎里只剩解释器**。这是 `core/` 与 `data/` 边界的修正，
 * 不是重命名 —— 所以引擎文件因此少了约 130 行。
 *
 * 旧 Boss 的调参史（仍然有用的部分）现在记在
 * `tests/golden/fixtures.ts` 的 `GOLDEN_OUTCOME` 上方：
 *   - `gapMs` 与技能的 `cooldown` **要一起调**，真正决定间隔的是两者中
 *     **更长的那个**。踩过的坑：冷却确实存在（重斩 3s、横扫 6s），但
 *     `gapMs` 更短，于是冷却还没走完、轮转就先放行了 —— 观感上像
 *     "重斩没有 CD"
 *   - 把霸体做成一个**独立的技能**放进轮转后，即使它一次都没挡下打断，
 *     **占掉的那一格也会把 Boss 出招挤后**（战斗从 897 tick 拉长到
 *     1094 tick，直接把玩家打成"先死"）。「傲慢」的改造据此把霸体
 *     合并进「碾压」，删掉了那个独立技能
 */
