/**
 * UI 缩放滑块（设置 · 通用页的**唯一**控件）。
 *
 * ==================================================================
 * 为什么要抽成组件（需求原话："这里没有做好组件和模块化，
 * 他是通用的一部分，应该自动随着通用的切出而消失"）
 * ==================================================================
 *
 * 第一版把滑块的两个 Label 直接建在 `SettingsPanel` 的 body 上，
 * 只在通用页的绘制分支里 `set()` 文本 —— 于是**切到按键页时它们还在**：
 * body 是共用的，切换 tab 只重画不清理，滑块就"漏"到了别的页上。
 *
 * 抽出来之后，"显示/隐藏"由组件自己拥有（`setVisible`），
 * 面板只需要说"现在是通用页"或"不是"。这一层边界让
 * **"通用页有什么"集中在通用页的组件里**，不会再漏。
 *
 * ==================================================================
 * 视觉
 * ==================================================================
 *
 * 名称在左、百分比在右、中间一条轨道 + 方块把手。
 * 用方块而不是圆：本作整套 UI 没有圆形元素（技能格、条、按钮
 * 全是直角），一个圆把手会显得是"从别处搬来的控件"。
 */

import type { Container, Graphics } from 'pixi.js';
import { FONT } from '../layout';
import { Label, type PixiCtor } from '../primitives';
import { PALETTE } from '../../render/theme';
import { UI_SCALE_MAX, UI_SCALE_MIN, UI_SCALE_STEP, clampUiScale } from '../../render/scaling';
import { uiScaleSliderRect } from './logic';

export interface ScaleSliderOptions {
  readonly pixi: PixiCtor;
  readonly translate: (key: string) => string;
  /** 读当前倍数 */
  readonly get: () => number;
  /** 倍数变了（调用方负责应用到画布） */
  readonly set: (value: number) => void;
}

/** 轨道高度与把手尺寸（逻辑像素）。 */
const TRACK_H = 4;
const KNOB_W = 10;
const KNOB_H = 16;

export class ScaleSlider {
  readonly root: Container;

  private readonly gfx: Graphics;
  private readonly name: Label;
  private readonly value: Label;
  private focused = false;

  constructor(private readonly options: ScaleSliderOptions) {
    const { pixi } = options;
    const rect = uiScaleSliderRect();
    this.root = new pixi.Container();
    this.gfx = new pixi.Graphics();

    this.name = new Label(pixi, {
      x: rect.x,
      y: rect.y,
      size: FONT.body,
      color: PALETTE.text,
    });
    this.value = new Label(pixi, {
      x: rect.x + rect.w,
      y: rect.y,
      size: FONT.body,
      color: PALETTE.text,
      anchorX: 1,
    });

    this.root.addChild(this.gfx, this.name.root, this.value.root);
    this.root.visible = false;
    this.redraw();
  }

  /** 键盘焦点态（由面板告知）。 */
  setFocused(focused: boolean): void {
    if (this.focused === focused) return;
    this.focused = focused;
    this.redraw();
  }

  /** 左/右调值。返回是否真的变了。 */
  nudge(direction: -1 | 1): boolean {
    const next = clampUiScale(this.options.get() + direction * UI_SCALE_STEP);
    if (next === this.options.get()) return false;
    this.options.set(next);
    this.redraw();
    return true;
  }

  /** 显示/隐藏由组件自己拥有 —— 这正是抽组件的意义（见文件头说明）。 */
  setVisible(visible: boolean): void {
    this.root.visible = visible;
  }

  get visible(): boolean {
    return this.root.visible;
  }

  redraw(): void {
    const rect = uiScaleSliderRect();
    const scale = clampUiScale(this.options.get());
    const t = (scale - UI_SCALE_MIN) / (UI_SCALE_MAX - UI_SCALE_MIN);

    this.name.set(this.options.translate('settings.uiScale'));
    this.name.setColor(this.focused ? PALETTE.douqi.bright : PALETTE.text);
    this.value.set(`${Math.round(scale * 100)}%`);
    this.value.setColor(this.focused ? PALETTE.douqi.bright : PALETTE.text);

    const g = this.gfx;
    const trackY = rect.y + rect.h - 8;
    const trackW = rect.w - 8;
    g.clear();
    g.rect(rect.x + 4, trackY, trackW, TRACK_H).fill({ color: 0x2a2c38, alpha: 1 });
    g.rect(rect.x + 4, trackY, Math.round(trackW * t), TRACK_H).fill({
      color: PALETTE.douqi.base,
      alpha: 1,
    });
    const knobX = rect.x + 4 + Math.round(trackW * t) - KNOB_W / 2;
    g.rect(knobX, trackY - 6, KNOB_W, KNOB_H).fill({
      color: this.focused ? PALETTE.douqi.bright : 0xd8d8e4,
      alpha: 1,
    });
    if (this.focused) {
      g.rect(rect.x, rect.y, rect.w, rect.h).stroke({
        color: PALETTE.douqi.bright,
        width: 1.5,
      });
    }
  }
}
