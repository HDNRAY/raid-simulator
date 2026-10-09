/**
 * 端到端验证：用 CDP 打开真实页面，让**真实时间**流过，然后读回应用内部状态。
 *
 * 为什么需要它：静态截图只能证明"渲染了一次"，证明不了"在动"。
 * 而 M0 的验收标准是"色块按 60Hz **由 tick 驱动**规律移动"——
 * 那是一个时间维度的断言，必须真的等时间流过再采样。
 *
 * 用法（需要先有一个 dev server 在跑）：
 *   node tools/verify-e2e.mjs [url]
 *
 * 退出码：0 = 全部通过，1 = 有断言失败或收不到探针。
 */

import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const URL_UNDER_TEST = process.argv[2] ?? 'http://localhost:5273/';
const DEBUG_PORT = 9333;

const CHROME_CANDIDATES = [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function findChrome() {
  for (const p of CHROME_CANDIDATES) {
    if (existsSync(p)) return p;
  }
  return undefined;
}

async function waitForTarget(timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs;
  let lastErr;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/list`);
      const targets = await res.json();
      const page = targets.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
      if (page) return page;
    } catch (err) {
      lastErr = err;
    }
    await sleep(200);
  }
  throw new Error(`等不到可调试的页面: ${lastErr?.message ?? 'timeout'}`);
}

/** 极简 CDP 客户端：只需要 Runtime.evaluate 与 Console 消息。 */
function connect(wsUrl) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    let nextId = 1;
    const pending = new Map();
    const consoleMessages = [];

    ws.addEventListener('open', () => {
      resolve({
        send(method, params = {}) {
          const id = nextId++;
          return new Promise((res, rej) => {
            pending.set(id, { res, rej });
            ws.send(JSON.stringify({ id, method, params }));
          });
        },
        consoleMessages,
        close: () => ws.close(),
      });
    });

    ws.addEventListener('error', (e) => reject(new Error(`WebSocket 错误: ${e.message ?? e}`)));

    ws.addEventListener('message', (event) => {
      const msg = JSON.parse(event.data);

      if (msg.id && pending.has(msg.id)) {
        const { res, rej } = pending.get(msg.id);
        pending.delete(msg.id);
        if (msg.error) rej(new Error(`${msg.error.message} (${msg.error.code})`));
        else res(msg.result);
        return;
      }

      if (msg.method === 'Runtime.consoleAPICalled') {
        const text = (msg.params.args ?? [])
          .map((a) => a.value ?? a.description ?? a.type)
          .join(' ');
        consoleMessages.push({ level: msg.params.type, text });
      }
      if (msg.method === 'Runtime.exceptionThrown') {
        const d = msg.params.exceptionDetails;
        consoleMessages.push({
          level: 'exception',
          text: d.exception?.description ?? d.text,
        });
      }
    });
  });
}

async function main() {
  const chrome = findChrome();
  if (!chrome) {
    console.error('✗ 找不到 Chrome/Chromium/Edge，跳过端到端验证');
    process.exit(1);
  }

  const profile = mkdtempSync(join(tmpdir(), 'raid-e2e-'));
  const home = mkdtempSync(join(tmpdir(), 'raid-e2e-home-'));

  const child = spawn(
    chrome,
    [
      '--headless=new',
      `--remote-debugging-port=${DEBUG_PORT}`,
      `--user-data-dir=${profile}`,
      '--no-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--use-angle=swiftshader',
      '--enable-unsafe-swiftshader',
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-crash-reporter',
      '--disable-breakpad',
      '--window-size=1280,720',
      '--hide-scrollbars',
      'about:blank',
    ],
    { env: { ...process.env, HOME: home }, stdio: 'ignore' },
  );

  let failed = false;
  const check = (ok, label, detail) => {
    console.log(`${ok ? '✓' : '✗'} ${label}${detail ? `  ${detail}` : ''}`);
    if (!ok) failed = true;
  };

  try {
    const target = await waitForTarget();
    const cdp = await connect(target.webSocketDebuggerUrl);

    await cdp.send('Runtime.enable');
    await cdp.send('Page.enable');
    await cdp.send('Page.navigate', { url: URL_UNDER_TEST });

    // 等应用起来（Pixi 初始化 + worker 启动）
    await sleep(3000);

    const evalProbe = async () => {
      const r = await cdp.send('Runtime.evaluate', {
        expression: 'JSON.stringify(window.__raidDebug ? window.__raidDebug.probe() : null)',
        returnByValue: true,
      });
      const raw = r.result?.value;
      return raw ? JSON.parse(raw) : null;
    };

    const t1 = await evalProbe();
    if (!t1) {
      check(false, '页面暴露了 __raidDebug 探针', '拿到 null —— 应用可能启动失败');
      for (const m of cdp.consoleMessages) console.log(`    [${m.level}] ${m.text}`);
      cdp.close();
      return;
    }

    // 让真实时间流过
    await sleep(2500);
    const t2 = await evalProbe();

    check(!t1.lastError, '没有运行期错误', t1.lastError ?? '');
    check(t1.usingWorker, '模拟跑在 worker 里（不是主线程退回）');
    check(t2.tick > t1.tick, 'tick 在推进', `${t1.tick} -> ${t2.tick}`);
    check(t2.snapshotTick >= 0, '拿到过全量快照', `snapshotTick=${t2.snapshotTick}`);
    check(t2.demoX !== t1.demoX, '快照状态在变化（tick 真的驱动了模拟）', `${t1.demoX.toFixed(1)} -> ${t2.demoX.toFixed(1)}`);
    check(t2.steps > 0, '最近一帧推进了步数', `steps=${t2.steps}`);
    check(t1.alpha >= 0 && t1.alpha < 1, '插值系数在 [0,1)', `alpha=${t1.alpha.toFixed(3)}`);

    // tick 推进速度应接近 60Hz。2500ms 期望约 150 tick，放宽到 ±35%。
    const elapsedMs = 2500;
    const advanced = t2.tick - t1.tick;
    const expected = elapsedMs / (1000 / 60);
    const ratio = advanced / expected;
    check(
      ratio > 0.65 && ratio < 1.35,
      'tick 速率接近 60Hz',
      `${advanced} tick / ${elapsedMs}ms = ${(ratio * 60).toFixed(1)}Hz`,
    );

    const errors = cdp.consoleMessages.filter(
      (m) => m.level === 'error' || m.level === 'exception',
    );
    check(errors.length === 0, '控制台无 error / exception');
    for (const e of errors.slice(0, 5)) console.log(`    [${e.level}] ${e.text}`);

    cdp.close();
  } catch (err) {
    console.error(`✗ 验证过程出错: ${err.message}`);
    failed = true;
  } finally {
    child.kill('SIGKILL');
    await sleep(300);
    rmSync(profile, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
  }

  console.log(failed ? '\n结论：失败' : '\n结论：通过');
  process.exit(failed ? 1 : 0);
}

void main();
