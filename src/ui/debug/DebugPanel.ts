import { Container, Graphics, Text } from 'pixi.js';

/**
 * 调试面板（M0-7）。
 *
 * **用 canvas 画，不是 DOM** —— 这是"UI 全部走 canvas、零 DOM"
 * 这条约束的第一个实践点。以后移植到小游戏平台时这一层能整体搬走。
 *
 * 性能注意：`Pixi.Text` 改 `text` 会重建内部纹理，所以每行文本节点
 * **只在实际值变化时**才赋值，不是每帧无条件写。
 */

export interface DebugValues {
  /** 模拟 tick 数 */
  readonly tick: number;
  /** 本帧推进的步数 */
  readonly steps: number;
  /** 插值系数 */
  readonly alpha: number;
  /** 累计被丢弃的真实时间（ms） */
  readonly droppedMs: number;
  /** 渲染帧率 */
  readonly fps: number;
  /** 当前缩放倍率 */
  readonly scale: number;
  /** 是否跑在 worker 里 */
  readonly usingWorker: boolean;
  /** 最近一次全量快照的 tick（-1 表示还没有） */
  readonly snapshotTick: number;
}

const PANEL_X = 12;
const PANEL_Y = 12;
const PANEL_W = 268;
const LINE_H = 18;
const PADDING = 10;

const FIELDS = [
  'fps',
  'tick',
  'snapshotTick',
  'steps',
  'alpha',
  'droppedMs',
  'scale',
  'thread',
] as const;

type FieldName = (typeof FIELDS)[number];

/** 格式化成显示字符串。放在这里而不是 update 里，便于单测。 */
export function formatDebugValue(field: FieldName, v: DebugValues): string {
  switch (field) {
    case 'fps':
      return v.fps.toFixed(0);
    case 'tick':
      return String(v.tick);
    case 'snapshotTick':
      return v.snapshotTick < 0 ? '--' : String(v.snapshotTick);
    case 'steps':
      return String(v.steps);
    case 'alpha':
      return v.alpha.toFixed(2);
    case 'droppedMs':
      return v.droppedMs > 0 ? `${v.droppedMs.toFixed(0)}` : '0';
    case 'scale':
      return `${v.scale.toFixed(2)}x`;
    case 'thread':
      return v.usingWorker ? 'worker' : 'main';
  }
}

export class DebugPanel {
  readonly root: Container;
  private readonly valueTexts = new Map<FieldName, Text>();
  /** 上一帧的显示值，用于跳过无变化的赋值 */
  private readonly lastShown = new Map<FieldName, string>();

  constructor() {
    this.root = new Container();
    this.root.x = PANEL_X;
    this.root.y = PANEL_Y;

    const height = PADDING * 2 + FIELDS.length * LINE_H;
    const bg = new Graphics()
      .roundRect(0, 0, PANEL_W, height, 3)
      .fill({ color: 0x11121b, alpha: 0.85 })
      .roundRect(0, 0, PANEL_W, height, 3)
      .stroke({ color: 0x505266, width: 1 });
    this.root.addChild(bg);

    FIELDS.forEach((field, i) => {
      const y = PADDING + i * LINE_H;

      const label = new Text({
        text: field,
        style: { fontFamily: 'monospace', fontSize: 14, fill: 0x8c8c9e },
      });
      label.x = PADDING;
      label.y = y;

      const value = new Text({
        text: '',
        style: { fontFamily: 'monospace', fontSize: 14, fill: 0xf0f0f6 },
      });
      value.x = PANEL_W - PADDING;
      value.y = y;
      value.anchor.x = 1;

      this.root.addChild(label, value);
      this.valueTexts.set(field, value);
    });
  }

  update(values: DebugValues): void {
    for (const field of FIELDS) {
      const shown = formatDebugValue(field, values);
      // 只在显示值真变化时写 text，避免每帧重建纹理
      if (this.lastShown.get(field) === shown) continue;
      this.lastShown.set(field, shown);
      const node = this.valueTexts.get(field);
      if (node) node.text = shown;
    }
  }
}
