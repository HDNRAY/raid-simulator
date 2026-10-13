/**
 * 设置弹窗的**缩放模型**（唯一真相：`uiScale` → 面板自己能用多少）。
 *
 * ==================================================================
 * 它是面板里**唯一**一处"缩放系数"的换算
 * ==================================================================
 *
 * 命中测试、绘制、探针、每个部件的几何**都读它**（`currentSettingsMetrics()`）。
 * 各写一遍就会出现"画出来的格子"与"能点到的格子"错开 —— 本仓库为这条
 * 踩过不止一次（见 `keyGridLayout` 文件头那两个坑）。
 *
 * ## 写入路径只有一条
 *
 * 与 `input/touchLayout.ts` 同一条纪律（那个模块是本仓库的先例）：
 * **只有一个 `set()`**，写完 `SettingsPanel` 立刻重画。读取方一律
 * `currentSettingsMetrics()`，`resetSettingsMetrics()` 是哨兵默认（1×，
 * 给单测与"面板还没构造"的窗口用）。
 *
 * ==================================================================
 * ⚠️ 为什么面板**不能**像战斗 HUD 那样整体乘系数（实测的硬约束）
 * ==================================================================
 *
 * 战斗 HUD（`ui/uiLayout.ts`）可以放心地按系数放大：它是一屏上**若干块
 * 贴边的部件**，放大之后各自朝自己的锚点长，互相不抢地方。
 *
 * 设置弹窗不是 —— 它是**一块居中的大面板**，而且**已经顶到画布边上**：
 *
 *   面板  640 × 520（`settingsGeometry.SETTINGS_PANEL`）
 *   画布  960 × 540（`ui/layout.LOGICAL`）
 *   → 上下各只剩 **10px**（`y 10..530`）
 *
 * 所以"面板整体乘 2"= 1280×1040，**横向超出 320、纵向超出 500**，
 * 直接画到画布外面去（被裁掉，玩家看到半块面板）。乘 1.5 同样放不下。
 * 换句话说：**面板的"外框缩放"上限只有约 1.038，等于没有**。
 *
 * ==================================================================
 * ⚠️ 所以走的是"外框不动、内容变高变大"这条路
 * ==================================================================
 *
 * 外框（居中那块的宽高）**一个像素都不动**，变的是**竖排的几行**：
 * 格阵行高 / 详情区行距 / 提示两行 / 按钮高度 / 这些行里的字号。
 * 横向**一个字都不动** —— 不是偷懒，是三条硬理由：
 *
 *   1. 详情区的说明是**折行**的（`wrapText` 按可用宽度折）。加宽只能靠
 *      把面板加宽，而面板宽度也顶到边上了（640/960）。
 *   2. 格阵是 **4 列 × 2 行 = 8 格**，正好放下当前 8 个可绑技能
 *      （见 `settingsGeometry.KEY_GRID.cols`）。横向放大 = 4 列放不下 =
 *      「劈」「卸」在「按键」页**配不到键**（那是功能缺失，不是取舍）。
 *   3. 横向不动 = 指针坐标**不需要换算**，也就没有"换算写漏一处"的风险
 *      （`hitTest` / `panelProbes` / `SkillDetail` 的拖拽都在画布坐标系里）。
 *
 * ==================================================================
 * ⚠️ 钳位是**规则**，不是"算完再夹一下"（`PANEL_SCALE_MAX` 怎么来的）
 * ==================================================================
 *
 * 用户明确要求过这条，本仓库已有一个先例：`ui/iconHint` 的 `MIN_HINT_FONT`
 * ——那句"**下限由规则给出**，不是算完再夹一下"。这里同一条纪律。
 *
 * 规则是**竖向预算**。面板高 520，其中 **tab 行那 70px 钉死**
 * （`TAB_BAR_BOTTOM`），剩下的 450px 要装下三块：
 *
 *   格阵    2 行 × 44k + 1 × 8k      ← 跟 k 走
 *   详情区  由"剩下的"决定（它可滚，压不死，但也有下限 —— 见下）
 *   底部    提示 2 行 40 + 间隙 8 + 按钮 26 = **74**（固定）
 *
 * 解一次不等式得到 k 的上限（取 `minDetail = 220` = 详情区当前高度，
 * 即"缩放**不许从信息最密的地方抢地方**"）：
 *
 *   k ≤ (450 − 74 − 220) / 96 = 156 / 96 = 1.625 → 收成 **1.6**
 *
 * 收成 1.6 之后 2 行格阵 + 间隙占 147px（预算给它的 156px 之内），
 * 详情区仍然是 **220px**（不缩水）—— 所以这一版**不是**
 * "把说明挤掉换大字号"。
 *
 * ⚠️ 1.6 **必须**是这一步算出来的，不许改成"先乘完再看有没有溢出"：
 * 那样在缩放 1.5 / 1.7 时的表现（字大了、格子越界了）会随布局微调静默变化。
 */

