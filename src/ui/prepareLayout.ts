/**
 * **自由模式（备战屏）的几何**：常量 + 命中区域 + 详情区矩形。
 *
 * ==================================================================
 * 这个文件是什么（一句话，没有"和"）
 * ==================================================================
 *
 * 它是这一屏的**唯一一张布局表**：谁能占哪块地方、卡片多大、哪一块展开、
 * 详情区在哪一边 —— 渲染层与命中测试读的是**同一份几何**，所以"看到的
 * 卡片"与"点中的卡片"结构上不可能错位。
 *
 * ==================================================================
 * 为什么从 `prepareLogic.ts` 切出来（AGENTS.md §3 的"关注分离"）
 * ==================================================================
 *
 * 原来两者在一个文件里（`prepareLogic.ts` 414 行），而它们是**两件事**：
 *
 * | 文件 | 回答的问题 |
 * |---|---|
 * | 本文件 | "这一屏长什么样"（纯几何：矩形、网格、不重叠） |
 * | `prepareLogic.ts` | "光标/选择怎么走"（状态机：方向键、Enter、点击） |
 *
 * ==================================================================
 * 2026-10-13（第二轮）：**手风琴** —— 同一时间只展开一块
 * ==================================================================
 *
 * 用户原话：
 *
 * > "同一时间只展开暂时 3 个选择中的一个，其他的收起来，只展示当前选择"
 * > "收起来的那两块要显示'当前选了什么'"
 *
 * 几何上的落点只有一条：**一块的内容高度取决于它是不是展开的那一块**。
 *
 * ```
 *   展开的那块 = 它自己的卡片网格（`cardGrid` 折行）
 *   收起的那两块 = 一条**块头**（`foldH` 高，横跨整个卡片列）
 * ```
 *
 * ⚠️ 于是**三块的高度之和不再是常量**（旧版三块同时展开 = 224px）：
 * 展开不同的一块，整条纵向链自己重排（`rowTopsOf` 按 `expanded` 递推）。
 * 这正是"540 里挤不下"的解法 —— 同时只展开一块，纵向立刻省下 ~54px。
 *
 * ⚠️⚠️ **顺序（用户 2026-10-13 明确指定）：人物 → 炁机 → 对手**。
 * 它只写在 `SECTION_ORDER` 与 `rowTopsOf` 的**递推顺序**里，别处不许再写
 * 一遍（`PrepareScreen` 与命中测试都按 `SECTION_ORDER` 遍历）。
 *
 * ==================================================================
 * ⚠️ 卡片尺寸是**算出来**的，不是手调的
 * ==================================================================
 *
 * 需求要"卡片尽量缩小"，但那有个**下限**：卡片是**交互**（点击/触屏要能
 * 点中），且名字读得出来。所以两个下限先算出来，卡片尺寸取它们：
 *
 * ```
 *   内容下限（宽）= 两侧内边距 + 头像 + 间距 + 两个汉字（见 CARD_CONTENT_W）
 *   内容下限（高）= 名字行高 + 上下内边距（见 NAME_LINE_H + CARD_PAD_Y）
 *   手指下限 = TOUCH_MIN（**逻辑像素**；依据见那个常量的说明）
 *   卡片高 = max(内容下限, 手指下限)      → 40
 *   卡片宽 = max(内容下限, 手指下限)      → 92（`cardMinW`）
 * ```
 *
 * ⚠️ **`cardMinW` 是"这一屏任何一张卡都不许更窄"的硬约束**，`cardGrid`
 * 取 `max(cardMinW, 按列等分)`：取到下限时**可能溢出列宽**，那是"该分
 * 更多行 / 列数太多"的信号 —— 布局测试里有一条"整块不越出卡片列"会先
 * 失败，比默默缩到点不中好。
 */

import type { PrepareFocus, PrepareSectionKind } from './prepareTypes';

