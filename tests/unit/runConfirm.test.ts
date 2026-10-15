import { describe, expect, it } from 'vitest';
import { ALL_QIJI } from '../../src/data/qiji';
import { BOSS_POOL } from '../../src/data/roster';
import { createRunSession } from '../../src/app/runSession';
import {
  RUN_BATTLE_ENTRY,
  RUN_BATTLE_ENTRY_AFTER_QIJI,
  phaseAfterAdvance,
  type ShiftTarget,
} from '../../src/app/phaseLogic';
import {
  RUN_CONFIRM_LAYOUT,
  isOnRunConfirmColumn,
  isOnRunConfirmStart,
  runConfirmColumnLabelY,
  runConfirmColumnRect,
  runConfirmColumnW,
  runConfirmStartCenterX,
  runConfirmStartRect,
} from '../../src/ui/runConfirmLayout';
import { LOGICAL } from '../../src/ui/layout';
import { runConfirmTargets, detailModelOf, type DetailContext } from '../../src/ui/prepareDetail';

/**
 * ==================================================================
 * 肉鸽：**每场战斗前的确认屏**（2026-10-15）
 * ==================================================================
 *
 * 设计稿：`docs/specs/2026-10-15-roguelike-confirm-screen.md`。
 *
 * 这一份钉两件事，都是**截图定不了**的：
 *
 *   1. **"每场战斗之前都经过确认屏"** —— 走**真的 `RunSession`**（真洗牌 /
 *      真推进 / 真候选），把整局的相位序列走出来，断言"确认屏的次数 =
 *      打的场数"。只拍一张图分不清"第 2 场之前漏了确认屏"与"那张图是
 *      第 1 场的"。
 *   2. **两栏几何不重叠、不出界** —— 两栏各写一个宽度时，"有点歪"在图上
 *      看不出来，而"按钮压在右栏上"是明显的坏（却只在某些字号下出现）。
 *
 * ⚠️ 这里**不测** `RunConfirmScreen` 的 Pixi 绘制（那要真 canvas），
 * 与其余整屏界面同一条纪律：几何 / 流程走单测，画面走截图。
 */

/* ------------------------------------------------------------------ *
 * ① 流程：每场战斗之前都经过确认屏（真 RunSession）
 * ------------------------------------------------------------------ */

/** 走一整局，返回"走进过哪些整屏界面"（不含 `battle` —— 它由 `runConfirm` 开）。 */
function walkRun(runLength: number, outcome: 'victory' | 'defeat'): {
  readonly visited: readonly ShiftTarget[];
  readonly battles: number;
} {
  const session = createRunSession({
    bossPool: BOSS_POOL.map((b) => b.id),
    qijiPool: ALL_QIJI,
    runLength,
  });
  session.begin('player', 7);

  const visited: ShiftTarget[] = [];
  /** 开局那一条路：`startRoguelikeRun` 走的就是这个目标。 */
  let phase: ShiftTarget = RUN_BATTLE_ENTRY;
  let battles = 0;

  /** 上限只是防死循环（正常 ≤ 2×场数）；越界即红。 */
  for (let guard = 0; guard < runLength * 3 + 3 && phase !== 'runOver'; guard += 1) {
    visited.push(phase);
    if (phase === 'runConfirm') {
      /**
       * ⚠️ 「开始战斗」这一刻，账本里**必须**有这一场的对手 —— 它是
       * `confirmRunBattle` 唯一的输入。对手为空 = 会开一场不存在的战斗。
       */
      expect(session.bossId(), `第 ${battles + 1} 场之前账本里没有对手`).toBeDefined();
      battles += 1;
      phase = phaseAfterAdvance(session.advance(outcome, [], true));
      continue;
    }
    expect(phase, '肉鸽流程里只该经过确认屏与选炁机屏').toBe('qijiSelect');
    const candidate = session.candidates()[0];
    expect(candidate, '选炁机屏必须有候选（两条 always 兜底）').toBeDefined();
    if (candidate === undefined) return { visited, battles };
    expect(session.chooseQiji(candidate.qiji.id)).toBe(true);
    phase = RUN_BATTLE_ENTRY_AFTER_QIJI;
  }
  visited.push(phase);
  return { visited, battles };
}

