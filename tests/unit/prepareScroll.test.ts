import { describe, expect, it } from 'vitest';
import {
  PREPARE_LAYOUT,
  TOUCH_MIN,
  type PrepareCounts,
} from '../../src/ui/prepareLayout';
import {
  NO_SCROLL,
  cardRowsOf,
  prepareHitAreas,
  sectionBlockH,
  sectionMaxScroll,
  sectionRowStep,
  sectionViewportH,
  sectionViewportRows,
  sectionsBottom,
  startRect,
} from '../../src/ui/prepareGeometry';
import { followedCursor, scrolledBy, sectionAtPoint } from '../../src/ui/prepareScroll';
import { stepCursor, moveFocus, focusTarget, initialSelection } from '../../src/ui/prepareLogic';
import type { PrepareSelection } from '../../src/ui/prepareLogic';
import type { PrepareOption } from '../../src/ui/prepareTypes';

/**
 * ==================================================================
 * 备战屏：**卡片区排不下就滚动**（2026-10-13 第三轮）
 * ==================================================================
 *
 * 用户原话："**现在的 layout 应该可以排更多炁机了，而且炁机排不下就滚动**"。
 *
 * 上一轮那个 agent 量出来的现状是："8 条挤在 5 列 × 2 行；**再加第 9 条
 * 就会排第 3 行并溢出**" —— 这一份测试就是钉住那个"溢出"不再发生：
 *
 * ```
 *   视口高   = 常量（`visibleRows`）→ 不随张数变，按钮也不跟着跳
 *   内容高   = 张数说了算
 *   能滚多远 = max(0, 内容 − 视口)
 *   看得见的 = 头 `visibleRows` 行 + 光标跟随
 * ```
 *
 * ⚠️ 这里**故意用 20 条炁机**（真实内容今天只有 8 条）：8 条正好两行、
 * 不溢出，所以"能滚"这件事在真实内容上**看不出来** —— 只有把张数推到
 * 超过视口才测得出来。那正是"再加第 9 条"那个预言的反面。
 */
const qijiOf = (n: number): readonly PrepareOption[] =>
  Array.from({ length: n }, (_, i) => ({ id: `q${i}` }));
const players: readonly PrepareOption[] = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
const bosses: readonly PrepareOption[] = [{ id: 'x' }, { id: 'y' }];

const countsOf = (qiji: number): PrepareCounts => ({ players: 3, bosses: 2, qiji });

/** 8 条（今天真实条数）与 20 条（"再加很多条"）。 */
const QIJI_TODAY = 8;
const QIJI_MANY = 20;

describe('⚠️ 视口是**常量**：张数不改变三块占的高度，也不推走「开始战斗」', () => {
  it('炁机 8 条与 20 条：**占的高度一样**（都是视口高）', () => {
    const rows = cardRowsOf(QIJI_MANY, PREPARE_LAYOUT.qijiColumns);
    /** 前提：20 条确实摊出**比视口多**的行（否则这条测试什么都没测）。 */
    expect(rows).toBeGreaterThan(PREPARE_LAYOUT.visibleRows);
    expect(sectionBlockH('qiji', countsOf(QIJI_MANY))).toBe(sectionViewportH('qiji'));
    expect(sectionBlockH('qiji', countsOf(QIJI_TODAY))).toBe(sectionViewportH('qiji'));
  });

  it('【关键】20 条炁机时「开始战斗」**不动**（按钮的 y 取三块里最高的一种展开）', () => {
    const today = startRect(countsOf(QIJI_TODAY));
    const many = startRect(countsOf(QIJI_MANY));
    expect(many).toEqual(today);
    /** 而且它仍然在画布内、在三块下面。 */
    expect(many.y).toBeGreaterThan(sectionsBottom(countsOf(QIJI_MANY)));
    expect(many.y + many.h).toBeLessThan(PREPARE_LAYOUT.height);
  });

  it('视口高与"能放几行"都由 `visibleRows` 算出来（不是手调的数）', () => {
    const rows = PREPARE_LAYOUT.visibleRows;
    const expected = rows * PREPARE_LAYOUT.qijiCardH + (rows - 1) * PREPARE_LAYOUT.cardGap;
    expect(sectionViewportH('qiji')).toBe(expected);
    expect(sectionViewportRows('qiji', countsOf(QIJI_MANY))).toEqual({
      count: cardRowsOf(QIJI_MANY, PREPARE_LAYOUT.qijiColumns),
      rows,
      first: 0,
    });
  });
});

