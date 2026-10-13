/**
 * **内容 ↔ 引擎能力的对账**：内容有没有用"引擎还没实现 / 根本不会处理"的东西？
 *
 * ==================================================================
 * 为什么单独一个文件
 * ==================================================================
 *
 * 从 `validate.ts` 横向切出来的（AGENTS.md §3 的 700 行上限）。
 * 它与"内容字段是否合法"是**两个职责**：
 *
 *   - `validate.ts`  内容自己写错了吗？（id 重复、key 不存在、环、阈值…）
 *   - 本文件         内容与**引擎当前的能力边界**对得上吗？
 *
 * 后者的判据会随"引擎实现了什么"变化，而前者不会 —— 所以两者分开放，
 * 接线一个新能力时只要动这里（与 `validate.ts` 的一行调用）。
 *
 * ==================================================================
 * ⚠️ 本表**不包含**时间刻度：那条检查在 `./timeGrid.ts`
 * ==================================================================
 *
 * 与"能力有没有执行点"**相邻但不同**的一类：引擎的时间粒度只有
 * 一个逻辑步（0.1 秒），所以一个 250ms 的 `castTime` **不是没人执行**，
 * 而是**没有任何一种忠实执行** —— 显示会向上折到 0.3 秒、引擎按 250ms
 * 跑，两边差一整个刻度，不报错、肉眼看不出来。
 *
 * 它同样是 AGENTS.md §2 第三类（"用了不报错、结果错"），所以照同一套
 * 办：**校验报 error 拦下**（`OFF_GRID_TIME`）。判据、字段清单已经与
 * "引擎实现不实现"分开成两个文件：
 *
 *   - 本文件        这个能力**有没有**执行点？（有了就删掉那条检查）
 *   - `timeGrid.ts` 这个**值**能不能被忠实地执行？（与引擎无关，
 *     只要逻辑步还是 0.1 秒就永远成立）
 *
 * ==================================================================
 * 三种东西，处理方式不同（这是本文件存在的核心理由）
 * ==================================================================
 *
 * | 性质 | 例子 | 处理 |
 * |---|---|---|
 * | **重复**：同一件事有第二份表达 | `Behavior: 'interruptible'` / `'timeLimit'` | 删（已删）|
 * | **未实现**：设计过、还没接线 | `Expr.counter` / `Hook: 'onPhaseChange'` / `grantSkill` / `Ability: 'consume'` | **保留类型**，但内容用了就报错 |
 * | **会静默算错**：用了不报错、结果错 | `Expr.counter`（读出来恒为 0）| 同上，报 error 拦下 |
 * | **刻度外**：值在逻辑层不可忠实表达 | `castTime: logicMs(2.5)` = 250ms | 见 `./timeGrid.ts` |
 *
 * "未实现"的东西**不能靠删**（那会丢设计），也不能放着不管
 * （用了静默无效 / 静默算错，是最难查的一类 bug）—— 所以统一在这里
 * 变成**可执行的规则**：引擎没实现，内容就**不许用**，而且报错里说清
 * "为什么"与"实现之后该怎么办"。
 *
 * ==================================================================
 * ⚠️ 设计稿阶段要写这些未实现的机制 → 显式 `{ strict: false }`
 * ==================================================================
 *
 * 报错是**有意**的响亮：`createRegistry` 默认严格，用了未实现的能力
 * **启动即失败**。这不是"禁止你设计"，而是"不许**悄悄**设计"：
 * 一份看起来会生效、实际什么也不做的内容，比一句 TODO 危险得多。
 *
 * 要写设计稿就**显式**传：
 *
 * ```ts
 * validateContent(bundle, { strict: false })   // 只报告分级，不提升为 error
 * ```
 *
 * ⚠️ **必须显式**，不许把默认改回去（改回去等于把这条防线删了）。
 */

import { buffAbilities } from '../expr/deps';
import type { Ability, BuffDef, Hook, TriggerDef } from '../types';

