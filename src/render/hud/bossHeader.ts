/**
 * **Boss 顶栏**：名字 / 阶段位 / 倒计时 / 狂暴徽章 / 血条 + 血字
 * + Boss 自己的 buff 与 debuff 两条图标条。
 *
 * ==================================================================
 * 为什么单独一个文件（关注分离，AGENTS.md §3）
 * ==================================================================
 *
 * 这个区域的"造 / 画 / 缩放"原先**分在两个地方**：
 *   - 节点（Label / Bar / IconStrip）在 `BattleScene` 的构造函数里造
 *   - 每帧画什么在 `parts/bossTopBar.ts` 里
 *   - UI 缩放又是 `BattleScene.setUiScale` 里逐个元素手调
 *
 * 而"顶栏该多大、缩放时该动谁"本来就是**顶栏自己的知识** ——
 * 所以现在收在一起：本文件造节点、`register()` 挂帧部件、
 * `setUiScale()` 自己按锚点重排。`BattleScene` 只持有它并转发。
 *
 * ⚠️ 下面的注释与代码是一起从 `BattleScene.ts` 搬过来的
 * （AGENTS.md §3：抽取时连带注释一起搬）。
 */

import type { Container } from 'pixi.js';
import { FONT, LAYOUT, LOGICAL } from '../../ui/layout';
import { Bar, Label, type PixiCtor } from '../../ui/primitives';
import { UiLayout } from '../../ui/uiLayout';
import { IconStrip } from '../IconStrip';
import { BossTopBarPart } from '../parts/bossTopBar';
import { PALETTE } from '../theme';
import type { FrameRegistry, TranslateFn } from '../sceneTypes';
import { BOSS_PORTRAITS, portraitFor } from '../portraitAssets';
import { PortraitSprite } from '../portraitSprite';

/** Boss 顶栏区域。 */
export class BossHeader {
  /** HUD 层上的根容器。`(0,0)` 让内部的逻辑坐标保持不变。 */
  readonly root: Container;

  /* 顶栏 */
  private readonly bossName: Label;
  private readonly bossPhase: Label;
  private readonly bossHpBar: Bar;
  private readonly bossHpText: Label;
  private readonly timerLabel: Label;
  private readonly enrageBadge: Label;

  /**
   * **Boss 的头像**（2026-10-22，用户："boss的头像 也从 fd2 里拿过来显示一下吧"）。
   *
   * ⚠️ 与详情区那颗**同一套机制**（`PortraitSprite` + `portraitAssets`）：
   * 素材缺了就不画（`ready === false` 时它自己不显示），占位交给顶栏的布局。
   */
  private portrait: PortraitSprite | undefined;

  /* 图标条 */
  private readonly bossBuffs: IconStrip;
  /** Boss 的减益条（右上）—— 与增益条分开，位置本身就是分类。 */
  private readonly bossDebuffs: IconStrip;

  constructor(pixi: PixiCtor, translate: TranslateFn) {
    this.root = new pixi.Container();

    const bb = LAYOUT.bossBar;
        /**
     * ⚠️ 名字从**头像右边**开始（头像 2026-10-22 加的）：没有头像的 Boss 也会
     * 从这里开始 —— 顶栏因此**不随"有没有脸"而左右跳**。
     */
    this.bossName = new Label(pixi, {
      x: bb.x + FONT.title + 13,
      y: bb.y,
      size: FONT.title,
      color: PALETTE.text,
    });
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
    this.root.addChild(
      this.bossName.root,
      this.bossPhase.root,
      this.timerLabel.root,
      this.enrageBadge.root,
    );

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
    this.root.addChild(this.bossHpBar.root, this.bossHpText.root);

    this.bossBuffs = new IconStrip(pixi, LAYOUT.bossBuffs, translate);
    this.root.addChild(this.bossBuffs.root);
    this.bossDebuffs = new IconStrip(pixi, LAYOUT.bossDebuffs, translate);
    this.root.addChild(this.bossDebuffs.root);

    /**
     * 头像摆在名字**左边**：`bb.x` 起、边长 = 名字字号左右。
     * ⚠️ 先用第一张 Boss 素材占位（`setBoss` 会在进战斗时换掉）——
     * `PortraitSprite` 的构造需要一个 asset，与详情区那颗同一个做法。
     */
    const firstBoss = BOSS_PORTRAITS[0];
    if (firstBoss !== undefined) {
      this.portrait = new PortraitSprite(pixi, this.root, firstBoss, this.portraitBox());
      this.portrait.setVisible(false);
    }
  }

