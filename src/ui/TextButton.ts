/**
 * **共用的文字按钮**（2026-10-22）。
 *
 * 用户原话：
 * > 这个 按钮 和其他界面的其他按钮 **风格保持一致**，如果按钮 你没有 抽出来
 * > 做 单独的组件，现在抽
 *
 * ==================================================================
 * 它管什么、不管什么
 * ==================================================================
 *
 * **管**（这是"风格一致"的全部内容，只有这一份实现）：
 *   - 圆角底板 + 描边 + 居中文字（三种状态：常态 / 焦点 / 禁用）
 *   - 焦点描边（走了键盘焦点就得看得出来）
 *   - 禁用态用 `PALETTE.textFaint` / `PALETTE.panelLine`（**不是**"画一个灰按钮"）
 *   - **键位提示的拼接**：`开始游戏` + `(Enter)`。⚠️ 键名**不进 i18n**
 *     （AGENTS §3b：改快捷键不该改文案），所以组件收的是"**已经格式化的键名**"
 *     （`input/keyboard` 的 `keyLabel` 产物），自己拼成 `标签 (键名)`。
 *   - 命中测试 `contains(px, py)` —— 几何只有一份（`rect`），渲染与命中共用
 *
 * **不管**（留给各屏，见文件末尾的清单）：
 *   - 布局：按钮**在哪、多大**由调用方给（`rect`）—— 首页三个入口是
 *     `320×56` 的通栏大卡、设置里那两颗是 `~130×26` 的小钮，硬统一成一种尺寸
 *     只会让两边都难看
 *   - 图标：带图标的按钮是另一类（`ui/IconButton`）
 *   - 业务动作：`onClick` 不由组件调 —— 组件只回答"这一下点没点中"
 *
 * ⚠️ 与 `ui/settings/ResetDefaultButton` 的关系：那个是"设置页两块各一个"
 * 的专用小钮，形状（`round 3`、白 0.08 底）与这里**同源** —— 这一轮抽出来
 * 之后它仍然保留（它的 `rectOf` 跟着 UI 缩放走，是设置页特有的需求），
 * 但**画法**应当与本组件一致：底色 `0xffffff@0.08`、描边 `0x6a6c80`、
 * 焦点 `PALETTE.douqi.bright`。
 */

import type { Container, Graphics } from 'pixi.js';
import { FONT } from './layout';
import { Label, type PixiCtor } from './primitives';
import { PALETTE } from '../render/theme';

/** 一个矩形（逻辑坐标）。 */
export interface ButtonRect {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

/**
 * 视觉变体。
 *
 * | kind | 用途 | 底色 / 描边 |
 * |---|---|---|
 * | `primary` | 这一屏的**主操作**（开始游戏 / 开始战斗） | 金色底 + 亮描边 |
 * | `secondary` | 次级动作（回主菜单 / 恢复默认那类） | 极淡白底 + 灰描边 |
 *
 * ⚠️ 只有这两个变体：多一个变体就多一处"这个按钮为什么比那个亮"的解释。
 */
export type ButtonKind = 'primary' | 'secondary';

export interface TextButtonOptions {
  readonly pixi: PixiCtor;
  readonly rect: ButtonRect;
  /** 文案（**已翻译**：渲染层不许硬编码可显示文字，i18n 规范 I1）。 */
  readonly label: string;
  /**
   * 键名（`keyLabel('Enter', '')` 那种**已格式化**的产物）。
   * 传了就拼成 `标签 (键名)`；**不要**把键名写进 i18n。
   */
  readonly keyHint?: string | undefined;
  readonly kind?: ButtonKind;
  /** 字号（默认 `FONT.body`；设置页那种小钮传 `FONT.small`）。 */
  readonly size?: number;
  /** 楷体（标题性按钮用；默认 `true`，与既有按钮一致）。 */
  readonly kai?: boolean;
  /** 圆角半径（默认 8；设置页小钮传 3）。 */
  readonly radius?: number;
  readonly onPress?: () => void;
}

export class TextButton {
  readonly root: Container;

  private readonly gfx: Graphics;
  private readonly label: Label;
  private readonly translateLabel: (label: string, keyHint: string | undefined) => string;
  private text = '';
  /** 不带键位提示的原文（换键位提示时要用它重新拼）。 */
  private plainLabel = '';
  private keyHint: string | undefined;
  private rect: ButtonRect;
  private focused = false;
  private enabled = true;
  private readonly kind: ButtonKind;
  private readonly radius: number;
  /** 动作（由调用方注入；组件只回答"点没点中 / 能不能点"）。 */
  private onPressHandler: (() => void) | undefined;

  constructor(options: TextButtonOptions) {
    this.rect = options.rect;
    this.kind = options.kind ?? 'primary';
    this.radius = options.radius ?? 8;
    this.keyHint = options.keyHint;
    this.translateLabel = (label, keyHint) =>
      keyHint === undefined || keyHint === '' ? label : `${label} (${keyHint})`;

    this.root = new options.pixi.Container();
    this.gfx = new options.pixi.Graphics();
    this.label = new Label(options.pixi, {
      x: this.rect.x + this.rect.w / 2,
      y: this.rect.y + this.rect.h / 2,
      size: options.size ?? FONT.body,
      color: PALETTE.text,
      anchorX: 0.5,
      anchorY: 0.5,
      kai: options.kai ?? true,
    });
    this.root.addChild(this.gfx, this.label.root);
    this.plainLabel = options.label;
    this.text = this.translateLabel(options.label, options.keyHint);
    this.label.set(this.text);
    this.onPressHandler = options.onPress;
    this.draw();
  }

