/**
 * 按键页底部的**选中技能详情**（四行）。
 *
 * 需求："除了显示标签，还显示一下技能说明和代价，cd 等信息吧，
 * 要不然只显示选中的技能的信息（包括标签）也可以。"
 *
 * 只为**当前焦点**那一项显示 —— 十几个格子各塞一段中文会挤成一团，
 * 而玩家一次只关心一个技能。
 */

import { FONT } from '../layout';
import { Label, type PixiCtor } from '../primitives';
import { PALETTE } from '../../render/theme';
import { skillDetailRect } from './logic';
import type { KeyRow } from './rows';

/** 说明的最大字符数（超出截断加省略号）。 */
const DETAIL_DESC_MAX_CHARS = 46;

/** 四行之间的行距（见 `render` 里的实测说明）。 */
const LINE_H = 22;

/** 截断一段文案，超出加省略号。 */
function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}

export class SkillDetail {
  readonly root: import('pixi.js').Container;

  private readonly name: Label;
  private readonly tags: Label;
  private readonly desc: Label;
  private readonly stats: Label;

  constructor(
    pixi: PixiCtor,
    private readonly translate: (key: string) => string,
  ) {
    const dr = skillDetailRect();
    /**
     * 四行的行距 = **22px**，按 `Label` 的**实测占高**取。
     *
     * Pixi 的 `Label` 实际占高远大于字号：13px 的字量出来是 **22px**
     * （行高 ≠ 字号）。我先用了 14、15、18，三次都叠字
     * （"说明"与"代价"糊在一起）—— 这是量出来的，不是估出来的。
     */
    const line = (row: number, size: number, color: number): Label =>
      new Label(pixi, { x: dr.x, y: dr.y + row * LINE_H, size, color });
    this.name = line(0, FONT.body, PALETTE.text);
    this.tags = line(1, FONT.tiny, PALETTE.douqi.bright);
    this.desc = line(2, FONT.tiny, PALETTE.textDim);
    this.stats = line(3, FONT.tiny, PALETTE.textDim);
    this.root = new pixi.Container();
    this.root.addChild(this.name.root, this.tags.root, this.desc.root, this.stats.root);
  }

  /** 清空（离开按键页时调用 —— 不留上一个技能的信息）。 */
  clear(): void {
    for (const label of [this.name, this.tags, this.desc, this.stats]) label.set('');
  }

  /** 显示某个技能的详情。 */
  render(row: KeyRow): void {
    const t = this.translate;
    const tags = (row.hintTags ?? []).map((tag) => t(`settings.hintTags.${tag}`)).join(' · ');
    /**
     * 说明可能很长，而详情区是一行固定宽度 —— 超出就**截断加省略号**。
     * 不做换行：换行会让下面三行的位置随内容浮动，焦点移动时文字
     * 会上下跳，反而更难读。
     *
     * ⚠️ 文案里可能带 **Markdown 的强调标记**（如"**无法被打断**"）——
     * 那是给文档看的，直接画到 canvas 上会原样显示星号。统一剥掉。
     */
    const desc =
      row.descKey === undefined
        ? ''
        : truncate(t(row.descKey).replaceAll('**', ''), DETAIL_DESC_MAX_CHARS);
    /**
     * 代价与冷却都由上层**格式化好**（走 i18n 模板）——
     * 这里只负责把两段拼起来，不自己造文案（否则又会出现硬编码中文）。
     */
    const stats = [row.costText, row.cdText]
      .filter((x): x is string => x !== undefined && x !== '')
      .join('   ');

    /**
     * **没有标签就收上来**（不留空档）。
     *
     * 标签行不是每个技能都有（目前只有「破」有「打断」）。
     * 如果位置写死，四个位置里会有一个永远是空的 —— 看起来像漏画了。
     * 所以按"实际有几行"重排 y。
     */
    const dr = skillDetailRect();
    const rows: Label[] = [];
    if (tags !== '') rows.push(this.tags);
    rows.push(this.desc, this.stats);
    for (const [i, label] of rows.entries()) {
      label.root.y = dr.y + (i + 1) * LINE_H;
    }

    this.name.set(t(row.nameKey));
    this.tags.set(tags);
    this.desc.set(desc);
    this.stats.set(stats);
  }
}
