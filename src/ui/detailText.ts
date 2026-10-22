/**
 * **详情区正文的"文本"那一半**（2026-10-22，从 `prepareDetailPanel.ts` 切出）。
 *
 * ==================================================================
 * 为什么切（AGENTS.md §3：先拆 util，不压注释）
 * ==================================================================
 *
 * `prepareDetailPanel.ts` 到了 **712 行**（上限 700），而它混的三件事里有一件
 * 是**纯文本**的：
 *
 * | 那一半 | 一句话 |
 * |---|---|
 * | `prepareDetailPanel` | 摆位 / 画 / 滚动驱动 |
 * | **本文件** | 一行该显示什么字、估多高、实测高怎么兜底 |
 *
 * 切出来之后那 40 行**可以单独读**（也就能单独解释"为什么估算而不是
 * `getBounds()`"这条坑），而调用点只剩一行转发。
 *
 * ⚠️ 这里**不认识** Pixi 的绘制，只读 `TextStyle` / 盒高这类**数值**属性
 * —— 所以形状写成结构类型（`TextLike`），能在 node 里直接测。
 */

import { stripEmphasis } from './emphasis';
import { measuredHeight } from './prepareDetailViewport';
import type { DetailRow } from './prepareDetail';

/** 一行文字"够估算"的那几个属性（`Pixi.Text` / `Label.root` 都满足）。 */
export interface TextLike {
  readonly text: string;
  readonly height: number;
  readonly style: { readonly wordWrapWidth: number };
}

/**
 * 折了几行（**估算**，只作 `measuredHeight` 的兜底）。
 *
 * ⚠️ 为什么估算而不是 `getBounds()`：Pixi 的测量在 jsdom 里跑不动
 * （`PrepareScreen` 与 `prepareRender` 都因为同一条纪律把逻辑抽出去了）。
 * 这里要的只是**行高**，而中文是方块字 —— `字数 / 每行字数` 对它是够准的
 * 下界。用 `ceil` 而不是 `round`：宁可多留一行空，也不让两行文字叠在一起。
 */
export function estimateLines(text: TextLike, bodySize: number): number {
  if (text.text.length === 0) return 0;
  const width = text.style.wordWrapWidth;
  const perLine = Math.max(1, Math.floor(width / bodySize));
  return Math.max(1, Math.ceil(text.text.length / perLine));
}

/** 估算的文本高度（`estimateLines × bodyLine`）。 */
export function estimatedHeightOf(text: TextLike, bodySize: number, bodyLine: number): number {
  return estimateLines(text, bodySize) * bodyLine;
}

/**
 * 一行该占多高：**实测与估算取大**。
 *
 * ⚠️ Pixi 的 `Text.height` / `getLocalBounds()` 对**折行**的说明只报一行的行高
 * （2026-10-22 实测：一段折成 2~3 行的说明，`height` 恒为 `lineHeight`，
 * 与字号 / UI 缩放都无关 ✗）⇒ 直接拿它推进 y，会把两行正文摆到同一处
 * （用户："uiScale≠1 时正文两行叠在一起"）。估算只会偏大（`ceil` + `\n`
 * 多算），方向安全（多留空 vs 叠字）✓。
 */
export function lineHeightOf(measured: number, estimated: number): number {
  return Math.max(measured > 0 ? measured : 0, estimated);
}

/** 实测高度（`prepareDetailViewport.measuredHeight` 的转发：只读 Pixi 的盒高）。 */
export function measuredHeightOf(text: TextLike, fallback: number): number {
  return measuredHeight(text.height, fallback);
}

/**
 * 一条 `DetailRow` 该显示的**字**。
 *
 * ⚠️ **`text` 行也要过 `stripEmphasis`**（2026-10-16）：语言包里的
 * `**加粗**` 是给读源码的人看的重音标记，画面上不该出现星号 —— 技能说明
 * 那条路一直是这么做的，而 `text` 行漏了：肉鸽确认屏的「恶魔低语」详情
 * 就是这么把 `这一层**没有难度惩罚**…` 原样画到屏上的（截图里一眼可见）。
 *
 * 放在这里（而不是"把文案里的 `**` 删掉"）：后者只是**这一次**不出现，
 * 下一条 `text` 行还会踩同一个坑。
 */
export function detailRowText(
  row: DetailRow,
  translate: (key: string, params?: Readonly<Record<string, string | number>>) => string,
): string {
  if (row.kind === 'text') return stripEmphasis(translate(row.key, row.params));
  if (row.kind === 'kv') return row.value;
  return stripEmphasis(translate(row.nameKey));
}