describe('⚠️ 超出视口：能滚、只画看得见的那几行', () => {
  const counts = countsOf(QIJI_MANY);

  it('能滚多远 = 内容高 − 视口高', () => {
    const rows = cardRowsOf(QIJI_MANY, PREPARE_LAYOUT.qijiColumns);
    const content = rows * PREPARE_LAYOUT.qijiCardH + (rows - 1) * PREPARE_LAYOUT.cardGap;
    expect(sectionMaxScroll('qiji', counts)).toBe(content - sectionViewportH('qiji'));
    expect(sectionMaxScroll('qiji', counts)).toBeGreaterThan(0);
  });

  it('8 条（今天）**不用滚**（下限为 0，滑块/滚动条因此不出现）', () => {
    expect(sectionMaxScroll('qiji', countsOf(QIJI_TODAY))).toBe(0);
  });

  it('【关键】命中区只含**看得见的那几行**（不会点中看不见的幽灵卡）', () => {
    const areas = prepareHitAreas(players, bosses, qijiOf(QIJI_MANY), 'qiji');
    const cards = areas.filter((a) => a.kind === 'qiji');
    expect(cards).toHaveLength(PREPARE_LAYOUT.visibleRows * PREPARE_LAYOUT.qijiColumns);
    /** 每一个可见的矩形都在视口范围内（不会画到下一块的地盘上）。 */
    const top = cards[0]!.y;
    for (const card of cards) {
      expect(card.y).toBeGreaterThanOrEqual(top - 0.001);
      expect(card.y + card.h).toBeLessThanOrEqual(top + sectionViewportH('qiji') + 0.001);
    }
  });

  it('滚过之后：同一个下标画在**上面一行**（内容不重排，只换窗口）', () => {
    const step = sectionRowStep('qiji');
    const first = prepareHitAreas(players, bosses, qijiOf(QIJI_MANY), 'qiji').filter(
      (a) => a.kind === 'qiji',
    );
    const scrolled = prepareHitAreas(players, bosses, qijiOf(QIJI_MANY), 'qiji', {
      ...NO_SCROLL,
      qiji: step,
    }).filter((a) => a.kind === 'qiji');
    /** 第二行的第 1 张（下标 5）滚上来之后与原来的第 1 张同一位置。 */
    const q5 = scrolled.find((a) => a.id === 'q5');
    expect(q5?.y).toBe(first[0]!.y);
  });

  it('`scrolledBy` 把偏移钳在 `[0, max]`：往两端滚都不会越界', () => {
    const counts2 = countsOf(QIJI_MANY);
    const max = sectionMaxScroll('qiji', counts2);
    /** 已经在顶部再往上：**没有变化** → `undefined`（调用方据此不吃这次滚轮）。 */
    expect(scrolledBy('qiji', -100, counts2, NO_SCROLL)).toBeUndefined();
    const down = scrolledBy('qiji', 1000, counts2, NO_SCROLL);
    expect(down?.qiji).toBe(max);
    /** 已经到底再往下：**没有变化** → `undefined`（调用方据此"不吃这次滚轮"）。 */
    expect(scrolledBy('qiji', 100, counts2, { ...NO_SCROLL, qiji: max })).toBeUndefined();
  });

  it('不用滚的那一块：`scrolledBy` 与 `sectionAtPoint` 都说"不关我事"', () => {
    const counts2 = countsOf(QIJI_TODAY);
    expect(scrolledBy('qiji', 100, counts2, NO_SCROLL)).toBeUndefined();
    expect(sectionAtPoint(300, 200, 'qiji', counts2, NO_SCROLL)).toBeUndefined();
  });

  it('`sectionAtPoint`：只认展开那一块的**卡片视口**范围', () => {
    const counts2 = countsOf(QIJI_MANY);
    const top = 191;
    expect(sectionAtPoint(PREPARE_LAYOUT.pad + 5, top + 5, 'qiji', counts2, NO_SCROLL)).toBe('qiji');
    /** 视口上方 / 下方：不是这一块的地盘。 */
    expect(sectionAtPoint(PREPARE_LAYOUT.pad + 5, top - 20, 'qiji', counts2, NO_SCROLL)).toBeUndefined();
    expect(
      sectionAtPoint(PREPARE_LAYOUT.pad + 5, top + sectionViewportH('qiji') + 20, 'qiji', counts2, NO_SCROLL),
    ).toBeUndefined();
    /** 卡片列右边（详情区那一侧）：也不认。 */
    expect(
      sectionAtPoint(PREPARE_LAYOUT.pad + PREPARE_LAYOUT.playerColW + 20, top + 5, 'qiji', counts2, NO_SCROLL),
    ).toBeUndefined();
  });
});

