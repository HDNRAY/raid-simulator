import { describe, expect, it } from 'vitest';

import { ALL_QIJI } from '../../src/data/qiji';
import { CODEX_LAYOUT, codexCardRects } from '../../src/ui/codexLogic';
import { codexEntriesOf } from '../../src/app/codexEntries';

/**
 * **图鉴的纯逻辑**（2026-10-20）。
 *
 * 用户口径："图鉴按钮，目前暂时所有的**已解锁**炁机（未解锁的**保持 UI**
 * 然后内容 **？？？**）" + "开发模式，显示所有炁机"。
 *
 * ⚠️ 这里不钉"哪几条已解锁"（那是 `unlock.ts` 的事、会随条件变）——
 * 钉的是**三种输入下条目的形状**：无统计 / 开发模式 / 顺序。
 */

/** 测试里用的"解锁条件 → 人话"（这层的形状与 `app/unlockText` 无关）。 */
const stubUnlockText = (unlock: { readonly kind: string }): string => `条件:${unlock.kind}`;

describe('图鉴条目：已解锁的露名字，未解锁的 ？？？', () => {
  it('没有进行中的一局（无统计）⇒ 只认 `unlock: always` 的那几条', () => {
    const entries = codexEntriesOf({ pool: ALL_QIJI, stats: undefined, devMode: false, unlockText: stubUnlockText });
    expect(entries).toHaveLength(ALL_QIJI.length);

    const always = ALL_QIJI.filter((qiji) => qiji.unlock.kind === 'always').map((q) => q.id);
    expect(always.length, '池子里必须有常驻解锁的炁机').toBeGreaterThan(0);

    for (const entry of entries) {
      const shouldShow = always.includes(entry.id);
      expect(entry.unlocked, entry.id).toBe(shouldShow);
      expect(entry.nameKey === undefined, entry.id).toBe(!shouldShow);
    }
  });

  it('**开发模式** ⇒ 全部显示名字与说明（但"未解锁"这个状态仍然是真话）', () => {
    const entries = codexEntriesOf({ pool: ALL_QIJI, stats: undefined, devMode: true, unlockText: stubUnlockText });
    for (const entry of entries) {
      expect(entry.nameKey, entry.id).toBeDefined();
      expect(entry.descKey, entry.id).toBeDefined();
    }
    /** 未解锁的那些仍然 `unlocked: false` —— 图鉴只是"看得到"，不是"解锁了"。 */
    expect(entries.some((entry) => !entry.unlocked)).toBe(true);
  });

  it('顺序 = 池子顺序（图鉴不做排序，排序是池子的事）', () => {
    const entries = codexEntriesOf({
      pool: ALL_QIJI,
      stats: undefined,
      devMode: true,
      unlockText: stubUnlockText,
    });
    expect(entries.map((entry) => entry.id)).toEqual(ALL_QIJI.map((qiji) => qiji.id));
  });
});

describe('图鉴几何：卡片网格', () => {
  it('每张卡片都在画布内、互不重叠', () => {
    const rects = codexCardRects(ALL_QIJI.length);
    expect(rects).toHaveLength(ALL_QIJI.length);
    for (const rect of rects) {
      expect(rect.x).toBeGreaterThanOrEqual(0);
      expect(rect.y).toBeGreaterThanOrEqual(0);
      expect(rect.x + rect.w).toBeLessThanOrEqual(CODEX_LAYOUT.width);
      expect(rect.y + rect.h).toBeLessThanOrEqual(CODEX_LAYOUT.height);
    }
    for (let i = 0; i < rects.length; i += 1) {
      for (let j = i + 1; j < rects.length; j += 1) {
        const a = rects[i];
        const b = rects[j];
        if (a === undefined || b === undefined) continue;
        const overlapX = a.x < b.x + b.w && b.x < a.x + a.w;
        const overlapY = a.y < b.y + b.h && b.y < a.y + a.h;
        expect(overlapX && overlapY, `第 ${i} 与第 ${j} 张重叠`).toBe(false);
      }
    }
  });

  it('条数少时也居中（不会堆在左上角）', () => {
    const one = codexCardRects(1)[0];
    const all = codexCardRects(ALL_QIJI.length);
    expect(one).toBeDefined();
    expect(all.length).toBe(ALL_QIJI.length);
    if (one === undefined) return;
    /** 只有一张时它的水平中心 = 画布中心。 */
    expect(one.x + one.w / 2).toBeCloseTo(CODEX_LAYOUT.width / 2, 0);
  });
});
