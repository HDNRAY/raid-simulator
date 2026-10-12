/**
 * **`window.__raidBattle` 的装配**（调试 / 验证入口）。
 *
 * ==================================================================
 * 为什么单独一个文件
 * ==================================================================
 *
 * 这一段有一半是注释，另一半是"把闭包里的状态摊平成几个方法"。
 * 它在 `main.ts` 里是最不"主干"的一块 —— 玩家路径完全用不到它。
 *
 * ⚠️ **各入口一律走转调**（`settings.open()`、`prepare.confirm()` …），
 * 不另写一套逻辑：调试入口自己改状态就验证不到界面本身
 * （来龙去脉见 `app/debugApi.ts`）。
 *
 * ⚠️ **`onScreenChange` 的回填与那一次补调用必须在一起**（本函数末尾）：
 * `?prepare=skip` 时 `enterBattle` 早就跑过了，那一次的
 * `onScreenChange('battle')` 打在一个**空函数**上；不补的话齿轮按钮会停在
 * 备战界面的右上角，压在战斗 HUD 上。
 */

import {
  buildProbe,
  collectRuntimeErrors,
  emptyProbe,
  installRaidBattleApi,
} from './debugProbe';
import {
  characterSelectDebugApi,
  homeDebugApi,
  prepareDebugApi,
  settingsDebugApi,
} from './debugApi';
import { clampUiScale } from '../render/scaling';
import { backButtonCenter } from '../ui/ScreenControls';
import { settingsAnchorOf } from './flow';
import type { BattleLoop } from './battleLoop';
import type { GameState } from './flow';
import type { InputLayer } from './inputRouter';
import type { SettingsPanel } from '../ui/settings/SettingsPanel';
import type { SettingsButton } from '../ui/settings/SettingsButton';
import type { SettingsToggle } from './settingsToggle';
import type { HomeScreen } from '../ui/HomeScreen';
import type { CharacterSelectScreen } from '../ui/CharacterSelectScreen';
import type { PrepareScreen } from '../ui/PrepareScreen';
import type { TouchControls } from './touchControls';

/**
 * `window.__raidBattle` 的精确形状。
 *
 * ⚠️ 直接取自 `src/types/global.d.ts` 的全局声明 —— 这样"这里塞进去的
 * 对象"与"脚本读到的对象"由**同一份类型**约束，而不是各写一份再悄悄漂移
 * （`debugProbe.ts` 里的 `RaidBattleApi` 只是这个门面的一个子集说明）。
 */
type RaidBattleGlobal = NonNullable<Window['__raidBattle']>;

/** 探针与界面入口要读的那些东西。 */
export interface DebugApiDeps {
  readonly state: GameState;
  /** 场景（`setUiScale` 与面板滑块走同一条路）。 */
  readonly scene: {
    setUiScale(scale: number): void;
    /**
     * 复盘那一层（`logReview` 入口读它）。
     *
     * ⚠️ 只暴露 `isOpen` / `pointerRatio` 两个**只读**查询，不暴露"滚" ——
     * 那是一条旁路（脚本要滚必须注入真实按键 / 指针事件，走的才是玩家那条路）。
     * 与 `back` 的处理同一个道理（见那里"没有点它的方法"的说明）。
     */
    readonly logReview: {
      isOpen(): boolean;
      /** 滚动位置比例（0 = 第一行，1 = 最后一行；截图前后对比用）。 */
      pointerRatio(): number;
    };
  };
  /** Pixi 应用（探针 `stage` 暴露它的 `app.stage`）。 */
  readonly app: { readonly stage: unknown };
  readonly settings: SettingsPanel;
  readonly settingsButton: SettingsButton;
  readonly settingsToggle: SettingsToggle;
  /** 首页调试入口的目标。 */
  readonly home: HomeScreen;
  /** 选角色屏调试入口的目标。 */
  readonly select: CharacterSelectScreen;
  /** 备战界面（自由模式）调试入口的目标。 */
  readonly prepare: PrepareScreen;
  /**
   * 返回箭头（自由模式 / 选角色屏左上角）。
   *
   * ⚠️ 它只暴露**几何与可见性**，没有"点它"的方法 —— 那会是一条旁路。
   * 脚本要验证"点得通"必须注入真实 `PointerEvent`（坐标从 `center()` 拿），
   * 走的才是玩家那条路（见 `global.d.ts` 里 `back` 的说明）。
   */
  readonly back: {
    readonly visible: boolean;
    readonly bounds: { readonly x: number; readonly y: number; readonly w: number; readonly h: number };
  };
  /** 触屏按钮几何的唯一真相（`touchButtonCenter` 从它反查）。 */
  readonly touch: TouchControls;
  /** 重开一局（`restart` 从它走 `enterBattle`）。 */
  readonly restart: () => void;
  /**
   * **当前输入层** —— `inputRouter.activeInputLayer` 的活取值。
   *
   * ⚠️ 由调用方注入（而不是在这里自己拼判据）：那一份判据只能有一处，
   * 调试入口再拼一遍就成了"两份会漂的真相" —— 而这次的 bug 正是
   * "各模块各自拼一份"。
   */
  readonly layer: () => InputLayer;
}

/**
 * 装上 `window.__raidBattle`，并**补一次界面摆位**。
 *
 * ⚠️ 探针里凡是"指向活的战斗"的入口都走 `d.state.loop` —— 重开一局会
 * 换掉它，所以不能在这里快照一份。
 */
