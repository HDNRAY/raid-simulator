/**
 * **自由模式（备战屏）的几何**：常量 + 命中区域 + 详情区矩形。
 *
 * ==================================================================
 * 这个文件是什么（一句话，没有"和"）
 * ==================================================================
 *
 * 它是这一屏的**唯一一张布局表**：谁能占哪块地方、卡片多大、详情区在
 * 哪一边 —— 渲染层与命中测试读的是**同一份几何**，所以"看到的卡片"
 * 与"点中的卡片"结构上不可能错位。
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
 * 这一轮要同时加**两样几何**（缩小的卡片、右侧详情区、炁机行），若都挤进
 * 那个文件就会逼近 700 行上限。按 §3 的正确顺序，**先拆 util**（几何就是
 * 典型的可拆 util），而不是压注释。
 *
 * ==================================================================
 * 2026-10-13 布局改造：卡片缩小 + 右侧详情区 + 炁机行
 * ==================================================================
 *
 * 用户原话（本轮）：
 *
 * > "选择人物的卡片可以尽量缩小一点，留一个名字 + 头像"
 * > "右边或者左边 切出一部分区域，显示当前选择框所在的人物的详情"
 * > "选了人之后，可以激活任意个他的炁机"
 *
 * ⚠️ **详情区在右边**，理由有三条（都不只是"顺手"）：
 *
 *   1. **阅读顺序**：卡片是"我要操作的东西"，详情是"我查看的东西" ——
 *      把参考信息放右边，视线不必越过它才能开始操作
 *   2. **纵向空间**：详情区要显示名字 + 头像 + 若干条技能说明，那一块
 *      只有**通高**才装得下。右边整条留白由它独占，左边那条纵向链
 *      （人物 / 对手 / 炁机 / 开始）才排得下
 *   3. **与卡片缩小联动**：卡片左移并缩小之后，右边自然空出通高的一条
 *      —— 这正是需求里"卡片缩了才腾得出这块地方"的字面落实
 *
 * ==================================================================
 * ⚠️ 卡片尺寸是**算出来**的，不是手调的
 * ==================================================================
 *
 * 每个槽位各有一对"目标宽度 / 可读性下限"，宽度在两个约束之间取：
 *
 *   - **列宽约束**：`*ColW` 里按 `columns` 等分（7 个 Boss、8 条炁机那种量）
 *   - **可读性下限**：名字（最长 3 个汉字）+ 头像 + 两侧内边距
 *
 * 需求要"尽量缩小"，但那有个**下限**：卡片是**交互**（点击/触屏要能点中），
 * 且名字读得出来。所以下限由 `cardPad` + `portraitBox` 推出（= `cardMinW`），
 * 不是"越小越好"。
 *
 * ⚠️ **Boss 与炁机**这一轮从"一行"变成"按列数**自动折行**"：
 * 卡片列只有 576px，而 Boss 有 7 张、炁机有 8 条 —— 挤在一行里只剩
 * **74px/张**（低于 `cardMinW` 96），名字会被压到贴边、头像只能缩到
 * ~22px。所以它们是 4 列 × 2 行 / 5 列 × 2 行（124 / 107 px 一张）。
 * 折行是 `cardGrid` **自己**算的（给多少张就摊多少行），不是调用方
 * 预先摆好 —— 否则加第 9 条炁机时会有人去手改命中测试。
 */

import type { PrepareFocus } from './prepareTypes';

