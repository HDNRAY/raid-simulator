import { describe, expect, it } from 'vitest';
import { resetDoneKey, resetLabelKey, resetTargetFor } from '../../src/ui/settings/resetButton';
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
import { skillDetailViewport } from '../../src/ui/settings/keyGridLayout';

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

describe('⑥ 唯一的「恢复默认」按设备分流（用户 2026-10-12 定案）', () => {
  it('触屏 → 触屏键位；非触屏 → 键盘键位', () => {
    expect(resetTargetFor(true)).toBe('touch');
    expect(resetTargetFor(false)).toBe('keys');
  });

  it('文案与通知都按目标取 **i18n key**（渲染层不硬编码）', () => {
    expect(resetLabelKey('keys')).toBe('settings.keysReset');
    expect(resetLabelKey('touch')).toBe('settings.touchReset');
    expect(resetDoneKey('keys')).toBe('settings.keysResetDone');
    expect(resetDoneKey('touch')).toBe('settings.touchResetDone');
  });

  it('两条 i18n key **都还在**（功能都保留，只是不同时出现）', () => {
    expect(resetLabelKey('keys')).not.toBe(resetLabelKey('touch'));
    expect(resetDoneKey('keys')).not.toBe(resetDoneKey('touch'));
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

  it('高度**够滚**（至少 3 行文字；否则说明会被截断）', () => {
    /**
     * ⚠️ 这是"说明换行 + 可滚"能成立的前提：可视高若小于 3 行，长说明
     * 只能看到一行 —— 而那正是用户报的那个问题（截断）。
     */
    expect(skillDetailViewport().h).toBeGreaterThanOrEqual(22 * 3);
  });
});