describe('肉鸽流程：每场战斗之前都经过确认屏（真 RunSession）', () => {
  it('两场的一局：确认屏 → 选炁机 → 确认屏 → 一局结束', () => {
    const { visited, battles } = walkRun(2, 'victory');
    expect(visited).toEqual(['runConfirm', 'qijiSelect', 'runConfirm', 'runOver']);
    expect(battles).toBe(2);
    /**
     * ⚠️ 这条是**核心断言**：确认屏出现的次数 = 真的打的场数。
     * 少一次 = 某一条进战斗的路绕过了确认屏（正是这次要防的回归）。
     */
    expect(visited.filter((p) => p === 'runConfirm')).toHaveLength(battles);
  });

  it('只打一场的一局：开局也要先确认（确认屏 1 次、没有选炁机）', () => {
    const { visited, battles } = walkRun(1, 'victory');
    expect(visited).toEqual(['runConfirm', 'runOver']);
    expect(battles).toBe(1);
    expect(visited.filter((p) => p === 'runConfirm')).toHaveLength(battles);
  });

  it('第一场就输：确认过再打（不是"没确认就结束"）', () => {
    const { visited, battles } = walkRun(2, 'defeat');
    expect(visited).toEqual(['runConfirm', 'runOver']);
    expect(battles).toBe(1);
  });

  it('`?runlen` 生效时有几场就有几次确认（场数由账本决定）', () => {
    for (const len of [1, 2, 3]) {
      const { visited, battles } = walkRun(len, 'victory');
      expect(battles, `runLength=${len}`).toBe(len);
      expect(visited.filter((p) => p === 'runConfirm'), `runLength=${len}`).toHaveLength(len);
    }
  });

  it('纯判定：`battle` 那一支**也**走确认屏（否则"下一场"会直连战斗）', () => {
    expect(phaseAfterAdvance({ kind: 'battle' })).toBe('runConfirm');
    expect(phaseAfterAdvance({ kind: 'selectQiji' })).toBe('qijiSelect');
    expect(phaseAfterAdvance({ kind: 'runOver' })).toBe('runOver');
    expect(RUN_BATTLE_ENTRY_AFTER_QIJI).toBe('runConfirm');
  });
});

