/**
 * **拍一张战斗截图**（UI 验证用）。
 *
 * ==================================================================
 * 用法
 * ==================================================================
 *
 *   node tools/shot.mjs /tmp/out.png            # 干净的一局
 *   node tools/shot.mjs /tmp/out.png break 3    # 每 300ms 放一次「破」，共 3 次
 *
 * ⚠️ 它**只拍图、只看图**，不做断言、不做长流程 —— 见 AGENTS.md §4。
 * 会断言像素的脚本就是又一个 e2e，而 e2e 已被删除（它反复卡住）。
 *
 * ⚠️ 开发服务器需在 <http://localhost:5273/>。默认用 `?prepare=skip`
 * 直接进战斗（跳过备战界面）；拍**备战界面**时把 URL 换掉：
 *
 *   RAID_SHOT_URL=http://localhost:5273/ node tools/shot.mjs /tmp/prepare.png
 *
 * ⚠️ 用环境变量而不是再写一个脚本：拍图流程只有一处，两份必然漂移。
 *
 * ==================================================================
 * `RAID_SHOT_KEYS`：截图前"按"几个键
 * ==================================================================
 *
 *   RAID_SHOT_URL=http://localhost:5273/ \
 *   RAID_SHOT_KEYS="ArrowRight,ArrowRight,Enter" \
 *   node tools/shot.mjs /tmp/prepare.png
 *
 * 逗号分隔，支持的键见下面 `KEYS` 表。用来把界面推到某个**键盘可达**的
 * 状态再拍（例如"光标在第 3 张卡、选择还在第 1 张"）。
 *
 * ⚠️ 走的是 **CDP 的真实按键**（`Input.dispatchKeyEvent`），不是
 * `dispatchEvent(new KeyboardEvent(...))` —— 后者 `isTrusted` 为假，
 * 而且绕过了浏览器默认行为（Tab 的焦点转移恰恰要靠默认行为来验证
 * `preventDefault` 有没有生效）。这里要测的正是"真的按键会发生什么"。
 *
 * ⚠️ 仍属于"拍一张图"的范畴：只按键 / 只注入一次指针 / 只截图，不做断言。
 *
 * ==================================================================
 * `RAID_SHOT_POINTER=x,y`：截图前注入一次**真实指针事件**
 * ==================================================================
 *
 * 逻辑坐标，逗号分隔。用途是验证"触屏 / 鼠标能点到的入口"真的点得通
 * （例如自由模式 / 选角色屏左上角的返回箭头 —— 那些功能不能只有键盘能用，
 * AGENTS.md §3b）。坐标可以从页面自己的调试入口拿
 * （`window.__raidBattle.back.center()`），别在脚本里手写布局数字。
 *
 * ==================================================================
 * ⚠️ 它必须**收干净**：Chrome 不许留下
 * ==================================================================
 *
 * 杀 Chrome 的纪律都收在 `tools/headlessChrome.mjs`（`bench.mjs` 共用同一份，
 * 两处各写一遍必然漂移）；这里只负责把它包进 `try/finally` 并装看门狗。
 * 一共四道防线，**缺一条就可能漏**：
 *
 *   1. `finally` —— 正常路径 / 抛错 / 提前返回都会走到
 *   2. **硬超时看门狗**（`RAID_SHOT_TIMEOUT_MS`，默认 60000ms）——
 *      到点**无条件**杀 + 退出（退出码 2）。⚠️ 脚本挂住时 `finally`
 *      **永远不执行**，所以这条才是关键：它保证脚本不可能永远挂着
 *   3. `exit` / `SIGINT` / `SIGTERM` / `unhandledRejection` 钩子
 *   4. 杀之后**确认**进程组消失（`SIGTERM` 对 Chrome 不一定够 → SIGKILL），
 *      不是 fire-and-forget
 *
 * 理由见 AGENTS.md §4：实测泄漏过一次（99 个 Chrome 进程、多个跑了近 3 小时、
 * 整机 load 24）。**脚本"挂住"不是"慢"，是"泄漏"。**
 */

import { writeFileSync } from 'node:fs';
import { startHeadlessChrome } from './headlessChrome.mjs';

