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
 * ⚠️ 存储形状：**每个角色各一份**（2026-10-12 用户拍板）
 * ==================================================================
 *
 * 用户原话："**不同的人按键设置应该是分开的**"。
 *
 *   `raid.bindings.keyboard.<playerId>.v1`  桌面的键位表（键 → 技能）
 *   `raid.bindings.touch.<playerId>.v1`     触屏的键位表
 *   `raid.touchButtons.<playerId>.v1`       触屏**键位槽位**（技能 id 数组）
 *
 * 三条键**都按角色分** —— 用户说的是"按键设置"，而触屏那套也是按键设置，
 * 只分键盘那一份会让语义一半按角色、一半按全局。
 *
 * ⚠️ **切角色 = 换一整套键位**。这是本需求的**直接含义**：林晚风绑的键
 * 不会跟到凯丽身上。运行期的唯一写入点在 `app/playerKeys.ts`
 * （照 `app/operationMode.ts` 的样子：换一次角色要改哪几件事，一处说完）。
 *
 * ==================================================================
 * ⚠️ 为什么还要按**设备**分（键盘 / 触屏各一份）
 * ==================================================================
 *
 * 需求："分2个key哈 方便我用电脑测试"。同一台电脑上可以同时验证两套配置
 * —— 切到触屏模式读触屏那份、用键鼠读键盘那份，互不覆盖。否则调触屏时
 * 把键盘的设置冲掉，来回测很烦。
 *
 * ⚠️ 代价要清楚：同一个浏览器里**两端不再自动同步**（在桌面改的键位不会
 * 出现在触屏模式里）。这是有意的 —— 它换来的是"可以分别验证"。
 *
 * ⚠️ 触屏**键位槽位**（`raid.touchButtons.*`）也按角色分，但**不按设备分**
 * ——它本来就是"触屏那一套配置"，在电脑上配好、手机上打开就该在。
 *
 * ==================================================================
 * ⚠️ 触屏键位槽位与"键位表"是**两回事**（2026-10-12）
 * ==================================================================
 *
 * 用户原话："触屏和键盘**当然是 2 套**，连 localStorage 都是分 2 个 key
 * 存的，只是**可选技能是一样的**。"
 *
 * ⚠️ 这两份**互不派生**：触屏按钮不再是"有键的技能"（那会让没绑键的
 * 技能在触屏上永远上不了场，而触屏又进不去改键）。可选技能同一个池，
 * 选中子集各存各的。
 *
 * ==================================================================
 * ⚠️ 老存档（不按角色分的那一版）**迁移一次**
 * ==================================================================
 *
 * 老形状是**一份**（`raid.bindings.keyboard.v1` / `raid.bindings.touch.v1`
 * / `raid.touchButtons.v1`）。启动时把它**复制给当前选中的那个角色**，
 * 并**把老 key 消费掉**：
 *
 *   ```
 *   老 key 有一份 + 当前角色 = 凯丽   → 凯丽拿到它，老 key 被消费
 *   其余角色                          → 默认值（不是把老那份撒给所有人）
 *   ```
 *
 * ⚠️ **必须消费**（删除 / 置空）：只复制不消费的话，第二个角色第一次加载
 * 时也会读到那份老存档 —— 于是"我给凯丽改过"变成**假象**，正是用户
 * 明确否掉的那种结果（"其余角色给默认值"）。
 *
 * ⚠️ 迁移**只做一次**，做完之后运行期**再也不读**老 key
 * （`migrateLegacySettings` 是唯一读它们的地方，而且只从 `createGameDeps`
 * 调一次）。坏数据照既有纪律逐条丢弃 —— 迁移只搬**原始字符串**，
 * 真正的校验仍然走 `parseBindings` / `parseTouchButtons`。
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
import type { OperationMode } from '../render/platform';

/**
 * 存储键。
 *
 * ⚠️ 带**版本后缀**：以后结构变了就换 `v2`，老键自然作废 ——
 * 比在解析时猜"这是哪一版"可靠得多。
 *
 * ⚠️ **键名只有这里一处拼**（`bindingKey` / `touchButtonsKey`）。别处
 * 不许自己拼 `raid.bindings.…` —— 那正是"存储形状改了、有一处没跟着改"
 * 的来源，而它的表现是"改键没存上"这种最难查的一类 bug。
 */
/**
 * 设备形态 —— 决定读写哪一份键位。
 *
 * ⚠️ **就是** `render/platform.OperationMode`（全应用唯一的那个"键盘 /
 * 触屏"flag）。这里只转发这个**类型名**，不另立一个同形状的类型：
 * 两个名字会让人以为是两件事，于是迟早有人只改一处。
 */
