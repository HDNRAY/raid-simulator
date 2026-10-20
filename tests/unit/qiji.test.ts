import { describe, expect, it } from 'vitest';
import { ALL_QIJI, QIJI_BREATH, QIJI_JIE_STRIKE, QIJI_VITALITY, qijiById } from '../../src/data/qiji';
import { flattenCatalog } from '../../src/i18n/translator';
import { zhCN } from '../../src/i18n/locales/zh-CN';
import { COMBO_WINDOW } from '../../src/data/kits/combo';
import { DODGE_CHARGE } from '../../src/data/kits/dodgeCharge';
import { FOCUS_BUFF } from '../../src/data/kits/shared';
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

/** 改技能本身的炁机（避回缠 / 凝减耗 / 凝增伤 / 斩法）。 */
const TWEAKED = ALL_QIJI.filter((q) => q.skillTweak !== undefined);

/** 靠"装一条常驻 buff"生效的炁机（今天只有「黑闪」）。 */
const PASSIVE = ALL_QIJI.filter((q) => q.passiveBuffs !== undefined);

describe('炁机池：数量与形状', () => {
  it('一共 **13** 条：2 条兜底 + 3 条派生 + 5 条改技能 + 3 条装 buff', () => {
    /**
     * ⚠️ 2026-10-14 加了**两条**「用 30 次」的（拳 → 黑闪、斩 → 斩法）：
     *   - 「黑闪」**不改技能**，它靠 `passiveBuffs` 装一条常驻 buff
     *     ⇒ 落在下面的 `PASSIVE` 那一类
     *   - 「斩法」是 `skillTweak`（读条减半 + 伤害 +30%）⇒ `TWEAKED` 变 4 条
     */
    /**
     * ⚠️ 2026-10-20 又加了**两条**（用户："斩+凝流派…重击流…"）：
     *   - 「凝神斩意」：**不改技能**，靠 `passiveBuffs` 的触发器
     *     （`onHitDealt` 命中「斩」且身上有「凝」⇒ 追加一次命中）⇒ `PASSIVE`
     *   - 「重击回缠」：`skillTweak`（劈回缠）**加** `passiveBuffs`
     *     （`onAvoided` 回缠）⇒ **两类都算**（它是"改技能 + 装 buff"的合体）
     */
    expect(ALL_QIJI).toHaveLength(13);
    expect(DERIVED).toHaveLength(3);
    expect(TWEAKED).toHaveLength(5);
    expect(ALL_QIJI.filter((q) => q.unlock.kind === 'always')).toHaveLength(2);
    expect(PASSIVE).toHaveLength(3);
  });

  it('每条都是 `kind: "qiji"`（W8 的类型那一半：不再是假 kind）', () => {
    for (const qiji of ALL_QIJI) expect(qiji.kind).toBe('qiji');
  });

  it('id 唯一（重复会让"我选了哪个"有两个答案）', () => {
    const ids = ALL_QIJI.map((q) => q.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('`qijiById` 认全部 10 条，未知 id 给 undefined', () => {
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
 * ⚠️ 名字的**字数 / 字面值不测**（用户 2026-10-13 拍板）
 * ------------------------------------------------------------------ *
 *
 * 这里原有两条断言：
 *   1. "每条名字恰好 4 个字（中文按码点算）"
 *   2. "八条的名字就是定稿的那一套"（逐条对表）
 *
 * 两条都**删掉了** —— 它们是**开发过程里挑过的词与命名风格**，不代表任何
 * 游戏 / 引擎必须成立的事：名字改一个字、少一个字，玩家看到的就是另一个
 * 名字，**没有任何静默错误**。
 *
 * 用户原话："判断 素材来源 啥的这些判断 是开发过程····不要写进ut"、
 * "**恰好四个字 也不需要ut啊····**"。
 *
 * ⚠️ 下面留下的两条与上面相反：它们断的是**从内容 / 语言包推导出来的
 * 关系**（源技能名从 `skill.<id>.name` 反查、说明里的行与内容对应），
 * 改错了会红 —— 那是"契约"，不是"当时挑的词"。
 * ------------------------------------------------------------------ */

describe('说明与内容的推导关系（名字的字数 / 字面值不测）', () => {

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

  it('⚠️ 兜底两条的说明里的**数值与内容一致**（不钉文案，只钉数字）', () => {
    /**
     * ⚠️ 原来这条是**逐字钉住说明文案**（`'生命上限 +30。\n可叠 3 层。'`）。
     * 那是"当时挑的词"，按用户 2026-10-13 的判据已删（UT 不测开发过程）。
     *
     * 但留了一半**有真实后果**的：卡片上就这一行说明，玩家看到的数字只有
     * 这里。说明里的数值一旦与内容的 `modifier.value` 漂移，玩家会被
     * **静默误导**（"写着 +30，实际 +20"，不报错）。所以这里改成
     * **从内容推导**：说明里必须出现内容真正用的那个数。
     *
     * ⚠️ 断言的是 `desc.includes(String(value))`，不是抄一句文案 ——
     * 改词、改标点、改语序都不会红；**只有数值对不上才红**。
     *
     * ⚠️ 2026-10-13：**"可叠 N 层"那一半断言已删** —— 说明里不再写层数
     * （用户纠正："炁机的激活 没有层"，见 `ui/freeQiji.ts`）。
     * ⚠️ 同日稍后 `maxStacks` **整条字段也删了**（用户："肉鸽也改成一局
     * 只能选一次（不叠加）"）—— 所以现在**没有任何**"层"可以写进说明。
     */
    const modifierValueOf = (id: string): number | undefined => {
      const qiji = ALL_QIJI.find((q) => q.id === id);
      const ability = qiji?.abilities.find((a) => a.kind === 'modifier');
      if (ability === undefined || ability.kind !== 'modifier') return undefined;
      const value: unknown = ability.modifier.value;
      return typeof value === 'number' ? value : undefined;
    };

    for (const id of ['vitality', 'breath']) {
      const desc = QIJI_CATALOG.get(`qiji.${id}.desc`) ?? '';
      const value = modifierValueOf(id);
      expect(value, `${id} 没有 modifier 数值`).toBeDefined();
      expect(desc, `${id} 的说明里没有内容用的数值 ${String(value)}：${desc}`).toContain(`+${String(value)}`);
      /** ⚠️ 自由模式的炁机卡是开关 —— 说明里不许再出现"可叠 N 层"。 */
      expect(desc, `${id} 的说明里又写回了层数：${desc}`).not.toContain('可叠');
    }
  });
});

/* ------------------------------------------------------------------ *
 * 第 3 条规则：两个开局就解锁的兜底
 * ------------------------------------------------------------------ */

describe('兜底①「加血上限」：`maxHp +30`、一局只能选一次', () => {
  it('是 `unlock: always`（开局就在池子里）', () => {
    expect(QIJI_VITALITY.unlock).toEqual({ kind: 'always', of: [] });
  });

  it('⚠️ 落点是 `modifier: maxHp`，**不再是**"叠 3 层"那件事', () => {
    /**
     * 用户 2026-10-13 推翻了"同一个通用炁机可以再选一次、累积到上限"
     * （"肉鸽也改成一局只能选一次（不叠加）"），`maxStacks` 字段**整条
     * 删除**（见 `core/types/qiji.ts` 的作废段）。
     *
     * ⚠️ 这一条**不再**去断言"`maxStacks` 是 `undefined`"：那个字段在
     * 类型上已经不存在，写 `QIJI_VITALITY.maxStacks` 会直接**编译失败**
     * —— "字段没了"是 `tsc` 保证的，比一条运行期断言更硬。这里改成断言
     * 它**留下的是哪条效果**（+30 血上限），那才是这一条炁机的内容。
     */
    expect(QIJI_VITALITY.abilities).toHaveLength(1);
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

describe('兜底②「炁回复速度」：`energyRegen +10`、一局只能选一次', () => {
  it('是 `unlock: always`（没有 `maxStacks` —— 见上一条的说明）', () => {
    expect(QIJI_BREATH.unlock).toEqual({ kind: 'always', of: [] });
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

      it('⚠️ 没有 `maxStacks`（一局只能选一次；字段已删 —— 类型上就没有它）', () => {
        /** 与上面 `vitality` 那条同一个判据：`tsc` 已经保证了字段不存在。 */
        expect(Object.keys(qiji)).not.toContain('maxStacks');
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

/* ------------------------------------------------------------------ *
 * ③ 三条"改技能本身"的炁机（2026-10-13）
 * ------------------------------------------------------------------ */

describe('三条 `skillTweak`：解锁条件 + 效果形状', () => {
  const dodge = qijiById('biShiJiXu') as QijiEntity;
  const cost = qijiById('ningShenJuQi') as QijiEntity;
  const boost = qijiById('ningShenRuDao') as QijiEntity;

  it('恰好五条，且都**不带** `comboWindow`（两类炁机不混）', () => {
    expect(TWEAKED.map((q) => q.id).sort()).toEqual([
      'biShiJiXu',
      'chongJiHuiChan',
      'ningShenJuQi',
      'ningShenRuDao',
      'zhanFa',
    ]);
    for (const qiji of TWEAKED) expect(qiji.comboWindow).toBeUndefined();
  });

  it('解锁条件都是 `statAtLeast(skillUses, <源技能>, run) >= 3`（本局累计）', () => {
    expect(dodge.unlock).toEqual({
      kind: 'statAtLeast',
      stat: { s: 'skillUses', skillId: 'dodge', scope: 'run' },
      value: 3,
    });
    expect(cost.unlock).toEqual({
      kind: 'statAtLeast',
      stat: { s: 'skillUses', skillId: 'focus', scope: 'run' },
      value: 3,
    });
  });

  it('⚠️ 两条「凝」的解锁条件**逐字相同**（用户："3 次凝解锁 2 个契机"）', () => {
    expect(cost.unlock).toEqual(boost.unlock);
  });

  it('「避实击虚」：用出避 → `grant` 一层蓄势（自己）', () => {
    /**
     * ⚠️ 效果 2026-10-13 **整条换掉**：原来是用出避回 20 缠
     * （`{ kind: 'resource', …, delta: 20 }`），现在是挂一层 buff
     * （下一次攻击翻倍、用掉就消耗）。
     */
    expect(dodge.skillTweak?.skillId).toBe('dodge');
    expect(dodge.skillTweak?.onUse).toEqual({
      kind: 'grant',
      target: { mode: 'self' },
      buff: DODGE_CHARGE,
    });
    /** 它**不**改代价（「避」的代价是炁，见下面那条断言）。 */
    expect(dodge.skillTweak?.costDeltas).toBeUndefined();
    /** ⚠️ 旧的"回缠"那一支**不许留着**（留着就是"看起来还在回缠"）。 */
    expect(JSON.stringify(dodge.skillTweak)).not.toContain('douqi');
  });

  it('「避实击虚」的 buff 是**蓄势**：+100% 增伤，一层，用掉就消耗', () => {
    /**
     * "翻倍"= `damageBoost` 加 100 个百分点（累加器约定，见
     * `kits/dodgeCharge.ts` 文件头）。这一条钉的是**那个数**，因为
     * 卡片的说明写的是"伤害翻倍"（文案里没有数字，见下面的对账断言）。
     */
    const modifier = (DODGE_CHARGE.modifiers ?? []).find((m) => m.stat === 'damageBoost');
    expect(modifier?.op).toBe('addPercent');
    expect(modifier?.value).toBe(100);
    /** 一层 + 刷新：连闪 3 次不是 ×8。 */
    expect(DODGE_CHARGE.maxStacks).toBe(1);
    expect(DODGE_CHARGE.stacking).toEqual({ mode: 'refresh' });
    /** 无限时长：唯一的终止条件是"打出去"（不是因为时间到）。 */
    expect(DODGE_CHARGE.duration).toBe(Number.POSITIVE_INFINITY);
    /** 会画出来 —— 所以它必须有短标签（`viewHelpers` 的覆盖率那条钉住）。 */
    expect(DODGE_CHARGE.hidden).not.toBe(true);
  });

  it('「聚气凝神」：`costDeltas` 只有一条 `douqi −20`', () => {
    expect(cost.skillTweak?.skillId).toBe('focus');
    expect(cost.skillTweak?.costDeltas).toEqual([{ resource: 'douqi', delta: -20 }]);
    expect(cost.skillTweak?.buffOverrides).toBeUndefined();
  });

  it('「凝神入道」：把 `focus` buff 的 `damageBoost` **覆盖**成 100', () => {
    expect(boost.skillTweak?.skillId).toBe('focus');
    expect(boost.skillTweak?.costDeltas).toBeUndefined();
    expect(boost.skillTweak?.buffOverrides).toEqual([
      { buffId: FOCUS_BUFF.id, modifiers: [{ stat: 'damageBoost', value: 100 }] },
    ]);
  });

  it('⚠️ 覆盖的**基准**是当前 `FOCUS_BUFF` 的值（60），所以 100 是"变成"不是"+100"', () => {
    const base = (FOCUS_BUFF.modifiers ?? []).find((m) => m.stat === 'damageBoost');
    expect(typeof base?.value).toBe('number');
    expect(base?.value).toBe(60);
    /** 若它写成"加 100"，应用后会是 160 —— 那条由 wiring 实测钉住。 */
  });
});

/* ------------------------------------------------------------------ *
 * 文案与数值的对账（说明里的数字必须等于内容里的数字）
 * ------------------------------------------------------------------ */

describe('三条新炁机的说明与内容**对得上**', () => {
  it('说明里点名的源技能 = `skillTweak.skillId` 的显示名', () => {
    for (const qiji of TWEAKED) {
      const source = qiji.skillTweak?.skillId;
      const sourceName = QIJI_CATALOG.get(`skill.${String(source)}.name`);
      const desc = QIJI_CATALOG.get(qiji.descKey ?? '') ?? '';
      expect(
        desc.startsWith(`「${String(sourceName)}」`),
        `${qiji.id} 的说明没有以源技能「${String(sourceName)}」开头：${desc}`,
      ).toBe(true);
    }
  });

  it('说明里的数字与内容一致（避翻倍 / 凝减耗 20 / 凝增伤 100%）', () => {
    /**
     * ⚠️ 与 `vitality` / `breath` 同一条口径：数字的家在内容里（`data/qiji.ts`
     * 或它引用的 buff），说明只是文案。两处不一致 = 玩家看到的和生效的
     * 不是一回事。
     *
     * ⚠️「避实击虚」的文案**故意不写数字**（写"伤害翻倍"）：那个 100 住在
     * `kits/dodgeCharge.ts`，从这里**读出来**再判"它就是翻倍"，而不是
     * 在文案里抄一遍 `100%`（那会是第二份真相）。
     */
    const dodgeDesc = QIJI_CATALOG.get('qiji.biShiJiXu.desc') ?? '';
    const charge = (DODGE_CHARGE.modifiers ?? []).find((m) => m.stat === 'damageBoost');
    const multiplier = 1 + (typeof charge?.value === 'number' ? charge.value : 0) / 100;
    expect(multiplier).toBe(2);
    expect(dodgeDesc).toContain('伤害翻倍');
    /** 旧文案的"回复 20 缠"不许留（它已经不是那条炁机的效果了）。 */
    expect(dodgeDesc).not.toContain('回复');

    const costDesc = QIJI_CATALOG.get('qiji.ningShenJuQi.desc') ?? '';
    const reduction = qijiById('ningShenJuQi')?.skillTweak?.costDeltas?.[0]?.delta;
    expect(costDesc).toContain(`减少 ${String(Math.abs(reduction ?? 0))}`);

    const boostDesc = QIJI_CATALOG.get('qiji.ningShenRuDao.desc') ?? '';
    const override = qijiById('ningShenRuDao')?.skillTweak?.buffOverrides?.[0]?.modifiers[0]?.value;
    expect(boostDesc).toContain(`变为 ${String(override)}%`);
  });
});
