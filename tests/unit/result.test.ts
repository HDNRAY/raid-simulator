import { describe, expect, it } from 'vitest';
import { BattleEngine } from '../../src/core/combat/battleState';
import { ViewAdapter, DEFAULT_SLOTS } from '../../src/app/viewAdapter';
import { makeGoldenEngineOptions, planPriority, OUTPUT_PRIORITY } from '../golden/fixtures';
import type { Combatant } from '../../src/core/types';
import { zhCN } from '../../src/i18n/locales/zh-CN';
import { createTranslator } from '../../src/i18n/translator';
import type { MessageKey } from '../../src/i18n/types';

/**
 * 结算界面（M6 的收尾）。
 *
 * 为什么用单元测试而不是截图验证：headless Chrome 在模拟输入期间
 * 会停掉 rAF（frameCount 冻结、无异常），所以"打到战斗结束再截图"
 * 在这套验证环境里不可靠。而结算逻辑本身是纯计算 ——
 * 直接构造一个已结束的战斗来验证它更精确，也更快。
 */

/** ViewAdapter 只关心技能定义（buff 定义由引擎提供）。 */
function adapter(): ViewAdapter {
  return new ViewAdapter(makeGoldenEngineOptions().skills);
}

describe('战斗结算', () => {
  it('战斗进行中没有结算信息', () => {
    const engine = new BattleEngine(makeGoldenEngineOptions());
    const view = adapter().build(engine, DEFAULT_SLOTS, { timeLimitMs: 180_000 });
    expect(view.result).toBeUndefined();
    expect(view.status).toBe('running');
  });

  it('战斗结束后有结算信息，且胜负与 status 一致', () => {
    const a = adapter();
    const engine2 = new BattleEngine(makeGoldenEngineOptions());
    const plan = planPriority(OUTPUT_PRIORITY, { dodgeSkillId: 'dodge' });
    for (let i = 0; i < 60 * 200; i += 1) {
      if (engine2.snapshot.status !== 'running') break;
      engine2.tick(plan(engine2.snapshot.tick, engine2.snapshot));
      a.consume(engine2.drainEvents(), engine2.snapshot.tick, 'player');
    }
    const view = a.build(engine2, DEFAULT_SLOTS, { timeLimitMs: 180_000 });
    const result = view.result;
    expect(result).toBeDefined();
    if (!result) return;
    expect(result.victory).toBe(view.status === 'victory');
    expect(result.titleKey).toBe(result.victory ? 'screen.victory' : 'screen.defeat');
    expect(Number(result.seconds)).toBeGreaterThan(0);
  });

  it('累计伤害与 Boss 掉的血量一致（无护盾/治疗时）', () => {
    const engine = new BattleEngine(makeGoldenEngineOptions());
    const a = adapter();
    const plan = planPriority(OUTPUT_PRIORITY, { dodgeSkillId: 'dodge' });
    const cap = engine.snapshot.combatants.find((c) => c.side === 'enemy')!.caps.hp;
    for (let i = 0; i < 60 * 200; i += 1) {
      if (engine.snapshot.status !== 'running') break;
      engine.tick(plan(engine.snapshot.tick, engine.snapshot));
      a.consume(engine.drainEvents(), engine.snapshot.tick, 'player');
    }
    const view = a.build(engine, DEFAULT_SLOTS, { timeLimitMs: 180_000 });
    const result = view.result!;
    const bossHp = engine.snapshot.combatants.find((c) => c.side === 'enemy')!.resources.hp;
    // Boss 死了 → 累计伤害至少等于它的血上限（可能略多，因为最后一击会溢出）
    expect(result.totalDamage).toBeGreaterThanOrEqual(cap - bossHp - 1);
    expect(result.totalDamage).toBeGreaterThan(0);
  });

  it('DPS 与用时/总伤害自洽', () => {
    const engine = new BattleEngine(makeGoldenEngineOptions());
    const a = adapter();
    const plan = planPriority(OUTPUT_PRIORITY, { dodgeSkillId: 'dodge' });
    for (let i = 0; i < 60 * 200; i += 1) {
      if (engine.snapshot.status !== 'running') break;
      engine.tick(plan(engine.snapshot.tick, engine.snapshot));
      a.consume(engine.drainEvents(), engine.snapshot.tick, 'player');
    }
    const result = a.build(engine, DEFAULT_SLOTS, { timeLimitMs: 180_000 }).result!;
    const expected = Math.round(result.totalDamage / Number(result.seconds));
    expect(Math.abs(result.dps - expected)).toBeLessThanOrEqual(1);
  });

  it('超时结束的结算原因正确', () => {
    const options = makeGoldenEngineOptions(1, { timeLimitMs: 60 });
    const engine = new BattleEngine(options);
    const a = adapter();
    for (let i = 0; i < 200; i += 1) {
      if (engine.snapshot.status !== 'running') break;
      engine.tick();
      a.consume(engine.drainEvents(), engine.snapshot.tick, 'player');
    }
    const view = a.build(engine, DEFAULT_SLOTS, { timeLimitMs: 60 });
    expect(view.status).toBe('defeat');
    expect(view.result?.reasonKey).toBe('screen.defeatedByTimeout');
    expect(view.result?.victory).toBe(false);
  });

  it('玩家阵亡的结算原因正确', () => {
    // 给 Boss 极高伤害，让玩家必死
    const options = makeGoldenEngineOptions();
    const player = options.combatants[0]!;
    const weakPlayer: Combatant = { ...player, caps: { ...player.caps, hp: 1 }, resources: { ...player.resources, hp: 1 } };
    const engine = new BattleEngine({ ...options, combatants: [weakPlayer, options.combatants[1]!] });
    const a = adapter();
    for (let i = 0; i < 60 * 40; i += 1) {
      if (engine.snapshot.status !== 'running') break;
      engine.tick();
      a.consume(engine.drainEvents(), engine.snapshot.tick, 'player');
    }
    const view = a.build(engine, DEFAULT_SLOTS, { timeLimitMs: 180_000 });
    expect(view.status).toBe('defeat');
    expect(view.result?.reasonKey).toBe('screen.defeatedByDeath');
  });
});

