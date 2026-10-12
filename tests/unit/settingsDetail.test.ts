import { describe, expect, it } from 'vitest';
import { wrapText } from '../../src/ui/settings/wrapText';
import { slotLookOf, slotStateOf } from '../../src/render/slotLook';
import { PALETTE } from '../../src/render/theme';
import { BLOCK_KEYS, type SkillSlotView } from '../../src/render/viewModel';
import {
  SETTINGS_PANEL,
  SKILL_DETAIL,
  DETAIL_TOP,
  DETAIL_BOTTOM,
} from '../../src/ui/settings/settingsGeometry';
import { skillDetailContentRect, skillDetailViewport } from '../../src/ui/settings/keyGridLayout';
import { DESC_MAX_LINES, contentRowVisible } from '../../src/ui/settings/detailWindow';
import { flattenCatalog } from '../../src/i18n/translator';
import { zhCN } from '../../src/i18n/locales/zh-CN';
import { resetButtonRect, touchResetButtonRect } from '../../src/ui/settings/logic';
import { TOUCH_PREVIEW } from '../../src/ui/settings/settingsGeometry';

/**
 * 这一轮（2026-10-12）新抽出来的三块**纯逻辑**：详情区的滚动/颜色/恢复默认。
 *
 * ⚠️ 它们都不碰 Pixi，所以能在 node 里精确测 —— 这也正是把它们抽出来的
 * 理由（jsdom 里跑不动真 Pixi，见 `ui/settings/logic.ts` 文件头）。
 */

describe('⑤ 触屏圆钮与技能栏共用同一套槽位配色（唯一真相）', () => {
  /** 造一个槽位视图（只填被 `slotStateOf` 读的字段）。 */
  function slot(over: Partial<SkillSlotView> = {}): SkillSlotView {
    return {
      index: 0,
      key: 'q',
      skillId: 'attack',
      nameKey: 'skill.attack.name',
      icon: '斩',
      usable: true,
      cooldownRatio: 0,
      cooldownSec: 0,
      skillCdSec: 0,
      comboReady: false,
      ...over,
    };
  }

  it('状态判据只有一条：usable / blockedKey / cooldownRatio', () => {
    expect(slotStateOf(slot())).toBe('ready');
    expect(slotStateOf(slot({ usable: false, blockedKey: BLOCK_KEYS.cost }))).toBe('blocked');
    expect(slotStateOf(slot({ usable: false, cooldownRatio: 0.5 }))).toBe('cooldown');
    expect(slotStateOf(slot({ usable: false }))).toBe('waiting');
  });

  it('【关键】"又买不起、又在冷却" → 仍然是 blocked（先判资源）', () => {
    /**
     * 与 `app/slotViews.ts` 算 `blockedKey` 的先后一致（那里也是先资源、
     * 后冷却）。顺序反了的话，"买不起"会被画成"只是冷却"——那一档更亮，
     * 玩家以为能按。
     */
    expect(slotStateOf(slot({ usable: false, blockedKey: BLOCK_KEYS.cost, cooldownRatio: 0.5 }))).toBe(
      'blocked',
    );
  });

  it('色号**只有** `PALETTE.slot` 一个来源（四档同色相，只差明暗）', () => {
    const ready = slotLookOf(slot());
    const blocked = slotLookOf(slot({ usable: false, blockedKey: BLOCK_KEYS.cost }));
    expect(ready.fill).toBe(PALETTE.slot.ready);
    expect(blocked.fill).toBe(PALETTE.slot.blocked);
    /** 亮度单调：可用 > 读条中 > 买不起（拿 RGB 之和比）。 */
    const lum = (n: number): number => ((n >> 16) & 0xff) + ((n >> 8) & 0xff) + (n & 0xff);
    const waiting = slotLookOf(slot({ usable: false }));
    expect(lum(ready.fill)).toBeGreaterThan(lum(waiting.fill));
    expect(lum(waiting.fill)).toBeGreaterThan(lum(blocked.fill));
  });

  it('【关键】买不起时**字反而提亮**（不许被底色压到看不清）', () => {
    /**
     * 技能栏那一档的做法：底色说"用不了"，字换成压在暗底上仍读得出的中灰
     * （`PALETTE.slot.blockedGlyph`）—— 玩家在买不起时仍要认出这是哪个技能。
     */
    expect(slotLookOf(slot({ usable: false, blockedKey: BLOCK_KEYS.cost })).glyph).toBe(
      PALETTE.slot.blockedGlyph,
    );
    /** 代价数字也跟着压灰（否则"底色说用不了、数字说没问题"）。 */
    expect(slotLookOf(slot({ usable: false, blockedKey: BLOCK_KEYS.cost })).costDimmed).toBe(true);
    expect(slotLookOf(slot()).costDimmed).toBe(false);
  });

  it('快照里没有这一格 → 最暗那档（不是留上一个状态的亮色）', () => {
    expect(slotLookOf(undefined).fill).toBe(PALETTE.slot.blocked);
  });
});

