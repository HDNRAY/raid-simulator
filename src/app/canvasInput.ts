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
 * ⚠️ 顺序即优先级，五条都不能动
 * ==================================================================
 *
 *   1. **齿轮按钮**（首页 / 选角色 / 自由模式）—— 这三个界面盖住整屏，
 *      而齿轮浮在最上层
 *   2. **返回箭头**（自由模式 / 选角色屏，左上角）—— 与齿轮同一种东西
 *      （浮在整屏界面之上的可点控件），所以与它挨着；**必须早于界面本身**
 *      （界面不消费左上角那块地方，排在后面就成了"看得见、点不动"）
 *   3. **当前那一个全屏界面**（首页 / 选角色 / 自由模式）—— 没消费的
 *      点击才往下走
 *   4. **结算中点击 = 离开战斗** —— 必须早于按钮层与设置判断
 *   5. **触屏按钮** —— 它自己会在"设置打开"时拒绝消费
 *
 * 每条的由来都写在各自的位置上（都是实测踩出来的）。
 */

import { LOGICAL_H, LOGICAL_W } from '../render/scaling';
import type { SettingsPanel } from '../ui/settings/SettingsPanel';
import type { SettingsButton } from '../ui/settings/SettingsButton';
import type { PrepareScreen } from '../ui/PrepareScreen';
import type { Phase } from './flow';

/** 指针要路由到的对象。 */
export interface CanvasInputTargets {
  readonly canvas: HTMLCanvasElement;
  /** 首页（默认入口）。 */
  readonly home: { hitTest(px: number, py: number): boolean };
  /** 选角色屏（肉鸽模式的第一屏）。 */
  readonly select: { hitTest(px: number, py: number): boolean };
  /** 自由模式（原备战界面）。 */
  readonly prepare: PrepareScreen;
  /**
   * 整屏界面共用的**返回箭头**（左上角；自由模式 / 选角色屏）。
   *
   * ⚠️ 它**不属于**任何一屏，所以必须显式排在①②之间（见下面 `onDown`
   * 那段"顺序即优先级"）：放在界面之后的话，界面自己的 `hitTest` 会先
   * 拿到这次点击 —— 而两个屏都**不消费**左上角那块地方，于是箭头看起来
   * 能点、实际点不动。
   */
  readonly back: { hitTest(px: number, py: number): boolean };
  readonly settings: SettingsPanel;
  readonly settingsButton: SettingsButton;
  /** 触屏控件（按钮层 + 输入源）。 */
  readonly touch: {
    readonly caps: { readonly showKeyHints: boolean };
    onPointerDown(pointerId: number, px: number, py: number): boolean;
    onPointerUp(pointerId: number): void;
    onPointerCancel(pointerId: number): void;
  };
  /** 当前阶段。 */
  phase(): Phase;
  settingsOpen(): boolean;
  /** 打开设置（点齿轮）。 */
  openSettings(): void;
  /** 战斗已结束（用来判"点屏幕离开战斗"）。 */
  battleEnded(): boolean;
  /** 离开战斗（按模式分流：肉鸽 → 选角色；自由 → 自由模式界面）。 */
  backFromBattle(): void;
}

/**
 * 装上四个指针监听。
 *
 * @returns 卸载函数（`dispose` 用；虽然页面生命周期内不会调，但显式一点）。
 */
