/**
 * **校验问题的形状**（`ValidationIssue` 与它的校验码）。
 *
 * ==================================================================
 * 为什么单独一个文件（本轮从 `validate.ts` 切出来）
 * ==================================================================
 *
 * 加"buff 消费机制"的内容校验时，`validate.ts` 到了 **712 行**
 * （AGENTS.md §3 的上限是 700）。按那条纪律（**先拆 util / 横向切割，
 * 不许压注释**），把"buff 定义怎么校验"整块搬到了 `./buffValidation.ts`。
 *
 * 但那一块**必须**产出这个形状（它要往同一个 `push` 回调里塞问题），
 * 而它又不能从 `validate.ts` import —— 那会造出
 * `validate → buffValidation → validate` 的类型环。所以把这两个类型
 * 下沉成**叶子**：谁都能向上依赖它，它不依赖任何东西。
 *
 * ⚠️ 本仓库对"类型环"的判断（见 `types/index.ts` 的文件头）：`import type`
 * 在编译期完全擦除，**运行期没有环**。但这里仍然切了出来，因为本文件
 * 是"两个模块都要用的公共词汇"，放在调用方（`validate.ts`）里会让
 * 被调用方反向依赖调用方 —— 那不是运行期问题，是**方向**问题。
 */

export type ValidationCode =
  | 'DUP_ID'
  | 'MISSING_BUFF'
  | 'MISSING_SKILL'
  | 'MISSING_SOURCE'
  | 'MISSING_LOCALE_KEY'
  | 'KEY_ID_MISMATCH'
  | 'CYCLE'
  | 'HIT_ORDER'
  | 'ZERO_DURATION'
  | 'UNCAPPED_STACK'
  | 'BAD_CLAMP'
  | 'DANGLING_NAMESPACE'
  | 'HARDCODED_TEXT'
  | 'UNKNOWN_STAT'
  | 'EMPOWERED_ABILITY'
  /**
   * `onSuccess` 退还的冷却与自己扣的不相等。
   *
   * 「截」的"成功不进 CD"就是靠这两个数字相等实现的 —— 不等会静默
   * 坏掉（退多了被钳住看不出来，退少了成功之后还剩一截 CD）。
   */
  | 'COOLDOWN_REFUND_MISMATCH'
  /**
   * 内容用了 `Expr.counter`（离散计数器）。
   *
   * ⚠️ 这是个**能力尚未接线**的检查，不是"内容写错了"：计数器没有写入者，
   * 战斗路径的 `getCounter` 是 `() => 0` 的桩 —— 用它会**静默得到 0**
   * （不是报错，是算错，最坏的一种）。所以这里**默认拒绝**：
   * 类型保留、能力保留，但在实现之前不可能被静默误用。
   *
   * 实现计数器之后把这条检查删掉即可。
   */
  | 'COUNTER_UNIMPLEMENTED'
  /**
   * 内容用了引擎**没有执行点**的 `Ability` kind（`grantSkill` / `consume`）。
   *
   * 同 `COUNTER_UNIMPLEMENTED` 的性质：它们是**设计过但还没接线**的能力
   * （类型保留），可写进内容会**静默无效** —— 所以默认拒绝。
   * "故意留给未来"也不例外：那该写成注释/TODO，而不是一份看起来会生效的内容。
   * 想写设计稿就显式 `{ strict: false }`。
   */
  | 'ABILITY_UNIMPLEMENTED'
  /**
   * 内容挂了引擎**不会派发**的 hook。
   *
   * 同 `COUNTER_UNIMPLEMENTED` 的性质：`Hook` 是一整张声明表，
   * 其中只有 `SUPPORTED_HOOKS` 会被真的处理。写进内容却不在表里的
   * hook **静默无效** —— 所以默认拒绝，而不是让人"写了却没反应"。
   */
  | 'UNSUPPORTED_HOOK'
  /**
   * 时间值不在 **0.1 秒（一个逻辑步）的刻度**上，例如 `castTime: logicMs(2.5)`
   * = 250ms。
   *
   * 与上面几条不同：这不是"引擎还没实现"，而是**内容写错了**，而且错得
   * 很安静 —— 显示会向上折到 0.3 秒、引擎按 250ms 跑，两边**差一整个
   * 刻度**，不报错、不崩、肉眼看不出来。所以照 AGENTS.md §2 的第三类
   * 处理：**校验报错拦下**。
   *
   * ⚠️ 拦哪些字段（含为什么排除 `holdDrain.perLogicTick`、`gapMs` 怎么判）
   * 全写在 `./timeGrid.ts` 的文件头 —— 判据在那里，这里只登记校验码。
   */
  | 'OFF_GRID_TIME'
  /**
   * `BuffDef.consume.on` 里有一条**引擎不会派发**的触发。
   *
   * 同 `UNSUPPORTED_HOOK` 的性质：消费触发是一张声明表，而引擎只派发
   * `core/buffs/consume.ts` 里实现的那四种。写了一条不派发的触发 ⇒
   * 那个 buff **永远不会被消费**（作者看内容却以为会）。
   */
  | 'CONSUME_TRIGGER_UNIMPLEMENTED'
  /** 写了 `consume` 却没有 `on` —— 没有任何可判的东西，buff 永远不消失。 */
  | 'CONSUME_TRIGGER_MISSING'
  /**
   * `stacking: 'independent'` 的 buff 带了 `modifiers`。
   *
   * `independent` 是"每次施加都是新实例"，而修正池会把**每个实例**的修正
   * 都展开一次 ⇒ 每层修正线性叠加、**绕过 `maxStacks` 封顶**（数值静默变大）。
   * 要让每层给修正就用 `stack` / `stackRefresh`，这条是"表达说不通"，
   * 不是"引擎还没实现"。判据在 `./capabilityAudit.ts`。
   */
  | 'INDEPENDENT_BUFF_MODIFIERS';

export interface ValidationIssue {
  readonly severity: 'error' | 'warning';
  readonly code: ValidationCode;
  /** 出问题的位置，如 `entropy-clock.abilities[2].trigger.then[0]` */
  readonly path: string;
  readonly message: string;
}
