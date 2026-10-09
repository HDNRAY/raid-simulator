import { describe, expect, it } from 'vitest';
import { isReservedKey, reservedKeyLabel } from '../../src/input/keyboard';
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
  resolveActivate,
  resolveKeyAction,
  tabRect,
  closeButtonRect,
  cycleZone,
  moveFocus,
  type SettingsFocus,
} from '../../src/ui/settings/logic';
import { UiLayout } from '../../src/ui/uiLayout';
import { LAYOUT } from '../../src/ui/layout';

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

describe('系统保留键不能绑技能', () => {
  it('Esc / Tab / Enter / F1–F12 / 单独修饰键都被拒', () => {
    for (const key of [
      'escape',
      'tab',
      'enter',
      'f1',
      'f5',
      'f12',
      'shift',
      'control',
      'alt',
      'meta',
    ]) {
      expect(isReservedKey(key), key).toBe(true);
    }
  });

  it('可打印字符与组合键可以绑', () => {
    for (const key of ['1', 'q', 'z', ' ', 'shift+1', 'control+2', 'arrowup', 'arrowleft']) {
      expect(isReservedKey(key), key).toBe(false);
    }
  });

  it('保留键的可读名字 —— 提示里要写清是哪个键', () => {
    expect(reservedKeyLabel('escape')).toBe('Esc');
    expect(reservedKeyLabel('tab')).toBe('Tab');
    expect(reservedKeyLabel('enter')).toBe('Enter');
    // 功能键整排归成一个名字，玩家一看就知道"整个 F 区都不行"
    expect(reservedKeyLabel('f1')).toBe('F1–F12');
    expect(reservedKeyLabel('f12')).toBe('F1–F12');
    expect(reservedKeyLabel('shift')).toBe('shift');
  });
});

describe('弹窗内的键盘导航：没有只能用鼠标的死角', () => {
  const cells = 6;

  it('方向键在技能网格里移动，与 grid 的列数一致', () => {
    const first: SettingsFocus = { zone: 'grid', index: 0 };
    expect(moveFocus(first, 'right', cells)).toEqual({ zone: 'grid', index: 1 });
    expect(moveFocus(first, 'down', cells)).toEqual({ zone: 'grid', index: KEY_GRID.cols });
    // 第一列往左不动（不绕到上一行末尾，避免"斜着跳"）
    expect(moveFocus(first, 'left', cells)).toEqual(first);
  });

  it('网格第一行往上 → 到 tab 行；最后一行往下 → 到"恢复默认"', () => {
    expect(moveFocus({ zone: 'grid', index: 0 }, 'up', cells)).toEqual({ zone: 'tabs', index: 0 });
    const lastRow: SettingsFocus = { zone: 'grid', index: KEY_GRID.cols * 2 };
    expect(moveFocus(lastRow, 'down', cells)).toEqual({ zone: 'reset' });
  });

  it('焦点不会落到看不见的格子上', () => {
    /**
     * 容量是算出来的（`KEY_GRID_CAPACITY`），如果某一行只填了一半，
     * 向下移动不能把焦点放到那个空位上 —— 否则玩家按 Enter
     * 会"对空气改键"。
     */
    const odd = 4; // 4 个格子、3 列 → 第二行只有 1 个
    const secondRowStart: SettingsFocus = { zone: 'grid', index: 2 };
    expect(moveFocus(secondRowStart, 'down', odd)).toEqual({ zone: 'reset' });
  });

  it('"恢复默认"往上/往左回到网格', () => {
    expect(moveFocus({ zone: 'reset' }, 'up', cells)).toEqual({ zone: 'grid', index: cells - 1 });
    expect(moveFocus({ zone: 'reset' }, 'left', cells)).toEqual({ zone: 'grid', index: cells - 1 });
  });

  it('Tab 循环所有可用区域（含关闭按钮），Shift+Tab 反向', () => {
    const a = cycleZone({ zone: 'tabs', index: 0 }, cells);
    expect(a.zone).toBe('grid');
    const b = cycleZone(a, cells);
    expect(b.zone).toBe('reset');
    // reset → close → tabs（关闭按钮也在循环里，否则它只能用鼠标）
    const c = cycleZone(b, cells);
    expect(c.zone).toBe('close');
    expect(cycleZone(c, cells).zone).toBe('tabs');
    // 反向：tabs ← close（顺序是 tabs → grid → reset → close → tabs）
    expect(cycleZone({ zone: 'tabs', index: 0 }, cells, true).zone).toBe('close');
  });

  it('没有技能格时 Tab 只在 tab 行与按钮之间走（不产生空焦点）', () => {
    const a = cycleZone({ zone: 'tabs', index: 0 }, 0);
    expect(a.zone).toBe('reset');
    const a2 = cycleZone(a, 0);
    expect(a2.zone).toBe('close');
    expect(cycleZone(a2, 0).zone).toBe('tabs');
  });

  it('Enter 激活：tab 行切换 tab、格子上开始改键、按钮上恢复默认', () => {
    expect(resolveActivate({ zone: 'tabs', index: 0 }, [])).toEqual({
      kind: 'switchTab',
      tab: 'general',
    });
    expect(resolveActivate({ zone: 'tabs', index: 1 }, [])).toEqual({
      kind: 'switchTab',
      tab: 'keys',
    });
    expect(resolveActivate({ zone: 'reset' }, [])).toEqual({ kind: 'resetKeys' });
    expect(resolveActivate({ zone: 'grid', index: 1 }, ['a', 'b'])).toEqual({
      kind: 'startCapture',
      skillId: 'b',
    });
  });

  it('方向键与 Enter 在弹窗内被当作导航，不会穿透成技能', () => {
    // 这是"几乎全键盘可操作"的前提：弹窗开着时方向键不该去打怪
    expect(resolveKeyAction('arrowup', false)).toEqual({ kind: 'move', direction: 'up' });
    expect(resolveKeyAction('arrowdown', false)).toEqual({ kind: 'move', direction: 'down' });
    expect(resolveKeyAction('arrowleft', false)).toEqual({ kind: 'move', direction: 'left' });
    expect(resolveKeyAction('arrowright', false)).toEqual({ kind: 'move', direction: 'right' });
    expect(resolveKeyAction('enter', false)).toEqual({ kind: 'activate' });
    expect(resolveKeyAction('tab', false)).toEqual({ kind: 'cycle', back: false });
  });

  it('捕获中优先一切 —— 连方向键都是"想绑这个键"', () => {
    // 否则玩家想把技能绑成方向键就永远绑不上
    expect(resolveKeyAction('arrowup', true)).toEqual({ kind: 'capture', key: 'arrowup' });
    expect(resolveKeyAction('enter', true)).toEqual({ kind: 'capture', key: 'enter' });
    // Esc 是唯一退路
    expect(resolveKeyAction('escape', true)).toEqual({ kind: 'cancelCapture' });
  });

  it('无关按键不产生动作（但也不穿透）', () => {
    expect(resolveKeyAction('x', false)).toEqual({ kind: 'ignore' });
  });
});

