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
 * 运行期键位表**仍然是一张**，但**存储分两份**：
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
 * ⚠️ 触屏按钮集合是**第三个键**，而且与"键位表"是两回事（2026-10-12）
 * ==================================================================
 *
 * 用户原话："触屏和键盘**当然是 2 套**，连 localStorage 都是分 2 个 key
 * 存的，只是**可选技能是一样的**。"
 *
 *   `raid.bindings.*.v1`      键盘绑定表（键 → 技能）
 *   `raid.touchButtons.v1`    **触屏按钮集合**（技能 id 数组，顺序即槽位）
 *
 * ⚠️ 这两份**互不派生**：触屏按钮不再是"有键的技能"（那会让没绑键的
 * 技能在触屏上永远上不了场，而触屏又进不去改键）。可选技能同一个池，
 * 选中子集各存各的。
 *
 * ⚠️ 触屏按钮**不按设备分两份**：它本来就是"触屏那一套配置"，
 * 在电脑上配好、手机上打开就该在（键位表分两份是另一条理由，见上）。
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
/**
 * **触屏按钮集合**（技能 id 数组，顺序即双弧上的槽位）。
 *
 * ⚠️ 与键位表分开、且**不按设备分**：它就是"触屏那一套"配置本身。
 * 见文件头那段说明。
 */
const KEY_TOUCH_BUTTONS = 'raid.touchButtons.v1';
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

/**
 * 校验触屏键位表。
 *
 * @param raw `localStorage` 里的原始字符串（可能是 `null` / 坏 JSON）
 * @param validSkillIds **可选技能池** —— 与设置页列出的技能**同一个池**
 *   （用户要求："只是可选技能是一样的"）。不在池里的 id 一律丢弃。
 * @returns 校验后的槽位表（**下标 = 槽位号**，`''` = 空槽位，末尾空槽已裁）；
 *   **`undefined` = 没有可用的存档**，调用方据此走一次**迁移**。
 *
 * ⚠️ `undefined` 与 `[]` 是**两件事**，不能合并：
 *   `undefined` = 没存过 / 读不出来 → 该迁移
 *   `[]`        = 玩家**明确**把所有按钮都取下了 → 迁移会把它们全加回来 ✗
 *
 * ⚠️ **位置信息必须保住**（2026-10-12 起）：槽位就是位置，所以一条坏数据
 * 只能变成**那个槽位空着**（`''`），**不许把后面的整体前移** ——
 * 前移会让玩家摆好的位置整体错一格，而界面上看起来只是"少了一个按钮"。
 * 所以下面所有"丢掉这一条"的分支都写成 `out.push('')`。
 *
 * ⚠️ **整份**读不出来（坏 JSON / 不是数组）仍然当作"没存过"，交给迁移
 *   （比"清空玩家的按钮"温和，而且迁移结果正是那个坏存档想表达的东西）。
 */
export function parseTouchButtons(
  raw: string | null,
  validSkillIds: ReadonlySet<string>,
): readonly string[] | undefined {
  if (raw === null || raw === '') return undefined;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return undefined;
  }
  if (!Array.isArray(parsed)) return undefined;

  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of parsed) {
    if (typeof item !== 'string' || item === '') {
      out.push('');
      continue;
    }
    if (!validSkillIds.has(item)) {
      out.push('');
      continue;
    }
    /** 同一个技能不能占两个键位（手改存储很容易造出来）—— 后者留空。 */
    if (seen.has(item)) {
      out.push('');
      continue;
    }
    seen.add(item);
    out.push(item);
  }
  return trimTrailing(out);
}

/** 末尾的空槽位不存（与 `input/touchLayout.trimTrailingSlots` 同一条规则）。 */
function trimTrailing(slots: readonly string[]): readonly string[] {
  let end = slots.length;
  while (end > 0 && slots[end - 1] === '') end -= 1;
  return end === slots.length ? slots : slots.slice(0, end);
}

