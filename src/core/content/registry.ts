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
import { flattenCatalog } from '../../i18n/translator';
import { zhCN } from '../../i18n/locales/zh-CN';
import type { BuffDef, SkillDef } from '../types';

export interface ContentRegistry {
  readonly bundle: ContentBundle;
  readonly skills: ReadonlyMap<string, SkillDef>;
  readonly buffs: ReadonlyMap<string, BuffDef>;
  /** 用技能 id 取定义；不存在则抛（内容校验保证不会发生） */
  skill(id: string): SkillDef;
  buff(id: string): BuffDef | undefined;
  /** 某个技能的全部本地化 key（供译表裁剪等用途） */
  readonly localeKeys: ReadonlySet<string>;
}

/**
 * 建立一个内容注册表。
 *
 * 默认**强制校验**：非法内容在启动时失败，而不是在战斗中产生
 * "技能没反应"这类难以定位的问题。
 */
export function createRegistry(
  bundle: ContentBundle,
  options: { readonly validate?: boolean } = {},
): ContentRegistry {
  const localeKeys = bundle.localeKeys ?? new Set(flattenCatalog(zhCN).keys());

  const withLocale: ContentBundle = { ...bundle, localeKeys };

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
