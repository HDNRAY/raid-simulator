import { describe, expect, it } from 'vitest';
import {
  EMPTY_KEY,
  KEY_GRID_CAPACITY,
  hintLineY,
  KEY_GRID,
  SETTINGS_PANEL,
  applyRebind,
  contains,
  hitTest,
  insidePanel,
  keyLabel,
  keyCellRect,
  resetButtonRect,
  resolveKeyAction,
  tabRect,
} from '../../src/ui/settings/logic';

/**
 * 设置界面的判定逻辑。
 *
 * 这些是**纯函数**，所以能精确测（不需要 jsdom + Pixi）。
 * 绘制部分留给浏览器里的实测 —— 逻辑在 node 里测、绘制在浏览器里看，
 * 与 `DebugPanel` / `formatDebugValue` 同一分工。
 */

describe('几何：点击命中不能错位', () => {
  it('弹窗居中', () => {
    expect(SETTINGS_PANEL.x + SETTINGS_PANEL.w / 2).toBeCloseTo(480, 0);
    expect(SETTINGS_PANEL.y + SETTINGS_PANEL.h / 2).toBeCloseTo(270, 0);
  });

  it('两个 tab 不重叠、且都在弹窗内', () => {
    const a = tabRect(0);
    const b = tabRect(1);
    expect(a.x + a.w).toBeLessThanOrEqual(b.x);
    expect(insidePanel(a.x + 1, a.y + 1)).toBe(true);
    expect(insidePanel(b.x + 1, b.y + 1)).toBe(true);
  });

  it('技能格按 grid 排布，两两不重叠', () => {
    const cells = Array.from({ length: KEY_GRID_CAPACITY }, (_, i) => keyCellRect(i));
    for (let a = 0; a < cells.length; a += 1) {
      for (let b = a + 1; b < cells.length; b += 1) {
        const A = cells[a]!;
        const B = cells[b]!;
        const ox = Math.min(A.x + A.w, B.x + B.w) - Math.max(A.x, B.x);
        const oy = Math.min(A.y + A.h, B.y + B.h) - Math.max(A.y, B.y);
        expect(ox > 0 && oy > 0, `第 ${a} 格与第 ${b} 格重叠`).toBe(false);
      }
    }
  });

  it('grid 每行放 3 个：第二行的 x 回到第一列', () => {
    const first = keyCellRect(0);
    const fourth = keyCellRect(KEY_GRID.cols);
    expect(fourth.x).toBe(first.x);
    expect(fourth.y).toBeGreaterThan(first.y);
  });

  it('grid 比单列省高度：容量至少 12 个技能', () => {
    /**
     * 这是改成 grid 的**理由**，值得写成断言。
     * 单列时 12 个技能要 12×30 = 360px，弹窗根本放不下。
     */
    expect(KEY_GRID.cols).toBeGreaterThanOrEqual(3);
    expect(KEY_GRID_CAPACITY).toBeGreaterThanOrEqual(12);
  });

  it('【关键】恢复默认按钮不与最后一个技能格重叠 —— 容量是从剩余空间推出来的', () => {
    const lastCell = keyCellRect(KEY_GRID_CAPACITY - 1);
    const reset = resetButtonRect();
    expect(reset.y).toBeGreaterThanOrEqual(lastCell.y + lastCell.h);
    expect(reset.y + reset.h).toBeLessThanOrEqual(SETTINGS_PANEL.y + SETTINGS_PANEL.h);
  });

  it('推导出的容量足够放下当前 6 个技能', () => {
    // 如果这个不成立，说明弹窗高度或行高被改得太紧，技能表会显示不全
    expect(KEY_GRID_CAPACITY).toBeGreaterThanOrEqual(6);
  });

  it('contains 的边界是闭区间', () => {
    const r = { x: 10, y: 10, w: 20, h: 20 };
    expect(contains(r, 10, 10)).toBe(true);
    expect(contains(r, 30, 30)).toBe(true);
    expect(contains(r, 9, 15)).toBe(false);
    expect(contains(r, 15, 31)).toBe(false);
  });
});

