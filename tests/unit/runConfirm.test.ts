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
  isOnRunConfirmBlock,
  runConfirmBlockHitRect,
  runConfirmBlockLabelY,
  runConfirmBlockRect,
  runConfirmBlockTops,
  type RunConfirmBlock,
} from '../../src/ui/runConfirmLayout';
import {
  detailModelOf,
  runConfirmDetailTarget,
  whisperDetailModel,
  type DetailContext,
  type DetailWhisper,
} from '../../src/ui/prepareDetail';
import {
  focusRunConfirmBlock,
  moveRunConfirmFocus,
  runConfirmSelection,
} from '../../src/ui/runConfirmFocus';
import { foldRect, footerHintSlot, startRect } from '../../src/ui/prepareGeometry';
import { PREPARE_LAYOUT } from '../../src/ui/prepareLayout';
import { LOGICAL } from '../../src/ui/layout';

/**
 * ==================================================================
 * 肉鸽：**每场战斗前的确认屏**（2026-10-15）
 * ==================================================================
 *
 * 设计稿：`docs/specs/2026-10-15-roguelike-confirm-screen.md`（内容口径当天
 * 改过一次：玩家详情挪到选角色屏、右边改成**一块共用详情**、Tab 在
 * 炁机 / 对手 / 开始战斗间切 —— 见 `ui/RunConfirmScreen` 文件头）。
 *
 * 这一份钉的都是**截图定不了**的事：
 *
 *   1. **"每场战斗之前都经过确认屏"** —— 走**真的 `RunSession`**（真洗牌 /
 *      真推进 / 真候选），把整局的相位序列走出来
 *   2. **两行块头的纵向链**：没有已选炁机时那一行**整块不画**、对手**顶上来**
 *      （"少一行"与"画了一行空的"在图上完全不同）
 *   3. **焦点状态机**：炁机 → 对手 → 开始战斗（环绕）、空槽位自动跳过、
 *      焦点走到开始键上时右侧仍显示上一块
 *
 * ⚠️ 这里**不测** `RunConfirmScreen` 的 Pixi 绘制（那要真 canvas，jsdom 里
 * Pixi 的文字量不出高度）—— 与其余整屏界面同一条纪律：几何 / 状态走单测，
 * 画面走截图。
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
       * 确认屏右侧那一行与 `confirmRunBattle` 唯一的输入。
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
 * ② 两行各是什么、焦点怎么走（纯判定）
 * ------------------------------------------------------------------ */

/** 假详情上下文（真实的那个要读内容表 + i18n）。 */
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
  qijiOn: (id) => id === 'vitality',
};

const BOSS = { id: 'pride', nameKey: 'boss.pride.name' } as const;
const QIJI = { id: 'vitality', nameKey: 'qiji.vitality.name' } as const;
/** 这一层的「恶魔低语」（2026-10-16）。 */
const WHISPER: DetailWhisper = {
  id: 'blunt',
  nameKey: 'whisper.blunt.name',
  descKey: 'whisper.blunt.desc',
};
/** 第二条炁机（一局可能选不止一条 —— 块头照实写「已激活 2 条」）。 */
const QIJI2 = { id: 'jieShengJi', nameKey: 'qiji.jieShengJi.name' } as const;

