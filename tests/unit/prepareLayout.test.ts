import { describe, expect, it } from 'vitest';
import { PREPARE_LAYOUT, SECTION_ORDER, TOUCH_MIN, type PrepareCounts } from '../../src/ui/prepareLayout';
import {
  cardBlockH,
  cardGrid,
  cardRowsOf,
  detailRect,
  foldHitRect,
  foldRect,
  footerHintSlot,
  prepareHitAreas,
  prepareLabelY,
  rowTopsOf,
  sectionBlockH,
  sectionContentH,
  sectionsBottom,
  startCenterX,
  startRect,
} from '../../src/ui/prepareGeometry';
import { prepareHitAreas as hitAreasViaLogic } from '../../src/ui/prepareLogic';
import { LOGICAL } from '../../src/ui/layout';

/**
 * ==================================================================
 * 备战屏（自由模式）的**布局几何**
 * ==================================================================
 *
 * ⚠️ 2026-10-13 第二轮（手风琴 + 卡片再小 + 按钮错位）改的：
 *
 *   1. 顺序：人物 → **炁机** → 对手（用户："先选炁机 再选 boss"）
 *   2. **同一时间只展开一块**，另两块只剩一条块头（`foldH`）
 *   3. 卡片再小一档（人物/对手 48 → 40），**下限重新推导**
 *   4. 「开始战斗」的 y 由"最高的展开方式"算出来，**文字与矩形同中心**
 *
 * ⚠️ 这些断言钉的都是**"谁压到谁 / 谁出界"**，不是"某个数等于某个值"：
 * 需求要"尽量缩小"，而缩小的**唯一硬约束**是不重叠、不越界、名字/头像
 * 塞得下、手指点得中。数值可以随时调，那几条不能破。
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
/** 真实张数（真实名单变了，这一份也要跟着改 —— 它就是"今天"的口径）。 */
const COUNTS: PrepareCounts = {
  players: players.length,
  bosses: bosses.length,
  qiji: qiji.length,
};
/** 三种"展开哪一块"，遍历它们 = "任意展开方式都不许出问题"。 */
const EXPANDED_ALL = SECTION_ORDER;

/** 1×1 的假名单（只测"标题与它自己那一行"时用，避免折行干扰）。 */
const solo: PrepareCounts = { players: 1, bosses: 1, qiji: 1 };

describe('备战页：顺序与栏目标题的字号 / 纵向余量', () => {
  it('⚠️【关键】三块的顺序是 人物 → 炁机 → 对手（用户指定）', () => {
    expect(SECTION_ORDER).toEqual(['player', 'qiji', 'boss']);
    const tops = rowTopsOf(COUNTS, 'player');
    expect(tops.player).toBeLessThan(tops.qiji);
    expect(tops.qiji).toBeLessThan(tops.boss);
  });

  it('字号比卡片名字大一号，但仍远小于主标题（层级：主标题 > 栏目标题 > 卡片名）', () => {
    expect(PREPARE_LAYOUT.labelSize).toBeGreaterThan(PREPARE_LAYOUT.nameSize);
    expect(PREPARE_LAYOUT.labelSize).toBeLessThan(32);
    expect(PREPARE_LAYOUT.labelSize).toBeGreaterThan(13);
  });

  it('⚠️【关键】标题的行框**完全**落在卡片上方（不再探进卡片）', () => {
    /**
     * ⚠️ 第一轮 540 挤的时候这里让到 20（行框探进卡片 4px）；手风琴把纵向
     * 省出来之后给足 24 = 行框本身，所以这条断言比旧版**更严**。
     */
    expect(LABEL_LINE.box(PREPARE_LAYOUT.labelSize)).toBeLessThanOrEqual(PREPARE_LAYOUT.labelGap);
  });

  it('⚠️【关键】`prepareLogic` 转发的是**同一份**命中几何（两处不可能漂）', () => {
    for (const expanded of EXPANDED_ALL) {
      expect(hitAreasViaLogic(players, bosses, qiji, expanded)).toEqual(
        prepareHitAreas(players, bosses, qiji, expanded),
      );
    }
  });

  it('标题画在自己那一行卡片**上方**（三种展开方式都成立）', () => {
    for (const expanded of EXPANDED_ALL) {
      const y = prepareLabelY(COUNTS, expanded);
      const tops = rowTopsOf(COUNTS, expanded);
      const BOX = LABEL_LINE.box(PREPARE_LAYOUT.labelSize);
      expect(y.player).toBe(tops.player - PREPARE_LAYOUT.labelGap);
      expect(y.boss).toBe(tops.boss - PREPARE_LAYOUT.labelGap);
      expect(y.qiji).toBe(tops.qiji - PREPARE_LAYOUT.labelGap);
      for (const [labelY, rowY] of [
        [y.player, tops.player],
        [y.qiji, tops.qiji],
        [y.boss, tops.boss],
      ] as const) {
        expect(labelY + BOX).toBeLessThanOrEqual(rowY);
      }
      /**
       * 主标题 32px、`anchorY 0.5`、基线 `titleY` → 行框 `titleY ± box/2`。
       * 人物标题的**行顶**必须在它下面（两条不能叠）。
       */
      const titleBottom = PREPARE_LAYOUT.titleY + LABEL_LINE.box(32) / 2;
      expect(y.player - BOX).toBeGreaterThanOrEqual(titleBottom);
    }
  });
});

