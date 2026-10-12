import { describe, expect, it } from 'vitest';
import { applyRebind, resolveRowTap, swapSlotSkills } from '../../src/ui/settings/logic';

describe('触屏与键盘功能对等（AGENTS.md §3b）', () => {
  /**
   * 需求："按键在移动端肯定需要可以配置，移动端和键盘的功能需要是一样的。"
   * 需求："至于 按键显示拆分，本来就要拆分啊，而且括号和括号里的内容
   *       根据是否是移动端可以不显示的，括号又不已改放进i18n"
   */
  describe('resolveRowTap：点一次格子该做什么', () => {
    it('改键中 → 绑到这个格子', () => {
      expect(
        resolveRowTap({
          focusedSkillId: 'attack',
          capturingSkillId: 'attack',
          touchedSkillId: 'dodge',
        }),
      ).toEqual({ kind: 'bind', skillId: 'dodge' });
    });

    it('点到**已选中**的格子 → 进改键（对等键盘 Enter）', () => {
      expect(
        resolveRowTap({
          focusedSkillId: 'attack',
          capturingSkillId: undefined,
          touchedSkillId: 'attack',
        }),
      ).toEqual({ kind: 'capture' });
    });

    it('点到**别的**格子 → 只选中（不误进改键）', () => {
      expect(
        resolveRowTap({
          focusedSkillId: 'attack',
          capturingSkillId: undefined,
          touchedSkillId: 'dodge',
        }),
      ).toEqual({ kind: 'focus' });
    });

    /**
     * ==================================================================
     * 回归：**桌面与触屏必须是同一条规则**（原先不是，两边各缺一半）
     * ==================================================================
     *
     * 玩家反馈："我现在任意一个都绑不了了。"
     *
     * 根因：这里原本有个 `isTouch` 条件，只有触屏才允许"点已选中的格子
     * → 进改键"。当时给的理由是"**鼠标本来就有键盘可用**"——
     *
     *   ❌ 那个假设是错的：纯鼠标用户于是**永远进不去改键**
     *      （桌面上 `Enter` 是唯一入口）。
     *   ❌ 而且它**没有让两边对等，只是把缺口换了个方向**：
     *      触屏按不出 Enter，所以触屏唯一的入口恰好就是这个条件；
     *      桌面有这个入口却被 `isTouch` 关掉。
     *
     * 现在两边共用同一条规则。这个断言**故意不带平台参数** ——
     * 参数不存在，就没法再分叉。
     */
    it('【回归】进改键的规则**不区分平台**（鼠标也必须能进）', () => {
      expect(
        resolveRowTap({
          focusedSkillId: 'attack',
          capturingSkillId: undefined,
          touchedSkillId: 'attack',
        }),
      ).toEqual({ kind: 'capture' });
    });
  });
});

describe('改键不能把技能"弄丢"（技能栏上等于少一个格子）', () => {
  /**
   * 一个键只能绑一个技能 → 改键必然顶掉旧占用者（`applyRebind` 的策略）。
   * 但**解绑的代价很大**：没键的技能不上技能栏（`slotsFromBindings`
   * 只取 `key !== ''`），所以被顶掉的技能会**从画面消失**。
   *
   * 实测踩到的：「斩」改到「避」的键后，「避」失去绑定 —— 而「避」是
   * 倒地（`restrictToTags: ['dodge']`）时**唯一能按的技能**，丢掉它
   * 等于倒地没有出路。
   *
   * ⚠️ 这段理由原先写的是"触屏上等于少一个按钮"（旧的派生关系）。
   * 2026-10-12 触屏按钮有了自己的集合（AGENTS.md §3b 的作废标注），
   * 所以受益者变成技能栏 —— 结论不变。
   *
   * 所以调用方要走**两位互换**：X 拿走 k，原占用者拿到 X 的旧键。
   */
  const base = [
    { key: 'q', skillId: 'attack' },
    { key: 'a', skillId: 'dodge' },
    { key: '', skillId: 'flash' },
  ];

  /** `main.ts` 的 `onRebind` 用的就是这段（此处照搬以锁语义）。 */
  function rebindSwap(
    bindings: typeof base,
    skillId: string,
    key: string,
  ): readonly { readonly key: string; readonly skillId: string }[] {
    const first = applyRebind(bindings, skillId, key);
    let next = first.bindings;
    const previousKey = bindings.find((b) => b.skillId === skillId)?.key;
    const victim = first.unbound === undefined ? undefined : bindings.find((b) => b.key === key);
    if (victim !== undefined && previousKey !== undefined && previousKey !== '') {
      next = applyRebind(next, victim.skillId, previousKey).bindings;
    }
    return next;
  }

  it('【关键】换位后两个技能都还在，且**没有任何技能失去绑定**', () => {
    const after = rebindSwap(base, 'attack', 'a');
    expect(after.find((b) => b.skillId === 'attack')?.key).toBe('a');
    expect(after.find((b) => b.skillId === 'dodge')?.key).toBe('q');
    /**
     * ⚠️ 这一条才是重点：`flash` 本来就没键（空键 = 不上场，是**预期**的），
     * 但 `attack` / `dodge` **都必须有键**。若实现退回"解绑被顶掉者"，
     * `dodge` 会变成空键 —— 这里就会挂。
     */
    expect(after.filter((b) => b.key !== '').map((b) => b.skillId).sort()).toEqual([
      'attack',
      'dodge',
    ]);
  });

  it('改到本来就空着的键 → 不需要换位，原键被腾空', () => {
    const after = rebindSwap(base, 'attack', 'z');
    expect(after.find((b) => b.skillId === 'attack')?.key).toBe('z');
    // 「避」不受影响（'a' 不是被抢的键）
    expect(after.find((b) => b.skillId === 'dodge')?.key).toBe('a');
  });
});

