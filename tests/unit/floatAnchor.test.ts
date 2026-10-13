import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ACTOR_POS, FLOAT_TEXT_Y, floatAnchorOf } from '../../src/render/actorLayout';
import { LAYOUT, LOGICAL } from '../../src/ui/layout';
import { BattleEngine } from '../../src/core/combat/battleState';
import { ViewAdapter, DEFAULT_SLOTS } from '../../src/app/viewAdapter';
import { makeGoldenEngineOptions } from '../golden/fixtures';
import type { EventDef } from '../../src/core/types';
import type { FloatingTextView } from '../../src/render/viewModel';

/**
 * ==================================================================
 * 飘字锚点必须**等于被打的那个角色的位置**
 * ==================================================================
 *
 * 用户报的 bug（2026-10-13，原话）：
 *
 *   "对了 **角色和boss位置互换了**，**战斗文字飘的位置好像没有跟着换**"
 *
 * 根因是**同一个事实被算了两遍**：角色画在哪由 `actorLayout.ACTOR_POS`
 * 说了算，而飘字的 x 是 `viewAdapter` 里的两个字面量（`630` / `300`）。
 * 站位一互换，第一份改了、第二份没改 —— 于是**两边的飘字正好落反**。
 *
 * 这个文件把"锚点 = 角色位置"钉住，四层：
 *   1. `floatAnchorOf` 本身 → 纯几何断言
 *   2. 真的跑一场战斗读 `view.floatingText` → 证明**调用点**用的也是它
 *   3. 一条源码扫描 → 禁止再有人往 `pushFloating` 里塞字面量坐标
 *   4. 一条"不越界 / 不压 HUD"断言 → 位置改了但压到面板上的话会红
 */

/**
 * ⚠️ 散布范围是 `viewAdapter` 的 `FLOATING_SPREAD_X / _Y`。
 *
 * 它们**不是**从 `render/` 导出的（那是 `app/` 的内部细节），所以这里
 * 手工同步一份用于"落点范围"断言。**改那两个数就要改这里** ——
 * 这是本文件唯一的"第二份数字"，其余全部派生。
 */
const SPREAD_X = 38;

/** 视图里"刚生成"的飘字（`life` 从 1 开始，每帧 −0.02）。 */
function freshFloats(view: {
  readonly floatingText: readonly FloatingTextView[];
}): FloatingTextView[] {
  return view.floatingText.filter((f) => f.life > 0.9);
}

interface Harness {
  readonly adapter: ViewAdapter;
  readonly engine: BattleEngine;
  /** 推进一帧（可带注入动作），返回这一帧的事件。 */
  readonly frame: (
    actions?: readonly { readonly type: 'useSkill'; readonly skillId: string; readonly atTick: number }[],
  ) => readonly EventDef[];
  /** 立刻读一帧视图。 */
  readonly view: () => ReturnType<ViewAdapter['build']>;
}

function harness(): Harness {
  const options = makeGoldenEngineOptions();
  const engine = new BattleEngine(options);
  const adapter = new ViewAdapter(options.skills);
  return {
    adapter,
    engine,
    frame: (actions = []) => {
      engine.tick([...actions]);
      const events = engine.drainEvents();
      adapter.consume(events, engine.snapshot.tick, 'player');
      return events;
    },
    view: () => adapter.build(engine, DEFAULT_SLOTS, { timeLimitMs: 180_000 }),
  };
}

