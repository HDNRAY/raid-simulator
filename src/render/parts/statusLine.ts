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
