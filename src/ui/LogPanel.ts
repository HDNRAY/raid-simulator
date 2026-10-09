/**
 * 战斗日志面板（屏幕右侧）。
 *
 * ==================================================================
 * 它在分层里的位置
 * ==================================================================
 *
 *   引擎 EventDef[] → `app/logFormat.ts`（纯函数）→ LogEntry[]
 *     → **本文件**（只负责取词 + 画）
 *
 * 所以这里**没有任何"哪些事件值得记"的判断** —— 那是格式化层的事。
 * 本文件只做三件：
 *   1. 把 `entry.key` 翻成文案（i18n 规范 I1：文案不进日志数据）
 *   2. 按类别配色
 *   3. 把最近 N 条画成一列，旧的往上淡出
 *
 * ==================================================================
 * 为什么不做成可滚动的完整列表
 * ==================================================================
 *
 * 这是**战斗中的实时面板**，不是复盘工具。玩家在打的时候只有余光，
 * 能读的只有最近 3-4 行。做滚动/翻页会引入焦点、键盘占用、
 * 与战斗输入冲突等一堆问题，而收益（战斗中翻日志）几乎为零。
 * 复盘应该由"把日志导出成文本"来做 —— 那是格式化层的另一个消费者，
 * 不需要动渲染层（这正是分层的价值）。
 */

import type { Container } from 'pixi.js';
import type { LogEntry } from '../app/logFormat';
import { FONT, LAYOUT, LOGICAL } from './layout';
import { Label, PANEL_STYLE, Panel, type PixiCtor } from './primitives';
import { PALETTE } from '../render/theme';

export interface LogPanelOptions {
  readonly pixi: PixiCtor;
  readonly translate: (key: string, params?: Readonly<Record<string, string | number>>) => string;
}

/**
 * 每行的高度（逻辑像素）。
 *
 * 需求："行间距小一点"。16 → **13**，行间空隙 2 → **1**。
 * 每行占高从 18 降到 14，10 行省下 40px —— 面板也跟着变矮。
 * 13px 的行高配 `FONT.tiny`(11) 仍然放得下，不会挤。
 */
const LINE_H = 13;
/** 最多显示几行 —— 再多战斗中就来不及读了（见文件头说明）。 */
const VISIBLE_LINES = 10;
/** 行与行之间的间距 */
const LINE_GAP = 1;

/**
 * 类别 → 颜色。
 *
 * 与其它 UI 用的是**同一套色**（红=伤害、青=闪避、金=打断），
 * 于是日志和画面上的飘字/读条是同一个语言。
 */
const CATEGORY_COLORS: Readonly<Record<LogEntry['category'], number>> = {
  deal: 0xffd08a,
  take: PALETTE.danger.bright,
  avoid: PALETTE.iframe.bright,
  interrupt: PALETTE.douqi.bright,
  cast: PALETTE.textDim,
  resource: PALETTE.buff.bright,
  system: PALETTE.text,
};

export class LogPanel {
  readonly root: Container;

  private readonly panel: Panel;
  private readonly title: Label;
  private readonly lines: Label[] = [];
  /** 上一次画的文本，用来跳过无变化的 set（Label.set 内部也有缓存） */
  private lastSignature = '';

  constructor(private readonly options: LogPanelOptions) {
    const { pixi } = options;
    const r = LAYOUT.log;
    this.root = new pixi.Container();

    // 与玩家资源面板**同一套外观**（见 `PANEL_STYLE` 的说明）
    this.panel = new Panel(pixi, {
      x: r.x,
      y: r.y,
      w: r.w,
      h: r.h,
      ...PANEL_STYLE,
    });
    this.root.addChild(this.panel.root);

    this.title = new Label(pixi, {
      x: r.x + 8,
      y: r.y + 5,
      size: FONT.tiny,
      color: PALETTE.textDim,
    });
    this.title.set(options.translate('log.title'));
    this.root.addChild(this.title.root);

    /**
     * 行标签**一次性建满**，之后只改文本。
     *
     * 不用"按需创建/销毁"：日志每几帧就变一次，反复 new Text
     * 会产生大量纹理垃圾（Pixi 的 Text 是每次改字都重新光栅化的）。
     */
    for (let i = 0; i < VISIBLE_LINES; i += 1) {
      const label = new Label(pixi, {
        x: r.x + 8,
        // 从下往上排：最新的一条在最下面（贴近"正在发生"的位置感）
        y: r.y + r.h - 8 - (i + 1) * (LINE_H + LINE_GAP) + LINE_GAP,
        size: FONT.tiny,
        color: PALETTE.textDim,
      });
      this.lines.push(label);
      this.root.addChild(label.root);
    }
  }

