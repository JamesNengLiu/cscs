// Isolated settings UI: real HTML and binding, no map assets or game server required.
import assert from 'node:assert/strict';
import {readFile,mkdir} from 'node:fs/promises';
import {chromium} from 'playwright';
const entry=`<script type="module">
  import {SCOPED_SENSITIVITY,createMouseSettings,bindMouseSettings} from '/mouse-settings.js';
  let storage;try{storage=localStorage;}catch{}
  const normal=createMouseSettings(storage),scoped=createMouseSettings(storage,SCOPED_SENSITIVITY);
  bindMouseSettings(document,normal,scoped);
  document.getElementById('lobby').hidden=true;document.getElementById('resume').hidden=false;
  window.testSettings={normal,scoped};
</script>`;
const html=(await readFile(new URL('../public/index.html',import.meta.url),'utf8')).replace('<script type="module" src="/client.js"></script>',entry);
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
const errors=[];
async function setup(context){
  await context.route('https://settings.test/**',async route=>{
    const pathname=new URL(route.request().url()).pathname;
    if(pathname==='/')return route.fulfill({contentType:'text/html',body:html});
    if(!/^\/[a-z-]+\.(js|css)$/.test(pathname))return route.abort();
    await route.fulfill({contentType:pathname.endsWith('.js')?'text/javascript':'text/css',body:await readFile(new URL(`../public${pathname}`,import.meta.url))});
  });
  const page=await context.newPage();page.on('pageerror',error=>errors.push(error.message));
  await page.goto('https://settings.test/');await page.waitForFunction(()=>window.testSettings);return page;
}
async function fill(page,id,value){await page.fill('#'+id,value);await page.locator('#'+id).blur();}
try{
  const context=await browser.newContext({viewport:{width:1280,height:900}}),page=await setup(context);
  assert.equal(await page.inputValue('#mouseSensitivityNumber'),'1.00');assert.equal(await page.inputValue('#scopedSensitivityNumber'),'1.00');
  await fill(page,'mouseSensitivityNumber','0.5');await fill(page,'scopedSensitivityNumber','0.35');
  assert.equal(await page.inputValue('#scopedSensitivity'),'0.35');assert.equal(await page.locator('#scopedSensitivityValue').textContent(),'0.35×');
  await page.locator('#scopedSensitivity').focus();await page.keyboard.press('ArrowRight');assert.equal(await page.inputValue('#scopedSensitivityNumber'),'0.40');
  assert.equal(await page.inputValue('#mouseSensitivityNumber'),'0.50');
  await fill(page,'scopedSensitivityNumber','999');assert.equal(await page.inputValue('#scopedSensitivityNumber'),'5.00');
  await fill(page,'scopedSensitivityNumber','');assert.equal(await page.inputValue('#scopedSensitivityNumber'),'5.00');
  await fill(page,'scopedSensitivityNumber','-1');assert.equal(await page.inputValue('#scopedSensitivityNumber'),'0.10');
  await fill(page,'scopedSensitivityNumber','0.35');await page.reload();await page.waitForFunction(()=>window.testSettings);
  assert.equal(await page.inputValue('#mouseSensitivityNumber'),'0.50');assert.equal(await page.inputValue('#scopedSensitivityNumber'),'0.35');
  console.log('PASS independent sliders, precise values, bounds and actual reload persistence');
  await mkdir('artifacts',{recursive:true});await page.screenshot({path:'artifacts/scoped-settings-desktop.png'});
  await page.setViewportSize({width:390,height:844});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  await page.locator('#scopedSensitivityNumber').scrollIntoViewIfNeeded();await page.screenshot({path:'artifacts/scoped-settings-narrow.png'});
  await page.selectOption('#resume [data-quality]','sharp');await page.evaluate(()=>localStorage.setItem('lan-strike-quality','sharp'));
  await page.click('#resetMouseSettings');assert.equal(await page.inputValue('#mouseSensitivityNumber'),'1.00');assert.equal(await page.inputValue('#scopedSensitivityNumber'),'1.00');
  assert.equal(await page.inputValue('#resume [data-quality]'),'sharp');assert.equal(await page.evaluate(()=>localStorage.getItem('lan-strike-quality')),'sharp');
  await page.reload();await page.waitForFunction(()=>window.testSettings);assert.equal(await page.inputValue('#scopedSensitivityNumber'),'1.00');
  console.log('PASS narrow layout and persistent reset of both sensitivities without resetting quality');
  const blocked=await browser.newContext();await blocked.addInitScript(()=>Object.defineProperty(window,'localStorage',{get(){throw Error('Storage denied for test');}}));
  const denied=await setup(blocked);await fill(denied,'scopedSensitivityNumber','0.45');assert.equal(await denied.inputValue('#scopedSensitivity'),'0.45');
  assert.equal(await denied.evaluate(()=>window.testSettings.scoped.value),.45);assert.match(await denied.locator('#mouseSettingsStatus').textContent(),/存储不可用/);
  assert.deepEqual(errors,[]);console.log('PASS in-session scoped settings with unavailable storage, no page errors');
}finally{await browser.close();}
