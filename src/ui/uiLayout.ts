/**
 * UI 布局解析器 —— 把「基础布局表 + UI 缩放系数」解析成**实际使用的矩形**。
 *
 * ==================================================================
 * 它解决什么问题（需求原话）
 * ==================================================================
 *
 * "我不是说缩放整个游戏画面，我是指，**缩放游戏 UI**，比如面板、
 * 技能图标等，**战斗画面和战斗文字保持不变**，因此你可能需要
 * 新加一个缩放系数"
 *
 * 所以缩放系数**不能**加在画布上（那会连角色、场景、飘字一起缩放）。
 * 它必须只作用于 UI 部件，而且：
 *
 *   1. **按锚点缩放**：UI 是绝对定位的，直接乘系数会让右下角的技能栏
 *      朝画布中心挤过去。贴右下角的要从右下角长出来。
 *   2. **字号也要跟着变**：只放大框不放大字，会出现"面板很大、字很小"。
 *
 * ==================================================================
 * 为什么单独一个文件
 * ==================================================================
 *
 * 缩放要影响**几十处**渲染点（技能格、玩家面板、读条、资源条…）。
 * 如果每处都写一遍 `x * scale`，改一次锚点规则就要翻遍整个渲染层。
 * 集中在这里之后：
 *   - 渲染层只问 `uiLayout.playerPanel()`，不关心缩放怎么算
 *   - 动画/测试可以构造任意系数的解析器，不需要真渲染
 *   - 战斗画面与飘字**不经过这里**，天然不受影响
 */

import { LAYOUT, LOGICAL, scaleUiRect, UI_ANCHORS, type UiAnchor } from './layout';

/** 一个矩形（逻辑像素）。 */
export interface Rect {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

/**
 * UI 缩放系数的作用范围。
 *
 * 钳制放在这里而不是调用方：解析器是唯一的入口，
 * 钳在这里就不会有"某条路径漏了钳制"的问题。
 */
import { UI_SCALE_MAX, UI_SCALE_MIN } from '../render/scaling';

export class UiLayout {
  /** 已钳制的系数。 */
  readonly scale: number;

  constructor(scale: number) {
    this.scale = Number.isFinite(scale)
      ? Math.min(UI_SCALE_MAX, Math.max(UI_SCALE_MIN, scale))
      : 1;
  }

  /** 一个矩形：按它的锚点缩放 + 四舍五入到整像素。 */
  private rect(base: Rect, anchor: UiAnchor): Rect {
    if (this.scale === 1) return base;
    return scaleUiRect(base, anchor, this.scale);
  }

  /** 一个长度（字号、条高、间距…）。 */
  len(value: number): number {
    return Math.max(1, Math.round(value * this.scale));
  }

  /**
   * 技能格矩形（含**右对齐**的排布）。
   *
   * ⚠️ 不能直接用 `skillSlotRect` 再缩放：那一份是按 `LOGICAL.width`
   * 和原始 `right` 边距算的。缩放后"整条栏"变宽/变窄，右对齐关系
   * 必须**在缩放后的坐标系里重算**，否则最后一格会离开右边距。
   */
  skillSlotRect(index: number, total: number): Rect {
    const { slot, gap, y, right, max } = LAYOUT.skillBar;
    const size = this.len(slot);
    const spacing = this.len(gap);
    const margin = this.len(right);
    const count = Math.max(1, Math.min(total, max));
    const totalW = count * size + (count - 1) * spacing;
    const baseY = y + slot - size; // 底边对齐：底边位置不随缩放变
    return {
      x: LOGICAL.width - margin - totalW + index * (size + spacing),
      y: Math.round(baseY),
      w: size,
      h: size,
    };
  }

  /** 技能栏整体的包围盒（测试与调试用）。 */
  skillBarBounds(total: number): Rect {
    const first = this.skillSlotRect(0, total);
    const last = this.skillSlotRect(Math.max(0, total - 1), total);
    return {
      x: first.x,
      y: first.y,
      w: last.x + last.w - first.x,
      h: first.h,
    };
  }

  get playerPanel(): Rect {
    return this.rect(LAYOUT.player, UI_ANCHORS.playerPanel);
  }

  get playerCastBar(): Rect {
    return this.rect(LAYOUT.playerCastBar, UI_ANCHORS.playerCastBar);
  }

  get bossBar(): Rect {
    return this.rect(LAYOUT.bossBar, UI_ANCHORS.bossBar);
  }

