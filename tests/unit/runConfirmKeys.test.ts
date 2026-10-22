import { describe, expect, it } from 'vitest';
import { routeRunConfirmKey } from '../../src/app/runConfirmKeys';

/**
 * 确认屏的键路由（2026-10-22 从 `loopWiring` 切出来）。
 *
 * ⚠️ `← →` 在这一屏**只**服务于"炁机块内切换" —— 别改成"切站"
 * （那是 Tab / ↑↓ 的活）。
 */
function makeHost(): {
  readonly calls: string[];
  readonly host: {
    moveFocus(delta: number): void;
    scrollDetail(dir: 'up' | 'down'): void;
    cycleQiji(delta: number): void;
    confirm(): void;
  };
} {
  const calls: string[] = [];
  return {
    calls,
    host: {
      moveFocus: (delta) => calls.push(`move:${String(delta)}`),
      scrollDetail: (dir) => calls.push(`scroll:${dir}`),
      cycleQiji: (delta) => calls.push(`cycle:${String(delta)}`),
      confirm: () => calls.push('confirm'),
    },
  };
}

describe('确认屏键路由', () => {
  it('Tab / Shift+Tab 走焦点，↑↓ 也走焦点', () => {
    const { calls, host } = makeHost();
    routeRunConfirmKey({ key: 'Tab', shiftKey: false, host });
    routeRunConfirmKey({ key: 'Tab', shiftKey: true, host });
    routeRunConfirmKey({ key: 'ArrowDown', shiftKey: false, host });
    routeRunConfirmKey({ key: 'ArrowUp', shiftKey: false, host });
    expect(calls).toEqual(['move:1', 'move:-1', 'move:1', 'move:-1']);
  });

  it('Shift + ↑↓ 滚正文（不切焦点）', () => {
    const { calls, host } = makeHost();
    routeRunConfirmKey({ key: 'ArrowUp', shiftKey: true, host });
    routeRunConfirmKey({ key: 'ArrowDown', shiftKey: true, host });
    expect(calls).toEqual(['scroll:up', 'scroll:down']);
  });

  it('← → 切换炁机（不切站、不滚正文）', () => {
    const { calls, host } = makeHost();
    routeRunConfirmKey({ key: 'ArrowLeft', shiftKey: false, host });
    routeRunConfirmKey({ key: 'ArrowRight', shiftKey: false, host });
    expect(calls).toEqual(['cycle:-1', 'cycle:1']);
  });

  it('Enter / Space 确认；其它键不消费', () => {
    const { calls, host } = makeHost();
    expect(routeRunConfirmKey({ key: 'Enter', shiftKey: false, host })).toBe(true);
    expect(routeRunConfirmKey({ key: ' ', shiftKey: false, host })).toBe(true);
    expect(routeRunConfirmKey({ key: 'a', shiftKey: false, host })).toBe(false);
    expect(calls).toEqual(['confirm', 'confirm']);
  });
});
