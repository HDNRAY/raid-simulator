import { describe, expect, it } from 'vitest';
import { ICON_BUTTON_DEFAULTS } from '../../src/ui/IconButton';
import { FONT, LOGICAL } from '../../src/ui/layout';
import {
  BASE_HINT_FONT,
  BASE_ICON_SIZE,
  HINT_RISE,
  HINT_SHIFT,
  MIN_HINT_FONT,
  estimateMonoWidth,
  iconHintBoxSize,
  iconHintFontSize,
  iconHintPlacement,
  iconHintRise,
  iconHintShift,
} from '../../src/ui/iconHint';
import { buildFocusContext } from '../../src/ui/settings/panelFocus';
import { keyGridMetrics } from '../../src/ui/settings/keyGridLayout';
import { KEY_GRID, TOUCH_GRID_COLS } from '../../src/ui/settings/settingsGeometry';
import { rowsCapacity } from '../../src/ui/settings/logic';

/**
 * ==================================================================
 * 键位提示的摆法：**角标**（压在图标**左上角**上）
 * ==================================================================
 *
 * 用户 2026-10-13 的原话："**是角标在左上角啊？** 你随便找个【昨天】的版本
 * 都是这样。今天我让你把返回改得跟设置一样之后，就都不对了，**没一次是对的**。"
 *
 * 参照物 = **`e64eb2d`**（昨天最后一个"角标"提交）。它那一版的落位就是
 * **一行**：
 *
 * ```ts
 * // src/ui/IconButton.ts @ e64eb2d
 * return { x: icon.x, y: icon.y, anchorX: 0, anchorY: 0 };
 * ```
 *
 * ⚠️ 用户看过之后又给了一个微调（原话："**f1 还要再往上挪几个 px**"），
 * 于是现在是 `y = icon.y − iconHintRise(size)`（`x` 不动）—— 见本文件
 * 最后一组 `rise` 的断言。
 *
 * ⚠️ `41ca468` 那次"恢复历史"挖到了**首个提交**（`d4e3fb7`）的**并排**
 * （`⚙ F1` / `F1 ⚙`），把角标拆了 —— 那是挖错了参照物（用户要的不是它）。
 * 本文件钉的就是改回角标之后的样子。
 */
