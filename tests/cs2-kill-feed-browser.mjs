// Own headless browser + loopback authority only; never uses the live 3001
// service, the user's browser, or an injected client event/DOM implementation.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {chromium} from 'playwright';
import {createExperimentalServer} from '../cs2-server.mjs';

const option=(name,fallback)=>process.argv.find(value=>value.startsWith('--'+name+'='))?.slice(name.length+3)??fallback;
const output=path.resolve(option('output','.local/cs2/kill-feed-2026-11-11'));
const files=['cs2-game.mjs','public/cs2-client.js','public/cs2-kill-feed.js','public/cs2-kill-icons.js','public/cs2-presentation.css'];
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const sourceHashes=Object.fromEntries(await Promise.all(files.map(async file=>[file,sha(await readFile(file))])));
if(!process.argv.includes('--run')){console.log(JSON.stringify({status:'prepared',output,sourceHashes,scope:'Own loopback WS authority, actual native client and DOM/SVG. No production listener or physical input/performance claim.'}));process.exit(0);}
await mkdir(output,{recursive:true});
const report={status:'running',startedUTC:new Date().toISOString(),sourceHashes,errors:[],checks:[],screenshots:[],scope:'One owned headless Chrome using native map/actors over an ephemeral loopback WebSocket authority. Synthetic authority-controlled peers are not physical LAN clients. UI correctness/screenshot evidence, not frame-rate or input-latency certification.'};
let server,browser,context,page;
const moduleResponses=new Map();
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function rows(){return page.locator('#feed .kill-feed-entry').evaluateAll(elements=>elements.map(row=>({
 weapon:row.dataset.weapon,headshot:row.dataset.headshot,cause:row.dataset.cause,title:row.title,description:row.getAttribute('aria-label'),
 localKill:row.classList.contains('is-local-kill'),localDeath:row.classList.contains('is-local-death'),
 attacker:row.querySelector('.kill-feed-attacker')?.textContent??null,victim:row.querySelector('.kill-feed-victim')?.textContent??null,
 attackerTeam:row.querySelector('.kill-feed-attacker')?.dataset.team??null,victimTeam:row.querySelector('.kill-feed-victim')?.dataset.team??null,
 attackerColor:row.querySelector('.kill-feed-attacker')?getComputedStyle(row.querySelector('.kill-feed-attacker')).color:null,
 victimColor:row.querySelector('.kill-feed-victim')?getComputedStyle(row.querySelector('.kill-feed-victim')).color:null,
 borderColor:getComputedStyle(row).borderTopColor,label:row.querySelector('.kill-feed-weapon-label')?.textContent,
 icon:row.querySelector('.kill-feed-weapon svg')?.dataset.weaponCanonical,headIcons:row.querySelectorAll('.kill-feed-headshot svg').length,
 iconBox:(()=>{const r=row.querySelector('.kill-feed-weapon svg')?.getBoundingClientRect();return r?{x:r.x,y:r.y,width:r.width,height:r.height}:null;})(),
 rect:(()=>{const r=row.getBoundingClientRect();return{x:r.x,y:r.y,width:r.width,height:r.height,right:r.right,bottom:r.bottom};})(),
 imageOrScriptElements:row.querySelectorAll('img,script,iframe').length,
})))}
async function waitForVictim(name){await page.waitForFunction(name=>document.querySelector('#feed .kill-feed-entry:last-child .kill-feed-victim')?.textContent===name,name);return(await rows()).at(-1);}
function assertRow(row,{weapon,headshot=false,localKill=false,localDeath=false,cause='kill'}={}){
 assert.equal(row.weapon,weapon);assert.equal(row.icon,weapon);assert.equal(row.headshot,String(headshot));assert.equal(row.headIcons,headshot?1:0);
 assert.equal(row.localKill,localKill);assert.equal(row.localDeath,localDeath);assert.equal(row.cause,cause);assert.equal(row.imageOrScriptElements,0);
 assert.ok(row.iconBox.width>0&&row.iconBox.height>0,'Actual SVG must occupy visible space');
}
async function screenshot(name,{feedOnly=false}={}){const file=path.join(output,name);await(feedOnly?page.locator('#feed'):page).screenshot({path:file});report.screenshots.push(file);return file;}

