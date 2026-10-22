/**
 * **空视图**：没有战斗数据时给渲染层的一份合法快照。
 *
 * ==================================================================
 * 为什么单独一个文件
 * ==================================================================
 *
 * 这两个函数只依赖 `viewModel` 的类型与常量，既不需要引擎也不需要
 * Pixi —— 它们与"从引擎算视图"（`viewAdapter`）是**两件事**。抽出来之后
 * `viewAdapter.ts` 少一块，而"迷路时给什么"这条规则也集中在一处。
 *
 * 谁会用：备战界面（还没有战斗）、`?prepare=skip` 启动的第一帧、
 * 以及"找不到某个单位"的兜底分支。
 */

import type { BattleSnapshotView, CombatantView } from './viewModel';
import { IDLE_FEEDBACK } from './feedback';

/** 一个"什么都没有"的单位视图（血 0 / cap 1，避免 UI 除零）。 */
export function emptyCombatant(id: string): CombatantView {
  return {
    stunned: false,
    feedback: IDLE_FEEDBACK,
    id,
    nameKey: 'hud.level',
    side: 'ally',
    alive: true,
    hp: { current: 0, cap: 1 },
    energy: { current: 0, cap: 1 },
    douqi: { current: 0, cap: 1 },
    buffs: [],
  };
}

/** 一份"还没有开打"的整屏快照。 */
export function emptyView(tick: number): BattleSnapshotView {
  return {
    tick,
    status: 'idle',
    enraged: false,
    player: emptyCombatant('player'),
    boss: { ...emptyCombatant('meiichiro'), side: 'enemy' },
    skills: [],
    floatingText: [],
    playerFlash: 0,
    bossFlash: 0,
    spellSeq: 0,
  };
}