describe('IconButton：提示是压在图标左上角上的**角标**（一条落位公式）', () => {
  /** 两个真实调用点的图标矩形（尺寸与锚点抄自 `ScreenChrome` 的常量）。 */
  const gear = { x: LOGICAL.width - 8 - 20, y: 8, w: 20, h: 20 };
  const back = { x: 8, y: 8, w: 22, h: 22 };

  const place = (icon: typeof gear) => {
    const hint = iconHintBoxSize('Esc', icon.w);
    return {
      hint,
      p: iconHintPlacement(
        { icon, canvasW: LOGICAL.width, canvasH: LOGICAL.height },
        hint.w,
        hint.h,
      ),
    };
  };

  /** 提示包围盒（锚点是它的左上角，`anchorX/Y = 0`）。 */
  const boxOf = (hint: { w: number; h: number }, p: { x: number; y: number }) => ({
    x: p.x,
    y: p.y,
    right: p.x + hint.w,
    bottom: p.y + hint.h,
  });

  it('【关键】提示左上角 = 图标左上角 **再往左上各偏一点**（`shift` / `rise`）', () => {
    /**
     * ⚠️ 用户 2026-10-13 的三句话叠起来才是现在的规格：
     *   1. "**是角标在左上角啊？**"（角标，不是并排、不是正中）
     *   2. "**f1 还要再往上挪几个 px**"（`y` 再高 `rise`）
     *   3. "**等会 往左再挪几个 px**"（`x` 再左 `shift`）
     *
     * 判据不是"两个按钮的绝对坐标相同"（它们在对角，不可能相同），
     * 而是"**同一个公式 + 同一个锚点**"：
     *   - 锚点都是提示的**左上角**（`anchorX = 0` / `anchorY = 0`）
     *   - 提示左缘 = **图标左缘 − `iconHintShift(图标宽)`**
     *   - 提示上缘 = **图标上缘 − `iconHintRise(图标宽)`**
     */
    for (const icon of [gear, back]) {
      const { hint, p } = place(icon);
      const b = boxOf(hint, p);
      const shift = iconHintShift(icon.w);
      const rise = iconHintRise(icon.w);
      const tag = JSON.stringify(icon);
      expect(p.anchorX, tag).toBe(0);
      expect(p.anchorY, tag).toBe(0);
      /** 左缘比图标左缘再往左 `shift` —— 这正是"往左再挪几个 px"。 */
      expect(b.x, tag).toBe(icon.x - shift);
      expect(shift, tag).toBeGreaterThan(0);
      /** 上缘比图标上缘再往上 `rise` —— 这正是"再往上挪几个 px"。 */
      expect(b.y, tag).toBe(icon.y - rise);
      expect(rise, tag).toBeGreaterThan(0);
      /** 提示与图标在同一角：横向交叠必须为正（偏一点，不是挪走）。 */
      expect(Math.min(b.right, icon.x + icon.w) - Math.max(b.x, icon.x), tag).toBeGreaterThan(0);
      /** ⚠️ 且提示**整块落在图标的上半部分**（"贴顶部"而不是"居中"）。 */
      expect(b.bottom, tag).toBeLessThan(icon.y + icon.h / 2);
    }
  });

  it('提示**不按位置换规则**：把图标搬到画布四个角，落位公式不变', () => {
    /**
     * ⚠️ 旧版有个 `'auto'` 会按"按钮在画布哪一半"翻角 —— 用户否掉了
     * （原话："**不用看在哪一半，全局统一风格**"）。这条断言就是那条否决的
     * 回归测试：同样的图标放到画布四个角，**相对自己图标**的落位都不变。
     */
    const atCorners = [
      { ...gear, x: 8, y: 8 },
      { ...gear, x: LOGICAL.width - 30, y: 8 },
      { ...gear, x: 8, y: LOGICAL.height - 30 },
      { ...gear, x: LOGICAL.width - 30, y: LOGICAL.height - 30 },
    ];
    for (const icon of atCorners) {
      const { hint, p } = place(icon);
      const b = boxOf(hint, p);
      const tag = JSON.stringify(icon);
      expect(p.anchorX, tag).toBe(0);
      expect(b.x, tag).toBe(icon.x - iconHintShift(icon.w));
      expect(b.y, tag).toBe(icon.y - iconHintRise(icon.w));
    }
  });

  it('两个真实调用点的提示都**不需要**避让（整块在画布内）', () => {
    /**
     * ⚠️ 这条是"**别再加第二套避让逻辑**"的判据（用户明确否掉避让）。
     * 规则只让提示往右下方长、纵向**向上抬 `rise`**；而两个按钮的图标上缘
     * 本来就留了安全区边距（`8 × scale`），`rise` 又按同一个 `size` 缩放 ——
     * 所以"整块在画布内"由**锚点那条规则**保证，这里只是对账。
     *
     * ⚠️ 若哪天有人把图标挪到贴边处、或把 `HINT_RISE` 调到 8 以上，这条会
     * 先失败 —— 那时候该改的是**锚点 / 安全区**（或去问用户），**不是**在
     * `iconHintPlacement` 里悄悄加一段夹取把它推回来（那会让两个按钮看起来
     * 又不一样）。
     */
    for (const icon of [gear, back]) {
      const { hint, p } = place(icon);
      const b = boxOf(hint, p);
      const tag = JSON.stringify(icon);
      expect(b.x, tag).toBeGreaterThanOrEqual(0);
      expect(b.y, tag).toBeGreaterThanOrEqual(0);
      expect(b.right, tag).toBeLessThanOrEqual(LOGICAL.width);
      expect(b.bottom, tag).toBeLessThanOrEqual(LOGICAL.height);
    }
  });
});

/**
 * ==================================================================
 * 抬升 `rise`：值 + **跟不跟缩放**（本轮新加的那一个量）
 * ==================================================================
 *
 * 用户 2026-10-13："**f1 还要再往上挪几个 px**"。
 *
 * ⚠️ 选择**跟着图标缩放**（与字号同一条公式、同一个分母），理由写在
 * `HINT_RISE` 的注释里："抬多少"与字号是同一类量 —— 放大 2 倍后字高 18px
 * 而抬升还只有 4px，那 4px 在视觉上就粘在图标上了。
 * `HINT_RISE = 4` 说的是**基准图标（20px）**上抬 4。
 */
