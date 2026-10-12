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
import { ALL_BUFFS, ALL_SKILLS } from '../data/content';
import { flattenCatalog } from '../i18n/translator';
import { zhCN } from '../i18n/locales/zh-CN';
import { detectBrowserPlatform } from '../render/platform';
import {
  SettingsStore,
  browserStorage,
  parseBindings,
  type InputMode,
} from './settingsStore';
import type { ContentRegistry } from '../core/content/registry';
import type { KeyBinding } from '../input/keyboard';

/** `createGameDeps()` 的产物。 */
export interface GameDeps {
  /** 内容注册表（**校验通过才允许使用**）。 */
  readonly registry: ContentRegistry;
  /** 用户设置的持久化（键位表 + UI 缩放 + 上次选择）。 */
  readonly settingsStore: SettingsStore;
  /** 初始键位表（已按注册表里的合法技能 id 过滤）。 */
  readonly bindings: readonly KeyBinding[];
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
  const registry = createRegistry(
    { entities: [], skills: [...ALL_SKILLS], buffs: [...ALL_BUFFS] },
    { localeKeys: new Set(flattenCatalog(zhCN).keys()) },
  );

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

  return { registry, settingsStore, bindings, inputMode };
}
