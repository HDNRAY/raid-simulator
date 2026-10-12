/**
 * 一局肉鸽的重放记录：序列化 + 校验。
 *
 * 设计稿：`docs/specs/2026-10-12-roguelike.md` §7.2 / §7.3 / §11 风险 #9。
 *
 * ==================================================================
 * 这一层的职责：**只有"进去"是窄的**
 * ==================================================================
 *
 * 出（`serializeRun`）：`RunRecord` → 一份能进 `localStorage` /
 * 能进 diff / 能当测试基线的东西。
 *
 * 入（`parseRecordedRun`）：`unknown` → `RunRecord`，或者 `undefined`。
 * 这是**安全边界**：存档可能被手改、被旧版本写过、写了一半（§11 风险 #9）。
 * 处理方式照抄 `settingsStore.ts` 的 `parseBindings` 那条来之不易的结论：
 * **逐项校验 + 坏数据整条丢弃 + 回落默认** —— 不要"尽力修复一半"。
 *
 * ⚠️ 为什么是"整条丢弃"而不是"逐字段回落到默认值"：半个存档比没有存档
 * 更危险。一局肉鸽的状态里 `order` / `position` / `chosen` 是**互相
 * 约束**的（`chosen` 的层数上限来自内容表、`position` 必须落在 `order`
 * 的范围里）。只修其中一半会造出一个"引擎会相信、但内部矛盾"的状态，
 * 而那种状态的报错点离原因很远（表现为某一场的 Boss 是 `undefined`）。
 *
 * ==================================================================
 * ⚠️ 与 `src/core/run.ts` 的 `RecordedRun` **不是**一回事
 * ==================================================================
 *
 * `src/core/run.ts`（单数文件）是**一场战斗**的重放：`{version, seed, ticks, input}`。
 * 本文件是**一局肉鸽**的记录：`{runFormatVersion, state, battles}`。
 * 两个版本号刻意分开（见 `RunRecord` 的说明）：引擎的确定性语义 +1 与
 * 炁机记录格式 +1 的后果完全不同。
 */

import type { EntityId } from '../types/ids';
import { isRunCounter, type RunCounter, type RunCounters } from '../types/qiji';
import type { RunBattleRecord, RunChoice, RunRecord, RunState, RunStatus } from './types';

/**
 * 一局肉鸽记录的格式版本。
 *
 * **改动记录的语义 / 字段含义时必须 +1** —— 与 `run.ts` 的
 * `REPLAY_FORMAT_VERSION` 是同一条纪律，理由也一样：旧文件在不解码
 * 的情况下被新代码读，会产生"看起来像 bug"的怪事，而版本号让那种
 * 情况变成一句明确的报错。
 *
 * 1 = P0 的初版。
 */
export const RUN_FORMAT_VERSION = 1 as const;

/* ================================================================== *
 * 1. 序列化
 * ================================================================== */

/**
 * 把一局肉鸽的记录变成一段 JSON 文本。
 *
 * ⚠️ 不做任何"美化"（不带缩进、不排序键）：内容表 / 存档的 diff 由
 * **键的插入顺序**决定，而插入顺序就是 `RunState` 的字段声明顺序。
 * 加缩进只会让 localStorage 变大（一局肉鸽里会有 7 个 `battles` 条目），
 * 而对"人能不能读懂"没有帮助 —— 要读的时候 `JSON.parse` 出来看对象
 * 比读一大段字符串容易。
 */
export function serializeRun(record: RunRecord): string {
  return JSON.stringify(record);
}

/* ================================================================== *
 * 2. 校验
 * ================================================================== */

/**
 * 解析一份序列化过的一局肉鸽记录。
 *
 * **任何一项不合法 → 返回 `undefined`**（整条丢弃），不抛异常。
 * 理由见文件头：坏存档是**预期内**的输入，不是程序错误；抛异常会让
 * "玩家的存档被别的标签页写坏"变成一局打不开的游戏。
 *
 * ⚠️ 返回 `undefined` 而不是抛错，也意味着**调用方必须处理它**
 * （TS 的 `strict` 会逼着做，因为 `RunRecord | undefined`）。
 *
 * 版本不匹配 **也**返回 `undefined`（而不是像 `replayRun` 那样抛错）：
 * `replayRun` 的入参是**测试与工具**提供的重放文件（开发者错误 → 英文
 * 抛错），而这里的入参是**用户的存档**（版本旧了是常态 → 丢弃重开）。
 * 两者对"版本不匹配"的正确反应天生不同，所以刻意不一致。
 */
