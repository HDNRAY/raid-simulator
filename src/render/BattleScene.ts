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

import type { Application, Container, Graphics } from 'pixi.js';
import { PALETTE } from './theme';
import { FONT, LAYOUT, LOGICAL, skillSlotLabels, skillSlotRect } from '../ui/layout';
import { DISPLAY_SCALE } from '../data/balance';

/** 冷却矮条的最大高度（取自布局表，避免两处写魔数）。 */
const SLOT_COOLDOWN_BAR_H = LAYOUT.skillBar.cooldownBarHeight;
import { Bar, Label, Panel, type PixiCtor } from '../ui/primitives';
import { BossSprite } from './actors/BossSprite';
import {
  isTightWindow,
  ratioOf,
  telegraphHint,
  type BattleSnapshotView,
  type BuffView,
  type SkillSlotView,
} from './viewModel';

export type TranslateFn = (key: string) => string;

export interface BattleSceneOptions {
  readonly app: Application;
  readonly pixi: PixiCtor;
  readonly translate: TranslateFn;
}

/* ================================================================== *
 * 背景
 * ================================================================== */

function drawBackground(g: Graphics): void {
  g.clear();

  const horizon = 372;

  /* ---- 天空：从近黑到暖褐的竖向渐变（色带模拟） ---- */
  const bands = 26;
  for (let i = 0; i < bands; i += 1) {
    const t = i / (bands - 1);
    // 上暗下亮，且下半段更快变亮 —— 视觉重心落在接近地平线处
    const eased = t * t;
    const color = mixColor(PALETTE.bgTop, PALETTE.bgBottom, eased);
    g.rect(0, (horizon * i) / bands, LOGICAL.width, horizon / bands + 1).fill(color);
  }

  /* ---- 月亮：给画面一个焦点，也让角色剪影有背光 ---- */
  g.circle(742, 118, 34).fill({ color: 0xd8c8a8, alpha: 0.1 });
  g.circle(742, 118, 26).fill({ color: 0xe8d8b8, alpha: 0.14 });
  g.circle(742, 118, 18).fill({ color: 0xf0e4c8, alpha: 0.2 });

  /* ---- 远景废墟：**只放两侧**，中间留空给角色 ---- */
  // 塔身用比天空更暗的色，才能读成"远处的黑剪影"而不是灰块
  const spires: Array<[number, number, number]> = [
    [24, 40, 176],
    [84, 22, 232],
    [120, 30, 200],
    [800, 26, 214],
    [860, 44, 158],
    [916, 18, 246],
  ];
  for (const [x, w, top] of spires) {
    g.rect(x, top, w, horizon - top).fill(0x08070c);
    // 塔尖
    g.poly([x - 4, top, x + w / 2, top - 22, x + w + 4, top]).fill(0x08070c);
  }
  // 远处的拱门轮廓（只有边框，暗示有建筑）
  g.rect(150, 244, 78, horizon - 244).stroke({ color: 0x121019, width: 3 });
  g.rect(756, 232, 62, horizon - 232).stroke({ color: 0x121019, width: 3 });

  /* ---- 地表雾：把地平线糊开，避免一条生硬的直线 ---- */
  for (let i = 0; i < 8; i += 1) {
    const t = i / 7;
    g.rect(0, horizon - 18 + i * 5, LOGICAL.width, 6).fill({
      color: mixColor(PALETTE.ground, 0x3a2c34, t),
      alpha: 0.42 - t * 0.3,
    });
  }

  /* ---- 地面 ---- */
  g.rect(0, horizon, LOGICAL.width, LOGICAL.height - horizon).fill(PALETTE.ground);
  // 地面近处更暗（暗角），把角色所在的中景"顶"出来
  g.rect(0, horizon, LOGICAL.width, 26).fill({ color: 0x241a20, alpha: 0.9 });
  g.rect(0, LOGICAL.height - 46, LOGICAL.width, 46).fill({ color: 0x0f0b11, alpha: 0.85 });

  // 地砖透视：近处间距更大
  for (let i = 0; i <= 12; i += 1) {
    const t = i / 12;
    const x = -40 + t * (LOGICAL.width + 80);
    g.moveTo(x, horizon).lineTo(x + (x - LOGICAL.width / 2) * 0.18, LOGICAL.height);
    g.stroke({ color: 0x241a22, width: 1, alpha: 0.5 });
  }
  for (const y of [horizon + 22, horizon + 54, horizon + 96]) {
    g.moveTo(0, y).lineTo(LOGICAL.width, y);
    g.stroke({ color: 0x241a22, width: 1, alpha: 0.4 });
  }

  /* ---- 顶部压暗：让 HUD 区域与战场分层 ---- */
  g.rect(0, 0, LOGICAL.width, 128).fill({ color: 0x000000, alpha: 0.34 });
}

