/**
 * **触屏层的装配**（能力探测 + 布局 + 输入源 + 双弧按钮层）。
 *
 * ==================================================================
 * 为什么单独一个文件
 * ==================================================================
 *
 * `createTouchControls`（`app/touchControls.ts`）已经把所有触屏逻辑收在
 * 它自己里面了，这一段剩下的是**接线**：把"当前战斗 / 设置是否打开 /
 * 是否在战斗 / 当前派生技 / **用户选的按钮集合**"这些活的量喂给它，再把
 * 它产出的能力值发给别的部件（技能格的键提示、齿轮按钮的快捷键提示）。
 *
 * 抽出来之后 `createGame()` 里只剩一句 `createTouchSetup(...)`，
 * 而**"谁先谁后"的约束**（面板先于触屏、触屏先于回填能力值）集中可见。
 */

import { Container, Graphics, Sprite, Text, type Application } from 'pixi.js';
import { createTouchControls, derivedOfSnapshot, type TouchControls } from './touchControls';
import { translateSafe } from './translate';
import type { BattleLoop } from './battleLoop';

/**
 * 触屏**能力值**的转交点。
 *
 * ⚠️ 它存在的唯一理由是**构造顺序**：设置面板必须先于触屏层构造（面板要
 * 按能力值决定是否显示键位提示），而能力值只有触屏层建好才知道。所以先在
 * `settingsSetup.ts` 里造一个占位对象，这里建好之后**回填**它。
 * 用 `const` 对象而不是 `let` 函数 —— 符合 lint，也不依赖"首次渲染
 * 足够晚"这种隐含前提。
 *
 * ⚠️ 它**不再**携带"触屏按钮预览"：按钮现在由玩家在设置页自己配
 * （见 `input/touchLayout.ts` 文件头），预览被真正的编辑器取代了。
 */
export interface TouchCapsSource {
  /** 是否显示键位提示（触屏为 `false`）。 */
  showKeyHints: boolean;
}

/** 触屏装配需要的外部依赖。 */
export interface TouchSetupDeps {
  /** Pixi 应用（触屏按钮层挂在它的 stage 上）。 */
  readonly app: Application;
  /** 当前战斗循环（非战斗阶段为 `undefined`）。 */
  readonly battle: () => BattleLoop | undefined;
  /** 设置面板是否打开（打开时触屏按钮让出输入权）。 */
  readonly isSettingsOpen: () => boolean;
  /** 是否**正在战斗**（非战斗时战斗场景整块隐藏，触屏按钮也要跟着藏）。 */
  readonly isBattleActive: () => boolean;
  /**
   * **用户选的触屏按钮技能 id**（顺序即槽位）。
   *
   * ⚠️ 与键盘绑定表无关（用户 2026-10-12 推翻了原来的派生）。
   */
  readonly touchSkillIds: () => readonly string[];
  /** 触屏的能力值变化要通知的部件。 */
  readonly scene: { setShowKeyHints(show: boolean): void };
  readonly settingsButton: { setShowShortcut(show: boolean): void };
  /** 能力值的转交点（本函数负责回填）。 */
  readonly capsSource: TouchCapsSource;
}

/**
 * 创建触屏层并接好它的上下游。
 *
 * ⚠️ 触屏控件（布局 + 按钮层 + 输入源）的生命周期**比一局长得多** ——
 * 重开一局不该把按钮布局丢掉。所以每局重建的 `BattleLoop` 通过
 * `touchInput: () => touch.input` **getter** 读它（见 `battleSetup.ts`）。
 */
export function createTouchSetup(d: TouchSetupDeps): TouchControls {
  const touch = createTouchControls({
    pixi: { Container, Graphics, Sprite, Text },
    translate: translateSafe,
    touchSkillIds: d.touchSkillIds,
    currentTick: () => d.battle()?.engineState.snapshot.tick ?? 0,
    isSettingsOpen: d.isSettingsOpen,
    /** 非战斗阶段（首页 / 选角色 / 自由模式）触屏按钮也要藏。 */
    isBattleActive: d.isBattleActive,
    /** 派生技从**快照**读（`ViewAdapter` 已经算好，带 `derivedFrom`）。 */
    derivedSkill: () => {
      const l = d.battle();
      return l === undefined ? undefined : derivedOfSnapshot(l.snapshot);
    },
    /**
     * **这一局真的有哪些技能** —— 取引擎注册表里的 id 集合。
     *
     * ⚠️ 与 `battleSetup.bindingsForPlayer` 是**同一条判据的两个消费者**
     * （那边过滤技能栏，这边过滤双弧按钮）：凯丽没有「防」也没有「避」，
     * 不过滤的话她的弧上会多出两个按不出东西的按钮。
     *
     * ⚠️ 取**引擎**的技能集而不是另抄一份角色表：引擎收到的那张表就是
     * 这一局的真相（`battleSetup` 按角色从注册表取），两边不可能漂。
     *
     * ⚠️ 没有战斗时返回 `undefined`（= 不过滤）：非战斗阶段触屏按钮整层
     * 隐藏（`isBattleActive`），而且那时也没有"这一局"可言。
     */
    currentSkillIds: () => {
      const l = d.battle();
      return l === undefined ? undefined : new Set(l.engineState.skillIds);
    },
    /**
     * **没上技能栏**的按钮的槽位 —— 名字 / 代价 / 冷却。
     *
     * ⚠️ 走 `BattleLoop.slotViewOf`（= `ViewAdapter` 造技能栏槽位的**同一段
     * 代码**）：拿不到技能定义时返回 `undefined`，那一格就保持空白。
     */
    staticSlot: (skillId, index) => d.battle()?.slotViewOf(skillId, index),
  });

  /** 回填能力值（见 `TouchCapsSource` 的说明）。 */
  d.capsSource.showKeyHints = touch.caps.showKeyHints;

  touch.setButtons(d.touchSkillIds());
  d.scene.setShowKeyHints(touch.caps.showKeyHints);
  d.settingsButton.setShowShortcut(touch.caps.showKeyHints);
  d.app.stage.addChild(touch.layer.root);

  return touch;
}