/** 一条"内容与引擎能力对不上"的问题（由 `validate.ts` 转成 `ValidationIssue`）。 */
export interface CapabilityIssue {
  readonly severity: 'error' | 'warning';
  readonly code:
    | 'COUNTER_UNIMPLEMENTED'
    | 'UNSUPPORTED_HOOK'
    | 'ABILITY_UNIMPLEMENTED'
    | 'CONSUME_TRIGGER_UNIMPLEMENTED'
    | 'CONSUME_TRIGGER_MISSING'
    | 'INDEPENDENT_BUFF_MODIFIERS';
  readonly path: string;
  readonly message: string;
}

/**
 * 递归收集一组能力里**全部**能力（含嵌套），并带上可读路径。
 *
 * 递归是必须的：`trigger.then` 里可以再 `grant` 一个带 abilities 的 buff，
 * 也可以再嵌 `trigger` —— 漏掉任意一层就等于漏掉一处"静默无效"。
 */
function collectNestedAbilities(
  abilities: readonly Ability[],
  prefix: string,
): readonly { readonly ability: Ability; readonly path: string }[] {
  const out: { ability: Ability; path: string }[] = [];
  for (const [index, ability] of abilities.entries()) {
    const at = `${prefix}[${index}]`;
    out.push({ ability, path: at });
    if (ability.kind === 'trigger') {
      out.push(...collectNestedAbilities(ability.trigger.then, `${at}.trigger.then`));
      continue;
    }
    if (ability.kind === 'grant') {
      out.push(...collectNestedAbilities(buffAbilities(ability.buff), `${at}.buff`));
    }
  }
  return out;
}

/* ------------------------------------------------------------------ *
 * 1. Hook：声明表 ≫ 引擎真的会处理的集合
 * ------------------------------------------------------------------ */

/**
 * 引擎**真的会照做**的 hook。
 *
 * ⚠️ `Hook` 是一整张声明表，远大于引擎实际处理的集合。这张表是
 * "内容与引擎能力的对账"：写进内容却不在表里的 hook **静默无效**。
 *
 * | hook | 谁来处理 |
 * |---|---|
 * | `onCastFinish` | `castPipeline` 的读条完成结算（技能能力里的触发器） |
 * | `onHitTaken` | `runTriggers(... 'onHitTaken' ...)`（`hitResolution`） |
 * | `onCritDealt` | `runTriggers(... 'onCritDealt' ...)`（`hitResolution` 暴击分支） |
 * | `onBuffApplied` / `onBuffExpired` | `battleState.dispatchBuffHooks()`（每 tick 末扫 buff 事件后派发） |
 *
 * ⚠️ 这张表与 `combat/triggers.ts` 的运行时白名单必须对得上，方向是
 * **运行时白名单 ⊆ 本表**（"引擎会派发、校验器却说不行"是最坏的漂移），
 * 反过来不要求相等：`onCastFinish` 合法地不经过 `runTriggers`。
 * 由 `tests/unit/content.test.ts` 断言，漂了就会红。
 *
 * 故意不跨层 import `combat/`：校验器只依赖纯 `expr` 那一层。
 */
export const SUPPORTED_HOOKS: readonly Hook[] = [
  'onCastFinish',
  'onHitTaken',
  'onCritDealt',
  'onBuffApplied',
  'onBuffExpired',
];

function checkHookSupported(hook: Hook, path: string): readonly CapabilityIssue[] {
  if (SUPPORTED_HOOKS.includes(hook)) return [];
  return [
    {
      severity: 'warning',
      code: 'UNSUPPORTED_HOOK',
      path,
      message:
        `hook "${hook}" is declared but never handled by the engine ` +
        `(handled: ${SUPPORTED_HOOKS.join(', ')}) — the trigger would silently never fire`,
    },
  ];
}

