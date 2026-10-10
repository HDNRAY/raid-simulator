import { BattleLoop } from './app/battleLoop';
import { DEFAULT_SLOTS } from './app/viewAdapter';
import { createRegistry } from './core/content/registry';
import { VERROT_BEHAVIORS } from './core/ai';
import {
  ALL_BUFFS,
  ALL_SKILLS,
  DOUQI_MAX,
  ENERGY_MAX,
  HP_MAX,
} from './data/content';
import { BOSS_HP_DISPLAY } from './data/entities/bossHp';
import { DEFAULT_BINDINGS, type KeyBinding } from './input/keyboard';
import { flattenCatalog, translator } from './i18n/translator';
import { zhCN } from './i18n/locales/zh-CN';
import {
  LOGICAL_H,
  LOGICAL_W,
  clampDevicePixelRatio,
  clampUiScale,
  type ScalingMode,
} from './render/scaling';
import { observeStage } from './render/sizes';
import { BattleScene } from './render/BattleScene';
import type { Combatant, StatKey } from './core/types';
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

/**
 * 玩家基础属性。
 *
 * 新刻度下**不需要**主属性参与伤害计算了 —— 6 个技能的伤害都是
 * 内容里写死的固定值（攻 10 / 轰 30）。所以这里只留最小的基础值，
 * 属性系统本身仍然可用（装备/增益可以往里加）。
 *
 * 缠回复**不走属性**：它是固定"每 0.1 秒 1 点"，
 * 由 `data/balance.ts` 的 `ENERGY_PER_LOGIC_TICK` 决定。
 */
const PLAYER_BASE: Partial<Record<StatKey, number>> = {
  strength: 10,
  agility: 10,
  intelligence: 10,
  spirit: 10,
};

/**
 * 资源上限。
 *
 * 需求：双方都是 100 血，缠与炁上限也是 100。
 *
 * **直接用展示刻度**（不再乘 `DISPLAY_SCALE`）：内容的伤害值
 * （攻 10 / 轰 30）本身就是展示刻度，两边同刻度才能对上 ——
 * 早期把血量乘了 10 而伤害没乘，结果 10 点伤害变成打掉 1 点血，
 * 一场战斗要按上百次。
 */
const PLAYER_CAPS = { hp: HP_MAX, energy: ENERGY_MAX, douqi: DOUQI_MAX };

/**
 * Boss 资源上限。
 *
 * 血量取值依据见 `data/entities/bossHp.ts` —— 那是实测出来的
 * （玩家 214 DPS vs Boss 66 DPS），不是拍脑袋定的。
 */
const BOSS_CAPS = { hp: BOSS_HP_DISPLAY, energy: 0, douqi: 0 };

function makePlayer(): Combatant {
  return {
    id: 'player',
    nameKey: 'hud.you',
    side: 'ally',
    caps: { ...PLAYER_CAPS },
    resources: { hp: PLAYER_CAPS.hp, energy: PLAYER_CAPS.energy, douqi: 0 },
    counters: {},
    basePrimary: { strength: 120, agility: 100, intelligence: 110, spirit: 100 },
    buffs: [],
    cooldowns: {},
    casts: [],
    uses: {},
    behaviors: [],
    alive: true,
  };
}

function makeBoss(): Combatant {
  return {
    id: 'meiichiro',
    nameKey: 'boss.name',
    side: 'enemy',
    caps: { ...BOSS_CAPS },
    resources: { hp: BOSS_CAPS.hp, energy: 0, douqi: 0 },
    counters: {},
    basePrimary: { strength: 400, agility: 200, intelligence: 300, spirit: 200 },
    buffs: [],
    cooldowns: {},
    casts: [],
    uses: {},
    behaviors: VERROT_BEHAVIORS,
    alive: true,
  };
}

