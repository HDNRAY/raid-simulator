/**
 * **内容里的时间值必须落在 0.1 秒刻度上**（校验码 `OFF_GRID_TIME`）。
 *
 * ==================================================================
 * 它拦的是什么（这条规则为什么**必须**存在）
 * ==================================================================
 *
 * 一次真实的静默撒谎（2026-10-12）：「拳」的 `castTime` 写成了
 * `logicMs(2.5)` = **250ms**。它一路通过校验，然后在三个地方各自撒谎：
 *
 *   - 设置页显示 `displaySeconds(250)` = `Math.round(250 / 100) / 10`
 *     = **0.3 秒**（显示向上折到刻度），玩家看到的数与内容写的数不同
 *   - 引擎真的跑 250ms（`castPipeline` 按 `elapsedMs >= castTimeMs` 比），
 *     于是"0.3 秒"对应的读条其实只有 0.25 秒 —— 显示与实现**差一整个刻度**
 *   - 而 buff 时长走 `durationToTicks` = `Math.round(ms / (1000/60))`
 *     （`core/buffs/index.ts`）：250ms → 15 tick = 250ms，但 0.3 秒
 *     本该是 18 tick —— 同一个内容值在两个子系统里落成**不同的时间**
 *
 * 三处都不报错、都不会崩，肉眼也看不出来。这正是 AGENTS.md §2 的第三类：
 *
 *   | 性质 | 处理 |
 *   |---|---|
 *   | **会静默算错 / 静默无效**：用了不报错、结果错 | **校验报错拦下** |
 *
 * 判据：本作的时间只有两个刻度 —— 物理 tick 60Hz、**逻辑步 0.1 秒**。
 * 一切"时长"语义的值都声明在逻辑步上（`logicMs(steps)` = `steps × 100`），
 * 所以**毫秒值必须是 100 的整数倍**。不是整数倍 = 这个值在逻辑层不可
 * 忠实地表达，实现只能取整，而"取整给哪个方向"在显示与引擎之间并不一致。
 *
 * ==================================================================
 * 拦哪些字段（"时长"的清单 —— 加新字段时请一起更新）
 * ==================================================================
 *
 * | 字段 | 为什么算"时长" |
 * |---|---|
 * | `skill.castTime` | 读条时长（0 = 瞬发），直接进 `CastInstance.castTimeMs` |
 * | `skill.channel.durationMs` / `.tickIntervalMs` | 引导总时长与每跳间隔 |
 * | `skill.charges.rechargeMs` | 充能回复时长 |
 * | `skill.cooldown` | 冷却时长（正数；0 = 无 CD） |
 * | `skill.hits[].at` | hit frame：相对技能开始的毫秒偏移，与 `castTime` 同刻度比对 |
 * | `effect.cooldownMs` | 调 CD 的毫秒数（负数 = 退还，取绝对值判刻度） |
 * | `consumable.cooldownMs` | 消耗品冷却时长 |
 * | `buff.duration` | buff / debuff 时长（`POSITIVE_INFINITY` = 永久，豁免） |
 * | `buff.stacking.maxDurationMs` | `extend` 叠层的时长上限 |
 * | `trigger.cooldownMs` | 触发器的防抖内置 CD |
 * | `behavior.atMs`（enrage） | 超时狂暴的触发时刻（与 `elapsedMs` 比） |
 * | `behavior.delayMs`（opener） | 开场延迟 |
 * | `behavior.gapMs`（rotation / weightedRotation） | "两刀之间至少隔多久" |
 * | `encounter.timeLimitMs` | 整场时限（`encounterEnd` 里与 `tick × MS_PER_TICK` 比） |
 *
 * ⚠️ **本清单就是"哪些算时长"的判据**：这个字段的值会被拿去与
 * **时间**（elapsed / tick / 另一个时长）比较，或者会被累加进时间。
 * 只做数值缩放、比较当量的字段不在其中（理由见下）。
 *
 * ==================================================================
 * 明确**排除**：速率 / 每步消耗（故意不去误伤）
 * ==================================================================
 *
 * `holdDrain.perLogicTick`（「卸」= **1.5**）**不是时长**，是
 * "**每个逻辑步扣多少资源**"：
 *
 *   - 它的语义是**速率**（1.5 / 0.1 秒 = 15 炁/秒），本来就是小数；
 *     换算由 `core/combat/holds.ts` 的 `holdDrainPerSecond()` 单向提供
 *   - 它有**专门的整数欠账累加器**（`holds.ts`）来吸收小数部分，
 *     所以"按住 1 秒 = 恰好 15 炁"是精确的 —— 不是静默取整
 *   - 它有**专门的测试**保护（`tests/unit/holdDrain.test.ts`）
 *
 * 换句话说：它的小数是**设计的一部分、有正确的消费者**，而不是
 * "写在时间刻度外的时长"。把它一起拦下来是误伤。
 *
 * ⚠️ 同理，`atMs` / `delayMs` / `gapMs` 里的数字虽然也叫 ms，但它们是
 * **时刻**或**间隔**，判刻度用的是"它会不会被拿去与时间比"这条线 ——
 * 它们都在上表里（会比较），所以照拦。
 *
 * ==================================================================
 * `gapMs` 的单独说明（拿不准 → 判据）
 * ==================================================================
 *
 * `gapMs` 的判定天生是 tick 量化的：
 *
 *   `(tick - last) * (1000 / 60) >= gapMs`（`core/ai/index.ts`）
 *
 * 所以一个 417ms 的 `gapMs` 在运行期**不会**裂成两个不同的时间 ——
 * 它只会被比到最近的 tick 边界上（`Math.round` 容差半个 tick ≈ 8.3ms）。
 * 这一条与 `castTime` 那个"显示 0.3 / 实现 0.25"的病**不同**。
 *
 * **但它仍然被拦**，理由有二：
 *   1. 它表达的是"两刀之间至少隔多久" —— 是**时长**语义，不是速率；
 *      豁免它就得为它单独写一条"哪些 ms 需要刻度"的例外，而那条例外
 *      下一个人无法从字段名看出来
 *   2. 现有内容的 `gapMs` **全部**是 100 的整数倍（4000 / 5000 /
 *      8000 / 1500），所以拦它**零代价**，却把"以后有人写 417"也统一了
 *
 * 换句话说：**这里选择拦**，不是因为 417 会撒谎，而是因为它是时长。
 * 若将来确认"gapMs 允许任意 ms"，把这一条从清单里摘掉即可（改一处）。
 *
 * ⚠️ 不在这里的 `BattleEngineOptions.timeLimitMs` 是**引擎运行期选项**，
 * 不是内容字段（由 `app/battleSetup.ts` 传），所以校验器看不到它 ——
 * 它的刻度纪律由调用方负责。
 */

