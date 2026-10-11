import { BattleLoop } from './app/battleLoop';
import { createTouchControls, derivedOfSnapshot } from './app/touchControls';
import { wireCanvasPointer } from './app/canvasInput';
import { wireSettingsKeys } from './app/settingsKeys';
import { createSettingsToggle } from './app/settingsToggle';
import { buildSettingsOptions } from './app/settingsPanelOptions';
import { PrepareScreen } from './ui/PrepareScreen';
import { BOSS_ROSTER, PLAYER_ROSTER, resolveBossId, resolvePlayerId } from './data/roster';
import { PLAYER_BASE, makeBoss, makePlayer } from './data/units';
import { buildProbe, collectRuntimeErrors, emptyProbe } from './app/debugProbe';
import { prepareDebugApi, settingsDebugApi } from './app/debugApi';
import {
  SettingsStore,
  browserStorage,
  parseBindings,
  parseUiScale,
  type InputMode,
} from './app/settingsStore';
import { detectBrowserPlatform } from './render/platform';
/**
 * ⚠️ **静态导入 pixi，不要写 `await import('pixi.js')`。**
 *
 * 这里原先是个动态导入，想"延迟加载引擎"。但它**完全无效** ——
 * `render/icons.ts`、`ui/CastBar.ts`、`render/parts/playerActor.ts` 都
 * **值导入**了 pixi（`Assets` / `Sprite` / `Text`），打包器必然把它放进
 * 主 chunk。构建时 Vite 直接警告 `INEFFECTIVE_DYNAMIC_IMPORT`。
 *
 * 所以它唯一的效果是：多一层 `await` + 让人误以为"pixi 是按需加载的"。
 * 真要拆分就得把所有渲染模块都改成动态导入，那是另一件事。
 */
import { Application, Container, Graphics, Sprite, Text } from 'pixi.js';
import { slotsFromBindings } from './app/viewAdapter';
import { createRegistry } from './core/content/registry';
import {
  ALL_BUFFS,
  ALL_SKILLS,
} from './data/content';
import { type KeyBinding } from './input/keyboard';
import { flattenCatalog, translator } from './i18n/translator';
import { zhCN } from './i18n/locales/zh-CN';
import {
  LOGICAL_H,
  LOGICAL_W,
  UI_SCALE_MAX,
  UI_SCALE_MIN,
  clampUiScale,
  type ScalingMode,
} from './render/scaling';
import { observeStage } from './render/sizes';
import { BattleScene } from './render/BattleScene';
import type { StatKey } from './core/types';
import { SettingsButton } from './ui/settings/SettingsButton';
import { SettingsPanel } from './ui/settings/SettingsPanel';
import { createAssetsDecoder, setIconDecoder } from './render/icons';
import './styles.css';

/**
 * MVP 入口。
 *
 * 数据流（严格单向）：
 *   键盘 → Action → 引擎 tick → 事件 → view-model → Pixi 场景
 *
 * 渲染层**只读** view-model，从不反向调用引擎（架构规范 C3）。
 */

const SCALING_MODE: ScalingMode = 'fit';

/** 每场战斗的时限。超时判负。与 Boss 的 enrage 阈值一致。 */
const TIME_LIMIT_MS = 180_000;

