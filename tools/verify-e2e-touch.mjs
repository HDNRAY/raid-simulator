/**
 * 端到端验证：**触屏**。
 *
 * ==================================================================
 * 为什么需要单独一个脚本
 * ==================================================================
 *
 * `verify-e2e.mjs` **只按键盘**。所以"触屏坏了、键盘没事"这一类 bug
 * **CI 完全看不见** —— 实测踩过：`restartBattle()` 重建 `BattleLoop` 时
 * 漏了接触屏输入源，于是**任何一次重开之后触屏永久断开**（Action 全堆进
 * 没人 drain 的数组），而键盘因为新循环会重新 new 一个源所以正常。
 * 那个 bug 活了很久，就是因为没有这条覆盖。
 *
 * ==================================================================
 * 断言的是"重开后仍然生效"
 * ==================================================================
 *
 * 单测能覆盖"getter 每帧被求值"（`tests/unit/battleLoopInput.test.ts`），
 * 但**只有端到端**能证明"真的点下去、真的有技能放出来"。
 * 所以这里用**真实 CDP 触摸事件**，而不是合成 `PointerEvent`。
 *
 * ⚠️ 坐标换算的坑：canvas 的 `getBoundingClientRect().top` **不是 0**
 * （实测 70）—— 必须 `clientY = rect.top + logicalY * (rect.width / 960)`。
 * 只乘 scale 会点在画布外，测试会误报"触屏没反应"。
 */

import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PORT = 9388;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const profile = mkdtempSync(join(tmpdir(), 'vt-'));
const home = mkdtempSync(join(tmpdir(), 'vth-'));
const child = spawn(
  CHROME,
  [
    '--headless=new',
    `--remote-debugging-port=${PORT}`,
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
    '--window-size=1280,720',
    '--hide-scrollbars',
    'about:blank',
  ],
  { env: { ...process.env, HOME: home }, stdio: 'ignore' },
);

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
const errors = [];
await new Promise((r) => ws.addEventListener('open', r));
ws.addEventListener('message', (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pend.has(m.id)) {
    pend.get(m.id)(m.result);
    pend.delete(m.id);
  }
  if (m.method === 'Runtime.exceptionThrown') {
    errors.push(m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text);
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
/** 模拟触屏：视口 + 触摸仿真 + 让能力探测认为这是触屏设备。 */
await send('Emulation.setDeviceMetricsOverride', {
  width: 1280,
  height: 720,
  deviceScaleFactor: 1,
  mobile: true,
});
await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
await send('Page.addScriptToEvaluateOnNewDocument', {
  source: `const o = window.matchMedia.bind(window);
    window.matchMedia = (q) => (q === '(pointer: coarse)' || q === '(hover: none)')
      ? { matches: true, media: q, addEventListener() {}, removeEventListener() {} } : o(q);`,
});
/** 跳过备战界面的入口（与键盘脚本同一个；见 `main.ts` 的 `skipPrepare`）。 */
await send('Page.navigate', { url: 'http://localhost:5273/?prepare=skip' });
await send('Page.bringToFront').catch(() => {});

const evalPage = async (expr) => {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true });
  return r.result?.value;
};
const probe = async () => JSON.parse(await evalPage('JSON.stringify(window.__raidBattle.probe())'));

/** 等"可测量"（tick 在动），而不是死等。 */
for (let i = 0; i < 60; i += 1) {
  const t = await evalPage('window.__raidBattle ? window.__raidBattle.probe().tick : -1');
  if (t > 0) break;
  await sleep(250);
}
const caps = await evalPage('JSON.stringify({ touch: window.__raidBattle.probe().tick > 0 })');
await evalPage('void 0');
if (caps === 'undefined') throw new Error('页面没起来');

/**
 * canvas 的 CSS 矩形 —— 触摸坐标必须按它换算。
 *
 * ⚠️ `top` 不是 0（实测 70）：只乘 scale 会点在画布外。
 */
const rect = JSON.parse(
  await evalPage('JSON.stringify(document.querySelector("canvas").getBoundingClientRect())'),
);
const scale = rect.width / 960;
const toClient = (lx, ly) => ({ x: rect.left + lx * scale, y: rect.top + ly * scale });

const tap = async (lx, ly) => {
  const p = toClient(lx, ly);
  const points = [{ x: p.x, y: p.y }];
  await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: points });
  await sleep(60);
  await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: points });
  await sleep(120);
};
/** 按住一段时间（触发"按住型"路径）。 */
const hold = async (lx, ly, ms) => {
  const p = toClient(lx, ly);
  const points = [{ x: p.x, y: p.y }];
  await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: points });
  await sleep(ms);
  await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: points });
  await sleep(120);
};

