/** Buff / Debuff —— 与修正器同模型，`polarity` 只影响 UI 颜色。 */

import type { BuffId, CombatantId, LocaleKey, SkillId } from './ids';
import type { StatModifier } from './stats';
import type { SkillTag, TriggerDef } from './triggers';

/* ================================================================== *
 * 4. Buff / Debuff
 * ================================================================== */

/**
 * Buff 与 Debuff 是**同一个模型**，`polarity` 只影响 UI 颜色。
 *
 * 理由：一个"受到更多伤害"的效果，从施加者看是 debuff，
 * 从目标看只是一条 `vulnerability` 修正。修正本身没有正负，只有方向。
 */
export type Polarity = 'buff' | 'debuff' | 'neutral';

/** 叠层规则。默认 `refresh`。 */
export type StackingRule =
  | { readonly mode: 'refresh' }
  | { readonly mode: 'stack'; readonly max: number }
  | { readonly mode: 'stackRefresh'; readonly max: number }
  | { readonly mode: 'independent'; readonly max: number }
  | { readonly mode: 'replace' }
  | { readonly mode: 'extend'; readonly maxDurationMs: number };

/**
 * 判定旗标。闪避/卸力/限制/派生**全部落在数据上**，零新引擎机制：
 * `invulnerable` · `damageReduce` · `damageThreshold` · `restrictToTags` ·
 * `comboWindow`。
 */
export interface BuffFlags {
  readonly invulnerable?: boolean;
  readonly damageReduce?: number;
  /**
   * **阈值抵消**（林晚风「卸」）。
   *
   * ==================================================================
   * 这是"判定层"的第三种形态，前两种都已在引擎里
   * ==================================================================
   *
   * | flag | 语义 | 已有实现 |
   * |---|---|---|
   * | `invulnerable` | **整击作废**（伤害与效果一起丢） | ✓ `avoided` 通路 |
   * | `damageReduce` | **按比例**减（乘法） | ✓ `computeDamage` |
   * | `damageThreshold`（本字段） | **≤N 整击作废；>N 平减 N 点** | 🆕 2026-10-12 |
   *
   * 所以它不是"又一套防御系统"：**两半都复用已有通路** ——
   * `≤N` 那一半走 `invulnerable` 用的同一条 `avoided` 判定
   * （因此"连眩晕这类效果一起免"是**天然**的，不是新写的），
   * `>N` 那一半接在 `damageReduce` 旁边做一次**平减**。
   *
   * ⚠️ **判据是"这一击的伤害值"**，由 `computeDamage` 先算出
   * `preBlock`（含增伤/易伤/暴击，不含防御侧减免）再与它比较。
   * 多段攻击**每段各判一次**。
   *
   * ⚠️ 值必须来自 `data/balance.ts` 的具名常量（`GUARD_THRESHOLD`），
   * 不要在内容里散落魔法数 —— 用户明确说这个数会来回调（15 → 10）。
   *
   * ⚠️ 多个来源**取最大值**（与 `damageReduce` 同一条理由：
   * 相加会越过"完全免疫"，而且玩家无法预期）。
   */
  readonly damageThreshold?: number;
  /**
   * **荆棘**：受到伤害时，把其中的 `reflectFraction` 比例反弹给攻击者。
   *
   * ==================================================================
   * 与「欲望印记」那套反伤的**区别**（两条并存，不是替代）
   * ==================================================================
   *
   * | | 印记反伤 | 荆棘（本字段） |
   * |---|---|---|
   * | 触发 | 有印记时**再挨一下** | **每一次**受伤 |
   * | 次数 | 触发即**消耗**印记 | **不消耗**，buff 在就一直在 |
   * | 数值 | 固定值（`REFLECT_DAMAGE`） | **比例**（受多少伤 × 这个系数） |
   * | 防抖 | 有内部 CD | 无（窗口期本身就是它的约束） |
   *
   * 所以荆棘表达的是"**这一段时间内你别碰我**"，而印记表达的是
   * "你打一下，我回你一下，然后你得停 3 秒"。
   *
   * ⚠️ **反伤不会再触发反伤**：反弹出去的那一次命中，受击者是攻击者，
   * 若他也带荆棘，会形成一次反弹 —— 所以反弹命中**显式跳过荆棘判定**
   * （见 `hitResolution` 的 `isReflect`）。否则两个反伤角色会互相弹到死。
   *
   * ⚠️ 反弹的伤害**不吃增伤/减伤**（`ignoreModifiers`），与印记反伤
   * 同一条纪律："越强越容易被自己打死"是反直觉的。
   */
  readonly reflectFraction?: number;
  readonly ccImmune?: boolean;
  readonly interruptImmune?: boolean;
  /**
   * 派生窗口：**只有这个 buff 在时，列表里的技能才被激活**（与
   * `restrictToTags` 方向相反，见本接口头部）。
   */
  readonly comboWindow?: readonly SkillId[];
  /**
   * **这次派生是从哪个技能来的** —— UI 靠它把派生技画在原技能上方。
   *
   * ⚠️ 记在 buff 上而不是技能的静态字段：同一个派生技可能由多个源
   * 技能派生，而"后派生的顶掉先派生的"意味着**源是动态的** ——
   * buff 刷新时 flags 一起被覆盖，顶掉是天然的。
   */
  readonly comboWindowSource?: SkillId;
  /** 动作锁：期间不能施放任何技能（施法僵直） */
  readonly actionLock?: boolean;
  /**
   * **技能 tag 白名单（限制）**：期间**只能**施放带这些 tag 之一的技能，
   * 多个来源取并集。见 `KNOCKDOWN`（「倒地」）。
   *
   * ⚠️ 与「派生」是**两种机制**：限制是**负向、排除、全局**
   * （"除了白名单都不行"），派生是**正向、激活、单技**
   * （"只有 buff 在时这个技能才被激活"）。
   */
  readonly restrictToTags?: readonly SkillTag[];
}

