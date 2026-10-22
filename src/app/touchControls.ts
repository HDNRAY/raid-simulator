/**
 * 触屏接线：把平台能力、布局、输入源、按钮层串起来。
 *
 * ==================================================================
 * 为什么要单独一个文件
 * ==================================================================
 *
 * `main.ts` 已经 690+ 行（AGENTS.md §3 的上限是 700），而"触屏"这件事
 * 涉及四块东西：能力探测 / 布局（唯一真相）/ 输入源 / 按钮层。
 * 把它们堆进 `main.ts` 会立刻超限，而且那四块本来就是一个内聚的整体。
 *
 * 所以这里只留一个入口 `createTouchControls()`，`main.ts` 拿到的
 * 是三个动作：`handlePointer*`、`frame()`、`setShowKeyHints()`。
 *
 * ==================================================================
 * 点击路由：按钮优先，其次才是别的 UI
 * ==================================================================
 *
 * 触屏按钮画在 canvas 里，而设置按钮、设置面板、结算面板也都在
 * 同一个 canvas 上。所以**必须**有明确的优先级，否则"点技能按钮"
 * 会被"点结算面板"抢走（或反过来）。
 *
 * 这里定的优先级是：
 *
 *   1. 设置面板打开 → **它独占**（与键盘的捕获模式同理：
 *      玩家在改设置时不该把技能放出去）
 *   2. 触屏按钮命中 → 消费
 *   3. 其余交给调用方（设置按钮 / 结算重开 / …）
 *
 * ⚠️ 第 1 条不能少：设置面板自己也有"点面板外关闭"的逻辑，
 * 如果按钮优先，玩家在设置里点右下角会莫名其妙放一个技能。
 */

import type { PixiCtor } from './../ui/primitives';
import type { InputSource } from '../input/keyboard';
import { createTouchInput, type TouchHitArea, type TouchInputSource } from '../input/touchInput';
import {
  createTouchLayout,
  slotsFromButtons,
  type TouchButton,
  type TouchLayout,
} from '../input/touchLayout';
import {
  TouchButtonLayer,
  TOUCH_BUTTON_DIAMETER,
  touchButtonCenter,
} from '../render/touchButtonLayer';
import { capsOf, type OperationMode, type PlatformCaps } from '../render/platform';
import type { BattleSnapshotView, SkillSlotView } from '../render/viewModel';
import { withStaticSlots } from './touchStaticSlots';
import type { TranslateFn } from '../i18n/translator';

/**
 * 从快照里挑出**生效中的派生技**。
 *
 * ⚠️ 放在这里而不是 `main.ts`：`main.ts` 已经贴着 700 行上限
 * （AGENTS.md §3），而这个函数是触屏控件的一部分知识。
 */
export function derivedOfSnapshot(
  view: BattleSnapshotView,
): { readonly skillId: string; readonly sourceSkillId: string } | undefined {
  const slot = view.skills.find((s) => s.derivedFrom !== undefined);
  if (slot === undefined || slot.derivedFrom === undefined) return undefined;
  return { skillId: slot.skillId, sourceSkillId: slot.derivedFrom };
}

