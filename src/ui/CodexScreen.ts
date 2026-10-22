/**
 * **图鉴**（2026-10-20，用户："首页加一个'图鉴'按钮，目前暂时所有的'已解锁'
 * 炁机（未解锁的 保持 UI 然后内容 '？？？'）"）。
 *
 * ==================================================================
 * 它是什么（一句话）
 * ==================================================================
 *
 * 首页进来的**只读**清单：所有炁机各一张卡 —— 已解锁的显示**名字**，
 * 未解锁的卡片照画、名字画成 **？？？**。
 *
 * ```
 *   首页（默认入口）
 *     ├─ 「肉鸽模式」 → 选角色屏 → 一局肉鸽
 *     ├─ 「自由模式」 → 备战界面
 *     └─ 「图鉴」     → 本屏（Esc / 返回箭头回首页）
 * ```
 *
 * ==================================================================
 * ⚠️ 它不判断解锁、也不认识 `RunState`
 * ==================================================================
 *
 * 两条都收在入口那一侧（`app/screenSetup.ts` 的取值函数）：
 *   - **解锁判定**只有一份（`core/run/unlock.isUnlocked`）
 *   - **"有没有一局"** 由 `app/` 回答（有 ⇒ 用那一局的统计；没有 ⇒ 只认
 *     `always`）
 *
 * 这一屏拿到的只是 `CodexEntry[]`（名字 key 可能是 `undefined` = ？？？）。
 *
 * ==================================================================
 * 交互（键盘与触屏对等，AGENTS.md §3b）
 * ==================================================================
 *
 *   - 键盘 `Esc` / 返回箭头 / 点屏幕任意处：回首页（本屏是**只读**的，
 *     没有"选中"可言 —— 所以没有光标，也没有 `Enter` 的语义）
 *   - 齿轮：打开设置（与其它整屏界面同一条）
 */

import type { Container, Graphics } from 'pixi.js';
import { FONT, LOGICAL } from './layout';
import { Label, type PixiCtor } from './primitives';
import { ScreenChrome } from './ScreenChrome';
import { PALETTE } from '../render/theme';
import { CARD_RADIUS, cardSkin } from './prepareRender';
import {
  CARD_TEXT_INSET,
  CODEX_LAYOUT,
  clampScrollOffset,
  cardTextPlan,
  codexCardRects,
  codexGridLeft,
  codexGridWidth,
  maxScrollOffset,
  wrapByChars,
  wrapHardLines,
  type CodexEntry,
  CODEX_LINE_H,
} from './codexLogic';
import {
  attachViewportMask,
  drawViewportClip,
  fullyOutside,
  type ViewportRect,
} from './viewportMask';
import { paintScrollBar } from './scrollBarPaint';
import { stripEmphasis } from './emphasis';
import { RichLine } from './richLine';
import type { TranslateFn } from '../i18n/translator';

export interface CodexScreenOptions {
  readonly pixi: PixiCtor;
  readonly translate: TranslateFn;
  /** 这一屏要显示的条目（**每次显示现取**：开发模式可能中途切）。 */
  readonly getEntries: () => readonly CodexEntry[];
  /** 有没有进过一局（只影响摘要那行怎么措辞）。 */
  readonly hasRun: () => boolean;
  readonly showKeyHints: () => boolean;
  readonly f1Label: () => string;
  readonly onGear: () => void;
  /** 返回首页（`Esc` / 返回箭头 / 点屏幕任意处都走它）。 */
  readonly onBack: () => void;
  /** 开发模式（摘要那行加一个标记，免得"全都解锁了"被当成 bug）。 */
  readonly devMode: () => boolean;
}

export class CodexScreen {
  readonly root: Container;

