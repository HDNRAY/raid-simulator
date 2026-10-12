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
  skillsForPlayer,
} from '../data/content';
import { DEFAULT_PLAYER_ID } from '../data/roster';
import { flattenCatalog } from '../i18n/translator';
import { zhCN } from '../i18n/locales/zh-CN';
import { detectBrowserPlatform } from '../render/platform';
import {
  SettingsStore,
  browserStorage,
  loadTouchButtons,
  parseBindings,
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
      ],
      buffs: [...ALL_BUFFS],
    };
    const built = createRegistry(bundle, { localeKeys });
    perPlayer.set(playerId, built);
    return built;
  };

  /**
   * **用户设置的持久化**（键位表 + UI 缩放）。
   *
   * ⚠️ 用 `detectBrowserPlatform().touch` 而不是 `touch.caps.touch`：
   * 后者要等 `createTouchControls`（在下面），而 `SettingsPanel` 也是用
   * `detectBrowserPlatform()` 判定的 —— **同源，不会出现两套判定**。
   */
  const inputMode: InputMode = detectBrowserPlatform().touch ? 'touch' : 'keyboard';
  const settingsStore = new SettingsStore(browserStorage(), inputMode);
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
  };
}
