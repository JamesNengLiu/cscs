// Reuse authored native mip chains. No decode/recompression or quality ceiling
// changes: coarse mips are temporary coverage while full current-view mips load.
import {readFile,writeFile,mkdir} from 'node:fs/promises';import path from 'node:path';import {gunzipSync,gzipSync} from 'node:zlib';import {createHash} from 'node:crypto';
const base='public/assets/cs2-textured',out='public/assets/cs2-optimized';await mkdir(path.join(out,'preview'),{recursive:true});
const original=JSON.parse(await readFile(path.join(base,'textures.json'),'utf8')),textures={},canonical=new Map();let previewBytes=0;
for(const [name,meta]of Object.entries(original.textures)){
 const key=[meta.format,meta.faces||1,meta.mips[0].width,meta.mips[0].height,meta.sha256].join(':');
 if(!canonical.has(key))canonical.set(key,'../cs2-textured/'+meta.file);
 const full={...meta,file:canonical.get(key)};
 if(meta.mips[0].width<=128&&meta.mips[0].height<=128||name.startsWith('maps/')||meta.faces===6){textures[name]={full,preview:full};continue;}
 const bytes=gunzipSync(await readFile(path.join(base,meta.file))),selected=meta.mips.filter(m=>Math.max(m.width,m.height)<=128);if(!selected.length)throw Error('No authored preview mip: '+name);
 const first=selected[0].offset,binary=bytes.subarray(first),sha=createHash('sha256').update(binary).digest('hex'),file='preview/'+sha.slice(0,24)+'.bin.gz',compressed=gzipSync(binary,{level:6});await writeFile(path.join(out,file),compressed);previewBytes+=compressed.length;
 textures[name]={full,preview:{...meta,file,bytes:binary.length,downloadBytes:compressed.length,sha256:sha,mips:selected.map(m=>({...m,offset:m.offset-first}))}};
}
await writeFile(path.join(out,'textures.json'),JSON.stringify({format:'cs2-streamed-textures-v1',textureMax:original.textureMax,lightmapMax:original.lightmapMax,textures}));
console.log(JSON.stringify({textures:Object.keys(textures).length,uniqueFull:canonical.size,previewBytes}));
