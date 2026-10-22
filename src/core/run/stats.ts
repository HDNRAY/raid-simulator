/**
 * 从**事件流**归约出一场战斗的统计，并把它累加成整局统计（§5.2 的方向修正）。
 *
 * ==================================================================
 * 这个文件是什么（一句话，没有"和"）
 * ==================================================================
 *
 * 它是"**造数**"那一半：`EventDef[]` 进去，`BattleStats` 出来
 * （`reduceBattleStats`），以及把若干份 `BattleStats` 加起来
 * （`mergeBattleStats`）。
 *
 * ⚠️ **读数**（把"对统计的查询"翻译成数字）在 `query.ts` —— `Q-a` 之前
 * 这两半挤在一个 514 行的 `stats.ts` 里，而那个文件的名字说不清它到底是
 * 哪一半。拆的理由与边界见 `query.ts` 的文件头。
 *
 * ==================================================================
 * 为什么不必在引擎里写计数器：**事件流里已经有全部信息**
 * ==================================================================
 *
 * 第一版的设计是"在引擎里写计数器（W1/W2/W3），一局肉鸽去读快照里的计数"。
 * 用户否掉了它，原话是：
 *
 * > 如果**直接从 log 判断** 而不是又加一层记录呢
 *
 * 那个否定是对的，而且**在这个仓库里格外成立**：`BattleState` 已经被
 * 黄金重放逐位钉死，往它里面加"计数器"字段意味着
 *   ① 一处**与事件流并行的第二份真相**（两处会漂，漂了以后
 *      "截到底数了几次"有两个不同的答案）
 *   ② 它是**唯一可能改动确定性语义**的改动（多一个随战斗推进的字段）
 * 而事件流本来就是**输出**、本来就带 `sourceId` / `skillId` / `amount`，
 * 所以统计只是"读一遍输出、做加法"——**纯函数、零状态、可在 Node 单测**。
 *
 * ==================================================================
 * ⚠️ 读 `EventDef[]`，**不是** `LogEntry[]`
 * ==================================================================
 *
 * 用户说"从 log 读取"，但**真正的源头是 `EventDef[]`**：
 *
 * | | `EventDef[]`（本文件的输入） | `LogEntry[]`（`app/logFormat.ts` 的产出） |
 * |---|---|---|
 * | 位置 | `core/`（零依赖，可单测） | `app/`（碰 DOM / i18n，**不能单测**） |
 * | 完整度 | **全量**（每个事件都在） | **丢噪声**（若干 kind 不产生日志行） |
 * | 数量 | 全量 | 有 `limit`（**截断**，超出的直接丢） |
 * | 内容 | 结构化字段（`skillId` / `amount` / `reason`） | 已格式化的 i18n 文案 |
 *
 * 拿 `LogEntry[]` 统计会**静默少算**（噪声被丢、超限被截），而且
 * "文案变成数字"这一步本身就要解析字符串。所以统计层钉在 `EventDef[]`。
 */

import type { EventDef } from '../events';
import type { CombatantId, SkillId } from '../types/ids';
import type { BattleOutcomeRecord } from './outcome';

/**
 * 逐个技能统计出来的维度。
 *
 * ⚠️ 值是 `Readonly<Record<SkillId, number>>`（plain object，不是 `Map`）：
 * 这是要进 `RunState` / 存档 / JSON 的东西，必须可结构化克隆
 * （§7.3、lint C5）。缺键 = 0，读的时候走 `query.ts` 的 `skillStatValue`。
 */
export type SkillCounts = Readonly<Record<SkillId, number>>;

