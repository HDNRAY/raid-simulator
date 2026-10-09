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
import { KEY_GRID_CAPACITY, keyCellRect } from './logic';
import { keyLabel as formatKey } from './logic';
import type { KeyRow } from './rows';

/** 每一格的状态（焦点 / 是否正在改键）。 */
export interface KeyGridState {
  /** 焦点落在第几个格子；`-1` = 焦点不在格子上 */
  readonly focusIndex: number;
  /** 正在等按键的技能 id（那一格显示「…」） */
  readonly capturingSkillId: string | undefined;
}

export class KeyGrid {
  readonly root: Container;

  private readonly gfx: Graphics;
  private readonly cells: Array<{
    name: Label;
    key: Label;
    rect: { x: number; y: number; w: number; h: number };
  }> = [];

  constructor(
    private readonly pixi: PixiCtor,
    private readonly translate: (key: string) => string,
  ) {
    this.root = new this.pixi.Container();
    this.gfx = new this.pixi.Graphics();
    this.root.addChild(this.gfx);

    for (let i = 0; i < KEY_GRID_CAPACITY; i += 1) {
      const rect = keyCellRect(i);
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
      this.root.addChild(name.root, key.root);
      this.cells.push({ name, key, rect });
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
    this.gfx.clear();
    for (const cell of this.cells) {
      cell.name.set('');
      cell.key.set('');
    }

    for (const [i, row] of rows.entries()) {
      if (i >= KEY_GRID_CAPACITY) break;
      const cell = this.cells[i];
      if (!cell) continue;

      const capturing = state.capturingSkillId === row.skillId;
      const focused = state.focusIndex === i;
      cell.name.set(this.translate(row.nameKey));
      // 按键名统一大写显示，与技能栏上的提示一致
      cell.key.set(
        capturing ? '…' : formatKey(row.key, this.translate('settings.keyUnbound')),
      );
      cell.key.setColor(capturing || focused ? PALETTE.douqi.bright : PALETTE.text);

      if (focused) onFocused(row);

      // 交替底色 + 捕获 / 键盘焦点的高亮
      this.gfx.rect(cell.rect.x, cell.rect.y, cell.rect.w, cell.rect.h).fill({
        color: capturing || focused ? PALETTE.douqi.base : 0xffffff,
        alpha: capturing ? 0.18 : focused ? 0.12 : i % 2 === 0 ? 0.03 : 0.06,
      });
      if (capturing || focused) {
        this.gfx.rect(cell.rect.x, cell.rect.y, cell.rect.w, cell.rect.h).stroke({
          color: PALETTE.douqi.bright,
          width: focused ? 1.5 : 1,
        });
      }
    }
  }
}