export interface TouchControlsOptions {
  readonly pixi: PixiCtor;
  readonly translate: TranslateFn;
  /**
   * **用户选的触屏键位表**（**下标 = 槽位号**，`''` = 空槽位）。
   *
   * ⚠️ 与**键盘绑定表无关**（用户 2026-10-12 推翻了原来的派生）：
   * 它来自设置页「按键」页右下角的模拟键位（点键位 → 点技能 → 绑定），
   * 存 `raid.touchButtons.<playerId>.v1`（**按角色分**，与键位表同一套坐标）。
   * 这里再按 `currentSkillIds`（这一局真的有的
   * 技能）过滤一次 —— 那是"别画出按不出东西的按钮"这条既有纪律，
   * 见下面 `buttonsOf`。
   */
  readonly touchSkillIds: () => readonly string[];
  readonly currentTick: () => number;
  /** 设置面板是否打开（打开时触屏按钮让出输入权）。 */
  readonly isSettingsOpen: () => boolean;
  /**
   * 现在是否**正在战斗**（非战斗时战斗场景整块隐藏，触屏按钮也要跟着藏）。
   *
   * ⚠️ 判据从"在备战界面"（原先叫 `isPrepareOpen`）改成"在战斗中"：
   * 现在有四个 phase（首页 / 选角色 / 自由模式 / 战斗），前三个都是
   * **整屏界面** —— 双弧按钮浮在上面会与卡片直接重叠（AGENTS.md §3b：
   * "触屏时整条技能栏都隐藏"是同一个道理）。写成"在战斗中"而不是列举
   * 那三个界面，是为了以后再加界面时**默认就是隐藏**。
   *
   * ⚠️ 放在这个每帧回调里而不是新开一个 `setVisible`：显隐的**唯一写入点**
   * 已经在这里（见 `frame` 的说明），再加一个写入点就会出现"两处都想控制
   * 可见性"的经典打架。
   */
  readonly isBattleActive: () => boolean;
  /**
   * 当前生效的派生技（没有则 `undefined`）。
   *
   * 需求："移动端则需要设计一下。" —— 派生技画成**原按钮上的角标环**，
   * 所以命中测试要知道"哪个按钮上现在挂着什么"。
   *
   * ⚠️ 由主循环从**快照**读（那是渲染层已经算好的），
   * 这里不自己去翻 buff —— 否则又是两处真相。
   */
  readonly derivedSkill: () => { readonly skillId: string; readonly sourceSkillId: string } | undefined;
  /**
   * **这一局真的有哪些技能**（引擎注册表里的 id 集合）。   *
   * ==================================================================
   * 为什么触屏按钮要按它过滤（2026-10-12）
   * ==================================================================
   *
   * 按钮集合来自**用户的选择**（整场游戏的技能池），但两个角色带的技能
   * 不一样 —— 凯丽**没有「防」也没有「避」**。不过滤的话她的双弧上会多出
   * 两个按下去什么都不发生的按钮（`skillRejected`），而玩家只会觉得是 bug。
   *
   * ⚠️ 判据取**引擎的**技能集（`BattleLoop.engineState.skillIds`），
   * 不是"再抄一份角色表"：引擎收到的技能表就是这一局的真相
   * （`battleSetup` 按角色从注册表取），所以两边**结构上不可能漂**。
   * 非战斗阶段（还没有 loop）返回 `undefined` = 不过滤。
   */
  readonly currentSkillIds: () => ReadonlySet<string> | undefined;
  /**
   * **当前操作方式**（唯一 flag，见 `render/platform`）。
   *
   * ⚠️ 是**取值函数**：用户可以在「通用」页把方式切过去，而触屏控件
   * （布局 + 按钮层 + 输入源）的生命周期比一局长得多 —— 传快照就会
   * 停在构造那一刻。
   */
  readonly mode: () => OperationMode;
  /**
   * **没上技能栏**的按钮要用的静态槽位（名字 / 代价 / 固有冷却）。
   *
   * ==================================================================
   * 为什么需要它（2026-10-12 实测踩到）
   * ==================================================================
   *
   * 按钮上的文字来自快照的 `skills`，而那张表只有**上了技能栏**的技能。
   * 触屏按钮现在可以是任何可选技能（包括没绑键的，那正是这次解开的死结），
   * 所以新放上去的按钮原先会画成一个**空圆**。
   *
   * ⚠️ 由调用方按**引擎注册表**造（`app/touchStaticSlots.ts`）——
   * 这里不自己去翻内容，与 `currentSkillIds` 走同一个来源。
   */
  readonly staticSlot: (skillId: string, index: number) => SkillSlotView | undefined;
}

