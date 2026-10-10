/**
 * Boss 顶栏：名字 / 阶段位 / 倒计时 / 血条 / 狂暴标记 / buff 条。
 *
 * 帧部件（见 `FramePart`）。从 `BattleScene.update()` 的"顶栏"段
 * 原样搬出来 —— 那里原先是一个 202 行的顺序调用清单。
 */

import type { Bar, Label } from '../../ui/primitives';
import { LAYOUT } from '../../ui/layout';
import { PALETTE } from '../theme';
import { ratioOf } from '../viewModel';
import type { IconStrip } from '../IconStrip';
import { display, formatClockSafe, percentOf } from '../hudUtils';
import type { FrameContext, FramePart } from '../sceneTypes';

/** Boss 顶栏部件。 */
export class BossTopBarPart implements FramePart {
  readonly name = 'bossTopBar';

  constructor(
    private readonly refs: {
      readonly bossName: Label;
      readonly bossPhase: Label;
      readonly timerLabel: Label;
      readonly bossHpBar: Bar;
      readonly bossHpText: Label;
      readonly enrageBadge: Label;
      readonly bossBuffs: IconStrip;
      readonly bossDebuffs: IconStrip;
    },
  ) {}

  render(ctx: FrameContext): void {
    const { view, translate } = ctx;
    const { bossName, bossPhase, timerLabel, bossHpBar, bossHpText, enrageBadge, bossBuffs, bossDebuffs } =
      this.refs;
    const bb = LAYOUT.bossBar;
    bossName.set(translate(view.boss.nameKey));
    // 阶段紧跟名字，用实际宽度定位（不硬编码偏移，换语言也不会重叠）
    bossPhase.root.x = bb.x + 2 + bossName.root.width + 10;
    /**
     * 不再显示"阶段 N"。
     *
     * 阶段是**内容概念**（一层 buff），引擎不知道它是什么，
     * 所以这里也没有数字可显示 —— 阶段由 Boss buff 条上那个图标表达，
     * 玩家看到「狂怒」就知道进二阶段了。
     */
    bossPhase.set('');
    bossPhase.setColor(view.enraged ? PALETTE.danger.bright : PALETTE.textDim);
    timerLabel.set(view.remainingMs === undefined ? '' : formatClockSafe(view.remainingMs));
    timerLabel.setColor(
      view.remainingMs !== undefined && view.remainingMs < 30_000
        ? PALETTE.danger.bright
        : 0xf0c060,
    );

    bossHpBar.update(ratioOf(view.boss.hp));
    // 血量与狂暴标记共用一行：狂暴时用它替换血量数字（更紧急的信息优先）
    if (view.enraged) {
      enrageBadge.set(translate('event.enrage'));
      bossHpText.set('');
    } else {
      enrageBadge.set('');
      bossHpText.set(
        `${display(view.boss.hp.current)} / ${display(view.boss.hp.cap)}   ${percentOf(view.boss.hp)}%`,
      );
    }
    /**
     * ⚠️ 按 `polarity` **分流到两条**：增益在左上、减益在右上（需求）。
     * `neutral` 归到增益侧 —— 它既不是好处也不是坏处，放左边与"引擎状态"
     * 的语义一致（这类 buff 基本都是内部标记，通常还是 hidden）。
     */
    bossBuffs.update(view.boss.buffs.filter((b) => b.polarity !== 'debuff'));
    bossDebuffs.update(view.boss.buffs.filter((b) => b.polarity === 'debuff'));
  }
}
