/**
 * 战报复盘（一局结束后的全屏日志）的**纯逻辑与几何**。
 *
 * ==================================================================
 * 为什么要单独一个文件（而不是塞进 LogPanel）
 * ==================================================================
 *
 * 需求："增强log，信息尽可能多 …… 一局结束 也显示完整log，玩家好复盘。"
 *
 * 复盘与战斗中那条实时面板是**两件事**：
 *   - 实时面板：只画最近几条 `major`（见 `LogPanel.ts` 的文件头）
 *   - 复盘：画**全部**（含 `minor`）、能滚、有时间轴
 *
 * 会滚的列表里最容易写错的从来不是"画"，而是"**该显示哪几条**"：
 * 偏移越界、条数不足一屏、翻到尽头、空数组、只有一条 …… 这些用截图
 * 看不出来（截图只证明"这一帧看着对"）。所以它们全部提成这里的纯函数，
 * 由 `tests/unit/logReview.test.ts` 覆盖；`LogReviewPanel.ts` 只剩取词与画。
 *
 * 本文件**不 import pixi 运行时**（只取 `PALETTE` 的纯数值），也不 import i18n ——
 * 于是它能在 Node 里直接跑（与 `app/logFormat.ts` 同一种"可测层"）。
 */

import type { LogEntry } from '../app/logFormat';
import type { BattleSnapshotView } from '../render/viewModel';
import { FONT } from './layout';
import { PALETTE } from '../render/theme';

/* ================================================================== *
 * 时间与状态
 * ================================================================== */

/**
 * 引擎的**物理刻度**：60 tick = 1 秒。
 *
 * ⚠️ 这里没有 import `core/loopConstants` 的 `TICKS_PER_SECOND`：渲染层
 * **不许** import core 内部模块（架构规范 C3，`raid/render/no-core-internals`
 * 会当场报错）。所以这个 60 是"渲染层对引擎刻度的一次显式声明"，
 * 与 `render/hudUtils.ts` 的 `formatClockSafe`（那里也是直接写 60）同一个约定。
 */
export const TICKS_PER_SECOND = 60;

/** 战斗状态 —— 直接引用 view-model 的形状，**不重新声明**一个字面量联合（免得两边漂移）。 */
export type BattleStatus = BattleSnapshotView['status'];

/**
 * 结算数据（胜负、用时、剩余生命、伤害、DPS）。
 *
 * ⚠️ 需求："一局结束**也**显示完整log" —— "也"字是关键：复盘**不该把结算
 * 盖掉**。最初的实现是"复盘全屏压在结算之上"，于是结算的用时/伤害那几行
 * 只能从面板底下透出来（截图里能看到）。现在这几项**并进复盘头部**：
 *   - 数据**只从 `view.result` 拿**，渲染层不自己算（算出来的和结算面板
 *     对不上就是两个真相）
 *   - 文案**全部复用**结算面板已有的 `screen.stat*` key —— `zh-CN.ts`
 *     已经贴着 700 行上限，一条新 key 都不能加
 */
export type ResultSummary = NonNullable<BattleSnapshotView['result']>;

/**
 * 结算摘要的四个格子（顺序 = 显示顺序）。
 *
 * ⚠️ 这四个 key 与 `render/resultPanel.ts` 用的是**同一批**：
 * 结算面板与复盘头部说同一件事，措辞当然也该是同一份文案。
 */
export const RESULT_STAT_KEYS = [
  'screen.statTime',
  'screen.statRemainingHp',
  'screen.statTotalDamage',
  'screen.statDps',
] as const;

/**
 * 结算 → 「标签 key + 值」四格。
 *
 * 值里的 `s` / ` / ` 是**单位与分隔符**，不是文案（结算面板里也是这么拼的，
 * 见 `render/resultPanel.ts`）；可显示的文字一律走 key。
 */
