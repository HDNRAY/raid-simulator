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
 *
 * ==================================================================
 * 2026-10-13：**一场战斗的种子从 run seed 派生**（B）
 * ==================================================================
 *
 * 原先是 `seed: Date.now() >>> 0`：与 `RunState.runSeed` **没有任何派生
 * 关系**。于是 `core/run/types.ts` 的 `RunBattleRecord.seed` 注释（"由
 * `battleSeed` 派生"）与 `tests/unit/run/record.test.ts` 造的记录，都描述的
 * 是一件**线上没发生**的事 —— 文档 / 测试与线上对不上，P7（中途存档 +
 * 重放）也就复现不出"同一局"。
 *
 * 现在分两支（判据是**有没有进行中的一局肉鸽**）：
 *
 *   1. **肉鸽**（`getRun` 给得出 `runSeed` + `position`）：
 *      `battleSeed(runSeed, position)` —— 纯函数、每场独立（§7.1 的约定，
 *      原文就写在 `docs/specs/2026-10-12-roguelike.md` §7.1 里）。
 *   2. **自由模式 / 直接单场 / 黄金夹具**（没有那一局）：仍然是
 *      `Date.now() >>> 0`。⚠️ 这一支**逐字不变** —— 黄金基线与单场路径
 *      都走它，所以"基线动了没有"是实测出来的，不是推理出来的。
 *
 * ⚠️ 与 `?runseed=` 的收益：同一条 URL 跑两次，**Boss 顺序 + 每场战斗
 * 内部**（出招序列 / 骰子）全部相同。`REPLAY_FORMAT_VERSION` **不动** ——
 * 依据写在下面的 `battleSeedOf`。
 */

import { BattleLoop } from './battleLoop';
import { slotsFromBindings } from './viewAdapter';
import { makeBoss, makePlayer } from '../data/units';
import { bossDefById } from '../data/bossDefs';
import { buildPlayerKit, type PlayerKit } from '../data/kit';
import { applySkillTweaks } from '../data/skillTweak';
import { playerSkillIdsFor } from '../data/content';
import type { ContentRegistry } from '../core/content/registry';
import type { KeyBinding } from '../input/keyboard';
import type { StatKey, StatModifier } from '../core/types';
import type { InputSource } from '../input/keyboard';
import { battleSeed } from '../core/run/index';
import type { RunState } from '../core/run/index';
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
  /**
   * **这一局生效的炁机装配**（肉鸽的 P3 接线；自由模式返回"没有炁机"）。
   *
   * ⚠️ 传 getter 而不是一张算好的：每开一局都要读**当前**的 `chosen`
   * （打一场 → 选一个炁机 → 下一场要带上它），快照一份就会永远停在开局。
   *
   * ⚠️ 默认不传 = `buildPlayerKit(playerId)`（等价于空 `chosen`）——
   * 单场 / 自由模式因此**逐字不变**。
   */
  readonly getPlayerKit?: (playerId: string) => PlayerKit;
  /**
   * **当前这一局肉鸽**（`RunState`），没有进行中的一局时返回 `undefined`。
   *
   * ⚠️ 它存在的**唯一**用途是取出 `(runSeed, position)` 去派生一场战斗的
   * 种子（`battleSeedOf`）。传 getter 而不是两个数：`position` 每场都在变
   * （打完一场 → 第 2 场），而 `runSeed` 两处读会在"重开一局"时漂开
   * —— 分开两个 getter 就会允许"种子是这一局的、场次是上一局的"。
   *
   * ⚠️ **默认不传 = 没有那一局**（单场 / 自由模式 / 黄金夹具）：那时战斗
   * 种子照旧现取时钟，与"这一局"无关（判据与理由见 `battleSeedOf`）。
   */
  readonly getRun?: () => RunState | undefined;
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
 * ⚠️ 触屏按钮**不经过本函数**（2026-10-12）：它已经不是"有键的技能"了
 * （见 AGENTS.md §3b 的作废标注），触屏层按**引擎的技能集**
 * （`app/touchControls.ts` 的 `currentSkillIds`）自己过滤一遍。
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
 * **一场战斗的种子**：有那一局肉鸽就从 run seed 派生，否则现取时钟。
 *
 * ==================================================================
 * 为什么分两支、兜底为什么是时钟
 * ==================================================================
 *
 * - **肉鸽（有 `runSeed` + `position`）**：`battleSeed(runSeed, position)`
 *   —— 这是 `docs/specs/2026-10-12-roguelike.md` §7.1 **早就写死**的约定
 *   （"每场战斗的种子 = `battleSeed(runSeed, k)`，每场独立"），也是
 *   `core/run/types.ts` 的 `RunBattleRecord.seed` 与
 *   `tests/unit/run/record.test.ts` 一直在用的那条。原先线上跑的是
 *   `Date.now()`，所以两边对不上（沿革见文件头）。
 * - **没有那一局**（自由模式 / 直接单场 `?prepare=skip` / 黄金夹具）：
 *   仍然 `Date.now() >>> 0`。**这不是"忘了改"** —— 那几步根本**没有**
 *   `runSeed` / `position` 可取（没有一局肉鸽），硬凑一个来源只会造出
 *   一个假的确定性。⚠️ 黄金基线（`tests/golden/fixtures.ts`）走的正是
 *   这一支，所以"基线不动"是它**保持原样**的结果。
 *
 * `position` **只认正整数**：`RunState.position` 在肉鸽里是 1-based
 * （`battleRecordOf` 直接抄它进记录），非正数说明调用方拿错了状态 ——
 * 那时回落到时钟，而不是把 `position = 0` 混进种子（那会让"记录里的
 * 场次"与"种子里的场次"是两个不同的数）。
 *
 * ⚠️ **`REPLAY_FORMAT_VERSION` 不 +1（依据）**：
 *
 *   - 版本号钉的是**引擎的确定性语义**（同一份 `seed + 输入` → 同一结果），
 *     本改动**一个字都没碰引擎** —— 重放文件里的 `seed` 是**存下来的**，
 *     拿它再跑一遍仍然逐位相同。
 *   - 真正变的是 **app 层"新一局战斗的种子从哪儿取"**。它不改任何既有
 *     `RecordedRun` 的含义，也不要求重标定 `GOLDEN_OUTCOME`（实测见下方
 *     回报）。这正是 `record.ts` 里那条"两个版本号判据不同、不要互相
 *     套用"的另一个实例：记录**形状**变了才动 `RUN_FORMAT_VERSION`，
 *     引擎**语义**变了才动 `REPLAY_FORMAT_VERSION`，这次两边都没变。
 */
