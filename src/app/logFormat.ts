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
 * 条目的**分量** —— 决定它出现在哪一层（需求："战斗中的面板不要被刷屏，
 * 但战报要尽可能全"）。
 *
 * `major` = 战斗中左侧那几条实时滚动的
 * `minor` = **只进战报**（回炁、buff 过期、非关键 buff 这类）
 *
 * ⚠️ 这就是"信息尽可能多"与"面板别刷屏"的调和点：
 * **不是不记，是不往实时面板塞。**
 */
export type LogLevel = 'major' | 'minor';

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
  /** 见 `LogLevel`。 */
  readonly level: LogLevel;
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
  /**
   * 技能 id → 名称的 i18n key。
   *
   * ⚠️ 日志要写"**被「碾压」打了 60**"，而不是光一个数字 —— 否则玩家
   * 分不清这一下是谁打的（尤其有反伤 / 多来源之后）。
   * 这里给的是 **key**（不是文案），翻译由渲染层做（i18n 规范 I1）。
   */
  readonly skillNameKeys?: ReadonlyMap<string, string>;
  /**
   * 单位 id → 名称的 i18n key。
   *
   * ⚠️ 传**函数**而不是 Map：日志要写"**傲慢** 用「碾压」击中你"，
   * 而"这一局有谁"是运行期才知道的（构造 formatter 时引擎可能还没建好）。
   * 惰性解析顺带保证重开一局换了对手也不用重建 formatter。
   */
  readonly combatantNameKey?: (id: string) => string | undefined;
  /**
   * 哪些 buff 值得写进日志。
   *
   * ⚠️ **不传 = 一个 buff 都不记**（保持旧行为）。
   * 为什么必须由外面筛：`buffApplied` 是**最频的事件**
   * （每层印记、每个判定窗口都发），全记会瞬间把日志埋掉。
   * 但"二阶段""霸体""倒地""眩晕"恰恰是 buff ——
   * 所以筛的不是"重不重要"，而是"**这个 buff 是不是一个事件**"。
   * 调用方按 buff 的 `flags`（`actionLock` / `restrictToTags` /
   * `interruptImmune`）来定，与 `app/skillHints.ts` 同一套判据。
   */
  readonly notableBuffIds?: ReadonlySet<string>;
  /** buff id → 名称的 i18n key（与 `notableBuffIds` 配套）。 */
  readonly buffNameKeys?: ReadonlyMap<string, string>;
}

/**
 * 保留上限 —— 是**安全阀**，不是"只留 60 条"那种截断。
 *
 * ⚠️ 需求："一局结束也显示完整 log，玩家好复盘"。
 * 原先这里是 **60**，打满 95 秒的傲慢早就不止 60 条 ——
 * 复盘时看到的会是被砍掉开头的残卷。所以它必须**大到不会触发的程度**，
 * 只在内存异常时才兜底。
 */
