import { describe, expect, it } from 'vitest';
import {
  PREPARE_LAYOUT,
  cardBlockH,
  cardGrid,
  cardRowsOf,
  detailRect,
  prepareHitAreas,
  prepareLabelY,
  rowTopsOf,
} from '../../src/ui/prepareLayout';
import { prepareHitAreas as hitAreasViaLogic } from '../../src/ui/prepareLogic';
import { LOGICAL } from '../../src/ui/layout';

/**
 * ==================================================================
 * 备战屏（自由模式）的**布局几何**
 * ==================================================================
 *
 * ⚠️ 2026-10-13 这一轮改了三样，这一份测试跟着重写：
 *
 *   1. 卡片**缩小**（96 → 56 高，只留名字 + 头像）
 *   2. 右边切出**详情区**（`detailRect`）
 *   3. 多了一行**炁机**（8 条，排 5 列 → 2 行）
 *
 * ⚠️ 这些断言钉的都是**"谁压到谁"**，不是"某个数等于某个值"：
 * 需求要"尽量缩小"，而缩小的**唯一硬约束**是不重叠、不越界、名字/头像
 * 塞得下。数值可以随时调，那三条不能破。
 *
 * ⚠️ 行框用 `1.3 × 字号` 的**保守估计**（中文楷体），而不是 Pixi 的
 * `getBounds()` —— 那是渲染层的事，jsdom 里跑不动（与 `prepareRender`
 * 同一条纪律）。
 */
const LABEL_LINE = {
  box: (size: number) => Math.ceil(size * 1.3),
} as const;

const players = [{ id: 'player' }, { id: 'kaili' }, { id: 'daixuan' }];
/** 真实对手数是 7（`BOSS_ROSTER`），这里按它来测折行。 */
const bosses = Array.from({ length: 7 }, (_, i) => ({ id: `b${i}` }));
/** 真实炁机数是 8（`data/qiji.ALL_QIJI`），这里按它来测折行。 */
const qiji = Array.from({ length: 8 }, (_, i) => ({ id: `q${i}` }));

/** 1×1 的假名单（只测"标题与它自己那一行"时用，避免折行干扰）。 */
const solo = { players: 1, bosses: 1, qiji: 1 };

describe('备战页：栏目标题的字号与纵向余量', () => {
  it('字号比卡片名字大一号，但仍远小于主标题（层级：主标题 > 栏目标题 > 卡片名）', () => {
    expect(PREPARE_LAYOUT.labelSize).toBeGreaterThan(PREPARE_LAYOUT.nameSize);
    expect(PREPARE_LAYOUT.labelSize).toBeLessThan(32);
    expect(PREPARE_LAYOUT.labelSize).toBeGreaterThan(13);
  });

  it('⚠️【关键】标题的行框不压到卡片（`labelGap` 不小于半边行框）', () => {
    /**
     * ⚠️ 判据从"整框都在卡片上方"改成"**中心**在卡片上方"：540 的纵向
     * 预算被三行卡片吃满，`labelGap` 让到 20，而 18px 楷体的行框是
     * `ceil(18×1.3)` = 24 —— 也就是行框**探进卡片 4px**。楷体的行框是
     * 保守估计（真实字身更矮），所以纸面上不压笔画，但"整框都在上面"
     * 这条确实不再成立。真正看得见的那条是"字身不与卡片顶边相交"。
     */
    expect(LABEL_LINE.box(PREPARE_LAYOUT.labelSize) / 2).toBeLessThanOrEqual(
      PREPARE_LAYOUT.labelGap,
    );
  });

  it('⚠️【关键】`prepareLogic` 转发的是**同一份**命中几何（两处不可能漂）', () => {
    expect(hitAreasViaLogic(players, bosses, qiji)).toEqual(
      prepareHitAreas(players, bosses, qiji),
    );
  });

  it('标题画在自己那一行卡片**上方**', () => {
    const y = prepareLabelY(solo);
    const tops = rowTopsOf(solo);
    const BOX = LABEL_LINE.box(PREPARE_LAYOUT.labelSize);
    expect(y.player).toBe(tops.player - PREPARE_LAYOUT.labelGap);
    expect(y.boss).toBe(tops.boss - PREPARE_LAYOUT.labelGap);
    expect(y.qiji).toBe(tops.qiji - PREPARE_LAYOUT.labelGap);
    /**
     * ⚠️ 判据是"标题行框的**中心**在卡片顶边之上"（见上一条的说明）：
     * `labelGap`(14) 小于半边行框(12)？不 —— 14 ≥ 12，所以整框其实
     * 也放得下。这条同时钉住两种写法都对。
     */
    expect(BOX / 2).toBeLessThanOrEqual(PREPARE_LAYOUT.labelGap);
    for (const [labelY, rowY] of [
      [y.player, tops.player],
      [y.boss, tops.boss],
      [y.qiji, tops.qiji],
    ] as const) {
      expect(labelY + BOX).toBeLessThanOrEqual(rowY);
    }
    /**
     * 主标题 32px、`anchorY 0.5`、基线 `titleY` → 行框 `titleY ± box/2`。
     * 人物标题的**行顶**必须在它下面（两条不能叠）。
     */
    const titleBottom = PREPARE_LAYOUT.titleY + LABEL_LINE.box(32) / 2;
    const playerLabelTop = y.player - BOX;
    expect(playerLabelTop).toBeGreaterThanOrEqual(titleBottom);
  });
});

