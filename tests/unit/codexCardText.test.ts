import { describe, expect, it } from 'vitest';

import { CODEX_LINE_H, cardTextPlan, wrapHardLines } from '../../src/ui/codexLogic';

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
  it('148 + 条件 2 行 ⇒ 说明 3 行', () => {
    const plan = cardTextPlan({ cardH: 148, condLines: 2 });
    expect(plan.descLines).toBe(3);
    expect(plan.condLines).toBe(2);
  });

  it('⚠️ 条件行数由**内容**决定（传入几行就是几行）', () => {
    expect(cardTextPlan({ cardH: 148, condLines: 4 }).condLines).toBe(4);
    expect(cardTextPlan({ cardH: 148, condLines: 1 }).condLines).toBe(1);
  });

  it('⚠️ 条件多 ⇒ 说明被挤掉（可以是 0 行），而不是压到条件上', () => {
    const plan = cardTextPlan({ cardH: 148, condLines: 5 });
    expect(plan.descLines).toBe(0);
    /** 条件块仍然贴底：它的下沿 = 卡片底 − 内边距。 */
    const condBottom = plan.condY + (plan.condLines * CODEX_LINE_H) / 2;
    expect(condBottom).toBeLessThanOrEqual(148);
  });

  it('很高 ⇒ 说明最多 4 行（不无限吃高）', () => {
    expect(cardTextPlan({ cardH: 260, condLines: 1 }).descLines).toBe(4);
  });

  it('三块**互不重叠**（名字底 ≤ 说明顶、说明底 ≤ 条件顶）', () => {
    for (const h of [120, 148, 180, 260]) {
      const plan = cardTextPlan({ cardH: h, condLines: 2 });
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
    const plan = cardTextPlan({ cardH: h, condLines: 2 });
    expect(plan.condY + (plan.condLines * CODEX_LINE_H) / 2).toBeLessThanOrEqual(h);
  });
});

describe('wrapHardLines：先按硬换行分段，再按宽度折（不限行）', () => {
  it('「解锁条件\n正文」⇒ 前缀单独一行，正文折行', () => {
    const lines = wrapHardLines('解锁条件\n局内用「斩」3 次、局内用「凝」3 次', 6);
    expect(lines[0]).toBe('解锁条件');
    expect(lines.length).toBeGreaterThan(1);
    /** ⚠️ **不省略**：所有字都在（拼回去等于原文去掉换行 —— 空格保留，只去掉 `\n`）。 */
    expect(lines.join('')).toBe('解锁条件局内用「斩」3 次、局内用「凝」3 次');
  });

  it('空段被跳过（文案里有多余空行时不会画出空行）', () => {
    expect([...wrapHardLines('a\n\nb', 10)]).toEqual(['a', 'b']);
  });
});
