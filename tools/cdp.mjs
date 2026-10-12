/**
 * **CDP 的一次调用与它的超时** —— `tools/shot.mjs` 用。
 *
 * ==================================================================
 * 为什么单独一个文件
 * ==================================================================
 *
 * "发一条 CDP 命令、等它回来"原先写在 `shot.mjs` 里，长这样：
 *
 * ```js
 * const send = (m, p = {}) => new Promise((r) => {
 *   const i = id++; pend.set(i, r); ws.send(JSON.stringify({ id: i, method: m, params: p }));
 * });
 * ```
 *
 * ⚠️ 它**没有超时、不看 `error`、不处理 socket 关闭** —— 三条都能让
 * `await send(...)` **永远不返回**。脚本"挂住"就是这么来的（见下）。
 * 把它单独拿出来是因为这份判据将来 `bench.mjs` 也要用（和
 * `headlessChrome.mjs` 同一条理由：写两份必然漂移）。
 *
 * ==================================================================
 * 实测：CDP 可以**永远不回**
 * ==================================================================
 *
 * 不是推理，是量出来的（2026-10-12，`/tmp/probe-busy.mjs`）：
 *
 * | 页面状态 | `Page.captureScreenshot` |
 * |---|---|
 * | 正常 | 180~270ms 返回 |
 * | 主线程被一个 9 秒同步忙循环占住 | **3 秒超时都没回来**；忙循环一结束，下一张 190ms 返回 |
 *
 * 在**真实页面**上也能测到（`/tmp/probe-timeline.mjs`，同一个
 * `?prepare=skip&noai=1` 页面每 500ms 拍一张，连拍 60 张）：
 * 58 张 180~270ms，**2 张 4 秒超时没回来**。所以这不是"某个极端场景"，
 * 而是这个页面上**会发生**的事。
 *
 * 页面主线程忙的时候，renderer 根本没机会处理这条命令 —— 它不会报错、
 * 不会拒绝，就是**没有回包**。此时唯一的收敛机制就是调用方自己的超时：
 * 要么明确报错退出，要么重试。**无限等 = 挂住**。
 *
 * ==================================================================
 * 这个模块保证的三件事
 * ==================================================================
 *
 * 1. **每次调用都有上限**：超时 → `reject(CdpTimeoutError)`（带方法名与
 *    实际等待时长）。绝不无限等。
 * 2. **`error` 也是失败**：CDP 用 `{ id, error }` 表达失败（不是抛出）。
 *    旧代码把它当成功、返回 `undefined`，于是调用方拿到
 *    `Cannot read properties of undefined` —— 报错指错方向（实测：
 *    页面重载时 `Page.captureScreenshot` 回的是
 *    `{"code":-32000,"message":"Not attached to an active page"}`）。
 * 3. **socket 关闭/出错 → 所有在途调用立刻失败**：不留下永远不会
 *    settle 的 Promise。页面重载、Chrome 崩溃、调试端口被人抢走都走这条。
 */

/** 单次 CDP 调用超时（`reject` 用的错误类型，便于调用方分辨）。 */
export class CdpTimeoutError extends Error {
  /**
   * @param {string} method CDP 方法名（`Page.captureScreenshot` 之类）
   * @param {number} ms     等了多久
   */
  constructor(method, ms) {
    super(`${method} 在 ${ms}ms 内没有返回（页面主线程可能正忙 / 目标已不可用）`);
    this.name = 'CdpTimeoutError';
    this.method = method;
    this.elapsedMs = ms;
  }
}

/** CDP 自己报的错（`{ id, error }`）—— 原样包一层，附上方法名。 */
export class CdpError extends Error {
  constructor(method, error) {
    super(`${method} 被 CDP 拒绝：${JSON.stringify(error)}`);
    this.name = 'CdpError';
    this.method = method;
    this.cdpError = error;
  }
}

/**
 * 连上某个 **page target** 的调试 WebSocket。
 *
 * ⚠️ `open` 也要有超时：Chrome 起来了但 target 没就绪时，`open` 事件
 * 同样可能永远不来（旧代码在这里也是无限等）。
 *
 * @param {string} wsUrl `http://…/json/list` 里那条 `webSocketDebuggerUrl`
 * @param {{ defaultTimeoutMs?: number, openTimeoutMs?: number, log?: (msg: string) => void }} opts
 */
export async function connectCdp(wsUrl, { defaultTimeoutMs = 10_000, openTimeoutMs = 10_000, log } = {}) {
  const ws = new WebSocket(wsUrl);
  /** id → { resolve, reject, method, timer, startedAt } */
  const pending = new Map();
  /** 已经关掉/坏掉了 —— 之后所有调用直接失败，不再白等。 */
  let deadReason = null;
  let nextId = 1;

  const failAll = (reason) => {
    deadReason = reason;
    for (const [id, p] of pending) {
      clearTimeout(p.timer);
      pending.delete(id);
      p.reject(new Error(`${p.method} 未完成：${reason}`));
    }
  };

  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`CDP WebSocket ${openTimeoutMs}ms 内没有打开（${wsUrl}）`)), openTimeoutMs);
    ws.addEventListener('open', () => { clearTimeout(timer); resolve(); }, { once: true });
    ws.addEventListener('error', () => { clearTimeout(timer); reject(new Error(`CDP WebSocket 打不开：${wsUrl}`)); }, { once: true });
  });

  ws.addEventListener('close', (e) => {
    // ⚠️ 关掉时要**主动**让在途调用失败：否则它们永远 pending，脚本挂住。
    failAll(`调试连接已关闭（code=${e.code}${e.reason ? ` reason=${e.reason}` : ''}）`);
  });
  ws.addEventListener('error', () => {
    failAll('调试连接报错');
  });
  ws.addEventListener('message', (e) => {
    let m;
    try {
      m = JSON.parse(e.data);
    } catch {
      log?.(`CDP 收到非 JSON 消息（忽略）：${String(e.data).slice(0, 120)}`);
      return;
    }
    // 没有 id 的是事件（`Page.loadEventFired` 之类），本工具不消费。
    if (m.id === undefined) return;
    const p = pending.get(m.id);
    if (!p) return;
    pending.delete(m.id);
    clearTimeout(p.timer);
    const elapsed = Date.now() - p.startedAt;
    log?.(`${p.method} <- ${elapsed}ms${m.error ? ' (CDP error)' : ''}`);
    if (m.error) p.reject(new CdpError(p.method, m.error));
    else p.resolve(m.result);
  });

  /**
   * 发一条命令并等回复。
   *
   * @param {string} method
   * @param {object} params
   * @param {number} [timeoutMs] 覆盖默认超时
   */
  function call(method, params = {}, timeoutMs = defaultTimeoutMs) {
    if (deadReason) return Promise.reject(new Error(`${method} 未发出：${deadReason}`));
    const id = nextId++;
    const startedAt = Date.now();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new CdpTimeoutError(method, Date.now() - startedAt));
      }, timeoutMs);
      pending.set(id, { resolve, reject, method, timer, startedAt });
      try {
        ws.send(JSON.stringify({ id, method, params }));
      } catch (err) {
        clearTimeout(timer);
        pending.delete(id);
        reject(new Error(`${method} 发不出去：${err.message}`));
      }
    });
  }

  /** 主动关掉（脚本收尾；Chrome 由 `headlessChrome.mjs` 杀）。 */
  function close() {
    failAll('脚本主动关闭调试连接');
    try {
      ws.close();
    } catch {
      /* 已经关了 */
    }
  }

  return { call, close, get pendingCount() { return pending.size; } };
}
