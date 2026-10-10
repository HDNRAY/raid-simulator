/**
 * 触屏接线：把平台能力、布局、输入源、按钮层串起来。
 *
 * ==================================================================
 * 为什么要单独一个文件
 * ==================================================================
 *
 * `main.ts` 已经 690+ 行（AGENTS.md §3 的上限是 700），而"触屏"这件事
 * 涉及四块东西：能力探测 / 布局（唯一真相）/ 输入源 / 按钮层。
 * 把它们堆进 `main.ts` 会立刻超限，而且那四块本来就是一个内聚的整体。
 *
 * 所以这里只留一个入口 `createTouchControls()`，`main.ts` 拿到的
 * 是三个动作：`handlePointer*`、`frame()`、`setShowKeyHints()`。
 *
 * ==================================================================
 * 点击路由：按钮优先，其次才是别的 UI
 * ==================================================================
 *
 * 触屏按钮画在 canvas 里，而设置按钮、设置面板、结算面板也都在
 * 同一个 canvas 上。所以**必须**有明确的优先级，否则"点技能按钮"
 * 会被"点结算面板"抢走（或反过来）。
 *
 * 这里定的优先级是：
 *
 *   1. 设置面板打开 → **它独占**（与键盘的捕获模式同理：
 *      玩家在改设置时不该把技能放出去）
 *   2. 触屏按钮命中 → 消费
 *   3. 其余交给调用方（设置按钮 / 结算重开 / …）
 *
 * ⚠️ 第 1 条不能少：设置面板自己也有"点面板外关闭"的逻辑，
 * 如果按钮优先，玩家在设置里点右下角会莫名其妙放一个技能。
 */

import type { PixiCtor } from './../ui/primitives';
import type { InputSource } from '../input/keyboard';
import { createTouchInput, type TouchHitArea, type TouchInputSource } from '../input/touchInput';
import { createTouchLayout, touchButtonsFromBindings, type TouchLayout } from '../input/touchLayout';
import {
  TouchButtonLayer,
  TOUCH_BUTTON_DIAMETER,
  touchButtonCenter,
} from '../render/touchButtonLayer';
import { detectBrowserPlatform, type PlatformCaps } from '../render/platform';
import type { BattleSnapshotView } from '../render/viewModel';

/**
 * 从快照里挑出**生效中的派生技**。
 *
 * ⚠️ 放在这里而不是 `main.ts`：`main.ts` 已经贴着 700 行上限
 * （AGENTS.md §3），而这个函数是触屏控件的一部分知识。
 */
export function derivedOfSnapshot(
  view: BattleSnapshotView,
): { readonly skillId: string; readonly sourceSkillId: string } | undefined {
  const slot = view.skills.find((s) => s.derivedFrom !== undefined);
  if (slot === undefined || slot.derivedFrom === undefined) return undefined;
  return { skillId: slot.skillId, sourceSkillId: slot.derivedFrom };
}

export interface TouchControlsOptions {
  readonly pixi: PixiCtor;
  readonly translate: (key: string) => string;
  /** 键盘输入源的键位表 —— 触屏按钮**从它推导**（唯一真相）。 */
  readonly bindings: readonly { readonly key: string; readonly skillId: string }[];
  readonly currentTick: () => number;
  /** 设置面板是否打开（打开时触屏按钮让出输入权）。 */
  readonly isSettingsOpen: () => boolean;
  /**
   * 当前生效的派生技（没有则 `undefined`）。
   *
   * 需求："移动端则需要设计一下。" —— 派生技画成**原按钮上的角标环**，
   * 所以命中测试要知道"哪个按钮上现在挂着什么"。
   *
   * ⚠️ 由主循环从**快照**读（那是渲染层已经算好的），
   * 这里不自己去翻 buff —— 否则又是两处真相。
   */
  readonly derivedSkill: () => { readonly skillId: string; readonly sourceSkillId: string } | undefined;
}

export interface TouchControls {
  readonly caps: PlatformCaps;
  readonly layout: TouchLayout;
  readonly layer: TouchButtonLayer;
  /** 触屏输入源。非触屏设备上是 `undefined`。 */
  readonly input: InputSource | undefined;
  /**
   * 处理一次按下。返回 `true` 表示**已被触屏按钮消费**，
   * 调用方不要再把它交给别的 UI。
   */
  readonly onPointerDown: (pointerId: number, px: number, py: number) => boolean;
  readonly onPointerUp: (pointerId: number) => void;
  readonly onPointerCancel: (pointerId: number) => void;
  /** 每帧：把布局推给按钮层、按快照更新文本。 */
  readonly frame: (view: BattleSnapshotView) => void;
  /** 键位表变了 → 按钮跟着变（这是"监听变化"的落点之一）。 */
  readonly setBindings: (bindings: readonly { readonly key: string; readonly skillId: string }[]) => void;
  /**
   * 按 `skillId` 反查按钮圆心（端到端脚本用）。
   *
   * ⚠️ 放在这里而不是 `main.ts`：几何的唯一真相是 `TouchLayout`，而它由
   * 本模块持有。脚本要是自己复制一份几何，布局一调就会静默失效。
   */
  readonly centerOfSkill: (skillId: string) => { readonly x: number; readonly y: number } | null;
  readonly dispose: () => void;
}