/**
 * 递归收集一组能力里**全部**触发器定义，并带上可读路径。
 *
 * 路径要能指到具体位置（`...trigger.then[0].buff[1]`），因为"哪一条触发器
 * 静默无效"是内容作者唯一能拿来定位的信息。
 */
function collectTriggers(
  abilities: readonly Ability[],
  prefix: string,
): readonly { readonly trigger: TriggerDef; readonly path: string }[] {
  const out: { trigger: TriggerDef; path: string }[] = [];
  for (const { ability, path } of collectNestedAbilities(abilities, prefix)) {
    if (ability.kind === 'trigger') out.push({ trigger: ability.trigger, path: `${path}.trigger` });
  }
  return out;
}

/** 对一组能力里每个触发器的 hook 做"引擎会不会处理"的对账。 */
export function abilityHookIssues(
  abilities: readonly Ability[],
  prefix: string,
): readonly CapabilityIssue[] {
  const out: CapabilityIssue[] = [];
  for (const { trigger, path } of collectTriggers(abilities, prefix)) {
    out.push(...checkHookSupported(trigger.on, path));
  }
  return out;
}

/* ------------------------------------------------------------------ *
 * 1b. Ability kind：有类型、有校验、**没有执行点**
 * ------------------------------------------------------------------ */

/**
 * 没有任何执行点的 `Ability` kind。
 *
 * ⚠️ 这两个是**设计过、还没接线**的能力（不是"内容写错了"）。但**写了也
 * 不该放过**：它与"故意留给未来"同样是错的 —— 一份**看起来会生效**的
 * 内容比一句 TODO 危险得多（TODO 不会在战斗里安静地什么也不做）。
 * 想在设计稿阶段写它们，就显式传 `{ strict: false }`。
 *
 * 判定依据（2026-10-12 全仓 grep）：`castPipeline` / `runAi` /
 * `combat/triggers.ts` 三个能力执行点都不认 `grantSkill` / `consume`。
 * 实现之后从这里删掉对应项即可。
 *
 * ⚠️ 这里的 `'consume'` 是 **`Ability: 'consume'`**（`ConsumeAbility`，
 * "从某个池子扣资源"），**不是** `BuffDef.consume`（buff 被谁消费掉 ——
 * 那个机制**已经实现**，见本节 3 的作废段）。两个"consume"同名不同物，
 * 删任何一边之前先确认清是哪一边。
 */
const UNIMPLEMENTED_ABILITY_KINDS: readonly string[] = ['grantSkill', 'consume'];

/** 报出内容里用了"没有执行点"的 ability kind。 */
export function abilityKindIssues(
  abilities: readonly Ability[],
  prefix: string,
): readonly CapabilityIssue[] {
  const out: CapabilityIssue[] = [];
  for (const { ability, path } of collectNestedAbilities(abilities, prefix)) {
    if (!UNIMPLEMENTED_ABILITY_KINDS.includes(ability.kind)) continue;
    out.push({
      severity: 'error',
      code: 'ABILITY_UNIMPLEMENTED',
      path,
      message:
        `ability "${ability.kind}" has no executor in the engine yet — it would ` +
        `silently do nothing. Remove it, or implement it first ` +
        `(pass { strict: false } only when writing a design draft).`,
    });
  }
  return out;
}

/* ------------------------------------------------------------------ *
 * 2. Expr.counter：能力未接线，用了会**静默算错**
 * ------------------------------------------------------------------ */

/**
 * 深度扫描一段内容里**任何位置**出现的 `Expr.counter`，返回可读路径。
 *
 * 为什么是"任意位置"而不是逐字段列举：`Expr` 能出现的地方太多了
 * （`derived.value` / `modifier.value` / buff 的 modifiers / hit 的
 * `damage` / `Cost.value` / `onSuccess` 里嵌套的效果 / 触发器的 then …），
 * 逐处列举**必然漏**，而漏掉的那处正是"静默算成 0"会发生的入口。
 *
 * ⚠️ 深度上限是防野数据的兜底（内容里不该有环，但这条检查会在
 * "内容本身已经坏了"的时候也跑到）。
 */