export interface TouchControls {
  readonly layout: TouchLayout;
  readonly layer: TouchButtonLayer;
  /**
   * 触屏输入源。
   *
   * ⚠️ **总是建出来的**（即使当前是键盘方式）：操作方式是用户能在
   * 「通用」页切的东西，而"按下时再判"比"构造时判一次"少一条会漂的
   * 分支 —— 切到触屏之后不必重建控件。非触屏方式下
   * `onPointerDown` 直接返回 `false`（见那里），输入源拿不到事件。
   */
  readonly input: InputSource | undefined;
  /**
   * 处理一次按下。返回 `true` 表示**已被触屏按钮消费**，
   * 调用方不要再把它交给别的 UI。
   */
  readonly onPointerDown: (pointerId: number, px: number, py: number) => boolean;
  readonly onPointerUp: (pointerId: number) => void;
  readonly onPointerCancel: (pointerId: number) => void;
  /**
   * 每帧：**按当前 phase 决定显隐**；战斗中还要把快照推给按钮层（文本）。
   *
   * ⚠️ `view` 是可选参数：**非战斗阶段也会被调用**（那时没有快照），
   * 而显隐必须在那时也算一次 —— 否则按钮层会停在上一局的状态
   * （实测：触屏设备上首页 / 选角色屏右下角浮着双弧按钮）。
   * 见 `frame` 实现里"显隐的唯一写入点"那段说明。
   */
  readonly frame: (view?: BattleSnapshotView) => void;
  /**
   * **触屏键位表变了** → 布局跟着变（设置页右下角那组模拟键位改的就是它）。
   *
   * ⚠️ 参数是**用户选的技能 id**（不是键位表）：这是那条被推翻的派生
   * 关系的接口面 —— 只要它还收"绑定表"，就一定有人再把它当真相源。
   */
  readonly setButtons: (skillIds: readonly string[]) => void;
  /**
   * 按 `skillId` 反查按钮圆心（端到端脚本用）。
   *
   * ⚠️ 放在这里而不是 `main.ts`：几何的唯一真相是 `TouchLayout`，而它由
   * 本模块持有。脚本要是自己复制一份几何，布局一调就会静默失效。
   */
  readonly centerOfSkill: (skillId: string) => { readonly x: number; readonly y: number } | null;
  readonly dispose: () => void;
}

/**
 * 创建触屏控件。
 *
 * 非触屏方式下 `layer` 仍然是可用的空层（调用方不必到处判空）：
 * `layer.root.visible` 每帧都由 `frame()` 按**操作方式 + phase + 设置面板 +
 * 有没有按钮**重新判一次（见那里的"显隐的唯一写入点"）。
 */
