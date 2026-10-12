/**
 * ==================================================================
 * **操作方式：键盘 / 触屏** —— 全应用**唯一**的那个 flag
 * ==================================================================
 *
 * 用户 2026-10-12 定案（原话）："**所有 决定 是 键盘还是触屏的
 * 只用唯一 flag**"。
 *
 *   `OperationMode = 'keyboard' | 'touch'`
 *
 * 所有"键盘还是触屏"的判断都读它派生出来的 `PlatformCaps`：
 *
 *   | 判断 | 读哪个字段 |
 *   |---|---|
 *   | 「按键」页显示**键盘绑定**还是**触屏键位** | `caps.mode` / `caps.touch` |
 *   | 要不要显示键名提示（含齿轮按钮上的快捷键） | `caps.showKeyHints` |
 *   | 战斗里双弧按钮层显不显示 / 吃不吃指针 | `caps.touch` |
 *   | 读哪一份键位存储（`raid.bindings.*.v1`） | `caps.mode` |
 *
 * ⚠️ `showKeyHints` 是 `mode` 的**派生**（`capsOf` 里算的一次），
 * 不是第二个**来源** —— 一个来源派生多个视图可以，两个来源不行。
 *
 * ==================================================================
 * ⚠️ 这里曾经是"能力探测"，为什么删了
 * ==================================================================
 *
 * 原实现（`detectPlatform(probe)` + `browserPlatformProbe()`）用
 * `matchMedia('(pointer: coarse)')` **或** `(hover: none)` 推"是不是触屏"，
 * 并且刻意**偏向触屏**（注释原话："宁可多认成触屏，只是不显示键名提示，
 * 代价很小"）。
 *
 * 那个前提**后来变了**，于是同一个判断变成了 bug：这个值先被拿去决定
 * 「按键」页那**一个**「恢复默认」恢复哪一套键位 —— 触屏笔记本被判成
 * touch，键盘键位**恢复不了**（用户实测报了"我现在是键盘 为啥显示的
 * 触屏绑定？"）。一个**故意偏向一边**的估计值，被升级成了会**吞功能**的
 * 判断。
 *
 * 用户随后连着定了三条，最终收敛到"**不用自动判断，由入口显式传**"：
 *
 *   1. "不管触屏笔记本"
 *   2. 「通用」页能选操作方式（记住）
 *   3. `?touch=1` / `?touch=0` 能从外面强制指定
 *
 * 所以 `probe` / `matchMedia` 那一整套**整块删掉**（AGENTS.md §2 的判据：
 * 同一件事的第二份表达 → 删）——`?touch=` 让"探测"变成**默认值**而不是
 * **结论**，而默认值是 `'keyboard'`（用户明确接受"真手机第一次进来默认
 * 是键盘界面，要用户自己切一次"）。
 *
 * ==================================================================
 * 来源优先级（`resolveOperationMode`，纯函数、有单测）
 * ==================================================================
 *
 *   ```
 *   1. ?touch=1 / ?touch=0        （强制覆盖：截图验证 / 用户自救）
 *   2. localStorage 里记住的选择   （「通用」页切的，刷新后还在）
 *   3. 'keyboard'                 （默认）
 *   ```
 *
 * ⚠️ 本文件**不认识 Pixi、不认识 DOM**（`search` 与存档都是参数传进来的），
 * 所以能在 node 里精确测 —— 与它当年"纯函数 + 注入，便于测试"那条纪律
 * 一脉相承。
 */

/** 操作方式 —— 全应用唯一的"键盘 / 触屏"真相。 */
export type OperationMode = 'keyboard' | 'touch';

/** 由 `mode` 派生出来的能力视图（消费者只读它，不自己再判一次）。 */
export interface PlatformCaps {
  /** 当前操作方式（**唯一来源**）。 */
  readonly mode: OperationMode;
  /** 是不是触屏方式（= `mode === 'touch'`）—— 双弧按钮层 / 触屏输入读它。 */
  readonly touch: boolean;
  /** 要不要显示键名提示（= `mode === 'keyboard'`）。 */
  readonly showKeyHints: boolean;
}

/** 从唯一 flag 派生出各视图 —— 派生只在这一处发生。 */
export function capsOf(mode: OperationMode): PlatformCaps {
  return { mode, touch: mode === 'touch', showKeyHints: mode === 'keyboard' };
}

/**
 * `?touch=1` → 强制触屏；`?touch=0` → 强制键盘。
 *
 * ⚠️ **只认这两个值**，其它（含 `?touch=true`、`?touch=`）一律当"没给"
 * —— 一个含义过载的参数比没有参数更糟。名字只说一件事："把操作方式
 * 强制成哪个"。
 */
export function operationModeOverride(search: string): OperationMode | undefined {
  const raw = new URLSearchParams(search).get('touch');
  if (raw === '1') return 'touch';
  if (raw === '0') return 'keyboard';
  return undefined;
}

/** 存档里的字符串 → 操作方式（坏值 / 旧版本写的别的值一律当"没存过"）。 */
export function parseSavedMode(raw: string | null): OperationMode | undefined {
  return raw === 'keyboard' || raw === 'touch' ? raw : undefined;
}

/**
 * 这一局用哪种操作方式。
 *
 * @param search `location.search`（`?touch=1` 那条覆盖）
 * @param saved  存档里的选择（`raid.operationMode.v1`，可为 `null`）
 */
export function resolveOperationMode(search: string, saved: string | null): OperationMode {
  return operationModeOverride(search) ?? parseSavedMode(saved) ?? 'keyboard';
}
