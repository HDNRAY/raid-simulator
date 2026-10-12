/**
 * 触屏按钮层：**双弧圆形按钮**。
 *
 * ==================================================================
 * 几何不在这里
 * ==================================================================
 *
 * 半径 / 角度 / 槽位圆心全在 `./touchGeometry`（**唯一真相**）——
 * 设置页右下角的模拟键位预览也消费同一份。这里只负责"按几何画按钮、
 * 按快照更新文字"。（原先几何在本文件里，加预览时会出现第二份真相。）
 *
 * ==================================================================
 * ⚠️ `index` 是**槽位**，不是数组下标
 * ==================================================================
 *
 * 2026-10-12 用户定的交互是"点键位 → 点技能 → 绑到这个键位"，
 * 所以槽位是**固定的 7 个格子**，中间可以是空的：
 *
 *   `setButtons(['attack', '', 'guard'])`
 *   → 第 0、2 个槽位上有按钮，第 1 个槽位**什么都不画**
 *
 * 于是在这里 `slots[i]` 的下标就是槽位号，`touchButtonCenter(i)` 直接
 * 可用。⚠️ 不要退回"按下标压缩"（那会让"第 3 个键位"变成"第 2 个"，
 * 玩家在设置页摆好的位置就白摆了）。
 *
 * ==================================================================
 * 只负责画与命中；输入由 `TouchInputSource` 负责
 * ==================================================================
 *
 * 这一层订阅 `TouchLayout`（唯一真相），所以布局一变就重画。
 * 它同时导出**命中区域**给输入层 —— 因为"按钮画在哪"只有它知道。
 */

import type { BattleSnapshotView, ResourceKeyName, SkillSlotView } from './viewModel';
import type { PixiCtor } from '../ui/primitives';
import { Label } from '../ui/primitives';
import { FONT } from '../ui/layout';
import { PALETTE } from './theme';
import { RESOURCE_COLORS } from './skillBar';
import type { TranslateFn } from '../i18n/translator';
import {
  BADGE_OFFSET_RATIO,
  BADGE_RADIUS_RATIO,
  TOUCH_BUTTON_DIAMETER,
  touchButtonCenter,
} from './touchGeometry';

/**
 * 几何的**转发**：外部（与测试）一直从本模块 import 它们，路径不变。
 * 定义在 `./touchGeometry` —— 见那里的文件头。
 */
export {
  BADGE_OFFSET_RATIO,
  BADGE_RADIUS_RATIO,
  TOUCH_ARC_CENTER,
  TOUCH_BUTTON_CAPACITY,
  TOUCH_BUTTON_DIAMETER,
  TOUCH_BUTTON_GAP,
  badgeCenter,
  touchButtonCenter,
  touchLayoutBounds,
} from './touchGeometry';

/* ------------------------------------------------------------------ *
 * 组件
 * ------------------------------------------------------------------ */

export interface TouchButtonLayerOptions {
  readonly pixi: PixiCtor;
  /** 本地化取词（注入，不 import i18n 单例 —— 与视图适配器一致）。 */
  readonly translate: TranslateFn;
}

interface ButtonView {
  readonly root: InstanceType<PixiCtor['Container']>;
  readonly gfx: InstanceType<PixiCtor['Graphics']>;
  readonly glyph: Label;
  readonly cd: Label;
  readonly skillCd: Label;
  readonly cost: Label;
  /**
   * **派生技的角标环**（画在原按钮上的小环）。
   *
   * 需求："移动端则需要设计一下。" —— 触屏的下标：
   * `A` 作为扇形第 7 个按钮（"从哪来"看不出来）；`B` **画成原按钮
   * 上的角标环**（视觉上表达"派生"，且不占扇形额度）。
   *
   * 选了 B。
   */
  readonly ring: InstanceType<PixiCtor['Graphics']>;
  readonly ringGlyph: Label;
  /** 环的容器（整体显隐靠它）。 */
  readonly ringRoot: InstanceType<PixiCtor['Container']>;
  /** 当前的技能 id —— 用来判断布局有没有变。 */
  skillId: string;
  /** 这个按钮上**当前**挂着的派生技（没有则空）。 */
  derivedSkillId: string;
}

/**
 * 触屏按钮层。
 *
 * 生命周期：`new TouchButtonLayer(...)` → 每帧 `update(view)` →
 * `dispose()`。布局通过 `setButtons()` 推给它（由主循环订阅
 * `TouchLayout` 后转发），**它自己不留布局副本**。
 */
export class TouchButtonLayer {
  readonly root: InstanceType<PixiCtor['Container']>;

