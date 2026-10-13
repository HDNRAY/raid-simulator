/**
 * **一局肉鸽结束屏**（P3）：通关 / 失败之后的摘要。
 *
 * 设计稿：`docs/specs/2026-10-12-roguelike.md` §3.3 的 `RunOver` 行
 * （"通关/失败两种文案 + 本局统计（打到第几场、带了哪些炁机）"）。
 *
 * ==================================================================
 * 交互：**一处确认，两种输入**（AGENTS.md §3b 的功能对等）
 * ==================================================================
 *
 *   - 键盘 `Enter`：回选角色（开下一局）
 *   - 触屏 / 鼠标：**点屏幕任意处**（与结算面板的"点击屏幕再来一次"同一套）
 *   - 左上角返回箭头：同上（与 `Enter` 走**同一个**回调）
 *
 * ⚠️ 这里**没有**"再来一局"与"回首页"两个按钮：肉鸽的失败代价是"全丢、
 * 回选角色重开"（§2.4 / §12 决议 #1），而首页是"我不想玩了"——
 * 两者都是离开，但本屏只该给**一条**明确的路（多一条就要多一次判断）。
 * 想回首页的人从选角色屏按 `Esc` 走（那一条已经在）。
 *
 * ==================================================================
 * ⚠️ 它不认识 `RunState`
 * ==================================================================
 *
 * 要显示的四样东西（胜负 / 打到第几场 / 共几场 / 带了哪些炁机）由
 * `app/phaseFlow.ts` 的 `runSummary()` 摊平成 `RunOverSummary` 传进来 ——
 * 渲染层不认识 core 的账本（同一条纪律：接口形状由消费者声明）。
 */

import type { Container, Graphics } from 'pixi.js';
import { FONT, LOGICAL } from './layout';
import { Label, type PixiCtor } from './primitives';
import { ScreenChrome } from './ScreenChrome';
import { PALETTE } from '../render/theme';
import { PREPARE_SKIN } from './prepareRender';
import type { TranslateFn } from '../i18n/translator';

/** 一局结束屏要显示的内容（由 `phaseFlow.runSummary()` 拼好）。 */
export interface RunOverSummary {
  readonly victory: boolean;
  /** 打到第几场（1-based；通关时 = 最后一场）。 */
  readonly position: number;
  /** 这一局一共几场。 */
  readonly length: number;
  /** 本局选了的炁机（名字 key + 层数）。 */
  readonly loadout: readonly { readonly nameKey: string; readonly stacks: number }[];
}

export interface RunOverScreenOptions {
  readonly pixi: PixiCtor;
  readonly translate: TranslateFn;
  /** 摘要的取值函数（每帧现读 —— 这一屏每次打开都是**不同**的一局）。 */
  readonly getSummary: () => RunOverSummary;
  /** 是否显示键位提示（触屏为假）。 */
  readonly showKeyHints: () => boolean;
  /** `F1` 的显示名（齿轮的键位提示；键名不进 i18n）。 */
  readonly f1Label: () => string;
  /** 点右上角的齿轮（打开设置）。 */
  readonly onGear: () => void;
  /** 点左上角的返回箭头（与 `Enter` 同一个去向）。 */
  readonly onBack?: (() => void) | undefined;
  /** 确认离开（回选角色）。 */
  readonly onContinue: () => void;
}

/** 本屏要拼上去的**键名**（键名不进 i18n，见 AGENTS.md §3b）。 */
const RUN_OVER_KEY_HINT = 'Enter';

/** 最多画几条炁机（够用；多出来的不画，也不会崩）。 */
const LOADOUT_ROWS = 6;

export class RunOverScreen {
  readonly root: Container;

  private readonly bg: Graphics;
  private readonly gfx: Graphics;
  private readonly title: Label;
  private readonly progress: Label;
  private readonly loadoutTitle: Label;
  private readonly loadout: Label[] = [];
  private readonly hint: Label;
  readonly chrome: ScreenChrome;
  private readonly options: RunOverScreenOptions;