/**
 * 创建触屏控件。
 *
 * 非触屏设备上 `layer` 仍然是可用的空层（调用方不必到处判空），
 * 但 `input` 是 `undefined`、`layer.root.visible` 永远是 `false`。
 */
export function createTouchControls(options: TouchControlsOptions): TouchControls {
  const caps = detectBrowserPlatform();
  const layout = createTouchLayout(touchButtonsFromBindings(options.bindings));
  const layer = new TouchButtonLayer({
    pixi: options.pixi,
    translate: options.translate,
  });
  /**
   * 先按初始布局建一次按钮 —— 否则第一帧是空的，
   * 玩家会看到"按钮晚了一帧才出现"。
   */
  layer.setButtons(layout.current().map((b) => b.skillId));
  layer.root.visible = caps.touch;

  /**
   * 命中区域由**按钮层**的几何算出来 —— 因为"按钮画在哪"只有它知道。
   *
   * ⚠️ 这里不缓存：`touchButtonsFromBindings` 每次都可能给出不同的
   * 数量，缓存会让命中区域与画面脱节（那正是"唯一真相"要避免的）。
   */
  const hitAreas = (): readonly TouchHitArea[] => {
    if (!caps.touch) return [];
    const buttons = layout.current();
    const radius = TOUCH_BUTTON_DIAMETER / 2;
    const derived = options.derivedSkill();
    return buttons
      .map((b) => {
        const center = touchButtonCenter(b.index);
        if (center === undefined) return undefined;
        const attached =
          derived !== undefined && derived.sourceSkillId === b.skillId
            ? derived.skillId
            : undefined;
        const area: TouchHitArea = {
          index: b.index,
          skillId: b.skillId,
          x: center.x,
          y: center.y,
          r: radius,
          /** 派生技挂在**源**按钮上（画成角标环）。 */
          ...(attached === undefined ? {} : { derivedSkillId: attached }),
        };
        return area;
      })
      .filter((a): a is TouchHitArea => a !== undefined);
  };

  const input: TouchInputSource | undefined = caps.touch
    ? createTouchInput({
        layout,
        currentTick: options.currentTick,
        hitAreas,
        isCapturing: options.isSettingsOpen,
      })
    : undefined;

  /** 布局变化 → 按钮层跟着重画（"监听变化"的另一个落点）。 */
  const offLayout = layout.subscribe((buttons) => {
    layer.setButtons(buttons.map((b) => b.skillId));
  });

  return {
    caps,
    layout,
    layer,
    input,

    centerOfSkill(skillId) {
      const idx = layout.current().findIndex((b) => b.skillId === skillId);
      return idx < 0 ? null : (touchButtonCenter(idx) ?? null);
    },
    onPointerDown(pointerId, px, py) {
      /**
       * 设置面板打开时**不放技能** —— 与键盘的捕获模式同理。
       * 见文件头的"点击路由"说明。
       */
      if (options.isSettingsOpen()) return false;
      if (input === undefined) return false;
      return input.pointerDown(pointerId, px, py);
    },

    onPointerUp(pointerId) {
      input?.pointerUp(pointerId);
    },

    onPointerCancel(pointerId) {
      input?.pointerCancel(pointerId);
    },

    frame(view) {
      if (!caps.touch) return;
      /**
       * ⚠️ **设置面板打开时隐藏按钮层。**
       *
       * 否则扇形按钮会画在设置面板**上面**（面板在 canvas 里居中，
       * 高 500，而按钮占 `y 284..508` 那片）—— 实测在设置页能看到
       * 六个圆按钮穿透出来，既难看又让人以为可以点。
       *
       * 放在这里（每帧判）而不是"打开时隐藏一次"：`settingsOpen`
       * 是主循环的局部状态，没有变更事件，每帧读一次是最省事且不会
       * 漏的写法。
       */
      const hidden = options.isSettingsOpen();
      layer.root.visible = !hidden;
      if (hidden) return;
      layer.update(view);
    },

    setBindings(bindings) {
      /**
       * 键位表是唯一真相 —— 它变了两件事跟着变：
       *   1. `TouchLayout`（进而按钮层重画）
       *   2. 触屏输入源的合成 key 表
       */
      layout.set(touchButtonsFromBindings(bindings));
      /**
       * `setBindings` 在触屏输入源里**不读参数**（按钮是从布局推导的，
       * 不是玩家配的），但接口为了与键盘一致要求一个参数。
       * 传空数组，语义是"没有键盘绑定"。
       */
      input?.setBindings([]);
    },

    dispose() {
      offLayout();
      input?.dispose();
      layer.dispose();
    },
  };
}
