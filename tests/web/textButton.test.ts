import { Container, Graphics, Sprite, Text } from 'pixi.js';
import { describe, expect, it, vi } from 'vitest';

import { TextButton, type TextButtonOptions } from '../../src/ui/TextButton';

/**
 * **共用文字按钮**（2026-10-22）。
 *
 * 用户："这个按钮和其他界面的其他按钮**风格保持一致**，如果没有抽出来做
 * 单独的组件，现在抽" ⇒ 这里钉的是组件承诺的三件事：
 *
 *   1. **几何只有一份**：渲染与命中共用 `bounds`
 *   2. **禁用仍占位**：`contains` 照样命中，但 `press` 不触发
 *   3. **键位提示由组件拼**：`标签 (键名)`，键名不进 i18n（AGENTS §3b）
 *
 * ⚠️ 放在 `tests/web/`（jsdom + 真 pixi）：组件真的会造 `Label`，而
 * `tests/unit/` 那个 project 是 **node 环境、零 DOM**，造不出来。
 */
const PIXI = { Container, Graphics, Sprite, Text };

const RECT = { x: 100, y: 200, w: 160, h: 40 };

function make(overrides: Partial<TextButtonOptions> = {}): {
  readonly button: TextButton;
  readonly onPress: ReturnType<typeof vi.fn>;
} {
  const onPress = vi.fn();
  const button = new TextButton({
    pixi: PIXI,
    rect: RECT,
    label: '开始游戏',
    onPress,
    ...overrides,
  });
  return { button, onPress };
}

/** 组件当前**显示**的文字（直接从它的 Label 读，不信内部字段）。 */
function shownText(button: TextButton): string {
  const found: string[] = [];
  const walk = (node: unknown): void => {
    const maybe = node as { text?: string; children?: readonly unknown[] };
    if (typeof maybe.text === 'string') found.push(maybe.text);
    for (const child of maybe.children ?? []) walk(child);
  };
  walk(button.root);
  return found.join('|');
}

describe('TextButton：几何只有一份（渲染与命中共用 bounds）', () => {
  it('`bounds` = 构造时的矩形，`contains` 按它判命中（含边界）', () => {
    const { button } = make();
    expect(button.bounds).toEqual(RECT);
    expect(button.contains(RECT.x, RECT.y)).toBe(true);
    expect(button.contains(RECT.x + RECT.w, RECT.y + RECT.h)).toBe(true);
    expect(button.contains(RECT.x - 1, RECT.y)).toBe(false);
    expect(button.contains(RECT.x, RECT.y + RECT.h + 1)).toBe(false);
  });

  it('`setRect` 之后命中跟着换（不是缓存的旧矩形）', () => {
    const { button } = make();
    button.setRect({ x: 0, y: 0, w: 10, h: 10 });
    expect(button.bounds).toEqual({ x: 0, y: 0, w: 10, h: 10 });
    expect(button.contains(5, 5)).toBe(true);
    expect(button.contains(RECT.x, RECT.y)).toBe(false);
  });
});

describe('TextButton：禁用仍占位，但按下去不做事', () => {
  it('禁用时 `contains` 仍然命中，`press` 返回 false 且不触发回调', () => {
    const { button, onPress } = make();
    button.setEnabled(false);
    expect(button.isEnabled).toBe(false);
    expect(button.contains(RECT.x + 1, RECT.y + 1)).toBe(true);
    expect(button.press(RECT.x + 1, RECT.y + 1)).toBe(false);
    expect(onPress).not.toHaveBeenCalled();
  });

  it('可用时 press 触发一次；点空返回 false 且不触发', () => {
    const { button, onPress } = make();
    expect(button.press(RECT.x + 1, RECT.y + 1)).toBe(true);
    expect(onPress).toHaveBeenCalledTimes(1);
    expect(button.press(9999, 9999)).toBe(false);
    expect(onPress).toHaveBeenCalledTimes(1);
  });
});

describe('TextButton：键位提示由组件拼（键名不进 i18n）', () => {
  it('给了键名 ⇒ 「开始游戏 (Enter)」；不给 ⇒ 只有标签', () => {
    const withKey = make({ keyHint: 'Enter' });
    expect(shownText(withKey.button)).toContain('开始游戏 (Enter)');

    const noKey = make();
    expect(shownText(noKey.button)).toContain('开始游戏');
    expect(shownText(noKey.button)).not.toContain('(');
  });

  it('换标签会保留键位提示（重新拼接），换键名也重新拼', () => {
    const { button } = make({ keyHint: 'Enter' });
    button.setLabel('继续游戏');
    expect(shownText(button)).toContain('继续游戏 (Enter)');
    button.setKeyHint('M');
    expect(shownText(button)).toContain('继续游戏 (M)');
    button.setKeyHint(undefined);
    expect(shownText(button)).toContain('继续游戏');
  });
});
