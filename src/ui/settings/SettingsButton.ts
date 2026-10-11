/**
 * 战斗 HUD 上的设置按钮。
 *
 * ------------------------------------------------------------------
 * 这里只剩"放哪儿 + 写什么键位"，视觉与交互都在 `IconButton` 里
 * ------------------------------------------------------------------
 *
 * 原先这个文件自己画图标、自己算命中、自己管悬停/焦点状态。
 * 抽成通用组件（`ui/IconButton.ts`）之后，它退化成一层薄封装：
 *
 *   - 位置：右下角，压在技能栏上方
 *   - 内容：齿轮图标 + 快捷键提示
 *
 * 需求："进入设置也要支持快捷键，而且要写在图标旁边。
 * 这个最好抽成组件，以后非战斗画面会经常用。"
 */

import type { Container } from 'pixi.js';
import { PALETTE } from '../../render/theme';
import { IconButton } from '../IconButton';
import { LAYOUT, LOGICAL } from '../layout';
import type { PixiCtor } from '../primitives';
import type { TranslateFn } from '../../i18n/translator';

export interface SettingsButtonOptions {
  readonly pixi: PixiCtor;
  readonly translate: TranslateFn,
  readonly onClick: () => void;
}

/**
 * 按钮几何。
 *
 * ==================================================================
 * 演进：右下角 → **玩家面板右侧**（需求："设置按钮，暂时挪到玩家面板
 * 的右侧"）
 * ==================================================================
 *
 * 原先在右下角（压在技能栏上方）。但那块地方要留给移动端的**双弧
 * 触屏按钮**（外弧半径 210，最左缘到 `x 654`），必须让开。
 *
 * 新位置离右下角的拇指区更近，而且 `x 244..288` 与双弧最左缘之间
 * 还有 366px 余量（见 `docs/plans/2026-10-10-m8-mobile.md` §2.2）。
 */
const MARGIN = 8;
/** 按钮区域的边长（含可点范围），比图标本身大一圈。 */
const HIT = 44;

/**
 * 两个界面各自的锚点。
 *
 * ==================================================================
 * 为什么按界面分开：这个按钮是**两个界面共用的**（挂在 stage 上）
 * ==================================================================
 *
 * 它在**战斗界面**只能待在日志下方 —— 右上角被 Boss 血条（贴顶、通栏）
 * 和 Boss debuff 行占着，放上去会重叠（这段演进史记在下面的 `anchor` 注释里）。
 *
 * 但**备战界面没有战斗 HUD**（整屏覆盖），右上角完全是空的，
 * 而日志下方在备战界面看起来是"悬在左边空白里"。
 *
 * 所以按界面换位置，而不是二选一牺牲一个界面。
 */
const ANCHOR_BATTLE = {
  x: LAYOUT.log.x + MARGIN + HIT / 2,
  y: LAYOUT.log.y + LAYOUT.log.h + MARGIN + HIT / 2,
} as const;

/** 备战界面：右上角。`LOGICAL` 是 960×540。 */
const ANCHOR_PREPARE = {
  x: LOGICAL.width - MARGIN - HIT / 2,
  y: MARGIN + HIT / 2,
} as const;

/** 当前应用到 root 上的偏移（相对构造时的锚点）。 */
type Offset = { readonly x: number; readonly y: number };

export class SettingsButton {
  readonly root: Container;

  private readonly button: IconButton;
  /**
   * 包在按钮外面的一层容器，**只用来整体位移**。
   *
   * ⚠️ 为什么需要它：`IconButton` 把锚点**烤进了子对象的绝对坐标**
   * （`icon.root.x = box.iconX` 之类），构造之后改不了。所以这里套一层
   * 容器做偏移，而不是去动 `IconButton` 的内部布局。
   *
   * ⚠️ 套了容器就必须**同步修正命中测试与 bounds** —— 它们原本读的是
   * `IconButton` 里的坐标。漏掉这一步，按钮会"看着在新位置、点在老位置"。
   */
  private readonly outer: Container;

