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
 * ⚠️ **操作方式（键盘 / 触屏）用 URL 参数给**：`?touch=1` / `?touch=0`
 * （页面里的唯一 flag，见 `render/platform.ts`）—— 不再需要"伪装成触屏
 * 设备"那套 `matchMedia` 包装（它随探测整块删掉了）。
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
 * `RAID_SHOT_EVAL*`：截图前跑一段页面脚本（顺序见下）
 * ==================================================================
 *
 * 两个变量，**都在按键之前**跑，顺序是（2026-10-13 实测确认）：
 *
 *   1. `RAID_SHOT_EVAL`        —— **驱动**脚本：把界面推到某个状态再拍，
 *                                 可以有副作用（调 `__raidBattle.*`）
 *   2. `RAID_SHOT_EVAL_PROBE`  —— **探针**：读一个值当基准，供与按键后
 *                                 的 `RAID_SHOT_TEXT` 对比（滚动位置这类
 *                                 量只拍一张图看不出来）
 *
 * 完整流水线（每一步都按这个顺序）：
 *
 *   act(技能) → RAID_SHOT_EVAL → RAID_SHOT_EVAL_PROBE → RAID_SHOT_KEYS
 *            → RAID_SHOT_POINTER → RAID_SHOT_DRAG → 截图 → RAID_SHOT_TEXT
 *
 * ⚠️ **旧名 `RAID_SHOT_EVAL_BEFORE`（仍兼容）的含义是反的**：它读起来像
 * "在 `RAID_SHOT_EVAL` 之前"，实际是在它**之后**（两者都在按键之前）。
 * 两个 subagent 都踩过这个坑，所以改成了 `_PROBE`（按**角色**命名，
 * 不再暗示与另一个变量的先后）。
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
 * ⚠️ 2026-10-12：为什么每个 CDP 调用都要有超时
 * ==================================================================
 *
 * 现象（两个 subagent 各自独立报的）：进战斗等到 ~3 秒（一局结束那一刻）
 * 脚本**挂住**，`Page.captureScreenshot` **不返回**；四道防线都生效
 * （看门狗到点杀干净、无 Chrome 残留），但**截图拿不到**。
 *
 * 根因**不是**"等某个选择器"，而是：**CDP 命令可以永远不回包。**
 * 页面主线程忙的时候 renderer 没机会处理命令 —— 它不报错、不拒绝，
 * 就是不回。旧代码的 `send()` 是 `new Promise(...)` + 一张没有超时的
 * pending 表，于是 `await send('Page.captureScreenshot')` **无限等**，
 * 整个脚本停在那一行。
 *
 * 这是量出来的，不是推理（复现方法与前后日志见提交说明 / 测试报告）：
 *
 * | 页面状态 | `Page.captureScreenshot` |
 * |---|---|
 * | 正常 | 180~270ms 返回 |
 * | 主线程被 9 秒同步忙循环占住 | **3 秒超时都没回来**；忙循环结束，下一张 190ms |
 *
 * 而且**真实页面上就会发生**：同一个 `?prepare=skip&noai=1` 页面连拍 60 张
 * （每 500ms 一张），58 张 180~270ms，**2 张 4 秒没回来**。
 * 所以这不是"某个极端场景"，是"迟早撞上"。
 *
 * 修法（**不是**"把超时调大"）：
 *   1. **每次 CDP 调用都有上限**（`RAID_SHOT_CDP_TIMEOUT_MS`，默认 10000ms）
 *      → 到点**报错**、走到 `finally` 收尾、**非 0 退出**。
 *      挂不住：要么成、要么明确失败。
 *   2. **`{ id, error }` 当失败**（旧代码把它当成功 → 调用方拿到
 *      `undefined.data` → `Cannot read properties of undefined`，报错指错方向）。
 *   3. **socket 关闭 → 在途调用立刻失败**（不留下永不 settle 的 Promise）。
 *   4. **截图单独一套策略**：第一次只等 1.5 秒（正常 180~270ms，1.5 秒不回
 *      就说明"忙"，不必干等 10 秒）→ 等两帧 rAF（确认主线程活过来了）→
 *      重试一次（`RAID_SHOT_CDP_RETRIES`，默认 1，第二次用完整的
 *      `RAID_SHOT_CDP_TIMEOUT_MS`）。忙是暂态的（实测下一秒就恢复），
 *      重试一次正好吃下去；一直忙就**明确失败**，不无限等。
 *   5. **调试端口不再写死 10103**：多个 subagent 同时跑时，第二个脚本会
 *      连到**第一个**的 Chrome 上；那个 target 被他们关掉后就**永远不回包**。
 *      现在默认让 OS 挑空闲端口（`RAID_SHOT_PORT` 可指定），并在起 Chrome 前
 *      检查端口是否已被占用 —— 占用就**明确报错**，不静默连上去。
 *
 * ⚠️ 每一步都打时间戳（`[shot +1234ms] …`），所以"挂在哪一步"是日志里
 * 直接读到的，不用再猜。
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

