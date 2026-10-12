import { describe, expect, it, vi } from 'vitest';
import { createSettingsToggle } from '../../src/app/settingsToggle';
import type { SettingsOrigin } from '../../src/ui/settings/tabs';

/**
 * 设置面板的开关状态机。
 *
 * ⚠️ 它管着一条**容易被漏掉的状态**：打开设置前是否本来就暂停。
 * 漏掉的表现是"暂停中打开设置、关掉之后战斗自己跑起来了" ——
 * 玩家按过暂停却继续挨打，很难归因。
 *
 * 抽出成纯模块就是为了能这样直接测（不用跑 Pixi）。
 */
function make(initiallyPaused = false, origin: SettingsOrigin = 'gameplay') {
  const settings = { open: vi.fn(), close: vi.fn() };
  const setGearVisible = vi.fn();
  let paused = initiallyPaused;
  const toggle = createSettingsToggle({
    settings,
    setGearVisible,
    /**
     * ⚠️ **从哪打开**由开关自己在打开的**那一刻**问一次
     * （`phase` 会变，快照一份就会永远停在装配那一刻）。
     */
    origin: () => origin,
    isPaused: () => paused,
    setPaused: (v) => {
      paused = v;
    },
  });
  return { toggle, settings, setGearVisible, isPaused: () => paused };
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
    expect(t.setGearVisible).toHaveBeenCalledWith(false);
  });

  it('把 tab 与**来源**一起传给面板', () => {
    /**
     * ⚠️ 来源必须跟着一起传：首页打开的设置没有「按键」页
     * （用户 2026-10-12："首页点开的设置，可以不要 按键tab"）。
     * 少传一个参数的话 `visibleTabs` 会拿到 `undefined` —— 表现为
     * "在首页也看得到按键页"，而截图上看不出对错。
     */
    const t = make(false, 'home');
    t.toggle.open('general');
    expect(t.settings.open).toHaveBeenCalledWith('general', 'home');
  });

  it('来源是**取值函数**：每次打开都重新问一次', () => {
    let origin: SettingsOrigin = 'home';
    const settings = { open: vi.fn(), close: vi.fn() };
    const toggle = createSettingsToggle({
      settings,
      setGearVisible: () => {},
      origin: () => origin,
      isPaused: () => false,
      setPaused: () => {},
    });
    toggle.open('general');
    expect(settings.open).toHaveBeenLastCalledWith('general', 'home');
    toggle.close();
    origin = 'gameplay';
    toggle.open('keys');
    expect(settings.open).toHaveBeenLastCalledWith('keys', 'gameplay');
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
    expect(t.setGearVisible).toHaveBeenLastCalledWith(true);
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
