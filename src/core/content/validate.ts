/**
 * 内容校验器。
 *
 * 数据模型规范 §11：所有 `ContentDef` 在**加载期**进入校验器。
 * 任一失败 → 启动即失败，**绝不允许带着非法数据进战斗**。
 *
 * 为什么这件事必须在加载期做：非法内容的表现为
 * "战斗中某个技能没反应"或"栈溢出"，在战斗里定位极难。
 * 静态分析能在启动时给出**完整路径**（哪个内容、哪个字段、哪条依赖链）。
 */

import { assertNoCycles, buffAbilities, buildDependencyGraph } from '../expr/deps';
import {
  SUPPORTED_HOOKS,
  abilityHookIssues,
  abilityKindIssues,
  counterExprIssues,
  type CapabilityIssue,
  type ContentRoot,
} from './capabilityAudit';
import { offGridTimeIssues } from './timeGrid';
import type {
  Ability,
  BuffDef,
  EncounterDef,
  GameEntity,
  SkillDef,
  StatKey,
  Behavior,
} from '../types';
import { STAT_RULES } from '../stats/aggregate';

/**
 * 重新导出：`SUPPORTED_HOOKS` 是"引擎会处理哪些 hook"的唯一真相源，
 * 现在住在 `./capabilityAudit.ts`（对账那个职责里），但调用方
 * （测试、工具）一直从校验器入口拿它。
 */
export { SUPPORTED_HOOKS };

export type ValidationCode =
  | 'DUP_ID'
  | 'MISSING_BUFF'
  | 'MISSING_SKILL'
  | 'MISSING_SOURCE'
  | 'MISSING_LOCALE_KEY'
  | 'KEY_ID_MISMATCH'
  | 'CYCLE'
  | 'HIT_ORDER'
  | 'ZERO_DURATION'
  | 'UNCAPPED_STACK'
  | 'BAD_CLAMP'
  | 'DANGLING_NAMESPACE'
  | 'HARDCODED_TEXT'
  | 'UNKNOWN_STAT'
  | 'EMPOWERED_ABILITY'
  /**
   * `onSuccess` 退还的冷却与自己扣的不相等。
   *
   * 「截」的"成功不进 CD"就是靠这两个数字相等实现的 —— 不等会静默
   * 坏掉（退多了被钳住看不出来，退少了成功之后还剩一截 CD）。
   */
  | 'COOLDOWN_REFUND_MISMATCH'
  /**
   * 内容用了 `Expr.counter`（离散计数器）。
   *
   * ⚠️ 这是个**能力尚未接线**的检查，不是"内容写错了"：计数器没有写入者，
   * 战斗路径的 `getCounter` 是 `() => 0` 的桩 —— 用它会**静默得到 0**
   * （不是报错，是算错，最坏的一种）。所以这里**默认拒绝**：
   * 类型保留、能力保留，但在实现之前不可能被静默误用。
   *
   * 实现计数器之后把这条检查删掉即可。
   */
  | 'COUNTER_UNIMPLEMENTED'
  /**
   * 内容用了引擎**没有执行点**的 `Ability` kind（`grantSkill` / `consume`）。
   *
   * 同 `COUNTER_UNIMPLEMENTED` 的性质：它们是**设计过但还没接线**的能力
   * （类型保留），可写进内容会**静默无效** —— 所以默认拒绝。
   * "故意留给未来"也不例外：那该写成注释/TODO，而不是一份看起来会生效的内容。
   * 想写设计稿就显式 `{ strict: false }`。
   */
  | 'ABILITY_UNIMPLEMENTED'
  /**
   * 内容挂了引擎**不会派发**的 hook。
   *
   * 同 `COUNTER_UNIMPLEMENTED` 的性质：`Hook` 是一整张声明表，
   * 其中只有 `SUPPORTED_HOOKS` 会被真的处理。写进内容却不在表里的
   * hook **静默无效** —— 所以默认拒绝，而不是让人"写了却没反应"。
   */
  | 'UNSUPPORTED_HOOK'
  /**
   * 时间值不在 **0.1 秒（一个逻辑步）的刻度**上，例如 `castTime: logicMs(2.5)`
   * = 250ms。
   *
   * 与上面几条不同：这不是"引擎还没实现"，而是**内容写错了**，而且错得
   * 很安静 —— 显示会向上折到 0.3 秒、引擎按 250ms 跑，两边**差一整个
   * 刻度**，不报错、不崩、肉眼看不出来。所以照 AGENTS.md §2 的第三类
   * 处理：**校验报错拦下**。
   *
   * ⚠️ 拦哪些字段（含为什么排除 `holdDrain.perLogicTick`、`gapMs` 怎么判）
   * 全写在 `./timeGrid.ts` 的文件头 —— 判据在那里，这里只登记校验码。
   */
  | 'OFF_GRID_TIME';

