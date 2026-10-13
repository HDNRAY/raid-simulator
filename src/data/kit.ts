/**
 * **把「角色 + 本局选的炁机」装配成一场战斗的输入**（§5.5 的 `buildPlayerKit`）。
 *
 * ==================================================================
 * 这个文件是什么（一句话，没有"和"）
 * ==================================================================
 *
 * 它是**炁机 → 战斗输入**的唯一规范化点：拿"这一局选了哪些炁机、各几层"，
 * 算出下一场战斗玩家的上限 / 被动修正 / 派生窗口产出者。
 *
 * 设计稿：`docs/specs/2026-10-12-roguelike.md` §5.5（`BattleKit`）与
 * §0.3.1 的 W6 / W7。⚠️ 它是 W7 的**务实那一半**：今天只有两条路被接上
 * （`modifier` 与派生窗口），`grantSkill` 那条仍然要等 P6。
 *
 * ==================================================================
 * ⚠️ 三条它必须守住的性质
 * ==================================================================
 *
 * 1. **默认没有炁机 → 逐字等于今天**
 *    `chosen: []` 时：`caps` 就是 `playerCapsFor(id)`、`modifiers` 是空数组、
 *    `comboWindows` 是空数组。单场 / 自由模式 / 黄金重放走的都是这一支。
 *
 * 2. **`maxHp` 只写进 `caps.hp`（W6 的过渡）**
 *    引擎的钳制今天读 `combatant.caps.hp`，而 `maxHp` 属性**算出来没人读**
 *    （`core/combat/index.ts` 的 `changeResource`）。所以这里把 `maxHp`
 *    修正**累加进 caps** —— 用户要的"+30 血上限"就是这样生效的。
 *    ⚠️ W6 做完之后要改的**只有这里**（把这一步删掉、让钳制读结算值），
 *    而 `data/qiji.ts` 的数据一个字都不用动 —— 这正是当初把效果写成标准
 *    `modifier` 的理由。
 *
 * 3. **同一秒只可能有一个窗口开着**
 *    `comboWindows` 是**数组**（可同时选两条「派生 击」的炁机，例如凯丽同时
 *    有「截」与「闪」），但引擎挂在玩家身上的 `combo-window` buff 只有一个
 *    （`maxStacks: 1` + `refresh`）—— "后派生的顶掉先派生的"是内容层
 *    已经定好的语义（见 `kits/combo.ts` 的 `comboWindowFor`）。
 */

import { PLAYER_BASE, playerCapsFor } from './units';
import type { QijiEntity, QijiSkillTweak } from '../core/types/qiji';
import type { StatKey, StatModifier } from '../core/types';
import type { ComboWindowSpec } from '../core/combat/comboWindow';

/**
 * 一局里**已经选了生效**的一个炁机（`RunState.chosen` 的元素）。
 *
 * ⚠️ 形状与 `core/run/types.ts` 的 `RunChoice` **刻意同构**，但不 import 它：
 * `core/run` 是"一局肉鸽的账本"，`data/` 是内容 —— 让内容层为了一个形状
 * 去依赖账本层会造出方向相反的 import。两边都是 `{ qijiId, stacks }`，
 * 而**唯一需要它们一致的地方是 app 层**（`runSession`），那里传参时会
 * 被编译器检查。
 */
export interface ChosenQiji {
  readonly qijiId: string;
  readonly stacks: number;
}

/** 一场战斗的玩家输入（§5.5 的 `BattleKit`）。 */
export interface PlayerKit {
  /** 属性管线的基底（`CreateBattleOptions.baseStats` 的玩家那一份）。 */
  readonly base: Partial<Record<StatKey, number>>;
  /** 资源上限。**`hp` 已经含了炁机给的加血上限**（见文件头第 2 条）。 */
  readonly caps: { readonly hp: number; readonly energy: number; readonly douqi: number };
  /** 被动修正（`CreateBattleOptions.passiveModifiers` 的玩家那一份）。 */
  readonly modifiers: readonly StatModifier[];
  /** 派生窗口产出者（`CreateBattleOptions.comboWindows`）。 */
  readonly comboWindows: readonly ComboWindowSpec[];
  /**
   * **对某些技能定义的改动**（用户的「避回缠 / 凝减耗 / 凝增伤」三条）。
   *
   * ⚠️ 它是**纯数据里的纯数据**：`buildPlayerKit` 只负责"把内容层的
   * `QijiSkillTweak` 收集、按顺序排好"，**不解析**它。
   * 真正的解释在 `data/skillTweak.ts` 的 `applySkillTweaks`
   * （那里才知道 `SkillDef` / `BuffDef` 的形状），由
   * `app/battleSetup.ts` 在建战斗时应用到技能表上。
   *
   * 这样切是为了守住"默认没有炁机 → 逐字等于今天"：空数组时
   * 装配那边一个分支都不进，单场 / 自由模式 / 黄金重放完全不变。
   */
  readonly skillTweaks: readonly QijiSkillTweak[];
}