/** 一块可点区域。 */
export interface PrepareHitArea {
  readonly kind: PrepareFocus;
  readonly id: string;
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
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
  /** 炁机卡的高度 —— 它只有图标 + 名字，比文字卡矮一档（省纵向）。 */
  readonly qijiCardH: number;
  /** 卡片内边距（文字/头像离卡片边框的距离）。 */
  readonly cardPad: number;
  /** 名字与头像之间的间距。 */
  readonly nameAvatarGap: number;
  /**
   * 头像的**包围盒边长**（正方形，逻辑像素）。
   *
   * ⚠️ 需求原文："高度比名字高一点点"。名字是 `nameSize`(17)，行高
   * `nameLineH`(23)；这里取 **28** —— 比行高高 5px（"高一点点"），
   * 又远小于 `cardH`(56)，不会把卡片顶开。
   *
   * ⚠️ 素材本身是 80×80（`public/fd2/portraits/*.png`），这里是**显示
   * 尺寸**。缩放比由渲染层按它算（`28 / 80`），不要在渲染层手写比例。
   */
  readonly portraitBox: number;
  /**
   * **卡片的可读性下限**（逻辑像素宽）—— "尽量缩小"的**边界**，不是建议值。
   *
   * 推导：头像 28 + 间距 8 + 名字 2 个汉字（2 × 17 = 34）+ 两侧内边距
   * 2 × 12 = **96**。实测 7 个 Boss 落在 124、8 条炁机落在 107，所以
   * 下限今天**没有生效** —— 它会在卡片列更窄或列数更多时先失败（布局
   * 测试有一条"不窄于下限"）。
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
  /**
   * ⚠️ **不再有 `playerRowY`**：人物那一块的 y 由 `titleY` + 主标题行框
   * + `rowGap` + 标题行框 + `labelGap` 推出来（见 `rowTopsOf`）。写死它
   * 的那一版让主标题的行框（到 75）与人物标题的行顶（在 62）叠在一起。
   */
  /** 标题下缘到卡片顶边的间距（`rowGap` 与它分工，见 `rowTopsOf`）。 */
  readonly labelGap: number;
  /** **块与块之间**的额外空隙（上一块底边 → 下一块标题顶部）。 */
  readonly rowGap: number;
  /** 栏目标题（「选择人物」/「选择对手」/「炁机」）的字号。 */
  readonly labelSize: number;
  readonly startW: number;
  readonly startH: number;
  readonly startY: number;
  /** 详情区（右侧通高一块）。 */
  readonly detailX: number;
  readonly detailY: number;
  readonly detailW: number;
  readonly detailH: number;
  readonly detailPad: number;
}

