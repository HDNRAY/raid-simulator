/**
 * 触屏输入源：把手指按在圆形按钮上，翻译成引擎能吃的 `Action`。
 *
 * ==================================================================
 * 为什么可以很薄
 * ==================================================================
 *
 * 引擎只吃 `Action[]`（`useSkill` / `hold` / `releaseSkill`），而这三种
 * 已经能表达触屏需要的一切：
 *
 *   按下        → `useSkill`
 *   按住不放    → `hold`（引擎按逻辑步扣资源维持效果）
 *   松开        → `releaseSkill`
 *
 * **技能不需要区分"点按型"还是"按住型"**：`startHold` 对非按住型
 * 技能会退化成普通施放（`holds.ts` 里有这条兜底，注释写着"这样输入层
 * 不必区分两种技能"）。所以这里无脑同时发 `useSkill` + `hold`，
 * 由引擎决定语义。
 *
 * ==================================================================
 * ⚠️ 合成 key：让 `repeatHeld` 不用改
 * ==================================================================
 *
 * `repeatHeld()` 遍历的是**键位表**，用 `binding.key` 去问
 * `isHeld(key)`。触屏按钮没有键，所以这里给它一个**合成 key**
 * （`touch:{skillId}`）：
 *
 *   - `isHeld('touch:attack')` → 手指是不是按在「攻」上
 *   - `bindings()` 里报出 `{ key: 'touch:attack', skillId: 'attack' }`
 *
 * 于是"按住连发"这条已有逻辑**一行都不用改**就同时服务键鼠与触屏。
 * 合成 key 带前缀，所以永远不会和真按键（`q` / `a` / …）撞名。
 *
 * ==================================================================
 * ⚠️ 一个 pointerId 只占一个按钮
 * ==================================================================
 *
 * 多指跟踪靠 `pointerId`。手指**按下时**绑定到当时命中的按钮，
 * 之后移动不切换 —— 否则从「攻」滑到「防」会被当成"按住防"，
 * 而玩家以为自己还按着攻。
 */

import type { Action } from '../core/types';
import type { InputSource, KeyBinding } from './keyboard';
import type { TouchLayout } from './touchLayout';

/** 合成 key 的前缀。不会与真按键撞名。 */
export const TOUCH_KEY_PREFIX = 'touch:';

/** 第 n 个按钮的合成 key。 */
export function touchKeyOf(skillId: string): string {
  return `${TOUCH_KEY_PREFIX}${skillId}`;
}

/** 命中测试：按钮的圆形区域。 */
export interface TouchHitArea {
  readonly index: number;
  readonly skillId: string;
  readonly x: number;
  readonly y: number;
  readonly r: number;
}

/**
 * 在给定指针位置上找命中的按钮。
 *
 * **从后往前**找：后画的（外弧）压在上层，与视觉一致。
 */
export function hitTestButtons(
  areas: readonly TouchHitArea[],
  px: number,
  py: number,
): TouchHitArea | undefined {
  for (let i = areas.length - 1; i >= 0; i -= 1) {
    const area = areas[i];
    if (area === undefined) continue;
    const dx = px - area.x;
    const dy = py - area.y;
    if (dx * dx + dy * dy <= area.r * area.r) return area;
  }
  return undefined;
}

export interface TouchInputOptions {
  /** 按钮布局（唯一真相）。输入层**订阅**它，不自己存副本。 */
  readonly layout: TouchLayout;
  /** 战斗内 tick 的读取方式（与键盘输入源一致：时间来源唯一）。 */
  readonly currentTick: () => number;
  /**
   * 按钮的命中区域（由渲染层算出来 —— 它才知道画在哪）。
   *
   * 返回空数组表示"还没有布局"，此时所有触摸都不产生 Action。
   */
  readonly hitAreas: () => readonly TouchHitArea[];
  /** 是否处于捕获模式（改键时要独占输入）。 */
  readonly isCapturing?: () => boolean;
}

export interface TouchInputSource extends InputSource {
  /**
   * 供渲染层与点击路由使用：这个位置有没有按钮。
   *
   * 命中就"消费"这次点击，不再传给设置按钮 / 结算面板。
   */
  readonly hitTest: (px: number, py: number) => TouchHitArea | undefined;
  /**
   * 手指按下。返回**是否消费**了这次按压 ——
   * 调用方据此决定要不要继续传给设置按钮 / 结算面板。
   */
  readonly pointerDown: (pointerId: number, px: number, py: number) => boolean;
  readonly pointerUp: (pointerId: number) => void;
  /**
   * 手指划出画布 / 系统取消 → 当作松开。
   *
   * ⚠️ 不处理它会让"按住中"永远卡住：引擎会一直按那个技能的代价
   * 扣资源，而玩家的手指早就不在屏幕上了。
   */
  readonly pointerCancel: (pointerId: number) => void;
}