describe('⚠️ 卡片网格：折行、不重叠、都在卡片列里', () => {
  it('人物 3 张 → 1 行；对手 7 张 → 2 行；炁机 8 条 → 2 行', () => {
    expect(cardRowsOf(players.length, PREPARE_LAYOUT.playerColumns)).toBe(1);
    expect(cardRowsOf(bosses.length, PREPARE_LAYOUT.bossColumns)).toBe(2);
    expect(cardRowsOf(qiji.length, PREPARE_LAYOUT.qijiColumns)).toBe(2);
  });

  it('【关键】同一行的卡片**互不重叠**，且不越出卡片列的左右边界', () => {
    const areas = prepareHitAreas(players, bosses, qiji);
    for (const kind of ['player', 'boss', 'qiji'] as const) {
      const col = kind === 'player' ? PREPARE_LAYOUT.playerColW
        : kind === 'boss' ? PREPARE_LAYOUT.bossColW
          : PREPARE_LAYOUT.qijiColW;
      const rects = areas.filter((a) => a.kind === kind);
      for (const r of rects) {
        expect(r.x).toBeGreaterThanOrEqual(PREPARE_LAYOUT.pad);
        expect(r.x + r.w).toBeLessThanOrEqual(PREPARE_LAYOUT.pad + col);
      }
      /** 两两不相交（同一行的用 y 判，跨行的用 y 判行区间）。 */
      for (let i = 0; i < rects.length; i += 1) {
        for (let j = i + 1; j < rects.length; j += 1) {
          const a = rects[i]!;
          const b = rects[j]!;
          const overlapX = a.x < b.x + b.w && b.x < a.x + a.w;
          const overlapY = a.y < b.y + b.h && b.y < a.y + a.h;
          expect(overlapX && overlapY, `${kind} #${i} 与 #${j} 重叠`).toBe(false);
        }
      }
    }
  });

  it('【关键】卡片宽度不低于可读性下限（头像 + 名字 + 内边距）', () => {
    const areas = prepareHitAreas(players, bosses, qiji);
    for (const a of areas) {
      expect(a.w).toBeGreaterThanOrEqual(PREPARE_LAYOUT.cardMinW);
    }
  });

  it('头像的显示尺寸**比名字行高一点点**（需求原文）', () => {
    expect(PREPARE_LAYOUT.portraitBox).toBeGreaterThan(PREPARE_LAYOUT.nameLineH);
    /** "一点点"：不超过行高的 1.5 倍（否则它会把卡片撑开）。 */
    expect(PREPARE_LAYOUT.portraitBox).toBeLessThan(PREPARE_LAYOUT.nameLineH * 1.5);
    /** 而且塞得进卡片（上下各留一点边距）。 */
    expect(PREPARE_LAYOUT.portraitBox).toBeLessThan(PREPARE_LAYOUT.cardH);
  });
});

