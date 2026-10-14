/**
 * **buff / debuff 定义的内容校验**（字段合法性 + 与引擎能力的对账）。
 *
 * ==================================================================
 * 为什么单独一个文件
 * ==================================================================
 *
 * 从 `validate.ts` 横向切出来的（AGENTS.md §3 的 700 行上限）。本轮加
 * "消费机制"时它到了 **712 行** —— 按那条纪律（**先拆 util / 横向切割，
 * 不许压注释**），把"buff 这一整块"切出来，而不是删注释挤回上限。
 *
 * 切出来的是一块完整职责："**一个 `BuffDef` 写对了吗**"，两种判据都在这：
 *
 *   `validateBuff`          内容自己写错了吗？（时长 / 层数上限 / 引用的
 *                           技能与 buff 是否存在 / 文案 key / stat 名）
 *   `checkBuffCapabilities` 内容与**引擎当前的能力边界**对得上吗？
 *                           （消费触发引擎会不会派发 / `independent` 的修正）
 *
 * ⚠️ 后者的判据会随"引擎实现了什么"变化（判据本体在
 * `./capabilityAudit.ts`），前者不会 —— 所以两者分开放。接线一个新能力时
 * 只要动 `capabilityAudit.ts` 与这里的调用。
 *
 * ==================================================================
 * ⚠️ 必须连**内联**的 buff 一起校验
 * ==================================================================
 *
 * 内容作者可以直接在技能里写完整的 `BuffDef`（`hits[].effects[].buff`、
 * `grant.buff`、`trigger.then[].buff`…），`registry.ts` 的
 * `collectInlineBuffs` 会让它们照样能按 id 解析到。而那些恰恰是最容易写的
 * 一种 —— 「避」的无敌、「卸」的阈值都内联在技能里。
 *
 * 所以 `collectAllBuffDefs` 必须把顶层与内联的都收齐：漏一层就等于漏掉
 * 一处静默无效（buff 声明了消费，引擎因为找不到定义而不消费它）。
 */

import { buffAbilities } from '../expr/deps';
import { STAT_RULES } from '../stats/aggregate';
import type { Ability, BuffDef, GameEntity, SkillDef } from '../types';
import type { CapabilityIssue } from './capabilityAudit';
import { consumeIssues, independentModifierIssues } from './capabilityAudit';
import { validateLocaleKey } from './localeKey';
import type { ValidationIssue } from './validate';

/** 一整套内容里所有可能出现 `BuffDef` 的地方。 */
export interface BuffSources {
  readonly buffs: readonly BuffDef[];
  readonly skills: readonly SkillDef[];
  readonly entities: readonly GameEntity[];
}

/** 递归收集 `ability` 里内联的 buff（与 `registry.ts` 的 `collectInlineBuffs` 同一条路）。 */
function collectInlineBuffs(ability: Ability, into: BuffDef[]): void {
  switch (ability.kind) {
    case 'grant':
      into.push(ability.buff);
      for (const nested of buffAbilities(ability.buff)) collectInlineBuffs(nested, into);
      return;
    case 'trigger':
      for (const then of ability.trigger.then) collectInlineBuffs(then, into);
      return;
    case 'modifier':
    case 'derived':
    case 'deal':
    case 'grantSkill':
    case 'consume':
    case 'resource':
      return;
  }
}

/** 一整套内容里**全部** buff 定义（顶层 + 技能/实体里内联的）。 */
export function collectAllBuffDefs(sources: BuffSources): readonly BuffDef[] {
  const out: BuffDef[] = [...sources.buffs];
  for (const skill of sources.skills) {
    for (const ability of skill.abilities) collectInlineBuffs(ability, out);
    // ⚠️ 命中段里的内联 buff 只有主动技能有（被动技能没有 `hits`）。
    if (skill.kind !== 'activeSkill') continue;
    for (const hit of skill.hits) {
      for (const effect of hit.effects) if (effect.buff) out.push(effect.buff);
    }
  }
  for (const entity of sources.entities) {
    for (const ability of entity.abilities) collectInlineBuffs(ability, out);
  }
  return out;
}

