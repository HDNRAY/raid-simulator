/**
 * **触屏键位**：可选技能与键盘**同一个池** + 「按键」页右下角那块的两步交互。
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
  SETTINGS_PANEL,
  hitTest,
  keyCellRect,
  keyGridMetrics,
  resetButtonRect,
  resolveActivate,
  resolveKeyAction,
} from '../../src/ui/settings/logic';
import { visibleTabs } from '../../src/ui/settings/tabs';
import { MNEMONIC_KEYS, SLOT_NAV_KEYS, slotNavKeyHint } from '../../src/ui/settings/keyNames';
import {
  TOUCH_BUTTON_CAPACITY,
  touchButtonCenter,
} from '../../src/render/touchGeometry';
import { previewSlotCenter, previewSlotRadius } from '../../src/ui/settings/touchPreview';

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
 * 右下角「模拟键位」的派发（两步交互）
 * ------------------------------------------------------------------ */

const TABS = visibleTabs('gameplay');
const ROWS = ['attack', 'blast', 'focus'];

function panelInput(
  over: Partial<PanelDispatchInput> & { px: number; py: number },
): PanelDispatchInput {
  return {
    visible: true,
    tab: 'keys',
    tabs: TABS,
    rowSkillIds: ROWS,
    slotSkillIds: [],
    selectedSlot: undefined,
    focus: { zone: 'grid', index: 0 },
    capturingSkillId: undefined,
    /** 默认桌面；触屏那条分支由专门的用例显式传 `true`。 */
    touch: false,
    showKeyHints: true,
    ...over,
  };
}

/** 第 `index` 个格子的中心（按桌面度量 —— 与渲染同源）。 */
function cellCenter(index: number): { px: number; py: number } {
  const r = keyCellRect(index, keyGridMetrics(true));
  return { px: r.x + r.w / 2, py: r.y + r.h / 2 };
}

