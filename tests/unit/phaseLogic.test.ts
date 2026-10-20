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

/**
 * 全部相位，**逐条列出来**（加值时会漏在这里，正是漏改的报警器）。
 *
 * ⚠️ 2026-10-15 补齐：原先只列了四个（`qijiSelect` / `runOver` 加进来时
 * **没有**补进这张表），于是"加相位要在这里加一个"这条纪律实际上已经失效
 * —— 而它的作用正是"漏了会红"。现在七个都在，并补上 `runConfirm`
 * （肉鸽每场战斗之前的确认屏）。
 */
const ALL: readonly Phase[] = [
  'home',
  'characterSelect',
  'prepare',
  'battle',
  'runConfirm',
  'qijiSelect',
  'runOver',
];

/**
 * 「返回 / 返回箭头」那张表**逐相位**的期望值（唯一一处手写的对照面）。
 *
 * | 相位 | `Esc` | 为什么 |
 * |---|---|---|
 * | `home` | 无 | 首页就是目标本身 |
 * | `characterSelect` / `prepare` | `home` | 回首页 |
 * | `battle` | 无 | 战斗中没有暂停 / 菜单（见 `phaseFromEscape`） |
 * | `runConfirm` | **无** | 确认屏没有"回上一屏"（紧接在开局 / 选炁机之后） |
 * | `qijiSelect` / `runOver` | `characterSelect` | 放弃 / 再来一局 |
 * | `codex` | `home` | 图鉴只是"看内容"，回首页 |
 */
const ESCAPE_TARGET: Readonly<Record<Phase, string | undefined>> = {
  home: undefined,
  characterSelect: 'home',
  prepare: 'home',
  battle: undefined,
  runConfirm: undefined,
  qijiSelect: 'characterSelect',
  runOver: 'characterSelect',
  /** 图鉴（2026-10-20）：回首页。 */
  codex: 'home',
};

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

  it('⚠️ 确认屏的 Esc 也**什么都不做**（它没有"回上一屏"）', () => {
    /**
     * 确认屏紧接在"开局 / 选完炁机"之后：此时没有可回的那一屏（回选炁机屏
     * 等于把刚做的决策重做一遍）。要离开这一局，从**选炁机屏 / 一局结束屏**
     * 按返回 —— 那两处的箭头还在。
     */
    expect(phaseFromEscape('runConfirm')).toBeUndefined();
  });

  it('遍历全部相位：把上面那几条一次性钉死', () => {
    for (const phase of ALL) {
      expect(phaseFromEscape(phase), `phase=${phase}`).toBe(ESCAPE_TARGET[phase]);
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

  it('只有选角色 / 自由模式 / 选炁机 / 一局结束显示箭头', () => {
    expect(ALL.filter(backVisibleIn)).toEqual([
      'characterSelect',
      'prepare',
      'qijiSelect',
      'runOver',
    ]);
  });
});

describe('键名', () => {
  it('`Esc` 的键名是 `normalizeKey` 归一化后的形状（小写）', () => {
    /** 返回按钮的提示由它拼出来 —— 大写写错会让提示与实际按键不一致。 */
    expect(ESCAPE_KEY).toBe('escape');
    expect(ESCAPE_KEY).toBe(ESCAPE_KEY.toLowerCase());
  });
});