describe('⑥ 两块各自的「恢复默认」（用户 2026-10-12 二次定案）', () => {
  /**
   * ⚠️ 上一版是"**一个**按钮 + 按设备分流"（`resetButton.resetTargetFor`），
   * 那个纯函数随这一轮**删掉了**：探测故意偏保守，于是触屏笔记本上
   * 键盘键位恢复不了（用户报的正是它）。
   *
   * 现在"恢复什么"由"**点在哪个块里的按钮**"决定 —— 两件事都是结构性的：
   *
   *   键盘块（`resetButtonRect`）      → `settings.keysReset`  / `keysResetDone`
   *   触屏块（`touchResetButtonRect`） → `settings.touchReset` / `touchResetDone`
   *
   * 所以这里守两条：**位置**（两个不相交的矩形）与**文案来源**（i18n key）。
   */
  it('两个恢复按钮在**各自那块配置旁**（矩形不相交）', () => {
    const a = resetButtonRect();
    const b = touchResetButtonRect();
    const overlap = a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
    expect(overlap).toBe(false);
  });

  it('触屏那个按钮贴在键位预览块下方（不与预览重叠）', () => {
    const b = touchResetButtonRect();
    const previewBottom = SETTINGS_PANEL.y + TOUCH_PREVIEW.top + TOUCH_PREVIEW.h;
    expect(b.y).toBeGreaterThanOrEqual(previewBottom);
  });

  it('两条 i18n key **都还在**、而且文案不同（两块各自一套）', () => {
    const keys = flattenCatalog(zhCN);
    expect(keys.get('settings.keysReset')).toBeTruthy();
    expect(keys.get('settings.touchReset')).toBeTruthy();
    expect(keys.get('settings.keysReset')).not.toBe(keys.get('settings.touchReset'));
    expect(keys.get('settings.keysResetDone')).not.toBe(keys.get('settings.touchResetDone'));
  });
});

describe('② 说明换行（按像素折行，中文没有空格）', () => {
  /** 每个字固定 10px 的假测量 —— 折行逻辑与字体无关。 */
  const measure = (s: string): number => [...s].length * 10;

  it('放得下就一行', () => {
    expect(wrapText({ text: '普通攻击', width: 100, measure })).toEqual(['普通攻击']);
  });

  it('放不下就折行，且**一个字都不丢**', () => {
    const text = '普通攻击造成十点伤害并使目标易伤';
    const lines = wrapText({ text, width: 50, measure });
    expect(lines.length).toBeGreaterThan(1);
    expect(lines.join('')).toBe(text);
  });

  it('每行都不超过给定宽度', () => {
    const text = '普通攻击造成十点伤害并使目标易伤持续三十秒';
    for (const line of wrapText({ text, width: 70, measure })) {
      expect(measure(line)).toBeLessThanOrEqual(70);
    }
  });

  it('`maxLines` 之外的**丢掉**（详情区另有"还能往下滚"的提示）', () => {
    const lines = wrapText({ text: '一二三四五六七八九十', width: 30, measure, maxLines: 2 });
    expect(lines.length).toBe(2);
  });

  it('空文本与非法宽度都不炸（几何一开始没算出来时）', () => {
    expect(wrapText({ text: '', width: 100, measure })).toEqual([]);
    expect(wrapText({ text: '一二三', width: 0, measure })).toEqual(['一二三']);
    expect(wrapText({ text: '一二三', width: Number.NaN, measure })).toEqual(['一二三']);
  });
});

