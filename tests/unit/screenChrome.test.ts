import { describe, expect, it } from 'vitest';
import { battleGearBoxAt, chromeBoxAt, devClearBoxOf } from '../../src/ui/ScreenChrome';
import { iconHintBoxSize, iconHintPlacement } from '../../src/ui/iconHint';
import { LAYOUT, LOGICAL, scaleUiRect } from '../../src/ui/layout';

/**
 * ==================================================================
 * 边角控件的**落位**：贴边 + 随 UI 缩放 —— 一条规则，几条边共用
 * ==================================================================
 *
 * 用户 2026-10-12 三条原话（其实是同一件事）：
 *
 *   1. "**stage 上理论上不挂任何小组件**"
 *   2. "**多个页面的齿轮，应该分别定义**"
 *   3. "**UI 缩放要带上**"
 *
 * 前两条是"组件归它所在的界面所有"（结构，见 `ScreenChrome` 文件头）；
 * 这一份钉的是第三条：**齿轮与返回箭头都要按同一个系数重排**。
 *
 * ⚠️ 2026-10-13 补第二条钉：**战斗齿轮锚在玩家面板右边**（用户原话：
 * "战斗时，齿轮应该在人物面板的右边"）。上一版锚在画布左下角，`scale ≥ 1.4`
 * 时会压住面板 / 血条 —— 这一份把"面板右边 + 不与日志/技能栏/画布边相撞"
 * 逐档钉死。
 *
 * ⚠️ 2026-10-13 再补一条：**边角控件离屏幕边缘的距离 8 → 16**（用户：
 * "左上右上 2 个按钮可以增加一点到屏幕边缘的距离"）。这一份钉的就是
 * "四个整屏界面共用同一条边距"（它们都走 `chromeBoxAt`）。
 *
 * ⚠️ 只测纯函数（不构造 Pixi）：与 `iconButton.test.ts` 同一条纪律
 * （Pixi v8 在 jsdom 里不好跑，而"算得对不对"恰恰是最该钉的部分）。
 */

/** 齿轮（右上 / 战斗）与返回箭头（左上）的基准尺寸 —— 与 `ScreenChrome` 内部常量一致。 */
const GEAR = 20;
const ARROW = 22;
/**
 * 边角控件自己的边距（`ScreenChrome` 的 `MARGIN`）。
 *
 * ⚠️ **必须与源码同步**：这个数同时是 `HINT_RISE` / `HINT_SHIFT` 的**上限**
 * （见 `iconHint.ts` 的推导），所以它一改，"偏移最大能取多少"就跟着改 ——
 * 下面 `边距同时是偏移的上限` 那组断言会一起盯着。8 → 16（2026-10-13）。
 */
const MARGIN = 16;
/** 齿轮的键位提示文案（与 `ScreenChrome` 的 `f1Label()` 同形：`F1`）。 */
const GEAR_HINT = 'F1';

const gearAt = (scale: number) => chromeBoxAt({ right: true, bottom: false }, GEAR, scale);
const backAt = (scale: number) => chromeBoxAt({ right: false, bottom: false }, ARROW, scale);

/**
 * **玩家面板**的缩放后矩形 —— 与 `UiLayout.playerPanel` 同一条锚点
 * （`bottom-left`）。战斗齿轮的落位就锚在它上面，所以这一份是"基准"。
 */
const panelRectAt = (scale: number) => scaleUiRect(LAYOUT.player, 'bottom-left', scale);

/** 缩放后的日志面板矩形（与 `UiLayout.logPanel` 同一条锚点：`top-left`）。 */
const logRectAt = (scale: number) => scaleUiRect(LAYOUT.log, 'top-left', scale);

/** 缩放后的技能栏整体 --- 与 `UiLayout.skillBarBounds` 同一条右对齐算术。 */
function skillBarRectAt(scale: number, total = LAYOUT.skillBar.max) {
  const size = Math.max(1, Math.round(LAYOUT.skillBar.slot * scale));
  const spacing = Math.max(1, Math.round(LAYOUT.skillBar.gap * scale));
  const margin = Math.max(1, Math.round(LAYOUT.skillBar.right * scale));
  const count = Math.max(1, Math.min(total, LAYOUT.skillBar.max));
  const totalW = count * size + (count - 1) * spacing;
  const baseY = LAYOUT.skillBar.y + LAYOUT.skillBar.slot - size;
  return {
    x: LOGICAL.width - margin - totalW,
    y: Math.round(baseY),
    w: totalW,
    h: size,
  };
}

