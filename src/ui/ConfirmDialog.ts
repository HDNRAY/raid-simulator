/**
 * **二次确认弹窗**（2026-10-22，用户："最好有个二次确认的弹窗，这个二次确认的
 * 弹窗可以抽成单独的组件"）。
 *
 * ==================================================================
 * 它是什么（一句话）
 * ==================================================================
 *
 * 一块**模态**小面板：标题 + 一段说明 + 「取消 / 确认」两个按钮。
 * 打开时盖住一切（深色蒙层 + 最上层），键盘（←→ / Tab / Enter / Esc）
 * 与指针都对等，关掉之后**什么都不做** —— 真正的动作由调用方在
 * `onConfirm` 里执行。
 *
 * ==================================================================
 * ⚠️ 为什么单独一个组件，而不是塞进设置面板
 * ==================================================================
 *
 * "要不要丢下当前这局"这种确认以后还会有（退出战斗 / 删除存档 / 重开一局…）。
 * 写进设置面板就等于把这段 UI 与那个面板的生命周期绑死；抽出来之后任何
 * 屏幕都能复用（只要把它放在**最上层**并接管输入）。
 *
 * ⚠️ 它**不自己决定"谁是敌人"**（这里没有"敌人"）—— 也不做任何业务动作：
 * `onConfirm` / `onCancel` 是注入的，组件只负责"问"。
 *
 * ⚠️ 它**不碰 DOM / 不读时间**：所有状态（开 / 关、焦点）都由 `open` /
 * `moveFocus` / `press` 推进，所以能在 node 里测（`ui/confirmDialogLogic`）。
 */

import type { Container, Graphics } from 'pixi.js';
import { FONT, LOGICAL } from './layout';
import { Label, type PixiCtor } from './primitives';
import { PALETTE } from '../render/theme';
import type { TranslateFn } from '../i18n/translator';

/** 两个按钮的顺序（左 = 取消，右 = 确认 —— 破坏性操作把"安全项"放左边）。 */
export const CONFIRM_ACTIONS = ['cancel', 'confirm'] as const;

export type ConfirmAction = (typeof CONFIRM_ACTIONS)[number];

export interface ConfirmDialogOptions {
  readonly pixi: PixiCtor;
  readonly translate: TranslateFn;
}

/** 一次"问"的内容。 */
export interface ConfirmRequest {
  /** 标题（已翻译）。 */
  readonly title: string;
  /** 说明（已翻译，可多行用 `\n`）。 */
  readonly message: string;
  /** 确认按钮的文案（已翻译）。 */
  readonly confirmLabel: string;
  /** 取消按钮的文案（已翻译）。 */
  readonly cancelLabel: string;
  readonly onConfirm: () => void;
  readonly onCancel?: () => void;
}

/** 弹窗的几何（逻辑坐标；与 `ui/layout` 的 960×540 同一套）。 */
export const CONFIRM_LAYOUT = {
  w: 460,
  h: 190,
  get x(): number {
    return Math.round((LOGICAL.width - this.w) / 2);
  },
  get y(): number {
    return Math.round((LOGICAL.height - this.h) / 2);
  },
  /** 按钮尺寸与间距。 */
  buttonW: 150,
  buttonH: 40,
  buttonGap: 24,
} as const;

/** 某个按钮的矩形（渲染与命中测试共用 —— 与首页/备战同一条纪律）。 */
export function confirmButtonRect(action: ConfirmAction): {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
} {
  const index = CONFIRM_ACTIONS.indexOf(action);
  const totalW = CONFIRM_ACTIONS.length * CONFIRM_LAYOUT.buttonW
    + (CONFIRM_ACTIONS.length - 1) * CONFIRM_LAYOUT.buttonGap;
  const left = Math.round(CONFIRM_LAYOUT.x + (CONFIRM_LAYOUT.w - totalW) / 2);
  return {
    x: left + index * (CONFIRM_LAYOUT.buttonW + CONFIRM_LAYOUT.buttonGap),
    y: CONFIRM_LAYOUT.y + CONFIRM_LAYOUT.h - CONFIRM_LAYOUT.buttonH - 22,
    w: CONFIRM_LAYOUT.buttonW,
    h: CONFIRM_LAYOUT.buttonH,
  };
}

export class ConfirmDialog {
  readonly root: Container;

  private readonly options: ConfirmDialogOptions;
  private readonly dim: Graphics;
  private readonly box: Graphics;
  private readonly title: Label;
  private readonly message: Label;
  private readonly buttonLabels: Label[] = [];
  private request: ConfirmRequest | undefined;
  /** 焦点：0 = 取消（默认），1 = 确认。**默认停在"取消"上**（破坏性操作）。 */
  private focus = 0;

