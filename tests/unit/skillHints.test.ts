/**
 * **读条 / 设置页上的玩法提示从哪来** —— 全部推导，没有手写数据。
 *
 * ==================================================================
 * 这个文件防的是什么（玩家先后报过两次同一个病）
 * ==================================================================
 *
 *   - "傲慢现在哪个招式会导致倒地，请加 tag，**玩家看不到**。"
 *   - "检查一下 色欲的魅惑，好像没有眩晕标签，**一样的问题**。"
 *
 * 根因是原先每个技能手写一份 `hintTags`，而那份数据**与效果是冗余的**，
 * 于是它往两个方向漂：
 *
 * | 漂法 | 实例 |
 * |---|---|
 * | **漏标** | 「碾压」会倒地、「魅惑」会眩晕，都没写 |
 * | **错标** | 「魅惑」**一点伤害都没有**，却写着「高伤」 |
 *
 * 现在真相只有一个：技能自己的声明（`hits[].effects` / `abilities`），
 * 提示由 `app/skillHints.ts` 推出来，`SkillDef.hintTags` 与 `HintTag`
 * 类型**都已删除**。
 *
 * ==================================================================
 * 为什么单独一个文件
 * ==================================================================
 *
 * 这组用例原先塞在 `log.test.ts` 里，把它顶到 715 行、超过 `AGENTS.md`
 * §3 的上限。按那里的规则（**不许靠删/压注释解决，要拆 util 或横向
 * 切割**）切出来 —— 而且"提示从哪来"与"日志怎么记"本来就没有交集。
 */
import { describe, expect, it } from 'vitest';
import { ALL_BUFFS, ALL_SKILLS } from '../../src/data/content';
import { translator } from '../../src/i18n/translator';
import { hintKeysOf } from '../../src/app/skillHints';