const OUT = process.argv[2] ?? '/tmp/shot.png';
/** 要「放」的技能 id（`__raidBattle.act`），可给多个。 */
const SKILLS = process.argv.slice(3);
/** 要拍的页面地址（见文件头的用法）。 */
const PAGE_URL = process.env.RAID_SHOT_URL ?? 'http://localhost:5273/?prepare=skip';
/**
 * 截图前要按的键（`RAID_SHOT_KEYS`，逗号分隔）。
 *
 * `code` 用 `KeyX` 形式（布局稳定的物理键位），`text`/`key` 由 CDP 的
 * `key` 字段给出 —— 应用读的是 `event.key`，所以这里给的就是它读到的。
 * 未列出的键回落到它自己的名字（`ArrowLeft` 之类恰好通用）。
 */
const RAW_KEYS = (process.env.RAID_SHOT_KEYS ?? '')
  .split(',')
  .map((k) => k.trim())
  .filter((k) => k.length > 0);

const KEYS = {
  ArrowLeft: { code: 'ArrowLeft', key: 'ArrowLeft', vk: 37 },
  ArrowUp: { code: 'ArrowUp', key: 'ArrowUp', vk: 38 },
  ArrowRight: { code: 'ArrowRight', key: 'ArrowRight', vk: 39 },
  ArrowDown: { code: 'ArrowDown', key: 'ArrowDown', vk: 40 },
  Enter: { code: 'Enter', key: 'Enter', vk: 13 },
  Escape: { code: 'Escape', key: 'Escape', vk: 27 },
  Tab: { code: 'Tab', key: 'Tab', vk: 9 },
  'Shift+Tab': { code: 'Tab', key: 'Tab', vk: 9, modifiers: 8 },
  /**
   * `F1`（打开设置；P2 收尾时 `Esc` / `,` 换成了它）。
   *
   * ⚠️ `windowsVirtualKeyCode: 112` 是 VK_F1 —— CDP 要靠它把这次按键送到
   * 页面；给 0 的话某些浏览器路径会把它当未知键丢掉。
   */
  F1: { code: 'F1', key: 'F1', vk: 112 },
};
const PORT = 10103;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
/**
 * ⚠️ **硬超时**（`RAID_SHOT_TIMEOUT_MS`，默认 60000ms）：到点**无条件**
 * 杀掉 Chrome 并退出（退出码 2）。理由：`finally` 只在"流程能走到收尾"
 * 时有效，而实测的泄漏恰恰是流程**挂在收尾之前** —— 那时正常路径的 kill
 * 永远执行不到（见 AGENTS.md §4）。看门狗是唯一"卡在哪都能兜住"的机制。
 */
const TIMEOUT_MS = Number(process.env.RAID_SHOT_TIMEOUT_MS ?? 60_000);

/**
 * **杀 Chrome 的纪律全部收在 `tools/headlessChrome.mjs`**（两个起 Chrome 的
 * 脚本共用一份）：按**进程组**杀 + **确认**死亡 + 硬超时看门狗 +
 * `exit`/`SIGINT`/`SIGTERM`/`unhandledRejection` 四条退路钩子。
 *
 * ⚠️ 这里只做两件事：起它、并把它**包进 `try/finally`**。
 * ⚠️ 绝不"全机扫 `--headless` 再 kill" —— 那会误杀用户自己的浏览器。
 */
const chrome = startHeadlessChrome({ port: PORT, windowSize: '1280,760', label: 'shot' });
chrome.armGuards({ timeoutMs: TIMEOUT_MS });