export function parseRecordedRun(raw: unknown): RunRecord | undefined {
  const root = asRecord(raw);
  if (root === undefined) return undefined;
  if (root['runFormatVersion'] !== RUN_FORMAT_VERSION) return undefined;

  const state = parseRunState(root['state']);
  if (state === undefined) return undefined;

  const rawBattles = root['battles'];
  if (!Array.isArray(rawBattles)) return undefined;
  const battles: RunBattleRecord[] = [];
  for (const entry of rawBattles) {
    const battle = parseBattleRecord(entry, state.order.length);
    if (battle === undefined) return undefined;
    battles.push(battle);
  }

  return { runFormatVersion: RUN_FORMAT_VERSION, state, battles };
}

/**
 * 解析一局肉鸽的**状态**。
 *
 * 与 `parseRecordedRun` 分开导出：`RunState` 单独也有用处（例如 P6/P7
 * 只存状态、战斗记录另存）。两个入口共用同一份逐字段校验。
 *
 * ⚠️ `unlocked` / `chosen` **不做"去重 / 排序"之类的清洗**：它们是
 * `RunState` 的一部分，`RunState` 的生成路径（`lifecycle.ts`）保证
 * 只增不减且保序。这里若顺手"修一下"，就会掩盖"生成路径写错了"
 * 这种真正该在测试里暴露的问题。
 */
export function parseRunState(raw: unknown): RunState | undefined {
  const source = asRecord(raw);
  if (source === undefined) return undefined;

  const runSeed = source['runSeed'];
  const playerId = source['playerId'];
  const order = parseIdArray(source['order']);
  const position = source['position'];
  const status = parseStatus(source['status']);
  const counters = parseCounters(source['counters']);
  const unlocked = parseIdArray(source['unlocked']);
  const chosen = parseChoices(source['chosen']);
  const label = parseLabel(source['label']);

  if (typeof runSeed !== 'number' || !Number.isFinite(runSeed)) return undefined;
  if (typeof playerId !== 'string' || playerId.length === 0) return undefined;
  if (order === undefined) return undefined;
  if (typeof position !== 'number' || !Number.isInteger(position)) return undefined;
  if (status === undefined) return undefined;
  if (counters === undefined) return undefined;
  if (unlocked === undefined) return undefined;
  if (chosen === undefined) return undefined;

  /**
   * `position` 的合法范围是 `1..order.length + 1`（**这一局的长度**）：
   *   - `1..len`：还在打（`active`）或死在这一场（`defeat`）
   *   - `len + 1`：打赢了最后一场，通关时才会停在这里
   *
   * ⚠️ 上限读**这一份数据自己的 `order`**，不读 `MAX_RUN_POSITION` ——
   * 通关判据是"打完 `order` 的最后一个"（见 `lifecycle.ts` 的文件头），
   * 所以开发期 2 个 Boss 的局合法停在 3，而不是必须停在 8。
   * 拿常量当上限会让"一局 2 个 Boss 的通关存档"被当成坏数据丢掉。
   *
   * `1..len` 这个下界在 `len === 0`（顺序还没定）时只允许 `position = 1`，
   * 与 `startRun` 的产出一致。
   */
  if (position < 1 || position > order.length + 1) return undefined;

  /**
   * 终局一致性：`victory` 只可能停在 `len + 1`；`active` / `defeat`
   * 只可能停在 `1..len`（⚠️ 长度为 0 时只允许 `position = 1` —— 那是
   * `startRun` 的产出，"顺序还没定"的合法存档）。
   *
   * ⚠️ `len = 0` 这一格踩过一次，记下来：无脑写 `position > len` 会把
   * 唯一的合法值（`position = 1`）也拒掉，于是**一局刚起、还没定顺序的
   * 存档读不回来**（症状是"刷新页面后这一局没了"）。必须显式处理
   * `len = 0`。
   *
   * ⚠️ 这条断言**不是冗余**：它是"`status` 与 `position` 是两个字段、
   * 但必须互相自洽"这件事唯一的机器检查。没有它，一份
   * `{status:'victory', position:1}` 的坏数据会一路进到 UI，表现为
   * "通关了但一场没打"。
   */
  if (status === 'victory' && position !== order.length + 1) return undefined;
  if (status !== 'victory' && order.length > 0 && position > order.length) return undefined;

  return {
    runSeed: runSeed >>> 0,
    playerId,
    order,
    position,
    status,
    counters,
    unlocked,
    chosen,
    label,
  };
}

/**
 * 解析一场战斗的记录。
 *
 * `runLength` 是**这一局的场数**（= `state.order.length`），由调用方传进来：
 * 上限是它，不是 `MAX_RUN_POSITION` —— 与 `parseRunState` 同一个理由
 * （开发期短局的第 2 场是合法的，第 8 场不是）。
 */
