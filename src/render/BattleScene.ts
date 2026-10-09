/**
 * 战斗场景（M5）。
 *
 * ------------------------------------------------------------------
 * 设计要点
 * ------------------------------------------------------------------
 *
 * 1. **不画地面预警扇形**。本作没有位移 —— 玩家不能走出去，
 *    所以"范围"这个概念不存在。判断压力全部来自**读条结束的时机**
 *    （该躲 / 该挡 / 该打断），表达它的地方是顶部那条预警条，不是地面。
 *
 * 2. **HUD 让路**：画面中央只放角色，不放任何面板。
 *
 * 3. **元素小、信息密度高**：技能格 48、buff 图标 26、字号 11–20。
 *
 * 数据流单向：`update(view)` 只读传入的快照。
 */

import type { Container, Graphics } from 'pixi.js';
import { PALETTE } from './theme';
import { CastBar } from '../ui/CastBar';
import { LogPanel } from '../ui/LogPanel';
import { drawBackground } from './background';
import { SkillBarView } from './skillBar';
import { IconStrip } from './IconStrip';
import type { BattleSceneOptions } from './sceneTypes';
import { FONT, LAYOUT, LOGICAL } from '../ui/layout';
import { UiLayout } from '../ui/uiLayout';
import { DISPLAY_SCALE } from '../data/balance';

/**
 * 类型从这里**重新导出**，所以 `import { BattleSceneOptions } from
 * './render/BattleScene'` 依然可用 —— 拆文件不该是个破坏性改动。
 * 定义本身在 `sceneTypes.ts`（见那里的说明）。
 */
export type { BattleSceneOptions, TranslateFn } from './sceneTypes';


/**
 * 闪避位移的峰值（逻辑像素，向右）。
 *
 * 演进 26 → **52**（需求："幅度按现在的翻倍"）。
 *
 * 玩家本体宽约 108（cx±54），中心在 x=300，所以右移 52 之后
 * 最右缘到 406 —— 与 Boss（约 x 630，本体宽 100+）之间仍有 200px，
 * 不会撞上。左缘到 194，距左边界也够。
 */
const DODGE_PEAK_X = 52;

import { Bar, Label, PANEL_STYLE, Panel, type PixiCtor } from '../ui/primitives';
import { BossSprite } from './actors/BossSprite';
import { ratioOf, type BattleSnapshotView } from './viewModel';
import type { LogEntry } from '../app/logFormat';

/* ================================================================== *
 * 背景
 * ================================================================== */


/* ================================================================== *
 * 图标条（buff / debuff 通用）
 * ================================================================== */


/* ================================================================== *
 * 技能栏
 * ================================================================== */


/* ================================================================== *
 * 飘字
 * ================================================================== */

class FloatingTextLayer {
  readonly root: Container;
  private readonly pool: Array<{ label: Label }> = [];

  constructor(private readonly pixi: PixiCtor) {
    this.root = new pixi.Container();
  }

  update(items: BattleSnapshotView['floatingText']): void {
    while (this.pool.length < items.length && this.pool.length < 24) {
      const label = new Label(this.pixi, {
        x: 0,
        y: 0,
        size: FONT.title,
        color: 0xffffff,
        anchorX: 0.5,
        stroke: 0x000000,
        strokeWidth: 3,
      });
      this.root.addChild(label.root);
      this.pool.push({ label });
    }
    for (let i = 0; i < this.pool.length; i += 1) {
      const slot = this.pool[i];
      const view = items[i];
      if (!slot) continue;
      if (!view) {
        slot.label.root.visible = false;
        continue;
      }
      slot.label.root.visible = true;
      slot.label.set(view.text);
      slot.label.setColor(view.color);
      slot.label.root.x = view.x;
      slot.label.root.y = view.y;
      slot.label.root.alpha = Math.min(1, view.life * 1.5);
    }
  }
}

/* ================================================================== *
 * 主场景
 * ================================================================== */

export class BattleScene {
  readonly root: Container;

  private readonly boss: BossSprite;
  private readonly playerAnim: Graphics;
  /** 玩家图形的外层容器（只用于闪避位移） */
  private readonly playerRoot: Container;
  private readonly flashOverlay: Graphics;