  constructor(options: RunOverScreenOptions) {
    this.options = options;
    const { pixi } = options;

    this.root = new pixi.Container();
    this.root.visible = false;

    this.bg = new pixi.Graphics();
    this.bg.rect(0, 0, LOGICAL.width, LOGICAL.height).fill({ color: PALETTE.bgTop });
    this.gfx = new pixi.Graphics();
    this.root.addChild(this.bg, this.gfx);

    this.title = new Label(pixi, {
      x: LOGICAL.width / 2,
      y: 92,
      size: 40,
      color: PALETTE.text,
      anchorX: 0.5,
      anchorY: 0.5,
      kai: true,
    });
    this.progress = new Label(pixi, {
      x: LOGICAL.width / 2,
      y: 146,
      size: FONT.body,
      color: PALETTE.textDim,
      anchorX: 0.5,
      anchorY: 0.5,
    });
    this.loadoutTitle = new Label(pixi, {
      x: LOGICAL.width / 2,
      y: 206,
      size: FONT.small,
      color: PALETTE.textDim,
      anchorX: 0.5,
      anchorY: 0.5,
    });
    this.root.addChild(this.title.root, this.progress.root, this.loadoutTitle.root);

    for (let i = 0; i < LOADOUT_ROWS; i += 1) {
      const row = new Label(pixi, {
        x: LOGICAL.width / 2,
        y: 238 + i * 26,
        size: FONT.body,
        color: PALETTE.text,
        anchorX: 0.5,
        anchorY: 0.5,
        kai: true,
      });
      this.loadout.push(row);
      this.root.addChild(row.root);
    }

    this.hint = new Label(pixi, {
      x: LOGICAL.width / 2,
      y: LOGICAL.height - 54,
      size: FONT.small,
      color: PALETTE.textDim,
      anchorX: 0.5,
      anchorY: 0.5,
    });
    this.root.addChild(this.hint.root);

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

  setVisible(visible: boolean): void {
    this.root.visible = visible;
    if (visible) this.redraw();
  }

  /** Enter / 返回箭头：回选角色。 */
  confirm(): void {
    this.options.onContinue();
  }

  /**
   * 点屏幕任意处 = 确认（与结算面板的"点击屏幕再来一次"同一条）。
   *
   * ⚠️ 齿轮 / 返回箭头**先于**"点屏幕"（顺序即优先级）：
   * 先问 chrome，它消费了就不再当成"点屏幕离开" —— 否则点齿轮会顺带离开这一屏
   * （`canvasInput` 记着"一次点击只能做一件事"）。
   */
  hitTest(px: number, py: number): boolean {
    if (this.chrome.hitTest(px, py)) return true;
    this.options.onContinue();
    return true;
  }

  /** 每帧：只在可见时保证画面与摘要一致。 */
  frame(): void {
    if (this.root.visible) {
      this.redraw();
      this.chrome.update();
    }
  }

  /** **UI 缩放**：本屏只转发给它自己的边角控件（与其余整屏界面同一条）。 */
  setUiScale(scale: number): void {
    this.chrome.setUiScale(scale);
  }

  private redraw(): void {
    const t = this.options.translate;
    const summary = this.options.getSummary();

    this.title.set(t(summary.victory ? 'screen.runOver.victory' : 'screen.runOver.defeat'));
    this.title.setColor(summary.victory ? PREPARE_SKIN.selectionText : PALETTE.text);
    this.progress.set(
      t('screen.runOver.progress', {
        position: String(summary.position),
        length: String(summary.length),
      }),
    );
    this.loadoutTitle.set(t('screen.runOver.loadout'));

    /**
     * 本局带的炁机：`名字 ×层数`（层数为 1 时不写后缀 —— "×1" 是噪音）。
     * 一个都没有时写一句"（无）"（只可能发生在"第一场就输"）。
     */
    this.loadout.forEach((row, i) => {
      const entry = summary.loadout[i];
      if (entry === undefined) {
        row.set(i === 0 && summary.loadout.length === 0 ? t('screen.runOver.loadoutEmpty') : '');
        return;
      }
      const suffix = entry.stacks > 1 ? ` ${t('screen.runOver.stacks', { stacks: String(entry.stacks) })}` : '';
      row.set(`${t(entry.nameKey)}${suffix}`);
    });

    const keys = this.options.showKeyHints() ? t('screen.keyHint', { keys: RUN_OVER_KEY_HINT }) : '';
    this.hint.set(`${t('screen.runOver.hintContinue')}${keys}`);
  }
}
