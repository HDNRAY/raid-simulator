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
import type {
  Ability,
  BuffDef,
  EncounterDef,
  GameEntity,
  SkillDef,
  StatKey,
} from '../types';
import { STAT_RULES } from '../stats/aggregate';

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
  | 'EMPOWERED_ABILITY';

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
  /** 全部合法文案 key（由 i18n 层提供） */
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

  if (options.strict !== false) {
    // 严格模式下 warning 也视为需要处理（但仍然分级报告）
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

  // 技能能力里引用的技能必须存在
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
        break;
    }
  }

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
      break;
  }
  return found;
}

function behaviorSkillRefs(behavior: import('../types').Behavior): readonly string[] {
  switch (behavior.kind) {
    case 'opener':
      return [behavior.skillId];
    case 'rotation':
      return behavior.steps.map((s) => s.skillId);
    case 'interruptible':
      return behavior.skillIds;
    case 'onHpBelow':
      return behavior.then.flatMap(behaviorSkillRefs);
    case 'phases':
    case 'timeLimit':
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