describe('⚠️ "进战斗"在 `phaseFlow` 里只有一个调用点（结构上跳不过确认屏）', () => {
  it('`enterBattle(` 在 `phaseFlow.ts` 里只被**调用**一次，且它在 `confirmRunBattle` 里', async () => {
    const { readFileSync } = await import('node:fs');
    const lines = readFileSync('src/app/phaseFlow.ts', 'utf8')
      /** 剥注释：文件头与说明里**提到**过 `enterBattle`，那不是调用。 */
      .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
      .replace(/\/\/[^\n]*/g, (m) => m.replace(/[^\n]/g, ' '))
      .split('\n');

    /**
     * ⚠️ 只算**调用语句**：`createPhaseFlow` 的返回类型里有一行
     * `enterBattle(playerId: string, bossId: string): void;`（那是签名，
     * 不是调用），用"行尾是不是 `: void;`"把它排掉。
     *
     * 这条断言的意义：肉鸽里"进战斗"的三条路（开局 / 一场打完 / 选完炁机）
     * 都只切到确认屏，**唯一的开战点是玩家按的那个按钮**
     * （`confirmRunBattle`）—— 所以"跳过确认"在结构上不存在，
     * 而不是靠三条路各自记得不跳过。
     */
    const calls = lines
      .map((line, index) => ({ line, index }))
      .filter(({ line }) => /enterBattle\(/.test(line) && !/:\s*void;?\s*$/.test(line));

    expect(calls.map((c) => c.line.trim())).toEqual(['enterBattle(run.playerId, bossId);']);
    /** 它所在的那个函数就是 `confirmRunBattle`（往上找最近的一个 `const X = (`）。 */
    const enclosing = lines
      .slice(0, calls[0]?.index ?? 0)
      .reverse()
      .find((line) => /^\s{2}const \w+ = /.test(line));
    expect(enclosing).toContain('confirmRunBattle');
  });
});

/* ------------------------------------------------------------------ *
 * ② 两栏各显示谁（纯判定；"没有已选炁机"那一支截图看不出来）
 * ------------------------------------------------------------------ */

describe('确认屏两栏的目标（纯判定）', () => {
  it('左栏恒是玩家；有已选炁机 → 右栏是它', () => {
    expect(runConfirmTargets({ playerId: 'player', qijiId: 'vitality' })).toEqual({
      player: { kind: 'player', id: 'player' },
      qiji: { kind: 'qiji', id: 'vitality' },
    });
  });

  it('⚠️ 第一场之前（没有已选炁机）→ 右栏 `undefined`（画占位那句）', () => {
    /**
     * ⚠️ 这一支的两种结果在画面上**都是"右栏有字"**（「本局尚未选择炁机」
     * 与面板的标题）—— 写反了截图看不出来，所以在这里钉住。
     */
    expect(runConfirmTargets({ playerId: 'player' }).qiji).toBeUndefined();
  });

  it('接上真实的 `detailModelOf` → 右栏拿到的就是那条炁机的详情（"已激活"）', () => {
    /**
     * ⚠️ 用**假的**上下文（`detailModelOf` 的活是 `prepareDetail.test.ts`
     * 的）：这里钉的是"两栏选出来的目标**真的能喂给面板**"，
     * 而不是又测一遍炁机详情的内容。
     */
    const ctx: DetailContext = {
      playerById: (id) => ({ id, nameKey: 'roster.player.name' }),
      bossById: (id) => ({ id, nameKey: 'roster.boss.name' }),
      qijiById: (id) => ({ id, nameKey: 'qiji.name', descKey: 'qiji.desc' }),
      playerHp: () => 150,
      bossHp: () => 420,
      playerSkills: () => [],
      bossSkills: () => [],
      bossPassives: () => [],
      developing: () => false,
      /** ⚠️ 确认屏只把"本局已选的那条"当激活（见屏幕的 `on` 闭包）。 */
      qijiOn: (id) => id === 'vitality',
    };
    const targets = runConfirmTargets({ playerId: 'player', qijiId: 'vitality' });
    const qiji = detailModelOf(targets.qiji, ctx);
    expect(qiji?.kind).toBe('qiji');
    expect(qiji?.subtitle).toEqual({ kind: 'text', key: 'roster.ui.detail.qijiOn' });
    const player = detailModelOf(targets.player, ctx);
    expect(player?.kind).toBe('player');
    expect(player?.portraitId).toBe('player');
  });
});

/* ------------------------------------------------------------------ *
 * ③ 几何：两栏不重叠、不出界，按钮在下面那一排
 * ------------------------------------------------------------------ */

describe('确认屏几何（纯函数）', () => {
  const left = runConfirmColumnRect('left');
  const right = runConfirmColumnRect('right');
  const start = runConfirmStartRect();

  it('两栏同宽、等高，且都落在画布内', () => {
    expect(left.w).toBe(right.w);
    expect(left.w).toBe(runConfirmColumnW());
    expect(left.h).toBe(right.h);
    for (const rect of [left, right]) {
      expect(rect.x).toBeGreaterThanOrEqual(0);
      expect(rect.x + rect.w).toBeLessThanOrEqual(LOGICAL.width);
      expect(rect.y).toBeGreaterThanOrEqual(0);
      expect(rect.y + rect.h).toBeLessThanOrEqual(LOGICAL.height);
    }
  });

  it('两栏左右排列、**不重叠**（中间正好是 `gap`）', () => {
    expect(right.x).toBe(left.x + left.w + RUN_CONFIRM_LAYOUT.gap);
    expect(right.x).toBeGreaterThan(left.x + left.w);
    /** 两栏加起来 + 两侧留白 + 中间空隙 = 整张画布（没有第三个数在漂）。 */
    expect(left.w * 2 + RUN_CONFIRM_LAYOUT.gap + RUN_CONFIRM_LAYOUT.side * 2).toBe(LOGICAL.width);
  });

  it('栏目标题在面板**上面**那一条（不与面板内容重叠）', () => {
    expect(runConfirmColumnLabelY()).toBeLessThan(left.y);
    expect(runConfirmColumnLabelY()).toBeGreaterThan(RUN_CONFIRM_LAYOUT.progressY);
  });

  it('「开始战斗」在两栏**下面**、画布内、水平居中于整张画布', () => {
    expect(start.y).toBeGreaterThanOrEqual(left.y + left.h);
    expect(start.y + start.h).toBeLessThanOrEqual(LOGICAL.height);
    expect(runConfirmStartCenterX()).toBe(LOGICAL.width / 2);
    /** 提示行在按钮之下、仍在画布内。 */
    expect(RUN_CONFIRM_LAYOUT.hintY).toBeGreaterThan(start.y + start.h);
    expect(RUN_CONFIRM_LAYOUT.hintY).toBeLessThan(LOGICAL.height);
  });

  it('命中测试与矩形**同源**（中心命中 / 四角外不命中）', () => {
    expect(isOnRunConfirmStart(start.x + start.w / 2, start.y + start.h / 2)).toBe(true);
    expect(isOnRunConfirmStart(start.x - 2, start.y + start.h / 2)).toBe(false);
    expect(isOnRunConfirmStart(start.x + start.w / 2, start.y - 2)).toBe(false);
    /** 点两栏上不会开战（它是只读展示）。 */
    expect(isOnRunConfirmStart(left.x + left.w / 2, left.y + 10)).toBe(false);
  });

  it('两栏的命中判据**各归各**（拖拽滚动的分派基础）', () => {
    /** 左栏中心 → 只命中左栏。 */
    const lx = left.x + left.w / 2;
    const ly = left.y + left.h / 2;
    expect(isOnRunConfirmColumn('left', lx, ly)).toBe(true);
    expect(isOnRunConfirmColumn('right', lx, ly)).toBe(false);
    /** 右栏中心 → 反之。 */
    const rx = right.x + right.w / 2;
    expect(isOnRunConfirmColumn('right', rx, ly)).toBe(true);
    expect(isOnRunConfirmColumn('left', rx, ly)).toBe(false);
    /** 两栏之间的空隙 / 按钮那一排都不属于任何一栏。 */
    expect(isOnRunConfirmColumn('left', left.x + left.w + 1, ly)).toBe(false);
    expect(isOnRunConfirmColumn('right', right.x - 1, ly)).toBe(false);
    expect(isOnRunConfirmColumn('left', lx, start.y + start.h / 2)).toBe(false);
  });
});
