/**
 * **调试探针**：把战斗状态摊平成一份可读快照。
 *
 * ==================================================================
 * 为什么单独一个文件
 * ==================================================================
 *
 * `main.ts` 是"装配流水账"，而这段**不属于装配** —— 它是一份纯数据投影，
 * 被端到端脚本与调试面板读取。抽出来有两个好处：
 *   - `main.ts` 少一坨（它长期贴着 700 行上限）
 *   - 投影逻辑可单独演进（加字段不用动装配代码）
 *
 * ==================================================================
 * ⚠️ 每个字段要么是**活读数**，要么是**写明了的基线**
 * ==================================================================
 *
 * 这个探针是"战斗里到底发生了什么"的**唯一出口**（e2e 已删，逻辑靠单测、
 * UI 靠截图）—— 所以一个"读旧快照"的字段会让下一个人对着正确的引擎
 * 得出错误的结论。**实测发生过**：`playerCooldowns` 曾经原样透出引擎里的
 * 绝对 `readyAt` tick，一次施放之后那个数字就不动了，于是被读成"冷却
 * 没有在走"（拿它写战斗策略的 agent 因此被误导）。
 *
 * 所以字段的**来源**必须写在字段注释里，只有两类：
 *
 *   | 来源 | 取法 | 什么时候刷新 |
 *   |---|---|---|
 *   | **引擎（活）** | `engine.snapshot`（每次现取，浅拷贝实时 `state`） | 每个逻辑 tick |
 *   | **渲染视图（缓存）** | `BattleLoop.snapshot`（最近一帧构建的视图） | 每帧重建一次；`act()` 主动作废，下一次读会按刚推进过的引擎重建 |
 *
 * 判据：**引擎里有的，一律从引擎现取**；只有"渲染层才有的东西"（技能栏
 * 槽位数、飘字条数）才走视图，并在字段注释里标明。基线字段（例如一局的
 * 生命上限）要写成"它是什么"，不能让它看起来像当前值。
 *
 * ⚠️ 它是**只读**的：不许在这里改引擎状态、不许推进 tick、不许
 * `drainEvents()`（那是**排空**语义 —— 探针读了就等于把事件从另外三个
 * 消费者手里拿走，正是 `act()` 曾经踩过的同一个坑）。任何"为了让探针好看"
 * 而写回的值都会让脚本测量到被自己污染的状态。
 */

import type { BattleEngine } from '../core/combat/battleState';
/** ⚠️ tab 用 `SettingsTab`（可见的页依来源而变）—— 见 `debugApi.ts` 的同名说明。 */
import type { SettingsTab } from '../ui/settings/tabs';

/**
 * 探针输出。字段名即端到端脚本读的名字。
 *
 * ⚠️ 每个字段的来源与刷新时机写在它自己的注释里（**活的** / **基线** /
 * **渲染视图**）—— 这张表就是"这个读数能不能用来判断变化"的依据。
 */
export interface ProbeSnapshot {
  /**
   * 这一场战斗的**种子**（**基线**：开战时定下，整场不变；`-1` = 没有战斗）。
   *
   * ⚠️ 它是"这一场的随机从哪儿来"的**唯一直接读数**（B 的验收要用）：
   *   - 肉鸽：应当等于 `battleSeed(runSeed, position)`（同一条 URL 跑两次 → 同一个数）
   *   - 自由模式 / 直接单场：应当**每次都不同**（时钟兜底）
   *
   * 只读到"结果不同"证明不了它是**哪一支**（两次时钟也可能撞上、两次肉鸽
   * 也可能因为别的原因不同），所以这个数是必要的。
   */
  readonly seed: number;
  /** 逻辑 tick（**活**：引擎当前 tick）。 */
  readonly tick: number;
  /** 战斗状态（`running` / …；**活**）。 */
  readonly status: string;
  /** 玩家当前血量（**活**：每个 tick 都可能变）。 */
  readonly playerHp: number;
  /**
   * **这一局玩家的生命上限**（**基线**：开战时定下，整场不变）。
   *
   * ⚠️ 它是**上限**，不是当前值 —— 别拿它和 `playerHp` 一起当"血在掉"的
   * 证据（要看变化请读 `playerHp`）。`-1` = 没有这个角色。
   */
  readonly playerHpCap: number;
  /** 玩家当前缠（**活**：每个 tick 都可能变）。 */
  readonly playerDouqi: number;
  /** 玩家**剩余冷却 tick 数**（`0` = 已可用；**活**，随 tick 递减）。见 `remainingCooldowns`。 */
  readonly playerCooldowns: Readonly<Record<string, number>>;
  /** 玩家当前**正在读的条数**（**活**；`0` = 没在读条）。 */
  readonly playerCasts: number;
  /** Boss 当前血量（**活**）。 */
  readonly bossHp: number;
  /** **Boss 的生命上限**（**基线**，整场不变；`-1` = 没有这个角色）。 */
  readonly bossHpCap: number;
  /** Boss 当前**正在读的条数**（**活**）。 */
  readonly bossCasts: number;
  /**
   * 玩家技能栏的**槽位数**（含派生技）。
   *
   * ⚠️ **渲染视图（缓存）**：只有 `ViewAdapter` 知道派生技此刻开没开，
   * 所以这个数从 `BattleLoop.snapshot` 读 —— 每帧重建一次，`act()` 之后
   * 下一次读会立刻重建（不是上一帧的旧视图）。
   */
  readonly skillCount: number;
  /**
   * 当前存活的**飘字条数**。
   *
   * ⚠️ **渲染视图（缓存）**：飘字是表现层状态（不在引擎里），来源与刷新
   * 时机同 `skillCount`。
   */
  readonly floatingCount: number;
  /**
   * 主循环的**帧数**（**活**：`GameState.frameCount`，由 `loopWiring` 每帧
   * +1）。
   *
   * ⚠️ headless 下 rAF 会被降频，所以它不动**不代表**战斗没走 —— 判断
   * "战斗在不在推进"要用 `tick`。
   */
  readonly frameCount: number;
  /** 累积的运行期异常（**活**：错误一发生就追加；只增不减）。 */
  readonly errors: string[];
}

