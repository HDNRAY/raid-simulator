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
import { FloatingTextLayer } from './FloatingTextLayer';
import { BossTopBarPart } from './parts/bossTopBar';
import { BossCastBarPart } from './parts/bossCastBar';
import { PlayerPanelPart } from './parts/playerPanel';
import { PlayerCastBarPart } from './parts/playerCastBar';
import { PlayerActorPart } from './parts/playerActor';
import { StatusLinePart } from './parts/statusLine';
import { FlashPart } from './parts/flash';
import { FrameRegistry } from './sceneTypes';
import type { BattleSceneOptions, TranslateFn } from './sceneTypes';
import { FONT, LAYOUT, LOGICAL } from '../ui/layout';
import { UiLayout } from '../ui/uiLayout';

/**
 * 类型从这里**重新导出**，所以 `import { BattleSceneOptions } from
 * './render/BattleScene'` 依然可用 —— 拆文件不该是个破坏性改动。
 * 定义本身在 `sceneTypes.ts`（见那里的说明）。
 */
export type { BattleSceneOptions, TranslateFn } from './sceneTypes';



import { Bar, Label, PANEL_STYLE, Panel } from '../ui/primitives';
import { BossSprite } from './actors/BossSprite';
import type { BattleSnapshotView } from './viewModel';
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
  /** 是否显示键名（触屏隐藏）。见 `FrameContext.showKeyHints`。 */
  private showKeyHints = true;

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

  /**
   * 帧部件注册表（见 `FrameRegistry` / `FramePart`）。
   *
   * 场景只持有它并广播；**不持有任何部件内部状态**
   * （比如玩家姿态的 `lastPose` 已经跟着 `PlayerActorPart` 走了）。
   */
  private readonly registry = new FrameRegistry();

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

    this.registerFrameParts();
  }

  /**
   * **注册帧部件**（需求："ui 的各个部分注册在 tick 上"）。
   *
   * ⚠️ **注册顺序 = 绘制顺序**：背景/角色 → HUD → 读条 → 技能栏 →
   * 飘字 → 闪光 → 结算。飘字要盖在面板上、结算要盖在所有东西上。
   */
  private registerFrameParts(): void {
    this.registry.add(new BossTopBarPart({
      bossName: this.bossName,
      bossPhase: this.bossPhase,
      timerLabel: this.timerLabel,
      bossHpBar: this.bossHpBar,
      bossHpText: this.bossHpText,
      enrageBadge: this.enrageBadge,
      bossBuffs: this.bossBuffs,
    }));
    this.registry.add(new BossCastBarPart(this.castBar));
    this.registry.add(new PlayerPanelPart({
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
    }));
    this.registry.add(new PlayerCastBarPart(this.playerCastBar));
    this.registry.add(new PlayerActorPart(this.playerRoot, this.playerAnim));
    this.registry.add(this.skillBar);
    this.registry.add(this.floating);
    this.registry.add(new StatusLinePart(this.statusLabel, this.statusSub));
    this.registry.add(new FlashPart(this.flashOverlay));
    this.registry.add({
      name: 'logPanel',
      render: (ctx) => this.logPanel.update(ctx.logEntries),
    });
    this.registry.add({
      name: 'bossActor',
      render: (ctx) =>
        this.boss.update(ctx.view.telegraphing, ctx.view.bossFlash, ctx.view.armored),
    });
    this.registry.add({
      name: 'result',
      render: (ctx) => this.renderResult(ctx),
    });
  }

  /**
   * 结算面板。
   *
   * ⚠️ 它是**唯一用闭包注册**的部件：它要改 5 个自己持有的字段
   * （标题/原因/统计/提示），字段太多不值得为它单独开一个文件传 6 个引用。
   * 闭包把它留在场景里，同时仍然走注册机制 —— 顺序照样由注册决定。
   */
  private renderResult(ctx: {
    view: BattleSnapshotView;
    /** ⚠️ 收 `TranslateFn` 而不是 `(k: string) => string` —— 胜因文案带插值。 */
    translate: TranslateFn;
    /** 是否显示键名（触屏传 false）—— 决定重开提示用哪一句。 */
    showKeyHints: boolean;
  }): void {
    const { view, translate, showKeyHints } = ctx;
    const result = view.result;
    this.resultLayer.visible = result !== undefined;
    if (!result) return;
    this.resultTitle.set(translate(result.titleKey));
    this.resultTitle.setColor(result.victory ? 0xffd870 : PALETTE.danger.bright);
    /**
     * ⚠️ 参数值可能是**另一个 i18n key**（`boss.name`）—— 适配器只给
     * key，翻译在渲染层做（i18n 规范 I1）。这里的"再翻一次"是有意的。
     */
    const reasonParams = result.reasonParams;
    this.resultReason.set(
      reasonParams === undefined
        ? translate(result.reasonKey)
        : translate(
            result.reasonKey,
            Object.fromEntries(
              Object.entries(reasonParams).map(([k, v]) => [
                k,
                typeof v === 'string' ? translate(v) : v,
              ]),
            ),
          ),
    );
    /** 重开提示按模式分流。⚠️ 两条文案都走 i18n（规范 I1）。 */
    this.resultHint.set(
      translate(showKeyHints ? 'screen.hintRestart' : 'screen.hintRestartTap'),
    );

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


  /**
   * 是否显示键名（触屏传 `false`）。见 `FrameContext.showKeyHints`。
   *
   * ⚠️ 触屏时**整条技能栏都隐藏**：双弧按钮承担了它的全部职责
   * （技能字 + 冷却 + 代价），同时显示会重叠。
   */
  setShowKeyHints(show: boolean): void {
    this.showKeyHints = show;
    this.skillBar.root.visible = show;
  }

  /**
   * **UI 缩放**（需求："缩放游戏 UI……战斗画面和战斗文字保持不变"）。
   *
   * 只作用于 UI 部件，**不碰画布尺寸**（仍是 960×540 逻辑分辨率），
   * 所以角色、场景、飘字不受影响。目前作用于技能栏 + 玩家面板。
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
  /**
   * 每帧广播。
   *
   * ⚠️ **这里不再逐个 update 部件**（需求："tick 对 ui 的更新，应该是
   * 注册机制，ui 的各个部分注册在 tick 上，tick 直接通知大家就好了"）。
   *
   * 原先这个方法是一个 **202 行的顺序调用清单**：场景知道每个部件
   * 需要 `view` 里的哪个字段（`bossHpBar.update(ratioOf(view.boss.hp))`），
   * 每加一个部件都要回来改这里。
   *
   * 现在只有一件事：**组装这一帧的上下文，然后广播**。
   * 部件自己去 `ctx` 里取它要的字段 —— 场景不再知道任何部件的内部。
   */
  update(view: BattleSnapshotView, logEntries: readonly LogEntry[] = []): void {
    this.registry.notify({
      view,
      logEntries,
      translate: this.options.translate,
      uiScale: this.uiScale,
      showKeyHints: this.showKeyHints,
    });
  }
}

/* ================================================================== *
 * 小工具
 * ================================================================== */