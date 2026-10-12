/**
 * **触屏按钮集合**：可选技能与键盘**同一个池** + 设置页「触屏」页的派发。
 *
 * ==================================================================
 * 这个文件防的是什么
 * ==================================================================
 *
 * 用户 2026-10-12 定案（原话）：
 *   "触屏和键盘**当然是 2 套**，连 localStorage 都是分 2 个 key 存的，
 *    只是**可选技能是一样的**。"
 *
 * 所以有两件事必须被钉住，而且它们是**相反方向**的：
 *   1. **两套**：按钮集合与键位表互不派生（存放也是两个 key）
 *      → 见 `settingsStore.test.ts` 的第三个 key、`touchLayout.test.ts`
 *        的增删，以及本文件里"同一次点击在不同页给出不同动作"
 *   2. **同一个池**：可选技能列表不因输入方式而不同
 *      → 见下面第一条断言（它是这句话唯一的机器判据）
 *
 * ⚠️ 池子的两侧（`buildKeyRows` 列出的技能 / 加载存档时的校验池）各写一遍
 * 过滤就会漂，而漂的样子是"设置页列得出来、但一存就被丢掉" ——
 * 截图看不出来。所以这里断言**两个集合相等**，不是"有交集"。
 */

import { describe, expect, it } from 'vitest';
import { ALL_BUFFS, ALL_SKILLS } from '../../src/data/content';
import { createRegistry } from '../../src/core/content/registry';
import { translator } from '../../src/i18n/translator';
import { DEFAULT_BINDINGS } from '../../src/input/keyboard';
import { buildKeyRows, bindableSkillIdsOf } from '../../src/app/keyRows';
import { parseTouchButtons } from '../../src/app/settingsStore';
import {
  resolvePanelDispatch,
  type PanelDispatchInput,
} from '../../src/ui/settings/panelDispatch';
import {
  hitTest,
  keyCellRect,
  keyGridMetrics,
  resetButtonRect,
  resolveActivate,
  resolveKeyAction,
  tabRect,
} from '../../src/ui/settings/logic';
import { TOUCH_TOGGLE_KEYS, touchToggleKeyHint } from '../../src/ui/settings/keyNames';

/** 与 `app/deps.ts` 同一条构造方式（同一份内容）。 */
function testRegistry() {
  return createRegistry({ entities: [], skills: [...ALL_SKILLS], buffs: [...ALL_BUFFS] });
}

/** 设置页行的构造（与 `settingsPanelOptions.ts` 同一条路）。 */
function rowsOf(registry: ReturnType<typeof testRegistry>) {
  return buildKeyRows({
    bindings: DEFAULT_BINDINGS,
    registry,
    snapshotOf: () => ({ skills: [] }) as never,
    translate: (key: string, params?: Readonly<Record<string, string | number>>) =>
      translator.t(key as never, params as never),
  } as never);
}

describe('可选技能 = 同一个池（用户明确要求）', () => {
  const registry = testRegistry();

  it('【关键】设置页列出的技能 == 触屏按钮的校验池', () => {
    const listed = new Set(rowsOf(registry).map((r) => r.skillId));
    expect([...listed].sort()).toEqual([...bindableSkillIdsOf(registry)].sort());
    /** 池子不该是空的（否则上面那条会"两空相等"的假绿）。 */
    expect(listed.size).toBeGreaterThan(0);
  });

  it('【关键】池里的技能都存得下、池外的都读不回来', () => {
    /**
     * 这条是"池子被两个消费者共用"的**行为证据**：
     * 设置页给得出的技能，存档必须能保留；给不出的，存档必须丢掉。
     */
    const pool = bindableSkillIdsOf(registry);
    const someListed = [...pool];
    expect(parseTouchButtons(JSON.stringify(someListed), pool)).toEqual(someListed);

    /** Boss 的招（不在池里）会被丢掉 —— 设置页根本给不出它。 */
    expect(parseTouchButtons(JSON.stringify(['boss-lust-hum']), pool)).toEqual([]);
  });
});