  /* 顶栏 */
  private readonly bossName: Label;
  private readonly bossPhase: Label;
  private readonly bossHpBar: Bar;
  private readonly bossHpText: Label;
  private readonly timerLabel: Label;
  private readonly enrageBadge: Label;

  /* 预警条 */
  /** 战斗日志（屏幕右侧） */
  private readonly logPanel: LogPanel;
  /** Boss 预警条（与玩家读条共用 `ui/CastBar.ts`） */
  private readonly castBar: CastBar;
  /** 玩家读条（同一个组件，换配色） */
  private readonly playerCastBar: CastBar;

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
  private readonly bossBuffs: IconStrip;
  private readonly playerBuffs: IconStrip;
  /** UI 缩放系数（默认 1）——只影响 UI 部件，不影响画布与战斗画面 */
  private uiScale = 1;

  private readonly skillBar: SkillBarView;
  private readonly floating: FloatingTextLayer;
  private readonly statusLabel: Label;
  private readonly statusSub: Label;

  /* 结算面板 */
  private readonly resultLayer: Container;
  private readonly resultDim: Graphics;
  private readonly resultPanel: Panel;
  private readonly resultTitle: Label;
  private readonly resultReason: Label;
  private readonly resultStats: Label;
  private readonly resultHint: Label;

  private lastPlayerPose = 1;

  private readonly options: BattleSceneOptions;