  /**
   * 头像边长（逻辑像素）= 名字字号 + 一点余量。
   *
   * ⚠️ 由**顶栏自己的字号**推出来（不写死）：`setUiScale` 会改字号，
   * 头像跟着同一套比例走，两者不会一大一小。
   */
  private portraitBox(): number {
    return FONT.title + 9;
  }

  /**
   * **换 Boss**（进战斗 / 重开时由 `SceneStage.setAppearance` 调）。
   *
   * 没配头像的 Boss ⇒ 整颗藏掉（顶栏布局里那一格就空着，名字仍然从
   * 固定位置开始 —— 与之前没有头像时**逐字相同**）。
   */
  setBoss(bossId: string): void {
    const asset = portraitFor(bossId);
    if (asset === undefined) {
      this.portrait?.setVisible(false);
      return;
    }
    this.portrait?.setAsset(asset);
    this.portrait?.setVisible(true);
    const bb = LAYOUT.bossBar;
    const box = this.portraitBox();
    this.portrait?.root.position.set(bb.x + box / 2, bb.y + FONT.title / 2 + 1);
  }

  /** 挂上本区域的每帧部件（顶栏文本 / 血条 / 两条图标条）。 */
  register(registry: FrameRegistry): void {
    registry.add(new BossTopBarPart({
      bossName: this.bossName,
      bossPhase: this.bossPhase,
      timerLabel: this.timerLabel,
      bossHpBar: this.bossHpBar,
      bossHpText: this.bossHpText,
      enrageBadge: this.enrageBadge,
      bossBuffs: this.bossBuffs,
      bossDebuffs: this.bossDebuffs,
    }));
  }

  /**
   * **UI 缩放**：顶栏自己按锚点重排。
   *
   * 顶栏是**横贯整屏**的元素（`UI_ANCHORS.bossBar = 'top-fixed-width'`），
   * 缩放时左右边距不变、只缩高度与内容尺寸。
   */
  setUiScale(scale: number): void {
    const ui = new UiLayout(scale);

    /* ---------- Boss 相关（需求："boss 相关面板 buff，读条"） ---------- */
    const bb = ui.bossBar;
    /**
     * ⚠️ **这里曾经用 `FONT.body`(15)，与构造时的 `FONT.title`(17) 不一致**
     * （已修）。
     *
     * 后果很具体：**一拖动缩放滑块，名字就会"缩一下"** —— 因为
     * `setUiScale` 用 15 作为基准去乘，而当前字号明明是 17 算出来的。
     * 用户在滑块上第一个动作就能看见 ✗
     *
     * 这类"同一个属性的基准值写在两个地方"的问题，和仓库里其它
     * "两份真相"是同一类；修法就是把基准收成一处：**都取 `FONT.title`**。
     */
    this.bossName.setSize(ui.len(FONT.title));
    this.bossName.root.x = bb.x + ui.len(FONT.title + 13);
    /** 头像跟着同一套比例走（见 `portraitBox` 的说明）。 */
    this.portrait?.root.position.set(bb.x + ui.len(FONT.title + 9) / 2, bb.y + ui.len(FONT.title) / 2 + 1);
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
    this.bossDebuffs.setUiScale(scale, ui.bossDebuffs);
  }
}
