import { describe, expect, it } from 'vitest';
import {
  PREPARE_LAYOUT,
  cycleSelection,
  moveFocus,
  pickOption,
  prepareHitAreas,
  type PrepareOption,
  type PrepareSelection,
} from '../../src/ui/prepareLogic';
import {
  BOSS_ROSTER,
  DEFAULT_BOSS_ID,
  DEFAULT_PLAYER_ID,
  PLAYER_ROSTER,
  findEntry,
  resolveBossId,
  resolvePlayerId,
} from '../../src/data/roster';

/**
 * 备战界面的纯逻辑。
 *
 * 需求："先做一个 备战界面，选人物 和 选boss，然后点开始才开始，
 * 目前只有这个boss，和目前这个人物，这个人物目前就叫 林晚风。
 * 记得支持键盘和 移动"
 *
 * ⚠️ 这些用例之所以能写，是因为选择状态与命中几何**被抽出了 Pixi 类**
 * （`prepareLogic.ts`）。留在类里就只能写"能构造、不报错"的冒烟测试。
 */
const players: readonly PrepareOption[] = [{ id: 'player' }];
const bosses: readonly PrepareOption[] = [{ id: 'meiichiro' }];
const multiPlayers: readonly PrepareOption[] = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];

const sel = (over: Partial<PrepareSelection> = {}): PrepareSelection => ({
  playerId: 'player',
  bossId: 'meiichiro',
  focus: 'player',
  ...over,
});

describe('命中区域：渲染与点击共用同一份几何', () => {
  it('人物 / 对手 / 开始各一块，顺序固定', () => {
    const areas = prepareHitAreas(players, bosses);
    expect(areas.map((a) => a.kind)).toEqual(['player', 'boss', 'start']);
    expect(areas.map((a) => a.id)).toEqual(['player', 'meiichiro', 'start']);
  });

  it('【关键】只有一个选项时卡片**居中**（不贴左）', () => {
    const [card] = prepareHitAreas(players, bosses);
    const centerX = (card?.x ?? 0) + (card?.w ?? 0) / 2;
    expect(centerX).toBeCloseTo(PREPARE_LAYOUT.width / 2, 0);
  });

  it('选项变多时等分且不重叠', () => {
    const areas = prepareHitAreas(multiPlayers, bosses).filter((a) => a.kind === 'player');
    expect(areas).toHaveLength(3);
    for (let i = 1; i < areas.length; i += 1) {
      const prev = areas[i - 1];
      const cur = areas[i];
      if (prev === undefined || cur === undefined) continue;
      expect(cur.x).toBeGreaterThanOrEqual(prev.x + prev.w);
    }
  });

  it('开始键在卡片下方（不重叠）', () => {
    const areas = prepareHitAreas(players, bosses);
    const boss = areas.find((a) => a.kind === 'boss');
    const start = areas.find((a) => a.kind === 'start');
    expect(start?.y).toBeGreaterThan((boss?.y ?? 0) + (boss?.h ?? 0));
  });
});

describe('键盘：同槽位里换选项', () => {
  it('单选时按方向键**不动**（也不环绕）', () => {
    /**
     * ⚠️ 不环绕是有意的：环绕会让"按一下画面没变"，玩家以为按键没生效。
     */
    expect(cycleSelection(sel(), players, bosses, 1)).toEqual(sel());
    expect(cycleSelection(sel(), players, bosses, -1)).toEqual(sel());
  });

  it('多选时左右移动，到两端停住', () => {
    const base = sel({ playerId: 'a' });
    expect(cycleSelection(base, multiPlayers, bosses, 1).playerId).toBe('b');
    expect(cycleSelection(base, multiPlayers, bosses, -1).playerId).toBe('a');
    expect(cycleSelection(sel({ playerId: 'c' }), multiPlayers, bosses, 1).playerId).toBe('c');
  });

  it('焦点在「开始」时左右不动（没有可选项）', () => {
    const s = sel({ focus: 'start' });
    expect(cycleSelection(s, players, bosses, 1)).toEqual(s);
  });

  it('焦点在对手槽位时改的是 boss，不是 player', () => {
    const s = sel({ focus: 'boss', bossId: 'meiichiro' });
    expect(cycleSelection(s, players, bosses, 1).bossId).toBe('meiichiro');
    expect(cycleSelection(s, players, bosses, 1).playerId).toBe('player');
  });

  it('当前 id 不在列表里时从第 0 个重新算（不产生 NaN）', () => {
    const s = sel({ playerId: 'ghost' });
    expect(cycleSelection(s, multiPlayers, bosses, 1).playerId).toBe('b');
  });
});

