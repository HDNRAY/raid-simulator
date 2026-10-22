import { describe, expect, it } from 'vitest';
import { ALL_BUFFS } from '../../src/data/content';
import { isInternalBuff, shortLabelKeyOf } from '../../src/app/viewHelpers';
import { flattenCatalog } from '../../src/i18n/translator';
import { zhCN } from '../../src/i18n/locales/zh-CN';

/**
 * **buff 短标签表**（`src/app/viewHelpers.ts` 的 `SHORT_LABEL_KEYS`）。
 *
 * ==================================================================
 * 这张测试的由来（一个真实的 bug）
 * ==================================================================
 *
 * 「闪」的 0.2 秒无敌窗口（`flash-iframe`）**没被登记**，于是战斗 HUD 上
 * 那个图标一直显示兜底的「？」，而「避」（`dodge-iframe`）是「避/无敌」。
 * 两个同类的 buff 一个有一个没有，只能靠**在游戏里看到**才发现 ——
 * 表本身是"允许缺项"的设计，缺项是**静默**的。
 *
 * 所以这里把"覆盖率"变成断言：**内容里每一个 buff 都要有短标签**。
 * 以后再有人加 buff 而忘了登记，红的是这条测试，不是玩家的眼睛。
 *
 * ⚠️ **输入是 `ALL_BUFFS`，不是"全仓所有 buff id"** —— 引擎还会**现造**
 * 一些（`boss-enrage-active`，见 `core/combat/stats.ts`：它带
 * 运行时参数，塞不进静态注册表）。那些靠
 * `shortLabelKeyOf` 里的**开发期告警**兜（`warnUnknownShortLabel`）。
 * 两者合起来才是"没有静默缺项"的闭环，所以下面单列一条把这句话钉住。
 */

/** 语言的**全部** key（短标签必须指向存在的 key，否则图标上是 `buffShort.xxx`）。 */
const CATALOG_KEYS = new Set(flattenCatalog(zhCN).keys());

