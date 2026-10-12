/**
 * **性能基准**：跑一段真实的战斗，量 rAF 间隔与长帧。
 *
 * ⚠️ 它**只测量、不断言**，所以不进 `verify:e2e`。
 * 想对比改动前后，跑两次看输出即可。
 *
 * ⚠️ 曾经还想统计"每帧重建了多少 Pixi 文本纹理"（那是最贵的一类操作），
 * 但**测不出来**：遍历场景树按 `constructor.name === 'Text'` 认不出来
 * （打包后构造器名被压缩）；改用导入同一 pixi 模块实例打补丁也没成。
 * **测不出来的指标宁可不要，也不要留个永远显示 null 的字段** —— 那会让人
 * 以为"没问题"或"没在测"，比没有更糟。
 *
 * ==================================================================
 * 为什么要有它
 * ==================================================================
 *
 * "优化性能"如果没有基线，就只是在改代码 —— 改完没人知道是好是坏，
 * 也分不清哪些是噪声。这个脚本固定跑同样的时长、同样的操作，输出
 * 一组可比较的数字。
 *
 * 用法：
 *   node tools/bench.mjs            # 默认 10 秒
 *   node tools/bench.mjs 20000      # 20 秒
 *
 * ⚠️ 它**只测量、不断言**，所以不进 `verify:e2e`（那个会卡 CI）。
 * 想对比改动前后，跑两次看输出即可。
 *
 * ==================================================================
 * ⚠️ 它必须**收干净**：Chrome 不许留下
 * ==================================================================
 *
 * 杀 Chrome 的纪律收在 `tools/headlessChrome.mjs`（与 `tools/shot.mjs` 共用），
 * 这里只负责包 `try/finally` + 装看门狗：`finally`、硬超时看门狗
 * （`DURATION_MS` + 60s，可用 `RAID_BENCH_TIMEOUT_MS` 覆盖）、
 * `exit`/`SIGINT`/`SIGTERM`/`unhandledRejection` 钩子、以及杀之后**确认**
 * 进程组消失。理由见 AGENTS.md §4：实测泄漏过（99 个 Chrome 进程、load 24）——
 * **脚本"挂住"不是"慢"，是"泄漏"。**
 */

import { startHeadlessChrome } from './headlessChrome.mjs';

const DURATION_MS = Number(process.argv[2] ?? 10_000);
const PORT = 9399;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
/**
 * ⚠️ **硬超时**：采样时长（`DURATION_MS`）之后再过 60 秒还没跑完 →
 * **无条件**杀掉 Chrome 并退出（退出码 2）。`RAID_BENCH_TIMEOUT_MS` 可整体覆盖。
 * 理由：`finally` 只在"流程能走到收尾"时有效，而泄漏恰恰是流程**挂在收尾之前**
 * （见 AGENTS.md §4）—— 那时正常路径的 kill 永远执行不到。
 */
const TIMEOUT_MS = Number(process.env.RAID_BENCH_TIMEOUT_MS ?? DURATION_MS + 60_000);

/**
 * **杀 Chrome 的纪律收在 `tools/headlessChrome.mjs`**（与 `tools/shot.mjs`
 * 共用同一份）：按**进程组**杀 + **确认**死亡 + 硬超时看门狗 +
 * `exit`/`SIGINT`/`SIGTERM`/`unhandledRejection` 四条退路钩子。
 *
 * ⚠️ 绝不"全机扫 `--headless` 再 kill" —— 那会误杀用户自己的浏览器。
 */
const chrome = startHeadlessChrome({
  port: PORT,
  windowSize: '1280,720',
  extraArgs: ['--hide-scrollbars'],
  label: 'bench',
});
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
  await send('Page.navigate', { url: 'http://localhost:5273/' });
  await send('Page.bringToFront').catch(() => {});
  await sleep(3500);

  const evalPage = async (expr) => {
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true });
    return r.result?.value;
  };

  /**
   * 在**页面内**采样，而不是逐帧走 CDP。
   *
   * ⚠️ 逐帧 `Runtime.evaluate` 自己的往返开销远大于帧时间，测出来的是
   * "CDP 有多慢"而不是"游戏有多慢"（我踩过这个坑）。
   */
  await evalPage(`(() => {
    window.__bench = { frames: [], raf: [] };
    let last = performance.now();
    let lastRaf = performance.now();
    const tick = () => {
      const now = performance.now();
      window.__bench.frames.push(now - last);
      last = now;
      if (window.__bench.frames.length < 5000) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
    /** 同时记 rAF 间隔（它才是"玩家看到的流畅度"） */
    const rafTick = () => {
      const now = performance.now();
      window.__bench.raf.push(now - lastRaf);
      lastRaf = now;
      if (window.__bench.raf.length < 5000) requestAnimationFrame(rafTick);
    };
    requestAnimationFrame(rafTick);
    return 'started';
  })()`);

  console.log(`采样 ${DURATION_MS} ms …`);
  await sleep(DURATION_MS);

  const stats = JSON.parse(
    await evalPage(`(() => {
      const pct = (arr, p) => {
        if (!arr.length) return 0;
        const s = [...arr].sort((a, b) => a - b);
        return s[Math.min(s.length - 1, Math.floor(s.length * p))];
      };
      const f = window.__bench.raf.filter((x) => x > 0);
      const probe = window.__raidBattle.probe();
      return JSON.stringify({
        samples: f.length,
        p50: +pct(f, 0.5).toFixed(2),
        p95: +pct(f, 0.95).toFixed(2),
        p99: +pct(f, 0.99).toFixed(2),
        max: +Math.max(...f).toFixed(2),
        /** 超过一帧预算(16.7ms)的比例 —— 掉帧率 */
        over16: +(f.filter((x) => x > 16.7).length / f.length * 100).toFixed(1),
        over33: +(f.filter((x) => x > 33).length / f.length * 100).toFixed(1),
        tick: probe.tick,
        frameCount: probe.frameCount,
        floating: probe.floatingCount,
        skillCount: probe.skillCount,
      });
    })()`),
  );
  console.log('rAF 间隔统计（ms）：');
  console.log(JSON.stringify(stats, null, 2));

  /** 顺带量一次内存（粗粒度，看有没有明显泄漏） */
  const mem = await evalPage(
    'JSON.stringify(performance.memory ? {used: performance.memory.usedJSHeapSize, total: performance.memory.totalJSHeapSize} : null)',
  );
  console.log('JS 堆:', mem);

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