/**
 * 序列化触屏键位表。
 *
 * ⚠️ 与旧格式（技能 id 数组）**同一个形状**：旧存档里没有空串，读出来就是
 * "0..n-1 号槽位各一个技能"，所以**不需要迁移**（用户明确要求尽量不动存储）。
 * 新写的存档可能带空洞：`["attack","","guard"]` = 1 号键位空着。
 */
export function serializeTouchButtons(slots: readonly string[]): string {
  return JSON.stringify(trimTrailing(slots));
}

/**
 * 触屏按钮集合的**加载结果**：最终集合 + 这次是不是走了迁移。
 *
 * `migrated` 让调用方知道"要不要写回存储"（迁移只做一次，见下）。
 */
export interface TouchButtonsLoad {
  readonly skillIds: readonly string[];
  /** `true` = 存储里没有可用存档，这次是从 `legacySkillIds` 迁移出来的。 */
  readonly migrated: boolean;
}

/**
 * **加载触屏按钮集合**：校验 + **老存档迁移一次**。
 *
 * ==================================================================
 * 为什么要迁移（2026-10-12）
 * ==================================================================
 *
 * 需求："老玩家（如果之前靠绑键盘键获得过触屏按钮）**第一次加载时从旧的
 * 派生结果初始化一次**，否则他们的按钮会突然消失。"
 *
 * 迁移来源由调用方算好传进来（`legacySkillIds`，= "老存档里那些有键的
 * 技能"）—— 这样本模块**不认识**那个派生函数，也就不会再有人拿它当
 * 运行期的真相源（见 `input/touchLayout.ts` 文件头）。
 *
 * ⚠️ **只在没有可用存档时迁移**：
 *   - 存过（哪怕存的是 `[]`）→ 用存档，**绝不回读派生**
 *     （否则"玩家把所有按钮都取下了"会被迁移悄悄加回来）
 *   - 没存过 / 读不出来 → 迁移，并由调用方**写回**，下次走常规路径
 *
 * ⚠️ 迁移结果也要按池子过滤：老的绑定表可能含池外 id（Boss 技 / 派生技），
 * 而设置页根本给不出它们。
 */
export function loadTouchButtons(
  raw: string | null,
  validSkillIds: ReadonlySet<string>,
  legacySkillIds: readonly string[],
  /**
   * 槽位容量（= 双弧放得下的个数，`TOUCH_BUTTON_CAPACITY`）。
   *
   * ⚠️ **必须在这里截断**：超出的槽位没有任何位置可画
   * （`touchButtonCenter` 返回 `undefined`），留着就成了"存得下、
   * 用不上"的幽灵数据 —— 而玩家在设置页也看不到它们（预览只画 7 个）。
   */
  capacity: number,
): TouchButtonsLoad {
  const saved = parseTouchButtons(raw, validSkillIds);
  if (saved !== undefined) {
    return { skillIds: trimTrailing(saved.slice(0, capacity)), migrated: false };
  }
  return {
    skillIds: legacySkillIds.filter((id) => validSkillIds.has(id)).slice(0, capacity),
    migrated: true,
  };
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
      this.storage?.setItem(KEY_TOUCH_BUTTONS, '');
    } catch {
      /* 同上 */
    }
  }

  /**
   * 触屏按钮集合的原始字符串。
   *
   * ⚠️ 这里**不做解析** —— 校验走 `parseTouchButtons`（与
   * `uiScaleRaw` 交给 `parseUiScale` 同一条纪律：存取器只管存取的失败）。
   */
  get touchButtonsRaw(): string | null {
    return this.rawOf(KEY_TOUCH_BUTTONS);
  }

  /** 记住触屏按钮集合（顺序即槽位）。 */
  saveTouchButtons(skillIds: readonly string[]): void {
    try {
      this.storage?.setItem(KEY_TOUCH_BUTTONS, serializeTouchButtons(skillIds));
    } catch {
      /* 配额满 / 隐私模式：存不上就算了，不影响这一局 */
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