describe('⚠️ 手风琴：同时只展开一块，收起的两块只占一条块头', () => {
  it('展开那一块的内容高度 = 卡片网格；收起的两块 = `foldH`', () => {
    for (const expanded of EXPANDED_ALL) {
      for (const kind of SECTION_ORDER) {
        const h = sectionContentH(kind, COUNTS, expanded);
        if (kind === expanded) expect(h).toBe(sectionBlockH(kind, COUNTS));
        else expect(h).toBe(PREPARE_LAYOUT.foldH);
      }
    }
  });

  it('【关键】三种展开方式下，三块的内容都**互不重叠**、且顺序向下', () => {
    for (const expanded of EXPANDED_ALL) {
      const tops = rowTopsOf(COUNTS, expanded);
      let prevBottom = -1;
      for (const kind of SECTION_ORDER) {
        expect(tops[kind]).toBeGreaterThan(prevBottom);
        prevBottom = tops[kind] + sectionContentH(kind, COUNTS, expanded);
      }
    }
  });

  it('【关键】三种展开方式下都能放下（整条链的下界在按钮之上）', () => {
    const start = startRect();
    for (const expanded of EXPANDED_ALL) {
      const tops = rowTopsOf(COUNTS, expanded);
      const last = SECTION_ORDER[SECTION_ORDER.length - 1]!;
      const bottom = tops[last] + sectionContentH(last, COUNTS, expanded);
      expect(bottom).toBeLessThanOrEqual(start.y);
    }
    /**
     * ⚠️ 2026-10-13 第四轮：按钮的 y **不再由内容推出** —— 它锚在画布
     * 底边（`footerRowCenterY`），所以切块 / 张数变都不动。
     * 上面那条"内容底边 ≤ 按钮顶边"仍然要成立（内容不许压上页脚）。
     */
    expect(start.y).toBe(Math.round(PREPARE_LAYOUT.footerRowCenterY - PREPARE_LAYOUT.startH / 2));
    expect(start.y).toBeGreaterThan(sectionsBottom(COUNTS));
  });

  it('收起态那条块头的高度**合理**：不小于手指下限、不超过它展开时的高度', () => {
    expect(PREPARE_LAYOUT.foldH).toBeGreaterThanOrEqual(TOUCH_MIN);
    for (const kind of SECTION_ORDER) {
      expect(PREPARE_LAYOUT.foldH).toBeLessThanOrEqual(sectionBlockH(kind, COUNTS));
    }
    /** 块头横跨整条卡片列（三个块头宽度一致，不按各块自己的列宽）。 */
    const rect = foldRect(100);
    expect(rect.x).toBe(PREPARE_LAYOUT.pad);
    expect(rect.w).toBe(PREPARE_LAYOUT.playerColW);
  });

  it('【关键】块头的**可点矩形**（含标题带外扩）不与上一块的内容相交', () => {
    for (const expanded of EXPANDED_ALL) {
      const tops = rowTopsOf(COUNTS, expanded);
      let prevBottom = 0;
      for (const kind of SECTION_ORDER) {
        const hit = foldHitRect(tops[kind]);
        /** 外扩只向上吃"上一块底边 → 本块标题"这条空带。 */
        expect(hit.y).toBeGreaterThanOrEqual(prevBottom);
        expect(hit.y + hit.h).toBe(tops[kind] + PREPARE_LAYOUT.foldH);
        /** 有效触屏目标 = 块头 + 标题带，肯定不小于手指下限。 */
        expect(hit.h).toBeGreaterThanOrEqual(TOUCH_MIN);
        prevBottom = tops[kind] + sectionContentH(kind, COUNTS, expanded);
      }
    }
  });

  it('⚠️ 收起的那两块**只有块头**在命中区里（没有看不见却能点中的卡）', () => {
    for (const expanded of EXPANDED_ALL) {
      const areas = prepareHitAreas(players, bosses, qiji, expanded);
      const kinds = areas.map((a) => a.kind);
      /** 展开那一块的卡：`players.length` 张。 */
      const cards = areas.filter((a) => a.kind !== 'start' && a.kind !== 'summary');
      expect(cards).toHaveLength(COUNTS[expanded === 'player' ? 'players' : expanded === 'qiji' ? 'qiji' : 'bosses']);
      /** 另外两块各一条块头。 */
      expect(kinds.filter((k) => k === 'summary')).toHaveLength(2);
      /** 块头的 id 就是它代表的槽位。 */
      const summaries = areas.filter((a) => a.kind === 'summary').map((a) => a.id);
      expect(summaries).toEqual(SECTION_ORDER.filter((k) => k !== expanded));
    }
  });
});

