/**
 * 战斗场景（M5）。
 *
 * 组成：背景 → 竞技场 → Boss 精灵 → 玩家背影 → HUD。
 *
 * 数据流是**单向**的：`update(view)` 只读传入的快照，
 * 从不反向调用引擎，也不持有引擎对象。这是架构规范 C3 的落地。
 *
 * 性能纪律：
 *   - 所有组件**创建一次**，每帧只 `update()`
 *   - 文本只在值真变化时赋值（Pixi 改 `text` 会重建纹理）
 *   - 进度条在比例变化 < 0.2% 时跳过重绘
 */

import type { Application, Container, Graphics } from 'pixi.js';
import { PALETTE, TYPE, css } from './theme';
import { LAYOUT, LOGICAL, buffIconRect, skillSlotRect } from '../ui/layout';
import { Bar, Label, Panel, drawCorners, type PixiCtor } from '../ui/primitives';
import { BossSprite } from './actors/BossSprite';
import {
  isTightWindow,
  ratioOf,
  telegraphHint,
  type BattleSnapshotView,
  type BuffView,
  type CombatantView,
  type SkillSlotView,
} from './viewModel';

/** 本地化函数：把 nameKey 变成可显示文字。 */
export type TranslateFn = (key: string) => string;

export interface BattleSceneOptions {
  readonly app: Application;
  readonly pixi: PixiCtor;
  readonly translate: TranslateFn;
}

/* ------------------------------------------------------------------ *
 * 背景
 * ------------------------------------------------------------------ */

function drawBackground(g: Graphics): void {
  g.clear();

  // 天空渐变（用横向色带模拟，比真渐变便宜且更像像素画）
  const bands = 24;
  for (let i = 0; i < bands; i += 1) {
    const t = i / (bands - 1);
    const color = mixColor(PALETTE.bgTop, PALETTE.bgBottom, t);
    g.rect(0, (LOGICAL.height * 0.66 * i) / bands, LOGICAL.width, LOGICAL.height * 0.66 / bands + 1);
    g.fill(color);
  }

  // 远景拱门（废墟感）
  const arches: Array<[number, number, number]> = [
    [104, 120, 196],
    [252, 88, 210],
    [520, 104, 200],
    [700, 88, 214],
  ];
  for (const [x, w, top] of arches) {
    g.rect(x, top, w, 360 - top);
    g.fill({ color: 0x14111c, alpha: 0.8 });
    g.rect(x + 6, top + 10, w - 12, 360 - top);
    g.fill(0x0d0b12);
  }

  // 地面
  g.rect(0, 360, LOGICAL.width, LOGICAL.height - 360).fill(PALETTE.ground);
  g.rect(0, 360, LOGICAL.width, 2).fill(PALETTE.groundLine);
  // 地砖线
  for (let x = 0; x < LOGICAL.width; x += 48) {
    g.rect(x, 362, 1, LOGICAL.height - 362).fill({ color: 0x2a1f22, alpha: 0.5 });
  }
}

/* ------------------------------------------------------------------ *
 * 预警区域（地面扇形）
 * ------------------------------------------------------------------ */

class TelegraphZone {
  readonly root: Container;
  private readonly gfx: Graphics;
  private lastProgress = -1;

  constructor(pixi: PixiCtor) {
    this.root = new pixi.Container();
    this.gfx = new pixi.Graphics();
    this.root.addChild(this.gfx);
    this.root.visible = false;
  }

  /** @param progress 0..1，进度越高扇形越满（表现"技能正在成形"） */
  update(on: boolean, progress: number): void {
    this.root.visible = on;
    if (!on) return;
    if (Math.abs(progress - this.lastProgress) < 0.02) return;
    this.lastProgress = progress;

    const g = this.gfx;
    g.clear();
    const cx = 620;
    const cy = 392;
    const radius = 250;
    const spread = 0.35 + 0.65 * progress; // 从窄到宽
    const half = (Math.PI / 2) * spread;

    const points: number[] = [cx, cy];
    const steps = 18;
    for (let i = 0; i <= steps; i += 1) {
      const angle = -Math.PI / 2 - half + (2 * half * i) / steps;
      points.push(cx + Math.cos(angle) * radius, cy + Math.sin(angle) * radius);
    }
    g.poly(points);
    g.fill({ color: PALETTE.danger.base, alpha: 0.16 + 0.14 * progress });
    g.poly(points);
    g.stroke({ color: PALETTE.danger.bright, width: 2, alpha: 0.9 });
  }
}