/**
 * 一场战斗的统计 —— **同时也是"整局累加"的容器**。
 *
 * ==================================================================
 * 为什么一个类型兼任两者（本文件最重要的一条设计决定）
 * ==================================================================
 *
 * `scope: 'run'` 的那一份**不是**另一种数据，它就是"把每场的这份结构
 * 逐字段加起来"。所以它天然是**同一个类型**
 * （`mergeBattleStats: (BattleStats, BattleStats) => BattleStats`）。
 *
 * 换个角度说：**累加器就是整局统计**。不需要第二套结构，也不需要
 * `RunState` 再存一份"一局肉鸽的计数"—— 那就是第二份真相了。
 *
 * ==================================================================
 * 为什么每个维度都是"按技能分的表"，而不是一个总数
 * ==================================================================
 *
 * 用户要的问题是"**某个技能**造成多少伤害"、"用了 n 次 a 和 m 次 b"——
 * 这些都要求**按技能拆开**。若这里只存 `totalDamage: number`，
 * 那么"把「截」和「破」分开数"就永远做不到，只能回去重新归约。
 *
 * 总数是**派生量**，用 `query.ts` 的 `sumCounts` 现算 —— 不在这里再存一份。
 * 维度只有 5 个（3 个是用户点名要的 + 2 个是同一批事件里顺手就能拿到的）。
 * **加维度只改这个界面**，`QijiUnlock` 一个字都不用动。
 *
 * ==================================================================
 * ⚠️ `battles` 为什么是"逐场结果数组"而不是"赢了几场"这个数
 * ==================================================================
 *
 * `battlesWon: number` 看着很自然，但它是**结论**，而且会与逐场的事实
 * 形成两条独立累加路径（一旦漂开，"这一局赢了几场"有两个答案）。
 * 存**逐场结果**则：
 *   - 它是**日志**（可审计：第 3 场赢了、第 4 场输了，一目了然）
 *   - 长度 = 已经打过的场数（**可校验**：`record.ts` 会与
 *     `RunRecord.battles` 做长度 / 次序 / 胜负 / 满血的**对账**）
 *   - "赢了几场"是**过滤**（`query.ts` 的 `battlesWon`），不是累加
 * 累加就是数组拼接 —— 从"结论"变回"事实"，这一层就没有可漂的第二份真相。
 */
export interface BattleStats {
  /** `skillUsed` 的次数（含派生技）。 */
  readonly skillUses: SkillCounts;
  /** `damage` 事件里 `sourceId === actorId` 的 `amount` 之和（**按 `skillId` 分**）。 */
  readonly skillDamage: SkillCounts;
  /** `damage` 事件的**条数**（按 `skillId` 分）。⚠️ 与 `skillDamage` 是**两个**维度。 */
  readonly skillHits: SkillCounts;
  /** **成功打断**的次数（按 `interruptSuccess.sourceSkillId` 分）。 */
  readonly skillInterrupts: SkillCounts;
  /**
   * **累计消耗的资源**（按资源名分：`douqi` / `energy`），只数**负向**
   * `resourceChanged`（2026-10-22，为「缠尽还生」的解锁加）。
   *
   * ⚠️ 与 `skillUses` 不是一回事：一个技能可以花 40 缠，也可以花 0 ——
   * "累计消耗了多少缠"只有事件流知道。
   */
  readonly resourceSpent: Readonly<Record<string, number>>;
  /**
   * **成功用出来的防御**次数（按 `avoided.viaBuffId` 分：`guard` / `flash-iframe`…）。
   *
   * ==================================================================
   * 为什么它是"按 buff 分"，而不是复用 `dodges`
   * ==================================================================
   *
   * 用户 2026-10-13 要的三条解锁里有两条**不是打断**：
   *
   * | 源技能 | 什么叫"用出来了" | 事件 |
   * |---|---|---|
   * | 「截」 | 真的打断了一个读条 | `interruptSuccess.sourceSkillId` |
   * | 「卸」 | 阈值**挡下了整击**（`≤N`） | `avoided.viaBuffId === 'guard'` |
   * | 「闪」 | 无敌窗口**真的吃掉了一击** | `avoided.viaBuffId === 'flash-iframe'` |
   *
   * `dodges` 那张表**按 `reason` 分**（`dodged` / `immune`），拿不到"是哪个
   * buff"—— 而 `invulnerable` 这个 flag 被「闪」与「避」**两个角色**的技能
   * 共用。用它去回答"闪用了几次"会把「避」的次数算进去。
   *
   * ⚠️ 与 `skillInterrupts` 是**两个**维度，不要合并：一个技能可以既是打断
   * 又是防御（将来的设计），而两者的事件来源完全不同（`interruptSuccess`
   * vs `avoided`）。合并会让"截数了几次"有两个口径。
   *
   * ⚠️ 缺键 = 0：`viaBuffId` 是**可选**字段，没有它的 `avoided`
   * （触发器产的免伤）不记账 —— 那种事件的真实语义是"不知道是什么挡的"。
   */
  readonly skillAvoids: SkillCounts;
  /**
   * `avoided` 事件的次数（按 `reason` 分：`dodged` 是真闪避，`immune` 是免疫）。
   *
   * ⚠️ 不分技能：`avoided.skillId` 是**被闪掉的那个招式**（攻击者的），
   * 不是闪避者用的招式 —— 拿它当"谁闪的"会数错（与 §③ 同一个陷阱）。
   *
   * ⚠️ `immune` 这个桶**现在没有查询能拿到**（`query.ts` 的 `dodges`
   * 只数 `dodged`，因为"成功闪避"指的是真的闪开）。符合"死值先删"，
   * 但归约照收 —— **将来要数免疫时，这里是第一个要改的地方**：
   * 加一个 `{ s: 'immunes' }` 查询即可，**不要**改 `dodges` 的语义
   * （那会让已经写好的"闪避流"炁机的数字突然变大）。
   */
  readonly dodges: Readonly<Record<string, number>>;
  /** 战斗进行的 tick 数（最后一个事件的 tick）。累加时**相加**（= 整局总时长）。 */
  readonly ticks: number;
  /**
   * 逐场结果。**只对"若干场"的统计有意义。**
   *
   * ⚠️ 归约**单场**时**不设置**它（那一场的结果调用方已经知道，
   * 就在 `scope.outcome` / `scope.flawless` 里）—— 所以它是可选的，
   * 由 `mergeBattleStats` 或 `lifecycle.ts` 的 `battleStatsFor` 来装。
   * 保留可选是为了不给单场结果造一个"只有一个元素的数组"这种假结构。
   */
  readonly battles?: readonly BattleOutcomeRecord[];
}

