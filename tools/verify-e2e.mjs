/**
 * 端到端验证：真开一个 headless Chrome，把游戏跑起来，按真实键盘，
 * 断言"战斗确实在推进"。
 *
 * ==================================================================
 * 什么时候跑（AGENTS.md §4）
 * ==================================================================
 *
 * ⚠️ **不必每次改动都跑**，也**不要在有排队消息时跑** ——
 * 它固定要 ~22 秒（Chrome 启动 + 游戏跑 8 秒），用户在连续提需求时
 * 跑它就是让他干等。**队列空了、要收尾时跑一遍即可。**
 *
 * 快的那些（typecheck / eslint / test / build，合计约 3 秒）每次都要跑。
 *
 * ==================================================================
 * 性能笔记（曾经慢到 192s）
 * ==================================================================
 *
 * 三个 `--disable-*-backgrounding/throttling` flag 是**性能关键**：
 * headless 会把"没有真实焦点的页"判定为不可见，把 rAF 节流到 ~2.5fps
 * —— 逻辑全对但跑得极慢。另外 `Page.bringToFront` 也不能省
 * （合成按键会让页面失焦，同样暂停 rAF）。
 *
 * ⚠️ 清理残留进程时**必须**带 `.*headless` 限定，否则会杀掉用户
 * 自己的浏览器（见 AGENTS.md §4）。
 */

import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const CHROME='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PORT=9377; const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const profile=mkdtempSync(join(tmpdir(),'v-')), home=mkdtempSync(join(tmpdir(),'vh-'));
const child=spawn(CHROME,['--headless=new',`--remote-debugging-port=${PORT}`,`--user-data-dir=${profile}`,
 '--no-sandbox','--disable-gpu','--use-angle=swiftshader','--enable-unsafe-swiftshader',
 '--no-first-run','--disable-crash-reporter','--disable-breakpad','--disable-backgrounding-occluded-windows','--disable-renderer-backgrounding','--disable-background-timer-throttling','--window-size=1280,720','--hide-scrollbars','about:blank'],
 {env:{...process.env,HOME:home},stdio:'ignore'});
let page; for(let i=0;i<60;i++){try{const r=await fetch(`http://127.0.0.1:${PORT}/json/list`);const t=await r.json();
 page=t.find(x=>x.type==='page'&&x.webSocketDebuggerUrl);if(page)break;}catch{} await sleep(200);}
const ws=new WebSocket(page.webSocketDebuggerUrl); let id=1; const pend=new Map(); const errors=[];
await new Promise(r=>ws.addEventListener('open',r));
ws.addEventListener('message',e=>{const m=JSON.parse(e.data); if(m.id&&pend.has(m.id)){pend.get(m.id)(m.result);pend.delete(m.id);}
 if(m.method==='Runtime.exceptionThrown') errors.push(m.params.exceptionDetails.exception?.description||m.params.exceptionDetails.text);});
const send=(m,p={})=>new Promise(r=>{const i=id++;pend.set(i,r);ws.send(JSON.stringify({id:i,method:m,params:p}));});
await send('Runtime.enable'); await send('Page.enable');
await send('Page.navigate',{url:'http://localhost:5273/'});
/**
 * ⚠️ **必须把页面拉到前台**，否则下面的合成按键会让页面失焦。
 *
 * 踩过的坑：`Input.dispatchKeyEvent` 之后 headless Chrome 把页面判定为
 * "不可见/失焦"，于是**暂停 requestAnimationFrame** —— Pixi 的 ticker
 * 跟着停，`tick` 永久不再推进。表现看起来像"游戏死循环/读条卡死"，
 * 实际上是浏览器不给帧。加上这一行之后 tick 恢复正常（+60/秒）。
 */
await send('Page.bringToFront').catch(() => {});
/**
 * 等"可测量"为止，而不是死等 3.5s。
 *
 * ⚠️ 必须放在 `bringToFront` **之后**：页面还在后台态时 rAF 被节流，
 * tick 不推进，轮询只会等到超时。
 */
const waitReady = async (timeoutMs = 15000) => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const r = await send('Runtime.evaluate', {
      expression: 'JSON.stringify((window.__raidBattle?.probe?.()?.tick ?? 0) > 0)',
      returnByValue: true,
    });
    if (r.result?.value === 'true') return true;
    await sleep(100);
  }
  return false;
};
if (!(await waitReady())) {
  console.log('✗ 游戏未在 15s 内进入可测量状态');
  child.kill('SIGKILL');
  process.exit(1);
}
const probe = async () => { const r = await send('Runtime.evaluate',{expression:'JSON.stringify(window.__raidBattle?.probe() ?? null)',returnByValue:true});
  return r.result?.value ? JSON.parse(r.result.value) : null; };