/*
 * ⚠️ 这里**没有** `innate`（"开局就挂的固有 buff"）与 `sourceSkillIds`
 * （"这一局开了哪几条派生关系"）—— 它们都曾经写在这里，但**没有任何
 * 消费者**（第一版我顺手加的，`app/battleSetup.ts` 一个都没读）。
 *
 * 按 AGENTS.md §2 的"死值先删"：
 *   - 固有 buff 那条路是 **W7/P6**（实体规范化）的事 —— 那时
 *     `makePlayer` 会像 `data/units.ts` 的 `innateBuffsFor` 给色欲挂被动
 *     那样把它挂上去，届时再加字段
 *   - "开了哪几条关系"从 `comboWindows` 的 `sourceSkillId` 一眼看得出来，
 *     再存一份就是**同一件事的第二份表达**（会漂）
 */

/** 一局肉鸽里"已经生效"的炁机（定义 + 层数）。 */
export interface ActiveQiji {
  readonly def: QijiEntity;
  readonly stacks: number;
}

/**
 * **把选中的炁机接成战斗输入**。纯函数，可在 node 里单测。
 *
 * @param playerId 角色 id（`data/roster.ts` 的 `PLAYER_ROSTER`）
 * @param chosen 已经生效的炁机（**顺序无关**：所有 op 都是交换的，
 *   §5.3 明令禁止 `setOverride` —— 那一条由内容测试钉住）
 */
export function buildPlayerKit(
  playerId: string,
  chosen: readonly ActiveQiji[] = [],
): PlayerKit {
  const baseCaps = playerCapsFor(playerId);

  const modifiers: StatModifier[] = [];
  const comboWindows: ComboWindowSpec[] = [];
  const skillTweaks: QijiSkillTweak[] = [];
  /** `maxHp` 的累加值 —— 最后加进 `caps.hp`（见文件头第 2 条）。 */
  let bonusHp = 0;

  for (const { def, stacks } of chosen) {
    /**
     * ⚠️ 层数按**逐份复制**展开，而不是把 value 乘起来：
     * 修正条目本身带 `sourceKey`（溯源面板用它），而"3 层"在溯源里就是
     * 三条同源条目 —— 折成一条会让面板显示不出"叠了几层"。
     * （交换律保证结果与"乘以层数"相同，见 §5.3。）
     */
    for (const ability of def.abilities) {
      if (ability.kind !== 'modifier') continue;
      for (let i = 0; i < stacks; i += 1) modifiers.push(ability.modifier);
      /**
       * `maxHp` 额外累加进 caps（W6 的过渡）。取值只在**纯数字**时有效：
       * 表达式型的 `maxHp` 今天表达不了（`caps` 是编译期常量），
       * 所以内容里写 `{ e: 'const' }` 这种会被下面的判断挡掉 ——
       * 记在 `tests/unit/qiji.test.ts` 里，免得有人以为它会生效。
       */
      if (ability.modifier.stat !== 'maxHp') continue;
      const value = typeof ability.modifier.value === 'number' ? ability.modifier.value : 0;
      if (ability.modifier.op === 'add') bonusHp += value * stacks;
    }

    const window = def.comboWindow;
    if (window !== undefined) {
      comboWindows.push({
        buffId: window.buff.id,
        sourceSkillId: window.sourceSkillId,
        ...(window.viaBuffId === undefined ? {} : { viaBuffId: window.viaBuffId }),
      });
    }

    /**
     * ⚠️ **层数不参与**：`skillTweak` 说的都是**绝对值**（代价 −20、
     * 增伤变成 100%），叠第二层没有任何语义。所以这里每条只收一份，
     * 哪怕 `stacks > 1`（这类炁机不写 `maxStacks`，默认 1 层）。
     */
    if (def.skillTweak !== undefined) skillTweaks.push(def.skillTweak);
  }

  return {
    base: PLAYER_BASE,
    caps: { ...baseCaps, hp: baseCaps.hp + bonusHp },
    modifiers,
    comboWindows,
    skillTweaks,
  };
}
