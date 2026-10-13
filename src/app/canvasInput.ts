/**
 * **画布上的指针事件接线**（鼠标 + 触屏共用一条路）。
 *
 * ==================================================================
 * 为什么单独一个文件
 * ==================================================================
 *
 * `main.ts` 是"装配流水账"，指针处理是其中**最内聚的一段**：它只关心
 * "这次手势落在哪个界面元素上"，与战斗逻辑无关。抽出来之后装配代码只剩
 * 一行 `wireCanvasPointer(...)`，而这段的**优先级顺序**（下面那三条 ⚠️）
 * 也集中在一处、能一眼看完。
 *
 * ==================================================================
 * ⚠️ 顺序即优先级，四条都不能动
 * ==================================================================
 *
 *   0. **复盘层**（一局结束后的全屏战报）—— 它是 `battle` 相位里的子模式
 *   1. **当前那一个全屏界面**（首页 / 选角色 / 自由模式）—— 那一屏自己
 *      先问它的**边角控件**（齿轮 / 返回箭头），没消费的点击才轮到卡片
 *   2. **结算中点击 = 离开战斗** —— 必须早于按钮层与设置判断
 *   3. **触屏按钮** —— 它自己会在"设置打开"时拒绝消费
 *
 * ⚠️ **齿轮与返回箭头不再单独排在这里**（2026-10-12 重构）：它们从
 * "挂 stage 上的共享组件"变成**每个界面自己持有**（用户："stage 上理论上
 * 不挂任何小组件"、"多个页面的齿轮，应该分别定义"）。所以"谁先吃到点击"
 * 这件事跟着各屏的 `hitTest` 走（各屏里都是边角控件先于卡片）。
 * 这一层只回答"这次点击属于哪一屏"。
 *
 * 每条的由来都写在各自的位置上（都是实测踩出来的）。
 */

import { LOGICAL_H, LOGICAL_W } from '../render/scaling';
import type { SettingsPanel } from '../ui/settings/SettingsPanel';
import {
  activeInputLayer,
  battleExitOnPointer,
  reviewConsumesPointer,
  type CanvasInputReviewSource,
} from './inputRouter';
import type { Phase } from './flow';

/**
 * 一个**全屏界面**在指针路由里要满足的最小面。
 *
 * ⚠️ 它的 `hitTest` 里**已经包含了那一屏自己的边角控件**（齿轮 / 返回
 * 箭头先于卡片，见各屏的 `hitTest`）—— 这正是 2026-10-12 那轮重构的重点：
 * 组件归它所在的界面所有，所以路由只把点击交给"当前那一屏"，不需要
 * 在路由里额外排一个"齿轮 / 返回箭头"的优先级。
 *
 * ⚠️ 战斗那一屏是 `scene`：它的齿轮挂在 `BattleScene.chrome` 上，而场景
 * 自己也会先让齿轮吃掉点击（`BattleScene.hitTestChrome`）。
 */
export interface ScreenHitTarget {
  hitTest(px: number, py: number): boolean;
}

