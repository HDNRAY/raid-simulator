/**
 * **详情区"结构化数值"那一行**（2026-10-22）。
 *
 * 用户原话："boss详情里，技能有显示 cd和读条时间吗，我希望显示，结构化显示，
 * 可以有不同颜色"。
 *
 * 这一份只管**纯的**东西：三种槽位各自的**标签 key / 值文案 / 颜色**。
 * 摆放与显隐在 `prepareDetailPanel`（那是布局的事）。
 *
 * ⚠️ 颜色用 `PALETTE` 里**已有的语义色**，不发明新色：
 *
 * | 槽位 | 颜色 | 为什么 |
 * |---|---|---|
 * | 前摇 | `magic`（紫） | 施法/读条在本作里一直是 magic 那一支 |
 * | 冷却 | `proc`（青） | 与"计时/节拍"的既有用法一致 |
 * | 代价 | `douqi`（金） | 资源条就是这套色（炁是绿的、缠是金的，这里取"缠"的基色做代价的统一色） |
 */

import { PALETTE } from '../render/theme';
import type { TranslateFn } from '../i18n/translator';
import type { DetailStat, DetailStatKind } from './prepareDetail';

/** 三种槽位的标签 key。 */
export function statLabelKey(kind: DetailStatKind): string {
  if (kind === 'cast') return 'roster.ui.detail.statCast';
  if (kind === 'cooldown') return 'roster.ui.detail.statCooldown';
  return 'roster.ui.detail.statCost';
}

/** 三种槽位的颜色（见文件头那张表）。 */
export function statColor(kind: DetailStatKind): number {
  if (kind === 'cast') return PALETTE.magic.base;
  if (kind === 'cooldown') return PALETTE.proc.base;
  return PALETTE.douqi.base;
}

/**
 * 一条数值**已经本地化**的文本（不含标签）。
 *
 * @param resourceName 资源名（`energy` → 「炁」）；由调用方注入 —— 这一层
 *   不认识 i18n 的键名规则，只负责拼。
 */
export function statValueText(
  stat: DetailStat,
  t: TranslateFn,
  resourceName: (resource: string) => string,
): string {
  if (stat.kind === 'cost') {
    return t('roster.ui.detail.statCostValue', {
      resource: resourceName(stat.resourceKey ?? ''),
      amount: String(stat.amount ?? 0),
    });
  }
  return t('roster.ui.detail.statSeconds', { seconds: String(stat.seconds ?? 0) });
}

/** 一整行数值的**分段**（标签 + 值），渲染层按段取色。 */
export function statSegmentsOf(
  stats: readonly DetailStat[],
  t: TranslateFn,
  resourceName: (resource: string) => string,
): readonly { readonly label: string; readonly value: string; readonly color: number }[] {
  return stats.map((stat) => ({
    label: t(statLabelKey(stat.kind)),
    value: statValueText(stat, t, resourceName),
    color: statColor(stat.kind),
  }));
}