describe('hitTest：点到哪里', () => {
  const rows = ['attack', 'blast', 'focus', 'break', 'dodge', 'guard'];

  it('点在弹窗外 → outside（用于"点外部关闭"）', () => {
    expect(hitTest(2, 2, { tab: 'keys', rowSkillIds: rows }).kind).toBe('outside');
    expect(
      hitTest(SETTINGS_PANEL.x + SETTINGS_PANEL.w + 5, SETTINGS_PANEL.y + 5, {
        tab: 'keys',
        rowSkillIds: rows,
      }).kind,
    ).toBe('outside');
  });

  it('点两个 tab 各自命中正确的 tab', () => {
    const general = tabRect(0);
    const keys = tabRect(1);
    expect(
      hitTest(general.x + 2, general.y + 2, { tab: 'keys', rowSkillIds: rows }),
    ).toEqual({ kind: 'tab', tab: 'general' });
    expect(hitTest(keys.x + 2, keys.y + 2, { tab: 'keys', rowSkillIds: rows })).toEqual({
      kind: 'tab',
      tab: 'keys',
    });
  });

  it('点键位行命中对应的技能', () => {
    for (const [i, skillId] of rows.entries()) {
      const r = keyCellRect(i);
      expect(hitTest(r.x + 4, r.y + 4, { tab: 'keys', rowSkillIds: rows })).toEqual({
        kind: 'keyRow',
        skillId,
      });
    }
  });

  it('点恢复默认按钮命中 resetKeys', () => {
    const r = resetButtonRect();
    expect(hitTest(r.x + 4, r.y + 4, { tab: 'keys', rowSkillIds: rows }).kind).toBe('resetKeys');
  });

  it('【关键】通用 tab 下不会命中键位行 —— 那一块在通用 tab 里不存在', () => {
    const r = keyCellRect(0);
    expect(hitTest(r.x + 4, r.y + 4, { tab: 'general', rowSkillIds: rows }).kind).toBe('none');
  });

  it('【关键】通用 tab 下也不会命中"恢复默认"——它属于按键 tab', () => {
    const r = resetButtonRect();
    expect(hitTest(r.x + 4, r.y + 4, { tab: 'general', rowSkillIds: rows }).kind).toBe('none');
  });

  it('最后一行**可见**的键位仍然可点', () => {
    const many = Array.from({ length: KEY_GRID_CAPACITY + 4 }, (_, i) => `s${i}`);
    const last = keyCellRect(KEY_GRID_CAPACITY - 1);
    expect(hitTest(last.x + 4, last.y + 4, { tab: 'keys', rowSkillIds: many })).toEqual({
      kind: 'keyRow',
      skillId: `s${KEY_GRID_CAPACITY - 1}`,
    });
  });

  it('超出显示上限的行不会被误判成键位行', () => {
    /**
     * 表格每行 26px、最多显示 8 行，所以第 9 行之后的位置已经压到
     * "恢复默认"按钮上了。那个点必须归按钮，**不能**归一个看不见的行 ——
     * 否则玩家点"恢复默认"会改掉某个根本看不到的技能的键。
     */
    const many = Array.from({ length: KEY_GRID_CAPACITY + 4 }, (_, i) => `s${i}`);
    const beyond = keyCellRect(KEY_GRID_CAPACITY + 1);
    const target = hitTest(beyond.x + 4, beyond.y + 4, { tab: 'keys', rowSkillIds: many });
    expect(target.kind).not.toBe('keyRow');
  });

  it('空白处返回 none（调用方会消费掉，不让点击穿透到战斗）', () => {
    // 弹窗左下角、键位行与按钮之外的区域
    expect(
      hitTest(SETTINGS_PANEL.x + 10, SETTINGS_PANEL.y + SETTINGS_PANEL.h - 70, {
        tab: 'keys',
        rowSkillIds: rows,
      }).kind,
    ).toBe('none');
  });
});

