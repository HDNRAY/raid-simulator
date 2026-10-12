/**
 * 按键页的**技能格**：每个格子显示"技能字 + 当前按键"。
 *
 * ==================================================================
 * 为什么抽成组件
 * ==================================================================
 *
 * 两个原因：
 *   1. `SettingsPanel.ts` 超过 700 行（AGENTS.md §3）
 *   2. 格子有**自己的几何与状态**（交替底色、焦点框、捕获中的「…」），
 *      原先散在父组件的构造函数与 `drawBody()` 里，读起来是
 *      "面板顺手把格子也画了"
 *
 * 用 grid 而不是单列清单：技能会越来越多，单列 15 个技能要 450px 高，
 * grid 每行 3 个只需 1/3。
 */

import type { Container, Graphics } from 'pixi.js';
import { FONT } from '../layout';
import { Label, type PixiCtor } from '../primitives';
import { PALETTE } from '../../render/theme';
import { KEY_GRID_CAPACITY, keyCellRect, keyGridMetrics, rowsCapacity } from './logic';
import { keyLabel as formatKey } from './logic';
import type { KeyRow } from './rows';
import type { TranslateFn } from '../../i18n/translator';

/**
 * 每一格的状态（焦点 / 是否正在改键 / 在触屏页时有没有按钮）。
 */
export interface KeyGridState {
  /** 焦点落在第几个格子；`-1` = 焦点不在格子上 */
  readonly focusIndex: number;
  /** 正在等按键的技能 id（那一格显示「…」） */
  readonly capturingSkillId: string | undefined;
  /**
   * 是否显示键名。
   *
   * 需求："移动端就不用显示快捷键信息了，无论是技能按钮还是其他的
   * 功能按钮。"
   *
   * ⚠️ 触屏上「按键」页会因此变成"只有技能名的列表" —— 那是**预期**
   * 的：触屏玩家没有键可改。真正给触屏用的那一页是「触屏」页
   * （`touchSkillIds`），那里点一下就是放上 / 取下。
   */
  readonly showKeyHints?: boolean | undefined;
  /**
   * 「触屏」页：**当前的按钮集合**（顺序即双弧槽位）。
   *
   * ⚠️ `undefined` = 不是触屏页（按键页要保持原来的"技能字 + 按键"画法）。
   * 传了数组就是触屏页：右上角画"有没有按钮"的勾，左上角画槽位序号。
   *
   * ⚠️ 传**整个集合**而不是"这一格在不在"：序号要看它在集合里的位置，
   * 逐格算一份 `indexOf` 会在格子与集合之间造出第二个真相。
   */
  readonly touchSkillIds?: readonly string[] | undefined;
}

export class KeyGrid {
  readonly root: Container;

  private readonly gfx: Graphics;
  private readonly cells: Array<{
    name: Label;
    key: Label;
    /**
     * **触屏的按钮位序号**（1、2、3…）。
     *
     * 需求："触屏依旧没有办法设置按键" —— 现在「触屏」页就是按钮配置页，
     * 序号告诉玩家"这个技能在双弧上是第几个"（顺序即位置）。
     * 桌面（按键页）不显示序号（那里有键名列）。
     */
    slot: Label;
    rect: { x: number; y: number; w: number; h: number };
  }> = [];

  /**
   * 上一次用的"是否显示键名"（决定网格度量）。
   *
   * ⚠️ 只在变化时重排 —— 每帧重排会重建 Pixi 文本对象，帧率会塌。
   */
  private metricsShowKeyHints = true;

  constructor(
    private readonly pixi: PixiCtor,
    private readonly translate: TranslateFn,
  ) {
    this.root = new this.pixi.Container();
    this.gfx = new this.pixi.Graphics();
    this.root.addChild(this.gfx);

    this.buildCells(KEY_GRID_CAPACITY);
  }