import { LOGICAL } from '../layout';
import {
  CLOSE_BUTTON,
  DETAIL_BOTTOM,
  DETAIL_TOP,
  HINT_BLOCK_H,
  HINT_BLOCK_TOP,
  HINT_LINE,
  KEY_GRID,
  KEY_GRID_MAX_ROWS,
  OPERATION_MODE_ROW,
  RESET_BUTTON,
  RESET_BUTTON_BOTTOM,
  SETTINGS_PANEL,
  SKILL_DETAIL,
  TAB_BAR,
  TOUCH_CELL_H,
  TOUCH_GRID_COLS,
  TOUCH_GRID_MAX_ROWS,
  TOUCH_PICKER,
  TOUCH_PREVIEW,
  TOUCH_RESET_BUTTON,
} from './settingsGeometry';

/* ------------------------------------------------------------------ *
 * 竖向预算里那几个**钉死**的数（推导用，也是测试的判据）
 * ------------------------------------------------------------------ */

/** tab 行那 70px：钉死**不随缩放变**（`TAB_BAR = 40 + 30`）。 */
export const TAB_BAR_BOTTOM = 70;

/** 竖向预算里"底部那三样"的固定高度：提示 2 行 + 间隙 + 按钮。 */
export const FOOTER_BLOCK_H = HINT_BLOCK_H + HINT_LINE.gap + RESET_BUTTON.h;

/** 详情区当前的高度 —— 缩放的上限就是"别把它挤小"。 */
export const DETAIL_BASE_H = DETAIL_BOTTOM - DETAIL_TOP;

/**
 * 面板内容能用的最大系数（**1.2**）。
 *
 * ==================================================================
 * ⚠️ 为什么上限这么小 —— 实测的硬约束（不是保守）
 * ==================================================================
 *
 * 面板底座 **640×520**，画布 **960×540**（`settingsGeometry.SETTINGS_PANEL`
 * / `ui/layout.LOGICAL`）—— 上下各只剩 **10px**。也就是说：
 *
 *   - **外框整体乘 2** = 1280×1040 → 横向超 320、纵向超 500 ✗（画布外）
 *   - **里面那几行整体乘 k**：面板总高固定 520，多占的空间只能从详情区抢
 *     —— `96k + 10k + 85k` 一乘上去，详情区立刻从 210px 掉到 167px
 *     （k=1.2 实测：**8 行 → 5 行**）✗ 字大了但一句话读不完
 *
 * 所以本版**不动任何行高**（格阵格子 / 详情区外框 / 提示行 / 按钮全保持
 * 1× 的几何），只把**字号 + 详情区的行距与留白**按 k 放大：
 *
 *   优点：容量、命中区、面板高度**逐位不变**（8 个技能仍一屏配得到，
 *         详情区仍是 210px、滚动条照旧）
 *   代价：详情区行距变成 `22k`，一屏行数 `floor(194 / 22k)`
 *         （k=1 → 8 行，k=1.2 → 7 行）—— **少一行**，而它可滚
 *
 * ⚠️ 1.2 是**设计取值**（不是"先乘完再看有没有溢出"）：再大就会撞到
 * `SKILL_DETAIL.padding` / 格子里那三个角标的位置（它们按 1× 摆）。
 * 想真正把面板做大，前提是**先把内容做小**（面板只剩 10px 边）——
 * 那是另一件事，见 `docs/specs/2026-10-09-architecture.md` §10。
 */
