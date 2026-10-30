// Isolated UI/FX checks: no game server or other service is started.
// node tests/shop-browser.mjs [--unit-only | --client]
import assert from 'node:assert/strict';
import {readFile,mkdir} from 'node:fs/promises';
import * as THREE from 'three';
import {GUNS,EQUIPMENT} from '../public/arsenal.js';
import {ECONOMY} from '../public/economy.js';
import {ownedWeapons,equipmentCount,purchaseStatus} from '../public/shop.js';
import {createWorldEffects,FX_LIMITS,flashOpacity,smokeOpacity} from '../public/effects.js';

const p={id:'local',name:'Shop test',team:'T',alive:true,canBuy:true,money:10000,armour:0,helmet:false,
  primary:null,pistol:'glock18',weapon:'glock18',inventory:{glock18:{ammo:20,reserve:0}},grenades:{hegrenade:0,flashbang:0,smokegrenade:0}};
assert.equal(Object.keys(GUNS).length,24);
assert.deepEqual(ownedWeapons(p,{state:'carried',holder:p.id}),['glock18','knife','c4']);
assert.deepEqual(ownedWeapons({...p,primary:'ak47',inventory:{...p.inventory,ak47:{ammo:30}},grenades:{flashbang:2}}),['ak47','glock18','knife','flashbang']);
assert.equal(purchaseStatus({...GUNS.ak47,id:'ak47'},p,GUNS),'');
assert.match(purchaseStatus({...GUNS.m4a1,id:'m4a1'},p,GUNS),/CT/);
assert.match(purchaseStatus({...GUNS.ak47,id:'ak47'},{...p,money:0},GUNS),/资金不足/);
assert.match(purchaseStatus({...GUNS.ak47,id:'ak47'},{...p,canBuy:false},GUNS),/购买区/);
assert.match(purchaseStatus({...GUNS.ak47,id:'ak47'},{...p,alive:false},GUNS),/阵亡/);
assert.equal(equipmentCount({...p,grenades:{flashbang:2}},'flashbang'),2);
assert.equal(purchaseStatus({...EQUIPMENT.assaultsuit,id:'assaultsuit'},{...p,money:400,armour:100,helmet:false},GUNS),'');
assert.match(purchaseStatus({...EQUIPMENT.flashbang,id:'flashbang'},{...p,grenades:{flashbang:2}},GUNS),/上限/);
assert.equal(flashOpacity(10,1,8),1);assert.equal(flashOpacity(10,1,10),0);
assert.ok(flashOpacity(10,1,9.5)>0&&flashOpacity(10,1,9.5)<1);
const cloud={x:0,y:0,z:0,radius:4,endAt:20};
assert.ok(smokeOpacity([cloud],{x:0,y:1.6,z:0},10)>.98);
assert.equal(smokeOpacity([cloud],{x:10,y:1.6,z:0},10),0);
assert.equal(smokeOpacity([cloud],{x:0,y:1.6,z:0},21),0);
const scene=new THREE.Scene(),fx=createWorldEffects(THREE,scene,{loadAssets:false});
const crowded={projectiles:Array.from({length:200},()=>({kind:'flashbang',x:0,y:1,z:0})),smokes:Array.from({length:200},()=>({...cloud}))};
for(let i=0;i<100;i++){fx.sync(crowded);fx.update(10,{x:0,y:1.6,z:0});}
assert.equal(fx.info().projectilePool,FX_LIMITS.projectiles);assert.equal(fx.info().smokePool,FX_LIMITS.smokes);
assert.equal(scene.children.length,9+FX_LIMITS.smokes);
const geometry=new Set();scene.traverse(o=>{if(o.isMesh)geometry.add(o.geometry);});assert.ok(geometry.size<=10);
fx.sync({});fx.update(30,null);assert.ok(scene.children.every(o=>!o.visible));fx.dispose();assert.equal(scene.children.length,0);
console.log('PASS catalog, restrictions, owned-only cycling, flash/smoke opacity, bounded reusable FX');

