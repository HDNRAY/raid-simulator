import { describe, expect, it } from 'vitest';
import { Container, Graphics } from 'pixi.js';
import { PlayerActorPart } from '../../src/render/parts/playerActor';
import type { FrameContext } from '../../src/render/sceneTypes';
import { EMPTY_COMBATANT, type BattleSnapshotView } from '../../src/render/viewModel';

/**
 * 构造一个只够 `PlayerActorPart` 用的小快照。
 *
 * ⚠️ 用**有名字的构造器**而不是 `as unknown as`（AGENTS.md §1）。
 */
function contextWith(playerBuffs: BattleSnapshotView['player']['buffs']): FrameContext {
  const view: BattleSnapshotView = {
    tick: 0,
    status: 'running',
    enraged: false,
    player: { ...EMPTY_COMBATANT, side: 'ally', buffs: playerBuffs },
    boss: { ...EMPTY_COMBATANT, side: 'enemy' },
    skills: [],
    floatingText: [],
    playerFlash: 0,
    bossFlash: 0,
  };
  return {
    view,
    logEntries: [],
    translate: (key) => key,
    uiScale: 1,
    showKeyHints: true,
  };
}

describe('玩家角色部件：首帧必须画出来', () => {
  /**
   * 需求（用户报告）："你现在的版本，玩家的人物都看不到了"
   *
   * **根因**（实测）：`lastPose` 初值是 `1`，而首帧 `pose` 也是 `1` ——
   * `pose !== lastPose` 为假，于是 `drawPlayer` **一次都没执行**，
   * `playerAnim` 的绘制指令数为 0、`getBounds()` 全零。
   *
   * 本质是拆分帧部件时把原构造函数里的 `this.drawPlayer(1)` 漏掉了，
   * 而"初值 = 默认姿态"这个巧合把漏掉的初始化**静默掩盖**了。
   *
   * 这条断言就是防它复发：**构造完渲染一次，必须有几何体**。
   */
  it('【关键】第一次 render 之后 playerAnim 有非零几何体', () => {
    const root = new Container();
    const anim = new Graphics();
    root.addChild(anim);
    const part = new PlayerActorPart(root, anim);

    const bounds = anim.getBounds();
    expect(bounds.width).toBe(0); // 构造完还没画 —— 这就是那个坑的入口
    part.render(contextWith([]));

    const after = anim.getBounds();
    expect(after.width).toBeGreaterThan(0);
    expect(after.height).toBeGreaterThan(0);
    /**
     * ⚠️ 不能只断言 `width > 0`：那太弱了。这个 bug 的特征是
     * **整个图形一条绘制指令都没有**，所以再钉一条"指令数 > 0"。
     */
    const ctx = anim.context;
    expect(ctx.instructions.length).toBeGreaterThan(0);
  });

  it('姿态变了才重画（保留原来的缓存意图）', () => {
    const root = new Container();
    const anim = new Graphics();
    root.addChild(anim);
    const part = new PlayerActorPart(root, anim);
    part.render(contextWith([]));
    const first = anim.context.instructions.length;
    expect(first).toBeGreaterThan(0);

    /**
     * 第二帧姿态没变 → 不该重画（指令数不变）。
     * `drawPlayer` 每次先 `clear()` 再画，所以重画会让指令数变化。
     */
    part.render(contextWith([]));
    expect(anim.context.instructions.length).toBe(first);
  });

  it('防御姿态会重画（下沉）', () => {
    const root = new Container();
    const anim = new Graphics();
    root.addChild(anim);
    const part = new PlayerActorPart(root, anim);
    part.render(contextWith([]));
    const standing = anim.getBounds().height;

    part.render(
      contextWith([
        {
          id: 'guard-reduce',
          nameKey: 'buff.guard',
          icon: 'i',
          polarity: 'buff',
          color: 0,
          remainingMs: 500,
          durationMs: 1000,
          stacks: 1,
          shortLabelKey: 'buff.guard',
          isDefensive: true,
        },
      ]),
    );
    expect(anim.getBounds().height).toBeLessThan(standing);
  });
});
