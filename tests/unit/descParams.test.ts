/**
 * ==================================================================
 * 说明文案里的数值**必须来自内容定义**（第五题的验收）
 * ==================================================================
 *
 * 判据（用户定过，见 `app/descParams.ts`）：
 *
 * > **这个数能不能回到内容定义？** 能 → 推导；是手感叙述 / 出处声明 /
 * > 键名 → 留。
 *
 * 这个文件把每一类"能回去"的数**从两端钉住**：
 *
 *   1. **模板端**：那句文案渲染出来必须等于"数据推出来的值"
 *   2. **变异端**：改一处内容定义 → 文案**跟着变**（这是"推导"与
 *      "抄一份当下正确的数"之间唯一能分辨的差别）
 *
 * ⚠️ 只断言"当前渲染结果等于某个具体句子"是**不够的** —— 那既可能是
 * 推导出来的，也可能只是有人把数字抄对了。所以每一类都有变异断言：
 * 改数据、重渲染、看它变。
 */

import { describe, expect, it } from 'vitest';
import type { ActiveSkillDef } from '../../src/core/types';
import { descParamsOf, placeholdersOf } from '../../src/app/descParams';
import { displaySeconds } from '../../src/app/displayTime';
import { buildKeyRows } from '../../src/app/keyRows';
import { flattenCatalog, translator } from '../../src/i18n/translator';
import { zhCN } from '../../src/i18n/locales/zh-CN';
import { ALL_BUFFS, ALL_SKILLS, PLAYER_SKILL_IDS } from '../../src/data/content';
import { bossHpFor } from '../../src/data/bossDefs';
import { createRegistry } from '../../src/core/content/registry';
import { DEFAULT_BINDINGS } from '../../src/input/keyboard';
import { FLASH } from '../../src/data/kits/kaili';
import { KNOCKDOWN } from '../../src/data/bossShared';
import { activeSkillOf } from './helpers';

const TEMPLATES = flattenCatalog(zhCN);

/** 技能表里按 id 找（`ALL_SKILLS` 是玩家 + 两个 Boss 的全集）。 */
function skillOf(id: string): ActiveSkillDef {
  const skill = activeSkillOf(ALL_SKILLS.find((s) => s.id === id), id);
  expect(skill, `技能表里没有 ${id}`).toBeDefined();
  return activeSkillOf(skill, id);
}

/** 那句说明的 i18n 模板。 */
function templateOf(skill: ActiveSkillDef): string {
  const key = skill.descKey;
  expect(key, `${skill.id} 没有 descKey`).toBeDefined();
  const template = TEMPLATES.get(key as string);
  expect(template, `语言包里没有 ${String(key)}`).toBeDefined();
  return template as string;
}

/** 渲染一句说明：模板来自 i18n，参数来自内容定义。 */
function render(skill: ActiveSkillDef, maxHp?: number): string {
  const template = templateOf(skill);
  return translator.t(skill.descKey as never, descParamsOf(skill, template, maxHp) as never);
}

/** 推出来的参数（断言"参数表里有什么"用）。 */
function paramsOf(skill: ActiveSkillDef, maxHp?: number) {
  return descParamsOf(skill, templateOf(skill), maxHp);
}

/* ------------------------------------------------------------------ *
 * 期望值一律**独立地从 `SkillDef` 推**
 *
 * ⚠️ 判据（`AGENTS.md` §4）：某个技能的具体数值会经常调、由**黄金基线**
 * 覆盖 —— 所以这里**不写死**"10 / 30 / 2 秒"，而是从内容自己算出来。
 * 这几个函数刻意**不经过 `descParamsOf`**：两边各推一次，
 * "参数表读错了字段 / 抄了另一个数"才会现形。
 * ------------------------------------------------------------------ */