  /**
   * 按当前度量把格子建好 / 重排。
   *
   * ⚠️ **必须能重排**：触屏是 2 列大格、桌面是 3 列小格（见
   * `keyGridMetrics` 的说明）。格子位置原先只在构造时算一次，
   * 切模式就会错位。
   */
  private buildCells(count: number): void {
    const metrics = keyGridMetrics(this.metricsShowKeyHints);
    /**
     * 多出来的格子**销毁**（不是留着不动）—— 否则触屏切回桌面时，
     * 2 列布局留下的格子会画在旧位置上。
     */
    while (this.cells.length > count) {
      const cell = this.cells.pop();
      if (cell === undefined) break;
      this.root.removeChild(cell.name.root);
      this.root.removeChild(cell.key.root);
      cell.name.root.destroy({ children: true });
      cell.key.root.destroy({ children: true });
    }
    this.layoutCells(metrics);
    for (let i = this.cells.length; i < count; i += 1) {
      const rect = keyCellRect(i, metrics);
      const name = new Label(this.pixi, {
        x: rect.x + 12,
        y: rect.y + 12,
        size: FONT.warn,
        color: PALETTE.text,
        kai: true,
      });
      const key = new Label(this.pixi, {
        x: rect.x + rect.w - 12,
        y: rect.y + 14,
        size: FONT.body,
        color: PALETTE.textDim,
        anchorX: 1,
      });
      /**
       * ⚠️ 格子里**不画提示标签**（需求："按键设置里，grid 的 cell 里
       * 就不要显示 tag 了"）。
       *
       * 原先在技能字下方画一行 `tiny` 的标签（如「打断」）。去掉了：
       *   - 格子是 188×56 的小面积，塞第三行字之后"技能名 + 按键 +
       *     标签"三者互相挤，扫一眼分不清主次
       *   - 玩家在这一页真正要确认的是"**哪个技能绑了哪个键**"，
       *     标签属于"这个技能是什么"，那是详情区的事
       */
      /**
       * 按钮位序号：**左上角小字**（键名列在触屏上是空的，位置正好空着）。
       */
      const slot = new Label(this.pixi, {
        x: rect.x + 8,
        y: rect.y + 4,
        size: FONT.tiny,
        color: PALETTE.textDim,
        anchorX: 0,
        anchorY: 0,
      });
      this.root.addChild(name.root, key.root, slot.root);
      this.cells.push({ name, key, slot, rect });
    }
  }

  /** 按度量把已有格子重新摆位（改 x/y，不重建对象）。 */
  private layoutCells(metrics: ReturnType<typeof keyGridMetrics>): void {
    for (const [i, cell] of this.cells.entries()) {
      const rect = keyCellRect(i, metrics);
      cell.rect = rect;
      cell.name.root.x = rect.x + 12;
      cell.name.root.y = rect.y + 12;
      cell.key.root.x = rect.x + rect.w - 12;
      cell.key.root.y = rect.y + 14;
      cell.slot.root.x = rect.x + 8;
      cell.slot.root.y = rect.y + 4;
    }
  }

  /** 面板切页时调用 —— 不是按键页就整块藏起来。 */
  setVisible(visible: boolean): void {
    this.root.visible = visible;
  }

