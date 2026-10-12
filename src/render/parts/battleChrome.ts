/**
 * **战斗界面的齿轮**作为一个帧部件。
 *
 * ==================================================================
 * 为什么需要这一层（只有十行）
 * ==================================================================
 *
 * `ScreenChrome` 是一个 UI 组件（`ui/` 层），它的 `update()` 是"把触屏
 * 能力同步到键位提示上"。而 `BattleScene` 的每帧广播走 `FrameRegistry`
 * 的 `FramePart` 契约 —— 那里要求部件自带 `name` 且方法名叫 `render`。
 *
 * 与其为了让 `ScreenChrome` 满足 `FramePart` 而给它加一个与场景协议耦合
 * 的方法名（那会把"UI 组件"和"帧部件协议"绑在一起），不如在这里放一个
 * 十行的适配器 —— 与 `parts/` 下其它 `*Part` 同一个层次与写法。
 *
 * ⚠️ 显隐**不在这里**：齿轮的显隐跟它所在的界面（`BattleScene.root`），
 * 而设置面板打开时由 `settingsToggle` 单独藏齿轮（`setGearVisible`）。
 * 两条都写在这里就会变成"谁最后写谁赢"。
 */

import type { ScreenChrome } from '../../ui/ScreenChrome';
import type { FrameContext, FramePart } from '../sceneTypes';

export class BattleChromePart implements FramePart {
  readonly name = 'battleChrome';

  constructor(private readonly chrome: ScreenChrome) {}

  /**
   * 每帧同步键位提示的显隐（触屏不画 `F1`）。
   *
   * ⚠️ 不看 `ctx.showKeyHints`：那个字段是**技能栏**那条路的（场景自己
   * 收口在 `setShowKeyHints` 里）。齿轮的提示走 `ScreenChrome` 自己的
   * `showKeyHints()` 取值函数 —— 与三个整屏界面**同一份**判据，不在这里
   * 复制第二个来源。
   */
  render(_ctx: FrameContext): void {
    this.chrome.update();
  }
}
