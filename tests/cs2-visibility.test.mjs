import test from 'node:test';import assert from 'node:assert/strict';
import {createWorldVisibility} from '../public/cs2-visibility.js';
function fixture(){
 const meta={bytes:0,clusterCount:4096,bytesPerRow:512,min:[0,0,0],max:[4,4,4],grid:1},layout=[['m_NodeBlock',8,1],['m_RegionBlock',8,2],['m_EnclosedClusterListBlock',8,0],['m_EnclosedClustersBlock',2,0],['m_MasksBlock',8,2],['m_nVisBlocks',1,512*4096]];let offset=0;
 for(const [name,width,count]of layout){offset=Math.ceil(offset/8)*8;meta[name]={offset,count};offset+=width*count;}meta.bytes=offset;const buffer=new ArrayBuffer(offset),node=new Uint32Array(buffer,meta.m_NodeBlock.offset,2),region=new Uint32Array(buffer,meta.m_RegionBlock.offset,4),masks=new Uint32Array(buffer,meta.m_MasksBlock.offset,4),pvs=new Uint8Array(buffer,meta.m_nVisBlocks.offset);
 node.set([1,0xffffff02]);region.set([1,0,2,1<<8]);for(let bit=0;bit<64;bit++)masks[(bit%4<2?0:2)+(bit>>>5)]|=1<<(bit&31);pvs[512]=3;pvs[1024]=5;
 return{meta,buffer,masks,world:([x,y,z])=>[y*.0254,z*.0254,x*.0254]};
}
test('compiled PVS reads the correct cell, axis mapping and conservative boundary',()=>{
 const f=fixture(),v=createWorldVisibility(f.meta,f.buffer);assert.equal(v.row(f.world([.5,1,1]))[0],3);assert.equal(v.row(f.world([3,1,1]))[0],5);assert.equal(v.row(f.world([2,1,1]))[0],3);assert.ok(v.toSource(f.world([1,2,3])).every((n,i)=>Math.abs(n-(i+1))<1e-12));
});
test('PVS unions overlapping regions and never hides geometry on unknown/solid/outside positions',()=>{
 const f=fixture();f.masks[2]|=f.masks[0];f.masks[3]|=f.masks[1];const v=createWorldVisibility(f.meta,f.buffer);assert.equal(v.row(f.world([.5,1,1]))[0],7);assert.equal(v.row(f.world([-1,1,1])),null);assert.equal(v.row([NaN,0,0]),null);assert.equal(v.visible(null,[2]),true);assert.equal(v.visible(new Uint8Array(512),[]),true);assert.equal(v.visible(v.row(f.world([3,1,1])),[1]),false);
});
test('conservative box query keeps both sides of a cell boundary, and catches empty regions',()=>{
 const f=fixture(),v=createWorldVisibility(f.meta,f.buffer);assert.deepEqual(v.boxClusters(f.world([.2,.2,.2]),f.world([.8,.8,.8])),[1]);assert.deepEqual(v.boxClusters(f.world([1.9,.2,.2]),f.world([2.1,.8,.8])),[1,2]);assert.deepEqual(v.boxClusters(f.world([-3,-3,-3]),f.world([-1,-1,-1])),[]);
});
test('visibility rejects malformed or cyclic trees, truncated blocks and invalid masks',()=>{
 for(const mutate of [(f)=>f.meta.bytes--,f=>new Uint32Array(f.buffer,f.meta.m_NodeBlock.offset,2).set([0,0]),f=>new Uint32Array(f.buffer,f.meta.m_RegionBlock.offset,4)[1]=100<<8]){const f=fixture();mutate(f);assert.throws(()=>createWorldVisibility(f.meta,f.buffer),/Invalid|Incomplete/);}
});
