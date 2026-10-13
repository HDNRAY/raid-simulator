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
import type { SkillDef } from '../../src/core/types';
import { descParamsOf, placeholdersOf } from '../../src/app/descParams';
import { displaySeconds } from '../../src/app/displayTime';
import { buildKeyRows } from '../../src/app/keyRows';
import { flattenCatalog, translator } from '../../src/i18n/translator';
import { zhCN } from '../../src/i18n/locales/zh-CN';
import { ALL_BUFFS, ALL_SKILLS, PLAYER_SKILL_IDS } from '../../src/data/content';
import { BOSS_CAPS } from '../../src/data/units';
import { createRegistry } from '../../src/core/content/registry';
import { DEFAULT_BINDINGS } from '../../src/input/keyboard';
import { FLASH } from '../../src/data/kits/kaili';
import { KNOCKDOWN } from '../../src/data/bossShared';

const TEMPLATES = flattenCatalog(zhCN);

/** 技能表里按 id 找（`ALL_SKILLS` 是玩家 + 两个 Boss 的全集）。 */
function skillOf(id: string): SkillDef {
  const skill = ALL_SKILLS.find((s) => s.id === id);
  expect(skill, `技能表里没有 ${id}`).toBeDefined();
  return skill as SkillDef;
}

/** 那句说明的 i18n 模板。 */
function templateOf(skill: SkillDef): string {
  const key = skill.descKey;
  expect(key, `${skill.id} 没有 descKey`).toBeDefined();
  const template = TEMPLATES.get(key as string);
  expect(template, `语言包里没有 ${String(key)}`).toBeDefined();
  return template as string;
}

/** 渲染一句说明：模板来自 i18n，参数来自内容定义。 */
function render(skill: SkillDef, maxHp?: number): string {
  const template = templateOf(skill);
  return translator.t(skill.descKey as never, descParamsOf(skill, template, maxHp) as never);
}

