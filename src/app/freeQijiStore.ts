/**
 * **自由模式的炁机激活**：层数表 + 存档。
 *
 * ==================================================================
 * 它是什么（一句话，没有"和"）
 * ==================================================================
 *
 * 它是"自由模式里现在开着哪几条炁机、各几层"这份状态的**唯一持有者**：
 * 读（含版本与池子校验）、写、以及"这一局开战时交给
 * `buildPlayerKit` 的那张表"这个翻译。
 *
 * ==================================================================
 * ⚠️ 为什么不用 `settingsStore`
 * ==================================================================
 *
 * `app/settingsStore.ts` 已经是 647 行（离上限 700 只剩 53），而且它管的是
 * **输入配置**（键位 / 触屏槽位 / 操作方式 / UI 缩放）—— 那是"这台机器
 * 怎么操作"，与"这一局带哪些强化"是两件事。塞进去会让那个文件的
 * "一句话描述"变成"输入配置**以及**炁机"，正是 AGENTS.md §3 要拦的形状。
 *
 * ⚠️ 复用的是**形状**而不是文件：`StorageLike` 与 `readRaw`/`writeRaw`
 * 那套错误处理是 `settingsStore` 先立的，这里 import 同一份接口，
 * 不另写一个"长得像的"。
 *
 * ==================================================================
 * ⚠️ 状态存哪：**localStorage（按用户判断）**，不是只在本会话
 * ==================================================================
 *
 * 判据：
 *
 *   1. 同一屏上的**选择**（人物 / Boss）已经进存档（`raid.pick.*.v1`）——
 *      炁机是同一层次的"我下次还想这么配"，只存内存会让"选了三个炁机、
 *      刷新一下全没了"变成一个**看起来像 bug** 的行为
 *   2. 它是**偏好**不是战果：不像肉鸽的 `RunState.chosen`（那一局的账本，
 *      局散即弃），自由模式的配置是玩家攒出来的一套组合
 *   3. 代价可控：条目是 `{ qijiId: stacks }`，几条而已
 *
 * ⚠️ **不与肉鸽的 `RunState.chosen` 共用一个 key**：那一份必须"每局重来"
 * （`runSession.clear()` 会丢），而这一份必须**留着**。共用会让"开一局
 * 肉鸽"顺手清掉玩家的自由模式配置。
 *
 * ==================================================================
 * ⚠️ 读回来必须**过一遍当前池子**
 * ==================================================================
 *
 * 存档里的 id 可能来自旧版本（炁机改名 / 删除 —— 这一周就发生过一次：
 * 池子从 5 条变 8 条、有两条改了 id）。直接信它会让"这里有一条不存在的
 * 炁机"一路静默到 `buildPlayerKit`（那里只认 `qijiById` 找得到的 id，
 * 找不到就丢掉 —— 于是玩家的某一条**静默失效**）。
 * 所以这里在**入口**就把不认识的键、非法的层数丢掉。
 */

import type { StorageLike } from './settingsStore';

/** 存档 key（**只有这一处**拼它）。 */
export const KEY_FREE_QIJI = 'raid.freeQiji.v1';

/** 自由的炁机层数表：`id → 已叠层数`（缺键 = 没开）。 */
export type FreeQijiMap = Readonly<Record<string, number>>;

/**
 * 从原始字符串解析出层数表。
 *
 * ⚠️ 纯函数、可单测：坏 JSON / 形状不对 / 层数是 `NaN` / 负数一律
 * **当成"没开"**丢掉，而不是抛 —— 存档坏了不该让游戏起不来。
 *
 * @param known 当前池子里认识的 id（不在里面的键丢掉）。
 * @param capOf 每条的上限（`maxStacks`）；解析时**夹一下**，
 *   这样"上限从 3 改成 1"之后老存档不会带着 3 层进战斗。
 */
export function parseFreeQiji(
  raw: string | null,
  known: readonly string[],
  capOf: (id: string) => number,
): FreeQijiMap {
  if (raw === null || raw === '') return {};
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return {};
  }
  if (typeof data !== 'object' || data === null || Array.isArray(data)) return {};
  const allow = new Set(known);
  const out: Record<string, number> = {};
  for (const [id, value] of Object.entries(data)) {
    if (!allow.has(id)) continue;
    /**
     * ⚠️ 非数字 / 非有限值 / **非正数**一律丢掉（而不是夹成 1）：
     * `0` 或负数只可能来自**坏存档**，把坏数据"修好"成 1 层会让玩家
     * 莫名其妙多一条强化，而丢掉它只是回到"没开"——那是安全的默认。
     */
    if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) continue;
    const stacks = Math.min(Math.floor(value), Math.max(1, capOf(id)));
    /** ⚠️ 0 层不写进表（与 `prepareLogic.withStacks` 同一约定：缺键 = 没开）。 */
    if (stacks > 0) out[id] = stacks;
  }
  return out;
}

/** 序列化（只留开着的那些键 —— 层数表里不该出现 0）。 */
export function serializeFreeQiji(map: FreeQijiMap): string {
  const out: Record<string, number> = {};
  for (const id of Object.keys(map).sort()) {
    const value = map[id];
    if (value === undefined || value <= 0) continue;
    out[id] = value;
  }
  return JSON.stringify(out);
}

/** 读存档（坏值一律退化成空表，见 `parseFreeQiji`）。 */
export function loadFreeQiji(
  storage: StorageLike | undefined,
  known: readonly string[],
  capOf: (id: string) => number,
): FreeQijiMap {
  let raw: string | null = null;
  try {
    raw = storage?.getItem(KEY_FREE_QIJI) ?? null;
  } catch {
    return {};
  }
  return parseFreeQiji(raw, known, capOf);
}

/** 写存档（配额满 / 隐私模式下静默放弃，与 `settingsStore` 同一条纪律）。 */
export function saveFreeQiji(storage: StorageLike | undefined, map: FreeQijiMap): void {
  try {
    storage?.setItem(KEY_FREE_QIJI, serializeFreeQiji(map));
  } catch {
    /* 这次没存上，不影响这一局 */
  }
}
