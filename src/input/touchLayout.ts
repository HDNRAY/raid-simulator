/**
 * 触屏按钮的**布局（唯一真相）**。
 *
 * ==================================================================
 * 这个模块存在的理由：一处写入、多处订阅
 * ==================================================================
 *
 * 需求："移动端全员用唯一真相，并且监听变化。"
 *
 * 触屏按钮有**两个消费者**：
 *   1. `TouchInputSource`（输入层）—— 手指按在哪 = 放哪个技能
 *   2. `TouchButtonLayer`（渲染层）—— 画几个圆、每个是什么技能
 *
 * 如果两边各存一份，就一定会出现"画面改了、输入还是旧的"，
 * 或者反过来。之前"改键后画面不跟着变"（见 `slotsFromBindings`
 * 的说明）就是这一类 bug。
 *
 * 所以这里只有**一个**写入路径 `set()`，写完之后通知所有订阅者。
 * 任何一方都不许自己留副本。
 *
 * ==================================================================
 * ⚠️ 按钮集合是**用户自己选的**，不再从键位表派生（2026-10-12 用户定案）
 * ==================================================================
 *
 * 原先按钮由**键位表**机械派生（"有键的技能"）。用户推翻了这条
 * （"触屏和键盘**当然是 2 套**，连 localStorage 都是分 2 个 key 存的，
 * 只是可选技能是一样的"），因为这个派生会让纯触屏玩家**进不去死结**：
 *
 *   技能没绑键 → 触屏上没有它的按钮 ✗
 *   配按钮的地方是「按键」页 → 而触屏按不出键、进不去改键 ✗✗
 *
 * 现在按钮集合是**独立的一份用户选择**（`toggleTouchButtonId` 增删、
 * 自己一个 localStorage key），输入层与渲染层依旧只认这里的
 * `TouchLayout` —— 写入路径仍然收敛成 `set()` 一个。
 *
 * ⚠️ **可选技能仍是同一个池**：设置页列出的技能来自内容注册表
 * （`app/keyRows.ts` 的 `buildKeyRows`），与键盘那套**同一张表**。
 * 变的只是"选中的子集存在哪儿"，不是"能选什么"。
 *
 * 派生函数（`touchButtonIdsFromBindings`）**只剩两个用途**：
 *   1. 老存档**迁移**一次（老玩家的按钮原本由它得出，不回填就会突然消失）
 *   2. "恢复默认"的默认值（= 默认键位表里"有键"的技能）
 * 任何运行期路径都**不许**再拿它当真相源。
 */

import { DEFAULT_BINDINGS } from './keyboard';

/** 一个触屏按钮位：按顺序第几个 + 放哪个技能。 */
export interface TouchButton {
  /** 槽位序号（从 0 开始）。决定它在双弧上的位置。 */
  readonly index: number;
  readonly skillId: string;
}

export type TouchLayoutListener = (buttons: readonly TouchButton[]) => void;

export interface TouchLayout {
  /** 当前按钮表（只读快照）。 */
  readonly current: () => readonly TouchButton[];
  /** 替换按钮表（**唯一写入路径**）。内容相同时不通知订阅者。 */
  readonly set: (next: readonly TouchButton[]) => void;
  /** 订阅变更，返回取消订阅。订阅时会立刻收到当前值。 */
  readonly subscribe: (listener: TouchLayoutListener) => () => void;
}

/** 判断两份按钮表是否等价（用于跳过无意义的通知）。 */
function sameButtons(a: readonly TouchButton[], b: readonly TouchButton[]): boolean {
  if (a.length !== b.length) return false;
  // `noUncheckedIndexedAccess` 下 `b[i]` 是可能 undefined 的 —— 长度已经
  // 相等，所以这里的判空是给类型系统看的，不是运行期真的会走
  return a.every((x, i) => {
    const y = b[i];
    return y !== undefined && x.index === y.index && x.skillId === y.skillId;
  });
}

export function createTouchLayout(
  initial: readonly TouchButton[] = [],
): TouchLayout {
  let buttons: readonly TouchButton[] = normalize(initial);
  const listeners = new Set<TouchLayoutListener>();

  return {
    current: () => buttons,

    set(next) {
      const normalized = normalize(next);
      /**
       * ⚠️ 内容没变就**不通知**。
       *
       * `set()` 会被"输入层与渲染层各自同步一次"这类流程频繁调用；
       * 不去重的话每次都会触发一整轮重绘与重绑。
       */
      if (sameButtons(buttons, normalized)) return;
      buttons = normalized;
      for (const listener of listeners) listener(buttons);
    },

    subscribe(listener) {
      listeners.add(listener);
      /**
       * **订阅时立刻推一次当前值。**
       *
       * 这样订阅方不需要"先 current() 再 subscribe()" ——
       * 那两步之间如果发生了 `set()`，就会漏掉一次更新
       * （经典的"先读后订阅"竞态）。
       */
      listener(buttons);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

/**
 * 规范化：丢掉空技能、按 `index` 重新编号。
 *
 * ⚠️ 重新编号是必要的：调用方给的 `index` 可能因为"删掉中间一个"
 * 而出现空洞，而双弧的槽位是**按顺序**排的（`index` 直接当数组下标
 * 用）。留空洞会让按钮画在没有算过的角度上。
 */
function normalize(list: readonly TouchButton[]): readonly TouchButton[] {
  return list
    .filter((b) => b.skillId !== '')
    .map((b, i) => ({ index: i, skillId: b.skillId }));
}

/**
 * 从**键位表**推导按钮技能 id —— ⚠️ **只用于老存档迁移与"恢复默认"**。
 *
 * 有键的技能才上场（与当年触屏按钮的来源完全一致），所以它给出的正是
 * "老玩家第一次加载时应该看到的按钮"，以及"恢复默认"该回到的那一份。
 *
 * ⚠️ **它不是运行期的真相源**：按钮集合由用户用设置页选出来、存在
 * 自己的 localStorage key 里（见文件头）。运行期任何地方再调用它，
 * 就等于把那个"没绑键就没按钮"的死结接回来。
 *
 * ⚠️ 它**不过滤这一局有哪些技能** —— 那件事的主人是
 * `app/touchControls.ts` 的 `currentSkillIds`（引擎的技能集）。
 */
export function touchButtonIdsFromBindings(
  bindings: readonly { readonly key: string; readonly skillId: string }[],
): readonly string[] {
  return bindings.filter((b) => b.key !== '').map((b) => b.skillId);
}

/**
 * **默认**触屏按钮集合（设置页「恢复默认触屏按钮」用它）。
 *
 * 取的是**默认键位表**里"有键"的技能 —— 与老存档的迁移结果一致，
 * 于是"恢复默认"给出的就是老玩家第一次加载时看到的那一份，两处不会漂。
 */
export function defaultTouchButtonIds(): readonly string[] {
  return touchButtonIdsFromBindings(DEFAULT_BINDINGS);
}

/**
 * **放上 / 取下**一个按钮（纯函数，返回新数组）。
 *
 * 顺序 = 双弧上的位置：新加的排在**最后**（外弧方向），
 * 取下则直接删掉、后面的整体前移（顺序天然补位）。
 *
 * ⚠️ 空 id 直接原样返回：它只可能来自坏数据，而"加一个空技能按钮"
 * 会让 `normalize` 在别处悄悄丢掉它 —— 在这里挡住更早也更清楚。
 */
export function toggleTouchButtonId(
  current: readonly string[],
  skillId: string,
): readonly string[] {
  if (skillId === '') return current;
  return current.includes(skillId)
    ? current.filter((id) => id !== skillId)
    : [...current, skillId];
}