const COUNTER_SCAN_DEPTH_LIMIT = 32;

function findCounterExprPaths(node: unknown, path: string, depth = 0): readonly string[] {
  if (depth > COUNTER_SCAN_DEPTH_LIMIT) return [];
  if (node === null || typeof node !== 'object') return [];

  if (Array.isArray(node)) {
    const out: string[] = [];
    node.forEach((item, index) => {
      out.push(...findCounterExprPaths(item, `${path}[${index}]`, depth + 1));
    });
    return out;
  }

  /**
   * ⚠️ 这里用 `as Record<string, unknown>` 只是"把 unknown 当对象索引"，
   * 不是绕过类型检查去断言某个具体类型（AGENTS.md §1 禁的是
   * `as any` / `as unknown as`）—— `collectContribNamespaces` 里已有同样写法。
   */
  const record = node as Record<string, unknown>;
  if (record['e'] === 'counter') return [path];

  const out: string[] = [];
  for (const [key, value] of Object.entries(record)) {
    out.push(...findCounterExprPaths(value, `${path}.${key}`, depth + 1));
  }
  return out;
}

/** 内容树的一个根（实体 / 技能 / buff / 遭遇战），带可读路径前缀。 */
export interface ContentRoot {
  readonly path: string;
  readonly node: unknown;
}

/*
 * ⚠️ 【作废 · 2026-10-13】本节原来的标题与引言在**这一节自己的范围内**是错的
 *
 * 原文（**保留，用来记住当时为什么那么想**）：
 *
 *   「3. buff 的 `consume` / `independent`：声明了但没有消费者」
 *
 *   「与 `Hook` 那一节同一条线（AGENTS.md §2 的第三类）：**声明了、引擎不照做**
 *    的内容必须被拦下，而不是在战斗里安静地什么都不发生。」
 *
 * **当时为什么那么想**：写下这一节时（2026-10-12 的能力对账）这两样**确实**
 * 是"有类型、没接线"—— 那时全仓还没有任何消费路径，`independent` 的接收侧
 * 也没有多实例。于是它们与 `grantSkill` 被归成同一类（"未实现"）。
 *
 * **实测为什么不再成立**：两样**都已经有实现**了 ——
 *
 *   - `BuffDef.consume`：整套消费机制已接线。判据在 `core/buffs/consume.ts`
 *     （`consumeFactsFor` / `matchedConsumeTriggers` / `applyConsume`），
 *     落到状态上是 `core/combat/consumeHandler.ts` 的 `settleConsumableBuffs`
 *     （tick 管线的第 2c 步），四种触发逐条有实现，实测见
 *     `tests/unit/buffConsume.test.ts`（31 条）。生产内容也**已经在用**：
 *     `data/kits/combo.ts` 与 `data/kits/dodgeCharge.ts` 的 buff 都声明了
 *     `consume: { on: ['onAttack'] }`。
 *   - `independent`（多实例各自计时）：`core/buffs/index.ts` 已实现
 *     （`applyBuff` 的分流、`findExisting` 永远不复用、上限时替换最早那个），
 *     实测能造出多个实例（`buffConsume.test.ts` 的"三个实例封顶"）。
 *
 * **现在的规则（逐条核实过；本节下面的代码与报错一条都没删）**：
 *
 *   - `SUPPORTED_CONSUME_TRIGGERS`（四种触发）**仍然活**：它是对账表，而且
 *     仍然"少一条就静默失效"—— 内容声明了 `onAttack` 而引擎不派发它，buff
 *     就永远不消失。
 *   - `CONSUME_TRIGGER_UNIMPLEMENTED` / `CONSUME_TRIGGER_MISSING` **仍然活**：
 *     名字里的 "UNIMPLEMENTED" 今天读起来有点旧（机制本身已实现），但它报的
 *     是"**这一条触发**引擎不派发"（或 `on` 干脆缺失）—— 那是**内容与引擎
 *     当前能力对不上**，不是机制欠接线。所以这两条报错照旧保留。
 *   - `INDEPENDENT_BUFF_MODIFIERS` **仍然活**，而且与本节标题无关：它拦的
 *     不是"没实现"，而是"表达说不通"（见下面 `independentModifierIssues` 的
 *     段注释 —— `expandBuffModifiers` 会把每个实例的修正各展开一次，线性
 *     叠加、绕过封顶）。这条**从来没"过期"过**。
 *   - 「这两个都只吃一份 `BuffDef[]`」以及"怎么找 buff 是
 *     `./buffValidation.ts` 的事"**仍然成立**（那是这一节的切分理由）。
 *
 * ⚠️ **一个同名陷阱**（本节曾经的标题真假难辨，一半就是它造成的）：
 * `Ability: 'consume'`（`core/types/abilities.ts` 的 `ConsumeAbility`，
 * "从某个池子扣资源"）与 `BuffDef.consume`（buff 的生命周期由谁结束）
 * 是**两件不同的事**，只共用一个词。前者**仍然没有执行点**
 * （`castPipeline` / `runAi` / `combat/triggers.ts` 都不认它），所以
 * `UNIMPLEMENTED_ABILITY_KINDS` 里的 `'consume'` **是对的、别删**。
 * 两个"consume"不要互相牵连。
 */