export function createTouchControls(options: TouchControlsOptions): TouchControls {
  /**
   * ⚠️ `caps` 每次**现读**（不是构造期的快照）：操作方式是「通用」页能切
   * 的，切完之后按钮层 / 命中区 / 输入路由都要跟着变 —— 这正是"唯一 flag"
   * 的意思：没有第二处缓存它的地方。
   */
  const caps = (): PlatformCaps => capsOf(options.mode());
  /**
   * 按钮表 = **用户选的技能** ∩ 这一局真的有的技能。
   *
   * ⚠️ 抽成一处并在**构造**与 `setButtons` **两处都用**：两处各写一遍
   * 过滤，必然会出现"建局时对了、改完按钮后又漏回来"（见 `currentSkillIds`）。
   */
  /**
   * 槽位表 → 布局的按钮表（**槽位号原样保留**）。
   *
   * ⚠️ 抽成一处并在**构造**与 `setButtons` **两处都用**：两处各写一遍
   * 过滤，必然会出现"建局时对了、改完按钮后又漏回来"（见 `currentSkillIds`）。
   *
   * ⚠️ 过滤掉"这一局没有的技能"时**不能重排槽位**：`index` 用的是
   * 槽位下标（`slots.entries()` 给的），不是压缩后的序号 ——
   * 否则凯丽（少两个技能）的按钮会整体往内弧挤，与设置页预览对不上。
   */
  const buttonsOf = (slots: readonly string[]): readonly TouchButton[] => {
    const owned = options.currentSkillIds();
    const out: TouchButton[] = [];
    for (const [index, skillId] of slots.entries()) {
      if (skillId === '') continue;
      if (owned !== undefined && !owned.has(skillId)) continue;
      out.push({ index, skillId });
    }
    return out;
  };
  const layout = createTouchLayout(buttonsOf(options.touchSkillIds()));
  const layer = new TouchButtonLayer({
    pixi: options.pixi,
    translate: options.translate,
  });
  /**
   * 先按初始布局建一次按钮 —— 否则第一帧是空的，
   * 玩家会看到"按钮晚了一帧才出现"。
   *
   * ⚠️ 传的是**槽位表**（`slotsFromButtons`），不是 `map(b => b.skillId)`：
   * 后者会把空洞压掉，第 3 个键位上的技能就跑到第 2 个位置去了。
   */
  layer.setButtons(slotsFromButtons(layout.current()));
  /**
   * ⚠️ **构造期不写 `layer.root.visible`**（2026-10-13 收口）：显隐的
   * **唯一写入点**是下面的 `frame()` —— 它每帧都会跑到（`loopWiring` 的
   * 非战斗分支同样调它，见那里的说明），所以"构造 → 第一帧"之间没有
   * 需要补的窗口。按钮层自己的初值是 `visible = false`，第一帧就会按
   * 当前 phase / 操作方式算对。
   */

  /**
   * 命中区域由**按钮层**的几何算出来 —— 因为"按钮画在哪"只有它知道。
   *
   * ⚠️ 这里不缓存：用户随时可能增删按钮，缓存会让命中区域与画面脱节
   * （那正是"唯一真相"要避免的）。
   */
  const hitAreas = (): readonly TouchHitArea[] => {
    if (!caps().touch) return [];
    const buttons = layout.current();
    const radius = TOUCH_BUTTON_DIAMETER / 2;
    const derived = options.derivedSkill();
    return buttons
      .map((b) => {
        const center = touchButtonCenter(b.index);
        if (center === undefined) return undefined;
        const attached =
          derived !== undefined && derived.sourceSkillId === b.skillId
            ? derived.skillId
            : undefined;
        const area: TouchHitArea = {
          index: b.index,
          skillId: b.skillId,
          x: center.x,
          y: center.y,
          r: radius,
          /** 派生技挂在**源**按钮上（画成角标环）。 */
          ...(attached === undefined ? {} : { derivedSkillId: attached }),
        };
        return area;
      })
      .filter((a): a is TouchHitArea => a !== undefined);
  };

  /**
   * ⚠️ **总是建出来**（见 `TouchControls.input` 的说明）：操作方式是可切的，
   * 而"这一层能不能吃到事件"由 `onPointerDown` 里的 `caps().touch` 判定。
   */
  const input: TouchInputSource = createTouchInput({
    layout,
    currentTick: options.currentTick,
    hitAreas,
    isCapturing: options.isSettingsOpen,
  });

  /** 布局变化 → 按钮层跟着重画（"监听变化"的另一个落点）。 */
  const offLayout = layout.subscribe((buttons) => {
    layer.setButtons(slotsFromButtons(buttons));
  });

  return {
    layout,
    layer,
    input,

    centerOfSkill(skillId) {
      /** ⚠️ 用 `b.index`（槽位号），不是数组下标 —— 槽位可以空着。 */
      const button = layout.current().find((b) => b.skillId === skillId);
      return button === undefined ? null : (touchButtonCenter(button.index) ?? null);
    },
    onPointerDown(pointerId, px, py) {
      /**
       * 设置面板打开时**不放技能** —— 与键盘的捕获模式同理。
       * 见文件头的"点击路由"说明。
       */
      if (options.isSettingsOpen()) return false;
      /**
       * ⚠️ **键盘方式下触屏按钮不吃指针**：输入源现在是"总是建出来"的
       * （见 `TouchControls.input`），所以这道闸门必须在这里 ——
       * 否则键盘用户点画布会莫名其妙放出技能。
       */
      if (!caps().touch) return false;
      return input.pointerDown(pointerId, px, py);
    },

    onPointerUp(pointerId) {
      input.pointerUp(pointerId);
    },

    onPointerCancel(pointerId) {
      input.pointerCancel(pointerId);
    },

    frame(view) {
      /**
       * ⚠️ **显隐的唯一写入点**（2026-10-13 收口）。
       *
       * 收口之前这里写"按 phase 判"，而 `TouchButtonLayer.update()` 末尾
       * 又自己写了一句 `visible = buttons.size > 0` —— 两处各管一半。
       * 现在"该不该显示"**只在这里**判一次，按钮层只提供事实
       * （`layer.hasButtons()`），不再自己改 `visible`。
       *
       * 判据 = **四件事同时成立**：
       *   1. 当前是**触屏方式**（`caps().touch`；切回键盘要主动隐藏，
       *      因为切方式没有事件 —— 这一句删掉双弧就会一直留在屏幕上）
       *   2. 不在设置面板里（否则扇形会画在面板**上面**，实测穿透）
       *   3. **在战斗中**（首页 / 选角色 / 自由模式都是整屏界面，
       *      浮在上面会与卡片重叠）
       *   4. **真的有按钮**（这一条原先在 `update()` 里 —— 空的时候
       *      要隐藏，而不是画一个空的容器）
       */
      if (!caps().touch) {
        layer.root.visible = false;
        return;
      }
      /**
       * ⚠️ **非战斗的一切 phase 都隐藏按钮层**（首页 / 选角色 / 自由模式）。
       *
       * 那三屏都是**整屏界面**，双弧按钮浮在上面会与卡片直接重叠
       * （AGENTS.md §3b："触屏时整条技能栏都隐藏"是同一个道理；
       * 设计稿 §8.2 也点名要求按 `isBattleActive` 判）。
       *
       * ⚠️ 这条判断在**非战斗时也要跑到** —— 所以主循环的非战斗分支同样
       * 会调 `frame()`（不带快照）。这是实测踩出来的：触屏设备上首页
       * 右下角一直浮着六个圆按钮，因为原先只有战斗分支调 `frame`，
       * 而按钮层的初值是 `visible = caps.touch`。
       *
       * ⚠️ **设置面板打开时也隐藏**：否则扇形按钮会画在设置面板**上面**
       * （面板在 canvas 里居中，高 500，而按钮占 `y 284..508` 那片）——
       * 实测在设置页能看到六个圆按钮穿透出来，既难看又让人以为可以点。
       *
       * 放在这里（每帧判）而不是"打开时隐藏一次"：`settingsOpen` 与
       * `phase` 都没有变更事件，每帧读一次是最省事且不会漏的写法。
       */
      const hidden = options.isSettingsOpen() || !options.isBattleActive();
      layer.root.visible = !hidden && layer.hasButtons();
      if (hidden) return;
      /** 非战斗阶段不会有快照；真发生了就只更新显隐（防一手崩溃）。 */
      if (view === undefined) return;
      /**
       * ⚠️ **先补齐"没上技能栏"的按钮**，再推给按钮层 ——
       * 否则那些按钮会画成空圆（见 `staticSlot` 的说明）。
       */
      layer.update(
        withStaticSlots(
          view,
          layout.current().map((b) => b.skillId),
          options.staticSlot,
        ),
        /** ⚠️ 传 tick：按住时的呼吸用**战斗 tick**（与技能栏同一个函数），不用墙钟。 */
        view.tick,
      );
    },

    setButtons(skillIds) {
      /**
       * 用户选的按钮集合是唯一真相 —— 它变了两件事跟着变：
       *   1. `TouchLayout`（进而按钮层重画）
       *   2. 触屏输入源的合成 key 表
       *
       * ⚠️ **先按"这一局有哪些技能"过滤**（见 `currentSkillIds` 的说明）：
       * 集合是整场游戏的，而按钮只该出现这一局按得出来的技能。
       */
      layout.set(buttonsOf(skillIds));
      /**
       * `setBindings` 在触屏输入源里**不读参数**（按钮是从布局来的，
       * 不是"键 → 技能"的映射），但接口为了与键盘一致要求一个参数。
       * 传空数组，语义是"没有键盘绑定"。
       */
      input.setBindings([]);
    },

    dispose() {
      offLayout();
      input.dispose();
      layer.dispose();
    },
  };
}