describe('保留键在弹窗内的处理路径', () => {
  /**
   * 需求："一部分系统 reserved 的按键不支持绑技能，记得加提示"。
   * 这里守住"键名 → 提示文案里的键名"这一步不会错位 ——
   * 功能链路（真实按键 → 提示）由 CDP 端到端验证覆盖。
   */
  it('每个保留键都映射到可读名字，提示不会漏掉键名', () => {
    const cases: ReadonlyArray<readonly [string, string]> = [
      ['escape', 'Esc'],
      ['tab', 'Tab'],
      ['enter', 'Enter'],
      ['f1', 'F1–F12'],
      ['f12', 'F1–F12'],
      ['shift', 'shift'],
      ['control', 'control'],
      ['alt', 'alt'],
    ];
    for (const [key, label] of cases) {
      expect(isReservedKey(key), key).toBe(true);
      expect(reservedKeyLabel(key), key).toBe(label);
    }
  });

  it('模板里的 {key} 占位符能被替换（提示必须写出是哪个键）', () => {
    // 只说"不能用"会让玩家反复试同一个键，所以占位符是必需的
    const template = '{key} 是系统保留键，不能绑定';
    expect(template.replace('{key}', reservedKeyLabel('f3'))).toBe('F1–F12 是系统保留键，不能绑定');
  });
});

