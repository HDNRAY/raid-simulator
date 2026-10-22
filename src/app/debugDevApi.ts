/**
 * **开发模式才挂的那几个调试入口**（2026-10-23）。
 *
 * 目前两个：
 *
 * | 方法 | 用途 |
 * |---|---|
 * | `gotoPrepare()` | 切到备战屏并**停住**（`pick()` 会一路 advance，拍不到那一屏） |
 * | `logLines(n?)` | 读最近 n 条**战斗日志的文本**（与面板同一份格式化） |
 *
 * ==================================================================
 * 为什么单独一个文件
 * ==================================================================
 *
 * `game.ts` 顶在 AGENTS §3 的 700 行上限上 —— 这两个入口的闭包在内联时
 * 要占七八行（`...spread` + 两个箭头函数 + 注释）。搬出来之后装配那边只剩
 * 一行，而且"开发模式才有的东西"集中在一处，删起来也不会漏。
 *
 * ⚠️ **调用方仍然要自己判门**（`DEV_MODE || url.dev`）：这个函数只负责
 * "造出这几个方法"，不负责"该不该挂" —— 判据必须留在装配处（那是唯一
 * 知道当前是不是开发模式的地方）。
 */

import type { LogEntry } from './logFormat';
import { logLineTexts } from '../ui/logReview';
import { translateSafe } from './translate';

export interface DevOnlyApiDeps {
  /** 切相位（用既有的 `switchTo`，不要在这里造第二套流程）。 */
  readonly switchTo: (phase: 'prepare') => void;
  /**
   * 取当前战斗循环的日志条目。
   *
   * ⚠️ 传**取值函数**而不是数组：日志每条都会变，捕一份快照就永远读到旧的那批。
   */
  readonly loopOf: () => { readonly logEntries: readonly LogEntry[] } | undefined;
}

/** 造出"只在开发模式可见"的那几个调试入口。 */
export function devOnlyApi(d: DevOnlyApiDeps): {
  readonly gotoPrepare: () => void;
  readonly logLines: (n?: number) => readonly string[];
} {
  return {
    gotoPrepare: () => d.switchTo('prepare'),
    logLines: (n?: number) => logLineTexts(d.loopOf()?.logEntries ?? [], translateSafe, n),
  };
}