/**
 * **一个 buff 定义写对了吗**。
 *
 * ⚠️ `checkAbilityHooks` 由调用方注入（`validate.ts` 的 `checkAbilityHooks`）：
 * 它同时查 hook 与 ability kind 两件事，而那两件事的判据在
 * `capabilityAudit.ts`，从那里 import 没问题 —— 但注入的写法让本文件
 * 不需要知道 `validate.ts` 内部的 `push` 约定（那里是另一套签名）。
 */
export function validateBuff(
  buff: BuffDef,
  buffIds: ReadonlySet<string>,
  skillIds: ReadonlySet<string>,
  localeKeys: ReadonlySet<string> | undefined,
  push: (i: ValidationIssue) => void,
  checkAbilityHooks: (abilities: readonly Ability[], prefix: string) => void,
): void {
  const at = (field: string): string => `buff:${buff.id}.${field}`;

  validateLocaleKey(buff.nameKey, at('nameKey'), localeKeys, push);

  if (buff.duration <= 0) {
    push({
      severity: 'error',
      code: 'ZERO_DURATION',
      path: at('duration'),
      message: `duration must be > 0 (got ${buff.duration})`,
    });
  }

  if (buff.stacking.mode === 'stack' || buff.stacking.mode === 'stackRefresh') {
    if (!Number.isFinite(buff.stacking.max) || buff.stacking.max < 1) {
      push({
        severity: 'error',
        code: 'UNCAPPED_STACK',
        path: at('stacking.max'),
        message: 'stacking.max must be a positive finite number',
      });
    }
  }

  // 派生窗口引用的技能必须存在
  for (const skillId of buff.flags?.comboWindow ?? []) {
    if (!skillIds.has(skillId)) {
      push({
        severity: 'error',
        code: 'MISSING_SKILL',
        path: at('flags.comboWindow'),
        message: `comboWindow references unknown skill "${skillId}"`,
      });
    }
  }

  // 修正的 stat 必须在规则表里
  for (const [index, modifier] of (buff.modifiers ?? []).entries()) {
    if (!(modifier.stat in STAT_RULES)) {
      push({
        severity: 'error',
        code: 'UNKNOWN_STAT',
        path: at(`modifiers[${index}].stat`),
        message: `unknown stat "${modifier.stat}"`,
      });
    }
    validateLocaleKey(modifier.sourceKey, at(`modifiers[${index}].sourceKey`), localeKeys, push);
  }

  // 触发产出的 buff 必须存在
  for (const trigger of buff.triggers ?? []) {
    for (const then of trigger.then) {
      if (then.kind === 'grant' && !buffIds.has(then.buff.id)) {
        push({
          severity: 'error',
          code: 'MISSING_BUFF',
          path: at('triggers'),
          message: `grant references unknown buff "${then.buff.id}"`,
        });
      }
    }
  }

  // 触发器挂的 hook 必须在引擎**真的会派发**的那几个里
  checkAbilityHooks(buffAbilities(buff), at(''));
}

/**
 * **buff ↔ 引擎能力的对账**（判据在 `./capabilityAudit.ts`）。
 *
 * 两种问题都是**静默**的，所以都在默认严格模式下报 error：
 *   - 声明了消费触发但引擎不派发它 / 写了 `consume` 却没写 `on`
 *     → buff **永远不消失**（下一击还能再吃一次）
 *   - `independent` + `modifiers` → 修正被展开 N 次（数值静默变大）
 */
export function checkBuffCapabilities(
  sources: BuffSources,
  push: (i: ValidationIssue) => void,
): void {
  const buffs = collectAllBuffDefs(sources);
  for (const issue of [...consumeIssues(buffs), ...independentModifierIssues(buffs)]) {
    pushCapabilityIssue(issue, push);
  }
}

/**
 * `CapabilityIssue` → `ValidationIssue`。
 *
 * ⚠️ 两边的 `code` 是**同一张联合类型**（`ValidationCode` 里登记了这几个
 * 码，见 `validate.ts`），所以这里是直接转发而不是映射 —— 映射表会是
 * 第三份需要同步的清单。
 */
function pushCapabilityIssue(
  issue: CapabilityIssue,
  push: (i: ValidationIssue) => void,
): void {
  push(issue);
}