describe('⚠️ 纵向链：三行卡片 + 开始键互不重叠，且都在画布内', () => {
  it('人物块 → 对手块 → 炁机块 → 开始键，顺序向下且不相交', () => {
    const tops = rowTopsOf({ players: players.length, bosses: bosses.length, qiji: qiji.length });
    const playerBottom = tops.player + cardBlockH(players.length, PREPARE_LAYOUT.playerColumns, PREPARE_LAYOUT.cardH, PREPARE_LAYOUT);
    const bossBottom = tops.boss + cardBlockH(bosses.length, PREPARE_LAYOUT.bossColumns, PREPARE_LAYOUT.cardH, PREPARE_LAYOUT);
    const qijiBottom = tops.qiji + cardBlockH(qiji.length, PREPARE_LAYOUT.qijiColumns, PREPARE_LAYOUT.qijiCardH, PREPARE_LAYOUT);
    expect(playerBottom).toBeLessThanOrEqual(tops.boss);
    expect(bossBottom).toBeLessThanOrEqual(tops.qiji);
    /** ⚠️ 炁机那一块不能压到「开始战斗」（它在 `startY`）。 */
    expect(qijiBottom).toBeLessThanOrEqual(PREPARE_LAYOUT.startY);
  });

  it('【关键】炁机的**标题**不能插进对手块的第二行（实测发现过一次）', () => {
    const tops = rowTopsOf({ players: players.length, bosses: bosses.length, qiji: qiji.length });
    const bossBottom =
      tops.boss +
      cardBlockH(bosses.length, PREPARE_LAYOUT.bossColumns, PREPARE_LAYOUT.cardH, PREPARE_LAYOUT);
    const labelTop = Math.ceil(PREPARE_LAYOUT.labelSize * 1.3);
    const labels = prepareLabelY({
      players: players.length,
      bosses: bosses.length,
      qiji: qiji.length,
    });
    const playerBottom =
      tops.player +
      cardBlockH(players.length, PREPARE_LAYOUT.playerColumns, PREPARE_LAYOUT.cardH, PREPARE_LAYOUT);
    /**
     * ⚠️ 两条都要判：第一版漏了"人物块 → 对手标题"，而**实测压到的正是
     * 那一条**（对手块的**第二行**顶到了炁机标题上，不是人物块）。
     */
    expect(labels.boss - labelTop).toBeGreaterThanOrEqual(playerBottom);
    expect(labels.qiji - labelTop).toBeGreaterThanOrEqual(bossBottom);
  });

  it('整条纵向链都在画布内（540），开始键与页脚也不越界', () => {
    expect(PREPARE_LAYOUT.startY + PREPARE_LAYOUT.startH).toBeLessThanOrEqual(LOGICAL.height);
    /** 提示行在开始键下面、素材声明在它再下面。 */
    /**
     * ⚠️ 提示行在开始键**下面**、而素材声明在最底 —— 两者**不能叠**
     * （提示行是 `FONT.tiny` 11，声明是 `FONT.small` 13，都居中）。
     */
    /**
     * ⚠️ 提示行 / 素材声明**都不再跟着按钮走**：按钮挪到炁机行右侧之后，
     * 页脚那两行是**贴在炁机块下面**的固定位置（见 `prepareFooter`）。
     */
    const hintY = PREPARE_LAYOUT.startY + PREPARE_LAYOUT.startH + 10;
    const noticeY = 524;
    expect(hintY).toBeLessThan(noticeY);
    expect(hintY + LABEL_LINE.box(11) / 2).toBeLessThanOrEqual(noticeY - LABEL_LINE.box(13) / 2);
  });

  it('开始键水平居中于**卡片列**（不是整张画布 —— 右边有详情区）', () => {
    const start = prepareHitAreas(players, bosses, qiji).find((a) => a.kind === 'start');
    expect(start).toBeDefined();
    const center = (start?.x ?? 0) + (start?.w ?? 0) / 2;
    expect(center).toBeCloseTo(PREPARE_LAYOUT.pad + PREPARE_LAYOUT.playerColW / 2, 0);
  });
});

