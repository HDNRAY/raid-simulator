/**
 * 一行**图标方块 + 短标签**（Boss 的 buff 条用它）。
 *
 * 抽成独立文件的原因：它是一个**自成一体的可视组件**（有自己的
 * 几何、显隐、UI 缩放），原先内嵌在 `BattleScene.ts` 里，
 * 让那个文件同时承担了"场景编排"和"组件实现"两种职责。
 */

import type { Container, Graphics } from 'pixi.js';
import { FONT } from '../ui/layout';
import { Label, type PixiCtor } from '../ui/primitives';
import type { BuffView } from './viewModel';
import { formatCountdown, isTightWindow } from './viewModel';
import type { TranslateFn } from './sceneTypes';

/**
 * 算出每条**方块的左缘**。
 *
 * ==================================================================
 * 为什么抽成纯函数
 * ==================================================================
 *
 * 这块排布数学被用户实测纠正过两次（空标签占宽度、标签跑到方块左边），
 * 而它原本藏在 `IconStrip`（依赖 Pixi）的渲染循环里 —— **测不到**，
 * 只能靠截图碰运气。抽出来之后可以在 Node 里直接断言坐标。
 *
 * ⚠️ 标签**永远在方块右边**（两种对齐一致）。
 * 右对齐时右缘固定在 `x`：第 i 条的**方块右缘** = `x - Σ(右侧条目的
 * 标签宽度)` —— 把自己和右侧所有条目的标签位置先让出来。
 *
 * @param labelTotals 每条"方块之后占的宽度"（`labelGap + 标签宽`；
 *                    标签为空时 **0**，这一条是关键，见上）
 */
export function stripBoxX(options: {
  readonly count: number;
  /** 左对齐时是左缘；右对齐时是**右缘**。 */
  readonly x: number;
  readonly size: number;
  readonly gap: number;
  readonly align?: 'left' | 'right';
  readonly labelTotals: readonly number[];
}): readonly number[] {
  const { count, x, size, gap, labelTotals } = options;
  const right = options.align === 'right';
  const out: number[] = [];

  if (!right) {
    /** 左对齐：游标从左缘往右推，简单直接。 */
    let cursor = x;
    for (let i = 0; i < count; i += 1) {
      out.push(cursor);
      cursor += size + (labelTotals[i] ?? 0) + gap;
    }
    return out;
  }

  /**
   * 右对齐：**从右缘反算，闭式**。
   *
   * ⚠️ 不要用"游标递减"那种写法。我第一版就是这么写的，而它**漏算了
   * 条目之间的 `gap`** —— 多条时右缘会算错（单测当场抓到：`x` 算出 730
   * 而不是 952）。闭式把"右侧所有条目的总占宽"一次算清，不会漏项。
   *
   * 第 i 条的方块左缘 = `x` − 本条 `size + 标签宽` − 右侧所有条目的
   * `(size + gap + 标签宽)`。
   */
  for (let i = 0; i < count; i += 1) {
    let rightOfMe = 0;
    for (let j = i + 1; j < count; j += 1) {
      rightOfMe += size + gap + (labelTotals[j] ?? 0);
    }
    out.push(x - size - (labelTotals[i] ?? 0) - rightOfMe);
  }
  return out;
}

export class IconStrip {
  readonly root: Container;
  private readonly items: Array<{
    square: Graphics;
    label: Label;
    timer: Label;
    /**
     * **叠层数**（层数角标）。
     *
     * ⚠️ 与 `timer` **同时显示**（用户："层数 + 倒计时**都要**"）。
     *
     * 20px 的方块里塞两个数字，靠的是**对角**摆：
     *   - `stacks` 在**左上**（`anchorX: 0`）
     *   - `timer` 在**右下**（`anchorX: 1`）
     * 两个都是 11px（`FONT.tiny`，数字的下限）+ 黑描边，互不遮挡。
     *
     * ⚠️ **`stacks === 1` 时是空串**（见 `update`）——
     * "独立叠层"是**多个实例、每个 1 层**，那时每个方块**只该有倒计时**，
     * 不该出现一个"1"的角标；只有 `stack` / `stackRefresh`（**1 个实例、
     * N 层**）才画这个角标。两者因此**一眼能分开**。
     */
    stacks: Label;
  }> = [];
  private readonly pixi: PixiCtor;
  /** UI 缩放系数（默认 1）—— 只在 Boss buff 条上用到 */
  private uiScale = 1;

