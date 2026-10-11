import { describe, expect, it } from 'vitest';
import {
  beginCapture,
  classifyCaptureKey,
  endCapture,
  type CaptureState,
} from '../../src/ui/settings/captureState';

/**
 * 改键状态机。
 *
 * ==================================================================
 * 为什么这一撮现在才有测试
 * ==================================================================
 *
 * 这段逻辑原本长在 `SettingsPanel` 里，而那个类要构造 Pixi 对象 ——
 * jsdom 里不好跑，所以只能写"能构造、不报错"这种**零信息**的冒烟测试。
 * 于是改键的语义（谁能作废、`Esc` 怎么退、状态会不会卡住）**完全没有
 * 覆盖**，连着出了三个 bug，全靠"在浏览器里点一遍"才发现：
 *
 *   1. 点击进入改键时**白吃玩家按的第一个键**（要点两次才绑上）
 *   2. `Esc` 退不出改键
 *   3. 捕获状态**卡住不退**，界面像死了
 *
 * 抽成纯模块之后就都能在 node 里精确测了。
 */

/** 一条"正在改键"的状态（多数用例的起点）。 */
const capturing = (triggerKey?: string): CaptureState => beginCapture('flash', triggerKey);

describe('beginCapture：进入改键', () => {
  it('记住技能 id；没有触发键时 triggerKey 为 undefined', () => {
    expect(capturing()).toEqual({ skillId: 'flash', triggerKey: undefined });
  });

  /**
   * ⚠️ 键盘 Enter 进来时，触发改键的那一次按键就是 `'enter'` ——
   * 它必须被记下来（见下面的作废用例）。
   */
  it('键盘进来时把触发键记下来（Enter → "enter"）', () => {
    expect(capturing('enter')).toEqual({ skillId: 'flash', triggerKey: 'enter' });
  });

  it('endCapture 清空一切，且可以反复调（幂等）', () => {
    expect(endCapture()).toEqual({ skillId: undefined, triggerKey: undefined });
    expect(endCapture()).toEqual(endCapture());
  });
});

describe('classifyCaptureKey：捕获中收到一个键', () => {
  it('没在捕获时一切都当 skip（不该触发任何绑定）', () => {
    expect(classifyCaptureKey(endCapture(), 'y')).toEqual({ kind: 'skip' });
    expect(classifyCaptureKey(endCapture(), 'escape')).toEqual({ kind: 'skip' });
  });

  it('普通键 → bind（玩家想绑这个键）', () => {
    expect(classifyCaptureKey(capturing(), 'y')).toEqual({ kind: 'bind', key: 'y' });
  });

  it('escape → cancel（唯一的退路）', () => {
    expect(classifyCaptureKey(capturing(), 'escape')).toEqual({ kind: 'cancel' });
  });

  /**
   * ==================================================================
   * 【回归】点击进入改键时，第一个键**不许**被吃掉
   * ==================================================================
   *
   * 玩家反馈的症状：点格子进改键、按一下没反应、**再按一次才绑上**。
   *
   * 根因：老的写法是无条件的 `skipNextCapture = true` —— 它假设
   * "进入改键总伴随着一次按键"（键盘 Enter 确实如此）。但**鼠标点击
   * 进来时没有那一次按键**，于是那个哨兵白吃掉了玩家的第一个键。
   *
   * 所以判据必须是"**按 key 相等来作废**"，而不是"第一个键一律丢掉"。
   */
  it('【回归】鼠标点击进入（triggerKey 为 undefined）时第一个键直接 bind', () => {
    expect(classifyCaptureKey(capturing(), 'y')).toEqual({ kind: 'bind', key: 'y' });
  });

  it('triggerKey 匹配时 → skip', () => {
    expect(classifyCaptureKey(capturing('enter'), 'enter')).toEqual({ kind: 'skip' });
  });

  it('triggerKey 不匹配时 → 正常 bind（不是"丢掉第一个键"）', () => {
    expect(classifyCaptureKey(capturing('enter'), 'y')).toEqual({ kind: 'bind', key: 'y' });
  });

  /**
   * ⚠️ 作废**只发生一次**：面板把 triggerKey 清成 undefined 之后再收到
   * 同一个键，就该正常绑定了（否则玩家永远绑不上 Enter）。
   */
  it('作废只一次：triggerKey 清掉后再按同一个键就 bind', () => {
    const afterSkip: CaptureState = { ...capturing('enter'), triggerKey: undefined };
    expect(classifyCaptureKey(afterSkip, 'enter')).toEqual({ kind: 'bind', key: 'enter' });
  });

  /**
   * ⚠️ `triggerKey` 与 `escape` 的先后：与 `resolveKeyAction` 同序
   * （先看捕获中的键）—— 这样两条投递路径对同一个键给出同样判定。
   */
  it('triggerKey 恰好是 escape 时优先作废（不取消）', () => {
    expect(classifyCaptureKey(capturing('escape'), 'escape')).toEqual({ kind: 'skip' });
  });
});
