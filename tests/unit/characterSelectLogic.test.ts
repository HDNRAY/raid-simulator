import { describe, expect, it } from 'vitest';
import {
  CHARACTER_SELECT_LAYOUT,
  canStartRun,
  characterCursorTarget,
  characterHoverTarget,
  characterSelectHitAreas,
  characterSelection,
  confirmCharacter,
  cycleCharacter,
  pickCharacter,
  tapCharacterIntent,
} from '../../src/ui/characterSelectLogic';
import { NO_SCROLL, prepareHitAreas, type PrepareOption } from '../../src/ui/prepareLogic';
import { PLAYER_ROSTER, isDeveloping } from '../../src/data/roster';

/**
 * 选角色屏的纯逻辑。
 *
 * 需求（用户 2026-10-12）："从**现有的 3 个角色**里选" +
 * "现在只有**林晚风**能玩，另两个在 `DEVELOPING` 里 → 复用备战界面
 * 既有那套「**开发中 → 灰掉**」的做法"。
 *
 * ⚠️ 这一层的核心断言是"**复用备战界面的光标模型**"：`cursor` 与
 * `playerId`（已确定）是两个独立概念，方向键只动前者。
 */
const players: readonly PrepareOption[] = [{ id: 'player' }, { id: 'kaili' }, { id: 'daixuan' }];

describe('命中区域：复用备战界面的几何，但没有「开始」槽位', () => {
  it('只返回人物卡（没有 boss、没有 start）', () => {
    const areas = characterSelectHitAreas(players);
    expect(areas.map((a) => a.kind)).toEqual(['player', 'player', 'player']);
    expect(areas.map((a) => a.id)).toEqual(['player', 'kaili', 'daixuan']);
  });

  it('几何与 `prepareHitAreas(players, [])` 的人物那部分**逐字相同**', () => {
    const select = characterSelectHitAreas(players);
    /**
     * ⚠️ 第五个参数是 `scroll`（这一屏不滚，给 `NO_SCROLL`）、**第六个**才是
     * 布局表 —— 滚动参数插在 `expanded` 与 `L` 之间（见 `prepareHitAreas`）。
     */
    const prepare = prepareHitAreas(
      players,
      [],
      [],
      'player',
      NO_SCROLL,
      CHARACTER_SELECT_LAYOUT,
    ).filter((a) => a.kind === 'player');
    expect(select).toEqual(prepare);
  });

  it('三张卡等分、不重叠、都在屏幕内', () => {
    const areas = characterSelectHitAreas(players);
    for (let i = 1; i < areas.length; i += 1) {
      const prev = areas[i - 1];
      const cur = areas[i];
      if (prev === undefined || cur === undefined) continue;
      expect(cur.x).toBeGreaterThanOrEqual(prev.x + prev.w);
      expect(cur.x + cur.w).toBeLessThanOrEqual(CHARACTER_SELECT_LAYOUT.width);
    }
  });
});

describe('初始状态：光标与已确定的角色重合', () => {
  it('focus 恒为 player（这一屏没有 boss / start 槽位）', () => {
    const sel = characterSelection('player');
    expect(sel.focus).toBe('player');
    expect(sel.playerId).toBe('player');
    expect(sel.cursor.playerId).toBe('player');
  });
});

describe('← → 只移动光标（不改已确定的角色）', () => {
  it('向右移动一格', () => {
    const next = cycleCharacter(characterSelection('player'), players, 1);
    expect(next.cursor.playerId).toBe('kaili');
    /** ⚠️ 核心：选择**没有**跟着动。 */
    expect(next.playerId).toBe('player');
  });

  it('到两端停住（不环绕）', () => {
    const atFirst = characterSelection('player');
    expect(cycleCharacter(atFirst, players, -1)).toEqual(atFirst);
    const atLast = { ...characterSelection('daixuan') };
    expect(cycleCharacter(atLast, players, 1).cursor.playerId).toBe('daixuan');
  });

  it('光标从**自己的位置**继续走（不是从已确定的那一项重新出发）', () => {
    const moved = cycleCharacter(characterSelection('player'), players, 1);
    expect(cycleCharacter(moved, players, 1).cursor.playerId).toBe('daixuan');
  });
});

describe('Enter：确定光标处的角色', () => {
  it('把光标处那一项写进选择', () => {
    const moved = cycleCharacter(characterSelection('player'), players, 1);
    const confirmed = confirmCharacter(moved, players);
    expect(confirmed.playerId).toBe('kaili');
    expect(confirmed.focus).toBe('player');
  });

  it('光标已经在已确定的角色上 → 返回**同一个对象**（调用方据此跳过重画）', () => {
    const sel = characterSelection('player');
    expect(confirmCharacter(sel, players)).toBe(sel);
  });

  it('只确定人物那一项（bossId 不被碰）', () => {
    const sel = characterSelection('player');
    expect(confirmCharacter(sel, players).bossId).toBe('');
  });
});

