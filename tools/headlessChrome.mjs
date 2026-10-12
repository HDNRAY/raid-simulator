/**
 * **headless Chrome 的起与杀** —— `tools/shot.mjs` 与 `tools/bench.mjs` 共用。
 *
 * ==================================================================
 * 为什么单独一个文件
 * ==================================================================
 *
 * 两个脚本都要起 Chrome，而"杀不干净"**实测泄漏过**：99 个 Chrome 进程、
 * 多个 headless 跑了近 3 小时、整机 load 24（见 AGENTS.md §4）。
 *
 * 原来的写法是"在正常路径的**最后一行** `child.kill('SIGKILL')`" —— 那一行
 * 到不了（脚本在收尾阶段挂住）就再没有第二道防线。清理逻辑只有一处；
 * 写两份必然漂移：一份修好了、另一份继续漏。
 *
 * ==================================================================
 * 四条纪律（每条都对应一次真实的泄漏 / 实测）
 * ==================================================================
 *
 * 1. **只杀自己起的那个 child** —— 按 `child.pid` 的**进程组**杀。
 *    ⚠️ 绝不做"全机扫 `--headless` 再 kill"：那会误杀用户自己开着的浏览器。
 * 2. **杀要确认** —— `child.kill()` 是 fire-and-forget，发出去不等于死了。
 *    而且 Chrome 的 helper（GPU / renderer / utility）**不在主 pid 上**，
 *    只杀主进程会留下一堆各占几个 % CPU 的孤儿。所以按进程组（`-pid`）
 *    发信号，然后**轮询确认**（进程组没了才算数，见下面的三态）。
 * 3. **SIGTERM 对 Chrome 不一定够** —— 宽限期一到就 SIGKILL。
 * 4. **每条退路都要杀** —— 正常路径（调用方的 `finally`）、硬超时看门狗、
 *    `exit` / `SIGINT` / `SIGTERM` / `unhandledRejection`。
 *    脚本"挂住"不是"慢"，是"泄漏"。
 *
 * ==================================================================
 * ⚠️ 实测到的两个坑（都靠"先证明、再写码"发现，别凭直觉改回去）
 * ==================================================================
 *
 * **坑一：同步自旋时，被 SIGKILL 的孩子会一直是僵尸。**
 * Node 要等事件循环转一圈才会 reap。所以 `process.on('exit')` 里**同步**
 * 打转时，`kill(-pgid, 0)` 永远不会报 ESRCH —— 只看 ESRCH 的"确认"必然失败、
 * 每次都误报"仍存活"。所以：
 *   - `finally` 那条路走**异步** `close()`：事件循环能转，孩子被 reap，
 *     整组是真的消失（日志里是"整组消失"）；
 *   - 致命退路（看门狗 / 信号 / `unhandledRejection` / `exit`）走
 *     `closeSync()`，判据见坑二 —— 它确认的是"**组里没有活着的进程**"，
 *     而不是"组不存在了"。⚠️ 这两条退路**必须同步**：实测 `await close()`
 *     会和脚本自己的 `process.exit(0)` 赛跑，把异常吞成退出码 0。
 *
 * **坑二：macOS 上"整组只剩僵尸"会报 `EPERM`，不是 ESRCH。**
 * 实测（`/tmp` 里用 `sleep` 复现）：
 *
 * | `kill(-pgid, 0)` | 含义 |
 * |---|---|
 * | `0`（成功） | 组里**至少有一个活着的**成员 |
 * | `EPERM` | 组还在，但**只剩我们自己的僵尸孩子** —— 没有活着的进程 |
 * | `ESRCH` | 整组消失 |
 *
 * 所以判据是"**组里还有没有活着的进程**"（`0` 才有），不是"组还在不在"。
 * 把 `EPERM` 当"还活着"会导致每次同步退路都误报。
 *
 * ==================================================================
 * 用法（`try/finally` 是调用方的责任，这里只管"杀得掉"）
 * ==================================================================
 *
 * ```js
 * const chrome = startHeadlessChrome({ port: 10103, windowSize: '1280,760' });
 * chrome.armGuards({ timeoutMs: 60_000 });
 * try {
 *   …跑你的流程…
 * } finally {
 *   await chrome.close();   // SIGTERM → SIGKILL → **确认**没有活着的进程 + 清临时目录
 * }
 * ```
 */

import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/** 本机 Chrome 的可执行文件（只服务 macOS，够用）。 */
export const CHROME_PATH = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * **同步**睡一会儿（`Atomics.wait`）。
 *
 * ⚠️ 只在**不能 await** 的退路里用：`process.on('exit')` 只允许同步代码，
 * 而那正是"必须确认它死了"的地方 —— 没有同步等待就没法确认。
 */
function sleepSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/**
 * 进程组里**还有活着的进程**吗 —— 三态（判据见文件头的"坑二"）。
 *
 * - `'alive'`：`kill(-pgid, 0)` 成功 → 至少一个成员收到了信号（还在跑）
 * - `'zombie'`：`EPERM` → 组还在，但只剩我们自己的僵尸孩子（没有活着的）
 * - `'gone'`：`ESRCH` → 整组没了
 *
 * 其它错误保守当 `'alive'`（宁可多杀一次，不可漏判）。
 */
function groupState(pid) {
  try {
    process.kill(-pid, 0);
    return 'alive';
  } catch (err) {
    if (err.code === 'ESRCH') return 'gone';
    if (err.code === 'EPERM') return 'zombie';
    return 'alive';
  }
}

/** 组里**没有活着的进程**了吗（僵尸不算活着）。 */
const noLiveMembers = (pid) => groupState(pid) !== 'alive';

/**
 * 给进程组发信号；组没了就退回单 pid（双保险）。
 *
 * ⚠️ 靠 `-pid` 能一次带走所有 helper，前提是 spawn 时 `detached: true`
 * 让 Chrome 当上**新进程组的组长** —— 否则 `-pid` 指的根本不是它。
 */
function signalGroup(pid, sig) {
  try {
    process.kill(-pid, sig);
    return true;
  } catch {
    try {
      process.kill(pid, sig);
      return true;
    } catch {
      return false;
    }
  }
}

/** 轮询到"组里没有活着的进程"（或超时），返回最终状态。 */
async function waitNoLiveMembers(pid, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (!noLiveMembers(pid)) {
    if (Date.now() >= deadline) break;
    await sleep(25);
  }
  return groupState(pid);
}

/** `waitNoLiveMembers` 的同步版（`exit` 钩子用）。 */
function waitNoLiveMembersSync(pid, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (!noLiveMembers(pid)) {
    if (Date.now() >= deadline) break;
    sleepSync(25);
  }
  return groupState(pid);
}

/**
 * 起一个 headless Chrome，返回一个**带收尾能力的会话**。
 *
 * ⚠️ `detached: true` 不是为了"脱离父进程"，恰恰相反：它让 Chrome 成为
 * **新进程组的组长**，这样 `kill(-pid)` 能把 GPU / renderer / utility
 * 一起带走。⚠️ 代价：父进程若被 `SIGKILL`（连 `exit` 钩子都跑不了）就
 * 没人收尾了 —— 这一条**本模块管不了**，只能靠调用方别被硬杀。
 *
 * @param {{ port: number, windowSize: string, extraArgs?: string[], label?: string }} opts
 *   `label` 同时用作**临时目录前缀**（出问题时好认领）与日志标签。
 */
