/**
 * **内容与用户设置的装配**（`createGameDeps()`）。
 *
 * ==================================================================
 * 为什么单独一个文件
 * ==================================================================
 *
 * 主干的第二步（见 `main.ts` 的说明）是"准备好游戏数据"：内容注册表、
 * 设置存储、键位表、取词。这些都不碰 Pixi，也不碰界面 —— 它们是**被
 * 界面读**的东西。抽出来之后主干上只剩一行 `createGameDeps()`，
 * 而"内容必须先校验、键位必须先于战斗定好"这两条顺序约束集中在一处。
 */

import { createRegistry } from '../core/content/registry';
import {
  ALL_BUFFS,
  ALL_SKILLS,
  BOSS_SKILL_IDS,
  DERIVED_SKILL_IDS,
  WHISPER_SKILL_IDS,
  skillsForPlayer,
} from '../data/content';
import { DEFAULT_PLAYER_ID, resolvePlayerId } from '../data/roster';
import { ALL_QIJI } from '../data/qiji';
import { loadFreeQiji, saveFreeQiji } from './freeQijiStore';
import type { FreeQiji } from '../ui/prepareLogic';
import { flattenCatalog } from '../i18n/translator';
import { zhCN } from '../i18n/locales/zh-CN';
import { resolveOperationMode } from '../render/platform';
import {
  SettingsStore,
  browserStorage,
  loadTouchButtons,
  migrateLegacySettings,
  parseBindings,
  savedOperationMode,
  savedPlayerId,
  type InputMode,
} from './settingsStore';
import { touchButtonIdsFromBindings } from '../input/touchLayout';
import { bindableSkillIdsOf } from './keyRows';
import { TOUCH_BUTTON_CAPACITY } from '../render/touchGeometry';
import type { ContentRegistry } from '../core/content/registry';
import type { KeyBinding } from '../input/keyboard';
import type { ContentBundle } from '../core/content/validate';

/** `createGameDeps()` 的产物。 */
export interface GameDeps {
  /** 内容注册表（**校验通过才允许使用**）。 */
  readonly registry: ContentRegistry;
  /**
   * **按角色**建一张内容注册表 —— 战斗装配读它（见 `battleSetup`）。
   *
   * ==================================================================
   * 为什么战斗用的注册表要按角色重建（2026-10-12）
   * ==================================================================
   *
   * 注册表里的 `skills` 是**引擎解析技能 id 的唯一途径**。两个角色的
   * 技能表不一样，所以"这一局按得出来哪些技能"必须由**这张表**决定 ——
   * 只有这样，"技能栏 / 触屏按钮 / 引擎门禁"三者才是**同一个事实**，
   * 而不是三处各自过滤（那正是"界面有、按下去没反应"的来源）。
   *
   * ⚠️ 它**只影响战斗**：设置页的按键列表仍然用 `registry`（并集），
   * 因为那张表是"整场游戏可绑哪些技能"，不随当前角色变。
   * 见 `data/content.ts` 的 `PLAYER_SKILLS` 说明。
   */
  readonly registryFor: (playerId: string) => ContentRegistry;
  /** 用户设置的持久化（键位表 + UI 缩放 + 上次选择）。 */
  readonly settingsStore: SettingsStore;
  /** 初始键位表（已按注册表里的合法技能 id 过滤）。 */
  readonly bindings: readonly KeyBinding[];
  /**
   * 初始**触屏按钮集合**（技能 id，顺序即槽位）。
   *
   * ⚠️ 它与 `bindings` **互不派生**（用户："触屏和键盘当然是 2 套，
   * 连 localStorage 都是分 2 个 key 存的，只是可选技能是一样的"）。
   * 老存档没有这个键时，这里做**一次迁移**（见 `createGameDeps`）。
   */
  readonly touchButtons: readonly string[];
  /** 本机的输入方式（触屏 / 键鼠）—— 设置存储用它决定默认键位表。 */
  readonly inputMode: InputMode;
  /**
   * **启动时选中的角色**（存档 `raid.pick.player.v1` 校验之后）。
   *
   * ⚠️ 键位按角色分存，所以"读谁的键位"在**读之前**就要定下来 —— 这个值
   * 是那个坐标的**唯一**出处（`game.ts` 的 `selection.playerId` 初值、
   * 以及老存档迁移的目标，都读它，不再各自 `resolvePlayerId` 一遍）。
   */
  readonly playerId: string;
  /**
   * **自由模式的炁机激活**（2026-10-13）。
   *
   * ⚠️ 它是**活的持有者**（`get` 取当前值、`set` 写入），而不是一张快照：
   * 备战屏会改它，而 `phaseFlow` 每开一局都要读**当前**值。
   * 合成一个可变 holder 而不是"两处各留一份" —— 那正是漂移的来源。
   *
   * ⚠️ 它**不是** `SettingsStore` 的字段：那份存档管的是**输入配置**
   * （键位 / 触屏槽位 / 操作方式 / 缩放），而"这一局带哪些强化"是另一
   * 件事（见 `app/freeQijiStore.ts` 的文件头）。
   */
  readonly freeQiji: FreeQijiHolder;
}

