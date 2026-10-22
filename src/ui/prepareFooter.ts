/**
 * **备战屏底部那条**：开始按钮 + 操作提示 + 第三方素材声明。
 *
 * ==================================================================
 * 它是什么（一句话，没有"和"）
 * ==================================================================
 *
 * 它是屏幕**下半部分那一条**的画法：一颗「开始战斗」、它下面一行随状态
 * 变化的提示、以及贴底边的素材声明。
 *
 * ==================================================================
 * 为什么单独一个文件（AGENTS.md §3 的关注分离）
 * ==================================================================
 *
 * `PrepareScreen` 这一轮加了三样东西（详情区、炁机行、卡片头像），
 * 而这三件与"按钮怎么画"毫无关系。把它们都留在那个类里，它就会变成
 * "一个文件装了整个屏幕"（§3 点名的形状）。抽出来之后：
 *
 * | 文件 | 一句话 |
 * |---|---|
 * | 本文件 | 底部那一条（按钮 / 提示 / 声明）怎么画 |
 * | `PrepareScreen` | 光标与选择怎么走 |
 *
 * ==================================================================
 * ⚠️⚠️ 2026-10-13：**「开始战斗」四个字与它的按钮错位** —— 修在这里
 * ==================================================================
 *
 * 用户原话："开始战斗和按钮错位了"。
 *
 * 量出来的原因（不是猜的）：按钮**矩形**由布局表算出来
 * （旧版 `startRect()`：`pad + (playerColW - startW)/2` = **280**，
 * 中心 **328**），而按钮上的**文字**画在 `LOGICAL.width / 2` = **480**
 * —— 差 **152px**。于是画面上是"一颗空按钮 + 一串飘在它右边 150px 的字"。
 *
 * ⚠️ 根因不是"数字写错了"，而是**同一个东西有两个出处**：矩形来自
 * `prepareGeometry`（命中测试读它），文字的位置在这里又算了一遍。所以修法
 * 是**让文字从矩形推**（`start.x + start.w / 2`），而不是把 480 改成 328
 * —— 后者下次布局一动手又会漂。
 *
 * ==================================================================
 * ⚠️⚠️ 2026-10-13 第四轮：那一排**锚定画布底部**，说明与按钮**同一排**
 * ==================================================================
 *
 * 用户原话："**开始战斗 和 开始战斗下面的说明 其实可以放一排，
 * 并且 锚定在底部**"。
 *
 * | | 旧版 | 现在 |
 * |---|---|---|
 * | 按钮 y | 跟着三块内容走（`sectionsBottom + startGap`） | **从画布底边推**（`footerRowCenterY`） |
 * | 说明位置 | 按钮**下面**那一行、与按钮同心 | 按钮**右边**那一格、同一排（`footerHintSlot`） |
 * | 说明对齐 | 居中（`anchorX: 0.5`） | 左对齐（`anchorX: 0`），格宽固定 |
 *
 * ⚠️ 说明那一格的**宽度是常量**（`footerHintW`），不随文案变：切换键盘 /
 * 触屏时这一排不会左右跳。两套文案都必须放得下 —— 有单测钉着。
 *
 * ⚠️ 只有最底下的**素材声明**仍然居中于整张画布 —— 那是全屏的版权标示，
 * 不属于这一排。
 *
 * ==================================================================
 * ⚠️ 提示行承担一个**反馈职责**
 * ==================================================================
 *
 * 需求："不能开始战斗（选中它们时点开始应当无效，**或给明确反馈**）"。
 * 选中开发中的单位时，这一行从操作说明换成"开发中"三个字 ——
 * 而它**常驻**（不是点了才出现），所以玩家在点之前就看得见为什么点不动。
 */

import type { Container } from 'pixi.js';
import { FONT, LOGICAL } from './layout';
import { Label, type PixiCtor } from './primitives';
import { PALETTE } from '../render/theme';
import { PREPARE_LAYOUT } from './prepareLayout';
import { footerHintSlot, startRect } from './prepareGeometry';
import { PREPARE_SKIN } from './prepareRender';
import { TextButton } from './TextButton';
import type { TranslateFn } from '../i18n/translator';