describe('「按键」页换位：必须真的改变**槽位顺序**', () => {
  /**
   * 需求（用户两次提出）："触屏依旧没有办法设置按键"、"选slot，再选技能
   * 就换slot"。
   *
   * ⚠️ 核心是换**位置**，不是换**键**。
   *
   * `applyRebind` **只换键、不动数组顺序** —— 所以换完之后槽位顺序
   * **一点变化都没有**，"选 slot 换 slot"是**假的**。
   * （我第一版就是这么接的，这条测试就是为它写的。）
   *
   * ⚠️ 顺序的消费者在 2026-10-12 换人了：原先写的是"触屏按钮顺序 =
   * 绑定表里有键的技能的顺序"；用户推翻那条派生之后（AGENTS.md §3b 的
   * 作废标注），跟着变的是**技能栏槽位**（`slotsFromBindings`）。
   */
  const base = [
    { key: 'q', skillId: 'attack' },
    { key: 'w', skillId: 'blast' },
    { key: '', skillId: 'flash' },
    { key: 'r', skillId: 'break' },
  ];

  /** 槽位顺序 = 有键的技能，按绑定表顺序（`slotsFromBindings` 同一条）。 */
  const slotOrder = (b: readonly { readonly key: string; readonly skillId: string }[]) =>
    b.filter((x) => x.key !== '').map((x) => x.skillId);

  it('换位后槽位顺序**确实变了**', () => {
    const before = slotOrder(base);
    const after = slotOrder(swapSlotSkills(base, 0, 1));
    expect(before).toEqual(['attack', 'blast', 'break']);
    expect(after).toEqual(['blast', 'attack', 'break']);
    /** 断言"变了"而不是只看数组内容 —— 这正是那个假实现的失败点 */
    expect(after).not.toEqual(before);
  });

  it('键留在原位、跟着技能一起走', () => {
    const after = swapSlotSkills(base, 0, 1);
    // 位置 0 现在放 blast，但它**带着原来的键 w**（键属于位置）
    expect(after[0]).toEqual({ key: 'q', skillId: 'blast' });
    expect(after[1]).toEqual({ key: 'w', skillId: 'attack' });
  });

  it('空键位（未上场技能）留在原位，不被挤走', () => {
    const after = swapSlotSkills(base, 0, 2);
    expect(after[2]).toEqual({ key: '', skillId: 'attack' });
    /** 「闪」是空键 → 不上场，但它仍在表里、仍在原位 */
    expect(slotOrder(after)).toEqual(['flash', 'blast', 'break']);
  });

  it('越界 / 同位置不改动（不产生脏数据）', () => {
    expect(swapSlotSkills(base, 0, 0)).toBe(base);
    expect(swapSlotSkills(base, 0, 99)).toBe(base);
    expect(swapSlotSkills(base, -1, 1)).toBe(base);
  });

  it('【对照】`applyRebind` **不能**用来做换位（它还丢一个槽位）', () => {
    /**
     * ⚠️ 这条是**反向证据**。实测比预期更糟：把 `attack` 改到 `w` 之后，
     * 位置 0 的 `q` **没人占**了 → 技能栏从 **3 格变成 2 格**
     * （`blast` 因为 `q` 空掉而不上场）。所以拿 `applyRebind` 做换位
     * 不只是"顺序不变"，还会**少一个槽位**。
     */
    const rebound = applyRebind(base, 'attack', 'w').bindings;
    expect(slotOrder(rebound)).not.toEqual(slotOrder(base));
    expect(slotOrder(rebound)).toHaveLength(2);
    expect(slotOrder(base)).toHaveLength(3);
  });
});