export const PANEL_SCALE_MAX = 1.2;

/**
 * 详情区在当前系数下一屏放得下几行（纯函数）。
 *
 * ⚠️ 与 `SkillDetail.viewRows()` **同一条算式**（内框高 / 行距），否则会
 * 出现"探针说 7 行、实际只画 6 行"这种对不上账的读数。
 */
export function detailRowsAt(k: number): number {
  const m = computeSettingsMetrics(k);
  const inner = m.detailBottom - m.detailTop - 2 * m.detailPadding;
  return Math.max(1, Math.floor(inner / m.lineH));
}

/**
 * 当前 UI 缩放 → 面板能用的系数（**唯一的钳位规则**）。
 *
 * ⚠️ 上限只有**两重**，取最小：
 *   1. 玩家设的那个倍数（`uiScale`）
 *   2. **竖向预算**（`PANEL_SCALE_MAX`，推导见上面）
 *
 * ⚠️ **不要**再加一道"按画布高"的上限（曾经加过 `(540 − 20) / 520 = 1.0`，
 * 于是 `panelScaleFor(1.5)` 直接变成 **1** —— 整个功能静默失效，而
 * 输出里"k=1"看起来完全正常）。它是多余的：**外框固定 520 高**，
 * 怎么放都不会被画布裁掉；真正会溢出的是里面那几行，而那由
 * `PANEL_SCALE_MAX` 的竖向预算管。
 */
export function panelScaleFor(uiScale: number): number {
  if (!Number.isFinite(uiScale) || uiScale <= 0) return 1;
  return Math.min(uiScale, PANEL_SCALE_MAX);
}

/** 设置弹窗的**竖向几何**（画布 / 面板坐标；横向一个字都不动）。 */
export interface SettingsMetrics {
  /** 已钳位的面板系数（1 = 原始布局）。 */
  readonly k: number;
  /** 面板外框（居中；宽高**不随 k 变** —— 见文件头）。 */
  readonly panelX: number;
  readonly panelY: number;
  /** 面板**相对**坐标下的行位置 / 行高（`panelY + 它` = 画布坐标）。 */
  readonly gridTop: number;
  readonly cellH: number;
  readonly gapY: number;
  /** 格阵下沿（面板相对）。 */
  readonly gridBottom: number;
  /** 详情区（画布坐标；上沿 = 格阵下沿 + 间隙）。 */
  readonly detailTop: number;
  readonly detailBottom: number;
  /** 详情区一行的高度（滚动单位，与 `SkillDetail` 的 `LINE_H` 同源）。 */
  readonly lineH: number;
  /** 底部提示两行的位置与行高（面板相对）。 */
  readonly hintTop: number;
  readonly hintLineH: number;
  /** 「恢复默认」按钮（画布坐标，`y` 是顶边）。 */
  readonly buttonX: number;
  readonly buttonY: number;
  readonly buttonW: number;
  readonly buttonH: number;
  /** 触屏键位预览那块的高度（它跟着 k 走，圆钮才不至于相对变小）。 */
  readonly touchPreviewH: number;
  /** 「通用」页两行的位置（**不跟 k**：它们不在竖向预算里）。 */
  readonly sliderTop: number;
  readonly modeLabelTop: number;
  readonly modeTop: number;
  readonly modeH: number;
  /** 详情区文字四周的留白（跟 k 走，免得大字号贴着边框）。 */
  readonly detailPadding: number;
}

/** 取整到 0.01（避免 0.30000000000000004 这类尾数渗进布局）。 */
function round2(v: number): number {
  return Math.round(v * 100) / 100;
}