/* ------------------------------------------------------------------ *
 * 消费机制：buff "什么时候消失" 是**数据**，不是每条技能的命中里
 * 手写一条 `removeBuff`
 * ------------------------------------------------------------------ */

/**
 * **buff 的生命周期由谁结束**（`BuffDef.consumeOn`）。
 *
 * ==================================================================
 * 为什么要有这一层
 * ==================================================================
 *
 * 在它之前，"用掉就消耗"只能由**消耗方**自己记住：每个会造成伤害的
 * 攻击技能都要在 `hits[].effects` 里手写一条
 * `{ kind: 'removeBuff', target: { mode: 'self' }, buffId: '…' }`。
 *
 * 那是**契约式耦合**：真相分散在 N 条技能里，而漏写一条的症状是
 * **静默的**（那个技能只是不消耗 buff，下一击还能再吃一次），
 * 而且往往只在"玩家选了某条炁机"时才发生（见
 * `data/kits/dodgeCharge.ts` 的文件头）。加一个攻击技能忘记同步 →
 * 没有任何报错。
 *
 * 现在改成：**buff 自己声明"什么时候该消失"**，引擎在事件发生的那一
 * tick 统一结算（`core/buffs/consume.ts`）。于是新增攻击技能**天然**正确 ——
 * 它不需要知道任何 buff 的存在。
 *
 * ==================================================================
 * 四个触发（逐条对应需求里的四种消费）
 * ==================================================================
 *
 * | 触发 | 需求原话 | 判据（引擎怎么知道它发生了） |
 * |---|---|---|
 * | `onAttack` | 被攻击消费 | 持有者**打出了**一次伤害（`damage` 事件的 `sourceId` 是它，且这一下真的掉血） |
 * | `onDamaged` | 被受击消费 | 持有者**挨了**一次伤害（同样的判据，看 `targetId`） |
 * | `onDodge` | 被闪避消费 | 持有者**闪掉**了一击（`avoided` 事件，判据同"闪避"：`invulnerable`） |
 * | `onBlock` | 被格挡消费 | 持有者**挡下**了一击（`avoided` 事件，判据同"阈值卸力"：`damageThreshold`） |
 *
 * ⚠️ **`onAttack` / `onDamaged` 用"同一个 `damage` 事件的两面"**，不是
 * 两种事件：一次成功的攻击，攻方那一侧是 `onAttack`、守方那一侧是
 * `onDamaged`。所以"我打人"**不会**触发我身上的 `onDamaged`（反面测试
 * 在 `tests/unit/buffConsume.test.ts`）。
 *
 * ⚠️ **被闪掉 / 被挡下的那一击不会触发 `onAttack` / `onDamaged`** ——
 * 因为那两种判据都要求 `damage` 事件（真的掉血）。这正好与
 * `onHitTaken` 触发器同一条口径（"没碰到人就不算受击"，见
 * `hitResolution.ts` 的 `taken > 0`）。
 *
 * ⚠️ **`onAttack` 只认技能打出来的伤害**（`damage.skillId !== ''`）：
 * 触发器产出的**反伤**（`reflect: true`）不算"你攻击了一次"，
 * 否则"挂着反伤的 Boss 打你一下"会顺手消耗掉它自己的攻击 buff。
 *
 * ==================================================================
 * 为什么是"名字的数组"而不是四个布尔字段
 * ==================================================================
 *
 * 名字数组可以直接与"这一 tick 真的发生了什么"求交（见
 * `matchedConsumeTriggers`），而且**加一种触发时运行期表会自动跟上** ——
 * 反过来若把它写成 `{ onAttack?: boolean; … }`，每加一种都要在
 * `applyConsume` 里手抄一遍字段名，抄漏一处就是静默无效。这正是
 * `buffHookDispatch.ts` 选择"扫事件"而不是"逐个调用点插一行"的同一条理由。
 */
export type BuffConsumeTrigger =
  /** 持有者**打出去**了一击（造成伤害）→ 消耗。 */
  | 'onAttack'
  /** 持有者**挨了**一击（受到伤害）→ 消耗。 */
  | 'onDamaged'
  /** 持有者**闪掉**了一击（无敌判定）→ 消耗。 */
  | 'onDodge'
  /** 持有者**挡下**了一击（阈值卸力判定）→ 消耗。 */
  | 'onBlock';