/** 指针要路由到的对象。 */
export interface CanvasInputTargets {
  readonly canvas: HTMLCanvasElement;
  /** 首页（默认入口；含它自己的齿轮）。 */
  readonly home: ScreenHitTarget;
  /** 选角色屏（肉鸽模式的第一屏；含它自己的齿轮与返回箭头）。 */
  readonly select: ScreenHitTarget;
  /** 自由模式（原备战界面；含它自己的齿轮与返回箭头）。 */
  readonly prepare: ScreenHitTarget;
  /** 选炁机屏（P3；含它自己的齿轮与返回箭头）。 */
  readonly qijiSelect: ScreenHitTarget;
  /** 一局结束屏（P3；含它自己的齿轮与返回箭头）。 */
  readonly runOver: ScreenHitTarget;
  /**
   * **战斗场景**（含战斗界面自己的齿轮）。
   *
   * ⚠️ 它的 `hitTestChrome` 只问那个齿轮 —— 战斗界面没有返回箭头
   * （`phaseLogic.backVisibleIn('battle') === false`）。
   */
  readonly scene: { hitTestChrome(px: number, py: number): boolean };
  readonly settings: SettingsPanel;
  /** 触屏控件（按钮层 + 输入源）。 */
  readonly touch: {
    onPointerDown(pointerId: number, px: number, py: number): boolean;
    onPointerUp(pointerId: number): void;
    onPointerCancel(pointerId: number): void;
  };
  /**
   * **要不要显示键名提示** = "现在是不是键盘方式"（唯一 flag 的派生）。
   *
   * ⚠️ 这里读它（而不是从 `touch.caps` 掏）有两个理由：
   *   1. 唯一 flag 的**读法只有一种**（`render/platform.capsOf`）——
   *      触屏控件不再是它的拥有者，也就不该再从它身上取
   *   2. 是**取值函数**：玩家在「通用」页切过去之后，这一层下一帧就跟着变
   */
  showKeyHints(): boolean;
  /** 当前阶段。 */
  phase(): Phase;
  settingsOpen(): boolean;
  /**
   * **复盘那一层**（一局结束后的全屏战报）。
   *
   * ⚠️ 它是"指针该归谁"的**第二个子模式**（第一个是设置面板）：
   * `phase` 在一局结束后**仍然是 `battle`**，所以只看相位会让它永远
   * 抢不到手势 —— 触屏滚不动复盘就是这么来的（见 `inputRouter`）。
   */
  review(): CanvasInputReviewSource;
  /** 打开设置（点齿轮）。 */
  openSettings(): void;
  /** 战斗已结束（用来判"点屏幕离开战斗"）。 */
  battleEnded(): boolean;
  /** 离开战斗（按模式分流：肉鸽 → 选角色；自由 → 自由模式界面）。 */
  backFromBattle(): void;
  /**
   * **一局结束屏的确认**（回选角色）。
   *
   * ⚠️ 与 `backFromBattle` 分开：那条是"战斗结算面板按 Enter / 点屏幕"
   * （相位 `battle`），这条是"摘要屏点屏幕"（相位 `runOver`）——
   * 两个相位的"点屏幕"都要能继续，所以本层需要两个回调。
   */
  continueRun(): void;
}

/**
 * 装上四个指针监听。
 *
 * @returns 卸载函数（`dispose` 用；虽然页面生命周期内不会调，但显式一点）。
 */