export function battleSeedOf(
  run: Pick<RunState, 'runSeed' | 'position'> | undefined,
  clock: () => number = Date.now,
): number {
  if (run !== undefined && Number.isInteger(run.position) && run.position >= 1) {
    return battleSeed(run.runSeed, run.position);
  }
  return clock() >>> 0;
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
    /**
     * 这一场玩家的装配（炁机在这里生效）。
     *
     * ⚠️ **在 `getSelection()` 之后立刻读**：与它同一条"只读一次"的理由
     * —— 分开两次调用可能在两次之间换了人，那会造出"技能是凯丽的、
     * 血量是林晚风的"这种不可能解释的状态。
     */
    const kit = d.getPlayerKit?.(playerId) ?? buildPlayerKit(playerId);

    /**
     * **炁机的 `skillTweak` 落点**（「避」回缠 / 「凝」减耗 / 「凝」增伤）。
     *
     * ⚠️ 它必须在**建战斗那一刻**应用（不能改注册表里的定义）：注册表是
     * **按角色缓存**的（`deps.ts` 的 `perPlayer`），就地改它会让
     * "这一局选了减耗炁机"污染所有后来的局 —— 而且缓存那一份还是
     * 设置页 / 备战界面读的"基础定义"，改了它两边都会漂。
     *
     * 空 `skillTweaks` 时 `applySkillTweaks` 直接回**同一张表**（引用不变），
     * 所以单场 / 自由模式 / 黄金重放走的还是注册表原本的那两个 Map。
     */
    const tweaked = applySkillTweaks({ skills: registry.skills, buffs: registry.buffs }, kit.skillTweaks);

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
        combatants: [makePlayer(playerId, { kit }), makeBoss(bossId, { noAi: d.noAi })],
        /**
         * **一场战斗的种子**（见 `battleSeedOf`）：
         *   - 肉鸽 → `battleSeed(runSeed, position)`（每场独立，§7.1）
         *   - 自由模式 / 单场 / 黄金夹具 → 照旧 `Date.now() >>> 0`
         *
         * ⚠️ **每次开局现读**（`d.getRun?.()`）：`position` 一场一变，
         * 快照一份会让第 2 场还拿着第 1 场的种子（两场内部一模一样）。
         */
        seed: battleSeedOf(d.getRun?.()),
        bossId,
        timeLimitMs: d.timeLimitMs,
        /**
         * ⚠️ **技能集按角色取**（`registryFor(playerId)`）—— 见
         * `StartBattleDeps.registryFor`。注册表里只有这个角色的 5 招
         * （加 Boss 的招），所以"按下别的角色的技能"是不可能的：
         * 引擎解析不到那个 id，技能栏里也不会有它的槽位。
         *
         * ⚠️ 这两行读的是 `tweaked`（可能被炁机改过的**副本**）——
         * 技能的代价 / 挂上去的 buff 因此在这一局里真的变了；
         * 没有 `skillTweak` 时它就是 `registry` 那两个 Map 本身。
         */
        buffs: tweaked.buffs,
        skills: tweaked.skills,
        baseStats: new Map<string, Partial<Record<StatKey, number>>>([
          [playerId, kit.base],
          [bossId, {}],
        ]),
        /**
         * ⚠️ **这一场玩家身上的被动修正**（炁机的 `modifier` 走这里）。
         *
         * 原先传的是 `new Map()`（空）—— 因为当时没有任何东西产生被动修正。
         * 现在它是 `buildPlayerKit` 的产物之一；空 `chosen` 时又是空数组，
         * 所以单场路径逐字不变。
         */
        /**
         * ⚠️ **Boss 也有一份**（2026-10-14 加）：它的**被动技能**里
         * `kind: 'modifier'` 的那些能力（例如「懒惰」的「怠惰」给的基础
         * +1 点/秒回血）。`makeBoss` 只造 `Combatant`、拿不到这份 Map，所以
         * 两条路按 kind 分派：`grant` 归 `makeBoss`、`modifier` 归这里。
         *
         * ⚠️ 没有被动技能的 Boss ⇒ 空数组 ⇒ 与今天逐字相同。
         */
        passiveModifiers: new Map<string, readonly StatModifier[]>([
          [playerId, kit.modifiers],
          [
            bossId,
            bossDefById(bossId).passives.flatMap((passive) =>
              passive.abilities.flatMap((ability) =>
                ability.kind === 'modifier' ? [ability.modifier] : [],
              ),
            ),
          ],
        ]),
        /**
         * ⚠️ **派生窗口的产出者**（「截 / 卸 / 闪」成功时开窗 → 「击」可用）。
         *
         * 引擎侧的唯一消费者在 `core/combat/comboWindowHandler.ts`；
         * 空数组 = 没有炁机 = **完全的空操作**（黄金重放因此逐位不变）。
         */
        comboWindows: kit.comboWindows,
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
