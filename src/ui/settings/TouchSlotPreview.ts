/**
 * 设置页右下角的**模拟键位**（触屏键位的配置面）。
 *
 * ==================================================================
 * 它画的就是战斗里那组双弧
 * ==================================================================
 *
 * 需求："在设置页面的右下角，模拟一个 7 个键位"，交互是
 * "点键位 =》 点技能 =》 绑定这个技能到这个键位"。
 *
 * ⚠️ **位置一个都不许手摆**：每个槽位的圆心来自 `./touchPreview`，而那里
 * 是从 `render/touchGeometry` 的同一份双弧几何**等比变换**过来的 ——
 * 所以"预览里第 3 个键位在哪"与"战斗里第 3 个按钮在哪"结构上不可能不一致
 * （AGENTS.md §3b："画布几何是算出来的……不要手调数字"）。
 *
 * ==================================================================
 * 与面板的分工
 * ==================================================================
 *
 * 这个组件**拥有"当前选中哪个键位"这份状态**（`selected`）—— 它是键位区
 * 自己的状态，面板与派发层只通过 `select` / `deselect` / `tap` 改它，
 * 靠 `selectedSlot` 读它。判定（点已选中的 = 取消选中）在
 * `./slotActions.resolveSlotTap`，组件不自己发明规则。
 */

import type { Container, Graphics } from 'pixi.js';
import { FONT } from '../layout';
import { Label, type PixiCtor } from '../primitives';
import { PALETTE } from '../../render/theme';
import { TOUCH_BUTTON_CAPACITY } from '../../render/touchGeometry';
import { touchResetButtonRect } from './logic';
import { ResetDefaultButton } from './ResetDefaultButton';
import {
  previewCaptionX,
  previewCaptionY,
  previewSlotCenter,
  previewSlotRadius,
} from './touchPreview';
import type { TranslateFn } from '../../i18n/translator';

interface SlotView {
  readonly gfx: Graphics;
  readonly name: Label;
  readonly num: Label;
  readonly x: number;
  readonly y: number;
  readonly r: number;
}

export class TouchSlotPreview {
  readonly root: Container;

  private readonly translate: TranslateFn;
  private readonly caption: Label;
  /**
   * **触屏那一份**「恢复默认」—— 就贴在这块预览下面。
   *
   * ⚠️ 它属于**这个块**（不是"按设备分流的那个按钮"）：点了它只恢复触屏
   * 键位，与当前是什么设备无关（见 `settingsGeometry.RESET_BUTTON`）。
   */
  private readonly reset: ResetDefaultButton;
  private readonly slots: SlotView[] = [];
  /** 当前**选中**（"待绑定"）的键位；`undefined` = 没选中。 */
  private selectedIndex: number | undefined;

  constructor(pixi: PixiCtor, translate: TranslateFn) {
    this.translate = translate;
    this.root = new pixi.Container();
    this.caption = new Label(pixi, {
      x: previewCaptionX(),
      y: previewCaptionY(),
      size: FONT.small,
      color: PALETTE.textDim,
    });
    this.root.addChild(this.caption.root);

    this.reset = new ResetDefaultButton(pixi, touchResetButtonRect());
    this.reset.setText(translate('settings.touchReset'));
    this.root.addChild(this.reset.root);

    /**
     * ⚠️ 槽位视图**一次建满容量**（7 个），之后只改文本与描边 ——
     * 每次重画都新建 Pixi 对象会让设置页卡顿（焦点每次移动都会重画）。
     */
    const r = previewSlotRadius();
    for (let i = 0; i < TOUCH_BUTTON_CAPACITY; i += 1) {
      const center = previewSlotCenter(i);
      if (center === undefined) continue;
      const gfx = new pixi.Graphics();
      const name = new Label(pixi, {
        x: center.x,
        y: center.y,
        size: FONT.body,
        color: PALETTE.text,
        anchorX: 0.5,
        anchorY: 0.5,
      });
      /** 槽位号（左上角小字）—— 让玩家能把"第 3 个键位"说出来。 */
      const num = new Label(pixi, {
        x: center.x - r * 0.62,
        y: center.y - r * 0.72,
        size: FONT.tiny,
        color: PALETTE.textDim,
        anchorX: 0.5,
        anchorY: 0.5,
      });
      this.root.addChild(gfx, name.root, num.root);
      this.slots.push({ gfx, name, num, x: center.x, y: center.y, r });
    }
  }

