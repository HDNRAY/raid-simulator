/**
 * **整屏界面怎么建**（首页 / 选角色屏 / 自由模式）。
 *
 * ==================================================================
 * 为什么单独一个文件
 * ==================================================================
 *
 * `app/game.ts` 在加了"操作方式"的写入点之后到了 **721 行**（AGENTS.md §3
 * 的上限是 700）。按 §3 的顺序**不许压注释**：要么拆 util、要么横向切割 ——
 * 这一撮正是"这一局有哪几个整屏界面、各自接到哪个回调上"，与"什么时候切
 * 相位 / 什么时候开战"没有交集。注释**整段搬过来**，不留摘要。
 *
 * ⚠️ 本文件**不持有状态**：它只把建好的三个部件交给调用方（调用方负责
 * `state.home = home` 之类的回填与 `app.stage.addChild`）。
 *
 * ==================================================================
 * ⚠️ 边角控件（齿轮 / 返回箭头）归**各屏自己**（2026-10-12 重构）
 * ==================================================================
 *
 * 用户原话三条，其实是同一件事：
 *
 *   1. "**stage 上理论上不挂任何小组件**"
 *   2. "**多个页面的齿轮，应该分别定义**"
 *   3. "**UI 缩放要带上**"
 *
 * 所以每个界面构造时都造一个自己的 `ScreenChrome` 并挂进**它自己的
 * root**：首页只有齿轮（它就是返回的目标本身）、选角色屏与自由模式是
 * "齿轮 + 返回箭头"、战斗那一屏在 `BattleScene` 里。
 *
 * ⚠️ 于是"这一屏有没有返回"由**这里**决定，判据是
 * `CONTROL_VISIBILITY.back`（`phaseLogic.ts` 的纯函数，有单测）——
 * 不是各屏自己写一遍 `phase === '...'`。两者同源：那张表说"返回成不成立"，
 * 这里就照它决定传不传 `onBack`。
 */

import { Container, Graphics, Sprite, Text, type Application } from 'pixi.js';
import { CharacterSelectScreen } from '../ui/CharacterSelectScreen';
import { HomeScreen } from '../ui/HomeScreen';
import { PrepareScreen } from '../ui/PrepareScreen';
import { translateSafe } from './translate';
import { CONTROL_VISIBILITY } from './phaseLogic';
import { BOSS_ROSTER, PLAYER_ROSTER } from '../data/roster';
import type { SettingsToggle } from './settingsToggle';

export interface ScreenSetupDeps {
  readonly app: Application;
  /** 要不要显示键名提示（唯一 flag 的派生 —— 触屏方式不显示）。 */
  readonly showKeyHints: () => boolean;
  /** 齿轮上那个键位提示（`F1`）的显示名。 */
  readonly f1Label: () => string;
  /**
   * 设置开关（点齿轮 = 开 / 关设置面板）。
   *
   * ⚠️ 传**取值函数**而不是对象：开关由 `settingsSetup` 在三个界面**之后**
   * 才造出来（装配顺序），而箭头体只在玩家点齿轮时才执行 —— 与
   * `game.ts` 里 `BattleScene.createChrome` 同一个处理方式。
   */
  readonly settingsToggle: () => SettingsToggle;
  /** 首页选了"自由模式 / 肉鸽模式" → 切到哪个界面。 */
  readonly switchTo: (target: 'home' | 'characterSelect' | 'prepare') => void;
  /** 选角色屏点了某个角色（肉鸽开局）。 */
  readonly startRun: (playerId: string) => void;
  /** 自由模式点了"开始"（进战斗）。 */
  readonly onPrepareStart: (playerId: string, bossId: string) => void;
  /** 自由模式改了选择（记住它）。 */
  readonly rememberPick: (playerId: string, bossId: string) => void;
  /** 左上角返回箭头（与键盘 `Esc` 走**同一个**闭包）。 */
  readonly backToHome: () => void;
  /** 备战界面进屏时的初始选择。 */
  readonly initial: { readonly playerId: string; readonly bossId: string };
}