/*
 * ⚠️ **这里没有整局汇总的 `flawless` 字段，是刻意删掉的（`Q-f`）。**
 *
 * 它曾经存在（`flawless?: boolean`，累加时取最近一场）。删它的理由：
 *   - **逐场**的满血标记在 `battles[].flawless` 里 —— 那才是
 *     "满血赢了几场"（`flawlessBattles` 查询）的来源
 *   - 一个没有消费者的字段，下一个人会**去找它的读者**，找不到就**猜**
 *     （而"整局是不是满血赢的"这个问题本身也没有意义）
 * 所以整局这一层不需要它。`BattleStatsScope.flawless` 仍然**必填** ——
 * 它是"这一场满不满血"的**输入**，被装进 `battles[0].flawless`。
 */

/** 空统计（累加的起点 / "还没打过"）。 */
export const EMPTY_BATTLE_STATS: BattleStats = {
  skillUses: {},
  skillDamage: {},
  skillHits: {},
  skillInterrupts: {},
  skillAvoids: {},
  resourceSpent: {},
  dodges: {},
  ticks: 0,
  battles: [],
};

/**
 * 归约器的输入：不只是 `EventDef[]`，还要知道**"我方"是谁**、
 * 以及**这一场的结果**。
 *
 * ⚠️ `actorId` 不是可有可无的：
 *   - `damage` 事件两边都会发（玩家打 Boss、Boss 打玩家）。不筛
 *     `sourceId` 的话，"「截」造成多少伤害"会把 Boss 打玩家的伤害也算进
 *     玩家的招式里 —— 而两者常常**用同一个 `skillId`**（派生技）。
 *   - `skillUsed` 两个阵营都会发。不筛的话，"本场用了 3 次截"会把
 *     Boss 的出招也算进来。
 *   - `avoided` 要按 `targetId` 筛（谁被打了但躲掉了）。
 *
 * 所以归约是"**从某个视角看这一场**"，而视角必须显式传进来。
 */