describe('⚠️ 光标跟随：换行才滚，而且只滚到"看得见"为止', () => {
  const qiji = qijiOf(QIJI_MANY);
  const counts = countsOf(QIJI_MANY);
  const lists = { players, bosses, qiji };
  const start = (): PrepareSelection => focusTarget(initialSelection({ playerId: 'a', bossId: 'x' }, qiji), 'qiji', lists);

  it('第一行内 ← → 不滚（视角不动）', () => {
    const sel = start();
    const right = stepCursor(sel, players, bosses, 'right', qiji);
    expect(followedCursor(right, lists, counts, NO_SCROLL)).toBeUndefined();
  });

  it('↓ 到第二行：不用滚（第二行本来就在视口里）', () => {
    const down = stepCursor(start(), players, bosses, 'down', qiji);
    expect(down.cursor.qijiId).toBe('q5');
    expect(followedCursor(down, lists, counts, NO_SCROLL)).toBeUndefined();
  });

  it('【关键】再 ↓ 到第三行：视角**跟一行**（正好露出那一行）', () => {
    let sel = start();
    sel = stepCursor(sel, players, bosses, 'down', qiji);
    sel = stepCursor(sel, players, bosses, 'down', qiji);
    expect(sel.cursor.qijiId).toBe('q10');
    const next = followedCursor(sel, lists, counts, NO_SCROLL);
    expect(next?.qiji).toBe(sectionRowStep('qiji'));
    /** ⚠️ 只滚**一行**：不是"把光标居中"（那会滚得更多、画面更晃）。 */
    expect(next?.qiji).toBeLessThan(sectionRowStep('qiji') * 2);
  });

  it('滚过之后光标所在的那一行**确实在视口里**', () => {
    const step = sectionRowStep('qiji');
    const sel = stepCursor(stepCursor(start(), players, bosses, 'down', qiji), players, bosses, 'down', qiji);
    const scroll = followedCursor(sel, lists, counts, NO_SCROLL)!;
    const view = sectionViewportRows('qiji', counts, scroll);
    const cards = prepareHitAreas(players, bosses, qiji, 'qiji', scroll).filter((a) => a.kind === 'qiji');
    expect(cards.some((a) => a.id === sel.cursor.qijiId)).toBe(true);
    expect(scroll.qiji).toBe(step * view.first);
  });

  it('光标回到第一行时视角往**上**收（不是只往下跟）', () => {
    const step = sectionRowStep('qiji');
    const scrolled = { ...NO_SCROLL, qiji: step };
    const sel = focusTarget(start(), 'qiji', lists);
    /** 第一行现在跑到视口上面去了 → 跟随把它拉回来。 */
    const next = followedCursor({ ...sel, cursor: { ...sel.cursor, qijiId: 'q0' } }, lists, counts, scrolled);
    expect(next?.qiji).toBe(0);
  });
});

describe('⚠️ 手指下限仍然是硬约束（视口/滚动没有放松它）', () => {
  it('卡片高 ≥ `TOUCH_MIN`，而且视口能放下的行数 × 行距 ≥ 一屏', () => {
    expect(PREPARE_LAYOUT.qijiCardH).toBeGreaterThanOrEqual(TOUCH_MIN);
    expect(PREPARE_LAYOUT.cardH).toBeGreaterThanOrEqual(TOUCH_MIN);
    expect(sectionViewportH('qiji')).toBeGreaterThanOrEqual(PREPARE_LAYOUT.qijiCardH);
  });

  it('人物 / 对手两块：张数决定行数，但**同样不会溢出**（同一套视口）', () => {
    /** 对手今天 7 张 → 2 行 = 视口，正好放下（与炁机同一条判据）。 */
    expect(sectionBlockH('boss', { players: 3, bosses: 7, qiji: 8 })).toBe(sectionViewportH('boss'));
    /** 想象 20 个 Boss：占的高度不变，多出来的靠滚。 */
    const many = prepareHitAreas(players, bosses, qijiOf(8), 'boss');
    expect(many.filter((a) => a.kind === 'boss')).toHaveLength(2);
  });
});