async function bootstrap(): Promise<void> {
  const stage = document.querySelector<HTMLElement>('#stage');
  if (!stage) throw new Error('index.html is missing the #stage container');

  const { Application, Container, Graphics, Sprite, Text } = await import('pixi.js');

  /**
   * 注册 SVG 图标解码器。
   *
   * 图标源是 `src/render/icons/*.svg` 独立文件（Vite `?raw` 构建时内联），
   * 解码走 Pixi 的 `Assets`。
   *
   * ⚠️ 必须用 `Assets.load`：Pixi v8 的 `Texture.from(svg)`
   * 会返回 1×1 的 EMPTY 纹理（并警告"不在 Assets 缓存里"），
   * 因为 SVG 要先经资源系统光栅化。
   *
   * 必须在创建任何 `Icon` 之前注册 —— `SettingsButton` 在 bootstrap
   * 中构造，所以这行要放在它前面。
   */
  setIconDecoder(createAssetsDecoder());

  /**
   * **渲染分辨率 = 设备像素比**（需求："全屏看着糊"）。
   *
   * 之前写死 `resolution: 1` + `autoDensity: false`，而 canvas 的 CSS
   * 尺寸被放大到 1244×700 —— 于是 960×540 的一张图交给浏览器拉伸
   * 1.3×，在 DPR=2 的屏幕上等效 **2.6×**：只用了 39% 的物理像素。
   *
   * 现在把 DPR 交给 Pixi：它的 `resolution` 决定"1 个逻辑单位用几个
   * 物理像素画"，而 `app.screen` 仍是 960×540 逻辑单位 —— **世界坐标
   * 与所有布局一行没改**，只是采样变密了。
   *
   * ⚠️ `autoDensity` 保持 `false`：canvas 的 CSS 尺寸由
   * `observeStage` 统一管理（含 letterbox 留白），交给 Pixi 会互相覆盖。
   */
  const app = new Application();
  const effectiveDpr = clampDevicePixelRatio(window.devicePixelRatio);
  await app.init({
    width: LOGICAL_W,
    height: LOGICAL_H,
    resolution: effectiveDpr,
    autoDensity: false,
    /**
     * 开抗锯齿。原先关着是"像素风"的取舍，但现在分辨率上去了，
     * 锯齿主要出现在**文字与斜线描边**上，看着更糙。
     * 代价是填充率，钳住 DPR ≤ 2 之后可以接受。
     */
    antialias: true,
    roundPixels: false,
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
      translate: (key) => {
        try {
          return translator.t(key as never);
        } catch {
          return key;
        }
      },
      engineOptions: {
        combatants: [makePlayer(), makeBoss()],
        // 用真实时钟做种子：每次开局不同，但仍可复现（记录 seed 即可）
        seed: Date.now() >>> 0,
        bossId: 'meiichiro',
        timeLimitMs: TIME_LIMIT_MS,
        buffs: registry.buffs,
        skills: registry.skills,
        baseStats: new Map<string, Partial<Record<StatKey, number>>>([
          ['player', PLAYER_BASE],
          ['meiichiro', {}],
        ]),
        passiveModifiers: new Map(),
      },
      bindings: bindings,
      slots: DEFAULT_SLOTS,
      timeLimitMs: TIME_LIMIT_MS,
      stopOnEnd: true,
    });

  /**
   * 键位表是**可变状态**，由设置界面修改。
   *
   * 放在这里而不是塞进 loop：`startBattle()` 每次重开都会重建 loop，
   * 而玩家的改键不该因为重开一局就被重置。
   */
  let bindings: readonly KeyBinding[] = DEFAULT_BINDINGS;

  let loop = startBattle();

  /**
   * **UI 缩放**（设置里的 slider）。
   *
   * 它是"乘在自动适配之上的额外倍数" —— 所以 120% 在任意窗口下
   * 都是"比自动适配再大 20%"。改它之后要手动 `refresh()` 一次：
   * `ResizeObserver` 不会因为"视口尺寸没变"而重新回调。
   */
  let uiScale = 1;
  /**
   * 让 **Pixi 跟着重建 framebuffer**，把内部缓冲对齐到"CSS × DPR"。
   *
   * ⚠️ 这是"全屏糊"修复的**另一半**，很容易漏：只把 `resolution`
   * 交给 `app.init` 是不够的 —— canvas 的 `width`/`height` 属性由
   * Pixi 拥有，`applyStageSize` 只写 CSS。不显式 resize 的话，
   * 缓冲区会停在初始尺寸，而 `applyStageSize` 的断言会**当场抛错**
   * （"canvas backing size must be …"）。
   *
   * ⚠️ 每次都要调，不能只在尺寸变化时调：Pixi 的 `resize()` 内部有
   * `if (w === width && h === height) return` 的短路，只改 `resolution`
   * 后再调同尺寸会被它直接忽略。
   *
   * 传的是**逻辑尺寸** 960×540：Pixi 自己乘 `resolution` 得到缓冲区，
   * 所以世界坐标不变。
   */
  const syncRenderer = (): void => {
    /**
     * ⚠️ **不能调 `app.renderer.resize()`**。
     *
     * 它会经 `ViewSystem` 落到 canvas 元素上，把 CSS 尺寸也设成传入的
     * 逻辑尺寸 —— 于是 `observeStage` 刚算好的 1173×660 被覆盖回
     * 960×540（实测：`applyStageSize` 日志显示两次，最终样式是 960）。
     *
     * 直接调整**纹理源**：只重建 framebuffer，不碰任何 DOM 尺寸。
     * CSS 由 `observeStage` 独占（它还负责 letterbox 留白）。
     */
    app.renderer.view.texture.source.resize(LOGICAL_W, LOGICAL_H, effectiveDpr);
  };
  const stageObserver = observeStage(stage, app.canvas, SCALING_MODE, syncRenderer, effectiveDpr);
  syncRenderer();

  /* ---------- 主循环 ---------- */
  app.ticker.add(() => {
    frameCount += 1;
    loop.frame(performance.now());
    scene.update(loop.snapshot, loop.logEntries);
    settingsButton.update();
    settings.update();
  });

  /* ---------- 重开 ----------
   * 战斗结束后按 Enter 重开（而不是 R —— R 是技能键之一）。 */
  window.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && loop.engineState.snapshot.status !== 'running') {
      loop.dispose();
      loop = startBattle();
    }
  });

  /**
   * 调试探针：把战斗状态挂到 window，供端到端验证读取。
   *
   * 静态截图只能证明"渲染了一帧"，证明不了"战斗在推进"。
   * M7 起会被真正的调试面板与回放录制取代。
   */
  /** 捕获运行期异常，供端到端验证读取（否则会被静默吞掉）。 */
  const runtimeErrors: string[] = [];
  window.addEventListener('error', (event) => {
    runtimeErrors.push(String(event.message));
  });
  window.addEventListener('unhandledrejection', (event) => {
    runtimeErrors.push(`unhandled rejection: ${String(event.reason)}`);
  });

  let frameCount = 0;

  window.__raidBattle = {
    /**
     * 直接注入一个动作（调试用）。
     *
     * 存在的理由：headless 环境下 rAF 会被降频，所以"按键 → 等技能进冷却"
     * 这条路在自动验证里不可靠。这个入口让验证脚本能精确地
     * 把游戏推到某个状态（例如"某个技能正在冷却"）再截图。
     */
    act: (skillId: string, actorId?: string) => {
      loop.engineState.tick([
        { type: 'useSkill', skillId, atTick: loop.engineState.snapshot.tick },
      ], actorId);
      loop.engineState.drainEvents();
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
     * 设置界面的调试入口。
     *
     * 存在的理由：headless 环境下模拟鼠标点击不可靠（rAF 会被降频，
     * 而且 CSS 缩放 → 逻辑坐标的换算依赖真实布局）。这个入口让验证
     * 脚本能直接把界面推到某个状态再截图。
     */
    settings: {
      open: (tab: 'general' | 'keys' = 'keys') => openSettings(tab),
      close: () => closeSettings(),
      openIn: (px: number, py: number) => settings.hitTest(px, py),
      isOpen: () => settingsOpen,
      /** 正在等待按键改键的技能 id（没有则为 null）。 */
      capturing: () => settings.capturingSkillId,
      /** 当前键盘焦点（调试用）。 */
      focus: () => settings.focusState,
      trace: () => [...settings.settingsTrace],
    },
    probe: () => {
      const state = loop.engineState.snapshot;
      const player = state.combatants.find((c) => c.side === 'ally');
      const boss = state.combatants.find((c) => c.side === 'enemy');
      const view = loop.snapshot;
      return {
        tick: state.tick,
        status: state.status,
        playerHp: player?.resources.hp ?? -1,
        playerHpCap: player?.caps.hp ?? -1,
        playerDouqi: player?.resources.douqi ?? -1,
        playerCooldowns: player?.cooldowns ?? {},
        playerCasts: player?.casts.length ?? -1,
        bossHp: boss?.resources.hp ?? -1,
        bossHpCap: boss?.caps.hp ?? -1,
        bossCasts: boss?.casts.length ?? -1,
        skillCount: view.skills.length,
        floatingCount: view.floatingText.length,
        frameCount,
        errors: [...runtimeErrors],
      };
    },
  };

  /* ---------- 设置界面 ---------- */
  /**
   * 是否正在"由主监听器处理一次按键"。
   *
   * ------------------------------------------------------------------
   * 为什么必须有这个标记（一个真实的重入 bug）
   * ------------------------------------------------------------------
   *
   * 一次 keydown 会经过**两个**监听器：本监听器（捕获阶段）和输入层
   * （冒泡阶段）。而本监听器在改键时会调用 `SettingsPanel.handleKey`，
   * 后者进入改键模式后**当场**把捕获回调注册给输入层 —— 于是输入层
   * 在同一次事件里发现"已有捕获回调"，把**触发改键的那一次按键本身**
   * 喂给了 `finishCapture`：一次 Enter 同时完成了"进入改键"和
   * "把技能绑成 Enter"。堆栈证实过这条路径：
   *
   *   onKeyDown → handleKey → activateFocus → startCapture
   *             → （回到 onKeyDown）→ 捕获回调 → finishCapture
   *
   * 修法是在**这一层**标记"这次按键已经被我处理"，让输入层跳过它。
   * 放在这里而不是 `SettingsPanel` 里，是因为重入发生在这两个
   * 监听器之间 —— 组件本身无从知道自己是被谁调用的。
   *
   * 早期我在组件里用时间戳（"同一瞬间的按键忽略"）绕过这个问题，
   * 但那是**用阈值猜事件归属**：它同时会误判玩家的真实连按，
   * 而且让"改键要按两次键"这种怪行为变得难以解释。
   */
  let handlingKeyDown = false;

  const settings = new SettingsPanel({
    pixi: { Container, Graphics, Sprite, Text },
    translate: (key) => translateSafe(key),
    getRows: () =>
      bindings.map((b) => {
        const skill = registry.skill(b.skillId);
        const hintTags = skill.hintTags;
        /**
         * 详情区的数据。
         *
         * ⚠️ 代价与冷却**优先复用视图层已经算好的那套**
         * （`loop.snapshot.skills`，含「防」的按住消耗换算）。
         * 如果在这里重算一遍，两处的文案迟早会不一致
         * —— 这类"同一件事两个真相来源"的问题很难查。
         */
        const slot = loop.snapshot.skills.find((x) => x.skillId === b.skillId);
        const costText =
          slot?.cost === undefined
            ? ''
            : translateSafe(slot.cost.suffix === undefined ? 'settings.detailCost' : 'settings.detailCostPerSecond', {
                value: Math.round(slot.cost.value),
                resource: translateSafe(`resource.${slot.cost.resource}`),
              });
        const cdText =
          slot === undefined || slot.skillCdSec <= 0
            ? ''
            : translateSafe('settings.detailCd', { seconds: Math.round(slot.skillCdSec) });
        return {
          skillId: b.skillId,
          nameKey: skill.nameKey,
          key: b.key,
          ...(skill.descKey === undefined ? {} : { descKey: skill.descKey }),
          ...(costText === '' ? {} : { costText }),
          ...(cdText === '' ? {} : { cdText }),
          ...(hintTags === undefined || hintTags.length === 0 ? {} : { hintTags }),
        };
      }),
    onRebind: (skillId, key) => {
      // 同一个键只能绑一个技能：先把旧占用者解绑，再绑新的
      bindings = bindings.map((b) =>
        b.skillId === skillId ? { ...b, key } : b.key === key ? { ...b, key: '' } : b,
      );
      loop.setBindings(bindings);
    },
    onResetKeys: () => {
      bindings = DEFAULT_BINDINGS;
      loop.setBindings(bindings);
    },
    /**
     * 把捕获回调包一层：**主监听器正在处理这次按键时直接跳过**。
     *
     * 否则那一次按键会被输入层重复投递，导致"一次按键进入改键并立刻
     * 完成绑定"（详见上面 `handlingKeyDown` 的说明）。
     */
    onCapture: (handler) =>
      loop.inputSource?.capture(
        handler === undefined ? undefined : (key) => {
          if (handlingKeyDown) return;
          handler(key);
        },
      ),
    onClose: () => closeSettings(),
    getUiScale: () => uiScale,
    onUiScale: (value) => {
      uiScale = clampUiScale(value);
      /**
       * ⚠️ **不重测画布**（`stageObserver.refresh()`）。
       *
       * 需求澄清过："我不是说缩放整个游戏画面，我是指，缩放游戏 UI，
       * 比如面板、技能图标等，战斗画面和战斗文字保持不变。"
       *
       * 所以缩放系数**只传给渲染层的 UI 部件**，画布尺寸照旧（自动适配）。
       * 之前那版调 `refresh()` 会把整个画面一起放大 —— 方向错了。
       */
      scene.setUiScale(uiScale);
    },
  });
  app.stage.addChild(settings.root);

  const settingsButton = new SettingsButton({
    pixi: { Container, Graphics, Sprite, Text },
    translate: (key) => translateSafe(key),
    onClick: () => toggleSettings(),
  });
  app.stage.addChild(settingsButton.root);

  let settingsOpen = false;
  /**
   * 设置按钮是否被键盘选中。
   *
   * 需求是"几乎全键盘可操作"，所以设置**不能只能用鼠标点开**。
   * 进入方式有两条：
   *   - 按 `,`（单键直达）
   *   - 按 `↑` 把焦点提到按钮上，再 Enter
   */
  let settingsFocused = false;
  /**
   * 打开设置前是否**本来就**处于暂停。
   *
   * 关闭设置时要恢复原状，而不是无脑 `setPaused(false)` ——
   * 否则"暂停中打开设置、关掉设置"会把玩家的暂停状态吞掉。
   */
  let pausedBeforeSettings = false;

  const openSettings = (tab: 'general' | 'keys' = 'keys'): void => {
    if (settingsOpen) return;
    settingsOpen = true;
    pausedBeforeSettings = loop.isPaused;
    // 打开设置必须暂停战斗 —— 否则玩家改键时会被 Boss 打死
    loop.setPaused(true);
    settings.open(tab);
  };
  const closeSettings = (): void => {
    settingsOpen = false;
    settings.close();
    // 恢复打开前的暂停状态
    loop.setPaused(pausedBeforeSettings);
  };
  const toggleSettings = (): void => {
    if (settingsOpen) closeSettings();
    else openSettings();
  };

  /* 鼠标：canvas 里自己算坐标（不做逐对象事件绑定，便于测试驱动） */
  /** 把一次指针事件换算成逻辑坐标。 */
  const pointerAt = (event: PointerEvent): { px: number; py: number } => {
    const rect = app.canvas.getBoundingClientRect();
    // CSS 尺寸 → 逻辑坐标（canvas 内部分辨率固定，靠 CSS 缩放）
    return {
      px: ((event.clientX - rect.left) / rect.width) * LOGICAL_W,
      py: ((event.clientY - rect.top) / rect.height) * LOGICAL_H,
    };
  };

  /**
   * 是否正在拖滑块。
   *
   * 需求："ui 缩放的 slider 还是要支持鼠标。"
   * 点一下就能调（`hitTest` 里按横坐标反算），而**拖动**需要额外
   * 记住"这次手势从滑块开始" —— 否则鼠标划过面板时也会一直改数值。
   */
  let draggingSlider = false;

  app.canvas.addEventListener('pointerdown', (event) => {
    const { px, py } = pointerAt(event);
    if (!settingsOpen) {
      if (settingsButton.hitTest(px, py)) openSettings();
      return;
    }
    const onSlider = settings.hitTest(px, py) && settings.isOnScaleSlider(px, py);
    draggingSlider = onSlider;
  });

  app.canvas.addEventListener('pointermove', (event) => {
    const { px, py } = pointerAt(event);
    /**
     * 拖滑块优先 —— 一次手势一旦从滑块开始，就不要再被悬停抢走。
     */
    if (draggingSlider) {
      settings.dragScaleSlider(px);
      return;
    }
    /**
     * 鼠标悬停到技能格 = **选中它**（需求："方向键选中和鼠标选中，
     * 应该合并"）。与方向键走同一条路径，所以高亮与详情完全一致。
     */
    settings.hoverSkill(px, py);
  });

  // 松开/离开画布就结束这次手势（否则会一直粘着）
  const endDrag = (): void => {
    draggingSlider = false;
  };
  app.canvas.addEventListener('pointerup', endDrag);
  app.canvas.addEventListener('pointerleave', endDrag);

  /**
   * 设置相关的键盘处理。
   *
   * 用**捕获阶段**（第三个参数 `true`）：必须在输入层之前拿到按键，
   * 否则按 `,` 会被当成技能、按方向键会被战斗吃掉。
   */
  window.addEventListener(
    'keydown',
    (event) => {
      const key = event.key.toLowerCase();

      if (settingsOpen) {
        handlingKeyDown = true;
        try {
          // 捕获模式下输入层会独占键盘（见 `InputSource.capture`），
          // 所以这里只需要把按键交给弹窗
          if (settings.handleKey(key)) event.preventDefault();
        } finally {
          handlingKeyDown = false;
        }
        return;
      }

      // 战斗中：`↑` 把焦点提到设置按钮，再 Enter 打开
      if (key === 'arrowup') {
        settingsFocused = true;
        settingsButton.setFocused(true);
        event.preventDefault();
        return;
      }
      /**
       * **Esc 直接打开设置**（需求）。
       *
       * 顺带暂停 —— `openSettings` 里会 `setPaused(true)`。
       * 旧行为是"Esc 切换暂停"，但那让玩家要先暂停、再按 `,`
       * 才能进设置，多一次操作；而且常见游戏习惯就是 Esc 进设置。
       */
      if (key === 'escape') {
        openSettings('keys');
        event.preventDefault();
        return;
      }
      if (key === 'arrowdown') {
        if (settingsFocused) {
          settingsFocused = false;
          settingsButton.setFocused(false);
          event.preventDefault();
        }
        return;
      }
      if (key === 'enter' && settingsFocused) {
        settingsFocused = false;
        settingsButton.setFocused(false);
        openSettings('keys');
        event.preventDefault();
        return;
      }
      /**
       * `,` 单键直达。
       *
       * 用 `event.code` 而不是 `event.key` 判断 —— `,` 在中文输入法下
       * 可能给出全角字符，而物理键位是稳定的。
       */
      if (event.code === 'Comma') {
        openSettings('keys');
        event.preventDefault();
      }
    },
    true,
  );

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
    loop.dispose();
  });

}

void bootstrap();
