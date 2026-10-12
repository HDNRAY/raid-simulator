/**
 * **图标按钮的键位提示：几何**（纯函数，不碰 Pixi）。
 *
 * ==================================================================
 * 摆法：**并排**（图标在一侧、提示在另一侧）—— 恢复历史那一版
 * ==================================================================
 *
 * ⚠️ 2026-10-12 用户原话："设置按钮的 快捷键 **无法找到之前好的那个版本的
 * 位置了吗**？？"
 *
 * 他指的是**最早那一版**（`d4e3fb7` 的 `IconButton`）：
 *
 * ```ts
 * readonly hintSide?: 'left' | 'right';        // ← 只有这两个值
 * hintSide: 'right' as const,                   // ← 默认
 * //   "图标在左、提示在右（阅读顺序）；`hintSide` 可以翻转。"
 * ```
 *
 * 也就是 **`⚙ F1` / `F1 ⚙` 这种并排排法**，提示与图标**同一行、垂直居中**。
 *
 * ⚠️ 中间那两轮把它改成了"角标"（`291a005` 引入 `hintSide: 'corner'`，
 * 把提示压到图标左上角里；`4fa55ef` 又把它挪成"提示左上角 = 图标左上角"）。
 * 那两轮的依据是把用户那句"快捷键在图标的**左上角**"读成了"**角标**贴在
 * 图标左上角" ✗ —— 而现在看，他说的很可能是"提示在图标**左边**"
 * （`hintSide: 'left'`）。**这是理解错了方向**，所以现在照历史那版恢复，
 * 不自己再发明第三种摆法。
 *
 * ==================================================================
 * ⚠️ 哪一侧**是每个按钮自己的配置**，不是"按画布哪一半"的运行时分支
 * ==================================================================
 *
 * 用户否掉的是**后者**（旧 `hintCorner: 'auto'`：按按钮在画布哪一半自动翻边，
 * 于是"左上角的返回"和"右上角的齿轮"看起来是两套算法）。
 *
 * 现在这一侧由每个调用点**显式**写死，理由也只是几何上的：
 *
 * | 按钮 | 位置 | `hintSide` | 为什么 |
 * |---|---|---|---|
 * | 齿轮（整屏界面） | 右上 | `'left'` | 提示放右边会顶出画布右缘 |
 * | 返回箭头 | 左上 | `'right'` | 提示放左边会顶出画布左缘 |
 * | 战斗齿轮 | 左下 | `'right'` | 同上 |
 *
 * 而**落位公式只有一条**（`iconHintPlacement`）：提示与图标同一行、
 * 垂直居中、按 `hintSide` 决定在左还是在右。三个调用点走的是同一条公式，
 * 只是喂了不同的 `hintSide` —— 这正是"一条规则 + 每个按钮的配置"。
 *
 * ==================================================================
 * ⚠️ 提示整块**跟着图标缩放**（用户要求，与摆法是两件事）
 * ==================================================================
 *
 * 上一轮"提示故意不缩"的判断被用户推翻了，现在的规格是：
 * 字号 + 落位**跟图标一起缩**，而且**一条公式**（只有图标边长一个输入）：
 *
 *     字号 = max(MIN_HINT_FONT, round(hintFont × size / BASE_ICON))
 *
 * ⚠️ **下限由规则给出**（`MIN_HINT_FONT = 8`），不是"算完再夹一下"：
 * 0.5 倍时按比例是 `round(13 × 0.5) = 7`，而 7px 的中文/大写字母已经糊成
 * 一团（`FONT.small` 是 13，那是本作中文的下限；提示是拉丁字母 + 数字，
 * 可以更小，但 8 是还能一眼认出来的下限）。它只在缩放 < 0.615 时生效。
 *
 * ⚠️ 上限不需要：提示永远只有图标的一半高（比例固定），不会抢过图标。
 *
 * ==================================================================
 * ⚠️ 为什么这些算术单独一个文件（AGENTS.md §3：关注分离）
 * ==================================================================
 *
 * 原来它们住在 `ui/IconButton.ts` 里，而那个文件本身是"一个组件"
 * （构造 Pixi 节点、命中测试、悬停 / 焦点外观）—— **"提示画在哪、多大"
 * 是另一件事**，它有三个消费者：
 *
 *   1. `IconButton` 自己（画那行提示、算包围盒）
 *   2. `ScreenChrome`（按"图标 + 提示整块"反推齿轮该摆在哪 —— 本轮
 *      "齿轮在任何缩放下都不出画布"那条规则的落点）
 *   3. 单测（`tests/unit/iconButtonHint.test.ts` / `iconButton.test.ts`）
 *
 * 而且 `IconButton.ts` 当时已经 682 行（贴着 700 的上限）。**不许靠压注释
 * 腾地方**，所以按职责切开：几何 + 它的常量搬到这里，组件文件只留
 * "造 / 画 / 命中"。
 */

