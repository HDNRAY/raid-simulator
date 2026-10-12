/**
 * **玩家资源面板**：三根资源条（生命 / 炁 / 缠）+ 单字标签与数值
 * + 玩家的 buff / debuff 两条图标条。
 *
 * ==================================================================
 * 为什么单独一个文件（关注分离，AGENTS.md §3）
 * ==================================================================
 *
 * 这个区域的"造 / 画 / 缩放"原先**分在两个地方**：
 *   - 节点（Panel / Bar / Label / IconStrip）在 `BattleScene` 的构造函数里造
 *   - 每帧画什么在 `parts/playerPanel.ts` 里
 *   - UI 缩放又是 `BattleScene.setUiScale` 里逐个元素手调（80 行里的头一段）
 *
 * 而"面板多大、三根条怎么排、缩放时字要跟到哪"本来就是**这块面板自己的
 * 知识** —— 所以现在收在一起。`BattleScene` 只持有它并转发。
 *
 * ⚠️ 下面的注释与代码是一起从 `BattleScene.ts` 搬过来的
 * （AGENTS.md §3：抽取时连带注释一起搬）。
 */

import type { Container } from 'pixi.js';
import { FONT, LAYOUT } from '../../ui/layout';
import { Bar, Label, PANEL_STYLE, Panel, type PixiCtor } from '../../ui/primitives';
import { UiLayout } from '../../ui/uiLayout';
import { IconStrip } from '../IconStrip';
import { PlayerPanelPart } from '../parts/playerPanel';
import { PALETTE } from '../theme';
import type { FrameRegistry, TranslateFn } from '../sceneTypes';

/** 玩家面板区域。 */
export class PlayerStatus {
  /** HUD 层上的根容器。`(0,0)` 让内部的逻辑坐标保持不变。 */
  readonly root: Container;

  /* 玩家面板 */
  private readonly playerPanel: Panel;
  private readonly playerName: Label;
  private readonly hpBar: Bar;
  private readonly hpText: Label;
  private readonly hpLabel: Label;
  private readonly energyBar: Bar;
  private readonly energyLabel: Label;
  private readonly energyText: Label;
  private readonly douqiBar: Bar;
  private readonly douqiLabel: Label;
  private readonly douqiText: Label;

  /* 图标条 */
  private readonly playerBuffs: IconStrip;
  /** 玩家的减益条（在增益条上面一行）。 */
  private readonly playerDebuffs: IconStrip;

  constructor(pixi: PixiCtor, translate: TranslateFn) {
    this.root = new pixi.Container();

    /* 玩家面板：生命 / 缠 / 炁 **垂直排列** */
    const pf = LAYOUT.player;
    this.playerPanel = new Panel(pixi, {
      x: pf.x,
      y: pf.y,
      w: pf.w,
      h: pf.h,
      ...PANEL_STYLE,
    });
    /**
     * 面板标题去掉了（原来是「你」）。
     *
     * 场面上只有一个主角，"你"是冗余信息；去掉之后顶部那一行
     * 正好让给自己的读条。
     */
    this.playerName = new Label(pixi, { x: pf.x + 8, y: pf.y + 4, size: FONT.body, color: PALETTE.text });
    this.playerName.root.visible = false;

    // 三根条的几何：等距垂直排列，每根 16 高（够画出内阴影与文字）
    /**
     * 三根资源条的位置**全部来自布局表**（`LAYOUT.playerBars`）。
     *
     * 踩过的坑：这些数字原先写死在这里（条高 16、间距 12、起始 +32），
     * 于是"面板加高到 140 之后底部空出 36px"这种问题**既看不见也算不出来**
     * —— 只能靠截图肉眼发现（用户就是这么发现的）。
     *
     * 现在 `stride = 20`、最后一根条距底部 `bottom = 14`，
     * 所以浪费的纵向空间是固定且**可断言的**（见布局测试）。
     */
    const { h: barH, top: barsTop, stride } = LAYOUT.playerBars;
    const barX = pf.x + 8;
    const barW = pf.w - 16;
    const barY = (row: number): number => pf.y + barsTop + row * stride;

    this.hpBar = new Bar(pixi, {
      x: barX, y: barY(0), w: barW, h: barH,
      color: PALETTE.hp.base, darkColor: PALETTE.hp.dark, brightColor: PALETTE.hp.bright,
    });
    this.energyBar = new Bar(pixi, {
      x: barX, y: barY(1), w: barW, h: barH,
      color: PALETTE.energy.base, darkColor: PALETTE.energy.dark, brightColor: PALETTE.energy.bright,
    });
    this.douqiBar = new Bar(pixi, {
      x: barX, y: barY(2), w: barW, h: barH,
      color: PALETTE.douqi.base, darkColor: PALETTE.douqi.dark, brightColor: PALETTE.douqi.bright,
    });

    // 每条左侧一个单字标签（生/精/炁），右侧数值
         /** 三根条上的文字垂直居中（原先贴着条顶边，偏上）。 */
    const textMidY = (row: number): number => barY(row) + barH / 2;
    const lbl = (row: number, color: number): Label =>
      new Label(pixi, { x: barX + 4, y: textMidY(row), size: FONT.small, color, kai: true, anchorY: 0.5 });
    this.hpLabel = lbl(0, 0xffe0e0);
    this.energyLabel = lbl(1, 0xe0ffe0);
    this.douqiLabel = lbl(2, 0xfff0d0);
    const val = (row: number, stroke: number): Label =>
      new Label(pixi, {
        x: barX + barW - 4,
        y: textMidY(row),
        size: FONT.small,
        color: 0xffffff,
        anchorX: 1,
        anchorY: 0.5,
        stroke,
        strokeWidth: 3,
      });
    this.hpText = val(0, 0x2a0808);
    this.energyText = val(1, 0x0a1408);
    this.douqiText = val(2, 0x2a1a04);

    this.root.addChild(
      this.playerPanel.root,
      this.playerName.root,
      this.hpBar.root,
      this.energyBar.root,
      this.douqiBar.root,
      this.hpLabel.root,
      this.energyLabel.root,
      this.douqiLabel.root,
      this.hpText.root,
      this.energyText.root,
      this.douqiText.root,
    );

    this.playerBuffs = new IconStrip(pixi, LAYOUT.playerBuffs, translate);
    this.root.addChild(this.playerBuffs.root);
    this.playerDebuffs = new IconStrip(pixi, LAYOUT.playerDebuffs, translate);
    this.root.addChild(this.playerDebuffs.root);
  }

