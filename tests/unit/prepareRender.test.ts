import { describe, expect, it } from 'vitest';
import {
  CARD_STROKE,
  CURSOR_RING_GAP,
  PREPARE_SKIN,
  cardSkin,
  centeredTextTopY,
  startSkin,
} from '../../src/ui/prepareRender';
import { PALETTE } from '../../src/render/theme';
import { cardDrawsOf } from '../../src/ui/prepareCardState';
import { prepareHitAreas } from '../../src/ui/prepareGeometry';
import { sectionRowStep } from '../../src/ui/prepareCardGrid';
import type { PrepareSectionKind } from '../../src/ui/prepareTypes';

/**
 * **备战界面的外观规则**（纯函数）。
 *
 * ==================================================================
 * 为什么这些断言值得写
 * ==================================================================
 *
 * 需求（用户）："选中 和 目前光标 目前颜色是一样的" +
 * "用 enter 来确定选择，而不是靠移动到下一项" +
 * "颜色，黄色很奇怪" + "设置按钮 有时也会被变黄"。
 *
 * 四条里有三条是**"什么状态画成什么样"**。这类规则写在 `redraw()` 里
 * 只能靠截图"看一眼觉得对"，而它出错的表现恰恰就是**用户已经抱怨过的
 * 那个样子**（光标和选择同色）—— 没有东西会拦住它。
 *
 * 所以这里把两条最容易回退的性质钉成断言：
 *   1. `cursor` 与 `selected` **是分开的参数**，任何组合都必须给出
 *      **不同的皮肤**（"光标在第 1 张卡、选择在第 3 张卡"要能读出来）
 *   2. 卡片/开始键**不复用 `douqi` 的金色**（那是战斗语义，
 *      也是"设置按钮变黄"的同一个来源）
 */