import { LOGIC_TICK_MS } from '../loopConstants';
import type {
  Ability,
  Behavior,
  BuffDef,
  ConsumableEntity,
  Effect,
  EncounterDef,
  GameEntity,
  SkillDef,
} from '../types';

/** 本文件负责的校验码。 */
export type TimeGridCode = 'OFF_GRID_TIME';

/** 一条"时间值不在逻辑时刻度上"的问题（由 `validate.ts` 转成 `ValidationIssue`）。 */
export interface TimeGridIssue {
  readonly severity: 'error';
  readonly code: TimeGridCode;
  readonly path: string;
  readonly message: string;
}

/**
 * 时间栅格检查需要的内容。
 *
 * 只声明用到的字段（而不是 import `validate.ts` 的 `ContentBundle`）：
 * `validate.ts` 要 import 本文件，类型上互不依赖更难描述错。
 * `ContentBundle` 结构上满足本接口，所以直接传得进来。
 */
export interface TimeGridInput {
  readonly entities: readonly GameEntity[];
  readonly skills: readonly SkillDef[];
  readonly buffs: readonly BuffDef[];
  readonly encounters?: readonly EncounterDef[];
}

/** 收集到的一个候选字段：值 + 人可读路径 + 字段名（报错里要指出来）。 */
interface Field {
  readonly ms: number;
  readonly path: string;
  readonly name: string;
}

/* ------------------------------------------------------------------ *
 * 1. 收集：把"时长"字段摊平
 * ------------------------------------------------------------------ */