describe('键盘：上下换槽位', () => {
  it('顺序是 人物 → 对手 → 开始', () => {
    expect(moveFocus(sel({ focus: 'player' }), 1).focus).toBe('boss');
    expect(moveFocus(sel({ focus: 'boss' }), 1).focus).toBe('start');
  });

  it('两端停住（不环绕）', () => {
    expect(moveFocus(sel({ focus: 'player' }), -1).focus).toBe('player');
    expect(moveFocus(sel({ focus: 'start' }), 1).focus).toBe('start');
  });

  it('往回走', () => {
    expect(moveFocus(sel({ focus: 'start' }), -1).focus).toBe('boss');
  });
});

describe('点选', () => {
  it('点到人物 → 选中它并把焦点移过去', () => {
    const next = pickOption(sel({ focus: 'start' }), multiPlayers, bosses, 'player', 'b');
    expect(next.playerId).toBe('b');
    expect(next.focus).toBe('player');
  });

  it('点到对手同理', () => {
    const next = pickOption(sel(), players, bosses, 'boss', 'meiichiro');
    expect(next.bossId).toBe('meiichiro');
    expect(next.focus).toBe('boss');
  });

  it('【关键】点到**不存在**的 id → 原样返回（不写进选择）', () => {
    /**
     * ⚠️ 否则 `current` 会指向一个不存在的单位，起战斗时拿到空配置 ——
     * 而且那种错误在界面上看不出来（卡片高亮正常，进战斗就崩）。
     */
    const s = sel();
    expect(pickOption(s, players, bosses, 'player', 'ghost')).toBe(s);
    expect(pickOption(s, players, bosses, 'boss', 'ghost')).toBe(s);
  });

  it('选同一个 → 返回同一个对象（调用方据此跳过重画）', () => {
    const s = sel();
    expect(pickOption(s, players, bosses, 'player', 'player')).toBe(s);
  });
});

describe('出战 id 的校验（存储里的值可能已失效）', () => {
  /**
   * 存储里的 id 可能来自旧版本（人物被删、改名）。直接信它会让备战界面
   * "选中一个不存在的人"，进而起战斗时拿到空配置 —— 所以进战斗前要校验。
   */
  it('有效 id 原样返回', () => {
    expect(resolvePlayerId('player')).toBe('player');
    expect(resolveBossId('meiichiro')).toBe('meiichiro');
  });

  it('【关键】无效 / 缺失 / null → 回落默认', () => {
    expect(resolvePlayerId('ghost')).toBe(DEFAULT_PLAYER_ID);
    expect(resolveBossId('ghost')).toBe(DEFAULT_BOSS_ID);
    expect(resolvePlayerId(null)).toBe(DEFAULT_PLAYER_ID);
    expect(resolveBossId(undefined)).toBe(DEFAULT_BOSS_ID);
    expect(resolvePlayerId('')).toBe(DEFAULT_PLAYER_ID);
  });

  it('默认值本身必须在名单里（否则回落会落到一个不存在的人）', () => {
    expect(findEntry(PLAYER_ROSTER, DEFAULT_PLAYER_ID)).toBeDefined();
    expect(findEntry(BOSS_ROSTER, DEFAULT_BOSS_ID)).toBeDefined();
  });

  it('需求指定的名字：人物「林晚风」', () => {
    const entry = findEntry(PLAYER_ROSTER, 'player');
    expect(entry?.nameKey).toBe('roster.linWanfeng.name');
  });

  it('⚠️ 名单里**只有** id 与显示名 —— 没有我擅自加的称号/简介', () => {
    /**
     * 需求纠正过："不要擅自加 称号"游侠" 不要擅自加 描述。"
     * 所以条目形状就是这两个字段；多出来就是又编了设定。
     */
    for (const e of [...PLAYER_ROSTER, ...BOSS_ROSTER]) {
      expect(Object.keys(e).sort()).toEqual(['id', 'nameKey']);
    }
  });
});
