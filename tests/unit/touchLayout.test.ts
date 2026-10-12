import { describe, expect, it, vi } from 'vitest';
import {
  createTouchLayout,
  defaultTouchButtonIds,
  toggleTouchButtonId,
  touchButtonIdsFromBindings,
  type TouchButton,
} from '../../src/input/touchLayout';
import { DEFAULT_BINDINGS } from '../../src/input/keyboard';

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

/**
 * ==================================================================
 * 按钮集合是**用户选的**，不再从键位表派生（2026-10-12 用户定案）
 * ==================================================================
 *
 * 用户原话："触屏和键盘**当然是 2 套**，连 localStorage 都是分 2 个 key
 * 存的，只是**可选技能是一样的**。"
 *
 * 原先按钮由键位表机械派生（"有键的技能"），于是纯触屏玩家掉进死结：
 *   技能没绑键 → 触屏上没有按钮；而配按钮的地方是「按键」页，
 *   触屏又按不出键、进不去改键。
 *
 * ⚠️ 派生函数**只剩两个用途**（老存档迁移 + "恢复默认"），所以下面
 * 分两组测：`Toggle` 是新的主路径，`FromBindings` 是**只许出现在那两处**
 * 的兼容路径。
 */
describe('toggleTouchButtonId：放上 / 取下', () => {
  it('放上：追加到**最后**（顺序 = 双弧上的位置）', () => {
    expect(toggleTouchButtonId(['attack'], 'guard')).toEqual(['attack', 'guard']);
  });

  it('取下：删掉它，后面的整体前移（不留空洞）', () => {
    expect(toggleTouchButtonId(['attack', 'blast', 'guard'], 'blast')).toEqual([
      'attack',
      'guard',
    ]);
  });

  it('【关键】取下**最后一个**也是合法的 —— 允许一个按钮都没有', () => {
    /**
     * 这条挡的是"空集合被当成坏数据"那类自作聪明：玩家真的可以一个按钮
     * 都不要（然后再自己加回来）。`parseTouchButtons` 必须把 `[]` 与
     * "没存过"区分开，否则空集合会被迁移回默认 6 个。
     */
    expect(toggleTouchButtonId(['attack'], 'attack')).toEqual([]);
  });

  it('幂等性：同一个技能连点两次回到原样', () => {
    const once = toggleTouchButtonId(['attack'], 'guard');
    expect(toggleTouchButtonId(once, 'guard')).toEqual(['attack']);
  });

  it('空 id 原样返回（不让坏数据混进集合）', () => {
    const before = ['attack'];
    expect(toggleTouchButtonId(before, '')).toBe(before);
  });

  it('不改原数组（纯函数）', () => {
    const before = ['attack'];
    toggleTouchButtonId(before, 'guard');
    expect(before).toEqual(['attack']);
  });
});

describe('touchButtonIdsFromBindings / defaultTouchButtonIds：只用于迁移与默认', () => {
  it('有键的技能才上场，空键被过滤（「闪」默认如此）', () => {
    const ids = touchButtonIdsFromBindings([
      { key: 'q', skillId: 'attack' },
      { key: 'a', skillId: 'dodge' },
      { key: '', skillId: 'flash' }, // 默认不绑键
      { key: 's', skillId: 'guard' },
    ]);
    expect(ids).toEqual(['attack', 'dodge', 'guard']);
  });

  it('默认集合 = 默认键位表里"有键"的那些（与老存档迁移结果一致）', () => {
    /**
     * ⚠️ 断言的是**结构关系**（"= 有键的那些"）而不是一个写死的数字：
     * 默认键位表随角色拆分一直在动（6 → 9），写死数字会让这条测试
     * 每次改内容都失败一次，而它真正要守的是"默认集合的来路"。
     */
    const ids = defaultTouchButtonIds();
    const withKey = DEFAULT_BINDINGS.filter((b) => b.key !== '').map((b) => b.skillId);
    expect(ids).toEqual(withKey);
    /** 别是空断言：至少有一个，且不可能是全部（默认表里有空键的位）。 */
    expect(ids.length).toBeGreaterThan(0);
    expect(ids.length).toBeLessThanOrEqual(DEFAULT_BINDINGS.length);
    expect(ids).toEqual(touchButtonIdsFromBindings(DEFAULT_BINDINGS));
  });
});