export interface Screens {
  readonly home: HomeScreen;
  readonly select: CharacterSelectScreen;
  readonly prepare: PrepareScreen;
}

export function buildScreens(d: ScreenSetupDeps): Screens {
  const pixi = { Container, Graphics, Sprite, Text };

  /**
   * 三个整屏界面的齿轮都接到**同一个开关**上。
   *
   * ⚠️ 三屏不会同时存在（`applyPhase` 是显隐的唯一写入点），所以"谁被点到"
   * 没有歧义 —— 这正是"分别定义"之后**不需要**再按界面挪位置的原因。
   */
  const onGear = (): void => d.settingsToggle().toggle();

  /**
   * 首页（默认入口）。
   *
   * 需求："有一个**新的首页**，首页可以选进入肉鸽模式，或者自由" +
   * "默认入口：首页"。
   *
   * ⚠️ 首页只是**路由**：它不通向半成品，所以现在就能当默认入口。
   * ⚠️ 首页**没有返回箭头**（它就是返回的目标本身，见 `phaseLogic.
   * backVisibleIn`），所以这里不传 `onBack`。
   */
  const home = new HomeScreen({
    pixi,
    translate: translateSafe,
    showKeyHints: d.showKeyHints,
    f1Label: d.f1Label,
    onGear,
    onPick: (action) => {
      /**
       * 「自由模式」= 原来的备战界面（标题已改成「自由模式」）；
       * 「肉鸽模式」= 先选角色（设计稿 §3.1：**进入肉鸽才是选角色**）。
       */
      if (action === 'free') d.switchTo('prepare');
      else d.switchTo('characterSelect');
    },
  });
  d.app.stage.addChild(home.root);

  /**
   * **这一屏要不要返回箭头** —— 判据只有一处（`phaseLogic` 的那张表，
   * 有单测）。它是"返回成不成立"，也就是"箭头该不该出现"。
   *
   * ⚠️ 需求（用户 2026-10-12）："肯定要加返回啊" + "把设置的快捷键改成
   * 别的 比如 f1"（`Esc` 腾出来做返回）。**触屏对等**（AGENTS.md §3b）：
   * `Esc` 只有键盘按得出，所以左上角必须有一个**可见、可点**的箭头。
   *
   * ⚠️ 不写成 `...(cond ? { onBack } : {})` 那种条件展开：三个 phase 的
   * 表是**编译期常量**，直接按表算出来的布尔传 `undefined` 更直白，也少
   * 一层"到底传没传"的猜测。`ScreenChromeOptions.onBack` 是可选的，
   * 传 `undefined` 就等于"这一屏没有返回"。
   */
  const backIn = (phase: 'characterSelect' | 'prepare'): (() => void) | undefined =>
    CONTROL_VISIBILITY.back(phase) ? d.backToHome : undefined;

  /* ---------- 选角色屏（肉鸽模式的第一屏） ---------- */
  const select = new CharacterSelectScreen({
    pixi,
    translate: translateSafe,
    players: PLAYER_ROSTER,
    initialPlayerId: d.initial.playerId,
    showKeyHints: d.showKeyHints,
    f1Label: d.f1Label,
    onGear,
    onBack: backIn('characterSelect'),
    onStart: (playerId: string) => d.startRun(playerId),
  });
  d.app.stage.addChild(select.root);

  /* ---------- 备战界面（自由模式） ---------- */
  const prepare = new PrepareScreen({
    pixi,
    translate: translateSafe,
    players: PLAYER_ROSTER,
    bosses: BOSS_ROSTER,
    initial: { playerId: d.initial.playerId, bossId: d.initial.bossId },
    showKeyHints: d.showKeyHints,
    f1Label: d.f1Label,
    onGear,
    onBack: backIn('prepare'),
    onStart: (playerId: string, bossId: string) => d.onPrepareStart(playerId, bossId),
    onChange: (playerId: string, bossId: string) => d.rememberPick(playerId, bossId),
  });
  d.app.stage.addChild(prepare.root);

  return { home, select, prepare };
}
