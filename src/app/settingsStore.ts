/**
 * **用户设置的持久化**（键位表 + UI 缩放）。
 *
 * ==================================================================
 * 为什么单独一个文件
 * ==================================================================
 *
 * 需求："说了3 忽略。现在开始做1 键盘和移动都做"（指按键设置要持久化）、
 * "分2个key哈 方便我用电脑测试"。
 *
 * ==================================================================
 * ⚠️ 为什么是**两个存储键**（按设备分开）
 * ==================================================================
 *
 * 运行期键位表**仍然是一张**（触屏按钮由它机械派生 —— AGENTS.md §3b
 * "触屏按钮的配置入口就是按键页"），但**存储分两份**：
 *
 *   `raid.bindings.keyboard.v1`  桌面
 *   `raid.bindings.touch.v1`     触屏
 *
 * 理由（用户要求）：同一台电脑上可以同时验证两套配置 —— 切到触屏模式读
 * 触屏那份、用键鼠读键盘那份，互不覆盖。否则调触屏时把键盘的设置冲掉，
 * 来回测很烦。
 *
 * ⚠️ 代价要清楚：同一个浏览器里**两端不再自动同步**（在桌面改的键位不会
 * 出现在触屏模式里）。这是有意的 —— 它换来的是"可以分别验证"。
 *
 * ==================================================================
 * ⚠️ `localStorage` 的内容是**未经验证的输入**
 * ==================================================================
 *
 * 它可能被玩家手改、被旧版本写过、被别的站点污染、或在写入途中被打断
 * （剩半截 JSON）。**不能 `JSON.parse` 完就直接用**：
 *
 *   - 非数组 / 缺字段 → 解析后逐项校验，坏的**整条丢弃**
 *   - `skillId` 不在当前内容里（旧版本存过、内容改了）→ 丢弃该条
 *   - 同一个 `key` 被两个技能占用 → 只保留先出现的（键位表不允许冲突）
 *   - 键名不是字符串 → 丢弃
 *
 * 校验后**与默认表合并**：存储里没有的技能（比如新加的「截」）保留默认
 * 键位，而不是凭空消失。这样"新增技能"不会让老玩家的表变成残的。
 *
 * 任何一步异常都**回落到默认**，绝不让坏数据把游戏卡住。
 */

import { DEFAULT_BINDINGS, type KeyBinding } from '../input/keyboard';

/**
 * 存储键。
 *
 * ⚠️ 带**版本后缀**：以后结构变了就换 `v2`，老键自然作废 ——
 * 比在解析时猜"这是哪一版"可靠得多。
 */
/** 设备形态 —— 决定读写哪一份键位。 */
export type InputMode = 'keyboard' | 'touch';

const BINDING_KEYS: Readonly<Record<InputMode, string>> = {
  keyboard: 'raid.bindings.keyboard.v1',
  touch: 'raid.bindings.touch.v1',
};
const KEY_UI_SCALE = 'raid.uiScale.v1';
/** 上次选的人物 / 对手（备战界面用）。 */
const KEY_PLAYER = 'raid.pick.player.v1';
const KEY_BOSS = 'raid.pick.boss.v1';

/** 存储接口（注入以便测试，也为了在无 `localStorage` 时不炸）。 */
export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/**
 * 取浏览器的 `localStorage`，不可用时返回 `undefined`。
 *
 * ⚠️ 隐私模式 / 禁用 cookie 时**访问 `localStorage` 本身就会抛**，
 * 所以必须包在 `try` 里，而不是只判 `typeof`。
 */
export function browserStorage(): StorageLike | undefined {
  try {
    const s = globalThis.localStorage;
    // 探一下可写（某些环境 getItem 能读、setItem 抛）
    const probe = '__raid_probe__';
    s.setItem(probe, '1');
    s.removeItem(probe);
    return s;
  } catch {
    return undefined;
  }
}

/**
 * 校验并合并键位表。
 *
 * @param raw `localStorage` 里的原始字符串（可能是 `null` / 坏 JSON）
 * @param validSkillIds 当前内容里真实存在的技能 id（用来丢弃失效条目）
 */
