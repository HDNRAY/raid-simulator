/**
 * **收起的那一块（块头）说什么**（纯函数：选择 + 层数 → 一行文案）。
 *
 * ==================================================================
 * 它是什么（一句话，没有"和"）
 * ==================================================================
 *
 * 手风琴收起来的两块**不能只剩一个标题** —— 用户原话：
 *
 * > "收起来的那两块要显示'当前选了什么'（人物：选中的名字+头像 ✓
 * >  炁机：已激活哪几条 ✓ 对手：选中的 Boss 名 ✓）—— 否则玩家不知道
 * >  收起来的那块是什么"
 *
 * 本文件就是"那行字是什么"的**唯一**出处（几何在 `prepareLayout`，
 * 画在 `prepareFoldBars`）。抽出来的理由与 `prepareDetail` 同源：这里有
 * 一条**会被写错的规则** —— 块头显示的是**已确定的选择**，不是光标！
 *
 * ```
 *   人物块头 = 选中的那个人（`selection.playerId`），不是光标停的第 N 个
 *   对手块头 = 选中的那个 Boss（`selection.bossId`）
 *   炁机块头 = **已激活的那几条**（激活集合），不是光标停的那一条
 * ```
 *
 * ⚠️ 写成"光标那一项"在桌面上几乎看不出来（两者常常重合），而触屏
 * 一旦点开又收起就会露馅 —— 所以它必须是**能单测的纯逻辑**。
 */

import type { TranslateFn } from '../i18n/translator';
import type { PrepareSectionKind } from './prepareTypes';

/** 块头要画的东西：一行**已本地化**的字 + （人物才有的）头像素材 id。 */
export interface FoldSummary {
  readonly text: string;
  /**
   * 头像素材 id（`render/portraitAssets` 的配对键）。
   * ⚠️ 只有人物有：炁机 / Boss 没有配对素材，块头就只有文字（用户明确
   * 允许："炁机没有头像 → 那一条怎么排，你判断"）。
   */
  readonly portraitId?: string;
}

/** 一个可选项（只要 id 与名字的 i18n key）。 */
export interface FoldEntry {
  readonly id: string;
  readonly nameKey: string;
}

export interface FoldSummaryArgs {
  readonly kind: PrepareSectionKind;
  /** **已确定**的选择（块头显示它，不显示光标 —— 见文件头）。 */
  readonly selection: { readonly playerId: string; readonly bossId: string };
  readonly players: readonly FoldEntry[];
  readonly bosses: readonly FoldEntry[];
  readonly qiji: readonly FoldEntry[];
  /** 某条炁机此刻开着没有。 */
  readonly on: (id: string) => boolean;
  readonly translate: TranslateFn;
  /**
   * 一行**最多几个字**（由块头的内宽 ÷ 名字字号算出来，见调用方）。
   * ⚠️ 它只是"排不下时怎么收口"的依据 —— 块头不折行（折行会顶掉下面
   * 那两块的高度），所以超出就截断（见 `qijiNamesText`）。
   */
  readonly maxChars: number;
}

/**
 * 收起那一块要显示的那一行。
 *
 * @returns 那一块**没有可选项**时 `undefined`（没有"当前选择"可言 ——
 *   调用方不该画出块头）。
 */
export function foldSummaryOf(args: FoldSummaryArgs): FoldSummary | undefined {
  const t = args.translate;
  if (args.kind === 'player') {
    const entry = pick(args.players, args.selection.playerId);
    return entry === undefined ? undefined : { text: t(entry.nameKey), portraitId: entry.id };
  }
  if (args.kind === 'boss') {
    const entry = pick(args.bosses, args.selection.bossId);
    return entry === undefined ? undefined : { text: t(entry.nameKey) };
  }
  /**
   * ⚠️ **没有可选项就没有块头**：一个"未激活任何炁机"的块头会让玩家以为
   * 那一块存在但空着（实际是这一屏根本没有炁机行，见选角色屏）。
   */
  if (args.qiji.length === 0) return undefined;
  const on = args.qiji.filter((q) => args.on(q.id));
  if (on.length === 0) return { text: t('roster.ui.summary.qijiOff') };
  /**
   * ⚠️ 只有名字（**不再有"×2"**）：激活是开关，没有层数
   * （见 `ui/freeQiji.ts` 的文件头）。
   */
  const tokens = on.map((q) => t(q.nameKey));
  return {
    text: joinWithin({
      prefix: t('roster.ui.summary.qijiOn', { n: on.length }),
      tokens,
      maxChars: args.maxChars,
      /** 分隔符也是文案（`、` vs `, `）—— 从语言包取，不写在这里。 */
      separator: t('common.listSeparator'),
    }),
  };
}

/** 选中项（选不中就用第一条 —— 列表非空时块头总得说点什么）。 */
function pick(list: readonly FoldEntry[], id: string): FoldEntry | undefined {
  return list.find((e) => e.id === id) ?? list[0];
}

/**
 * 把若干"名字"拼进 `prefix` 后面，**超过 `maxChars` 就收口**。
 *
 * ⚠️ 收口 = 末尾补一个省略号（**不折行**）：块头高度是布局的一部分
 * （`foldH`），一旦折行，下面两块的位置就跟着变 —— 那正是"随手写一行
 * 文案把布局搞坏"的形状。所以宁可少显示几条，也不许它变高。
 */
function joinWithin(args: {
  readonly prefix: string;
  readonly tokens: readonly string[];
  readonly maxChars: number;
  readonly separator: string;
}): string {
  const { prefix, tokens, maxChars, separator } = args;
  let out = prefix;
  for (const token of tokens) {
    const piece = (out === prefix ? '' : separator) + token;
    if (out.length + piece.length > maxChars) {
      return out === prefix ? `${prefix}…` : `${out}…`;
    }
    out += piece;
  }
  return out;
}