export interface BattleStatsScope {
  /** 以**谁**的视角统计（通常是 `'player'`）。 */
  readonly actorId: CombatantId;
  /**
   * 这一场的结果。**必填**（`Q-b`）。
   *
   * ⚠️ 必填是刻意的：事件流里其实有 `encounterEnd`，但"调用方已经知道
   * 结果"与"归约器再去事件里找一遍"是两件事 —— 而让调用方显式传，是
   * **"少传一个参数就编译不过"**的保护。
   *
   * 若它可选（带默认值），忘记传的表现是"这一场被记成没过"
   * → `battlesWon` **永远少一场** → 某个炁机永远解锁不了，
   * 而没人知道为什么。这类**静默失效**正是这一整轮在清的东西。
   */
  readonly outcome: 'victory' | 'defeat';
  /**
   * 这一场是不是**满血赢的**。**必填**（理由同上）。
   *
   * 事件流里没有"血量上限"，所以这个事实推不出来 —— 由知道 hp / caps
   * 的那一层（app / `lifecycle.ts`）算好喂进来。
   * 它被装进 `battles[0].flawless`，也就是 `flawlessBattles` 的唯一来源。
   */
  readonly flawless: boolean;
}

/**
 * `EventDef[]` → `BattleStats`。**纯函数，无副作用。**
 *
 * 一次遍历、O(n)，不需要排序也不需要额外状态：事件数组本身就是
 * **时间顺序**（引擎 push 的顺序），而后面的查询都是求和 / 计数，
 * 与顺序无关。
 *
 * ⚠️ 刻意**不**接收 `BattleState` / 引擎实例：只要一个数组（+ 视角 /
 * 结果 / 满血标记）就能算，所以测试可以直接**喂手工构造的事件数组**
 * （验收要求"喂数组就能测、不起引擎"）。这也让"这个统计对不对"与
 * "引擎怎么跑"解耦 —— 引擎的行为变化不会让统计测试变成噪音。
 *
 * ⚠️ 归约**不含** `battles`（那是"若干场"的骨架）：单场的结果已经在
 * `scope.outcome` / `scope.flawless` 里，由调用方决定要不要装进
 * `battles`（`lifecycle.ts` 的 `battleStatsFor` 会装）。
 */
export function reduceBattleStats(
  events: readonly EventDef[],
  scope: BattleStatsScope,
): BattleStats {
  const skillUses: Record<string, number> = {};
  const skillDamage: Record<string, number> = {};
  const skillHits: Record<string, number> = {};
  const skillInterrupts: Record<string, number> = {};
  const skillAvoids: Record<string, number> = {};
  const resourceSpent: Record<string, number> = {};
  const dodges: Record<string, number> = {};
  let ticks = 0;

  for (const event of events) {
    if (event.tick > ticks) ticks = event.tick;

    switch (event.kind) {
      case 'skillUsed': {
        if (event.sourceId !== scope.actorId) break;
        skillUses[event.skillId] = (skillUses[event.skillId] ?? 0) + 1;
        break;
      }
      case 'damage': {
        if (event.sourceId !== scope.actorId) break;
        /**
         * ⚠️ 按 `skillId` **分组**，不是把 `amount` 加进一个总数。
         * 这正是用户第一条要求："某个技能造成伤害数"。
         *
         * `skillId === ''` 表示"不是技能打的"（触发器产出的反伤，
         * 见 `EventDef` 的说明）—— 照常记在 `''` 这个键下，不特判：
         * 它确实产生了伤害，抹掉会让"总伤害"对不上；而"要不要算进
         * 某个炁机的条件"由那个条件自己写 `skillId` 决定
         * （`''` 不会被任何真实的技能 id 命中）。
         */
        skillDamage[event.skillId] = (skillDamage[event.skillId] ?? 0) + event.amount;
        skillHits[event.skillId] = (skillHits[event.skillId] ?? 0) + 1;
        break;
      }
      case 'interruptSuccess': {
        if (event.sourceId !== scope.actorId) break;
        /**
         * ⚠️ 用 `sourceSkillId`（**打断者用的招式**），不是 `skillId`
         * （被打断的那个读条）。这是 **③** 那个引擎缺口的全部意义：
         * 在此之前"用截打断"与"用破打断"在这个事件里长得一样，
         * 所以"用截打断 3 次"根本无法表达。
         *
         * 没有 `sourceSkillId`（打断来源不是技能）时**不记**：
         * 记进 `''` 会让"非技能的打断"与"某个 id 恰好是空串的技能"
         * 混在一个桶里，而这个桶的真实语义是"不知道是什么招"。
         */
        if (event.sourceSkillId === undefined) break;
        skillInterrupts[event.sourceSkillId] =
          (skillInterrupts[event.sourceSkillId] ?? 0) + 1;
        break;
      }
      case 'resourceChanged': {
        /**
         * 只数**花出去**的（delta < 0），且只数**这个视角的人**——
         * 与其它维度同一条"按 actorId 过滤"的口径。
         */
        if (event.targetId === scope.actorId && event.delta < 0) {
          const key = String(event.resource);
          resourceSpent[key] = (resourceSpent[key] ?? 0) + -event.delta;
        }
        break;
      }
      case 'avoided': {
        if (event.targetId !== scope.actorId) break;
        dodges[event.reason] = (dodges[event.reason] ?? 0) + 1;
        /**
         * ⚠️ 另记一张表（`skillAvoids`），按 **`viaBuffId`** 分。
         *
         * 这是 P3 的三条"用了 3 次"里**非打断**那两条的来源：「卸」与「闪」
         * 从来不发 `interruptSuccess`，它们的成功证据就是"这一击被自己
         * 挡下了"。用 `reason` 分不出来是哪个 buff（见 `BattleStats.skillAvoids`
         * 的说明），所以用 `viaBuffId`。
         *
         * ⚠️ 没有 `viaBuffId` 的 `avoided` **不记**（触发器产的免伤没有
         * "哪个技能"可写）—— 与 `skillInterrupts` 对缺 `sourceSkillId` 的
         * 处理同一条。
         */
        if (event.viaBuffId === undefined) break;
        skillAvoids[event.viaBuffId] = (skillAvoids[event.viaBuffId] ?? 0) + 1;
        break;
      }
      default:
        /**
         * 其余事件与统计无关（`heal` / buff / 读条 / 资源 / `encounterEnd`…）。
         *
         * ⚠️ 这里**不报警**：`EventDef` 是一个会持续长的联合，
         * 新事件默认"与统计无关"是正确且最省事的默认值。要统计新的
         * 维度时，在上面加一个 `case` + 在 `BattleStats` 加一张表即可。
         */
        break;
    }
  }

  return {
    skillUses,
    skillDamage,
    skillHits,
    skillInterrupts,
    skillAvoids,
    resourceSpent,
    dodges,
    ticks,
  };
}

