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
  dragExceedsTapSlop,
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

/**
 * 一个**可以拖拽滚动**的整屏界面的最小面。
 *
 * ⚠️ 它现在有**两个**实现方：自由模式（卡片视口 ∪ 详情区）与肉鸽确认屏
 * （两栏详情）。抽成一个类型而不是各写一遍，是因为 `wireCanvasPointer`
 * 里那套"按下先占住手势 → 够不够拖 → 松手若没拖过就补一次 `hitTest`"
 * 的流水**只能有一份**（两份必然漂，而漂的样子是"某一屏点一下没反应"）。
 */
export interface ScrollableScreen extends ScreenHitTarget {
  /** 这个点是不是落在一个可以拖拽滚动的区域里（按下时"先不下结论"的判据）。 */
  isOnScrollable(px: number, py: number): boolean;
  /** 滚轮：滚动了就返回 `true`（没滚就让页面自己滚）。 */
  wheelDetail(px: number, py: number, deltaY: number): boolean;
  /** 拖拽：这一帧相对上一帧的位移（向上为负）。 */
  dragDetail(px: number, py: number, deltaY: number): boolean;
}

/**
 * 一个**带鼠标悬停**的整屏界面的最小面（自由模式 / 选角色屏）。
 *
 * ⚠️ 它存在的理由：**详情区跟着鼠标走**这件事在 app 层**从来没接线**
 * （2026-10-15 查出来的：`prepare.hover()` 只有调试入口在调，`pointermove`
 * 一次都没调过它）—— 于是"鼠标划过卡片、右侧详情跟着切"只活在注释里，
 * 实际只有键盘 / 点击会切。两屏共用下面这一条流水（抄一份必然只修一处）。
 */
export interface HoverScreen {
  /** 划过 (px, py)：更新悬停项。@returns 有没有落在某一项上 */
  hover(px: number, py: number): boolean;
  /** 指针离开画布：清掉悬停。 */
  clearHover(): void;
}