function parseBattleRecord(raw: unknown, runLength: number): RunBattleRecord | undefined {
  const source = asRecord(raw);
  if (source === undefined) return undefined;

  const position = source['position'];
  const bossId = source['bossId'];
  const seed = source['seed'];
  const outcome = source['outcome'];

  if (typeof position !== 'number' || !Number.isInteger(position)) return undefined;
  if (position < 1 || position > runLength) return undefined;
  if (typeof bossId !== 'string' || bossId.length === 0) return undefined;
  if (typeof seed !== 'number' || !Number.isFinite(seed)) return undefined;
  if (outcome !== 'victory' && outcome !== 'defeat') return undefined;

  return { position, bossId, seed: seed >>> 0, outcome };
}

/* ================================================================== *
 * 3. 逐字段的小解析器
 * ================================================================== */

/**
 * 把一个未知值当"对象字典"读。
 *
 * 这是**唯一**需要承认"`unknown` 可能是个对象"的地方，用类型谓词
 * 写出来（AGENTS.md §1 的第二种场景：运行期数据未经校验 → 写类型守卫），
 * 于是下面所有字段访问都是 `Record<string, unknown>` 上的下标 ——
 * 每个下标的结果仍然是 `unknown`，**必须**再逐项校验。
 *
 * ⚠️ 为什么不写 `raw as Record<string, unknown>`：
 *   1. 那是 AGENTS.md §1 禁止的"让报错消失"的写法（这里是 `as` 的
 *      最坏情形：它把"运行期没验证过"伪装成"类型上已验证"）
 *   2. 断言**不拦数组**。`parseRunState([1, 2, 3])` 会得到一个
 *      `runSeed === undefined` 的对象，于是一路走到"未知字段"的分支 ——
 *      最终结果也是 `undefined`，但中间的每一步都在读一个数组的字符串键，
 *      而任何一处漏判都会静默变成"一个字段全是 undefined 的合法状态"。
 *      显式判 `Array.isArray` 让这条路径**根本进不来**。
 */
function asRecord(raw: unknown): Record<string, unknown> | undefined {
  return typeof raw === 'object' && raw !== null && !Array.isArray(raw)
    ? (raw as Record<string, unknown>)
    : undefined;
}

/** 非空字符串数组（`order` / `unlocked`）。`[]` 合法（还没定顺序 / 开局）。 */
function parseIdArray(raw: unknown): EntityId[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const out: EntityId[] = [];
  for (const entry of raw) {
    if (typeof entry !== 'string' || entry.length === 0) return undefined;
    out.push(entry);
  }
  return out;
}

function parseStatus(raw: unknown): RunStatus | undefined {
  return raw === 'active' || raw === 'victory' || raw === 'defeat' ? raw : undefined;
}

/** 只保留**已知**的计数器键；值必须是有限数。未知键**整条丢弃**。 */
function parseCounters(raw: unknown): RunCounters | undefined {
  if (raw === undefined || raw === null) return {};
  const source = asRecord(raw);
  if (source === undefined) return undefined;

  const out: Partial<Record<RunCounter, number>> = {};
  for (const [key, value] of Object.entries(source)) {
    if (!isRunCounter(key)) return undefined;
    if (typeof value !== 'number' || !Number.isFinite(value)) return undefined;
    out[key] = value;
  }
  return out;
}

function parseChoices(raw: unknown): RunChoice[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const out: RunChoice[] = [];
  for (const entry of raw) {
    const source = asRecord(entry);
    if (source === undefined) return undefined;
    const qijiId = source['qijiId'];
    const stacks = source['stacks'];
    if (typeof qijiId !== 'string' || qijiId.length === 0) return undefined;
    if (typeof stacks !== 'number' || !Number.isInteger(stacks) || stacks < 1) return undefined;
    out.push({ qijiId, stacks });
  }
  return out;
}

/**
 * `label`：**缺失或 `undefined` 都回落成 `undefined`**（注意不是 `''`）。
 *
 * 这里是"统一形状"落点：`lifecycle.ts` 的 `startRun` 总是写这个键，
 * 而 `JSON.stringify` 会把值为 `undefined` 的键丢掉 —— 所以一份
 * 往返过的记录会**缺这个键**。解析器把它补回 `undefined`，于是
 * "往返前与往返后 `toEqual`"这条验收成立，而不用给 `RunState`
 * 加一个"可选字段"（见 `RunState.label` 的说明）。
 */
function parseLabel(raw: unknown): string | undefined {
  return typeof raw === 'string' ? raw : undefined;
}