  /** 当前矩形（渲染与命中**共用这一份**）。 */
  get bounds(): ButtonRect {
    return this.rect;
  }

  get isEnabled(): boolean {
    return this.enabled;
  }

  /** 换位置 / 尺寸（UI 缩放、布局变化时）。 */
  setRect(rect: ButtonRect): void {
    this.rect = rect;
    this.label.root.x = rect.x + rect.w / 2;
    this.label.root.y = rect.y + rect.h / 2;
    this.draw();
  }

  /** 换文案（**已翻译**；键位提示保持不变，会重新拼接）。 */
  setLabel(label: string): void {
    this.plainLabel = label;
    const next = this.translateLabel(label, this.keyHint);
    if (next === this.text) return;
    this.text = next;
    this.label.set(next);
  }

  /** 换键位提示（`undefined` = 不显示；键名不进 i18n，见文件头）。 */
  setKeyHint(keyHint: string | undefined): void {
    this.keyHint = keyHint;
    const next = this.translateLabel(this.plainLabel, keyHint);
    if (next === this.text) return;
    this.text = next;
    this.label.set(next);
  }

  setFocused(focused: boolean): void {
    if (focused === this.focused) return;
    this.focused = focused;
    this.draw();
  }

  /**
   * 可用 / 禁用。
   *
   * ⚠️ **禁用仍然占位**（`contains` 照样返回真）：禁用是"点下去不做事"，
   * 不是"这一块不存在" —— 让 `contains` 返回假会把"点空了"和"点了没反应"
   * 混成一件事 ✗。调用方拿 `isEnabled` 决定要不要执行动作。
   */
  setEnabled(enabled: boolean): void {
    if (enabled === this.enabled) return;
    this.enabled = enabled;
    this.draw();
  }

  setVisible(visible: boolean): void {
    this.root.visible = visible;
  }

  /** 这一下点没点中（几何只有一份）。 */
  contains(px: number, py: number): boolean {
    return (
      px >= this.rect.x
      && px <= this.rect.x + this.rect.w
      && py >= this.rect.y
      && py <= this.rect.y + this.rect.h
    );
  }

  /**
   * 点一下：命中**且**可用才算。
   *
   * @returns 有没有真的触发（禁用 / 点空都返回 `false`）
   */
  press(px: number, py: number): boolean {
    if (!this.contains(px, py)) return false;
    if (!this.enabled) return false;
    this.onPressHandler?.();
    return true;
  }

  /** 绑定动作（构造之后也能换 —— 例如"选中角色"改变时可点性跟着变）。 */
  setOnPress(handler: (() => void) | undefined): void {
    this.onPressHandler = handler;
  }

  private draw(): void {
    const r = this.rect;
    const disabled = !this.enabled;
    const primary = this.kind === 'primary';

    const fill = disabled
      ? PALETTE.panelLine
      : primary
        ? PALETTE.douqi.base
        : 0xffffff;
    const fillAlpha = disabled ? 0.35 : primary ? 0.85 : this.focused ? 0.16 : 0.08;
    const stroke = disabled
      ? PALETTE.textFaint
      : primary
        ? PALETTE.text
        : this.focused
          ? PALETTE.douqi.bright
          : 0x6a6c80;
    const strokeWidth = disabled ? 1 : this.focused || primary ? 2 : 1;

    this.gfx.clear();
    this.gfx.roundRect(r.x, r.y, r.w, r.h, this.radius).fill({ color: fill, alpha: fillAlpha });
    this.gfx.roundRect(r.x, r.y, r.w, r.h, this.radius).stroke({ color: stroke, width: strokeWidth });

    this.label.setColor(disabled ? PALETTE.textFaint : PALETTE.text);
  }
}

/*
 * ==================================================================
 * ⚠️ **没有**换成本组件的按钮（以及原因）
 * ==================================================================
 *
 * | 位置 | 为什么不是它 |
 * |---|---|
 * | 首页三个入口（`ui/HomeScreen.ts`） | 它们是**入口卡**（`320×56` 通栏、`cardSkin` 的"选中 / 光标 / 开发中"三态 + 外环），语义是"选一条路"而不是"按一下执行"。硬塞进 `TextButton` 就要把 `cardSkin` 也搬进组件，那会让"人物卡 / 炁机卡 / 入口卡"三种皮肤与按钮混在一起 |
 * | 备战 / 确认屏的卡片与块头 | 同上（`cardSkin` + 展开折叠） |
 * | `ui/settings/KeysFooter` 的键位格 | 那是**格子**（每格绑一个键），不是按钮 |
 * | `ui/IconButton` | **图标**按钮（正方形、只有图标），是另一类；它已经有自己的组件 |
 * | `ui/settings/ResetDefaultButton` | 设置页专用（矩形跟着 UI 缩放走），但**画法与本组件同源**（见文件头）；要在它俩之间再合并一次需要先统一"矩形从哪来"，这一步这轮没做 |
 */
