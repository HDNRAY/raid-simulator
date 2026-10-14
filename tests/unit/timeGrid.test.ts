import { describe, expect, it } from 'vitest';
import { offGridTimeIssues, type TimeGridInput } from '../../src/core/content/timeGrid';
import {
  assertValidContent,
  validateContent,
  type ContentBundle,
} from '../../src/core/content/validate';
import { LOGIC_TICK_MS } from '../../src/core/loopConstants';
import type { ActiveSkillDef, BuffDef, EncounterDef, GameEntity } from '../../src/core/types';
import { PRIDE_BEHAVIORS } from '../../src/data/bossPride';
import { ALL_BUFFS, ALL_SKILLS } from '../../src/data/content';
import { ENTROPY_CLOCK } from '../../src/data/entities/entropyClock';
import { LUST_BEHAVIORS } from '../../src/data/lustBoss';
import { flattenCatalog } from '../../src/i18n/translator';
import { zhCN } from '../../src/i18n/locales/zh-CN';
import { activeSkillOf } from './helpers';

/**
 * **`OFF_GRID_TIME`：内容里的时间值必须落在 0.1 秒刻度上。**
 *
 * 规则本身（拦哪些字段、为什么排除速率类、`gapMs` 怎么判）写在
 * `src/core/content/timeGrid.ts` 的文件头。这个文件是它的回归保护，
 * 钉三件事：
 *
 *   1. **现有内容全过** —— "规则成立 + 内容干净"的可执行证据。
 *      这比"我跑了一遍看着是绿的"硬：以后谁把 `logicMs(2.5)` 写回去，
 *      这里会红，而且会指出是哪个字段。
 *   2. **反向验证真的红** —— 把 250 塞回「拳」的 `castTime`，校验必须报
 *      `OFF_GRID_TIME`（这正是那个静默 bug 的形状）。
 *   3. **速率类不被误伤** —— `holdDrain.perLogicTick = 1.5` 是"每逻辑步
 *      多少资源"，不是时长，必须照旧通过。
 */

const localeKeys = new Set(flattenCatalog(zhCN).keys());

/** 一个空的装备方案（装备系统整体未接线，校验器不看它的内容）。 */
const EMPTY_LOADOUT = {
  items: [],
  talents: [],
  skillBar: [],
  barSlotCount: 0,
} as const;

/**
 * 把"故意构造的非法/残缺定义"交给被测量函数。
 *
 * ⚠️ 这不是绕过类型检查 —— 它把"这里确实是一份内容作者可能写错的
 * 定义"写在了名字上，而且全文只有这一处（AGENTS.md §1 的做法）。
 * 之所以只需要 `as SkillDef`（而不是 `as unknown as`）：本检查只读
 * 时间字段，`Partial` 与目标类型在结构上是兼容的。
 */
function asSkill(value: Partial<ActiveSkillDef>): ActiveSkillDef {
  // 给上"本检查会遍历的集合"的空值，免得 fixture 漏字段导致 TypeError
  // 而不是一条断言失败。
  /**
   * ⚠️ **`kind` 必须显式写出来**：校验器按 `kind === 'activeSkill'` 收窄
   * （见 `content/timeGrid.ts`），而这里是 `as` 强迫类型 —— 运行期漏了
   * `kind` 的话类型检查不会响，但**校验器会整条跳过这个技能**，
   * 表现成"改坏了值也不报错"（本次确实红过）。
   */
  return { abilities: [], hits: [], ...value, kind: 'activeSkill' } as ActiveSkillDef;
}

/** 同上，buffs 版。 */
function asBuff(value: Partial<BuffDef>): BuffDef {
  return value as BuffDef;
}

/** 同上，entities 版。 */
function asEntity(value: Partial<GameEntity>): GameEntity {
  return { abilities: [], ...value } as GameEntity;
}

/** 一个带行为的遭遇战（行为里的 `atMs` / `delayMs` / `gapMs` 也在清单里）。 */
function encounterWith(id: string, behaviors: EncounterDef['boss']['behaviors']): EncounterDef {
  return {
    id,
    nameKey: 'stat.haste',
    player: EMPTY_LOADOUT,
    boss: { ...EMPTY_LOADOUT, behaviors },
    victory: [],
    defeat: [],
  };
}

function gridInput(partial: Partial<TimeGridInput>): TimeGridInput {
  return { entities: [], skills: [], buffs: [], ...partial };
}

/** 全部现有内容：两套角色技能 + 两个 Boss 的行为 + 熵之钟的设计样本。 */
function fullBundle(): ContentBundle {
  return {
    entities: [ENTROPY_CLOCK],
    skills: [...ALL_SKILLS],
    buffs: [...ALL_BUFFS],
    localeKeys,
    encounters: [
      encounterWith('pride', PRIDE_BEHAVIORS),
      encounterWith('lust', LUST_BEHAVIORS),
    ],
  };
}

describe('OFF_GRID_TIME：现有内容全过（规则成立 + 内容干净）', () => {
  it('全量内容（技能 / buff / 熵之钟 / 两个 Boss 的行为）在严格模式下零问题', () => {
    expect(validateContent(fullBundle())).toEqual([]);
  });

  it('单独跑时间栅格检查也是零问题（不靠别的校验掩盖）', () => {
    expect(offGridTimeIssues(fullBundle())).toEqual([]);
  });
});

