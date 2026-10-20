import { describe, expect, it } from 'vitest';
import {
  HOME_ACTIONS,
  HOME_LAYOUT,
  createHomeState,
  homeActionAt,
  homeActionAtPoint,
  homeHitAreas,
  moveHomeCursor,
} from '../../src/ui/homeLogic';

/**
 * 首页的纯逻辑。
 *
 * 需求（用户 2026-10-12 定的流程）："有一个**新的首页**，首页可以选进入
 * 肉鸽模式，或者自由" + "默认入口：首页"。
 *
 * ⚠️ 这些用例之所以能写，是因为光标与命中几何**被抽出了 Pixi 类**
 * （`homeLogic.ts`）—— 留在 `HomeScreen` 里就只能写"能构造、不报错"
 * 的冒烟测试，而那对"点了按钮没反应 / 点错按钮"这类 bug 一点用都没有。
 */
describe('首页入口：顺序与命中区域', () => {
  it('两个入口顺序固定（肉鸽在前 —— 它是主推的那条路）', () => {
    /**
   * ⚠️ 2026-10-20 加了第三个入口「图鉴」—— 它排在**最后**（前两个是玩法，
   * 它只是"看内容"）。
   */
  expect(HOME_ACTIONS).toEqual(['roguelike', 'free', 'codex']);
  });

  it('命中区域顺序与入口一致，且水平居中', () => {
    const areas = homeHitAreas();
    expect(areas.map((a) => a.action)).toEqual(['roguelike', 'free', 'codex']);
    for (const area of areas) {
      expect(area.x + area.w / 2).toBeCloseTo(HOME_LAYOUT.width / 2, 0);
    }
  });

  it('两个按钮**不重叠**、且都在屏幕内', () => {
    const [first, second] = homeHitAreas();
    expect(first).toBeDefined();
    expect(second).toBeDefined();
    if (first === undefined || second === undefined) return;
    expect(second.y).toBeGreaterThanOrEqual(first.y + first.h);
    expect(first.y).toBeGreaterThan(0);
    expect(second.y + second.h).toBeLessThan(HOME_LAYOUT.hintY);
  });

  it('命中测试落在按钮内部 → 命中对应入口', () => {
    for (const area of homeHitAreas()) {
      const cx = area.x + area.w / 2;
      const cy = area.y + area.h / 2;
      expect(homeActionAtPoint(cx, cy)).toBe(area.action);
    }
  });

  it('按钮之外（空白 / 标题行）→ 什么都不命中', () => {
    expect(homeActionAtPoint(HOME_LAYOUT.width / 2, HOME_LAYOUT.titleY)).toBeUndefined();
    expect(homeActionAtPoint(2, 2)).toBeUndefined();
    /** 两个按钮之间的间隙：正好落在边界外也不算命中（严格包含）。 */
    const [first] = homeHitAreas();
    if (first === undefined) return;
    expect(homeActionAtPoint(first.x - 1, first.y + first.h / 2)).toBeUndefined();
  });
});

describe('首页光标：上下移动（两端停住；Tab 环绕）', () => {
  it('初始光标在**第一个**入口（肉鸽模式）上', () => {
    expect(createHomeState()).toEqual({ cursor: 0 });
    expect(homeActionAt(createHomeState())).toBe('roguelike');
  });

  it('向下移动一格', () => {
    expect(moveHomeCursor({ cursor: 0 }, 1)).toEqual({ cursor: 1 });
  });

  it('两端**停住**（不环绕）—— 环绕会让"按了没反应"被当成按键失效', () => {
    expect(moveHomeCursor({ cursor: 0 }, -1)).toEqual({ cursor: 0 });
    const last = HOME_ACTIONS.length - 1;
    expect(moveHomeCursor({ cursor: last }, 1)).toEqual({ cursor: last });
  });

  it('Tab（wrap）在两端**环绕**', () => {
    expect(moveHomeCursor({ cursor: HOME_ACTIONS.length - 1 }, 1, true)).toEqual({ cursor: 0 });
    /** ⚠️ 从第一个往回环绕 = 落到**最后一个**（2026-10-20 起是「图鉴」）。 */
    expect(moveHomeCursor({ cursor: 0 }, -1, true)).toEqual({ cursor: HOME_ACTIONS.length - 1 });
  });

  it('delta 只取符号（一步一格）', () => {
    expect(moveHomeCursor({ cursor: 0 }, 99)).toEqual({ cursor: 1 });
  });

  it('越界的光标下标回落到第一个入口（不返回 undefined）', () => {
    expect(homeActionAt({ cursor: 7 })).toBe('roguelike');
  });
});