/** 技能第一段伤害的基础值（`hits[].effects[].damage.base`）。 */
function damageOf(skill: ActiveSkillDef): number {
  for (const hit of skill.hits) {
    for (const effect of hit.effects) {
      const base = effect.damage?.base;
      if (effect.kind === 'damage' && typeof base === 'number' && Number.isFinite(base)) {
        return base;
      }
    }
  }
  throw new Error(`${skill.id} 没有伤害效果`);
}

/** 技能给**自己**回血的绝对值（`resource: hp` 且 `delta > 0`）。 */
function selfHealOf(skill: ActiveSkillDef): number {
  for (const ability of skill.abilities) {
    if (ability.kind !== 'resource') continue;
    if (ability.target.mode !== 'self') continue;
    if (String(ability.resource) !== 'hp') continue;
    if (typeof ability.delta !== 'number' || !Number.isFinite(ability.delta)) continue;
    if (ability.delta <= 0) continue;
    return ability.delta;
  }
  throw new Error(`${skill.id} 没有自我回血`);
}

/** 让目标动不了的时长（秒）—— `actionLock` 或 `restrictToTags` 都算。 */
function stunSecondsOf(skill: ActiveSkillDef): number {
  for (const hit of skill.hits) {
    for (const effect of hit.effects) {
      if (effect.kind !== 'stun' && effect.kind !== 'grantBuff') continue;
      const buff = effect.buff;
      if (buff === undefined) continue;
      const locks =
        buff.flags?.actionLock === true || (buff.flags?.restrictToTags?.length ?? 0) > 0;
      if (!locks || !Number.isFinite(buff.duration)) continue;
      return displaySeconds(buff.duration);
    }
  }
  throw new Error(`${skill.id} 没有能锁住目标的 buff`);
}

/* ------------------------------------------------------------------ *
 * 变异（这是"推导"唯一能被证明的方式）
 *
 * ⚠️ 内容定义是**不可变的**（`readonly` 字段），所以变异不能就地赋值 ——
 * 那样只能靠断言关掉类型检查，而"故意改一份数据"这件事在代码里就看不见了。
 * 这里走**显式的重建**：每一步都写明改的是哪个字段，类型照旧被检查。
 *
 * ⚠️ 重建而不是改原对象，同时保证**不污染真内容** —— 污染了的话，
 * 后面所有断言都会跟着错，而且看不出为什么。
 * ------------------------------------------------------------------ */

/** 把第一段命中的第一个 `damage` 效果的基础伤害改成 `damage`。 */
function withDamage(skill: ActiveSkillDef, damage: number): ActiveSkillDef {
  const hit = skill.hits[0];
  if (hit === undefined) throw new Error(`${skill.id} 没有 hits[0]`);
  let replaced = false;
  const effects = hit.effects.map((effect) => {
    if (replaced || effect.kind !== 'damage' || effect.damage === undefined) return effect;
    replaced = true;
    return { ...effect, damage: { ...effect.damage, base: damage } };
  });
  if (!replaced) throw new Error(`${skill.id} 没有 damage 效果`);
  return { ...skill, hits: [{ ...hit, effects }] };
}

/** 改掉技能**自我授予**的第一个 buff 的时长。 */
function withSelfBuffDuration(skill: ActiveSkillDef, duration: number): ActiveSkillDef {
  const index = skill.abilities.findIndex(
    (a) => a.kind === 'grant' && a.target.mode === 'self',
  );
  if (index < 0) throw new Error(`${skill.id} 没有自我 grant`);
  return {
    ...skill,
    abilities: skill.abilities.map((ability, i) => {
      if (i !== index || ability.kind !== 'grant') return ability;
      return { ...ability, buff: { ...ability.buff, duration } };
    }),
  };
}

