/**
 * **「回主菜单」的二次确认**（2026-10-22，用户："设置弹窗的底部 增加"回主菜单"，
 * 最好有个二次确认的弹窗，这个二次确认的弹窗可以抽成单独的组件"）。
 *
 * - 弹窗组件本身是 **`ui/ConfirmDialog.ts`**（通用、可复用、不碰业务）
 * - 这个文件只负责**这一条业务**：设置底部那颗按钮点下去该问什么、
 *   确认之后做什么（关面板 + 回首页）
 *
 * ⚠️ 为什么单独一个文件：`game.ts` 已经 720 行（AGENTS §3 的上限 700），
 * 这段"造弹窗 + 拼文案 + 定动作"是**一个自成一体的装配**，搬出来之后
 * 装配流水账那边只留一句 `const confirmDialog = createExitConfirm(...)`。
 */

import { Container, Graphics, Sprite, Text, type Application } from 'pixi.js';
import { ConfirmDialog } from '../ui/ConfirmDialog';
import type { PixiCtor } from '../ui/primitives';
import type { TranslateFn } from '../i18n/translator';

export interface ExitConfirmDeps {
  readonly app: Application;
  readonly translate: TranslateFn;
  /** 确认之后：关掉设置面板。 */
  readonly closeSettings: () => void;
  /** 确认之后：切回首页。 */
  readonly goHome: () => void;
}

/**
 * 造出确认弹窗并挂到**最上层**（后加 = 在上）。
 *
 * @returns 弹窗实例；`openExitConfirm()` 由设置面板底部的按钮触发
 */
export type ExitConfirm = ConfirmDialog & { readonly open: () => void };

export function createExitConfirm(d: ExitConfirmDeps): ExitConfirm {
  /** ⚠️ Pixi 的构造器表在这里给（`game.ts` 那边不必再传一遍）。 */
  const pixi: PixiCtor = { Container, Graphics, Sprite, Text };
  const dialog = new ConfirmDialog({ pixi, translate: d.translate });
  d.app.stage.addChild(dialog.root);
  return Object.assign(dialog, {
    open: (): void => {
      /**
       * ⚠️ **每次打开都把对话框挪到最上层**：它是在游戏启动时加的，而
       * **设置面板**是后来才加进 stage 的 ⇒ 对话框会被压在面板下面
       * （症状：按 `M` / 点「回主菜单」**看起来没反应**，其实框开了、被挡住了 ✗）。
       * `addChild` 一个已在树上的节点 = 移到末尾 = 最上层 ✓。
       */
      d.app.stage.addChild(dialog.root);
      dialog.open({
        title: d.translate('settings.backToMenuConfirmTitle'),
        message: d.translate('settings.backToMenuConfirmMessage'),
        confirmLabel: d.translate('settings.backToMenuConfirmYes'),
        cancelLabel: d.translate('settings.backToMenuConfirmNo'),
        onConfirm: () => {
          d.closeSettings();
          d.goHome();
        },
      });
    },
  });
}