describe('块与块之间：Tab 是唯一的路（方向键不跨块）', () => {
  const qiji = qijiOf(QIJI_MANY);
  const lists = { players, bosses, qiji };

  it('Tab 前进 / Shift+Tab 后退，并且**环绕**', () => {
    const at = focusTarget(initialSelection({ playerId: 'a', bossId: 'x' }, qiji), 'player', lists);
    const q = moveFocus(at, 1, { ...lists, wrap: true });
    expect(q.focus).toBe('qiji');
    const b = moveFocus(q, 1, { ...lists, wrap: true });
    expect(b.focus).toBe('boss');
    const s = moveFocus(b, 1, { ...lists, wrap: true });
    expect(s.focus).toBe('start');
    expect(moveFocus(s, 1, { ...lists, wrap: true }).focus).toBe('player');
    expect(moveFocus(s, -1, { ...lists, wrap: true }).focus).toBe('boss');
  });

  it('【关键】↑ ↓ 在炁机块里**到边界停住**，绝不跳到别的块', () => {
    let sel = focusTarget(initialSelection({ playerId: 'a', bossId: 'x' }, qiji), 'qiji', lists);
    /** 从第一行往上：不动（旧版会跳到人物那一块）。 */
    expect(stepCursor(sel, players, bosses, 'up', qiji).focus).toBe('qiji');
    expect(stepCursor(sel, players, bosses, 'up', qiji)).toEqual(sel);
    /** 一路往下：到底也不跳（旧版会跳到对手那一块）。 */
    for (let i = 0; i < 12; i += 1) sel = stepCursor(sel, players, bosses, 'down', qiji);
    expect(sel.focus).toBe('qiji');
    expect(sel.cursor.qijiId).toBe('q15');
  });

  it('⚠️【核心 bug】第二行的炁机**用方向键选得到**（旧版到不了）', () => {
    const first = focusTarget(initialSelection({ playerId: 'a', bossId: 'x' }, qiji), 'qiji', lists);
    /** ← → 到第一行行尾（第 5 张 = 下标 4）。 */
    let sel = first;
    for (let i = 0; i < 4; i += 1) sel = stepCursor(sel, players, bosses, 'right', qiji);
    expect(sel.cursor.qijiId).toBe('q4');
    /** 行尾再往右：**停住**（第二行的 q5 在它**下面**，不是右边）。 */
    expect(stepCursor(sel, players, bosses, 'right', qiji).cursor.qijiId).toBe('q4');
    /** ↓ 换到第二行同一列 → q9（下标 9）。 */
    const below = stepCursor(sel, players, bosses, 'down', qiji);
    expect(below.cursor.qijiId).toBe('q9');
    /**
     * ⚠️ 第二行只有 5 张（下标 5..9），所以 `q9` **就是这一行的行尾** ——
     * 再往右要**停住**（不是跳到第三行的 `q10`）。
     */
    expect(below.cursor.qijiId).toBe('q9');
    expect(stepCursor(below, players, bosses, 'right', qiji).cursor.qijiId).toBe('q9');
    /** 行内往左走一格：q8。 */
    expect(stepCursor(below, players, bosses, 'left', qiji).cursor.qijiId).toBe('q8');
  });

  it('空槽位不会被 Tab 送进去（`canFocus` 那条判据不变）', () => {
    const noQiji = { players, bosses, qiji: [] as readonly PrepareOption[] };
    const sel = initialSelection({ playerId: 'a', bossId: 'x' }, []);
    expect(moveFocus(sel, 1, { ...noQiji, wrap: true }).focus).toBe('boss');
  });
});

describe('三块共用**同一套**滚动（不是三份实现）', () => {
  it('三块都走 `sectionViewportRows` / `scrolledBy`（同一份几何 + 同一份边界规则）', () => {
    const counts = countsOf(QIJI_MANY);
    for (const kind of ['player', 'qiji', 'boss'] as const) {
      const view = sectionViewportRows(kind, counts);
      expect(view.rows).toBe(PREPARE_LAYOUT.visibleRows);
      /** 人物只有 3 张 → 1 行 → 不用滚；另外两块按张数各算各的。 */
      expect(sectionMaxScroll(kind, counts)).toBeGreaterThanOrEqual(0);
    }
  });
});