/** 指针要路由到的对象。 */
export interface CanvasInputTargets {
  readonly canvas: HTMLCanvasElement;
  /** 首页（默认入口；含它自己的齿轮）。 */
  readonly home: ScreenHitTarget;
  /**
   * 选角色屏（肉鸽模式的第一屏；含它自己的齿轮与返回箭头）。
   *
   * ⚠️ 它带**右侧详情区**（2026-10-15）：hover 划过卡片时详情跟着切。
   */
  readonly select: ScreenHitTarget & HoverScreen;
  /**
   * 自由模式（原备战界面；含它自己的齿轮与返回箭头）。
   *
   * ⚠️ 它还带**详情区的滚动**（滚轮 / 拖拽）：触屏没有滚轮，而 Boss 的
   * 四条招式说明装不下 —— 拖拽那条路是 §3b 的功能对等要求，不是补充。
   */
  readonly prepare: ScrollableScreen & HoverScreen;
  /** 选炁机屏（P3；含它自己的齿轮与返回箭头）。 */
  readonly qijiSelect: ScreenHitTarget;
  /**
   * **确认屏**（肉鸽每场战斗之前，2026-10-15；含它自己的齿轮）。
   *
   * ⚠️ 它**没有返回箭头**（`phaseLogic.backVisibleIn` 的表），所以这一屏
   * 只可能有"齿轮 + 开始战斗"两个可点物 —— 但契约与别的整屏界面一样：
   * 路由只把点击交给它，优先级（齿轮先于按钮）由它自己的 `hitTest` 定。
   *
   * ⚠️ 它**也是可滚的**：左栏（玩家的技能表）比一屏长 —— 没有滚轮 / 拖拽
   * 的话第 5 条技能永远看不到（那正是"能读到玩家技能表"这条验收）。
   * 判据在 `ui/RunConfirmScreen`（两栏按矩形分派），与自由模式同一套流水。
   */
  readonly runConfirm: ScrollableScreen;
  /** 一局结束屏（P3；含它自己的齿轮与返回箭头）。 */
  readonly runOver: ScreenHitTarget;
  /** 图鉴（2026-10-20；只读屏：点哪都回首页，齿轮除外）。 */
  readonly codex: ScreenHitTarget;
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
   * **可滚动的整屏界面**拖拽时占住的指针 id / 上一帧的 y / 按下点与
   * "是否拖过" / **这次手势归哪一屏**。
   *
   * ⚠️ 与设置页那个 `detailDragId` 分开记账：两者**不在同一屏**，合成
   * 一个就会出现"手指从设置拖到备战屏还在滚"的串台。
   *
   * ⚠️ 记 `scrollDragScreen` 而不是"用的时候按相位现查"：一次手势**一旦
   * 开始**就属于开始那一屏 —— 拖到一半相位变了（例如拖拽顺带触发了某个
   * 按钮）时，按相位现查会把这一帧的位移喂给**另一屏**。
   *
   * ==================================================================
   * ⚠️ 为什么还要记"按下点"与"拖过没有"（2026-10-13）
   * ==================================================================
   *
   * 可滚区（自由模式的卡片视口 / 确认屏的两栏）**能滚**时，这一层会先把
   * 这次手势**整个占住**（`hitTest` 一次都不调）—— 因为"按住拖动"是一次
   * 手势，而"点一下"是另一次。但旧代码把**松手**那一步漏了：`pointerup`
   * 只是把 id 清掉，于是**在可滚区里点一下卡片什么都不会发生**
   * （既不选卡也不改层数）。
   *
   * 今天自由模式三块都排得下（3 / 8 / 7 张 → 视口 2 行）所以碰不到；只要
   * 炁机或 Boss 涨到要滚，**整块卡片区立刻变成点不动**（用户报的"点了没
   * 反应"）。
   *
   * 现在按**手势**分：按下记下起点 → 移动超过 `SCROLL_TAP_SLOP` 才算拖 →
   * 松手时若**没拖过**就补一次 `hitTest`（= 那一下是"点击"）。
   * 设置页那条路（先 `hitTest` 再占手势）不适用于这里：卡片上的按下**不能**
   * 立刻生效，否则"想滚动"会顺手把层数改了。
   */
  let scrollDragId: number | null = null;
  let scrollDragLastY = 0;
  /** 这次手势的**按下** y（判"点"还是"拖"的基准）。 */
  let scrollDragStartY = 0;
  /** 这次手势**移动过**吗（超过 `SCROLL_TAP_SLOP` 就是拖）。 */
  let scrollDragMoved = false;
  /** 这次手势**属于哪一屏**（见上：一旦开始就不再按相位现查）。 */
  let scrollDragScreen: ScrollableScreen | undefined;

  /**
   * "点一下"与"拖一下"的**分界**（逻辑像素）。
   *
   * 取 6：手指按下的抖动通常在几个像素内，而真正的滚动会一路超过它。
   * 偏向"算作点击"是**有意**的（与浏览器 / 系统的手势识别同一条）：
   * 把一次抖动误判成拖动的代价是"点了没反应"（这次要修的那个 bug），
   * 而把一次极小的拖动误判成点击的代价只是"滚动少了一点 / 顺带选了一张卡"。
   */
  const SCROLL_TAP_SLOP = 6;

  /**
   * 复盘拖拽**占住了这次手势**的指针 id。
   *
   * ⚠️ 两个作用：move / up 只转发给"开始拖的那个指针"，以及
   * `pointercancel`（手指划出画布）与 `pointerup` 同义地结束拖拽。
   */
  let reviewDragId: number | null = null;

