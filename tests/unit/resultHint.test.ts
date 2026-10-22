import { describe, expect, it } from 'vitest';
import { resultHintKey } from '../../src/render/resultPanel';

/**
 * 结算提示的**模式分流**（2026-10-22 用户报："肉鸽战斗胜利后，写的还是
 * enter 再来一次"）。
 *
 * 判据只有 `roguelike` 一个 —— 两种模式**不许共用一句** ✗。
 */
describe('结算提示：自由模式 vs 肉鸽', () => {
  it('自由模式 = 再来一次（键位提示开着 / 触屏各一句）', () => {
    expect(resultHintKey(true, false)).toBe('screen.hintRestart');
    expect(resultHintKey(false, false)).toBe('screen.hintRestartTap');
  });

  it('肉鸽 = 继续（键位提示开着 / 触屏各一句）', () => {
    expect(resultHintKey(true, true)).toBe('screen.hintContinue');
    expect(resultHintKey(false, true)).toBe('screen.hintContinueTap');
  });

  it('两种模式取到的 key 一定不同（防"改回共用一句"）', () => {
    expect(resultHintKey(true, true)).not.toBe(resultHintKey(true, false));
    expect(resultHintKey(false, true)).not.toBe(resultHintKey(false, false));
  });
});