/**
 * **消费规则**（`BuffDef.consume`）。
 *
 * 不写这个字段 = 这个 buff 的生命周期**只由时间 / 驱散 / 主动移除**决定
 * （即"永久存在"与"持续时间"两种情况，它们已经由 `duration` 表达）。
 */
export interface BuffConsumeRule {
  /** 满足**任意一条**就消费（不是全部满足）。 */
  readonly on: readonly BuffConsumeTrigger[];
  /**
   * **一次消费掉几层**（默认 = 全部）。
   *
   * - 不写：整条 buff 消失。适合"一次性的蓄势 / 一次性的窗口"
   *   （用户：「用掉就消耗」）
   * - `1`：只掉一层，层数归零才消失。适合"N 层护盾，挨一下碎一层"
   *
   * ⚠️ 语义上**一个触发 tick 每个 buff 只消费一次**（即使这一 tick 既
   * 命中了又挨打了）—— "多段攻击每段都扣一层"会让层数的消耗速度取决于
   * 段数，而玩家看到的是一次技能。这条判据在 `consume.ts` 的
   * `matchedConsumeTriggers` 里只返回一次。
   */
  readonly stacks?: number;
}

/** buff 的视觉提示，渲染层据此播特效。 */
export interface BuffVfx {
  readonly aura?: string;
  readonly onApply?: string;
  readonly onExpire?: string;
}

export interface BuffDef {
  readonly id: BuffId;
  readonly nameKey: LocaleKey;
  readonly icon: string;
  readonly polarity: Polarity;
  /**
   * 图标占位颜色（0xRRGGBB）。
   *
   * 当前美术素材是**单色方块占位**，所以这个值就是玩家看到的东西。
   * 不做成"按 polarity 自动推导"是因为内容作者需要区分同极性的
   * 不同 buff（例如"无敌"要橙、"急速"要青）。
   */
  readonly color?: number;
  /**
   * 隐藏：**不在 UI 的 buff 条上显示图标**。
   *
   * 用于引擎内部标记（公共冷却、Boss 前摇）—— 它们不是"玩家应该看到的
   * 增益/减益"，而是引擎状态，UI 已经用别的方式表达
   * （按钮变灰、预警条）。不隐藏就会在图标条上挂一串无意义的灰块。
   */
  readonly hidden?: boolean;
  /** ms。`Number.POSITIVE_INFINITY` 表示永久。 */
  readonly duration: number;
  readonly maxStacks: number;
  readonly stacking: StackingRule;
  /**
   * **消费机制**：这个 buff 被哪些"发生在持有者身上的事"消耗掉。
   *
   * 不写 = 只能靠时间过期 / 驱散 / `removeBuff` 结束（含"永久存在"）。
   * 写了 = 引擎在那一 tick 自动消费（见 `BuffConsumeTrigger` 的文件注释）。
   *
   * ⚠️ 这是**引擎级**机制：消耗方（技能内容）**不需要**写任何
   * `removeBuff` —— 那正是本字段要取代的东西（"别造第二份真相"）。
   */
  readonly consume?: BuffConsumeRule;
  readonly modifiers?: readonly StatModifier[];
  readonly flags?: BuffFlags;
  /**
   * 伤害倍率（乘在最终伤害上）。狂暴这类"整体变强"用它。
   *
   * 放在 buff 上而不是写成一条 `damageMult` 修正，是因为它表达的是
   * "这个单位的输出整体 ×N"，与"某条修正贡献多少"不是一回事 ——
   * 后者参与修正池聚合，前者是一个整体开关。
   */
  readonly damageMultBoost?: number;
  readonly triggers?: readonly TriggerDef[];
  readonly vfx?: BuffVfx;
  readonly dispellable?: boolean;
  /** 互斥标签：同标签的 buff 只能存在一个 */
  readonly tags?: readonly string[];
}

/** 运行时 buff 实例。**只存实例状态，不存数值快照。** */
export interface BuffInstance {
  /** 唯一。同一 `defId` 可以有多份（G4）。 */
  readonly instanceId: string;
  readonly defId: BuffId;
  /**
   * 内容定义（不可变，可安全共享引用）。
   *
   * 为什么不只存 `defId`：引擎需要一个 defId → BuffDef 的解析途径。
   * 内容**定义**是不可变对象，引用它不会破坏"状态可结构化克隆"
   * （结构化克隆会复制它），也不会破坏可哈希性（哈希看的是值）。
   * 数值仍然**不在**这里 —— 派生值每次重新求值。
   */
  readonly def?: BuffDef;
  readonly stacks: number;
  /** 施加时刻（tick） */
  readonly appliedAtTick: number;
  /** 过期时刻（tick，绝对）。`Infinity` 表示永久。 */
  readonly expiresAtTick: number;
  readonly sourceId: CombatantId;
  /** 每个 trigger 的内置 CD 记录：triggerKey → 下次可用 tick */
  readonly triggerCooldowns: Record<string, number>;
  /** 剩余触发次数：triggerKey → 剩余 */
  readonly triggerCounts: Record<string, number>;
}
