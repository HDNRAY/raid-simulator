/**
 * **调试探针**：把战斗状态摊平成一份可读快照。
 *
 * ==================================================================
 * 为什么单独一个文件
 * ==================================================================
 *
 * `main.ts` 是"装配流水账"，而这段**不属于装配** —— 它是一份纯数据投影，
 * 被端到端脚本与调试面板读取。抽出来有两个好处：
 *   - `main.ts` 少一坨（它长期贴着 700 行上限）
 *   - 投影逻辑可单独演进（加字段不用动装配代码）
 *
 * ⚠️ 它是**只读**的：不许在这里改引擎状态。任何"为了让探针好看"而写回的
 * 值都会让端到端脚本测量到被自己污染的状态。
 */

import type { BattleEngine } from '../core/combat/battleState';

/** 探针输出。字段名即端到端脚本读的名字。 */
export interface ProbeSnapshot {
  readonly tick: number;
  readonly status: string;
  readonly playerHp: number;
  readonly playerHpCap: number;
  readonly playerDouqi: number;
  readonly playerCooldowns: Readonly<Record<string, number>>;
  readonly playerCasts: number;
  readonly bossHp: number;
  readonly bossHpCap: number;
  readonly bossCasts: number;
  readonly skillCount: number;
  readonly floatingCount: number;
  readonly frameCount: number;
  readonly errors: string[];
}

/**
 * 摊平当前战斗状态。
 *
 * ⚠️ 缺角色时给 `-1` 而不是 `0`：`0` 会被读成"这个角色血是 0"（等于死了），
 * 而 `-1` 明确表示"没有这个角色" —— 端到端脚本靠这个区分断言失败的原因。
 */
export function buildProbe(
  engine: BattleEngine,
  /** 视图层的一帧快照（技能格数与飘字数只能从它拿）。 */
  view: { readonly skills: readonly unknown[]; readonly floatingText: readonly unknown[] },
  frameCount: number,
  runtimeErrors: readonly string[],
): ProbeSnapshot {
  const state = engine.snapshot;
  const player = state.combatants.find((c) => c.side === 'ally');
  const boss = state.combatants.find((c) => c.side === 'enemy');
  return {
    tick: state.tick,
    status: state.status,
    playerHp: player?.resources.hp ?? -1,
    playerHpCap: player?.caps.hp ?? -1,
    playerDouqi: player?.resources.douqi ?? -1,
    playerCooldowns: player?.cooldowns ?? {},
    playerCasts: player?.casts.length ?? -1,
    bossHp: boss?.resources.hp ?? -1,
    bossHpCap: boss?.caps.hp ?? -1,
    bossCasts: boss?.casts.length ?? -1,
    skillCount: view.skills.length,
    floatingCount: view.floatingText.length,
    frameCount,
    errors: [...runtimeErrors],
  };
}

/**
 * 收集**运行期异常**，供端到端脚本读取。
 *
 * ⚠️ 必须显式接这两个事件：否则未捕获异常与未处理 rejection 会被静默
 * 吞掉，端到端脚本只能看到"游戏没反应"，查不出原因。
 *
 * @returns 一个持续累积的数组（调用方只管读）。
 */
export function collectRuntimeErrors(target: Window): string[] {
  const errors: string[] = [];
  /**
   * ⚠️ 用事件**具体的 DOM 类型**（`ErrorEvent` / `PromiseRejectionEvent`）
   * 而不是 `(event: never)` 之类的变通写法 —— 后者会让 `window` 传不进来
   * （`addEventListener` 的重载对不上），也会掩盖"这里拿到的是什么"。
   */
  target.addEventListener('error', (event: ErrorEvent) => {
    errors.push(String(event.message));
  });
  target.addEventListener('unhandledrejection', (event: PromiseRejectionEvent) => {
    errors.push(`unhandled rejection: ${String(event.reason)}`);
  });
  return errors;
}