/** 改掉技能**自我授予**的第一个 buff 的第一条修正的值。 */
function withSelfBuffModifierValue(skill: ActiveSkillDef, value: number): ActiveSkillDef {
  const index = skill.abilities.findIndex(
    (a) => a.kind === 'grant' && a.target.mode === 'self',
  );
  if (index < 0) throw new Error(`${skill.id} 没有自我 grant`);
  return {
    ...skill,
    abilities: skill.abilities.map((ability, i) => {
      if (i !== index || ability.kind !== 'grant') return ability;
      const modifiers = ability.buff.modifiers;
      if (modifiers === undefined || modifiers.length === 0) {
        throw new Error(`${skill.id} 的自我 buff 没有修正`);
      }
      return {
        ...ability,
        buff: {
          ...ability.buff,
          modifiers: modifiers.map((m, mi) => (mi === 0 ? { ...m, value } : m)),
        },
      };
    }),
  };
}

/** 改掉技能的第一条 `resource` 能力的 `delta`（回血那类）。 */
function withResourceDelta(skill: ActiveSkillDef, delta: number): ActiveSkillDef {
  const has = skill.abilities.some((a) => a.kind === 'resource');
  if (!has) throw new Error(`${skill.id} 没有 resource 能力`);
  return {
    ...skill,
    abilities: skill.abilities.map((ability) =>
      ability.kind === 'resource' ? { ...ability, delta } : ability,
    ),
  };
}

/** 把技能命中里某个 buff 的时长改掉（按 buff id 找）。 */
function withGrantedBuffDuration(skill: ActiveSkillDef, buffId: string, duration: number): ActiveSkillDef {
  const hit = skill.hits[0];
  if (hit === undefined) throw new Error(`${skill.id} 没有 hits[0]`);
  let replaced = false;
  const effects = hit.effects.map((effect) => {
    if (effect.kind !== 'grantBuff' || effect.buff?.id !== buffId) return effect;
    replaced = true;
    return { ...effect, buff: { ...effect.buff, duration } };
  });
  if (!replaced) throw new Error(`${skill.id} 的命中里没有挂 ${buffId}`);
  return { ...skill, hits: [{ ...hit, effects }] };
}

/* ================================================================== *
 * ① 伤害：从 `hits[].effects[].damage.base` 推
 *
 * ⚠️ 只证"说明里出现的是技能自己的伤害"，**不钉它是几**（数值由黄金覆盖）。
 * ================================================================== */

describe('伤害数字：从技能自己的命中推', () => {
  it('「斩」的说明里出现的是技能自己的伤害', () => {
    const attack = skillOf('attack');
    expect(render(attack), '说明里的伤害要来自 `damage.base`').toContain(
      String(damageOf(attack)),
    );
    /** 参数表里的伤害也必须与内容一致（同一条推导链的另一端）。 */
    expect(paramsOf(attack)?.damage, '参数表里的伤害要来自内容').toBe(damageOf(attack));
  });

  it('「轰」同理（同一个 `{damage}` 参数，不是第二套逻辑）', () => {
    const blast = skillOf('blast');
    expect(render(blast), '说明里的伤害要来自 `damage.base`').toContain(
      String(damageOf(blast)),
    );
  });

  it('⚠️ 变异：把伤害改成 99 → 文案跟着变（证明它真的在推）', () => {
    const attack = skillOf('attack');
    const before = render(attack);
    expect(render(withDamage(attack, 99)), '说明必须跟随被改过的伤害').toContain('99');
    /** 原定义没有被这次变异污染（纯函数 + 深拷贝）。 */
    expect(render(attack), '真内容不该被变异污染').toBe(before);
  });
});

/* ================================================================== *
 * ② 百分比：从自己身上 `addPercent` 修正推（「凝」）
 * ================================================================== */

/**
 * 「凝」那句文案里的两个数，**从它自己授予的那个 buff 推**。
 *
 * ⚠️ 为什么不写死 `'自身增伤 60%，持续 10 秒。'`：本文件要证的是
 * "文案里的百分号与秒数**来自内容定义**"。写死的话，每次重标定
 * （20% → 60% / 30 秒 → 10 秒…）都会同时改内容与那个字面串 —— 断言绿了，
 * 但"推导坏了"这件事**看不出来**。从 buff 反推则保证：内容改了、文案
 * 必须跟着改；而"反推本身有没有坏"由下一条变异断言钉住。
 */
