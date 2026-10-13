/**
 * **一局肉鸽的持有者**（app 层）—— P3：**N 场 + 每场之后的炁机选择**。
 *
 * ==================================================================
 * 演进：P2 的"只跑一场"桩已经拆掉了
 * ==================================================================
 *
 * P2 时这里**刻意**只打一场（打完就 `clear()`），理由是"炁机选择是 P3"。
 * P3 把桩接真：
 *
 * ```
 * 选角色 → 第 1 场 → 结算 →（选炁机）→ 第 2 场 → … → 通关 / 失败 → 摘要
 * ```
 *
 * ⚠️ **"第一场打完了才有炁机选择"**（用户 2026-10-13 的规则第 3 条）：
 * 开局**不**进选择屏，所以 `startRoguelikeRun` 直接 `enterBattle`；
 * 选择屏只从 `advance()` 的返回值 `'selectQiji'` 进来。
 *
 * ==================================================================
 * ⚠️ 炁机选择的语义：**一局只能选一次** + **选了不能取消**（2026-10-13 定死）
 * ==================================================================
 *
 * 用户原话（两条，一起定死了肉鸽的语义）：
 *
 * > **肉鸽也改成一局只能选一次（不叠加）**
 * > **而且肉鸽里是不能把已经激活的再取消的**
 *
 * 落在本文件的是第一条（第二条落在"`chosen` 只有一个写入点、且只追加"）：
 *
 *   - `chooseQiji` **只追加**一条 `{ qijiId }`，不叠层（没有 `stacks`）
 *   - 选过的那条**不再出现在候选里**（`nextCandidates` 按 `chosen` 过滤，
 *     见 `core/run/unlock.ts`）
 *
 * ⚠️ 这一版**推翻了**原先的 `maxStacks`（"每次战斗后可以再选同一条、
 * 累积到上限"）—— 那个字段已整条删除（`data/qiji.ts` 一个字都没有了）。
 *
 * ⚠️ **自由模式不受影响**：它的炁机是备战屏上的**开关**（可以来回切，
 * 见 `ui/freeQiji.ts`），与肉鸽这条"一局一次的永久事实"是两套语义。
 *
 * ==================================================================
 * ⚠️ 它只做三件事（一条线，都是纯状态转移）
 * ==================================================================
 *
 *   1. **持有** `RunState`（跨场；`BattleLoop` 每场重建，两者都不该持有对方）
 *   2. 每场打完把"这一场的事件流 + 胜负 + 满血"喂给 `advanceRun`（P0 已实现）
 *   3. 回答"下一步去哪"（`BattleAdvance`）与"现在能选什么"（`candidates`）
 *   4. **`continueRun()`**：一局结束屏确认之后"丢掉这一局、回选角色"
 *      （与 `backToHome` 的"放弃"是**两条**路，见那里的说明）
 *
 * ⚠️ **统计不在这里算**：`RunState.battleStats` 的**唯一写入路径**是
 * `core/run/lifecycle.ts` 的 `advanceRun`（它内部调 `stats.ts` 的归约）。
 * 本文件一个加法都不写 —— 那会造出第二份真相（"截数了几次"两个答案）。
 *
 * ⚠️ **种子由调用方给**（`begin(playerId, runSeed)`），这一层不调
 * `Date.now()`：`src/app/` 允许它，但留在调用方让本模块**纯函数化**，
 * 于是能在 node 里单测"同一 runSeed → 同一 Boss 顺序 + 同一推进序列"。
 *
 * ⚠️ **随机流独立**（§7.1）：洗牌只吃传进来的 `runSeed`，绝不碰
 * `BattleState.rngSeed` / `aiRngSeed` —— 否则"一局肉鸽的随机"会同时改掉
 * 玩家侧的概率判定，黄金重放会因此变红（见 `core/run/shuffle.ts`）。
 */

import { advanceRun, nextCandidates, shuffle, startRun } from '../core/run/index';
import { runLengthOf, type RunState } from '../core/run/index';
import type { Candidate } from '../core/run/index';
import type { EntityId } from '../core/types/ids';
import type { EventDef } from '../core/events';
import type { QijiEntity } from '../core/types/qiji';