/* ================================================================== *
 * 图标条（buff / debuff 通用）
 * ================================================================== */

class IconStrip {
  readonly root: Container;
  private readonly items: Array<{
    square: Graphics;
    label: Label;
    timer: Label;
  }> = [];
  private readonly pixi: PixiCtor;

  constructor(
    pixi: PixiCtor,
    private readonly strip: {
      readonly x: number;
      readonly y: number;
      readonly size: number;
      readonly gap: number;
      readonly max: number;
      readonly labelGap?: number;
    },
    private readonly translate: TranslateFn,
  ) {
    this.pixi = pixi;
    this.root = new pixi.Container();
  }

  private ensure(count: number): void {
    const target = Math.min(count, this.strip.max);
    while (this.items.length < target) {
      const square = new this.pixi.Graphics();
      // 极简标签：最多 2 字，字号 small（中文下限 13）
      const label = new Label(this.pixi, {
        x: 0,
        y: this.strip.y + 3,
        size: FONT.small,
        color: 0xffffff,
      });
      // 剩余时间叠在方块**右下角**，不额外占横向空间
      const timer = new Label(this.pixi, {
        x: 0,
        y: this.strip.y + this.strip.size - FONT.tiny - 1,
        size: FONT.tiny,
        color: 0xffffff,
        anchorX: 1,
        stroke: 0x000000,
        strokeWidth: 2,
      });
      this.root.addChild(square, label.root, timer.root);
      this.items.push({ square, label, timer });
    }
  }

  update(buffs: readonly BuffView[]): void {
    // 判定窗口类排最前：玩家最需要看到"我还能躲多久"
    const sorted = [...buffs].sort((a, b) => Number(b.isDefensive) - Number(a.isDefensive));
    this.ensure(sorted.length);

    const { x, y, size, gap } = this.strip;
    const labelGap = this.strip.labelGap ?? 4;
    let cursor = x;

    for (let i = 0; i < this.items.length; i += 1) {
      const item = this.items[i];
      const view = sorted[i];
      if (!item) continue;

      if (!view) {
        item.square.clear();
        item.label.set('');
        item.timer.set('');
        item.square.visible = false;
        continue;
      }

      const tight = isTightWindow(view);
      const edge = view.color;

      const g = item.square;
      g.visible = true;
      g.clear();
      // **单色方块占位**：一块纯色 + 深色描边。
      // 接入正式图标后这一块会被贴图替换，布局不需要改。
      g.rect(cursor, y, size, size).fill({ color: edge, alpha: tight ? 1 : 0.9 });
      g.rect(cursor, y, size, size).stroke({ color: 0x05050a, width: 1 });
      // 判定窗口且时间很紧：加一圈亮边提醒"就是现在"
      if (tight) g.rect(cursor - 1, y - 1, size + 2, size + 2).stroke({ color: 0xffffff, width: 1 });

      // 剩余时间：叠在方块内右下角（白字 + 黑描边，压在纯色上也读得清）
      const seconds =
        view.stacks > 1
          ? `${view.stacks}`
          : Number.isFinite(view.remainingMs) && view.remainingMs < 100_000
            ? `${Math.ceil(view.remainingMs / 1000)}`
            : '';
      item.timer.set(seconds);
      item.timer.setColor(edge > 0x808080 ? 0x101014 : 0xffffff);
      item.timer.root.x = cursor + size - 2;

      // 标签在方块右侧，流式排布
      item.label.set(this.translate(view.shortLabelKey));
      item.label.setColor(0xd0d0dc);
      item.label.root.x = cursor + size + labelGap;

      const labelW = Math.max(item.label.root.width, 16);
      cursor += size + labelGap + labelW + gap;
    }
  }
}

/* ================================================================== *
 * 技能栏
 * ================================================================== */