describe('触屏按钮集合与键位表：两套，互不派生', () => {
  it('【关键】按钮集合**不从键位表算出来**', () => {
    /**
     * 这正是用户遇到的死结：
     *   技能没绑键 → 触屏上没有它的按钮；而配按钮的地方是「按键」页，
     *   触屏又按不出键、进不去改键。
     *
     * 两个方向各断言一次：
     *   1. **有键也能取下**：默认有键的技能可以不在按钮集合里
     *   2. **没键也能放上**：把它在键位表里清空，按钮集合照样保留它
     *      （旧实现里这两个方向都是被派生关系钉死的）
     */
    const pool = bindableSkillIdsOf(testRegistry());

    expect(parseTouchButtons(JSON.stringify([]), pool)).toEqual([]);

    const cleared = DEFAULT_BINDINGS.map((b) =>
      b.skillId === 'attack' ? { ...b, key: '' } : b,
    );
    expect(cleared.find((b) => b.skillId === 'attack')?.key).toBe('');
    expect(parseTouchButtons(JSON.stringify(['attack']), pool)).toEqual(['attack']);
  });
});

/* ------------------------------------------------------------------ *
 * 「触屏」页的派发
 * ------------------------------------------------------------------ */

function panelInput(over: Partial<PanelDispatchInput> & { px: number; py: number }): PanelDispatchInput {
  return {
    visible: true,
    tab: 'touch',
    rowSkillIds: ['attack', 'blast', 'focus'],
    focus: { zone: 'grid', index: 0 },
    capturingSkillId: undefined,
    showKeyHints: true,
    ...over,
  };
}

/** 第 `index` 个格子的中心（按桌面度量 —— 与渲染同源）。 */
function cellCenter(index: number): { px: number; py: number } {
  const r = keyCellRect(index, keyGridMetrics(true));
  return { px: r.x + r.w / 2, py: r.y + r.h / 2 };
}

