/**
 * 设置面板的**缩放同步器**：把 `uiScale` 落到几何上。
 *
 * ⚠️ 判据是"**系数真的变了**才重排"——不是"每次调用都重排"
 * （指针拖滑块时每一帧都会进来）。
 *
 * ==================================================================
 * 为什么单独一个文件
 * ==================================================================
 *
 * `SettingsPanel.ts` 加了缩放同步之后到了 **765 行**（AGENTS.md §3 的上限
 * 700）。按 §3 的顺序**不许压注释**，要拆 util 或横向切割 —— 这一块正好是
 * 一个完整的关注点：
 *
 *   "**面板的几何现在是多少、该不该重排、重排谁**"
 *
 * 它与"面板怎么收输入 / 焦点在谁身上 / 改键会话"没有交集。切出去之后
 * 面板的 `redraw()` 只剩一句 `syncPanelScale(...)`，而"哪些部件需要重排"
 * 集中在本文件 —— 以后加一个部件只需要改一处。
 *
 * ==================================================================
 * ⚠️ 为什么需要它（而不是每个部件自己读缩放）
 * ==================================================================
 *
 * 部件（`KeyGrid` / `SkillDetail` / …）的几何与字号是在**构造期**算的
 * （那是为了不在每帧重建 Pixi 对象 —— `primitives.ts` 的第一条契约）。
 * 所以缩放变了必须**显式叫它们重排**，而不是指望它们每帧自己发现。
 *
 * ⚠️ 重排**不是免费的**：`Label.setSize` 会让 Pixi 重新光栅化文字纹理，
 * `SkillDetail.relayout()` 还要把技能说明**重新折行**（折行是逐行二分测量）。
 * 所以这里必须挡住"值没变也重排"——指针拖滑块时每一帧都会进来。
 */

import { currentSettingsMetrics, setSettingsScale } from './settingsScale';
import type { PanelParts } from './panelBuild';

/** 需要跟着缩放重排的部件（每个部件自己知道要改什么）。 */
export interface RescalablePart {
  relayout(): void;
}

export interface ScaleSyncTarget {
  /**
   * `./panelBuild` 造出来的那一份部件（**原样传进来**）。
   *
   * ⚠️ 用 `PanelParts` 而不是另立一个"可重排"的子类型：那一份字段名
   * （`grid` / `slider`）与这里逐个对应，另立一份会让面板多一层搬运
   * （"谁叫 frame、谁叫 grid"变成第三个真相）。
   */
  readonly parts: PanelParts;
  /** 玩家设的 UI 缩放（滑块上那个值）。 */
  readonly uiScale: () => number;
}

/**
 * 缩放同步器。
 *
 * ⚠️ 它**持有"上一次排过版的系数"**（`applied`）—— 这就是"要不要重排"的
 * 唯一判据。放在面板里会让"面板还知道一个缓存值"，与它"只管内容与交互"
 * 的定位混在一起。
 */
export class PanelScaleSync {
  private applied = Number.NaN;

  constructor(private readonly target: ScaleSyncTarget) {}

  /**
   * 让面板几何与当前 UI 缩放一致。
   *
   * ⚠️ 必须跑在 `drawFrame` / `drawBody` **之前**：那两处（以及命中测试、
   * 探针）读的都是 `settingsScale.currentSettingsMetrics()` —— 顺序反了就会
   * 用"上一档"的几何画这一帧。
   *
   * @returns 这一帧有没有真的重排过（测试 / 探针可读）
   */
  sync(): boolean {
    const before = currentSettingsMetrics().k;
    setSettingsScale(this.target.uiScale());
    const k = currentSettingsMetrics().k;
    if (k === this.applied) return false;
    this.applied = k;
    /**
     * ⚠️ `setSettingsScale` 在系数没变时直接返回（连对象都不重建），
     * 所以这里用"变化前 / 后"比较，而不是只看传进去的那个倍数。
     */
    if (k === before) return false;
    const { frame, grid, picker, preview, detail, footer, slider, modeSwitch } = this.target.parts;
    frame.relayout();
    grid.relayout();
    picker.relayout();
    preview.relayout();
    detail.relayout();
    footer.relayout();
    slider.relayout();
    modeSwitch.relayout();
    return true;
  }
}