export interface ValidationIssue {
  readonly severity: 'error' | 'warning';
  readonly code: ValidationCode;
  /** 出问题的位置，如 `entropy-clock.abilities[2].trigger.then[0]` */
  readonly path: string;
  readonly message: string;
}

export interface ContentBundle {
  readonly entities: readonly GameEntity[];
  readonly skills: readonly SkillDef[];
  readonly buffs: readonly BuffDef[];
  /**
   * 全部合法文案 key。
   *
   * 由**调用方**提供（core 不许 import i18n）。不给则跳过 key 存在性校验
   * —— 浏览器的入口会传真实语言包，纯逻辑测试可以不传。
   */
  readonly localeKeys?: ReadonlySet<string>;
  readonly encounters?: readonly EncounterDef[];
}

export interface ValidateOptions {
  /** 严格模式（默认 true）：把 warning 也当错误 */
  readonly strict?: boolean;
}

/**
 * 校验一整套内容。
 *
 * 返回全部问题（不是遇到第一个就抛），这样内容作者能一次看到所有要修的。
 */
export function validateContent(
  bundle: ContentBundle,
  options: ValidateOptions = {},
): readonly ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const push = (issue: ValidationIssue): void => {
    issues.push(issue);
  };

  const buffIds = new Set(bundle.buffs.map((b) => b.id));
  const skillIds = new Set(bundle.skills.map((s) => s.id));
  const entityIds = new Set(bundle.entities.map((e) => e.id));

  /* ---------- 1. id 唯一性 ---------- */
  checkDuplicates(bundle.entities.map((e) => e.id), 'entity', push);
  checkDuplicates(bundle.skills.map((s) => s.id), 'skill', push);
  checkDuplicates(bundle.buffs.map((b) => b.id), 'buff', push);

  /* ---------- 2. 内容定义自身的字段 ---------- */
  for (const skill of bundle.skills) {
    validateSkill(skill, skillIds, buffIds, bundle.localeKeys, push);
  }
  for (const buff of bundle.buffs) {
    validateBuff(buff, buffIds, skillIds, bundle.localeKeys, push);
  }
  for (const entity of bundle.entities) {
    validateEntity(entity, entityIds, buffIds, skillIds, bundle.localeKeys, push);
  }

  /* ---------- 2c. 未接线能力的"拒绝静默误用" ---------- */
  // `Expr.counter` 读出来恒为 0（没有写入者），用了就是**静默算错** ——
  // 所以默认拒绝，而不是让它在战斗里安静地给出错误数值。
  pushCapabilityIssues(counterExprIssues(contentRootsOf(bundle)), push);

  /* ---------- 2d. 时间值必须落在 0.1 秒刻度上 ---------- */
  // 判据与字段清单在 `./timeGrid.ts` 的文件头（那是"内容写错了"这一类，
  // 与上面那份"引擎能力对账"是两个职责，所以分开）。
  pushTimeGridIssues(bundle, push);

  /* ---------- 3. 依赖图与环检测 ---------- */
  const allAbilities = [
    ...bundle.entities.flatMap((e) => e.abilities),
    ...bundle.skills.flatMap((s) => s.abilities),
    ...bundle.buffs.flatMap((b) => buffAbilities(b)),
  ];
  const graph = buildDependencyGraph(allAbilities);
  for (const cycle of graph.cycles) {
    push({
      severity: 'error',
      code: 'CYCLE',
      path: 'dependency-graph',
      message: `circular stat dependency: ${cycle.join(' -> ')}`,
    });
  }

  /* ---------- 4. 命名空间声明完整性 ---------- */
  const declaredNamespaces = new Set<string>();
  for (const ability of allAbilities) {
    if (ability.kind === 'derived' && ability.modifier.namespace) {
      declaredNamespaces.add(ability.modifier.namespace);
    }
    if (ability.kind === 'modifier' && ability.modifier.namespace) {
      declaredNamespaces.add(ability.modifier.namespace);
    }
  }
  for (const ability of allAbilities) {
    const namespaces = collectContribNamespaces(ability);
    for (const ns of namespaces) {
      if (!declaredNamespaces.has(ns)) {
        push({
          severity: 'error',
          code: 'DANGLING_NAMESPACE',
          path: `ability.${ability.kind}`,
          message: `contrib references undeclared namespace "${ns}"`,
        });
      }
    }
  }

  /* ---------- 5. 遭遇战 ---------- */
  for (const encounter of bundle.encounters ?? []) {
    for (const skillId of encounter.boss.behaviors.flatMap(behaviorSkillRefs)) {
      if (!skillIds.has(skillId)) {
        push({
          severity: 'error',
          code: 'MISSING_SKILL',
          path: `${encounter.id}.boss.behaviors`,
          message: `unknown skill "${skillId}"`,
        });
      }
    }
  }

  /**
   * 严格模式（默认开）：**warning 也算问题**。
   *
   * 这条以前是个空壳 —— `options.strict` 被读了却什么都不做（注释写着
   * "warning 也视为需要处理"，代码里没有一行）。现在让它真的生效：
   * 把 warning 提升成 error，于是 `assertValidContent` 会因此抛错。
   *
   * 为什么要有这个开关：warning 是"内容合法、但引擎不会照它做"（例如
   * 挂了不派发的 hook）。开发/CI 应当失败，让人立刻发现；而"承认现状"
   * 的场合（例如检查设计样本本身）可以显式传 `strict: false` 只看分级。
   */
  if (options.strict !== false) {
    return issues.map((issue) =>
      issue.severity === 'warning' ? { ...issue, severity: 'error' as const } : issue,
    );
  }

  return issues;
}

