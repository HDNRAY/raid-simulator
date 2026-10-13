import { describe, expect, it } from 'vitest';
import { ALL_QIJI, QIJI_BREATH, QIJI_JIE_STRIKE, QIJI_VITALITY, qijiById } from '../../src/data/qiji';
import { flattenCatalog } from '../../src/i18n/translator';
import { zhCN } from '../../src/i18n/locales/zh-CN';
import { COMBO_WINDOW } from '../../src/data/kits/combo';
import type { QijiEntity } from '../../src/core/types/qiji';

/**
 * **炁机内容表**（`src/data/qiji.ts`）—— P3。
 *
 * 设计稿：`docs/specs/2026-10-12-roguelike.md` §5.2 / §5.3 / §5.4。
 * 用户 2026-10-13 定下的规则（逐条钉在这里）：
 *
 *   1. 计数 = **本局累计**（`scope: 'run'`）
 *   2. 解锁是**本局**的、**选了才生效**（不是跨局成就）
 *   3. 两个**开局就解锁**的兜底：+血上限 / +炁回复速度
 *   4. 三条"**用了 3 次**"的：截 / 卸 / 闪 → 各自的**派生「击」**
 *
 * ⚠️ 这一份测的是**数据**，不是引擎：内容写错了（条件写窄 / 名字漏 key /
 * 用了禁用的 `setOverride`）不会崩，只会"某个炁机永远不出现"或
 * "卡片上是一串 key" —— 都是**静默**的，所以必须有断言。
 */

const QIJI_KEYS = new Set(flattenCatalog(zhCN).keys());

/** 三条"派生"的炁机（用户点名的那三条）。 */
const DERIVED = ALL_QIJI.filter((q) => q.comboWindow !== undefined);