describe('floatAnchorOf —— 飘字锚点从角色位置派生（唯一真相）', () => {
  it('两个角色各自的锚点 = 各自的站位 x', () => {
    expect(floatAnchorOf('player').x).toBe(ACTOR_POS.player.x);
    expect(floatAnchorOf('meiichiro').x).toBe(ACTOR_POS.boss.x);
  });

  it('⚠️ 玩家的锚点**不等于** Boss 的（互换之后 630 / 300 不能写反）', () => {
    /**
     * 这条就是这次 bug 的形状：修复前 `floatAnchorOf('player').x` 会是
     * `300`（旧字面量），`floatAnchorOf('meiichiro').x` 会是 `630`。
     */
    expect(floatAnchorOf('player').x).toBe(630);
    expect(floatAnchorOf('meiichiro').x).toBe(300);
    expect(floatAnchorOf('player').x).toBeGreaterThan(floatAnchorOf('meiichiro').x);
  });

  it('高度按角色分开（两个角色头顶上方的空带位置不同）', () => {
    expect(floatAnchorOf('player').y).toBe(FLOAT_TEXT_Y.player);
    expect(floatAnchorOf('meiichiro').y).toBe(FLOAT_TEXT_Y.boss);
  });

  it('不认识的 id 落到 Boss 锚点（全场只有"玩家 / 不是玩家"两种）', () => {
    expect(floatAnchorOf('who-knows')).toEqual(floatAnchorOf('meiichiro'));
    expect(Number.isFinite(floatAnchorOf('who-knows').x)).toBe(true);
    expect(Number.isFinite(floatAnchorOf('who-knows').y)).toBe(true);
  });

  /**
   * ⚠️ 两条飘字各自**不许压任何一块 HUD、也不许出画布**。
   *
   * 散布范围让飘字可能落在锚点周围 ±38 / ±17 的盒子里 —— 用盒子算
   * "会不会压到面板"，而不是只看锚点那一个点。
   */
  it.each([
    ['Boss 挨打那一行', floatAnchorOf('meiichiro')],
    ['玩家挨打那一行', floatAnchorOf('player')],
  ])('%s：不压 HUD、不出画布', (_label, anchor) => {
    const box = {
      l: anchor.x - SPREAD_X,
      r: anchor.x + SPREAD_X,
      t: anchor.y - 17,
      b: anchor.y + 17,
    };
    /**
     * ⚠️ 这里**逐个点名**要检查的矩形，而不是遍历 `LAYOUT`：
     *   - `LAYOUT` 里混着"矩形"（`x/y/w/h`）与"流式条"（`x/y/size/gap`），
     *     遍历会让类型退化成一堆分支
     *   - 点名本身也是**文档**：列出来的就是"飘字必须让开的面板"
     *
     * 三个 buff 条（Boss 两条 / 玩家两条，`size + gap` 那种）没列：它们在
     * 顶栏带（y < 80）与玩家面板右侧（x ≥ 244, y ≥ 479），与两条飘字的
     * y 都不重叠；列进来只会逼着这里再抄一遍它们的宽度公式。
     */
    const solidRects: readonly (readonly [string, { readonly x: number; readonly y: number; readonly w: number; readonly h: number }])[] = [
      ['Boss 顶栏', LAYOUT.bossBar],
      ['Boss 血条', LAYOUT.bossHp],
      ['预警条', LAYOUT.castBar],
      ['战斗日志', LAYOUT.log],
      ['玩家读条', LAYOUT.playerCastBar],
      [
        '玩家面板',
        { x: LAYOUT.player.x, y: LAYOUT.player.y, w: LAYOUT.player.w, h: LAYOUT.player.h },
      ],
      ['技能栏', { x: 0, y: LAYOUT.skillBar.y, w: LOGICAL.width, h: LAYOUT.skillBar.slot }],
    ];
    for (const [name, rect] of solidRects) {
      const overlaps =
        box.r > rect.x && box.l < rect.x + rect.w && box.b > rect.y && box.t < rect.y + rect.h;
      expect(overlaps, `飘字压到了「${name}」`).toBe(false);
    }
    expect(box.l).toBeGreaterThanOrEqual(0);
    expect(box.r).toBeLessThanOrEqual(LOGICAL.width);
    expect(box.t).toBeGreaterThanOrEqual(0);
    expect(box.b).toBeLessThanOrEqual(LOGICAL.height);
  });
});