/**
 * 摊平一份内容里全部"时长"语义的毫秒值。
 *
 * ⚠️ 覆盖范围必须与文件头的清单一致 —— 清单改了这里也要改。
 * 递归进 `trigger.then` 与 `grant.buff`，因为**内容里嵌着的 buff 也有
 * 时长**（`hits[].effects[].buff`、`grant` 的 `ability.buff`、
 * `buff.triggers[].then[].buff` …），漏一层就是漏一处静默撒谎。
 */
function collectTimeFields(input: TimeGridInput): readonly Field[] {
  const out: Field[] = [];

  for (const entity of input.entities) {
    const base = `${entity.kind}:${entity.id}`;
    if (isConsumable(entity)) field(out, entity.cooldownMs, `${base}.cooldownMs`, 'cooldownMs');
    collectAbilityFields(entity.abilities, `${base}.abilities`, out);
  }

  for (const skill of input.skills) {
    const base = `skill:${skill.id}`;
    field(out, skill.castTime, `${base}.castTime`, 'castTime');
    field(out, skill.cooldown, `${base}.cooldown`, 'cooldown');
    if (skill.channel) {
      field(out, skill.channel.durationMs, `${base}.channel.durationMs`, 'durationMs');
      field(out, skill.channel.tickIntervalMs, `${base}.channel.tickIntervalMs`, 'tickIntervalMs');
    }
    if (skill.charges) {
      field(out, skill.charges.rechargeMs, `${base}.charges.rechargeMs`, 'rechargeMs');
    }
    for (const [index, hit] of skill.hits.entries()) {
      field(out, hit.at, `${base}.hits[${index}].at`, 'at');
      collectEffectFields(hit.effects, `${base}.hits[${index}].effects`, out);
    }
    collectAbilityFields(skill.abilities, `${base}.abilities`, out);
  }

  for (const buff of input.buffs) collectBuffFields(buff, `buff:${buff.id}`, out);

  for (const encounter of input.encounters ?? []) {
    const base = `encounter:${encounter.id}`;
    field(out, encounter.timeLimitMs, `${base}.timeLimitMs`, 'timeLimitMs');
    collectBehaviorFields(encounter.boss.behaviors, `${base}.boss.behaviors`, out);
  }

  return out;
}

/** 收集 buff 自身的时长字段，并递归它内嵌的 triggers。 */
function collectBuffFields(buff: BuffDef, path: string, out: Field[]): void {
  field(out, buff.duration, `${path}.duration`, 'duration');
  if (buff.stacking.mode === 'extend') {
    field(out, buff.stacking.maxDurationMs, `${path}.stacking.maxDurationMs`, 'maxDurationMs');
  }
  for (const [index, trigger] of (buff.triggers ?? []).entries()) {
    field(out, trigger.cooldownMs, `${path}.triggers[${index}].cooldownMs`, 'cooldownMs');
    collectAbilityFields(trigger.then, `${path}.triggers[${index}].then`, out);
  }
}

/** 递归一组效果里的 `cooldownMs`（含 `onSuccess` 的嵌套）。 */
function collectEffectFields(effects: readonly Effect[], prefix: string, out: Field[]): void {
  for (const [index, effect] of effects.entries()) {
    const base = `${prefix}[${index}]`;
    /**
     * 取绝对值：`cooldownMs` 是**有符号**的（负数 = 退还，
     * 见「截」的 `cooldownMs: -logicMs(100)`），刻度与符号无关。
     */
    if (effect.cooldownMs !== undefined) {
      field(out, Math.abs(effect.cooldownMs), `${base}.cooldownMs`, 'cooldownMs');
    }
    collectEffectFields(effect.onSuccess ?? [], `${base}.onSuccess`, out);
  }
}

/** 递归一组能力里的时间字段（含 `trigger.then` 与 `grant.buff`）。 */
function collectAbilityFields(abilities: readonly Ability[], prefix: string, out: Field[]): void {
  for (const [index, ability] of abilities.entries()) {
    const base = `${prefix}[${index}]`;
    switch (ability.kind) {
      case 'trigger':
        field(out, ability.trigger.cooldownMs, `${base}.trigger.cooldownMs`, 'cooldownMs');
        collectAbilityFields(ability.trigger.then, `${base}.trigger.then`, out);
        break;
      case 'grant':
        collectBuffFields(ability.buff, `${base}.buff`, out);
        break;
      case 'deal':
      case 'modifier':
      case 'derived':
      case 'grantSkill':
      case 'consume':
      case 'resource':
        break;
    }
  }
}