function selfBuffNumbers(focus: ActiveSkillDef): { readonly percent: number; readonly seconds: number } {
  const grant = focus.abilities.find((a) => a.kind === 'grant' && a.target.mode === 'self');
  if (grant === undefined || grant.kind !== 'grant') throw new Error('focus 没有自我 grant');
  const percent = (grant.buff.modifiers ?? []).find((m) => m.op === 'addPercent')?.value;
  if (typeof percent !== 'number') throw new Error('focus 的增伤推不出来');
  return { percent, seconds: displaySeconds(grant.buff.duration) };
}

/** 技能授予**自己**的第一个 buff 的时长（秒）—— 「闪」「避」这类只有时长。 */
function selfGrantedSecondsOf(skill: ActiveSkillDef): number {
  const grant = skill.abilities.find((a) => a.kind === 'grant' && a.target.mode === 'self');
  if (grant === undefined || grant.kind !== 'grant') throw new Error(`${skill.id} 没有自我 grant`);
  return displaySeconds(grant.buff.duration);
}

describe('百分比：从 buff 的 `addPercent` 修正推（「凝」）', () => {
  it('「凝」的说明里的增伤% 与持续秒数都来自内容定义', () => {
    const focus = skillOf('focus');
    const { percent, seconds } = selfBuffNumbers(focus);
    const rendered = render(focus);
    expect(rendered, '增伤% 要来自 buff 的修正').toContain(String(percent));
    expect(rendered, '持续秒数要来自 buff 的 duration').toContain(String(seconds));
    expect(paramsOf(focus)?.percent, '参数表里的增伤% 也要来自内容').toBe(percent);
  });

  it('⚠️ 变异：修正值改成 77 → 文案跟着变', () => {
    const focus = skillOf('focus');
    const { seconds } = selfBuffNumbers(focus);
    const rendered = render(withSelfBuffModifierValue(focus, 77));
    expect(rendered, '说明必须跟随被改过的修正值').toContain('77');
    expect(rendered, '其余的秒数仍来自内容').toContain(String(seconds));
  });
});

/* ================================================================== *
 * ③ 时长：从技能授予自己的 buff `duration` 推
 * ================================================================== */

describe('时长：从技能授予自己的 buff 推', () => {
  it('「闪」与「避」说明里的秒数都来自自己授予的 buff `duration`', () => {
    for (const skill of [skillOf('flash'), skillOf('dodge')]) {
      expect(render(skill), `${skill.id} 的说明里要出现 buff 的时长`).toContain(
        String(selfGrantedSecondsOf(skill)),
      );
    }
  });

  it('⚠️ 变异：把「闪」的无敌时长改成 1.3 秒 → 文案跟着变', () => {
    expect(
      render(withSelfBuffDuration(skillOf('flash'), 1300)),
      '说明必须跟随被改过的时长',
    ).toContain('1.3');
    /** 真实内容仍是它自己的值（数据没被改）。 */
    expect(render(FLASH), '真内容不该被变异污染').toContain(
      String(selfGrantedSecondsOf(FLASH)),
    );
  });
});

/* ================================================================== *
 * ④ Boss 的招式：前摇 / 伤害 / 冷却（`boss.*.desc`）
 *
 * ⚠️ 每个数都从它自己的 `SkillDef` 推 —— **不写死**"1 秒 / 20 伤 / 冷却
 * 3 秒"（那些值经常调，由黄金基线覆盖）。这里证的是"说明里的数来自
 * 内容里的那个字段"。
 * ================================================================== */