export interface PrepareFooterOptions {
  readonly pixi: PixiCtor;
  readonly parent: Container;
  /**
   * 取词函数。
   *
   * ⚠️ 存在**构造参数**上（而不是构造之后再 `setTranslate`）：后者会在
   * "还没装好就被 `draw` 一次"时静默显示空字符串 —— 而空白的按钮比报错
   * 难查得多。
   */
  readonly translate: TranslateFn;
  /**
   * 要不要显示**键盘**提示（触屏为假 → 换成触屏那一句）。
   *
   * ⚠️ 它来自 `render/platform.capsOf(mode).showKeyHints`（操作方式那个
   * **唯一 flag** 派生出来的值），不在本文件里另判一次 —— 见 AGENTS.md §3b
   * 与 `PrepareFooter.draw` 的说明。
   */
  readonly showKeyHints: () => boolean;
}

/**
 * 本屏要拼上去的**键名**（键名不进 i18n，见 AGENTS.md §3b）。
 *
 * ⚠️ 它们与 `app/loopWiring.ts` 里真正接的键**一一对应**：
 *
 * | 键名 | 那一条 `case` |
 * |---|---|
 * | `方向键`（← → ↑ ↓） | 块**内**走光标（`prepare.cycle` / `prepare.stepVertical`） |
 * | `Enter` | 确定 / 切换炁机层数 / 开战（`prepare.confirm`） |
 * | `Tab` | **跨块**（`prepare.moveFocus`，Shift+Tab 反向） |
 * | `Shift+↑↓` | **滚详情区正文**（`prepare.scrollDetail`；不切焦点、不动光标） |
 *
 * ⚠️ 它们写成渲染层的常量（而不是 i18n 里的字面量）：改快捷键**不该**
 * 改语言包 —— 那正是 §3b 记着的那条（"改快捷键害得改 i18n 吗？"）。
 */
const PREPARE_KEY_NAMES = {
  confirm: 'Enter',
  tab: 'Tab',
  /**
   * ⚠️ 它**不是**"Shift + 方向键"的另一种写法，而就是键位本身：详情区
   * 只能靠 `Shift+↑↓` 滚（裸 ↑↓ 是块内走光标，见 `loopWiring` 的键位表）。
   */
  detailScroll: 'Shift+↑↓',
} as const;

/**
 * **提示行该写哪一句**（纯函数：状态 → 文案 key）。
 *
 * ==================================================================
 * 为什么单独抽出来（AGENTS.md §3 的关注分离 + §4 的"逻辑要有单测"）
 * ==================================================================
 *
 * 这一条是**会被写错、而截图上看不出来**的规则：截图只能证明"有一行字"，
 * 证明不了"触屏上**不该**出现 Enter"。而它错了的代价正是用户报的那条
 * —— 纯触屏玩家按提示去按一个不存在的键。
 *
 * 抽成纯函数之后可以在 node 里断言"触屏那一支永远不含键名"，不必起 Pixi。
 *
 * ```
 *   开发中的单位 → 换「开发中」（反馈优先于操作说明，见文件头）
 *   键盘         → `hintCursor` + 渲染层拼的键名（Enter / Tab / Shift+↑↓）
 *   触屏         → `hintTouch`（**不拼键名**）
 * ```
 *
 * @param showKeyHints `render/platform.capsOf(mode)` 的派生值（§3b 的
 *   唯一 flag）—— **不在这里再判一次"是不是触屏"**。
 * @returns 已经填好键名的**成品字符串**。
 */
export function prepareHintOf(
  translate: TranslateFn,
  state: { readonly developing: boolean; readonly showKeyHints: boolean },
): string {
  if (state.developing) return translate('roster.ui.developing');
  if (state.showKeyHints) {
    /**
     * ⚠️ **键名从这里拼上去**（`{confirm}` / `{tab}` 是参数）—— 语言包里
     * 只有标签（§3b：改快捷键不该改 i18n）。
     */
    return translate('roster.ui.hintCursor', PREPARE_KEY_NAMES);
  }
  return translate('roster.ui.hintTouch');
}

export class PrepareFooter {
  /** 「开始战斗」—— 共用组件（三处「开始」同源：选人 / 确认 / 备战）。 */
  private readonly startButton: TextButton;
  private readonly hint: Label;
  private readonly notice: Label;
  /**
   * 「开始战斗」的矩形（**唯一出处**：命中测试也读 `prepareGeometry.startRect`）。
   *
   * ⚠️ 文字 / 说明的 x **全部从它推** —— 这是"错位"那个 bug 的结构性修法，
   * 见文件头。
   */
  private readonly start: ReturnType<typeof startRect>;
  /** 操作说明那一格（按钮右边，同一排）。 */
  private readonly hintSlot: ReturnType<typeof footerHintSlot>;