import { createServer } from 'node:net';
import { writeFileSync } from 'node:fs';
import { startHeadlessChrome } from './headlessChrome.mjs';
import { CdpTimeoutError, connectCdp } from './cdp.mjs';

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

/** 起始调试端口（`RAID_SHOT_PORT` 可覆盖；被占则往后找，见 `pickPort`）。 */
const PORT_BASE = Number(process.env.RAID_SHOT_PORT ?? 0) || 10103;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
/**
 * ⚠️ **硬超时**（`RAID_SHOT_TIMEOUT_MS`，默认 60000ms）：到点**无条件**
 * 杀掉 Chrome 并退出（退出码 2）。理由：`finally` 只在"流程能走到收尾"
 * 时有效，而实测的泄漏恰恰是流程**挂在收尾之前** —— 那时正常路径的 kill
 * 永远执行不到（见 AGENTS.md §4）。看门狗是唯一"卡在哪都能兜住"的机制。
 */
const TIMEOUT_MS = Number(process.env.RAID_SHOT_TIMEOUT_MS ?? 60_000);
/**
 * ⚠️ **单次 CDP 调用的上限**（`RAID_SHOT_CDP_TIMEOUT_MS`，默认 10000ms）。
 *
 * 这是这次真正的修法：CDP 可以永远不回包（见文件头），所以每次调用都必须
 * 自己收敛。默认 10 秒是"正常 200ms 的 50 倍"—— 慢到不会误杀正常的慢帧，
 * 又短到不会让脚本看起来像挂住。
 *
 * ⚠️ 别把它调大来"解决"问题：调大到任意大就等于没有超时（挂住又回来了）。
 * 真遇到慢页面，应该调的是 `RAID_SHOT_WAIT_MS`（等页面到某个状态），
 * 而不是把"没回包"的容忍度拉长。
 */
const CDP_TIMEOUT_MS = Number(process.env.RAID_SHOT_CDP_TIMEOUT_MS ?? 10_000);
/**
 * 截图超时后**重试几次**（`RAID_SHOT_CDP_RETRIES`，默认 1 次）。
 *
 * ⚠️ 只重试**截图**，不重试按键 / `act()` 之类的"有副作用"的调用 ——
 * 重试它们等于把动作做两遍。
 */
const SHOT_RETRIES = Number(process.env.RAID_SHOT_CDP_RETRIES ?? 1);
/**
 * **第一次**截图的超时（固定 1500ms，不跟 CDP 默认值走）。
 *
 * 理由：这个页面上正常截图是 180~270ms（实测 60 张），所以 1.5 秒不回
 * 就已经是"忙"而不是"慢"了。第一次短、第二次长（用
 * `RAID_SHOT_CDP_TIMEOUT_MS`），合起来既不会把正常的慢帧误判成失败，
 * 也不会在页面忙死时干等两次 10 秒。
 */
