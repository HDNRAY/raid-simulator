import { describe, expect, it } from 'vitest';
import {
  cycleQijiStack,
  freeQijiChoices,
  hitTestPrepare,
  moveFocus,
  stackCapOf,
  stacksIn,
  unstackQiji,
  type PrepareSelection,
} from '../../src/ui/prepareLogic';
import { prepareHitAreas } from '../../src/ui/prepareGeometry';

/**
 * ==================================================================
 * 自由模式：**激活任意个炁机**（2026-10-13 需求）
 * ==================================================================
 *
 * 用户原话："选了人之后，可以**激活任意个他的炁机**"。
 *
 * ⚠️ 这一份钉的是**语义**，不是界面：
 *   - "任意个"= 条数不限（8 条想开几条开几条）
 *   - 但每条自己的**层数**仍认 `maxStacks`（与肉鸽**同一个字段**，
 *     不许在自由模式里另立一套"无限叠"的规则 —— 那会让同一个字段
 *     有两种含义，而漂移不报错、只让数值对不上）
 *   - 到顶之后再点 = **归零**（不是"没反应"：层数画在卡上，归零是
 *     看得见的下一步）
 */

const players = [{ id: 'player' }, { id: 'kaili' }];
const bosses = [{ id: 'meiichiro' }];
const qiji = [
  { id: 'vitality' }, // maxStacks 3
  { id: 'breath' }, // maxStacks 2
  { id: 'jieShengJi' }, // 无 maxStacks → 1
];

const sel = (over: Partial<PrepareSelection> = {}): PrepareSelection => ({
  playerId: 'player',
  bossId: 'meiichiro',
  focus: 'qiji',
  /** 手风琴：焦点在炁机行 → 炁机那一块展开（见 `prepareLogic.withFocus`）。 */
  expanded: 'qiji',
  cursor: { playerId: 'player', bossId: 'meiichiro', qijiId: 'vitality' },
  ...over,
});

describe('炁机层数：上限来自内容表的 `maxStacks`（缺省 1）', () => {
  it('缺省 1；给了就用给的；非法值夹到 >= 1', () => {
    expect(stackCapOf(undefined)).toBe(1);
    expect(stackCapOf(3)).toBe(3);
    expect(stackCapOf(2.7)).toBe(2);
    expect(stackCapOf(0)).toBe(1);
    expect(stackCapOf(-5)).toBe(1);
    expect(stackCapOf(Number.NaN)).toBe(1);
  });

  it('点一次叠一层、到顶之后**归零**', () => {
    let free = {};
    for (const [step, expected] of [
      [1, 1],
      [2, 2],
      [3, 3],
      [4, 0],
      [5, 1],
    ] as const) {
      const next = cycleQijiStack(free, 'vitality', 3);
      free = next.free;
      expect(next.stacks, `第 ${step} 次`).toBe(expected);
    }
  });

  it('无 `maxStacks` 的炁机**只能一层**（再点归零）', () => {
    let free = {};
    free = cycleQijiStack(free, 'jieShengJi', undefined).free;
    expect(stacksIn(free, 'jieShengJi')).toBe(1);
    const again = cycleQijiStack(free, 'jieShengJi', undefined);
    expect(again.stacks).toBe(0);
    expect(stacksIn(again.free, 'jieShengJi')).toBe(0);
  });

  it('归零 = **删掉那个键**（不留 `{ id: 0 }` 这种第二份"没开"的表达）', () => {
    const one = cycleQijiStack({}, 'breath', 2).free;
    expect(Object.keys(one)).toEqual(['breath']);
    /** `breath` 的上限是 2，再点一次就到顶归零。 */
    const two = cycleQijiStack(one, 'breath', 2).free;
    expect(two).toEqual({ breath: 2 });
    const zero = cycleQijiStack(two, 'breath', 2).free;
    expect(zero).toEqual({});
    expect('breath' in zero).toBe(false);
  });

  it('退一层：到 0 就停（不会绕回上限）', () => {
    const three = { vitality: 3 };
    expect(stacksIn(unstackQiji(three, 'vitality').free, 'vitality')).toBe(2);
    const zero = { vitality: 0 };
    expect(unstackQiji({}, 'vitality').free).toEqual({});
    expect(unstackQiji(zero, 'vitality').free).toEqual({ vitality: 0 });
  });

  it('【关键】多条可以同时开着（"任意个"的落点）', () => {
    let free = {};
    free = cycleQijiStack(free, 'vitality', 3).free;
    free = cycleQijiStack(free, 'breath', 2).free;
    free = cycleQijiStack(free, 'breath', 2).free;
    free = cycleQijiStack(free, 'jieShengJi', undefined).free;
    expect(free).toEqual({ vitality: 1, breath: 2, jieShengJi: 1 });
  });

  it('没变化时返回**同一个对象**（调用方据此跳过写存储）', () => {
    const free = {};
    expect(unstackQiji(free, 'vitality').free).toBe(free);
  });
});

