import { describe, expect, it, vi } from 'vitest';
import {
  assignSkillToSlot,
  clearSlot,
  createTouchLayout,
  defaultTouchButtonIds,
  slotsFromButtons,
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

  it('【关键】规范化：丢掉空技能，但**槽位号原样保留**（不再重新编号）', () => {
    /**
     * ⚠️ 这条是这一版的核心语义：`index` 是**槽位**，不是"第几个按钮"。
     *
     * 旧实现把 `5` / `12` 压成 `0` / `1` —— 那在"按钮集合 = 一份有序清单"
     * 时是对的，但用户要的是"点键位 → 点技能 → 绑到这个键位"：
     * 重新编号会让"第 6 个键位"悄悄变成"第 1 个"，玩家摆好的位置白摆。
     */
    const layout = createTouchLayout();
    layout.set([
      { index: 5, skillId: 'attack' },
      { index: 9, skillId: '' },
      { index: 12, skillId: 'guard' },
    ]);
    expect(layout.current()).toEqual([
      { index: 5, skillId: 'attack' },
      { index: 12, skillId: 'guard' },
    ]);
  });

  it('槽位号不是非负整数 → 丢掉那一条（坏数据不进布局）', () => {
    const layout = createTouchLayout();
    layout.set([
      { index: -1, skillId: 'attack' },
      { index: 1.5, skillId: 'blast' },
      { index: 2, skillId: 'guard' },
    ]);
    expect(layout.current()).toEqual([{ index: 2, skillId: 'guard' }]);
  });

  it('同一个槽位给了两个技能 → 保留先出现的', () => {
    const layout = createTouchLayout();
    layout.set([
      { index: 3, skillId: 'attack' },
      { index: 3, skillId: 'guard' },
    ]);
    expect(layout.current()).toEqual([{ index: 3, skillId: 'attack' }]);
  });

  it('slotsFromButtons：把槽位号还原成"下标 = 槽位"的表（空洞补空串）', () => {
    /**
     * ⚠️ 渲染层（`TouchButtonLayer.setButtons`）拿下标当槽位号 ——
     * 少了这一步转换，`[{index:3}]` 会被画到第 1 个位置上，
     * 而设置页的预览仍然显示第 4 个（两份真相）。
     */
    expect(slotsFromButtons([{ index: 3, skillId: 'attack' }])).toEqual([
      '',
      '',
      '',
      'attack',
    ]);
    expect(slotsFromButtons([])).toEqual([]);
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
 * 触屏键位是**用户自己选的**（两步交互），不再从键位表派生
 * ==================================================================
 *
 * 用户原话："触屏和键盘**当然是 2 套**，连 localStorage 都是分 2 个 key
 * 存的，只是**可选技能是一样的**。"
 *
 * 交互（用户 2026-10-12）："点键位 =》 点技能 =》 绑定这个技能到这个键位"，
 * 所以这一组操作是**按槽位**的：
 *
 *   `assignSkillToSlot(slots, slot, skillId)`  绑上去（交换 / 顶掉）
 *   `clearSlot(slots, slot)`                   清空那个键位
 *
 * ⚠️ 与旧的 `toggleTouchButtonId`（"放上 / 取下"，顺序即位置）是**两回事**：
 * 旧的那套里"清掉中间一个"会让后面的**整体前移**，玩家摆好的位置就错了。
 */
describe('assignSkillToSlot：把技能绑到某个键位（槽位是固定的格子）', () => {
  it('绑到空键位：中间的空洞**留着**（后面那个技能不会前移）', () => {
    expect(assignSkillToSlot(['attack', ''], 2, 'guard')).toEqual(['attack', '', 'guard']);
  });

  it('绑到**更靠后**的空键位：中间补空槽（不是压缩）', () => {
    expect(assignSkillToSlot([], 4, 'attack')).toEqual(['', '', '', '', 'attack']);
  });

  it('键位上原来有技能 → 被**顶掉**（它不再是触屏按钮）', () => {
    expect(assignSkillToSlot(['attack', 'blast'], 0, 'guard')).toEqual(['guard', 'blast']);
  });

  it('【关键】技能已经在**别的**键位 → 两边**交换**（谁都不消失）', () => {
    expect(assignSkillToSlot(['attack', '', 'guard'], 0, 'guard')).toEqual([
      'guard',
      '',
      'attack',
    ]);
  });

  it('交换时**中间的空洞不动**（换的是两个槽位的内容）', () => {
    expect(assignSkillToSlot(['a', '', 'b', 'c'], 3, 'a')).toEqual(['c', '', 'b', 'a']);
  });

  it('绑到它已经占着的键位 → 内容不变（**取下**由判定层决定，见 slotActions）', () => {
    const before = ['attack', 'guard'];
    expect(assignSkillToSlot(before, 1, 'guard')).toEqual(before);
  });

  it('空 id / 非法槽位 → 原样返回（坏数据不进槽位）', () => {
    const before = ['attack'];
    expect(assignSkillToSlot(before, 0, '')).toBe(before);
    expect(assignSkillToSlot(before, -1, 'guard')).toBe(before);
    expect(assignSkillToSlot(before, 1.5, 'guard')).toBe(before);
  });

  it('末尾的空槽不存（带空尾的表绑完会收敛）', () => {
    expect(assignSkillToSlot(['attack', '', ''], 0, 'attack')).toEqual(['attack']);
  });

  it('不改原数组（纯函数）', () => {
    const before = ['attack'];
    assignSkillToSlot(before, 2, 'guard');
    expect(before).toEqual(['attack']);
  });
});

describe('clearSlot：清空某个键位', () => {
  it('清掉中间那个，**后面不动**（这正是"槽位"与"清单"的区别）', () => {
    expect(clearSlot(['attack', 'blast', 'guard'], 1)).toEqual(['attack', '', 'guard']);
  });

  it('清掉最后一个 → 末尾空槽被裁掉', () => {
    expect(clearSlot(['attack', 'blast'], 1)).toEqual(['attack']);
  });

  it('清空不存在的键位 → 原样返回（不补出一串空槽）', () => {
    const before = ['attack'];
    expect(clearSlot(before, 3)).toBe(before);
    expect(clearSlot(before, -1)).toBe(before);
  });

  it('已经很空的键位 → 原样返回', () => {
    const before = ['attack', '', 'guard'];
    expect(clearSlot(before, 1)).toBe(before);
  });

  it('全清之后就回到 `[]`（= 玩家明确一个按钮都不要）', () => {
    expect(clearSlot(['attack'], 0)).toEqual([]);
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

  it('默认键位表 = 默认绑定表里"有键"的那些，**截到容量**', () => {
    /**
     * ⚠️ 断言的是**结构关系**（"= 有键的那些"）而不是一个写死的数字：
     * 默认键位表随角色拆分一直在动（6 → 9），写死数字会让这条测试
     * 每次改内容都失败一次，而它真正要守的是"默认键位表的来路"。
     *
     * ⚠️ 但**容量是一个真实的约束**：双弧只放得下 7 个
     * （`TOUCH_BUTTON_CAPACITY`，3 内弧 + 4 外弧）。默认绑定表里有 9 个
     * 有键的技能 —— 全放上去的话，后两个会"存得下、画不出"。
     */
    const capacity = 7;
    const ids = defaultTouchButtonIds(capacity);
    const withKey = touchButtonIdsFromBindings(DEFAULT_BINDINGS);
    expect(ids).toEqual(withKey.slice(0, capacity));
    /** 别是空断言：至少有一个，且不可能是全部（默认表里有空键的位）。 */
    expect(ids.length).toBeGreaterThan(0);
    expect(ids.length).toBeLessThanOrEqual(DEFAULT_BINDINGS.length);
    /**
     * ⚠️ 超过容量的部分**必须**被截掉：这条是"幽灵按钮"那一类 bug 的
     * 唯一机器判据（`touchButtonCenter` 对越界返回 `undefined`，
     * 于是它们既画不出、也不会报错）。
     */
    expect(ids.length).toBeLessThanOrEqual(capacity);
  });
});
