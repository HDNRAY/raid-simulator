import { describe, expect, it } from 'vitest';
import { settingsAnchorOf, type Phase } from '../../src/app/flow';

/**
 * 界面路由的两条**纯逻辑**约定。
 *
 * 需求（用户 2026-10-12）："有一个**新的首页**……默认入口：首页"。
 * 加 phase 值是这个仓库踩过的坑（设计稿 §11 风险 #7：`phase` 被 5 处
 * switch，漏一处就"两个界面同时可见"），所以把能抽出来的判断抽成
 * 纯函数钉住。
 */
describe('设置齿轮按钮的锚点', () => {
  it('只有**战斗**用 HUD 锚点（日志下方）', () => {
    expect(settingsAnchorOf('battle')).toBe('battle');
  });

  it('三个整屏界面都用右上角那个锚点', () => {
    expect(settingsAnchorOf('home')).toBe('prepare');
    expect(settingsAnchorOf('characterSelect')).toBe('prepare');
    expect(settingsAnchorOf('prepare')).toBe('prepare');
  });

  it('遍历全部 phase：非战斗的一律不用 HUD 锚点', () => {
    const all: readonly Phase[] = ['home', 'characterSelect', 'prepare', 'battle'];
    for (const phase of all) {
      expect(settingsAnchorOf(phase) === 'battle').toBe(phase === 'battle');
    }
  });
});
