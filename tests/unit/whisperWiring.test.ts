import { describe, expect, it } from 'vitest';

import { whisperCombatants, whisperForRun } from '../../src/app/whisperApply';
import { makeBoss, makePlayer } from '../../src/data/units';
import { WHISPER_POOL } from '../../src/data/whispers';

/**
 * 「恶魔低语」的**接线**（2026-10-16）：哪一层抽到哪条、那条挂在谁身上。
 *
 * ⚠️ 只钉机制（第 1 层纯净 / 与开战那一侧同源 / 挂对边），不钉"某层是
 * 哪条" —— 换种子和换池子都会改那个答案。
 */

const RUN = { runSeed: 20261016, position: 2, order: ['a', 'b', 'c', 'd', 'e', 'f', 'g'] };

describe('「恶魔低语」· 哪一层是哪条', () => {
  it('第 1 层**纯净**（`undefined`）', () => {
    expect(whisperForRun({ ...RUN, position: 1 })).toBeUndefined();
  });

  it('第 2 层起有低语，且**同一个 RunState 每次读到同一条**', () => {
    const first = whisperForRun(RUN);
    expect(first).toBeDefined();
    expect(whisperForRun(RUN)).toBe(first);
    expect(WHISPER_POOL.map((w) => w.id)).toContain(first?.id);
  });

  it('不同位置读到的不一定相同（顺序是抽的）', () => {
    const ids = [2, 3, 4, 5, 6, 7].map((position) => whisperForRun({ ...RUN, position })?.id);
    expect(new Set(ids).size).toBeGreaterThan(1);
  });
});

describe('「恶魔低语」· 挂在谁身上', () => {
  const player = makePlayer('player');
  const boss = makeBoss('greed');

  it('`bossBuff` ⇒ 挂 Boss（玩家那一侧一个字节都不动）', () => {
    const whisper = WHISPER_POOL.find((w) => w.id === 'blunt');
    expect(whisper).toBeDefined();
    /** `apply` 是判别联合：先收窄，再拿它的 buff id（不在测试里抄字面量）。 */
    const applied = whisper?.apply;
    const buffId = applied?.kind === 'bossBuff' ? applied.buff.id : '';
    const out = whisperCombatants({ player, boss, whisper });
    expect(out.boss.buffs.some((b) => b.defId === buffId), 'Boss 身上该挂上它').toBe(true);
    expect(out.player.buffs.length).toBe(player.buffs.length);
  });

  it('`playerBuff` ⇒ 挂玩家（Boss 那一侧不动）', () => {
    for (const id of ['slowBreath', 'cutDouqi']) {
      const whisper = WHISPER_POOL.find((w) => w.id === id);
      const out = whisperCombatants({ player, boss, whisper });
      expect(out.player.buffs.length, id).toBeGreaterThan(player.buffs.length);
      expect(out.boss.buffs.length, id).toBe(boss.buffs.length);
    }
  });

  it('「狂暴」不在 buff 那一层（它由 `makeBoss` 的行为裁剪负责）', () => {
    const whisper = WHISPER_POOL.find((w) => w.id === 'enrage');
    const out = whisperCombatants({ player, boss, whisper });
    expect(out.player.buffs.length).toBe(player.buffs.length);
    expect(out.boss.buffs.length).toBe(boss.buffs.length);
  });

  it('没有低语时两名战斗者**原样返回**（纯净那一层）', () => {
    const out = whisperCombatants({ player, boss, whisper: undefined });
    expect(out.player).toBe(player);
    expect(out.boss).toBe(boss);
  });
});

describe('「恶魔低语」· 狂暴的落点（`makeBoss` 的 `enrage`）', () => {
  const hasEnrage = (bossId: string, options?: { readonly enrage?: boolean }): boolean =>
    makeBoss(bossId, options).behaviors.some((b) => b.kind === 'enrage');

  it('抽到「狂暴」⇒ 留着那条行为', () => {
    expect(hasEnrage('greed', { enrage: true })).toBe(true);
  });

  it('没抽到 ⇒ **只**裁掉 `enrage` 那一条（别的行为照旧）', () => {
    const without = makeBoss('greed', { enrage: false });
    expect(without.behaviors.some((b) => b.kind === 'enrage')).toBe(false);
    expect(without.behaviors.some((b) => b.kind === 'rotation')).toBe(true);
  });

  it('不传 `enrage`（自由模式 / 黄金夹具）⇒ 与内容里写的一致', () => {
    expect(hasEnrage('greed')).toBe(true);
  });
});