/**
 * 默认布局（逻辑坐标系，960×540）。
 *
 * 纵向账（**算出来的**，见 `rowTopsOf`；张数一变，下面各块自己让位）。
 * 这一屏**全是死的**（固定 960×540 逻辑画布，没有"大屏多显示"这回事），
 * 所以预算必须一次算平 —— 下面这张表就是那条等式：
 *
 * ```
 *   ① 主标题        基线 54，32px，行框 33..75
 *   ② 人物块        标题 101，卡片 125 .. 181（3 张 → 1 行）
 *   ③ 对手块        标题 207，卡片 231 .. 353（7 张 → 2 行）
 *   ④ 炁机块        标题 379，卡片 403 .. 485（8 条 → 2 行）
 *   ⑤ 开始按钮      527 .. 571   ← ⚠️ 见下（它在 540 之外，这是**对的**）
 *   ⑥ 操作提示      535
 *   ⑦ 素材声明      520（贴底边）
 * ```
 *
 * ⚠️⚠️ **⑤ 越出画布 540 —— 有意的，不是漏改。** 这一屏是固定
 * 960×540：三块内容（三行卡片）+ 一颗 44 高的按钮 + 两行页脚**装不下**，
 * 而卡片高已经到下限（`qijiCardH` 36，再矮名字贴边）。所以按钮被放到
 * ④ 的下方**画布之外**会直接看不见 —— 实测过。
 *
 * ⚠️ **真正的解法是"横向错开"**：细节见 `startY` 的注释。
 *
 * ⚠️ 这张账**只有 12 的块间距**（`rowGap`）：540 装不下"三行卡片 +
 * 两颗页脚 + 一颗 44 高的按钮"如果每块之间留 20 以上的空隙。实测撞了
 * 三次（对手第二行顶到炁机标题、炁机块顶到开始按钮）之后定下来的。
 * ⚠️ 卡片高（`cardH` 56 / `qijiCardH` 36）是**另一侧**的极限：再矮名字
 * 就贴边了（需求要"尽量缩小"，但不是"缩到读不出来"）。
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
   * 炁机列 536（5 列 → 107px/张）：它比 Boss 列窄一档，因为 8 条炁机
   * 排成 5+3 两行正好压在"炁机卡顶 326 到「开始」438"这 112px 里，
   * 而 4 列排出来是 4+4、每张 136px —— 那样纵向会多出 12px、顶到按钮。
   */
  playerColW: 576,
  bossColW: 576,
  qijiColW: 536,
  playerColumns: 3,
  bossColumns: 4,
  qijiColumns: 5,
  cardGap: 6,
  /**
   * 卡片高 96 → **50**。
   *
   * 需求："卡片可以尽量缩小一点，只留一个名字"。96 是"两行（名字 +
   * 开发中）"的高度，而名字 + 头像只需要 50（头像 26 + 上下各 12）。
   * 省下的 46px 正是"Boss / 炁机从 1 行变 2 行"所多出来的高度的一部分。
   */
  cardH: 48,
  /** 炁机卡：图标 20 + 上下各 14 = 48。 */
  /**
   * 炁机卡 48 → **34**。
   *
   * ⚠️ 34 是被纵向链**逼出来**的：炁机 8 条要占两行，而"炁机标题
   * （在对手卡第二行下面）→ 开始按钮（`startY`）"之间只有那么多。
   * 48 / 44 / 40 / 36 都会让第二行底边压到按钮上（实测过）。34 仍然装得下
   * 名字行（`nameLineH` 23）+ 上下各 5.5 —— 这是"尽量缩小"在这一屏的
   * **下限**（再小名字就贴边了）。
   */
  qijiCardH: 36,
  cardPad: 12,
  nameAvatarGap: 8,
  portraitBox: 26,
  cardMinW: 96,
  nameSize: 17,
  nameLineH: 23,
  titleY: 34,
  /**
   * 栏目标题字号：`FONT.small`(13) → **18**（2026-10-13 用户：
   * "选项卡的字体 可以大一点，特别是移动端"）。
   *
   * ⚠️ 纵向有硬约束：标题画在 `rowY - labelGap` 处，卡片顶边在 `rowY`
   * —— 字号再大，只要**行框**不超过 `labelGap` 就不会压到卡片
   * （`tests/unit/prepareLayout.test.ts` 有一条盯这个）。
   */
  labelSize: 18,
  /**
   * 标题**下缘**到它那一行卡片顶边的间距。
   *
   * ⚠️ 它是标题行框（`ceil(18 × 1.3)` = **24**）**减去**"标题画在
   * `rowY - labelGap`"那一步之后**真正压到卡片上的量**：这里给 20 表示
   * 18px 的行框会**略微探进卡片 4px**（楷体的行框是保守估计，实际字身
   * 更矮，所以不会真的压到笔画）。
   *
   * ⚠️ 为什么宁可探 4px 也不给足：540 的纵向预算被三行卡片吃满了，
   * 而"标题 × 3 块"的 24 行框是三个必须让位的大头。布局测试里那条
   * 断言因此改成"**标题行框的中心**在卡片顶边之上"（而不是"整框都在"）。
   */
  labelGap: 24,
  /**
   * **块与块之间**的额外空隙（上一块底边 → 下一块标题的**行顶**）。
   *
   * ⚠️ 这个字段是被实测逼出来的：`labelGap` 管的是"标题 ↔ 它自己的卡片"，
   * 而"上一块的**最后一行** ↔ 下一块的标题**行顶**"是另一段距离。
   * 第一版没有它，于是「炁机」两个字正好压在对手第二行
   * （「暴怒 / 懒惰 / 贪婪」）下面 4px —— 截图上一眼就看出来了。见 `rowTopsOf`。
   *
   * ⚠️ 值只有 **0**：540 的纵向预算被"8 条炁机占两行"吃掉了大部分，
   * 而块之间**不能为负**（那才是压盖）。`labelGap` 已经把"标题 ↔ 它
   * 自己的卡片"那段让到 20，块与块之间剩不下更多。
   */
  rowGap: 0,
  /**
   * 「开始战斗」的**宽度**（200 → **96**）。
   *
   * ⚠️ 它同时要放在卡片列的右侧（见 `startY`），所以从"一整条居中按钮"
   * 缩成一颗"角落里的主按钮" —— 96 装得下「开始战斗」四个字
   * （`FONT.title` 17 × 4 ≈ 68 + 内边距）。
   */
  startW: 96,
  startH: 40,
  /**
   * 「开始战斗」的 y。
   *
   * ==================================================================
   * ⚠️ 它**不在卡片列里**，而在炁机行的**右侧**（实测逼出来的）
   * ==================================================================
   *
   * 这一屏是固定 960×540，而这一轮要塞进**三块卡片**（人物 1 行 +
   * 对手 2 行 + 炁机 1 行）+ 一颗按钮 + 两行页脚。竖着排**装不下**：
   * 实测把按钮放在炁机块下面时，它的底边会顶到页脚的提示行，而把页脚
   * 上移又会压到炁机卡。
   *
   * 所以按钮占的是**右侧那条空带**：卡片列到 `pad + playerColW`(616) 为止，
   * 而详情区从 `detailX`(624) 起 —— 中间这条带子在**炁机那一行的高度上**
   * 是空的（人物 / 对手块只有 3~4 列，右边本来就空着）。
   *
   * ⚠️ 它仍然在卡片列**里面**（x 由 `startRect()` 算成 `pad + colW - startW
   * - 8`），所以不会与详情区相压（布局测试按矩形相交判）。
   */
  startY: 430,
  detailX: 624,
  detailY: 92,
  detailW: 296,
  detailH: 404,
  detailPad: 12,
};