describe('层数表 → `buildPlayerKit` 的形状（自由模式唯一的翻译点）', () => {
  it('按**内容表顺序**排，且只留开着的', () => {
    const choices = freeQijiChoices({ breath: 2, vitality: 1 }, qiji);
    expect(choices).toEqual([
      { qijiId: 'vitality', stacks: 1 },
      { qijiId: 'breath', stacks: 2 },
    ]);
  });

  it('【关键】顺序**不按对象键的插入顺序**（黄金截图 / 断言要能复现同一份修正列表）', () => {
    /** 插入顺序反过来，产物必须一样。 */
    const a = freeQijiChoices({ vitality: 1, breath: 2 }, qiji);
    const b = freeQijiChoices({ breath: 2, vitality: 1 }, qiji);
    expect(a).toEqual(b);
  });

  it('不认识的 id 被丢掉（内容改名之后的陈旧存档）', () => {
    expect(freeQijiChoices({ ghost: 3, vitality: 1 }, qiji)).toEqual([
      { qijiId: 'vitality', stacks: 1 },
    ]);
  });
});

describe('焦点顺序：人物 → 炁机 → 对手 → 开始', () => {
  const opts = { players, bosses, qiji };

  it('往下走是 人物 → 炁机 → 对手 → 开始', () => {
    expect(moveFocus(sel({ focus: 'player' }), 1, opts).focus).toBe('qiji');
    expect(moveFocus(sel({ focus: 'qiji' }), 1, opts).focus).toBe('boss');
    expect(moveFocus(sel({ focus: 'boss' }), 1, opts).focus).toBe('start');
  });

  it('往回走是 开始 → 对手 → 炁机 → 人物', () => {
    expect(moveFocus(sel({ focus: 'start' }), -1, opts).focus).toBe('boss');
    expect(moveFocus(sel({ focus: 'boss' }), -1, opts).focus).toBe('qiji');
    expect(moveFocus(sel({ focus: 'qiji' }), -1, opts).focus).toBe('player');
  });

  it('【关键】没有炁机时那一格被**跳过**（否则光标会落进一个空行）', () => {
    const none = { players, bosses, qiji: [] };
    expect(moveFocus(sel({ focus: 'player' }), 1, none).focus).toBe('boss');
  });
});

describe('点击命中：炁机卡也能被点中（触屏靠它）', () => {
  it('点在炁机卡正中间 → 命中那一条', () => {
    /**
     * ⚠️ 坐标从 **`prepareHitAreas`** 取（与渲染共用同一份几何）——
     * 自己按 `qijiRowY` 再算一遍就会在"行顶是推导出来的"这件事上错位。
     */
    /**
     * ⚠️ 炁机卡只画在**炁机那一块展开**的时候（手风琴）—— 所以这里显式
     * 传 `expanded = 'qiji'`（与 `sel()` 那个状态一致）。
     */
    const area = prepareHitAreas(players, bosses, qiji, 'qiji').find(
      (a) => a.kind === 'qiji' && a.id === 'breath',
    );
    expect(area).toBeDefined();
    const hit = hitTestPrepare(
      area!.x + area!.w / 2,
      area!.y + area!.h / 2,
      players,
      bosses,
      qiji,
      'qiji',
    );
    expect(hit).toEqual({ kind: 'qiji', id: 'breath' });
  });

  it('点在空白处 → 什么都不命中', () => {
    expect(hitTestPrepare(2, 2, players, bosses, qiji, 'qiji')).toBeUndefined();
  });
});