/** 一块可点区域。 */
export interface PrepareHitArea {
  readonly kind: PrepareHitKind;
  /**
   * 卡片 = 那一项的 id；**块头**（`kind === 'summary'`）= 它代表哪个槽位
   * （`'player'` / `'qiji'` / `'boss'`）；开始键 = `'start'`。
   */
  readonly id: string;
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

/**
 * 可点区域的类别。
 *
 * ⚠️ `'summary'`（收起态的**块头**）与三个卡片槽位是**不同**的可点物：
 * 点卡片 = 选它 / 改它的层数，点块头 = **只把它展开**（不改选择）。
 * 合成一个 kind 会让"点收起的那一块"顺手把选择改掉。
 */
export type PrepareHitKind = PrepareFocus | 'summary';

/**
 * 画面上从上到下的三块。
 *
 * ⚠️ **顺序的唯一出处**：用户 2026-10-13 要求「先选炁机，再选 boss」
 * （炁机是"选了人物之后"的动作，对手是"打谁"，排在最后）。
 */
export const SECTION_ORDER: readonly PrepareSectionKind[] = ['player', 'qiji', 'boss'];

/** 三块各自的张数（行顶递推的输入）。 */
export interface PrepareCounts {
  readonly players: number;
  readonly bosses: number;
  readonly qiji: number;
}

export interface PrepareLayout {
  readonly width: number;
  readonly height: number;
  readonly pad: number;
  /** 人物卡那一列的可用宽度（起点 `pad`，终点 `pad + playerColW`）。 */
  readonly playerColW: number;
  /** 对手卡那一列（Boss 折行时按顺序摊行）。 */
  readonly bossColW: number;
  /** 炁机那一列（比 Boss 列窄一档，让它 5 列一行 —— 见 `qijiColumns`）。 */
  readonly qijiColW: number;
  /** 各槽位的目标列数（`cardGrid` 在张数更少时会自动减列）。 */
  readonly playerColumns: number;
  readonly bossColumns: number;
  readonly qijiColumns: number;
  readonly cardGap: number;
  /** 文字卡（人物 / Boss：名字 + 头像）的高度。 */
  readonly cardH: number;
  /** 炁机卡的高度。 */
  readonly qijiCardH: number;
  /** 卡片内边距（**横向**：文字/头像离卡片左右边框的距离）。 */
  readonly cardPad: number;
  /** 卡片内边距（**纵向**：名字行上下各留多少）。 */
  readonly cardPadY: number;
  /** 名字与头像之间的间距。 */
  readonly nameAvatarGap: number;
  /**
   * 头像的**包围盒边长**（正方形，逻辑像素）。
   *
   * 需求原文："高度比名字高一点点"。名字是 `nameSize`(17)，行高
   * `nameLineH`(23)；这里取 **26** —— 比行高高 3px（"高一点点"），
   * 又远小于卡片高(40)，不会把卡片顶开。
   *
   * ⚠️ 素材本身是 80×80（`public/fd2/portraits/*.png`），这里是**显示
   * 尺寸**。缩放比由渲染层按它算（`26 / 80`），不要在渲染层手写比例。
   */
  readonly portraitBox: number;
  /**
   * **卡片的可读性下限**（逻辑像素宽）—— "尽量缩小"的**边界**，不是建议值。
   *
   * 推导：两侧内边距 2 × 12 + 头像 26 + 间距 8 + 名字 2 个汉字（2 × 17 = 34）
   * = **92**；炁机卡没有头像、名字是 4 个汉字（4 × 17 = 68），加起来
   * 恰好**也是 92**（26 + 8 + 34 = 68）。再与 `TOUCH_MIN` 取大者。
   *
   * ⚠️ 实测：7 个 Boss 摊 5 列 → 110、8 条炁机摊 5 列 → 102，所以下限
   * 今天是**没有生效**的那一条 —— 它会在列数更多 / 卡片列更窄时先失败
   * （布局测试有一条"不窄于下限"）。
   */
  readonly cardMinW: number;
  /** 名字字号（= `FONT.title`；写在这里是为了让"名字行高"可算）。 */
  readonly nameSize: number;
  /**
   * 名字**行高**（逻辑像素）。
   *
   * ⚠️ 它是"头像比名字高一点点"这句话里**名字那一半**的量化：中文行框
   * 约 `1.3 × 字号`（与 `tests/unit/prepareLayout.test.ts` 同一口径）。
   */
  readonly nameLineH: number;
  /** 主标题的基线 y。 */
  readonly titleY: number;
  /** 标题下缘到卡片顶边的间距（`rowGap` 与它分工，见 `rowTopsOf`）。 */
  readonly labelGap: number;
  /** **块与块之间**的额外空隙（上一块底边 → 下一块标题顶部）。 */
  readonly rowGap: number;
  /** 栏目标题（「选择人物」/「炁机」/「选择对手」）的字号。 */
  readonly labelSize: number;
  /**
   * **收起态那一块（块头）的高度**。
   *
   * ⚠️ 它 = `TOUCH_MIN`：块头是"点一下展开"的**主要触屏入口**（§3b 要求
   * 纯触屏也能展开），所以要占满一根手指的落点。它恰好等于 `cardH`，
   * 于是"人物那一块展开/收起时高度一样"（3 张卡正好一行）—— 切换时
   * 下面的两块不会跳。
   */
  readonly foldH: number;
  /** 「开始战斗」的宽度。 */
  readonly startW: number;
  readonly startH: number;
  /**
   * 最后一块底边 → 「开始战斗」顶边的间距。
   *
   * ⚠️ 按钮的 y **不再是一个写死的数**（旧的 `startY`）：它由
   * `startRect()` 按"三块里最高的一种展开方式"算出来 —— 见那个函数。
   */
  readonly startGap: number;
  /** 详情区（右侧通高一块）。 */
  readonly detailX: number;
  readonly detailY: number;
  readonly detailW: number;
  readonly detailH: number;
  readonly detailPad: number;
}

/* ------------------------------------------------------------------ *
 * 下限：先算出来，再让"尺寸"取它
 * ------------------------------------------------------------------ */

/**
 * **一根手指能点中的最小边长**（逻辑像素）。
 *
 * ==================================================================
 * 依据（不是随手挑的 44/48）
 * ==================================================================
 *
 * 本仓库**已有**这个数：`ui/IconButton.ts` 的命中区注释记着
 * "旧版 `SettingsButton` 有一个 `HIT = 44` …… 现在命中范围 = 内容盒 ∪
 * 外扩 `hitSlop`：图标 20/22px 加上两侧各 10px，得到 **40~42px** 的方块
 * —— 与旧版 44 相差无几，鼠标 / 手指都好点"。
 *
 * 所以这一屏取 **40**：它是本作**已经在用**的那个手指下限（旧的 44 与
 * 现在的 40~42 是同一个量级，取小者 = 偏保守地"允许更小"的那一侧）。
 *
 * ⚠️ 它是**逻辑像素**：画布 960×540 会被 letterbox 缩放到窗口（手机上
 * 约 0.72×），所以"逻辑 40"在手机上只有约 29 CSS px —— 严格来说任何
 * 逻辑像素下限都不能保证手机上的物理手感。这里取它是因为**本仓库所有
 * 触屏控件的下限都是这么定的**（同一个坐标系、同一条纪律），另起一套
 * 只在手机上有意义的单位会让两处对不上。
 */
export const TOUCH_MIN = 40;

/** 名字字号 / 行高（与布局表同一个来源，别处要用就走 `PREPARE_LAYOUT`）。 */
const NAME_SIZE = 17;
const NAME_LINE_H = Math.ceil(NAME_SIZE * 1.3);
const CARD_PAD = 12;
/**
 * ⚠️ 纵向内边距**单独一个数**（8）：横向的 12 是为了让名字离左右边框
 * 有呼吸位，而纵向只需要让名字行不贴边。合成一个数会让"卡片再矮一点"
 * 变成"名字贴边"（旧版就是这样把卡片卡在 48 的）。
 */
const CARD_PAD_Y = 8;
const PORTRAIT_BOX = 26;
const NAME_AVATAR_GAP = 8;

/**
 * 卡片高 = `max(名字行 23 + 上下各 8 = 39, 手指下限 40)` = **40**。
 * ⚠️ 这里是**手指下限**在起作用（39 < 40），所以再往下压就点不中了。
 */
const CARD_H = Math.max(NAME_LINE_H + CARD_PAD_Y * 2, TOUCH_MIN);
/** 炁机卡同样取这条下限（它没有头像，但手指是一样粗的）。 */
const QIJI_CARD_H = Math.max(NAME_LINE_H + CARD_PAD_Y * 2, TOUCH_MIN);

/**
 * 内容下限（宽）：两侧内边距 + 头像 + 间距 + 两个汉字。
 * ⚠️ 炁机卡（4 个汉字、无头像）算出来与它**相等**（68 + 24），所以一个数
 * 就够 —— 见 `PrepareLayout.cardMinW` 的说明。
 */
const CARD_CONTENT_W = CARD_PAD * 2 + PORTRAIT_BOX + NAME_AVATAR_GAP + NAME_SIZE * 2;
const CARD_MIN_W = Math.max(CARD_CONTENT_W, TOUCH_MIN);

/**
 * 默认布局（逻辑坐标系，960×540）。
 *
 * 纵向账（**算出来的**，见 `rowTopsOf`）。这一屏全是死的（固定 960×540
 * 逻辑画布，没有"大屏多显示"这回事），所以预算必须一次算平 ——
 * 下面这张账按**最高的一种展开方式**（对手块展开）算，真实张数（3 / 8 / 7）：
 *
 * ```
 *   ① 主标题        基线 34，32px，行框 13..55
 *   ② 人物块        标题 79， 内容 103 .. 143（展开 = 1 行 40；收起 = 块头 40）
 *   ③ 炁机块        标题 167，内容 191 .. 231（收起 = 块头 40；展开 = 2 行 86）
 *   ④ 对手块        标题 255，内容 279 .. 365（展开 = 2 行 40 + 6 = 86）
 *   ⑤ 开始按钮      377 .. 417  ← 由 `startRect()` 算（最高展开方式 + startGap）
 *   ⑥ 操作提示      427
 *   ⑦ 素材声明      524（贴底边）
 * ```
 *
 * ⚠️ 三块**同时展开**的话内容就有 40 + 86 + 86 = 212，加三个标题带
 * （各 48）= 356，从 103 起刚好到 459 —— 按钮被挤到 471 就压上页脚的
 * 两行（旧版为此把按钮横着挪到炁机行的右侧）。手风琴之后同时只有一块
 * 是满的，整条链才排得下。
 *
 * ⚠️ ⑤ 下面到 ⑦ 之间还留着 ~85px 的空白：那是**有意的** —— 按钮的 y 由
 * "三块里最高的一种展开方式"推出（见 `sectionsBottom`），所以**切块时
 * 它不会上下跳**；换来的就是"最矮的那种展开方式"下多一点空白。
 */
export const PREPARE_LAYOUT: PrepareLayout = {
  width: 960,
  height: 540,
  pad: 40,
  /**
   * 三列的可用宽度。
   *
   * ⚠️ 人物 / 对手列 576 → 右边界 `pad + 576 = 616`，而详情区从
   * `detailX` 624 起（中间 8px 呼吸位）—— 所以"卡片不压详情区"
   * 由**同一组数**保证，不是两处各写一遍。
   *
   * 炁机列 536（5 列 → 102px/张）：它比 Boss 列窄一档，因为 8 条炁机
   * 排成 5+3 两行正好压在"炁机标题 → 对手标题"这一段里。
   */
  playerColW: 576,
  bossColW: 576,
  qijiColW: 536,
  playerColumns: 3,
  /**
   * ⚠️ 对手从 **4 列改 5 列**（2026-10-13 第二轮）：需求"卡片可以再小
   * 一点"，而 7 张卡摊 5 列 → **110px/张**（4 列是 139）；仍然是 2 行
   * （5+2），所以纵向高度不变、横向每张窄了 29px。
   */
  bossColumns: 5,
  qijiColumns: 5,
  cardGap: 6,
  cardH: CARD_H,
  qijiCardH: QIJI_CARD_H,
  cardPad: CARD_PAD,
  cardPadY: CARD_PAD_Y,
  nameAvatarGap: NAME_AVATAR_GAP,
  portraitBox: PORTRAIT_BOX,
  cardMinW: CARD_MIN_W,
  nameSize: NAME_SIZE,
  nameLineH: NAME_LINE_H,
  titleY: 34,
  /**
   * 标题**下缘**到它那一行卡片顶边的间距。
   *
   * ⚠️ 它是标题行框（`ceil(18 × 1.3)` = **24**）—— 也就是"标题的行框正好
   * 落在卡片顶边之上"（`prepareLabelY` 把标题顶画在 `rowY - labelGap`）。
   * 旧版让到 20（行框探进卡片 4px）是因为 540 挤；手风琴把纵向省出来
   * 之后这里给足 24：字身与卡片顶边**不再有任何重叠**。
   */
  labelGap: 24,
  /**
   * **块与块之间**的额外空隙（上一块底边 → 下一块标题的**行顶**）。
   *
   * ⚠️ 值仍是 **0**：`labelGap` 已经管住"标题 ↔ 它自己的卡片"，而三块
   * 之间的呼吸位由**标题自己的行框**（24px）提供 —— 块与块之间已经有
   * 24px 的空带了，再加 `rowGap` 只会把按钮往下挤。
   */
  rowGap: 0,
  labelSize: 18,
  foldH: TOUCH_MIN,
  /**
   * 「开始战斗」的宽度（200 → **96**）。
   *
   * ⚠️ 96 装得下「开始战斗」四个字（`FONT.title` 17 × 4 ≈ 68 + 内边距）。
   */
  startW: 96,
  startH: 40,
  startGap: 12,
  detailX: 624,
  detailY: 88,
  detailW: 296,
  detailH: 416,
  detailPad: 12,
};