export function createTouchInput(options: TouchInputOptions): TouchInputSource {
  /** pointerId → 它按下时命中的按钮。**按下时绑定，移动不切换。** */
  const active = new Map<number, TouchHitArea>();
  /** 本 tick 积累的动作（`drain()` 之后清空）。 */
  let pending: Action[] = [];

  /**
   * 订阅布局：布局一变，把它删掉的按钮上按着的手指**立刻释放**。
   *
   * 不然会出现"按钮没了，但引擎还在扣资源维持那个按住效果"。
   */
  let liveSkillIds = new Set<string>();
  const off = options.layout.subscribe((buttons) => {
    const next = new Set(buttons.map((b) => b.skillId));
    for (const [pointerId, area] of active) {
      if (!next.has(area.skillId)) {
        active.delete(pointerId);
        pending.push({
          type: 'releaseSkill',
          skillId: area.skillId,
          atTick: options.currentTick(),
        });
      }
    }
    liveSkillIds = next;
  });

  const releasePointer = (pointerId: number): void => {
    const area = active.get(pointerId);
    if (area === undefined) return;
    active.delete(pointerId);
    pending.push({
      type: 'releaseSkill',
      skillId: area.skillId,
      atTick: options.currentTick(),
    });
  };

  return {
    hitTest: (px, py) => hitTestButtons(options.hitAreas(), px, py),

    /**
     * 手指按下。返回是否消费了这次按压 —— 调用方（主循环的点击路由）
     * 据此决定要不要继续传给设置按钮 / 结算面板。
     */
    pointerDown(pointerId: number, px: number, py: number): boolean {
      if (options.isCapturing?.() === true) return false;
      const area = hitTestButtons(options.hitAreas(), px, py);
      if (area === undefined) return false;
      /**
       * 同一个手指重复按下（有些浏览器会补发）→ 只认第一次，
       * 否则会重复扣一次施放代价。
       */
      if (active.has(pointerId)) return true;
      active.set(pointerId, area);
      /**
       * ⚠️ **只发 `hold`，不要同时发 `useSkill`。**
       *
       * `hold` 对非按住型技能会**自己发一次 `useSkill`**（`holds.ts` 的
       * 兜底），所以再补一个 `useSkill` 就是同一 tick 重复施放 ——
       * 第二次必然撞上"正在施法中"而被拒，玩家看到
       * 「攻 · 正在施法中」这条**莫名其妙的报错**（他明明按对了）。
       *
       * 实测（同一个 tick）：
       *   只发 useSkill         → skillUsed=2  rejected=0
       *   只发 hold             → skillUsed=2  rejected=0
       *   **两个都发（原来的写法）→ skillUsed=2  rejected=1 [casting]**
       *
       * 所以语义上 `hold` 已经包含了 `useSkill`，只发它就够了：
       *   - 按住型（「防」）→ 进入按住状态，引擎每逻辑步扣资源
       *   - 非按住型（「攻」等）→ 退化成一次普通施放
       */
      pending.push({ type: 'hold', skillId: area.skillId, atTick: options.currentTick() });
      return true;
    },

    pointerUp(pointerId: number): void {
      releasePointer(pointerId);
    },

    /** 手指划出画布 / 系统取消 → 当作松开，避免卡住按住状态。 */
    pointerCancel(pointerId: number): void {
      releasePointer(pointerId);
    },

    drain(): readonly Action[] {
      const out = pending;
      pending = [];
      return out;
    },

    /**
     * ⚠️ 这里查的是**合成 key**（`touch:attack`）。
     *
     * `repeatHeld()` 拿 `bindings()` 里的 key 来问，而我们把按钮报成
     * `touch:{skillId}`，所以两边对得上，不用改 `repeatHeld`。
     */
    isHeld(key: string): boolean {
      if (!key.startsWith(TOUCH_KEY_PREFIX)) return false;
      const skillId = key.slice(TOUCH_KEY_PREFIX.length);
      for (const area of active.values()) {
        if (area.skillId === skillId) return true;
      }
      return false;
    },

    skillForKey(key: string): string | undefined {
      if (!key.startsWith(TOUCH_KEY_PREFIX)) return undefined;
      const skillId = key.slice(TOUCH_KEY_PREFIX.length);
      return liveSkillIds.has(skillId) ? skillId : undefined;
    },

    /** 把当前按钮报成"键位表"，让 `repeatHeld` 能遍历它们。 */
    bindings(): readonly KeyBinding[] {
      return options.layout
        .current()
        .map((b) => ({ key: touchKeyOf(b.skillId), skillId: b.skillId }));
    },

    /**
     * 触屏没有"改键"这回事 —— 按钮由绑定表推导。
     * 布局变了要清掉按住状态（与键盘的 `setBindings` 同理）。
     */
    setBindings(): void {
      for (const pointerId of [...active.keys()]) releasePointer(pointerId);
    },

    capture(): void {
      // 捕获模式由 `options.isCapturing` 控制；这里只需清掉按住中的手指
      for (const pointerId of [...active.keys()]) releasePointer(pointerId);
    },

    dispose(): void {
      off();
      active.clear();
      pending = [];
    },
  };
}