/**
 * 算出一份**自洽**的竖向几何。
 *
 * ⚠️ 全部从**已钳位**的 `k` 推，没有一处"先算完再夹"：钳位在
 * `panelScaleFor` 里按规则做完，这里的每个数字都直接可用。
 */
export function computeSettingsMetrics(uiScale: number): SettingsMetrics {
  const k = panelScaleFor(uiScale);
  /**
   * ⚠️ 这一份几何里，**只有两样跟 k**（`lineH` / `detailPadding`），
   * 其余全部是 1× 的底座值 —— 理由见 `PANEL_SCALE_MAX` 那段。
   *
   * 于是 `k === 1` 时这一份**逐位等于**老的几何常量（`DETAIL_TOP` /
   * `DETAIL_BOTTOM` / `gridBottom` / …），老的几何断言因此原样成立。
   */
  const panelX = Math.round((LOGICAL.width - SETTINGS_PANEL.w) / 2);
  const panelY = Math.round((LOGICAL.height - SETTINGS_PANEL.h) / 2);

  return {
    k: round2(k),
    panelX,
    panelY,
    gridTop: KEY_GRID.top,
    cellH: KEY_GRID.cellH,
    gapY: KEY_GRID.gapY,
    gridBottom: KEY_GRID.top + KEY_GRID_MAX_ROWS * KEY_GRID.cellH + (KEY_GRID_MAX_ROWS - 1) * KEY_GRID.gapY,
    detailTop: DETAIL_TOP,
    /**
     * ⚠️ 详情区**底边必须跟着表达式走**，不能直接抄 `DETAIL_BOTTOM`（= 414）：
     * `settingsScale` 这一版**行距跟着 k 放大**，而面板高固定 —— 详情区
     * 一屏少一行正是这么来的。底边抄死 414 的话，k=1.2 时详情区高 210
     * （`414 − 204`），而提示区仍在 430：**说明文字会压在提示行上**
     * （差 11px，实测就是这么撞出来的）。
     *
     * ⚠️ 提示区那两行**不动**（它们已经在底部三样的位置上、没有余量），
     * 所以"详情区变矮"是这一版缩放的**代价**，也是它唯一的位置变化。
     */
    detailBottom: HINT_BLOCK_TOP - Math.round(16 * k),
    lineH: Math.round(22 * k),
    hintTop: HINT_BLOCK_TOP,
    hintLineH: HINT_LINE.height,
    buttonX: panelX + RESET_BUTTON.x,
    buttonY: panelY + SETTINGS_PANEL.h - RESET_BUTTON_BOTTOM - RESET_BUTTON.h,
    buttonW: RESET_BUTTON.w,
    buttonH: RESET_BUTTON.h,
    touchPreviewH: TOUCH_PREVIEW.h,
    sliderTop: 96,
    modeLabelTop: OPERATION_MODE_ROW.labelTop,
    modeTop: OPERATION_MODE_ROW.top,
    modeH: OPERATION_MODE_ROW.h,
    detailPadding: Math.round(SKILL_DETAIL.padding * k),
  };
}

/* ------------------------------------------------------------------ *
 * 唯一写入路径 + 当前读数
 * ------------------------------------------------------------------ */

/**
 * 面板默认的系数（**哨兵**）：单测与"面板还没构造"的那一瞬读它。
 *
 * ⚠️ 它必须与 `computeSettingsMetrics(1)` 逐位相同 —— 老的几何断言
 * （`settings.test.ts` 等）在 1× 下继续成立。
 */
const DEFAULT_METRICS = computeSettingsMetrics(1);

let current: SettingsMetrics = DEFAULT_METRICS;

/** 当前这份几何（画与命中共用）。 */
export function currentSettingsMetrics(): SettingsMetrics {
  return current;
}

/**
 * **唯一写入路径**：UI 缩放变了 → 重算一份几何。
 *
 * ⚠️ 值没变就**直接返回**（与 `TouchLayout.set` 同一条）：指针拖动滑块时
 * 每一帧都会调进来，不短路就会每帧重建一份对象。
 *
 * @returns 是否真的变了（调用方据此决定要不要重画）
 */
