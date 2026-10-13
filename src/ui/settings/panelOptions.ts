/**
 * **设置面板的对外契约**（`SettingsPanelOptions`）。
 *
 * ==================================================================
 * 为什么单独一个文件（AGENTS.md §3 的横向切割）
 * ==================================================================
 *
 * `SettingsPanel.ts` 加了"面板响应 UI 缩放"之后到了 **714 行**（上限 700）——
这一刀把它切回 **649**。
 * 按 §3 的顺序**不许压注释**，要拆 util 或横向切割 —— 这一块正好是一个
 * 完整的关注点：**"面板要外面提供哪些能力"**（键位表怎么读写、缩放怎么
 * 落实、触屏键位表从哪来）。它与"面板怎么收输入 / 焦点在谁身上 / 改键
 * 会话"没有交集。
 *
 * ⚠️ 类型是**编译期**的东西（`import type` 完全擦除），所以搬出来不会
 * 引入运行期的 import 环。
 */

import type { PixiCtor } from '../primitives';
import type { TranslateFn } from '../../i18n/translator';
import type { OperationMode } from '../../render/platform';
import type { KeyRow } from './rows';

export interface SettingsPanelOptions {
  readonly pixi: PixiCtor;
  /**
   * ⚠️ **必须带上 `params`**。
   *
   * 这里原先写的是 `(key: string) => string` —— 于是所有拿它去满足
   * `buildKeyRows`（那边要 `(key, params?) => string`）的地方都会
   * **静默丢掉第二个参数**（TS 允许"参数更少"的函数赋值给"参数更多"的类型），
   * 界面上就显示出 `{seconds}` / `{value} {resource}` 这些占位符本身 ✗
   *
   * 类型收窄本身**不是错**，但它把"丢参数"从"显而易见的 bug"变成了
   * "编译器保证正确的写法"。宽到 `params` 才能让实现无处可躲。
   */
  readonly translate: TranslateFn;
  /** 读取当前键位表 */
  readonly getRows: () => readonly KeyRow[];
  /** 改键：把某个技能的键改成 `key` */
  readonly onRebind: (skillId: string, key: string) => void;
  /** 交换两个按钮位的技能（见 `app/bindingActions.ts` 的区别说明）。 */
  readonly onSwapSlots: (from: number, to: number) => void;
  /** 恢复默认键位 */
  readonly onResetKeys: () => void;
  /**
   * 进入/退出**捕获模式**。
   *
   * 捕获期间输入层不再把按键当技能 —— 这是必须的：否则玩家
   * 按 `Esc` 想取消改键，技能会真的放出去。
   */
  readonly onCapture: (handler: ((key: string) => void) | undefined) => void;
  /** 关闭弹窗 */
  readonly onClose: () => void;
  /**
   * **当前操作方式**（键盘 / 触屏）—— 全应用**唯一**的那个 flag。
   *
   * ⚠️ 面板用它回答三件事（都从这一个值派生，没有第二个来源）：
   *   - 「按键」页画**键盘块**还是**触屏块**（`caps.touch`）
   *   - 要不要拼键名提示（`caps.showKeyHints`）
   *   - 「通用」页那个选择器该亮哪一个
   *
   * ⚠️ 是**函数**：玩家能在「通用」页当场切过去，快照会停在构造那一刻。
   */
  readonly getOperationMode: () => OperationMode;
  /**
   * 玩家在「通用」页切了操作方式。
   *
   * ⚠️ 面板**不自己写**（`GameState.operationMode` / 存档 / 换哪一份键位表
   * 分属不同模块）—— 落点在 `app/game.ts` 的 `applyOperationMode`，
   * 它切完会回调面板重画（`setOperationMode`）。
   */
  readonly onOperationMode: (mode: OperationMode) => void;
  /**
   * **触屏键位表**（**下标 = 键位号**，`''` = 空键位）。**从 `GameState` 读**，
   * 不在面板里留副本 —— 与键位表同一条纪律。
   */
  readonly getTouchSlots?: (() => readonly string[]) | undefined;
  /**
   * 两步交互的落点：**把这个技能绑到那个键位**（交换 / 顶掉的判定在
   * `slotActions`，这里只管把结果写下去）。
   */
  readonly onAssignTouchSlot?: ((slot: number, skillId: string) => void) | undefined;
  /** 取下某个键位上的技能。 */
  readonly onClearTouchSlot?: ((slot: number) => void) | undefined;
  /** 「触屏默认」= 恢复默认键位表（截到容量）。 */
  readonly onResetTouchButtons?: (() => void) | undefined;
  /** 读当前 UI 缩放倍数（1 = 自动适配） */
  readonly getUiScale: () => number;
  /** UI 缩放变了（调用方负责把它应用到画布尺寸上） */
  readonly onUiScale: (value: number) => void;
}

