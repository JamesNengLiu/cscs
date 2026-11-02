// Native first-person renderer and original local assets. Switches occur inside
// the render callback, exactly where the production client calls setWeapon.
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
const before=process.argv.includes('--before'),baseline=process.env.WEAPON_SWITCH_BASELINE;
if(before)assert.ok(baseline,'--before requires the saved original weapon-model.js');
const report={scope:'Isolated native Chrome and production viewmodel renderer; cold, cached, evicted and superseded grenade switches. No live game service or FPS claim; screenshots/readback are visual QA only.',before,errors:[],missing:[],cases:[]};
let browser,page;
try{
 await mkdir('artifacts',{recursive:true});browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',args:['--disable-backgrounding-occluded-windows','--disable-renderer-backgrounding','--disable-background-timer-throttling']});page=await browser.newPage({viewport:{width:1280,height:800}});page.on('pageerror',e=>report.errors.push(e.message));page.on('response',r=>{if(r.status()>=400)report.missing.push(r.url());});
 let delayKind=null;
 const html=`<!doctype html><meta charset="utf-8"><style>body{margin:0;background:#21313d}canvas{display:block}#label{position:absolute;top:20px;left:24px;color:#eef;font:18px system-ui}</style><div id="label"></div><script type="module">
 import * as THREE from '/vendor/three.module.js';import {createWeaponView} from '/weapon-model.js';
 const renderer=new THREE.WebGLRenderer({antialias:true});renderer.setSize(1280,800);renderer.setPixelRatio(1);renderer.outputColorSpace=THREE.SRGBColorSpace;document.body.append(renderer.domElement);
 const scene=new THREE.Scene();scene.background=new THREE.Color('#21313d');const camera=new THREE.PerspectiveCamera(75,1.6,.06,450);scene.add(camera);camera.layers.set(1);
 const view=await createWeaponView(THREE,camera);const audit={view,renderer,scene,camera,requested:'glock18',stage:null,rows:[],captures:{},next:[],state:{ammo:1,lastShot:-100},last:performance.now()};window.switchAudit=audit;
 function frame(now){requestAnimationFrame(frame);const dt=Math.min(.05,(now-audit.last)/1000);audit.last=now;
  for(const id of audit.next.splice(0)){audit.requested=id;view.setWeapon(id);}
  view.update(dt,audit.state,now/1000);renderer.render(scene,camera);
  if(audit.stage){const info=view.info(),roots=view.group.children.filter(o=>o.name.startsWith('original-mdl:')||o.name.startsWith('procedural-fallback:')).map(o=>({name:o.name,visible:o.visible})),wire=roots.some(o=>o.visible&&o.name.startsWith('procedural-fallback:'));
   audit.rows.push({stage:audit.stage,t:now,requested:audit.requested,source:info.source,loading:info.loading,error:info.error,roots,wire,cache:info.cachedModels});
   if(wire&&!audit.captures[audit.stage]&&['cold-he','warm-he-0'].includes(audit.stage))audit.captures[audit.stage]=renderer.domElement.toDataURL('image/png');
  }
 }requestAnimationFrame(frame);
 </script>`;
 await page.route('https://weapon-switch.test/**',async route=>{
  const name=new URL(route.request().url()).pathname.slice(1);if(!name)return route.fulfill({contentType:'text/html',body:html});if(name.includes('..'))return route.abort();
  const file=before&&name==='weapon-model.js'?baseline:name.startsWith('vendor/')?new URL('../node_modules/three/build/'+name.slice(7),import.meta.url):new URL('../public/'+name,import.meta.url);
  if(delayKind&&name.startsWith('assets/weapons/'+delayKind+'/'))await new Promise(r=>setTimeout(r,120));
  try{await route.fulfill({contentType:name.endsWith('.js')?'text/javascript':name.endsWith('.json')?'application/json':name.endsWith('.png')?'image/png':'text/plain',body:await readFile(file)});}catch{await route.fulfill({status:404,body:'Missing local fixture asset'});}
 });
 await page.goto('https://weapon-switch.test/');await page.waitForFunction(()=>window.switchAudit);await page.waitForTimeout(150);
 const switchTo=async(id,label)=>{
  await page.evaluate(({id,label})=>{const a=window.switchAudit;a.stage=label;a.next.push(id);document.querySelector('#label').textContent=label;},{id,label});
  await page.waitForFunction(id=>{const a=window.switchAudit,m=a.view.info();return a.requested===id&&m.id===id&&!m.loading;},id);
  await page.waitForTimeout(60);const rows=await page.evaluate(label=>window.switchAudit.rows.filter(r=>r.stage===label),label),info=await page.evaluate(()=>window.switchAudit.view.info());
  assert.equal(info.source,'original-mdl',info.error);assert.equal(info.convertedSHA256Verified,true);assert.ok(info.cachedModels<=4);
  report.cases.push({label,id,frames:rows.length,wireFrames:rows.filter(r=>r.wire).length,loadingFrames:rows.filter(r=>r.loading).length,wrongModelFrames:rows.filter(r=>r.roots.some(o=>o.visible&&o.name.startsWith('original-mdl:')&&o.name!=='original-mdl:'+id)).length,rows});
 };
 delayKind='hegrenade';await switchTo('hegrenade','cold-he');delayKind=null;
 await switchTo('flashbang','cold-flash');await switchTo('smokegrenade','cold-smoke');
 for(let i=0;i<3;i++)for(const [id,name]of [['hegrenade','he'],['flashbang','flash'],['smokegrenade','smoke']])await switchTo(id,`warm-${name}-${i}`);
 for(const id of ['knife','ak47','m4a1','awp'])await switchTo(id,'evict-'+id);
 delayKind='hegrenade';await switchTo('hegrenade','evicted-he');delayKind=null;
 await page.evaluate(()=>{const a=window.switchAudit;a.stage='rapid-race';a.next.push('hegrenade','flashbang','smokegrenade');});
 await page.waitForFunction(()=>{const m=window.switchAudit.view.info();return m.id==='smokegrenade'&&!m.loading;});await page.waitForTimeout(150);
 const rapid=await page.evaluate(()=>({info:window.switchAudit.view.info(),rows:window.switchAudit.rows.filter(r=>r.stage==='rapid-race')}));assert.equal(rapid.info.source,'original-mdl');assert.equal(rapid.info.id,'smokegrenade');report.rapid=rapid;
 for(const [name,data]of Object.entries(await page.evaluate(()=>window.switchAudit.captures)))await writeFile('artifacts/weapon-switch-'+(before?'before':'after')+'-'+name+'.png',Buffer.from(data.split(',')[1],'base64'));
 if(!before){
  await page.evaluate(()=>window.switchAudit.stage=null);
  for(const id of ['hegrenade','flashbang','smokegrenade']){
   await page.evaluate(async id=>{const a=window.switchAudit;await a.view.setWeapon(id);const idle=a.view.info().availableSequences.find(s=>/^idle/.test(s.name));if(!idle)throw Error('Missing original idle sequence');a.state={weaponSequence:idle.name,weaponFrame:0};document.querySelector('#label').textContent=id;},id);
   await page.waitForTimeout(70);await page.screenshot({path:'artifacts/weapon-switch-after-'+id+'.png'});
  }
 }
 if(!before){for(const c of report.cases){assert.equal(c.wireFrames,0,c.label+' exposed a debug mesh');assert.equal(c.wrongModelFrames,0,c.label+' displayed the previous weapon');if(c.label.startsWith('warm-'))assert.equal(c.loadingFrames,0,c.label+' should install from cache in the switching frame');}}
 report.graphics=await page.evaluate(()=>{const gl=window.switchAudit.renderer.getContext(),e=gl.getExtension('WEBGL_debug_renderer_info');return gl.getParameter(e?e.UNMASKED_RENDERER_WEBGL:gl.RENDERER);});
 assert.deepEqual(report.errors,[]);assert.deepEqual(report.missing,[]);report.status='passed';
}catch(e){report.status='failed';report.failure=e.stack;process.exitCode=1;}
finally{await browser?.close();await writeFile('artifacts/weapon-switch-'+(before?'before':'after')+'.json',JSON.stringify(report,null,2));console.log(JSON.stringify({status:report.status,graphics:report.graphics,cases:report.cases.map(({rows,...c})=>c),errors:report.errors,missing:report.missing,failure:report.failure},null,2));}