export function installDebugApi(d: DebugApiDeps): RaidBattleGlobal {
  const { state } = d;

  /**
   * 调试探针：把战斗状态挂到 window，供端到端验证读取。
   *
   * 静态截图只能证明"渲染了一帧"，证明不了"战斗在推进"。
   * M7 起会被真正的调试面板与回放录制取代。
   */
  /** 捕获运行期异常，供端到端验证读取（否则会被静默吞掉）。 */
  const runtimeErrors = collectRuntimeErrors(window);

  const battle = (): BattleLoop | undefined => state.loop;

  const api: RaidBattleGlobal = {
    act: (skillId: string, actorId?: string) => {
      const l = battle();
      if (l === undefined) return;
      l.engineState.tick(
        [{ type: 'useSkill', skillId, atTick: l.engineState.snapshot.tick }],
        actorId,
      );
      l.engineState.drainEvents();
    },
    /**
     * 当前键位表（顶层探针）。
     *
     * 端到端脚本用它来"按某个技能" —— 而不是把键位写死在脚本里。
     * 踩过的坑：脚本原先硬编码 `1` / `4`，默认键位改成 QWER/ASDF 之后
     * 它就悄悄失效，报出来像是"战斗坏了"。
     */
    bindings: () => state.bindings.map((b) => ({ ...b })),
    /**
     * 把 Pixi stage 暴露出来。
     *
     * 用途：让验证脚本能读取**渲染层实际写进去的文本** ——
     * 只看截图无法区分"没画"和"画了但看不见"。
     */
    stage: d.app.stage,
    /**
     * 设定 UI 缩放（端到端脚本用）。
     *
     * 走的是设置面板的**同一条路径**（`onUiScale` → `scene.setUiScale`），
     * 所以它验证的就是真实行为，不是另一套旁路。
     */
    setUiScale: (value: number) => {
      state.uiScale = clampUiScale(value);
      d.scene.setUiScale(state.uiScale);
    },
    /**
     * 设置 / 备战两块调试入口。
     *
     * ⚠️ 抽到了 `app/debugApi.ts` —— 那里写着"为什么不另写一套逻辑"与
     * "为什么 headless 下必须读状态而不是看图"，不在这里重复。
     *
     * ⚠️ 传**取值函数**而不是对象：设置面板与它的开关构造得比这里晚
     * （装配顺序使然），直接传引用会撞 TDZ。
     */
    ...settingsDebugApi(
      () => d.settings,
      () => d.settingsToggle,
      () => d.settingsButton,
    ),
    ...homeDebugApi(d.home),
    ...characterSelectDebugApi(d.select),
    ...prepareDebugApi(d.prepare),
    /**
     * 返回箭头（截图 / 触屏验证用）。
     *
     * ⚠️ `center()` 从**对象自己的几何**反推（`bounds` 是"含角落提示"的
     * 可点区域，箭头在它的左上角）—— 不让脚本抄一份坐标：布局一调，
     * 抄的那份就会静默指到别处（`SettingsButton` 的偏移注释记着同一个坑）。
     */
    back: {
      visible: () => d.back.visible,
      bounds: () => ({ ...d.back.bounds }),
      center: () => backButtonCenter(),
    },
    /** 重开一局（端到端脚本用；见 `global.d.ts` 的说明）。 */
    restart: () => d.restart(),
    /** 触屏按钮圆心（端到端脚本用）。 */
    touchButtonCenter: (skillId: string) => d.touch.centerOfSkill(skillId),
    /**
     * **输入归属 + 复盘状态**（验证脚本用）。
     *
     * ⚠️ 这两个读数合在一起才能证明"上下键归复盘"：
     *   - `layer()` = `review`（不是 `battle`）→ 键盘没被设置按钮抢走
     *   - `pointerRatio()` 变了 → 内容真的滚了
     * 只截一张图分不清"滚了"和"重新排版了"。
     */
    logReview: {
      layer: () => d.layer(),
      isOpen: () => d.scene.logReview.isOpen(),
      pointerRatio: () => d.scene.logReview.pointerRatio(),
    },
    probe: () => {
      const l = battle();
      /** 备战阶段没有战斗可测：给一份零值快照，而不是 crash。 */
      if (l === undefined) return emptyProbe(state.frameCount, runtimeErrors);
      return buildProbe(l.engineState, l.snapshot, state.frameCount, runtimeErrors);
    },
  };

  installRaidBattleApi(api);

  /**
   * 回填 `onScreenChange`，并**立刻按当前 phase 摆一次**。
   *
   * ⚠️ 必须补这次立即调用：`?prepare=skip` 时 `enterBattle` 早就跑过了，
   * 那一次的 `onScreenChange('battle')` 打在一个空函数上（当时还没回填），
   * 不补的话按钮会停在备战界面的右上角，压在战斗 HUD 上。
   *
   * ⚠️ 映射与 `game.ts` 走**同一个** `settingsAnchorOf`（`flow.ts`）：
   * 非战斗界面（首页 / 选角色 / 自由模式）都用右上角那个锚点。
   */
  state.onScreenChange = (screen) => d.settingsButton.setScreen(settingsAnchorOf(screen));
  state.onScreenChange(state.phase);

  return api;
}