  /** 挂上本区域的每帧部件（三条资源条 + 单字标签 + 数值 + 两条图标条）。 */
  register(registry: FrameRegistry): void {
    registry.add(new PlayerPanelPart({
      playerName: this.playerName,
      hpBar: this.hpBar,
      energyBar: this.energyBar,
      douqiBar: this.douqiBar,
      hpLabel: this.hpLabel,
      energyLabel: this.energyLabel,
      douqiLabel: this.douqiLabel,
      hpText: this.hpText,
      energyText: this.energyText,
      douqiText: this.douqiText,
      playerBuffs: this.playerBuffs,
      playerDebuffs: this.playerDebuffs,
    }));
  }

  /**
   * **UI 缩放**：面板与三根资源条一起重排。
   *
   * ⚠️ 面板锚在**左下角**（`UI_ANCHORS.playerPanel = 'bottom-left'`）——
   * 直接乘系数会让它朝画布中心挤过去。
   *
   * ⚠️ 两条图标条（`playerBuffs` / `playerDebuffs`）**原来就不跟着缩放**，
   * 本次重构原样保留（纯搬运不改行为）。
   */
  setUiScale(scale: number): void {
    const ui = new UiLayout(scale);
    const pf = ui.playerPanel;
    this.playerPanel.set({ x: pf.x, y: pf.y, w: pf.w, h: pf.h });

    /**
     * 资源条与文字**一起重排**。
     *
     * ⚠️ 字必须跟着走：只放大框不挪字，会出现"面板很大、字挤在角上"。
     * 条的几何走 `Bar.setRect`（它会重置缓存强制重绘），
     * 文字走 `anchorY: 0.5` + 条中线 —— 所以这里只改坐标，不改偏移。
     */
    const { h: barH, top: barsTop, stride } = ui.playerBars;
    const barX = pf.x + ui.len(8);
    const barW = pf.w - ui.len(16);
    const bars: Array<{ bar: Bar; label: Label; text: Label }> = [
      { bar: this.hpBar, label: this.hpLabel, text: this.hpText },
      { bar: this.energyBar, label: this.energyLabel, text: this.energyText },
      { bar: this.douqiBar, label: this.douqiLabel, text: this.douqiText },
    ];
    /**
     * 字号也要跟着缩放 —— 只放大框不放大字，会变成"面板很大、字很小"。
     * `Label.setSize` 会触发纹理重光栅化，所以只在缩放变化时调
     * （`setUiScale` 本身就有"值没变就 return"的短路）。
     */
    const textSize = ui.len(FONT.small);
    for (const [row, entry] of bars.entries()) {
      const y = pf.y + barsTop + row * stride;
      entry.bar.setRect({ x: barX, y, w: barW, h: barH });
      const midY = y + barH / 2;
      entry.label.setSize(textSize);
      entry.label.root.x = barX + ui.len(4);
      entry.label.root.y = midY;
      entry.text.setSize(textSize);
      entry.text.root.x = barX + barW - ui.len(4);
      entry.text.root.y = midY;
    }
  }
}
