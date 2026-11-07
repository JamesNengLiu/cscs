import test from 'node:test';import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';import {tmpdir} from 'node:os';import path from 'node:path';import {spawnSync} from 'node:child_process';
import {crc32} from 'node:zlib';
// Synthetic format fixtures only; no original or derived Valve resources.
function archive({name='world',folder='maps/de_dust2',external=false,badRange=false,payload=Buffer.from('test')}={}){
 const entry=Buffer.alloc(18);entry.writeUInt32LE(crc32(payload),0);entry.writeUInt16LE(0,4);entry.writeUInt16LE(external?0:0x7fff,6);entry.writeUInt32LE(0,8);entry.writeUInt32LE(badRange?payload.length+100:payload.length,12);entry.writeUInt16LE(0xffff,16);
 const tree=Buffer.concat([Buffer.from(`vwrld_c\0${folder}\0${name}\0`),entry,Buffer.from([0,0,0])]),header=Buffer.alloc(28);header.writeUInt32LE(0x55aa1234,0);header.writeUInt32LE(2,4);header.writeUInt32LE(tree.length,8);return Buffer.concat([header,tree,payload]);
}
function inspect(data,complete=false,references=false){const dir=mkdtempSync(path.join(tmpdir(),'cscs-cs2-vpk-'));try{const file=path.join(dir,'sample_dir.vpk');writeFileSync(file,data);return spawnSync('python3',['tools/inspect-cs2-assets.py','--archive',file,...(complete?['--require-complete']:[]),...(references?['--references']:[])],{encoding:'utf8'});}finally{rmSync(dir,{recursive:true,force:true});}}
test('Source 2 preflight reads an inline map index without extracting files',()=>{const r=inspect(archive(),true);assert.equal(r.status,0,r.stderr);const d=JSON.parse(r.stdout);assert.equal(d.indexComplete,true);assert.equal(d.entries,1);assert.deepEqual(d.mapResources,['maps/de_dust2/world.vwrld_c']);assert.equal(d.resourceTypes.vwrld_c,1);});
test('Source 2 preflight reports missing VPK parts as incomplete',()=>{const r=inspect(archive({external:true}),true);assert.equal(r.status,2);const d=JSON.parse(r.stdout);assert.equal(d.indexComplete,false);assert.match(d.missingArchives[0],/sample_000\.vpk$/);});
test('Source 2 preflight rejects malformed headers and unsafe resource paths',()=>{for(const data of [Buffer.alloc(8),archive({folder:'../escape'})]){const r=inspect(data);assert.equal(r.status,2);assert.match(r.stderr,/Cannot inspect VPK/);assert.equal(r.stdout,'');}});
test('Source 2 preflight rejects out-of-file resource ranges',()=>{const r=inspect(archive({badRange:true}),true);assert.equal(r.status,2);assert.equal(JSON.parse(r.stdout).invalidRanges.length,1);});
test('Source 2 preflight follows validated relative reference pointers and verifies CRC',()=>{
 const name=Buffer.from('materials/test.vmat\0'),data=Buffer.alloc(16+12+24+name.length);data.writeUInt32LE(data.length,0);data.writeUInt16LE(12,4);data.writeUInt32LE(8,8);data.writeUInt32LE(1,12);data.write('RERL',16);data.writeUInt32LE(8,20);data.writeUInt32LE(24+name.length,24);data.writeUInt32LE(8,28);data.writeUInt32LE(1,32);data.writeBigInt64LE(8n,44);name.copy(data,52);
 const valid=inspect(archive({payload:data}),true,true);assert.equal(valid.status,0,valid.stderr);assert.deepEqual(JSON.parse(valid.stdout).references,['materials/test.vmat_c']);const broken=archive({payload:data});broken[broken.length-2]^=1;const invalid=inspect(broken,true,true);assert.equal(invalid.status,2);assert.match(invalid.stderr,/CRC mismatch/);
});