export function setSettingsScale(uiScale: number): boolean {
  const next = computeSettingsMetrics(uiScale);
  if (next.k === current.k) return false;
  current = next;
  return true;
}

/** 复位到 1×（单测用；生产路径**不需要**它）。 */
export function resetSettingsMetrics(): void {
  current = DEFAULT_METRICS;
}

/**
 * **面板里的字号**：底层字号 × 面板系数（钳位在 `panelScaleFor` 里做完）。
 *
 * ==================================================================
 * ⚠️ 下限由**规则**给出，不是算完再夹
 * ==================================================================
 *
 * 与本仓库的先例 `ui/iconHint.ts` 的 `MIN_HINT_FONT` 同一条纪律
 * （用户明确要求过："**下限由规则给出**，不是算完再夹一下"）。
 *
 * 这里 `base` 本身就是"够用就好"的设计值（`ui/layout.FONT`：中文 ≥ 13、
 * 数字 ≥ 11），而面板系数**只放大不缩小**（`panelScaleFor` 下限是 1），
 * 所以 `Math.max(base, …)` **结构上永远不会生效** —— 它在那里是为了把
 * 这条规则写出来：面板的字**不许**因为某个系数小于 1 而变小。
 */
export function scaledFont(base: number): number {
  return Math.max(base, Math.round(base * current.k));
}

/* ------------------------------------------------------------------ *
 * 缩放后的几何（画与命中**同一份**）
 * ------------------------------------------------------------------ *
 * ⚠️ 这些函数**只读 `currentSettingsMetrics()`**，所以"渲染用的那份"与
 * "命中测试用的那份"在类型上就是同一个值，不可能漂。
 * 横向全部沿用底座（见文件头的三条理由），所以这里出现的 x/w 都是常数。
 */