/**
 * 累加两份统计（`scope: 'run'` 的落点）。
 *
 * ⚠️ **这个函数就是"一局肉鸽的累计"**：`RunState` 不另存计数器，
 * 累加结果本身就是整局统计。
 *
 * `battles` 拼接（顺序即时间顺序）。
 */
export function mergeBattleStats(a: BattleStats, b: BattleStats): BattleStats {
  return {
    skillUses: addCounts(a.skillUses, b.skillUses),
    skillDamage: addCounts(a.skillDamage, b.skillDamage),
    skillHits: addCounts(a.skillHits, b.skillHits),
    skillInterrupts: addCounts(a.skillInterrupts, b.skillInterrupts),
    skillAvoids: addCounts(a.skillAvoids, b.skillAvoids),
    /** 累计量按资源名相加（与其它 `*Counts` 同一条）。 */
    resourceSpent: addCounts(a.resourceSpent, b.resourceSpent),
    dodges: addCounts(a.dodges, b.dodges),
    ticks: a.ticks + b.ticks,
    battles: [...(a.battles ?? []), ...(b.battles ?? [])],
  };
}

/**
 * 若干份统计的累加（`battles.reduce(mergeBattleStats)` 的封装）。
 *
 * 空数组 → `EMPTY_BATTLE_STATS`（"一局肉鸽刚开始"）。
 */
export function mergeAllBattleStats(all: readonly BattleStats[]): BattleStats {
  return all.reduce<BattleStats>(mergeBattleStats, EMPTY_BATTLE_STATS);
}

/* ------------------------------------------------------------------ *
 * 内部：计数表相加
 * ------------------------------------------------------------------ */

/** 两张计数表相加（缺键 = 0）。**参数化键类型是为了 `dodges` 也能用。** */
function addCounts(
  a: Readonly<Record<string, number>>,
  b: Readonly<Record<string, number>>,
): Record<string, number> {
  const out: Record<string, number> = { ...a };
  for (const key of Object.keys(b)) out[key] = (out[key] ?? 0) + (b[key] ?? 0);
  return out;
}