async function bootstrap(): Promise<void> {
  const stage = document.querySelector<HTMLElement>('#stage');
  if (!stage) throw new Error('index.html is missing the #stage container');


    /** 注册 SVG 图标解码器（Pixi v8 里 `Texture.from(svg)` 拿不到图形）。 */
  setIconDecoder(createAssetsDecoder());

  const app = new Application();
  await app.init({
    width: LOGICAL_W,
    height: LOGICAL_H,
    resolution: 1,
    autoDensity: false,
    antialias: false,
    roundPixels: true,
    background: 0x0a0a0f,
  });
  stage.appendChild(app.canvas);

  /* ---------- 内容（校验通过才允许使用） ---------- */
  const registry = createRegistry(
    { entities: [], skills: [...ALL_SKILLS], buffs: [...ALL_BUFFS] },
    { localeKeys: new Set(flattenCatalog(zhCN).keys()) },
  );

  /* ---------- 场景 ---------- */
  const scene = new BattleScene({
    app,
    pixi: { Container, Graphics, Sprite, Text },
    translate: (key, params) => {
      try {
        return translator.t(
          key as Parameters<typeof translator.t>[0],
          params as Parameters<typeof translator.t>[1],
        );
      } catch {
        return key;
      }
    },
  });

  /* ---------- 一局战斗 ---------- */
  const startBattle = (): BattleLoop =>
    new BattleLoop({
      // 飘字要"闪躲"这种本地化文案 —— 注入取词函数，而不是让
      // ViewAdapter 去 import i18n 单例
      /**
       * ⚠️ **必须是 `translateSafe` 本身，不能套一层 `(key) => ...`**
       *
       * 需求（用户报告）："所有技能的消耗，在这里没了……"
       * 而修好取数之后，设置页里显示的是 **`{value} {resource}` /
       * `{seconds}` 这些占位符本身**。
       *
       * 根因就在这里：原先写的是 `(key) => translator.t(key)` ——
       * **把第二个参数 `params` 吃掉了**。TypeScript **不会报错**
       * （"参数更少的函数"本来就可以赋值给"参数更多的类型"），
       * 所以这个 bug 一路静默到界面上。
       *
       * 而 `settingsPanelOptions` 用的正是这个函数（`const t = d.translate`），
       * 于是设置页里**所有**带占位符的文案全部原样显示 ✗
       */
      translate: translateSafe,
      engineOptions: {
        /**
         * ⚠️ 出战单位来自**备战界面的选择**，不是写死的。
         * 目前各只有一个，所以工厂按 id 挑词表；加第二个单位时在这里扩。
         */
        combatants: [
          makePlayer(selection.playerId),
          makeBoss(selection.bossId, { noAi: params.get('noai') === '1' }),
        ],
        // 用真实时钟做种子：每次开局不同，但仍可复现（记录 seed 即可）
        seed: Date.now() >>> 0,
        bossId: selection.bossId,
        timeLimitMs: TIME_LIMIT_MS,
        buffs: registry.buffs,
        skills: registry.skills,
        baseStats: new Map<string, Partial<Record<StatKey, number>>>([
          [selection.playerId, PLAYER_BASE],
          [selection.bossId, {}],
        ]),
        passiveModifiers: new Map(),
      },
      bindings: bindings,
      /**
       * ⚠️ 传的是**基础槽位**：派生技（「击」）的槽位由 `ViewAdapter`
       * 每帧**插进来** —— 窗口开了才有、用掉就消失
       * （需求："用掉就消失了"）。适配器是唯一在读派生窗口的地方，
       * 在这里再求值一遍就会有两处真相。
       */
      slots: slotsFromBindings(bindings),
      timeLimitMs: TIME_LIMIT_MS,
      stopOnEnd: true,
      /**
       * ⚠️ **传 getter，不要传 `touch.input` 本身。**
       * 踩过的坑（实测）：`restartBattle()` 重建循环时漏了重新接线 →
       * **任何一次重开之后触屏永久断开**（Action 堆进没人 drain 的数组，
       * 按钮还在、点了没反应；键盘不受影响 → 表现成"只有触屏坏"）。
       * 传 getter 后接线只此一处；`touch` 虽在下面声明，但 getter 只在
       * 每帧被调用，那时它已初始化（无 TDZ）。
       */
      touchInput: () => touch.input,
    });

  /**
   * 键位表是**可变状态**，由设置界面修改。
   *
   * 放在这里而不是塞进 loop：`startBattle()` 每次重开都会重建 loop，
   * 而玩家的改键不该因为重开一局就被重置。
   */
  /**
   * **用户设置的持久化**（键位表 + UI 缩放）。
   *
   * ⚠️ 必须在 `startBattle()` **之前**定好键位表 —— 它决定战斗里的技能栏
   * 槽位与触屏按钮，晚一步就会先按默认跑一局。
   *
   * ⚠️ 用 `detectBrowserPlatform().touch` 而不是 `touch.caps.touch`：
   * 后者要等 `createTouchControls`（在下面），而 `SettingsPanel` 也是用
   * `detectBrowserPlatform()` 判定的 —— **同源，不会出现两套判定**。
   */
  const inputMode: InputMode = detectBrowserPlatform().touch ? 'touch' : 'keyboard';
  const settingsStore = new SettingsStore(browserStorage(), inputMode);
  const validSkillIds = new Set(registry.skills.keys());
  let bindings: readonly KeyBinding[] = parseBindings(settingsStore.bindings, validSkillIds);

  /**
   * ⚠️ **不再一启动就跑战斗**：先进备战界面（需求："选人物 和 选boss，
   * 然后点开始才开始"）。所以 `loop` 是惰性的 —— 进战斗时才建。
   *
   * 因为它是可选的，所有访问点都走 `battle()` 并容忍 `undefined`
   * （备战阶段调它们本该无害地什么都不做）。
   */
  let loop: BattleLoop | undefined;

  /** 当前阶段：备战界面 or 战斗中。 */
  let phase: 'prepare' | 'battle' = 'prepare';

  /**
   * **跳过备战界面直接进战斗**：`?prepare=skip`（端到端脚本用）。
   *
   * ⚠️ 用 URL 参数而不是"再加一个调试方法"：后者是**旁路**，而备战界面是
   * 真实入口的一部分（"点开始"本身也会坏）。走参数则与玩家同一条路。
   * ⚠️ 只有显式带这个参数才生效 —— 线上地址没有它，玩家路径一字未变。
   */
  const params = new URLSearchParams(globalThis.location.search);
  const skipPrepare = params.get('prepare') === 'skip';

  /**
   * `?boss=lust` —— 指定对手（截图 / 调试用）。
   *
   * ⚠️ 与 `?prepare=skip` 配合使用：`?prepare=skip&boss=lust` 直接开一局
   * 打色欲。单独给 `?boss=` 只在跳过备战时才有意义（否则备战界面会按
   * 存储里的选择走）。
   */
  const bossParam = params.get('boss');

  /** 当前选中的出战单位（备战界面的选择，进战斗时读到）。 */
  const selection = {
    playerId: resolvePlayerId(settingsStore.playerIdRaw),
    bossId: resolveBossId(settingsStore.bossIdRaw),
  };

  /**
   * 取当前战斗循环（备战阶段为 `undefined`）。
   */
  const battle = (): BattleLoop | undefined => loop;

  /**
   * 备战界面的「开始」回调。
   *
   * ⚠️ **可变引用 + 延后回填**：`enterBattle` 定义在下面（它要读
   * `selection`，而 `selection` 又要 `settingsStore`），但 `PrepareScreen`
   * 得先构造出来才能显示。这个转交点让定义顺序不再互相牵制。
   */
  let onPrepareStart: (playerId: string, bossId: string) => void = () => {};

  /**
   * 设置按钮此刻是否持有键盘焦点（`↑` 提上去、`↓` 退下来）。
   *
   * ⚠️ **先声明、后回填**：`wireSettingsKeys(...)` 在文件末尾才接线（那里
   * 依赖一堆已经构造好的对象），而备战界面的 keydown 处理定义在中间。
   * 默认 `false` 表示"还没接线 = 按钮没聚焦"，与真实状态一致。
   *
   * ⚠️ 为什么备战界面需要知道它：设置那边**不再**在备战界面抢 `↑`
   * （`acceptsKeyboardFocus` 只在战斗为真），但这条守卫仍然留着 ——
   * 如果哪天设置按钮又被允许在备战聚焦，按 Enter 会先开设置而不是
   * 确定角色，而那种 bug 在截图里看不出来（齿轮只是亮了一下）。
   */
  let settingsButtonFocused: () => boolean = () => false;

  /**
   * **界面切换时通知设置按钮**（它在两个界面里的位置不同）。
   *
   * ⚠️ 又是"延后回填"，原因和上面那条一样：`enterBattle` 可能在
   * `settingsButton` 构造**之前**就被调用（`?prepare=skip` 走的就是
   * 那条路，见下面 `if (skipPrepare)`），直接引用会撞 TDZ。
   */
  let onScreenChange: (screen: 'prepare' | 'battle') => void = () => {};

  /**
   * **进入战斗**：建一局新战斗、藏起备战界面。
   *
   * ⚠️ 与 `backToPrepare` 成对：两者各自负责好**场景 / 触屏层 / 面板**的
   * 显隐，任何一条路径漏掉一个开关都会出现"两个界面同时可见"。
   */
  const enterBattle = (playerId: string, bossId: string): void => {
    selection.playerId = resolvePlayerId(playerId);
    selection.bossId = resolveBossId(bossId);
    settingsStore.savePick(selection.playerId, selection.bossId);

    /**
     * ⚠️ **先换形象再开战**（需求：玩家与 Boss 都要播 idle / attack 动画）。
     *
     * 放在这里而不是 `BattleSceneOptions`：一局战斗的出战单位**在这里**
     * 才定下来，而场景只在启动时建一次（构造参数换不了）。同时它也覆盖
     * "重开换了个对手" —— 结算面板的 `restart` 也走本函数。
     */
    scene.setAppearance(selection.playerId, selection.bossId);

    loop?.dispose();
    loop = startBattle();
    phase = 'battle';
    prepare.setVisible(false);
    scene.root.visible = true;
    onScreenChange('battle');
  };
  onPrepareStart = (playerId: string, bossId: string): void => enterBattle(playerId, bossId);

  /**
   * 回到**备战界面**（而不是直接重开一局）。
   *
   * 需求："选人物 和 选boss，然后点开始才开始" —— 那"再来一次"自然也
   * 该先回备战，让玩家有机会换对手。
   */
  const backToPrepare = (): void => {
    loop?.dispose();
    loop = undefined;
    phase = 'prepare';
    prepare.setVisible(true);
    /**
     * ⚠️ 战斗场景直接改 `root.visible`；触屏层的显隐由 `touch.frame`
     * 每帧按 `isPrepareOpen()` 决定 —— 那里的**唯一写入点**不该被绕过。
     */
    scene.root.visible = false;
    settingsButton.update();
    onScreenChange('prepare');
  };

  const prepare = new PrepareScreen({
    pixi: { Container, Graphics, Sprite, Text },
    translate: translateSafe,
    players: PLAYER_ROSTER,
    bosses: BOSS_ROSTER,
    initial: { playerId: selection.playerId, bossId: selection.bossId },
    onStart: (playerId: string, bossId: string) => onPrepareStart(playerId, bossId),
    onChange: (playerId: string, bossId: string) => settingsStore.savePick(playerId, bossId),
  });
  app.stage.addChild(prepare.root);
  /**
   * ⚠️ 开局默认在**备战**：战斗场景先藏起来，否则会从备战界面下面露出来。
   */
  scene.root.visible = false;
  prepare.setVisible(true);

  /**
   * ⚠️ 放在 `prepare` 构造**之后**：`enterBattle` 会用到 `prepare.setVisible`，
   * 早一步调用会碰到 TDZ。
   */
  if (skipPrepare) enterBattle(selection.playerId, resolveBossId(bossParam ?? selection.bossId));

  /**
   * **UI 缩放**（设置里的 slider）。
   *
   * 它是"乘在自动适配之上的额外倍数" —— 所以 120% 在任意窗口下
   * 都是"比自动适配再大 20%"。改它之后要手动 `refresh()` 一次：
   * `ResizeObserver` 不会因为"视口尺寸没变"而重新回调。
   */
  const savedScale = parseUiScale(settingsStore.uiScaleRaw, UI_SCALE_MIN, UI_SCALE_MAX);
  let uiScale = savedScale ?? 1;
  const stageObserver = observeStage(stage, app.canvas, SCALING_MODE, () => {});

  /* ---------- 主循环 ---------- */
  app.ticker.add(() => {
    frameCount += 1;
    if (phase === 'prepare') {
      /**
       * 备战阶段：**不碰战斗**（`loop` 还没建出来）。场景与触屏按钮整块
       * 藏起来 —— 否则会从备战界面的透底处露出来。
       */
      prepare.frame();
      settingsButton.update();
      settings.update();
      return;
    }
    const l = battle();
    if (l === undefined) return; // 理论上到不了；防一手崩溃
    l.frame(performance.now());
    scene.update(l.snapshot, l.logEntries);
    /** 触屏按钮的文本要跟着快照更新（冷却数字会变）。 */
    touch.frame(l.snapshot);
    settingsButton.update();
    settings.update();
  });

  /* ---------- 重开 ----------
   * 战斗结束后：**键盘 Enter** 或 **触屏点屏幕** 都重开。
   *
   * ⚠️ 两条路径**共用这一个函数** —— 否则很容易出现"桌面能重开、
   * 触屏不行"这种只在一边坏掉的问题。 */
  window.addEventListener('keydown', (event) => {
    /**
     * **备战阶段的键盘操作**（需求："记得支持键盘和 移动"）。
     *
     * | 键 | 作用 |
     * |---|---|
     * | ← → | 在槽位里**移动光标**（不改选择） |
     * | ↑ ↓ | 换槽位（人物 → 对手 → 开始），两端停住 |
     * | Tab / Shift+Tab | 同上但**环绕**（Tab 的通用语义） |
     * | Enter | **确定**光标处的那一项；光标在「开始战斗」上时开战 |
     *
     * ⚠️ **移动光标 ≠ 确定选择**（需求原话："用 enter 来确定选择，
     * 而不是靠移动到下一项"）。旧的 `Enter` 直接 `prepare.start()`，
     * 而"选谁"是靠方向键移动带出来的 —— 现在方向键只动光标。
     *
     * ⚠️ `Tab` 必须 `preventDefault`：否则浏览器会把焦点移出画布
     * （架构规范 §7 明确要求拦下 Tab）。
     *
     * ⚠️ 设置面板打开时**不能抢键** —— 那时玩家可能正在改键，方向键是
     * 移动焦点的。`settingsToggle.isOpen()` 的优先级高于备战。
     */
    if (phase === 'prepare' && !settingsToggle.isOpen() && !settingsButtonFocused()) {
      switch (event.key) {
        case 'ArrowLeft':
          prepare.cycle(-1);
          return;
        case 'ArrowRight':
          prepare.cycle(1);
          return;
        case 'ArrowUp':
          prepare.moveFocus(-1);
          return;
        case 'ArrowDown':
          prepare.moveFocus(1);
          return;
        case 'Tab':
          /**
           * Shift+Tab 反向。与 ↑↓ 的区别只有**环绕**（Tab 的通用语义）——
           * 两端停住的话，在「开始战斗」上按 Tab 会毫无反应，而玩家对
           * Tab 的预期是"跳到下一个"。
           */
          prepare.moveFocus(event.shiftKey ? -1 : 1, true);
          event.preventDefault();
          return;
        case 'Enter':
          prepare.confirm();
          return;
        default:
          return;
      }
    }
    if (phase === 'battle' && event.key === 'Enter' && battle()?.engineState.snapshot.status !== 'running') {
      backToPrepare();
    }
  });

  /**
   * 调试探针：把战斗状态挂到 window，供端到端验证读取。
   *
   * 静态截图只能证明"渲染了一帧"，证明不了"战斗在推进"。
   * M7 起会被真正的调试面板与回放录制取代。
   */
  /** 捕获运行期异常，供端到端验证读取（否则会被静默吞掉）。 */
  const runtimeErrors = collectRuntimeErrors(window);

  let frameCount = 0;

  window.__raidBattle = {
    act: (skillId: string, actorId?: string) => {
      const l = battle();
      if (l === undefined) return;
      l.engineState.tick([{ type: 'useSkill', skillId, atTick: l.engineState.snapshot.tick }], actorId);
      l.engineState.drainEvents();
    },
    /**
     * 当前键位表（顶层探针）。
     *
     * 端到端脚本用它来"按某个技能" —— 而不是把键位写死在脚本里。
     * 踩过的坑：脚本原先硬编码 `1` / `4`，默认键位改成 QWER/ASDF 之后
     * 它就悄悄失效，报出来像是"战斗坏了"。
     */
    bindings: () => bindings.map((b) => ({ ...b })),
    /**
     * 把 Pixi stage 暴露出来。
     *
     * 用途：让验证脚本能读取**渲染层实际写进去的文本** ——
     * 只看截图无法区分"没画"和"画了但看不见"。
     */
    stage: app.stage,
    /**
     * 设定 UI 缩放（端到端脚本用）。
     *
     * 走的是设置面板的**同一条路径**（`onUiScale` → `scene.setUiScale`），
     * 所以它验证的就是真实行为，不是另一套旁路。
     */
    setUiScale: (value: number) => {
      uiScale = clampUiScale(value);
      scene.setUiScale(uiScale);
    },
    /**
     * 设置 / 备战两块调试入口。
     *
     * ⚠️ 抽到了 `app/debugApi.ts` —— 那里写着"为什么不另写一套逻辑"与
     * "为什么 headless 下必须读状态而不是看图"，不在这里重复。
     */
    ...settingsDebugApi(
      () => settings,
      () => settingsToggle,
      () => settingsButton,
    ),
    ...prepareDebugApi(prepare),
    /** 重开一局（端到端脚本用；见 `global.d.ts` 的说明）。 */
    restart: () => enterBattle(selection.playerId, selection.bossId),
    /** 触屏按钮圆心（端到端脚本用）。⚠️ 函数转调：`touch` 声明在下面（TDZ）。 */
    touchButtonCenter: (skillId: string) => touch.centerOfSkill(skillId),
    probe: () => {
      const l = battle();
      /** 备战阶段没有战斗可测：给一份零值快照，而不是 crash。 */
      if (l === undefined) return emptyProbe(frameCount, runtimeErrors);
      return buildProbe(l.engineState, l.snapshot, frameCount, runtimeErrors);
    },
  };

  /* ---------- 设置界面 ---------- */
  /**
   * 是否正在"由主监听器处理一次按键"。
   *
   * 用途：输入层与设置面板都会监听 `keydown`，需要避免同一次按键被
   * 两边各处理一遍（否则改键时技能会真的放出去）。
   */
  let handlingKeyDown = false;

  /**
   * 触屏预览的数据源持有者。
   *
   * ⚠️ 设置面板**必须先于** `touch` 构造（它要接收 `touch` 的能力值），
   * 但预览数据又来自 `touch.layout`。用一个**常量对象**当转交点：
   * `const` 符合 lint，且不依赖"首次渲染足够晚"这种隐含前提。
   */
  const touchPreviewSource: {
    read: () => readonly string[];
    showKeyHints: boolean;
  } = { read: () => [], showKeyHints: true };

  /**
   * 设置面板的选项装配（含"改键要同步到 loop / touch / 存储"）。
   * ⚠️ 抽到了 `app/settingsPanelOptions.ts`（见那里的"三处同步"说明）。
   */
  const settings = new SettingsPanel(
    buildSettingsOptions({
      registry,
      getBindings: () => bindings,
      setBindings: (next) => {
        bindings = next;
        battle()?.setBindings(bindings);
        touch.setBindings(bindings);
      },
      settingsStore,
      getUiScale: () => uiScale,
      setUiScale: (value) => {
        uiScale = clampUiScale(value);
        settingsStore.saveUiScale(uiScale);
        /**
         * ⚠️ **不重测画布**（`stageObserver.refresh()`）。
         *
         * 需求澄清过："我不是说缩放整个游戏画面，我是指，缩放游戏 UI，
         * 比如面板、技能图标等，战斗画面和战斗文字保持不变。"
         * 所以系数**只传给渲染层的 UI 部件**，画布尺寸照旧。
         */
        scene.setUiScale(uiScale);
      },
      snapshot: () => battle()?.snapshot,
      translate: translateSafe,
      getTouchSkills: () => touchPreviewSource.read(),
      getShowKeyHints: () => touchPreviewSource.showKeyHints,
      pixi: { Container, Graphics, Sprite, Text },
      close: () => settingsToggle.close(),
      capture: (handler) => battle()?.inputSource?.capture(handler),
      isHandlingKeyDown: () => handlingKeyDown,
    }),
  );
  app.stage.addChild(settings.root);

  const settingsButton = new SettingsButton({
    pixi: { Container, Graphics, Sprite, Text },
    translate: translateSafe,
    onClick: () => settingsToggle.toggle(),
  });
  app.stage.addChild(settingsButton.root);

  /**
   * 回填 `onScreenChange`，并**立刻按当前 phase 摆一次**。
   *
   * ⚠️ 必须补这次立即调用：`?prepare=skip` 时 `enterBattle` 早就跑过了，
   * 那一次的 `onScreenChange('battle')` 打在一个空函数上（当时还没回填），
   * 不补的话按钮会停在备战界面的右上角，压在战斗 HUD 上。
   */
  onScreenChange = (screen: 'prepare' | 'battle'): void => settingsButton.setScreen(screen);
  onScreenChange(phase);

  /**
   * 设置按钮是否被键盘选中。
   *
   * 需求是"几乎全键盘可操作"，所以设置**不能只能用鼠标点开**。
   * 进入方式有两条：
   *   - 按 `,`（单键直达）
   *   - 按 `↑` 把焦点提到按钮上，再 Enter
   */
  /**
   * 设置面板的开关（含"打开时暂停 / 关闭时恢复原状"的状态机）。
   *
   * ⚠️ 抽到了 `app/settingsToggle.ts` —— 那里写着"为什么要暂停"与
   * "为什么不能无脑恢复"，不在这里重复。
   */
  const settingsToggle = createSettingsToggle({
    settings,
    settingsButton,
    isPaused: () => battle()?.isPaused ?? false,
    setPaused: (value) => battle()?.setPaused(value),
  });

  /* 鼠标：canvas 里自己算坐标（不做逐对象事件绑定，便于测试驱动） */
  /** 把一次指针事件换算成逻辑坐标。 */
  /** 触屏控件（能力探测 + 布局 + 输入源 + 双弧按钮层）。与键盘并存。 */
  const touch = createTouchControls({
    pixi: { Container, Graphics, Sprite, Text },
    translate: translateSafe,
    bindings,
    currentTick: () => battle()?.engineState.snapshot.tick ?? 0,
    isSettingsOpen: () => settingsToggle.isOpen(),
    /** 备战中触屏按钮也要藏（战斗场景整块隐藏）。 */
    isPrepareOpen: () => phase === 'prepare',
    /** 派生技从**快照**读（`ViewAdapter` 已经算好，带 `derivedFrom`）。 */
    derivedSkill: () => {
      const l = battle();
      return l === undefined ? undefined : derivedOfSnapshot(l.snapshot);
    },
  });
  touchPreviewSource.read = () =>
    touch.layout.current().map((b) => registry.skill(b.skillId)?.nameKey ?? b.skillId);
  touchPreviewSource.showKeyHints = touch.caps.showKeyHints;
  touch.setBindings(bindings);
  scene.setShowKeyHints(touch.caps.showKeyHints);
  settingsButton.setShowShortcut(touch.caps.showKeyHints);
  app.stage.addChild(touch.layer.root);

  /**
   * 画布指针接线（备战 / 结算点击 / 触屏按钮 / 设置）。
   *
   * ⚠️ 抽到了 `app/canvasInput.ts` —— 那里集中写着"顺序即优先级"的
   * 三条规则（都是实测踩出来的），不在这里重复。
   */
  wireCanvasPointer({
    canvas: app.canvas,
    prepare,
    settings,
    settingsButton,
    touch,
    phase: () => phase,
    settingsOpen: () => settingsToggle.isOpen(),
    openSettings: () => settingsToggle.open('keys'),
    battleEnded: () => loop?.engineState.snapshot.status !== 'running',
    backToPrepare,
  });

  /**
   * 设置相关的键盘处理。
   *
   * 用**捕获阶段**（第三个参数 `true`）：必须在输入层之前拿到按键，
   * 否则按 `,` 会被当成技能、按方向键会被战斗吃掉。
   */
  /**
   * 设置界面的键盘接线（`Esc` / `,` / `↑` / `Enter`）。
   *
   * ⚠️ 抽到了 `app/settingsKeys.ts` —— 那里写着"必须用捕获阶段"与
   * "弹窗打开时独占键盘"两条由来，不在这里重复。
   *
   * ⚠️ `acceptsKeyboardFocus` 只在**战斗**为真：备战界面里 `↑↓` 是
   * 换槽位的，不能被设置按钮抢走（那里 `Esc` / `,` 照样能开设置）。
   * 由来见 `settingsKeys.ts` 里那个方法的注释。
   */
  const settingsKeys = wireSettingsKeys({
    settings,
    settingsButton,
    settingsOpen: () => settingsToggle.isOpen(),
    acceptsKeyboardFocus: () => phase === 'battle',
    openSettings: () => settingsToggle.open('keys'),
    setHandling: (value) => {
      handlingKeyDown = value;
    },
  });
  /** 回填给备战界面的键盘处理（见上面那个 `let` 的说明）。 */
  settingsButtonFocused = settingsKeys.isButtonFocused;

  /** 统一的翻译入口（缺 key 时回退到 key 本身，而不是抛错）。 */
  function translateSafe(
    key: string,
    params?: Readonly<Record<string, string | number>>,
  ): string {
    try {
      return translator.t(
        key as Parameters<typeof translator.t>[0],
        params as Parameters<typeof translator.t>[1],
      );
    } catch {
      return key;
    }
  }

  stage.classList.add('ready');

  window.addEventListener('pagehide', () => {
    stageObserver.dispose();
    loop?.dispose();
  });

}

void bootstrap();