describe('OFF_GRID_TIME：反向验证（真的会红）', () => {
  it('「拳」的 castTime 写回 250（= logicMs(2.5)）会报错，并指出字段', () => {
    const punch = activeSkillOf(ALL_SKILLS.find((s) => s.id === 'punch'), 'punch');
    expect(punch).toBeDefined();

    const issues = validateContent({
      entities: [],
      skills: [asSkill({ ...punch, id: 'punch', castTime: 250 })],
      buffs: [],
    });

    expect(issues).toHaveLength(1);
    expect(issues[0]?.code).toBe('OFF_GRID_TIME');
    expect(issues[0]?.severity).toBe('error');
    expect(issues[0]?.path).toBe('skill:punch.castTime');
    expect(issues[0]?.message).toMatch(/250ms/);
  });

  it('对**真实内容集**篡改一个值：整包从"全过"变成"红"（启动即失败）', () => {
    const bundle = fullBundle();
    expect(validateContent(bundle)).toEqual([]);

    const tampered: ContentBundle = {
      ...bundle,
      skills: bundle.skills.map((s) =>
        s.id === 'punch' && s.kind === 'activeSkill' ? asSkill({ ...s, castTime: 250 }) : s,
      ),
    };

    expect(validateContent(tampered).map((i) => i.code)).toEqual(['OFF_GRID_TIME']);
    // 严格模式的后果：`createRegistry` 会在启动时抛错，而不是带着错值开打
    expect(() => assertValidContent(tampered)).toThrow(/OFF_GRID_TIME/);
  });

  it('只差 1ms 也算越界（刻度是硬的，不做浮点容差）', () => {
    const issues = offGridTimeIssues(
      gridInput({
        skills: [asSkill({ id: 'x', castTime: LOGIC_TICK_MS * 3 - 1 })],
      }),
    );

    expect(issues.map((i) => i.code)).toEqual(['OFF_GRID_TIME']);
  });

  it('拦 buff 时长 / 触发器 CD / 命中偏移 —— 不只是 castTime', () => {
    const cases: readonly { readonly input: TimeGridInput; readonly path: string }[] = [
      {
        input: gridInput({
          buffs: [asBuff({ id: 'b', duration: 250, stacking: { mode: 'refresh' } })],
        }),
        path: 'buff:b.duration',
      },
      {
        input: gridInput({
          entities: [
            asEntity({
              id: 'e',
              kind: 'equipment',
              abilities: [
                { kind: 'trigger', trigger: { on: 'onHitTaken', cooldownMs: 150, then: [] } },
              ],
            }),
          ],
        }),
        path: 'equipment:e.abilities[0].trigger.cooldownMs',
      },
      {
        input: gridInput({ skills: [asSkill({ id: 'x', hits: [{ at: 250, effects: [] }] })] }),
        path: 'skill:x.hits[0].at',
      },
      {
        input: gridInput({ buffs: [asBuff({ id: 'c', duration: 300, stacking: { mode: 'extend', maxDurationMs: 250 } })] }),
        path: 'buff:c.stacking.maxDurationMs',
      },
    ];

    for (const { input, path } of cases) {
      expect(offGridTimeIssues(input).map((i) => i.path)).toEqual([path]);
    }
  });

  it('`POSITIVE_INFINITY` 是"永久"，不是越界（内容里的合法写法）', () => {
    const issues = offGridTimeIssues(
      gridInput({
        buffs: [
          asBuff({
            id: 'forever',
            duration: Number.POSITIVE_INFINITY,
            stacking: { mode: 'refresh' },
          }),
        ],
      }),
    );

    expect(issues).toEqual([]);
  });

  it('行为的 atMs / delayMs / gapMs 三项都在拦', () => {
    const behaviors: readonly EncounterDef['boss']['behaviors'][number][] = [
      { kind: 'enrage', atMs: 120_050, dmgMult: 2 },
      { kind: 'opener', skillId: 'x', delayMs: 1_250 },
      { kind: 'rotation', steps: [{ skillId: 'x', gapMs: 4_050 }] },
      { kind: 'weightedRotation', steps: [{ skillId: 'x', weight: 1 }], gapMs: 3_050 },
    ];

    for (const behavior of behaviors) {
      const issues = offGridTimeIssues(
        gridInput({ encounters: [encounterWith('e', [behavior])] }),
      );
      expect(issues).toHaveLength(1);
      expect(issues[0]?.code).toBe('OFF_GRID_TIME');
    }
  });

  it('「截」的 `cooldownMs: -logicMs(100)`（负数 = 退还）照旧通过 —— 刻度看绝对值', () => {
    const jie = activeSkillOf(ALL_SKILLS.find((s) => s.id === 'jie'), 'jie');
    expect(jie).toBeDefined();

    expect(offGridTimeIssues(gridInput({ skills: jie === undefined ? [] : [jie] }))).toEqual([]);
  });

  it('`holdDrain.perLogicTick`（速率，不是时长）**不**被拦 —— 别误伤', () => {
    const guard = activeSkillOf(ALL_SKILLS.find((s) => s.id === 'guard'), 'guard');
    expect(guard?.holdDrain?.perLogicTick).toBe(1.5);

    const issues = offGridTimeIssues(gridInput({ skills: guard === undefined ? [] : [guard] }));

    expect(issues).toEqual([]);
  });
});