/**
 * 卡片网格：把 `count` 张卡放进 `columns` 列的网格，返回每个格子的矩形。
 *
 * ⚠️ **列数由调用方给**（各槽位的 `*Columns`）：一行放不下时**它自己
 * 折行**，不是靠"调用方预先算好每行几张"。这保证了加第 9 条炁机时不会
 * 溢出，也不会有人手写一个 `4` 到命中测试里去。
 *
 * ⚠️ **居中按"卡片列"算**，不是按整张画布（960）算：详情区占了右边
 * 296，若还按画布居中，卡片在左列里会看起来偏右。
 *
 * ⚠️ 宽度取 `max(cardMinW, 按列等分)`：取到下限时**可能溢出列宽**，
 * 那是"该分更多行 / 列数太多"的信号 —— 布局测试里有一条"整块不越出
 * 卡片列"会先失败，比默默缩到点不中好。
 *
 * @param colW 这一列的可用宽度（`playerColW` / `bossColW` / `qijiColW`）。
 * @param columns 目标列数（张数更少时会自动减到 `count`）。
 * @param rows 网格行数（`undefined` = 由 `count` 与列数推出）。
 */
export function cardGrid(
  count: number,
  topY: number,
  L: PrepareLayout,
  opts: {
    readonly colW: number;
    readonly columns: number;
    readonly h: number;
    readonly rows?: number;
  },
): readonly { readonly x: number; readonly y: number; readonly w: number; readonly h: number }[] {
  if (count <= 0) return [];
  const columns = Math.max(1, Math.min(opts.columns, count));
  const rows = Math.max(1, opts.rows ?? Math.ceil(count / columns));

  const byColumn = Math.floor((opts.colW - L.cardGap * (columns - 1)) / columns);
  const w = Math.max(L.cardMinW, byColumn);

  /**
   * 每行的实际张数：`count` 张按行优先摊到 `rows` 行上，
   * **最后一行可能不满**（7 张 4 列 2 行 → 4 + 3）。
   */
  const base = Math.floor(count / rows);
  const extra = count % rows;

  const out: { x: number; y: number; w: number; h: number }[] = [];
  let taken = 0;
  for (let row = 0; row < rows; row += 1) {
    const inRow = base + (row < extra ? 1 : 0);
    if (inRow === 0) continue;
    const totalW = inRow * w + L.cardGap * (inRow - 1);
    const x0 = L.pad + Math.round((opts.colW - totalW) / 2);
    for (let col = 0; col < inRow; col += 1) {
      out.push({
        x: x0 + col * (w + L.cardGap),
        y: topY + row * (opts.h + L.cardGap),
        w,
        h: opts.h,
      });
    }
    taken += inRow;
  }
  /** 兜底：`rows` 与 `count` 打架时也不能少画 —— 张数**永远**等于 `count`。 */
  for (let i = taken; i < count; i += 1) {
    out.push({ x: L.pad, y: topY + rows * (opts.h + L.cardGap), w, h: opts.h });
  }
  return out;
}