/* ------------------------------------------------------------------ *
 * 3. buff 的消费触发 / `independent` 叠层：内容 ↔ 引擎能力的对账
 * ------------------------------------------------------------------ *
 *
 * 判据在下面两个函数里。⚠️ 上面那段"作废"说明解释了为什么本节**不再**说
 * "没有消费者"—— 这两样今天都有实现，留下的是两条**仍然有效**的检查：
 *
 *   - 内容声明了一条引擎**不派发**的消费触发（或干脆没写 `on`）→ 拦下
 *   - `independent` 叠层**带 `modifiers`** → 拦下（表达说不通，不是欠接线）
 */

/**
 * 引擎**真的会消费**的四种触发（`BuffDef.consume.on`）。
 *
 * ⚠️ 这张表与 `core/buffs/consume.ts` 的 `TRIGGER_SOURCES` 必须对得上
 * （"引擎会消费、校验器却说不行"是最坏的漂移），由
 * `tests/unit/buffConsume.test.ts` 断言。
 *
 * 四种的判据（哪一刻算"打出去了"）写在 `consume.ts` 的
 * `consumeFactsFor` 里 —— 那里是**唯一**一处解读。
 */
export const SUPPORTED_CONSUME_TRIGGERS: readonly string[] = [
  'onAttack',
  'onDamaged',
  'onDodge',
  'onBlock',
];

/**
 * buff 声明的消费机制，引擎这一版**真的会执行吗**？
 *
 * 两类问题：
 *   - `CONSUME_TRIGGER_MISSING`（error）：写了 `consume` 却没写 `on` ——
 *     引擎没有可判的东西，而作者看内容会以为"它会消费"。
 *   - `CONSUME_TRIGGER_UNIMPLEMENTED`（error）：`on` 里有一条引擎不派发的
 *     触发（例如以后加了 `onCritTaken` 的名字但还没接线）—— 那条**永远
 *     不会发生**，于是 buff 永远不消失。这正是 AGENTS.md §2 要拦的形状。
 */
