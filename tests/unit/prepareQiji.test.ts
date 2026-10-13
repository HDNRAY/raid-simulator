import { describe, expect, it } from 'vitest';
import {
  freeQijiChoices,
  hitTestPrepare,
  isQijiOn,
  moveFocus,
  toggleQiji,
  type PrepareSelection,
} from '../../src/ui/prepareLogic';
import { prepareHitAreas } from '../../src/ui/prepareGeometry';
import { buildPlayerKit } from '../../src/data/kit';
import { ALL_QIJI } from '../../src/data/qiji';
import { playerCapsFor } from '../../src/data/units';
import { PLAYER_ROSTER } from '../../src/data/roster';

/**
 * ==================================================================
 * 自由模式：**激活任意个炁机**（2026-10-13 需求）
 * ==================================================================
 *
 * 用户原话："选了人之后，可以**激活任意个他的炁机**"。
 *
 * ⚠️ **"任意个"落在条数上**（8 条想开几条开几条），而**每一条是开关、
 * 没有层数** —— 用户后来明确纠正："**炁机的激活 没有层，你这个问题本就
 * 不存在**"。上一版把它做成 `id → 层数`（沿用 `maxStacks`）并造出"点卡片
 * 左半减一层 / 右半加一层"，于是 0 层时点左半**什么都不做**，玩家看到的是
 * "点了能选中但不能激活"。
 *
 * ⚠️ 这一份钉的是**语义**，不是界面：
 *   - 一次切换 = 开或关（关着的点一下必开 —— 这正是用户报的那条）
 *   - 多条可以同时开着
 *   - 效果**只生效一次**（每条激活只给**一份定义**，见 `freeQijiChoices`）
 *
 * ⚠️ 肉鸽那边**没有层数**（2026-10-13：用户"肉鸽也改成一局只能选一次
 * （不叠加）"）—— 它的 `maxStacks` 字段**已整条删除**。所以"层数"这件事
 * 今天**两个模式都不存在**；本文件与肉鸽唯一的共同点是最终都进
 * `buildPlayerKit`（那里的入参就是定义数组，恒为 1 的那个 `stacks`
 * 也已删除，见 `data/kit.ts` 的作废段）。
 */

const players = [{ id: 'player' }, { id: 'kaili' }];
const bosses = [{ id: 'meiichiro' }];
const qiji = [{ id: 'vitality' }, { id: 'breath' }, { id: 'jieShengJi' }];

const sel = (over: Partial<PrepareSelection> = {}): PrepareSelection => ({
  playerId: 'player',
  bossId: 'meiichiro',
  focus: 'qiji',
  /** 手风琴：焦点在炁机行 → 炁机那一块展开（见 `prepareLogic.withFocus`）。 */
  expanded: 'qiji',
  cursor: { playerId: 'player', bossId: 'meiichiro', qijiId: 'vitality' },
  ...over,
});

describe('炁机激活：**开关**（没有层数）', () => {
  it('关着的点一下 → 开；开着的点一下 → 关', () => {
    const on = toggleQiji([], 'vitality');
    expect(isQijiOn(on, 'vitality')).toBe(true);
    const off = toggleQiji(on, 'vitality');
    expect(isQijiOn(off, 'vitality')).toBe(false);
  });

  it('【关键】**0 层/关着**时点它 → 开（不再是"什么也不做"）', () => {
    /** 用户报的那一条：任何状态点下去都必须有结果。 */
    const closed: readonly string[] = [];
    const first = toggleQiji(closed, 'breath');
    expect(first).toEqual(['breath']);
    /** ⚠️ 连点两次回到"没开"，而不是"归零 / 叠一层"之类。 */
    expect(toggleQiji(first, 'breath')).toEqual([]);
  });

  it('关掉 = **删掉那个 id**（不留 `false` 这种第二份"没开"的表达）', () => {
    const on = toggleQiji(toggleQiji([], 'vitality'), 'breath');
    expect(on).toEqual(['vitality', 'breath']);
    expect(toggleQiji(on, 'vitality')).toEqual(['breath']);
  });

  it('【关键】多条可以同时开着（"任意个"的落点）', () => {
    let free: readonly string[] = [];
    free = toggleQiji(free, 'vitality');
    free = toggleQiji(free, 'breath');
    free = toggleQiji(free, 'jieShengJi');
    expect(free).toEqual(['vitality', 'breath', 'jieShengJi']);
  });

  it('⚠️ 切换只有开 / 关，**没有层数**（连点 4 次 = 开 关 开 关）', () => {
    /**
     * 这一条防的是"激活退化成 `id → 层数`"那个旧形状（它当年造出过
     * "点卡片左半减一层、0 层时什么都不做"的 bug）。
     */
    let free: readonly string[] = [];
    const states: boolean[] = [];
    for (let i = 0; i < 4; i += 1) {
      free = toggleQiji(free, 'vitality');
      states.push(isQijiOn(free, 'vitality'));
    }
    expect(states).toEqual([true, false, true, false]);
  });
});

