/**
 * 战斗日志 —— **格式化层**。
 *
 * ==================================================================
 * 分层（需求："log 机制之前如果没有正好加一下，log 面板，log formator，
 * 引擎给 log 的输出，应该分层，尽量低耦合"）
 * ==================================================================
 *
 *   引擎                 core/combat  →  EventDef[]（已有，一行没改）
 *     ↓  （只读消费）
 *   格式化层             ← 本文件
 *     ↓  LogEntry[]（只含 **i18n key + 参数**，不含任何文案）
 *   渲染层               ui/LogPanel.ts → 画在屏幕右侧
 *
 * 三条边界，都是"低耦合"的具体含义：
 *
 *   1. **引擎不知道 log 存在。** 它只发 `EventDef`，日志是众多消费者之一。
 *      所以日志可以做得很细（甚至只在调试开关下开）而不影响战斗。
 *   2. **格式化层不 import pixi、不 import i18n。** 它是纯函数，
 *      输入事件、输出"key + 参数"的数组 —— 于是能在 Node 里精确测试，
 *      也能被非 canvas 的前端复用（例如将来的战报文本导出）。
 *   3. **渲染层不做判断。** 它只负责"把 key 翻成文案、画出来"。
 *      它不知道什么是 `interruptSuccess` —— 那是格式化层的事。
 *
 * ⚠️ 条目里**不存文案**，只存 key。这是 i18n 规范 I1
 * （渲染层不持有可显示文字）在日志上的落地：换语言时
 * 只需要重新取词，历史条目不用重算。
 */

import type { EventDef } from '../core/types';

/** 日志条目的**类别**，只用于配色/过滤，不参与文案。 */
export type LogCategory =
  /** 玩家打出的伤害 */
  | 'deal'
  /** 玩家承受的伤害 */
  | 'take'
  /** 闪避 / 免伤 */
  | 'avoid'
  /** 打断相关 */
  | 'interrupt'
  /** 招式起止（读条） */
  | 'cast'
  /** 资源与增益 */
  | 'resource'
  /** 战斗开始/结束 */
  | 'system';

/**
 * 一条日志。
 *
 * `key` 是 i18n key，`params` 是插值参数。渲染层用
 * `translate(key, params)` 得到最终文案。
 */
export interface LogEntry {
  /** 单调自增，渲染层用它做去重/动画 key。 */
  readonly id: number;
  /** 引擎 tick。渲染层可以据此算"多少秒前"。 */
  readonly tick: number;
  readonly category: LogCategory;
  /** 本地化 key（如 `log.damage`） */
  readonly key: string;
  readonly params?: Readonly<Record<string, string | number>>;
}

/** 格式化层的可调参数。 */
export interface LogFormatterOptions {
  /**
   * 最多保留多少条（渲染层只画最近几条）。
   *
   * 放在格式化层而不是渲染层：**增长发生在产生条目的地方**，
   * 在那里截断最省事，也避免渲染层拿到一个无限长的数组。
   */
  readonly limit?: number;
}

const DEFAULT_LIMIT = 60;

/**
 * 把引擎事件流格式化成日志条目。
 *
 * 设计成**有状态的累加器**而不是"纯函数数组映射"，原因：
 *   - 需要自增 id（渲染层用来判断"这是新的一条"）
 *   - 需要按 `limit` 滚动截断
 *   - 有些事件要**成对出现**才值得记（例如 `castStarted` → 记，
 *     `castFinished` 不记，否则读条一进一出就是两条噪声）
 *
 * 但它**没有外部依赖**，所以仍然是可测的纯逻辑。
 */
export class LogFormatter {
  private entries: LogEntry[] = [];
  private nextId = 1;
  private readonly limit: number;

  constructor(options: LogFormatterOptions = {}) {
    this.limit = Math.max(1, options.limit ?? DEFAULT_LIMIT);
  }

  /** 消费一批引擎事件，追加日志。 */
  consume(events: readonly EventDef[]): void {
    for (const event of events) {
      const entry = this.toEntry(event);
      if (!entry) continue;
      this.entries.push({ ...entry, id: this.nextId++ });
    }
    if (this.entries.length > this.limit) {
      this.entries.splice(0, this.entries.length - this.limit);
    }
  }

  /** 当前全部条目（渲染层只读）。 */
  all(): readonly LogEntry[] {
    return this.entries;
  }

  /** 清空（重开一局时用）。 */
  clear(): void {
    this.entries = [];
    this.nextId = 1;
  }

  /**
   * 单个事件 → 一条日志（或 `undefined` = 这条不值得记）。
   *
   * ⚠️ **"值得记"的标准是"玩家会想知道吗"**，不是"引擎发了什么"。
   * 所以这里刻意漏掉了一批事件：
   *   - `buffApplied` / `buffExpired`：太频（每层判定窗口都发），
   *     会瞬间刷满面板，把真正重要的信息冲走
   *   - `castFinished`：与 `castStarted` 成对，只记一次就够
   *   - `resourceChanged`：每 tick 回炁都在发，绝不能记
   */
  private toEntry(event: EventDef): Omit<LogEntry, 'id'> | undefined {
    const tick = event.tick;
    switch (event.kind) {
      case 'damage': {
        if (event.amount <= 0) return undefined;
        // 用"打谁/谁挨打"决定类别：日志读起来是一条时间线，
        // 玩家最关心"我打出去多少"和"我挨了多少"
        const onBoss = event.targetId !== 'player';
        return {
          tick,
          category: onBoss ? 'deal' : 'take',
          key: onBoss ? 'log.damage' : 'log.takeDamage',
          params: { amount: event.amount },
        };
      }
      case 'avoided': {
        return {
          tick,
          category: 'avoid',
          key: event.reason === 'immune' ? 'log.avoided' : 'log.missed',
          params: {},
        };
      }
      case 'castStarted': {
        return { tick, category: 'cast', key: 'log.castStarted', params: {} };
      }
      case 'castInterrupted': {
        return {
          tick,
          category: 'interrupt',
          key: 'log.castInterrupted',
          params: { reason: String(event.reason) },
        };
      }
      case 'interruptSuccess': {
        return { tick, category: 'interrupt', key: 'log.interruptSuccess', params: {} };
      }
      case 'interruptImmune': {
        return { tick, category: 'interrupt', key: 'log.interruptImmune', params: {} };
      }
      case 'skillRejected': {
        return {
          tick,
          category: 'interrupt',
          key: 'log.skillRejected',
          params: { reason: event.reason ?? 'condition' },
        };
      }
      case 'heal': {
        if (event.amount <= 0) return undefined;
        return { tick, category: 'resource', key: 'log.heal', params: { amount: event.amount } };
      }
      case 'encounterEnd': {
        return { tick, category: 'system', key: 'log.encounterEnd', params: {} };
      }
      default:
        return undefined;
    }
  }
}
