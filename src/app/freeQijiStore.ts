/**
 * **自由模式的炁机激活**：集合 + 存档。
 *
 * ==================================================================
 * 它是什么（一句话，没有"和"）
 * ==================================================================
 *
 * 它是"自由模式里现在开着哪几条炁机"这份状态的**唯一持有者**：
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
 *   3. 代价可控：条目就是几个 id
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
 * 所以这里在**入口**就把不认识的 id 丢掉。
 *
 * ==================================================================
 * ⚠️ 格式迁移（2026-10-13）：`id → 层数` **读成开关**
 * ==================================================================
 *
 * 上一版把激活做成了层数（`{"vitality":2}`）—— 用户明确纠正"**炁机的激活
 * 没有层**"（见 `ui/freeQiji.ts` 的文件头）。新的存储形状是 **id 的数组**
 * （集合）：`["vitality","breath"]`。
 *
 * 老存档要能读回来，所以 `parseFreeQiji` **两种形状都认**：
 *
 * ```
 *   ["vitality"]            → 新格式（集合），原样读
 *   {"vitality":2}          → 旧格式（层数），值 > 0 ⇒ **算开着**
 *   {"vitality":0,"x":-1}   → 旧格式里的坏值，**逐条丢弃**
 * ```
 *
 * 读旧格式时 `migrated = true`，调用方（`app/deps.ts`）据此**写回**一次
 * 新格式 —— 与 `settingsStore.loadTouchButtons` 同一条"迁移只做一次"的
 * 纪律（照本仓库既有做法）。
 */

import type { StorageLike } from './settingsStore';

/** 存档 key（**只有这一处**拼它）。 */
export const KEY_FREE_QIJI = 'raid.freeQiji.v1';

/** 自由的炁机激活集合：数组里每个 id 都开着（不在里面 = 没开）。 */
export type FreeQijiSet = readonly string[];

/** 读取结果：集合 + 这次是不是**从旧格式迁移**来的（调用方据此写回）。 */
export interface FreeQijiLoad {
  readonly ids: FreeQijiSet;
  /** `true` = 存储里是旧的"id → 层数"形状，这次按开关读出来了。 */
  readonly migrated: boolean;
}

/**
 * 从原始字符串解析出激活集合（**纯函数、可单测**）。
 *
 * ⚠️ 坏 JSON / 形状不对 / 认不出的条目一律**丢掉**，而不是抛 —— 存档坏了
 * 不该让游戏起不来。丢的是**逐条**：一条坏值不影响同一次读取里的其它条。
 *
 * @param known 当前池子里认识的 id（不在里面的丢掉）。
 */
export function parseFreeQiji(raw: string | null, known: readonly string[]): FreeQijiLoad {
  if (raw === null || raw === '') return { ids: [], migrated: false };
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return { ids: [], migrated: false };
  }
  const allow = new Set(known);
  const out: string[] = [];
  const push = (id: string): void => {
    if (!allow.has(id) || out.includes(id)) return;
    out.push(id);
  };

  /**
   * ⚠️ **新格式**：id 的数组（集合）。非字符串的条目逐条丢弃。
   */
  if (Array.isArray(data)) {
    for (const entry of data) {
      if (typeof entry === 'string') push(entry);
    }
    return { ids: sortIds(out), migrated: false };
  }

  /**
   * ⚠️ **旧格式**：`{ id: 层数 }`。值 > 0（有限数）**算开着** —— 层数已经
   * 没有意义了，但"当时开过"这个事实要保住（否则玩家的配置凭空消失）。
   * `0` / 负数 / 非数 / 未知 id 一律逐条丢弃。
   */
  if (typeof data === 'object' && data !== null) {
    for (const [id, value] of Object.entries(data)) {
      const on = typeof value === 'number' && Number.isFinite(value) && value > 0;
      if (on) push(id);
    }
    return { ids: sortIds(out), migrated: true };
  }

  return { ids: [], migrated: false };
}

/**
 * 序列化：**去重 + 排序**的 id 数组。
 *
 * ⚠️ 排序让"同一份配置"永远给同一个字符串（便于对账 / 快照），
 * 与集合"顺序没有含义"的语义一致。
 */
export function serializeFreeQiji(ids: FreeQijiSet): string {
  return JSON.stringify(sortIds(ids.filter((id) => id !== '')));
}

/**
 * 读存档（坏值一律退化成空集合，见 `parseFreeQiji`）。
 *
 * ⚠️ 迁移**不在这里写回**：写回是调用方的事（`deps.ts` 照
 * `loadTouchButtons` 的先例拿 `migrated` 决定要不要 `saveFreeQiji`）——
 * 一个"读"函数不该有写副作用。
 */
export function loadFreeQiji(storage: StorageLike | undefined, known: readonly string[]): FreeQijiLoad {
  let raw: string | null = null;
  try {
    raw = storage?.getItem(KEY_FREE_QIJI) ?? null;
  } catch {
    return { ids: [], migrated: false };
  }
  return parseFreeQiji(raw, known);
}

/** 写存档（配额满 / 隐私模式下静默放弃，与 `settingsStore` 同一条纪律）。 */
export function saveFreeQiji(storage: StorageLike | undefined, ids: FreeQijiSet): void {
  try {
    storage?.setItem(KEY_FREE_QIJI, serializeFreeQiji(ids));
  } catch {
    /* 这次没存上，不影响这一局 */
  }
}

/** 去重（同一条只出现一次）+ 排序（同一份配置永远给同一个形状）。 */
function sortIds(ids: readonly string[]): readonly string[] {
  return [...new Set(ids)].sort();
}