  constructor(
    pixi: PixiCtor,
    /** ⚠️ 可变：UI 缩放会重设 x/y/size/gap（见 `setUiScale`） */
    private strip: {
      x: number;
      y: number;
      size: number;
      gap: number;
      readonly max: number;
      labelGap?: number;
      /**
       * 从哪一端开始排。
       *
       * ⚠️ 加它的原因：玩家侧要"buff 在左、debuff 在右"。右对齐的条目
       * **必须从右往左**排，否则数量一变整排会左右跳
       * （`right` 时以 `x` 作为**右缘**）。
       */
      readonly align?: 'left' | 'right';
    },
    private readonly translate: TranslateFn,
  ) {
    this.pixi = pixi;
    this.root = new pixi.Container();
  }

  /**
   * 设定 UI 缩放（Boss buff 条用）。
   *
   * 与技能栏同理：**销毁旧的方块与标签再让 `ensure` 重建**。
   * ⚠️ 只清数组不销毁，旧节点仍挂在 root 上 —— 缩放后会新旧两层叠加
   * （技能栏上踩过这个坑，这里一次做对）。
   */
  setUiScale(
    scale: number,
    rect: { readonly x: number; readonly y: number; readonly size: number; readonly gap: number },
  ): void {
    if (scale === this.uiScale) return;
    this.uiScale = scale;
    this.strip = { ...this.strip, x: rect.x, y: rect.y, size: rect.size, gap: rect.gap, labelGap: Math.max(1, Math.round(4 * scale)) };
    for (const item of this.items) {
      item.square.destroy({ children: true });
      item.label.root.destroy({ children: true });
      item.timer.root.destroy({ children: true });
      item.stacks.root.destroy({ children: true });
    }
    this.items.length = 0;
  }

  private ensure(count: number): void {
    const target = Math.min(count, this.strip.max);
    while (this.items.length < target) {
      const square = new this.pixi.Graphics();
      // 极简标签：最多 2 字，字号 small（中文下限 13）
      const label = new Label(this.pixi, {
        x: 0,
        y: this.strip.y + 3,
        size: FONT.small,
        color: 0xffffff,
      });
      // 剩余时间叠在方块**右下角**，不额外占横向空间
      const timer = new Label(this.pixi, {
        x: 0,
        y: this.strip.y + this.strip.size - FONT.tiny - 1,
        size: FONT.tiny,
        color: 0xffffff,
        anchorX: 1,
        stroke: 0x000000,
        strokeWidth: 2,
      });
      /**
       * **叠层数**：方块**右上角**的小角标（与右下的倒计时同一条右边缘，
       * 上下排开）。
       *
       * ⚠️ 位置在 `update` 里按方块左缘重算；这里只给字号 / 描边 ——
       * 与 `timer` 同款（白字 + 黑描边），所以压在**任何**色块上都读得清。
       * 字号只能到 `FONT.tiny`（11）—— 再小数字就糊了，而 20px 的方块
       * 里两个 11px 数字**只能上下排**才放得下。
       */
      const stacks = new Label(this.pixi, {
        x: 0,
        y: this.strip.y,
        size: FONT.tiny,
        color: 0xffffff,
        anchorX: 1,
        stroke: 0x000000,
        strokeWidth: 2,
      });
      this.root.addChild(square, label.root, timer.root, stacks.root);
      this.items.push({ square, label, timer, stacks });
    }
  }