/**
 * 战斗齿轮**整块**（图标 + 压在它左上角上的 `F1` 角标）的包围盒 —— 与
 * `IconButton` 里那条落位规则同一套几何（`iconHintPlacement` + `iconHintBoxSize`）。
 *
 * ⚠️ 角标**不出图标范围**（它的左上角压在图标左上角上、往右下方长），所以整块的
 * 上缘 / 左缘都取图标那一头。
 */
function gearBlockAt(scale: number) {
  const box = battleGearBoxAt(scale);
  const hint = iconHintBoxSize(GEAR_HINT, box.size);
  const placed = iconHintPlacement(
    { icon: { x: box.x, y: box.y, w: box.size, h: box.size }, canvasW: LOGICAL.width, canvasH: LOGICAL.height },
    hint.w,
    hint.h,
  );
  return {
    x: Math.min(box.x, placed.x),
    y: Math.min(box.y, placed.y),
    right: Math.max(box.x + box.size, placed.x + hint.w),
    bottom: Math.max(box.y + box.size, placed.y + hint.h),
    box,
    hint: { x: placed.x, y: placed.y, w: hint.w, h: hint.h },
  };
}

function overlaps(
  a: { readonly x: number; readonly y: number; readonly right: number; readonly bottom: number },
  b: { readonly x: number; readonly y: number; readonly w: number; readonly h: number },
): boolean {
  return a.x < b.x + b.w && b.x < a.right && a.y < b.y + b.h && b.y < a.bottom;
}


describe('边角落位：贴边（`MARGIN` = 16）', () => {
  it('返回箭头贴左上角', () => {
    expect(backAt(1)).toEqual({ x: MARGIN, y: MARGIN, size: 22 });
  });

  it('齿轮贴右上角（右缘 = 画布宽 − `MARGIN`）', () => {
    const b = gearAt(1);
    expect(b).toEqual({ x: LOGICAL.width - MARGIN - 20, y: MARGIN, size: 20 });
    /** ⚠️ 右缘精确贴安全区（这就是"贴边"的判据）。 */
    expect(b.x + b.size).toBe(LOGICAL.width - MARGIN);
  });

  it('两条边角是**镜像**的：距自己那侧的边距相同', () => {
    const g = gearAt(1);
    const bk = backAt(1);
    expect(bk.x).toBe(MARGIN);
    expect(LOGICAL.width - (g.x + g.size)).toBe(MARGIN);
  });

  it('⚠️【用户 2026-10-13】边距确实**离开了屏幕边缘一点**（不是 8）', () => {
    /**
     * 原话："左上右上 2 个按钮可以增加一点到屏幕边缘的距离"。
     *
     * 判据是"离边缘比原来（8）更远"，而不是钉死某一个数 —— 具体值由
     * `MARGIN` 定，这条只在它被改回 8 或更小的时候失败。
     */
    expect(MARGIN).toBeGreaterThan(8);
    for (const scale of [0.5, 1, 1.5, 2]) {
      const g = gearAt(scale);
      const bk = backAt(scale);
      const tag = `scale=${scale}`;
      /** 左侧与上侧：返回箭头离边缘 `MARGIN×scale`。 */
      expect(bk.x, tag).toBe(Math.round(MARGIN * scale));
      expect(bk.y, tag).toBe(Math.round(MARGIN * scale));
      /** 右侧：齿轮的右缘离右边缘同样是 `MARGIN×scale`。 */
      expect(LOGICAL.width - (g.x + g.size), tag).toBe(Math.round(MARGIN * scale));
    }
  });
});