const FIRST_SHOT_TIMEOUT_MS = 1500;
/** 起 Chrome 的预算：到点就报错，而不是无限轮询 `/json/list`。 */
const STARTUP_TIMEOUT_MS = 15_000;

/** 带时间戳的日志（相对脚本启动）。"挂在哪一步"直接读这行。 */
const T0 = Date.now();
const logStep = (msg) => {
  const dt = String(Date.now() - T0).padStart(5);
  console.log(`[shot +${dt}ms] ${msg}`);
};
/** CDP 逐条调用日志 —— 只在不设 `RAID_SHOT_QUIET` 时打。 */
const cdpLog = process.env.RAID_SHOT_QUIET ? undefined : (m) => logStep(`  cdp ${m}`);

/**
 * 端口空不空。
 *
 * ⚠️ 光看 `fetch(/json/list)` 不行：那个请求**成功**恰恰说明端口被占了，
 * 而且它会连到**别人的** Chrome 上（多 subagent 并行时实测过）——
 * 连上去之后对方一收尾，你的调用就永远不回包。所以这里主动检查。
 */
function portIsFree(port) {
  return new Promise((resolve) => {
    const srv = createServer();
    srv.once('error', () => resolve(false));
    srv.once('listening', () => srv.close(() => resolve(true)));
    srv.listen(port, '127.0.0.1');
  });
}

/** 从 `PORT_BASE` 往后找一个空闲端口；找不到就抛（不静默退化成"随便连一个"）。 */
async function pickPort() {
  for (let p = PORT_BASE; p < PORT_BASE + 50; p += 1) {
    if (await portIsFree(p)) return p;
  }
  throw new Error(`从 ${PORT_BASE} 起 50 个端口都被占用 —— 用 RAID_SHOT_PORT 指定一个空闲端口`);
}

/**
 * 等 Chrome 的调试端点就绪。
 *
 * ⚠️ 有预算（`STARTUP_TIMEOUT_MS`）：旧代码轮询 60 次 × 200ms，而且**不看
 * 有没有超时**，`page` 为 `undefined` 时下一行 `page.webSocketDebuggerUrl`
 * 才炸 —— 那时错误信息已经指错方向了。
 */
async function waitForPage(port) {
  const deadline = Date.now() + STARTUP_TIMEOUT_MS;
  while (Date.now() < deadline) {
    try {
      const r = await fetch(`http://127.0.0.1:${port}/json/list`);
      const list = await r.json();
      const page = list.find((x) => x.type === 'page' && x.webSocketDebuggerUrl);
      if (page) return page;
    } catch {
      /* 还没起来 */
    }
    await sleep(200);
  }
  throw new Error(`Chrome 的调试端点 ${STARTUP_TIMEOUT_MS}ms 内没就绪（127.0.0.1:${port}）`);
}

/**
 * 截图前确认页面**还在产帧**：等两帧 `requestAnimationFrame`。
 *
 * ⚠️ 主线程被占死时 rAF 也不回 —— 这里同样给超时，超时不算失败（页面
 * 只是忙），照拍；真正的判据是"截图有没有回来"。
 */
