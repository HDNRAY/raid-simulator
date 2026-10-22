/**
 * **换角色 = 换一整套键位** —— 运行期的**唯一写入点**。
 *
 * ==================================================================
 * 为什么单独一个文件
 * ==================================================================
 *
 * 用户原话："**不同的人按键设置应该是分开的**"。
 *
 * 存储形状因此变成"每个角色各一份"（见 `settingsStore.ts` 文件头）：
 *
 *   `raid.bindings.keyboard.<playerId>.v1`
 *   `raid.bindings.touch.<playerId>.v1`
 *   `raid.touchButtons.<playerId>.v1`
 *
 * 于是"换角色"不再只是换一个显示用的 id —— 它要同时改**四件事**，
 * 而这四件事必须一起发生（少一件就是"界面换了、按下去还是旧键"）：
 *
 *   1. `SettingsStore` 的当前角色（它决定**以后**读写哪一份）
 *   2. `GameState.bindings` —— 这一局技能栏 / 键位提示读的就是它
 *   3. 战斗循环里的键位（`loop.setBindings`）
 *   4. `GameState.touchButtons` —— 触屏双弧上的槽位
 *
 * 这与 `app/operationMode.ts` 是**同一个形状**（那边换的是"键盘/触屏"，
 * 换一次要改五件事）。两处都是"切换一个坐标 → 一串连带后果"，
 * 所以都独立成文件、都只留一个入口。写在装配函数里只会被
 * "接下来还有一堆界面要建"淹掉。
 *
 * ==================================================================
 * ⚠️ 战斗中不允许换角色（所以没有"键位当场变了"的问题）
 * ==================================================================
 *
 * 换角色只从 `game.ts` 的 `enterBattle` 走，而它是"开一局新战斗"的入口
 * （备战界面点开始 / 选角色屏开始 / 结算面板重开 / `?prepare=skip`）。
 * 战斗中没有任何界面能换人 —— 所以**不会出现"打着打着技能栏的键变了"**
 * （那会让玩家按下的键对应到另一个技能）。
 *
 * ⚠️ 与它对照：**操作方式**确实能战斗中切（设置面板在战斗中打得开），
 * 那是 `operationMode.ts` 的事，与换角色无关（换方式时角色不变，
 * 所以读到的仍然是**这个角色**的另一份键位）。
 */

import { TOUCH_BUTTON_CAPACITY } from '../render/touchGeometry';
import { touchButtonIdsFromBindings } from '../input/touchLayout';
import { bindableSkillIdsOf } from './keyRows';
import { defaultBindingsOf } from '../input/keyboard';
import { skillsForPlayer } from '../data/content';
import { loadTouchButtons, parseBindings, type SettingsStore } from './settingsStore';
import type { ContentRegistry } from '../core/content/registry';
import type { GameState } from './flow';

/** 切一次角色要碰的东西。 */
export interface PlayerProfileDeps {
  /** 共享可变状态（`bindings` / `touchButtons` / `loop` 都住在里面）。 */
  readonly state: Pick<GameState, 'bindings' | 'touchButtons' | 'loop'>;
  readonly store: SettingsStore;
  /**
   * 用来把键位表里的失效 id 滤掉 —— 与启动时**同一份判据**
   * （`parseBindings`），两处各写一遍就会漂。
   */
  readonly registry: ContentRegistry;
  /**
   * 触屏层（把新槽位推给它）。
   *
   * ⚠️ **取值函数**而不是值：`?prepare=skip` 会让 `enterBattle` 早于触屏层
   * 构造（那时它是 `undefined`），而"按键要重推"是**之后**才需要的事
   * （`touchSetup` 之后触屏层自己会建好初始按钮）。
   */
  readonly touch: () => { setButtons(skillIds: readonly string[]): void } | undefined;
}

/**
 * 把"当前角色"切到 `playerId`，并把这一整套键位换过去。
 *
 * ⚠️ **同一个角色再调一次是空操作**（`store.playerId` 相同就返回）：
 * `enterBattle` 在"重开一局"时也会走到这里，而那时的键位表是**内存里
 * 最新**的那一份（玩家可能刚改过键，`setItem` 万一因配额失败，
 * 从存储重读会把刚改的丢掉）。换人才重读，是这条守卫的全部理由。
 *
 * @returns 是否真的换了角色（调用方/测试用）
 */
export function switchPlayerProfile(deps: PlayerProfileDeps, playerId: string): boolean {
  if (deps.store.playerId === playerId) return false;
  deps.store.setPlayer(playerId);

  /**
   * ⚠️ 用**并集**注册表（`deps.registry`）当合法技能集合，与启动时
   * （`deps.ts` 的 `parseBindings(settingsStore.bindings, validSkillIds)`）
   * 同一份判据。用**这个角色**的注册表会把别的角色的技能当"失效"丢掉 ——
   * 而设置页列的是整场游戏可绑的技能（见 `deps.ts` 的 `registryFor` 说明）。
   */
  const bindings = parseBindings(
    deps.store.bindings,
    new Set(deps.registry.skills.keys()),
    defaultBindingsOf(skillsForPlayer(playerId).map((skill) => skill.id)),
  );
  deps.state.bindings = bindings;
  deps.state.loop?.setBindings(bindings);

  /**
   * ⚠️ 触屏槽位**也要换**（用户说的是"按键设置"，而触屏那套也是按键设置）
   * —— 它是**这个角色自己的**一份，不能沿用上一个人的。
   *
   * ⚠️ 迁移来源是"这个角色键位表里有键的技能"（`touchButtonIdsFromBindings`）：
   * 这一条**只剩两个用途**（老存档迁移一次 / 「恢复默认」的默认值），
   * 运行期不再派生（见 `input/touchLayout.ts` 文件头）。
   */
  const touchLoad = loadTouchButtons(
    deps.store.touchButtonsRaw,
    bindableSkillIdsOf(deps.registry),
    touchButtonIdsFromBindings(bindings),
    TOUCH_BUTTON_CAPACITY,
  );
  if (touchLoad.migrated) deps.store.saveTouchButtons(touchLoad.skillIds);
  deps.state.touchButtons = touchLoad.skillIds;
  deps.touch()?.setButtons(touchLoad.skillIds);

  return true;
}