export function resultStatCells(
  result: ResultSummary,
): ReadonlyArray<{ readonly key: string; readonly value: string }> {
  return [
    { key: RESULT_STAT_KEYS[0], value: `${result.seconds}s` },
    { key: RESULT_STAT_KEYS[1], value: `${result.remainingHp}/${result.remainingHpCap}` },
    { key: RESULT_STAT_KEYS[2], value: `${result.totalDamage}` },
    { key: RESULT_STAT_KEYS[3], value: `${result.dps}` },
  ];
}

/**
 * 一局是否**已经结束**（结算中）。
 *
 * ⚠️ 只有 `victory` / `defeat` 算结束：`idle` 是"还没开打/已复位"，
 * 把它也算进来的话，进战斗前的空快照会让复盘面板闪一下。
 */
export function isFinished(status: BattleStatus): boolean {
  return status === 'victory' || status === 'defeat';
}

/** 第几秒（tick → 整秒）。负数与非有限值一律当 0（数值纪律）。 */
export function secondsAt(tick: number): number {
  if (!Number.isFinite(tick) || tick <= 0) return 0;
  return Math.floor(tick / TICKS_PER_SECOND);
}

/* ================================================================== *
 * 几何
 * ================================================================== */

/**
 * 复盘面板的矩形（逻辑像素，960×540 坐标系）。
 *
 * ⚠️ 它**不跟 `uiScale` 走**（与战斗中那个小面板不同）：这是"整屏的复盘
 * 视图"，再乘一个 0.5..2 的系数会直接溢出画布。放大的收益（字更大）在这里
 * 也不重要 —— 复盘是静态阅读，玩家可以凑近看，也可以拉大窗口。
 *
 * 四周各留 12~16px：既留出呼吸空间，也保证不压到画布边缘（描边不会被裁）。
 */
export const REVIEW_RECT = { x: 16, y: 12, w: 928, h: 516 } as const;
/**
 * 头部高度。
 *
 * ⚠️ **两行**：第 1 行是标题 + 胜负/原因，第 2 行是结算摘要（用时/剩余生命/
 * 伤害/DPS）+ 条数。原来只有一行 32px —— 需求"结算摘要并进复盘头部"要的
 * 就是这多出来的一行（行数由 `REVIEW_ROWS` 自动跟着变，不用手调）。
 */
export const REVIEW_HEADER_H = 48;
/** 页脚（滚动提示 + 当前窗口）。 */
export const REVIEW_FOOTER_H = 24;
/** 每行高度。⚠️ 行高**固定**：行高不一的列表算不清"一屏几条"，也无法用等距滚动。 */
export const REVIEW_ROW_H = 16;
export const REVIEW_PAD_X = 12;
/** 时间列宽（右对齐的"第几秒"）。 */
export const REVIEW_TIME_W = 46;
/** 类别色条的宽度（`major` 行用满，`minor` 行收窄）。 */
export const REVIEW_BAR_W = 3;
/** 时间列 → 色条、色条 → 正文 的空隙。 */
export const REVIEW_GAP = 8;

/**
 * 一屏能放几行 —— **算出来的**，不是拍的。
 *
 * 需求要"条与条不重叠、不溢出屏幕"，所以这个数只能由
 * `(面板高 - 头 - 脚) / 行高` 推出来；`logReview.test.ts` 会断言
 * `行数 × 行高 + 头 + 脚 ≤ 面板高`（改几何时先改这里，测试会跟着拦）。
 */
export const REVIEW_ROWS = Math.floor(
  (REVIEW_RECT.h - REVIEW_HEADER_H - REVIEW_FOOTER_H) / REVIEW_ROW_H,
);

/** 列表区顶部的 y（把"装不满一屏"剩下的那点空间上下分掉）。 */
export const REVIEW_ROWS_Y =
  REVIEW_RECT.y + REVIEW_HEADER_H + (REVIEW_RECT.h - REVIEW_HEADER_H - REVIEW_FOOTER_H - REVIEW_ROWS * REVIEW_ROW_H) / 2;