describe('战斗里：飘字落在**被打的那个人**那一侧', () => {
  it('⚠️【核心】玩家打 Boss → `-n` 落在 Boss 的位置（300）', () => {
    const h = harness();
    /** 先用「斩」确认对 Boss 的伤害真的会发生（不靠猜时序）。 */
    h.frame([{ type: 'useSkill', skillId: 'attack', atTick: 0 }]);
    let damage: EventDef | undefined;
    for (let i = 1; i < 60 * 3 && damage === undefined; i += 1) {
      const events = h.frame();
      damage = events.find((e) => e.kind === 'damage' && e.targetId !== 'player');
    }
    expect(damage, '「斩」必须在 3 秒内命中 Boss').toBeDefined();

    const fresh = freshFloats(h.view());
    expect(fresh.length, '伤害落地那一帧必须有新飘字').toBeGreaterThan(0);
    const hit = fresh.at(-1)!;
    expect(hit.text.startsWith('-'), `伤害飘字应以 - 开头：${hit.text}`).toBe(true);
    expect(
      Math.abs(hit.x - floatAnchorOf('meiichiro').x),
      `Boss 挨打的飘字必须落在 Boss 那一侧（实际 x=${hit.x}）`,
    ).toBeLessThanOrEqual(SPREAD_X);
    expect(
      Math.abs(hit.x - floatAnchorOf('player').x),
      `Boss 挨打的飘字落到了玩家那一侧（实际 x=${hit.x}）`,
    ).toBeGreaterThan(SPREAD_X);
  });

  it('⚠️【核心】Boss 打玩家 → 伤害飘字落在玩家的位置（630）', () => {
    const h = harness();
    let damage: EventDef | undefined;
    for (let i = 0; i < 60 * 25 && damage === undefined; i += 1) {
      const events = h.frame();
      if (h.engine.snapshot.status !== 'running') break;
      damage = events.find((e) => e.kind === 'damage' && e.targetId === 'player');
    }
    expect(damage, '25 秒内 Boss 必须打到过玩家').toBeDefined();

    const fresh = freshFloats(h.view());
    expect(fresh.length, '伤害落地那一帧必须有新飘字').toBeGreaterThan(0);
    const hit = fresh.at(-1)!;
    expect(
      Math.abs(hit.x - floatAnchorOf('player').x),
      `玩家挨打的飘字必须落在玩家那一侧（实际 x=${hit.x}）`,
    ).toBeLessThanOrEqual(SPREAD_X);
    expect(
      Math.abs(hit.x - floatAnchorOf('meiichiro').x),
      `玩家挨打的飘字落到了 Boss 那一侧（实际 x=${hit.x}）`,
    ).toBeGreaterThan(SPREAD_X);
  });

  it('傲慢的「回补」是自己回血 → `+126` 必须飘在**它**头上（不是玩家）', () => {
    /**
     * 同一个 bug 的第二个受害者：`heal` 原先写死 `(300, 380)`。
     * 直接构造一条 `heal` 事件喂给适配器 —— 不依赖 Boss 真的走到那个分支。
     */
    const h = harness();
    h.adapter.consume(
      [
        {
          kind: 'heal',
          tick: 0,
          sourceId: 'meiichiro',
          targetId: 'meiichiro',
          amount: 126,
          crit: false,
          overheal: 0,
        },
      ],
      0,
      'player',
    );
    const heal = h.view().floatingText.find((f) => f.text === '+126');
    expect(heal, '回血飘字必须出现').toBeDefined();
    expect(
      Math.abs(heal!.x - floatAnchorOf('meiichiro').x),
      `Boss 回血的飘字必须落在 Boss 那一侧（实际 x=${heal!.x}）`,
    ).toBeLessThanOrEqual(SPREAD_X);
    expect(
      Math.abs(heal!.x - floatAnchorOf('player').x),
      `Boss 回血的飘字落到了玩家那一侧（实际 x=${heal!.x}）`,
    ).toBeGreaterThan(SPREAD_X);
  });

  it('「闪躲」飘在躲掉的那一方头上（`targetId`）', () => {
    const h = harness();
    h.adapter.consume(
      [
        {
          kind: 'avoided',
          tick: 0,
          sourceId: 'meiichiro',
          targetId: 'player',
          skillId: 'boss-scorn',
          reason: 'dodged',
        },
      ],
      0,
      'player',
    );
    const avoid = h.view().floatingText.find((f) => f.text === '0');
    expect(avoid, '闪躲飘字必须出现').toBeDefined();
    expect(
      Math.abs(avoid!.x - floatAnchorOf('player').x),
      `闪躲飘字必须落在玩家那一侧（实际 x=${avoid!.x}）`,
    ).toBeLessThanOrEqual(SPREAD_X);
  });
});

/**
 * 把源码里的**注释**剥掉。
 *
 * ⚠️ 必须剥：修复的说明本身就引用了旧写法（`baseX = onBoss ? 630 : 300`），
 * 不剥的话"禁止这个写法"的断言会被**解释这个 bug 的注释**触发 ——
 * 那会逼着下一个人删掉注释（AGENTS.md §3 明确禁止用删注释解决问题）。
 */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

describe('源码扫描：`pushFloating` 不许再写字面量坐标', () => {
  /**
   * 这条是"第二份真相"的**结构防线**：让这次 bug 成立的是
   * `viewAdapter` 里那两个字面量。断言"这种写法不存在"比断言"它等于几"
   * 更耐用 —— 它不关心锚点怎么算，只禁止再抄一份。
   */
  it('每个 `pushFloating(...)` 的 x / y 都来自 `anchor.x / anchor.y`', () => {
    const src = stripComments(
      readFileSync(new URL('../../src/app/viewAdapter.ts', import.meta.url), 'utf8'),
    );
    const calls = src.match(/this\.pushFloating\((?:[^()]|\([^()]*\))*\)/g) ?? [];
    expect(calls.length, '至少要找到伤害 / 回血 / 闪躲三处').toBeGreaterThanOrEqual(3);
    for (const call of calls) {
      const one = call.replace(/\s+/g, ' ');
      expect(one, `飘字锚点必须来自 floatAnchorOf：${one}`).toMatch(/anchor\.x\s*,\s*anchor\.y/);
      expect(one, `飘字锚点不许是字面量：${one}`).not.toMatch(/,\s*\d{2,3}\s*,\s*\d{2,3}\s*[,)]/);
    }
    /** 旧常量与旧写法都不该回来。 */
    expect(src).not.toMatch(/combatTextY/);
    expect(src).not.toMatch(/=\s*onBoss\s*\?\s*\d/);
  });
});