  constructor(options: BattleSceneOptions) {
    this.options = options;
    const { pixi, app, translate } = options;

    this.root = new pixi.Container();
    app.stage.addChild(this.root);

    /* ---------- 背景 ---------- */
    const background = new pixi.Graphics();
    drawBackground(background);
    this.root.addChild(background);

    /* ---------- 角色（Boss 右、玩家左，中间留空给飘字） ---------- */
    this.boss = new BossSprite(pixi, { x: 630, y: 378 });
    this.root.addChild(this.boss.root);

    /**
     * 玩家图形外面套一层容器，**只为了能整体位移**。
     *
     * 闪避动画要"往右闪一下再复位"，而 `drawPlayer` 是在固定
     * `cx = 300` 处绘制路径的。比起每帧按偏移重绘整套多边形
     * （60fps 下白算几十次 fill），移动容器的 `x` 几乎零成本。
     */
    this.playerRoot = new pixi.Container();
    this.playerAnim = new pixi.Graphics();
    this.drawPlayer(1);
    this.playerRoot.addChild(this.playerAnim);
    this.root.addChild(this.playerRoot);

    /* ---------- 全屏闪光 ---------- */
    this.flashOverlay = new pixi.Graphics();
    this.flashOverlay.rect(0, 0, LOGICAL.width, LOGICAL.height).fill(0xffffff);
    this.flashOverlay.alpha = 0;
    this.root.addChild(this.flashOverlay);

    /* ---------- HUD ---------- */
    const hud = new pixi.Container();
    this.root.addChild(hud);

    const bb = LAYOUT.bossBar;
    this.bossName = new Label(pixi, { x: bb.x + 2, y: bb.y, size: FONT.title, color: PALETTE.text });
    this.bossPhase = new Label(pixi, { x: bb.x + 2, y: bb.y + 1, size: FONT.small, color: PALETTE.textDim });
    this.timerLabel = new Label(pixi, {
      x: LOGICAL.width - 8,
      y: bb.y,
      size: FONT.title,
      color: 0xf0c060,
      anchorX: 1,
    });
    this.enrageBadge = new Label(pixi, {
      x: LOGICAL.width - LAYOUT.timer.w - 10,
      y: bb.y + 3,
      size: FONT.small,
      color: PALETTE.danger.bright,
      anchorX: 1,
    });
    hud.addChild(this.bossName.root, this.bossPhase.root, this.timerLabel.root, this.enrageBadge.root);

    const bh = LAYOUT.bossHp;
    this.bossHpBar = new Bar(pixi, {
      x: bh.x,
      y: bh.y,
      w: bh.w,
      h: bh.h,
      color: PALETTE.hp.base,
      darkColor: PALETTE.hp.dark,
      brightColor: PALETTE.hp.bright,
    });
    // 血量文字放在**名字那一行**（血条上方），不再压在血条上 ——
    // 压在血条上会和 buff 图标、进度条抢位置
    this.bossHpText = new Label(pixi, {
      x: LOGICAL.width - LAYOUT.timer.w - 10,
      y: bb.y + 3,
      size: FONT.small,
      color: 0xd8d0d8,
      anchorX: 1,
    });
    hud.addChild(this.bossHpBar.root, this.bossHpText.root);

    this.bossBuffs = new IconStrip(pixi, LAYOUT.bossBuffs, translate);
    hud.addChild(this.bossBuffs.root);

    /* 战斗日志（右侧）—— 画在 HUD 下层，避免压住技能栏与资源面板 */
    this.logPanel = new LogPanel({
      pixi,
      translate: (key, params) => {
        try {
          return translate(key, params);
        } catch {
          return key;
        }
      },
    });
    hud.addChild(this.logPanel.root);

    /* Boss 预警条 */
    /**
     * 读条用**共用组件**（`ui/CastBar.ts`）。
     *
     * Boss 与玩家原先各写一份，于是"修了一处忘了另一处"。
     * 现在两者都是这一个组件，层叠顺序（底 → 填充 → 描边 → 文字）
     * 只在一处定义。
     */
    this.castBar = new CastBar({
      pixi,
      rect: LAYOUT.castBar,
      fill: 0xe8542c,
      track: 0x2a0c0e,
      line: PALETTE.danger.base,
      labelColor: 0xffe8c0,
      timeColor: 0xffd0b0,
      // Boss 预警条**不显示剩余秒数**？不 —— 它是最需要读的信息，保留
      showTime: true,
    });
    hud.addChild(this.castBar.root);

    /* 玩家读条 */
    /**
     * 同一个 `CastBar` 组件，只是换配色（暖金 = "自己的动作"，
     * 红色留给 Boss 的威胁提示）。
     *
     * ⚠️ 它必须放在玩家面板**上方**、不能重叠 —— 面板是后绘制的，
     * 重叠会把读条盖住（见 `LAYOUT.playerCastBar` 的说明）。
     */
    this.playerCastBar = new CastBar({
      pixi,
      rect: LAYOUT.playerCastBar,
      fill: 0xb8860f,
      track: 0x2a1c06,
      line: 0xd8a840,
      labelColor: 0xffffff,
      timeColor: 0xffffff,
      showTime: true,
    });
    hud.addChild(this.playerCastBar.root);

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
    /**
     * 三根条上的文字**垂直居中**。
     *
     * 踩过的坑：早期写的是 `barY(n) + 1` —— 那等于"贴着条的顶边往下 1px"，
     * 看起来字明显偏上。而中文单字的可见字框比 Pixi 报的 `height`
     * 还高一点，靠 `+1`、`+2` 这种偏移猜是猜不准的。
     *
     * 现在用 `anchorY: 0.5` + 条的中线：无论字号怎么调，
     * 文字都会落在条的中间，不必再改偏移值。
     */
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

    hud.addChild(
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
    hud.addChild(this.playerBuffs.root);

    this.skillBar = new SkillBarView(pixi, translate);
    hud.addChild(this.skillBar.root);

    this.floating = new FloatingTextLayer(pixi);
    hud.addChild(this.floating.root);

    this.statusLabel = new Label(pixi, {
      x: LAYOUT.status.x,
      y: LAYOUT.status.y,
      size: FONT.warn,
      color: 0xffffff,
      anchorX: 0.5,
      stroke: 0x000000,
      strokeWidth: 4,
    });
    this.statusSub = new Label(pixi, {
      x: LAYOUT.status.x,
      y: LAYOUT.status.y + FONT.warn + 4,
      size: FONT.body,
      color: PALETTE.interrupt.bright,
      anchorX: 0.5,
      stroke: 0x000000,
      strokeWidth: 3,
    });
    hud.addChild(this.statusLabel.root, this.statusSub.root);

    /* ---------- 结算面板 ----------
     * 单独一层，压在 HUD 之上。战斗进行中完全隐藏，
     * 所以它不占用任何视觉注意力。 */
    this.resultLayer = new pixi.Container();
    this.resultLayer.visible = false;

    this.resultDim = new pixi.Graphics();
    this.resultDim.rect(0, 0, LOGICAL.width, LOGICAL.height).fill({ color: 0x000000, alpha: 0.62 });
    this.resultLayer.addChild(this.resultDim);

    const rw = LAYOUT.result.w;
    const rh = LAYOUT.result.h;
    const rx = Math.round((LOGICAL.width - rw) / 2);
    const ry = Math.round((LOGICAL.height - rh) / 2) - 20;
    /**
     * 结算面板**故意比其它面板不透明**（0.97）：它是"结算"，
     * 需要挡住背后的战斗画面让人专心看结果 —— 所以显式覆盖透明度，
     * 而不是跟着 `PANEL_STYLE` 走。
     */
    this.resultPanel = new Panel(pixi, {
      x: rx,
      y: ry,
      w: rw,
      h: rh,
      fill: 0x0e0e16,
      line: 0x6a6c80,
      fillAlpha: 0.97,
      radius: 4,
    });
    this.resultTitle = new Label(pixi, {
      x: LOGICAL.width / 2,
      y: ry + 18,
      size: FONT.big,
      color: 0xffffff,
      anchorX: 0.5,
    });
    this.resultReason = new Label(pixi, {
      x: LOGICAL.width / 2,
      y: ry + 54,
      size: FONT.body,
      color: 0xa0a0b4,
      anchorX: 0.5,
    });
    this.resultStats = new Label(pixi, {
      x: rx + 24,
      y: ry + 84,
      size: FONT.small,
      color: 0xd0d0dc,
    });
    this.resultHint = new Label(pixi, {
      x: LOGICAL.width / 2,
      y: ry + rh - 26,
      size: FONT.small,
      color: 0x80d0a0,
      anchorX: 0.5,
    });
    this.resultLayer.addChild(
      this.resultPanel.root,
      this.resultTitle.root,
      this.resultReason.root,
      this.resultStats.root,
      this.resultHint.root,
    );
    // 加到 HUD 之后（同一父级），所以天然压在 HUD 之上
    this.root.addChild(this.resultLayer);
  }

  /** 玩家背影。`pose`：1 = 站姿，0.85 = 下沉（闪避/格挡）。 */
  private drawPlayer(pose: number): void {
    const g = this.playerAnim;
    const P = PALETTE;
    const cx = 300;
    const base = 456 + (1 - pose) * 12;
    const h = 84 * pose;
    g.clear();

    g.poly([cx - 54, base, cx - 30, base - h, cx + 30, base - h, cx + 54, base, cx + 34, base, cx - 34, base]);
    g.fill(P.playerCloak);
    g.poly([cx - 54, base, cx - 30, base - h, cx - 7, base - h, cx - 12, base]);
    g.fill(P.playerCloakDark);
    g.poly([cx - 52, base, cx - 29, base - h - 3, cx - 14, base - h + 5, cx - 36, base]);
    g.fill(P.playerCloakLight);
    g.poly([cx + 52, base, cx + 29, base - h - 3, cx + 14, base - h + 5, cx + 36, base]);
    g.fill(P.playerCloakLight);
    g.ellipse(cx, base - h - 14, 16, 17).fill(0x1a2036);
    g.ellipse(cx, base - h - 13, 13, 14).fill(0x2a3450);
    g.poly([cx + 40, base - 5, cx + 71, base - 92, cx + 80, base - 88, cx + 49, base + 3]);
    g.fill(0x8a90a0);
    g.poly([cx + 44, base - 8, cx + 68, base - 87, cx + 74, base - 84, cx + 48, base + 1]);
    g.fill(0xb8bcc8);
    g.rect(cx + 34, base - 11, 18, 12).fill(0xa8863c);
  }

  /**
   * **UI 缩放**（需求："缩放游戏 UI……战斗画面和战斗文字保持不变"）。
   *
   * 只作用于 UI 部件，**不碰画布尺寸** —— 画布仍是 960×540 的逻辑
   * 分辨率，所以角色、场景、飘字都不受影响。这与"整体缩放画布"是
   * 两回事，后者会把战斗画面一起放大。
   *
   * 目前作用范围：技能栏 + 玩家面板（含三根资源条与它们的文字）。
   * 其它部件（顶栏、日志面板）暂不缩放 —— 它们贴屏幕边缘，
   * 缩放收益小，而改动的风险不小。
   */
  setUiScale(scale: number): void {
    if (scale === this.uiScale) return;
    this.uiScale = scale;
    this.skillBar.setUiScale(scale);

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

    /* ---------- Boss 相关（需求："boss 相关面板 buff，读条"） ---------- */
    const bb = ui.bossBar;
    this.bossName.setSize(ui.len(FONT.body));
    this.bossName.root.x = bb.x + ui.len(2);
    this.bossName.root.y = bb.y;
    this.bossPhase.setSize(ui.len(FONT.small));
    this.timerLabel.setSize(ui.len(FONT.small));
    this.timerLabel.root.y = bb.y + ui.len(3);

    /**
     * ⚠️ Boss 血条的**位置**在顶栏矩形里算，但条的宽度还要扣掉右侧
     * 计时器的占位 —— 这里沿用它原来的比例：血量条占顶栏宽度减去
     * 一个固定右缩进。缩放后同样成立（两者都乘了系数）。
     */
    const bh = ui.bossHp;
    this.bossHpBar.setRect({ x: bh.x, y: bh.y, w: bh.w, h: bh.h });
    this.bossHpText.setSize(ui.len(FONT.small));

    // Boss 的 buff 条（图标方块 + 标签）也按系数走
    this.bossBuffs.setUiScale(scale, ui.bossBuffs);

    // 两处读条（Boss 预警 + 玩家读条）
    this.castBar.setRect(ui.castBar, scale);
    this.playerCastBar.setRect(ui.playerCastBar, scale);

    // 日志面板
    this.logPanel.setUiScale(scale, ui.logPanel);
  }

  /**
   * 每帧重画。
   *
   * `logEntries` 与 `view` **分开传** —— 日志和战斗快照是两个独立的
   * 数据流（各自消费同一批引擎事件），所以不该硬塞进 `view` 里。
   * 这样"要不要显示日志"就只是调用方传不传数组的问题。
   */
  update(view: BattleSnapshotView, logEntries: readonly LogEntry[] = []): void {
    const { translate } = this.options;

    /* ---------- 战斗日志（右侧） ---------- */
    this.logPanel.update(logEntries);

    /* ---------- 角色 ---------- */
    this.boss.update(view.telegraphing, view.bossFlash, view.armored);

    const dodging = view.player.buffs.some((b) => b.id.startsWith('dodge') && b.remainingMs > 0);
    const guarding = view.player.buffs.some((b) => b.id.startsWith('guard') && b.remainingMs > 0);
    /**
     * 姿态下沉**只给防御**（需求："闪避的动画不要变矮了"）。
     *
     * 原先闪避和防御共用 `pose = 0.85`。但区分两者的手段已经够了：
     * 闪避是**横向位移**、防御是**下沉 + 冷色**。再让闪避也变矮，
     * 两者就只剩颜色差异，在余光里反而不好分。
     */
    const pose = guarding ? 0.85 : 1;
    if (pose !== this.lastPlayerPose) {
      this.lastPlayerPose = pose;
      this.drawPlayer(pose);
    }
    this.playerAnim.tint = dodging ? 0x9ad8ff : guarding ? 0xc8d0e8 : 0xffffff;

    /**
     * 闪避位移：**往右闪一下，然后复位**（需求）。
     *
     * 形状是一条"上去再下来"的三角波：
     *   - 位移在闪避窗口的**中点**达到峰值（`DODGE_PEAK_X`）
     *   - 窗口结束正好回到 0，所以不需要额外的缓动状态机
     *
     * 为什么用 `remainingMs / durationMs` 而不是自己记时间：
     * 无敌窗口本来就是"这段动画的时间轴"，跟着它走就不会出现
     * "动画还在播但无敌已经结束"的错位。
     *
     * ⚠️ 位移与防御**明显区分**（需求）：防御只有下沉（pose）+ 冷色，
     * 不位移；闪避才横移 —— 两者在余光里也不会混。
     */
    const dodge = view.player.buffs.find((b) => b.id.startsWith('dodge') && b.remainingMs > 0);
    if (dodge) {
      const total = Math.max(1, dodge.durationMs);
      const progress = 1 - Math.min(1, dodge.remainingMs / total);
      // 三角波：0 → 1 → 0
      const wave = 1 - Math.abs(progress * 2 - 1);
      this.playerRoot.x = Math.round(DODGE_PEAK_X * wave);
    } else {
      this.playerRoot.x = 0;
    }

    /* ---------- 顶栏 ---------- */
    const bb = LAYOUT.bossBar;
    this.bossName.set(translate(view.boss.nameKey));
    // 阶段紧跟名字，用实际宽度定位（不硬编码偏移，换语言也不会重叠）
    this.bossPhase.root.x = bb.x + 2 + this.bossName.root.width + 10;
    /**
     * 不再显示"阶段 N"。
     *
     * 阶段是**内容概念**（一层 buff），引擎不知道它是什么，
     * 所以这里也没有数字可显示 —— 阶段由 Boss buff 条上那个图标表达，
     * 玩家看到「狂怒」就知道进二阶段了。
     * 名字后面保留的那格用来显示**非阶段类**的状态（目前是空的）。
     */
    this.bossPhase.set('');
    this.bossPhase.setColor(view.enraged ? PALETTE.danger.bright : PALETTE.textDim);
    this.timerLabel.set(view.remainingMs === undefined ? '' : formatClockSafe(view.remainingMs));
    this.timerLabel.setColor(
      view.remainingMs !== undefined && view.remainingMs < 30_000 ? PALETTE.danger.bright : 0xf0c060,
    );

    this.bossHpBar.update(ratioOf(view.boss.hp));
    // 血量与狂暴标记共用一行：狂暴时用它替换血量数字（更紧急的信息优先）
    if (view.enraged) {
      this.enrageBadge.set(translate('event.enrage'));
      this.bossHpText.set('');
    } else {
      this.enrageBadge.set('');
      this.bossHpText.set(
        `${display(view.boss.hp.current)} / ${display(view.boss.hp.cap)}   ${percentOf(view.boss.hp)}%`,
      );
    }
    this.bossBuffs.update(view.boss.buffs);

    /* ---------- 预警条 ---------- */
    const cast = view.boss.cast;
    this.castBar.visible = cast !== undefined;
    if (cast) {
      /**
       * 招式的提示标签（需求："boss 的招式的 tags 显示在它的读条中"）。
       *
       * 「霸体」= 打不断，别浪费「破」；「高伤」= 闪避比防御更值。
       */
      const tagLabel = (cast.hintTags ?? [])
        .map((tag) => translate(`settings.hintTags.${tag}`))
        .join(' · ');
      this.castBar.setContent(
        translate(cast.nameKey),
        `${(cast.remainingMs / 1000).toFixed(1)}s`,
        tagLabel,
      );
      /**
       * 文字颜色表达**能不能打断**：可打断 → 青绿；霸体 → 青蓝。
       * 需求去掉了"闪避或格挡"那行字（永远适用 = 噪声），
       * 只留剩余秒数。
       */
      this.castBar.setNameColor(cast.interruptible ? PALETTE.interrupt.bright : 0x30c8d0);
      this.castBar.update(cast.progress);
      /**
       * ⚠️ 边框**不再随进度变色**。
       *
       * 曾经在进度过 70% 时把边框从危险红转成亮金（"快命中了"的压力感）。
       * 去掉了，两个原因：
       *   1. 信息重复 —— 剩余秒数已经直接写在条上
       *   2. 阈值的语义不一致 —— 硬编码 70% 对 1.8 秒的重斩和 2.2 秒的
       *      横扫意味着不同的剩余时间（0.54s vs 0.66s），
       *      玩家没法把它当成一个稳定的规则来学
       *
       * 现在边框恒为红色（构造时定下），只用来界定"这是一条威胁读条"。
       */
    }

    /* ---------- 玩家读条 ---------- */
    /**
     * 玩家自己的读条。
     *
     * 与 Boss 预警条共用一个组件形状（Panel + Label + Bar），
     * 但用**暖金色**而不是危险红 —— 颜色在这里承担语义：
     * 红色 = "要挨打了"，金色 = "我在出手"。
     *
     * 不显示"可打断 / 需闪避"那类提示：那是 Boss 预警条的信息，
     * 对自己没有意义。
     */
    const playerCast = view.player.cast;
    this.playerCastBar.visible = playerCast !== undefined;
    if (playerCast) {
      this.playerCastBar.setContent(
        translate(playerCast.nameKey),
        `${(playerCast.remainingMs / 1000).toFixed(1)}s`,
      );
      this.playerCastBar.update(playerCast.progress);
      // 同上：边框恒为金色，不随进度变色
    }

    /* ---------- 玩家面板 ---------- */
    this.playerName.set(translate(view.player.nameKey));
    this.hpBar.update(ratioOf(view.player.hp));
    this.energyBar.update(ratioOf(view.player.energy));
    this.douqiBar.update(ratioOf(view.player.douqi));
    // 单字标签：生 / 精 / 炁（楷体）。用展示刻度显示数值（100 制）
    this.hpLabel.set(translate('resource.hpShort'));
    this.energyLabel.set(translate('resource.energyShort'));
    this.douqiLabel.set(translate('resource.douqiShort'));
    this.hpText.set(`${display(view.player.hp.current)}/${display(view.player.hp.cap)}`);
    this.energyText.set(`${display(view.player.energy.current)}/${display(view.player.energy.cap)}`);
    this.douqiText.set(`${display(view.player.douqi.current)}/${display(view.player.douqi.cap)}`);
    this.playerBuffs.update(view.player.buffs);

    /* ---------- 技能栏 / 飘字 / 状态 ---------- */
    this.skillBar.update(view.skills);
    this.floating.update(view.floatingText);

    const status = view.statusLine;
    /**
     * 状态提示区只显示**技能被拒的原因**（「攻 · 公共冷却中」这类）。
     *
     * "可打断"曾经也画在这里 —— 但预警条右侧已经有同一句话，
     * 屏幕中央再出现一次纯属噪音（那个位置应该留给真正的突发事件）。
     */
    if (status !== undefined && view.statusDetail !== undefined) {
      this.statusLabel.set('');
      this.statusSub.set(`${translate(view.statusDetail)}  ·  ${translate(status)}`);
      this.statusSub.setColor(0xffb0a0);
    } else {
      this.statusLabel.set(status === undefined ? '' : translate(status));
      this.statusSub.set('');
    }
    this.statusLabel.root.visible = this.statusLabel.root.text !== '';
    this.statusSub.root.visible = this.statusSub.root.text !== '';

    /* ---------- 闪光 ---------- */
    this.flashOverlay.alpha = Math.min(0.3, view.playerFlash * 0.3);

    /* ---------- 结算 ---------- */
    const result = view.result;
    this.resultLayer.visible = result !== undefined;
    if (result) {
      this.resultTitle.set(translate(result.titleKey));
      this.resultTitle.setColor(result.victory ? 0xffd870 : PALETTE.danger.bright);
      this.resultReason.set(translate(result.reasonKey));
      this.resultHint.set(translate('screen.hintRestart'));

      // 统计用等宽对齐的"标签  值"，比堆一串数字好读
      const rows: Array<[string, string]> = [
        [translate('screen.statTime'), `${result.seconds}s`],
        [translate('screen.statRemainingHp'), `${result.remainingHp}/${result.remainingHpCap}`],
        [translate('screen.statTotalDamage'), `${result.totalDamage}`],
        [translate('screen.statDps'), `${result.dps}`],
      ];
      const width = Math.max(...rows.map(([k]) => k.length));
      this.resultStats.set(rows.map(([k, v]) => `${k.padEnd(width, ' ')}   ${v}`).join('\n'));
    }
  }
}

/* ================================================================== *
 * 小工具
 * ================================================================== */

function formatClockSafe(ms: number): string {
  if (!Number.isFinite(ms)) return '--:--';
  const total = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(total / 60)}:${(total % 60).toString().padStart(2, '0')}`;
}

/**
 * 内部刻度 → 展示刻度。
 *
 * 内容是"100 血 / 10 伤害"这种可读的小整数，但内部按 10 倍刻度存储
 * （见 `data/content.ts` 顶部说明）。UI 必须显示展示刻度，
 * 否则玩家会看到 1000 血、100 伤害这种大数字。
 */
function display(internal: number): number {
  return Math.round(internal / DISPLAY_SCALE);
}

function percentOf(resource: { current: number; cap: number }): number {
  if (!Number.isFinite(resource.cap) || resource.cap <= 0) return 0;
  return Math.max(0, Math.min(100, Math.round((resource.current / resource.cap) * 100)));
}

