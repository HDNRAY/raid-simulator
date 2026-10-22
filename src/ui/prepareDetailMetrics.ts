/**
 * **备战屏详情区的度量**（纯几何：字号 / 行高 / 顶栏那一条 / 一行文字占多宽）。
 *
 * ==================================================================
 * 它是什么（一句话，没有"和"）
 * ==================================================================
 *
 * 它是详情区的**一把尺子**：所有"这一块该多高 / 这一行文字从哪开始、
 * 能占多宽"都由这里回答 —— 一行 Pixi 都不碰。
 *
 * ==================================================================
 * 为什么从 `prepareDetailPanel.ts` 切出来（AGENTS.md §3）
 * ==================================================================
 *
 * 2026-10-13 第三轮（卡片区可滚 + 顶栏钉住 + 炁机去 icon）之后，那个文件
 * 到了 **803 行**（超上限）。按 §3 的正确顺序，先看它混了几件事：
 *
 * | 那一半 | 一句话 |
 * |---|---|
 * | 本文件 | 详情区的**度量**（尺子：多高、多宽、从哪开始） |
 * | `prepareDetailPanel` | 把模型**画到**那些格子里的 Pixi 组件 |
 *
 * 两者之间只有**单向**依赖（画的那一半读这里），没有环。而且这一半是
 * **纯函数**：能在 node 里断言"炁机那一类不给方框让位"、"顶栏高 =
 * max(方框, 两行字)"，不必起 Pixi。
 *
 * ⚠️ 注释与代码一起搬（§3：不留"见 xxx"的摘要）。
 */

import { FONT } from './layout';
import { PREPARE_LAYOUT } from './prepareLayout';

/**
 * 行池大小。
 *
 * ⚠️ **不是一个"够用就好"的魔法数**，而是"这一屏最多会有几行"的上界：
 * Boss 详情是 `1 行标题 + 4 条招式 = 5`，炁机是 `3 行`，人物是
 * `1 + 技能数`（今天最多 5 招 → 6）。取 **12** 留一倍余量。
 * ⚠️ 超过它的模型会被**截断**（多出来的行不画）—— 那是有意的降级
 * （宁可少显示，也不每帧新建 Label）。
 */
export const DETAIL_ROW_POOL = 12;

/** 详情区的行距 / 内边距（逻辑像素）。 */
export const METRICS = {
  /** 标题字号（比正文大一号）。 */
  titleSize: 20,
  /**
   * **顶部那一行"关键数值"的字号**（人物 / Boss = 生命上限，炁机 = 层数）。
   *
   * ⚠️ 从 `FONT.small`(13) 提到 `FONT.title`(17) —— 用户原话"**血量要
   * 显眼**（那是玩家最想看的）"。它只比标题小一号，并且用亮色（见 `update`）。
   */
  valueSize: FONT.title,
  /** 说明字号。 */
  bodySize: FONT.small,
  /** 名字 / 标签字号。 */
  nameSize: FONT.body,
  /** 一行标题的行高。 */
  titleLine: 26,
  /** 关键数值那一行的行高。 */
  valueLine: 22,
  /** 一条技能：名字行 + 说明行。 */
  nameLine: 19,
  bodyLine: 17,
  /** 行与行之间的空。 */
  rowGap: 6,
  /** 标题下、正文上的分隔线离标题底的距离。 */
  ruleGap: 6,
} as const;

/**
 * **Shift + ↑ ↓ 一次滚多少**（像素）。
 *
 * ==================================================================
 * 为什么是一个"三行说明"的量级
 * ==================================================================
 *
 * 滚轮那条路的步长是 `deltaY × 3`（见 `PrepareScreen.wheelDetail`）——
 * 键盘没有"一格"这个单位，所以要给它一个**与正文行高可比**的量：
 * `bodyLine`(17) × 3 ≈ 一行说明（1~3 行）+ 行距，按一下能看清"内容动了"
 * 而不是像没反应。
 *
 * ⚠️ 仍然是**算出来**的（从字号的度量推），不是手调的魔法数 —— 行高改
 * 这张表跟着改。
 */
export const DETAIL_SCROLL_STEP = METRICS.bodyLine * 3;

/**
 * 详情区里那张脸的显示边长（比卡片上的 `portraitBox` 大得多）。
 *
 * ⚠️ 只由**详情区的宽度**决定（与 `x` 无关）：`w` 是面板的内宽，
 * 而"脸多大"是那一块自己的比例。把 `x` 也拉进来算过一次，结果是
 * 面板一挪位、脸就跟着变大变小。
 */
export function portraitBoxOf(innerW: number): number {
  return Math.max(48, Math.min(88, Math.floor(innerW * 0.42)));
}

/**
 * 顶栏右端那个方框多大。
 *
 * ==================================================================
 * ⚠️ 2026-10-13 第三轮：炁机**没有**方框（用户："炁机暂时不要 icon"）
 * ==================================================================
 *
 * 旧版三类共用一条顶栏，右边永远立着一个方框（人物 / Boss = 头像，
 * 炁机 = "名字首字"的程序化占位）。用户明确不要炁机的图标 —— 而
 * **占位方框就是那个图标槽**（它占着 88×88，里面只有一个字）。
 *
 * ⚠️ 所以"收掉 icon 槽"的落点是**这里**，而不是"画一个空框"：
 * 方框一旦为 0，标题 / 关键数值的 `wrap` 宽度就是**整条内宽**
 * （见 `headerBandOf` / `textSpanOf`），文字把那一块填满 ——
 * 右端不会留一个空洞。
 *
 * 🚧 今天**所有**没有素材的那一类都拿不到方框（Boss 与炁机都没有对话
 * 头像素材）。将来给某个 Boss 配了头像，它会自己走"真头像"那条分支
 * （`prepareDetailPanel.placeImage` 读 `portraitFor`）。
 */
