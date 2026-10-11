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
 * ⚠️ 仍属于"拍一张图"的范畴：只按键、只截图，不做断言。
 */

import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

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
};
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
await send('Page.navigate', { url: PAGE_URL });
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

child.kill('SIGKILL');
await sleep(150);
rmSync(profile, { recursive: true, force: true });
rmSync(home, { recursive: true, force: true });
process.exit(0);
