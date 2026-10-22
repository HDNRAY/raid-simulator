import { beforeAll, describe, expect, it } from 'vitest';
import { Application, Container, Graphics, Sprite, Text } from 'pixi.js';
import { RichLine } from '../../src/ui/richLine';
import { PALETTE } from '../../src/render/theme';
import { stubCanvas2d } from './canvas2dStub';

beforeAll(() => {
  stubCanvas2d();
});

/**
 * **真 pixi**（web project）：证明"数字真的被画成了另一个颜色"。
 *
 * ⚠️ 纯逻辑那边（`tests/unit/richLine.test.ts`）只能证明 `splitRuns` 切得对；
 * "切出来的段**用哪个颜色**"必须看渲染层 —— 也就是这里。之前 `**…**`
 * 被 `stripEmphasis` 抹平，数字与正文同色，正是**只有截图能看出来**的那类 bug ✗。
 */

const pixi = { Application, Container, Graphics, Sprite, Text };

/**
 * Pixi 把颜色统一成 `'#rrggbb'` 字符串，而 `PALETTE` 里是数字 ⇒ 比较前先归一到
 * 同一个写法（否则会得到 `expected '#e4a840' to be 14985280` 这种假失败 ✗）。
 */
function hexOf(value: unknown): string {
  if (typeof value === 'number') return `#${value.toString(16).padStart(6, '0')}`;
  return String(value).toLowerCase();
}

function fillsOf(root: Container): { text: string; fill: unknown }[] {
  const out: { text: string; fill: unknown }[] = [];
  for (const child of root.children) {
    if (child instanceof Text) out.push({ text: child.text, fill: child.style.fill });
  }
  return out;
}

describe('RichLine 渲染（数字用强调色）', () => {
  it('`**20**` 那一段是强调色，其余是正文色', () => {
    const line = new RichLine({
      pixi,
      size: 13,
      baseColor: PALETTE.textDim,
      emphasisColor: PALETTE.douqi.base,
    });
    line.layout(['缠低于**20**时，每**5**秒回**10**缠'], 100, 0, 20);
    const fills = fillsOf(line.root);
    const numbers = fills.filter((f) => ['20', '5', '10'].includes(f.text));
    expect(numbers.length).toBe(3);
    for (const n of numbers) expect(hexOf(n.fill)).toBe(hexOf(PALETTE.douqi.base));
    const prose = fills.filter((f) => f.text.includes('缠低于'));
    expect(prose.length).toBe(1);
    expect(hexOf(prose[0]?.fill)).toBe(hexOf(PALETTE.textDim));
  });

  it('居中：整行宽度被平移到 x 两侧（不是每段各自居中）', () => {
    const line = new RichLine({
      pixi,
      size: 13,
      baseColor: PALETTE.textDim,
      emphasisColor: PALETTE.douqi.base,
      align: 'center',
    });
    line.layout(['甲**乙**丙'], 300, 0, 20);
    const texts = line.root.children.filter((c): c is Text => c instanceof Text);
    const first = texts[0];
    expect(first?.x ?? 0).toBeLessThan(300);
    /** 段与段不重叠：后一段的 x ≥ 前一段的 x + 前一段宽 */
    for (let i = 1; i < texts.length; i += 1) {
      const prev = texts[i - 1];
      const cur = texts[i];
      expect(cur?.x ?? 0).toBeGreaterThanOrEqual((prev?.x ?? 0) + (prev?.width ?? 0) - 0.01);
    }
  });
});