  private readonly pixi: PixiCtor;
  private readonly translate: TranslateFn;
  /** 槽位号 → 按钮。空槽位**没有**条目（不是画一个空圆）。 */
  private readonly buttons = new Map<number, ButtonView>();
  /** 当前槽位表（下标 = 槽位，`''` = 空）。 */
  private slots: readonly string[] = [];

  constructor(options: TouchButtonLayerOptions) {
    this.pixi = options.pixi;
    this.translate = options.translate;
    this.root = new this.pixi.Container();
    this.root.visible = false;
  }

  /**
   * 设置槽位表（下标 = 槽位，`''` = 空）。
   *
   * ⚠️ 内容不变时**不重建**（重建 Pixi 对象是贵的；每帧重建会让帧率塌掉）。
   */
  setButtons(slots: readonly string[]): void {
    const same =
      slots.length === this.slots.length && slots.every((s, i) => s === this.slots[i]);
    if (same) return;
    this.slots = [...slots];

    /** 1) 空槽位上的按钮销毁；有技能的按钮只更新 `skillId`。 */
    for (const [index, view] of [...this.buttons]) {
      const skillId = this.slots[index] ?? '';
      if (skillId === '') {
        this.buttons.delete(index);
        this.root.removeChild(view.root);
        view.root.destroy({ children: true });
      } else {
        view.skillId = skillId;
      }
    }
    /** 2) 新槽位补建（超出容量的跳过，不画重叠）。 */
    for (const [index, skillId] of this.slots.entries()) {
      if (skillId === '' || this.buttons.has(index)) continue;
      const view = this.buildButton(index, skillId);
      if (view !== undefined) this.buttons.set(index, view);
    }
  }

  /** 画一个槽位的按钮（**位置只来自 `touchButtonCenter`**）。 */
  private buildButton(index: number, skillId: string): ButtonView | undefined {
    const center = touchButtonCenter(index);
    if (center === undefined) return undefined; // 超出容量：不画
    const radius = TOUCH_BUTTON_DIAMETER / 2;
    const gfx = new this.pixi.Graphics();
    const glyph = new Label(this.pixi, {
      x: 0,
      y: -4,
      size: FONT.big,
      color: PALETTE.text,
      anchorX: 0.5,
      anchorY: 0.5,
    });
    const cd = new Label(this.pixi, {
      x: 0,
      y: 18,
      size: FONT.small,
      color: 0xffd080,
      anchorX: 0.5,
      anchorY: 0.5,
    });
    /**
     * **固有 CD**（左下）与**代价**（右下）分居两角 —— 与桌面技能格
     * 同一套位置语言（那里 `skillCd` 在左下、`cost` 在右下）。
     *
     * ⚠️ 原先触屏只有 `cost`、且居中在字形下方，所以：
     *   1. 代价**没有按资源上色**（需求："代价没有按颜色显示"）
     *   2. **看不到这一招的 CD 是多少**（需求："也没显示招式的 cd
     *      是多少（不是实时那个）"）
     * 两者都在这一版补上。
     */
    const skillCd = new Label(this.pixi, {
      x: -Math.round(radius * 0.46),
      y: Math.round(radius * 0.56),
      size: FONT.tiny,
      color: PALETTE.textDim,
      anchorX: 0.5,
      anchorY: 0.5,
    });
    const cost = new Label(this.pixi, {
      x: Math.round(radius * 0.46),
      y: Math.round(radius * 0.56),
      size: FONT.tiny,
      color: PALETTE.text,
      anchorX: 0.5,
      anchorY: 0.5,
    });
    const root = new this.pixi.Container();
    root.x = center.x;
    root.y = center.y;

    /**
     * 圆底 + 描边。
     *
     * ⚠️ 触屏没有"悬停"也没有"按下"之外的反馈渠道，所以按钮
     * **必须有可见的圆底** —— 桌面技能栏那套"只有字、没有方框"
     * 的语言在这里不适用（手指需要看到可点的目标）。
     */
    gfx.circle(0, 0, radius).fill({ color: 0x14151f, alpha: 0.82 });
    gfx.circle(0, 0, radius).stroke({ color: 0x3c3e50, width: 2 });

    /**
     * 角标环：贴在按钮**右上**、半径 40%，表示"从这里派生出一个技能"。
     * 平时不可见，只在派生窗口开着时出现。
     */
    const ringR = Math.round(radius * BADGE_RADIUS_RATIO);
    const ring = new this.pixi.Graphics();
    ring.circle(0, 0, ringR).fill({ color: 0x1a1b26, alpha: 0.95 });
    ring.circle(0, 0, ringR).stroke({ color: 0xffd870, width: 2 });
    const ringGlyph = new Label(this.pixi, {
      x: 0,
      y: 0,
      size: FONT.small,
      color: 0xffd870,
      anchorX: 0.5,
      anchorY: 0.5,
    });
    /** 环挂在按钮容器的右上角。 */
    const ringRoot = new this.pixi.Container();
    ringRoot.x = Math.round(radius * BADGE_OFFSET_RATIO);
    ringRoot.y = -Math.round(radius * BADGE_OFFSET_RATIO);
    ringRoot.addChild(ring, ringGlyph.root);
    ringRoot.visible = false;

    root.addChild(gfx, glyph.root, cd.root, skillCd.root, cost.root, ringRoot);
    this.root.addChild(root);
    return {
      root,
      gfx,
      glyph,
      cd,
      skillCd,
      cost,
      ring,
      ringGlyph,
      ringRoot,
      skillId,
      derivedSkillId: '',
    };
  }

