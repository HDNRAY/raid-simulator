/**
 * 事件（**慢通道**，给渲染层 / 日志）。
 *
 * ==================================================================
 * 为什么是一个独立文件
 * ==================================================================
 *
 * 需求："一个文件不要超过 700 行"（AGENTS.md §3）。`types.ts` 原本
 * 1091 行、15 个段落，但**段落之间互相引用** —— 随便切一刀就会在
 * 类型层造出 import 环。
 *
 * 事件这一段是**干净的叶子**：它只依赖四个标识类型
 * （`SkillId` / `BuffId` / `CombatantId` / `ResourceKey`），
 * 而 `types.ts` 里没有任何东西反过来依赖事件。
 *
 * 数据流单向（架构规范 §2.1）也支持这个切法：
 *   sim → **EventDef[]** → renderer / logFormat
 * 事件是**输出**，让输出独立成一层是它的自然位置。
 */

import type { BuffId, CombatantId, SkillId } from './types/ids';
import type { ResourceKey } from './types/resources';
import type { EndReason } from './types/runtime';

/* ================================================================== *
 * 13. 事件（慢通道，给渲染层 / 日志）
 * ================================================================== */

export type SkillRejectReason =
  | 'cooldown'
  | 'cost'
  | 'casting'
  | 'condition'
  | 'locked'
  | 'target'
  /**
   * 被限制只能使用某类技能（如倒地时只能用「闪避」类）。
   *
   * 与 `locked` 分开：`locked` 是"完全不能动"，这条是"**只能做某类
   * 动作**" —— 玩家需要知道"我还能按什么"，而不是"我什么都做不了"。
   */
  | 'tagRestricted';

