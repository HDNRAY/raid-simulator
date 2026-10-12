/**
 * **开始战斗** —— 造一局 `BattleLoop` 的那一段。
 *
 * ==================================================================
 * 为什么单独一个文件
 * ==================================================================
 *
 * 用户原话："main.ts 早都可以拆了……什么**开始战斗**，**new settingspanel**，
 * 这些都不应该在这，**main.ts 只应该保留主干**"。
 *
 * 这段是"一局战斗的组装"：把**当前选择**、键位表、内容注册表、时钟种子、
 * 触屏输入源拼成 `BattleLoopOptions`。它与"界面怎么摆"无关，所以独立出来，
 * `main.ts` 里只剩一句 `createStartBattle(...)`。
 *
 * ⚠️ 每次重开（结算面板的 restart / 触屏点屏 / 键盘 Enter）都会**重建**
 * 一个 `BattleLoop` —— 所以这里是个**工厂**，而键位表由调用方持有
 * （玩家的改键不该因为重开一局被重置）。
 */

import { BattleLoop } from './battleLoop';
import { slotsFromBindings } from './viewAdapter';
import { makeBoss, makePlayer, PLAYER_BASE } from '../data/units';
import type { ContentRegistry } from '../core/content/registry';
import type { KeyBinding } from '../input/keyboard';
import type { StatKey } from '../core/types';
import type { InputSource } from '../input/keyboard';
import { translateSafe } from './translate';

/** 组装一局战斗需要的东西（每次开局读一次，"当前选择"是活的）。 */
export interface StartBattleDeps {
  /** 内容注册表（校验过的技能 / buff 表）。 */
  readonly registry: ContentRegistry;
  /** 当前键位表（读引用；改键会替换它，所以每次开局现读）。 */
  readonly getBindings: () => readonly KeyBinding[];
  /** 当前选中的出战单位（备战界面的选择，进战斗时读到）。 */
  readonly getSelection: () => { readonly playerId: string; readonly bossId: string };
  /** `?noai=1` 时为真（对手不行动）。 */
  readonly noAi: boolean;
  /** 每场战斗的时限。超时判负。与 Boss 的 enrage 阈值一致。 */
  readonly timeLimitMs: number;
  /**
   * 触屏输入源。
   *
   * ⚠️ **传 getter，不要传 `touch.input` 本身。**
   * 踩过的坑（实测）：`restartBattle()` 重建循环时漏了重新接线 →
   * **任何一次重开之后触屏永久断开**（Action 堆进没人 drain 的数组，
   * 按钮还在、点了没反应；键盘不受影响 → 表现成"只有触屏坏"）。
   * 传 getter 后接线只此一处；`touch` 可能在第一次开局时还没构造完，
   * 但 getter 只在每帧被调用，那时它已初始化（无 TDZ）。
   */
  readonly touchInput: () => InputSource | undefined;
}

/**
 * 建一个"开始战斗"工厂。
 *
 * @returns 每次调用**新建**一个 `BattleLoop`（上一局由调用方 `dispose`）。
 */
export function createStartBattle(d: StartBattleDeps): () => BattleLoop {
  return (): BattleLoop =>
    new BattleLoop({
      // 飘字要"闪躲"这种本地化文案 —— 注入取词函数，而不是让
      // ViewAdapter 去 import i18n 单例
      /**
       * ⚠️ **必须是 `translateSafe` 本身，不能套一层 `(key) => ...`**
       *
       * 需求（用户报告）："所有技能的消耗，在这里没了……"
       * 而修好取数之后，设置页里显示的是 **`{value} {resource}` /
       * `{seconds}` 这些占位符本身**。
       *
       * 根因就在这里：原先写的是 `(key) => translator.t(key)` ——
       * **把第二个参数 `params` 吃掉了**。TypeScript **不会报错**
       * （"参数更少的函数"本来就可以赋值给"参数更多的类型"），
       * 所以这个 bug 一路静默到界面上。
       *
       * 而 `settingsPanelOptions` 用的正是这个函数（`const t = d.translate`），
       * 于是设置页里**所有**带占位符的文案全部原样显示 ✗
       */
      translate: translateSafe,
      engineOptions: {
        /**
         * ⚠️ 出战单位来自**备战界面的选择**，不是写死的。
         * 目前各只有一个，所以工厂按 id 挑词表；加第二个单位时在这里扩。
         */
        combatants: [
          makePlayer(d.getSelection().playerId),
          makeBoss(d.getSelection().bossId, { noAi: d.noAi }),
        ],
        // 用真实时钟做种子：每次开局不同，但仍可复现（记录 seed 即可）
        seed: Date.now() >>> 0,
        bossId: d.getSelection().bossId,
        timeLimitMs: d.timeLimitMs,
        buffs: d.registry.buffs,
        skills: d.registry.skills,
        baseStats: new Map<string, Partial<Record<StatKey, number>>>([
          [d.getSelection().playerId, PLAYER_BASE],
          [d.getSelection().bossId, {}],
        ]),
        passiveModifiers: new Map(),
      },
      /**
       * ⚠️ **现读键位表**（`d.getBindings()`），不能在工厂创建时快照一份：
       * 工厂在 `bindings` 被设置面板改过之后仍要给出**当前**的键位 ——
       * 这正是"改键要同步到 loop"的另一半（loop 是重开时重建的）。
       */
      bindings: d.getBindings(),
      /**
       * ⚠️ 传的是**基础槽位**：派生技（「击」）的槽位由 `ViewAdapter`
       * 每帧**插进来** —— 窗口开了才有、用掉就消失
       * （需求："用掉就消失了"）。适配器是唯一在读派生窗口的地方，
       * 在这里再求值一遍就会有两处真相。
       */
      slots: slotsFromBindings(d.getBindings()),
      timeLimitMs: d.timeLimitMs,
      stopOnEnd: true,
      touchInput: d.touchInput,
    });
}
