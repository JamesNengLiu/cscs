import test from 'node:test';
import assert from 'node:assert/strict';
import {createGameAudio} from '../public/game-audio.js';
import {gunSound,safeSound} from '../public/sound-catalog.js';
function fixture(){
  const requests=[],contexts=[];
  class Node{connect(){}disconnect(){}stop(){this.onended?.();}start(){}}
  class Context{
    constructor(){this.state='running';this.currentTime=0;this.destination={};this.panners=[];this.listener=Object.fromEntries(['positionX','positionY','positionZ','forwardX','forwardY','forwardZ','upX','upY','upZ'].map(k=>[k,{value:0}]));contexts.push(this);}
    createGain(){return Object.assign(new Node(),{gain:{value:0}});}createBufferSource(){return new Node();}
    createPanner(){const n=Object.assign(new Node(),{positionX:{value:0},positionY:{value:0},positionZ:{value:0}});this.panners.push(n);return n;}
    async decodeAudioData(b){return {bytes:b.byteLength};}async resume(){}close(){this.state='closed';}
  }
  const audio=createGameAudio({Context,fetcher:async url=>{requests.push(url);return {ok:true,arrayBuffer:async()=>new ArrayBuffer(44)};}});
  return {audio,requests,contexts};
}
test('gun audio uses separate original WAV names and selects suppressor variants',()=>{
  assert.notEqual(gunSound('ak47'),gunSound('m4a1'));assert.notEqual(gunSound('awp'),gunSound('scout'));
  assert.notEqual(gunSound('m4a1'),gunSound('m4a1',true));assert.notEqual(gunSound('usp'),gunSound('usp',true));
  for(const n of ['../secret.wav','https://evil.test/x.wav','weapons/../../x.wav','/weapons/x.wav'])assert.equal(safeSound(n),false);
});
test('audio waits for a user gesture, reuses decoded buffers and suppresses duplicate pellet/penetration events',async()=>{
  const {audio,requests}=fixture();assert.equal(await audio.play('weapons/awp1.wav'),false);assert.equal(requests.length,0);
  await audio.resume();const before=requests.length;await audio.shot({weapon:'awp',shotId:'one'});await audio.shot({weapon:'awp',shotId:'one'});
  assert.equal(audio.diagnostics().played,1);assert.equal(requests.length,before);audio.dispose();
});
test('remote audio is positioned in 3D and voice counts stay bounded during sustained fire',async()=>{
  const {audio,contexts}=fixture();await audio.resume();audio.listen({x:1,y:2,z:3},{x:0,y:0,z:-1});
  await audio.shot({weapon:'ak47'}, {x:5,y:2,z:3});const p=contexts[0].panners[0];assert.equal(p.panningModel,'HRTF');assert.equal(p.positionX.value,5);
  for(let i=0;i<100;i++)await audio.shot({weapon:'ak47'});assert.equal(audio.diagnostics().voices,48);audio.dispose();assert.equal(audio.diagnostics().voices,0);
});