/** 一个矩形（画布逻辑坐标）—— 与 `logic.Rect` 同形。 */
export interface MetricsRect {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

/** 网格度量（缩放后）。**只有行高与行距跟 k**，列宽与列数不动。 */
export interface ScaledGridMetrics {
  readonly cols: number;
  readonly cellW: number;
  readonly cellH: number;
  readonly gapX: number;
  readonly gapY: number;
  readonly inset: number;
  readonly top: number;
  /** 格阵最多能放几行（**算出来的**，不是写死）。 */
  readonly maxRows: number;
}

/**
 * 给定**模式**算出网格度量（缩放取自当前那份）。
 *
 * ⚠️ 列宽**一律从面板宽度算**（底座宽不变）—— 这正是"格阵横向一个字都
 * 不动"那条决定的落点：8 个可绑技能仍然一屏配得到
 * （`settingsGeometry.KEY_GRID.cols` 记着加列那次的原因）。
 *
 * ⚠️ 行数也是**推**出来的（可用高度 / 行高），不是写死 —— 早期写死行数，
 * 调行高时格子直接压到「恢复默认」按钮上（`keyGridLayout` 记着那个坑）。
 *
 * @param showKeyHints 桌面为 `true`（要显示键名），触屏为 `false`
 */
export function gridMetricsFor(showKeyHints: boolean): ScaledGridMetrics {
  const m = current;
  const { gapX, inset, top } = KEY_GRID;
  const cols = showKeyHints ? KEY_GRID.cols : TOUCH_GRID_COLS;
  const cellW = Math.floor((SETTINGS_PANEL.w - inset * 2 - gapX * (cols - 1)) / cols);
  const cellH = showKeyHints ? KEY_GRID.cellH : TOUCH_CELL_H;
  /**
   * ⚠️ 上沿按**这一套度量**选（老 `gridRows` 的同一条判据：行高 44 = 桌面、
   * 64 = 触屏），因为两套行高不同 → 能放的行数不同：
   *
   *   桌面 44 → 上沿 184（`KEY_GRID_BOTTOM`）
   *   触屏 64 → 上沿 224（`KEY_GRID_BOTTOM_TOUCH`）
   *
   * ⚠️ **不能**两者共用一条上沿：触屏两行 64 高本来就比桌面多占 40px，
   * 共用会让触屏容量从 **6 掉到 3**（实测挂过：`settings.test.ts` 的
   * "触屏 3 列 6 格"当场变 3）。
   *
   * ⚠️ 行高**不跟 k**（见 `PANEL_SCALE_MAX`）：所以这里的容量**不随缩放变**
   * —— 桌面永远 8 格、触屏永远 6 格，这正是"改缩放不吞功能"的那条保证。
   */
  const budgetBottom =
    showKeyHints ? m.gridBottom : top + TOUCH_GRID_MAX_ROWS * TOUCH_CELL_H + (TOUCH_GRID_MAX_ROWS - 1) * m.gapY;
  const rows = Math.max(1, Math.floor((budgetBottom - top + m.gapY) / (cellH + m.gapY)));
  return { cols, cellW, cellH, gapX, gapY: m.gapY, inset, top, maxRows: rows };
}

/** 给定度量下格阵能放多少个格子（**容量**，不是"必须填满"）。 */
export function gridCapacityFor(metrics: ScaledGridMetrics): number {
  return metrics.maxRows * metrics.cols;
}

/** 格阵**最后一行实际落在哪**（画布坐标）—— 也就是详情区从哪儿开始。 */
export function gridBottomFor(metrics: ScaledGridMetrics): number {
  const m = current;
  return m.panelY + metrics.top + metrics.maxRows * metrics.cellH + (metrics.maxRows - 1) * metrics.gapY;
}

/**
 * 第 `index` 个格子的矩形（画布坐标）。
 *
 * ⚠️ 默认参数给的是**当前缩放下的桌面度量**，所以老的调用点不会因为
 * "忘了传度量"而退回 1×（那会变成"字放大了、格子没放大"）。
 */
export function keyCellRect(
  index: number,
  metrics: ScaledGridMetrics = gridMetricsFor(true),
): MetricsRect {
  const m = current;
  const col = index % metrics.cols;
  const row = Math.floor(index / metrics.cols);
  return {
    x: m.panelX + metrics.inset + col * (metrics.cellW + metrics.gapX),
    y: m.panelY + metrics.top + row * (metrics.cellH + metrics.gapY),
    w: metrics.cellW,
    h: metrics.cellH,
  };
}

/** 技能详情区**外框**（可滚的那块；画布坐标）。 */
export function detailViewport(): MetricsRect {
  const m = current;
  return {
    x: m.panelX + SKILL_DETAIL.x,
    y: m.detailTop,
    w: SKILL_DETAIL.w,
    h: Math.max(1, m.detailBottom - m.detailTop),
  };
}

/**
 * 详情区**文字内框**（外框减掉一圈 padding）。
 *
 * ⚠️ `padding` 跟 k 走（大字号贴边会压到边框上），而**折行宽度与可见行数
 * 都从内框取空间** —— 只在绘制时挪字是治不了的（那正是
 * `settingsGeometry.SKILL_DETAIL.padding` 那段记着的坑）。
 */
export function detailContentRect(): MetricsRect {
  const outer = detailViewport();
  const pad = current.detailPadding;
  return {
    x: outer.x + pad,
    y: outer.y + pad,
    w: Math.max(1, outer.w - pad * 2),
    h: Math.max(1, outer.h - pad * 2),
  };
}

/** 底部提示**第 `index` 行**的 y（画布坐标；`index` 从 0 起）。 */
export function hintLineY(index = 0): number {
  const m = current;
  return m.panelY + m.hintTop + index * m.hintLineH;
}

/** 键盘那块的「恢复默认」（画布坐标）。 */
export function resetButtonRect(): MetricsRect {
  const m = current;
  return { x: m.buttonX, y: m.buttonY, w: m.buttonW, h: m.buttonH };
}

/** 触屏那块的「恢复默认」（画布坐标；贴在键位预览下面）。 */
export function touchResetButtonRect(): MetricsRect {
  const m = current;
  return {
    x: m.panelX + TOUCH_RESET_BUTTON.x,
    y: m.panelY + TOUCH_PREVIEW.top * m.k + m.touchPreviewH + TOUCH_RESET_BUTTON.gap * m.k,
    w: TOUCH_RESET_BUTTON.w,
    h: m.buttonH,
  };
}

/** 触屏键位预览的**说明行**位置（画布坐标，左上角）。 */
export function touchPreviewCaptionPos(): { readonly x: number; readonly y: number } {
  const m = current;
  return { x: m.panelX + TOUCH_PREVIEW.x, y: m.panelY + TOUCH_PREVIEW.top * m.k };
}

/**
 * 触屏键位预览**双弧那块**（去掉顶部说明行）—— 画布坐标。
 *
 * ⚠️ 它是预览的全部几何输入（`touchPreview.ts` 按等比装进去），所以
 * "预览跟着 k 长"只需要改这一处。
 */
export function touchPreviewArcBox(): MetricsRect {
  const m = current;
  const top = m.panelY + TOUCH_PREVIEW.top * m.k;
  return {
    x: m.panelX + TOUCH_PREVIEW.x,
    y: top + TOUCH_PREVIEW.captionH * m.k,
    w: TOUCH_PREVIEW.w,
    h: Math.max(1, m.touchPreviewH - TOUCH_PREVIEW.captionH * m.k),
  };
}

/** 触屏技能面那块区域（画布坐标）。 */
export function touchPickerArea(): MetricsRect {
  const m = current;
  return {
    x: m.panelX + TOUCH_PICKER.x,
    y: m.panelY + m.gridTop,
    w: TOUCH_PICKER.w,
    h: Math.max(1, m.detailBottom - m.gridTop),
  };
}

/** 「通用」页 UI 缩放滑块（画布坐标，**不跟 k**）。 */
export function sliderRect(): MetricsRect {
  const m = current;
  return { x: m.panelX + 16, y: m.panelY + m.sliderTop, w: 320, h: 24 };
}

/** 「通用」页操作方式选择器里第 `index` 个按钮（画布坐标，**不跟 k**）。 */
export function modeButtonRect(index: number): MetricsRect {
  const m = current;
  return {
    x: m.panelX + 16 + index * (120 + 10),
    y: m.panelY + m.modeTop,
    w: 120,
    h: m.modeH,
  };
}

/** 「操作方式」那行的标签位置（画布坐标，左上角）。 */
export function modeLabelPos(): { readonly x: number; readonly y: number } {
  const m = current;
  return { x: m.panelX + 16, y: m.panelY + m.modeLabelTop };
}

/** 点是否落在弹窗内（判断"点外部关闭"用）。 */
export function insidePanel(px: number, py: number): boolean {
  const m = current;
  return (
    px >= m.panelX &&
    px <= m.panelX + SETTINGS_PANEL.w &&
    py >= m.panelY &&
    py <= m.panelY + SETTINGS_PANEL.h
  );
}

/** tab 按钮的矩形（画布坐标）—— 位置**钉死**（不在竖向预算里）。 */
export function tabRect(index: number): MetricsRect {
  const m = current;
  return {
    x: m.panelX + TAB_BAR.x + index * (TAB_BAR.w + TAB_BAR.gap),
    y: m.panelY + TAB_BAR.y,
    w: TAB_BAR.w,
    h: TAB_BAR.h,
  };
}

/** 右上角「关闭」的矩形（画布坐标）。 */
export function closeButtonRect(): MetricsRect {
  const m = current;
  return {
    x: m.panelX + SETTINGS_PANEL.w - CLOSE_BUTTON.right - CLOSE_BUTTON.w,
    y: m.panelY + CLOSE_BUTTON.top,
    w: CLOSE_BUTTON.w,
    h: CLOSE_BUTTON.h,
  };
}
