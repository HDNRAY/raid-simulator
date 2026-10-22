/**
 * **结算面板的文字渲染**（胜/负、原因、统计、重开提示）。
 *
 * ==================================================================
 * 为什么单独一个文件
 * ==================================================================
 *
 * 它是纯文字装配：只读 `view.result` 与 `translate`，不碰任何场景节点
 * 的生命周期。留在 `BattleScene.ts` 里让那个文件同时承担"场景编排"和
 * "结算文案排版"两种职责，而且它长期贴着 700 行上限（AGENTS.md §3）。
 */

import { PALETTE } from './theme';
import type { Label } from '../ui/primitives';
import type { BattleSnapshotView } from './viewModel';
import type { TranslateFn } from './sceneTypes';

/** 结算面板上那几个会被写的标签。 */
export interface ResultRefs {
  readonly resultLayer: { visible: boolean };
  readonly resultTitle: Label;
  readonly resultReason: Label;
  readonly resultStats: Label;
  readonly resultHint: Label;
}

/**
 * 渲染结算面板。
 *
 * @param showKeyHints 是否显示键名（触屏传 `false`）—— 决定重开提示用哪句
 */
/**
 * 结算提示该用哪一句（**纯函数**，2026-10-22）。
 *
 * 用户报："肉鸽战斗胜利后，写的还是 **enter 再来一次**" —— "再来一次"是
 * **自由模式**的说法；肉鸽里要往下走（下一场 / 选炁机 / 结算这一局）。
 *
 * | 模式 | 键位提示开着 | 触屏（不显示键名） |
 * |---|---|---|
 * | 自由 | `screen.hintRestart`（按 Enter 再来一次） | `screen.hintRestartTap` |
 * | 肉鸽 | `screen.hintContinue`（按 Enter 继续） | `screen.hintContinueTap` |
 */
export function resultHintKey(showKeyHints: boolean, roguelike: boolean): string {
  if (roguelike) return showKeyHints ? 'screen.hintContinue' : 'screen.hintContinueTap';
  return showKeyHints ? 'screen.hintRestart' : 'screen.hintRestartTap';
}

export function renderResultPanel(
  refs: ResultRefs,
  view: BattleSnapshotView,
  translate: TranslateFn,
  showKeyHints: boolean,
): void {
  const result = view.result;
  refs.resultLayer.visible = result !== undefined;
  if (!result) return;

  refs.resultTitle.set(translate(result.titleKey));
  refs.resultTitle.setColor(result.victory ? 0xffd870 : PALETTE.danger.bright);

  /**
   * ⚠️ 参数值可能是**另一个 i18n key**（`boss.name`）—— 适配器只给 key，
   * 翻译在渲染层做（i18n 规范 I1）。这里的"再翻一次"是有意的。
   */
  const reasonParams = result.reasonParams;
  refs.resultReason.set(
    reasonParams === undefined
      ? translate(result.reasonKey)
      : translate(
          result.reasonKey,
          Object.fromEntries(
            Object.entries(reasonParams).map(([k, v]) => [
              k,
              typeof v === 'string' ? translate(v) : v,
            ]),
          ),
        ),
  );

  /** 重开提示按模式分流。⚠️ 所有文案都走 i18n（规范 I1）。 */
  refs.resultHint.set(translate(resultHintKey(showKeyHints, result.roguelike === true)));

  /** 统计用等宽对齐的"标签  值"，比堆一串数字好读。 */
  const rows: Array<[string, string]> = [
    [translate('screen.statTime'), `${result.seconds}s`],
    [translate('screen.statRemainingHp'), `${result.remainingHp}/${result.remainingHpCap}`],
    [translate('screen.statTotalDamage'), `${result.totalDamage}`],
    [translate('screen.statDps'), `${result.dps}`],
  ];
  const width = Math.max(...rows.map(([k]) => k.length));
  refs.resultStats.set(rows.map(([k, v]) => `${k.padEnd(width, ' ')}   ${v}`).join('\n'));
}