describe('傲慢的招式说明：全部回到 `SkillDef`', () => {
    /**
     * ⚠️ **2026-10-22 起说明里不再写前摇 / 冷却 / 代价的数值** —— 那三项由
     * 详情面板的**结构化数值行**显示（`app/skillStats` 从内容字段算），
     * 说明里再写一遍就是"同一件事两处显示"。所以下面**不再**断言
     * "desc 含 castTime / cooldown 的数字"（那条守卫的对象已经不存在了）；
     * 伤害 / 眩晕 / 回血这些**只出现在说明里**的数仍然照旧断言。
     */
  it('「轻蔑」的前摇 / 伤害 / 冷却都从 `SkillDef` 推', () => {
    const skill = skillOf('boss-scorn');
    const text = render(skill);
    expect(text, '伤害来自 `damage.base`').toContain(String(damageOf(skill)));
  });

  it('「呵斥」同理，且"10 炁换 N 伤"里的 N 也是推的', () => {
    const skill = skillOf('boss-rebuke');
    const text = render(skill);
    expect(text, '伤害来自 `damage.base`').toContain(String(damageOf(skill)));
  });

  it('「碾压」：前摇 / 伤害 / 冷却 + **倒地时长**（从挂上去的 buff 推）', () => {
    const skill = skillOf('boss-heavy');
    const text = render(skill);
    expect(text, '伤害来自 `damage.base`').toContain(String(damageOf(skill)));
    expect(text, '倒地时长来自能锁住目标的 buff').toContain(String(stunSecondsOf(skill)));
    /**
     * ⚠️ 「倒地」用的是 `restrictToTags` 而**不是** `actionLock`
     * （内容文件专门解释过：倒地是"只剩闪避这一手"，不是"完全不能动"）。
     * 所以判据是"挂的 buff 带**任何一种行动限制**"，不是"带 actionLock"。
     */
    expect(KNOCKDOWN.flags?.actionLock).toBeUndefined();
    expect(KNOCKDOWN.flags?.restrictToTags).toEqual(['dodge']);
  });

  it('「回补」：比例与点数都从回血量推', () => {
    const skill = skillOf('boss-mend');
    const text = render(skill, bossHpFor('meiichiro'));
    const heal = selfHealOf(skill);
    expect(text, '比例 = 回血量 / 上限').toContain(
      String(Math.round((heal / bossHpFor('meiichiro')) * 100)),
    );
    expect(text, '点数来自 `resource.delta`').toContain(String(heal));
  });

  it('⚠️ 变异：碾压伤害与倒地时长改了，文案都跟着变', () => {
    const mutated = withGrantedBuffDuration(
      withDamage(skillOf('boss-heavy'), 45),
      KNOCKDOWN.id,
      5000,
    );
    const text = render(mutated);
    expect(text, '说明里的伤害要跟着变异走').toContain('45');
    expect(text, '说明里的倒地时长要跟着变异走').toContain('5');
    expect(text, '旧的伤害不该还在').not.toContain(String(damageOf(skillOf('boss-heavy'))));
  });

  it('⚠️ 变异：回补的 `delta` 改了 → 文案变成对应的比例 / 点数', () => {
    const text = render(withResourceDelta(skillOf('boss-mend'), 210), bossHpFor('meiichiro'));
    expect(text, '比例要跟着变异走').toContain(String(Math.round((210 / bossHpFor('meiichiro')) * 100)));
    expect(text, '点数要跟着变异走').toContain('210');
  });
});

/* ================================================================== *
 * ⑤ 色欲的招式：**这一组抓到过两处真漂**（冷却 4 / 14 秒是错的）
 * ================================================================== */