describe('角标偏移 `shift` / `rise`：基准各 4px、都跟着图标缩放', () => {
  const SIZES = [10, 20, 22, 28, 30, 40, 44];

  it('基准图标 20px → 上抬 4、左移 4（都是用户给的数）', () => {
    expect(HINT_RISE).toBe(4);
    expect(HINT_SHIFT).toBe(4);
    expect(iconHintRise(BASE_ICON_SIZE)).toBe(HINT_RISE);
    expect(iconHintShift(BASE_ICON_SIZE)).toBe(HINT_SHIFT);
  });

  it('⚠️ 两个偏移**完全对称**：同一条公式、同一个分母、同一个 `Math.round`', () => {
    /**
     * ⚠️ 这是本轮的核心断言：`shift` 不是"另写一套"，而是与 `rise` 同形的
     * 比例函数 —— 所以下面这个等式对每个 size 都必须成立。
     */
    for (const size of SIZES) {
      expect(iconHintRise(size), `size=${size}`).toBe(
        Math.round(HINT_RISE * (size / BASE_ICON_SIZE)),
      );
      expect(iconHintShift(size), `size=${size}`).toBe(
        Math.round(HINT_SHIFT * (size / BASE_ICON_SIZE)),
      );
      /** 基准值相同时，两个函数逐点相等（对称的最强形式）。 */
      expect(iconHintShift(size), `size=${size}`).toBe(iconHintRise(size));
    }
    /** 几档实际值：0.5 倍 → 2；1 倍 → 4（返回箭头 22px 也落 4）；2 倍 → 8。 */
    expect(iconHintShift(10)).toBe(2);
    expect(iconHintShift(22)).toBe(4);
    expect(iconHintShift(40)).toBe(8);
  });

  it('⚠️ 两者上限都是 8：任何系数下都不出画布（安全区是 8×scale）', () => {
    /**
     * ⚠️ 这是"规则自己保证"的那条不等式：最紧的**返回箭头**同时靠上、靠左，
     * 图标上缘 / 左缘都是 `round(8×scale)`；而两个偏移都按同一个 `scale` 缩
     * —— 所以只要基准值 ≤ 8，`偏移 ≤ 图标边距` 恒成立。
     *
     * 这条把**可用空间**钉住：任一个改到 9，就会在某个系数下顶出画布。
     */
    for (const base of [HINT_RISE, HINT_SHIFT]) {
      expect(base).toBeLessThanOrEqual(8);
    }
    for (const size of [...SIZES, 50]) {
      const room = Math.round(8 * (size / 20));
      expect(iconHintRise(size), `rise size=${size}`).toBeLessThanOrEqual(room);
      expect(iconHintShift(size), `shift size=${size}`).toBeLessThanOrEqual(room);
    }
  });
});

/**
 * ==================================================================
 * 角标的**两条外观特征**（字号更小 + 描边）—— 值本身也要钉住
 * ==================================================================
 *
 * 用户 2026-10-12 报过"esc 的描边没有让它看起来足够清晰"，`e64eb2d` 的
 * 结论是：**角标必须比并排那版小一圈（9 < 13）且带 3px 黑描边** ——
 * 它**压**在图标浅色笔画上，没有描边会糊成一团。这两条就是"角标"与
 * "并排"在**尺度**上的区别，所以单独钉。
 *
 * ⚠️ 摆法（在左上角、一个公式）在上面那组；这一组管"多大、有没有描边"。
 */
describe('角标：字号比并排小一圈 + 带描边', () => {
  it('基准字号是 **9**（老版 `cornerSize`），不是并排的 `FONT.small`（13）', () => {
    expect(BASE_HINT_FONT).toBe(9);
    expect(BASE_HINT_FONT).toBeLessThan(FONT.small);
    expect(ICON_BUTTON_DEFAULTS.hintFont).toBe(BASE_HINT_FONT);
  });

  it('描边宽度是 **3**（老版 `cornerStroke`），且默认开启', () => {
    expect(ICON_BUTTON_DEFAULTS.cornerStroke).toBe(3);
  });

  it('提示盒子按**角标字号**算宽（不是按 `FONT.small` 估）', () => {
    const box = iconHintBoxSize('F1', BASE_ICON_SIZE);
    expect(box.w).toBe(estimateMonoWidth('F1', BASE_HINT_FONT));
    expect(box.h).toBe(BASE_HINT_FONT);
  });
});

/**
 * ==================================================================
 * 提示整块跟着图标缩放（用户要求，与摆法是两件事）
 * ==================================================================
 *
 * 规格：字号 + 落位跟图标一起缩，而且**一条公式**（只有图标边长一个输入）
 * + **规则给出的下限**。
 */