/** 推出来的参数（断言"参数表里有什么"用）。 */
function paramsOf(skill: SkillDef, maxHp?: number) {
  return descParamsOf(skill, templateOf(skill), maxHp);
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
function withDamage(skill: SkillDef, damage: number): SkillDef {
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
function withSelfBuffDuration(skill: SkillDef, duration: number): SkillDef {
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
function withSelfBuffModifierValue(skill: SkillDef, value: number): SkillDef {
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
function withResourceDelta(skill: SkillDef, delta: number): SkillDef {
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
function withGrantedBuffDuration(skill: SkillDef, buffId: string, duration: number): SkillDef {
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
 * ① 伤害：从 `hits[].effects[].damage.base` 推（「斩」10 / 「轰」30）
 * ================================================================== */

describe('伤害数字：从技能自己的命中推（「斩」10 / 「轰」30）', () => {
  it('「斩」的说明 = 数据里的伤害', () => {
    const attack = skillOf('attack');
    expect(render(attack)).toBe('普通攻击，造成 10 点伤害。');
    expect(paramsOf(attack)?.damage).toBe(10);
  });

  it('「轰」同理（同一个 `{damage}` 参数，不是第二套逻辑）', () => {
    expect(render(skillOf('blast'))).toBe('造成 30 点伤害，并使目标易伤。');
  });

  it('⚠️ 变异：把伤害改成 99 → 文案跟着变（证明它真的在推）', () => {
    const attack = skillOf('attack');
    expect(render(withDamage(attack, 99))).toBe('普通攻击，造成 99 点伤害。');
    /** 原定义没有被这次变异污染（纯函数 + 深拷贝）。 */
    expect(render(attack)).toBe('普通攻击，造成 10 点伤害。');
  });
});

/* ================================================================== *
 * ② 百分比：从自己身上 `addPercent` 修正推（「凝」）
 * ================================================================== */

/**
 * 「凝」那句文案里的两个数，**从它自己授予的那个 buff 推**。
 *
 * ⚠️ 为什么不写死 `'自身增伤 60%，持续 10 秒。'`：本文件要证的是
 * "文案里的百分号与秒数**来自内容定义**"。写死的话，2026-10-13 的重标定
 * （20% → 60% / 30 秒 → 10 秒）会同时改内容与那个字面串 —— 断言绿了，
 * 但"推导坏了"这件事**看不出来**。从 buff 反推则保证：内容改了、文案
 * 必须跟着改；而"反推本身有没有坏"由下一条变异断言（77）钉住。
 */
function selfBuffNumbers(focus: SkillDef): { readonly percent: number; readonly seconds: number } {
  const grant = focus.abilities.find((a) => a.kind === 'grant' && a.target.mode === 'self');
  if (grant === undefined || grant.kind !== 'grant') throw new Error('focus 没有自我 grant');
  const percent = (grant.buff.modifiers ?? []).find((m) => m.op === 'addPercent')?.value;
  if (typeof percent !== 'number') throw new Error('focus 的增伤推不出来');
  return { percent, seconds: displaySeconds(grant.buff.duration) };
}

describe('百分比：从 buff 的 `addPercent` 修正推（「凝」）', () => {
  it('「凝」的增伤% 与持续秒数都来自内容定义', () => {
    const focus = skillOf('focus');
    const { percent, seconds } = selfBuffNumbers(focus);
    expect(render(focus)).toBe(`自身增伤 ${String(percent)}%，持续 ${String(seconds)} 秒。`);
    /** 数值本身也钉一下（推导路径另有变异断言兜着）。 */
    expect(percent).toBe(60);
    expect(seconds).toBe(10);
    expect(paramsOf(focus)?.percent).toBe(60);
  });

  it('⚠️ 变异：修正值改成 77 → 文案跟着变', () => {
    const focus = skillOf('focus');
    const { seconds } = selfBuffNumbers(focus);
    expect(render(withSelfBuffModifierValue(focus, 77))).toBe(
      `自身增伤 77%，持续 ${String(seconds)} 秒。`,
    );
  });
});

/* ================================================================== *
 * ③ 时长：从技能授予自己的 buff `duration` 推（「避」0.5 / 「闪」0.2）
 * ================================================================== */

describe('时长：从技能授予自己的 buff 推', () => {
  it('「闪」的 0.2 秒与「避」的 0.5 秒都来自 `duration`', () => {
    expect(render(skillOf('flash'))).toBe('获得 0.2 秒无敌，不花炁，但窗口极窄。');
    expect(render(skillOf('dodge'))).toBe('获得 0.5 秒完全无敌，随时可按。');
  });

  it('⚠️ 变异：把「闪」的无敌时长改成 1.3 秒 → 文案跟着变', () => {
    expect(render(withSelfBuffDuration(skillOf('flash'), 1300))).toBe(
      '获得 1.3 秒无敌，不花炁，但窗口极窄。',
    );
    /** 真实内容仍是 0.2（数据没被改）。 */
    expect(render(FLASH)).toBe('获得 0.2 秒无敌，不花炁，但窗口极窄。');
  });
});

/* ================================================================== *
 * ④ Boss 的招式：前摇 / 伤害 / 冷却（`boss.*.desc`）
 * ================================================================== */

describe('傲慢的招式说明：全部回到 `SkillDef`', () => {
  it('「轻蔑」= 1 秒 / 20 伤 / 冷却 3 秒（三样都推）', () => {
    const text = render(skillOf('boss-scorn'));
    expect(text).toContain('1 秒前摇');
    expect(text).toContain('造成 20 点伤害');
    expect(text).toContain('冷却 3 秒');
  });

  it('「呵斥」同理，且"10 炁换 N 伤"里的 N 也是推的', () => {
    const text = render(skillOf('boss-rebuke'));
    expect(text).toContain('1.5 秒前摇');
    expect(text).toContain('造成 40 点伤害');
    expect(text).toContain('10 炁换 40 伤');
  });

  it('「碾压」：前摇 / 伤害 / 冷却 + **倒地时长**（从 `KNOCKDOWN.duration` 推）', () => {
    const text = render(skillOf('boss-heavy'));
    expect(text).toContain('2 秒前摇');
    expect(text).toContain('造成 60 点伤害');
    expect(text).toContain('冷却 3 秒');
    expect(text).toContain('并使你倒地 2 秒');
    /**
     * ⚠️ 「倒地」用的是 `restrictToTags` 而**不是** `actionLock`
     * （内容文件专门解释过：倒地是"只剩闪避这一手"，不是"完全不能动"）。
     * 所以判据是"挂的 buff 带**任何一种行动限制**"，不是"带 actionLock"。
     */
    expect(KNOCKDOWN.flags?.actionLock).toBeUndefined();
    expect(KNOCKDOWN.flags?.restrictToTags).toEqual(['dodge']);
  });

  it('「回补」：比例（30%）与点数（126）都推 —— 旧文案写的 63 已不存在', () => {
    const text = render(skillOf('boss-mend'), BOSS_CAPS.hp);
    expect(text).toContain('2.5 秒前摇');
    expect(text).toContain('恢复 30% 生命（126 点）');
    /** 63 是"血量 210"时代的旧值，早该跟着 126 走。 */
    expect(text).not.toContain('63');
  });

  it('⚠️ 变异：碾压伤害 60 → 45、倒地 2 → 5 秒，文案两处都跟着变', () => {
    const mutated = withGrantedBuffDuration(
      withDamage(skillOf('boss-heavy'), 45),
      KNOCKDOWN.id,
      5000,
    );
    const text = render(mutated);
    expect(text).toContain('造成 45 点伤害');
    expect(text).toContain('并使你倒地 5 秒');
    expect(text).not.toContain('造成 60 点伤害');
  });

  it('⚠️ 变异：回补的 `delta` 210（上限 420）→ 文案变成 50% / 210 点', () => {
    const text = render(withResourceDelta(skillOf('boss-mend'), 210), BOSS_CAPS.hp);
    expect(text).toContain('恢复 50% 生命（210 点）');
  });
});

/* ================================================================== *
 * ⑤ 色欲的招式：**这一组抓到过两处真漂**（冷却 4 / 14 秒是错的）
 * ================================================================== */

describe('色欲的招式说明：冷却写的是数据里的值（2 / 9 / 6 秒）', () => {
  it('「轻吟」冷却 = `logicMs(20)` = 2 秒（**不是**旧文案的 4 秒）', () => {
    const text = render(skillOf('lust-hum'));
    expect(text).toContain('0.9 秒前摇');
    expect(text).toContain('造成 12 点伤害');
    expect(text).toContain('冷却 2 秒');
    expect(text).not.toContain('冷却 4 秒');
  });

  it('「缠绕」= 2 秒前摇 / 30 伤 / 冷却 9 秒', () => {
    const text = render(skillOf('lust-entangle'));
    expect(text).toContain('2 秒前摇');
    expect(text).toContain('造成 30 点伤害');
    expect(text).toContain('冷却 9 秒');
  });

  it('「魅惑」= 1.4 秒前摇 / 眩晕 3 秒 / 冷却 6 秒（**不是**旧文案的 14 秒）', () => {
    const text = render(skillOf('lust-charm'));
    expect(text).toContain('1.4 秒前摇');
    expect(text).toContain('眩晕 3 秒');
    expect(text).toContain('冷却 6 秒');
    expect(text).not.toContain('冷却 14 秒');
  });

  it('⚠️ 变异：轻吟冷却改成 12 秒、伤害改成 55 → 文案跟着变', () => {
    const base = withDamage(skillOf('lust-hum'), 55);
    const mutated: SkillDef = { ...base, cooldown: 12_000 };
    const text = render(mutated);
    expect(text).toContain('冷却 12 秒');
    expect(text).toContain('造成 55 点伤害');
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

  it('「斩」的说明渲染的是 10 点伤害（不是 `{damage}` 本身）', () => {
    const row = rows().find((r) => r.skillId === 'attack');
    expect(translator.t(row?.descKey as never, row?.descParams as never)).toBe(
      '普通攻击，造成 10 点伤害。',
    );
  });

  it('「闪」的**冷却 0.6 秒**不再被进位成 1 秒', () => {
    const row = rows().find((r) => r.skillId === 'flash');
    expect(FLASH.cooldown).toBe(600);
    expect(row?.cdText).toBe(`冷却 ${displaySeconds(FLASH.cooldown)} 秒`);
    expect(row?.cdText).toBe('冷却 0.6 秒');
  });
});