const DEFAULT_LIMIT = 5000;

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
  private readonly skillNameKeys: ReadonlyMap<string, string>;

  private readonly notableBuffIds: ReadonlySet<string> | undefined;
  private readonly combatantNameKey: ((id: string) => string | undefined) | undefined;
  private readonly buffNameKeys: ReadonlyMap<string, string>;

  constructor(options: LogFormatterOptions = {}) {
    this.limit = Math.max(1, options.limit ?? DEFAULT_LIMIT);
    this.skillNameKeys = options.skillNameKeys ?? new Map();
    this.buffNameKeys = options.buffNameKeys ?? new Map();
    this.notableBuffIds = options.notableBuffIds;
    this.combatantNameKey = options.combatantNameKey;
  }

  /** 单位 id → 名称 key（解析不出就给一个读得通的兜底）。 */
  private actorKey(id: string): string {
    return this.combatantNameKey?.(id) ?? 'log.unknownActor';
  }

  /** 招式 id → 名称 key。 */
  private skillKey(id: string): string {
    return this.skillNameKeys.get(id) ?? 'log.unknownSource';
  }

  /** buff id → 名称 key。 */
  private buffKey(id: string): string {
    return this.buffNameKeys.get(id) ?? 'log.unknownBuff';
  }

  /**
   * ⚠️ 这里**曾经**有个 `damageSource()`，返回 `{ skill: 'log.reflect' }`
   * 或招式名 —— 那是"用参数兼职表达来源"的做法。
   *
   * 现在来源拆成了三个独立参数（`actor` / `target` / `skill`），
   * 反伤也单独成一条（`log.reflect`，属性对调着读）。
   * 所以那个函数没有存在理由了，已删。
   */

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
    /**
     * ⚠️ `params` 里的**字符串会被渲染层当成 i18n key 翻译**
     * （见 `LogPanel.resolveParams`），数字原样插值。
     * 所以凡是"名字"都必须传 **key**，凡是"数量"都必须传 **number** ——
     * 传错了屏幕上就会出现 `boss.cleave.name` 或 `{amount}` 这种东西。
     */
    switch (event.kind) {
      case 'damage': {
        if (event.amount <= 0) return undefined;
        /**
         * **反伤**单独一条：它不是"谁打谁"，而是"打出去的人自己挨了" ——
         * 属性对调着读才通顺（"傲慢 受到 12 点反伤"）。
         */
        /**
         * **不是技能打的伤害**（`skillId === ''`）—— 两种形态，都得说清来源：
         *
         * | 形态 | 判定 | 日志 |
         * |---|---|---|
         * | 荆棘**反伤** | `reflect === true` | `受到 8 点反伤（荆棘）` |
         * | buff 造成的伤害 | 有 `sourceBuffId` | `受到 8 点伤害（弹）` |
         *
         * ⚠️ 2026-10-22 的两条实测都出在这里：
         *   ① "8 点反伤，未知来源" —— 没有名字可用（现在用 buff 名）
         *   ② "打傲慢为什么会有反伤" + "没有弹的伤害 log" —— **同一件事**：
         *      触发器产出的伤害原先**一律**标成 `reflect: true` ✗，
         *      于是「弹」的 8 点被显示成"反伤·未知来源" ✗
         */
        const source = event.sourceBuffId;
        if (event.reflect === true) {
          if (source !== undefined) {
            return {
              tick,
              category: 'take',
              level: 'major',
              key: 'log.reflect',
              params: {
                actor: this.actorKey(event.sourceId),
                skill: this.buffKey(source),
                amount: event.amount,
              },
            };
          }
          return {
            tick,
            category: 'take',
            level: 'major',
            key: 'log.reflectShort',
            params: { actor: this.actorKey(event.sourceId), amount: event.amount },
          };
        }
        if (source !== undefined && event.skillId === '') {
          return {
            tick,
            category: event.targetId === 'player' ? 'take' : 'deal',
            level: 'major',
            key: 'log.buffDamage',
            params: {
              actor: this.actorKey(event.sourceId),
              target: this.actorKey(event.targetId),
              skill: this.buffKey(source),
              amount: event.amount,
            },
          };
        }
        const onBoss = event.targetId !== 'player';
        return {
          tick,
          category: onBoss ? 'deal' : 'take',
          level: 'major',
          key: 'log.damage',
          params: {
            actor: this.actorKey(event.sourceId),
            target: this.actorKey(event.targetId),
            skill: this.skillKey(event.skillId),
            amount: event.amount,
          },
        };
      }
      case 'avoided': {
        /**
         * ⚠️ `reason` 是**枚举**（`'dodged' | 'immune'`），不是名字 ——
         * 所以拼成 `log.reason.*` 再交给渲染层翻。
         * 直接传 `'dodged'` 会被当成 key 去查，查不到就原样显示英文 ✗
         */
        const dodged = event.reason === 'dodged';
        return {
          tick,
          category: 'avoid',
          level: dodged ? 'major' : 'minor',
          key: dodged ? 'log.avoided' : 'log.immune',
          params: {
            actor: this.actorKey(event.targetId),
            source: this.actorKey(event.sourceId),
            skill: this.skillKey(event.skillId),
          },
        };
      }
      /**
       * ⚠️ `castStarted` **仍然不记**（需求："log里不要开始读条"，见文件头）。
       * "开始读条"不说明任何结果，而结果那条一定会有（伤害/打断/闪避）。
       */
      case 'castStarted':
        return undefined;
      case 'castInterrupted': {
        return {
          tick,
          category: 'interrupt',
          level: 'major',
          key: 'log.castInterrupted',
          params: {
            actor: this.actorKey(event.sourceId),
            skill: this.skillKey(event.skillId),
            reason: `log.reason.${event.reason ?? 'interrupted'}`,
          },
        };
      }
      case 'interruptSuccess': {
        return {
          tick,
          category: 'interrupt',
          level: 'major',
          key: 'log.interruptSuccess',
          params: {
            actor: this.actorKey(event.sourceId),
            target: this.actorKey(event.targetId),
            skill: this.skillKey(event.skillId),
          },
        };
      }
      case 'interruptImmune': {
        return {
          tick,
          category: 'interrupt',
          level: 'major',
          key: 'log.interruptImmune',
          params: {
            target: this.actorKey(event.targetId),
            skill: this.skillKey(event.skillId),
          },
        };
      }
      /**
       * ⚠️ `skillRejected` **完全不进日志**（需求："闪避 cd 的 log，这是 bug"）。
       *
       * 理由见文件头：**它**不是**战斗事件，是输入反馈** —— 连续按闪避 6 秒会产生
       * 295 次 cooldown 拒绝，记下来必然把真正的战斗信息冲走。
       * 画面上的技能格已经实时表达了同一件事（白遮罩 + 剩余秒数 / 字变暗）。
       */
      case 'skillRejected':
        return undefined;
      case 'skillUsed': {
        /**
         * 需求："boss 的什么能力" —— 这条就是它。
         *
         * ⚠️ 玩家自己的出招是 `minor`：玩家当然知道自己按了什么 ✗
         * 而 Boss 的是 `major` —— **它才是玩家需要知道的**（要应对）。
         */
        const boss = event.sourceId !== 'player';
        return {
          tick,
          category: 'cast',
          level: boss ? 'major' : 'minor',
          key: 'log.skillUsed',
          params: { actor: this.actorKey(event.sourceId), skill: this.skillKey(event.skillId) },
        };
      }
      case 'heal': {
        if (event.amount <= 0) return undefined;
        return {
          tick,
          category: 'resource',
          level: 'major',
          key: 'log.heal',
          /** ⚠️ `heal` 事件**不带 `skillId`**（回血可能来自触发器）——
           *  所以这条没有"用什么回的"，别硬凑。 */
          params: { actor: this.actorKey(event.targetId), amount: event.amount },
        };
      }
      /**
       * **值得记的 buff 才记**（需求："boss 二阶段了"）。
       *
       * ⚠️ 由调用方用 `notableBuffIds` 筛 —— 见那个选项的说明：
       * 筛的不是"重不重要"，而是"**这个 buff 是不是一个事件**"。
       * 不传就一个都不记（保持旧行为，也保证旧测试不受影响）。
       */
      case 'buffApplied':
      case 'buffExpired': {
        if (this.notableBuffIds?.has(event.buffId) !== true) return undefined;
        const applied = event.kind === 'buffApplied';
        return {
          tick,
          category: 'resource',
          /**
           * ⚠️ **上 buff 是 major，buff 结束是 minor**：
           * "傲慢获得「霸体」"是玩家必须立刻知道的，
           * "「霸体」结束了"晚一点知道没关系。
           */
          level: applied ? 'major' : 'minor',
          key: applied ? 'log.buffApplied' : 'log.buffExpired',
          params: { actor: this.actorKey(event.targetId), buff: this.buffKey(event.buffId) },
        };
      }
      case 'death': {
        return {
          tick,
          category: 'system',
          level: 'major',
          key: 'log.death',
          params: { actor: this.actorKey(event.targetId) },
        };
      }
      case 'enrageStarted': {
        return {
          tick,
          category: 'system',
          level: 'major',
          key: 'log.enrage',
          params: { actor: this.actorKey(event.bossId) },
        };
      }
      case 'encounterEnd': {
        return { tick, category: 'system', level: 'major', key: 'log.encounterEnd', params: {} };
      }
      default:
        return undefined;
    }
  }
}