  constructor(private readonly options: PrepareFooterOptions) {
    const { pixi, parent } = options;
    this.start = startRect();
    this.hintSlot = footerHintSlot();
    /**
     * ⚠️ 中心由 `startCenterX` 给（= 矩形中心，**不是** `LOGICAL.width / 2`）
     * —— 见文件头：这一条就是"错位"那个 bug 的修法，而且是**可单测**的
     * （`tests/unit/prepareLayout.test.ts` 断言"文字中心 = 矩形中心"）。
     */

    this.startButton = new TextButton({
      pixi,
      rect: this.start,
      label: options.translate('roster.ui.start'),
      kind: 'primary',
      size: FONT.body,
      kai: false,
      /**
       * ⚠️ **不绑 `onPress`**：这一屏的点击由 `PrepareScreen.hitTest` 用
       * `startRect()` 判（那是它原本就有的路径，含"开发中不给开局"的判据），
       * 这里只负责**画**。绑一份会让"点一下执行两次"。
       */
    });
    this.hint = new Label(pixi, {
      /** ⚠️ 贴在按钮**右边那一格**的左端（`anchorX: 0` = 左对齐）。 */
      x: this.hintSlot.x,
      /**
       * ⚠️ 与按钮**同一个垂直中心**（同一排）—— 这一条就是用户要的
       * "开始战斗和说明放一排"。
       */
      y: this.start.y + this.start.h / 2,
      size: FONT.tiny,
      color: PALETTE.textDim,
      anchorX: 0,
      anchorY: 0.5,
    });
    /**
     * 页脚声明：贴屏幕**底边、居中于整张画布**（它是全屏的版权标示，
     * 不属于那一排）。
     *
     * ⚠️ 它不是装饰，是**权利归属的标示**（素材取自《炎龍騎士團2》）。
     * 字号用 `FONT.small`(13) 而不是 `FONT.tiny`(11) —— 中文有 13 的
     * 下限（见 `layout.ts` 的字号表）。
     * ⚠️ 位置（底边距离 / 字号）来自布局表 —— 那一排的 y 就是**从它反推**
     * 的（`footerRowCenterY`），两处各写一个数必然叠在一起或留着怪缝。
     */
    this.notice = new Label(pixi, {
      x: LOGICAL.width / 2,
      y: LOGICAL.height - PREPARE_LAYOUT.noticeGap,
      size: PREPARE_LAYOUT.noticeSize,
      color: PALETTE.textDim,
      anchorX: 0.5,
      anchorY: 0.5,
    });

    parent.addChild(this.startButton.root, this.hint.root, this.notice.root);
  }

  /**
   * 画一帧。
   *
   * @param cursored 光标停在「开始战斗」上（只有这一种态 —— 它不是选项，
   *   没有"已选中"，见 `prepareRender.startSkin`）。
   * @param developing 当前的**选择**里有开发中的单位（灰掉 + 换提示）。
   */
  draw(cursored: boolean, developing: boolean): void {
    const translate = this.options.translate;
    /** ⚠️ `developing` → `setEnabled(false)`：组件用 `startSkin` 的禁用皮肤 ✓。 */
    this.startButton.setEnabled(!developing);
    this.startButton.setFocused(cursored);
    /**
     * ⚠️ **两种模式两句话**（用户："触屏底部的提示 显示触屏的版本"）：
     *
     * ```
     *   键盘 → `roster.ui.hintCursor` + 渲染层拼上的键名（Enter / Tab / Shift+↑↓）
     *   触屏 → `roster.ui.hintTouch`（**不拼键名** —— 触屏没有这些键）
     * ```
     *
     * ⚠️ 判据是 `showKeyHints`（操作方式唯一 flag 的**派生值**），不是
     * 本文件里再探测一次"是不是触屏"：两处判断会漂，而漂的表现是
     * "触屏提示里出现 Enter"（旧版正是如此）。
     */
    this.hint.set(
      prepareHintOf(translate, { developing, showKeyHints: this.options.showKeyHints() }),
    );
    this.hint.setColor(developing ? PREPARE_SKIN.selectionText : PALETTE.textDim);
    this.notice.set(translate('roster.ui.notice'));
  }
}