describe('炁机池：数量与形状', () => {
  it('一共 5 条：2 条兜底 + 3 条派生', () => {
    expect(ALL_QIJI).toHaveLength(5);
    expect(DERIVED).toHaveLength(3);
    expect(ALL_QIJI.filter((q) => q.unlock.kind === 'always')).toHaveLength(2);
  });

  it('每条都是 `kind: "qiji"`（W8 的类型那一半：不再是假 kind）', () => {
    for (const qiji of ALL_QIJI) expect(qiji.kind).toBe('qiji');
  });

  it('id 唯一（重复会让"我选了哪个"有两个答案）', () => {
    const ids = ALL_QIJI.map((q) => q.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('`qijiById` 认全部 5 条，未知 id 给 undefined', () => {
    for (const qiji of ALL_QIJI) expect(qijiById(qiji.id)?.id).toBe(qiji.id);
    expect(qijiById('nope')).toBeUndefined();
  });

  it('⚠️ 兜底的两条排在**最前**（光标默认落在"至少能加血 / 加炁"上）', () => {
    expect(ALL_QIJI.slice(0, 2).map((q) => q.unlock.kind)).toEqual(['always', 'always']);
  });
});

describe('文案：每个 key 都在语言包里（否则卡片上是一串 key）', () => {
  it('每条都有 nameKey + descKey，且两个 key 都存在', () => {
    for (const qiji of ALL_QIJI) {
      expect(qiji.descKey, `${qiji.id} 没有 descKey`).toBeDefined();
      expect(QIJI_KEYS.has(qiji.nameKey), `${qiji.id} 的 nameKey 不在语言包：${qiji.nameKey}`).toBe(true);
      expect(
        QIJI_KEYS.has(qiji.descKey ?? ''),
        `${qiji.id} 的 descKey 不在语言包：${String(qiji.descKey)}`,
      ).toBe(true);
    }
  });

  it('key 的形状是 `qiji.<camelId>.<field>`（与内容 id 对应）', () => {
    for (const qiji of ALL_QIJI) {
      expect(qiji.nameKey).toBe(`qiji.${qiji.id}.name`);
      expect(qiji.descKey).toBe(`qiji.${qiji.id}.desc`);
    }
  });
});

/* ------------------------------------------------------------------ *
 * 第 3 条规则：两个开局就解锁的兜底
 * ------------------------------------------------------------------ */

describe('兜底①「加血上限」：`maxHp +30`、可叠 3 层', () => {
  it('是 `unlock: always`（开局就在池子里）', () => {
    expect(QIJI_VITALITY.unlock).toEqual({ kind: 'always', of: [] });
  });

  it('maxStacks = 3（§5.4：叠满一维之后被迫看向机制炁机）', () => {
    expect(QIJI_VITALITY.maxStacks).toBe(3);
  });

  it('效果是**一条** `maxHp` 的 `add` 修正（不是"改 caps"的专属字段）', () => {
    /**
     * ⚠️ 这一条是有意的设计：效果写成**标准 `modifier`**，于是 W6 做完
     * 之后（钳制读结算值）数据**一个字都不用改** —— `app/kit.ts` 里那一步
     * "把 maxHp 累加进 caps"才是过渡实现。
     */
    expect(QIJI_VITALITY.abilities).toHaveLength(1);
    const ability = QIJI_VITALITY.abilities[0];
    expect(ability?.kind).toBe('modifier');
    if (ability?.kind !== 'modifier') return;
    expect(ability.modifier.stat).toBe('maxHp');
    expect(ability.modifier.op).toBe('add');
    expect(ability.modifier.value).toBe(30);
  });
});

describe('兜底②「炁回复速度」：`energyRegen +10`、可叠 2 层', () => {
  it('是 `unlock: always`、maxStacks = 2', () => {
    expect(QIJI_BREATH.unlock).toEqual({ kind: 'always', of: [] });
    expect(QIJI_BREATH.maxStacks).toBe(2);
  });

  it('⚠️ 数值是 **10 的整数倍**（引擎按逻辑步 `floor(x/10)` 结算）', () => {
    /**
     * `core/combat/index.ts` 的 `regenerate` 每逻辑步加
     * `floor(energyRegen / LOGIC_TICKS_PER_SECOND)`。写成 5 会被静默吃掉
     * （`floor(0.5) = 0`）—— 那个口径的推导在那段注释里。
     * 这条断言把"内容必须写整十"钉住，免得有人改成 5 而没人发现。
     */
    const ability = QIJI_BREATH.abilities[0];
    expect(ability?.kind).toBe('modifier');
    if (ability?.kind !== 'modifier') return;
    expect(ability.modifier.stat).toBe('energyRegen');
    const value = ability.modifier.value;
    expect(typeof value).toBe('number');
    expect((value as number) % 10).toBe(0);
    expect(value).toBe(10);
  });
});

/* ------------------------------------------------------------------ *
 * 第 4 条规则：三条"用了 3 次" → 各自的派生「击」
 * ------------------------------------------------------------------ */

describe('三条「派生 击」：解锁条件是"**本局**用了 3 次"', () => {
  /**
   * 用户点名的三条：截 / 卸 / 闪。
   *
   * ⚠️ 每条都用 `skillUses`（**用了 3 次**）而不是 `skillInterrupts`
   * （**打断成功 3 次**）：用户的原话是"用了 3 次"，而且"用"是最直白、
   * 最容易复现的口径 —— 打断成功还要 Boss 恰好有可打断读条。
   */
  const expected: readonly { readonly id: string; readonly source: string }[] = [
    { id: 'jieShengJi', source: 'jie' },
    { id: 'xieShengJi', source: 'guard' },
    { id: 'shanShengJi', source: 'flash' },
  ];

  it('恰好是这三条（id 与源技能）', () => {
    expect(DERIVED.map((q) => q.id).sort()).toEqual(expected.map((e) => e.id).sort());
  });

  for (const { id, source } of expected) {
    describe(`「${id}」（源：${source}）`, () => {
      const qiji = ALL_QIJI.find((q) => q.id === id) as QijiEntity;

      it('解锁 = `statAtLeast(skillUses, source, run) >= 3`（**本局累计**）', () => {
        expect(qiji.unlock).toEqual({
          kind: 'statAtLeast',
          stat: { s: 'skillUses', skillId: source, scope: 'run' },
          value: 3,
        });
      });

      it('派生关系：源技能 → 「击」（`derivedSkillId === "strike"`）', () => {
        expect(qiji.comboWindow?.sourceSkillId).toBe(source);
        expect(qiji.comboWindow?.derivedSkillId).toBe('strike');
      });

      it('窗口 buff 的 `comboWindowSource` = 源技能（UI 靠它画在源技能上方）', () => {
        expect(qiji.comboWindow?.buff.flags?.comboWindowSource).toBe(source);
        expect(qiji.comboWindow?.buff.id).toBe('combo-window');
      });

      it('默认 maxStacks = 1（不写 = 只能选一次，§5.3 的节拍）', () => {
        expect(qiji.maxStacks).toBeUndefined();
      });
    });
  }

  it('⚠️「截 / 闪」只认打断，**不**带 `viaBuffId`（挨打不该开它们的窗）', () => {
    expect(QIJI_JIE_STRIKE.comboWindow?.viaBuffId).toBeUndefined();
    const shan = ALL_QIJI.find((q) => q.id === 'shanShengJi');
    expect(shan?.comboWindow?.viaBuffId).toBe('flash-iframe');
  });

  it('⚠️「卸 / 闪」走**第二条通道**（`viaBuffId`）—— 它们不发 interruptSuccess', () => {
    const xie = ALL_QIJI.find((q) => q.id === 'xieShengJi');
    expect(xie?.comboWindow?.viaBuffId).toBe('guard');
    expect(shan_via()).toBe('flash-iframe');
  });

  function shan_via(): string | undefined {
    return ALL_QIJI.find((q) => q.id === 'shanShengJi')?.comboWindow?.viaBuffId;
  }
});

/* ------------------------------------------------------------------ *
 * §5.3 的硬约束：禁止 `setOverride`（否则叠加顺序会有影响）
 * ------------------------------------------------------------------ */

describe('§5.3：炁机里**禁止** `setOverride`', () => {
  it('全部 `modifier` 的 op 里没有它（顺序无关 = 交换律成立的前提）', () => {
    /**
     * §5.3 明写："同一场战斗里叠加顺序有影响吗 —— **没有**，前提是
     * **禁止 `op:'setOverride'`**"。6 种 op 里只有它不交换。
     *
     * ⚠️ 这一条是**数据断言**（内容校验器还没管炁机 —— 那是 W8 的另一半、
     * P6 的事）。所以今天靠这条测试兜着，而不是靠校验器。
     */
    for (const qiji of ALL_QIJI) {
      for (const ability of qiji.abilities) {
        if (ability.kind !== 'modifier') continue;
        expect(ability.modifier.op, `${qiji.id} 用了 setOverride`).not.toBe('setOverride');
      }
    }
  });
});

/* ------------------------------------------------------------------ *
 * 与「派生窗口」基础定义的关系
 * ------------------------------------------------------------------ */

describe('三条派生炁机共用一个窗口 buff id（窗口只有一份）', () => {
  it('三条的 `buff.id` 都是 `combo-window` —— 同一时刻只可能开一个', () => {
    for (const qiji of DERIVED) expect(qiji.comboWindow?.buff.id).toBe(COMBO_WINDOW.id);
  });

  it('它们与基础定义只在 `comboWindowSource` 上不同（其余逐字段相同）', () => {
    for (const qiji of DERIVED) {
      const buff = qiji.comboWindow?.buff;
      expect(buff?.duration).toBe(COMBO_WINDOW.duration);
      expect(buff?.maxStacks).toBe(COMBO_WINDOW.maxStacks);
      expect(buff?.stacking).toEqual(COMBO_WINDOW.stacking);
      expect(buff?.flags?.comboWindow).toEqual(COMBO_WINDOW.flags?.comboWindow);
    }
  });
});