  private readonly options: CodexScreenOptions;
  private readonly bg: Graphics;
  /**
   * **卡片层**（2026-10-22）：卡片与卡片文字全在这里，整层被一块矩形
   * `mask` 裁到视口里 ⇒ 滚动时**按像素**切（HTML 的 `overflow: hidden`）。
   *
   * ⚠️ 与 AGENTS.md §3e 的关系写在 `viewportMask` 的文件头（那条规则的
   * 唯一理由是 headless 截图，用户已明确要求 HTML 式滚动）。
   */
  private readonly cardsLayer: Container;
  private readonly maskGfx: Graphics;
  /** 卡片形状画层（在 `cardsLayer` 里，跟着 mask 被裁）。 */
  private readonly gfx: Graphics;
  /** 滚动条那一层（**在 mask 外面** —— 它自己不该被裁）。 */
  private readonly overlayGfx: Graphics;
  private readonly title: Label;
  private readonly summary: Label;
  private readonly hint: Label;
  /**
   * 每张卡片的两个 Label（名字 / 效果说明）—— 卡片数量按最大池子预建。
   *
   * ⚠️ **没有"状态行"**（2026-10-22 用户："不需要显示是否已解锁，？？？就
   * 说明了"）：未解锁的卡片名字已经是「？？？」，再写一行「未解锁」是冗余。
   */
  private readonly nameLabels: Label[] = [];
  /**
   * **效果说明**：走 `RichLine`（`**…**` 里的数字用强调色）——
   * 2026-10-22 用户："数字有颜色"；Pixi 一个 Text 不能行内变色，
   * 所以每张卡的说明是一组按行切好的 Label（见 `ui/richLine`）。
   */
  private readonly descLines: RichLine[] = [];
  /** 解锁条件那一行（小字、暗色；**未解锁的也照写** —— 那正是玩家要知道的）。 */
  private readonly conditionLabels: Label[] = [];
  readonly chrome: ScreenChrome;
  /**
   * **滚动偏移**（2026-10-22，用户："图鉴应该支持 滚动"）。
   *
   * ⚠️ 卡片本身**不移动**再画一遍 —— 每次 `redraw` 都按**新的偏移**算"哪一段
   * 落在视口里"（`visiblePartOf`），所以边缘那一行自然是**半张卡** ✓
   * （Pixi 的 `mask` 在 headless 里不生效，AGENTS §3e —— 所以用几何求交）。
   */
  private scrollOffset = 0;

  constructor(options: CodexScreenOptions) {
    this.options = options;
    const { pixi } = options;

    this.root = new pixi.Container();
    this.root.visible = false;

    this.bg = new pixi.Graphics();
    this.bg.rect(0, 0, LOGICAL.width, LOGICAL.height).fill({ color: PALETTE.bgTop });
    this.gfx = new pixi.Graphics();
    this.cardsLayer = new pixi.Container();
    this.cardsLayer.addChild(this.gfx);
    /**
     * 遮罩：一次性装配（`attachViewportMask` 会把它加进 `cardsLayer` 并
     * 赋给 `mask`），每帧只**重画几何**（`drawViewportClip`）。
     */
    this.maskGfx = new pixi.Graphics();
    attachViewportMask(this.maskGfx, this.cardsLayer);
    this.overlayGfx = new pixi.Graphics();
    this.root.addChild(this.bg, this.cardsLayer, this.overlayGfx);

    this.title = new Label(pixi, {
      x: LOGICAL.width / 2,
      y: CODEX_LAYOUT.titleY,
      size: 32,
      color: PALETTE.text,
      anchorX: 0.5,
      anchorY: 0.5,
      kai: true,
    });
    /**
     * 摘要（已解锁 N / 共 M）：**底部那一行的右端**，与提示同一行
     * （用户 2026-10-22："已解锁多少条那一行 挪到右下角，和提示一行"）。
     * 右对齐到**卡片网格右边缘**（`codexGridLeft + codexGridWidth`）。
     */
    this.summary = new Label(pixi, {
      x: codexGridLeft() + codexGridWidth(),
      y: CODEX_LAYOUT.hintY,
      size: FONT.small,
      color: PALETTE.textDim,
      anchorX: 1,
      anchorY: 0.5,
    });
    /** 提示：**左下角**、左对齐到卡片网格左边缘（与卡片左基线同一条）。 */
    this.hint = new Label(pixi, {
      x: codexGridLeft(),
      y: CODEX_LAYOUT.hintY,
      size: FONT.small,
      color: PALETTE.textDim,
      anchorX: 0,
      anchorY: 0.5,
    });
    this.root.addChild(this.title.root, this.summary.root, this.hint.root);

    this.chrome = new ScreenChrome({
      pixi,
      showKeyHints: options.showKeyHints,
      f1Label: options.f1Label,
      onGear: options.onGear,
      onBack: options.onBack,
    });
    this.root.addChild(this.chrome.root);

    this.redraw();
  }