  update(buffs: readonly BuffView[]): void {
    // 判定窗口类排最前：玩家最需要看到"我还能躲多久"
    const sorted = [...buffs].sort((a, b) => Number(b.isDefensive) - Number(a.isDefensive));
    this.ensure(sorted.length);

    const { x, y, size, gap } = this.strip;
    const labelGap = this.strip.labelGap ?? 4;
    const rightAligned = this.strip.align === 'right';

    /**
     * ================================================================
     * ⚠️ 两遍：**先设文本量宽，再定位**
     * ================================================================
     *
     * 右对齐时方块的 x 取决于"自己与右侧所有条目的标签宽度"，所以必须先
     * 知道全部宽度才能开始摆。顺带解决了另一个坑：`Label` 的宽度**随文本
     * 变化**，一边设文本一边量宽会量到上一条的长度。
     */

    /* ---------- 第一遍：文本 + 宽度 ---------- */

    /** 每条"方块之后占的宽度"（空标签 → 0，见下面 `hasLabel` 的说明）。 */
    const labelTotals: number[] = [];

    for (let i = 0; i < this.items.length; i += 1) {
      const item = this.items[i];
      const view = sorted[i];
      if (!item) continue;

      if (!view) {
        item.square.clear();
        item.label.set('');
        item.timer.set('');
        item.stacks.set('');
        item.square.visible = false;
        labelTotals[i] = 0;
        continue;
      }

      const edge = view.color;
      /**
       * 剩余时间走 `formatCountdown` 的**同一条规则**（`viewModel.ts`）。
       *
       * ⚠️ 原来这里是 `Math.ceil(view.remainingMs / 1000)` —— 于是「闪」
       * （0.2 秒）与「避」（0.4 秒）都显示成 `1`，而且窗口缩短看不出来。
       * 那条规则（10 秒以下一位小数、以上整秒、都向上取整、不显示尾零）
       * 只在 `formatCountdown` 里写一次，buff 条 / 两条读条 / 预警提示共用。
       *
       * ⚠️ `remainingMs >= 100_000` 时是空串：那是**永久的** buff
       * （`Infinity`），不是"很久"—— 显示 `Infinity` 或一个巨大的秒数
       * 都只会占满整块。
       */
      const seconds = view.remainingMs < 100_000 ? formatCountdown(view.remainingMs) : '';
      item.timer.set(seconds);
      item.timer.setColor(edge > 0x808080 ? 0x101014 : 0xffffff);
      /**
       * **层数角标**：`stacks > 1` 才有。
       *
       * ⚠️ 用户 2026-10-13："层数 + 倒计时**都要**"。
       *
       * ⚠️ 原来这里是 `view.stacks > 1 ? stacks : 倒计时` —— **层数顶掉了
       * 倒计时**，于是叠起来的 buff **看不到还剩几秒**。那不是排版问题，
       * 是**丢信息**；现在两个都画（层数在**右上角**、倒计时在**右下角**，
       * 上下排在同一列，见定位那一段的实测数字）。
       *
       * ⚠️ `stacks === 1` **不画**（用户点名："不要画 1"）：
       * `refresh` / `independent` 的模式下 `stacks` 恒为 1 —— 前者不需要
       * 角标，后者是**多个方块各 1 层**（每个只有倒计时）。
       * 于是一个方块带角标 = "1 个实例、N 层"；一排方块都不带角标 =
       * "N 个实例、各 1 层"。两种**一眼能分开**。
       */
      item.stacks.set(view.stacks > 1 ? `${view.stacks}` : '');
      item.stacks.setColor(edge > 0x808080 ? 0x101014 : 0xffffff);
      item.label.set(this.translate(view.shortLabelKey));
      item.label.setColor(0xd0d0dc);

      /**
       * ⚠️ **标签为空时不占宽度。**
       *
       * 踩过的坑（用户实测："裂 还是没好，你好像留了 2 个字的位置"）：
       * 原来无条件按 `max(width, 16)` 预留标签位，于是没有标签的条目也会
       * 凭空占 `labelGap + 16` ≈ **两个字**的宽度。右对齐时那个空隙正好在
       * 最右边 → 整排**贴不到右缘**。
       */
      const hasLabel = item.label.root.text !== '';
      labelTotals[i] = hasLabel ? labelGap + Math.max(item.label.root.width, 16) : 0;
    }

    /* ---------- 第二遍：定位 ---------- */

    /**
     * 左对齐：`x` 是左缘，游标递增。
     * 右对齐：`x` 是**右缘**，游标递减。
     *
     * ⚠️ **标签永远在方块右边**（两种对齐都一样）。
     *
     * 用户实测纠正过我两次：
     *   1. "裂 还是没好，你好像留了 2 个字的位置"（空标签位占了宽度）
     *   2. "你的易伤 并没有写在 debuff 方块的右边"（我把它放到左边了）
     *
     * 我当时的做法是"右对齐时把标签甩到方块左边、整排从右往左长" ——
     * 那样确实不溢出右缘，但**标签跑到方块左边**，与增益行不一致，
     * 看起来就像写错了位置。
     *
     * 正确做法：**让方块的位置反过来依赖标签宽度**。右对齐时右缘固定，
     * 第 i 个的**方块右缘** = `x - Σ(它右边那些条目的标签宽度)` ——
     * 也就是把自己和右侧所有条目的标签位置先让出来。于是标签都在右边，
     * 而最右那条的标签恰好落在 `x` 处，不溢出。
     */
    const boxes = stripBoxX({
      count: this.items.length,
      x,
      size,
      gap,
      ...(rightAligned ? { align: 'right' as const } : {}),
      labelTotals,
    });

    for (let i = 0; i < this.items.length; i += 1) {
      const item = this.items[i];
      const view = sorted[i];
      if (!item || !view) continue;

      const tight = isTightWindow(view);
      const edge = view.color;
      const boxX = boxes[i] ?? x;

      const g = item.square;
      g.visible = true;
      g.clear();
      // **单色方块占位**：一块纯色 + 深色描边。
      // 接入正式图标后这一块会被贴图替换，布局不需要改。
      g.rect(boxX, y, size, size).fill({ color: edge, alpha: tight ? 1 : 0.9 });
      g.rect(boxX, y, size, size).stroke({ color: 0x05050a, width: 1 });
      // 判定窗口且时间很紧：加一圈亮边提醒"就是现在"
      if (tight) g.rect(boxX - 1, y - 1, size + 2, size + 2).stroke({ color: 0xffffff, width: 1 });

      // 剩余时间：叠在方块内右下角（白字 + 黑描边，压在纯色上也读得清）
      item.timer.root.x = boxX + size - 2;
      /**
       * **层数**：叠在方块**右上角**，与右下的倒计时**同一条右边缘**。
       *
       * 量出来的坐标（`fs = 11`）：Pixi 的 `Text` 框高 **14.8**，而数字字形
       * 只占框内的 `[+3.6, +11.6]`（上方是行距空白）。所以：
       *   - 角标的 `y = 方块顶 − 3` → 字形落在 `[顶+0.6, 顶+8.6]**（在方块内）
       *   - 倒计时的 `y = 方块底 − 11 − 1` → 字形落在 `[顶+11.6, 顶+19.6]`
       * 两者字形之间留 **3px**；`Text` 框虽然交叠，但画出来的像素不碰。
       *
       * ⚠️ 为什么两个都**右对齐**：倒计时带小数时是 3 个字（`7.8` = 21.9px）
       * —— 比 20px 的方块**宽**，会向左溢出约 4px（左右各留 6px 间隙，
       * 所以**压不到相邻方块**，是既有行为）。角标若放左上角，正好撞在
       * 那段溢出上（实测："3" 与 "7" 挤在一起）；放右上角则溢出部分
       * 上方是空的。这是**量出来的**，不是偏好。
       */
      item.stacks.root.x = boxX + size - 2;
      item.stacks.root.y = y - 3;
      /** ⚠️ 标签始终在方块**右边**（两种对齐一致）。 */
      item.label.root.x = boxX + size + labelGap;
    }
  }
}