try{
 server=await createExperimentalServer({host:'127.0.0.1',port:0,presentation:'native',gameOptions:{weaponProfile:'cs2'},autoTick:false});
 assert.notEqual(server.address().port,3001);const url='http://127.0.0.1:'+server.address().port;report.server=url;
 browser=await chromium.launch({headless:true,executablePath:process.env.CS2_CHROME_PATH||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',args:['--disable-backgrounding-occluded-windows','--disable-renderer-backgrounding','--disable-background-timer-throttling']});
 context=await browser.newContext({viewport:{width:1920,height:836},deviceScaleFactor:1});page=await context.newPage();page.setDefaultTimeout(120000);
 page.on('pageerror',error=>report.errors.push(error.stack||error.message));page.on('console',message=>{if(message.type()==='error'&&/WebGL|shader|OUT_OF_MEMORY/i.test(message.text()))report.errors.push(message.text());});
 page.on('response',response=>{const pathname=new URL(response.url()).pathname;if(['/cs2-client.js','/cs2-kill-feed.js','/cs2-kill-icons.js','/cs2-presentation.css'].includes(pathname))moduleResponses.set('public'+pathname,response.body().then(bytes=>({status:response.status(),sha256:sha(bytes)})));});
 await page.goto(url+'/?transport=websocket&automation=1');
 await page.waitForFunction(()=>window.lanStrike&&!document.querySelector('#joinButton').disabled||document.querySelector('#error').textContent);
 assert.equal(await page.locator('#error').textContent(),'');await page.locator('#name').fill('测试玩家');await page.locator('#team').selectOption('T');await page.locator('#joinButton').click();
 await page.waitForFunction(()=>window.lanStrike.getState()?.players.some(player=>player.id===window.lanStrike.getId()));
 const myId=await page.evaluate(()=>window.lanStrike.getId()),g=server.game,me=g.players.get(myId);assert.ok(me);
 const enemy=g.add('kill-feed-ct','防守方','CT'),ally=g.add('kill-feed-t','进攻方','T'),sentinel=g.add('kill-feed-sentinel','存活防守方','CT');
 g.begin();g.phase='live';g.endAt=g.time+3600;g.buyEndAt=g.time+3600;server.step();server.broadcastState();
 await page.waitForFunction(round=>window.lanStrike.getState()?.round===round&&window.lanStrike.getState().players.find(p=>p.id===window.lanStrike.getId())?.alive,g.round);
 await page.evaluate(()=>window.cs2Automation.stop());
 const support=server.world.collision.findSupport(3.048,16.51,.8,{height:server.world.movement.rules.bodyHeight,radius:server.world.movement.rules.radius});assert.ok(support,'Actual yellow-car road support');
 Object.assign(me,support.end,{vx:0,vy:0,vz:0,yaw:-2.92,pitch:0,grounded:true,crouch:false,duckAmount:0,ducking:false});server.broadcastState();
 await page.waitForFunction(p=>{const d=window.lanStrike.getDiagnostics().localPosition;return d&&Math.hypot(d.x-p.x,d.z-p.z)<.001;},me);
 await page.evaluate(()=>{window.cs2Automation.start();window.cs2Automation.look(-2.92,0);});
 await page.waitForFunction(()=>window.lanStrike.getDiagnostics().frameCount>60&&window.lanStrike.getDiagnostics().mapStreaming.remaining===0);
 report.browser={version:browser.version(),viewport:page.viewportSize(),transport:await page.evaluate(()=>window.lanStrike.getDiagnostics().transport),station:{name:'yellow-car-road',...support.end,yaw:-2.92}};
 assert.equal(report.browser.transport,'websocket');
 report.moduleResponses={};for(const [file,promise]of moduleResponses){const actual=await promise;assert.equal(actual.status,200);assert.equal(actual.sha256,sourceHashes[file],file+' actual served source');report.moduleResponses[file]=actual;}assert.equal(moduleResponses.size,4);
 report.checks.push('Actual native client joins the owned loopback authority; all new UI module/CSS responses match production SHA.');

 // Each notice starts as real lethal authority damage and reaches the real
 // socket event handler through server.step(), never a fabricated client call.
 let serial=0;
 async function fatal({attacker=me,victim=enemy,weapon='ak47',hitgroup='chest',blast=false,name='受害者'+(++serial),attackerName}={}){
  if(!victim.alive)g.spawn(victim);victim.name=name;victim.hp=1;victim.armour=0;victim.helmet=false;if(attackerName!==undefined)attacker.name=attackerName;
  g.phase='live';g.endAt=g.time+3600;g.damage(victim,1000,attacker,{kind:weapon,hitgroup,blast});server.step();
  return waitForVictim(name);
 }
 const first=await fatal({weapon:'ak47',hitgroup:'head',name:'AK爆头目标'});assertRow(first,{weapon:'ak47',headshot:true,localKill:true});assert.equal(first.attackerTeam,'T');assert.equal(first.victimTeam,'CT');assert.notEqual(first.attackerColor,first.victimColor);assert.equal(first.borderColor,'rgb(220, 102, 89)');assert.match(first.description,/AK-47 爆头/);
 report.checks.push('AK fatal head hit: gun silhouette/name, separate headshot mark, actual team colours and local-kill border.');
 assertRow(await fatal({attacker:enemy,victim:me,weapon:'m4a1',name:'M4身体目标'}),{weapon:'m4a1',localDeath:true});
 const localDeath=(await rows()).at(-1);assert.equal(localDeath.attackerTeam,'CT');assert.equal(localDeath.victimTeam,'T');assert.equal(localDeath.borderColor,'rgb(225, 92, 80)');assert.match(localDeath.description,/M4A1-S/);assert.doesNotMatch(localDeath.description,/M4A1-S 爆头/);
 assertRow(await fatal({attacker:ally,weapon:'awp',name:'AWP目标'}),{weapon:'awp'});
 assertRow(await fatal({attacker:ally,weapon:'knife',hitgroup:'head',name:'刀击目标'}),{weapon:'knife'});
 ally.weapon='awp';assertRow(await fatal({attacker:ally,weapon:'hegrenade',blast:true,name:'延迟手雷目标'}),{weapon:'hegrenade'});assert.equal(ally.weapon,'awp','The fatal cause is independent of the current held gun');
 assertRow(await fatal({attacker:null,victim:me,weapon:'fall',hitgroup:'legs',name:'坠落目标'}),{weapon:'fall',localDeath:true,cause:'environment'});assert.equal((await rows()).at(-1).attacker,null);
 assertRow(await fatal({attacker:me,victim:me,weapon:'hegrenade',blast:true,name:'自身手雷目标'}),{weapon:'hegrenade',localDeath:true,cause:'suicide'});
 report.checks.push('M4 body / AWP / knife / delayed HE / fall / self-HE retain the actual damage cause and never inherit a false headshot.');

 me.name='同名';ally.name='同名';const duplicate=await fatal({attacker:ally,weapon:'ak47',name:'同名'});assertRow(duplicate,{weapon:'ak47'});assert.equal(duplicate.attacker,'同名');assert.equal(duplicate.victim,'同名');
 const malicious=await fatal({attacker:ally,weapon:'awp',name:'<script>',attackerName:'<img src=x>'});assertRow(malicious,{weapon:'awp'});assert.equal(malicious.attacker,'<img src=x>');assert.equal(malicious.victim,'<script>');assert.equal(await page.locator('#feed img,#feed script,#feed iframe').count(),0);
 report.checks.push('Stable ids distinguish duplicate names; markup-like names remain literal text with no image/script/iframe nodes.');

 for(let n=0;n<9;n++){if(!enemy.alive)g.spawn(enemy);enemy.name='批量'+n;enemy.hp=1;g.damage(enemy,1000,ally,{kind:n%2?'awp':'ak47',hitgroup:'chest'});}server.step();
 await waitForVictim('批量8');assert.equal(await page.locator('#feed .kill-feed-entry').count(),6);assert.deepEqual((await rows()).map(row=>row.victim),['批量3','批量4','批量5','批量6','批量7','批量8']);
 const timerStart=performance.now();await page.waitForFunction(()=>document.querySelectorAll('#feed .kill-feed-entry').length===0,undefined,{timeout:8500});report.expiryWallMs=performance.now()-timerStart;assert.ok(report.expiryWallMs>=5500,'The actual production 6s expiry must run, not a test-shortened timeout');
 report.checks.push('A real kill burst keeps the newest six notices in order, then the production six-second timers remove them.');
 await fatal({weapon:'ak47',name:'下一回合前'});assert.ok(await page.locator('#feed .kill-feed-entry').count());g.begin();g.phase='live';g.endAt=g.time+3600;server.step();server.broadcastState();
 await page.waitForFunction(round=>window.lanStrike.getState()?.round===round&&document.querySelectorAll('#feed .kill-feed-entry').length===0,g.round);
 report.checks.push('A real new-round state clears previous-round notices.');

 report.controller=await page.evaluate(async()=>{
  const {createKillFeed}=await import('/cs2-kill-feed.js'),element=document.createElement('div');element.hidden=true;document.body.append(element);
  const jobs=new Map(),cancelled=[],durations=[];let seq=0;
  const schedule=(callback,ms)=>{const id=++seq;jobs.set(id,callback);durations.push(ms);return id;},cancel=id=>{cancelled.push(id);jobs.delete(id);};
  const event={type:'kill',attacker:'A',victim:'B',attackerId:'a',victimId:'b',attackerTeam:'T',victimTeam:'CT',weapon:'ak47',headshot:true};
  const controller=createKillFeed(element,{maxEntries:8,durationMs:6000,schedule,cancel});for(let n=0;n<12;n++)controller.add({...event,victim:'B'+n});
  const capped={rows:element.children.length,timers:jobs.size,cancelled:cancelled.length};controller.clear();const cleared={rows:element.children.length,timers:jobs.size};controller.add(event);controller.dispose();controller.dispose();const disposed={rows:element.children.length,timers:jobs.size,addAfterDispose:controller.add(event)};
  const abort=new AbortController(),aborting=createKillFeed(element,{signal:abort.signal,schedule,cancel});aborting.add(event);abort.abort();const aborted={rows:element.children.length,timers:jobs.size,addAfterAbort:aborting.add(event)};
  let invalidMaximumRejected=false;try{createKillFeed(element,{maxEntries:9,schedule,cancel});}catch{invalidMaximumRejected=true;}element.remove();
  return{capped,cleared,disposed,aborted,invalidMaximumRejected,allProductionDuration:durations.every(ms=>ms===6000)};
 });
 assert.deepEqual(report.controller.capped,{rows:8,timers:8,cancelled:4});assert.deepEqual(report.controller.cleared,{rows:0,timers:0});assert.deepEqual(report.controller.disposed,{rows:0,timers:0,addAfterDispose:null});assert.deepEqual(report.controller.aborted,{rows:0,timers:0,addAfterAbort:null});assert.equal(report.controller.invalidMaximumRejected,true);assert.equal(report.controller.allProductionDuration,true);
 report.checks.push('Production controller cap 8 / clear / idempotent dispose / abort cancel all owned timers; cap 9 is rejected.');

 async function showcase(){
  me.name='你的角色';ally.name='进攻方';enemy.name='防守方';
  await fatal({weapon:'ak47',hitgroup:'head',name:'防守方 · AK'});
  await fatal({attacker:ally,weapon:'m4a1',name:'防守方 · M4'});
  await fatal({attacker:enemy,victim:me,weapon:'awp',hitgroup:'head',name:'你的角色'});
  await fatal({attacker:ally,weapon:'knife',name:'防守方 · 刀'});
  ally.weapon='awp';await fatal({attacker:ally,weapon:'hegrenade',blast:true,name:'防守方 · HE'});
  await fatal({attacker:null,victim:me,weapon:'fall',hitgroup:'legs',name:'你的角色'});
  g.spawn(me);me.name='你的角色';Object.assign(me,support.end,{vx:0,vy:0,vz:0,yaw:-2.92,pitch:0,grounded:true});
  await page.evaluate(()=>window.cs2Automation.stop());server.broadcastState();await page.waitForFunction(()=>window.lanStrike.getState().players.find(p=>p.id===window.lanStrike.getId())?.alive);await page.evaluate(()=>{window.cs2Automation.start();window.cs2Automation.look(-2.92,0);});
 }
 await showcase();await pause(200);report.desktopRows=await rows();assert.equal(report.desktopRows.length,6);await screenshot('kill-feed-desktop.png');await screenshot('kill-feed-detail.png',{feedOnly:true});
 await page.setViewportSize({width:640,height:760});await pause(150);report.narrowRows=await rows();assert.equal(report.narrowRows.length,6);
 for(const row of report.narrowRows){assert.ok(row.rect.x>=0&&row.rect.right<=640,'Narrow row must remain inside the viewport');assert.ok(row.iconBox.width>0&&row.iconBox.height>0);assert.ok(row.rect.width<=616);}
 await screenshot('kill-feed-narrow.png');await screenshot('kill-feed-narrow-detail.png',{feedOnly:true});
 report.checks.push('Six real notices fit the desktop and 640px layouts, with visible weapon/headshot SVGs and no viewport overflow.');
 report.webglError=await page.evaluate(()=>document.querySelector('#game').getContext('webgl2').getError());assert.equal(report.webglError,0);assert.deepEqual(report.errors,[]);
 for(const file of files)assert.equal(sha(await readFile(file)),sourceHashes[file],file+' changed during the browser run');
 report.status='completed';
}catch(error){report.status='failed';report.failure=error.stack||String(error);process.exitCode=1;try{report.failureRows=await rows();await screenshot('kill-feed-failure-'+Date.now()+'.png');}catch{}console.error(error.stack||error);}
finally{
 await context?.close();await browser?.close();await server?.close();report.fixtureClosed=true;report.finishedUTC=new Date().toISOString();
 await writeFile(path.join(output,'kill-feed-browser-report.json'),JSON.stringify(report,null,2));
 if(report.status==='failed')await writeFile(path.join(output,'kill-feed-failed-'+Date.now()+'.json'),JSON.stringify(report,null,2));
 console.log(JSON.stringify({status:report.status,output,checks:report.checks,errors:report.errors,failure:report.failure,fixtureClosed:true}));
}