/* ------------------------------------------------------------------ *
 * 技能栏
 * ------------------------------------------------------------------ */

class SkillBarView {
  readonly root: Container;
  private readonly slots: Array<{
    panel: Panel;
    gfx: Graphics;
    key: Label;
    name: Label;
    cdText: Label;
    rect: { x: number; y: number; w: number; h: number };
  }> = [];
  /** 槽位是按需创建的 —— 数量由槽位表决定，不是硬编码 */
  private slotCount = 0;
  private readonly pixi: PixiCtor;

  constructor(
    pixi: PixiCtor,
    private readonly translate: TranslateFn,
  ) {
    this.pixi = pixi;
    this.root = new pixi.Container();
  }

  /** 确保创建了 `count` 个槽位（只增不减，避免每帧 new）。 */
  private ensureSlots(count: number): void {
    const target = Math.min(count, LAYOUT.skillBar.maxCount);
    while (this.slots.length < target) {
      const i = this.slots.length;
      const rect = skillSlotRect(i, target);
      const panel = new Panel(this.pixi, {
        x: rect.x,
        y: rect.y,
        w: rect.w,
        h: rect.h,
        fill: 0x0c0c12,
        line: 0x3a3a48,
        fillAlpha: 0.9,
      });
      const gfx = new this.pixi.Graphics();
      const key = new Label(this.pixi, { x: rect.x + 5, y: rect.y + rect.h - 18, size: TYPE.md, color: 0xffffff });
      const name = new Label(this.pixi, {
        x: rect.x + rect.w / 2,
        y: rect.y + rect.h - 20,
        size: TYPE.xs,
        color: 0xffffff,
        anchorX: 0.5,
      });
      const cdText = new Label(this.pixi, {
        x: rect.x + rect.w / 2,
        y: rect.y + 20,
        size: TYPE.md,
        color: 0xffffff,
        anchorX: 0.5,
      });
      this.root.addChild(panel.root, gfx, key.root, name.root, cdText.root);
      this.slots.push({ panel, gfx, key, name, cdText, rect });
    }
    // 槽位数变化时重新居中：直接改每个 slot 的 x
    if (target !== this.slotCount) {
      this.slotCount = target;
      for (let i = 0; i < this.slots.length; i += 1) {
        const rect = skillSlotRect(i, target);
        const slot = this.slots[i];
        if (!slot) continue;
        const dx = rect.x - slot.rect.x;
        slot.rect = rect;
        slot.panel.set({ x: rect.x, y: rect.y, w: rect.w, h: rect.h });
        slot.gfx.x = dx;
        slot.key.root.x = rect.x + 5;
        slot.name.root.x = rect.x + rect.w / 2;
        slot.cdText.root.x = rect.x + rect.w / 2;
        // gfx 内部用的是绝对坐标，所以平移它
        slot.gfx.x = dx;
        slot.gfx.y = 0;
      }
    }
  }

  update(skills: readonly SkillSlotView[]): void {
    this.ensureSlots(skills.length);
    for (let i = 0; i < this.slots.length; i += 1) {
      const slot = this.slots[i];
      const view = skills[i];
      if (!slot) continue;

      if (!view) {
        slot.panel.set({ fill: 0x0a0a10, line: 0x2a2a34 });
        slot.gfx.clear();
        slot.key.set('');
        slot.name.set('');
        slot.cdText.set('');
        continue;
      }

      const filled = !view.usable;
      // 底色：可用时用技能自己的色（这里用语义色分类），不可用时压暗
      const baseColor = view.comboReady
        ? PALETTE.proc.base
        : view.offGcd
          ? PALETTE.iframe.base
          : PALETTE.energy.base;

      slot.panel.set({
        fill: filled ? 0x1a1a22 : baseColor,
        line: view.comboReady ? PALETTE.proc.bright : 0x6a6c80,
      });

      const g = slot.gfx;
      g.clear();
      const { x, y, w, h } = slot.rect;
      // 内层渐变（两段即可，够像素味）
      if (!filled) {
        g.rect(x + 3, y + 3, w - 6, h - 6).fill({ color: baseColor, alpha: 0.45 });
        g.rect(x + 3, y + 3, w - 6, 14).fill({ color: baseColor, alpha: 0.75 });
      }
      // 冷却遮罩：从顶部往下盖
      if (view.cooldownRatio > 0.001) {
        const cdH = Math.round((h - 4) * view.cooldownRatio);
        g.rect(x + 2, y + 2, w - 4, cdH).fill({ color: 0x06060a, alpha: 0.82 });
      }
      // 顶部高光
      g.rect(x, y, w, 2).fill(view.usable ? 0xffffff : 0x3a3a46);
      // 派生就绪的发光边框
      if (view.comboReady) {
        drawCorners(g, x - 3, y - 3, w + 6, h + 6, PALETTE.proc.bright, 8, 2);
      }

      slot.key.set(view.key.toUpperCase());
      slot.name.set(this.translate(view.nameKey));
      slot.cdText.set(view.cooldownRatio > 0.001 ? view.cooldownSec.toFixed(1) : '');
    }
  }
}

