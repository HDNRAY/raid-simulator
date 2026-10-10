import { describe, expect, it, vi } from 'vitest';
import {
  createTouchLayout,
  touchButtonsFromBindings,
  type TouchButton,
} from '../../src/input/touchLayout';

/** 有名字的构造器：把"构造好的按钮表"写在名字上（AGENTS.md §1）。 */
const buttons = (...skillIds: readonly string[]): readonly TouchButton[] =>
  skillIds.map((skillId, index) => ({ index, skillId }));

describe('TouchLayout：唯一真相 + 监听', () => {
  it('订阅时**立刻**收到当前值（避免"先读后订阅"的竞态）', () => {
    const layout = createTouchLayout(buttons('attack', 'blast'));
    const seen: string[][] = [];
    layout.subscribe((b) => seen.push(b.map((x) => x.skillId)));
    expect(seen).toEqual([['attack', 'blast']]);
  });

  it('set() 之后所有订阅者都收到新值', () => {
    const layout = createTouchLayout();
    const a = vi.fn();
    const b = vi.fn();
    layout.subscribe(a);
    layout.subscribe(b);
    a.mockClear();
    b.mockClear();

    layout.set(buttons('attack', 'guard'));
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);
    expect(a.mock.calls[0]?.[0]?.map((x: TouchButton) => x.skillId)).toEqual([
      'attack',
      'guard',
    ]);
  });

  it('【关键】内容没变就**不通知**（避免无意义的重绘与重绑）', () => {
    const layout = createTouchLayout(buttons('attack'));
    const listener = vi.fn();
    layout.subscribe(listener);
    listener.mockClear();

    // 等价内容（新数组、同样内容）不该触发
    layout.set(buttons('attack'));
    expect(listener).not.toHaveBeenCalled();

    // 真的变了才触发
    layout.set(buttons('attack', 'blast'));
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('取消订阅后不再收到通知', () => {
    const layout = createTouchLayout();
    const listener = vi.fn();
    const off = layout.subscribe(listener);
    listener.mockClear();
    off();
    layout.set(buttons('attack'));
    expect(listener).not.toHaveBeenCalled();
  });

  it('规范化：丢掉空技能、按顺序重编号（不留空洞）', () => {
    const layout = createTouchLayout();
    // 故意给带空洞的 index 与一个空技能
    layout.set([
      { index: 5, skillId: 'attack' },
      { index: 9, skillId: '' },
      { index: 12, skillId: 'guard' },
    ]);
    expect(layout.current()).toEqual([
      { index: 0, skillId: 'attack' },
      { index: 1, skillId: 'guard' },
    ]);
  });

  it('current() 返回的是只读快照，外部改动不影响内部', () => {
    const layout = createTouchLayout(buttons('attack'));
    const snapshot = layout.current();
    expect(snapshot).toHaveLength(1);
    layout.set(buttons('attack', 'blast'));
    expect(snapshot).toHaveLength(1); // 旧快照不被改动
  });
});

describe('touchButtonsFromBindings：与桌面技能格同一条路', () => {
  it('有键的技能才上场，空键被过滤（「闪」默认如此）', () => {
    const result = touchButtonsFromBindings([
      { key: 'q', skillId: 'attack' },
      { key: 'a', skillId: 'dodge' },
      { key: '', skillId: 'flash' }, // 默认不绑键
      { key: 's', skillId: 'guard' },
    ]);
    expect(result.map((b) => b.skillId)).toEqual(['attack', 'dodge', 'guard']);
    expect(result.map((b) => b.index)).toEqual([0, 1, 2]);
  });

  it('默认键位表给出 6 个按钮（攻/轰/凝/破/避/防）', () => {
    const result = touchButtonsFromBindings([
      { key: 'q', skillId: 'attack' },
      { key: 'w', skillId: 'blast' },
      { key: 'e', skillId: 'focus' },
      { key: 'r', skillId: 'break' },
      { key: 'a', skillId: 'dodge' },
      { key: 's', skillId: 'guard' },
      { key: '', skillId: 'flash' },
    ]);
    expect(result).toHaveLength(6);
  });
});
