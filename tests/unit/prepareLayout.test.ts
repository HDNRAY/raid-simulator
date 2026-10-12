import { describe, expect, it } from 'vitest';
import { PREPARE_LAYOUT, prepareHitAreas, prepareLabelY } from '../../src/ui/prepareLogic';
import { LOGICAL } from '../../src/ui/layout';

/**
 * ==================================================================
 * 备战页的**栏目标题**（「选择人物」/「选择对手」）与它周围的间距
 * ==================================================================
 *
 * ⚠️ 2026-10-13 用户："选项卡的字体 可以大一点，**特别是移动端**"——
 * "选项卡"指的是这两**栏的标题**（不是设置页的页签，也不是主标题）。
 *
 * 这一屏是**固定 960×540 逻辑画布**，而且**只有一套几何**：桌面与触屏
 * 读的是同一份 `PREPARE_LAYOUT`。所以"特别是移动端"只能靠"两端一起加"
 * 满足 —— 不存在"给触屏再单开一档"的空间（那会造出第二套只按操作方式
 * 分叉的布局，而画布 / 卡片 / 按钮全是共用的）。
 *
 * ⚠️ 标题的字号一变大，**纵向余量**就是唯一会被撞坏的东西：
 *
 * ```
 * 主标题(32, 居中 y54) ─ 人物标题(18) ─ 人物卡 ─ 对手标题(18) ─ 对手卡(7 张) ─ 开始战斗
 * ```
 *
 * 所以这一份钉的是**"谁在谁上面、间距还有多少"**，不是"字号等于某个数"。
 */
const LABEL_LINE = {
  /**
   * 18px **楷体**的行框高（逻辑像素）。
   *
   * ⚠️ 为什么不用 `getBounds()` 实测：那是 Pixi 的事（jsdom 里跑不动，
   * 与 `prepareRender.test.ts` 同一条纪律）。这里用**保守估计**——
   * 中文楷体的行框约为 `1.3 × 字号`，向上取整 —— 只要它 ≤ `labelGap`
   * 就不会压到卡片；真实行框比它小，所以这条断言是**充分**的。
   */
  box: (size: number) => Math.ceil(size * 1.3),
} as const;

describe('备战页：栏目标题的字号与纵向余量', () => {
  it('字号比卡片名字大一号，但仍远小于主标题（层级：主标题 > 栏目标题 > 卡片名）', () => {
    /**
     * 层级判据（不是"越大越好"）：主标题 32（`PrepareScreen` 里写死）>
     * 栏目标题 `labelSize` > 卡片名字（`FONT.title` 17）。
     */
    expect(PREPARE_LAYOUT.labelSize).toBeGreaterThan(17);
    expect(PREPARE_LAYOUT.labelSize).toBeLessThan(32);
    /** ⚠️ 而且确实比改前（`FONT.small` = 13）大。 */
    expect(PREPARE_LAYOUT.labelSize).toBeGreaterThan(13);
  });

  it('⚠️【关键】标题的行框放得进 `labelGap`（放大也不会压到卡片）', () => {
    /**
     * 这条就是"字号能不能再往上调"的**唯一约束**：标题画在
     * `行顶 = playerRowY − labelGap` 处，卡片顶边在 `playerRowY`。
     * 行框一旦超过 `labelGap`，标题下缘就压进卡片 ✗
     */
    expect(LABEL_LINE.box(PREPARE_LAYOUT.labelSize)).toBeLessThanOrEqual(PREPARE_LAYOUT.labelGap);
  });

  it('标题画在自己那一行卡片**上方**，且不压到主标题 / 上一行的卡片', () => {
    const y = prepareLabelY();
    const BOX = LABEL_LINE.box(PREPARE_LAYOUT.labelSize);

    /** 位置来自布局表（不是 `PrepareScreen` 里的 `-22` 字面量）。 */
    expect(y.player).toBe(PREPARE_LAYOUT.playerRowY - PREPARE_LAYOUT.labelGap);
    expect(y.boss).toBe(PREPARE_LAYOUT.bossRowY - PREPARE_LAYOUT.labelGap);

    /** 标题底边 ≤ 它那一行卡片的顶边。 */
    expect(y.player + BOX).toBeLessThanOrEqual(PREPARE_LAYOUT.playerRowY);
    expect(y.boss + BOX).toBeLessThanOrEqual(PREPARE_LAYOUT.bossRowY);

    /** 人物标题的**行顶**在主标题（y 54、32px、anchorY 0.5）下面。 */
    const titleBottom = 54 + LABEL_LINE.box(32) / 2;
    expect(y.player).toBeGreaterThan(titleBottom);
  });

  it('⚠️ Boss 那一栏（7 张卡）被挤下去也**不会顶到「开始战斗」**', () => {
    /**
     * 用户点名过 Boss 有 7 张卡。这一屏的纵向链是
     * `bossRowY .. bossRowY+cardH`，而「开始战斗」在 `startY` ——
     * 两者之间必须还有余量（标题变高**不会**改这两者，这条是护栏：
     * 万一以后有人为了塞标题而把 `bossRowY` 往下挪，这里会先失败）。
     */
    const bosses = Array.from({ length: 7 }, (_, i) => ({ id: `b${i}` }));
    const areas = prepareHitAreas([{ id: 'p' }], bosses);
    const bossArea = areas.find((a) => a.kind === 'boss');
    const startArea = areas.find((a) => a.kind === 'start');
    expect(bossArea).toBeDefined();
    expect(startArea).toBeDefined();
    const bossBottom = bossArea!.y + bossArea!.h;
    expect(bossBottom).toBeLessThanOrEqual(startArea!.y);
  });

  it('整条纵向链都在画布内（540）', () => {
    const startBottom = PREPARE_LAYOUT.startY + PREPARE_LAYOUT.startH;
    expect(startBottom).toBeLessThanOrEqual(LOGICAL.height);
    expect(PREPARE_LAYOUT.bossRowY + PREPARE_LAYOUT.cardH).toBeLessThanOrEqual(LOGICAL.height);
  });
});
