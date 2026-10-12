/**
 * **触屏技能面**（「按键」页 · 触屏方式 · 两步交互的第二步）。
 *
 * ==================================================================
 * 为什么它是**独立的一块**（而不是让键盘格阵兼职）
 * ==================================================================
 *
 * 用户 2026-10-12 的原话顺序说明了问题：
 *
 *   1. "键盘 **不显示**右下角的那个"（触屏键位预览）
 *   2. "触屏**没有点击进入绑定状态**"
 *   3. "虽然都是 **按键 tab**，但是里面的实现**有一半都不一样**"
 *
 * 上一版把两套缝在同一批技能格上：格子上 `Enter` / 点击的含义**随"有没有
 * 选中触屏键位"变** ✗ —— 玩家的困惑正是这么来的。现在：
 *
 *   | 面 | 组件 | 语义 |
 *   |---|---|---|
 *   | 键盘技能格 | `KeyGrid` | 点 = 选中 / 再点 = **改键** |
 *   | 触屏技能面 | **本文件** | 选中键位后点技能 = **绑到那个键位** |
 *
 * 两块**不共用命中区、不共用状态机**（用户："里面的实现有一半都不一样"），
 * 但共用三样：**可选技能池**（`rows`，来自 `bindableSkillIdsOf` 那条线）、
 * **配色表**（`render/theme` 的 PALETTE / `render/slotLook` 那条纪律）、
 * **滚动数学**（`ui/scrollWindow`，经 `touchPickerLayout` 转发）。
 *
 * ==================================================================
 * "绑定状态"必须**看得出来**（用户报的缺口就是它）
 * ==================================================================
 *
 * 没有选中键位时这一面是**暗的**（淡描边、淡字）—— 它在说"先点一个键位"；
 * 选中之后整面亮起来，而且**那个键位上已有的技能**会用高亮标出来
 * （点它 = 取下，判定在 `slotActions.resolveSlotBind`）。
 *
 * ⚠️ 位置与命中**同一份几何**（`./touchPickerLayout`）：分开算就会出现
 * "看着能点、点不中"（本仓库为这条踩过不止一次）。
 */

import type { Container, Graphics } from 'pixi.js';
import { FONT } from '../layout';
import { Label, type PixiCtor } from '../primitives';
import { PALETTE } from '../../render/theme';
import { pickerCapacity, pickerCellRect, pickerMetrics } from './touchPickerLayout';
import type { KeyRow } from './rows';
import type { TranslateFn } from '../../i18n/translator';

interface ChipView {
  readonly gfx: Graphics;
  readonly name: Label;
  /** 左上角的**键位号**（"这个技能在第几个键位上"）—— 与技能格同一套记法。 */
  readonly badge: Label;
}

/** 画这一面要的全部输入（面板每次重画时给）。 */
export interface PickerView {
  /** 可选技能池（顺序 = 窗口顺序）。 */
  readonly rows: readonly KeyRow[];
  /** 触屏槽位表（下标 = 键位号，`''` = 空）。 */
  readonly slotSkillIds: readonly string[];
  /** 当前选中的键位（`undefined` = 没进入绑定状态）。 */
  readonly selectedSlot: number | undefined;
  /** 焦点所在的那一格（**窗口内**下标；`-1` = 焦点不在这面）。 */
  readonly focusIndex: number;
  /** 窗口偏移（第一个可见技能在 `rows` 里的下标）。 */
  readonly offset: number;
}

export class TouchSkillPicker {
  readonly root: Container;

  private readonly chips: ChipView[] = [];
  /** 上一次画的技能数（`centerOf` 与几何要用它 —— 面板持有偏移，这里不留）。 */
  private count = 0;

