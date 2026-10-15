/**
 * 全局扩展。
 *
 * 刻意把调试探针声明成 `| undefined`，强制调用方判空 ——
 * 生产构建里这段可能不存在。
 */

/**
 * ⚠️ 调试入口的 tab 类型**复用** `SettingsTab`（唯一真相），不在这里
 * 重抄一份字面量：面板现在有三个 tab（「通用 / 按键 / 触屏」），抄一份
 * 会让"验证脚本打不开第三页"这类漂移没人发现。
 * （本文件本来就是模块 —— 末尾有 `export {}` —— 所以 `import type` 安全。）
 */
import type { SettingsTab } from '../ui/settings/logic';

declare global {
  interface Window {
    /** 战斗探针：验证"战斗真的在推进" */
    __raidBattle?: {
      /**
       * 直接注入一个动作（调试用）。
       *
       * 存在的理由：headless 环境下 rAF 会被降频，所以"按键 → 等技能进冷却"
       * 这条路在自动验证里不可靠。这个入口让验证脚本能精确地把游戏推到
       * 某个状态（例如"某个技能正在冷却"）再截图。
       */
      act(skillId: string, actorId?: string): void;
      /**
       * 当前键位表（顶层探针）。
       *
       * 端到端脚本用它来"按某个技能"，而不是把键位写死在脚本里。
       */
      bindings(): readonly { readonly key: string; readonly skillId: string }[];
      /** 设定 UI 缩放（端到端脚本用） */
      setUiScale(value: number): void;
      /**
       * 重开一局（端到端脚本用）。
       *
       * ⚠️ 触屏 e2e 必须验证"重开之后触屏仍然生效"——那正是
       * "重开后触屏永久失效"那个 bug 的形态。没有这个入口，脚本只能
       * 等玩家被打死（~11 秒）才能触发重开。
       */
      restart(): void;
      /**
       * 触屏按钮的圆心（端到端脚本用；按 `skillId` 反查）。
       *
       * ⚠️ 让脚本问页面要几何，而不是复制一份 —— 否则布局一调，
       * 触屏测试就会静默失效。
       */
      touchButtonCenter(skillId: string): { readonly x: number; readonly y: number } | null;
      /** Pixi 根容器（调试用：读取渲染层实际写入的文本） */
      stage: unknown;
      /** 设置界面（调试用：headless 下模拟点击不可靠） */
      settings: {
        open(tab?: SettingsTab): void;
        close(): void;
        /** 用逻辑坐标点一下（验证命中测试与布局一致） */
        openIn(px: number, py: number): void;
        isOpen(): boolean;
        capturing(): string | undefined;
        focus(): { readonly zone: string; readonly index?: number };
        /**
         * 第 `index` 个**技能格**的圆心（逻辑坐标）。
         *
         * ⚠️ 验证脚本要注入**真实触摸**就必须知道坐标，而脚本**不许自己
         * 复制一份 `keyCellRect`**（布局一调就静默失效 —— "点空了"和
         * "功能坏了"看起来一模一样）。与 `touchButtonCenter` 同一个理由。
         */
        cellCenter(index: number): { readonly x: number; readonly y: number };
        /** 右下角第 `index` 个**键位**的圆心（越界为 `null`）。 */
        slotCenter(index: number): { readonly x: number; readonly y: number } | null;
        /** **触屏技能面**第 `index` 格（窗口内下标）的圆心。 */
        pickerCellCenter(index: number): { readonly x: number; readonly y: number } | null;
        trace(): readonly string[];
        /**
         * 打开/关掉**齿轮按钮**的键盘焦点并立刻重绘（截图用）。
         *
         * 存在的理由：按钮由主循环逐帧重绘，而 headless 下这局战斗
         * 3.5 秒就结束，之后没有帧 —— 聚焦后的外观拍不到。
         */
        setButtonFocused(focused: boolean): void;
        /** 齿轮按钮此刻是否持有键盘焦点。 */
        buttonFocused(): boolean;
        /**
         * **面板的缩放状态**：`uiScale` 是滑块上那个值，`panelScale` 是面板
         * **实际**用的系数。
         *
         * ⚠️ 两个数**不是**同一个 —— 竖向预算把面板钳在 `PANEL_SCALE_MAX`
         * （`ui/settings/settingsScale.ts` 文件头写着推导）。验证脚本两个都要
         * 断言：只报一个就分不清"滑块没生效"与"钳位生效了"。
         */
        panelScale(): { readonly uiScale: number; readonly panelScale: number };
        /**
         * 面板里的**可见文字**（字号 / 世界坐标 / 前 24 字）。
         *
         * ⚠️ 这是"字到底变大了没有"的唯一硬证据：截图上 1 与 1.35 的差别
         * 看不出来，而源码里那个 `scaledFont(...)` 也证明不了这一帧真的
         * 落成了那个值（字号是各部件在 `relayout()` 时写进 Pixi 的）。
         */
        panelText(): readonly {
          readonly text: string;
          readonly fontSize: number;
          readonly x: number;
          readonly y: number;
        }[];
        /** 面板外框 + 详情区矩形（"外框没动、没溢出画布"的判据）。 */
        panelLayout(): {
          readonly panel: { readonly x: number; readonly y: number; readonly w: number; readonly h: number };
          readonly detail: { readonly x: number; readonly y: number; readonly w: number; readonly h: number };
          readonly gridBottom: number;
          readonly hintTop: number;
        };
      };
      /**
       * 战斗探针：把"战斗里到底发生了什么"摊平成一条可读读数（**只读**，
       * 不推进 tick、不消费事件）。
       *
       * ⚠️ 字段分三类，取值时**别混**（逐字段说明在 `app/debugProbe.ts`）：
       *   - **活读数**（`tick` / `status` / `playerHp` / `playerDouqi` /
       *     `playerCasts` / `bossHp` / `bossCasts` / `frameCount` / `errors`）：
       *     每个 tick 都可能变
       *   - **基线**（`playerHpCap` / `bossHpCap`）：这一局的上限，整场不变
       *   - **渲染视图**（`skillCount` / `floatingCount`）：只有渲染层知道，
       *     每帧重建；`act()` 后下一次读会立刻重建
       *
       * ⚠️ `playerCooldowns` 的值是**剩余 tick 数**（`0` = 已可用，随 tick
       * **递减**），不是引擎里那个"下一次可用 tick"的绝对值 —— 后者施放一次
       * 之后就不再变，读起来像"冷却没在走"（误导过一个 agent）。
       */
      probe(): {
        /**
         * 这一场战斗的**种子**（基线；`-1` = 没有战斗）。
         *
         * ⚠️ B 的验收要用它：肉鸽里应当等于 `battleSeed(runSeed, position)`
         * （同一条 URL 跑两次 → 同一个数），而自由模式 / 直接单场每次都不同
         * （时钟兜底）。只看"结果不同"分不出是哪一支，所以这个读数是必要的。
         */
        seed: number;
        tick: number;
        status: string;
        playerHp: number;
        playerHpCap: number;
        playerDouqi: number;
        playerCooldowns: Record<string, number>;
        playerCasts: number;
        bossHp: number;
        bossHpCap: number;
        bossCasts: number;
        skillCount: number;
        floatingCount: number;
        frameCount: number;
        errors: string[];
      };
      /**
       * 备战界面（调试用）。
       *
       * ⚠️ 它存在的理由是"光标 ≠ 选择"这条需求**不能只靠截图验证**：
       * 画面上的区别是颜色，而"白框在哪张卡 / 金底在哪张卡"是渲染出来的 ——
       * 读取状态才是硬证据（截图只用来确认"确实看得分出来"）。
       *
       * 方法走的是界面自己的路径（同键盘 / 同点击），不是另写一套旁路。
       */
      prepare: {
        /**
         * 当前状态（选择 + 光标）。
         *
         * ⚠️ 2026-10-13（自由模式改造）`focus` 多了 `'qiji'`、`cursor` 多了
         * `qijiId`（炁机行），并加了 `freeQiji()` / `detail()` / `hover()`
         * 三个探针 —— 它们存在的理由都是"截图证明不了"：
         *   - `freeQiji()`：**开关态**的验收要读"哪几条开着"
         *   - `detail()`：截图能看出详情区有字，但"是**谁的**字"读不出来
         *   - `hover()`：headless 下模拟真实指针划过不可靠
         *
         * ⚠️ 2026-10-13 第二轮又加了 `expanded` / `expand()`：手风琴
         * "同时只展开一块"这件事**只拍图看不出来**（三张图各有一块展开，
         * 但"另外两块收起了吗"要靠这个读数）。
         */
        state(): {
          readonly playerId: string;
          readonly bossId: string;
          readonly focus: 'player' | 'qiji' | 'boss' | 'start';
          readonly expanded: 'player' | 'qiji' | 'boss';
          readonly cursor: {
            readonly playerId: string;
            readonly bossId: string;
            readonly qijiId: string;
          };
        };
        /** 当前开着哪几条炁机（激活集合；没开的 id 不出现）。 */
        freeQiji(): readonly string[];
        /** 详情区此刻显示的是哪一项（`undefined` = 没聚焦任何卡片）。 */
        detail(): { readonly kind: 'player' | 'qiji' | 'boss'; readonly id: string } | undefined;
        /**
         * 当前布局的**可点区域**（只读；截图脚本按它换算真实坐标）。
         *
         * ⚠️ 有了它，脚本就不必"复制一份几何"—— 那正是布局一调就静默
         * 失效的那类脆弱脚本（与 `touchButtonCenter` 同一个理由）。
         */
        hitAreas(): readonly {
          readonly kind: string;
          readonly id: string;
          readonly x: number;
          readonly y: number;
          readonly w: number;
          readonly h: number;
        }[];
        /**
         * **三块各自的滚动偏移**（只读）。
         *
         * ⚠️ 滚动位置在截图上看不出来（"排满"与"滚过一行"各一张图，但
         * 偏移是 0 还是 46 只有读数能证明）—— 与 `hitAreas()` 同一条理由。
         */
        scrollOffsets(): { readonly player: number; readonly qiji: number; readonly boss: number };
        /** 详情区此刻拿到的**画面模型**（只读；`undefined` = 没聚焦卡片）。 */
        detailModel(): unknown;
        /** 清空炁机激活（让截图 / 探针可复现）。 */
        resetQiji(): void;
        /** 同 ← →：**只移动光标**，不改选择。 */
        cycle(delta: number): void;
        /** 同 ↑ ↓ / Tab：换槽位（`wrap` 为真时环绕）。 */
        moveFocus(delta: number, wrap?: boolean): void;
        /**
         * 同 Enter：确定光标处那一项；光标在**炁机**上则**开 / 关**它；
         * 光标在「开始战斗」上则开战。
         */
        confirm(): void;
        /** 同点击卡片：移光标 + 确定（一步到位）。 */
        pick(kind: 'player' | 'boss', id: string): void;
        /** 直接把焦点放到某个槽位（截图用，省掉"按几次方向键"）。 */
        focusSlot(slot: 'player' | 'qiji' | 'boss' | 'start'): void;
        /** 展开某一块（手风琴；截图脚本一步摆出"炁机块展开"的画面）。 */
        expand(slot: 'player' | 'qiji' | 'boss'): void;
        /** 同鼠标划过某点：只影响详情区（不动光标）。 */
        hover(px: number, py: number): boolean;
      };
      /**
       * **首页**（默认入口；调试用）。
       *
       * 与 `prepare` 同源：headless 下模拟点击不可靠，截图脚本需要把界面
       * 推到某个状态再拍；每个方法都转调界面自己的方法，不是旁路。
       */
      home: {
        /** 光标停在第几个入口（0 = 肉鸽模式，1 = 自由模式）。 */
        state(): { readonly cursor: number };
        /** 同 ↑ ↓ / Tab：移动光标（`wrap` 为真时环绕）。 */
        moveFocus(delta: number, wrap?: boolean): void;
        /** 同 Enter：进入光标处的模式（**会真的切界面**）。 */
        confirm(): void;
      };
      /**
       * **选角色屏**（肉鸽模式的第一屏；调试用）。
       *
       * ⚠️ `state()` 的形状与 `prepare` 相同（共用同一套光标模型）；
       * `bossId` 恒为空串 —— 这一屏没有对手槽位。
       */
      characterSelect: {
        /**
         * ⚠️ 形状与 `prepare` 相同（共用一套光标模型），所以这里也带着
         * `'qiji'` / `qijiId` —— 而这一屏**到不了**那两个值（它没有炁机行）。
         * 同一个类型是**有意**的：调试脚本读状态的代码要两屏复用。
         */
        state(): {
          readonly playerId: string;
          readonly bossId: string;
          readonly focus: 'player' | 'qiji' | 'boss' | 'start';
          readonly cursor: {
            readonly playerId: string;
            readonly bossId: string;
            readonly qijiId: string;
          };
        };
        /** 同 ← → / Tab：**只移动光标**，不改已确定的角色。 */
        cycle(delta: number): void;
        /** 同 Enter：确定光标处的角色；能开始就开始一局（**会先进确认屏**）。 */
        confirm(): void;
        /** 一步到位：移光标 + 确定 + 开始（调试 / 截图脚本用，**先进确认屏**）。 */
        pick(id: string): void;
        /**
         * 同点击卡片**第一步**：只选中（不开局）—— 右侧详情跟着切。
         *
         * ⚠️ 玩家点卡片是"先选中、再点同一张才开局"（触屏没有 hover，
         * 不这么分就看不到别人的详情）—— 见 `ui/characterSelectLogic.tapCharacterIntent`。
         */
        select(id: string): void;
        /** 同鼠标划过：只影响右侧详情（不动光标）。 */
        hover(px: number, py: number): boolean;
        /** 详情区此刻显示的是哪一项（`undefined` = 没聚焦任何卡）。 */
        detail(): { readonly kind: 'player' | 'qiji' | 'boss'; readonly id: string } | undefined;
        /** 悬停那一项（`undefined` = 鼠标不在任何卡上）。 */
        hovered(): { readonly kind: 'player' | 'qiji' | 'boss'; readonly id: string } | undefined;
        /** 三张卡的**可点矩形**（只读；脚本按它换算坐标，别自己抄布局）。 */
        hitAreas(): readonly {
          readonly kind: string;
          readonly id: string;
          readonly x: number;
          readonly y: number;
          readonly w: number;
          readonly h: number;
        }[];
      };
      /**
       * **确认屏**（肉鸽每场战斗之前；2026-10-15）。
       *
       * ⚠️ 它是一次**只读确认**（两栏详情 + 「开始战斗」）：探针要能回答
       * "这一屏此刻画的是第几场、右栏是哪条炁机" —— 截图只能证明"有两栏字"。
       *
       * ⚠️ `info()` 的 `qijiId` 用 `null`（不是 `undefined`）：要跨
       * `Runtime.evaluate` 的 JSON 边界（`undefined` 在那里会被丢掉）。
       */
      runConfirm: {
        /** 这一屏此刻是否可见（验收"每场之前都到了这里"）。 */
        open(): boolean;
        /**
         * 这一屏此刻画的是哪一场（没有则为 `null`）。
         *
         * ⚠️ `qijiIds` 是**本局已选的全部**；空数组 = **第一场之前**
         * （那一行整块不画）—— 与"画了一行空块头"在截图上完全不同，
         * 所以它必须是结构化读数。
         */
        info(): {
          readonly position: number;
          readonly length: number;
          readonly bossId: string;
          readonly qijiIds: readonly string[];
        } | null;
        /** 焦点停在哪一站（Tab 的读数：`'qiji' | 'boss' | 'start'`）。 */
        focus(): 'player' | 'qiji' | 'boss' | 'start';
        /** 同 Enter / 点「开始战斗」（**会真的进战斗**）。 */
        start(): void;
      };
      /**
       * **选炁机屏 + 一局结束屏**（P3；调试用）。
       *
       * ⚠️ 存在的理由（截图证明不了的两件事）：
       *   1. "候选集合对不对"（解锁了哪些、**已经选过的那条在不在里面**）——
       *      尤其那两条反面验收："没到 3 次时它【不】出现"、"**选过之后它不再
       *      出现**"。截图上"少一张卡"与"画漏了一张"完全一样。
       *   2. "一局结束屏是哪一局"—— 通关 / 失败的文案长得像，位置与装备
       *      必须能从状态读。
       *
       * ⚠️ 一律**转调界面自己的方法**（与键盘 / 点击同一条路），不另写一套。
       */
      qiji: {
        /** 候选的炁机 id 列表（顺序 = 画出来的顺序）。 */
        candidates(): readonly string[];
        /** 光标下标。 */
        cursor(): number;
        /** 同 ← →：移光标。 */
        cycle(delta: number): void;
        /** 同 ↑ ↓ / Tab：换行（`wrap` 为真时环绕）。 */
        moveFocus(delta: number, wrap?: boolean): void;
        /** 同 Enter：选光标处那一个（**会真的生效并进确认屏**）。 */
        confirm(): void;
        /** 一局结束屏此刻是否可见。 */
        overviewOpen(): boolean;
      };
      /**
       * **一局肉鸽的账本**（P3；验收 `?runlen=N` 用）。
       *
       * ⚠️ 只读**观测**：`state()` 给的是 `RunState` 的一份 JSON 化拷贝
       *   （`order` / `position` / `status` / `unlocked` / `chosen` /
       *   `battleStats.battles`），`phases()` 给的是**相位序列**。
       *
       * 为什么需要它：`?runlen=2` 的验收要"贴出每场的相位 / 结果序列"，
       * 而截图只能证明"某一瞬间画了什么"——"走进过哪几屏、第几场赢了"
       * 只有这两份数据能回答。
       */
      run: {
        /** 当前一局的账本快照（没有进行中的一局时 `null`）。 */
        state(): {
          readonly runSeed: number;
          readonly playerId: string;
          readonly order: readonly string[];
          readonly position: number;
          readonly status: string;
          readonly unlocked: readonly string[];
          readonly chosen: readonly { readonly qijiId: string }[];
          readonly battles: readonly { readonly won: boolean; readonly flawless: boolean }[];
        } | null;
        /** 相位序列（每次 `applyPhase` 追加一条；**不清理**）。 */
        phases(): readonly string[];
      };
      /**
       * **返回箭头**（自由模式 / 选角色屏左上角；调试用）。
       *
       * 需求："肯定要加返回啊"，且**触屏必须有对等入口**
       * （AGENTS.md §3b：`Esc` 只有键盘按得出）。
       *
       * ⚠️ 箭头现在住在**那一屏自己的 `ScreenChrome`** 里（用户 2026-10-12：
       * "stage 上理论上不挂任何小组件"、"多个页面的齿轮，应该分别定义"），
       * 所以这几个读数取自**当前相位的那一屏**。首页与战斗那一屏没有箭头
       * —— `visible()` 为假、`bounds()` / `center()` 为 `null`。
       *
       * 验证"点得通"必须**真的点**：注入一个真实 `PointerEvent` 到
       * canvas 上，坐标由 `center()` 给（页面自己的几何，不是脚本抄一份）。
       */
      back: {
        /** 此刻是否可见（= 当前这一屏有返回箭头）。 */
        visible(): boolean;
        /**
         * 可点区域（含图标外侧的 `hitSlop` 外扩 —— 角标提示**不占**布局宽度）。
         *
         * ⚠️ `null` 而不是 `undefined`：要跨 `Runtime.evaluate` 的 JSON 边界
         * （`undefined` 在那里会被丢掉 —— "这一屏没有箭头"与"忘了返回值"
         * 长得一样）。与 `settings.slotCenter` 同一条约定。
         */
        bounds(): {
          readonly x: number;
          readonly y: number;
          readonly w: number;
          readonly h: number;
        } | null;
        /** 箭头中心的逻辑坐标 —— 注入点击时用它，别手写数字（没有则 `null`）。 */
        center(): { readonly x: number; readonly y: number } | null;
        /**
         * `Esc` 提示的**包围盒**（逻辑坐标；触屏隐藏时也仍然算得出来）。
         *
         * ⚠️ 提示的位置来自 `IconButton.iconHintPlacement` 的**一条全局
         * 规则**（左上角 = 图标左上角再往**左上**各偏一点，与按钮在画布哪个
         * 角无关）。这个读数是那条规则在**真实布局**下的证据 —— 截图只能看出
         * "看着像在角上"，看不出它有没有被画布边裁掉、也看不出两个按钮
         * 是不是同一条规则。
         */
        shortcutBounds():
          | { readonly x: number; readonly y: number; readonly w: number; readonly h: number }
          | null;
      };
      /**
       * **界面结构探针**（截图 / 验证脚本用）。
       *
       * ⚠️ 这一轮齿轮从"一个挂 stage 上的共享组件"改成**四个界面各自持有**
       * （用户："多个页面的齿轮，应该分别定义"、"stage 上理论上不挂任何小组件"），
       * 所以"每一屏的齿轮都在正确位置、都点得开设置"必须逐屏验 —— 这个入口
       * 给出每一屏的几何，配合 `RAID_SHOT_POINTER` 注入真实点击即可。
       *
       * ⚠️ 只读几何与标志位：**没有"点它"的方法**（那会是一条旁路）。
       */
      chrome(): {
        readonly phase: string;
        /** 当前这一屏的齿轮可不可见（四屏都该为真）。 */
        readonly gear: boolean;
        readonly gearBounds: {
          readonly x: number;
          readonly y: number;
          readonly w: number;
          readonly h: number;
        } | null;
        /**
         * 齿轮的**键位提示**（`F1`）包围盒（画布坐标）。
         *
         * ⚠️ "齿轮 + 提示在任何缩放系数下都不出画布"是本轮的硬验收，
         * 而画布下缘与背景同色 —— 只有这个数能证明它没被裁掉
         * （与 `back.shortcutBounds` 同一个读数）。
         */
        readonly gearShortcutBounds: {
          readonly x: number;
          readonly y: number;
          readonly w: number;
          readonly h: number;
        } | null;
        /** 当前这一屏的返回箭头（只有选角色 / 自由模式有）。 */
        readonly backBounds: {
          readonly x: number;
          readonly y: number;
          readonly w: number;
          readonly h: number;
        } | null;
        readonly gearFocused: boolean;
        /** 当前这一屏的边角控件的缩放系数（应等于 `uiScale`）。 */
        readonly chromeScale: number | null;
        readonly uiScale: number;
        /** `app.stage` 的直接子节点数（证明没有小组件挂在 stage 上）。 */
        readonly stageChildren: number;
      };
      /**
       * **复盘（战报）那层** + 当前的**输入归属**（调试 / 验证用）。
       *
       * ⚠️ 存在的理由：这次的 bug 是"复盘开着时 `↑↓` 被设置按钮吃掉"——
       * 只看截图分不清"键没生效"和"滚动到了尽头"。`layer()` 暴露
       * `inputRouter.activeInputLayer` 的结果（纯函数，判据只有一处），
       * 于是脚本能钉住"复盘开着 ⇒ 层是 `review` 而不是 `battle`"。
       */
      logReview: {
        /** 现在哪一层在接收键盘 / 指针（`battle` / `review` / `settings` / …）。 */
        layer(): string;
        /** 复盘此刻是否开着（一局结束且没被 `Space` 藏起来）。 */
        isOpen(): boolean;
        /** 滚动位置比例（0 = 最旧那行，1 = 最新那行）。 */
        pointerRatio(): number;
      };
    };
    /** 渲染侧探针：报告实际写到 Pixi 上的位置 */
    __raidProbe?(): {
      boxX: number;
      currX: number;
      prevX: number;
      snapX: number;
      simX: number;
      tick: number;
      snapshotTick: number;
    };
    __raidDebug?:
      | {
          probe(): {
            tick: number;
            steps: number;
            alpha: number;
            droppedMs: number;
            usingWorker: boolean;
            lastError: string | null;
            snapshotTick: number;
            demoX: number;
          };
        }
      | undefined;
  }
}

export {};

/**
 * Vite 的 `?raw` 后缀：把文件内容作为字符串导入。
 *
 * ⚠️ 运行时仍会做一次归一（见 `icons.ts` 的 `sourceOf`）——
 * 不同 Vite 版本对 `?raw` 的导出形态不一致（`string` 或
 * `{ default: string }`），所以类型声明只做到"可能是二者之一"，
 * 由代码里的类型守卫收窄，而不是用 `as` 断言（AGENTS.md §1）。
 */
declare module '*.svg?raw' {
  const content: string | { readonly default: string };
  export default content;
}
