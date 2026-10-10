/**
 * 屏幕中下的**状态提示**（技能被拒的原因这类）。
 *
 * 需求划定过范围：这里只放"我那一下为什么没生效"，
 * **不放**战斗事件（那些进战斗日志）。
 */

import type { Label } from '../../ui/primitives';
import type { FrameContext, FramePart } from '../sceneTypes';

/** 状态提示部件。 */
export class StatusLinePart implements FramePart {
  readonly name = 'statusLine';

  constructor(
    private readonly statusLabel: Label,
    private readonly statusSub: Label,
  ) {}

  render(ctx: FrameContext): void {
    const { view, translate } = ctx;
    const status = view.statusLine;
    /**
     * 状态提示区只显示**技能被拒的原因**（「攻 · 公共冷却中」这类）。
     *
     * "可打断"曾经也画在这里 —— 但预警条右侧已经有同一句话，
     * 屏幕中央再出现一次纯属噪音（那个位置应该留给真正的突发事件）。
     */
    if (status !== undefined && view.statusDetail !== undefined) {
      this.statusLabel.set('');
      this.statusSub.set(`${translate(view.statusDetail)}  ·  ${translate(status)}`);
      this.statusSub.setColor(0xffb0a0);
    } else {
      this.statusLabel.set(status === undefined ? '' : translate(status));
      this.statusSub.set('');
    }
    this.statusLabel.root.visible = this.statusLabel.root.text !== '';
    this.statusSub.root.visible = this.statusSub.root.text !== '';
  }
}

/**
 * **「眩晕中」横幅** —— 玩家被完全锁死时显示。
 *
 * 需求："现在可以做 眩晕的UI了，可以测了"
 *
 * ⚠️ 为什么不只靠 buff 图标行：图标行是 20×20 方块 + 最多 2 字短标签，
 * 而且和别的减益混排。眩晕是"**连续 3 秒按什么都没反应**"——只能从那种
 * 线索察觉的话，玩家会以为游戏卡死了。
 *
 * ⚠️ 只对**玩家**显示（`view.player.stunned`）：Boss 被控是它自己的事，
 * 而玩家不会按 Boss 的技能，给它加横幅只是噪音。
 */
export class StunBannerPart implements FramePart {
  readonly name = 'stunBanner';

  constructor(private readonly label: Label) {}

  render(ctx: FrameContext): void {
    const { view, translate } = ctx;
    const show = view.player.stunned;
    /**
     * ⚠️ key 是 `buffShort.stunned`（在 `buffShort` 块里），不是
     * `hud.stunned` —— 写错时 `translate` 会把 **key 本身**当初文案显示
     * （实测横幅上出现的是 `hud.stunned` 这串字）。
     */
    this.label.set(show ? translate('buffShort.stunned') : '');
    /**
     * ⚠️ 用 `text !== ''` 而不是 `show` 判显隐：`Label.set('')` 之后
     * 文本是空的，但节点还在 —— 直接用 `show` 也行，这里保持一致写法
     * （与 `StatusLinePart` 同样的模式）。
     */
    this.label.root.visible = this.label.root.text !== '';
  }
}