/** 收集 Boss 行为里的时刻 / 间隔字段。 */
function collectBehaviorFields(behaviors: readonly Behavior[], prefix: string, out: Field[]): void {
  for (const [index, behavior] of behaviors.entries()) {
    const base = `${prefix}[${index}]`;
    switch (behavior.kind) {
      case 'enrage':
        field(out, behavior.atMs, `${base}.atMs`, 'atMs');
        break;
      case 'opener':
        field(out, behavior.delayMs, `${base}.delayMs`, 'delayMs');
        break;
      case 'rotation':
        for (const [step, stepDef] of behavior.steps.entries()) {
          field(out, stepDef.gapMs, `${base}.steps[${step}].gapMs`, 'gapMs');
        }
        break;
      case 'weightedRotation':
        field(out, behavior.gapMs, `${base}.gapMs`, 'gapMs');
        break;
      case 'onHpBelow':
        collectAbilityFields(behavior.then, `${base}.then`, out);
        break;
    }
  }
}

/** 收一个候选字段（`undefined` = 内容没写这个字段，跳过）。 */
function field(out: Field[], ms: number | undefined, path: string, name: string): void {
  if (ms === undefined) return;
  out.push({ ms, path, name });
}

/**
 * 类型谓词：把 `GameEntity` 窄化到 `ConsumableEntity`。
 *
 * ⚠️ 与 `validate.ts` 的 `isEquipment` 同一个理由、同一种写法 —— **用
 * 谓词而不是内联 `entity.kind === 'consumable'`**：`GameEntity.kind` 是
 * 宽联合（`ConsumableEntity extends GameEntity`，不是 discriminated
 * union），内联判断的收窄很脆 —— 只要在判断之前顺手读过一次
 * `entity.kind`（我踩过：拼 path 时写成 `const base = \`${entity.kind}…\``），
 * `entity` 本身的收窄就没了，`entity.cooldownMs` 直接报 TS2339。
 * 写成谓词，收窄由函数签名保证，不依赖读的先后。
 */
function isConsumable(entity: GameEntity): entity is ConsumableEntity {
  return entity.kind === 'consumable';
}

/* ------------------------------------------------------------------ *
 * 2. 判定：值必须在 0.1 秒刻度上
 * ------------------------------------------------------------------ */

/**
 * 单个时长值是否在逻辑步刻度上。
 *
 * 用 `% LOGIC_TICK_MS`（而不是 `ms === logicMs(ms / 100)` 那种换算，
 * 也不是 `logicTicks()` —— 后者对非整数步**抛错**，在这里会变成一条
 * 崩掉的校验器而不是一条问题）。`logicMs(steps)` 是乘法，
 * 所以"用 `logicMs` 写的值"必然精确通过。
 */
export function isOnTimeGrid(ms: number): boolean {
  /**
   * `POSITIVE_INFINITY` = **永久**（内容里合法地用着：`boss-shared` 的
   * 永久 buff），它不是时长，豁免。其余非有限值（`NaN`）也在这里放过
   * —— 那是别的校验的职责。
   */
  if (!Number.isFinite(ms)) return true;
  return ms % LOGIC_TICK_MS === 0;
}

/**
 * 报出全部"不在 0.1 秒刻度上"的时间值（`OFF_GRID_TIME`）。
 *
 * 每个值报**一条**，路径指到具体字段 —— "哪个内容的哪个字段写坏了"
 * 是内容作者唯一能拿来定位的信息。
 */
export function offGridTimeIssues(input: TimeGridInput): readonly TimeGridIssue[] {
  const out: TimeGridIssue[] = [];
  for (const { ms, path, name } of collectTimeFields(input)) {
    if (isOnTimeGrid(ms)) continue;
    out.push({
      severity: 'error',
      code: 'OFF_GRID_TIME',
      path,
      message:
        `${name} = ${ms}ms is not on the 0.1s logic grid ` +
        `(must be a multiple of ${LOGIC_TICK_MS}ms — write it as logicMs(steps)) — ` +
        `the engine would round it to one time while display rounds it to another, ` +
        `so the number shown to the player would silently differ from the one simulated`,
    });
  }
  return out;
}