/* ------------------------------------------------------------------ *
 * Buff 条
 * ------------------------------------------------------------------ */

class BuffStripView {
  readonly root: Container;
  private readonly icons: Array<{
    panel: Panel;
    gfx: Graphics;
    glyph: Label;
    timer: Label;
    rect: { x: number; y: number; w: number; h: number };
  }> = [];

  constructor(
    pixi: PixiCtor,
    private readonly translate: TranslateFn,
  ) {
    this.root = new pixi.Container();
    for (let i = 0; i < LAYOUT.buffStrip.max; i += 1) {
      const rect = buffIconRect(i);
      const panel = new Panel(pixi, {
        x: rect.x,
        y: rect.y,
        w: rect.w,
        h: rect.h,
        fill: 0x101018,
        line: 0x505266,
        fillAlpha: 0.9,
      });
      const gfx = new pixi.Graphics();
      const glyph = new Label(pixi, {
        x: rect.x + rect.w / 2,
        y: rect.y + 8,
        size: TYPE.lg,
        color: 0xffffff,
        anchorX: 0.5,
      });
      const timer = new Label(pixi, {
        x: rect.x + rect.w / 2,
        y: rect.y + rect.h - 18,
        size: TYPE.xs,
        color: 0xd8d8e4,
        anchorX: 0.5,
      });
      this.root.addChild(panel.root, gfx, glyph.root, timer.root);
      this.icons.push({ panel, gfx, glyph, timer, rect });
    }
  }

  update(buffs: readonly BuffView[]): void {
    // 判定窗口类排前面（玩家最需要看到它）
    const sorted = [...buffs].sort((a, b) => Number(b.isDefensive) - Number(a.isDefensive));

    for (let i = 0; i < this.icons.length; i += 1) {
      const icon = this.icons[i];
      const view = sorted[i];
      if (!icon) continue;

      if (!view) {
        icon.panel.set({ fill: 0x101018, line: 0x2a2a34 });
        icon.gfx.clear();
        icon.glyph.set('');
        icon.timer.set('');
        continue;
      }

      const tight = isTightWindow(view);
      const lineColor = view.isDefensive
        ? tight
          ? PALETTE.iframe.bright
          : PALETTE.iframe.base
        : view.polarity === 'debuff'
          ? PALETTE.debuff.base
          : PALETTE.buff.base;

      icon.panel.set({
        fill: view.isDefensive ? 0x3a1010 : 0x101018,
        line: lineColor,
      });

      const g = icon.gfx;
      g.clear();
      const { x, y, w, h } = icon.rect;
      // 剩余时间条
      const dur = Number.isFinite(view.durationMs) && view.durationMs > 0 ? view.durationMs : 1;
      const frac = Number.isFinite(view.remainingMs)
        ? Math.min(1, Math.max(0, view.remainingMs / dur))
        : 1;
      if (frac < 1) {
        g.rect(x + 3, y + h - 6, Math.round((w - 6) * frac), 3).fill(lineColor);
      }
      if (view.stacks > 1) {
        g.rect(x + w - 14, y + 3, 11, 11).fill(0x000000);
        g.rect(x + w - 13, y + 4, 9, 9).fill(0x2a2a34);
      }

      icon.glyph.set(this.translate(view.nameKey).slice(0, 2));
      icon.glyph.setColor(lineColor);
      icon.timer.set(
        view.stacks > 1
          ? `x${view.stacks}`
          : Number.isFinite(view.remainingMs)
            ? `${(view.remainingMs / 1000).toFixed(1)}`
            : '',
      );
    }
  }
}

/* ------------------------------------------------------------------ *
 * 飘字
 * ------------------------------------------------------------------ */