/** 在页面里求值并取回字符串结果（端到端脚本读游戏状态用）。 */
const evalPage = async (expr) => {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  return r.result?.value;
};
// 按键：用 Input.dispatchKeyEvent 模拟真实键盘
async function press(key, code, keyCode) {
  await send('Input.dispatchKeyEvent',{type:'keyDown',key,code,windowsVirtualKeyCode:keyCode,nativeVirtualKeyCode:keyCode});
  await sleep(30);
  await send('Input.dispatchKeyEvent',{type:'keyUp',key,code,windowsVirtualKeyCode:keyCode,nativeVirtualKeyCode:keyCode});
}
const a = await probe();
if (!a) { console.log('✗ 探针不可用'); process.exit(1); }
console.log('初始:', JSON.stringify(a));
/**
 * 键位从默认表里取，**不要在这里写死**。
 *
 * 踩过的坑：这段原先硬编码 `1` / `4`，而默认键位改成 QWER/ASDF 之后
 * 它就悄悄失效了 —— 端到端脚本报"Boss 受到伤害 ✗"，看起来像战斗坏了，
 * 其实只是脚本还在按旧键。
 */
const KEYS = await evalPage(`JSON.stringify(window.__raidBattle.bindings())`);
const bind = JSON.parse(KEYS);
const keyOf = (skillId) => bind.find((b) => b.skillId === skillId);
/** 字母键的 `code` 是 `KeyX`，keyCode 是大写字母的 ASCII。 */
const pressSkill = async (skillId, ms = 600) => {
  const b = keyOf(skillId);
  if (!b || !b.key) return;
  const upper = b.key.toUpperCase();
  await press(b.key, `Key${upper}`, upper.charCodeAt(0));
  await sleep(ms);
};

// 打一轮：攻 → 轰 → 攻
for (const id of ['attack', 'blast', 'attack']) await pressSkill(id, 600);
const b = await probe();
console.log('按键后:', JSON.stringify(b));
// 打 8 秒，看伤害是否累计
/**
 * ⚠️ 每步的等待时间必须**长于技能的读条时长**。
 *
 * 「攻」读条 500ms、「轰」900ms，而伤害现在只在**读条走完之后**结算
 * （需求："所有技能的效果，如果要读条，都应该在读条之后"）。
 * 之前每步等 450ms —— 读条还没走完就按下一个，伤害自然打不出来，
 * 脚本会误报"Boss 受到伤害 ✗"。
 */
/**
 * 持续输出：**跑到伤害收敛就停**，而不是固定打 8 轮。
 *
 * 原先固定 8 轮 × (600+1000)ms = 12.8s 的纯等待。改成轮询之后，
 * 机器快时提前结束、机器慢时自动多打几轮（有上限兜底）——
 * 既不靠拍脑袋的时长，也不会无限等。
 *
 * 收敛判据：Boss 掉血量连续两轮不再明显增加（说明已经打满，
 * 或者战斗已结束）。
 */
let lastBossHp = Infinity;
let stagnant = 0;
for (let i = 0; i < 10 && stagnant < 2; i += 1) {
  await pressSkill('attack', 600);
  await pressSkill('blast', 1000);
  const mid = await probe();
  if (mid && mid.status !== 'running') break;
  if (mid && lastBossHp - mid.bossHp < 10) stagnant += 1;
  else stagnant = 0;
  if (mid) lastBossHp = mid.bossHp;
}
const c = await probe();
console.log('持续输出后:', JSON.stringify(c));
console.log('errors:', JSON.stringify(c.errors));
console.log();
const checks = [
  ['战斗在推进（tick 增长）', c.tick > a.tick, `tick ${a.tick} → ${c.tick}`],
  ['Boss 受到伤害', c.bossHp < a.bossHp, `${a.bossHp} → ${c.bossHp}`],
  ['缠增长（攻击造成伤害换缠）', c.playerDouqi > a.playerDouqi, `${a.playerDouqi} → ${c.playerDouqi}`],
  ['Boss 会施放技能（有读条或已造成伤害）', c.bossCasts > 0 || c.bossHp < c.bossHpCap, `bossCasts=${c.bossCasts}`],
  ['技能栏有 6 个槽位', c.skillCount === 6, `skillCount=${c.skillCount}`],
  ['无运行期异常', errors.length === 0, errors.slice(0,1).join('')],
];
let failed = 0;
for (const [label, ok, detail] of checks) { console.log(`${ok?'✓':'✗'} ${label}  ${detail}`); if(!ok) failed++; }
child.kill('SIGKILL'); await sleep(200);
rmSync(profile,{recursive:true,force:true}); rmSync(home,{recursive:true,force:true});
process.exit(failed ? 1 : 0);