export function parseBindings(
  raw: string | null,
  validSkillIds: ReadonlySet<string>,
): readonly KeyBinding[] {
  if (raw === null || raw === '') return DEFAULT_BINDINGS;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return DEFAULT_BINDINGS;
  }
  if (!Array.isArray(parsed)) return DEFAULT_BINDINGS;

  /** 存储里有效的 `skillId → key`。 */
  const saved = new Map<string, string>();
  const usedKeys = new Set<string>();
  for (const item of parsed) {
    if (typeof item !== 'object' || item === null) continue;
    const { skillId, key } = item as { skillId?: unknown; key?: unknown };
    if (typeof skillId !== 'string' || typeof key !== 'string') continue;
    if (!validSkillIds.has(skillId)) continue;
    /** 一个键只能绑一个技能 —— 冲突时保留先出现的。 */
    if (key !== '' && usedKeys.has(key)) continue;
    if (key !== '') usedKeys.add(key);
    saved.set(skillId, key);
  }

  /**
   * ⚠️ **按 `DEFAULT_BINDINGS` 的顺序重建**，存储里没有的技能用默认键位。
   *
   * 顺序很重要：触屏按钮的顺序 = 这张表的顺序。直接用存储里的顺序会让
   * "按钮顺序"随存储内容漂移，而合并默认值则保证新技能有确定位置。
   */
  return DEFAULT_BINDINGS.map((d) => ({ skillId: d.skillId, key: saved.get(d.skillId) ?? d.key }));
}

/** 序列化键位表（只存 `skillId` + `key`，不带别的字段）。 */
export function serializeBindings(bindings: readonly KeyBinding[]): string {
  return JSON.stringify(bindings.map((b) => ({ skillId: b.skillId, key: b.key })));
}

/** 读取 UI 缩放；不可用或越界则返回 `undefined`（调用方保留当前值）。 */
export function parseUiScale(raw: string | null, min: number, max: number): number | undefined {
  if (raw === null || raw === '') return undefined;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < min || n > max) return undefined;
  return n;
}

/**
 * 一个**很薄的**设置存取器。
 *
 * ⚠️ 写入包 `try`：`setItem` 在配额满时会抛，而那不该让游戏崩 ——
 * 最坏情况只是"这次改动没存上"。
 */
export class SettingsStore {
  constructor(
    private readonly storage: StorageLike | undefined,
    /** 当前设备形态 —— 决定读/写哪一份键位。 */
    private readonly mode: InputMode,
  ) {}

  get bindings(): string | null {
    try {
      return this.storage?.getItem(BINDING_KEYS[this.mode]) ?? null;
    } catch {
      return null;
    }
  }

  saveBindings(bindings: readonly KeyBinding[]): void {
    try {
      this.storage?.setItem(BINDING_KEYS[this.mode], serializeBindings(bindings));
    } catch {
      /* 配额满 / 隐私模式：存不上就算了，不影响这一局 */
    }
  }

  /**
   * 清空**当前设备**的键位（保留另一种形态的）。
   *
   * ⚠️ 只清自己那份：否则在触屏上点"恢复默认"会把你在电脑上配好的键盘
   * 设置也抹掉 —— 而"分开存"的全部意义就是不互相影响。
   */
  clearBindings(): void {
    try {
      this.storage?.setItem(BINDING_KEYS[this.mode], '');
    } catch {
      /* 同上 */
    }
  }

  /** 清掉全部已存设置（含另一种形态）。调试/自救用。 */
  clearAll(): void {
    try {
      this.storage?.setItem(BINDING_KEYS.keyboard, '');
      this.storage?.setItem(BINDING_KEYS.touch, '');
      this.storage?.setItem(KEY_UI_SCALE, '');
    } catch {
      /* 同上 */
    }
  }

  /** 上次选的人物 id（原始字符串，交给 `resolvePlayerId` 校验）。 */
  get playerIdRaw(): string | null {
    return this.rawOf(KEY_PLAYER);
  }

  /** 上次选的对手 id。 */
  get bossIdRaw(): string | null {
    return this.rawOf(KEY_BOSS);
  }

  /** 记住这次的选择（备战界面用）。 */
  savePick(playerId: string, bossId: string): void {
    try {
      this.storage?.setItem(KEY_PLAYER, playerId);
      this.storage?.setItem(KEY_BOSS, bossId);
    } catch {
      /* 配额满 / 隐私模式：存不上就算了 */
    }
  }

  /** 原始字符串 —— 交给 `parseUiScale` 校验（不要在存取器里做数值解析）。 */
  get uiScaleRaw(): string | null {
    return this.rawOf(KEY_UI_SCALE);
  }

  /** 读一个原始字符串（把 `try` 收在一处，避免每个 getter 各写一遍）。 */
  private rawOf(key: string): string | null {
    try {
      return this.storage?.getItem(key) ?? null;
    } catch {
      return null;
    }
  }

  saveUiScale(value: number): void {
    try {
      this.storage?.setItem(KEY_UI_SCALE, String(value));
    } catch {
      /* 同上 */
    }
  }
}
