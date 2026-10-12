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
 * 它的显示名从 `ui/settings/keyNames` 的 `KEY_EDIT_KEYS.cancel` 取 ——
 * 与设置页第二行提示**同一份**映射（见 `ESC_SHORTCUT` 的说明）；
 * 触屏不显示（`IconButton.setShowShortcut`，与设置齿轮同一条路）。
 */

import type { Container } from 'pixi.js';
import { IconButton } from './IconButton';
import { PALETTE } from '../render/theme';
import { KEY_EDIT_KEYS } from './settings/keyNames';
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
 * 提示文字：`Esc`。
 *
 * ==================================================================
 * ⚠️ 用全仓**那一份**键名显示映射，不许自己拼
 * ==================================================================
 *
 * 旧版这里是 `ESCAPE_KEY.charAt(0).toUpperCase() + ...` —— 拼出来是
 * **`Escape`**，而全游戏其它地方（设置页那句"方向键选择，Enter 改键，
 * **Esc** 返回"）写的是 `Esc`。同一个键两个写法，看起来就是"返回按钮
 * 没跟设置同步"。
 *
 * 用户 2026-10-12 报的正是这个（"esc 看起来也没同步"）。
 *
 * 现在取「取消 / 返回」这个键**显示名**的唯一定义 —— 设置页第二行提示
 * 拼的就是它（`KEY_EDIT_KEYS.cancel.label`，值来自
 * `input/keyboard.reservedKeyLabel('escape')`）。它属于**键位表**而不是
 * 文案（AGENTS.md §3b：键名不进 i18n），所以改键时显示名跟着改。
 *
 * ⚠️ `ESCAPE_KEY`（`app/phaseLogic`）仍然是**行为**那一侧的真相
 * （按哪个键算返回）；两者各司其职：那边是 keycode，这边是显示名。
 */
const ESC_SHORTCUT = KEY_EDIT_KEYS.cancel.label;

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
       * 与设置齿轮**同一个组件、同一套视觉语言**（`IconButton`）：提示缩小、
       * 带黑色描边、压在自己图标的**左上角**。这里没有 `focusRing` ——
       * 返回不参与键盘焦点（`F1` 那个流程只管齿轮），画一圈永远不会亮的
       * 环只会误导。
       *
       * ⚠️ **没有 `hintPlacement`，也没有任何偏移** —— 提示摆哪儿是全应用
       * **一条规则**（`ICON_BUTTON_DEFAULTS.hintPlacement = 'overlap'` =
       * 压在图标左上角），与按钮在画布哪个角**无关**。齿轮在右上、本按钮
       * 在左上，两边都照它画。
       *
       * 旧版这里先写 `hintOffset: { dx: 34, dy: 22 }`（手调数字），后来又
       * 按"按钮在画布哪一半"翻角 —— 两条都是"两个角落两套算法"，用户
       * 2026-10-12 明确否掉（"**不用看在哪一半，全局统一风格**"）。
       */
      shortcut: ESC_SHORTCUT,
      hintSide: 'corner',
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

  /**
   * `Esc` 提示的**包围盒**（逻辑坐标；触屏隐藏时仍然算得出来）。
   *
   * ⚠️ 它**不是**给布局用的，是给验证用的：提示的落位全在
   * `IconButton.iconHintPlacement` 里推出来（一条全局规则），"压在自己
   * 图标左上角、且没伸出画布"这条结论需要一个读得到的数
   * （见 `__raidBattle.back.shortcutBounds`）。
   */
  get shortcutBounds(): { readonly x: number; readonly y: number; readonly w: number; readonly h: number } | undefined {
    return this.button.hintBounds;
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