/** 创建时的依赖。 */
export interface RunSessionOptions {
  /**
   * 能打的 Boss（顺序无关 —— 这里会洗牌）。
   *
   * 生产路径传 `data/roster.ts` 的 `BOSS_POOL`（已实现的那些）。
   */
  readonly bossPool: readonly EntityId[];
  /**
   * 全部炁机（`data/qiji.ts` 的 `ALL_QIJI`）。
   *
   * ⚠️ 它是**唯一**的解锁 / 候选来源：两份池子必然漂，而漂的样子是
   * "解锁了一个不在候选里的东西"。P0 的 `advanceRun` / `nextCandidates`
   * 都把 `pool` 当参数收，就是为此。
   */
  readonly qijiPool: readonly QijiEntity[];
  /**
   * 这一局一共打几场（`?runlen=N` 的落点）。
   *
   * ⚠️ 缺省 = 池子长度（**不是** `MAX_RUN_POSITION` = 7）：设计稿 §2.3 的
   * `?runlen=7` 是**正式形态**（7 个 Boss 都做完之后），而今天只有 2 个
   * Boss 能打 —— 拿 7 当缺省会让一局永远通不了关（"7 是终点、`len` 是现实"，
   * 见 `core/run/types.ts` 的 `MAX_RUN_POSITION`）。
   *
   * ⚠️ 会**夹到 `1..池子长度`**：`?runlen=99` 就是"打完全部"。
   */
  readonly runLength?: number;
}

/**
 * 一场打完之后的去向。
 *
 * ⚠️ 它把"下一步"做成**返回值**而不是让调用方去问几个布尔：
 * `phaseFlow` 里那一串 `if (state.status === 'active') …` 会散在多处，
 * 而"该不该进选择屏"的判据（有候选）只有这里知道。
 */
export type BattleAdvance =
  | { readonly kind: 'runOver' }
  | { readonly kind: 'selectQiji' }
  | { readonly kind: 'battle'; readonly bossId: EntityId };

/** 一局肉鸽的持有者（P3：N 场 + 炁机选择）。 */
export interface RunSession {
  /** 现在是否有**没结束**的一局（= 当前战斗属于肉鸽模式）。 */
  readonly active: boolean;
  /** 起一局：用 `runSeed` 洗出 Boss 顺序、`position = 1`。 */
  begin(playerId: string, runSeed: number): void;
  /** 丢掉当前这一局（回选角色 / 离开肉鸽时调）。 */
  clear(): void;
  /**
   * **一局结束屏的确认**：丢掉这一局（开新的一局从选角色开始）。
   *
   * ⚠️ 与 `clear()` 是同一个动作，分开命名是**为了调用点能读**：
   * `continueRun` 出现在"玩家点了继续"，而 `clear` 出现在"这一局作废了"。
   * 肉鸽的失败/通关代价都是"全丢"（§2.4 / §12 决议 #1）—— **不做**
   * 任何跨局保留（那会让"一局内的解锁"与"跨局解锁"两套状态打架）。
   */
  continueRun(): void;
  /** 这一场打谁（没有进行中的一局、或位置越界时 `undefined`）。 */
  bossId(): EntityId | undefined;
  /** 这是第几场（1-based；没有进行中的一局时 `undefined`）。 */
  position(): number | undefined;
  /** 这一局一共几场（`?runlen` 生效之后的长度；没有进行中的一局时 `undefined`）。 */
  length(): number | undefined;
  /** 当前状态（调试 / 只读引用，别改它）。 */
  state(): RunState | undefined;
  /**
   * 一场打完之后推进一局肉鸽（P0 的 `advanceRun` + 候选判定）。
   *
   * @param outcome 这一场的胜负（`snapshot.status`）
   * @param events 这一场的**全部**事件（`BattleLoop.battleEvents`）
   * @param flawless 这一场是不是满血赢的（事件流里没有血量上限，推不出来）
   */
  advance(
    outcome: 'victory' | 'defeat',
    events: readonly EventDef[],
    flawless: boolean,
  ): BattleAdvance;
  /** 现在能选什么（`[]` 表示没有候选）。⚠️ 未开局时也是 `[]`。 */
  candidates(): readonly Candidate[];
  /**
   * 选一个炁机生效。
   *
   * ⚠️ **只在是候选时成功**（判定复用 `nextCandidates`，不在这里重写一遍
   * "能不能选"）—— 否则会出现"界面上没有它、代码却能选它"。
   *
   * @returns 选上了没有
   */
  chooseQiji(qijiId: EntityId): boolean;
}

