/**
 * 内容注册表。
 *
 * 引擎只认 id（`SkillId` / `BuffId`），内容层负责把它们解析成定义。
 * 这层存在的理由：**新增内容只需往注册表里加数据，引擎一行不改** ——
 * 这就是"横向扩展内容"这个需求的落地位置。
 *
 * 注册表在构建时被冻结，并且**校验通过才允许使用**（加载期失败，
 * 而不是战斗中崩）。
 */

import { assertValidContent, type ContentBundle } from './validate';
import { buffAbilities } from '../expr/deps';
import type { BuffDef, SkillDef } from '../types';

export interface ContentRegistry {
  readonly bundle: ContentBundle;
  readonly skills: ReadonlyMap<string, SkillDef>;
  readonly buffs: ReadonlyMap<string, BuffDef>;
  /** 用技能 id 取定义；不存在则抛（内容校验保证不会发生） */
  skill(id: string): SkillDef;
  buff(id: string): BuffDef | undefined;
  /** 本次校验用到的语言 key 集合（可能为空 = 未做 key 存在性校验） */
  readonly localeKeys: ReadonlySet<string> | undefined;
}

/**
 * 建立一个内容注册表。
 *
 * 默认**强制校验**：非法内容在启动时失败，而不是在战斗中产生
 * "技能没反应"这类难以定位的问题。
 */
export function createRegistry(
  bundle: ContentBundle,
  options: { readonly validate?: boolean; readonly localeKeys?: ReadonlySet<string> } = {},
): ContentRegistry {
  /**
   * 语言包由调用方注入。
   *
   * `core/` **不许 import i18n**（架构规范 C1/I3：引擎只持 key、不碰文案）。
   * 所以这里不自己去读语言包 —— 需要 key 存在性校验时由入口传进来。
   */
  const localeKeys = options.localeKeys ?? bundle.localeKeys;
  const withLocale: ContentBundle = localeKeys ? { ...bundle, localeKeys } : bundle;

  if (options.validate !== false) {
    assertValidContent(withLocale);
  }

  const skills = new Map(withLocale.skills.map((s) => [s.id, s]));
  const buffs = new Map(withLocale.buffs.map((b) => [b.id, b]));

  // 技能内部内联的 buff（例如 dodge 的免伤 buff）也要能按 id 解析到。
  // 内容作者可以直接在技能里写完整的 BuffDef，而不必把它拆出去。
  for (const skill of withLocale.skills) {
    for (const ability of skill.abilities) {
      collectInlineBuffs(ability, buffs);
    }
    for (const hit of skill.hits) {
      for (const effect of hit.effects) {
        if (effect.buff && !buffs.has(effect.buff.id)) buffs.set(effect.buff.id, effect.buff);
      }
    }
  }

  // 实体上内联的 buff（trigger → grant）同理
  for (const entity of withLocale.entities) {
    for (const ability of entity.abilities) {
      collectInlineBuffs(ability, buffs);
    }
  }

  return {
    bundle: withLocale,
    skills,
    buffs,
    localeKeys,
    skill(id) {
      const found = skills.get(id);
      if (!found) {
        // 开发者错误：用英文（i18n 规范 I1）
        throw new Error(`unknown skill id: ${id}`);
      }
      return found;
    },
    buff(id) {
      return buffs.get(id);
    },
  };
}

function collectInlineBuffs(
  ability: import('../types').Ability,
  into: Map<string, BuffDef>,
): void {
  switch (ability.kind) {
    case 'grant':
      if (!into.has(ability.buff.id)) into.set(ability.buff.id, ability.buff);
      for (const nested of buffAbilities(ability.buff)) collectInlineBuffs(nested, into);
      break;
    case 'trigger':
      for (const then of ability.trigger.then) collectInlineBuffs(then, into);
      break;
    case 'modifier':
    case 'derived':
    case 'deal':
    case 'grantSkill':
    case 'consume':
    case 'resource':
      break;
  }
}