describe('边角落位：随 UI 缩放', () => {
  it('边长按系数放大（这是"缩放要带上"最直接的判据）', () => {
    expect(gearAt(1.5).size).toBe(30);
    expect(backAt(0.5).size).toBe(11);
  });

  it('⚠️ 放大了仍然**贴着安全区**（贴边的要从自己那条边长出来）', () => {
    /**
     * 这条是"直接乘系数"那个错法的回归测试：如果 `x` 也乘 1.5，齿轮
     * （原本右缘 952）会跑到 `1386` —— 整块飞出画布。正确的读法是
     * "边距与尺寸都乘系数，位置由右缘反推"。
     */
    for (const scale of [0.5, 0.75, 1, 1.5, 2]) {
      const g = gearAt(scale);
      const bk = backAt(scale);
      const tag = `scale=${scale}`;
      expect(bk.x, tag).toBe(Math.round(MARGIN * scale));
      expect(LOGICAL.width - (g.x + g.size), tag).toBe(Math.round(MARGIN * scale));
      /** 上缘同理：两条边角的 `y` 都是"上方 8×scale"。 */
      expect(g.y, tag).toBe(Math.round(MARGIN * scale));
      expect(bk.y, tag).toBe(Math.round(MARGIN * scale));
    }
  });

  it('【关键】没有"看在哪一半"的分支：同系数下两角走同一套算术', () => {
    /**
     * ⚠️ 用户 2026-10-12 否掉了"按按钮在画布哪一半翻角"的旧设计
     * （"不用看在哪一半，全局统一风格"）。这条断言就是那条否决的回归：
     * 边距与尺寸只由 `scale` 决定，与 `right` / `bottom` **无关**。
     */
    for (const scale of [0.5, 1, 1.5]) {
      const g = gearAt(scale);
      const bk = backAt(scale);
      expect(LOGICAL.width - (g.x + g.size), `scale=${scale}`).toBe(bk.x);
      expect(g.y, `scale=${scale}`).toBe(bk.y);
    }
  });

  it('整块不出画布（两个边角、缩放范围内都不越界）', () => {
    for (const scale of [0.5, 1, 1.5, 2]) {
      for (const b of [gearAt(scale), backAt(scale)]) {
        const tag = `scale=${scale} box=${JSON.stringify(b)}`;
        expect(b.x, tag).toBeGreaterThanOrEqual(0);
        expect(b.y, tag).toBeGreaterThanOrEqual(0);
        expect(b.x + b.size, tag).toBeLessThanOrEqual(LOGICAL.width);
        expect(b.y + b.size, tag).toBeLessThanOrEqual(LOGICAL.height);
      }
    }
  });
});