  private offset: Offset = { x: 0, y: 0 };

  /** 键盘焦点是否在齿轮上（见 `isFocused` 的说明）。 */
  private focused = false;

  constructor(options: SettingsButtonOptions) {
    const { pixi } = options;
    this.button = new IconButton({
      pixi,
      icon: 'gear',
      /**
       * 图标 + 快捷键提示，贴在**玩家面板右侧**。
       *
       * 面板在 `x 8..236, y 452..532`（见 `LAYOUT.player`）。
       * 按钮在它右缘外 `MARGIN` px，并且**底边与面板底边对齐**
       * （需求："设置icon，可以贴着底部和 人物面板底部对齐"）。
       *
       * ⚠️ 原先取的是面板**垂直中心**（`y = 452 + 40 = 492`），于是按钮
       * 底边落在 512、比面板底(532)高 20px —— 看起来"吊在半空"。
       * 改成 `y = 面板底 - HIT/2` 之后底边精确贴齐（532）。
       * ⚠️ 用 `LAYOUT.player.y + LAYOUT.player.h` 表达而不是写 `532`：
       * 面板位置是布局表的事，这里只引用它（避免两处真相）。
       */
      /**
       * **战斗日志下方、贴着屏幕左边**（需求："设置按钮 挪到 log 下方，
       * 贴着屏幕左边"）。
       *
       * 演进：玩家面板右侧 → 右上角 → **日志下方**。
       *   1. 玩家面板右侧那块被**玩家 buff / debuff 两行**占用了
       *   2. 右上角与 **Boss debuff 行**（`y=40` 起）离得太近，视觉上挤
       *   3. 日志下方左侧是**真空**：日志占 `y 70..270`，它下面到玩家
       *      buff 行（`y=479`）之间一大片没有别的元素
       *
       * ⚠️ 用 `LAYOUT.log` 表达而不是写死 `281`：日志的位置是布局表的事，
       * 这里只引用它（避免两处真相 —— 日志一改按钮就跟不上）。
       * 左边与日志**同一列**（`x = 日志左边 + MARGIN`），这样两者左对齐。
       */
      anchor: {
        x: LAYOUT.log.x + MARGIN + HIT / 2,
        y: LAYOUT.log.y + LAYOUT.log.h + MARGIN + HIT / 2,
      },
      /**
       * 需求："设置按钮，Esc 在 icon 的左边……这个设计不对，
       * esc 应该比较小，然后再设置按钮的左上角。"
       *
       * 所以用 `corner` 模式：提示缩小到 9px、带黑色描边、
       * 贴在齿轮的**左上角**（不占按钮本体的布局）。
       */
      shortcut: options.translate('settings.openKey'),
      hintSide: 'corner',
      /**
       * ================================================================
       * 焦点外观：**不填色**，只加一圈冷色描边
       * ================================================================
       *
       * 需求（用户）："设置按钮 有时也会被变黄" —— 齿轮被键盘聚焦时
       * 沿用了 `IconButton` 的默认高亮色（`douqi.bright`，金色），
       * 而备战界面**已确定的角色卡也是金色**，于是"光标在这儿"
       * 和"这一项已经选定了"看起来是同一个东西。
       *
       * 两处修正，都走同一条语言（**冷色 = 光标，暖金 = 选中**）：
       *   1. `brightColor` 换成 `PALETTE.focus`（冷白偏蓝，见 `render/theme.ts`）
       *   2. **焦点环**：键盘焦点才画的一圈描边。留下一个不依赖颜色的
       *      线索 —— 两者同时出现在画面上时也能一眼分开（色弱视角同理）
       *
       * ⚠️ 环**只描边、不填色**：填色版本（"给它一个底板"）会在战斗
       * 界面把齿轮画成一个方块，而那里的图标按钮本来是无底的
       * （见 `IconButton` 文件头的"没有边框、没有底色"）。
       */
      brightColor: PALETTE.focus,
      focusRing: true,
      onClick: options.onClick,
    });

    /**
     * 构造时按**战斗界面**的锚点摆好；备战界面由 `setScreen('prepare')`
     * 再偏移过去（见那两个 `ANCHOR_*` 常量）。
     */
    this.outer = new pixi.Container();
    this.outer.addChild(this.button.root);
    this.root = this.outer;
  }