describe('卡片皮肤：光标与选择必须可分', () => {
  const idle = cardSkin({ developing: false, cursored: false, selected: false });
  const cursored = cardSkin({ developing: false, cursored: true, selected: false });
  const selected = cardSkin({ developing: false, cursored: false, selected: true });
  const both = cardSkin({ developing: false, cursored: true, selected: true });

  it('【关键】"只是光标"与"已选中"的描边**不同色**（这是这次要修的那条）', () => {
    expect(cursored.strokeColor).not.toBe(selected.strokeColor);
  });

  it('【关键】"只是光标"与"已选中"的底色也不同（不能只靠粗细区分）', () => {
    expect(cursored.fillColor).not.toBe(selected.fillColor);
  });

  it('【关键】四种组合两两不同（任何组合都要能读）', () => {
    const keys = [idle, cursored, selected, both].map(
      (s) => `${s.fillColor}/${s.fillAlpha}/${s.strokeColor}/${s.strokeWidth}/${s.ring}`,
    );
    expect(new Set(keys).size).toBe(4);
  });

  it('【关键】光标 + 选择落在同一张卡 → 加外环（否则"光标在哪"看不出来）', () => {
    expect(both.ring).toBe(true);
    expect(both.fillColor).toBe(selected.fillColor);
    expect(both.strokeColor).toBe(selected.strokeColor);
  });

  it('只有其一时**不**加环（环的语义是"金卡上还有一个光标"）', () => {
    expect(cursored.ring).toBe(false);
    expect(selected.ring).toBe(false);
    expect(idle.ring).toBe(false);
  });

  it('光标的线更粗（色相之外的**第二重**区分，灰度下也分得出）', () => {
    expect(CARD_STROKE.cursor).toBeGreaterThan(CARD_STROKE.selected);
    expect(cursored.strokeWidth).toBe(CARD_STROKE.cursor);
    expect(selected.strokeWidth).toBe(CARD_STROKE.selected);
  });

  it('光标色是**冷色**（蓝分量最高），选择色是**暖色**（红分量最高）', () => {
    /**
     * 用通道大小关系而不是写死色值：色值可以调，但"冷 vs 暖"是
     * 这条视觉语言的**约定**，调色时不能改反。
     */
    const blue = (c: number) => (c >> 0) & 0xff;
    const green = (c: number) => (c >> 8) & 0xff;
    const red = (c: number) => (c >> 16) & 0xff;
    expect(blue(PREPARE_SKIN.cursorLine)).toBeGreaterThan(red(PREPARE_SKIN.cursorLine));
    expect(red(PREPARE_SKIN.selectionLine)).toBeGreaterThan(blue(PREPARE_SKIN.selectionLine));
    expect(green(PREPARE_SKIN.selectionLine)).toBeGreaterThan(blue(PREPARE_SKIN.selectionLine));
  });

  it('【关键】不再复用战斗的斗气金（`douqi` 是战斗语义，也是"变黄"的来源）', () => {
    for (const skin of [idle, cursored, selected, both]) {
      expect(skin.strokeColor).not.toBe(PALETTE.douqi.base);
      expect(skin.strokeColor).not.toBe(PALETTE.douqi.bright);
      expect(skin.fillColor).not.toBe(PALETTE.douqi.base);
    }
  });

  it('光标色与设置按钮的焦点色**同一个 token**（全项目只有一种"光标"语言）', () => {
    expect(PREPARE_SKIN.cursorLine).toBe(PALETTE.focus);
  });

  it('开发中的卡片：名字变暗、"不能开战"压过一切装饰', () => {
    const soon = cardSkin({ developing: true, cursored: true, selected: true });
    const plainSoon = cardSkin({ developing: true, cursored: false, selected: false });
    expect(soon.strokeColor).toBe(plainSoon.strokeColor);
    expect(soon.fillAlpha).toBe(plainSoon.fillAlpha);
    expect(soon.nameColor).toBe(PALETTE.textDim);
    /** 光标在那儿也不能把它画得像"可选"：描边既不粗也不亮。 */
    expect(soon.strokeWidth).toBe(plainSoon.strokeWidth);
  });

  it('【关键】光标落在开发中的卡上时**仍然划得出来**（否则方向键看起来坏了）', () => {
    /**
     * 截图实测到的真问题：第一版让"开发中"整张卡连光标环一起压暗，
     * 于是光标移到凯丽（开发中）上时，屏幕上**没有任何变化** ——
     * 玩家会以为方向键没反应。
     *
     * 所以它必须有自己的环，只是颜色更暗（`cursorLineMuted`）：
     * "光标在这儿，但这一格是灰的"。
     */
    const soonCursor = cardSkin({ developing: true, cursored: true, selected: false });
    const normalCursor = cardSkin({ developing: false, cursored: true, selected: false });
    expect(soonCursor.ring).toBe(true);
    expect(soonCursor.ringColor).toBe(PREPARE_SKIN.cursorLineMuted);
    /** 比正常光标暗，但仍明显亮于"没被碰过"的描边。 */
    const lum = (c: number) => {
      const r = (c >> 16) & 0xff;
      const g = (c >> 8) & 0xff;
      const b = c & 0xff;
      return r * 0.299 + g * 0.587 + b * 0.114;
    };
    expect(lum(soonCursor.ringColor)).toBeLessThan(lum(normalCursor.ringColor));
    expect(lum(soonCursor.ringColor)).toBeGreaterThan(lum(soonCursor.strokeColor));
  });

  it('普通卡的名字是正文色（没有"顺手加称号/简介"那类额外标记色）', () => {
    expect(idle.nameColor).toBe(PALETTE.text);
    expect(cursored.nameColor).toBe(PALETTE.text);
  });

  it('被选中的名字用**亮于描边**的金（小字号压在金底上要读得清）', () => {
    const lum = (c: number) => {
      const r = (c >> 16) & 0xff;
      const g = (c >> 8) & 0xff;
      const b = c & 0xff;
      return r * 0.299 + g * 0.587 + b * 0.114;
    };
    expect(lum(selected.nameColor)).toBeGreaterThan(lum(selected.strokeColor));
  });

  it('外环外扩量是正数且很小（不会碰到邻卡：卡片间距 16、左右留白 40）', () => {
    expect(CURSOR_RING_GAP).toBeGreaterThan(0);
    expect(CURSOR_RING_GAP).toBeLessThan(8);
  });
});