/**
 * **真正会随滚动变化的那块矩形**（列表区；表头 / 页脚不在内）。
 *
 * ⚠️ 它是"指针该不该由复盘吃掉"的**几何判据**
 * （`app/inputRouter.ts` 的 `reviewConsumesPointer` 只认它）。
 *
 * 为什么不用整块 `REVIEW_RECT`：面板几乎占满屏幕（928×516 / 960×540），
 * 用整块的话"面板**外**"只剩 12–16px 的边 —— 手指根本点不到，于是
 * **触屏玩家出不去复盘**（AGENTS.md §3b"触屏与键盘功能必须对等"）。
 *
 * 表头（标题 / 结算摘要）与页脚（滚动提示 / 范围）本来就不参与滚动，
 * 让它们**不**消费点击，正好成为"点这里 = 离开战斗"的那块地方：
 * 桌面有 `Enter`，触屏就靠点这两条。
 */
export const REVIEW_ROWS_RECT = {
  x: REVIEW_RECT.x,
  y: REVIEW_ROWS_Y,
  w: REVIEW_RECT.w,
  h: REVIEW_ROWS * REVIEW_ROW_H,
} as const;

/** 正文列的左缘：`左内边距 → 时间列 → 空隙 → 色条 → 空隙 → 正文`。 */
export const REVIEW_TEXT_X =
  REVIEW_RECT.x + REVIEW_PAD_X + REVIEW_TIME_W + REVIEW_GAP + REVIEW_BAR_W + REVIEW_GAP;

/* ================================================================== *
 * 配色与轻重
 * ================================================================== */

/**
 * 类别 → 颜色。
 *
 * 与其它 UI 用的是**同一套色**（红=伤害、青=闪避、金=打断），
 * 于是日志和画面上的飘字/读条是同一个语言。需求要的"按类别配色、
 * 玩家扫一眼能分出轻重"就落在这一张表上。
 *
 * ⚠️ 它放在这里（而不是 `LogPanel.ts`）：实时面板与复盘面板**都要**
 * 用它，放在其中一边会让另一边反向 import —— 那是环。
 */
export const CATEGORY_COLORS: Readonly<Record<LogEntry['category'], number>> = {
  deal: 0xffd08a,
  take: PALETTE.danger.bright,
  avoid: PALETTE.iframe.bright,
  interrupt: PALETTE.douqi.bright,
  cast: PALETTE.textDim,
  resource: PALETTE.buff.bright,
  system: PALETTE.text,
};

/** 一行的视觉分量（字号 / 主色透明度 / 色条 / 背景底纹）。 */
export interface RowStyle {
  readonly size: number;
  readonly alpha: number;
  readonly barW: number;
  readonly barAlpha: number;
  /** `major` 行的那条淡底纹（"这条更重"）；`minor` 为 0。 */
  readonly stripeAlpha: number;
}

/**
 * 分量 → 视觉。
 *
 * 需求："重要的条目(伤害、阶段、死亡)**视觉上更重**，次要的(回炁、
 * buff 过期)更轻更淡"。
 *
 * 三条通道一起用，而不是只改字号：字号（13 vs 11）、主色透明度
 * （1.0 vs 0.5）、再加一条 `major` 专属的淡底纹。只改字号的话在
 * 一屏 28 行的密度下几乎看不出差别。
 */
export function rowStyle(entry: LogEntry): RowStyle {
  return entry.level === 'minor'
    ? { size: FONT.tiny, alpha: 0.5, barW: 2, barAlpha: 0.55, stripeAlpha: 0 }
    : { size: FONT.small, alpha: 1, barW: REVIEW_BAR_W, barAlpha: 1, stripeAlpha: 0.07 };
}

/* ================================================================== *
 * 窗口计算（该显示哪几条）
 * ================================================================== */

