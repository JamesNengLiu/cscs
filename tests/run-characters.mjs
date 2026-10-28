import {chromium} from 'playwright';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {mkdir,writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {CHARACTER_PRESETS} from '../public/characters-config.js';
import {GUNS} from '../public/arsenal.js';
const report={status:'running',checks:[],models:[],weapons:[],actions:[],errors:[],externalRequests:[],screenshots:[],temporaryServer:true};
const check=(name,details)=>{report.checks.push({name,details});console.log('PASS',name,details??'');};
const server=spawn(process.execPath,['server.mjs'],{env:{...process.env,HOST:'127.0.0.1',PORT:'0'},stdio:['ignore','pipe','pipe']});
let browser,base,output='';
try{
  await mkdir('artifacts',{recursive:true});
  base=await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Server startup timeout')),10000);server.stdout.on('data',chunk=>{output+=chunk;const m=output.match(/http:\/\/localhost:(\d+)/);if(m){clearTimeout(timer);resolve(`http://127.0.0.1:${m[1]}`);}});server.stderr.on('data',chunk=>process.stderr.write(chunk));server.once('exit',code=>{clearTimeout(timer);reject(Error('Server exited '+code));});});
  report.base=base;assert.equal((await(await fetch(base+'/health')).json()).version,'0.5.0');
  browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',args:['--use-angle=swiftshader','--enable-unsafe-swiftshader','--disable-backgrounding-occluded-windows','--disable-renderer-backgrounding','--disable-background-timer-throttling']});
  const page=await browser.newPage({viewport:{width:1440,height:1000}});page.setDefaultTimeout(45000);
  page.on('pageerror',e=>report.errors.push(e.message));page.on('console',m=>{if(m.type()==='error')report.errors.push(m.text());});page.on('request',r=>{if(!r.url().startsWith(base)&&!r.url().startsWith('data:'))report.externalRequests.push(r.url());});
  const waitActor=async id=>{await page.waitForFunction(id=>{const d=window.characterReview;return d?.model===id&&d.actors.length===1&&d.actors[0].id===id&&!d.actors[0].loading&&d.actors[0].source!=='missing-asset-wireframe'&&d.frames>0;},id,{timeout:60000});return page.evaluate(()=>{const a=window.characterReview.actors[0];return {id:a.id,source:a.source,frame:a.frame,counts:a.counts,sequence:a.sequence,error:a.error,weapon:a.thirdPersonWeapon};});};
  await page.goto(base+'/characters.html?model=terror_trump',{waitUntil:'networkidle'});await waitActor('terror_trump');
  for(const preset of CHARACTER_PRESETS){await page.selectOption('#model',preset.id);const actor=await waitActor(preset.id);assert.equal(actor.source,preset.face==='trump'?'custom-trump-face':'original-mdl');assert.equal(actor.error,null);assert.ok(actor.counts.triangles>500);report.models.push(actor);}
  assert.equal(report.models.length,12);check('all 12 real original/custom character assets render, no wireframe fallback',report.models.length);
  await page.selectOption('#model','terror_trump');await waitActor('terror_trump');
  for(const action of ['walk','run','crouch','jump','aim','shoot','reload','death']){await page.selectOption('#action',action);await page.waitForFunction(action=>window.characterReview.actors[0].action===action&&window.characterReview.actors[0].frame>.1,action);const a=await page.evaluate(()=>{const a=window.characterReview.actors[0];return {action:a.action,sequence:a.sequence,frame:a.frame};});report.actions.push(a);}
  assert.equal(report.actions.length,8);check('eight source animation states advance in the real WebGL viewer',report.actions);
  await page.selectOption('#action','idle');
  for(const id of Object.keys(GUNS)){await page.selectOption('#weapon',id);await page.waitForFunction(id=>{const w=window.characterReview.actors[0].thirdPersonWeapon;return w?.id===id&&w.loaded;},id);const w=await page.evaluate(()=>window.characterReview.actors[0].thirdPersonWeapon);assert.match(w.status,/Merged/);report.weapons.push(w);}
  assert.equal(report.weapons.length,Object.keys(GUNS).length);check('all 24 actual p_weapon models attach by source bone names',report.weapons.length);
  await page.selectOption('#weapon','ak47');await page.waitForFunction(()=>window.characterReview.actors[0].thirdPersonWeapon.id==='ak47'&&window.characterReview.actors[0].thirdPersonWeapon.loaded);
  await page.click('#front');await page.click('#portrait');await page.screenshot({path:'artifacts/trump-face-front.png'});report.screenshots.push('artifacts/trump-face-front.png');
  await page.click('#side');await page.screenshot({path:'artifacts/trump-face-side.png'});report.screenshots.push('artifacts/trump-face-side.png');check('front and quarter-side custom 3D head captured');
  await page.click('#front');await page.check('#compare');await page.waitForFunction(()=>{const a=window.characterReview.actors;return a.length===2&&a.every(a=>!a.loading&&a.error===null&&a.source!=='missing-asset-wireframe');});await page.screenshot({path:'artifacts/character-original-vs-trump.png'});report.screenshots.push('artifacts/character-original-vs-trump.png');check('original/body-preserving custom comparison renders simultaneously');
  await page.uncheck('#compare');await page.selectOption('#model','urban');await waitActor('urban');await page.click('#full');await page.screenshot({path:'artifacts/original-ct-urban.png'});report.screenshots.push('artifacts/original-ct-urban.png');
  await page.setViewportSize({width:390,height:844});await page.selectOption('#model','terror_trump');await waitActor('terror_trump');assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);await page.screenshot({path:'artifacts/character-mobile.png'});report.screenshots.push('artifacts/character-mobile.png');check('mobile review fits 390px without horizontal overflow');
  assert.deepEqual(report.errors,[]);assert.deepEqual(report.externalRequests,[]);check('no browser errors or external resource requests');report.status='passed';
}catch(error){report.status='failed';report.failure=error.stack;console.error(error);process.exitCode=1;}
finally{
  if(browser)await browser.close();const closed=once(server,'exit');server.kill('SIGTERM');const outcome=await Promise.race([closed.then(()=>true),new Promise(resolve=>setTimeout(()=>resolve(false),3000))]);if(!outcome){server.kill('SIGKILL');await closed;}report.shutdown=outcome?'graceful':'forced';
  let reachable=false;try{await fetch(base+'/health',{signal:AbortSignal.timeout(1000)});reachable=true;}catch{}report.portClosed=!reachable;
  if(report.shutdown!=='graceful'||!report.portClosed){report.status='failed';process.exitCode=1;}await writeFile('artifacts/character-browser-report.json',JSON.stringify(report,null,2));console.log(JSON.stringify({status:report.status,checks:report.checks.length,models:report.models.length,weapons:report.weapons.length,actions:report.actions.length,shutdown:report.shutdown,portClosed:report.portClosed}));
}
