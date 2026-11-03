// Isolated CPU/IO differential probe, never a browser FPS measurement.
import {readFile,writeFile,mkdir} from 'node:fs/promises';import assert from 'node:assert/strict';
import {parseModelJSON,consumeCooperatively} from '../public/cooperative-json.js';
import {validatePlayerModel,validatePlayerModelSteps} from '../public/player-asset-validation.js';
import {packPlayerAsset,packPlayerAssetSteps} from '../public/player-asset-format.js';
const manifest=JSON.parse(await readFile('public/assets/players/manifest.json','utf8')),rows=[],options={yieldTask:()=>new Promise(r=>setImmediate(r)),budgetMs:3};
for(const [id,entry]of Object.entries(manifest.models)){
 const text=await readFile('public/assets/players/'+entry.file,'utf8'),native=JSON.parse(text),result=await parseModelJSON(text,options);assert.deepEqual(result.value,native);validatePlayerModel(native,id,entry,false);const validation=await consumeCooperatively(validatePlayerModelSteps(result.value,id,entry,false),options);const a=packPlayerAsset(native),b=await consumeCooperatively(packPlayerAssetSteps(result.value),options);assert.deepEqual(b.value,a);rows.push({id,bytes:Buffer.byteLength(text),parse:result.metrics,validate:validation.metrics,pack:b.metrics});console.log(id,'exact',result.metrics.chunks,'parse chunks');
}
await mkdir('artifacts',{recursive:true});await writeFile('artifacts/cooperative-assets.json',JSON.stringify({scope:'CPU-only original/alternate parser, validator and packer; no FPS or physical multiplayer claim',status:'passed',rows},null,2));