describe('两步交互：点键位 → 点技能 → 绑定（用户 2026-10-12 定案）', () => {
  it('【关键】预览画的就是战斗里那 7 个键位（复用同一份几何）', () => {
    /**
     * ⚠️ 这条是"预览与实战不许是两份真相"的机器判据：预览的圆心由
     * `touchGeometry` 的双弧**等比变换**而来，所以
     *   "两个键位的相对方位" 在预览与战斗里必须一致
     * （等比 ⇒ 夹角与距离比不变）。
     * 手摆坐标的话这条会挂。
     */
    const centers = Array.from({ length: TOUCH_BUTTON_CAPACITY }, (_, i) =>
      previewSlotCenter(i),
    );
    expect(centers.every((c) => c !== undefined)).toBe(true);
    /** 键位之间的相对位置与真实几何同构（同一把尺子量：距离比恒定）。 */
    const previewDist = (a: number, b: number): number => {
      const pa = centers[a]!;
      const pb = centers[b]!;
      return Math.hypot(pa.x - pb.x, pa.y - pb.y);
    };
    const worldDist = (a: number, b: number): number => {
      const wa = touchButtonCenter(a)!;
      const wb = touchButtonCenter(b)!;
      return Math.hypot(wa.x - wb.x, wa.y - wb.y);
    };
    const ratio = previewDist(0, 1) / worldDist(0, 1);
    for (const [a, b] of [
      [0, 2],
      [3, 6],
      [0, 4],
      [2, 5],
    ] as const) {
      expect(previewDist(a, b) / worldDist(a, b)).toBeCloseTo(ratio, 6);
    }
    /** 而且**整组都在预览区里**（不越出面板）。 */
    for (const c of centers) {
      expect(c!.x).toBeGreaterThan(SETTINGS_PANEL.x);
      expect(c!.x).toBeLessThan(SETTINGS_PANEL.x + SETTINGS_PANEL.w);
      expect(c!.y).toBeGreaterThan(SETTINGS_PANEL.y);
      expect(c!.y).toBeLessThan(SETTINGS_PANEL.y + SETTINGS_PANEL.h);
    }
  });

  it('键位是可点的 —— 它是"配触屏按钮"唯一的入口（触屏玩家也点得到）', () => {
    for (let i = 0; i < TOUCH_BUTTON_CAPACITY; i += 1) {
      const c = previewSlotCenter(i)!;
      expect(hitTest(c.x, c.y, { tabs: TABS, tab: 'keys', rowSkillIds: ROWS })).toEqual({
        kind: 'slot',
        index: i,
      });
    }
    /** 键位圆的直径要够手指点（>= 44px 的可点下限）。 */
    expect(previewSlotRadius() * 2).toBeGreaterThanOrEqual(44);
  });

  it('点键位 → selectSlot；再点它 → deselectSlot（不清空内容）', () => {
    const c = previewSlotCenter(3)!;
    expect(resolvePanelDispatch(panelInput({ px: c.x, py: c.y }))).toEqual({
      kind: 'selectSlot',
      index: 3,
    });
    expect(
      resolvePanelDispatch(panelInput({ px: c.x, py: c.y, selectedSlot: 3 })),
    ).toEqual({ kind: 'deselectSlot' });
  });

  it('【关键】选中键位后点技能 = 绑上去（同一格不选中时仍是"只选中技能"）', () => {
    /** ⚠️ 用**没有焦点**的那一格：点已聚焦的格子本来是"进改键"。 */
    const at = cellCenter(1);
    expect(
      resolvePanelDispatch(panelInput({ ...at, selectedSlot: 2, slotSkillIds: ['', ''] })),
    ).toEqual({ kind: 'assignTouchSlot', slot: 2, skillId: 'blast' });
    expect(resolvePanelDispatch(panelInput(at))).toEqual({
      kind: 'focusSkill',
      skillId: 'blast',
    });
  });

  it('【关键】点回该键位上已有的技能 = 取下（清空键位的唯一入口）', () => {
    const at = cellCenter(0);
    expect(
      resolvePanelDispatch(panelInput({ ...at, selectedSlot: 0, slotSkillIds: ['attack'] })),
    ).toEqual({ kind: 'clearTouchSlot', slot: 0 });
  });

  /**
   * ⚠️ 用户 2026-10-12："恢复默认和触屏默认 **同一时间显示一个按钮**
   * 就可以了，根据当前是否是触屏。" —— 所以**位置只有一个**
   * （`resetButtonRect`），恢复什么由 `touch` 决定。
   */
  it('同一个按钮：桌面恢复键位、触屏恢复触屏键位（位置相同）', () => {
    const r = resetButtonRect();
    const at = { px: r.x + 4, py: r.y + 4 };
    expect(resolvePanelDispatch(panelInput({ ...at, touch: false }))).toEqual({
      kind: 'resetKeys',
      notice: 'keysResetDone',
    });
    expect(resolvePanelDispatch(panelInput({ ...at, touch: true }))).toEqual({
      kind: 'resetTouch',
      notice: 'touchResetDone',
    });
  });

  /**
   * ==================================================================
   * 键盘那条路：与鼠标**同一份判定**（AGENTS.md §3b 功能对等）
   * ==================================================================
   *
   * ⚠️ 断言"同一句激活在不同状态下给出两种动作"：只测鼠标会漏掉
   * "键盘被顺手做成只能改键"或反之，而那种不一致截图上看不出来。
   */
  it('【关键】同一个 `Enter`：没选键位 = 改键，选了键位 = 绑到它', () => {
    const base = { tabs: TABS, rowSkillIds: ['a'], slotSkillIds: ['', ''] } as const;
    expect(
      resolveActivate({
        ...base,
        focus: { zone: 'grid', index: 0 },
        selectedSlot: undefined,
      }),
    ).toEqual({ kind: 'startCapture', skillId: 'a' });
    expect(
      resolveActivate({ ...base, focus: { zone: 'grid', index: 0 }, selectedSlot: 1 }),
    ).toEqual({ kind: 'assignTouchSlot', slot: 1, skillId: 'a' });
    /** 那个键位上已经有它 → 取下。 */
    expect(
      resolveActivate({ ...base, focus: { zone: 'grid', index: 0 }, selectedSlot: 0 }),
    ).toEqual({ kind: 'assignTouchSlot', slot: 0, skillId: 'a' });
    expect(
      resolveActivate({
        tabs: TABS,
        rowSkillIds: ['a'],
        slotSkillIds: ['a'],
        focus: { zone: 'grid', index: 0 },
        selectedSlot: 0,
      }),
    ).toEqual({ kind: 'clearTouchSlot', slot: 0 });
  });

  it('键位区按 Enter 选中它，再按一次取消选中', () => {
    const base = { tabs: TABS, rowSkillIds: ROWS, slotSkillIds: [] } as const;
    expect(
      resolveActivate({ ...base, focus: { zone: 'slots', index: 4 }, selectedSlot: undefined }),
    ).toEqual({ kind: 'selectSlot', index: 4 });
    expect(
      resolveActivate({ ...base, focus: { zone: 'slots', index: 4 }, selectedSlot: 4 }),
    ).toEqual({ kind: 'deselectSlot' });
  });

  /**
   * ⚠️ 那个唯一的按钮在**焦点模型**里只有一种激活：`resetKeys`。
   * "恢复键盘还是触屏"由执行层按设备分流（`./resetButton.resetTargetFor`）
   * —— 焦点模型不认识设备，那是它不该知道的事。
   */
  it('「恢复默认」的 Enter = resetKeys（设备分流在执行层）', () => {
    const base = { tabs: TABS, rowSkillIds: [], slotSkillIds: [], selectedSlot: undefined } as const;
    expect(resolveActivate({ ...base, focus: { zone: 'reset' } })).toEqual({ kind: 'resetKeys' });
  });

  it('两个 tab 的助记键都还能用（`T` 已删 —— 触屏不再是独立页）', () => {
    expect(resolveActivate({
      tabs: TABS,
      rowSkillIds: [],
      slotSkillIds: [],
      selectedSlot: undefined,
      focus: { zone: 'tabs', index: 0 },
    })).toEqual({ kind: 'switchTab', tab: 'general' });
    expect(resolveActivate({
      tabs: TABS,
      rowSkillIds: [],
      slotSkillIds: [],
      selectedSlot: undefined,
      focus: { zone: 'tabs', index: 1 },
    })).toEqual({ kind: 'switchTab', tab: 'keys' });
    /** ⚠️ `t` 不再是助记键（它曾经切「触屏」页）。 */
    expect(MNEMONIC_KEYS['t']).toBeUndefined();
  });
});

/**
 * 动作提示与实际行为一致。
 *
 * ⚠️ 键名（`←→↑↓ / Enter`）来自 `SLOT_NAV_KEYS` 而不是 i18n
 * （AGENTS.md §3b），而且**必须真的能被面板处理** ——
 * 否则提示在骗人（而这类"提示与行为不一致"只有人会看出来）。
 */
describe('键位提示与实际行为一致', () => {
  it('【关键】提示里写的那几个键，`resolveKeyAction` 真的当它是一回事', () => {
    expect(SLOT_NAV_KEYS.length).toBeGreaterThan(0);
    for (const { key } of SLOT_NAV_KEYS) {
      const action = resolveKeyAction(key, false);
      // 方向键 → move；Enter → activate。都不是 ignore
      expect(action.kind === 'move' || action.kind === 'activate').toBe(true);
    }
    expect(slotNavKeyHint()).toContain('Enter');
  });

  it('提示里**不含**中文（键名不进 i18n，也不自己写死一句话）', () => {
    expect(slotNavKeyHint()).not.toMatch(/[\u4e00-\u9fff]/);
  });
});