  /**
   * **当前这一屏有没有"可拖拽滚动的区域"**（自由模式 / 肉鸽确认屏）。
   *
   * ⚠️ 两个实现方**共用下面那套流水**（占手势 → 判拖 → 松手补点击）：
   * 抄一份给确认屏的话，"点一下没反应"那个坑就得再踩一次。
   */
  const scrollableScreen = (): ScrollableScreen | undefined => {
    if (t.phase() === 'prepare') return t.prepare;
    if (t.phase() === 'runConfirm') return t.runConfirm;
    return undefined;
  };

  /**
   * 按下：落在可滚区里就**先占住手势**（不立刻 `hitTest`），否则照常点。
   *
   * 见上面 `scrollDragMoved` 的说明：占住 ≠ 吃掉 —— 松手时若没拖过，
   * `onUp` 会补一次 `hitTest`。
   */
  const beginScrollOrHit = (
    screen: ScrollableScreen,
    pointerId: number,
    px: number,
    py: number,
  ): void => {
    if (!screen.isOnScrollable(px, py)) {
      screen.hitTest(px, py);
      return;
    }
    scrollDragId = pointerId;
    scrollDragScreen = screen;
    scrollDragLastY = py;
    scrollDragStartY = py;
    scrollDragMoved = false;
  };

  /**
   * **当前这一屏有没有 hover**（详情区跟着鼠标走）。
   *
   * ⚠️ 只有"设置面板没开"时才问：面板是模态的，鼠标划过它不该悄悄把
   * 底下那一屏的详情换掉（`onDown` 里对整屏界面用的是同一条守卫）。
   */
  const hoverScreen = (): HoverScreen | undefined => {
    if (t.settingsOpen()) return undefined;
    if (t.phase() === 'prepare') return t.prepare;
    if (t.phase() === 'characterSelect') return t.select;
    return undefined;
  };

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
     * ① **全屏界面**（首页 / 选角色 / 自由模式 / 确认屏 / 选炁机 / 一局结束）
     * 盖住整屏 —— 先让**当前那一屏**消费，没消费掉的点击才轮到齿轮。
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
      const scrollable = scrollableScreen();
      if (t.phase() === 'home') t.home.hitTest(px, py);
      else if (t.phase() === 'characterSelect') t.select.hitTest(px, py);
      /**
       * ⚠️ **可拖拽滚动的两屏**（自由模式 / 确认屏）走**同一条**流水：
       * 判据是各自的 `isOnScrollable`（哪一块吃下这次滚动在 `dragDetail`
       * 里按坐标分），而"占了手势还要在松手时补一次点击"由 `onUp` 兜。
       */
      else if (scrollable !== undefined) {
        beginScrollOrHit(scrollable, event.pointerId, px, py);
      } else if (t.phase() === 'qijiSelect') t.qijiSelect.hitTest(px, py);
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
     * 可滚动界面（自由模式 / 确认屏）的拖拽（触屏滚说明 —— 与设置页那条
     * 同源）。⚠️ 用**上一帧的 y** 算位移：`scrollBy` 要的是增量，而指针事件
     * 给的是绝对坐标。
     *
     * ⚠️ `scrollDragMoved` 一旦为真就**不再变回假**：一次手势中间抖回去
     * （拖下去又拖回原点）仍然算"拖过"，松手时不该再补一次点击。
     *
     * ⚠️ 喂给**开始那一屏**（`scrollDragScreen`），不是按相位现查 ——
     * 一次手势中途换屏时，按相位查会把这一帧的位移喂给另一屏。
     */
    if (scrollDragId === event.pointerId && scrollDragScreen !== undefined) {
      const dy = py - scrollDragLastY;
      scrollDragLastY = py;
      if (dragExceedsTapSlop(scrollDragStartY, py, SCROLL_TAP_SLOP)) scrollDragMoved = true;
      if (scrollDragScreen.dragDetail(px, py, dy)) return;
    }
    /**
     * **当前这一屏的悬停**（详情区跟着鼠标走）——自由模式与选角色屏。
     *
     * ⚠️ 它排在设置面板的悬停**之前**，而两屏与面板**不会同时**吃这一下
     * （面板开着时 `hoverScreen()` 返回 `undefined`）—— 所以这不是"优先级"，
     * 而是"这一下属于谁"（`inputRouter` 那条纪律）。
     */
    const hover = hoverScreen();
    if (hover !== undefined) hover.hover(px, py);

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