describe('改键：冲突策略是"顶掉旧占用者"', () => {
  const base = [
    { key: '1', skillId: 'attack' },
    { key: '2', skillId: 'blast' },
    { key: 'q', skillId: 'dodge' },
  ];

  it('改到空闲的键：只动目标技能', () => {
    const r = applyRebind(base, 'attack', 'z');
    expect(r.bindings.find((b) => b.skillId === 'attack')?.key).toBe('z');
    expect(r.bindings.find((b) => b.skillId === 'blast')?.key).toBe('2');
    expect(r.unbound).toBe('1');
  });

  it('改到已被占用的键：旧占用者被解绑，而不是拒绝改键', () => {
    const r = applyRebind(base, 'attack', 'q');
    expect(r.bindings.find((b) => b.skillId === 'attack')?.key).toBe('q');
    // 闪避被顶掉（绑成空）
    expect(r.bindings.find((b) => b.skillId === 'dodge')?.key).toBe(EMPTY_KEY);
    expect(r.error).toBeUndefined();
  });

  it('改到自己的键：无变化', () => {
    const r = applyRebind(base, 'attack', '1');
    expect(r.bindings).toEqual(base);
  });

  it('绑成空键是合法的（玩家可以主动解绑）', () => {
    const r = applyRebind(base, 'attack', EMPTY_KEY);
    expect(r.bindings.find((b) => b.skillId === 'attack')?.key).toBe(EMPTY_KEY);
  });

  it('改动不会影响未涉及的技能', () => {
    const r = applyRebind(base, 'blast', 'x');
    expect(r.bindings.find((b) => b.skillId === 'attack')?.key).toBe('1');
    expect(r.bindings.find((b) => b.skillId === 'dodge')?.key).toBe('q');
  });

  it('【关键】改键后不存在"两个技能绑同一个键"', () => {
    const r = applyRebind(base, 'attack', 'q');
    const keys = r.bindings.map((b) => b.key).filter((k) => k !== EMPTY_KEY);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe('键名显示', () => {
  it('单字符大写，与技能栏上的提示一致', () => {
    expect(keyLabel('q', '未绑定')).toBe('Q');
    expect(keyLabel('1', '未绑定')).toBe('1');
  });

  it('空键显示"未绑定"', () => {
    expect(keyLabel(EMPTY_KEY, '未绑定')).toBe('未绑定');
  });

  it('组合键原样保留（全大写太吵）', () => {
    expect(keyLabel('shift+1', '未绑定')).toBe('shift+1');
  });
});

describe('键盘：弹窗打开时怎么处理', () => {
  it('没在捕获时按 Esc 关闭弹窗', () => {
    expect(resolveKeyAction('escape', false)).toEqual({ kind: 'closePanel' });
  });

  it('没在捕获时其它键忽略（不穿透到战斗）', () => {
    expect(resolveKeyAction('1', false)).toEqual({ kind: 'ignore' });
  });

  it('【关键】捕获时按 Esc 是"取消改键"，不是关闭弹窗', () => {
    expect(resolveKeyAction('escape', true)).toEqual({ kind: 'cancelCapture' });
  });

  it('捕获时其它键都当作"玩家想绑这个键" —— 包括 Esc 之外的任何键', () => {
    expect(resolveKeyAction('z', true)).toEqual({ kind: 'capture', key: 'z' });
    expect(resolveKeyAction('shift+1', true)).toEqual({ kind: 'capture', key: 'shift+1' });
    // Tab 也是合法按键（它被输入层 preventDefault 掉了）
    expect(resolveKeyAction('tab', true)).toEqual({ kind: 'capture', key: 'tab' });
  });
});

describe('底部区域不重叠（曾经把"恢复默认"压在提示文字上）', () => {
  it('提示文字行在按钮上方，且两者不重叠', () => {
    const hintRect = {
      x: SETTINGS_PANEL.x + 16,
      y: SETTINGS_PANEL.y + hintLineY(),
      w: 300,
      // 13px 字号的行高约 18
      h: 18,
    };
    const reset = resetButtonRect();
    expect(hintRect.y + hintRect.h).toBeLessThanOrEqual(reset.y);
  });

  it('提示文字行与按钮都在弹窗内', () => {
    const reset = resetButtonRect();
    expect(SETTINGS_PANEL.y + hintLineY()).toBeGreaterThanOrEqual(SETTINGS_PANEL.y);
    expect(reset.y + reset.h).toBeLessThanOrEqual(SETTINGS_PANEL.y + SETTINGS_PANEL.h);
  });

  it('技能格的容量不会越过提示文字行', () => {
    const lastCell = keyCellRect(KEY_GRID_CAPACITY - 1);
    expect(lastCell.y + lastCell.h).toBeLessThanOrEqual(SETTINGS_PANEL.y + hintLineY());
  });
});