export function createRunSession(options: RunSessionOptions): RunSession {
  /**
   * ⚠️ 只有这一个可变字段 —— "当前这一局"。它有两个状态（有 / 没有），
   * 所以**不需要**再加一个 `mode: 'roguelike' | 'free'` 布尔 / 枚举：
   * "有一局没结束的肉鸽"与"当前战斗是肉鸽那一场"是**同一件事**，
   * 两份真相必然会漂（例如离开肉鸽时漏改其中一个）。
   */
  let run: RunState | undefined;

  /** 这一局的总场数（起局时定死；缺省 = 池子长度，夹到 `1..len`）。 */
  const lengthOf = (orderLength: number): number => {
    const cap = options.runLength ?? orderLength;
    return Math.max(1, Math.min(Math.trunc(cap), orderLength));
  };

  /**
   * 现在能选什么。**提成局部函数**（而不是依赖 `this`）：`advance` 里也要
   * 读它，而"方法之间用 `this` 互相调用"会在 `const { advance } = session`
   * 这种解构下静默失绑 —— 本文件的调用方（`phaseFlow`）正是解构的。
   */
  const candidates = (): readonly Candidate[] => {
    if (run === undefined) return [];
    /**
     * ⚠️ 两份统计传的是**同一个** `run.battleStats`（这不是偷懒）：
     * 在"这一场刚打完"这一刻，这一场的统计**已经被并进整局了**
     * （`advanceRun` 的先累加后判定），所以 `scope: 'battle'` 与
     * `scope: 'run'` 读到同一个值。原因与分叉点写在 `core/run/lifecycle.ts`
     * 的 `unlockStatsOf` 里（那是**唯一**允许这样传的地方）。
     */
    return nextCandidates(
      options.qijiPool,
      { battleStats: run.battleStats, runStats: run.battleStats },
      run.chosen,
    );
  };

  return {
    get active(): boolean {
      return run !== undefined && run.status === 'active';
    },

    begin(playerId: string, runSeed: number): void {
      const shuffled = shuffle(options.bossPool, runSeed);
      const length = lengthOf(shuffled.length);
      run = startRun({
        runSeed,
        playerId,
        /**
         * ⚠️ **按 `?runlen` 截断顺序**（而不是另洗一次）：这一局的场数就是
         * 玩家要打的那几场，而"最后一个位置最难"由 `tierForPosition(k, len)`
         * 保证 —— 截断之后 `len` 更小，最后一个位置自动取更硬的档。
         */
        order: shuffled.slice(0, length),
      });
    },

    clear(): void {
      run = undefined;
    },

    continueRun(): void {
      run = undefined;
    },

    bossId(): EntityId | undefined {
      if (run === undefined) return undefined;
      /** `position` 是 1-based（见 `core/run/types.ts` 的两种读法）。 */
      return run.order[run.position - 1];
    },

    position(): number | undefined {
      return run?.position;
    },

    length(): number | undefined {
      return run === undefined ? undefined : runLengthOf(run);
    },

    state(): RunState | undefined {
      return run;
    },

    advance(
      outcome: 'victory' | 'defeat',
      events: readonly EventDef[],
      flawless: boolean,
    ): BattleAdvance {
      if (run === undefined) return { kind: 'runOver' };
      /**
       * ⚠️ **先累加、后判定**（`advanceRun` 内部就是这个顺序，见 §2.2）：
       * 这一场刚数够的"用了 3 次截"必须**这一场结束**就解锁 —— 顺序反了
       * 的表现是"最后一场打完才解锁的东西永远选不到"。
       */
      run = advanceRun(run, { outcome, events, flawless }, options.qijiPool);
      if (run.status !== 'active') return { kind: 'runOver' };

      /**
       * **有候选 → 进选择屏**（每场之后选 1 个生效）。
       *
       * ⚠️ 候选里**恒有**两条 `unlock: always` 的兜底炁机（在它们被选走
       * 之前），所以正常情况下一定会进选择屏 —— 用户要的"每场战斗完了
       * 有炁机选择"就是这一行。`candidates().length === 0` 只会出现在
       * "能解锁的都已经被选过了"（一局只能选一次、不叠加：选过的**不再**
       * 回到候选里）。
       */
      if (candidates().length > 0) return { kind: 'selectQiji' };

      const bossId = run.order[run.position - 1];
      /**
       * 越界只可能发生在"顺序空 / 长度算错"，那是程序错误：
       * 给 `runOver` 而不是打一个不存在的 Boss（静默失败更难查）。
       */
      if (bossId === undefined) return { kind: 'runOver' };
      return { kind: 'battle', bossId };
    },

    candidates,

    chooseQiji(qijiId: EntityId): boolean {
      if (run === undefined) return false;
      const candidate = candidates().find((c) => c.qiji.id === qijiId);
      if (candidate === undefined) return false;

      /**
       * ⚠️ **追加一条、绝不做"同一项叠一层"**（用户 2026-10-13 定死：
       * "肉鸽也改成一局只能选一次（不叠加）"）。
       *
       * 这里**不需要**判"是不是已经选过"：`candidates()` 已经把选过的
       * 滤掉了（`nextCandidates`），所以走到这里的 `qijiId` 一定不在
       * `run.chosen` 里 —— 再判一次就是同一个判据的第二份实现。
       *
       * ⚠️ 这一条同时是"**选了不能取消**"的落点：`chosen` **只有这一处
       * 写入**，而它只**追加**（没有任何"删一条 / 清空 / 减一层"的分支）。
       */
      run = { ...run, chosen: [...run.chosen, { qijiId }] };
      return true;
    },
  };
}
