import { describe, expect, it } from 'vitest';
import {
  createTouchInput,
  hitTestButtons,
  touchKeyOf,
  TOUCH_KEY_PREFIX,
  type TouchHitArea,
} from '../../src/input/touchInput';
import { createTouchLayout } from '../../src/input/touchLayout';

/** 两个按钮：左边 (100,100)、右边 (200,100)，半径 36。 */
const AREAS: readonly TouchHitArea[] = [
  { index: 0, skillId: 'attack', x: 100, y: 100, r: 36 },
  { index: 1, skillId: 'guard', x: 200, y: 100, r: 36 },
];

function makeInput(areas: readonly TouchHitArea[] = AREAS) {
  const layout = createTouchLayout(
    areas.map((a) => ({ index: a.index, skillId: a.skillId })),
  );
  let tick = 0;
  const input = createTouchInput({
    layout,
    currentTick: () => tick,
    hitAreas: () => areas,
  });
  return { input, layout, advance: (n: number) => (tick += n) };
}

describe('圆形按钮命中测试', () => {
  it('圆内命中、圆外不命中（用半径而不是外接方框）', () => {
    const area = AREAS[0]!;
    expect(hitTestButtons(AREAS, area.x, area.y)?.skillId).toBe('attack');
    // 圆心右上 30px：在 36 半径内
    expect(hitTestButtons(AREAS, area.x + 25, area.y - 25)?.skillId).toBe('attack');
    // 外接方框的角（36,36 距离 ≈ 51 > 36）必须**不**命中
    expect(hitTestButtons(AREAS, area.x + 36, area.y - 36)).toBeUndefined();
  });

  it('从后往前找 —— 外弧（后画的）压在上层', () => {
    const overlapping: readonly TouchHitArea[] = [
      { index: 0, skillId: 'attack', x: 100, y: 100, r: 50 },
      { index: 1, skillId: 'guard', x: 100, y: 100, r: 50 },
    ];
    expect(hitTestButtons(overlapping, 100, 100)?.skillId).toBe('guard');
  });
});

describe('触屏输入 → Action', () => {
  it('按下产出 useSkill + hold（引擎决定按住语义）', () => {
    const { input } = makeInput();
    expect(input.pointerDown(1, 100, 100)).toBe(true);
    expect(input.drain()).toEqual([
      { type: 'useSkill', skillId: 'attack', atTick: 0 },
      { type: 'hold', skillId: 'attack', atTick: 0 },
    ]);
  });

  it('松开产出 releaseSkill', () => {
    const { input } = makeInput();
    input.pointerDown(1, 100, 100);
    input.drain();
    input.pointerUp(1);
    expect(input.drain()).toEqual([
      { type: 'releaseSkill', skillId: 'attack', atTick: 0 },
    ]);
  });

  it('没命中按钮时**不消费**（返回 false，交给别的 UI 处理）', () => {
    const { input } = makeInput();
    expect(input.pointerDown(1, 500, 400)).toBe(false);
    expect(input.drain()).toEqual([]);
  });

  it('【关键】同一个 pointerId 重复按下只算一次（不重复扣代价）', () => {
    const { input } = makeInput();
    input.pointerDown(1, 100, 100);
    input.pointerDown(1, 100, 100);
    const actions = input.drain();
    expect(actions.filter((a) => a.type === 'useSkill')).toHaveLength(1);
  });

  it('【关键】多指：两指同时按住两个按钮互不干扰', () => {
    const { input } = makeInput();
    input.pointerDown(1, 100, 100);
    input.pointerDown(2, 200, 100);
    expect(input.isHeld(touchKeyOf('attack'))).toBe(true);
    expect(input.isHeld(touchKeyOf('guard'))).toBe(true);
  });

  it('【关键】手指从 A 滑到 B 不切换 —— 仍按住 A', () => {
    const { input } = makeInput();
    input.pointerDown(1, 100, 100); // 按在「攻」上
    input.drain();
    // 手指移到「防」的位置（真实浏览器里会派 pointermove，
    // 但输入层不监听它 —— 因为按下时就绑定了）
    expect(input.isHeld(touchKeyOf('attack'))).toBe(true);
    expect(input.isHeld(touchKeyOf('guard'))).toBe(false);
  });

  it('pointerCancel（划出画布）当作松开，不留下卡住的按住', () => {
    const { input } = makeInput();
    input.pointerDown(1, 100, 100);
    input.drain();
    input.pointerCancel(1);
    expect(input.isHeld(touchKeyOf('attack'))).toBe(false);
    expect(input.drain()).toEqual([
      { type: 'releaseSkill', skillId: 'attack', atTick: 0 },
    ]);
  });

  it('捕获模式（改键）下不产生 Action', () => {
    const layout = createTouchLayout([{ index: 0, skillId: 'attack' }]);
    const input = createTouchInput({
      layout,
      currentTick: () => 0,
      hitAreas: () => AREAS,
      isCapturing: () => true,
    });
    expect(input.pointerDown(1, 100, 100)).toBe(false);
    expect(input.drain()).toEqual([]);
  });
});

describe('合成 key：让 repeatHeld 不用改', () => {
  it('bindings() 把按钮报成 `touch:{skillId}`', () => {
    const { input } = makeInput();
    expect(input.bindings()).toEqual([
      { key: 'touch:attack', skillId: 'attack' },
      { key: 'touch:guard', skillId: 'guard' },
    ]);
    expect(TOUCH_KEY_PREFIX).toBe('touch:');
  });

  it('合成 key 不会和真按键撞名（`q` 之类不命中）', () => {
    const { input } = makeInput();
    input.pointerDown(1, 100, 100);
    expect(input.isHeld('q')).toBe(false);
    expect(input.skillForKey('q')).toBeUndefined();
  });

  it('不在布局里的合成 key 查不到技能', () => {
    const { input } = makeInput();
    expect(input.skillForKey(touchKeyOf('flash'))).toBeUndefined();
  });

  it('布局里删掉一个按钮 → 按在它上面的手指立刻释放', () => {
    const { input, layout } = makeInput();
    input.pointerDown(1, 100, 100);
    input.drain();
    // 只留 guard
    layout.set([{ index: 0, skillId: 'guard' }]);
    expect(input.isHeld(touchKeyOf('attack'))).toBe(false);
    expect(input.drain()).toEqual([
      { type: 'releaseSkill', skillId: 'attack', atTick: 0 },
    ]);
  });
});