describe('战斗界面的齿轮：**玩家面板右缘 + 间距**', () => {
  /**
   * ================================================================
   * 规则（一条）：图标左上角 = `(面板右缘 + MARGIN×scale, 面板上缘)`
   * ================================================================
   *
   * 演进：右下角 → 玩家面板右侧 → 右上角 → 日志下方 → 画布左下角 →
   * **玩家面板右边**（2026-10-13，用户："战斗时，齿轮应该在人物面板的右边"）。
   *
   * ⚠️ "画布左下角"那一版虽然任何系数都不越界，但 `scale ≥ 1.4` 时**压住
   * 玩家面板 / 血条**（面板是 `bottom-left` 锚点，向上长）。锚在**面板**上
   * 就没有这个取舍：往外挪的同时，压不着面板。
   *
   * ⚠️ 这里的"间距"就是边角控件那个共享 `MARGIN`（现在是 16）：用户
   * "边角按钮离边缘远一点"的要求，顺带也让齿轮离面板远了一点。
   */
  it('贴着面板的**右缘**，与面板**上缘**对齐（引用 `LAYOUT.player`，不是写死的数字）', () => {
    const b = battleGearBoxAt(1);
    const panel = panelRectAt(1);
    expect(b.x).toBe(panel.x + panel.w + MARGIN);
    expect(b.y).toBe(panel.y);
    expect(b.size).toBe(GEAR);
  });

  it('随系数缩放，且始终**跟着面板走**（面板动了它就跟）', () => {
    for (const scale of [0.5, 0.8, 1, 1.4, 1.5, 2]) {
      const b = battleGearBoxAt(scale);
      const panel = panelRectAt(scale);
      const tag = `scale=${scale}`;
      expect(b.x, tag).toBe(panel.x + panel.w + Math.round(MARGIN * scale));
      expect(b.y, tag).toBe(panel.y);
      expect(b.size, tag).toBe(Math.max(1, Math.round(GEAR * scale)));
    }
  });

  it('【硬验收】六档系数下**整块**（齿轮 + `F1` 角标）都在 960×540 内', () => {
    /**
     * 判据是"规则自己就保证不越界"，**不是**"算完再夹"：
     *   - 左缘 = 面板右缘 + 间距 ≥ 面板右缘 ✓
     *   - 右缘：scale 2 时提示角标右缘 `515` ≪ 960 ✓
     *     （精确值见 `ScreenChrome.battleGearBoxAt` 的表格，单测只钉"在界内"）
     *   - 上缘 = 面板上缘（≥ 372 @2）✓ 下缘 = 上缘 + 图标 + 一点点 ✓
     */
    for (const scale of [0.5, 0.8, 1, 1.4, 1.5, 2]) {
      const { x, y, right, bottom } = gearBlockAt(scale);
      const tag = `scale=${scale}`;
      expect(x, tag).toBeGreaterThanOrEqual(0);
      expect(y, tag).toBeGreaterThanOrEqual(0);
      expect(right, tag).toBeLessThanOrEqual(LOGICAL.width);
      expect(bottom, tag).toBeLessThanOrEqual(LOGICAL.height);
    }
  });

  it('⚠️ 与**玩家面板**不重叠（面板本身的几何，不是只有图标）', () => {
    for (const scale of [0.5, 0.8, 1, 1.4, 1.5, 2]) {
      const block = gearBlockAt(scale);
      const panel = panelRectAt(scale);
      expect(
        overlaps(block, panel),
        `scale=${scale}：齿轮整块 ${JSON.stringify(block)} 压住了面板 ${JSON.stringify(panel)}`,
      ).toBe(false);
      /** 而且齿轮确实在面板**右边**（不是"上方"或"下方"那种不重叠）。 */
      expect(block.x, `scale=${scale}`).toBeGreaterThanOrEqual(panel.x + panel.w);
    }
  });

  it('⚠️ 与**缩放后的**日志面板不重叠（同一坐标系，不是基准矩形）', () => {
    for (const scale of [0.5, 0.8, 1, 1.4, 1.5, 2]) {
      const block = gearBlockAt(scale);
      const log = logRectAt(scale);
      expect(
        overlaps(block, log),
        `scale=${scale}：齿轮整块 ${JSON.stringify(block)} 压住了日志 ${JSON.stringify(log)}`,
      ).toBe(false);
    }
  });

  it('⚠️ 与**技能栏**不重叠（右下角那块，`scale` 越大越往左长）', () => {
    for (const scale of [0.5, 0.8, 1, 1.4, 1.5, 2]) {
      const block = gearBlockAt(scale);
      const bar = skillBarRectAt(scale);
      expect(
        overlaps(block, bar),
        `scale=${scale}：齿轮整块 ${JSON.stringify(block)} 压住了技能栏 ${JSON.stringify(bar)}`,
      ).toBe(false);
    }
  });

  it('提示在 1.5 与 2.0 下**确实变大了**（字号跟着缩放）', () => {
    const a = gearBlockAt(1.5);
    const b = gearBlockAt(2);
    expect(b.box.size).toBeGreaterThan(a.box.size);
    expect(b.hint.w).toBeGreaterThan(a.hint.w);
    expect(b.hint.h).toBeGreaterThan(a.hint.h);
  });
});

/**
 * ==================================================================
 * **开发模式的「一键过关」按钮落点**（2026-10-22）
 * ==================================================================
 *
 * 用户："一键过关，**放在设置旁边**"。所以钉两件事：
 *
 *   1. 它在齿轮**正右方**、同一行、同尺寸（"旁边"的字面意思）
 *   2. 两个矩形**不相交**（六档缩放都不相交 —— 与齿轮那组循环同一个口径）
 */
describe('一键过关按钮：贴在齿轮右边且不重叠', () => {
  const scales = [0.5, 0.8, 1, 1.4, 1.5, 2];

  it('同一行、同尺寸、紧接在齿轮右侧', () => {
    const gear = chromeBoxAt({ right: true, bottom: false }, 20, 1);
    const dev = devClearBoxOf(gear);
    expect(dev.y).toBe(gear.y);
    expect(dev.size).toBe(gear.size);
    expect(dev.x).toBeGreaterThanOrEqual(gear.x + gear.size);
  });

  it('六档缩放下都不与齿轮重叠、且不出画布右缘', () => {
    for (const scale of scales) {
      const gear = battleGearBoxAt(scale);
      const dev = devClearBoxOf(gear);
      /** 不相交（同一行 ⇒ 只看 x 区间）。 */
      expect(dev.x).toBeGreaterThanOrEqual(gear.x + gear.size);
      /** 在画布内。 */
      expect(dev.x + dev.size).toBeLessThanOrEqual(LOGICAL.width);
    }
  });
});