if(!process.argv.includes('--unit-only')){
  const {chromium}=await import('playwright');
  const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']});
  try{
    const page=await browser.newPage({viewport:{width:1280,height:800}}),errors=[];
    page.on('pageerror',e=>errors.push(e.message));
    const entry=`<script type="module">
      import {GUNS,EQUIPMENT} from '/arsenal.js';import {ECONOMY} from '/economy.js';import {createShop} from '/shop.js';
      const player=${JSON.stringify(p)},state={time:1,buyEndAt:90},sent=[];
      document.getElementById('lobby').hidden=true;
      const shop=createShop({guns:GUNS,equipment:EQUIPMENT,economy:ECONOMY,send:m=>sent.push(m),onResume(){},onOpenChange(open){document.getElementById('resume').hidden=open;}});
      const update=()=>shop.update(player,state);update();shop.setOpen(true);window.testShop={shop,player,state,sent,update};
    </script>`;
    const html=(await readFile(new URL('../public/index.html',import.meta.url),'utf8')).replace('<script type="module" src="/client.js"></script>',entry);
    await page.route('https://shop.test/**',async route=>{
      const pathname=new URL(route.request().url()).pathname;
      if(pathname==='/')return route.fulfill({contentType:'text/html',body:html});
      const name=pathname.slice(1);
      if(!/^[a-z-]+\.(js|css)$/.test(name))return route.abort();
      await route.fulfill({contentType:name.endsWith('.js')?'text/javascript':'text/css',body:await readFile(new URL(`../public/${name}`,import.meta.url))});
    });
    await page.goto('https://shop.test/');await page.waitForFunction(()=>Boolean(window.testShop));
    assert.equal(await page.locator('#buyBalance').textContent(),'$10,000');
    assert.equal(await page.locator('button[data-category]').count(),0,'unified menu has no category-switch step');
    const ids=await page.locator('[data-item]').evaluateAll(nodes=>nodes.map(n=>n.dataset.item));
    assert.deepEqual(ids.sort(),[...Object.keys(GUNS),...Object.keys(EQUIPMENT)].sort());
    const allOnScreen=await page.locator('[data-item]').evaluateAll(nodes=>nodes.every(n=>{const r=n.getBoundingClientRect();return r.top>=0&&r.bottom<=innerHeight&&r.left>=0&&r.right<=innerWidth;}));
    assert.equal(allOnScreen,true,'all 32 cards fit on the desktop screen');
    assert.equal(await page.locator('.buy-column').count(),5);
    assert.ok(!ids.some(id=>['rifle','pistol','sniper'].includes(id)));
    assert.equal(await page.locator('[data-item="m4a1"]').isDisabled(),true);
    await page.locator('[data-item="ak47"]').click();
    assert.deepEqual(await page.evaluate(()=>window.testShop.sent),[{type:'buy',item:'ak47'}]);
    assert.equal(await page.locator('#buyBalance').textContent(),'$10,000');
    await page.evaluate(()=>window.testShop.shop.reportError('<img src=x onerror=alert(1)> Server rejected purchase'));
    assert.match(await page.locator('#buyMessage').textContent(),/Server rejected/);assert.equal(await page.locator('#buyMessage img').count(),0);
    await page.evaluate(()=>{const t=window.testShop;t.player.money=7500;t.player.primary='ak47';t.player.weapon='ak47';t.player.inventory.ak47={ammo:30,reserve:0};t.update();});
    assert.equal(await page.locator('#buyBalance').textContent(),'$7,500');
    assert.equal(await page.locator('[data-item="ak47"]').getAttribute('data-equipped'),'true');
    await page.evaluate(()=>window.stableSmoke=document.querySelector('[data-item="smokegrenade"]'));
    await page.evaluate(()=>{window.testShop.player.money=7400;window.testShop.update();});
    assert.equal(await page.evaluate(()=>window.stableSmoke===document.querySelector('[data-item="smokegrenade"]')),true);
    assert.equal(await page.locator('button[data-category="ammo"]').count(),0);
    assert.match(await page.locator('[data-item="ak47"]').textContent(),/赠满备弹/);
    assert.match(await page.locator('#buyStartMoney').textContent(),/每回合自动补满/);
    await page.evaluate(()=>{const t=window.testShop;t.player.grenades.flashbang=2;t.update();});
    assert.equal(await page.locator('[data-item="flashbang"]').isDisabled(),true);
    await page.evaluate(()=>{const t=window.testShop;t.player.canBuy=false;t.update();});
    assert.equal(await page.locator('.shop-item:not(:disabled)').count(),0);
    await page.evaluate(()=>{const t=window.testShop;t.player.canBuy=true;t.player.team='CT';t.update();});
    assert.equal(await page.locator('[data-item="defusekit"]').isDisabled(),false);
    await page.evaluate(()=>{const t=window.testShop;t.player.money=10000;t.update();t.sent.length=0;document.querySelector('[data-item="m4a1"]').click();document.querySelector('[data-item="assaultsuit"]').click();document.querySelector('[data-item="smokegrenade"]').click();});
    assert.deepEqual(await page.evaluate(()=>window.testShop.sent.map(m=>m.item)),['m4a1','assaultsuit','smokegrenade']);
    assert.equal(await page.locator('#buyBalance').textContent(),'$10,000');
    await mkdir('artifacts',{recursive:true});await page.screenshot({path:'artifacts/lan-strike-shop.png'});
    await page.setViewportSize({width:760,height:560});
    assert.equal(await page.evaluate(()=>document.querySelector('.buy-panel').scrollWidth<=innerWidth),true);
    await page.locator('#buyClose').click();assert.equal(await page.locator('#buyMenu').isVisible(),false);
    assert.deepEqual(errors,[]);
    console.log('PASS isolated browser: all 32 purchase intents accessible, no ammunition sales, server-only money, restrictions, owned/equipped, safe error text, compact layout');
    await page.close();
    if(process.argv.includes('--client'))await checkClient(browser);
  }finally{await browser.close();}
}