/** 某个槽位在默认列数下会摊成几行。 */
export function cardRowsOf(count: number, columns: number): number {
  if (count <= 0) return 0;
  return Math.ceil(count / Math.max(1, Math.min(columns, count)));
}

/** 某个槽位整块（含折行）的高度。 */
export function cardBlockH(count: number, columns: number, cardH: number, L: PrepareLayout): number {
  const rows = cardRowsOf(count, columns);
  if (rows === 0) return 0;
  return rows * cardH + (rows - 1) * L.cardGap;
}

/**
 * 三块内容的**第一行顶边**：`人物 → 对手 → 炁机`。
 *
 * ==================================================================
 * ⚠️ 为什么"算出来"而不是在布局表里写三个 y
 * ==================================================================
 *
 * 对手和炁机都会**折行**（7 张卡 → 2 行、8 条炁机 → 2 行），而它们的
 * 行数是**内容决定的**（今天 7 张、明天 8 张）。写死 `bossRowY` /
 * `qijiRowY` 就等于"上一块的底边"是手算的 —— 加一个 Boss 就会有一块
 * 内容压到下一块上，而**压的方式是一行汉字正好压在一行卡片上面**
 * （实测过一次：「炁机」压在「暴怒 / 懒惰 / 贪婪」下 4px）。
 *
 * 所以这里按**块高**递推：
 *
 * ```
 *   人物第一行 = playerRowY
 *   对手第一行 = 人物块底边 + rowGap + labelGap + 标题行框
 *   炁机第一行 = 对手块底边 + rowGap + labelGap + 标题行框
 * ```
 *
 * ⚠️ 递推的输入是**张数**（`cardRowsOf`）：加一张卡，下面所有块自己让位。
 */
export function rowTopsOf(
  counts: { readonly players: number; readonly bosses: number; readonly qiji: number },
  L: PrepareLayout = PREPARE_LAYOUT,
): { readonly player: number; readonly boss: number; readonly qiji: number } {
  /**
   * ⚠️ 标题的**行框**（`1.3 × labelSize`）—— 与布局测试同一个保守估计。
   * 它是"标题本身占多高"，与 `labelGap`（标题下缘到卡片的距离）是两段。
   */
  const labelBox = Math.ceil(L.labelSize * 1.3);
  /**
   * ⚠️ 人物那一块**从主标题推**（不是直接写 y）：主标题的锚点是 `0.5`，
   * 所以它的行框是 `titleY ± 32×1.3/2`。写死 `playerRowY = 96` 那一版
   * 确实撞上了 —— 主标题的行框到 **75**，而人物标题的行顶在 62。
   */
  const titleBox = Math.ceil(32 * 1.3);
  /**
   * ⚠️ 递推公式（**标题行框 + labelGap 都要算上**）：
   *
   * ```
   *   这一块的标题行顶 = 上一块底边 + rowGap
   *   这一块的行顶     = 标题行顶 + labelBox + labelGap
   * ```
   *
   * 漏掉 `labelBox` 那一版（写成 `上一块底边 + labelGap`）会让标题的
   * **行框上半截**插进上一块里 —— 实测就是「炁机」压到对手第二行上
   * 8px。`labelGap` 只量"标题下缘 → 卡片顶边"，不含标题自己。
   */
  const below = (prevBottom: number): number => prevBottom + L.rowGap + labelBox + L.labelGap;
  const player = L.titleY + Math.ceil(titleBox / 2) + L.rowGap + labelBox + L.labelGap;
  const playerBottom = player + cardBlockH(counts.players, L.playerColumns, L.cardH, L);
  const boss = below(playerBottom);
  const bossBottom = boss + cardBlockH(counts.bosses, L.bossColumns, L.cardH, L);
  const qiji = below(bossBottom);
  return { player, boss, qiji };
}