  /**
   * 松手：可滚界面那一次手势若**没拖过**，就补一次 `hitTest`。
   *
   * ⚠️ 这一步是"可滚区里的点击"唯一的实现（见 `scrollDragMoved` 的说明）：
   * 按下时不敢下结论（可能是想滚动），松手才知道。
   * ⚠️ 补的是**松手那一刻**的坐标：手指几乎没动，两者等价；而用松手的
   * 那一个与浏览器的手势语义一致（点中的是"抬起时"那一张）。
   */
  const onUp = (event: PointerEvent): void => {
    if (scrollDragId === event.pointerId) {
      scrollDragId = null;
      const screen = scrollDragScreen;
      scrollDragScreen = undefined;
      if (!scrollDragMoved && screen !== undefined) {
        const { px, py } = at(event);
        screen.hitTest(px, py);
      }
      scrollDragMoved = false;
    }
    endReviewDrag(event);
    t.touch.onPointerUp(event.pointerId);
    endDrag(event);
  };

  /**
   * ⚠️ `pointercancel` 必须转发：手指划出画布 / 系统手势打断时，
   * 不释放会让引擎一直按那个技能的代价扣资源。
   *
   * ⚠️ 与 `onUp` 的区别是**不补 `hitTest`**：手指划出画布那次不该算"点了一下"
   * （否则"想滚却滑出去了"会顺手改掉层数）。`pointerleave` 也走这一条。
   */
  const onCancel = (event: PointerEvent): void => {
    /**
     * ⚠️ 指针离开画布 / 手势被打断：把悬停清掉。
     *
     * 不清的话详情区会一直停在最后划过的那一项 —— 而玩家看到的是
     * "鼠标已经不在任何卡片上了，面板却还写着某个人的技能表"。
     */
    hoverScreen()?.clearHover();
    if (scrollDragId === event.pointerId) {
      scrollDragId = null;
      scrollDragScreen = undefined;
      scrollDragMoved = false;
    }
    endReviewDrag(event);
    t.touch.onPointerCancel(event.pointerId);
    endDrag(event);
  };

  /**
   * **滚轮**（桌面）：服务**可滚动的整屏界面**（自由模式的详情区 / 确认屏的
   * 两栏）与「按键」页的技能详情区。
   *
   * ⚠️ 挂在这里而不是面板自己挂 `window`：输入归属只有一个入口
   * （本文件），面板只暴露 `isOnDetail` / `wheelDetail` —— 与滑块的
   * `isOnScaleSlider` / `dragScaleSlider` 同一分工。
   *
   * ⚠️ 用 `{ passive: false }` 是因为**可能**要 `preventDefault`：
   * 详情区滚得动时页面不该跟着滚。滚不动时**不拦**（那一下不属于面板）。
   */
  const onWheel = (event: WheelEvent): void => {
    /**
     * ⚠️ **可滚动的整屏界面先问一次**（它们不在设置面板里）：Boss 的招式
     * 说明 / 确认屏两栏的正文装不下时，滚轮要能滚它。没消费才轮到设置
     * 面板 / 页面。
     *
     * ⚠️ 判据是**当前这一屏**（`scrollableScreen()` = 自由模式 / 确认屏）：
     * 两屏共用这一条，而不是各写一份"我这一屏的滚轮"。
     */
    if (!t.settingsOpen()) {
      const scrollable = scrollableScreen();
      if (scrollable !== undefined) {
        const { px, py } = at(event);
        if (scrollable.wheelDetail(px, py, event.deltaY)) {
          event.preventDefault();
          return;
        }
      }
    }
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