describe('关闭按钮与 Boss 面板边距', () => {
  /**
   * 需求："设置弹窗里的『关闭』点了没反应。"
   *
   * 根因：它只是个 `Label`，**没有命中测试** —— 点它落到
   * `hitTestLogic` 的 `none` 分支（"点在弹窗内空白处，消费掉"）。
   * 点面板外的空白也能关，但那不是玩家会去点的地方。
   */
  it('【关键】点「关闭」命中 close，且关掉弹窗', () => {
    const r = closeButtonRect();
    const hit = hitTest(r.x + r.w / 2, r.y + r.h / 2, { tab: 'general', rowSkillIds: [] });
    expect(hit.kind).toBe('close');
    // 两个 tab 上都该能点（它是弹窗级的，不属于某一页）
    expect(hitTest(r.x + 2, r.y + 2, { tab: 'keys', rowSkillIds: ['attack'] }).kind).toBe('close');
  });

  it('关闭按钮在弹窗内、右上角，且不与 tab 行重叠', () => {
    const r = closeButtonRect();
    expect(r.x).toBeGreaterThan(SETTINGS_PANEL.x + SETTINGS_PANEL.w / 2);
    expect(r.y).toBeLessThan(SETTINGS_PANEL.y + 40);
    // 竖向上不该压到 tab 行（tab 在 top 40..70）
    expect(r.y + r.h).toBeLessThanOrEqual(SETTINGS_PANEL.y + 40);
  });

  it('键盘也能到「关闭」（Enter 可触发）', () => {
    expect(resolveActivate({ zone: 'close' }, []).kind).toBe('close');
    // 循环里必须包含它，否则它只能用鼠标
    const fromReset = cycleZone({ zone: 'reset' }, 0);
    expect(fromReset.zone).toBe('close');
  });

  /**
   * 需求："boss 面板……无论 ui 如何缩放，应该保持和屏幕左右两边的
   * 边距不变，只是缩放高度和内容尺寸。"
   */
  it('Boss 面板缩放时左右边距恒定、只缩高度', () => {
    for (const k of [0.5, 1, 1.5, 2]) {
      const ui = new UiLayout(k);
      expect(ui.bossBar.x).toBe(LAYOUT.bossBar.x);
      expect(ui.bossBar.w).toBe(LAYOUT.bossBar.w);
      expect(ui.bossHp.x).toBe(LAYOUT.bossHp.x);
      expect(ui.bossHp.w).toBe(LAYOUT.bossHp.w);
    }
    // 高度确实跟着缩放
    expect(new UiLayout(2).bossBar.h).toBeGreaterThan(new UiLayout(1).bossBar.h);
  });

  /**
   * 需求："玩家面板目前距离屏幕底部太远了，应该和按钮区域到底部距离一致。"
   */
  it('玩家面板底边与技能栏底边对齐（距屏幕底同一边距）', () => {
    const skillBottom = LAYOUT.skillBar.y + LAYOUT.skillBar.slot;
    const panelBottom = LAYOUT.player.y + LAYOUT.player.h;
    expect(panelBottom).toBe(skillBottom);
    // 缩放后依然对齐（两者都是底锚点）
    const ui = new UiLayout(1.5);
    expect(ui.playerPanel.y + ui.playerPanel.h).toBe(skillBottom);
  });

  it('玩家读条跟着面板下移，且不压到面板', () => {
    const castBottom = LAYOUT.playerCastBar.y + LAYOUT.playerCastBar.h;
    expect(castBottom).toBeLessThanOrEqual(LAYOUT.player.y);
    // 间距不宜过大（否则中间空一块）
    expect(LAYOUT.player.y - castBottom).toBeLessThanOrEqual(10);
  });
});

describe('标签只出现在详情区，不占技能格', () => {
  /**
   * 需求："按键设置里，grid 的 cell 里就不要显示 tag 了"。
   *
   * 为什么去掉：格子是 188×56 的小面积，塞第三行字之后
   * "技能名 + 按键 + 标签"互相挤，扫一眼分不清主次。而玩家在这一页
   * 真正要确认的是"**哪个技能绑了哪个键**"——标签属于"这个技能是什么"，
   * 那是底部详情区的事。
   */
  it('【关键】技能格里不再有标签 Label', async () => {
    const { readFileSync } = await import('node:fs');
    const src = readFileSync(new URL('../../src/ui/settings/SettingsPanel.ts', import.meta.url), 'utf8');
    // RowSlot 不再带 tags 字段
    expect(src).not.toMatch(/private readonly rowLabels: Array<\{\s*\n\s*\/\*\*[^]*?tags: Label;/);
    // 绘制分支里不再给格子设标签
    expect(src).not.toMatch(/slot\.tags\.set/);
    // 建格子时也不再 new 标签 Label
    expect(src).not.toMatch(/const tags = new Label\(pixi/);
  });

  it('标签仍然出现在**详情区**（没有整体删掉）', async () => {
    const { readFileSync } = await import('node:fs');
    const src = readFileSync(new URL('../../src/ui/settings/SettingsPanel.ts', import.meta.url), 'utf8');
    // 详情区的 tags Label 还在，并且仍被赋值
    // （实现已抽到 `SkillDetail.ts`，所以整层拼接后再匹配）
    const detail = readFileSync(new URL('../../src/ui/settings/SkillDetail.ts', import.meta.url), 'utf8');
    const all = src + detail;
    expect(all).toMatch(/this\.tags = line\(1, FONT\.tiny/);
    expect(all).toMatch(/this\.tags\.set\(tags\)/);
    // 文案 key 仍然来自 settings.hintTags.<id>
    expect(src + detail).toMatch(/settings\.hintTags\.\$\{tag\}/);
  });

  it('tagColor 已随格子标签一起删除（不留死代码）', async () => {
    const { readFileSync } = await import('node:fs');
    const src = readFileSync(new URL('../../src/ui/settings/SettingsPanel.ts', import.meta.url), 'utf8');
    expect(src).not.toMatch(/function tagColor\(/);
  });
});