describe('② 详情区的可视范围（"格阵下沿..提示行上沿"那一段）', () => {
  it('可视矩形在格阵之下、提示行之上', () => {
    const vp = skillDetailViewport();
    expect(vp.y).toBe(DETAIL_TOP);
    /**
     * ⚠️ `DETAIL_BOTTOM` / `DETAIL_TOP` 是**面板相对**的，而可视矩形是
     * **画布坐标** —— 差一个 `SETTINGS_PANEL.y`。混起来正是这一轮踩过的
     * 坑（详情区被算成比实际高 10px）。
     */
    expect(vp.y + vp.h).toBeLessThanOrEqual(SETTINGS_PANEL.y + DETAIL_BOTTOM);
    expect(vp.w).toBe(SKILL_DETAIL.w);
  });

  it('⚠️ 文字内框 = 外框减 `SKILL_DETAIL.padding`（四周各一圈）', () => {
    /**
     * 用户 2026-10-12："技能 说明 加一点点padding"。
     *
     * ⚠️ padding **不是绘制时挪一下**：折行宽度与可见行数都要从**内框**算
     * （见下面两条）。
     */
    const outer = skillDetailViewport();
    const inner = skillDetailContentRect();
    const pad = SKILL_DETAIL.padding;
    expect(pad).toBeGreaterThan(0);
    expect(inner.x).toBe(outer.x + pad);
    expect(inner.y).toBe(outer.y + pad);
    expect(inner.w).toBe(outer.w - pad * 2);
    expect(inner.h).toBe(outer.h - pad * 2);
  });

  it('⚠️ 折行宽度用**内框**：一段"旧宽放得下、新宽放不下"的文字会多折一行', () => {
    /**
     * 每个字固定 10px 的假测量（折行逻辑与字体无关）。
     *
     * 38 字 = 380px：**外框**宽下（400 - 10 让位 = 390）是一行，
     * **内框**宽下（384 - 10 = 374）必须折成两行 —— 若 padding 没进折行
     * 数学，这里就会是 1 行，而画面上的长行会压到右边框上。
     */
    const measure = (v: string): number => [...v].length * 10;
    const text = '啊'.repeat(38);
    const inner = skillDetailContentRect();
    expect(wrapText({ text, width: inner.w - 10, measure })).toHaveLength(2);
    /** 而且每一行都**不超内框宽**（10px 让位是给滚动条的）。 */
    for (const line of wrapText({ text, width: inner.w - 10, measure })) {
      expect(measure(line)).toBeLessThanOrEqual(inner.w - 10);
    }
  });

  it('⚠️ 可见行数用**内框**高 —— 滚到底时最后一行不会被 padding 裁掉', () => {
    /**
     * 行高 22（`SkillDetail.LINE_H`；那边注释里写着为什么是 22）。
     *
     * 不变量：`可见行数 × 行高 ≤ 内框高` —— 滚到底（`offset = total - rows`）
     * 时最后一行的下沿正好落在内框底边上，不多不少。
     * ⚠️ 若有人拿**外框**高算行数，这个不等式就会破（那一行被画到
     * padding 里 / 被裁掉）。
     */
    const LINE_H = 22;
    const inner = skillDetailContentRect();
    const outer = skillDetailViewport();
    const rowsInner = Math.floor(inner.h / LINE_H);
    expect(rowsInner * LINE_H).toBeLessThanOrEqual(inner.h);
    /** 外框算出来的行数**确实更多**（否则这条断言没有意义）。 */
    const rowsOuter = Math.floor(outer.h / LINE_H);
    expect(rowsOuter).toBeGreaterThan(rowsInner);
    expect(rowsOuter * LINE_H).toBeGreaterThan(inner.h);
  });

  it('高度**够滚**（至少 3 行文字；否则说明会被截断）', () => {
    /**
     * ⚠️ 这是"说明换行 + 可滚"能成立的前提：可视高若小于 3 行，长说明
     * 只能看到一行 —— 而那正是用户报的那个问题（截断）。
     */
    expect(skillDetailViewport().h).toBeGreaterThanOrEqual(22 * 3);
  });
});

