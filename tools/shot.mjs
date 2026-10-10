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
 * ⚠️ 开发服务器需在 <http://localhost:5273/>。用 `?prepare=skip` 直接
 * 进战斗（跳过备战界面）。
 */

import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const OUT = process.argv[2] ?? '/tmp/shot.png';
/** 要「放」的技能 id（`__raidBattle.act`），可给多个。 */
const SKILLS = process.argv.slice(3);
const PORT = 10103;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const profile = mkdtempSync(join(tmpdir(), 'shot-'));
const home = mkdtempSync(join(tmpdir(), 'shoth-'));

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
    '--window-size=1280,760',
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
await send('Page.navigate', { url: 'http://localhost:5273/?prepare=skip&boss=lust' });
await sleep(3400);
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
await sleep(1200);

const shot = await send('Page.captureScreenshot', { format: 'png' });
writeFileSync(OUT, Buffer.from(shot.data, 'base64'));
console.log(`已保存 ${OUT}`);

child.kill('SIGKILL');
await sleep(150);
rmSync(profile, { recursive: true, force: true });
rmSync(home, { recursive: true, force: true });
process.exit(0);