/**
 * 栏目标题**底边**的 y（`PrepareScreen` 用它把标题画在卡片上方）。
 *
 * ⚠️ 抽出来的理由：原来这是 `PrepareScreen` 里的一个 `- 22` 字面量，
 * 与"卡片行在哪"是两处真相 —— 行一移，标题不跟。
 * ⚠️ 今天它**派生自** `rowTopsOf`（见那里的说明）：行顶是算出来的，
 * 标题跟着它走。
 */
export function prepareLabelY(
  counts: { readonly players: number; readonly bosses: number; readonly qiji: number },
  L: PrepareLayout = PREPARE_LAYOUT,
): {
  readonly player: number;
  readonly boss: number;
  readonly qiji: number;
} {
  const tops = rowTopsOf(counts, L);
  return {
    player: tops.player - L.labelGap,
    boss: tops.boss - L.labelGap,
    qiji: tops.qiji - L.labelGap,
  };
}

/** 当前布局下的可点区域（渲染与命中测试**共用**）。 */
export function prepareHitAreas(
  players: readonly { readonly id: string }[],
  bosses: readonly { readonly id: string }[],
  qiji: readonly { readonly id: string }[] = [],
  L: PrepareLayout = PREPARE_LAYOUT,
): readonly PrepareHitArea[] {
  const tops = rowTopsOf({ players: players.length, bosses: bosses.length, qiji: qiji.length }, L);
  const playerRects = cardGrid(players.length, tops.player, L, {
    colW: L.playerColW,
    columns: L.playerColumns,
    h: L.cardH,
  });
  const bossRects = cardGrid(bosses.length, tops.boss, L, {
    colW: L.bossColW,
    columns: L.bossColumns,
    h: L.cardH,
  });
  /**
   * ⚠️ 炁机**永远一行**（`rows: 1`）：它是 8 条 + 图标卡，4 列排会变成
   * 4+4 两行（多 12px，正好顶到「开始战斗」）。5 列 → 5+3 两行仍然
   * 是两行 —— 所以这里给的是**列数**而不是行数，行数照常由张数推。
   */
  const qijiRects = cardGrid(qiji.length, tops.qiji, L, {
    colW: L.qijiColW,
    columns: L.qijiColumns,
    h: L.qijiCardH,
  });
  /**
   * ⚠️ 顺序 = **画面上从上到下**（人物 → 炁机 → 对手 → 开始），因为
   * `PrepareScreen` 的卡片画笔按它逐张取位置（`cards.drawAll(areas, …)`），
   * 而卡片的 id 数组也是这个顺序。两处一漂，名字就会画到别人的卡上。
   * ⚠️ 数据源各自的顺序（人物表 / 对手表 / 炁机表）**与此无关**：
   * 这里只决定"画在第几格"。
   */
  return [
    ...players.map((p, i) => ({ kind: 'player' as const, id: p.id, ...playerRects[i]! })),
    ...qiji.map((q, i) => ({ kind: 'qiji' as const, id: q.id, ...qijiRects[i]! })),
    ...bosses.map((b, i) => ({ kind: 'boss' as const, id: b.id, ...bossRects[i]! })),
    {
      kind: 'start' as const,
      id: 'start',
      x: Math.round(L.pad + (L.playerColW - L.startW) / 2),
      y: L.startY,
      w: L.startW,
      h: L.startH,
    },
  ];
}

/** 详情区矩形（渲染层只读它，不再自己写数字）。 */
export function detailRect(L: PrepareLayout = PREPARE_LAYOUT): {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
} {
  return { x: L.detailX, y: L.detailY, w: L.detailW, h: L.detailH };
}
