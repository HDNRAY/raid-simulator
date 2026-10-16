/**
 * **肉鸽两个"只读"屏幕要显示的内容**（2026-10-16）。
 *
 * ==================================================================
 * 为什么从 `phaseFlow.ts` 搬出来
 * ==================================================================
 *
 * `phaseFlow.ts` 撞到 700 行上限（`AGENTS.md` §3）。规则里给的次序是
 * **先拆 util 方法**、横向切割，最后才是问人 —— 而这两块正好是纯读取：
 * 输入是 `RunState`，输出是界面要的形状，**不碰任何状态**，也不属于
 * "相位流转"那个职责（那个文件的名字就叫 phaseFlow）。
 *
 * ⚠️ 内容**逐字搬**（连注释），只把 `runSession` 从闭包变量换成入参。
 */

import { BOSS_ROSTER, findEntry } from '../data/roster';
import { qijiById } from '../data/qiji';
import { runLengthOf } from '../core/run/index';
import { whisperForRun } from './whisperApply';

/** 只需要这两条能力 —— 不 import `RunSession` 的整个形状（更窄更好测）。 */
export interface RunConfirmArgs {
  readonly runSession: {
    state(): import('../core/run/index').RunState | undefined;
    bossId(): string | undefined;
  };
}

/** 确认屏那三行（炁机 / 对手 / 恶魔低语）+ 进度。 */
export interface RunConfirmInfo {
  readonly position: number;
  readonly length: number;
  readonly boss: { readonly id: string; readonly nameKey: string };
  readonly qiji: readonly { readonly id: string; readonly nameKey: string }[];
  readonly whisper:
    | { readonly id: string; readonly nameKey: string; readonly descKey: string }
    | undefined;
}

  /**
   * **确认屏要显示的内容**（2026-10-15）—— 纯读取，不改任何状态。
   *
   * ⚠️ `position` / `length` 与 `runSummary` 同一条口径（夹回 `1..length`）：
   * `RunState.position` 在"通关"那一刻是 `len + 1`（见 `core/run/lifecycle.ts`），
   * 虽然确认屏只在**一局还没结束时**出现，但这一层不该指望"调用点保证它
   * 没结束" —— 夹一次的成本是零，而漏一次会显示"第 3 / 2 场"。
   */
export function runConfirmInfoOf(args: RunConfirmArgs): RunConfirmInfo {
  const run = args.runSession.state();
  /**
   * ⚠️ 没有进行中的一局 / 这一场没有对手：给一份**能读的**零值，而不是崩
   * （对手那一行的名字用空串 —— 界面拿到的名字 key 取不到时会落回 id，
   * 见 `data/roster.ts` 的兜底口径）。
   */
  const bossId = run === undefined ? undefined : args.runSession.bossId();
  const bossEntry = bossId === undefined ? undefined : findEntry(BOSS_ROSTER, bossId);
  const boss = { id: bossId ?? '', nameKey: bossEntry?.nameKey ?? bossId ?? '' };
  if (run === undefined) return { position: 0, length: 0, boss, qiji: [], whisper: undefined };

  const length = runLengthOf(run);
  const position = Math.min(Math.max(run.position, 1), Math.max(length, 1));
  /**
   * ⚠️ 炁机那一行给的是**本局已选的全部**（`RunState.chosen`，按选的先后）
   * —— 块头照实写"已激活 N 条：A、B"（与备战屏**同一个** `foldSummaryOf`），
   * 而右侧详情画**最后一条**（见 `ui/prepareDetail.runConfirmDetailTarget`）。
   * 第一场之前 `chosen` 是空的 → 空数组（界面**整行不画**）。
   */
  const qiji = run.chosen.flatMap((choice) => {
    /** ⚠️ 走 `qijiById`（内容表自己的 id→定义 查找）—— 与 `activeQiji()` 同一处口径。 */
    const def = qijiById(choice.qijiId);
    return def === undefined ? [] : [{ id: def.id, nameKey: def.nameKey ?? def.id }];
  });
  /**
   * `whisperForRun` 与**开战那一侧**（`app/battleSetup.ts`）共用同一个
   * 纯函数 —— 所以"屏上写的那条"与"真的挂上去的那条"在结构上是同一个
   * 答案，不会各算一遍。
   */
  const drawn = whisperForRun(run);
  const whisper =
    drawn === undefined
      ? undefined
      : { id: drawn.id, nameKey: drawn.nameKey, descKey: drawn.descKey };
  return { position, length, boss, qiji, whisper };
  };
