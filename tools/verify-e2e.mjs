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
await sleep(3500);
const probe = async () => { const r = await send('Runtime.evaluate',{expression:'JSON.stringify(window.__raidBattle?.probe() ?? null)',returnByValue:true});
  return r.result?.value ? JSON.parse(r.result.value) : null; };
// 按键：用 Input.dispatchKeyEvent 模拟真实键盘
async function press(key, code, keyCode) {
  await send('Input.dispatchKeyEvent',{type:'keyDown',key,code,windowsVirtualKeyCode:keyCode,nativeVirtualKeyCode:keyCode});
  await sleep(30);
  await send('Input.dispatchKeyEvent',{type:'keyUp',key,code,windowsVirtualKeyCode:keyCode,nativeVirtualKeyCode:keyCode});
}
const a = await probe();
if (!a) { console.log('✗ 探针不可用'); process.exit(1); }
console.log('初始:', JSON.stringify(a));
// 打一轮：1(斩击) → 1 → 4(弧光) → Q(闪避) → 3(割裂)
for (const [k,c,kc] of [['1','Digit1',49],['4','Digit4',52],['1','Digit1',49]]) {
  await press(k,c,kc); await sleep(700);
}
const b = await probe();
console.log('按键后:', JSON.stringify(b));
// 打 8 秒，看伤害是否累计
for (let i=0;i<10;i++){
  await press('1','Digit1',49); await sleep(500);
  await press('4','Digit4',52); await sleep(500);
}
const c = await probe();
console.log('持续输出后:', JSON.stringify(c));
console.log('errors:', JSON.stringify(c.errors));
console.log();
const checks = [
  ['战斗在推进（tick 增长）', c.tick > a.tick, `tick ${a.tick} → ${c.tick}`],
  ['Boss 受到伤害', c.bossHp < a.bossHp, `${a.bossHp} → ${c.bossHp}`],
  ['斗炁增长（斩击产生斗炁）', c.playerDouqi > a.playerDouqi, `${a.playerDouqi} → ${c.playerDouqi}`],
  ['Boss 会施放技能（有读条或已造成伤害）', c.bossCasts > 0 || c.bossHp < c.bossHpCap, `bossCasts=${c.bossCasts}`],
  ['技能栏有 7 个槽位', c.skillCount === 7, `skillCount=${c.skillCount}`],
  ['无运行期异常', errors.length === 0, errors.slice(0,1).join('')],
];
let failed = 0;
for (const [label, ok, detail] of checks) { console.log(`${ok?'✓':'✗'} ${label}  ${detail}`); if(!ok) failed++; }
child.kill('SIGKILL'); await sleep(200);
rmSync(profile,{recursive:true,force:true}); rmSync(home,{recursive:true,force:true});
process.exit(failed ? 1 : 0);