/**
 * **剩余冷却 tick 数**（`0` = 已可用）。
 *
 * ⚠️ 引擎里存的是**绝对 `readyAt` tick**（`施放时的 tick + 冷却`），它在
 * 一次施放之后**不再变化** —— 原样透出来的话，隔一段时间读两次会看到
 * 同一个数字，而 `tick` 在涨，于是看起来像"冷却根本没有在走"。实测确实
 * 误导过一个拿探针写战斗策略的 agent。
 *
 * 所以探针在这里**减去当前 tick**：读数随 tick **递减**，到 0 表示可用。
 * 这是纯读取，不写回引擎。
 *
 * ⚠️ 没上过冷却的技能**不会出现**在这个表里（缺席 = 可用）。用的同一个
 * `tick` 与被读的 `cooldowns` 来自同一次快照，不会算出自相矛盾的数。
 */
function remainingCooldowns(
  cooldowns: Readonly<Record<string, number>>,
  tick: number,
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [skillId, readyAt] of Object.entries(cooldowns)) {
    out[skillId] = Math.max(0, readyAt - tick);
  }
  return out;
}

/**
 * 摊平当前战斗状态。
 *
 * ⚠️ **两个来源分工明确**（见文件头那张表）：
 *   - 战斗者 / tick / status 一律从 `engine.snapshot` **现取**（活读数）
 *   - `skillCount` / `floatingCount` 只能从 `view` 拿（渲染层才知道的东西）
 * 两个参数都在调用那一刻求值，所以探针读到的不会比"现在"更旧。
 *
 * ⚠️ 缺角色时给 `-1` 而不是 `0`：`0` 会被读成"这个角色血是 0"（等于死了），
 * 而 `-1` 明确表示"没有这个角色" —— 端到端脚本靠这个区分断言失败的原因。
 */
export function buildProbe(
  engine: BattleEngine,
  /** 视图层的一帧快照（技能格数与飘字数只能从它拿）。 */
  view: { readonly skills: readonly unknown[]; readonly floatingText: readonly unknown[] },
  frameCount: number,
  runtimeErrors: readonly string[],
): ProbeSnapshot {
  const state = engine.snapshot;
  const player = state.combatants.find((c) => c.side === 'ally');
  const boss = state.combatants.find((c) => c.side === 'enemy');
  return {
    seed: engine.initialSeed,
    tick: state.tick,
    status: state.status,
    playerHp: player?.resources.hp ?? -1,
    playerHpCap: player?.caps.hp ?? -1,
    playerDouqi: player?.resources.douqi ?? -1,
    playerCooldowns: remainingCooldowns(player?.cooldowns ?? {}, state.tick),
    playerCasts: player?.casts.length ?? -1,
    bossHp: boss?.resources.hp ?? -1,
    bossHpCap: boss?.caps.hp ?? -1,
    bossCasts: boss?.casts.length ?? -1,
    skillCount: view.skills.length,
    floatingCount: view.floatingText.length,
    frameCount,
    errors: [...runtimeErrors],
  };
}

