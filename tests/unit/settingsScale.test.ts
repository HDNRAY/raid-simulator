import { afterEach, describe, expect, it } from 'vitest';
import {
  PANEL_SCALE_MAX,
  computeSettingsMetrics,
  currentSettingsMetrics,
  detailRowsAt,
  gridCapacityFor,
  gridMetricsFor,
  panelScaleFor,
  resetSettingsMetrics,
  scaledFont,
  setSettingsScale,
} from '../../src/ui/settings/settingsScale';
import { KEY_GRID_CAPACITY, keyCellRect } from '../../src/ui/settings/keyGridLayout';
import { FONT } from '../../src/ui/layout';

afterEach(() => resetSettingsMetrics());

describe('面板缩放模型（UI 缩放 → 面板能用多少）', () => {
  it('1× 时逐位等于老的几何（老断言继续成立）', () => {
    const m = computeSettingsMetrics(1);
    expect(m.k).toBe(1);
    expect(m.gridTop).toBe(88);
    expect(m.gridBottom).toBe(184);
    expect(m.lineH).toBe(22);
    expect(m.detailPadding).toBe(8);
  });

  it('面板外框**不随缩放变**（它已经顶到画布边）', () => {
    const a = computeSettingsMetrics(1);
    const b = computeSettingsMetrics(2);
    expect([b.panelX, b.panelY]).toEqual([a.panelX, a.panelY]);
    // 画布 960×540、面板 640×520 → 居中后 x=160 / y=10
    expect([a.panelX, a.panelY]).toEqual([160, 10]);
  });

  it('系数被**规则**钳在 1.2（200% 也不会溢出画布）', () => {
    expect(panelScaleFor(2)).toBe(PANEL_SCALE_MAX);
    expect(panelScaleFor(1.5)).toBe(PANEL_SCALE_MAX);
    expect(panelScaleFor(1)).toBe(1);
  });

  it('⚠️ 缩放**不吞功能**：桌面容量恒为 8、触屏恒为 6', () => {
    for (const ui of [1, 1.5, 2]) {
      setSettingsScale(ui);
      expect(gridCapacityFor(gridMetricsFor(true))).toBe(8);
      expect(gridCapacityFor(gridMetricsFor(false))).toBe(6);
      expect(KEY_GRID_CAPACITY).toBe(8);
    }
  });

  it('缩放后每一格仍在画布内、且不互相重叠', () => {
    for (const ui of [1, 2]) {
      setSettingsScale(ui);
      const rects = Array.from({ length: 8 }, (_, i) => keyCellRect(i, gridMetricsFor(true)));
      for (const r of rects) {
        expect(r.x).toBeGreaterThanOrEqual(0);
        expect(r.y).toBeGreaterThanOrEqual(0);
        expect(r.x + r.w).toBeLessThanOrEqual(960);
        // 格阵下沿不能压到提示行（430）
        expect(r.y + r.h).toBeLessThanOrEqual(230);
      }
      for (let i = 0; i < rects.length; i += 1) {
        for (let j = i + 1; j < rects.length; j += 1) {
          const a = rects[i];
          const b = rects[j];
          if (a === undefined || b === undefined) continue;
          const overlap = a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
          expect(overlap).toBe(false);
        }
      }
    }
  });

  it('字号跟系数走（`scaledFont`），且**下限由规则给出**（不会变小）', () => {
    setSettingsScale(1);
    expect(scaledFont(FONT.tiny)).toBe(FONT.tiny);
    setSettingsScale(2);
    expect(scaledFont(FONT.tiny)).toBe(Math.round(FONT.tiny * PANEL_SCALE_MAX));
    // 任何输入都不许把字变小（面板系数下限是 1）
    setSettingsScale(0.5);
    expect(scaledFont(FONT.body)).toBeGreaterThanOrEqual(FONT.body);
  });

  it('⚠️ 拉满时详情区"滚到底最后一行仍完整"（可滚 + 不越提示行）', () => {
    setSettingsScale(2);
    const m = currentSettingsMetrics();
    const rows = detailRowsAt(m.k);
    const inner = m.detailBottom - m.detailTop - 2 * m.detailPadding;
    /**
     * ⚠️ 一屏行数 × 行距 **不能超过内框高** —— 超了就是"最后一行被裁"
     * （`SKILL_DETAIL.padding` 那段注释记着的坑：可见行数必须从**内框**算）。
     */
    expect(rows * m.lineH).toBeLessThanOrEqual(inner);
    /** 内框还剩下至少半行的余量（否则第一行会被上 padding 压）。 */
    expect(inner - rows * m.lineH).toBeLessThan(m.lineH);
    /** 详情区外框**不许越过提示区上沿**（实测撞过：说明文字压在提示行上）。 */
    expect(m.detailBottom).toBeLessThan(m.hintTop);
    /** 滚到底需要至少一屏之外还有内容（`total > rows` 才可能有 offset）。 */
    expect(rows).toBeGreaterThanOrEqual(6);
  });

  it('详情区一屏行数：1× 是 8 行，拉满是 7 行（少一行、可滚）', () => {
    setSettingsScale(1);
    const a = detailRowsAt(currentSettingsMetrics().k);
    setSettingsScale(2);
    const b = detailRowsAt(currentSettingsMetrics().k);
    expect(a).toBe(8);
    /**
     * ⚠️ 这一条是**取舍的证据**（不是"越小越好"）：面板外框固定 520，
     * 行距按 k 放大（22 → 26）之后一屏少两行 —— 换来的是字号 11 → 13。
     * `SkillDetail` 可滚，所以少的那两行**滚得到**。
     */
    expect(b).toBe(7);
    expect(currentSettingsMetrics().lineH).toBe(26);
    /**
     * ⚠️ 详情区底边永远在提示区上沿**之上**（16×k 的间隙）——缩放不许
     * 让说明文字压到提示行上（这一条是实测撞出来的）。
     */
    const m = currentSettingsMetrics();
    expect(m.detailBottom).toBeLessThan(m.hintTop);
  });
});