interface FloatingItem {
  readonly label: Label;
  x: number;
  y: number;
  life: number;
}

class FloatingTextLayer {
  readonly root: Container;
  private readonly pool: FloatingItem[] = [];

  constructor(private readonly pixi: PixiCtor) {
    this.root = new pixi.Container();
  }

  update(items: BattleSnapshotView['floatingText']): void {
    // 池化：需要几个创建几个，多余隐藏（避免每帧 new Text）
    while (this.pool.length < items.length && this.pool.length < 32) {
      const label = new Label(this.pixi, { x: 0, y: 0, size: TYPE.lg, color: 0xffffff, anchorX: 0.5 });
      const item: FloatingItem = { label, x: 0, y: 0, life: 0 };
      this.root.addChild(label.root);
      this.pool.push(item);
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
      // life 从 1 → 0：向上飘并淡出
      slot.label.root.alpha = Math.min(1, view.life * 1.6);
      slot.label.root.scale.set(1 + (1 - view.life) * 0.15);
    }
  }
}

/* ------------------------------------------------------------------ *
 * 主场景
 * ------------------------------------------------------------------ */

export class BattleScene {
  readonly root: Container;
  private readonly background: Graphics;
  private readonly telegraph: TelegraphZone;
  private readonly boss: BossSprite;
  private readonly playerAnim: Graphics;
  private readonly hud: Container;

  private readonly bossPanel: Panel;
  private readonly bossName: Label;
  private readonly bossPhase: Label;
  private readonly bossHpBar: Bar;
  private readonly bossHpText: Label;

  private readonly castPanel: Panel;
  private readonly castName: Label;
  private readonly castHint: Label;
  private readonly castBar: Bar;

  private readonly playerPanel: Panel;
  private readonly playerName: Label;
  private readonly hpBar: Bar;
  private readonly mpBar: Bar;
  private readonly energyBar: Bar;
  private readonly furyBar: Bar;
  private readonly hpText: Label;
  private readonly mpLabel: Label;
  private readonly furyLabel: Label;
  private readonly energyLabel: Label;

  private readonly skillBar: SkillBarView;
  private readonly buffStrip: BuffStripView;
  private readonly floating: FloatingTextLayer;
  private readonly timerLabel: Label;
  private readonly statusLabel: Label;
  private readonly interruptPrompt: Label;

  /** 玩家受击闪白用的全屏遮罩 */
  private readonly flashOverlay: Graphics;

