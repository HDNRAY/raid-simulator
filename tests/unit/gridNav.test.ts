import { describe, expect, it } from 'vitest';
import { gridCell, gridColumns, gridIndexOf, gridRows, stepGrid } from '../../src/ui/gridNav';

/**
 * ==================================================================
 * 二维网格的走位（`ui/gridNav.ts`）
 * ==================================================================
 *
 * 这一份测的是**一个真的踩过的 bug**：第一版的签名是
 * `stepGrid(index, delta, direction, shape)`，而符号只认 `delta` ——
 * 调用方传 `(0, 1, 'up')` 时它会**往下**走一行（`'up'` 只被当成"竖直"）。
 *
 * 那个 bug 在页面上**看不出来**（↑ 与 ↓ 都动一格），所以必须有断言钉住
 * 每个方向的**符号**，而不是只钉"有变化"。
 */
describe('网格形状：列数 / 行数 / 第几格', () => {
  it('列数被夹进 `1..min(columns, count)`（张数少于列数时只用那么多列）', () => {
    expect(gridColumns(3, 5)).toBe(3);
    expect(gridColumns(8, 5)).toBe(5);
    expect(gridColumns(0, 5)).toBe(1);
    expect(gridColumns(8, 0)).toBe(1);
  });

  it('行数 = ceil(count / 列数)；空网格 0 行', () => {
    expect(gridRows(8, 5)).toBe(2);
    expect(gridRows(5, 5)).toBe(1);
    expect(gridRows(0, 5)).toBe(0);
  });

  it('`gridCell` / `gridIndexOf` 互为反函数（在网格内）', () => {
    for (let i = 0; i < 8; i += 1) {
      const { row, col } = gridCell(i, 8, 5);
      expect(gridIndexOf(row, col, 8, 5)).toBe(i);
    }
    /** 网格之外的格子：`undefined`（不是"随便给一个"）。 */
    expect(gridIndexOf(0, 5, 8, 5)).toBeUndefined();
    expect(gridIndexOf(-1, 0, 8, 5)).toBeUndefined();
    expect(gridIndexOf(1, 3, 8, 5)).toBeUndefined();
  });
});

describe('⚠️ 四个方向的**符号**（第一版把 up 写成了往下）', () => {
  const shape = { count: 8, columns: 5 };

  it('→ 在同一行内 +1；← 是 −1', () => {
    expect(stepGrid(0, 'right', shape)).toBe(1);
    expect(stepGrid(1, 'left', shape)).toBe(0);
  });

  it('【关键】↓ 往下**一行**（+列数）；↑ 往上**一行**（−列数）', () => {
    expect(stepGrid(0, 'down', shape)).toBe(5);
    expect(stepGrid(5, 'up', shape)).toBe(0);
    expect(stepGrid(2, 'down', shape)).toBe(7);
    expect(stepGrid(7, 'up', shape)).toBe(2);
  });

  it('【关键】第一行按 ↑ **不动**（不会跑到第二行去）', () => {
    expect(stepGrid(0, 'up', shape)).toBe(0);
    expect(stepGrid(3, 'up', shape)).toBe(3);
  });
});

describe('到边界停住（不环绕）', () => {
  const shape = { count: 8, columns: 5 };

  it('一行的**两端**停住：第 5 张再往右不动（它不是第 6 张）', () => {
    expect(stepGrid(4, 'right', shape)).toBe(4);
    expect(stepGrid(5, 'left', shape)).toBe(5);
  });

  it('最后一行比上面短：往下**夹到那一行的最后一格**（不是"没反应"）', () => {
    /**
     * 8 张 5 列 → 第二行只有 3 张（下标 5/6/7）。
     * 第一行第 5 列（下标 4）的"正下方"没有格子 → 落到那一行**最后**一格（7）。
     * ⚠️ 旧版会"原地不动"，而它下面明明还有一行 —— 看起来像"最右一列的
     * ↓ 键坏了"。
     */
    expect(stepGrid(0, 'down', shape)).toBe(5);
    expect(stepGrid(4, 'down', shape)).toBe(7);
    expect(stepGrid(3, 'down', shape)).toBe(7);
    /** 第二行往下：到头了，停住。 */
    expect(stepGrid(5, 'down', shape)).toBe(5);
  });

  it('最后一行往右走到头停住（行尾 = 下标 7）', () => {
    expect(stepGrid(7, 'right', shape)).toBe(7);
  });

  it('空网格：原地返回 0（不产生 NaN / 负数）', () => {
    expect(stepGrid(0, 'up', { count: 0, columns: 5 })).toBe(0);
    expect(stepGrid(0, 'right', { count: 0, columns: 5 })).toBe(0);
  });
});

describe('`wrap`：Tab 那种"循环"语义（本屏的方向键不用它）', () => {
  const shape = { count: 8, columns: 5 };

  it('行内环绕：行尾再往右回到行首', () => {
    expect(stepGrid(4, 'right', shape, true)).toBe(0);
    expect(stepGrid(0, 'left', shape, true)).toBe(4);
    /** 第二行只有 3 张：环绕在**那一行自己的**范围里（5..7）。 */
    expect(stepGrid(7, 'right', shape, true)).toBe(5);
  });

  it('竖直环绕：走到头回到第一行 / 最后一行', () => {
    expect(stepGrid(7, 'down', shape, true)).toBe(2);
    expect(stepGrid(2, 'up', shape, true)).toBe(7);
  });
});
