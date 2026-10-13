import { describe, expect, it } from 'vitest';
import {
  QIJI_SELECT_LAYOUT,
  QIJI_SELECT_SLOTS,
  canConfirm,
  clampIndex,
  confirmQiji,
  moveQijiCursor,
  pickQiji,
  qijiAtPoint,
  qijiCursorTarget,
  qijiHitAreas,
  qijiHintY,
  qijiRows,
  type QijiCandidate,
  type QijiView,
} from '../../src/ui/qijiSelectLogic';

/**
 * **选炁机屏的纯逻辑**（`src/ui/qijiSelectLogic.ts`）—— P3。
 *
 * ==================================================================
 * 这一份测的是什么（以及为什么不能只靠截图）
 * ==================================================================
 *
 * 三件"看起来对、其实错"的事：
 *   1. **分行**：候选数量随解锁进度变（2 → 5 …），分行算错的表现是
 *      "两张卡叠在一起"或"最后一张跑出画布"—— 截图上一眼看不准。
 *   2. **光标**：两端停住 / Tab 环绕 / ↑↓ 换行。写错的表现是
 *      "方向键偶尔没反应"，而那种 bug 在截图里**根本不存在**。
 *   3. **"点了哪一张"**：命中区与画出来的卡片必须**同一份几何**
 *      （本文件里只有一条公式算它，测试钉的就是那条公式）。
 *
 * ⚠️ 不测颜色 / 字号 / 文案 —— 那是渲染层的事，看图（AGENTS.md §4）。
 */

/** 造一个候选（只需要 id；`QijiView` 的其它字段本测试不关心）。 */
function candidate(id: string, extra: Partial<QijiView> = {}, remaining = 1): QijiCandidate {
  return {
    qiji: { id, nameKey: `qiji.${id}.name`, icon: 'icon', ...extra },
    remaining,
  };
}

/**
 * ⚠️ 测试里的"一行装几个"**从布局算出来**，不写死数字。
 *
 * 写死过一次（`176` 宽的年代是 4 个），改卡片宽度时那几条断言全红 ——
 * 而它们红的原因是"几何变了"，不是"逻辑坏了"。判据只有一处：布局表。
 */
const PER_ROW = Math.floor(
  (QIJI_SELECT_LAYOUT.maxRowW + QIJI_SELECT_LAYOUT.gap) /
    (QIJI_SELECT_LAYOUT.cardW + QIJI_SELECT_LAYOUT.gap),
);

const TWO = [candidate('a'), candidate('b')];
/** 恰好一行（`perRow` 个）—— 单行光标测试用它。 */
const ONE_ROW = Array.from({ length: PER_ROW }, (_, i) => candidate(`r${i}`));
/** 两行（`perRow × 2`）—— 换行测试用它。 */
const TWO_ROWS = Array.from({ length: PER_ROW * 2 }, (_, i) => candidate(`t${i}`));
/** 4 个（命中区测试用；它在 3 个一行时是 2+2 两行）。 */
const FOUR = [candidate('a'), candidate('b'), candidate('c'), candidate('d')];
const SIX = ['a', 'b', 'c', 'd', 'e', 'f'].map((id) => candidate(id));