describe('激活集合 → 这一局选中的炁机 id（自由模式唯一的翻译点）', () => {
  it('按**内容表顺序**排，只留开着的', () => {
    const choices = freeQijiChoices(['breath', 'vitality'], qiji);
    expect(choices).toEqual([{ qijiId: 'vitality' }, { qijiId: 'breath' }]);
  });

  it('【关键】顺序**不按集合的顺序**（黄金截图 / 断言要能复现同一份修正列表）', () => {
    const a = freeQijiChoices(['vitality', 'breath'], qiji);
    const b = freeQijiChoices(['breath', 'vitality'], qiji);
    expect(a).toEqual(b);
  });

  it('【关键】效果**只生效一次**（每条激活只产出一个 id，不会变成叠 3 次）', () => {
    const choices = freeQijiChoices(['vitality'], qiji);
    expect(choices).toEqual([{ qijiId: 'vitality' }]);
    /** 一次激活 → 一条修正。叠层是**内容表**的历史语义，自由模式取不到。 */
    expect(choices).toHaveLength(1);
  });

  it('不认识的 id 被丢掉（内容改名之后的陈旧存档）', () => {
    expect(freeQijiChoices(['ghost', 'vitality'], qiji)).toEqual([{ qijiId: 'vitality' }]);
  });
});

/**
 * ⚠️ **真 `buildPlayerKit`**：把"效果只生效一次"从"翻译只产出一个 id"
 * 落到**数字**上（用户要的验收口径就是数：maxHp / 炁回复）。
 */
describe('【关键】效果**只生效一次**（真 `buildPlayerKit`）', () => {
  const PLAYER = PLAYER_ROSTER[0]!.id;
  const baseHp = playerCapsFor(PLAYER).hp;
  /**
   * ⚠️ 复刻 `app/phaseFlow.activeQiji()` 那一步翻译（它把 `qijiId` 展开成
   * 定义）—— 这里不 import app 层（那要造整个游戏），但**同一个 `buildPlayerKit`**。
   */
  const kitOf = (ids: readonly string[]) =>
    buildPlayerKit(
      PLAYER,
      freeQijiChoices(ids, ALL_QIJI).map((choice) => {
        const def = ALL_QIJI.find((q) => q.id === choice.qijiId);
        if (def === undefined) throw new Error(`测试里不该有找不到的炁机：${choice.qijiId}`);
        return def;
      }),
    );

  it('开一条「固本培元」→ 生命上限 **+30**（就一次）', () => {
    expect(kitOf([]).caps.hp).toBe(baseHp);
    expect(kitOf(['vitality']).caps.hp).toBe(baseHp + 30);
  });

  it('开 / 关 / 开同一条 → **不叠加**（还是 +30，不是 +60 / +90）', () => {
    let free: readonly string[] = [];
    free = toggleQiji(free, 'vitality');
    free = toggleQiji(free, 'vitality');
    free = toggleQiji(free, 'vitality');
    expect(free).toEqual(['vitality']);
    expect(kitOf(free).caps.hp).toBe(baseHp + 30);
  });

  it('开两条不同的炁机 → **两个效果都在**（生命 +30 且炁回复 +10/秒）', () => {
    const kit = kitOf(['vitality', 'breath']);
    expect(kit.caps.hp).toBe(baseHp + 30);
    const regen = kit.modifiers.filter((m) => m.stat === 'energyRegen');
    expect(regen).toHaveLength(1);
    expect(regen[0]?.value).toBe(10);
  });
});

describe('焦点顺序：人物 → 炁机 → 对手 → 开始', () => {
  const opts = { players, bosses, qiji };

  it('往下走是 人物 → 炁机 → 对手 → 开始', () => {
    expect(moveFocus(sel({ focus: 'player' }), 1, opts).focus).toBe('qiji');
    expect(moveFocus(sel({ focus: 'qiji' }), 1, opts).focus).toBe('boss');
    expect(moveFocus(sel({ focus: 'boss' }), 1, opts).focus).toBe('start');
  });

  it('往回走是 开始 → 对手 → 炁机 → 人物', () => {
    expect(moveFocus(sel({ focus: 'start' }), -1, opts).focus).toBe('boss');
    expect(moveFocus(sel({ focus: 'boss' }), -1, opts).focus).toBe('qiji');
    expect(moveFocus(sel({ focus: 'qiji' }), -1, opts).focus).toBe('player');
  });

  it('【关键】没有炁机时那一格被**跳过**（否则光标会落进一个空行）', () => {
    const none = { players, bosses, qiji: [] };
    expect(moveFocus(sel({ focus: 'player' }), 1, none).focus).toBe('boss');
  });
});

describe('点击命中：炁机卡**整张**都能被点中（触屏靠它）', () => {
  it('点在炁机卡正中间 → 命中那一条', () => {
    /**
     * ⚠️ 坐标从 **`prepareHitAreas`** 取（与渲染共用同一份几何）——
     * 自己按 `qijiRowY` 再算一遍就会在"行顶是推导出来的"这件事上错位。
     */
    const area = prepareHitAreas(players, bosses, qiji, 'qiji').find(
      (a) => a.kind === 'qiji' && a.id === 'breath',
    );
    expect(area).toBeDefined();
    const hit = hitTestPrepare(
      area!.x + area!.w / 2,
      area!.y + area!.h / 2,
      players,
      bosses,
      qiji,
      'qiji',
    );
    expect(hit).toEqual({ kind: 'qiji', id: 'breath' });
  });

  it('点在空白处 → 什么都不命中', () => {
    expect(hitTestPrepare(2, 2, players, bosses, qiji, 'qiji')).toBeUndefined();
  });
});