describe('开始键皮肤：它没有"选中"态', () => {
  const ready = startSkin({ developing: false, cursored: false });
  const cursored = startSkin({ developing: false, cursored: true });
  const soon = startSkin({ developing: true, cursored: true });

  it('光标停在开始键上 → 换的是**光标色**，不是卡片那种"选中金"', () => {
    expect(cursored.strokeColor).toBe(PREPARE_SKIN.cursorLine);
    expect(cursored.strokeColor).not.toBe(ready.strokeColor);
    expect(cursored.strokeWidth).toBe(CARD_STROKE.cursor);
  });

  it('开发中的单位被选定时：开始键压暗、字变灰（"点开始无效"的可见反馈）', () => {
    expect(soon.labelColor).toBe(PALETTE.textDim);
    expect(soon.fillAlpha).toBeLessThan(ready.fillAlpha);
  });

  it('任何时候都**不**给开始键加环（它不是选项，不存在"光标停在选项上"）', () => {
    expect(ready.ring).toBe(false);
    expect(cursored.ring).toBe(false);
    expect(soon.ring).toBe(false);
  });

  it('常态描边用金色（开始键是可点的主动作），与卡片的"已选中"是同一个色语言', () => {
    expect(ready.strokeColor).toBe(PREPARE_SKIN.selectionLine);
  });
});


/**
 * ==================================================================
 * 一帧要画的每一张卡（`cardDrawsOf`）
 * ==================================================================
 *
 * 它替代了旧版 `PrepareScreen.draw()` 里那段内联 `areas.map(...)`：那段
 * 只能靠截图看对不对。抽成纯函数之后，"光标在 A、选择在 B 时各张卡是什么
 * 皮肤"可以在 node 里断言 —— 而手风琴又让"这一帧画哪几张"变成**子集**
 * （收起的那两块不画卡），所以这里同时钉住"跳过非卡片区域"。
 */