describe('确认屏：初始焦点与"右侧显示谁"（纯判定）', () => {
  it('有已选炁机 → 焦点落在炁机（刚选的那条，最该被确认）', () => {
    const sel = runConfirmSelection({ boss: BOSS, qiji: [QIJI] });
    expect(sel.focus).toBe('qiji');
    expect(sel.expanded).toBe('qiji');
  });

  it('⚠️ 第一场之前（没有已选炁机）→ 焦点必须在**对手**上，不能停在空块上', () => {
    const sel = runConfirmSelection({ boss: BOSS, qiji: [] });
    expect(sel.focus).toBe('boss');
    expect(sel.expanded).toBe('boss');
    expect(
      runConfirmDetailTarget({ expanded: sel.expanded, boss: BOSS, qiji: [], whisper: WHISPER }),
    ).toEqual({ kind: 'boss', id: 'pride' });
  });

  it('⚠️ 焦点走到「开始战斗」上时，右侧仍显示**上一块**（面板不忽隐忽现）', () => {
    /**
     * `expanded` 由 `prepareLogic.withFocus` 保住（"focus === 'start' 时
     * expanded 保持"）—— 这里钉的是"详情读的是 `expanded`、不是 `focus`"。
     */
    const sel = runConfirmSelection({ boss: BOSS, qiji: [QIJI] });
    const step = (from: typeof sel, delta: number): typeof sel =>
      moveRunConfirmFocus({ selection: from, delta, hasQiji: true });
    const atBoss = step(sel, 1);
    expect(atBoss.focus).toBe('boss');
    const atWhisper = step(atBoss, 1);
    expect(atWhisper.focus).toBe('whisper');
    const atStart = step(atWhisper, 1);
    expect(atStart.focus).toBe('start');
    expect(atStart.expanded).toBe('whisper');
    expect(
      runConfirmDetailTarget({
        expanded: atStart.expanded,
        boss: BOSS,
        qiji: [QIJI],
        whisper: WHISPER,
      }),
    ).toEqual({ kind: 'whisper', id: 'blunt' });
  });

  it('⚠️ 一局选了不止一条时：右侧画**最后一条**（刚选的那条）', () => {
    /**
     * 块头照实写「已激活 2 条：…」（`prepareFold` 那条判据），而面板一次
     * 只画得出**一条** —— 画刚选的那条（整局清单在一局结束屏）。
     */
    const sel = runConfirmSelection({ boss: BOSS, qiji: [QIJI, QIJI2] });
    expect(
      runConfirmDetailTarget({
        expanded: sel.expanded,
        boss: BOSS,
        qiji: [QIJI, QIJI2],
        whisper: WHISPER,
      }),
    ).toEqual({ kind: 'qiji', id: 'jieShengJi' });
  });

  it('⚠️ `expanded` 指向一个**不存在**的块时退回对手（兜底，不画空白面板）', () => {
    expect(
      runConfirmDetailTarget({ expanded: 'qiji', boss: BOSS, qiji: [], whisper: WHISPER }),
    ).toEqual({ kind: 'boss', id: 'pride' });
  });

  it('接上真实的 `detailModelOf`：两行的详情都取得到（炁机"已激活" / Boss 招式）', () => {
    const withQiji = runConfirmSelection({ boss: BOSS, qiji: [QIJI] });
    /**
     * ⚠️ `detailModelOf` 只认人物 / 炁机 / Boss（它按 `DetailContext` 查内容
     * 表），低语走 `whisperDetailModel` —— 与 `RunConfirmScreen` 里那个
     * 分支**同一条**（这里照着写一遍，是为了让"两类各走哪条路"在测试里可见）。
     */
    const modelOf = (
      target: ReturnType<typeof runConfirmDetailTarget>,
    ): ReturnType<typeof detailModelOf> =>
      target.kind === 'whisper' ? undefined : detailModelOf(target, ctx);

    const qijiModel = modelOf(
      runConfirmDetailTarget({
        expanded: withQiji.expanded,
        boss: BOSS,
        qiji: [QIJI],
        whisper: WHISPER,
      }),
    );
    expect(qijiModel?.kind).toBe('qiji');
    expect(qijiModel?.subtitle).toEqual({ kind: 'text', key: 'roster.ui.detail.qijiOn' });

    const bossModel = modelOf(
      runConfirmDetailTarget({ expanded: 'boss', boss: BOSS, qiji: [QIJI], whisper: WHISPER }),
    );
    expect(bossModel?.kind).toBe('boss');
    expect(bossModel?.subtitle).toEqual({
      kind: 'text',
      key: 'roster.ui.detail.hpMax',
      params: { hp: 420 },
    });
  });
});