/** 便捷入口：有 error 就抛。 */
export function assertValidContent(bundle: ContentBundle): void {
  const issues = validateContent(bundle);
  const errors = issues.filter((i) => i.severity === 'error');
  if (errors.length > 0) {
    const detail = errors.map((e) => `  [${e.code}] ${e.path}: ${e.message}`).join('\n');
    // 开发者错误：用英文（i18n 规范 I1）
    throw new Error(`invalid content (${errors.length} error(s)):\n${detail}`);
  }
}

/* ------------------------------------------------------------------ *
 * 内部检查
 * ------------------------------------------------------------------ */

/**
 * 把"内容 ↔ 引擎能力的对账"结果转成校验问题。
 *
 * 对账本身（哪些 hook 引擎不处理、`Expr.counter` 为什么不能碰）在
 * `./capabilityAudit.ts` —— 那是**另一个职责**：判据随"引擎实现了什么"
 * 变化，与"内容字段是否合法"分开。
 */
function pushCapabilityIssues(
  issues: readonly CapabilityIssue[],
  push: (i: ValidationIssue) => void,
): void {
  for (const issue of issues) push(issue);
}

/** 把"时间值不在 0.1 秒刻度上"（`OFF_GRID_TIME`）转成校验问题。 */
function pushTimeGridIssues(
  bundle: ContentBundle,
  push: (i: ValidationIssue) => void,
): void {
  for (const issue of offGridTimeIssues(bundle)) push(issue);
}

