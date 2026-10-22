import { describe, expect, it } from 'vitest';
import { createSelectionState, selectedIdOf } from '../../src/ui/selection';

/**
 * 选中模型（2026-10-22）：**hover 与键盘光标是同一件事、一个框**。
 * 判据：`keyboardActive ? cursor : (pointerInside ? hovered : cursor)`。
 */
describe('selectedIdOf：三个事实的四种组合', () => {
  it('键盘接管 ⇒ 听光标（哪怕指针正停在别处）', () => {
    expect(
      selectedIdOf({ hovered: 'a', pointerInside: true, keyboardActive: true, cursor: 'b' }),
    ).toBe('b');
  });

  it('指针在画面里 ⇒ 听指针（含"停在空白 ⇒ 谁都不选"）', () => {
    expect(
      selectedIdOf({ hovered: 'a', pointerInside: true, keyboardActive: false, cursor: 'b' }),
    ).toBe('a');
    expect(
      selectedIdOf({ hovered: undefined, pointerInside: true, keyboardActive: false, cursor: 'b' }),
    ).toBeUndefined();
  });

  it('指针不在画面里 ⇒ 回落到光标（移开鼠标不该让框消失）', () => {
    expect(
      selectedIdOf({ hovered: undefined, pointerInside: false, keyboardActive: false, cursor: 'b' }),
    ).toBe('b');
  });

  it('什么都没有 ⇒ undefined', () => {
    expect(
      selectedIdOf({ hovered: undefined, pointerInside: false, keyboardActive: false, cursor: undefined }),
    ).toBeUndefined();
  });
});

describe('createSelectionState：操作序列', () => {
  it('hover A → 键盘右移 → 指针离开：选中依次是 A / B / B', () => {
    const s = createSelectionState('a');
    s.hover('a');
    expect(s.selected()).toBe('a');
    s.keyboardMove('b');
    /** 键盘一动 ⇒ 指针的 a 不再算数 ✓ */
    expect(s.selected()).toBe('b');
    s.leave();
    /** 指针离开 ⇒ 保持光标那一项（不消失）✓ */
    expect(s.selected()).toBe('b');
  });

  it('键盘先动、指针随后划过 ⇒ 以指针为准（键盘接管结束）', () => {
    const s = createSelectionState('a');
    s.keyboardMove('a');
    expect(s.selected()).toBe('a');
    s.hover('c');
    expect(s.selected()).toBe('c');
    expect(s.facts().keyboardActive).toBe(false);
  });

  it('指针停在空白 ⇒ 没有选中；键盘再动一次 ⇒ 又听光标', () => {
    const s = createSelectionState('a');
    s.hover('a');
    s.hover(undefined);
    expect(s.selected()).toBeUndefined();
    s.keyboardMove('a');
    expect(s.selected()).toBe('a');
  });

  it('光标被移除（比如那一项消失了）⇒ 选中变 undefined，不抛错', () => {
    const s = createSelectionState('a');
    s.keyboardMove(undefined);
    expect(s.selected()).toBeUndefined();
  });
});