export type InputMode = OperationMode;

/** 存储形状的版本号（进键名，见 `bindingKey`）。 */
const KEY_VERSION = 'v1';

/**
 * 某个角色、某种形态的**键位表**键名。
 *
 * 例：`raid.bindings.keyboard.kaili.v1`。
 */
function bindingKey(mode: InputMode, playerId: string): string {
  return `raid.bindings.${mode}.${playerId}.${KEY_VERSION}`;
}

/**
 * 某个角色的**触屏键位槽位**键名。
 *
 * 例：`raid.touchButtons.kaili.v1`。
 */
function touchButtonsKey(playerId: string): string {
  return `raid.touchButtons.${playerId}.${KEY_VERSION}`;
}

/**
 * ⚠️ **老存档**（按角色分之前的那一版）—— 只在 `migrateLegacySettings`
 * 那一次读，读完就消费掉。**别处不许读它们**（读了就会把"老配置"重新
 * 灌给别的角色，见文件头那段）。
 */
const LEGACY_BINDING_KEYS: Readonly<Record<InputMode, string>> = {
  keyboard: `raid.bindings.keyboard.${KEY_VERSION}`,
  touch: `raid.bindings.touch.${KEY_VERSION}`,
};
const LEGACY_TOUCH_BUTTONS_KEY = `raid.touchButtons.${KEY_VERSION}`;

const KEY_UI_SCALE = 'raid.uiScale.v1';
/**
 * **操作方式**（键盘 / 触屏）—— 用户自己在「通用」页切的，刷新后还记得。
 *
 * ⚠️ 它是**唯一 flag 的存档**（`?touch=1/0` 优先级更高，见
 * `render/platform.resolveOperationMode`）。
 */
const KEY_OPERATION_MODE = 'raid.operationMode.v1';
/** 上次选的人物 / 对手（备战界面用）。 */
const KEY_PLAYER = 'raid.pick.player.v1';
const KEY_BOSS = 'raid.pick.boss.v1';

/** 存储接口（注入以便测试，也为了在无 `localStorage` 时不炸）。 */
export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  /**
   * 删掉一个键。
   *
   * ⚠️ 迁移**消费**老 key 用（见 `migrateLegacySettings`）。写成**可选**：
   * 测试里的假存储、以及某些受限环境未必有它 —— 没有就退化成写空串，
   * 那也是"消费"（本模块一律把 `''` 当"没有存档"）。
   */
  removeItem?(key: string): void;
}

/**
 * 读一个键的原始字符串。
 *
 * ⚠️ `try` 收在**这一处**（`getItem` 在隐私模式 / 存储被禁用时会抛）。
 * 每个 getter 各写一遍 try 就是同一件事的第二份表达。
 */