  constructor(private readonly options: BattleSceneOptions) {
    const { pixi, app, translate } = options;

    this.root = new pixi.Container();
    app.stage.addChild(this.root);

    /* ---- 背景与场地 ---- */
    this.background = new pixi.Graphics();
    drawBackground(this.background);
    this.root.addChild(this.background);

    this.telegraph = new TelegraphZone(pixi);
    this.root.addChild(this.telegraph.root);

    /* ---- Boss ---- */
    this.boss = new BossSprite(pixi, { x: 620, y: 392 });
    this.root.addChild(this.boss.root);

    /* ---- 玩家背影（简化为一个剪影，M7 再换成素材） ---- */
    this.playerAnim = new pixi.Graphics();
    this.drawPlayer(1);
    this.root.addChild(this.playerAnim);

    /* ---- 全屏闪光（受击 / 闪避成功） ---- */
    this.flashOverlay = new pixi.Graphics();
    this.flashOverlay.rect(0, 0, LOGICAL.width, LOGICAL.height).fill(0xffffff);
    this.flashOverlay.alpha = 0;
    this.root.addChild(this.flashOverlay);

    /* ---- HUD ---- */
    this.hud = new pixi.Container();
    this.root.addChild(this.hud);

    // Boss 面板
    this.bossPanel = new Panel(pixi, LAYOUT.bossFrame);
    this.bossName = new Label(pixi, { x: LAYOUT.bossFrame.x + 10, y: LAYOUT.bossFrame.y + 6, size: TYPE.md, color: PALETTE.text });
    this.bossPhase = new Label(pixi, { x: LAYOUT.bossFrame.x + 250, y: LAYOUT.bossFrame.y + 6, size: TYPE.sm, color: PALETTE.textDim });
    this.bossHpBar = new Bar(pixi, {
      x: LAYOUT.bossFrame.x + 10,
      y: LAYOUT.bossFrame.y + 26,
      w: LAYOUT.bossFrame.w - 200,
      h: 10,
      color: PALETTE.hp.base,
      darkColor: PALETTE.hp.dark,
      brightColor: PALETTE.hp.bright,
    });
    this.bossHpText = new Label(pixi, {
      x: LAYOUT.bossFrame.x + LAYOUT.bossFrame.w - 10,
      y: LAYOUT.bossFrame.y + 22,
      size: TYPE.sm,
      color: PALETTE.text,
      anchorX: 1,
    });
    this.hud.addChild(
      this.bossPanel.root,
      this.bossName.root,
      this.bossPhase.root,
      this.bossHpBar.root,
      this.bossHpText.root,
    );

    // 施法条 / 预警条
    this.castPanel = new Panel(pixi, {
      ...LAYOUT.castBar,
      fill: 0x2a0c0e,
      line: PALETTE.danger.base,
    });
    this.castName = new Label(pixi, { x: LAYOUT.castBar.x + 10, y: LAYOUT.castBar.y + 4, size: TYPE.md, color: PALETTE.danger.bright });
    this.castHint = new Label(pixi, {
      x: LAYOUT.castBar.x + LAYOUT.castBar.w - 10,
      y: LAYOUT.castBar.y + 4,
      size: TYPE.sm,
      color: 0xffd0b0,
      anchorX: 1,
    });
    this.castBar = new Bar(pixi, {
      x: LAYOUT.castBar.x + 10,
      y: LAYOUT.castBar.y + 22,
      w: LAYOUT.castBar.w - 20,
      h: 8,
      color: 0xecb03c,
      darkColor: 0x4a2a10,
      brightColor: 0xffd870,
    });
    this.castPanel.root.visible = false;
    this.castName.root.visible = false;
    this.castHint.root.visible = false;
    this.castBar.root.visible = false;
    this.hud.addChild(this.castPanel.root, this.castName.root, this.castHint.root, this.castBar.root);

    // 玩家面板
    this.playerPanel = new Panel(pixi, LAYOUT.playerFrame);
    const pf = LAYOUT.playerFrame;
    this.playerName = new Label(pixi, { x: pf.x + 8, y: pf.y + 4, size: TYPE.md, color: PALETTE.text });
    // 生命条：整宽，数值右对齐（用 xs 字号避免超出面板）
    this.hpBar = new Bar(pixi, { x: pf.x + 8, y: pf.y + 24, w: pf.w - 16, h: 14, color: PALETTE.hp.base, darkColor: PALETTE.hp.dark, brightColor: PALETTE.hp.bright });
    this.hpText = new Label(pixi, {
      x: pf.x + pf.w - 10,
      y: pf.y + 25,
      size: TYPE.xs,
      color: 0xffffff,
      anchorX: 1,
    });
    // 下排两个：魔力 / 储能。能量单独一行（它与 GCD 节奏直接相关，值得独立）
    const halfW = Math.round((pf.w - 20) / 2);
    this.mpBar = new Bar(pixi, { x: pf.x + 8, y: pf.y + 44, w: halfW, h: 12, color: PALETTE.mp.base, darkColor: PALETTE.mp.dark, brightColor: PALETTE.mp.bright });
    this.furyBar = new Bar(pixi, { x: pf.x + 12 + halfW, y: pf.y + 44, w: halfW, h: 12, color: PALETTE.fury.base, darkColor: PALETTE.fury.dark, brightColor: PALETTE.fury.bright });
    this.energyBar = new Bar(pixi, { x: pf.x + 8, y: pf.y + 64, w: pf.w - 16, h: 12, color: PALETTE.energy.base, darkColor: PALETTE.energy.dark, brightColor: PALETTE.energy.bright });

    // 资源条上的小标签（中文 >= 16，所以用 sm）
    this.mpLabel = new Label(pixi, { x: pf.x + 12, y: pf.y + 44, size: TYPE.sm, color: 0xffffff });
    this.furyLabel = new Label(pixi, { x: pf.x + 16 + halfW, y: pf.y + 44, size: TYPE.sm, color: 0xffffff });
    this.energyLabel = new Label(pixi, { x: pf.x + 12, y: pf.y + 64, size: TYPE.sm, color: 0xffffff });
    this.hud.addChild(
      this.playerPanel.root,
      this.playerName.root,
      this.hpBar.root,
      this.hpText.root,
      this.mpBar.root,
      this.furyBar.root,
      this.energyBar.root,
      this.mpLabel.root,
      this.furyLabel.root,
      this.energyLabel.root,
    );

    // 技能栏 / buff 条 / 飘字
    this.skillBar = new SkillBarView(pixi, translate);
    this.hud.addChild(this.skillBar.root);
    this.buffStrip = new BuffStripView(pixi, translate);
    this.hud.addChild(this.buffStrip.root);
    this.floating = new FloatingTextLayer(pixi);
    this.hud.addChild(this.floating.root);

    // 计时与状态
    this.timerLabel = new Label(pixi, {
      x: LAYOUT.bossFrame.x + LAYOUT.bossFrame.w - 10,
      y: LAYOUT.bossFrame.y + 4,
      size: TYPE.lg,
      color: 0xf0c060,
      anchorX: 1,
    });
    this.hud.addChild(this.timerLabel.root);

    this.statusLabel = new Label(pixi, {
      x: LAYOUT.statusFlash.x,
      y: LAYOUT.statusFlash.y,
      size: TYPE.xl,
      color: 0xffffff,
      anchorX: 0.5,
    });
    this.hud.addChild(this.statusLabel.root);

    this.interruptPrompt = new Label(pixi, {
      x: LAYOUT.statusFlash.x,
      y: LAYOUT.statusFlash.y + 36,
      size: TYPE.md,
      color: PALETTE.interrupt.bright,
      anchorX: 0.5,
    });
    this.hud.addChild(this.interruptPrompt.root);
  }