  get visible(): boolean {
    return this.root.visible;
  }

  /** 这一屏此刻画了几条、其中几条已解锁（调试 / 验收读数）。 */
  get current(): { readonly total: number; readonly unlocked: number } {
    const entries = this.options.getEntries();
    return {
      total: entries.length,
      unlocked: entries.filter((entry) => entry.unlocked).length,
    };
  }

  setVisible(visible: boolean): void {
    this.root.visible = visible;
    if (visible) this.redraw();
  }

  /** 调试读数：这一屏此刻可见吗、画了几条、几条已解锁。 */
  debugState(): { readonly visible: boolean; readonly total: number; readonly unlocked: number } {
    const entries = this.options.getEntries();
    return {
      visible: this.root.visible,
      total: entries.length,
      unlocked: entries.filter((entry) => entry.unlocked).length,
    };
  }

  /** `Esc` / 返回箭头：回首页。 */
  back(): void {
    this.options.onBack();
  }
  /**
   * 卡片视口：`firstCardY` 到提示行之上、横跨卡片区。
   *
   * ⚠️ 它是**遮罩的矩形**（`ViewportRect`，含 x/w）—— 不只是"上下界"：
   * 遮罩要画成一整块矩形，`top/height` 那种形状还得再推一次 x/w ✗。
   */
  private viewport(): ViewportRect {
    return {
      x: codexGridLeft(),
      y: CODEX_LAYOUT.firstCardY,
      w: codexGridWidth(),
      /** ⚠️ 多留 2px：卡片的描边与光标环压在边界上，被裁掉一像素就像"卡缺了角"。 */
      h: Math.max(1, CODEX_LAYOUT.hintY - 16 - CODEX_LAYOUT.firstCardY + 2),
    };
  }

  /** 内容总高（所有行的卡片）。 */
  private contentHeight(): number {
    const rects = codexCardRects(this.options.getEntries().length);
    const last = rects[rects.length - 1];
    const first = rects[0];
    if (last === undefined || first === undefined) return 0;
    return last.y + last.h - first.y;
  }

  /** 滚一段（滚轮 / 拖拽 / 键盘都走它）。@returns 有没有真的滚 */
  scrollBy(deltaY: number): boolean {
    const max = maxScrollOffset(this.contentHeight(), this.viewport().h);
    const next = clampScrollOffset(this.scrollOffset + deltaY, max);
    if (next === this.scrollOffset) return false;
    this.scrollOffset = next;
    this.redraw();
    return true;
  }

  /**
   * **Shift + ↑ ↓ 的键盘滚动**（2026-10-22）：与备战 / 确认屏 / 选人屏**同一个**
   * 约定 —— 一步 = 一行卡片的高度（比滚轮的一格大，键盘按起来才不磨人）。
   * ⚠️ 它只是 `scrollBy` 的一层按键包装：范围、夹取、遮罩全在那一处，
   * 键盘不是第二条滚动实现。
   */
  scrollDetail(dir: 'up' | 'down'): void {
    const step = 120;
    this.scrollBy(dir === 'up' ? -step : step);
  }

  /** 这个点是不是落在卡片视口里（拖拽 / 滚轮的判据）。 */
  isOnScrollable(_px: number, py: number): boolean {
    if (!this.root.visible) return false;
    const view = this.viewport();
    return py >= view.y && py <= view.y + view.h;
  }

  /** 滚轮：滚卡片区。 */
  wheelDetail(px: number, py: number, deltaY: number): boolean {
    if (!this.isOnScrollable(px, py)) return false;
    return this.scrollBy(deltaY * 3);
  }

  /** 拖拽（触屏没有滚轮）：@param deltaY 向上为负 */
  dragDetail(px: number, py: number, deltaY: number): boolean {
    if (!this.isOnScrollable(px, py)) return false;
    return this.scrollBy(-deltaY);
  }