describe('确认屏焦点顺序：炁机 → 对手 → 开始战斗（环绕；空槽位跳过）', () => {
  /** 走一步焦点（`runConfirmFocus` —— 决策算法与备战屏共用 `stepFocus`）。 */
  const step = (
    from: ReturnType<typeof runConfirmSelection>,
    delta: number,
    hasQiji: boolean,
  ): string => moveRunConfirmFocus({ selection: from, delta, hasQiji }).focus;

  /** 走 n 步（状态逐步传递 —— 走位是**有状态**的，别拿焦点字符串当状态）。 */
  const walk = (
    from: ReturnType<typeof runConfirmSelection>,
    deltas: readonly number[],
    hasQiji: boolean,
  ): ReturnType<typeof runConfirmSelection> =>
    deltas.reduce((sel, delta) => moveRunConfirmFocus({ selection: sel, delta, hasQiji }), from);

  it('有已选炁机时是**四站**：炁机 → 对手 → 恶魔低语 → 开始（环绕）', () => {
    const atQiji = runConfirmSelection({ boss: BOSS, qiji: [QIJI] });
    expect(walk(atQiji, [1], true).focus).toBe('boss');
    expect(walk(atQiji, [1, 1], true).focus).toBe('whisper');
    expect(walk(atQiji, [1, 1, 1], true).focus).toBe('start');
    /** 环绕：再往前一步回到炁机。 */
    expect(walk(atQiji, [1, 1, 1, 1], true).focus).toBe('qiji');
    /** 反向同理（从炁机往回 = 开始战斗）。 */
    expect(step(atQiji, -1, true)).toBe('start');
  });

  it('⚠️ 没有已选炁机时**跳过炁机那一站**（三站）', () => {
    const atBoss = runConfirmSelection({ boss: BOSS, qiji: [] });
    expect(walk(atBoss, [1], false).focus).toBe('whisper');
    expect(walk(atBoss, [1, 1], false).focus).toBe('start');
    /** 环绕：从「开始战斗」往前走回到对手（**不经过空着的炁机**）。 */
    expect(walk(atBoss, [1, 1, 1], false).focus).toBe('boss');
    expect(step(atBoss, -1, false)).toBe('start');
  });

  it('点某一行 = 把焦点放上去（点空着的炁机那一行 = 什么都不做）', () => {
    const atBoss = runConfirmSelection({ boss: BOSS, qiji: [] });
    expect(focusRunConfirmBlock({ selection: atBoss, block: 'whisper', hasQiji: false }).focus).toBe(
      'whisper',
    );
    expect(focusRunConfirmBlock({ selection: atBoss, block: 'qiji', hasQiji: false })).toBe(atBoss);
  });

  it('「恶魔低语」的详情：抽到的那条画它的说明；第 1 层画「本层纯净」', () => {
    const drawn = whisperDetailModel(WHISPER, {
      nameKey: 'screen.runConfirm.whisperNone',
      descKey: 'screen.runConfirm.whisperNoneDesc',
    });
    expect(drawn.kind).toBe('whisper');
    expect(drawn.titleKey).toBe(WHISPER.nameKey);
    expect(drawn.rows).toEqual([{ kind: 'text', key: WHISPER.descKey }]);
    /** ⚠️ 顶栏那一行三类都要有值（低语写的是栏目标题）。 */
    expect(drawn.subtitle).toEqual({ kind: 'text', key: 'screen.runConfirm.whisperBlock' });

    const none = whisperDetailModel(undefined, {
      nameKey: 'screen.runConfirm.whisperNone',
      descKey: 'screen.runConfirm.whisperNoneDesc',
    });
    expect(none.titleKey).toBe('screen.runConfirm.whisperNone');
    expect(none.rows).toEqual([{ kind: 'text', key: 'screen.runConfirm.whisperNoneDesc' }]);
  });
});

/* ------------------------------------------------------------------ *
 * ③ 几何：两行块头 + 复用备战屏那一套（"老规矩"）
 * ------------------------------------------------------------------ */