  /** 玩家背影剪影。`pose`：1 = 正常，0.85 = 闪避下沉。 */
  private drawPlayer(pose: number): void {
    const g = this.playerAnim;
    const P = PALETTE;
    const cx = 300;
    // 脚底站在地面线上；闪避时整体下沉 14px（表现"闪开"）
    const base = 470 + (1 - pose) * 14;
    g.clear();

    // 斗篷
    const h = 92 * pose;
    // 斗篷主体（梯形）
    g.poly([cx - 62, base, cx - 34, base - h, cx + 34, base - h, cx + 62, base, cx + 38, base, cx - 38, base]);
    g.fill(P.playerCloak);
    // 左侧暗部（光源在右上）
    g.poly([cx - 62, base, cx - 34, base - h, cx - 8, base - h, cx - 14, base]);
    g.fill(P.playerCloakDark);
    // 肩甲
    g.poly([cx - 60, base, cx - 33, base - h - 4, cx - 16, base - h + 6, cx - 41, base]);
    g.fill(P.playerCloakLight);
    g.poly([cx + 60, base, cx + 33, base - h - 4, cx + 16, base - h + 6, cx + 41, base]);
    g.fill(P.playerCloakLight);
    // 后脑
    g.ellipse(cx, base - h - 16, 18, 19).fill(0x1a2036);
    g.ellipse(cx, base - h - 15, 15, 16).fill(0x2a3450);
    // 武器（斜向右上）
    g.poly([cx + 44, base - 6, cx + 78, base - 100, cx + 88, base - 96, cx + 54, base + 4]);
    g.fill(0x8a90a0);
    g.poly([cx + 48, base - 9, cx + 75, base - 95, cx + 81, base - 92, cx + 53, base + 1]);
    g.fill(0xb8bcc8);
    g.rect(cx + 38, base - 12, 20, 13).fill(0xa8863c);
  }

