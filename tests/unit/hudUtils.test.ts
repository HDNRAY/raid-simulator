import { describe, expect, it } from 'vitest';
import { formatClockSafe } from '../../src/render/hudUtils';

/**
 * `M:SS` 的显示规则（**全仓唯一一份**）。
 *
 * ==================================================================
 * 为什么这份测试在这里
 * ==================================================================
 *
 * 原先有两份**逐字等价**的实现：`viewModel.ts` 的 `formatClock` 与
 * `hudUtils.ts` 的 `formatClockSafe`（拆 `render/BattleScene.ts` 时抽出来的）。
 * 按 AGENTS.md §2「同一件事有第二份表达，而第一份是活的 → 删第二份」核实：
 *
 *   - `formatClock`（viewModel）：**生产里零调用**，只有测试保活
 *   - `formatClockSafe`（hudUtils）：`parts/bossTopBar.ts` 在用（活的那份）
 *
 * 所以删掉 `formatClock`，把它的 M:SS 测试**搬到这里**（不连行为一起丢）——
 * 覆盖的正是活下来的那一份。
 *
 * ⚠️ 两份实现连边界行为都**逐字相同**（`Number.isFinite` 兜底 / `Math.max(0, …)`
 * / `Math.ceil` / `padStart(2,'0')`），所以这次合并是零行为变化，不是"差不多"。
 */
describe('formatClockSafe —— M:SS（唯一一份）', () => {
  it('M:SS 格式', () => {
    expect(formatClockSafe(0)).toBe('0:00');
    expect(formatClockSafe(1000)).toBe('0:01');
    expect(formatClockSafe(65_000)).toBe('1:05');
    expect(formatClockSafe(180_000)).toBe('3:00');
  });

  it('向上取整（剩 0.1 秒也显示 1 秒，不会提前显示 0）', () => {
    expect(formatClockSafe(100)).toBe('0:01');
    expect(formatClockSafe(1801_000)).toBe('30:01');
  });

  it('边界：负数夹到 0，超过 60 分钟不小时化（与删掉的那份一致）', () => {
    expect(formatClockSafe(-500)).toBe('0:00');
    /** 3600000ms = 60 分钟 → `60:00`（不折成 `1:00:00`）。 */
    expect(formatClockSafe(3_600_000)).toBe('60:00');
  });

  it('边界：NaN / Infinity 安全（不可能的时间显示 `--:--`）', () => {
    expect(formatClockSafe(Number.NaN)).toBe('--:--');
    expect(formatClockSafe(Number.POSITIVE_INFINITY)).toBe('--:--');
    expect(formatClockSafe(Number.NEGATIVE_INFINITY)).toBe('--:--');
  });
});
