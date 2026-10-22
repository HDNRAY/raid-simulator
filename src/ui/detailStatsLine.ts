/**
 * **详情区里"技能数值"那一行**（2026-10-22）：`前摇 0.8 秒   冷却 3 秒   缠 40`。
 *
 * 每一段一个颜色（见 `ui/detailStats` 文件头那张表），段与段之间留一点空。
 *
 * ⚠️ 为什么单独一个类：`prepareDetailPanel` 已经 682 行（AGENTS §3 的上限
 * 700）—— 把"三个 Label 的造/画/量高"搬出来，面板那边只剩几行调用 ✓。
 *
 * ⚠️ 段数上限 = 3（前摇 / 冷却 / 代价），与 `DetailStatKind` 的三个成员一一
 * 对应。多的段**不画**（今天最多三项：一个技能最多一个前摇、一个冷却，
 * 代价可能两项 —— 真的出现两项代价时第二项会被截掉；宁可少一行也不越界）。
 */

import { FONT } from './layout';
import { Label, type PixiCtor } from './primitives';
import { PALETTE } from '../render/theme';
import { statSegmentsOf } from './detailStats';
import type { DetailStat } from './prepareDetail';
import type { TranslateFn } from '../i18n/translator';

/** 一段数值最多几项（见文件头）。 */
const MAX_SEGMENTS = 3;

/** 一段（已本地化的标签 + 值 + 颜色），由 `ui/detailStats.statSegmentsOf` 给。 */
export interface StatsSegment {
  readonly label: string;
  readonly value: string;
  readonly color: number;
}

export class DetailStatsLine {
  private readonly labels: Label[] = [];

  constructor(pixi: PixiCtor) {
    for (let i = 0; i < MAX_SEGMENTS; i += 1) {
      this.labels.push(
        new Label(pixi, {
          x: 0,
          y: 0,
          size: FONT.small,
          color: PALETTE.textDim,
        }),
      );
    }
  }

  /** 这一行的高度（没有段时 = 0 ⇒ 不占位）。 */
  get height(): number {
    const visible = this.labels.filter((label) => label.root.visible);
    if (visible.length === 0) return 0;
    return Math.max(...visible.map((label) => label.root.height));
  }

  /**
   * **画一整行并返回下一个 y**（面板那边一行调用）。
   *
   * 自己 prefix 的三个职责：清掉上一行的段、按段排版、把高度加进 y。
   */
  render(
    y: number,
    originX: number,
    stats: readonly DetailStat[],
    t: TranslateFn,
  ): number {
    this.clear();
    if (stats.length === 0) return y;
    this.layout(y, originX, statSegmentsOf(stats, t, (r) => t(`resource.${r}`)));
    return y + this.height;
  }

  /** 把这一行画进容器（一次装配：所有 Label 加进去）。 */
  attach(add: (child: Label['root']) => void): void {
    for (const label of this.labels) add(label.root);
  }

  /**
   * 摆到 `y`（内容坐标），并按段横排。
   *
   * ⚠️ 横向排布用**实测宽度**累加：中文字宽不是等宽的，写死 `i * 60` 会让
   * 段与段之间重叠或者拉开一条沟。
   */
  layout(y: number, originX: number, segments: readonly StatsSegment[]): void {
    let x = originX;
    let used = 0;
    for (const [index, label] of this.labels.entries()) {
      const segment = segments[index];
      if (segment === undefined) {
        label.root.visible = false;
        continue;
      }
      label.root.visible = true;
      label.set(`${segment.label} ${segment.value}`);
      label.setColor(segment.color);
      label.root.x = x;
      label.root.y = y;
      x += label.root.width + 12;
      used += 1;
    }
    void used;
  }

  setVisible(visible: boolean): void {
    for (const label of this.labels) label.root.visible = visible && label.root.visible;
  }

  /** 这一行**现在的**画布 y（`placeRows` 平移时用）。 */
  setY(y: number): void {
    for (const label of this.labels) {
      if (label.root.visible) label.root.y = y;
    }
  }

  /** 清掉所有段（换一条技能行时）。 */
  clear(): void {
    for (const label of this.labels) {
      label.root.visible = false;
      label.set('');
    }
  }

  /** 供 `placeRows` 判断"完全在外"用的矩形高度。 */
  bandHeight(fallback: number): number {
    const h = this.height;
    return h > 0 ? h : fallback;
  }

}
