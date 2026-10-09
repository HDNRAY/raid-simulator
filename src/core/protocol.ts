/**
 * 模拟的输入接口（唯一入口）。
 *
 * 玩家键盘、Boss AI、回放系统**三者产生同一种 Action**
 * （architecture 规范 §2.2）。这是"Boss 和玩家共用引擎"以及"战斗可重放"
 * 共同的技术基础。
 */

export type CombatantId = string;

export type Action =
  /** 尝试施放技能。`at` 是战斗内时间，必须量化到帧边界 */
  | { readonly type: 'useSkill'; readonly skillId: string; readonly at: number }
  /** 松开按键：停止"按住连发" */
  | { readonly type: 'releaseKey'; readonly key: string; readonly at: number }
  /** 切换当前目标 */
  | { readonly type: 'setTarget'; readonly targetId: CombatantId; readonly at: number }
  /** 暂停 / 恢复（暂停时战斗内时间不推进） */
  | { readonly type: 'pause'; readonly at: number }
  | { readonly type: 'resume'; readonly at: number }
  /** 重开一场，使用新的种子 */
  | { readonly type: 'restart'; readonly seed: number; readonly at: number };

export type ActionType = Action['type'];

/**
 * 把 Action 的时间戳吸附到帧边界。
 *
 * 不量化的话，同一份操作序列在不同帧率下发到不同 tick，重放就不可靠。
 * 这里刻意不 import loop.ts 的 quantizeToFrame —— 那会引入依赖方向问题，
 * 而且协议层应该只依赖 loopConstants。
 */
export { quantizeToFrame as quantizeActionTime } from './loop';
