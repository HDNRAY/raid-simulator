/**
 * **整屏界面怎么建**（首页 / 选角色屏 / 自由模式 / 返回箭头）。
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
 * ⚠️ 本文件**不持有状态**：它只把建好的四个部件交给调用方（调用方负责
 * `state.home = home` 之类的回填与 `app.stage.addChild`）。
 */

import { Container, Graphics, Sprite, Text, type Application } from 'pixi.js';
import { CharacterSelectScreen } from '../ui/CharacterSelectScreen';
import { HomeScreen } from '../ui/HomeScreen';
import { PrepareScreen } from '../ui/PrepareScreen';
import { ScreenControls } from '../ui/ScreenControls';
import { translateSafe } from './translate';
import { BOSS_ROSTER, PLAYER_ROSTER } from '../data/roster';

export interface ScreenSetupDeps {
  readonly app: Application;
  /** 要不要显示键名提示（唯一 flag 的派生 —— 触屏方式不显示）。 */
  readonly showKeyHints: () => boolean;
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
  readonly back: ScreenControls;
}

export function buildScreens(d: ScreenSetupDeps): Screens {
  const pixi = { Container, Graphics, Sprite, Text };

  /**
   * 首页（默认入口）。
   *
   * 需求："有一个**新的首页**，首页可以选进入肉鸽模式，或者自由" +
   * "默认入口：首页"。
   *
   * ⚠️ 首页只是**路由**：它不通向半成品，所以现在就能当默认入口。
   */
  const home = new HomeScreen({
    pixi,
    translate: translateSafe,
    showKeyHints: d.showKeyHints,
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

  /* ---------- 选角色屏（肉鸽模式的第一屏） ---------- */
  const select = new CharacterSelectScreen({
    pixi,
    translate: translateSafe,
    players: PLAYER_ROSTER,
    initialPlayerId: d.initial.playerId,
    showKeyHints: d.showKeyHints,
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
    onStart: (playerId: string, bossId: string) => d.onPrepareStart(playerId, bossId),
    onChange: (playerId: string, bossId: string) => d.rememberPick(playerId, bossId),
  });
  d.app.stage.addChild(prepare.root);

  /* ---------- 返回箭头（整屏界面共用） ---------- */
  /**
   * 需求（用户 2026-10-12）："肯定要加返回啊" + "把设置的快捷键改成别的
   * 比如 f1"（`Esc` 腾出来做返回）。
   *
   * ⚠️ **触屏对等**（AGENTS.md §3b）：`Esc` 只有键盘按得出，所以这一屏
   * 左上角必须有一个**可见、可点**的箭头 —— 它就是本组件。
   *
   * ⚠️ 它挂在 stage 上（与设置齿轮同一层），**不画进任何一个屏**：
   * 两个界面共用一份实现，否则"选角色屏的箭头能点、自由模式的不行"
   * 只是时间问题。
   *
   * ⚠️ 显隐的唯一写入点仍是 `game.ts` 的 `applyPhase`
   * （`CONTROL_VISIBILITY.back`）；本对象自己**不**决定何时可见。
   */
  const back = new ScreenControls({
    pixi,
    showKeyHints: d.showKeyHints,
    onBack: () => d.backToHome(),
  });
  d.app.stage.addChild(back.root);

  return { home, select, prepare, back };
}
