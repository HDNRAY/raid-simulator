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
 *
 * ==================================================================
 * 2026-10-12：**按选中的角色装配那一套技能**
 * ==================================================================
 *
 * 原先战斗用的是"一套通用玩家技能"，所以选谁打都一样。现在：
 *
 *   1. 技能集按角色取（`playerSkillsFor` → 林晚风 5 招 / 凯丽 5 招）
 *   2. 内容注册表也**按角色重建**（`deps.ts` 的 `createRegistryFor`）
 *      —— 只有注册表里的技能才解析得到，所以这是"装配"的真正落点
 *   3. **键位表按技能集过滤**（`bindingsForPlayer`）—— 这是机械派生
 *      三处（技能栏 / 触屏双弧 / 设置页）不出错的前提
 *
 * 定稿见 `docs/specs/2026-10-12-player-kits.md`。
 */

import { BattleLoop } from './battleLoop';
import { slotsFromBindings } from './viewAdapter';
import { makeBoss, makePlayer, PLAYER_BASE } from '../data/units';
import { playerSkillIdsFor } from '../data/content';
import type { ContentRegistry } from '../core/content/registry';
import type { KeyBinding } from '../input/keyboard';
import type { StatKey } from '../core/types';
import type { InputSource } from '../input/keyboard';
import { translateSafe } from './translate';

/** 组装一局战斗需要的东西（每次开局读一次，"当前选择"是活的）。 */
export interface StartBattleDeps {
  /**
   * **按角色**取内容注册表。
   *
   * ⚠️ 传 getter 而不是一张固定的注册表：注册表里装着技能表，而技能表
   * 这一局该装哪 5 个**取决于开打那一刻选的是谁**。固定一张会让"换角色"
   * 只在界面上生效（技能栏变了、引擎那边还是旧表）。
   */
  readonly registryFor: (playerId: string) => ContentRegistry;
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
 * **只留这个角色真的有的技能**。
 *
 * ==================================================================
 * 为什么需要过滤（不这样做会怎样）
 * ==================================================================
 *
 * `DEFAULT_BINDINGS` 是**整场游戏**的键位表（Q 斩 / S 防 / A 避……），
 * 而凯丽**没有「防」也没有「避」**。不过滤的话：
 *   - 技能栏会出现 S「防」与 A「避」两个格子，按下去 `skillRejected`
 *     （"技能不存在"或条件不满足）—— 玩家会以为是 bug
 *   - 触屏双弧按钮**由键位表机械派生**（`touchButtonsFromBindings`），
 *     于是她的弧上也会多出两个按不出东西的按钮
 *
 * ⚠️ 过滤放在**这里**（装配那一刻），而不是去改 `DEFAULT_BINDINGS`：
 * 那张表是"可绑技能的全集"，属于设置页；而"这个角色这一局带什么"
 * 是每一局的事实。两件事混进一张表，换角色时就会互相打架。
 *
 * ⚠️ 空键（`key === ''`）**保留**：它们本来就不上场（`slotsFromBindings`
 * 才过滤空键），但设置页要靠它们知道"这个技能还没绑"。
 */
export function bindingsForPlayer(
  bindings: readonly KeyBinding[],
  playerId: string,
): readonly KeyBinding[] {
  const owned = playerSkillIdsFor(playerId);
  return bindings.filter((b) => owned.has(b.skillId));
}

/**
 * 建一个"开始战斗"工厂。
 *
 * @returns 每次调用**新建**一个 `BattleLoop`（上一局由调用方 `dispose`）。
 */
export function createStartBattle(d: StartBattleDeps): () => BattleLoop {
  return (): BattleLoop => {
    /**
     * ⚠️ **只读一次选择**：`getSelection()` 每次调用都会现取（它是活的），
     * 分开调用两次有可能拿到不同的值（玩家在两次调用之间换了人），
     * 那会造出"技能是凯丽的、名字是林晚风的"这种不可能解释的状态。
     */
    const { playerId, bossId } = d.getSelection();
    const registry = d.registryFor(playerId);
    const bindings = bindingsForPlayer(d.getBindings(), playerId);

    return new BattleLoop({
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
         * 名字与血上限都由 `makePlayer(id)` 按角色取值（林晚风 150 /
         * 凯丽 120），见 `data/units.ts` 的 `PLAYER_HP_BY_ID`。
         */
        combatants: [makePlayer(playerId), makeBoss(bossId, { noAi: d.noAi })],
        // 用真实时钟做种子：每次开局不同，但仍可复现（记录 seed 即可）
        seed: Date.now() >>> 0,
        bossId,
        timeLimitMs: d.timeLimitMs,
        /**
         * ⚠️ **技能集按角色取**（`registryFor(playerId)`）—— 见
         * `StartBattleDeps.registryFor`。注册表里只有这个角色的 5 招
         * （加 Boss 的招），所以"按下别的角色的技能"是不可能的：
         * 引擎解析不到那个 id，技能栏里也不会有它的槽位。
         */
        buffs: registry.buffs,
        skills: registry.skills,
        baseStats: new Map<string, Partial<Record<StatKey, number>>>([
          [playerId, PLAYER_BASE],
          [bossId, {}],
        ]),
        passiveModifiers: new Map(),
      },
      /**
       * ⚠️ **现读键位表**（`d.getBindings()`），不能在工厂创建时快照一份：
       * 工厂在 `bindings` 被设置面板改过之后仍要给出**当前**的键位 ——
       * 这正是"改键要同步到 loop"的另一半（loop 是重开时重建的）。
       */
      bindings,
      /**
       * ⚠️ 传的是**基础槽位**：派生技（「击」）的槽位由 `ViewAdapter`
       * 每帧**插进来** —— 窗口开了才有、用掉就消失
       * （需求："用掉就消失了"）。适配器是唯一在读派生窗口的地方，
       * 在这里再求值一遍就会有两处真相。
       */
      slots: slotsFromBindings(bindings),
      timeLimitMs: d.timeLimitMs,
      stopOnEnd: true,
      touchInput: d.touchInput,
    });
  };
}