  /**
   * 点一下：**只处理边角控件**（齿轮 / 左上角返回箭头）。
   *
   * ⚠️ 2026-10-22 用户："图鉴不需要点击屏幕任意位置返回，就要按，点击i，esc
   * 或者 返回键（移动端）"。
   *
   * 所以这里**不再**"点哪都 `onBack()`"：
   *   - 点卡片区 / 空白处 ⇒ **什么都不做**（用户要的是"看内容"，不是"点一下就
   *     被踢回首页" —— 那一版在滚动时尤其糟：拖到一半松手就退出去了 ✗）
   *   - 返回只有三条路：`Esc`（`loopWiring`）/ 左上角**返回箭头**（`chrome`，
   *     也就是移动端的返回键）/ 齿轮
   *
   * @returns 有没有被边角控件消费（**不消费** ⇒ 交给滚动流水，见 `canvasInput`）
   */
  hitTest(px: number, py: number): boolean {
    return this.chrome.hitTest(px, py);
  }

  frame(): void {
    if (this.root.visible) {
      this.redraw();
      this.chrome.update();
    }
  }

  setUiScale(scale: number): void {
    this.chrome.setUiScale(scale);
  }

  private redraw(): void {
    const t = this.options.translate;
    const entries = this.options.getEntries();
    const rects = codexCardRects(entries.length);
    const view = this.viewport();
    const maxScroll = maxScrollOffset(this.contentHeight(), view.h);
    this.scrollOffset = clampScrollOffset(this.scrollOffset, maxScroll);

    this.title.set(t('screen.codex.title'));
    const unlocked = entries.filter((entry) => entry.unlocked).length;
    const dev = this.options.devMode()
      ? `${t('common.dotSeparator')}${t('screen.codex.devMode')}`
      : '';
    this.summary.set(
      `${t('screen.codex.summary', {
        unlocked: String(unlocked),
        total: String(entries.length),
      })}${dev}`,
    );

    this.gfx.clear();
    this.overlayGfx.clear();
    /**
     * 遮罩几何 = 视口矩形（每帧重画：布局变了它跟着变）。
     * ⚠️ 只重画、不重复 `addChild` / 不重复赋 `mask`（那是装配，见构造函数）。
     */
    drawViewportClip(this.maskGfx, view);
    this.ensureLabels(entries.length);

    entries.forEach((entry, index) => {
      const card = rects[index];
      const nameLabel = this.nameLabels[index];
      const descLine = this.descLines[index];
      const conditionLabel = this.conditionLabels[index];
      if (card === undefined || nameLabel === undefined || descLine === undefined) return;

      /**
       * **滚动 = 整层位移**（2026-10-22 用户："我要的是类似 html 那种滚动效果"）。
       *
       * ⚠️ 与上一版的区别（那条路是错的，别再走回去）：
       *   - 上一版：卡片与视口**求交**，只画交集 ⇒ 边缘那张变成"矮一截的卡" ✗
       *   - 再上一版：**整卡要么全画要么不画** ⇒ 边缘整张消失 ✗
       * 现在：卡片**按完整尺寸画**（`shifted`），越界的像素由 `mask` 切掉
       * —— 与浏览器的 `overflow: hidden` 同一套行为 ✓
       */
      const shifted = { ...card, y: card.y - this.scrollOffset };

      /**
       * ⚠️ **完全在视口外 ⇒ 不画**。这是**性能判据**（省掉文字重建），
       * 不是裁剪本身 —— 部分露出的卡片照画，交给遮罩切。
       */
      if (fullyOutside(shifted, view)) {
        nameLabel.root.visible = false;
        descLine.setVisible(false);
        if (conditionLabel !== undefined) conditionLabel.root.visible = false;
        return;
      }

      /**
       * 卡片皮肤：**所有卡片同一种**（2026-10-20 用户："黄色的是初始就能
       * 解锁的？**不需要这种区别**"）。
       */
      const skin = cardSkin({ developing: false, cursored: false, selected: false });
      this.gfx
        .roundRect(shifted.x, shifted.y, shifted.w, shifted.h, CARD_RADIUS)
        .fill({ color: skin.fillColor, alpha: skin.fillAlpha });
      this.gfx
        .roundRect(shifted.x, shifted.y, shifted.w, shifted.h, CARD_RADIUS)
        .stroke({ color: skin.strokeColor, width: skin.strokeWidth });

      /**
       * **三行字**（2026-10-22 用户："卡片要显示炁机效果的说明"）：
       *
       * ```
       *   名字        （一行，未解锁 = ？？？）
       *   效果说明    （小字，按字数折行，最多 2 行）
       *   解锁条件    （小字，一行，超长省略）
       * ```
       *
       * ⚠️ 字号下限 `FONT.small`（13，`ui/layout.ts`：中文 >= 13）。
       * ⚠️ **没有"已解锁 / 未解锁"那一行**（用户："？？？就说明了"）。
       */
      /**
       * **三行字**（2026-10-22 用户："卡片要显示炁机效果的说明" +
       * "卡片可以高一点，写不下的可以换行"）：
       *
       * ```
       *   名字        （一行，未解锁 = ？？？）
       *   效果说明    （小字，行数按卡片高度算 → 最多 3 行）
       *   解锁条件    （小字，贴底；行数按卡片高度算 → 最多 2 行）
       * ```
       *
       * ⚠️ 行数**不硬编码**：`cardTextPlan(cardH)` 一处算，卡片一改高就跟着变
       * （单测钉住"三块互不重叠、都在卡内"）。
       * ⚠️ 字号下限 `FONT.small`（13，`ui/layout.ts`：中文 >= 13）。
       * ⚠️ **没有"已解锁 / 未解锁"那一行**（用户："？？？就说明了"）。
       * ⚠️ 条件文案**自带「解锁条件：」前缀**（`app/unlockText` 统一加的）
       * —— 这里**不许**再拼一次，否则会出现"解锁条件：解锁条件：…" ✗
       */
      /** ⚠️ **三行同一条左基线**（`CARD_TEXT_INSET`，唯一一处数字）。 */
      const textX = shifted.x + CARD_TEXT_INSET;
      const perLine = Math.max(6, Math.floor((shifted.w - CARD_TEXT_INSET * 2) / FONT.small));
      /**
       * **解锁条件**（用户 2026-10-22："解锁条件 后面换一行 不需要 冒号了…
       * 写不下换行 不要省略…锚点设在底部"）：
       *
       * - 文案已经是 `"解锁条件\n<条件正文>"`（前缀在 `app/unlockText` 统一加）
       *   ⇒ 这里按硬换行切段再折行，**不拼前缀、不加冒号** ✓
       * - **不限行数、不省略**（`wrapHardLines` 不传 `maxLines`）✓
       * - 行数算出来之后交给 `cardTextPlan`：条件**贴底**，说明吃剩下的高度 ✓
       */
      const condLines = wrapHardLines(entry.unlockText, perLine);
      const plan = cardTextPlan({ cardH: shifted.h, condLines: condLines.length });

      nameLabel.root.x = textX;
      nameLabel.root.y = shifted.y + plan.nameTop;
      nameLabel.set(entry.nameKey === undefined ? t('screen.codex.locked') : t(entry.nameKey));
      nameLabel.setColor(entry.nameKey === undefined ? PALETTE.textDim : PALETTE.text);
      nameLabel.root.visible = true;

      /**
       * 效果说明：**未解锁时没有**（`descKey === undefined` ⇒ 不画）——
       * "？？？"就是"你还不知道它是什么" ✓（开发模式会把它填上）。
       *
       * ⚠️ 先把文案里的**硬换行**压成空格：语言包的说明是给窄卡片写的两行
       * （`…\n…`），而这里按卡片宽度重折 —— 两套折行叠在一起会出现第 3 行
       * （实测「游刃有余」就是这样溢到条件行上的 ✗）。
       */
      const desc = entry.descKey === undefined ? undefined : t(entry.descKey);
      if (desc === undefined || desc === '') {
        descLine.setVisible(false);
      } else {
        /**
         * ⚠️ 折行按**纯文本**算（`wrapByChars`；它保证不把 `100%` 拆开），
         * 颜色只在这一行**画**的时候按 run 切 —— 折行结果不受颜色影响 ✓。
         */
        const flat = stripEmphasis(desc).replaceAll('\n', ' ');
        if (plan.descLines <= 0) {
          descLine.setVisible(false);
        } else {
          descLine.layout(
            wrapByChars(flat, { perLine, maxLines: plan.descLines }),
            textX,
            shifted.y + plan.descTop,
            CODEX_LINE_H,
          );
          descLine.setVisible(true);
        }
      }

      if (conditionLabel !== undefined) {
        conditionLabel.root.x = textX;
        conditionLabel.root.y = shifted.y + plan.condTop;
        conditionLabel.set(condLines.join('\n'));
        conditionLabel.setColor(PALETTE.textDim);
        conditionLabel.root.visible = true;
      }
    });

    /**
     * **滚动条**（2026-10-22 用户："现在滚动好了，但是这里没有显示滚动条"）。
     *
     * ⚠️ 上一版把 `trackX` 算成 `画布中线 + 5 张卡的半宽 + 40 ≈ 970` ——
     * 而画布只有 960 ⇒ **画在画布外面**，所以"怎么都不显示" ✗。
     * 现在贴**卡片网格右边缘 + 8**，并且几何仍走
     * `scrollWindow.scrollBarGeometry`（唯一一份，`paintScrollBar` 只是画笔）。
     */
    const gridRight = view.x + view.w;
    paintScrollBar({
      gfx: this.overlayGfx,
      track: { x: gridRight + 8, top: view.y, len: view.h },
      viewportPx: view.h,
      maxScrollPx: maxScroll,
      scrollPx: this.scrollOffset,
    });

    /** 多余的 Label（池子变小）藏起来。 */
    for (let i = entries.length; i < this.nameLabels.length; i += 1) {
      this.nameLabels[i]?.root && (this.nameLabels[i]!.root.visible = false);
      this.descLines[i]?.setVisible(false);
      this.conditionLabels[i]?.root && (this.conditionLabels[i]!.root.visible = false);
    }

    /**
     * ⚠️ 键名当**参数**拼（AGENTS.md §3b：键位不是文案）；触屏整行留空
     * （这一屏能做的事就是"点一下回去"）。
     */
    this.hint.set(
      this.options.showKeyHints()
        ? `${t('screen.codex.hint')}${t('screen.keyHint', { keys: 'Esc' })}`
        : '',
    );
  }