  /** 当前选中的键位（没有则 `undefined`）。 */
  get selected(): number | undefined {
    return this.selectedIndex;
  }

  setVisible(visible: boolean): void {
    this.root.visible = visible;
  }

  /** 选中某个键位（**不**做 toggle 判定 —— 那在 `slotActions`）。 */
  select(index: number): void {
    this.selectedIndex = index;
  }

  deselect(): void {
    this.selectedIndex = undefined;
  }

  /** 槽位号 → 圆心（端到端脚本与测试用；与绘制同源）。 */
  centerOf(index: number): { readonly x: number; readonly y: number } | undefined {
    const slot = this.slots[index];
    return slot === undefined ? undefined : { x: slot.x, y: slot.y };
  }

  /**
   * 重画。
   *
   * @param slotSkillIds 槽位表（下标 = 槽位，`''` = 空）
   * @param nameOf 取技能名（已翻译；取不到就给空）
   * @param focusIndex 键盘焦点所在的槽位（`undefined` = 焦点不在键位区）
   * @param resetFocused 键盘焦点是否在**这一块自己的**「恢复默认」上
   */
  update(
    slotSkillIds: readonly string[],
    nameOf: (skillId: string) => string,
    focusIndex: number | undefined,
    resetFocused: boolean,
  ): void {
    this.reset.setFocused(resetFocused);
    for (const [i, slot] of this.slots.entries()) {
      const skillId = slotSkillIds[i] ?? '';
      const bound = skillId !== '';
      const selected = this.selectedIndex === i;
      /** 键盘停在这儿但**没有**选中（按 Enter 取消之后）—— 画一圈淡的。 */
      const focused = focusIndex === i && !selected;

      slot.name.set(bound ? nameOf(skillId) : '');
      slot.name.setColor(bound ? PALETTE.text : PALETTE.textDim);
      slot.num.set(String(i + 1));
      slot.num.setColor(bound ? PALETTE.douqi.bright : PALETTE.textDim);

      const g = slot.gfx;
      g.clear();
      /**
       * 圆底：**空键位也要画**（只是更淡）—— 玩家要能看到"这里有 7 个键位
       * 可以放东西"，那正是"点键位 → 点技能"的第一步。
       */
      g.circle(slot.x, slot.y, slot.r).fill({
        color: 0x14151f,
        alpha: bound ? 0.9 : 0.5,
      });
      const stroke = selected
        ? { color: PALETTE.douqi.bright, width: 2.5, alpha: 1 }
        : focused
          ? { color: PALETTE.douqi.bright, width: 1, alpha: 0.6 }
          : bound
            ? { color: 0x6a6c80, width: 1.5, alpha: 1 }
            : { color: 0x3c3e50, width: 1, alpha: 0.8 };
      g.circle(slot.x, slot.y, slot.r).stroke(stroke);
      if (selected) {
        g.circle(slot.x, slot.y, slot.r).fill({ color: PALETTE.douqi.base, alpha: 0.18 });
      }
    }
    /**
     * 说明行：没有选中时是**块标题**，选中之后换成"已选键位 N" ——
     * 玩家一眼能确认"我点的是第几个"。
     */
    const selected = this.selectedIndex;
    this.caption.set(
      selected === undefined
        ? this.translate('settings.slotCaption')
        : this.translate('settings.slotSelected', { index: selected + 1 }),
    );
    this.caption.setColor(selected === undefined ? PALETTE.textDim : PALETTE.douqi.bright);
  }
}