async function waitForFrames(call, frames = 2) {
  const expr = `new Promise((r) => {
    let n = 0;
    const step = () => { n += 1; if (n >= ${frames}) r('ok'); else requestAnimationFrame(step); };
    requestAnimationFrame(step);
  })`;
  try {
    await call('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }, Math.min(CDP_TIMEOUT_MS, 3000));
    return true;
  } catch {
    logStep('⚠️ 等 rAF 超时（页面主线程正忙）——仍尝试截图');
    return false;
  }
}

/**
 * 拍一张（短超时 → 等 rAF 稳定 → 重试一次）。
 *
 * ⚠️ 三步都必要：
 *   - **第一次短超时**（1.5s）—— "忙"要尽早发现，别干等 10 秒；
 *   - **等两帧 rAF** —— 重试前先确认主线程真的活过来了（否则第二次也是白等）；
 *   - **第二次用完整超时** —— 页面只是慢了一下的话，这一次能拍到。
 */
async function capturePng(call, format = 'png') {
  let lastError;
  for (let attempt = 0; attempt <= SHOT_RETRIES; attempt += 1) {
    if (attempt > 0) {
      logStep(`截图未返回，重试第 ${attempt} 次（共 ${SHOT_RETRIES} 次）`);
      await waitForFrames(call);
    }
    const budget = attempt === 0 ? FIRST_SHOT_TIMEOUT_MS : CDP_TIMEOUT_MS;
    try {
      const r = await call('Page.captureScreenshot', { format }, budget);
      // ⚠️ 旧代码不检查这里：`{ error }` 或没有 `data` 都会得到
      // `Buffer.from(undefined)` → 报错指向 base64，指向错的地方。
      if (!r || typeof r.data !== 'string' || r.data.length === 0) {
        throw new Error(`Page.captureScreenshot 返回了空数据：${JSON.stringify(r)?.slice(0, 200)}`);
      }
      return Buffer.from(r.data, 'base64');
    } catch (err) {
      lastError = err;
      // 只有"没回包"才值得重试；CDP 明确报错（目标没了之类）重试没意义。
      if (!(err instanceof CdpTimeoutError)) throw err;
    }
  }
  throw new Error(
    `截图失败：${SHOT_RETRIES + 1} 次都没拿到图（${lastError.message}）。` +
      `页面主线程可能被占死；先看上面的 cdp 日志卡在哪一步，再查页面在忙什么。`,
  );
}

/**
 * **杀 Chrome 的纪律全部收在 `tools/headlessChrome.mjs`**（两个起 Chrome 的
 * 脚本共用一份）：按**进程组**杀 + **确认**死亡 + 硬超时看门狗 +
 * `exit`/`SIGINT`/`SIGTERM`/`unhandledRejection` 四条退路钩子。
 *
 * ⚠️ 这里只做两件事：起它、并把它**包进 `try/finally`**。
 * ⚠️ 绝不"全机扫 `--headless` 再 kill" —— 那会误杀用户自己的浏览器。
 */
const PORT = await pickPort();
const chrome = startHeadlessChrome({ port: PORT, windowSize: '1280,760', label: 'shot' });
chrome.armGuards({ timeoutMs: TIMEOUT_MS });
logStep(`headless Chrome 起在调试端口 ${PORT}`);

/** 退出码：正常 0 / 失败 1（⚠️ 不能用流程末尾的 `process.exit(0)` 一把盖掉）。 */
let exitCode = 1;

try {
  const page = await waitForPage(PORT);
  logStep(`调试 target 就绪：${page.id}`);

  const cdp = await connectCdp(page.webSocketDebuggerUrl, { defaultTimeoutMs: CDP_TIMEOUT_MS, log: cdpLog });
  const send = (m, p = {}, ms) => cdp.call(m, p, ms);

  await send('Runtime.enable');
  await send('Page.enable');
  /**
   * ⚠️ **不再有 `RAID_SHOT_TOUCH`**（2026-10-12 删）：页面里那套
   * `matchMedia` 能力探测**整块删掉了**（用户："所有 决定 是 键盘还是触屏的
   * 只用唯一 flag"）。要拍触屏那一套就用 URL：
   *
   *   `?touch=1`  → 强制触屏方式
   *   `?touch=0`  → 强制键盘方式
   *
   * ⚠️ 这里**不再**包装 `window.matchMedia`：那会成为"第二个真相"
   * （页面已经不读它，包了也只是自欺）。
   */
  await send('Page.navigate', { url: PAGE_URL });
  /**
   * 页面加载后的**等待时长**（`RAID_SHOT_WAIT_MS`，默认 3400ms）。
   *
   * ⚠️ 默认值对应"一局 3.5 秒左右打完"那种快局。要看**结局之后**的界面
   * （例如复盘 / 结算）时，一局可能要十几秒 —— 那时把等待加长，
   * 而不是去写一个新的 e2e 脚本（AGENTS.md §4：这里只拍图）。
   */
  await sleep(Number(process.env.RAID_SHOT_WAIT_MS ?? 3400));
  logStep('页面等待结束');
  /**
   * ⚠️ 非关键调用：`bringToFront` 失败（例如某个 headless 版本不支持）不该
   * 让整次截图失败 —— 但也**必须有超时**，否则它自己就能把脚本挂住。
   */
  await send('Page.bringToFront', {}, 3000).catch((e) => logStep(`⚠️ Page.bringToFront 忽略：${e.message}`));

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
   *
   * ⚠️ 它在**按键之前**跑，而且是两个 eval 里的**第一个** —— 全流程的
   * 顺序写在文件头 `RAID_SHOT_EVAL*` 那一节（实测确认过）。
   */
  if (process.env.RAID_SHOT_EVAL) {
    const r = await ev(process.env.RAID_SHOT_EVAL);
    if (r !== undefined) console.log(`[eval] ${r}`);
    await sleep(200);
  }

  /**
   * 可选：**按键之前**读一个基准值（`RAID_SHOT_EVAL_PROBE`）。
   *
   * ⚠️ **旧名 `RAID_SHOT_EVAL_BEFORE` 仍兼容，但它的含义是反的** ——
   * 旧名读起来像"在 `RAID_SHOT_EVAL` 之前"，实测是在它**之后**跑
   * （两个都在按键之前）。按**角色**改名成 `_PROBE` 之后，名字不再暗示
   * 与另一个变量的先后顺序。
   *
   * 与 `RAID_SHOT_EVAL` 分成两个变量，是为了"**前后对比**"：
   * 滚动位置这类量只拍一张图看不出来（"滚了"和"重排了"长得一样），
   * 需要按键前读一次、按键后再读一次（后者由 `RAID_SHOT_TEXT` 打）。
   * 只有一个变量时，"按键后"拿不到对比基准。
   *
   * 与 `RAID_SHOT_EVAL` 同源：只能调页面已暴露的调试 API，不是求值后门。
   */
  const evalProbe = process.env.RAID_SHOT_EVAL_PROBE ?? process.env.RAID_SHOT_EVAL_BEFORE;
  if (evalProbe) {
    const r = await ev(evalProbe);
    if (r !== undefined) console.log(`[eval-probe] ${r}`);
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

  /**
   * ⚠️ 截图前先确认页面**还在产帧**：主线程被占死时 CDP 不回包（见文件头），
   * 等两帧是最便宜的"它现在还活着吗"探针。
   */
  await waitForFrames(send);
  const tShot = Date.now();
  const png = await capturePng(send);
  writeFileSync(OUT, png);
  logStep(`已保存 ${OUT}（${png.length} 字节，截图本身 ${Date.now() - tShot}ms）`);

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

  /**
   * ⚠️ 调试连接要主动关掉：它还开着的话会一直吊住事件循环。
   * （Chrome 本身由上面的 `finally` 负责。）
   */
  cdp.close();
  exitCode = 0;
} catch (err) {
  /**
   * ⚠️ 这里是"失败得干脆"的落点：CDP 超时 / CDP error / 连接断了 / 截图拿不到
   * 全都会走到这，打出**是哪一步、等了多久**，然后非 0 退出 —— 而不是挂着。
   */
  logStep(`❌ 失败：${err?.message ?? err}`);
  if (err instanceof CdpTimeoutError) {
    logStep('   提示：单次 CDP 调用超时。页面主线程被占死时就是这个形状（见文件头）。');
  }
  exitCode = 1;
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
 * ⚠️ 退出码**不能**写死 0：脚本"失败得干脆"必须是有信号的（否则调用方
 * 会把"没拍到图"当成功）。
 */
process.exit(exitCode);