/** 对一组能力做"引擎会不会处理 / 有没有执行点"的对账。 */
function checkAbilityHooks(
  abilities: readonly Ability[],
  prefix: string,
  push: (i: ValidationIssue) => void,
): void {
  pushCapabilityIssues(abilityHookIssues(abilities, prefix), push);
  pushCapabilityIssues(abilityKindIssues(abilities, prefix), push);
}

/** 内容树的所有根（实体 / 技能 / buff / 遭遇战），供 `Expr.counter` 深度扫描用。 */
function contentRootsOf(bundle: ContentBundle): readonly ContentRoot[] {
  return [
    ...bundle.entities.map((e) => ({ path: `${e.kind}:${e.id}`, node: e })),
    ...bundle.skills.map((s) => ({ path: `skill:${s.id}`, node: s })),
    ...bundle.buffs.map((b) => ({ path: `buff:${b.id}`, node: b })),
    ...(bundle.encounters ?? []).map((e) => ({ path: `encounter:${e.id}`, node: e })),
  ];
}

function checkDuplicates(ids: readonly string[], kind: string, push: (i: ValidationIssue) => void): void {
  const seen = new Set<string>();
  for (const id of ids) {
    if (seen.has(id)) {
      push({
        severity: 'error',
        code: 'DUP_ID',
        path: `${kind}:${id}`,
        message: `duplicate ${kind} id "${id}"`,
      });
    }
    seen.add(id);
  }
}

function validateLocaleKey(
  key: string | undefined,
  path: string,
  localeKeys: ReadonlySet<string> | undefined,
  push: (i: ValidationIssue) => void,
): void {
  if (key === undefined) return;
  if (localeKeys && !localeKeys.has(key)) {
    push({
      severity: 'error',
      code: 'MISSING_LOCALE_KEY',
      path,
      message: `locale key "${key}" does not exist in the catalog`,
    });
  }
}

function validateSkill(
  skill: SkillDef,
  skillIds: ReadonlySet<string>,
  buffIds: ReadonlySet<string>,
  localeKeys: ReadonlySet<string> | undefined,
  push: (i: ValidationIssue) => void,
): void {
  const at = (field: string): string => `skill:${skill.id}.${field}`;

  validateLocaleKey(skill.nameKey, at('nameKey'), localeKeys, push);

  // hit 时间必须升序
  for (let i = 1; i < skill.hits.length; i += 1) {
    const prev = skill.hits[i - 1];
    const curr = skill.hits[i];
    if (prev && curr && curr.at < prev.at) {
      push({
        severity: 'error',
        code: 'HIT_ORDER',
        path: at(`hits[${i}].at`),
        message: `hit times must be ascending: ${prev.at} then ${curr.at}`,
      });
    }
  }

  // 读条技能必须有 hit 落在读条结束前或恰好结束时
  for (const [index, hit] of skill.hits.entries()) {
    for (const effect of hit.effects) {
      if (effect.kind === 'grantBuff' || effect.kind === 'removeBuff') {
        const id = effect.buff?.id ?? effect.buffId;
        if (id && !buffIds.has(id)) {
          push({
            severity: 'error',
            code: 'MISSING_BUFF',
            path: at(`hits[${index}].effects`),
            message: `unknown buff "${id}"`,
          });
        }
      }
    }
  }

  // 技能能力里引用的技能必须存在（`grantSkill` 是"授予主动技能"那条路）
  for (const ability of skill.abilities) {
    if (ability.kind === 'grantSkill' && !skillIds.has(ability.skillId)) {
      push({
        severity: 'error',
        code: 'MISSING_SKILL',
        path: at('abilities'),
        message: `grantSkill references unknown skill "${ability.skillId}"`,
      });
    }
  }

  // 触发器挂的 hook 必须在引擎**真的会处理**的那几个里
  checkAbilityHooks(skill.abilities, at('abilities'), push);

  /**
   * **退还的冷却不能超过自己扣的冷却**。
   *
   * 需求（「截」）："如果成功，不进入 cd，失败则 cd 10 秒" ——
   * 实现是"施放时扣 10 秒，成功时退还 10 秒"。两者**必须相等**：
   *
   *   - 退多了 → 减到 `tick` 被钳住，**看起来对**，但掩盖了配置错误
   *   - 退少了 → 成功之后还剩一截 CD，玩家会以为"怎么还在转"
   *
   * 这条断言就是防那两种。踩过的坑：这种"两个数字必须相等"的约定
   * 只写在注释里，改一个忘一个就静默坏掉 —— 所以让它可执行。
   */
  for (const [hitIndex, hit] of skill.hits.entries()) {
    for (const [effectIndex, effect] of hit.effects.entries()) {
      for (const nested of effect.onSuccess ?? []) {
        if (nested.kind !== 'cooldown') continue;
        // 只校验"退自己"的情况（`skillId` 填了别人的属于另一回事）
        const which = nested.skillId ?? skill.id;
        if (which !== skill.id) continue;
        const refund = -(nested.cooldownMs ?? 0);
        if (refund > 0 && refund !== skill.cooldown) {
          push({
            severity: 'error',
            code: 'COOLDOWN_REFUND_MISMATCH',
            path: at(`hits[${hitIndex}].effects[${effectIndex}].onSuccess`),
            message:
              `refunds ${refund}ms but skill cooldown is ${skill.cooldown}ms — ` +
              `"no cooldown on success" requires them to be equal`,
          });
        }
      }
    }
  }
}