  /** 每帧按快照更新文本。 */
  update(view: BattleSnapshotView): void {
    this.root.visible = this.buttons.size > 0;
    /**
     * **派生技不进扇形**：它作为"环"挂在**源按钮**上（见 `ButtonView.ring`）。
     * 所以这里先从快照里挑出派生技，再把它配给源按钮。
     */
    const derived = view.skills.find((s) => s.derivedFrom !== undefined);
    for (const button of this.buttons.values()) {
      const slot = view.skills.find((s) => s.skillId === button.skillId);
      this.applySlot(button, slot);
      const attached =
        derived !== undefined && derived.derivedFrom === button.skillId ? derived : undefined;
      button.derivedSkillId = attached?.skillId ?? '';
      button.ringRoot.visible = attached !== undefined;
      if (attached !== undefined) button.ringGlyph.set(this.translate(attached.nameKey));
    }
  }

  private applySlot(button: ButtonView, slot: SkillSlotView | undefined): void {
    if (slot === undefined) {
      /**
       * 快照里没有这个技能（布局刚变、快照还没跟上）→ 画成不可用，
       * 而不是显示上一次的文本（那会误导玩家）。
       */
      button.glyph.set('');
      button.cd.set('');
      button.skillCd.set('');
      button.cost.set('');
      return;
    }
    button.glyph.set(this.translate(slot.nameKey));
    button.glyph.setColor(slot.usable ? 0xffffff : 0x8a8a98);
    /**
     * 冷却数字与代价**共用同一个位置**（不会同时出现）：
     * 冷却中显示剩余秒数，否则显示代价。
     *
     * 这与桌面技能格的处理一致 —— 玩家不需要同时看两个数。
     */
    if (slot.cooldownRatio > 0.001 && slot.cooldownSec > 0) {
      button.cd.set(`${slot.cooldownSec.toFixed(1)}`);
      button.cost.set('');
    } else {
      button.cd.set('');
      button.cost.set(this.costText(slot));
      /** ⚠️ **按资源上色**（与桌面技能格同一个色表）。 */
      const resource = slot.cost?.resource;
      if (resource !== undefined && resource in RESOURCE_COLORS) {
        button.cost.setColor(RESOURCE_COLORS[resource as ResourceKeyName]);
      } else {
        button.cost.setColor(PALETTE.text);
      }
    }
    /**
     * **固有 CD**（整数秒）—— 与实时冷却不同，它**常驻显示**，
     * 让玩家在技能可用时也知道"这一招多久能再放"。
     * 无冷却（CD = 0）则留空。
     */
    button.skillCd.set(slot.skillCdSec > 0 ? String(Math.round(slot.skillCdSec)) : '');
    const dim = !slot.usable;
    button.glyph.root.alpha = dim ? 0.62 : 1;
    button.cd.root.alpha = 1;
    button.cost.root.alpha = dim ? 0.62 : 1;
    button.skillCd.root.alpha = dim ? 0.62 : 1;
  }

  /**
   * 代价文案（炁 / 缠 / 血）。
   *
   * ⚠️ 后缀（如按住技的 `/s`）是**渲染层加的字面量**、不走 i18n ——
   * `/s` 是通用符号，与桌面技能格的处理一致。
   */
  private costText(slot: SkillSlotView): string {
    const cost = slot.cost;
    if (cost === undefined || cost.value <= 0) return '';
    return `${cost.value}${cost.suffix ?? ''}`;
  }

  dispose(): void {
    for (const view of this.buttons.values()) {
      this.root.removeChild(view.root);
      view.root.destroy({ children: true });
    }
    this.buttons.clear();
    this.root.destroy({ children: true });
  }
}