describe('结算文案：Boss 名字走参数，不写死', () => {
  /**
   * 需求："wonByKill 里的名字，应该用参数···"
   *
   * 原先 `screen.wonByKill: '击败了伪名一郎'` —— 名字**写死在文案里**，
   * 而且和 Boss 的实际名字对不上（实际是 `boss.name` = "伪·明显一郎"）。
   * 这正是硬编码必然发生的漂移：改 Boss 名字时没人会想到去改这句胜因。
   */
  it('【关键】wonByKill 只留 {name} 占位符，不含硬编码人名', () => {
    const raw = JSON.stringify(zhCN.screen.wonByKill);
    expect(raw).toContain('{name}');
    // 写死的名字（"伪名一郎" / "明显一郎"）都不该再出现
    expect(raw).not.toContain('伪名一郎');
    expect(raw).not.toContain('明显一郎');
  });

  it('渲染层能把它插值成 Boss 的实际名字', () => {
    const t = createTranslator('zh-CN', { catalog: zhCN });
    const bossName = t.t('boss.name');
    const text = t.t('screen.wonByKill', { name: bossName });
    expect(text).toContain(bossName);
    expect(text).not.toContain('{name}');
  });

  it('胜利时的胜因带 reasonParams（名字的 i18n key，而不是译好的文字）', () => {
    /**
     * ⚠️ 用**黄金策略**打，不要"只按攻" —— 后者是**输**的
     * （实测只按攻大约 11 秒后被击败，这正是平衡设计的目标）。
     */
    const engine = new BattleEngine(makeGoldenEngineOptions());
    const adapter = new ViewAdapter(
      makeGoldenEngineOptions().skills,
      /**
       * `Translator.t` 的 key 类型是 `MessageKey`（编译期就能抓拼错），
       * 而渲染层的 `translate` 收 `string`（它只转发 key，不解析）。
       * 这里显式收窄一次：测试里传的都是真实存在的 key。
       */
      (key: string) => createTranslator('zh-CN', { catalog: zhCN }).t(key as MessageKey),
    );
    const plan = planPriority(OUTPUT_PRIORITY, { dodgeSkillId: 'dodge' });
    let guard = 0;
    while (engine.snapshot.status === 'running' && guard < 60 * 300) {
      engine.tick(plan(engine.snapshot.tick, engine.snapshot));
      engine.drainEvents();
      guard += 1;
    }
    const view = adapter.build(engine, DEFAULT_SLOTS);
    expect(view.result?.victory).toBe(true);
    expect(view.result?.reasonKey).toBe('screen.wonByKill');
    /**
     * ⚠️ 参数值是 **key**（`boss.name`）而不是译好的文字 ——
     * 适配器不持有语言包（i18n 规范 I1），翻译在渲染层做。
     */
    expect(view.result?.reasonParams?.name).toBe('boss.name');
  });
});