describe('点击卡片 = 移光标 + 确定（一步到位）', () => {
  it('点到某个角色 → 光标与选择**同时**落到它上面', () => {
    const next = pickCharacter(characterSelection('player'), players, 'daixuan');
    expect(next.playerId).toBe('daixuan');
    expect(next.cursor.playerId).toBe('daixuan');
  });

  it('点到不存在的 id → 原样返回（不写进选择）', () => {
    const sel = characterSelection('player');
    expect(pickCharacter(sel, players, 'ghost')).toBe(sel);
  });

  it('光标查询：返回光标停的那张卡（渲染层用它画光标环）', () => {
    const moved = cycleCharacter(characterSelection('player'), players, 1);
    expect(characterCursorTarget(moved, players)).toEqual({ kind: 'player', id: 'kaili' });
  });

  it('空名单 → 没有光标目标（不返回一个指向空卡片的 id）', () => {
    expect(characterCursorTarget(characterSelection('player'), [])).toBeUndefined();
  });
});

describe('能不能开一局：开发中的角色**不能**', () => {
  const notDeveloping = () => false;

  it('名单说可以 → 可以开始', () => {
    expect(canStartRun(characterSelection('player'), notDeveloping)).toBe(true);
  });

  it('名单说开发中 → 不能开始', () => {
    /**
     * ⚠️ 用**真正的开发中**角色（黛玄）测这条规则。
     * 2026-10-12 之前这里是 `kaili`，但她已经有自己的 5 招了，
     * 不再是开发中（见 `data/roster.ts`）—— 断言会因此失败，
     * 而那正是这条测试该被更新的信号。
     */
    expect(canStartRun(characterSelection('daixuan'), isDeveloping)).toBe(false);
  });

  it('真实名单：林晚风与凯丽都能开一局（2026-10-12 凯丽出师）', () => {
    const playable = PLAYER_ROSTER.filter((entry) => !isDeveloping(entry.id)).map((e) => e.id);
    expect(playable).toEqual(['player', 'kaili']);
    /** 黛玄仍然在名单里，但灰着。 */
    expect(isDeveloping('daixuan')).toBe(true);
  });

  it('判定看的是**已确定的角色**，不是光标', () => {
    /** 光标移到凯丽上、但没按 Enter → 已确定的还是林晚风 → 仍然可以开始。 */
    const moved = cycleCharacter(characterSelection('player'), players, 1);
    expect(moved.cursor.playerId).toBe('kaili');
    expect(canStartRun(moved, isDeveloping)).toBe(true);
  });
});

/* ------------------------------------------------------------------ *
 * 2026-10-15：右侧详情（hover 命中）与"点卡片"的两步规则
 * ------------------------------------------------------------------ */

describe('hover 命中：与"点中哪张卡"**同一份矩形**', () => {
  const areas = characterSelectHitAreas(players);
  const inside = (i: number): { readonly px: number; readonly py: number } => {
    const a = areas[i]!;
    return { px: a.x + a.w / 2, py: a.y + a.h / 2 };
  };

  it('划过某张卡 → 就是那一项（详情区据此切）', () => {
    for (let i = 0; i < players.length; i += 1) {
      const { px, py } = inside(i);
      expect(characterHoverTarget(players, px, py), `第 ${i} 张`).toEqual({
        kind: 'player',
        id: players[i]!.id,
      });
    }
  });

  it('划过卡片之间的空隙 / 画布外 → `undefined`（详情区清悬停）', () => {
    const first = areas[0]!;
    expect(characterHoverTarget(players, first.x - 4, first.y + first.h / 2)).toBeUndefined();
    expect(characterHoverTarget(players, -10, -10)).toBeUndefined();
    expect(characterHoverTarget(players, 9999, 9999)).toBeUndefined();
  });
});

describe('⚠️ 点卡片的规则：**先选中、再点同一张才开局**', () => {
  it('点的不是已确定的那个 → 只选中（触屏才有机会看详情）', () => {
    const sel = characterSelection('player');
    expect(tapCharacterIntent(sel, 'kaili')).toBe('select');
  });

  it('点的就是已确定的那个 → 开局（默认那个角色仍然**一步**开局）', () => {
    const sel = characterSelection('player');
    expect(tapCharacterIntent(sel, 'player')).toBe('start');
  });

  it('判据看的是**已确定的**（`selection.playerId`），不是光标', () => {
    /**
     * ⚠️ 光标被人用 ← → 挪到凯丽、而选择仍是林晚风时：点凯丽 = **只选中**
     * （光标与选择此时才重合），再点一次才开局 —— 与"点已确定的那个"
     * 完全一致。
     */
    const moved = cycleCharacter(characterSelection('player'), players, 1);
    expect(moved.cursor.playerId).toBe('kaili');
    expect(moved.playerId).toBe('player');
    expect(tapCharacterIntent(moved, 'kaili')).toBe('select');
    expect(tapCharacterIntent(moved, 'player')).toBe('start');
  });
});
