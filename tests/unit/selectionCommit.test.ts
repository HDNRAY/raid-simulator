import { describe, expect, it } from 'vitest';
import { createSelectionState, focusedIdOf } from '../../src/ui/selection';

/**
 * **焦点 ≠ 已选**（2026-10-22，用户："自由模式里角色和 boss 的 hover 和选择
 * 又绑定在一起了 ··· 白框和黄底都由 hover 决定了"）。
 *
 * | 视觉 | 含义 | 谁改它 |
 * |---|---|---|
 * | 白框 | 焦点 | hover / 键盘 |
 * | 黄底 | 已选 | **只有** `commit()`（点击 / Enter）|
 */
describe('焦点与已选分开', () => {
  it('focus → hover 另一项 → commit：白框跟指针、黄底只在 commit 时变', () => {
    const s = createSelectionState('a');
    /** ① 初始：白框与黄底都在 a */
    expect(s.selected()).toBe('a');
    expect(s.committed()).toBe('a');

    /** ② hover 到 b ⇒ **白框到 b、黄底仍在 a** ✗（这就是那个 bug） */
    s.hover('b');
    expect(s.selected()).toBe('b');
    expect(s.committed()).toBe('a');

    /** ③ commit ⇒ 黄底才跟到 b */
    s.commit();
    expect(s.selected()).toBe('b');
    expect(s.committed()).toBe('b');
  });

  it('键盘移动也只动白框（不提交）', () => {
    const s = createSelectionState('a');
    s.keyboardMove('c');
    expect(s.selected()).toBe('c');
    expect(s.committed()).toBe('a');
  });

  it('focusedIdOf 与旧名 selectedIdOf 同义（别名）', () => {
    const facts = { hovered: 'x', pointerInside: true, keyboardActive: false, cursor: 'y' };
    expect(focusedIdOf(facts)).toBe('x');
  });
});