describe('分行（`qijiRows`）：尽量少行、每行均分', () => {
  it('0 个 → 0 行（不是"一行空的"）', () => {
    expect(qijiRows(0)).toEqual([]);
  });

  it('1..`perRow` 个 → 一行（上限由布局算出来）', () => {
    expect(PER_ROW).toBeGreaterThanOrEqual(3);
    for (let n = 1; n <= PER_ROW; n += 1) {
      expect(qijiRows(n)).toHaveLength(1);
      expect(qijiRows(n)[0]).toHaveLength(n);
    }
  });

  it('⚠️ `perRow × 2` 个 → **两行均分**（不是"第一行塞满、第二行剩一点"）', () => {
    /**
     * `perRow` 是**上限**：6 个塞进 4 列会得到 4 + 2 —— 两行长短差一倍，
     * 视觉上像"最后一张漏了"。均分（3 + 3）更稳。
     */
    const n = PER_ROW * 2;
    expect(qijiRows(n)).toHaveLength(2);
    expect(qijiRows(n).map((r) => r.length)).toEqual([PER_ROW, PER_ROW]);
  });

  it('`perRow × 3` 个 → 三行均分', () => {
    const n = PER_ROW * 3;
    expect(qijiRows(n).map((r) => r.length)).toEqual([PER_ROW, PER_ROW, PER_ROW]);
  });

  it('每行的下标连续、合起来恰好是 0..n-1（不重不漏）', () => {
    for (const n of [1, 2, 3, 4, 5, 6, 7, 8, 9, 12]) {
      const flat = qijiRows(n).flat();
      expect(flat).toEqual(Array.from({ length: n }, (_, i) => i));
    }
  });

  it('每行都不超过布局允许的张数（否则会溢出画布）', () => {
    const L = QIJI_SELECT_LAYOUT;
    const perRow = Math.floor((L.maxRowW + L.gap) / (L.cardW + L.gap));
    for (const n of [1, 2, 5, 6, 9]) {
      for (const row of qijiRows(n)) expect(row.length).toBeLessThanOrEqual(perRow);
    }
  });
});

describe('命中区（`qijiHitAreas`）：几何是算出来的，卡片与命中用同一份', () => {
  it('一张卡时水平居中', () => {
    const [area] = qijiHitAreas([candidate('a')]);
    expect(area).toBeDefined();
    if (area === undefined) return;
    expect(area.x + area.w / 2).toBeCloseTo(480, 6);
  });

  it('两行时第二行的 y 比第一行低一行高', () => {
    const areas = qijiHitAreas(SIX);
    const firstRow = areas.slice(0, 3);
    const secondRow = areas.slice(3);
    expect(secondRow[0]?.y).toBeCloseTo((firstRow[0]?.y ?? 0) + QIJI_SELECT_LAYOUT.cardH + QIJI_SELECT_LAYOUT.gap, 6);
  });

  it('⚠️ 任意两张卡都不重叠（重叠 = 点哪张说不清）', () => {
    for (const set of [TWO, FOUR, SIX]) {
      const areas = qijiHitAreas(set);
      for (let i = 0; i < areas.length; i += 1) {
        for (let j = i + 1; j < areas.length; j += 1) {
          const a = areas[i];
          const b = areas[j];
          if (a === undefined || b === undefined) continue;
          const overlapX = a.x < b.x + b.w && b.x < a.x + a.w;
          const overlapY = a.y < b.y + b.h && b.y < a.y + a.h;
          expect(overlapX && overlapY, `第 ${i} 张与第 ${j} 张重叠`).toBe(false);
        }
      }
    }
  });

  it('全部卡片都在画布内（横向 0..960）', () => {
    for (const set of [TWO, FOUR, SIX]) {
      for (const area of qijiHitAreas(set)) {
        expect(area.x).toBeGreaterThanOrEqual(0);
        expect(area.x + area.w).toBeLessThanOrEqual(960);
      }
    }
  });

  it('区域的 `index` 与候选下标一一对应（顺序 = 画出来的顺序）', () => {
    expect(qijiHitAreas(SIX).map((a) => a.index)).toEqual([0, 1, 2, 3, 4, 5]);
  });
});

describe('命中判定（`qijiAtPoint` / `pickQiji`）', () => {
  it('点中心点中对应的卡', () => {
    const areas = qijiHitAreas(FOUR);
    areas.forEach((area, i) => {
      const hit = qijiAtPoint(FOUR, area.x + area.w / 2, area.y + area.h / 2);
      expect(hit?.qiji.id).toBe(FOUR[i]?.qiji.id);
    });
  });

  it('点空白处 → undefined（不误选）', () => {
    expect(qijiAtPoint(FOUR, 5, 5)).toBeUndefined();
  });

  it('`pickQiji` 一步到位：返回"移光标 + 选谁"', () => {
    const areas = qijiHitAreas(FOUR);
    const third = areas[2];
    expect(third).toBeDefined();
    if (third === undefined) return;
    const picked = pickQiji(FOUR, third.x + 1, third.y + 1);
    expect(picked).toEqual({ cursor: 2, qijiId: 'c' });
  });

  it('`pickQiji` 点空 → undefined', () => {
    expect(pickQiji(FOUR, 5, 5)).toBeUndefined();
  });
});

