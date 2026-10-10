/**
 * 触屏按钮层：**双弧圆形按钮**。
 *
 * ==================================================================
 * 为什么是双弧（不是 4×2 格子）
 * ==================================================================
 *
 * 用户定案："移动端的技能按钮，应该是圆形，而且应该不是 4*2，
 * 参考其他同类游戏，是类似扇形排列的。"
 *
 * 理由是手的运动方式：拇指绕**拇指根**划弧，弧上的点**等距可达**；
 * 格子里的四个角要伸直手指去够。
 *
 * ==================================================================
 * ⚠️ 几何是算出来的，不是猜的
 * ==================================================================
 *
 * **单弧放不下**：半径 r 的弧上，相邻按钮需要弦长 ≥ `D+gap`，
 * 所以角间隔 = `2·asin((D+gap)/2r)`。实测 r=130 时角间隔约 32°，
 * 可用弧段（约 110°）只放得下 3–4 个。
 *
 * 当前几何（**穷举搜索**后的可行解，`D=72, gap=10`）：
 *
 *   圆心 `(950, 535)` —— **游戏区域的右下角**
 *   内弧 r=150，80° → 15°，**3 个**
 *   外弧 r=235，80° → 10°，**4 个**
 *
 * 已验证：4 / 5 / 6 / 7 个都不重叠（7 个时最小间距 84 > 82）、
 * 不越界、不压左列与 Boss 区。
 *
 * ==================================================================
 * ⚠️ 圆心为什么是 (950,535) 而不是正角落 (960,540)
 * ==================================================================
 *
 * 需求："应该以游戏区域右下角为圆心"。
 *
 * 但圆心**正好**在 `(960,540)` 时，可用角度区只有约 70° ——
 * 因为按钮自身有半径：角度接近 `0°` 会从**右边**出去，接近 `90°`
 * 会从**下边**出去。实测（D=72）：
 *
 *   任意半径的单弧最多放 **3–4 个**，**7 个放不下**（穷举 0 组可行）
 *
 * 把圆心往里挪 10px（`(950,535)`，视觉上仍然是右下角）之后，
 * 可用角度区变宽，同一套约束下有 **24 组可行解**。
 *
 * ⚠️ 另一个约束是**两弧必须在径向上分开 ≥ D+gap**：它们的角度带
 * 若重叠，半径差小于 82px 就会让相邻两弧的按钮撞上（实测 85px
 * 半径差时只有 45px 间距）。
 *
 * ⚠️ 每个弧**按自己的容量均分**角度（而不是按实际数量）——
 * 否则"只放 2 个"时会把它们铺满整条弧，两弧在视觉上交错。
 *
 * ⚠️ **容量上限是 7**（3+4）。第 8 个开始放不下 —— 要么缩小按钮
 * （64px 能到 5+4），要么改角度范围。目前默认 6–7 个，够用；
 * 真的加技能到 8 个时，`touchButtonCenter()` 返回 `undefined`，
 * 调用方**跳过**而不是画一个重叠的按钮。
 * 这个上限在 `docs/plans/2026-10-10-m8-mobile.md` §9.1 里记着。
 *
 * ==================================================================
 * 只负责画与命中；输入由 `TouchInputSource` 负责
 * ==================================================================
 *
 * 这一层订阅 `TouchLayout`（唯一真相），所以布局一变就重画。
 * 它同时导出**命中区域**给输入层 —— 因为"按钮画在哪"只有它知道。
 */

import type { BattleSnapshotView, SkillSlotView } from './viewModel';
import type { PixiCtor } from '../ui/primitives';
import { Label } from '../ui/primitives';
import { FONT } from '../ui/layout';
import { PALETTE } from './theme';

/* ------------------------------------------------------------------ *
 * 几何
 * ------------------------------------------------------------------ */

/** 按钮直径。72px ≈ 44px 可点下限的 1.6 倍，拇指按得准。 */
export const TOUCH_BUTTON_DIAMETER = 72;
/** 相邻按钮的最小间隔。 */
export const TOUCH_BUTTON_GAP = 10;

/** 双弧的圆心 —— 拇指根的大致位置（右下角偏内）。 */
export const TOUCH_ARC_CENTER = { x: 950, y: 535 } as const;

interface ArcSpec {
  readonly radius: number;
  /** 起始角（度）。0° = 正右，逆时针为正。 */
  readonly fromDeg: number;
  readonly toDeg: number;
  readonly capacity: number;
}

/**
 * 内弧先排（离拇指近），排满再上外弧。
 *
 * ⚠️ 顺序不能反：玩家最先看到的按钮应该在最舒服的位置。
 */
const ARCS: readonly ArcSpec[] = [
  { radius: 150, fromDeg: 80, toDeg: 15, capacity: 3 },
  { radius: 235, fromDeg: 80, toDeg: 10, capacity: 4 },
];

/** 双弧的总容量。 */
export const TOUCH_BUTTON_CAPACITY = ARCS.reduce((n, a) => n + a.capacity, 0);

/**
 * 第 `index` 个按钮的圆心位置。
 *
 * 返回 `undefined` 表示**超出容量**（调用方应跳过，而不是画重叠）。
 */
