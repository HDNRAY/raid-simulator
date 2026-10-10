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
 * 为什么按钮不由玩家自由排布
 * ==================================================================
 *
 * 用户定案："暂时就不给玩家自由编辑了。"
 *
 * 所以按钮**从绑定表自动推导**（`fromBindings`）—— 与桌面技能格
 * 走同一条路（`slotsFromBindings`）。设置页只做**只读预览**。
 *
 * 将来要做编辑器时，只要换掉"谁调用 `set()`"，输入层与渲染层一行
 * 都不用改 —— 这正是把写入收敛成单一入口的收益。
 */

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
 * 从**键位表**推导触屏按钮（与桌面技能格同一条路）。
 *
 * 有键的技能才上场 —— "闪"默认空键，所以它不出现在触屏上，
 * 但仍在设置页里可绑（设置页读的是绑定表）。
 */
export function touchButtonsFromBindings(
  bindings: readonly { readonly key: string; readonly skillId: string }[],
): readonly TouchButton[] {
  return bindings
    .filter((b) => b.key !== '')
    .map((b, i) => ({ index: i, skillId: b.skillId }));
}
