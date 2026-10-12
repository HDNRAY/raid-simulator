import { describe, expect, it } from 'vitest';
import {
  CONTROL_VISIBILITY,
  ESCAPE_KEY,
  backVisibleIn,
  phaseFromEscape,
  type Phase,
} from '../../src/app/phaseLogic';

/**
 * 返回 / `F1` 的**相位判定**。
 *
 * 由来（用户 2026-10-12）："肯定要加返回啊" + "把设置的快捷键改成别的
 * 比如 f1"。所以有两件由相位决定的事：
 *
 *   1. **返回**（`Esc` / 点左上角箭头）→ 首页：只在自由模式 / 选角色屏成立
 *   2. **返回箭头**的可见相位 —— 与 1 **必须同源**
 *
 * 这两件事原先会散在 `game.ts`（显隐）、`loopWiring.ts`（键盘）、
 * `canvasInput.ts`（点击）三处，而漂移的样子正是仓库踩过的
 * "两个界面同时可见" / "看得见、点不动"。抽成纯函数之后可以在 node 里钉住。
 */

/** 全部相位，**逐条列出来**（加值时会漏在这里，正是漏改的报警器）。 */
const ALL: readonly Phase[] = ['home', 'characterSelect', 'prepare', 'battle'];

describe('返回：哪些相位能回首页', () => {
  it('自由模式与选角色屏 → 首页', () => {
    expect(phaseFromEscape('prepare')).toBe('home');
    expect(phaseFromEscape('characterSelect')).toBe('home');
  });

  it('首页没有"返回"（它就是目标本身）', () => {
    expect(phaseFromEscape('home')).toBeUndefined();
  });

  it('⚠️ 战斗中 Esc **什么都不做**（本作没有暂停菜单）', () => {
    /**
     * 用户的判断：战斗中的 `Esc` 传统上是"暂停 / 菜单"，而本作没有菜单，
     * 所以它没有语义 —— 既不中途弃局（没有确认的弃局更坏），
     * 也不打开设置（那是 `F1`）。
     */
    expect(phaseFromEscape('battle')).toBeUndefined();
  });

  it('遍历全部相位：把上面的三条一次性钉死', () => {
    for (const phase of ALL) {
      const target = phaseFromEscape(phase);
      const expected = phase === 'characterSelect' || phase === 'prepare' ? 'home' : undefined;
      expect(target, `phase=${phase}`).toBe(expected);
    }
  });
});

describe('返回箭头的可见相位', () => {
  it('与"能返回"**同源**（不许两处各判一次）', () => {
    for (const phase of ALL) {
      expect(backVisibleIn(phase), `phase=${phase}`).toBe(phaseFromEscape(phase) !== undefined);
    }
  });

  it('`CONTROL_VISIBILITY.back` 就是 `backVisibleIn`（没有第二份判据）', () => {
    for (const phase of ALL) {
      expect(CONTROL_VISIBILITY.back(phase), `phase=${phase}`).toBe(backVisibleIn(phase));
    }
  });

  it('只有自由模式 / 选角色屏显示箭头', () => {
    expect(ALL.filter(backVisibleIn)).toEqual(['characterSelect', 'prepare']);
  });
});

describe('键名', () => {
  it('`Esc` 的键名是 `normalizeKey` 归一化后的形状（小写）', () => {
    /** 返回按钮的提示由它拼出来 —— 大写写错会让提示与实际按键不一致。 */
    expect(ESCAPE_KEY).toBe('escape');
    expect(ESCAPE_KEY).toBe(ESCAPE_KEY.toLowerCase());
  });
});