try {
  let page;
  for (let i = 0; i < 60; i += 1) {
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/json/list`);
      const t = await r.json();
      page = t.find((x) => x.type === 'page' && x.webSocketDebuggerUrl);
      if (page) break;
    } catch {
      /* 还没起来 */
    }
    await sleep(200);
  }

  const ws = new WebSocket(page.webSocketDebuggerUrl);
  let id = 1;
  const pend = new Map();
  await new Promise((r) => ws.addEventListener('open', r));
  ws.addEventListener('message', (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pend.has(m.id)) {
      pend.get(m.id)(m.result);
      pend.delete(m.id);
    }
  });
  const send = (m, p = {}) =>
    new Promise((r) => {
      const i = id++;
      pend.set(i, r);
      ws.send(JSON.stringify({ id: i, method: m, params: p }));
    });

  await send('Runtime.enable');
  await send('Page.enable');
  /**
   * 可选：**伪装成触屏设备**（`RAID_SHOT_TOUCH=1`）。
   *
   * 用途：验证"触屏与键盘功能必须对等"（AGENTS.md §3b）的那几条路 ——
   * 页面的能力探测走 `matchMedia('(pointer: coarse)')`，桌面 headless 上
   * 它是假，所以"点屏幕离开战斗"这类**只在触屏生效**的分支测不到。
   * ⚠️ 只改媒体查询与 touch 支持，不改 UA（本仓库的能力探测不看 UA）。
   */
  if (process.env.RAID_SHOT_TOUCH === '1') {
    /**
     * 让页面的**能力探测**认为这是触屏设备。
     *
     * ⚠️ 做法是**在应用启动前**把 `window.matchMedia` 包装一层，只对
     * `pointer: coarse` / `hover: none` 两个查询返回 `matches: true`。
     * 理由：本仓库的探测本来就只看这两个媒体查询（`render/platform.ts`，
     * 刻意不看 UA），所以这是"照它自己的判据喂它"，不是旁路。
     *
     * ⚠️ 不用 CDP 的 `setTouchEmulationEnabled` / `setDeviceMetricsOverride`：
     * 它们会改掉事件模型，脚本后面注入的 `PointerEvent` 就到不了画布的
     * 监听器（实测：拖拽与点击全失效）。
     */
    await send('Page.addScriptToEvaluateOnNewDocument', {
      source: `(() => {
        const real = window.matchMedia.bind(window);
        window.matchMedia = (q) => {
          if (q === '(pointer: coarse)' || q === '(hover: none)') {
            return { matches: true, media: q, onchange: null,
              addListener() {}, removeListener() {},
              addEventListener() {}, removeEventListener() {}, dispatchEvent() { return false; } };
          }
          return real(q);
        };
      })();`,
    });
  }
  await send('Page.navigate', { url: PAGE_URL });
  /**
   * 页面加载后的**等待时长**（`RAID_SHOT_WAIT_MS`，默认 3400ms）。
   *
   * ⚠️ 默认值对应"一局 3.5 秒左右打完"那种快局。要看**结局之后**的界面
   * （例如复盘 / 结算）时，一局可能要十几秒 —— 那时把等待加长，
   * 而不是去写一个新的 e2e 脚本（AGENTS.md §4：这里只拍图）。
   */
  await sleep(Number(process.env.RAID_SHOT_WAIT_MS ?? 3400));
  await send('Page.bringToFront').catch(() => {});

  const ev = async (expr) => {
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true });
    return r.exceptionDetails ? `EXC ${r.exceptionDetails.text}` : r.result?.value;
  };

  /** 依次"放"给定的技能（每次间隔 300ms 让结算走完）。 */
  for (const skill of SKILLS) {
    await ev(`window.__raidBattle.act(${JSON.stringify(skill)})`);
    await sleep(300);
  }

  /**
   * 可选：截图前先跑一段**驱动脚本**（`RAID_SHOT_EVAL`）。
   *
   * 用途与 `settings.open()` 那类调试入口同源：把界面推到某个状态再拍。
   * 它只能调页面已经暴露的调试 API（`window.__raidBattle.*`），
   * 不是一个通用的求值后门。
   */
  if (process.env.RAID_SHOT_EVAL) {
    const r = await ev(process.env.RAID_SHOT_EVAL);
    if (r !== undefined) console.log(`[eval] ${r}`);
    await sleep(200);
  }

  /**
   * 可选：**按键之前**再跑一段驱动脚本（`RAID_SHOT_EVAL_BEFORE`）。
   *
   * ⚠️ 与 `RAID_SHOT_EVAL` 分成两个变量，是为了"**前后对比**"：
   * 滚动位置这类量只拍一张图看不出来（"滚了"和"重排了"长得一样），
   * 需要按键前读一次、按键后再读一次（后者由 `RAID_SHOT_TEXT` 打）。
   * 只有一个变量时，"按键后"拿不到对比基准。
   *
   * 与 `RAID_SHOT_EVAL` 同源：只能调页面已暴露的调试 API，不是求值后门。
   */
  if (process.env.RAID_SHOT_EVAL_BEFORE) {
    const r = await ev(process.env.RAID_SHOT_EVAL_BEFORE);
    if (r !== undefined) console.log(`[eval-before] ${r}`);
    await sleep(200);
  }

  /**
   * 截图前"按"几个键（见文件头的 `RAID_SHOT_KEYS`）。
   *
   * ⚠️ `rawKeyDown` + `keyUp` 一对：只发 `keyDown` 会让浏览器认为键一直
   * 按着（下一次 Tab 会被当成连发，`event.repeat` 也变成真）。
   */
  for (const name of RAW_KEYS) {
    const k = KEYS[name] ?? { code: name, key: name, vk: 0 };
    const base = { key: k.key, code: k.code, windowsVirtualKeyCode: k.vk, nativeVirtualKeyCode: k.vk };
    await send('Input.dispatchKeyEvent', {
      type: 'rawKeyDown',
      ...base,
      ...(k.modifiers === undefined ? {} : { modifiers: k.modifiers }),
    });
    await send('Input.dispatchKeyEvent', {
      type: 'keyUp',
      ...base,
      ...(k.modifiers === undefined ? {} : { modifiers: k.modifiers }),
    });
    await sleep(120);
  }

  await sleep(1200);

  /**
   * 可选：在截图前向 canvas **注入一次真实指针事件**（`RAID_SHOT_POINTER=x,y`，
   * 逻辑坐标）。
   *
   * 用途：验证"触屏 / 鼠标能点到的入口"真的点得通 —— 例如自由模式与
   * 选角色屏左上角的**返回箭头**（AGENTS.md §3b：那些功能不能只有 `Esc`）。
   *
   * ⚠️ 必须注入**真实 `PointerEvent`**（`isTrusted` 虽为假，但走的是页面
   * 自己的 `pointerdown` 监听器 → 与玩家同一条路）。直接调界面自己的方法
   * （`back.hitTest()` 之类）是旁路，证明不了"点击路由接对了"。
   *
   * ⚠️ 坐标是**逻辑坐标**，这里按 canvas 的实测尺寸换算成 client 坐标 ——
   * 不许把 letterbox 的换算抄一份到脚本里（画布尺寸跟着窗口变）。
   */
  if (process.env.RAID_SHOT_POINTER) {
    const [lx, ly] = process.env.RAID_SHOT_POINTER.split(',').map((v) => Number(v.trim()));
    const r = await ev(`(() => {
      const c = document.querySelector('canvas');
      const rect = c.getBoundingClientRect();
      const x = rect.left + ${lx} * (rect.width / 960);
      const y = rect.top + ${ly} * (rect.width / 960);
      /**
       * ⚠️ 直接用**画布**当目标，不用 elementFromPoint：战斗结束后
       * elementFromPoint 可能命中画布之外的节点，事件就到不了画布的
       * 监听器（实测：40s 后的点击全部丢失）。画布是唯一的目标。
       */
      const target = c;
      target.dispatchEvent(new PointerEvent('pointerdown', {
        clientX: x, clientY: y, pointerId: 1, pointerType: 'touch', bubbles: true, cancelable: true, isPrimary: true,
      }));
      target.dispatchEvent(new PointerEvent('pointerup', {
        clientX: x, clientY: y, pointerId: 1, pointerType: 'touch', bubbles: true, cancelable: true, isPrimary: true,
      }));
      return JSON.stringify({ ok: true, x, y, hit: target.tagName });
    })()`);
    console.log(`[pointer ${process.env.RAID_SHOT_POINTER}] ${r}`);
    await sleep(400);
  }

  /**
   * 可选：截图前在画布上**拖一下**（`RAID_SHOT_DRAG=x,y1,y2`，逻辑坐标）。
   *
   * 用途：验证**触屏 / 鼠标能不能滚动复盘**（AGENTS.md §3b：不许把功能做成
   * 只有键盘能用）。`y1` → `y2` 是一次真实拖动，走页面的 `pointerdown` /
   * `pointermove` / `pointerup` 路由 —— 与手指滑动同一条路。
   *
   * ⚠️ 与 `RAID_SHOT_POINTER` 同一条纪律：坐标是**逻辑坐标**，CSS 换算在
   * 页面里做（别把 letterbox 的换算抄进脚本）。
   */
  if (process.env.RAID_SHOT_DRAG) {
    const [lx, y1, y2] = process.env.RAID_SHOT_DRAG.split(',').map((v) => Number(v.trim()));
    const r = await ev(`(() => {
      const c = document.querySelector('canvas');
      const rect = c.getBoundingClientRect();
      const k = rect.width / 960;
      const x = rect.left + ${lx} * k;
      const at = (ly) => rect.top + ly * k;
      const opts = (y) => ({
        clientX: x, clientY: at(y), pointerId: 7, pointerType: 'touch',
        bubbles: true, cancelable: true, isPrimary: true,
      });
      /** ⚠️ 同 RAID_SHOT_POINTER：目标是画布本身，别用 elementFromPoint。 */
      const target = c;
      target.dispatchEvent(new PointerEvent('pointerdown', opts(${y1})));
      /** 分几步移动：一步到位的话"拖拽中"的手势路径就测不到。 */
      for (let i = 1; i <= 10; i += 1) {
        target.dispatchEvent(new PointerEvent('pointermove', opts(${y1} + ((${y2} - ${y1}) * i) / 10)));
      }
      target.dispatchEvent(new PointerEvent('pointerup', opts(${y2})));
      return JSON.stringify({ ok: true, from: ${y1}, to: ${y2} });
    })()`);
    console.log(`[drag ${process.env.RAID_SHOT_DRAG}] ${r}`);
    await sleep(400);
  }

  const shot = await send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(OUT, Buffer.from(shot.data, 'base64'));
  console.log(`已保存 ${OUT}`);

  /**
   * 可选：把 canvas 上**实际写进去的文字**打出来（`RAID_SHOT_TEXT=1`）。
   *
   * ⚠️ 为什么需要：截图只能证明"看着对"，证明不了"这是哪个 Label、什么颜色"。
   * 尤其是"光标 vs 选择"这种**同一张卡上的两种态**，肉眼看的是颜色，
   * 而颜色是从 `style.fill` 来的 —— 直接读它才是硬证据。
   *
   * 它**只打印**，不做断言（AGENTS.md §4：截图工具不发展成 e2e）。
   */
  if (process.env.RAID_SHOT_TEXT === '1') {
    const diag = await ev(`JSON.stringify({
      settingsOpen: window.__raidBattle.settings.isOpen(),
      prepare: window.__raidBattle.prepare.state(),
      buttonFocused: window.__raidBattle.settings.buttonFocused(),
      back: window.__raidBattle.back.visible(),
      backCenter: window.__raidBattle.back.center(),
      backBounds: window.__raidBattle.back.bounds(),
      status: window.__raidBattle.probe().status,
      api: {
        hasAct: typeof window.__raidBattle.act === 'function',
        hasBindings: typeof window.__raidBattle.bindings === 'function',
        hasRestart: typeof window.__raidBattle.restart === 'function',
        hasProbe: typeof window.__raidBattle.probe === 'function',
      },
      logReview: {
        layer: window.__raidBattle.logReview.layer(),
        isOpen: window.__raidBattle.logReview.isOpen(),
        pointerRatio: window.__raidBattle.logReview.pointerRatio(),
        entryCount: window.__raidBattle.logReview.entryCount === undefined
          ? null
          : window.__raidBattle.logReview.entryCount(),
      },
    })`);
    console.log(`[diag] ${diag}`);
    const dump = await ev(`(() => {
      const out = [];
      const walk = (node, depth) => {
        const t = node.text;
        if (typeof t === 'string' && t.length > 0) {
          out.push({
            text: t,
            x: Math.round(node.x),
            y: Math.round(node.y),
            fill: node.style && node.style.fill,
            fontSize: node.style && node.style.fontSize,
            visible: node.visible,
          });
        }
        if (node.children) for (const c of node.children) walk(c, depth + 1);
      };
      walk(window.__raidBattle.stage, 0);
      return JSON.stringify(out);
    })()`);
    console.log(`[canvas text] ${dump}`);
  }

} finally {
  /**
   * ⚠️ 收尾的**唯一**正确位置是 `finally`，不是流程末尾 —— 中间任何一步
   * 抛错、返回、挂住，末尾那一行就到不了。`close()` 会 SIGTERM → SIGKILL →
   * **确认**进程组消失，并清掉临时 profile / HOME。
   */
  await chrome.close();
}

/**
 * ⚠️ 显式退出：CDP 的 WebSocket 还开着，它会一直吊住事件循环。
 * 此时 Chrome 已在上面的 `finally` 里**确认**死亡。
 */
process.exit(0);
