/**
 * **触屏层的装配**（能力探测 + 布局 + 输入源 + 双弧按钮层）。
 *
 * ==================================================================
 * 为什么单独一个文件
 * ==================================================================
 *
 * `createTouchControls`（`app/touchControls.ts`）已经把所有触屏逻辑收在
 * 它自己里面了，这一段剩下的是**接线**：把"当前战斗 / 设置是否打开 /
 * 是否在备战界面 / 当前派生技"这些活的量喂给它，再把它产出的能力值
 * 发给别的部件（技能格的键提示、齿轮按钮的快捷键提示）。
 *
 * 抽出来之后 `createGame()` 里只剩一句 `createTouchSetup(...)`，
 * 而**"谁先谁后"的约束**（面板先于触屏、触屏先于回填预览）集中可见。
 */

import { Container, Graphics, Sprite, Text, type Application } from 'pixi.js';
import { createTouchControls, derivedOfSnapshot, type TouchControls } from './touchControls';
import { translateSafe } from './translate';
import type { BattleLoop } from './battleLoop';
import type { ContentRegistry } from '../core/content/registry';

/**
 * 触屏预览的数据源持有者。
 *
 * ⚠️ 它是**转交点**：设置面板必须先于触屏层构造（面板要按能力值决定
 * 是否显示键位提示），而预览数据又只能从触屏布局读。所以先在
 * `settingsSetup.ts` 里造一个空壳，这里建好触屏层后**回填**它。
 * 用 `const` 对象而不是 `let` 函数 —— 符合 lint，也不依赖"首次渲染
 * 足够晚"这种隐含前提。
 */
export interface TouchPreviewSource {
  read: () => readonly string[];
  showKeyHints: boolean;
}

/** 触屏装配需要的外部依赖。 */
export interface TouchSetupDeps {
  /** Pixi 应用（触屏按钮层挂在它的 stage 上）。 */
  readonly app: Application;
  readonly registry: ContentRegistry;
  /** 当前战斗循环（非战斗阶段为 `undefined`）。 */
  readonly battle: () => BattleLoop | undefined;
  /** 设置面板是否打开（打开时触屏按钮让出输入权）。 */
  readonly isSettingsOpen: () => boolean;
  /** 是否**正在战斗**（非战斗时战斗场景整块隐藏，触屏按钮也要跟着藏）。 */
  readonly isBattleActive: () => boolean;
  /** 当前键位表（触屏按钮由它机械派生）。 */
  readonly bindings: () => readonly { readonly key: string; readonly skillId: string }[];
  /** 触屏的能力值变化要通知的部件。 */
  readonly scene: { setShowKeyHints(show: boolean): void };
  readonly settingsButton: { setShowShortcut(show: boolean): void };
  /** 预览数据源（本函数负责回填）。 */
  readonly previewSource: TouchPreviewSource;
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
    bindings: d.bindings(),
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
  });

  /** 回填预览数据源（见 `TouchPreviewSource` 的说明）。 */
  d.previewSource.read = () =>
    touch.layout
      .current()
      .map((b) => d.registry.skill(b.skillId)?.nameKey ?? b.skillId);
  d.previewSource.showKeyHints = touch.caps.showKeyHints;

  touch.setBindings(d.bindings());
  d.scene.setShowKeyHints(touch.caps.showKeyHints);
  d.settingsButton.setShowShortcut(touch.caps.showKeyHints);
  d.app.stage.addChild(touch.layer.root);

  return touch;
}
