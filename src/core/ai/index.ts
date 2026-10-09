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

import type { Ability, Action, Behavior, Combatant, RotationStep, SkillDef } from '../types';

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
}

export function createAiState(): AiState {
  return { openedSkills: [], lastUsedAt: {}, triggeredThresholds: [], enraged: false };
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
 * Verrot 的行为数组
 * ------------------------------------------------------------------ */

/**
 * Verrot 的战斗脚本 —— **全部是数据**。
 *
 * ------------------------------------------------------------------
 * 设计意图（配合玩家 6 招）
 * ------------------------------------------------------------------
 *
 * 玩家只有 6 招、100 血，所以 Boss 的威胁必须来自**节奏**而不是数值：
 *
 *   - 重斩（0.8 秒前摇 / 18 伤）：频率最高，是"基础压力"。
 *     可以硬吃一发（18% 血）也可以挡，教玩家"什么时候值得用防"。
 *   - 横扫（1.2 秒前摇 / 30 伤）：伤害高、前摇长 ——
 *     **这是为「闪」准备的那一招**：前摇足够长，玩家来得及反应。
 *   - 蓄能（1 秒前摇）：不造成伤害，但之后 10 秒内自己增伤 30%。
 *     打断它等于免掉一轮爆发 —— **这是为「破」准备的那一招**。
 *
 * 三个技能分别对应三种应对手段，玩家手上也正好有三张牌
 * （闪 / 防 / 破），这就是"招式要能被打断/闪避/格挡"的落地方式。
 *
 * 时限 3 分钟、2 分钟进入狂暴（伤害翻倍）—— 拖久了会被压死。
 */
export const VERROT_BEHAVIORS: readonly Behavior[] = [
  { kind: 'timeLimit', ms: 180_000 },
  { kind: 'enrage', atMs: 120_000, dmgMult: 2 },

  /**
   * **阶段转换用「血量阈值 + 授予 buff」表达，引擎不知道"阶段"是什么。**
   *
   * 血量降到 60% 时授予「狂怒」—— 它让横扫的冷却缩短、伤害提高。
   * 轮转里再用 `when: hasBuff('boss-frenzy')` 挑出二阶段的招式。
   *
   * 想加第三阶段就是再写一条 `onHpBelow` + 一个新 buff，
   * **不需要动引擎**。
   */
  {
    kind: 'onHpBelow',
    ratio: 0.6,
    then: [
      {
        kind: 'grant',
        target: { mode: 'self' },
        buff: {
          id: 'boss-frenzy',
          nameKey: 'buffShort.enrage',
          icon: 'enrage',
          polarity: 'debuff',
          color: 0xd04040,
          duration: Number.POSITIVE_INFINITY,
          maxStacks: 1,
          stacking: { mode: 'refresh' },
          modifiers: [
            {
              stat: 'damageBoost',
              op: 'addPercent',
              value: 25,
              sourceKey: 'buffShort.enrage',
              namespace: 'boss-frenzy',
              tier: 'buff',
            },
          ],
        },
      },
    ],
  },

  // 开场 1.2 秒后先来一发重斩：让玩家第一次看到前摇就该反应
  { kind: 'opener', skillId: 'boss-cleave', delayMs: 1200 },
  {
    kind: 'rotation',
    steps: [
      /**
       * `gapMs` 必须**短于**技能的冷却，否则轮转会空转。
       *
       * 踩过的坑：早期把 gap 写成 6–22 秒，而轮转的逻辑是
       * "按顺序取第一个「冷却已好 且 距上次使用超过 gap」的技能" ——
       * 于是高优先级的技能会长时间把低优先级的顶掉，
       * 表现为 **Boss 大部分时间站着不动**（用户直接问"Boss 咋不攻击了"）。
       *
       * 二阶段的步骤放在前面：`when` 不满足就跳到下一条。
       */
      {
        skillId: 'boss-sweep',
        when: { kind: 'hasBuff', who: 'self', buffId: 'boss-frenzy' },
        gapMs: 7_000,
      },
      { skillId: 'boss-empower', gapMs: 16_000 },
      { skillId: 'boss-sweep', gapMs: 9_000 },
      { skillId: 'boss-cleave', gapMs: 2_500 },
    ],
  },
];
