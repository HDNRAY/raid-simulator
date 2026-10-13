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

/**
 * 语言包的扁平表（`key → 文案`）。
 *
 * ⚠️ 早先只有 `Set(keys)`（只验"key 在不在"）。加了"名字是四字 / 说明
 * 点明源技能"那两条之后要**读值**，所以换成 Map —— key 的存在性断言
 * 用 `.has()` 照旧。
 */
const QIJI_CATALOG = flattenCatalog(zhCN);
const QIJI_KEYS = new Set(QIJI_CATALOG.keys());

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
 * 2026-10-13：名字改成**四字成语**，于是"源技能"只能由 desc 点明
 * ------------------------------------------------------------------ */

describe('名字：一律四字（旧名 `截炁·生击` 那套已废）', () => {
  /**
   * ⚠️ 用户 2026-10-13 的改口原话是"四字成语、文雅一点点"。
   *
   * 旧名 `截炁·生击` 是 **5 字 + 中间一个点** —— 它一句话读得出"这是一条
   * 关系"（源技能 + 结果），但不符合"四字"。换成成语之后那半条好处**必须
   * 由 `desc` 补回来**（见下一条断言），否则玩家只看得到"当机立断"四个字。
   */
  it('每条名字恰好 4 个字（中文按码点算，`炁` 也算一个）', () => {
    for (const qiji of ALL_QIJI) {
      const name = QIJI_CATALOG.get(qiji.nameKey);
      expect(name, `${qiji.id} 的 name 不在语言包`).toBeDefined();
      expect([...(name ?? '')].length, `${qiji.id} 的名字不是四字：${String(name)}`).toBe(4);
    }
  });

  it('五条的名字就是定稿的那一套（防"顺手改回去"）', () => {
    const expected: Readonly<Record<string, string>> = {
      jieShengJi: '当机立断',
      xieShengJi: '以柔克刚',
      shanShengJi: '电光石火',
      vitality: '固本培元',
      breath: '周天运转',
    };
    for (const qiji of ALL_QIJI) {
      expect(QIJI_CATALOG.get(qiji.nameKey), qiji.id).toBe(expected[qiji.id]);
    }
  });

  it('⚠️ 三条派生的说明**点明源技能**，且那个名字是从内容里取的', () => {
    /**
     * 源技能名（截 / 卸 / 闪）在语言包里是 **单字**，所以这里**不上参数**
     * （那要把"哪个技能实体"从内容层穿过 `QijiCandidate` 递到渲染层，
     * 只为传一个字）。代价是"技能改名时说明不会跟着变" —— 这条断言就是
     * 为那个代价付的保险费：说明开头的「X」必须等于 `skill.<source>.name`。
     *
     * ⚠️ 断言的是"取到的那个值"，不是写死"截"：
     * `skill.jie.name` 改成别的字，这里跟着改，测试仍然绿。
     */
    for (const qiji of DERIVED) {
      const source = qiji.comboWindow?.sourceSkillId;
      expect(source, `${qiji.id} 没有源技能`).toBeDefined();
      const sourceName = QIJI_CATALOG.get(`skill.${String(source)}.name`);
      expect(sourceName, `skill.${String(source)}.name 不在语言包`).toBeDefined();
      const desc = QIJI_CATALOG.get(qiji.descKey ?? '') ?? '';
      expect(
        desc.startsWith(`「${String(sourceName)}」`),
        `${qiji.id} 的说明没有以源技能「${String(sourceName)}」开头：${desc}`,
      ).toBe(true);
      /** 派生出来的是「击」（同一个技能，变的只是它从谁那儿派出来）。 */
      expect(desc).toContain('「击」');
    }
  });

  it('⚠️ 兜底两条的说明保留**结构化行**（数值 + 叠层），别被文案挤掉', () => {
    /**
     * 用户点名："卡片上已有的 '+30 生命上限。可叠 3 层。' 那类结构化行要在"。
     * 这两条不是派生，说明本身就是结构化信息 —— 所以逐条钉住它的两行。
     */
    expect(QIJI_CATALOG.get('qiji.vitality.desc')).toBe('生命上限 +30。\n可叠 3 层。');
    expect(QIJI_CATALOG.get('qiji.breath.desc')).toBe('炁回复速度 +10/秒。\n（基础 10/秒）可叠 2 层。');
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