/**
 * ==================================================================
 * ③ `maxLines` **放开**（用户 2026-10-12 原话："放开"）
 * ==================================================================
 *
 * ⚠️ 这一组的**唯一**目的：钉住"滚动真的可达"这件事。
 *
 * 修之前是 `maxLines = min(DESC_MAX_LINES, viewRows() - 2)`，而内容总行数
 * 是 `1 + 说明行数 + 1` ⇒ `total ≤ viewRows()` **结构上恒成立**
 * ⇒ `scrollable()` 永为假 ⇒ 滚轮 / 拖拽 / 滚动条 / 方向提示**全不可达**，
 * 超长说明只是被**静默截断**。
 *
 * 只有纯算术能测（`SkillDetail` 是 Pixi 组件，jsdom 里画不出来），
 * 所以判据放在 `detailWindow` 那两个导出上 —— 与 `render` 用的是**同一份**。
 */
describe('③ 放开 `maxLines`：长说明真的能滚', () => {
  /** 行高 22（`SkillDetail.LINE_H`；理由写在那边）。 */
  const LINE_H = 22;
  const inner = skillDetailContentRect();
  const rows = Math.max(1, Math.floor(inner.h / LINE_H));
  /** 每个字固定 10px（折行只看宽度，与字体无关）。 */
  const measure = (v: string): number => [...v].length * 10;
  /** 一行装得下几个字（内框宽减去给滚动条的让位）。 */
  const perLine = Math.floor((inner.w - 10) / 10);
  const width = inner.w - 10;

  it('【关键·回归】长说明的 `total` **可以**超过一屏 —— 旧代码结构上不可能', () => {
    /** 折满 `DESC_MAX_LINES` 都装不下的长文案（这里再多一行）。 */
    const long = '啊'.repeat(perLine * (DESC_MAX_LINES + 1));
    const lines = wrapText({ text: long, width, measure, maxLines: DESC_MAX_LINES });
    expect(lines).toHaveLength(DESC_MAX_LINES);

    /** 现在：`total > rows` ⇒ `scrollable()` 为真 ⇒ 那四样开始工作。 */
    expect(1 + lines.length + 1).toBeGreaterThan(rows);

    /**
     * ⚠️ **反证**（这条才是回归测试）：旧的钳位 `rows - 2` 下，
     * `total` 永远不超过 `rows` —— 无论说明多长。若哪天有人把钳位加回来，
     * 上面那条断言会挂，而这条会告诉你"为什么它曾经不可达"。
     */
    const oldMax = Math.max(1, Math.min(DESC_MAX_LINES, rows - 2));
    const oldLines = wrapText({ text: long, width, measure, maxLines: oldMax });
    expect(1 + oldLines.length + 1).toBeLessThanOrEqual(rows);
  });

  it('短说明照旧**不滚**（`total ≤ rows` —— 滚不动就不画滚动条）', () => {
    const short = '普通攻击，造成 10 点伤害。';
    const lines = wrapText({ text: short, width, measure, maxLines: DESC_MAX_LINES });
    expect(1 + lines.length + 1).toBeLessThanOrEqual(rows);
  });

  it('裁剪窗口 = `[offset, offset + rows)`（窗口外的行不画）', () => {
    /** 滚到顶：第 0 .. rows-1 行可见。 */
    expect(contentRowVisible(0, 0, rows)).toBe(true);
    expect(contentRowVisible(rows - 1, 0, rows)).toBe(true);
    /** ⚠️ 第 `rows` 行的上沿落在可视底边**之外** —— 算它可见就会画出区外。 */
    expect(contentRowVisible(rows, 0, rows)).toBe(false);
    /** 滚到中间：窗口**上方**的行看不见（它们已被移出详情区）。 */
    expect(contentRowVisible(0, 3, rows)).toBe(false);
    expect(contentRowVisible(3, 3, rows)).toBe(true);
  });

  it('【关键】滚到底（`offset = total - rows`）时**最后一行完整可见**', () => {
    const total = rows + 12;
    const offset = total - rows;
    const last = total - 1;
    expect(contentRowVisible(last, offset, rows)).toBe(true);
    /** 它正好是窗口的最后一行 —— 下沿贴内框底边，不多不少。 */
    expect(last).toBe(offset + rows - 1);
    /** 而"整整一屏"确实装得进内框（padding 数学复核）。 */
    expect(rows * LINE_H).toBeLessThanOrEqual(inner.h);
  });
});