class SkillBarView {
  readonly root: Container;
  private readonly slots: Array<{
    gfx: Graphics;
    /** 技能字（楷体）。这是图标的占位 —— 正式美术接入后换成贴图。 */
    glyph: Label;
    key: Label;
    cd: Label;
    rect: { x: number; y: number; w: number; h: number };
  }> = [];
  private readonly pixi: PixiCtor;
  private slotCount = 0;

  constructor(
    pixi: PixiCtor,
    private readonly translate: TranslateFn,
  ) {
    this.pixi = pixi;
    this.root = new pixi.Container();
  }

  private ensure(count: number): void {
    const target = Math.min(count, LAYOUT.skillBar.max);
    while (this.slots.length < target) {
      const i = this.slots.length;
      const rect = skillSlotRect(i, target);
      const pos = skillSlotLabels(rect);
      const gfx = new this.pixi.Graphics();

      /**
       * 图标 = 技能名那个字，用**楷体**。
       *
       * 为什么不用图形：目前没有美术素材，而"一个字"比任何几何图形
       * 都更能表达技能（攻/闪/防/破/轰/凝）。楷体在 30px 上下
       * 比黑体更易辨认（见 theme.ts 的说明）。
       */
      /**
       * 技能字用 `FONT.body`（15px）而不是 `FONT.big`（26px）。
       *
       * 26px 的楷体字高 28px，占掉了 44px 格子的 2/3，
       * 冷却秒数无论放哪都会与它相交。15px 的字高约 17px，
       * 加上下方 20px 的秒数位置才放得下 —— 这是算出来的，
       * 不是试出来的（见 `skillSlotLabels` 的说明）。
       */
      const glyph = new Label(this.pixi, {
        x: pos.glyph.x,
        y: pos.glyph.y,
        size: FONT.body,
        color: 0xffffff,
        anchorX: 0.5,
        kai: true,
      });
      /**
       * 按键提示：格子内**右下角**。
       *
       * 踩过两次坑：
       *   1. 一开始放格子内右下角，被**冷却弧**压住（弧的半径几乎
       *      等于格子半宽）。
       *   2. 于是移到格子**外面**下方 —— 结果落到画布底边之外，
       *      被截断（技能栏底部就在 y=530，画布只有 540）。
       *
       * 3. 弧缩小后又放回右下角 → 与冷却数字挤在一起（被测试抓到）。
       *
       * 现在放**左上角**：冷却弧的内圈在那里留了空白，
       * 而技能字在正中、数字在正中下方，三者互不侵犯。
       */
      const key = new Label(this.pixi, {
        x: pos.key.x,
        y: pos.key.y,
        size: FONT.tiny,
        color: 0x9090a0,
      });
      /**
       * 冷却剩余秒数：格子**正中偏下**，压在技能字下方一点点。
       *
       * 位置换过三次，最后靠**矩形重叠检测**定下来：
       * 放正中会与技能字完全重叠；放底部居中会与按键提示挤在一起。
       * 现在放**右下角压在弧线上**，技能字完整保留（字与数字不重叠）。
       */
      const cd = new Label(this.pixi, {
        x: pos.cooldown.x,
        y: pos.cooldown.y,
        size: FONT.small,
        color: 0xffffff,
        anchorX: 0.5,
        stroke: 0x000000,
        strokeWidth: 3,
      });
      this.root.addChild(gfx, glyph.root, key.root, cd.root);
      this.slots.push({ gfx, glyph, key, cd, rect });
    }

    if (target !== this.slotCount) {
      this.slotCount = target;
      // 右对齐：槽位数变化时整条栏向左延展
      for (let i = 0; i < this.slots.length; i += 1) {
        const rect = skillSlotRect(i, target);
        const pos = skillSlotLabels(rect);
        const s = this.slots[i];
        if (!s) continue;
        s.rect = rect;
        s.glyph.root.x = pos.glyph.x;
        s.glyph.root.y = pos.glyph.y;
        s.key.root.x = pos.key.x;
        s.key.root.y = pos.key.y;
        s.cd.root.x = pos.cooldown.x;
        s.cd.root.y = pos.cooldown.y;
      }
    }
  }

