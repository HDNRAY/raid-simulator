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

import type { Action, Behavior, Combatant, RotationStep, SkillDef } from '../types';

/** AI 做决策时能看到的全部信息（只读快照）。 */
export interface AiView {
  readonly self: Combatant;
  readonly opponent: Combatant;
  /** 当前 tick */
  readonly tick: number;
  /** 自战斗开始经过的毫秒 */
  readonly elapsedMs: number;
  readonly phase: number;
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
  /** 已触发的阶段阈值（避免重复触发） */
  readonly triggeredPhases: readonly number[];
  readonly enraged: boolean;
}

export function createAiState(): AiState {
  return { openedSkills: [], lastUsedAt: {}, triggeredPhases: [], enraged: false };
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
  | { readonly kind: 'phaseChanged'; readonly phase: number }
  | { readonly kind: 'enrageStarted' };

/**
 * 决策主入口。
 *
 * 优先级（从高到低）：
 *   1. 未触发的 opener（开场动作）
 *   2. 阶段阈值刚被跨过 → 只发事件，不施法（给玩家一个视觉提示的节拍）
 *   3. 狂暴阈值
 *   4. rotation：按顺序找第一个"条件满足 + 冷却好 + 间隔够"的技能
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

  // ---- 2. 阶段阈值（只发事件） ----
  const hpRatio = view.self.caps.hp > 0 ? view.self.resources.hp / view.self.caps.hp : 1;
  for (const behavior of behaviors) {
    if (behavior.kind !== 'phases') continue;
    for (const [index, threshold] of behavior.at.entries()) {
      if (hpRatio > threshold) continue;
      if (next.triggeredPhases.includes(index)) continue;
      const phase = index + 2; // 阶段 1 是初始
      next = { ...next, triggeredPhases: [...next.triggeredPhases, index] };
      events.push({ kind: 'phaseChanged', phase });
    }
  }

  // ---- 3. 狂暴 ----
  for (const behavior of behaviors) {
    if (behavior.kind !== 'enrage') continue;
    if (next.enraged) continue;
    if (view.elapsedMs < behavior.atMs) continue;
    next = { ...next, enraged: true };
    events.push({ kind: 'enrageStarted' });
  }

  // ---- 4. rotation ----
  if (!view.canAct) return { actions, nextState: next, events };

  for (const behavior of behaviors) {
    if (behavior.kind !== 'rotation') continue;
    const step = pickStep(view, behavior.steps, next);
    if (!step) continue;
    actions.push({ type: 'useSkill', skillId: step.skillId, atTick: view.tick });
    next = { ...next, lastUsedAt: { ...next.lastUsedAt, [step.skillId]: view.tick } };
    break; // 一个 tick 最多一个动作
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
    case 'phase':
      return view.phase === condition.phase;
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
    // AI 侧保守返回 false —— 内容作者应优先用 hpBelow / phase 这类。
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
 * Verrot 的行为数组
 * ------------------------------------------------------------------ */

/**
 * Verrot 的战斗脚本 —— **全部是数据**。
 *
 * 它的机制组合：
 *   - 3 分钟时限（超时判负）
 *   - 3 分钟狂暴（伤害翻倍）
 *   - 60% / 30% 两次阶段转换
 *   - 开场 4 秒后先来一发红弧（教会玩家"要躲"）
 *   - 之后按优先级轮转：腐蚀咏唱 > 裂地三连 > 蓄能 > 红弧
 */
export const VERROT_BEHAVIORS: readonly Behavior[] = [
  { kind: 'timeLimit', ms: 180_000 },
  { kind: 'enrage', atMs: 180_000, dmgMult: 2 },
  { kind: 'phases', at: [0.6, 0.3] },
  { kind: 'opener', skillId: 'crimson-arc', delayMs: 4000 },
  {
    kind: 'rotation',
    steps: [
      // 可打断的读条：优先放出，考验玩家是否留了打断
      { skillId: 'corruption', gapMs: 18_000 },
      // 三段重击：制造连续闪避压力
      { skillId: 'triple-slam', gapMs: 12_000 },
      // 蓄能：给玩家一个喘息窗口
      { skillId: 'empower', gapMs: 14_000 },
      // 红弧：兜底技能，几乎总是可用（CD 最短）
      { skillId: 'crimson-arc', gapMs: 9_000 },
    ],
  },
];