/** 自由模式炁机激活集合的**活持有者**（唯一真相）。 */
export interface FreeQijiHolder {
  get(): FreeQiji;
  set(next: FreeQiji): void;
}

/**
 * 准备游戏数据。
 *
 * ⚠️ 必须在**开始战斗之前**完成：键位表决定战斗里的技能栏槽位与触屏按钮，
 * 晚一步就会先按默认跑一局。
 */
export function createGameDeps(): GameDeps {
  /* ---------- 内容（校验通过才允许使用） ---------- */
  const localeKeys = new Set(flattenCatalog(zhCN).keys());
  const registry = createRegistry(
    { entities: [], skills: [...ALL_SKILLS], buffs: [...ALL_BUFFS] },
    { localeKeys },
  );

  /**
   * 按角色建注册表 —— 用**同一个校验器**（非法内容照样启动即失败）。
   *
   * ⚠️ 缓存是**必须**的（而不是优化）：注册表要跑一遍内容校验，
   * 而 `startBattle()` 每次重开都会调它。不缓存等于每局开战前重跑一次
   * 全量校验，卡顿会落在"点开始"这一下。
   */
  const perPlayer = new Map<string, ContentRegistry>();
  const registryFor = (playerId: string): ContentRegistry => {
    const cached = perPlayer.get(playerId);
    if (cached !== undefined) return cached;

    /**
     * ⚠️ 未知角色**回落到默认那一套**：`skillsForPlayer` 对未登记的 id
     * 返回空数组，直接用会建出一张"玩家一个技能都没有"的注册表。
     * 这里的 id 可能来自旧存档（角色被删/改名），而"用默认角色开一局"
     * 比"游戏崩掉"好 —— 真正把 id 收敛回合法值的仍是
     * `roster.resolvePlayerId`（那是它的职责，不在这里重复）。
     */
    const playerSkills = skillsForPlayer(playerId);
    const loadout = playerSkills.length > 0 ? playerSkills : skillsForPlayer(DEFAULT_PLAYER_ID);
    const loadoutIds = new Set(loadout.map((s) => s.id));

    /**
     * 这一局引擎认识的技能 = **这个角色的技能** + **派生技** + **Boss 技能**。
     *
     * ⚠️ 三个来源都必须是**显式**的：
     *   - 角色技能：按 id 从 `ALL_SKILLS` 取，保证 `skills` 里是**同一批对象**
     *     （注册表会把它们塞进 Map，重复对象无所谓，但身份一致更好推理）
     *   - 派生技（「击」）：它不在任何角色的技能表里，必须显式补进来，
     *     否则 P3 的炁机一开窗口就是"技能未注册"
     *   - Boss 技能：按 `BOSS_SKILL_IDS` 判（**不是** id 前缀 —— 见那里的
     *     说明）。⚠️ 也**不是** `!PLAYER_SKILL_IDS`：那个反集还会把
     *     待接线的「破」算进来，于是每一局的引擎都会"认识"一个没人带的
     *     技能（`kits/reserved.ts` 的文件头）
     */
    const bundle: ContentBundle = {
      entities: [],
      skills: [
        ...ALL_SKILLS.filter((s) => loadoutIds.has(s.id)),
        ...ALL_SKILLS.filter((s) => DERIVED_SKILL_IDS.has(s.id)),
        ...ALL_SKILLS.filter((s) => BOSS_SKILL_IDS.has(s.id)),
        /**
         * ⚠️ **「恶魔低语」的技能**（2026-10-16）：Boss 的行为表在抽到那条
         * 低语时按 id 引用它（「自愈」读条）。**不在**这个 bundle 里的后果是
         * 静默的：每 9 秒一次 `skillRejected`，画面上什么都看不到。
         */
        ...ALL_SKILLS.filter((s) => WHISPER_SKILL_IDS.has(s.id)),
      ],
      buffs: [...ALL_BUFFS],
    };
    const built = createRegistry(bundle, { localeKeys });
    perPlayer.set(playerId, built);
    return built;
  };

  /**
   * **操作方式**（键盘 / 触屏）—— 全应用唯一的那个 flag，**只在这里解析一次**。
   *
   * 优先级（`render/platform.resolveOperationMode`，纯函数、有单测）：
   *
   *   1. `?touch=1` / `?touch=0`  —— 强制覆盖（截图验证 / 用户自救）
   *   2. 存档里的选择（「通用」页切的）
   *   3. `'keyboard'`            —— 默认
   *
   * ⚠️ 这里**不再**有任何 `matchMedia` 探测（那一套整块删掉了，见
   * `render/platform.ts` 文件头"这里曾经是能力探测，为什么删了"）。
   * 各消费者（设置面板 / 触屏层 / 场景键名提示 / 存储）读的是**同一个值**
   * —— 面板拿到的是 `getOperationMode()` 取值函数，所以用户在「通用」页
   * 切过去时它们一起变。
   */
  const storage = browserStorage();
  const inputMode: InputMode = resolveOperationMode(
    globalThis.location?.search ?? '',
    savedOperationMode(storage),
  );
  /**
   * ================================================================
   * 键位按**角色**分存（2026-10-12 用户拍板）
   * ================================================================
   *
   * 用户原话："不同的人按键设置应该是分开的"。
   *
   * ⚠️ 顺序是**硬约束**：
   *
   *   1. 先知道是谁（存档里的 `raid.pick.player.v1`，校验后）
   *   2. 再把**老存档**（不按角色分的那一份）迁给他，并**消费掉**老 key
   *   3. 最后才按正常路径读他的键位
   *
   * ⚠️ 第 2 步必须在第 3 步之前：否则第一次加载读到的还是"没有存档"，
   * 老玩家的键位会**看起来丢了**。
   *
   * ⚠️ 迁移**只在这里发生一次**（`createGameDeps` 是启动路径）。运行期
   * 换角色走 `app/playerKeys.switchPlayerProfile`，它**不碰**老 key
   * ——这正是"迁移只做一次"的含义。
   */
  const playerId = resolvePlayerId(savedPlayerId(storage));
  migrateLegacySettings(storage, playerId);
  const settingsStore = new SettingsStore(storage, inputMode, playerId);
  /**
   * ⚠️ 存档里记的选择与本次解析出来的值**可能不同**（`?touch=` 覆盖了它）。
   * 但**不在这里写回**：覆盖是"这一次会话"的事，不该悄悄改掉玩家的偏好
   * ——「通用」页切一次才写。
   */
  const validSkillIds = new Set(registry.skills.keys());
  const bindings: readonly KeyBinding[] = parseBindings(settingsStore.bindings, validSkillIds);

  /**
   * ================================================================
   * 触屏按钮集合：校验 + **老存档迁移一次**
   * ================================================================
   *
   * 需求："老玩家（如果之前靠绑键盘键获得过触屏按钮）**第一次加载时从旧的
   * 派生结果初始化一次**，否则他们的按钮会突然消失。"
   *
   * ⚠️ 迁移**只在这里发生一次**，而且立刻写回存储：下一次加载读到的是
   * 普通存档，走的是 `parseTouchButtons` 的常规路径。**运行期任何地方
   * 都不许再读派生结果**（那会把"没绑键就没按钮"的死结接回来）。
   * 校验与迁移的判定在 `loadTouchButtons`（纯函数，有单测）。
   *
   * ⚠️ 池子是**设置页列出的那些技能**（`bindableSkillIdsOf`，与
   * `buildKeyRows` 同一份判据），与键盘那套**同一张表** —— 用户要求
   * "可选技能是一样的"。用注册表的并集当池会把 Boss 技 / 派生技也放进来
   * （设置页根本给不出它们）。
   *
   * ⚠️ 存储可用而 `setItem` 失败（配额满）无所谓：这次会话里按钮仍然对，
   * 只是下次加载会再迁移一次 —— 迁移是**幂等**的（同样的输入给同样的结果）。
   */
  /**
   * ================================================================
   * 自由模式的炁机激活（2026-10-13）：读一次存档，之后由界面持有
   * ================================================================
   *
   * ⚠️ **读回时要过一遍当前池子**（`loadFreeQiji`）：存档里的 id 可能来自
   * 旧版本（这一周池子就从 5 条变 8 条、有两条改了 id）。不校验会让"一条
   * 不存在的炁机"一路静默到 `buildPlayerKit`（那里找不到就丢掉 ——
   * 表现为玩家的某一条**静默失效**）。
   *
   * ⚠️ **老存档（`{id: 层数}`）要能读回来并写回新形状**：`loadFreeQiji`
   * 认出旧格式时给 `migrated = true`，这里写回一次集合 —— 与
   * `touchButtons` 的迁移是同一条纪律（照本仓库既有做法）。
   */
  const freeLoad = loadFreeQiji(
    storage,
    ALL_QIJI.map((q) => q.id),
  );
  let freeQiji: FreeQiji = freeLoad.ids;
  if (freeLoad.migrated) saveFreeQiji(storage, freeQiji);
  const freeQijiHolder: FreeQijiHolder = {
    get: () => freeQiji,
    set: (next) => {
      freeQiji = next;
      saveFreeQiji(storage, next);
    },
  };

  const touchPool = bindableSkillIdsOf(registry);
  const touchLoad = loadTouchButtons(
    settingsStore.touchButtonsRaw,
    touchPool,
    touchButtonIdsFromBindings(bindings),
    /**
     * ⚠️ **容量要从渲染层的几何取**（`TOUCH_BUTTON_CAPACITY` = 7）：
     * 双弧只放得下 7 个键位，超出部分没有任何位置可画。
     */
    TOUCH_BUTTON_CAPACITY,
  );
  if (touchLoad.migrated) settingsStore.saveTouchButtons(touchLoad.skillIds);

  return {
    registry,
    registryFor,
    settingsStore,
    bindings,
    touchButtons: touchLoad.skillIds,
    inputMode,
    playerId,
    freeQiji: freeQijiHolder,
  };
}