  /**
   * 按当前界面摆放。
   *
   * 偏移量在**这一层**算（`ANCHOR_PREPARE - ANCHOR_BATTLE`），
   * 调用方只说"现在是哪个界面"，不需要知道任何坐标 ——
   * 布局知识留在 UI 层，与 `LAYOUT` 的用法一致。
   */
  setScreen(screen: 'prepare' | 'battle'): void {
    const target = screen === 'prepare' ? ANCHOR_PREPARE : ANCHOR_BATTLE;
    this.offset = { x: target.x - ANCHOR_BATTLE.x, y: target.y - ANCHOR_BATTLE.y };
    this.outer.position.set(this.offset.x, this.offset.y);
  }

  /**
   * ⚠️ 命中测试必须**减掉偏移**。
   *
   * `IconButton.hitTest` 读的是它内部那份**绝对逻辑坐标**的 `rect`；
   * 我们只是把外层容器挪了位置，它并不知道。不减偏移就会出现
   * "按钮画在右上角、但点在日志下方才响应"。
   */
  hitTest(px: number, py: number): boolean {
    return this.button.hitTest(px - this.offset.x, py - this.offset.y);
  }

  /**
   * 显示/隐藏整个按钮。
   *
   * 用途：**设置面板打开时隐藏它**。按钮原先在面板打开后仍然可见
   * （实测 `stage.children[1].visible === true`），于是齿轮和它的提示
   * 从面板左下角露出来，既重叠又让人以为可以点。
   *
   * ⚠️ 面板的命中测试已经会拦下点击（`settingsOpen` 分支），所以
   * 这只是**视觉**修正 —— 但不修就是假的"可点"暗示。
   */
  setVisible(visible: boolean): void {
    this.root.visible = visible;
  }

  /** 隐藏快捷键提示（触屏设备）。见 `IconButton.setShowShortcut`。 */
  setShowShortcut(show: boolean): void {
    this.button.setShowShortcut(show);
  }

  /** 指针悬停。 */
  setHovered(hovered: boolean): void {
    this.button.setHovered(hovered);
  }

  /** 键盘焦点。 */
  setFocused(focused: boolean): void {
    this.focused = focused;
    this.button.setFocused(focused);
  }

  /**
   * 键盘焦点是否在齿轮上。
   *
   * ⚠️ 在这一层也留一份，是为了**调试入口**（`app/debugApi.ts` 的
   * `settings.buttonFocused()`）能读到它 —— `IconButton` 把 `focused`
   * 藏成了私有字段，而"看按钮到底有没有聚焦"在 headless 验证里
   * 是分辨"没聚焦"与"聚焦了但没画出来"的唯一办法。
   */
  get isFocused(): boolean {
    return this.focused;
  }

  /** 每帧（状态变化时才真正重绘）。 */
  update(): void {
    this.button.update();
  }

  /**
   * 可点区域（供调试与布局断言）。
   *
   * ⚠️ 与 `hitTest` 同源：也要**加上偏移**，否则调试探针报的是老位置，
   * "看起来按钮没动"——而实际上只是这里漏改了。
   */
  get bounds(): { readonly x: number; readonly y: number; readonly w: number; readonly h: number } {
    const b = this.button.bounds;
    return { x: b.x + this.offset.x, y: b.y + this.offset.y, w: b.w, h: b.h };
  }
}
