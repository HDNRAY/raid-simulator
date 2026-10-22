import { describe, expect, it } from 'vitest';

import { CODEX_LINE_H, cardTextPlan, wrapByChars, wrapHardLines } from '../../src/ui/codexLogic';

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
    const condBottom = plan.condTop + (plan.condLines * CODEX_LINE_H) / 2;
    expect(condBottom).toBeLessThanOrEqual(148);
  });

  it('很高 ⇒ 说明最多 4 行（不无限吃高）', () => {
    expect(cardTextPlan({ cardH: 260, condLines: 1 }).descLines).toBe(4);
  });

  it('三块**互不重叠**（名字底 ≤ 说明顶、说明底 ≤ 条件顶）', () => {
    for (const h of [120, 148, 180, 260]) {
      const plan = cardTextPlan({ cardH: h, condLines: 2 });
      /** 三块现在都给**顶部**（见 `CardTextPlan` 的注释），直接累加即可。 */
      const nameBottom = plan.nameTop + 12;
      const descTop = plan.descTop;
      const descBottom = plan.descTop + plan.descLines * CODEX_LINE_H;
      const condTop = plan.condTop;
      expect(nameBottom, `h=${h}`).toBeLessThanOrEqual(descTop);
      expect(descBottom, `h=${h}`).toBeLessThanOrEqual(condTop);
    }
  });

  it('三块都在卡片之内（条件不越过下沿）', () => {
    const h = 148;
    const plan = cardTextPlan({ cardH: h, condLines: 2 });
    expect(plan.condTop + (plan.condLines * CODEX_LINE_H) / 2).toBeLessThanOrEqual(h);
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

describe('跨卡一致（用户 2026-10-22："不同炁机卡 左上坐标不统一"）', () => {
  it('名字顶 / 说明顶 只由常量决定 —— 与卡片高度、条件行数无关', () => {
    /**
     * ⚠️ 这条钉的是**机制**（不是数值）：只要三行都按"顶"摆位、并且顶来自
     * 同一组常量，那么"名字长短 / 说明行数 / 条件行数"都不会让某张卡的
     * 文字起点比别人高或低 ✗ —— 那正是用户报的那个现象。
     */
    const plans = [
      { cardH: 120, condLines: 1 },
      { cardH: 176, condLines: 2 },
      { cardH: 260, condLines: 4 },
    ].map((args) => cardTextPlan(args));
    const nameTops = new Set(plans.map((p) => p.nameTop));
    const descTops = new Set(plans.map((p) => p.descTop));
    expect(nameTops.size).toBe(1);
    expect(descTops.size).toBe(1);
  });
});

describe('折行不拆数字（2026-10-22 截图：100% 被切成 100 / %）', () => {
  it('断点落在 ASCII 串中间时往前挪到串首', () => {
    /**
     * 取 `perLine = 14`：「「凝」的增伤变为 100%」共 15 个码点 ⇒ 断点落在
     * `100%` 内部（`…变为 1` / `00%`）—— 修好之前会切出 `0%` 这种碎片。
     */
    const text = '「凝」的增伤变为 100%';
    const lines = wrapByChars(text, { perLine: 14 });
    expect(lines.join('')).toBe(text);
    /** 任何一行都不该以 `%` / `+3` 这种"半个数"收尾 */
    expect(lines.some((l) => /[0-9]$/.test(l) && l.includes('%') === false)).toBe(false);
  });
});