describe('确认屏几何（纯函数）', () => {
  const withQiji = runConfirmBlockTops(true);
  const withoutQiji = runConfirmBlockTops(false);
  const qijiRect = runConfirmBlockRect('qiji', true);
  const bossRect = runConfirmBlockRect('boss', true);
  const bossOnlyRect = runConfirmBlockRect('boss', false);

  it('⚠️ 没有已选炁机时：炁机那一行**整块不在**，对手**顶上来**', () => {
    expect(withoutQiji.qiji).toBeUndefined();
    expect(runConfirmBlockRect('qiji', false)).toBeUndefined();
    expect(runConfirmBlockHitRect('qiji', false)).toBeUndefined();
    /** 对手落在**第一行**的位置（不是留在第二行、上面空一块）。 */
    expect(bossOnlyRect?.y).toBe(withQiji.qiji);
    expect(bossOnlyRect?.y).toBeLessThan(bossRect?.y ?? 0);
  });

  it('两行块头都在画布内、不重叠，顺序是炁机在上对手在下', () => {
    expect(qijiRect).toBeDefined();
    expect(bossRect).toBeDefined();
    if (qijiRect === undefined || bossRect === undefined) return;
    expect(bossRect.y).toBeGreaterThanOrEqual(qijiRect.y + qijiRect.h);
    expect(bossRect.y + bossRect.h).toBeLessThan(LOGICAL.height);
    /** 两块同宽同高（就是备战屏那条块头：`foldRect`）。 */
    expect(qijiRect.w).toBe(bossRect.w);
    expect(qijiRect.h).toBe(bossRect.h);
    expect(qijiRect.h).toBe(PREPARE_LAYOUT.foldH);
  });

  it('块头几何**就是**备战屏那一份（`foldRect` —— 不是抄一份坐标）', () => {
    expect(qijiRect).toEqual(foldRect(runConfirmBlockTops(true).qiji ?? 0));
    expect(bossRect).toEqual(foldRect(runConfirmBlockTops(true).boss));
  });

  it('栏目标题在块头**上面**那一条，且不与上一块重叠', () => {
    const tops = runConfirmBlockTops(true);
    expect(runConfirmBlockLabelY(tops.boss)).toBeLessThan(tops.boss);
    expect(runConfirmBlockLabelY(tops.boss)).toBeGreaterThan((tops.qiji ?? 0) + PREPARE_LAYOUT.foldH);
    /** ⚠️ 第一行的标题要落在进度行（`progressY`）之下。 */
    expect(runConfirmBlockLabelY(tops.qiji ?? 0)).toBeGreaterThan(RUN_CONFIRM_LAYOUT.progressY);
  });

  it('命中区比画出来的那一条**大一圈**（含标题带，触屏才点得中）', () => {
    const hit = runConfirmBlockHitRect('boss', true);
    expect(hit).toBeDefined();
    if (hit === undefined || bossRect === undefined) return;
    expect(hit.y).toBeLessThan(bossRect.y);
    expect(hit.h).toBeGreaterThan(bossRect.h);
  });

  it('命中判据与矩形**同源**（块内命中 / 块外不命中）', () => {
    if (qijiRect === undefined) throw new Error('炁机那一行本该在');
    const cx = qijiRect.x + qijiRect.w / 2;
    const cy = qijiRect.y + qijiRect.h / 2;
    expect(isOnRunConfirmBlock('qiji', true, cx, cy)).toBe(true);
    expect(isOnRunConfirmBlock('boss', true, cx, cy)).toBe(false);
    /** 没有炁机那一行时，同一个点不再命中它。 */
    expect(isOnRunConfirmBlock('qiji', false, cx, cy)).toBe(false);
    /** 块与块之间的空隙不属于任何一块。 */
    expect(isOnRunConfirmBlock('qiji', true, cx, bossRect?.y ?? 0)).toBe(false);
  });

  it('「开始战斗」+ 提示那一排**复用备战屏的几何**（锚定底部、同一处）', () => {
    const start = startRect();
    const hint = footerHintSlot();
    expect(start.y).toBeGreaterThan(bossRect?.y ?? 0);
    expect(start.y + start.h).toBeLessThan(LOGICAL.height);
    expect(hint.x).toBe(start.x + start.w + PREPARE_LAYOUT.footerRowGap);
    expect(hint.y).toBe(start.y);
    /** 它不与右侧详情区（x624 起）重叠。 */
    expect(start.x + start.w).toBeLessThan(624);
    /** ⚠️ 也不与两行块头重叠：那一排在第三块块头下面。 */
    expect(start.y).toBeGreaterThan((bossRect?.y ?? 0) + PREPARE_LAYOUT.foldH);
  });

  it('标题 / 进度 / 第一行标题 自上而下', () => {
    expect(RUN_CONFIRM_LAYOUT.titleY).toBeLessThan(RUN_CONFIRM_LAYOUT.progressY);
    expect(RUN_CONFIRM_LAYOUT.progressY).toBeLessThan(RUN_CONFIRM_LAYOUT.firstLabelY);
    expect(RUN_CONFIRM_LAYOUT.firstLabelY).toBeLessThan(withQiji.qiji ?? 0);
  });
});

/** 编译期对照面：`RunConfirmBlock` 只有这两块（加第三块会在这里报错）。 */
const BLOCKS: readonly RunConfirmBlock[] = ['qiji', 'boss'];
describe('块清单', () => {
  it('就是炁机与对手两块', () => {
    expect(BLOCKS).toEqual(['qiji', 'boss']);
  });
});
