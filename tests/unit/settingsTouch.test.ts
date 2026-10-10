import { describe, expect, it } from 'vitest';
import { applyRebind, resolveRowTap } from '../../src/ui/settings/logic';

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
