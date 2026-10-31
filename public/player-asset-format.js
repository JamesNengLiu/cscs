import {check,LIMIT,fetchPlayerBytes,validatePlayerModel,freezePlayerMetadata,playerAssetPath} from './player-asset-validation.js';
export const PREPARED_PLAYER_VERSION=1;
const MAX_PREPARED_BYTES=192*1024*1024;
const keys=(value,names)=>Object.fromEntries(names.filter(k=>value[k]!==undefined).map(k=>[k,value[k]]));
const optionalNumbers=(value,key,length)=>{if(value[key]==null)return undefined;check(Array.isArray(value[key])&&value[key].length===length&&value[key].every(Number.isFinite),'Invalid '+key);return value[key].slice();};
function sameTracks(a,b){
 if(!a||!b||a.length!==b.length)return false;
 for(let i=0;i<a.length;i++)for(let j=0;j<6;j++){const x=a[i][j],y=b[i][j];if(x==null||y==null){if(x!==y)return false;continue;}
  if(x.values.length!==y.values.length||!x.values.every((v,k)=>v===y.values[k]))return false;
  const xh=x.positionHold||[],yh=y.positionHold||[];if(xh.length!==yh.length||!xh.every((v,k)=>v===yh[k]))return false;
 }return true;
}
function metadata(value){
 const result=keys(value,['id','source','sourceSHA256','baseSourceSHA256','sourceURL','retailHashVerified','sourceAuthenticity']);
 for(const v of Object.values(result))check(v===null||typeof v==='boolean'||Number.isFinite(v)||typeof v==='string'&&v.length<=4096,'Invalid model metadata');
 if(value.counts!==undefined){const text=JSON.stringify(value.counts);check(text.length<=4096,'Model count metadata exceeds budget');result.counts=JSON.parse(text);}
 return result;
}
export function packPlayerAsset(data){
 const sets=[],sequences=data.sequences.map(s=>{
  if(s.flags!=null)check(Number.isInteger(s.flags),'Invalid sequence flags');if(s.motionType!=null)check(Number.isInteger(s.motionType),'Invalid motion type');
  const result=keys(s,['name','fps','flags','frames','blendCount','motionType','motionBone']);
  for(const [key,length]of [['linearMovement',3],['blendStart',2],['blendEnd',2],['blendType',2]]){const values=optionalNumbers(s,key,length);if(values)result[key]=values;}
  const add=t=>{const id=sets.length;sets.push({frames:s.frames,tracks:t});return id;};
  if(s.blendTracks)result.blendSets=s.blendTracks.map(add);
  if(s.tracks)result.trackSet=result.blendSets&&sameTracks(s.tracks,s.blendTracks[0])?result.blendSets[0]:add(s.tracks);
  return result;
 });
 let samples=0,holds=0,entries=0;for(const set of sets)for(const channels of set.tracks)for(const c of channels)if(c){samples+=c.values.length;holds+=c.positionHold?.length||0;entries++;}
 let floats=0,bones=0,indices=0;for(const m of data.meshes){floats+=m.positions.length+m.normals.length+m.uvPixels.length;bones+=m.vertexBones.length+m.normalBones.length;indices+=m.indices.length;}
 const packed={version:PREPARED_PLAYER_VERSION,header:{schema:data.schema,metadata:metadata(data.metadata),bones:data.bones.map(b=>({...keys(b,['name','parent']),value:b.value.slice(),scale:b.scale.slice(),controllers:(b.controllers||[-1,-1,-1,-1,-1,-1]).slice()})),controllers:(data.controllers||[]).map(c=>keys(c,['bone','type','start','end','rest'])),textures:data.textures.map(t=>keys(t,['file','width','height','flags'])),skins:data.skins.map(s=>s.slice()),bodyparts:data.bodyparts.map(b=>({base:b.base,models:b.models.map(()=>({}))})),attachments:(data.attachments||[]).map(a=>({bone:a.bone,origin:a.origin.slice()})),sequences,meshes:[]},
  values:new Int16Array(samples),holds:new Uint16Array(holds),entries:new Int32Array(entries*4),setStarts:new Uint32Array(sets.length+1),setFrames:new Uint16Array(sets.length),geometry:new Float64Array(floats),vertexBones:new Uint16Array(bones),indices:new Uint32Array(indices)};
 let vi=0,hi=0,ei=0;for(let si=0;si<sets.length;si++){const set=sets[si];packed.setStarts[si]=ei;packed.setFrames[si]=set.frames;
  for(let bone=0;bone<set.tracks.length;bone++)for(let axis=0;axis<6;axis++){const c=set.tracks[bone][axis];if(!c)continue;packed.entries.set([bone*6+axis,vi,c.positionHold?hi:-1,c.positionHold?.length||0],ei*4);packed.values.set(c.values,vi);vi+=c.values.length;if(c.positionHold){packed.holds.set(c.positionHold,hi);hi+=c.positionHold.length;}ei++;}
 }packed.setStarts[sets.length]=ei;
 let fi=0,bi=0,ii=0;for(const m of data.meshes){const spec={...keys(m,['bodypart','model','skinref']),vertices:m.vertexBones.length,indexCount:m.indices.length,index32:m.indices.some(v=>v>=65535)};
  for(const k of ['positions','normals','uvPixels']){spec[k]=fi;packed.geometry.set(m[k],fi);fi+=m[k].length;}
  for(const k of ['vertexBones','normalBones']){spec[k]=bi;packed.vertexBones.set(m[k],bi);bi+=m[k].length;}
  spec.indices=ii;packed.indices.set(m.indices,ii);ii+=m.indices.length;packed.header.meshes.push(spec);
 }
 check(preparedPlayerBytes(packed)<=MAX_PREPARED_BYTES,'Prepared model exceeds byte budget');return packed;
}
export const playerTransferList=p=>['values','holds','entries','setStarts','setFrames','geometry','vertexBones','indices'].map(k=>p[k].buffer);
export const preparedPlayerBytes=p=>playerTransferList(p).reduce((n,b)=>n+b.byteLength,0);
export const yieldPlayerTask=()=>new Promise(resolve=>{
 if(typeof document!=='undefined'&&!document.hidden&&typeof requestAnimationFrame==='function')requestAnimationFrame(()=>setTimeout(resolve,0));
 else if(typeof setImmediate==='function')setImmediate(resolve);else setTimeout(resolve,0);
});
export async function preparePlayerAsset(request,{yieldTask=null}={}){
 const {url,id,entry,weapon=false}=request;check(typeof url==='string'&&url.startsWith('/assets/players/'),'Unsafe player asset URL');check(playerAssetPath(url.slice('/assets/players/'.length))===url,'Unsafe player asset URL');
 const start=performance.now(),{bytes,verified}=await fetchPlayerBytes(url,LIMIT.json,entry.convertedSHA256),fetched=performance.now();if(yieldTask)await yieldTask();
 const decodeStart=performance.now(),text=new TextDecoder('utf-8',{fatal:true}).decode(bytes),decoded=performance.now(),data=JSON.parse(text),parsed=performance.now();if(yieldTask)await yieldTask();
 const validateStart=performance.now();validatePlayerModel(data,id,entry,weapon);const validated=performance.now();if(yieldTask)await yieldTask();
 const packStart=performance.now(),packed=packPlayerAsset(data),done=performance.now();return {packed,verified,metrics:{sourceBytes:bytes.byteLength,preparedBytes:preparedPlayerBytes(packed),fetchMs:fetched-start,decodeMs:decoded-decodeStart,parseMs:parsed-decoded,validateMs:validated-validateStart,packMs:done-packStart}};
}
export async function hydratePlayerAsset(packed,{yieldTask=yieldPlayerTask,budgetMs=3}={}){
 check(packed?.version===PREPARED_PLAYER_VERSION,'Wrong prepared model version');const types={values:Int16Array,holds:Uint16Array,entries:Int32Array,setStarts:Uint32Array,setFrames:Uint16Array,geometry:Float64Array,vertexBones:Uint16Array,indices:Uint32Array};for(const [k,T]of Object.entries(types))check(packed[k] instanceof T,'Invalid prepared buffer '+k);
 check(preparedPlayerBytes(packed)<=MAX_PREPARED_BYTES&&packed.values.length<=LIMIT.samples&&packed.holds.length<=LIMIT.samples&&packed.geometry.length<=LIMIT.vertices*8&&packed.vertexBones.length<=LIMIT.vertices*2&&packed.indices.length<=3000000,'Invalid prepared buffer budget');
 const h=packed.header;check(h&&Array.isArray(h.bones)&&h.bones.length>0&&h.bones.length<=128&&Array.isArray(h.sequences)&&h.sequences.length<=1024&&Array.isArray(h.meshes)&&h.meshes.length<=1024,'Invalid prepared model header');
 check(packed.entries.length%4===0&&packed.setFrames.length<=17408&&packed.setStarts.length===packed.setFrames.length+1&&packed.setStarts[0]===0&&packed.setStarts.at(-1)===packed.entries.length/4,'Invalid track directory');
 const started=performance.now();let chunkStart=started,workMs=0,maxChunkMs=0,chunks=0;async function checkpoint(){const elapsed=performance.now()-chunkStart;if(elapsed<budgetMs)return;workMs+=elapsed;maxChunkMs=Math.max(maxChunkMs,elapsed);chunks++;await yieldTask();chunkStart=performance.now();}
 const sets=[];for(let si=0;si<packed.setFrames.length;si++){
  const frames=packed.setFrames[si],from=packed.setStarts[si],to=packed.setStarts[si+1];check(frames>0&&frames<=10000&&to>=from&&to<=packed.entries.length/4&&to-from<=h.bones.length*6,'Invalid track set');const tracks=Array.from({length:h.bones.length},()=>Array(6).fill(null));let previous=-1;
  for(let e=from;e<to;e++){const i=e*4,at=packed.entries[i],offset=packed.entries[i+1],holdOffset=packed.entries[i+2],holdCount=packed.entries[i+3];check(at>previous&&at<h.bones.length*6&&offset>=0&&offset+frames<=packed.values.length&&holdCount>=0&&(holdOffset===-1?holdCount===0:holdOffset>=0&&holdOffset+holdCount<=packed.holds.length),'Invalid track reference');previous=at;
   const channel={values:packed.values.subarray(offset,offset+frames)};if(holdOffset>=0)channel.positionHold=packed.holds.subarray(holdOffset,holdOffset+holdCount);tracks[Math.floor(at/6)][at%6]=Object.freeze(channel);
  }
  for(const c of tracks)Object.freeze(c);sets.push(Object.freeze(tracks));await checkpoint();
 }
 const sequences=[];for(const s of h.sequences){const {trackSet,blendSets,...sequence}=s;const get=id=>{check(Number.isInteger(id)&&id>=0&&id<sets.length&&packed.setFrames[id]===s.frames,'Invalid sequence track reference');return sets[id];};if(trackSet!==undefined)sequence.tracks=get(trackSet);if(blendSets!==undefined){check(Array.isArray(blendSets)&&blendSets.length===s.blendCount,'Invalid blend directory');sequence.blendTracks=blendSets.map(get);}sequences.push(sequence);await checkpoint();}
 const meshes=[];for(const m of h.meshes){const result={bodypart:m.bodypart,model:m.model,skinref:m.skinref,index32:m.index32},n=m.vertices;check(Number.isInteger(n)&&n>0&&n<=LIMIT.vertices,'Invalid packed vertex count');
  const view=(buffer,offset,length)=>{check(Number.isInteger(offset)&&Number.isInteger(length)&&offset>=0&&length>=0&&offset+length<=buffer.length,'Invalid geometry reference');return buffer.subarray(offset,offset+length);};
  for(const [k,stride]of [['positions',3],['normals',3],['uvPixels',2]])result[k]=view(packed.geometry,m[k],n*stride);for(const k of ['vertexBones','normalBones'])result[k]=view(packed.vertexBones,m[k],n);result.indices=view(packed.indices,m.indices,m.indexCount);meshes.push(result);await checkpoint();
 }
 const data={...h,sequences,meshes};freezePlayerMetadata(data);const tail=performance.now()-chunkStart;workMs+=tail;maxChunkMs=Math.max(maxChunkMs,tail);return {data,metrics:{hydrateWallMs:performance.now()-started,hydrateWorkMs:workMs,hydrateMaxChunkMs:maxChunkMs,hydrateChunks:chunks+1}};
}