async function checkClient(browser){
  // Real client, map and weapon renderer; intercepted HTTP and a snapshot fixture replace transport only.
  const {SPAWNS}=await import('../public/map.js');
  const me={...p,...SPAWNS.T,primary:'ak47',weapon:'ak47',inventory:{...p.inventory,ak47:{ammo:30}},
    hp:100,armour:50,ammo:30,reserve:0,zoom:90,grenades:{hegrenade:1,flashbang:1,smokegrenade:0},
    vx:0,vy:0,vz:0,pitch:0,grounded:true,crouch:false,kills:0,deaths:0,action:'',progress:0,spread:.004,ackInputSeq:0,flashUntil:0,flashAmount:0};
  const snapshot={type:'state',players:[me],round:1,time:10,endAt:120,buyEndAt:90,phase:'live',message:'Fixture round',score:{T:0,CT:0},bomb:{state:'none'},projectiles:[],smokes:[]};
  const page=await browser.newPage({viewport:{width:1280,height:800}}),errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(snapshot=>{
    window.clientSnapshot=snapshot;window.clientSent=[];
    window.WebSocket=class {
      static OPEN=1;
      constructor(){this.readyState=1;window.fixtureWS=this;setTimeout(()=>{this.onopen?.();this.emit({type:'hello',id:'local'});},0);}
      emit(data){this.onmessage?.({data:JSON.stringify(data)});}
      send(raw){const m=JSON.parse(raw);window.clientSent.push(m);if(m.type==='join')setTimeout(()=>{this.emit({type:'joined',id:'local'});this.emit(window.clientSnapshot);},0);}
    };
  },snapshot);
  await page.route('https://client.test/**',async route=>{
    const pathname=new URL(route.request().url()).pathname;
    const relative=pathname==='/'?'index.html':pathname.slice(1);
    if(relative.includes('..'))return route.abort();
    const file=relative.startsWith('vendor/')?new URL(`../node_modules/three/build/${relative.slice(7)}`,import.meta.url):new URL(`../public/${relative}`,import.meta.url);
    const type=relative.endsWith('.js')?'text/javascript':relative.endsWith('.css')?'text/css':relative.endsWith('.json')?'application/json':relative.endsWith('.png')?'image/png':'text/html';
    try{await route.fulfill({contentType:type,body:await readFile(file)});}catch{await route.fulfill({status:404,body:'Missing fixture asset'});}
  });
  await page.goto('https://client.test/');await page.waitForFunction(()=>window.lanStrike?.getRenderInfo().triangles>0,null,{timeout:30000});
  // Asset completion can request its final lobby frame. Establish an idle
  // baseline after those asynchronous loads, before testing unrelated shots.
  await page.waitForFunction(()=>window.lanStrike.getDiagnostics().worldEffects.projectileModels.models.every(m=>m.source==='viewmodel-weapon-body'));
  await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  const idleFrames=await page.evaluate(()=>window.lanStrike.getRenderInfo().frame);
  await page.evaluate(()=>window.fixtureWS.emit({type:'events',events:[{type:'shot',id:'remote',from:{x:0,y:1,z:0},to:{x:1,y:1,z:1}}]}));
  await page.waitForTimeout(200);assert.equal(await page.evaluate(()=>window.lanStrike.getRenderInfo().frame),idleFrames);
  await page.click('#joinButton');await page.waitForFunction(()=>window.lanStrike.getDiagnostics().money===10000);
  await page.click('#resumeButton');await page.waitForFunction(()=>window.lanStrike.getDiagnostics().locked);
  await page.keyboard.down('KeyW');await page.mouse.down();await page.keyboard.press('KeyB');await page.keyboard.up('KeyW');await page.mouse.up();
  await page.waitForFunction(()=>window.lanStrike.getDiagnostics().buyMenuOpen&&!document.pointerLockElement);
  const neutral=await page.evaluate(()=>window.lanStrike.getDiagnostics().input);
  assert.equal(neutral.f,0);assert.equal(neutral.fire,false);assert.equal(neutral.jump,false);
  assert.equal(await page.locator('[data-item="hegrenade"]').isDisabled(),true,'one carried HE already reaches its limit');
  await page.locator('[data-item="smokegrenade"]').click();
  assert.ok(await page.evaluate(()=>window.clientSent.some(m=>m.type==='buy'&&m.item==='smokegrenade')));
  assert.equal(await page.evaluate(()=>window.lanStrike.getDiagnostics().money),10000);
  await page.click('#buyResume');await page.waitForFunction(()=>window.lanStrike.getDiagnostics().locked);
  assert.equal(await page.evaluate(()=>window.lanStrike.getDiagnostics().input.fire),false);
  for(const key of ['Digit1','Digit2','Digit3','Digit4','Digit5','KeyR','KeyG'])await page.keyboard.press(key);
  await page.mouse.click(640,400,{button:'right'});await page.mouse.wheel(0,-100);
  await page.waitForFunction(()=>window.clientSent.some(m=>m.type==='equip'&&m.weapon==='flashbang'));
  const sent=await page.evaluate(()=>window.clientSent);
  for(const weapon of [1,2,3,4,5])assert.ok(sent.some(m=>m.type==='equip'&&m.weapon===weapon));
  for(const type of ['reload','drop','secondary'])assert.ok(sent.some(m=>m.type===type));
  assert.ok(sent.some(m=>m.type==='equip'&&m.weapon==='flashbang'));
  assert.ok(!sent.some(m=>m.type==='equip'&&['rifle','pistol','sniper'].includes(m.weapon)));
  await page.evaluate(()=>{window.clientSnapshot.players[0].weapon='glock18';window.fixtureWS.emit(window.clientSnapshot);});
  await page.keyboard.press('KeyQ');assert.ok(await page.evaluate(()=>window.clientSent.some(m=>m.type==='equip'&&m.weapon==='ak47')));
  await page.evaluate(()=>{window.clientSnapshot.players[0].weapon='awp';window.clientSnapshot.players[0].zoom=40;window.fixtureWS.emit(window.clientSnapshot);});
  await page.waitForFunction(()=>Math.abs(window.lanStrike.getDiagnostics().fov-2*Math.atan(Math.tan(40*Math.PI/360)/(4/3))*180/Math.PI)<1e-8);assert.equal(await page.locator('#scopeOverlay').isVisible(),true);
  await page.keyboard.press('KeyB');await page.waitForFunction(()=>!document.pointerLockElement);
  await page.evaluate(()=>window.fixtureWS.emit({type:'events',events:[{type:'flash',id:'remote',amount:1,duration:2,time:10}]}));
  assert.equal(await page.evaluate(()=>window.lanStrike.getDiagnostics().flashOpacity),0);
  await page.evaluate(()=>window.fixtureWS.emit({type:'events',events:[{type:'flash',id:'local',amount:1,duration:1.5}]}));
  await page.waitForFunction(()=>window.lanStrike.getDiagnostics().flashOpacity>.1);
  await page.waitForFunction(()=>window.lanStrike.getDiagnostics().flashOpacity===0,null,{timeout:3000});
  await page.evaluate(()=>{const s=window.clientSnapshot;s.players[0].flashUntil=s.time+.8;s.players[0].flashAmount=.8;window.fixtureWS.emit(s);});
  await page.waitForFunction(()=>window.lanStrike.getDiagnostics().flashOpacity>.1);
  await page.waitForFunction(()=>window.lanStrike.getDiagnostics().flashOpacity===0,null,{timeout:2000});
  await page.evaluate(()=>{const s=window.clientSnapshot,p=s.players[0];p.zoom=90;s.projectiles=[{kind:'hegrenade',x:p.x,y:p.y+1,z:p.z}];s.smokes=[{x:p.x,y:p.y+1.6,z:p.z,radius:4,endAt:s.time+20}];window.fixtureWS.emit(s);});
  await page.waitForFunction(()=>window.lanStrike.getDiagnostics().smokeOpacity>.98);
  assert.equal(await page.evaluate(()=>window.lanStrike.getDiagnostics().worldEffects.projectiles),1);
  assert.equal(await page.evaluate(()=>window.lanStrike.getDiagnostics().grenadeCount),2);
  assert.ok(await page.evaluate(()=>window.lanStrike.getDiagnostics().weaponModel.source));
  assert.ok(idleFrames>0);assert.deepEqual(errors,[]);
  await page.close();
  console.log('PASS real client with intercepted snapshots: static lobby rendering, pointer lock/shop transitions, neutral held input, inventory intents, Q/wheel, zoom, local-only unlocked flash decay, smoke and model diagnostics');
}
