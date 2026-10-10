import { describe, expect, it, vi } from 'vitest';
import { createSettingsToggle } from '../../src/app/settingsToggle';

/**
 * 设置面板的开关状态机。
 *
 * ⚠️ 它管着一条**容易被漏掉的状态**：打开设置前是否本来就暂停。
 * 漏掉的表现是"暂停中打开设置、关掉之后战斗自己跑起来了" ——
 * 玩家按过暂停却继续挨打，很难归因。
 *
 * 抽出成纯模块就是为了能这样直接测（不用跑 Pixi）。
 */
function make(initiallyPaused = false) {
  const settings = { open: vi.fn(), close: vi.fn() };
  const settingsButton = { setVisible: vi.fn() };
  let paused = initiallyPaused;
  const toggle = createSettingsToggle({
    settings,
    settingsButton,
    isPaused: () => paused,
    setPaused: (v) => {
      paused = v;
    },
  });
  return { toggle, settings, settingsButton, isPaused: () => paused };
}

describe('打开设置', () => {
  it('打开时暂停战斗（否则改键时会被打死）', () => {
    const t = make(false);
    t.toggle.open('keys');
    expect(t.isPaused()).toBe(true);
  });

  it('打开时藏起齿轮', () => {
    const t = make();
    t.toggle.open('keys');
    expect(t.settingsButton.setVisible).toHaveBeenCalledWith(false);
  });

  it('把 tab 传给面板', () => {
    const t = make();
    t.toggle.open('general');
    expect(t.settings.open).toHaveBeenCalledWith('general');
  });

  it('重复打开是**幂等**的（不覆盖已记住的暂停状态）', () => {
    /**
     * ⚠️ 这一条很关键：若重复打开时再记一次 `isPaused()`，第二次记到的
     * 是"被我们暂停过"的 true —— 关闭后就再也恢复不了玩家原本的运行态。
     */
    const t = make(false);
    t.toggle.open('keys');
    t.toggle.open('keys');
    t.toggle.close();
    expect(t.isPaused()).toBe(false);
  });
});

describe('关闭设置', () => {
  it('【关键】恢复打开**之前**的暂停状态，而不是无脑恢复运行', () => {
    const t = make(true); // 玩家本来就暂停着
    t.toggle.open('keys');
    t.toggle.close();
    expect(t.isPaused()).toBe(true);
  });

  it('本来就运行中 → 关掉之后继续跑', () => {
    const t = make(false);
    t.toggle.open('keys');
    t.toggle.close();
    expect(t.isPaused()).toBe(false);
  });

  it('关掉之后齿轮回来', () => {
    const t = make();
    t.toggle.open('keys');
    t.toggle.close();
    expect(t.settingsButton.setVisible).toHaveBeenLastCalledWith(true);
  });
});

describe('isOpen / toggle', () => {
  it('isOpen 反映真实状态', () => {
    const t = make();
    expect(t.toggle.isOpen()).toBe(false);
    t.toggle.open('keys');
    expect(t.toggle.isOpen()).toBe(true);
    t.toggle.close();
    expect(t.toggle.isOpen()).toBe(false);
  });

  it('toggle 在两种状态间切换', () => {
    const t = make();
    t.toggle.toggle();
    expect(t.toggle.isOpen()).toBe(true);
    t.toggle.toggle();
    expect(t.toggle.isOpen()).toBe(false);
  });
});