export function headerBoxOf(kind: DetailKind, innerW: number): number {
  /**
   * ⚠️ **只有人物与 Boss 有头像方框**：炁机没有配对头像，而
   * 「恶魔低语」（2026-10-16 新增的那一类）也不是一个人/一只 Boss ——
   * 它是**一条规则**，给它一个脸只会让人以为那是谁。
   */
  return kind === 'player' || kind === 'boss' ? portraitBoxOf(innerW) : 0;
}

/**
 * 详情区能画的**类**。
 *
 * ⚠️ 四类里前三类有"实体"（人物 / 炁机 / Boss），第四类
 * （`'whisper'` = 「恶魔低语」，2026-10-16）是**一条难度规则** ——
 * 它与炁机一样**没有头像方框**（见 `headerBoxOf`）。
 */
export type DetailKind = 'player' | 'qiji' | 'boss' | 'whisper';

/** 详情区面板的矩形（本模块只读它的 `x/y/w`）。 */
export interface DetailRect {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

/**
 * 顶部那一条的度量（三类共用一条栏，但**有没有方框**按类分）。
 *
 * ```
 *   人物 / Boss：                     炁机：
 *   ┌──────────────────────┐          ┌──────────────────────┐
 *   │ 名字（20 金）        │ ┌────┐   │ 名字（20 金，整条宽）│
 *   │ 生命上限 420（17 亮）│ │ 脸 │   │ 层数 2 / 3（17 亮）  │
 *   └──────────────────────┘ └────┘   └──────────────────────┘
 * ```
 *
 * ⚠️ 条高取 `max(方框, 两行文字)`：人物（有 88 方框）时是方框说了算，
 * 而**没有方框的炁机**这一条就由**两行文字**决定（段落标题的行框）——
 * 它比有方框的那一类矮，所以**下一段内容（分隔线 / 招式列表）跟着上移**，
 * 这正是"把 icon 槽收掉"之后"不留空洞"的样子。
 */
export function headerBandOf(
  kind: DetailKind,
  rect: DetailRect,
): {
  readonly top: number;
  readonly h: number;
  readonly box: number;
  readonly textH: number;
} {
  const innerW = rect.w - PREPARE_LAYOUT.detailPad * 2;
  const box = headerBoxOf(kind, innerW);
  const textH = METRICS.titleLine + METRICS.valueLine;
  return { top: rect.y + PREPARE_LAYOUT.detailPad, h: Math.max(box, textH), box, textH };
}

/**
 * 一行文字**能占的那段横宽**（`x` = 左端，`w` = 可折行宽度）。
 *
 * ⚠️ 它是"标题 / 关键数值要不要为右边的方框让位"的**唯一**判据 ——
 * 于是"顶栏让位"这件事在同一个地方说清楚。
 */
export interface TextSpan {
  readonly x: number;
  readonly w: number;
}

/** 顶栏那两行（名字 / 关键数值）的横宽：**有方框就让位**。 */
export function textSpanOf(kind: DetailKind, rect: DetailRect): TextSpan {
  const innerX = rect.x + PREPARE_LAYOUT.detailPad;
  const innerW = rect.w - PREPARE_LAYOUT.detailPad * 2;
  const band = headerBandOf(kind, rect);
  const w = band.box === 0 ? innerW : innerW - band.box - METRICS.rowGap;
  return { x: innerX, w: Math.max(1, w) };
}

/**
 * 正文行的横宽：**整条内宽**（不避让任何东西 —— 方框在顶栏那一条里，
 * 正文从顶栏下面开始）。
 */
export function inlineSpan(innerX: number, innerW: number): TextSpan {
  return { x: innerX, w: innerW };
}

/**
 * 正文视口的顶边（**顶栏下缘** + 一点呼吸位）。
 *
 * ⚠️ 它是"顶栏钉住、只让正文滚"这条规则里**两个区域的分界**：
 * 上面的部分不参与滚动，下面的部分在 `[它, 面板底 − 内边距]` 里滚。
 */
/**
 * 顶栏与正文之间的空隙（`rowGap` 的倍数）。
 *
 * ⚠️ 2026-10-22 从 `2`（12px）加到 **`3`（18px）**：12px 时，分隔线不管放哪
 * 都会贴着正文第一行的**升部**（中文 15px 字的实际墨迹比行框高一截）——
 * 看起来就是"横线从字里穿过去"（用户报的"低语的内容重叠了"）。
 */
const BODY_GAP_UNITS = 3;

/** 正文第一行的顶边（= 顶栏下缘 + 空隙）。 */
export function bodyTopOf(kind: DetailKind, rect: DetailRect): number {
  const band = headerBandOf(kind, rect);
  return band.top + band.h + METRICS.rowGap * BODY_GAP_UNITS;
}

/**
 * 顶栏与正文之间那道**分隔线**的 y。
 *
 * ⚠️ 位置与 `bodyTopOf` **同源**（同一份几何）：它落在空隙的**上三分之一**，
 * 于是离顶栏 `~rowGap`、离正文 `~(BODY_GAP_UNITS−1)·rowGap`（12px）——
 * 那条线不会再碰到正文的墨迹 ✓。
 */
export function separatorYOf(kind: DetailKind, rect: DetailRect): number {
  const band = headerBandOf(kind, rect);
  return band.top + band.h + METRICS.rowGap;
}