describe('buff 短标签：覆盖率（判据是"会显示的都要有"）', () => {
  it('⚠️ `ALL_BUFFS` 里每一条**要么有短标签、要么是隐藏的**', () => {
    /**
     * 盘点差集时的结论：`ALL_BUFFS` 有 17 条，改之前有 7 条没登记 ——
     * 其中 5 条是**隐藏**的（4 条 `*-telegraph` + `lust-passive`，本来就不
     * 画图标），而**会显示的 2 条**（`flash-iframe` / `boss-heavy-armor`）
     * 是真漏。所以判据不是"全部 id 都要有标签"，而是：
     *
     *   会画出来的 buff（`hidden !== true`）**必须**有标签。
     *
     * 隐藏 buff 不登记是**有意的**：它们的图标根本不存在（
     * `app/viewAdapter.ts` 用 `isInternalBuff` 过滤），给它们编一个短标签
     * 只会是"没人看得见的文案"。⚠️ 哪天把它们改回可见，这条断言会红
     * —— 那正是它存在的意义。
     */
    const missing = ALL_BUFFS.filter(
      (buff) =>
        !isInternalBuff(buff.id, buff.hidden === true) &&
        shortLabelKeyOf(buff.id) === 'buffShort.unknown',
    ).map((buff) => buff.id);
    expect(
      missing,
      `这些 buff 会显示、却没有短标签（图标上是「？」）：${missing.join(', ')}\n` +
        '→ 在 src/app/viewHelpers.ts 的 SHORT_LABEL_KEYS 里补一条',
    ).toEqual([]);
  });

  it('改之前的两条真漏都补上了（`flash-iframe` / `boss-heavy-armor`）', () => {
    /**
     * 这一条是**差集清单的回归钉**（用户要的那份清单）：
     *
     *   | 没登记的 id | 为什么 | 处理 |
     *   |---|---|---|
     *   | `flash-iframe` | 真漏（「闪」显示成「？」） | ✅ 补 |
     *   | `boss-heavy-armor` | 真漏（傲慢「碾压」霸体） | ✅ 补 |
     *   | 4 × `boss-*-telegraph` | `hidden: true`，不画图标 | 不补（有意） |
     *   | `lust-passive` | `hidden: true`，不画图标 | 不补（有意） |
     *
     * ⚠️ 另外 `boss-enrage-active` **不在** `ALL_BUFFS` 里（引擎现造），
     * 它是第三处真漏，单独在下面钉。
     */
    for (const id of ['flash-iframe', 'boss-heavy-armor']) {
      expect(shortLabelKeyOf(id), id).not.toBe('buffShort.unknown');
    }
    for (const id of ['boss-scorn-telegraph', 'boss-rebuke-telegraph', 'boss-heavy-telegraph', 'boss-mend-telegraph', 'lust-passive']) {
      expect(shortLabelKeyOf(id), id).toBe('buffShort.unknown');
    }
  });

  it('每条的**短标签 key 本身**也在语言包里（否则图标上是一串 key）', () => {
    /**
     * ⚠️ 兜底那句也算"存在的 key" —— 它必须真的能查到（`buffShort.unknown`
     * 是"？"）。这条同时防"表里写了 `buffShort.typo`"。
     */
    for (const buff of ALL_BUFFS) {
      const key = shortLabelKeyOf(buff.id);
      expect(CATALOG_KEYS.has(key), `${buff.id} → ${key} 不在语言包`).toBe(true);
    }
  });

  it('「闪」与「避」是**两条**不同的登记（它们不是一个 buff）', () => {
    /**
     * 需求现场：两个都靠 `flags.invulnerable`，所以**只看 flag 分不出来**
     * （`data/qiji.ts` 的 `viaBuffId` 存在的全部理由）。短标签因此必须
     * 各自登记，而不是共用一条。
     *
     * ⚠️ 其中 `flash-iframe` 的值直接取它 `BuffDef` 的 `nameKey`
     * （`skill.flash.name` = "闪"）—— 技能改名时这里跟着变，这一条钉的是
     * "它取的是那个 key"，不是"那个 key 的字面值"。
     */
    expect(shortLabelKeyOf('flash-iframe')).toBe('skill.flash.name');
    expect(shortLabelKeyOf('dodge-iframe')).toBe('skill.dodge.name');
  });

  it('没登记的 id 落到中性兜底「？」，而不是某个具体机制的名字', () => {
    /**
     * ⚠️ 这一条是**反面**验收：兜底曾经是 `buffShort.telegraph`（"前摇"），
     * 于是每个没登记的 buff 都显示"前摇"—— 一个**错误的**名字比"没名字"
     * 更糟。所以兜底必须中性。
     */
    expect(shortLabelKeyOf('这个-id-不存在')).toBe('buffShort.unknown');
    expect(flattenCatalog(zhCN).get('buffShort.unknown')).toBe('？');
  });

  it('⚠️ 引擎现造的 `boss-enrage-active` 也登记了（它不在 `ALL_BUFFS` 里）', () => {
    /**
     * 这条**测不到**覆盖率（输入就是 `ALL_BUFFS`），所以单独钉一次：
     * 那个 buff 由 `core/combat/stats.ts` 的 `enrageBuff()` 现造，
     * 不登记就会在 Boss 狂暴后给玩家看一个「？」。
     */
    expect(shortLabelKeyOf('boss-enrage-active')).toBe('buffShort.enrage');
  });

  it('⚠️ 引擎现造的 `douqi-full`（缠满门槛标记）也登记了', () => {
    /**
     * 与上一条同源，但**更隐蔽**：`douqi-full` 由
     * `core/combat/castPipeline.ts` 的 `syncDouqiFull()` 现造，而它
     * **不在** `ALL_BUFFS` 里 —— 覆盖率那条看不见它。
     *
     * ⚠️ 它今天**没有产出者**（`syncDouqiFull()` 只在 castFinish 的
     * `resource` 能力之后调用，玩家技能里没有这一支），所以这条断言
     * 钉的是"**结构**"而不是"今天画面上有没有它"：哪天内容接回终结技，
     * 这里已经有一条短标签等着，不会突然冒出一个「？」。
     *
     * ⚠️⚠️ **这里原来还钉了字面值** `expect(...get('buffShort.douqiFull')).toBe('缠满')`
     * —— **已删**（用户 2026-10-13）。原话："判断 素材来源 啥的这些判断
     * 是开发过程····不要写进ut"。那个字是**开发时挑的词**（沿革见
     * `zh-CN.ts` 的 `douqiFull` 注释），改一个同义词不影响任何机制 ——
     * 钉它只是在"逼下一个人改两处"。
     *
     * 留下的是**有真实后果**的那两条：键必须在语言包里（缺了玩家看到
     * `buffShort.douqiFull` 这个 key 本身或「？」）。
     */
    expect(shortLabelKeyOf('douqi-full')).toBe('buffShort.douqiFull');
    expect(CATALOG_KEYS.has('buffShort.douqiFull')).toBe(true);
  });
});