describe('光标（`moveQijiCursor`）', () => {
  it('没有候选时恒 0（不会越界）', () => {
    expect(moveQijiCursor([], 0, 1)).toBe(0);
    expect(moveQijiCursor([], 3, -1)).toBe(0);
  });

  it('一行：← → 两端**停住**', () => {
    const last = ONE_ROW.length - 1;
    expect(moveQijiCursor(ONE_ROW, 0, -1)).toBe(0);
    expect(moveQijiCursor(ONE_ROW, last, 1)).toBe(last);
    expect(moveQijiCursor(ONE_ROW, 1, 1)).toBe(2);
  });

  it('一行：`wrap` = 环绕（Tab 的通用语义）', () => {
    const last = ONE_ROW.length - 1;
    expect(moveQijiCursor(ONE_ROW, last, 1, 'x', true)).toBe(0);
    expect(moveQijiCursor(ONE_ROW, 0, -1, 'x', true)).toBe(last);
  });

  it('⚠️ 两行：↑ ↓ 按**一行张数**换行（不是按横坐标就近吸）', () => {
    /** 第 0 个按 ↓ 应该到正下方（第 `perRow` 个），不是第 1 个。 */
    expect(moveQijiCursor(TWO_ROWS, 0, 1, 'y')).toBe(PER_ROW);
    expect(moveQijiCursor(TWO_ROWS, PER_ROW, -1, 'y')).toBe(0);
    const last = TWO_ROWS.length - 1;
    expect(moveQijiCursor(TWO_ROWS, last, 1, 'y')).toBe(last); // 底部停住
  });

  it('两行：← → 只在**行内**移动（不会跨行）', () => {
    const rowEnd = PER_ROW - 1;
    expect(moveQijiCursor(TWO_ROWS, rowEnd, 1, 'x')).toBe(rowEnd); // 第一行最后一个，停住
    expect(moveQijiCursor(TWO_ROWS, PER_ROW, -1, 'x')).toBe(PER_ROW); // 第二行第一个，停住
    expect(moveQijiCursor(TWO_ROWS, PER_ROW, 1, 'x')).toBe(PER_ROW + 1);
  });

  it('越界的光标先被夹回来（不会从 99 开始算）', () => {
    expect(moveQijiCursor(FOUR, 99, 0)).toBe(3);
  });

  it('`clampIndex`：负数 / 越界 / 空表', () => {
    expect(clampIndex(-5, 4)).toBe(0);
    expect(clampIndex(99, 4)).toBe(3);
    expect(clampIndex(2, 4)).toBe(2);
    expect(clampIndex(0, 0)).toBe(0);
  });
});

describe('确认（Enter）与光标目标', () => {
  it('`qijiCursorTarget` 给光标处那一个；空表给 undefined', () => {
    expect(qijiCursorTarget(FOUR, 2)?.qiji.id).toBe('c');
    expect(qijiCursorTarget([], 0)).toBeUndefined();
  });

  it('`confirmQiji` 返回光标处的 id；空表返回 undefined', () => {
    expect(confirmQiji(FOUR, 1)).toBe('b');
    expect(confirmQiji([], 0)).toBeUndefined();
  });

  it('⚠️ `canConfirm` 在没候选时为假（不能"确认一个不存在的炁机"）', () => {
    expect(canConfirm(FOUR)).toBe(true);
    expect(canConfirm([])).toBe(false);
  });
});