/**
 * 收集**运行期异常**，供端到端脚本读取。
 *
 * ⚠️ 必须显式接这两个事件：否则未捕获异常与未处理 rejection 会被静默
 * 吞掉，端到端脚本只能看到"游戏没反应"，查不出原因。
 *
 * @returns 一个持续累积的数组（调用方只管读）。
 */
export function collectRuntimeErrors(target: Window): string[] {
  const errors: string[] = [];
  /**
   * ⚠️ 用事件**具体的 DOM 类型**（`ErrorEvent` / `PromiseRejectionEvent`）
   * 而不是 `(event: never)` 之类的变通写法 —— 后者会让 `window` 传不进来
   * （`addEventListener` 的重载对不上），也会掩盖"这里拿到的是什么"。
   */
  target.addEventListener('error', (event: ErrorEvent) => {
    errors.push(String(event.message));
  });
  target.addEventListener('unhandledrejection', (event: PromiseRejectionEvent) => {
    errors.push(`unhandled rejection: ${String(event.reason)}`);
  });
  return errors;
}

/**
 * 备战阶段的**零值探针**（那时还没有战斗可测）。
 *
 * ⚠️ 给零值而不是抛错：端到端脚本在"点了开始之前"抓一次探针是很自然的
 * 操作，让它读到一份合法的空快照比让它崩掉好。用 `-1` 表示"没有这个值"，
 * 与 `buildProbe` 里"缺角色"的表示一致。
 */
export function emptyProbe(frameCount: number, runtimeErrors: readonly string[]): ProbeSnapshot {
  return {
    seed: -1,
    tick: 0,
    status: 'idle',
    playerHp: -1,
    playerHpCap: -1,
    playerDouqi: -1,
    playerCooldowns: {},
    playerCasts: -1,
    bossHp: -1,
    bossHpCap: -1,
    bossCasts: -1,
    skillCount: 0,
    floatingCount: 0,
    frameCount,
    errors: [...runtimeErrors],
  };
}

/** 顶层调试对象的各个入口（全部由 `main.ts` 注入，保持惰性）。 */
export interface RaidBattleApi {
  readonly act: (skillId: string, actorId?: string) => void;
  readonly bindings: () => readonly { readonly key: string; readonly skillId: string }[];
  readonly stage: unknown;
  readonly setUiScale: (value: number) => void;
  readonly settings: {
    readonly open: (tab?: SettingsTab) => void;
    readonly close: () => void;
    /**
     * 用逻辑坐标点一下（验证命中测试与布局一致）。
     *
     * ⚠️ 返回 `void`（不是 `boolean`）—— 与 `src/types/global.d.ts` 的
     * 公开契约一致：命中与否是 `SettingsPanel` 的内部细节，调试入口
     * 只负责"把这次点击喂给它"。
     */
    readonly openIn: (px: number, py: number) => void;
    readonly isOpen: () => boolean;
    readonly capturing: () => string | undefined;
    readonly focus: () => unknown;
    readonly trace: () => readonly string[];
  };
  readonly restart: () => void;
  readonly touchButtonCenter: (skillId: string) => { readonly x: number; readonly y: number } | null;
  readonly probe: () => ProbeSnapshot;
}

/**
 * 装上 `window.__raidBattle`。
 *
 * ⚠️ **整块抽出来**而不是留在 `main.ts`：它是"给外部脚本看的门面"，
 * 与装配无关，而且它自己就有 60 行注释（那些注释解释"为什么需要这些
 * 入口"，属于这一块的知识）。
 *
 * ⚠️ 各入口由调用方注入**函数**而不是值 —— 这样"惰性"仍然成立
 * （例如 `touchButtonCenter` 依赖的 `touch` 在主流程里声明得较晚，
 * 直接传值会遇到 TDZ）。
 *
 * ⚠️ 泛型 `A` 的用意：`RaidBattleApi` 只是这个门面的**子集说明**
 * （它把 `settings.openIn` 写成返回 `boolean`），而 `src/types/global.d.ts`
 * 是真正的消费者契约。让返回值原样穿过去，就不需要在调用处写一个
 * 会把类型收窄成子集的中间变量 —— 那种中间变量会让"塞进去的对象"与
 * "脚本读到的对象"漂移，而这正是本仓库最不想看到的。
 */
export function installRaidBattleApi<A extends RaidBattleApi>(api: A): A {
  (globalThis as { __raidBattle?: RaidBattleApi }).__raidBattle = api;
  return api;
}