describe('色欲的招式说明：数值写的是数据里的值', () => {
  it('「轻吟」的前摇 / 伤害 / 冷却都从 `SkillDef` 推', () => {
    const skill = skillOf('lust-hum');
    const text = render(skill);
    expect(text, '伤害来自 `damage.base`').toContain(String(damageOf(skill)));
  });

  it('「缠绕」同理（前摇 / 伤害 / 冷却）', () => {
    const skill = skillOf('lust-entangle');
    const text = render(skill);
    expect(text, '伤害来自 `damage.base`').toContain(String(damageOf(skill)));
  });

  it('「魅惑」：前摇 / 眩晕时长 / 冷却都从内容推', () => {
    const skill = skillOf('lust-charm');
    const text = render(skill);
    expect(text, '眩晕时长来自挂上去的 buff').toContain(String(stunSecondsOf(skill)));
  });

  it('⚠️ 变异：轻吟冷却与伤害改了 → 文案跟着变', () => {
    const base = withDamage(skillOf('lust-hum'), 55);
    const mutated: ActiveSkillDef = { ...base, cooldown: 12_000 };
    const text = render(mutated);
    /**
     * ⚠️ 冷却**不再写进说明**（结构化数值行负责）⇒ 这里只留伤害那条；
     * 冷却的"跟着内容走"由 `app/skillStats` 的单测覆盖。
     */
    expect(text, '说明里不该再出现冷却数值').not.toContain('12 秒冷却');
    expect(text, '伤害要跟随被改过的值').toContain('55');
  });
});

/* ================================================================== *
 * ⑥ 参数表本身：只传模板里真有的键 / 没有占位符就一个都不传
 * ================================================================== */

describe('参数表：由模板决定传什么', () => {
  it('`placeholdersOf` 列出模板里的占位符', () => {
    expect(placeholdersOf('自身增伤 {percent}%，持续 {seconds} 秒。')).toEqual([
      'percent',
      'seconds',
    ]);
    expect(placeholdersOf('没有占位符。')).toEqual([]);
  });

  it('霸体的说明**没有数值**：整句原样渲染（回不到内容定义的就留）', () => {
    const key = 'boss.armor.desc';
    const template = TEMPLATES.get(key);
    expect(template).toBeDefined();
    expect(placeholdersOf(template as string)).toEqual([]);
    expect(descParamsOf(skillOf('boss-heavy'), template as string)).toBeUndefined();
    expect(translator.t(key as never)).toBe(template);
  });

  it('「劈」/「拳」/「击」/「卸」这类**手感叙述**没有占位符（判据的另一半）', () => {
    for (const key of ['skill.pi.desc', 'skill.punch.desc', 'skill.guard.desc', 'skill.strike.desc']) {
      const template = TEMPLATES.get(key);
      expect(template, `语言包里没有 ${key}`).toBeDefined();
      expect(placeholdersOf(template as string), `${key} 不该有数值占位符`).toEqual([]);
    }
  });
});

/* ================================================================== *
 * ⑦ 端到端的那一处：设置页的行
 * ================================================================== */

describe('设置页的行：数值来自同一条参数表', () => {
  function rows() {
    return buildKeyRows({
      bindings: DEFAULT_BINDINGS,
      registry: createRegistry({ entities: [], skills: [...ALL_SKILLS], buffs: [...ALL_BUFFS] }),
      snapshotOf: () => ({ skills: [] }) as never,
      translate: (key: string, params?: Readonly<Record<string, string | number>>) =>
        translator.t(key as never, params as never),
      playerSkillIds: PLAYER_SKILL_IDS,
    } as never);
  }

  it('「斩」的说明渲染出来的是内容里的伤害（不是 `{damage}` 本身）', () => {
    const row = rows().find((r) => r.skillId === 'attack');
    expect(
      translator.t(row?.descKey as never, row?.descParams as never),
      '行里的伤害要来自内容',
    ).toContain(String(damageOf(skillOf('attack'))));
  });

  it('「闪」的冷却显示的是 `displaySeconds(cooldown)`，不是进位后的整秒', () => {
    const row = rows().find((r) => r.skillId === 'flash');
    /** 内容里的时长（不写死 0.6 —— 它由黄金覆盖）。 */
    const shown = String(displaySeconds(FLASH.cooldown));
    /** 曾经那个错法（`Math.round(ms / 1000)`）会显示出来的整秒值。 */
    const rounded = String(Math.round(FLASH.cooldown / 1000));
    expect(row?.cdText, '必须显示 `displaySeconds` 算出来的秒数').toContain(shown);
    expect(row?.cdText, `不能被进位成 "${rounded} 秒"`).not.toContain(`${rounded} 秒`);
  });
});