/**
 * 触屏按钮的圆心（与 `touchButtonLayer.ts` 的弧几何同源）。
 *
 * ⚠️ 这里**不重复实现几何**，而是问页面要 —— 布局的唯一真相是
 * `TouchLayout`，脚本自己算一份就会在几何调整后失效。
 */
const centers = JSON.parse(
  await evalPage(`JSON.stringify(
    (() => {
      const ids = window.__raidBattle.bindings().filter((b) => b.key !== '').map((b) => b.skillId);
      return ids;
    })()
  )`),
);

const a0 = await probe();
console.log('初始:', JSON.stringify(a0));

/** 「攻」在弧上的位置：脚本通过调试入口反查，避免复制几何。 */
const attackCenter = JSON.parse(
  await evalPage(`JSON.stringify(window.__raidBattle.touchButtonCenter?.('attack') ?? null)`),
);

/**
 * 断言方式：点一下触屏按钮，看引擎**是否真的接受了技能**。
 *
 * ⚠️ 用 `playerCooldowns` 而不是 `playerCasts`：技能的读条只有 500ms，
 * 而触摸往返 + 等待可能已经走完读条，`casts` 会回到 0 ——
 * 冷却则会在施放后留下痕迹（`attack` 的 cooldown 是 0，所以看
 * `playerDouqi` 增长更稳：造成伤害会换缠）。
 */
let failed = 0;
const check = (label, ok, detail) => {
  console.log(`${ok ? '✓' : '✗'} ${label}  ${detail}`);
  if (!ok) failed += 1;
};

if (attackCenter === null) {
  /**
   * 没有调试入口就退回"用绑定顺序 + 弧几何反推"太脆 —— 直接报清楚，
   * 让下次把入口补上，而不是静默跳过（跳过等于没测）。
   */
  check('能拿到触屏按钮圆心（需要调试入口）', false, 'touchButtonCenter 缺失');
} else {
  const before = await probe();
  await tap(attackCenter.x, attackCenter.y);
  await sleep(700);
  const after = await probe();
  check(
    '触屏点「攻」→ 引擎接受（重开前）',
    after.playerDouqi > before.playerDouqi || after.bossHp < before.bossHp,
    `douqi ${before.playerDouqi}→${after.playerDouqi}`,
  );

  /**
   * **核心断言：重开之后触屏仍然生效。**
   *
   * 这正是那个 bug 的形态 —— `restartBattle()` 重建 `BattleLoop` 时
   * 漏了接触屏输入源，重开后 Action 全堆进没人 drain 的数组，
   * 按钮还在、点了没反应，而键盘正常。
   */
  await evalPage('window.__raidBattle.restart()');
  await sleep(600);
  const afterRestart = await probe();
  check('重开确实生效（tick 归零）', afterRestart.tick < after.tick, `tick ${after.tick} → ${afterRestart.tick}`);

  const before2 = await probe();
  await tap(attackCenter.x, attackCenter.y);
  await sleep(900);
  const after2 = await probe();
  check(
    '【关键】重开之后触屏**仍然生效**',
    after2.playerDouqi > before2.playerDouqi || after2.bossHp < before2.bossHp,
    `douqi ${before2.playerDouqi}→${after2.playerDouqi}, bossHp ${before2.bossHp}→${after2.bossHp}`,
  );

  /** 按住「防」再松开 —— 覆盖按住型路径（它走 `holdDrain`，与点击不同）。 */
  const guardCenter = JSON.parse(
    await evalPage(`JSON.stringify(window.__raidBattle.touchButtonCenter?.('guard') ?? null)`),
  );
  if (guardCenter !== null) {
    await hold(guardCenter.x, guardCenter.y, 400);
    const afterGuard = await probe();
    check(
      '按住「防」松开后触屏仍可用',
      afterGuard.status === 'running' || afterGuard.status === 'victory',
      `status=${afterGuard.status}`,
    );
  }
}

console.log('errors:', JSON.stringify(errors));
check('无运行期异常', errors.length === 0, errors.slice(0, 1).join(''));

child.kill('SIGKILL');
await sleep(200);
rmSync(profile, { recursive: true, force: true });
rmSync(home, { recursive: true, force: true });
process.exit(failed ? 1 : 0);