export function wireCanvasPointer(t: CanvasInputTargets): () => void {
  /** CSS 尺寸 → 逻辑坐标（canvas 内部分辨率固定，靠 CSS 缩放）。 */
  const at = (event: PointerEvent): { px: number; py: number } => {
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

  const onDown = (event: PointerEvent): void => {
    const { px, py } = at(event);

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
     */
    if (t.phase() !== 'battle' && !t.settingsOpen()) {
      /**
       * ⚠️ **齿轮要先判**：它是这些界面上**唯一**浮在界面之上的可点元素
       * （右上角，见 `SettingsButton` 的锚点）。
       *
       * 原先备战那条分支无条件 `return`（不管界面有没有消费这次点击），
       * 于是**备战界面里点齿轮完全没反应** —— 一个看起来能点、实际是死的
       * 按钮。首页现在是**默认入口**，同一个 bug 在那里会更显眼
       * （而且触屏玩家没有 `F1`，等于完全进不去设置 —— 触屏只能点齿轮）。
       */
      if (t.settingsButton.hitTest(px, py)) {
        t.openSettings();
        return;
      }
      /**
       * ⚠️ **返回箭头排在界面之前**（顺序即优先级，见上面那段）。
       *
       * 它的可见相位由 `applyPhase` 决定，`hitTest` 自己也判一次
       * `visible`（不可见时不该吃掉点击）。命中后**整个 return**：
       * 一次点击只能做一件事 —— 继续往下走会同时点中底下的卡片。
       */
      if (t.back.hitTest(px, py)) return;
      if (t.phase() === 'home') t.home.hitTest(px, py);
      else if (t.phase() === 'characterSelect') t.select.hitTest(px, py);
      else t.prepare.hitTest(px, py);
      return;
    }

    /**
     * ② **结算中：点屏幕任意处 = 离开战斗**。
     *
     * ⚠️ 必须**先于**按钮层与设置判断，且整体 `return`：
     *   - 放在按钮层之后：按钮会 `return true` 吃掉点击 → 玩家点在按钮弧里
     *     **永远重开不了**（实测点「斩」不重开、点空白才重开）
     *   - 不 `return`：会同时满足 `settingsButton.hitTest` → 一次点击
     *     **既开设置又静默重开**（实测 tick 663 → 43）
     *
     * ⚠️ `t.phase() === 'battle'` 这个前置条件是**必需的**：`battleEnded()`
     * 读的是 `state.loop`，而**非战斗阶段它是 `undefined`** ——
     * `undefined !== 'running'` 为真，没有这个守卫就会"在首页点一下屏幕
     * 就被送去选角色 / 备战界面"。原先靠 ① 无条件 `return` 挡住，
     * 现在**显式写出来**，不再依赖分支顺序这种隐式前提。
     */
    if (t.phase() === 'battle' && !t.touch.caps.showKeyHints && t.battleEnded()) {
      t.backFromBattle();
      return;
    }

    /**
     * ③ 触屏按钮优先，但它自己在"设置打开"时会拒绝消费
     * （见 `touchControls` 的点击路由说明）。
     */
    if (t.touch.onPointerDown(event.pointerId, px, py)) return;

    if (!t.settingsOpen()) {
      if (t.settingsButton.hitTest(px, py)) t.openSettings();
      return;
    }
    draggingSlider = t.settings.hitTest(px, py) && t.settings.isOnScaleSlider(px, py);
  };

  const onMove = (event: PointerEvent): void => {
    const { px, py } = at(event);
    /** 拖滑块优先 —— 一次手势一旦从滑块开始，就不要再被悬停抢走。 */
    if (draggingSlider) {
      t.settings.dragScaleSlider(px);
      return;
    }
    /**
     * 鼠标悬停到技能格 = **选中它**（需求："方向键选中和鼠标选中，
     * 应该合并"）。与方向键走同一条路径，所以高亮与详情完全一致。
     */
    t.settings.hoverSkill(px, py);
  };

  const endDrag = (): void => {
    draggingSlider = false;
  };

  const onUp = (event: PointerEvent): void => {
    t.touch.onPointerUp(event.pointerId);
    endDrag();
  };

  /**
   * ⚠️ `pointercancel` 必须转发：手指划出画布 / 系统手势打断时，
   * 不释放会让引擎一直按那个技能的代价扣资源。
   */
  const onCancel = (event: PointerEvent): void => {
    t.touch.onPointerCancel(event.pointerId);
    endDrag();
  };

  t.canvas.addEventListener('pointerdown', onDown);
  t.canvas.addEventListener('pointermove', onMove);
  t.canvas.addEventListener('pointerup', onUp);
  t.canvas.addEventListener('pointercancel', onCancel);
  /** `pointerleave` 与 cancel 同义：离开画布就该松开。 */
  t.canvas.addEventListener('pointerleave', onCancel);

  return () => {
    t.canvas.removeEventListener('pointerdown', onDown);
    t.canvas.removeEventListener('pointermove', onMove);
    t.canvas.removeEventListener('pointerup', onUp);
    t.canvas.removeEventListener('pointercancel', onCancel);
    t.canvas.removeEventListener('pointerleave', onCancel);
  };
}
