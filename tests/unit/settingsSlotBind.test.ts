/**
 * **触屏键位的两步交互**：判定 + 存档往返 + 容量边界。
 *
 * ==================================================================
 * 这个文件防的是什么
 * ==================================================================
 *
 * 用户 2026-10-12 的规格（原话）：
 *
 * > "点键位 =》 点技能 =》 绑定这个技能到这个键位"
 *
 * 这条链上有三处**只有连起来测才看得出来**的东西：
 *
 *   1. **判定**：选中键位 → 点技能 → 绑 / 交换 / 取下（`slotActions`）
 *   2. **存档往返**：绑完写进 `raid.touchButtons.v1`，下次加载要**一字不差**
 *      地回到同样的**键位**（不是"同样的技能、位置漂了"）
 *   3. **容量**：双弧只放得下 7 个 —— 多出来的必须在**读存档**时截掉，
 *      否则就是"存得下、画不出"的幽灵数据
 */

import { describe, expect, it } from 'vitest';
import {
  assignSkillToSlot,
  clampToCapacity,
  clearSlot,
} from '../../src/input/touchLayout';
import { loadTouchButtons, parseTouchButtons, serializeTouchButtons } from '../../src/app/settingsStore';
import { resolveSlotBind, resolveSlotTap } from '../../src/ui/settings/slotActions';
import { TOUCH_BUTTON_CAPACITY } from '../../src/render/touchGeometry';

const POOL = new Set(['attack', 'blast', 'focus', 'guard', 'flash']);

describe('resolveSlotTap：点键位 = 选中 / 再点 = 取消选中', () => {
  it('没选中时 → 选中它', () => {
    expect(resolveSlotTap(undefined, 3)).toEqual({ kind: 'selectSlot', index: 3 });
    expect(resolveSlotTap(0, 3)).toEqual({ kind: 'selectSlot', index: 3 });
  });

  it('【关键】点的是**已选中**的那个 → 取消选中（不是清空内容）', () => {
    /**
     * ⚠️ 这条挡住"手指误触一下就把键位清空"：取消选中是**无损**的，
     * 清空有它自己的入口（点回那个键位上已有的技能）。
     */
    expect(resolveSlotTap(3, 3)).toEqual({ kind: 'deselectSlot' });
  });
});

describe('resolveSlotBind：选中键位之后点技能', () => {
  it('空键位 → 绑上去', () => {
    expect(resolveSlotBind(2, ['attack'], 'guard')).toEqual({
      kind: 'assignTouchSlot',
      slot: 2,
      skillId: 'guard',
    });
  });

  it('【关键】那个键位上**已经是**这个技能 → 取下（清空键位的唯一入口）', () => {
    expect(resolveSlotBind(1, ['attack', 'guard'], 'guard')).toEqual({
      kind: 'clearTouchSlot',
      slot: 1,
    });
  });

  it('技能在**别的**键位 → 仍然是 assign（交换在执行层做）', () => {
    expect(resolveSlotBind(2, ['attack'], 'attack')).toEqual({
      kind: 'assignTouchSlot',
      slot: 2,
      skillId: 'attack',
    });
  });
});

describe('绑定 → 存档 → 读回：**位置**一模一样', () => {
  it('【关键】空洞（空键位）能存能读 —— 位置不会漂', () => {
    /**
     * 这是"数组下标 = 键位号"这条约定的端到端判据：
     * 把「斩」放在**第 3 个**键位（下标 2）、「防」放在第 5 个（下标 4），
     * 中间的键位空着 —— 读回来必须还是这两个位置。
     */
    const slots = assignSkillToSlot(assignSkillToSlot([], 2, 'attack'), 4, 'guard');
    expect(slots).toEqual(['', '', 'attack', '', 'guard']);
    const raw = serializeTouchButtons(slots);
    expect(parseTouchButtons(raw, POOL)).toEqual(['', '', 'attack', '', 'guard']);
  });

  it('交换之后读回来也是交换后的样子（不是"技能对了、位置没换"）', () => {
    const before = ['attack', '', 'guard'];
    const after = assignSkillToSlot(before, 0, 'guard');
    expect(after).toEqual(['guard', '', 'attack']);
    expect(parseTouchButtons(serializeTouchButtons(after), POOL)).toEqual(['guard', '', 'attack']);
  });

  it('取下中间那个键位，**后面的不动**', () => {
    const before = ['attack', 'blast', 'guard'];
    const after = clearSlot(before, 1);
    expect(after).toEqual(['attack', '', 'guard']);
    expect(parseTouchButtons(serializeTouchButtons(after), POOL)).toEqual([
      'attack',
      '',
      'guard',
    ]);
  });
});

describe('容量是硬约束：双弧只放得下 7 个', () => {
  it('读存档时**截到容量**（多出来的是"存得下、画不出"的幽灵）', () => {
    const nine = ['a1', 'a2', 'a3', 'a4', 'a5', 'a6', 'a7', 'a8', 'a9'];
    const pool = new Set(nine);
    const load = loadTouchButtons(JSON.stringify(nine), pool, [], TOUCH_BUTTON_CAPACITY);
    expect(load.skillIds).toHaveLength(TOUCH_BUTTON_CAPACITY);
    expect(load.skillIds).toEqual(nine.slice(0, TOUCH_BUTTON_CAPACITY));
  });

  it('老存档迁移那条路也截（老的绑定表里可能有 9 个有键的技能）', () => {
    const legacy = ['a1', 'a2', 'a3', 'a4', 'a5', 'a6', 'a7', 'a8'];
    const pool = new Set(legacy);
    const load = loadTouchButtons(null, pool, legacy, TOUCH_BUTTON_CAPACITY);
    expect(load.migrated).toBe(true);
    expect(load.skillIds).toHaveLength(TOUCH_BUTTON_CAPACITY);
  });

  it('容量内的空槽不会被截没（截的是**尾部之外**的部分）', () => {
    const slots = clampToCapacity(['attack', '', 'guard'], TOUCH_BUTTON_CAPACITY);
    expect(slots).toEqual(['attack', '', 'guard']);
  });

  it('`[]` 与"没存过"仍然是两件事（截断不改变这条区分）', () => {
    expect(loadTouchButtons('[]', POOL, ['attack'], TOUCH_BUTTON_CAPACITY)).toEqual({
      skillIds: [],
      migrated: false,
    });
    expect(loadTouchButtons(null, POOL, ['attack'], TOUCH_BUTTON_CAPACITY)).toEqual({
      skillIds: ['attack'],
      migrated: true,
    });
  });
});