/**
 * 滚动的数学搬到了 `./scrollWindow`（**叶子模块**）。
 *
 * ⚠️ 理由是 AGENTS.md 的"不要另发明一套滚动"：这一轮设置页的技能详情区
 * 也要滚动，于是同一套窗口数学有了**第二个**消费者。留在本文件里的话，
 * 详情区只能（a）反向 import 复盘模块，或（b）抄一份 —— 前者是耦合，
 * 后者正是"两份会漂的真相"。所以下沉成叶子，两边都向下依赖它。
 *
 * 这里**转发**，外部 import 路径不变（与 `settings/logic` 转发
 * `keyNames` / `rebind` 同一做法）。
 */
export {
  clampOffset,
  maxOffset,
  pageStep,
  scrollFraction,
  scrollOffset,
  scrollThumbRatio,
  tailOffset,
  visibleWindow,
  windowRange,
  type WindowRange,
} from './scrollWindow';

/**
 * 战斗中那条实时面板的输入：只要 `major`。
 *
 * 需求："`level: 'minor'` 的条目也要显示在复盘界面里 …… 但**不要**放进
 * 战斗中那个三条的小面板。"
 * 这条规则唯一该待的地方就是这里 —— 渲染层别处不许再判 `level`。
 */
export function majorEntries(entries: readonly LogEntry[]): readonly LogEntry[] {
  return entries.filter((entry) => entry.level !== 'minor');
}

/* ================================================================== *
 * 取词
 * ================================================================== */

/**
 * 把参数里**值为 i18n key** 的那些先翻译掉。
 *
 * ⚠️ 为什么需要：日志的 `params` 允许"值是另一个 key"（例如
 * `actor: 'boss.pride.name'`、`skill: 'boss.cleave.name'`，见
 * `app/logFormat.ts` 的 `actorKey` / `skillKey`），而 `translate`
 * **不会递归**它自己的 params —— 不处理的话屏幕上会直接出现
 * `boss.cleave.name` 这串 key（同 `hud.stunned` 那个坑）。
 *
 * ⚠️ 只翻**字符串**：数字（`amount`）必须原样留着当插值。
 *
 * ⚠️ 两个面板（实时/复盘）**共用这一份**：以前它长在 `LogPanel` 里，
 * 复盘要是自己再写一遍，迟早会有一边忘了递归翻译。
 */
export function resolveLogParams(
  params: Readonly<Record<string, string | number>> | undefined,
  translate: (key: string, params?: Readonly<Record<string, string | number>>) => string,
): Readonly<Record<string, string | number>> | undefined {
  if (params === undefined) return undefined;
  return Object.fromEntries(
    Object.entries(params).map(([k, v]) => [
      k,
      typeof v === 'string' ? translate(v) : v,
    ]),
  );
}

/**
 * **日志条目 → 屏幕上那几行文本**（与面板**同一个**格式化路径）。
 *
 * 2026-10-23 加：给开发模式的 `__raidBattle.logLines()` 用。
 *
 * ⚠️ 为什么必须共用：如果调试口自己拼一遍字符串，"调试看到的"与
 * "玩家看到的"就会漂 —— 而这类漂移**恰恰是**最难发现的那种（两边都"看起来对"）。
 * 面板那侧（`LogPanel.paintFeed`）用的就是本函数里的同两步：
 * `majorEntries()` 过滤 + `resolveLogParams()` 递归翻名字 + `translate()`。
 *
 * @param n 只取**最近 n 条**（缺省 50；`<= 0` 视作"全部"）
 */
export function logLineTexts(
  entries: readonly LogEntry[],
  translate: (key: string, params?: Readonly<Record<string, string | number>>) => string,
  n = 50,
): readonly string[] {
  const major = majorEntries(entries);
  const take = n <= 0 ? major : major.slice(-n);
  return take.map((entry) => translate(entry.key, resolveLogParams(entry.params, translate)));
}
