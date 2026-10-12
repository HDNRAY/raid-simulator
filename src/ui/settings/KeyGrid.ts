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
 * 每一格的状态（焦点 / 是否正在改键 / 这个技能在不在触屏键位上）。
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
   * ⚠️ 触屏上「按键」页会因此变成"只有技能名的列表" —— 那是**预期**的：
   * 触屏玩家没有键盘键可改，但**触屏键位**照样在右下角配
   * （见 `slotSkillIds`）。
   */
  readonly showKeyHints?: boolean | undefined;
  /**
   * **触屏键位表**（**下标 = 键位号**，`''` = 空键位）。
   *
   * 左上角的小号画"这个技能在第几个键位上"（没有就不画）——
   * 与右下角的模拟键位是**同一份数据**的两个视图，所以玩家能在技能表里
   * 一眼看到"哪些技能已经上了触屏"。
   *
   * ⚠️ 传**整张表**而不是"这一格在不在"：号数就是下标，
   * 逐格算一份 `indexOf` 会在格子与键位表之间造出第二个真相。
   */
  readonly slotSkillIds?: readonly string[] | undefined;
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
     * 需求："要在同一处能看到『这个技能有没有触屏按钮』" —— 序号告诉玩家
     * "这个技能在第几个键位上"（`slotSkillIds` 的下标 + 1）。
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
       * `order` = 这个技能在**触屏键位表**里的下标（`-1` = 没上键位）。
       * ⚠️ 用**键位表里**的下标而不是行下标：键位号是槽位号，
       * 两者在"中间某个键位空着"时就会错开。
       */
      const touchIds = state.slotSkillIds;
      const order = touchIds === undefined ? -1 : touchIds.indexOf(row.skillId);
      const hasButton = order >= 0;

      cell.name.set(this.translate(row.nameKey));
      /**
       * ============================================================
       * 左上角的小号 = **这个技能在第几个触屏键位上**
       * ============================================================
       *
       * 需求："要在同一处能看到『这个技能有没有触屏按钮』"。
       * 所以"有 / 没有"必须**看得见**（而不是只能点一下试试）：
       * 有 → 亮号数；没有 → 留空。
       *
       * ⚠️ 这里**只表示一件事**（触屏键位号）。原先触屏设备上这里还兼作
       * "行序号"，而两种含义只靠颜色区分 —— 玩家会把「轰」上的 `2` 读成
       * "它在第 2 个键位上"。同一个位置只留一个含义。
       */
      const bound = order >= 0;
      cell.slot.set(bound ? String(order + 1) : '');
      cell.slot.setColor(bound ? PALETTE.douqi.bright : PALETTE.textDim);

      // 按键名统一大写显示，与技能栏上的提示一致
      cell.key.set(
        state.showKeyHints === false
          ? ''
          : capturing
            ? '…'
            : formatKey(row.key, this.translate('settings.keyUnbound')),
      );
      cell.key.setColor(capturing || focused ? PALETTE.douqi.bright : PALETTE.text);

      if (focused) onFocused(row);

      // 交替底色 + 捕获 / 键盘焦点 / "上了触屏键位"的高亮
      const box = (): typeof this.gfx =>
        this.gfx.rect(cell.rect.x, cell.rect.y, cell.rect.w, cell.rect.h);
      box().fill({
        color: capturing || focused || hasButton ? PALETTE.douqi.base : 0xffffff,
        alpha: capturing
          ? 0.18
          : focused
            ? 0.12
            : hasButton
              ? /** ⚠️ 上过键位只给很淡的一层：它不该和"当前焦点"抢注意力。 */
                0.06
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
       * ⚠️ 已经上了触屏键位的格子只给**很淡**的一层底 ——
       * 它不该和"当前焦点"抢注意力（号数已经说明了这件事）。
       */
      box().stroke({
        color: capturing || focused || hasButton ? PALETTE.douqi.bright : 0x3c3e50,
        width: capturing || focused || hasButton ? 2 : 1,
        alpha: capturing || focused || hasButton ? 1 : 0.9,
      });
    }
  }
}