  update(skills: readonly SkillSlotView[]): void {
    this.ensure(skills.length);

    for (let i = 0; i < this.slots.length; i += 1) {
      const s = this.slots[i];
      const view = skills[i];
      if (!s) continue;

      if (!view) {
        s.gfx.clear();
        s.glyph.set('');
        s.key.set('');
        s.cd.set('');
        continue;
      }

      const { x, y, w } = s.rect;
      const g = s.gfx;
      g.clear();

      /**
       * 按钮外观：**没有边框、没有底色**。
       *
       * 需求明确"暂时不要按钮的大招边框、不同的背景色"。
       * 所以只用两种手段表达状态：
       *   - 可用：字正常亮
       *   - 冷却中：弧形遮罩 + 秒数
       *   - 不可用（资源不足）：字变暗
       * 这样画面上只有"字 + 一个弧形"，是这套 UI 最干净的状态。
       */
      if (view.cooldownRatio > 0.001) {
        /**
         * 冷却遮罩：格子**顶部**一块**半透明黑色矮条**。
         *
         * 换过三次，每次都是被具体问题逼的：
         *
         *   1. **扇形/圆环填充** —— 把技能字盖住了。
         *   2. **一条红色弧线** —— 虽然不挡字，但（a）红色在这套
         *      青/金/绿的配色里非常跳；（b）**会抖动**：弧的起止角
         *      每帧重算，抗锯齿边缘在 1px 之间来回跳。
         *   3. 现在：**半透明黑 + 固定高度 + 只有高度变化**。
         *      高度是整数像素，所以不会抖；黑色不参与配色。
         *
         * 高度只改（不变色、不换形状），读取起来也更直接：
         * 黑条越长 = 冷却越久。
         */
        const barH = Math.max(1, Math.round(SLOT_COOLDOWN_BAR_H * view.cooldownRatio));
        g.rect(x, y, w, barH).fill({ color: 0x000000, alpha: 0.62 });
      }
      /**
       * 不可用（资源不足 / 条件不满足）**不画任何方框**。
       *
       * 早期这里填一个半透明圆角方块 —— 那就是需求里要去掉的
       * "按钮方框"。现在只用**字的明暗**表达：
       * 可用纯白、冷却中偏灰、不可用更暗。画面上只剩字与弧。
       */

      s.glyph.set(this.translate(view.nameKey));
      s.glyph.setColor(
        view.usable ? 0xffffff : view.cooldownRatio > 0.001 ? 0xb0b0be : 0x5a5a68,
      );
      s.key.set(view.key.toUpperCase());
      // 剩余秒数：0.1 秒精度（逻辑步长就是 0.1 秒，再细没意义）
      /**
       * 冷却剩秒**取整**。
       *
       * 早期显示到 0.1 秒（`toFixed(1)`）：一是"还剩 4.3 秒"对玩家没有
       * 额外信息量，二是那个宽度会把技能字挤掉。取整后一位数字放得下。
       */
      s.cd.set(view.cooldownRatio > 0.001 ? Math.ceil(view.cooldownSec).toString() : '');
    }
  }
}

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
  private readonly flashOverlay: Graphics;

  /* 顶栏 */
  private readonly bossName: Label;
  private readonly bossPhase: Label;
  private readonly bossHpBar: Bar;
  private readonly bossHpText: Label;
  private readonly timerLabel: Label;
  private readonly enrageBadge: Label;

  /* 预警条 */
  private readonly castPanel: Panel;
  private readonly castName: Label;
  private readonly castHint: Label;
  /** Boss 读条的纯色填充块（宽度随进度增长） */
  private readonly castFill: Graphics;
  /** 玩家读条的纯色填充块（宽度随进度增长） */
  private readonly playerCastFill: Graphics;
  /** 玩家自己的读条（面板顶部）。与 Boss 预警条是**两套**对象 —— 见布局说明。 */
  private readonly playerCastPanel: Panel;
  private readonly playerCastName: Label;
  private readonly playerCastTime: Label;

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

    this.playerAnim = new pixi.Graphics();
    this.drawPlayer(1);
    this.root.addChild(this.playerAnim);

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

    /* 预警条 */
    const cb = LAYOUT.castBar;
    this.castPanel = new Panel(pixi, {
      x: cb.x,
      y: cb.y,
      w: cb.w,
      h: cb.h,
      fill: 0x2a0c0e,
      line: PALETTE.danger.base,
      fillAlpha: 0.9,
      radius: 2,
    });
    this.castName = new Label(pixi, { x: cb.x + 12, y: cb.y + 6, size: FONT.warn, color: 0xffe0d0 });
    this.castHint = new Label(pixi, {
      x: cb.x + cb.w - 10,
      y: cb.y + 9,
      size: FONT.body,
      color: 0xffd0b0,
      anchorX: 1,
    });
    /**
    /**
     * 读条 = **面板底 + 一块纯色方块从左往右长**（像水位 / 电量条）。
     *
     * ------------------------------------------------------------------
     * 需求澄清（我理解错过两次，记下来）
     * ------------------------------------------------------------------
     *
     * 需求原话是"背景色作为 progress"。"**渐变**"指的是 **gradient**
     * —— 也就是"整块面板颜色从暗到亮地过渡"，那是**不要**的。
     *
     * 正确形态：面板是一层**暗色底**（未完成部分），进度用一块
     * **纯色**（无渐变）从左边铺到右边，铺满面板内部高度。
     * 这正是最经典的进度条：一眼能读出"还剩多少"。
     *
     * 所以结构是：
     *   `castPanel`（暗底 + 描边，铺满整块）
     *   `castFill`（纯色，宽度 = 进度 × 内部宽）
     *   文字在两者之上
     */
    this.castPanel.root.visible = false;
    this.castFill = new pixi.Graphics();
    this.castFill.visible = false;
    this.castName.root.visible = false;
    this.castHint.root.visible = false;
    // 顺序即层叠：底 → 填充 → 文字
    hud.addChild(this.castPanel.root, this.castFill, this.castName.root, this.castHint.root);

    /* 玩家读条（面板顶部） */
    const pcb = LAYOUT.playerCastBar;
    /**
     * 玩家读条：**背景色推进 + 亮金文字**。
     *
     * ------------------------------------------------------------------
     * 为什么改（用户反馈"太不清晰了，颜色太暗"）
     * ------------------------------------------------------------------
     *
     * 早期是"深灰底 + 一条 3px 的暗金细线"，两个问题：
     *   1. 底色 `0x14100c` 几乎是黑的，与面板分不开；
     *   2. 文字 `0xffe8c0` 在中文字形下偏暗，而且细线只有 3px，
     *      斜眼看根本读不出进度。
     *
     * 现在改成与 **Boss 预警条同一套表达**（进度 = 背景色推进）：
     * 底色从暗金推进到亮金，文字更亮、秒数更大。两处读条用同一套
     * 视觉语言，玩家不必学两次。
     */
    this.playerCastPanel = new Panel(pixi, {
      x: pcb.x,
      y: pcb.y,
      w: pcb.w,
      h: pcb.h,
      // 暗底 = "还没走完的那一段"
      fill: 0x2a1c06,
      line: 0xd8a840,
      fillAlpha: 1,
      radius: 2,
    });
    /**
     * 读条文字：**不加描边**。
     *
     * 踩过的坑：我先给它们加了深色描边（那是"数字压在亮条上"的标准做法），
     * 结果在**亮金底**上深描边把白字包成一圈暗边，整块看起来反而更暗 ——
     * 用户反馈的"颜色太暗"有一部分就来自这里。
     *
     * 底色已经是饱和金（亮度足够），纯白字直接压上去对比度最高。
     */
    this.playerCastName = new Label(pixi, {
      x: pcb.x + 8,
      y: pcb.y + 2,
      size: FONT.body,
      color: 0xffffff,
      kai: true,
    });
    this.playerCastTime = new Label(pixi, {
      x: pcb.x + pcb.w - 8,
      y: pcb.y + 2,
      size: FONT.body,
      color: 0xffffff,
      anchorX: 1,
    });
    this.playerCastPanel.root.visible = false;
    /**
     * 玩家读条同样用"纯色方块从左往右长"，配色换暖金。
     * 层叠顺序：暗底 → 纯色填充 → 文字。
     */
    this.playerCastFill = new pixi.Graphics();
    this.playerCastFill.visible = false;
    this.playerCastName.root.visible = false;
    this.playerCastTime.root.visible = false;
    hud.addChild(
      this.playerCastPanel.root,
      this.playerCastFill,
      this.playerCastName.root,
      this.playerCastTime.root,
    );

    /* 玩家面板：生命 / 缠 / 炁 **垂直排列** */
    const pf = LAYOUT.player;
    this.playerPanel = new Panel(pixi, {
      x: pf.x,
      y: pf.y,
      w: pf.w,
      h: pf.h,
      fill: 0x0c0c14,
      line: 0x4a4c60,
      fillAlpha: 0.86,
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

  update(view: BattleSnapshotView): void {
    const { translate } = this.options;

    /* ---------- 角色 ---------- */
    this.boss.update(view.telegraphing, view.bossFlash, view.armored);

    const dodging = view.player.buffs.some((b) => b.id.startsWith('dodge') && b.remainingMs > 0);
    const guarding = view.player.buffs.some((b) => b.id.startsWith('guard') && b.remainingMs > 0);
    const pose = dodging || guarding ? 0.85 : 1;
    if (pose !== this.lastPlayerPose) {
      this.lastPlayerPose = pose;
      this.drawPlayer(pose);
    }
    this.playerAnim.tint = dodging ? 0x9ad8ff : guarding ? 0xc8d0e8 : 0xffffff;

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
    this.castPanel.root.visible = cast !== undefined;
    this.castName.root.visible = cast !== undefined;
    this.castHint.root.visible = cast !== undefined;

    if (cast) {
      this.castName.set(translate(cast.nameKey));
      const hint = telegraphHint(cast);
      this.castHint.set(hint ? `${hint.seconds}s` : '');
      /**
       * 提示区**只显示剩余秒数**。
       *
       * 需求：不要"闪避或格挡"字样。理由也很直接 —— 这两种应对
       * 永远都适用，写出来是纯噪声；而"还有多久命中"才是玩家真正
       * 需要读的信息。霸体状态改由**技能名颜色**表达（见下）。
       */
      this.castHint.set(`${hint?.seconds ?? ''}s`);
      this.castHint.setColor(cast.interruptible ? PALETTE.interrupt.bright : 0x30c8d0);

      /**
       * 进度 → **纯色方块宽度**（无渐变）。
       *
       * 底槽是暗红（未完成部分），方块是纯橙红（已完成部分）。
       * 块宽按面板**内部**宽度算（左右各让 1px 给描边）。
       */
      const cbr = LAYOUT.castBar;
      const fillW = Math.max(0, Math.round((cbr.w - 2) * Math.min(1, Math.max(0, cast.progress))));
      this.castFill.clear();
      if (fillW > 0) {
        this.castFill
          .rect(cbr.x + 1, cbr.y + 1, fillW, cbr.h - 2)
          .fill({ color: 0xd8482a });
      }
      this.castFill.visible = true;
      // 越接近命中，边框越亮 —— 把"快到了"变成视觉压力
      this.castPanel.set({ line: cast.progress > 0.7 ? 0xffd060 : PALETTE.danger.base });
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
    this.playerCastPanel.root.visible = playerCast !== undefined;
    this.playerCastName.root.visible = playerCast !== undefined;
    this.playerCastTime.root.visible = playerCast !== undefined;
    if (playerCast) {
      this.playerCastName.set(translate(playerCast.nameKey));
      this.playerCastTime.set(`${(playerCast.remainingMs / 1000).toFixed(1)}s`);
      /**
       * 进度 → **纯色方块宽度**（与 Boss 预警条同一形态，
       * 配色换成暖金 —— 红色是威胁、金色是自己的动作）。
       */
      const pbr = LAYOUT.playerCastBar;
      const pw = Math.max(0, Math.round((pbr.w - 2) * Math.min(1, Math.max(0, playerCast.progress))));
      this.playerCastFill.clear();
      if (pw > 0) {
        this.playerCastFill
          .rect(pbr.x + 1, pbr.y + 1, pw, pbr.h - 2)
          .fill({ color: 0xb8860f });
      }
      this.playerCastFill.visible = true;
      this.playerCastPanel.set({
        line: playerCast.progress > 0.7 ? 0xfff4c0 : 0xd8a840,
      });
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

function mixColor(a: number, b: number, t: number): number {
  const ar = (a >> 16) & 0xff;
  const ag = (a >> 8) & 0xff;
  const ab = a & 0xff;
  const br = (b >> 16) & 0xff;
  const bg = (b >> 8) & 0xff;
  const bb = b & 0xff;
  return (
    (Math.round(ar + (br - ar) * t) << 16) |
    (Math.round(ag + (bg - ag) * t) << 8) |
    Math.round(ab + (bb - ab) * t)
  );
}
