import { describe, expect, it } from 'vitest';
import { applyRebind, resolveRowTap, swapSlotSkills } from '../../src/ui/settings/logic';

describe('触屏与键盘功能对等（AGENTS.md §3b）', () => {
  /**
   * 需求："按键在移动端肯定需要可以配置，移动端和键盘的功能需要是一样的。"
   * 需求："至于 按键显示拆分，本来就要拆分啊，而且括号和括号里的内容
   *       根据是否是移动端可以不显示的，括号又不已改放进i18n"
   */
  describe('resolveRowTap：点一次格子该做什么', () => {
    it('改键中 → 绑到这个格子（触屏的第二步）', () => {
      expect(
        resolveRowTap({
          focusedSkillId: 'attack',
          capturingSkillId: 'attack',
          isTouch: true,
          touchedSkillId: 'dodge',
        }),
      ).toEqual({ kind: 'bind', skillId: 'dodge' });
    });

    it('触屏 + 点到**已选中**的格子 → 进改键（对等键盘 Enter）', () => {
      expect(
        resolveRowTap({
          focusedSkillId: 'attack',
          capturingSkillId: undefined,
          isTouch: true,
          touchedSkillId: 'attack',
        }),
      ).toEqual({ kind: 'capture' });
    });

    it('触屏 + 点到**别的**格子 → 只选中（不误进改键）', () => {
      expect(
        resolveRowTap({
          focusedSkillId: 'attack',
          capturingSkillId: undefined,
          isTouch: true,
          touchedSkillId: 'dodge',
        }),
      ).toEqual({ kind: 'focus' });
    });

    it('【关键】非触屏 + 点到已选中的格子 → 仍只选中', () => {
      /**
       * ⚠️ 鼠标上"再点一次进改键"会与"点=选中"的语义打架，
       * 而且鼠标本来就有键盘可用。所以**只在触屏**上启用。
       */
      expect(
        resolveRowTap({
          focusedSkillId: 'attack',
          capturingSkillId: undefined,
          isTouch: false,
          touchedSkillId: 'attack',
        }),
      ).toEqual({ kind: 'focus' });
    });
  });
});

describe('改键不能把技能"弄丢"（触屏上等于少一个按钮）', () => {
  /**
   * 一个键只能绑一个技能 → 改键必然顶掉旧占用者（`applyRebind` 的策略）。
   * 但**解绑在触屏上是致命的**：`touchButtonsFromBindings` 只取
   * `key !== ''` 的技能，所以被顶掉的技能会**从按钮上消失**。
   *
   * 实测踩到的：「攻」改到「避」的键后，「避」失去绑定 —— 而「避」是
   * 倒地（`restrictToTags: ['dodge']`）时**唯一能按的技能**，丢掉它
   * 等于倒地没有出路。
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

describe('触屏换位：必须真的改变**按钮顺序**', () => {
  /**
   * 需求（用户两次提出）："触屏依旧没有办法设置按键"、"选slot，再选技能
   * 就换slot"。
   *
   * ⚠️ 核心是换**位置**，不是换**键**。
   *
   * 触屏按钮的顺序 = 绑定表里"有键的技能"的顺序
   * （`touchButtonsFromBindings`：`filter(key !== '').map(index)`）。
   * 而 `applyRebind` **只换键、不动数组顺序** —— 所以换完按钮顺序
   * **一点变化都没有**，"选 slot 换 slot"是**假的**。
   * （我第一版就是这么接的，这条测试就是为它写的。）
   */
  const base = [
    { key: 'q', skillId: 'attack' },
    { key: 'w', skillId: 'blast' },
    { key: '', skillId: 'flash' },
    { key: 'r', skillId: 'break' },
  ];

  /** 按钮顺序 = 有键的技能，按绑定表顺序。 */
  const buttonOrder = (b: readonly { readonly key: string; readonly skillId: string }[]) =>
    b.filter((x) => x.key !== '').map((x) => x.skillId);

  it('换位后按钮顺序**确实变了**', () => {
    const before = buttonOrder(base);
    const after = buttonOrder(swapSlotSkills(base, 0, 1));
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
    expect(buttonOrder(after)).toEqual(['flash', 'blast', 'break']);
  });

  it('越界 / 同位置不改动（不产生脏数据）', () => {
    expect(swapSlotSkills(base, 0, 0)).toBe(base);
    expect(swapSlotSkills(base, 0, 99)).toBe(base);
    expect(swapSlotSkills(base, -1, 1)).toBe(base);
  });

  it('【对照】`applyRebind` **不能**用来做换位（它还丢一个按钮）', () => {
    /**
     * ⚠️ 这条是**反向证据**。实测比预期更糟：把 `attack` 改到 `w` 之后，
     * 位置 0 的 `q` **没人占**了 → 触屏按钮从 **3 个变成 2 个**
     * （`blast` 因为 `q` 空掉而不上场）。所以拿 `applyRebind` 做换位
     * 不只是"顺序不变"，还会**少一个按钮**。
     */
    const rebound = applyRebind(base, 'attack', 'w').bindings;
    expect(buttonOrder(rebound)).not.toEqual(buttonOrder(base));
    expect(buttonOrder(rebound)).toHaveLength(2);
    expect(buttonOrder(base)).toHaveLength(3);
  });
});
