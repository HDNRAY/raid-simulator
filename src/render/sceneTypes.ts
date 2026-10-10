/**
 * 渲染层的**共享类型**。
 *
 * 拆出来的原因：`IconStrip` / `SkillBarView` / 顶栏等绘制模块都要
 * `TranslateFn`，如果各自从 `BattleScene.ts` 里 import，就会形成
 * "子模块反向依赖主模块"的环。类型单独一个文件，大家都向下依赖它。
 */

import type { Application } from 'pixi.js';
import type { PixiCtor } from '../ui/primitives';

/**
 * 取词函数。
 *
 * `params` 是插值参数（模板里的 `{name}`）—— 日志条目带 `{amount}`
 * 这类占位符，所以渲染层需要能把参数一起传下去。
 */
export type TranslateFn = (
  key: string,
  params?: Readonly<Record<string, string | number>>,
) => string;

export interface BattleSceneOptions {
  readonly app: Application;
  readonly pixi: PixiCtor;
  readonly translate: TranslateFn;
}

export interface BattleSceneOptions {
  readonly app: Application;
  readonly pixi: PixiCtor;
  readonly translate: TranslateFn;
}

/* ================================================================== *
 * 帧更新：注册机制
 * ================================================================== */

/**
 * 每次帧更新的**上下文**（一帧的全部输入）。
 *
 * 部件只读它 —— 这是"数据流单向"在渲染层的落点：部件不持有 sim，
 * 也不能反过来调用它。
 */
export interface FrameContext {
  /** 本帧要画的战斗快照 */
  readonly view: import('./viewModel').BattleSnapshotView;
  /** 战斗日志的条目（右侧面板用） */
  readonly logEntries: readonly import('../app/logFormat').LogEntry[];
  /** 取词函数 */
  readonly translate: TranslateFn;
  /** 当前 UI 缩放系数 */
  readonly uiScale: number;
  /**
   * 是否显示**键盘快捷键提示**。
   *
   * 需求："移动端就不用显示快捷键信息了，无论是技能按钮还是其他的
   * 功能按钮，包括 'enter' 再来一次也改成点击屏幕再来一次之类的。"
   *
   * ⚠️ 与 `uiScale` 一样放进**每帧的上下文**，而不是构造参数：
   * 它是一个"当前该不该画键名"的开关，放这里将来还能做运行时切换
   * （例如玩家插了键盘）。来源是 `render/platform.ts` 的能力探测。
   */
  readonly showKeyHints: boolean;
}

/**
 * 一个**每帧更新的 UI 部件**。
 *
 * ==================================================================
 * 为什么是"注册"而不是"由场景逐个调用"
 * ==================================================================
 *
 * 需求："tick 对 ui 的更新，应该是注册机制，ui 的各个部分注册在 tick 上，
 * tick 直接通知大家就好了，而不是 tick 主动 update 其他所有地方。"
 *
 * 原先 `BattleScene.update()` 是一个 **202 行的顺序调用清单**：
 * 顶栏、预警条、玩家面板、技能栏、飘字、结算…每加一个部件就要改它。
 * 后果是"场景"同时知道**每个部件内部需要哪些字段**
 * （`bossHpBar.update(ratioOf(view.boss.hp))` 这种），
 * 部件之间没有边界。
 *
 * 现在改成：部件自己声明"我每帧要画什么"，注册到 `FrameRegistry`
 * 上；场景只负责**广播**这一帧的上下文。场景不再知道任何部件的内部。
 *
 * 顺序仍然确定（`FrameRegistry` 保序）—— UI 的层叠是有语义的，
 * 不能变成无序的 set。
 */
export interface FramePart {
  /** 部件名，仅用于调试与"注册了什么"的自省 */
  readonly name: string;
  /** 画这一帧。返回 void，不许改上下文。 */
  render(ctx: FrameContext): void;
}

/**
 * 部件注册表 —— 保序，按注册顺序广播。
 *
 * 保序的理由：UI 有层叠语义（飘字要盖在面板上、结算要盖在所有东西上），
 * 所以"谁先注册谁先画"必须是确定的，不能依赖对象键的顺序。
 */
export class FrameRegistry {
  private readonly parts: FramePart[] = [];

  /** 注册一个部件（幂等：同名只保留第一次注册的）。 */
  add(part: FramePart): void {
    if (this.parts.some((p) => p.name === part.name)) return;
    this.parts.push(part);
  }

  /** 广播一帧。**只在这里调用部件的 render** —— 场景自己不做循环。 */
  notify(ctx: FrameContext): void {
    for (const part of this.parts) part.render(ctx);
  }

  /** 已注册的部件名（测试与调试用）。 */
  names(): readonly string[] {
    return this.parts.map((p) => p.name);
  }
}
