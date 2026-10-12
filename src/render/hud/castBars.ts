/**
 * **两条读条**：Boss 的预警条 + 玩家自己的读条。
 *
 * ==================================================================
 * 为什么两条放在同一个文件里
 * ==================================================================
 *
 * 它们**本来就是同一个组件**（`ui/CastBar.ts`）的两个配色实例，
 * 而且各自的"造 / 画 / 缩放"此前都是散着的：节点在 `BattleScene` 的
 * 构造函数里造、每帧画什么在 `parts/bossCastBar.ts` 与
 * `parts/playerCastBar.ts` 里、缩放又在 `BattleScene.setUiScale` 里手调。
 *
 * 两条条是同一块屏幕区域的两种状态（红色 = 威胁，金色 = 我在出手），
 * 所以收在一个文件里，读者一次就能看到"这两条谁在哪、为什么配色不同"。
 *
 * ⚠️ 下面的注释与代码是一起从 `BattleScene.ts` 搬过来的
 * （AGENTS.md §3：抽取时连带注释一起搬）。
 */

import type { Container } from 'pixi.js';
import { LAYOUT } from '../../ui/layout';
import type { PixiCtor } from '../../ui/primitives';
import { CastBar } from '../../ui/CastBar';
import { UiLayout } from '../../ui/uiLayout';
import { BossCastBarPart } from '../parts/bossCastBar';
import { PlayerCastBarPart } from '../parts/playerCastBar';
import { PALETTE } from '../theme';
import type { FrameRegistry } from '../sceneTypes';

/** 读条区域。 */
export class CastBars {
  /** HUD 层上的根容器。`(0,0)` 让内部的逻辑坐标保持不变。 */
  readonly root: Container;

  /* 预警条 */
  /** Boss 预警条（与玩家读条共用 `ui/CastBar.ts`） */
  private readonly castBar: CastBar;
  /** 玩家读条（同一个组件，换配色） */
  private readonly playerCastBar: CastBar;

  constructor(pixi: PixiCtor) {
    this.root = new pixi.Container();

    /**
     * 读条用**共用组件**（`ui/CastBar.ts`）。
     *
     * Boss 与玩家原先各写一份，于是"修了一处忘了另一处"。
     * 现在两者都是这一个组件，层叠顺序（底 → 填充 → 描边 → 文字）
     * 只在一处定义。
     */
    this.castBar = new CastBar({
      pixi,
      rect: LAYOUT.castBar,
      fill: 0xe8542c,
      track: 0x2a0c0e,
      line: PALETTE.danger.base,
      labelColor: 0xffe8c0,
      timeColor: 0xffd0b0,
      // Boss 预警条**不显示剩余秒数**？不 —— 它是最需要读的信息，保留
      showTime: true,
    });
    this.root.addChild(this.castBar.root);

    /**
     * 同一个 `CastBar` 组件，只是换配色（暖金 = "自己的动作"，
     * 红色留给 Boss 的威胁提示）。
     *
     * ⚠️ 它必须放在玩家面板**上方**、不能重叠 —— 面板是后绘制的，
     * 重叠会把读条盖住（见 `LAYOUT.playerCastBar` 的说明）。
     */
    this.playerCastBar = new CastBar({
      pixi,
      rect: LAYOUT.playerCastBar,
      fill: 0xb8860f,
      track: 0x2a1c06,
      line: 0xd8a840,
      labelColor: 0xffffff,
      timeColor: 0xffffff,
      showTime: true,
    });
    this.root.addChild(this.playerCastBar.root);
  }

  /** 挂上本区域的每帧部件（Boss 预警条、玩家读条）。 */
  register(registry: FrameRegistry): void {
    registry.add(new BossCastBarPart(this.castBar));
    registry.add(new PlayerCastBarPart(this.playerCastBar));
  }

  /**
   * **UI 缩放**：两条读条各自按锚点重排。
   *
   * ⚠️ 只有**几何**跟着系数走，字号由 `CastBar.setRect` 内部处理 ——
   * 所以这里不需要像面板那样逐个调 `Label.setSize`。
   */
  setUiScale(scale: number): void {
    const ui = new UiLayout(scale);
    // 两处读条（Boss 预警 + 玩家读条）
    this.castBar.setRect(ui.castBar, scale);
    this.playerCastBar.setRect(ui.playerCastBar, scale);
  }
}