function readRaw(storage: StorageLike | undefined, key: string): string | null {
  try {
    return storage?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

/** 写一个键（`setItem` 在配额满时抛 —— 那不该让游戏崩）。 */
function writeRaw(storage: StorageLike | undefined, key: string, value: string): void {
  try {
    storage?.setItem(key, value);
  } catch {
    /* 配额满 / 隐私模式：这次没存上，不影响这一局 */
  }
}

/**
 * 读"上次的操作方式"存档 —— 键名**只有这一处**。
 *
 * ⚠️ 独立函数而不是 `SettingsStore` 的方法：解析操作方式发生在
 * **构造 `SettingsStore` 之前**（那个对象要按模式读键位表），
 * 而键名属于本模块的知识，不该让调用方自己拼字符串。
 */
export function savedOperationMode(storage: StorageLike | undefined): string | null {
  return readRaw(storage, KEY_OPERATION_MODE);
}

/**
 * 读"上次选的人物"存档 —— 同样发生在构造 `SettingsStore` **之前**。
 *
 * ⚠️ 启动时**必须先知道是谁**才能决定读哪一份键位（键名里带 `playerId`），
 * 以及把老存档迁给谁。所以这个读法不能是 store 的方法。
 * 校验（可能是被删掉的角色）仍然交给 `data/roster.resolvePlayerId`。
 */
export function savedPlayerId(storage: StorageLike | undefined): string | null {
  return readRaw(storage, KEY_PLAYER);
}

/**
 * 把老 key **消费掉**（迁移只做一次）。
 *
 * 能删就删；没有 `removeItem` 就写空串 —— 本模块一律把 `''` 当"没有存档"，
 * 所以两种写法对 `parseBindings` / `parseTouchButtons` 是同一个意思。
 */
function consumeKey(storage: StorageLike, key: string): void {
  try {
    if (storage.removeItem !== undefined) storage.removeItem(key);
    else storage.setItem(key, '');
  } catch {
    /* 消费不掉 → 下次加载会再迁一次（迁移是幂等的：同样的输入给同样的结果） */
  }
}

/**
 * **老存档 → 当前角色**的一次性迁移（启动时调一次）。
 *
 * ==================================================================
 * 为什么是"复制给一个人 + 消费掉"而不是"复制给所有人"
 * ==================================================================
 *
 * 老形状只有**一份**配置。用户的要求是"不同的人按键设置分开"，
 * 而这一份属于**启动时选中的那个角色**（存档 `raid.pick.player.v1`）。
 * 其余角色拿**默认值**。
 *
 * ⚠️ 所以老 key 必须被**消费**：留着的话第二个角色第一次加载也会读到它
 * —— 表现成"凯丽的键位怎么跟我给林晚风改的一样"，正是要避免的假象。
 *
 * ⚠️ 三种键都迁（键盘键位 / 触屏键位 / 触屏槽位），**包括当前不是的那种
 * 形态**：老存档是一次性遗产，不能等玩家切到触屏才"顺便"分给谁 ——
 * 那时当前角色可能已经换人了。
 *
 * @returns 是否真的迁了东西（调用方/测试用；没有老存档时是 `false`）
 */
export function migrateLegacySettings(
  storage: StorageLike | undefined,
  playerId: string,
): boolean {
  if (storage === undefined) return false;

  /** 老 key → 这个角色的新 key；老 key 有东西时搬过去并消费。 */
  const move = (legacyKey: string, targetKey: string): boolean => {
    const legacy = readRaw(storage, legacyKey);
    if (legacy === null || legacy === '') return false;
    /** ⚠️ 新 key 已有值就不覆盖（迁移不该盖掉更新的东西）。 */
    const existing = readRaw(storage, targetKey);
    if (existing !== null && existing !== '') {
      consumeKey(storage, legacyKey);
      return false;
    }
    writeRaw(storage, targetKey, legacy);
    consumeKey(storage, legacyKey);
    return true;
  };

  let migrated = false;
  for (const mode of ['keyboard', 'touch'] as const) {
    if (move(LEGACY_BINDING_KEYS[mode], bindingKey(mode, playerId))) migrated = true;
  }
  if (move(LEGACY_TOUCH_BUTTONS_KEY, touchButtonsKey(playerId))) migrated = true;
  return migrated;
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
 * ⚠️ 写入包 `try`（收在 `writeRaw` 一处）：`setItem` 在配额满时会抛，
 * 而那不该让游戏崩 —— 最坏情况只是"这次改动没存上"。
 *
 * ⚠️ 它同时知道**两个坐标**：当前设备形态（键盘 / 触屏）与**当前角色**
 * ——键名由这两个一起决定（`bindingKey`）。两者都是可变的：
 * 切操作方式的唯一写入点在 `app/operationMode.ts`、切角色的在
 * `app/playerKeys.ts`。**别处不许自己拼 key**。
 */
export class SettingsStore {
  constructor(
    private readonly storage: StorageLike | undefined,
    /** 当前设备形态 —— 决定读/写哪一份键位。 */
    private modeValue: InputMode,
    /**
     * **当前出战角色** —— 键名里带它，所以"换角色"就是"换一整套键位"。
     *
     * ⚠️ 构造时就必须给：启动时"读哪一份键位"取决于存档里选的是谁
     * （`savedPlayerId` + `resolvePlayerId`），那发生在读键位**之前**。
     */
    private playerIdValue: string,
  ) {}

  /**
   * 当前形态（**可变**：用户可以在「通用」页把操作方式切过去）。
   *
   * ⚠️ 用取值函数而不是 `readonly` 字段：切换之后**同一份存储对象**
   * 要接着服务另一种形态（读那份键位、写那份键位）—— 重建一个 store
   * 会让"谁在什么时候换过"散到别处。
   */
  get mode(): InputMode {
    return this.modeValue;
  }

  setMode(mode: InputMode): void {
    this.modeValue = mode;
  }

  /**
   * 当前角色（**可变**）。
   *
   * ⚠️ 运行期**唯一**的写入点是 `app/playerKeys.switchPlayerProfile`
   * （换角色时要同时换掉键位表与触屏槽位，那三件事必须一起发生）。
   */
  get playerId(): string {
    return this.playerIdValue;
  }

  setPlayer(playerId: string): void {
    this.playerIdValue = playerId;
  }

  /** 当前角色 + 当前形态那一份键位（原始字符串）。 */
  get bindings(): string | null {
    return readRaw(this.storage, bindingKey(this.modeValue, this.playerIdValue));
  }

  saveBindings(bindings: readonly KeyBinding[]): void {
    writeRaw(
      this.storage,
      bindingKey(this.modeValue, this.playerIdValue),
      serializeBindings(bindings),
    );
  }

  /**
   * 清空**当前角色 + 当前形态**的键位（别的角色、另一种形态都不动）。
   *
   * ⚠️ 只清自己那一格：否则在触屏上点"恢复默认"会把你在电脑上配好的键盘
   * 设置也抹掉 —— 而"分开存"的全部意义就是不互相影响。
   */
  clearBindings(): void {
    writeRaw(this.storage, bindingKey(this.modeValue, this.playerIdValue), '');
  }

  /**
   * 清掉**当前角色**的全部已存设置 + 全局设置。调试/自救用。
   *
   * ⚠️ 不遍历所有角色（那要知道名单，而本模块是存储层、不认识 roster）
   * —— 它清的是"当前这个人 + 全局那几项"。
   */
  clearAll(): void {
    for (const mode of ['keyboard', 'touch'] as const) {
      writeRaw(this.storage, bindingKey(mode, this.playerIdValue), '');
      /** 老 key 也一并清掉：不然下次启动又会把老存档迁进来。 */
      writeRaw(this.storage, LEGACY_BINDING_KEYS[mode], '');
    }
    writeRaw(this.storage, touchButtonsKey(this.playerIdValue), '');
    writeRaw(this.storage, LEGACY_TOUCH_BUTTONS_KEY, '');
    writeRaw(this.storage, KEY_UI_SCALE, '');
    writeRaw(this.storage, KEY_OPERATION_MODE, '');
  }

  /**
   * 存档里的**操作方式**（原始字符串，交给
   * `render/platform.parseSavedMode` 校验 —— 存取器不做语义解析，
   * 与 `uiScaleRaw` / `playerIdRaw` 同一条纪律）。
   */
  get operationModeRaw(): string | null {
    return readRaw(this.storage, KEY_OPERATION_MODE);
  }

  /** 记住用户选的**操作方式**（刷新后接着用这一种）。 */
  saveOperationMode(mode: InputMode): void {
    writeRaw(this.storage, KEY_OPERATION_MODE, mode);
  }

  /**
   * **当前角色**的触屏键位槽位（原始字符串）。
   *
   * ⚠️ 这里**不做解析** —— 校验走 `parseTouchButtons`（与
   * `uiScaleRaw` 交给 `parseUiScale` 同一条纪律：存取器只管存取的失败）。
   */
  get touchButtonsRaw(): string | null {
    return readRaw(this.storage, touchButtonsKey(this.playerIdValue));
  }

  /** 记住当前角色的触屏键位槽位（顺序即槽位）。 */
  saveTouchButtons(skillIds: readonly string[]): void {
    writeRaw(
      this.storage,
      touchButtonsKey(this.playerIdValue),
      serializeTouchButtons(skillIds),
    );
  }

  /**
   * 上次选的人物 id（原始字符串，交给 `resolvePlayerId` 校验）。
   *
   * ⚠️ 与 `playerId`（**运行期**的当前角色）不是一回事：这个是**存档**里
   * 记的那一个，启动时用它决定读谁的键位。两者在启动那一刻相同，
   * 之后 `playerId` 会随备战界面换人而变。
   */
  get playerIdRaw(): string | null {
    return readRaw(this.storage, KEY_PLAYER);
  }

  /** 上次选的对手 id。 */
  get bossIdRaw(): string | null {
    return readRaw(this.storage, KEY_BOSS);
  }

  /** 记住这次的选择（备战界面用）。 */
  savePick(playerId: string, bossId: string): void {
    writeRaw(this.storage, KEY_PLAYER, playerId);
    writeRaw(this.storage, KEY_BOSS, bossId);
  }

  /** 原始字符串 —— 交给 `parseUiScale` 校验（不要在存取器里做数值解析）。 */
  get uiScaleRaw(): string | null {
    return readRaw(this.storage, KEY_UI_SCALE);
  }

  saveUiScale(value: number): void {
    writeRaw(this.storage, KEY_UI_SCALE, String(value));
  }
}
