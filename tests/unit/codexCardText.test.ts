import { describe, expect, it } from 'vitest';

import { CODEX_LINE_H, cardTextPlan } from '../../src/ui/codexLogic';

/**
 * **图鉴卡片里三行字怎么排**（2026-10-22，用户："卡片可以高一点，写不下的
 * 可以换行"）。
 *
 * 判据是**卡片高度**：它变了（比如以后再加一行），行数要跟着变，而不是
 * 把 `maxLines` 硬编码在渲染里 ✗。所以这里钉的是**推导**：
 *
 * ```
 *   名字      顶 + 10，占 24
 *   条件      贴底（够高 2 行，否则 1 行）
 *   说明      吃剩余（1~4 行）
 * ```
 */
describe('cardTextPlan：按卡片高度算行数', () => {
  it('148（当前布局）⇒ 说明 3 行、条件 2 行', () => {
    const plan = cardTextPlan(148);
    expect(plan.descLines).toBe(3);
    expect(plan.condLines).toBe(2);
  });

  it('矮卡片（< 140）⇒ 条件只给 1 行，说明跟着变少', () => {
    const plan = cardTextPlan(120);
    expect(plan.condLines).toBe(1);
    expect(plan.descLines).toBeGreaterThanOrEqual(1);
  });

  it('很高 ⇒ 说明最多 4 行（不无限吃高）', () => {
    expect(cardTextPlan(260).descLines).toBe(4);
  });

  it('三块**互不重叠**（名字底 ≤ 说明顶、说明底 ≤ 条件顶）', () => {
    for (const h of [120, 148, 180, 260]) {
      const plan = cardTextPlan(h);
      const nameBottom = plan.nameY + 12;
      const descTop = plan.descY - (plan.descLines * CODEX_LINE_H) / 2;
      const descBottom = plan.descY + (plan.descLines * CODEX_LINE_H) / 2;
      const condTop = plan.condY - (plan.condLines * CODEX_LINE_H) / 2;
      expect(nameBottom, `h=${h}`).toBeLessThanOrEqual(descTop);
      expect(descBottom, `h=${h}`).toBeLessThanOrEqual(condTop);
    }
  });

  it('三块都在卡片之内（条件不越过下沿）', () => {
    const h = 148;
    const plan = cardTextPlan(h);
    expect(plan.condY + (plan.condLines * CODEX_LINE_H) / 2).toBeLessThanOrEqual(h);
  });
});