describe('⚠️ 提示行不与卡片重叠（用户报的那个 UI bug，2026-10-13 第三轮）', () => {
  /**
   * 用户原话："底部提示行「选择一个炁机生效（← → · Enter）」与**第二行卡片
   * 的底边轻微重叠**"。
   *
   * ⚠️ 旧版是布局表里一个**手调**的 `hintY: 470`，而卡片块从 `rowTop: 150`
   * 起、每张 `cardH: 172` + `gap: 20` 排下去：
   *
   * ```
   *   第一行 150 .. 322
   *   第二行 342 .. 514      ← 470 正落在第二行卡片**里面**
   * ```
   *
   * 现在 `qijiHintY()` 从"排满时的卡片块底边"算出来，这一份测试钉住
   * "排满也不重叠、也不出画布"。
   */
  const BOX = (size: number) => Math.ceil(size * 1.3);

  it('【关键】提示行的**字框顶端**在排满卡片的**底边之下**（有余量）', () => {
    const rows = qijiRows(QIJI_SELECT_SLOTS, QIJI_SELECT_LAYOUT).length;
    const blockBottom =
      QIJI_SELECT_LAYOUT.rowTop +
      rows * QIJI_SELECT_LAYOUT.cardH +
      (rows - 1) * QIJI_SELECT_LAYOUT.gap;
    const hintY = qijiHintY(QIJI_SELECT_LAYOUT);
    /**
     * 提示行是 `FONT.small`(13) 且 `anchorY 0.5` —— 字框是
     * `hintY ± ceil(13 × 1.3)/2 = ±9`（与 `prepareLayout.test.ts` 同一口径）。
     */
    const half = BOX(13) / 2;
    expect(hintY - half).toBeGreaterThanOrEqual(blockBottom);
    /** 而且是**真的留了呼吸位**（不是"刚好贴住"）。 */
    expect(hintY - half - blockBottom).toBeGreaterThanOrEqual(4);
  });

  it('提示行与卡片块都**在画布内**（540）', () => {
    const hintY = qijiHintY(QIJI_SELECT_LAYOUT);
    expect(hintY + BOX(13) / 2).toBeLessThanOrEqual(540);
    const rows = qijiRows(QIJI_SELECT_SLOTS, QIJI_SELECT_LAYOUT).length;
    const blockBottom =
      QIJI_SELECT_LAYOUT.rowTop +
      rows * QIJI_SELECT_LAYOUT.cardH +
      (rows - 1) * QIJI_SELECT_LAYOUT.gap;
    expect(blockBottom).toBeLessThan(hintY);
  });

  it('候选只有一行时，提示行**不动**（位置由"排满"决定，不跟着张数跳）', () => {
    /** 一行候选的底边比排满时低 —— 提示行仍然在排满时那个位置。 */
    const oneRowBottom =
      QIJI_SELECT_LAYOUT.rowTop + QIJI_SELECT_LAYOUT.cardH;
    const twoRowBottom =
      oneRowBottom + QIJI_SELECT_LAYOUT.gap + QIJI_SELECT_LAYOUT.cardH;
    expect(qijiHintY(QIJI_SELECT_LAYOUT)).toBe(twoRowBottom + QIJI_SELECT_LAYOUT.hintGap);
    /** ⚠️ 一行时提示行在卡片下面**更远**（不会压上去）。 */
    expect(qijiHintY(QIJI_SELECT_LAYOUT)).toBeGreaterThan(oneRowBottom);
  });

  it('命中区与提示行**不相交**（"点卡片"不该点到提示行上，反之亦然）', () => {
    const candidates: readonly QijiCandidate[] = Array.from({ length: QIJI_SELECT_SLOTS }, (_, i) => ({
      qiji: { id: `q${i}`, nameKey: 'k', icon: 'i' } satisfies QijiView,
      remaining: 1,
    }));
    const hintTop = qijiHintY(QIJI_SELECT_LAYOUT) - BOX(13) / 2;
    for (const area of qijiHitAreas(candidates, QIJI_SELECT_LAYOUT)) {
      expect(area.y + area.h).toBeLessThanOrEqual(hintTop);
    }
  });
});