export type EventDef =
  | {
      readonly kind: 'damage';
      readonly tick: number;
      readonly sourceId: CombatantId;
      readonly targetId: CombatantId;
      readonly amount: number;
      readonly crit: boolean;
      readonly absorbed: number;
      readonly overkill: number;
      /**
       * 造成这次伤害的**招式**。
       *
       * ⚠️ `''` 表示**不是技能打的**（触发器的产出，例如「污堕印记」的反伤）。
       * 用空串而不是可选字段：日志要按它取招式名，"有没有值"和"值是空"
       * 在调用点应该只有一种处理方式。
       */
      readonly skillId: SkillId;
      /** 是**反伤**（由触发器产出）。日志要据此标注"反伤"。 */
      readonly reflect?: boolean;
    }
  | {
      readonly kind: 'heal';
      readonly tick: number;
      readonly sourceId: CombatantId;
      readonly targetId: CombatantId;
      readonly amount: number;
      readonly crit: boolean;
      readonly overheal: number;
    }
  /** 闪避成功必须有独立事件，否则玩家不知道躲掉了 */
  | {
      readonly kind: 'avoided';
      readonly tick: number;
      readonly sourceId: CombatantId;
      readonly targetId: CombatantId;
      readonly skillId: SkillId;
      readonly reason: 'dodged' | 'immune';
    }
  | {
      readonly kind: 'buffApplied' | 'buffExpired' | 'buffRefreshed' | 'buffStackChanged';
      readonly tick: number;
      readonly targetId: CombatantId;
      readonly buffId: BuffId;
      readonly stacks: number;
      readonly sourceId: CombatantId;
    }
  | {
      readonly kind: 'castStarted' | 'castFinished' | 'castInterrupted';
      readonly tick: number;
      readonly sourceId: CombatantId;
      readonly skillId: SkillId;
      /**
 * 中断原因：
 *   `interrupted` 被「破」这类效果打断
 *   `sourceLost`   施法者丢失目标
 *   `death`        施法者死亡
 *   `replaced`     施法者**主动改用了别的技能**（读条中出招规则）
 */
readonly reason?: 'interrupted' | 'sourceLost' | 'death' | 'replaced';
    }
  /**
   * 打断被**霸体**挡下。
   *
   * 单独一个事件（而不是复用 `skillRejected`）：被打断方是"状态生效"，
   * 打断方是"技能放出来了但没生效" —— 两边的反馈不同。
   */
  | {
      readonly kind: 'interruptImmune';
      readonly tick: number;
      readonly targetId: CombatantId;
      readonly skillId: SkillId;
    }
  | {
      readonly kind: 'interruptSuccess';
      readonly tick: number;
      /** 打断者（谁把读条打断了）。 */
      readonly sourceId: CombatantId;
      readonly targetId: CombatantId;
      /**
       * **被打断的那个读条**的技能。
       *
       * ⚠️ 它**不是**打断者用的技能 —— 用「截」打断和用「破」打断，这个
       * 字段都是被打断的招（例如 Boss 的「轻蔑」）。要区分"用哪一招打断
       * 的"必须读 `sourceSkillId`。两个都留着：日志要显示"打断了谁的什么"，
       * 而肉鸽的解锁条件要问"用截打断了几次"。
       */
      readonly skillId: SkillId;
      /**
       * **打断者**（`sourceId`）用的那个技能的 id。
       *
       * 为什么必须单独一个字段：`sourceId` 只说"是谁"，而"是什么招式"
       * 在这一层不可还原 —— 打断由 `Effect: 'interrupt'` 结算，
       * 同一个 `sourceId` 可能用「截」也可能用「破」，而两者的事件
       * **长得完全一样**。用户的「截拳道」/「招架反击流」这类炁机
       * 要的正是这个区分。
       *
       * 可选（`?`）：有些打断来源**不是技能**（触发器的产出、
       * 未来的环境效果），那时没有"招式"可写 —— 写 `''` 会与
       * "技能 id 恰好是空串"混淆（`damage` 事件的 `skillId` 就用了
       * `''` 表示非技能，这里不再重复那个约定）。
       *
       * ⚠️ **本字段不参与任何判定**：没有任何引擎分支读它
       * （`buffHookDispatch` 只认 `buffApplied` / `buffExpired`），
       * 它只被 `EventDef[] → 统计` 的消费者读（`core/run/stats.ts`、
       * 日志、渲染）。所以**它不改变确定性语义**，
       * `REPLAY_FORMAT_VERSION` 不必 +1（依据见 `hitResolution.ts` 的
       * 两处 emit 点注释）。
       */
      readonly sourceSkillId?: SkillId;
    }
  | {
      readonly kind: 'resourceChanged';
      readonly tick: number;
      readonly targetId: CombatantId;
      readonly resource: ResourceKey | string;
      readonly delta: number;
      readonly current: number;
    }
  | { readonly kind: 'skillUsed'; readonly tick: number; readonly sourceId: CombatantId; readonly skillId: SkillId }
  /**
   * 施放被拒绝。
   *
   * 玩家按键没反应时必须能知道原因（GCD？CD？资源？条件？被锁？），
   * 渲染层才能给出正确反馈。旧项目这里只写了一句"我还不能使用这个技能"。
   */
  | {
      readonly kind: 'skillRejected';
      readonly tick: number;
      readonly sourceId: CombatantId;
      readonly skillId: SkillId;
      readonly reason: SkillRejectReason;
    }
  /** 某个 Boss 行为（含 `onHpBelow` 触发的能力）生效了 */
  | { readonly kind: 'behaviorTriggered'; readonly tick: number; readonly bossId: CombatantId; readonly kindName: string }
  | { readonly kind: 'enrageStarted'; readonly tick: number; readonly bossId: CombatantId }
  | { readonly kind: 'death'; readonly tick: number; readonly targetId: CombatantId }
  | {
      readonly kind: 'encounterEnd';
      readonly tick: number;
      readonly result: 'victory' | 'defeat';
      readonly reason: EndReason;
    };

export type EventKind = EventDef['kind'];

/**
 * **结束事件**（超时 / 死亡）的精确类型。
 *
 * ⚠️ 单独命名是给 `encounterEnd.ts` 的两个工厂当返回类型用：
 * 若它们返回宽泛的 `EventDef`，调用方取 `.result` 就要先 narrow —— 而
 * "narrow 一下"在调用点很容易被写成类型断言（AGENTS.md §1 禁止）。
 */
export type EncounterEndEvent = Extract<EventDef, { kind: 'encounterEnd' }>;