describe('IconButton：提示随图标缩放（一条公式）', () => {
  /** 图标的实际边长：`chromeBoxAt` / `UiLayout.len` 都是 `round(base × scale)`。 */
  const iconSizeAt = (scale: number) => Math.max(1, Math.round(BASE_ICON_SIZE * scale));

  it('字号按比例放大：0.5 / 1 / 1.5 / 2 四档各不相同', () => {
    const sizes = [0.5, 1, 1.5, 2].map((s) => iconHintFontSize(iconSizeAt(s)));
    expect(sizes[0]).toBeLessThan(sizes[1] as number);
    expect(sizes[1]).toBeLessThan(sizes[2] as number);
    expect(sizes[2]).toBeLessThan(sizes[3] as number);
    /** 1 倍时就是老版角标的 9px（`e64eb2d` 的 `cornerSize`）。 */
    expect(iconHintFontSize(BASE_ICON_SIZE)).toBe(BASE_HINT_FONT);
  });

  it('⚠️ 缩到 0.5 时仍有**规则给出的下限**（不是算完再夹）', () => {
    const font = iconHintFontSize(iconSizeAt(0.5));
    /** 按比例算出来是 5（9 × 0.5 = 4.5 → 5，角标比并排更小、更早触底），下限是 8。 */
    expect(Math.round(BASE_HINT_FONT * 0.5)).toBeLessThan(MIN_HINT_FONT);
    expect(font).toBe(MIN_HINT_FONT);
    /** 而且下限**只在缩放 < 0.9 时生效**：1 倍仍然走 9。 */
    expect(iconHintFontSize(iconSizeAt(1))).toBeGreaterThan(MIN_HINT_FONT);
  });

  it('落位仍然只有一条规则（缩放不改"往左上各偏一点"）', () => {
    for (const scale of [0.5, 1, 2]) {
      const size = iconSizeAt(scale);
      const icon = { x: LOGICAL.width - 8 - size, y: 8, w: size, h: size };
      const hint = iconHintBoxSize('F1', size);
      const p = iconHintPlacement(
        { icon, canvasW: LOGICAL.width, canvasH: LOGICAL.height },
        hint.w,
        hint.h,
      );
      const tag = `scale=${scale}`;
      expect(p.x, tag).toBe(icon.x - iconHintShift(size));
      expect(p.y, tag).toBe(icon.y - iconHintRise(size));
    }
  });
});

/**
 * ==================================================================
 * 焦点上下文：**列数按当前这一屏**、格子数封顶在容量上
 * ==================================================================
 *
 * 这两条各有一次真实的 bug 形态（见 `panelFocus` 文件头）：
 * 触屏按 `↓` 斜着跳、以及"焦点停在画不出来的格子上"。
 */
describe('焦点上下文：列数 / 容量跟着当前这一屏', () => {
  const rows = Array.from({ length: 8 }, (_, i) => `s${i}`);
  const build = (showKeyHints: boolean) =>
    buildFocusContext({
      rows,
      metrics: keyGridMetrics(showKeyHints),
      hasGrid: true,
      hasPicker: false,
      hasMode: false,
      hasSlider: false,
      tabCount: 2,
      selectedSlot: undefined,
    });

  it('桌面：4 列 × 2 行 = 8 格，8 个技能**全部**可聚焦', () => {
    const ctx = build(true);
    expect(ctx.gridCols).toBe(KEY_GRID.cols);
    expect(ctx.cellCount).toBe(8);
    expect(rowsCapacity(keyGridMetrics(true))).toBe(8);
  });

  it('触屏：3 列 6 格 —— 焦点不会走到画不出来的第 7、8 格', () => {
    const ctx = build(false);
    expect(ctx.gridCols).toBe(TOUCH_GRID_COLS);
    expect(ctx.cellCount).toBe(6);
  });

  it('技能比格子多时，cellCount 封顶在容量上（不"对空气改键"）', () => {
    const many = buildFocusContext({
      rows: Array.from({ length: 40 }, (_, i) => `s${i}`),
      metrics: keyGridMetrics(true),
      hasGrid: true,
      hasPicker: false,
      hasMode: false,
      hasSlider: false,
      tabCount: 2,
      selectedSlot: undefined,
    });
    expect(many.cellCount).toBe(rowsCapacity(keyGridMetrics(true)));
  });
});
