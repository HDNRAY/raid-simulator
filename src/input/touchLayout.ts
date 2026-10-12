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
 * 现在按钮是**独立的一份用户选择**（设置页「按键」页右下角的模拟键位：
 * 点键位 → 点技能 → 绑上，见 `assignSkillToSlot` / `clearSlot`；
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

/** 一个触屏按钮位：**第几个槽位** + 放哪个技能。 */
export interface TouchButton {
  /**
   * 槽位序号（从 0 开始）。决定它在双弧上的位置。
   *
   * ⚠️ 它是**槽位**，不是"数组里第几个"：槽位可以空着（见
   * `assignSkillToSlot` / `clearSlot`），所以这个表里允许出现空洞。
   */
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
 * 规范化：丢掉空技能，按 `index` 排序，**每个槽位最多一个技能**。
 *
 * ⚠️ **不再重新编号**（2026-10-12 起）。
 *
 * 旧的实现在这里把 `index` 压成连续序号（"不留空洞"），因为那时按钮集合
 * 是一份**有序清单**、顺序就是位置。现在用户要的是"**点键位 → 点技能 →
 * 绑到这个键位**"：槽位是固定的 7 个格子，中间可以是空的。
 * 重新编号会把"第 3 个键位"悄悄变成"第 2 个" —— 玩家在设置页摆好的位置
 * 白摆，而战斗里看起来只是"少了一个按钮"。
 *
 * 越界 / 重复槽位由调用方保证（设置页只给 0..容量-1），这里仍然挡一手：
 * 重复槽位保留**先出现**的那个。
 */
function normalize(list: readonly TouchButton[]): readonly TouchButton[] {
  const seen = new Set<number>();
  const out: TouchButton[] = [];
  for (const b of list) {
    if (b.skillId === '') continue;
    if (!Number.isInteger(b.index) || b.index < 0) continue;
    if (seen.has(b.index)) continue;
    seen.add(b.index);
    out.push({ index: b.index, skillId: b.skillId });
  }
  return out.sort((a, b) => a.index - b.index);
}

/**
 * 由布局的按钮表**还原成槽位数组**（下标 = 槽位，空洞 = `''`）。
 *
 * 渲染层（`TouchButtonLayer.setButtons`）要的就是这个形状 —— 它直接拿
 * 下标当槽位号。布局自己只存"有技能的槽位"（`current()`），所以两者之间
 * 需要这一次转换；不转换的话空洞会被压掉，位置就错了。
 */
export function slotsFromButtons(buttons: readonly TouchButton[]): readonly string[] {
  const last = buttons.reduce((m, b) => Math.max(m, b.index), -1);
  const out: string[] = Array.from({ length: last + 1 }, () => '');
  for (const b of buttons) out[b.index] = b.skillId;
  return out;
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
 * **默认**触屏键位表（设置页「触屏默认」用它）。
 *
 * 取的是**默认键位表**里"有键"的技能 —— 与老存档的迁移结果一致，
 * 于是"恢复默认"给出的就是老玩家第一次加载时看到的那一份，两处不会漂。
 *
 * ⚠️ **截到容量**：默认键位表里有 9 个有键的技能，而双弧只放得下
 * `TOUCH_BUTTON_CAPACITY`（7）个。不截的话，多出来的那几个会**存在存档里
 * 却没有任何槽位**（`touchButtonCenter` 返回 `undefined`）—— 一份
 * "看得见（在设置里数得出来）、摸不着"的幽灵数据。
 */
export function defaultTouchButtonIds(capacity: number): readonly string[] {
  return clampToCapacity([...touchButtonIdsFromBindings(DEFAULT_BINDINGS)], capacity);
}

/**
 * 触屏槽位表：**下标 = 槽位号**，`''` = 空槽位。
 *
 * ⚠️ 与旧形状（"技能 id 清单，顺序即位置"）**兼容**：旧存档里没有 `''`，
 * 读出来就是"0..n-1 号槽位各一个技能"，不需要迁移。
 * 新写的存档可能带空洞（`['attack', '', 'guard']` = 1 号槽位空着）。
 */
export type TouchSlots = readonly string[];

/**
 * 末尾的空槽位**不存**（`['a','','']` → `['a']`）。
 *
 * 这样"所有按钮都取下"就是 `[]` —— 与"没存过"（`undefined`）仍然是
 * 两件不同的事（那条区分是 `loadTouchButtons` 的全部意义）。
 * 中间的空洞要留着：它正是"这个键位是空的"这份信息。
 */
export function trimTrailingSlots(slots: TouchSlots): TouchSlots {
  let end = slots.length;
  while (end > 0 && slots[end - 1] === '') end -= 1;
  return end === slots.length ? slots : slots.slice(0, end);
}

/** 把槽位表截到容量内（**只在两个边界用**：默认值、读存档）。 */
export function clampToCapacity(slots: TouchSlots, capacity: number): TouchSlots {
  return trimTrailingSlots(slots.slice(0, Math.max(0, capacity)));
}

/** 把槽位表补到至少 `length` 长（中间补空槽）。 */
function padTo(slots: TouchSlots, length: number): string[] {
  const out = [...slots];
  while (out.length < length) out.push('');
  return out;
}

/**
 * **把技能绑到某个槽位**（纯函数）—— 用户要的两步交互的落点。
 *
 * 语义（与设置页的说明一致）：
 *   - 槽位上的原来那个技能被**顶掉**（它的位置被新技能占了）
 *   - 若这个技能**已经在别的槽位** → **两边交换**（谁都不消失）
 *   - 空 id / 非法槽位 → 原样返回（坏数据不进槽位）
 *
 * @returns 新槽位表（末尾空槽已裁掉）；内容没变时返回**原引用**
 */
export function assignSkillToSlot(
  current: TouchSlots,
  slot: number,
  skillId: string,
): TouchSlots {
  if (skillId === '' || !Number.isInteger(slot) || slot < 0) return current;
  const next = padTo(current, slot + 1);
  const from = next.indexOf(skillId);
  const displaced = next[slot] ?? '';
  next[slot] = skillId;
  if (from >= 0 && from !== slot && from < next.length) next[from] = displaced;
  const trimmed = trimTrailingSlots(next);
  return sameSlots(current, trimmed) ? current : trimmed;
}

/**
 * **清空某个槽位**（纯函数）。它后面的槽位**不动**（这正是"槽位"与
 * "清单"的区别：清掉第 2 个，第 3 个还在第 3 个）。
 */
export function clearSlot(current: TouchSlots, slot: number): TouchSlots {
  if (!Number.isInteger(slot) || slot < 0 || slot >= current.length) return current;
  /** 已经是空的：原样返回（**同一个引用** —— 上层据此跳过无意义的通知）。 */
  if (current[slot] === '') return current;
  const next = [...current];
  next[slot] = '';
  return trimTrailingSlots(next);
}

/** 两份槽位表是否等价（`''` 与缺位都算空）。 */
function sameSlots(a: TouchSlots, b: TouchSlots): boolean {
  return a.length === b.length && a.every((x, i) => x === b[i]);
}