/** 提示与图标之间的间隙（逻辑像素，**不随缩放**：它是排版间距）。 */
export const HINT_GAP = 4;

/** 基准图标边长 —— 比例的分母（`hintFont` 说的是这一档）。 */
export const BASE_ICON_SIZE = 20;

/**
 * 基准字号：20px 图标时提示用 13px。
 *
 * ⚠️ 这就是历史那一版的值（`FONT.small`，见 `d4e3fb7` 的 `IconButton`：
 * `size: FONT.small, color: PALETTE.textDim`）—— 并排摆法下提示与图标
 * **同一行**，所以它比"角标"那版（9px）大一圈是**对的**：
 * 它不是附注，而是与图标并排的说明。
 *
 * ⚠️ 值必须与 `ui/layout.ts` 的 `FONT.small` 一致（提示是 UI 文字，
 * 字号表只有一处）。这里冗余一份是**为了不让几何模块 import 布局表** ——
 * 布局表会反过来被渲染层批量使用，几何模块保持"只认识输入"更干净。
 * `tests/unit/iconButtonHint.test.ts` 有一条断言钉住两者相等。
 */
export const BASE_HINT_FONT = 13;

/**
 * 提示字号的**下限**（px）—— 缩放规则自己给出的那一条。
 *
 * 0.5 倍时按比例算出来是 `round(13 × 0.5) = 7`，而 7px 的字已经认不出
 * 字形（提示是拉丁字母 + 数字，8 是还能一眼读出的下限）。
 *
 * ⚠️ 它**不是**"算完再夹一下"：规则本身写成
 * `max(MIN_HINT_FONT, round(hintFont × size / 20))`，所以"任何缩放系数下
 * 都看得清"是**规则的一部分**，不是第二套兜底。
 */
export const MIN_HINT_FONT = 8;

/**
 * 提示的**字号**（按图标边长推）。
 *
 * 非整数 `size` 也接受（`Math.round` 收敛），但调用方给的都是整数
 * （`chromeBoxAt` / `computeContentBox` 都取整过）。
 */
export function iconHintFontSize(size: number): number {
  const scaled = Math.round(BASE_HINT_FONT * (size / BASE_ICON_SIZE));
  return Math.max(MIN_HINT_FONT, scaled);
}

/**
 * 估算等宽字体下一段文字的宽度。
 *
 * 存在的理由：`Text` 的宽度要等纹理生成才有值，而命中矩形必须在
 * 布局期定下来。等宽字体的字宽是稳定的（约 0.6em），所以估算足够准；
 * 这里取 0.62 并向上取整，**宁宽勿窄** —— 估窄了会出现
 * "看起来在按钮里、点不到"，以及"看着没出画布、实际被裁"。
 */
export function estimateMonoWidth(text: string, fontSize: number): number {
  return Math.ceil(text.length * fontSize * 0.62) + 4;
}

/** 提示文字的**包围盒尺寸**（估算；与命中区域、落位用同一套估算）。 */
export function iconHintBoxSize(
  shortcut: string,
  size: number,
): { readonly w: number; readonly h: number } {
  const fontSize = iconHintFontSize(size);
  return { w: estimateMonoWidth(shortcut, fontSize), h: fontSize };
}

