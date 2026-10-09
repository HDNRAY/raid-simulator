/**
 * 键盘输入 → Action（M3）。
 *
 * 这是**唯一**的玩家输入入口。所有按键都被翻译成 `Action`，
 * 于是：
 *   - 引擎收到的输入与 Boss AI 产出的是同一种东西
 *   - 录制 `Action[]` 就等于录下了整场战斗，可逐帧重放
 *
 * ------------------------------------------------------------------
 * 关键设计：按住连发
 * ------------------------------------------------------------------
 *
 * MMO 手感标配：按住技能键，GCD 一好就自动续。
 * 实现要点：
 *   - `keydown` 且 `event.repeat === false` 时才入队一次 Action
 *   - 同时记录"这个键现在是按下状态"
 *   - 引擎侧若发现该键仍被按住且技能可用，会再次入队
 *     （避免键盘重复事件把队列刷爆）
 *
 * ------------------------------------------------------------------
 * 全键盘，且不依赖鼠标
 * ------------------------------------------------------------------
 *
 * 没有 WASD（本作没有位移），主键区全部留给技能。
 * 必须拦掉浏览器默认行为：Tab（焦点）、空格（滚动）、F1-F12。
 */

import type { Action } from '../core/types';

/** 一个槽位的键位绑定。 */
export interface KeyBinding {
  /** 归一化后的键名（小写）。例如 '1' / 'q' / 'shift+1' */
  readonly key: string;
  readonly skillId: string;
}

/** 键位表：默认一套 12 键布局。 */
export const DEFAULT_BINDINGS: readonly KeyBinding[] = [
  { key: '1', skillId: 'slash' },
  { key: '2', skillId: 'heavy' },
  { key: '3', skillId: 'rend' },
  { key: '4', skillId: 'arc' },
  { key: 'q', skillId: 'dodge' },
  { key: 'e', skillId: 'guard' },
  { key: 'r', skillId: 'haste' },
];

/** 需要拦掉默认行为的键（浏览器会用它们做别的）。 */
const PREVENT_DEFAULT = new Set(['tab', ' ', 'f1', 'f2', 'f3', 'f4', 'f5']);

/**
 * 把 `KeyboardEvent` 归一成一个键名。
 *
 * 归一化的必要性：`event.key` 的大小写随 Shift 变化
 * （按 Shift+1 得到 '!'），直接拿它查表会漏。
 * 所以用 `event.code` 推导出**物理键**，再单独带上修饰键前缀。
 */
export function normalizeKey(event: {
  readonly key: string;
  readonly code?: string;
  readonly shiftKey?: boolean;
  readonly ctrlKey?: boolean;
  readonly altKey?: boolean;
}): string {
  let base = event.key.toLowerCase();

  // 数字键：Shift+1 会给出 '!'，用 code 还原成 '1'
  if (event.code?.startsWith('Digit')) base = event.code.slice(5);
  else if (event.code?.startsWith('Key')) base = event.code.slice(3).toLowerCase();
  else if (event.code?.startsWith('Numpad')) base = `num${event.code.slice(6)}`;

  const parts: string[] = [];
  if (event.ctrlKey) parts.push('ctrl');
  if (event.altKey) parts.push('alt');
  if (event.shiftKey && !/^[0-9]$/.test(base)) parts.push('shift');
  parts.push(base);
  return parts.join('+');
}

export interface InputSource {
  /** 本 tick 要交给引擎的动作 */
  drain(): readonly Action[];
  /** 该键当前是否被按住（引擎据此做"按住连发"） */
  isHeld(key: string): boolean;
  /** 该键绑定的技能 id */
  skillForKey(key: string): string | undefined;
  /** 销毁监听 */
  dispose(): void;
}

export interface InputOptions {
  /** 键位表。默认 `DEFAULT_BINDINGS`。 */
  readonly bindings?: readonly KeyBinding[];
  /** 战斗内时间（tick）的读取方式 —— 由主循环注入，保证时间来源唯一。 */
  readonly currentTick: () => number;
  /** 暂停/恢复等界面动作 */
  readonly onUiKey?: (key: string) => void;
}

/**
 * 创建一个键盘输入源。
 *
 * 刻意**不在这里直接驱动引擎** —— 它只产 Action，
 * 由主循环在每 tick 把它 drain 给引擎。这样输入层可以脱离
 * DOM 进行测试（传入假的 keydown 事件对象即可）。
 */
export function createKeyboardInput(
  target: { addEventListener: EventTarget['addEventListener']; removeEventListener: EventTarget['removeEventListener'] },
  options: InputOptions,
): InputSource {
  const bindings = options.bindings ?? DEFAULT_BINDINGS;
  const keyToSkill = new Map<string, string>();
  for (const binding of bindings) keyToSkill.set(binding.key, binding.skillId);

  const held = new Set<string>();
  const queue: Action[] = [];

  const onKeyDown = (rawEvent: Event): void => {
    const event = rawEvent as KeyboardEvent;
    const key = normalizeKey(event);

    if (PREVENT_DEFAULT.has(key)) event.preventDefault?.();

    // 界面按键（暂停等）交给上层，不作为技能处理
    if (options.onUiKey && (key === 'escape' || key === 'enter')) {
      if (!event.repeat) options.onUiKey(key);
      return;
    }

    held.add(key);

    // `repeat` 为真说明是操作系统的连发 —— 忽略它，
    // 连发由引擎侧的"按住"逻辑处理（避免队列被刷爆）
    if (event.repeat) return;

    const skillId = keyToSkill.get(key);
    if (skillId) {
      queue.push({ type: 'useSkill', skillId, atTick: options.currentTick() });
    }
  };

  const onKeyUp = (rawEvent: Event): void => {
    const key = normalizeKey(rawEvent as KeyboardEvent);
    held.delete(key);
    queue.push({ type: 'releaseKey', key, atTick: options.currentTick() });
  };

  const onBlur = (): void => {
    // 失焦时清空按住状态：否则切走再回来会误判"还在按住"
    held.clear();
  };

  target.addEventListener('keydown', onKeyDown);
  target.addEventListener('keyup', onKeyUp);
  target.addEventListener('blur', onBlur);

  return {
    drain(): readonly Action[] {
      const out = [...queue];
      queue.length = 0;
      return out;
    },
    isHeld(key: string): boolean {
      return held.has(key);
    },
    skillForKey(key: string): string | undefined {
      return keyToSkill.get(key);
    },
    dispose(): void {
      target.removeEventListener('keydown', onKeyDown);
      target.removeEventListener('keyup', onKeyUp);
      target.removeEventListener('blur', onBlur);
    },
  };
}

/**
 * 按住连发：对每个"仍被按住"的技能键，若其技能当前可用，则补一个 Action。
 *
 * 抽成纯函数是为了可测 —— 它不碰 DOM。
 */
export function repeatHeld(
  input: Pick<InputSource, 'isHeld' | 'skillForKey'>,
  bindings: readonly KeyBinding[],
  tick: number,
  isSkillUsable: (skillId: string) => boolean,
): readonly Action[] {
  const out: Action[] = [];
  for (const binding of bindings) {
    if (!input.isHeld(binding.key)) continue;
    if (!isSkillUsable(binding.skillId)) continue;
    out.push({ type: 'useSkill', skillId: binding.skillId, atTick: tick });
  }
  return out;
}
