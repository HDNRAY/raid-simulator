/**
 * **战斗日志区**：屏幕左侧那条日志（`ui/LogPanel.ts`）。
 *
 * ==================================================================
 * 为什么单独一个文件（关注分离，AGENTS.md §3）
 * ==================================================================
 *
 * 面板组件本身早就在 `ui/LogPanel.ts` 里了，但它的**接线**（造实例、
 * 每帧喂 `logEntries` + `view`、UI 缩放）全都在 `BattleScene` 里，
 * 而且缩放那一步还要由场景去算 `UiLayout.logPanel` —— 也就是
 * "日志该多大"这件日志自己的事，写在场景里。
 *
 * 现在收成一块：本文件持有它、注册它的每帧更新、自己缩放。
 * `BattleScene` 只负责把它放到 HUD 的这一层（层叠位置是场景的知识）。
 *
 * ⚠️ 下面的注释与代码是一起从 `BattleScene.ts` 搬过来的
 * （AGENTS.md §3：抽取时连带注释一起搬）。
 */

import type { Container } from 'pixi.js';
import { LogPanel } from '../../ui/LogPanel';
import type { PixiCtor } from '../../ui/primitives';
import { UiLayout } from '../../ui/uiLayout';
import type { FrameRegistry, TranslateFn } from '../sceneTypes';

/** 战斗日志区域。 */
export class LogArea {
  /**
   * **就是 `LogPanel.root` 本身 —— 这里刻意不套一层容器。**
   *
   * ⚠️ `LogPanel.syncLayer` 靠 `root.parent`（= HUD）与
   * `root.parent.parent`（= 场景根）把**复盘**面板提到*结算层之上*：
   * 结算那一层半透明黑幕会压暗复盘正文。中间多插一层容器之后，
   * "提到最上层"就只在 HUD 内部生效，复盘反而被结算面板压住
   * （实测：结算面板画在了复盘正文上面 —— 这是这次拆分差点带出去的行为变化）。
   *
   * ⚠️ 所以别的区域都能有容器，只有这一块不能：节点层级是
   * `LogPanel` 行为契约的一部分。
   */
  readonly root: Container;

  /** 战斗日志（屏幕右侧） */
  private readonly logPanel: LogPanel;

  constructor(pixi: PixiCtor, translate: TranslateFn) {
    /* 战斗日志（右侧）—— 画在 HUD 下层，避免压住技能栏与资源面板 */
    this.logPanel = new LogPanel({
      pixi,
      translate: (key, params) => {
        try {
          return translate(key, params);
        } catch {
          return key;
        }
      },
    });
    this.root = this.logPanel.root;
  }

  /** 挂上本区域的每帧部件（日志每次都要拿到**整份 view**，见 `LogPanel`）。 */
  register(registry: FrameRegistry): void {
    registry.add({
      name: 'logPanel',
      render: (ctx) => this.logPanel.update(ctx.logEntries, ctx.view),
    });
  }

  /**
   * **UI 缩放**。
   *
   * ⚠️ 锚点是 `'right'`（`UiLayout.logPanel`）—— 而日志面板在**左侧**
   * （`LAYOUT.log.x = 8`）。缩放到 > 1 时它会算出**负的 x**、探出画布左缘。
   * 这是**重构前就有的行为**，本次原样保留（纯搬运不改行为）。
   */
  setUiScale(scale: number): void {
    const ui = new UiLayout(scale);
    // 日志面板
    this.logPanel.setUiScale(scale, ui.logPanel);
  }
}