  get bossHp(): Rect {
    return this.rect(LAYOUT.bossHp, UI_ANCHORS.bossHp);
  }

  /**
   * Boss 的 buff 条（血条下方左侧）。
   *
   * `IconStrip` 的几何是"`size` 方块 + 间距 + 流式排布"，所以这里
   * 返回一个**缩放后的矩形**，strip 自己按它重排（见 `IconStrip.setUiScale`）。
   */
  get bossBuffs(): { readonly x: number; readonly y: number; readonly size: number; readonly gap: number } {
    return this.stripRect(LAYOUT.bossBuffs);
  }

  /** Boss 的减益条（右上，**右对齐** —— `x` 是右缘）。 */
  get bossDebuffs(): { readonly x: number; readonly y: number; readonly size: number; readonly gap: number } {
    return this.stripRect(LAYOUT.bossDebuffs, 'right');
  }

  /**
   * 玩家的 buff / 减益条（面板上方，**左对齐**）。
   *
   * ⚠️ 这两个 getter 是**补上的**：原先只有 Boss 的两条有，玩家的两条没有
   * —— 于是 `playerStatus.setUiScale` 里根本没有可用的缩放矩形，
   * 那两条就一直保持 20px 不动 ✗ 而同屏的 Boss 图标会跟着放大。
   *
   * 同一屏幕上两处同类元素行为不一致，没有任何设计理由。
   * `LAYOUT.playerBuffs/playerDebuffs` 的 `align` 是 `'left'`，
   * 所以**不传** `'right'`（传了会把它们翻到右缘去）。
   */
  get playerBuffs(): { readonly x: number; readonly y: number; readonly size: number; readonly gap: number } {
    return this.stripRect(LAYOUT.playerBuffs);
  }

  get playerDebuffs(): { readonly x: number; readonly y: number; readonly size: number; readonly gap: number } {
    return this.stripRect(LAYOUT.playerDebuffs);
  }

  /**
   * buff 条的缩放后矩形。
   *
   * ⚠️ 右对齐的条 `x` 是**右缘**，缩放时要**贴着安全区反向**算：
   * 直接乘系数会让它随缩放往右跑出画布。
   */
  private stripRect(
    base: { readonly x: number; readonly y: number; readonly size: number; readonly gap: number },
    align?: 'right',
  ): { readonly x: number; readonly y: number; readonly size: number; readonly gap: number } {
    const inset = this.len(8);
    const x = align === 'right' ? LOGICAL.width - inset - this.len(LOGICAL.width - 8 - base.x) : base.x;
    return { x, y: base.y, size: this.len(base.size), gap: this.len(base.gap) };
  }

  /**
   * 战斗日志的矩形。
   *
   * ⚠️ **锚点是 `'top-left'`，曾经错写成 `'right'`**（已修）。
   *
   * 日志面板在**左上角**（`LAYOUT.log.x = 8`），而 `'right'` 是"贴右缘
   * 反向算 x"——scale=1 时两者**恰好都是 8**（`960-8-944=8`），所以这个
   * 错误在默认缩放下**完全看不出来** ✗ 一旦放大就露馅：150% 时 x 变成
   * 负数，面板探出画布左缘被裁掉。
   *
   * 教训：**锚点写错但默认值巧合正确**，是那种"只有用户去拖动滑块才会
   * 发现"的 bug。`UI_ANCHORS` 那张表里当时**没有** `logPanel` 这一条，
   * 所以没有任何东西能对账 —— 现在它仍然不进那张表（那张表的类型是
   * `Record<string, UiAnchor>`，加不加都行），但这个注释就是它的说明。
   */
  get logPanel(): Rect {
    return this.rect(LAYOUT.log, 'top-left');
  }

  get castBar(): Rect {
    return this.rect(LAYOUT.castBar, 'top');
  }

  /**
   * 玩家面板内部三根资源条的参数。
   *
   * 条高、间距、留白**都要跟着缩放**，否则放大后面板会空出一截
   * （条还是原来的粗细）。`playerBars` 的设计约束
   * （`h = top + 3×h + 2×gap + bottom`）在缩放后依然成立 ——
   * 因为每一项都乘了同一个系数。
   */
  get playerBars(): { readonly h: number; readonly top: number; readonly stride: number } {
    const { h, top, stride } = LAYOUT.playerBars;
    return { h: this.len(h), top: this.len(top), stride: this.len(stride) };
  }
}

/** 默认系数（1）—— 渲染层构造函数里的默认值。 */
export const BASE_UI_LAYOUT = new UiLayout(1);
