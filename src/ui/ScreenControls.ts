/**
 * **整屏界面共用的控件（目前只有"返回"）**。
 *
 * ==================================================================
 * 为什么单独一个文件
 * ==================================================================
 *
 * `Esc` 从"打开设置"改成 **`F1`** 之后腾出来做**返回**
 * （用户 2026-10-12："肯定要加返回啊" + "把设置的快捷键改成别的 比如 f1"）。
 *
 * ⚠️ **触屏必须对等**（AGENTS.md §3b）：`Esc` 只有键盘玩家按得出，
 * 所以自由模式 / 选角色屏的左上角要有一个**可见、可点**的返回箭头
 * —— 那正是这个组件。它被**两个界面共用**，所以不能画在任何一个屏里：
 * 两份实现必然漂移（"选角色屏的箭头能点、自由模式的不行"）。
 *
 * 它**不属于** `HomeScreen` / `CharacterSelectScreen` / `PrepareScreen`
 * 中的任何一个，而是挂在 stage 上（与设置齿轮、触屏按钮层同一个层次），
 * 显隐由 `applyPhase` 按 `phaseLogic.CONTROL_VISIBILITY.back` 决定
 * —— "显隐只有一个写入点"这条纪律不许破。
 *
 * ==================================================================
 * 键位提示不进 i18n
 * ==================================================================
 *
 * 提示里那三个字母 `Esc` 是**键位**、不是文案（AGENTS.md §3b）。
 * 所以它从 `phaseLogic.ESCAPE_KEY` 取，由本组件拼出来；触屏不显示
 * （`IconButton.setShowShortcut`，与设置齿轮同一条路）。
 */

import type { Container } from 'pixi.js';
import { IconButton } from './IconButton';
import { PALETTE } from '../render/theme';
import { ESCAPE_KEY } from '../app/phaseLogic';
import type { PixiCtor } from './primitives';

export interface ScreenControlsOptions {
  readonly pixi: PixiCtor;
  /** 点返回箭头。 */
  readonly onBack: () => void;
  /**
   * 是否显示键位提示（触屏为假）。
   *
   * ⚠️ 与 `HomeScreenOptions.showKeyHints` 同一条理由：传**取值函数**
   * 而不是布尔 —— 触屏能力值由 `app/touchSetup.ts` 在本组件构造**之后**
   * 才探测出来（装配顺序使然）。
   */
  readonly showKeyHints: () => boolean;
}

/**
 * 箭头尺寸与左上角边距。
 *
 * ⚠️ 与设置齿轮**镜像对称**（它在右上角、同样 8px 边距），所以两个按钮
 * 在整屏界面上是左右对称的一对。箭头取 22（齿轮默认 20）：箭头笔画少，
 * 同尺寸看起来更小。
 */
const ARROW_SIZE = 22;
const MARGIN = 8;

/**
 * 提示文字：`Esc` 的**大写写法**。
 *
 * ⚠️ 从 `ESCAPE_KEY`（`'escape'`）拼出来，而不是再写一遍字面量：
 * 键位只有一处定义，改键时不会出现"提示还写着旧键"
 * （这正是 AGENTS.md §3b 要防的那类漂移）。
 */
const ESC_SHORTCUT = ESCAPE_KEY.charAt(0).toUpperCase() + ESCAPE_KEY.slice(1);

export class ScreenControls {
  readonly root: Container;

  private readonly options: ScreenControlsOptions;
  /** 可点区域（含角落提示）。命中测试与调试探针共用它。 */
  private readonly button: IconButton;

  constructor(options: ScreenControlsOptions) {
    this.options = options;
    const { pixi } = options;

    this.root = new pixi.Container();
    this.root.visible = false;

    this.button = new IconButton({
      pixi,
      icon: 'arrow-left',
      size: ARROW_SIZE,
      color: PALETTE.textDim,
      brightColor: PALETTE.focus,
      /**
       * 与设置齿轮**同一套视觉语言**：提示缩小、带黑色描边、贴在图标**左上角**
       * （`corner` 模式）。这里没有 `focusRing` —— 返回不参与键盘焦点
       * （`F1` 那个流程只管齿轮），画一圈永远不会亮的环只会误导。
       */
      shortcut: ESC_SHORTCUT,
      hintSide: 'corner',
      /**
       * ⚠️ 提示要**往右往下挪**：这一屏的箭头挂在画布**左上角**，
       * `IconButton` 的默认角落偏移（`+12 / +12`，按右上角的齿轮量的）
       * 会让 `Esc` 的字形伸到画布外面 —— 实测连着两版都被裁掉
       * （第一版裁顶部，第二版裁左边）。
       *
       * 提示的锚点是**右下角**（`anchor = (1,1)`），所以它在画布上的位置是
       * `(box.iconX + 12 + dx, box.iconY + 12 + dy)` 往左上展开。
       * 实测（`RAID_SHOT_TEXT=1` 的 dump）：`(dx, dy) = (8, 8)` 与 `(12, 14)`
       * 时提示的左边都在画布外（`x = 32`，而 "Escape" 约 37px 宽 → 左缘 `-5`）。
       *
       * 取 `+34 / +22` 之后锚点在 `(54, 54)`、字形约占 `x 17..54, y 40..54`：
       * 全部落在画布内，而且仍在左上的"角落"那一带（不会跑到标题旁边）。
       */
      hintOffset: { dx: 34, dy: 22 },
      anchor: { x: MARGIN + ARROW_SIZE / 2, y: MARGIN + ARROW_SIZE / 2 },
      onClick: () => options.onBack(),
    });
    this.root.addChild(this.button.root);

    /** 初值：装配期先按"桌面"画，主循环第一帧会按真实能力纠正。 */
    this.update();
  }

  get visible(): boolean {
    return this.root.visible;
  }

  /**
   * 显示 / 隐藏。
   *
   * ⚠️ **只由 `game.ts` 的 `applyPhase` 调**（显隐的唯一写入点）。
   */
  setVisible(visible: boolean): void {
    this.root.visible = visible;
  }

  /** 点一下（逻辑坐标）。@returns 是否命中（命中即已经触发返回） */
  hitTest(px: number, py: number): boolean {
    if (!this.root.visible) return false;
    return this.button.hitTest(px, py);
  }

  /** 可点区域（调试探针读它，用来在截图脚本里精确点中）。 */
  get bounds(): { readonly x: number; readonly y: number; readonly w: number; readonly h: number } {
    return this.button.bounds;
  }

  /** 每帧：键位提示跟着触屏能力走（能力值晚于构造才知道）。 */
  update(): void {
    this.button.setShowShortcut(this.options.showKeyHints());
  }
}

/** 箭头中心的逻辑坐标 —— 截图脚本用它来"点返回"（与 `bounds` 同源）。 */
export function backButtonCenter(): { readonly x: number; readonly y: number } {
  return { x: MARGIN + ARROW_SIZE / 2, y: MARGIN + ARROW_SIZE / 2 };
}
