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
  CODEX_LAYOUT,
  clampScrollOffset,
  codexCardRects,
  maxScrollOffset,
  wrapByChars,
  type CodexEntry,
} from './codexLogic';
import {
  attachViewportMask,
  drawViewportClip,
  fullyOutside,
  type ViewportRect,
} from './viewportMask';
import { scrollBarGeometry } from './scrollWindow';
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
  /** 每张卡片的两个 Label（名字 / 状态）；卡片数量按最大池子预建。 */
  private readonly nameLabels: Label[] = [];
  private readonly stateLabels: Label[] = [];
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
    this.summary = new Label(pixi, {
      x: LOGICAL.width / 2,
      y: CODEX_LAYOUT.summaryY,
      size: FONT.body,
      color: PALETTE.textDim,
      anchorX: 0.5,
      anchorY: 0.5,
    });
    this.hint = new Label(pixi, {
      x: LOGICAL.width / 2,
      y: CODEX_LAYOUT.hintY,
      size: FONT.small,
      color: PALETTE.textDim,
      anchorX: 0.5,
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
    const cols = CODEX_LAYOUT.cols;
    const totalW = cols * CODEX_LAYOUT.cardW + (cols - 1) * CODEX_LAYOUT.gapX;
    return {
      x: Math.round((CODEX_LAYOUT.width - totalW) / 2),
      y: CODEX_LAYOUT.firstCardY,
      w: totalW,
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
   * 点一下：齿轮 / 返回箭头优先；其余位置 = 回首页（只读屏，"点哪都走"）。
   *
   * ⚠️ 与 `RunOverScreen` 同一条顺序（先问 chrome）—— 否则点齿轮会顺带离开。
   */
  hitTest(px: number, py: number): boolean {
    if (this.chrome.hitTest(px, py)) return true;
    this.options.onBack();
    return true;
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
      const stateLabel = this.stateLabels[index];
      const conditionLabel = this.conditionLabels[index];
      if (card === undefined || nameLabel === undefined || stateLabel === undefined) return;

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
        stateLabel.root.visible = false;
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

      nameLabel.root.x = shifted.x + shifted.w / 2;
      nameLabel.root.y = shifted.y + shifted.h * 0.24;
      nameLabel.set(entry.nameKey === undefined ? t('screen.codex.locked') : t(entry.nameKey));
      nameLabel.setColor(entry.nameKey === undefined ? PALETTE.textDim : PALETTE.text);
      nameLabel.root.visible = true;

      stateLabel.root.x = shifted.x + shifted.w / 2;
      stateLabel.root.y = shifted.y + shifted.h * 0.5;
      stateLabel.set(
        entry.unlocked ? t('screen.codex.unlocked') : t('screen.codex.notUnlocked'),
      );
      /**
       * ⚠️ 卡片很矮时不画状态行（它会和下面那行条件叠在一起）——
       * "已解锁 / 未解锁"仍由"名字 vs ？？？"表达。
       */
      stateLabel.root.visible = shifted.h >= 84;

      if (conditionLabel !== undefined) {
        conditionLabel.root.x = shifted.x + shifted.w / 2;
        conditionLabel.root.y = shifted.y + shifted.h * 0.78;
        /**
         * 两行条件要求卡片**够高**（否则第二行会掉到卡片外面）；
         * 超长的条件按字数折行 + 省略号。
         */
        const lines = shifted.h >= 120 ? 2 : 1;
        conditionLabel.set(
          wrapByChars(entry.unlockText, { perLine: 12, maxLines: lines }).join('\n'),
        );
        conditionLabel.setColor(PALETTE.textDim);
        conditionLabel.root.visible = true;
      }
    });

    /** 滚动条（内容比视口高时才画）。 */
    if (maxScroll > 0) {
      const thumb = scrollBarGeometry({
        viewportPx: view.h,
        maxScrollPx: maxScroll,
        scrollPx: this.scrollOffset,
        trackLenPx: view.h,
      });
      const trackX = CODEX_LAYOUT.width / 2 + 5 * CODEX_LAYOUT.cardW / 2 + 40;
      this.overlayGfx
        .roundRect(trackX, view.y + thumb.offset, 4, Math.max(8, thumb.length), 2)
        .fill({ color: PALETTE.textDim, alpha: 0.35 });
    }

    /** 多余的 Label（池子变小）藏起来。 */
    for (let i = entries.length; i < this.nameLabels.length; i += 1) {
      this.nameLabels[i]?.root && (this.nameLabels[i]!.root.visible = false);
      this.stateLabels[i]?.root && (this.stateLabels[i]!.root.visible = false);
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
        anchorX: 0.5,
        anchorY: 0.5,
        kai: true,
      });
      const state = new Label(pixi, {
        x: 0,
        y: 0,
        size: FONT.small,
        color: PALETTE.textDim,
        anchorX: 0.5,
        anchorY: 0.5,
      });
      const condition = new Label(pixi, {
        x: 0,
        y: 0,
        /** 中文下限 13（`FONT.small`）—— 条件那行不能更小。 */
        size: FONT.small,
        color: PALETTE.textDim,
        anchorX: 0.5,
        anchorY: 0.5,
      });
      this.cardsLayer.addChild(name.root, state.root, condition.root);
      this.nameLabels.push(name);
      this.stateLabels.push(state);
      this.conditionLabels.push(condition);
    }
  }
}