export function consumeIssues(buffs: readonly BuffDef[]): readonly CapabilityIssue[] {
  const out: CapabilityIssue[] = [];
  for (const buff of buffs) {
    const rule = buff.consume;
    if (rule === undefined) continue;
    const path = `buff:${buff.id}.consume.on`;
    if (rule.on === undefined) {
      out.push({
        severity: 'error',
        code: 'CONSUME_TRIGGER_MISSING',
        path,
        message:
          `buff "${buff.id}" declares consume but no trigger "on" — the engine would ` +
          `never consume it (declare onAttack / onDamaged / onDodge / onBlock)`,
      });
      continue;
    }
    for (const trigger of rule.on) {
      if (SUPPORTED_CONSUME_TRIGGERS.includes(trigger)) continue;
      out.push({
        severity: 'error',
        code: 'CONSUME_TRIGGER_UNIMPLEMENTED',
        path,
        message:
          `consume trigger "${String(trigger)}" is never dispatched by the engine ` +
          `(handled: ${SUPPORTED_CONSUME_TRIGGERS.join(', ')}) — the buff would ` +
          `never be consumed. Implement the trigger first.`,
      });
    }
  }
  return out;
}

/**
 * `independent` 叠层**不支持**带 `modifiers` 的 buff。
 *
 * ==================================================================
 * 为什么这不是"顺手就支持"的能力
 * ==================================================================
 *
 * `independent` 的语义是"每次施加都是一个**新实例**"（同 defId 多份，
 * 各自计时）。而 `expandBuffModifiers` 会把**每个实例**的修正都展开一次 ——
 * 于是"每层 +10%"变成了 +10% × 层数，与 `stack` 模式的**线性叠加**长得
 * 一样，却绕过了 `maxStacks` 的封顶（`independent` 的 max 是"最多几个实例"）。
 *
 * ⚠️ 这条**不是**"引擎还没实现"，而是**表达在两个概念上都说不通**：
 *   - 要让"每层提供修正"，那正是 `stack` / `stackRefresh` 的定义
 *   - `independent` 的用途是"各自计时的多份状态"（例如每层毒各自结算），
 *     它的消费者应该读**实例**，而不是读修正池
 *
 * 所以内容里写了它会被报错拦下。真要"每层独立计时 **且** 每层给修正"，
 * 先决定它在修正池里的聚合方式（相加？取最大？），那是设计决策，不是接线。
 */
export function independentModifierIssues(buffs: readonly BuffDef[]): readonly CapabilityIssue[] {
  const out: CapabilityIssue[] = [];
  for (const buff of buffs) {
    if (buff.stacking.mode !== 'independent') continue;
    if ((buff.modifiers ?? []).length === 0) continue;
    out.push({
      severity: 'error',
      code: 'INDEPENDENT_BUFF_MODIFIERS',
      path: `buff:${buff.id}.modifiers`,
      message:
        `buff "${buff.id}" is stacking:"independent" but has modifiers — the ` +
        `modifier would be expanded once per instance (linear, uncapped). ` +
        `Use stacking:"stack"/"stackRefresh" if each stack should contribute a stat.`,
    });
  }
  return out;
}

/**
 * 拒绝任何用到 `Expr.counter` 的内容（`COUNTER_UNIMPLEMENTED`）。
 *
 * 这是一条**能力尚未接线**的防线，不是"内容写错了"：计数器的读取在战斗
 * 路径恒为 0（`core/combat/stats.ts` 的桩），用它等于静默算错。
 * 实现计数器后把这条调用与 `ValidateOptions` 一起删掉即可。
 */
export function counterExprIssues(roots: readonly ContentRoot[]): readonly CapabilityIssue[] {
  const out: CapabilityIssue[] = [];
  for (const { path, node } of roots) {
    for (const found of findCounterExprPaths(node, path)) {
      out.push({
        severity: 'error',
        code: 'COUNTER_UNIMPLEMENTED',
        path: found,
        message:
          `Expr.counter is not implemented yet (the engine has no counter writer ` +
          `and reads it as 0) — using it would silently compute the wrong value. ` +
          `Remove it, or implement counters first.`,
      });
    }
  }
  return out;
}