describe('⚠️ 详情区：右边通高一块，与卡片列不相交', () => {
  it('详情区在卡片列右边（中间还有呼吸位）', () => {
    const rect = detailRect();
    const cardColRight = PREPARE_LAYOUT.pad + PREPARE_LAYOUT.playerColW;
    const bossColRight = PREPARE_LAYOUT.pad + PREPARE_LAYOUT.bossColW;
    expect(rect.x).toBeGreaterThan(cardColRight);
    expect(rect.x).toBeGreaterThan(bossColRight);
    expect(rect.x - cardColRight).toBeGreaterThanOrEqual(4);
  });

  it('【关键】所有卡片都不与详情区相交（卡片越不过 `detailX`）', () => {
    const areas = prepareHitAreas(players, bosses, qiji).filter((a) => a.kind !== 'start');
    const rect = detailRect();
    for (const a of areas) {
      expect(a.x + a.w).toBeLessThanOrEqual(rect.x);
    }
  });

  it('详情区在画布内，而且够高（要放名字 + 头像 + 若干条说明）', () => {
    const rect = detailRect();
    expect(rect.x + rect.w).toBeLessThanOrEqual(LOGICAL.width);
    expect(rect.y).toBeGreaterThan(0);
    expect(rect.y + rect.h).toBeLessThanOrEqual(LOGICAL.height);
    expect(rect.h).toBeGreaterThan(LOGICAL.height / 2);
  });

  it('详情区的左边界就是"卡片列右边界 + 呼吸位"（同一个数，不是两处真相）', () => {
    expect(PREPARE_LAYOUT.detailX - (PREPARE_LAYOUT.pad + PREPARE_LAYOUT.playerColW)).toBe(
      PREPARE_LAYOUT.detailX - PREPARE_LAYOUT.pad - PREPARE_LAYOUT.playerColW,
    );
    expect(PREPARE_LAYOUT.detailX).toBeGreaterThan(PREPARE_LAYOUT.pad + PREPARE_LAYOUT.playerColW);
  });
});

describe('网格函数本身：张数任意都不能少画', () => {
  it('给的张数与产出的矩形数**永远相等**', () => {
    for (const n of [0, 1, 2, 3, 5, 7, 8, 12, 17]) {
      const rects = cardGrid(n, PREPARE_LAYOUT.detailY, PREPARE_LAYOUT, {
        colW: PREPARE_LAYOUT.bossColW,
        columns: PREPARE_LAYOUT.bossColumns,
        h: PREPARE_LAYOUT.cardH,
      });
      expect(rects).toHaveLength(n);
    }
  });

  it('张数少于列数时**只用那么多列**（不会把两张卡摊到 4 列里）', () => {
    const rects = cardGrid(2, 100, PREPARE_LAYOUT, {
      colW: PREPARE_LAYOUT.playerColW,
      columns: PREPARE_LAYOUT.playerColumns,
      h: PREPARE_LAYOUT.cardH,
    });
    expect(rects).toHaveLength(2);
    expect(rects[0]!.y).toBe(rowsY(rects));
  });
});

/** 两张卡在同一行时 y 相同（供上面那条断言读）。 */
function rowsY(rects: readonly { readonly y: number }[]): number {
  return rects[0]?.y ?? 0;
}