describe('招式提示：全部从效果推导', () => {
  /**
   * ==================================================================
   * 提示标签**从效果推导**（不再是每个技能手写一份）
   * ==================================================================
   *
   * 玩家先后报过两次同一个病：
   *   - "傲慢现在哪个招式会导致倒地，请加 tag，**玩家看不到**"
   *   - "检查一下 色欲的魅惑，好像没有眩晕标签，**一样的问题**"
   *
   * 根因是**手写的 hint 与效果是两份数据**，于是它往两个方向漂：
   * 「碾压」漏标倒地；「魅惑」漏标眩晕**且**错标高伤（它根本没有伤害效果）。
   *
   * 现在真相只有一个：效果的 `buff` 字段，提示由 `hintKeysOf` 推出来
   * （见 `app/skillHints.ts`）。下面用**真实的傲慢 / 色欲内容**钉住它。
   */
  it('【推导】傲慢「碾压」：高伤 / 霸体 / 倒地**全部**推出来', () => {
    const heavy = ALL_SKILLS.find((s) => s.id === 'boss-heavy')!;
    /**
     * ⚠️ `SkillDef` 上**已经没有** `hintTags` 字段了 —— 三个提示全部推导：
     *   - 高伤 ← 单次伤害 60 ≥ 血上限的 30%
     *   - 霸体 ← `abilities` 里 `castStart` 给自己挂的 armor
     *   - 倒地 ← `hits` 里给挨打者挂的 debuff 名（「倒地」）
     *
     * ⚠️ 断言**按集合比**，不按顺序 —— 推导是"扫一遍声明、去重"，
     * 顺序没有语义（这里 hits 先于 abilities，所以倒地排在霸体前）。
     */
    expect([...hintKeysOf(heavy)].sort()).toEqual(
      ['debuff.knockdown.name', 'settings.hintTags.highDamage', 'settings.hintTags.interruptImmune'].sort(),
    );
  });

  /**
   * ==================================================================
   * 「高伤」是**阈值**推出来的，不是手写的 —— 这修掉一个设计矛盾
   * ==================================================================
   *
   * 原先四个技能**全**标着「高伤」（轻蔑 20 / 缠绕 30 / 呵斥 40 / 碾压 60）
   * —— 一个所有人都有的标签等于没有标签。
   *
   * 更糟的是它和设计**自相矛盾**：`bossPride` 里「轻蔑」的原话是
   * "**硬吃**（花 30 炁去闪不划算）"，可它标着「高伤」（劝你闪）。
   *
   * 阈值化（≥ 血上限的 30%，即 30 点）之后，轻蔑**自动**不再标高伤，
   * 与"硬吃"的设计对齐。
   */
  it('【阈值】「轻蔑」20 伤不标高伤（与"硬吃"的设计对齐），呵斥/碾压标', () => {
    const keysOf = (id: string): readonly string[] =>
      hintKeysOf(ALL_SKILLS.find((s) => s.id === id));
    const HIGH = 'settings.hintTags.highDamage';

    expect(keysOf('boss-scorn'), '20 伤 = 硬吃，不该劝玩家闪').not.toContain(HIGH);
    expect(keysOf('boss-rebuke'), '40 伤').toContain(HIGH);
    expect(keysOf('boss-heavy'), '60 伤').toContain(HIGH);
    /** 12 伤的轻吟同理。 */
    expect(keysOf('lust-hum')).not.toContain(HIGH);
  });

  it('【推导】色欲「魅惑」：显示「眩晕」，而且**不再**错标「高伤」', () => {
    const charm = ALL_SKILLS.find((s) => s.id === 'lust-charm')!;
    const keys = hintKeysOf(charm);
    /** 眩晕取的是那个 debuff 自己的名字（「眩晕」）。 */
    expect(keys).toContain('lust.stun.name');
    /**
     * ⚠️ **闭环**：这个 key 必须真的翻译得出中文。
     *
     * 读条渲染层是 `translate(key)`（见 `render/parts/bossCastBar.ts`），
     * 而 key 的形态从"`HintTag` 值 + 前缀拼接"改成了"完整 i18n key" ——
     * 一旦某一环还在拼前缀，屏幕上显示的就是 `settings.hintTags.lust.stun.name`
     * 这串英文路径本身（**实测截图抓到过**，单测当时没抓到）。
     */
    expect(translator.t('lust.stun.name' as never)).toBe('眩晕');
    expect(translator.t('debuff.knockdown.name' as never)).toBe('倒地');
    /** ⚠️ 反向：没有伤害效果就不该有「高伤」。 */
    expect(keys).not.toContain('settings.hintTags.highDamage');
  });

  it('【推导】「截」「破」的「打断」来自 `interrupt` 效果，不靠手写', () => {
    for (const id of ['jie', 'break']) {
      const skill = ALL_SKILLS.find((s) => s.id === id);
      if (skill === undefined) continue;
      expect(hintKeysOf(skill), `${id} 应当推出「打断」`).toContain(
        'settings.hintTags.interrupt',
      );
    }
  });

  /**
   * ⚠️ **不变量**：所有"会控住挨打者"的效果，其 debuff 名字都要能显示出来。
   *
   * 这条不是"在替冗余数据打补丁"（上一版那条是），而是直接问：
   * **推导函数是不是真的覆盖了内容里所有的控制类 debuff？**
   * 新增一个控制 debuff 而推导漏掉它 → 立刻失败。
   */
  it('【不变量】内容里每个"会控住玩家"的 debuff，都被推导出来了', () => {
    const controllerBuffIds = new Set(
      ALL_BUFFS.filter(
        (b) => b.flags?.actionLock === true || (b.flags?.restrictToTags?.length ?? 0) > 0,
      ).map((b) => b.id),
    );
    /** 至少得有一个，否则这条断言空转、永远绿。 */
    expect(controllerBuffIds.size).toBeGreaterThan(0);

    /** 收集全部"给挨打者挂控制类 debuff"的技能所推出来的 key。 */
    const shown = new Set<string>();
    for (const skill of ALL_SKILLS) {
      for (const key of hintKeysOf(skill)) shown.add(key);
    }

    for (const buff of ALL_BUFFS) {
      if (!controllerBuffIds.has(buff.id)) continue;
      /** 只有当它真的被某个技能的**挨打者向**效果挂上时，才要求显示。 */
      const grantedToVictim = ALL_SKILLS.some((s) =>
        s.hits.some((h) =>
          h.effects.some(
            (e) =>
              e.buff?.id === buff.id &&
              (e.kind === 'stun' || (e.kind === 'grantBuff' && e.target?.mode !== 'self')),
          ),
        ),
      );
      if (!grantedToVictim) continue;
      expect(shown, `${buff.id} 会控住玩家，却没出现在任何读条提示里`).toContain(buff.nameKey);
    }
  });
});
