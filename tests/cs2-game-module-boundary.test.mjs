import test from 'node:test';import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';import path from 'node:path';import {fileURLToPath} from 'node:url';
import * as legacyProtocol from '../public/input-protocol.js';import * as experimentalProtocol from '../public/cs2-input-protocol.js';
const root=fileURLToPath(new URL('../',import.meta.url));
async function graph(entry){const queue=[path.join(root,entry)],seen=new Set();while(queue.length){const file=queue.pop();if(seen.has(file))continue;seen.add(file);const source=await readFile(file,'utf8');const expression=/(?:\b(?:import|export)\s+(?:[^;]*?\sfrom\s*)?|\bimport\s*\()\s*['"](\.[^'"]+)['"]/g;for(const match of source.matchAll(expression)){const target=path.resolve(path.dirname(file),match[1]);if(/\.(mjs|js)$/.test(target)&&target.startsWith(root))queue.push(target);}}return [...seen].map(f=>path.relative(root,f));}
test('isolated input protocol keeps wire constants, sanitization, ordering and immutable first-copy behavior',()=>{
 for(const key of Object.keys(legacyProtocol))if(typeof legacyProtocol[key]!=='function')assert.deepEqual(experimentalProtocol[key],legacyProtocol[key]);
 for(const input of [{},{f:Infinity,s:-5,yaw:'2',pitch:NaN,fire:1,jump:true},{f:1,s:.2,yaw:5,pitch:1,fire:true,crouch:true,walk:false,use:true},null])for(const seq of [1,12,0,2147483648]){
  const command={seq,round:1,input};assert.deepEqual(experimentalProtocol.normalizeInputCommand(command,1),legacyProtocol.normalizeInputCommand(command,1));
 }
 const commands=[{seq:2,round:1,f:1},{seq:1,round:1,f:-1},{seq:2,round:1,f:0},{seq:3,round:2}];assert.deepEqual(experimentalProtocol.buildInputBatch(commands,1,0),legacyProtocol.buildInputBatch(commands,1,0));
});
for(const entry of ['cs2-game.mjs','cs2-server.mjs','cs2-lag-compensation.mjs','cs2-scope-actions.mjs','public/cs2-client.js','public/cs2-game-connection.js','public/cs2-input-protocol.js','public/cs2-weapon-action-order.js','public/cs2-grenade-intent.js','public/cs2-weapon-switch-view.js'])test(`${entry} recursively excludes all legacy BSP-bound modules`,async()=>{
 const files=await graph(entry);for(const file of files)assert.ok(!['public/map.js','public/map-data.js','public/movement.js','public/weapons.js','public/gun-state.js','public/shared.js'].includes(file),`${entry} unexpectedly loads ${file}`);
});