describe('一帧要画的卡：状态 → 每张卡的画法', () => {
  const players = [{ id: 'player', nameKey: 'p0' }, { id: 'kaili', nameKey: 'p1' }];
  const bosses = [{ id: 'meiichiro', nameKey: 'b0' }];
  const qiji = [{ id: 'vitality', nameKey: 'q0' }];
  const areas = prepareHitAreas(players, bosses, qiji, 'player');
  const base = {
    areas,
    nameOf: (_kind: 'player' | 'qiji' | 'boss', id: string) => `名-${id}`,
    selection: { playerId: 'player', bossId: 'meiichiro' },
    on: () => false,
    developing: () => false,
  };

  it('只画展开那一块的卡（`start` / `summary` 不是卡，被跳过）', () => {
    const draws = cardDrawsOf({ ...base, cursor: undefined });
    expect(draws.map((d) => d.id)).toEqual(['player', 'kaili']);
    expect(draws.every((d) => d.kind === 'player')).toBe(true);
  });

  it('位置与命中区**逐字相同**（看到的卡 = 点中的卡）', () => {
    const draws = cardDrawsOf({ ...base, cursor: undefined });
    const first = areas.find((a) => a.id === 'player')!;
    expect(draws[0]).toMatchObject({ x: first.x, y: first.y, w: first.w, h: first.h });
  });

  it('名字由 `nameOf` 给（三块各自一张表，渲染层不自己查）', () => {
    const draws = cardDrawsOf({ ...base, cursor: undefined });
    expect(draws.map((d) => d.name)).toEqual(['名-player', '名-kaili']);
  });

  it('【关键】光标那张与选中那张拿到**不同**的皮肤（两者可分离）', () => {
    /** 光标在第二张（凯丽）、选择还是第一张（林晚风）。 */
    const draws = cardDrawsOf({ ...base, cursor: { kind: 'player', id: 'kaili' } });
    const [selected, cursored] = draws;
    expect(cursored!.strokeColor).toBe(PREPARE_SKIN.cursorLine);
    expect(selected!.strokeColor).toBe(PREPARE_SKIN.selectionLine);
    expect(cursored!.strokeColor).not.toBe(selected!.strokeColor);
  });

  it('炁机卡：开着画金色（与"已确定"同一种"生效"色），人物卡永远不沾它', () => {
    const withQiji = prepareHitAreas(players, bosses, qiji, 'qiji');
    const draws = cardDrawsOf({
      ...base,
      areas: withQiji,
      cursor: undefined,
      on: (id) => id === 'vitality',
    });
    expect(draws).toHaveLength(1);
    expect(draws[0]).toMatchObject({
      kind: 'qiji',
      id: 'vitality',
      strokeColor: PREPARE_SKIN.selectionLine,
      showPortrait: false,
    });
  });

  it('炁机卡**没有角标**了（激活是开关、没有层数 —— 用户纠正过的那条机制）', () => {
    const withQiji = prepareHitAreas(players, bosses, qiji, 'qiji');
    const draws = cardDrawsOf({
      ...base,
      areas: withQiji,
      cursor: undefined,
      on: () => true,
    });
    expect(draws[0]).not.toHaveProperty('badge');
  });

  it('人物卡带头像、Boss 卡不带（素材表里只有人物有脸）', () => {
    const draws = cardDrawsOf({ ...base, cursor: undefined });
    expect(draws[0]!.showPortrait).toBe(true);
    const bossDraws = cardDrawsOf({
      ...base,
      areas: prepareHitAreas(players, bosses, qiji, 'boss'),
      cursor: undefined,
    });
    expect(bossDraws[0]).toMatchObject({ kind: 'boss', showPortrait: false });
  });
});

/**
 * ==================================================================
 * 【关键】"画出来的矩形 == 命中矩形"逐张钉住（含滚动偏移）
 * ==================================================================
 *
 * 上面那条只对了**一张**人物卡。而"看到的卡"与"点中的卡"必须对**每一张、
 * 每一种展开方式、每一种滚动位置**都成立 —— 这是本屏最容易静默坏掉的一条
 * （两处各算一遍几何 = 点到的卡与看到的卡差一个滚动量，而那看起来像
 * "点击乱跳"，光看截图看不出来）。
 *
 * ⚠️ 判据不是"某个数等于某个值"，而是**两份几何逐字段相等**：
 * `cardDrawsOf` 的产物就是渲染层 `roundRect` 的入参（`prepareCards.drawAll`），
 * 所以这一条等于"渲染入参 == 命中入参"。
 */