  private ensureLabels(count: number): void {
    const { pixi } = this.options;
    while (this.nameLabels.length < count) {
      const name = new Label(pixi, {
        x: 0,
        y: 0,
        size: FONT.body,
        color: PALETTE.text,
        /**
         * ⚠️ **左对齐 + 顶部锚**（用户 2026-10-22："不同炁机卡左上坐标不统一"）
         * —— 三行都用 `anchorY: 0`，按"顶"摆位，于是每张卡的起点只由
         * `CARD_TEXT_INSET` 决定，与名字字数 / 说明行数无关 ✓。
         */
        anchorX: 0,
        anchorY: 0,
        kai: true,
      });
      /**
       * **效果说明**（`RichLine`）：普通段用 `textDim`（与以前一致），
       * `**…**` 里的数字用 **`PALETTE.douqi`（金）** —— 选它的理由：
       * ① 与暗灰正文对比明显 ② 语义是"资源/数值"，不是"危险"（`danger`）
       * 也不抢"前摇/冷却"那三色的语义 ③ 是既有色，不发明新值。
       */
      const desc = new RichLine({
        pixi,
        size: FONT.small,
        baseColor: PALETTE.textDim,
        emphasisColor: PALETTE.douqi.base,
      });
      const condition = new Label(pixi, {
        x: 0,
        y: 0,
        /** 中文下限 13（`FONT.small`）—— 条件那行不能更小。 */
        size: FONT.small,
        color: PALETTE.textDim,
        anchorX: 0,
        anchorY: 0,
      });
      this.cardsLayer.addChild(name.root, desc.root, condition.root);
      this.nameLabels.push(name);
      this.descLines.push(desc);
      this.conditionLabels.push(condition);
    }
  }
}