export function startHeadlessChrome({ port, windowSize, extraArgs = [], label = 'chrome' }) {
  const profile = mkdtempSync(join(tmpdir(), `${label}-profile-`));
  const home = mkdtempSync(join(tmpdir(), `${label}-home-`));
  const child = spawn(
    CHROME_PATH,
    [
      '--headless=new',
      `--remote-debugging-port=${port}`,
      `--user-data-dir=${profile}`,
      '--no-sandbox',
      '--disable-gpu',
      '--use-angle=swiftshader',
      '--enable-unsafe-swiftshader',
      '--no-first-run',
      '--disable-crash-reporter',
      '--disable-breakpad',
      '--disable-backgrounding-occluded-windows',
      '--disable-renderer-backgrounding',
      '--disable-background-timer-throttling',
      `--window-size=${windowSize}`,
      ...extraArgs,
      'about:blank',
    ],
    { env: { ...process.env, HOME: home }, stdio: 'ignore', detached: true },
  );

  /** 看门狗定时器（`armGuards` 装、`close*` 撤）。 */
  let watchdog;
  /** 已经收尾过了 —— 让 `exit` 钩子可以无脑再调一次。 */
  let closed = false;
  /** 正在走致命退路（防止第二次 Ctrl-C 又跑一遍完整收尾）。 */
  let bailing = false;

  const cleanTemp = () => {
    rmSync(profile, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
  };

  const report = (pid, state) => {
    if (state === 'alive') {
      console.error(`[${label}] ⚠️ SIGKILL 之后进程组 ${pid} 里仍有活着的进程，请手工检查`);
      return;
    }
    console.log(`[${label}] headless Chrome 已确认退出（进程组 ${pid}：${state === 'gone' ? '整组消失' : '无存活进程'}）`);
  };

  /**
   * 杀干净这次会话起的 Chrome（**异步路径**：正常收尾 / 调用方的 `finally`）。
   *
   * 顺序是 SIGTERM（700ms 优雅期）→ SIGKILL → **确认组里没有活着的进程**，
   * 然后清掉两个临时目录（`--user-data-dir` 的 profile 与假的 HOME）。
   *
   * ⚠️ 走异步不只是"好看"：同步自旋时孩子不会被 reap（见文件头"坑一"），
   * 确认就成了假的。这里能 await，事件循环会转，确认才是真的（日志里会
   * 打出"整组消失"，而不只是"没有活着的进程"）。
   *
   * ⚠️ 致命退路（看门狗 / 信号 / `unhandledRejection`）**故意不走这里**，
   * 它们走同步的 `closeSync()` —— 理由见 `armGuards` 里的注释（会赛跑）。
   *
   * @returns {Promise<boolean>} 是否确认收干净了（`false` = 还有活着的残留，
   *   已经在 stderr 上喊了）
   */
  async function close() {
    clearTimeout(watchdog);
    const pid = child.pid;
    let state = pid === undefined ? 'gone' : groupState(pid);
    if (state === 'alive') {
      signalGroup(pid, 'SIGTERM');
      state = await waitNoLiveMembers(pid, 700);
      if (state === 'alive') {
        signalGroup(pid, 'SIGKILL');
        state = await waitNoLiveMembers(pid, 3000);
      }
    }
    cleanTemp();
    closed = true;
    report(pid, state);
    return state !== 'alive';
  }

  /**
   * 同上，但**同步** —— 只给 `process.on('exit')` 用（那里规定只能写同步
   * 代码）。其它退路一律走 `close()`。
   *
   * 直接 SIGKILL、不给优雅期：headless 的测试浏览器没有未保存状态，
   * 而"等它自己退"正是当初泄漏的机会窗口。
   */
  function closeSync() {
    if (closed) return true;
    clearTimeout(watchdog);
    const pid = child.pid;
    let state = pid === undefined ? 'gone' : groupState(pid);
    if (state === 'alive') {
      signalGroup(pid, 'SIGKILL');
      state = waitNoLiveMembersSync(pid, 2000);
    }
    cleanTemp();
    closed = true;
    report(pid, state);
    return state !== 'alive';
  }

  /** 起 Chrome 本身失败（例如路径不对）也是一条"必须收尾"的路。 */
  child.on('error', (err) => {
    console.error(`[${label}] 起 Chrome 失败：${err.message}`);
    closeSync();
    process.exit(1);
  });

  /**
   * 装上**所有退路**的保险 + 硬超时看门狗。
   *
   * ⚠️ 看门狗是这里最关键的一条：`finally` 只在"流程能走到收尾"时有效，
   * 而实测的泄漏恰恰是**流程挂在收尾之前** —— 那时 `finally` 永远不执行。
   * 看门狗是唯一"无论卡在哪都能兜住"的机制。
   *
   * @param {{ timeoutMs: number }} opts 到点**无条件**杀 + 退出（退出码 2）
   */
  function armGuards({ timeoutMs }) {
    /**
     * ⚠️ 环境变量写错（`RAID_SHOT_TIMEOUT_MS=abc`）会得到 `NaN`，而
     * `setTimeout(fn, NaN)` 等于**立刻**开火 —— 那会让每次跑都秒退。
     * 所以这里兜一层：不是正的有限数就回落到 60 秒。
     */
    const ms = Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : 60_000;
    /**
     * ⚠️ 这里是**同步**的，两个原因（都实测过）：
     *
     * 1. `await close()` 会和脚本自己的收尾**赛跑** —— 实测
     *    `unhandledRejection` 那条路：rejection 不会让脚本停下来，
     *    脚本继续跑完正常流程、执行到末尾的 `process.exit(0)`，
     *    于是**异常被吞成退出码 0**（看着像成功，实际炸了）。
     *    同步 kill + 立刻 `process.exit(code)` 没有这个窗口。
     * 2. 同步也能**确认**：僵尸态算"没有活着的进程"（见文件头"坑二"），
     *    所以 `closeSync` 的确认不是猜的。
     */
    const bail = (why, code) => {
      if (bailing) process.exit(code);
      bailing = true;
      console.error(`[${label}] ${why} → 强制杀掉 headless Chrome（进程组 ${child.pid}）并退出`);
      closeSync();
      process.exit(code);
    };
    /**
     * ⚠️ `exit` 里**只能**同步做事，所以这里走 `closeSync`。
     * 它是所有"脚本自己退出"路径的最后一道（含未捕获异常：Node 打完
     * 堆栈就会触发 `exit`）。正常路径 / 抛错路径上 `close()` 已经收过尾，
     * `closed` 会让这次变成空操作。
     */
    process.on('exit', () => {
      closeSync();
    });
    process.on('SIGINT', () => {
      bail('收到 SIGINT（Ctrl-C）', 130);
    });
    process.on('SIGTERM', () => {
      bail('收到 SIGTERM', 143);
    });
    process.on('unhandledRejection', (err) => {
      console.error(`[${label}] unhandledRejection：`, err);
      bail('unhandledRejection', 1);
    });
    watchdog = setTimeout(() => {
      bail(`硬超时 ${ms}ms 仍未跑完`, 2);
    }, ms);
  }

  return { child, profile, home, close, closeSync, armGuards };
}
