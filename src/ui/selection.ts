/**
 * **选中模型 —— "hover 与键盘光标是同一件事"**（2026-10-22）。
 *
 * ==================================================================
 * 它是什么（一句话）
 * ==================================================================
 *
 * 把一个界面上的"哪一项被选中"压成**一个 id**：指针悬停、键盘光标、点选
 * 都走它 ⇒ 屏幕上**永远只有一个框** ✓。
 *
 * ==================================================================
 * 为什么需要它（用户原话）
 * ==================================================================
 *
 * > 或者讲，好多地方，**鼠标 hover 和键盘的选中，都应该是一件事，一个交互，
 * > 一个白色框**，检查自由模式和战前确认
 *
 * 之前的病灶是"**两个事实各画一套**"：hover 有自己的一套高亮/详情，
 * 键盘光标另有一套 ⇒ 悬停时会出现"框在 A、内容在 B"，或者屏幕上两个框 ✗。
 *
 * ==================================================================
 * 判据（照选角色屏那条，别自创第二套）
 * ==================================================================
 *
 * 三个事实**分开存**（这就是关键 —— 用两个布尔混着存必然漂）：
 *
 * ```
 * hovered        指针此刻落在哪一项上（不在任何项上 = undefined）
 * pointerInside  指针在画面内（无论在不在项上）
 * keyboardActive 键盘动过（之后以光标为准，直到指针再动）
 * cursor         键盘光标那一项
 *
 * selected = keyboardActive ? cursor : (pointerInside ? hovered : cursor)
 * ```
 *
 * 读法：**键盘接管时听光标；指针在画面里就听指针（哪怕它停在空白 ⇒
 * `undefined`）；指针根本不在画面里就听光标** ✓。
 *
 * ⚠️ 它**只管"谁被选中"**，不管"框怎么画" —— 各屏的皮肤、圆角、强调色
 * 仍然各自决定（把画法也统一会逼所有屏长得一样 ✗）。
 */

/** 一次判定的输入（三个事实 + 光标；**全部显式**，没有隐含默认）。 */
export interface SelectionInput {
  /** 指针此刻落在哪一项上（`undefined` = 不在任何项上 / 没有指针）。 */
  readonly hovered: string | undefined;
  /** 指针在**画面内**吗（在画面内但停在空白 = `true` + `hovered: undefined`）。 */
  readonly pointerInside: boolean;
  /** 键盘**动过**吗（之后以光标为准，直到指针再动一次）。 */
  readonly keyboardActive: boolean;
  /** 键盘光标那一项（没有光标 = `undefined`）。 */
  readonly cursor: string | undefined;
}

/**
 * 判定"当前选中谁"（**纯函数**，无状态、可直接测）。
 *
 * @returns 选中项的 id；`undefined` = 这一刻没有任何一项被选中
 */
export function selectedIdOf(input: SelectionInput): string | undefined {
  if (input.keyboardActive) return input.cursor;
  if (input.pointerInside) return input.hovered;
  return input.cursor;
}

/**
 * 选中模型的**状态机**：各屏共用同一份"何时把 `keyboardActive` 置真/假"。
 *
 * ⚠️ 为什么连状态一起抽：三个事实的**翻转时机**也是判据的一部分
 * （指针一动 ⇒ 键盘接管结束；键盘一动 ⇒ 键盘接管开始）。各屏各写一遍，
 * 迟早有一屏忘了把 `keyboardActive` 置回 `false` ⇒ "鼠标划过去没反应" ✗。
 */
export interface SelectionState {
  /** 指针进入某一项（`undefined` = 指针在画面内但不在任何项上）。 */
  hover(id: string | undefined): void;
  /** 指针离开画面。 */
  leave(): void;
  /** 键盘移动了光标（自动进入"键盘接管"）。 */
  keyboardMove(cursor: string | undefined): void;
  /** 当前选中谁。 */
  readonly selected: () => string | undefined;
  /** 当前三个事实（调试读数 / 各屏要自己判"要不要重画"时用）。 */
  readonly facts: () => SelectionInput;
}

/** 造一份选中状态（初值：没有指针、没有光标、键盘未接管）。 */
export function createSelectionState(initialCursor: string | undefined = undefined): SelectionState {
  let hovered: string | undefined;
  let pointerInside = false;
  let keyboardActive = false;
  let cursor = initialCursor;
  return {
    hover: (id) => {
      hovered = id;
      pointerInside = true;
      /** 指针一动 ⇒ 选中归指针（键盘接管结束）。 */
      keyboardActive = false;
    },
    leave: () => {
      /**
       * 指针离开画面：**不清 `cursor`、也不改 `keyboardActive`** ——
       * 选中回落到光标那一项 ✓（"移开鼠标框就消失"是 bug ✗）。
       */
      pointerInside = false;
      hovered = undefined;
    },
    keyboardMove: (next) => {
      cursor = next;
      keyboardActive = true;
    },
    selected: () => selectedIdOf({ hovered, pointerInside, keyboardActive, cursor }),
    facts: () => ({ hovered, pointerInside, keyboardActive, cursor }),
  };
}