  /**
   * 重画。
   *
   * `onFocused` 在"焦点所在的格子"上被调用一次 —— 详情区靠它决定
   * 显示哪个技能。这样"格子画自己"与"详情显示谁"由网格驱动，
   * 父组件不用再遍历一遍。
   */
  update(rows: readonly KeyRow[], state: KeyGridState, onFocused: (row: KeyRow) => void): void {
    /**
     * ⚠️ **度量变了就重排**：触屏是 2 列大格、桌面是 3 列小格。
     * 只在变化时做 —— 每帧重建文本对象会让帧率塌掉。
     */
    const showKeyHints = state.showKeyHints !== false;
    if (showKeyHints !== this.metricsShowKeyHints) {
      this.metricsShowKeyHints = showKeyHints;
    }
    const metrics = keyGridMetrics(showKeyHints);
    const capacity = rowsCapacity(metrics);
    /**
     * ⚠️ 每次 update 都重排，但**只在格子数变化时重建文本对象**。
     *
     * 重排只是改 `x`/`y`（很便宜），而 `keyGridMetrics()` 每次返回新对象
     * （它是纯函数），所以不能靠"对象变了没"来判断要不要重建 ——
     * 那样会每帧重建，帧率塌掉。
     */
    if (this.cells.length !== capacity) this.buildCells(capacity);
    else this.layoutCells(metrics);
    this.gfx.clear();
    for (const cell of this.cells) {
      cell.name.set('');
      cell.key.set('');
      cell.slot.set('');
    }

    for (const [i, row] of rows.entries()) {
      if (i >= this.cells.length) break;
      const cell = this.cells[i];
      if (!cell) continue;

      const capturing = state.capturingSkillId === row.skillId;
      const focused = state.focusIndex === i;
      /**
       * 触屏页：`order` = 这个技能在按钮集合里的位置（`-1` = 没有按钮）。
       * ⚠️ 用**集合里**的下标而不是行下标：双弧的顺序跟的是按钮集合的
       * 顺序，两者在"有技能被取下"时就会错开。
       */
      const touchIds = state.touchSkillIds;
      const order = touchIds === undefined ? -1 : touchIds.indexOf(row.skillId);
      const hasButton = order >= 0;

      cell.name.set(this.translate(row.nameKey));
      if (touchIds !== undefined) {
        /**
         * ============================================================
         * 「触屏」页的格子：右上角勾 = **有没有按钮**，左上角数字 = 槽位
         * ============================================================
         *
         * 需求："要在同一处能看到『这个技能有没有触屏按钮』"。
         * 所以"有 / 没有"必须是**看得见**的（而不是只能靠点一下试试）：
         * 有 → 亮边框 + 勾 + 序号；没有 → 普通格子。
         */
        cell.key.set(hasButton ? '✓' : '');
        cell.key.setColor(PALETTE.douqi.bright);
        cell.slot.set(hasButton ? String(order + 1) : '');
      } else {
        // 按键名统一大写显示，与技能栏上的提示一致
        cell.key.set(
          state.showKeyHints === false
            ? ''
            : capturing
              ? '…'
              : formatKey(row.key, this.translate('settings.keyUnbound')),
        );
        cell.key.setColor(capturing || focused ? PALETTE.douqi.bright : PALETTE.text);
        /**
         * 触屏（按键页）：显示**行序号**，让玩家知道这页列出的是技能全集。
         * ⚠️ 只在触屏显示：桌面有键名列，再塞个序号会挤。
         */
        cell.slot.set(state.showKeyHints === false ? String(i + 1) : '');
      }

      if (focused) onFocused(row);

      // 交替底色 + 捕获 / 键盘焦点 / "有触屏按钮"的高亮
      const box = (): typeof this.gfx =>
        this.gfx.rect(cell.rect.x, cell.rect.y, cell.rect.w, cell.rect.h);
      box().fill({
        color: capturing || focused || hasButton ? PALETTE.douqi.base : 0xffffff,
        alpha: capturing
          ? 0.18
          : focused
            ? 0.12
            : hasButton
              ? 0.1
              : i % 2 === 0
                ? 0.03
                : 0.06,
      });
      /**
       * **每个格子都有边框**（需求："没有边框啊，选中态这些"）。
       *
       * 原先只有焦点/捕获那一格有描边，其余纯靠一层很淡的底 ——
       * 于是"这些格子是可点的"这件事**完全看不出来**，触屏上尤其明显
       * （鼠标至少还有 hover 变色）。
       *
       * 分三级，让"能点 / 当前 / 正在改键"一眼可分：
       *   普通  淡描边
       *   焦点  亮描边 + 更粗
       *   捕获  亮描边 + 亮底
       * ⚠️ 「触屏」页上"已经放上"的格子也走亮描边那一级 —— 它就是那一页的
       * "选中态"（需求："同一处能看到有没有"）。
       */
      box().stroke({
        color: capturing || focused || hasButton ? PALETTE.douqi.bright : 0x3c3e50,
        width: capturing || focused || hasButton ? 2 : 1,
        alpha: capturing || focused || hasButton ? 1 : 0.9,
      });
    }
  }
}
