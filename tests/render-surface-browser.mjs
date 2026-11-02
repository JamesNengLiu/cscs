// Pixel checks use page screenshots in this isolated visual test only.
import {chromium} from 'playwright';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {inflateSync} from 'node:zlib';
import assert from 'node:assert/strict';
function pngPixels(data){
 let w,h,bpp;const chunks=[];for(let at=8;at<data.length;){const n=data.readUInt32BE(at),type=data.toString('ascii',at+4,at+8),body=data.subarray(at+8,at+8+n);if(type==='IHDR'){w=body.readUInt32BE(0);h=body.readUInt32BE(4);assert.equal(body[8],8);assert.ok([2,6].includes(body[9]));bpp=body[9]===6?4:3;}if(type==='IDAT')chunks.push(body);at+=12+n;}
 const raw=inflateSync(Buffer.concat(chunks)),stride=w*bpp,out=Buffer.alloc(h*stride);let at=0;
 const paeth=(a,b,c)=>{const p=a+b-c,x=Math.abs(p-a),y=Math.abs(p-b),z=Math.abs(p-c);return x<=y&&x<=z?a:y<=z?b:c;};
 for(let y=0;y<h;y++){const filter=raw[at++];for(let x=0;x<stride;x++){const a=x>=bpp?out[y*stride+x-bpp]:0,b=y?out[(y-1)*stride+x]:0,c=y&&x>=bpp?out[(y-1)*stride+x-bpp]:0;out[y*stride+x]=(raw[at++]+[0,a,b,Math.floor((a+b)/2),paeth(a,b,c)][filter])&255;}}
 return (x,y)=>[...out.subarray((y*w+x)*bpp,(y*w+x)*bpp+3)];
}
const report={status:'running',checks:[],errors:[],scope:'Native WebGL two-layer test and CSS screenshot pixel checks; no game service, assets or FPS claim.'};let browser;
try{
 await mkdir('artifacts',{recursive:true});browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});const page=await browser.newPage({viewport:{width:1280,height:800}});page.on('pageerror',e=>report.errors.push(e.message));
 const html=`<!doctype html><style>html,body{margin:0;overflow:hidden}#cross{position:fixed;left:50%;top:50%;width:2px;height:2px;background:#000}</style><canvas id="game"></canvas><div id="cross"></div><script type="module">import * as THREE from '/vendor/three.module.js';import {createRenderSurface} from '/render-surface.js';const renderer=new THREE.WebGLRenderer({canvas:document.getElementById('game'),antialias:true}),scene=new THREE.Scene(),camera=new THREE.Camera(),surface=createRenderSurface(renderer,renderer.domElement,{width:innerWidth,height:innerHeight,ratio:1.25});const world=new THREE.Mesh(new THREE.PlaneGeometry(2,2),new THREE.ShaderMaterial({vertexShader:'varying vec2 v;void main(){v=uv;gl_Position=vec4(position,1.);}',fragmentShader:'varying vec2 v;void main(){vec3 c=v.y>.5?(v.x<.5?vec3(1,0,0):vec3(0,1,0)):(v.x<.5?vec3(0,0,1):vec3(1,1,0));if(abs(v.x-.5)<.05&&abs(v.y-.5)<.05)c=vec3(1);gl_FragColor=vec4(c,1);}'}));scene.add(world);const weapon=new THREE.Mesh(new THREE.PlaneGeometry(.3,.3),new THREE.MeshBasicMaterial({color:0xff00ff}));weapon.position.set(.6,-.6,0);weapon.layers.set(1);scene.add(weapon);window.surfaceTest={surface,renderer,draw(){renderer.autoClear=true;camera.layers.set(0);renderer.render(scene,camera);renderer.clearDepth();renderer.autoClear=false;camera.layers.set(1);renderer.render(scene,camera);}};surfaceTest.draw();</script>`;
 await page.route('https://surface.test/**',async route=>{const name=new URL(route.request().url()).pathname.slice(1);if(!name)return route.fulfill({contentType:'text/html',body:html});const file=name.startsWith('vendor/')?new URL('../node_modules/three/build/'+name.slice(7),import.meta.url):new URL('../public/'+name,import.meta.url);await route.fulfill({contentType:'text/javascript',body:await readFile(file)});});
 await page.goto('https://surface.test/');await page.waitForFunction(()=>window.surfaceTest);
 for(const ratio of [1.25,1,.85,.7,1.25]){
  await page.evaluate(ratio=>{surfaceTest.surface.setRatio(ratio);surfaceTest.draw();},ratio);await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));const png=await page.screenshot(),pixel=pngPixels(png),matches=(got,want)=>want.every((v,i)=>Math.abs(got[i]-v)<10);
  for(const [x,y,color]of [[20,20,[255,0,0]],[1260,20,[0,255,0]],[20,780,[0,0,255]],[1260,780,[255,255,0]],[650,410,[255,255,255]],[1024,640,[255,0,255]],[640,400,[0,0,0]]])assert.ok(matches(pixel(x,y),color),`${ratio}: CSS pixel ${x},${y} = ${pixel(x,y)} expected ${color}`);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);report.checks.push({ratio,corners:true,center:true,foreground:true,hud:true});if(ratio===.7)await writeFile('artifacts/render-surface-low.png',png);
 }
 assert.deepEqual(report.errors,[]);report.status='passed';
}catch(e){report.status='failed';report.failure=e.stack;process.exitCode=1;console.error(e);}
finally{await browser?.close();await writeFile('artifacts/render-surface-browser-report.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));}