export function touchButtonCenter(index: number): { x: number; y: number } | undefined {
  let remaining = index;
  for (const arc of ARCS) {
    if (remaining < arc.capacity) {
      const span = arc.fromDeg - arc.toDeg;
      /**
       * 单个按钮时放在**弧中**（而不是起始角）—— 否则它会贴在弧的
       * 一端，看起来像布局坏了。
       */
      const t = arc.capacity === 1 ? 0.5 : remaining / (arc.capacity - 1);
      const deg = arc.fromDeg - span * t;
      const rad = (deg * Math.PI) / 180;
      return {
        x: TOUCH_ARC_CENTER.x - arc.radius * Math.cos(rad),
        y: TOUCH_ARC_CENTER.y - arc.radius * Math.sin(rad),
      };
    }
    remaining -= arc.capacity;
  }
  return undefined;
}

/**
 * 角标环的**圆心偏移**（相对按钮圆心）与半径系数。
 *
 * ⚠️ 导出是因为**命中测试要用同一组数字** —— 画在这里、点在别处
 * 就会出现"看着能点、点不中"。
 */
export const BADGE_OFFSET_RATIO = 0.6;
/**
 * 环的半径系数。
 *
 * ⚠️ 与偏移一起决定"环在按钮内还是压在边上"。原先偏移 0.72 时，
 * 环心到按钮圆心 `0.72·√2·r ≈ 1.02r` —— **刚好在按钮外**，于是
 * 环大部分露在按钮外面，点它还会先命中按钮边缘。实测发现后
 * 收到 0.6（`0.6·√2 ≈ 0.85r`，落在按钮内，视觉上像"贴一个角标"）。
 */
export const BADGE_RADIUS_RATIO = 0.42;

/** 某个按钮角标环的圆心（给命中测试用）。 */
export function badgeCenter(button: { x: number; y: number }): { x: number; y: number } {
  const r = TOUCH_BUTTON_DIAMETER / 2;
  const d = Math.round(r * BADGE_OFFSET_RATIO);
  return { x: button.x + d, y: button.y - d };
}

/* ------------------------------------------------------------------ *
 * 组件
 * ------------------------------------------------------------------ */

export interface TouchButtonLayerOptions {
  readonly pixi: PixiCtor;
  /** 本地化取词（注入，不 import i18n 单例 —— 与视图适配器一致）。 */
  readonly translate: (key: string) => string;
}

interface ButtonView {
  readonly root: InstanceType<PixiCtor['Container']>;
  readonly gfx: InstanceType<PixiCtor['Graphics']>;
  readonly glyph: Label;
  readonly cd: Label;
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
  private readonly translate: (key: string) => string;
  private readonly buttons: ButtonView[] = [];
  private skillIds: readonly string[] = [];

  constructor(options: TouchButtonLayerOptions) {
    this.pixi = options.pixi;
    this.translate = options.translate;
    this.root = new this.pixi.Container();
    this.root.visible = false;
  }

  /**
   * 设置按钮表。技能列表不变时**不重建对象**（只更新文本）。
   *
   * ⚠️ 重建 Pixi 对象是贵的；每帧重建会让帧率塌掉。
   */
  setButtons(skillIds: readonly string[]): void {
    const same =
      skillIds.length === this.skillIds.length &&
      skillIds.every((s, i) => s === this.skillIds[i]);
    if (same) return;
    this.skillIds = [...skillIds];

    // 多余的按钮先销毁
    while (this.buttons.length > this.skillIds.length) {
      const view = this.buttons.pop();
      if (view === undefined) break;
      this.root.removeChild(view.root);
      view.root.destroy({ children: true });
    }

    // 不足的补建
    while (this.buttons.length < this.skillIds.length) {
      const index = this.buttons.length;
      const center = touchButtonCenter(index);
      if (center === undefined) break; // 超出容量：不画
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
      const cost = new Label(this.pixi, {
        x: 0,
        y: 18,
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

      root.addChild(gfx, glyph.root, cd.root, cost.root, ringRoot);
      this.root.addChild(root);
      this.buttons.push({
        root,
        gfx,
        glyph,
        cd,
        cost,
        ring,
        ringGlyph,
        ringRoot,
        skillId: this.skillIds[index] ?? '',
        derivedSkillId: '',
      });
    }

    // 更新技能 id
    for (let i = 0; i < this.buttons.length; i += 1) {
      const view = this.buttons[i];
      if (view !== undefined) view.skillId = this.skillIds[i] ?? '';
    }
  }

  /** 每帧按快照更新文本。 */
  update(view: BattleSnapshotView): void {
    this.root.visible = this.buttons.length > 0;
    /**
     * **派生技不进扇形**：它作为"环"挂在**源按钮**上（见 `ButtonView.ring`）。
     * 所以这里先从快照里挑出派生技，再把它配给源按钮。
     */
    const derived = view.skills.find((s) => s.derivedFrom !== undefined);
    for (const button of this.buttons) {
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
    }
    const dim = !slot.usable;
    button.glyph.root.alpha = dim ? 0.62 : 1;
    button.cd.root.alpha = 1;
    button.cost.root.alpha = dim ? 0.62 : 1;
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
    for (const view of this.buttons) {
      this.root.removeChild(view.root);
      view.root.destroy({ children: true });
    }
    this.buttons.length = 0;
    this.root.destroy({ children: true });
  }
}