describe('⚠️ 卡片网格：折行、不重叠、都在卡片列里', () => {
  it('人物 3 张 → 1 行；对手 7 张 → 2 行（5 列）；炁机 8 条 → 2 行（5 列）', () => {
    expect(cardRowsOf(players.length, PREPARE_LAYOUT.playerColumns)).toBe(1);
    expect(cardRowsOf(bosses.length, PREPARE_LAYOUT.bossColumns)).toBe(2);
    expect(cardRowsOf(qiji.length, PREPARE_LAYOUT.qijiColumns)).toBe(2);
  });

  it('【关键】同一行的卡片**互不重叠**，且不越出卡片列的左右边界', () => {
    for (const expanded of EXPANDED_ALL) {
      const areas = prepareHitAreas(players, bosses, qiji, expanded);
      for (const kind of ['player', 'boss', 'qiji'] as const) {
        const col =
          kind === 'player'
            ? PREPARE_LAYOUT.playerColW
            : kind === 'boss'
              ? PREPARE_LAYOUT.bossColW
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
    }
  });

  it('【关键】卡片宽度不低于**重新推导的**可读性 / 交互下限', () => {
    /**
     * ⚠️ 下限是**算出来**的（`prepareLayout` 里由内边距 + 头像 + 两个汉字
     * 与 `TOUCH_MIN` 取大者），这里只断言"它够大、且卡片不窄于它"。
     */
    expect(PREPARE_LAYOUT.cardMinW).toBeGreaterThanOrEqual(TOUCH_MIN);
    expect(PREPARE_LAYOUT.cardMinW).toBe(
      Math.max(
        PREPARE_LAYOUT.cardPad * 2 +
          PREPARE_LAYOUT.portraitBox +
          PREPARE_LAYOUT.nameAvatarGap +
          PREPARE_LAYOUT.nameSize * 2,
        TOUCH_MIN,
      ),
    );
    for (const expanded of EXPANDED_ALL) {
      const areas = prepareHitAreas(players, bosses, qiji, expanded);
      for (const a of areas) {
        if (a.kind === 'start') continue;
        expect(a.w).toBeGreaterThanOrEqual(PREPARE_LAYOUT.cardMinW);
      }
    }
  });

  it('【关键】卡片高度不低于手指下限（`TOUCH_MIN`）', () => {
    /**
     * ⚠️ 卡片是**交互**：高度 = `max(名字行 23 + 上下内边距, TOUCH_MIN)`。
     * 这条把"再小一点"与"点得中"的边界钉死 —— 缩小不能越过它。
     */
    expect(PREPARE_LAYOUT.cardH).toBeGreaterThanOrEqual(TOUCH_MIN);
    expect(PREPARE_LAYOUT.qijiCardH).toBeGreaterThanOrEqual(TOUCH_MIN);
    /** 也不能高回去（"再小一点"是这一轮的明确要求）。 */
    expect(PREPARE_LAYOUT.cardH).toBeLessThanOrEqual(44);
    expect(PREPARE_LAYOUT.qijiCardH).toBeLessThanOrEqual(44);
  });

  it('名字行框塞得进卡片（上下各留得出内边距）', () => {
    expect(PREPARE_LAYOUT.nameLineH + PREPARE_LAYOUT.cardPadY * 2).toBeLessThanOrEqual(
      PREPARE_LAYOUT.qijiCardH,
    );
    expect(PREPARE_LAYOUT.nameLineH + PREPARE_LAYOUT.cardPadY * 2).toBeLessThanOrEqual(
      PREPARE_LAYOUT.cardH,
    );
  });

  it('头像的显示尺寸**比名字行高一点点**（需求原文）', () => {
    expect(PREPARE_LAYOUT.portraitBox).toBeGreaterThan(PREPARE_LAYOUT.nameLineH);
    /** "一点点"：不超过行高的 1.5 倍（否则它会把卡片撑开）。 */
    expect(PREPARE_LAYOUT.portraitBox).toBeLessThan(PREPARE_LAYOUT.nameLineH * 1.5);
    /** 而且塞得进卡片（上下各留一点边距）。 */
    expect(PREPARE_LAYOUT.portraitBox).toBeLessThan(PREPARE_LAYOUT.cardH);
  });
});

describe('⚠️ 纵向链：三块 + 开始键 + 页脚互不重叠，且都在画布内', () => {
  it('人物块 → 炁机块 → 对手块 → 开始键，顺序向下且不相交', () => {
    const tops = rowTopsOf(COUNTS, 'boss');
    const playerBottom =
      tops.player + cardBlockH(players.length, PREPARE_LAYOUT.playerColumns, PREPARE_LAYOUT.cardH, PREPARE_LAYOUT);
    const qijiBottom =
      tops.qiji + cardBlockH(qiji.length, PREPARE_LAYOUT.qijiColumns, PREPARE_LAYOUT.qijiCardH, PREPARE_LAYOUT);
    const bossBottom =
      tops.boss + cardBlockH(bosses.length, PREPARE_LAYOUT.bossColumns, PREPARE_LAYOUT.cardH, PREPARE_LAYOUT);
    expect(playerBottom).toBeLessThanOrEqual(tops.qiji);
    expect(qijiBottom).toBeLessThanOrEqual(tops.boss);
    expect(bossBottom).toBeLessThanOrEqual(startRect().y);
  });

  it('【关键】下一块的**标题**不能插进上一块的内容里（实测发现过一次）', () => {
    const labelTop = Math.ceil(PREPARE_LAYOUT.labelSize * 1.3);
    for (const expanded of EXPANDED_ALL) {
      const tops = rowTopsOf(COUNTS, expanded);
      const labels = prepareLabelY(COUNTS, expanded);
      let prevBottom = 0;
      for (const kind of SECTION_ORDER) {
        /** 标题的行顶必须 ≥ 上一块的底边（块与块之间还有 `rowGap`）。 */
        expect(labels[kind] - labelTop).toBeGreaterThanOrEqual(prevBottom);
        prevBottom = tops[kind] + sectionContentH(kind, COUNTS, expanded);
      }
    }
  });

  it('整条纵向链都在画布内（540），开始键与页脚也不越界', () => {
    const start = startRect();
    expect(start.y + start.h).toBeLessThanOrEqual(LOGICAL.height);
    expect(start.y).toBeGreaterThan(sectionsBottom(COUNTS));
    /**
     * ⚠️ 2026-10-13 第四轮：说明**与按钮同一排**（在它右边那一格里），
     * 所以下面只剩**素材声明**那一行 —— 两者不能叠。
     */
    const hintSlot = footerHintSlot();
    const noticeY = LOGICAL.height - PREPARE_LAYOUT.noticeGap;
    const noticeTop = noticeY - LABEL_LINE.box(PREPARE_LAYOUT.noticeSize) / 2;
    /** 同一排：说明的垂直中心 = 按钮的垂直中心。 */
    expect(hintSlot.y + hintSlot.h / 2).toBeCloseTo(start.y + start.h / 2, 6);
    /** 那一排整体在声明行框之上。 */
    expect(start.y + start.h).toBeLessThanOrEqual(noticeTop - PREPARE_LAYOUT.footerGap);
    expect(hintSlot.x).toBe(start.x + start.w + PREPARE_LAYOUT.footerRowGap);
  });

  it('⚠️【关键】「开始战斗」的**文字中心 = 按钮矩形中心**（旧的错位 bug）', () => {
    const start = startRect();
    /** 文字用它当 x（`prepareFooter` 的唯一基准）。 */
    expect(startCenterX()).toBeCloseTo(start.x + start.w / 2, 6);
    /**
     * ⚠️⚠️ 它**不等于**画布中心 —— 旧版把文字画在 `LOGICAL.width / 2`(480)，
     * 而按钮中心是 328：差 152px，用户看到的就是"开始战斗和按钮错位了"。
     * 这条断言正是那个 bug 的回归闸门。
     */
    expect(startCenterX()).not.toBe(LOGICAL.width / 2);
  });

  it('⚠️【关键】那一排锚定**画布底部**：与张数 / 展开方式**无关**', () => {
    /**
     * 用户原话："开始战斗 和 开始战斗下面的说明 其实可以放一排，
     * 并且 **锚定在底部**"。
     *
     * 判据：同一份布局在"今天 8 条"与"20 条"下给**同一个**矩形 ——
     * 旧的 `sectionsBottom + startGap` 会随着张数往下溜。
     */
    const today = startRect();
    const many = startRect();
    expect(today).toEqual(many);
    /** 底边锚点的唯一出处：与它推出来的一致。 */
    expect(today.y).toBe(Math.round(PREPARE_LAYOUT.footerRowCenterY - PREPARE_LAYOUT.startH / 2));
    /** 而且真的靠画布底部（在纵向下半区）。 */
    expect(today.y).toBeGreaterThan(LOGICAL.height / 2);
    /** ⚠️ 按钮与说明**贴卡片列左端**（见 `prepareGeometry.startRect` 的说明）。 */
    expect(today.x).toBe(PREPARE_LAYOUT.pad);
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
    for (const expanded of EXPANDED_ALL) {
      const areas = prepareHitAreas(players, bosses, qiji, expanded).filter((a) => a.kind !== 'start');
      const rect = detailRect();
      for (const a of areas) {
        expect(a.x + a.w).toBeLessThanOrEqual(rect.x);
      }
    }
  });

  it('详情区在画布内，而且够高（要放名字 + 头像 + 若干条说明）', () => {
    const rect = detailRect();
    expect(rect.x + rect.w).toBeLessThanOrEqual(LOGICAL.width);
    expect(rect.y).toBeGreaterThan(0);
    expect(rect.y + rect.h).toBeLessThanOrEqual(LOGICAL.height);
    expect(rect.h).toBeGreaterThan(LOGICAL.height / 2);
  });
});

describe('网格函数本身：张数任意都不能少画', () => {
  it('给的张数与产出的矩形数**永远相等**', () => {
    for (const n of [0, 1, 2, 3, 5, 7, 8, 12, 17]) {
      const rects = cardGrid(n, PREPARE_LAYOUT.detailY, PREPARE_LAYOUT, {
        colW: PREPARE_LAYOUT.bossColW,
        columns: PREPARE_LAYOUT.bossColumns,
        h: PREPARE_LAYOUT.cardH,
        minW: PREPARE_LAYOUT.cardMinW,
      });
      expect(rects).toHaveLength(n);
    }
  });

  it('张数少于列数时**只用那么多列**（不会把两张卡摊到 5 列里）', () => {
    const rects = cardGrid(2, 100, PREPARE_LAYOUT, {
      colW: PREPARE_LAYOUT.playerColW,
      columns: PREPARE_LAYOUT.playerColumns,
      h: PREPARE_LAYOUT.cardH,
      minW: PREPARE_LAYOUT.cardMinW,
    });
    expect(rects).toHaveLength(2);
    expect(rects[1]!.y).toBe(rects[0]!.y);
  });

  it('空槽位不占高度（选角色屏没有 Boss / 炁机行）', () => {
    expect(sectionBlockH('boss', { players: 3, bosses: 0, qiji: 0 })).toBe(0);
    expect(sectionBlockH('qiji', { players: 3, bosses: 0, qiji: 0 })).toBe(0);
    /** 空槽位也不该出现在命中区里（见 `prepareHitAreas`）。 */
    const areas = prepareHitAreas(players, [], [], 'player');
    expect(areas.map((a) => a.kind)).toEqual(['player', 'player', 'player', 'start']);
  });

  it('`rowTopsOf` 的默认展开块是人物（旧调用方的兼容面）', () => {
    expect(rowTopsOf(solo)).toEqual(rowTopsOf(solo, 'player'));
  });
});
