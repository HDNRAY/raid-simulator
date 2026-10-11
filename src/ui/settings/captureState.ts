/**
 * **改键的状态机** —— "等待按键"这件事的纯逻辑。
 *
 * ==================================================================
 * 为什么单独一个文件
 * ==================================================================
 *
 * `SettingsPanel.ts` 顶到 700 行上限（AGENTS.md §3）。按那里的规则 ——
 * **不许靠删/压注释解决，要拆 util 或横向切割** —— 把这一块横向切出来：
 * 它只关心"有没有在等按键 / 等的是谁 / 这个键该怎么算"，与 Pixi、
 * 与面板的其它状态都没有交集。
 *
 * ⚠️ 与 `rebind.ts` / `keyNames.ts` 是**同一个做法、同一个原因**（那两次
 * 也是各自顶到上限的模块被切出去）。抽取时**注释整段搬过来**，不留摘要。
 *
 * ==================================================================
 * ⚠️ 为什么这段值得单测
 * ==================================================================
 *
 * 改键语义**连续出过三个 bug**（点击进来白吃第一个键、`Esc` 退不出去、
 * 捕获状态卡住不退），而它们全都靠"在浏览器里点一遍"才发现 ——
 * 抽成纯函数之后这一段终于能在 node 里精确测（见
 * `tests/unit/settingsCapture.test.ts`）。
 *
 * ⚠️ 这些函数**不碰 DOM、不碰 Pixi、不碰输入层**，是纯的。
 */

/** 改键状态：`skillId` 为 undefined 表示没在捕获。 */
export interface CaptureState {
  /** 正在等待按键的技能 id（undefined = 没在捕获） */
  readonly skillId: string | undefined;
  /**
   * 触发改键的那个键（键盘 Enter 进来时是 `'enter'`；鼠标点击进来时是
   * `undefined`）。见 `beginCapture` 的说明。
   */
  readonly triggerKey: string | undefined;
}

/**
 * 进入改键（等待一个按键）。
 *
 * @param triggerKey **触发改键的那一次按键**（键盘 Enter 进来时就是
 *   `'enter'`）。它会被作废 —— 否则按 Enter 改键会立刻把技能绑到 Enter。
 *   **鼠标点击进来时没有这一次按键**，所以传 `undefined`。
 *   （原先这里是个无条件的 `skipNextCapture = true`，于是**点击进来会
 *   吃掉玩家按的第一个键**：点一下、按键没反应、再按一次才行。）
 */
export function beginCapture(skillId: string, triggerKey?: string): CaptureState {
  return { skillId, triggerKey };
}

/** 退出改键（没在捕获时返回的也是这个状态，所以可以随时调）。 */
export function endCapture(): CaptureState {
  return { skillId: undefined, triggerKey: undefined };
}

/**
 * 捕获中收到某个键时的判定。
 *
 * | 结果 | 含义 |
 * |---|---|
 * | `skip` | 这是触发改键的那一次按键 —— 作废，但**继续捕获** |
 * | `cancel` | `Esc`：唯一的退路，退出捕获、什么都不绑 |
 * | `bind` | 玩家想绑这个键 —— 交给面板走绑定流程 |
 *
 * ⚠️ **没在捕获时一切都当 `skip`** —— 老的 `finishCapture` 就是
 * `if (skillId === undefined) return;`。别把它写成"返回 bind / cancel"：
 * 面板可能从捕获回调收到多余的按键，那一下不该触发任何绑定。
 *
 * ⚠️ **只按 key 相等来作废、且只作废一次** —— 不能用"第一个键一律丢掉"
 * 那种写法：点击进入改键时没有触发键，会白吃玩家一个键。
 */
export type CaptureVerdict =
  | { readonly kind: 'skip' }
  | { readonly kind: 'cancel' }
  | { readonly kind: 'bind'; readonly key: string };

export function classifyCaptureKey(state: CaptureState, key: string): CaptureVerdict {
  if (state.skillId === undefined) return { kind: 'skip' };

  /**
   * 作废"触发改键的那一次按键"。
   *
   * ⚠️ 放在 `Esc` 之前、与 `handleKey` 里的 `resolveKeyAction` 同序：
   * 那里也是**先**看捕获中的键、`Esc` 才算退路。这样两条投递路径
   * （输入层回调 / 面板自己收 `handleKey`）对同一个键给出同样的判定。
   */
  if (state.triggerKey !== undefined && key === state.triggerKey) {
    return { kind: 'skip' };
  }

  // Esc 是唯一的退路，其余按键都当作"玩家想绑这个键"
  if (key === 'escape') return { kind: 'cancel' };

  return { kind: 'bind', key };
}
