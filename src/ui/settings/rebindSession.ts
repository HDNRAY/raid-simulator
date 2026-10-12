/**
 * **改键会话**：进入"等按键" → 收尾 → 写回键位表。
 *
 * ==================================================================
 * 为什么单独一个文件
 * ==================================================================
 *
 * `SettingsPanel.ts` 又顶到 700 行上限（AGENTS.md §3）。按那里的规则 ——
 * **不许靠删/压注释解决，要拆 util 或横向切割** —— 把"改键会话"整块切出来：
 *
 *   状态机本身（"等的是谁 / 这个键怎么算"）在 `./captureState`（纯函数）
 *   收尾的动作（拒保留键 / 判定冲突 / 写回 / 重画）本来在面板里
 *
 * 后者是一段**内聚的编排**：它要的东西（当前行、翻译、提示、重画）
 * 都是外面给的，与"面板怎么画、焦点在谁身上"没有交集。切出来之后
 * 面板只剩"内容 + 交互"，而这一段也能被单独读。
 *
 * ⚠️ 抽取时**注释整段搬过来** —— 这里记着三个真实踩过的 bug
 * （点击进来白吃第一个键、`Esc` 退不出去、捕获状态卡住不退），
 * 压掉注释就等于让下一个人重踩一遍。
 */

import { isReservedKey, reservedKeyLabel } from '../../input/keyboard';
import { beginCapture, classifyCaptureKey, endCapture, type CaptureState } from './captureState';
import type { KeyRow } from './rows';
import type { TranslateFn } from '../../i18n/translator';

/** 改键会话要碰的那些外部世界（面板把它们接进来）。 */
export interface RebindSessionDeps {
  readonly translate: TranslateFn;
  /**
   * 进入/退出**捕获模式**。
   *
   * 捕获期间输入层不再把按键当技能 —— 这是必须的：否则玩家
   * 按 `Esc` 想取消改键，技能会真的放出去。
   */
  readonly onCapture: (handler: ((key: string) => void) | undefined) => void;
  /** 把某个技能改绑到某个键（冲突策略在 `app/bindingActions`）。 */
  readonly onRebind: (skillId: string, key: string) => void;
  /** 当前行（收尾时要看"这个技能原来的键"）。 */
  readonly rows: () => readonly KeyRow[];
  /** 提示一行（保留键被拒之类）。 */
  readonly notice: (text: string) => void;
  /** 画一遍。 */
  readonly redraw: () => void;
  /** 记一行诊断轨迹（`settingsTrace`）。 */
  readonly trace: (line: string) => void;
}

/**
 * 改键会话。
 *
 * 生命周期：`begin(skillId, triggerKey?)` → （输入层 / 面板把按键送到
 * `handleKey`）→ 自动收尾。`stop()` 是主动退出（切页 / 关面板 / `Esc`）。
 */
export class RebindSession {
  /**
   * 改键状态（"正在等待按键"）。
   *
   * ⚠️ 它是 `./captureState` 里的一个**值**，不是散落的两个字段 ——
   * 语义（triggerKey 该不该作废、Esc 怎么退）全在那个模块里，这里只负责
   * 把判定执行掉。那段逻辑刚连出过三个 bug，所以现在有单测。
   */
  private capture: CaptureState = endCapture();

  constructor(private readonly deps: RebindSessionDeps) {}

  /** 正在等待按键的技能 id（`undefined` = 没在捕获）。 */
  get skillId(): string | undefined {
    return this.capture.skillId;
  }

  /**
   * 进入改键（等待一个按键）。
   *
   * @param triggerKey **触发改键的那一次按键**（键盘 `Enter` 进来时就是
   *   `'enter'`；**鼠标点击进来时没有这一次按键**，所以传 `undefined`）。
   */
  begin(skillId: string, triggerKey?: string): void {
    this.deps.trace(`startCapture(${skillId}) trigger=${triggerKey ?? '-'}`);
    this.capture = beginCapture(skillId, triggerKey);
    this.deps.onCapture((key) => this.handleKey(key));
    this.deps.redraw();
  }

  /** 主动退出捕获（切页 / 关面板 / `Esc`）。 */
  stop(): void {
    if (this.capture.skillId !== undefined) {
      this.deps.trace(`stopCapture(was ${this.capture.skillId})`);
    }
    this.capture = endCapture();
    this.deps.onCapture(undefined);
  }

  /** 捕获模式下收到一个按键（由输入层回调或面板转发过来）。 */
  handleKey(key: string): void {
    this.deps.trace(`finishCapture(${key}) skip=${this.capture.triggerKey ?? '-'}`);
    const skillId = this.capture.skillId;
    if (skillId === undefined) return;

    const verdict = classifyCaptureKey(this.capture, key);
    if (verdict.kind === 'skip') {
      // 作废"触发改键的那一次按键" —— 只作废一次，之后照常捕获
      this.capture = { ...this.capture, triggerKey: undefined };
      return;
    }
    if (verdict.kind === 'cancel') {
      this.stop();
      return;
    }

    /**
     * ⚠️ **先退出捕获，再做判定** —— 单一出口。
     *
     * 早期 `stopCapture()` 分散在几个分支里（保留键那个漏了），于是
     * 捕获状态**卡住不退**：下一次按键仍被当成改键输入，界面像死了。
     */
    this.stop();

    /**
     * **系统保留键直接拒绝并提示**。
     *
     * 需求："一部分系统 reserved 的按键不支持绑技能，记得加提示"。
     * 提示里必须写出**具体是哪个键**被拒 —— 只说"不能用"会让玩家
     * 反复试同一个键。
     */
    if (isReservedKey(key)) {
      this.deps.notice(
        this.deps.translate('settings.keysReserved').replace('{key}', reservedKeyLabel(key)),
      );
      this.deps.redraw();
      return;
    }

    /** 冲突策略（顶掉旧占用者）在 `app/bindingActions`，见它的说明。 */
    const before = this.deps.rows().find((r) => r.skillId === skillId);
    if (before?.key === key) {
      this.deps.redraw();
      return;
    }

    this.deps.onRebind(skillId, key);
    this.deps.redraw();
  }
}