function validateBuff(
  buff: BuffDef,
  buffIds: ReadonlySet<string>,
  skillIds: ReadonlySet<string>,
  localeKeys: ReadonlySet<string> | undefined,
  push: (i: ValidationIssue) => void,
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
  checkAbilityHooks(buffAbilities(buff), at(''), push);
}

function validateEntity(
  entity: GameEntity,
  entityIds: ReadonlySet<string>,
  buffIds: ReadonlySet<string>,
  skillIds: ReadonlySet<string>,
  localeKeys: ReadonlySet<string> | undefined,
  push: (i: ValidationIssue) => void,
): void {
  const at = (field: string): string => `${entity.kind}:${entity.id}.${field}`;

  validateLocaleKey(entity.nameKey, at('nameKey'), localeKeys, push);
  validateLocaleKey(entity.descKey, at('descKey'), localeKeys, push);

  // key 与 id 的对应关系（i18n 规范 §5 的 KEY_ID_MISMATCH）
  if (entity.nameKey.startsWith('entity.')) {
    const subject = toSubject(entity.id);
    const expected = `entity.${subject}.`;
    if (!entity.nameKey.startsWith(expected)) {
      push({
        severity: 'error',
        code: 'KEY_ID_MISMATCH',
        path: at('nameKey'),
        message: `nameKey "${entity.nameKey}" does not match id "${entity.id}" (expected prefix "${expected}")`,
      });
    }
  }

  // 装备类才有 grantsSkills（便利写法）。
  // GameEntity 是基类，`kind === 'equipment'` 不会自动窄化到 EquipmentEntity，
  // 所以用一个显式的类型谓词。
  if (isEquipment(entity)) {
    for (const skillId of entity.grantsSkills ?? []) {
      if (!skillIds.has(skillId)) {
        push({
          severity: 'error',
          code: 'MISSING_SKILL',
          path: at('grantsSkills'),
          message: `grantsSkills references unknown skill "${skillId}"`,
        });
      }
    }
  }

  for (const [index, modifier] of entity.abilities.entries()) {
    switch (modifier.kind) {
      case 'modifier':
      case 'derived':
        validateLocaleKey(
          modifier.modifier.sourceKey,
          at(`abilities[${index}].modifier.sourceKey`),
          localeKeys,
          push,
        );
        break;
      case 'grant':
        if (!buffIds.has(modifier.buff.id)) {
          push({
            severity: 'error',
            code: 'MISSING_BUFF',
            path: at(`abilities[${index}]`),
            message: `grant references unknown buff "${modifier.buff.id}"`,
          });
        }
        break;
      case 'grantSkill':
        if (!skillIds.has(modifier.skillId)) {
          push({
            severity: 'error',
            code: 'MISSING_SKILL',
            path: at(`abilities[${index}]`),
            message: `grantSkill references unknown skill "${modifier.skillId}"`,
          });
        }
        break;
      case 'deal':
      case 'trigger':
      case 'consume':
      case 'resource':
        break;
    }
  }

  // 触发器挂的 hook 必须在引擎**真的会处理**的那几个里
  checkAbilityHooks(entity.abilities, at('abilities'), push);

  void entityIds;
}

