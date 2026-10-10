import { describe, expect, it } from 'vitest';
import {
  createTouchInput,
  hitTestBadge,
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
  it('【关键】按下**只发 `hold`** —— 它已经包含 useSkill', () => {
    /**
     * ⚠️ 这条断言在修一个真 bug 时反过来了。
     *
     * 原先同时发 `useSkill` + `hold`，而 `hold` 对非按住型技能**自己会
     * 发一次 `useSkill`**（`holds.ts` 的兜底）—— 于是同一 tick 重复施放，
     * 第二次撞上"正在施法中"被拒，玩家看到「攻 · 正在施法中」这条
     * 莫名其妙的报错（他明明按对了）。
     *
     * 实测（同一 tick）：
     *   只发 useSkill → rejected=0
     *   只发 hold     → rejected=0
     *   **两个都发** → rejected=1 [casting]
     */
    const { input } = makeInput();
    expect(input.pointerDown(1, 100, 100)).toBe(true);
    expect(input.drain()).toEqual([{ type: 'hold', skillId: 'attack', atTick: 0 }]);
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
    // 施放动作走 `hold`（见上一条），所以这里数 `hold`
    expect(input.drain().filter((a) => a.type === 'hold')).toHaveLength(1);
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

describe('触屏按下 → 引擎：不能自己把自己拒了', () => {
  /**
   * 需求（用户报告）："我点击攻，显示『攻 · 正在施法中』"
   *
   * **根因**：`pointerDown` 原先同时发 `useSkill` + `hold`，而 `hold`
   * 对非按住型技能**自己会发一次 `useSkill`**（`holds.ts` 的兜底）——
   * 于是同一 tick 重复施放，第二次撞上"正在施放中"被拒，玩家看到一条
   * 莫名其妙的报错（他明明按对了）。
   *
   * 这条测试把"按一下不应该产生任何拒绝"钉住。
   */
  it('【关键】按一下「攻」→ 引擎**零拒绝**', () => {
    const layout = createTouchLayout([{ index: 0, skillId: 'attack' }]);
    const tick = 0;
    const input = createTouchInput({
      layout,
      currentTick: () => tick,
      hitAreas: () => [{ index: 0, skillId: 'attack', x: 100, y: 100, r: 36 }],
    });

    input.pointerDown(1, 100, 100);
    const actions = input.drain();
    // 只应该有 `hold` —— 它已经包含了 useSkill
    expect(actions.map((a) => a.type)).toEqual(['hold']);

    /**
     * ⚠️ 这里**不**驱动真实引擎（那属于 golden/集成测试的范围）。
     * 断言的是"不重复"这件事本身：动作序列里同一个技能只出现一次。
     */
    const forAttack = actions.filter(
      (a) => 'skillId' in a && a.skillId === 'attack',
    );
    expect(forAttack).toHaveLength(1);
  });
});

describe('修饰键归一化（派生技靠 ctrl/command + 原技能键）', () => {
  /**
   * 需求："快捷键是 ctrl/command + 原技能快捷键。"
   *
   * ⚠️ `metaKey` = Mac 的 Command。原先归一化里**没有它**，于是
   * `Cmd+Q` 被当成 `Q`，派生技永远触发不了。
   */
  it('Ctrl 与 Cmd 都进归一化，且与基础键区分开', async () => {
    const { normalizeKey } = await import('../../src/input/keyboard');
    const base = { key: 'q', code: 'KeyQ' };
    expect(normalizeKey({ ...base })).toBe('q');
    expect(normalizeKey({ ...base, ctrlKey: true })).toBe('ctrl+q');
    expect(normalizeKey({ ...base, metaKey: true })).toBe('meta+q');
    // 两者**不同**（Mac 与 Win 各认各的）
    expect(normalizeKey({ ...base, ctrlKey: true })).not.toBe(
      normalizeKey({ ...base, metaKey: true }),
    );
  });
});

describe('角标环（移动端的派生技）', () => {
  /**
   * 需求："移动端则需要设计一下。"
   *
   * 设计：派生技**不占扇形槽位**，而是画成**原按钮右上角的环**。
   * 所以命中测试要在同一个按钮上再分一层：点环 = 放派生技，
   * 点圆内 = 放原技能。
   */
  const withBadge: readonly TouchHitArea[] = [
    { index: 0, skillId: 'break', x: 100, y: 100, r: 36, derivedSkillId: 'strike' },
  ];

  it('点到环上 → 命中角标（而不是原技能）', () => {
    // 环心 = 按钮圆心 + (r*0.72, -r*0.72)
    /**
     * ⚠️ 这里用的是**新的** 0.6 偏移。原先 0.72 时环心到按钮圆心
     * `0.72·√2·r ≈ 1.02r`，**落在按钮外** —— 环有一大半露在外面，
     * 而且点它会先命中按钮边缘。这条断言当时就失败了，是个真问题。
     */
    const d = 36 * 0.6;
    expect(hitTestBadge(withBadge, 100 + d, 100 - d)?.derivedSkillId).toBe('strike');
    // 环心落在按钮圆内 —— 所以"先试环再试圆"这个顺序是必需的
    expect(hitTestButtons(withBadge, 100 + d, 100 - d)?.skillId).toBe('break');
  });

  it('点到按钮正中 → 不命中环（放原技能）', () => {
    expect(hitTestBadge(withBadge, 100, 100)).toBeUndefined();
  });

  it('没有派生技时不命中环', () => {
    const noBadge: readonly TouchHitArea[] = [
      { index: 0, skillId: 'break', x: 100, y: 100, r: 36 },
    ];
    const d = 36 * 0.6;
    expect(hitTestBadge(noBadge, 100 + d, 100 - d)).toBeUndefined();
  });

  it('【关键】按下时点环 → 产出的是**派生技**的 hold', () => {
    const layout = createTouchLayout([{ index: 0, skillId: 'break' }]);
    let tick = 0;
    const input = createTouchInput({
      layout,
      currentTick: () => tick++,
      hitAreas: () => withBadge,
    });
    const d = 36 * 0.6;
    expect(input.pointerDown(1, 100 + d, 100 - d)).toBe(true);
    expect(input.drain()).toEqual([{ type: 'hold', skillId: 'strike', atTick: 0 }]);
  });
});