  /**
   * 重画。
   *
   * `entries` 是格式化层的全部条目（可能很长）；这里只取**最后
   * `VISIBLE_LINES` 条**，并让**越旧越暗** —— 不用动画，靠透明度
   * 表达"这条正在变旧"，既便宜又不会让画面动个不停。
   */
  update(entries: readonly LogEntry[]): void {
    const visible = entries.slice(-VISIBLE_LINES);
    // 内容没变就整段跳过（每帧调用的东西，能省则省）
    const signature = visible.map((e) => `${e.id}:${e.category}`).join(',');
    if (signature === this.lastSignature) return;
    this.lastSignature = signature;

    for (let i = 0; i < this.lines.length; i += 1) {
      const label = this.lines[i];
      if (!label) continue;
      // lines[0] 是**最下面**那一行 → 对应最新的一条
      const entry = visible[visible.length - 1 - i];
      if (!entry) {
        label.set('');
        continue;
      }
      label.set(this.options.translate(entry.key, entry.params));
      label.setColor(CATEGORY_COLORS[entry.category]);
      // 越旧越暗：最旧的一行约 0.45
      label.root.alpha = 1 - (i / Math.max(1, visible.length - 1)) * 0.55;
    }
  }

  /**
   * 改几何与行距（UI 缩放时用）。
   *
   * 行标签是**一次性建满**的（避免反复 new Text），所以缩放时不能
   * 重建，只能改它们的坐标、字号与面板矩形。行距同样按系数走 ——
   * 只放大框不放大行距，十行会挤在面板顶部。
   */
  setUiScale(scale: number, rect: { readonly x: number; readonly y: number; readonly w: number; readonly h: number }): void {
    this.panel.set({ x: rect.x, y: rect.y, w: rect.w, h: rect.h });
    this.title.root.x = rect.x + Math.round(8 * scale);
    this.title.root.y = rect.y + Math.round(5 * scale);
    this.title.setSize(Math.max(1, Math.round(FONT.tiny * scale)));
    const lineH = Math.max(1, Math.round(LINE_H * scale));
    const lineGap = Math.max(1, Math.round(LINE_GAP * scale));
    const lineSize = Math.max(1, Math.round(FONT.tiny * scale));
    for (let i = 0; i < this.lines.length; i += 1) {
      const label = this.lines[i];
      if (!label) continue;
      label.root.x = rect.x + Math.round(8 * scale);
      label.root.y = rect.y + rect.h - Math.round(8 * scale) - (i + 1) * (lineH + lineGap) + lineGap;
      label.setSize(lineSize);
    }
    // 内容没变，但坐标变了 —— 强制下一帧重排一次
    this.lastSignature = '';
  }

  /** 面板整体显隐（结算后可留在屏幕上供复盘）。 */
  set visible(v: boolean) {
    this.root.visible = v;
  }

  get visible(): boolean {
    return this.root.visible;
  }
}

/** 供布局测试引用：面板占据的矩形。 */
export const LOG_PANEL_RECT = LAYOUT.log;
/** 供测试断言"行数与面板高度一致"。 */
export const LOG_PANEL_METRICS = { LINE_H, LINE_GAP, VISIBLE_LINES } as const;
/** 供测试断言面板没有超出画布右边界。 */
export const LOG_PANEL_RIGHT = LAYOUT.log.x + LAYOUT.log.w;
export const CANVAS_WIDTH = LOGICAL.width;