/**
 * 类型谓词：把 `GameEntity` 窄化到 `EquipmentEntity`。
 *
 * 写成谓词而不是 `entity.kind === 'equipment'`，是因为接口之间没有
 * discriminated union 关系（`EquipmentEntity extends GameEntity` 但
 * `GameEntity.kind` 是宽联合），直接按 kind 判断不会收窄。
 */
function isEquipment(entity: GameEntity): entity is import('../types').EquipmentEntity {
  return entity.kind === 'equipment';
}

/** 收集一个 ability 里引用到的所有 `contrib` 命名空间。 */
function collectContribNamespaces(ability: Ability): readonly string[] {
  const found: string[] = [];
  const visit = (expr: unknown): void => {
    if (!expr || typeof expr !== 'object') return;
    const node = expr as Record<string, unknown>;
    if (node.e === 'contrib' && typeof node.namespace === 'string') found.push(node.namespace);
    for (const value of Object.values(node)) {
      if (Array.isArray(value)) for (const item of value) visit(item);
      else if (value && typeof value === 'object') visit(value);
    }
  };

  switch (ability.kind) {
    case 'derived':
      visit(ability.value);
      break;
    case 'modifier':
      visit(ability.modifier.value);
      break;
    case 'grant':
      for (const modifier of ability.buff.modifiers ?? []) visit(modifier.value);
      break;
    case 'trigger':
      for (const then of ability.trigger.then) found.push(...collectContribNamespaces(then));
      break;
    case 'deal':
      for (const effect of ability.hit.effects) visit(effect.damage);
      break;
    case 'grantSkill':
    case 'consume':
    case 'resource':
      break;
  }
  return found;
}

function behaviorSkillRefs(behavior: Behavior): readonly string[] {
  switch (behavior.kind) {
    case 'opener':
      return [behavior.skillId];
    case 'rotation':
      return behavior.steps.map((s) => s.skillId);
    /**
     * 随机轮转里的技能引用同样要校验存在性 —— 否则内容把 id 写错时
     * 表现为"某个技能永远抽不到"（候选集里查不到定义，静默跳过），
     * 那是极难从表现反推的诊断。
     */
    case 'weightedRotation':
      return behavior.steps.map((s) => s.skillId);
    case 'onHpBelow':
      // `then` 现在是能力数组：grant 引用的 buff 需要校验存在性，
      // 所以这里只关心 skillId 引用（grantSkill）
      return behavior.then.flatMap((a) =>
        a.kind === 'grantSkill' ? [a.skillId] : [],
      );
    case 'enrage':
      return [];
  }
}

/** `entropy-clock` → `entropyClock`（与 i18n/types.ts 的 idToSubject 保持一致）。 */
function toSubject(id: string): string {
  const parts = id.split(/[-_\s]+/).filter((p) => p.length > 0);
  return parts
    .map((part, index) => {
      const lower = part.toLowerCase();
      if (index === 0) return lower;
      return lower.charAt(0).toUpperCase() + lower.slice(1);
    })
    .join('');
}

/** 断言无环（独立入口，供内容层直接调用）。 */
export { assertNoCycles };

/** 类型导出：让内容层能复用。 */
export type { StatKey };