  /**
   * 每帧更新。
   *
   * @param view 只读快照
   * @param alpha 插值系数（渲染平滑用）
   */
  update(view: BattleSnapshotView, alpha = 0): void {
    const { translate } = this.options;

    /* ---- Boss ---- */
    this.boss.update(view.telegraphing, view.bossFlash);

    // Boss 名与阶段
    this.bossName.set(translate(view.boss.nameKey));
    this.bossPhase.set(
      view.enraged
        ? `${translate('hud.phase')} ${view.phase}  ·  ${translate('event.enrage')}`
        : `${translate('hud.phase')} ${view.phase}`,
    );
    this.bossPhase.setColor(view.enraged ? PALETTE.danger.bright : PALETTE.textDim);
    this.bossHpBar.update(ratioOf(view.boss.hp));
    this.bossHpText.set(`${Math.round(view.boss.hp.current)} / ${Math.round(view.boss.hp.cap)}`);

    // 计时
    this.timerLabel.set(view.remainingMs === undefined ? '' : formatClockSafe(view.remainingMs));
    this.timerLabel.setColor(
      view.remainingMs !== undefined && view.remainingMs < 30_000 ? PALETTE.danger.bright : 0xf0c060,
    );

    /* ---- 预警条 ---- */
    const cast = view.boss.cast;
    const hasCast = cast !== undefined || view.telegraphing;
    this.castPanel.root.visible = hasCast;
    this.castName.root.visible = hasCast;
    this.castHint.root.visible = hasCast;
    this.castBar.root.visible = hasCast;

    if (cast) {
      this.castName.set(translate(cast.nameKey));
      // 提示由 key + 秒数拼成：翻译在 UI 层做，view-model 只给 key
      const hint = telegraphHint(cast);
      this.castHint.set(hint ? `${hint.seconds}s  ·  ${translate(hint.key)}` : '');
      this.castBar.update(cast.progress);
    } else if (view.telegraphing) {
      this.castName.set(translate('hud.casting'));
      this.castHint.set(translate('hint.dodgeOrGuard'));
      this.castBar.update(0.5);
    }
    this.telegraph.update(hasCast, cast?.progress ?? 0.5);

    /* ---- 玩家 ---- */
    // 闪避时下沉（用"有无无敌 buff"判断）
    const dodging = view.player.buffs.some((b) => b.id === 'dodge-iframe' && b.remainingMs > 0);
    const guarding = view.player.buffs.some((b) => b.id.startsWith('guard') && b.remainingMs > 0);
    this.playerAnim.visible = true;
    if (dodging || guarding) {
      if (this.lastPlayerPose !== 0.85) {
        this.lastPlayerPose = 0.85;
        this.drawPlayer(0.85);
      }
      this.playerAnim.tint = dodging ? 0x9ad8ff : 0xc8d0e8;
    } else {
      if (this.lastPlayerPose !== 1) {
        this.lastPlayerPose = 1;
        this.drawPlayer(1);
      }
      this.playerAnim.tint = 0xffffff;
    }
    void alpha;

    this.playerName.set(translate(view.player.nameKey));
    this.hpBar.update(ratioOf(view.player.hp));
    this.hpText.set(`${Math.round(view.player.hp.current)}/${Math.round(view.player.hp.cap)}`);
    this.mpBar.update(ratioOf(view.player.mp));
    this.furyBar.update(ratioOf(view.player.fury));
    this.energyBar.update(ratioOf(view.player.energy));
    this.mpLabel.set(translate('resource.mp'));
    this.furyLabel.set(translate('resource.fury'));
    this.energyLabel.set(translate('resource.energy'));

    /* ---- 技能栏与 buff ---- */
    this.skillBar.update(view.skills);
    this.buffStrip.update(view.player.buffs);

    /* ---- 飘字 ---- */
    this.floating.update(view.floatingText);

    /* ---- 状态提示 ---- */
    this.statusLabel.set(view.statusLine ?? '');
    this.statusLabel.root.visible = (view.statusLine ?? '') !== '';

    // 可打断提示：Boss 正在读可打断的技能时，告诉玩家"现在能打断"
    const interruptible = cast?.interruptible === true;
    this.interruptPrompt.set(interruptible ? translate('hint.interruptible') : '');
    this.interruptPrompt.root.visible = interruptible;

    /* ---- 全屏闪光 ---- */
    this.flashOverlay.alpha = Math.min(0.35, view.playerFlash * 0.35);
  }

  private lastPlayerPose = 1;
}

/** 本地包装，避免把 viewModel 的 formatClock 依赖带进来（渲染层只依赖类型）。 */
function formatClockSafe(ms: number): string {
  if (!Number.isFinite(ms)) return '--:--';
  const total = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(total / 60)}:${(total % 60).toString().padStart(2, '0')}`;
}

/** 颜色线性混合（像素画里用色带模拟渐变）。 */
function mixColor(a: number, b: number, t: number): number {
  const ar = (a >> 16) & 0xff;
  const ag = (a >> 8) & 0xff;
  const ab = a & 0xff;
  const br = (b >> 16) & 0xff;
  const bg = (b >> 8) & 0xff;
  const bb = b & 0xff;
  const r = Math.round(ar + (br - ar) * t);
  const g = Math.round(ag + (bg - ag) * t);
  const bl = Math.round(ab + (bb - ab) * t);
  return (r << 16) | (g << 8) | bl;
}

/** 未使用但保留：技能格悬停色之类的扩展点。 */
export const _unused = css;
export type { CombatantView };
