import { describe, expect, it } from 'vitest';
import {
  NO_SCROLL,
  canStartBattle,
  confirmCursor,
  cursorFromSelection,
  cursorTarget,
  cycleCursor,
  expandSection,
  focusTarget,
  hitTestPrepare,
  initialSelection,
  moveFocus,
  pointerIntentOf,
  pickOption,
  pickQiji,
  prepareHitAreas,
  sectionRowStep,
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
    /**
     * ⚠️ 手风琴：**焦点在哪一块，就展开哪一块**（见 `prepareLogic.withFocus`）。
     * 造状态时若显式换了 `focus`，展开块要跟着它 —— 否则造出"焦点在一处、
     * 展开的是另一处"这种正常操作到不了的状态。
     */
    expanded: over.focus === 'qiji' || over.focus === 'boss' ? over.focus : 'player',
    cursor: { playerId: 'player', bossId: 'meiichiro', qijiId: '' },
    ...over,
  };
  return over.cursor === undefined ? { ...base, cursor: cursorFromSelection(base) } : base;
};

describe('命中区域：渲染与点击共用同一份几何', () => {
  it('展开的块给卡片、收起的块给「块头」，顺序固定（人物在前）', () => {
    /**
     * ⚠️ 手风琴：不传 `expanded` 时默认展开**人物**那一块 —— 于是对手那一块
     * 只剩一条「块头」（`kind: 'summary'`，`id` = 槽位名）。点它 = 展开它，
     * 而不是选它（见 `prepareLogic.expandSection`）。
     */
    const areas = prepareHitAreas(players, bosses);
    expect(areas.map((a) => a.kind)).toEqual(['player', 'summary', 'start']);
    expect(areas.map((a) => a.id)).toEqual(['player', 'boss', 'start']);
  });

  it('展开对手那一块时，卡片是它的、人物那一块只剩块头', () => {
    const areas = prepareHitAreas(players, bosses, [], 'boss');
    expect(areas.map((a) => a.kind)).toEqual(['summary', 'boss', 'start']);
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

  it('开始键在三块下方（不重叠）', () => {
    /** ⚠️ 最高的一种展开方式是"对手展开"（两张卡 → 2 行）→ 拿它当上界。 */
    const areas = prepareHitAreas(players, bosses, [], 'boss');
    const blocks = areas.filter((a) => a.kind !== 'start');
    const bottom = Math.max(...blocks.map((a) => a.y + a.h));
    const start = areas.find((a) => a.kind === 'start');
    expect(start?.y).toBeGreaterThan(bottom);
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
    /** 两个做完的人物、三个做完的 Boss —— 任意组合都能开战。 */
    expect(canStartBattle(sel({ focus: 'start' }), real)).toBe(true);
    expect(canStartBattle(sel({ playerId: 'kaili', focus: 'start' }), real)).toBe(true);
    expect(canStartBattle(sel({ bossId: 'lust', focus: 'start' }), real)).toBe(true);
    /** ⚠️ 2026-10-14：「嫉妒」出师（四招 + 偷血/偷炁），所以它也能开战了。 */
    expect(canStartBattle(sel({ bossId: 'envy', focus: 'start' }), real)).toBe(true);
    for (const bossId of ['gluttony', 'wrath', 'sloth', 'greed']) {
      expect(canStartBattle(sel({ bossId, focus: 'start' }), real)).toBe(false);
    }
    /**
     * ⚠️ **只剩黛玄**：她的 5 招里「盾」需要引擎还没有的机制，
     * 所以她还灰着（见 `data/roster.ts` 的 `DEVELOPING`）。
     */
    expect(canStartBattle(sel({ playerId: 'daixuan', focus: 'start' }), real)).toBe(false);
  });
});


/**
 * ==================================================================
 * 手风琴：同一时间只展开一块（用户 2026-10-13 第四条）
 * ==================================================================
 *
 * 用户原话："同一时间只展开暂时 3 个选择中的一个，其他的收起来，
 * 只展示当前选择"。
 *
 * ⚠️ 规则只有一条：**焦点在哪一块，就展开哪一块**；焦点走到「开始战斗」
 * 上时展开块**不动**（否则三块会全收起来，玩家看不见卡片）。这里把这条
 * 规则连同"点块头 = 只展开、不改选择"一起钉住。
 */
describe('手风琴：焦点决定展开哪一块', () => {
  const three = {
    players: [{ id: 'player' }, { id: 'kaili' }],
    bosses: [{ id: 'meiichiro' }],
    qiji: [{ id: 'vitality' }],
  };

  it('进场时人物那一块是展开的', () => {
    expect(initialSelection({ playerId: 'player', bossId: 'meiichiro' }).expanded).toBe('player');
  });

  it('↓ 依次经过 炁机 → 对手，每一步都跟着换展开块', () => {
    let sel = initialSelection({ playerId: 'player', bossId: 'meiichiro' }, three.qiji);
    sel = moveFocus(sel, 1, three);
    expect(sel.focus).toBe('qiji');
    expect(sel.expanded).toBe('qiji');
    sel = moveFocus(sel, 1, three);
    expect(sel.focus).toBe('boss');
    expect(sel.expanded).toBe('boss');
  });

  it('⚠️ 焦点走到「开始战斗」上时，**上一块仍然展开**（不能全收起来）', () => {
    let sel = initialSelection({ playerId: 'player', bossId: 'meiichiro' }, three.qiji);
    sel = moveFocus(sel, 1, three);
    sel = moveFocus(sel, 1, three);
    sel = moveFocus(sel, 1, three);
    expect(sel.focus).toBe('start');
    expect(sel.expanded).toBe('boss');
  });

  it('移到边界停住时展开块也不乱动', () => {
    const sel = initialSelection({ playerId: 'player', bossId: 'meiichiro' }, three.qiji);
    expect(moveFocus(sel, -1, three)).toEqual(sel);
  });

  it('`focusSlot` / 点卡片 / 点炁机卡都会把展开块带过去', () => {
    const start = initialSelection({ playerId: 'player', bossId: 'meiichiro' }, three.qiji);
    expect(focusTarget(start, 'qiji', three).expanded).toBe('qiji');
    expect(pickOption(start, three.players, three.bosses, 'boss', 'meiichiro').expanded).toBe('boss');
    expect(pickQiji(start, three.qiji, 'vitality').expanded).toBe('qiji');
  });

  it('光标在同一块里移动**不改**展开块（← → 不该重排整屏）', () => {
    const sel = { ...initialSelection({ playerId: 'player', bossId: 'meiichiro' }, three.qiji) };
    const moved = cycleCursor(sel, three.players, three.bosses, 1, three.qiji);
    expect(moved.cursor.playerId).toBe('kaili');
    expect(moved.expanded).toBe('player');
  });

  it('⚠️ `expandSection` = **只换焦点**（点收起那块的头，不该改选择）', () => {
    const sel = initialSelection({ playerId: 'player', bossId: 'meiichiro' }, three.qiji);
    const next = expandSection(sel, 'qiji');
    expect(next.expanded).toBe('qiji');
    expect(next.focus).toBe('qiji');
    /** ⚠️ 已确定的人物 / 对手一个都没变。 */
    expect(next.playerId).toBe(sel.playerId);
    expect(next.bossId).toBe(sel.bossId);
  });

  it('【关键】收起的那一块**只有块头**能被点中（卡片点不到）', () => {
    const areas = prepareHitAreas(three.players, three.bosses, three.qiji, 'player');
    const bossSummary = areas.find((a) => a.kind === 'summary' && a.id === 'boss');
    expect(bossSummary).toBeDefined();
    /** 点块头正中间 → 命中「块头」（调用方据此展开，而不是选 Boss）。 */
    const hit = hitTestPrepare(
      bossSummary!.x + bossSummary!.w / 2,
      bossSummary!.y + bossSummary!.h / 2,
      three.players,
      three.bosses,
      three.qiji,
      'player',
    );
    expect(hit).toEqual({ kind: 'summary', id: 'boss' });
    /** 而对手的卡片**不在**命中区里（收起时它没被画出来）。 */
    expect(areas.some((a) => a.kind === 'boss')).toBe(false);
  });
});

describe('⚠️ 点击的**意图**（`pointerIntentOf`：把"点了什么"从 Pixi 类里拿出来）', () => {
  /**
   * 这一份测的是**触屏唯一入口**的判定：点按钮 / 块头 / 炁机卡 /
   * 人物卡各是什么意思。
   *
   * ⚠️ 它原来内联在 `PrepareScreen.hitTest` 里（一个 Pixi 类），只能靠
   * 截图看对不对 —— 而"点炁机**整张卡**是一个含义"这件事光看截图看不出来。
   *
   * ⚠️ 2026-10-13：上一版按**左半 / 右半**分成"退一层 / 加一层"，而 0 层时
   * 点左半**什么都不做**（用户报的"点了能选中但不能激活"）。激活是开关，
   * 整张卡一个含义（见 `ui/freeQiji.ts`）。
   */
  const qiji = [{ id: 'q1' }, { id: 'q2' }];

  it('点「开始战斗」→ `start`（它不是卡片）', () => {
    const start = prepareHitAreas(players, bosses, qiji).find((a) => a.kind === 'start')!;
    expect(pointerIntentOf(start.x + 2, start.y + 2, players, bosses, qiji)).toEqual({
      kind: 'start',
    });
  });

  it('点收起的那一块的块头 → `expand`（只展开，不改选择）', () => {
    /** 展开的是人物 → 炁机那一块是收起的块头。 */
    const bars = prepareHitAreas(players, bosses, qiji, 'player').filter((a) => a.kind === 'summary');
    const qijiBar = bars.find((a) => a.id === 'qiji')!;
    expect(pointerIntentOf(qijiBar.x + 4, qijiBar.y + 4, players, bosses, qiji, 'player')).toEqual({
      kind: 'expand',
      slot: 'qiji',
    });
  });

  /**
   * ⚠️ **核心**：整张卡的**任意位置**给同一个意图（点左边 = 点右边）。
   * 用户报的"左半边点了能选中但不能激活"就是这条的反面。
   */
  it('【关键】炁机卡：**左 / 中 / 右任意位置**都是同一个意图（整张卡可点）', () => {
    const card = prepareHitAreas(players, bosses, qiji, 'qiji').find((a) => a.kind === 'qiji' && a.id === 'q1')!;
    const mid = card.x + card.w / 2;
    const at = (px: number) => pointerIntentOf(px, card.y + 4, players, bosses, qiji, 'qiji');
    expect(at(card.x + 2)).toEqual({ kind: 'qiji', id: 'q1' });
    expect(at(mid - 0.5)).toEqual({ kind: 'qiji', id: 'q1' });
    expect(at(mid)).toEqual({ kind: 'qiji', id: 'q1' });
    expect(at(card.x + card.w - 2)).toEqual({ kind: 'qiji', id: 'q1' });
    /** 两条边也算卡内（`inRect` 是闭区间）—— 贴着边框点得中。 */
    expect(at(card.x)).toEqual({ kind: 'qiji', id: 'q1' });
    expect(at(card.x + card.w)).toEqual({ kind: 'qiji', id: 'q1' });
  });

  /**
   * ⚠️ **每一张**炁机卡都要可点（不只是第一张）。
   *
   * 只看第一张的话，"第二行 / 第 5 列用旧宽度"这类错位看不出来。
   */
  it('【关键】逐张炁机卡都能被点中（第二行也要）', () => {
    const cards = prepareHitAreas(players, bosses, qiji, 'qiji').filter((a) => a.kind === 'qiji');
    expect(cards.length).toBeGreaterThan(1);
    for (const card of cards) {
      expect(pointerIntentOf(card.x + 1, card.y + card.h / 2, players, bosses, qiji, 'qiji')).toEqual(
        { kind: 'qiji', id: card.id },
      );
      expect(
        pointerIntentOf(card.x + card.w - 1, card.y + card.h / 2, players, bosses, qiji, 'qiji'),
      ).toEqual({ kind: 'qiji', id: card.id });
    }
  });

  it('点人物 / 对手卡 → `pick`（移光标 + 确定一步到位）', () => {
    const card = prepareHitAreas(players, bosses, qiji, 'player').find((a) => a.kind === 'player')!;
    expect(pointerIntentOf(card.x + 2, card.y + 2, players, bosses, qiji, 'player')).toEqual({
      kind: 'pick',
      option: 'player',
      id: card.id,
    });
  });

  it('点在空白处 → `none`（调用方据此不消费这次点击）', () => {
    expect(pointerIntentOf(-50, -50, players, bosses, qiji)).toEqual({ kind: 'none' });
  });

  it('⚠️ 滚动过之后仍然点得中（几何用的是**同一份**含偏移的命中区）', () => {
    const many = Array.from({ length: 20 }, (_, i) => ({ id: `q${i}` }));
    const scroll = { ...NO_SCROLL, qiji: sectionRowStep('qiji') };
    /** 滚过一行之后，第一行位置上是下标 5 的那张（不是 q0）。 */
    const top = prepareHitAreas(players, bosses, many, 'qiji', scroll).find(
      (a) => a.kind === 'qiji',
    )!;
    expect(top.id).toBe('q5');
    /** 点得中的是**滚过之后**画在那里的那一张。 */
    expect(pointerIntentOf(top.x + 2, top.y + 2, players, bosses, many, 'qiji', scroll)).toEqual({
      kind: 'qiji',
      id: 'q5',
    });
  });

  it('`hitTestPrepare` 与它**同一个判定**（转发关系，不是第二份实现）', () => {
    const card = prepareHitAreas(players, bosses, qiji, 'qiji').find((a) => a.kind === 'qiji')!;
    const at = hitTestPrepare(card.x + 2, card.y + 4, players, bosses, qiji, 'qiji');
    expect(at).toEqual({ kind: 'qiji', id: card.id });
  });
});