  constructor(options: ConfirmDialogOptions) {
    this.options = options;
    const { pixi } = options;
    this.root = new pixi.Container();
    this.root.visible = false;

    this.dim = new pixi.Graphics();
    this.dim.rect(0, 0, LOGICAL.width, LOGICAL.height).fill({ color: 0x000000, alpha: 0.55 });
    this.box = new pixi.Graphics();
    this.title = new Label(pixi, {
      x: CONFIRM_LAYOUT.x + CONFIRM_LAYOUT.w / 2,
      y: CONFIRM_LAYOUT.y + 40,
      size: FONT.title,
      color: PALETTE.text,
      anchorX: 0.5,
      anchorY: 0.5,
      kai: true,
    });
    this.message = new Label(pixi, {
      x: CONFIRM_LAYOUT.x + CONFIRM_LAYOUT.w / 2,
      y: CONFIRM_LAYOUT.y + 82,
      size: FONT.small,
      color: PALETTE.textDim,
      anchorX: 0.5,
      anchorY: 0.5,
    });
    this.root.addChild(this.dim, this.box, this.title.root, this.message.root);

    for (const action of CONFIRM_ACTIONS) {
      const rect = confirmButtonRect(action);
      const label = new Label(pixi, {
        x: rect.x + rect.w / 2,
        y: rect.y + rect.h / 2,
        size: FONT.body,
        color: PALETTE.text,
        anchorX: 0.5,
        anchorY: 0.5,
      });
      this.buttonLabels.push(label);
      this.root.addChild(label.root);
    }
  }

  get visible(): boolean {
    return this.root.visible;
  }

  /** 打开（覆盖上一次的请求）。 */
  open(request: ConfirmRequest): void {
    this.request = request;
    /** ⚠️ 默认焦点在**取消**上：误按 Enter 不该执行破坏性动作。 */
    this.focus = 0;
    this.root.visible = true;
    this.redraw();
  }

  /** 关掉（不触发任何回调 —— `confirm()` / `cancel()` 才触发）。 */
  close(): void {
    this.request = undefined;
    this.root.visible = false;
  }

  /** 焦点移动（←→ / Tab；两端停住）。 */
  moveFocus(delta: number): void {
    const next = this.focus + (delta >= 0 ? 1 : -1);
    this.focus = Math.min(CONFIRM_ACTIONS.length - 1, Math.max(0, next));
    this.redraw();
  }

  /** `Enter`：执行当前焦点那个按钮。 */
  press(): void {
    const action = CONFIRM_ACTIONS[this.focus];
    if (action === 'confirm') this.confirm();
    else this.cancel();
  }

  confirm(): void {
    const request = this.request;
    this.close();
    request?.onConfirm();
  }

  cancel(): void {
    const request = this.request;
    this.close();
    request?.onCancel?.();
  }

  /**
   * 点一下。@returns 有没有消费（弹窗开着时**一律消费** —— 它下面那一层
   * 不该收到这次点击）。
   */
  hitTest(px: number, py: number): boolean {
    if (!this.visible) return false;
    for (const action of CONFIRM_ACTIONS) {
      const rect = confirmButtonRect(action);
      if (px < rect.x || px > rect.x + rect.w) continue;
      if (py < rect.y || py > rect.y + rect.h) continue;
      if (action === 'confirm') this.confirm();
      else this.cancel();
      return true;
    }
    return true;
  }

  /** 每帧重画（只在可见时）。 */
  frame(): void {
    if (this.root.visible) this.redraw();
  }

  private redraw(): void {
    const request = this.request;
    if (request === undefined) return;
    const t = this.options.translate;
    this.title.set(request.title);
    this.message.set(request.message);

    this.box.clear();
    this.box
      .rect(CONFIRM_LAYOUT.x, CONFIRM_LAYOUT.y, CONFIRM_LAYOUT.w, CONFIRM_LAYOUT.h)
      .fill({ color: PALETTE.panel });
    this.box
      .rect(CONFIRM_LAYOUT.x, CONFIRM_LAYOUT.y, CONFIRM_LAYOUT.w, CONFIRM_LAYOUT.h)
      .stroke({ color: PALETTE.textDim, width: 1 });

    CONFIRM_ACTIONS.forEach((action, index) => {
      const rect = confirmButtonRect(action);
      const focused = index === this.focus;
      this.box
        .roundRect(rect.x, rect.y, rect.w, rect.h, 8)
        .fill({ color: focused ? PALETTE.focus : PALETTE.panelLine });
      this.box
        .roundRect(rect.x, rect.y, rect.w, rect.h, 8)
        .stroke({ color: focused ? PALETTE.text : PALETTE.textDim, width: focused ? 2 : 1 });
      const label = this.buttonLabels[index];
      if (label === undefined) return;
      label.set(action === 'confirm' ? request.confirmLabel : request.cancelLabel);
      label.setColor(focused ? PALETTE.text : PALETTE.textDim);
    });

    /** 底部一行提示（`←→` 选择 / `Enter` 确认 / `Esc` 取消）—— 键位拼上去。 */
    this.message.set(
      `${request.message}\\n\\n${t('screen.confirm.hint')}`,
    );
  }
}