describe('【关键】画出来的卡 == 命中区（逐张 / 每种展开 / 含滚动）', () => {
  /** 真实张数：3 人物 / 8 炁机 / 7 对手（与内容表一致）。 */
  const three = Array.from({ length: 3 }, (_, i) => ({ id: `p${i}`, nameKey: `p${i}` }));
  const seven = Array.from({ length: 7 }, (_, i) => ({ id: `b${i}`, nameKey: `b${i}` }));
  const eight = Array.from({ length: 8 }, (_, i) => ({ id: `q${i}`, nameKey: `q${i}` }));
  /** 20 张 = 4 行 > 视口 2 行 → 这一块**真的会滚**（命中区要被裁剪 + 上移）。 */
  const twenty = Array.from({ length: 20 }, (_, i) => ({ id: `q${i}`, nameKey: `q${i}` }));

  const drawsOf = (
    areas: ReturnType<typeof prepareHitAreas>,
  ): ReturnType<typeof cardDrawsOf> =>
    cardDrawsOf({
      areas,
      nameOf: (_kind, id) => id,
      cursor: undefined,
      selection: { playerId: 'p0', bossId: 'b0' },
      on: () => false,
      developing: () => false,
    });

  it('三种展开方式：每一张画出来的卡都能在命中区里找到**同一个矩形**', () => {
    const sections: readonly PrepareSectionKind[] = ['player', 'qiji', 'boss'];
    for (const expanded of sections) {
      const areas = prepareHitAreas(three, seven, eight, expanded);
      const draws = drawsOf(areas);
      /** 画出来的张数 == 命中区里"是卡"的那几条（`start` / `summary` 不是卡）。 */
      expect(draws).toHaveLength(
        areas.filter((a) => a.kind !== 'start' && a.kind !== 'summary').length,
      );
      for (const d of draws) {
        const area = areas.find((a) => a.kind === d.kind && a.id === d.id);
        expect(area).toBeDefined();
        expect([d.x, d.y, d.w, d.h]).toEqual([area!.x, area!.y, area!.w, area!.h]);
      }
    }
  });

  it('滚过一行之后仍然逐字段相等（偏移没有算两遍）', () => {
    const scroll = { player: 0, qiji: sectionRowStep('qiji'), boss: 0 };
    const areas = prepareHitAreas(three, seven, twenty, 'qiji', scroll);
    const draws = drawsOf(areas);
    /** 第一行被滚掉 → 命中区里第一张是下标 5（5 列）。 */
    expect(draws[0]!.id).toBe('q5');
    for (const d of draws) {
      const area = areas.find((a) => a.kind === d.kind && a.id === d.id);
      expect(area).toBeDefined();
      expect([d.x, d.y, d.w, d.h]).toEqual([area!.x, area!.y, area!.w, area!.h]);
    }
  });
});

/**
 * ==================================================================
 * 【关键】一行字在盒子里垂直居中（用**实测盒高**，不用行高估计）
 * ==================================================================
 *
 * 用户报的"炁机卡的字没有在卡片中居中"。原来的写法是
 * `中心 y − nameLineH / 2`，而 `nameLineH`(23) 是**卡片高度的预算**、
 * 不是画出来的文字盒高（15 号字实测 16.05、17 号字 18.19）—— 于是整行字
 * 被推高 2.4~3.5px。
 *
 * ⚠️ 这一条只能在 node 里钉**规则**：真正的盒高由 Pixi 给（jsdom 里
 * 量不准）。所以断言写成"文字盒的中心 == 盒子中心"，与字号无关。
 */
describe('【关键】文字在盒子里垂直居中（按实测盒高）', () => {
  it('文字盒中心 == 盒子中心（15 号 / 17 号 / 任意盒高都成立）', () => {
    const cases: readonly (readonly [number, number, number])[] = [
      /** [盒顶, 盒高, 实测文字盒高] —— 后两个是实测值（卡片 / 块头）。 */
      [191, 40, 16.05],
      [103, 40, 18.19],
      [55, 88, 18.19],
      [0, 40, 16.05],
    ];
    for (const [top, boxH, textH] of cases) {
      const y = centeredTextTopY(top, boxH, textH);
      expect(y + textH / 2).toBeCloseTo(top + boxH / 2, 6);
    }
  });

  it('用一个"行高估计值"去算会偏（这就是修之前的那条）', () => {
    /** 卡片高 40、文字盒 16.05：减 `nameLineH / 2`(11.5) 会把字**推高** 3.475px。 */
    const correct = centeredTextTopY(0, 40, 16.05);
    const old = 0 + 40 / 2 - 23 / 2;
    expect(correct - old).toBeCloseTo(3.475, 3);
  });
});