export function wireCanvasPointer(t: CanvasInputTargets): () => void {
  /** CSS 尺寸 → 逻辑坐标（canvas 内部分辨率固定，靠 CSS 缩放）。 */
  const at = (event: { readonly clientX: number; readonly clientY: number }): { px: number; py: number } => {
    const rect = t.canvas.getBoundingClientRect();
    return {
      px: ((event.clientX - rect.left) / rect.width) * LOGICAL_W,
      py: ((event.clientY - rect.top) / rect.height) * LOGICAL_H,
    };
  };

  /**
   * 是否正在拖滑块。
   *
   * 需求："ui 缩放的 slider 还是要支持鼠标。"
   * 点一下就能调（`hitTest` 里按横坐标反算），而**拖动**需要额外记住
   * "这次手势从滑块开始" —— 否则鼠标划过面板时也会一直改数值。
   */
  let draggingSlider = false;

  /**
   * **详情区拖拽**占住了这次手势的指针 id（触屏没有滚轮，靠拖）。
   *
   * ⚠️ 与 `draggingSlider` 分开记账：两者是**同一页上的两个可拖区域**
   * （滑块在「通用」页、详情在「按键」页，页不同但手势语义不同 ——
   * 一个改数值、一个滚动内容）。合成一个标志，切换页时就会有一个
   * 拖拽被引到另一个区域上。
   */
  let detailDragId: number | null = null;

  /**
   * 复盘拖拽**占住了这次手势**的指针 id。
   *
   * ⚠️ 两个作用：move / up 只转发给"开始拖的那个指针"，以及
   * `pointercancel`（手指划出画布）与 `pointerup` 同义地结束拖拽。
   */
  let reviewDragId: number | null = null;

  const onDown = (event: PointerEvent): void => {
    const { px, py } = at(event);
    /**
     * 这次指针属于哪一层 —— **一次算清**，下面所有分支都问它。
     * 算两次就可能出现"前半段判的是复盘、后半段判的是战斗"。
     */
    const layer = activeInputLayer({
      phase: t.phase(),
      settingsOpen: t.settingsOpen(),
      reviewOpen: t.review().isOpen(),
    });

    /**
     * ⓪ **复盘层先接**（它排在设置面板之后、其余一切之前）。
     *
     * ⚠️ 两种"想滚动却滚不动"的 bug 都在这一步一起修掉：
     *   - **键盘路**：`settingsKeys` 原先只看相位，复盘开着时把 `↑`
     *     吃去点亮设置按钮 → 复盘收不到上下键（用户在报的这条）
     *   - **触屏路**：原先"结算中点屏幕 = 离开战斗"同样只看相位，
     *     于是手指一碰屏幕就重开，复盘**永远拖不动**
     *
     * 现在两条路都问同一个判据：`reviewConsumesPointer`（层是 `review`
     * **且**点在面板矩形内）。落在面板**外**的那一下仍按"点屏幕离开战斗"
     * 处理 —— 那与结算面板的"点击屏幕再来一次"是同一条，行为不变。
     */
    const reviewConsumed = reviewConsumesPointer(
      layer,
      { x: px, y: py },
      t.review().bounds(),
      t.review().canScroll(),
    );
    if (reviewConsumed) {
      reviewDragId = event.pointerId;
      t.review().pointerDown(event.pointerId, py);
      return;
    }

    /**
     * ① **三个全屏界面**（首页 / 选角色 / 自由模式）盖住整屏 —— 先让
     * **当前那一屏**消费，没消费掉的点击才轮到齿轮。
     *
     * ⚠️ **`!t.settingsOpen()` 这个条件是必需的**，不是冗余。
     *
     * 原先写的是无条件的 `if (t.phase() === 'prepare') { ...; return; }`，
     * 于是**设置面板从备战界面打开时，指针事件在这里就被吃掉了**，
     * 永远到不了下面的 `t.settings.hitTest()`。症状：备战界面里点设置页的
     * 技能格**完全没反应**（战斗界面却正常，因为那条路不经过这个分支）。
     *
     * 这也违反 AGENTS.md §3b「触屏与键盘功能必须对等」：改键只有
     * `Enter` 一条路，而触屏**根本按不出 Enter**。
     *
     * ⚠️ **不判"复盘"**：复盘只可能出现在 `battle` 相位里，而那条路
     * 上面 ⓪ 已经接过一次了。
     */
    if (t.phase() !== 'battle' && !t.settingsOpen()) {
      /**
       * ⚠️ **只交给当前那一屏**，由它自己决定先问谁。
       *
       * 每一屏的 `hitTest` 里，**边角控件（齿轮 / 返回箭头）都排在卡片之前**
       * —— 它们浮在界面之上，而卡片铺满整屏。原先这个顺序写在本文件里
       * （先 `settingsButton`、再 `back`、最后界面），那正是"一个共享组件
       * 要适配所有屏"的写法：三个界面各自的知识被搬到路由里统一排。
       *
       * 现在组件归各屏自己，于是顺序也归各屏 —— 本文件只剩"这次点击属于
       * 哪一屏"这一个问题。
       *
       * ⚠️ 命中即 `return`（各屏内部也一样）：一次点击只能做一件事 ——
       * 继续往下走会同时点中底下的卡片。
       */
      if (t.phase() === 'home') t.home.hitTest(px, py);
      else if (t.phase() === 'characterSelect') t.select.hitTest(px, py);
      else if (t.phase() === 'prepare') t.prepare.hitTest(px, py);
      else if (t.phase() === 'qijiSelect') t.qijiSelect.hitTest(px, py);
      else t.runOver.hitTest(px, py);
      return;
    }

    /**
     * ② **结算中：点屏幕任意处 = 离开战斗**。
     *
     * ⚠️ 必须**先于**按钮层与设置判断，且整体 `return`：
     *   - 放在按钮层之后：按钮会 `return true` 吃掉点击 → 玩家点在按钮弧里
     *     **永远重开不了**（实测点「斩」不重开、点空白才重开）
     *   - 不 `return`：会同时满足齿轮的命中 → 一次点击
     *     **既开设置又静默重开**（实测 tick 663 → 43）
     *
     * ⚠️ 判据是 `battleExitOnPointer(layer, reviewConsumed)` 而不是
     * `phase === 'battle'`：复盘吃掉的那一下不该顺手把玩家带离战斗
     * （触屏想拖拽却重开一局）；没被吃掉的那一下则照旧退出 ——
     * 否则触屏玩家**出不去复盘**（键盘还有 `Enter`）。
     *
     * ⚠️ 它同时管住了另一件事：`battleEnded()` 读的是 `state.loop`，
     * 而**非战斗阶段它是 `undefined`** —— `undefined !== 'running'` 为真，
     * 没有这个守卫就会"在首页点一下屏幕就被送去选角色 / 备战界面"。
     * 现在这个守卫由"输入层是 battle"承担（非战斗相位不可能返回 `battle`）。
     */
    if (battleExitOnPointer(layer, reviewConsumed) && !t.showKeyHints() && t.battleEnded()) {
      t.backFromBattle();
      return;
    }

    /**
     * ③ 触屏按钮优先，但它自己在"设置打开"时会拒绝消费
     * （见 `touchControls` 的点击路由说明）。
     */
    if (t.touch.onPointerDown(event.pointerId, px, py)) return;

    /**
     * ⚠️ 战斗界面的**齿轮**：它在触屏按钮之后判（与重构前的位置、
     * 优先级都一致 —— 双弧外弧最左缘在 `x 654`，齿轮在日志下方
     * `x ≈ 16..78`，两者不可能重叠，所以顺序在这里只是"保持原样"）。
     *
     * ⚠️ 面板打开时齿轮已经被 `settingsToggle` 藏起来了，
     * 所以下面那句 `!settingsOpen()` 的守卫是**给面板用的**、不是给齿轮的：
     * 面板开着时这一层要把点击让给面板（那是下面的 `settings.hitTest`）。
     */
    if (!t.settingsOpen()) {
      if (t.scene.hitTestChrome(px, py)) t.openSettings();
      return;
    }
    /**
     * ⚠️ 命中测试**先跑**（它负责把这次点击路由到设置页的各个区域），
     * 然后**同一次点击**再问两件事：
     *   1. 它是不是落在滑块上（`draggingSlider`）
     *   2. 它是不是落在详情区上（`detailDragId`，开始拖拽滚动）
     *
     * 详情区的拖拽**不能**等 `hitTest` 返回什么 —— 那里只管"点了哪个
     * 控件"，而滚动是一次手势（按下 → 移动 → 松开），要自己记 id。
     */
    const consumed = t.settings.hitTest(px, py);
    draggingSlider = consumed && t.settings.pointers.isOnScaleSlider(px, py);
    if (consumed && t.settings.pointers.isOnDetail(px, py)) {
      detailDragId = event.pointerId;
      t.settings.pointers.detailPointer('down', event.pointerId, py);
    }
  };

  const onMove = (event: PointerEvent): void => {
    const { px, py } = at(event);
    /**
     * 复盘拖拽优先 —— 一次手势一旦从复盘开始，就不要再被悬停 / 滑块抢走。
     * 复盘的滚动**只认逻辑 Y**（它不需要 X：拖动是竖直方向的）。
     */
    if (reviewDragId === event.pointerId) {
      t.review().pointerMove(event.pointerId, py);
      return;
    }
    /** 拖滑块优先 —— 一次手势一旦从滑块开始，就不要再被悬停抢走。 */
    if (draggingSlider) {
      t.settings.pointers.dragScaleSlider(px);
      return;
    }
    /**
     * 详情区拖拽（触屏滚动技能说明 —— AGENTS.md §3b 的功能对等：
     * 不许把"能滚"做成只有滚轮能用）。
     */
    if (detailDragId === event.pointerId) {
      t.settings.pointers.detailPointer('move', event.pointerId, py);
      return;
    }
    /**
     * 鼠标悬停到技能格 = **选中它**（需求："方向键选中和鼠标选中，
     * 应该合并"）。与方向键走同一条路径，所以高亮与详情完全一致。
     */
    t.settings.hoverSkill(px, py);
  };

  const endReviewDrag = (event: PointerEvent): void => {
    if (reviewDragId !== event.pointerId) return;
    reviewDragId = null;
    t.review().pointerUp(event.pointerId);
  };

  /** 结束详情区拖拽（`pointerup` / `pointercancel` / `pointerleave` 共用）。 */
  const endDetailDrag = (event: PointerEvent): void => {
    if (detailDragId !== event.pointerId) return;
    detailDragId = null;
    t.settings.pointers.detailPointer('up', event.pointerId);
  };

  const endDrag = (event: PointerEvent): void => {
    draggingSlider = false;
    endDetailDrag(event);
  };

  const onUp = (event: PointerEvent): void => {
    endReviewDrag(event);
    t.touch.onPointerUp(event.pointerId);
    endDrag(event);
  };

  /**
   * ⚠️ `pointercancel` 必须转发：手指划出画布 / 系统手势打断时，
   * 不释放会让引擎一直按那个技能的代价扣资源。
   */
  const onCancel = (event: PointerEvent): void => {
    endReviewDrag(event);
    t.touch.onPointerCancel(event.pointerId);
    endDrag(event);
  };

  /**
   * **滚轮**（桌面）：只服务「按键」页的**技能详情区**（它可能装不下）。
   *
   * ⚠️ 挂在这里而不是面板自己挂 `window`：输入归属只有一个入口
   * （本文件），面板只暴露 `isOnDetail` / `wheelDetail` —— 与滑块的
   * `isOnScaleSlider` / `dragScaleSlider` 同一分工。
   *
   * ⚠️ 用 `{ passive: false }` 是因为**可能**要 `preventDefault`：
   * 详情区滚得动时页面不该跟着滚。滚不动时**不拦**（那一下不属于面板）。
   */
  const onWheel = (event: WheelEvent): void => {
    if (!t.settingsOpen()) return;
    const { px, py } = at(event);
    /**
     * ⚠️ **两块各问一次**：技能详情区（键盘方式）与**触屏技能面**（触屏方式）
     * —— 同一页只画一块（互斥），谁滚得动谁就吃掉这次滚轮（并让页面别跟着滚）。
     * 两边都"滚不动"时**不拦**：那一下不属于面板。
     */
    const consumed =
      t.settings.pointers.wheelDetail(px, py, event.deltaY, event.deltaMode) ||
      t.settings.pointers.wheelPicker(px, py, event.deltaY);
    if (!consumed) return;
    event.preventDefault();
  };

  t.canvas.addEventListener('pointerdown', onDown);
  t.canvas.addEventListener('pointermove', onMove);
  t.canvas.addEventListener('pointerup', onUp);
  t.canvas.addEventListener('pointercancel', onCancel);
  /** `pointerleave` 与 cancel 同义：离开画布就该松开。 */
  t.canvas.addEventListener('pointerleave', onCancel);
  t.canvas.addEventListener('wheel', onWheel, { passive: false });

  return () => {
    t.canvas.removeEventListener('pointerdown', onDown);
    t.canvas.removeEventListener('pointermove', onMove);
    t.canvas.removeEventListener('pointerup', onUp);
    t.canvas.removeEventListener('pointercancel', onCancel);
    t.canvas.removeEventListener('pointerleave', onCancel);
    t.canvas.removeEventListener('wheel', onWheel);
  };
}
