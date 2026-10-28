import {chromium} from 'playwright';
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
const base=process.env.TEST_URL||'http://192.168.8.101:3001';
const paths=['client.js','rigid-skinning.js','performance.js','gpu-timer.js','player-model.js','weapon-model.js','index.html'];
const served=[];
for(const file of paths){const response=await fetch(`${base}/${file}`,{signal:AbortSignal.timeout(10000)});assert.equal(response.status,200);const remote=Buffer.from(await response.arrayBuffer()),local=await readFile(new URL(`../public/${file}`,import.meta.url));assert.deepEqual(remote,local,`Live ${file} differs`);served.push({file,sha256:createHash('sha256').update(remote).digest('hex')});}
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
try{
  const page=await browser.newPage({viewport:{width:1280,height:900}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(base,{waitUntil:'networkidle'});await page.waitForFunction(()=>window.lanStrike?.getPerformance&&window.lanStrike?.getRenderInfo().triangles>0);
  const state=await page.evaluate(()=>{const gl=document.getElementById('game').getContext('webgl2'),ext=gl.getExtension('WEBGL_debug_renderer_info');return {performance:window.lanStrike.getPerformance(),weapon:window.lanStrike.getDiagnostics().weaponModel.skinning,webglVersion:gl.getParameter(gl.VERSION),renderer:ext?gl.getParameter(ext.UNMASKED_RENDERER_WEBGL):gl.getParameter(gl.RENDERER),qualityControls:document.querySelectorAll('[data-quality]').length,wasmRequests:performance.getEntriesByType('resource').filter(r=>r.name.endsWith('.wasm')).length};});
  assert.equal(state.performance.skinning,'gpu');assert.equal(state.weapon,'gpu');assert.equal(state.qualityControls,2);assert.equal(state.wasmRequests,0);assert.deepEqual(errors,[]);
  await page.screenshot({path:'artifacts/smooth-live-lobby.png'});
  const report={status:'passed',base,served,state,errors,scope:'Read-only current LAN service verification; did not join the live room'};
  await writeFile('artifacts/smooth-live-report.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
}finally{await browser.close();}