describe('「触屏」页的派发：点一下格子 = 放上 / 取下', () => {
  it('【关键】第三个 tab（触屏）可点 —— 它是这一整套功能唯一的入口', () => {
    /**
     * ⚠️ 触屏玩家要给自己加一个技能按钮，只能从这一页进（见 AGENTS.md §3b
     * 的作废标注）。tab 顺序由 `SETTINGS_TABS` 定，所以这里断言的是
     * "第三个位置 = 触屏页"，而不是某个绝对坐标。
     */
    const touch = tabRect(2);
    expect(hitTest(touch.x + 2, touch.y + 2, { tab: 'keys', rowSkillIds: [] })).toEqual({
      kind: 'tab',
      tab: 'touch',
    });
    /** 三个 tab 不重叠（第三个挤到别处就会点错页）。 */
    for (const i of [0, 1]) {
      const prev = tabRect(i);
      expect(prev.x + prev.w).toBeLessThanOrEqual(touch.x);
    }
  });

  it('触屏页与按键页**共用同一套格子几何**（点得到、也点得到恢复按钮）', () => {
    const cell = keyCellRect(0, keyGridMetrics(true));
    expect(
      hitTest(cell.x + 4, cell.y + 4, { tab: 'touch', rowSkillIds: ['attack'] }),
    ).toEqual({ kind: 'keyRow', skillId: 'attack' });
    const reset = resetButtonRect();
    expect(hitTest(reset.x + 4, reset.y + 4, { tab: 'touch', rowSkillIds: ['attack'] }).kind).toBe(
      'resetKeys',
    );
  });

  it('触屏页点格子 → toggleTouch（不是 captureSkill / focusSkill）', () => {
    const at = cellCenter(2);
    expect(resolvePanelDispatch(panelInput({ ...at, tab: 'touch' }))).toEqual({
      kind: 'toggleTouch',
      skillId: 'focus',
    });
    /** ⚠️ 同一格在「按键」页仍然是"先选中"（键盘那套没被动）。 */
    expect(resolvePanelDispatch(panelInput({ ...at, tab: 'keys' }))).toEqual({
      kind: 'focusSkill',
      skillId: 'focus',
    });
  });

  it('【关键】触屏页**再点一次已选中的格子**仍然只是增删 —— 不进改键', () => {
    /**
     * 需求："不要做成『请按一个键』—— 那对触屏无意义。"
     *
     * 「按键」页上"点已选中的格子"会进改键（那条路对键盘是必须的），
     * 所以这里用**同一个坐标、同一个焦点**分别跑两页，钉住分叉。
     */
    const at = cellCenter(0);
    const sameCell = { ...at, focus: { zone: 'grid', index: 0 } as const };
    expect(resolvePanelDispatch(panelInput({ ...sameCell, tab: 'touch' })).kind).toBe(
      'toggleTouch',
    );
    expect(resolvePanelDispatch(panelInput({ ...sameCell, tab: 'keys' })).kind).toBe(
      'captureSkill',
    );
  });

  it('触屏页的「恢复默认」→ resetTouch（与按键页的 resetKeys 分开）', () => {
    const r = resetButtonRect();
    const at = { px: r.x + 4, py: r.y + 4 };
    expect(resolvePanelDispatch(panelInput({ ...at, tab: 'touch' }))).toEqual({
      kind: 'resetTouch',
      notice: 'touchResetDone',
    });
    expect(resolvePanelDispatch(panelInput({ ...at, tab: 'keys' }))).toEqual({
      kind: 'resetKeys',
      notice: 'keysResetDone',
    });
  });

  /**
   * ==================================================================
   * 键盘那条路：Enter / 空格在触屏页 = **放上 / 取下**（不是改键）
   * ==================================================================
   *
   * 需求："触屏原生：点一下技能格 = 放上 / 取下。⚠️ 不要做成『请按一个键』
   * —— 那对触屏无意义" + "键盘也要能用（触屏笔记本）"。
   *
   * ⚠️ 断言"**同一句激活**在两个 tab 上给出两种动作"：只测触屏页会漏掉
   * "按键页被顺手改成 toggleTouch"这种回归（那会让键盘用户再也改不了键）。
   * 判定走 `resolveActivate`（`resolveKeyDispatch` 就是拿它解析 Enter 的）。
   */
  it('【关键】同一个格子：按键页 = 改键，触屏页 = 放上 / 取下', () => {
    expect(resolveActivate({ zone: 'grid', index: 0 }, ['a'], 'keys')).toEqual({
      kind: 'startCapture',
      skillId: 'a',
    });
    expect(resolveActivate({ zone: 'grid', index: 0 }, ['a'], 'touch')).toEqual({
      kind: 'toggleTouch',
      skillId: 'a',
    });
    /** 触屏页的「恢复默认」恢复的是**按钮集合**，与按键页含义不同。 */
    expect(resolveActivate({ zone: 'reset' }, [], 'touch')).toEqual({ kind: 'resetTouch' });
    /** 第三个 tab 的助记键（`T`）也要真的切到触屏页。 */
    expect(resolveActivate({ zone: 'tabs', index: 2 }, [], 'keys')).toEqual({
      kind: 'switchTab',
      tab: 'touch',
    });
  });
});

/**
 * 动作键提示与实际行为一致。
 *
 * ⚠️ 键名（`Enter / Space`）来自 `TOUCH_TOGGLE_KEYS` 而不是 i18n
 * （AGENTS.md §3b），而且**必须真的被面板当成 activate** ——
 * 否则提示在骗人（而这类"提示与行为不一致"只有人会看出来）。
 */
describe('动作键提示与实际行为一致', () => {
  it('【关键】提示里写的那几个键，`resolveKeyAction` 真的当成 activate', () => {
    expect(TOUCH_TOGGLE_KEYS.length).toBeGreaterThan(0);
    for (const { key } of TOUCH_TOGGLE_KEYS) {
      // 非捕获状态下 = 用户想激活这一格（触屏页上就是增删按钮）
      expect(resolveKeyAction(key, false)).toEqual({ kind: 'activate' });
    }
    expect(touchToggleKeyHint()).toContain('Enter');
  });

  it('提示里**不含**中文（键名不进 i18n，也不自己写死一句话）', () => {
    expect(touchToggleKeyHint()).not.toMatch(/[\u4e00-\u9fff]/);
  });
});