/**
 * **图标 + 提示**整块的包围盒（并排：宽度是两段之和，高度取较大者）。
 *
 * 用途是"反推图标该摆在哪儿"：想把整块摆进画布 / 摆到某个角上，
 * 必须先知道它多大 —— 而提示多大是**这条规则**算出来的，不是调用方
 * 自己估的（各估一次必然漂，表现就是"看起来在画布内、实际被裁"）。
 *
 * ⚠️ 宽度取**完整**的提示框宽（含 `estimateMonoWidth` 那 4px 余量）——
 * 并排时提示的右边与图标的左边只差一个 `gap`，所以这个余量是**保守**的
 * （宁宽勿窄），不会把整块算小。
 */
export function iconWithHintSize(
  shortcut: string,
  size: number,
): { readonly w: number; readonly h: number } {
  const hint = iconHintBoxSize(shortcut, size);
  return { w: size + HINT_GAP + hint.w, h: Math.max(size, hint.h) };
}

/** 提示在**图标的哪一侧**（并排摆法；每个调用点显式选一个）。 */
export type HintSide = 'left' | 'right';

/** 落位要看的几何：图标矩形、提示尺寸、提示在哪一侧、画布多大。 */
export interface IconHintInput {
  readonly icon: { readonly x: number; readonly y: number; readonly w: number; readonly h: number };
  readonly hintW: number;
  readonly hintH: number;
  /** 提示在图标左侧还是右侧（见 `HintSide`）。 */
  readonly side: HintSide;
  readonly canvasW: number;
  readonly canvasH: number;
}

/** 提示左上角要落到哪儿 —— 以及它的锚点（永远是左上角）。 */
export interface IconHintPlacement {
  readonly x: number;
  readonly y: number;
  readonly anchorX: number;
  readonly anchorY: number;
}

/**
 * 提示的**落位** —— 纯函数（可在 node 里测，不碰 Pixi）。
 *
 * ==================================================================
 * 规则（一条，两个方向共用）
 * ==================================================================
 *
 * ```ts
 * y = 图标的垂直中心 − 提示高 / 2      // 并排：两段在同一行、垂直居中
 * x = side === 'left'
 *       ? 图标左缘 − gap − 提示宽      // 提示在左：它的右缘贴住图标左缘
 *       : 图标右缘 + gap               // 提示在右：它的左缘贴住图标右缘
 * ```
 *
 * 锚点固定是提示的**左上角**（`anchorX/Y = 0`）。
 *
 * ⚠️ **没有"看按钮在画布哪一半"的分支** —— `side` 是**调用方给的配置**
 * （每个按钮自己知道哪边有地方），不是从坐标推出来的。用户否掉的是
 * "运行时按位置猜"，不是"每个按钮选一侧"。
 *
 * ⚠️ **不做越界避让**（没有夹取、没有第二套逻辑）—— 用户明确否掉了
 * （"别再加第二套避让逻辑"）。所以这里**故意不写兜底**：真有调用方把
 * 图标放到会溢出的位置，那是**它自己**的 bug，应当在截图/测试里看见，
 * 而不是被一段夹取悄悄推回来。
 *
 * ⚠️ 于是"整块在画布内"必须在**摆图标**那条规则里保证 —— 见
 * `ScreenChrome.chromeBlockBoxAt`（先算整块多大，再从画布边缘反推图标
 * 位置）。`canvasW` / `canvasH` 仍在入参里（调用方要说明"这块提示是画在
 * 哪张画布上的"，纯函数测试也靠它们做对账），但**规则本身不使用它们**。
 */
export function iconHintPlacement(input: IconHintInput): IconHintPlacement {
  const { icon, hintW, hintH, side } = input;
  return {
    x: side === 'left' ? icon.x - HINT_GAP - hintW : icon.x + icon.w + HINT_GAP,
    y: icon.y + icon.h / 2 - hintH / 2,
    anchorX: 0,
    anchorY: 0,
  };
}
