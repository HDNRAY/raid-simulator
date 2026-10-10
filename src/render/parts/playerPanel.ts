/**
 * 玩家资源面板：名字 + 三根资源条 + 单字标签与数值 + buff 条。
 *
 * 帧部件。三条资源条**成组**更新 —— 它们是同一块面板的内容，
 * 拆开反而要各自记住"哪根条对应哪个资源"。
 */

import type { Bar, Label } from '../../ui/primitives';
import type { IconStrip } from '../IconStrip';
import { display } from '../hudUtils';
import { ratioOf } from '../viewModel';
import type { FrameContext, FramePart } from '../sceneTypes';

/** 玩家面板部件。 */
export class PlayerPanelPart implements FramePart {
  readonly name = 'playerPanel';

  constructor(
    private readonly refs: {
      readonly playerName: Label;
      readonly hpBar: Bar;
      readonly energyBar: Bar;
      readonly douqiBar: Bar;
      readonly hpLabel: Label;
      readonly energyLabel: Label;
      readonly douqiLabel: Label;
      readonly hpText: Label;
      readonly energyText: Label;
      readonly douqiText: Label;
      readonly playerBuffs: IconStrip;
      readonly playerDebuffs: IconStrip;
    },
  ) {}

  render(ctx: FrameContext): void {
    const { view, translate } = ctx;
    const r = this.refs;
    r.playerName.set(translate(view.player.nameKey));
    r.hpBar.update(ratioOf(view.player.hp));
    r.energyBar.update(ratioOf(view.player.energy));
    r.douqiBar.update(ratioOf(view.player.douqi));
    // 单字标签：血 / 炁 / 缠（楷体）。用展示刻度显示数值（100 制）
    r.hpLabel.set(translate('resource.hpShort'));
    r.energyLabel.set(translate('resource.energyShort'));
    r.douqiLabel.set(translate('resource.douqiShort'));
    r.hpText.set(`${display(view.player.hp.current)}/${display(view.player.hp.cap)}`);
    r.energyText.set(`${display(view.player.energy.current)}/${display(view.player.energy.cap)}`);
    r.douqiText.set(`${display(view.player.douqi.current)}/${display(view.player.douqi.cap)}`);
    /** ⚠️ 按 `polarity` 分流：增益在下、减益在上（需求）。 */
    r.playerBuffs.update(view.player.buffs.filter((b) => b.polarity !== 'debuff'));
    r.playerDebuffs.update(view.player.buffs.filter((b) => b.polarity === 'debuff'));
  }
}
