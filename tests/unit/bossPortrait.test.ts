import { describe, expect, it } from 'vitest';
import { bossPortraitBox, bossPortraitCenter } from '../../src/render/hud/bossHeader';
import { LAYOUT } from '../../src/ui/layout';

/**
 * 2026-10-22 用户："boss 的头像在战斗界面，好像占的位置有点太大了···盖住了血条，
 * 顶住了视图顶部"。
 *
 * 这两条是**不变量**：头像矩形压在血条上 / 越过上边距，都该在这里红。
 * ⚠️ 断言全部从 `LAYOUT` 取数（改布局不会假红），不写死像素。
 */
describe('Boss 顶栏头像的几何', () => {
  it('头像下端不压血条（矩形不相交）', () => {
    const box = bossPortraitBox();
    const center = bossPortraitCenter();
    const top = center.y - box / 2;
    const bottom = center.y + box / 2;
    expect(bottom).toBeLessThanOrEqual(LAYOUT.bossHp.y);
    expect(top).toBeGreaterThan(LAYOUT.bossBar.y - 1);
  });

  it('头像不越过上边距（y >= 顶栏上沿）', () => {
    const box = bossPortraitBox();
    const center = bossPortraitCenter();
    expect(center.y - box / 2).toBeGreaterThanOrEqual(LAYOUT.bossBar.y);
  });

  it('边长由"血条上沿 − 顶栏上沿"给出上限（不是硬编码）', () => {
    const available = LAYOUT.bossHp.y - LAYOUT.bossBar.y - 2;
    expect(bossPortraitBox()).toBeLessThanOrEqual(available);
  });
});