  constructor(
    private readonly pixi: PixiCtor,
    private readonly translate: TranslateFn,
  ) {
    this.root = new this.pixi.Container();
    /**
     * ⚠️ 格子**一次建满容量**（`pickerCapacity()` 个），之后只改位置 / 文字
     * —— 每次重画都新建 Pixi 对象会让设置页卡顿（焦点每移动一次就重画）。
     */
    for (let i = 0; i < pickerCapacity(); i += 1) {
      const gfx = new this.pixi.Graphics();
      const name = new Label(this.pixi, {
        x: 0,
        y: 0,
        size: FONT.warn,
        color: PALETTE.text,
        kai: true,
        anchorX: 0.5,
        anchorY: 0.5,
      });
      const badge = new Label(this.pixi, {
        x: 0,
        y: 0,
        size: FONT.tiny,
        color: PALETTE.textDim,
        anchorX: 0,
        anchorY: 0,
      });
      this.root.addChild(gfx, name.root, badge.root);
      this.chips.push({ gfx, name, badge });
    }
  }

  setVisible(visible: boolean): void {
    this.root.visible = visible;
  }

  /** 第 `cellIndex` 个格子的圆心（调试探针 / 脚本点真实位置用）。 */
  centerOf(cellIndex: number): { readonly x: number; readonly y: number } | undefined {
    if (cellIndex < 0 || cellIndex >= this.count) return undefined;
    const rect = pickerCellRect(cellIndex, pickerMetrics(this.count));
    return { x: rect.x + rect.w / 2, y: rect.y + rect.h / 2 };
  }

  update(view: PickerView): void {
    this.count = view.rows.length;
    const metrics = pickerMetrics(this.count);
    /**
     * ⚠️ 窗口偏移**由面板持有**（`view.offset`），本组件不留副本 ——
     * 命中测试、焦点激活、渲染三处都要用它，副本一定会漂（"看着是这个
     * 技能、点下去绑了别的"）。
     */
    const start = view.offset;

    for (const [i, chip] of this.chips.entries()) {
      const row = view.rows[start + i];
      /** 多余的格子（池子小 / 窗口末尾）**整格藏起来**，不是画成空的。 */
      if (row === undefined) {
        chip.gfx.clear();
        chip.name.set('');
        chip.badge.set('');
        continue;
      }
      const rect = pickerCellRect(i, metrics);
      const cx = rect.x + rect.w / 2;
      const cy = rect.y + rect.h / 2;
      chip.name.root.x = cx;
      chip.name.root.y = cy;
      chip.badge.root.x = rect.x + 8;
      chip.badge.root.y = rect.y + 6;

      /**
       * ⚠️ 三种态一眼可分（这一面存在的意义就是"现在能不能点"）：
       *   绑定状态 + 它就是那个键位上已有的技能 → 高亮（点它 = 取下）
       *   绑定状态                            → 正常可点
       *   没进绑定状态                        → **暗的**（先点键位）
       */
      const active = view.selectedSlot !== undefined;
      const occupant =
        view.selectedSlot === undefined ? undefined : view.slotSkillIds[view.selectedSlot] ?? '';
      const isOccupant = occupant !== undefined && occupant === row.skillId;
      const focused = view.focusIndex === i;
      /** 它在**别的**键位上也有一份（号数告诉玩家是第几个）。 */
      const boundAt = view.slotSkillIds.indexOf(row.skillId);

      chip.name.set(this.translate(row.nameKey));
      chip.name.setColor(active ? PALETTE.text : PALETTE.textDim);
      chip.badge.set(boundAt >= 0 ? String(boundAt + 1) : '');
      chip.badge.setColor(boundAt >= 0 ? PALETTE.douqi.bright : PALETTE.textDim);

      const g = chip.gfx;
      g.clear();
      g.roundRect(rect.x, rect.y, rect.w, rect.h, 4).fill({
        color: isOccupant ? PALETTE.douqi.base : 0xffffff,
        alpha: isOccupant ? 0.2 : active ? 0.07 : 0.03,
      });
      g.roundRect(rect.x, rect.y, rect.w, rect.h, 4).stroke({
        color: isOccupant || focused ? PALETTE.douqi.bright : active ? 0x6a6c80 : 0x3c3e50,
        width: isOccupant || focused ? 2 : 1,
        alpha: active || isOccupant ? 1 : 0.8,
      });
    }
  }
}
