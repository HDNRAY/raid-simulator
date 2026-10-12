/**
 * 设置面板的**部件怎么造**（构造期一次性的接线）。
 *
 * ==================================================================
 * 为什么从 `SettingsPanel.ts` 切出来
 * ==================================================================
 *
 * 面板在加了"按操作方式分两块 + 操作方式选择器"之后到了 **706 行**
 * （AGENTS.md §3 的上限 700）。按 §3 的顺序**不许压注释**：要么拆 util、
 * 要么横向切割 —— 这一刀切的是最机械的一块：
 *
 *   "面板由哪些部件组成、它们怎么挂到 `body` 上"
 *
 * 它与"面板怎么收输入 / 焦点在谁身上 / 改键会话"没有交集。切完之后
 * `SettingsPanel` 的构造函数只剩一句 `buildPanelParts(...)` 加几个赋值，
 * 而"这一页有哪些部件"集中在本文件 —— 加一个新部件时只需要改一处。
 *
 * ⚠️ 本文件**不持有状态**，也不认识 `SettingsPanel`：它只按参数把部件造好
 * 并挂进一棵容器树。状态与判断仍留在面板（以及更纯的 `panelDispatch` /
 * `./panelFocus`）。
 */

import type { Container, Graphics } from 'pixi.js';
import { LOGICAL } from '../layout';
import { KeyGrid } from './KeyGrid';
import { KeysFooter } from './KeysFooter';
import { ModeSwitch } from './ModeSwitch';
import { ScaleSlider } from './ScaleSlider';
import { SettingsFrame } from './SettingsFrame';
import { SkillDetail } from './SkillDetail';
import { TouchSkillPicker } from './TouchSkillPicker';
import { TouchSlotPreview } from './TouchSlotPreview';
import type { PixiCtor } from '../primitives';
import type { TranslateFn } from '../../i18n/translator';

/** 造好的部件（面板持有它们，并负责喂状态）。 */
export interface PanelParts {
  /** 背景遮罩（点面板外关闭也靠它铺满整屏）。 */
  readonly dim: Graphics;
  /** 外框：底板 + 标题 + 「关闭」 + tab 按钮。 */
  readonly frame: SettingsFrame;
  /** 内容区的容器（部件都挂在它下面）。 */
  readonly body: Container;
  /** 键盘那套的技能格。 */
  readonly grid: KeyGrid;
  /** 触屏那套的技能面（两步交互的第二步）。 */
  readonly picker: TouchSkillPicker;
  /** 「通用」页的操作方式选择器。 */
  readonly modeSwitch: ModeSwitch;
  /** 触屏键位预览（右下角的双弧）+ 它自己那一份恢复按钮。 */
  readonly preview: TouchSlotPreview;
  /** 键盘那套的技能详情（换行 + 可滚）。 */
  readonly detail: SkillDetail;
  /** 底部提示两行 + 键盘那一份恢复按钮。 */
  readonly footer: KeysFooter;
  /** 「通用」页的 UI 缩放滑块。 */
  readonly slider: ScaleSlider;
}

export interface PanelPartsOptions {
  readonly pixi: PixiCtor;
  readonly translate: TranslateFn;
  /** 底部提示要读的**通知文案**（"已恢复默认键位"那类）——由面板的倒计时持有。 */
  readonly noticeText: () => string;
  readonly getUiScale: () => number;
  readonly onUiScale: (value: number) => void;
}

/** 造出面板的全部部件，并挂进 `root` 下（`root` 由调用方先建好遮罩）。 */
export function buildPanelParts(options: PanelPartsOptions, root: Container): PanelParts {
  const { pixi } = options;
  const dim = new pixi.Graphics();
  dim.rect(0, 0, LOGICAL.width, LOGICAL.height).fill({ color: 0x000000, alpha: 0.66 });
  root.addChild(dim);

  const frame = new SettingsFrame(pixi, (key, params) => options.translate(key, params));
  root.addChild(frame.root);

  /* ---- 内容区 ---- */
  const body = new pixi.Container();
  root.addChild(body);

  const grid = new KeyGrid(pixi, (key, params) => options.translate(key, params));
  body.addChild(grid.root);

  const picker = new TouchSkillPicker(pixi, options.translate);
  body.addChild(picker.root);

  const footer = new KeysFooter(
    pixi,
    (key, params) => options.translate(key, params),
    () => options.noticeText(),
  );
  body.addChild(footer.root);

  const preview = new TouchSlotPreview(pixi, options.translate);
  body.addChild(preview.root);

  const detail = new SkillDetail(pixi, (key, params) => options.translate(key, params));
  body.addChild(detail.root);

  const modeSwitch = new ModeSwitch(pixi, options.translate);
  body.addChild(modeSwitch.root);

  const slider = new ScaleSlider({
    pixi,
    translate: options.translate,
    get: options.getUiScale,
    set: options.onUiScale,
  });
  body.addChild(slider.root);

  return { dim, frame, body, grid, picker, modeSwitch, preview, detail, footer, slider };
}
