import { describe, expect, it } from 'vitest';
import {
  canStartBattle,
  confirmCursor,
  cursorFromSelection,
  cursorTarget,
  cycleCursor,
  moveFocus,
  pickOption,
  prepareHitAreas,
  type PrepareOption,
  type PrepareSelection,
} from '../../src/ui/prepareLogic';
import { PREPARE_LAYOUT } from '../../src/ui/prepareLayout';
import {
  BOSS_ROSTER,
  DEFAULT_BOSS_ID,
  DEFAULT_PLAYER_ID,
  PLAYER_ROSTER,
  findEntry,
  isDeveloping,
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

/**
 * 造一个状态。`cursor` **默认跟随已确定的选择**（进界面时两者重合，
 * 见 `cursorFromSelection`）—— 要测"两者分离"就显式传 `cursor`。
 */
const sel = (over: Partial<PrepareSelection> = {}): PrepareSelection => {
  const base: PrepareSelection = {
    playerId: 'player',
    bossId: 'meiichiro',
    focus: 'player',
    cursor: { playerId: 'player', bossId: 'meiichiro', qijiId: '' },
    ...over,
  };
  return over.cursor === undefined ? { ...base, cursor: cursorFromSelection(base) } : base;
};

describe('命中区域：渲染与点击共用同一份几何', () => {
  it('人物 / 对手 / 开始各一块，顺序固定', () => {
    const areas = prepareHitAreas(players, bosses);
    expect(areas.map((a) => a.kind)).toEqual(['player', 'boss', 'start']);
    expect(areas.map((a) => a.id)).toEqual(['player', 'meiichiro', 'start']);
  });

  it('【关键】只有一个选项时卡片**居中**（不贴左）', () => {
    const [card] = prepareHitAreas(players, bosses);
    const centerX = (card?.x ?? 0) + (card?.w ?? 0) / 2;
    /**
     * ⚠️ 判据从"画布中心"改成"**卡片列**中心"：右边切走了详情区，
     * 按整张画布居中会让卡片在左列里看起来偏右。
     */
    expect(centerX).toBeCloseTo(PREPARE_LAYOUT.pad + PREPARE_LAYOUT.playerColW / 2, 0);
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

describe('键盘：同槽位里移动光标（⚠️ 不改选择）', () => {
  it('单选时按方向键**不动**（也不环绕）', () => {
    /**
     * ⚠️ 不环绕是有意的：环绕会让"按一下画面没变"，玩家以为按键没生效。
     */
    expect(cycleCursor(sel(), players, bosses, 1)).toEqual(sel());
    expect(cycleCursor(sel(), players, bosses, -1)).toEqual(sel());
  });

  it('多选时左右移动光标，到两端停住', () => {
    const base = sel({ playerId: 'a' });
    expect(cycleCursor(base, multiPlayers, bosses, 1).cursor.playerId).toBe('b');
    expect(cycleCursor(base, multiPlayers, bosses, -1).cursor.playerId).toBe('a');
    expect(cycleCursor(sel({ playerId: 'c' }), multiPlayers, bosses, 1).cursor.playerId).toBe('c');
  });

  it('焦点在「开始」时左右不动（没有可选项）', () => {
    const s = sel({ focus: 'start' });
    expect(cycleCursor(s, players, bosses, 1)).toEqual(s);
  });

  it('焦点在对手槽位时动的是 boss 的光标，不是 player 的', () => {
    const s = sel({ focus: 'boss', bossId: 'meiichiro' });
    expect(cycleCursor(s, players, bosses, 1).cursor.bossId).toBe('meiichiro');
    expect(cycleCursor(s, players, bosses, 1).cursor.playerId).toBe('player');
  });

  it('当前光标 id 不在列表里时从第 0 个重新算（不产生 NaN）', () => {
    const s = sel({ playerId: 'ghost', cursor: { playerId: 'ghost', bossId: 'meiichiro', qijiId: '' } });
    expect(cycleCursor(s, multiPlayers, bosses, 1).cursor.playerId).toBe('b');
  });

  /* ------------------------------------------------------------------ *
   * ⚠️ 本轮的**核心需求**：移动光标 ≠ 确定选择
   * ------------------------------------------------------------------ */

  it('【关键】移动光标**不改选择**（需求："用 enter 来确定选择，而不是靠移动到下一项"）', () => {
    const s = sel({ playerId: 'a' });
    const moved = cycleCursor(s, multiPlayers, bosses, 1);
    // 光标动了
    expect(moved.cursor.playerId).toBe('b');
    // 选择**没动** —— 这才是"会上场的还是 a"
    expect(moved.playerId).toBe('a');
  });

  it('【关键】光标与选择可以**分离**（光标在 b、选的是 a）', () => {
    const s = sel({ playerId: 'a' });
    const moved = cycleCursor(s, multiPlayers, bosses, 1);
    expect(moved.playerId).not.toBe(moved.cursor.playerId);
    expect(moved).toEqual({ ...s, cursor: { ...s.cursor, playerId: 'b' } });
  });

  it('【关键】光标**从自己的位置**继续走，而不是从已选中的那一项重新出发', () => {
    /**
     * 旧实现从"已选中的 id"算下标，于是"光标在 b、选择是 a、再按一下"
     * 会回到 b（看起来像没反应）。这里要求它走到 c。
     */
    const s = sel({ playerId: 'a', cursor: { playerId: 'b', bossId: 'meiichiro', qijiId: '' } });
    expect(cycleCursor(s, multiPlayers, bosses, 1).cursor.playerId).toBe('c');
    expect(cycleCursor(s, multiPlayers, bosses, -1).cursor.playerId).toBe('a');
  });

  it('光标**只在同一个槽位内**动（人物槽位不会碰 boss 的光标）', () => {
    const s = sel({ playerId: 'a', bossId: 'meiichiro' });
    const moved = cycleCursor(s, multiPlayers, bosses, 1);
    expect(moved.cursor.bossId).toBe('meiichiro');
    expect(moved.bossId).toBe('meiichiro');
  });
});

describe('Enter：确定光标处的那一项', () => {
  it('【关键】光标移开之后按 Enter → 选择**变成光标处那一项**', () => {
    const moved = cycleCursor(sel({ playerId: 'a' }), multiPlayers, bosses, 1);
    const confirmed = confirmCursor(moved, multiPlayers, bosses);
    expect(confirmed.playerId).toBe('b');
    // 光标保持不动
    expect(confirmed.cursor.playerId).toBe('b');
  });

  it('光标已经在已选中项上 → 返回**同一个对象**（调用方据此跳过重画/写存储）', () => {
    const s = sel();
    expect(confirmCursor(s, players, bosses)).toBe(s);
  });

  it('对手槽位同理（确定的是 boss）', () => {
    const s = sel({ focus: 'boss', bossId: 'meiichiro' });
    const confirmed = confirmCursor(s, players, bosses);
    expect(confirmed).toBe(s);
  });

  it('焦点在「开始」上 → 没有可确定的项，原样返回', () => {
    const s = sel({ focus: 'start' });
    expect(confirmCursor(s, players, bosses)).toBe(s);
  });

  it('列表里没有光标那个 id 时回落到第 0 项（不写进不存在的 id）', () => {
    const s = sel({ playerId: 'a', cursor: { playerId: 'ghost', bossId: 'meiichiro', qijiId: '' } });
    const confirmed = confirmCursor(s, multiPlayers, bosses);
    expect(confirmed.playerId).toBe('a');
  });

  it('【关键】只确定**光标所在槽位**的那一项，另一个槽位不动', () => {
    const s = sel({ playerId: 'a', bossId: 'meiichiro', focus: 'player' });
    const confirmed = confirmCursor(cycleCursor(s, multiPlayers, bosses, 1), multiPlayers, bosses);
    expect(confirmed.playerId).toBe('b');
    expect(confirmed.bossId).toBe('meiichiro');
  });
});

describe('键盘：上下换槽位', () => {
  /** ⚠️ 传入真实的选项表：空槽位会被跳过，不传就等价于"两边都是空的"。 */
  const opts = { players: multiPlayers, bosses } as const;

  it('顺序是 人物 → 对手 → 开始', () => {
    expect(moveFocus(sel({ focus: 'player' }), 1, opts).focus).toBe('boss');
    expect(moveFocus(sel({ focus: 'boss' }), 1, opts).focus).toBe('start');
  });

  it('两端停住（不环绕）', () => {
    expect(moveFocus(sel({ focus: 'player' }), -1, opts).focus).toBe('player');
    expect(moveFocus(sel({ focus: 'start' }), 1, opts).focus).toBe('start');
  });

  it('往回走', () => {
    expect(moveFocus(sel({ focus: 'start' }), -1, opts).focus).toBe('boss');
  });

  it('【关键】换槽位**不改选择、也不丢光标**（回来时还在原来那一格）', () => {
    const s = sel({ playerId: 'a', cursor: { playerId: 'b', bossId: 'meiichiro', qijiId: '' } });
    const down = moveFocus(s, 1, { players: multiPlayers, bosses });
    expect(down.focus).toBe('boss');
    expect(down.playerId).toBe('a');
    expect(down.cursor.playerId).toBe('b');
    const back = moveFocus(down, -1, { players: multiPlayers, bosses });
    expect(back.focus).toBe('player');
    expect(back.cursor.playerId).toBe('b');
  });

  it('Tab（wrap）在两端**环绕**', () => {
    const wrapOpts = { wrap: true, players: multiPlayers, bosses } as const;
    expect(moveFocus(sel({ focus: 'start' }), 1, wrapOpts).focus).toBe('player');
    expect(moveFocus(sel({ focus: 'player' }), -1, wrapOpts).focus).toBe('start');
  });

  it('空槽位被跳过（否则 Tab 会把光标送进一个没有卡片的槽位）', () => {
    const empty: readonly PrepareOption[] = [];
    const noPlayers = { players: empty, bosses } as const;
    expect(moveFocus(sel({ focus: 'player' }), 1, noPlayers).focus).toBe('boss');
    expect(moveFocus(sel({ focus: 'boss' }), -1, noPlayers).focus).toBe('boss');
    /** 两边都空 → 只剩「开始」，怎么走都到它。 */
    const noBosses = { players: empty, bosses: empty } as const;
    expect(moveFocus(sel({ focus: 'player' }), 1, noBosses).focus).toBe('start');
    expect(moveFocus(sel({ focus: 'start' }), -1, noBosses).focus).toBe('start');
  });
});

describe('点击 = 移光标 + 确定（一步到位）', () => {
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

  it('【关键】点击是"两步合一"：光标与选择**同时**落到那一项', () => {
    /**
     * AGENTS.md §3b：触屏与键盘功能必须对等。键盘按 Enter 能确定，
     * 触屏就必须有一次点击能确定 —— 否则触屏玩家永远只能移动光标。
     */
    const next = pickOption(sel({ playerId: 'a' }), multiPlayers, bosses, 'player', 'c');
    expect(next.playerId).toBe('c');
    expect(next.cursor.playerId).toBe('c');
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

  it('点同一张卡但**光标不在那儿**（理论到不了）→ 也要把光标带过来', () => {
    const s = sel({ playerId: 'a', cursor: { playerId: 'c', bossId: 'meiichiro', qijiId: '' } });
    const next = pickOption(s, multiPlayers, bosses, 'player', 'a');
    expect(next.cursor.playerId).toBe('a');
  });
});

describe('光标位置查询（渲染层用它决定给哪张卡画光标）', () => {
  it('返回槽位 + id', () => {
    const s = sel({ playerId: 'a', cursor: { playerId: 'b', bossId: 'meiichiro', qijiId: '' } });
    expect(cursorTarget(s, multiPlayers, bosses)).toEqual({ kind: 'player', id: 'b' });
  });

  it('焦点在「开始」→ 没有光标目标（开始键不是选项）', () => {
    expect(cursorTarget(sel({ focus: 'start' }), players, bosses)).toBeUndefined();
  });

  it('空列表 → 没有光标目标（不返回一个指向空卡片的 id）', () => {
    expect(cursorTarget(sel({ focus: 'player' }), [], bosses)).toBeUndefined();
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
     *
     * ⚠️ "这个单位做完了没有"**不是**条目字段，它住在 `data/roster.ts`
     * 的 `DEVELOPING`（会随着开发进度变短，那是状态不是身份）——
     * 所以这条断言在加了 6 个新单位之后**仍然成立**。
     */
    for (const e of [...PLAYER_ROSTER, ...BOSS_ROSTER]) {
      expect(Object.keys(e).sort()).toEqual(['id', 'nameKey']);
    }
  });

  it('开发中的单位也**在名单里**（否则备战界面根本列不出来）', () => {
    for (const id of ['kaili', 'daixuan', 'envy', 'gluttony', 'wrath', 'sloth', 'greed']) {
      expect(findEntry(PLAYER_ROSTER, id) ?? findEntry(BOSS_ROSTER, id)).toBeDefined();
    }
  });
});

describe('能不能开战：开发中的单位灰掉且**不能开战**', () => {
  /**
   * 需求："之前没开发的角色和 boss，你可以先把相关文件创建，相关资源导入，
   * 备战界面里灰掉，写开发中" + "不能开始战斗（选中它们时点开始应当无效，
   * 或给明确反馈）"。
   *
   * ⚠️ 规则是**纯函数**（`canStartBattle`），所以这里能精确测 —— 而不是
   * 截图看一眼"开始键好像是灰的"。生产路径传 `roster.isDeveloping`。
   */
  const developing = (id: string): boolean => ['envy', 'kaili'].includes(id);

  it('两个选择都做完 → 可以开战', () => {
    expect(canStartBattle(sel({ focus: 'start' }), developing)).toBe(true);
  });

  it('【关键】Boss 开发中 → 不能开战', () => {
    expect(canStartBattle(sel({ bossId: 'envy', focus: 'start' }), developing)).toBe(false);
  });

  it('【关键】人物开发中 → 不能开战', () => {
    expect(canStartBattle(sel({ playerId: 'kaili', focus: 'start' }), developing)).toBe(false);
  });

  it('焦点在哪一格不影响判定（判定看的是选择，不是焦点）', () => {
    expect(canStartBattle(sel({ playerId: 'kaili', focus: 'player' }), developing)).toBe(false);
  });

  it('【关键】光标移到开发中的单位上、但**没按 Enter** → 仍然可以开战', () => {
    /**
     * 这是"光标 ≠ 选择"的直接后果：光标只是一次查看/路过，
     * 判定必须只看已确定的选择。旧版两者合一，光标一挪就变成"不能开战"，
     * 而玩家根本没打算选它。
     */
    const s = sel({ playerId: 'player', cursor: { playerId: 'kaili', bossId: 'meiichiro', qijiId: '' } });
    expect(canStartBattle(s, developing)).toBe(true);
  });

  it('真实名单：开发中的仍然不能开战（2026-10-12 凯丽出师）', () => {
    const real = (id: string): boolean => isDeveloping(id);
    /** 两个做完的人物、两个做完的 Boss —— 任意组合都能开战。 */
    expect(canStartBattle(sel({ focus: 'start' }), real)).toBe(true);
    expect(canStartBattle(sel({ playerId: 'kaili', focus: 'start' }), real)).toBe(true);
    expect(canStartBattle(sel({ bossId: 'lust', focus: 'start' }), real)).toBe(true);
    for (const bossId of ['envy', 'gluttony', 'wrath', 'sloth', 'greed']) {
      expect(canStartBattle(sel({ bossId, focus: 'start' }), real)).toBe(false);
    }
    /**
     * ⚠️ **只剩黛玄**：她的 5 招里「盾」需要引擎还没有的机制，
     * 所以她还灰着（见 `data/roster.ts` 的 `DEVELOPING`）。
     */
    expect(canStartBattle(sel({ playerId: 'daixuan', focus: 'start' }), real)).toBe(false);
  });
});
