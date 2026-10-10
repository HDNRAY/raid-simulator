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
    /**
     * 标签行 = **玩法提示** ∪ **机械 tag**（如「闪避」）。
     *
     * ⚠️ 两类分开取词（前缀不同）：`settings.hintTags.*` 是玩法提示，
     * `settings.mechanicTags.*` 是机械分类里挑出来的。混用一个前缀
     * 会让"某个 tag 是哪种"这件事在 i18n 里看不出来。
     */
    const tags = [
      ...(row.hintTags ?? []).map((tag) => t(`settings.hintTags.${tag}`)),
      ...(row.mechanicTags ?? []).map((tag) => t(`settings.mechanicTags.${tag}`)),
    ].join(' · ');
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
     * **结构化行**：消耗 · 冷却 · 施放。
     *
     * ⚠️ 三段都由上层**格式化好**（走 i18n 模板）—— 这里只负责拼，
     * 不自己造文案（否则又会出现硬编码中文）。
     * ⚠️ 它们**取代**了原先写在说明里的"消耗 30 炁""瞬发"等字样
     * （需求："资源消耗如果单独会说，比如30炁，描述里就不要加了，
     * 包括瞬发与否，这些应该是结构化的显示"）。写在说明里会漂移。
     */
    const stats = [row.costText, row.cdText, row.castText]
      .filter((x): x is string => x !== undefined && x !== '')
      .join('   ');

    /**
     * **没有标签就收上来**（不留空档）。
     *
     * 标签行不是每个技能都有（目前只有「破」有「打断」）。
     * 如果位置写死，四个位置里会有一个永远是空的 —— 看起来像漏画了。
     * 所以按"实际有几行"重排 y。
     */
    /**
     * ================================================================
     * 布局：**标签放名字右边**，不占独立的行
     * ================================================================
     *
     * 需求："设置里选中的技能，里面显示tags会把描述往下推，我觉得不好，
     * 优化一下layout，比如tags放右边，或者下面。"
     *
     * 原先标签占**独立一行**（名字 / 标签 / 说明 / 代价），把说明推到了
     * 第三行。改成名字右边之后：
     *   第 1 行  名字 + 标签
     *   第 2 行  说明
     *   第 3 行  消耗 · 冷却 · 施放
     * 行数从 4 降到 3，且**不需要撑高详情区**。
     *
     * ⚠️ 标签的 x 依赖名字的**实际渲染宽度**（`root.width`），所以必须
     * 先 `set` 名字再定位标签 —— 顺序反了会用到上一帧的宽度。
     */
    const dr = skillDetailRect();
    this.name.set(t(row.nameKey));
    this.tags.set(tags);
    this.desc.set(desc);
    this.stats.set(stats);

    const TAG_GAP = 10;
    this.tags.root.x = dr.x + this.name.root.width + TAG_GAP;
    this.tags.root.y = dr.y;
    this.desc.root.y = dr.y + LINE_H;
    this.stats.root.y = dr.y + LINE_H * 2;
  }
}
